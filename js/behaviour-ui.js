// ══════════════════════════════════════════════════════════════════
//  THE BEHAVIOUR SECTION — does this Turing machine halt?
// ══════════════════════════════════════════════════════════════════
//  A right-panel section (`rp-behaviour`) over js/machines/tm-behaviour.js,
//  which proves the machine halts or never halts — naming the method that
//  proved it — or says it does not know. The card's colour and the header
//  chip read the verdict; the text, facts and evidence read the method. This chooses
//  the tape and the budget, keeps the page live while millions of steps go by
//  a slice at a time, and shows the answer with its evidence: the two stretches
//  of tape the proof compared, drawn as cells, and a way into the player at the
//  step the repetition starts.
//
//  **Unknown is never drawn as "runs forever".** Halting is undecidable, and
//  some very small machines halt exactly when an open problem says they do, so
//  "no proof within the budget" is its own answer, in the colour the player
//  gives a run with no verdict. There is deliberately no list of named
//  machines: everything this section says, it proved.
//
//  Built the first time the body has a size, like the complexity section, and
//  wired with listeners at creation — nothing here is in bridge.js.
// ══════════════════════════════════════════════════════════════════

import { $, App, activeWorkspaceId } from './state.js';
import { showStatus } from './utils.js';
import { BEHAVIOUR_MACHINES, METHODS, classifyBehaviour, compileBehaviourMachine } from './machines/tm-behaviour.js';
import { parseMachineInput } from './machines/index.js';
import { runSim, scrubSim } from './simulation.js';
import { openSpaceTime } from './spacetime-ui.js';
import { revealPlayer } from './ui.js';
import { syncPanelEmpty } from './panel-float.js';
import { sectionSide } from './panel-sections.js';
import { Change, subscribe } from './store.js';
import { setSectionStatus } from './section-status.js';

export const BEHAVIOUR_SECTION = 'rp-behaviour';

const TICK_MS = 12;
const SLICE = 20000;
const BUDGETS = [[1e5, '100k'], [1e6, '1M'], [1e7, '10M'], [1e8, '100M'], [1e9, '1B'], [1e10, '10B']];
// How many cells of a window the evidence strip draws before it elides.
const STRIP = 22;

let built = false;
let els = null;

const plan = { tape: 'blank', word: '', budget: 1e7 };

// The answer on screen, what it was of, and whether it still is.
let result = null;
let ranFor = null;
let stale = false;
let running = null;

// Each workspace tab keeps its own answer. Pasting a machine opens a new tab,
// and carrying the last tab's answer into it — marked stale, as an edit would
// be — read as though the new machine had been classified and then changed.
// Switching back finds the answer where it was left.
const byWorkspace = new Map();
let shownFor = null;

/** Test hook: all of this is module state. */
export function resetBehaviour() {
  if (running) { clearTimeout(running.timer); running = null; }
  watching = false;
  built = false; els = null; result = null; ranFor = null; stale = false;
  byWorkspace.clear();
  shownFor = null;
  statusText = ''; statusTone = '';
  Object.assign(plan, { tape: 'blank', word: '', budget: 1e7 });
}

/** Put the outgoing tab's answer away and bring the incoming tab's out. */
function followWorkspace() {
  if (shownFor === activeWorkspaceId) return;
  if (running) {
    clearTimeout(running.timer);
    running = null;
    statusText = ''; statusTone = '';
  }
  if (shownFor !== null) byWorkspace.set(shownFor, { result, ranFor, stale, statusText, statusTone, plan: { ...plan } });
  const back = byWorkspace.get(activeWorkspaceId);
  ({ result, ranFor, stale, statusText, statusTone } = back || { result: null, ranFor: null, stale: false, statusText: '', statusTone: '' });
  if (back) Object.assign(plan, back.plan);
  shownFor = activeWorkspaceId;
}

const offered = (m = App.machine) => BEHAVIOUR_MACHINES.has(m);

// ══════════════════════════════════════════════════════════════════
//  BUILDING
// ══════════════════════════════════════════════════════════════════

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function button(cls, text, key, tip) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.bh = key;
  if (tip) b.setAttribute('data-tip', tip);
  return b;
}

