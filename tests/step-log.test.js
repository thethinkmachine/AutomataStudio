// What a step remembers, for the machines that are not tape machines.
//
// tests/tape-log.test.js pins the equivalent for the tape machines, and the
// guard that matters most there matters most here too: `remaining` and
// `outToks` must NOT be own properties of a step. They were, as fresh copies
// of a growing or shrinking array, which made a run quadratic in the word —
// a 16,000-symbol word retained 1,036 MB and a 100,000-symbol one exhausted
// a 4 GB heap. If either comes back as an own property, that is back.
//
// The other half is that nothing about what a step *says* changed. Every
// value assertion below is what the array-copying version produced, so this
// file fails if the index arithmetic is off by one in either direction.

import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';
import { OUT_EMPTY, outArray, outLength, outPush, outStep, wordOutStep, wordStep } from '../js/machines/step-log.js';

const h = createHarness();
const C = h.context;
const App = C.App;

function dfa(states = 2) {
  App.machine = 'DFA';
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < states; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i * 100, y: 0 });
  App.startId = 's0';
  App.accepts.add('s0');
  App.sigma = new Set(['a', 'b']);
  for (let i = 0; i < states; i++) {
    App.transitions.push({ id: 't' + i + 'a', from: 's' + i, to: 's' + ((i + 1) % states), symbol: 'a' });
    App.transitions.push({ id: 't' + i + 'b', from: 's' + i, to: 's' + i, symbol: 'b' });
  }
  C.invalidateStateIndex();
}

function moore() {
  App.machine = 'Moore';
  App.states = [
    { id: 's0', name: 'q0', x: 0, y: 0, output: '0' },
    { id: 's1', name: 'q1', x: 100, y: 0, output: '1' }
  ];
  App.startId = 's0';
  App.accepts = new Set();
  App.sigma = new Set(['a']);
  App.outputAlpha = new Set(['0', '1']);
  App.transitions = [
    { id: 't0', from: 's0', to: 's1', symbol: 'a' },
    { id: 't1', from: 's1', to: 's0', symbol: 'a' }
  ];
  C.invalidateStateIndex();
}

// ══════════════════════════════════════════════════════════════════
//  the shared shapes
// ══════════════════════════════════════════════════════════════════

test('a word step reports its suffix without owning one', () => {
  const tokens = ['a', 'b', 'c', 'd'];
  const step = wordStep({ state: 's0', tokens, pos: 2, note: 'x' });

  assert.deepEqual(step.remaining, ['c', 'd']);
  assert.equal(
    Object.prototype.hasOwnProperty.call(step, 'remaining'), false,
    'remaining must be a getter, not a stored copy'
  );
  assert.deepEqual(
    Object.keys(step).sort(), ['note', 'pos', 'state', 'tokens'],
    'a step owns only what cannot be derived'
  );
});

test('the suffix is exactly tokens.slice(pos), at both ends', () => {
  const tokens = ['a', 'b', 'c'];
  assert.deepEqual(wordStep({ tokens, pos: 0 }).remaining, ['a', 'b', 'c']);
  assert.deepEqual(wordStep({ tokens, pos: 3 }).remaining, []);
});

test('an output step reports its prefix without owning one', () => {
  let node = OUT_EMPTY;
  for (const piece of ['0', '1', '1']) node = outPush(node, piece);
  const step = outStep({ state: 's0', outNode: node, outSoFar: '011' });

  assert.deepEqual(step.outToks, ['0', '1', '1']);
  assert.equal(Object.prototype.hasOwnProperty.call(step, 'outToks'), false);
  assert.equal(step.outSoFar, '011', 'the raw output stays an own property');
});

test('the output list is a cons list, so branches share their prefix', () => {
  const shared = outPush(outPush(OUT_EMPTY, 'x'), 'y');
  const left = outPush(shared, 'L');
  const right = outPush(shared, 'R');

  assert.deepEqual(outArray(left), ['x', 'y', 'L']);
  assert.deepEqual(outArray(right), ['x', 'y', 'R']);
  assert.equal(left.prev, right.prev, 'the common prefix is one object, not two copies');
  assert.equal(outLength(left), 3);
  assert.equal(outLength(OUT_EMPTY), 0);
});

test('the three shapes give a machine only the fields it has', () => {
  const tokens = ['a'];
  const word = wordStep({ tokens, pos: 0 });
  const out = outStep({ outNode: OUT_EMPTY });
  const both = wordOutStep({ tokens, pos: 0, outNode: OUT_EMPTY });

  // simulation.js decides whether to draw the Output row on `!== undefined`,
  // and falls back to the cursor for tokIdx when there is no `remaining`.
  // A single prototype would have answered for every machine.
  assert.equal(word.outToks, undefined, 'a DFA step must not claim an output');
  assert.equal(out.remaining, undefined, 'a Moore step must not claim a suffix');
  assert.deepEqual(both.remaining, ['a']);
  assert.deepEqual(both.outToks, []);
});

// ══════════════════════════════════════════════════════════════════
//  the simulators still say what they said
// ══════════════════════════════════════════════════════════════════

