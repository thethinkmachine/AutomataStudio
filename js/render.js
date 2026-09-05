import { animEnabled, beginPass, claimGroup, dropTrack, easeTrack, endPass, requestSettle, setSettlePainter, snapTrack } from './anim.js';
import { applyEdgeDirectionHighlight, clearEdgeDirectionHighlight, clearSelection, onPortDown, resetPortPlacement, onStateDown, wrap } from './canvas.js';
import { renderDividers } from './dividers.js';
import { PILL_GAP, PILL_HEIGHT, PILL_ROW_H, buildLayoutContext, edgeGeometryFor, estimatePillLabelSize, estimateTextLabelSize, pillPartWidth, selfLoopLabelPoint, selfLoopPath, startNodeId } from './geometry.js';
import { commit, snapshot } from './history.js';
import { setListItems } from './panel-list.js';
import { cullNeedsRepaint, cullViewport, cullingActive, edgeLabelLOD, invalidateCull, rectHasPoint, stateLabelLOD, suspendCulling } from './viewport.js';
import { scheduleMinimap } from './minimap.js';
import { renderLanguagePanel } from './language.js';
import { highlightNoteAnchors, pruneNoteAnchors, renderNotes, updateNotesDOM } from './notes.js';
import { $, App, OmegaAcceptance, R, SVG_NS, edgeLabelsHidden, getMachineConfig, isDeterministicOmega, omegaAcceptanceOf, previewNodeBudget, statePriority, usesParityPriorities, wrapStateLabelsOn } from './state.js';
import { BLOCK_STRIP_H, blockPreviewGraph, blockPreviewKey, getNode, viewEdgeGroup, viewEdgeKeyFor, viewStates, visibleNodeIdFor } from './view-graph.js';
import { machineSupportsBlocks } from './machines/index.js';
import { allBlocks } from './blocks-ui.js';
import { thumbBounds, thumbEdgePairs, thumbEdgePath, thumbEdgeSegments, thumbSubpath, thumbFit, thumbNodeRadius } from './graph-thumb.js';
import { enterBlockScope } from './scope.js';
import { blockAncestry } from './blocks.js';
import { edgeTipFor, getState, openTransModal, showContextMenu, transLabel, transLabelDescriptive, transLabelParts } from './states-transitions.js';
import { Change, changed, emit, subscribe } from './store.js';
import { createMemo, reactiveRoot } from './reactive.js';
import { triggerMath } from './reference.js';
import { filterStates, filterTransitions } from './ui.js';
import { escapeHtml, hasStateOutput, isAnyPDA, isAnyTM, showStatus } from './utils.js';

// A structural edit repaints the canvas and both side panels; a CANVAS change
// is a repaint only, since selection and highlight edits leave the formal
// definition and the panel contents correct.
subscribe(Change.GRAPH, renderAll);
subscribe(Change.GRAPH, updateLPanel);
subscribe(Change.GRAPH, updateBlockList);
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
  // One cull decision for the whole pass, so the states and the edges cannot
  // disagree about where the screen is. See js/viewport.js.
  const view = cullViewport();
  renderTransitions(view); renderStates(view);
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

/**
 * Runs `fn` with the whole machine on the canvas, then puts the window back.
 *
 * Culling makes the DOM a view of the model rather than a copy of it, which is
 * invisible to everything that *looks* at the canvas and fatal to the two things
 * that read it back: buildExportSVG clones the live SVG, so a cropped export
 * taken mid-pan would contain the part of the machine that happened to be on
 * screen and a viewBox sized for all of it.
 *
 * The repaint on the way out is not optional either — leaving fifteen thousand
 * nodes in the document after an export would undo the whole optimisation for
 * the rest of the session.
 */
export function withFullRender(fn) {
  if (!cullingActive()) return fn();
  try {
    return suspendCulling(() => {
      renderTransitions(null);
      renderStates(null);
      return fn();
    });
  } finally {
    invalidateCull();
    // One decision for both, the way renderAll does it — two calls each asking
    // for their own rect could disagree if the camera moved in between.
    const view = cullViewport();
    renderTransitions(view);
    renderStates(view);
  }
}

/**
 * A camera move repaints by moving one transform; this is the exception. When
 * the pan or zoom has taken the screen outside the drawn window — or across a
 * level-of-detail threshold — the window has to be rebuilt. Coalesced to one
 * pass per frame, because a wheel gesture arrives as a burst of events.
 */
