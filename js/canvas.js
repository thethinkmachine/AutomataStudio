// ══════════════════════════════════════════════════════════════════
//  CANVAS / CAMERA (ZOOM & PAN)
// ══════════════════════════════════════════════════════════════════
const wrap = $('canvas-wrap');
let isPanning = false, panStart = { x: 0, y: 0 }, camStart = { x: 0, y: 0 };
let panPointerId = null;

// Touch navigation is deliberately separate from the mouse/pen gesture
// state below. A second finger cancels any in-progress edit gesture and owns
// the camera until the pinch/pan ends, which prevents a node drag from turning
// into a browser page zoom or a half-applied canvas move.
const touchPointers = new Map();
let touchCameraGesture = null;
let touchLongPressTimer = null;
let touchLongPressStart = null;

function clearTouchLongPress() {
  if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
  touchLongPressTimer = null;
  touchLongPressStart = null;
}

function scheduleTouchLongPress(e) {
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

function touchPair() {
  return [...touchPointers.values()].slice(0, 2);
}

function cancelCanvasManipulationForTouch() {
  stopAutoPan();
  isPanning = false;
  panPointerId = null;
  wrap.classList.remove('panning');

  if (App.marqueeRect) App.marqueeRect.remove();
  App.marqueeRect = null;
  App.marquee = null;
  App.dragOffsets = null;
  App.dragCurve = null;
  if (typeof clearAlignGuides === 'function') clearAlignGuides();
}

function beginTouchCameraGesture() {
  const pair = touchPair();
  if (pair.length < 2) return;
  const a = pair[0], b = pair[1];
  const r = wrap.getBoundingClientRect();
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

function updateTouchCameraGesture() {
  if (!touchCameraGesture) return;
  const pair = touchPair();
  if (pair.length < 2) return;
  const a = pair[0], b = pair[1];
  const r = wrap.getBoundingClientRect();
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const cfg = App.config.zoom;
  const newZoom = Math.max(cfg.min, Math.min(cfg.max,
    touchCameraGesture.startZoom * distance / touchCameraGesture.startDistance));
  App.cam.x = center.x - r.left - touchCameraGesture.worldAtCenter.x * newZoom;
  App.cam.y = center.y - r.top - touchCameraGesture.worldAtCenter.y * newZoom;
  App.cam.z = newZoom;
  applyCamera(true);
}

function captureTouchPointerDown(e) {
  if (e.pointerType !== 'touch') return;
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;
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

function captureTouchPointerMove(e) {
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

function captureTouchPointerEnd(e) {
  if (e.pointerType !== 'touch' || !touchPointers.has(e.pointerId)) return;
  clearTouchLongPress();
  touchPointers.delete(e.pointerId);
  if (touchCameraGesture) {
    e.preventDefault();
    e.stopPropagation();
    if (touchPointers.size < 2) touchCameraGesture = null;
  }
}

// Capture sees touches that start on an SVG state or edge before those nodes
// stop propagation, so pinch can reliably take over from any edit gesture.
wrap.addEventListener('pointerdown', captureTouchPointerDown, { capture: true });
wrap.addEventListener('pointermove', captureTouchPointerMove, { capture: true });
wrap.addEventListener('pointerup', captureTouchPointerEnd, { capture: true });
wrap.addEventListener('pointercancel', captureTouchPointerEnd, { capture: true });

function svgPt(e) {
  const r = wrap.getBoundingClientRect();
  return { x: (e.clientX - r.left - App.cam.x) / App.cam.z, y: (e.clientY - r.top - App.cam.y) / App.cam.z };
}
let _pendingFrame = false;
let _pendingMinimapRefresh = false;
function applyCamera(skipMinimap = false) {
  _pendingMinimapRefresh = _pendingMinimapRefresh || !skipMinimap;
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
    }

    const zInput = $('zoom-ind');
    if (zInput && document.activeElement !== zInput) {
      zInput.value = Math.round(App.cam.z * 100) + '%';
    }
    if (_pendingMinimapRefresh) renderMinimap();
    _pendingMinimapRefresh = false;
    _pendingFrame = false;
  });
}

// ── Wheel handling: normalized deltas + proportional zoom ──
// deltaMode 1 = "line" units (common on Linux/Firefox with a physical mouse),
// deltaMode 2 = "page" units. Both must be converted to pixels or the camera
// barely moves on some platforms and races on others.
const WHEEL_LINE_PX = 40;
function normalizeWheelDeltas(e) {
  let dx = e.deltaX, dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= WHEEL_LINE_PX; dy *= WHEEL_LINE_PX; }
  else if (e.deltaMode === 2) { dx *= wrap.clientWidth; dy *= wrap.clientHeight; }
  return { dx, dy };
}

