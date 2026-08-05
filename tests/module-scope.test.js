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

test('classifying a grammar whose LHS is not a single variable does not throw', () => {
  const h = createHarness();
  const { App } = h.context;

  // S -> a is fine; AB -> a is not context-free, and that is the branch that
  // used to assign to an undeclared isType3.
  App.grammar.vars = new Set(['S', 'A', 'B']);
  App.grammar.start = 'S';
  App.grammar.productions = [
    { lhs: 'S', rhs: 'a', rhsArr: ['a'] },
    { lhs: 'AB', rhs: 'a', rhsArr: ['a'] }
  ];

  assert.doesNotThrow(() => h.context.runChomskyClassify());
  assert.match(h.getElement('gram-output').innerHTML, /Type 0\/1/,
    'a multi-symbol LHS puts the grammar above context-free');
});

test('a regular grammar still classifies as Type 3', () => {
  const h = createHarness();
  const { App } = h.context;
  App.grammar.vars = new Set(['S']);
  App.grammar.start = 'S';
  App.grammar.productions = [{ lhs: 'S', rhs: 'aS', rhsArr: ['a', 'S'] }];

  h.context.runChomskyClassify();
  assert.match(h.getElement('gram-output').innerHTML, /Type 3/);
});

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
