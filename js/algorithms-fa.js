import { defineActions } from './action-registry.js';
import { commit } from './history.js';
import { html, raw } from './html.js';
import { langVerdict } from './language.js';
import { algoLexer } from './lexer-ui.js';
import { showExampleCard } from './machine-card.js';
import { simNPDA } from './machines/pushdown.js';
import { hasSingleValuedDelta, isOneWayFA } from './machines/predicates.js';
import { isMultiTape } from './machines/index.js';
import { epsClosure, tokenize, transitionsFrom } from './machines/runtime.js';
import { simNDTM } from './machines/turing.js';
import { deriveRegex, renderAll } from './render.js';
import { $, App, getMachineConfig } from './state.js';
import { getState } from './states-transitions.js';
import { Change, emit } from './store.js';
import { renderTracker, resetTracker } from './tape-view.js';
import { thAstLabel, thompsonBuild, thompsonSteps } from './thompson.js';
import { autoFitLoadedMachine } from './ui.js';
import { findPdaNondeterministicPairs, isAnyTM, isClassicPDA, parseEps, showStatus } from './utils.js';
import { UTM_EXAMPLES } from './utm-examples.js';
import { applyMachineSwitch, setView } from './view.js';
import { getCurrentMachineSnapshot, loadBuiltMachine } from './workspace.js';

// The construction lives in js/thompson.js, which the command line reads
// without a page; these names are where the rest of the app has found it.
export { buildThompson, getAllChars, parseRE, thAstLabel, thompsonBuild } from './thompson.js';
export { UTM_EXAMPLES } from './utm-examples.js';

// ══════════════════════════════════════════════════════════════════
//  ACTIONS — what the cards' buttons and fields name
// ══════════════════════════════════════════════════════════════════
// The cards below are built as markup, and their controls say what they do
// with data-action (js/actions.js) rather than with on*="..." code. Each name
// is the function it runs, so a search for the function finds its buttons.
// Arguments are attributes on the control: data-op, data-step and data-algo,
// read here — never JavaScript inside the markup.
defineActions({
  // Subset construction, minimisation, complement, ε-removal
  'algo.loadSubsetAsDFA': () => loadSubsetAsDFA(),
  'algo.loadMinimizedDFA': () => loadMinimizedDFA(),
  'algo.loadComplement': () => loadComplement(),
  'algo.loadEpsEliminatedNFA': () => loadEpsEliminatedNFA(),
  // Regex → NFA (Thompson), in one go and step by step
  'algo.doThompson': () => doThompson(),
  'algo.loadThompsonNFA': () => loadThompsonNFA(),
  'algo.startThompsonViz': () => startThompsonViz(),
  'algo.thVizStep': ({ el }) => thVizStep(Number(el.dataset.step)),
  'algo.loadThompsonNFA_Viz': () => loadThompsonNFA_Viz(),
  // Equivalence
  'algo.testEquivStr': () => testEquivStr(),
  'algo.runProductEquiv': () => runProductEquiv(),
  'algo.runFullEquivCheck': () => runFullEquivCheck(),
  // Closure properties: star, reversal, union, intersection, concatenation
  'algo.loadBuiltNFAResult': ({ el }) => loadBuiltNFAResult(el.dataset.op),
  // Nondeterministic runs
  'algo.buildNFATree': () => buildNFATree(),
  'algo.runNPDASim': () => runNPDASim(),
  'algo.runNDTMSim': () => runNDTMSim(),
  // Universal Turing machine
  'algo.loadUTMExample': () => loadUTMExample(),
  'algo.runUTMSim': () => runUTMSim(),
  'algo.utmStepBack': () => utmStepBack(),
  'algo.utmStepFwd': () => utmStepFwd(),
  'algo.utmToggleAuto': () => utmToggleAuto(),
  'algo.utmResetView': () => utmResetView(),
  // Moore ↔ Mealy
  'algo.loadMooreAsMealy': () => loadMooreAsMealy(),
  'algo.loadMealyAsMoore': () => loadMealyAsMoore(),
  // Myhill–Nerode, visualised
  'algo.minVisStep': ({ el }) => minVisStep(Number(el.dataset.step)),
  'algo.renderAlgo': ({ el }) => renderAlgo(el.dataset.algo),
  // Regular grammar → NFA
  'algo.buildRG2NFA': () => buildRG2NFA(),
  'algo.loadRG2NFAToCanvas': () => loadRG2NFAToCanvas(),
  // Dead and unreachable states
  'algo.highlightDeadStates': () => highlightDeadStates(),
  'algo.clearStateHighlights': () => clearStateHighlights(),
  'algo.setAlgo': ({ el }) => setAlgo(el.dataset.algo)
});

// ══════════════════════════════════════════════════════════════════
//  BUILDING A CARD
// ══════════════════════════════════════════════════════════════════
// Every card is written with `html` (js/html.js), which escapes what it
// interpolates: state names, symbols, a regex the reader typed and the parser
// error it raised are all the reader's text, and a machine from a share link
// or the library is someone else's. A card is assembled whole and assigned
// once — `paint` — rather than grown with `innerHTML +=`, which re-parsed
// everything above the new part on each addition. Presentation is classes
// in css/views.css, under "Algorithm cards".

const svg = (body, size = 13) => raw(`<svg class="algo-icon" viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${body}</svg>`);
const PATHS = {
  load: '<path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/>',
  play: '<path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/>',
  pause: '<path d="M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z"/>',
  back: '<path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/>',
  next: '<path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/>',
  reset: '<path d="M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z"/>',
  eye: '<path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/>',
  close: '<path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/>'
};
const ICON = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, svg(p)]));
const STEP_ICON = { back: svg(PATHS.back, 12), next: svg(PATHS.next, 12) };

/** The "load onto the canvas" arrow; the lexer card's button wears it too. */
export const ALGO_ICON_LOAD_CANVAS = String(ICON.load);

function paint(el, ...parts) {
  if (el) el.innerHTML = String(html`${parts}`);
}

const classes = (...names) => names.filter(Boolean).join(' ');

const page = (title, sub, info = null) => html`<div class="algo-title">${title}</div>
<div class="algo-sub">${sub}</div>${info && html`<div class="info-box">${info}</div>`}`;

const card = (title, body, cls = '') => html`<div class="${classes('card', cls)}">${title != null && html`<div class="card-title">${title}</div>`}${body}</div>`;
const notice = (text, cls = '') => card(null, text, cls);
const legend = text => html`<div class="algo-legend">${text}</div>`;
const actions = (...buttons) => html`<div class="algo-actions">${buttons}</div>`;
const pills = (list, empty = null) => html`<div class="nfa-result-states">${list.length ? list : empty}</div>`;
const pill = (text, cls = '') => html`<div class="${classes('state-pill', cls)}">${text}</div>`;
const verdict = (ok, text) => html`<div class="pump-result ${ok ? 'ok' : 'fail'}">${text}</div>`;
const lines = list => list.map((line, i) => html`${i ? html`<br>` : ''}${line}`);


function table(head, rows, empty = 'No transitions') {
  return html`<div class="subset-table-wrap"><table class="result-table">
<thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead>
<tbody>${rows.length ? rows : html`<tr><td colspan="${head.length}" class="dead-cell">${empty}</td></tr>`}</tbody>
</table></div>`;
}

/** Step-by-step narration. Each step is markup a builder made with `html`. */
const stepList = steps => html`<div class="step-list">${steps.map((s, i) =>
  html`<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${raw(s)}</div></div>`)}</div>`;

/** One step: a headline and the lines that explain it, as a string of markup. */
const step = (main, subs = []) => String(html`${main}${subs.length > 0 && html`<span class="step-sub">${lines(subs)}</span>`}`);

const nameOf = id => getState(id)?.name ?? id;
const namesOf = ids => [...ids].map(nameOf);
const isStart = id => id === App.startId;
const isAccept = id => App.accepts.has(id);
const transitionsOn = (id, sym) => transitionsFrom(id).filter(t => t.symbol === sym);

/** A state's first cell: its name, marked → for start and * for accepting. */
function stateCell(s) {
  const marks = (isStart(s.id) ? '→' : ' ') + (isAccept(s.id) ? '*' : ' ');
  return html`<td class="${classes(isStart(s.id) && 'start-cell', isAccept(s.id) && 'acc-cell')}">${marks} ${s.name}</td>`;
}

const roleClass = id => isAccept(id) ? 'acc' : isStart(id) ? 'start' : '';

/**
 * Null when the canvas holds one of `types`; otherwise the card that says
 * which to switch to. A card declares what it reads in one call, so the
 * sentence is written once rather than once per card.
 */
function needs(types, what) {
  if (types.includes(App.machine)) return null;
  const names = types.map(t => getMachineConfig(t)?.label ?? t).join(' or ');
  return notice(`Switch to ${names} mode to use ${what}.`);
}

// What an algorithm says when the canvas has nothing for it to read. There is
// no Build tab any more — the canvas is under this window — so the way to it
// is a button rather than directions.
function emptyCanvasCard(what) {
  return html`<div class="card algo-empty"><span>Draw ${what} on the canvas first.</span><button class="btn-g algo-empty-btn" type="button" data-action="view.closeAuxView">Back to canvas</button></div>`;
}

/** Show the build view with a machine a card just put there. */
function revealOnCanvas(status) {
  setView('build');
  autoFitLoadedMachine();
  showStatus(status);
}

// ══════════════════════════════════════════════════════════════════
//  ALGORITHMS VIEW
// ══════════════════════════════════════════════════════════════════
const RENDERS = {
  table: algoTable, nfa2dfa: algoNFA2DFA, minimize: algoMinimize, equiv: algoEquiv,
  re2nfa: algoRE2NFA, nfa2re: algoNFA2RE, enfa2nfa: algoEpsNFA2NFA,
  complement: algoComplement, product: algoProduct,
  isEmpty: algoIsEmpty, isFinite: algoIsFinite, isUniversal: algoIsUniversal, fullEquiv: algoFullEquiv,
  star: algoClopStar, reversal: algoClopReversal, union2: algoClopUnion, intersect: algoClopIntersect, concat2: algoClopConcat,
  nfaTree: algoNFATree, npda: algoNPDA, ndtm: algoNDTM, utm: algoUTM,
  mooreTable: algoMooreTable, mealyTable: algoMealyTable,
  moore2mealy: algoMoore2Mealy, mealy2moore: algoMealy2Moore, mtmTable: algoMTMTable,
  minimizeVisual: algoMinimizeVisual, re2nfaVisual: algoRE2NFAVisual, tm2grammar: algoTM2Grammar,
  epsClosure: algoEpsClosure, dfa2rg: algoDFA2RG, rg2nfa: algoRG2NFA,
  deadStates: algoDeadStates,
  lexer: algoLexer,
};

export function setAlgo(a) {
  // Leaving Dead State Analysis takes its overlay off the canvas.
  if (App.currentAlgo === 'deadStates' && a !== 'deadStates' && App.stateClassification) {
    App.stateClassification = null;
    emit(Change.CANVAS);
  }
  App.currentAlgo = a;
  document.querySelectorAll('.algo-item').forEach(el => el.classList.toggle('active', el.dataset.algo === a));
  renderAlgo(a);
}

export function renderAlgo(a) {
  const c = $('algo-content');
  c.innerHTML = '';
  RENDERS[a]?.(c);
}

// ══════════════════════════════════════════════════════════════════
//  TRANSITION TABLE
// ══════════════════════════════════════════════════════════════════
export function algoTable(c) {
  const head = page('Transition Table δ', 'FORMAL REPRESENTATION OF THE TRANSITION FUNCTION');
  if (!App.states.length) return paint(c, head, emptyCanvasCard('an automaton'));
  const syms = [...App.sigma];
  // A cell holds one state when δ is a function into Q — a DFA — and a set
  // of them otherwise.
  const functional = isOneWayFA() && hasSingleValuedDelta();
  const rows = App.states.map(s => html`<tr>${stateCell(s)}${syms.map(sym => {
    const targets = transitionsOn(s.id, sym);
    if (functional) {
      const to = targets[0]?.to;
      return html`<td class="${classes(!targets.length && 'dead-cell', isAccept(to) && 'acc-cell')}">${targets.length ? nameOf(to) : '—'}</td>`;
    }
    if (!targets.length) return html`<td class="dead-cell">∅</td>`;
    return html`<td>{${targets.map(t => nameOf(t.to)).join(',')}}</td>`;
  })}</tr>`);
  paint(c, head, card(html`<span class="sym">δ: Q × Σ → ${functional ? 'Q' : '2^Q'}</span>`, html`
${table(['State', ...syms], rows)}
${legend('→ start state · * accept state · — dead state (implicit reject)')}`));
}

// ══════════════════════════════════════════════════════════════════
//  NFA → DFA (SUBSET CONSTRUCTION)
// ══════════════════════════════════════════════════════════════════
const SUBSET_INPUTS = ['NFA', 'ε-NFA'];

export function algoNFA2DFA(c) {
  const head = page('NFA → DFA Conversion', 'SUBSET CONSTRUCTION (POWERSET CONSTRUCTION)',
    html`Each DFA state represents a <em>subset of NFA states</em>. Starting from ε-closure(q₀), we compute transitions for each symbol and add new subsets as needed. The resulting DFA is equivalent to the original NFA.`);
  // Subset construction is only sound for a plain one-way NFA over finite
  // words. Every other model on this canvas carries state the powerset has no
  // room for — a probability distribution, a Büchi cycle condition, a stack, a
  // tape — and silently dropping it would offer an "equivalent" DFA that
  // decides a different language.
  if (!SUBSET_INPUTS.includes(App.machine)) {
    const why = App.machine === 'DFA'
      ? 'Your automaton is already a DFA. Switch to NFA or ε-NFA mode to use this.'
      : `Subset construction applies to NFAs and ε-NFAs. ${getMachineConfig(App.machine).label} is not one, and converting it as though it were would discard what makes it different.`;
    return paint(c, head, notice(why));
  }
  if (!App.startId) return paint(c, head, notice('No start state defined.'));
  const result = subsetConstruction();
  App._lastSubset = result;
  const syms = [...App.sigma];
  const target = new Map(result.trans.map(t => [`${t.from}\u0000${t.sym}`, t.to]));
  const rows = result.states.map(ds => {
    const type = ds.isStart && ds.isAcc ? 'start+acc' : ds.isStart ? 'start' : ds.isAcc ? 'accept' : '—';
    return html`<tr><td class="${classes(ds.isStart && 'start-cell', ds.isAcc && 'acc-cell')}">${ds.name}</td>${syms.map(sym => html`<td>${target.get(`${ds.name}\u0000${sym}`) ?? '∅'}</td>`)}<td>${type}</td></tr>`;
  });
  paint(c, head,
    card(`Result: ${result.states.length} DFA states from ${App.states.length} NFA states`, table(['DFA State (NFA Subset)', ...syms, 'Type'], rows)),
    actions(html`<button class="algo-btn has-icon" data-action="algo.loadSubsetAsDFA">${ICON.load}Load Result into Canvas</button>`),
    card('Construction Steps', stepList(result.steps)));
}

