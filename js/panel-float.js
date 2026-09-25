// Pulling a panel section out of its panel.
//
// A section is **docked** or **floating**. Floating means the section is a
// window over the canvas: movable, resizable, collapsible to its title strip,
// and closed by putting it back where it came from. Which sections matter is a
// property of the reader — someone tuning an alphabet lives in Σ, someone
// debugging a run lives in Simulate — and the panels answer that with a scroll
// and an order. This is the other half of the same answer: the section you are
// working in can leave the rail and sit next to the diagram it is about.
//
// **They are windows, not modals, and that is the whole design.** A floating
// Simulate has to let you click the canvas *while it is open* — that is the
// only reason to pull it out — and two of them have to be able to be out at
// once. So nothing here enters `ModalStack`, nothing sets `body.modal-open`,
// nothing traps Tab and nothing claims Escape. See [js/modal.js](modal.js) for
// what the word means in this app; none of it applies.
//
// **The element is never cloned.** Nothing outside the panel modules scopes a
// query to `#lpanel-content`/`#rpanel-content` — every renderer (`updateLPanel`,
// `updateRPanel`, `renderLanguagePanel`, the tape tracker, `setLPSectionCollapsed`)
// reaches its target by id through `$()`, and the `on*` attributes the markup is
// wired with are global. So floating a section is one `appendChild` of the live
// element into a layer over the canvas: no re-render, no re-wiring, no second
// copy to keep in step. Cloning is the obvious implementation and it is the
// wrong one — it would strand the `__secGrip` back-reference, `panel-list.js`'s
// scroll restoration, and every listener attached at creation. The identity of
// the element *is* the contract, and [tests/panel-float.test.js](../tests/panel-float.test.js)
// pins it with `assert.strictEqual`.
//
// **Minimize is the collapse state the section already has.** `.collapsed`
// hides the body and keeps the header, which is a title strip; it already
// persists, and the reader's intent ("I do not need to see this right now") is
// the same docked or floating. A second state would be two ways to say one
// thing.
//
// **Escape does not close a window.** Three claimants already contend for that
// key — `modal.js` in capture, StateMate's ladder, the canvas shortcuts — and a
// fourth, for a thing with a visible ×, is a bad trade. Escape keeps its
// existing job here: cancelling a drag in flight.
//
// Listeners are attached at creation the way [js/reference.js](reference.js)
// does it, so the whole feature adds nothing to `bridge.js`.

import {
  FLOAT_MIN_H, FLOAT_MIN_W, PANEL_SECTIONS, PANEL_SECTION_SIDES,
  declaredSectionIds, floatState, floatStates, isSectionFloating,
  resetFloatStates, sectionFill, sectionMinSize, sectionSide, setFloatState
} from './panel-sections.js';
import { applySectionOrder } from './panel-sections-ui.js';
import { redrawAllLists } from './panel-list.js';
import { beginShakeTrack, endShakeTrack, noteShakeSample } from './panel-shake.js';
import { Change, subscribe } from './store.js';

/** How much of a window must stay reachable when it is clamped into view. */
const EDGE_KEEP = 76;

/** Pointer travel before a press on a floating header becomes a move. */
const MOVE_THRESHOLD = 3;

/** How far each new window is offset from the last, so none hides another. */
const CASCADE_STEP = 26;

/**
 * Where a window rests against the edge of the canvas — the inset the toolbox,
 * the minimap and the nav controls already keep, so a window put in a corner
 * lines up with the chrome beside it rather than with the well's curve.
 */
const EDGE_GUTTER = 12;

/** The gap two windows keep when one is snapped against the other. */
const WINDOW_GAP = 8;

/**
 * How close an edge has to come to a line before it is pulled onto it.
 *
 * Small on purpose. A snap is a convenience the reader should be able to drag
 * straight through when they meant somewhere else, and at 8px a deliberate
 * placement a few pixels off a line is never overruled.
 */
const SNAP_DIST = 8;

/** One press of an arrow key on a focused title bar. */
const KEY_STEP = 10;

/**
 * The eight directions a window resizes in.
 *
 * Each name is the set of edges it moves, so the arithmetic reads the letters
 * rather than branching per handle — and `n`/`s`/`e`/`w` share no letters, so
 * `includes` cannot confuse two of them.
 */
