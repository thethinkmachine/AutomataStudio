import { applyEdgeDirectionHighlight, clearEdgeDirectionHighlight, onStateDown, wrap } from './canvas.js';
import { renderDividers } from './dividers.js';
import { commit, snapshot } from './history.js';
import { renderLanguagePanel } from './language.js';
import { highlightNoteAnchors, pruneNoteAnchors, renderNotes, updateNotesDOM } from './notes.js';
import { $, App, R, SVG_NS, activeComponentId, getComponent, getMachineConfig, hasCallStack, hasSuperstates } from './state.js';
import { descendIntoBox, recursiveComponentIds } from './hierarchy.js';
import { childIndex, defaultEntry, depthIndex, isCollapsed, isParallel, isSuperstate, nodeHalf, refreshSuperRects, stateIndex, subtreeIds, toggleRegionCollapsed, topLevelOf, visibleNodeOf } from './superstates.js';
import { getState, openTransModal, showContextMenu, transLabel, transLabelDescriptive } from './states-transitions.js';
import { Change, emit, subscribe } from './store.js';
import { triggerMath } from './theory.js';
import { filterStates, filterTransitions, renderMinimap } from './ui.js';
import { isAnyPDA, isAnyTM, showStatus } from './utils.js';

// A structural edit repaints the canvas and both side panels; a CANVAS change
// is a repaint only, since selection and highlight edits leave the formal
// definition and the panel contents correct.
subscribe(Change.GRAPH, renderAll);
subscribe(Change.GRAPH, updateLPanel);
subscribe(Change.GRAPH, updateRPanel);
subscribe(Change.CANVAS, renderAll);

// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
export function makeSVG(t) { return document.createElementNS(SVG_NS, t); }

export function renderAll() {
  const cfg = getMachineConfig(App.machine);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;
  invalidateRecursionCache();
  if (typeof pruneNoteAnchors === 'function') pruneNoteAnchors();
  if (typeof renderDividers === 'function') renderDividers();
  // Region rectangles are derived from their contents, and the arrow maths
  // below trims against them — so the layout pass has to run before anything
  // asks how big a node is.
  refreshLayout();
  renderSuperstates();
  renderTransitions(); renderStates();
  if (typeof renderNotes === 'function') renderNotes();
  renderMinimap();
  // domCache.states and .transitions are the renderer's own node registries now
  // — renderStates/renderTransitions add and evict entries as they diff, so
  // clearing and re-querying here would throw away the identity the diff needs.
  // Notes and dividers are still rebuilt wholesale by their modules, so their
  // caches are still refreshed from the DOM.
  App.domCache.notes.clear();
  App.domCache.dividers.clear();
  document.querySelectorAll('.note-g').forEach(el => App.domCache.notes.set(el.getAttribute('data-note-id'), el));
  document.querySelectorAll('.divider-g').forEach(el => App.domCache.dividers.set(el.getAttribute('data-divider-id'), el));
  if (App.activeNoteId && typeof highlightNoteAnchors === 'function') highlightNoteAnchors(App.activeNoteId, true);
  if (typeof applyEdgeDirectionHighlight === 'function') applyEdgeDirectionHighlight();
}

/**
 * Where an arrow's endpoint is drawn, given what is collapsed.
 *
 * An arrow into a state hidden by a collapsed region has to land on the region
 * that replaced it — otherwise it points at coordinates with nothing there.
 * This is the whole reason collapse is a rendering concern and not just a
 * visibility flag, and it is shared by the three places that resolve an edge:
 * groupTrans (what to draw), edgeGroupFor (what a click means) and
 * buildEdgeIndex (the per-frame geometry).
 *
 * Returns the identity function when nothing is collapsed, so the common case
 * pays one Map lookup and no allocation.
 */
export function edgeProjection() {
  if (!App.hiddenStates || !App.hiddenStates.size) return null;
  const byId = stateIndex(App.states);
  const cache = new Map();
  return id => {
    if (!App.hiddenStates.has(id)) return id;
    let v = cache.get(id);
    if (v === undefined) cache.set(id, v = visibleNodeOf(id, App.states, byId));
    return v;
  };
}

export function groupTrans() {
  const project = edgeProjection();
  const g = {};
  App.transitions.forEach(t => {
    const from = project ? project(t.from) : t.from;
    const to = project ? project(t.to) : t.to;
    // Both ends inside the same collapsed region: an internal arrow, and
    // showing it as a self-loop on the box would claim something about the
    // container that is really about a state it is not showing.
    if (from === to && (t.from !== t.to)) return;
    const k = from + '→' + to;
    if (!g[k]) g[k] = { from, to, ts: [] };
    g[k].ts.push(t);
  });
  return Object.values(g);
}

// Resolves an edge key back to the transitions it covers. The listeners below
// call this at event time rather than closing over a group object: a node now
// survives across renders, and grp.ts is rebuilt by groupTrans() on every one,
// so a captured group would act on transitions that no longer exist.
function edgeGroupFor(key) {
  const sep = key.indexOf('|');
  const fromId = key.slice(0, sep), toId = key.slice(sep + 1);
  // Through the same projection groupTrans drew with: an edge on a collapsed
  // region stands for every arrow whose endpoints project onto it, so clicking
  // it has to resolve to those rather than to the (nonexistent) transitions
  // literally between the two region ids.
  const project = edgeProjection();
  const ts = project
    ? App.transitions.filter(t => project(t.from) === fromId && project(t.to) === toId
      && !(project(t.from) === project(t.to) && t.from !== t.to))
    : App.transitions.filter(t => t.from === fromId && t.to === toId);
  if (!ts.length) return null;
  const from = getState(fromId), to = getState(toId);
  if (!from || !to) return null;
  return { from, to, ts, grp: { from: fromId, to: toId, ts } };
}

// Index of every from|to pair that carries a transition, plus the states by id.
// Built once per pass so the geometry below can ask "is there an edge the other
// way?" in O(1). Without it each edge scans App.transitions, which is what made
// dragging a large machine quadratic.
function buildEdgeIndex() {
  const stateById = new Map();
  for (const s of App.states) stateById.set(s.id, s);
  // Keyed by the pair as DRAWN, so the "is there an edge the other way?" test
  // that decides curvature agrees with what groupTrans actually put on screen.
  const project = edgeProjection();
  const tsByPair = new Map();
  for (const t of App.transitions) {
    const from = project ? project(t.from) : t.from;
    const to = project ? project(t.to) : t.to;
    if (from === to && t.from !== t.to) continue;
    const k = from + '|' + to;
    let arr = tsByPair.get(k);
    if (!arr) tsByPair.set(k, arr = []);
    arr.push(t);
  }
  return { stateById, tsByPair };
}

// A box is a state that invokes another component rather than consuming input
// itself. It is drawn as a rounded rectangle so that "this one delegates" reads
// at a glance, and it is sized from R so the radius setting still scales it.
export function nodeIsBox(s) { return !!(s && s.callee); }

// Half-extents of any node. Delegates to superstates.js so the three shapes —
// circle, box, region — are sized by one rule in one place; a region's rect is
// derived from what it contains, so it arrives through App.superRects.
export function boxHalf(s) { return nodeHalf(s, App.superRects); }

// True for the two rectangular shapes. Everything else is a circle of radius R,
// which is what the arrow maths assumed everywhere before boxes existed.
function nodeIsRect(s) { return nodeIsBox(s) || App.superRects.has(s && s.id); }

// Which components reach themselves, memoised for one render pass.
//
// syncStateNode asks per box, and the answer is the same for all of them, so
// without the memo a canvas of N boxes walks the call graph N times. Cleared at
// the top of renderAll rather than cached on a key: the graph is cheap to walk
// once and the alternative is a staleness bug the day someone edits a callee.
let _recBoxes = null;
export function invalidateRecursionCache() { _recBoxes = null; }
function recursiveBoxIds() {
  if (!_recBoxes) _recBoxes = recursiveComponentIds();
  return _recBoxes;
}

// Distance from a node's centre to its own boundary along a unit direction.
// This is the one place the "every node is a circle of radius R" assumption
// lived, so putting it behind a function is what lets an arrow trim correctly
// against a rectangle without touching any of the callers' maths.
function boundaryOffset(s, ux, uy) {
  if (!nodeIsRect(s)) return R;
  const { hw, hh } = boxHalf(s);
  const tx = ux ? Math.abs(hw / ux) : Infinity;
  const ty = uy ? Math.abs(hh / uy) : Infinity;
  return Math.min(tx, ty);
}

// Where a self-loop and the start arrow meet the node: the top and left edge
// respectively, which is R for a circle and the half-extent for a rectangle.
function topOffset(s) { return nodeIsRect(s) ? boxHalf(s).hh : R; }
function leftOffset(s) { return nodeIsRect(s) ? boxHalf(s).hw : R; }

// Which states are excluded from their container's measurement this pass.
//
// A state defining its region's boundary could otherwise never leave it: the
// region would grow to follow it forever. But a region being dragged WITH its
// contents has to keep its size. Both fall out of one rule — exclude only the
// members of the drag set whose own parent is not also being dragged, i.e. the
// top of the set.
function dragMeasureExclusion() {
  if (!App.dragOffsets || !App.superRects.size) return null;
  const ids = Object.keys(App.dragOffsets);
  if (!ids.length) return null;
  return new Set(topLevelOf(ids, App.states));
}

