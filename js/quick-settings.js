// Quick canvas settings — the popover on the nav controls, below the minimap.
//
// It is a shortcut into Settings, not a second place where canvas preferences
// live. Every row names the control it mirrors in the Settings dialog, and both
// directions are wired from that one name:
//
//   - toggling here writes App.config and then, if the dialog happens to be
//     open behind it, pushes the value into that control
//   - opening the popover reads App.config, so a change made in the dialog is
//     already reflected
//
// The alternative — a second set of handlers that happen to write the same keys
// — is how the two drift apart, and the drift is silent because each surface
// looks right on its own.
//
// Rows are deliberately few. The bar is "changes what the canvas looks like,
// and you want it while drawing"; anything you set once belongs in the dialog,
// which the More… link opens on the matching tab.
import { $, App, EdgeLabelStyles, normalizeEdgeLabelStyle } from './state.js';
import { settleAll } from './anim.js';
import { clearEdgeDirectionHighlight, toggleSnapToGrid } from './canvas.js';
import { Change } from './store.js';
import { commit } from './history.js';

// `mirrors` is the id of the Settings control holding the same value. `get`
// reads it out of App.config; `set` writes it back. A row never repaints —
// applyQuick() announces the change once, after the write.
//
// `group` starts a labelled section; rows are otherwise in the order shown.
const QUICK_ROWS = [
  {
    id: 'qs-edge-labels',
    type: 'select',
    group: 'Labels',
    label: 'Edge labels',
    tip: 'How transition labels are drawn on the canvas, or Hidden to leave the arrows bare.',
    mirrors: 'set-edge-label-style',
    options: [
      ['compact', 'Compact'],
      ['pills', 'Clear actions'],
      ['beginner', 'Beginner'],
      ['none', 'Hidden']
    ],
    get: () => normalizeEdgeLabelStyle(App.config.edgeLabelStyle),
    set: v => { App.config.edgeLabelStyle = EdgeLabelStyles.includes(v) ? v : 'compact'; }
  },
  {
    id: 'qs-wrap-labels',
    type: 'toggle',
    label: 'Wrap state names',
    tip: 'Break long, underscore/space/hyphen-separated state names onto multiple lines so they fit inside the node.',
    mirrors: 'set-wrap-labels',
    get: () => App.config.wrapStateLabels !== false,
    set: v => { App.config.wrapStateLabels = v; }
  },
  {
    id: 'qs-smart-labels',
    type: 'toggle',
    label: 'Keep labels clear',
    tip: 'Move a transition label off any state, edge or label it would overlap.',
    mirrors: 'set-smart-labels',
    get: () => App.config.render.smartLabels !== false,
    set: v => { App.config.render.smartLabels = v; }
  },
  {
    id: 'qs-snap',
    type: 'toggle',
    group: 'Interaction',
    label: 'Snap to grid',
    tip: 'Snap states to the grid while dragging. Hold Shift to invert.',
    mirrors: 'set-snap-grid',
    // Not a plain config write: snapping also drives the nav-bar button's
    // active state and a localStorage key, so it goes through the function that
    // owns all three.
    get: () => !!App.config.snapToGrid,
    set: v => toggleSnapToGrid(v)
  },
  {
    id: 'qs-click-highlight',
    type: 'select',
    label: 'Click highlights',
    tip: "Clicking a state also highlights its outgoing (green) or incoming (indigo) transitions. Both stay available from the state's right-click menu either way.",
    mirrors: 'set-click-highlight-mode',
    options: [
      ['off', 'Off'],
      ['outgoing', 'Outgoing'],
      ['incoming', 'Incoming']
    ],
    get: () => App.config.clickHighlightMode || 'off',
    set: v => {
      App.config.clickHighlightMode = v || 'off';
      // Turning it off has to retire whatever is currently lit, or the last
      // highlight stays on the canvas with no way left to clear it.
      if (App.config.clickHighlightMode === 'off') clearEdgeDirectionHighlight();
    }
  },
  {
    id: 'qs-layout-algo',
    type: 'select',
    group: 'Layout',
    label: 'Auto-layout',
    tip: 'Layered (Sugiyama) ranks states by transition flow and minimizes crossings. Circular arranges them evenly around a ring. Applies the next time you run auto-layout.',
    mirrors: 'set-layout-algo',
    options: [
      ['sugiyama', 'Layered'],
      ['circular', 'Circular']
    ],
    get: () => App.config.layout.algorithm || 'sugiyama',
    set: v => { App.config.layout.algorithm = v || 'sugiyama'; }
  },
  {
    id: 'qs-auto-route',
    type: 'toggle',
    label: 'Route around states',
    tip: 'Bend an edge around any state that would otherwise sit on top of it.',
    mirrors: 'set-auto-route',
    get: () => App.config.render.autoRouteEdges !== false,
    set: v => { App.config.render.autoRouteEdges = v; }
  },
  {
    id: 'qs-animate',
    type: 'toggle',
    label: 'Animate layout',
    tip: 'Glide loops, curves and labels to new positions instead of jumping.',
    mirrors: 'set-animate-layout',
    get: () => App.config.render.animateLayout !== false,
    set: v => { App.config.render.animateLayout = v; }
  }
];

