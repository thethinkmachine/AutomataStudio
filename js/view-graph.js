// ══════════════════════════════════════════════════════════════════
//  WHAT THE CANVAS IS SHOWING
// ══════════════════════════════════════════════════════════════════
// The machine is flat — every state of every block, at every depth, lives in
// `App.states` (see js/blocks.js for why). What the reader looks at is a
// *projection* of it: the states of one scope, one box per child block, and
// every edge that crosses a boundary rewritten to end on that box.
//
// This module is that projection, and it is deliberately the only one. Every
// downstream consumer already starts from the layout pass, so feeding
// buildLayoutContext a view graph carries renderTransitions, updateFastDOM,
// getContentBounds, fit-to-screen, the exporters and the minimap along with it.
// Scattering `if (hidden)` through the renderer instead would be the same
// decision made eight times, differently.
//
// ── Scope is a camera, not a mode ─────────────────────────────────
// Drilling into a block changes `App.scope` and nothing else. The model does
// not move, so undo, selection, a running simulation, the formal definition and
// every decider are untouched by a drill-in. That is the whole payoff of
// keeping the machine flat: under a hierarchical model, "go inside" would mean
// swapping `App.states`, and every one of those would have to learn what a
// scope change is.
//
// ── Three node kinds ──────────────────────────────────────────────
//   state   a circle, exactly as before
//   block   a box, with a title strip and a live preview of what is inside
//   port    a tab on the boundary of the scope you are inside, saying where
//           control arrives from and where each exit hands it back
//
// Ports exist only inside a scope, and they are what stops a drilled-in view
// reading as a disconnected fragment. They are derived, never stored.
//
// ── Identity is load-bearing ──────────────────────────────────────
// relayout() refuses the incremental path when `prev.states !== states`, so a
// projection that built a fresh array every frame would take a full layout pass
// sixty times a second and undo the whole of the incremental work. The graph is
// therefore cached and validated the way stateIndex() is — nothing announces
// that App.states changed — and a cache hit *refreshes* the block nodes in
// place rather than rebuilding them, so a dragged block moves without the
// arrays changing identity.

import {
  blockChildren, blockMembers, getBlock, liveBlocks, localStateName
} from './blocks.js';
import { App, getState, setDrawnSizeSource } from './state.js';

// A block's box, when it has not been given one. Wide enough for a title strip
// and a preview that reads as a diagram rather than as a smudge, and clamped so
// a block with forty states in it does not become a wall.
export const BLOCK_MIN_W = 120;
export const BLOCK_MIN_H = 84;
export const BLOCK_MAX_W = 300;
export const BLOCK_MAX_H = 220;

/** The title strip's height, in world units. Mirrored by css/canvas.css. */
export const BLOCK_STRIP_H = 22;

/** How far a port sits from the state it is attached to. */
export const PORT_GAP = 110;
export const PORT_W = 96;
export const PORT_H = 30;

/**
 * The size a block is drawn at: what the reader set, or one derived from how
 * much is inside it.
 *
 * Derived once and written onto the record at placement, never recomputed —
 * the same rule `curve` and `loopAngle` follow. A box that grew every time a
 * state was added inside it would move the diagram around the reader.
 */