export function refreshLayout() {
  const exclude = dragMeasureExclusion();
  return refreshSuperRects(App.states, exclude ? { exclude } : undefined);
}

// Geometry for one edge. Split out because renderTransitions and updateFastDOM
// both need it, and because it is the part that changes every frame while a
// state is being dragged. `pairs` is the tsByPair map from buildEdgeIndex.
function edgeGeometry(from, to, ts, pairs) {
  const isSelf = from.id === to.id;
  if (isSelf) {
    const so = App.config.render.selfLoopOff, ss = App.config.render.selfLoopSize;
    const top = from.y - topOffset(from);
    const d = `M ${from.x - so} ${top} A ${ss} ${ss} 0 1 1 ${from.x + so} ${top}`;
    const arcCentY = top - Math.sqrt(ss * ss - so * so);
    return { isSelf, d, lx: from.x, ly: arcCentY - ss, mx: null, my: null, crvVal: 0 };
  }
  const hasRev = pairs
    ? pairs.has(to.id + '|' + from.id)
    : App.transitions.some(t => t.from === to.id && t.to === from.id);
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return null;
  const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;
  const defCrv = hasRev ? App.config.render.curveOff : 0;
  const crvVal = ts[0].curve !== undefined ? ts[0].curve : defCrv;
  const mx = (from.x + to.x) / 2 + px * crvVal, my = (from.y + to.y) / 2 + py * crvVal;
  const offFrom = boundaryOffset(from, ux, uy);
  const offTo = boundaryOffset(to, ux, uy) + App.config.render.arrowHeadSize;
  const sx = from.x + ux * offFrom, sy = from.y + uy * offFrom;
  const ex = to.x - ux * offTo, ey = to.y - uy * offTo;
  const d = crvVal ? `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`;
  const lx = crvVal ? (sx + 2 * mx + ex) / 4 : (sx + ex) / 2;
  const ly = crvVal ? (sy + 2 * my + ey) / 4 : (sy + ey) / 2;
  return { isSelf, d, lx, ly, mx, my, crvVal };
}

function isEdgeSelected(ts) {
  return ts.some(t => App.selectedTransitions.has(t.id));
}

// Clears selection classes the DOM is carrying directly. The edge handlers do
// this rather than re-rendering, so it has to reach the nodes the same way.
function clearSelectionClasses() {
  document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
}

// Creates the stable parts of an edge: the group, its two paths, its label, and
// its listeners. The label lives in #trans-lbl-g, not inside the group, so that
// every label paints above every edge.
function createEdgeNode(key) {
  const edgeGrp = makeSVG('g');
  edgeGrp.classList.add('edge-g');
  edgeGrp.setAttribute('data-edge', key);

  const pathEl = makeSVG('path');
  pathEl.classList.add('tarr');
  pathEl.setAttribute('marker-end', 'url(#arr)');
  edgeGrp.appendChild(pathEl);

  const hitEl = makeSVG('path');
  hitEl.classList.add('tarr-hit');
  edgeGrp.appendChild(hitEl);

  const textEl = makeSVG('text');
  textEl.classList.add('tlbl');
  textEl.setAttribute('id', `lbl-${key}`);
  textEl.setAttribute('dominant-baseline', 'central');
  textEl.setAttribute('text-anchor', 'middle');

  edgeGrp.__parts = { pathEl, hitEl, textEl, handle: null };
  edgeGrp.__labelKey = null;

  edgeGrp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (App.spacePan) return;
    e.stopPropagation();
    edgeGrp.dataset.lastPointerType = e.pointerType || 'mouse';
    const info = edgeGroupFor(key);
    if (!info) return;
    const { from, to, ts, grp } = info;
    if (App.tool === 'del') {
      snapshot();
      const ids = new Set(ts.map(t => t.id));
      App.transitions = App.transitions.filter(t => !ids.has(t.id));
      emit(Change.GRAPH);
      return;
    }
    if (App.tool === 'pointer') {
      const isSel = isEdgeSelected(ts);
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      // Focus moved to an edge — the highlighted state is no longer the thing
      // being read, so its lit edges would just be stale clutter.
      if (typeof clearEdgeDirectionHighlight === 'function') clearEdgeDirectionHighlight();
      if (!multi && !isSel) {
        App.selectedStates.clear();
        App.selectedTransitions.clear();
        clearSelectionClasses();
        ts.forEach(t => App.selectedTransitions.add(t.id));
        edgeGrp.classList.add('sel-t');
      } else if (multi) {
        if (isSel) {
          ts.forEach(t => App.selectedTransitions.delete(t.id));
          edgeGrp.classList.remove('sel-t');
          return;
        }
        ts.forEach(t => App.selectedTransitions.add(t.id));
        edgeGrp.classList.add('sel-t');
      }
      // A touch tap selects an edge. Only the explicit curve handle starts a
      // bend gesture; this avoids turning an ordinary tap into a drag.
      if (from.id !== to.id && e.pointerType !== 'touch') {
        App.dragCurve = { grp, from, to };
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
      }
    }
  });

  edgeGrp.addEventListener('dblclick', e => {
    if (App.tool !== 'pointer') return;
    if (edgeGrp.dataset.lastPointerType === 'touch') return;
    e.stopPropagation();
    const info = edgeGroupFor(key);
    if (info) openTransModal(info.from.id, info.to.id);
  });

  edgeGrp.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const info = edgeGroupFor(key);
    if (!info) return;
    const { from, to, ts } = info;
    App.ctxId = null;
    App.ctxMode = 'edge';
    App.ctxEdge = { from: from.id, to: to.id, transitionIds: ts.map(t => t.id), primaryId: ts[0]?.id || null };
    // If this edge is already part of a larger selection (e.g. built with
    // ctrl+click across states and edges), keep it intact — right-clicking
    // shouldn't collapse a combo selection down to just this one edge.
    if (!isEdgeSelected(ts)) {
      App.selectedStates.clear();
      App.selectedTransitions.clear();
      clearSelectionClasses();
      ts.forEach(t => App.selectedTransitions.add(t.id));
      edgeGrp.classList.add('sel-t');
    }
    showContextMenu('edge', e.clientX, e.clientY);
  });

  return edgeGrp;
}

// The curve handle only exists while the edge is selected: a visible grip at the
// control point, hinting that the edge can be bent.
function syncCurveHandle(edgeGrp, key, geo, selected) {
  const parts = edgeGrp.__parts;
  const wanted = selected && !geo.isSelf;
  if (wanted && !parts.handle) {
    const handle = makeSVG('circle');
    handle.classList.add('curve-handle');
    handle.setAttribute('r', 7);
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || App.spacePan || App.tool !== 'pointer') return;
      e.stopPropagation();
      const info = edgeGroupFor(key);
      if (!info) return;
      App.dragCurve = { grp: info.grp, from: info.from, to: info.to };
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
    });
    edgeGrp.appendChild(handle);
    parts.handle = handle;
  } else if (!wanted && parts.handle) {
    parts.handle.remove();
    parts.handle = null;
  }
  if (parts.handle) {
    parts.handle.setAttribute('cx', geo.mx);
    parts.handle.setAttribute('cy', geo.my);
  }
}

function syncEdgeNode(edgeGrp, from, to, ts, pairs) {
  const geo = edgeGeometry(from, to, ts, pairs);
  if (!geo) return false;
  const parts = edgeGrp.__parts;
  const selected = isEdgeSelected(ts);

  edgeGrp.classList.toggle('sel-t', selected);
  parts.pathEl.setAttribute('d', geo.d);
  parts.hitEl.setAttribute('d', geo.d);

  const lbls = ts.map(transLabel);
  // Rebuild the tspans only when the label text changes. Geometry changes —
  // a state moving, an edge bending — just reposition them, so dragging
  // allocates nothing.
  const labelKey = lbls.join('\u0001');
  if (edgeGrp.__labelKey !== labelKey) {
    parts.textEl.innerHTML = '';
    lbls.forEach((lbl, i) => {
      const tspan = makeSVG('tspan');
      tspan.textContent = lbl;
      tspan.setAttribute('x', geo.lx);
      tspan.setAttribute('dy', i === 0 ? `-${(lbls.length - 1) * 0.6}em` : '1.2em');
      parts.textEl.appendChild(tspan);
    });
    edgeGrp.__labelKey = labelKey;
    edgeGrp.__labelX = geo.lx;
  } else if (edgeGrp.__labelX !== geo.lx) {
    for (const tspan of parts.textEl.childNodes) tspan.setAttribute('x', geo.lx);
    edgeGrp.__labelX = geo.lx;
  }
  parts.textEl.setAttribute('x', geo.lx);
  parts.textEl.setAttribute('y', geo.ly);

  const edgeTip = ts.map(t => transLabelDescriptive(t)).join('\n');
  edgeGrp.setAttribute('data-tip', edgeTip);
  edgeGrp.setAttribute('aria-label', edgeTip);

  syncCurveHandle(edgeGrp, edgeGrp.getAttribute('data-edge'), geo, selected);
  return true;
}

