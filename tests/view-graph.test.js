import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';

// What the canvas shows, and the two things that make it safe.
//
// The machine is flat: every state of every block, at every depth, is in
// App.states. What the reader looks at is a *projection* of it — the states of
// one scope, one box per child block, and every crossing edge rewritten to end
// on that box. Feeding that to buildLayoutContext is what carries the renderer,
// the drag path, fit-to-screen, the exporters and the minimap along with it,
// rather than eight places each deciding separately what is on screen.
//
// The two invariants underneath everything here:
//
//   * **The model never moves.** Drilling into a block changes App.scope and
//     nothing else, so undo, selection, a running simulation and every decider
//     are untouched by it. Scope is a camera, not a mode.
//   * **Identity is stable across a drag.** relayout() refuses the incremental
//     path when `prev.states !== states`, so a projection that rebuilt its
//     arrays every frame would take a full layout pass sixty times a second and
//     undo the whole of Phase 2's work.

const harness = createHarness();
const { context: ctx } = { context };
const ANY = 'Σ';
const BLANK = '⊔';

function tmCanvas() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  return App;
}

function def(name, n = 2) {
  const states = [];
  const transitions = [];
  for (let i = 0; i < n; i++) states.push({ id: 'd' + i, x: i * 90, y: 0, name: 'q' + i });
  for (let i = 0; i + 1 < n; i++) {
    transitions.push({ id: 'e' + i, from: 'd' + i, to: 'd' + (i + 1), symbol: 'a', write: 'a', dir: 'R' });
  }
  return {
    name, machine: 'TM', sigma: ['a', 'b'], stackAlpha: ['a', 'b', BLANK],
    states, transitions, startId: 'd0', entry: 'd0', accepts: ['d' + (n - 1)], version: 1
  };
}

/** A machine with one block on it, plus an outer state wired to its exit. */
function withBlock() {
  const App = tmCanvas();
  const { block } = context.inlineBlock(def('seek', 3), { x: 200, y: 200 });
  const after = { id: 's' + (++App.stateN), x: 600, y: 200, name: 'after' };
  App.states.push(after);
  App.transitions.push({
    id: 't' + (++App.transN), from: block.exits[0].id, to: after.id,
    symbol: ANY, write: ANY, dir: 'S'
  });
  App.startId = block.entry;
  App.accepts.add(after.id);
  context.invalidateViewGraph();
  return { App, block, after };
}

// ── the projection ────────────────────────────────────────────────

test('a collapsed block is one node, and its interior is not drawn', () => {
  const { App, block, after } = withBlock();
  const drawn = context.viewStates();

  assert.equal(App.states.length, 4, 'the machine still has every state');
  assert.equal(drawn.length, 2, 'the canvas shows a box and the state beside it');
  assert.deepEqual(drawn.map(s => s.id).sort(), [block.id, after.id].sort());
  const box = drawn.find(s => s.id === block.id);
  assert.equal(box.kind, 'block');
  assert.ok(box.box.w > 0 && box.box.h > 0, 'it has a size');
  assert.ok(box.r > 0, 'and a clearance radius the layout pass can use');
});

test('an edge out of a block is drawn from the box', () => {
  const { block, after } = withBlock();
  const drawn = context.viewTransitions();

  assert.equal(drawn.length, 1, 'the block\'s own two edges are inside the box');
  assert.equal(drawn[0].from, block.id, 'rewritten to leave the box');
  assert.equal(drawn[0].to, after.id);
  // The proxy reads through to the real transition, so a bend dragged on the
  // drawn edge is seen by the layout pass rather than a stale copy of it.
  assert.equal(drawn[0].symbol, ANY);
});

test('a rewritten edge resolves back to the transitions behind it', () => {
  const { App, block } = withBlock();
  const key = context.viewTransitions()[0].from + '|' + context.viewTransitions()[0].to;
  const real = context.viewEdgeGroup(key);

  assert.equal(real.length, 1);
  assert.equal(real[0].from, block.exits[0].id, 'the model\'s own endpoint, not the box');
  assert.ok(App.transitions.includes(real[0]), 'and the model\'s own object');
});

test('a bend written on the real edge is seen through the proxy', () => {
  const { App } = withBlock();
  const proxyEdge = context.viewTransitions()[0];
  const real = App.transitions[App.transitions.length - 1];

  assert.equal(proxyEdge.curve, undefined);
  real.curve = 55;
  // Object.create rather than a copy: a copied field would be a snapshot the
  // layout pass went on reading for the rest of the session.
  assert.equal(proxyEdge.curve, 55);
});

