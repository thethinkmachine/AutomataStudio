// ══════════════════════════════════════════════════════════════════
//  LEARNING A DFA
// ══════════════════════════════════════════════════════════════════
// Two classic ways to recover an automaton from outside it.
//
// RPNI (Oncina & García, 1992) is passive: given words labelled accept and
// reject, it returns a DFA consistent with every label. It starts from the
// prefix tree of the sample — one state per prefix, labelled where a word
// ends — and merges states in breadth-first order, keeping a merge only if
// folding it (merging successors to stay deterministic) never puts an accept
// and a reject label in one state. With a characteristic sample it finds the
// minimal DFA exactly; with less it still never contradicts the sample.
//
// L* (Angluin, 1987) is active: it asks a teacher membership questions ("is w
// in the language?") and equivalence questions ("is this DFA right? if not,
// where is it wrong?"), and returns the minimal DFA. This uses Maler and
// Pnueli's counterexample handling — every suffix of a counterexample becomes
// a column — which keeps the table consistent by construction. When the
// teacher is a program, equivalence is approximated by testing, and the
// result says so.

// ── RPNI ──────────────────────────────────────────────────────────

/**
 * `samples` is `[{ word: [symbols], accept: bool }]`. Returns
 * `{ sigma, states, start, delta: Map<state, Map<sym, state>>, accept: Set, reject: Set }`
 * in the quotient's own numbering.
 */
export function rpni(samples) {
  const sigma = [...new Set(samples.flatMap(s => s.word))].sort();
  // The augmented prefix tree: labels on both kinds of word.
  const child = [new Map()];
  const label = [0]; // 1 accept, -1 reject, 0 unknown
  const node = w => {
    let q = 0;
    for (const a of w) {
      let n = child[q].get(a);
      if (n === undefined) { n = child.length; child.push(new Map()); label.push(0); child[q].set(a, n); }
      q = n;
    }
    return q;
  };
  for (const s of samples) {
    const q = node(s.word);
    const want = s.accept ? 1 : -1;
    if (label[q] && label[q] !== want) throw new Error(`The sample labels ${s.word.join('') || 'ε'} both accept and reject.`);
    label[q] = want;
  }
  const N = child.length;
  // Breadth-first order of the tree = the order RPNI considers states in.
  const order = [0];
  for (let i = 0; i < order.length; i++) for (const a of sigma) { const n = child[order[i]].get(a); if (n !== undefined) order.push(n); }

  const rank = new Array(N);
  order.forEach((q, i) => { rank[q] = i; });

  // A merge is tried on a copy of the partition and kept only if folding it
  // (merging successors until the quotient is deterministic) never puts an
  // accept and a reject label in one block. A block is named by its member
  // earliest in breadth-first order, so a red state is never merged away.
  let rep = Array.from({ length: N }, (_, i) => i);
  const find = (r, x) => { while (r[x] !== x) { r[x] = r[r[x]]; x = r[x]; } return x; };
  function tryMerge(base, a, b) {
    const r = [...base];
    const lab = new Map();
    for (let q = 0; q < N; q++) if (label[q]) lab.set(find(r, q), label[q]);
    const unite = (x, y) => {
      x = find(r, x); y = find(r, y);
      if (x === y) return true;
      const lx = lab.get(x) || 0, ly = lab.get(y) || 0;
      if (lx && ly && lx !== ly) return false;
      const [keep, drop] = rank[x] < rank[y] ? [x, y] : [y, x];
      r[drop] = keep;
      if (lx || ly) lab.set(keep, lx || ly);
      return true;
    };
    if (!unite(a, b)) return null;
    for (let changed = true; changed;) {
      changed = false;
      const out = new Map();
      for (let q = 0; q < N; q++) {
        const k = find(r, q);
        let m = out.get(k);
        if (!m) { m = new Map(); out.set(k, m); }
        for (const [sym, n] of child[q]) {
          const t = find(r, n);
          const prev = m.get(sym);
          if (prev === undefined) m.set(sym, t);
          else if (find(r, prev) !== t) {
            if (!unite(prev, t)) return null;
            changed = true;
            m.set(sym, find(r, t));
          }
        }
      }
    }
    return r;
  }

  const red = new Set([0]);
  for (const q of order) {
    if (find(rep, q) !== q || red.has(q)) continue;
    // Only blue states: a tree child of a red block.
    let merged = false;
    for (const rr of [...red].sort((x, y) => rank[x] - rank[y])) {
      const r = tryMerge(rep, rr, q);
      if (r) { rep = r; merged = true; break; }
    }
    if (!merged) red.add(q);
  }

  // The quotient.
  const blocks = [...new Set(Array.from({ length: N }, (_, q) => find(rep, q)))].sort((x, y) => rank[x] - rank[y]);
  const index = new Map(blocks.map((b, i) => [b, i]));
  const delta = new Map(blocks.map((_, i) => [i, new Map()]));
  const accept = new Set(), reject = new Set();
  for (let q = 0; q < N; q++) {
    const b = index.get(find(rep, q));
    if (label[q] === 1) accept.add(b);
    if (label[q] === -1) reject.add(b);
    for (const [sym, n] of child[q]) delta.get(b).set(sym, index.get(find(rep, n)));
  }
  return { sigma, states: blocks.length, start: index.get(find(rep, 0)), delta, accept, reject };
}