const RESIZE_EDGES = Object.freeze(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

/** Windows sit above the canvas overlays (which top out at 52) and far below
 *  the modal layer (1000) and the dropdowns (2000). */
const RAISE_BASE = 60;

/**
 * What a floating window needs from the device, not just from the viewport.
 *
 * Width alone was the wrong test. This is a desktop-and-Electron feature: it
 * wants a pointer that can hover an edge to find a 6px resize band and hold a
 * title bar precisely, and below the breakpoint the panels are bottom sheets
 * with no room to float anything over. A tablet in landscape passes the width
 * test and fails every other one, so both are asked.
 */
const DESKTOP_QUERY = '(min-width: 901px) and (hover: hover) and (pointer: fine)';

const CLOSE_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" width="12" height="12"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

const POPOUT_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" width="12" height="12"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/></svg>';

/** Raised on every press, so the last window touched is the one on top. */
let raiseSeq = 0;

/** The move or resize in flight, or null. */
let gesture = null;

let installed = false;

/** True while the viewport is narrow enough that the panels are bottom sheets. */
let suspended = false;

// ── the layer ─────────────────────────────────────────────────────

function canvasWrap() {
  return document.getElementById('canvas-wrap');
}

/**
 * The layer the windows live in, created on first use.
 *
 * Inside `.canvas-area` rather than over the whole app: the canvas is a rounded
 * well with `overflow: hidden`, so a window dragged to its edge is clipped by
 * the same curve everything else on the canvas is, and a window can never be
 * dropped on top of a panel it is supposed to have left.
 *
 * The layer itself takes no pointer events — only the windows do — so the
 * canvas underneath keeps every gesture it had except where a window is
 * actually drawn.
 */
export function floatLayer() {
  const wrap = canvasWrap();
  if (!wrap) return null;
  let layer = document.getElementById('panel-float-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'panel-float-layer';
    layer.className = 'panel-float-layer';
    wrap.appendChild(layer);
  } else if (layer.parentNode !== wrap) {
    wrap.appendChild(layer);
  }
  return layer;
}

/**
 * The box a window's coordinates are measured from, measured once and kept
 * until something can have moved it.
 *
 * This is `getBoundingClientRect` on `#canvas-wrap`, which is the app's most
 * expensive measurement: it forces a synchronous layout flush against the
 * whole diagram — 8.4ms on a 200-state machine, which is what the note over
 * `renderExampleCard`'s guard in js/machine-card.js is about. Uncached it was
 * read on **every frame of every gesture**, twice a frame in the tear-off path
 * where `panel-sections-ui.js` reads it and then `moveFloatTo` reads it again,
 * so dragging a window over a large machine spent more time measuring the
 * canvas than the canvas spends drawing itself.
 *
 * Nothing announces that the well has moved, so the cache is armed only when
 * there is a `ResizeObserver` on it to say so — every way the box can change
 * changes its *size* (a viewport resize, a panel pinning, unpinning or being
 * dragged wider, the toolbar collapsing, the sill), and without the observer
 * this measures every time exactly as it did before. Gesture entry points
 * invalidate as well, so a missed notification costs one stale frame rather
 * than a stuck window.
 */
let layerRect = null;

/** Set only once a ResizeObserver is actually watching the well. */
let rectCacheArmed = false;

export function invalidateFloatRect() {
  layerRect = null;
}

export function floatLayerRect() {
  if (rectCacheArmed && layerRect) return layerRect;
  const wrap = canvasWrap();
  if (!wrap || typeof wrap.getBoundingClientRect !== 'function') {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const r = wrap.getBoundingClientRect();
  const out = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (rectCacheArmed) layerRect = out;
  return out;
}

// ── whether floating applies at all ───────────────────────────────

function isDesktop() {
  try {
    if (typeof matchMedia !== 'function') return true;
    return !!matchMedia(DESKTOP_QUERY).matches;
  } catch (e) {
    // A stub with no matchMedia is the test DOM, where the feature is exercised
    // directly rather than through a device. Refusing there would make every
    // assertion about it vacuous.
    return true;
  }
}

/**
 * Whether a section may be pulled out right now.
 *
 * Below the mobile breakpoint the panels are bottom sheets and there is no
 * hover to reveal a grip with; windows over a phone-sized canvas are the wrong
 * shape for the space. What is *stored* is left alone — a reader's desktop
 * layout has to survive opening the app on a phone — so this suspends the
 * feature rather than docking anything permanently.
 */
export function floatingEnabled() {
  return !suspended;
}

// ── geometry ──────────────────────────────────────────────────────

function clampGeom(g, rect, min) {
  const lo = min || { w: FLOAT_MIN_W, h: FLOAT_MIN_H };
  const w = Math.max(lo.w, Number(g.w) || lo.w);
  const h = Math.max(lo.h, Number(g.h) || lo.h);
  let x = Number(g.x) || 0;
  let y = Number(g.y) || 0;
  // A layer with no measurable box is one that is not on screen — a test DOM,
  // a hidden view. Clamping against zero would stack every window at the
  // origin and lose the geometry that is about to be restored.
  if (rect && rect.width > 0 && rect.height > 0) {
    x = Math.min(Math.max(x, EDGE_KEEP - w), Math.max(0, rect.width - EDGE_KEEP));
    y = Math.min(Math.max(y, 0), Math.max(0, rect.height - EDGE_KEEP / 2));
  }
  return g.fit ? { x, y, w, h, fit: true } : { x, y, w, h };
}

function measurable(rect) {
  return !!rect && rect.width > 0 && rect.height > 0;
}

/**
 * Where a record puts a window in the well as it is now.
 *
 * A record carries a distance to the right or bottom edge when the window was
 * left nearer that edge (see `withAnchors`), and this is where that distance
 * is turned back into a position. The well changes width all the time — a
 * sidebar pinned, unpinned, dragged wider, the browser resized — and a window
 * stored only as a distance from the left drifted relative to everything on
 * the right of the canvas: a Simulate window parked in the top-right corner
 * slid into the middle of the diagram when the right panel was put away, and
 * off the edge when it came back. Anchored, it stays in its corner.
 */
function placeInWell(rec, rect, min) {
  const lo = min || { w: FLOAT_MIN_W, h: FLOAT_MIN_H };
  const w = Math.max(lo.w, Number(rec.w) || lo.w);
  const h = Math.max(lo.h, Number(rec.h) || lo.h);
  let x = rec.x;
  let y = rec.y;
  if (measurable(rect)) {
    if (typeof rec.r === 'number') x = rect.width - w - rec.r;
    if (typeof rec.b === 'number') y = rect.height - h - rec.b;
  }
  return clampGeom({ x, y, w, h, fit: rec.fit }, rect, lo);
}

/**
 * A geometry with the anchors a window left at it should keep.
 *
 * The nearer edge on each axis, decided by the window's centre — the same rule
 * a desktop uses for a window it has to keep on screen across a resolution
 * change. Left and top are the default and are written as nothing at all, so
 * only a window in the right or bottom half carries anything extra.
 */
function withAnchors(g, rect) {
  const out = { x: g.x, y: g.y, w: g.w, h: g.h };
  if (g.fit) out.fit = true;
  if (!measurable(rect)) return out;
  if (g.x + g.w / 2 > rect.width / 2) out.r = Math.round(rect.width - g.x - g.w);
  if (g.y + g.h / 2 > rect.height / 2) out.b = Math.round(rect.height - g.y - g.h);
  return out;
}

/** A position the well forced on a window, keeping the anchors it was left with. */
function keepAnchors(g, rec) {
  const out = { x: g.x, y: g.y, w: g.w, h: g.h };
  if (g.fit) out.fit = true;
  if (rec && typeof rec.r === 'number') out.r = rec.r;
  if (rec && typeof rec.b === 'number') out.b = rec.b;
  return out;
}

/**
 * Puts a window where `g` says, at the height its content decides.
 *
 * **Every window fits its content; the height it holds is a ceiling.** A
 * window taller than its content is dead space under it, and nothing a
 * section contains can use that space well: a list with four states in it,
 * a trace log before a run and a batch result before a test all drew as a
 * frame of nothing, and Simulate — sized for a run — as a tall empty box
 * before the run and after a reset. So the content decides the height, the
 * number the reader gave is the most it may take, and past it the section's
 * `sectionFill` region scrolls (or the body, for a section that names none).
 * A run appearing grows the window; a reset gives the room back.
 *
 * A window left at its content's full height (`g.fit`) has said something
 * more: that it should go on showing all of it. Holding that height as the
 * ceiling would freeze a States Q window at the number of states it had when
 * it was sized, and every state added after would scroll. So its ceiling is
 * the room below it in the canvas instead, and `g.h` is kept only as the
 * height it was left at — for the anchors, and for the gesture to start from.
 *
 * `.panel-float.collapsed` beats the ceiling with `!important` in the
 * stylesheet. Collapsing a window would otherwise have to reach in here to
 * clear it and put it back on expand — which means hooking `toggleLPSection`,
 * and the stored size surviving a collapse is exactly the thing that would
 * then be easy to lose.
 */
function applyGeom(el, g) {
  el.style.left = g.x + 'px';
  el.style.top = g.y + 'px';
  el.style.width = g.w + 'px';
  el.style.height = '';
  el.style.maxHeight = ceilingOf(g) + 'px';
  el.dataset.floatH = String(g.h);
  el.classList.add('is-float-hug');
  el.classList.toggle('is-float-fit', !!g.fit);
}

/** The most a window may draw at — see `applyGeom`. */
function ceilingOf(g) {
  if (!g.fit) return g.h;
  const rect = floatLayerRect();
  if (!measurable(rect)) return g.h;
  return Math.max(g.h, Math.round(rect.height - g.y - EDGE_GUTTER));
}

/**
 * The height a hugging window's content wants, with nothing capping it.
 *
 * One forced layout, taken at the start of a resize rather than on its
 * frames. A resize is capped here so its edge cannot be dragged out into
 * space the content will never fill — the edge would part company with the
 * window, and a north edge would simply push the window up.
 */
function naturalHeight(el) {
  const cap = el.style.maxHeight;
  el.style.maxHeight = 'none';
  const h = el.offsetHeight || 0;
  el.style.maxHeight = cap;
  return h;
}

/** The ceiling `applyGeom` last drew a window under. */
function drawnCeiling(el, g) {
  return parseFloat(el.style.maxHeight) || g.h;
}

/**
 * A size for a section that has never been floated: the one it has in the
 * panel. Pulling a section out should not also resize it — and in the panel it
 * followed its content, so out here it goes on doing so (`fit`) rather than
 * freezing at the height it happened to have when it was pulled: a Batch card
 * popped out before a test would otherwise scroll its first results in a
 * window sized for none.
 *
 * And a place beside the panel it came from, in the corner of the canvas
 * nearest to it. It used to open at the top centre of the canvas, which is
 * where the diagram is — a right-panel section popped out from its button
 * landed on the machine the reader was looking at, and then had to be carried
 * back across to the edge it had just left.
 */
function naturalGeom(el, rect, id) {
  let w = 0;
  let h = 0;
  if (typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect();
    w = r.width || 0;
    h = r.height || 0;
  }
  if (!w) w = el.offsetWidth || 0;
  if (!h) h = el.offsetHeight || 0;
  // Cascaded by however many windows are already out. Popping three sections
  // out from their buttons would otherwise land all three on the same
  // coordinates, and the reader would be looking at one window with no sign
  // that the other two had opened underneath it.
  const step = CASCADE_STEP * openWindowCount();
  const min = sectionMinSize(id);
  const width = Math.max(min.w, Math.round(w) || 280);
  const height = Math.max(min.h, Math.round(h) || 260);
  // Without a measurable well there is no right edge to open against — the
  // test DOM, a hidden view — so it cascades from the left as it always did.
  const fromRight = sectionSide(id) === 'rpanel' && measurable(rect);
  return clampGeom({
    x: fromRight ? rect.width - width - EDGE_GUTTER - step : EDGE_GUTTER + step,
    y: EDGE_GUTTER + step,
    w: width,
    h: height,
    fit: true
  }, rect, min);
}

/** How many windows are out right now, across both panels. */
function openWindowCount() {
  return PANEL_SECTION_SIDES.reduce((n, side) =>
    n + Object.keys(floatStates(side)).length, 0);
}

// ── raising ───────────────────────────────────────────────────────

/** The window on top, which is drawn as the active one. */
let frontWindow = null;

/**
 * Brings a window to the front, and marks it as the one in use.
 *
 * The mark is what tells two overlapping windows apart at a glance: every
 * window has the same frame, so without it the only sign of which one a key
 * press will reach is which one happens to be painted over the other.
 */
export function raiseFloat(el) {
  if (!el) return;
  if (frontWindow !== el) {
    if (frontWindow && frontWindow.classList) frontWindow.classList.remove('is-float-front');
    frontWindow = el;
    if (el.classList) el.classList.add('is-float-front');
  }
  raiseSeq += 1;
  el.style.zIndex = String(RAISE_BASE + raiseSeq);
}

// ── floating and docking ──────────────────────────────────────────

function sectionEl(id) {
  return document.getElementById(id);
}

function containerOf(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? document.getElementById(cfg.container) : null;
}

/**
 * Puts a section into the float layer at `geom`, recording it.
 *
 * Idempotent: called on a section that is already floating it just re-applies
 * the geometry, which is what the restore pass and the resize clamp both want.
 */
export function floatSection(id, geom) {
  const side = sectionSide(id);
  const el = sectionEl(id);
  const layer = floatLayer();
  if (!side || !el || !layer || suspended) return null;

  const rect = floatLayerRect();
  const min = sectionMinSize(id);
  // A position someone chose — handed in, or remembered — keeps whatever
  // anchors it came with. A position this module chose is anchored the way a
  // window left there by hand would be, so a section that opened beside the
  // right panel stays beside it when the canvas changes width.
  const rec = geom || floatState(id);
  const g = rec ? placeInWell(rec, rect, min) : naturalGeom(el, rect, id);

  if (el.parentNode !== layer) layer.appendChild(el);
  el.classList.add('panel-float');
  el.dataset.floatSide = side;
  applyGeom(el, g);
  raiseFloat(el);
  installChrome(side, id);
  syncChrome(id);
  syncFill(id, true);
  setFloatState(id, rec ? keepAnchors(g, rec) : withAnchors(g, rect));
  // Not for the order — a section that has left the panel changes nothing
  // about the order of the ones still in it — but for the grip labels, which
  // count the sections in the panel and have just lost one.
  applySectionOrder(side);
  syncPanelEmpty(side);
  redrawAllLists();
  return g;
}

/**
 * Puts a section back in its panel, at the position the reader's order gives
 * it — not at the bottom. `applySectionOrder` already answers that question, so
 * closing a window is an append plus the pass that was already there.
 */
export function dockSection(id, opts = {}) {
  const side = sectionSide(id);
  const el = sectionEl(id);
  const container = containerOf(side);
  if (!side || !el || !container) return false;

  el.classList.remove('panel-float', 'is-float-moving', 'is-float-sizing', 'is-float-front');
  if (frontWindow === el) frontWindow = null;
  delete el.dataset.floatSide;
  el.style.left = '';
  el.style.top = '';
  el.style.width = '';
  el.style.height = '';
  el.style.maxHeight = '';
  delete el.dataset.floatH;
  el.classList.remove('is-float-hug', 'is-float-fit');
  el.style.zIndex = '';
  container.appendChild(el);
  // `persist: false` is the suspend path — a narrow viewport docks the DOM
  // without touching what the reader chose on a wide one.
  if (opts.persist !== false) setFloatState(id, null);
  applySectionOrder(side);
  syncChrome(id);
  syncFill(id, false);
  syncPanelEmpty(side);
  redrawAllLists();
  return true;
}

export function toggleSectionFloat(id) {
  if (isSectionFloating(id) && !suspended) return dockSection(id);
  return floatSection(id);
}

/** Every window of a side back into its panel. */
export function dockAllSections(side) {
  declaredSectionIds(side).forEach(id => {
    if (isSectionFloating(id)) dockSection(id);
  });
}

/**
 * Moves a window that is already floating. Used by the drag gestures.
 *
 * `opts.snap` pulls its edges onto the lines `beginFloatSnap` gathered, and is
 * only honoured for the window that call was made for — a stale context from
 * some other gesture must not decide where this one lands.
 */
export function moveFloatTo(id, x, y, opts = {}) {
  const el = sectionEl(id);
  if (!el || !el.classList.contains('panel-float')) return null;
  // The size comes off the element for the same reason `liveGeom` does: a
  // failed write must not shrink a window to the minimum the moment it is
  // dragged.
  const live = liveGeom(el, id);
  const min = sectionMinSize(id);
  const rect = floatLayerRect();
  let g = { x, y, w: live.w, h: live.h, fit: live.fit };
  let lines = null;
  if (opts.snap && snapCtx && snapCtx.id === id) {
    lines = snapMove(g);
    g = { ...g, x: lines.x, y: lines.y };
  }
  g = clampGeom(g, rect, min);
  // A guide is drawn only where the window actually is. The clamp can hold a
  // window off a line it snapped to at the very edge of the well, and a guide
  // there would be pointing at nothing.
  showGuides(lines && lines.gx !== null && g.x === lines.x ? lines.gx : null,
    lines && lines.gy !== null && g.y === lines.y ? lines.gy : null);
  applyGeom(el, g);
  return g;
}

/**
 * Records where a drag left a window. Separated so a move can paint every
 * frame and write storage once, on release.
 *
 * This is also where a window picks up its anchors: where the reader lets go
 * is the one moment their intent about *which* edge it belongs to is known.
 */
export function commitFloatGeom(id, g) {
  const rect = floatLayerRect();
  return setFloatState(id, withAnchors(clampGeom(g, rect, sectionMinSize(id)), rect));
}

// ── snapping ──────────────────────────────────────────────────────
//
// A window's edges are pulled onto a line when they come within `SNAP_DIST` of
// it. The lines are the canvas's own inset (`EDGE_GUTTER`, the margin the
// toolbox and minimap keep) and the edges of every other window: aligned with
// one, or sitting `WINDOW_GAP` beside it. That is the whole of what makes two
// windows stack into a tidy column without the reader nudging pixels — and a
// line is drawn while an edge is on one, so a window that sticks is seen to
// have snapped rather than felt to be lagging.
//
// Holding Ctrl (⌘ on a Mac) moves freely, the way it does in every design
// tool, for the placement a snap would overrule.

/** What the gesture in flight can snap to, gathered once at its start. */
let snapCtx = null;

/**
 * Gathers the lines a window can snap to, for the gesture that is about to
 * move it.
 *
 * Once, because every other window stands still for the length of a gesture,
 * and a minimized one's height is its title strip — which means asking the
 * layout, and asking the layout on every frame of a drag is the cost
 * `floatLayerRect` was cached to avoid.
 */
export function beginFloatSnap(id) {
  const rect = floatLayerRect();
  const layer = document.getElementById('panel-float-layer');
  const self = sectionEl(id);
  const others = [];
  for (const node of [...((layer && layer.children) || [])]) {
    if (node === self || !node.classList || !node.classList.contains('panel-float')) continue;
    if (node.style && node.style.display === 'none') continue;
    const g = liveGeom(node, node.id);
    others.push({ l: g.x, t: g.y, r: g.x + g.w, b: g.y + drawnHeight(node, g.h) });
  }
  snapCtx = { id, rect, others, selfH: self ? drawnHeight(self, null) : null };
}

/** Ends a gesture's snapping and takes its guides away. */
export function endFloatSnap() {
  snapCtx = null;
  showGuides(null, null);
}

/**
 * How tall a window is on screen, which is not always the height it holds: a
 * minimized one keeps its full height for when it is opened again and draws
 * only its title strip. Snapping has to see the strip.
 */
function drawnHeight(el, fallback) {
  const shrunk = el.classList && (el.classList.contains('collapsed') || el.classList.contains('is-float-hug'));
  if (shrunk && el.offsetHeight) return el.offsetHeight;
  return fallback;
}

/**
 * The lines one axis offers. `lo` are where a window's near edge (left or top)
 * may rest, `hi` where its far edge may.
 */
function snapLines(axis) {
  const size = axis === 'x' ? snapCtx.rect.width : snapCtx.rect.height;
  const lo = [];
  const hi = [];
  if (size > 0) {
    lo.push(EDGE_GUTTER);
    hi.push(size - EDGE_GUTTER);
  }
  for (const o of snapCtx.others) {
    const start = axis === 'x' ? o.l : o.t;
    const end = axis === 'x' ? o.r : o.b;
    lo.push(start, end + WINDOW_GAP);   // aligned with it, or just past it
    hi.push(end, start - WINDOW_GAP);   // aligned with it, or just short of it
  }
  return { lo, hi };
}

/** The closest line to `value`, as the distance to it and where it is — or null. */
function nearestLine(value, lines) {
  let best = null;
  for (const v of lines) {
    const d = v - value;
    if (Math.abs(d) <= SNAP_DIST && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v };
  }
  return best;
}

/** One axis of a move: whichever of the two edges is nearer a line wins. */
function snapAxis(pos, size, axis) {
  const { lo, hi } = snapLines(axis);
  const near = nearestLine(pos, lo);
  const far = nearestLine(pos + size, hi);
  const pick = near && (!far || Math.abs(near.d) <= Math.abs(far.d)) ? near : far;
  return pick ? { pos: pos + pick.d, guide: pick.v } : { pos, guide: null };
}

function snapMove(g) {
  const h = snapCtx.selfH || g.h;
  const sx = snapAxis(g.x, g.w, 'x');
  const sy = snapAxis(g.y, h, 'y');
  return { x: sx.pos, y: sy.pos, gx: sx.guide, gy: sy.guide };
}

/**
 * A resize snaps only the edges it is moving — the opposite ones are pinned
 * for the length of the gesture, the rule `resizeGeom` already follows — and
 * gives the snap up rather than break the section's minimum size.
 */
function snapResize(g, edge, min) {
  const out = { ...g };
  let gx = null;
  let gy = null;
  const { lo: xlo, hi: xhi } = snapLines('x');
  const { lo: ylo, hi: yhi } = snapLines('y');
  if (edge.includes('e')) {
    const s = nearestLine(g.x + g.w, xhi);
    if (s && g.w + s.d >= min.w) { out.w = g.w + s.d; gx = s.v; }
  } else if (edge.includes('w')) {
    const s = nearestLine(g.x, xlo);
    if (s && g.w - s.d >= min.w) { out.x = g.x + s.d; out.w = g.w - s.d; gx = s.v; }
  }
  if (edge.includes('s')) {
    const s = nearestLine(g.y + g.h, yhi);
    if (s && g.h + s.d >= min.h) { out.h = g.h + s.d; gy = s.v; }
  } else if (edge.includes('n')) {
    const s = nearestLine(g.y, ylo);
    if (s && g.h - s.d >= min.h) { out.y = g.y + s.d; out.h = g.h - s.d; gy = s.v; }
  }
  return { g: out, gx, gy };
}

/**
 * The two guide lines, created on first use and hidden rather than removed —
 * they are shown and hidden on every frame of a drag that crosses a line.
 */
function guide(axis) {
  const layer = floatLayer();
  if (!layer) return null;
  const id = 'panel-float-guide-' + axis;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'panel-float-guide is-' + axis;
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    layer.appendChild(el);
  }
  return el;
}

function showGuides(x, y) {
  const v = x === null && !document.getElementById('panel-float-guide-x') ? null : guide('x');
  const h = y === null && !document.getElementById('panel-float-guide-y') ? null : guide('y');
  if (v) {
    v.style.display = x === null ? 'none' : '';
    if (x !== null) v.style.left = x + 'px';
  }
  if (h) {
    h.style.display = y === null ? 'none' : '';
    if (y !== null) h.style.top = y + 'px';
  }
}

// ── the empty panel ───────────────────────────────────────────────

/**
 * A panel with every section pulled out of it.
 *
 * A blank rail under a tab strip reads as a bug rather than as a layout the
 * reader chose, so it says what happened and offers the way back. It is built
 * once and hidden rather than removed, because it is one node and rebuilding
 * it on every machine switch would be the more expensive of the two.
 */
export function syncPanelEmpty(side) {
  const cfg = PANEL_SECTIONS[side];
  const container = containerOf(side);
  if (!cfg || !container) return;

  const known = declaredSectionIds(side);
  // Spread, because `children` is an `HTMLCollection` and has no array methods
  // on it — `.some()` is `undefined` in a browser and throws, which is not
  // something a test DOM backed by a real array can tell you. `domOrder` in
  // panel-sections-ui.js spreads for the same reason.
  const shown = [...(container.children || [])].some(el =>
    known.includes(el.id) && el.style && el.style.display !== 'none');

  let note = document.getElementById(side + '-float-empty');
  if (shown) {
    if (note) note.style.display = 'none';
    return;
  }
  if (!note) {
    note = document.createElement('div');
    note.id = side + '-float-empty';
    note.className = 'panel-float-empty';
    const p = document.createElement('p');
    p.textContent = 'Every section is floating over the canvas.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-g panel-float-return';
    btn.textContent = 'Return all';
    btn.addEventListener('click', () => dockAllSections(side));
    note.appendChild(p);
    note.appendChild(btn);
  }
  note.style.display = '';
  container.appendChild(note);
}

// ── chrome ────────────────────────────────────────────────────────

/**
 * The pop-out button and the resize corner, added once per section.
 *
 * Injected rather than written into the markup eight times, the same reasoning
 * as `installModalChrome()` and the reorder grip: a control belonging to every
 * member of a set is added by the code that knows the set.
 *
 * The button matters for more than discoverability — a tear-off drag is a
 * pointer gesture, and without a button the feature would be unreachable from
 * a keyboard entirely.
 */
function installChrome(side, id) {
  const el = sectionEl(id);
  const cfg = PANEL_SECTIONS[side];
  if (!el || !cfg || el.__floatBtn) return;
  const header = typeof el.querySelector === 'function'
    ? el.querySelector('.' + cfg.headerClass) : null;
  if (!header) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'panel-float-btn';
  btn.tabIndex = 0;
  // The header collapses the section on click and this sits inside it, so
  // every way a press here can reach the header has to be stopped — or
  // pulling a section out would fold it on the way.
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    ev.preventDefault();
    toggleSectionFloat(id);
  });
  // Before the collapse arrow rather than after it: the arrow is the header's
  // rightmost control in both panels, and a button inserted past it would put
  // the two affordances in a different order on a window than in the panel.
  const arrow = typeof header.querySelector === 'function'
    ? header.querySelector('.lp-toggle-arrow, .rp-toggle-arrow') : null;
  if (arrow) header.insertBefore(btn, arrow);
  else header.appendChild(btn);

  // Eight, not one. A window resizable only from its bottom-right corner is a
  // window you have to move before you can widen it from the left, and the
  // single visible corner grip read as a decoration bolted onto a card rather
  // than as a window edge. These are invisible bands over the border — the
  // cursor is the affordance, which is what every desktop does.
  const grabs = {};
  RESIZE_EDGES.forEach(edge => {
    const grab = document.createElement('div');
    grab.className = 'panel-float-resize panel-float-resize-' + edge;
    grab.dataset.edge = edge;
    el.appendChild(grab);
    grabs[edge] = grab;
  });
  el.__floatGrabs = grabs;
  // Set last, and only once both nodes are in place: it is the idempotence
  // guard, and a half-built section that had already claimed it would never be
  // finished on a later pass.
  el.__floatBtn = btn;
}

