import { settleAll } from './anim.js';
import { beginDividerDraw, dividerMid, dividerToolKind, dragDividerEndpointTo, dragSelectedDividersTo, endDividerEndpointDrag, finishDividerDraw, getDivider, includeDividerBounds, syncDividerSelectionClasses, updateDividerDraw, updateOneDividerDOM } from './dividers.js';
import { exportDownload, exportFilename } from './export-core.js';
import { fontFaceCSS } from './export-fonts.js';
import { applyOutlines, loadGlyphTables, planOutlines } from './glyphs.js';
import { includeLayoutBounds, resolveNodeOverlaps, startNodeId } from './geometry.js';
import { getBlock, inlineBlock, outlineBlock } from './blocks.js';
import { getNode, invalidateViewGraph, isPortNode, scopeId, viewStates, viewTransitions } from './view-graph.js';
import { markViewDirty, snapshot } from './history.js';
import { clearActiveNoteHighlight, dragSelectedNotesTo, endNoteResize, getNote, includeNoteBounds, resizeNoteTo, resolveNotePos, syncNoteSelectionClasses } from './notes.js';
import { getWorkspaceData } from './persistence.js';
import { currentLayoutContext, makeSVG, renderAll, repaintForCamera, scheduleFastDOM, updateFastDOM, updateLPanel, updateRPanel, withFullRender } from './render.js';
import { $, App } from './state.js';
import { createState, deleteState, getState, getTransition, hideContextMenu, newId, newTId, openTransModal } from './states-transitions.js';
import { Change, emit } from './store.js';
import { scheduleMinimap } from './minimap.js';
import { fitToScreen, markActiveWorkspaceSaved, visibleCanvasBox } from './ui.js';
import { showStatus } from './utils.js';
import { LOD_LABEL_ZOOM } from './viewport.js';

// ══════════════════════════════════════════════════════════════════
//  CANVAS / CAMERA (ZOOM & PAN)
// ══════════════════════════════════════════════════════════════════
export const wrap = $('canvas-wrap');
export let isPanning = false, panStart = { x: 0, y: 0 }, camStart = { x: 0, y: 0 };
export let panPointerId = null;

// Touch navigation is deliberately separate from the mouse/pen gesture
// state below. A second finger cancels any in-progress edit gesture and owns
// the camera until the pinch/pan ends, which prevents a node drag from turning
// into a browser page zoom or a half-applied canvas move.
export const touchPointers = new Map();
export let touchCameraGesture = null;
export let touchLongPressTimer = null;
export let touchLongPressStart = null;

export function clearTouchLongPress() {
  if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
  touchLongPressTimer = null;
  touchLongPressStart = null;
}

export function scheduleTouchLongPress(e) {
  clearTouchLongPress();
  touchLongPressStart = { x: e.clientX, y: e.clientY };
  const target = e.target.closest('.sn, .edge-g, .note-g, .divider-g');
  const menuTarget = target || wrap;
  touchLongPressTimer = setTimeout(() => {
    touchLongPressTimer = null;
    cancelCanvasManipulationForTouch();
    if (menuTarget === wrap) {
      App.ctxCanvasPt = svgPt({ clientX: e.clientX, clientY: e.clientY });
      showCanvasContextMenu(e.clientX, e.clientY);
      return;
    }
    const menuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY
    });
    menuTarget.dispatchEvent(menuEvent);
  }, 550);
}

export function touchPair() {
  return [...touchPointers.values()].slice(0, 2);
}

export function cancelCanvasManipulationForTouch() {
  stopAutoPan();
  isPanning = false;
  panPointerId = null;
  wrap.classList.remove('panning');

  if (App.marqueeRect) App.marqueeRect.remove();
  App.marqueeRect = null;
  App.marquee = null;
  App.dragOffsets = null;
  App.dragCurve = null;
  App.dragPendingSnapshot = false;
  if (typeof clearAlignGuides === 'function') clearAlignGuides();
}

export function beginTouchCameraGesture() {
  const pair = touchPair();
  if (pair.length < 2) return;
  const a = pair[0], b = pair[1];
  const r = wrapRect();
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const startZoom = App.cam.z;
  touchCameraGesture = {
    startCenter: center,
    startDistance: distance,
    startZoom,
    startCam: { x: App.cam.x, y: App.cam.y },
    worldAtCenter: {
      x: (center.x - r.left - App.cam.x) / startZoom,
      y: (center.y - r.top - App.cam.y) / startZoom
    }
  };
  cancelCanvasManipulationForTouch();
}

export function updateTouchCameraGesture() {
  if (!touchCameraGesture) return;
  const pair = touchPair();
  if (pair.length < 2) return;
  const a = pair[0], b = pair[1];
  const r = wrapRect();
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const newZoom = clampZoom(touchCameraGesture.startZoom * distance / touchCameraGesture.startDistance);
  App.cam.x = center.x - r.left - touchCameraGesture.worldAtCenter.x * newZoom;
  App.cam.y = center.y - r.top - touchCameraGesture.worldAtCenter.y * newZoom;
  App.cam.z = newZoom;
  applyCamera();
}

export function captureTouchPointerDown(e) {
  if (e.pointerType !== 'touch') return;
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, #status-bar, .panel-float, .scope-bar')) return;
  touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPointers.size === 2) {
    clearTouchLongPress();
    beginTouchCameraGesture();
    e.preventDefault();
    e.stopPropagation();
  } else {
    scheduleTouchLongPress(e);
  }
}

export function captureTouchPointerMove(e) {
  if (e.pointerType !== 'touch' || !touchPointers.has(e.pointerId)) return;
  if (touchLongPressStart && Math.hypot(e.clientX - touchLongPressStart.x, e.clientY - touchLongPressStart.y) > 10) {
    clearTouchLongPress();
  }
  touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchCameraGesture) {
    updateTouchCameraGesture();
    e.preventDefault();
    e.stopPropagation();
  }
}

export function captureTouchPointerEnd(e) {
  if (e.pointerType !== 'touch' || !touchPointers.has(e.pointerId)) return;
  clearTouchLongPress();
  touchPointers.delete(e.pointerId);
  if (touchCameraGesture) {
    e.preventDefault();
    e.stopPropagation();
    if (touchPointers.size < 2) {
      touchCameraGesture = null;
      if (typeof markViewDirty === 'function') markViewDirty();
    }
  }
}

// Capture sees touches that start on an SVG state or edge before those nodes
// stop propagation, so pinch can reliably take over from any edit gesture.
wrap.addEventListener('pointerdown', captureTouchPointerDown, { capture: true });
wrap.addEventListener('pointermove', captureTouchPointerMove, { capture: true });
wrap.addEventListener('pointerup', captureTouchPointerEnd, { capture: true });
wrap.addEventListener('pointercancel', captureTouchPointerEnd, { capture: true });

// ── the canvas well's box ──
//
// `getBoundingClientRect` on #canvas-wrap forces a synchronous layout flush
// against the whole diagram — the same 8.4ms that renderExampleCard's guard
// exists for. Every pointermove during a drag read it at least twice: once in
// svgPt to convert the pointer, and once in checkAutoPan, which runs
// *immediately after* updateFastDOM has written a few hundred SVG attributes.
// A read straight after a write is the one ordering that cannot be answered
// from the browser's cache, so that second call re-laid the entire SVG on
// every frame of every drag.
//
// This is the same arrangement panel-float.js already makes for the same
// element and the same reason: cache the box, and let a ResizeObserver say when
// it has moved. Every way the well can move changes its *size* — a viewport
// resize, a panel pinned or dragged wider, the toolbar collapsing, a sheet
// opening — so size is a sufficient signal. With no observer to arm it (the
// test DOM) it measures every time, exactly as it did before.
let wellRect = null;
let wellRectArmed = false;

/** Drops the cached box, so the next read measures. */
export function invalidateWellRect() { wellRect = null; }

export function wrapRect() {
  if (wellRectArmed && wellRect) return wellRect;
  const r = wrap.getBoundingClientRect();
  const out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  if (wellRectArmed) wellRect = out;
  return out;
}

if (typeof ResizeObserver === 'function' && wrap && typeof wrap.getBoundingClientRect === 'function') {
  try {
    new ResizeObserver(() => { wellRect = null; }).observe(wrap);
    // A scroll moves the box without resizing it. The app does not scroll the
    // document today, but a stale origin would put every pointer coordinate out
    // by the scroll offset, which is far worse than the read it saves.
    addEventListener('scroll', () => { wellRect = null; }, { passive: true, capture: true });
    wellRectArmed = true;
  } catch (err) {
    wellRectArmed = false;
  }
}

export function svgPt(e) {
  const r = wrapRect();
  return { x: (e.clientX - r.left - App.cam.x) / App.cam.z, y: (e.clientY - r.top - App.cam.y) / App.cam.z };
}
// ── How far out the camera may go ──
// The floor on zoom is a property of the *diagram*, not a constant. 20% is
// generous for a ten-state machine and a wall for a thousand-state one, whose
// whole-machine view wants 6% — clamped up to 20%, fit-to-screen could not
// frame the machine it was pointed at and the only way around the diagram was
// to pan it by hand. So the floor is the configured minimum *or* the zoom that
// frames the whole drawing with room to spare, whichever is lower.
//
// A wheel gesture asks sixty times a second, so the answer is memoised for the
// length of one. Nothing announces that a state moved, and during a zoom
// nothing is moving; the short life is what keeps a state dragged out to the
// edge from leaving a stale wall behind it.
export const ZOOM_HARD_FLOOR = 0.01;   // below this a state is a sub-pixel dot
const ZOOM_OUT_HEADROOM = 0.6;         // how far past a snug fit the camera may go
const MIN_ZOOM_TTL = 400;
let _minZoomCache = null;

