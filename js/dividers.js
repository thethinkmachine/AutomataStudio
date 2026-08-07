import { hideCanvasContextMenu, svgPt } from './canvas.js';
import { snapshot } from './history.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { hideSaveMenu } from './persistence.js';
import { makeSVG, renderAll } from './render.js';
import { $, App } from './state.js';
import { hideContextMenu, showContextMenu } from './states-transitions.js';
import { setTool, toggleTool } from './ui.js';
import { showStatus } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  CANVAS DIVIDERS — line & rectangle annotations that partition the canvas
// ══════════════════════════════════════════════════════════════════
// A divider is pure annotation: it never participates in the machine, it just
// carves the canvas into visual regions ("deterministic half | nondeterministic
// half"). Dividers render *under* transitions and states so the machine always
// stays legible on top of them.
//
// Both kinds are stored as the same two points (x1,y1)-(x2,y2): for a 'line'
// they're the endpoints, for a 'rect' they're opposite corners. Keeping one
// shape lets drawing, dragging, styling, undo and persistence stay shared.
export const DIVIDER_MIN_LEN = 12;      // a shorter drag is treated as a mis-click, not a shape
export const DIVIDER_LABEL_PAD_X = 7;
export const DIVIDER_LABEL_PAD_Y = 3;
export const DIVIDER_LABEL_MAX = 80;
export const DIVIDER_KINDS = ['line', 'rect'];
export const DIVIDER_STYLES = ['solid', 'dashed', 'dotted'];
export const DIVIDER_COLORS = ['slate', 'violet', 'indigo', 'blue', 'green', 'yellow', 'orange', 'red'];

export function newDividerId() { return 'd' + (++App.dividerN); }
export function getDivider(id) { return App.dividers.find(d => d.id === id); }

export function normalizeDividerKind(kind) {
  return DIVIDER_KINDS.includes(kind) ? kind : 'line';
}
export function normalizeDividerStyle(style) {
  return DIVIDER_STYLES.includes(style) ? style : 'dashed';
}
export function normalizeDividerColor(color) {
  return DIVIDER_COLORS.includes(color) ? color : 'slate';
}
export function isRectDivider(d) {
  return normalizeDividerKind(d && d.kind) === 'rect';
}

export function dividerMid(d) {
  return { x: (d.x1 + d.x2) / 2, y: (d.y1 + d.y2) / 2 };
}
export function dividerLength(d) {
  return Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
}

// Normalized box — the two stored corners can be in any order depending on
// which way the user dragged, but <rect> needs a positive width/height.
export function dividerRectBox(d) {
  const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2);
  return { x, y, w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) };
}

// Angle the label rides at (lines only). SVG y grows downward, so a raw atan2
// would render text upside-down for any line pointing leftward — flipping by
// 180° keeps every label readable left-to-right regardless of draw direction.
export function dividerLabelAngle(d) {
  if (isRectDivider(d)) return 0;
  let deg = Math.atan2(d.y2 - d.y1, d.x2 - d.x1) * 180 / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg < -90) deg += 180;
  return deg;
}

// A line's caption sits at its midpoint; a rect's rides on its top edge, where
// it reads as a region title rather than something floating in the middle of
// the states the rect encloses.
export function dividerLabelAnchor(d) {
  if (!isRectDivider(d)) return dividerMid(d);
  const box = dividerRectBox(d);
  return { x: box.x + box.w / 2, y: box.y };
}

export function includeDividerBounds(cb) {
  (App.dividers || []).forEach(d => {
    cb(Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.max(d.x1, d.x2), Math.max(d.y1, d.y2));
  });
}

// ══════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS (snap + shift-constrain)
// ══════════════════════════════════════════════════════════════════
export function snapDividerPoint(pt) {
  if (!App.config.snapToGrid) return pt;
  const g = App.config.gridSnap || 20;
  return { x: Math.round(pt.x / g) * g, y: Math.round(pt.y / g) * g };
}

