import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, resetApp } from './harness.js';

// The component tree — the data model under hierarchical machines.
//
// App.states/transitions/startId/accepts stay the LIVE working copy of whichever
// component is on the canvas, and App.components[active] is a cache that is only
// valid after flushActiveComponent(). Readers flush, writers don't.
//
// The failure mode worth guarding is a reader that forgets to flush: it
// serializes the component as it was before the last wholesale
// `App.states = ...` reassignment, and nothing throws -- the edit is just
// quietly missing from the saved file or the undo entry.
//
// Undo across a descend boundary gets its own cases below because it is the
// scenario where "which component do these states belong to" is genuinely
// ambiguous. What they pin is behavioural, not structural: no sub-machine
// contents are lost, and the canvas lands in the component the undone edit
// was actually made in.

function comp(h, name) {
  const { App, newComponentId } = h.context;
  const c = { id: newComponentId(), name, states: [], transitions: [], startId: null, accepts: [], exitIds: [], cam: { x: 0, y: 0, z: 1 } };
  App.components.push(c);
  return c;
}

test('a flat machine is a tree of exactly one component', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.flushActiveComponent();

  assert.equal(App.components.length, 1);
  assert.equal(App.rootComponentId, App.components[0].id);
  assert.deepEqual(App.componentPath, [App.components[0].id]);
  assert.equal(App.components[0].states.length, 1,
    'the root component is the machine, not a copy of an empty one');
});

test('flushing repairs the binding a wholesale reassignment broke', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'q0');
  h.context.createState(80, 0, 'q1');
  h.context.flushActiveComponent();
  const root = h.context.activeComponent();
  assert.equal(root.states.length, 2);

  // deleteState rebinds App.states to a new array; the component still points
  // at the old one until something flushes.
  h.context.deleteState(App.states[0].id);
  assert.equal(App.states.length, 1);
  h.context.flushActiveComponent();
  assert.equal(h.context.activeComponent().states.length, 1,
    'the component must follow App.states across a reassignment');
});

test('descending swaps the live arrays and leaves the parent intact', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'main0');
  h.context.flushActiveComponent();
  const rootId = App.rootComponentId;

  const sub = comp(h, 'Sub');
  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);

  assert.deepEqual(App.states, [], 'the new component starts empty');
  h.context.createState(10, 10, 'sub0');
  h.context.flushActiveComponent();

  assert.equal(h.context.getComponent(rootId).states.length, 1, 'the parent kept its state');
  assert.equal(h.context.getComponent(sub.id).states.length, 1, 'the child got the new one');
  assert.equal(h.context.getComponent(rootId).states[0].name, 'main0');
  assert.equal(h.context.getComponent(sub.id).states[0].name, 'sub0');
});

test('editing inside a component survives ascending and descending again', () => {
  const h = createHarness();
  const { App } = h.context;
  const rootId = App.rootComponentId || h.context.ensureRootComponent().id;
  const sub = comp(h, 'Sub');

  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);
  h.context.createState(10, 10, 'inner');
  h.context.flushActiveComponent();

  h.context.bindComponent(rootId, [rootId]);
  assert.equal(App.states.length, 0, 'back in an empty parent');

  h.context.bindComponent(sub.id, [rootId, sub.id]);
  assert.equal(App.states.length, 1);
  assert.equal(App.states[0].name, 'inner', 'the edit was not lost on the round trip');
});

// The corruption case. Without bindComponent-not-flush in restoreSnapshot, the
// undo below files the sub-machine's states under the root's id.
test('undo across a descend boundary restores into the right component', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'main0');
  h.context.commit();
  const rootId = App.rootComponentId;

  const sub = comp(h, 'Sub');
  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);
  h.context.createState(10, 10, 'sub0');
  h.context.commit();
  h.context.createState(60, 10, 'sub1');
  h.context.commit();

  h.context.undo();

  assert.deepEqual(App.componentPath, [rootId, sub.id], 'undo stays where the edit happened');
  assert.equal(App.states.length, 1, 'the second sub-state is gone');
  assert.equal(App.states[0].name, 'sub0');

  h.context.flushActiveComponent();
  const root = h.context.getComponent(rootId);
  assert.equal(root.states.length, 1, 'the root must not have absorbed the sub-machine');
  assert.equal(root.states[0].name, 'main0');
});

test('undo returns to the component the earlier edit was made in', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'main0');
  h.context.commit();
  const rootId = App.rootComponentId;

  // The sub-machine exists, and is empty, as of this undo point.
  const sub = comp(h, 'Sub');
  h.context.commit();

  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);
  // createState snapshots on its own, so no commit() after it — that would
  // push a second entry and the undo below would land on it instead.
  h.context.createState(10, 10, 'sub0');

  h.context.undo();

  assert.deepEqual(App.componentPath, [rootId],
    'the canvas follows the undo back up to where that edit was made');
  assert.equal(App.states[0].name, 'main0', 'the live arrays are the parent again');
  const subAfter = h.context.getComponent(sub.id);
  assert.ok(subAfter, 'the sub-machine still exists');
  assert.equal(subAfter.states.length, 0, 'and is back to empty, not holding the parent\'s states');
  assert.equal(h.context.getComponent(rootId).states.length, 1,
    'the parent did not absorb anything from the component being left');
});