export function minZoom() {
  const base = App.config?.zoom?.min ?? 0.2;
  // Keyed on what is *drawn*, because that is what the floor is computed from.
  // Against App.states the cache went stale in exactly the case that matters:
  // drilling into a block changes the whole diagram without changing that array
  // at all, so a machine-sized floor was still being handed out for a view of
  // four states — and the reader could not zoom out to see them.
  const drawn = viewStates();
  if (!drawn.length) return base;
  const now = Date.now();
  const c = _minZoomCache;
  if (c && c.states === drawn && c.n === drawn.length && now - c.t < MIN_ZOOM_TTL) return c.z;
  // The state circles rather than getContentBounds: a floor does not need to
  // know where a pushed-out label landed, and that call runs the whole layout
  // pass — which a wheel gesture must not do. The headroom below covers the
  // difference many times over.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pad = (App.config.radius || 26) + 40;
  drawn.forEach(st => {
    // A block is a box, so its own extent is what has to fit, not a point.
    const hw = st.box ? st.box.w / 2 : 0;
    const hh = st.box ? st.box.h / 2 : 0;
    if (st.x - hw < minX) minX = st.x - hw;
    if (st.y - hh < minY) minY = st.y - hh;
    if (st.x + hw > maxX) maxX = st.x + hw;
    if (st.y + hh > maxY) maxY = st.y + hh;
  });
  let z = base;
  if (Number.isFinite(minX)) {
    const vis = typeof visibleCanvasBox === 'function' ? visibleCanvasBox() : null;
    const cw = Math.max(1, (vis?.w || wrap.clientWidth || 800) - 180);
    const ch = Math.max(1, (vis?.h || wrap.clientHeight || 600) - 180);
    const fit = Math.min(cw / Math.max(1, maxX - minX + pad * 2),
      ch / Math.max(1, maxY - minY + pad * 2));
    z = Math.max(ZOOM_HARD_FLOOR, Math.min(base, fit * ZOOM_OUT_HEADROOM));
  }
  _minZoomCache = { states: drawn, n: drawn.length, t: now, z };
  return z;
}

export function clampZoom(z) {
  return Math.max(minZoom(), Math.min(App.config.zoom.max, z));
}

export let _pendingFrame = false;
// The minimap used to be skipped during pans "for speed", which froze the one
// thing a pan is supposed to move. It coalesces its own paints now (see
// js/minimap.js), so the camera can just say it moved and let it decide.
export function applyCamera() {
  scheduleMinimap();
  // On a machine large enough to be windowed, the camera decides what exists.
  // It is a no-op — one rect comparison — until the screen has actually left
  // the drawn window, so an ordinary pan still costs a transform and nothing
  // else. See js/viewport.js.
  repaintForCamera();
  if (_pendingFrame) return;
  _pendingFrame = true;
  requestAnimationFrame(() => {
    $('cam-g').setAttribute('transform', `translate(${App.cam.x},${App.cam.y}) scale(${App.cam.z})`);

    // Update CSS variables for infinite grid
    const wrap = $('canvas-wrap');
    if (wrap) {
      wrap.style.setProperty('--cam-x', `${App.cam.x}px`);
      wrap.style.setProperty('--cam-y', `${App.cam.y}px`);
      wrap.style.setProperty('--cam-z', App.cam.z);
      // Zoomed far enough out that the diagram is a map rather than a drawing.
      // The simulation highlights read that flag and get bolder, because at 8%
      // the thing worth seeing is which way the run went, not what any one edge
      // is labelled. Same threshold the label LOD uses, so "the names dropped
      // out" and "the trail thickened" happen at one place on the zoom dial.
      if (wrap.classList) wrap.classList.toggle('zoom-far', App.cam.z < LOD_LABEL_ZOOM);
    }

    const zInput = $('zoom-ind');
    if (zInput && document.activeElement !== zInput) {
      zInput.value = Math.round(App.cam.z * 100) + '%';
    }
    _pendingFrame = false;
  });
}

// ── Wheel handling: normalized deltas + proportional zoom ──
// deltaMode 1 = "line" units (common on Linux/Firefox with a physical mouse),
// deltaMode 2 = "page" units. Both must be converted to pixels or the camera
// barely moves on some platforms and races on others.
export const WHEEL_LINE_PX = 40;
export function normalizeWheelDeltas(e) {
  let dx = e.deltaX, dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= WHEEL_LINE_PX; dy *= WHEEL_LINE_PX; }
  else if (e.deltaMode === 2) { dx *= wrap.clientWidth; dy *= wrap.clientHeight; }
  return { dx, dy };
}

export function wheelZoomAt(clientX, clientY, dy) {
  const r = wrapRect();
  const mx = clientX - r.left, my = clientY - r.top;
  const sensitivity = (App.config.zoom.step || 0.1) * 0.01;
  const factor = Math.exp(-dy * sensitivity);
  const newZ = clampZoom(App.cam.z * factor);
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
}

export let _wheelIdleTimer = null;
wrap.addEventListener('wheel', e => {
  // A floating panel section is a window over the canvas, and a window scrolls
  // its own content — the canvas must not zoom out from under a list the
  // reader is scrolling. Every other canvas gesture already excludes the
  // overlays that sit on it; the wheel had no such list because until now
  // nothing on the canvas scrolled. The breadcrumb is the second thing that
  // does: without this it never got a chance to scroll itself, since the
  // camera zoomed on every tick first and called preventDefault before the
  // bar's own wheel handler ran.
  if (e.target.closest && e.target.closest('.panel-float, .scope-bar')) return;
  e.preventDefault();
  const { dx, dy } = normalizeWheelDeltas(e);
  const zoomGesture = e.ctrlKey || e.metaKey || (App.config.wheelZoom && !e.shiftKey);

  if (zoomGesture) {
    wheelZoomAt(e.clientX, e.clientY, dy);
  } else if (e.shiftKey) {
    // Shift always forces horizontal pan, in either wheel mode.
    const amt = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    App.cam.x -= amt;
  } else {
    App.cam.x -= dx;
    App.cam.y -= dy;
  }
  applyCamera();
  clearTimeout(_wheelIdleTimer);
  // Marked once the gesture settles rather than per wheel tick, so a single
  // scroll doesn't trigger a burst of tab re-renders. The minimap is not marked
  // here — applyCamera above already told it, on every tick.
  _wheelIdleTimer = setTimeout(() => {
    if (typeof markViewDirty === 'function') markViewDirty();
  }, 150);
}, { passive: false });

// ══════════════════════════════════════════════════════════════════
//  POINTER INTERACTIONS (pan / marquee / drag / curve-drag)
// ══════════════════════════════════════════════════════════════════
export let lastPointerClient = null;
export let _rightDownPt = null;
export let _rightDragged = false;

wrap.addEventListener('pointerdown', e => {
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, #status-bar, .panel-float, .scope-bar')) return;
  if (e.pointerType) wrap.dataset.lastPointerType = e.pointerType;

  if (e.button === 2) {
    // States/edges/notes own their right-click: they already stop propagation
    // on their native `contextmenu` listener, so leave their pointerdown alone.
    if (e.target.closest('.sn, .edge-g, .note-g, .divider-g')) return;
    _rightDownPt = { x: e.clientX, y: e.clientY };
    _rightDragged = false;
    return;
  }

  if (e.button === 1 || (e.button === 0 && (e.altKey || App.spacePan))) {
    startPan(e);
    return;
  }
  if (e.button !== 0) return;

  const onSVGBg = e.target === wrap || e.target.id === 'svgCanvas' || e.target === $('cam-g');
  const onTransition = !!e.target.closest('#trans-g');
  const onBackground = onSVGBg || onTransition;
  if (!onBackground) return;
  // A press on empty canvas drops the selection — every kind of it — with two
  // exceptions: a modified press, which is the start of an additive marquee,
  // and the transition tool, whose half-drawn edge marks its source state with
  // the very same class the selection uses.
  const additive = App.tool === 'pointer' && (e.shiftKey || e.ctrlKey || e.metaKey);
  if (!additive && App.tool !== 'trans') clearSelection();

  if (typeof dividerToolKind === 'function' && dividerToolKind()) {
    beginDividerDraw(e);
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  } else if (App.tool === 'pointer') {
    // On touch, an empty-canvas drag is navigation. Marquee selection remains
    // available to mouse/pen users and can be exposed as a later mobile tool.
    if (e.pointerType === 'touch') {
      startPan(e);
      return;
    }
    // A marquee is a multi-select gesture whether or not a modifier is held:
    // an unmodified one started by clearing above, a modified one adds to what
    // is already selected.
    if (e.shiftKey || e.ctrlKey || e.metaKey) clearEdgeDirectionHighlight();
    else emit(Change.CANVAS);
    const pt = svgPt(e);
    App.marquee = { start: pt, current: pt };
    App.marqueeRect = makeSVG('rect');
    App.marqueeRect.setAttribute('class', 'marquee-rect');
    $('cam-g').appendChild(App.marqueeRect);
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  } else if (App.tool === 'state') {
    const pt = svgPt(e); createState(pt.x, pt.y);
  } else if (App.tool === 'trans') {
    App.transFrom = null; clearTempLine();
  } else if (App.tool === 'move') {
    startPan(e);
  }
});

