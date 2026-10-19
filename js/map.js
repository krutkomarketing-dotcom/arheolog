// 3. Карта: подложки, маркеры с кластерами, легенда, линейка, координаты курсора.
/* global L */
import { TYPE, TYPES, BELARUS_BOUNDS } from './const.js';
import { $, $$, esc, fmtDist, km, lsGet, lsSet } from './util.js';
import { db } from './data.js';

export const map = {
  m: null, cluster: null, markers: new Map(), selectedId: null, layers: {}, current: null,
  onSelect: null, ruler: null, editMode: false,
};

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';

export function initMap(onSelect) {
  map.onSelect = onSelect;
  const m = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 18, worldCopyJump: false, preferCanvas: false });
  map.m = m;
  m.fitBounds(BELARUS_BOUNDS, { padding: [10, 10] });
  m.attributionControl.setPrefix('');

  map.layers.map = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: isDark() ? 'tiles-dark' : '', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">участники OpenStreetMap</a>',
  });
  map.layers.sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
  ]);
  map.layers.scheme = schemeLayer();
  watchTiles(map.layers.map);

  map.cluster = L.markerClusterGroup({
    maxClusterRadius: 50, showCoverageOnHover: false, disableClusteringAtZoom: 13, spiderfyOnMaxZoom: true, chunkedLoading: true,
    iconCreateFunction: c => {
      const n = c.getChildCount();
      const s = n < 10 ? 30 : n < 100 ? 32 : 34;
      return L.divIcon({ html: `<span>${n}</span>`, className: 'mk-cluster', iconSize: [s, s] });
    },
  });
  m.addLayer(map.cluster);

  for (const x of db.sites) createMarker(x);

  const saved = lsGet('arch.layer', 'map');
  setLayer(saved === 'hist' ? 'map' : saved);

  $$('.layer-switch [data-layer]').forEach(b => b.addEventListener('click', () => setLayer(b.dataset.layer)));
  m.on('mousemove', e => { $('#cursor-coords').textContent = `${e.latlng.lat.toFixed(3)}°, ${e.latlng.lng.toFixed(3)}°`; });
  m.on('zoomend moveend', updateScale);
  updateScale();
  buildLegend();
  m.on('click', e => { if (map.ruler) rulerClick(e.latlng); });
  return m;
}

function watchTiles(layer) {
  let ok = 0;
  let bad = 0;
  layer.on('tileload', () => { ok++; });
  layer.on('tileerror', () => { bad++; });
  setTimeout(() => {
    if (ok === 0 && bad > 0 && map.current === 'map') {
      setLayer('scheme', true);
      note('Тайлы карты здесь недоступны (превью без доступа к внешним серверам) — показана встроенная схема. На сайте работает обычная карта.');
    }
  }, 4500);
}

export function note(text, ms = 9000) {
  const n = $('#map-note');
  n.textContent = text;
  n.hidden = false;
  clearTimeout(note.t);
  note.t = setTimeout(() => { n.hidden = true; }, ms);
}