function ensureBuilt() {
  if (built) return !!els;
  const body = $('bh-body');
  if (!body || typeof body.appendChild !== 'function') return false;
  built = true;
  clear(body);

  const controls = el('div', 'bh-controls');
  const row1 = el('div', 'bh-row');
  const seg = el('div', 'cx-seg bh-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Starting tape');
  const segBlank = button('cx-seg-btn', 'Blank tape', 'tape', 'Start on an empty tape — the busy beaver convention.');
  segBlank.dataset.val = 'blank';
  const segWord = button('cx-seg-btn', 'Word', 'tape', 'Start with a word written on the tape.');
  segWord.dataset.val = 'word';
  seg.append(segBlank, segWord);
  const word = el('input', 'inp bh-word');
  word.placeholder = 'word';
  word.autocomplete = 'off';
  word.spellcheck = false;
  word.dataset.bh = 'word';
  word.setAttribute('aria-label', 'Starting word');
  row1.append(seg, word);

  const row2 = el('div', 'bh-row');
  const budgetLbl = el('label', 'cx-num-lbl bh-budget-lbl', 'Up to ');
  const budget = el('select', 'inp bh-budget');
  budget.dataset.bh = 'budget';
  budget.setAttribute('aria-label', 'Step budget');
  for (const [v, label] of BUDGETS) {
    const o = el('option', null, label);
    o.value = String(v);
    budget.appendChild(o);
  }
  budgetLbl.append(budget, document.createTextNode(' steps'));
  const runBtn = button('cx-run bh-run', 'Classify', 'run');
  row2.append(budgetLbl, runBtn);
  controls.append(row1, row2);

  const progress = el('div', 'cx-progress');
  progress.hidden = true;
  const bar = el('i');
  progress.appendChild(bar);
  const status = el('div', 'cx-status');
  status.setAttribute('aria-live', 'polite');

  const out = el('div', 'bh-out');
  const foot = el('p', 'bh-foot');
  foot.innerHTML = 'Proves that the run from this tape <b>halts</b>, or that it never halts, by one of five methods: '
    + '<b>cycler</b> (a configuration recurs exactly), <b>translated cycler</b> (the same state and tape segment recur, shifted, at the edge of the visited tape), '
    + '<b>backward reasoning</b> (every halting configuration is at most L steps from any configuration that reaches it, and the run has passed step L), '
    + 'and, from a blank tape once the budget is spent, bbchallenge\'s <b>halting segment</b> and <b>finite automata reduction</b> (no configuration that leads to a halt can be reached from the start). '
    + 'Steps are counted as bbchallenge counts them: reading a missing transition is the halting step. '
    + '<b>Unknown</b> means no method produced a proof within the budget. It is not a claim that the machine runs forever.';

  body.append(controls, progress, status, out, foot);
  els = { body, segBlank, segWord, word, budget, runBtn, progress, bar, status, out, foot };

  body.addEventListener('click', onClick);
  body.addEventListener('input', onInput);
  body.addEventListener('change', onInput);
  word.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startClassify(); } });
  renderAll();
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  VISIBILITY
// ══════════════════════════════════════════════════════════════════

export function syncBehaviourSection() {
  const sec = $(BEHAVIOUR_SECTION);
  if (!sec || !sec.style) return;
  const want = offered() ? '' : 'none';
  if (sec.style.display !== want) {
    sec.style.display = want;
    syncPanelEmpty(sectionSide(BEHAVIOUR_SECTION));
  }
  if (!offered() && running) stopClassify();
  followWorkspace();
  // An edit leaves the answer on screen about a machine that is gone. It
  // stays, marked, rather than vanishing under the reader.
  if (result && ranFor && ranFor.signature !== machineSignature()) stale = true;
  if (ranFor && !offered()) { result = null; ranFor = null; stale = false; }
  if (built) renderAll();
  else watchForFirstShow();
}

let watching = false;
function watchForFirstShow() {
  if (watching || typeof ResizeObserver !== 'function') return;
  const body = $('bh-body');
  if (!body || typeof body.getBoundingClientRect !== 'function') return;
  watching = true;
  const ro = new ResizeObserver(() => {
    if (built || !(body.clientHeight || body.clientWidth)) return;
    ensureBuilt();
    ro.disconnect();
  });
  ro.observe(body);
}

