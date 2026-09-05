// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// What a drilled-in view says about its own boundary.
//
// A port used to describe the block *record* — its `entry` and its `exits` —
// and the projection dropped every other edge that crossed the scope:
//
//     const from = owner.get(t.from), to = owner.get(t.to);
//     if (!from || !to) continue;
//
// `ownerMap` only ever walks *down* from the scope, so a state above it gets no
// entry at all and both ends of an outward edge were needed for it to be drawn.
// Four things were invisible from inside a block, and each is silent — the model
// stays perfectly consistent, so nothing anywhere raises:
//
//   * an edge to any level above the immediately enclosing one, at any depth
//   * an edge *into* a member that is not the declared entry
//   * an edge *out of* a state that is not a declared exit
//   * the second and later targets of a declared exit, because the tab rendered
//     `to[0]` and dropped the rest without saying so
//
// A port now describes the *wiring*. `entry`/`exits` are what a block declares;
// the crossings are what the machine does, and the two diverge the moment
// anyone draws an edge.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

const harness = createHarness();
const BLANK = '⊔';

// u, v at the top level; block B = {m1, m2}; block C = {c1, c2} inside B.
//
//   t1  u  -> m1   into B's declared entry
//   t2  u  -> m2   into B, past its entry
//   t3  c2 -> m2   out of C to its immediate parent            (N = 1)
//   t4  c2 -> v    out of C to the top level                   (N = 2)
//   t5  c1 -> u    out of C from a state that is not an exit   (N = 2)
function nested() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.states = [
    { id: 'u', name: 'u', x: 0, y: 0 },
    { id: 'v', name: 'v', x: 400, y: 0 },
    { id: 'm1', name: 'B/m1', x: 0, y: 200, blockId: 'B' },
    { id: 'm2', name: 'B/m2', x: 150, y: 200, blockId: 'B' },
    { id: 'c1', name: 'B/C/c1', x: 0, y: 400, blockId: 'C' },
    { id: 'c2', name: 'B/C/c2', x: 150, y: 400, blockId: 'C' }
  ];
  App.blocks = [
    { id: 'B', name: 'B', parent: null, entry: 'm1', exits: [{ id: 'm2', label: 'done' }], x: 200, y: 100 },
    { id: 'C', name: 'C', parent: 'B', entry: 'c1', exits: [{ id: 'c2', label: 'done' }], x: 200, y: 300 }
  ];
  App.startId = 'u';
  App.transitions = [
    { id: 't1', from: 'u', to: 'm1', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 'u', to: 'm2', symbol: 'b', write: 'b', dir: 'R' },
    { id: 't3', from: 'c2', to: 'm2', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't4', from: 'c2', to: 'v', symbol: 'b', write: 'b', dir: 'R' },
    { id: 't5', from: 'c1', to: 'u', symbol: 'a', write: 'a', dir: 'S' }
  ];
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  return App;
}

function at(scope) {
  context.App.scope = scope;
  context.invalidateViewGraph();
  return context.viewGraph();
}

const ports = g => g.states.filter(n => n.kind === 'port');
const port = (g, id) => ports(g).find(p => p.id === id);
const endsOf = p => (p.crossings || []).map(c => c.other).sort();

test('an edge to a grandparent gets a tab, where it used to get nothing', () => {
  // The case as it was described: a block at some depth sharing an edge with an
  // N-degree ancestor, N != 1. N = 1 always drew — it is an ordinary edge to a
  // node at the current level — and every N > 1 was dropped by the projection.
  nested();
  const g = at(['B', 'C']);
  const up = port(g, '__out__:x:c1');
  assert.ok(up, 'c1 leaves C for the top level, and now says so');
  assert.deepEqual(endsOf(up), ['u']);
  assert.equal(up.declared, false, 'c1 is not one of the declared exits');
});