export function startPan(e) {
  isPanning = true; panStart = { x: e.clientX, y: e.clientY }; camStart = { x: App.cam.x, y: App.cam.y };
  panPointerId = e.pointerId;
  wrap.classList.add('panning');
  try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
  e.preventDefault();
}

// Right-click-drag pans the canvas; a right click with no movement opens
// the background context menu instead (see contextmenu listener below).
wrap.addEventListener('pointermove', e => {
  App._lastCanvasWorldPt = svgPt(e);
  if (_rightDownPt && !isPanning) {
    const d = Math.hypot(e.clientX - _rightDownPt.x, e.clientY - _rightDownPt.y);
    if (d > 4) {
      _rightDragged = true;
      startPan(e);
    }
  }
});

// ── Auto-pan when dragging a state / marquee near the viewport edge ──
export const AUTO_PAN_MARGIN = 42;
export const AUTO_PAN_MAX_SPEED = 16;
export let autoPanRAF = null;

export function computeAutoPanVector(clientX, clientY, rect) {
  let vx = 0, vy = 0;
  const left = clientX - rect.left, right = rect.right - clientX;
  const top = clientY - rect.top, bottom = rect.bottom - clientY;
  if (left >= 0 && left < AUTO_PAN_MARGIN) vx = (AUTO_PAN_MARGIN - left) / AUTO_PAN_MARGIN;
  else if (right >= 0 && right < AUTO_PAN_MARGIN) vx = -(AUTO_PAN_MARGIN - right) / AUTO_PAN_MARGIN;
  if (top >= 0 && top < AUTO_PAN_MARGIN) vy = (AUTO_PAN_MARGIN - top) / AUTO_PAN_MARGIN;
  else if (bottom >= 0 && bottom < AUTO_PAN_MARGIN) vy = -(AUTO_PAN_MARGIN - bottom) / AUTO_PAN_MARGIN;
  return { x: vx * AUTO_PAN_MAX_SPEED, y: vy * AUTO_PAN_MAX_SPEED };
}

export function stopAutoPan() {
  if (autoPanRAF) { cancelAnimationFrame(autoPanRAF); autoPanRAF = null; }
}

export function startAutoPanLoop() {
  if (autoPanRAF) return;
  const step = () => {
    if (!(App.dragOffsets || App.marquee || App.dividerDraft || App.dragDividerEndpoint) || !lastPointerClient) { autoPanRAF = null; return; }
    const rect = wrapRect();
    const vec = computeAutoPanVector(lastPointerClient.clientX, lastPointerClient.clientY, rect);
    if (vec.x || vec.y) {
      App.cam.x += vec.x; App.cam.y += vec.y;
      applyCamera();
      handlePointerMove(lastPointerClient);
      autoPanRAF = requestAnimationFrame(step);
    } else {
      autoPanRAF = null;
    }
  };
  autoPanRAF = requestAnimationFrame(step);
}

// ── Snap-to-grid + alignment guides ──
export function isSnapActive(shiftKey) {
  return App.config.snapToGrid ? !shiftKey : !!shiftKey;
}

export function clearAlignGuides() {
  const g = $('align-guides-g');
  if (g) g.innerHTML = '';
}

export function drawAlignGuides(x, y) {
  const g = $('align-guides-g');
  if (!g) return;
  g.innerHTML = '';
  const SPAN = 100000;
  if (x !== null) {
    const line = makeSVG('line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', -SPAN); line.setAttribute('y2', SPAN);
    line.classList.add('align-guide');
    g.appendChild(line);
  }
  if (y !== null) {
    const line = makeSVG('line');
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('x1', -SPAN); line.setAttribute('x2', SPAN);
    line.classList.add('align-guide');
    g.appendChild(line);
  }
}

export function toggleSnapToGrid(force) {
  App.config.snapToGrid = force !== undefined ? !!force : !App.config.snapToGrid;
  const btn = $('snap-toggle-btn');
  if (btn) btn.classList.toggle('active', App.config.snapToGrid);
  try { localStorage.setItem('automata-snap-grid', App.config.snapToGrid ? '1' : '0'); } catch (e) { }
  showStatus(App.config.snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off');
}

export let _activeMoveFrame = false;
export let _pendingMoveEvent = null;

export function queueMouseMove(e) {
  if (App.toolbarDragging) return;
  _pendingMoveEvent = {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey
  };
  if (_activeMoveFrame) return;
  _activeMoveFrame = true;
  requestAnimationFrame(() => {
    const nextMove = _pendingMoveEvent;
    _pendingMoveEvent = null;
    if (nextMove) handlePointerMove(nextMove);
    _activeMoveFrame = false;
    if (_pendingMoveEvent) queueMouseMove(_pendingMoveEvent);
  });
}

document.addEventListener('pointermove', queueMouseMove);

export function handlePointerMove(e) {
  if (App.toolbarDragging) return;
  lastPointerClient = e;
  // Before the pan test: a port drag takes the pointer capture, and a captured
  // pointer still delivers moves here.
  if (App.dragPort) { dragPortTo(svgPt(e)); return; }
  if (isPanning) {
    App.cam.x = camStart.x + (e.clientX - panStart.x);
    App.cam.y = camStart.y + (e.clientY - panStart.y);
    applyCamera();
    return;
  }
  if (App.marquee) {
    App.marquee.current = svgPt(e);
    const mx = Math.min(App.marquee.start.x, App.marquee.current.x);
    const my = Math.min(App.marquee.start.y, App.marquee.current.y);
    const mw = Math.abs(App.marquee.start.x - App.marquee.current.x);
    const mh = Math.abs(App.marquee.start.y - App.marquee.current.y);
    App.marqueeRect.setAttribute('x', mx); App.marqueeRect.setAttribute('y', my);
    App.marqueeRect.setAttribute('width', mw); App.marqueeRect.setAttribute('height', mh);
    // The drawn graph: a marquee selects the boxes and circles on screen, which
    // inside a block are its members and not the whole machine. Ports are
    // derived rather than owned, so there is nothing there to select.
    viewStates().forEach(s => {
      if (isPortNode(s)) return;
      if (s.x >= mx && s.x <= mx + mw && s.y >= my && s.y <= my + mh) {
        if (!App.selectedStates.has(s.id)) { App.selectedStates.add(s.id); hlState(s.id, true); }
      }
    });
    // Select transitions whose midpoints are in the marquee.
    // The drawn edges, not the model's: on App.transitions this swept edges from
    // every other scope in the machine — their endpoints have coordinates
    // wherever they were left — and could not select a crossing edge at all,
    // since getState() answers null for a block id.
    viewTransitions().forEach(t => {
      if (t.port) return;
      const from = getNode(t.from), to = getNode(t.to);
      if (!from || !to) return;
      // Approximate center including potential curve
      const midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
      if (midX >= mx && midX <= mx + mw && midY >= my && midY <= my + mh) {
        if (!App.selectedTransitions.has(t.id)) {
          App.selectedTransitions.add(t.id);
          const el = App.domCache.transitions.get(t.from + '|' + t.to);
          if (el) el.classList.add('sel-t');
        }
      }
    });
    App.notes.forEach(n => {
      const pos = resolveNotePos(n);
      if (pos.x >= mx && pos.x <= mx + mw && pos.y >= my && pos.y <= my + mh) App.selectedNotes.add(n.id);
    });
    App.dividers.forEach(d => {
      const mid = dividerMid(d);
      if (mid.x >= mx && mid.x <= mx + mw && mid.y >= my && mid.y <= my + mh) App.selectedDividers.add(d.id);
    });
    syncNoteSelectionClasses();
    syncDividerSelectionClasses();
    checkAutoPan(e);
    return;
  }
  if (App.dragOffsets) {
    const pt = svgPt(e);
    // First movement of a drag: capture the pre-drag positions so undo returns
    // the states to where they were when the press started.
    if (App.dragPendingSnapshot) {
      App.dragPendingSnapshot = false;
      snapshot();
    }
    const snap = isSnapActive(e.shiftKey);
    const gSnapAmount = App.config.gridSnap || 20;
    App.selectedStates.forEach(sid => {
      // A block's box moves the same way a state's circle does, so the drag
      // asks the projection rather than the model — getState answers null for
      // a block id, which used to be a selection that could not be dragged.
      const s = getNode(sid);
      if (s && App.dragOffsets[sid]) {
        let nx = pt.x - App.dragOffsets[sid].x;
        let ny = pt.y - App.dragOffsets[sid].y;
        if (snap) { nx = Math.round(nx / gSnapAmount) * gSnapAmount; ny = Math.round(ny / gSnapAmount) * gSnapAmount; }
        s.x = nx; s.y = ny;
      }
    });
    // Alignment guides only make sense while dragging a single state.
    if (!snap && App.selectedStates.size === 1) {
      const sid = [...App.selectedStates][0];
      const s = getNode(sid);
      if (s) {
        const TOL = 6 / App.cam.z;
        let bestX = null, bestY = null;
        viewStates().forEach(o => {
          if (o.id === sid) return;
          if (bestX === null && Math.abs(o.x - s.x) < TOL) bestX = o.x;
          if (bestY === null && Math.abs(o.y - s.y) < TOL) bestY = o.y;
        });
        if (bestX !== null) s.x = bestX;
        if (bestY !== null) s.y = bestY;
        drawAlignGuides(bestX, bestY);
      }
    } else {
      clearAlignGuides();
    }
    dragSelectedNotesTo(pt);
    dragSelectedDividersTo(pt);
    if (typeof scheduleFastDOM === 'function') scheduleFastDOM(); else renderAll();
    checkAutoPan(e);
    return;
  }
  if (App.dividerDraft) {
    updateDividerDraw(e);
    checkAutoPan(e);
    return;
  }
  if (App.dragDividerEndpoint) {
    dragDividerEndpointTo(e);
    checkAutoPan(e);
    return;
  }
  if (App.resizeNoteId) {
    if (typeof resizeNoteTo === 'function') resizeNoteTo(e);
    return;
  }
  if (App.dragCurve) {
    const pt = svgPt(e);
    const { from, to, grp } = App.dragCurve;
    // A self-loop has no chord to bend, so the same grip means "swing the loop
    // round the state" instead — the manual override for a direction the
    // automatic placement got wrong. Anything but the exact centre gives an
    // angle, and the centre itself is simply ignored.
    if (from.id === to.id) {
      const dx = pt.x - from.x, dy = pt.y - from.y;
      if (dx || dy) {
        const angle = Math.atan2(dy, dx);
        grp.ts.forEach(t => t.loopAngle = angle);
        if (typeof scheduleFastDOM === 'function') scheduleFastDOM(); else renderAll();
      }
      return;
    }
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const px = -dy / dist, py = dx / dist; // Normal vector
      const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2;
      const proj = (pt.x - cx) * px + (pt.y - cy) * py;
      grp.ts.forEach(t => t.curve = proj);
      if (typeof scheduleFastDOM === 'function') scheduleFastDOM(); else renderAll();
    }
    return;
  }
  if (App.transFrom && App.tool === 'trans') {
    const src = getState(App.transFrom), pt = svgPt(e);
    if (src) drawTempLine(src.x, src.y, pt.x, pt.y);
  }
}

