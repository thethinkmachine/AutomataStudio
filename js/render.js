import { animEnabled, beginPass, claimGroup, dropTrack, easeTrack, endPass, requestSettle, setSettlePainter, snapTrack } from './anim.js';
import { applyEdgeDirectionHighlight, clearEdgeDirectionHighlight, onStateDown, wrap } from './canvas.js';
import { renderDividers } from './dividers.js';
import { PILL_GAP, PILL_HEIGHT, PILL_ROW_H, buildLayoutContext, edgeGeometryFor, estimatePillLabelSize, estimateTextLabelSize, pillPartWidth, selfLoopLabelPoint, selfLoopPath } from './geometry.js';
import { commit, snapshot } from './history.js';
import { scheduleMinimap } from './minimap.js';
import { renderLanguagePanel } from './language.js';
import { highlightNoteAnchors, pruneNoteAnchors, renderNotes, updateNotesDOM } from './notes.js';
import { $, App, OmegaAcceptance, R, SVG_NS, edgeLabelsHidden, getMachineConfig, isDeterministicOmega, omegaAcceptanceOf, statePriority, usesParityPriorities } from './state.js';
import { getState, openTransModal, showContextMenu, transLabel, transLabelDescriptive, transLabelParts } from './states-transitions.js';
import { Change, emit, subscribe } from './store.js';
import { triggerMath } from './reference.js';
import { filterStates, filterTransitions } from './ui.js';
import { isAnyPDA, isAnyTM, showStatus } from './utils.js';

// A structural edit repaints the canvas and both side panels; a CANVAS change
// is a repaint only, since selection and highlight edits leave the formal
// definition and the panel contents correct.
subscribe(Change.GRAPH, renderAll);
subscribe(Change.GRAPH, updateLPanel);
subscribe(Change.GRAPH, updateRPanel);
subscribe(Change.CANVAS, renderAll);

// The layout context the last paint computed, reused by settle frames. See
// updateFastDOM. Every structural change repaints through renderTransitions,
// which refreshes it, so a settle frame can never be looking at a context whose
// states have since been replaced.
let lastCtx = null;

// The settle loop's repaint. There is no persistent render loop in this app —
// repaints are event-driven through store.js — and a drag that ends without
// resolving an overlap emits nothing at all, so the glide after release has to
// drive itself. Geometry only: nothing structural can have changed.
setSettlePainter(() => updateFastDOM({ statesMoved: false }));

// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
export function makeSVG(t) { return document.createElementNS(SVG_NS, t); }