export function subsetConstruction() {
  const syms = [...App.sigma];
  const hasEps = !!getMachineConfig(App.machine)?.hasEpsilon;
  const setKey = set => [...set].sort().join(',');
  const setName = set => { const inner = namesOf(set).sort().join(','); return inner ? `{${inner}}` : '∅'; };
  const acceptsIn = set => [...set].filter(isAccept);
  const moves = contribs => `NFA moves: ${contribs.map(c => c.targets.length ? `${c.name} → {${c.targets.join(',')}}` : `${c.name} → ∅`).join(' · ')}`;
  const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;

  const start = epsClosure(new Set([App.startId]));
  const startName = setName(start);
  const startAccepts = acceptsIn(start);
  const states = [{ name: startName, set: start, isStart: true, isAcc: startAccepts.length > 0 }];
  const visited = new Map([[setKey(start), start]]);
  const queue = [start];
  const trans = [], steps = [];

  // ── the start state: ε-closure(q₀) ──
  const q0Name = nameOf(App.startId);
  const initSubs = [];
  if (hasEps && start.size > 1) initSubs.push(`ε-transitions from ${q0Name} reach: ${namesOf([...start].filter(id => id !== App.startId)).join(', ')}`);
  else if (!hasEps) initSubs.push(`No ε-transitions (NFA mode) — closure is {${q0Name}}`);
  else initSubs.push(`No ε-transitions from ${q0Name}`);
  if (startAccepts.length) {
    initSubs.push(html`Contains accept ${plural(startAccepts.length, 'state')} {${namesOf(startAccepts).join(', ')}} → <span class="step-acc">this DFA state is accepting ★</span>`);
  }
  steps.push(step(html`ε-closure({${q0Name}}) = <em>${startName}</em> <em>(initial DFA state)</em>`, initSubs));

  // ── each DFA state, in the order it was discovered ──
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], curName = setName(cur);
    for (const sym of syms) {
      const moved = new Set();
      const contribs = [...cur].map(sid => {
        const targets = transitionsOn(sid, sym);
        targets.forEach(t => moved.add(t.to));
        return { name: nameOf(sid), targets: targets.map(t => nameOf(t.to)) };
      });
      const preEpsName = setName(moved);
      const next = epsClosure(moved);

      if (!next.size) {
        steps.push(step(html`δ(${curName}, '${sym}') = <span class="step-dead">∅</span>`, [
          cur.size === 1 ? `${contribs[0].name} has no transitions on '${sym}'` : moves(contribs),
          'No reachable states — this maps to the dead/trap state'
        ]));
        continue;
      }

      const nextName = setName(next), nextKey = setKey(next);
      trans.push({ from: curName, sym, to: nextName });
      const isNew = !visited.has(nextKey);
      const nextAccepts = acceptsIn(next);

      const subs = [];
      if (cur.size > 1) {
        subs.push(moves(contribs));
        if (contribs.filter(c => c.targets.length).length > 1) subs.push(`Union of targets = ${preEpsName}`);
      }
      if (next.size > moved.size) subs.push(html`ε-closure(${preEpsName}) = <em>${nextName}</em>`);
      subs.push(isNew ? 'New DFA state discovered — added to processing queue' : 'Already a known DFA state — no new work needed');
      if (isNew && nextAccepts.length) {
        subs.push(html`Contains NFA accept ${plural(nextAccepts.length, 'state')} {${namesOf(nextAccepts).join(', ')}} → <span class="step-acc">accepting ★</span>`);
      }
      steps.push(step(html`δ(${curName}, '${sym}') = <em>${nextName}</em>${isNew && html` <em>(new state!)</em>`}`, subs));

      if (isNew) {
        visited.set(nextKey, next);
        queue.push(next);
        states.push({ name: nextName, set: next, isStart: false, isAcc: nextAccepts.length > 0 });
      }
    }
  }

  const accCount = states.filter(s => s.isAcc).length;
  steps.push(step(html`<span class="step-phase">Construction complete ✓</span>`, [
    html`All reachable subsets explored (queue empty). Resulting DFA has <em>${states.length}</em> ${plural(states.length, 'state')} (${accCount} accepting) and <em>${trans.length}</em> ${plural(trans.length, 'transition')} over Σ = {${syms.join(', ')}}.`
  ]));

  return { states, trans, steps };
}

export function loadSubsetAsDFA() {
  const r = App._lastSubset; if (!r) return;
  const idOf = new Map(r.states.map((ds, i) => [ds.name, 's' + (i + 1)]));
  loadBuiltMachine({
    states: r.states.map((ds, i) => ({
      id: idOf.get(ds.name), x: 120 + (i % 4) * 200, y: 120 + Math.floor(i / 4) * 160,
      name: ds.name.length > 12 ? `D${i}` : ds.name
    })),
    transitions: r.trans.map((t, i) => ({ id: 't' + (i + 1), from: idOf.get(t.from), to: idOf.get(t.to), symbol: t.sym })),
    startId: idOf.get(r.states.find(ds => ds.isStart)?.name) ?? null,
    accepts: r.states.filter(ds => ds.isAcc).map(ds => idOf.get(ds.name)),
    // Σ is the NFA's, edges or not: the DFA is complete over all of it.
    sigma: [...App.sigma]
  }, 'DFA', {
    title: 'Subset construction',
    blurb: 'The DFA the subset construction built from an NFA. Each state stands for the set of NFA states it is named after.'
  });
  showStatus('DFA loaded into canvas!');
}

// ══════════════════════════════════════════════════════════════════
//  DFA MINIMISATION (TABLE FILLING)
// ══════════════════════════════════════════════════════════════════
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The lower triangle of state pairs, marked ✗ where `marked(key)` holds. */
function distinguishabilityTable(states, marked) {
  const header = html`<tr><th></th>${states.slice(0, -1).map(s => html`<th>${s.name}</th>`)}</tr>`;
  const rows = states.slice(1).map((s, i) => html`<tr><th>${s.name}</th>${states.slice(0, i + 1).map(t => {
    const isMarked = marked(pairKey(s.id, t.id));
    return html`<td class="${isMarked ? 'marked' : 'unmarked'}">${isMarked ? '✗' : '≡'}</td>`;
  })}</tr>`);
  return html`<table class="min-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

export function algoMinimize(c) {
  const head = page('DFA Minimization', 'TABLE-FILLING ALGORITHM (MYHILL-NERODE)',
    html`Two states are <em>distinguishable</em> if there exists some string that leads to an accept state from one but not the other. We iteratively mark distinguishable pairs until no new marks can be made.`);
  const refused = needs(['DFA'], 'minimization');
  if (refused) return paint(c, head, refused);
  if (App.states.length < 2) return paint(c, head, notice('Need at least 2 states.'));
  const result = tableFillingMinimize();
  App._lastMin = result;
  const groups = result.groups.map(g => pill(`{${namesOf(g).join(',')}}`, g.length > 1 ? 'acc' : ''));
  paint(c, head,
    card('Distinguishability Table (✗=distinguishable, ≡=equivalent)',
      html`<div class="min-table-wrap">${distinguishabilityTable(result.savedStates, key => result.dist[key])}</div>`),
    card(`Equivalence Classes (${result.groups.length} classes = minimized states)`, pills(groups)),
    card('Algorithm Steps', stepList(result.steps.map(s => s.html))),
    actions(html`<button class="algo-btn" data-action="algo.loadMinimizedDFA">Load Minimized DFA</button>`));
}

export function tableFillingMinimize() {
  const reachable = getReachableStates(App.startId);
  const states = App.states.filter(s => reachable.has(s.id));
  const ids = states.map(s => s.id);
  const dist = {}, steps = [];
  // What loadMinimizedDFA builds from, so a later edit cannot change it.
  const savedTrans = App.transitions.filter(t => reachable.has(t.from) && reachable.has(t.to)).map(t => ({ ...t }));
  const savedStates = states.map(s => ({ ...s }));
  const savedAccepts = new Set([...App.accepts].filter(id => reachable.has(id)));
  const savedStart = App.startId;
  const delta = new Map(savedTrans.map(t => [`${t.from}\u0000${t.symbol}`, t.to]));
  const next = (id, sym) => delta.get(`${id}\u0000${sym}`);

  if (states.length !== App.states.length) {
    const discarded = App.states.filter(s => !reachable.has(s.id)).map(s => s.name);
    steps.push({
      type: 'discard',
      html: step(`Discard ${App.states.length - states.length} unreachable state(s) before minimization.`,
        [`Removed: {${discarded.join(', ')}}`, `Remaining: ${states.length} reachable states to minimize`])
    });
  }

  // ── base case: accepting against non-accepting ──
  let marked = 0;
  ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
    const key = pairKey(a, b);
    dist[key] = isAccept(a) !== isAccept(b);
    if (dist[key]) marked++;
  }));
  const accNames = states.filter(s => isAccept(s.id)).map(s => s.name);
  const nonAccNames = states.filter(s => !isAccept(s.id)).map(s => s.name);
  steps.push({
    type: 'base',
    html: step(html`<em>Base case:</em> Mark all pairs where one state is accepting and the other is not.`, [
      `Accept states F = {${accNames.join(', ') || '∅'}} · Non-accept = {${nonAccNames.join(', ') || '∅'}}`,
      html`Marked <em>${marked}</em> pair(s) as distinguishable in this step`,
      'Reasoning: an accept state and a non-accept state are trivially distinguishable — the empty string ε distinguishes them'
    ])
  });

  // ── refine until nothing changes ──
  let changed = true, iter = 0;
  while (changed && iter <= ids.length * ids.length) {
    changed = false; iter++;
    ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
      const key = pairKey(a, b);
      if (dist[key]) return;
      const aName = nameOf(a), bName = nameOf(b);
      for (const sym of App.sigma) {
        const da = next(a, sym), db = next(b, sym);
        if (da === db) continue;
        const both = da && db;
        if (both && !dist[pairKey(da, db)]) continue;
        dist[key] = true; changed = true; marked++;
        const why = both
          ? `(${nameOf(da)}, ${nameOf(db)}) is already marked ✗ → (${aName}, ${bName}) must also be distinguishable`
          : `${da ? bName : aName} has no transition on '${sym}' (implicit dead/trap) — states are distinguishable`;
        steps.push({
          type: 'mark', p1: a, p2: b,
          html: step(html`Mark (<em>${aName}</em>, <em>${bName}</em>) as distinguishable`, [
            `Iteration ${iter}: examining unmarked pair (${aName}, ${bName}) on symbol '${sym}'`,
            `δ(${aName}, '${sym}') = ${da ? nameOf(da) : '∅'} · δ(${bName}, '${sym}') = ${db ? nameOf(db) : '∅'}`,
            why
          ])
        });
        return;
      }
    }));
  }

  const totalPairs = ids.length * (ids.length - 1) / 2;
  steps.push({
    type: 'fixed',
    html: step(html`<span class="step-phase">Fixed point reached ✓</span>`, [
      `Completed after ${iter} iteration(s) — no new pairs could be marked`,
      html`Total pairs: <em>${totalPairs}</em> · Marked (✗ distinguishable): <em>${marked}</em> · Unmarked (≡ equivalent): <em>${totalPairs - marked}</em>`
    ])
  });

  // ── the classes the unmarked pairs leave ──
  const assigned = new Set(), groups = [];
  for (const a of ids) {
    if (assigned.has(a)) continue;
    const group = [a, ...ids.filter(b => !assigned.has(b) && b !== a && !dist[pairKey(a, b)])];
    group.forEach(id => assigned.add(id));
    groups.push(group);
  }

  const classLines = groups.map((g, i) => html`Class ${i + 1}: {${namesOf(g).join(', ')}}${g.length > 1 && ' — these states are indistinguishable (≡)'}${g.some(isAccept) && html` <span class="step-acc">★ accepting</span>`}`);
  classLines.push(groups.length < states.length
    ? html`Minimized DFA: <em>${groups.length}</em> states (reduced from ${states.length})`
    : 'DFA is already minimal — no states could be merged');
  steps.push({ type: 'summary', html: step(html`<span class="step-phase">Merge equivalent states → ${groups.length} equivalence classes</span>`, classLines) });

  return { dist, groups, steps, savedTrans, savedStates, savedAccepts, savedStart };
}

export function loadMinimizedDFA() {
  const r = App._lastMin; if (!r) return;
  const { groups, savedTrans, savedStates, savedAccepts, savedStart } = r;
  const groupOf = new Map();
  groups.forEach((g, i) => g.forEach(id => groupOf.set(id, 's' + (i + 1))));
  const savedName = id => savedStates.find(s => s.id === id)?.name || id;
  const states = groups.map((g, i) => ({
    id: 's' + (i + 1), x: 160 + (i % 4) * 200, y: 150 + Math.floor(i / 4) * 160, name: g.map(savedName).join('/')
  }));
  const seen = new Set(), transitions = [];
  for (const t of savedTrans) {
    const from = groupOf.get(t.from), to = groupOf.get(t.to);
    if (!from || !to) continue;
    const key = `${from}|${t.symbol}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transitions.push({ ...t, id: 't' + (transitions.length + 1), from, to });
  }
  loadBuiltMachine({
    states, transitions,
    startId: groupOf.get(savedStart) ?? null,
    accepts: groups.filter(g => g.some(id => savedAccepts.has(id))).map(g => groupOf.get(g[0])),
    sigma: [...App.sigma]
  }, 'DFA', {
    title: 'Minimised DFA',
    blurb: 'The DFA with its indistinguishable states merged by table filling. A merged state is named after the states it stands for.'
  });
  showStatus(`Minimized: ${groups.length} states (was ${savedStates.length})`);
}

// ══════════════════════════════════════════════════════════════════
//  REGEX → NFA (THOMPSON)
// ══════════════════════════════════════════════════════════════════
const REGEX_SYNTAX = html`<b>Supported</b>: <b>|</b> union · <b>*</b> Kleene star · <b>+</b> one-or-more · <b>?</b> optional · <b>()</b> grouping · <b>[abc]</b> char class · <b>[a-z]</b> ranges · <b>{n,m}</b> bounds · ε = epsilon`;

export function algoRE2NFA(c) {
  paint(c, page('Regex → NFA', "THOMPSON'S CONSTRUCTION", html`Build NFA fragments for each regex operator:<br>
<em>• Literal a</em>: q₀ →ᵃ q₁<br>
<em>• Concatenation ab</em>: NFA(a) ε→ NFA(b)<br>
<em>• Union a|b</em>: new start ε→ NFA(a), ε→ NFA(b); both ε→ new accept<br>
<em>• Kleene a*</em>: new start/accept, ε loops on NFA(a)`),
  card('Input Regular Expression', html`<div class="regex-input-wrap">
  <input class="inp regex-inp" id="re-input" placeholder="e.g. (a|b)*abb or [a-z]{2,5}" data-action="keydown.enter->algo.doThompson">
  <button class="algo-btn" data-action="algo.doThompson">Build NFA</button>
</div>
<div class="algo-hint">${REGEX_SYNTAX}<br>
<b>.</b> is any printable character and <b>[^abc]</b> its complement in that range — not Σ.<br>
This tool uses the mathematical/textbook notation for Thompson's construction.</div>`),
  html`<div id="re-result"></div>`);
}

/** A fragment's transitions, start in green and accept in gold. */
function fragmentTable(nfa) {
  return table(['From', 'Symbol', 'To'], nfa.trans.map(t => html`<tr><td class="${t.from === nfa.start ? 'start-cell' : ''}">${t.from}</td><td class="sym-cell">${t.sym}</td><td class="${t.to === nfa.accept ? 'acc-cell' : ''}">${t.to}</td></tr>`));
}