// The control each row built, held directly rather than looked back up by id.
// refreshQuickSettings runs on every open and after every Settings apply, and
// a getElementById round-trip would make that depend on the node being attached
// and uniquely id'd — which is exactly the sort of thing that works until the
// panel is rebuilt or rendered somewhere else.
const controls = new Map();

// Exposed so tests can assert the mirror wiring without synthesising DOM
// events: every row must name a control that exists in the Settings dialog, or
// the two surfaces silently stop agreeing.
export function quickSettingsRows() {
  return QUICK_ROWS.map(r => ({ id: r.id, mirrors: r.mirrors, type: r.type }));
}

// The write path a row's control takes on change, callable directly.
export function setQuickSetting(id, value) {
  const row = QUICK_ROWS.find(r => r.id === id);
  if (!row) return false;
  applyQuick(row, value);
  return true;
}

export function getQuickSetting(id) {
  const row = QUICK_ROWS.find(r => r.id === id);
  return row ? row.get() : undefined;
}

// Push a value into the Settings dialog's control, so that a dialog left open
// behind the popover does not show a stale value and then write it back on
// Apply. Absent control (dialog never opened) is the normal case.
function syncMirror(row) {
  const el = $(row.mirrors);
  if (!el) return;
  const v = row.get();
  if (row.type === 'toggle') el.checked = !!v;
  else el.value = String(v);
}

// One write path for every row: set the config, keep the dialog in step, then
// announce the repaint.
function applyQuick(row, value) {
  row.set(value);
  syncMirror(row);
  // Settle before announcing: a row may have just switched the animation off,
  // and the repaint should draw the new setting rather than something still
  // easing toward it — the same reason confirmSettings settles.
  settleAll();
  // commit() = snapshot + emit, so the change is undoable and the tab is
  // marked unsaved — these settings are stored per workspace, so a change here
  // really is unsaved work. Change.CANVAS carries renderAll, which makes this
  // the repaint too; calling the renderer as well would draw the frame twice.
  commit(Change.CANVAS);
}

