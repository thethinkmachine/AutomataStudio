// ══════════════════════════════════════════════════════════════════
//  THE COMPLEXITY SECTION — the profile, charted
// ══════════════════════════════════════════════════════════════════
//  A right-panel section (`rp-complexity`), and like the space-time one it
//  is built to be pulled out into a window. js/complexity.js runs and
//  measures; this chooses the inputs, keeps the page responsive while dozens
//  of runs go by, and draws two small charts: steps against n, and space
//  against n.
//
//  Two charts rather than one with two axes. Steps and cells are different
//  quantities on different scales, and a chart with a second y-axis invites
//  reading the crossing point of two lines as meaning something.
//
//  Each chart is worst case (solid, the thing a bound is about) and mean
//  (dashed, how the typical input fares), with the growth read off the
//  worst case beside the title. A point is a word: hover names it, clicking
//  runs it and opens its space-time diagram — the curve and the computation
//  behind any point on it are one click apart.
//
//  SVG, built fresh per render: a profile is a few dozen points and the
//  colours come from classes, so a theme change needs nothing from here.
//  Listeners are attached at creation; nothing is in bridge.js.
// ══════════════════════════════════════════════════════════════════

import { $, App } from './state.js';
import { showStatus } from './utils.js';
import { growthEstimate, inputSymbols, parseFamily, profileCSV, profileInputs, profileRun } from './complexity.js';
import { machineGuards, parseMachineInput } from './machines/index.js';
import { openSpaceTime, spaceTimeKind } from './spacetime-ui.js';
import { runSim } from './simulation.js';
import { syncPanelEmpty } from './panel-float.js';
import { exportBaseName, exportCopyText, exportDownload } from './export-core.js';
import { Change, subscribe } from './store.js';
import { setSectionStatus } from './section-status.js';

export const COMPLEXITY_SECTION = 'rp-complexity';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TICK_MS = 12;
const MAX_N = 40;

let built = false;
let els = null;

const plan = { mode: 'all', pattern: '', from: 1, to: 8, cap: 32 };

// The profile on screen: its rows, what it was of, and whether it still is.
let rows = [];
let ranFor = null;
let stale = false;
let running = null;
let focusN = null;

/** Test hook: all of this is module state. */
export function resetComplexity() {
  if (running) { clearTimeout(running.timer); running = null; }
  watching = false;
  built = false; els = null; rows = []; ranFor = null; stale = false; focusN = null;
  Object.assign(plan, { mode: 'all', pattern: '', from: 1, to: 8, cap: 32 });
}

/** Tapes and stores have runs worth profiling; a search's branch count is not a run length. */
function profileKind(m = App.machine) {
  const k = spaceTimeKind(m);
  return k === 'tape' || k === 'store' ? k : null;
}

const spaceName = kind => (kind === 'store' ? 'store height' : 'cells visited');

// ══════════════════════════════════════════════════════════════════
//  BUILDING
// ══════════════════════════════════════════════════════════════════

/** Empty a node — a hot reload may have left an earlier copy's content. */
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function numberInput(key, value, label, min, max) {
  const wrap = el('label', 'cx-num-lbl');
  wrap.append(document.createTextNode(label));
  const inp = el('input', 'inp cx-num');
  inp.type = 'number';
  inp.min = String(min);
  inp.max = String(max);
  inp.value = String(value);
  inp.dataset.cx = key;
  inp.setAttribute('aria-label', label.trim() || key);
  wrap.appendChild(inp);
  return { wrap, inp };
}

