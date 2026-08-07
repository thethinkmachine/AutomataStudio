import { evalGuard, hasGuardsAnywhere, parseAssign, parseGuard, valsKey } from './guards.js';
import { snapshot } from './history.js';
import { App, R } from './state.js';
import { newId, newTId } from './states-transitions.js';
import { Change, emit } from './store.js';
import { showStatus } from './utils.js';

// Harel superstates: the CONTAINMENT half of hierarchy.
//
// A superstate is a state that contains other states. Being "in" it means being
// in exactly one of its children (OR-decomposition), and that single sentence is
// where all the power and all the limits come from:
//
//   containment is a TREE  →  a tree cannot cycle
//                          →  the nesting is bounded
//                          →  the machine flattens to a finite automaton.
//
// So this adds no computational power whatsoever. What it adds is succinctness
// and readability: one arrow leaving a region replaces one arrow per state
// inside it, and flattenComponent() below is the proof — it writes out the
// twelve arrows the one arrow stood for.
//
// Contrast hierarchy.js, where a box REFERENCES a component by name. Reference
// is a graph, a graph can cycle, the depth is unbounded, and a stack becomes
// unavoidable. Same picture, one bit different, and the bit lands exactly on the
// REG/CFL boundary.
//
// ── Shape of the data ──
//
// Nesting is stored as a `parent` pointer on the CHILD, not a `children` array
// on the parent. App.states therefore stays a flat array that every existing
// consumer — the renderer, the marquee, autolayout, export, the ~26 sites that
// reassign it wholesale — keeps reading exactly as before. A machine with no
// superstates has no `parent` anywhere and behaves identically to one written
// before this file existed.
//
// Coordinates stay ABSOLUTE, never relative to the container. A container's
// rectangle is DERIVED from the bounding box of its children (see
// superstateRects), which means it can never clip a child, never needs resize
// handles, and resizes for free as things are dragged in and out.

const KEY_ROOT = '';

export function isSuperstate(s) { return !!(s && s.super); }

// ══════════════════════════════════════════════════════════════════
//  COLLAPSE — A VIEW STATE, AND ONLY A VIEW STATE
// ══════════════════════════════════════════════════════════════════
// A collapsed region draws as an opaque titled box instead of showing its
// contents: the same thing an RSM box already is, borrowed so that deep nesting
// has a way to be read at all. Without it a region has exactly one rendering,
// fully expanded, always — and four levels of nesting is a wall of rectangles
// with no way to focus.
//
// `collapsed` is NEVER read by flattenComponent, machineTree, the simulator or
// any export. That is the whole design constraint, and there is a test on it:
// the flattened machine must be identical collapsed and expanded. It is what
// separates this from extractRegionToSubmachine, which is a real edit that
// changes which side of the REG/CFL line the machine sits on.
//
// So: how much do you want to SEE is one axis, and which class you are IN is a
// different one. They were the same lever, and they shouldn't be.

export function isCollapsed(s) { return !!(s && s.super && s.collapsed); }

/**
 * The outermost collapsed region containing `id`, or null.
 *
 * Outermost rather than nearest: with a collapsed region inside another
 * collapsed region, only the outer one is on screen, so that is the node
 * anything referring to a hidden state has to be redirected to.
 */
export function hiddenBy(id, states, byId = stateIndex(states)) {
  let out = null;
  for (const a of ancestorsOf(id, states, byId)) {
    if (isCollapsed(byId.get(a))) out = a;
  }
  return out;
}

/**
 * The node that stands for `id` on screen: itself when visible, otherwise the
 * collapsed region hiding it.
 *
 * Every consumer that draws or hit-tests something attached to a state goes
 * through this — an arrow into a hidden state has to land on the box that
 * replaced it, not on nothing.
 */
export function visibleNodeOf(id, states, byId = stateIndex(states)) {
  return hiddenBy(id, states, byId) || id;
}

/** True when the node is not on screen at all because an ancestor is collapsed. */
export function isHidden(id, states, byId = stateIndex(states)) {
  return hiddenBy(id, states, byId) !== null;
}

// ══════════════════════════════════════════════════════════════════
//  THE CONTAINMENT TREE
// ══════════════════════════════════════════════════════════════════

// Children by parent id, in App.states order. A `parent` pointing at a state
// that no longer exists is treated as no parent at all, so a half-deleted or
// hand-edited file degrades to a flat machine rather than losing states.
export function childIndex(states) {
  const present = new Set(states.map(s => s.id));
  const idx = new Map();
  for (const s of states) {
    const key = s.parent && present.has(s.parent) && s.parent !== s.id ? s.parent : KEY_ROOT;
    let arr = idx.get(key);
    if (!arr) idx.set(key, arr = []);
    arr.push(s);
  }
  return idx;
}

export function childrenOf(id, states, idx = childIndex(states)) {
  return idx.get(id) || [];
}

// id → state. Every walk below needs one, and building it per call is what made
// flattenComponent O(states × transitions): it asks for leavesUnder and
// defaultEntry once per arrow, and machineTree() flattens once per simulated
// word. The hot callers build this once and hand it down.
export function stateIndex(states) {
  return new Map(states.map(s => [s.id, s]));
}

// Ancestors innermost-first, excluding the state itself. The `seen` guard is
// not paranoia: a `parent` cycle is unreachable through the UI but trivially
// writable in a hand-edited .json, and without it every walk here hangs.
export function ancestorsOf(id, states, byId = stateIndex(states)) {
  const out = [], seen = new Set([id]);
  let cur = byId.get(id);
  while (cur && cur.parent && byId.has(cur.parent) && !seen.has(cur.parent)) {
    seen.add(cur.parent);
    out.push(cur.parent);
    cur = byId.get(cur.parent);
  }
  return out;
}

export function isDescendantOf(id, ancestorId, states) {
  return ancestorsOf(id, states).includes(ancestorId);
}

