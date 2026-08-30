import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHarness } from './harness.js';
import { getElement } from './dom-stub.js';

// Multi-tape Turing machines, as a machine you can *change*.
//
// MTM is the one machine whose arity is a setting, and almost everything
// that went wrong here came from that number being kept in two places at
// once. The picker in the right panel was never filled in from the machine,
// so a 3-tape file opened reading "2"; the reader who then chose "2" — the
// number already on screen — did not get a no-op, they got every transition
// in the machine deleted, because the control's idea of the arity and
// App.tapeCount's had come apart.
//
// The rest is the same fact in other places: what a run does with k heads
// had two implementations, the player's and the decider's, and they read
// different input shapes and treated a wildcard write differently. These
// tests pin the arity as one number and the k-head step as one rule.

const MTM_JSON = fs.readFileSync(new URL('../js/examples/mtm.json', import.meta.url), 'utf8');
const MTM = JSON.parse(MTM_JSON);

const harness = createHarness();
const { context } = harness;

/**
 * The bundled 3-tape adder, on a fresh canvas.
 *
 * Parsed per call rather than once: loadData assigns data.transitions
 * straight onto App without copying, so reshaping the arity in one test
 * would edit the fixture every later test reads. The app parses a fresh
 * blob on every load; a shared constant here would not.
 */
function loadMTM() {
  harness.resetApp();
  context.loadData(JSON.parse(MTM_JSON));
  return context.App;
}

/** A minimal multi-tape machine whose transitions the caller writes. */
function multiTape(transitions, opts = {}) {
  harness.resetApp();
  const { App, loadData } = context;
  loadData({
    machine: 'MTM',
    sigma: opts.sigma || ['a', 'b'],
    stackAlpha: opts.stackAlpha || ['a', 'b', '⊔'],
    tapeCount: opts.tapeCount || 2,
    states: [
      { id: 's1', x: 0, y: 0, name: 'q0' },
      { id: 's2', x: 100, y: 0, name: 'q1' }
    ],
    startId: 's1',
    accepts: opts.accepts || ['s2'],
    transitions
  });
  return App;
}

const ALU_JSON = fs.readFileSync(new URL('../js/examples/mtm-alu.json', import.meta.url), 'utf8');

const picker = () => getElement('tape-count-sel');

/** The rows the tracker actually drew, as js/tape-view.js built them. */
function drawnRows(idx) {
  context.App.simIdx = idx;
  context.renderSimStep();
  const body = context.$('sim-tracker').__tvBody;
  return body ? body.children : [];
}

/** The values the picker currently offers, read off the markup it generated. */
const offered = () => [...String(picker().innerHTML).matchAll(/value="(\d+)"/g)].map(m => m[1]);

const labelOf = row => row.children[0].children[0].textContent;
const trackOf = row => row.children[1].children[0];
const widths = App => [...new Set(App.transitions.map(t =>
  t.tapeSyms.length + '/' + t.tapeWrites.length + '/' + t.tapeDirs.length))];

// ── the arity is one number ───────────────────────────────────────

test('the tape picker is filled in from the machine, not from what it last showed', () => {
  picker().value = '2';
  const App = loadMTM();
  assert.equal(App.tapeCount, 3);
  assert.equal(picker().value, '3',
    'a 3-tape machine that opens showing "2" is a wrong number over a delta drawn in Gamma^3');
});

test('switching to a multi-tape machine fills the picker in as it reveals it', () => {
  harness.resetApp();
  const { App, setMachine } = context;
  picker().value = '4';
  setMachine('MTM');
  assert.equal(picker().value, String(App.tapeCount),
    'revealing the control is not the same as filling it in');
});

test('choosing the arity the machine already has is a no-op, not a rebuild', () => {
  const App = multiTape([
    { id: 't1', from: 's1', to: 's2', symbol: 'a', tapeSyms: ['a', '⊔'], tapeWrites: ['a', 'a'], tapeDirs: ['R', 'R'] }
  ]);
  const before = JSON.stringify(App.transitions);
  picker().value = '2';
  context.setTapeCount(2);
  assert.equal(JSON.stringify(App.transitions), before);
  assert.equal(picker().value, '2');
});