function ensureBuilt() {
  if (built) return !!els;
  const body = $('cx-body');
  if (!body || typeof body.appendChild !== 'function') return false;
  built = true;
  clear(body);

  const controls = el('div', 'cx-controls');
  const row1 = el('div', 'cx-row');
  const seg = el('div', 'cx-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Which inputs');
  const segAll = el('button', 'cx-seg-btn', 'Every word');
  segAll.type = 'button';
  segAll.dataset.cx = 'mode';
  segAll.dataset.val = 'all';
  segAll.setAttribute('data-tip', 'Every word of each length — sampled past the cap. Worst case over Σⁿ.');
  const segFam = el('button', 'cx-seg-btn', 'Family');
  segFam.type = 'button';
  segFam.dataset.cx = 'mode';
  segFam.dataset.val = 'family';
  segFam.setAttribute('data-tip', 'One structured input per length, such as a^n b^n or 1^n+1^n.');
  seg.append(segAll, segFam);
  const pattern = el('input', 'inp cx-pattern');
  pattern.placeholder = 'a^n b^n';
  pattern.autocomplete = 'off';
  pattern.spellcheck = false;
  pattern.dataset.cx = 'pattern';
  pattern.setAttribute('aria-label', 'Family pattern');
  row1.append(seg, pattern);

  const row2 = el('div', 'cx-row cx-row-nums');
  const from = numberInput('from', plan.from, 'n from ', 0, MAX_N);
  const to = numberInput('to', plan.to, ' to ', 1, MAX_N);
  const cap = numberInput('cap', plan.cap, 'words per n ≤ ', 1, 512);
  const runBtn = el('button', 'cx-run', 'Run');
  runBtn.type = 'button';
  runBtn.dataset.cx = 'run';
  row2.append(from.wrap, to.wrap, cap.wrap, runBtn);

  const hint = el('div', 'cx-hint');
  controls.append(row1, row2, hint);

  const progress = el('div', 'cx-progress');
  progress.hidden = true;
  const bar = el('i');
  progress.appendChild(bar);
  const status = el('div', 'cx-status');
  status.setAttribute('aria-live', 'polite');

  const charts = el('div', 'cx-charts');
  const empty = el('div', 'cx-empty');
  const figSteps = chartFigure('steps');
  const figSpace = chartFigure('space');
  const legend = el('div', 'cx-legend');
  legend.innerHTML = '<span class="cx-key cx-key-worst"><i></i>worst case</span>'
    + '<span class="cx-key cx-key-mean"><i></i>mean</span>'
    + '<span class="cx-key cx-key-limit"><i></i>hit the step budget</span>';
  const table = el('details', 'cx-table');
  const summary = el('summary', null, 'Table');
  const tableWrap = el('div', 'cx-table-wrap');
  table.append(summary, tableWrap);
  charts.append(empty, figSteps.fig, figSpace.fig, legend, table);

  const foot = el('div', 'cx-foot');
  const csv = el('button', 'cx-foot-btn', 'Download CSV');
  csv.type = 'button';
  csv.dataset.cx = 'csv';
  const copy = el('button', 'cx-foot-btn', 'Copy');
  copy.type = 'button';
  copy.dataset.cx = 'copy';
  foot.append(csv, copy);

  const tip = el('div', 'cx-tip');
  tip.hidden = true;

  body.append(controls, progress, status, charts, foot, tip);
  els = {
    body, segAll, segFam, pattern, from: from.inp, to: to.inp, cap: cap.inp, capWrap: cap.wrap, runBtn,
    hint, progress, bar, status, charts, empty, figs: { steps: figSteps, space: figSpace }, legend,
    table, tableWrap, foot, csv, copy, tip
  };

  body.addEventListener('click', onClick);
  body.addEventListener('input', onInput);
  body.addEventListener('change', onInput);
  pattern.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startProfile(); } });
  for (const f of [figSteps, figSpace]) {
    f.plot.addEventListener('pointermove', e => onPlotHover(f, e));
    f.plot.addEventListener('pointerleave', () => { focusN = null; hideTip(); renderCharts(); });
    f.plot.addEventListener('click', e => onPlotClick(f, e));
    f.plot.addEventListener('keydown', e => onPlotKey(f, e));
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderCharts()).observe(charts);
  renderAll();
  return true;
}