// The start-state arrow is a single node, kept in the same registry style as
// the edges so renderAll no longer has to re-query for it.
function syncStartArrow(g) {
  const s = App.startId ? getState(App.startId) : null;
  if (!s) {
    if (App.domCache.startArrow) {
      App.domCache.startArrow.remove();
      App.domCache.startArrow = null;
    }
    return;
  }
  let a = App.domCache.startArrow;
  if (!a) {
    a = makeSVG('path');
    a.setAttribute('data-start-arrow', 'true');
    a.setAttribute('stroke', 'var(--green)');
    a.setAttribute('stroke-width', '1.5');
    a.setAttribute('fill', 'none');
    a.setAttribute('marker-end', 'url(#arr-g)');
    App.domCache.startArrow = a;
  }
  const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
  const off = leftOffset(s);
  a.setAttribute('d', `M ${s.x - off - al} ${s.y} L ${s.x - off - ah / 3} ${s.y}`);
  // Always first in paint order, behind every edge.
  if (a !== g.firstChild) g.insertBefore(a, g.firstChild);
}

export function renderTransitions() {
  const g = $('trans-g');
  const lg = $('trans-lbl-g');
  const live = App.domCache.transitions;
  const { tsByPair } = buildEdgeIndex();

  syncStartArrow(g);

  let prev = App.domCache.startArrow || null;
  const seen = new Set();
  for (const grp of groupTrans()) {
    const from = getState(grp.from), to = getState(grp.to);
    if (!from || !to) continue;
    const key = from.id + '|' + to.id;
    let node = live.get(key);
    if (!node) {
      node = createEdgeNode(key);
      live.set(key, node);
    }
    if (!syncEdgeNode(node, from, to, grp.ts, tsByPair)) continue;
    seen.add(key);

    const expected = prev ? prev.nextSibling : g.firstChild;
    if (node !== expected) g.insertBefore(node, expected);
    prev = node;

    // Labels are siblings in their own layer, so they need placing separately.
    const textEl = node.__parts.textEl;
    if (lg) {
      if (textEl.parentNode !== lg) lg.appendChild(textEl);
    } else if (textEl.parentNode !== node) {
      node.appendChild(textEl);
    }
  }

  for (const [key, node] of live) {
    if (seen.has(key)) continue;
    node.__parts.textEl.remove();
    node.remove();
    live.delete(key);
  }
}

// Runs on every animation frame while dragging, so it only touches geometry —
// no classes, no labels, no node creation.
//
// It shares edgeGeometry() with renderTransitions rather than keeping a second
// copy of the curve maths, and reaches child elements through the __parts
// references the renderer already holds instead of running a querySelector per
// node per frame. buildEdgeIndex keeps the "is there an edge the other way?"
// lookup O(1); without it each frame is O(edges x transitions).
export function updateFastDOM() {
  // Regions resize as their contents move, so their geometry is part of the
  // per-frame work rather than something only a full render establishes.
  const rects = App.superRects.size || App.states.some(isSuperstate) ? refreshLayout() : App.superRects;
  const { stateById, tsByPair } = buildEdgeIndex();
  const isMoore = App.machine === 'Moore';

  if (rects.size) {
    const idx = childIndex(App.states);
    const showAccepts = acceptsAreShown();
    for (const [id, rect] of rects) {
      const node = App.domCache.supers.get(id);
      const s = stateById.get(id);
      if (!node || !s) continue;
      // stateById is already an id → state index; passing it stops defaultEntry
      // rebuilding one per region per frame.
      syncSuperNode(node, s, rect, stateById.get(defaultEntry(id, App.states, idx, stateById)), showAccepts, idx);
    }
  }

  for (const s of App.states) {
    if (rects.has(s.id)) continue;
    const grp = App.domCache.states.get(s.id);
    if (!grp || !grp.__parts) continue;
    const p = grp.__parts;
    // The shape is a <rect> for a box, so this cannot just write cx/cy — a rect
    // ignores them silently and the box stays behind while its edges follow.
    const isBox = nodeIsBox(s);
    const half = isBox ? boxHalf(s) : null;
    if (isBox) {
      p.shape.setAttribute('x', s.x - half.hw);
      p.shape.setAttribute('y', s.y - half.hh);
      if (p.ring) {
        p.ring.setAttribute('x', s.x - half.hw + 4);
        p.ring.setAttribute('y', s.y - half.hh + 4);
      }
      if (p.callee) {
        p.callee.setAttribute('x', s.x);
        p.callee.setAttribute('y', s.y + 13);
      }
    } else {
      p.shape.setAttribute('cx', s.x);
      p.shape.setAttribute('cy', s.y);
      if (p.ring) {
        p.ring.setAttribute('cx', s.x);
        p.ring.setAttribute('cy', s.y);
      }
    }
    p.label.setAttribute('x', s.x);
    p.label.setAttribute('y', isMoore ? s.y - App.config.render.textMargin : (isBox ? s.y - 7 : s.y));
    if (grp.__labelX !== s.x) {
      for (const tspan of p.label.childNodes) tspan.setAttribute('x', s.x);
      grp.__labelX = s.x;
    }
    if (p.moore) {
      p.moore.setAttribute('x', s.x);
      p.moore.setAttribute('y', s.y + App.config.render.mooreTextMargin);
    }
    // Geometry only — the text is unchanged by a drag, so this reuses the
    // cached tspans rather than rebuilding them every frame.
    if (p.actions) syncActionLabel(grp, p, s);
  }

  const startArrow = App.domCache.startArrow;
  if (startArrow && App.startId) {
    const s = stateById.get(App.startId);
    if (s) {
      const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
      const off = leftOffset(s);
      startArrow.setAttribute('d', `M ${s.x - off - al} ${s.y} L ${s.x - off - ah / 3} ${s.y}`);
    }
  }

  for (const [key, edgeGrp] of App.domCache.transitions) {
    const p = edgeGrp.__parts;
    if (!p) continue;
    const sep = key.indexOf('|');
    const from = stateById.get(key.slice(0, sep));
    const to = stateById.get(key.slice(sep + 1));
    const ts = tsByPair.get(key);
    if (!from || !to || !ts) continue;

    const geo = edgeGeometry(from, to, ts, tsByPair);
    if (!geo) continue;

    p.pathEl.setAttribute('d', geo.d);
    p.hitEl.setAttribute('d', geo.d);
    p.textEl.setAttribute('x', geo.lx);
    p.textEl.setAttribute('y', geo.ly);
    if (edgeGrp.__labelX !== geo.lx) {
      for (const tspan of p.textEl.childNodes) tspan.setAttribute('x', geo.lx);
      edgeGrp.__labelX = geo.lx;
    }
    if (p.handle) {
      p.handle.setAttribute('cx', geo.mx);
      p.handle.setAttribute('cy', geo.my);
    }
  }

  // Anchored notes ride along with the states/edges they're pinned to.
  if (typeof updateNotesDOM === 'function') updateNotesDOM();
}

// Break a state name into per-line words at underscore/space/hyphen
// boundaries, e.g. "NEW_ACCOUNT_OPENED" -> ["NEW","ACCOUNT","OPENED"],
// so long descriptive names stack inside the fixed-radius circle
// instead of overflowing it. Names with no such boundary are left as
// a single line untouched.
export function splitStateLabel(name) {
  if (!App.config.wrapStateLabels) return [String(name)];
  const parts = String(name).split(/[_\s-]+/).filter(Boolean);
  return parts.length > 1 ? parts : [String(name)];
}

// Writes `lines` into `textEl` as centered tspans and returns the line
// count, so callers can size the font to fit the circle.
export function setStateLabelLines(textEl, lines, cx) {
  textEl.innerHTML = '';
  const lineH = 1.05;
  lines.forEach((line, i) => {
    const tspan = makeSVG('tspan');
    tspan.textContent = line;
    tspan.setAttribute('x', cx);
    tspan.setAttribute('dy', i === 0 ? `-${(lines.length - 1) * lineH / 2}em` : `${lineH}em`);
    textEl.appendChild(tspan);
  });
  textEl.setAttribute('font-size', lines.length >= 4 ? '8.5px' : lines.length === 3 ? '9.5px' : '11px');
}

// True when accept marks are meaningful for the current machine. Transducers
// have no accepting states unless the setting says otherwise.
function acceptsAreShown() {
  return !(getMachineConfig(App.machine).isTransducer && !App.config.transducerAccepts);
}

