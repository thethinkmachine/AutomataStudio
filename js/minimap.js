// ══════════════════════════════════════════════════════════════════
//  MINIMAP
// ══════════════════════════════════════════════════════════════════
// A miniature of the diagram plus the rectangle showing what the camera can
// see, painted to a 2D canvas rather than SVG — at this size the diagram is a
// few hundred primitives and diffing DOM nodes would cost more than redrawing.
//
// Three things here are worth reading before changing anything.
//
// **The frame is animated, not recomputed.** What the map shows is a world
// rectangle wide enough for the content *and* the viewport. Both move, so that
// rectangle moves — and deriving it fresh every paint (which is what this used
// to do) means the whole diagram rescales and slides under the cursor on every
// frame of a pan, which is exactly when it needs to hold still. Instead there
// are two frames: `goal`, recomputed per paint, and `view`, which eases toward
// it. The easing absorbs the per-frame churn, so the map glides rather than
// snapping, and a pan inside the current frame moves nothing but the viewport
// rectangle.
//
// **`view` is stored as centre + width, never as a box.** Height is derived
// from the canvas aspect, so the scale is uniform by construction and easing
// the three numbers independently cannot shear or squash the picture. Width
// eases in log space, so a 2× zoom takes the same time whether it is 100→200
// or 1000→2000.
//
// **Paint is coalesced into one animation frame.** Every entry point below
// funnels into scheduleMinimap(); the loop re-arms itself only while the frame
// is still moving, so an idle map costs nothing. renderMinimap() stays as the
// synchronous escape hatch for callers that want the paint to have happened by
// the time they return (applyTheme).
//
// Sizing: the backing store is devicePixelRatio-scaled and the context is
// pre-scaled to match, so every coordinate below is in CSS pixels and 1px
// strokes are 1px on any display.

import { animMotionOk, isSyncRAF } from './anim.js';
import { applyCamera, normalizeWheelDeltas } from './canvas.js';
import { includeDividerBounds, isRectDivider } from './dividers.js';
import { markDirty } from './history.js';
import { includeNoteBounds, noteBoxLayout, resolveNotePos } from './notes.js';
import { $, App, stateById } from './state.js';
import { Change, subscribe } from './store.js';
import { fitToScreen, layoutCanvasOverlays, visibleCanvasBox } from './ui.js';

// A structural edit changes what is drawn; a CANVAS change moves the selection
// highlight or the camera. Both are just "repaint", since the paint is one
// cheap pass rather than a diff.
subscribe(Change.GRAPH, scheduleMinimap);
subscribe(Change.CANVAS, scheduleMinimap);

// ── tuning ────────────────────────────────────────────────────────

// Breathing room around the content, as a fraction of its longer side.
const PAD_RATIO = 0.07;
// Easing time constant. Roughly: the frame covers 63% of the remaining
// distance every TAU_MS regardless of refresh rate.
const TAU_MS = 190;
// Ignore goal drift below this fraction of the frame width. Without it a
// stationary camera still produces sub-pixel goal changes and the loop never
// gets to stop.
const RETARGET_EPS = 0.0015;
// Close enough to call it arrived, so the loop can stop re-arming.
const SETTLE_EPS = 0.0008;
// Past these the goal is a different machine — a workspace switch, a load, an
// algorithm result — not a pan. Easing across it would fly the map through a
// long meaningless zoom-out, so it cuts instead.
const SNAP_ZOOM_RATIO = 4;
const SNAP_PAN_SPANS = 3;
// Smallest world span the map will frame, so a single state does not fill it.
const MIN_SPAN = 120;
// Drawn node radius, clamped: a 200-state diagram must not shrink its states
// to nothing, and a two-state one must not blow them up into circles.
const NODE_R_MIN = 1.6, NODE_R_MAX = 7;

// ── frame state ───────────────────────────────────────────────────

let view = null;   // { cx, cy, w } — the frame being drawn
let goal = null;   // { cx, cy, w } — the frame it is heading for
let armed = false;
let lastT = 0;