export function checkAutoPan(e) {
  const rect = wrapRect();
  const vec = computeAutoPanVector(e.clientX, e.clientY, rect);
  if (vec.x || vec.y) startAutoPanLoop(); else stopAutoPan();
}

export function endPointerInteractions() {
  if (App.toolbarDragging) return;
  if (_pendingMoveEvent) {
    const nextMove = _pendingMoveEvent;
    _pendingMoveEvent = null;
    handlePointerMove(nextMove);
  }
  stopAutoPan();
  if (isPanning) {
    isPanning = false; wrap.classList.remove('panning');
    if (panPointerId !== null) { try { wrap.releasePointerCapture(panPointerId); } catch (e) { } }
    panPointerId = null;
    scheduleMinimap();
    if (typeof markViewDirty === 'function') markViewDirty();
    return;
  }
  if (App.dragPort) {
    const moved = App.dragPort.moved;
    App.dragPort = null;
    // Only a drag that actually moved is an edit. A press that stayed put left
    // no snapshot and changed no offset, so there is nothing to announce — and
    // announcing anyway would dirty the workspace for a click that is on its way
    // to being "go back out".
    if (moved) { emit(Change.GRAPH); scheduleMinimap(); }
    return;
  }
  if (App.marquee) {
    App.marqueeRect.remove(); App.marqueeRect = null; App.marquee = null; scheduleMinimap();
  }
  if (App.dragOffsets || App.dragCurve) {
    // A press that never moved is a selection, not a drag: dragPendingSnapshot
    // is still set, nothing has been repositioned, and nudging states apart here
    // would move the diagram in response to a plain click.
    const moved = App.dragOffsets && !App.dragPendingSnapshot ? Object.keys(App.dragOffsets) : null;
    App.dragOffsets = null;
    App.dragCurve = null;
    endSelectionDrag();
    App.dragPendingSnapshot = false;
    clearAlignGuides();
    // Overlaps are settled on release rather than during the drag, so the node
    // tracks the pointer exactly while it is held. The undo point was taken when
    // the drag started, so the nudge is part of that same step.
    if (moved && moved.length && App.config.render.avoidNodeOverlap !== false
      && resolveNodeOverlaps(viewStates(), { movable: moved })) {
      emit(Change.GRAPH);
    }
    scheduleMinimap();
  }
  if (App.dividerDraft) {
    finishDividerDraw();
    scheduleMinimap();
  }
  if (App.dragDividerEndpoint) {
    endDividerEndpointDrag();
    scheduleMinimap();
  }
  if (App.resizeNoteId) {
    if (typeof endNoteResize === 'function') endNoteResize();
    scheduleMinimap();
  }
}

export function resetRightClickState() {
  _rightDownPt = null;
  _rightDragged = false;
}

document.addEventListener('pointerup', e => {
  if (e.button === 2) {
    // On this platform `contextmenu` fires on press, before a drag can be
    // detected — so it's suppressed unconditionally (see the listener
    // below) and the menu is shown here instead, once we actually know
    // whether the gesture turned into a pan or stayed a plain click.
    if (_rightDownPt && !_rightDragged) {
      App.ctxCanvasPt = svgPt(e);
      showCanvasContextMenu(e.clientX, e.clientY);
    }
    resetRightClickState();
  }
  endPointerInteractions();
});
document.addEventListener('pointercancel', e => {
  if (e.button === 2) resetRightClickState();
  endPointerInteractions();
});
document.addEventListener('click', () => hideContextMenu());

window.addEventListener('blur', () => {
  isPanning = false;
  wrap.classList.remove('panning');
  stopAutoPan();
  resetRightClickState();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPanning = false;
    wrap.classList.remove('panning');
    stopAutoPan();
    resetRightClickState();
  }
});

// ── Empty-canvas context menu (right-click on background) ──
// The native menu is always suppressed here (see the pointerup handler for
// why); state/edge targets never reach this listener since their own
// contextmenu handlers already stopPropagation.
wrap.addEventListener('contextmenu', e => {
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, #status-bar, .panel-float, .scope-bar')) return;
  const onSVGBg = e.target === wrap || e.target.id === 'svgCanvas' || e.target === $('cam-g');
  if (!onSVGBg) return;
  e.preventDefault();
});

export function showCanvasContextMenu(x, y) {
  const m = $('canvas-ctx');
  if (!m) return;
  hideContextMenu();
  m.style.display = 'block';
  const pasteItem = $('canvas-ctx-paste');
  if (pasteItem) pasteItem.classList.toggle('disabled', !App.clipboard || !App.clipboard.states.length);
  const w = 190, h = m.offsetHeight || 170;
  m.style.left = Math.max(8, Math.min(x, innerWidth - w)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - h)) + 'px';
}
export function hideCanvasContextMenu() {
  const m = $('canvas-ctx');
  if (m) m.style.display = 'none';
}
document.addEventListener('click', () => hideCanvasContextMenu());

export function ctxCanvasAddState() {
  hideCanvasContextMenu();
  const pt = App.ctxCanvasPt || { x: 0, y: 0 };
  createState(pt.x, pt.y);
}
export function ctxCanvasPaste() {
  hideCanvasContextMenu();
  pasteClipboard(App.ctxCanvasPt);
}
export function ctxCanvasSelectAll() {
  hideCanvasContextMenu();
  selectAllStates();
}
export function ctxCanvasFit() {
  hideCanvasContextMenu();
  fitToScreen();
}
export function ctxCanvasAutoLayout() {
  hideCanvasContextMenu();
  autoLayout();
}

// ── There is deliberately no "double-click the canvas to create a state" ──
// It was removed rather than narrowed, and the reason is worth keeping: the
// canvas captures the pointer on every press of a node (`onStateDown` ends in
// `wrap.setPointerCapture`), and a captured pointer retargets the compatibility
// mouse events to the capturing element — so this handler's own "is the target
// the empty background?" test answered *yes* for a double-click on a block, and
// created a state on top of the block the reader was trying to open. The test
// could not be fixed from inside it, because by then the real target is gone.
//
// Nothing is lost: the State tool, the toolbox, the mobile bar's State cell and
// the wizard all create states, and each of them says so. Blocks are opened by
// two presses handled in js/render.js, where the node itself sees them.

/**
 * Press on a port tab.
 *
 * A port is not selectable — there is nothing in the model to select, and a
 * Delete over one would have nothing to delete — so this is its own small drag
 * rather than a call into `beginSelectionDrag`. What it writes is an offset from
 * the port's anchor state onto the block record, which is what `placePorts`
 * reads back and stands down for.
 *
 * The offset is stored rather than the position: a port belongs to the state it
 * is attached to, so moving that state has to carry its tab along. Storing an
 * absolute point would leave the tab behind the first time its anchor moved.
 */
export function onPortDown(e, id) {
  if (App.spacePan) return;
  if (e.button !== 0) return;
  e.stopPropagation();
  const node = getNode(id);
  if (!node || !isPortNode(node)) return;
  const anchor = getState(node.anchor);
  if (!anchor) return;
  const pt = svgPt(e);
  App.dragPort = {
    id,
    block: scopeId(),
    // Where in the tab the reader took hold, so it does not jump under the hand.
    grabX: pt.x - node.x,
    grabY: pt.y - node.y,
    moved: false
  };
  try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
}

/** Drive a port drag from a move event. Returns true when it handled one. */
function dragPortTo(pt) {
  const d = App.dragPort;
  if (!d) return false;
  const node = getNode(d.id);
  const anchor = node && getState(node.anchor);
  if (!node || !anchor) return true;
  // The undo point is taken on the first real movement, not on the press — the
  // rule js/canvas.js already follows for states, notes and dividers, so a press
  // that never travels is a click rather than a no-op edit on the stack.
  if (!d.moved) {
    d.moved = true;
    snapshot();
    const el = document.querySelector(`[data-id="${d.id}"]`);
    if (el) el.__dragged = true;
  }
  const x = pt.x - d.grabX, y = pt.y - d.grabY;
  setPortOffset(d.block, d.id, x - anchor.x, y - anchor.y);
  invalidateViewGraph();
  updateFastDOM();
  return true;
}