// Depth for every state in one pass.
//
// A per-state depthOf() would rebuild a Map of the whole machine on each call,
// and the three callers ask for it inside a sort comparator (superstateRects,
// renderSuperstates) and once per region per pointer move (containerAt) — on a
// path that runs on every render and every frame of a drag. That is O(n² log n)
// of pure allocation per frame; one memoised pass costs one Map for the lot.
export function depthIndex(states, byId = stateIndex(states)) {
  const depth = new Map();
  for (const s of states) {
    if (depth.has(s.id)) continue;
    // Walk outward to the first state whose depth is already known (or to the
    // root, or to the point a hand-edited `parent` cycle closes), then fill the
    // chain back in. `seen` is what makes a cycle terminate rather than hang.
    const chain = [], seen = new Set();
    let cur = s;
    while (cur && !depth.has(cur.id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    let d = cur && depth.has(cur.id) ? depth.get(cur.id) + 1 : 0;
    for (let i = chain.length - 1; i >= 0; i--) depth.set(chain[i].id, d++);
  }
  return depth;
}

// A container with nothing in it is a leaf. It reads on the canvas as an empty
// region and behaves as an ordinary state, which is the least surprising thing
// for a container the user has only just drawn — validateSuperstates says so
// out loud rather than having the state silently vanish from the flattening.
export function isLeaf(s, idx) {
  return !isSuperstate(s) || !(idx.get(s.id) || []).length;
}

// Every leaf inside `id`, in document order. A leaf resolves to itself, so
// callers never have to branch on whether a transition endpoint is a region.
export function leavesUnder(id, states, idx = childIndex(states), byId = stateIndex(states)) {
  const start = byId.get(id);
  if (!start) return [];
  const out = [], seen = new Set();
  const walk = s => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    if (isLeaf(s, idx)) { out.push(s.id); return; }
    for (const c of idx.get(s.id) || []) walk(c);
  };
  walk(start);
  return out;
}

// Where an arrow pointing AT a region actually lands: descend through default
// entries until a leaf. `initial` names the default child; without one the first
// child in document order stands in, so a freshly drawn region is still enterable.
export function defaultEntry(id, states, idx = childIndex(states), byId = stateIndex(states)) {
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !isLeaf(cur, idx) && !seen.has(cur.id)) {
    seen.add(cur.id);
    const kids = idx.get(cur.id) || [];
    const wanted = cur.initial && kids.find(k => k.id === cur.initial);
    cur = wanted || kids[0];
  }
  return cur ? cur.id : null;
}

// ══════════════════════════════════════════════════════════════════
//  GEOMETRY
// ══════════════════════════════════════════════════════════════════
// The single place that answers "how big is this node?", for all three shapes.
// render.js trims arrows against it, canvas.js hit-tests drops against it, and
// the export bounds frame with it — one rule rather than three copies of it.

export function nodeHalf(s, rects) {
  const r = rects && rects.get(s && s.id);
  if (r) return { hw: r.w / 2, hh: r.h / 2 };
  if (s && s.callee) return { hw: (s.w || R * 3.2) / 2, hh: (s.h || R * 1.8) / 2 };
  return { hw: R, hh: R };
}

function superConfig() {
  const c = App.config.superstate || {};
  return {
    pad: c.pad ?? 28,
    head: c.head ?? 24,
    minW: c.minW ?? 190,
    minH: c.minH ?? 120,
    // A collapsed region is sized like a box rather than by its contents —
    // the contents are precisely what it is not showing.
    closedW: c.closedW ?? 150,
    closedH: c.closedH ?? 56
  };
}

/**
 * Derived rectangle for every superstate that has children, deepest first so an
 * inner region is already measured when the region around it measures itself.
 *
 * `exclude` drops states from the measurement. Dragging needs that: a state
 * defining its container's boundary could otherwise never leave it, because the
 * container would grow to follow it forever.
 *
 * @returns {Map<string, {x:number,y:number,w:number,h:number}>} top-left rects
 */
export function superstateRects(states, opts = {}) {
  const exclude = opts.exclude || null;
  const { pad, head, minW, minH, closedW, closedH } = superConfig();
  const idx = childIndex(states);
  const rects = new Map();

  const supers = states.filter(isSuperstate);
  if (!supers.length) return rects;
  const depth = depthIndex(states);
  supers.sort((a, b) => (depth.get(b.id) || 0) - (depth.get(a.id) || 0));

  for (const s of supers) {
    // A collapsed region is a fixed box centred on its own x/y, and its x/y is
    // therefore no longer derived — this is the one case where writing to a
    // region's position is meaningful, because there are no children on screen
    // to recompute it from. syncSuperstateCentres skips it for the same reason.
    if (isCollapsed(s)) {
      rects.set(s.id, { x: s.x - closedW / 2, y: s.y - closedH / 2, w: closedW, h: closedH, closed: true });
      continue;
    }
    const kids = (idx.get(s.id) || []).filter(k => !(exclude && exclude.has(k.id)));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of kids) {
      const { hw, hh } = nodeHalf(k, rects);
      const r = rects.get(k.id);
      // A nested region's rect is not centred on its own x/y until the caller
      // syncs it, so measure the rect itself where one exists.
      const cx = r ? r.x + r.w / 2 : k.x;
      const cy = r ? r.y + r.h / 2 : k.y;
      minX = Math.min(minX, cx - hw); maxX = Math.max(maxX, cx + hw);
      minY = Math.min(minY, cy - hh); maxY = Math.max(maxY, cy + hh);
    }
    if (!Number.isFinite(minX)) {
      // Nothing inside: a placeholder region drawn around its own position.
      rects.set(s.id, { x: s.x - minW / 2, y: s.y - minH / 2, w: minW, h: minH });
      continue;
    }
    const x = minX - pad;
    const y = minY - pad - head;
    rects.set(s.id, {
      x, y,
      w: Math.max(minW, maxX - minX + pad * 2),
      h: Math.max(minH, maxY - minY + pad * 2 + head)
    });
  }
  return rects;
}

// The rect is what gets drawn; x/y is the point-shaped view of the same node
// that the marquee, the minimap, autolayout and the arrow maths all assume every
// node has. Keeping the two in step is one loop, and doing it here means none of
// those five callers needs to learn what a region is.
export function syncSuperstateCentres(states, rects) {
  for (const s of states) {
    const r = rects.get(s.id);
    // A collapsed region's rect is derived FROM its x/y rather than the other
    // way round, so there is nothing to write back — it is the one region whose
    // position the user actually owns.
    if (!r || r.closed) continue;
    s.x = r.x + r.w / 2;
    s.y = r.y + r.h / 2;
  }
}

