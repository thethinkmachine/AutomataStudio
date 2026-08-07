import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Regions meeting the editing operations that predate them.
//
// Every case here is a path that was written when a node was a circle with no
// parent and no extent: the Delete key, arrow-key nudge, copy/paste, autolayout,
// and the drop step at the end of a pointer gesture. Each one had a defensible
// implementation that became wrong the moment a node could contain another —
// and each failed silently rather than throwing, which is why they are worth
// pinning down.
//
// The rule they all now share: a region IS its contents. Moving, copying and
// deleting one means moving, copying and deleting the subtree, because a
// region's own x/y is derived from its children and writing to it does nothing.

const harness = createHarness();
const { context } = harness;
const { App } = context;

function nested() {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x', 'out']);
  App.states = [
    { id: 'R', x: 200, y: 200, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 140, y: 200, name: 'approach', parent: 'R' },
    { id: 'b', x: 260, y: 200, name: 'strike', parent: 'R' },
    { id: 'z', x: 600, y: 200, name: 'flee' }
  ];
  App.transitions = [
    { id: 't1', from: 'a', to: 'b', symbol: 'x' },
    { id: 't2', from: 'R', to: 'z', symbol: 'out' }
  ];
  App.startId = 'a';
  App.accepts = new Set(['z']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
  context.refreshSuperRects(App.states);
}

const byId = id => App.states.find(s => s.id === id);
const ids = () => App.states.map(s => s.id).sort();

// ── the drop step at the end of a gesture ─────────────────────────

// dragOffsets is armed on pointer-DOWN, so it is set for a click that never
// moves. Committing a drop on that click resolved the target as "no region"
// and evicted the state from its container — with no undo point, because the
// drag's snapshot is only taken on first movement.
test('a click that never became a drag does not commit a drop', () => {
  nested();
  App.tool = 'move';
  App.dragOffsets = { a: { x: 0, y: 0 } };
  App.dragPendingSnapshot = true;      // set by onStateDown, cleared on first move
  context.endPointerInteractions();
  assert.equal(byId('a').parent, 'R',
    'selecting a state must not be a way of removing it from its region');
});

test('a drag that did move still commits its drop', () => {
  nested();
  App.tool = 'move';
  App.dragOffsets = { a: { x: 0, y: 0 } };
  App.dragPendingSnapshot = false;     // the pointer moved
  context.endPointerInteractions();
  assert.equal(byId('a').parent, undefined,
    'dropped outside every region, so it leaves the one it was in');
});

// dragMeasureExclusion() drops the state being dragged out of its own
// container's measurement — otherwise the container would grow to follow it
// forever and it could never leave. But hit-testing the drop target against
// that same shrunk rect meant the container could eject a state the instant
// dragging started, well before the pointer had gone anywhere near its true
// edge. containerAt now hit-tests against App.dragOriginRects — the rects as
// they stood the moment before this drag's first movement — so the escape
// boundary is the region's real, undragged extent.
function drag(id, path) {
  App.tool = 'move';
  App.cam = { x: 0, y: 0, z: 1 };
  context.onStateDown({ button: 0, clientX: path[0].x, clientY: path[0].y, pointerId: 1, stopPropagation() {}, preventDefault() {} }, id);
  for (const { x, y } of path) {
    context.handlePointerMove({ clientX: x, clientY: y, shiftKey: false, preventDefault() {} });
  }
}

test('nudging a state inside a spacious region does not evict it', () => {
  nested();
  // R's true extent (both children plus padding) reaches well past x=180 —
  // see 'a region is sized from its children' — so this is a plain reposition,
  // not an attempt to leave.
  drag('a', [{ x: 145, y: 200 }, { x: 160, y: 200 }, { x: 180, y: 200 }]);
  assert.equal(context.dropTargetId, 'R',
    'still well inside the region as drawn before the drag started');
  context.endPointerInteractions();
  assert.equal(byId('a').parent, 'R', 'a nudge is not an eviction');
});

test('dragging far enough still leaves the region', () => {
  nested();
  drag('a', [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 700, y: 200 }]);
  assert.equal(context.dropTargetId, null, 'past every region, including its own');
  context.endPointerInteractions();
  assert.equal(byId('a').parent, undefined, 'a real exit still works');
});

// Every render while App.dragOffsets was still set — including the structural
// one commitDropTarget triggers on a genuine drop — measured the region
// without the state that had just been dragged. Left uncorrected, the region
// renders (and, worse, is HIT-TESTED against) one state short of its true
// shape until some unrelated interaction happens to force a fresh render.
test('a region settles to its true shape after a drag that changes nothing structurally', () => {
  nested();
  drag('a', [{ x: 145, y: 200 }, { x: 160, y: 200 }, { x: 180, y: 200 }]);
  context.endPointerInteractions();
  const settled = App.superRects.get('R');
  const fresh = context.superstateRects(App.states).get('R');
  assert.deepEqual(settled, fresh,
    'the rendered rect must match a from-scratch computation, not a stale exclusion-shrunk one');
});

// ── Delete ────────────────────────────────────────────────────────

// Two paths delete a state: the context menu (deleteState) and the Delete key.
// They have to agree, and the keyboard one used to filter only the selected id.
test('the Delete key takes a region’s contents with it, like the menu does', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.deleteSelection();
  assert.deepEqual(ids(), ['z'], 'the region and both children are gone');
  assert.ok(!App.states.some(s => s.parent && !App.states.find(p => p.id === s.parent)),
    'and nothing is left pointing at a parent that no longer exists');
});

