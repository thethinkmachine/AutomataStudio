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
  blockAncestry, blockChildren, blockMembers, blockPath, getBlock, liveBlocks, localStateName
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
export const PORT_GAP = 118;

// A tab is sized to what it says, between these. It used to be a flat 96px
// whatever the label, so every real state name ran clean out of both ends of
// the box — `ADDR_L_leaf_14 -> ADDR_L_count_14` in a 96px pill, drawn over the
// diagram with nothing behind it. Capped, because a tab is boundary chrome and
// a 400px one would be the widest thing on the canvas; what does not fit is
// truncated from the *front*, since machine-generated names differ at the end.
export const PORT_MIN_W = 84;
export const PORT_MAX_W = 208;
export const PORT_H = 34;
export const PORT_PAD = 11;

// Two rows: the role in small caps, the other end in mono under it. The app
// says everything else this way — LANGUAGE / MTM, FINGERPRINT / 0 OF 257,
// ALPHABET Σ / 2 — and a tab that only ever said `from q3` was the one piece of
// canvas chrome with no way to tell what kind of thing it was naming.
const PORT_ROLE_PX = 4.9;    // 7px uppercase, +letter-spacing
const PORT_TARGET_PX = 5.35; // 9px mono
const PORT_ROLE_MAX = 22;
const PORT_TARGET_MAX = 30;

/** Trim from the front: generated names differ at the end (`…leaf_14`). */
function clipTail(text, max) {
  const t = String(text || '');
  return t.length <= max ? t : '…' + t.slice(t.length - (max - 1));
}

/** The tab's box, from what it has to say. */
function portBox(role, target) {
  const w = Math.max(
    PORT_MIN_W,
    Math.min(PORT_MAX_W, Math.ceil(Math.max(
      role.length * PORT_ROLE_PX,
      target.length * PORT_TARGET_PX
    )) + PORT_PAD * 2)
  );
  return { w, h: PORT_H };
}

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