// Builds the parts of a state node that never change: the group, its circle and
// label, and its event listeners.
//
// Listeners are attached exactly once, at creation, and resolve everything they
// need from App at event time. They must not close over the state record or
// over derived values like acceptsAreShown() — a node now outlives the render
// that made it, so a captured value goes stale the moment the state is renamed
// or the machine type changes.
// Listeners are attached once, at node creation, and outlive every later
// render — so they resolve the state by id at event time and never close over
// per-render data. Shared by both node shapes: a box selects, drags, deletes
// and opens its context menu exactly like a state, and duplicating this block
// per shape is how the two would drift apart.
function attachNodeListeners(g, id) {
  g.addEventListener('pointerdown', e => {
    g.dataset.lastPointerType = e.pointerType || 'mouse';
    onStateDown(e, id);
  });

  g.addEventListener('contextmenu', e => {
    e.preventDefault();
    App.ctxId = id;
    App.ctxEdge = null;
    App.ctxMode = 'state';
    const toggleOpt = $('ctx-toggle-acc');
    const renameLbl = document.querySelector('#ctx-rename .ctx-label');
    if (toggleOpt) toggleOpt.style.display = acceptsAreShown() ? '' : 'none';
    if (renameLbl) renameLbl.textContent = (App.machine === 'Moore' || App.machine === 'Mealy') ? 'Configure' : 'Rename';

    // The hierarchy entries split along the two families: containment (regions)
    // is offered by every hierarchical model, reference (sub-machines) only by
    // the one with a call stack. The pair of conversions between them is the
    // REG↔CFL toggle, which is why both are on the same menu.
    const s = getState(id);
    const isBox = nodeIsBox(s);
    const isRegion = App.superRects.has(id);
    const row = (rowId, on) => { const el = $(rowId); if (el) el.style.display = on ? '' : 'none'; };

    const promoteLbl = document.querySelector('#ctx-promote .ctx-label');
    row('ctx-promote', hasCallStack() && !isRegion);
    if (promoteLbl) promoteLbl.textContent = isBox ? 'Convert to Plain State' : 'Convert to Sub-machine';
    row('ctx-open-sub', hasCallStack() && isBox);
    // Offered on regions too. Nesting one region inside another is how an
    // orthogonal region is built ("group each concurrent part first"), and
    // hiding this row on exactly the nodes that instruction produces left that
    // workflow with no direct path at all.
    row('ctx-group', hasSuperstates() && !isBox);
    row('ctx-ungroup', hasSuperstates() && isRegion);
    // Collapse is a VIEW change and Ungroup is an edit, so they sit next to
    // each other deliberately: the menu is where the difference between
    // "show me less" and "mean something else" has to be legible.
    row('ctx-collapse', hasSuperstates() && isRegion);
    const collapseLbl = $('ctx-collapse-lbl');
    if (collapseLbl) collapseLbl.textContent = isCollapsed(s) ? 'Expand Region' : 'Collapse Region';
    // Only meaningful when the region's children are themselves regions —
    // orthogonality decomposes into concurrent regions, not concurrent states.
    const kidsAreRegions = isRegion &&
      childIndex(App.states).get(s.id)?.length > 1 &&
      childIndex(App.states).get(s.id).every(isSuperstate);
    row('ctx-parallel', hasSuperstates() && isRegion && (s.parallel || kidsAreRegions));
    const parLbl = $('ctx-parallel-lbl');
    if (parLbl) parLbl.textContent = s && s.parallel ? 'Make Ordinary (OR)' : 'Make Orthogonal (AND)';
    // Both directions of the toggle: a region becomes a component, a component
    // is inlined back into a region — the second refusing when it recurses.
    row('ctx-extract', hasCallStack() && isRegion);
    row('ctx-inline', hasSuperstates() && isBox);
    row('ctx-default-entry', hasSuperstates() && !!(s && s.parent));
    showContextMenu('state', e.clientX, e.clientY);
  });

  g.addEventListener('dblclick', () => {
    if (g.dataset.lastPointerType === 'touch') return;
    // On a box, a double click means "open me" — the accept flag belongs to the
    // component's exit nodes, not to the call site.
    const s = getState(id);
    if (nodeIsBox(s)) { descendIntoBox(id); return; }
    // On a region's title band, the same gesture means the same thing: show me
    // what is inside. The two families' containers now answer double-click
    // alike, which is the point of borrowing the collapsed form at all.
    if (isSuperstate(s)) { toggleRegionCollapsed(id); return; }
    if (!acceptsAreShown()) return;
    App.accepts.has(id) ? App.accepts.delete(id) : App.accepts.add(id);
    commit();
  });
}

// `kind` is baked into the node because the two shapes are different elements.
// renderStates evicts and rebuilds when it changes — see the note there.
function createStateNode(id, kind) {
  const g = makeSVG('g');
  g.classList.add('sn');
  if (kind === 'box') g.classList.add('sn-box');
  g.setAttribute('data-id', id);
  g.__kind = kind;

  const shape = makeSVG(kind === 'box' ? 'rect' : 'circle');
  shape.classList.add('bd');
  if (kind === 'box') shape.setAttribute('rx', 10);
  g.appendChild(shape);

  const label = makeSVG('text');
  label.classList.add('slbl');
  g.appendChild(label);

  // Child references, so syncing never has to query the subtree.
  g.__parts = { shape, label, ring: null, moore: null, callee: null };
  // Inputs the label tspans were last built from, so they are only rebuilt when
  // one of them actually changes.
  g.__labelKey = null;

  attachNodeListeners(g, id);
  return g;
}

// Writes the current value of every visual property onto an existing node.
//
// Attribute and class writes are unconditional. They are cheap and idempotent,
// and — more to the point — canvas.js and the edge handlers toggle sel-st on
// these nodes directly, so a "what did we render last time" cache would drift
// out of step with the DOM and leave selection highlights stuck. Only the label
// tspans, the one genuinely expensive part, are guarded by a key.
function syncStateNode(g, s, showAccepts) {
  const parts = g.__parts;
  const isStart = App.startId === s.id;
  const isAcc = showAccepts && App.accepts.has(s.id);

  g.classList.toggle('start-st', isStart);
  g.classList.toggle('sel-st', App.selectedStates.has(s.id));
  g.classList.toggle('acc-st', isAcc);
  // Dead/unreachable overlay (set by Dead State Analysis algo)
  const cls = App.stateClassification ? App.stateClassification.get(s.id) : null;
  g.classList.toggle('unreachable-st', cls === 'unreachable');
  g.classList.toggle('dead-st', cls === 'dead');

  const isBox = nodeIsBox(s);
  const half = isBox ? boxHalf(s) : null;
  g.classList.toggle('box-st', isBox);

  if (isBox) {
    parts.shape.setAttribute('x', s.x - half.hw);
    parts.shape.setAttribute('y', s.y - half.hh);
    parts.shape.setAttribute('width', half.hw * 2);
    parts.shape.setAttribute('height', half.hh * 2);
  } else {
    parts.shape.setAttribute('cx', s.x);
    parts.shape.setAttribute('cy', s.y);
    parts.shape.setAttribute('r', R);
  }

  if (isAcc && !parts.ring) {
    const ring = makeSVG(isBox ? 'rect' : 'circle');
    ring.classList.add('acc-ring');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--gold)');
    ring.setAttribute('stroke-width', '1.5');
    if (isBox) ring.setAttribute('rx', 7);
    g.insertBefore(ring, parts.label);
    parts.ring = ring;
  } else if (!isAcc && parts.ring) {
    parts.ring.remove();
    parts.ring = null;
  }
  if (parts.ring) {
    if (isBox) {
      parts.ring.setAttribute('x', s.x - half.hw + 4);
      parts.ring.setAttribute('y', s.y - half.hh + 4);
      parts.ring.setAttribute('width', Math.max(0, half.hw * 2 - 8));
      parts.ring.setAttribute('height', Math.max(0, half.hh * 2 - 8));
    } else {
      parts.ring.setAttribute('cx', s.x);
      parts.ring.setAttribute('cy', s.y);
      parts.ring.setAttribute('r', R - 5);
    }
  }

  // A box names the component it invokes underneath its own name, so a canvas
  // full of boxes reads as call sites rather than as opaque rectangles.
  if (isBox && !parts.callee) {
    const ct = makeSVG('text');
    ct.classList.add('callee-lbl');
    g.appendChild(ct);
    parts.callee = ct;
  } else if (!isBox && parts.callee) {
    parts.callee.remove();
    parts.callee = null;
  }
  const callee = isBox ? getComponent(s.callee) : null;
  const calleeName = isBox ? (callee?.name || '?') : null;
  if (parts.callee) {
    parts.callee.setAttribute('x', s.x);
    parts.callee.setAttribute('y', s.y + 13);
    // The component's name, and — borrowed from the region's default-entry
    // marker — where a call actually lands. A region shows its entry point with
    // a dot and an arm; a box showed nothing at all, so the one question you
    // have about a call site ("where does this go?") could only be answered by
    // navigating into it and losing your place.
    const entry = callee?.states?.find(st => st.id === callee.startId);
    const txt = entry ? `${calleeName} → ${entry.name}` : calleeName;
    if (parts.callee.textContent !== txt) parts.callee.textContent = txt;
  }
  // A box whose component reaches itself is the reason this machine needs a
  // stack — the single most important fact about an RSM diagram, and previously
  // indistinguishable from any other box. Same move orthogonality makes: mark
  // the one that changes the language class.
  g.classList.toggle('rec-box', isBox && recursiveBoxIds().has(s.callee));

  const isMoore = App.machine === 'Moore';
  const labelDy = isMoore ? -App.config.render.textMargin : (isBox ? -7 : 0);
  parts.label.setAttribute('x', s.x);
  parts.label.setAttribute('y', s.y + labelDy);
  // As above: the tspans say the state's name, which a move does not change.
  const labelKey = `${s.name}\u0001${App.config.wrapStateLabels}`;
  if (g.__labelKey !== labelKey) {
    setStateLabelLines(parts.label, splitStateLabel(s.name), s.x);
    g.__labelKey = labelKey;
    g.__labelX = s.x;
  } else if (g.__labelX !== s.x) {
    for (const tspan of parts.label.childNodes) tspan.setAttribute('x', s.x);
    g.__labelX = s.x;
  }

  if (isMoore && !parts.moore) {
    const ot = makeSVG('text');
    ot.classList.add('mooreout');
    g.appendChild(ot);
    parts.moore = ot;
  } else if (!isMoore && parts.moore) {
    parts.moore.remove();
    parts.moore = null;
  }
  if (parts.moore) {
    parts.moore.setAttribute('x', s.x);
    parts.moore.setAttribute('y', s.y + App.config.render.mooreTextMargin);
    parts.moore.textContent = s.output !== undefined && s.output !== '' ? s.output : '—';
  }

  // Entry/exit actions, in the statechart's own notation, under the node.
  //
  // A Moore machine got a dedicated tspan for its output the moment it existed,
  // and an action is the same kind of thing: a side effect attached to being in
  // a state. Without it, a state carrying `entry / drawWeapon` is pixel-
  // identical to one carrying nothing, and the example built to show that a
  // region is a SCOPE draws a picture in which the thing being scoped is
  // invisible — readable only by opening every state's dialog one at a time.
  syncActionLabel(g, parts, s);

  // An accept ring means two different things depending on where you are
  // standing: in the ROOT it means accept, and in a sub-machine it means
  // "return to my caller". They were drawn identically, so the canvas gave no
  // way to tell — and "exits(c) are c.accepts" is the load-bearing half of the
  // call semantics. Borrowed from the region, which does mark its boundary.
  const inSub = hasCallStack() && !!App.rootComponentId &&
    activeComponentId() !== App.rootComponentId;
  g.classList.toggle('exit-st', isAcc && inSub);

  let stTitle = isBox ? `Box '${s.name}' — invokes ${calleeName}` : `State '${s.name}'`;
  if (isStart || isAcc) {
    const statuses = [];
    if (isStart) statuses.push(inSub ? 'Entry' : 'Start');
    if (isAcc) statuses.push(inSub ? 'Exit — returns to caller' : 'Accept');
    stTitle += ` (${statuses.join(', ')})`;
  }
  if (isMoore) {
    const o = s.output !== undefined && s.output !== '' ? s.output : App.config.sym.lambda;
    stTitle += `\nOutput: '${o}'`;
  }
  g.setAttribute('data-tip', stTitle);
  g.setAttribute('aria-label', stTitle);
}

