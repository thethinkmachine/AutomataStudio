import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// The layout pass admits nodes that are not all one circle.
//
// A state is a circle of radius R and always was. A building block is a box,
// and a bigger one — it carries a title strip and a live preview of the machine
// inside it. Every "keep clear" distance in js/geometry.js used to be one
// number read from the config, and the whole of this change is that they are
// now per node.
//
// The rule the file states, and what these tests hold it to:
//
//     Routing and overlap use a circumscribed radius; only the drawn endpoint
//     uses the box.
//
// So the avoidance passes are conservative around a block — an edge routes a
// little wide — and the arrowhead lands exactly on the box's edge, which is the
// half a reader can see.
//
// The gate for the whole change is the last section: the incremental drag path
// must still arrive at the routes a full pass computes, *with mixed sizes on
// the canvas*. That invariant is what tests/incremental-layout.test.js pins for
// uniform circles, and it is the one thing here that fails silently — an edge
// routed through a block looks like nothing until someone notices.

const { App } = context;

/** A bare canvas with `n` states in a row, 90px apart. */
function row(n, spacing = 90) {
  createHarness();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < n; i++) {
    App.states.push({ id: 's' + i, name: 'q' + i, x: 100 + i * spacing, y: 200 });
  }
  App.stateN = n;
  App.startId = 's0';
  App.config.render.animateLayout = false;
  return App.states;
}

function layout() {
  return context.buildLayoutContext({ collide: true });
}

// ── the boundary a drawn edge stops at ────────────────────────────

test('an edge into a circle stops at its radius, as it always did', () => {
  const [a, b] = row(2, 300);
  App.transitions = [{ id: 't1', from: 'a', to: 'b', symbol: 'a' }];
  const head = App.config.render.arrowHeadSize;
  const geo = context.edgeGeometryFor(a, b, 0);

  const R = context.R;
  assert.ok(Math.abs(Math.hypot(geo.sx - a.x, geo.sy - a.y) - R) < 1e-6,
    'the tail leaves the circle');
  assert.ok(Math.abs(Math.hypot(geo.ex - b.x, geo.ey - b.y) - (R + head)) < 1e-6,
    'and the head stops one arrowhead short of it');
});

test('an edge into a box stops on the side it arrives at, not on a circle', () => {
  const [a, b] = row(2, 300);
  b.box = { w: 200, h: 100 };
  b.r = Math.hypot(200, 100) / 2;
  const head = App.config.render.arrowHeadSize;

  // Straight in from the left: the crossing is the box's own half-width.
  const geo = context.edgeGeometryFor(a, b, 0);
  assert.ok(Math.abs((b.x - geo.ex) - (100 + head)) < 1e-6,
    `head landed at ${b.x - geo.ex} from centre, expected ${100 + head}`);
  assert.ok(Math.abs(geo.ey - b.y) < 1e-6, 'and on the centre line');

  // A circle of the same clearance radius would have stopped much further out,
  // which is exactly the arrowhead-floating-beside-the-node bug.
  assert.ok(b.x - geo.ex < b.r + head, 'the box is met, not the circle round it');
});

test('an edge arriving from below a box stops on its top edge', () => {
  const [a, b] = row(2, 0);
  a.x = b.x;
  a.y = b.y + 400;
  b.box = { w: 200, h: 100 };
  b.r = Math.hypot(200, 100) / 2;
  const head = App.config.render.arrowHeadSize;

  const geo = context.edgeGeometryFor(a, b, 0);
  assert.ok(Math.abs((geo.ey - b.y) - (50 + head)) < 1e-6,
    'the half-height decides, because that crossing is the nearer one');
  assert.ok(Math.abs(geo.ex - b.x) < 1e-6);
});

test('a radius passed explicitly still overrides, so old callers are unchanged', () => {
  const [a, b] = row(2, 300);
  const geo = context.edgeGeometryFor(a, b, 0, 10, 10, 0);
  assert.ok(Math.abs(Math.hypot(geo.sx - a.x, geo.sy - a.y) - 10) < 1e-6);
  assert.ok(Math.abs(Math.hypot(geo.ex - b.x, geo.ey - b.y) - 10) < 1e-6);
});