test('a state inside a collapsed block resolves to the box', () => {
  const { block, after } = withBlock();
  const inner = context.blockMembers(block.id)[0];

  assert.equal(context.visibleNodeIdFor(inner.id), block.id);
  assert.equal(context.visibleNodeIdFor(after.id), after.id);
});

// ── identity across a drag ────────────────────────────────────────

test('the projection keeps its arrays across a drag, so relayout stays incremental', () => {
  const { App, block } = withBlock();
  const a = context.viewGraph();
  const boxNode = a.byId.get(block.id);

  getBlockRecord(App, block.id).x += 40;
  const b = context.viewGraph();

  assert.equal(b.states, a.states, 'same array');
  assert.equal(b.transitions, a.transitions, 'same array');
  assert.equal(b.byId.get(block.id), boxNode, 'same node object');
  assert.equal(boxNode.x, getBlockRecord(App, block.id).x, 'refreshed in place');
});

test('adding a state rebuilds the projection', () => {
  const { App } = withBlock();
  const before = context.viewGraph().states;
  App.states = [...App.states, { id: 'sX', x: 0, y: 0, name: 'extra' }];
  assert.notEqual(context.viewGraph().states, before);
});

function getBlockRecord(App, id) { return App.blocks.find(b => b.id === id); }

// ── the render profile weighs the level, through the boxes ────────
//
// A box is not one node. It carries a live preview of its interior — a walk of
// the machine to build, a scan of the machine to key, and up to a budget of
// elements to draw — and the states behind it cost a full stringify on every
// autosave tick and a full workspace copy per undo entry, whatever they are
// drawn as. Judged on the *node count* of the projection, an arbitrarily large
// machine could hide inside a handful of boxes and be called small.
//
// So the profile weighs the subtree the reader is standing in, at every depth.
// That keeps the good half of judging the view — a genuinely small level is
// still drawn in full — and drops the belief that a box is small.

test('a large machine hidden inside eight boxes is still a large machine', () => {
  const App = tmCanvas();
  for (let b = 0; b < 8; b++) context.inlineBlock(def('unit ' + b, 60), { x: b * 400, y: 0 });
  context.invalidateViewGraph();

  assert.ok(App.states.length > context.COLLISION_BUDGET_STATES,
    'the machine really is past the budget');
  assert.equal(context.viewStates().length, 8, 'and the canvas is drawing eight boxes');
  assert.equal(context.machineIsLarge(), true,
    'which cost what 480 states cost, with the profile off throughout');
});

test('the weight reaches through nesting, however deep', () => {
  const App = tmCanvas();
  // One box at the top level holding one state and one further box, and every
  // other state a level below that. Counted a level at a time the top weighs
  // two and the level inside it weighs two — and 240 states go unnoticed.
  App.states = [
    { id: 'gate', x: 0, y: 0, name: 'ALU/gate', blockId: 'outer' },
    ...Array.from({ length: 240 }, (_, i) => ({
      id: 's' + i, x: i * 20, y: 60, name: 'ALU/add/s' + i, blockId: 'inner'
    }))
  ];
  App.transitions = [];
  App.blocks = [
    { id: 'outer', name: 'ALU', parent: null, entry: 'gate', exits: [], x: 0, y: 0 },
    { id: 'inner', name: 'add', parent: 'outer', entry: 's0', exits: [], x: 0, y: 60 }
  ];
  context.invalidateBlockIndex();
  context.invalidateViewGraph();

  assert.equal(context.viewStates().length, 1, 'one box drawn');
  assert.equal(context.drawnSize().states, 241, 'and it stands for all of them');
  assert.equal(context.machineIsLarge(), true);

  // And the machine around it does not decide: going inside the box that holds
  // nothing directly still weighs what is underneath it.
  assert.equal(context.enterBlockScope('outer'), true);
  context.invalidateViewGraph();
  assert.equal(context.viewStates().length, 3, 'a state, a box and an entry tab');
  assert.equal(context.machineIsLarge(), true, 'still weighing what is under the box');
});

test('a small level inside a large machine is drawn in full', () => {
  // The half of judging the view that was right, and the reason the weight is
  // the subtree rather than the machine: an eight-state adder is an eight-state
  // diagram whatever it is nested in, and stripping its labels would buy
  // nothing.
  const App = tmCanvas();
  for (let b = 0; b < 8; b++) context.inlineBlock(def('unit ' + b, 60), { x: b * 400, y: 0 });
  const small = context.inlineBlock(def('adder', 4), { x: 0, y: 600 });
  context.invalidateViewGraph();
  assert.equal(context.machineIsLarge(), true, 'large at the top');

  assert.equal(context.enterBlockScope(small.block.id), true);
  context.invalidateViewGraph();
  assert.equal(context.drawnSize().states, 4);
  assert.equal(context.machineIsLarge(), false,
    'so the labels and the easing come back inside it');
});

