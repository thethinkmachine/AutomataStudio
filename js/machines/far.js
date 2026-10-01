// ══════════════════════════════════════════════════════════════════
//  FINITE AUTOMATA REDUCTION — bbchallenge's direct decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is Justin Blanchard's decider in
// bbchallenge-deciders/decider-finite-automata-reduction (Rust,
// src/provers/direct.rs and src/provers/dfa_iterator.rs) and bbchallenge's
// Python reproduction of it (decider_FAR_direct.py, solver_FAR_NFA_direct.py,
// verifier_FAR_NFA_DFA.py). This is a port of the `direct` prover: the same
// DFAs in the same order, the same pruning, the same NFA, so it finds the
// same proof the reference finds — the same scan direction, DFA, NFA and
// accepted set — and decides exactly the machines the reference does at the
// same depth. The reference is written for 5 states and 2 symbols; this one
// takes n states and k symbols, and is the reference when n = 5, k = 2.
//
// What a proof is (co-CTL). A finite-state recogniser reads a configuration
// left to right: a DFA over the tape left of the head, ignoring leading
// blanks (δ(0, 0) = 0), then — on reaching the head — the NFA state (q, f)
// for the DFA's state q and the machine's state f, and the NFA reads the rest
// of the tape, from the head's cell, and accepts if it can end in an accepted
// state after trailing blanks. It is built so that:
//
//   every halting configuration is recognised (a halt rule (f, r) sends every
//   (q, f) reading r to a steady state that stays accepted), and
//   a configuration is recognised whenever its successor is (one closure
//   condition per transition, below),
//
// so the recognised set contains every configuration that ever leads to a
// halt. If the blank start (0, A) is not recognised, the machine never halts.
//
// The closure conditions, for a transition (f, r) ↦ (w, d, t):
//   d along the scan     δ'((q, f), r) ∋ (δ(q, w), t)               for all q
//   d against the scan   δ'((δ(q, b), f), r) ⊇ δ'(δ'((q, t), b), w)  for all q, b
//   halt                 δ'((q, f), r) ∋ ⊥                          for all q
//
// The direct search: pick a scan direction, then a DFA, built one transition
// at a time in breadth-first canonical order; for each prefix compute the
// least NFA the known transitions force (the conditions above to a fixed
// point, and the accepted set as the least set containing ⊥ that is closed
// under reading a blank). Adding DFA transitions only adds to the NFA, so a
// prefix whose NFA already accepts the start can be abandoned with every DFA
// that extends it. A complete DFA whose NFA rejects the start is the proof.
// The NFA has n·D + 1 states: (q, f) is n·q + f, and ⊥ is the last.
//
// Import-free and DOM-free: it reads the classifier's table (tm-behaviour.js).

/** DFA sizes the reference's direct prover searched for BB(5): 1 to 7. */
export const FAR_DEPTH = 7;

/**
 * The machine as the reference's rules, in its order (state, then symbol
 * read): `halts` [[f, r]] and `moves` [{ f, r, w, d, t }], with f and t
 * numbered over the working (non-halting) states in table order. A
 * transition into a halt state is a halt rule, as `1RZ` is `---` there.
 * Returns { why } for a table outside the model the decider is about.
 */
export function farRules(p) {
  if (!p.twoWay) return { why: 'it is about a two-way tape' };
  if (p.input.some(c => c !== 0)) return { why: 'it is about a blank starting tape' };
  if (p.accept[p.start]) return { why: 'the start state halts at once' };
  const work = new Int32Array(p.Q).fill(-1);
  let n = 0;
  for (let q = 0; q < p.Q; q++) if (!p.accept[q]) work[q] = n++;
  const halts = [], moves = [];
  for (let q = 0; q < p.Q; q++) {
    if (p.accept[q]) continue;
    for (let r = 0; r < p.K; r++) {
      const e = q * p.K + r, to = p.next[e];
      if (to < 0 || p.accept[to]) { halts.push([work[q], r]); continue; }
      if (p.move[e] === 0) return { why: 'it is about L and R moves only' };
      moves.push({ f: work[q], r, w: p.write[e], d: p.move[e], t: work[to] });
    }
  }
  return { n, K: p.K, start: work[p.start], halts, moves };
}