// Shift constrains the drag, but what "constrained" means depends on the kind:
// a line locks to the nearest 45° spoke, a rect becomes a square. Note this
// deliberately differs from state dragging, where Shift toggles grid snap —
// while drawing a shape these locks are the far more useful gesture, so grid
// snap here follows the App.config.snapToGrid setting alone.
export function constrainDividerPoint(anchor, pt, shiftKey, kind = 'line') {
  if (!shiftKey) return pt;
  const dx = pt.x - anchor.x, dy = pt.y - anchor.y;
  if (normalizeDividerKind(kind) === 'rect') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: anchor.x + (dx < 0 ? -side : side),
      y: anchor.y + (dy < 0 ? -side : side)
    };
  }
  const len = Math.hypot(dx, dy);
  if (!len) return pt;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * len, y: anchor.y + Math.sin(angle) * len };
}

export function resolveDividerPoint(anchor, e, shiftKey, kind) {
  const raw = svgPt(e);
  return snapDividerPoint(anchor ? constrainDividerPoint(anchor, raw, shiftKey, kind) : raw);
}

// Which stored coordinates a given handle controls. A line has two endpoints;
// a rect has four corners, each owning one x and one y.
export const DIVIDER_RECT_CORNERS = {
  1: { x: 'x1', y: 'y1' },
  2: { x: 'x2', y: 'y1' },
  3: { x: 'x2', y: 'y2' },
  4: { x: 'x1', y: 'y2' }
};

export function dividerHandles(d) {
  if (!isRectDivider(d)) {
    return [{ which: 1, x: d.x1, y: d.y1 }, { which: 2, x: d.x2, y: d.y2 }];
  }
  return Object.keys(DIVIDER_RECT_CORNERS).map(k => {
    const c = DIVIDER_RECT_CORNERS[k];
    return { which: Number(k), x: d[c.x], y: d[c.y] };
  });
}

// The point a handle drag pivots around — the far end of a line, or the
// diagonally opposite corner of a rect.
export function dividerHandleAnchor(d, which) {
  if (!isRectDivider(d)) {
    return which === 1 ? { x: d.x2, y: d.y2 } : { x: d.x1, y: d.y1 };
  }
  const opposite = { 1: 3, 2: 4, 3: 1, 4: 2 }[which];
  const c = DIVIDER_RECT_CORNERS[opposite];
  return { x: d[c.x], y: d[c.y] };
}

// ══════════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════════
export function renderDividers() {
  const g = $('dividers-g');
  if (!g) return;
  g.innerHTML = '';
  (App.dividers || []).forEach(d => renderOneDivider(g, d));
}

export function renderOneDivider(g, d) {
  const kind = normalizeDividerKind(d.kind);
  const grp = makeSVG('g');
  grp.classList.add('divider-g');
  grp.setAttribute('data-divider-id', d.id);
  grp.setAttribute('data-kind', kind);
  grp.setAttribute('data-color', normalizeDividerColor(d.color));
  grp.setAttribute('data-style', normalizeDividerStyle(d.style));
  if (App.selectedDividerId === d.id) grp.classList.add('divider-sel');

  // Two shapes, mirroring the .tarr / .tarr-hit split used for edges: a wide
  // transparent one catches the pointer, the thin visible one is decoration.
  // A rect's hit target is its outline, not its interior — filling it would
  // swallow every click meant for the states sitting inside the region.
  const tag = kind === 'rect' ? 'rect' : 'line';
  const hit = makeSVG(tag);
  hit.classList.add('divider-hit');
  grp.appendChild(hit);

  const shape = makeSVG(tag);
  shape.classList.add('divider-line');
  grp.appendChild(shape);

  if (d.label) {
    const labelG = makeSVG('g');
    labelG.classList.add('divider-label-g');
    const plate = makeSVG('rect');
    plate.classList.add('divider-label-plate');
    labelG.appendChild(plate);
    const text = makeSVG('text');
    text.classList.add('divider-label');
    text.textContent = d.label;
    labelG.appendChild(text);
    grp.appendChild(labelG);
  }

  dividerHandles(d).forEach(h => {
    const handle = makeSVG('circle');
    handle.classList.add('divider-endpoint');
    handle.setAttribute('data-endpoint', h.which);
    handle.setAttribute('r', 5);
    handle.addEventListener('pointerdown', e => onDividerEndpointDown(e, d.id, h.which));
    grp.appendChild(handle);
  });

  const dividerTip = kind === 'rect'
    ? 'Drag to move · drag a corner to resize · double-click to label · right-click for options'
    : 'Drag to move · drag an endpoint to reshape · double-click to label · right-click for options';
  grp.setAttribute('data-tip', dividerTip);
  grp.setAttribute('aria-label', dividerTip);

  attachDividerHandlers(grp, d);
  g.appendChild(grp);
  // Geometry is applied after the append because the label plate can only be
  // sized once its text is in the document and has a measurable box.
  applyDividerGeometry(grp, d);
}

