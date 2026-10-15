// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — TWINS AND THE CANONICAL COPY
// ══════════════════════════════════════════════════════════════════
// A volume is an exact drawing, so renaming its states gives another volume:
// its twins. One of them is the canonical copy, and it is chosen two ways,
// both of which depend only on the machine and never on how it was drawn:
//
//   • Breadth-first, when every state is reachable from the start and no state
//     has two edges with the same label to different states — every DFA,
//     DBA and deterministic TM with no unreachable state. States are
//     numbered in the order a breadth-first walk from the start meets them,
//     edges taken in label order: the numbering minimalDfaOf already uses, so
//     a minimal DFA's canonical copy is exactly the table it prints. No
//     renaming that fixes the start maps such a machine to itself, so it has
//     exactly (n − 1)! twins.
//
//   • Otherwise, by colour refinement with individualisation (the method nauty
//     uses): states are coloured by what they are and refined by what their
//     edges reach, ties are broken by trying each state in turn, and the leaf
//     with the smallest volume number is the canonical copy. The leaves that
//     tie with it are the automorphisms, which gives the twin count. A search
//     that runs out of budget says so rather than guessing.
//
// Everything is worked out on the volume's document, so one implementation
// serves every wing. DOM-free and App-free.

import { documentOf, readDocument } from './wings.js';
import { volumeNumber } from './volumes.js';

const SKIP = new Set(['id', 'from', 'to', 'curve', 'loopAngle', 'port', 'symbol']);

/**
 * Edge labels that sort the way the machine's alphabet does: by the symbol
 * read, in the alphabet's own order (a before b; a tape's blank first, then
 * 1, 2, …; ε last), then by everything else the edge carries. Reading order
 * is what a breadth-first numbering means — minimalDfaOf walks letters in Σ's
 * order — so the label must not sort by its text, where "dir" or "1" < "⊔"
 * would put a move ahead of the symbol it is a move on.
 */
function labeller(doc) {
  const tape = (doc.stackAlpha || []).includes(doc.config?.sym?.blank ?? '⊔') && /TM/.test(doc.machine);
  const order = tape ? doc.stackAlpha : [...(doc.sigma || []), ...(doc.stackAlpha || [])];
  const rank = new Map();
  order.forEach((s, i) => { if (!rank.has(s)) rank.set(s, i); });
  return t => {
    const sym = t.symbol ?? '';
    const r = rank.has(sym) ? rank.get(sym) : 1e6 + [...String(sym)].reduce((a, c) => a + c.codePointAt(0), 0);
    const keys = Object.keys(t).filter(k => !SKIP.has(k)).sort();
    return `${String(r).padStart(9, '0')}|${JSON.stringify(sym)}|${JSON.stringify(keys.map(k => [k, t[k]]))}`;
  };
}

/** What a state is, apart from its name and place. */
function stateKey(doc, s) {
  const acc = (doc.accepts || []).includes(s.id) ? 1 : 0;
  return JSON.stringify([acc, s.priority ?? null, s.output ?? null]);
}

function factorial(n) {
  let r = 1n;
  for (let i = 2n; i <= BigInt(n); i++) r *= i;
  return r;
}

function graphOf(doc) {
  const labelOf = labeller(doc);
  const n = doc.states.length;
  const at = new Map(doc.states.map((s, i) => [s.id, i]));
  const out = Array.from({ length: n }, () => []);
  const inn = Array.from({ length: n }, () => []);
  for (const t of doc.transitions) {
    const a = at.get(t.from), b = at.get(t.to);
    if (a === undefined || b === undefined) continue;
    const l = labelOf(t);
    out[a].push({ l, to: b });
    inn[b].push({ l, from: a });
  }
  for (const list of out) list.sort((x, y) => (x.l < y.l ? -1 : x.l > y.l ? 1 : x.to - y.to));
  return { n, at, out, inn, start: at.get(doc.startId) ?? 0 };
}