function chartFigure(metric) {
  const fig = el('figure', 'cx-chart');
  fig.dataset.metric = metric;
  const cap = el('figcaption', 'cx-cap');
  const title = el('span', 'cx-title', metric === 'steps' ? 'Steps' : 'Cells visited');
  const growth = el('span', 'cx-growth');
  cap.append(title, growth);
  const plot = el('div', 'cx-plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'img');
  fig.append(cap, plot);
  return { fig, metric, title, growth, plot };
}

// ══════════════════════════════════════════════════════════════════
//  VISIBILITY
// ══════════════════════════════════════════════════════════════════

export function syncComplexitySection() {
  const sec = $(COMPLEXITY_SECTION);
  if (!sec || !sec.style) return;
  const want = profileKind() ? '' : 'none';
  if (sec.style.display !== want) {
    sec.style.display = want;
    syncPanelEmpty('rpanel');
  }
  // An edit makes the profile on screen a profile of a machine that is gone.
  // It stays — the shape is often still worth looking at — but says so.
  if (rows.length && ranFor && ranFor.machine === App.machine && ranFor.signature !== machineSignature()) stale = true;
  if (ranFor && ranFor.machine !== App.machine) { rows = []; ranFor = null; stale = false; }
  if (built) renderAll();
  else watchForFirstShow();
}

// Nothing is built for a section nobody has opened: the first time the body
// has a size — expanded in the panel, or pulled out into a window — it is.
let watching = false;
function watchForFirstShow() {
  if (watching || typeof ResizeObserver !== 'function') return;
  const body = $('cx-body');
  if (!body || typeof body.getBoundingClientRect !== 'function') return;
  watching = true;
  const ro = new ResizeObserver(() => {
    if (built || !(body.clientHeight || body.clientWidth)) return;
    ensureBuilt();
    ro.disconnect();
  });
  ro.observe(body);
}

subscribe(Change.GRAPH, syncComplexitySection);

function machineSignature() {
  return `${App.states.length}|${App.transitions.map(t => `${t.from}>${t.to}:${t.symbol}:${t.write ?? ''}${t.dir ?? ''}${t.pop ?? ''}${t.push ?? ''}`).join(';')}|${[...App.accepts].join(',')}|${App.startId}`;
}

// ══════════════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════════════

function onClick(e) {
  const b = e.target.closest && e.target.closest('[data-cx]');
  if (!b || b.tagName === 'INPUT') return;
  switch (b.dataset.cx) {
    case 'mode':
      plan.mode = b.dataset.val;
      renderControls();
      if (plan.mode === 'family') els.pattern.focus();
      break;
    case 'run':
      if (running) stopProfile(); else startProfile();
      break;
    case 'csv':
      if (!rows.length) return;
      exportDownload(`${exportBaseName()}-complexity.csv`, profileCSV(rows, spaceName(ranFor?.kind).replace(' ', '_')), 'text/csv;charset=utf-8');
      showStatus('Exported the complexity profile as CSV');
      break;
    case 'copy':
      if (rows.length) exportCopyText(profileCSV(rows, spaceName(ranFor?.kind).replace(' ', '_')), 'Copied the complexity profile');
      break;
  }
}

function onInput(e) {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.cx) return;
  const k = t.dataset.cx;
  if (k === 'pattern') plan.pattern = t.value;
  else if (k === 'from' || k === 'to' || k === 'cap') {
    const v = Math.round(Number(t.value));
    if (Number.isFinite(v)) plan[k] = v;
  }
  renderControls();
}

/** What is wrong with the plan, in a sentence — or '' when it can run. */
function planProblem() {
  if (!Number.isFinite(plan.from) || !Number.isFinite(plan.to)) return 'Give the lengths as numbers.';
  if (plan.from < 0 || plan.to > MAX_N) return `Lengths run from 0 to ${MAX_N}.`;
  if (plan.to <= plan.from) return 'The last length has to be larger than the first.';
  if (plan.mode === 'family') {
    try { parseFamily(plan.pattern); } catch (err) { return err.message; }
  } else if (!inputSymbols().length) {
    return 'Σ is empty, so there are no words to run.';
  } else if (plan.cap < 1) {
    return 'Run at least one word per length.';
  }
  return '';
}

// ══════════════════════════════════════════════════════════════════
//  RUNNING
// ══════════════════════════════════════════════════════════════════

/**
 * Run the profile, a slice at a time. Each slice runs words until it has had
 * its share of the frame, then hands the page back — the charts grow as the
 * lengths finish, and Stop, the canvas and the rest of the app stay live.
 */