export function renderAll() {
  const cfg = getMachineConfig(App.machine);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;
  if (typeof pruneNoteAnchors === 'function') pruneNoteAnchors();
  if (typeof renderDividers === 'function') renderDividers();
  renderTransitions(); renderStates();
  if (typeof renderNotes === 'function') renderNotes();
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

// Resolves an edge key back to the transitions it covers. The listeners below
// call this at event time rather than closing over a group object: a node now
// survives across renders, and the layout pass regroups the transitions on
// every one, so a captured group would act on transitions that no longer exist.
function edgeGroupFor(key) {
  const sep = key.indexOf('|');
  const fromId = key.slice(0, sep), toId = key.slice(sep + 1);
  const ts = App.transitions.filter(t => t.from === fromId && t.to === toId);
  if (!ts.length) return null;
  const from = getState(fromId), to = getState(toId);
  if (!from || !to) return null;
  return { from, to, ts, grp: { from: fromId, to: toId, ts } };
}

// How big the label for a group of transitions will be, before it is written to
// the DOM. geometry.js needs the box to place it clear of everything else, and
// this module is the one that knows which of the two label styles is on and what
// each transition reads as.
function edgeLabelSizeFor(ts) {
  const style = App.config.edgeLabelStyle;
  // A hidden label occupies nothing, so the loop scorer, the label placer and
  // getContentBounds all stop steering around a box that is never painted.
  // It has to be a real zero rather than a falsy return — buildLayoutContext
  // reads that as "no estimate available" and substitutes a default size.
  if (style === 'none') return { w: 0, h: 0 };
  if (style === 'pills' || style === 'beginner') {
    return estimatePillLabelSize(ts.map(t => transLabelParts(t, style === 'beginner')));
  }
  return estimateTextLabelSize(ts.map(transLabel));
}

// One layout pass over the whole diagram: every edge path, self-loop direction
// and label position, resolved against each other.
//
// Both renderTransitions and updateFastDOM start here, and canvas.js calls it
// too when it needs to know how much room the drawing takes up. It is a pure
// read of App — nothing is cached between calls, because the positions it
// depends on change on every frame of a drag.
export function currentLayoutContext(opts = {}) {
  return buildLayoutContext({ labelSizeFor: edgeLabelSizeFor, ...opts });
}

// ── eased drawing ──
//
// The layout pass above answers where an edge *belongs*. This turns that into
// where it should be drawn *this frame*, so that a decision flipping between two
// discrete candidates — a loop direction, a routing step, a label slot — glides
// instead of teleporting. See js/anim.js for why those flips happen at all.
//
// The seam is deliberately here and nowhere else: geometry.js keeps returning
// true targets, so getContentBounds — and with it fit-to-screen and every
// cropped export — keeps measuring the settled diagram rather than whatever is
// mid-flight on screen.
//
// `dt` comes from beginPass(). A caller that does not want easing (an export,
// anything reading the DOM back) settles first and then paints, rather than
// asking for a different code path.
function displayGeo(geo, dt) {
  if (!geo || !animEnabled()) return geo;
  const key = geo.key;

  // A drag of the bend handle or the loop grip must track the pointer exactly —
  // lag on the thing under your finger reads as the app being broken, not as
  // motion. Everything else about the edge still eases.
  const dc = App.dragCurve;
  const dragging = !!dc && !!dc.from && !!dc.to && `${dc.from.id}|${dc.to.id}` === key;

  // Both objects change identity on every wholesale replacement — a load, an
  // undo, a workspace switch — while a drag mutates them in place. Since edge
  // keys are recycled (resetIds numbers states s1, s2, … on every load), this is
  // what stops a freshly loaded machine easing in from the previous one's shape.
  if (claimGroup(key, geo.from, geo.to)) {
    for (const suffix of [':a', ':c', ':lx', ':ly']) dropTrack(key + suffix);
  }

  if (geo.isSelf) {
    const angle = dragging
      ? snapTrack(key + ':a', geo.angle)
      : easeTrack(key + ':a', geo.angle, dt, true);
    // The label and the handle are derived from the eased angle rather than
    // eased themselves, so they stay welded to the arc they annotate instead of
    // drifting across it at their own rate.
    const lp = selfLoopLabelPoint(geo.from, angle, geo.loop, geo.labelSize);
    return {
      ...geo,
      angle,
      d: selfLoopPath(geo.from.x, geo.from.y, angle, geo.loop),
      mx: geo.from.x + geo.loop.extent * Math.cos(angle),
      my: geo.from.y + geo.loop.extent * Math.sin(angle),
      lx: lp.x,
      ly: lp.y
    };
  }

  const crvVal = dragging
    ? snapTrack(key + ':c', geo.crvVal)
    : easeTrack(key + ':c', geo.crvVal, dt);
  // The label is eased on its own two axes because placeLabel picks from a slot
  // list — its jumps are its own, not the curve's.
  const lx = easeTrack(key + ':lx', geo.lx, dt);
  const ly = easeTrack(key + ':ly', geo.ly, dt);
  const edge = crvVal === geo.crvVal ? null : edgeGeometryFor(geo.from, geo.to, crvVal);
  if (!edge) return { ...geo, lx, ly };
  return {
    ...geo,
    crvVal, lx, ly,
    sx: edge.sx, sy: edge.sy, ex: edge.ex, ey: edge.ey,
    mx: edge.mx, my: edge.my,
    d: edge.d
  };
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

  const pillEl = makeSVG('g');
  pillEl.classList.add('tlbl', 'edge-pill-label');
  pillEl.setAttribute('id', `pill-lbl-${key}`);

  edgeGrp.__parts = { pathEl, hitEl, textEl, pillEl, handle: null };
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
//
// A self-loop gets one too, sitting at the top of the arc. There it means
// something different — drag it and the loop swings round the state — which is
// the only way to move a loop off a direction the automatic placement picked.
function syncCurveHandle(edgeGrp, key, geo, selected) {
  const parts = edgeGrp.__parts;
  const wanted = selected;
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

function syncEdgeNode(edgeGrp, geo, ts) {
  if (!geo) return false;
  const parts = edgeGrp.__parts;
  const selected = isEdgeSelected(ts);

  edgeGrp.classList.toggle('sel-t', selected);
  parts.pathEl.setAttribute('d', geo.d);
  parts.hitEl.setAttribute('d', geo.d);

  const hidden = edgeLabelsHidden();
  const pillMode = App.config.edgeLabelStyle === 'pills' || App.config.edgeLabelStyle === 'beginner';
  const beginnerMode = App.config.edgeLabelStyle === 'beginner';

  // Hiding the labels skips building them, rather than painting them and then
  // covering them up. The cache keys are cleared with them so that switching the
  // style back rebuilds from scratch instead of matching a stale key against an
  // emptied node.
  if (hidden) {
    if (edgeGrp.__labelKey !== null) {
      parts.textEl.innerHTML = '';
      edgeGrp.__labelKey = null;
      edgeGrp.__labelX = null;
    }
    if (edgeGrp.__pillKey !== null) {
      parts.pillEl.innerHTML = '';
      edgeGrp.__pillKey = null;
    }
    parts.textEl.style.display = 'none';
    parts.pillEl.style.display = 'none';

    const tip = ts.map(t => transLabelDescriptive(t)).join('\n');
    edgeGrp.setAttribute('data-tip', tip);
    edgeGrp.setAttribute('aria-label', tip);

    syncCurveHandle(edgeGrp, edgeGrp.getAttribute('data-edge'), geo, selected);
    return true;
  }

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

  const pillRows = ts.map(t => transLabelParts(t, beginnerMode));
  const pillKey = pillRows.map(row => row.map(p => `${p.role}:${p.text}`).join('\u0002')).join('\u0001');
  if (edgeGrp.__pillKey !== pillKey) {
    parts.pillEl.innerHTML = '';
    // Pill widths come from geometry.js because the layout pass sized the label
    // box from the same numbers before choosing where to put it. Two independent
    // copies of this arithmetic would drift, and the label would then be placed
    // clear of a box that is not the one being drawn.
    pillRows.forEach((row, rowIndex) => {
      const widths = row.map(p => pillPartWidth(p.text));
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, row.length - 1) * PILL_GAP;
      let x = -total / 2;
      const rowEl = makeSVG('g');
      rowEl.classList.add('edge-pill-row');
      rowEl.setAttribute('transform', `translate(0 ${rowIndex * PILL_ROW_H - (pillRows.length - 1) * PILL_ROW_H / 2})`);
      row.forEach((part, i) => {
        const item = makeSVG('g');
        item.classList.add('edge-pill', `edge-pill-${part.role}`);
        item.setAttribute('transform', `translate(${x} ${-PILL_HEIGHT / 2})`);
        const rect = makeSVG('rect');
        rect.setAttribute('width', widths[i]);
        rect.setAttribute('height', PILL_HEIGHT);
        rect.setAttribute('rx', 5);
        const label = makeSVG('text');
        label.setAttribute('x', widths[i] / 2);
        label.setAttribute('y', PILL_HEIGHT / 2);
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('text-anchor', 'middle');
        label.textContent = part.text;
        item.appendChild(rect);
        item.appendChild(label);
        rowEl.appendChild(item);
        x += widths[i] + PILL_GAP;
      });
      parts.pillEl.appendChild(rowEl);
    });
    edgeGrp.__pillKey = pillKey;
  }
  parts.pillEl.setAttribute('transform', `translate(${geo.lx} ${geo.ly})`);
  parts.pillEl.classList.toggle('edge-pill-beginner', beginnerMode);
  parts.textEl.style.display = pillMode ? 'none' : '';
  parts.pillEl.style.display = pillMode ? '' : 'none';

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
  a.setAttribute('d', `M ${s.x - R - al} ${s.y} L ${s.x - R - ah / 3} ${s.y}`);
  // Always first in paint order, behind every edge.
  if (a !== g.firstChild) g.insertBefore(a, g.firstChild);
}

export function renderTransitions() {
  const g = $('trans-g');
  const lg = $('trans-lbl-g');
  const live = App.domCache.transitions;
  const dt = beginPass();
  const ctx = currentLayoutContext();
  lastCtx = ctx;

  syncStartArrow(g);

  let prev = App.domCache.startArrow || null;
  const seen = new Set();
  for (const { key, ts } of ctx.groups) {
    let node = live.get(key);
    if (!node) {
      node = createEdgeNode(key);
      live.set(key, node);
    }
    if (!syncEdgeNode(node, displayGeo(ctx.geo.get(key), dt), ts)) continue;
    seen.add(key);

    const expected = prev ? prev.nextSibling : g.firstChild;
    if (node !== expected) g.insertBefore(node, expected);
    prev = node;

    // Labels are siblings in their own layer, so they need placing separately.
    const { textEl, pillEl } = node.__parts;
    if (lg) {
      if (textEl.parentNode !== lg) lg.appendChild(textEl);
      if (pillEl.parentNode !== lg) lg.appendChild(pillEl);
    } else if (textEl.parentNode !== node) {
      node.appendChild(textEl);
      node.appendChild(pillEl);
    }
  }

  for (const [key, node] of live) {
    if (seen.has(key)) continue;
    node.__parts.textEl.remove();
    node.__parts.pillEl.remove();
    node.remove();
    live.delete(key);
  }

  endPass();
  requestSettle();
}

// Runs on every animation frame while dragging, so it only touches geometry —
// no classes, no labels, no node creation.
//
// It runs the same layout pass as renderTransitions rather than keeping a second
// copy of the routing maths, which is what makes avoidance live: loops swing
// round and labels step aside while the state is still under the pointer,
// instead of snapping into place on release. Child elements are reached through
// the __parts references the renderer already holds rather than a querySelector
// per node per frame, and the pass drops its collision stages above
// COLLISION_BUDGET_STATES so a very large machine still drags at frame rate.
export function updateFastDOM({ statesMoved = true } = {}) {
  const dt = beginPass();
  // The drag path, so the minimap tracks a state while it is being moved
  // rather than jumping to its new home on release. Coalesced, so the many
  // callers below cost one paint per frame between them.
  if (statesMoved) scheduleMinimap();
  // A settle frame reuses the previous pass's layout: nothing has moved, only
  // the eased values are still closing on it, so re-running four collision
  // stages per frame for the ~165ms after every edit would be pure waste on a
  // large machine. The drag path passes nothing and recomputes, because there
  // the positions really did change.
  const ctx = statesMoved || !lastCtx ? currentLayoutContext() : lastCtx;
  lastCtx = ctx;
  const stateById = ctx.stateById;
  const hasSub = App.machine === 'Moore' || usesParityPriorities(App.machine);

  for (const s of App.states) {
    const grp = App.domCache.states.get(s.id);
    if (!grp || !grp.__parts) continue;
    const p = grp.__parts;
    p.circle.setAttribute('cx', s.x);
    p.circle.setAttribute('cy', s.y);
    if (p.ring) {
      p.ring.setAttribute('cx', s.x);
      p.ring.setAttribute('cy', s.y);
    }
    p.label.setAttribute('x', s.x);
    p.label.setAttribute('y', hasSub ? s.y - App.config.render.textMargin : s.y);
    if (grp.__labelX !== s.x) {
      for (const tspan of p.label.childNodes) tspan.setAttribute('x', s.x);
      grp.__labelX = s.x;
    }
    if (p.sub) {
      p.sub.setAttribute('x', s.x);
      p.sub.setAttribute('y', s.y + App.config.render.mooreTextMargin);
    }
    if (p.priority) {
      const bx = s.x + R * 0.88, by = s.y + R * 0.62;
      p.priority.bg.setAttribute('x', bx - 10);
      p.priority.bg.setAttribute('y', by - 8);
      p.priority.text.setAttribute('x', bx);
      p.priority.text.setAttribute('y', by);
    }
  }

  const startArrow = App.domCache.startArrow;
  if (startArrow && App.startId) {
    const s = stateById.get(App.startId);
    if (s) {
      const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
      startArrow.setAttribute('d', `M ${s.x - R - al} ${s.y} L ${s.x - R - ah / 3} ${s.y}`);
    }
  }

  for (const [key, edgeGrp] of App.domCache.transitions) {
    const p = edgeGrp.__parts;
    if (!p) continue;
    const geo = displayGeo(ctx.geo.get(key), dt);
    if (!geo) continue;

    p.pathEl.setAttribute('d', geo.d);
    p.hitEl.setAttribute('d', geo.d);
    p.textEl.setAttribute('x', geo.lx);
    p.textEl.setAttribute('y', geo.ly);
    p.pillEl.setAttribute('transform', `translate(${geo.lx} ${geo.ly})`);
    if (edgeGrp.__labelX !== geo.lx) {
      for (const tspan of p.textEl.childNodes) tspan.setAttribute('x', geo.lx);
      edgeGrp.__labelX = geo.lx;
    }
    if (p.handle) {
      p.handle.setAttribute('cx', geo.mx);
      p.handle.setAttribute('cy', geo.my);
    }
  }

  // Anchored notes ride along with the states/edges they're pinned to. A note
  // anchors to a state's x/y or to a plain chord midpoint (notes.js), never to
  // an edge's routed path or label slot — so on a settle frame, where no state
  // has moved, no note can have moved either.
  if (statesMoved && typeof updateNotesDOM === 'function') updateNotesDOM();

  endPass();
  requestSettle();
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
// Under parity there is no F — α is the per-state number — so the accepting
// ring and the double-click that toggles it would both be editing a set the
// verdict never consults.
function acceptsAreShown() {
  if (usesParityPriorities(App.machine)) return false;
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
function createStateNode(id) {
  const g = makeSVG('g');
  g.classList.add('sn');
  g.setAttribute('data-id', id);

  const circle = makeSVG('circle');
  circle.classList.add('bd');
  g.appendChild(circle);

  const label = makeSVG('text');
  label.classList.add('slbl');
  g.appendChild(label);

  // Child references, so syncing never has to query the subtree.
  g.__parts = { circle, label, ring: null, sub: null, priority: null };
  // Inputs the label tspans were last built from, so they are only rebuilt when
  // one of them actually changes.
  g.__labelKey = null;

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
    showContextMenu('state', e.clientX, e.clientY);
  });

  g.addEventListener('dblclick', () => {
    if (g.dataset.lastPointerType === 'touch') return;
    if (!acceptsAreShown()) return;
    commit(() => {
      App.accepts.has(id) ? App.accepts.delete(id) : App.accepts.add(id);
    });
  });

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

  parts.circle.setAttribute('cx', s.x);
  parts.circle.setAttribute('cy', s.y);
  parts.circle.setAttribute('r', R);

  if (isAcc && !parts.ring) {
    const ring = makeSVG('circle');
    ring.classList.add('acc-ring');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--gold)');
    ring.setAttribute('stroke-width', '1.5');
    g.insertBefore(ring, parts.label);
    parts.ring = ring;
  } else if (!isAcc && parts.ring) {
    parts.ring.remove();
    parts.ring = null;
  }
  if (parts.ring) {
    parts.ring.setAttribute('cx', s.x);
    parts.ring.setAttribute('cy', s.y);
    parts.ring.setAttribute('r', R - 5);
  }

  // Two things want a second line under the name: a Moore output and a parity
  // priority. They never coexist (one is a transducer, the other an
  // ω-automaton), so they share the slot rather than each having their own.
  const isMoore = App.machine === 'Moore';
  const isParity = usesParityPriorities(App.machine);
  const hasSub = isMoore;
  parts.label.setAttribute('x', s.x);
  parts.label.setAttribute('y', hasSub ? s.y - App.config.render.textMargin : s.y);
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

  if (hasSub && !parts.sub) {
    const ot = makeSVG('text');
    ot.classList.add('state-sub');
    g.appendChild(ot);
    parts.sub = ot;
  } else if (!hasSub && parts.sub) {
    parts.sub.remove();
    parts.sub = null;
  }
  if (parts.sub) {
    // Unconditional, per the sync* rule — a "what did we draw last time" cache
    // here would strand a priority on the node after the condition changed.
    parts.sub.setAttribute('x', s.x);
    parts.sub.setAttribute('y', s.y + App.config.render.mooreTextMargin);
    parts.sub.classList.remove('parity');
    parts.sub.textContent = s.output !== undefined && s.output !== '' ? s.output : '—';
  }

  // Parity priorities get their own badge at the node's lower-right edge.
  // Keeping it independent from the name's text block prevents wrapped labels
  // from colliding with the priority value.
  if (isParity && !parts.priority) {
    const badge = makeSVG('g');
    badge.classList.add('priority-badge');
    const bg = makeSVG('rect');
    const text = makeSVG('text');
    text.classList.add('priority-value');
    badge.appendChild(bg);
    badge.appendChild(text);
    g.appendChild(badge);
    parts.priority = { group: badge, bg, text };
  } else if (!isParity && parts.priority) {
    parts.priority.group.remove();
    parts.priority = null;
  }
  if (parts.priority) {
    const bx = s.x + R * 0.88;
    const by = s.y + R * 0.62;
    parts.priority.bg.setAttribute('x', bx - 10);
    parts.priority.bg.setAttribute('y', by - 8);
    parts.priority.bg.setAttribute('width', 20);
    parts.priority.bg.setAttribute('height', 16);
    parts.priority.bg.setAttribute('rx', 8);
    parts.priority.text.setAttribute('x', bx);
    parts.priority.text.setAttribute('y', by);
    parts.priority.text.textContent = String(statePriority(s));
  }

  let stTitle = `State '${s.name}'`;
  if (isStart || isAcc) {
    const statuses = [];
    if (isStart) statuses.push('Start');
    if (isAcc) statuses.push('Accept');
    stTitle += ` (${statuses.join(', ')})`;
  }
  if (isMoore) {
    const o = s.output !== undefined && s.output !== '' ? s.output : App.config.sym.lambda;
    stTitle += `\nOutput: '${o}'`;
  }
  if (isParity) {
    const p = statePriority(s);
    stTitle += `\nPriority: ${p} (${p % 2 === 0 ? 'even — accepting if least' : 'odd — rejecting if least'})`;
  }
  g.setAttribute('data-tip', stTitle);
  g.setAttribute('aria-label', stTitle);
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
    seen.add(s.id);
    let node = live.get(s.id);
    if (!node) {
      node = createStateNode(s.id);
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
  setCount('lp-count-states', App.states?.length || 0);
  setCount('lp-count-trans', App.transitions?.length || 0);
  const mobileWorkspaceCount = $('mobile-workspace-count');
  if (mobileWorkspaceCount) mobileWorkspaceCount.textContent = String(App.states?.length || 0);
}

export function updateLPanel() {
  const sl = $('states-list');
  const showAccepts = acceptsAreShown();
  sl.innerHTML = App.states.length ? App.states.map(s => {
    let mooreOut = '';
    if (App.machine === 'Moore') {
      const outSym = (s.output === undefined || s.output === '') ? App.config.sym.lambda : s.output;
      mooreOut = `<span style="color:var(--text3);font-size:0.75em;margin-left:4px">/ ${outSym}</span>`;
    } else if (usesParityPriorities(App.machine)) {
      mooreOut = `<span style="color:var(--text3);font-size:0.75em;margin-left:4px">Ω ${statePriority(s)}</span>`;
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
  } else if (m === 'PFA') {
    txt += `M &= (Q, \\Sigma, \\delta, q_0, F, \\lambda) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\lambda &= ${App.config.pfaCutPoint} \\quad \\text{(cut-point)} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\times Q \\to [0, 1] \\\\`;
    txt += `&\\textstyle\\sum_{q'} \\delta(q, a, q') = 1 \\quad \\forall q \\in Q, a \\in \\Sigma \\\\`;
    txt += `L(M) &= \\{ w : P_M(w) > \\lambda \\}`;
  } else if (getMachineConfig(m).isOmega) {
    // Two independent axes meet here. Determinism decides whether δ is a
    // function and whether the language quantifies over runs; the acceptance
    // condition decides the last slot of the tuple and the predicate on Inf.
    const det = isDeterministicOmega(m);
    const cond = omegaAcceptanceOf(m);
    const alpha = cond === 'parity' ? '\\Omega' : 'F';
    const inf = det ? '\\mathrm{Inf}(\\rho_w)' : '\\mathrm{Inf}(\\rho)';
    const pred = cond === 'cobuchi' ? `${inf} \\cap F = \\emptyset`
      : cond === 'parity' ? `\\min \\Omega(${inf}) \\equiv 0 \\pmod 2`
        : `${inf} \\cap F \\neq \\emptyset`;
    txt += `M &= (Q, \\Sigma, \\delta, q_0, ${alpha}) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += cond === 'parity'
      ? `\\Omega &: Q \\to \\mathbb{N} \\\\`
      : `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\to ${det ? 'Q' : '\\mathcal{P}(Q)'} \\\\`;
    if (cond === 'weak') {
      txt += `&\\forall\\, C \\in \\mathrm{SCC}(M):\\ C \\subseteq F \\ \\text{or}\\ C \\cap F = \\emptyset \\\\`;
    }
    txt += det
      ? `L(M) &= \\{ w \\in \\Sigma^\\omega : ${pred} \\}`
      : `L(M) &= \\{ w \\in \\Sigma^\\omega : \\exists \\rho,\\ ${pred} \\}`;
  } else if (m === 'PDT') {
    const G_str = formatSet([...App.stackAlpha]);
    const D_str = formatSet([...App.outputAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\Delta, \\delta, \\lambda, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma^* \\times \\Delta^*)`;
  } else if (m === '2DFT') {
    const D_str = formatSet([...App.outputAlpha]);
    const left = App.config.sym.leftMarker;
    const right = App.config.sym.rightMarker;
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, \\lambda, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${left}, ${right}\\}) \\to Q \\times \\{L, R, S\\} \\\\`;
    txt += `\\lambda &: Q \\times (\\Sigma \\cup \\{${left}, ${right}\\}) \\to \\Delta^*`;
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
  else if (m === 'PFA') { txt = `Stochastic Language (cut-point λ = ${App.config.pfaCutPoint})`; }
  // The class an ω-automaton denotes depends on both axes, and only one cell of
  // that table is affected by determinism. Büchi is the exception: DBA ⊊ NBA.
  // co-Büchi determinizes (NcoBA = DcoBA) and so does parity, where both sides
  // reach the full ω-regular class — which is the point of the condition.
  else if (getMachineConfig(m).isOmega) {
    const cond = omegaAcceptanceOf(m);
    txt = cond === 'cobuchi'
      ? 'co-Büchi ω-Language (Persistence — the Complement of a Deterministic Büchi Language)'
      : cond === 'parity'
        ? 'ω-Regular Language (Parity Acceptance — full power, deterministic or not)'
        : cond === 'weak'
          ? 'Weak ω-Language (Recognizable by a Büchi and a co-Büchi Automaton Alike)'
          : isDeterministicOmega(m)
            ? 'Deterministic Büchi ω-Language (Limit of a Regular Language)'
            : 'ω-Regular Language (Büchi Acceptance)';
  }
  else if (m === 'PDT') { txt = 'Pushdown Transduction (Context-Free Relation)'; }
  else if (m === '2DFT') { txt = 'Regular Transduction (Two-Way, MSO-Definable)'; }
  else if (m === 'QA') { txt = 'Queue Automaton Language Family'; }
  else if (m === 'Counter') { txt = 'Counter Language Family'; }
  else if (m === '2PDA') { txt = 'Two-Stack PDA (TM-Equivalent Power)'; }
  else if (m === 'LBA') { txt = 'Context-Sensitive Language (Endmarked Tape)'; }
  else if (m === 'ITM') { txt = 'Recursively Enumerable Language'; }
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