/**
 * Write a port's hand-set offset onto the block record.
 *
 * On the record because a port reaches no serializer of its own and a block
 * does — `roundForSave` copies a block whole, so this rides along the way
 * `blockId` does on a state, through the save file, the share link, the undo
 * stack and a tab switch alike.
 */
export function setPortOffset(blockId, portId, dx, dy) {
  const b = getBlock(blockId);
  if (!b) return;
  if (!b.ports) b.ports = {};
  b.ports[portId] = { dx, dy };
}

/** Forget a port's hand-set offset, handing it back to the placement pass. */
export function clearPortOffset(blockId, portId) {
  const b = getBlock(blockId);
  if (!b || !b.ports) return;
  delete b.ports[portId];
}

/**
 * Hand one port back to the placement pass — the "Reset Shape" a bent edge
 * gets. One commit, so a single Ctrl+Z puts the reader's placement back.
 */
export function resetPortPlacement(id) {
  const block = scopeId();
  const b = getBlock(block);
  if (!b || !b.ports || !b.ports[id]) return;
  snapshot();
  clearPortOffset(block, id);
  invalidateViewGraph();
  emit(Change.GRAPH);
}

export function onStateDown(e, id) {
  if (App.spacePan) return;
  e.stopPropagation();
  if (e.button === 2) return;
  if (e.button !== 0) return;
  if (App.tool === 'del') { deleteState(id); return; }

  const el = document.querySelector(`[data-id="${id}"]`);
  if (el && el.parentNode) el.parentNode.appendChild(el);

  if (App.tool === 'trans') {
    if (!App.transFrom) { App.transFrom = id; hlState(id, true); showStatus('Now click target state'); }
    else { const f = App.transFrom; App.transFrom = null; hlState(f, false); clearTempLine(); openTransModal(f, id); }
    return;
  }
  if (App.tool === 'move' || App.tool === 'pointer') {
    if (App.tool === 'pointer') {
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      const wasSelected = App.selectedStates.has(id);
      if (!pickObject(App.selectedStates, id, multi)) return;   // ctrl-click deselected it
      if (multi) {
        clearEdgeDirectionHighlight();
      } else if (!wasSelected) {
        if (App.config.clickHighlightMode === 'outgoing' || App.config.clickHighlightMode === 'incoming') {
          highlightEdgesForState(id, App.config.clickHighlightMode);
        } else {
          clearEdgeDirectionHighlight();
        }
      }
    } else {
      clearSelection();
      App.selectedStates.add(id);
      if (el) el.classList.add('sel-st');
    }

    // The undo entry is deliberately NOT taken here. A press that never turns
    // into a drag is just a selection, and snapshotting on press marked the
    // workspace dirty (and pushed a no-op undo step) for every plain click.
    // handlePointerMove takes it on the first real movement instead.
    beginSelectionDrag(svgPt(e));
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
  }
}

export let tempLine = null;
export function drawTempLine(x1, y1, x2, y2) {
  if (!tempLine) {
    tempLine = makeSVG('line');
    tempLine.classList.add('editor-layer');
    tempLine.setAttribute('stroke', 'var(--accent)');
    tempLine.setAttribute('stroke-width', '1.5');
    tempLine.setAttribute('stroke-dasharray', '6,3');
    tempLine.setAttribute('opacity', '0.6');
    $('trans-g').appendChild(tempLine);
  }
  ['x1', 'y1', 'x2', 'y2'].forEach((a, i) => tempLine.setAttribute(a, [x1, y1, x2, y2][i]));
}
export function clearTempLine() { if (tempLine) { tempLine.remove(); tempLine = null; } }
// The renderer's node registry first: after a select-all this is called once per
// state, and a document-wide selector match per call is a thousand scans of the
// canvas to find a node the renderer is already holding by id.
export function hlState(id, on) {
  const el = App.domCache.states.get(id) || document.querySelector(`[data-id="${id}"]`);
  if (el) el.classList.toggle('sel-st', on);
}

// ══════════════════════════════════════════════════════════════════
//  SELECTION — one model for everything on the canvas
// ══════════════════════════════════════════════════════════════════
// States, transitions, notes and dividers/regions are all selectable objects,
// each with its own id set on App. The four sets are always cleared together:
// a note left selected behind an Escape would be picked up by the next Delete,
// which is exactly the kind of surprise a single selection model prevents.
export function clearSelection() {
  App.selectedStates.clear();
  App.selectedTransitions.clear();
  App.selectedNotes.clear();
  App.selectedDividers.clear();
  syncSelectionClasses();
  clearEdgeDirectionHighlight();
  clearActiveNoteHighlight();
}

export function selectionCount() {
  return App.selectedStates.size + App.selectedTransitions.size
    + App.selectedNotes.size + App.selectedDividers.size;
}

// Repaints selection classes from the id sets. States and edges are re-synced
// by their own renderers, but the handlers below also toggle classes directly
// without a render, so clearing has to reach the nodes the same way.
export function syncSelectionClasses() {
  // Cleared through the renderer's registries rather than a selector match:
  // every state and edge node on the canvas is in one of the two, so this is a
  // walk over what is drawn instead of a query over the whole document — and on
  // a windowed canvas what is drawn is a few hundred nodes, not fifteen
  // thousand. A node the renderer has evicted is out of the document with its
  // classes, and comes back clean.
  for (const [, n] of App.domCache.states) n.classList.remove('sel-st');
  for (const [, n] of App.domCache.transitions) n.classList.remove('sel-t');
  App.selectedStates.forEach(id => hlState(id, true));
  // Parallel transitions share one drawn edge, so the keys are collected first:
  // selecting five edges between the same pair must not mean five lookups and
  // five class writes on the same node.
  const keys = new Set();
  App.selectedTransitions.forEach(tid => {
    const t = getTransition(tid);
    if (t) keys.add(t.from + '|' + t.to);
  });
  for (const key of keys) {
    const el = App.domCache.transitions.get(key) || document.querySelector(`[data-edge="${key}"]`);
    if (el) el.classList.add('sel-t');
  }
  syncNoteSelectionClasses();
  syncDividerSelectionClasses();
}

// Click semantics shared by every kind: shift/ctrl toggles membership, a plain
// click on something unselected replaces the whole selection with it, and a
// plain click on something already selected leaves the selection alone so a
// multi-object drag can start from any member of it.
export function pickObject(set, id, multi) {
  if (multi) {
    if (set.has(id)) { set.delete(id); syncSelectionClasses(); return false; }
    set.add(id);
    syncSelectionClasses();
    return true;
  }
  if (!set.has(id)) {
    clearSelection();
    set.add(id);
    syncSelectionClasses();
  }
  return true;
}

// ── Dragging the selection ──
// One gesture moves everything selected, whichever member it started on, so
// the drag offsets for all three movable kinds are captured together.
export function beginSelectionDrag(pt) {
  App.dragOffsets = {};
  App.selectedStates.forEach(sid => {
    const s = getNode(sid);
    if (s) App.dragOffsets[sid] = { x: pt.x - s.x, y: pt.y - s.y };
  });
  App.dragNoteOffsets = {};
  App.selectedNotes.forEach(nid => {
    const note = getNote(nid);
    if (!note) return;
    const pos = resolveNotePos(note);
    App.dragNoteOffsets[nid] = { x: pt.x - pos.x, y: pt.y - pos.y };
  });
  App.dragDividerOffsets = {};
  App.selectedDividers.forEach(did => {
    const d = getDivider(did);
    if (!d) return;
    App.dragDividerOffsets[did] = { x1: d.x1 - pt.x, y1: d.y1 - pt.y, x2: d.x2 - pt.x, y2: d.y2 - pt.y };
  });
  // The undo entry is deliberately NOT taken here — see onStateDown.
  App.dragPendingSnapshot = true;
}

export function endSelectionDrag() {
  App.dragNoteOffsets = null;
  App.dragDividerOffsets = null;
}

// ══════════════════════════════════════════════════════════════════
//  DIRECTIONAL EDGE HIGHLIGHT — optionally triggered by clicking a state
//  (Settings → Rendering picks Outgoing / Incoming / Off), or always
//  available via the state's right-click menu regardless of that setting.
// ══════════════════════════════════════════════════════════════════
// Repaints App.edgeHighlight onto the DOM from scratch. renderAll() calls this
// after every redraw, so the highlight is reconstructed from App state rather
// than living only as classes that the next render would silently wipe.
// What the last call lit, so clearing it is a walk over a handful of elements
// rather than a selector match across the whole canvas. renderAll calls this on
// every repaint, highlight or not, and on a large machine that query was a scan
// of thousands of nodes to find the nothing that was usually there. A node the
// renderer has since evicted is simply a no-op removal.
let litElements = [];

