import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Incremental rendering.
//
// renderAll() used to wipe #states-g and #trans-g and rebuild every node, which
// meant re-attaching every listener on every keystroke. It now diffs against
// the node registry in App.domCache, keyed by state id and by "from|to" for
// edges.
//
// The tests that matter here are about identity: that a node survives a render,
// that it stops surviving when its state is deleted, and that everything the
// old full rebuild used to set still ends up set. A renderer that draws the
// right picture by throwing everything away each time would pass a screenshot
// test and fail all of these.
const harness = createHarness();
const { context, getElement } = harness;
const { App } = context;

function machine({ states = 2, accepts = [], machineType = 'DFA' } = {}) {
  harness.resetApp();
  App.machine = machineType;
  for (let i = 0; i < states; i++) context.createState(i * 120, 0, `q${i}`);
  App.startId = App.states[0]?.id || null;
  accepts.forEach(i => App.accepts.add(App.states[i].id));
  context.renderAll();
}

const stateNode = i => App.domCache.states.get(App.states[i].id);
const edgeKey = (a, b) => `${App.states[a].id}|${App.states[b].id}`;
const edgeNode = (a, b) => App.domCache.transitions.get(edgeKey(a, b));
// There is no createTransition export — transitions are built inline by the
// transition modal — so tests construct the record directly, the same shape the
// rest of the suite uses.
function addTransition(fromIdx, toIdx, symbol) {
  const t = { id: context.newTId(), from: App.states[fromIdx].id, to: App.states[toIdx].id, symbol };
  App.transitions.push(t);
  return t;
}

const statesG = () => getElement('states-g');

// ── state nodes ───────────────────────────────────────────────────

test('a state node survives a re-render instead of being rebuilt', () => {
  machine({ states: 2 });
  const before = [stateNode(0), stateNode(1)];
  context.renderAll();
  assert.equal(stateNode(0), before[0]);
  assert.equal(stateNode(1), before[1]);
});

test('moving a state updates its circle without replacing the node', () => {
  machine({ states: 1 });
  const node = stateNode(0);
  App.states[0].x = 500;
  App.states[0].y = 250;
  context.renderAll();

  assert.equal(stateNode(0), node, 'node identity must be preserved');
  assert.equal(node.__parts.circle.getAttribute('cx'), 500);
  assert.equal(node.__parts.circle.getAttribute('cy'), 250);
});

test('deleting a state removes its node and forgets it', () => {
  machine({ states: 3 });
  const survivor = stateNode(0);
  const doomedId = App.states[2].id;

  App.states = App.states.slice(0, 2);
  context.renderAll();

  assert.equal(App.domCache.states.has(doomedId), false, 'registry must drop the deleted id');
  assert.equal(statesG().children.length, 2);
  assert.equal(stateNode(0), survivor, 'the surviving node is the original');
});

test('reordering states reorders the DOM without recreating nodes', () => {
  machine({ states: 3 });
  const [a, b, c] = [stateNode(0), stateNode(1), stateNode(2)];

  App.states.reverse();
  context.renderAll();

  assert.deepEqual(statesG().children, [c, b, a]);
  assert.equal(stateNode(0), c, 'still the same three nodes, in a new order');
});

test('an unchanged render performs no DOM moves', () => {
  machine({ states: 3 });
  const g = statesG();
  const childrenBefore = g.children.slice();
  let moves = 0;
  const realInsert = g.insertBefore.bind(g);
  g.insertBefore = (...args) => { moves++; return realInsert(...args); };

  context.renderAll();

  g.insertBefore = realInsert;
  assert.equal(moves, 0, 'nothing changed, so nothing should be reinserted');
  assert.deepEqual(g.children, childrenBefore);
});

