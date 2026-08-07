import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Harel superstates — the containment half of hierarchy.
//
// The claim this file exists to pin down is that containment adds NO power:
// every machine drawn with regions denotes a finite automaton, and
// flattenComponent produces it. So most of these tests are of the form "the
// nested picture and the flat picture accept the same words", which is the only
// statement that would actually break if the semantics drifted.

function build(h, { states, transitions, startId, accepts }) {
  const { App } = h.context;
  App.machine = 'HSM';
  App.states = states;
  App.transitions = transitions || [];
  App.startId = startId || null;
  App.accepts = new Set(accepts || []);
  return App;
}

// A region R containing a and b, plus an outside state t.
function region(h) {
  return build(h, {
    states: [
      { id: 'R', x: 200, y: 200, name: 'Combat', super: true, initial: 'a' },
      { id: 'a', x: 140, y: 200, name: 'approach', parent: 'R' },
      { id: 'b', x: 260, y: 200, name: 'strike', parent: 'R' },
      { id: 't', x: 500, y: 200, name: 'flee' }
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b', symbol: 'x' },
      { id: 't2', from: 'R', to: 't', symbol: 'hurt' },
      { id: 't3', from: 't', to: 'R', symbol: 'calm' }
    ],
    startId: 'a',
    accepts: ['t']
  });
}

// ── the tree ──

test('childIndex groups by parent and treats a dangling parent as top-level', () => {
  const h = createHarness();
  const states = [
    { id: 'R', name: 'R', super: true },
    { id: 'a', name: 'a', parent: 'R' },
    { id: 'z', name: 'z', parent: 'ghost' }
  ];
  const idx = h.context.childIndex(states);
  assert.deepEqual(idx.get('R').map(s => s.id), ['a']);
  assert.deepEqual(idx.get('').map(s => s.id), ['R', 'z'],
    'a parent that no longer exists degrades to no parent, rather than losing the state');
});

test('ancestorsOf walks outward and survives a hand-written cycle', () => {
  const h = createHarness();
  const ok = [
    { id: 'A', name: 'A', super: true },
    { id: 'B', name: 'B', super: true, parent: 'A' },
    { id: 'c', name: 'c', parent: 'B' }
  ];
  assert.deepEqual(h.context.ancestorsOf('c', ok), ['B', 'A']);

  const looped = [
    { id: 'A', name: 'A', super: true, parent: 'B' },
    { id: 'B', name: 'B', super: true, parent: 'A' }
  ];
  // The UI cannot build this; a hand-edited .json can, and without the guard
  // every walk in the module hangs instead of reporting anything.
  assert.deepEqual(h.context.ancestorsOf('A', looped), ['B']);
});

test('leavesUnder resolves a leaf to itself and a region to its contents', () => {
  const h = createHarness();
  const App = region(h);
  assert.deepEqual(h.context.leavesUnder('a', App.states), ['a']);
  assert.deepEqual(h.context.leavesUnder('R', App.states), ['a', 'b']);
});

test('defaultEntry follows `initial`, falls back to the first child, and descends', () => {
  const h = createHarness();
  const App = region(h);
  assert.equal(h.context.defaultEntry('R', App.states), 'a');

  App.states[0].initial = 'b';
  assert.equal(h.context.defaultEntry('R', App.states), 'b');

  delete App.states[0].initial;
  assert.equal(h.context.defaultEntry('R', App.states), 'a', 'document order stands in');

  // Nested: entering the outer region has to keep descending to a real state.
  App.states.push({ id: 'S', x: 0, y: 0, name: 'inner', super: true, parent: 'R', initial: 'd' });
  App.states.push({ id: 'd', x: 0, y: 0, name: 'd', parent: 'S' });
  App.states[0].initial = 'S';
  assert.equal(h.context.defaultEntry('R', App.states), 'd');
});

test('an empty region is a leaf, so it behaves like an ordinary state', () => {
  const h = createHarness();
  const App = build(h, { states: [{ id: 'R', x: 0, y: 0, name: 'R', super: true }] });
  assert.deepEqual(h.context.leavesUnder('R', App.states), ['R']);
  assert.equal(h.context.defaultEntry('R', App.states), 'R');
  const issues = h.context.validateSuperstates(App);
  assert.ok(issues.some(i => /empty/.test(i.message)));
});

// ── flattening ──

test('an arrow out of a region becomes one arrow per state inside it', () => {
  const h = createHarness();
  const App = region(h);
  const flat = h.context.flattenComponent(App);

  const hurt = flat.transitions.filter(t => t.symbol === 'hurt');
  assert.deepEqual(hurt.map(t => t.from).sort(), ['a', 'b'],
    'the whole point: one drawn arrow, two real ones');
  assert.ok(hurt.every(t => t.to === 't'));
  assert.equal(flat.expanded, 1, 'one extra arrow over what was drawn');
});

test('an arrow into a region lands on its default entry', () => {
  const h = createHarness();
  const App = region(h);
  const flat = h.context.flattenComponent(App);
  const calm = flat.transitions.find(t => t.symbol === 'calm');
  assert.equal(calm.to, 'a');

  App.states[0].initial = 'b';
  assert.equal(h.context.flattenComponent(App).transitions.find(t => t.symbol === 'calm').to, 'b');
});