// Writes the current coordinates onto an already-built divider group. Shared by
// the initial render and the in-place drag update, so the two can never drift.
export function applyDividerGeometry(grp, d) {
  const rect = isRectDivider(d);
  const box = rect ? dividerRectBox(d) : null;

  grp.querySelectorAll('.divider-hit, .divider-line').forEach(el => {
    if (rect) {
      el.setAttribute('x', box.x); el.setAttribute('y', box.y);
      el.setAttribute('width', box.w); el.setAttribute('height', box.h);
      el.setAttribute('rx', 8);
    } else {
      el.setAttribute('x1', d.x1); el.setAttribute('y1', d.y1);
      el.setAttribute('x2', d.x2); el.setAttribute('y2', d.y2);
    }
  });

  const byWhich = {};
  dividerHandles(d).forEach(h => { byWhich[h.which] = h; });
  grp.querySelectorAll('.divider-endpoint').forEach(el => {
    const h = byWhich[Number(el.getAttribute('data-endpoint'))];
    if (!h) return;
    el.setAttribute('cx', h.x); el.setAttribute('cy', h.y);
  });

  layoutDividerLabel(grp, d);
}

export function layoutDividerLabel(grp, d) {
  const labelG = grp.querySelector('.divider-label-g');
  if (!labelG) return;
  const text = labelG.querySelector('.divider-label');
  const plate = labelG.querySelector('.divider-label-plate');
  const at = dividerLabelAnchor(d);
  labelG.setAttribute('transform', `translate(${at.x},${at.y}) rotate(${dividerLabelAngle(d)})`);
  text.setAttribute('x', 0); text.setAttribute('y', 0);

  let box;
  try { box = text.getBBox(); } catch (err) { return; }
  plate.setAttribute('x', box.x - DIVIDER_LABEL_PAD_X);
  plate.setAttribute('y', box.y - DIVIDER_LABEL_PAD_Y);
  plate.setAttribute('width', box.width + DIVIDER_LABEL_PAD_X * 2);
  plate.setAttribute('height', box.height + DIVIDER_LABEL_PAD_Y * 2);
  plate.setAttribute('rx', 4);
}

// Fast path used while dragging: move one divider's existing DOM in place
// rather than re-rendering the whole layer on every pointermove.
export function updateOneDividerDOM(d) {
  const grp = App.domCache.dividers.get(d.id) || document.querySelector(`.divider-g[data-divider-id="${d.id}"]`);
  if (!grp) return;
  if (!App.domCache.dividers.has(d.id)) App.domCache.dividers.set(d.id, grp);
  applyDividerGeometry(grp, d);
}

