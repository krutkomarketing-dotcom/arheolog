// 8. Режим редактирования: перенос точки, ввод координат, точность, основание, история правок.
/* global L */
import { ACCURACY, ACC, EDIT_REASONS, TYPE } from './const.js';
import { $, esc, km, bearingName, fmtDist, parseCoords, pointInGeom, dialog, toast, fmtDateTime, nbsp } from './util.js';
import { db } from './data.js';
import { map } from './map.js';
import { store } from './store.js';

const E = { site: null, layer: null, marker: null, lat: null, lon: null, accuracy: 'exact', radius: 15, dirty: false, onDone: null };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function editing() { return !!E.site; }

export async function startEdit(id, onDone) {
  const x = db.byId.get(id);
  E.site = x; E.onDone = onDone; E.dirty = false;
  const c = x.coords;
  E.lat = c?.lat ?? null; E.lon = c?.lon ?? null;
  E.accuracy = c && c.accuracy !== 'settlement' ? c.accuracy : 'exact';
  E.radius = ACC[E.accuracy].radius;
  map.editMode = true;
  $('#edit-banner').hidden = false;
  E.layer = L.layerGroup().addTo(map.m);
  if (c) {
    const old = L.marker([c.lat, c.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: '<div class="edit-old"></div><span class="edit-old-label">было</span>', iconSize: [14, 14], iconAnchor: [7, 7] }) });
    old.addTo(E.layer);
    map.m.setView([c.lat, c.lon], 14);
  } else {
    const fallback = db.sites.find(s => s.coords && s.region.raion === x.region.raion);
    if (fallback) map.m.setView([fallback.coords.lat, fallback.coords.lon], 11);
    toast('Кликните по карте, чтобы поставить точку');
  }
  E.line = L.polyline([], { color: cssVar('--ink-muted'), weight: 1.5, dashArray: '4 4', interactive: false }).addTo(E.layer);
  E.circle = L.circle([0, 0], { radius: E.radius, color: cssVar('--accent'), weight: 1.5, dashArray: '5 4', fillOpacity: 0.06, interactive: false });
  if (E.lat != null) placeMarker(E.lat, E.lon, false);
  map.m.on('click', onMapClick);
  renderPanel();
  document.addEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (e.key === 'Escape' && $('#dialog').hidden && $('#viewer').hidden) { e.preventDefault(); cancel(); }
}

function onMapClick(e) {
  placeMarker(e.latlng.lat, e.latlng.lng, true);
}

