// 1 / 6. Глобальный поиск в шапке: группы результатов, клавиатура, «/».
import { $, $$, esc, debounce, fmtInt } from './util.js';
import { search } from './data.js';

let groups = [];
let expanded = null;
let handlers = {};

export function initSearch(h) {
  handlers = h;
  const input = $('#search-input');
  const box = $('#search-results');
  const run = debounce(async () => {
    const q = input.value;
    if (q.trim().length < 2) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="sr-empty"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:60%"></div></div>';
    try {
      groups = await search(q, $('#search-scope').value);
      expanded = null;
      render(q);
    } catch (e) {
      box.innerHTML = '<div class="sr-empty">Поиск не сработал. Попробуйте ещё раз.</div>';
    }
  }, 200);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  $('#search-scope').addEventListener('change', run);
  input.addEventListener('keydown', e => {
    const items = $$('.sr-item', box);
    let i = items.findIndex(el => el.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items[i]) items[i].setAttribute('aria-selected', 'false');
      i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items[i]?.setAttribute('aria-selected', 'true');
      items[i]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && items.length) { e.preventDefault(); (items[i] || items[0]).click(); }
    if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
  box.addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) { expanded = more.dataset.more; render(input.value); return; }
    const it = e.target.closest('.sr-item');
    if (!it) return;
    const g = groups[+it.dataset.g];
    const item = g.items[+it.dataset.i];
    box.hidden = true;
    pick(g.kind, item);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.matches('input, textarea, select, [contenteditable]')) { e.preventDefault(); input.focus(); input.select(); }
  });
}

function render(q) {
  const box = $('#search-results');
  if (!groups.length) {
    box.innerHTML = '<div class="sr-empty">Ничего не найдено. Проверьте написание или ищите по деревне.</div>';
    return;
  }
  box.innerHTML = groups.map((g, gi) => {
    const n = expanded === g.kind ? 60 : 5;
    return `<div class="sr-group"><div class="sr-head"><span class="sec-label">${esc(g.label)}</span><span class="muted mono">${fmtInt(g.total)}</span></div>
      ${g.items.slice(0, n).map((it, i) => `<button type="button" class="sr-item" role="option" data-g="${gi}" data-i="${i}">
        <span class="sr-title">${esc(it.title)}</span>${it.subtitle ? `<span class="sr-sub">${esc(it.subtitle)}</span>` : ''}${it.snippet ? `<span class="sr-snip">${it.snippet}</span>` : ''}</button>`).join('')}
      ${g.total > n ? `<button type="button" class="sr-more" data-more="${g.kind}">Показать все ${fmtInt(Math.min(g.total, 60))}${g.total > 60 ? ' из ' + fmtInt(g.total) : ''}</button>` : ''}</div>`;
  }).join('');
}

function pick(kind, it) {
  if (kind === 'site') handlers.site(it.id);
  if (kind === 'place') handlers.place(it.lat, it.lon);
  if (kind === 'find') handlers.site(it.id, { scrollToFind: it.findId });
  if (kind === 'author') it.author ? handlers.author(it.author) : handlers.page(it.pub, null);
  if (kind === 'text') it.pub ? handlers.page(it.pub, it.pdfPage) : handlers.site(it.id);
}