export function applyEdgeDirectionHighlight() {
  for (const el of litElements) {
    el.classList.remove('outgoing-hl', 'incoming-hl', 'outgoing-hl-src', 'incoming-hl-src');
  }
  litElements = [];
  const hl = App.edgeHighlight;
  if (!hl) return;
  const srcCls = hl.direction === 'incoming' ? 'incoming-hl-src' : 'outgoing-hl-src';
  const edgeCls = hl.direction === 'incoming' ? 'incoming-hl' : 'outgoing-hl';
  const srcEl = App.domCache.states.get(hl.id) || document.querySelector(`.sn[data-id="${hl.id}"]`);
  if (srcEl) { srcEl.classList.add(srcCls); litElements.push(srcEl); }
  // Through the projection, because the *drawn* key is what the DOM is registered
  // under: an edge that crosses a block's boundary is drawn as `b1|s1`, a pair
  // the model does not contain, so building the key from the transition's own
  // endpoints looked up a node that is not there and quietly lit nothing.
  viewTransitions().forEach(t => {
    if (t.port) return;
    const matches = hl.direction === 'incoming' ? t.to === hl.id : t.from === hl.id;
    if (!matches) return;
    const key = t.from + '|' + t.to;
    const el = App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
    if (el) { el.classList.add(edgeCls); litElements.push(el); }
  });
}

// The highlight exists to make a cluttered graph readable by isolating one
// state's flow. Lighting up several states at once rebuilds the haystack it
// was meant to cut through, so every multi-select gesture — shift/ctrl-click,
// marquee, select-all, or shifting focus to an edge — drops it entirely
// rather than accumulating.
export function clearEdgeDirectionHighlight() {
  if (!App.edgeHighlight) return;
  App.edgeHighlight = null;
  applyEdgeDirectionHighlight();
}

// direction: 'outgoing' highlights edges leaving stateId, 'incoming' those
// arriving at it. A self-loop matches both, since it's simultaneously the
// state's only outgoing and only incoming edge to itself. Always replaces any
// existing highlight — only one state is ever lit.
export function highlightEdgesForState(stateId, direction) {
  App.edgeHighlight = { id: stateId, direction };
  applyEdgeDirectionHighlight();
}

export function ctxHighlightOutgoing() {
  const id = App.ctxId;
  hideContextMenu();
  if (!id) return;
  highlightEdgesForState(id, 'outgoing');
}
export function ctxHighlightIncoming() {
  const id = App.ctxId;
  hideContextMenu();
  if (!id) return;
  highlightEdgesForState(id, 'incoming');
}
// ══════════════════════════════════════════════════════════════════
//  SELECTION: select-all, nudge, copy / paste / duplicate
// ══════════════════════════════════════════════════════════════════
export function selectAllStates() {
  const drawn = viewStates().filter(s => !isPortNode(s));
  if (!drawn.length && !App.notes.length && !App.dividers.length) return;
  clearEdgeDirectionHighlight();
  // What is on screen, which inside a block is that block's contents. Select-all
  // reaching states the reader cannot see would make the next Delete a surprise.
  App.selectedStates = new Set(drawn.map(s => s.id));
  App.selectedTransitions = new Set(viewTransitions().filter(t => t.id && !t.port).map(t => t.id));
  App.selectedNotes = new Set(App.notes.map(n => n.id));
  App.selectedDividers = new Set(App.dividers.map(d => d.id));
  emit(Change.CANVAS);
  const extra = App.notes.length + App.dividers.length;
  const n = drawn.length;
  showStatus(`Selected ${n} item${n === 1 ? '' : 's'}${extra ? ` and ${extra} annotation${extra === 1 ? '' : 's'}` : ''}`);
}

// Arrow keys move whatever is selected. Transitions have no position of their
// own, so a selection of nothing but edges is not something to nudge — and
// snapshotting for it would spend an undo step on a no-op.
export function nudgeSelected(dx, dy) {
  if (!(App.selectedStates.size || App.selectedNotes.size || App.selectedDividers.size)) return;
  snapshot();
  App.selectedStates.forEach(sid => {
    const s = getNode(sid);
    if (s) { s.x += dx; s.y += dy; }
  });
  App.selectedNotes.forEach(nid => {
    const note = getNote(nid);
    if (note) { note.x += dx; note.y += dy; }
  });
  App.selectedDividers.forEach(did => {
    const d = getDivider(did);
    if (!d) return;
    d.x1 += dx; d.y1 += dy; d.x2 += dx; d.y2 += dy;
    updateOneDividerDOM(d);
  });
  // updateFastDOM carries the states and, with them, the notes.
  if (typeof updateFastDOM === 'function') updateFastDOM(); else renderAll();
  scheduleMinimap();
}

export function copySelection() {
  if (!App.selectedStates.size) { showStatus('No states selected to copy'); return; }
  const ids = new Set(App.selectedStates);
  const states = App.states.filter(s => ids.has(s.id)).map(s => ({ ...s, isDummyStart: false }));
  const transitions = App.transitions.filter(t => ids.has(t.from) && ids.has(t.to)).map(t => ({ ...t }));
  // A selected block is a node the reader clicked, so Ctrl+C has to mean
  // something for it. It used to mean nothing at all: `ids` held `b1`, no state
  // matched, and the clipboard came back empty with "Copied 0 states" — then
  // "Nothing to paste". A block is copied as its *definition*, which is the
  // same thing the library stores, so pasting it goes through the tested
  // inlineBlock path rather than a second copier that could disagree with it.
  const blocks = [...ids]
    .map(id => (getBlock(id) ? outlineBlock(id) : null))
    .filter(Boolean);
  App.clipboard = { states, transitions, blocks };
  const n = states.length + blocks.length;
  showStatus(`Copied ${n} item${n === 1 ? '' : 's'}`);
}

export function duplicateSelection() {
  if (!App.selectedStates.size) { showStatus('No states selected to duplicate'); return; }
  copySelection();
  pasteClipboard(null, 28);
}

/** Everything on the clipboard, of either kind. */
function clipboardCount(c) {
  return (c?.states?.length || 0) + (c?.blocks?.length || 0);
}

