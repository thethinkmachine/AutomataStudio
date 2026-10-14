// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WHAT A FINITE AUTOMATON SAYS
// ══════════════════════════════════════════════════════════════════
// The facts a finite-automaton volume shows, computed from its body with no
// document and no App: its DFA (by subset construction for an NFA), the
// minimal DFA (Moore refinement, numbered breadth-first — the numbering
// minimalDfaOf in js/library/analyze.js uses, and tests/babel.test.js holds
// the two to the same answer), the class of its language, and its first words.
//
// Pure, so the room map can classify thousands of volumes in the worker, and
// the website can show them with no engine attached.

/** The language classes the room map colours by. */
export const LANGUAGE_CLASSES = Object.freeze({
  e: { label: '∅', say: 'accepts nothing' },
  u: { label: 'Σ*', say: 'accepts every word' },
  f: { label: 'finite', say: 'accepts finitely many words' },
  c: { label: 'cofinite', say: 'rejects finitely many words' },
  o: { label: 'something else', say: 'accepts and rejects infinitely many words' }
});

/** The most subsets an NFA's determinisation may build here. */
export const SUBSET_LIMIT = 4096;

/**
 * A finite automaton's body → its complete DFA `{ n, k, delta, acc }` (delta
 * flat over state·k + letter), or null when the subset construction outgrows
 * SUBSET_LIMIT. `wing.type` says how to read the body.
 */
export function dfaOf(type, params, body) {
  const [n, k] = params;
  if (type === 'DFA' || type === 'DBA' || type === 'DcoBA' || type === 'DWA') {
    const [acc, delta] = body;
    return { n, k, delta: Int32Array.from(delta), acc: Uint8Array.from(acc) };
  }
  if (type !== 'NFA' && type !== 'ε-NFA') return null;
  const eps = type === 'ε-NFA';
  const [acc, moves] = body;
  const succ = Array.from({ length: n * (k + 1) }, () => []);
  for (const [from, a, to] of moves) succ[from * (k + 1) + a].push(to);
  const closure = set => {
    if (!eps) return set;
    const out = new Set(set), stack = [...set];
    while (stack.length) {
      const q = stack.pop();
      for (const r of succ[q * (k + 1) + k]) if (!out.has(r)) { out.add(r); stack.push(r); }
    }
    return out;
  };
  const keyOf = set => [...set].sort((a, b) => a - b).join(',');
  const start = closure(new Set([0]));
  const index = new Map([[keyOf(start), 0]]);
  const sets = [start];
  const delta = [];
  for (let i = 0; i < sets.length; i++) {
    if (sets.length > SUBSET_LIMIT) return null;
    for (let a = 0; a < k; a++) {
      const next = new Set();
      for (const q of sets[i]) for (const r of succ[q * (k + 1) + a]) next.add(r);
      const c = closure(next);
      const key = keyOf(c);
      let j = index.get(key);
      if (j === undefined) { j = sets.length; index.set(key, j); sets.push(c); }
      delta.push(j);
    }
  }
  const accSet = sets.map(s => ([...s].some(q => acc[q]) ? 1 : 0));
  return { n: sets.length, k, delta: Int32Array.from(delta), acc: Uint8Array.from(accSet) };
}

/** The minimal complete DFA, states numbered breadth-first from the start. */
export function minimiseDfa(t) {
  const { k, delta, acc } = t;
  // Reachable part first.
  const seen = new Int32Array(t.n).fill(-1);
  const order = [0];
  seen[0] = 0;
  for (let h = 0; h < order.length; h++) for (let a = 0; a < k; a++) {
    const r = delta[order[h] * k + a];
    if (seen[r] < 0) { seen[r] = order.length; order.push(r); }
  }
  const n = order.length;
  let block = order.map(q => acc[q]);
  for (;;) {
    const sig = new Map();
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = String(block[i]);
      for (let a = 0; a < k; a++) s += ',' + block[seen[delta[order[i] * k + a]]];
      let b = sig.get(s);
      if (b === undefined) { b = sig.size; sig.set(s, b); }
      next[i] = b;
    }
    const same = sig.size === new Set(block).size;
    block = next;
    if (same) break;
  }
  // Breadth-first renumbering of the quotient.
  const num = new Map([[block[0], 0]]);
  const rep = [0];
  for (let h = 0; h < rep.length; h++) for (let a = 0; a < k; a++) {
    const b = block[seen[delta[order[rep[h]] * k + a]]];
    if (!num.has(b)) { num.set(b, rep.length); rep.push(seen[delta[order[rep[h]] * k + a]]); }
  }
  const m = rep.length;
  const out = new Int32Array(m * k);
  const accOut = new Uint8Array(m);
  for (let q = 0; q < m; q++) {
    accOut[q] = acc[order[rep[q]]];
    for (let a = 0; a < k; a++) out[q * k + a] = num.get(block[seen[delta[order[rep[q]] * k + a]]]);
  }
  return { n: m, k, delta: out, acc: accOut };
}

