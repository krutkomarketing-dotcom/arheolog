// 7. Просмотрщик страницы издания: скан с подсветкой, листание, выходные данные, цитирование.
import { $, esc, copyText, toast, dialog, norm, highlight, nbsp } from './util.js';
import { db, getPage, pagesOf, citation } from './data.js';
import { state, writeURL } from './state.js';
import { store } from './store.js';

const V = { pub: null, page: null, site: null, zoom: 1, style: 'gost2018', pages: [], data: null, lastFocus: null };

export function initViewer() {
  const root = $('#viewer');
  root.addEventListener('click', e => {
    if (e.target === root) close();
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'vw-close') close();
    if (a === 'vw-prev') step(-1);
    if (a === 'vw-next') step(1);
    if (a === 'vw-zoom-in') setZoom(V.zoom + 0.25);
    if (a === 'vw-zoom-out') setZoom(V.zoom - 0.25);
    const chip = e.target.closest('[data-goto]');
    if (chip) go(+chip.dataset.goto);
    if (e.target.closest('[data-action="vw-copy"]')) copyText(citation(db.pubs.get(V.pub), curLabel(), V.style), e.target.closest('button'));
    if (e.target.closest('[data-action="vw-quote"]')) copyText(quoteWithFragment(), e.target.closest('button'), 'Цитата скопирована');
    if (e.target.closest('[data-action="vw-feedback"]')) feedback();
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'cite-style') { V.style = e.target.value; renderSide(); }
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.target.matches('input, textarea, select')) {
      if (e.target.id === 'vw-page-input' && e.key === 'Enter') gotoLabel(e.target.value);
      if (e.target.id === 'vw-search' && e.key === 'Enter') searchBook(e.target.value);
      return;
    }
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'Tab') trapFocus(e);
  });
}