export function doThompson() {
  const re = $('re-input').value.trim();
  if (!re) { showStatus('Enter a regex first'); return; }
  let nfa;
  try { nfa = thompsonBuild(re); } catch (err) {
    paint($('re-result'), notice(`Parse error: ${err.message}`, 'is-error'));
    return;
  }
  App._lastThompson = { ...nfa, re };
  const statePills = nfa.states.map(s => {
    const start = s === nfa.start, accept = s === nfa.accept;
    return pill(`${s}${start ? ' (start)' : ''}${accept ? ' (accept)' : ''}`, start && accept ? 'both' : start ? 'start' : accept ? 'acc' : '');
  });
  paint($('re-result'),
    card(`NFA States: ${nfa.states.length}`, pills(statePills)),
    card(`Transitions (${nfa.trans.length})`, fragmentTable(nfa)),
    actions(html`<button class="algo-btn has-icon" data-action="algo.loadThompsonNFA">${ICON.load}Load into Canvas</button>`));
}

export function loadThompsonNFA() {
  const d = App._lastThompson; if (!d) return;
  const idOf = new Map(d.states.map((s, i) => [s, 's' + (i + 1)]));
  const cols = Math.ceil(Math.sqrt(d.states.length)) + 1;
  // No sigma: Σ is what the expression reads, which is what the edges read.
  // It used to be added to the Σ already there, so the old machine's symbols
  // stayed in the alphabet of one that never reads them.
  loadBuiltMachine({
    states: d.states.map((s, i) => ({ id: idOf.get(s), x: 100 + (i % cols) * 130, y: 100 + Math.floor(i / cols) * 120, name: s })),
    transitions: d.trans.map((t, i) => ({ id: 't' + (i + 1), from: idOf.get(t.from), to: idOf.get(t.to), symbol: t.sym })),
    startId: idOf.get(d.start) ?? null,
    accepts: [idOf.get(d.accept)].filter(Boolean)
  }, 'ε-NFA', {
    title: 'Thompson NFA',
    blurb: d.re ? `The ε-NFA Thompson's construction built for \`${d.re}\`.` : 'The ε-NFA Thompson\'s construction built for a regular expression.'
  });
  showStatus('NFA loaded from Thompson\'s construction!');
}

// ══════════════════════════════════════════════════════════════════
//  NFA → REGEX
// ══════════════════════════════════════════════════════════════════
export function algoNFA2RE(c) {
  const head = page('NFA → Regular Expression', 'GNFA STATE ELIMINATION METHOD',
    html`Convert the NFA to a <em>Generalized NFA (GNFA)</em> with a new start and accept state, then eliminate states one by one, merging their transitions into regular expressions on edges.`);
  if (!App.startId) return paint(c, head, notice('No start state defined.'));
  paint(c, head,
    card('Derived Regular Expression', html`<div class="algo-regex-out">${deriveRegex()}</div>`),
    isClassicPDA(App.machine) && notice('Note: DPDA and NPDA recognize context-free languages, not regular languages. The regex shown is derived from NFA/DFA states only.', 'tone-muted'));
}

// ══════════════════════════════════════════════════════════════════
//  ε-NFA → NFA
// ══════════════════════════════════════════════════════════════════
export function buildEpsNFAEliminationResult() {
  if (!App.startId) return null;
  const eps = App.config.sym.eps;
  const syms = [...App.sigma].filter(sym => sym !== eps);
  const steps = [];
  const transitions = [];
  const accepts = new Set();
  const closures = new Map(App.states.map(s => [s.id, epsClosure(new Set([s.id]))]));
  const setOf = ids => `{${namesOf(ids).join(', ')}}`;

  steps.push(step(html`<span class="step-phase">Phase 1: Compute ε-closures</span>`,
    App.states.map(s => `E(${s.name}) = ${setOf(closures.get(s.id))}`)));

  const promoted = [];
  for (const s of App.states) {
    if (![...closures.get(s.id)].some(isAccept)) continue;
    accepts.add(s.id);
    promoted.push(isAccept(s.id)
      ? html`State <em>${s.name}</em> remains <span class="step-acc">★ Accept</span>`
      : html`State <em>${s.name}</em> promoted to <span class="step-acc">★ Accept</span> (ε-reachable to an original accept state)`);
  }
  steps.push(step(html`<span class="step-phase">Phase 2: Update Accept States</span>`,
    promoted.length ? promoted : ['No new accept states discovered from ε-paths']));

  steps.push(step(html`<span class="step-phase">Phase 3: Resolve Direct Transitions</span>`));
  let added = 0;
  for (const s of App.states) {
    const reach = closures.get(s.id);
    for (const sym of syms) {
      const mid = new Set();
      reach.forEach(id => transitionsOn(id, sym).forEach(t => mid.add(t.to)));
      const dests = epsClosure(mid);
      if (!dests.size) continue;
      dests.forEach(to => transitions.push({ from: s.id, to, symbol: sym }));
      added += dests.size;
      steps.push(step(`Routing ${s.name} on '${sym}'`, [
        `ε-reach: ${setOf(reach)}`,
        `Read '${sym}' → ${mid.size ? setOf(mid) : '{∅}'}`,
        `ε-reach from midpoints → ${setOf(dests)}`,
        html`<b>Result:</b> Adding ${dests.size} direct transition(s) to targets`
      ]));
    }
  }

  const epsCount = App.transitions.filter(t => t.symbol === eps).length;
  steps.push(step(html`<span class="step-phase">Phase 4: Cleanup &amp; Summary</span>`, [
    `Discarded ${epsCount} original ε-transition(s)`,
    `Generated ${added} new direct transition(s) mapping the combined paths`,
    `Final NFA contains ${App.states.length} states and ${transitions.length} transitions`
  ]));

  return { steps, transitions, accepts };
}

export function algoEpsNFA2NFA(c) {
  const head = page('ε-NFA → NFA', 'EPSILON ELIMINATION',
    'Any NFA with epsilon transitions can be converted into an equivalent NFA without epsilon transitions. This is done by adding direct transitions that bypass the original ε-paths, and promoting states to accept states if they can reach an accept state purely via ε.');
  const refused = needs(['ε-NFA'], 'ε-elimination');
  if (refused) return paint(c, head, refused);
  const result = buildEpsNFAEliminationResult();
  if (!result) return paint(c, head, notice('No start state defined.', 'dec-card-empty'));
  paint(c, head,
    card('Algorithm Steps', stepList(result.steps)),
    actions(html`<button class="algo-btn" data-action="algo.loadEpsEliminatedNFA">Load NFA without ε-transitions</button>`));
}

export function loadEpsEliminatedNFA() {
  const r = buildEpsNFAEliminationResult();
  if (!r) return showStatus('No start state defined.');
  commit(() => {
    App.transitions = r.transitions.map((t, i) => ({ id: 't' + (i + 1), ...t }));
    App.transN = App.transitions.length;
    App.accepts = new Set(r.accepts);
    showExampleCard({ title: 'NFA without ε-moves', blurb: 'The same language, with each ε-move folded into the moves on a symbol that follow it.' });
    applyMachineSwitch('NFA');
  }, Change.META, Change.GRAPH);
  revealOnCanvas('NFA loaded into canvas! (ε-transitions eliminated)');
}

// ══════════════════════════════════════════════════════════════════
//  COMPLEMENT AND PRODUCT
// ══════════════════════════════════════════════════════════════════
export function algoComplement(c) {
  const head = page('DFA Complement', 'CLOSURE UNDER COMPLEMENT',
    html`The complement of a DFA is obtained by <em>swapping accept and non-accept states</em>. First, ensure the DFA is complete (add a dead/trap state if needed).`);
  const refused = needs(['DFA'], 'the complement');
  if (refused) return paint(c, head, refused);
  const flipped = App.states.map(s => pill(`${s.name} → ${isAccept(s.id) ? 'REJECT' : 'ACCEPT'}`, isAccept(s.id) ? '' : 'acc'));
  paint(c, head,
    card('Complemented States', html`${pills(flipped)}<div class="algo-note is-after">Note: Original accept states become non-accepting and vice versa. All transitions remain the same.</div>`),
    actions(html`<button class="algo-btn has-icon" data-action="algo.loadComplement">${ICON.load}Load Complement into Canvas</button>`));
}

export function loadComplement() {
  commit(() => {
    // Complete the DFA first: a trap state for every missing move (#9).
    const syms = [...App.sigma];
    const missing = s => syms.filter(sym => !transitionsOn(s.id, sym).length);
    if (App.states.some(s => missing(s).length)) {
      const trapId = 's' + (++App.stateN);
      App.states.push({ id: trapId, x: 80, y: 80, name: 'trap' });
      for (const s of App.states) {
        for (const sym of missing(s)) App.transitions.push({ id: 't' + (++App.transN), from: s.id, to: trapId, symbol: sym });
      }
    }
    App.accepts = new Set(App.states.filter(s => !isAccept(s.id)).map(s => s.id));
    // The states are the same states, so the notes still describe them; the
    // card described the language, and this is the other one.
    showExampleCard({ title: 'Complement', blurb: 'The DFA with its accepting and rejecting states swapped, completed with a trap state where a move was missing.' });
  }, Change.META, Change.GRAPH);
  revealOnCanvas('Complement loaded (DFA completed with trap state if needed)!');
}

export function algoProduct(c) {
  const rules = [
    'States: Q₁×Q₂ (pairs of states from each DFA)', 'Start state: (q₀¹, q₀²)', 'Transitions: δ((p,q),a) = (δ₁(p,a), δ₂(q,a))',
    'Accept (Intersection): (p,q)∈F iff p∈F₁ AND q∈F₂', 'Accept (Union): (p,q)∈F iff p∈F₁ OR q∈F₂', 'Accept (Difference L₁\\L₂): p∈F₁ AND q∉F₂'
  ];
  paint(c, page('Product Construction', 'CLOSURE UNDER INTERSECTION AND UNION',
    html`Given two DFAs M₁ and M₂ over the same alphabet, their <em>product automaton</em> M₁×M₂ simulates both simultaneously. States are pairs (q₁,q₂). Used to prove closure under ∩ (both accept) and ∪ (either accepts).`),
  card('Algorithm', stepList(rules.map(r => String(html`${r}`)))));
}

// ══════════════════════════════════════════════════════════════════
//  EQUIVALENCE
// ══════════════════════════════════════════════════════════════════
// Both equivalence cards — the one in the conversions and the decision
// procedure — ask the same question of the same product, so they share the
// asking and differ only in what they print.

const m2Status = (short = false) => App.workspaceB
  ? html`<span class="m2-status saved">M₂${short ? '' : ' saved'}: ${App.workspaceB.states.length} states</span>`
  : html`<span class="m2-status">No M₂${short ? '' : ' saved'}</span>`;

const saveM2Button = html`<button class="ws-save-btn" data-action="workspace.saveWorkspaceB">Save Current as M₂</button>`;

const isDfaSnapshot = m => (!m.machine || m.machine === 'DFA') && isDeterministicMachine(m);

function checkEquivalence() {
  if (!App.workspaceB) return { error: 'Save an M₂ first using the button above.' };
  if (App.machine !== 'DFA') return { error: 'Switch to DFA mode for product construction.' };
  if (!isDfaSnapshot(App.workspaceB)) return { error: 'M₂ must be a DFA for product-based equivalence checking.' };
  const product = buildProductDFA(getCurrentMachineSnapshot(), App.workspaceB, 'diff');
  const reachable = getReachableStates(product.startId, product.transitions);
  const distinguishing = product.accepts.filter(id => reachable.has(id));
  return { product, distinguishing, witness: distinguishing.length ? findShortestAccepted(product) : null };
}

const shownWord = w => (w === '' ? App.config.sym.eps : `"${w}"`);

export function algoEquiv(c) {
  paint(c, page('DFA Equivalence', 'ARE TWO DFAs EQUIVALENT?',
    'Two DFAs are equivalent iff they accept exactly the same language. We check equivalence by minimizing both and comparing, or by running the product construction on their symmetric difference (L₁△L₂ = ∅).'),
  card('Method A: String Testing', html`<div class="algo-note">Test if a specific string is accepted:</div>
<div class="row is-after">
  <input class="inp" id="eq-str" placeholder="Enter a test string" autocomplete="off" data-action="suggest.symbols">
  <button class="algo-btn" data-action="algo.testEquivStr">Test</button>
</div>
<div id="eq-result" class="algo-out"></div>`),
  card('Method B: Product Construction (L₁△L₂ = ∅)', html`<div class="algo-note is-before">L₁ = L₂ iff their symmetric difference is empty.<br>
Load a second automaton as M₂, then run the check.<br>
M₂ status: ${m2Status()}</div>
${saveM2Button}
<button class="algo-btn sec" data-action="algo.runProductEquiv">Check Equivalence via Product</button>
<div id="eq-product-result" class="algo-out"></div>`));
}

export function testEquivStr() {
  const str = $('eq-str').value.trim();
  const tokens = tokenize(str === App.config.sym.eps ? '' : str);
  const out = $('eq-result');
  if (tokens === null) return paint(out, html`<div class="algo-verdict-line tone-no">Cannot tokenize string using the alphabet Σ.</div>`);
  // langVerdict dispatches per machine, so this reports what the simulator the
  // user can actually run would say — rather than assuming NFA semantics for
  // anything that is not a DFA.
  const v = langVerdict(tokens);
  if (v === 'unk') return paint(out, html`<div class="algo-verdict-line tone-muted">"${str}" — no verdict within the step budget.</div>`);
  const accepted = v === 'acc';
  paint(out, html`<div class="algo-verdict-line ${accepted ? 'tone-yes' : 'tone-no'}">"${str}" is ${accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} by the current automaton.</div>`);
}

export function runProductEquiv() {
  const r = checkEquivalence();
  const out = $('eq-product-result');
  if (r.error) return paint(out, verdict(false, r.error));
  paint(out, r.distinguishing.length
    ? verdict(false, html`NOT EQUIVALENT ✗ — Symmetric difference is non-empty.<br>Distinguishing string: ${shownWord(r.witness)}`)
    : verdict(true, 'EQUIVALENT ✓ — Symmetric difference is empty. L(M₁) = L(M₂)'));
}

export function algoFullEquiv(c) {
  const head = html`${page('Full Equivalence Check', 'L(M₁) = L(M₂) VIA SYMMETRIC DIFFERENCE',
    'Two automata are equivalent iff their symmetric difference L(M₁)△L(M₂) = ∅. Build the product DFA with accept condition: (p,q) accepts iff exactly one of p, q is accepting. Then check emptiness.')}
${card(html`M₂ Status: ${m2Status()}`, html`${saveM2Button}<button class="ws-save-btn" data-action="workspace.loadWorkspaceB">Restore M₂ to Canvas</button>`)}`;
  if (!App.workspaceB) {
    return paint(c, head, notice(html`<div class="algo-note">To check equivalence:<br>
1. Build or load the machine you want as M₂ on the canvas<br>
2. Come back here and click "Save Current as M₂"<br>
3. Build or load M₁ on the canvas — it is the machine the check compares against M₂<br>
4. Come back and click "Run Equivalence Check"</div>`, 'dec-card-empty'));
  }
  paint(c, head,
    actions(html`<button class="algo-btn" data-action="algo.runFullEquivCheck">Run Equivalence Check</button>`),
    html`<div id="full-equiv-result" class="algo-out"></div>`);
}

export function runFullEquivCheck() {
  const r = checkEquivalence();
  const out = $('full-equiv-result');
  if (r.error) return paint(out, verdict(false, r.error));
  if (!r.distinguishing.length) return paint(out, verdict(true, html`EQUIVALENT ✓ — L(M₁) = L(M₂)<br>The symmetric difference DFA is empty.`));
  paint(out,
    verdict(false, html`NOT EQUIVALENT ✗ — L(M₁) ≠ L(M₂)<br>Distinguishing string: ${shownWord(r.witness)}`),
    card('Symmetric Difference Product DFA', html`<div class="algo-note">Product states: ${r.product.states.length}<br>
Product accept states (distinguishing): ${r.distinguishing.length}<br>
Accept condition: exactly one of the component states is accepting</div>`, 'is-after'));
}

