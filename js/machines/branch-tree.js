// ══════════════════════════════════════════════════════════════════
//  THE COMPUTATION TREE — every branch a nondeterministic run took
// ══════════════════════════════════════════════════════════════════
// A nondeterministic machine's trace is one path: the accepting branch, or
// the furthest one the search reached. What the search actually did — every
// configuration it opened, which ones forked, which died, which ran into a
// configuration another branch had already reached — was thrown away the
// moment that path was chosen. This is where it is kept instead, and two
// views read it: the Computation Tree card (js/branch-tree-ui.js) draws it
// whole, and the canvas (js/branch-tokens.js) puts a token on every branch
// alive at the playhead, the way a coloured Petri net marks its places.
//
// **Colour is identity, and it is inherited.** Each node owns a slice of the
// hue range and hands its children equal sub-slices of it (Tennekes & de
// Jonge's Tree Colors, InfoVis 2014): a branch that has not split keeps its
// parent's colour exactly, and two branches are similar in colour exactly as
// far as they are close in the tree. The split is decided when the node is
// expanded — every child of a configuration is known at once — so a colour
// never changes after it is given, and a tree that is still growing (an NDTM
// streams its search) never repaints the branches already on screen.
//
// The range skips gold and red, which the canvas already spends on accept
// and reject: a branch must never look like a verdict.
//
// **The tree hangs off the run it describes** — `steps[0].branchTree` — not
// off App, so a quiet run can never swap the one on screen.
//
// **And only the player asks for one.** The same simulators serve StateMate's
// trace tool and the complexity profile, which read steps and never a tree, so
// recording is opt-in — `withBranchTrees()`, the mirror of paint.js's
// suppression — and a run nobody will look at pays nothing for it. The
// deciders never take a tree at all. Once a tree is `full` the explorers stop
// building children for it, so a search that runs on to its budget past the
// cap costs what it did before the tree existed.
//
// Import-free, like the rest of the layer's leaves: the explorers record into
// it and the page reads it, and neither needs the other.
// ══════════════════════════════════════════════════════════════════

/** The most nodes a tree records. Past it the search carries on; the tree says it stopped. */
export const TREE_NODE_CAP = 1500;

let wanted = 0;

/** Run `fn` with the simulators recording trees — the player's run, and nothing else. */
export function withBranchTrees(fn) {
  wanted++;
  try { return fn(); } finally { wanted--; }
}

/** Whether a run starting now should record its branches. */
export function branchTreesWanted() {
  return wanted > 0;
}

/** A tree for a run starting now, or null when nobody asked for one. */
export function newBranchTree(mode) {
  return wanted > 0 ? new BranchTree(mode) : null;
}

/** The hue range the root owns, in OKLCH degrees: teal through blue to magenta. */
export const HUE_LO = 115;
export const HUE_HI = 330;

// The share of its slot each child keeps (Tree Colors' f). The gaps are what
// keep two siblings apart after a few levels have narrowed both.
const SHARE = 0.75;

/**
 * How a player step finds its place in the tree.
 *
 *   'path'   the steps are one branch of it, in order (every search-based
 *            simulator: step i is the i-th configuration of the witness)
 *   'level'  step i is everything alive after i symbols (an NFA's set run)
 *   'search' each step is one configuration being expanded and carries its
 *            node as `tn` (the NDTM's breadth-first search)
 */
export class BranchTree {
  constructor(mode = 'path') {
    this.mode = mode;
    this.nodes = [];
    this.byDepth = [];
    /** Node ids from the root to the branch the trace follows, once known. */
    this.path = null;
    this.truncated = false;
    this.done = mode !== 'search';
    /** Bumped on every change, so a view can tell a grown tree from the same one. */
    this.version = 0;
    this.acceptedAt = -1;
  }

  /** True once the cap is reached: an explorer stops building children for it. */
  get full() { return this.nodes.length >= TREE_NODE_CAP; }

  /** The root configuration. Returns its id. */
  root(state, cfg = null) {
    const id = this.add(-1, state, null, 0, HUE_LO, HUE_HI);
    if (cfg) cfg.tn = id;
    return id;
  }

  add(parent, state, tid, depth, lo, hi) {
    if (this.nodes.length >= TREE_NODE_CAP) { this.truncated = true; return -1; }
    const id = this.nodes.length;
    this.nodes.push({ id, parent, state, tid, depth, lo, hi, kids: [], expanded: false, fate: '', into: -1, step: -1 });
    (this.byDepth[depth] || (this.byDepth[depth] = [])).push(id);
    this.version++;
    return id;
  }