function trapFocus(e) {
  const f = [...$('#viewer .modal').querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export async function openViewer(pubId, pdfPage, siteId = null) {
  V.lastFocus = document.activeElement;
  V.pub = pubId; V.site = siteId; V.zoom = 1;
  const p = db.pubs.get(pubId);
  $('#viewer-title').textContent = `${p.authors ? p.authors.replace(/,\s*/, ' ') + ' ' : ''}${p.title}${p.year ? ', ' + p.year : ''}`;
  $('#viewer').hidden = false;
  $('#vw-search').value = '';
  V.pages = pagesOf(pubId);
  await go(pdfPage);
  $('#viewer .icon-btn.close').focus();
}

function close() {
  $('#viewer').hidden = true;
  state.viewer = null;
  writeURL();
  V.lastFocus?.focus?.();
}

async function go(pdfPage) {
  V.page = pdfPage;
  state.viewer = { pub: V.pub, page: pdfPage };
  writeURL();
  $('#vw-scan').innerHTML = '<div class="page-stub"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:60%"></div></div>';
  const data = await getPage(V.pub, pdfPage);
  V.data = data;
  const p = db.pubs.get(V.pub);
  const i = V.pages.indexOf(pdfPage);
  $('#vw-page-input').value = curLabel();
  $('#vw-page-total').textContent = `из ${p.pagesTotal || '?'}`;
  $('[data-action="vw-prev"]').disabled = i <= 0;
  $('[data-action="vw-next"]').disabled = i < 0 || i >= V.pages.length - 1;
  renderScan();
  renderSide();
}

function step(d) {
  const i = V.pages.indexOf(V.page);
  const j = i + d;
  if (j >= 0 && j < V.pages.length) go(V.pages[j]);
}

async function gotoLabel(label) {
  const want = String(label).trim();
  for (const pg of V.pages) {
    const d = await getPage(V.pub, pg);
    if (d && d.label === want) { go(pg); return; }
  }
  toast(db.meta.variant === 'full' ? `Страница ${want} недоступна: в базе только страницы с упоминаниями и распознанным текстом` : `Страница ${want} недоступна в публичной демо-версии`);
}

function setZoom(z) {
  V.zoom = Math.min(2.5, Math.max(0.5, z));
  $('#vw-zoom').textContent = `${Math.round(V.zoom * 100)}%`;
  renderScan();
}

function siteMention() {
  if (!V.site) return null;
  const x = db.byId.get(V.site);
  return x?.mentions.find(m => m.publicationId === V.pub && m.pdfPage === V.page) || null;
}

function renderScan() {
  const box = $('#vw-scan');
  const d = V.data;
  const m = siteMention();
  if (!d && db.meta.variant === 'full') {
    box.innerHTML = '<div class="page-stub"><h3>Страница недоступна</h3><p>Для этой страницы нет ни скана, ни распознанного текста.</p></div>';
    return;
  }
  if (!d) {
    box.innerHTML = stubHTML(m);
    return;
  }
  if (d.hasScan) {
    const base = Math.min(760, box.clientWidth - 48);
    const w = Math.round(base * V.zoom);
    const rects = m?.word && d.hl[m.word] ? d.hl[m.word] : Object.values(d.hl || {}).flat();
    box.innerHTML = `<div class="page-img" style="width:${w}px"><img src="${d.img}" alt="Скан страницы ${esc(d.label)}" width="${d.w}" height="${d.h}">
      ${rects.map(([x, y, rw, rh]) => `<span class="hl-box" style="left:${x * 100}%; top:${y * 100}%; width:${rw * 100}%; height:${rh * 100}%"></span>`).join('')}</div>`;
    const first = box.querySelector('.hl-box');
    if (first) setTimeout(() => first.scrollIntoView({ block: 'center', behavior: 'instant' }), 30);
  } else if (d.text) {
    box.innerHTML = `<div class="page-text">${m?.word ? highlight(d.text, m.word) : esc(d.text)}</div>`;
  } else {
    box.innerHTML = stubHTML(m);
  }
}

function stubHTML(m) {
  const snip = m ? m.snippet : '';
  return `<div class="page-stub"><h3>Скан недоступен в публичной демо-версии</h3>
    <p><span class="badge warn">временная заглушка</span></p>
    <p>Здесь будет страница издания с подсветкой найденного места. В закрытой версии для участников проекта сканы показываются целиком.</p>
    ${snip ? `<p class="quote small" style="margin-top:12px">${m.hit[1] > m.hit[0] ? esc(snip.slice(0, m.hit[0])) + '<mark>' + esc(snip.slice(m.hit[0], m.hit[1])) + '</mark>' + esc(snip.slice(m.hit[1])) : esc(snip)}</p>` : ''}</div>`;
}

function curLabel() {
  return V.data?.label || (siteMention() ? String(siteMention().page) : '');
}

function renderSide() {
  const p = db.pubs.get(V.pub);
  const d = V.data;
  const label = curLabel();
  const sitePages = V.site ? db.byId.get(V.site).mentions.filter(m => m.publicationId === V.pub) : [];
  const m = siteMention();
  const cit = citation(p, label, V.style);
  $('#vw-side').innerHTML = `
    <section><h3 class="sec-label">Выходные данные</h3>
      <dl class="kv">
        ${p.authors ? `<dt>Автор</dt><dd>${esc(p.authors.replace(/,\s*/, ' '))}</dd>` : ''}
        <dt>Название</dt><dd>${esc(p.title)}</dd>
        ${p.place || p.publisher ? `<dt>Выходные</dt><dd>${esc([p.place, p.publisher].filter(Boolean).join(' : '))}${p.year ? ', ' + p.year : ''}</dd>` : ''}
        ${p.pagesTotal ? `<dt>Объём</dt><dd>${p.pagesTotal}${nbsp}с.</dd>` : ''}
        <dt>Скан</dt><dd>${esc(p.scanSource || '—')}${d && !d.hasScan && !d.text ? ' · <span class="badge warn">не показывается в демо</span>' : ''}</dd>
      </dl></section>
    ${sitePages.length ? `<section><h3 class="sec-label">Памятник в этой книге</h3>
      <div class="chips">${sitePages.map(s => `<button type="button" class="chip sq mono ${s.pdfPage === V.page ? 'on' : ''}" data-goto="${s.pdfPage}">с.${nbsp}${esc(String(s.page))}</button>`).join('')}</div></section>` : ''}
    <section>
      <div class="cite-head"><h3 class="sec-label">Цитирование</h3>
        <label class="visually-hidden" for="cite-style">Формат</label>
        <select id="cite-style" class="select"><option value="gost2018" ${V.style === 'gost2018' ? 'selected' : ''}>ГОСТ Р 7.0.100–2018</option><option value="gost2003" ${V.style === 'gost2003' ? 'selected' : ''}>ГОСТ 7.1–2003</option><option value="bibtex" ${V.style === 'bibtex' ? 'selected' : ''}>BibTeX</option></select></div>
      <div class="cite-box" ${V.style === 'bibtex' ? 'style="font-family:var(--font-mono); font-size:12px; white-space:pre-wrap"' : ''}>${esc(cit)}</div>
      <div class="cite-actions">
        <button class="btn primary" type="button" data-action="vw-copy">Скопировать ссылку (ГОСТ)</button>
        <button class="btn" type="button" data-action="vw-quote" ${m ? '' : 'disabled'}>Цитата с фрагментом</button>
      </div>
    </section>
    ${m || d?.text ? `<section><h3 class="sec-label">Распознанный текст</h3>
      <p class="quote small">${esc(m ? m.snippet : d.text.slice(0, 400) + '…')}</p>
      <button class="link" type="button" data-action="vw-feedback">Сообщить об ошибке распознавания</button></section>` : ''}
    <section id="vw-found" hidden></section>`;
}

function quoteWithFragment() {
  const m = siteMention();
  const p = db.pubs.get(V.pub);
  if (!m) return citation(p, curLabel(), V.style);
  const frag = m.snippet.replace(/^…|…$/g, '').trim();
  return `«${frag}» (${citation(p, curLabel(), V.style)})`;
}

async function feedback() {
  const msg = await dialog({
    title: 'Ошибка распознавания',
    body: `<p>Страница ${esc(curLabel() || '')}. Опишите, что распознано неверно — мы поправим текст.</p><textarea id="fb-text" class="input" placeholder="Например: «Г омеле» вместо «Гомеле»"></textarea>`,
    actions: [{ label: 'Отмена', value: null }, { label: 'Отправить', kind: 'primary', collect: d => d.querySelector('#fb-text').value.trim() }],
  });
  if (!msg) return;
  const ok = await store.feedback({ kind: 'ocr_error', publicationId: V.pub, page: V.page, siteId: V.site, message: msg });
  toast(ok ? (store.mode === 'claude' ? 'Спасибо, сообщение сохранено' : 'Сохранено в этом браузере (в демо сообщения не уходят на сервер)') : 'Не удалось сохранить сообщение');
}

async function searchBook(q) {
  const nq = norm(q).trim();
  const box = $('#vw-found');
  if (nq.length < 2) { box.hidden = true; return; }
  const hits = [];
  for (const pg of V.pages) {
    const d = await getPage(V.pub, pg);
    if (d?.text && norm(d.text).includes(nq)) hits.push({ pg, label: d.label });
  }
  box.hidden = false;
  box.innerHTML = `<h3 class="sec-label">Найдено в книге</h3>${hits.length ? `<div class="chips">${hits.map(h => `<button class="chip sq mono" type="button" data-goto="${h.pg}">с.${nbsp}${esc(h.label)}</button>`).join('')}</div>` : `<p class="empty-note">${db.meta.variant === 'full' ? 'Ничего не найдено на доступных страницах.' : 'Поиск по тексту книги недоступен в публичной демо-версии.'}</p>`}`;
  box.scrollIntoView({ block: 'nearest' });
}
