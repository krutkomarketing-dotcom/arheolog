// 5. Карточка памятника: паспорт, описание, находки, упоминания, литература, экспорт.
import { TYPE, ACC, EPOCH } from './const.js';
import { $, esc, fmtInt, copyText, fmtDateTime, nbsp } from './util.js';
import { db, citation, shortAuthor, toCSV, toGeoJSON, filterSites } from './data.js';
import { state } from './state.js';
import { store } from './store.js';

const LIMIT = { finds: 6, mentions: 4 };

export function renderCard(id, { scrollToFind = null } = {}) {
  const card = $('#card');
  const x = db.byId.get(id);
  if (!x) {
    card.hidden = false;
    card.innerHTML = '<div class="card-pass"><p class="empty-note">Памятник не найден или удалён.</p><button class="btn" data-action="close-card">Закрыть</button></div>';
    return;
  }
  card.hidden = false;
  const t = TYPE[x.type];
  const c = x.coords;
  const acc = c ? ACC[c.accuracy] : null;
  const accText = c ? `${acc.badge} · ±${c.accuracyM >= 1000 ? (c.accuracyM / 1000).toString().replace('.', ',') + nbsp + 'км' : c.accuracyM + nbsp + 'м'}` : '';
  const coordsStr = c ? `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}` : '';
  const gmaps = c ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : '';
  const ymaps = c ? `https://yandex.ru/maps/?pt=${c.lon},${c.lat}&z=14&l=map` : '';
  const geoNote = { district: 'GeoNames', oblast: 'GeoNames', fuzzy: 'GeoNames (близкое написание)', osm: 'OpenStreetMap' }[x.geocode?.method] || '';

  const finds = x.finds.slice(0, card.dataset.allFinds === String(id) ? 999 : LIMIT.finds);
  const ments = x.mentions.slice(0, card.dataset.allMents === String(id) ? 999 : LIMIT.mentions);

  const tab = card.dataset.tabSite === String(id) ? card.dataset.tab : 'desc';
  const lit = x.literature || [];
  const pubs = lit.filter(r => r.kind === 'pub');
  const arch = lit.filter(r => r.kind === 'archive');
  const LANG = { ru: 'рус.', be: 'бел.', pl: 'пол.', lat: 'лат.' };
  const KIND = { catalog: 'в каталоге', official: 'официальное', folk: 'урочище', translit: 'транслит.' };
  const names = (x.names || []).slice(1);
  const periods = (x.dating.periods || []).map(pid => EPOCH[pid]?.name).filter(Boolean);
  const tabs = [['desc', 'Описание', null], ['finds', 'Находки', x.finds.length], ['lit', 'Литература', x.mentions.length + pubs.length], ['arch', 'Архивы', arch.length]];

  card.innerHTML = `
  <div class="card-scroll">
    <div class="card-pass">
      <div class="card-top"><span class="tdot ${t.hollow ? 'hollow' : ''}" style="--c: var(${t.color})"></span>${esc(t.name)} <button class="code coords-btn" type="button" data-copy="${esc(x.code)}" title="Шифр памятника — скопировать">${esc(x.code)}</button>
        <button class="icon-btn small ghost" type="button" data-action="close-card" aria-label="Закрыть карточку"><svg class="ico" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
      <h2 class="card-name">${esc(x.name)}</h2>
      ${names.length ? `<p class="card-also">Также: ${names.map(n => `${esc(n.name)} <span class="lang" title="${esc(n.note)}">${LANG[n.lang] || n.lang}${n.kind === 'folk' ? ', урочище' : ''}</span>`).join(', ')}</p>` : ''}
      <dl class="kv">
        <dt>Датировка</dt><dd>${esc(x.dating.text || 'не датирован')}
          ${periods.length ? `<span class="sub period-chips">${periods.map(p => `<span class="badge settlement">${esc(p)}</span>`).join(' ')}</span>` : ''}
          <span class="sub">${x.dating.cultures.length ? 'культура: ' + esc(x.dating.cultures.join('; ')) : ''}</span>
          <span class="sub"><span class="badge auto">${esc(x.dating.source)}</span></span></dd>
        <dt>Координаты</dt><dd>${c ? `<button class="coords-btn" type="button" data-copy="${coordsStr}" title="Скопировать координаты">${coordsStr}</button> <span class="badge ${c.accuracy}">${esc(accText)}</span>
          <span class="sub">${x.edited ? 'уточнены вручную' : x.geocode?.offset ? `сдвинуто от центра нас. пункта по описанию: «${esc(x.geocode.offset.phrase)}»` : `центр нас. пункта${geoNote ? ', ' + geoNote : ''} — сам памятник может быть в стороне`}</span>
          <span class="sub"><a class="link" href="${gmaps}" target="_blank" rel="noopener">Открыть в Google Картах</a> · <a class="link" href="${ymaps}" target="_blank" rel="noopener">Яндекс</a></span>`
          : `<span class="badge warn">не определены</span><span class="sub">деревня не найдена в справочниках${store.user.isAdmin ? ' — можно указать вручную в режиме редактирования' : ''}</span>`}</dd>
        <dt>Местоположение</dt><dd>${esc(x.locationText)}<span class="sub">${esc(x.region.raion)}, ${esc(x.region.oblast)}</span></dd>
        <dt>Каталог</dt><dd>Поболь 1983, № ${x.catalog.num}${x.catalog.numTo ? '–' + x.catalog.numTo : ''}, с. ${x.catalog.page}<span class="sub mono">${esc(x.catalogCode || '')}</span></dd>
        <dt>Охранный статус</dt><dd class="muted">нет данных</dd>
      </dl>
    </div>

    <div class="card-tabs" role="tablist" aria-label="Разделы карточки">${tabs.map(([k, label, n]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-card-tab="${k}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>

    ${tab === 'desc' ? `<section class="card-sec">
      <div class="card-sec-head"><h3>Описание в каталоге</h3><span class="muted mono">${x.catalog.mapNum ? 'на карте Поболя № ' + x.catalog.mapNum : ''}</span></div>
      <p class="quote small">${esc(x.description)}</p>
      <p class="quote-note">Поболь Л. Д., 1983, с. ${x.catalog.page}${x.descriptionTruncated ? ' · <b>сокращено</b> в публичной демо-версии' : ''} · текст распознан автоматически</p>
    </section>` : ''}

    ${tab === 'finds' ? `<section class="card-sec" id="finds-sec">
      <div class="card-sec-head"><h3>Находки <span class="n">· ${Math.min(finds.length, x.finds.length)} из ${x.finds.length}</span></h3>
        ${x.finds.length > LIMIT.finds ? `<button class="link" type="button" data-action="all-finds">${card.dataset.allFinds === String(id) ? 'Свернуть' : 'Все находки'}</button>` : ''}</div>
      ${x.finds.length ? `<div class="list-box">${finds.map(f => `
        <div class="find-row" id="find-${f.id}"><div class="find-top"><b>${esc(f.item)}</b>${f.excavationYear ? `<span class="yr">${f.excavationYear}</span>` : ''}</div>
        <div class="find-sub">${esc([f.categoryName, f.material, f.researcher].filter(Boolean).join(' · '))}</div></div>`).join('')}</div>
        <p class="quote-note">Выделено из описания автоматически, требует проверки.</p>` : '<p class="empty-note">Находки не описаны.</p>'}
    </section>` : ''}

    ${tab === 'lit' ? `<section class="card-sec">
      <div class="card-sec-head"><h3>Оцифрованные издания <span class="n">· ${x.mentions.length}</span></h3>
        ${x.mentions.length > LIMIT.mentions ? `<button class="link" type="button" data-action="all-mentions">Все упоминания</button>` : ''}</div>
      ${ments.map(m => mentionHTML(m)).join('') || '<p class="empty-note">Упоминаний пока нет.</p>'}
    </section>
    <section class="card-sec">
      <div class="card-sec-head"><h3>Библиография по каталогу <span class="n">· ${pubs.length}</span></h3></div>
      ${pubs.length ? `<ol class="refs">${pubs.map(r => `<li>${r.author ? `<b>${esc(r.author)}</b>${r.year ? ', ' + esc(r.year) : ''} — ` : ''}${esc(r.text)}</li>`).join('')}</ol>
      <p class="quote-note">Ссылки, которые приводит Поболь. Привязка к оцифрованным книгам — следующий этап.</p>` : '<p class="empty-note">Поболь не приводит литературы для этого памятника.</p>'}
    </section>` : ''}

    ${tab === 'arch' ? `<section class="card-sec">
      <div class="card-sec-head"><h3>Архивы, отчёты, коллекции <span class="n">· ${arch.length}</span></h3></div>
      ${arch.length ? `<ol class="refs">${arch.map(r => `<li>${r.author ? `<b>${esc(r.author)}</b>${r.year ? ', ' + esc(r.year) : ''} — ` : ''}${esc(r.text)}</li>`).join('')}</ol>
      <p class="quote-note">Полевые отчёты, архивные фонды и музейные коллекции по каталогу Поболя.</p>` : '<p class="empty-note">Архивных ссылок нет.</p>'}
    </section>` : ''}

    <section class="card-sec"><p class="hint">Обновлено ${esc(fmtDateTime(x.updatedAt))}${x.edited ? ' · координаты правились вручную' : ' · автоимпорт'}</p></section>
  </div>
  <div class="card-foot">
    <span class="lbl">Экспорт</span>
    <button class="btn" type="button" data-export="csv">CSV</button>
    <button class="btn" type="button" data-export="geojson">GeoJSON</button>
    <button class="btn primary" type="button" data-export="selection">Выборка (${fmtInt(filterSites(state.filter).length)})</button>
  </div>`;

  if (scrollToFind && tab !== 'finds') {
    card.dataset.tab = 'finds'; card.dataset.tabSite = String(id);
    renderCard(id, { scrollToFind });
    return;
  }
  if (scrollToFind) {
    const el = card.querySelector(`#find-${scrollToFind}`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.style.background = 'var(--accent-bg)'; }
  } else {
    card.querySelector('.card-scroll').scrollTop = 0;
  }
}

