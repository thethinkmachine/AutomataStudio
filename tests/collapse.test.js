import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Collapsing a region: the RSM box's one good idea, borrowed.
//
// The governing constraint, and the reason this file exists: `collapsed` is
// VIEW STATE AND NOTHING ELSE. flattenComponent, machineTree, the simulator and
// every export must never read it. That is what separates collapse from
// extractRegionToSubmachine — one changes how much you are looking at, the
// other changes which side of the REG/CFL line the machine is on, and they used
// to be the same lever.
//
// So the load-bearing assertions here are the boring ones: same language, same
// flattened machine, collapsed or not.

const harness = createHarness();
const { context } = harness;
const { App } = context;

function guardAI({ render = false } = {}) {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x', 'hurt', 'calm']);
  App.states = [
    { id: 'R', x: 200, y: 200, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 140, y: 200, name: 'approach', parent: 'R' },
    { id: 'b', x: 260, y: 200, name: 'strike', parent: 'R' },
    { id: 't', x: 600, y: 200, name: 'flee' }
  ];
  App.transitions = [
    { id: 't1', from: 'a', to: 'b', symbol: 'x' },
    { id: 't2', from: 'R', to: 't', symbol: 'hurt' },
    { id: 't3', from: 't', to: 'R', symbol: 'calm' }
  ];
  App.startId = 'a';
  App.accepts = new Set(['t']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
  if (render) context.renderAll(); else context.refreshSuperRects(App.states);
}

const flatten = () => context.flattenComponent({
  states: App.states, transitions: App.transitions,
  startId: App.startId, accepts: App.accepts
});
const run = word => context.simRSM(word === '' ? [] : word.split(' ')).accepted;

// ── the whole point ───────────────────────────────────────────────

test('collapsing does not change the machine it denotes', () => {
  guardAI();
  const open = flatten();
  context.toggleRegionCollapsed('R');
  const shut = flatten();

  assert.deepEqual(shut.states.map(s => s.id), open.states.map(s => s.id));
  assert.deepEqual(shut.transitions.map(t => `${t.from}|${t.symbol}|${t.to}`),
    open.transitions.map(t => `${t.from}|${t.symbol}|${t.to}`));
  assert.equal(shut.startId, open.startId);
  assert.deepEqual(shut.accepts.sort(), open.accepts.sort());
});

test('collapsing does not change the language', () => {
  guardAI();
  const before = ['x hurt', 'hurt', 'x', 'hurt calm x hurt'].map(run);
  context.toggleRegionCollapsed('R');
  const after = ['x hurt', 'hurt', 'x', 'hurt calm x hurt'].map(run);
  assert.deepEqual(after, before);
});

test('a run still highlights states inside a collapsed region', () => {
  guardAI();
  context.toggleRegionCollapsed('R');
  run('x hurt');
  // The simulator names drawn leaves regardless of what is on screen; the
  // renderer is what decides they are not currently visible.
  assert.ok(App.simSteps.some(s => s.state === 'a' || s.state === 'b'),
    'collapsing must not make the run skip the states it hid');
});

// ── geometry ──────────────────────────────────────────────────────

test('a collapsed region is a fixed box, not one derived from its contents', () => {
  guardAI();
  const open = { ...App.superRects.get('R') };
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const shut = App.superRects.get('R');
  assert.ok(shut.closed);
  assert.ok(shut.w < open.w, 'it no longer spans its children');
  assert.equal(shut.w, App.config.superstate.closedW);
});

test('collapsing pins the region where it was drawn', () => {
  guardAI();
  const open = App.superRects.get('R');
  const cx = open.x + open.w / 2, cy = open.y + open.h / 2;
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const shut = App.superRects.get('R');
  assert.equal(shut.x + shut.w / 2, cx, 'with no children on screen there is nothing to derive it from');
  assert.equal(shut.y + shut.h / 2, cy);
});

test('hidden states are reported so nothing measures off-screen geometry', () => {
  guardAI();
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  assert.deepEqual([...App.hiddenStates].sort(), ['a', 'b']);
});

test('fit-to-screen does not frame what a collapsed region is hiding', () => {
  guardAI();
  App.states.find(s => s.id === 'b').x = 5000;   // far away, then hidden
  context.refreshSuperRects(App.states);
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const b = context.getContentBounds(0);
  assert.ok(b.maxX < 5000, 'a hidden state keeps its position but is not on screen');
});

// ── edge projection ───────────────────────────────────────────────

// The part that makes collapse real rather than just a visibility flag: an
// arrow into a hidden state has to land on the box that replaced it.
test('an arrow into a hidden state is drawn on the collapsed region', () => {
  guardAI();
  App.transitions.push({ id: 't4', from: 't', to: 'b', symbol: 'x' });
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const drawn = context.groupTrans();
  assert.ok(drawn.some(g => g.from === 't' && g.to === 'R'),
    't → b projects onto t → R');
  assert.ok(!drawn.some(g => g.to === 'b'), 'and nothing still points at the hidden state');
});

test('an arrow entirely inside a collapsed region is not drawn at all', () => {
  guardAI();
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const drawn = context.groupTrans();
  assert.ok(!drawn.some(g => g.ts.some(t => t.id === 't1')),
    'a → b is internal; a self-loop on the box would claim something about the container');
});

test('projected edges still resolve back to the arrows they stand for', () => {
  guardAI();
  App.transitions.push({ id: 't4', from: 't', to: 'b', symbol: 'x' });
  context.toggleRegionCollapsed('R');
  context.refreshSuperRects(App.states);
  const grp = context.groupTrans().find(g => g.from === 't' && g.to === 'R');
  // t3 (t → R) and t4 (t → b) are one edge on screen now.
  assert.deepEqual(grp.ts.map(t => t.id).sort(), ['t3', 't4']);
});

test('nothing collapsed means no projection work at all', () => {
  guardAI();
  assert.equal(context.edgeProjection(), null,
    'the common case pays nothing for a feature it is not using');
});

// ── rendering ─────────────────────────────────────────────────────

test('the contents leave the DOM when the region closes, and come back', () => {
  guardAI({ render: true });
  assert.ok(App.domCache.states.get('a'), 'drawn while open');
  context.toggleRegionCollapsed('R');
  context.renderAll();
  assert.ok(!App.domCache.states.get('a'), 'evicted while closed');
  assert.ok(App.domCache.supers.get('R'), 'the container is still there');
  context.toggleRegionCollapsed('R');
  context.renderAll();
  assert.ok(App.domCache.states.get('a'), 'and rebuilt on expand');
});

test('a nested region inside a collapsed one is evicted too', () => {
  guardAI({ render: true });
  // Put a region around 'b', then collapse the outer one.
  App.states.push({ id: 'R2', x: 260, y: 200, name: 'Inner', super: true, initial: 'b', parent: 'R' });
  App.states.find(s => s.id === 'b').parent = 'R2';
  context.renderAll();
  assert.ok(App.domCache.supers.get('R2'));
  context.toggleRegionCollapsed('R');
  context.renderAll();
  assert.ok(!App.domCache.supers.get('R2'), 'only the outermost collapsed region is on screen');
  assert.ok(!App.superRects.has('R2'), 'and it has no rectangle to be hit-tested against');
});

test('expandAll opens everything at once', () => {
  guardAI();
  context.toggleRegionCollapsed('R');
  assert.equal(context.expandAllRegions(), true);
  assert.equal(App.states.find(s => s.id === 'R').collapsed, undefined);
});

// ── it survives the round trip ────────────────────────────────────

test('collapse state is saved and restored with the workspace', () => {
  guardAI();
  context.toggleRegionCollapsed('R');
  const blob = context.exportWorkspaceState();
  harness.resetApp();
  context.importWorkspaceState(blob);
  assert.equal(App.states.find(s => s.id === 'R').collapsed, true,
    'reopening a diagram folded the way you left it is the point of folding it');
});

test('undo reopens a region', () => {
  guardAI();
  // undo() restores the second-to-last entry, so a baseline has to exist —
  // the same setup every other undo test in this suite does.
  context.snapshot();
  context.toggleRegionCollapsed('R');
  context.undo();
  assert.ok(!App.states.find(s => s.id === 'R').collapsed,
    'a view change is still a change the user asked for and can take back');
});