function buildRow(row) {
  const wrap = document.createElement('div');
  wrap.className = 'qs-row';
  if (row.tip) wrap.setAttribute('data-tip', row.tip);

  const label = document.createElement('span');
  label.className = 'qs-lbl';
  label.textContent = row.label;
  wrap.appendChild(label);

  if (row.type === 'toggle') {
    const sw = document.createElement('label');
    sw.className = 'toggle-switch qs-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = row.id;
    input.checked = !!row.get();
    input.setAttribute('aria-label', row.label);
    input.addEventListener('change', () => applyQuick(row, input.checked));
    controls.set(row.id, input);
    const track = document.createElement('span');
    track.className = 'toggle-track';
    const thumb = document.createElement('span');
    thumb.className = 'toggle-thumb';
    track.appendChild(thumb);
    sw.appendChild(input);
    sw.appendChild(track);
    wrap.appendChild(sw);
  } else {
    const sel = document.createElement('select');
    sel.className = 'sel qs-sel';
    sel.id = row.id;
    sel.setAttribute('aria-label', row.label);
    for (const [value, text] of row.options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    sel.value = String(row.get());
    sel.addEventListener('change', () => applyQuick(row, sel.value));
    controls.set(row.id, sel);
    wrap.appendChild(sel);
  }

  return wrap;
}

// Built once; refreshQuickSettings re-reads the values on each open.
function buildQuickSettings() {
  const body = $('qs-body');
  if (!body || body.dataset.built === '1') return;
  for (const row of QUICK_ROWS) {
    if (row.group) {
      const g = document.createElement('div');
      g.className = 'qs-group';
      g.textContent = row.group;
      body.appendChild(g);
    }
    body.appendChild(buildRow(row));
  }
  body.dataset.built = '1';
}

export function refreshQuickSettings() {
  for (const row of QUICK_ROWS) {
    const el = controls.get(row.id);
    if (!el) continue;
    const v = row.get();
    if (row.type === 'toggle') el.checked = !!v;
    else el.value = String(v);
  }
}

export function isQuickSettingsOpen() {
  const p = $('quick-settings');
  return !!p && p.classList.contains('open');
}

export function closeQuickSettings() {
  const p = $('quick-settings');
  if (!p) return;
  p.classList.remove('open');
  const btn = $('quick-settings-btn');
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

export function openQuickSettings() {
  const p = $('quick-settings');
  if (!p) return;
  buildQuickSettings();
  refreshQuickSettings();
  positionQuickSettings();
  p.classList.add('open');
  const btn = $('quick-settings-btn');
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  }
}

// The nav controls move with the toolbar dock, so the popover cannot simply
// open upward: docked to the top it would open off-canvas. layoutCanvasOverlays
// stamps the resolved corner on the minimap, and the panel anchors against the
// same one — opening toward the canvas interior on both axes.
export function positionQuickSettings() {
  const p = $('quick-settings');
  const nav = $('canvas-nav-controls');
  const wrap = $('canvas-wrap');
  if (!p || !nav || !wrap) return;

  const map = $('minimap-container');
  const corner = (map && map.dataset.corner) || 'bottom-right';
  const [y, x] = corner.split('-');
  p.dataset.corner = corner;

  const navBox = nav.getBoundingClientRect();
  const wrapBox = wrap.getBoundingClientRect();
  const gap = 8;

  // Horizontal: align the panel's edge with the nav bar's, on the side the
  // stack is docked to.
  if (x === 'right') {
    p.style.right = `${Math.max(0, wrapBox.right - navBox.right)}px`;
    p.style.left = 'auto';
  } else {
    p.style.left = `${Math.max(0, navBox.left - wrapBox.left)}px`;
    p.style.right = 'auto';
  }

  // Vertical: away from the edge the controls sit on.
  if (y === 'bottom') {
    p.style.bottom = `${Math.max(0, wrapBox.bottom - navBox.top) + gap}px`;
    p.style.top = 'auto';
  } else {
    p.style.top = `${Math.max(0, navBox.bottom - wrapBox.top) + gap}px`;
    p.style.bottom = 'auto';
  }
}

export function toggleQuickSettings(event) {
  // Without this the document listener below sees the same click and closes
  // the panel in the same tick it opened.
  if (event) event.stopPropagation();
  if (isQuickSettingsOpen()) closeQuickSettings();
  else openQuickSettings();
}

// Jump to the full dialog, on the tab holding the rest of these settings.
export function openSettingsFromQuick(tab = 'rendering') {
  closeQuickSettings();
  if (typeof window.openSettingsModal === 'function') {
    window.openSettingsModal();
    if (typeof window.switchSettingsTab === 'function') window.switchSettingsTab(tab);
  }
}

// Dismissal: a click outside, or Escape. Registered at module scope, matching
// hideCanvasContextMenu and the dropdowns.
document.addEventListener('click', event => {
  if (!isQuickSettingsOpen()) return;
  const p = $('quick-settings');
  const btn = $('quick-settings-btn');
  const t = event.target;
  if (p && p.contains && p.contains(t)) return;
  if (btn && btn.contains && btn.contains(t)) return;
  closeQuickSettings();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isQuickSettingsOpen()) {
    closeQuickSettings();
    const btn = $('quick-settings-btn');
    if (btn && btn.focus) btn.focus();
  }
});
