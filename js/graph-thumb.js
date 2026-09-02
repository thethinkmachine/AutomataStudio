// ══════════════════════════════════════════════════════════════════
//  A GRAPH, DRAWN SMALL
// ══════════════════════════════════════════════════════════════════
// The minimap's arithmetic, pulled out so a building block can draw its own
// interior with it.
//
// A block on the canvas *is* a preview: a box with a title strip and, under it,
// the machine inside drawn the way the minimap draws the whole diagram. That is
// the point of the feature — you read a block by its silhouette, the way you
// read the minimap — so the two must not be two implementations that happen to
// look alike. They are one description here and two painters: the minimap fills
// a 2D canvas, the block emits SVG.
//
// The split is deliberate. Sharing the *painter* is impossible — one draws with
// `arc`/`lineTo`, the other with a `d` string — and sharing nothing means the
// block preview slowly stops matching the map it is meant to quote. So what is
// shared is everything that decides *where things go*: the padded bounding box,
// the uniform fit, the node radius clamp, and the edge segments.
//
// Two things in here look like details and are not:
//
//   * **Parallel transitions collapse to one drawn edge.** The canvas draws
//     them as one path with a stacked label, and stroking five identical curves
//     at this scale only darkens the line.
//   * **A self-loop is its own subpath.** Drawn as from→to it is a zero-length
//     segment that strokes nothing at all, and appended to the previous edge
//     without a break it is joined to it by a line across the whole thumbnail.
//     Both were real bugs in the minimap; a rewrite is how they come back.
//
// Import-free: it is handed nodes and edges and knows nothing about App, the
// page, or which of the two callers it is serving.

/** How much of the box is left as margin around the drawing. */
export const THUMB_PAD_RATIO = 0.07;

/** A drawn node never gets smaller than this or bigger than that. */
export const THUMB_NODE_R_MIN = 1.6;
export const THUMB_NODE_R_MAX = 7;

/** Smallest span a thumbnail will frame, so one node does not fill the box. */
export const THUMB_MIN_SPAN = 120;

/**
 * The world box a set of nodes occupies, padded.
 *
 * `radiusOf` lets a caller answer per node — a building block is a box and a
 * state is a circle — and defaults to one radius for all of them.
 */
export function thumbBounds(nodes, r = 22, radiusOf = null) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes || []) {
    const rr = radiusOf ? radiusOf(n) : r;
    if (n.x - rr < x0) x0 = n.x - rr;
    if (n.y - rr < y0) y0 = n.y - rr;
    if (n.x + rr > x1) x1 = n.x + rr;
    if (n.y + rr > y1) y1 = n.y + rr;
  }
  if (!Number.isFinite(x0)) return null;
  const pad = Math.max(x1 - x0, y1 - y0) * THUMB_PAD_RATIO + r;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/**
 * A uniform scale from a world box into a screen box, centred.
 *
 * Uniform rather than per-axis: a thumbnail that stretched to fill its box
 * would not be the diagram any more, which is the whole thing a preview is
 * for — recognising a machine by its shape.
 */
export function thumbFit(bounds, box) {
  const bw = Math.max(bounds ? bounds.x1 - bounds.x0 : 0, THUMB_MIN_SPAN);
  const bh = Math.max(bounds ? bounds.y1 - bounds.y0 : 0, THUMB_MIN_SPAN);
  const scale = Math.min(box.w / bw, box.h / bh);
  const cx = bounds ? (bounds.x0 + bounds.x1) / 2 : 0;
  const cy = bounds ? (bounds.y0 + bounds.y1) / 2 : 0;
  const ox = box.x + box.w / 2, oy = box.y + box.h / 2;
  return {
    scale,
    px: wx => ox + (wx - cx) * scale,
    py: wy => oy + (wy - cy) * scale
  };
}

/** The radius a node is drawn at, clamped so it stays a dot rather than a blob. */
export function thumbNodeRadius(scale, r = 22) {
  return Math.max(THUMB_NODE_R_MIN, Math.min(THUMB_NODE_R_MAX, r * scale));
}