// ══════════════════════════════════════════════════════════════════
//  INTERACTION
// ══════════════════════════════════════════════════════════════════
export function attachDividerHandlers(grp, d) {
  grp.addEventListener('pointerdown', e => onDividerDown(e, d.id));
  grp.addEventListener('dblclick', e => {
    e.stopPropagation();
    openDividerModal(d.id);
  });
  grp.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    App.ctxId = null;
    App.ctxEdge = null;
    App.ctxNoteId = null;
    App.ctxMode = 'divider';
    App.ctxDividerId = d.id;
    document.querySelectorAll('#ctx .ctx-divider-style').forEach(el => {
      el.classList.toggle('active', el.dataset.style === normalizeDividerStyle(d.style));
    });
    // Straightening only means anything for a line — a rect is axis-aligned
    // by construction.
    const straighten = $('ctx-divider-straighten');
    if (straighten) straighten.style.display = isRectDivider(d) ? 'none' : '';
    showContextMenu('divider', e.clientX, e.clientY);
  });
}

export function selectDivider(id) {
  App.selectedDividerId = id;
  document.querySelectorAll('.divider-g.divider-sel').forEach(el => el.classList.remove('divider-sel'));
  if (!id) return;
  const el = App.domCache.dividers.get(id) || document.querySelector(`.divider-g[data-divider-id="${id}"]`);
  if (el) el.classList.add('divider-sel');
}

export function clearDividerSelection() {
  selectDivider(null);
}

// Maps the active tool to the kind it draws, or null if it isn't a draw tool.
export function dividerToolKind(tool = App.tool) {
  if (tool === 'divider') return 'line';
  if (tool === 'rect') return 'rect';
  return null;
}

export function onDividerDown(e, id) {
  if (App.spacePan) return;
  if (e.button !== 0 && e.button !== 2) return;

  // With a draw tool active, an existing divider must not swallow the gesture —
  // otherwise you could never draw a line or box that crosses one.
  if (dividerToolKind()) {
    if (e.button !== 0) return;
    e.stopPropagation();
    beginDividerDraw(e);
    return;
  }

  e.stopPropagation();
  if (e.button === 2) return;
  if (App.tool === 'del') { deleteDivider(id); return; }
  if (App.tool !== 'pointer' && App.tool !== 'move') return;

  const d = getDivider(id);
  if (!d) return;
  selectDivider(id);
  const pt = svgPt(e);
  snapshot();
  App.dragDividerId = id;
  // Store the grab offset for both points so the shape translates rigidly.
  App.dragDividerOffset = { x1: d.x1 - pt.x, y1: d.y1 - pt.y, x2: d.x2 - pt.x, y2: d.y2 - pt.y };
  // Deliberately no setPointerCapture — see the matching note in onNoteDown:
  // capturing on `wrap` would retarget the dblclick and misfire the canvas
  // background's "double-click creates a state" handler.
}

// Called from canvas.js's handlePointerMove while App.dragDividerId is set.
export function dragDividerTo(e) {
  const d = getDivider(App.dragDividerId);
  const off = App.dragDividerOffset;
  if (!d || !off) return;
  const pt = snapDividerPoint(svgPt(e));
  d.x1 = pt.x + off.x1; d.y1 = pt.y + off.y1;
  d.x2 = pt.x + off.x2; d.y2 = pt.y + off.y2;
  updateOneDividerDOM(d);
}

export function onDividerEndpointDown(e, id, which) {
  if (App.spacePan) return;
  if (dividerToolKind()) return;   // let the draw gesture through
  e.stopPropagation();
  e.preventDefault();
  if (e.button !== 0) return;
  if (App.tool !== 'pointer' && App.tool !== 'move') return;
  const d = getDivider(id);
  if (!d) return;
  selectDivider(id);
  snapshot();
  App.dragDividerId = null;
  App.dragDividerEndpoint = { id, which };
}

// Called from canvas.js's handlePointerMove while App.dragDividerEndpoint is set.
export function dragDividerEndpointTo(e) {
  const { id, which } = App.dragDividerEndpoint;
  const d = getDivider(id);
  if (!d) return;
  const anchor = dividerHandleAnchor(d, which);
  const pt = resolveDividerPoint(anchor, e, e.shiftKey, d.kind);
  if (isRectDivider(d)) {
    const c = DIVIDER_RECT_CORNERS[which];
    if (!c) return;
    d[c.x] = pt.x; d[c.y] = pt.y;
  } else if (which === 1) {
    d.x1 = pt.x; d.y1 = pt.y;
  } else {
    d.x2 = pt.x; d.y2 = pt.y;
  }
  updateOneDividerDOM(d);
}