test('flattening drops the regions and keeps every leaf id unchanged', () => {
  const h = createHarness();
  const App = region(h);
  const flat = h.context.flattenComponent(App);
  assert.deepEqual(flat.states.map(s => s.id).sort(), ['a', 'b', 't']);
  // Identity of the leaves is what lets the simulator highlight the real nodes
  // rather than needing a map back from synthesised ones.
  assert.ok(flat.states.every(s => s.parent === undefined && s.super === undefined));
});

test('marking a region accepting accepts everything inside it', () => {
  const h = createHarness();
  const App = region(h);
  App.accepts = new Set(['R']);
  const flat = h.context.flattenComponent(App);
  assert.deepEqual(flat.accepts.sort(), ['a', 'b']);
});

test('starting in a region starts at its default entry', () => {
  const h = createHarness();
  const App = region(h);
  App.startId = 'R';
  assert.equal(h.context.flattenComponent(App).startId, 'a');
});

test('expansion does not duplicate an arrow a leaf already had', () => {
  const h = createHarness();
  const App = region(h);
  // 'a' already flees on hurt; the region's arrow says so too.
  App.transitions.push({ id: 't4', from: 'a', to: 't', symbol: 'hurt' });
  const flat = h.context.flattenComponent(App);
  assert.equal(flat.transitions.filter(t => t.symbol === 'hurt').length, 2);
});

test('a machine with no nesting flattens to a copy of itself', () => {
  const h = createHarness();
  const App = build(h, {
    states: [{ id: 'a', x: 0, y: 0, name: 'a' }, { id: 'b', x: 0, y: 0, name: 'b' }],
    transitions: [{ id: 't1', from: 'a', to: 'b', symbol: 'x' }],
    startId: 'a', accepts: ['b']
  });
  const flat = h.context.flattenComponent(App);
  assert.equal(flat.expanded, 0);
  assert.deepEqual(flat.transitions, App.transitions);
  assert.notEqual(flat.states[0], App.states[0], 'a copy, so callers may mutate it');
});

test('nested regions expand through both levels at once', () => {
  const h = createHarness();
  const App = build(h, {
    states: [
      { id: 'A', x: 0, y: 0, name: 'A', super: true, initial: 'B' },
      { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A', initial: 'p' },
      { id: 'p', x: 0, y: 0, name: 'p', parent: 'B' },
      { id: 'q', x: 0, y: 0, name: 'q', parent: 'B' },
      { id: 'r', x: 0, y: 0, name: 'r', parent: 'A' },
      { id: 'out', x: 0, y: 0, name: 'out' }
    ],
    transitions: [{ id: 't1', from: 'A', to: 'out', symbol: 'e' }],
    startId: 'A'
  });
  const flat = h.context.flattenComponent(App);
  assert.deepEqual(flat.transitions.map(t => t.from).sort(), ['p', 'q', 'r']);
  assert.equal(flat.startId, 'p', 'two default entries deep');
});

// ── geometry ──

test('a region is sized from its children, not from a stored width', () => {
  const h = createHarness();
  const App = region(h);
  const rects = h.context.superstateRects(App.states);
  const r = rects.get('R');
  const { pad, head } = App.config.superstate;
  const { R: radius } = h.context;
  assert.equal(r.x, 140 - radius - pad);
  assert.equal(r.y, 200 - radius - pad - head, 'the title band sits above the contents');
  assert.equal(r.w, (260 - 140) + 2 * radius + pad * 2);
  assert.ok(!rects.has('a'), 'plain states have no rect');
});

test('excluding the state being dragged is what lets it leave its region', () => {
  const h = createHarness();
  const App = region(h);
  const full = h.context.superstateRects(App.states).get('R');
  const dragging = h.context.superstateRects(App.states, { exclude: new Set(['b']) }).get('R');
  assert.ok(dragging.w < full.w,
    'measured with the dragged state still in it, the region would follow it forever');
});

test('an empty region gets a minimum size around its own position', () => {
  const h = createHarness();
  const App = build(h, { states: [{ id: 'R', x: 50, y: 60, name: 'R', super: true }] });
  const r = h.context.superstateRects(App.states).get('R');
  assert.equal(r.w, App.config.superstate.minW);
  assert.equal(r.x + r.w / 2, 50);
  assert.equal(r.y + r.h / 2, 60);
});

test('containerAt picks the deepest region and never the set being dragged', () => {
  const h = createHarness();
  const App = build(h, {
    states: [
      { id: 'A', x: 0, y: 0, name: 'A', super: true },
      { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A' },
      { id: 'p', x: 300, y: 300, name: 'p', parent: 'B' },
      { id: 'far', x: 900, y: 900, name: 'far' }
    ]
  });
  const rects = h.context.refreshSuperRects(App.states);
  assert.equal(h.context.containerAt({ x: 300, y: 300 }, App.states, rects), 'B');
  assert.equal(h.context.containerAt({ x: 300, y: 300 }, App.states, rects, new Set(['B'])), 'A',
    'dropping B somewhere must not offer B itself');
  assert.equal(h.context.containerAt({ x: 300, y: 300 }, App.states, rects, new Set(['A'])), null,
    'nor anything inside the thing being dragged');
  assert.equal(h.context.containerAt({ x: 900, y: 900 }, App.states, rects), null);
});

test('refreshSuperRects keeps x/y in step with the drawn rect', () => {
  const h = createHarness();
  const App = region(h);
  App.states[0].x = -9999;
  const rects = h.context.refreshSuperRects(App.states);
  const r = rects.get('R');
  assert.equal(App.states[0].x, r.x + r.w / 2,
    'the marquee, the minimap and autolayout all treat every node as a point');
  assert.equal(App.superRects.get('R'), r);
});

// ── editing ──

test('grouping moves the selection inside a new region and picks an entry', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'HSM';
  const a = h.context.createState(0, 0, 'a');
  const b = h.context.createState(100, 0, 'b');
  const r = h.context.groupIntoSuperstate([a.id, b.id]);

  assert.ok(r.super);
  assert.equal(a.parent, r.id);
  assert.equal(b.parent, r.id);
  assert.equal(r.initial, a.id, 'the start state is the natural default entry');
  assert.equal(r.x, 50, 'centred on what it contains');
});

test('grouping ignores members that are already inside another member', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'HSM';
  const a = h.context.createState(0, 0, 'a');
  const b = h.context.createState(100, 0, 'b');
  const inner = h.context.groupIntoSuperstate([a.id, b.id]);
  const outer = h.context.groupIntoSuperstate([inner.id, a.id]);

  assert.equal(inner.parent, outer.id);
  assert.equal(a.parent, inner.id, 'a stays one level down, not re-parented to the outer region');
});