let camRepaintPending = false;
export function repaintForCamera() {
  if (camRepaintPending || !cullNeedsRepaint()) return;
  camRepaintPending = true;
  const run = () => {
    camRepaintPending = false;
    const view = cullViewport();
    renderTransitions(view);
    renderStates(view);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
}

// Resolves an edge key back to the transitions it covers. The listeners below
// call this at event time rather than closing over a group object: a node now
// survives across renders, and the layout pass regroups the transitions on
// every one, so a captured group would act on transitions that no longer exist.
function edgeGroupFor(key) {
  const sep = key.indexOf('|');
  const fromId = key.slice(0, sep), toId = key.slice(sep + 1);
  // Through the projection, not by filtering App.transitions: a drawn edge into
  // a collapsed block is the pair `s5|b1`, which does not exist in the model,
  // so the model cannot answer for it. A port edge has no transitions behind it
  // at all and answers null, which is what makes it inert to every listener.
  const ts = viewEdgeGroup(key);
  if (!ts || !ts.length) return null;
  const from = getNode(fromId), to = getNode(toId);
  if (!from || !to) return null;
  return { from, to, ts, grp: { from: fromId, to: toId, ts } };
}

// ── a machine id, resolved to the thing on screen ─────────────────
// The two lookups every surface that lights something on the canvas needs, in
// one place because they were being written out per surface and the model's own
// ids are *almost* always right — which is what makes getting them wrong so
// quiet. A state inside a collapsed block has no node of its own, and an edge
// that crosses a block's boundary is registered under `s5|b1`, a pair the model
// does not contain. Built from the model's ids, both lookups simply come back
// empty, and the caller lights nothing at all with nothing to say it failed.
//
// The registry first and a selector second, the way every other lookup here is
// written: after culling only the drawn window has nodes, and a state that is
// currently off screen has nothing to mark. The fallback is deliberately not
// scoped to `.sn` — the answer may be a block's box or a port's tab.

/**
 * The element standing for a real state: its own circle, or the box of whichever
 * block it is inside. Null when it is in some other branch of the tree entirely.
 */
export function drawnStateEl(stateId) {
  const id = visibleNodeIdFor(stateId);
  if (!id) return null;
  return App.domCache.states.get(id) || document.querySelector(`[data-id="${id}"]`);
}

/**
 * The edge group a real transition is drawn as, or null when it is not drawn —
 * which an edge wholly inside a collapsed block genuinely is not.
 */
export function drawnEdgeEl(transitionId) {
  const key = viewEdgeKeyFor(transitionId);
  if (!key) return null;
  return App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
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
  //
  // edgeLabelsHidden() rather than the style alone, so the large-machine
  // profile takes this branch too: on the diagrams it fires for, laying every
  // edge out around a box that is never drawn is the expensive half.
  if (edgeLabelsHidden()) return { w: 0, h: 0 };
  // Same reasoning for a scope's boundary edges: they carry no rule, so they
  // draw no label, so nothing should be laid out around one.
  if (ts.every(t => t.port)) return { w: 0, h: 0 };
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
    // A settled track returns its target unchanged (see easeTrack), so this is
    // exactly "nothing about this loop is mid-glide" — and the derived values
    // below would all rebuild to what `geo` already holds. Returning it saves an
    // object spread and a path rebuild per settled edge per frame, which on a
    // drag is every edge but the handful the moved state touched.
    if (angle === geo.angle) return geo;
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
  // Same early-out as the self-loop branch above: all three tracks settled means
  // the drawn edge is the laid-out edge, so there is nothing to build.
  if (crvVal === geo.crvVal && lx === geo.lx && ly === geo.ly) return geo;
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

/**
 * Where the start arrow is drawn, for whichever node control starts at.
 *
 * One function because there are two callers — the full render and the drag
 * path — and they had drifted: the drag path resolved `App.startId` against the
 * drawn states and measured a circle's radius, so with the start state inside a
 * block it found nothing at all and the arrow simply stayed where it was until
 * the next full render. The half-width is asked of the node, since a block is a
 * box and a state is a circle.
 */
function startArrowD(node) {
  const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
  const half = node.box ? node.box.w / 2 : R;
  return `M ${node.x - half - al} ${node.y} L ${node.x - half - ah} ${node.y}`;
}

/** Is this drawn edge the boundary of a scope rather than a rule? */
function isPortEdge(ts) {
  return !ts.length || ts.every(t => t.port);
}

// ── geometry writes ──
//
// A drag moves one state out of two hundred, and updateFastDOM below writes
// every node's coordinates on every frame regardless: at 200 states that is
// ~2,800 setAttribute calls per frame to move one circle. An attribute write is
// not free even when the value is identical — it re-parses the value and
// invalidates style for the element — so the cheapest write is the one not
// made.
//
// The value last written is cached **on the element**, under a name no
// attribute uses, so there is exactly one place that writes and caches and the
// two cannot fall out of step. That is the whole reason this is a helper rather
// than a guard at each call site: the cache is only safe while every writer of
// these attributes goes through it. This is the same rule `__labelKey` and
// `__labelX` already follow for the parts that are expensive to rebuild — see
// the note in CLAUDE.md about `sync*` writing classes unconditionally, which
// still holds: classes are toggled from canvas.js behind the renderer's back,
// and geometry is not.
function setGeoAttr(el, name, value) {
  const k = '__v_' + name;
  if (el[k] === value) return false;
  el[k] = value;
  el.setAttribute(name, value);
  return true;
}

function isEdgeSelected(ts) {
  return ts.some(t => App.selectedTransitions.has(t.id));
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
        // An edge is an object like any other: taking it drops whatever else
        // was selected, notes and dividers included.
        clearSelection();
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
      clearSelection();
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
    setGeoAttr(parts.handle, 'cx', geo.mx);
    setGeoAttr(parts.handle, 'cy', geo.my);
  }
}

function syncEdgeNode(edgeGrp, geo, ts, lod = false) {
  if (!geo) return false;
  const parts = edgeGrp.__parts;
  const selected = isEdgeSelected(ts);

  edgeGrp.classList.toggle('sel-t', selected);
  setGeoAttr(parts.pathEl, 'd', geo.d);
  setGeoAttr(parts.hitEl, 'd', geo.d);

  // Zoomed far enough out a label is a two-pixel smear: it costs a text node, a
  // shaping pass and a raster, and says nothing. `lod` takes the same branch as
  // the "labels off" setting — the point of that branch being that a hidden
  // label is never built, rather than built and then covered up.
  // A port edge is derived — it stands for the boundary of the scope rather
  // than for a rule — so it has no transition behind it and nothing to say.
  // Labelled anyway it reads `undefined → undefined, undefined`, which is what
  // asking transLabel() for the label of a thing that is not a transition
  // produces.
  const hidden = lod || edgeLabelsHidden() || isPortEdge(ts);
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

    // The tooltip is a grid and the accessible name is prose — see
    // edgeTipFor(). Two renderings of one description, and this is the branch
    // where the labels are not drawn at all, so the tooltip is the only way
    // left to read the edge.
    if (isPortEdge(ts)) {
      const say = 'The boundary of this block — control crosses here.';
      edgeGrp.setAttribute('data-tip', say);
      edgeGrp.setAttribute('aria-label', say);
      edgeGrp.classList.add('port-edge');
    } else {
      edgeGrp.classList.remove('port-edge');
      edgeGrp.setAttribute('data-tip', edgeTipFor(ts));
      edgeGrp.setAttribute('aria-label', ts.map(t => transLabelDescriptive(t)).join('\n'));
    }

    syncCurveHandle(edgeGrp, edgeGrp.getAttribute('data-edge'), geo, selected);
    return true;
  }

  edgeGrp.classList.remove('port-edge');
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
  setGeoAttr(parts.textEl, 'x', geo.lx);
  setGeoAttr(parts.textEl, 'y', geo.ly);

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
  setGeoAttr(parts.pillEl, 'transform', `translate(${geo.lx} ${geo.ly})`);
  parts.pillEl.classList.toggle('edge-pill-beginner', beginnerMode);
  parts.textEl.style.display = pillMode ? 'none' : '';
  parts.pillEl.style.display = pillMode ? '' : 'none';

  edgeGrp.setAttribute('data-tip', edgeTipFor(ts));
  edgeGrp.setAttribute('aria-label', ts.map(t => transLabelDescriptive(t)).join('\n'));

  syncCurveHandle(edgeGrp, edgeGrp.getAttribute('data-edge'), geo, selected);
  return true;
}

// The start-state arrow is a single node, kept in the same registry style as
// the edges so renderAll no longer has to re-query for it.
function syncStartArrow(g) {
  // The drawn node, which is the block's box when the start state is inside a
  // collapsed one — and nothing at all when it is in a branch of the tree the
  // reader has not drilled into.
  const s = App.startId ? getNode(startNodeId()) : null;
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
    a.setAttribute('marker-end', 'url(#arr)');
    App.domCache.startArrow = a;
  }
  // Stops short of the circle by the same `arrowHeadSize` every other edge
  // does, so the start arrow's head lands on the ring exactly where an incoming
  // transition's does. It used to stop at a third of that, which was right only
  // while the head's overhang was a stroke width; against the marker's fixed
  // overhang (see the <defs> in index.html) it would drive the point into the
  // node and leave a stub on the ring.
  setGeoAttr(a, 'd', startArrowD(s));
  // Always first in paint order, behind every edge.
  if (a !== g.firstChild) g.insertBefore(a, g.firstChild);
}