  /**
   * Give node `pid` its children, all at once — the hue split needs the count.
   *
   * Each kid is `{ state, tid, depth, fresh, into? }`. A kid that is not
   * `fresh` reached a configuration the search already holds: it is recorded,
   * as a leaf that merged, because leaving it out would make the branch look
   * as though it died there. Returns the kids' ids (-1 past the cap).
   */
  expand(pid, kids) {
    const p = this.nodes[pid];
    if (!p || p.expanded) return kids.map(() => -1);
    p.expanded = true;
    this.version++;
    if (!kids.length) { if (!p.fate) p.fate = 'dead'; return []; }
    const n = kids.length;
    const w = (p.hi - p.lo) / n;
    return kids.map((k, i) => {
      // An only child keeps its parent's slice, so a run that never forks is
      // one colour from end to end rather than drifting as it deepens.
      const mid = p.lo + (i + 0.5) * w;
      const half = n === 1 ? w / 2 : (w * SHARE) / 2;
      const id = this.add(pid, k.state, k.tid ?? null, k.depth ?? p.depth + 1, mid - half, mid + half);
      if (id < 0) return -1;
      p.kids.push(id);
      if (!k.fresh) {
        const node = this.nodes[id];
        node.fate = 'merged';
        node.expanded = true;
        if (k.into != null) node.into = k.into;
      }
      return id;
    });
  }

  /**
   * The explorers' shape of `expand`: children as configurations, each linked
   * back by `via` and carrying the `depth` the search gave it. A fresh child
   * learns its node as `cfg.tn`, which is how it is found when it in turn is
   * expanded. `via` is a transition for most searches and an id for the NDTM's.
   */
  expandCfgs(cfg, kids) {
    if (cfg.tn == null || cfg.tn < 0) return;
    const ids = this.expand(cfg.tn, kids.map(k => ({
      state: k.cfg.state,
      tid: tidOf(k.cfg.via),
      depth: k.cfg.depth,
      fresh: k.fresh
    })));
    kids.forEach((k, i) => { if (k.fresh) k.cfg.tn = ids[i]; });
  }

  /** A configuration that accepts. */
  accept(id) {
    const node = this.nodes[id];
    if (!node) return;
    node.fate = 'acc';
    if (this.acceptedAt < 0) this.acceptedAt = id;
    this.version++;
  }

  /** The search is over; `last` (a node id, or -1) is where the trace ends. */
  finish(last = -1) {
    if (last >= 0 && this.nodes[last]) this.path = this.lineage(last);
    this.done = true;
    this.version++;
    return this;
  }

  /** Ids from the root down to `id`. */
  lineage(id) {
    const out = [];
    for (let cur = id; cur >= 0; cur = this.nodes[cur].parent) out.push(cur);
    return out.reverse();
  }

  node(id) { return this.nodes[id]; }

  hue(id) {
    const n = this.nodes[id];
    return n ? (n.lo + n.hi) / 2 : (HUE_LO + HUE_HI) / 2;
  }

  /**
   * What a node's end is, as far as the tree knows it.
   *
   *   'acc'     an accepting configuration
   *   'dead'    expanded, and no move applied
   *   'merged'  reached a configuration another branch already had
   *   'open'    never expanded: the search stopped first, or (while an NDTM's
   *             search is still streaming) has not got to it yet
   *   ''        an inner node — it has children
   */
  fateOf(id) {
    const n = this.nodes[id];
    if (!n) return '';
    if (n.fate) return n.fate;
    return n.expanded ? '' : 'open';
  }

  /**
   * Where step `idx` of `steps` stands in the tree: the depth whose branches
   * are alive there, and the one node the trace is talking about (-1 when the
   * step is a whole level, as an NFA's is).
   */
  frameAt(steps, idx) {
    const step = steps[idx];
    if (!step) return null;
    if (this.mode === 'search') {
      // The closing summary is no configuration; it stands where the last one did.
      for (let i = idx; i >= 0; i--) {
        const tn = steps[i]?.tn;
        if (tn != null && tn >= 0 && this.nodes[tn]) return { depth: this.nodes[tn].depth, focus: tn };
      }
      return { depth: 0, focus: 0 };
    }
    if (this.mode === 'level') {
      const depth = typeof step.pos === 'number' ? step.pos : idx;
      return { depth, focus: -1 };
    }
    if (this.path && this.path.length) {
      const id = this.path[Math.min(idx, this.path.length - 1)];
      return { depth: this.nodes[id].depth, focus: id };
    }
    return { depth: idx, focus: -1 };
  }

  /** The branches alive at `depth`: every node there except the ones that merged. */
  liveAt(depth) {
    const ids = this.byDepth[depth];
    if (!ids) return [];
    return ids.filter(id => this.nodes[id].fate !== 'merged');
  }

  /** How many branches the tree ends in. */
  leafCount() {
    let n = 0;
    for (const node of this.nodes) if (!node.kids.length) n++;
    return n;
  }
}

function tidOf(via) {
  if (via == null) return null;
  return typeof via === 'object' ? (via.id ?? null) : via;
}

/** The tree a run carries, or null. */
export function branchTreeOf(steps) {
  const first = steps && steps[0];
  return (first && first.branchTree) || null;
}

/**
 * Hang `tree` on the run it describes. Non-enumerable, so nothing that copies
 * or serializes a step — StateMate's trace projection, a test's deepEqual —
 * drags fifteen hundred nodes along with it.
 */
export function attachBranchTree(steps, tree) {
  if (tree && steps && steps[0]) {
    Object.defineProperty(steps[0], 'branchTree', { value: tree, configurable: true, writable: true, enumerable: false });
  }
  return steps;
}