test('a DFA run reports the suffix left at every step', () => {
  h.resetApp();
  dfa();
  const tokens = ['a', 'b', 'a'];
  C.runQuietly(() => C.simDFA(tokens));

  const steps = App.simSteps;
  assert.equal(steps.length, 4, 'one step per symbol, plus the start');
  assert.deepEqual(steps.map(s => s.remaining), [
    ['a', 'b', 'a'],
    ['b', 'a'],
    ['a'],
    []
  ]);
  assert.deepEqual(steps.map(s => s.pos), [0, 1, 2, 3]);
  for (const s of steps) {
    assert.equal(Object.prototype.hasOwnProperty.call(s, 'remaining'), false);
    assert.equal(s.tokens, tokens, 'every step shares the one token array');
  }
});

test('a rejected DFA run stops with the unread symbol still in the suffix', () => {
  h.resetApp();
  App.machine = 'DFA';
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
  App.startId = 's0';
  App.accepts = new Set(['s0']);
  App.sigma = new Set(['a', 'b']);
  App.transitions = [{ id: 't0', from: 's0', to: 's0', symbol: 'a' }];
  C.invalidateStateIndex();

  C.runQuietly(() => C.simDFA(['a', 'b', 'a']));
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'reject');
  assert.deepEqual(last.remaining, ['b', 'a'], 'the symbol with no δ is still unread');
});

test('an NFA run reports the same suffixes', () => {
  h.resetApp();
  dfa();
  App.machine = 'NFA';
  C.runQuietly(() => C.simNFA(['a', 'a']));
  assert.deepEqual(App.simSteps.map(s => s.remaining), [['a', 'a'], ['a'], []]);
});

test('a Moore run reports the output emitted so far', () => {
  h.resetApp();
  moore();
  C.runQuietly(() => C.simMoore(['a', 'a']));

  const steps = App.simSteps;
  assert.deepEqual(steps.map(s => s.outToks), [['0'], ['0', '1'], ['0', '1', '0']]);
  assert.deepEqual(steps.map(s => s.outSoFar), ['0', '01', '010']);
  for (const s of steps) assert.equal(Object.prototype.hasOwnProperty.call(s, 'outToks'), false);
});

test('a PDA run carries its position, its stack and no copies of either', () => {
  h.resetApp();
  App.machine = 'NPDA';
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 100, y: 0 }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['Z', 'A']);
  App.transitions = [
    { id: 'p0', from: 's0', to: 's0', symbol: 'a', pop: 'Z', push: 'AZ' },
    { id: 'p1', from: 's0', to: 's0', symbol: 'a', pop: 'A', push: 'AA' },
    { id: 'p2', from: 's0', to: 's1', symbol: 'b', pop: 'A', push: 'ε' },
    { id: 'p3', from: 's1', to: 's1', symbol: 'b', pop: 'A', push: 'ε' }
  ];
  C.invalidateStateIndex();

  C.runQuietly(() => C.simNPDA(['a', 'a', 'b', 'b']));
  const steps = App.simSteps;
  assert.equal(steps[steps.length - 1].final, 'accept', 'aabb is in aⁿbⁿ');
  assert.deepEqual(steps[0].remaining, ['a', 'a', 'b', 'b']);
  assert.deepEqual(steps[steps.length - 1].remaining, []);
  for (const s of steps) assert.equal(Object.prototype.hasOwnProperty.call(s, 'remaining'), false);
});

// ══════════════════════════════════════════════════════════════════
//  the property the whole thing exists for
// ══════════════════════════════════════════════════════════════════

test('a run is linear in the word, not quadratic', () => {
  h.resetApp();
  dfa();

  // Total cells reachable through `remaining` is inherently n²/2 — that is
  // what the field *means*. What must not happen is storing them. So this
  // counts what the steps actually hold: one shared token array, and one
  // integer per step.
  const seen = new Set();
  const measure = n => {
    C.runQuietly(() => C.simDFA(Array(n).fill('b')));
    App.simSteps.forEach(s => seen.add(s.tokens));
    return App.simSteps.length;
  };

  const small = measure(200);
  const large = measure(2000);
  assert.equal(small, 201);
  assert.equal(large, 2001);
  assert.equal(seen.size, 2, 'one token array per run, however long the run is');
});

test('every simulator that reads a word carries a position for it', () => {
  // The tracker computes which symbol was just read as `step.pos - 1`. A
  // simulator that yields a step without `pos` falls back to the playback
  // cursor, which is right only while the two agree — so this is what stops a
  // new machine from silently drawing its head in the wrong cell.
  const cases = [
    ['DFA', () => { dfa(); }, () => C.simDFA(['a', 'b'])],
    ['NFA', () => { dfa(); App.machine = 'NFA'; }, () => C.simNFA(['a', 'b'])]
  ];
  for (const [label, setup, run] of cases) {
    h.resetApp();
    setup();
    C.runQuietly(run);
    for (const [i, s] of App.simSteps.entries()) {
      assert.equal(typeof s.pos, 'number', `${label} step ${i} must carry a position`);
      assert.equal(s.pos, i, `${label} step ${i} reads the ${i}th symbol`);
    }
  }
});