/**
 * Everything a collapsed region is currently hiding.
 *
 * Computed once per pass beside the rects, because the consumers are spread
 * out — the renderer skips these, edge projection redirects to the box that
 * replaced them, and fit-to-screen and the minimap must not frame geometry
 * that is not on screen. A hidden state keeps its absolute coordinates, so
 * without this the camera frames empty canvas.
 */
export function hiddenStateIds(states, rects) {
  const out = new Set();
  const closed = [...rects].filter(([, r]) => r.closed).map(([id]) => id);
  if (!closed.length) return out;
  for (const id of closed) {
    for (const d of subtreeIds(id, states)) if (d !== id) out.add(d);
  }
  return out;
}

export function refreshSuperRects(states = App.states, opts) {
  const rects = superstateRects(states, opts);
  syncSuperstateCentres(states, rects);
  const hidden = hiddenStateIds(states, rects);
  // A region inside a collapsed one is not on screen, so it has no rectangle.
  // Leaving a stale one in the map would let it be hit-tested, framed and
  // measured as though it were visible.
  for (const id of hidden) rects.delete(id);
  App.superRects = rects;
  App.hiddenStates = hidden;
  return rects;
}

export function rectContains(r, pt) {
  return r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

export function headerRect(r) {
  const { head } = superConfig();
  return { x: r.x, y: r.y, w: r.w, h: Math.min(head, r.h) };
}

// Deepest region under a point, ignoring `exclude` and anything inside it —
// that being the set the user is dragging, which must not be able to land in
// itself. Deepest wins so dropping into a nested region does what it looks like.
export function containerAt(pt, states, rects, exclude = null) {
  const all = stateIndex(states);
  const depth = depthIndex(states, all);
  const byId = exclude && exclude.size ? all : null;
  // "Is this region inside the set being dragged?" — one Map for the whole
  // call rather than one per region, since this runs on every pointer move.
  const blocked = id => {
    let cur = byId.get(id), hops = 0;
    while (cur && hops++ <= byId.size) {
      if (exclude.has(cur.id)) return true;
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    return false;
  };
  let best = null, bestDepth = -1;
  for (const s of states) {
    if (!isSuperstate(s)) continue;
    if (byId && blocked(s.id)) continue;
    const r = rects.get(s.id);
    if (!rectContains(r, pt)) continue;
    const d = depth.get(s.id) || 0;
    if (d > bestDepth) { best = s; bestDepth = d; }
  }
  return best ? best.id : null;
}

// ══════════════════════════════════════════════════════════════════
//  ACTIONS  —  the other half of what containment buys
// ══════════════════════════════════════════════════════════════════
// Arrow economy is only half the argument for regions. The other half is that a
// region is a SCOPE: entry and exit actions compose down the nest, so leaving
// `strike` for `patrol` also leaves Combat and fires Combat's exit action —
// while leaving `strike` for `recover` does not, because both are inside Combat
// and the region was never exited.
//
// One rule states all of that, and it is the least common ancestor of the
// arrow's DRAWN endpoints. The transition exits everything from the active leaf
// outward up to (not including) the LCA, and enters everything from just below
// the LCA down to the target. An arrow entirely inside a region therefore costs
// nothing, which is what makes the region a scope rather than a drawing habit.
//
// Acceptance is untouched and Σ is still the only thing read, so this changes no
// language-class claim anywhere: the action string is a side effect riding along
// with a transition that was already there.

export function lcaOf(aId, bId, states, byId = stateIndex(states)) {
  const other = new Set([bId, ...ancestorsOf(bId, states, byId)]);
  for (const x of [aId, ...ancestorsOf(aId, states, byId)]) {
    if (other.has(x)) return x;
  }
  return null;
}

// The chain from `id` outward, stopping before `stop`. Innermost first, and
// `stop === null` means "all the way out", which is what an arrow between two
// top-level states wants.
function chainUpTo(id, stop, states, byId) {
  const out = [];
  for (const x of [id, ...ancestorsOf(id, states, byId)]) {
    if (x === stop) break;
    out.push(x);
  }
  return out;
}

export function hasActionsAnywhere(states = [], transitions = []) {
  return states.some(s => s && (s.entry || s.exit)) || transitions.some(t => t && t.action);
}

/**
 * What a flattened transition emits: exit actions innermost-first, then the
 * arrow's own action, then entry actions outermost-first. That order is the
 * observable difference between a region and a box drawn around some states.
 */
export function composeActions(fromLeaf, toLeaf, t, states, byId = stateIndex(states)) {
  const lca = lcaOf(t.from, t.to, states, byId);
  const exits = chainUpTo(fromLeaf, lca, states, byId).map(id => byId.get(id)?.exit);
  const entries = chainUpTo(toLeaf, lca, states, byId).map(id => byId.get(id)?.entry).reverse();
  return [...exits, t.action, ...entries].filter(Boolean).join(' ');
}

// Starting the machine runs the entry actions of everything the start leaf sits
// inside, outermost first. There is no transition to hang those on, so the
// flattening reports them separately and the simulator emits them at step 0.
export function entryActionsFor(leafId, states, byId = stateIndex(states)) {
  return chainUpTo(leafId, null, states, byId)
    .map(id => byId.get(id)?.entry).filter(Boolean).reverse().join(' ');
}

// ══════════════════════════════════════════════════════════════════
//  HISTORY  —  memory, without power
// ══════════════════════════════════════════════════════════════════
// An arrow can aim at a region's HISTORY instead of its default entry: re-enter
// Combat and resume whatever you were doing, rather than starting over. Shallow
// history (Ⓗ) resumes the region's direct child and takes default entries from
// there; deep history (Ⓗ*) resumes the exact leaf.
//
// It is still regular, and the construction says why: what has to be remembered
// is "which leaf was I in when I left", one value from a finite set, per region
// that anything aims history at. So the flattening is a PRODUCT of the leaves
// with that memory — the state outside the region splits into one copy per thing
// the region might remember.
//
// That is the price, stated exactly: k children means k copies of everything
// outside. The picture stays one arrow; the automaton it denotes does not.
//
// The product is built by reachability rather than enumeration, for the same
// reason subset construction is: the reachable corner of it is usually tiny, and
// enumerating |leaves| x |mem| up front would be paying for states no run visits.

const MEM_UNSET = '-';

function isInside(leafId, regionId, states, byId) {
  return leafId === regionId || ancestorsOf(leafId, states, byId).includes(regionId);
}

// The child of `regionId` on the path down to `leafId` — what shallow history
// remembers, as opposed to the leaf itself, which is what deep history wants.
function childTowards(regionId, leafId, states, byId) {
  const anc = ancestorsOf(leafId, states, byId);
  const i = anc.indexOf(regionId);
  if (i < 0) return null;
  return i === 0 ? leafId : anc[i - 1];
}

// Regions anything aims history at. Empty regions are excluded: they are leaves,
// so there is nothing inside them to remember.
export function historyRegionsOf(states, transitions, idx = childIndex(states), byId = stateIndex(states)) {
  const out = new Set();
  for (const t of transitions) {
    if (!t.entryMode || t.entryMode === 'default') continue;
    const target = byId.get(t.to);
    if (isSuperstate(target) && (idx.get(t.to) || []).length) out.add(t.to);
  }
  return out;
}

export { MEM_UNSET, isInside, childTowards };

// ══════════════════════════════════════════════════════════════════
//  AND-REGIONS  —  orthogonality, and the exponential
// ══════════════════════════════════════════════════════════════════
// Harel's other decomposition. An OR-region means "in exactly one of these";
// an AND-region means "in ALL of these at once" — movement and weapon and
// stance, running concurrently, which is the thing a flat machine models by
// multiplying every combination out by hand.
//
// Flattening does that multiplication, and it is where the succinctness claim
// stops being 1-arrow-to-N and becomes exponential: n orthogonal regions of k
// states each denote k^n configurations. The picture grows linearly, the
// automaton it denotes grows like a power. That is the actual theorem about
// statecharts, and `productStates` on the result is it as a number.
//
// ── The semantic choice, made deliberately ──
//
// When a symbol arrives, do the regions fire TOGETHER or one at a time? This
// implements the synchronous reading: on symbol s, EVERY orthogonal region takes
// an s-transition, and if any of them cannot, the step does not happen. The
// consequence is worth the whole feature:
//
//     L(AND-region) = the INTERSECTION of its regions' languages
//
// so an AND-region is literally the product construction that proves regular
// languages are closed under intersection. The interleaved reading (each region
// advances independently) gives the shuffle instead — also regular, less useful
// to look at. This is the same kind of call as "no transition priority", and it
// is documented here for the same reason.
//
// An arrow drawn on the AND-region itself is GLOBAL: it leaves every region at
// once, which is how a statechart says "whatever all of you were doing, stop".

export function isParallel(s) {
  return !!(s && s.super && s.parallel);
}

export function parallelRegionsOf(states, idx = childIndex(states)) {
  return new Set(states.filter(s => isParallel(s) && (idx.get(s.id) || []).length > 1).map(s => s.id));
}

// The orthogonal slice a leaf belongs to: the child of `parId` containing it.
// Two leaves in the same slice are alternatives; in different slices they are
// simultaneous, and that distinction is the whole of the step function below.
export function sliceOf(leafId, parId, states, byId) {
  return childTowards(parId, leafId, states, byId);
}

// ══════════════════════════════════════════════════════════════════
//  FLATTENING  —  the proof that this is still a finite automaton
// ══════════════════════════════════════════════════════════════════
// The textbook OR-decomposition semantics, stated as three rules:
//
//   an arrow OUT of a region    applies from every leaf inside it
//                               (this is the succinctness: 1 arrow → N arrows)
//   an arrow INTO a region      lands on its default entry leaf
//   a leaf accepts              if it, or any region containing it, is marked
//                               accepting
//
// No transition priority is applied: an inner arrow and an outer arrow on the
// same symbol both fire, and the result is nondeterministic. UML instead gives
// the innermost one precedence, which is a different (deterministic) convention
// and a different language — the union is the one that makes "a statechart is
// an NFA" literally true, so it is the one implemented here.
export function flattenComponent(comp) {
  const states = comp.states || [];
  const transitions = comp.transitions || [];
  const accepts = new Set(comp.accepts instanceof Set ? comp.accepts : (comp.accepts || []));
  const idx = childIndex(states);
  // Built once and handed to every walk below. machineTree() flattens each
  // component on every call and the simulator calls it per word, so rebuilding
  // this per arrow and per accepting leaf was the difference between linear and
  // quadratic on the hottest path in the app.
  const byId = stateIndex(states);

  const leaves = states.filter(s => isLeaf(s, idx));
  // Actions compose along the containment chain, so a machine carrying any of
  // them goes through the general path even when nothing is nested — there is
  // still an exit, an action and an entry to concatenate.
  const actions = hasActionsAnywhere(states, transitions);
  // Guards are a product whether or not anything is nested — a flag is memory
  // the flat machine has to carry in its state, and a machine with no regions at
  // all still needs it. Same reason actions bypass this: the fast path is only
  // for pictures that denote themselves.
  const guarded = hasGuardsAnywhere(transitions);
  if (leaves.length === states.length && !actions && !guarded) {
    // Nothing nested and nothing to emit — hand back a copy so callers can
    // treat the result as theirs to mutate either way.
    return {
      states: states.map(s => ({ ...s })),
      transitions: transitions.map(t => ({ ...t })),
      startId: comp.startId || null,
      accepts: [...accepts],
      startOutput: '',
      expanded: 0
    };
  }

  const outStates = leaves.map(({ parent, super: _s, initial, ...rest }) => ({ ...rest }));
  const outAccepts = leaves
    .filter(s => accepts.has(s.id) || ancestorsOf(s.id, states, byId).some(a => accepts.has(a)))
    .map(s => s.id);

  const seen = new Set();
  const outTrans = [];
  let n = 0, expanded = 0;
  // Identity of a transition minus its id: two arrows that read the same symbol
  // between the same pair of leaves are one arrow. Region expansion produces
  // duplicates routinely — every leaf of a region gets the region's outgoing
  // arrow, and a leaf may already have had it.
  const shapeKey = t => Object.keys(t)
    .filter(k => k !== 'id' && k !== 'curve' && k !== 'origin')
    .sort()
    .map(k => `${k}=${JSON.stringify(t[k])}`)
    .join('');

  for (const t of transitions) {
    const sources = leavesUnder(t.from, states, idx, byId);
    const target = defaultEntry(t.to, states, idx, byId);
    if (!target || !sources.length) continue;
    if (sources.length > 1) expanded += sources.length - 1;
    for (const from of sources) {
      const rec = { ...t, from, to: target };
      delete rec.id;
      if (actions) {
        // Folded into `output`, so `action` must not survive or it would be
        // counted twice by anything reading the flat machine. Note this is also
        // what stops two arrows out of the same region deduplicating: they exit
        // different nests, so they emit different strings and are not the same
        // arrow after all.
        delete rec.action;
        const out = composeActions(from, target, t, states, byId);
        if (out) rec.output = out; else delete rec.output;
      }
      const k = shapeKey(rec);
      if (seen.has(k)) continue;
      seen.add(k);
      // `origin` is the arrow the user actually drew. The simulator highlights
      // edges by transition id and every id here is synthetic, so without this a
      // machine with regions would run with nothing lighting up.
      outTrans.push({ ...rec, id: 't' + (++n), origin: t.id });
    }
  }

  const historyRegions = historyRegionsOf(states, transitions, idx, byId);
  // Any of the three augmentations puts the machine on the product path, and
  // they share it because a machine using two of them is their JOINT product,
  // not two passes each pretending the other is not there.
  if (historyRegions.size || guarded || parallelRegionsOf(states, idx).size) {
    return productFlatten({
      states, transitions, idx, byId, accepts, actions,
      comp, leaves, historyRegions, guarded, expanded
    });
  }

  const startId = comp.startId ? defaultEntry(comp.startId, states, idx, byId) : null;
  return {
    states: outStates,
    transitions: outTrans,
    startId,
    accepts: outAccepts,
    // Entering the machine is not a transition, so the start leaf's entry chain
    // has nowhere to ride. The simulator emits it as step 0.
    startOutput: actions && startId ? entryActionsFor(startId, states, byId) : '',
    expanded
  };
}

/**
 * The product flattening: leaves x history memory x flag valuation, explored
 * from the start configuration outward.
 *
 * One engine for both extensions on purpose. They are the same construction —
 * augment the state with something finite the picture remembers — and a machine
 * using history AND guards has to be their joint product, not two passes that
 * each pretend the other is not there.
 *
 * Flat states carry `origin` — the leaf the user actually drew — for the same
 * reason flat transitions do. One drawn state becomes several here, and the
 * simulator has to light up the one on the canvas.
 */
function productFlatten({ states, transitions, idx, byId, accepts, actions, comp, leaves, historyRegions, guarded, expanded }) {
  const HR = [...historyRegions];
  const leafSet = new Set(leaves.map(s => s.id));
  const budget = App.config.maxFlatStates || 4000;
  const flags = guarded ? [...(App.flags || [])] : [];

  // Parsed once per arrow rather than once per configuration: the BFS below
  // revisits every transition for every reachable state.
  const compiled = new Map();
  for (const t of transitions) {
    if (!guarded) break;
    let guard = null, assign = [];
    try { guard = parseGuard(t.guard); } catch (e) { guard = { k: 'lit', v: false }; }
    try { assign = parseAssign(t.assign); } catch (e) { assign = []; }
    compiled.set(t.id, { guard, assign });
  }

  const PR = parallelRegionsOf(states, idx);
  const memKey = m => HR.map(r => m[r] || MEM_UNSET).join(',');
  // The active set is a SET, so it is sorted before it becomes an id — two
  // routes into the same configuration must not produce two flat states.
  const actKey = A => [...A].sort().join('+');
  const idFor = (A, m, v) =>
    `${actKey(A)}@${memKey(m)}` + (flags.length ? `#${valsKey(v, flags)}` : '');

  // Descend into a node, fanning out at every AND-region: entering one means
  // entering all of its regions simultaneously, which is what makes the
  // configuration a set rather than a state.
  const enterNode = (nodeId, m, mode) => {
    const node = byId.get(nodeId);
    if (!node) return [];
    const kids = idx.get(nodeId) || [];
    if (!kids.length) return [nodeId];
    if (isParallel(node)) return kids.flatMap(c => enterNode(c.id, m, 'default'));
    // OR-region: one child, chosen by history or by the default entry.
    let childId = null;
    if (mode && mode !== 'default' && historyRegions.has(nodeId)) {
      const remembered = m[nodeId];
      childId = remembered && leafSet.has(remembered)
        ? (mode === 'deep' ? remembered : childTowards(nodeId, remembered, states, byId))
        : null;
    }
    if (!childId) {
      const wanted = node.initial && kids.find(k => k.id === node.initial);
      childId = (wanted || kids[0]).id;
    }
    // Deep history hands back the remembered LEAF, which needs no further descent.
    return childId === m[nodeId] && mode === 'deep' ? [childId] : enterNode(childId, m, 'default');
  };

  // Memory after moving from leaf L to leaf T. Inside a region, position already
  // determines the memory, so it is written from T rather than left stale — that
  // is what keeps the product canonical instead of splitting every state inside
  // a region by history it cannot observe.
  const step = (L, T, m) => {
    const next = { ...m };
    for (const R of HR) {
      if (isInside(T, R, states, byId)) next[R] = T;
      else if (L && isInside(L, R, states, byId)) next[R] = L;
    }
    return next;
  };

  const targetOf = (t, m) => {
    if (!t.entryMode || t.entryMode === 'default' || !historyRegions.has(t.to)) {
      return defaultEntry(t.to, states, idx, byId);
    }
    const remembered = m[t.to];
    // Never been in there, so history has nothing to say and the default entry
    // is what a first visit means.
    if (!remembered || !leafSet.has(remembered)) return defaultEntry(t.to, states, idx, byId);
    if (t.entryMode === 'deep') return remembered;
    // Shallow: resume the region's direct child, then take default entries the
    // rest of the way down. That difference IS the two flavours.
    const child = childTowards(t.to, remembered, states, byId);
    return child ? defaultEntry(child, states, idx, byId) : remembered;
  };

  const startLeaf = comp.startId ? defaultEntry(comp.startId, states, idx, byId) : null;
  const outStates = [], outTrans = [], outAccepts = [];
  const seen = new Map();
  const edgeSeen = new Set();
  let n = 0, truncated = false;

  const acceptsLeaf = id =>
    accepts.has(id) || ancestorsOf(id, states, byId).some(a => accepts.has(a));

  const visit = (A, m, v) => {
    const id = idFor(A, m, v);
    if (seen.has(id)) return id;
    if (seen.size >= budget) { truncated = true; return id; }
    seen.set(id, { A: [...A].sort(), m, v });
    const src = byId.get(A[0]);
    outStates.push({
      ...src, id, origin: A[0],
      // Every leaf active at once. The renderer lights all of them, which is
      // what "in all of these regions simultaneously" looks like on the canvas.
      origins: [...A].sort(),
      name: A.length > 1 ? A.map(l => byId.get(l)?.name || l).join(' ∥ ') : (src?.name || A[0]),
      // The half of the configuration that is NOT the picture: which child each
      // history region remembers, and the flag valuation. Both are recoverable
      // from the flat id, but only by parsing it — keeping them here is what
      // lets the simulator show "a flag is a state you didn't draw" as a value
      // that changes rather than as a claim in a note.
      // Every history region every time, not just the visited ones, so the
      // simulator's row keeps a stable shape instead of growing a column the
      // first time the run wanders into a region.
      // Copied, because `m` and `v` are reused as the BFS walks on.
      mem: HR.length ? Object.fromEntries(HR.map(r => [r, m[r] || MEM_UNSET])) : null,
      vals: flags.length ? Object.fromEntries(flags.map(f => [f, !!v[f]])) : null,
      parent: undefined, super: undefined, initial: undefined, parallel: undefined
    });
    if (A.every(acceptsLeaf)) outAccepts.push(id);
    return id;
  };

  if (!startLeaf) {
    return { states: [], transitions: [], startId: null, accepts: [], startOutput: '', expanded, truncated: false };
  }

  // Which parallel region an arrow tears down, if any: the one it exits on the
  // way from the active leaf up to the LCA of its drawn endpoints.
  const killedRegion = (t, L) => {
    const lca = lcaOf(t.from, t.to, states, byId);
    for (const x of [L, ...ancestorsOf(L, states, byId)]) {
      if (x === lca) break;
      if (PR.has(x)) return x;
    }
    return null;
  };

  const m0 = step(null, startLeaf, Object.fromEntries(HR.map(r => [r, null])));
  // Flags start false. A machine that wants to begin armed says so with an
  // assignment on the first arrow, which keeps "what is the initial state?" a
  // question with one answer.
  const v0 = Object.fromEntries(flags.map(f => [f, false]));
  const A0 = comp.startId ? enterNode(comp.startId, m0, 'default') : [startLeaf];
  const startFlat = visit(A0, m0, v0);
  const queue = [startFlat];

  // Arrows enabled from one active leaf, on one symbol, in this configuration.
  const enabledFrom = (L, sym, m, v) => {
    const out = [];
    for (const t of transitions) {
      if (t.symbol !== sym) continue;
      if (!leavesUnder(t.from, states, idx, byId).includes(L)) continue;
      const spec = compiled.get(t.id);
      // A guard false in this valuation means the arrow is not there — for this
      // copy of the state and only this one. The guard has been compiled away
      // into the state space.
      if (spec && !evalGuard(spec.guard, v)) continue;
      out.push(t);
    }
    return out;
  };

  const applyOne = (t, L, A, m, v) => {
    const kill = PR.size ? killedRegion(t, L) : null;
    const entered = t.entryMode && historyRegions.has(t.to)
      ? [targetOf(t, m)].filter(Boolean)
      : enterNode(t.to, m, t.entryMode);
    if (!entered.length) return null;
    // Tearing down an AND-region removes every slice at once; a local arrow
    // replaces only the leaf that took it.
    const remaining = kill
      ? A.filter(x => !isInside(x, kill, states, byId))
      : A.filter(x => x !== L);
    const A2 = [...new Set([...remaining, ...entered])];
    let m2 = m;
    for (const target of entered) m2 = step(L, target, m2);
    const v2 = compiled.get(t.id)?.assign.length ? { ...v } : v;
    for (const a of compiled.get(t.id)?.assign || []) v2[a.flag] = a.value;
    return { A2, m2, v2, entered };
  };

  while (queue.length) {
    const curId = queue.shift();
    const { A, m, v } = seen.get(curId);
    const symbols = [...new Set(transitions.map(t => t.symbol))];

    for (const sym of symbols) {
      // Per active leaf, the arrows it could take on this symbol.
      const choices = A.map(L => ({ L, ts: enabledFrom(L, sym, m, v) }));
      // Synchronous: every region must be able to move, or nothing does. With a
      // single active leaf this is just "is there an arrow", so the ordinary
      // non-parallel machine reaches exactly the same successors as before.
      if (choices.some(c => !c.ts.length)) {
        // ...unless one arrow tears the whole AND-region down, which is global
        // and needs no cooperation from the other regions.
        const global = choices.flatMap(c => c.ts.filter(t => killedRegion(t, c.L)).map(t => ({ t, L: c.L })));
        if (!global.length) continue;
        for (const g of global) emit(g.t, g.L, A, m, v, curId, sym);
        continue;
      }
      // Cartesian product across regions: one arrow per region, all at once.
      let combos = [[]];
      for (const c of choices) {
        const next = [];
        for (const partial of combos) for (const t of c.ts) next.push([...partial, { t, L: c.L }]);
        combos = next;
        if (combos.length > budget) { truncated = true; combos = combos.slice(0, budget); break; }
      }
      for (const combo of combos) {
        // A global arrow in the combo wins outright: everything else it would
        // have run in parallel with has just been torn down.
        const global = combo.find(({ t, L }) => killedRegion(t, L));
        if (global) { emit(global.t, global.L, A, m, v, curId, sym); continue; }
        let acc = { A2: A, m2: m, v2: v }, outs = [], origins = [];
        for (const { t, L } of combo) {
          const r = applyOne(t, L, acc.A2, acc.m2, acc.v2);
          if (!r) { acc = null; break; }
          if (actions) {
            const o = r.entered.map(e => composeActions(L, e, t, states, byId)).filter(Boolean).join(' ');
            if (o) outs.push(o);
          }
          origins.push(t.id);
          acc = r;
        }
        if (!acc) continue;
        addEdge(curId, acc, sym, outs.join(' '), origins[0]);
      }
    }
  }

  function emit(t, L, A, m, v, curId, sym) {
    const r = applyOne(t, L, A, m, v);
    if (!r) return;
    const out = actions ? r.entered.map(e => composeActions(L, e, t, states, byId)).filter(Boolean).join(' ') : '';
    addEdge(curId, r, sym, out, t.id);
  }

  function addEdge(fromId, r, sym, out, origin) {
    const nextId = idFor(r.A2, r.m2, r.v2);
    const fresh = !seen.has(nextId);
    visit(r.A2, r.m2, r.v2);
    if (fresh && seen.has(nextId)) queue.push(nextId);
    const rec = { from: fromId, to: nextId, symbol: sym, id: 't' + (++n), origin };
    if (out) rec.output = out;
    // Two drawn arrows can land on the same flat edge — a region-level arrow and
    // an inner one the leaf already had. Same edge, drawn twice.
    const ek = `${rec.from}|${rec.to}|${rec.symbol}|${rec.output || ''}`;
    if (edgeSeen.has(ek)) { n--; return; }
    edgeSeen.add(ek);
    outTrans.push(rec);
  }

  return {
    states: outStates,
    transitions: outTrans,
    startId: startFlat,
    accepts: outAccepts,
    startOutput: actions ? entryActionsFor(startLeaf, states, byId) : '',
    expanded,
    // What the product cost, which is the whole point of showing it: this many
    // states is what the one picture actually denotes.
    productStates: outStates.length,
    truncated
  };
}

export function hasSuperstateNesting(states = App.states) {
  const idx = childIndex(states);
  return states.some(s => isSuperstate(s) && (idx.get(s.id) || []).length > 0);
}

// Problems worth naming before the user wonders why a region does nothing.
export function validateSuperstates(comp) {
  const states = comp.states || [];
  const idx = childIndex(states);
  const byId = stateIndex(states);
  const issues = [];
  for (const s of states) {
    if (s.parent && !byId.has(s.parent)) {
      issues.push({ level: 'warn', state: s.id, message: `'${s.name}' names a container that no longer exists, so it is treated as top-level` });
    }
    if (s.super && s.callee) {
      issues.push({ level: 'error', state: s.id, message: `'${s.name}' is both a region and a call site — it can only be one` });
    }
    if (!isSuperstate(s)) continue;
    const kids = idx.get(s.id) || [];
    if (!kids.length) {
      issues.push({ level: 'warn', state: s.id, message: `Region '${s.name}' is empty, so it behaves like an ordinary state` });
    } else if (s.initial && !kids.some(k => k.id === s.initial)) {
      issues.push({ level: 'warn', state: s.id, message: `The default entry of '${s.name}' is not inside it — its first child is used instead` });
    }
  }
  if (states.some(s => s.parent && ancestorsOf(s.id, states, byId).includes(s.id))) {
    issues.push({ level: 'error', message: 'A region contains itself — the containment tree has a cycle' });
  }
  return issues;
}

// ══════════════════════════════════════════════════════════════════
//  EDITING
// ══════════════════════════════════════════════════════════════════

export function uniqueRegionName(base = 'Region') {
  const taken = new Set(App.states.map(s => s.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// Members of `ids` that are not already inside another member. Grouping a
// region together with something it already contains should produce one level
// of nesting, not two.
export function topLevelOf(ids, states = App.states) {
  const set = new Set(ids);
  // One index for the whole call: this runs per frame of a drag, via
  // dragMeasureExclusion() and containerAt()'s exclude set.
  const byId = stateIndex(states);
  return [...set].filter(id => !ancestorsOf(id, states, byId).some(a => set.has(a)));
}

export function groupIntoSuperstate(ids, name) {
  const members = topLevelOf(ids).map(id => App.states.find(s => s.id === id)).filter(Boolean);
  if (!members.length) { showStatus('Select the states to put in a region first'); return null; }

  snapshot();
  // The region joins the tree wherever its members already were. They may
  // disagree if the selection spans two containers; the first member's parent
  // wins and the rest move, which is the only choice that keeps the tree a tree.
  const parent = members[0].parent || undefined;
  const cx = members.reduce((a, s) => a + s.x, 0) / members.length;
  const cy = members.reduce((a, s) => a + s.y, 0) / members.length;

  const region = {
    id: newId(),
    x: cx, y: cy,
    name: uniqueRegionName(name || 'Region'),
    super: true,
    // Entering the region has to land somewhere. The start state is the right
    // default when it is in the selection, since the machine already begins there.
    initial: members.find(s => s.id === App.startId)?.id || members[0].id
  };
  if (parent) region.parent = parent;

  for (const s of members) s.parent = region.id;
  // Placed before its first member so the region reads as introducing them in
  // App.states order, which is also the order the left panel lists.
  const at = App.states.indexOf(members[0]);
  App.states.splice(Math.max(0, at), 0, region);

  emit(Change.GRAPH);
  showStatus(`Region '${region.name}' now contains ${members.length} state${members.length === 1 ? '' : 's'}`);
  return region;
}

/**
 * Dissolves a region, keeping the language exactly. Its incident arrows are
 * expanded by the same three rules flattenComponent uses, which is what turns
 * the one arrow leaving the region back into the N arrows it stood for — and
 * the status line says how many, because that number IS the succinctness claim.
 */
export function ungroupSuperstate(id) {
  const region = App.states.find(s => s.id === id);
  if (!isSuperstate(region)) return false;

  snapshot();
  const idx = childIndex(App.states);
  const kids = idx.get(id) || [];
  const inner = leavesUnder(id, App.states, idx);
  const entry = defaultEntry(id, App.states, idx);

  const before = App.transitions.length;
  const seen = new Set();
  const key = t => `${t.from}${t.to}${t.symbol}${t.pop || ''}${t.push || ''}`;
  const kept = [];
  for (const t of App.transitions) {
    const sources = t.from === id ? inner : [t.from];
    const to = t.to === id ? entry : t.to;
    if (!to) continue;
    for (const from of sources) {
      const rec = from === t.from && to === t.to ? t : { ...t, id: newTId(), from, to };
      if (seen.has(key(rec))) continue;
      seen.add(key(rec));
      kept.push(rec);
    }
  }
  App.transitions = kept;

  if (App.startId === id) App.startId = entry;
  if (App.accepts.has(id)) {
    App.accepts.delete(id);
    for (const leaf of inner) App.accepts.add(leaf);
  }

  // Children rise one level rather than being deleted — that is the whole
  // difference between Ungroup and Delete on a container.
  for (const k of kids) {
    if (region.parent) k.parent = region.parent;
    else delete k.parent;
  }
  App.states = App.states.filter(s => s.id !== id);
  App.selectedStates.delete(id);

  emit(Change.GRAPH);
  const grew = App.transitions.length - before;
  showStatus(grew > 0
    ? `Region dissolved — its ${grew === 1 ? 'arrow became 2' : `arrows expanded into ${grew} more`}`
    : 'Region dissolved');
  return true;
}

// Drag-and-drop's commit step. Refuses to put a state inside itself or inside
// anything it contains, which is the only way the tree can stop being a tree.
export function reparentState(id, parentId, opts = {}) {
  const s = App.states.find(x => x.id === id);
  if (!s) return false;
  const current = s.parent || null;
  if ((parentId || null) === current) return false;
  if (parentId) {
    if (parentId === id) return false;
    if (isDescendantOf(parentId, id, App.states)) return false;
    const target = App.states.find(x => x.id === parentId);
    if (!isSuperstate(target)) return false;
  }
  // A drag already took its undo point when the pointer first moved, so the
  // drop that ends it should not push a second one for the same gesture.
  if (opts.takeSnapshot !== false) snapshot();
  if (parentId) s.parent = parentId; else delete s.parent;
  // A region whose default entry just walked out of it would silently fall back
  // to whatever child happened to be first, so hand the role over explicitly.
  if (current) {
    const old = App.states.find(x => x.id === current);
    if (old && old.initial === id) {
      const left = childrenOf(current, App.states);
      if (left.length) old.initial = left[0].id; else delete old.initial;
    }
  }
  if (parentId) {
    const target = App.states.find(x => x.id === parentId);
    if (target && !target.initial) target.initial = id;
  }
  emit(Change.GRAPH);
  return true;
}

/**
 * Flip a region between OR (in one child) and AND (in all of them at once).
 *
 * Refuses unless every child is itself a region: orthogonality decomposes into
 * regions running concurrently, and "in all of these plain states at once" is
 * not a thing a state machine can mean.
 */
export function toggleParallel(id) {
  const region = App.states.find(s => s.id === id);
  if (!isSuperstate(region)) return false;
  const kids = childrenOf(id, App.states);
  if (!region.parallel) {
    if (kids.length < 2 || !kids.every(isSuperstate)) {
      showStatus('An orthogonal region needs two or more regions inside it — group each concurrent part first');
      return false;
    }
  }
  snapshot();
  if (region.parallel) delete region.parallel; else region.parallel = true;
  // A default entry is meaningless once every child is entered at once.
  if (region.parallel) delete region.initial;
  emit(Change.GRAPH);
  showStatus(region.parallel
    ? `'${region.name}' is now orthogonal — its ${kids.length} regions run concurrently`
    : `'${region.name}' is an ordinary region again`);
  return true;
}

/**
 * Show or hide a region's contents.
 *
 * A view change, so it takes an undo point (the user asked for it and will want
 * it back) but does NOT touch the machine: nothing downstream of the renderer
 * reads `collapsed`, and there is a test asserting the flattened machine is
 * identical either way. Contrast extractRegionToSubmachine, which is the real
 * edit — the point of having both is that "show me less" and "mean something
 * different" stopped being the same lever.
 *
 * Collapsing pins the region where it was drawn: with no children on screen
 * there is nothing to derive its position from, so the centre it had is the
 * centre it keeps.
 */
export function toggleRegionCollapsed(id, want) {
  const region = App.states.find(s => s.id === id);
  if (!isSuperstate(region)) return false;
  const next = want === undefined ? !region.collapsed : !!want;
  if (!!region.collapsed === next) return false;

  snapshot();
  if (next) {
    const r = App.superRects.get(id);
    if (r) { region.x = r.x + r.w / 2; region.y = r.y + r.h / 2; }
    region.collapsed = true;
  } else {
    delete region.collapsed;
  }
  emit(Change.GRAPH);
  const n = subtreeIds(id, App.states).length - 1;
  showStatus(next
    ? `'${region.name}' collapsed — ${n} state${n === 1 ? '' : 's'} hidden, machine unchanged`
    : `'${region.name}' expanded`);
  return true;
}

/** Every collapsed region opened at once — the way out of a deeply folded diagram. */
export function expandAllRegions() {
  const closed = App.states.filter(isCollapsed);
  if (!closed.length) { showStatus('Nothing is collapsed'); return false; }
  snapshot();
  for (const s of closed) delete s.collapsed;
  emit(Change.GRAPH);
  showStatus(`Expanded ${closed.length} region${closed.length === 1 ? '' : 's'}`);
  return true;
}

export function setDefaultEntry(childId) {
  const child = App.states.find(s => s.id === childId);
  if (!child || !child.parent) { showStatus('Only a state inside a region has a default entry'); return false; }
  const region = App.states.find(s => s.id === child.parent);
  if (!region) return false;
  if (region.initial === childId) return false;
  snapshot();
  region.initial = childId;
  emit(Change.GRAPH);
  showStatus(`Entering '${region.name}' now starts at '${child.name}'`);
  return true;
}

// Everything a delete has to take with it. Deleting a container deletes what is
// inside it — Ungroup is the non-destructive door, and the two being different
// is the point.
export function subtreeIds(id, states = App.states) {
  const idx = childIndex(states);
  const out = [id], seen = new Set([id]);
  for (let i = 0; i < out.length; i++) {
    for (const c of idx.get(out[i]) || []) {
      // `seen` is not redundant with childIndex's guard: that one only rejects a
      // state that is its OWN parent, so a two-node `parent` cycle in a
      // hand-edited file would push A, B, A, B … forever. This is the delete and
      // drag path, so the failure mode is an array that eats the heap rather
      // than an error anyone could read.
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}
