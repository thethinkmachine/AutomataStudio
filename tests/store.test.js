import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { Change, batch, emit, subscribe, _subscriberCount } from '../js/store.js';

// The change store.
//
// Importing the harness registers the app's real subscribers (renderAll, the
// panels, markDirty) and these tests deliberately leave them in place — the
// last two assert on that wiring. Each test adds its own subscribers and drops
// them again, so the counters below only ever see their own handlers.
const harness = createHarness();
const { context } = harness;

const cleanups = [];
function track(kind, fn) {
  cleanups.push(subscribe(kind, fn));
}
function fresh() {
  while (cleanups.length) cleanups.pop()();
  harness.resetApp();
}

test('a subscriber is called when its kind is emitted, and not otherwise', () => {
  fresh();
  const seen = [];
  track(Change.GRAPH, () => seen.push('graph'));
  track(Change.SAVE, () => seen.push('save'));

  emit(Change.GRAPH);
  assert.deepEqual(seen, ['graph']);

  emit(Change.SAVE);
  assert.deepEqual(seen, ['graph', 'save']);
});

test('unsubscribe stops delivery and drops the handler', () => {
  fresh();
  let n = 0;
  // Counted relative to the app's own subscribers, which stay registered.
  const before = _subscriberCount(Change.GRAPH);
  const off = subscribe(Change.GRAPH, () => n++);
  assert.equal(_subscriberCount(Change.GRAPH), before + 1);

  emit(Change.GRAPH);
  off();
  emit(Change.GRAPH);

  assert.equal(n, 1);
  assert.equal(_subscriberCount(Change.GRAPH), before);
});

test('delivery is synchronous — the DOM is up to date on the next line', () => {
  fresh();
  let done = false;
  track(Change.GRAPH, () => { done = true; });
  emit(Change.GRAPH);
  // No await, no timer. fitToScreen and autoFitLoadedMachine measure geometry
  // immediately after an edit and would read stale numbers if this deferred.
  assert.equal(done, true);
});

test('batch delivers each kind once, after the body has run', () => {
  fresh();
  const order = [];
  track(Change.GRAPH, () => order.push('render'));

  batch(() => {
    emit(Change.GRAPH);
    emit(Change.GRAPH);
    emit(Change.GRAPH);
    order.push('inside');
  });

  assert.deepEqual(order, ['inside', 'render'],
    'subscribers must run after the batch body, exactly once');
});

test('batch coalesces distinct kinds without dropping any', () => {
  fresh();
  const seen = [];
  track(Change.GRAPH, () => seen.push('graph'));
  track(Change.ALPHABET, () => seen.push('alphabet'));

  batch(() => {
    emit(Change.GRAPH);
    emit(Change.ALPHABET);
    emit(Change.GRAPH);
  });

  // Alphabet first: Change declares it first, and the hand-written call sites
  // this replaced rendered the Σ chips before the canvas.
  assert.deepEqual(seen, ['alphabet', 'graph']);
});

test('nested batches flush once, with the outermost', () => {
  fresh();
  let n = 0;
  track(Change.GRAPH, () => n++);

  batch(() => {
    emit(Change.GRAPH);
    batch(() => {
      emit(Change.GRAPH);
      assert.equal(n, 0, 'inner batch must not flush');
    });
    assert.equal(n, 0, 'still inside the outer batch');
  });

  assert.equal(n, 1);
});

test('a throwing batch body still flushes and still propagates', () => {
  fresh();
  let n = 0;
  track(Change.GRAPH, () => n++);

  assert.throws(() => batch(() => {
    emit(Change.GRAPH);
    throw new Error('boom');
  }), /boom/);

  assert.equal(n, 1, 'the pending change should not be swallowed with the error');
  // And the batch depth must have unwound, or every later emit would be stuck.
  emit(Change.GRAPH);
  assert.equal(n, 2);
});

test('one broken subscriber does not stop the others', () => {
  fresh();
  const seen = [];
  track(Change.GRAPH, () => { throw new Error('bad panel'); });
  track(Change.GRAPH, () => seen.push('canvas still painted'));

  emit(Change.GRAPH);
  assert.deepEqual(seen, ['canvas still painted']);
});

test('subscribing to an unknown kind fails loudly', () => {
  fresh();
  assert.throws(() => subscribe('not-a-kind', () => {}), /unknown change kind/);
});

// ── integration with the app's own wiring ─────────────────────────
// The assertions above are about the store in isolation; these two are about
// what render.js, history.js and ui.js subscribed to it at import time.

test('a GRAPH change dirties the active tab; a CANVAS change does not', () => {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.Workspaces.push({ id: 'w0', name: 'A', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');

  context.emit(Change.CANVAS);
  assert.equal(context.Workspaces[0].dirty, false,
    'selection and highlight repaints are not persisted, so they must not raise the unsaved-changes prompt');

  context.emit(Change.GRAPH);
  assert.equal(context.Workspaces[0].dirty, true);
});

test('commit records an undo point and announces the change', () => {
  harness.resetApp();
  const before = context.App.history.length;
  context.commit();
  assert.equal(context.App.history.length, before + 1);
});