export function setLayer(id, auto = false) {
  if (id === 'hist') {
    note('Историческая подложка пока не подключена: нужно выбрать карты (открытый вопрос №7 — например, трёхвёрстка или польская WIG).');
    return;
  }
  for (const [k, l] of Object.entries(map.layers)) if (k !== id && map.m.hasLayer(l)) map.m.removeLayer(l);
  if (!map.m.hasLayer(map.layers[id])) map.layers[id].addTo(map.m);
  map.layers[id].bringToBack?.();
  map.current = id;
  $$('.layer-switch [data-layer]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.layer === id)));
  if (!auto) lsSet('arch.layer', id);
}

function schemeLayer() {
  const b = db.basemap;
  const r = L.canvas({ padding: 0.5 });
  const g = L.layerGroup();
  const land = cssVar('--map-land');
  const outside = cssVar('--map-outside');
  const border = cssVar('--map-border');
  const river = cssVar('--map-river');
  const obl = cssVar('--map-obl');
  L.geoJSON({ type: 'FeatureCollection', features: b.neighbours.map(n => ({ type: 'Feature', geometry: n.geom, properties: {} })) },
    { renderer: r, style: { color: obl, weight: 0.8, fillColor: outside, fillOpacity: 1 }, interactive: false }).addTo(g);
  L.geoJSON({ type: 'Feature', geometry: b.country }, { renderer: r, style: { color: border, weight: 1.6, fillColor: land, fillOpacity: 1 }, interactive: false }).addTo(g);
  L.geoJSON({ type: 'FeatureCollection', features: b.oblasts.map(o => ({ type: 'Feature', geometry: o.geom, properties: {} })) },
    { renderer: r, style: { color: obl, weight: 0.9, dashArray: '4 3', fill: false }, interactive: false }).addTo(g);
  L.geoJSON({ type: 'FeatureCollection', features: [...b.rivers, ...b.lakes].map(geometry => ({ type: 'Feature', geometry, properties: {} })) },
    { renderer: r, style: { color: river, weight: 0.6, fillColor: river, fillOpacity: 0.9 }, interactive: false }).addTo(g);
  for (const c of b.cities) {
    L.marker([c.lat, c.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'city-lbl', html: `<span>■ ${esc(c.name)}</span>`, iconSize: [0, 0] }) }).addTo(g);
  }
  // фон под Беларусью и вокруг, чтобы не было «пустоты» на мелких масштабах
  g.on('add', () => { $('#map').style.background = outside; });
  return g;
}

function markerHTML(x, selected = false) {
  const t = TYPE[x.type];
  const cls = ['mk', t.hollow ? 'hollow' : '', x.coords?.accuracy === 'settlement' ? 'settl' : ''].join(' ');
  return `<span class="${cls}" style="--c: var(${t.color})"></span>${selected ? `<span class="mk-label">${esc(x.name)}</span>` : ''}`;
}
function icon(x, selected = false) {
  return L.divIcon({ html: markerHTML(x, selected), className: `mk-wrap${selected ? ' selected' : ''}`, iconSize: [12, 12], iconAnchor: [6, 6] });
}

function createMarker(x) {
  if (!x.coords) return;
  const mk = L.marker(x.disp || [x.coords.lat, x.coords.lon], { icon: icon(x), keyboard: true, title: x.name, riseOnHover: true });
  mk.siteId = x.id;
  mk.on('click', () => { if (!map.ruler && !map.editMode) map.onSelect(x.id); });
  mk.on('mouseover', () => {
    if (!mk.getTooltip()) {
      mk.bindTooltip(`<b>${esc(x.name)}</b>${esc(TYPE[x.type].name)} · ${esc(x.dating.text || '')}`, { className: 'mk-tip', direction: 'top', offset: [0, -8] });
      mk.openTooltip();
    }
  });
  map.markers.set(x.id, mk);
}

export function refreshMarker(x) {
  const old = map.markers.get(x.id);
  if (old) { map.cluster.removeLayer(old); map.markers.delete(x.id); }
  createMarker(x);
  const mk = map.markers.get(x.id);
  if (mk && map.visible?.has(x.id)) map.cluster.addLayer(mk);
  if (map.selectedId === x.id && mk) mk.setIcon(icon(x, true));
}

export function showSites(list) {
  map.visible = new Set(list.map(x => x.id));
  const layers = [];
  for (const x of list) { const mk = map.markers.get(x.id); if (mk) layers.push(mk); }
  map.cluster.clearLayers();
  map.cluster.addLayers(layers);
  const onMap = layers.length;
  $('#map-empty').hidden = list.length > 0;
  return onMap;
}

