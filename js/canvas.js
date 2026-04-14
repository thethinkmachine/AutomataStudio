// ══════════════════════════════════════════════════════════════════
//  CANVAS / CAMERA (ZOOM & PAN)
// ══════════════════════════════════════════════════════════════════
const wrap = $('canvas-wrap');
let isPanning = false, panStart = { x: 0, y: 0 }, camStart = { x: 0, y: 0 };

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

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) {
    const r = wrap.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZ = Math.max(App.config.zoom.min, Math.min(App.config.zoom.max, App.cam.z * delta));
    App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
    App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
    App.cam.z = newZ;
    applyCamera();
  } else {
    App.cam.x -= e.deltaX;
    App.cam.y -= e.deltaY;
    applyCamera();
  }
}, { passive: false });

wrap.addEventListener('mousedown', e => {
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;

  if (e.button === 1 || (e.button === 0 && (e.altKey || App.spacePan))) {
    isPanning = true; panStart = { x: e.clientX, y: e.clientY }; camStart = { x: App.cam.x, y: App.cam.y };
    wrap.classList.add('panning'); e.preventDefault(); return;
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
    e.preventDefault();
  } else if (App.tool === 'state') {
    const pt = svgPt(e); createState(pt.x, pt.y);
  } else if (App.tool === 'trans') {
    App.transFrom = null; clearTempLine();
  } else if (App.tool === 'move') {
    isPanning = true; panStart = { x: e.clientX, y: e.clientY }; camStart = { x: App.cam.x, y: App.cam.y };
    wrap.classList.add('panning'); e.preventDefault();
  }
});

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
    if (nextMove) handleMouseMove(nextMove);
    _activeMoveFrame = false;
    if (_pendingMoveEvent) queueMouseMove(_pendingMoveEvent);
  });
}

document.addEventListener('mousemove', queueMouseMove);

function handleMouseMove(e) {
  if (App.toolbarDragging) return;
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
    return;
  }
  if (App.dragOffsets) {
    const pt = svgPt(e);
    let snap = e.shiftKey;
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
    if (typeof updateFastDOM === 'function') updateFastDOM(); else renderAll();
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

document.addEventListener('mouseup', e => {
  if (App.toolbarDragging) return;
  if (_pendingMoveEvent) {
    const nextMove = _pendingMoveEvent;
    _pendingMoveEvent = null;
    handleMouseMove(nextMove);
  }
  if (isPanning) {
    isPanning = false; wrap.classList.remove('panning'); renderMinimap(); return;
  }
  if (App.marquee) {
    App.marqueeRect.remove(); App.marqueeRect = null; App.marquee = null; renderMinimap();
  }
  if (App.dragOffsets || App.dragCurve) {
    App.dragOffsets = null;
    App.dragCurve = null;
    renderMinimap();
  }
});
document.addEventListener('click', () => hideContextMenu());

window.addEventListener('blur', () => {
  isPanning = false;
  wrap.classList.remove('panning');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPanning = false;
    wrap.classList.remove('panning');
  }
});

function onStateDown(e, id) {
  if (App.spacePan) return;
  e.stopPropagation();
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