export function startProfile() {
  if (!ensureBuilt()) return;
  const kind = profileKind();
  if (!kind) return;
  const problem = planProblem();
  if (problem) { renderControls(); els.hint.classList.add('is-bad'); return; }

  // A machine that refuses to run — a D-type whose δ branches — refuses here
  // too, rather than profiling something the run box would not run.
  let inputs;
  try { inputs = profileInputs({ ...plan, symbols: inputSymbols() }); } catch (err) { els.hint.textContent = err.message; return; }
  const sample = inputs.find(l => l.words.length)?.words[0] ?? '';
  const parsed = parseMachineInput(App.machine, sample);
  if (parsed.ok) {
    const refused = machineGuards(App.machine, parsed.input).find(g => g.refuse);
    // `refuse` is the sentence itself, the one runSim prints in the trace log.
    if (refused) { setStatus(String(refused.refuse), 'bad'); return; }
  }

  rows = [];
  stale = false;
  focusN = null;
  ranFor = { machine: App.machine, kind, signature: machineSignature(), plan: { ...plan }, started: performanceNow() };
  const gen = profileRun(App.machine, { ...plan, symbols: inputSymbols(), space: kind === 'store' ? 'store' : 'cells' });
  running = { gen, timer: 0, index: 0, total: 1, current: null };
  renderAll();

  const tick = () => {
    if (!running) return;
    const t0 = performanceNow();
    let r;
    do {
      r = gen.next();
      if (r.done) break;
      const v = r.value;
      running.index = v.index;
      running.total = v.total;
      running.current = v.row;
      if (v.done) {
        const i = rows.findIndex(x => x.n === v.row.n);
        if (i >= 0) rows[i] = v.row; else rows.push(v.row);
      }
    } while (performanceNow() - t0 < TICK_MS);
    if (r.done) {
      const secs = (performanceNow() - ranFor.started) / 1000;
      running = null;
      const n = rowsRuns();
      const took = secs < 0.1 ? `${Math.max(1, Math.round(secs * 1000))} ms` : secs < 10 ? `${secs.toFixed(1)} s` : `${Math.round(secs)} s`;
      setStatus(`Done — ${n.toLocaleString()} run${n === 1 ? '' : 's'} in ${took}.`, 'done');
      renderAll();
      return;
    }
    renderProgress();
    renderCharts();
    running.timer = setTimeout(tick, 0);
  };
  running.timer = setTimeout(tick, 0);
}

export function stopProfile() {
  if (!running) return;
  clearTimeout(running.timer);
  running = null;
  setStatus(`Stopped — the lengths that finished are kept.`, 'done');
  renderAll();
}

function rowsRuns() {
  return rows.reduce((k, r) => k + r.count + r.errors, 0);
}

function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════

let statusText = '';
let statusTone = '';

function setStatus(text, tone = '') {
  statusText = text;
  statusTone = tone;
  if (els) renderStatus();
}

function renderAll() {
  if (!els) return;
  renderControls();
  renderProgress();
  renderStatus();
  renderCharts();
  renderTable();
}

function renderControls() {
  const { segAll, segFam, pattern, from, to, cap, capWrap, runBtn, hint } = els;
  segAll.classList.toggle('on', plan.mode === 'all');
  segFam.classList.toggle('on', plan.mode === 'family');
  segAll.setAttribute('aria-checked', plan.mode === 'all' ? 'true' : 'false');
  segFam.setAttribute('aria-checked', plan.mode === 'family' ? 'true' : 'false');
  segAll.setAttribute('role', 'radio');
  segFam.setAttribute('role', 'radio');
  pattern.hidden = plan.mode !== 'family';
  capWrap.hidden = plan.mode !== 'all';
  if (document.activeElement !== pattern && pattern.value !== plan.pattern) pattern.value = plan.pattern;
  if (document.activeElement !== from) from.value = String(plan.from);
  if (document.activeElement !== to) to.value = String(plan.to);
  if (document.activeElement !== cap) cap.value = String(plan.cap);
  runBtn.textContent = running ? 'Stop' : 'Run';
  runBtn.classList.toggle('is-stop', !!running);
  const problem = planProblem();
  hint.classList.toggle('is-bad', !!problem && (plan.mode !== 'family' || plan.pattern.trim() !== ''));
  if (problem && (plan.mode !== 'family' || plan.pattern.trim())) hint.textContent = problem;
  else if (plan.mode === 'family') {
    hint.innerHTML = 'Repeat with <code>^n</code>, <code>^{2n}</code>, <code>^{n+1}</code>; group with parentheses — <code>(ab)^n</code>, <code>1^n+1^n</code>.';
  } else {
    const syms = inputSymbols();
    const total = n => Math.pow(syms.length, n);
    const sampled = total(plan.to) > plan.cap;
    hint.textContent = sampled
      ? `Σ has ${syms.length} symbol${syms.length === 1 ? '' : 's'}: past ${plan.cap} words a length is sampled — the one-symbol words always, the rest at random.`
      : 'Every word of each length is run; the chart shows the slowest and the average.';
  }
  runBtn.disabled = !running && !!problem;
}