// What the render profile judges — see machineIsLarge(). state.js is
// import-free, so the answer is installed there as a function rather than
// pushed as a value: pushed, it would go stale the moment anything replaced
// App.states without the projection having been read since, which is most of
// what a loader does.
//
// It answers the *weight* of the level, not its node count. See the note over
// `weight` in build(): a box stands for a whole subtree, and it costs one — to
// preview, to key, to stringify and to copy onto the undo stack — whether the
// reader is looking at the boxes or at what is inside them.
setDrawnSizeSource(() => viewGraph().weight);

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
      // **A derived size is never recomputed here, and that is the difference
      // between this function being O(1) and being O(blocks x states).**
      // blockSize() falls through to blockMembers() + blockChildren() when the
      // record carries no size of its own — and inlineBlock leaves them null, so
      // that is the ordinary case rather than the exception. Both of those are
      // unindexed filters that allocate, and viewGraph() is on the hot path:
      // edgeLabelsHidden() reaches it once per edge label, and every surface
      // that resolves a machine id to a drawn one reaches it per item. A
      // select-all over 2000 transitions on a machine with eight blocks measured
      // at 617ms against 7ms without them.
      //
      // It is safe to skip because what a derived size is derived *from* — the
      // states and blocks — cannot change without stillValid() failing and the
      // whole projection being rebuilt. Only a hand-set size can change under a
      // cache hit, and reading two numbers off the record is what that costs.
      if (Number.isFinite(b.w) && Number.isFinite(b.h)) {
        if (node.box.w !== b.w || node.box.h !== b.h) {
          node.box = { w: b.w, h: b.h };
          node.r = boxRadius(b.w, b.h);
        }
      }
    } else {
      // Through byId rather than getState: a port now anchors on whatever drawn
      // node the crossing touches, and an edge that leaves a *nested* block for
      // the level above is anchored on that block's box.
      const anchor = g.byId.get(node.anchor);
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
  // Edges wholly inside a child block, which the box is standing in for. They
  // are not drawn, and until now they were not counted either — see `weight`
  // below for why the count is what the render profile has to judge.
  let inner = 0;
  // Every edge with exactly one end under this scope. The `continue` below used
  // to be where they died: an edge whose other end is anywhere but here was
  // dropped, and the only crossings that survived were the two the block record
  // *declared*. So an edge from inside a nested block to the grandparent level
  // was drawn nowhere at all, and an edge into a member that is not the entry
  // was invisible from inside and indistinguishable from the entry's from
  // outside. See collectCrossing.
  const crossings = { in: new Map(), out: new Map() };
  for (const t of App.transitions || []) {
    const from = owner.get(t.from);
    const to = owner.get(t.to);
    if (here && !from !== !to) {
      collectCrossing(crossings, t, from, to);
      continue;
    }
    if (!from || !to) continue;
    if (from === to && from !== t.from) { inner++; continue; }
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

  // ── what this level stands for ──
  //
  // **A box is not one node, and judging the render profile as though it were
  // is what let a three-thousand-state machine hide inside eight boxes and be
  // called small.** A box carries a live preview of its interior, so it costs a
  // `blockPreviewGraph` walk, a `blockPreviewKey` scan of the whole machine and
  // up to `previewNodeBudget()` elements — and the machine behind it costs a
  // full `JSON.stringify` on every autosave tick and a full workspace copy per
  // undo entry, neither of which cares how many boxes it is drawn as. The note
  // over `syncBlockNode` in js/render.js measured that frame: twelve boxes over
  // 4800 states, 6.4ms of an 8.3ms repaint, with the profile off throughout,
  // because drawnSize() correctly reported twelve.
  //
  // So the weight of a level is **the subtree the reader is standing in**, at
  // every depth: `owner` already maps every state under this scope — its own,
  // and every descendant of every child block however deep — to the drawn node
  // that stands for it, so its size is that count and costs nothing extra. The
  // good half of judging the view survives intact: drill into an eight-state
  // adder and the weight is eight, because that subtree really is eight states,
  // and the labels and the easing come back.
  //
  // Cached beside the projection and never recomputed on a hit, by the same
  // argument the note in refresh() makes for a derived block size: what this is
  // derived from cannot change without stillValid() failing.
  const weight = { states: owner.size, transitions: transitions.length + inner };

  // ── ports ──
  const ports = here ? buildPorts(here, byId, crossings) : [];
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
  return { states, transitions, byId, owner, edges, keyOf, scope, here, dynamic, weight };
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
 * A boundary crossing, filed under the drawn node on this side of it.
 *
 * The anchor is a *drawn node*, not a state: an edge leaving a nested block for
 * the level above is anchored on that block's box, because that box is the only
 * thing on screen standing for the state it actually leaves from.
 */
function collectCrossing(crossings, t, from, to) {
  const dir = from ? 'out' : 'in';
  const anchor = from || to;
  const other = from ? t.to : t.from;
  const list = crossings[dir].get(anchor);
  if (list) list.push({ t, other });
  else crossings[dir].set(anchor, [{ t, other }]);
}

/**
 * Where the other end of a crossing lives, relative to the scope being drawn.
 *
 * A tab reading `from u` is enough one level down and useless four levels down,
 * where "which level is u on?" is the whole question. So the answer carries how
 * far out it is: nothing for the level immediately outside (much the commonest
 * case, and the one the fixed label already read correctly), `↑2` and up for a
 * further ancestor, and the full path for a sibling subtree, which is not "up"
 * from here at all.
 */
function relativeTo(stateId, here) {
  const s = getState(stateId);
  if (!s) return { name: stateId, hops: 0, path: String(stateId) };
  const name = localStateName(s);
  const path = blockPath(s.blockId) ? blockPath(s.blockId) + '/' + name : name;
  const container = s.blockId || null;
  const outward = [...blockAncestry(here).map(b => b.id).reverse(), null];
  const hops = outward.indexOf(container);   // 0 is `here` itself, 1 the level outside
  if (hops < 0) return { name, hops: -1, path };   // a sibling branch: not up from here
  return { name, hops, path };
}

/**
 * What a tab says, as the two rows it says it in.
 *
 * `role` is what this boundary crossing *is* — the block's own word for it
 * (`yes`, `carry`) when it declared one, `ENTRY` for the way in it declared,
 * and `FROM` / `TO` for a crossing it did not. That is the half the old label
 * could not carry: a tab reading `done → B/m2` and a tab reading `from u` were
 * the same shape and the same colour, so nothing on the canvas said which of
 * them the block had actually promised.
 *
 * `target` is the other end, nearest first, with how far out it is and a count
 * of the rest. The full list, with full paths, is the tooltip's job.
 */
function crossingLabel(role, list, here, bare = null) {
  if (!list || !list.length) return { role, target: bare ?? '—', empty: true };
  const ends = [];
  const seen = new Set();
  for (const c of list) {
    // Stamped on the crossing while the walk is being done anyway, so the
    // tooltip does not repeat it per hover. It is the *full* path, because the
    // tab has room for a local name and a hop count and the tooltip is where
    // the reader goes to find out which level that actually was.
    const rel = relativeTo(c.other, here);
    c.path = rel.path;
    c.hops = rel.hops;
    if (seen.has(c.other)) continue;
    seen.add(c.other);
    ends.push(rel);
  }
  const first = ends[0];
  const hop = first.hops > 1 ? `↑${first.hops} ` : first.hops < 0 ? '↗ ' : '';
  const more = ends.length > 1 ? ` +${ends.length - 1}` : '';
  return {
    role,
    target: clipTail(`${hop}${first.name}`, PORT_TARGET_MAX) + more,
    count: ends.length
  };
}

/**
 * The tabs on the edge of a scope: every edge that crosses this boundary, and
 * which of them the block declared.
 *
 * **A port describes the wiring, not the record.** `entry` and `exits` are what
 * a block *declares*; the crossings are what the machine actually does, and the
 * two diverge the moment anyone draws an edge. Reading only the declaration is
 * what made four different edges invisible from inside a block:
 *
 *   - an edge to any level above the immediately enclosing one, at any depth
 *   - an edge into a member that is not the entry
 *   - an edge out of a state that is not a declared exit
 *   - the second, third and fourth target of a declared exit, because the tab
 *     rendered `to[0]` and dropped the rest without saying so
 *
 * An undeclared crossing gets a tab of its own, marked as undeclared rather
 * than quietly drawn like the others — a block whose boundary is not the one it
 * declares is not a clean subroutine, and inlining it somewhere else would not
 * compose. That is worth saying on the diagram.
 *
 * Ids are chosen so every offset a reader has already hand-placed still
 * resolves: the entry tab keeps `__in__` and a declared exit keeps
 * `__out__:<i>:<state>`. Only the tabs that did not exist before are new.
 */
function buildPorts(blockId, byId, crossings) {
  const b = getBlock(blockId);
  if (!b) return [];
  const out = [];
  const tab = (id, dir, anchorId, label, extra) => {
    const anchor = byId.get(anchorId);
    if (!anchor) return;
    const role = clipTail(String(label.role || '').toUpperCase(), PORT_ROLE_MAX);
    const target = label.target;
    const box = portBox(role, target);
    const node = {
      id, kind: 'port', dir,
      // Carried onto the node, which it was not: `crossingLabel` set it and
      // nothing copied it across, so `node.empty` read undefined everywhere and
      // the `.is-empty` styling worked only by way of its own fallback.
      empty: !!label.empty,
      anchor: anchorId,
      dx: dir === 'in' ? -PORT_GAP : PORT_GAP,
      dy: 0,
      x: anchor.x + (dir === 'in' ? -PORT_GAP : PORT_GAP),
      y: anchor.y,
      box,
      r: boxRadius(box.w, box.h),
      role,
      target,
      // Kept because the tests, the aria label and anything that wants one
      // string still ask for a name.
      name: `${role.toLowerCase()} ${target}`,
      ...extra
    };
    out.push({
      node,
      edge: dir === 'in'
        ? { id: '__pin__' + out.length, from: id, to: anchorId, port: true }
        : { id: '__pout__' + out.length, from: anchorId, to: id, port: true }
    });
  };

  // ── in ──
  // The entry keeps `__in__` whether or not anything currently arrives at it:
  // a declared way in with no wiring yet is still what the block says about
  // itself, and dropping the tab would make "nothing arrives here" and "this is
  // not the entry" look identical.
  const inbound = crossings.in;
  if (byId.has(b.entry)) {
    tab('__in__', 'in', b.entry,
      crossingLabel('entry', inbound.get(b.entry), blockId, 'nothing yet'),
      { declared: true, crossings: inbound.get(b.entry) || [] });
  }
  for (const [anchorId, list] of inbound) {
    if (anchorId === b.entry) continue;
    tab('__in__:' + anchorId, 'in', anchorId,
      crossingLabel('from', list, blockId),
      { declared: false, crossings: list });
  }

  // ── out ──
  // Declared exits first, and by index, because a block may hand control back
  // from one state under two labels — "yes" and "no" out of the same
  // comparison. Keyed on the state alone the second tab overwrote the first.
  const outbound = crossings.out;
  const claimed = new Set();
  (b.exits || []).forEach((exit, i) => {
    if (!byId.has(exit.id)) return;
    claimed.add(exit.id);
    tab('__out__:' + i + ':' + exit.id, 'out', exit.id,
      crossingLabel(exit.label || 'exit', outbound.get(exit.id), blockId, 'nothing yet'),
      { declared: true, label: exit.label, crossings: outbound.get(exit.id) || [] });
  });
  for (const [anchorId, list] of outbound) {
    if (claimed.has(anchorId)) continue;
    tab('__out__:x:' + anchorId, 'out', anchorId,
      crossingLabel('to', list, blockId),
      { declared: false, crossings: list });
  }

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
  // Tabs sharing one anchor are fanned apart before the search runs, or two
  // exits off one state start from the same candidate and the second pays a
  // collision cost for standing where the first already is.
  const perAnchor = new Map();
  for (const p of ports) {
    const n = perAnchor.get(p.node.anchor) || 0;
    perAnchor.set(p.node.anchor, n + 1);
  }
  const seenAt = new Map();
  for (const p of ports) {
    const anchor = byId.get(p.node.anchor);
    if (!anchor) continue;
    const total = perAnchor.get(p.node.anchor) || 1;
    const nth = seenAt.get(p.node.anchor) || 0;
    seenAt.set(p.node.anchor, nth + 1);
    p.node.dy = (nth - (total - 1) / 2) * (PORT_H + 18);
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
 * Which node the level `scope` draws for a real state — the state itself when it
 * is an immediate member of that level, or the box of whichever child block
 * contains it. Null when the state is not under that level at all.
 *
 * **`visibleNodeIdFor` for an arbitrary level**, which is why it is not called
 * something about previews any more. It has two callers that want different
 * things from the same fact: a block's preview marking the transition a run is
 * taking (there the level is the block, and the answer is a dot or a nested
 * rect), and a note working out where it sits (there the level is the note's
 * own, which is deliberately *not* the one the reader is standing on).
 *
 * A walk up the ancestry rather than an ownerMap, because the map is built for
 * one scope and cached, and this is asked about others — for a handful of ids at
 * a time, so depth is what it costs and depth is small. `visibleNodeIdFor` stays
 * the fast path for the scope actually on screen.
 */
export function nodeIdAtScope(stateId, scope) {
  const s = getState(stateId);
  if (!s) return null;
  const at = scope || null;
  let cur = s.blockId || null;
  if (cur === at) return stateId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const b = getBlock(cur);
    if (!b) return null;
    if ((b.parent || null) === at) return cur;
    cur = b.parent || null;
  }
  return null;
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