// ── separation ────────────────────────────────────────────────────

test('two nodes clear each other by the sum of their own radii', () => {
  const states = [
    { id: 'small', x: 0, y: 0 },
    { id: 'big', x: 20, y: 0, r: 120 }
  ];
  const gap = 8;
  assert.equal(context.resolveNodeOverlaps(states, { gap }), true);

  const dist = Math.hypot(states[1].x - states[0].x, states[1].y - states[0].y);
  const want = context.R + 120 + gap;
  assert.ok(dist >= want - 0.6, `separated to ${dist.toFixed(1)}, wanted ${want}`);
  // And not over-separated: a blanket 2 × maxR would have pushed them to 248.
  assert.ok(dist < 2 * 120 + gap, 'the small node was not treated as a big one');
});

test('a big node and a small one are found by the grid path too', () => {
  // Past OVERLAP_GRID_STATES the sweep goes through a uniform grid whose cell
  // is the *widest possible* pair — file a big node and a small one by their
  // own sizes and they land cells apart and are never compared.
  const make = () => {
    const list = [];
    for (let i = 0; i < 80; i++) list.push({ id: 'f' + i, x: -5000 + i * 400, y: -5000 });
    list.push({ id: 'small', x: 0, y: 0 });
    list.push({ id: 'big', x: 20, y: 0, r: 120 });
    return list;
  };
  const gap = 8;
  const grid = make();
  const pairs = make();
  context.resolveNodeOverlaps(grid, { gap, grid: true });
  context.resolveNodeOverlaps(pairs, { gap, grid: false });

  const d = l => Math.hypot(l[81].x - l[80].x, l[81].y - l[80].y);
  assert.ok(d(grid) >= context.R + 120 + gap - 0.6, 'the grid path separated them');
  assert.ok(Math.abs(d(grid) - d(pairs)) < 1e-6, 'and to the same distance as all-pairs');
});

test('states already clear of a big neighbour are still left alone', () => {
  const states = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 400, y: 0, r: 120 }
  ];
  assert.equal(context.resolveNodeOverlaps(states), false);
});

// ── routing sees the size ─────────────────────────────────────────

test('a big node blocks a chord that the same node as a circle would not', () => {
  // Three in a row 260 apart, an edge from the first to the third, and the
  // middle one standing beside the chord — far enough off that a state clears
  // it and a block does not.
  const [a, mid, b] = row(3, 260);
  mid.y = 200 - 70;
  App.transitions = [{ id: 't1', from: 's0', to: 's2', symbol: 'a' }];
  App.transN = 1;

  const straight = layout().geo.get('s0|s2');
  assert.equal(straight.crvVal, 0, 'a plain state 70px off the chord is clear of it');
  assert.equal(straight.blocked, false);

  mid.r = 140;
  mid.box = { w: 240, h: 140 };
  const bent = layout().geo.get('s0|s2');
  assert.notEqual(bent.crvVal, 0, 'the same node as a block is in the way');
  assert.equal(bent.blocked, true);
});

test('a block elsewhere on the canvas does not make every state act like one', () => {
  // The grid query is sized on the widest node in the diagram and each
  // candidate is then charged its own radius. Charge them all the widest and a
  // diagram gets a bend everywhere a block exists *somewhere*, which is the
  // "query wide, test exact" rule failing in the direction nothing else here
  // would notice: the incremental and full passes would agree perfectly, on the
  // wrong answer.
  const [a, mid, b] = row(3, 260);
  mid.y = 200 - 70;
  App.states.push({ id: 'far', name: 'far', x: 4000, y: 4000, r: 200, box: { w: 380, h: 200 } });
  App.stateN = 4;
  App.transitions = [{ id: 't1', from: 's0', to: 's2', symbol: 'a' }];
  App.transN = 1;

  const ctx = layout();
  assert.equal(ctx.maxR, 200, 'the widest node is what the queries are sized on');
  const geo = ctx.geo.get('s0|s2');
  assert.equal(geo.crvVal, 0, 'the plain state beside the chord is still a plain state');
  assert.equal(geo.blocked, false);
});