/**
 * Marks the one part of a section that gives when its window is shorter than
 * its content, and nothing else.
 *
 * States Q has a list that should shrink and scroll under its search box, the
 * Trace card has a log that should, and the Language card is a stack of boxes
 * with nothing to favour. The registry names the one region — see
 * `sectionFill` — and everything else keeps its natural height, with the body
 * scrolling when the window is too small for it. The region also loses the
 * height cap it has in the panel, so a window can show all of a long list.
 *
 * A class rather than a rule per section id, so adding a section is still an
 * entry in the registry and its markup.
 */
function syncFill(id, on) {
  const el = sectionEl(id);
  const sel = sectionFill(id);
  if (!el || !sel || typeof el.querySelector !== 'function') return;
  const target = el.querySelector(sel);
  if (target && target.classList) target.classList.toggle('panel-float-fill', !!on);
}

/** Keeps the button saying what it will do. */
function syncChrome(id) {
  const el = sectionEl(id);
  const btn = el && el.__floatBtn;
  if (!btn) return;
  const out = el.classList.contains('panel-float');
  btn.innerHTML = out ? CLOSE_SVG : POPOUT_SVG;
  btn.setAttribute('aria-label', out ? 'Return to panel' : 'Pull out of panel');
  btn.setAttribute('data-tip', out ? 'Return to panel' : 'Pull out of panel');
  // The title bar's keys are invisible, so the title bar says what they are —
  // and only while it is one. Docked, the arrows mean nothing here.
  const header = btn.parentNode;
  if (header && typeof header.setAttribute === 'function') {
    if (out) header.setAttribute('aria-description', 'Floating window. Arrow keys move it; Shift with the arrow keys resizes it.');
    else if (typeof header.removeAttribute === 'function') header.removeAttribute('aria-description');
  }
}