function nowMs() {
  return typeof performance === 'object' && performance && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

/** Drop the eased frame so the next paint cuts straight to the new content. */
export function resetMinimapFrame() {
  view = null;
  goal = null;
}

/**
 * Ask for a repaint. Safe to call at any rate — many calls in one frame
 * collapse into a single paint, which is what lets the camera, the store and
 * the drag paths all poke it without coordinating.
 */
export function scheduleMinimap() {
  if (armed) return;
  armed = true;
  lastT = 0;
  requestAnimationFrame(tick);
}

function tick(t) {
  armed = false;
  const now = typeof t === 'number' ? t : nowMs();
  // First frame after an idle period has no previous timestamp to subtract.
  const dt = lastT ? now - lastT : 16;
  lastT = now;
  if (paint(dt)) return;
  armed = true;
  requestAnimationFrame(tick);
}

/**
 * Repaint synchronously, right now. Only worth using when the caller needs the
 * pixels to exist before it returns; everything else should schedule.
 */
export function renderMinimap() {
  // dt = 0 draws the frame where it currently is without advancing it, so if it
  // was mid-glide this paint alone would leave it stranded there — nothing else
  // is going to re-arm the loop.
  if (!paint(0)) scheduleMinimap();
}

// ── framing ───────────────────────────────────────────────────────

// The camera's visible region in world coordinates. It tracks the part of the
// canvas that is not hidden behind an overlaying panel — otherwise the drawn
// rectangle reads wider than what you can actually see, and sits offset from
// the content it is supposed to be framing.
function worldViewport() {
  const vis = visibleCanvasBox();
  const z = App.cam.z || 1;
  return {
    x0: (vis.x - App.cam.x) / z,
    y0: (vis.y - App.cam.y) / z,
    x1: (vis.x + vis.w - App.cam.x) / z,
    y1: (vis.y + vis.h - App.cam.y) / z
  };
}

function computeGoal(cssW, cssH) {
  const aspect = cssW / cssH;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (ax, ay, bx, by) => {
    if (ax < x0) x0 = ax; if (ay < y0) y0 = ay;
    if (bx > x1) x1 = bx; if (by > y1) y1 = by;
  };

  const r = App.config.radius + 4;
  for (const s of App.states) add(s.x - r, s.y - r, s.x + r, s.y + r);
  includeNoteBounds(add);
  includeDividerBounds(add);

  // Padding goes on the content only. The viewport is a hard requirement — it
  // has to fit or its rectangle gets drawn off the edge of the map — so it is
  // unioned in afterwards, unpadded.
  if (Number.isFinite(x0)) {
    const pad = Math.max(x1 - x0, y1 - y0) * PAD_RATIO + r;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  }
  const vp = worldViewport();
  add(vp.x0, vp.y0, vp.x1, vp.y1);
  if (!Number.isFinite(x0)) return { cx: 0, cy: 0, w: MIN_SPAN };

  // A small outset over the union, so that when the content fits entirely
  // inside the camera — after fit-to-screen, say — the viewport rectangle is
  // drawn just inside the edge rather than flush against it.
  let w = Math.max(x1 - x0, MIN_SPAN) * 1.04;
  let h = Math.max(y1 - y0, MIN_SPAN / aspect) * 1.04;
  // Letterbox in world space rather than at draw time: with the goal already
  // matching the canvas aspect, the projection is a single uniform scale and
  // the two offsets never need separate easing.
  if (w / h < aspect) w = h * aspect;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w };
}

// Point the ease at a new frame, unless the new one is close enough to the
// current target to be noise.
function retarget(cssW, cssH) {
  const next = computeGoal(cssW, cssH);
  if (!goal || !view) { goal = next; view = { ...next }; return; }

  const ratio = next.w > goal.w ? next.w / goal.w : goal.w / next.w;
  const moved = Math.max(Math.abs(next.cx - goal.cx), Math.abs(next.cy - goal.cy));
  if (ratio > SNAP_ZOOM_RATIO || moved > SNAP_PAN_SPANS * goal.w) {
    goal = next; view = { ...next };
    return;
  }

  const tol = RETARGET_EPS * goal.w;
  if (Math.abs(next.cx - goal.cx) < tol
    && Math.abs(next.cy - goal.cy) < tol
    && Math.abs(next.w - goal.w) < tol) return;
  goal = next;
}

