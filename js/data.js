// Данные и «API» прототипа: тот же контракт, что в spec/api.md, но поверх JSON-файлов.
// Когда появится сервер, этот модуль заменяется на fetch к /api/*.
import { EPOCH, YEAR_MIN, YEAR_MAX, FIND_CAT, TYPE } from './const.js';
import { norm, yearAt, esc } from './util.js';
import { store } from './store.js';

export const db = {
  meta: null, sites: [], byId: new Map(), pubs: new Map(), pageIndex: {}, basemap: null,
  oblasts: [], raions: {}, cultures: [], authors: [],
  fulltext: null, pageCache: new Map(),
};

export async function loadAll() {
  const [s, c, b] = await Promise.all([
    fetch('data/sites.json').then(r => r.json()),
    fetch('data/corpus.json').then(r => r.json()),
    fetch('data/basemap.json').then(r => r.json()),
  ]);
  db.meta = s.meta;
  db.basemap = b;
  db.pageIndex = c.pageIndex || {};
  c.publications.forEach(p => db.pubs.set(p.id, p));
  db.sites = s.sites.map(prep);
  db.sites.forEach(x => db.byId.set(x.id, x));
  applyEdits(store.edits);

  const obl = {};
  const cult = {};
  const auth = {};
  for (const x of db.sites) {
    (obl[x.region.oblast] ||= new Set()).add(x.region.raion);
    x.dating.cultures.forEach(k => { cult[k] = (cult[k] || 0) + 1; });
    x.authors.forEach(a => { (auth[a] ||= new Set()).add(x.id); });
  }
  db.oblasts = Object.keys(obl).sort();
  db.raions = Object.fromEntries(Object.entries(obl).map(([k, v]) => [k, [...v].sort()]));
  db.cultures = Object.entries(cult).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ id: k, n }));
  db.authors = Object.entries(auth).map(([name, ids]) => ({ name, ids })).sort((a, b) => b.ids.size - a.ids.size);
}