/**
 * The `entry / act` and `exit / act` lines under a node, created on demand and
 * removed when the actions are.
 *
 * Cache-keyed like the state label, and for the same reason: rebuilding tspans
 * is the expensive part of a render, and a node that merely moved has not
 * changed what it does.
 *
 * Shared by plain states and regions — `y` is the caller's business, since a
 * region hangs them under its title band rather than under its centre.
 */
export function syncActionLabel(g, parts, s, x, y) {
  const lines = [];
  if (s.entry) lines.push(`entry / ${s.entry}`);
  if (s.exit) lines.push(`exit / ${s.exit}`);

  if (!lines.length) {
    if (parts.actions) { parts.actions.remove(); parts.actions = null; g.__actKey = null; }
    return;
  }
  if (!parts.actions) {
    const t = makeSVG('text');
    t.classList.add('st-actions');
    g.appendChild(t);
    parts.actions = t;
    g.__actKey = null;
  }
  const px = x === undefined ? s.x : x;
  const py = y === undefined ? s.y + nodeHalf(s, App.superRects).hh + 13 : y;
  const key = lines.join('');
  if (g.__actKey !== key) {
    parts.actions.textContent = '';
    lines.forEach((line, i) => {
      const tspan = makeSVG('tspan');
      tspan.setAttribute('x', px);
      tspan.setAttribute('dy', i === 0 ? 0 : 11);
      tspan.textContent = line;
      parts.actions.appendChild(tspan);
    });
    g.__actKey = key;
    g.__actX = px;
  } else if (g.__actX !== px) {
    for (const tspan of parts.actions.childNodes) tspan.setAttribute('x', px);
    g.__actX = px;
  }
  parts.actions.setAttribute('x', px);
  parts.actions.setAttribute('y', py);
}

// ══════════════════════════════════════════════════════════════════
//  SUPERSTATE CONTAINERS
// ══════════════════════════════════════════════════════════════════
// Drawn in their own layer, under the edges, and diffed by id the same way
// states and edges are.
//
// Only the title band takes pointer events. The body is deliberately
// click-through: a container that swallowed clicks over its whole area would
// make every state inside it unreachable, and would capture the empty-canvas
// gestures (marquee, double-click-to-add) that happen to land in the gaps. That
// one CSS rule is what makes containment hit-testing a non-problem rather than
// the hard part it looks like.
function createSuperNode(id) {
  const g = makeSVG('g');
  // `sn` as well as `super-st`, so every selection path that already exists —
  // hlState, the .sn.sel-st sweep in canvas.js, the [data-id] lookups — keeps
  // working on a region without knowing what one is.
  g.classList.add('sn', 'super-st');
  g.setAttribute('data-id', id);
  g.__kind = 'super';

  const body = makeSVG('rect');
  body.classList.add('super-body');
  body.setAttribute('rx', 14);
  g.appendChild(body);

  // A path rather than a rect: the band has to round off at the top to sit
  // flush inside the body's corners, and square off at the bottom where it
  // meets the interior.
  const head = makeSVG('path');
  head.classList.add('super-head');
  g.appendChild(head);

  const label = makeSVG('text');
  label.classList.add('super-lbl');
  g.appendChild(label);

  // The statechart notation for a default entry: a filled dot with a short arm
  // pointing at the child that a transition into this region actually reaches.
  const initDot = makeSVG('circle');
  initDot.classList.add('super-init');
  initDot.setAttribute('r', 4);
  g.appendChild(initDot);

  const initArm = makeSVG('path');
  initArm.classList.add('super-init-arm');
  initArm.setAttribute('marker-end', 'url(#arr)');
  g.appendChild(initArm);

  // The dashed separators of an orthogonal region. One path for all of them:
  // they are decoration on a single node, never hit-tested, and rebuilding one
  // `d` string is cheaper than diffing a line per boundary.
  const lanes = makeSVG('path');
  lanes.classList.add('super-lanes');
  g.appendChild(lanes);

  // The collapse control, on the title band because that is the only part of a
  // region that takes pointer events. A triangle rather than a glyph so it can
  // be rotated in place: one path, two orientations.
  const twisty = makeSVG('path');
  twisty.classList.add('super-twisty');
  twisty.setAttribute('d', 'M -3.5 -4.5 L 4 0 L -3.5 4.5 Z');
  g.appendChild(twisty);

  // What a collapsed region is standing in for. It replaces the contents, so it
  // has to say something about them — an unlabelled box is the RSM box's worst
  // property, not one worth borrowing.
  const summary = makeSVG('text');
  summary.classList.add('super-summary');
  g.appendChild(summary);

  g.__parts = { body, head, label, initDot, initArm, lanes, twisty, summary };
  attachNodeListeners(g, id);

  // Toggling is on the twisty itself, and stopPropagation keeps it from
  // reaching the band's drag handler underneath.
  twisty.addEventListener('pointerdown', e => {
    e.stopPropagation();
    e.preventDefault();
    toggleRegionCollapsed(id);
  });
  return g;
}

/**
 * Where to draw the dashed separators inside an orthogonal region.
 *
 * The regions are laid out by hand, so there is no row/column to read off —
 * the dominant axis is inferred from how the child centres are spread, and a
 * separator goes midway between each adjacent pair of facing edges. Which means
 * dragging one region past another re-flows the dividers rather than leaving
 * them describing a layout that no longer exists.
 */
function laneDividers(s, rect, idx) {
  const kids = (idx.get(s.id) || [])
    .map(k => App.superRects.get(k.id))
    .filter(Boolean);
  if (kids.length < 2) return '';

  const cx = kids.map(r => r.x + r.w / 2);
  const cy = kids.map(r => r.y + r.h / 2);
  // Side-by-side regions want vertical rules; stacked ones want horizontal.
  const vertical = (Math.max(...cx) - Math.min(...cx)) >= (Math.max(...cy) - Math.min(...cy));
  const sorted = [...kids].sort((a, b) => (vertical ? a.x - b.x : a.y - b.y));

  const headH = Math.min(App.config.superstate.head, rect.h);
  const d = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (vertical) {
      const x = (a.x + a.w + b.x) / 2;
      d.push(`M ${x} ${rect.y + headH} L ${x} ${rect.y + rect.h}`);
    } else {
      const y = (a.y + a.h + b.y) / 2;
      d.push(`M ${rect.x} ${y} L ${rect.x + rect.w} ${y}`);
    }
  }
  return d.join(' ');
}