// ══════════════════════════════════════════════════════════════════
//  REACHABILITY
// ══════════════════════════════════════════════════════════════════
function adjacency(transitions, reverse = false) {
  const out = new Map();
  for (const t of transitions) {
    const [a, b] = reverse ? [t.to, t.from] : [t.from, t.to];
    const list = out.get(a);
    if (list) list.push(b); else out.set(a, [b]);
  }
  return out;
}

function closureOver(seeds, next) {
  const seen = new Set(seeds), queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const v of next.get(queue[i]) || []) if (!seen.has(v)) { seen.add(v); queue.push(v); }
  }
  return seen;
}

/** The states reachable from `startId`, over `transitions` (the canvas's by default). */
export function getReachableStates(startId, transitions = App.transitions) {
  return startId ? closureOver([startId], adjacency(transitions)) : new Set();
}

/** The states some accepting state can be reached from. */
export function getCoReachableStates(accepts = App.accepts, transitions = App.transitions) {
  return closureOver(accepts, adjacency(transitions, true));
}

/** Whether the canvas's transitions, kept within `stateSet`, contain a cycle. */
export function hasReachableCycle(stateSet) {
  const next = adjacency(App.transitions.filter(t => stateSet.has(t.from) && stateSet.has(t.to)));
  const GRAY = 1, BLACK = 2, color = new Map();
  const visit = u => {
    color.set(u, GRAY);
    for (const v of next.get(u) || []) {
      if (color.get(v) === GRAY) return true;
      if (!color.has(v) && visit(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };
  return [...stateSet].some(s => !color.has(s) && visit(s));
}

/**
 * A shortest word `machine` accepts, as its symbols joined, or null when it
 * accepts nothing. Breadth-first over states, so it terminates on any
 * finite machine and the word it returns is never longer than it needs be.
 */
export function findShortestAccepted(machine) {
  if (!machine.startId) return null;
  const accepts = new Set(machine.accepts);
  const out = new Map();
  for (const t of machine.transitions) {
    const list = out.get(t.from);
    if (list) list.push(t); else out.set(t.from, [t]);
  }
  const via = new Map([[machine.startId, null]]);
  const queue = [machine.startId];
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    if (accepts.has(s)) {
      const word = [];
      for (let at = via.get(s); at; at = via.get(at.from)) word.push(at.symbol);
      return word.reverse().join('');
    }
    for (const t of out.get(s) || []) {
      if (!via.has(t.to)) { via.set(t.to, { from: s, symbol: t.symbol }); queue.push(t.to); }
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  DECISION ALGORITHMS
// ══════════════════════════════════════════════════════════════════
const decision = (cls, ok, headline, tone, explanation) =>
  card(null, html`<div class="algo-verdict ${tone}">${headline}</div><div class="algo-note is-after">${explanation}</div>`, cls);

export function algoIsEmpty(c) {
  const head = page('Is L(M) Empty?', 'REACHABILITY FROM START STATE',
    'A language is empty iff no accept state is reachable from the start state via BFS/DFS on the transition graph.');
  if (!App.startId) return paint(c, head, notice('No start state defined.', 'dec-card-empty'));
  const reachable = getReachableStates(App.startId);
  const reachableAccepts = [...App.accepts].filter(id => reachable.has(id));
  const isEmpty = reachableAccepts.length === 0;
  const cls = isEmpty ? 'dec-card-empty' : 'dec-card-nonempty';
  paint(c, head,
    card(`Reachable States (${reachable.size} of ${App.states.length})`,
      pills([...reachable].map(id => pill(`${nameOf(id)}${isAccept(id) ? ' ★' : ''}`, roleClass(id))), html`<span class="tone-muted">None</span>`), cls),
    decision(cls, !isEmpty, isEmpty ? 'EMPTY ∅' : 'NON-EMPTY ✓', isEmpty ? 'tone-no' : 'tone-yes',
      isEmpty ? 'No accept state is reachable from the start → L(M) = ∅' : `Accept states reachable: {${namesOf(reachableAccepts).join(', ')}}`));
}

export function algoIsFinite(c) {
  const head = page('Is L(M) Finite?', 'CYCLE DETECTION ON USEFUL STATES',
    'A regular language is finite iff the minimal DFA for it has no cycles among "useful" states (reachable from start AND can reach an accept state). Equivalently: the shortest/longest accepted string has bounded length.');
  if (!App.startId) return paint(c, head, notice('No start state defined.'));
  const fwd = getReachableStates(App.startId);
  const bwd = getCoReachableStates();
  const useful = new Set([...fwd].filter(id => bwd.has(id)));
  const isFinite = !hasReachableCycle(useful);
  paint(c, head,
    card(`Useful States (reachable from start AND can reach accept): ${useful.size}`,
      pills([...useful].map(id => pill(nameOf(id), roleClass(id))), html`<span class="tone-muted">None (language is empty)</span>`)),
    decision(isFinite ? 'dec-card-finite' : 'dec-card-infinite', isFinite, isFinite ? 'FINITE ✓' : 'INFINITE ∞', isFinite ? 'tone-yes' : 'tone-warn',
      isFinite ? 'No cycles among useful states → L(M) is a finite set of strings.' : 'There is a cycle among useful states → L(M) contains infinitely many strings (due to the cycle allowing repetition).'));
}

export function algoIsUniversal(c) {
  const head = page('Is L(M) Universal?', 'L(M) = Σ* ? (DFA ONLY)',
    'A DFA accepts Σ* iff its complement accepts ∅. Complement the DFA (swap accepts/non-accepts, add trap state for missing transitions), then check if the complement\'s language is empty.');
  const refused = needs(['DFA'], 'the universality check');
  if (refused) return paint(c, head, html`<div class="dec-card-notuniversal">${refused}</div>`);
  if (!App.startId) return paint(c, head, notice('No start state defined.', 'dec-card-notuniversal'));
  // Complete the DFA with a trap, then complement it: the trap rejects in the
  // original, so it accepts in the complement.
  const trapId = '__trap__';
  const trapMoves = [];
  for (const s of App.states) {
    for (const sym of App.sigma) if (!transitionsOn(s.id, sym).length) trapMoves.push({ from: s.id, to: trapId, symbol: sym });
  }
  const compAccepts = new Set([...App.states.filter(s => !isAccept(s.id)).map(s => s.id), trapId]);
  const reachable = getReachableStates(App.startId, [...App.transitions, ...trapMoves]);
  const reached = [...compAccepts].filter(id => reachable.has(id));
  const isUniversal = reached.length === 0;
  const label = id => (id === trapId ? 'trap' : nameOf(id));
  const original = [...compAccepts].filter(id => id !== trapId);
  paint(c, head,
    card('Complement Analysis', html`<div class="algo-note">Added ${trapMoves.length} trap transitions.<br>
Complement accept states (non-original-accept): {${namesOf(original).join(', ') || '∅'}}${trapMoves.length > 0 && ' + trap'}<br>
Reachable complement accept states: ${reached.length ? `{${reached.map(label).join(',')}}` : '∅'}</div>`),
    decision(isUniversal ? 'dec-card-universal' : 'dec-card-notuniversal', isUniversal,
      isUniversal ? 'UNIVERSAL ✓  L(M) = Σ*' : 'NOT UNIVERSAL ✗  L(M) ≠ Σ*', isUniversal ? 'tone-yes' : 'tone-no',
      isUniversal ? 'Complement DFA has empty language → original DFA accepts everything.' : 'Complement DFA is non-empty → some strings are rejected.'));
}

// ══════════════════════════════════════════════════════════════════
//  PRODUCT DFA BUILDER
// ══════════════════════════════════════════════════════════════════
/** M₁ × M₂ over the union of their alphabets, each completed with its own trap. */
export function buildProductDFA(m1, m2, mode) {
  // mode: 'intersection' | 'union' | 'diff' (symmetric difference)
  const sigma = [...new Set([...(m1.sigma || []), ...(m2.sigma || [])])];
  const trap1 = '__trap1__', trap2 = '__trap2__';
  const acc1 = new Set(m1.accepts), acc2 = new Set(m2.accepts);
  const deltaOf = (m, trap) => {
    const d = new Map(m.transitions.map(t => [`${t.from}\u0000${t.symbol}`, t.to]));
    return (state, sym) => (state === trap ? trap : d.get(`${state}\u0000${sym}`) ?? trap);
  };
  const delta1 = deltaOf(m1, trap1), delta2 = deltaOf(m2, trap2);
  const accepting = (s1, s2) => {
    const a1 = acc1.has(s1), a2 = acc2.has(s2);
    if (mode === 'intersection') return a1 && a2;
    if (mode === 'union') return a1 || a2;
    if (mode === 'diff') return a1 !== a2;
    return false;
  };
  const startId = `${m1.startId}|${m2.startId}`;
  const states = [], transitions = [], accepts = [];
  const visited = new Set([startId]);
  const queue = [[m1.startId, m2.startId]];
  for (let i = 0; i < queue.length; i++) {
    const [s1, s2] = queue[i];
    const id = `${s1}|${s2}`;
    states.push({ id, name: `(${s1},${s2})` });
    if (accepting(s1, s2)) accepts.push(id);
    for (const sym of sigma) {
      const n1 = delta1(s1, sym), n2 = delta2(s2, sym);
      const to = `${n1}|${n2}`;
      transitions.push({ id: `t_${id}_${sym}`, from: id, to, symbol: sym });
      if (!visited.has(to)) { visited.add(to); queue.push([n1, n2]); }
    }
  }
  return { states, transitions, startId, accepts, sigma };
}

export function isDeterministicMachine(machine) {
  if (!machine || !machine.startId || !machine.transitions) return false;
  const seen = new Set();
  for (const t of machine.transitions) {
    if (t.symbol === App.config.sym.eps) return false;
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  CLOSURE OPERATIONS
// ══════════════════════════════════════════════════════════════════
/** Null once an M₂ is saved; until then, the card that says how to save one. */
export function m2RequiredCard(opName) {
  if (App.workspaceB) return null;
  return card(`M₂ Required for ${opName}`, html`<div class="algo-note is-before">First save your M₂:<br>
1. Build or load your second machine on the canvas<br>
2. Come back to Algorithms and click the button below<br>
3. Then load the first machine and come back here</div>${saveM2Button}`, 'dec-card-empty');
}

const m2Card = () => card(html`M₂ Status: ${m2Status(true)}`, saveM2Button);

/** A constructed machine's card and the button that loads it. */
function builtResult(key, machine, title) {
  App._lastBuiltNFA = { key, machine };
  return html`${renderBuiltNFAResult(machine, title)}${actions(html`<button class="algo-btn has-icon" data-action="algo.loadBuiltNFAResult" data-op="${key}">${ICON.load}Load Result into Canvas</button>`)}`;
}

function unaryClosure(c, key, header, build, title) {
  if (!App.startId || !App.states.length) return paint(c, header, notice('Build an automaton first.'));
  paint(c, header, builtResult(key, build(getCurrentMachineSnapshot()), title));
}

export function algoClopStar(c) {
  unaryClosure(c, 'star', page('Kleene Star (NFA Construction)', 'L* = {ε} ∪ L ∪ LL ∪ LLL ∪ ...', html`To build NFA for L*:<br>
1. Add new start state q_new (also accepting, for ε)<br>
2. Add ε-transition from q_new to original start<br>
3. Add ε-transitions from each original accept back to original start<br>
4. q_new is the only accept state (plus original accepts remain accepting)`), buildNFAStar, 'Kleene Star NFA');
}

export function algoClopReversal(c) {
  unaryClosure(c, 'reversal', page('Reversal (NFA Construction)', 'L^R = {w^R : w ∈ L}', html`To build NFA for L^R:<br>
1. Reverse all transitions (swap from/to)<br>
2. Swap start and accept states (new start = old accepts, new accept = old start)<br>
3. If multiple old accepts, add new start with ε to each`), buildNFAReversal, 'Reversal NFA');
}

function binaryClosure(c, key, header, opName, build, title) {
  const missing = m2RequiredCard(opName);
  if (missing) return paint(c, header, missing);
  if (!App.startId) return paint(c, header, emptyCanvasCard('M₁'));
  paint(c, header, builtResult(key, build(getCurrentMachineSnapshot(), App.workspaceB), title));
}

export function algoClopUnion(c) {
  binaryClosure(c, 'union', html`${page('Union with M₂ (NFA Construction)', 'L(M₁) ∪ L(M₂)',
    'Add a new start state with ε-transitions to both original start states. Both original accept states remain accepting.')}${m2Card()}`,
  'Union', buildNFAUnion, 'Union NFA');
}

export function algoClopConcat(c) {
  binaryClosure(c, 'concat', html`${page('Concatenation with M₂ (NFA Construction)', 'L(M₁) · L(M₂)',
    "Add ε-transitions from each M₁ accept state to M₂'s start state. M₁'s accept states become non-accepting; M₂'s accept states are the result's accept states.")}${m2Card()}`,
  'Concatenation', buildNFAConcat, 'Concatenation NFA');
}

export function algoClopIntersect(c) {
  const head = html`${page('Intersection with M₂ (Product DFA)', 'L(M₁) ∩ L(M₂)',
    'Build the product DFA: states are pairs (q₁, q₂). Accept iff BOTH component states are accepting.')}${m2Card()}`;
  if (App.machine !== 'DFA') return paint(c, head, notice('Intersection via product construction currently requires M₁ to be a DFA.', 'is-error'));
  const missing = m2RequiredCard('Intersection');
  if (missing) return paint(c, head, missing);
  if (!App.startId) return paint(c, head, emptyCanvasCard('M₁'));
  if (!isDfaSnapshot(App.workspaceB)) return paint(c, head, notice('M₂ must be a DFA for product construction.', 'is-error'));
  const product = buildProductDFA(getCurrentMachineSnapshot(), App.workspaceB, 'intersection');
  App._lastBuiltNFA = { key: 'intersect', machine: product };
  const reachable = getReachableStates(product.startId, product.transitions);
  const reachableStates = product.states.filter(s => reachable.has(s.id));
  const accepting = new Set(product.accepts);
  const rows = reachableStates.slice(0, 20).map(s => html`<tr><td class="${accepting.has(s.id) ? 'acc-cell' : ''}">${s.name}</td><td>${accepting.has(s.id) ? '✓ Yes' : 'No'}</td></tr>`);
  paint(c, head,
    card('Product DFA States (showing up to 20 reachable)', html`${table(['Product State', 'Accepting?'], rows, 'No states')}
${legend(`${product.states.length} total product states, ${reachableStates.length} reachable`)}`),
    actions(html`<button class="algo-btn has-icon" data-action="algo.loadBuiltNFAResult" data-op="intersect">${ICON.load}Load Result into Canvas</button>`));
}

// What the card says over each closure's result.
const BUILT_NFA_CARDS = {
  star: { title: 'Kleene star', blurb: 'An ε-NFA for L*, built from the machine that was on the canvas.' },
  reversal: { title: 'Reversal', blurb: 'An ε-NFA for the reversal of L, built from the machine that was on the canvas.' },
  union: { title: 'Union of M₁ and M₂', blurb: 'An ε-NFA for L(M₁) ∪ L(M₂): a new start state with an ε-move into each machine.' },
  intersect: { title: 'Intersection of M₁ and M₂', blurb: 'The product construction for L(M₁) ∩ L(M₂). Each state is a pair, one state of each machine.' },
  concat: { title: 'Concatenation of M₁ and M₂', blurb: 'An ε-NFA for L(M₁)·L(M₂): ε-moves from M₁\'s accepting states into M₂.' }
};

export function loadBuiltNFAResult(key) {
  if (App._lastBuiltNFA?.key !== key) { showStatus('Run the algorithm first.'); return; }
  loadBuiltMachine(App._lastBuiltNFA.machine, 'ε-NFA', BUILT_NFA_CARDS[key] || null);
}

const BUILT_ROWS_SHOWN = 30;

export function renderBuiltNFAResult(m, title) {
  const states = m.states || [];
  const trans = m.transitions || [];
  const accepts = new Set(m.accepts || []);
  const nameIn = new Map(states.map(s => [s.id, s.name || s.id]));
  const statePills = states.map(s => {
    const start = s.id === m.startId, accept = accepts.has(s.id);
    return pill(`${nameIn.get(s.id)}${start ? ' (start)' : ''}${accept ? ' ★' : ''}`, accept ? 'acc' : start ? 'start' : '');
  });
  const rows = trans.slice(0, BUILT_ROWS_SHOWN).map(t => html`<tr><td>${nameIn.get(t.from) ?? t.from}</td><td>${t.symbol}</td><td>${nameIn.get(t.to) ?? t.to}</td></tr>`);
  if (trans.length > BUILT_ROWS_SHOWN) rows.push(html`<tr><td colspan="3" class="dead-cell">... ${trans.length - BUILT_ROWS_SHOWN} more</td></tr>`);
  return card(`${title}: ${states.length} states, ${trans.length} transitions`, html`${pills(statePills)}${table(['From', 'Symbol', 'To'], rows)}`);
}

// ──── NFA builders ────
// Each copies the operands' states under a prefix, so two machines with a
// state named q0 between them cannot collide.
const prefixed = (m, p, rename = n => n) => ({
  states: m.states.map(s => ({ id: p + s.id, name: rename(s.name) })),
  transitions: m.transitions.map(t => ({ ...t, id: p + t.id, from: p + t.from, to: p + t.to }))
});
const sigmaOf = (...ms) => [...new Set(ms.flatMap(m => m.sigma || []))];

export function buildNFAStar(machine) {
  const p = 'star_', eps = App.config.sym.eps;
  const { states, transitions } = prefixed(machine, p);
  const start = { id: 'star_q_new', name: 'q_s' };
  return {
    states: [start, ...states],
    transitions: [
      ...transitions,
      { id: 'star_e1', from: start.id, to: p + machine.startId, symbol: eps },
      // ε from each original accept back to the original start (looping) (#11)…
      ...machine.accepts.map((id, i) => ({ id: `star_loop_${i}`, from: p + id, to: p + machine.startId, symbol: eps })),
      // …and to the new start, the only accept state, which also accepts ε (#5, #11).
      ...machine.accepts.map((id, i) => ({ id: `star_acc_${i}`, from: p + id, to: start.id, symbol: eps }))
    ],
    startId: start.id,
    accepts: [start.id],
    sigma: machine.sigma
  };
}

export function buildNFAReversal(machine) {
  const p = 'rev_', eps = App.config.sym.eps;
  const states = machine.states.map(s => ({ id: p + s.id, name: s.name + '^R' }));
  const transitions = machine.transitions.map(t => ({ ...t, id: p + t.id, from: p + t.to, to: p + t.from }));
  const accepts = [p + machine.startId];
  if (machine.accepts.length === 1) return { states, transitions, startId: p + machine.accepts[0], accepts, sigma: machine.sigma };
  // Several old accepts: a new start with an ε-move into each.
  const start = { id: 'rev_super_start', name: 'q_r' };
  return {
    states: [start, ...states],
    transitions: [...transitions, ...machine.accepts.map((id, i) => ({ id: `rev_es_${i}`, from: start.id, to: p + id, symbol: eps }))],
    startId: start.id,
    accepts,
    sigma: machine.sigma
  };
}

export function buildNFAUnion(m1, m2) {
  const eps = App.config.sym.eps;
  const a = prefixed(m1, 'u1_', n => 'M1_' + n), b = prefixed(m2, 'u2_', n => 'M2_' + n);
  return {
    states: [{ id: 'union_start', name: 'q_u' }, ...a.states, ...b.states],
    transitions: [
      { id: 'u_e1', from: 'union_start', to: 'u1_' + m1.startId, symbol: eps },
      { id: 'u_e2', from: 'union_start', to: 'u2_' + m2.startId, symbol: eps },
      ...a.transitions, ...b.transitions
    ],
    startId: 'union_start',
    accepts: [...m1.accepts.map(id => 'u1_' + id), ...m2.accepts.map(id => 'u2_' + id)],
    sigma: sigmaOf(m1, m2)
  };
}

export function buildNFAConcat(m1, m2) {
  const eps = App.config.sym.eps;
  const a = prefixed(m1, 'c1_', n => 'M1_' + n), b = prefixed(m2, 'c2_', n => 'M2_' + n);
  return {
    states: [...a.states, ...b.states],
    transitions: [
      ...a.transitions, ...b.transitions,
      ...m1.accepts.map((id, i) => ({ id: `c_e_${i}`, from: 'c1_' + id, to: 'c2_' + m2.startId, symbol: eps }))
    ],
    startId: 'c1_' + m1.startId,
    accepts: m2.accepts.map(id => 'c2_' + id),
    sigma: sigmaOf(m1, m2)
  };
}

// ══════════════════════════════════════════════════════════════════
//  NFA COMPUTATION TREE
// ══════════════════════════════════════════════════════════════════
export function algoNFATree(c) {
  paint(c, page('NFA Computation Tree', 'ALL EXECUTION PATHS FOR A STRING',
    'Shows all possible computation branches of the NFA when reading an input string. Each level corresponds to reading one symbol. Branches split at nondeterministic choices. ε-closures are computed at each step.'),
  card('Input String', html`<div class="regex-input-wrap">
  <input class="inp" id="nfa-tree-input" placeholder="e.g. ab or 010" autocomplete="off" data-action="suggest.symbols keydown.enter->algo.buildNFATree">
  <button class="algo-btn" data-action="algo.buildNFATree">Build Tree</button>
</div>`),
  html`<div id="nfa-tree-result"></div>`);
}

/** The run box's text as tokens over Σ, or null — after `eps` and friends mean ε. */
function tokensOfField(id) {
  const raw = parseEps($(id).value);
  return tokenize(raw === App.config.sym.eps ? '' : raw);
}

const untokenizable = () => `Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.`;

export function buildNFATree() {
  const out = $('nfa-tree-result');
  if (!App.startId) return paint(out, notice('No start state defined.'));
  // tokenize() against Σ (same longest-match backtracking Simulate/NPDA/NDTM
  // use) so word alphabets — not just single-character ones — walk correctly:
  // each tree level below is one *token*, not one raw character.
  const tokens = tokensOfField('nfa-tree-input');
  if (tokens === null) return paint(out, notice(html`<span class="algo-error-label">Error:</span> ${untokenizable()}`, 'is-error'));
  paint(out, layoutNFATree(computeNFATree(tokens), tokens));
}

const NFA_TREE_MAX_NODES = 500;

export function computeNFATree(tokens) {
  // A true per-state nondeterministic computation tree (#4).
  let nodeCount = 0;
  function makeNode(stateId, depth, sym) {
    nodeCount++;
    const children = [];
    let stuck = false;
    if (nodeCount < NFA_TREE_MAX_NODES && depth < tokens.length) {
      const nextSym = tokens[depth];
      const moves = transitionsOn(stateId, nextSym);
      // A branch with input left and nothing to read it with dies here; one
      // cut off by the node budget is not marked, since it did not.
      stuck = !moves.length;
      for (const t of moves) {
        for (const id of epsClosure(new Set([t.to]))) {
          if (nodeCount < NFA_TREE_MAX_NODES) children.push(makeNode(id, depth + 1, nextSym));
        }
      }
    }
    return { label: nameOf(stateId), stateId, sym: sym || '', isAccept: isAccept(stateId), isDead: stuck, depth, children };
  }
  const roots = [...epsClosure(new Set([App.startId]))].map(id => makeNode(id, 0, ''));
  return { label: 'Start', stateId: null, sym: '', isAccept: false, isDead: false, depth: -1, children: roots, isRoot: true };
}

const TREE_LEVEL_H = 65, TREE_GAP = 10, TREE_LEAF_W = 60, TREE_LABEL_MAX = 5;

export function layoutNFATree(root, tokens) {
  // Word-alphabet tokens can be much wider than the fixed-width pill a
  // single character needs — size it to fit so long edge labels (and the
  // node columns beneath them) don't overlap their neighbors.
  const pillWidth = sym => (sym ? Math.max(16, [...sym].length * 7 + 8) : 16);

  // Widths bottom-up, so no subtree overlaps its neighbour…
  (function width(node) {
    if (!node.children.length) return (node._w = TREE_LEAF_W);
    let sum = 0;
    for (const ch of node.children) sum += Math.max(width(ch), pillWidth(ch.sym)) + TREE_GAP;
    node.children.forEach(ch => { ch._w = Math.max(ch._w, pillWidth(ch.sym)); });
    return (node._w = Math.max(TREE_LEAF_W, sum - TREE_GAP));
  })(root);

  // …then positions top-down.
  const nodes = [];
  let maxX = 0, maxY = 0;
  (function place(node, x, y) {
    node._x = x; node._y = y;
    nodes.push(node);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    let left = x - node._w / 2;
    for (const ch of node.children) {
      place(ch, left + ch._w / 2, y + TREE_LEVEL_H);
      left += ch._w + TREE_GAP;
    }
  })(root, root._w / 2 + 30, 30);

  const edges = [], marks = [];
  for (const node of nodes) {
    for (const ch of node.children) {
      edges.push(html`<line class="nt-edge" x1="${node._x}" y1="${node._y + 15}" x2="${ch._x}" y2="${ch._y - 15}"/>`);
      if (ch.sym) {
        const mx = (node._x + ch._x) / 2, my = (node._y + ch._y) / 2, w = pillWidth(ch.sym);
        edges.push(html`<rect class="nt-label-bg" x="${mx - w / 2}" y="${my - 8}" width="${w}" height="16" rx="4"/><text class="nt-label" x="${mx}" y="${my + 3}">${ch.sym}</text>`);
      }
    }
    const final = node.depth === tokens.length;
    const kind = node.isRoot ? 'is-root' : node.isDead ? 'is-dead' : final ? (node.isAccept ? 'is-acc' : 'is-rej') : '';
    const r = node.isRoot ? 20 : 16;
    const label = node.isRoot || node.label.length <= TREE_LABEL_MAX ? node.label : '..';
    marks.push(html`<g class="${classes('nt-n', kind)}"><title>${node.label}</title><circle class="nt-node" cx="${node._x}" cy="${node._y}" r="${r}"/>${kind === 'is-acc' && html`<circle class="nt-ring" cx="${node._x}" cy="${node._y}" r="${r - 4}"/>`}<text class="nt-text" x="${node._x}" y="${node._y + 4}">${label}</text></g>`);
  }

  const w = maxX + 60, h = maxY + 60;
  return html`<div class="algo-scroll-x"><svg class="nfa-tree" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${edges}${marks}</svg></div>`;
}

// ══════════════════════════════════════════════════════════════════
//  NONDETERMINISTIC PDA AND TM
// ══════════════════════════════════════════════════════════════════
/** A simulator's input field, its button, and the box it answers into. */
function simulatorCard(title, id, placeholder, button) {
  return card(title, html`<div class="regex-input-wrap">
  <input class="inp" id="${id}-input" placeholder="${placeholder}" autocomplete="off" data-action="suggest.symbols">
  ${button}
</div>
<div id="${id}-result" class="algo-out"></div>`);
}

/** What simNPDA and simNDTM report, drawn the same way for both. */
function branchReport(out, result, summary, title) {
  paint(out,
    verdict(result.accepted, `${result.accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} — ${summary}`),
    card(title, stepList(result.log.slice(0, 10)), 'is-after'));
}

function runBranchingSim(id, simulate, summarize, title) {
  const out = $(`${id}-result`);
  if (!App.startId) return paint(out, html`<div class="algo-verdict-line tone-no">No start state.</div>`);
  const tokens = tokensOfField(`${id}-input`);
  if (tokens === null) return paint(out, html`<div class="algo-verdict-line tone-no">${untokenizable()}</div>`);
  const result = simulate(tokens);
  branchReport(out, result, summarize(result), title);
}

export function algoNPDA(c) {
  const head = page('Nondeterministic Pushdown Automaton', 'BFS OVER STACKED COMPUTATION BRANCHES',
    html`An NPDA may have multiple enabled moves for the same state, unread input, and stack top. It accepts if <em>any</em> branch reaches acceptance. This is the full stack-machine model equivalent in power to context-free grammars.`);
  const refused = needs(['NPDA'], 'this simulator');
  if (refused) return paint(c, head, refused);
  const overlaps = findPdaNondeterministicPairs().map(([a, b]) => step(
    `${nameOf(a.from)}: (${a.symbol}, ${a.pop}) overlaps with (${b.symbol}, ${b.pop})`,
    ['These transitions can both be enabled on at least one stack/input configuration.']));
  paint(c, head,
    card('Overlapping NPDA Moves', overlaps.length ? stepList(overlaps) : html`<div class="algo-empty-note">No overlapping stack moves found — this NPDA currently behaves deterministically.</div>`),
    simulatorCard('Simulate NPDA (BFS over all branches)', 'npda', 'Input string (e.g. aabb or ε)',
      html`<button class="algo-btn" data-action="algo.runNPDASim">Simulate</button>`));
}

export function runNPDASim() {
  runBranchingSim('npda', simNPDA,
    r => `${r.branches} branches explored, max depth ${r.maxDepth}, witness length ${r.witnessLength}`,
    'Branch Summary (first 10 explored branches)');
}

export function algoNDTM(c) {
  const head = page('Nondeterministic Turing Machine', 'BFS OVER ALL COMPUTATION BRANCHES',
    'A NDTM is a TM where δ is a relation: the same (state, symbol) pair may have multiple possible transitions. An NDTM accepts if ANY computation branch reaches an accept state. Equivalent in power to a deterministic TM.');
  const refused = needs(['NDTM'], 'this simulator');
  if (refused) return paint(c, head, refused);
  // The (state, symbol) pairs δ maps to more than one move.
  const groups = new Map();
  for (const t of App.transitions) {
    const key = `${t.from}\u0000${t.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const branching = [...groups.values()].filter(ts => ts.length > 1).map(ts => html`<div class="step-item"><div class="step-num">ND</div><div class="step-text">δ(${nameOf(ts[0].from)}, '${ts[0].symbol}') = {${ts.map(t => `(${nameOf(t.to)}, '${t.write}', ${t.dir})`).join('; ')}}</div></div>`);
  paint(c, head,
    card('Nondeterministic Transitions (same state+symbol, multiple outputs)', branching.length
      ? html`<div class="step-list">${branching}</div>`
      : html`<div class="algo-empty-note">No branching transitions found — this NDTM is currently deterministic.</div>`),
    simulatorCard('Simulate NDTM (BFS over all branches)', 'ndtm', 'Input string (e.g. 001)',
      html`<button class="algo-btn" data-action="algo.runNDTMSim">Simulate</button>`));
}

export function runNDTMSim() {
  runBranchingSim('ndtm', simNDTM, r => `${r.branches} branches explored, max depth ${r.maxDepth}`, 'Branch Summary (first 10 branches)');
}

// ══════════════════════════════════════════════════════════════════
//  UNIVERSAL TURING MACHINE
// ══════════════════════════════════════════════════════════════════
export function algoUTM(c) {
  paint(c, page('Universal Turing Machine', 'META-INTERPRETER: A TM THAT SIMULATES ANY TM', html`A <strong>Universal Turing Machine (UTM)</strong> U takes two inputs:
<strong>⟨M, w⟩</strong> — an encoding of a Turing Machine M and an input string w —
and simulates M on w. The UTM reads the description of M (its states, alphabet, and
transition function), then interprets M's transitions step by step on w's tape.
This panel acts as a UTM: describe any deterministic TM in JSON and run it on any input.`),
  card('To Emulate', html`<div class="algo-row">
  <select id="utm-example-select" class="inp utm-select">${UTM_EXAMPLES.map((e, i) => html`<option value="${i}">${e.label}</option>`)}</select>
  <button class="algo-btn" data-action="algo.loadUTMExample">Load</button>
</div>`, 'is-tight'),
  card('Inner TM Description ⟨M⟩', html`<div class="algo-hint">JSON format · fields: states[], start, accept[], transitions[{from, read, write, dir, to}]<br>
<em>write</em> defaults to <em>read</em> if omitted · <em>dir</em>: "L" or "R" · blank = "⊔"</div>
<textarea id="utm-tm-desc" class="utm-desc" rows="18" placeholder="Paste TM JSON here…">${JSON.stringify(UTM_EXAMPLES[0].tm, null, 2)}</textarea>`),
  card('Input Tape ⟨w⟩', html`<div class="regex-input-wrap is-tight">
  <input class="inp regex-inp" id="utm-input" placeholder="Input string (ε for empty)">
  <button class="algo-btn has-icon" data-action="algo.runUTMSim">${ICON.play} Run UTM</button>
</div>
<div class="algo-row is-spaced">
  <button class="sbtn" data-action="algo.utmStepBack" data-tip="Step back">${ICON.back}</button>
  <button class="sbtn" data-action="algo.utmStepFwd" data-tip="Step forward">${ICON.next}</button>
  <button class="sbtn has-icon" id="utm-auto-btn" data-action="algo.utmToggleAuto" data-tip="Auto-play">${ICON.play} Auto</button>
  <button class="sbtn" data-action="algo.utmResetView" data-tip="Reset">${ICON.reset}</button>
</div>
<div id="utm-tape-wrap" class="tv-body utm-tape"></div>
<div id="utm-result" class="utm-result"></div>`, 'is-after'));
}

export function loadUTMExample() {
  const ex = UTM_EXAMPLES[parseInt($('utm-example-select')?.value, 10)];
  if (!ex) return;
  const desc = $('utm-tm-desc'), input = $('utm-input');
  if (desc) desc.value = JSON.stringify(ex.tm, null, 2);
  if (input) input.value = ex.input;
  utmResetView();
}

// The run the card is showing: its steps, the one on screen, and the timer
// that plays them.
const utm = { steps: [], idx: 0, timer: null };

export function runUTMSim() {
  utmResetTimer();
  utm.steps = []; utm.idx = 0;
  const desc = $('utm-tm-desc'), input = $('utm-input'), out = $('utm-result');
  if (!desc || !input || !out) return;
  let tm;
  try { tm = JSON.parse(desc.value); } catch (e) {
    return paint(out, html`<div class="algo-verdict-line tone-no">JSON parse error: ${e.message}</div>`);
  }
  const errs = utmValidateTM(tm);
  if (errs.length) return paint(out, html`<div class="algo-verdict-line tone-no">${lines(errs)}</div>`);
  const w = input.value === App.config.sym.eps ? '' : input.value;
  utm.steps = simUTM(tm, w);
  renderUTMStep();
}

export function utmValidateTM(tm) {
  const errs = [];
  if (!Array.isArray(tm.states) || !tm.states.length) errs.push('Missing or empty "states" array.');
  if (!tm.start) errs.push('Missing "start" state.');
  if (!Array.isArray(tm.accept)) errs.push('Missing or invalid "accept" array.');
  if (!Array.isArray(tm.transitions)) errs.push('Missing or invalid "transitions" array.');
  if (tm.start && Array.isArray(tm.states) && !tm.states.includes(tm.start)) errs.push(`Start state "${tm.start}" not in states.`);
  if (errs.length) return errs;
  tm.transitions.forEach((tr, i) => {
    if (!tr.from) errs.push(`Transition ${i}: missing "from".`);
    if (tr.read == null) errs.push(`Transition ${i}: missing "read".`);
    if (tr.dir !== 'L' && tr.dir !== 'R') errs.push(`Transition ${i}: "dir" must be "L" or "R".`);
    if (!tr.to) errs.push(`Transition ${i}: missing "to".`);
  });
  return errs;
}

export function simUTM(tm, w) {
  const BLANK = App.config.sym.blank;
  const MAX_STEPS = App.config.maxTmSteps;
  const orBlank = s => (s === '' ? BLANK : s);
  const acceptSet = new Set(tm.accept);
  // δ indexed by (state, read); `write` defaults to what was read.
  const delta = new Map(tm.transitions.map(tr => [
    `${tr.from}\u0000${orBlank(tr.read)}`,
    { write: orBlank(tr.write ?? tr.read), dir: tr.dir, to: tr.to }
  ]));

  const steps = [];
  const tape = w.length ? w.split('') : [];
  let head = 0, state = tm.start;
  // An instantaneous description: the tape with the state written before the
  // cell under the head, trailing blanks dropped.
  const describe = () => `${tape.slice(0, head).join('')}[${state}]${tape.slice(head).join('')}`.replace(/⊔+$/, '') || `[${state}]⊔`;
  const record = (note, extra = {}) => steps.push({ tape: [...tape], head, state, note, id: describe(), ...extra });

  for (let i = 0; i < MAX_STEPS; i++) {
    while (tape.length <= head) tape.push(BLANK);
    const sym = tape[head];
    if (acceptSet.has(state)) {
      record(`UTM: inner state "${state}" is an accept state — ACCEPT`, { final: 'accept', step: i });
      return steps;
    }
    const tr = delta.get(`${state}\u0000${sym}`);
    if (!tr) {
      record(`UTM: no transition for (${state}, '${sym}') — REJECT`, { final: 'reject', step: i });
      return steps;
    }
    record(`UTM step ${i + 1}: state="${state}", read='${sym}' → write='${tr.write}', dir=${tr.dir}, → state="${tr.to}"`, { step: i });
    tape[head] = tr.write;
    state = tr.to;
    head = Math.max(0, head + (tr.dir === 'R' ? 1 : -1));
  }
  while (tape.length <= head) tape.push(BLANK);
  record(`UTM: step limit (${MAX_STEPS}) reached — possible infinite loop, halting`, { final: 'loop', step: MAX_STEPS });
  return steps;
}

const UTM_FINAL = {
  accept: { line: 't-ok', bar: 'ACCEPTED ✓' },
  reject: { line: 't-err', bar: 'REJECTED ✗' },
  loop: { line: 't-err', bar: 'LOOP DETECTED — did not halt' }
};

export function renderUTMStep() {
  const out = $('utm-result'), tapeEl = $('utm-tape-wrap');
  if (!out || !tapeEl || !utm.steps.length) return;
  const cur = utm.steps[utm.idx];
  const atEnd = utm.idx === utm.steps.length - 1;

  // The UTM's tape is an ordinary one-way infinite tape, so it is drawn by
  // the same renderer the step tracker uses rather than by a second set of
  // inline styles — the reader who has just watched a TM run here should not
  // meet a differently-shaped tape one view over.
  const BLANK = App.config.sym.blank;
  const cells = [...cur.tape];
  while (cells.length <= cur.head) cells.push(BLANK);
  renderTracker(tapeEl, [{
    label: 'Tape',
    finalClass: atEnd && cur.final ? cur.final : '',
    view: { kind: 'tape', cells, head: cur.head, origin: 0, leftBound: 0, rightBound: null, markers: [], blank: BLANK, readOnly: false }
  }]);

  const trace = utm.steps.slice(0, utm.idx + 1).map((s, i) => {
    const cls = i === utm.idx ? (UTM_FINAL[s.final]?.line ?? 't-step') : '';
    return html`<div class="${classes('utm-trace-line', cls)}">${i}: ${s.note}</div>`;
  });
  const end = UTM_FINAL[cur.final];
  paint(out,
    atEnd && end && verdict(cur.final === 'accept', `${end.bar} · ${utm.steps.length} steps total`),
    card(`Computation Trace (step ${utm.idx + 1} / ${utm.steps.length})`, html`<div id="utm-trace-scroll" class="utm-trace">${trace}</div>`));
  // The newest line is the one being read.
  const scroller = $('utm-trace-scroll');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

export function utmStepFwd() { if (utm.idx < utm.steps.length - 1) { utm.idx++; renderUTMStep(); } }
export function utmStepBack() { if (utm.idx > 0) { utm.idx--; renderUTMStep(); } }

export function utmResetView() {
  utmResetTimer();
  utm.steps = []; utm.idx = 0;
  paint($('utm-result'));
  const tape = $('utm-tape-wrap');
  if (tape) resetTracker(tape);
}

function setAutoButton(playing) {
  const b = $('utm-auto-btn');
  if (!b) return;
  b.classList.toggle('playing', playing);
  paint(b, playing ? html`${ICON.pause} Stop` : html`${ICON.play} Auto`);
}

export function utmResetTimer() {
  if (utm.timer) { clearInterval(utm.timer); utm.timer = null; }
  setAutoButton(false);
}

export function utmToggleAuto() {
  if (utm.timer) { utmResetTimer(); return; }
  setAutoButton(true);
  utm.timer = setInterval(() => {
    if (utm.idx >= utm.steps.length - 1) { utmResetTimer(); return; }
    utm.idx++;
    renderUTMStep();
  }, 400);
}

// ══════════════════════════════════════════════════════════════════
//  MOORE AND MEALY MACHINES
// ══════════════════════════════════════════════════════════════════
export function algoMooreTable(c) {
  const head = page('Moore Machine Table', 'TRANSITION TABLE WITH STATE OUTPUTS λ: Q → Δ',
    'Each state has an associated output symbol λ(q). The output produced on input string w = a₁...aₙ is λ(q₀)λ(q₁)...λ(qₙ), where qᵢ = δ(qᵢ₋₁, aᵢ). Output length is always |w|+1.');
  const refused = needs(['Moore'], 'this table');
  if (refused) return paint(c, head, refused);
  if (!App.states.length) return paint(c, head, emptyCanvasCard('a Moore machine'));
  const syms = [...App.sigma];
  const rows = App.states.map(s => html`<tr>${stateCell(s)}<td class="out-cell">${s.output || '—'}</td>${syms.map(sym => {
    const t = transitionsOn(s.id, sym)[0];
    return html`<td class="${t ? '' : 'dead-cell'}">${t ? nameOf(t.to) : '—'}</td>`;
  })}</tr>`);
  const outputs = [...new Set(App.states.map(s => s.output).filter(Boolean))];
  paint(c, head,
    card('δ: Q × Σ → Q | λ: Q → Δ', html`${table(['State', html`<span class="out-head">λ(q)</span>`, ...syms], rows)}
${legend('→ start state · * accept state · λ(q) output of state q')}`),
    card('Output Alphabet Δ used', pills(outputs.map(o => pill(o)), html`<span class="algo-empty-note">No outputs defined</span>`)));
}

export function algoMoore2Mealy(c) {
  const head = page('Moore → Mealy Conversion', 'OUTPUT MOVES FROM STATES TO TRANSITIONS',
    'For each Moore transition (p, a) → q with λ(q) = b, the equivalent Mealy transition is (p, a) → q with output b. State structure is unchanged; only output attribution shifts from destination states to incoming transitions.');
  const refused = needs(['Moore'], 'this conversion');
  if (refused) return paint(c, head, refused);
  if (!App.states.length) return paint(c, head, notice('Build a Moore machine first.'));
  const rows = App.transitions.map(t => html`<tr><td>${nameOf(t.from)}</td><td>${t.symbol}</td><td>${nameOf(t.to)}</td><td class="out-cell is-mealy">${getState(t.to)?.output || '—'}</td></tr>`);
  paint(c, head,
    card('Equivalent Mealy Transitions', html`${table(['From', 'Input', 'To', html`<span class="out-head is-mealy">Output λ(to)</span>`], rows)}
${legend(html`Mealy output = λ<sub>Moore</sub>(destination state). State structure unchanged.<br>
Note: The initial Moore output λ(q₀) has no Mealy equivalent — Mealy output sequence is one symbol shorter.`)}`),
    actions(html`<button class="algo-btn" data-action="algo.loadMooreAsMealy">Load as Mealy Machine</button>`));
}

export function loadMooreAsMealy() {
  if (App.machine !== 'Moore') return;
  commit(() => {
    App.transitions.forEach(t => { t.output = getState(t.to)?.output || ''; });
    showExampleCard({ title: 'Mealy machine from a Moore machine', blurb: 'Each transition writes the output of the state it enters. The Moore machine\'s first output, before any input, has no Mealy counterpart.' });
    applyMachineSwitch('Mealy');
  }, Change.META, Change.GRAPH);
  revealOnCanvas('Loaded as Mealy machine. Transition outputs set from destination state outputs.');
}

export function algoMealyTable(c) {
  const head = page('Mealy Machine Table', 'TRANSITION TABLE WITH TRANSITION OUTPUTS λ: Q × Σ → Δ',
    'Each transition (q, a) → p carries an output symbol λ(q, a). The output produced on w = a₁...aₙ is λ(q₀,a₁)λ(q₁,a₂)...λ(qₙ₋₁,aₙ), exactly n symbols. No output before the first input.');
  const refused = needs(['Mealy'], 'this table');
  if (refused) return paint(c, head, refused);
  if (!App.states.length) return paint(c, head, emptyCanvasCard('a Mealy machine'));
  const syms = [...App.sigma];
  const rows = App.states.map(s => html`<tr>${stateCell(s)}${syms.map(sym => {
    const t = transitionsOn(s.id, sym)[0];
    if (!t) return html`<td class="dead-cell">— / —</td>`;
    return html`<td>${nameOf(t.to)} / <span class="out-cell is-mealy">${t.output || '—'}</span></td>`;
  })}</tr>`);
  paint(c, head, card('δ: Q × Σ → Q | λ: Q × Σ → Δ (format: δ(q,a) / λ(q,a))', html`${table(['State', ...syms.map(s => html`${s}<br><span class="th-sub">to / out</span>`)], rows)}
${legend('→ start state · * accept state · format: next-state / output')}`));
}

export function algoMealy2Moore(c) {
  const head = page('Mealy → Moore Conversion', 'OUTPUT MOVES FROM TRANSITIONS TO STATES (STATE SPLITTING)',
    'Each Mealy state q is split into copies (q, b) for each output symbol b that appears on any transition entering q. The Moore output of copy (q, b) is b. An initial copy (q₀, ∅) is added for the start state with no output.');
  const refused = needs(['Mealy'], 'this conversion');
  if (refused) return paint(c, head, refused);
  if (!App.states.length) return paint(c, head, notice('Build a Mealy machine first.'));
  const result = computeMealy2Moore();
  App._lastMealy2Moore = result;
  const byId = new Map(result.states.map(s => [s.id, s]));
  const statePills = result.states.map(s => pill(`${s.name} [λ=${s.output || '∅'}]`, result.accepts.has(s.id) ? 'acc' : s.id === result.startId ? 'start' : ''));
  const rows = result.transitions.map(t => html`<tr><td>${byId.get(t.from)?.name ?? t.from}</td><td>${t.symbol}</td><td>${byId.get(t.to)?.name ?? t.to}</td><td class="out-cell">${byId.get(t.to)?.output || '—'}</td></tr>`);
  paint(c, head,
    card(`Moore States (${result.states.length} from ${App.states.length} Mealy states)`, pills(statePills)),
    card(`Moore Transitions (${result.transitions.length})`, table(['From', 'Input', 'To', html`<span class="out-head">λ(to)</span>`], rows)),
    actions(html`<button class="algo-btn" data-action="algo.loadMealyAsMoore">Load as Moore Machine</button>`));
}

export function computeMealy2Moore() {
  const incoming = new Map(App.states.map(s => [s.id, new Set()]));
  App.transitions.forEach(t => { if (t.output) incoming.get(t.to)?.add(t.output); });
  const states = [], idOf = new Map();
  const add = (s, suffix, output, name = s.name) => {
    const id = `m_${s.id}_${suffix}`;
    states.push({ id, name, output, origId: s.id });
    idOf.set(`${s.id}_${suffix}`, id);
  };
  const s0 = App.startId ? getState(App.startId) : null;
  if (s0) add(s0, 'init', '');
  for (const s of App.states) {
    const outs = incoming.get(s.id);
    if (!outs.size) { if (s.id !== App.startId) add(s, 'none', ''); }
    else outs.forEach(b => add(s, b, b, `${s.name}/${b}`));
  }
  const transitions = [];
  App.transitions.forEach((t, ti) => {
    const toId = idOf.get(`${t.to}_${t.output || 'none'}`) || idOf.get(`${t.to}_init`);
    if (!toId) return;
    states.filter(s => s.id.startsWith(`m_${t.from}_`)).forEach((copy, fi) => {
      transitions.push({ id: `mt_${ti}_${fi}`, from: copy.id, to: toId, symbol: t.symbol });
    });
  });
  return {
    states, transitions,
    startId: states[0]?.id || null,
    accepts: new Set(states.filter(s => isAccept(s.origId)).map(s => s.id))
  };
}

export function loadMealyAsMoore() {
  const r = App._lastMealy2Moore; if (!r) return;
  loadBuiltMachine({
    states: r.states.map((s, i) => ({ ...s, x: 120 + (i % 4) * 180, y: 120 + Math.floor(i / 4) * 160 })),
    transitions: r.transitions,
    startId: r.startId,
    accepts: [...r.accepts],
    sigma: [...App.sigma]
  }, 'Moore', {
    title: 'Moore machine from a Mealy machine',
    blurb: 'Each state pairs a Mealy state with the output written on the way into it, so the output moves from the transition to the state.'
  });
  showStatus('Loaded as Moore machine.');
}

// ══════════════════════════════════════════════════════════════════
//  MULTI-TAPE TM TABLE
// ══════════════════════════════════════════════════════════════════
export function algoMTMTable(c) {
  const head = page('Multi-Tape TM Transition Table', 'δ: Q × Γᵏ → Q × Γᵏ × {L,R}ᵏ',
    'Each transition reads one symbol from each of the k tapes, writes one symbol to each tape, and moves each head independently. The table shows one row per transition: symbols read from all tapes, the destination state, and writes/directions for all tapes.');
  const refused = needs(['MTM'], 'this table');
  if (refused) return paint(c, head, refused);
  if (!App.states.length) return paint(c, head, emptyCanvasCard('a multi-tape TM'));
  const k = App.tapeCount;
  const tapes = Array.from({ length: k }, (_, i) => i);
  const rows = App.transitions.map(t => {
    const fromClass = isStart(t.from) ? 'start-cell' : isAccept(t.from) ? 'acc-cell' : '';
    return html`<tr><td class="${fromClass}">${nameOf(t.from)}</td>${tapes.map(i => html`<td>${t.tapeSyms?.[i] || t.symbol || '—'}</td>`)}<td class="${isAccept(t.to) ? 'acc-cell' : ''}">${nameOf(t.to)}</td>${tapes.map(i => html`<td>${t.tapeWrites?.[i] || '—'}/${t.tapeDirs?.[i] || '—'}</td>`)}</tr>`;
  });
  const statePills = App.states.map(s => pill(`${s.name}${isStart(s.id) ? ' (start)' : ''}${isAccept(s.id) ? ' ★' : ''}`, roleClass(s.id)));
  paint(c, head,
    card(`${k}-Tape TM Transitions (${App.transitions.length} total)`, html`${table(['State', ...tapes.map(i => `T${i + 1} read`), 'Next State', ...tapes.map(i => `T${i + 1} write/dir`)], rows, 'No transitions defined')}
${legend('T1 = primary input tape · T2..Tk = work tapes · format: write-symbol/direction')}`),
    card(`States Q (${App.states.length})`, pills(statePills)));
}

// ══════════════════════════════════════════════════════════════════
//  TM → UNRESTRICTED GRAMMAR (TYPE 0)
// ══════════════════════════════════════════════════════════════════
export function algoTM2Grammar(c) {
  const head = page('TM → Unrestricted Grammar', 'CHOMSKY TYPE 0 REPRESENTATION',
    'Any language accepted by a Turing Machine can be generated by an Unrestricted (Type 0) Grammar. This construction uses a marker-based approach to simulate the head movement and tape contents using phrase-structure rules.');
  if (!isAnyTM(App.machine)) return paint(c, head, notice('Switch to TM, NDTM, or MTM mode to use this conversion.'));
  if (isMultiTape(App.machine)) {
    return paint(c, head, notice('This construction currently supports only single-tape TMs. Multi-tape TMs need a separate encoding before they can be converted to a Type 0 grammar.'));
  }

  const eps = App.config.sym.eps;
  const blank = App.config.sym.blank;
  const gamma = [...new Set([
    ...App.sigma, blank,
    ...App.transitions.flatMap(t => [t.symbol, t.write]).filter(x => x && x !== eps)
  ])];
  const q0 = getState(App.startId)?.name || 'q0';

  const prods = [];
  const rule = (lhs, rhs) => prods.push({ lhs, rhs });
  // 1. The initial configuration: any input word w ∈ Σ* to the right of q0.
  rule('S', `⟨L⟩ ${q0} ⟨W⟩ ⟨R⟩`);
  rule('⟨L⟩', blank);
  App.sigma.forEach(sym => { if (sym !== eps) rule('⟨W⟩', `${sym} ⟨W⟩`); });
  rule('⟨W⟩', '');
  // 2. Blank cells to the right, as many as the run needs, then the end marker.
  rule('⟨R⟩', `${blank} ⟨R⟩`);
  rule('⟨R⟩', '⟨E⟩');
  // 3. One rule per move right, one per tape symbol per move left.
  for (const t of App.transitions) {
    const q = nameOf(t.from), p = nameOf(t.to), a = t.symbol || blank, b = t.write || a;
    if (t.dir === 'R') rule(`${q} ${a}`, `${b} ${p}`);
    else gamma.forEach(g => rule(`${g} ${q} ${a}`, `${p} ${g} ${b}`));
  }
  // 4. An accepting state starts the clean-up…
  App.accepts.forEach(id => rule(nameOf(id), '⟨ACC⟩'));
  // 5. …which erases itself and the blanks and keeps the rest.
  rule('⟨ACC⟩', '');
  gamma.forEach(g => rule(`⟨ACC⟩ ${g}`, g === blank ? '⟨ACC⟩' : `${g} ⟨ACC⟩`));

  const rows = prods.map(p => html`<tr><td>${p.lhs}</td><td class="prod-arrow">→</td><td>${p.rhs || eps}</td></tr>`);
  paint(c, head,
    card(`Generated Type 0 Productions (${prods.length})`, table(['LHS', '', 'RHS'], rows)),
    html`<div class="info-box"><b>Note</b>: This is a 1-tape simulation construction. The language generated by this grammar is { w | M accepts w }. Type 0 grammars can have multiple symbols on the LHS.</div>`);
}

// ══════════════════════════════════════════════════════════════════
//  DFA MINIMISATION, STEP BY STEP
// ══════════════════════════════════════════════════════════════════
// idx is the step on screen; -1 is before the first, with nothing marked.
let _minViz = null;

export function algoMinimizeVisual(c) {
  const head = page('DFA Minimization: Table Filling', 'INTERACTIVE STEP-BY-STEP VISUALIZER');
  const refused = needs(['DFA'], 'minimization');
  if (refused) return paint(c, head, refused);
  if (App.states.length < 2) return paint(c, head, notice('Need at least 2 states.'));
  _minViz = { ...tableFillingMinimize(), idx: -1 };
  paint(c, head,
    card(null, html`<div class="sctrl">
  <button class="sbtn has-icon" data-action="algo.minVisStep" data-step="-1">${STEP_ICON.back} Back</button>
  <button class="sbtn has-icon" id="min-vis-play" data-action="algo.minVisStep" data-step="1">Start Step-by-Step ${STEP_ICON.next}</button>
  <button class="sbtn sec" data-action="algo.renderAlgo" data-algo="minimizeVisual">Reset</button>
</div>
<div id="min-vis-status" class="algo-status">Click Start to begin the Myhill-Nerode process.</div>`),
    card(null, html`<div id="min-vis-table-wrap" class="min-table-wrap"></div>`));
  renderMinVisTable();
}

export function renderMinVisTable() {
  if (!_minViz) return;
  const marked = getDistAtStep(_minViz.idx);
  paint($('min-vis-table-wrap'), distinguishabilityTable(_minViz.savedStates, key => marked[key]));
}

/** The pairs marked once the first `stepIdx + 1` steps have been taken. */
export function getDistAtStep(stepIdx) {
  const marked = {};
  const ids = _minViz.savedStates.map(s => s.id);
  for (const s of _minViz.steps.slice(0, stepIdx + 1)) {
    if (s.type === 'base') {
      ids.forEach((a, i) => ids.slice(0, i).forEach(b => { if (isAccept(a) !== isAccept(b)) marked[pairKey(a, b)] = true; }));
    } else if (s.type === 'mark') {
      marked[pairKey(s.p1, s.p2)] = true;
    }
  }
  return marked;
}

export function minVisStep(delta) {
  if (!_minViz) return;
  _minViz.idx = Math.max(0, Math.min(_minViz.steps.length - 1, _minViz.idx + delta));
  const cur = _minViz.steps[_minViz.idx];
  paint($('min-vis-status'), html`<b>Step ${_minViz.idx + 1}/${_minViz.steps.length}</b>: ${raw(cur.html)}`);
  paint($('min-vis-play'), html`Next Step ${STEP_ICON.next}`);
  renderMinVisTable();
}

// ══════════════════════════════════════════════════════════════════
//  THOMPSON'S CONSTRUCTION, STEP BY STEP
// ══════════════════════════════════════════════════════════════════
let _thViz = null;

export function algoRE2NFAVisual(c) {
  paint(c, page('Thompson Construction Visualizer', 'STEP-BY-STEP ASSEMBLY',
    'Each regex operator is mapped to an NFA fragment. Step through the construction to see how primitive NFAs are composed into larger fragments via ε-transitions.'),
  card('Input Regular Expression', html`<div class="regex-input-wrap">
  <input class="inp regex-inp" id="rev-input" placeholder="e.g. (a|b)*abb" data-action="keydown.enter->algo.startThompsonViz">
  <button class="algo-btn" data-action="algo.startThompsonViz">Build Steps</button>
</div>
<div class="algo-hint">${REGEX_SYNTAX}</div>`),
  html`<div id="rev-result"></div>`);
}

export function startThompsonViz() {
  const re = $('rev-input')?.value?.trim();
  if (!re) { showStatus('Enter a regex first'); return; }
  try {
    _thViz = { re, ...thompsonSteps(re), idx: 0 };
  } catch (e) {
    paint($('rev-result'), notice(`Parse error: ${e.message}`, 'is-error'));
    return;
  }
  renderThViz();
}

export function renderThViz() {
  const out = $('rev-result');
  if (!out || !_thViz) return;
  const { steps, idx } = _thViz;
  const { kind, nfa, note } = steps[idx];
  const isLast = idx === steps.length - 1;
  paint(out,
    card(`Construction Step ${idx + 1} / ${steps.length}`, html`<div class="step-item is-lead">
  <div class="step-num">${idx + 1}</div>
  <div class="step-text"><span class="algo-kind">${thAstLabel(kind)}</span><br>${raw(note)}</div>
</div>
<div class="sctrl">
  <button class="sbtn has-icon" data-action="algo.thVizStep" data-step="-1"${idx === 0 && raw(' disabled')}>${STEP_ICON.back} Back</button>
  <button class="sbtn has-icon${isLast ? '' : ' auto-btn'}" data-action="algo.thVizStep" data-step="1"${isLast && raw(' disabled')}>Next ${STEP_ICON.next}</button>
  <button class="sbtn sec" data-action="algo.startThompsonViz">Restart</button>
</div>`),
    card(`NFA Fragment — States: ${nfa.states.length} · Transitions: ${nfa.trans.length}`, html`<div class="algo-fragment-meta">Start: <span class="tone-start">${nfa.start}</span> · Accept: <span class="tone-accept">${nfa.accept}</span></div>
${fragmentTable(nfa)}`),
    isLast && actions(html`<button class="algo-btn has-icon" data-action="algo.loadThompsonNFA_Viz">${ICON.load}Load Final NFA into Canvas</button>`));
}

export function thVizStep(delta) {
  if (!_thViz) return;
  _thViz.idx = Math.max(0, Math.min(_thViz.steps.length - 1, _thViz.idx + delta));
  renderThViz();
}

export function loadThompsonNFA_Viz() {
  if (!_thViz) return;
  App._lastThompson = { ..._thViz.nfa, re: _thViz.re };
  loadThompsonNFA();
}

// ══════════════════════════════════════════════════════════════════
//  ε-CLOSURE TABLE
// ══════════════════════════════════════════════════════════════════
export function algoEpsClosure(c) {
  const eps = App.config.sym.eps;
  const head = page('ε-Closure Table', 'ε-CLOSURE OF EACH STATE IN ε-NFA',
    html`The ε-closure of state <em>q</em> is the set of all states reachable from <em>q</em> using ε-transitions only (including <em>q</em> itself). It is used in the subset construction to convert an ε-NFA to a DFA.`);
  if (App.machine !== 'ε-NFA') {
    return paint(c, head, notice(html`<div class="algo-note">Switch to <b>ε-NFA</b> mode to use this tool. The canvas currently has <b>${App.machine}</b> selected.</div>`));
  }
  if (!App.states.length) return paint(c, head, notice('No states defined.'));

  const closures = App.states.map(s => ({ state: s, closure: epsClosure(new Set([s.id])) }));
  const namesIn = set => App.states.filter(s => set.has(s.id)).map(s => s.name);
  const rows = closures.map(({ state, closure }) => {
    const cls = isStart(state.id) ? 'start-cell' : isAccept(state.id) ? 'acc-cell' : '';
    return html`<tr><th class="${cls}">${state.name}${isStart(state.id) && ' →'}${isAccept(state.id) && ' *'}</th>${App.states.map(s => closure.has(s.id)
      ? html`<td class="in-set">✓</td>`
      : html`<td class="dead-cell">—</td>`)}<td class="set-cell">{${namesIn(closure).join(', ')}}</td></tr>`;
  });
  const cards = [card(html`<span class="sym">ε</span>-closure(<span class="sym">q</span>) membership table`, html`<div class="subset-table-wrap"><table class="result-table">
<thead><tr><th>State q</th>${App.states.map(s => html`<th>${s.name}</th>`)}<th>ε-CLOSURE(q)</th></tr></thead>
<tbody>${rows}</tbody></table></div>
${legend('→ start state · * accept state')}`)];

  // δ̂: for each closure, the ε-closure of where a symbol takes any of it.
  const sigma = [...App.sigma].filter(sym => sym !== eps);
  if (sigma.length) {
    const moveRows = closures.map(({ state, closure }) => html`<tr><th>${state.name}</th>${sigma.map(sym => {
      const moved = new Set();
      closure.forEach(id => transitionsOn(id, sym).forEach(t => moved.add(t.to)));
      const reach = epsClosure(moved);
      if (!reach.size) return html`<td class="dead-cell">∅</td>`;
      return html`<td class="${[...reach].some(isAccept) ? 'acc-cell' : ''}">{${namesIn(reach).join(',')}}</td>`;
    })}</tr>`);
    cards.push(card(html`Extended transition function <span class="sym">δ̂</span> (after applying <span class="sym">ε</span>-closure)`,
      html`<div class="subset-table-wrap"><table class="result-table"><thead><tr><th>State q</th>${sigma.map(sym => html`<th>δ̂(q, '${sym}')</th>`)}</tr></thead><tbody>${moveRows}</tbody></table></div>`));
  }
  paint(c, head, cards);
}

// ══════════════════════════════════════════════════════════════════
//  DFA → RIGHT-LINEAR GRAMMAR
// ══════════════════════════════════════════════════════════════════
export function algoDFA2RG(c) {
  const eps = App.config.sym.eps;
  const head = page('DFA / NFA → Regular Grammar', 'RIGHT-LINEAR GRAMMAR DERIVATION (TYPE 3)',
    html`A right-linear grammar has productions of the form <em>A → aB</em> or <em>A → a</em> or <em>A → ε</em>. Every DFA corresponds exactly to such a grammar where states become non-terminals and transitions become productions.`);
  if (!App.states.length) return paint(c, head, notice('No states defined.'));
  if (!App.startId) return paint(c, head, notice('No start state defined.'));

  // q --a--> p is the production q → a p, and an accepting q has q → ε.
  const prods = [];
  for (const t of App.transitions) {
    const from = getState(t.from)?.name, to = getState(t.to)?.name;
    if (from && to) prods.push({ lhs: from, sym: t.symbol, to });
  }
  App.accepts.forEach(id => { const name = getState(id)?.name; if (name) prods.push({ lhs: name, sym: eps, to: null }); });
  const rhs = p => (p.to ? html`${p.sym} <span class="nt">${p.to}</span>` : html`${p.sym}`);

  const byLhs = new Map();
  prods.forEach(p => { if (!byLhs.has(p.lhs)) byLhs.set(p.lhs, []); byLhs.get(p.lhs).push(p); });
  const grouped = [...byLhs].map(([lhs, ps]) => html`<div class="grammar-line"><span class="nt">${lhs}</span> <span class="tone-muted">→</span> ${ps.map((p, i) => html`${i ? ' | ' : ''}${rhs(p)}`)}</div>`);
  const rows = prods.map(p => html`<tr><td class="nt">${p.lhs}</td><td class="prod-arrow">→</td><td>${rhs(p)}</td></tr>`);
  const vars = [...new Set(App.states.map(s => s.name))];

  paint(c, head,
    card('Right-Linear Grammar G = (V, Σ, R, S)', html`<div class="algo-note is-before">V = {${vars.join(', ')}} · Σ = {${[...App.sigma].join(', ')}} · S = ${getState(App.startId)?.name || 'S'}</div>
<div class="grammar-block">${grouped}</div>
<div class="card-title">Production Table (${prods.length} total)</div>
${table(['LHS', '', 'RHS'], rows, 'No productions')}`),
    html`<div class="info-box"><b>Reading the grammar:</b> Each non-terminal represents a DFA state. <em>A → a B</em> means "from state A, reading 'a', go to state B". <em>A → ε</em> means "state A is an accept state" — the empty string ends the derivation here.</div>`);
}

// ══════════════════════════════════════════════════════════════════
//  REGULAR GRAMMAR → NFA
// ══════════════════════════════════════════════════════════════════
let _rgNFAData = null;

export function algoRG2NFA(c) {
  paint(c, page('Regular Grammar → NFA', 'RIGHT-LINEAR / LEFT-LINEAR TO AUTOMATON',
    html`Enter a regular grammar using either right-linear productions (<em>A → aB</em>, <em>A → a</em>, <em>A → ε</em>) or left-linear productions (<em>A → Ba</em>, <em>A → a</em>, <em>A → ε</em>). Use one orientation consistently. Each variable becomes a state, plus one helper state.`),
  card('Grammar Input', html`<div class="algo-hint">Format: one production per line, e.g. <code>S → aA | b</code> or <code>A → ε</code></div>
<textarea id="rg-input" class="batch-in rg-input" placeholder="S → aA | bB | ε&#10;A → aA | a&#10;B → bB | b"></textarea>
<div class="algo-row is-after">
  <input class="inp rg-start" id="rg-start" placeholder="Start symbol (e.g. S)">
  <button class="algo-btn" data-action="algo.buildRG2NFA">Build NFA</button>
</div>`),
  html`<div id="rg-result"></div>`);
}

/** Productions from the text box, one per alternative: `{ lhs, rhs }`. */
function parseRegularGrammar(text) {
  const prods = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const arrow = line.includes('→') ? '→' : '->';
    const [lhs, ...rest] = line.split(arrow);
    if (!rest.length) continue;
    for (const alt of rest.join(arrow).split('|')) {
      const rhs = alt.trim();
      if (rhs) prods.push({ lhs: lhs.trim().toUpperCase(), rhs });
    }
  }
  return prods;
}

/** Build the NFA a regular grammar describes, or throw why it cannot. */
export function regularGrammarToNFA(prods, startSym) {
  const eps = App.config.sym.eps;
  const vars = [...new Set(prods.map(p => p.lhs))];
  const longestFirst = [...vars].sort((a, b) => b.length - a.length);

  const shapeOf = rhs => {
    if (rhs === eps) return { kind: 'epsilon' };
    const right = longestFirst.find(v => rhs.endsWith(v) && rhs !== v);
    if (right && rhs.slice(0, -right.length).trim()) return { kind: 'right', terminal: rhs.slice(0, -right.length).trim(), variable: right };
    const left = longestFirst.find(v => rhs.startsWith(v) && rhs !== v);
    if (left && rhs.slice(left.length).trim()) return { kind: 'left', terminal: rhs.slice(left.length).trim(), variable: left };
    return { kind: 'terminal', terminal: rhs };
  };
  const shaped = prods.map(p => ({ ...p, shape: shapeOf(p.rhs) }));
  const kinds = new Set(shaped.map(p => p.shape.kind).filter(k => k === 'left' || k === 'right'));
  if (kinds.size > 1) throw new Error('Mixed right-linear and left-linear productions are not supported in a single grammar.');
  const leftLinear = kinds.has('left');

  // One state per variable, and a helper: the final state of a right-linear
  // grammar's NFA, or the initial state of a left-linear one's, which reads
  // the word backwards from the start symbol.
  const idOf = new Map(vars.map((v, i) => [v, 's' + (i + 1)]));
  const helper = 's' + (vars.length + 1);
  const states = [...vars.map(v => ({ id: idOf.get(v), name: v })), { id: helper, name: leftLinear ? 'qStart' : 'qAcc' }];
  const startVar = idOf.get(startSym.toUpperCase()) || idOf.get(vars[0]);

  const transitions = [];
  const move = (from, to, symbol) => transitions.push({ id: 't' + (transitions.length + 1), from, to, symbol });
  for (const { lhs, rhs, shape } of shaped) {
    const at = idOf.get(lhs);
    if (shape.kind === 'epsilon') leftLinear ? move(helper, at, eps) : move(at, helper, eps);
    else if (shape.kind === 'terminal') leftLinear ? move(helper, at, shape.terminal) : move(at, helper, shape.terminal);
    else if (shape.kind === (leftLinear ? 'left' : 'right')) leftLinear ? move(idOf.get(shape.variable), at, shape.terminal) : move(at, idOf.get(shape.variable), shape.terminal);
    else throw new Error(`Production "${lhs} → ${rhs}" is not ${leftLinear ? 'left' : 'right'}-linear.`);
  }

  return {
    states, transitions,
    startId: leftLinear ? helper : startVar,
    accepts: new Set([leftLinear ? startVar : helper])
  };
}

export function buildRG2NFA() {
  const out = $('rg-result');
  const text = $('rg-input')?.value?.trim();
  if (!text) return paint(out, notice('Enter a grammar first.', 'is-error'));
  let nfa;
  try {
    const prods = parseRegularGrammar(text);
    if (!prods.length) throw new Error('No valid productions found.');
    nfa = regularGrammarToNFA(prods, $('rg-start')?.value?.trim() || 'S');
  } catch (e) {
    return paint(out, notice(`Error: ${e.message}`, 'is-error'));
  }
  _rgNFAData = nfa;
  const { states, transitions, accepts, startId } = nfa;
  const nameIn = new Map(states.map(s => [s.id, s.name]));
  const sigma = [...new Set(transitions.map(t => t.symbol).filter(s => s !== App.config.sym.eps))];
  const rows = transitions.map(t => html`<tr><td>${nameIn.get(t.from)}</td><td class="sym-cell">${t.symbol}</td><td class="${accepts.has(t.to) ? 'acc-cell' : ''}">${nameIn.get(t.to)}</td></tr>`);
  paint(out, card(`Constructed NFA — States: ${states.length} Transitions: ${transitions.length}`, html`<div class="algo-fragment-meta">Start: <span class="tone-start">${nameIn.get(startId)}</span> · Accept: <span class="tone-accept">${[...accepts].map(id => nameIn.get(id)).join(', ')}</span> · Σ = {${sigma.join(', ')}}</div>
${table(['From', 'Symbol', 'To'], rows)}
${actions(html`<button class="algo-btn has-icon" data-action="algo.loadRG2NFAToCanvas">${ICON.load}Load into Canvas</button>`)}`));
}

export function loadRG2NFAToCanvas() {
  if (!_rgNFAData) return;
  const { states, transitions, accepts, startId } = _rgNFAData;
  const cols = Math.max(Math.ceil(Math.sqrt(states.length)), 2);
  // No sigma: Σ is the grammar's terminals, which are what the edges read.
  loadBuiltMachine({
    states: states.map((s, i) => ({ id: s.id, name: s.name, x: 120 + (i % cols) * 170, y: 120 + Math.floor(i / cols) * 150 })),
    transitions,
    startId,
    accepts: [...accepts]
  }, transitions.some(t => t.symbol === App.config.sym.eps) ? 'ε-NFA' : 'NFA', {
    title: 'NFA from a regular grammar',
    blurb: 'One state per variable and one final state; each production is a transition.'
  });
  showStatus('Regular Grammar NFA loaded!');
}

// ══════════════════════════════════════════════════════════════════
//  DEAD STATE ANALYSIS
// ══════════════════════════════════════════════════════════════════
/** Every state's category: 'live', 'dead' or 'unreachable'. */
export function computeStateClassification() {
  const map = new Map();
  const reachable = getReachableStates(App.startId);
  const productive = getCoReachableStates();
  for (const s of App.states) {
    map.set(s.id, !reachable.has(s.id) ? 'unreachable' : !productive.has(s.id) ? 'dead' : 'live');
  }
  return map;
}

/** Put the classification on the canvas. */
export function highlightDeadStates() {
  App.stateClassification = computeStateClassification();
  renderAll();
}

/** Take it off. */
export function clearStateHighlights() {
  App.stateClassification = null;
  renderAll();
}

const CATEGORY = {
  live: { label: 'Live', summary: 'Live', reason: 'Reachable + productive' },
  dead: { label: 'Dead', summary: 'Dead (non-productive)', reason: 'No path to any accept state' },
  unreachable: { label: 'Unreachable', summary: 'Unreachable', reason: 'Not reachable from start' }
};

export function algoDeadStates(c) {
  const head = page('Dead State Analysis', 'REACHABILITY & PRODUCTIVITY CLASSIFICATION', html`Every state falls into exactly one category:<br>
<b class="cat-live">Live</b> — reachable from start AND can reach an accept state.<br>
<b class="cat-dead">Dead</b> — reachable, but trapped: no accept state is accessible from here.<br>
<b class="cat-unreachable">Unreachable</b> — cannot be reached from the start state by any input.`);
  if (!App.states.length) return paint(c, head, notice('No states defined on the canvas.'));
  if (!App.startId) return paint(c, head, notice('No start state defined — all states are unreachable.', 'is-error'));

  const category = computeStateClassification();
  const count = cat => App.states.filter(s => category.get(s.id) === cat).length;
  const summary = Object.entries(CATEGORY).map(([cat, { summary: label }]) => html`<div class="dsa-row cat-${cat}"><span class="dsa-dot"></span><span class="dsa-label">${label}</span><span class="dsa-count">${count(cat)}</span></div>`);

  const stateRows = App.states.map(s => {
    const cat = category.get(s.id);
    const role = [isStart(s.id) && '→ start', isAccept(s.id) && '★ accept'].filter(Boolean).join('  ');
    return html`<tr><td>${s.name}</td><td class="${classes('role-cell', isStart(s.id) && 'is-start')}">${role || '—'}</td><td><span class="cat-label cat-${cat}">${CATEGORY[cat].label}</span></td><td class="note-cell">${CATEGORY[cat].reason}</td></tr>`;
  });

  // A transition with a dead or unreachable end can be removed without
  // changing the language.
  const useless = App.transitions.filter(t => category.get(t.from) !== 'live' || category.get(t.to) !== 'live');
  const uselessRows = useless.map(t => {
    const fn = nameOf(t.from), tn = nameOf(t.to);
    const why = category.get(t.from) !== 'live' ? `Source state ${fn} is ${category.get(t.from)}` : `Target state ${tn} is ${category.get(t.to)}`;
    return html`<tr><td>${fn}</td><td class="sym-cell">${t.symbol}</td><td>${tn}</td><td class="note-cell">${why}</td></tr>`;
  });

  paint(c, head,
    card(`Summary (${App.states.length} states total)`, html`<div class="dsa-summary">${summary}</div>
<div class="algo-actions">
  <button class="algo-btn has-icon" data-action="algo.highlightDeadStates" id="dsa-highlight-btn">${ICON.eye} Highlight on Canvas</button>
  <button class="algo-btn sec has-icon" data-action="algo.clearStateHighlights">${ICON.close} Clear Highlights</button>
</div>`),
    card('Per-State Breakdown', table(['State', 'Role', 'Category', 'Reason'], stateRows)),
    useless.length
      ? card(`Useless Transitions (${useless.length})`, html`<div class="algo-hint">These transitions involve at least one dead or unreachable state and can be removed without changing the language.</div>
${table(['From', 'Symbol', 'To', 'Why Useless'], uselessRows)}`)
      : html`<div class="info-box">✓ No useless transitions — all transitions involve live states.</div>`,
    count('dead') + count('unreachable') === 0 && html`<div class="info-box tone-yes">✓ All ${App.states.length} states are live — this machine has no dead or unreachable states.</div>`);
}