test('how far up the other end is, is part of the label', () => {
  // "from u" is enough one level down and useless four levels down, where
  // "which level is u on?" is the whole question.
  nested();
  const g = at(['B', 'C']);
  assert.match(port(g, '__out__:x:c1').name, /↑2/, 'two levels out: the top level');
  assert.equal(port(g, '__out__:x:c1').crossings[0].hops, 2);

  const inB = at(['B']);
  const leaving = port(inB, '__out__:x:C');
  assert.equal(leaving.crossings.find(c => c.other === 'v').hops, 1,
    'from inside B the top level is one hop out, and carries no marker');
  assert.doesNotMatch(leaving.name, /↑/);
});

test('a crossing out of a nested block anchors on that block box', () => {
  // There is nothing else on screen to hang it from: the state it really leaves
  // is inside the box, and the box is what stands for it.
  nested();
  const g = at(['B']);
  const tab = port(g, '__out__:x:C');
  assert.ok(tab, 'the C box carries the crossings of everything inside it');
  assert.equal(tab.anchor, 'C');
  assert.deepEqual(endsOf(tab), ['u', 'v'], 'both of them, not just the first');
  assert.ok(g.transitions.some(t => t.port && t.from === 'C' && t.to === tab.id));
});

test('an edge into a member that is not the entry is drawn', () => {
  nested();
  const g = at(['B']);
  const declared = port(g, '__in__');
  assert.deepEqual(endsOf(declared), ['u']);
  assert.equal(declared.declared, true);

  const bypass = port(g, '__in__:m2');
  assert.ok(bypass, 'u reaches m2 directly, past the entry');
  assert.deepEqual(endsOf(bypass), ['u']);
  assert.equal(bypass.declared, false);
});

test('a declared exit names every target, not just the first', () => {
  // It rendered `to[0]`, so c2 reaching both m2 and v drew one tab reading
  // "done -> B/m2" and dropped v with nothing on screen to say it had.
  nested();
  const g = at(['B', 'C']);
  const out = port(g, '__out__:0:c2');
  assert.equal(out.declared, true);
  assert.deepEqual(endsOf(out), ['m2', 'v']);
  assert.match(out.name, /\+1/, 'and the tab says there is more than one');
});

test('a declared way in with nothing wired to it still draws, and says so', () => {
  // "Nothing arrives here" and "this is not the entry" must not look the same.
  nested();
  const g = at(['B', 'C']);
  const entry = port(g, '__in__');
  assert.ok(entry, 'C declares c1 as its entry and nothing reaches it yet');
  assert.deepEqual(entry.crossings, []);
  assert.equal(entry.role, 'ENTRY', 'the block declared a way in');
  assert.equal(entry.target, 'nothing yet', 'and nothing is wired to it');
});

test('a port keeps the id a hand-placed offset was stored under', () => {
  // Offsets live on the block record, keyed by port id. The entry keeps
  // `__in__` and a declared exit keeps `__out__:<i>:<state>`; only the tabs
  // that never existed before are new ids.
  const App = nested();
  App.blocks[0].ports = { __in__: { dx: -40, dy: 25 } };
  const g = at(['B']);
  const entry = port(g, '__in__');
  assert.equal(entry.manual, true);
  assert.equal(entry.dx, -40);
  assert.equal(entry.dy, 25);
});

test('two exits on one state are two tabs, and they do not sit on each other', () => {
  // A block may hand control back from one state under two labels — "yes" and
  // "no" out of the same comparison.
  const App = nested();
  App.blocks[1].exits = [{ id: 'c2', label: 'yes' }, { id: 'c2', label: 'no' }];
  context.invalidateBlockIndex();
  const g = at(['B', 'C']);
  const tabs = ports(g).filter(p => p.dir === 'out' && p.anchor === 'c2');
  assert.equal(tabs.length, 2);
  assert.notEqual(tabs[0].y, tabs[1].y, 'fanned apart before the placement search');
});

test('the top level is unchanged: no ports, and crossings drawn onto the box', () => {
  nested();
  const g = at([]);
  assert.deepEqual(ports(g), [], 'a boundary you are outside of needs no tabs');
  assert.deepEqual(
    [...new Set(g.transitions.map(t => `${t.from}|${t.to}`))].sort(),
    ['B|u', 'B|v', 'u|B']);
});