export function renderTransitions(view = cullViewport()) {
  const g = $('trans-g');
  const lg = $('trans-lbl-g');
  const live = App.domCache.transitions;
  const dt = beginPass();
  const ctx = currentLayoutContext({ viewport: view });
  lastCtx = ctx;

  syncStartArrow(g);

  const lod = edgeLabelLOD();
  let prev = App.domCache.startArrow || null;
  const seen = new Set();
  for (const { key, ts } of ctx.groups) {
    // The layout pass lays out only what is near the screen, so a missing geo
    // *is* the cull result. Testing it before the node is created is what keeps
    // an off-screen edge from being built and torn down on every pan frame.
    const geo = ctx.geo.get(key);
    if (!geo) continue;
    let node = live.get(key);
    if (!node) {
      node = createEdgeNode(key);
      live.set(key, node);
    }
    if (!syncEdgeNode(node, displayGeo(geo, dt), ts, lod)) continue;
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
// ── one paint per frame ──
//
// updateFastDOM used to be called straight from the pointermove handler, so the
// whole layout pass and every DOM write ran once per *event* rather than once
// per frame. Pointer events are not frame-aligned: a 1000Hz mouse, or any frame
// where the browser queues two moves behind a long task, ran the pass two or
// three times to paint one frame — and only the last of those was ever seen.
//
// The model still moves synchronously with the pointer, so a gesture reads the
// positions it just wrote; only the paint is deferred to the next frame.
//
// The pending flag is a boolean rather than the rAF handle because a
// synchronous requestAnimationFrame — which is what the test DOM installs —
// runs the callback *before* the handle is assigned, so a handle-based guard
// would latch on at 0 and refuse every later frame. anim.js makes the same
// allowance for the same stub.
let fastDOMPending = false;
let fastDOMStatesMoved = false;

export function scheduleFastDOM({ statesMoved = true } = {}) {
  // Whether states moved is OR-ed across everything coalesced into this frame:
  // a settle frame folded in with a drag frame is still a drag frame.
  if (statesMoved) fastDOMStatesMoved = true;
  if (fastDOMPending) return;
  fastDOMPending = true;
  const run = () => {
    fastDOMPending = false;
    const moved = fastDOMStatesMoved;
    fastDOMStatesMoved = false;
    updateFastDOM({ statesMoved: moved });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

/** Paints now, dropping any frame this scheduler was holding. */
export function flushFastDOM() {
  fastDOMPending = false;
  const moved = fastDOMStatesMoved;
  fastDOMStatesMoved = false;
  updateFastDOM({ statesMoved: moved });
}

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
  // `since` is what turns a drag frame into an incremental relayout: the pass
  // diffs the previous frame's recorded positions to find what moved and
  // rebuilds only the edges and labels that could have been affected. It is
  // handed only here, on the path that runs sixty times a second — a structural
  // edit goes through renderAll and takes a full pass, which is what keeps the
  // approximation in relayout() from accumulating past one gesture.
  const ctx = statesMoved || !lastCtx
    ? currentLayoutContext({ viewport: cullViewport(), since: lastCtx })
    : lastCtx;
  lastCtx = ctx;
  const stateById = ctx.stateById;

  // The registry, not App.states. They are the same list on a small machine and
  // very different on a culled one, and the registry is by definition the set
  // with something to write to — walking the model would be a thousand map
  // misses per frame to find the fifty nodes that exist.
  for (const [id, grp] of App.domCache.states) {
    if (!grp.__parts) continue;
    const s = stateById.get(id);
    if (!s) continue;
    const p = grp.__parts;
    // A block and a port are boxes, and moving one is a handful of attribute
    // writes on the box itself — never a rebuild of the preview inside it,
    // which is keyed on the interior and cannot have changed by a drag out here.
    if (grp.__kind === 'block') { moveBlockNode(grp, s); continue; }
    if (grp.__kind === 'port') { movePortNode(grp, s); continue; }
    // Asked of the node rather than of the machine: zoomed out far enough the
    // sub-label is not drawn at all, and the name then belongs on the centre
    // line rather than raised to make room for something that is not there.
    const hasSub = !!p.sub;
    setGeoAttr(p.circle, 'cx', s.x);
    setGeoAttr(p.circle, 'cy', s.y);
    if (p.ring) {
      setGeoAttr(p.ring, 'cx', s.x);
      setGeoAttr(p.ring, 'cy', s.y);
    }
    setGeoAttr(p.label, 'x', s.x);
    setGeoAttr(p.label, 'y', hasSub ? s.y - App.config.render.textMargin : s.y);
    if (grp.__labelX !== s.x) {
      for (const tspan of p.label.childNodes) tspan.setAttribute('x', s.x);
      grp.__labelX = s.x;
    }
    if (p.sub) {
      setGeoAttr(p.sub, 'x', s.x);
      setGeoAttr(p.sub, 'y', s.y + App.config.render.mooreTextMargin);
    }
    if (p.priority) {
      const bx = s.x + R * 0.88, by = s.y + R * 0.62;
      setGeoAttr(p.priority.bg, 'x', bx - 10);
      setGeoAttr(p.priority.bg, 'y', by - 8);
      setGeoAttr(p.priority.text, 'x', bx);
      setGeoAttr(p.priority.text, 'y', by);
    }
  }

  const startArrow = App.domCache.startArrow;
  if (startArrow && App.startId) {
    // The *drawn* node, which is the block's box when the start state is inside
    // a collapsed one. Resolved against App.startId the lookup simply missed —
    // that id names a state this level does not draw — so the arrow sat where it
    // was through the whole drag and only caught up on the next full render,
    // which is what a click on the background happens to cause.
    const s = getNode(startNodeId());
    if (s) setGeoAttr(startArrow, 'd', startArrowD(s));
  }

  for (const [key, edgeGrp] of App.domCache.transitions) {
    const p = edgeGrp.__parts;
    if (!p) continue;
    const geo = displayGeo(ctx.geo.get(key), dt);
    if (!geo) continue;

    setGeoAttr(p.pathEl, 'd', geo.d);
    setGeoAttr(p.hitEl, 'd', geo.d);
    setGeoAttr(p.textEl, 'x', geo.lx);
    setGeoAttr(p.textEl, 'y', geo.ly);
    setGeoAttr(p.pillEl, 'transform', `translate(${geo.lx} ${geo.ly})`);
    if (edgeGrp.__labelX !== geo.lx) {
      for (const tspan of p.textEl.childNodes) tspan.setAttribute('x', geo.lx);
      edgeGrp.__labelX = geo.lx;
    }
    if (p.handle) {
      setGeoAttr(p.handle, 'cx', geo.mx);
      setGeoAttr(p.handle, 'cy', geo.my);
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

// Geometry only, on the drag path. The preview inside a block is deliberately
// untouched: it is keyed on the interior, and dragging the box changes nothing
// about what is in it — rebuilding it per frame is exactly the cost the key
// exists to avoid.
function moveBlockNode(grp, node) {
  const p = grp.__parts;
  const w = node.box.w, h = node.box.h;
  const x = node.x - w / 2, y = node.y - h / 2;
  p.body.setAttribute('x', x);
  p.body.setAttribute('y', y);
  p.title.setAttribute('x', x + 8);
  p.title.setAttribute('y', y + BLOCK_STRIP_H / 2 + 4);
  p.count.setAttribute('x', x + w - 8);
  p.count.setAttribute('y', y + BLOCK_STRIP_H / 2 + 4);
  // The whole preview rides on one transform rather than being re-laid-out: it
  // was drawn for the box at __previewAt, so moving the box moves it.
  //
  // The clip rect is deliberately NOT moved with it, and that was the bug that
  // made a dragged block go blank. `clipPathUnits` defaults to `userSpaceOnUse`,
  // and an element's own `transform` establishes the user space its `clip-path`
  // is resolved in — so the translate below already carries the clip along with
  // the preview. Writing the new position onto the rect as well moved it twice,
  // and two boxes' worth of offset puts the clip clean off the block, which
  // clips the whole interior away.
  slideBlockPreview(grp, x, y);
}

/**
 * Puts a block's preview back under its box.
 *
 * **One function because there are two callers**, and they had drifted — the
 * same shape of bug `startArrowD()` carries its own note about. The drag path
 * called it; the full render did not, and a full render is the *only* thing
 * that runs after Arrange, a paste, an undo, an arrow-key nudge, a collision
 * push or the JFLAP importer's spread. Every one of those writes a block
 * record's coordinates without a member state moving — which is what
 * `blockPreviewKey` is built from, so the preview was neither rebuilt nor
 * re-translated and simply stayed where the box used to be. On a machine whose
 * layout had been rearranged, that is a canvas of empty boxes with their
 * diagrams scattered across the background.
 *
 * The translate is a delta from `__previewAt` — where the preview was *drawn* —
 * rather than an absolute position, because the interior is laid out in
 * absolute canvas coordinates once and then slid, which is what keeps a drag
 * frame from rebuilding a hundred child elements. The clip rect rides along:
 * `clipPathUnits` defaults to `userSpaceOnUse`, so this transform establishes
 * the space the clip resolves in, which is why the rect stays written at
 * `__previewAt` and must never be moved as well.
 */
function slideBlockPreview(grp, x, y) {
  const at = grp.__previewAt;
  if (!at) return;
  const dx = x - at.x, dy = y - at.y;
  grp.__parts.preview.setAttribute('transform', dx || dy ? `translate(${dx} ${dy})` : '');
}

/**
 * Where every part of a port tab sits.
 *
 * **One function with two callers** — the full render and the drag path — which
 * is the shape `startArrowD()` and `slideBlockPreview()` already carry their own
 * notes about, and for the same reason: they drifted. `movePortNode` moved the
 * body and the label and left the role and the arrow behind, so the moment
 * anything called `updateFastDOM` the tab came apart on screen: the box and one
 * line of text at the new position, the other line and the arrowhead stranded
 * wherever the tab had last been fully drawn. It also still wrote the label at
 * the old single-line offset, so even the part it did move was in the wrong
 * place once the tab grew a second row.
 *
 * Every offset a port has now lives here, and there is nowhere else for the two
 * paths to disagree.
 */
function placePortParts(p, node) {
  const w = node.box.w, h = node.box.h;
  p.body.setAttribute('x', node.x - w / 2);
  p.body.setAttribute('y', node.y - h / 2);
  p.body.setAttribute('width', w);
  p.body.setAttribute('height', h);
  // A tab, not a pill. A 999px radius made a boundary marker look like one of
  // the alphabet chips, which are things you can edit; this is chrome that
  // describes the diagram, and it wears the app's own box radius.
  p.body.setAttribute('rx', 7);
  p.role.setAttribute('x', node.x);
  p.role.setAttribute('y', node.y - 3);
  p.label.setAttribute('x', node.x);
  p.label.setAttribute('y', node.y + 10);
}

function movePortNode(grp, node) {
  placePortParts(grp.__parts, node);
}

// Break a state name into per-line words at underscore/space/hyphen
// boundaries, e.g. "NEW_ACCOUNT_OPENED" -> ["NEW","ACCOUNT","OPENED"],
// so long descriptive names stack inside the fixed-radius circle
// instead of overflowing it. Names with no such boundary are left as
// a single line untouched.
export function splitStateLabel(name) {
  if (!wrapStateLabelsOn()) return [String(name)];
  // `/` joins a building block's name to its interior state's — `copy/scan` —
  // so it wraps like the other separators rather than overflowing the circle.
  const parts = String(name).split(/[_\s/-]+/).filter(Boolean);
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
    // Only a machine with a stay move can leave a block without consuming a
    // symbol, so only those can have one at all (see machineSupportsBlocks).
    // Offered on the others, the row led to a naming dialog and *then* a toast
    // saying it was never possible — a refusal three steps after the click that
    // should have been the answer.
    const groupOpt = $('ctx-group-block');
    if (groupOpt) groupOpt.style.display = machineSupportsBlocks() ? '' : 'none';
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
function syncStateNode(g, s, showAccepts, lod = false) {
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

  setGeoAttr(parts.circle, 'cx', s.x);
  setGeoAttr(parts.circle, 'cy', s.y);
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
    setGeoAttr(parts.ring, 'cx', s.x);
    setGeoAttr(parts.ring, 'cy', s.y);
    parts.ring.setAttribute('r', R - 5);
  }

  // Two things want a second line under the name: a Moore output and a parity
  // priority. They never coexist (one is a transducer, the other an
  // ω-automaton), so they share the slot rather than each having their own.
  // What the machine *has* and what is *drawn* part company here: at LOD the
  // sub-label and the priority badge are not painted, but the tooltip still has
  // to say what the state is — hovering is how you read a node too small to
  // read, so it is the one thing that must not thin out with the drawing.
  const hasMoore = hasStateOutput(App.machine);
  const hasParity = usesParityPriorities(App.machine);
  const isMoore = hasMoore && !lod;
  const isParity = hasParity && !lod;
  const hasSub = isMoore;
  setGeoAttr(parts.label, 'x', s.x);
  setGeoAttr(parts.label, 'y', hasSub ? s.y - App.config.render.textMargin : s.y);
  // As above: the tspans say the state's name, which a move does not change.
  // The LOD key is a value of its own rather than an empty name, so returning
  // from a zoomed-out view rebuilds the tspans instead of matching a stale key.
  const labelKey = lod ? '::lod::' : `${s.name}\u0001${wrapStateLabelsOn()}`;
  if (lod) {
    if (g.__labelKey !== labelKey) {
      parts.label.innerHTML = '';
      g.__labelKey = labelKey;
      g.__labelX = s.x;
    }
  } else if (g.__labelKey !== labelKey) {
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
    setGeoAttr(parts.sub, 'x', s.x);
    setGeoAttr(parts.sub, 'y', s.y + App.config.render.mooreTextMargin);
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
    setGeoAttr(parts.priority.bg, 'x', bx - 10);
    setGeoAttr(parts.priority.bg, 'y', by - 8);
    parts.priority.bg.setAttribute('width', 20);
    parts.priority.bg.setAttribute('height', 16);
    parts.priority.bg.setAttribute('rx', 8);
    setGeoAttr(parts.priority.text, 'x', bx);
    setGeoAttr(parts.priority.text, 'y', by);
    parts.priority.text.textContent = String(statePriority(s));
  }

  let stTitle = `State '${s.name}'`;
  if (isStart || isAcc) {
    const statuses = [];
    if (isStart) statuses.push('Start');
    if (isAcc) statuses.push('Accept');
    stTitle += ` (${statuses.join(', ')})`;
  }
  if (hasMoore) {
    const o = s.output !== undefined && s.output !== '' ? s.output : App.config.sym.lambda;
    stTitle += `\nOutput: '${o}'`;
  }
  if (hasParity) {
    const p = statePriority(s);
    stTitle += `\nPriority: ${p} (${p % 2 === 0 ? 'even — accepting if least' : 'odd — rejecting if least'})`;
  }
  g.setAttribute('data-tip', stTitle);
  g.setAttribute('aria-label', stTitle);
}

// ══════════════════════════════════════════════════════════════════
//  BUILDING BLOCKS, AS NODES
// ══════════════════════════════════════════════════════════════════
// A block is drawn as what it contains: a box, a title strip across the top,
// and under it the machine inside, drawn the way the minimap draws the whole
// diagram. That is not decoration — it is how a reader tells the adder from the
// multiplier at a glance, the same way they read the minimap.
//
// The geometry comes from js/graph-thumb.js, which the minimap also uses, so
// the preview and the map cannot drift into two things that merely look alike.
//
// It is real SVG rather than a <canvas> in a <foreignObject>, and that is not a
// preference: buildExportSVG rasterises through `img.src = blob:`, and an SVG
// loaded *as an image* renders no foreignObject content at all — every block
// would export as an empty box. Real elements also follow the theme and scale
// with the zoom, which a rasterised thumbnail does not.

function createBlockNode(id) {
  const g = makeSVG('g');
  g.classList.add('bn');
  g.setAttribute('data-id', id);
  g.setAttribute('data-block-id', id);
  g.__kind = 'block';

  const body = makeSVG('rect');
  body.classList.add('bn-body');
  g.appendChild(body);

  // The preview is clipped to the body, and lives in its own group. That is
  // load-bearing rather than tidy: everything inside it is rebuilt only when the
  // interior changes, so a drag moves the box without touching a hundred child
  // elements — which is what makes updateFastDOM affordable with blocks on
  // screen.
  const clip = makeSVG('clipPath');
  clip.setAttribute('id', 'bn-clip-' + id);
  const clipRect = makeSVG('rect');
  clip.appendChild(clipRect);
  const defs = $('canvas-defs');
  (defs || g).appendChild(clip);

  const preview = makeSVG('g');
  preview.classList.add('bn-preview');
  preview.setAttribute('clip-path', 'url(#bn-clip-' + id + ')');
  const pvEdges = makeSVG('path');
  pvEdges.classList.add('bn-pv-edges');
  preview.appendChild(pvEdges);
  // The edge a run is taking right now, drawn over the quiet ones and under the
  // node dots — the order the canvas itself uses. It is a *second path* rather
  // than a class on the first because every preview edge shares one `d`: at this
  // scale a path per edge is a hundred elements per box, which is exactly the
  // cost the single path exists to avoid. One more path is one more element.
  const pvActive = makeSVG('path');
  pvActive.classList.add('bn-pv-active');
  preview.appendChild(pvActive);
  const pvNodes = makeSVG('g');
  pvNodes.classList.add('bn-pv-nodes');
  preview.appendChild(pvNodes);
  g.appendChild(preview);

  // There is deliberately no filled title strip. It was a second fill laid over
  // the body, and painting a rectangle on top of a rounded one is a shape
  // problem with no good answer: square, it left pointed ears past the box's top
  // corners; rounded to match, the two radii met in a visible notch. The title
  // does not need a band behind it to read as a title — the box already frames
  // it. BLOCK_STRIP_H survives as *reserved space*: the preview is clipped to
  // start below it, so nothing is ever drawn under the name.
  const title = makeSVG('text');
  title.classList.add('bn-title');
  g.appendChild(title);
  const count = makeSVG('text');
  count.classList.add('bn-count');
  g.appendChild(count);

  g.__parts = { body, title, count, preview, pvEdges, pvActive, pvNodes, clip, clipRect };
  g.__previewKey = null;

  // Opening is decided on `pointerdown`, from two presses of our own, and NOT
  // from the native `dblclick` — which never arrives here. onStateDown ends in
  // `wrap.setPointerCapture(e.pointerId)`, and a captured pointer retargets the
  // compatibility mouse events to the capturing element, so the second click and
  // the `dblclick` are computed against `#canvas-wrap` rather than against this
  // group. Two things followed: this listener never ran, and the canvas's own
  // dblclick handler saw `e.target === wrap`, passed its "empty background"
  // test, and created a state on top of the block being opened. js/panel-float.js
  // records the same retargeting trap for the same reason.
  g.addEventListener('pointerdown', e => {
    const touch = (e.pointerType || 'mouse') === 'touch';
    g.dataset.lastPointerType = e.pointerType || 'mouse';
    const now = Date.now();
    const near = g.__lastDownAt && now - g.__lastDownAt < DOUBLE_PRESS_MS;
    g.__lastDownAt = now;
    if (near && !touch && e.button === 0) {
      g.__lastDownAt = 0;
      e.preventDefault();
      e.stopPropagation();
      enterBlockScope(id);
      return;
    }
    onStateDown(e, id);
  });
  g.addEventListener('contextmenu', e => {
    e.preventDefault();
    App.ctxId = id;
    App.ctxEdge = null;
    App.ctxMode = 'block';
    showContextMenu('block', e.clientX, e.clientY);
  });
  return g;
}

// The window in which two presses on a block mean "open it". The platform
// default is ~500ms and this is the same gesture, judged by us because the
// native event cannot reach the node — see createBlockNode.
const DOUBLE_PRESS_MS = 450;

// The body's corner radius. One shape now carries it, which is the point: see
// createBlockNode for why there is no second filled shape on top of it.
const BLOCK_RADIUS = 10;

// How many drawn elements one preview may build — a block with three hundred
// states in it says so on the strip and draws a readable sample rather than
// three hundred dots nobody can tell apart — now asked of the profile rather
// than written here, because the previews are what a level made of boxes costs
// and so are what the profile has to be able to reach. See previewNodeBudget()
// in js/state.js.

function syncBlockNode(g, node, lod) {
  const p = g.__parts;
  const w = node.box.w, h = node.box.h;
  const x = node.x - w / 2, y = node.y - h / 2;

  g.classList.toggle('sel-st', App.selectedStates.has(node.id));

  p.body.setAttribute('x', x);
  p.body.setAttribute('y', y);
  p.body.setAttribute('width', w);
  p.body.setAttribute('height', h);
  p.body.setAttribute('rx', BLOCK_RADIUS);

  p.title.setAttribute('x', x + 8);
  p.title.setAttribute('y', y + BLOCK_STRIP_H / 2 + 4);
  p.title.textContent = node.name;

  p.count.setAttribute('x', x + w - 8);
  p.count.setAttribute('y', y + BLOCK_STRIP_H / 2 + 4);

  // Below the label threshold a preview is a smudge costing a hundred elements,
  // so it goes at the same place on the zoom dial the names do. The key is
  // derived rather than invalidated, because nothing announces that a state
  // inside a block moved — the same trick stateIndex() uses.
  //
  // **Everything past this line is behind the key, and that is the point.**
  // blockPreviewGraph() walks App.states *and* App.transitions once per block,
  // so calling it before the guard — to count what is inside — made an idle
  // repaint cost the whole machine per block on screen. Measured on twelve boxes
  // over 4800 states: 6.4ms of an 8.3ms repaint, on a canvas drawing twelve
  // nodes. The count is cached beside the key for the same reason.
  //
  // That measurement is also what put the profile through the boxes. It used to
  // read `largeMachineProfile()` as no help here, because drawnSize() reported
  // twelve and the profile stayed off while the frame cost what a 4800-state
  // machine costs — which was a true observation about a wrong rule rather than
  // a fact about previews. A box weighs the subtree it stands for now, so that
  // canvas is judged large and the budget below comes down with everything
  // else. See drawnSize() in js/state.js.
  // The budget is part of the key. It is not derived from the machine — it
  // moves when the profile flips, which a state moving into or out of some
  // other block can cause — so a preview drawn at the old budget would keep its
  // hundred and twenty dots until its own interior happened to change.
  const budget = previewNodeBudget();
  const key = lod ? '::lod::'
    : blockPreviewKey(node.id) + '|' + Math.round(w) + '|' + Math.round(h) + '|' + budget;
  const stale = g.__previewKey !== key;
  let inside = null;
  if (stale) {
    inside = blockPreviewGraph(node.id);
    g.__previewKey = key;
    g.__previewBudget = budget;
    // The *count* is cached, never the graph: holding the graph would pin every
    // member state and every edge of the block's interior for as long as the
    // node is on screen, which is the memory half of the cost this guard avoids.
    g.__previewTotal = inside ? inside.nodes.length : 0;
  }
  const total = g.__previewTotal || 0;
  p.count.textContent = lod ? '' : String(total);
  // Written every sync, not only on a rebuild: the tip names the block, and a
  // rename changes the name without changing anything the preview key is built
  // from.
  syncBlockTip(g, node, total);

  // The preview is drawn in absolute coordinates for this box, and the drag
  // path then slides it with one transform. Recording where it was drawn is
  // what lets that translate be a delta rather than an accumulating offset.
  if (stale) {
    p.preview.setAttribute('transform', '');
    g.__previewAt = { x, y };
  } else {
    // The box may have moved since the preview was drawn, by any of the paths
    // that end in a full render rather than in a drag frame. See
    // slideBlockPreview — this is the half that was missing.
    slideBlockPreview(g, x, y);
  }

  // The clip is the body below the strip: the preview must never paint over the
  // title, and a rounded body cannot clip its own children.
  //
  // It is written in the frame the preview was *drawn* in, not where the box is
  // now, and those are different the moment a block is dragged. `clipPathUnits`
  // defaults to `userSpaceOnUse` and the preview's own transform establishes the
  // space its `clip-path` resolves in — so the translate moveBlockNode wrote
  // carries the clip along with the content, and writing the box's new position
  // onto the rect here moved the clip a second time. Past a box's width that put
  // it clean off the block, and the whole interior was clipped away: a preview
  // that vanished on some blocks and not others, depending on how far each had
  // been dragged. The two must share one frame, and `__previewAt` is it.
  const at = g.__previewAt || { x, y };
  const pv = { x: at.x + 1, y: at.y + BLOCK_STRIP_H, w: w - 2, h: h - BLOCK_STRIP_H - 1 };
  p.clipRect.setAttribute('x', pv.x);
  p.clipRect.setAttribute('y', pv.y);
  p.clipRect.setAttribute('width', Math.max(0, pv.w));
  p.clipRect.setAttribute('height', Math.max(0, pv.h));

  if (!stale) return;

  if (lod || !inside) {
    p.pvEdges.setAttribute('d', '');
    p.pvActive.setAttribute('d', '');
    p.pvNodes.innerHTML = '';
    g.__pvIndex = null;
    g.__pvEdgeD = null;
    return;
  }
  drawPreview(g, inside, pv, budget);
}

function drawPreview(g, inside, box, budget) {
  const p = g.__parts;
  const nodes = inside.nodes.slice(0, budget);
  const shown = new Set(nodes.map(n => n.id));
  const bounds = thumbBounds(nodes, R, n => (n.box ? Math.hypot(n.box.w, n.box.h) / 2 : R));
  const fit = thumbFit(bounds, { x: box.x, y: box.y, w: box.w, h: box.h });
  const r = thumbNodeRadius(fit.scale, R);

  const pairs = thumbEdgePairs(inside.edges.filter(e => shown.has(e.from) && shown.has(e.to)));
  const segments = thumbEdgeSegments(pairs, inside.byId, fit, r, App.config.render.curveOff);
  p.pvEdges.setAttribute('d', thumbEdgePath(segments));
  p.pvActive.setAttribute('d', '');

  // ── what the playback highlight addresses ──
  // Two lookups, built in the loops that were already running rather than by a
  // second pass: a state's dot, and one drawn edge's subpath. Both live only as
  // long as the preview does — they are dropped whenever it is rebuilt or the
  // LOD blanks it, and the node is evicted with the box when it scrolls off.
  //
  // The *graph* is deliberately still not retained (see the note in
  // syncBlockNode): these hold ids and elements that are alive anyway, plus one
  // short string per drawn edge — the same characters `pvEdges` already carries,
  // split up. Both are bounded by the preview budget, which is what bounds the
  // preview itself.
  const index = new Map();
  const edgeD = new Map();
  for (const s of segments) edgeD.set(s.key, thumbSubpath(s));
  g.__pvIndex = index;
  g.__pvEdgeD = edgeD;

  // A nested block draws as a tiny rect rather than a circle, so the silhouette
  // itself says there is another level below this one.
  p.pvNodes.innerHTML = '';
  for (const n of nodes) {
    const el = makeSVG(n.kind === 'block' ? 'rect' : 'circle');
    if (n.kind === 'block') {
      el.setAttribute('x', fit.px(n.x) - r);
      el.setAttribute('y', fit.py(n.y) - r * 0.72);
      el.setAttribute('width', r * 2);
      el.setAttribute('height', r * 1.44);
      el.setAttribute('rx', Math.max(0.6, r * 0.28));
      el.classList.add('bn-pv-block');
    } else {
      el.setAttribute('cx', fit.px(n.x));
      el.setAttribute('cy', fit.py(n.y));
      el.setAttribute('r', r);
      el.classList.add('bn-pv-node');
      if (App.accepts.has(n.id)) el.classList.add('is-accept');
      if (n.id === App.startId) el.classList.add('is-start');
    }
    index.set(n.id, el);
    p.pvNodes.appendChild(el);
  }
}

function syncBlockTip(g, node, total) {
  const tip = 'Block ‘' + node.name + '’\n'
    + total + ' item' + (total === 1 ? '' : 's') + ' inside'
    + '\nDouble-click to open';
  g.setAttribute('data-tip', tip);
  g.setAttribute('aria-label', tip);
}

// ── ports ──
// The tabs on the edge of a drilled-in scope. They are derived and carry no
// transitions of their own; what they do is say where control arrives from and
// where each exit hands it back, which is most of what a reader drills in to
// find out. Without them a drilled-in view reads as a disconnected fragment.
//
// They are not selectable — there is no port in the model to select, and Delete
// over one would have nothing to delete — but they *are* draggable, because
// where a tab sits is a legibility question the placement pass can only guess
// at. `onPortDown` writes the offset onto the block record; placePorts then
// stands down for that port. Same relationship `t.curve` has to auto-routing.
function createPortNode(id) {
  const g = makeSVG('g');
  g.classList.add('pn');
  g.setAttribute('data-id', id);
  g.__kind = 'port';
  const body = makeSVG('rect');
  body.classList.add('pn-body');
  g.appendChild(body);
  // Two rows, the way the app labels everything else: LANGUAGE / MTM,
  // ALPHABET Σ / 2. The role is the block's own word for this crossing and the
  // target is where it goes, and one line could only ever carry one of them.
  const role = makeSVG('text');
  role.classList.add('pn-role');
  g.appendChild(role);
  const label = makeSVG('text');
  label.classList.add('pn-label');
  g.appendChild(label);
  g.__parts = { body, role, label };
  g.addEventListener('pointerdown', e => onPortDown(e, id));
  // Double-click hands a hand-placed tab back to the placement pass — the
  // "Reset Shape" a bent edge gets, in the one gesture a port has spare. It is
  // read off the node rather than guarded here, so a port that was never moved
  // simply has nothing to reset.
  g.addEventListener('dblclick', e => {
    e.stopPropagation();
    resetPortPlacement(id);
  });
  // Click follows the crossing to wherever its other end lives.
  //
  // Which generalises "go back out" rather than replacing it: when the other
  // end is on the level immediately outside — the commonest case by far, and
  // the only one that used to draw a tab at all — going to its scope *is*
  // going out one level, so the gesture is unchanged for every port that
  // existed before. What it adds is the case a fixed "up one" cannot serve: a
  // tab on a nested block whose edge runs to the grandparent level, or into a
  // sibling subtree, where up-one lands somewhere the edge does not go.
  //
  // Suppressed by a drag: `onPortDown` arms the swallow the moment the pointer
  // travels, the way js/panel-float.js does it for a window's title bar — or
  // every reposition would end by leaving the scope it repositioned in.
  g.addEventListener('click', e => {
    if (g.__dragged) { g.__dragged = false; e.stopPropagation(); return; }
    followPort(id);
  });
  return g;
}

/**
 * Go to where a port's crossing actually goes, and select the state it lands on.
 *
 * A tab with nothing behind it — a declared entry or exit nobody has wired yet —
 * still means "out", because that is what the boundary it sits on means.
 */
function followPort(id) {
  const node = getNode(id);
  const first = node?.crossings?.[0];
  if (!first) { enterBlockScope(null, { up: 1 }); return; }
  const other = getState(first.other);
  if (!other) { enterBlockScope(null, { up: 1 }); return; }
  enterBlockScope(null, { to: blockAncestry(other.blockId || null).map(b => b.id) });
  clearSelection();
  const landed = visibleNodeIdFor(other.id);
  if (landed) {
    App.selectedStates.add(landed);
    emit(Change.CANVAS);
  }
}

function syncPortNode(g, node) {
  const p = g.__parts;
  g.classList.toggle('is-in', node.dir === 'in');
  g.classList.toggle('is-out', node.dir === 'out');
  g.classList.toggle('is-manual', !!node.manual);
  g.classList.toggle('is-empty', !!node.empty || node.crossings?.length === 0);
  // A crossing the block did not declare is drawn differently rather than
  // silently like the others. It is genuinely different: a block whose boundary
  // is not the one it declares is not a clean subroutine, so placing a copy of
  // it elsewhere would not compose — and that is worth saying on the diagram
  // rather than in a panel nobody opens.
  g.classList.toggle('is-stray', node.declared === false);
  placePortParts(p, node);
  p.role.textContent = node.role ?? '';
  p.label.textContent = node.target ?? node.name;
  g.setAttribute('data-tip', portTip(node));
  g.setAttribute('aria-label', portAria(node));
}

/**
 * What a tab says on hover: every crossing behind it, with the full path of the
 * other end.
 *
 * Columnar, the way js/states-transitions.js builds an edge's tooltip — the tab
 * itself is 96px and has to be terse, so the count and the hop marker are all
 * it can carry, and this is where the reader finds out which four states the
 * "+3" was. The box is bounded and the content is not; see js/tooltip.js.
 */
function portTip(node) {
  const rows = [];
  // The heading names the crossing in the block's own terms where it has any:
  // an exit's declared label, and "the entry" for the one way in a block
  // declares. The `in` branch used to hold a ternary with two empty arms, so an
  // undeclared arrival read exactly like the declared one and the row below was
  // the only thing that distinguished them.
  rows.push(node.dir === 'in'
    ? `Control enters here${node.declared ? ' — the entry' : ''}`
    : `Control leaves here${node.role && node.declared ? ` — “${node.role.toLowerCase()}”` : ''}`);
  if (node.declared === false) {
    rows.push('---');
    rows.push(node.dir === 'in'
      ? 'Not the block\u2019s declared entry'
      : 'Not one of the block\u2019s declared exits');
  }
  const list = node.crossings || [];
  if (list.length) {
    rows.push('---');
    rows.push(node.dir === 'in' ? 'From\tOn' : 'To\tOn');
    for (const c of list.slice(0, PORT_TIP_ROWS)) {
      rows.push(`${c.path || c.other}\t${transLabel(c.t)}`);
    }
    if (list.length > PORT_TIP_ROWS) rows.push(`${list.length - PORT_TIP_ROWS} more`);
  } else {
    rows.push('---');
    rows.push('Nothing is wired to it yet');
  }
  rows.push('---');
  rows.push('Click to follow it. Drag to move the tab'
    + (node.manual ? ', double-click to place it automatically again' : '') + '.');
  return rows.join('\n');
}

// Far past anything a reader meets — a boundary state with two hundred crossings
// is pathological, and this only stops one building an unbounded grid on hover.
const PORT_TIP_ROWS = 24;

// Prose, not a table: a screen reader should hear a sentence rather than a grid
// read left to right. The same split transLabelDescriptive makes.
function portAria(node) {
  const where = node.dir === 'in' ? 'Control enters here' : 'Control leaves here';
  const undeclared = node.declared === false ? ', which the block does not declare' : '';
  const ends = (node.crossings || []).map(c => c.path || c.other);
  const says = ends.length
    ? ` ${node.dir === 'in' ? 'From' : 'To'} ${ends.slice(0, 3).join(', ')}${ends.length > 3 ? ` and ${ends.length - 3} more` : ''}.`
    : ' Nothing is wired to it yet.';
  return `${where}${undeclared}.${says} Click to follow it.`;
}

export function renderStates(view = cullViewport()) {
  const g = $('states-g');
  const live = App.domCache.states;
  const showAccepts = acceptsAreShown();
  const lod = stateLabelLOD();

  // The projection, not App.states: inside a block those are very different
  // lists, and with no blocks on the canvas they are the same one. See
  // js/view-graph.js.
  //
  // A state's ink reaches a radius and a little slack from its centre; a block's
  // reaches half its box, so the cull pad is asked of the node rather than being
  // one number for the pass.
  let prev = null;
  const seen = new Set();
  for (const s of viewStates()) {
    const pad = (s.box ? Math.max(s.box.w, s.box.h) / 2 : R) + 24;
    if (view && !rectHasPoint(view, s.x, s.y, pad)) continue;
    seen.add(s.id);
    let node = live.get(s.id);
    const kind = s.kind || 'state';
    // A node whose kind changed is a different drawing entirely — a state just
    // grouped into a block, say — so it is replaced rather than re-synced onto
    // parts that do not exist on it.
    if (node && (node.__kind || 'state') !== kind) { evictNode(node); node = null; }
    if (!node) {
      node = kind === 'block' ? createBlockNode(s.id)
        : kind === 'port' ? createPortNode(s.id)
          : createStateNode(s.id);
      live.set(s.id, node);
    }
    if (kind === 'block') syncBlockNode(node, s, lod);
    else if (kind === 'port') syncPortNode(node, s);
    else syncStateNode(node, s, showAccepts, lod);
    const expected = prev ? prev.nextSibling : g.firstChild;
    if (node !== expected) g.insertBefore(node, expected);
    prev = node;
  }

  for (const [id, node] of live) {
    if (seen.has(id)) continue;
    evictNode(node);
    live.delete(id);
  }
}

// A block's clipPath lives in <defs>, outside its own group, so evicting the
// node has to take it too — otherwise a session of drilling in and out leaves a
// clipPath per block per visit in the document.
function evictNode(node) {
  if (node.__parts && node.__parts.clip) node.__parts.clip.remove();
  node.remove();
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════════════════
/**
 * Write a section's count chip.
 *
 * Exported because the right panel has one too — the Trace card's — and it is
 * written from js/simulation.js as the run grows. Two copies of "set the text
 * and mute it when it is zero" is how the Trace count came to be a bare number
 * beside a pill on every other section.
 */
export function setSectionCount(el, value) {
  if (!el) return;
  el.textContent = String(value);
  // Empty sections get a muted chip so a populated count reads as the
  // signal rather than every section shouting equally.
  if (value) el.removeAttribute('data-empty');
  else el.setAttribute('data-empty', '1');
}

export function updateLPanelSectionMeta() {
  const setCount = (id, value) => setSectionCount($(id), value);

  setCount('lp-count-sigma', App.sigma?.size || 0);
  setCount('lp-count-stack', App.stackAlpha?.size || 0);
  setCount('lp-count-output', App.outputAlpha?.size || 0);
  // The counts follow the lists under them, which show this level rather than
  // the whole machine. The formal definition beside them still reports |Q| for
  // the machine, which is the honest number there: a block is a drawing, and
  // every state inside one is a state the machine really has.
  const drawn = viewStates();
  const shown = new Set(drawn.map(s => s.id));
  setCount('lp-count-states', drawn.filter(s => s.kind === undefined).length);
  setCount('lp-count-trans', (App.transitions || []).filter(t => shown.has(t.from) && shown.has(t.to)).length);
  setCount('lp-count-blocks', (App.blocks?.length || 0));
}

// What the Blocks list draws, cheaply: the records themselves change on a
// rename, a re-parent, a group or a delete, and the member counts change only
// when a state's `blockId` does — which is what the states array's own identity
// test catches. Deliberately not built from allBlocks(), which is the expensive
// thing this key exists to skip.
function blockListKey() {
  const bl = App.blocks || [];
  const st = App.states || [];
  const parts = [(App.scope || []).join('/'), bl.length, st.length, st[0]?.id, st[st.length - 1]?.id];
  for (const b of bl) parts.push(b.id, b.name, b.parent || '');
  return parts.join('|');
}

/**
 * Every block in the machine, at whatever depth, as a list you can jump from.
 *
 * Double-clicking a box on the canvas opens it, but that only ever reaches what
 * is on screen — inside a CPU the multiplier is three levels down and its box
 * is not drawn until you are standing next to it. The path is what makes the
 * list readable: two blocks called `add` in different ALUs are one name and two
 * rows, and the path is the only thing that tells them apart.
 */
let _blockListPainted = null;
export function _resetBlockListPainted() { _blockListPainted = null; }

export function updateBlockList() {
  const host = $('block-list');
  if (!host) return;
  // Guarded, because this is subscribed to *every* GRAPH emit and allBlocks()
  // costs one pass over App.states per block — a drag, an accept toggle or a
  // simulation step would otherwise pay blocks × states to redraw rows that had
  // not changed. The key is what the rows actually draw, the way lpanelKey() is.
  // Tested on the markup rather than on childNodes: this list is written as one
  // innerHTML string, so the string *is* what "already drawn" means — and a
  // workspace switch that replaced the panel's subtree leaves it empty, which is
  // exactly when the cache must not be believed.
  const key = blockListKey();
  if (key === _blockListPainted && host.innerHTML) return;
  _blockListPainted = key;
  const rows = allBlocks();
  if (!rows.length) {
    host.innerHTML = '<div class="empty-msg">No blocks</div>';
    return;
  }
  const here = (App.scope || [])[(App.scope || []).length - 1] || null;
  // A <button>, not a <div onclick>: a row that opens something has to be
  // reachable with Tab and firable with Enter, which is the rule the States Q
  // and Transitions δ rows already follow.
  host.innerHTML = rows.map(b => `
    <button type="button" class="bi${b.id === here ? ' is-current' : ''}" onclick="openBlockFromList('${b.id}')"
         data-tip="Open ${escapeHtml(b.name)}"${b.id === here ? ' aria-current="true"' : ''}>
      <div class="lp-row-body">
        <div class="bi-name">${escapeHtml(b.name)}</div>
        <div class="bi-sub">${b.path ? escapeHtml(b.path) + ' · ' : ''}${b.members} state${b.members === 1 ? '' : 's'}${b.children ? ` · ${b.children} block${b.children === 1 ? '' : 's'}` : ''}</div>
      </div>
    </button>`).join('');
}

// Every row in the States Q and Transitions δ lists ends in the same pair of
// controls, so the pair is written once. They were not the same before: a state
// carried a pencil and no way to delete, a transition carried a delete and no
// way to edit, and the two were built from different elements — the pencil a
// <button>, the × a <span>, which is why only one of them could be reached by
// Tab or fired with Enter. Both are buttons here, both reveal on hover or focus,
// and both stop the click from reaching the row's own focus-the-canvas handler.
const LP_ICON_EDIT = 'M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z';
const LP_ICON_DELETE = 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z';

function lpRowBtn(call, label, path, cls) {
  return `<button type="button" class="lp-row-btn ${cls}" onclick="event.stopPropagation(); ${call}"
    data-tip="${label}" aria-label="${label}"><svg viewBox="0 0 256 256" width="11" height="11" fill="currentColor"><path d="${path}"/></svg></button>`;
}

function rowActions(editCall, editLabel, deleteCall, deleteLabel) {
  return `<span class="lp-row-acts">${lpRowBtn(editCall, editLabel, LP_ICON_EDIT, 'is-edit')}${lpRowBtn(deleteCall, deleteLabel, LP_ICON_DELETE, 'is-del')}</span>`;
}

// The two lists are handed to js/panel-list.js as data plus a row renderer,
// rather than being joined into one enormous innerHTML string. What a row says
// stays here; how many of them exist at a time is that module's problem. The
// markup is unchanged, inline handlers included, so nothing moves in bridge.js.
export function stateRowHTML(s) {
  const showAccepts = acceptsAreShown();
  let mooreOut = '';
  if (hasStateOutput(App.machine)) {
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
  <span class="lp-row-body">${escapeHtml(s.name)}${mooreOut}</span>
  ${rowActions(`openStateModal('${s.id}')`, `Edit state ${escapeHtml(s.name)}`,
    `deleteState('${s.id}')`, `Delete state ${escapeHtml(s.name)}`)}
  <div class="dot"></div>
</div>`;
}

export function transRowHTML(t) {
  const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
  const sel = App.selectedTransitions.has(t.id) ? 'lp-selected' : '';
  // The same grid the canvas edge shows, plus what a click here does. Tabs
  // and newlines both survive an attribute value, which is what lets the
  // columnar form travel through data-tip at all.
  const fullTitle = `${edgeTipFor([t])}\n---\nClick to focus · Double-click to edit`;
  const label = escapeHtml(`${fn} –${transLabel(t)}→ ${tn}`);
  return `<div class="ti ${sel}" onclick="focusTransFromList('${t.id}')" ondblclick="editTransFromList('${t.id}')"
  onmouseenter="hlTransListHover('${t.from}','${t.to}', true)" onmouseleave="hlTransListHover('${t.from}','${t.to}', false)"
  data-tip="${fullTitle.replace(/"/g, '&quot;')}">
  <span class="lp-row-body"><span class="ti-from">${escapeHtml(fn)}</span><span class="arr">–${escapeHtml(transLabel(t))}→</span><span class="ti-to">${escapeHtml(tn)}</span></span>
  ${rowActions(`editTransFromList('${t.id}')`, `Edit transition ${label}`,
    `deleteTrans('${t.id}')`, `Delete transition ${label}`)}
</div>`;
}

// What the search box matches a row against. It used to read the rendered row's
// textContent, which is only available for rows that exist — the filter has to
// answer for the ones that do not.
function stateRowText(s) {
  if (hasStateOutput(App.machine)) return `${s.name} / ${s.output ?? ''}`;
  if (usesParityPriorities(App.machine)) return `${s.name} ${statePriority(s)}`;
  return String(s.name);
}

function transRowText(t) {
  return `${getState(t.from)?.name || '?'} ${transLabel(t)} ${getState(t.to)?.name || '?'}`;
}

// What the two lists last drew. updateLPanel rebuilds both of them on every
// emit(Change.GRAPH) — 6.95ms on a 200-state machine, roughly a fifth of the
// whole delivery — including the many edits that change neither. Toggling one
// accept mark redrew 200 state rows and 400 transition rows.
//
// The key is built from what the rows actually render rather than from
// structure alone, because a rename changes no id and a retargeted or relabelled
// edge changes no count. Transition fields are enumerated rather than listed:
// they differ per machine (a TM carries write/move, a PDA pop/push, an MTM three
// arrays), so a hand-written list here would fall behind the next machine added
// and silently stop redrawing for it. Geometry is skipped — curve and loopAngle
// are not drawn in a list, and an edge drag would otherwise bust the key on drop
// for a row that reads identically.
//
// The filter strings are part of it because filterStates/filterTransitions run
// inside updateLPanel and narrow what is shown; without them, typing in the
// search box would be a no-op whenever the machine had not moved.
const LP_KEY_SKIP_FIELDS = new Set(['curve', 'loopAngle']);
export let _lpanelPainted = null;
export function _resetLpanelPainted() { _lpanelPainted = null; }

function lpanelKey() {
  // The scope is part of the key: drilling into a block changes what these two
  // lists show without changing one state or one transition, so a key built
  // from the machine alone would leave the previous level's rows on screen.
  const p = [App.machine, App.startId, (App.scope || []).join('/'), [...App.accepts].sort().join(',')];
  for (const st of App.states) p.push(st.id, st.name, st.output ?? '', st.priority ?? '');
  for (const t of App.transitions) {
    for (const k of Object.keys(t)) {
      if (LP_KEY_SKIP_FIELDS.has(k)) continue;
      p.push(k, String(t[k]));
    }
  }
  p.push($('state-search')?.value || '', $('trans-search')?.value || '');
  return p.join('\u0001');
}

export function updateLPanel() {
  const key = lpanelKey();
  const list = $('states-list');
  // Tested against the DOM as well as the key, the way the other two guards are:
  // a machine switch and a panel re-mount both rebuild these lists from nothing,
  // and a cache saying "already drawn" would then describe a subtree that is gone.
  if (key === _lpanelPainted && list && list.childNodes.length) return;
  _lpanelPainted = key;
  // What is on screen, not the whole machine. Inside a block these are that
  // block's own states and rules, which is the point of being inside it; at the
  // top level with no blocks they are the same two lists they always were.
  const drawn = viewStates();
  const shown = new Set(drawn.map(s => s.id));
  setListItems($('states-list'), drawn.filter(s => s.kind === undefined), {
    html: stateRowHTML, text: stateRowText,
    empty: '<div class="empty-msg">No states</div>'
  });
  setListItems($('trans-list'), App.transitions.filter(t => shown.has(t.from) && shown.has(t.to)), {
    html: transRowHTML, text: transRowText,
    empty: '<div class="empty-msg">No transitions</div>'
  });
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
// Deliberately NOT memoised on the change kinds, unlike the formal definition
// below. This key is a change *detector*: it exists to notice edits that were
// made without announcing themselves, which is why deriveRegex can be called
// straight after a direct write to App.accepts and still be correct. Hanging it
// off emit() would make it circular — it would report "nothing changed" for
// precisely the mutations it is there to catch.
export function _regexCacheKey() {
  return App.states.map(s => s.id).join(',') + '|' +
    App.transitions.map(t => t.from + t.symbol + t.to).sort().join(',') + '|' +
    App.startId + '|' + [...App.accepts].sort().join(',');
}
// State elimination is cubic in |Q| and allocates a |Q|² edge table before it
// starts, so a 400-state DFA is not a slow computation — it is a locked tab and
// a gigabyte of strings, and the expression it would eventually reach is longer
// than the machine it came from. The panel says what it is not doing rather
// than doing it: the claim is still true, just not derived. Anything above this
// is far past the size a regular expression is a useful way to read a language.
export const REGEX_DERIVE_MAX_STATES = 120;

export function deriveRegex() {
  if (!App.states.length || !App.startId) return '—';
  const accs = [...App.accepts]; if (!accs.length) return '∅';
  if (App.states.length > REGEX_DERIVE_MAX_STATES) {
    return `Regular Language (${App.states.length} states — too large to convert to a regular expression)`;
  }
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

// Past this many members a set is printed with its ends and its size. This is
// not only a cost decision, though it is one: KaTeX typesets a thousand-element
// Q into a thousand boxes on every structural edit, and the def box then scrolls
// sideways for a screen and a half. It is also the more useful line — nobody
// reads the four hundredth member, and "|Q| = 1000" is the fact they came for.
const SET_PRINT_CAP = 40;

export function formatSet(items) {
  if (!items || !items.length) return '\\emptyset';
  if (items.length > SET_PRINT_CAP) {
    const head = items.slice(0, SET_PRINT_CAP - 8).map(formatStateName).join(', ');
    const tail = items.slice(-4).map(formatStateName).join(', ');
    return `\\{ ${head}, \\ldots, ${tail} \\}\\ (${items.length}\\text{ elements})`;
  }
  return `\\{ ${items.map(formatStateName).join(', ')} \\}`;
}

function buildFormalDefLatex() {
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

  return txt;
}

// The formal definition, memoised on the structural change kinds and on the
// ReactiveSets it reads (Σ, Γ, the output alphabet and F, via state.js).
//
// The reason this is worth a memo is the last two lines of updateFormalDef:
// an innerHTML write and a full KaTeX re-typeset of the tuple, which ran on
// EVERY emit(Change.GRAPH). Most graph changes do not touch what this box
// displays at all — adding, editing or deleting a transition leaves Q, Σ, q0
// and F alone, because δ is shown as a signature rather than as a listing —
// so the app was re-typesetting identical mathematics on the majority of
// edits, including every drop that nudged a neighbour.
//
// The string is still rebuilt per structural change: the states are plain
// objects on purpose (see js/reactive.js on why App is not a store proxy), so
// there is nothing finer to depend on than "the graph changed". Rebuilding a
// string is cheap; typesetting it is not, which is why the skip is decided on
// the built value rather than on the dependency.
const defLatex = reactiveRoot(() => createMemo(() => {
  changed(Change.GRAPH);
  changed(Change.ALPHABET);
  return buildFormalDefLatex();
}));

// What is currently painted into #def-box, so a recomputation that lands on the
// same string costs nothing. Reset by resetModuleState() in the test harness.
export let _defBoxPainted = null;
export function _resetDefBoxPainted() { _defBoxPainted = null; }

export function updateFormalDef() {
  const txt = defLatex();
  App._defBoxLatex = txt;
  const defBox = $('def-box');
  if (!defBox) return;
  // The box can be repainted from under us (a theme change rebuilds the panel,
  // and the first paint has nothing in it), so the guard tests the DOM as well
  // as the memo rather than trusting the cache alone.
  if (txt === _defBoxPainted && defBox.innerHTML) {
    updateDefBoxOverflowShadow();
    return;
  }
  defBox.innerHTML = txt;
  _defBoxPainted = txt;
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
  else if (m === 'Counter') { txt = 'One-Counter Language'; }
  else if (m === '2PDA') { txt = 'Two-Stack PDA (TM-Equivalent Power)'; }
  else if (m === 'LBA') { txt = 'Context-Sensitive Language (Endmarked Tape)'; }
  else if (m === 'ITM') { txt = 'Recursively Enumerable Language'; }
  else if (isAnyPDA(m)) { txt = 'Context-Free Language'; }
  else if (isAnyTM(m)) { txt = 'Recursively Enumerable Language'; }
  else if (m === 'Moore') { txt = 'Finite-State Transducer (Moore)'; }
  else if (m === 'Mealy') { txt = 'Finite-State Transducer (Mealy)'; }
  else if (m === 'FST') { txt = 'Finite-State Transducer (Nondeterministic)'; }
  else {
    txt = deriveRegex() || '∅';
    // The derived/asserted split is what the panel styles from, and past
    // REGEX_DERIVE_MAX_STATES the sentence above is a claim about the class,
    // not an expression this machine was converted into.
    App._regexIsDerived = App.states.length <= REGEX_DERIVE_MAX_STATES;
  }

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