function mentionHTML(m) {
  const p = db.pubs.get(m.publicationId);
  const [a, b] = m.hit;
  const sn = m.snippet;
  const snHTML = b > a ? esc(sn.slice(0, a)) + '<mark>' + esc(sn.slice(a, b)) + '</mark>' + esc(sn.slice(b)) : esc(sn);
  const src = [p.place && p.publisher ? `${p.place} : ${p.publisher}` : p.place || p.publisher].filter(Boolean).join('');
  return `<article class="mention">
    <div class="mention-top"><b>${esc(shortAuthor(p))}</b><span class="yr">${p.year || ''} · с.${nbsp}${esc(String(m.page))}</span></div>
    <div class="mention-src">${esc(p.title)}${src ? ' // ' + esc(src) : ''}</div>
    <p class="quote">${snHTML}</p>
    ${m.verified ? '' : '<span class="badge warn">требует проверки</span>'}
    <div class="mention-actions">
      <button class="btn outline" type="button" data-open-page="${m.publicationId}:${m.pdfPage}"><svg class="ico" viewBox="0 0 16 16"><path d="M2 3.5h4.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H2zM14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14z"/></svg>Открыть страницу</button>
      <button class="btn" type="button" data-cite="${m.publicationId}:${esc(String(m.page))}">Скопировать ссылку (ГОСТ)</button>
    </div>
  </article>`;
}