/** The breadth-first numbering, or null when it is not determined by the machine. */
function breadthFirst(g) {
  for (const list of g.out) {
    for (let i = 1; i < list.length; i++) if (list[i].l === list[i - 1].l && list[i].to !== list[i - 1].to) return null;
  }
  const order = [g.start];
  const seen = new Uint8Array(g.n);
  seen[g.start] = 1;
  for (let h = 0; h < order.length; h++) {
    for (const e of g.out[order[h]]) if (!seen[e.to]) { seen[e.to] = 1; order.push(e.to); }
  }
  return order.length === g.n ? order : null;
}

/** Rebuild a document with its states in `order` (order[newIndex] = oldIndex). */
function relabel(doc, order) {
  const states = order.map(i => doc.states[i]);
  return { ...doc, states, startId: states[0].id };
}

/** Colour refinement to a fixed point. Colours are dense integers that keep their old order. */
function refine(g, colour) {
  let c = colour;
  for (;;) {
    const sigs = new Array(g.n);
    for (let i = 0; i < g.n; i++) {
      const o = g.out[i].map(e => `${e.l}>${c[e.to]}`).sort().join(';');
      const p = g.inn[i].map(e => `${e.l}<${c[e.from]}`).sort().join(';');
      sigs[i] = `${String(c[i]).padStart(8, '0')}|${o}|${p}`;
    }
    const uniq = [...new Set(sigs)].sort();
    const id = new Map(uniq.map((s, k) => [s, k]));
    const next = sigs.map(s => id.get(s));
    const before = new Set(c).size;
    c = next;
    if (uniq.length === before) return c;
  }
}

/**
 * The canonical copy of a volume and its twin count.
 * → { body, volume, twins, exact, method } — twins is null when the search
 * ran out of budget, and `exact` says whether the copy is certainly canonical.
 */
export function canonicalOf(wing, params, body, { budget = 5000 } = {}) {
  const doc = documentOf(wing, params, body);
  const g = graphOf(doc);
  const n = g.n;
  const rank = d => {
    const r = readDocument(d);
    if (r.error) throw new Error(r.error);
    return { body: r.body, volume: volumeNumber(wing, r.params, r.body), params: r.params };
  };

  const bfs = breadthFirst(g);
  if (bfs) {
    const r = rank(relabel(doc, bfs));
    return { body: r.body, volume: r.volume, twins: factorial(n - 1), exact: true, method: 'breadth-first' };
  }

  // The start state is its own colour, and colours sort it first, so every
  // leaf keeps it at index 0.
  const keys = doc.states.map((s, i) => (i === g.start ? '0' : `1${stateKey(doc, s)}`));
  const uniq = [...new Set(keys)].sort();
  const initial = keys.map(k => uniq.indexOf(k));

  let best = null, ties = 0, nodes = 0, exhausted = true;
  const search = colour => {
    if (nodes++ > budget) { exhausted = false; return; }
    const c = refine(g, colour);
    const classes = new Map();
    c.forEach((x, i) => { if (!classes.has(x)) classes.set(x, []); classes.get(x).push(i); });
    if (classes.size === n) {
      const order = [...c.keys()].sort((a, b) => c[a] - c[b]);
      const r = rank(relabel(doc, order));
      if (!best || r.volume < best.volume) { best = r; ties = 1; } else if (r.volume === best.volume) ties += 1;
      return;
    }
    // The first non-trivial cell, by colour.
    const cell = [...classes.entries()].filter(([, v]) => v.length > 1).sort((a, b) => a[0] - b[0])[0][1];
    for (const v of cell) {
      // Individualise v: it keeps its colour, everything above shifts up one.
      const x = c[v];
      const next = c.map((y, i) => (i === v ? x : y >= x ? y + 1 : y));
      search(next);
      if (!exhausted) return;
    }
  };
  search(initial);
  if (!best) return { body, volume: volumeNumber(wing, params, body), twins: null, exact: false, method: 'search' };
  return {
    body: best.body, volume: best.volume,
    twins: exhausted ? factorial(n - 1) / BigInt(ties) : null,
    exact: exhausted, method: 'search'
  };
}