const AUTHOR_RX = /([А-ЯЁІЎ]\.\s?[А-ЯЁІЎ]\.\s?[А-ЯЁІЎ][а-яёіў'’-]{2,})/g;

function prep(x) {
  x.base = x.coords ? { ...x.coords } : null;
  x.findCats = [...new Set(x.finds.map(f => f.category))];
  x.authors = [...new Set((x.literature || []).map(r => r.text).flatMap(r => (r.match(AUTHOR_RX) || []).map(a => a.replace(/\s+/g, ' ').replace(/\.(?=[А-ЯЁ])/g, '. '))))];
  x.searchKey = norm([x.name, x.placeName, ...(x.names || []).map(n => n.name), x.code, x.catalogCode].join(' '));
  x.accuracy = x.coords ? x.coords.accuracy : 'none';
  return x;
}

// у памятников одной деревни (I, II, III…) одинаковые координаты центра —
// для карты раскладываем их по маленькому кругу (~250 м), в карточке остаются исходные
export function spreadDuplicates() {
  const groups = new Map();
  for (const x of db.sites) {
    x.disp = x.coords ? [x.coords.lat, x.coords.lon] : null;
    if (!x.coords || x.coords.accuracy !== 'settlement') continue;
    const k = x.coords.lat.toFixed(4) + ',' + x.coords.lon.toFixed(4);
    (groups.get(k) || groups.set(k, []).get(k)).push(x);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const r = 0.0022 + 0.0004 * g.length;
    g.forEach((x, i) => {
      const a = (2 * Math.PI * i) / g.length;
      x.disp = [x.coords.lat + r * Math.sin(a), x.coords.lon + (r * Math.cos(a)) / Math.cos(x.coords.lat * Math.PI / 180)];
    });
  }
}

export function applyEdits(edits) {
  for (const x of db.sites) {
    const e = edits.get(x.id);
    if (e) {
      x.coords = { lat: e.lat, lon: e.lon, accuracy: e.accuracy, accuracyM: e.accuracyM };
      x.edited = e;
      x.updatedAt = e.updatedAt;
    } else {
      x.coords = x.base ? { ...x.base } : null;
      x.edited = null;
    }
    x.accuracy = x.coords ? x.coords.accuracy : 'none';
  }
  spreadDuplicates();
}

// ───────── фильтрация ─────────

export function timeRanges(st) {
  if (st.timeMode === 'range' && st.yearFrom != null && st.yearTo != null) {
    return [[Math.min(st.yearFrom, st.yearTo), Math.max(st.yearFrom, st.yearTo)]];
  }
  if (st.timeMode === 'epochs' && st.epochs.length) {
    const rs = st.epochs.map(id => EPOCH[id]).filter(Boolean).map(e => [e.from, e.to]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of rs) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    return merged;
  }
  return null;
}

function passTime(x, ranges, match) {
  if (!ranges) return true;
  const a = x.dating.from;
  const b = x.dating.to;
  if (a == null || b == null) return false;
  return ranges.some(([f, t]) => (match === 'within' ? a >= f && b <= t : a <= t && b >= f));
}

export function filterSites(st, { except = null, noTime = false } = {}) {
  const ranges = noTime || except === 'time' ? null : timeRanges(st);
  const types = new Set(st.types);
  const acc = new Set(st.accuracy);
  const finds = new Set(st.finds);
  const cults = new Set(st.cultures);
  const author = st.author ? db.authors.find(a => a.name === st.author) : null;
  return db.sites.filter(x =>
    (except === 'types' || types.has(x.type)) &&
    (except === 'acc' || acc.has(x.accuracy)) &&
    (except === 'finds' || !finds.size || x.findCats.some(c => finds.has(c))) &&
    (except === 'cultures' || !cults.size || x.dating.cultures.some(c => cults.has(c))) &&
    (!st.oblast || x.region.oblast === st.oblast) &&
    (!st.raion || x.region.raion === st.raion) &&
    (!author || author.ids.has(x.id)) &&
    passTime(x, ranges, st.match));
}

export function facets(st) {
  const count = (list, key) => list.reduce((m, x) => {
    const v = x[key];
    if (Array.isArray(v)) v.forEach(k => { m[k] = (m[k] || 0) + 1; });
    else m[v] = (m[v] || 0) + 1;
    return m;
  }, {});
  return {
    types: count(filterSites(st, { except: 'types' }), 'type'),
    acc: count(filterSites(st, { except: 'acc' }), 'accuracy'),
    finds: count(filterSites(st, { except: 'finds' }), 'findCats'),
    cultures: filterSites(st, { except: 'cultures' }).reduce((m, x) => { x.dating.cultures.forEach(k => { m[k] = (m[k] || 0) + 1; }); return m; }, {}),
  };
}

export const BINS = 80;
export function timeline(st) {
  const list = filterSites(st, { noTime: true });
  const bins = [];
  for (let i = 0; i < BINS; i++) bins.push({ from: yearAt(i / BINS), to: yearAt((i + 1) / BINS), count: 0 });
  for (const x of list) {
    const a = x.dating.from;
    const b = x.dating.to;
    if (a == null) continue;
    for (const bin of bins) if (a <= bin.to && b >= bin.from) bin.count++;
  }
  return bins;
}

// ───────── поиск ─────────

export async function search(q, scope, limit = 5) {
  const nq = norm(q).trim();
  const groups = [];
  if (nq.length < 2) return groups;
  const want = k => scope === 'all' || scope === k;
  const rank = (key) => (key.startsWith(nq) ? 0 : key.includes(' ' + nq) ? 1 : 2);

  if (want('sites')) {
    const hits = db.sites.filter(x => x.searchKey.includes(nq)).sort((a, b) => rank(a.searchKey) - rank(b.searchKey) || a.name.localeCompare(b.name, 'ru'));
    if (hits.length) groups.push({ kind: 'site', label: 'Памятники', total: hits.length, items: hits.map(x => ({ id: x.id, title: x.name, subtitle: `${TYPE[x.type].name} · ${x.region.raion}${x.coords ? '' : ' · нет координат'}` })) });
  }
  if (want('places')) {
    const seen = new Map();
    for (const x of db.sites) {
      if (!x.coords) continue;
      const nm = x.placeName.replace(/\s*\([IVX]+\)$/, '');
      const k = norm(nm);
      if (!k.includes(nq)) continue;
      const key = k + '|' + x.region.raion;
      if (!seen.has(key)) seen.set(key, { title: `д. ${nm}`, subtitle: `${x.region.raion}, ${x.region.oblast}`, lat: x.coords.lat, lon: x.coords.lon, k });
    }
    const hits = [...seen.values()].sort((a, b) => rank(a.k) - rank(b.k));
    if (hits.length) groups.push({ kind: 'place', label: 'Населённые пункты', total: hits.length, items: hits });
  }
  if (want('finds')) {
    const hits = [];
    for (const x of db.sites) for (const f of x.finds) if (norm(f.item).includes(nq)) hits.push({ id: x.id, findId: f.id, title: f.item, subtitle: x.name });
    if (hits.length) groups.push({ kind: 'find', label: 'Находки', total: hits.length, items: hits });
  }
  if (want('authors')) {
    const hits = db.authors.filter(a => norm(a.name).includes(nq)).map(a => ({ title: a.name, subtitle: `упоминается в описаниях ${a.ids.size} памятн.`, author: a.name }));
    for (const p of db.pubs.values()) if (p.authors && norm(p.authors).includes(nq)) hits.push({ title: p.authors, subtitle: `${p.title}, ${p.year || ''}`, pub: p.id });
    if (hits.length) groups.push({ kind: 'author', label: 'Авторы', total: hits.length, items: hits });
  }
  if (want('texts')) {
    const hits = await searchTexts(nq);
    if (hits.length) groups.push({ kind: 'text', label: db.meta.variant === 'full' ? 'Тексты изданий' : 'Тексты каталога', total: hits.length, items: hits });
  }
  return groups;
}

async function searchTexts(nq) {
  if (db.meta.variant === 'full') {
    if (!db.fulltext) {
      try { db.fulltext = await fetch('data/fulltext.json').then(r => r.json()); } catch (e) { db.fulltext = []; }
    }
    const hits = [];
    for (const [pid, pdfPage, label, text] of db.fulltext) {
      const n = norm(text);
      const i = n.indexOf(nq);
      if (i < 0) continue;
      const p = db.pubs.get(pid);
      hits.push({ pub: pid, pdfPage, title: `${shortAuthor(p)}, ${p?.year || ''}, с. ${label}`, snippet: snippetAround(text, i, nq.length) });
      if (hits.length >= 400) break;
    }
    return hits;
  }
  // публичная версия: ищем по описаниям каталога
  const hits = [];
  for (const x of db.sites) {
    const n = norm(x.description);
    const i = n.indexOf(nq);
    if (i >= 0) hits.push({ id: x.id, title: x.name, snippet: snippetAround(x.description, i, nq.length) });
  }
  return hits;
}

function snippetAround(text, i, len) {
  const a = Math.max(0, i - 60);
  const b = Math.min(text.length, i + len + 80);
  return (a > 0 ? '…' : '') + esc(text.slice(a, i)) + '<mark>' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len, b)) + (b < text.length ? '…' : '');
}