function renderProgress() {
  const { progress, bar } = els;
  progress.hidden = !running;
  if (running) {
    const f = running.total ? running.index / running.total : 0;
    bar.style.width = `${Math.round(f * 100)}%`;
    const cur = running.current;
    setStatus(cur ? `Running n = ${cur.n} — ${running.index.toLocaleString()} of ${running.total.toLocaleString()} words` : 'Starting…');
  }
}

function renderStatus() {
  const { status } = els;
  let text = statusText;
  let tone = statusTone;
  if (!running && stale) { text = 'The machine has changed since this profile ran — run it again to see the machine as it is now.'; tone = 'warn'; }
  status.textContent = text;
  status.className = 'cx-status' + (tone ? ` is-${tone}` : '');
  status.hidden = !text;
  syncComplexityStatus();
}

/**
 * What the Complexity header says while folded: how the steps grow, which is
 * the one line a profile is run to find out — or that it is running, or that
 * the machine has moved on since. Read off the chart's own label, so the chip
 * and the figure cannot give two answers.
 */
function syncComplexityStatus() {
  if (!els) return;
  if (running) { setSectionStatus('rp-complexity', 'running…'); return; }
  const growth = els.figs.steps.fig.hidden ? '' : els.figs.steps.growth.textContent;
  if (!growth) { setSectionStatus('rp-complexity', ''); return; }
  if (stale) { setSectionStatus('rp-complexity', `steps ${growth} · stale`, 'warn'); return; }
  setSectionStatus('rp-complexity', `steps ${growth}`);
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(v * 10) / 10);
}

function svg(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  return e;
}

function metricOf(r, metric) {
  return metric === 'steps'
    ? { worst: r.worst, mean: r.count ? r.sum / r.count : null, word: r.worstWord }
    : { worst: r.spaceWorst, mean: r.count ? r.spaceSum / r.count : null, word: r.spaceWord };
}

/** Where a chart's points go — kept so the pointer can find the nearest n. */
const geom = { steps: null, space: null };

function renderCharts() {
  if (!els) return;
  const shown = rows.filter(r => r.count);
  const partial = running && running.current && !rows.some(r => r.n === running.current.n) && running.current.count
    ? [...shown, running.current] : shown;
  const kind = ranFor?.kind || profileKind();
  els.figs.space.title.textContent = kind === 'store' ? 'Store height' : 'Cells visited';
  const has = partial.length > 0;
  els.empty.hidden = has;
  els.figs.steps.fig.hidden = !has;
  els.figs.space.fig.hidden = !has;
  els.legend.hidden = !has;
  els.table.hidden = !has || !!running;
  els.foot.hidden = !has || !!running;
  if (!has) {
    const problem = rows.some(r => r.errors && !r.count) ? rows.find(r => r.error)?.error : '';
    els.empty.textContent = problem
      ? `None of the inputs could be run: ${problem}`
      : 'Run the profile to chart how many steps — and how much space — the machine takes as its input grows.';
    syncComplexityStatus();
    return;
  }
  const limitedAny = partial.some(r => r.limited);
  els.legend.querySelector('.cx-key-limit').hidden = !limitedAny;
  for (const metric of ['steps', 'space']) drawChart(els.figs[metric], partial, metric, kind);
  syncComplexityStatus();
}