export function endDividerEndpointDrag() {
  App.dragDividerEndpoint = null;
}

// ── Drawing a new divider by dragging on empty canvas ──
export function beginDividerDraw(e) {
  const kind = dividerToolKind();
  if (!kind) return;
  const start = snapDividerPoint(svgPt(e));
  App.dividerDraft = { kind, start, current: start };
  const g = $('dividers-g');
  if (!g) return;
  const el = makeSVG(kind === 'rect' ? 'rect' : 'line');
  el.classList.add('divider-line', 'divider-draft');
  if (kind === 'rect') el.setAttribute('rx', 8);
  g.appendChild(el);
  App.dividerDraftEl = el;
  updateDividerDraftEl();
}

export function updateDividerDraftEl() {
  const draft = App.dividerDraft;
  const el = App.dividerDraftEl;
  if (!draft || !el) return;
  const d = { kind: draft.kind, x1: draft.start.x, y1: draft.start.y, x2: draft.current.x, y2: draft.current.y };
  if (draft.kind === 'rect') {
    const box = dividerRectBox(d);
    el.setAttribute('x', box.x); el.setAttribute('y', box.y);
    el.setAttribute('width', box.w); el.setAttribute('height', box.h);
  } else {
    el.setAttribute('x1', d.x1); el.setAttribute('y1', d.y1);
    el.setAttribute('x2', d.x2); el.setAttribute('y2', d.y2);
  }
}

export function updateDividerDraw(e) {
  if (!App.dividerDraft) return;
  App.dividerDraft.current = resolveDividerPoint(App.dividerDraft.start, e, e.shiftKey, App.dividerDraft.kind);
  updateDividerDraftEl();
}

export function finishDividerDraw() {
  const draft = App.dividerDraft;
  App.dividerDraft = null;
  if (App.dividerDraftEl) { App.dividerDraftEl.remove(); App.dividerDraftEl = null; }
  if (!draft) return;
  const { kind, start, current } = draft;
  // A click without a real drag shouldn't litter the canvas with a dot. For a
  // rect, a drag along only one axis is degenerate too, so both sides must
  // clear the threshold.
  const dx = Math.abs(current.x - start.x), dy = Math.abs(current.y - start.y);
  const big = kind === 'rect'
    ? (dx >= DIVIDER_MIN_LEN && dy >= DIVIDER_MIN_LEN)
    : Math.hypot(dx, dy) >= DIVIDER_MIN_LEN;
  if (!big) return;
  createDivider(kind, start.x, start.y, current.x, current.y);
  showStatus(kind === 'rect'
    ? 'Frame added — double-click it to add a label'
    : 'Divider added — double-click it to add a label');
}

// ══════════════════════════════════════════════════════════════════
//  CREATE / DELETE
// ══════════════════════════════════════════════════════════════════
export function createDivider(kind, x1, y1, x2, y2) {
  snapshot();
  const d = {
    id: newDividerId(),
    kind: normalizeDividerKind(kind),
    x1, y1, x2, y2,
    color: 'slate',
    style: 'dashed',
    label: ''
  };
  App.dividers.push(d);
  renderAll();
  selectDivider(d.id);
  return d;
}

export function deleteDivider(id) {
  snapshot();
  App.dividers = App.dividers.filter(d => d.id !== id);
  if (App.selectedDividerId === id) App.selectedDividerId = null;
  renderAll();
}

