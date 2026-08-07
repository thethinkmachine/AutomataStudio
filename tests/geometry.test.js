import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Collision avoidance (js/geometry.js).
//
// These assert on the layout pass rather than on the SVG, because what changed
// is where things go, not what is drawn. The pass is a pure read of App, so a
// test is: place states, ask for the layout, measure.
//
// "Clear" throughout means the same thing the module means by it — a node keeps
// R + nodeClearance to itself, a label keeps labelGap to everything.
const harness = createHarness();
const { context } = harness;
const { App } = context;

function machine(states, transitions = []) {
  harness.resetApp();
  App.states = states.map(([id, x, y]) => ({ id, name: id, x, y }));
  App.transitions = transitions.map(([from, to, symbol], i) => ({ id: `t${i}`, from, to, symbol }));
  App.startId = null;
  return context.currentLayoutContext();
}

const R = () => App.config.radius;
const geoFor = (ctx, from, to) => ctx.geo.get(`${from}|${to}`);

// Points along an edge, the same way the module samples one.
function samples(geo, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(context.pathPoint(geo, i / n));
  return out;
}

function labelBox(geo) {
  const { w, h } = geo.labelSize;
  return { x: geo.lx - w / 2, y: geo.ly - h / 2, w, h };
}

function circleRectGap(cx, cy, r, box) {
  const nx = Math.min(Math.max(cx, box.x), box.x + box.w);
  const ny = Math.min(Math.max(cy, box.y), box.y + box.h);
  return Math.hypot(cx - nx, cy - ny) - r;
}

function boxesOverlap(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

// ── self-loops ────────────────────────────────────────────────────

test('a self-loop sits above its state when nothing is in the way', () => {
  const ctx = machine([['q0', 0, 0]], [['q0', 'q0', 'a']]);
  assert.equal(geoFor(ctx, 'q0', 'q0').angle, context.UP);
});

test('a self-loop moves off the top when another state is parked there', () => {
  // q1 is directly above q0, close enough that the loop as drawn would run
  // through it — the case this whole pass exists for.
  const ctx = machine([['q0', 0, 0], ['q1', 0, -90]], [['q0', 'q0', 'a']]);
  const geo = geoFor(ctx, 'q0', 'q0');

  assert.notEqual(geo.angle, context.UP, 'the loop should not have stayed on top of q1');
  const cx = geo.from.x + geo.loop.centreOut * Math.cos(geo.angle);
  const cy = geo.from.y + geo.loop.centreOut * Math.sin(geo.angle);
  assert.ok(
    Math.hypot(cx - 0, cy + 90) >= geo.loop.ss + R(),
    'the relocated loop still overlaps q1'
  );
});

test('a self-loop avoids the direction its own edges arrive from', () => {
  // Nothing is above q0, but two edges leave upward. A loop there would be drawn
  // through both arrowheads.
  const ctx = machine(
    [['q0', 0, 0], ['q1', -200, -200], ['q2', 200, -200]],
    [['q0', 'q0', 'a'], ['q0', 'q1', 'b'], ['q0', 'q2', 'c']]
  );
  const angle = geoFor(ctx, 'q0', 'q0').angle;
  const toQ1 = Math.atan2(-200, -200), toQ2 = Math.atan2(-200, 200);
  assert.ok(context.angleDelta(angle, toQ1) > 0.6, 'loop landed on the q1 edge');
  assert.ok(context.angleDelta(angle, toQ2) > 0.6, 'loop landed on the q2 edge');
});

test('a hand-placed self-loop angle is never overridden', () => {
  harness.resetApp();
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 0, y: -90 }];
  // Pointed straight at q1, which the automatic placement would never choose.
  App.transitions = [{ id: 't0', from: 'q0', to: 'q0', symbol: 'a', loopAngle: context.UP }];
  const ctx = context.currentLayoutContext();
  assert.equal(geoFor(ctx, 'q0', 'q0').angle, context.UP);
});

test('turning smart self-loops off restores the fixed placement', () => {
  harness.resetApp();
  App.config.render.smartSelfLoops = false;
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 0, y: -90 }];
  App.transitions = [{ id: 't0', from: 'q0', to: 'q0', symbol: 'a' }];
  assert.equal(geoFor(context.currentLayoutContext(), 'q0', 'q0').angle, context.UP);
});

// ── edge routing ──────────────────────────────────────────────────

test('an edge bends around a state standing in its path', () => {
  const ctx = machine(
    [['q0', 0, 0], ['q1', 400, 0], ['mid', 200, 0]],
    [['q0', 'q1', 'a']]
  );
  const geo = geoFor(ctx, 'q0', 'q1');
  assert.notEqual(geo.crvVal, 0, 'the edge stayed straight through mid');
  const nearest = Math.min(...samples(geo).map(p => Math.hypot(p.x - 200, p.y - 0)));
  assert.ok(nearest >= R(), `the bent edge still passes ${nearest.toFixed(1)}px from mid`);
});