test('re-rendering an unchanged machine allocates no elements or listeners', () => {
  machine({ states: 8 });
  for (let i = 0; i < 7; i++) addTransition(i, i + 1, 'a');
  context.renderAll();

  const created = [];
  const realCreate = document.createElementNS;
  document.createElementNS = (...a) => { created.push(a[1]); return realCreate.call(document, ...a); };
  try {
    context.renderAll();
    assert.deepEqual(created, [], 'an idle repaint should touch attributes only');

    // Moving a state changes where the labels sit, not what they say.
    App.states[0].x += 40;
    context.renderAll();
    assert.deepEqual(created, [], 'a move should reposition tspans rather than rebuild them');

    // Renaming does change the text, so exactly one tspan is expected.
    App.states[0].name = 'renamed';
    context.renderAll();
    assert.deepEqual(created, ['tspan']);
  } finally {
    document.createElementNS = realCreate;
  }
});

test('the accept ring appears and disappears with the accept mark', () => {
  machine({ states: 1 });
  const node = stateNode(0);
  assert.equal(node.__parts.ring, null);

  App.accepts.add(App.states[0].id);
  context.renderAll();
  assert.ok(node.__parts.ring, 'accepting state should gain a ring');
  assert.equal(node.classList.contains('acc-st'), true);

  App.accepts.clear();
  context.renderAll();
  assert.equal(node.__parts.ring, null, 'ring should be removed again');
  assert.equal(node.classList.contains('acc-st'), false);
});

test('selection classes follow App.selectedStates on re-render', () => {
  machine({ states: 2 });
  const node = stateNode(1);

  App.selectedStates.add(App.states[1].id);
  context.renderAll();
  assert.equal(node.classList.contains('sel-st'), true);

  App.selectedStates.clear();
  context.renderAll();
  assert.equal(node.classList.contains('sel-st'), false,
    'a stale sel-st would leave a state looking selected after the selection moved on');
});

test('start marker moves with App.startId', () => {
  machine({ states: 2 });
  assert.equal(stateNode(0).classList.contains('start-st'), true);

  App.startId = App.states[1].id;
  context.renderAll();
  assert.equal(stateNode(0).classList.contains('start-st'), false);
  assert.equal(stateNode(1).classList.contains('start-st'), true);
});

test('renaming a state rewrites its label', () => {
  machine({ states: 1 });
  const node = stateNode(0);
  App.states[0].name = 'accepting';
  context.renderAll();
  assert.equal(node.__parts.label.children.map(t => t.textContent).join(''), 'accepting');
});

test('the Moore output line is added and removed with the machine type', () => {
  machine({ states: 1, machineType: 'Moore' });
  App.states[0].output = '1';
  context.renderAll();
  const node = stateNode(0);
  assert.ok(node.__parts.sub, 'Moore states carry an output line');
  assert.equal(node.__parts.sub.textContent, '1');

  App.machine = 'DFA';
  context.renderAll();
  assert.equal(node.__parts.sub, null, 'the output line goes when the machine is no longer a Moore machine');
});

test('a parity priority uses a dedicated badge separate from the state label', () => {
  machine({ states: 1, machineType: 'DPA' });
  App.states[0].priority = 3;
  context.renderAll();
  const node = stateNode(0);
  assert.ok(node.__parts.priority, 'a parity state carries its priority in a badge');
  assert.equal(node.__parts.priority.text.textContent, '3');

  // Switching to an ω-type without priorities retires the slot, exactly as
  // leaving Moore does.
  App.machine = 'DBA';
  context.renderAll();
  assert.equal(node.__parts.priority, null, 'Büchi has no per-state number to show');
});

// ── edge nodes ────────────────────────────────────────────────────

test('an edge node survives a re-render', () => {
  machine({ states: 2 });
  addTransition(0, 1, 'a');
  context.renderAll();
  const before = edgeNode(0, 1);
  assert.ok(before);
  context.renderAll();
  assert.equal(edgeNode(0, 1), before);
});

test('deleting a transition removes its edge node and its label', () => {
  machine({ states: 2 });
  addTransition(0, 1, 'a');
  context.renderAll();
  const key = edgeKey(0, 1);
  const node = edgeNode(0, 1);
  const label = node.__parts.textEl;

  App.transitions = [];
  context.renderAll();

  assert.equal(App.domCache.transitions.has(key), false);
  assert.equal(node.parentNode, null, 'edge group detached');
  assert.equal(label.parentNode, null, 'its label lives in a separate layer and must be detached too');
});