// ── L* ────────────────────────────────────────────────────────────

/**
 * `member(words)` answers a batch of membership questions (booleans, in
 * order); `equivalent(hyp)` returns null when the hypothesis is right or a
 * counterexample word otherwise. Returns `{ dfa, rounds, queries }` with the
 * DFA as `{ sigma, states, start, delta: number[][], accept: Set }`.
 */
export async function lstar(sigma, member, equivalent, { maxStates = 500 } = {}) {
  const key = w => w.join('\u0001');
  const cache = new Map();
  let queries = 0;
  const ask = async words => {
    const need = [...new Map(words.filter(w => !cache.has(key(w))).map(w => [key(w), w])).values()];
    if (need.length) {
      queries += need.length;
      const answers = await member(need);
      need.forEach((w, i) => cache.set(key(w), !!answers[i]));
    }
  };
  const S = [[]];
  const E = [[]];
  const rowOf = s => E.map(e => (cache.get(key([...s, ...e])) ? '1' : '0')).join('');
  const fill = async () => {
    const words = [];
    for (const s of [...S, ...S.flatMap(s => sigma.map(a => [...s, a]))]) for (const e of E) words.push([...s, ...e]);
    await ask(words);
  };
  let rounds = 0;
  for (;;) {
    await fill();
    // Close: every one-symbol extension's row must be some row of S.
    for (let closed = false; !closed;) {
      closed = true;
      const rows = new Set(S.map(rowOf));
      for (const s of [...S]) {
        for (const a of sigma) {
          const ext = [...s, a];
          if (!rows.has(rowOf(ext))) { S.push(ext); rows.add(rowOf(ext)); closed = false; await fill(); }
        }
      }
      if (S.length > maxStates * 4) throw new Error(`L* passed ${maxStates} states; the target may not be regular.`);
    }
    // The hypothesis: one state per distinct row of S.
    const rowsList = [];
    const stateOfRow = new Map();
    for (const s of S) {
      const r = rowOf(s);
      if (!stateOfRow.has(r)) { stateOfRow.set(r, rowsList.length); rowsList.push(s); }
    }
    const delta = rowsList.map(s => sigma.map(a => stateOfRow.get(rowOf([...s, a]))));
    const accept = new Set(rowsList.map((s, i) => (cache.get(key(s)) ? i : -1)).filter(i => i >= 0));
    const hyp = { sigma, states: rowsList.length, start: stateOfRow.get(rowOf([])), delta, accept };
    rounds++;
    const cex = await equivalent(hyp);
    if (!cex) return { dfa: hyp, rounds, queries };
    // Maler–Pnueli: every suffix of the counterexample becomes a column.
    for (let i = 0; i <= cex.length; i++) {
      const suf = cex.slice(i);
      if (!E.some(e => key(e) === key(suf))) E.push(suf);
    }
    if (rounds > maxStates) throw new Error('L* is not converging; the teacher may be inconsistent.');
  }
}

/** Run a hypothesis DFA on a word. */
export function accepts(dfa, word) {
  let q = dfa.start;
  for (const a of word) {
    const i = dfa.sigma.indexOf(a);
    if (i < 0) return false;
    q = dfa.delta[q][i];
    if (q === undefined) return false;
  }
  return dfa.accept.has(q);
}