test('a machine with no blocks projects exactly as it always did', () => {
  harness.resetApp();
  const { App } = context;
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }, { id: 's2', name: 'q1', x: 100, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  const g = at([]);
  assert.equal(g.states.length, 2);
  assert.equal(g.transitions.length, 1);
  assert.equal(g.transitions[0], App.transitions[0], 'the model own object, not a proxy');
});

test('the arrow onto a box says how many of it bypass the entry', () => {
  // From outside, an edge into the block entry and one that lands in the middle
  // of the sub-machine are the same arrow. The group holds both, so saying
  // which is which costs a row rather than a channel.
  nested();
  at([]);
  const tip = context.edgeTipFor(context.viewEdgeGroup('u|B'));
  assert.match(tip, /^u → B/m, 'and it has a heading again — getState answers null for a box');
  assert.match(tip, /2 transitions, 1 not through B/);
  assert.match(tip, /B\/m2/);
});

test('an arrow whose transitions all go through the entry says that too', () => {
  const App = nested();
  App.transitions = App.transitions.filter(t => t.id !== 't2');
  at([]);
  const tip = context.edgeTipFor(context.viewEdgeGroup('u|B'));
  assert.match(tip, /1 transition, all through B/);
});

test('drilling in and back out moves nothing in the model', () => {
  // Scope is a camera. The tabs are derived from the wiring on every rebuild
  // and reach no serializer, so the boundary they describe is one the machine
  // already had.
  nested();
  const before = context.exportWorkspaceState();
  at(['B']); at(['B', 'C']); at([]);
  assert.deepEqual(context.exportWorkspaceState(), before);
});

// ── drawing a crossing ────────────────────────────────────────────

test('an edge drawn onto a box lands on the block entry, not on the box', () => {
  // The canvas click path passed a block id straight to openTransModal, which
  // wrote `to: "b1"` onto a real transition — an endpoint naming no state the
  // machine has, saved to the file, counted in the Transitions list and drawn
  // nowhere. The editor menus were narrowed to real states for this; the canvas
  // was the other half of it. Resolving rather than refusing, because while
  // drilled in there is otherwise no way to draw a crossing at all.
  nested();
  at([]);
  const { App } = context;
  App.tool = 'trans';
  context.onStateDown({ button: 0, stopPropagation() {} }, 'u');
  assert.equal(App.transFrom, 'u');
  context.onStateDown({ button: 0, stopPropagation() {} }, 'B');
  assert.equal(App._pendTo, 'm1', 'the entry — where control enters a block');
  assert.equal(App._pendFrom, 'u');
});

test('drawing from a box with one exit leaves from that exit', () => {
  nested();
  at([]);
  const { App } = context;
  App.tool = 'trans';
  App.transFrom = null;
  context.onStateDown({ button: 0, stopPropagation() {} }, 'B');
  assert.equal(App.transFrom, 'm2', 'the one declared exit');
});

test('a box with several exits is not guessed at', () => {
  // The wrong one is silent, so it says which they are and leaves the reader to
  // drill in and draw from the one they mean.
  const App = nested();
  App.blocks[0].exits = [{ id: 'm1', label: 'a' }, { id: 'm2', label: 'b' }];
  context.invalidateBlockIndex();
  at([]);
  App.tool = 'trans';
  App.transFrom = null;
  context.onStateDown({ button: 0, stopPropagation() {} }, 'B');
  assert.equal(App.transFrom, null, 'nothing started, and nothing written');
});