// ── DFAs in breadth-first canonical order ─────────────────────────
// dfa_iterator.rs's DFAPrefixIterator, for k symbols: the table is filled at
// flat index K·q + b, entry 0 is fixed at 0 (leading blanks are ignored), and
// a state's first appearance comes before its own row, which is forced when
// leaving it out would strand it.
class DfaPrefixIterator {
  constructor(D, K) {
    this.D = D;
    this.K = K;
    this.t = new Int32Array(D * K);
    this.qb = 0;
    this.tmax = new Int32Array(D * K + 1);
    this.skip = false;
  }

  /** The flat index just filled in, or −1 when every DFA has been given. */
  next() {
    const { D, K, t, tmax } = this;
    const m = D - 1;
    if (this.qb < D * K && !this.skip) {
      const qb = this.qb;
      t[qb] = tmax[qb] < m && qb === K * tmax[qb] + K - 1 ? tmax[qb] + 1 : 0;
      this.qb++;
      tmax[this.qb] = Math.max(tmax[qb], t[qb]);
      return qb;
    }
    this.skip = false;
    while (this.qb > 1) {
      const qb = --this.qb;
      if (t[qb] <= tmax[qb] && t[qb] < m) {
        t[qb]++;
        this.qb++;
        tmax[this.qb] = Math.max(tmax[qb], t[qb]);
        return qb;
      }
    }
    return -1;
  }
}

// ── the search ────────────────────────────────────────────────────

/**
 * One scan direction and one DFA size: direct.rs's `prove_side`. `side` is
 * 'R' for a left-to-right scan and 'L' for the mirror image. Returns the
 * proof, or null. `budget.work` is decremented per NFA saturation, and the
 * search gives up (returning 'budget') when it runs out.
 */