export function pasteClipboard(atPoint, fallbackOffset = 32) {
  if (!clipboardCount(App.clipboard)) { showStatus('Nothing to paste'); return; }
  snapshot();
  const idMap = {};
  let offX = fallbackOffset, offY = fallbackOffset;
  if (atPoint) {
    const xs = App.clipboard.states.map(s => s.x), ys = App.clipboard.states.map(s => s.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    offX = atPoint.x - cx; offY = atPoint.y - cy;
  }
  const existingNames = new Set(App.states.map(s => s.name));
  // A paste lands where the reader is standing. `{...s}` carries the source's
  // own `blockId`, so states copied while drilled into a block used to arrive
  // still claiming to belong to it: paste at the top level and they vanished
  // straight back inside the block they were copied from, with nothing on
  // screen to say where they had gone.
  const here = scopeId();
  const newStates = App.clipboard.states.map(s => {
    const id = newId();
    idMap[s.id] = id;
    let name = s.name;
    while (existingNames.has(name)) name = name + '_copy';
    existingNames.add(name);
    const copy = { ...s, id, name, x: s.x + offX, y: s.y + offY };
    if (here) copy.blockId = here; else delete copy.blockId;
    return copy;
  });
  App.states.push(...newStates);
  const newTransitions = App.clipboard.transitions.map(t => ({ ...t, id: newTId(), from: idMap[t.from], to: idMap[t.to] }));
  App.transitions.push(...newTransitions);

  // Blocks are placed through inlineBlock, the same path the library uses, so a
  // pasted block is a real independent copy — fresh ids all the way down — and
  // not a second record pointing at the original's states.
  const newBlocks = [];
  for (const def of App.clipboard.blocks || []) {
    try {
      const placed = inlineBlock(def, { parent: here, x: (def.x || 0) + offX, y: (def.y || 0) + offY });
      if (placed) newBlocks.push(placed.block);
    } catch (e) {
      showStatus(e.message || 'Could not paste that block');
    }
  }
  invalidateViewGraph();

  App.selectedStates = new Set([...newStates.map(s => s.id), ...newBlocks.map(b => b.id)]);
  App.selectedTransitions = new Set(newTransitions.map(t => t.id));
  emit(Change.GRAPH);
  const n = newStates.length + newBlocks.length;
  showStatus(`Pasted ${n} item${n === 1 ? '' : 's'}`);
}

// ══════════════════════════════════════════════════════════════════
//  AUTO LAYOUT — Sugiyama-style layered graph drawing
//
//  1. sugiyamaBuildDAG          — drop self-loops, break cycles (DFS
//                                 back-edge removal); its visit order seeds
//                                 the layers so chains start out adjacent.
//  2. sugiyamaRankByDistance    — BFS depth from the start state; rank =
//                                 column (states flow left → right). Depth
//                                 rather than longest path, so the cyclic
//                                 graphs that automata usually are don't
//                                 flatten into a single row.
//  3. sugiyamaOrderLayers       — barycenter/median heuristic, swept down
//                                 then up a few times, to reduce edge
//                                 crossings between adjacent columns.
//  4. Coordinates are then read straight off (rank, order-in-layer) —
//     no simulation, no animation, one deterministic pass.
// ══════════════════════════════════════════════════════════════════

// Adjacency ignoring self-loops (they don't affect layering) and
// collapsing parallel transitions between the same pair of states.
export function sugiyamaAdjacency(states, transitions) {
  const succ = new Map(states.map(s => [s.id, new Set()]));
  const pred = new Map(states.map(s => [s.id, new Set()]));
  transitions.forEach(t => {
    if (t.from === t.to || !succ.has(t.from) || !pred.has(t.to)) return;
    succ.get(t.from).add(t.to);
    pred.get(t.to).add(t.from);
  });
  return { succ, pred };
}

// DFS from the start state (then any remaining states, for full
// coverage of disconnected components) classifying edges to a node
// still on the recursion stack as back-edges — dropping those breaks
// every cycle while keeping the rest of the graph intact.
export function sugiyamaBuildDAG(states, succ, startId) {
  const dag = new Map(states.map(s => [s.id, new Set()]));
  const visited = new Set(), onStack = new Set();
  const visitOrder = [];

  function dfs(u) {
    visited.add(u); onStack.add(u);
    for (const v of succ.get(u)) {
      if (onStack.has(v)) continue; // back-edge: would reintroduce a cycle
      if (!visited.has(v)) dfs(v);
      dag.get(u).add(v);
    }
    onStack.delete(u);
    visitOrder.push(u);
  }

  const roots = [startId, ...states.map(s => s.id)].filter(id => id && succ.has(id));
  roots.forEach(id => { if (!visited.has(id)) dfs(id); });
  return { dag, visitOrder };
}

// Barycenter heuristic: repeatedly reorder each layer by the average
// position of its neighbors in the layer that was just fixed, sweeping
// downward then upward so information propagates both ways. Nodes
// with no fixed neighbor yet just keep their current slot.
export function sugiyamaOrderLayers(layers, succ, pred, sweeps = 6) {
  const positionOf = layer => new Map(layer.map((id, i) => [id, i]));
  for (let s = 0; s < sweeps; s++) {
    const downward = s % 2 === 0;
    const range = downward
      ? Array.from({ length: layers.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: layers.length - 1 }, (_, i) => layers.length - 2 - i);
    range.forEach(i => {
      const fixedPos = positionOf(layers[downward ? i - 1 : i + 1]);
      const neighborsOf = downward ? pred : succ;
      const scored = layers[i].map((id, idx) => {
        const positions = [...neighborsOf.get(id)].map(n => fixedPos.get(n)).filter(p => p !== undefined);
        const bary = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : idx;
        return { id, bary };
      });
      scored.sort((a, b) => a.bary - b.bary);
      layers[i] = scored.map(x => x.id);
    });
  }
}

// Config can arrive from the settings modal, an imported preferences blob or
// a restored workspace, so neither value is guaranteed sane here. Both
// helpers fall back to the documented defaults rather than propagating NaN
// into every coordinate, which would blank the canvas.
export function layoutNodeRadius() {
  const r = Number(App.config.radius);
  return Number.isFinite(r) && r > 0 ? r : 30;
}

// Minimum gap keeps labels and edge arrowheads legible even if a user asks
// for zero spacing; nodes touching edge-to-edge are unreadable.
export function layoutGap() {
  const g = Number(App.config.layout.nodeSpacing);
  return Number.isFinite(g) ? Math.max(8, g) : 35;
}

// Breadth-first distance from the start state, over the *original* graph
// rather than the cycle-broken DAG.
//
// Longest-path layering is the textbook choice, but it only behaves on
// genuinely acyclic input. Automata are usually strongly connected, and once
// cycle-breaking has reduced such a graph to a spanning chain, longest-path
// gives every state its own rank — an N-column, one-row line (the mod-5
// divisibility DFA degenerates to 5 singleton layers). BFS depth instead
// groups every state reachable in k steps into layer k, which keeps the
// drawing compact and gives the crossing-reduction sweep several nodes per
// layer to actually order.
export function sugiyamaRankByDistance(states, succ, startId) {
  const rank = new Map(states.map(s => [s.id, null]));
  const queue = [];
  // Prefer the real start state; fall back to any state so disconnected or
  // start-less machines still lay out.
  const seed = rank.has(startId) ? startId : (states[0] && states[0].id);
  if (seed === undefined) return new Map();
  rank.set(seed, 0);
  queue.push(seed);
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const v of succ.get(u)) {
      if (rank.get(v) !== null) continue;
      rank.set(v, rank.get(u) + 1);
      queue.push(v);
    }
  }
  // Components unreachable from the seed get their own BFS, starting one
  // rank past the deepest node placed so far so they read as separate blocks
  // instead of overprinting the main component.
  let placedMax = Math.max(0, ...[...rank.values()].filter(r => r !== null));
  states.forEach(s => {
    if (rank.get(s.id) !== null) return;
    const base = placedMax + 1;
    rank.set(s.id, base);
    const sub = [s.id];
    for (let i = 0; i < sub.length; i++) {
      for (const v of succ.get(sub[i])) {
        if (rank.get(v) !== null) continue;
        rank.set(v, rank.get(sub[i]) + 1);
        sub.push(v);
      }
    }
    placedMax = Math.max(placedMax, ...sub.map(id => rank.get(id)));
  });
  return rank;
}

export function sugiyamaLayout(states, transitions, startId) {
  const { succ, pred } = sugiyamaAdjacency(states, transitions);
  // The DAG itself is no longer ranked over, but its DFS visit order still
  // seeds each layer so connected chains start out adjacent.
  const { visitOrder } = sugiyamaBuildDAG(states, succ, startId);
  const rank = sugiyamaRankByDistance(states, succ, startId);

  const maxRank = Math.max(0, ...states.map(s => rank.get(s.id)));
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  // Seed each layer in DFS-visit order so connected chains land near
  // each other before crossing-reduction takes over.
  [...visitOrder].reverse().forEach(id => layers[rank.get(id)].push(id));
  states.forEach(s => { if (!visitOrder.includes(s.id)) layers[rank.get(s.id)].push(s.id); });

  sugiyamaOrderLayers(layers, succ, pred);

  // nodeSpacing is the gap between node *edges*, so every pitch below adds
  // one full node diameter on top of it. Measuring centre-to-centre instead
  // (the old behaviour) let nodes overlap outright: the default spacing of
  // 35 put rows 56px apart while a state circle is 60px across.
  const nodeR = layoutNodeRadius();
  const gap = layoutGap();
  const rowPitch = 2 * nodeR + gap;
  // Columns need room for the node pair plus the transition label riding on
  // the edge between them, hence the wider multiple of the gap. minRadius
  // stays a floor so the existing setting still means something.
  const layerPitch = Math.max(App.config.layout.minRadius || 0, 2 * nodeR + gap * 3.4);
  const byId = new Map(states.map(s => [s.id, s]));
  layers.forEach((layer, r) => {
    const span = (layer.length - 1) * rowPitch;
    layer.forEach((id, i) => {
      const s = byId.get(id);
      s.x = r * layerPitch;
      s.y = i * rowPitch - span / 2;
    });
  });
}

// Original one-shot circular placement — kept as a selectable alternative
// (Settings → Rendering → Auto-Layout Algorithm) for users who prefer an
// evenly-spaced ring over the layered layout.
export function circularLayout(states) {
  const n = states.length;
  // Solve for the radius that leaves the requested gap between neighbours:
  // the chord between adjacent nodes is 2r·sin(π/n), and it has to clear one
  // node diameter plus the gap. Scaling the radius by n alone (the old rule)
  // ignored node size and packed small rings too tightly.
  const need = 2 * layoutNodeRadius() + layoutGap();
  // A lone state belongs at the origin, not pushed out onto a ring.
  const chordR = n > 1 ? need / (2 * Math.sin(Math.PI / n)) : 0;
  const r = n > 1 ? Math.max(App.config.layout.minRadius || 0, chordR) : 0;
  states.forEach((s, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    s.x = r * Math.cos(angle);
    s.y = r * Math.sin(angle);
  });
}

// ══════════════════════════════════════════════════════════════════
//  AUTO LAYOUT
// ══════════════════════════════════════════════════════════════════
export function autoLayout() {
  // Arrange what is *drawn*, not what the machine holds. On App.states a block
  // was invisible to both algorithms — its members were shuffled about inside a
  // box that never moved, so Arrange left every block sitting exactly where it
  // was while the diagram around it was rebuilt. Ports are derived and have no
  // position of their own to arrange.
  const nodes = viewStates().filter(s => !isPortNode(s));
  if (!nodes.length) { showStatus('No states to arrange'); return; }
  snapshot();
  const edges = viewTransitions().filter(t => !t.port);
  if (App.config.layout.algorithm === 'circular') {
    circularLayout(nodes);
  } else {
    sugiyamaLayout(nodes, edges, startNodeId());
  }
  // Every state teleports here, so there is no continuity for an eased edge to
  // preserve — gliding edges over states that have already jumped reads as the
  // drawing coming apart. Settle first so the single paint below lands at target
  // and fitToScreen measures a diagram that is not still moving.
  settleAll();
  renderAll();
  fitToScreen();
}

// ══════════════════════════════════════════════════════════════════
//  IMAGE EXPORT  (PNG / SVG)
// ══════════════════════════════════════════════════════════════════
//  Both formats start from the same prepared SVG: the live canvas,
//  cloned, stripped of interaction state, with every theme variable and
//  CSS rule inlined so the file renders standalone. PNG then rasterises
//  it; SVG just serialises it. Splitting buildExportSVG() out is what
//  makes the second format possible at all — the vector was previously
//  built and thrown away inside the PNG path.