test('deleting a region also drops the arrows through its children', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.deleteSelection();
  assert.deepEqual(App.transitions.map(t => t.id), [],
    't1 was inside the region and t2 left it — neither has endpoints any more');
});

test('a default entry pointing at a deleted state is not left dangling', () => {
  nested();
  App.selectedStates = new Set(['a']);
  context.deleteSelection();
  assert.equal(byId('R').initial, undefined,
    'the region would otherwise enter at a state that is gone');
});

// ── arrow-key nudge ───────────────────────────────────────────────

// A region's x/y is recomputed from its children on every render, so writing to
// it is a no-op that looks like a bug in the keyboard handler.
test('nudging a selected region moves it, by moving what it contains', () => {
  nested();
  const before = { ...App.superRects.get('R') };
  App.selectedStates = new Set(['R']);
  context.nudgeSelected(50, 40);
  context.refreshSuperRects(App.states);
  const after = App.superRects.get('R');
  assert.equal(after.x, before.x + 50);
  assert.equal(after.y, before.y + 40);
  assert.equal(byId('a').x, 190, 'the children are what actually moved');
});

test('nudging a region does not move states outside it', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.nudgeSelected(50, 40);
  assert.equal(byId('z').x, 600);
});

// ── copy / paste / duplicate ──────────────────────────────────────

// parent/initial travel by id, so they need remapping exactly like from/to.
test('pasting a region produces a self-contained copy', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.copySelection();
  const before = new Set(App.states.map(s => s.id));
  context.pasteClipboard(null, 40);
  const copies = App.states.filter(s => !before.has(s.id));

  assert.equal(copies.length, 3, 'the region and both of its children');
  const region = copies.find(s => s.super);
  const kids = copies.filter(s => !s.super);
  assert.ok(kids.every(k => k.parent === region.id),
    'the copies belong to the copied region, not to the original');
  assert.ok(copies.some(s => s.id === region.initial),
    'and its default entry names one of them');
});

test('copying a region copies its contents even when only the region is selected', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.copySelection();
  assert.deepEqual(App.clipboard.states.map(s => s.id).sort(), ['R', 'a', 'b']);
});

test('a copied child whose region stayed behind lands at the top level', () => {
  nested();
  App.selectedStates = new Set(['a']);
  context.copySelection();
  const before = new Set(App.states.map(s => s.id));
  context.pasteClipboard(null, 40);
  const copy = App.states.find(s => !before.has(s.id));
  assert.equal(copy.parent, undefined,
    'it must not be adopted by the region the original is in');
});

// ── autolayout ────────────────────────────────────────────────────

// Laying every state out in one flat pass ignores containment, so a region's
// derived rect grows to span children that have been scattered — and can end up
// enclosing a state that was never inside it, which is a picture that lies.
test('autolayout keeps a region’s children together', () => {
  nested();
  context.autoLayout();
  context.refreshSuperRects(App.states);
  const r = App.superRects.get('R');
  const inside = p => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  assert.ok(inside(byId('a')) && inside(byId('b')), 'both children are in their region');
  assert.ok(!inside(byId('z')), 'and the state that is not in it is not drawn inside it');
});

test('autolayout spaces a region by its real size, not by the node radius', () => {
  nested();
  context.autoLayout();
  context.refreshSuperRects(App.states);
  const r = App.superRects.get('R');
  const z = byId('z');
  const gap = Math.abs(z.x - (r.x + r.w / 2));
  assert.ok(gap > r.w / 2,
    'a region spaced as a circle of radius R would overlap its neighbour');
});

test('autolayout on a machine with no regions is unchanged', () => {
  harness.resetApp();
  App.machine = 'DFA';
  App.states = [
    { id: 'q0', x: 0, y: 0, name: 'q0' },
    { id: 'q1', x: 500, y: 300, name: 'q1' }
  ];
  App.transitions = [{ id: 't1', from: 'q0', to: 'q1', symbol: 'a' }];
  App.startId = 'q0';
  context.ensureRootComponent();
  context.autoLayout();
  // One layer per rank, first column at x=0 — the pre-existing contract.
  assert.equal(byId('q0').x, 0);
  assert.ok(byId('q1').x > 0);
  assert.equal(byId('q0').y, 0, 'a single node in a layer sits on the centre line');
});

// ── grouping affordances ──────────────────────────────────────────

test('Ctrl+G groups the selection', () => {
  nested();
  App.selectedStates = new Set(['z']);
  context.groupSelection();
  assert.equal(byId('z').parent !== undefined, true, 'z is now inside a new region');
});

// Nesting a region inside another is how an orthogonal region is built, so
// grouping has to accept a region as a member.
test('a region can be grouped into another region', () => {
  nested();
  App.selectedStates = new Set(['R', 'z']);
  const outer = context.groupSelection();
  context.refreshSuperRects(App.states);
  assert.equal(byId('R').parent, byId('z').parent,
    'both became children of the same new region');
  assert.notEqual(byId('R').parent, undefined);
});

test('Ctrl+Shift+G ungroups the selected region', () => {
  nested();
  App.selectedStates = new Set(['R']);
  context.ungroupSelection();
  assert.ok(!App.states.some(s => s.id === 'R'), 'the container is gone');
  assert.deepEqual(ids(), ['a', 'b', 'z'], 'but its contents are not');
});