subscribe(Change.GRAPH, syncBehaviourSection);

function machineSignature() {
  return `${App.machine}|${App.startId}|${[...App.accepts].join(',')}|${App.config.twoWayTape}|`
    + App.transitions.map(t => `${t.from}>${t.to}:${t.symbol}:${t.write ?? ''}${t.dir ?? ''}`).join(';');
}

// ══════════════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════════════

function onClick(e) {
  const b = e.target.closest && e.target.closest('[data-bh]');
  if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
  switch (b.dataset.bh) {
    case 'tape':
      plan.tape = b.dataset.val;
      renderControls();
      if (plan.tape === 'word') els.word.focus();
      break;
    case 'run':
      if (running) stopClassify(); else startClassify();
      break;
    case 'player':
      showInPlayer(false);
      break;
    case 'diagram':
      showInPlayer(true);
      break;
  }
}

function onInput(e) {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.bh) return;
  if (t.dataset.bh === 'word') plan.word = t.value;
  else if (t.dataset.bh === 'budget') plan.budget = Number(t.value) || 1e7;
  renderControls();
}

/** The starting tape as symbols, or a sentence saying why it cannot be read. */
function startingTape() {
  if (plan.tape === 'blank') return { ok: true, input: [], label: 'a blank tape' };
  const raw = plan.word.trim();
  if (!raw) return { ok: false, error: 'Type the word to start from, or choose a blank tape.' };
  const parsed = parseMachineInput(App.machine, raw);
  if (!parsed.ok) return parsed;
  return { ok: true, input: parsed.input, label: `“${raw.length > 24 ? raw.slice(0, 23) + '…' : raw}”` };
}

// ══════════════════════════════════════════════════════════════════
//  RUNNING
// ══════════════════════════════════════════════════════════════════

export function startClassify() {
  if (!ensureBuilt() || !offered()) return;
  const tape = startingTape();
  if (!tape.ok) { setStatus(tape.error, 'bad'); return; }
  const p = compileBehaviourMachine(tape.input);
  if (!p.ok) { setStatus(p.error, 'bad'); return; }

  result = null;
  stale = false;
  ranFor = { signature: machineSignature(), p, tape, budget: plan.budget, started: now() };
  const c = classifyBehaviour(p, { budget: plan.budget });
  running = { c, timer: 0 };
  setStatus('Starting…');
  renderAll();

  const tick = () => {
    if (!running) return;
    const t0 = now();
    let v = null;
    do v = c.advance(SLICE); while (!v && now() - t0 < TICK_MS);
    if (v) {
      running = null;
      result = v;
      const secs = (now() - ranFor.started) / 1000;
      setStatus(`Checked ${fmt(stepsOf(v))} steps in ${secs < 0.1 ? `${Math.max(1, Math.round(secs * 1000))} ms` : `${secs.toFixed(1)} s`}.`, 'done');
      renderAll();
      return;
    }
    renderProgress();
    running.timer = setTimeout(tick, 0);
  };
  running.timer = setTimeout(tick, 0);
}

