// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  THE DRAFT LAYER
// ══════════════════════════════════════════════════════════════════
//  StateMate's work in progress, drawn over the canvas while it happens: the
//  machine a streamed answer has written so far, the private copy an agent is
//  editing, a proposal waiting for Apply. Without it the reader watched a
//  spinner say "Asking" for thirty seconds and then a finished machine appear
//  — or not — with nothing of how it got there.
//
//  It is paint, never the machine. Nothing here reads or writes App.states;
//  the layer is its own <g>, classed `editor-layer` so the exporters strip it
//  (canvas.js removes every `.editor-layer` from the clone it serialises),
//  with pointer events off so it can never be selected, dragged or deleted.
//  The one rule StateMate is built on — the canvas is written once, at apply,
//  or not at all — is untouched.
//
//  Dashed, because that is what dashed means in this app (css/views.css):
//  drafted, not yet part of the machine. What the draft adds is drawn in the
//  accent; what it keeps is drawn quietly; a state it drops is ringed in red
//  where it stands on the real diagram, which is dimmed underneath.
//
//  Deliberately simpler geometry than render.js: straight edges, a bend for a
//  two-way pair, a loop over the state. The layout pass reads the live machine
//  through viewGraph(), and borrowing it would mean swapping the draft into
//  App — exactly what the pipeline exists to avoid.
//
//  Three things decide what a paint costs and where things land:
//
//    - **A state the draft placed glides; a state the canvas placed does not.**
//      Every frame is placed the way the finished machine will be (see
//      draftCandidate), so a state can move between frames as its edges
//      arrive. Continuity is this layer's job: a state is eased from where it
//      was last painted to where the new frame puts it. A state that is also
//      on the real diagram is drawn exactly on it, every frame — it has to
//      stay under a drag, and easing it would put it behind the pointer.
//    - **The diff is taken on a change, not on a frame.** What the draft adds,
//      keeps and drops is a question about names and edges, and a drag changes
//      neither; so followCanvas() repaints against the diff it already has.
//      Taking it again labelled every live transition on every drag frame.
//    - **Held is not the same as drawn.** Inside a block the canvas is drawing
//      a projection whose coordinates the flat candidate does not share, and on
//      another tab it is drawing another machine, so the layer draws nothing
//      in either place — and keeps the draft, so stepping back out or
//      switching back puts it back.

import { $, App, activeWorkspaceId } from './state.js';
import { animEnabled } from './anim.js';
import { drawnEdgeEl } from './render.js';
import { specTransitionDetail, transitionToSpec } from './statemate-spec.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_ID = 'draft-g';
const CURVE = 34;
const MAX_LABEL = 18;

// The glide. The same exponential approach js/anim.js uses for the real
// diagram, a little slower: a draft state crosses more of the canvas in one
// move than a label does, and reads better arriving than snapping.
const GLIDE_TAU = 80;       // ms; ~3·TAU to settle
const GLIDE_EPS = 0.35;     // px of ink left: snap and stop
const GLIDE_DT_MAX = 64;    // a stalled frame resumes rather than leaps

let shown = null;           // { candidate, live, diff } — the draft held, or null
const paintedAt = new Map(); // state name -> {x, y} where the draft last put it
let glideFrame = null;
let glideLast = 0;
// Test seam. The stub DOM runs requestAnimationFrame inline, which anim.js
// reads as "easing off" for the life of the process, and a glide cannot be
// observed against a real clock. `{ now }` switches easing on and supplies one.
let glideForTests = null;
export function _draftGlideForTests(opts) { glideForTests = opts || null; }

const svg = (tag, attrs = {}, cls = '') => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (cls) node.setAttribute('class', cls);
  return node;
};

function layer() {
  let g = $(LAYER_ID);
  if (!g) {
    const cam = $('cam-g');
    if (!cam) return null;
    g = svg('g', { id: LAYER_ID });
    cam.appendChild(g);
  }
  // Asserted on every use rather than only at creation: `editor-layer` is what
  // keeps the draft out of every export, and it must not depend on who made
  // the node.
  g.setAttribute('class', 'editor-layer draft-layer');
  g.setAttribute('aria-hidden', 'true');
  return g;
}

const clip = text => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);

function edgeLabel(t, machine) {
  try { return specTransitionDetail(transitionToSpec(t, machine), machine); } catch (e) { return String(t.symbol ?? ''); }
}