// ── changing it reshapes rather than deletes ──────────────────────

test('adding a tape keeps every transition and pads it with a head that does nothing', () => {
  const App = loadMTM();
  const { setTapeCount, parseMachineInput, decideMachine } = context;
  const words = MTM.meta.inputs.map(s => s.w);
  const before = words.map(w => decideMachine('MTM', parseMachineInput('MTM', w).input).verdict);
  const count = App.transitions.length;

  setTapeCount(4);

  assert.equal(App.tapeCount, 4);
  assert.equal(App.transitions.length, count,
    'nothing about a k-tape rule stops being true when a (k+1)th tape appears');
  assert.deepEqual(widths(App), ['4/4/4'], 'every per-tape array is as wide as the tape count');
  App.transitions.forEach(t => {
    assert.equal(t.tapeWrites[3], App.config.sym.blank);
    assert.equal(t.tapeDirs[3], 'S', 'a new head starts still, so the machine decides what it decided');
  });
  assert.deepEqual(
    words.map(w => decideMachine('MTM', parseMachineInput('MTM', w).input).verdict),
    before,
    'widening is not allowed to change a single verdict');
});

test('adding a tape does not stop to ask, because nothing is lost', () => {
  const App = multiTape([
    { id: 't1', from: 's1', to: 's2', symbol: 'a', tapeSyms: ['a', '⊔'], tapeWrites: ['a', 'a'], tapeDirs: ['R', 'R'] }
  ]);
  getElement('confirm-msg').textContent = 'untouched';
  picker().value = '3';
  context.setTapeCount(3);
  assert.equal(App.tapeCount, 3, 'applied outright');
  assert.equal(getElement('confirm-msg').textContent, 'untouched', 'and nothing was asked');
});

test('removing a tape asks first, and says which tape goes', () => {
  const App = loadMTM();
  const { setTapeCount } = context;
  picker().value = '2';
  setTapeCount(2);

  assert.equal(App.tapeCount, 3, 'nothing happens until the question is answered');
  assert.match(getElement('confirm-msg').textContent, /tape 3/,
    'naming the tape is the whole of what makes the question answerable');
  assert.equal(picker().value, '3',
    'the picker is put back on the real arity while the question stands');

  getElement('confirm-action-btn').onclick();
  assert.equal(App.tapeCount, 2);
  assert.deepEqual(widths(App), ['2/2/2']);
  assert.equal(picker().value, '2', 'and follows the machine once it is answered');
});

test('refusing to remove a tape leaves the picker on the machine, not on the refusal', () => {
  const App = loadMTM();
  const { setTapeCount } = context;
  const before = JSON.stringify(App.transitions);
  picker().value = '2';          // what the browser does before onchange fires
  setTapeCount(2);
  // The reader dismisses the dialog; nothing else runs.
  assert.equal(App.tapeCount, 3);
  assert.equal(picker().value, '3',
    'a control still showing the number that was just declined is a lie about the machine');
  assert.equal(JSON.stringify(App.transitions), before);
});

test('removing a tape says so when it merges two rules into one read tuple', () => {
  const App = multiTape([
    { id: 't1', from: 's1', to: 's2', symbol: 'a', tapeSyms: ['a', 'a', '⊔'], tapeWrites: ['a', 'a', '⊔'], tapeDirs: ['R', 'R', 'R'] },
    { id: 't2', from: 's1', to: 's2', symbol: 'a', tapeSyms: ['a', 'a', 'b'], tapeWrites: ['a', 'a', 'b'], tapeDirs: ['R', 'R', 'R'] }
  ], { tapeCount: 3, stackAlpha: ['a', 'b', '⊔'] });
  picker().value = '2';
  context.setTapeCount(2);
  assert.match(getElement('confirm-msg').textContent, /read the same tuple/,
    'delta is single-valued here, so two rules collapsing into one is worth saying out loud');
  assert.equal(App.tapeCount, 3);
});