test('ungrouping writes out the arrows the region stood for', () => {
  const h = createHarness();
  const App = region(h);
  const before = App.transitions.length;
  h.context.ungroupSuperstate('R');

  assert.ok(!App.states.some(s => s.id === 'R'));
  assert.equal(App.transitions.length, before + 1);
  const hurt = App.transitions.filter(t => t.symbol === 'hurt');
  assert.deepEqual(hurt.map(t => t.from).sort(), ['a', 'b']);
  assert.equal(App.transitions.find(t => t.symbol === 'calm').to, 'a');
  assert.ok(App.states.every(s => s.parent === undefined), 'the children rose one level');
});

test('ungrouping preserves the language exactly', () => {
  const h = createHarness();
  const App = region(h);
  const nested = h.context.flattenComponent(App);
  h.context.ungroupSuperstate('R');
  const dissolved = h.context.flattenComponent(App);

  const shape = m => ({
    startId: m.startId,
    accepts: [...m.accepts].sort(),
    transitions: m.transitions.map(t => `${t.from}-${t.symbol}->${t.to}`).sort()
  });
  assert.deepEqual(shape(dissolved), shape(nested));
});

test('ungrouping a region that was the start or an accept hands the role down', () => {
  const h = createHarness();
  const App = region(h);
  App.startId = 'R';
  App.accepts = new Set(['R']);
  h.context.ungroupSuperstate('R');
  assert.equal(App.startId, 'a');
  assert.deepEqual([...App.accepts].sort(), ['a', 'b']);
});

test('reparenting refuses to put a region inside itself', () => {
  const h = createHarness();
  const App = build(h, {
    states: [
      { id: 'A', x: 0, y: 0, name: 'A', super: true },
      { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A' },
      { id: 'p', x: 0, y: 0, name: 'p' }
    ]
  });
  assert.equal(h.context.reparentState('A', 'A'), false);
  assert.equal(h.context.reparentState('A', 'B'), false, 'B is inside A');
  assert.equal(h.context.reparentState('p', 'B'), true);
  assert.equal(App.states[2].parent, 'B');
});

test('a state leaving a region hands over the default entry it was holding', () => {
  const h = createHarness();
  const App = region(h);
  assert.equal(App.states[0].initial, 'a');
  h.context.reparentState('a', null);
  assert.equal(App.states[0].initial, 'b',
    'otherwise entering the region silently falls through to whatever is first');
});

test('subtreeIds is what a delete has to take with it', () => {
  const h = createHarness();
  const App = build(h, {
    states: [
      { id: 'A', x: 0, y: 0, name: 'A', super: true },
      { id: 'B', x: 0, y: 0, name: 'B', super: true, parent: 'A' },
      { id: 'p', x: 0, y: 0, name: 'p', parent: 'B' },
      { id: 'out', x: 0, y: 0, name: 'out' }
    ]
  });
  assert.deepEqual(h.context.subtreeIds('A', App.states).sort(), ['A', 'B', 'p']);
});

test('validate reports a region that is also a call site', () => {
  const h = createHarness();
  const App = build(h, {
    states: [{ id: 'R', x: 0, y: 0, name: 'R', super: true, callee: 'c9' }, { id: 'a', x: 0, y: 0, name: 'a', parent: 'R' }]
  });
  const issues = h.context.validateSuperstates(App);
  assert.ok(issues.some(i => i.level === 'error' && /region and a call site/.test(i.message)));
});
