// FilterState — единственный источник правды для карты, таймлайна, счётчиков и экспорта.
// Сериализуется в query-строку URL, чтобы выборкой можно было поделиться.
import { TYPES, ACCURACY } from './const.js';

export const DEFAULTS = () => ({
  types: TYPES.map(t => t.id),
  timeMode: 'epochs', epochs: [], yearFrom: null, yearTo: null, match: 'overlap',
  finds: [], cultures: [], oblast: '', raion: '',
  accuracy: ACCURACY.map(a => a.id), author: '',
});

export const state = { filter: DEFAULTS(), site: null, edit: false };
const subs = [];
export function onChange(fn) { subs.push(fn); }
export function setFilter(patch, opts = {}) {
  Object.assign(state.filter, patch);
  subs.forEach(f => f(state.filter, opts));
  writeURL();
}
export function resetFilter() { setFilter(DEFAULTS()); }

export function activeCount(f = state.filter) {
  const d = DEFAULTS();
  let n = 0;
  if (f.types.length !== d.types.length) n++;
  if ((f.timeMode === 'epochs' && f.epochs.length) || (f.timeMode === 'range' && f.yearFrom != null)) n++;
  if (f.finds.length) n++;
  if (f.cultures.length) n++;
  if (f.oblast) n++;
  if (f.accuracy.length !== d.accuracy.length) n++;
  if (f.author) n++;
  return n;
}

export function toParams(f = state.filter) {
  const d = DEFAULTS();
  const p = new URLSearchParams();
  if (f.types.length !== d.types.length) p.set('types', f.types.join(',') || 'none');
  if (f.timeMode === 'epochs' && f.epochs.length) p.set('epochs', f.epochs.join(','));
  if (f.timeMode === 'range' && f.yearFrom != null) { p.set('from', f.yearFrom); p.set('to', f.yearTo); }
  if (f.match !== 'overlap') p.set('match', f.match);
  if (f.finds.length) p.set('finds', f.finds.join(','));
  if (f.cultures.length) p.set('cult', f.cultures.join(','));
  if (f.oblast) p.set('obl', f.oblast);
  if (f.raion) p.set('raion', f.raion);
  if (f.accuracy.length !== d.accuracy.length) p.set('acc', f.accuracy.join(',') || 'none');
  if (f.author) p.set('author', f.author);
  return p;
}

export function fromParams(p) {
  const f = DEFAULTS();
  const list = k => (p.get(k) && p.get(k) !== 'none' ? p.get(k).split(',') : []);
  if (p.has('types')) f.types = list('types');
  if (p.has('epochs')) { f.timeMode = 'epochs'; f.epochs = list('epochs'); }
  if (p.has('from') && p.has('to')) { f.timeMode = 'range'; f.yearFrom = +p.get('from'); f.yearTo = +p.get('to'); }
  if (p.get('match') === 'within') f.match = 'within';
  f.finds = list('finds');
  f.cultures = list('cult');
  f.oblast = p.get('obl') || '';
  f.raion = p.get('raion') || '';
  if (p.has('acc')) f.accuracy = list('acc');
  f.author = p.get('author') || '';
  return f;
}

let urlTimer;
export function writeURL() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    try {
      const p = toParams();
      if (state.site) p.set('site', state.site);
      if (state.viewer) { p.set('pub', state.viewer.pub); p.set('page', state.viewer.page); }
      const qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) { /* в некоторых окнах адрес менять нельзя */ }
  }, 150);
}