test('the bend clears the blocker by its own radius, not the default', () => {
  const [a, mid, b] = row(3, 300);
  mid.y = 200 - 40;
  mid.r = 110;
  App.transitions = [{ id: 't1', from: 's0', to: 's2', symbol: 'a' }];
  App.transN = 1;

  const geo = layout().geo.get('s0|s2');
  // Sample the drawn quadratic and check every point clears the blocker.
  let worst = Infinity;
  for (let i = 1; i <= 9; i++) {
    const p = context.pathPoint(geo, i / 10);
    worst = Math.min(worst, Math.hypot(p.x - mid.x, p.y - mid.y));
  }
  assert.ok(worst >= 110, `closest approach was ${worst.toFixed(1)}, inside the node`);
});

test('a block elsewhere does not push every label away from its edge', () => {
  // labelPenalty queries for the widest node that could reach the box and then
  // charges each one its own radius. Charge them all the widest and every label
  // in the diagram is shoved clear of a block that is nowhere near it — and,
  // like the routing case above, both passes would agree on it.
  const [a, b, c] = row(3, 200);
  App.transitions = [{ id: 't1', from: 's0', to: 's1', symbol: 'a' }];
  App.transN = 1;
  const plain = layout().geo.get('s0|s1');

  App.states.push({ id: 'far', name: 'far', x: 5000, y: 5000, r: 200, box: { w: 380, h: 200 } });
  App.stateN = 4;
  const withBlock = layout().geo.get('s0|s1');

  assert.ok(Math.abs(withBlock.lx - plain.lx) < 1e-6, 'the label did not move');
  assert.ok(Math.abs(withBlock.ly - plain.ly) < 1e-6);
});

test('an edge with nothing near it is still only sensitive to the narrow band', () => {
  // routeCurve returns `base` from a cheap early-out when nothing is near, and
  // relayout matches that with a narrower dirty radius (`nearPad`) — an edge
  // that took the early-out cannot have been changed by anything outside it.
  //
  // Both radii are sized on the widest node, and this is the case that proves
  // why. Constructed rather than sampled from a drag: the window between the
  // two candidate radii is about thirty pixels wide, and a fixture that happens
  // to cross it is a test that happens to pass.
  createHarness();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.config.render.animateLayout = false;
  App.states = [
    { id: 's0', name: 'q0', x: 0, y: 300 },
    { id: 's1', name: 'q1', x: 900, y: 300 },
    // A block with no transitions of its own, parked far away.
    { id: 'blk', name: 'blk', x: 280, y: -3000, r: 85, box: { w: 150, h: 90 } }
  ];
  App.stateN = 3;
  App.startId = 's0';
  App.accepts = new Set();
  App.transitions = [{ id: 't1', from: 's0', to: 's1', symbol: 'a', write: 'a', dir: 'R' }];
  App.transN = 1;

  context.renderAll();
  context.updateFastDOM();
  assert.equal(context.currentLayoutContext().geo.get('s0|s1').blocked, false,
    'the edge starts out having taken the cheap early-out');

  // 90px off the chord, at a third of its length. Three things are being lined
  // up: it is inside the block's own hit radius for the early-out
  // (85 + clearance + 4) and outside a band sized on a plain state; it sits on
  // one of the nine points curveClears samples, since 90 is only just inside
  // the 97 it has to clear and a gap between samples would let a straight edge
  // through; and it is far enough along the chord that the label grid is not
  // what dirties the edge instead.
  const blk = App.states[2];
  blk.y = 210;
  context.updateFastDOM();

  const drawnD = App.domCache.transitions.get('s0|s1').__parts.pathEl.getAttribute('d');
  const full = context.currentLayoutContext().geo.get('s0|s1');
  assert.equal(full.blocked, true, 'a full pass sees the block beside the chord');
  assert.notEqual(full.crvVal, 0, 'and bends the edge around it');
  assert.equal(drawnD, full.d,
    'the incremental pass kept a stale straight edge — its narrow dirty band is ' +
    "no longer the band routeCurve's early-out actually looks at");
});