function syncSuperNode(g, s, rect, entryState, showAccepts, idx) {
  const p = g.__parts;
  const headH = Math.min(App.config.superstate.head, rect.h);
  const par = isParallel(s);

  g.classList.toggle('start-st', App.startId === s.id);
  g.classList.toggle('sel-st', App.selectedStates.has(s.id));
  g.classList.toggle('acc-st', showAccepts && App.accepts.has(s.id));
  g.classList.toggle('par-st', par);
  // Same overlay a plain state gets from Dead State Analysis. A region can be
  // unreachable exactly as a state can, and leaving it out made the one node
  // shape big enough to notice the only one the overlay ignored.
  const cls = App.stateClassification ? App.stateClassification.get(s.id) : null;
  g.classList.toggle('unreachable-st', cls === 'unreachable');
  g.classList.toggle('dead-st', cls === 'dead');

  p.body.setAttribute('x', rect.x);
  p.body.setAttribute('y', rect.y);
  p.body.setAttribute('width', rect.w);
  p.body.setAttribute('height', rect.h);

  const cr = Math.min(14, rect.w / 2, headH);
  p.head.setAttribute('d',
    `M ${rect.x} ${rect.y + cr} a ${cr} ${cr} 0 0 1 ${cr} ${-cr}` +
    ` h ${rect.w - 2 * cr} a ${cr} ${cr} 0 0 1 ${cr} ${cr}` +
    ` v ${headH - cr} h ${-rect.w} Z`);

  p.label.setAttribute('x', rect.x + 12);
  p.label.setAttribute('y', rect.y + headH / 2);
  if (p.label.textContent !== s.name) p.label.textContent = s.name;

  const closed = isCollapsed(s);
  g.classList.toggle('closed-st', closed);

  const lanes = par && !closed ? laneDividers(s, rect, idx) : '';
  p.lanes.style.display = lanes ? '' : 'none';
  if (lanes) p.lanes.setAttribute('d', lanes);

  // Under the title band rather than under the centre: a region's centre is in
  // the middle of its contents, and these belong to the container.
  syncActionLabel(g, p, s, rect.x + 12, rect.y + headH + 12);

  // The twisty sits at the right end of the band, pointing down when open and
  // right when closed — the direction the contents will go.
  p.twisty.setAttribute('transform',
    `translate(${rect.x + rect.w - 14} ${rect.y + headH / 2}) rotate(${closed ? 0 : 90})`);

  // What the box is standing in for, when it is standing in for anything.
  const hiddenCount = closed ? subtreeIds(s.id, App.states).length - 1 : 0;
  p.summary.style.display = closed ? '' : 'none';
  if (closed) {
    p.summary.setAttribute('x', rect.x + rect.w / 2);
    p.summary.setAttribute('y', rect.y + headH + (rect.h - headH) / 2);
    const txt = `${hiddenCount} state${hiddenCount === 1 ? '' : 's'} hidden`;
    if (p.summary.textContent !== txt) p.summary.textContent = txt;
  }

  // The marker only means anything when there is somewhere to enter — and an
  // orthogonal region enters ALL of its children at once, so pointing an arrow
  // at one of them would draw a claim the simulator does not make. A collapsed
  // region has no visible child to point at either.
  const show = !par && !closed && !!entryState && entryState.id !== s.id;
  p.initDot.style.display = show ? '' : 'none';
  p.initArm.style.display = show ? '' : 'none';
  if (show) {
    const { hh } = boxHalf(entryState);
    const top = entryState.y - hh;
    const dotY = Math.max(rect.y + headH + 8, top - 22);
    p.initDot.setAttribute('cx', entryState.x);
    p.initDot.setAttribute('cy', dotY);
    p.initArm.setAttribute('d', `M ${entryState.x} ${dotY + 4} L ${entryState.x} ${top - App.config.render.arrowHeadSize / 2}`);
  }

  const kidCount = (idx?.get(s.id) || []).length;
  const tip = closed
    ? `Region '${s.name}' — collapsed\n${hiddenCount} state${hiddenCount === 1 ? '' : 's'} hidden. Click the arrow, or double-click the title, to expand.\nThe machine is unchanged: collapsing shows less, it does not mean less.`
    : par
      ? `Orthogonal region '${s.name}'\n${kidCount} regions run concurrently — all entered at once`
      : `Region '${s.name}'${entryState && entryState.id !== s.id ? `\nEnters at '${entryState.name}'` : ''}`;
  g.setAttribute('data-tip', tip);
  g.setAttribute('aria-label', tip);
}

export function renderSuperstates() {
  const g = $('supers-g');
  if (!g) return;
  const live = App.domCache.supers;
  const showAccepts = acceptsAreShown();
  const idx = childIndex(App.states);
  const byId = stateIndex(App.states);

  // Outermost first, so a nested region paints on top of the one containing it.
  const regions = App.states.filter(s => App.superRects.has(s.id));
  const depth = depthIndex(App.states, byId);
  regions.sort((a, b) => (depth.get(a.id) || 0) - (depth.get(b.id) || 0));

  let prev = null;
  const seen = new Set();
  for (const s of regions) {
    seen.add(s.id);
    let node = live.get(s.id);
    if (!node) { node = createSuperNode(s.id); live.set(s.id, node); }
    const entryId = defaultEntry(s.id, App.states, idx, byId);
    syncSuperNode(node, s, App.superRects.get(s.id), byId.get(entryId), showAccepts, idx);
    const expected = prev ? prev.nextSibling : g.firstChild;
    if (node !== expected) g.insertBefore(node, expected);
    prev = node;
  }

  for (const [id, node] of live) {
    if (seen.has(id)) continue;
    node.remove();
    live.delete(id);
  }
}

