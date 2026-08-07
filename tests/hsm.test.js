import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Superstates end to end: what the renderer draws, what a drop does, what a run
// does, and the pair of conversions that walks the same picture across the
// REG/CFL boundary.
//
// The single most valuable assertion in this file is the last group's: inlining
// a recursive component is REFUSED. That refusal is not a missing feature — it
// is the whole reason the two families are different, showing up as an error
// message.

const harness = createHarness();
const { context, getElement } = harness;
const { App } = context;

// `render` is opt-in: two thirds of the cases below are about the flattening,
// the simulator or the REG⇄CFL toggle, none of which touch the DOM. Painting
// for them is work no assertion reads.
function guardAI({ machineType = 'HSM', render = false } = {}) {
  harness.resetApp();
  App.machine = machineType;
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
  App.stateN = 20;
  App.transN = 20;
  context.ensureRootComponent();
  if (render) context.renderAll();
  else context.refreshSuperRects(App.states);
}

// A drag that is never finished leaves App.dragOffsets and canvas.js's
// dropTargetId set. resetApp() clears both, but the tests below say so
// explicitly at the point they finish with them, so a failure in one of them
// cannot present as a mystery in the next.
function endDrag() {
  context.clearDropTarget();
  App.dragOffsets = null;
}

const superNode = id => App.domCache.supers.get(id);

// ── rendering ─────────────────────────────────────────────────────

test('a region renders in its own layer, not as a state node', () => {
  guardAI({ render: true });
  assert.ok(superNode('R'), 'the container is drawn');
  assert.equal(App.domCache.states.get('R'), undefined,
    'and not also drawn as a circle in #states-g');
  assert.equal(getElement('supers-g').childNodes.length, 1);
  assert.equal(App.domCache.states.size, 3, 'the three leaves');
});

test('grouping evicts the circle the state used to have', () => {
  harness.resetApp();
  App.machine = 'HSM';
  const a = context.createState(0, 0, 'a');
  context.createState(120, 0, 'b');
  context.renderAll();
  const circle = App.domCache.states.get(a.id);
  assert.ok(circle, 'a plain state starts life in #states-g');

  const r = context.groupIntoSuperstate([a.id]);
  context.renderAll();
  assert.equal(App.domCache.states.get(r.id), undefined);
  assert.ok(superNode(r.id));
  assert.equal(App.domCache.states.get(a.id), circle, 'the member keeps its node');
});

test('ungrouping removes the container node and restores the states layer', () => {
  guardAI({ render: true });
  context.ungroupSuperstate('R');
  context.renderAll();
  assert.equal(superNode('R'), undefined);
  assert.equal(getElement('supers-g').childNodes.length, 0);
  assert.equal(App.domCache.states.size, 3);
});

test('an arrow into a region stops at the container border, not at a radius', () => {
  guardAI({ render: true });
  const rect = App.superRects.get('R');
  const edge = App.domCache.transitions.get('t|R');
  assert.ok(edge, 'the edge to the region exists');
  // Straight or curved, the last coordinate pair is where the arrowhead lands.
  const nums = edge.__parts.pathEl.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
  const endX = nums[nums.length - 2];
  // Coming in from the right, so it should land on the region's right edge —
  // a long way outside the R-radius circle a plain state would have had.
  const border = rect.x + rect.w;
  assert.ok(Math.abs(endX - border) < 12,
    `arrow ended at ${endX}, expected the border near ${border}`);
  assert.ok(border - App.states[0].x > context.R,
    'and the border really is further out than a circle would be');
});

test('the container is sized around its contents and follows them', () => {
  guardAI({ render: true });
  const before = App.superRects.get('R').w;
  App.states.find(s => s.id === 'b').x += 200;
  context.renderAll();
  assert.ok(App.superRects.get('R').w > before, 'moving a child resizes its region');
});

// ── drag and drop ─────────────────────────────────────────────────

test('dragging a region carries what it contains', () => {
  guardAI({ render: true });
  App.selectedStates = new Set(['R']);
  context.onStateDown({ button: 0, clientX: 0, clientY: 0, pointerId: 1, stopPropagation() {} }, 'R');
  assert.deepEqual(Object.keys(App.dragOffsets).sort(), ['R', 'a', 'b'],
    'the contents move with the container even though they were never selected');
  endDrag();
});