export function stopClassify() {
  if (!running) return;
  clearTimeout(running.timer);
  const steps = running.c.steps;
  running = null;
  setStatus(`Stopped after ${fmt(steps)} steps, with no answer yet.`, 'done');
  renderAll();
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const fmt = n => Number(n).toLocaleString('en');

function stepsOf(v) {
  if (v.method === 'simulation') return v.transitions ?? v.steps;
  if (v.method === 'cycler') return v.from + 2 * v.period;
  if (v.method === 'translated') return v.at;
  return v.steps;
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
  renderResult();
}

function renderControls() {
  const { segBlank, segWord, word, budget, runBtn } = els;
  for (const [b, on] of [[segBlank, plan.tape === 'blank'], [segWord, plan.tape === 'word']]) {
    b.classList.toggle('on', on);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  word.hidden = plan.tape !== 'word';
  if (document.activeElement !== word && word.value !== plan.word) word.value = plan.word;
  if (budget.value !== String(plan.budget)) budget.value = String(plan.budget);
  runBtn.textContent = running ? 'Stop' : 'Classify';
  runBtn.classList.toggle('is-stop', !!running);
}

function renderProgress() {
  const { progress, bar } = els;
  progress.hidden = !running;
  if (!running) return;
  const f = running.c.steps / running.c.budget;
  bar.style.width = `${Math.max(1, Math.round(f * 100))}%`;
  setStatus(`Running — ${fmt(running.c.steps)} of ${fmt(running.c.budget)} steps`);
}

function renderStatus() {
  const { status } = els;
  let text = statusText, tone = statusTone;
  if (!running && stale) { text = 'The machine has changed since this ran — classify it again to see the machine as it is now.'; tone = 'warn'; }
  status.textContent = text;
  status.className = 'cx-status' + (tone ? ` is-${tone}` : '');
  status.hidden = !text;
  syncHeaderStatus();
}

/**
 * The folded header's chip: the verdict and nothing else, in the card's own
 * colours. A header is narrow, and a number there ("47,176,870 steps") was
 * cut off before it said anything; the card has the numbers.
 */
function syncHeaderStatus() {
  if (running) { setSectionStatus(BEHAVIOUR_SECTION, 'running…'); return; }
  if (!result) { setSectionStatus(BEHAVIOUR_SECTION, ''); return; }
  const verdict = result.verdict;
  const text = verdict === 'never' ? 'never halts' : verdict;
  if (stale) { setSectionStatus(BEHAVIOUR_SECTION, `${text} · stale`, 'warn'); return; }
  setSectionStatus(BEHAVIOUR_SECTION, text, verdict === 'halts' ? 'acc' : verdict === 'unknown' ? 'warn' : 'rej');
}

// ── the answer ────────────────────────────────────────────────────

// By method, and `unknown` for a verdict with none.
const ICONS = {
  simulation: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.7L16.2 9.5"/></svg>',
  cycler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.2v4.3h-4.3"/></svg>',
  // The cycler's loop, smaller, with the way it travels beside it.
  translated: '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(-1.2 3.4) scale(.72)" stroke-width="2.5"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.2v4.3h-4.3"/></g><path d="M15 12h7M19 9l3 3-3 3"/></svg>',
  // An arrow turning back on itself: the search runs from the halt backwards.
  backward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5l-5 5 5 5"/><path d="M4.5 10.5H14a5.5 5.5 0 0 1 0 11h-3"/></svg>',
  // A bracketed stretch of tape, searched backwards inside it.
  segment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5H4.5v14H7"/><path d="M17 5h2.5v14H17"/><path d="M13.5 8.5L10 12l3.5 3.5"/></svg>',
  // Two automaton states and the move between them.
  far: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="3.5"/><circle cx="17.5" cy="12" r="3.5"/><path d="M10 12h4"/><path d="M12.5 10l2 2-2 2"/></svg>',
  unknown: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>'
};

function renderResult() {
  const { out } = els;
  clear(out);
  if (!result) {
    if (running) return;
    const empty = el('div', 'bh-empty');
    empty.innerHTML = '<b>Does this machine halt?</b> Classify runs it and looks for a proof either way — '
      + 'the step it stops on, or a repetition that means it never will.';
    out.appendChild(empty);
    return;
  }
  const v = result, p = ranFor.p;
  const card = el('div', `bh-card is-${v.verdict}${stale ? ' is-stale' : ''}`);

  const head = el('div', 'bh-verdict');
  const icon = el('span', 'bh-icon');
  icon.innerHTML = ICONS[v.method ?? 'unknown'];
  const titles = el('div', 'bh-titles');
  const verdictName = { halts: 'Halts', never: 'Never halts', unknown: 'Unknown' }[v.verdict];
  const sub = v.verdict === 'halts' ? (v.how === 'accept' ? 'in an accepting state' : 'no transition to take')
    : v.verdict === 'never' ? METHODS[v.method].name.toLowerCase()
    : 'no proof within the budget';
  titles.append(el('span', 'bh-kind', verdictName), el('span', 'bh-sub', sub));
  head.append(icon, titles);

  const why = el('p', 'bh-why', explain(v, p));
  const facts = el('dl', 'bh-facts');
  for (const [k, val, tip] of factsOf(v, p)) {
    const pair = el('div', 'bh-fact');
    const dd = el('dd', null, val);
    if (tip) dd.setAttribute('data-tip', tip);
    pair.append(el('dt', null, k), dd);
    facts.appendChild(pair);
  }
  card.append(head, why, facts);

  const ev = evidence(v, p);
  if (ev) card.appendChild(ev);

  const actions = el('div', 'bh-actions');
  const target = jumpTarget(v);
  if (target !== null) {
    actions.append(
      button('bh-act', 'Show in player', 'player',
        v.verdict === 'halts' ? `Run the machine in the player and stop at the halt, step ${fmt(target)}` : `Run the machine in the player and stop at step ${fmt(target)}, where the repetition starts`),
      button('bh-act', 'Space-time', 'diagram', `Run it and open the space-time diagram at step ${fmt(target)}`)
    );
    card.appendChild(actions);
  }
  out.appendChild(card);
}

function symName(p, c) {
  return c < 0 ? App.config.sym.any : p.symbols[c];
}

const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

/** A halting configuration, as a reader would name it. */
function haltName(p, h) {
  return h.read < 0 ? `the accepting state ${p.stateNames[h.state]}` : `${p.stateNames[h.state]} reading ${symName(p, h.read)}`;
}

function explain(v, p) {
  const state = s => p.stateNames[s];
  switch (v.method) {
    case 'simulation':
      return v.how === 'accept'
        ? `At step ${fmt(v.steps)} it enters the accepting state ${state(v.state)} and halts. `
          + `The tape then holds ${plural(v.ones, 'non-blank cell')}.`
        : `After ${plural(v.transitions, 'transition')} it is in ${state(v.state)} reading ${symName(p, v.read)}, and δ has no transition for that pair, so it halts. `
          + `Reading the missing transition is the halting step, and the busy beaver convention counts it, so this is a halt at step ${fmt(v.steps)}. `
          + `The tape then holds ${plural(v.ones, 'non-blank cell')}.`;
    case 'cycler':
      return `The configuration at step ${fmt(v.from + v.period)} (state, head position and every tape cell) is identical to the one at step ${fmt(v.from)}. `
        + `The machine is deterministic, so from step ${fmt(v.from)} the run repeats with period ${fmt(v.period)} and never halts.`;
    case 'translated': {
      const edge = v.direction === 'right' ? 'rightmost' : 'leftmost';
      return `At steps ${fmt(v.from)} and ${fmt(v.at)} the head is on a cell further ${v.direction} than any it had visited (a new ${edge} cell), in state ${state(v.state)} both times, `
        + `and the ${plural(v.window, 'cell')} behind the head, its own included, are identical. `
        + `Between those steps the head read only those cells and blank cells beyond them, so the next ${fmt(v.period)} steps repeat the same moves ${plural(Math.abs(v.shift), 'cell')} further ${v.direction}, and so on forever. It never halts.`;
    }
    case 'backward':
      if (v.longest < 0) {
        // Every symbol it can *meet*: one Γ declares but nothing writes is no
        // way to stop from this tape, though a tape holding it might be.
        return 'There is no halting configuration over the symbols this run can contain (the blank, the starting word\'s, and every symbol a transition can write from those): '
          + 'every state has a transition for each of them, and no state is accepting. So the run never halts.';
      }
      return `Searching backwards from each of its ${plural(v.halts.length, 'halting configuration')}, every path of predecessors ends within ${plural(v.longest, 'step')}. `
        + `So any configuration that halts at all, over the symbols this run can contain, halts within ${plural(v.longest, 'step')}. `
        + `The run has taken ${plural(v.steps, 'step')} without halting, so it never halts.`;
    case 'segment':
      return `Looking at the tape only through a segment of ${plural(v.size, 'cell')}, with a halt in its middle, and working backwards from every way it could halt, `
        + `the configurations that can lead to a halt form a closed set of ${plural(v.nodes, 'partial configuration')} — and none of them could be the blank starting tape. `
        + 'So no configuration the run reaches ever leads to a halt, and it never halts. This is bbchallenge\'s halting segment decider.';
    case 'far':
      return `A finite automaton recognises every configuration from which the machine can go on to halt: a ${plural(v.depth, 'state')} DFA reads the tape ${v.side === 'R' ? 'from the left' : 'from the right'} up to the head, `
        + `then an NFA of ${plural(v.states, 'state')} reads the rest. It recognises every halting configuration, it recognises a configuration whenever it recognises the one a step later, `
        + 'and it does not recognise the blank starting tape — so the run never reaches a halt. This is bbchallenge\'s finite automata reduction.';
    default: {
      const gaveUp = !v.backward ? ''
        : v.backward.reason === 'depth' ? ` Backward reasoning gave no bound: a path of predecessors from a halting configuration was still consistent after ${plural(v.backward.depth, 'step')}.`
        : ` Backward reasoning gave no bound: it reached its search limit of ${fmt(v.backward.explored)} partial configurations.`;
      return `No proof within ${plural(v.steps, 'step')}: the run did not halt, no configuration recurred, and no translated repetition was found.${gaveUp}${staticGaveUp(v)} `
        + 'This is not a claim that the machine runs forever. It may halt later, or never halt for a reason these methods cannot detect.';
    }
  }
}

/** What halting segment and finite automata reduction found, for an unknown. */
function staticGaveUp(v) {
  const say = [];
  const hs = v.segment, fa = v.far;
  if (hs) {
    if (hs.reason === 'model') say.push(`Halting segment does not apply: ${hs.why}.`);
    else if (hs.reason === 'start') say.push(`Halting segment found no segment up to ${plural(2 * hs.distance + 1, 'cell')} that excludes the start.`);
    else say.push('Halting segment reached its search limit.');
  }
  if (fa) {
    if (fa.reason === 'model') say.push(`Finite automata reduction does not apply: ${fa.why}.`);
    else if (fa.reason === 'none') say.push(`Finite automata reduction found no DFA up to ${plural(fa.depth, 'state')}.`);
    else say.push(`Finite automata reduction reached its search limit at ${plural(fa.depth, 'DFA state')}.`);
  }
  return say.length ? ` ${say.join(' ')}` : '';
}

function factsOf(v, p) {
  const tapeLbl = ranFor.tape.label;
  switch (v.method) {
    case 'simulation':
      return [['Steps', fmt(v.steps), v.how === 'none' ? `Counted as bbchallenge counts them: ${plural(v.transitions, 'transition')} taken, and the step that reads the missing transition` : 'Transitions taken, the last one into the accepting state'],
        ['Non-blank cells', fmt(v.ones), 'Σ — the ones left, in busy beaver terms'], ['Cells used', fmt(v.cells), 'Cells between the leftmost and rightmost the head visited, inclusive'], ['Started on', tapeLbl]];
    case 'cycler':
      return [['Period', `${fmt(v.period)} step${v.period === 1 ? '' : 's'}`, 'The smallest λ with the configuration at μ + λ equal to the one at μ'],
        ['Starts at step', fmt(v.from), 'The smallest μ: the configuration at step μ − 1 never recurs'],
        ['Cells used', fmt(v.cells), 'Cells between the leftmost and rightmost the head visited, inclusive'], ['Started on', tapeLbl]];
    case 'translated':
      return [['Period', `${fmt(v.period)} steps`], ['Shift', `${v.shift > 0 ? '+' : ''}${fmt(v.shift)} cell${Math.abs(v.shift) === 1 ? '' : 's'}`],
        ['Repeats from', `step ${fmt(v.from)}`, 'The first of the two matching steps. The repetition may have begun earlier: this is where it was detected, not the least such step.'],
        ['Window', `${fmt(v.window)} cell${v.window === 1 ? '' : 's'}`, 'The cells compared: from the head back to the furthest cell the head reached between the two steps'], ['Started on', tapeLbl]];
    case 'backward':
      if (v.longest < 0) return [['Halting configs', 'none', 'Pairs (state, symbol) with no transition, over the symbols this run can contain, plus accepting states'], ['Started on', tapeLbl]];
      return [['Halting configs', fmt(v.halts.length), 'Pairs (state, symbol) with no transition, over the symbols this run can contain, plus accepting states'],
        ['Bound L', plural(v.longest, 'step'), 'Any configuration that halts does so within L steps. The bound is attained: the witness below halts in exactly L.'],
        ['Searched', fmt(v.explored), 'Partial configurations examined, working back from the halting configurations'], ['Started on', tapeLbl]];
    case 'segment':
      return [['Segment', plural(v.size, 'cell'), 'Odd sizes 3, 5, 7, … are tried in turn, the halt in the middle; this is the first that closed'],
        ['Closed set', fmt(v.nodes), 'Partial configurations: what the segment holds, with the state and head, or the head outside it'],
        ['Run first', plural(v.steps, 'step'), 'Halting segment is tried once the run\'s own methods have used the budget'], ['Started on', tapeLbl]];
    case 'far':
      return [['DFA', plural(v.depth, 'state'), 'Reads the tape up to the head, ignoring leading blanks; the smallest that works, searched in bbchallenge\'s order'],
        ['NFA', plural(v.states, 'state'), 'One for each DFA state and machine state, plus a steady accepting state'],
        ['Scan', v.side === 'R' ? 'left to right' : 'right to left'], ['Started on', tapeLbl]];
    default:
      return [['Steps run', fmt(v.steps)], ['Cells used', fmt(v.cells)], ['Started on', tapeLbl]];
  }
}

// Backward reasoning has none: its witness is some configuration, not a step
// of this run.
function jumpTarget(v) {
  // The player counts transitions; a halt on a missing one is not a step there.
  if (v.method === 'simulation') return v.transitions ?? v.steps;
  if (v.method === 'cycler' || v.method === 'translated') return v.from;
  return null;
}

// ── the evidence strip ────────────────────────────────────────────
// A row of tape cells per configuration the proof is about, drawn like the
// tape tracker's: the head's cell outlined, the compared window tinted, and a
// blank cell as the blank symbol, faint.

function strip(p, lo, cells, head, win, label) {
  const row = el('div', 'bh-strip');
  row.appendChild(el('span', 'bh-strip-lbl', label));
  const track = el('div', 'bh-cells');
  // As many cells as the card has room for; past that, the ones nearest the
  // head, with an ellipsis on each side that was cut.
  const width = (els && els.out.clientWidth) || 280;
  const fit = Math.max(8, Math.floor((width - 50) / 19));
  let from = 0, to = cells.length;
  if (cells.length > fit) {
    const n = fit - 1, hk = head - lo;
    from = Math.max(0, Math.min(cells.length - n, hk - Math.floor(n / 2)));
    to = from + n;
    if (hk >= cells.length - 2) { from = cells.length - n; to = cells.length; }
    else if (hk <= 1) { from = 0; to = n; }
  }
  if (from > 0) track.appendChild(el('span', 'bh-cell is-more', '…'));
  for (let k = from; k < to; k++) {
    const x = lo + k;
    const c = cells[k];
    const cell = el('span', 'bh-cell', symName(p, c));
    if (c === 0) cell.classList.add('is-blank');
    else if (c < 0) cell.classList.add('is-any');
    if (win && x >= win[0] && x <= win[1]) cell.classList.add('is-win');
    if (x === head) cell.classList.add('is-head');
    track.appendChild(cell);
  }
  if (to < cells.length) track.appendChild(el('span', 'bh-cell is-more', '…'));
  row.appendChild(track);
  return row;
}

function evidence(v, p) {
  if (v.method === 'backward') {
    if (v.longest < 0) return null;
    const w = v.witness;
    const box = el('div', 'bh-evidence');
    box.appendChild(el('div', 'bh-ev-cap', `A configuration that halts (at ${haltName(p, w.halt)}) in exactly ${plural(v.longest, 'step')}, the most any can take.${w.cells.includes(-1) ? ` Cells marked ${App.config.sym.any} are never read on the way and may hold any symbol.` : ''}`));
    box.appendChild(strip(p, w.lo, w.cells, w.head, null,
      `in state ${p.stateNames[w.state]}${w.wall !== null ? ' · the first cell is the start of the tape' : ''}`));
    // Each way to halt and how far back its paths reached, deepest first.
    const list = el('ul', 'bh-halts');
    const halts = [...v.halts].sort((a, b) => b.depth - a.depth);
    const shown = halts.slice(0, 6);
    for (const h of shown) {
      const li = el('li');
      li.append(el('span', null, haltName(p, h)), el('span', 'bh-halt-d', h.depth ? `reached within ${plural(h.depth, 'step')}` : 'no predecessor'));
      list.appendChild(li);
    }
    if (halts.length > shown.length) list.appendChild(el('li', 'bh-halt-more', `and ${fmt(halts.length - shown.length)} more`));
    box.appendChild(list);
    return box;
  }
  if (v.method === 'translated') {
    const box = el('div', 'bh-evidence');
    box.appendChild(el('div', 'bh-ev-cap', 'The same window, two records apart'));
    const b = v.before, a = v.after;
    const w1 = [b.lo, b.lo + b.cells.length - 1], w2 = [a.lo, a.lo + a.cells.length - 1];
    // Each window plus one fresh blank cell beyond the head, which is what makes it a record.
    const pad = (w, cells) => (v.direction === 'right' ? { lo: w[0], cells: [...cells, 0] } : { lo: w[0] - 1, cells: [0, ...cells] });
    const r1 = pad(w1, b.cells), r2 = pad(w2, a.cells);
    box.append(
      strip(p, r1.lo, r1.cells, b.head, w1, `step ${fmt(b.t)} · head at cell ${fmt(b.head)}`),
      strip(p, r2.lo, r2.cells, a.head, w2, `step ${fmt(a.t)} · head at cell ${fmt(a.head)}`)
    );
    return box;
  }
  if (v.method === 'segment') {
    const box = el('div', 'bh-evidence');
    box.appendChild(el('div', 'bh-ev-cap', 'Each segment size, until one closed'));
    const list = el('ul', 'bh-halts');
    for (const t of v.tried) {
      const li = el('li');
      li.append(el('span', null, plural(t.size, 'cell')), el('span', 'bh-halt-d', `the start was possible after ${plural(t.nodes, 'node')}`));
      list.appendChild(li);
    }
    const li = el('li');
    li.append(el('span', null, plural(v.size, 'cell')), el('span', 'bh-halt-d', `closed with ${plural(v.nodes, 'node')}`));
    list.appendChild(li);
    box.appendChild(list);
    return box;
  }
  if (v.method === 'far') {
    const box = el('div', 'bh-evidence');
    box.appendChild(el('div', 'bh-ev-cap', `The DFA, state 0 first: where each state goes on each symbol, reading ${v.side === 'R' ? 'left to right' : 'right to left'}`));
    const list = el('ul', 'bh-halts');
    v.dfa.forEach((row, q) => {
      const li = el('li');
      li.append(el('span', null, `q${q}`), el('span', 'bh-halt-d', row.map((to, b) => `${symName(p, b)} → q${to}`).join(' · ')));
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }
  if (v.method === 'cycler') {
    const box = el('div', 'bh-evidence');
    box.appendChild(el('div', 'bh-ev-cap', `The configuration at step ${fmt(v.from)} — and again at step ${fmt(v.from + v.period)}`));
    box.appendChild(strip(p, v.at.lo, v.at.cells, v.at.head, null, `in state ${p.stateNames[v.state]}, head at cell ${fmt(v.at.head)}`));
    return box;
  }
  return null;
}

// ── into the player ───────────────────────────────────────────────

function showInPlayer(diagram) {
  const v = result;
  if (!v || !ranFor) return;
  const target = jumpTarget(v);
  if (target === null) return;
  if (stale) { showStatus('The machine has changed since this was classified — classify it again first.'); return; }
  if (target >= App.config.maxTmSteps) {
    showStatus(`Step ${fmt(target)} is past the player's step limit of ${fmt(App.config.maxTmSteps)} — raise it in Settings → Simulation → Step Limits to go there.`);
    return;
  }
  const box = $('sim-in');
  if (!box) return;
  box.value = plan.tape === 'blank' ? '' : plan.word;
  revealPlayer();
  runSim();
  const run = App.simRun;
  if (!run) return;
  run.at(target);
  scrubSim(String(Math.min(target, App.simSteps.length - 1)));
  if (diagram) openSpaceTime();
  showStatus(v.verdict === 'halts' ? `The player is at the halt, step ${fmt(target)}` : `The player is at step ${fmt(target)}, where the repetition starts`);
}

// Test seam.
export const _behaviourTests = {
  plan,
  get result() { return result; },
  get running() { return !!running; },
  get stale() { return stale; }
};
