// ══════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y' || e.key === 'Z') { e.preventDefault(); redo(); }
    if (e.key === 's') { e.preventDefault(); saveJSON(); }
    return;
  }
  if (e.key === 'v' || e.key === 'V') setTool('move');
  if (e.key === 's' || e.key === 'S') setTool('state');
  if (e.key === 't' || e.key === 'T') setTool('trans');
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); fitToScreen(); }
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  if (e.key === 'd' || e.key === 'D') setTool('del');
  if (e.key === 'x' || e.key === 'X') clearAll();
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (App.selectedStates.size || App.selectedTransitions.size) {
      e.preventDefault();
      snapshot();
      App.selectedStates.forEach(id => {
        App.states = App.states.filter(s => s.id !== id);
        App.transitions = App.transitions.filter(t => t.from !== id && t.to !== id);
        if (App.startId === id) App.startId = null;
        App.accepts.delete(id);
      });
      App.selectedTransitions.forEach(tid => {
        App.transitions = App.transitions.filter(t => t.id !== tid);
      });
      App.selectedStates.clear();
      App.selectedTransitions.clear();
      renderAll(); updateLPanel(); updateRPanel();
    }
  }
  if (e.key === 'Escape') {
    const anyModalOpen = document.querySelector('.overlay.show');
    if (anyModalOpen) {
      closeModal('trans-modal'); closeModal('state-modal'); closeModal('help-modal');
    } else {
      App.transFrom = null; clearTempLine(); setTool('pointer');
    }
  }
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (App.currentAlgo === 'utm') utmStepFwd(); else stepFwd();
  }
  if (e.key === 'ArrowLeft') {
    if (App.currentAlgo === 'utm') utmStepBack(); else stepBack();
  }
  if (e.key === ' ' && App.currentAlgo === 'utm') {
    e.preventDefault();
    utmToggleAuto();
  }
  if (e.key === '1') setView('build');
  if (e.key === '2') setView('algo');
  if (e.key === '3') setView('grammar');
  if (e.key === '4') setView('theory');
});

const ThemeExports = {
  dark: {
    bg: '#080c18',
    nodeFill: '#161d2e',
    nodeStroke: 'rgba(100,130,200,0.22)',
    startStroke: '#69f0ae',
    accStroke: '#ffd54f',
    actFill: 'rgba(79,195,247,.18)',
    actStroke: '#4fc3f7',
    edgeStroke: '#4a5878',
    textFill: '#7a8ab0',
    nodeTextFill: '#c8d4f0',
    viewportStroke: 'rgba(79,195,247,0.6)'
  },
  light: {
    bg: '#eef4fb',
    nodeFill: '#ffffff',
    nodeStroke: 'rgba(41,73,109,0.2)',
    startStroke: '#198b63',
    accStroke: '#b7791f',
    actFill: 'rgba(23,142,216,.12)',
    actStroke: '#178ed8',
    edgeStroke: '#7d92a6',
    textFill: '#496277',
    nodeTextFill: '#16324a',
    viewportStroke: 'rgba(23,142,216,0.45)'
  }
};

function syncThemeExportPalette(theme) {
  App.config.export = { ...App.config.export, ...(ThemeExports[theme] || ThemeExports.dark) };
}

function updateThemeButton() {
  const btn = $('theme-btn');
  if (!btn) return;
  const nextTheme = App.config.theme === 'light' ? 'dark' : 'light';
  btn.innerHTML = App.config.theme === 'light'
    ? `<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>`
    : `<svg viewBox="0 0 24 24"><path d="m12 3.8 2.06 4.18 4.61.67-3.34 3.25.79 4.59L12 14.33 7.88 16.5l.79-4.59-3.34-3.25 4.61-.67Z"/></svg>`;
  btn.title = `Switch to ${nextTheme} theme`;
  btn.setAttribute('aria-label', btn.title);
}

