// 2. Панель фильтров: наборы, типы, эпохи / свой диапазон, культуры, находки, область, точность.
import { TYPES, EPOCHS, FIND_CATS, ACCURACY, YEAR_MIN, YEAR_MAX, OBLAST_ORDER } from './const.js';
import { $, $$, esc, fmtInt, pos, yearAt, roundYear, lsGet, lsSet, dialog, toast } from './util.js';
import { state, setFilter, toParams, fromParams, activeCount } from './state.js';
import { db } from './data.js';
import { store } from './store.js';

let sets = [];

export function initFilters() {
  // типы
  $('#type-list').innerHTML = TYPES.map(t => `
    <label class="check-row"><input type="checkbox" data-type="${t.id}"><span class="tdot ${t.hollow ? 'hollow' : ''}" style="--c: var(${t.color})"></span><span class="lbl">${esc(t.name)}</span><span class="cnt" data-cnt-type="${t.id}"></span></label>`).join('');
  $('#type-list').addEventListener('change', e => {
    const id = e.target.dataset.type;
    if (!id) return;
    const s = new Set(state.filter.types);
    e.target.checked ? s.add(id) : s.delete(id);
    setFilter({ types: TYPES.map(t => t.id).filter(t => s.has(t)) });
  });

  // эпохи
  $('#epochs-pane').innerHTML = `<div class="check-list">${EPOCHS.map(e => `
    <label class="check-row"><input type="checkbox" data-epoch="${e.id}"><span class="lbl">${esc(e.name)}</span></label>
    ${(e.children || []).map(c => `<label class="check-row child"><input type="checkbox" data-epoch="${c.id}" data-parent="${e.id}"><span class="lbl">${esc(c.name)}</span></label>`).join('')}`).join('')}</div>`;
  $('#epochs-pane').addEventListener('change', e => {
    const id = e.target.dataset.epoch;
    if (!id) return;
    const s = new Set(state.filter.epochs);
    const ep = EPOCHS.find(x => x.id === id);
    if (ep?.children) {
      ep.children.forEach(c => (e.target.checked ? s.add(c.id) : s.delete(c.id)));
      s.delete(ep.id);
    } else if (e.target.checked) s.add(id); else s.delete(id);
    setFilter({ timeMode: 'epochs', epochs: [...s], yearFrom: null, yearTo: null });
  });
  $$('[data-time-mode]').forEach(b => b.addEventListener('click', () => showTimeTab(b.dataset.timeMode)));

  // свой диапазон: поля
  const onField = () => {
    const a = readYear('#year-from', '#era-from');
    const b = readYear('#year-to', '#era-to');
    if (a == null || b == null) return;
    setFilter({ timeMode: 'range', epochs: [], yearFrom: Math.min(a, b), yearTo: Math.max(a, b) });
  };
  ['#year-from', '#era-from', '#year-to', '#era-to'].forEach(s => $(s).addEventListener('change', onField));
  initDualRange();

  $$('input[name="match"]').forEach(r => r.addEventListener('change', () => setFilter({ match: r.value })));

  // культуры и находки
  $('#culture-chips').addEventListener('click', e => toggleChip(e, 'cultures', 'culture'));
  $('#find-chips').innerHTML = FIND_CATS.map(c => `<button type="button" class="chip sq" data-find="${c.id}" aria-pressed="false">${esc(c.name)} <span class="cnt" data-cnt-find="${c.id}"></span></button>`).join('');
  $('#find-chips').addEventListener('click', e => toggleChip(e, 'finds', 'find'));
  $('#culture-chips').innerHTML = db.cultures.map(c => `<button type="button" class="chip sq" data-culture="${esc(c.id)}" aria-pressed="false">${esc(c.id)} <span class="cnt" data-cnt-cult="${esc(c.id)}"></span></button>`).join('');

  // область / район
  const obls = OBLAST_ORDER.filter(o => db.oblasts.includes(o)).concat(db.oblasts.filter(o => !OBLAST_ORDER.includes(o)));
  $('#oblast-select').insertAdjacentHTML('beforeend', obls.map(o => `<option>${esc(o)}</option>`).join(''));
  $('#oblast-select').addEventListener('change', e => setFilter({ oblast: e.target.value, raion: '' }));
  $('#raion-select').addEventListener('change', e => setFilter({ raion: e.target.value }));

  // точность
  $('#acc-list').innerHTML = ACCURACY.map(a => `
    <label class="check-row"><input type="checkbox" data-acc="${a.id}"><span class="lbl">${esc(a.name)}</span><span class="cnt" data-cnt-acc="${a.id}"></span></label>`).join('');
  $('#acc-list').addEventListener('change', e => {
    const id = e.target.dataset.acc;
    if (!id) return;
    const s = new Set(state.filter.accuracy);
    e.target.checked ? s.add(id) : s.delete(id);
    setFilter({ accuracy: ACCURACY.map(a => a.id).filter(a => s.has(a)) });
  });

  // наборы
  $('#saved-sets').addEventListener('click', onSetClick);
  $('#saved-sets').addEventListener('contextmenu', e => {
    const chip = e.target.closest('[data-set]');
    if (chip) { e.preventDefault(); setMenu(+chip.dataset.set); }
  });
  store.loadSets().then(s => { sets = s; renderSets(); });

  // сворачивание
  try { if (lsGet('arch.filtersCollapsed', false) && innerWidth > 760) $('#filters').classList.add('collapsed'); } catch (e) { /* */ }
}