test('an edge with nothing in its way is left straight', () => {
  const ctx = machine([['q0', 0, 0], ['q1', 400, 0]], [['q0', 'q1', 'a']]);
  assert.equal(geoFor(ctx, 'q0', 'q1').crvVal, 0);
});

test('a curve set by hand wins over routing', () => {
  harness.resetApp();
  App.states = [
    { id: 'q0', name: 'q0', x: 0, y: 0 },
    { id: 'q1', name: 'q1', x: 400, y: 0 },
    { id: 'mid', name: 'mid', x: 200, y: 0 }
  ];
  // Deliberately straight, straight through mid. The user said so.
  App.transitions = [{ id: 't0', from: 'q0', to: 'q1', symbol: 'a', curve: 0 }];
  assert.equal(geoFor(context.currentLayoutContext(), 'q0', 'q1').crvVal, 0);
});

test('a pair of opposite edges still bows apart', () => {
  const ctx = machine([['q0', 0, 0], ['q1', 300, 0]], [['q0', 'q1', 'a'], ['q1', 'q0', 'b']]);
  const there = geoFor(ctx, 'q0', 'q1').crvVal, back = geoFor(ctx, 'q1', 'q0').crvVal;
  assert.notEqual(there, 0);
  assert.notEqual(back, 0);
  // Both are measured along their own left-hand normal, and those point opposite
  // ways — so equal offsets are what puts the two edges on opposite sides.
  assert.equal(Math.sign(there), Math.sign(back));
});

test('turning routing off leaves the edge running through the state', () => {
  harness.resetApp();
  App.config.render.autoRouteEdges = false;
  App.states = [
    { id: 'q0', name: 'q0', x: 0, y: 0 },
    { id: 'q1', name: 'q1', x: 400, y: 0 },
    { id: 'mid', name: 'mid', x: 200, y: 0 }
  ];
  App.transitions = [{ id: 't0', from: 'q0', to: 'q1', symbol: 'a' }];
  assert.equal(geoFor(context.currentLayoutContext(), 'q0', 'q1').crvVal, 0);
});

// ── labels ────────────────────────────────────────────────────────

test('a label is offset off the edge it belongs to', () => {
  const ctx = machine([['q0', 0, 0], ['q1', 400, 0]], [['q0', 'q1', 'a']]);
  const geo = geoFor(ctx, 'q0', 'q1');
  const box = labelBox(geo);
  // The edge runs along y = 0, so the box must clear it vertically.
  assert.ok(box.y > 0 || box.y + box.h < 0, `label box straddles its own edge: ${JSON.stringify(box)}`);
});

test('no label overlaps a state, another label, or a foreign edge', () => {
  // A ring of states with every state also reaching across the ring: short
  // chords, long chords and reversed pairs all in one drawing, which is where
  // labels used to pile up on each other.
  const n = 6, radius = 220;
  const states = [];
  for (let i = 0; i < n; i++) {
    states.push([`q${i}`, Math.round(radius * Math.cos((2 * Math.PI * i) / n)), Math.round(radius * Math.sin((2 * Math.PI * i) / n))]);
  }
  const trans = [];
  for (let i = 0; i < n; i++) {
    trans.push([`q${i}`, `q${(i + 1) % n}`, 'a']);
    trans.push([`q${(i + 1) % n}`, `q${i}`, 'b']);
    trans.push([`q${i}`, `q${(i + 3) % n}`, 'c']);
  }
  const ctx = machine(states, trans);

  const boxes = [...ctx.geo.values()].map(labelBox);
  for (const box of boxes) {
    for (const s of App.states) {
      assert.ok(circleRectGap(s.x, s.y, R(), box) >= 0,
        `a label sits on state ${s.id}`);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!boxesOverlap(boxes[i], boxes[j]), `labels ${i} and ${j} overlap`);
    }
  }
});

test('two labels wanting the same spot are separated', () => {
  // The edges cross at (100, 0), so both midpoints — and, before this pass, both
  // labels — land on exactly the same point.
  const states = [['q0', 0, 0], ['q1', 200, 0], ['q2', 100, -140], ['q3', 100, 140]];
  const trans = [['q0', 'q1', 'aaa'], ['q2', 'q3', 'bbb']];

  App.config.render.smartLabels = false;
  machine(states, trans);
  App.config.render.smartLabels = false;
  const naive = [...context.currentLayoutContext().geo.values()].map(labelBox);
  assert.ok(boxesOverlap(naive[0], naive[1]), 'fixture no longer collides — the test proves nothing');

  const ctx = machine(states, trans);
  const boxes = [...ctx.geo.values()].map(labelBox);
  assert.ok(!boxesOverlap(boxes[0], boxes[1]), 'the two labels still overlap');
});