function applyTheme(theme, persist = true) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  App.config.theme = resolved;
  document.documentElement.dataset.theme = resolved;
  syncThemeExportPalette(resolved);
  updateThemeButton();
  if ($('set-theme')) $('set-theme').value = resolved;
  if (typeof drawMinimap === 'function') drawMinimap();
  if (persist) {
    try { localStorage.setItem('automata-theme', resolved); } catch (e) { }
  }
}

function toggleTheme() {
  applyTheme(App.config.theme === 'light' ? 'dark' : 'light');
  if (typeof renderAll === 'function') renderAll();
  saveBackup();
  showStatus(`Theme: ${App.config.theme}`);
}


// ══════════════════════════════════════════════════════════════════
//  ZOOM / FIT / MINIMAP / SIDEBAR / FILTER FUNCTIONS
// ══════════════════════════════════════════════════════════════════
function zoomIn() {
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const r = w.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const newZ = Math.min(cfg.max, App.cam.z * 1.25);
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  $('cam-g').classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => $('cam-g').classList.remove('cam-smooth'), 250);
}

function zoomOut() {
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const r = w.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const newZ = Math.max(cfg.min, App.cam.z / 1.25);
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  $('cam-g').classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => $('cam-g').classList.remove('cam-smooth'), 250);
}

function setZoomFromInput(val) {
  const num = parseFloat(val.replace('%', ''));
  if (isNaN(num)) {
    applyCamera(); return;
  }
  if (!App.states.length) {
    const w = $('canvas-wrap'); if (!w) return;
    const mx = w.clientWidth / 2, my = w.clientHeight / 2;
    App.cam = { x: mx, y: my, z: 1 };
    $('cam-g').classList.add('cam-smooth');
    applyCamera();
    setTimeout(() => $('cam-g').classList.remove('cam-smooth'), 250);
    return;
  }
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const newZ = Math.max(cfg.min, Math.min(cfg.max, num / 100));

  const mx = w.clientWidth / 2, my = w.clientHeight / 2;
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  $('cam-g').classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => $('cam-g').classList.remove('cam-smooth'), 250);
}

function fitToScreen() {
  if (!App.states.length) return;
  const w = $('canvas-wrap'); if (!w) return;
  const cw = w.clientWidth, ch = w.clientHeight;
  const R = App.config.radius + 4; // state radius + some padding
  const pad = 90;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  App.states.forEach(s => {
    minX = Math.min(minX, s.x - R);
    minY = Math.min(minY, s.y - R);
    maxX = Math.max(maxX, s.x + R);
    maxY = Math.max(maxY, s.y + R);
  });
  const bw = maxX - minX, bh = maxY - minY;
  const scaleX = (cw - pad * 2) / bw;
  const scaleY = (ch - pad * 2) / bh;
  const z = Math.min(App.config.zoom.max, Math.min(scaleX, scaleY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  App.cam.x = cw / 2 - cx * z;
  App.cam.y = ch / 2 - cy * z;
  App.cam.z = z;
  $('cam-g').classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => $('cam-g').classList.remove('cam-smooth'), 250);
  showStatus('Fit to screen');
}

function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => showStatus(`Fullscreen failed: ${err.message}`));
  } else {
    document.exitFullscreen().catch(err => showStatus(`Exit fullscreen failed: ${err.message}`));
  }
}
document.addEventListener('fullscreenchange', () => {
  const btn = $('fs-btn');
  if (btn) {
    btn.title = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
    btn.style.opacity = document.fullscreenElement ? '0.7' : '1';
  }
});