function toggleChip(e, key, attr) {
  const b = e.target.closest(`[data-${attr}]`);
  if (!b) return;
  const id = b.dataset[attr];
  const s = new Set(state.filter[key]);
  s.has(id) ? s.delete(id) : s.add(id);
  setFilter({ [key]: [...s] });
}

function readYear(inp, era) {
  const v = parseInt($(inp).value, 10);
  if (!v || v < 1) return null;
  return $(era).value === 'bce' ? -v : v;
}

function showTimeTab(mode) {
  $('#tab-epochs').setAttribute('aria-selected', String(mode === 'epochs'));
  $('#tab-range').setAttribute('aria-selected', String(mode === 'range'));
  $('#epochs-pane').hidden = mode !== 'epochs';
  $('#range-pane').hidden = mode !== 'range';
  showTimeTab.current = mode;
}

// двойной ползунок по нелинейной шкале
function initDualRange() {
  const box = $('#dual-range');
  const thumbs = { a: $('#dr-a'), b: $('#dr-b') };
  const current = () => {
    const f = state.filter;
    return f.timeMode === 'range' && f.yearFrom != null ? [f.yearFrom, f.yearTo] : [YEAR_MIN, YEAR_MAX];
  };
  const commit = (a, b) => setFilter({ timeMode: 'range', epochs: [], yearFrom: Math.min(a, b), yearTo: Math.max(a, b) });
  for (const [k, el] of Object.entries(thumbs)) {
    el.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      const move = e => {
        const r = box.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = roundYear(yearAt(p));
        const [a, b] = current();
        commit(k === 'a' ? y : a, k === 'b' ? y : b);
      };
      el.onpointermove = move;
      el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
    });
    el.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = (e.shiftKey ? 500 : 50) * (e.key === 'ArrowLeft' ? -1 : 1);
      let [a, b] = current();
      if (k === 'a') a = Math.max(YEAR_MIN, Math.min(b, a + step)); else b = Math.min(YEAR_MAX, Math.max(a, b + step));
      commit(a === 0 ? 1 : a, b === 0 ? 1 : b);
    });
  }
}

export function renderFilters(f, fc, counts) {
  $$('[data-type]', $('#type-list')).forEach(i => { i.checked = f.types.includes(i.dataset.type); });
  $$('[data-cnt-type]').forEach(s => { s.textContent = fmtInt(fc.types[s.dataset.cntType] || 0); });
  $$('[data-cnt-acc]').forEach(s => { s.textContent = fmtInt(fc.acc[s.dataset.cntAcc] || 0); });
  $$('[data-cnt-find]').forEach(s => { s.textContent = fmtInt(fc.finds[s.dataset.cntFind] || 0); });
  $$('[data-cnt-cult]').forEach(s => { s.textContent = fmtInt(fc.cultures[s.dataset.cntCult] || 0); });
  $$('[data-acc]', $('#acc-list')).forEach(i => { i.checked = f.accuracy.includes(i.dataset.acc); });
  $$('[data-find]').forEach(b => b.setAttribute('aria-pressed', String(f.finds.includes(b.dataset.find))));
  $$('[data-culture]').forEach(b => b.setAttribute('aria-pressed', String(f.cultures.includes(b.dataset.culture))));

  // эпохи
  const es = new Set(f.timeMode === 'epochs' ? f.epochs : []);
  $$('[data-epoch]').forEach(i => {
    const ep = EPOCHS.find(x => x.id === i.dataset.epoch);
    if (ep?.children) {
      const n = ep.children.filter(c => es.has(c.id)).length;
      i.checked = n === ep.children.length;
      i.indeterminate = n > 0 && n < ep.children.length;
    } else i.checked = es.has(i.dataset.epoch);
  });
  if (!showTimeTab.current || (f.timeMode === 'range' && f.yearFrom != null)) showTimeTab(f.timeMode);

  // поля и ползунок
  const [a, b] = f.timeMode === 'range' && f.yearFrom != null ? [f.yearFrom, f.yearTo] : [YEAR_MIN, YEAR_MAX];
  if (document.activeElement?.closest?.('.range-fields') == null) {
    $('#year-from').value = f.timeMode === 'range' && f.yearFrom != null ? Math.abs(a) : '';
    $('#era-from').value = a < 0 ? 'bce' : 'ce';
    $('#year-to').value = f.timeMode === 'range' && f.yearFrom != null ? Math.abs(b) : '';
    $('#era-to').value = b < 0 ? 'bce' : 'ce';
  }
  const pa = pos(a) * 100;
  const pb = pos(b) * 100;
  $('#dr-a').style.left = pa + '%';
  $('#dr-b').style.left = pb + '%';
  $('#dr-fill').style.left = pa + '%';
  $('#dr-fill').style.width = (pb - pa) + '%';
  $('#dr-a').setAttribute('aria-valuetext', String(a));
  $('#dr-b').setAttribute('aria-valuetext', String(b));
  $$('input[name="match"]').forEach(r => { r.checked = r.value === f.match; });

  // области
  $('#oblast-select').value = f.oblast;
  const rs = $('#raion-select');
  rs.disabled = !f.oblast;
  rs.innerHTML = '<option value="">Все районы</option>' + (f.oblast ? (db.raions[f.oblast] || []).map(r => `<option>${esc(r)}</option>`).join('') : '');
  rs.value = f.raion;

  // подвал
  $('#found-n').textContent = fmtInt(counts.total);
  $('#found-m').textContent = fmtInt(db.sites.length);
  $('#found-sub').textContent = counts.total !== counts.onMap ? `на карте ${fmtInt(counts.onMap)}, без координат ${fmtInt(counts.total - counts.onMap)}` : '';
  $('#active-count').textContent = activeCount(f);
  renderSets();
}

