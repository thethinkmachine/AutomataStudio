import { App, COLLISION_BUDGET_STATES, COLLISION_BUDGET_TRANSITIONS, R, stateById as stateIndex } from './state.js';
import { rectHasSegment } from './viewport.js';

// ══════════════════════════════════════════════════════════════════
//  DIAGRAM GEOMETRY
// ══════════════════════════════════════════════════════════════════
// Everything that decides *where* a path, a self-loop or an edge label goes.
// render.js still owns the DOM; this module owns the coordinates, and it is
// deliberately import-free apart from state.js so it can be reasoned about (and
// tested) without a canvas.
//
// The whole diagram is laid out in one pass — buildLayoutContext() — rather than
// edge by edge, because avoidance is a global property: a label can only be
// placed clear of the other labels once they all have positions, and an edge can
// only be routed around a node once every node has one. The pass runs in four
// stages, each reading the results of the last:
//
//   1. index    — states, transitions grouped per ordered pair, spatial grid
//   2. loops    — a direction for every self-loop, chosen to dodge neighbours
//   3. routing  — a curve offset for every edge, chosen to clear third states
//   4. labels   — a box for every edge label, clear of nodes, edges and labels
//
// Stages 2–4 are the expensive ones and are skipped wholesale past
// COLLISION_BUDGET_STATES, where the drag path could no longer afford them; the
// geometry degrades to the plain "straight line, label on the midpoint" drawing
// rather than getting slow.

// A state is a circle of radius R; every "keep clear" distance below is measured
// from its edge, not its centre.
const DEFAULTS = {
  nodeClearance: 12,   // space an edge or label must leave around a state
  labelGap: 5,         // space a label must leave around anything else
  minNodeGap: 8        // space between two state circles when overlaps resolve
};

// 11px monospace: advance width is very close to 0.6em, and the tspans step by
// 1.2em. Estimated rather than measured because the label has to be placed
// before it is written to the DOM — and because measuring per edge per frame
// would force a layout flush on every drag frame.
const TEXT_CHAR_W = 6.6;
const TEXT_LINE_H = 13.2;
// Pill metrics mirror the ones render.js draws with. Both read from here so a
// change to one cannot silently desynchronise the placement from the drawing.
export const PILL_ROW_H = 22;
export const PILL_HEIGHT = 18;
export const PILL_GAP = 4;

// Straight up. Self-loops prefer it — it is where a reader expects a loop —
// and only leave it when something is actually in the way.
export const UP = -Math.PI / 2;

// Past this much diagram the avoidance passes stop fitting in a drag frame, so
// they are skipped and the geometry falls back to the direct drawing. Both
// limits matter: routing scales with how many states an edge can run into, and
// label placement with how many other labels are competing for the space.
//
// Declared in js/state.js and re-exported here, where they used to live. The
// same two numbers are the large-machine profile's threshold, and that module
// is import-free and so cannot reach this one — see largeMachineProfile() for
// why the profile reuses this line rather than measuring its own.
export { COLLISION_BUDGET_STATES, COLLISION_BUDGET_TRANSITIONS } from './state.js';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cfg() { return (App.config && App.config.render) || {}; }

export function nodeClearance() { return Math.max(0, num(cfg().nodeClearance, DEFAULTS.nodeClearance)); }
export function labelGap() { return Math.max(0, num(cfg().labelGap, DEFAULTS.labelGap)); }
export function minNodeGap() { return Math.max(0, num(cfg().minNodeGap, DEFAULTS.minNodeGap)); }

// Each avoidance stage can be turned off on its own — the settings modal exposes
// them, and an imported preferences blob may omit them entirely, so an absent
// value means "on".
function wants(flag) { return cfg()[flag] !== false; }

// The radius the app is currently drawing states at. R is a live binding that
// the settings modal reassigns through setR, so it is read per call.
function nodeR() { return num(R, 30); }

// ── small vector / interval helpers ──
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Smallest angle between two directions, in [0, π].
export function angleDelta(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// How far a circle penetrates a rectangle: 0 when clear, and up to `r` when the
// centre is inside. Used as a penalty weight rather than a boolean so the
// candidate search can pick the least-bad placement when nothing is free.
function circleRectOverlap(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  return Math.max(0, r - Math.hypot(cx - nx, cy - ny));
}

function rectOverlap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? Math.min(ox, oy) : 0;
}

function rectAt(x, y, w, h) { return { x: x - w / 2, y: y - h / 2, w, h }; }

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// Distance from p to the segment ab, plus where along ab the closest point sits.
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!len2) return { dist: Math.hypot(px - ax, py - ay), t: 0 };
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

// Point on the quadratic Bézier through S, control M, end E.
function quadPoint(sx, sy, mx, my, ex, ey, t) {
  const u = 1 - t;
  return {
    x: u * u * sx + 2 * u * t * mx + t * t * ex,
    y: u * u * sy + 2 * u * t * my + t * t * ey
  };
}

// ── spatial grid ──
// Both the node lookups ("what is near this edge?") and the label lookups
// ("what is near this box?") are bounding-box queries against a set of points,
// which is exactly what a uniform grid is for. Without one, routing is
// O(edges × states) and label placement is O(labels²) — fine at ten states,
// visibly not fine at two hundred.
function makeGrid(cell) { return { cell: Math.max(1, cell), map: new Map() }; }

function gridAdd(grid, x, y, item) {
  const k = `${Math.floor(x / grid.cell)},${Math.floor(y / grid.cell)}`;
  const bucket = grid.map.get(k);
  if (bucket) bucket.push(item); else grid.map.set(k, [item]);
}