// ── moving and resizing ───────────────────────────────────────────

/**
 * The geometry a gesture starts from.
 *
 * Read off the element rather than out of storage. `floatState` is the record
 * of where a window was *left*, and a gesture that could not start because the
 * write behind that record had failed — a full quota, a private-mode refusal —
 * would be a window that paints correctly and cannot be touched. What is on
 * screen is the truth here; storage is the memory of it.
 */
function liveGeom(el, id) {
  const x = parseFloat(el.style.left);
  const y = parseFloat(el.style.top);
  const w = parseFloat(el.style.width);
  // The height a window holds, which is not always its ceiling: a window that
  // follows its content draws up to the room below it — see `applyGeom`.
  const h = parseFloat(el.dataset.floatH || el.style.maxHeight);
  const fit = !!(el.classList && el.classList.contains('is-float-fit'));
  if (Number.isFinite(x) && Number.isFinite(y) &&
    Number.isFinite(w) && Number.isFinite(h)) return fit ? { x, y, w, h, fit } : { x, y, w, h };
  // Only now, and this is the point of the early return above: `floatState`
  // is a `localStorage.getItem` plus a `JSON.parse` plus a walk of the side's
  // declared sections, and `moveFloatTo` calls this on every frame of every
  // drag. The fallback is for a window whose inline geometry is missing, which
  // is a window that has not been placed yet — never one being dragged.
  const stored = floatState(id);
  return {
    ...(stored && stored.fit ? { fit: true } : {}),
    x: Number.isFinite(x) ? x : (stored ? stored.x : 24),
    y: Number.isFinite(y) ? y : (stored ? stored.y : 24),
    w: Number.isFinite(w) ? w : (stored ? stored.w : FLOAT_MIN_W),
    h: Number.isFinite(h) ? h : (stored ? stored.h : FLOAT_MIN_H)
  };
}

