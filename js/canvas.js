// ══════════════════════════════════════════════════════════════════
//  CANVAS / CAMERA (ZOOM & PAN)
// ══════════════════════════════════════════════════════════════════
const wrap = $('canvas-wrap');
let isPanning = false, panStart = { x: 0, y: 0 }, camStart = { x: 0, y: 0 };
let panPointerId = null;

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

  if (e.button === 2) {
    // States/edges own their right-click: they already stop propagation on
    // their native `contextmenu` listener, so leave their pointerdown alone.
    if (e.target.closest('.sn, .edge-g')) return;
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

  if (App.tool === 'pointer') {
    if (!e.shiftKey) { App.selectedStates.clear(); App.selectedTransitions.clear(); renderAll(); }
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
    if (!(App.dragOffsets || App.marquee) || !lastPointerClient) { autoPanRAF = null; return; }
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
      if (!e.shiftKey && !App.selectedStates.has(id)) {
        App.selectedStates.clear();
        App.selectedTransitions.clear();
        document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
        App.selectedStates.add(id);
        if (el) el.classList.add('sel-st');

      } else if (e.shiftKey) {
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
//  SELECTION: select-all, nudge, copy / paste / duplicate
// ══════════════════════════════════════════════════════════════════
function selectAllStates() {
  if (!App.states.length) return;
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
//  AUTO LAYOUT
// ══════════════════════════════════════════════════════════════════
function autoLayout() {
  if (!App.states.length) { showStatus('No states to arrange'); return; }
  snapshot();
  const n = App.states.length;
  const r = Math.max(App.config.layout.minRadius, n * App.config.layout.nodeSpacing);
  App.states.forEach((s, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    s.x = r * Math.cos(angle);
    s.y = r * Math.sin(angle);
  });
  renderAll();
  fitToScreen();
}

// ══════════════════════════════════════════════════════════════════
//  SVG EXPORT
// ══════════════════════════════════════════════════════════════════
function exportPNG() {
  const svgEl = $('svgCanvas');
  const wrap = $('canvas-wrap');
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);

  // Strip transient interaction states (selection highlights, temporary lines)
  clone.querySelectorAll('.sel-st, .sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
  clone.querySelectorAll('.editor-layer').forEach(n => n.remove());
  const guideLayer = clone.querySelector('#align-guides-g');
  if (guideLayer) guideLayer.innerHTML = '';

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
  svgStyle.textContent = `${rootStyles}\n${cssRules}\n.tarr-hit { display:none !important; }\nsvg { background: transparent; }`;
  clone.insertBefore(svgStyle, clone.firstChild);

  const canvas = document.createElement('canvas');
  const res = App.config.exportRes || 2;
  canvas.width = w * res;
  canvas.height = h * res;
  const ctx = canvas.getContext('2d');
  ctx.scale(res, res);

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      const data = getWorkspaceData();
      const meta = `\n--AutomataData--\n${JSON.stringify(data)}`;
      const finalBlob = new Blob([blob, meta], { type: 'image/png' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(finalBlob);
      a.download = 'automaton.png';
      a.click();
      URL.revokeObjectURL(url);
      showStatus('Workspace snapshot saved!');
    }, 'image/png');
  };
  img.src = url;
}