test('the wizard and the picker agree about what a new tape starts as', () => {
  const { setDraftTapeCount, setTapeArity } = context;
  const row = { tapeSyms: ['a', 'b'], tapeWrites: ['a', 'b'], tapeDirs: ['R', 'L'] };
  const draft = { transitions: [JSON.parse(JSON.stringify(row))] };
  const canvas = [JSON.parse(JSON.stringify(row))];
  setDraftTapeCount(draft, 4);
  setTapeArity(canvas, 4);
  assert.deepEqual(draft.transitions[0], canvas[0], 'one rule, not two answers');
});

// ── one rule for the k-head step ──────────────────────────────────

test('a wildcard write puts back what that head read, as it does on one tape', () => {
  const any = context.App.config.sym.any;

  multiTape([{ id: 't1', from: 's1', to: 's2', symbol: 'a', tapeSyms: [any, any], tapeWrites: [any, any], tapeDirs: ['R', 'R'] }]);
  context.simMTM(['a']);
  assert.deepEqual(context.App.simSteps.at(-1).tapes[0], ['a', '⊔'],
    'writing the wildcard literally leaves a symbol in no alphabet on the tape');

  // The same rule the single-tape machines have always followed.
  harness.resetApp();
  context.loadData({
    machine: 'TM', sigma: ['a'], stackAlpha: ['a', '⊔'],
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }, { id: 's2', x: 100, y: 0, name: 'q1' }],
    startId: 's1', accepts: ['s2'],
    transitions: [{ id: 't1', from: 's1', to: 's2', symbol: any, write: any, dir: 'R' }]
  });
  context.simTM(['a']);
  assert.deepEqual(context.App.simSteps.at(-1).tape, ['a', '⊔']);
});

test('the decider reads the same input shapes the player does', () => {
  const App = loadMTM();
  const { parseMachineInput, decideMachine, simulateMachine } = context;

  for (const sample of MTM.meta.inputs) {
    const parsed = parseMachineInput('MTM', sample.w);
    assert.ok(parsed.ok, sample.w);
    // Both halves take the per-tape form. Unwrapping it in only one of the
    // two is what made every multi-tape row in the batch tester throw.
    assert.doesNotThrow(() => decideMachine('MTM', parsed.input), 'decide ' + sample.w);
    assert.doesNotThrow(() => simulateMachine('MTM', parsed.input), 'simulate ' + sample.w);
    assert.equal(decideMachine('MTM', parsed.input).verdict === 'acc',
      App.simSteps.at(-1).final === 'accept',
      sample.w + ': the decider and the player must not disagree');
  }
});

test('a multi-tape batch row decides instead of throwing', () => {
  loadMTM();
  const { decideBatchRow } = context;
  const row = decideBatchRow(MTM.meta.inputs[0].w, null);
  assert.equal(row.error, undefined, 'the batch tester is where per-tape input gets typed');
  assert.equal(row.verdict, 'accept');
});

test('one word per tape starts one word per tape, not one tape with everything', () => {
  const App = multiTape([
    { id: 't1', from: 's1', to: 's2', symbol: 'a', tapeSyms: ['a', 'b'], tapeWrites: ['a', 'b'], tapeDirs: ['S', 'S'] }
  ]);
  context.simulateMachine('MTM', context.parseMachineInput('MTM', 'a,b').input);
  assert.deepEqual(App.simSteps[0].tapes, [['a'], ['b']]);
  assert.equal(App.simSteps.at(-1).final, 'accept');
});