function beginMove(id, e) {
  const el = sectionEl(id);
  if (!el || !el.classList.contains('panel-float')) return;
  // Once per gesture, so the whole drag runs off one measurement and a
  // notification this module never received costs a frame rather than a stuck
  // window. See floatLayerRect().
  layerRect = null;
  const g = liveGeom(el, id);
  // Armed on the press, not on the first sample: the shake is measured from
  // where the window was taken hold of, so the leg that fires it is a leg of
  // this gesture and not of whatever the pointer did before it.
  beginShakeTrack();
  beginFloatSnap(id);
  gesture = {
    kind: 'move', id, el,
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    originX: g.x, originY: g.y,
    geom: g, active: false
  };
  raiseFloat(el);
  // Deliberately **no** pointer capture and no preventDefault here. A press on
  // the title bar is a click until it travels, and the click is what collapses
  // the window — the minimize. Capturing on `pointerdown` retargets the
  // `pointerup` to the captured element, so the browser computes the click's
  // target as the nearest common ancestor of the two: the section, which is
  // the header's *parent*. The header's own `onclick` then never runs, and the
  // window cannot be minimized at all. Both are taken in `onPointerMove`, at
  // the point the gesture stops being a click.
}

function beginResize(id, e, edge) {
  const el = sectionEl(id);
  if (!el || !el.classList.contains('panel-float')) return;
  layerRect = null;
  let g = liveGeom(el, id);
  // A window is drawn at its content's height when that is less than the
  // ceiling it holds, and the gesture starts from what is drawn — or the first
  // pixels of a drag would be spent pulling the ceiling back down to the window
  // before anything visibly moved.
  const natural = naturalHeight(el);
  if (natural > 0) g = { ...g, h: Math.min(drawnCeiling(el, g), natural) };
  if (typeof e.stopPropagation === 'function') e.stopPropagation();
  if (typeof e.preventDefault === 'function') e.preventDefault();
  gesture = {
    kind: 'resize', id, el,
    edge: edge || 'se',
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    origin: g, natural,
    geom: g, active: true
  };
  el.classList.add('is-float-sizing');
  capture(el, e);
  raiseFloat(el);
  beginFloatSnap(id);
}

