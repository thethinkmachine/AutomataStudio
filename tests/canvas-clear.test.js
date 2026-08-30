import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

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

// ── Clear is a workspace reset, not just an empty canvas ──────────
//
// The button used to call performClear(), which empties the graph and
// nothing else — so a cleared workspace kept the previous machine's Σ and
// Γ, the old grammar in the Grammar view, the description card, and the
// camera parked over where the deleted diagram had been. That is a blank
// screen; the tab beside it reading "Workspace 2" is a blank workspace, and
// the two being different is the bug. Both now start from one
// blankWorkspaceData().

/** Everything a reader would say makes this workspace theirs. */
function shape() {
  const { App } = context;
  return {
    machine: App.machine,
    sigma: [...App.sigma], gamma: [...App.stackAlpha], out: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    states: App.states.length, transitions: App.transitions.length,
    notes: (App.notes || []).length, dividers: (App.dividers || []).length,
    meta: App.meta ? 'set' : null,
    cam: JSON.stringify(App.cam),
    productions: (App.grammar?.productions || []).length
  };
}

test('Clear returns the workspace to exactly what a new tab is', () => {
  reset();
  const { App, loadData, clearAll, createTab } = context;

  createTab();
  const fresh = shape();

  loadData({
    machine: 'MTM', sigma: ['x', 'y', 'z'], stackAlpha: ['x', 'y', '⊔'], tapeCount: 3,
    states: [{ id: 's1', x: 5, y: 5, name: 'q0' }], startId: 's1', accepts: [],
    transitions: [{ id: 't1', from: 's1', to: 's1', symbol: 'x', tapeSyms: ['x', 'x', 'x'], tapeWrites: ['x', 'x', 'x'], tapeDirs: ['R', 'R', 'R'] }],
    notes: [{ id: 'n1', x: 0, y: 0, text: 'hi', anchorStates: [], anchorTransitions: [] }],
    cam: { x: -900, y: 300, z: 2.5 }
  });
  App.grammar.productions.push({ lhs: 'S', rhs: 'aSb' });
  assert.notDeepStrictEqual(shape(), fresh, 'the fixture has to differ, or this proves nothing');

  clearAll(true);
  assert.deepStrictEqual(shape(), fresh);
});

test('one Ctrl+Z brings the whole cleared workspace back', () => {
  reset();
  const { App, loadData, clearAll, undo } = context;
  loadData({
    machine: 'DPDA', sigma: ['x'], stackAlpha: ['Z', 'x'],
    states: [{ id: 's1', x: 5, y: 5, name: 'q0' }], startId: 's1', accepts: [], transitions: []
  });
  const before = shape();

  clearAll(true);
  undo();

  // The undo point is taken before the reset and has to survive it: the blank
  // workspace carries an empty history like any other loaded blob, so the
  // import would otherwise throw away the very entry that undoes it.
  assert.deepStrictEqual(shape(), before);
});

test('switching machine type clears the diagram and keeps the alphabet', () => {
  reset();
  const { App, setMachine } = context;
  setMachine('DFA');
  App.sigma = new Set(['p', 'q', 'r']);
  App.states.push({ id: 's1', x: 0, y: 0, name: 'q0' });

  setMachine('DPDA');
  context.$('confirm-action-btn').onclick();   // the reader accepts

  assert.equal(App.machine, 'DPDA');
  assert.equal(App.states.length, 0, 'the diagram cannot survive the switch');
  assert.deepStrictEqual([...App.sigma], ['p', 'q', 'r'],
    'but retyping Σ because you moved from a DFA to a PDA over it would be busywork');
});