// Frame-rate independent exponential approach — the same law js/anim.js uses,
// and for the same reason: `cur += (tgt - cur) * k` per frame would settle
// twice as fast on a 144Hz display as on 60Hz.
// Deliberately *not* animEnabled(). That also consults config.render
// animateLayout, which is about easing edge geometry on the canvas — a
// different question, and one a workspace blob can carry a stale answer to.
// The frame glide has only two reasons to be off: the host runs rAF
// synchronously (the test DOM), or the user asked for reduced motion.
function easingOn() {
  return !isSyncRAF() && animMotionOk();
}

function stepView(dt) {
  if (!view || !goal) return true;
  if (!easingOn()) { view = { ...goal }; return true; }

  const k = 1 - Math.exp(-Math.min(Math.max(dt, 1), 80) / TAU_MS);
  view.cx += (goal.cx - view.cx) * k;
  view.cy += (goal.cy - view.cy) * k;
  view.w = Math.exp(Math.log(view.w) + (Math.log(goal.w) - Math.log(view.w)) * k);

  const eps = SETTLE_EPS * goal.w;
  const done = Math.abs(goal.cx - view.cx) < eps
    && Math.abs(goal.cy - view.cy) < eps
    && Math.abs(goal.w - view.w) < eps;
  if (done) view = { ...goal };
  return done;
}

// ── backing store ─────────────────────────────────────────────────

function syncBackingStore(canvas) {
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  let cssW = 0, cssH = 0;
  if (typeof canvas.getBoundingClientRect === 'function') {
    const r = canvas.getBoundingClientRect();
    cssW = r.width || 0;
    cssH = r.height || 0;
  }
  // Nothing measurable — a hidden container, or a DOM that does not do layout.
  // Fall back to whatever the backing store already is instead of resizing it
  // to zero, which would blank the map.
  if (!cssW || !cssH) {
    return { w: canvas.width || 0, h: canvas.height || 0, dpr: 1 };
  }
  const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  return { w: cssW, h: cssH, dpr };
}

// ── drawing ───────────────────────────────────────────────────────