/** What the draft adds, keeps and drops, by name — the dialect has no ids. */
export function draftDiff(candidate, live) {
  const sameKind = live && live.machine === candidate.machine;
  const liveStates = new Map(sameKind ? live.states.map(s => [s.name, s]) : []);
  const liveName = sameKind ? new Map(live.states.map(s => [s.id, s.name])) : new Map();
  const liveAccepts = new Set(sameKind ? (live.accepts || []).map(id => liveName.get(id)) : []);
  const edgeKey = (from, to, label) => `${from}\u0000${to}\u0000${label}`;
  const liveEdges = new Set(sameKind
    ? live.transitions.map(t => edgeKey(liveName.get(t.from), liveName.get(t.to), edgeLabel(t, live.machine)))
    : []);

  const draftName = new Map(candidate.states.map(s => [s.id, s.name]));
  const accepts = new Set((candidate.accepts || []).map(id => draftName.get(id)));
  const liveStart = sameKind ? liveName.get(live.startId) : undefined;
  const draftStart = draftName.get(candidate.startId);
  const stateStatus = new Map(candidate.states.map(s => {
    if (!liveStates.has(s.name)) return [s.name, 'new'];
    const acceptMoved = accepts.has(s.name) !== liveAccepts.has(s.name);
    const startMoved = (s.name === draftStart) !== (s.name === liveStart);
    return [s.name, acceptMoved || startMoved ? 'changed' : 'kept'];
  }));
  const edgeStatus = t => (liveEdges.has(edgeKey(draftName.get(t.from), draftName.get(t.to), edgeLabel(t, candidate.machine)))
    ? 'kept' : 'new');
  const named = new Set(candidate.states.map(s => s.name));
  const removed = sameKind ? live.states.filter(s => !named.has(s.name)) : [];
  const draftEdges = new Set(candidate.transitions.map(t =>
    edgeKey(draftName.get(t.from), draftName.get(t.to), edgeLabel(t, candidate.machine))));
  const removedEdges = sameKind
    ? live.transitions.filter(t =>
      !draftEdges.has(edgeKey(liveName.get(t.from), liveName.get(t.to), edgeLabel(t, live.machine))))
    : [];
  // Nothing in common: a fresh build or a different kind of machine. The real
  // diagram is then not what is being edited, and is dimmed further.
  const replaces = !candidate.states.some(s => liveStates.has(s.name));
  return { stateStatus, edgeStatus, removed, removedEdges, accepts, replaces };
}