test('the preview budget is part of the profile', () => {
  // The previews are what a level made of boxes costs, so announcing the
  // profile while still drawing them at full size would be announcing a
  // simplification that had not happened.
  const App = tmCanvas();
  context.inlineBlock(def('unit', 4), { x: 0, y: 0 });
  context.invalidateViewGraph();
  assert.equal(context.machineIsLarge(), false);
  assert.equal(context.previewNodeBudget(), context.PREVIEW_MAX_NODES);

  for (let b = 0; b < 8; b++) context.inlineBlock(def('unit ' + b, 60), { x: b * 400, y: 900 });
  context.invalidateViewGraph();
  assert.equal(context.machineIsLarge(), true);
  assert.equal(context.previewNodeBudget(), context.PREVIEW_MAX_NODES_LARGE);
  assert.ok(context.PREVIEW_MAX_NODES_LARGE < context.PREVIEW_MAX_NODES);

  // And the override lifts it with everything else.
  App.config.render.largeMachineAuto = false;
  assert.equal(context.previewNodeBudget(), context.PREVIEW_MAX_NODES);
  delete App.config.render.largeMachineAuto;
});

test('a large machine with no blocks is still a large machine', () => {
  const App = tmCanvas();
  App.states = Array.from({ length: 400 }, (_, i) => ({ id: 's' + i, x: i, y: 0, name: 'q' + i }));
  context.invalidateViewGraph();
  assert.equal(context.machineIsLarge(), true);
});

// ── scope ─────────────────────────────────────────────────────────

test('drilling in shows the interior and nothing outside it', () => {
  const { App, block, after } = withBlock();
  assert.equal(context.enterBlockScope(block.id), true);

  const drawn = context.viewStates().filter(s => s.kind !== 'port');
  assert.equal(drawn.length, 3, 'the block\'s three states');
  assert.ok(!drawn.some(s => s.id === after.id), 'and not the state outside it');
  assert.deepEqual(App.scope, [block.id]);
});

test('drilling in moves nothing in the model', () => {
  const { block } = withBlock();
  const before = context.exportWorkspaceState();
  const beforeStates = JSON.stringify(before.states);

  context.enterBlockScope(block.id);
  const after = context.exportWorkspaceState();

  assert.equal(JSON.stringify(after.states), beforeStates, 'not one state moved');
  assert.equal(after.transitions.length, before.transitions.length);
  // Scope is the one thing that changed, and it is a camera.
  assert.deepEqual(before.scope, []);
  assert.deepEqual(after.scope, [block.id]);
});

test('a run still decides the same word from inside a block', () => {
  const { App, block } = withBlock();
  const outside = context.decideMachine('TM', ['a', 'a']).verdict;
  context.enterBlockScope(block.id);
  assert.equal(context.decideMachine('TM', ['a', 'a']).verdict, outside,
    'the machine is flat, so where the reader is looking cannot change a verdict');
});

test('going out one level returns to the top', () => {
  const { block } = withBlock();
  context.enterBlockScope(block.id);
  assert.equal(context.leaveBlockScope(), true);
  assert.deepEqual(context.App.scope, []);
  assert.equal(context.leaveBlockScope(), false, 'and there is nowhere further to go');
});

test('a nested block is entered by its own ancestry, from anywhere', () => {
  const App = tmCanvas();
  const outer = context.inlineBlock({
    ...def('ALU', 2),
    states: [
      { id: 'd0', x: 0, y: 0, name: 'in' },
      { id: 'd1', x: 90, y: 0, name: 'add/step', blockId: 'k1' }
    ],
    transitions: [{ id: 'e0', from: 'd0', to: 'd1', symbol: ANY, write: ANY, dir: 'S' }],
    blocks: [{ id: 'k1', name: 'add', parent: null, entry: 'd1', exits: [{ id: 'd1', label: 'done' }], x: 90, y: 0 }],
    accepts: ['d1']
  }, {});
  const inner = context.blockChildren(outer.block.id)[0];
  context.invalidateViewGraph();

  // From the top level, in one call — the Blocks panel offers every block in
  // the machine, so "open the multiplier" cannot mean "if you are next to it".
  assert.equal(context.enterBlockScope(inner.id), true);
  assert.deepEqual(context.App.scope, [outer.block.id, inner.id]);
});