test('the mark on a half-drawn edge comes off the node it went on', () => {
  // `wireEndpoint` resolves a click on a box to that block's exit, so
  // App.transFrom is a state the current scope does not draw — while the mark
  // went on the box the reader clicked. Every one of the four places that takes
  // it off again passes App.transFrom, so it went on and could not come off,
  // and the box read as selected until something else repainted it.
  nested();
  at([]);
  const { App } = context;
  App.tool = 'trans';
  App.transFrom = null;
  context.renderAll();
  const box = context.App.domCache.states.get('B');
  assert.ok(box, 'the block is drawn as a box at this level');

  context.onStateDown({ button: 0, stopPropagation() {} }, 'B');
  assert.equal(App.transFrom, 'm2');
  assert.ok(box.classList.contains('sel-st'), 'the box carries the mark');

  context.onStateDown({ button: 0, stopPropagation() {} }, 'u');
  assert.ok(!box.classList.contains('sel-st'),
    'and the same node gives it back when the edge is finished');
});

test('a port is not something an edge can be drawn to', () => {
  nested();
  at(['B']);
  const { App } = context;
  App.tool = 'trans';
  App.transFrom = 'm1';
  App._pendTo = null;
  context.onStateDown({ button: 0, stopPropagation() {} }, '__in__');
  assert.equal(App.transFrom, 'm1', 'the gesture is untouched — a port is derived');
  assert.equal(App._pendTo, null, 'and no dialog opened for something not in the model');
});

// ── the drag path and the full render draw the same tab ───────────

test('every part of a tab moves together, on both paths that move it', () => {
  // The bug this is here for is the one CLAUDE.md already records twice, under
  // startArrowD() and slideBlockPreview(): a node drawn by a full render and
  // moved by `updateFastDOM` needs *one* function saying where its parts go, or
  // the two drift. movePortNode moved the body and the label and left the role
  // and the arrowhead behind, so the moment anything called updateFastDOM the
  // tab came apart on screen — box and one line at the new position, the other
  // line and the arrow stranded where the tab had last been fully drawn.
  nested();
  at(['B']);
  context.renderAll();

  const el = context.App.domCache.states.get('__in__');
  assert.ok(el, 'the tab was drawn');
  const read = () => ({
    body: [el.__parts.body.getAttribute('x'), el.__parts.body.getAttribute('y'),
      el.__parts.body.getAttribute('width'), el.__parts.body.getAttribute('height')],
    role: [el.__parts.role.getAttribute('x'), el.__parts.role.getAttribute('y')],
    label: [el.__parts.label.getAttribute('x'), el.__parts.label.getAttribute('y')]
  });
  const beforeDrag = read();

  // Move the anchor, then take each path in turn from the same starting state.
  const anchor = context.getState('m1');
  anchor.x += 240; anchor.y -= 90;
  context.invalidateViewGraph();
  context.updateFastDOM();
  const fast = read();
  assert.notDeepEqual(fast, beforeDrag, 'the drag path moved it');

  context.renderAll();
  assert.deepEqual(read(), fast,
    'and a full render puts every part exactly where the drag path did');
});

test('both rows sit inside the tab', () => {
  nested();
  at(['B']);
  context.renderAll();
  const el = context.App.domCache.states.get('__in__');
  const node = context.getNode('__in__');
  const y = Number(el.__parts.body.getAttribute('y'));
  const h = Number(el.__parts.body.getAttribute('height'));
  const roleY = Number(el.__parts.role.getAttribute('y'));
  const labelY = Number(el.__parts.label.getAttribute('y'));
  assert.ok(roleY > y && roleY < y + h, 'the role row is in the box');
  assert.ok(labelY > y && labelY < y + h, 'and so is the target row');
  assert.ok(labelY > roleY, 'in that order');
  assert.equal(Number(el.__parts.body.getAttribute('width')), node.box.w,
    'and the box is the width the projection sized it to');
});

test('a tab is as wide as what it says, within bounds', () => {
  // It was a flat 96px whatever the label, so every real state name ran clean
  // out of both ends of the box.
  nested();
  const g = at(['B']);
  for (const p of g.states.filter(n => n.kind === 'port')) {
    assert.ok(p.box.w >= context.PORT_MIN_W && p.box.w <= context.PORT_MAX_W, p.id);
    assert.ok(p.box.w >= p.target.length * 4, `${p.id} is too narrow for "${p.target}"`);
  }
});