// ── self-loops ────────────────────────────────────────────────────

test('a loop sits on the node it belongs to, whatever size that node is', () => {
  const [a] = row(1);
  a.r = 90;
  App.transitions = [{ id: 't1', from: 's0', to: 's0', symbol: 'a' }];
  App.transN = 1;

  const geo = layout().geo.get('s0|s0');
  assert.equal(geo.isSelf, true);
  assert.equal(geo.loop.r, 90, 'the metrics carry the radius they were built for');

  // The arc's first foot is on the node's own circle, not on a 30px one.
  const m = geo.d.match(/^M ([\d.eE+-]+) ([\d.eE+-]+) A/);
  assert.ok(m, `unexpected loop path: ${geo.d}`);
  const foot = Math.hypot(Number(m[1]) - a.x, Number(m[2]) - a.y);
  assert.ok(Math.abs(foot - 90) < 1e-6, `foot at ${foot}, expected 90`);
});

test('a loop is aimed clear of a big neighbour, not just a state-sized one', () => {
  const [a, big] = row(2, 0);
  big.x = a.x;
  big.y = a.y - 150;
  big.r = 120;
  App.transitions = [{ id: 't1', from: 's0', to: 's0', symbol: 'a' }];
  App.transN = 1;

  const angle = layout().geo.get('s0|s0').angle;
  // Up is the default and the tie-break preference, so moving off it is the
  // whole signal: the neighbour above was seen at its own size.
  assert.ok(Math.abs(angle - context.UP) > 0.3,
    `loop stayed at ${angle.toFixed(2)} with a block directly above it`);
});

// ── bounds ────────────────────────────────────────────────────────

test('a node bigger than a state bounds itself, even with no edges on it', () => {
  const [a] = row(1);
  a.box = { w: 300, h: 200 };
  a.r = Math.hypot(300, 200) / 2;
  App.transitions = [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  context.includeLayoutBounds(layout(), (x0, y0, x1, y1) => {
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
  });
  assert.equal(maxX - minX, 300);
  assert.equal(maxY - minY, 200);
});

test('a plain diagram grows its bounds by nothing extra', () => {
  row(3);
  App.transitions = [{ id: 't1', from: 's0', to: 's1', symbol: 'a' }];
  App.transN = 1;
  const grown = [];
  context.includeLayoutBounds(layout(), (x0, y0, x1, y1) => grown.push([x0, y0, x1, y1]));
  // Only the label box: no state declares a shape, so the node loop is a no-op.
  assert.equal(grown.length, 1);
});

// ── the gate: the incremental pass, with mixed sizes ──────────────

/** A diagram loose enough that most edges have nothing near them at all. */
function sparse(nStates, nTrans) {
  createHarness();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.states = []; App.transitions = []; App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    const s = { id: 's' + i, name: 'q' + i, x: 100 + (i % 9) * 230, y: 100 + Math.floor(i / 9) * 230 };
    if (i % 5 === 2) { s.r = 85; s.box = { w: 150, h: 90 }; }
    App.states.push(s);
  }
  App.startId = 's0';
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    // Neighbours only, so a chord is short and usually empty.
    App.transitions.push({
      id: 't' + i, from: 's' + i, to: 's' + ((i + 1) % nStates),
      symbol: i % 2 ? 'a' : 'b', write: 'a', dir: 'R'
    });
  }
  App.transN = nTrans;
  App.config.render.animateLayout = false;
}