function renderMinimap() {
  const canvas = $('minimap-canvas'); if (!canvas) return;
  if (!canvas.isConnected) return;
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = App.config.export.bg;
  ctx.fillRect(0, 0, cw, ch);
  if (!App.states.length) return;
  // Compute world bounding box
  const R_PAD = App.config.radius + 4;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  App.states.forEach(s => {
    minX = Math.min(minX, s.x - R_PAD); minY = Math.min(minY, s.y - R_PAD);
    maxX = Math.max(maxX, s.x + R_PAD); maxY = Math.max(maxY, s.y + R_PAD);
  });
  // Also include viewport extent
  const vw = $('canvas-wrap')?.clientWidth || 600, vh = $('canvas-wrap')?.clientHeight || 400;
  const vpMinX = -App.cam.x / App.cam.z, vpMinY = -App.cam.y / App.cam.z;
  const vpMaxX = (vw - App.cam.x) / App.cam.z, vpMaxY = (vh - App.cam.y) / App.cam.z;
  minX = Math.min(minX, vpMinX); minY = Math.min(minY, vpMinY);
  maxX = Math.max(maxX, vpMaxX); maxY = Math.max(maxY, vpMaxY);
  const bw = maxX - minX, bh = maxY - minY;
  if (!bw || !bh) return;
  const pad = 4;
  const scaleX = (cw - pad * 2) / bw, scaleY = (ch - pad * 2) / bh;
  const mmScale = Math.min(scaleX, scaleY);
  const mmOffX = pad + (cw - pad * 2 - bw * mmScale) / 2;
  const mmOffY = pad + (ch - pad * 2 - bh * mmScale) / 2;
  // Save for click navigation
  canvas._mmScale = mmScale; canvas._mmOffX = mmOffX; canvas._mmOffY = mmOffY;
  canvas._mmMinX = minX; canvas._mmMinY = minY;
  // Draw transitions
  ctx.strokeStyle = App.config.export.edgeStroke;
  ctx.lineWidth = 1;
  App.transitions.forEach(tr => {
    const fs = App.states.find(s => s.id === tr.from);
    const ts2 = App.states.find(s => s.id === tr.to);
    if (!fs || !ts2) return;
    ctx.beginPath();
    ctx.moveTo((fs.x - minX) * mmScale + mmOffX, (fs.y - minY) * mmScale + mmOffY);
    ctx.lineTo((ts2.x - minX) * mmScale + mmOffX, (ts2.y - minY) * mmScale + mmOffY);
    ctx.stroke();
  });
  // Draw states
  App.states.forEach(s => {
    const sx = (s.x - minX) * mmScale + mmOffX;
    const sy = (s.y - minY) * mmScale + mmOffY;
    const sr = Math.max(2, R_PAD * mmScale * 0.7);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = App.accepts.has(s.id) ? App.config.export.accStroke : App.config.export.actStroke;
    ctx.fill();
  });
  // Draw viewport rect
  const rx = (vpMinX - minX) * mmScale + mmOffX;
  const ry = (vpMinY - minY) * mmScale + mmOffY;
  const rw = (vpMaxX - vpMinX) * mmScale;
  const rh = (vpMaxY - vpMinY) * mmScale;
  ctx.strokeStyle = App.config.export.viewportStroke || App.config.export.actStroke;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rx, ry, rw, rh);
}

function toggleMinimap() {
  const mm = $('minimap-container'), sb = $('minimap-show-btn');
  if (!mm) return;
  const hidden = mm.classList.toggle('minimap-hidden');
  if (sb) sb.style.display = hidden ? '' : 'none';
  try { localStorage.setItem('automata-minimap', hidden ? '0' : '1'); } catch (e) { }
}

function minimapNavigate(e) {
  const canvas = $('minimap-canvas'); if (!canvas) return;
  if (!canvas._mmScale) return;
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy2 = e.clientY - rect.top;
  // Convert minimap coords → world coords
  const worldX = (cx - canvas._mmOffX) / canvas._mmScale + canvas._mmMinX;
  const worldY = (cy2 - canvas._mmOffY) / canvas._mmScale + canvas._mmMinY;
  // Pan camera to center on this world point
  const w = $('canvas-wrap'); if (!w) return;
  App.cam.x = w.clientWidth / 2 - worldX * App.cam.z;
  App.cam.y = w.clientHeight / 2 - worldY * App.cam.z;
  applyCamera();
}