/**
 * The box a drag on `edge` puts the window in.
 *
 * A north or west edge moves the window as well as sizing it, and the minimum
 * has to be applied by **pinning the opposite edge** rather than by clamping
 * the width afterwards: clamping alone lets `x` go on travelling once the
 * width has bottomed out, so a window dragged past its own minimum from the
 * left creeps away to the right instead of stopping.
 */
function resizeGeom(o, edge, dx, dy, min) {
  let { x, y, w, h } = o;
  if (edge.includes('e')) w = o.w + dx;
  if (edge.includes('s')) h = o.h + dy;
  if (edge.includes('w')) { w = o.w - dx; x = o.x + dx; }
  if (edge.includes('n')) { h = o.h - dy; y = o.y + dy; }
  if (w < min.w) {
    w = min.w;
    if (edge.includes('w')) x = o.x + o.w - min.w;
  }
  if (h < min.h) {
    h = min.h;
    if (edge.includes('n')) y = o.y + o.h - min.h;
  }
  return { x, y, w, h };
}

function capture(el, e) {
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* mouse still works */ }
}

/** The window a completed move must not let become a collapse. */
let swallowClickOn = null;

/**
 * Where a gesture starts, decided from the event's target rather than from a
 * listener the section was given.
 *
 * Delegated on purpose. Per-section listeners have to be attached by a pass
 * that runs at the right moment, exactly once, over a section whose header the
 * pass could find — three ways for a window to end up painted, movable-looking
 * and inert, none of which show up as an error. One listener on `document`
 * cannot get any of that wrong, and it covers a section whose chrome failed to
 * install for any reason at all.
 *
 * Capture phase, so a press is claimed before anything between here and the
 * window can stop it propagating.
 */
function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  const win = t.closest('.panel-float');
  if (!win || !win.id || !sectionSide(win.id)) return;

  raiseFloat(win);
  // The close button is a control, not a title bar.
  if (t.closest('.panel-float-btn')) return;
  const grab = t.closest('.panel-float-resize');
  if (grab) { beginResize(win.id, e, grab.dataset.edge); return; }

  // Moving a window by its title bar is the one universal convention there is,
  // and the ambiguity the reorder grip exists to avoid does not arise here:
  // there is no keyboard move to lose, and travel decides. A press that does
  // not travel is still a collapse. The grip inside the header is deliberately
  // included — it is what the reader took hold of to pull the section out, and
  // it goes on being the thing you take hold of to move it.
  const cfg = PANEL_SECTIONS[sectionSide(win.id)];
  if (!cfg || !t.closest('.' + cfg.headerClass)) return;
  beginMove(win.id, e);
}

/**
 * A move ends in a click, and the header's click collapses the section — so
 * the drag would fold the window it just finished placing.
 *
 * Capture on `document`, which is above the header's own inline `onclick`, and
 * armed only by a move that actually travelled.
 */
function onClickCapture(e) {
  const armed = swallowClickOn;
  swallowClickOn = null;
  if (!armed) return;
  const t = e.target;
  const win = t && typeof t.closest === 'function' ? t.closest('.panel-float') : null;
  if (win !== armed) return;
  e.stopPropagation();
  if (typeof e.preventDefault === 'function') e.preventDefault();
}