/**
 * One entry per drawn edge: parallel transitions between a pair collapse into
 * it, and it carries whichever hand-set shape the group has.
 *
 * Cached by the caller where it matters — the minimap repaints on every frame
 * of every pan — but computed here so the two callers cannot disagree about
 * what "one edge" means.
 */
export function thumbEdgePairs(transitions) {
  const byPair = new Map();
  for (const t of transitions || []) {
    const key = t.from + '|' + t.to;
    let e = byPair.get(key);
    if (!e) { e = { from: t.from, to: t.to, curve: null, loopAngle: null }; byPair.set(key, e); }
    if (e.curve === null && Number.isFinite(t.curve)) e.curve = t.curve;
    if (e.loopAngle === null && Number.isFinite(t.loopAngle)) e.loopAngle = t.loopAngle;
  }
  return byPair;
}

/**
 * Every drawn edge as a shape, in screen coordinates.
 *
 *   { kind: 'loop',  cx, cy, r }
 *   { kind: 'line',  ax, ay, bx, by }
 *   { kind: 'curve', ax, ay, cx, cy, bx, by }     quadratic
 *
 * The routing decision is mirrored cheaply rather than reproduced: a hand-set
 * bend wins, and otherwise a pair with a reverse edge splays so the two are
 * distinguishable. The collision-avoidance detour is deliberately left out — at
 * this scale it moves a line by well under a pixel, and running the real layout
 * pass per preview per frame is the cost this whole module exists to avoid.
 */
export function thumbEdgeSegments(pairs, byId, project, nodeR, curveOff = 45) {
  const { px, py, scale } = project;
  const loopR = Math.max(1.4, nodeR * 0.62);
  const out = [];
  for (const [, e] of pairs) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) continue;

    if (from === to) {
      // Up is the layout's default direction; a dragged loop stores its own.
      const a = Number.isFinite(e.loopAngle) ? e.loopAngle : -Math.PI / 2;
      out.push({
        kind: 'loop',
        cx: px(from.x) + Math.cos(a) * (nodeR + loopR * 0.55),
        cy: py(from.y) + Math.sin(a) * (nodeR + loopR * 0.55),
        r: loopR
      });
      continue;
    }

    const ax = px(from.x), ay = py(from.y), bx = px(to.x), by = py(to.y);
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (!dist) continue;
    const crv = e.curve !== null ? e.curve : (pairs.has(e.to + '|' + e.from) ? curveOff : 0);
    if (!crv) { out.push({ kind: 'line', ax, ay, bx, by }); continue; }
    const nx = -dy / dist, ny = dx / dist;
    out.push({
      kind: 'curve', ax, ay, bx, by,
      cx: (ax + bx) / 2 + nx * crv * scale,
      cy: (ay + by) / 2 + ny * crv * scale
    });
  }
  return out;
}

/**
 * The same segments as one SVG path string.
 *
 * Every subpath begins with its own `M`, which is what keeps a self-loop from
 * being joined to whatever was drawn before it. A circle is two arcs rather
 * than one, because an arc of exactly 360° has no defined sweep and browsers
 * draw nothing at all for it.
 */
export function thumbEdgePath(segments) {
  const d = [];
  for (const s of segments) {
    if (s.kind === 'loop') {
      d.push(`M ${r2(s.cx - s.r)} ${r2(s.cy)}`);
      d.push(`a ${r2(s.r)} ${r2(s.r)} 0 1 0 ${r2(s.r * 2)} 0`);
      d.push(`a ${r2(s.r)} ${r2(s.r)} 0 1 0 ${r2(-s.r * 2)} 0`);
    } else if (s.kind === 'line') {
      d.push(`M ${r2(s.ax)} ${r2(s.ay)} L ${r2(s.bx)} ${r2(s.by)}`);
    } else {
      d.push(`M ${r2(s.ax)} ${r2(s.ay)} Q ${r2(s.cx)} ${r2(s.cy)} ${r2(s.bx)} ${r2(s.by)}`);
    }
  }
  return d.join(' ');
}

// Two decimals. A preview is a few dozen pixels across, so the third one is
// noise that only makes the attribute longer — and these strings end up in
// every export of every diagram that has a block on it.
function r2(v) { return Math.round(v * 100) / 100; }