export function renderStates() {
  const g = $('states-g');
  const live = App.domCache.states;
  const showAccepts = acceptsAreShown();

  // Walk App.states in order, reusing the node for each id and moving it only
  // if it is not already where it belongs. `expected` is the node that should
  // occupy the next slot, so an unchanged list performs no DOM writes here.
  let prev = null;
  const seen = new Set();
  for (const s of App.states) {
    // Regions live in #supers-g, drawn by renderSuperstates. Leaving one out of
    // `seen` is also what evicts the circle a plain state had before it was
    // grouped — same eviction the box/state split needs, for the same reason.
    if (App.superRects.has(s.id)) continue;
    // Inside something collapsed: not drawn, and evicted for the same reason.
    if (App.hiddenStates.has(s.id)) continue;
    seen.add(s.id);
    const kind = nodeIsBox(s) ? 'box' : 'state';
    let node = live.get(s.id);
    // Promoting a state to a box keeps its id, so the diff would happily reuse
    // the circle forever — a <circle> quietly ignoring x/y/width/height, with
    // nothing thrown and nothing logged. The kind is part of the node's
    // identity, so a change to it has to evict rather than sync.
    if (node && node.__kind !== kind) {
      node.remove();
      live.delete(s.id);
      node = null;
    }
    if (!node) {
      node = createStateNode(s.id, kind);
      live.set(s.id, node);
    }
    syncStateNode(node, s, showAccepts);
    const expected = prev ? prev.nextSibling : g.firstChild;
    if (node !== expected) g.insertBefore(node, expected);
    prev = node;
  }

  for (const [id, node] of live) {
    if (seen.has(id)) continue;
    node.remove();
    live.delete(id);
  }
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════════════════
export function updateLPanelSectionMeta() {
  const setCount = (id, value) => {
    const el = $(id);
    if (!el) return;
    el.textContent = String(value);
    // Empty sections get a muted chip so a populated count reads as the
    // signal rather than every section shouting equally.
    if (value) el.removeAttribute('data-empty');
    else el.setAttribute('data-empty', '1');
  };

  setCount('lp-count-sigma', App.sigma?.size || 0);
  setCount('lp-count-stack', App.stackAlpha?.size || 0);
  setCount('lp-count-output', App.outputAlpha?.size || 0);
  setCount('lp-count-flags', App.flags?.length || 0);
  setCount('lp-count-states', App.states?.length || 0);
  setCount('lp-count-trans', App.transitions?.length || 0);
  const mobileWorkspaceCount = $('mobile-workspace-count');
  if (mobileWorkspaceCount) mobileWorkspaceCount.textContent = String(App.states?.length || 0);
}

export function updateLPanel() {
  const sl = $('states-list');
  const showAccepts = !(getMachineConfig(App.machine).isTransducer && !App.config.transducerAccepts);
  sl.innerHTML = App.states.length ? App.states.map(s => {
    let mooreOut = '';
    if (App.machine === 'Moore') {
      const outSym = (s.output === undefined || s.output === '') ? App.config.sym.lambda : s.output;
      mooreOut = `<span style="color:var(--text3);font-size:0.75em;margin-left:4px">/ ${outSym}</span>`;
    }
    // Keep list selection separate from the generic `.sel` select-control
    // class.  Sharing it applies control sizing/overflow rules to this row.
    const sel = App.selectedStates.has(s.id) ? 'lp-selected' : '';
    return `<div class="si ${App.startId === s.id ? 'start' : ''} ${showAccepts && App.accepts.has(s.id) ? 'acc' : ''} ${sel}"
  onclick="focusStateFromList('${s.id}')" ondblclick="openStateModal('${s.id}')"
  onmouseenter="hlListHover('${s.id}', true)" onmouseleave="hlListHover('${s.id}', false)"
  data-tip="Click to focus · Double-click to edit">
  ${s.name}${mooreOut}
  <button class="si-edit" onclick="event.stopPropagation(); openStateModal('${s.id}')" data-tip="Edit state" aria-label="Edit ${s.name}">
    <svg viewBox="0 0 256 256" width="11" height="11" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>
  </button>
  <div class="dot"></div>
</div>`;
  }).join('') : '<div class="empty-msg">No states</div>';
  const tl = $('trans-list');
  tl.innerHTML = App.transitions.length ? App.transitions.map(t => {
    const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
    const sel = App.selectedTransitions.has(t.id) ? 'lp-selected' : '';
    const fullTitle = `${fn} → ${tn}\n${transLabelDescriptive(t)}\nClick to focus on canvas`;
    return `<div class="ti ${sel}" onclick="focusTransFromList('${t.id}')"
  onmouseenter="hlTransListHover('${t.from}','${t.to}', true)" onmouseleave="hlTransListHover('${t.from}','${t.to}', false)"
  data-tip="${fullTitle.replace(/"/g, '&quot;')}">
  <span class="ti-from">${fn}</span><span class="arr">–${transLabel(t)}→</span><span class="ti-to">${tn}</span>
  <span class="dx" onclick="event.stopPropagation(); deleteTrans('${t.id}')" data-tip="Delete transition"><svg viewBox="0 0 256 256" width="10" height="10" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span>
</div>`;
  }).join('') : '<div class="empty-msg">No transitions</div>';
  if (typeof filterStates === 'function') filterStates();
  if (typeof filterTransitions === 'function') filterTransitions();
  updateLPanelSectionMeta();
}

// ══════════════════════════════════════════════════════════════════
//  RIGHT PANEL: LANGUAGE
// ══════════════════════════════════════════════════════════════════
export function updateRPanel() {
  updateFormalDef();
  updateRegex();
  // The extension of L and the clickable tuple line both depend on the
  // two above, so they refresh last.
  if (typeof renderLanguagePanel === 'function') renderLanguagePanel();
}

// GNFA State Elimination (textbook: add new start + new accept, eliminate interior)
export let _regexCache = { key: '', val: '' };
export function _regexCacheKey() {
  return App.states.map(s => s.id).join(',') + '|' +
    App.transitions.map(t => t.from + t.symbol + t.to).sort().join(',') + '|' +
    App.startId + '|' + [...App.accepts].sort().join(',');
}
export function deriveRegex() {
  if (!App.states.length || !App.startId) return '—';
  const accs = [...App.accepts]; if (!accs.length) return '∅';
  // Cache check (#7)
  const ck = _regexCacheKey();
  if (_regexCache.key === ck) return _regexCache.val;

  const ids = App.states.map(s => s.id);
  const gnfa = {};
  // Add new unique start (qs) and accept (qa) states (#3)
  const qs = '__gnfa_qs__', qa = '__gnfa_qa__';
  const allIds = [qs, ...ids, qa];
  allIds.forEach(a => allIds.forEach(b => { gnfa[a + '|' + b] = null; }));
  // ε from new start to old start
  gnfa[qs + '|' + App.startId] = App.config.sym.eps;
  // ε from each old accept to new accept
  accs.forEach(acc => { gnfa[acc + '|' + qa] = gnfa[acc + '|' + qa] ? reUnion(gnfa[acc + '|' + qa], App.config.sym.eps) : App.config.sym.eps; });
  // Copy original transitions
  App.transitions.forEach(t => {
    const k = t.from + '|' + t.to, sym = t.symbol;
    gnfa[k] = gnfa[k] ? reUnion(gnfa[k], sym) : sym;
  });
  // Eliminate all interior states (everything except qs and qa), ripping the
  // least-connected state first. The order never changes the language, but it
  // changes the size of the expression enormously — each elimination can
  // create fanIn × fanOut new edges, so taking the cheapest state first keeps
  // the blow-up in check. On a 10-state process model, canvas order yields a
  // ~26,000-character regex and this yields ~1,200 for the same language.
  const rem = [...allIds];
  const pending = new Set(ids); // all original states are interior
  while (pending.size) {
    let mid = null, best = Infinity;
    for (const cand of pending) {
      let fanIn = 0, fanOut = 0;
      for (const x of rem) {
        if (x === cand) continue;
        if (gnfa[x + '|' + cand]) fanIn++;
        if (gnfa[cand + '|' + x]) fanOut++;
      }
      const cost = fanIn * fanOut;
      if (cost < best) { best = cost; mid = cand; }
    }
    const self = gnfa[mid + '|' + mid];
    const star = self ? `(${self})*` : '';
    rem.forEach(a => {
      rem.forEach(b => {
        if (a === mid || b === mid) return;
        const r1 = gnfa[a + '|' + mid], r2 = gnfa[mid + '|' + b];
        if (!r1 || !r2) return;
        const via = reConcat(reConcat(r1, star), r2);
        gnfa[a + '|' + b] = gnfa[a + '|' + b] ? reUnion(gnfa[a + '|' + b], via) : via;
      });
    });
    rem.splice(rem.indexOf(mid), 1);
    pending.delete(mid);
  }
  // Result is the single edge qs→qa
  const result = gnfa[qs + '|' + qa];
  const val = result ? simplifyRE(result) : '∅';
  _regexCache = { key: ck, val };
  return val;
}
// User-supplied names (states, symbols) get interpolated straight into KaTeX
// source. Left unescaped, a name containing '_' is read as a LaTeX subscript
// operator (breaking the render), and any multi-letter name renders in the
// slanted math-variable font instead of as a normal word. Escape the LaTeX
// special characters and typeset anything that isn't the classic q0/s1
// short-name convention as upright text instead.
export function escapeLatexText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([_%$#&{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

export function formatStateName(name) {
  if (!name) return '\\text{—}';
  const m = /^([a-zA-Z]+)(\d+)$/.exec(name);
  if (m) return `${m[1]}_{${m[2]}}`;
  return `\\text{${escapeLatexText(name)}}`;
}

export function formatSet(items) {
  if (!items || !items.length) return '\\emptyset';
  return `\\{ ${items.map(formatStateName).join(', ')} \\}`;
}

export function updateFormalDef() {
  const m = App.machine;
  const Q_str = formatSet(App.states.map(s => s.name));
  const S_str = formatSet([...App.sigma]);
  const q0_name = getState(App.startId)?.name;
  const q0_str = q0_name ? formatStateName(q0_name) : '\\text{—}';
  const F_str = formatSet(App.states.filter(s => App.accepts.has(s.id)).map(s => s.name));
  
  let txt = `$$ \\begin{aligned} `;
  
  if (m === 'DFA' || m === 'NFA' || m === 'ε-NFA') {
    const codomain = m === 'DFA' ? 'Q' : '\\mathcal{P}(Q)';
    const eps = (m === 'ε-NFA') ? '\\cup \\{\\varepsilon\\}' : '';
    const mapDom = (m === 'ε-NFA') ? `\\Sigma ${eps}` : '\\Sigma';
    txt += `M &= (Q, \\Sigma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times ${mapDom} \\to ${codomain}`;
  } else if (m === '2DFA' || m === '2NFA') {
    const left = App.config.sym.leftMarker;
    const right = App.config.sym.rightMarker;
    const codomain = m === '2DFA' ? 'Q \\times \\{L, R, S\\}' : '\\mathcal{P}(Q \\times \\{L, R, S\\})';
    txt += `M &= (Q, \\Sigma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${left}, ${right}\\}) \\to ${codomain} \\\\`;
  } else if (m === 'QA') {
    const G_str = formatSet([...App.stackAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q \\times \\Gamma^*)`;
  } else if (m === 'Counter') {
    const bottom = formatStateName(App.config.sym.stackBottom);
    const counterSym = formatStateName([...App.stackAlpha].find(sym => sym !== App.config.sym.stackBottom) || '1');
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\{${counterSym}, ${bottom}\\}, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times \\{${counterSym}, ${bottom}, ${eps}\\} \\to \\mathcal{P}(Q \\times \\{${counterSym}, ${bottom}, ${eps}\\}^*)`;
  } else if (m === '2PDA') {
    const G_str = formatSet([...App.stackAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Gamma_1, \\Gamma_2, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma_1 = \\Gamma_2 &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma_1 \\cup \\{${eps}\\}) \\times (\\Gamma_2 \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q \\times \\Gamma_1^* \\times \\Gamma_2^*)`;
  } else if (isAnyPDA(m)) {
    const G_str = formatSet([...App.stackAlpha]);
    const stackBottomStr = formatStateName(App.config.sym.stackBottom);
    const eps = '\\varepsilon';
    const codomain = m === 'NPDA' ? '\\mathcal{P}(Q \\times \\Gamma^*)' : 'Q \\times \\Gamma^*';
    const emptyCodomain = m === 'NPDA' ? `\\mathcal{P}(Q \\times (\\Gamma \\cup \\{${eps}\\})^*)` : `Q \\times (\\Gamma \\cup \\{${eps}\\})^*`;
    
    if (App.config.pdaParadigm === 'explicit') {
      txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, Z_0, F) \\\\`;
      txt += `Q &= ${Q_str} \\\\`;
      txt += `\\Sigma &= ${S_str} \\\\`;
      txt += `\\Gamma &= ${G_str} \\\\`;
      txt += `q_0 &= ${q0_str} \\\\`;
      txt += `Z_0 &= ${stackBottomStr} \\\\`;
      txt += `F &= ${F_str} \\\\`;
      txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times \\Gamma \\to ${codomain}`;
    } else {
      txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0) \\\\`;
      txt += `Q &= ${Q_str} \\\\`;
      txt += `\\Sigma &= ${S_str} \\\\`;
      txt += `\\Gamma &= ${G_str} \\\\`;
      txt += `q_0 &= ${q0_str} \\\\`;
      txt += `\\text{Acc} &= \\text{empty stack} \\\\`;
      txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma \\cup \\{${eps}\\}) \\to ${emptyCodomain}`;
    }
  } else if (m === 'HSM') {
    // A statechart is an NFA plus two structural maps. Writing them out is the
    // shortest honest statement of "this is still regular": ρ and ι are pure
    // bookkeeping over Q, and δ never leaves it.
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\delta, \\rho, \\iota, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\rho &: Q \\to Q \\cup \\{\\bot\\} \\quad \\text{(containment)} \\\\`;
    txt += `\\iota &: Q \\to Q \\quad \\text{(default entry)} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q)`;
  } else if (m === 'RSM') {
    const eps = '\\varepsilon';
    const names = App.components.map(c => c.name);
    txt += `M &= (\\{M_c\\}_{c \\in C}, \\Sigma, \\text{main}) \\\\`;
    txt += `C &= ${formatSet(names)} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `M_c &= (N_c, B_c, en_c, Ex_c, \\delta_c) \\\\`;
    txt += `\\delta_c &: (N_c \\cup B_c) \\times (\\Sigma \\cup \\{${eps}\\}) \\to \\mathcal{P}(N_c \\cup B_c) \\\\`;
    txt += `\\text{Acc} &: w \\text{ consumed} \\;\\wedge\\; \\text{stack empty} \\;\\wedge\\; Ex_{\\text{main}}`;
  } else if (m === 'Moore') {
    const D_str = formatSet([...App.outputAlpha]);
    const lambda = '\\lambda';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, ${lambda}, q_0) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\to Q \\\\`;
    txt += `${lambda} &: Q \\to \\Delta`;
  } else if (m === 'Mealy') {
    const D_str = formatSet([...App.outputAlpha]);
    const lambda = '\\lambda';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, ${lambda}, q_0) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\to Q \\\\`;
    txt += `${lambda} &: Q \\times \\Sigma \\to \\Delta`;
  } else if (m === 'FST') {
    const D_str = formatSet([...App.outputAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, \\lambda, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q) \\\\`;
    txt += `\\lambda &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times Q \\to \\Delta^*`;
  } else if (m === 'NDTM') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma \\times \\{L, R, S\\})`;
  } else if (m === 'MTM') {
    const G_str = formatSet([...App.stackAlpha]);
    const k = App.tapeCount || 2;
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma^{${k}} \\to Q \\times \\Gamma^{${k}} \\times \\{L, R, S\\}^{${k}}`;
  } else if (m === 'LBA') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\} \\\\`;
    txt += `\\text{Tape bound} &: |\\text{tape}| \\le |w|`;
  } else if (m === 'ITM') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\} \\\\`;
    txt += `\\text{Tape index set} &: \\mathbb{Z}`;
  } else {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\}`;
  }
  txt += ` \\end{aligned} $$`;

  App._defBoxLatex = txt;
  const defBox = $('def-box');
  defBox.innerHTML = txt;
  if (typeof triggerMath === 'function') triggerMath(defBox);
  updateDefBoxOverflowShadow();
}

// Same edge-fade hint the workspace tab bar uses, applied to the formal
// definition box so a horizontally-scrollable Σ/Q set doesn't look like a
// hard cutoff.
export function updateDefBoxOverflowShadow() {
  const box = $('def-box');
  if (!box) return;
  const maxScroll = Math.max(0, box.scrollWidth - box.clientWidth);
  const hasOverflow = maxScroll > 2;
  box.classList.toggle('has-overflow-left', hasOverflow && box.scrollLeft > 2);
  box.classList.toggle('has-overflow-right', hasOverflow && box.scrollLeft < maxScroll - 2);
}

export function initDefBoxOverflowObserver() {
  const box = $('def-box');
  if (!box || box._overflowObsInit) return;
  box._overflowObsInit = true;
  box.addEventListener('scroll', updateDefBoxOverflowShadow);
  if ('ResizeObserver' in window) {
    new ResizeObserver(updateDefBoxOverflowShadow).observe(box);
  }
}

export function copyBoxText(id) {
  const text = id === 'def-box'
    ? (App._defBoxLatex || $(id).textContent)
    : (App._regexBoxPlain !== undefined ? App._regexBoxPlain : $(id).textContent);
  const btn = $(id === 'def-box' ? 'def-copy-btn' : 'regex-copy-btn');
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showStatus('Clipboard access unavailable');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showStatus(id === 'def-box' ? 'Copied LaTeX source' : 'Copied regular expression');
    if (btn) {
      btn.classList.add('copied');
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1200);
    }
  }).catch(() => showStatus('Copy failed — clipboard access blocked'));
}

// Plain text, not KaTeX: regex notation (| * ( )) reads fine unstyled, and
// unlike math mode it wraps naturally instead of needing horizontal scroll —
// and it can't misrender symbols that contain LaTeX-special characters.
export function updateRegex() {
  const rb = $('regex-box'), m = App.machine;
  let txt = '';
  // A derived regex recomputes as you drag an edge; a class label is a
  // constant. They are different kinds of claim, so the panel marks
  // which one it is showing rather than styling them identically.
  App._regexIsDerived = false;
  if (m === '2DFA' || m === '2NFA') { txt = 'Regular Language (Two-Way Head Motion with Endmarkers)'; }
  else if (m === 'QA') { txt = 'Queue Automaton Language Family'; }
  else if (m === 'Counter') { txt = 'Counter Language Family'; }
  else if (m === '2PDA') { txt = 'Two-Stack PDA (TM-Equivalent Power)'; }
  else if (m === 'LBA') { txt = 'Context-Sensitive Language (Endmarked Tape)'; }
  else if (m === 'ITM') { txt = 'Recursively Enumerable Language'; }
  // The two hierarchical models, and the whole point of having both: the same
  // kind of picture, one class apart. Neither goes through deriveRegex — it
  // would read boxes and regions as ordinary states and confidently print a
  // regular expression for the wrong language.
  else if (m === 'HSM') { txt = 'Regular Language (Statechart — flattens to an NFA)'; }
  else if (m === 'RSM') { txt = 'Context-Free Language (Recursive State Machine)'; }
  else if (isAnyPDA(m)) { txt = 'Context-Free Language'; }
  else if (isAnyTM(m)) { txt = 'Recursively Enumerable Language'; }
  else if (m === 'Moore') { txt = 'Finite-State Transducer (Moore)'; }
  else if (m === 'Mealy') { txt = 'Finite-State Transducer (Mealy)'; }
  else if (m === 'FST') { txt = 'Finite-State Transducer (Nondeterministic)'; }
  else { txt = deriveRegex() || '∅'; App._regexIsDerived = true; }

  App._regexBoxPlain = txt;
  rb.textContent = txt;
}

export function reUnion(a, b) { if (!a) return b; if (!b) return a; if (a === b) return a; return `${a} | ${b}`; }
// The explicit "·" keeps concatenation unambiguous once symbols can be whole
// words instead of single characters (e.g. "citizenFilesComplaint·officerOpensReview"
// instead of the two runs silently glued together).
export function reConcat(a, b) {
  if (!a || !b) return a || b || '';
  if (a === App.config.sym.eps) return b;
  if (b === App.config.sym.eps) return a;
  const pa = a.includes(' | '), pb = b.includes(' | ');
  const left = pa ? '(' + a + ')' : a;
  const right = pb ? '(' + b + ')' : b;
  return `${left}·${right}`;
}
export function simplifyRE(r) {
  if (!r) return '∅';
  const e = App.config.sym.eps;
  const escE = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp('\\(' + escE + '\\)\\*', 'g');
  const re2 = new RegExp(escE + '\\*', 'g');
  return r.replace(re1, e).replace(re2, e)
    .replace(/\(([a-zA-Z0-9])\)\*/g, '$1*')
    .replace(/\(([a-zA-Z0-9])\)/g, '$1');
}
