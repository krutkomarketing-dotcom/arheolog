// Точка входа: загрузка данных, связка блоков, URL, горячие клавиши.
import { $, $$, debounce, esc, fmtInt, dialog } from './util.js';
import { state, onChange, setFilter, resetFilter, fromParams, writeURL } from './state.js';
import { db, loadAll, filterSites, facets, applyEdits, pagesOf } from './data.js';
import { store } from './store.js';
import { initMap, showSites, select, zoomAll, zoomTo, map, toggleLegend, toggleRuler, stopRuler, refreshMarker, note } from './map.js';
import { initFilters, renderFilters, collapseFilters } from './filters.js';
import { initTimeline, renderTimeline } from './timeline.js';
import { renderCard, cardClick } from './card.js';
import { initViewer, openViewer } from './viewer.js';
import { initSearch } from './search.js';
import { startEdit, editing, cancel as cancelEdit } from './edit.js';

async function boot() {
  $('#map-progress').hidden = false;
  await store.init();
  await loadAll();
  if (db.meta.variant !== 'full') {
    $('#stub-banner').hidden = false;
    $('.brand-sub').textContent = 'Демо-версия · временная заглушка';
  } else {
    $('.brand-sub').textContent = store.mode === 'claude' ? 'Научная база памятников · закрытый доступ' : 'Научная база памятников · локальная копия';
  }
  renderUser();

  const params = new URLSearchParams(location.search);
  Object.assign(state.filter, fromParams(params));

  initMap(id => openSite(id));
  initFilters();
  initTimeline();
  initViewer();
  initSearch({
    site: (id, o) => openSite(id, o),
    place: (lat, lon) => zoomTo(lat, lon, 13),
    author: name => setFilter({ author: name }),
    page: (pub, pg) => openViewer(pub, pg ?? pagesOf(pub)[0], null),
  });

  const apply = debounce(render, 250);
  onChange((f, opts) => (opts.live ? render() : apply()));
  store.onEdits(edits => {
    applyEdits(edits);
    db.sites.forEach(x => refreshMarker(x));
    render();
    if (state.site && !editing()) renderCard(state.site);
  });
  render();
  bindUI();
  $('#map-progress').hidden = true;

  const sid = +params.get('site');
  if (sid && db.byId.has(sid)) openSite(sid);
  if (params.get('pub') && params.get('page')) openViewer(+params.get('pub'), +params.get('page'), sid || null);
}

function renderUser() {
  const u = store.user;
  $('#edit-toggle-wrap').hidden = !u.isAdmin;
  $('#admin-badge').textContent = store.mode === 'claude' ? 'АДМИН' : 'ДЕМО';
  $('#user-name').textContent = u.name || (store.mode === 'claude' ? 'Участник' : 'Гость');
  $('#user-org').textContent = u.org || '';
  const initials = (u.name || 'Гость').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  $('#user-initials').textContent = initials;
  if (u.avatar) { $('#user-avatar').src = u.avatar; $('#user-avatar').hidden = false; $('#user-initials').hidden = true; }
}

function render() {
  const f = state.filter;
  const list = filterSites(f);
  const onMap = showSites(list);
  renderFilters(f, facets(f), { total: list.length, onMap });
  renderTimeline(f, list.length);
  const foot = $('#card [data-export="selection"]');
  if (foot) foot.textContent = `Выборка (${fmtInt(list.length)})`;
}

function openSite(id, opts = {}) {
  if (editing()) return;
  state.site = id;
  select(id, { fly: !opts.noFly });
  renderCard(id, opts);
  writeURL();
  if (innerWidth <= 760) $('#filters').classList.remove('open');
}

function closeCard() {
  state.site = null;
  select(null);
  $('#card').hidden = true;
  writeURL();
}