// Everything in the cells covering [x0,x1] × [y0,y1]. A very long edge can span
// more cells than there are items in the whole grid, so past a cell budget the
// query degrades to "everything" — still correct, just unfiltered.
function gridQuery(grid, x0, y0, x1, y1, all) {
  const c = grid.cell;
  const cx0 = Math.floor(x0 / c), cx1 = Math.floor(x1 / c);
  const cy0 = Math.floor(y0 / c), cy1 = Math.floor(y1 / c);
  const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
  if (!Number.isFinite(cells) || cells > 512) return all;
  const out = [];
  for (let ix = cx0; ix <= cx1; ix++) {
    for (let iy = cy0; iy <= cy1; iy++) {
      const bucket = grid.map.get(`${ix},${iy}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  LABEL SIZES
// ══════════════════════════════════════════════════════════════════
// One line per transition on the edge, so a five-way edge is a five-line block.

export function estimateTextLabelSize(lines) {
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, String(line).length);
  return {
    w: Math.max(16, widest * TEXT_CHAR_W + 6),
    h: Math.max(TEXT_LINE_H, lines.length * TEXT_LINE_H)
  };
}

export function pillPartWidth(text) { return Math.max(24, 12 + String(text).length * 6.2); }

export function pillRowWidth(row) {
  return row.reduce((sum, p) => sum + pillPartWidth(p.text), 0) + Math.max(0, row.length - 1) * PILL_GAP;
}

export function estimatePillLabelSize(rows) {
  let widest = 0;
  for (const row of rows) widest = Math.max(widest, pillRowWidth(row));
  return { w: Math.max(40, widest), h: Math.max(PILL_HEIGHT, rows.length * PILL_ROW_H) };
}

// Used when a caller has no way to produce the real label text — content bounds
// from a module that does not import the label formatters, for instance. It only
// has to be roughly right: it widens the frame, it does not move anything.
function defaultLabelSize(ts) {
  return estimateTextLabelSize(ts.map(() => 'abc'));
}

// ══════════════════════════════════════════════════════════════════
//  SELF-LOOPS
// ══════════════════════════════════════════════════════════════════
// A self-loop is an arc of radius `ss` whose two ends sit on the state circle,
// symmetric about a direction θ. Everything about it follows from θ, which is
// what makes "put the loop somewhere else" a one-number change.
//
// The config supplies the two shape numbers, and both arrive unvalidated (the
// settings modal, an imported profile, a restored workspace), so they are
// clamped here: an offset wider than the node or an arc smaller than its own
// chord has no solution and would put NaN into every coordinate.
export function selfLoopMetrics() {
  const r = nodeR();
  const so = clamp(num(cfg().selfLoopOff, 12), 2, r * 0.85);
  const ss = Math.max(so + 4, num(cfg().selfLoopSize, 22));
  const spread = Math.asin(so / r);          // half the angle the arc's feet span
  const chordOut = r * Math.cos(spread);     // chord midpoint, measured outward
  const bulge = Math.sqrt(ss * ss - so * so); // chord midpoint to the arc's centre
  const centreOut = chordOut + bulge;
  // How far short of the state circle the arc's closing foot stops, for the
  // same reason `arrowHeadSize` holds an ordinary edge back: the head is drawn
  // backwards from a point ahead of the path's end, so an arc that closes *on*
  // the circle puts the tip inside the node and leaves a flat, chopped-off stub
  // sitting on the ring. Clamped against the arc's own radius, since the trim
  // below is an arc length and a large enough one would run past the foot it is
  // trimming. The opening foot stays on the circle, where a line with no head
  // on it should start.
  const endGap = clamp(num(cfg().arrowHeadSize, 6), 0, ss * 0.5);
  return { so, ss, spread, chordOut, bulge, centreOut, endGap, extent: centreOut + ss };
}

// The arc, drawn from θ−spread to θ+spread the long way round. Sweep and
// large-arc are fixed: rotating the configuration preserves orientation, so the
// same pair of flags bulges outward along θ whichever way θ points.
export function selfLoopPath(x, y, angle, m = selfLoopMetrics()) {
  const r = nodeR();
  const a0 = angle - m.spread, a1 = angle + m.spread;
  const x0 = x + r * Math.cos(a0), y0 = y + r * Math.sin(a0);
  // The closing foot is pulled back *along the arc* rather than outward from
  // the state, which is what leaves the loop the shape it already had: the arc
  // keeps its own centre and radius and only ends `endGap` of arc length early,
  // so the foot lifts off the circle along a tangent that still points into the
  // node. Moving it radially instead would hand the browser a chord its radius
  // no longer fits and the whole loop would be redrawn around a different
  // centre. Sweep is 1, so travel is the increasing-φ direction and trimming
  // the end means subtracting from φ.
  const cx = x + m.centreOut * Math.cos(angle), cy = y + m.centreOut * Math.sin(angle);
  const phi = Math.atan2(y + r * Math.sin(a1) - cy, x + r * Math.cos(a1) - cx) - m.endGap / m.ss;
  const x1 = cx + m.ss * Math.cos(phi), y1 = cy + m.ss * Math.sin(phi);
  return `M ${x0} ${y0} A ${m.ss} ${m.ss} 0 1 1 ${x1} ${y1}`;
}

/**
 * Everything about a non-self edge that follows from its control offset: where
 * the path meets each circle, where the bend handle sits, and the path itself.
 *
 * Split out of the layout pass because the animation layer redraws an edge from
 * an *eased* crvVal on its way to the DOM, and a second copy of this arithmetic
 * would drift from this one — the same trap the pill metrics carry a warning
 * about. render.js calls it with the eased value; buildLayoutContext calls it
 * with the target.
 */
export function edgeGeometryFor(from, to, crvVal, r = nodeR(), arrowHead = num(cfg().arrowHeadSize, 6)) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (!dist) return null;
  const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;

  // The control point is measured from the centre-to-centre midpoint, which
  // is also where canvas.js projects a curve drag — the handle and the gesture
  // have to agree on the same origin or dragging jumps on the first frame.
  const mx = (from.x + to.x) / 2 + px * crvVal, my = (from.y + to.y) / 2 + py * crvVal;
  // Endpoints sit where the curve actually meets each circle — on the ray
  // towards the control point, not along the straight chord. On a strongly
  // bent edge the two differ by enough that the arrowhead used to land beside
  // the node rather than on it. With no bend the control point is the chord
  // midpoint and both rays collapse back onto the chord, so a straight edge is
  // drawn exactly where it always was.
  const sv = normalize(mx - from.x, my - from.y, ux, uy);
  const ev = normalize(mx - to.x, my - to.y, -ux, -uy);
  const sx = from.x + sv.x * r, sy = from.y + sv.y * r;
  const ex = to.x + ev.x * (r + arrowHead), ey = to.y + ev.y * (r + arrowHead);
  return {
    sx, sy, ex, ey, mx, my, px, py, ux, uy, dist,
    d: crvVal ? `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`
  };
}

// Where a self-loop's label sits for a given angle: clear of the arc's outer
// edge by the label gap plus half its own height. Shared with the animation
// layer so an eased angle carries its label with it.
export function selfLoopLabelPoint(s, angle, m, labelSize) {
  const d = m.extent + labelGap() + labelSize.h / 2;
  return { x: s.x + d * Math.cos(angle), y: s.y + d * Math.sin(angle) };
}

// Directions tried when placing a loop. Twelve is enough to always find a gap
// between two neighbours 30° apart, and few enough that scoring them all is
// free. Index 0 is straight up, which the bias below then prefers.
const LOOP_DIRECTIONS = 12;

// Angular half-width around an incident edge that a loop should stay out of.
const EDGE_KEEPOUT = 0.7; // ≈ 40°

function loopCandidateAngles() {
  const out = [];
  for (let i = 0; i < LOOP_DIRECTIONS; i++) out.push(UP + (i * 2 * Math.PI) / LOOP_DIRECTIONS);
  return out;
}

// What the loop costs at this angle, in "pixels of trouble". Overlaps with a
// state are weighted heaviest because they are the failure this is here to fix:
// a loop drawn straight through the node sitting above it.
//
// `near` is every state that could matter for any candidate angle, gathered once
// by the caller — the loop sweeps a disc around the state, so one query covers
// all twelve directions and the per-candidate work is pure arithmetic.
function scoreLoopAngle(s, angle, near, dirs, m, labelSize) {
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const lcx = s.x + m.centreOut * ux, lcy = s.y + m.centreOut * uy;
  const r = nodeR();
  const keepOut = m.ss + r + nodeClearance();
  let score = 0;

  const labelPad = r + labelGap();
  const box = labelSize ? rectAt(
    s.x + (m.extent + labelGap() + labelSize.h / 2) * ux,
    s.y + (m.extent + labelGap() + labelSize.h / 2) * uy,
    labelSize.w, labelSize.h) : null;

  for (const o of near) {
    if (o.id === s.id) continue;
    const overlap = keepOut - Math.hypot(o.x - lcx, o.y - lcy);
    if (overlap > 0) score += overlap * 4;
    // The label rides outside the arc, so a direction can be clear for the loop
    // and still be wrong for the text.
    if (box) score += circleRectOverlap(o.x, o.y, labelPad, box) * 2;
  }

  // An edge arriving where the loop wants to sit is not an overlap the way a
  // node is, but it reads as one: the arrowhead lands inside the loop.
  for (const dir of dirs) {
    const d = angleDelta(angle, dir);
    if (d < EDGE_KEEPOUT) score += (EDGE_KEEPOUT - d) * 45;
  }

  // Tie-break only. Two directions that are equally clear should resolve to the
  // conventional one, and the weight is small enough that any real collision
  // outvotes it.
  score += (1 - Math.cos(angle - UP)) * 8;
  return score;
}

export function chooseSelfLoopAngle(s, ts, ctx, m, labelSize) {
  // An explicit angle is the user dragging the loop's handle. Never overridden.
  const manual = ts && ts.find(t => Number.isFinite(t.loopAngle));
  if (manual) return manual.loopAngle;
  if (!ctx || !ctx.collide || !wants('smartSelfLoops')) return UP;

  const reach = m.extent + (labelSize ? labelSize.w + labelSize.h : 0) + nodeR() + nodeClearance();
  const near = gridQuery(ctx.nodeGrid, s.x - reach, s.y - reach, s.x + reach, s.y + reach, ctx.states);
  const dirs = ctx.incidentDirs.get(s.id) || [];

  let best = UP, bestScore = Infinity;
  for (const angle of loopCandidateAngles()) {
    const score = scoreLoopAngle(s, angle, near, dirs, m, labelSize);
    if (score < bestScore) { bestScore = score; best = angle; }
  }
  return best;
}

// ══════════════════════════════════════════════════════════════════
//  EDGE ROUTING
// ══════════════════════════════════════════════════════════════════
// An edge is a quadratic Bézier whose control point sits `crv` off the chord's
// midpoint, along the chord normal. The curve's own deviation is half that, so
// clearing a state parked on the chord needs crv ≈ 2·(R + clearance) — which is
// why the search steps in node-sized increments rather than a few pixels.

// States within `slack` of the straight from→to chord, excluding its endpoints.
//
// Called twice per blocked edge with two different slacks, which is the point:
// the narrow query answers "is this edge in trouble at all?" for every edge and
// has to be cheap, and only an edge that fails it pays for the wide query that
// the offset search needs — a candidate bend can only be checked against nodes
// it was told about, so the search radius and the query radius have to match.
function nodesNearChord(from, to, ctx, slack) {
  const r = nodeR(), clear = nodeClearance();
  const pad = r + clear + slack;
  const x0 = Math.min(from.x, to.x) - pad, x1 = Math.max(from.x, to.x) + pad;
  const y0 = Math.min(from.y, to.y) - pad, y1 = Math.max(from.y, to.y) + pad;
  const near = gridQuery(ctx.nodeGrid, x0, y0, x1, y1, ctx.states);
  const hits = [];
  for (const o of near) {
    if (o.id === from.id || o.id === to.id) continue;
    const { dist, t } = segmentDistance(o.x, o.y, from.x, from.y, to.x, to.y);
    // Only the interior counts: a state overlapping an endpoint is a node-node
    // overlap, and bending the edge cannot fix it.
    if (t <= 0.02 || t >= 0.98) continue;
    if (dist < pad) hits.push({ node: o, dist, t });
  }
  return hits;
}

// Does this control offset keep the whole curve clear of `hits`? Sampled rather
// than solved: the exact distance from a point to a quadratic is a cubic root
// problem, and nine samples along a curve this short are indistinguishable
// from it.
function curveClears(from, to, crv, px, py, hits) {
  const need = nodeR() + nodeClearance();
  const mx = (from.x + to.x) / 2 + px * crv, my = (from.y + to.y) / 2 + py * crv;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const p = quadPoint(from.x, from.y, mx, my, to.x, to.y, t);
    for (const h of hits) {
      if (Math.hypot(p.x - h.node.x, p.y - h.node.y) < need) return false;
    }
  }
  return true;
}

// How far the search may bend an edge, in node-sized steps. Four is a deviation
// of two node diameters, which is as far as a bend can go before it stops
// reading as "this edge goes around that state" and starts reading as a
// different edge entirely.
const ROUTE_STEPS = 4;

// An edge crossing more states than this is threading a crowd, not passing one
// obstacle. No offset clears all of them, so the search would spend its whole
// budget to end up back at `base` — and even if one did, an edge swung that far
// out is harder to follow than the one it replaced.
const MAX_ROUTE_BLOCKERS = 10;

export function routeCurve(from, to, ctx, px, py, base, out) {
  if (!ctx || !ctx.collide || !wants('autoRouteEdges')) return base;
  const step = nodeR() + nodeClearance();
  // A quadratic's deviation from its chord is half its control offset, so this
  // is how far the widest candidate below actually swings.
  const reach = (Math.abs(base) + ROUTE_STEPS * step) / 2;

  // Cheap first: most edges have nothing near them and stop here, without ever
  // paying for the wider query the search needs.
  //
  // `out.blocked` records which of the two happened, because it is exactly what
  // the incremental pass needs to know: an edge that took this early return is
  // insensitive to anything outside the *narrow* band, so a state moving
  // through the wide one cannot have changed its route. See relayout().
  if (!nodesNearChord(from, to, ctx, Math.abs(base) / 2 + 4).length) {
    if (out) out.blocked = false;
    return base;
  }
  if (out) out.blocked = true;
  const hits = nodesNearChord(from, to, ctx, reach);
  if (!hits.length || hits.length > MAX_ROUTE_BLOCKERS) return base;
  if (curveClears(from, to, base, px, py, hits)) return base;

  // Bend away from whatever is most in the way. `px,py` is the normal the
  // control offset is measured along, so a blocker on the +normal side needs a
  // negative offset to get out from under the curve.
  let worst = hits[0];
  for (const h of hits) if (h.dist < worst.dist) worst = h;
  const side = (worst.node.x - (from.x + to.x) / 2) * px + (worst.node.y - (from.y + to.y) / 2) * py;
  const preferred = side > 0 ? -1 : 1;

  let fallback = base, fallbackCost = Infinity;
  for (let k = 1; k <= ROUTE_STEPS; k++) {
    for (const sign of [preferred, -preferred]) {
      const crv = base + sign * k * step;
      if (curveClears(from, to, crv, px, py, hits)) return crv;
      const cost = Math.abs(crv - base);
      if (cost < fallbackCost) { fallbackCost = cost; fallback = crv; }
    }
  }
  return fallback;
}

// ══════════════════════════════════════════════════════════════════
//  LABEL PLACEMENT
// ══════════════════════════════════════════════════════════════════
// A label starts on the path's midpoint, pushed off it along the normal so it no
// longer sits on top of its own edge, and then moves only if it has to. The
// candidates are ordered by how far they stray from that ideal, and the first
// one that collides with nothing wins — so an uncrowded diagram pays for exactly
// one test per label.

// Positions along the path a label may slide to, and what straying there costs.
const LABEL_SLIDES = [{ t: 0.5, cost: 0 }, { t: 0.35, cost: 2 }, { t: 0.65, cost: 2 }];
const LABEL_PUSHES = [0, 1, 2];

// How much trouble a label box is in where it is: nothing at all, or a weighted
// sum of how deep into each obstacle it sits.
//
// Each of the three grids is queried over this box alone rather than over the
// whole candidate set. The queries look repetitive across candidates, and they
// are, but the box is small enough to touch four cells while the union of every
// candidate for one label is not — and the difference is between a handful of
// obstacles per test and every edge sample within a hundred pixels.
function labelPenalty(box, ctx, ownKey) {
  const gap = labelGap();
  const pad = nodeR() + gap;
  let penalty = 0;

  for (const o of gridQuery(ctx.nodeGrid, box.x - pad, box.y - pad, box.x + box.w + pad, box.y + box.h + pad, ctx.states)) {
    penalty += circleRectOverlap(o.x, o.y, pad, box) * 3;
  }

  const grown = { x: box.x - gap, y: box.y - gap, w: box.w + gap * 2, h: box.h + gap * 2 };
  const x1 = grown.x + grown.w, y1 = grown.y + grown.h;
  for (const other of gridQuery(ctx.labelGrid, grown.x, grown.y, x1, y1, ctx.placedLabels)) {
    penalty += rectOverlap(grown, other) * 2;
  }

  // Edges are sampled into a point cloud once per pass, so "does this box sit on
  // a path?" is a handful of point-in-rect tests instead of a curve intersection.
  for (const p of gridQuery(ctx.edgeGrid, grown.x, grown.y, x1, y1, ctx.edgeSamples)) {
    if (p.key !== ownKey && pointInRect(p.x, p.y, grown)) penalty += 5;
  }

  return penalty;
}

// Point on an edge at parameter t. A straight edge is drawn as a line rather
// than a degenerate quadratic, so it is interpolated as one — reading its
// midpoint off the Bézier form instead would put the label a pixel or two off
// the line it is labelling.
export function pathPoint(geo, t) {
  if (geo.crvVal) return quadPoint(geo.sx, geo.sy, geo.mx, geo.my, geo.ex, geo.ey, t);
  return { x: geo.sx + (geo.ex - geo.sx) * t, y: geo.sy + (geo.ey - geo.sy) * t };
}

function placeLabel(geo, ctx) {
  const { w, h } = geo.labelSize;
  const gap = labelGap();
  // Half the path's stroke width on top of the gap, so the box clears the line
  // it belongs to rather than resting on it.
  const standoff = h / 2 + gap + 2;
  const push = Math.max(12, h * 0.8);

  // Candidates are generated ideal-first and taken in that order, so a label
  // with nothing near it costs exactly one collision test.
  const candidates = [];
  if (geo.isSelf) {
    const ux = Math.cos(geo.angle), uy = Math.sin(geo.angle);
    for (const k of LABEL_PUSHES) {
      const d = geo.loop.extent + gap + h / 2 + k * push;
      candidates.push({ x: geo.from.x + d * ux, y: geo.from.y + d * uy, cost: k * 3 });
    }
  } else {
    // Put the label on the outside of the edge's own bend: clearer, and where a
    // reader looks for it. A straight edge has no bend, so the side is the one
    // that reads as "above" on screen — and the search below moves it if that
    // side is taken.
    const nx = geo.px, ny = geo.py;
    const outward = geo.crvVal !== 0 ? Math.sign(geo.crvVal) : (-ny + nx * 0.05 >= 0 ? 1 : -1);
    for (const k of LABEL_PUSHES) {
      for (const slide of LABEL_SLIDES) {
        for (const side of [outward, -outward]) {
          const p = pathPoint(geo, slide.t);
          const d = standoff + k * push;
          candidates.push({
            x: p.x + nx * d * side,
            y: p.y + ny * d * side,
            cost: k * 3 + slide.cost + (side === outward ? 0 : 1.5)
          });
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
  }

  let best = null;
  for (const c of candidates) {
    const collision = labelPenalty(rectAt(c.x, c.y, w, h), ctx, geo.key);
    if (collision === 0) return c;
    const total = collision + c.cost;
    if (!best || total < best.total) best = { x: c.x, y: c.y, total };
  }
  return best;
}

// ══════════════════════════════════════════════════════════════════
//  THE LAYOUT PASS
// ══════════════════════════════════════════════════════════════════

/**
 * Lays the whole diagram out once.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.labelSizeFor] (ts, isSelf) -> {w, h}; supplied by the
 *        renderer, which is the module that knows how a label is formatted.
 * @param {boolean}  [opts.collide] force the avoidance passes on or off.
 * @returns {{stateById: Map, tsByPair: Map, groups: Array, geo: Map}}
 */
// Cached grouping. See buildLayoutContext for why it is safe to hold across
// frames, and js/state.js's stateIndex for the validation this mirrors.
let _grpArr = null, _grpLen = -1, _grpFirst = null, _grpLast = null;
let _grpStates = null, _grpVal = null;

function groupTransitions(transitions, stateById) {
  const n = transitions.length;
  if (_grpVal && _grpArr === transitions && _grpLen === n
    && _grpFirst === transitions[0] && _grpLast === transitions[n - 1]
    && _grpStates === stateById) return _grpVal;

  const tsByPair = new Map();
  for (const t of transitions) {
    const k = t.from + '|' + t.to;
    const arr = tsByPair.get(k);
    if (arr) arr.push(t); else tsByPair.set(k, [t]);
  }

  // App.transitions order decides group order, which decides which label gets
  // the contested spot. Deterministic, so a re-render never reshuffles labels.
  const groups = [];
  for (const [key, ts] of tsByPair) {
    const sep = key.indexOf('|');
    const from = stateById.get(key.slice(0, sep));
    const to = stateById.get(key.slice(sep + 1));
    if (from && to) groups.push({ key, from, to, ts });
  }

  _grpArr = transitions; _grpLen = n;
  _grpFirst = transitions[0]; _grpLast = transitions[n - 1];
  // The state index is itself replaced whenever App.states changes, so holding
  // it by identity is what makes "a state was deleted" invalidate the groups.
  _grpStates = stateById;
  _grpVal = { tsByPair, groups };
  return _grpVal;
}

/** Tests replace the model wholesale in ways the validator can coincide on. */
export function invalidateLayoutGroups() { _grpArr = null; _grpVal = null; }

export function buildLayoutContext(opts = {}) {
  const labelSizeFor = typeof opts.labelSizeFor === 'function' ? opts.labelSizeFor : defaultLabelSize;
  const states = App.states || [];
  const transitions = App.transitions || [];

  // The one id -> state index the whole app shares, rather than a private copy
  // built per pass. On a drag frame this pass runs once per frame.
  const stateById = stateIndex();

  // Grouping is a function of the transition list and the state list, and of
  // neither one's coordinates — so it survives every frame of a drag, which is
  // exactly when this pass runs sixty times a second. Validated the same way
  // the state index is (see getState): array identity, length, and the two end
  // elements catch every mutation the app performs.
  const { tsByPair, groups } = groupTransitions(transitions, stateById);

  const collide = opts.collide !== undefined
    ? !!opts.collide
    : states.length <= COLLISION_BUDGET_STATES && transitions.length <= COLLISION_BUDGET_TRANSITIONS;

  // A cull rect turns stages 2-3 into a pass over the edges near the screen
  // rather than over all of them. It is deliberately ignored while `collide` is
  // on: avoidance is global — a label is placed clear of the labels that exist —
  // so laying out a subset would put an edge in a different place depending on
  // where the camera happened to be. The two regimes do not overlap in practice
  // (a machine big enough to cull is past the collision budget), and where they
  // could, correctness wins.
  const view = !collide && opts.viewport ? opts.viewport : null;
  // How far outside the rect a curve can still bleed: a quadratic's deviation is
  // half its control offset, and a self-loop stands off by its own extent.
  const viewPad = view ? Math.max(num(cfg().curveOff, 45), 2 * nodeR() + 40) : 0;

  // ── the incremental path ──
  // Only where `collide` is on, which is the only regime that costs anything:
  // past the budget the stages are skipped and a full pass is already ~0.3ms.
  if (collide && opts.since) {
    const reused = relayout(opts.since, { groups, stateById, states, labelSizeFor });
    if (reused) return reused;
  }

  const cell = 2 * nodeR() + nodeClearance() * 2;
  const ctx = {
    stateById, tsByPair, groups, states, collide, view,
    nodeGrid: makeGrid(cell),
    incidentDirs: new Map(),
    edgeGrid: makeGrid(cell),
    edgeSamples: [],
    labelGrid: makeGrid(cell),
    placedLabels: [],
    geo: new Map()
  };

  // Only the avoidance stages query it, so a pass that has skipped them does not
  // pay to fill it — that loop alone was a thousand grid inserts per drag frame.
  if (collide) {
    ctx.pos = new Map();
    for (const s of states) {
      gridAdd(ctx.nodeGrid, s.x, s.y, s);
      // What the next pass diffs against to learn which states moved. Recorded
      // here rather than asked of the drag, so every mover is caught whoever
      // moved it — a pointer drag, an align snap, auto-pan, an undo.
      ctx.pos.set(s.id, { x: s.x, y: s.y });
    }
    ctx.manual = new Map();
    for (const g of groups) ctx.manual.set(g.key, manualShapeOf(g));
  }

  // Directions an edge leaves or arrives at each state, so a self-loop can be
  // put somewhere an arrowhead is not already landing. The start arrow counts:
  // it comes in horizontally from the left and a loop placed there would be
  // drawn straight through it.
  if (collide) {
    for (const g of groups) {
      if (g.from.id === g.to.id) continue;
      const a = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x);
      pushDir(ctx.incidentDirs, g.from.id, a);
      pushDir(ctx.incidentDirs, g.to.id, a + Math.PI);
    }
    if (App.startId && stateById.has(App.startId)) pushDir(ctx.incidentDirs, App.startId, Math.PI);
  }

  const loopMetrics = selfLoopMetrics();
  const arrowHead = num(cfg().arrowHeadSize, 6);
  const curveOff = num(cfg().curveOff, 45);
  const r = nodeR();

  ctx.env = { loopMetrics, arrowHead, curveOff, r, viewPad, labelSizeFor };

  // ── stage 2 + 3: paths ──
  for (const g of groups) computeGroupGeo(g, ctx);

  if (!collide) return ctx;

  // ── stage 4: labels ──
  if (!wants('smartLabels')) return ctx;
  // Sample every path first: a label needs to know where all the edges are, and
  // the edges are all final by now.
  for (const geo of ctx.geo.values()) sampleEdge(ctx, geo);
  for (const g of groups) placeGroupLabel(g, ctx);
  ctx.labelled = true;

  return ctx;
}

/**
 * One group's path. Extracted so the incremental pass below recomputes a
 * handful of edges through exactly this code rather than through a second copy
 * of it that could route them differently.
 */
function computeGroupGeo(g, ctx) {
  const { stateById, tsByPair, view, geo: out } = ctx;
  const { loopMetrics, arrowHead, curveOff, r, viewPad, labelSizeFor } = ctx.env;
  {
    const { from, to, ts, key } = g;
    // Off-screen edges get no geometry, which is also what tells renderTransitions
    // to evict their nodes: syncEdgeNode already declines a group with no geo.
    if (view && !rectHasSegment(view, from.x, from.y, to.x, to.y, viewPad)) return;
    const labelSize = labelSizeFor(ts, from.id === to.id) || { w: 30, h: TEXT_LINE_H };

    if (from.id === to.id) {
      const angle = chooseSelfLoopAngle(from, ts, ctx, loopMetrics, labelSize);
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const lp = selfLoopLabelPoint(from, angle, loopMetrics, labelSize);
      out.set(key, {
        key, from, to, isSelf: true, angle, loop: loopMetrics, labelSize,
        d: selfLoopPath(from.x, from.y, angle, loopMetrics),
        crvVal: 0,
        // The handle rides the loop's outer point, where dragging it reads as
        // "swing the loop round" rather than "bend the line".
        mx: from.x + loopMetrics.extent * ux,
        my: from.y + loopMetrics.extent * uy,
        lx: lp.x,
        ly: lp.y
      });
      return;
    }

    const hasRev = tsByPair.has(to.id + '|' + from.id);
    const base = hasRev ? curveOff : 0;
    // A hand-set curve is the user's answer to this exact question, so routing
    // does not get to overrule it.
    const manual = ts.find(t => Number.isFinite(t.curve));
    const dx0 = to.x - from.x, dy0 = to.y - from.y;
    const dist0 = Math.hypot(dx0, dy0);
    if (!dist0) return;
    const px = -dy0 / dist0, py = dx0 / dist0;
    const probe = {};
    const crvVal = manual ? manual.curve : routeCurve(from, to, ctx, px, py, base, probe);

    const edge = edgeGeometryFor(from, to, crvVal, r, arrowHead);
    if (!edge) return;
    const geo = {
      key, from, to, isSelf: false, labelSize, crvVal,
      // Manual curves are never re-routed, so they are never route-dirty; an
      // automatic one carries what routeCurve found.
      blocked: manual ? false : !!probe.blocked,
      sx: edge.sx, sy: edge.sy, ex: edge.ex, ey: edge.ey,
      mx: edge.mx, my: edge.my, px: edge.px, py: edge.py,
      d: edge.d
    };
    const mid = pathPoint(geo, 0.5);
    geo.lx = mid.x;
    geo.ly = mid.y;
    out.set(key, geo);
  }
}

// ══════════════════════════════════════════════════════════════════
//  INCREMENTAL RELAYOUT
// ══════════════════════════════════════════════════════════════════
// A drag moves one state out of two hundred, and the pass above recomputed
// every edge's route and every label's placement for all of them, sixty times
// a second. That is why the worst machine in the app was the one just *under*
// the collision budget: at 200 states a drag frame cost ~22ms against a 16.7ms
// budget, while at 210 states the stages are skipped wholesale and the same
// frame cost ~1ms.
//
// What actually changes when a state moves:
//
//   * edges incident to it — their endpoints moved;
//   * edges routed *around* it — it was a blocker on their chord, or has just
//     become one. Found by asking the previous pass's edge-sample grid what
//     runs near the position it left and the one it arrived at;
//   * labels of both of those, plus labels sitting near either position, since
//     a label is placed clear of states as well as of edges.
//
// Everything else keeps the geometry it had. That is not only cheaper but
// steadier: a label on the far side of the diagram re-optimising every frame
// of a drag it has nothing to do with reads as jitter.
//
// **The approximation, stated plainly.** A re-placed label avoids the labels
// that were already there, but a label that did *not* move is not re-examined
// against one that did — so a full pass could occasionally find a tidier
// arrangement than a long drag arrives at. Every structural edit runs a full
// pass (there is no `since` unless the caller passes one), so this cannot
// accumulate beyond a single gesture.

/** Is this point inside the band routeCurve would consider for that chord? */
function touchesChord(x, y, from, to, pad) {
  if (from.id === to.id) return Math.hypot(x - from.x, y - from.y) < pad;
  const { dist, t } = segmentDistance(x, y, from.x, from.y, to.x, to.y);
  // The same interior-only rule nodesNearChord applies: a state sitting on an
  // endpoint is a node overlap, which bending the edge cannot fix.
  if (t <= 0.02 || t >= 0.98) return false;
  return dist < pad;
}

/** The hand-set shape of a group, which routing must not overrule. */
function manualShapeOf(g) {
  for (const t of g.ts) {
    if (Number.isFinite(t.curve)) return t.curve;
    if (Number.isFinite(t.loopAngle)) return 1e6 + t.loopAngle;
  }
  return null;
}

/**
 * Rebuild only what a change since `prev` could have altered, or answer null
 * to mean "take the full pass".
 */
function relayout(prev, { groups, stateById, states, labelSizeFor }) {
  // The cheap disqualifiers first. Grouping and the id index are cached and
  // validated elsewhere, so identity is a sound test: a different object means
  // the machine's shape changed, and shape changes take the full pass.
  if (!prev || !prev.collide || !prev.labelled) return null;
  if (prev.groups !== groups || prev.stateById !== stateById) return null;
  if (!prev.pos || !prev.manual || prev.states !== states) return null;
  if (prev.env?.labelSizeFor !== labelSizeFor) return null;

  const r = nodeR();
  // Not a guess: this is the exact band routeCurve searches. It asks
  // nodesNearChord for states within `r + clearance + slack` of the *chord*,
  // with slack at most (curveOff + ROUTE_STEPS * (r + clearance)) / 2 — a
  // quadratic deviates by half its control offset. Testing against the drawn
  // path instead was the earlier mistake and it missed edges two ways at once:
  // the radius was too small, and an already-bent edge has been routed *away*
  // from the chord a moved state is standing on.
  const curveOff = Math.abs(num(cfg().curveOff, 45));
  const routePad = r + nodeClearance() + (curveOff + ROUTE_STEPS * (r + nodeClearance())) / 2;
  // What routeCurve's cheap early-out looks at, matched exactly.
  const nearPad = r + nodeClearance() + curveOff / 2 + 4;
  const labelReach = r + labelGap() + TEXT_LINE_H;

  const moved = [];
  for (const s of states) {
    const was = prev.pos.get(s.id);
    if (!was) return null;                       // a state appeared: full pass
    if (was.x !== s.x || was.y !== s.y) moved.push({ s, was });
  }

  const dirty = new Set();
  for (const g of groups) {
    if (manualShapeOf(g) !== prev.manual.get(g.key)) dirty.add(g.key);
  }
  if (!moved.length && !dirty.size) return prev;  // nothing at all changed

  const movedIds = new Set(moved.map(m => m.s.id));
  for (const g of groups) {
    if (movedIds.has(g.from.id) || movedIds.has(g.to.id)) dirty.add(g.key);
  }

  // Edges this state could be blocking, at either end of its move. Tested
  // against every group rather than through a grid: it is one segment-distance
  // per group per moved state, which at 200 groups is cheaper than the query
  // that would replace it — and, unlike a grid over the drawn paths, it is the
  // same question routeCurve will go on to ask.
  for (const g of groups) {
    if (dirty.has(g.key)) continue;
    const { from, to } = g;
    // An edge routeCurve found nothing near last frame returned `base` from its
    // cheap check and never ran the wide search — so only a state entering that
    // narrow band can change it. An edge that *did* have a blocker is sensitive
    // across the whole search width. Using the wide radius for both was correct
    // and marked roughly twice the edges dirty, since the set grows with area.
    const pad = prev.geo.get(g.key)?.blocked === false ? nearPad : routePad;
    for (const { s, was } of moved) {
      if (touchesChord(s.x, s.y, from, to, pad) || touchesChord(was.x, was.y, from, to, pad)) {
        dirty.add(g.key);
        break;
      }
    }
  }

  // A self-loop's direction is chosen to dodge the edges arriving at its own
  // state, so moving a neighbour re-aims it even though neither endpoint moved.
  for (const g of groups) {
    if (g.from.id !== g.to.id || dirty.has(g.key)) continue;
    for (const h of groups) {
      if (h.from.id === h.to.id) continue;
      if (h.from.id !== g.from.id && h.to.id !== g.from.id) continue;
      if (movedIds.has(h.from.id) || movedIds.has(h.to.id)) { dirty.add(g.key); break; }
    }
  }

  // Labels a moved state could have pushed, even where its edge did not move.
  for (const { s, was } of moved) {
    for (const [x, y] of [[was.x, was.y], [s.x, s.y]]) {
      for (const b of gridQuery(prev.labelGrid, x - labelReach, y - labelReach, x + labelReach, y + labelReach, prev.placedLabels)) {
        if (b.key) dirty.add(b.key);
      }
    }
  }

  // Rebuild the light indices outright. They are O(states) and O(groups) of
  // plain arithmetic — measured at a fraction of a millisecond at 200 states —
  // where maintaining them incrementally would mean removal from three grids
  // for a saving smaller than the bookkeeping.
  const cell = 2 * r + nodeClearance() * 2;
  const ctx = {
    stateById, tsByPair: prev.tsByPair, groups, states,
    collide: true, view: null,
    nodeGrid: makeGrid(cell),
    incidentDirs: new Map(),
    edgeGrid: makeGrid(cell),
    edgeSamples: [],
    labelGrid: makeGrid(cell),
    placedLabels: [],
    geo: new Map(),
    env: prev.env,
    pos: prev.pos,
    manual: prev.manual,
    labelled: true
  };
  for (const s of states) {
    gridAdd(ctx.nodeGrid, s.x, s.y, s);
    const was = ctx.pos.get(s.id);
    was.x = s.x; was.y = s.y;
  }
  for (const g of groups) {
    ctx.manual.set(g.key, manualShapeOf(g));
    if (g.from.id === g.to.id) continue;
    const a = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x);
    pushDir(ctx.incidentDirs, g.from.id, a);
    pushDir(ctx.incidentDirs, g.to.id, a + Math.PI);
  }
  if (App.startId && stateById.has(App.startId)) pushDir(ctx.incidentDirs, App.startId, Math.PI);

  // Clean edges keep the geo object they had, samples and label box included.
  for (const g of groups) {
    if (dirty.has(g.key)) continue;
    const geo = prev.geo.get(g.key);
    if (geo) ctx.geo.set(g.key, geo);
  }
  // Then route the dirty ones against a grid that already holds every state.
  for (const g of groups) {
    if (dirty.has(g.key)) computeGroupGeo(g, ctx);
  }

  // Seed the avoidance structures with what survived, so a re-placed label is
  // placed clear of the labels and edges that did not move.
  for (const g of groups) {
    const geo = ctx.geo.get(g.key);
    if (!geo) continue;
    if (dirty.has(g.key)) { geo.samples = null; geo.box = null; }
    sampleEdge(ctx, geo);
    if (geo.box) {
      ctx.placedLabels.push(geo.box);
      gridAdd(ctx.labelGrid, geo.box.x + geo.box.w / 2, geo.box.y + geo.box.h / 2, geo.box);
    }
  }
  for (const g of groups) {
    if (dirty.has(g.key)) placeGroupLabel(g, ctx);
  }

  return ctx;
}

function placeGroupLabel(g, ctx) {
  const geo = ctx.geo.get(g.key);
  if (!geo) return;
  const spot = placeLabel(geo, ctx);
  if (!spot) return;
  geo.lx = spot.x;
  geo.ly = spot.y;
  // The box carries its own key, so the incremental pass can ask the label grid
  // which edges' labels sit near a state that moved.
  const box = rectAt(spot.x, spot.y, geo.labelSize.w, geo.labelSize.h);
  box.key = g.key;
  geo.box = box;
  ctx.placedLabels.push(box);
  gridAdd(ctx.labelGrid, spot.x, spot.y, box);
}

function pushDir(map, id, angle) {
  const arr = map.get(id);
  if (arr) arr.push(angle); else map.set(id, [angle]);
}

// Falls back to the supplied direction when the two points coincide, which
// happens when a curve offset of zero puts the control point on a node centre.
function normalize(x, y, fx, fy) {
  const len = Math.hypot(x, y);
  return len > 0.001 ? { x: x / len, y: y / len } : { x: fx, y: fy };
}

// The points are cached on the geo, so an edge the incremental pass reused is
// re-inserted into the grid rather than re-walked along its own path.
function sampleEdge(ctx, geo) {
  if (!geo.samples) geo.samples = buildSamples(geo);
  for (const p of geo.samples) {
    ctx.edgeSamples.push(p);
    gridAdd(ctx.edgeGrid, p.x, p.y, p);
  }
}

function buildSamples(geo) {
  const out = [];
  const add = (x, y) => { out.push({ x, y, key: geo.key }); };
  if (geo.isSelf) {
    const m = geo.loop;
    const cx = geo.from.x + m.centreOut * Math.cos(geo.angle);
    const cy = geo.from.y + m.centreOut * Math.sin(geo.angle);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(cx + m.ss * Math.cos(a), cy + m.ss * Math.sin(a));
    }
    return out;
  }
  // Spaced by roughly a label's height rather than by a fixed count: a long edge
  // sampled six times leaves gaps a whole label fits through, and would be
  // declared clear of a path running straight under it.
  //
  // The cap is a deliberate trade. Every sample lands in the grid that every
  // label then queries, so the count is paid for by all of them — and this is
  // the lowest-weighted of the three label constraints, worth much less than
  // exact placement against states and other labels. Edges long enough to hit
  // the cap get coarser spacing rather than everything getting slower.
  const span = Math.hypot(geo.ex - geo.sx, geo.ey - geo.sy) + Math.abs(geo.crvVal);
  const n = Math.max(6, Math.min(12, Math.round(span / 30)));
  for (let i = 0; i <= n; i++) {
    const p = pathPoint(geo, i / n);
    add(p.x, p.y);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  NODE OVERLAP
// ══════════════════════════════════════════════════════════════════

// Above this many states the all-pairs loop below is replaced by a grid sweep.
// The threshold is not a quality knob — both paths separate the same circles to
// the same distance — it is where building the grid starts costing less than the
// comparisons it saves.
const OVERLAP_GRID_STATES = 60;

// Every pair within `min` of each other, found through a uniform grid whose cell
// is `min`, so each state only ever tests the nine cells around it. The all-pairs
// version is 24 passes of n²/2: dropping a single state on a 1000-state machine
// meant twelve million distance tests before the pointer came back, which is the
// whole of why a drop used to hang.
//
// Ordering matters and is preserved. The pairs come out in list order — a state
// against its own later neighbours — because the coincident-centre case derives
// its separation direction from the pair's indices, and a different visiting
// order would fan a pile out differently.
function forEachNearPair(list, min, fn) {
  const cell = min;
  const grid = new Map();
  const key = (cx, cy) => cx + ',' + cy;
  // The cell each state was filed under, kept rather than recomputed. The pass
  // moves states as it goes, so asking a state which cell it is in *now* would
  // send the query looking in a neighbourhood the grid never filed its partners
  // into — which is how a pile of coincident states came apart into a pile of
  // slightly-less-coincident ones and the relaxation declared itself finished.
  const cells = new Int32Array(list.length * 2);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const cx = Math.floor(s.x / cell), cy = Math.floor(s.y / cell);
    cells[i * 2] = cx; cells[i * 2 + 1] = cy;
    const k = key(cx, cy);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i); else grid.set(k, [i]);
  }
  for (let i = 0; i < list.length; i++) {
    const cx = cells[i * 2], cy = cells[i * 2 + 1];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          // Each unordered pair once, in the same orientation the all-pairs
          // loop would have visited it.
          if (j <= i) continue;
          fn(i, j);
        }
      }
    }
  }
}

/**
 * Pushes overlapping state circles apart until every pair clears `gap`.
 *
 * Relaxation rather than a solve: each pass separates every overlapping pair by
 * half the penetration each, which converges in a few iterations for the cases
 * that occur (a state dropped on another, a pasted copy landing on its
 * original). `movable` pins everything outside it, so dropping a node onto a
 * crowd moves the node and not the crowd.
 *
 * @returns {boolean} whether anything moved.
 */
export function resolveNodeOverlaps(states, opts = {}) {
  const list = states || [];
  if (list.length < 2) return false;
  const gap = opts.gap !== undefined ? opts.gap : minNodeGap();
  const min = 2 * nodeR() + gap;
  const movable = opts.movable ? new Set(opts.movable) : null;
  const canMove = s => !movable || movable.has(s.id);
  const iterations = opts.iterations || 24;
  // `grid` forces one path or the other. The two produce equivalent separations
  // — that is what the threshold assumes — so it exists to let a test say so,
  // rather than to offer a choice worth making.
  const useGrid = opts.grid !== undefined
    ? (!!opts.grid && min > 0)
    : (list.length > OVERLAP_GRID_STATES && min > 0);
  let moved = false;

  for (let pass = 0; pass < iterations; pass++) {
    let worst = 0;
    const pair = (i, j) => {
      const a = list[i], b = list[j];
      const aFree = canMove(a), bFree = canMove(b);
      if (!aFree && !bFree) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= min) return;
      // Exactly coincident centres have no direction to separate along, so
      // one is derived from the pair's position in the list — deterministic,
      // and different for each pair, so a pile fans out instead of stacking.
      // The unit vector is built here rather than by dividing through by a
      // stand-in distance: dividing by an epsilon scales the push by a
      // thousand and throws the state clear off the canvas.
      let ux, uy;
      if (dist < 0.001) {
        const seed = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
        ux = Math.cos(seed); uy = Math.sin(seed);
      } else {
        ux = dx / dist; uy = dy / dist;
      }
      const push = min - dist;
      worst = Math.max(worst, push);
      const shareA = aFree ? (bFree ? 0.5 : 1) : 0;
      const shareB = bFree ? (aFree ? 0.5 : 1) : 0;
      a.x -= ux * push * shareA; a.y -= uy * push * shareA;
      b.x += ux * push * shareB; b.y += uy * push * shareB;
      moved = true;
    };

    if (useGrid) {
      forEachNearPair(list, min, pair);
    } else {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) pair(i, j);
      }
    }
    if (worst < 0.5) break;
  }
  return moved;
}

// ══════════════════════════════════════════════════════════════════
//  BOUNDS
// ══════════════════════════════════════════════════════════════════

/**
 * Grows a bounding box to cover what the edges add to it — self-loops standing
 * off a node, labels pushed away from a crowded midpoint — so "fit to screen"
 * and a cropped export frame the drawing rather than just the states.
 */
export function includeLayoutBounds(ctx, grow) {
  if (!ctx) return;
  for (const geo of ctx.geo.values()) {
    const { w, h } = geo.labelSize || { w: 0, h: 0 };
    grow(geo.lx - w / 2, geo.ly - h / 2, geo.lx + w / 2, geo.ly + h / 2);
    if (geo.isSelf) {
      const m = geo.loop;
      const cx = geo.from.x + m.centreOut * Math.cos(geo.angle);
      const cy = geo.from.y + m.centreOut * Math.sin(geo.angle);
      grow(cx - m.ss, cy - m.ss, cx + m.ss, cy + m.ss);
    } else if (geo.crvVal) {
      // The control point overshoots the curve by 2×, so half of it is the
      // furthest the drawn path actually gets from the chord.
      grow(Math.min(geo.sx, geo.mx, geo.ex), Math.min(geo.sy, geo.my, geo.ey),
        Math.max(geo.sx, geo.mx, geo.ex), Math.max(geo.sy, geo.my, geo.ey));
    }
  }
}
