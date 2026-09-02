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
import { Change, subscribe } from './store.js';

/** How much of a window must stay reachable when it is clamped into view. */
const EDGE_KEEP = 76;

/** Pointer travel before a press on a floating header becomes a move. */
const MOVE_THRESHOLD = 3;

/** How far each new window is offset from the last, so none hides another. */
const CASCADE_STEP = 26;

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
  return { x, y, w, h };
}

function applyGeom(el, g) {
  el.style.left = g.x + 'px';
  el.style.top = g.y + 'px';
  el.style.width = g.w + 'px';
  // The height is written unconditionally and `.panel-float.collapsed` beats it
  // with `!important` in the stylesheet. Collapsing a window would otherwise
  // have to reach in here to clear the inline height and put it back on expand
  // — which means hooking `toggleLPSection`, and the stored size surviving a
  // collapse is exactly the thing that would then be easy to lose.
  el.style.height = g.h + 'px';
}

/**
 * A size for a section that has never been floated: the one it has in the
 * panel. Pulling a section out should not also resize it.
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
  return clampGeom({
    x: Math.max(16, Math.round(((rect && rect.width) || 640) * 0.5 - w / 2)) + step,
    y: 24 + step,
    w: Math.max(min.w, Math.round(w) || 280),
    h: Math.max(min.h, Math.round(h) || 260)
  }, rect, min);
}

/** How many windows are out right now, across both panels. */
function openWindowCount() {
  return PANEL_SECTION_SIDES.reduce((n, side) =>
    n + Object.keys(floatStates(side)).length, 0);
}

// ── raising ───────────────────────────────────────────────────────

export function raiseFloat(el) {
  if (!el) return;
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
  const g = clampGeom(geom || floatState(id) || naturalGeom(el, rect, id), rect, sectionMinSize(id));

  if (el.parentNode !== layer) layer.appendChild(el);
  el.classList.add('panel-float');
  el.dataset.floatSide = side;
  applyGeom(el, g);
  raiseFloat(el);
  installChrome(side, id);
  syncChrome(id);
  syncFill(id, true);
  setFloatState(id, g);
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

  el.classList.remove('panel-float', 'is-float-moving', 'is-float-sizing');
  delete el.dataset.floatSide;
  el.style.left = '';
  el.style.top = '';
  el.style.width = '';
  el.style.height = '';
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

/** Moves a window that is already floating. Used by the drag gestures. */
export function moveFloatTo(id, x, y) {
  const el = sectionEl(id);
  if (!el || !el.classList.contains('panel-float')) return null;
  // The size comes off the element for the same reason `liveGeom` does: a
  // failed write must not shrink a window to the minimum the moment it is
  // dragged.
  const live = liveGeom(el, id);
  const g = clampGeom({ x, y, w: live.w, h: live.h }, floatLayerRect(), sectionMinSize(id));
  applyGeom(el, g);
  return g;
}

/** Records where a drag left a window. Separated so a move can paint every
 *  frame and write storage once, on release. */
export function commitFloatGeom(id, g) {
  return setFloatState(id, clampGeom(g, floatLayerRect(), sectionMinSize(id)));
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
 * Hands a window's spare height to the one part of the section that should
 * take it, and to nothing else.
 *
 * A window is taller than the content was drawn for, and what happens to the
 * slack is a property of the section: States Q has a list that should grow and
 * scroll, Simulate has a trace log that should, and the Language card is a
 * stack of boxes where stretching anything only spreads it out. The registry
 * names the one region — see `sectionFill` — and everything else keeps its
 * natural height, with the body scrolling when the window is too small for it.
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
  const h = parseFloat(el.style.height);
  if (Number.isFinite(x) && Number.isFinite(y) &&
    Number.isFinite(w) && Number.isFinite(h)) return { x, y, w, h };
  // Only now, and this is the point of the early return above: `floatState`
  // is a `localStorage.getItem` plus a `JSON.parse` plus a walk of the side's
  // declared sections, and `moveFloatTo` calls this on every frame of every
  // drag. The fallback is for a window whose inline geometry is missing, which
  // is a window that has not been placed yet — never one being dragged.
  const stored = floatState(id);
  return {
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
  const g = liveGeom(el, id);
  if (typeof e.stopPropagation === 'function') e.stopPropagation();
  if (typeof e.preventDefault === 'function') e.preventDefault();
  gesture = {
    kind: 'resize', id, el,
    edge: edge || 'se',
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    origin: g,
    geom: g, active: true
  };
  el.classList.add('is-float-sizing');
  capture(el, e);
  raiseFloat(el);
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
  if (gesture.kind === 'move') {
    gesture.geom = moveFloatTo(gesture.id,
      gesture.originX + (e.clientX - gesture.startX),
      gesture.originY + (e.clientY - gesture.startY)) || gesture.geom;
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
  const g = clampGeom(raw, floatLayerRect(), min);
  applyGeom(gesture.el, g);
  gesture.geom = g;
}

function onPointerUp(e) {
  if (!gesture) return;
  if (e && e.pointerId !== undefined && gesture.pointerId !== undefined &&
    e.pointerId !== gesture.pointerId) return;
  const { id, el, geom, active, kind, pointerId } = gesture;
  gesture = null;
  el.classList.remove('is-float-moving', 'is-float-sizing');
  try { el.releasePointerCapture(pointerId); } catch (err) { /* already gone */ }
  if (!active) return;
  commitFloatGeom(id, geom);
  // A window that just changed height holds lists windowed against the height
  // it used to have. See redrawAllLists().
  if (kind === 'resize') redrawAllLists();
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
          const g = clampGeom(states[id], floatLayerRect(), sectionMinSize(id));
          applyGeom(el, g);
          if (!sameGeom(g, states[id])) setFloatState(id, g);
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
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Pulls every window back inside a canvas that just got smaller.
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
      const g = clampGeom(states[id], rect, sectionMinSize(id));
      if (sameGeom(g, states[id])) return;
      applyGeom(el, g);
      setFloatState(id, g);
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
    subscribeOnce();
  }

  // Last, because it is the part that touches the page. Registering the
  // gestures first means a window can always be moved and put back, even if
  // restoring a saved layout went wrong.
  applyFloatLayout();
}

function subscribeOnce() {
  // A machine switch hides the stack and output sections with `style.display`.
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
  suspended = false;
  raiseSeq = 0;
  layerRect = null;
  PANEL_SECTION_SIDES.forEach(side => resetFloatStates(side));
}