function drawChart(f, data, metric, kind) {
  const W = Math.max(220, f.plot.clientWidth || 300);
  const H = 132;
  const m = { l: 40, r: 22, t: 8, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n0 = ranFor ? ranFor.plan.from : plan.from;
  const n1 = ranFor ? ranFor.plan.to : plan.to;
  const xOf = n => m.l + (n1 === n0 ? pw / 2 : ((n - n0) / (n1 - n0)) * pw);
  const vals = data.map(r => metricOf(r, metric));
  const max = niceCeil(Math.max(1, ...vals.map(v => v.worst || 0)));
  const yOf = v => m.t + ph - (v / max) * ph;
  geom[metric] = { xOf, n0, n1, m, pw, W };

  const root = svg('svg', { class: 'cx-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  // Grid and y labels: four lines, the top one the axis maximum.
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const y = yOf(v);
    root.appendChild(svg('line', { class: i === 0 ? 'cx-base' : 'cx-grid', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    if (i % 2 === 0) root.appendChild(svg('text', { class: 'cx-ylab', x: m.l - 6, y: y + 3, 'text-anchor': 'end' }, compact(v)));
  }
  // x labels: every n when they fit, otherwise a readable interval.
  const every = Math.max(1, Math.ceil(((n1 - n0 + 1) * 18) / pw));
  for (let n = n0; n <= n1; n++) {
    if ((n - n0) % every && n !== n1) continue;
    root.appendChild(svg('text', { class: 'cx-xlab', x: xOf(n), y: H - 6, 'text-anchor': 'middle' }, String(n)));
  }
  root.appendChild(svg('text', { class: 'cx-xname', x: W - 4, y: H - 6, 'text-anchor': 'end' }, 'n'));

  // The focused length, under everything else.
  if (focusN !== null && focusN >= n0 && focusN <= n1) {
    root.appendChild(svg('line', { class: 'cx-cross', x1: xOf(focusN), x2: xOf(focusN), y1: m.t, y2: m.t + ph }));
  }

  const line = (key, cls) => {
    const pts = data.map((r, i) => (vals[i][key] === null ? null : `${xOf(r.n).toFixed(1)},${yOf(vals[i][key]).toFixed(1)}`)).filter(Boolean);
    if (pts.length > 1) root.appendChild(svg('polyline', { class: cls, points: pts.join(' ') }));
  };
  line('mean', 'cx-mean');
  line('worst', 'cx-worst');
  data.forEach((r, i) => {
    if (vals[i].worst === null) return;
    const limited = metric === 'steps' && r.limited > 0 && vals[i].worst >= 0 && r.limited === r.count;
    const cls = 'cx-pt' + (limited || (metric === 'steps' && r.limited) ? ' is-limited' : '') + (r.n === focusN ? ' is-focus' : '');
    root.appendChild(svg('circle', { class: cls, cx: xOf(r.n), cy: yOf(vals[i].worst), r: r.n === focusN ? 4.5 : 3.5 }));
  });

  clear(f.plot);
  f.plot.appendChild(root);
  const est = growthEstimate(data.map((r, i) => ({ n: r.n, v: vals[i].worst, limited: metric === 'steps' && r.limited > 0 })));
  f.growth.textContent = est ? est.label : '';
  f.growth.setAttribute('data-tip', est ? `${est.detail} — read off the worst case at the largest lengths; an estimate from these points, not a proof` : '');
  f.growth.hidden = !est;
  const name = metric === 'steps' ? 'Steps' : (kind === 'store' ? 'Store height' : 'Cells visited');
  f.plot.setAttribute('aria-label', `${name} against input length n, from ${n0} to ${n1}${est ? `; grows ${est.label}` : ''}. Left and right choose a length; Enter runs its worst word.`);
}

function renderTable() {
  if (!els || running) return;
  const kind = ranFor?.kind || profileKind();
  const done = rows.filter(r => r.count || r.errors);
  if (!done.length) { els.tableWrap.innerHTML = ''; return; }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const head = `<tr><th>n</th><th>words</th><th>worst steps</th><th>mean</th><th>worst ${esc(spaceName(kind))}</th><th>accept</th><th>reject</th><th>other</th></tr>`;
  const body = done.map(r => `<tr><td>${r.n}</td><td>${r.count}</td><td>${r.worst ?? '—'}${r.limited ? '+' : ''}</td>`
    + `<td>${r.count ? (r.sum / r.count).toFixed(1) : '—'}</td><td>${r.spaceWorst ?? '—'}</td>`
    + `<td>${r.verdicts.accept}</td><td>${r.verdicts.reject}</td><td>${r.verdicts.loop + r.verdicts.timeout + r.errors}</td></tr>`).join('');
  els.tableWrap.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ── pointing at a length ──────────────────────────────────────────

function nearestN(metric, clientX, plot) {
  const g = geom[metric];
  if (!g) return null;
  const r = plot.getBoundingClientRect();
  const x = ((clientX - r.left) / (r.width || g.W)) * g.W;
  if (g.n1 === g.n0) return g.n0;
  const n = Math.round(g.n0 + ((x - g.m.l) / g.pw) * (g.n1 - g.n0));
  return Math.max(g.n0, Math.min(g.n1, n));
}

function rowFor(n) {
  return rows.find(r => r.n === n && r.count) || null;
}

function onPlotHover(f, e) {
  const n = nearestN(f.metric, e.clientX, f.plot);
  if (n !== focusN) { focusN = n; renderCharts(); }
  showTip(f, n);
}

function showTip(f, n) {
  const r = rowFor(n);
  if (!r) { hideTip(); return; }
  const kind = ranFor?.kind || profileKind();
  const v = metricOf(r, f.metric);
  const unit = f.metric === 'steps' ? 'steps' : (kind === 'store' ? 'high' : 'cells');
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const word = v.word === '' ? App.config.sym.eps : v.word;
  const verdict = [r.verdicts.accept && `${r.verdicts.accept} accept`, r.verdicts.reject && `${r.verdicts.reject} reject`,
    r.verdicts.loop && `${r.verdicts.loop} loop`, r.verdicts.timeout && `${r.verdicts.timeout} no verdict`].filter(Boolean).join(' · ');
  els.tip.innerHTML = `<div><b>n = ${n}</b> · worst ${v.worst.toLocaleString()} ${unit}${f.metric === 'steps' && r.limited ? ' <em>(budget)</em>' : ''}</div>`
    + `<div>on <code>${esc(word.length > 28 ? word.slice(0, 27) + '…' : word)}</code></div>`
    + `<div>mean ${v.mean === null ? '—' : v.mean.toFixed(1)} over ${r.count} word${r.count === 1 ? '' : 's'}${verdict ? ` — ${verdict}` : ''}</div>`
    + '<div class="cx-tip-hint">Click to run this word</div>';
  els.tip.hidden = false;
  const g = geom[f.metric];
  const pr = f.plot.getBoundingClientRect();
  const br = els.body.getBoundingClientRect();
  const x = pr.left - br.left + (g.xOf(n) / g.W) * pr.width;
  const w = els.tip.offsetWidth || 180;
  const left = Math.max(4, Math.min((els.body.clientWidth || 300) - w - 4, x - w / 2));
  els.tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(pr.top - br.top + els.body.scrollTop - 6)}px) translateY(-100%)`;
}

function hideTip() {
  if (els) els.tip.hidden = true;
}

/** Run a length's worst word in the player, and show its space-time diagram. */
function runWorst(metric, n) {
  const r = rowFor(n);
  if (!r) return;
  const word = metric === 'steps' ? r.worstWord : r.spaceWord;
  if (word === null || word === undefined) return;
  const box = $('sim-in');
  if (!box) return;
  box.value = word;
  runSim();
  openSpaceTime();
  showStatus(`Running the worst case for n = ${n}`);
}

function onPlotClick(f, e) {
  const n = nearestN(f.metric, e.clientX, f.plot);
  if (n !== null) runWorst(f.metric, n);
}

function onPlotKey(f, e) {
  const g = geom[f.metric];
  if (!g) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    focusN = Math.max(g.n0, Math.min(g.n1, (focusN ?? (d > 0 ? g.n0 - 1 : g.n1 + 1)) + d));
    renderCharts();
    showTip(f, focusN);
  } else if (e.key === 'Enter' && focusN !== null) {
    e.preventDefault();
    runWorst(f.metric, focusN);
  } else if (e.key === 'Escape') {
    focusN = null;
    hideTip();
    renderCharts();
  }
}

// Test seam.
export const _complexityTests = {
  plan, planProblem,
  get rows() { return rows; },
  get running() { return !!running; },
  get stale() { return stale; }
};