function placeMarker(lat, lon, dirty) {
  E.lat = +lat.toFixed(5); E.lon = +lon.toFixed(5);
  if (dirty) E.dirty = true;
  const x = E.site;
  if (!E.marker) {
    E.marker = L.marker([E.lat, E.lon], {
      draggable: true, keyboard: true, title: 'Новое положение — перетащите',
      icon: L.divIcon({ className: 'mk-wrap edit-new', html: `<span class="mk" style="--c: var(${TYPE[x.type].color})"></span><span class="edit-coord-label"></span>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
    }).addTo(E.layer);
    E.marker.on('drag', ev => { const ll = ev.target.getLatLng(); E.lat = +ll.lat.toFixed(5); E.lon = +ll.lng.toFixed(5); E.dirty = true; sync(false); });
    E.circle.addTo(E.layer);
  } else {
    E.marker.setLatLng([E.lat, E.lon]);
  }
  sync(true);
}

function sync(fromCode) {
  if (E.lat == null) return;
  E.circle.setLatLng([E.lat, E.lon]).setRadius(E.radius);
  const lbl = E.marker.getElement()?.querySelector('.edit-coord-label');
  if (lbl) lbl.textContent = `${E.lat.toFixed(5)}, ${E.lon.toFixed(5)}`;
  const c = E.site.coords;
  E.line.setLatLngs(c ? [[c.lat, c.lon], [E.lat, E.lon]] : []);
  if (fromCode !== false || document.activeElement?.id !== 'ed-lat') { const i = $('#ed-lat'); if (i && document.activeElement !== i) i.value = E.lat.toFixed(5); }
  if (fromCode !== false || document.activeElement?.id !== 'ed-lon') { const i = $('#ed-lon'); if (i && document.activeElement !== i) i.value = E.lon.toFixed(5); }
  const shift = $('#ed-shift');
  if (shift) shift.innerHTML = shiftHTML();
  const warn = $('#ed-warn');
  if (warn) warn.hidden = pointInGeom(E.lat, E.lon, db.basemap.country) || nearBorder();
}

function nearBorder() {
  // буфер ~5 км: проверяем соседние точки
  const d = 0.045;
  return [[d, 0], [-d, 0], [0, d * 1.6], [0, -d * 1.6]].some(([a, b]) => pointInGeom(E.lat + a, E.lon + b, db.basemap.country));
}

function shiftHTML() {
  const c = E.site.coords;
  if (!c) return `Было: <span class="mono">не определены</span>`;
  const dist = km([c.lat, c.lon], [E.lat, E.lon]);
  return `Было: <span class="mono">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span><br>Смещение: ≈${nbsp}<b>${fmtDist(dist)}</b>${dist > 0.001 ? ` · на ${bearingName([c.lat, c.lon], [E.lat, E.lon])}` : ''}`;
}

async function renderPanel() {
  const x = E.site;
  const card = $('#card');
  card.hidden = false;
  card.innerHTML = `
  <div class="card-scroll">
    <div class="edit-pass"><div class="edit-eyebrow">Редактирование</div><h2 class="edit-name">${esc(x.name)}</h2><div class="edit-sub mono">${esc(x.code)} · ${esc(x.region.raion)}, ${esc(x.region.oblast)}</div></div>
    <div class="edit-sec"><h3>Координаты</h3>
      <div class="coord-grid">
        <div class="field"><label for="ed-lat">Широта, °</label><input id="ed-lat" class="input mono" inputmode="decimal" value="${E.lat != null ? E.lat.toFixed(5) : ''}"></div>
        <div class="field"><label for="ed-lon">Долгота, °</label><input id="ed-lon" class="input mono" inputmode="decimal" value="${E.lon != null ? E.lon.toFixed(5) : ''}"></div>
      </div>
      <div class="inset" id="ed-shift">${E.lat != null ? shiftHTML() : 'Точка не поставлена: кликните по карте или введите координаты.'}</div>
      <p class="hint">Десятичные градусы, WGS 84. Можно вставить строку вида 54°07′41″ N 27°41′41″ E.</p>
      <div class="warn-box" id="ed-warn" hidden>Точка за пределами Беларуси (с запасом 5 км). Проверьте координаты — сохранить всё равно можно.</div>
    </div>
    <div class="edit-sec"><h3>Точность координат</h3>
      <div class="segmented" role="radiogroup" aria-label="Точность">${ACCURACY.filter(a => a.id !== 'none').map(a => `<button type="button" role="radio" aria-checked="${a.id === E.accuracy}" data-acc-set="${a.id}">${a.id === 'exact' ? 'Точные' : a.id === 'approx' ? 'Примерные' : 'До нас. пункта'}</button>`).join('')}</div>
      <div class="radius-row"><label for="ed-radius">Радиус неопределённости: ±</label><input id="ed-radius" class="input mono" type="number" min="1" value="${E.radius}"> м — показан пунктиром на карте</div>
    </div>
    <div class="edit-sec"><h3>Основание правки <span class="req" aria-hidden="true">*</span></h3>
      <label class="visually-hidden" for="ed-reason">Основание правки</label>
      <select id="ed-reason" class="select" required><option value="">Выберите основание</option>${EDIT_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}</select>
      <div class="field"><label for="ed-comment">Комментарий</label><textarea id="ed-comment" class="input" placeholder="Например: центр площадки по GPS, прибор и дата"></textarea></div>
    </div>
    <div class="edit-sec"><h3>История правок</h3><ul class="hist" id="ed-hist"><li><span class="dot"></span><span class="what">Загрузка…</span></li></ul></div>
  </div>
  <div class="card-foot"><span class="lbl hint">${store.mode === 'claude' ? 'Изменения увидят все пользователи' : 'Демо: правка сохранится только в этом браузере'}</span>
    <button class="btn lg" type="button" data-action="ed-cancel">Отмена</button>
    <button class="btn lg accent" type="button" data-action="ed-save">Сохранить</button></div>`;
  if (E.lat != null) sync(true);

  card.oninput = e => {
    if (e.target.id === 'ed-lat' || e.target.id === 'ed-lon') {
      const raw = e.target.value;
      const parsed = /[°′'″"NSEWСЮВЗ]/i.test(raw) ? parseCoords(raw) : null;
      if (parsed) { placeMarker(parsed[0], parsed[1], true); $('#ed-lat').value = E.lat.toFixed(5); $('#ed-lon').value = E.lon.toFixed(5); return; }
      const lat = parseFloat($('#ed-lat').value.replace(',', '.'));
      const lon = parseFloat($('#ed-lon').value.replace(',', '.'));
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { placeMarker(lat, lon, true); map.m.panTo([lat, lon]); }
    }
    if (e.target.id === 'ed-radius') { E.radius = Math.max(1, +e.target.value || 1); E.dirty = true; if (E.lat != null) sync(true); }
    if (e.target.id === 'ed-comment') E.dirty = true;
  };
  card.onpaste = e => {
    if (e.target.id !== 'ed-lat' && e.target.id !== 'ed-lon') return;
    const txt = e.clipboardData.getData('text');
    const p = parseCoords(txt);
    if (p && (/[°′'″"]/.test(txt) || /[\s,;]/.test(txt.trim()))) {
      e.preventDefault();
      placeMarker(p[0], p[1], true);
      map.m.panTo([E.lat, E.lon]);
      $('#ed-lat').value = E.lat.toFixed(5); $('#ed-lon').value = E.lon.toFixed(5);
    }
  };
  card.onclick = e => {
    const a = e.target.closest('[data-acc-set]');
    if (a) {
      E.accuracy = a.dataset.accSet; E.radius = ACC[E.accuracy].radius; E.dirty = true;
      card.querySelectorAll('[data-acc-set]').forEach(b => b.setAttribute('aria-checked', String(b === a)));
      $('#ed-radius').value = E.radius;
      if (E.lat != null) sync(true);
    }
    if (e.target.closest('[data-action="ed-cancel"]')) cancel();
    if (e.target.closest('[data-action="ed-save"]')) save();
  };
  card.onchange = e => { if (e.target.id === 'ed-reason') E.dirty = true; };
  renderHistory();
}

async function renderHistory() {
  const x = E.site;
  const revs = await store.revisions(x.id);
  const names = await store.names(revs.map(r => r.by));
  const items = revs.slice(0, 3).map((r, i) => `<li><span class="dot"></span><span><span class="who">${i === 0 ? 'Последняя правка: ' : ''}${esc(names[r.by] || 'Коллега')}</span><br><span class="what">${esc(fmtDateTime(r.at))} · ${esc(r.summary)}${r.reason ? ' · ' + esc(r.reason) : ''}</span></span></li>`);
  items.push(`<li><span class="dot"></span><span><span class="who">Автоимпорт</span><br><span class="what">${esc(db.meta.generatedAt)} · ${x.base ? 'координаты центра нас. пункта (GeoNames/OSM)' : 'координаты не найдены'} · каталог Поболя, с. ${x.catalog.page}</span></span></li>`);
  const h = $('#ed-hist');
  if (h) h.innerHTML = items.join('') + (revs.length > 3 ? `<li><span></span><span class="hint">Всего правок: ${revs.length}</span></li>` : '');
}

async function save() {
  const reason = $('#ed-reason').value;
  if (E.lat == null) { toast('Поставьте точку на карте или введите координаты'); return; }
  if (!reason) { $('#ed-reason').focus(); toast('Укажите основание правки — без него сохранить нельзя'); return; }
  const x = E.site;
  // защита от конфликтов: запись могли изменить, пока окно было открыто
  const fresh = store.edits.get(x.id);
  if (fresh && x.edited && fresh.updatedAt !== x.edited.updatedAt) {
    toast('Запись уже изменили. Обновите карточку и повторите правку.');
    return;
  }
  const c = x.coords;
  const summary = c ? `координаты перенесены на ${fmtDist(km([c.lat, c.lon], [E.lat, E.lon]))}` : 'координаты указаны вручную';
  const btn = $('[data-action="ed-save"]');
  btn.disabled = true;
  try {
    await store.saveEdit(x.id, { lat: E.lat, lon: E.lon, accuracy: E.accuracy, accuracyM: E.radius },
      { summary, reason, comment: $('#ed-comment').value.trim(), changes: { from: c ? [c.lat, c.lon] : null, to: [E.lat, E.lon], accuracy: E.accuracy, accuracyM: E.radius } });
    toast('Сохранено');
    finish(true);
  } catch (e) {
    btn.disabled = false;
    toast('Не удалось сохранить: нет прав на правку или пропала связь');
  }
}

export async function cancel() {
  if (E.dirty) {
    const ok = await dialog({ title: 'Отменить правку?', body: '<p>Несохранённые изменения пропадут.</p>', actions: [{ label: 'Продолжить правку', value: false }, { label: 'Отменить правку', kind: 'primary', value: true }] });
    if (!ok) return;
  }
  finish(false);
}

function finish(saved) {
  map.m.off('click', onMapClick);
  if (E.layer) map.m.removeLayer(E.layer);
  document.removeEventListener('keydown', onKey, true);
  $('#edit-banner').hidden = true;
  map.editMode = false;
  const id = E.site.id;
  const done = E.onDone;
  Object.assign(E, { site: null, layer: null, marker: null, line: null, circle: null, dirty: false });
  done?.(id, saved);
}