function wheelZoomAt(clientX, clientY, dy) {
  const r = wrap.getBoundingClientRect();
  const mx = clientX - r.left, my = clientY - r.top;
  const sensitivity = (App.config.zoom.step || 0.1) * 0.01;
  const factor = Math.exp(-dy * sensitivity);
  const newZ = Math.max(App.config.zoom.min, Math.min(App.config.zoom.max, App.cam.z * factor));
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
}

let _wheelIdleTimer = null;
wrap.addEventListener('wheel', e => {
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
  applyCamera(true);
  clearTimeout(_wheelIdleTimer);
  _wheelIdleTimer = setTimeout(renderMinimap, 150);
}, { passive: false });

// ══════════════════════════════════════════════════════════════════
//  POINTER INTERACTIONS (pan / marquee / drag / curve-drag)
// ══════════════════════════════════════════════════════════════════
let lastPointerClient = null;
let _rightDownPt = null;
let _rightDragged = false;

wrap.addEventListener('pointerdown', e => {
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;
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
  if (typeof clearActiveNoteHighlight === 'function') clearActiveNoteHighlight();
  if (typeof clearDividerSelection === 'function') clearDividerSelection();

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
    // A marquee is a multi-select gesture whether or not a modifier is held.
    if (typeof clearEdgeDirectionHighlight === 'function') clearEdgeDirectionHighlight();
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
      App.selectedStates.clear(); App.selectedTransitions.clear();
      renderAll();
    }
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

function startPan(e) {
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
const AUTO_PAN_MARGIN = 42;
const AUTO_PAN_MAX_SPEED = 16;
let autoPanRAF = null;

function computeAutoPanVector(clientX, clientY, rect) {
  let vx = 0, vy = 0;
  const left = clientX - rect.left, right = rect.right - clientX;
  const top = clientY - rect.top, bottom = rect.bottom - clientY;
  if (left >= 0 && left < AUTO_PAN_MARGIN) vx = (AUTO_PAN_MARGIN - left) / AUTO_PAN_MARGIN;
  else if (right >= 0 && right < AUTO_PAN_MARGIN) vx = -(AUTO_PAN_MARGIN - right) / AUTO_PAN_MARGIN;
  if (top >= 0 && top < AUTO_PAN_MARGIN) vy = (AUTO_PAN_MARGIN - top) / AUTO_PAN_MARGIN;
  else if (bottom >= 0 && bottom < AUTO_PAN_MARGIN) vy = -(AUTO_PAN_MARGIN - bottom) / AUTO_PAN_MARGIN;
  return { x: vx * AUTO_PAN_MAX_SPEED, y: vy * AUTO_PAN_MAX_SPEED };
}

function stopAutoPan() {
  if (autoPanRAF) { cancelAnimationFrame(autoPanRAF); autoPanRAF = null; }
}

function startAutoPanLoop() {
  if (autoPanRAF) return;
  const step = () => {
    if (!(App.dragOffsets || App.marquee || App.dividerDraft || App.dragDividerId || App.dragDividerEndpoint) || !lastPointerClient) { autoPanRAF = null; return; }
    const rect = wrap.getBoundingClientRect();
    const vec = computeAutoPanVector(lastPointerClient.clientX, lastPointerClient.clientY, rect);
    if (vec.x || vec.y) {
      App.cam.x += vec.x; App.cam.y += vec.y;
      applyCamera(true);
      handlePointerMove(lastPointerClient);
      autoPanRAF = requestAnimationFrame(step);
    } else {
      autoPanRAF = null;
    }
  };
  autoPanRAF = requestAnimationFrame(step);
}

// ── Snap-to-grid + alignment guides ──
function isSnapActive(shiftKey) {
  return App.config.snapToGrid ? !shiftKey : !!shiftKey;
}

function clearAlignGuides() {
  const g = $('align-guides-g');
  if (g) g.innerHTML = '';
}

function drawAlignGuides(x, y) {
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

function toggleSnapToGrid(force) {
  App.config.snapToGrid = force !== undefined ? !!force : !App.config.snapToGrid;
  const btn = $('snap-toggle-btn');
  if (btn) btn.classList.toggle('active', App.config.snapToGrid);
  try { localStorage.setItem('automata-snap-grid', App.config.snapToGrid ? '1' : '0'); } catch (e) { }
  showStatus(App.config.snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off');
}

let _activeMoveFrame = false;
let _pendingMoveEvent = null;

function queueMouseMove(e) {
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

function handlePointerMove(e) {
  if (App.toolbarDragging) return;
  lastPointerClient = e;
  if (isPanning) {
    App.cam.x = camStart.x + (e.clientX - panStart.x);
    App.cam.y = camStart.y + (e.clientY - panStart.y);
    applyCamera(true); // skip minimap during pan for speed
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
    App.states.forEach(s => {
      if (s.x >= mx && s.x <= mx + mw && s.y >= my && s.y <= my + mh) {
        if (!App.selectedStates.has(s.id)) { App.selectedStates.add(s.id); hlState(s.id, true); }
      }
    });
    // Select transitions whose midpoints are in the marquee
    App.transitions.forEach(t => {
      const from = getState(t.from), to = getState(t.to);
      if (!from || !to) return;
      // Approximate center including potential curve
      const midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
      if (midX >= mx && midX <= mx + mw && midY >= my && midY <= my + mh) {
        if (!App.selectedTransitions.has(t.id)) {
          App.selectedTransitions.add(t.id);
          const el = document.querySelector(`[data-edge="${t.from}|${t.to}"]`);
          if (el) el.classList.add('sel-t');
        }
      }
    });
    checkAutoPan(e);
    return;
  }
  if (App.dragOffsets) {
    const pt = svgPt(e);
    const snap = isSnapActive(e.shiftKey);
    const gSnapAmount = App.config.gridSnap || 20;
    App.selectedStates.forEach(sid => {
      const s = getState(sid);
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
      const s = getState(sid);
      if (s) {
        const TOL = 6 / App.cam.z;
        let bestX = null, bestY = null;
        App.states.forEach(o => {
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
    if (typeof updateFastDOM === 'function') updateFastDOM(); else renderAll();
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
  if (App.dragDividerId) {
    dragDividerTo(e);
    checkAutoPan(e);
    return;
  }
  if (App.dragNoteId) {
    if (typeof dragNoteTo === 'function') dragNoteTo(e);
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
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const px = -dy / dist, py = dx / dist; // Normal vector
      const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2;
      const proj = (pt.x - cx) * px + (pt.y - cy) * py;
      grp.ts.forEach(t => t.curve = proj);
      if (typeof updateFastDOM === 'function') updateFastDOM(); else renderAll();
    }
    return;
  }
  if (App.transFrom && App.tool === 'trans') {
    const src = getState(App.transFrom), pt = svgPt(e);
    if (src) drawTempLine(src.x, src.y, pt.x, pt.y);
  }
}

function checkAutoPan(e) {
  const rect = wrap.getBoundingClientRect();
  const vec = computeAutoPanVector(e.clientX, e.clientY, rect);
  if (vec.x || vec.y) startAutoPanLoop(); else stopAutoPan();
}

function endPointerInteractions() {
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
    renderMinimap(); return;
  }
  if (App.marquee) {
    App.marqueeRect.remove(); App.marqueeRect = null; App.marquee = null; renderMinimap();
  }
  if (App.dragOffsets || App.dragCurve) {
    App.dragOffsets = null;
    App.dragCurve = null;
    clearAlignGuides();
    renderMinimap();
  }
  if (App.dividerDraft) {
    finishDividerDraw();
    renderMinimap();
  }
  if (App.dragDividerEndpoint) {
    endDividerEndpointDrag();
    renderMinimap();
  }
  if (App.dragDividerId) {
    App.dragDividerId = null;
    App.dragDividerOffset = null;
    renderMinimap();
  }
  if (App.dragNoteId) {
    App.dragNoteId = null;
    renderMinimap();
  }
  if (App.resizeNoteId) {
    if (typeof endNoteResize === 'function') endNoteResize();
    renderMinimap();
  }
}

function resetRightClickState() {
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
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;
  const onSVGBg = e.target === wrap || e.target.id === 'svgCanvas' || e.target === $('cam-g');
  if (!onSVGBg) return;
  e.preventDefault();
});

function showCanvasContextMenu(x, y) {
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
function hideCanvasContextMenu() {
  const m = $('canvas-ctx');
  if (m) m.style.display = 'none';
}
document.addEventListener('click', () => hideCanvasContextMenu());

function ctxCanvasAddState() {
  hideCanvasContextMenu();
  const pt = App.ctxCanvasPt || { x: 0, y: 0 };
  createState(pt.x, pt.y);
}
function ctxCanvasPaste() {
  hideCanvasContextMenu();
  pasteClipboard(App.ctxCanvasPt);
}
function ctxCanvasSelectAll() {
  hideCanvasContextMenu();
  selectAllStates();
}
function ctxCanvasFit() {
  hideCanvasContextMenu();
  fitToScreen();
}
function ctxCanvasAutoLayout() {
  hideCanvasContextMenu();
  autoLayout();
}

// ── Double-click empty canvas to create a state ──
wrap.addEventListener('dblclick', e => {
  if (App.tool !== 'pointer' && App.tool !== 'move') return;
  if (wrap.dataset.lastPointerType === 'touch') return;
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;
  const onSVGBg = e.target === wrap || e.target.id === 'svgCanvas' || e.target === $('cam-g');
  if (!onSVGBg) return;
  const pt = svgPt(e);
  createState(pt.x, pt.y);
});

function onStateDown(e, id) {
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
      if (!multi && !App.selectedStates.has(id)) {
        App.selectedStates.clear();
        App.selectedTransitions.clear();
        document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
        App.selectedStates.add(id);
        if (el) el.classList.add('sel-st');
        if (App.config.clickHighlightMode === 'outgoing' || App.config.clickHighlightMode === 'incoming') {
          highlightEdgesForState(id, App.config.clickHighlightMode);
        } else {
          clearEdgeDirectionHighlight();
        }

      } else if (multi) {
        clearEdgeDirectionHighlight();
        if (App.selectedStates.has(id)) {
          App.selectedStates.delete(id);
          if (el) el.classList.remove('sel-st');
          return;
        } else {
          App.selectedStates.add(id);
          if (el) el.classList.add('sel-st');
        }
      }
    } else {
      App.selectedStates.clear();
      App.selectedTransitions.clear();
      document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
      App.selectedStates.add(id);
      if (el) el.classList.add('sel-st');
    }

    const pt = svgPt(e);
    App.dragOffsets = {};
    App.selectedStates.forEach(sid => {
      const s = getState(sid);
      if (s) App.dragOffsets[sid] = { x: pt.x - s.x, y: pt.y - s.y };
    });
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
    snapshot();
  }
}

let tempLine = null;
function drawTempLine(x1, y1, x2, y2) {
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
function clearTempLine() { if (tempLine) { tempLine.remove(); tempLine = null; } }
function hlState(id, on) { const el = document.querySelector(`[data-id="${id}"]`); if (el) el.classList.toggle('sel-st', on); }

// ══════════════════════════════════════════════════════════════════
//  DIRECTIONAL EDGE HIGHLIGHT — optionally triggered by clicking a state
//  (Settings → Rendering picks Outgoing / Incoming / Off), or always
//  available via the state's right-click menu regardless of that setting.
// ══════════════════════════════════════════════════════════════════
// Repaints App.edgeHighlight onto the DOM from scratch. renderAll() calls this
// after every redraw, so the highlight is reconstructed from App state rather
// than living only as classes that the next render would silently wipe.
function applyEdgeDirectionHighlight() {
  document.querySelectorAll('.edge-g.outgoing-hl, .edge-g.incoming-hl, .sn.outgoing-hl-src, .sn.incoming-hl-src').forEach(el => {
    el.classList.remove('outgoing-hl', 'incoming-hl', 'outgoing-hl-src', 'incoming-hl-src');
  });
  const hl = App.edgeHighlight;
  if (!hl) return;
  const srcCls = hl.direction === 'incoming' ? 'incoming-hl-src' : 'outgoing-hl-src';
  const edgeCls = hl.direction === 'incoming' ? 'incoming-hl' : 'outgoing-hl';
  const srcEl = App.domCache.states.get(hl.id) || document.querySelector(`.sn[data-id="${hl.id}"]`);
  if (srcEl) srcEl.classList.add(srcCls);
  App.transitions.forEach(t => {
    const matches = hl.direction === 'incoming' ? t.to === hl.id : t.from === hl.id;
    if (!matches) return;
    const key = t.from + '|' + t.to;
    const el = App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
    if (el) el.classList.add(edgeCls);
  });
}

// The highlight exists to make a cluttered graph readable by isolating one
// state's flow. Lighting up several states at once rebuilds the haystack it
// was meant to cut through, so every multi-select gesture — shift/ctrl-click,
// marquee, select-all, or shifting focus to an edge — drops it entirely
// rather than accumulating.
function clearEdgeDirectionHighlight() {
  if (!App.edgeHighlight) return;
  App.edgeHighlight = null;
  applyEdgeDirectionHighlight();
}

// direction: 'outgoing' highlights edges leaving stateId, 'incoming' those
// arriving at it. A self-loop matches both, since it's simultaneously the
// state's only outgoing and only incoming edge to itself. Always replaces any
// existing highlight — only one state is ever lit.
function highlightEdgesForState(stateId, direction) {
  App.edgeHighlight = { id: stateId, direction };
  applyEdgeDirectionHighlight();
}

function ctxHighlightOutgoing() {
  const id = App.ctxId;
  hideContextMenu();
  if (!id) return;
  highlightEdgesForState(id, 'outgoing');
}
function ctxHighlightIncoming() {
  const id = App.ctxId;
  hideContextMenu();
  if (!id) return;
  highlightEdgesForState(id, 'incoming');
}
// ══════════════════════════════════════════════════════════════════
//  SELECTION: select-all, nudge, copy / paste / duplicate
// ══════════════════════════════════════════════════════════════════
function selectAllStates() {
  if (!App.states.length) return;
  clearEdgeDirectionHighlight();
  App.selectedStates = new Set(App.states.map(s => s.id));
  App.selectedTransitions = new Set(App.transitions.map(t => t.id));
  renderAll();
  showStatus(`Selected ${App.states.length} state${App.states.length === 1 ? '' : 's'}`);
}

function nudgeSelected(dx, dy) {
  if (!App.selectedStates.size) return;
  snapshot();
  App.selectedStates.forEach(sid => {
    const s = getState(sid);
    if (s) { s.x += dx; s.y += dy; }
  });
  if (typeof updateFastDOM === 'function') updateFastDOM(); else renderAll();
  renderMinimap();
}

function copySelection() {
  if (!App.selectedStates.size) { showStatus('No states selected to copy'); return; }
  const ids = new Set(App.selectedStates);
  const states = App.states.filter(s => ids.has(s.id)).map(s => ({ ...s, isDummyStart: false }));
  const transitions = App.transitions.filter(t => ids.has(t.from) && ids.has(t.to)).map(t => ({ ...t }));
  App.clipboard = { states, transitions };
  showStatus(`Copied ${states.length} state${states.length === 1 ? '' : 's'}`);
}

function duplicateSelection() {
  if (!App.selectedStates.size) { showStatus('No states selected to duplicate'); return; }
  copySelection();
  pasteClipboard(null, 28);
}

function pasteClipboard(atPoint, fallbackOffset = 32) {
  if (!App.clipboard || !App.clipboard.states.length) { showStatus('Nothing to paste'); return; }
  snapshot();
  const idMap = {};
  let offX = fallbackOffset, offY = fallbackOffset;
  if (atPoint) {
    const xs = App.clipboard.states.map(s => s.x), ys = App.clipboard.states.map(s => s.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    offX = atPoint.x - cx; offY = atPoint.y - cy;
  }
  const existingNames = new Set(App.states.map(s => s.name));
  const newStates = App.clipboard.states.map(s => {
    const id = newId();
    idMap[s.id] = id;
    let name = s.name;
    while (existingNames.has(name)) name = name + '_copy';
    existingNames.add(name);
    return { ...s, id, name, x: s.x + offX, y: s.y + offY };
  });
  App.states.push(...newStates);
  const newTransitions = App.clipboard.transitions.map(t => ({ ...t, id: newTId(), from: idMap[t.from], to: idMap[t.to] }));
  App.transitions.push(...newTransitions);

  App.selectedStates = new Set(newStates.map(s => s.id));
  App.selectedTransitions = new Set(newTransitions.map(t => t.id));
  renderAll(); updateLPanel(); updateRPanel();
  showStatus(`Pasted ${newStates.length} state${newStates.length === 1 ? '' : 's'}`);
}

// ══════════════════════════════════════════════════════════════════
//  AUTO LAYOUT — Sugiyama-style layered graph drawing
//
//  1. sugiyamaBuildDAG    — drop self-loops, break cycles (DFS back-edge
//                           removal) so every remaining edge points from
//                           an earlier layer to a later one.
//  2. sugiyamaAssignRanks — longest-path layering over that DAG; rank =
//                           column (states flow left → right).
//  3. sugiyamaOrderLayers — barycenter/median heuristic, swept down then
//                           up a few times, to reduce edge crossings
//                           between adjacent columns.
//  4. Coordinates are then read straight off (rank, order-in-layer) —
//     no simulation, no animation, one deterministic pass.
// ══════════════════════════════════════════════════════════════════

// Adjacency ignoring self-loops (they don't affect layering) and
// collapsing parallel transitions between the same pair of states.
function sugiyamaAdjacency(states, transitions) {
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
function sugiyamaBuildDAG(states, succ, startId) {
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

// Longest-path layering: every DAG edge goes from a strictly lower
// rank to a strictly higher one (Kahn's algorithm over in-degree).
function sugiyamaAssignRanks(states, dag) {
  const indeg = new Map(states.map(s => [s.id, 0]));
  dag.forEach(tos => tos.forEach(to => indeg.set(to, indeg.get(to) + 1)));
  const rank = new Map(states.map(s => [s.id, 0]));
  const queue = states.map(s => s.id).filter(id => indeg.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    dag.get(u).forEach(v => {
      rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    });
  }
  return rank;
}

// Barycenter heuristic: repeatedly reorder each layer by the average
// position of its neighbors in the layer that was just fixed, sweeping
// downward then upward so information propagates both ways. Nodes
// with no fixed neighbor yet just keep their current slot.
function sugiyamaOrderLayers(layers, succ, pred, sweeps = 6) {
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

function sugiyamaLayout(states, transitions, startId) {
  const { succ, pred } = sugiyamaAdjacency(states, transitions);
  const { dag, visitOrder } = sugiyamaBuildDAG(states, succ, startId);
  const rank = sugiyamaAssignRanks(states, dag);

  const maxRank = Math.max(0, ...states.map(s => rank.get(s.id)));
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  // Seed each layer in DFS-visit order so connected chains land near
  // each other before crossing-reduction takes over.
  [...visitOrder].reverse().forEach(id => layers[rank.get(id)].push(id));
  states.forEach(s => { if (!visitOrder.includes(s.id)) layers[rank.get(s.id)].push(s.id); });

  sugiyamaOrderLayers(layers, succ, pred);

  const { minRadius, nodeSpacing } = App.config.layout;
  const layerSpacing = Math.max(minRadius, nodeSpacing * 3.4);
  const byId = new Map(states.map(s => [s.id, s]));
  layers.forEach((layer, r) => {
    const span = (layer.length - 1) * nodeSpacing * 1.6;
    layer.forEach((id, i) => {
      const s = byId.get(id);
      s.x = r * layerSpacing;
      s.y = i * nodeSpacing * 1.6 - span / 2;
    });
  });
}

// Original one-shot circular placement — kept as a selectable alternative
// (Settings → Rendering → Auto-Layout Algorithm) for users who prefer an
// evenly-spaced ring over the layered layout.
function circularLayout(states) {
  const n = states.length;
  const r = Math.max(App.config.layout.minRadius, n * App.config.layout.nodeSpacing);
  states.forEach((s, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    s.x = r * Math.cos(angle);
    s.y = r * Math.sin(angle);
  });
}

// ══════════════════════════════════════════════════════════════════
//  AUTO LAYOUT
// ══════════════════════════════════════════════════════════════════
function autoLayout() {
  if (!App.states.length) { showStatus('No states to arrange'); return; }
  snapshot();
  if (App.config.layout.algorithm === 'circular') {
    circularLayout(App.states);
  } else {
    sugiyamaLayout(App.states, App.transitions, App.startId);
  }
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
function getContentBounds(statePad = 0) {
  if (!App.states.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  App.states.forEach(s => {
    minX = Math.min(minX, s.x - statePad);
    minY = Math.min(minY, s.y - statePad);
    maxX = Math.max(maxX, s.x + statePad);
    maxY = Math.max(maxY, s.y + statePad);
  });
  if (typeof includeNoteBounds === 'function') {
    includeNoteBounds((x0, y0, x1, y1) => {
      minX = Math.min(minX, x0); minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    });
  }
  if (typeof includeDividerBounds === 'function') {
    includeDividerBounds((x0, y0, x1, y1) => {
      minX = Math.min(minX, x0); minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    });
  }
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
function buildExportSVG(opts = {}) {
  const svgEl = $('svgCanvas');
  const wrap = $('canvas-wrap');
  let w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;

  const clone = svgEl.cloneNode(true);

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
  if (opts.crop) {
    const b = getContentBounds(App.config.radius + 4);
    if (b) {
      const pad = opts.padding === undefined ? 40 : Math.max(0, opts.padding);
      const camG = clone.querySelector('#cam-g');
      if (camG) camG.setAttribute('transform', 'translate(0,0) scale(1)');
      w = Math.max(1, Math.round(b.width + pad * 2));
      h = Math.max(1, Math.round(b.height + pad * 2));
      clone.setAttribute('viewBox', `${(b.minX - pad).toFixed(2)} ${(b.minY - pad).toFixed(2)} ${w} ${h}`);
    }
  }

  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

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
  svgStyle.textContent = `${rootStyles}\n${cssRules}\n.tarr-hit { display:none !important; }\n.note-resize-hit, .note-resize-handle { display:none !important; }\n.divider-hit, .divider-endpoint { display:none !important; }\nsvg { background: transparent; }`;
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

function exportSVG(opts = {}) {
  const { svg } = buildExportSVG(opts);
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
  exportDownload(exportFilename('svg'), header + svg, 'image/svg+xml;charset=utf-8');
  showStatus('Exported as SVG');
  if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
}

function exportPNG(opts = {}) {
  const res = opts.scale || App.config.exportRes || 2;
  const embedData = opts.embedData !== false;
  const { svg: svgStr, width: w, height: h } = buildExportSVG(opts);

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