function bindUI() {
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (!a) return;
    if (a === 'home') { e.preventDefault(); if (!editing()) { closeCard(); zoomAll(); } }
    if (a === 'reset') resetFilter();
    if (a === 'clear-time') setFilter({ timeMode: 'epochs', epochs: [], yearFrom: null, yearTo: null });
    if (a === 'zoom-in') map.m.zoomIn();
    if (a === 'zoom-out') map.m.zoomOut();
    if (a === 'zoom-all') zoomAll();
    if (a === 'ruler') toggleRuler(e.target.closest('button'));
    if (a === 'toggle-legend') toggleLegend();
    if (a === 'close-card') closeCard();
    if (a === 'collapse-filters') collapseFilters(true);
    if (a === 'expand-filters') collapseFilters(false);
    if (a === 'toggle-filters') $('#filters').classList.toggle('open');
    if (a === 'hide-stub') $('#stub-banner').hidden = true;
    if (a === 'help') help();
  });
  $('#card').addEventListener('click', e => { if (!editing()) cardClick(e, (pub, pg, site) => openViewer(pub, pg, site)); });

  // режим редактирования
  const tgl = $('#edit-toggle');
  tgl.addEventListener('change', () => {
    $('#edit-toggle-wrap').classList.toggle('on', tgl.checked);
    if (tgl.checked) {
      if (!state.site) {
        note('Режим редактирования включён. Выберите памятник на карте — откроется правка координат.', 6000);
        return;
      }
      beginEdit(state.site);
    } else if (editing()) {
      cancelEdit();
    }
  });
  map.m.on('popupopen', () => {});
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && map.ruler) stopRuler();
  });
  // когда режим включён, клик по памятнику сразу открывает правку
  const origSelect = map.onSelect;
  map.onSelect = id => {
    origSelect(id);
    if (tgl.checked && !editing()) beginEdit(id);
  };
  window.addEventListener('resize', debounce(() => map.m.invalidateSize(), 150));
}

function beginEdit(id) {
  startEdit(id, (sid, saved) => {
    const x = db.byId.get(sid);
    if (saved && store.mode !== 'claude') { /* локально onEdits уже отработал */ }
    refreshMarker(x);
    renderCard(sid);
    select(sid, { fly: false });
    if (!saved) { $('#edit-toggle').checked = false; $('#edit-toggle-wrap').classList.remove('on'); }
  });
}

async function help() {
  const s = db.meta.stats;
  await dialog({
    title: 'О прототипе и данных',
    body: `<ul class="help-list">
      <li>Памятники — автоматический разбор каталога: Поболь Л. Д. «Археологические памятники Белоруссии: Железный век» (Минск, 1983). Записей: ${fmtInt(s.sites)}.</li>
      <li>Координаты — центр населённого пункта по GeoNames и OpenStreetMap, поэтому у всех точек точность «до нас. пункта». Найдены для ${fmtInt(s.withCoords)} из ${fmtInt(s.sites)} записей; остальные доступны через поиск и фильтр «Без координат».</li>
      <li>Тип, культура, датировка и находки проставлены по ключевым словам в описании и требуют проверки. Датировка «по культурам» — ориентировочные границы культуры, а не памятника.</li>
      <li>Упоминания в других книгах пока не подключены: автоматический поиск даёт много ложных совпадений, следующий шаг — проверка через Jev/LLM.</li>
      ${db.meta.variant !== 'full' ? '<li><b>Публичная демо-версия — временная заглушка:</b> без сканов книг, описания сокращены.</li>' : ''}
      <li>Горячие клавиши: «/» — поиск, ← → — листать страницы в просмотрщике, Esc — закрыть / отменить.</li>
    </ul>`,
    actions: [{ label: 'Понятно', kind: 'primary', value: true }],
  });
}

boot().catch(err => {
  console.error(err);
  $('#map-progress').hidden = true;
  const n = $('#map-note');
  n.innerHTML = `Не удалось загрузить данные: ${esc(err.message)}. Если вы открыли файл напрямую с диска, запустите локальный сервер (см. README).`;
  n.hidden = false;
});