export function select(id, { fly = true } = {}) {
  const prev = map.selectedId;
  if (prev && map.markers.get(prev)) map.markers.get(prev).setIcon(icon(db.byId.get(prev), false));
  map.selectedId = id;
  if (!id) return;
  const x = db.byId.get(id);
  const mk = map.markers.get(id);
  if (!mk) return;
  mk.setIcon(icon(x, true));
  mk.setZIndexOffset(1000);
  if (fly) {
    if (map.cluster.hasLayer(mk)) {
      const z = map.m.getZoom();
      const visible = map.cluster.getVisibleParent(mk) === mk;
      if (visible && map.m.getBounds().pad(-0.15).contains(mk.getLatLng())) return;
      map.m.setView(mk.getLatLng(), visible ? z : Math.max(z, 13));
    } else {
      map.m.setView(mk.getLatLng(), Math.max(map.m.getZoom(), 10));
    }
  }
}

export function zoomTo(lat, lon, z = 13) { map.m.setView([lat, lon], z); }
export function zoomAll() { map.m.fitBounds(BELARUS_BOUNDS, { padding: [10, 10] }); }

function updateScale() {
  const m = map.m;
  const y = m.getSize().y / 2;
  const a = m.containerPointToLatLng([0, y]);
  const b = m.containerPointToLatLng([60, y]);
  const meters = km([a.lat, a.lng], [b.lat, b.lng]) * 1000;
  const pow = 10 ** Math.floor(Math.log10(meters));
  const nice = [1, 2, 5, 10].map(k => k * pow).filter(v => v <= meters).pop() || pow;
  $('.scale-line').style.width = `${Math.round(60 * nice / meters)}px`;
  $('#scale-label').textContent = nice >= 1000 ? `${nice / 1000} км` : `${nice} м`;
}

function buildLegend() {
  const rows = TYPES.map(t => `<div class="lg-row"><span class="tdot ${t.hollow ? 'hollow' : ''}" style="--c: var(${t.color})"></span>${esc(t.legend)}</div>`).join('');
  $('#legend-body').innerHTML = rows +
    '<div class="lg-sep"></div><div class="lg-row"><span class="tdot dashed"></span>Координаты до нас. пункта</div>' +
    '<div class="lg-row"><span class="tdot" style="--c: var(--bg-panel); border-color: var(--cluster-ink); width:16px; height:16px; display:grid; place-items:center; font-size:9px; font-weight:600">9</span>Кластер памятников</div>';
  try { if (lsGet('arch.legendClosed', false)) $('#legend').classList.add('closed'); } catch (e) { /* */ }
}
export function toggleLegend() {
  const l = $('#legend');
  l.classList.toggle('closed');
  $('.legend-head').setAttribute('aria-expanded', String(!l.classList.contains('closed')));
  lsSet('arch.legendClosed', l.classList.contains('closed'));
}

// линейка
export function toggleRuler(btn) {
  if (map.ruler) { stopRuler(); return; }
  map.ruler = { pts: [], line: L.polyline([], { color: cssVar('--accent'), weight: 2, dashArray: '6 4' }).addTo(map.m), dots: L.layerGroup().addTo(map.m) };
  btn.setAttribute('aria-pressed', 'true');
  map.m.getContainer().style.cursor = 'crosshair';
  const tip = $('#ruler-tip');
  tip.textContent = 'Линейка: кликайте по карте. Esc — выйти';
  tip.hidden = false;
}
function rulerClick(ll) {
  const r = map.ruler;
  r.pts.push(ll);
  r.line.setLatLngs(r.pts);
  L.circleMarker(ll, { radius: 3, color: cssVar('--accent'), fillOpacity: 1 }).addTo(r.dots);
  let total = 0;
  for (let i = 1; i < r.pts.length; i++) total += km([r.pts[i - 1].lat, r.pts[i - 1].lng], [r.pts[i].lat, r.pts[i].lng]);
  $('#ruler-tip').textContent = `Расстояние: ${fmtDist(total)} · Esc — выйти`;
}
export function stopRuler() {
  if (!map.ruler) return;
  map.m.removeLayer(map.ruler.line);
  map.m.removeLayer(map.ruler.dots);
  map.ruler = null;
  map.m.getContainer().style.cursor = '';
  $('[data-action="ruler"]').setAttribute('aria-pressed', 'false');
  $('#ruler-tip').hidden = true;
}