function onPointerMove(e) {
  if (!gesture) return;
  // The pointer that started this one, and no other. These listeners are on
  // `document`, so a second finger, a stylus alongside a mouse, or a pointer
  // belonging to some other gesture entirely all deliver here — and every one
  // of them would drive this window from its own coordinates, snapping it
  // across the canvas. `undefined` is the test DOM's synthetic event, which
  // has no pointer to be a different one.
  if (e.pointerId !== undefined && gesture.pointerId !== undefined &&
    e.pointerId !== gesture.pointerId) return;
  if (!gesture.active) {
    if (Math.abs(e.clientX - gesture.startX) < MOVE_THRESHOLD &&
      Math.abs(e.clientY - gesture.startY) < MOVE_THRESHOLD) return;
    gesture.active = true;
    gesture.el.classList.add('is-float-moving');
    // Now it is a drag: take the pointer, so the window keeps following a fast
    // gesture that outruns it, and swallow the click it will end in — which is
    // no longer a request to collapse.
    capture(gesture.el, gesture);
    swallowClickOn = gesture.el;
  }
  e.preventDefault();
  const snap = !(e.ctrlKey || e.metaKey);
  if (gesture.kind === 'move') {
    // Only a move, and only a window that is already out — see the note at the
    // top of panel-shake.js for why a tear-off is not shakeable.
    if (noteShakeSample(e.clientX, e.clientY)) reanchorAfterShake();
    gesture.geom = moveFloatTo(gesture.id,
      gesture.originX + (e.clientX - gesture.startX),
      gesture.originY + (e.clientY - gesture.startY), { snap }) || gesture.geom;
    return;
  }
  const min = sectionMinSize(gesture.id);
  const raw = resizeGeom(gesture.origin, gesture.edge,
    e.clientX - gesture.startX, e.clientY - gesture.startY, min);
  // `clampGeom` holds `y` at the top of the well, and on a north drag that is
  // only half an answer: pushing the top edge above the canvas clamped `y` and
  // left `h` at the height the pointer had asked for, so the *bottom* edge slid
  // down and the window grew out from under a gesture that was shrinking it.
  // The opposite edge is the fixed one all the way through a resize — the same
  // rule `resizeGeom` applies at the minimum — so pull the height back by
  // however far the top was held.
  if (gesture.edge.includes('n') && raw.y < 0) {
    raw.h = Math.max(min.h, raw.h + raw.y);
    raw.y = 0;
  }
  // No taller than the window's content, with the opposite edge pinned the way
  // it is at the minimum. A drag that reaches the content's full height says
  // the window should go on showing all of it — `fit`, see `applyGeom` — and
  // one that stops short sets a ceiling. A side edge says nothing about height
  // and keeps what the window had.
  let fit = !!gesture.origin.fit;
  if (gesture.natural > 0) {
    if (/[ns]/.test(gesture.edge)) fit = raw.h >= gesture.natural;
    if (raw.h > gesture.natural) {
      if (gesture.edge.includes('n')) raw.y += raw.h - gesture.natural;
      raw.h = gesture.natural;
    }
  }
  const snapped = snap && snapCtx && snapCtx.id === gesture.id
    ? snapResize(raw, gesture.edge, min) : { g: raw, gx: null, gy: null };
  const g = clampGeom({ ...snapped.g, fit }, floatLayerRect(), min);
  showGuides(snapped.gx, snapped.gy);
  applyGeom(gesture.el, g);
  gesture.geom = g;
}

/**
 * Keeps the window under the pointer across the layout the shake just caused.
 *
 * A window's coordinates are local to the canvas well, and unpinning a sidebar
 * *moves* that well: an unpinned panel is absolutely positioned over the
 * canvas rather than beside it, so the well grows and its left edge travels.
 * The drag is a mapping from screen space into that local space, and the
 * mapping has just changed underneath it — left alone, the window jumps
 * sideways by the width of the panel that got out of the way, at the exact
 * moment the reader is holding it.
 *
 * `setPanelPinned` has already written the class, and reading the box forces
 * the layout flush that resolves it, so the new origin is available here
 * rather than a frame later when the ResizeObserver gets round to it.
 */
function reanchorAfterShake() {
  const before = floatLayerRect();
  layerRect = null;
  const after = floatLayerRect();
  gesture.originX += before.left - after.left;
  gesture.originY += before.top - after.top;
  // The well's edges are two of the lines the window snaps to, and they have
  // just moved.
  beginFloatSnap(gesture.id);
}

function onPointerUp(e) {
  if (!gesture) return;
  if (e && e.pointerId !== undefined && gesture.pointerId !== undefined &&
    e.pointerId !== gesture.pointerId) return;
  const { id, el, geom, active, kind, pointerId } = gesture;
  gesture = null;
  endShakeTrack();
  endFloatSnap();
  el.classList.remove('is-float-moving', 'is-float-sizing');
  try { el.releasePointerCapture(pointerId); } catch (err) { /* already gone */ }
  if (!active) return;
  commitFloatGeom(id, geom);
  // A window that just changed height holds lists windowed against the height
  // it used to have. See redrawAllLists().
  if (kind === 'resize') redrawAllLists();
}

// ── the keyboard ──────────────────────────────────────────────────
//
// The pop-out button made a window reachable from the keyboard; this makes it
// usable. With its title bar focused, the arrow keys move a window and
// Shift+arrows resize it from the bottom-right, `KEY_STEP` at a time. Enter
// and Space keep the job they have on every section header — collapsing it —
// and Escape is still nobody's here (see the note at the top of the file).

/** The title bar a key press was aimed at, if it belongs to a window. */
function floatingHeader(t) {
  const win = t && t.parentNode;
  if (!win || !win.classList || !win.classList.contains('panel-float')) return null;
  const side = sectionSide(win.id);
  const cfg = side && PANEL_SECTIONS[side];
  if (!cfg || !t.classList || !t.classList.contains(cfg.headerClass)) return null;
  return win;
}

/**
 * Capture phase, and it stops the key: ArrowLeft and ArrowRight also step the
 * simulation from the canvas's shortcuts, and a key pressed on a window's
 * title bar must move the window and nothing else. Claimed only for exactly
 * that target, so no other handler below loses a key it should have had.
 */
function onKeyDown(e) {
  if (!e.key || !e.key.startsWith('Arrow') || e.altKey || e.ctrlKey || e.metaKey) return;
  const win = floatingHeader(e.target);
  if (!win || gesture) return;
  e.preventDefault();
  e.stopPropagation();
  const dx = e.key === 'ArrowRight' ? KEY_STEP : e.key === 'ArrowLeft' ? -KEY_STEP : 0;
  const dy = e.key === 'ArrowDown' ? KEY_STEP : e.key === 'ArrowUp' ? -KEY_STEP : 0;
  const id = win.id;
  const g = liveGeom(win, id);
  const min = sectionMinSize(id);
  const rect = floatLayerRect();
  let next;
  if (e.shiftKey) {
    // A minimized window is a title strip, with no body to size.
    if (win.classList.contains('collapsed')) return;
    // The same rule as the pointer: stepping down onto the content's full
    // height follows the content from then on, stepping up sets a ceiling.
    const natural = naturalHeight(win);
    const from = natural > 0 ? Math.min(drawnCeiling(win, g), natural) : g.h;
    let h = Math.max(min.h, from + dy);
    let fit = !!g.fit;
    if (natural > 0) {
      if (dy > 0 && h >= natural) fit = true;
      if (dy < 0) fit = false;
      h = Math.min(h, natural);
    }
    next = clampGeom({ ...g, w: Math.max(min.w, g.w + dx), h, fit }, rect, min);
  } else {
    next = clampGeom({ ...g, x: g.x + dx, y: g.y + dy }, rect, min);
  }
  applyGeom(win, next);
  raiseFloat(win);
  // Written per press rather than per gesture: there is no release to wait
  // for, and a key held down repeats at a rate storage shrugs off.
  commitFloatGeom(id, next);
  if (e.shiftKey) redrawAllLists();
}