function setTool(t) {
  App.tool = t;
  const w = $('canvas-wrap');
  if (w) {
    const cursors = { pointer: 'default', move: 'grab', state: 'crosshair', trans: 'crosshair', del: 'not-allowed' };
    w.style.cursor = cursors[t] || 'default';
    w.setAttribute('data-tool', t);
  }
}

function toggleLPanelPin() {
  const s = $('lpanel');
  const unpinned = s.classList.toggle('unpinned');
  const btn = $('lpanel-pin-btn');
  if (btn) btn.title = unpinned ? 'Pin left panel' : 'Unpin left panel';
  try { localStorage.setItem('automata-lpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

function toggleRPanelPin() {
  const r = $('rpanel');
  const unpinned = r.classList.toggle('unpinned');
  const btn = $('rpanel-pin-btn');
  if (btn) btn.title = unpinned ? 'Pin right panel' : 'Unpin right panel';
  try { localStorage.setItem('automata-rpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

function filterStates() {
  const q = ($('state-search')?.value || '').toLowerCase();
  document.querySelectorAll('#states-list .si').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function toggleRPSection(id) {
  const sec = $(id); if (!sec) return;
  const body = sec.querySelector('.rp-section-body');
  const collapsed = sec.classList.toggle('collapsed');
  if (body) body.style.display = collapsed ? 'none' : '';
}

function filterAlgos() {
  const q = ($('algo-search')?.value || '').toLowerCase();
  document.querySelectorAll('.algo-item').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
  document.querySelectorAll('.algo-grp').forEach(grp => {
    let sib = grp.nextElementSibling, any = false;
    while (sib && sib.classList.contains('algo-item')) {
      if (sib.style.display !== 'none') any = true;
      sib = sib.nextElementSibling;
    }
    grp.style.display = any ? '' : 'none';
  });
}

function openSettingsModal() {
  const c = App.config;
  $('set-theme').value = c.theme || 'dark';
  $('set-pda-steps').value = c.maxPdaSteps;
  $('set-tm-steps').value = c.maxTmSteps;
  $('set-auto-speed').value = c.autoSpeed;
  $('set-radius').value = c.radius;
  $('set-zoom-step').value = c.zoom.step;
  $('set-grid-snap').value = c.gridSnap;
  $('set-node-spacing').value = c.layout.nodeSpacing;
  $('set-curve-off').value = c.render.curveOff;
  $('set-sym-eps').value = c.sym.eps;
  $('set-sym-any').value = c.sym.any;
  $('set-sym-blank').value = c.sym.blank;
  $('set-sym-z0').value = c.sym.stackBottom;
  showOverlay('settings-modal');
}

function confirmSettings() {
  const c = App.config;
  applyTheme($('set-theme').value || c.theme || 'dark');
  c.maxPdaSteps = parseInt($('set-pda-steps').value) || 2000;
  c.maxTmSteps = parseInt($('set-tm-steps').value) || 10000;
  c.autoSpeed = parseInt($('set-auto-speed').value) || 500;
  c.radius = parseInt($('set-radius').value) || 30;
  c.zoom.step = parseFloat($('set-zoom-step').value) || 0.1;
  c.gridSnap = parseInt($('set-grid-snap').value) || 20;
  c.layout.nodeSpacing = parseInt($('set-node-spacing').value) || 35;
  c.render.curveOff = parseInt($('set-curve-off').value) || 45;
  c.sym.eps = $('set-sym-eps').value || App.config.sym.eps;
  c.sym.any = $('set-sym-any').value || App.config.sym.any;
  c.sym.blank = $('set-sym-blank').value || App.config.sym.blank;
  c.sym.stackBottom = $('set-sym-z0').value || App.config.sym.stackBottom;

  // Apply visual changes
  R = c.radius;
  renderAll();
  closeModal('settings-modal');
  showStatus('Settings applied!');
  saveBackup();
}