test('a scope pointing at a block that has gone falls back to the top', () => {
  const { block } = withBlock();
  context.enterBlockScope(block.id);
  context.removeBlock(block.id);
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  assert.deepEqual(context.liveScope(), []);
});

// ── ports ─────────────────────────────────────────────────────────

test('a drilled-in view says where control arrives and where it leaves', () => {
  const { block } = withBlock();
  context.enterBlockScope(block.id);
  const ports = context.viewStates().filter(s => s.kind === 'port');

  assert.equal(ports.length, 2, 'one in, one out');
  const entry = ports.find(p => p.dir === 'in');
  const exit = ports.find(p => p.dir === 'out');
  assert.ok(entry, 'an entry port');
  assert.ok(exit, 'and an exit port');
  assert.ok(exit.name.includes('after'), 'which says where it hands control back');
});

test('ports are derived, so they reach no serializer and carry no transitions', () => {
  const { block } = withBlock();
  context.enterBlockScope(block.id);
  const blob = context.exportWorkspaceState();
  assert.ok(!JSON.stringify(blob).includes('__in__'), 'nothing about a port is saved');

  const portEdge = context.viewTransitions().find(t => t.port);
  assert.ok(portEdge, 'a port edge is drawn');
  const key = portEdge.from + '|' + portEdge.to;
  assert.equal(context.viewEdgeGroup(key), null,
    'and it answers null, so every edge listener is inert on it');
});

test('at the top level there are no ports at all', () => {
  withBlock();
  assert.equal(context.viewStates().filter(s => s.kind === 'port').length, 0);
});

// ── the start arrow follows the machine into a box ────────────────

test('the start arrow points at the block the start state is inside', () => {
  const { block } = withBlock();
  assert.equal(context.startNodeId(), block.id);
  context.enterBlockScope(block.id);
  assert.equal(context.startNodeId(), context.App.startId, 'and at the state once inside');
});

// ══════════════════════════════════════════════════════════════════
//  PORTS ARE PLACED, NOT PINNED
// ══════════════════════════════════════════════════════════════════

function scopedBlock() {
  harness.resetApp();
  context.App.machine = 'TM';
  context.App.sigma = new Set(['a']);
  context.App.stackAlpha = new Set(['a', '⊔']);
  context.App.config.render.animateLayout = false;
  context.App.states = [
    { id: 'i1', x: 0, y: 0, name: 'blk/in', blockId: 'b1' },
    { id: 'i2', x: 200, y: 0, name: 'blk/out', blockId: 'b1' },
    { id: 's9', x: 900, y: 0, name: 'host' }
  ];
  context.App.transitions = [
    { id: 't0', from: 's9', to: 'i1', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't1', from: 'i1', to: 'i2', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 'i2', to: 's9', symbol: 'a', write: 'a', dir: 'R' }
  ];
  context.App.blocks = [{
    id: 'b1', name: 'blk', parent: null, entry: 'i1',
    exits: [{ id: 'i2', label: 'done' }], x: 400, y: 0, w: 160, h: 110, version: 1
  }];
  context.App.blockN = 1;
  context.App.startId = 's9';
  context.invalidateViewGraph();
  context.enterBlockScope('b1');
}

const portsNow = () => context.viewStates().filter(n => n.kind === 'port');

test('a port steps clear of whatever is standing on its ideal spot', () => {
  scopedBlock();
  const ideal = portsNow().find(p => p.dir === 'in');
  const at = { x: ideal.x, y: ideal.y };

  // Drop a state exactly where the entry tab wants to sit. Pinned to one fixed
  // offset the tab simply drew on top of it, which is what made ports read as
  // nailed to the diagram rather than laid out on it.
  context.App.states = [...context.App.states, { id: 'crowd', x: at.x, y: at.y, name: 'blk/crowd', blockId: 'b1' }];
  context.invalidateViewGraph();

  const moved = portsNow().find(p => p.dir === 'in');
  assert.notDeepEqual({ x: moved.x, y: moved.y }, at, 'the port found somewhere else to be');
});

test('a port follows the state it is attached to', () => {
  scopedBlock();
  const before = portsNow().find(p => p.dir === 'in');
  const offset = { dx: before.x - 0, dy: before.y - 0 };

  context.getState('i1').x += 300;
  context.getState('i1').y += 120;

  const after = portsNow().find(p => p.dir === 'in');
  assert.equal(after.x, 300 + offset.dx, 'it keeps the offset it was placed at');
  assert.equal(after.y, 120 + offset.dy);
});