test('a drop resolves the deepest region under the pointer and reparents', () => {
  guardAI({ render: true });
  App.dragOffsets = { t: { x: 0, y: 0 } };
  const inside = { x: App.states[0].x, y: App.states[0].y };
  context.updateDropTarget(inside);
  assert.equal(context.dropTargetId, 'R');

  context.commitDropTarget();
  assert.equal(App.states.find(s => s.id === 't').parent, 'R');
  assert.equal(context.dropTargetId, null, 'the highlight is cleared on commit');
  endDrag();
});

test('a region being dragged is measured without its own drop candidates', () => {
  guardAI({ render: true });
  // Dragging 'b' out: the region must not keep stretching to follow it.
  App.dragOffsets = { b: { x: 0, y: 0 } };
  const wide = App.superRects.get('R').w;
  App.states.find(s => s.id === 'b').x = 2000;
  context.renderAll();
  assert.ok(App.superRects.get('R').w <= wide,
    'a state defining the boundary could otherwise never leave it');
  endDrag();
});

// ── simulation ────────────────────────────────────────────────────

// Straight to the simulator: runSim() reads the DOM input box, which is not
// what any of this is about.
function run(word) {
  return context.simRSM(word === '' ? [] : word.split(' ')).accepted;
}

test('the region\'s single arrow fires from every state inside it', () => {
  guardAI();
  // Reachable only if `hurt` works from `strike` as well as from `approach`.
  assert.equal(run('x hurt'), true, 'from the second state in the region');
  assert.equal(run('hurt'), true, 'and from the first');
});

test('an HSM run needs no call stack, and the tracker does not show one', () => {
  guardAI();
  run('hurt');
  assert.ok(App.simSteps.length);
  assert.ok(App.simSteps.every(s => s.callStack === null),
    'a machine that never calls anything has nothing to stack');
});

test('running highlights the arrow the user drew, not the synthesised copy', () => {
  guardAI();
  run('hurt');
  const drawn = new Set(App.transitions.map(t => t.id));
  const used = App.simSteps.map(s => s.tid).filter(Boolean);
  assert.ok(used.length);
  assert.ok(used.every(id => drawn.has(id)),
    'flattening renumbers every transition, so highlighting has to follow `origin` back');
});

test('a nested machine and its flattening accept exactly the same words', () => {
  const words = ['', 'x', 'hurt', 'x hurt', 'hurt calm', 'hurt calm x hurt', 'calm'];
  guardAI();
  const nested = words.map(run);
  guardAI();
  context.ungroupSuperstate('R');
  const flat = words.map(run);
  assert.deepEqual(flat, nested);
});

// ── export ────────────────────────────────────────────────────────

test('the IR exports the finite automaton the regions denote', () => {
  guardAI();
  const ir = context.buildMachineIR();
  assert.equal(ir.sourceMachine, 'HSM');
  assert.equal(ir.compiledFrom, 'HSM');
  assert.equal(ir.machine, 'NFA', 'no ε in this one');
  assert.deepEqual(ir.states.map(s => s.id).sort(), ['a', 'b', 't']);
  assert.equal(ir.transitions.filter(t => t.symbol === 'hurt').length, 2);
});

// ── the REG ⇄ CFL toggle ──────────────────────────────────────────

test('extracting a region turns it into a call site and moves the contents out', () => {
  guardAI({ machineType: 'RSM' });
  assert.equal(context.extractRegionToSubmachine('R'), true);

  const box = App.states.find(s => s.id === 'R');
  assert.ok(box.callee, 'the node kept its id and became a box');
  assert.equal(box.super, undefined);
  assert.deepEqual(App.states.map(s => s.id).sort(), ['R', 't'], 'the contents left this canvas');

  const c = context.getComponent(box.callee);
  assert.deepEqual(c.states.map(s => s.id).sort(), ['a', 'b']);
  assert.equal(c.startId, 'a', 'the default entry became the component start');
  // The arrow was drawn on the region, so it fired from anywhere inside — which
  // after extraction means every state has to be able to return.
  assert.deepEqual([...c.accepts].sort(), ['a', 'b']);
  assert.equal(App.startId, 'R', 'the machine now starts by calling the sub-machine');
  assert.ok(c.states.every(s => s.parent === undefined));
});