function mixed(nStates, nTrans, spread = 10) {
  createHarness();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.states = []; App.transitions = []; App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    const s = { id: 's' + i, name: 'q' + i, x: 100 + (i % spread) * 110, y: 100 + Math.floor(i / spread) * 110 };
    // Every seventh node is a block-sized box, which is roughly the density a
    // machine built out of subroutines actually has.
    if (i % 7 === 3) { s.r = 85; s.box = { w: 150, h: 90 }; }
    App.states.push(s);
  }
  App.startId = 's0';
  App.accepts.add('s' + (nStates - 1));
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % nStates), to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b', write: i % 2 ? 'b' : 'a', dir: i % 2 ? 'R' : 'L'
    });
  }
  App.transN = nTrans;
  App.config.render.animateLayout = false;
}

function drawn() {
  const out = new Map();
  for (const [key, grp] of App.domCache.transitions) {
    const p = grp.__parts;
    if (!p) continue;
    out.set(key, p.pathEl.getAttribute('d'));
  }
  return out;
}

test('a drag over a diagram of mixed sizes is routed the way a full pass routes it', () => {
  mixed(120, 240);
  context.renderAll();

  // The mover is a *block*, deliberately, and the one nearest the middle where
  // the edges are. A plain state moving is the case the old band already
  // covered exactly: it is only when the thing crossing a chord is bigger than
  // a state that relayout's dirty radius and the radius routeCurve actually
  // searches have to be the same number. Both are sized on routeStep(), which
  // is why there is only one of it.
  const cx = 100 + 4.5 * 110, cy = 100 + 5.5 * 110;
  const boxes = App.states.filter(st => st.box);
  assert.ok(boxes.length, 'the fixture is meant to contain block-sized nodes');
  const s = boxes.reduce((best, st) =>
    Math.hypot(st.x - cx, st.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? st : best);
  const x0 = s.x, y0 = s.y;

  // Compared on *every* frame rather than only at the end. A dirty band that is
  // too narrow shows up as one frame where an edge kept a stale route, and the
  // next frame — which dirties it for some other reason — hides it again. A
  // final-position comparison catches that only by luck.
  //
  // currentLayoutContext() takes a full pass and, unlike renderAll(), does not
  // become the context the next updateFastDOM diffs against, so measuring does
  // not repair the thing being measured.
  context.updateFastDOM();
  let compared = 0, diff = 0, firstBad = null;
  for (let f = 0; f < 40; f++) {
    s.x = x0 + Math.sin(f / 6) * 330;
    s.y = y0 + Math.cos(f / 6) * 300;
    context.updateFastDOM();

    const incremental = drawn();
    for (const [key, geo] of context.currentLayoutContext().geo) {
      const got = incremental.get(key);
      if (got === undefined) continue;
      compared++;
      if (got !== geo.d) {
        diff++;
        if (!firstBad) firstBad = `frame ${f}, edge ${key}`;
      }
    }
  }
  assert.ok(compared > 2000, `expected a real diagram to compare, got ${compared}`);
  assert.equal(diff, 0,
    `${diff} of ${compared} edge-frames were routed differently (first: ${firstBad}) — ` +
    'the dirty band no longer covers what routeCurve searches now that nodes differ in size');
});

test('dragging a big node re-routes the edges it steps into', () => {
  mixed(40, 60, 8);
  context.renderAll();
  context.updateFastDOM();
  const before = drawn();

  // A block with no transitions of its own, walked into the middle: every edge
  // that changes shape does so purely because a big node arrived beside it.
  const loner = { id: 'lone', name: 'lone', x: -900, y: -900, r: 95, box: { w: 170, h: 100 } };
  App.states.push(loner);
  context.renderAll();
  context.updateFastDOM();

  loner.x = App.states[20].x + 40;
  loner.y = App.states[20].y + 40;
  context.updateFastDOM();
  const after = drawn();

  let moved = 0;
  for (const [key, d] of before) {
    const b = after.get(key);
    if (b !== undefined && b !== d) moved++;
  }
  assert.ok(moved > 0, 'a block dropped into a diagram bent nothing it stepped into');
});

test('an idle frame over a mixed diagram moves nothing', () => {
  mixed(60, 100);
  context.renderAll();
  context.updateFastDOM();
  const a = drawn();
  context.updateFastDOM();
  const b = drawn();
  for (const [key, d] of a) assert.equal(b.get(key), d, key);
});