test('a two-way multi-tape run names the cell each head is on', () => {
  harness.resetApp();
  const { App, loadData, simMTM } = context;
  const any = App.config.sym.any;
  loadData({
    machine: 'MTM', sigma: ['a'], stackAlpha: ['a', '⊔'], tapeCount: 2,
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }],
    startId: 's1', accepts: [],
    transitions: [{ id: 't1', from: 's1', to: 's1', symbol: 'a', tapeSyms: [any, any], tapeWrites: [any, any], tapeDirs: ['L', 'R'] }],
    config: { ...JSON.parse(JSON.stringify(App.config)), twoWayTape: true, maxTmSteps: 3 }
  });
  simMTM(['a']);
  // The drawn head index is an offset into the window; on a two-way tape the
  // two diverge the moment it grows leftward, and with k heads "head 0"
  // would name a different place on every row.
  assert.match(App.simSteps.at(-1).note, /@\[-2,2\]/);
});

// ── the tapes are drawn as tapes ──────────────────────────────────

test('a k-tape run draws k rows, each carrying its own ends', () => {
  const App = loadMTM();
  const { simMTM } = context;
  assert.equal(App.tapeCount, 3);
  simMTM(['1', '0']);
  const step = App.simSteps[0];
  assert.equal(step.tapes.length, 3);
  assert.equal(step.heads.length, 3);
  assert.equal(step.views.length, 3, 'a row with no view cannot say where its tape stops');
  step.views.forEach(v => {
    assert.equal(v.leftBound, 0, 'these tapes are bounded at cell 0');
    assert.equal(v.rightBound, null, 'and run on forever to the right');
  });
});

test('a four-tape run draws four rows, and the widest machine draws them all', () => {
  harness.resetApp();
  context.loadData(JSON.parse(ALU_JSON));
  const { App, parseMachineInput, simulateMachine } = context;
  assert.equal(App.tapeCount, 4);

  simulateMachine('MTM', parseMachineInput('MTM', '1101,0110,+,ε').input);
  const rows = drawnRows(0);
  assert.deepEqual(rows.map(labelOf), ['T1', 'T2', 'T3', 'T4'],
    'k rows, named for the tapes rather than for the first two');

  // Each row is a tape with its own ends: a wall at cell 0, blank tape
  // running on to the right. Four rows of cells with nothing at the edges
  // would be four rows nobody can tell apart.
  rows.forEach(row => {
    const track = trackOf(row);
    assert.ok(String(track.children[0].className).includes('is-wall'));
    assert.ok(String(track.children[2].className).includes('is-open'));
  });

  // Tape 3 holds the opcode and its head never moves, so the operation is
  // legible in every configuration of the run.
  const opRow = () => trackOf(drawnRows(context.App.simIdx)[2]).children[1].children[0].children[0].textContent;
  for (let i = 0; i < App.simSteps.length; i++) {
    App.simIdx = i;
    assert.equal(opRow(), '+');
  }
});

// ── how many tapes is a setting, not a literal ────────────────────
//
// The arity used to be the literal 2..4 written out in seven places: the
// picker's markup, the picker's clamp, the wizard's clamp, the wizard's
// validation, the wizard's option list, StateMate's schema and its agent
// tool. Four is not a fact about anything — k tapes are k Tape objects and
// k columns on a transition, and nothing in the simulators, the tracker or
// the save format counts to four.

test('the picker offers as many tapes as the setting allows', () => {
  harness.resetApp();
  const { App, setMachine, syncTapeCountUI } = context;
  setMachine('MTM');

  App.config.maxTapeCount = 4;
  syncTapeCountUI();
  assert.deepEqual(offered(), ['2', '3', '4']);

  App.config.maxTapeCount = 9;
  syncTapeCountUI();
  assert.deepEqual(offered(), ['2', '3', '4', '5', '6', '7', '8', '9'],
    'raising Settings → Turing → Maximum Tapes is the whole of what makes a fifth tape offerable');
});

test('a machine with more tapes than the setting still opens, and the picker shows its arity', () => {
  harness.resetApp();
  const { App, loadData } = context;
  App.config.maxTapeCount = 3;
  loadData({
    machine: 'MTM', sigma: ['a'], stackAlpha: ['a', '⊔'], tapeCount: 9,
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], startId: 's1', accepts: [], transitions: []
  });
  assert.equal(App.tapeCount, 9, 'the setting bounds what you can choose, never what you can open');
  assert.equal(picker().value, '9',
    'a picker that could not show its own machine is the two-places-for-one-number bug again');
});

