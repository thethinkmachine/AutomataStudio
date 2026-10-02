import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Regressions from the classic-script -> ES module conversion.
//
// Both bugs here share a cause: modules are always strict, and the old
// <script> files were not. Two things that used to be silently tolerated now
// throw, and neither is reachable from a build or a boot -- only from the
// interaction that runs the line.
//
//   - assigning to an undeclared name used to create a global; it is now a
//     ReferenceError
//   - calling a function from another file used to resolve through the shared
//     global scope; it now needs an import, and a missing one is a
//     ReferenceError at call time
//
// A build passes either way, which is why these are tests rather than lint.

// The two grammar-classification cases that used to sit here moved to
// tests/grammar-analysis.test.js when the classifier did. They were about the
// same undeclared-global regression this file catalogues, but the classifier
// is now a pure function over a grammar model rather than a renderer, so the
// assertion is on the value it returns rather than on the markup it printed.

// A double-click on a state is two presses, because a browser never delivers
// the native `dblclick` there: the first press captures the pointer on the
// canvas, which retargets the second click and the `dblclick` to it. These
// tests used to call a `dblclick` listener directly, which the stub allows and
// a browser does not — so they passed while the gesture did nothing.
const press = (node, extra = {}) => node._listeners.pointerdown({
  button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
  preventDefault() {}, stopPropagation() {}, ...extra
});
const doubleClick = (node, extra) => { press(node, extra); press(node, extra); };

test('double-clicking a state toggles whether it accepts', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();

  const id = App.states[0].id;
  const node = App.domCache.states.get(id);
  assert.ok(node, 'the state should have a rendered node');
  assert.equal(node._listeners.dblclick, undefined, 'nothing listens for the dblclick a browser never sends');

  // The handler calls commit(), which render.js reaches through an import.
  // Without it this throws ReferenceError and the accept mark never changes.
  assert.doesNotThrow(() => doubleClick(node));
  assert.equal(App.accepts.has(id), true, 'first double-click marks it accepting');
  assert.equal(node.classList.contains('acc-st'), true, 'and the ring is painted');

  doubleClick(node);
  assert.equal(App.accepts.has(id), false, 'second double-click clears it');
  assert.equal(node.classList.contains('acc-st'), false);
});

test('double-clicking a state records an undo point', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();
  const id = App.states[0].id;
  const depth = App.history.length;

  doubleClick(App.domCache.states.get(id));
  assert.equal(App.history.length, depth + 1, 'commit() takes a snapshot, not just a repaint');

  h.context.undo();
  assert.equal(App.accepts.has(id), false, 'undo puts the accept mark back');
});

test('a double-click toggles accepting only as a plain Select-tool gesture', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();
  const id = App.states[0].id;
  const node = App.domCache.states.get(id);

  doubleClick(node, { shiftKey: true });
  assert.equal(App.accepts.has(id), false, 'a modified double-click is multi-select, not a toggle');
  doubleClick(node, { pointerType: 'touch' });
  assert.equal(App.accepts.has(id), false, 'a double tap is not a toggle');
  App.tool = 'trans';
  doubleClick(node);
  assert.equal(App.accepts.has(id), false, 'with the Transition tool two presses are a self-loop');
  App.tool = 'pointer';
  press(node);
  h.context.renderAll();
  press(node);
  assert.equal(App.accepts.has(id), true, 'and with the Select tool they toggle');
});