function proveSide(rules, D, side, budget) {
  const { n, K } = rules;
  const aDir = side === 'R' ? 1 : -1;
  const N = n * D + 1, W = (N + 31) >>> 5, halt = n * D;
  const rowWords = W, matWords = N * W, nfaWords = K * matWords;
  const start = rules.start; // nfa_start(0, A)
  const it = new DfaPrefixIterator(D, K);
  const dfa = it.t;
  const T = Array.from({ length: K * D }, () => new Uint32Array(nfaWords));
  const A = Array.from({ length: K * D }, () => new Uint32Array(W));


  const has = (vec, off, i) => (vec[off + (i >>> 5)] >>> (i & 31)) & 1;
  const at = (b, i) => b * matWords + i * rowWords;   // row i of T_b

  const init = (t, acc) => {
    t.fill(0); acc.fill(0);
    acc[halt >>> 5] |= 1 << (halt & 31);
    for (let b = 0; b < K; b++) t[at(b, halt) + (halt >>> 5)] |= 1 << (halt & 31);
    for (const [f, r] of rules.halts) {
      for (let q = 0; q < D; q++) t[at(r, n * q + f) + (halt >>> 5)] |= 1 << (halt & 31);
    }
  };

  const along = rules.moves.filter(m => m.d === aDir);
  // The rules against the scan, flat: f, r, w, t per rule.
  const against = Int32Array.from(rules.moves.filter(m => m.d !== aDir).flatMap(m => [m.f, m.r, m.w, m.t]));

  const saturate = (t, acc, qNew, bNew) => {
    for (const { f, r, w, t: to } of along) {
      if (w !== bNew) continue;
      const j = n * dfa[K * qNew + w] + to;
      t[at(r, n * qNew + f) + (j >>> 5)] |= 1 << (j & 31);
    }
    const last = K * qNew + bNew;
    // T_r[(δ(q, b), f)] |= step_vec(step((q, t), b), w): the rows of T_w at
    // every state T_b reaches from (q, t). Written straight into the row it
    // grows; reading a row while it grows only finds the new bits a pass
    // later, and the loop runs until a pass adds nothing, so the fixed point
    // is the same least one.
    for (let grew = true; grew;) {
      grew = false;
      for (let k = 0; k < against.length; k += 4) {
        const f = against[k], r = against[k + 1], w = against[k + 2], to = against[k + 3];
        for (let qb = 0; qb <= last; qb++) {
          const q = (qb / K) | 0, b = qb - q * K;
          const src = at(b, n * q + to), dst = at(r, n * dfa[qb] + f);
          if (W === 1) {
            let bits = t[src], v = t[dst];
            const was = v;
            while (bits) {
              const low = bits & -bits;
              bits ^= low;
              v |= t[w * matWords + (31 - Math.clz32(low))];
            }
            if (v !== was) { t[dst] = v; grew = true; }
            continue;
          }
          for (let x = 0; x < W; x++) {
            let bits = t[src + x];
            while (bits) {
              const low = bits & -bits;
              bits ^= low;
              const row = at(w, (x << 5) + (31 - Math.clz32(low)));
              for (let y = 0; y < W; y++) {
                const v = t[dst + y] | t[row + y];
                if (v !== t[dst + y]) { t[dst + y] = v; grew = true; }
              }
            }
          }
        }
      }
    }
    // accepted |= T_0 · accepted, to a fixed point.
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < N; i++) {
        if (has(acc, 0, i)) continue;
        const row = at(0, i);
        for (let y = 0; y < W; y++) {
          if (t[row + y] & acc[y]) { acc[i >>> 5] |= 1 << (i & 31); grew = true; break; }
        }
      }
    }
  };

  for (;;) {
    const ply = it.next();
    if (ply < 0) return null;
    if (--budget.work < 0) return 'budget';
    const qNew = (ply / K) | 0, bNew = ply - qNew * K;
    if (ply === 0) init(T[0], A[0]);
    else { T[ply].set(T[ply - 1]); A[ply].set(A[ply - 1]); }
    saturate(T[ply], A[ply], qNew, bNew);
    if (has(A[ply], 0, start)) { it.skip = true; continue; }
    if (ply === K * D - 1) {
      const t = T[ply], acc = A[ply];
      const rows = b => Array.from({ length: N }, (_, i) => {
        const out = [];
        for (let j = 0; j < N; j++) if (has(t, at(b, i), j)) out.push(j);
        return out;
      });
      const accepted = [];
      for (let i = 0; i < N; i++) if (has(acc, 0, i)) accepted.push(i);
      return {
        side, depth: D,
        dfa: Array.from({ length: D }, (_, q) => Array.from(dfa.subarray(q * K, q * K + K))),
        nfa: Array.from({ length: K }, (_, b) => rows(b)),
        accepted
      };
    }
  }
}

/**
 * The decider: the reference's direct prover at DFA sizes 1 … `depth`, each
 * size scanning left to right and then right to left, stopping at the first
 * proof (decider_FAR_direct.py's order).
 *
 * Returns { ok: true, side, depth, dfa, nfa, accepted, states, start } — `nfa`
 * is one list of successor lists per symbol, `states` the NFA's size and
 * `start` its index for (0, A) — or { ok: false, reason }: 'none' (no DFA up
 * to `depth` works), 'budget' (`work` saturations were not enough; the
 * reference has no such limit, so its answer is not known), or 'model' with
 * `why`.
 */
export function finiteAutomataReduction(p, { depth = FAR_DEPTH, work = Infinity } = {}) {
  const rules = farRules(p);
  if (rules.why) return { ok: false, reason: 'model', why: rules.why };
  const budget = { work };
  for (let D = 1; D <= depth; D++) {
    for (const side of ['R', 'L']) {
      const proof = proveSide(rules, D, side, budget);
      if (proof === 'budget') return { ok: false, reason: 'budget', depth: D };
      if (proof) return { ok: true, ...proof, states: rules.n * D + 1, start: rules.start, n: rules.n };
    }
  }
  return { ok: false, reason: 'none', depth };
}
