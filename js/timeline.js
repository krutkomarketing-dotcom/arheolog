// 4. Таймлайн: гистограмма по нелинейной шкале, выделение диапазона мышью, полоса эпох.
import { TIMELINE_EPOCHS, EPOCH } from './const.js';
import { $, $$, esc, pos, yearAt, roundYear, fmtRange, fmtInt } from './util.js';
import { state, setFilter } from './state.js';
import { timeline, timeRanges, BINS } from './data.js';

const AXIS = [-10000, -2000, -1000, 0, 500, 1000, 1500, 1800];

export function initTimeline() {
  $('#tl-epochs').innerHTML = TIMELINE_EPOCHS.map(e => {
    const a = pos(e.from) * 100;
    const w = (pos(e.to) - pos(e.from)) * 100;
    return `<span class="tl-epoch" style="left:${a}%; width:${w}%" data-epochs="${e.select.join(',')}" title="Двойной клик — выделить эпоху">${esc(e.label)}</span>`;
  }).join('');
  $('#tl-axis').innerHTML = AXIS.map((y, i) => `<span style="left:${pos(y) * 100}%">${y < 0 ? fmtInt(-y) + (i === 0 ? ' до н.э.' : '') : y}${i === AXIS.length - 1 ? ' н.э.' : ''}</span>`).join('');
  $('#tl-axis span:first-child').style.transform = 'none';
  $('#tl-axis span:last-child').style.transform = 'translateX(-100%)';
  $('#tl-bars').insertAdjacentHTML('afterbegin', Array.from({ length: BINS }, (_, i) => `<span class="tl-bar" data-i="${i}"></span>`).join(''));

  $('#tl-epochs').addEventListener('dblclick', e => {
    const el = e.target.closest('[data-epochs]');
    if (!el) return;
    const ids = el.dataset.epochs.split(',');
    const a = Math.min(...ids.map(id => EPOCH[id].from));
    const b = Math.max(...ids.map(id => EPOCH[id].to));
    setFilter({ timeMode: 'range', epochs: [], yearFrom: a, yearTo: b });
  });

  // протянуть мышью / тянуть ручки
  const bars = $('#tl-bars');
  const toYear = x => {
    const r = bars.getBoundingClientRect();
    return roundYear(yearAt(Math.min(1, Math.max(0, (x - r.left) / r.width))));
  };
  bars.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const h = ev.target.dataset?.h;
    const f = state.filter;
    let anchor;
    if (h && f.yearFrom != null) anchor = h === 'a' ? f.yearTo : f.yearFrom;
    else anchor = toYear(ev.clientX);
    bars.setPointerCapture(ev.pointerId);
    const move = e => {
      const y = toYear(e.clientX);
      setFilter({ timeMode: 'range', epochs: [], yearFrom: Math.min(anchor, y), yearTo: Math.max(anchor, y) }, { live: true });
    };
    move(ev);
    bars.onpointermove = move;
    bars.onpointerup = () => { bars.onpointermove = null; bars.onpointerup = null; setFilter({}, {}); };
  });
  bars.addEventListener('keydown', e => {
    const f = state.filter;
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || f.yearFrom == null) return;
    e.preventDefault();
    const d = (e.shiftKey ? 500 : 50) * (e.key === 'ArrowLeft' ? -1 : 1);
    setFilter({ yearFrom: f.yearFrom + d, yearTo: f.yearTo + d });
  });
}

export function renderTimeline(f, total) {
  const bins = timeline(f);
  const max = Math.max(1, ...bins.map(b => b.count));
  const ranges = timeRanges(f);
  const els = $$('.tl-bar');
  bins.forEach((b, i) => {
    const el = els[i];
    el.style.height = `${Math.max(2, Math.round((b.count / max) * 100))}%`;
    el.classList.toggle('on', !!ranges && ranges.some(([x, y]) => b.from <= y && b.to >= x));
    el.title = `${fmtRange(b.from, b.to)}: ${b.count}`;
  });
  $('#tl-bars').classList.toggle('has-sel', !!ranges);
  const box = $('#tl-selbox');
  if (ranges) {
    const a = Math.min(...ranges.map(r => r[0]));
    const b = Math.max(...ranges.map(r => r[1]));
    box.hidden = false;
    box.style.left = `${pos(a) * 100}%`;
    box.style.width = `${(pos(b) - pos(a)) * 100}%`;
    $('#tl-sel').innerHTML = `Выделено: <b>${esc(fmtRange(a, b))}</b> · ${fmtInt(total)} памятников`;
    $('#tl-clear').hidden = false;
  } else {
    box.hidden = true;
    $('#tl-sel').textContent = '';
    $('#tl-clear').hidden = true;
  }
}
