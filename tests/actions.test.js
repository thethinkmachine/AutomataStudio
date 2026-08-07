import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Entry/exit actions, and the one rule that makes a region a SCOPE rather than a
// drawing convention: actions compose along the containment chain, bounded by
// the least common ancestor of the arrow's drawn endpoints.
//
// The assertion that carries the whole feature is "inner arrow stays in scope" —
// an arrow between two states inside a region must not fire that region's
// exit/entry actions. Get that wrong and the region is just a rectangle.
//
// No DOM here: this is all flattening, so nothing renders.

function guardAI(h) {
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['spot', 'close', 'hurt']);
  App.states = [
    { id: 'p', x: 0, y: 200, name: 'patrol', entry: 'scanArea', exit: 'stopScan' },
    { id: 'R', x: 300, y: 200, name: 'Combat', super: true, initial: 'a', entry: 'drawWeapon', exit: 'holster' },
    { id: 'a', x: 240, y: 200, name: 'approach', parent: 'R', entry: 'sprint', exit: 'brake' },
    { id: 'b', x: 360, y: 200, name: 'strike', parent: 'R', entry: 'swing' }
  ];
  App.transitions = [
    { id: 't1', from: 'p', to: 'R', symbol: 'spot' },
    { id: 't2', from: 'a', to: 'b', symbol: 'close', action: 'lunge' },
    { id: 't3', from: 'R', to: 'p', symbol: 'hurt', action: 'yell' }
  ];
  App.startId = 'p';
  App.accepts = new Set(['p']);
  h.context.ensureRootComponent();
  return App;
}

function flatten(h) {
  const { App } = h.context;
  return h.context.flattenComponent({
    states: App.states, transitions: App.transitions,
    startId: App.startId, accepts: App.accepts
  });
}

const out = (flat, from, to) => flat.transitions.find(t => t.from === from && t.to === to)?.output || '';

test('an arrow inside a region does not fire the region\'s actions', () => {
  const h = createHarness();
  guardAI(h);
  assert.equal(out(flatten(h), 'a', 'b'), 'brake lunge swing',
    'Combat is never left, so holster and drawWeapon must not appear');
});

test('an arrow out of a region fires the leaf exit then the region exit', () => {
  const h = createHarness();
  guardAI(h);
  const flat = flatten(h);
  // `strike` has no exit action of its own, so it contributes nothing and the
  // region's exit is first — that is the innermost-first rule, not a shortcut.
  assert.equal(out(flat, 'b', 'p'), 'holster yell scanArea');
  assert.equal(out(flat, 'a', 'p'), 'brake holster yell scanArea');
});

test('an arrow into a region enters outermost-first, down to the default entry', () => {
  const h = createHarness();
  guardAI(h);
  assert.equal(out(flatten(h), 'p', 'a'), 'stopScan drawWeapon sprint');
});

test('starting the machine runs the start leaf\'s entry chain', () => {
  const h = createHarness();
  const App = guardAI(h);
  assert.equal(flatten(h).startOutput, 'scanArea');

  // Starting inside the region has to run the region's entry action too —
  // there is no transition to hang it on, which is why it is reported apart.
  App.startId = 'R';
  assert.equal(flatten(h).startOutput, 'drawWeapon sprint');
});

test('the running trace accumulates the actions in order', () => {
  const h = createHarness();
  const App = guardAI(h);
  const res = h.context.simRSM(['spot', 'close', 'hurt']);
  assert.equal(res.accepted, true);
  assert.equal(App.simSteps[App.simSteps.length - 1].outSoFar,
    'scanArea stopScan drawWeapon sprint brake lunge swing holster yell scanArea');
  assert.equal(App.simSteps.length, 4, 'one step per configuration, actions ride along');
});

test('actions change nothing about which words are accepted', () => {
  const h = createHarness();
  const words = [[], ['spot'], ['spot', 'hurt'], ['spot', 'close', 'hurt'], ['hurt']];
  const App = guardAI(h);
  const withActions = words.map(w => h.context.simRSM(w).accepted);

  guardAI(h);
  for (const s of App.states) { delete s.entry; delete s.exit; }
  for (const t of App.transitions) delete t.action;
  const without = words.map(w => h.context.simRSM(w).accepted);

  assert.deepEqual(withActions, without,
    'output is a side effect — Σ is still the only thing read, so the language is the same');
});

test('a machine with no actions is left exactly as it was', () => {
  const h = createHarness();
  const App = guardAI(h);
  for (const s of App.states) { delete s.entry; delete s.exit; }
  for (const t of App.transitions) delete t.action;
  const flat = flatten(h);
  assert.ok(flat.transitions.every(t => t.output === undefined),
    'no empty-string outputs on machines that never asked for actions');
  assert.equal(flat.startOutput, '');
});

test('actions compose through two levels of nesting', () => {
  const h = createHarness();
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x']);
  App.states = [
    { id: 'A', x: 0, y: 0, name: 'A', super: true, initial: 'B', entry: 'inA', exit: 'outA' },
    { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A', initial: 'p', entry: 'inB', exit: 'outB' },
    { id: 'p', x: 0, y: 0, name: 'p', parent: 'B', exit: 'outP' },
    { id: 'z', x: 0, y: 0, name: 'z', entry: 'inZ' }
  ];
  App.transitions = [{ id: 't1', from: 'A', to: 'z', symbol: 'x' }];
  App.startId = 'p';
  App.accepts = new Set(['z']);
  h.context.ensureRootComponent();
  assert.equal(out(flatten(h), 'p', 'z'), 'outP outB outA inZ',
    'innermost-first, all the way out');
});

test('the transition label reads event / action', () => {
  const h = createHarness();
  const App = guardAI(h);
  assert.equal(h.context.transLabel(App.transitions[1]), 'close / lunge');
  assert.equal(h.context.transLabel(App.transitions[0]), 'spot', 'no action, no slash');
});