function palette() {
  const p = App.config.export;
  return {
    bg: p.bg,
    nodeFill: p.nodeFill,
    nodeStroke: p.nodeStroke,
    startStroke: p.startStroke,
    accStroke: p.accStroke,
    actFill: p.actFill,
    actStroke: p.actStroke,
    edgeStroke: p.edgeStroke,
    textFill: p.textFill,
    // Themes carry this; a config blob written before it existed does not.
    viewport: p.viewportStroke || p.actStroke
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Which states the simulation cursor is sitting on. Deterministic simulators
// record a single `state`, the subset/nondeterministic ones an array — this is
// the whole reason the minimap is worth looking at mid-run on a big machine,
// where the active state is usually off screen.
function simActiveStates() {
  const step = App.simSteps && App.simSteps[App.simIdx];
  if (!step) return null;
  if (Array.isArray(step.states)) return step.states.length ? new Set(step.states) : null;
  if (step.state) return new Set([step.state]);
  return null;
}

function paint(dt) {
  const canvas = $('minimap-canvas');
  if (!canvas || !canvas.isConnected) return true;
  // Collapsed to display:none. Painting would work — the backing store is still
  // there — but every camera move would burn a frame on pixels nobody can see,
  // and toggleMinimap re-frames from scratch when it comes back anyway.
  const box = $('minimap-container');
  if (box && box.classList.contains('minimap-hidden')) return true;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return true;

  const size = syncBackingStore(canvas);
  const W = size.w, H = size.h;
  if (!W || !H) return true;

  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pal = palette();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  retarget(W, H);
  const settled = stepView(dt);

  const hasContent = App.states.length || App.notes.length || App.dividers.length;
  if (!hasContent) { canvas._mm = null; return settled; }

  // World → CSS pixels. One scale for both axes, because computeGoal already
  // matched the frame to the canvas aspect.
  const viewH = view.w * (H / W);
  const ox = view.cx - view.w / 2;
  const oy = view.cy - viewH / 2;
  const scale = W / view.w;
  const px = x => (x - ox) * scale;
  const py = y => (y - oy) * scale;
  canvas._mm = { scale, ox, oy };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawDividers(ctx, pal, px, py, scale);
  drawNotes(ctx, pal, px, py, scale);
  drawEdges(ctx, pal, px, py, scale);
  drawStates(ctx, pal, px, py, scale);
  drawViewport(ctx, pal, px, py, scale, W, H);

  ctx.globalAlpha = 1;
  return settled;
}

function drawDividers(ctx, pal, px, py, scale) {
  if (!App.dividers.length) return;
  ctx.save();
  ctx.strokeStyle = pal.textFill;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.setLineDash([2.5, 2.5]);
  for (const d of App.dividers) {
    const ax = px(d.x1), ay = py(d.y1), bx = px(d.x2), by = py(d.y2);
    ctx.beginPath();
    if (isRectDivider(d)) {
      // The two stored points are opposite corners, so a plain moveTo/lineTo
      // would draw the box's diagonal instead of the box.
      ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    } else {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Notes get their real box rather than a fixed dot, so a long annotation reads
// as the large object it is on the canvas. Floored at a few pixels so a note is
// never invisible on a zoomed-out frame.
function drawNotes(ctx, pal, px, py, scale) {
  if (!App.notes.length) return;
  ctx.save();
  for (const note of App.notes) {
    const pos = resolveNotePos(note);
    const box = noteBoxLayout(note);
    const w = Math.max(3, box.w * scale), h = Math.max(2.5, box.h * scale);
    const x = px(pos.x) - w / 2, y = py(pos.y) - h / 2;
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, 1.5);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = pal.textFill;
    ctx.fill();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = pal.textFill;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.restore();
}

// Parallel transitions between the same pair share one drawn edge — the canvas
// draws them as one path with a stacked label, and stroking five identical
// curves here would only darken the line.
// Cached: the pairs depend on the transition list and on nothing that moves, so
// a pan does not rebuild them. Validated the same way the state index is —
// array identity, length and the two end elements. See js/state.js.
let _pairsArr = null, _pairsLen = -1, _pairsFirst = null, _pairsLast = null, _pairsVal = null;

function edgePairs() {
  const list = App.transitions;
  const n = list.length;
  if (_pairsVal && _pairsArr === list && _pairsLen === n
    && _pairsFirst === list[0] && _pairsLast === list[n - 1]) return _pairsVal;
  const byPair = new Map();
  for (const t of App.transitions) {
    const key = t.from + '|' + t.to;
    let e = byPair.get(key);
    if (!e) { e = { from: t.from, to: t.to, curve: null, loopAngle: null }; byPair.set(key, e); }
    if (e.curve === null && Number.isFinite(t.curve)) e.curve = t.curve;
    if (e.loopAngle === null && Number.isFinite(t.loopAngle)) e.loopAngle = t.loopAngle;
  }
  _pairsArr = list; _pairsLen = n; _pairsFirst = list[0]; _pairsLast = list[n - 1];
  _pairsVal = byPair;
  return byPair;
}

// Every edge is stroked in one colour at one width, so the whole diagram is one
// path and one stroke() rather than one of each per edge. On a 2000-transition
// machine that is the difference between four thousand canvas calls per pan
// frame and two — and the map repaints on every frame of every pan.
function drawEdges(ctx, pal, px, py, scale) {
  if (!App.transitions.length) return;
  const byId = stateById();

  const pairs = edgePairs();
  const r = App.config.radius || 22;
  const loopR = Math.max(1.4, r * 0.62 * scale);
  const curveOff = (App.config.render && App.config.render.curveOff) || 45;

  ctx.save();
  ctx.strokeStyle = pal.edgeStroke;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(0.6, Math.min(1.5, r * 0.06 * scale + 0.5));
  ctx.beginPath();

  for (const [, e] of pairs) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) continue;

    if (from === to) {
      // A self-loop drawn as from→to is a zero-length segment, which strokes
      // nothing at all — the old map showed loop-heavy machines as loose dots.
      // Up is the layout's default direction; a dragged loop stores its own.
      const a = Number.isFinite(e.loopAngle) ? e.loopAngle : -Math.PI / 2;
      const nodeR = Math.max(NODE_R_MIN, Math.min(NODE_R_MAX, r * scale));
      const cx = px(from.x) + Math.cos(a) * (nodeR + loopR * 0.55);
      const cy = py(from.y) + Math.sin(a) * (nodeR + loopR * 0.55);
      // The moveTo is what keeps this a subpath of its own: without it the arc
      // is joined to wherever the previous edge ended by a line across the map.
      ctx.moveTo(cx + loopR, cy);
      ctx.arc(cx, cy, loopR, 0, Math.PI * 2);
      continue;
    }

    const ax = px(from.x), ay = py(from.y), bx = px(to.x), by = py(to.y);
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (!dist) continue;
    // Mirrors buildLayoutContext's routing decision cheaply: a hand-set bend
    // wins, otherwise a pair with a reverse edge splays so the two are
    // distinguishable. The collision-avoidance detour is deliberately not
    // reproduced — at this scale it would move a line by under a pixel.
    const crv = e.curve !== null ? e.curve : (pairs.has(e.to + '|' + e.from) ? curveOff : 0);
    ctx.moveTo(ax, ay);
    if (crv) {
      const nx = -dy / dist, ny = dx / dist;
      ctx.quadraticCurveTo((ax + bx) / 2 + nx * crv * scale, (ay + by) / 2 + ny * crv * scale, bx, by);
    } else {
      ctx.lineTo(bx, by);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Encoding, so the map answers "what am I looking at" without the labels:
//   plain      node fill, hairline ring
//   start      ring in the start colour
//   accepting  a second ring outside, in the accept colour
//   selected   accent fill and ring
//   running    solid accent with a halo — the simulation cursor
// Batched by style, for the same reason the edges are: a thousand states meant
// a thousand beginPath/fill/stroke triples per pan frame, and there are only
// ever a handful of distinct styles among them. Each bucket becomes one path,
// filled once and stroked once.
//
// This does change one thing, and it is worth being explicit about: within a
// bucket every fill now happens before every stroke, so two overlapping nodes
// of the *same* style show both outlines rather than the later one covering the
// earlier. At two-pixel radii on a thumbnail that is invisible, and separate
// buckets still paint in the order they were first seen.
function drawStates(ctx, pal, px, py, scale) {
  if (!App.states.length) return;
  const active = simActiveStates();
  const sel = App.selectedStates;
  const nodeR = Math.max(NODE_R_MIN, Math.min(NODE_R_MAX, (App.config.radius || 22) * scale));
  const circle = (x, y, r) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); };

  ctx.save();
  ctx.lineWidth = 1;

  // Halos first, so a run through adjacent states does not stamp one node's
  // glow over its neighbour's fill.
  if (active) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = pal.actStroke;
    ctx.beginPath();
    for (const s of App.states) {
      if (!active.has(s.id)) continue;
      circle(px(s.x), py(s.y), nodeR + Math.max(2, nodeR * 0.9));
    }
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  // style key -> {fill, stroke, width, pts}
  const buckets = new Map();
  const rings = [];
  for (const s of App.states) {
    const x = px(s.x), y = py(s.y);
    const isActive = active && active.has(s.id);
    const isSel = sel && sel.has(s.id);
    const isAcc = App.accepts.has(s.id);

    const fill = isActive ? pal.actStroke : isSel ? pal.actFill : pal.nodeFill;
    const stroke = isActive || isSel ? pal.actStroke
      : s.id === App.startId ? pal.startStroke
        : isAcc ? pal.accStroke : pal.nodeStroke;
    const width = isActive || isSel ? 1.3 : 1;
    const key = fill + '|' + stroke + '|' + width;
    let b = buckets.get(key);
    if (!b) { b = { fill, stroke, width, pts: [] }; buckets.set(key, b); }
    b.pts.push(x, y);

    if (isAcc) rings.push(x, y);
  }

  for (const b of buckets.values()) {
    ctx.beginPath();
    for (let i = 0; i < b.pts.length; i += 2) circle(b.pts[i], b.pts[i + 1], nodeR);
    ctx.fillStyle = b.fill;
    ctx.fill();
    ctx.strokeStyle = b.stroke;
    ctx.lineWidth = b.width;
    ctx.stroke();
  }

  if (rings.length) {
    const rr = nodeR + Math.max(1.2, nodeR * 0.35);
    ctx.beginPath();
    for (let i = 0; i < rings.length; i += 2) circle(rings[i], rings[i + 1], rr);
    ctx.strokeStyle = pal.accStroke;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// The viewport reads as the lit region: everything outside it is dimmed with a
// scrim in the background colour, and the rectangle itself is a crisp accent
// outline. Far easier to find at a glance than an outline alone, which
// disappears against a dense diagram.
function drawViewport(ctx, pal, px, py, scale, W, H) {
  const vp = worldViewport();
  const x = px(vp.x0), y = py(vp.y0);
  const w = (vp.x1 - vp.x0) * scale, h = (vp.y1 - vp.y0) * scale;
  if (!(w > 0) || !(h > 0)) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  roundRectPath(ctx, x, y, w, h, 2.5);
  ctx.fillStyle = pal.bg;
  ctx.globalAlpha = 0.46;
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  // Half-pixel offset so a 1px stroke lands on a pixel instead of straddling
  // two and rendering as a 2px smear.
  roundRectPath(ctx, Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h), 2.5);
  ctx.strokeStyle = pal.viewport;
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

// ── camera control ────────────────────────────────────────────────

function centreCameraOn(wx, wy, animate) {
  const w = $('canvas-wrap');
  if (!w) return;
  const vis = visibleCanvasBox();
  App.cam.x = vis.x + vis.w / 2 - wx * App.cam.z;
  App.cam.y = vis.y + vis.h / 2 - wy * App.cam.z;
  // A no-op once the tab is already dirty, so calling it per drag frame is free.
  markDirty();

  const cam = $('cam-g');
  if (animate && cam) {
    cam.classList.add('cam-smooth');
    w.classList.add('cam-smooth');
    setTimeout(() => { cam.classList.remove('cam-smooth'); w.classList.remove('cam-smooth'); }, 250);
  }
  applyCamera();
}

function viewportCentreWorld() {
  const vp = worldViewport();
  return {
    x: (vp.x0 + vp.x1) / 2,
    y: (vp.y0 + vp.y1) / 2,
    hw: (vp.x1 - vp.x0) / 2,
    hh: (vp.y1 - vp.y0) / 2
  };
}

function pointToWorld(canvas, e) {
  const mm = canvas._mm;
  if (!mm || typeof canvas.getBoundingClientRect !== 'function') return null;
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / mm.scale + mm.ox,
    y: (e.clientY - r.top) / mm.scale + mm.oy
  };
}

// ── interaction ───────────────────────────────────────────────────

// World offset between the grab point and the viewport centre. Pressing inside
// the rectangle picks it up where you touched it; pressing outside jumps to
// that point first and then drags from the centre. Recentring on the cursor
// unconditionally — which is what this used to do — made every press inside
// the rectangle kick the view sideways before the drag even started.
let grab = null;

export function initMinimap() {
  const canvas = $('minimap-canvas');
  if (!canvas || canvas._mmInit) return;
  canvas._mmInit = true;

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const pt = pointToWorld(canvas, e);
    if (!pt) return;
    const c = viewportCentreWorld();
    const inside = Math.abs(pt.x - c.x) <= c.hw && Math.abs(pt.y - c.y) <= c.hh;
    grab = inside ? { dx: pt.x - c.x, dy: pt.y - c.y } : { dx: 0, dy: 0 };
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    if (!inside) centreCameraOn(pt.x, pt.y, false);
  });

  canvas.addEventListener('pointermove', e => {
    if (!grab) {
      // Hover affordance: inside the rectangle you can pick it up, outside you
      // jump to a point.
      const pt = pointToWorld(canvas, e);
      if (pt) {
        const c = viewportCentreWorld();
        const inside = Math.abs(pt.x - c.x) <= c.hw && Math.abs(pt.y - c.y) <= c.hh;
        canvas.style.cursor = inside ? 'grab' : 'crosshair';
      }
      return;
    }
    const pt = pointToWorld(canvas, e);
    if (pt) centreCameraOn(pt.x - grab.dx, pt.y - grab.dy, false);
  });

  const end = () => {
    if (!grab) return;
    grab = null;
    canvas.classList.remove('dragging');
    scheduleMinimap();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const pt = pointToWorld(canvas, e);
    if (!pt) return;
    const { dy } = normalizeWheelDeltas(e);
    const cfg = App.config.zoom;
    const factor = Math.exp(-dy * (cfg.step || 0.1) * 0.01);
    App.cam.z = Math.max(cfg.min, Math.min(cfg.max, App.cam.z * factor));
    // Zooming holds the pointed-at world point in view rather than the screen
    // centre, so the thing you aimed at is the thing you end up looking at.
    centreCameraOn(pt.x, pt.y, false);
  }, { passive: false });

  canvas.addEventListener('keydown', e => {
    const c = viewportCentreWorld();
    const stepX = c.hw * 0.3, stepY = c.hh * 0.3;
    const cfg = App.config.zoom;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': centreCameraOn(c.x - stepX, c.y, true); break;
      case 'ArrowRight': centreCameraOn(c.x + stepX, c.y, true); break;
      case 'ArrowUp': centreCameraOn(c.x, c.y - stepY, true); break;
      case 'ArrowDown': centreCameraOn(c.x, c.y + stepY, true); break;
      case '+': case '=':
        App.cam.z = Math.min(cfg.max, App.cam.z * 1.25);
        centreCameraOn(c.x, c.y, true); break;
      case '-': case '_':
        App.cam.z = Math.max(cfg.min, App.cam.z / 1.25);
        centreCameraOn(c.x, c.y, true); break;
      case 'Home': case '0': fitToScreen(true); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });

  // The CSS shrinks the map at ≤900px, and the backing store has to follow or
  // it gets resampled. Observing the element covers that plus any future
  // resize without a media-query duplicate here.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => scheduleMinimap()).observe(canvas);
  }

  scheduleMinimap();
}

export function toggleMinimap() {
  const mm = $('minimap-container');
  if (!mm) return;
  const hidden = mm.classList.toggle('minimap-hidden');
  // Bringing the map back is the nav bar's job, rather than a floating stand-in
  // button that took the map's slot in the stack: hiding the minimap used to
  // swap one overlay for another, which still left something parked in the
  // corner. The toggle lives with the other canvas toggles instead, and reads
  // as pressed while the map is up.
  const btn = $('minimap-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', !hidden);
    btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    btn.setAttribute('data-tip', hidden ? 'Show minimap' : 'Hide minimap');
  }
  try { localStorage.setItem('automata-minimap', hidden ? '0' : '1'); } catch (e) { }
  // The map leaving the stack changes what sits above the nav controls.
  layoutCanvasOverlays();
  if (!hidden) {
    // It has been showing nothing while hidden, and the camera has moved since.
    // Cut to the current frame rather than easing in from a stale one.
    resetMinimapFrame();
    scheduleMinimap();
  }
}