export function cardClick(e, onOpenPage) {
  const id = state.site;
  const t = e.target;
  const copyBtn = t.closest('[data-copy]');
  if (copyBtn) { copyText(copyBtn.dataset.copy, null, 'Координаты скопированы'); return true; }
  const cite = t.closest('[data-cite]');
  if (cite) {
    const [pid, label] = cite.dataset.cite.split(':');
    copyText(citation(db.pubs.get(+pid), label), cite);
    return true;
  }
  const open = t.closest('[data-open-page]');
  if (open) { const [pid, pg] = open.dataset.openPage.split(':').map(Number); onOpenPage(pid, pg, id); return true; }
  const tabBtn = t.closest('[data-card-tab]');
  if (tabBtn) {
    const c = $('#card');
    c.dataset.tab = tabBtn.dataset.cardTab;
    c.dataset.tabSite = String(id);
    renderCard(id);
    c.querySelector(`[data-card-tab="${tabBtn.dataset.cardTab}"]`)?.focus();
    return true;
  }
  if (t.closest('[data-action="all-finds"]')) {
    const c = $('#card');
    c.dataset.allFinds = c.dataset.allFinds === String(id) ? '' : String(id);
    renderCard(id); $('#finds-sec')?.scrollIntoView({ block: 'start' });
    return true;
  }
  if (t.closest('[data-action="all-mentions"]')) { $('#card').dataset.allMents = String(id); renderCard(id); return true; }
  const ex = t.closest('[data-export]');
  if (ex) {
    const kind = ex.dataset.export;
    const x = db.byId.get(id);
    if (kind === 'csv') store.download(`${x.code}.csv`, toCSV([x]), 'text/csv');
    if (kind === 'geojson') store.download(`${x.code}.geojson`, toGeoJSON([x]), 'application/geo+json');
    if (kind === 'selection') exportSelection();
    return true;
  }
  return false;
}

export async function exportSelection() {
  const list = filterSites(state.filter);
  const fmt = await import('./util.js').then(u => u.dialog({
    title: `Экспорт выборки · ${fmtInt(list.length)} памятников`,
    body: '<p>CSV открывается в Excel (разделитель «;», UTF-8). GeoJSON — для QGIS и других ГИС; памятники без координат в него не попадают.</p>',
    actions: [{ label: 'Отмена', value: null }, { label: 'GeoJSON', value: 'geojson' }, { label: 'CSV', kind: 'primary', value: 'csv' }],
  }));
  if (fmt === 'csv') store.download('vyborka.csv', toCSV(list), 'text/csv');
  if (fmt === 'geojson') store.download('vyborka.geojson', toGeoJSON(list), 'application/geo+json');
}