// Bounding box of everything drawn, in world coordinates. Shared with
// fitToScreen so a cropped export frames the machine exactly the way
// "fit to screen" does.
export function getContentBounds(statePad = 0) {
  if (!viewStates().length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0, y0, x1, y1) => {
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
  };
  // The drawn graph, and each node's own extent: a block is a box wider than
  // the caller's uniform pad, and framing on the pad alone would crop it.
  viewStates().forEach(s => {
    const hw = s.box ? s.box.w / 2 : 0;
    const hh = s.box ? s.box.h / 2 : 0;
    minX = Math.min(minX, s.x - Math.max(statePad, hw));
    minY = Math.min(minY, s.y - Math.max(statePad, hh));
    maxX = Math.max(maxX, s.x + Math.max(statePad, hw));
    maxY = Math.max(maxY, s.y + Math.max(statePad, hh));
  });
  // Self-loops stand well clear of their state and a crowded label can be pushed
  // further still, so the states alone no longer bound the drawing — framing on
  // them would crop a loop off the top of an exported diagram.
  if (typeof currentLayoutContext === 'function') {
    try { includeLayoutBounds(currentLayoutContext(), grow); } catch (e) { }
  }
  if (typeof includeNoteBounds === 'function') includeNoteBounds(grow);
  if (typeof includeDividerBounds === 'function') includeDividerBounds(grow);
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.crop]            frame the content instead of the viewport
 * @param {number}  [opts.padding]         margin around cropped content, in px
 * @param {boolean} [opts.includeNotes]    keep sticky notes (default true)
 * @param {boolean} [opts.includeDividers] keep dividers/regions (default true)
 * @param {string}  [opts.background]      'transparent' or a CSS colour
 * @returns {{svg: string, width: number, height: number}}
 */
export async function buildExportSVG(opts = {}) {
  // Three phases around one await, and the shape is forced by two constraints
  // that pull opposite ways.
  //
  // The measuring has to happen inside withFullRender: a cropped export frames
  // the *machine*, its crop box comes from the layout pass, and js/glyphs.js
  // reads each character's position off the live DOM — so on a windowed canvas
  // both would otherwise see only the part that was on screen.
  //
  // But the glyph tables are fetched, and withFullRender restores the windowed
  // render in a `finally`. An async callback would hand it a promise, and the
  // window would be back before the work that needed it had run. So the staging
  // pass measures and plans synchronously, the fetch happens outside it, and
  // what comes back is applied to a clone nothing is measuring any more.
  const staged = withFullRender(() => stageExportSVG(opts));
  const tables = await loadGlyphTables(staged.outline);
  const outlined = applyOutlines(staged.outline, tables, staged.clone);

  // Only what could not be outlined, and only for a raster target. PNG
  // rasterises the string below and throws it away, so an embedded face costs
  // the image nothing; in an .svg file the same bytes would sit there
  // permanently, which is the cost the outlines exist to avoid.
  const fontCss = opts.embedFonts && outlined.left > 0 ? await fontFaceCSS() : '';
  return finishExportSVG(staged, fontCss, opts);
}

// Everything that has to see the whole diagram: the clone, the character
// positions behind the outlines, and the crop box.
function stageExportSVG(opts = {}) {
  const svgEl = $('svgCanvas');
  const wrap = $('canvas-wrap');
  let w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;

  // The clone below captures the *live* DOM, while the crop box further down
  // comes from getContentBounds — which reads the layout pass, i.e. settled
  // targets. Exporting mid-glide would put eased paths inside a frame sized for
  // where they are headed, and crop a loop that has not arrived yet. Settling
  // first makes the two agree; everything from here to serializeToString is
  // synchronous, so nothing can start moving again in between.
  settleAll();
  updateFastDOM({ statesMoved: false });

  const clone = svgEl.cloneNode(true);

  // Before any structural edit, because the plan pairs the live tree's <text>
  // elements with the clone's by index. Removing a node from one and not the
  // other is what would make them disagree; applyOutlines then skips a planned
  // element that the edits below went on to drop.
  const outline = planOutlines(svgEl, clone);

  // Strip transient interaction states (selection highlights, temporary lines)
  clone.querySelectorAll('.sel-st, .sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
  clone.querySelectorAll('.outgoing-hl, .incoming-hl, .outgoing-hl-src, .incoming-hl-src')
    .forEach(n => n.classList.remove('outgoing-hl', 'incoming-hl', 'outgoing-hl-src', 'incoming-hl-src'));
  clone.querySelectorAll('.editor-layer').forEach(n => n.remove());
  const guideLayer = clone.querySelector('#align-guides-g');
  if (guideLayer) guideLayer.innerHTML = '';

  if (opts.includeNotes === false) {
    const g = clone.querySelector('#notes-g');
    if (g) g.innerHTML = '';
  }
  if (opts.includeDividers === false) {
    const g = clone.querySelector('#dividers-g');
    if (g) g.innerHTML = '';
  }

  // Crop: neutralise the camera and let the viewBox do the framing, so the
  // exported file is independent of where the user happened to be panned.
  let viewBox = null;
  if (opts.crop) {
    const b = getContentBounds(App.config.radius + 4);
    if (b) {
      const pad = opts.padding === undefined ? 40 : Math.max(0, opts.padding);
      const camG = clone.querySelector('#cam-g');
      if (camG) camG.setAttribute('transform', 'translate(0,0) scale(1)');
      w = Math.max(1, Math.round(b.width + pad * 2));
      h = Math.max(1, Math.round(b.height + pad * 2));
      viewBox = `${(b.minX - pad).toFixed(2)} ${(b.minY - pad).toFixed(2)} ${w} ${h}`;
    }
  }

  return { clone, outline, w, h, viewBox };
}

// The half that needs nothing but the clone: framing, the inlined stylesheet,
// the painted background, and the serialisation.
function finishExportSVG(staged, fontCss, opts = {}) {
  const { clone, w, h, viewBox } = staged;
  if (viewBox) clone.setAttribute('viewBox', viewBox);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // The <use> references js/glyphs.js emits carry an xlink:href alongside the
  // SVG 2 href, for consumers that only read the older form.
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Maintain theme: Copy the current data-theme attribute (light/dark)
  const currentTheme = document.documentElement.dataset.theme;
  if (currentTheme) clone.setAttribute('data-theme', currentTheme);

  const svgStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');

  // 1. Dynamic Variable Scraping: Capture every live theme variable
  let rootStyles = ":root {";
  const computed = getComputedStyle(document.documentElement);
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (prop.startsWith('--')) {
      rootStyles += `${prop}: ${computed.getPropertyValue(prop)};`;
    }
  }
  rootStyles += "}";

  // 2. Dynamic Rule Scraping: Capture every CSS class and rule from all stylesheets
  let cssRules = "";
  for (let sheet of document.styleSheets) {
    try {
      for (let rule of sheet.cssRules) {
        cssRules += rule.cssText + "\n";
      }
    } catch(e) {} // Skip cross-origin sheets safely
  }

  // 3. Glue it together and ensure hit-areas are hidden in the final export
  //
  // fontCss is empty for an .svg file and for any export whose text was fully
  // outlined. It is the cross-origin @font-face rules the loop above cannot
  // reach, re-fetched and inlined as data URIs — see js/export-fonts.js.
  svgStyle.textContent = `${fontCss}\n${rootStyles}\n${cssRules}\n.tarr-hit { display:none !important; }\n.note-resize-hit, .note-resize-handle { display:none !important; }\n.divider-hit, .divider-endpoint { display:none !important; }\nsvg { background: transparent; }`;
  clone.insertBefore(svgStyle, clone.firstChild);

  // A painted rect rather than a CSS background: canvas rasterisation
  // ignores the latter, so a "white background" PNG would come out clear.
  const bg = opts.background;
  if (bg && bg !== 'transparent') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const vb = clone.getAttribute('viewBox');
    if (vb) {
      const [vx, vy, vw, vh] = vb.split(/[\s,]+/).map(Number);
      rect.setAttribute('x', vx); rect.setAttribute('y', vy);
      rect.setAttribute('width', vw); rect.setAttribute('height', vh);
    } else {
      rect.setAttribute('x', 0); rect.setAttribute('y', 0);
      rect.setAttribute('width', w); rect.setAttribute('height', h);
    }
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, svgStyle.nextSibling);
  }

  return { svg: new XMLSerializer().serializeToString(clone), width: w, height: h };
}

export async function exportSVG(opts = {}) {
  const { svg } = await buildExportSVG(opts);
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
  exportDownload(exportFilename('svg'), header + svg, 'image/svg+xml;charset=utf-8');
  showStatus('Exported as SVG');
  if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
}

export async function exportPNG(opts = {}) {
  const res = opts.scale || App.config.exportRes || 2;
  const embedData = opts.embedData !== false;
  // embedFonts is the backstop for anything js/glyphs.js could not outline.
  // It is free here and only here: the rules live in the string handed to
  // the rasteriser and never reach the .png.
  const { svg: svgStr, width: w, height: h } = await buildExportSVG({ ...opts, embedFonts: true });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * res);
  canvas.height = Math.round(h * res);
  const ctx = canvas.getContext('2d');
  ctx.scale(res, res);

  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      // The workspace JSON rides along after the PNG's own bytes, which is
      // what lets the exported image be dropped back in and edited. Opting
      // out produces a plain picture for anyone who'd rather not ship the
      // full machine definition inside a screenshot.
      const parts = [blob];
      if (embedData) parts.push(`\n--AutomataData--\n${JSON.stringify(getWorkspaceData())}`);
      const finalBlob = new Blob(parts, { type: 'image/png' });
      const a = document.createElement('a');
      const outUrl = URL.createObjectURL(finalBlob);
      a.href = outUrl;
      a.download = exportFilename('png');
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(outUrl); } catch (e) {} }, 1000);
      URL.revokeObjectURL(url);
      showStatus(embedData ? 'Workspace snapshot saved!' : 'Exported as PNG');
      if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
    }, 'image/png');
  };
  img.src = url;
}