test('a seven-tape machine runs, decides and draws seven rows', () => {
  harness.resetApp();
  const { App, loadData, parseMachineInput, decideMachine, simulateMachine } = context;
  const blank = App.config.sym.blank;
  const K = 7;
  loadData({
    machine: 'MTM', sigma: ['a'], stackAlpha: ['a', blank], tapeCount: K,
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }, { id: 's2', x: 120, y: 0, name: 'acc' }],
    startId: 's1', accepts: ['s2'],
    transitions: [
      // Fan the input out across every work tape, one cell per step.
      { id: 't1', from: 's1', to: 's1', symbol: 'a',
        tapeSyms: ['a', ...Array(K - 1).fill(blank)],
        tapeWrites: Array(K).fill('a'), tapeDirs: Array(K).fill('R') },
      { id: 't2', from: 's1', to: 's2', symbol: blank,
        tapeSyms: Array(K).fill(blank), tapeWrites: Array(K).fill(blank), tapeDirs: Array(K).fill('S') }
    ]
  });

  const parsed = parseMachineInput('MTM', 'aa');
  assert.equal(decideMachine('MTM', parsed.input).verdict, 'acc');
  simulateMachine('MTM', parsed.input);

  const last = App.simSteps.at(-1);
  assert.equal(last.tapes.length, K);
  last.tapes.forEach(t => assert.deepEqual(t, ['a', 'a', blank]), 'every head wrote its own tape');

  assert.deepEqual(drawnRows(0).map(labelOf), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
});

test('widening past four keeps every rule and pads it', () => {
  harness.resetApp();
  const { App, loadData, setTapeCount } = context;
  const blank = App.config.sym.blank;
  App.config.maxTapeCount = 12;
  loadData({
    machine: 'MTM', sigma: ['a'], stackAlpha: ['a', blank], tapeCount: 7,
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], startId: 's1', accepts: [],
    transitions: [{ id: 't1', from: 's1', to: 's1', symbol: 'a',
      tapeSyms: Array(7).fill('a'), tapeWrites: Array(7).fill('a'), tapeDirs: Array(7).fill('R') }]
  });

  setTapeCount(12);
  assert.equal(App.tapeCount, 12);
  assert.deepEqual(widths(App), ['12/12/12']);
  assert.equal(App.transitions[0].tapeDirs.join(''), 'RRRRRRRSSSSS',
    'the five new heads start still');
});

test('the arity is clamped to what the app can draw, and never below two', () => {
  const { clampTapeCount, MIN_TAPES, TAPE_LIMIT } = context;
  assert.equal(clampTapeCount(1), MIN_TAPES);
  assert.equal(clampTapeCount(0), MIN_TAPES);
  assert.equal(clampTapeCount(-3), MIN_TAPES);
  assert.equal(clampTapeCount('abc'), MIN_TAPES, 'a non-number is not zero tapes');
  assert.equal(clampTapeCount(TAPE_LIMIT + 500), TAPE_LIMIT);
  assert.equal(clampTapeCount(17), 17);
});

test('the wizard offers the same range the picker does', () => {
  harness.resetApp();
  const { App, newDraft, addState, addTransition, setDraftTapeCount, draftToSpec, validateSpec } = context;
  App.config.maxTapeCount = 10;
  const draft = newDraft('MTM');
  draft.sigma = ['a', 'b'];
  addState(draft, 'q1');
  draft.states[1].accept = true;
  const row = addTransition(draft);
  row.from = draft.states[0].key;
  row.to = draft.states[1].key;
  setDraftTapeCount(draft, 9);
  assert.equal(draft.tapeCount, 9, 'the wizard is not capped at four either');
  // And a nine-tape draft is still a spec the pipeline accepts.
  assert.doesNotThrow(() => validateSpec(draftToSpec(draft), { fallbackMachine: 'MTM' }));
});
