// ══════════════════════════════════════════════════════════════════
//  PARSE-TREE LAYOUT
// ══════════════════════════════════════════════════════════════════
//  Import-free and geometry only: it is handed a tree of
//  `{sym, rule, children}` from js/grammar/parsing.js and answers positions.
//  Nothing here knows what an SVG is, which is what lets the same layout be
//  measured in a test and drawn twice on screen when two trees are being
//  compared.
//
//  Leaves are placed left to right on a moving cursor and every internal node
//  sits over the midpoint of its children — the shape a derivation tree is
//  drawn in everywhere, and the one that makes the frontier read as the word.
//  A node wider than the span of its own children is the only thing that can
//  cause an overlap, so one pass per depth pushes those apart afterwards.

const CHAR_W = 7.6;
const PAD_X = 12;
const NODE_H = 24;
const LEVEL_H = 58;
const GAP = 18;
const MARGIN = 20;

const widthOf = sym => Math.max(26, String(sym).length * CHAR_W + PAD_X * 2);

/**
 * tree -> { w, h, nodes, edges }. A node is
 * `{ x, y, w, sym, kind, rule }` with `kind` one of `var`, `term`, `eps`.
 */
export function layoutTree(root, opts = {}) {
  const eps = opts.eps || 'ε';
  const nodes = [];
  const edges = [];
  const byDepth = [];
  let cursor = MARGIN;

  function place(node, depth) {
    const isVar = !!node.children;
    const kids = node.children || [];
    const entry = {
      sym: node.sym,
      rule: node.rule || null,
      kind: isVar ? 'var' : 'term',
      w: widthOf(node.sym),
      y: MARGIN + depth * LEVEL_H,
      x: 0,
      depth
    };

    if (isVar && kids.length === 0) {
      // An ε-rule: the node still has a child to draw, or the tree would show
      // a variable with nothing under it and no sign it was ever expanded.
      const leaf = {
        sym: eps, rule: null, kind: 'eps', w: widthOf(eps),
        y: MARGIN + (depth + 1) * LEVEL_H, x: cursor + widthOf(eps) / 2, depth: depth + 1
      };
      cursor = leaf.x + leaf.w / 2 + GAP;
      entry.x = leaf.x;
      nodes.push(entry, leaf);
      (byDepth[depth] ||= []).push(entry);
      (byDepth[depth + 1] ||= []).push(leaf);
      edges.push([entry, leaf]);
      return entry;
    }

    if (!kids.length) {
      entry.x = cursor + entry.w / 2;
      cursor = entry.x + entry.w / 2 + GAP;
      nodes.push(entry);
      (byDepth[depth] ||= []).push(entry);
      return entry;
    }

    const placed = kids.map(k => place(k, depth + 1));
    entry.x = (placed[0].x + placed[placed.length - 1].x) / 2;
    nodes.push(entry);
    (byDepth[depth] ||= []).push(entry);
    placed.forEach(p => edges.push([entry, p]));
    return entry;
  }

  place(root, 0);

  // A wide label over narrow children is the one way this can collide. Push
  // the row rightwards until nothing overlaps, then re-centre the parents
  // above whatever moved — otherwise the fix opens a gap between an edge and
  // the node it points at.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    byDepth.forEach(row => {
      if (!row) return;
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const need = row[i - 1].x + row[i - 1].w / 2 + GAP + row[i].w / 2;
        if (row[i].x < need - 0.01) { row[i].x = need; moved = true; }
      }
    });
    if (!moved) break;
    for (let d = byDepth.length - 1; d >= 0; d--) {
      (byDepth[d] || []).forEach(n => {
        const kids = edges.filter(([p]) => p === n).map(([, c]) => c);
        if (kids.length) n.x = (kids[0].x + kids[kids.length - 1].x) / 2;
      });
    }
  }

  const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w / 2), 0);
  const left = nodes.reduce((m, n) => Math.min(m, n.x - n.w / 2), Infinity);
  const shift = left < MARGIN ? MARGIN - left : 0;
  if (shift) nodes.forEach(n => { n.x += shift; });

  const bottom = nodes.reduce((m, n) => Math.max(m, n.y), 0);
  return {
    w: Math.ceil(right + shift + MARGIN),
    h: Math.ceil(bottom + NODE_H + MARGIN),
    nodeH: NODE_H,
    nodes,
    edges: edges.map(([a, b]) => ({ x1: a.x, y1: a.y + NODE_H / 2, x2: b.x, y2: b.y - NODE_H / 2 }))
  };
}

/** The word the leaves spell — the tree's own claim about what it parsed. */
export function frontier(root, eps = 'ε') {
  const out = [];
  (function walk(n) {
    if (!n.children) { out.push(n.sym); return; }
    if (!n.children.length) return;    // an ε-rule contributes nothing
    n.children.forEach(walk);
  })(root);
  return out.length ? out : [eps];
}