test('redo replays back into the sub-machine', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'main0');
  h.context.commit();
  const rootId = App.rootComponentId;
  const sub = comp(h, 'Sub');
  h.context.commit();

  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);
  h.context.createState(10, 10, 'sub0');
  h.context.commit();

  h.context.undo();
  h.context.redo();

  assert.deepEqual(App.componentPath, [rootId, sub.id], 'redo lands back inside the sub-machine');
  assert.equal(App.states.length, 1);
  assert.equal(App.states[0].name, 'sub0');
  assert.equal(h.context.getComponent(rootId).states[0].name, 'main0', 'the parent is untouched');
});

test('a workspace round-trips its whole component tree', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'main0');
  const rootId = h.context.ensureRootComponent().id;
  const sub = comp(h, 'Sub');
  h.context.flushActiveComponent();
  h.context.bindComponent(sub.id, [rootId, sub.id]);
  h.context.createState(10, 10, 'inner');

  const saved = h.context.exportWorkspaceState();
  assert.equal(saved.components.length, 2, 'both components are serialized');
  assert.deepEqual(saved.componentPath, [rootId, sub.id], 'and where we were standing');

  resetApp();
  h.context.importWorkspaceState(saved);

  assert.equal(App.components.length, 2);
  assert.deepEqual(App.componentPath, [rootId, sub.id]);
  assert.equal(App.states[0].name, 'inner', 'restored standing inside the sub-machine');
  assert.equal(h.context.getComponent(rootId).states[0].name, 'main0');
});

test('the exported blob is a deep copy, not a live reference', () => {
  const h = createHarness();
  h.context.createState(0, 0, 'q0');
  const saved = h.context.exportWorkspaceState();
  h.context.createState(80, 0, 'q1');

  assert.equal(saved.components[0].states.length, 1,
    'editing after a save must not reach back into the saved blob');
});

// Everything below is the legacy shape: machines saved before components
// existed. The fallback that synthesizes a root from the flat fields is what
// keeps every .json, share link, PNG blob and autosave working.

test('a file with no component tree loads as a single root', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.loadData({
    machine: 'DFA', sigma: ['a'], accepts: [], startId: 's1',
    states: [{ id: 's1', x: 50, y: 50, name: 'q0' }],
    transitions: []
  }, false);

  assert.equal(App.components.length, 1, 'a root is synthesized');
  assert.ok(App.rootComponentId);
  assert.deepEqual(App.componentPath, [App.rootComponentId]);
  assert.equal(App.components[0].states.length, 1, 'and it holds the loaded machine');
  assert.equal(App.states[0].id, 's1');
});

test('a workspace with no component tree imports as a single root', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.importWorkspaceState({
    machine: 'NFA', sigma: ['a', 'b'], accepts: ['s1'], startId: 's1',
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], transitions: []
  });

  assert.equal(App.components.length, 1);
  assert.equal(App.components[0].states.length, 1);
  assert.equal(App.machine, 'NFA');
});

test('an undo snapshot taken before components existed still restores', () => {
  const h = createHarness();
  const { App } = h.context;
  // Exactly the shape snapshot() used to write.
  const legacy = JSON.stringify({
    machine: 'DFA',
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], transitions: [],
    startId: 's1', accepts: [], sigma: ['a'], stackAlpha: ['Z'],
    outputAlpha: ['0', '1'], tapeCount: 2, stateN: 1, transN: 0,
    notes: [], noteN: 0, dividers: [], dividerN: 0
  });

  assert.doesNotThrow(() => h.context.restoreSnapshot(legacy));
  assert.equal(App.states.length, 1);
  assert.equal(App.components.length, 1, 'the flat fields become the root');
  assert.equal(App.components[0].states[0].id, 's1');
});

test('id counters clear the whole tree, not just the component on canvas', () => {
  const h = createHarness();
  const { App } = h.context;
  // A sub-machine numbered well above anything in the root: a counter that only
  // looked at App.states would hand out q3 again and collide across components.
  h.context.loadData({
    machine: 'DFA', sigma: ['a'], accepts: [], startId: 's1',
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], transitions: [],
    rootComponentId: 'c1',
    componentPath: ['c1'],
    componentN: 2,
    components: [
      { id: 'c1', name: 'Main', states: [{ id: 's1', x: 0, y: 0, name: 'q0' }], transitions: [], startId: 's1', accepts: [], exitIds: [] },
      { id: 'c2', name: 'Sub', states: [{ id: 's42', x: 0, y: 0, name: 'deep' }], transitions: [], startId: 's42', accepts: [], exitIds: [] }
    ]
  }, false);

  assert.equal(App.components.length, 2);
  assert.ok(App.stateN >= 42, `stateN must clear the whole tree, got ${App.stateN}`);
});

test('clearing the canvas discards the sub-machines too', () => {
  const h = createHarness();
  const { App } = h.context;
  const rootId = h.context.ensureRootComponent().id;
  comp(h, 'Sub');
  assert.equal(App.components.length, 2);

  h.context.performClear();

  assert.equal(App.components.length, 1, 'only a fresh root survives');
  assert.equal(App.components[0].states.length, 0);
  assert.notEqual(App.rootComponentId, null);
});