/** Which states can reach a state satisfying `good`. */
function coReach(t, good) {
  const { n, k, delta } = t;
  const preds = Array.from({ length: n }, () => []);
  for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) preds[delta[q * k + a]].push(q);
  const live = new Uint8Array(n);
  const stack = [];
  for (let q = 0; q < n; q++) if (good(q)) { live[q] = 1; stack.push(q); }
  while (stack.length) { const q = stack.pop(); for (const p of preds[q]) if (!live[p]) { live[p] = 1; stack.push(p); } }
  return live;
}

/** True when the states marked `live` (and reachable) carry a cycle. */
function liveCycle(t, live) {
  const { n, k, delta } = t;
  const colour = new Uint8Array(n);
  let cyclic = false;
  const visit = q => {
    // Iterative DFS, so a 10,000-state DFA does not overflow the stack.
    const stack = [[q, 0]];
    colour[q] = 1;
    while (stack.length && !cyclic) {
      const top = stack[stack.length - 1];
      if (top[1] >= k) { colour[top[0]] = 2; stack.pop(); continue; }
      const r = delta[top[0] * k + top[1]++];
      if (!live[r]) continue;
      if (colour[r] === 1) cyclic = true;
      else if (!colour[r]) { colour[r] = 1; stack.push([r, 0]); }
    }
  };
  if (live[0]) visit(0);
  return cyclic;
}

/** The class of a complete DFA's language: e, u, f, c or o (LANGUAGE_CLASSES). */
export function languageClass(t) {
  const reach = new Uint8Array(t.n);
  const stack = [0];
  reach[0] = 1;
  while (stack.length) { const q = stack.pop(); for (let a = 0; a < t.k; a++) { const r = t.delta[q * t.k + a]; if (!reach[r]) { reach[r] = 1; stack.push(r); } } }
  const liveA = coReach(t, q => t.acc[q]);
  const liveR = coReach(t, q => !t.acc[q]);
  if (!liveA[0]) return 'e';
  if (!liveR[0]) return 'u';
  if (!liveCycle(t, liveA)) return 'f';
  if (!liveCycle(t, liveR)) return 'c';
  return 'o';
}

/** The first `count` words a complete DFA accepts, in length-then-dictionary order, as letter indices. */
export function firstWords(t, { count = 3, maxLen = 10 } = {}) {
  const out = [];
  // Breadth-first over (state, word), shortest and earliest first; a state is
  // revisited at most `count` times per length, which is all the list needs.
  let layer = [{ q: 0, w: [] }];
  for (let len = 0; len <= maxLen && out.length < count; len++) {
    for (const x of layer) { if (t.acc[x.q]) { out.push(x.w); if (out.length >= count) break; } }
    if (out.length >= count) break;
    const next = [];
    const visits = new Map();
    for (const x of layer) for (let a = 0; a < t.k; a++) {
      const q = t.delta[x.q * t.k + a];
      const v = visits.get(q) || 0;
      if (v >= count) continue;
      visits.set(q, v + 1);
      next.push({ q, w: [...x.w, a] });
    }
    layer = next;
  }
  return out;
}

/** Does the complete DFA accept this word of letter indices? */
export function dfaAcceptsWord(t, word) {
  let q = 0;
  for (const a of word) q = t.delta[q * t.k + a];
  return !!t.acc[q];
}

/** The minimal DFA in the shape sketch.js's languageRows reads (that of analyze.js's minimalDfaOf). */
export function asSketchDfa(min, letters) {
  const acc = [];
  for (let q = 0; q < min.n; q++) if (min.acc[q]) acc.push(q);
  let dead = -1;
  for (let q = 0; q < min.n && dead < 0; q++) {
    if (min.acc[q]) continue;
    let loops = true;
    for (let a = 0; a < min.k; a++) if (min.delta[q * min.k + a] !== q) { loops = false; break; }
    if (loops) dead = q;
  }
  return { sigma: letters, n: min.n, start: 0, acc, delta: Array.from(min.delta), dead };
}

/**
 * Is this ω-automaton weak — does every cycle sit wholly inside F or wholly
 * outside it? The first strongly connected component that straddles F, as
 * state ids, or null when there is none. A state with no way back to itself is
 * on no cycle and cannot break weakness (the rule findWeakViolation in
 * js/machines/omega.js applies to the machine on the canvas; this one reads a
 * document, so a volume's page can say it without loading the volume).
 */
export function weakViolation(doc) {
  const ids = (doc.states || []).map(s => s.id);
  const succ = new Map(ids.map(id => [id, []]));
  for (const t of doc.transitions || []) if (succ.has(t.from) && succ.has(t.to)) succ.get(t.from).push(t.to);
  const acc = new Set(doc.accepts || []);
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  let next = 0;
  for (const root of ids) {
    if (index.has(root)) continue;
    index.set(root, next); low.set(root, next); next++;
    stack.push(root); onStack.add(root);
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      const out = succ.get(v);
      if (i < out.length) {
        frame[1]++;
        const w = out[i];
        if (!index.has(w)) {
          index.set(w, next); low.set(w, next); next++;
          stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const u = work[work.length - 1][0];
        low.set(u, Math.min(low.get(u), low.get(v)));
      }
      if (low.get(v) !== index.get(v)) continue;
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length === 1 && !succ.get(v).includes(v)) continue;
      const inF = comp.filter(q => acc.has(q)).length;
      if (inF && inF < comp.length) return comp;
    }
  }
  return null;
}
