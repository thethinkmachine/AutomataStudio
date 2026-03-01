// ══════════════════════════════════════════════════════════════════
//  CANVAS / CAMERA (ZOOM & PAN)
// ══════════════════════════════════════════════════════════════════
const wrap = $('canvas-wrap');
let isPanning = false, panStart = { x: 0, y: 0 }, camStart = { x: 0, y: 0 };

function svgPt(e) {
  const r = wrap.getBoundingClientRect();
  return { x: (e.clientX - r.left - App.cam.x) / App.cam.z, y: (e.clientY - r.top - App.cam.y) / App.cam.z };
}
function applyCamera() {
  $('cam-g').setAttribute('transform', `translate(${App.cam.x},${App.cam.y}) scale(${App.cam.z})`);
  $('zoom-ind').textContent = Math.round(App.cam.z * 100) + '%';
  renderMinimap();
}

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZ = Math.max(0.2, Math.min(3, App.cam.z * delta));
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  applyCamera();
}, { passive: false });

wrap.addEventListener('mousedown', e => {
  // Never let overlay HUD elements (toolbox, minimap, nav controls) trigger canvas actions
  if (e.target.closest('.canvas-toolbox, .minimap-container, .canvas-nav-controls, .minimap-show-btn, #status-bar')) return;

  // Middle mouse or Alt+drag → pan regardless of active tool
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true; panStart = { x: e.clientX, y: e.clientY }; camStart = { x: App.cam.x, y: App.cam.y };
    wrap.style.cursor = 'grabbing'; e.preventDefault(); return;
  }
  if (e.button !== 0) return;

  // Determine if the click landed on empty canvas space.
  // State nodes call e.stopPropagation() in onStateDown, so they never reach here.
  const onSVGBg = e.target === wrap || e.target.id === 'svgCanvas' || e.target === $('cam-g');
  const onTransition = !!e.target.closest('#trans-g');
  const onBackground = onSVGBg || onTransition;
  if (!onBackground) return;

  if (App.tool === 'state') {
    const pt = svgPt(e); createState(pt.x, pt.y);
  } else if (App.tool === 'trans') {
    App.transFrom = null; clearTempLine();
  } else if (App.tool === 'move') {
    // Left-click drag on empty canvas → pan
    isPanning = true; panStart = { x: e.clientX, y: e.clientY }; camStart = { x: App.cam.x, y: App.cam.y };
    wrap.style.cursor = 'grabbing'; e.preventDefault();
  }
});

document.addEventListener('mousemove', e => {
  if (isPanning) {
    App.cam.x = camStart.x + (e.clientX - panStart.x);
    App.cam.y = camStart.y + (e.clientY - panStart.y);
    applyCamera(); return;
  }
  if (App.drag) {
    const r = wrap.getBoundingClientRect();
    const s = getState(App.drag);
    if (s) { s.x = (e.clientX - r.left - App.cam.x) / App.cam.z - App.dragOff.x; s.y = (e.clientY - r.top - App.cam.y) / App.cam.z - App.dragOff.y; }
    renderAll(); return;
  }
  if (App.transFrom && App.tool === 'trans') {
    const src = getState(App.transFrom), pt = svgPt(e);
    if (src) drawTempLine(src.x, src.y, pt.x, pt.y);
  }
});

document.addEventListener('mouseup', e => {
  if (isPanning) {
    isPanning = false;
    const toolCursors = { pointer: 'default', move: 'grab', state: 'crosshair', trans: 'crosshair', del: 'not-allowed' };
    wrap.style.cursor = toolCursors[App.tool] || 'default';
    return;
  }
  App.drag = null;
});
document.addEventListener('click', () => $('ctx').style.display = 'none');

function onStateDown(e, id) {
  e.stopPropagation();
  if (e.button !== 0) return;
  if (App.tool === 'del') { deleteState(id); return; }
  if (App.tool === 'trans') {
    if (!App.transFrom) { App.transFrom = id; hlState(id, true); showStatus('Now click target state'); }
    else { const f = App.transFrom; App.transFrom = null; hlState(f, false); clearTempLine(); openTransModal(f, id); }
    return;
  }
  if (App.tool === 'move' || App.tool === 'pointer') {
    const s = getState(id), pt = svgPt(e);
    App.drag = id; App.dragOff = { x: pt.x - s.x, y: pt.y - s.y };
    snapshot();
  }
}

let tempLine = null;
function drawTempLine(x1, y1, x2, y2) {
  if (!tempLine) { tempLine = makeSVG('line'); tempLine.setAttribute('stroke', 'var(--accent)'); tempLine.setAttribute('stroke-width', '1.5'); tempLine.setAttribute('stroke-dasharray', '6,3'); tempLine.setAttribute('opacity', '0.6'); $('trans-g').appendChild(tempLine); }
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
  const r = Math.max(80, n * 35);
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
function exportSVG() {
  const svgEl = $('svgCanvas');
  const clone = svgEl.cloneNode(true);
  // Set explicit size
  const wrap = $('canvas-wrap');
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Inject inline styles
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .sn circle.bd { fill: #161d2e; stroke: rgba(100,130,200,0.22); stroke-width: 1.5; }
    .sn.start-st circle.bd { stroke: #69f0ae; }
    .sn.acc-st circle.bd { stroke: #ffd54f; }
    .sn.act-st circle.bd { fill: rgba(79,195,247,.18); stroke: #4fc3f7; }
    .tarr { stroke: #4a5878; stroke-width: 1.5; fill: none; marker-end: url(#arr); }
    .tlbl { font-family: monospace; font-size: 10px; fill: #7a8ab0; text-anchor: middle; }
    .slbl { font-family: monospace; font-size: 11px; fill: #c8d4f0; text-anchor: middle; dominant-baseline: central; }
    svg { background: #080c18; }
  `;
  clone.insertBefore(style, clone.firstChild);
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'automaton.svg';
  a.click();
  showStatus('SVG exported!');
}

