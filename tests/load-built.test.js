import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, resetApp } from './harness.js';

// ══════════════════════════════════════════════════════════════════
//  LOADING A BUILT RESULT (#152)
// ══════════════════════════════════════════════════════════════════
//  A machine an algorithm built is a new machine. loadBuiltMachine used to
//  replace the states, transitions, start and F and nothing else, so the rest
//  of the machine that had been there stayed and described one that was gone:
//  Σ (the Run box refused M₂'s words on a union that accepts them), notes
//  anchored to ids the result does not have, dividers drawn for the old
//  diagram, and the card. Most of the Algorithms view's loaders did not go
//  through it at all and wrote App by hand, with the same gaps.

const { context, getElement } = createHarness();

const CARD = { title: 'Keyword search', blurb: 'Finds the keyword a.' };

// M₁: an NFA over {a} accepting `a`, with a note anchored to its start state,
// a divider, and a card — everything that is not the machine.
function drawM1() {
  resetApp();
  const { App } = context;
  App.machine = 'NFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's1', name: 'q0', x: 100, y: 100 }, { id: 's2', name: 'q1', x: 260, y: 100 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  App.accepts = new Set(['s2']);
  App.stateN = 2; App.transN = 1;
  App.notes = [{ id: 'n1', x: 0, y: -60, text: 'the start', anchorStates: ['s1'], anchorTransitions: [] }];
  App.noteN = 1;
  App.dividers = [{ id: 'd1', kind: 'line', x1: 0, y1: 200, x2: 400, y2: 200 }];
  App.dividerN = 1;
  context.showExampleCard(CARD);
  return App;
}

// M₂: an NFA over {b} accepting `b`.
const M2 = {
  machine: 'NFA', sigma: ['b'],
  states: [{ id: 's1', name: 'p0', x: 0, y: 0 }, { id: 's2', name: 'p1', x: 120, y: 0 }],
  transitions: [{ id: 't1', from: 's1', to: 's2', symbol: 'b' }],
  startId: 's1', accepts: ['s2']
};

function runWord(word) {
  getElement('sim-in').value = word;
  context.runSim();
  context.stopAutoPlay();
  context.stepToEnd();
  return context.App.simSteps;
}

// What the canvas holds besides the machine, for comparing before and after.
function surroundings(App) {
  return JSON.stringify({
    sigma: [...App.sigma], notes: App.notes, dividers: App.dividers, meta: App.meta,
    states: App.states.map(s => s.id), machine: App.machine
  });
}

function assertNothingStale(App) {
  const ids = new Set(App.states.map(s => s.id));
  const tids = new Set(App.transitions.map(t => t.id));
  for (const n of App.notes) {
    for (const id of n.anchorStates || []) assert.ok(ids.has(id), `note ${n.id} anchored to missing state ${id}`);
    for (const id of n.anchorTransitions || []) assert.ok(tids.has(id), `note ${n.id} anchored to missing transition ${id}`);
  }
}

// ── the closures: union, through the Algorithms view's button ─────

test('a union over {a} and {b} has Σ = {a, b}, and the Run box takes b', () => {
  const App = drawM1();
  App._lastBuiltNFA = { key: 'union', machine: context.buildNFAUnion(context.getCurrentMachineSnapshot(), M2) };
  context.loadBuiltNFAResult('union');

  assert.deepEqual([...App.sigma].sort(), ['a', 'b']);
  assert.ok(context.tokenize('b', App.sigma), 'b is a word over Σ');
  assert.equal(context.decideMachine(App.machine, ['b']).verdict, 'acc');
  assert.ok(runWord('b').length > 0, 'the Run box ran b rather than refusing it');
});

test('a union carries no note or divider of the machine it replaced', () => {
  const App = drawM1();
  App._lastBuiltNFA = { key: 'union', machine: context.buildNFAUnion(context.getCurrentMachineSnapshot(), M2) };
  context.loadBuiltNFAResult('union');

  assert.deepEqual(App.notes, []);
  assert.deepEqual(App.dividers, []);
  assertNothingStale(App);
});

test('the card says what was built, not what was there', () => {
  const App = drawM1();
  App._lastBuiltNFA = { key: 'union', machine: context.buildNFAUnion(context.getCurrentMachineSnapshot(), M2) };
  context.loadBuiltNFAResult('union');

  assert.notEqual(App.meta?.title, CARD.title);
  assert.equal(App.meta?.title, 'Union of M₁ and M₂');
});

test('one Ctrl+Z brings back the machine, its alphabet, notes, dividers and card', () => {
  const App = drawM1();
  const before = surroundings(App);
  App._lastBuiltNFA = { key: 'union', machine: context.buildNFAUnion(context.getCurrentMachineSnapshot(), M2) };
  context.loadBuiltNFAResult('union');
  assert.notEqual(surroundings(App), before, 'the fixture has to change, or this proves nothing');

  context.undo();
  assert.equal(surroundings(App), before);
});

test('concatenation takes both alphabets too', () => {
  const App = drawM1();
  App._lastBuiltNFA = { key: 'concat', machine: context.buildNFAConcat(context.getCurrentMachineSnapshot(), M2) };
  context.loadBuiltNFAResult('concat');
  assert.deepEqual([...App.sigma].sort(), ['a', 'b']);
  assert.equal(context.decideMachine(App.machine, ['a', 'b']).verdict, 'acc');
});