// ── a tab is draggable wherever it hangs ──────────────────────────

test('a tab on a nested block box can be dragged, like one on a state', () => {
  // The drag resolved its anchor with `getState`, which answers null for a
  // block box — so a tab attached to a nested block silently would not move.
  // No error, no cursor change, nothing to see except a control that ignores
  // you, which is the worst way for this to fail.
  nested();
  at(['B']);
  const { App } = context;
  const tab = context.getNode('__out__:x:C');
  assert.ok(tab, 'the C box carries a tab');
  assert.equal(tab.anchor, 'C', 'anchored on the box, not on a state');

  context.onPortDown({ button: 0, stopPropagation() {}, pointerId: 1,
    clientX: tab.x, clientY: tab.y }, tab.id);
  assert.ok(App.dragPort, 'the gesture started');
  assert.equal(App.dragPort.id, tab.id);
});

test('a tab on a state still drags, and writes its offset to the record', () => {
  nested();
  at(['B']);
  const { App } = context;
  const tab = context.getNode('__in__');
  context.onPortDown({ button: 0, stopPropagation() {}, pointerId: 1,
    clientX: tab.x, clientY: tab.y }, tab.id);
  assert.ok(App.dragPort);
  assert.equal(App.dragPort.block, 'B', 'stored on the block the scope names');
});

test('a hand-set offset survives on a block-anchored tab too', () => {
  const App = nested();
  App.blocks[0].ports = { '__out__:x:C': { dx: 60, dy: -40 } };
  context.invalidateBlockIndex();
  const g = at(['B']);
  const tab = g.states.find(n => n.id === '__out__:x:C');
  assert.equal(tab.manual, true);
  const box = context.getNode('C');
  assert.equal(tab.x, box.x + 60, 'placed relative to the box it hangs off');
  assert.equal(tab.y, box.y - 40);
});

// ── clicking a tab follows the crossing ───────────────────────────
//
// Which generalises "go back out" rather than replacing it: when the other end
// is on the level immediately outside — the only case that used to draw a tab
// at all — going to its scope *is* going out one level. What it adds is the
// case a fixed up-one cannot serve.

const clickNode = id => {
  const el = context.App.domCache.states.get(id);
  assert.ok(el, `${id} is drawn`);
  const handler = (el._listeners || {}).click;
  assert.ok(handler, `${id} has a click handler`);
  handler({ stopPropagation() {} });
};

test('following a crossing goes where the edge goes, not just up one', () => {
  nested();
  at(['B', 'C']);
  context.renderAll();
  const g = context.viewGraph();
  const far = g.states.find(n =>
    n.kind === 'port' && (n.crossings || []).some(c => c.other === 'u'));
  assert.ok(far, 'the crossing to the top level has a tab');
  assert.match(far.target, /↑2/, 'and says how far out it goes');

  clickNode(far.id);
  assert.deepEqual(context.App.scope, [], 'two levels out, where the edge actually lands');
  assert.deepEqual([...context.App.selectedStates], ['u'], 'and the state it lands on is selected');
});

test('following a one-level crossing is the old go-back-out, unchanged', () => {
  nested();
  at(['B', 'C']);
  context.renderAll();
  const g = context.viewGraph();
  const near = g.states.find(n =>
    n.kind === 'port' && (n.crossings || []).some(c => c.other === 'm2'));
  clickNode(near.id);
  assert.deepEqual(context.App.scope, ['B']);
  assert.deepEqual([...context.App.selectedStates], ['m2']);
});

test('a tab with nothing wired to it still means out', () => {
  // A declared way in or out that nobody has wired yet: there is no crossing to
  // follow, and "out" is what the boundary it sits on means.
  nested();
  at(['B', 'C']);
  context.renderAll();
  clickNode('__in__');
  assert.deepEqual(context.App.scope, ['B'], 'up one, as it always did');
});