test('two exits on one state are two tabs, not one', () => {
  scopedBlock();
  context.App.blocks[0].exits = [{ id: 'i2', label: 'yes' }, { id: 'i2', label: 'no' }];
  context.invalidateViewGraph();

  const outs = portsNow().filter(p => p.dir === 'out');
  // Keyed on the state alone both tabs took one id, so the second overwrote the
  // first and a block with two answers drew one unnamed exit.
  assert.equal(outs.length, 2);
  assert.equal(new Set(outs.map(p => p.id)).size, 2, 'and they have distinct ids');
  assert.notEqual(outs[0].y, outs[1].y, 'and they do not sit on each other');
});

test('ports reach no serializer', () => {
  scopedBlock();
  const blob = JSON.stringify(context.exportWorkspaceState()) + JSON.stringify(context.getWorkspaceData());
  assert.ok(!blob.includes('__in__'), 'the entry tab is derived, never stored');
  assert.ok(!blob.includes('__out__'), 'and so is every exit tab');
});

// ── a cache hit has to actually be cheap ──────────────────────────
//
// viewGraph() is on the hot path in a way that is easy to forget: the layout
// pass runs it per frame, edgeLabelsHidden() reaches it once per edge label, and
// every surface that resolves a machine id to a drawn one reaches it per item.
// So "the cache hit" is not an optimisation on top of a correct answer — it is
// the answer, and anything O(machine) inside it is a stall rather than a slow
// frame.
//
// What made it one: refresh() called blockSize(), which falls through to
// blockMembers() + blockChildren() whenever a record carries no size of its own
// — and inlineBlock leaves those null, so that is the ordinary case, not the
// exception. Both are unindexed filters that allocate. A select-all over 2000
// transitions measured 617ms with eight blocks against 7ms without.

test('a cache hit recomputes no derived size', () => {
  tmCanvas();
  const { block } = context.inlineBlock(def('seek', 6), { x: 200, y: 200 });
  context.invalidateViewGraph();
  const node = context.viewGraph().byId.get(block.id);
  const box = node.box;

  for (let i = 0; i < 5; i++) context.viewGraph();

  // Object identity, not equality: an equal box rebuilt each time is exactly the
  // walk over the machine this is here to catch, and it looks identical from the
  // outside. What a derived size derives from cannot change without stillValid()
  // failing and the projection being rebuilt outright.
  assert.equal(context.viewGraph().byId.get(block.id).box, box);
});

test('a hand-set size is still picked up on a cache hit', () => {
  tmCanvas();
  const { block } = context.inlineBlock(def('seek', 6), { x: 200, y: 200 });
  context.invalidateViewGraph();
  context.viewGraph();

  // The one thing that *can* change without any array changing identity: the
  // reader resizing the box. Two reads off the record is what that costs.
  block.w = 260; block.h = 180;
  const node = context.viewGraph().byId.get(block.id);
  assert.deepEqual(node.box, { w: 260, h: 180 });
});

test('blocks do not make a selection sweep scale with the machine', () => {
  const build = (nStates, nBlocks) => {
    harness.resetApp();
    const { App } = context;
    App.machine = 'DFA';
    App.sigma = new Set(['a']);
    for (let i = 0; i < nStates; i++) App.states.push({ id: 's' + i, x: i * 5, y: (i % 40) * 5, name: 'q' + i });
    for (let i = 0; i + 1 < nStates; i++) App.transitions.push({ id: 't' + i, from: 's' + i, to: 's' + (i + 1), symbol: 'a' });
    App.startId = 's0';
    const per = Math.floor(nStates / (nBlocks + 1));
    for (let b = 0; b < nBlocks; b++) {
      const id = 'blk' + b;
      App.blocks.push({ id, name: 'B' + b, parent: null, entry: 's' + (b * per + 1), exits: [], x: b * 300, y: 900, w: null, h: null, collapsed: true });
      for (let i = b * per + 1; i < (b + 1) * per; i++) App.states[i].blockId = id;
    }
    context.invalidateViewGraph();
    App.selectedTransitions = new Set(App.transitions.map(t => t.id));
  };
  const time = (nStates, nBlocks) => {
    build(nStates, nBlocks);
    context.syncSelectionClasses();          // warm
    const t = Date.now();
    for (let i = 0; i < 3; i++) context.syncSelectionClasses();
    return Date.now() - t;
  };

  const plain = time(2000, 0);
  const withBlocks = time(2000, 8);
  // Wall-clock, and deliberately loose — it is here to catch a reintroduced walk
  // over the machine, not to pin a budget. The regression it guards was 88x.
  assert.ok(withBlocks <= Math.max(60, plain * 6),
    `selection with blocks (${withBlocks}ms) should not dwarf without (${plain}ms)`);
});