/** Tabbing into a window brings it forward, the way pressing on it does. */
function onFocusIn(e) {
  const t = e.target;
  const win = t && typeof t.closest === 'function' ? t.closest('.panel-float') : null;
  if (win && win !== frontWindow) raiseFloat(win);
}

// ── the restore pass ──────────────────────────────────────────────

/**
 * Puts every section where its record says it should be.
 *
 * Idempotent and safe to call whenever something might have moved — a boot, a
 * viewport crossing the mobile breakpoint, a machine switch that hid a
 * section. It is the only thing that reads the whole float table.
 */
export function applyFloatLayout() {
  layerRect = null;
  suspended = !isDesktop();
  PANEL_SECTION_SIDES.forEach(side => {
    const states = floatStates(side);
    declaredSectionIds(side).forEach(id => {
      const el = sectionEl(id);
      if (!el) return;
      const wants = !!states[id];
      const isOut = el.classList.contains('panel-float');
      if (wants && !suspended) {
        if (!isOut) floatSection(id, states[id]);
        else {
          // Written back, not just painted. Clamping a record into a well that
          // has since got smaller and leaving the record alone puts the element
          // and the memory of it out of step, and the next thing to read the
          // record — a gesture that could not parse the inline styles, a
          // restore into a *wider* well — puts the window back off-screen.
          // The anchors are kept: they are where the reader left it, and the
          // position is only what that means in the well as it is now.
          const g = placeInWell(states[id], floatLayerRect(), sectionMinSize(id));
          applyGeom(el, g);
          if (!sameGeom(g, states[id])) setFloatState(id, keepAnchors(g, states[id]));
        }
      } else if (isOut) {
        // Suspending keeps the record; only a reader docking a window clears it.
        dockSection(id, { persist: !suspended });
      }
    });
    syncPanelEmpty(side);
  });
}

/** Whether any window is out at all, across both panels. */
function anyFloating() {
  return PANEL_SECTION_SIDES.some(side => Object.keys(floatStates(side)).length > 0);
}

function sameGeom(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h &&
    !!a.fit === !!b.fit;
}

/**
 * Puts every window where its record says, in a canvas that just changed size:
 * back inside it if it got smaller, and against the edge it is anchored to
 * whichever way it went.
 *
 * Only what actually moved is written. A record is a `JSON.stringify` into
 * `localStorage`, and this runs from a `ResizeObserver` — which fires on every
 * frame of a panel-resizer drag, so writing unconditionally meant a storage
 * write per window per frame to store the coordinates already there.
 */
function reclampAll() {
  const rect = floatLayerRect();
  PANEL_SECTION_SIDES.forEach(side => {
    const states = floatStates(side);
    Object.keys(states).forEach(id => {
      const el = sectionEl(id);
      if (!el || !el.classList.contains('panel-float')) return;
      // Never the window in the reader's hand. A record is where a window was
      // *left*, and a drag has not committed one yet — so re-applying it mid-
      // gesture snaps the window back to where the drag started. That is not
      // hypothetical: the shake unpins the sidebars, which resizes the well,
      // which delivers a tick here on the very next frame of the drag that
      // caused it. The gesture is the authority on a window it is holding.
      if (gesture && gesture.id === id) return;
      const g = placeInWell(states[id], rect, sectionMinSize(id));
      // A window following its content is capped by the room below it, which
      // the well just changed even where the record did not.
      if (sameGeom(g, states[id])) {
        if (g.fit) applyGeom(el, g);
        return;
      }
      applyGeom(el, g);
      setFloatState(id, keepAnchors(g, states[id]));
    });
  });
}

// ── installing ────────────────────────────────────────────────────

export function initPanelFloat() {
  suspended = !isDesktop();
  PANEL_SECTION_SIDES.forEach(side => {
    declaredSectionIds(side).forEach(id => {
      installChrome(side, id);
      syncChrome(id);
    });
  });
  if (!installed) {
    installed = true;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClickCapture, true);
    // On `document`, not on the window: a pointer capture can be lost and a
    // gesture that can never end leaves a window stuck to the pointer.
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    subscribeOnce();
  }

  // Last, because it is the part that touches the page. Registering the
  // gestures first means a window can always be moved and put back, even if
  // restoring a saved layout went wrong.
  applyFloatLayout();
}

function subscribeOnce() {
  // A machine switch hides the Machine and Blocks sections with `style.display`.
  // A hidden *window* is correct — the record is kept, so switching back puts
  // it where the reader left it rather than in the panel — but a panel whose
  // last visible section just went is one that now needs its empty state.
  subscribe(Change.GRAPH, () => PANEL_SECTION_SIDES.forEach(syncPanelEmpty));

  try {
    if (typeof ResizeObserver === 'function') {
      const wrap = canvasWrap();
      if (wrap) {
        // Every tick did all three jobs unconditionally, and a panel-resizer
        // drag delivers one per frame — so widening a panel re-parsed both
        // sides' float records, re-measured the well, rewrote storage, and
        // rebuilt both windowed lists from `innerHTML`, sixty times a second,
        // on a page with nothing floating at all. Each job now asks for the
        // change that implies it.
        let last = null;
        const ro = new ResizeObserver(() => {
          // First, always: this is the one notification that the cached box is
          // stale, and everything below reads it.
          layerRect = null;
          const size = floatLayerRect();
          const grew = !last || last.width !== size.width || last.height !== size.height;
          const taller = !last || last.height !== size.height;
          last = size;

          const was = suspended;
          suspended = !isDesktop();
          if (was !== suspended) {
            applyFloatLayout();
            redrawAllLists();
            return;
          }
          // A window is clamped by the well it sits in, so only a resize of it
          // can have pushed one out of view.
          if (grew && anyFloating()) reclampAll();
          // A list is windowed against its host's *height*. The panel resizer
          // moves a vertical edge, so it changes the canvas's width and no
          // list's height — redrawing there rebuilt two lists per frame to
          // arrive at the rows already on screen.
          if (taller) redrawAllLists();
        });
        ro.observe(wrap);
        rectCacheArmed = true;
      }
    }
  } catch (e) {
    // No observer, so nothing would ever say the well had moved: the rect goes
    // back to being measured on demand rather than being cached stale forever.
    rectCacheArmed = false;
  }
}

/**
 * The re-clamp, exposed for the tests.
 *
 * Its only caller is the `ResizeObserver`, which a test DOM never fires — and
 * the invariant it carries (a drag owns the window it is holding) is one the
 * shake gesture walks straight into, since unpinning the sidebars resizes the
 * well on the very next frame of the drag that caused it.
 */
export const _floatTests = { reclampAll };

/** Whether a move or resize is in flight — the tests' way in. */
export function isMovingFloat() {
  return !!(gesture && gesture.active);
}

/**
 * Drops module state between tests. A gesture left in flight would have the
 * next test dragging the last one's window, and `suspended` latches.
 */
export function resetPanelFloat() {
  gesture = null;
  endShakeTrack();
  snapCtx = null;
  frontWindow = null;
  suspended = false;
  raiseSeq = 0;
  layerRect = null;
  PANEL_SECTION_SIDES.forEach(side => resetFloatStates(side));
}