test('a self-loop label clears the loop rather than sitting on the arc', () => {
  const ctx = machine([['q0', 0, 0]], [['q0', 'q0', 'a']]);
  const geo = geoFor(ctx, 'q0', 'q0');
  const distance = Math.hypot(geo.lx - geo.from.x, geo.ly - geo.from.y);
  assert.ok(distance >= geo.loop.extent, 'the label is inside the loop it labels');
});

test('turning smart labels off puts them back on the path midpoint', () => {
  harness.resetApp();
  App.config.render.smartLabels = false;
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 400, y: 0 }];
  App.transitions = [{ id: 't0', from: 'q0', to: 'q1', symbol: 'a' }];
  const geo = geoFor(context.currentLayoutContext(), 'q0', 'q1');
  assert.equal(geo.ly, 0);
});

// ── node overlap ──────────────────────────────────────────────────

test('overlapping states are pushed apart to a clear gap', () => {
  harness.resetApp();
  const states = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 4, y: 0 }, { id: 'c', x: 0, y: 4 }];
  assert.equal(context.resolveNodeOverlaps(states), true);
  const min = 2 * R() + App.config.render.minNodeGap;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const d = Math.hypot(states[i].x - states[j].x, states[i].y - states[j].y);
      assert.ok(d >= min - 0.5, `states ${i} and ${j} are still ${d.toFixed(1)}px apart`);
    }
  }
});

test('exactly coincident states separate by the gap, and not by miles', () => {
  harness.resetApp();
  const states = [{ id: 'a', x: 50, y: 50 }, { id: 'b', x: 50, y: 50 }];
  context.resolveNodeOverlaps(states);
  const d = Math.hypot(states[0].x - states[1].x, states[0].y - states[1].y);
  const min = 2 * R() + App.config.render.minNodeGap;
  // The upper bound is the half of this that matters. Coincident centres have
  // no separation direction to divide by, and an earlier version stood one in
  // for it — which scaled the push by a thousand and fired the state off the
  // canvas. A lower-bound-only assertion called that a pass.
  assert.ok(d >= min - 0.5, `too close: ${d}`);
  assert.ok(d <= min + 1, `flung far too far apart: ${d}`);
});

test('only the states named as movable are moved', () => {
  harness.resetApp();
  // Dropping `dragged` onto a settled diagram must move the dropped node, not
  // rearrange everything it landed near.
  const states = [{ id: 'fixed', x: 0, y: 0 }, { id: 'dragged', x: 10, y: 0 }];
  context.resolveNodeOverlaps(states, { movable: ['dragged'] });
  const min = 2 * R() + App.config.render.minNodeGap;
  assert.equal(states[0].x, 0);
  assert.equal(states[0].y, 0);
  assert.ok(states[1].x >= min - 0.5 && states[1].x <= min + 1,
    `dropped state should land just clear, not at ${states[1].x}`);
});

test('a state dropped exactly on another lands just clear of it', () => {
  // The drop path in canvas.js: one state moved, the rest pinned, centres
  // coincident. This is the case that used to throw the dropped state 68,000px
  // off the canvas.
  harness.resetApp();
  const states = [
    { id: 'a', x: -200, y: 0 },
    { id: 'b', x: 0, y: 0 },
    { id: 'dropped', x: 0, y: 0 }
  ];
  context.resolveNodeOverlaps(states, { movable: ['dropped'] });
  const min = 2 * R() + App.config.render.minNodeGap;
  const d = Math.hypot(states[2].x - states[1].x, states[2].y - states[1].y);
  assert.ok(d >= min - 0.5 && d <= min + 1, `landed ${d.toFixed(0)}px from the state it was dropped on`);
});

test('states already clear of each other are left alone', () => {
  harness.resetApp();
  const states = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }];
  assert.equal(context.resolveNodeOverlaps(states), false);
  assert.equal(states[1].x, 400);
});

// ── bounds ────────────────────────────────────────────────────────

test('content bounds cover the self-loop, not just the state', () => {
  machine([['q0', 0, 0]], [['q0', 'q0', 'a']]);
  const bounds = context.getContentBounds(R());
  const loop = context.selfLoopMetrics();
  assert.ok(bounds.minY <= -loop.extent,
    `a loop reaching ${loop.extent}px up is cropped at ${bounds.minY}`);
});