export function shortAuthor(p) {
  if (!p) return '';
  if (p.authors) return p.authors.split(';')[0].replace(/,\s*/, ' ');
  return p.title.split(/[.:]/)[0];
}

// ───────── издания и страницы ─────────

export async function getPage(pubId, pdfPage) {
  const key = `${pubId}:${pdfPage}`;
  const file = db.pageIndex[key];
  if (file) {
    if (!db.pageCache.has(file)) db.pageCache.set(file, fetch(`pages/${file}`).then(r => r.json()));
    const bundle = await db.pageCache.get(file);
    const pg = bundle[pdfPage];
    if (pg) return { ...pg, pdfPage, hasScan: !!pg.img };
  }
  if (db.meta.variant === 'full') {
    if (!db.fulltext) db.fulltext = await fetch('data/fulltext.json').then(r => r.json()).catch(() => []);
    const row = db.fulltext.find(r => r[0] === pubId && r[1] === pdfPage);
    if (row) return { label: row[2], text: row[3], pdfPage, hasScan: false, hl: {} };
  }
  return null;
}

export function pagesOf(pubId) {
  const pages = Object.keys(db.pageIndex).filter(k => k.startsWith(pubId + ':')).map(k => +k.split(':')[1]);
  if (db.meta.variant === 'full' && db.fulltext) {
    db.fulltext.forEach(r => { if (r[0] === pubId) pages.push(r[1]); });
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

export function citation(pub, label, style = 'gost2018') {
  if (!pub) return '';
  const base = (pub.citationBase || '').replace(/(\S)\.\. /g, '$1. ').replace(/\s*–\s*С\.\s*[\d–-]+\.\s*$/, '').replace(/\.$/, '');
  if (style === 'bibtex') {
    const key = (pub.authors || 'anon').split(',')[0].replace(/\s/g, '') + (pub.year || '');
    return `@book{${key},\n  author = {${pub.authors || ''}},\n  title = {${pub.title}},\n  address = {${pub.place || ''}},\n  publisher = {${pub.publisher || ''}},\n  year = {${pub.year || ''}},\n  pages = {${label || ''}}\n}`;
  }
  let s = `${base}.`.replace(/\.\.+/g, '.').replace(/\.\s\./g, '.') + (label ? ` – С. ${label}.` : '');
  if (style === 'gost2003') s = s.replace(/ – /g, ' — ');
  return s;
}

// ───────── экспорт ─────────

const CSV_COLS = ['code', 'catalog_code', 'name', 'type', 'year_from', 'year_to', 'dating_text', 'lat', 'lon', 'accuracy', 'accuracy_m', 'raion', 'oblast', 'finds_count', 'mentions_count', 'catalog_page'];
export function toCSV(list) {
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = list.map(x => [x.code, x.catalogCode, x.name, x.type, x.dating.from, x.dating.to, x.dating.text, x.coords?.lat, x.coords?.lon,
    x.coords?.accuracy, x.coords?.accuracyM, x.region.raion, x.region.oblast, x.finds.length, x.mentions.length, x.catalog.page].map(q).join(';'));
  return '﻿' + [CSV_COLS.join(';'), ...rows].join('\r\n');
}
export function toGeoJSON(list) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: list.filter(x => x.coords).map(x => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x.coords.lon, x.coords.lat] },
      properties: { code: x.code, catalog_code: x.catalogCode, names: (x.names || []).map(n => `${n.name} [${n.lang}]`), periods: x.dating.periods, name: x.name, type: x.type, year_from: x.dating.from, year_to: x.dating.to, dating_text: x.dating.text,
        cultures: x.dating.cultures, accuracy: x.coords.accuracy, accuracy_m: x.coords.accuracyM, raion: x.region.raion, oblast: x.region.oblast,
        finds: x.finds.map(f => FIND_CAT[f.category]?.name), catalog_page: x.catalog.page },
    })),
  }, null, 1);
}
export { YEAR_MIN, YEAR_MAX };