// ── a builder that gives no Σ ─────────────────────────────────────

test('a machine that does not say its Σ gets what its edges read, less ε and the wildcard', () => {
  const App = drawM1();
  context.loadBuiltMachine({
    states: [{ id: 'k1', name: 'r0', x: 0, y: 0 }, { id: 'k2', name: 'r1', x: 100, y: 0 }],
    transitions: [
      { id: 'e1', from: 'k1', to: 'k2', symbol: 'x' },
      { id: 'e2', from: 'k2', to: 'k1', symbol: App.config.sym.eps },
      { id: 'e3', from: 'k2', to: 'k2', symbol: 'y' }
    ],
    startId: 'k1', accepts: ['k2']
  }, 'ε-NFA');
  assert.deepEqual([...App.sigma].sort(), ['x', 'y']);
  assert.equal(App.meta, null, 'no card given, so none is left standing');
});

// ── the subset construction and minimisation ──────────────────────

test('the subset construction keeps the NFA’s Σ and nothing else of the canvas', () => {
  const App = drawM1();
  App.sigma = new Set(['a', 'c']);           // c has no edge; the DFA is still over it
  App._lastSubset = context.subsetConstruction();
  context.loadSubsetAsDFA();

  assert.equal(App.machine, 'DFA');
  assert.deepEqual([...App.sigma].sort(), ['a', 'c']);
  assert.deepEqual(App.notes, []);
  assert.deepEqual(App.dividers, []);
  assert.equal(App.meta?.title, 'Subset construction');
  assertNothingStale(App);

  context.undo();
  assert.equal(App.machine, 'NFA');
  assert.equal(App.notes.length, 1);
  assert.equal(App.meta?.title, CARD.title);
});

test('minimisation drops the notes, which named states that were merged away', () => {
  const App = drawM1();
  App.machine = 'DFA';
  App._lastMin = context.tableFillingMinimize();
  context.loadMinimizedDFA();

  assert.deepEqual([...App.sigma], ['a']);
  assert.deepEqual(App.notes, []);
  assert.deepEqual(App.dividers, []);
  assert.equal(App.meta?.title, 'Minimised DFA');
});

// ── Thompson ──────────────────────────────────────────────────────

test('Thompson’s NFA is over the expression’s symbols, not the old Σ plus them', () => {
  const App = drawM1();
  App._lastThompson = { ...context.thompsonBuild('b|c'), re: 'b|c' };
  context.loadThompsonNFA();

  assert.deepEqual([...App.sigma].sort(), ['b', 'c']);
  assert.deepEqual(App.notes, []);
  assert.match(App.meta?.blurb || '', /b\|c/);
});

// ── the transducers ───────────────────────────────────────────────

test('Mealy → Moore is a new machine and leaves nothing of the old one', () => {
  resetApp();
  const { App } = context;
  App.machine = 'Mealy';
  App.sigma = new Set(['a']);
  App.outputAlpha = new Set(['0', '1']);
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's1', symbol: 'a', output: '1' }];
  App.startId = 's1'; App.stateN = 1; App.transN = 1;
  App.notes = [{ id: 'n1', x: 0, y: -60, text: 'loop', anchorStates: [], anchorTransitions: ['t1'] }];
  context.showExampleCard(CARD);
  App._lastMealy2Moore = context.computeMealy2Moore();
  context.loadMealyAsMoore();

  assert.equal(App.machine, 'Moore');
  assert.deepEqual([...App.sigma], ['a']);
  assert.deepEqual([...App.outputAlpha].sort(), ['0', '1']);
  assert.deepEqual(App.notes, []);
  assert.equal(App.meta?.title, 'Moore machine from a Mealy machine');
});

// ── a transformation that keeps the states ────────────────────────

test('the complement keeps the notes, whose states it keeps, and replaces the card', () => {
  const App = drawM1();
  App.machine = 'DFA';
  context.loadComplement();

  assert.equal(App.notes.length, 1, 'the note still describes the state it is anchored to');
  assertNothingStale(App);
  assert.equal(App.meta?.title, 'Complement');

  context.undo();
  assert.equal(App.meta?.title, CARD.title);
});

// ── M₂ restored ───────────────────────────────────────────────────

test('restoring M₂ brings back its alphabets and no block it no longer has', () => {
  resetApp();
  const { App } = context;
  App.machine = 'DPDA';
  App.sigma = new Set(['x']);
  App.stackAlpha = new Set(['Z', 'X']);
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0, blockId: 'b1' }];
  App.transitions = [];
  App.startId = 's1';
  context.saveWorkspaceB();
  const saved = App.workspaceB;

  drawM1();
  App.workspaceB = saved;      // drawM1 resets the app, M₂ with it
  context.loadWorkspaceB();
  assert.equal(App.machine, 'DPDA');
  assert.deepEqual([...App.sigma], ['x']);
  assert.deepEqual([...App.stackAlpha].sort(), ['X', 'Z']);
  assert.ok(App.states.every(s => s.blockId === undefined));
  assert.deepEqual(App.notes, []);
  assert.equal(App.meta, null);
});
