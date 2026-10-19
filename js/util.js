import { SCALE } from './const.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// нормализация для поиска: регистр, ё/е, белорусские і/ў/э
export function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/і/g, 'и').replace(/ў/g, 'у').replace(/э/g, 'е');
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const nbsp = ' ';
export function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
}
export function fmtYear(y, short = false) {
  if (y == null) return '—';
  if (y < 0) return `${fmtInt(-y)}${nbsp}до${nbsp}н.э.`;
  return short ? `${y}` : `${y}${nbsp}н.э.`;
}
export function fmtRange(a, b) {
  if (a < 0 && b < 0) return `${fmtInt(-a)} – ${fmtInt(-b)}${nbsp}до${nbsp}н.э.`;
  if (a > 0 && b > 0) return `${a} – ${b}${nbsp}н.э.`;
  return `${fmtYear(a)} – ${fmtYear(b)}`;
}

// нелинейная шкала времени
export function pos(year) {
  if (year <= SCALE[0][0]) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [y1, p1] = SCALE[i];
    const [y0, p0] = SCALE[i - 1];
    if (year <= y1) return p0 + (p1 - p0) * (year - y0) / (y1 - y0);
  }
  return 1;
}
export function yearAt(p) {
  if (p <= 0) return SCALE[0][0];
  for (let i = 1; i < SCALE.length; i++) {
    const [y1, p1] = SCALE[i];
    const [y0, p0] = SCALE[i - 1];
    if (p <= p1) return Math.round(y0 + (y1 - y0) * (p - p0) / (p1 - p0));
  }
  return SCALE[SCALE.length - 1][0];
}
export function roundYear(y) {
  const step = y < -1000 ? 500 : 50;
  let r = Math.round(y / step) * step;
  if (r === 0) r = y < 0 ? -1 : 1; // нулевого года нет
  return r;
}

export function km(a, b) {
  const R = 6371;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]);
  const dLon = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearingName(a, b) {
  const toR = d => d * Math.PI / 180;
  const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const names = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  return names[Math.round(deg / 45) % 8];
}
export function fmtDist(kmv) {
  if (kmv < 1) return `${Math.round(kmv * 1000)}${nbsp}м`;
  if (kmv < 10) return `${kmv.toFixed(2).replace('.', ',')}${nbsp}км`;
  return `${Math.round(kmv)}${nbsp}км`;
}

// «54°07′41″ N 27°41′41″ E» или «54.12830, 27.69140» → [lat, lon]
export function parseCoords(str) {
  const s = String(str).trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*[′'’]\s*)?(?:(\d+(?:\.\d+)?)\s*[″"”]\s*)?([NSEWСЮВЗ])?/gi)];
  if (dms.length >= 2) {
    const v = dms.slice(0, 2).map(m => {
      let d = +m[1] + (+(m[2] || 0)) / 60 + (+(m[3] || 0)) / 3600;
      if (/[SWЮЗ]/i.test(m[4] || '')) d = -d;
      return d;
    });
    return v;
  }
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2) return [+nums[0], +nums[1]];
  return null;
}

export function pointInGeom(lat, lon, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some(poly => {
    let inside = false;
    const ring = poly[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export async function copyText(text, btn, label = 'Скопировано') {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* ниже — запасной путь */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.textContent = ok ? label : 'Не удалось скопировать';
    setTimeout(() => { btn.innerHTML = old; }, 2000);
  } else {
    toast(ok ? label : 'Не удалось скопировать — выделите текст вручную');
  }
  return ok;
}

export function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* хранилище недоступно */ }
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// подсветка совпадений в тексте (по нормализованной строке; длина не меняется)
export function highlight(text, query) {
  const q = norm(query).trim();
  if (!q) return esc(text);
  const n = norm(text);
  let out = '';
  let i = 0;
  for (;;) {
    const j = n.indexOf(q, i);
    if (j < 0) break;
    out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>';
    i = j + q.length;
  }
  return out + esc(text.slice(i));
}

export function dialog({ title, body, actions }) {
  const d = $('#dialog');
  const bd = $('#sheet-backdrop');
  return new Promise(resolve => {
    d.innerHTML = `<h2>${esc(title)}</h2>${body}<div class="row">${actions.map((a, i) => `<button type="button" class="btn lg ${a.kind || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
    d.hidden = false; bd.hidden = false;
    const close = v => { d.hidden = true; bd.hidden = true; d.onclick = null; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    d.onclick = e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const a = actions[+b.dataset.i];
      close(a.value !== undefined ? a.value : (a.collect ? a.collect(d) : a.label));
    };
    bd.onclick = () => close(null);
    const first = d.querySelector('input, textarea, select') || d.querySelector('button.primary, button.accent') || d.querySelector('button');
    first?.focus();
  });
}
