import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// History states: re-enter a region and resume rather than restart.
//
// The claim under test is that this is MEMORY WITHOUT POWER. Flattening proves
// it constructively — the machine is still finite, it just costs one copy of
// everything outside the region per thing the region might remember. The test
// that carries that is "the memory splits the states outside the region": if
// that count were unbounded, the language would not be regular.

function combat(h, mode) {
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['spot', 'close', 'hurt']);
  App.states = [
    { id: 'p', x: 0, y: 0, name: 'patrol' },
    { id: 'R', x: 300, y: 0, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 240, y: 0, name: 'approach', parent: 'R' },
    { id: 'b', x: 360, y: 0, name: 'strike', parent: 'R' }
  ];
  App.transitions = [
    { id: 't1', from: 'p', to: 'R', symbol: 'spot', ...(mode ? { entryMode: mode } : {}) },
    { id: 't2', from: 'a', to: 'b', symbol: 'close' },
    { id: 't3', from: 'R', to: 'p', symbol: 'hurt' }
  ];
  App.startId = 'p';
  App.accepts = new Set(['b']);
  h.context.ensureRootComponent();
  return App;
}

const flat = h => h.context.flattenComponent({
  states: h.context.App.states, transitions: h.context.App.transitions,
  startId: h.context.App.startId, accepts: h.context.App.accepts
});
const run = (h, w) => h.context.simRSM(w).accepted;

test('without history, re-entering a region restarts at its default entry', () => {
  const h = createHarness();
  combat(h, null);
  assert.equal(run(h, ['spot', 'close']), true);
  assert.equal(run(h, ['spot', 'close', 'hurt', 'spot']), false,
    'back to approach, so `strike` is not where the run ends');
  assert.equal(flat(h).states.length, 3, 'no memory, no product — one flat state per leaf');
});

test('shallow history resumes the child the region was left in', () => {
  const h = createHarness();
  combat(h, 'history');
  assert.equal(run(h, ['spot', 'close', 'hurt', 'spot']), true, 'resumes strike');
  assert.equal(run(h, ['spot', 'hurt', 'spot']), false, 'left from approach, so resumes approach');
});

test('the memory splits the states outside the region — that is the price', () => {
  const h = createHarness();
  combat(h, 'history');
  const f = flat(h);
  // patrol becomes three: never-been, left-from-approach, left-from-strike.
  const copies = f.states.filter(s => s.origin === 'p');
  assert.equal(copies.length, 3);
  assert.equal(f.states.length, 5);
  // Finite is the whole point. If this number could grow with the input, the
  // language would not be regular.
  assert.ok(f.states.every(s => ['p', 'a', 'b'].includes(s.origin)));
});

test('a flat state carries `origin` back to the node the user drew', () => {
  const h = createHarness();
  const App = combat(h, 'history');
  run(h, ['spot', 'close', 'hurt', 'spot']);
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.state, 'b',
    'the simulator must name a drawn id or the canvas lights up nothing');
  assert.ok(App.states.some(s => s.id === last.state));
});

test('deep history resumes the exact leaf; shallow only the outer child', () => {
  const h = createHarness();
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['in', 'down', 'out']);
  App.states = [
    { id: 'o', x: 0, y: 0, name: 'outside' },
    { id: 'A', x: 0, y: 0, name: 'A', super: true, initial: 'B' },
    { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A', initial: 'p' },
    { id: 'p', x: 0, y: 0, name: 'p', parent: 'B' },
    { id: 'q', x: 0, y: 0, name: 'q', parent: 'B' }
  ];
  App.transitions = [
    { id: 't1', from: 'o', to: 'A', symbol: 'in', entryMode: 'deep' },
    { id: 't2', from: 'p', to: 'q', symbol: 'down' },
    { id: 't3', from: 'A', to: 'o', symbol: 'out' }
  ];
  App.startId = 'o';
  App.accepts = new Set(['q']);
  h.context.ensureRootComponent();

  assert.equal(run(h, ['in', 'down', 'out', 'in']), true, 'deep resumes q');
  App.transitions[0].entryMode = 'history';
  assert.equal(run(h, ['in', 'down', 'out', 'in']), false,
    'shallow resumes B, then takes B\'s default entry down to p');
});

test('history on a region never entered falls back to the default entry', () => {
  const h = createHarness();
  const App = combat(h, 'history');
  App.startId = 'p';
  assert.equal(run(h, ['spot', 'close']), true,
    'first visit has nothing to remember, so it behaves like a default entry');
});

test('the label marks which arrows carry history', () => {
  const h = createHarness();
  const App = combat(h, 'history');
  assert.equal(h.context.transLabel(App.transitions[0]), 'spot ▸Ⓗ');
  App.transitions[0].entryMode = 'deep';
  assert.equal(h.context.transLabel(App.transitions[0]), 'spot ▸Ⓗ*');
  assert.equal(h.context.transLabel(App.transitions[1]), 'close', 'plain arrows unchanged');
});

test('the product is bounded by a budget rather than exploring forever', () => {
  const h = createHarness();
  const App = combat(h, 'history');
  App.config.maxFlatStates = 2;
  const f = flat(h);
  assert.ok(f.truncated, 'says so rather than quietly returning a wrong machine');
  assert.ok(f.states.length <= 2);
});