// ───────── сохранённые наборы ─────────
function sameSet(p) { return toParams().toString() === new URLSearchParams(p).toString(); }

function renderSets() {
  const box = $('#saved-sets');
  box.innerHTML = sets.map((s, i) => `<span class="chip ${sameSet(s.params) ? 'on' : ''}" data-set="${i}" role="button" tabindex="0">${esc(s.name)}<button type="button" class="chip-menu" data-set-menu="${i}" aria-label="Действия с набором ${esc(s.name)}">⋯</button></span>`).join('') +
    '<button type="button" class="chip dashed" data-set-new>+ Сохранить текущий</button>' +
    (state.filter.author ? `<span class="chip on">Автор: ${esc(state.filter.author)}<button type="button" class="chip-menu" data-clear-author aria-label="Убрать фильтр по автору">×</button></span>` : '');
}

async function onSetClick(e) {
  if (e.target.closest('[data-clear-author]')) { setFilter({ author: '' }); return; }
  const menu = e.target.closest('[data-set-menu]');
  if (menu) { setMenu(+menu.dataset.setMenu); return; }
  if (e.target.closest('[data-set-new]')) {
    const name = await dialog({
      title: 'Сохранить набор фильтров',
      body: '<div class="field"><label for="set-name">Название</label><input id="set-name" class="input" maxlength="60" placeholder="Например: Мой период для диссертации"></div>',
      actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', kind: 'primary', collect: d => d.querySelector('#set-name').value.trim() }],
    });
    if (!name) return;
    sets = sets.filter(s => s.name !== name).concat({ name, params: toParams().toString() });
    const ok = await store.saveSets(sets);
    toast(ok ? `Набор «${name}» сохранён` : 'Не удалось сохранить набор');
    renderSets();
    return;
  }
  const chip = e.target.closest('[data-set]');
  if (chip) {
    const s = sets[+chip.dataset.set];
    setFilter(fromParams(new URLSearchParams(s.params)));
  }
}

async function setMenu(i) {
  const s = sets[i];
  const res = await dialog({
    title: `Набор «${s.name}»`,
    body: `<div class="field"><label for="set-rename">Новое название</label><input id="set-rename" class="input" value="${esc(s.name)}" maxlength="60"></div>`,
    actions: [{ label: 'Удалить', value: 'delete' }, { label: 'Отмена', value: null }, { label: 'Переименовать', kind: 'primary', collect: d => ({ rename: d.querySelector('#set-rename').value.trim() }) }],
  });
  if (!res) return;
  if (res === 'delete') sets.splice(i, 1);
  else if (res.rename) sets[i] = { ...s, name: res.rename };
  await store.saveSets(sets);
  renderSets();
}

export function collapseFilters(on) {
  const f = $('#filters');
  if (innerWidth <= 760) { f.classList.toggle('open', !on); return; }
  f.classList.toggle('collapsed', on);
  lsSet('arch.filtersCollapsed', on);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}