export function deleteSelectedDivider() {
  if (!App.selectedDividerId) return false;
  deleteDivider(App.selectedDividerId);
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  CONTEXT MENU ACTIONS (divider mode)
// ══════════════════════════════════════════════════════════════════
export function ctxEditDivider() {
  const id = App.ctxDividerId;
  hideContextMenu();
  if (id) openDividerModal(id);
}
export function ctxDeleteDivider() {
  const id = App.ctxDividerId;
  hideContextMenu();
  if (id) deleteDivider(id);
}
export function ctxSetDividerColor(color) {
  const d = getDivider(App.ctxDividerId);
  hideContextMenu();
  if (!d) return;
  snapshot();
  d.color = normalizeDividerColor(color);
  renderAll();
}
export function ctxSetDividerStyle(style) {
  const d = getDivider(App.ctxDividerId);
  hideContextMenu();
  if (!d) return;
  snapshot();
  d.style = normalizeDividerStyle(style);
  renderAll();
}
// Rotates a line about its midpoint onto the nearest axis, so a hand-drawn
// "roughly horizontal" divider can be made exactly horizontal.
export function ctxStraightenDivider() {
  const d = getDivider(App.ctxDividerId);
  hideContextMenu();
  if (!d || isRectDivider(d)) return;
  snapshot();
  const mid = dividerMid(d);
  const half = dividerLength(d) / 2;
  const horizontal = Math.abs(d.x2 - d.x1) >= Math.abs(d.y2 - d.y1);
  if (horizontal) {
    d.x1 = mid.x - half; d.x2 = mid.x + half; d.y1 = d.y2 = mid.y;
  } else {
    d.y1 = mid.y - half; d.y2 = mid.y + half; d.x1 = d.x2 = mid.x;
  }
  renderAll();
  showStatus(horizontal ? 'Divider straightened to horizontal' : 'Divider straightened to vertical');
}

// ══════════════════════════════════════════════════════════════════
//  LABEL MODAL
// ══════════════════════════════════════════════════════════════════
registerModal('divider-modal', {
  submit: () => confirmDivider(),
  onClose: () => { App.editDividerId = null; }
});

export function openDividerModal(id) {
  const d = getDivider(id);
  if (!d) return;
  App.editDividerId = id;
  const title = $('divider-modal-title');
  if (title) title.textContent = isRectDivider(d) ? 'Frame' : 'Divider';
  const input = $('divider-label');
  if (input) input.value = d.label || '';
  setDividerModalColorUI(normalizeDividerColor(d.color));
  setDividerModalStyleUI(normalizeDividerStyle(d.style));
  showOverlay('divider-modal');
  if (input) setTimeout(() => { input.focus(); input.select(); }, 40);
}

export function setDividerModalColorUI(color) {
  const row = $('divider-modal-swatches');
  if (!row) return;
  row.dataset.selected = color;
  row.querySelectorAll('.note-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === color));
}
export function setDividerModalColor(color) {
  setDividerModalColorUI(normalizeDividerColor(color));
}

export function setDividerModalStyleUI(style) {
  const row = $('divider-modal-styles');
  if (!row) return;
  row.dataset.selected = style;
  row.querySelectorAll('.divider-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === style));
}
export function setDividerModalStyle(style) {
  setDividerModalStyleUI(normalizeDividerStyle(style));
}

export function confirmDivider() {
  const d = getDivider(App.editDividerId);
  if (!d) { closeModal('divider-modal'); return; }
  snapshot();
  const input = $('divider-label');
  d.label = (input ? input.value : '').trim().slice(0, DIVIDER_LABEL_MAX);
  d.color = normalizeDividerColor($('divider-modal-swatches')?.dataset.selected);
  d.style = normalizeDividerStyle($('divider-modal-styles')?.dataset.selected);
  App.editDividerId = null;
  closeModal('divider-modal');
  renderAll();
}

export function deleteDividerFromModal() {
  const id = App.editDividerId;
  App.editDividerId = null;
  closeModal('divider-modal');
  if (id) deleteDivider(id);
}

// ══════════════════════════════════════════════════════════════════
//  TOOLBAR: the merged Shape button (draws either a divider or a rect)
// ══════════════════════════════════════════════════════════════════
// One toolbar slot covers both shapes rather than two near-identical buttons.
// Clicking it opens the picker so the two drawing modes are discoverable;
// keyboard shortcuts remain available for quick switching.
export const SHAPE_TOOL_ICON_LINE = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M214.64,41.36a32,32,0,0,0-50.2,38.89L80.25,164.44a32.06,32.06,0,0,0-38.89,4.94h0a32,32,0,1,0,50.2,6.37l84.19-84.19a32,32,0,0,0,38.89-50.2Zm-139.33,162a16,16,0,0,1-22.64-22.64h0a16,16,0,0,1,22.63,0h0A16,16,0,0,1,75.31,203.33Zm128-128a16,16,0,1,1,0-22.63A16,16,0,0,1,203.33,75.3Z"/></svg>';
export const SHAPE_TOOL_ICON_RECT = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z"/></svg>';
// "Frame", not "Region": a region is a superstate — a container that a state is
// genuinely INSIDE, that flattening has to reason about, and that changes the
// machine. This one is decoration on the drawing and changes nothing. Two
// objects sharing a name, one of them load-bearing, is how a user ends up
// expecting the R tool to build a statechart.
export const SHAPE_TOOL_LABELS = { divider: 'Divider', rect: 'Frame' };
export const SHAPE_TOOL_KBD = { divider: 'L', rect: 'R' };

export function normalizeShapeTool(tool) {
  return tool === 'rect' ? 'rect' : 'divider';
}

// Repaints the toolbar button to reflect which kind is current — called
// whenever App.lastShapeTool changes, so the icon/label/shortcut hint stay
// truthful even when switched via keyboard (L/R) rather than the button itself.
export function updateShapeToolButton(tool) {
  const kind = normalizeShapeTool(tool);
  const icon = $('shape-tool-icon');
  const lbl = $('shape-tool-lbl');
  const kbd = $('shape-tool-kbd');
  if (icon) icon.innerHTML = kind === 'rect' ? SHAPE_TOOL_ICON_RECT : SHAPE_TOOL_ICON_LINE;
  if (lbl) lbl.textContent = SHAPE_TOOL_LABELS[kind];
  if (kbd) kbd.textContent = SHAPE_TOOL_KBD[kind];
  const btn = $('t-shape');
  if (btn) btn.dataset.tip = `Shape — drag to draw a Divider line or Frame box (last used: ${SHAPE_TOOL_LABELS[kind]}); right-click to switch; L = line, R = rectangle; click again to return to Pointer`;
}

// Click activates the remembered kind; toggleTool's existing "click the
// active tool again to return to Pointer" rule applies unchanged.
export function clickShapeTool() {
  toggleTool(App.lastShapeTool);
}

export function showShapeToolMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  hideContextMenu();
  if (typeof hideCanvasContextMenu === 'function') hideCanvasContextMenu();
  if (typeof hideSaveMenu === 'function') hideSaveMenu();
  const m = $('shape-tool-menu');
  if (!m) return;
  m.querySelectorAll('.ctx-i').forEach(el => {
    el.classList.toggle('active', el.dataset.shape === App.lastShapeTool);
  });
  m.style.display = 'block';
  const btn = $('t-shape');
  const br = btn?.getBoundingClientRect();
  const w = m.offsetWidth || 190;
  const h = m.offsetHeight || 84;
  const left = br ? br.left : e.clientX;
  let top = br ? br.bottom + 6 : e.clientY;
  if (top + h > innerHeight - 8 && br) top = br.top - h - 6;
  m.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + 'px';
  btn?.setAttribute('aria-expanded', 'true');
}
export function hideShapeToolMenu() {
  const m = $('shape-tool-menu');
  if (m) m.style.display = 'none';
  $('t-shape')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', () => hideShapeToolMenu());

export function pickShapeTool(tool) {
  hideShapeToolMenu();
  setTool(normalizeShapeTool(tool));
}
