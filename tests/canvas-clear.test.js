const test = require('node:test');
const assert = require('node:assert');
const { createHarness } = require('./harness');

const harness = createHarness();
const { context } = harness;

function reset() {
  harness.resetApp();
}

// performClear() wipes App.states/App.transitions, but selection and
// interaction-target fields (selectedStates, selectedTransitions, ctxId,
// transFrom, ...) used to survive it, left holding ids that no longer
// resolve to anything. A stray Ctrl+D or arrow-key nudge right after
// clearing the canvas would then act on a state that was just deleted.
test('performClear drops selections and edit targets along with the states they pointed at', () => {
  reset();
  const { App, performClear } = context;
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 50, y: 0 }];
  App.transitions = [{ id: 'e0', from: 's0', to: 's1', symbol: 'a' }];
  App.startId = 's0';
  App.accepts.add('s1');
  App.selectedStates.add('s0');
  App.selectedTransitions.add('e0');
  App.ctxId = 's0';
  App.ctxEdge = 'e0';
  App.transFrom = 's0';
  App.editId = 's1';

  performClear();

  assert.strictEqual(App.states.length, 0);
  assert.strictEqual(App.transitions.length, 0);
  assert.strictEqual(App.selectedStates.size, 0, 'selectedStates must not outlive the deleted state');
  assert.strictEqual(App.selectedTransitions.size, 0, 'selectedTransitions must not outlive the deleted transition');
  assert.strictEqual(App.ctxId, null);
  assert.strictEqual(App.ctxEdge, null);
  assert.strictEqual(App.transFrom, null);
  assert.strictEqual(App.editId, null);
});

test('performClear on an already-empty canvas is a no-op, not an error', () => {
  reset();
  const { App, performClear } = context;
  assert.doesNotThrow(() => performClear());
  assert.strictEqual(App.states.length, 0);
  assert.strictEqual(App.selectedStates.size, 0);
});
