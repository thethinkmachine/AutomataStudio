import { $, App } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  VIEWPORT CULLING
// ══════════════════════════════════════════════════════════════════
// What the renderer is allowed to skip.
//
// The diff in render.js made an *unchanged* render free, which is the right fix
// for editing a small machine and no fix at all for a large one: a 1000-state
// machine is ~15,000 SVG nodes whether or not anything changed, and the browser
// re-rasterises every one of them on every pan frame, every zoom tick and every
// theme repaint. Diffing cannot help there — the cost is in the nodes existing.
//
// So past a threshold the renderer stops building what is off screen. The model
// is untouched: App.states and App.transitions are complete, the layout pass
// still measures the whole diagram for fit-to-screen and cropped exports, and
// every simulator still sees every state. Only the DOM is a window onto it.
//
// Three rules make that safe:
//
//   * A node that scrolls out is *evicted*, not hidden. display:none still costs
//     the browser a box; the point is for the element not to exist.
//   * The margin is generous (a screen's worth in each direction), so ordinary
//     panning reuses nodes rather than thrashing them at the edge.
//   * Anything that reads the DOM back rather than looking at it — the SVG/PNG
//     exporters — goes through withFullRender(), which turns culling off for the
//     length of one call. A cropped export must contain the whole machine, not
//     the part that happened to be on screen.
//
// Imports state.js only: render.js, canvas.js and geometry.js all reach this,
// and two of those three are in an import cycle with each other.

// Below this a full render is already cheap and a windowed one only adds
// bookkeeping — and the reader of a 200-state machine is usually zoomed out
// looking at all of it, which is the case culling helps least.
export const CULL_MIN_STATES = 220;
export const CULL_MIN_TRANSITIONS = 500;

// Screens of slack around the visible box. One full screen each way means a
// fling-pan has to travel a whole viewport before it can outrun the window,
// and an ordinary drag never does.
const CULL_MARGIN_SCREENS = 1;

let suspended = 0;

/** True while an exporter (or anything else reading the DOM back) needs it whole. */
export function cullSuspended() { return suspended > 0; }

/**
 * Runs `fn` with culling off. The caller is responsible for repainting first —
 * render.js's withFullRender does that and is what callers actually use.
 */
export function suspendCulling(fn) {
  suspended++;
  try { return fn(); } finally { suspended--; }
}

/**
 * Whether this machine is big enough to be worth windowing. Reads a config flag
 * the same way the four render flags do — absent means on, so a workspace or
 * settings profile written before this existed does not load with it off.
 */
export function cullingActive() {
  if (suspended > 0) return false;
  if (App.config?.render?.cullOffscreen === false) return false;
  return (App.states?.length || 0) > CULL_MIN_STATES
    || (App.transitions?.length || 0) > CULL_MIN_TRANSITIONS;
}

/**
 * The visible region in world coordinates, grown by the cull margin.
 *
 * Deliberately the whole canvas-wrap rather than ui.js's visibleCanvasBox: an
 * overlaying panel hides pixels but a node under it still has to exist, because
 * unpinning the panel is not a camera move and would not trigger a re-cull.
 */
export function cullRect() {
  const wrap = $('canvas-wrap');
  const z = App.cam?.z || 1;
  const w = (wrap?.clientWidth || 1200) / z;
  const h = (wrap?.clientHeight || 800) / z;
  const x0 = -(App.cam?.x || 0) / z;
  const y0 = -(App.cam?.y || 0) / z;
  const mx = w * CULL_MARGIN_SCREENS, my = h * CULL_MARGIN_SCREENS;
  return { x0: x0 - mx, y0: y0 - my, x1: x0 + w + mx, y1: y0 + h + my };
}

// What the last cull pass drew, so a camera move can tell whether it needs to
// re-cull at all. Panning inside the margin reuses every node; only travelling
// past it costs a pass. Null means "the last pass drew everything".
let lastRect = null;
let lastLOD = null;

/**
 * The rect a cull pass should use, or null when everything is to be drawn.
 * One call at the top of a render decides for the whole pass, so states and
 * edges cannot disagree about what is on screen.
 */
export function cullViewport() {
  const r = cullingActive() ? cullRect() : null;
  lastRect = r;
  lastLOD = lodSignature();
  return r;
}

function lodSignature() {
  return (edgeLabelLOD() ? 'e' : '') + (stateLabelLOD() ? 's' : '');
}

/** The visible box with no margin — what actually has to be covered. */
function visibleRect() {
  const wrap = $('canvas-wrap');
  const z = App.cam?.z || 1;
  const x0 = -(App.cam?.x || 0) / z;
  const y0 = -(App.cam?.y || 0) / z;
  return { x0, y0, x1: x0 + (wrap?.clientWidth || 1200) / z, y1: y0 + (wrap?.clientHeight || 800) / z };
}

/**
 * Whether the camera has moved far enough that the drawn window no longer
 * covers the screen — or far enough to cross a level-of-detail threshold.
 *
 * This is the whole economy of the thing: a pan repaints by moving one group
 * transform, and only pays for a render once it has travelled a screen's worth.
 * Without the test every wheel tick would rebuild the window it already had.
 */
export function cullNeedsRepaint() {
  const active = cullingActive();
  if (!active && !lastRect) return lastLOD !== null && lastLOD !== lodSignature();
  if (active !== !!lastRect) return true;
  if (lodSignature() !== lastLOD) return true;
  if (!lastRect) return false;
  const v = visibleRect();
  return v.x0 < lastRect.x0 || v.y0 < lastRect.y0 || v.x1 > lastRect.x1 || v.y1 > lastRect.y1;
}

/** Forget what was drawn, so the next camera move repaints unconditionally. */
export function invalidateCull() { lastRect = null; lastLOD = null; }

export function rectHasPoint(r, x, y, pad = 0) {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

/**
 * A segment's bounding box against the rect. Edges are curves, but a quadratic
 * never leaves the box of its endpoints grown by the control offset, and the
 * caller passes that as `pad` — so this over-includes and never under-includes,
 * which is the only direction a cull test may err in.
 */
export function rectHasSegment(r, ax, ay, bx, by, pad = 0) {
  if (Math.max(ax, bx) < r.x0 - pad || Math.min(ax, bx) > r.x1 + pad) return false;
  if (Math.max(ay, by) < r.y0 - pad || Math.min(ay, by) > r.y1 + pad) return false;
  return true;
}

// ── level of detail ───────────────────────────────────────────────
//
// Zoomed far enough out, a label is a smear two pixels tall: it costs a text
// node, a shaping pass and a raster, and says nothing. Below the threshold the
// renderer draws the graph and skips the type. This is separate from culling —
// it applies at any size, and it is what makes "zoom out to see the whole
// machine" affordable on a machine too big to fit on screen at legible size.
export const LOD_LABEL_ZOOM = 0.42;
export const LOD_STATE_LABEL_ZOOM = 0.3;

export function edgeLabelLOD() {
  if (suspended > 0) return false;
  if (App.config?.render?.zoomLOD === false) return false;
  return (App.cam?.z || 1) < LOD_LABEL_ZOOM
    && ((App.states?.length || 0) > CULL_MIN_STATES || (App.transitions?.length || 0) > CULL_MIN_TRANSITIONS);
}

export function stateLabelLOD() {
  if (suspended > 0) return false;
  if (App.config?.render?.zoomLOD === false) return false;
  return (App.cam?.z || 1) < LOD_STATE_LABEL_ZOOM
    && (App.states?.length || 0) > CULL_MIN_STATES;
}