function drawEdges(g, candidate, diff, r) {
  const byId = new Map(candidate.states.map(s => [s.id, s]));
  const pairs = new Map();
  candidate.transitions.forEach(t => {
    const k = `${t.from}\u0000${t.to}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(t);
  });

  for (const [k, all] of pairs) {
    const [fromId, toId] = k.split('\u0000');
    const a = byId.get(fromId), b = byId.get(toId);
    if (!a || !b) continue;
    // An edge the draft keeps is already on the canvas, drawn properly by the
    // real renderer. Redrawing it here with simpler routing put a second line
    // and a second label a few pixels off the first, and the two labels read
    // as one garbled one ("1 → 1, R L"). So only what the draft adds is drawn —
    // unless it keeps nothing at all, when there is no real edge beneath.
    const ts = diff.replaces ? all : all.filter(t => diff.edgeStatus(t) === 'new');
    if (!ts.length) continue;
    const status = diff.replaces ? 'kept' : 'new';
    const label = clip(ts.map(t => edgeLabel(t, candidate.machine)).join(', '));
    let d, lx, ly;

    if (a === b) {
      // A loop over the top of the state.
      const x1 = a.x - r * 0.6, x2 = a.x + r * 0.6, y = a.y - r * 0.8;
      d = `M ${x1} ${y} C ${a.x - r * 1.4} ${a.y - r * 2.6}, ${a.x + r * 1.4} ${a.y - r * 2.6}, ${x2} ${y}`;
      lx = a.x; ly = a.y - r * 2.2;
    } else {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // A two-way pair bends apart, or the two arrows would be one line.
      const bend = pairs.has(`${toId}\u0000${fromId}`) ? CURVE : 0;
      const nx = -uy * bend, ny = ux * bend;
      const sx = a.x + ux * r, sy = a.y + uy * r;
      const ex = b.x - ux * (r + 2), ey = b.y - uy * (r + 2);
      const cx = (a.x + b.x) / 2 + nx, cy = (a.y + b.y) / 2 + ny;
      d = bend ? `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`;
      lx = bend ? (sx + 2 * cx + ex) / 4 : (sx + ex) / 2;
      ly = (bend ? (sy + 2 * cy + ey) / 4 : (sy + ey) / 2) - 6;
    }
    g.appendChild(svg('path', { d, 'marker-end': 'url(#arr)' }, `draft-edge is-${status}`));
    const text = svg('text', { x: lx, y: ly, 'text-anchor': 'middle' }, `draft-label is-${status}`);
    text.textContent = label;
    g.appendChild(text);
  }
}

/**
 * The edges the draft drops, traced from the real renderer's own path so the
 * mark lies exactly on the line it strikes out. An edge that is not drawn —
 * inside a collapsed block — has nothing to strike, and is skipped.
 */
function drawRemovedEdges(g, diff) {
  for (const t of diff.removedEdges) {
    const d = drawnEdgeEl(t.id)?.__parts?.pathEl?.getAttribute?.('d');
    if (d) g.appendChild(svg('path', { d }, 'draft-edge is-removed'));
  }
}

function drawStates(g, candidate, diff, r, real) {
  for (const s of candidate.states) {
    const status = diff.stateStatus.get(s.name) || 'new';
    // A state the draft keeps as it is is the real one, already on the canvas.
    // Drawing a second circle on top of it read as two machines stacked, and
    // the instant the real one moved, as two machines side by side.
    if (status === 'kept' && !diff.replaces) continue;
    const node = svg('g', { transform: `translate(${s.x} ${s.y})` }, `draft-st is-${status}`);
    node.appendChild(svg('circle', { r }, 'draft-ring'));
    if (diff.accepts.has(s.name)) node.appendChild(svg('circle', { r: r - 5 }, 'draft-ring is-inner'));
    if (candidate.startId === s.id) {
      node.appendChild(svg('path', { d: `M ${-r - 26} 0 L ${-r - 3} 0`, 'marker-end': 'url(#arr)' }, 'draft-edge is-start'));
    }
    const text = svg('text', { 'text-anchor': 'middle', dy: '0.35em' }, 'draft-name');
    text.textContent = clip(s.name);
    node.appendChild(text);
    g.appendChild(node);
  }
  // Struck out where the state stands *now*. The diff is kept across drag
  // frames and its records may be a snapshot, so the position is read off the
  // live machine by name rather than off the record.
  for (const gone of diff.removed) {
    const s = real.get(gone.name) || gone;
    const node = svg('g', { transform: `translate(${s.x} ${s.y})` }, 'draft-st is-removed');
    node.appendChild(svg('circle', { r: r + 4 }, 'draft-ring'));
    node.appendChild(svg('path', { d: `M ${-r * 0.5} ${-r * 0.5} L ${r * 0.5} ${r * 0.5} M ${r * 0.5} ${-r * 0.5} L ${-r * 0.5} ${r * 0.5}` }, 'draft-cross'));
    g.appendChild(node);
  }
}

/** Whether a draft can be drawn at the level the reader is looking at. */
export function canDrawDraft() {
  return !(App.scope || []).length;
}

/** Whether the draft held belongs to the tab on screen. */
function belongsHere() {
  return !!shown && (shown.workspace ?? null) === (activeWorkspaceId ?? null);
}

const clock = () => (glideForTests ? glideForTests.now()
  : typeof performance === 'object' && typeof performance?.now === 'function' ? performance.now()
    : Date.now());

function scheduleGlide() {
  if (glideFrame !== null || typeof requestAnimationFrame !== 'function') return;
  glideLast = clock();
  glideFrame = requestAnimationFrame(() => {
    glideFrame = null;
    const t = clock();
    const dt = Math.min(GLIDE_DT_MAX, t - glideLast);
    glideLast = t;
    paint(dt);
  });
}

function stopGlide() {
  if (glideFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glideFrame);
  glideFrame = null;
}

/**
 * Where each state is drawn this frame. A state on the real diagram sits on
 * it; a state only the draft has is eased toward its target by `dt` ms —
 * zero on a paint that did not come from the glide itself, so a new frame
 * starts its move from where the reader last saw the state rather than from a
 * leap already a fraction of the way there.
 */
function posed(candidate, real, dt) {
  const easing = glideForTests ? true : animEnabled();
  const alpha = 1 - Math.exp(-Math.max(0, dt) / GLIDE_TAU);
  let moving = false;
  const seen = new Set();
  const states = candidate.states.map(s => {
    seen.add(s.name);
    const on = real.get(s.name);
    if (on) {
      paintedAt.delete(s.name);
      return { ...s, x: on.x, y: on.y };
    }
    const was = paintedAt.get(s.name);
    let x = s.x, y = s.y;
    if (easing && was) {
      x = was.x + (s.x - was.x) * alpha;
      y = was.y + (s.y - was.y) * alpha;
      if (Math.hypot(s.x - x, s.y - y) < GLIDE_EPS) { x = s.x; y = s.y; } else moving = true;
    }
    paintedAt.set(s.name, { x, y });
    return { ...s, x, y };
  });
  for (const name of [...paintedAt.keys()]) if (!seen.has(name)) paintedAt.delete(name);
  return { candidate: { ...candidate, states }, moving };
}

function paint(dt = 0) {
  const g = layer();
  if (!g) return;
  while (g.firstChild) g.removeChild(g.firstChild);
  const wrap = $('canvas-wrap');
  if (!shown || !canDrawDraft() || !belongsHere()) {
    stopGlide();
    wrap?.classList.remove('has-draft', 'draft-replaces');
    return;
  }
  const { live, diff } = shown;
  const real = live && live.machine === shown.candidate.machine
    ? new Map(live.states.map(s => [s.name, s]))
    : new Map();
  const { candidate, moving } = posed(shown.candidate, real, dt);
  const r = App.config?.radius || 30;
  drawRemovedEdges(g, diff);
  drawEdges(g, candidate, diff, r);
  drawStates(g, candidate, diff, r, real);
  wrap?.classList.add('has-draft');
  wrap?.classList.toggle('draft-replaces', diff.replaces);
  if (moving) scheduleGlide();
}

/**
 * Hold a candidate over the canvas, and draw it if it can be seen.
 *
 * @param {object} candidate
 * @param {object} live  the machine it is compared against — normally the canvas as it is now
 * @param {object} [opts]
 * @param {string} [opts.workspace]  the tab it belongs to; the tab on screen by default.
 *   A draft is drawn only over its own tab. Switching tabs never announces
 *   Change.GRAPH, but it does go through renderAll(), which ends in
 *   followCanvas() — so a draft held for another tab is simply not painted
 *   there, and is painted again on the way back, with nothing to clear.
 */
export function showDraft(candidate, live, { workspace = activeWorkspaceId } = {}) {
  if (!candidate) return;
  shown = { candidate, live, diff: draftDiff(candidate, live), workspace: workspace ?? null };
  paint();
}

/** Take the draft off the canvas. Safe to call when there is none. */
export function clearDraft() {
  shown = null;
  paintedAt.clear();
  paint();
}

/** Whether a draft is held — drawn, or waiting for the reader to leave a block or come back to its tab. */
export function isDraftShown() {
  return !!shown;
}

/** Whether a draft is held for the tab on screen. */
export function isDraftHere() {
  return belongsHere();
}

/** Whether `candidate` is the draft held. What a Preview button asks. */
export function isShowingDraft(candidate) {
  return !!candidate && shown?.candidate === candidate;
}

/** The candidate held right now, for "show it again". */
export function shownDraft() {
  return shown && { candidate: shown.candidate, live: shown.live, workspace: shown.workspace };
}

/**
 * Compare the draft against the canvas as it is now. What the draft adds,
 * keeps and drops is a statement about the machine on screen; compared against
 * the canvas as it was when the run began, it marks a state that has since
 * been moved or deleted — a red ✕ over empty space.
 *
 * Only for its own tab: the canvas on screen is not what it is about anywhere
 * else.
 */
export function refreshDraft(live) {
  if (belongsHere()) showDraft(shown.candidate, live, { workspace: shown.workspace });
}

/**
 * Keep up with the real diagram. Called by the renderer at the end of every
 * pass, drag frames included — a drag moves states without announcing a
 * change, so a draft refreshed only on announcements stayed where it was drawn
 * while the machine it describes moved away from under it.
 *
 * Positions only: a drag changes no name and no edge, so the diff taken when
 * the draft was last shown or refreshed still holds, and an announced edit
 * reaches refreshDraft() through the console's Change.GRAPH subscriber. Reads
 * App directly rather than taking a snapshot: this runs every frame of a drag,
 * and nothing here writes. On another tab App is that tab's machine, so it is
 * not read at all and the layer is simply emptied.
 */
export function followCanvas() {
  if (!shown) return;
  if (belongsHere()) shown = { ...shown, live: { machine: App.machine, states: App.states } };
  paint();
}