test('adding a second symbol to an edge updates the label in place', () => {
  machine({ states: 2 });
  addTransition(0, 1, 'a');
  context.renderAll();
  const node = edgeNode(0, 1);
  const label = node.__parts.textEl;

  addTransition(0, 1, 'b');
  context.renderAll();

  assert.equal(edgeNode(0, 1), node, 'same edge, same node');
  assert.equal(node.__parts.textEl, label, 'same label element');
  assert.equal(label.children.length, 2, 'one tspan per transition in the group');
});

test('semantic pill labels are toggleable without replacing the edge node', () => {
  machine({ states: 2 });
  addTransition(0, 1, 'a');
  context.renderAll();
  const node = edgeNode(0, 1);
  const { textEl, pillEl } = node.__parts;
  assert.equal(textEl.style.display, '');
  assert.equal(pillEl.style.display, 'none');

  App.config.edgeLabelStyle = 'pills';
  context.renderAll();

  assert.equal(edgeNode(0, 1), node);
  assert.equal(textEl.style.display, 'none');
  assert.equal(pillEl.style.display, '');
  assert.equal(pillEl.children.length, 1);
  assert.equal(pillEl.children[0].children.length, 1);

  App.config.edgeLabelStyle = 'beginner';
  context.renderAll();
  assert.equal(pillEl.classList.contains('edge-pill-beginner'), true);
});

test('the curve handle exists only while the edge is selected', () => {
  machine({ states: 2 });
  const t = addTransition(0, 1, 'a');
  context.renderAll();
  const node = edgeNode(0, 1);
  assert.equal(node.__parts.handle, null);

  App.selectedTransitions.add(t.id);
  context.renderAll();
  assert.ok(node.__parts.handle, 'a selected edge shows its bend grip');

  App.selectedTransitions.clear();
  context.renderAll();
  assert.equal(node.__parts.handle, null);
});

test('a self-loop renders an arc and no curve handle even when selected', () => {
  machine({ states: 1 });
  const t = addTransition(0, 0, 'a');
  App.selectedTransitions.add(t.id);
  context.renderAll();

  const node = edgeNode(0, 0);
  assert.ok(node.__parts.pathEl.getAttribute('d').includes('A'), 'self-loops are drawn as an arc');
  assert.equal(node.__parts.handle, null, 'there is no control point to drag on a self-loop');
});

test('the start arrow is reused and repositioned, not recreated', () => {
  machine({ states: 2 });
  const arrow = App.domCache.startArrow;
  assert.ok(arrow);

  App.states[0].x = 400;
  context.renderAll();
  assert.equal(App.domCache.startArrow, arrow, 'same element');
  assert.ok(arrow.getAttribute('d').includes('400') || arrow.getAttribute('d').includes('3'),
    'its path should have been rewritten for the new position');

  App.startId = null;
  context.renderAll();
  assert.equal(App.domCache.startArrow, null, 'no start state, no arrow');
});

test('edge listeners resolve current transitions rather than a captured group', () => {
  machine({ states: 2 });
  const first = addTransition(0, 1, 'a');
  context.renderAll();
  const node = edgeNode(0, 1);

  // Replace the transition behind this edge. A listener that closed over the
  // group built during the first render would still be pointing at `first`.
  App.transitions = [];
  const second = addTransition(0, 1, 'b');
  context.renderAll();

  assert.equal(edgeNode(0, 1), node, 'the edge node is reused across the swap');
  App.tool = 'pointer';
  node._listeners.pointerdown({
    button: 0, stopPropagation() {}, preventDefault() {}, pointerType: 'mouse'
  });
  assert.equal(App.selectedTransitions.has(second.id), true, 'selects the transition that exists now');
  assert.equal(App.selectedTransitions.has(first.id), false, 'not the one captured at creation time');
});