export function blockSize(b) {
  if (Number.isFinite(b?.w) && Number.isFinite(b?.h)) return { w: b.w, h: b.h };
  const n = (blockMembers(b?.id).length + blockChildren(b?.id).length) || 1;
  const w = clamp(BLOCK_MIN_W + Math.sqrt(n) * 26, BLOCK_MIN_W, BLOCK_MAX_W);
  return { w: Math.round(w), h: Math.round(clamp(w * 0.68, BLOCK_MIN_H, BLOCK_MAX_H)) };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** The clearance radius of a box: the circle that contains it. */
function boxRadius(w, h) { return Math.hypot(w, h) / 2; }

// ══════════════════════════════════════════════════════════════════
//  SCOPE
// ══════════════════════════════════════════════════════════════════

/** The block the canvas is currently inside, or null at the top level. */
export function scopeId() {
  const scope = App.scope || [];
  return scope.length ? scope[scope.length - 1] : null;
}

/** The scope, with any block that has since gone dropped. */
export function liveScope() {
  const scope = (App.scope || []).filter(id => getBlock(id));
  if (scope.length !== (App.scope || []).length) App.scope = scope;
  return scope;
}

/** The blocks the breadcrumb names, outermost first. */
export function scopeTrail() {
  return liveScope().map(id => getBlock(id)).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════
//  THE PROJECTION
// ══════════════════════════════════════════════════════════════════

let cache = null;

/**
 * Is the cached projection still describing the machine?
 *
 * The three arrays are validated the way stateIndex() validates App.states —
 * identity, length and the two end elements catch every mutation the app
 * actually performs — plus the scope path and the start state.
 *
 * Compared field by field against values stored on the cache rather than
 * against a freshly built signature object. viewGraph() is on the hot path
 * (edgeLabelsHidden() reaches it once per edge label), and allocating an object
 * per call to throw away is exactly the kind of per-frame garbage this file is
 * meant not to produce.
 */
function stillValid(c) {
  if (!c) return false;
  const st = App.states || [], tr = App.transitions || [], bl = App.blocks || [];
  return c.st === st && c.stN === st.length && c.stA === st[0] && c.stB === st[st.length - 1]
    && c.tr === tr && c.trN === tr.length && c.trA === tr[0] && c.trB === tr[tr.length - 1]
    && c.bl === bl && c.blN === bl.length && c.blA === bl[0] && c.blB === bl[bl.length - 1]
    && c.scopeKey === (App.scope || []).join('/')
    && c.start === App.startId;
}

function stamp(c) {
  const st = App.states || [], tr = App.transitions || [], bl = App.blocks || [];
  c.st = st; c.stN = st.length; c.stA = st[0]; c.stB = st[st.length - 1];
  c.tr = tr; c.trN = tr.length; c.trA = tr[0]; c.trB = tr[tr.length - 1];
  c.bl = bl; c.blN = bl.length; c.blA = bl[0]; c.blB = bl[bl.length - 1];
  c.scopeKey = (App.scope || []).join('/');
  c.start = App.startId;
  return c;
}

/** Forget the projection. For the loaders and the test harness. */
export function invalidateViewGraph() { cache = null; }

/**
 * The graph the canvas draws: `{ states, transitions, byId, scope }`.
 *
 * `states` holds all three node kinds — the name is what buildLayoutContext and
 * the renderer already call it, and every one of them is a thing with an `x`,
 * a `y` and an id.
 */
export function viewGraph() {
  if (stillValid(cache)) {
    refresh(cache);
    return cache;
  }
  cache = stamp(build());
  return cache;
}

// The render profile judges what is *drawn*, not how big the machine is — see
// machineIsLarge(). state.js is import-free, so the answer is installed there as
// a function rather than pushed as a value: pushed, it would go stale the moment
// anything replaced App.states without the projection having been read since,
// which is most of what a loader does.
setDrawnSizeSource(() => {
  const g = viewGraph();
  return { states: g.states.length, transitions: g.transitions.length };
});

export function viewStates() { return viewGraph().states; }
export function viewTransitions() { return viewGraph().transitions; }

/** A drawn node by id — a state, a block box or a port. */
export function getNode(id) { return viewGraph().byId.get(id) || null; }

export function isBlockNode(n) { return !!n && n.kind === 'block'; }
export function isPortNode(n) { return !!n && n.kind === 'port'; }

/**
 * Which drawn node a real state is inside, or null when it is not on screen at
 * all — a state in a sibling branch of the tree.
 *
 * This is what the simulation highlight goes through: a run inside a collapsed
 * block lights the block, not a state nobody can see.
 */
export function visibleNodeIdFor(stateId) {
  return viewGraph().owner.get(stateId) || null;
}

/**
 * The real transitions behind a drawn edge, or null for a port edge.
 *
 * The edge listeners resolve through this rather than filtering App.transitions
 * by the drawn key: a rewritten edge `s5|b1` is a pair that does not exist in
 * the model, so the model cannot answer for it.
 */
export function viewEdgeGroup(key) {
  const g = viewGraph().edges.get(key);
  return g && g.real.length ? g.real : null;
}

/** Every drawn edge key an underlying transition contributes to. */
export function viewEdgeKeyFor(transitionId) {
  return viewGraph().keyOf.get(transitionId) || null;
}

/**
 * The drawn node for a block, whose `x`/`y` are the *record's* rather than a
 * copy of them.
 *
 * That is the whole of what makes a block behave like a state. Every mover in
 * the app writes a node's coordinates in place — `handlePointerMove` for a
 * drag, `nudgeSelected` for the arrow keys, `resolveNodeOverlaps` for collision,
 * the layout algorithms for Arrange — and with plain copied numbers each of
 * those wrote to the projection and the next cache refresh silently put the old
 * value back. A block could not be dragged, could not be nudged, absorbed no
 * push from the states it overlapped (so everything else was shoved around a
 * box that never moved), and sat out auto-layout entirely.
 *
 * Accessors rather than a "copy back afterwards" pass, because there is no one
 * place to put such a pass: the drag path, the collision pass and the layout
 * algorithms are three different callers that share only the node object.
 */
function blockNode(b) {
  const size = blockSize(b);
  const node = {
    id: b.id,
    kind: 'block',
    block: b,
    name: b.name,
    box: size,
    r: boxRadius(size.w, size.h)
  };
  defineLiveXY(node, b);
  return node;
}

function defineLiveXY(node, b) {
  Object.defineProperty(node, 'x', {
    get() { return b.x || 0; },
    set(v) { b.x = v; },
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(node, 'y', {
    get() { return b.y || 0; },
    set(v) { b.y = v; },
    enumerable: true,
    configurable: true
  });
}

// ── refreshing a cache hit ────────────────────────────────────────
// Positions change without any array changing identity: a block is dragged, a
// state inside a scope is dragged, the reader resizes a box. Refreshing in
// place is what lets the projection keep its array identity across a drag,
// which is what keeps relayout() on the incremental path.
function refresh(g) {
  // Only the derived nodes. A plain state is the model's own object, so it is
  // already current; walking every one of them here would put an O(states) loop
  // on a call that happens once per edge label.
  for (const node of g.dynamic) {
    if (node.kind === 'block') {
      const b = node.block;
      // `x` and `y` are accessors onto the record (see blockNode), so there is
      // nothing to copy here — and copying them is exactly what used to undo
      // every drag, nudge and collision push a frame after it happened.
      node.name = b.name;
      const size = blockSize(b);
      node.box = size;
      node.r = boxRadius(size.w, size.h);
    } else {
      const anchor = getState(node.anchor);
      if (!anchor) continue;
      node.x = anchor.x + node.dx;
      node.y = anchor.y + node.dy;
    }
  }
}

// ── building ──────────────────────────────────────────────────────

function build() {
  // Reading through liveBlocks() rather than App.blocks is what prunes a record
  // whose states were replaced wholesale — nothing announces that, so the
  // validation happens on the read. See blockIsIntact().
  liveBlocks();
  const scope = liveScope();
  const here = scope.length ? scope[scope.length - 1] : null;

  const states = [];
  const byId = new Map();

  for (const s of App.states || []) {
    if ((s.blockId || null) === here) { states.push(s); byId.set(s.id, s); }
  }

  // One box per child block.
  const childIds = new Set();
  for (const b of blockChildren(here)) {
    childIds.add(b.id);
    const node = blockNode(b);
    states.push(node);
    byId.set(b.id, node);
  }

  // Which drawn node each state belongs to, in one pass over the machine
  // rather than one pass per block: a CPU is twenty blocks over three thousand
  // states, and asking each block for its subtree separately is that product.
  const owner = ownerMap(here, childIds);

  // ── edges ──
  // An edge is drawn between whatever its two endpoints resolve to. Both
  // resolving to the same box is an edge *inside* a child block, which the box
  // is standing in for; either endpoint resolving to nothing is an edge in some
  // other branch of the tree entirely.
  const transitions = [];
  const edges = new Map();
  const keyOf = new Map();
  for (const t of App.transitions || []) {
    const from = owner.get(t.from);
    const to = owner.get(t.to);
    if (!from || !to) continue;
    if (from === to && from !== t.from) continue;
    const key = from + '|' + to;
    // Object.create rather than a copy: `curve` and `loopAngle` are written on
    // the *real* transition by a bend drag, and a copied field would be a stale
    // snapshot the layout pass went on reading for the rest of the session. The
    // proxy owns only what the projection changes.
    const view = from === t.from && to === t.to ? t : proxy(t, from, to);
    transitions.push(view);
    keyOf.set(t.id, key);
    let g = edges.get(key);
    if (!g) { g = { key, real: [] }; edges.set(key, g); }
    g.real.push(t);
  }

  // ── ports ──
  const ports = here ? buildPorts(here, byId, owner) : [];
  for (const p of ports) {
    states.push(p.node);
    byId.set(p.node.id, p.node);
    transitions.push(p.edge);
    edges.set(p.edge.from + '|' + p.edge.to, { key: p.edge.from + '|' + p.edge.to, real: [], port: p.node });
  }

  // The nodes a cache hit has to refresh: a block's box follows its record and
  // a port follows the state it is anchored to, and neither changes any array's
  // identity when it moves.
  const dynamic = states.filter(nd => nd.kind === 'block' || nd.kind === 'port');
  return { states, transitions, byId, owner, edges, keyOf, scope, here, dynamic };
}

function proxy(t, from, to) {
  const p = Object.create(t);
  p.from = from;
  p.to = to;
  return p;
}

/**
 * state id -> the drawn node that stands for it, for one scope.
 *
 * Built by walking each state's ancestry up to the scope, memoising the answer
 * per block on the way — so the whole map costs one pass over the states plus
 * one short walk per distinct block, rather than a pass over the states per
 * block. A state in another branch of the tree entirely gets no entry, which is
 * how the projection knows it is not on screen.
 */
function ownerMap(here, childIds) {
  const owner = new Map();
  const resolved = new Map();   // blockId -> drawn node id, or null

  const resolve = blockId => {
    if (resolved.has(blockId)) return resolved.get(blockId);
    const chain = [];
    let cur = blockId, answer = null;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (resolved.has(cur)) { answer = resolved.get(cur); break; }
      chain.push(cur);
      if (childIds.has(cur)) { answer = cur; break; }
      const b = getBlock(cur);
      if (!b) break;
      if ((b.parent || null) === here && !childIds.has(cur)) { answer = null; break; }
      cur = b.parent || null;
    }
    for (const id of chain) resolved.set(id, answer);
    return answer;
  };

  for (const s of App.states || []) {
    const container = s.blockId || null;
    if (container === here) { owner.set(s.id, s.id); continue; }
    if (!container) continue;
    const node = resolve(container);
    if (node) owner.set(s.id, node);
  }
  return owner;
}

/**
 * The tabs on the edge of a scope: where the host hands control in, and where
 * each exit hands it back.
 *
 * Derived from the block record and the machine's real wiring, never stored.
 * A drilled-in view without them is a disconnected fragment — you can see the
 * sub-machine and nothing about how it is reached, which is most of what you
 * drilled in to find out.
 */
function buildPorts(blockId, byId, owner) {
  const b = getBlock(blockId);
  if (!b) return [];
  const out = [];

  const entry = getState(b.entry);
  if (entry && byId.has(entry.id)) {
    const from = [...new Set((App.transitions || [])
      .filter(t => t.to === b.entry && owner.get(t.from) !== blockId && !byId.has(t.from))
      .map(t => getState(t.from)?.name)
      .filter(Boolean))];
    out.push({
      node: {
        id: '__in__',
        kind: 'port',
        dir: 'in',
        anchor: entry.id,
        dx: -PORT_GAP, dy: 0,
        x: entry.x - PORT_GAP,
        y: entry.y,
        box: { w: PORT_W, h: PORT_H },
        r: boxRadius(PORT_W, PORT_H),
        name: from.length ? `from ${from.slice(0, 2).join(', ')}` : 'from the host'
      },
      edge: { id: '__pin__', from: '__in__', to: entry.id, port: true }
    });
  }

  (b.exits || []).forEach((exit, i) => {
    const s = getState(exit.id);
    if (!s || !byId.has(s.id)) return;
    const to = [...new Set((App.transitions || [])
      .filter(t => t.from === exit.id && !byId.has(t.to))
      .map(t => getState(t.to)?.name)
      .filter(Boolean))];
    // The index is part of the id, not just the state. A block may hand control
    // back from one state under two different labels — "yes" and "no" out of the
    // same comparison — and keyed on the state alone both tabs took one id: the
    // second overwrote the first in `byId`, both edges resolved to one key, and
    // the diagram showed a single unnamed exit where there were two answers.
    const id = '__out__:' + i + ':' + exit.id;
    out.push({
      node: {
        id,
        kind: 'port',
        dir: 'out',
        anchor: s.id,
        dx: PORT_GAP, dy: (i - ((b.exits.length - 1) / 2)) * (PORT_H + 18),
        x: s.x + PORT_GAP,
        y: s.y,
        box: { w: PORT_W, h: PORT_H },
        r: boxRadius(PORT_W, PORT_H),
        name: to.length ? `${exit.label} → ${to[0]}` : exit.label
      },
      edge: { id: '__pout__' + i, from: s.id, to: id, port: true }
    });
  });

  placePorts(out, byId, blockId);
  return out;
}

// The directions a port will try, ideal first. An entry tab wants to sit to the
// left of the state control arrives at and an exit tab to the right, because
// that is the direction the diagram already reads in — but "wants" is the whole
// point: a port pinned to one offset lands on whatever happens to be standing
// there, which is what made them look nailed down rather than placed.
const PORT_DIRS = [
  [-1, 0], [-1, -0.55], [-1, 0.55], [0, -1], [0, 1],
  [-0.7, -0.7], [-0.7, 0.7], [-1.35, 0], [0, -1.5], [0, 1.5]
];

/**
 * Put each port somewhere clear, the way the self-loop stage places an arc.
 *
 * Candidates are scored ideal-first against the states, the block boxes and the
 * ports already placed, so an uncrowded diagram costs one test per port and
 * lands exactly where the old fixed offset put it. A crowded one steps the tab
 * around its anchor instead of burying it under a neighbour.
 *
 * A hand-placed port wins outright, the way `t.curve` wins over auto-routing:
 * the reader has said where the tab goes and a search that could move it again
 * would be the app arguing. The offset is stored on the *block record* — ports
 * are derived and reach no serializer of their own, but a block does, and
 * `roundForSave` copies it whole — so it survives a rebuild, a save and an undo
 * while the port itself stays as derived as it ever was.
 */
function placePorts(ports, byId, blockId) {
  const placed = [];
  const saved = (getBlock(blockId) || {}).ports || {};
  for (const p of ports) {
    const anchor = getState(p.node.anchor);
    if (!anchor) continue;
    const manual = saved[p.node.id];
    if (manual && Number.isFinite(manual.dx) && Number.isFinite(manual.dy)) {
      p.node.dx = manual.dx; p.node.dy = manual.dy;
      p.node.x = anchor.x + manual.dx; p.node.y = anchor.y + manual.dy;
      p.node.manual = true;
      placed.push(p.node);
      continue;
    }
    const sign = p.node.dir === 'out' ? -1 : 1;   // exits mirror the entry's side
    const fan = p.node.dy;                        // keeps stacked exits apart
    let best = null;
    for (const [ux, uy] of PORT_DIRS) {
      const dx = sign * ux * PORT_GAP;
      const dy = uy * PORT_GAP + fan;
      const x = anchor.x + dx, y = anchor.y + dy;
      const cost = portCollisionCost(x, y, p.node, byId, placed, anchor.id);
      if (!best || cost < best.cost) best = { dx, dy, x, y, cost };
      if (cost === 0) break;   // ideal-first, so the first clear candidate wins
    }
    if (!best) continue;
    p.node.dx = best.dx; p.node.dy = best.dy;
    p.node.x = best.x; p.node.y = best.y;
    placed.push(p.node);
  }
}

/** How badly a port at (x, y) would sit on top of something already drawn. */
function portCollisionCost(x, y, port, byId, placed, skipId) {
  const hw = port.box.w / 2 + 12, hh = port.box.h / 2 + 12;
  let cost = 0;
  const hit = (ox, oy, ow, oh) => {
    const px = Math.min(x + hw, ox + ow) - Math.max(x - hw, ox - ow);
    const py = Math.min(y + hh, oy + oh) - Math.max(y - hh, oy - oh);
    if (px > 0 && py > 0) cost += px * py;
  };
  for (const node of byId.values()) {
    if (node.id === skipId) continue;
    const ow = node.box ? node.box.w / 2 : 26;
    const oh = node.box ? node.box.h / 2 : 26;
    hit(node.x, node.y, ow, oh);
  }
  for (const other of placed) hit(other.x, other.y, other.box.w / 2, other.box.h / 2);
  return cost;
}

// ══════════════════════════════════════════════════════════════════
//  WHAT A BLOCK'S PREVIEW SHOWS
// ══════════════════════════════════════════════════════════════════

/**
 * The immediate contents of a block, as a graph to draw small.
 *
 * **Immediate**, deliberately. At CPU level the ALU box shows its four
 * arithmetic sub-blocks and their wiring, not two hundred leaf states in a
 * hundred-pixel box. Depth two stops being information and costs elements
 * linearly, so it is a constant with a reason rather than a setting.
 */
export function blockPreviewGraph(blockId) {
  const nodes = [];
  const byId = new Map();
  const childIds = new Set();

  for (const s of blockMembers(blockId)) { nodes.push(s); byId.set(s.id, s); }
  for (const b of blockChildren(blockId)) {
    childIds.add(b.id);
    const size = blockSize(b);
    const node = { id: b.id, kind: 'block', x: b.x || 0, y: b.y || 0, box: size, r: boxRadius(size.w, size.h) };
    nodes.push(node);
    byId.set(b.id, node);
  }
  if (!nodes.length) return null;

  const owner = ownerMap(blockId, childIds);
  const edges = [];
  for (const t of App.transitions || []) {
    const from = owner.get(t.from), to = owner.get(t.to);
    if (!from || !to) continue;
    if (from === to && from !== t.from) continue;
    edges.push({ from, to, curve: t.curve, loopAngle: t.loopAngle });
  }
  return { nodes, byId, edges };
}

/**
 * A signature of what a block's preview draws, so it is rebuilt when the
 * interior changes and not on every graph emit.
 *
 * Nothing announces that a member state moved, so the key is derived rather
 * than invalidated — the same trick stateIndex() uses. Coordinates are rounded
 * because a preview is a few dozen pixels across and a sub-pixel move cannot
 * change it.
 */
export function blockPreviewKey(blockId) {
  const parts = [];
  for (const s of blockMembers(blockId)) parts.push(s.id, Math.round(s.x), Math.round(s.y));
  for (const b of blockChildren(blockId)) parts.push(b.id, Math.round(b.x || 0), Math.round(b.y || 0));
  // The wiring, as a signature rather than a listing. Walking every transition
  // per block per render is the machine's size times its block count, which is
  // exactly the shape of cost a preview must not have. Identity, length and the
  // two ends catch every mutation the app performs — the same validation
  // stateIndex() runs.
  const tr = App.transitions || [];
  parts.push('|', tr.length, tr[0]?.id, tr[tr.length - 1]?.id, transitionRevision(tr));
  return parts.join(',');
}

// Bumped whenever the transition array is replaced, so an edge retargeted in
// place — which changes no id and no length — still redraws the previews it
// appears in. App.transitions is reassigned by every editor path that matters.
let _trArr = null, _trRev = 0;
function transitionRevision(tr) {
  if (_trArr !== tr) { _trArr = tr; _trRev++; }
  return _trRev;
}

/** The state's own name, for a drilled-in view. Re-exported for convenience. */
export { localStateName };