test('extraction preserves the language', () => {
  const words = ['', 'x', 'hurt', 'x hurt', 'hurt calm hurt'];
  guardAI({ machineType: 'RSM' });
  const before = words.map(run);
  guardAI({ machineType: 'RSM' });
  context.extractRegionToSubmachine('R');
  const after = words.map(run);
  assert.deepEqual(after, before);
});

test('inlining a sub-machine turns it back into a region', () => {
  guardAI({ machineType: 'RSM' });
  context.extractRegionToSubmachine('R');
  assert.equal(context.inlineSubmachineAsRegion('R'), true);

  const region = App.states.find(s => s.id === 'R');
  assert.ok(region.super);
  assert.equal(region.callee, undefined);
  assert.equal(App.states.filter(s => s.parent === 'R').length, 2);
  assert.equal(App.components.length, 1, 'the component had one call site, so it is gone');
});

test('extract then inline is a round trip on the language', () => {
  const words = ['', 'x', 'hurt', 'x hurt', 'hurt calm x hurt'];
  guardAI({ machineType: 'RSM' });
  const before = words.map(run);
  guardAI({ machineType: 'RSM' });
  context.extractRegionToSubmachine('R');
  context.inlineSubmachineAsRegion('R');
  assert.deepEqual(words.map(run), before);
});

test('inlining a RECURSIVE component is refused — that refusal is the boundary', () => {
  harness.resetApp();
  App.machine = 'RSM';
  App.sigma = new Set(['(', ')']);
  const s1 = context.createState(0, 0, 'start');
  const s2 = context.createState(200, 0, 'inner');
  App.accepts.add(s1.id);
  context.ensureRootComponent();
  context.promoteToSubmachine(s2.id, 'S');
  // Make S call itself: the component's own canvas gets a box back into it.
  const c = context.getComponent(s2.callee);
  const inner = { id: 'z1', x: 0, y: 0, name: 'again', callee: c.id };
  c.states = [inner];
  c.startId = 'z1';
  c.accepts = ['z1'];

  assert.ok(context.recursiveComponents().has(c.id), 'S really does reach itself');
  assert.equal(context.inlineSubmachineAsRegion(s2.id), false);
  assert.ok(App.states.find(x => x.id === s2.id).callee, 'it is still a call site');
});

test('a shared component survives inlining one of its call sites', () => {
  harness.resetApp();
  App.machine = 'RSM';
  App.sigma = new Set(['a']);
  const one = context.createState(0, 0, 'one');
  const two = context.createState(300, 0, 'two');
  context.ensureRootComponent();
  context.promoteToSubmachine(one.id, 'Shared');
  two.callee = one.callee;
  const c = context.getComponent(one.callee);
  c.states = [{ id: 'w1', x: 0, y: 0, name: 'w', callee: undefined }];
  c.startId = 'w1';
  c.accepts = ['w1'];

  assert.equal(context.inlineSubmachineAsRegion(one.id), true);
  assert.ok(App.components.some(x => x.id === c.id), 'the other call site still needs it');
  assert.equal(App.states.find(s => s.id === two.id).callee, c.id);
  assert.notEqual(App.states.find(s => s.parent === one.id).id, 'w1',
    'the inlined copy has fresh ids, so it cannot be stolen from the other caller');
});

test('promoting a region is refused in favour of extracting it', () => {
  guardAI({ machineType: 'RSM' });
  assert.equal(context.promoteToSubmachine('R'), false);
  assert.ok(App.states.find(s => s.id === 'R').super);
});

// ── deletion ──────────────────────────────────────────────────────

test('deleting a region takes its contents with it', () => {
  guardAI();
  context.deleteState('R');
  assert.deepEqual(App.states.map(s => s.id), ['t']);
  assert.equal(App.transitions.length, 0, 'and every arrow that touched them');
});
