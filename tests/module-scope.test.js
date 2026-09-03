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

test('double-clicking a state toggles whether it accepts', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();

  const id = App.states[0].id;
  const node = App.domCache.states.get(id);
  assert.ok(node, 'the state should have a rendered node');

  // The handler calls commit(), which render.js reaches through an import.
  // Without it this throws ReferenceError and the accept mark never changes.
  assert.doesNotThrow(() => node._listeners.dblclick({}));
  assert.equal(App.accepts.has(id), true, 'first double-click marks it accepting');
  assert.equal(node.classList.contains('acc-st'), true, 'and the ring is painted');

  node._listeners.dblclick({});
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

  App.domCache.states.get(id)._listeners.dblclick({});
  assert.equal(App.history.length, depth + 1, 'commit() takes a snapshot, not just a repaint');

  h.context.undo();
  assert.equal(App.accepts.has(id), false, 'undo puts the accept mark back');
});
