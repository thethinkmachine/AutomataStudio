// ══════════════════════════════════════════════════════════════════
//  TURING MACHINES AS TABLES, AND WHAT CAN BE PROVED ABOUT THEM
// ══════════════════════════════════════════════════════════════════
// The halting classifier in js/machines/tm-behaviour.js works on a compiled
// table — states 0..Q-1, symbols 0..K-1 with 0 the blank, δ as flat arrays.
// This file builds that table straight from the standard notation (no App,
// so a search can make millions of them), and adds three things the app does
// not have:
//
//   bound   a machine in the busy beaver model that has run past S(n, k)
//           steps without halting never halts. Sound only in that model —
//           two-way tape, blank start, L/R moves — and only for the (n, k)
//           whose value is proved, so both are checked before it is used.
//   cps     n-gram Closed Position Set: an over-approximation of every
//           configuration the machine can reach, as the set of local windows
//           around the head plus the sets of n-grams either side of it. If the
//           set is closed under δ and contains no halting window, no reachable
//           configuration halts. Complete in the sense that matters for a
//           proof — every real successor is represented — so it can only fail
//           to prove, never prove wrongly. It settles most counters and
//           bouncers, the two shapes the app's own methods leave unknown.
//   growth  how fast the used tape grows with time — a classification, not a
//           proof: logarithmic reads as a counter, √t as a bouncer, t as a
//           translated cycler.
//
// Each proof comes with the evidence an independent checker needs
// (cli/tm/check.mjs), so a verdict need not be taken on trust.

import { classifyBehaviourNow } from '../../js/machines/tm-behaviour.js';
import { HALTING_SEGMENT_DISTANCE } from '../../js/machines/halting-segment.js';
import { induction } from './induction.mjs';

// ── The table ─────────────────────────────────────────────────────

const LETTER = i => String.fromCharCode(65 + i);

/**
 * Standard notation → the classifier's table. The halt state (any letter
 * past the last state, Z by convention) becomes state Q-1, accepting and with
 * no moves; `---` is next = −1. Throws on anything malformed.
 */
export function tableFromStandard(code) {
  const src = String(code).trim().toUpperCase();
  const segs = src.split('_');
  const n = segs.length;
  const k = segs[0].length / 3;
  if (!Number.isInteger(k) || k < 2 || k > 10 || segs.some(s => s.length !== k * 3)) {
    throw new Error(`"${code}" is not a machine in the standard notation.`);
  }
  const Q = n + 1, K = k;
  const next = new Int32Array(Q * K).fill(-1);
  const write = new Int32Array(Q * K);
  const move = new Int8Array(Q * K);
  const accept = new Uint8Array(Q);
  accept[n] = 1;
  segs.forEach((seg, q) => {
    for (let s = 0; s < k; s++) {
      const tr = seg.slice(s * 3, s * 3 + 3);
      if (tr === '---') continue;
      const m = /^([0-9])([LR])([A-Z])$/.exec(tr);
      if (!m) throw new Error(`"${tr}" in state ${LETTER(q)} is not a transition.`);
      const w = Number(m[1]);
      if (w >= k) throw new Error(`"${tr}" writes ${w}, past the ${k} symbols.`);
      const to = m[3].charCodeAt(0) - 65;
      next[q * K + s] = to < n ? to : n;
      write[q * K + s] = w;
      move[q * K + s] = m[2] === 'R' ? 1 : -1;
    }
  });
  return {
    ok: true, Q, K, next, write, move, accept, start: 0, twoWay: true, input: [],
    stateNames: [...Array(n).keys()].map(LETTER).concat(['halt']),
    symbols: [...Array(K).keys()].map(String)
  };
}

/**
 * The table → standard notation, or null when it cannot be written that way
 * (a stay move, more than 26 working states or 10 symbols, a start that is not
 * a working state). Working states are renumbered with the start first.
 */
export function standardFromTable(p) {
  if (p.K > 10) return null;
  const working = [];
  for (let q = 0; q < p.Q; q++) if (!p.accept[q]) working.push(q);
  if (working.length > 26 || p.accept[p.start]) return null;
  const order = [p.start, ...working.filter(q => q !== p.start)];
  const letter = new Map(order.map((q, i) => [q, LETTER(i)]));
  const segs = [];
  for (const q of order) {
    let seg = '';
    for (let s = 0; s < p.K; s++) {
      const e = q * p.K + s;
      const to = p.next[e];
      if (to < 0) { seg += '---'; continue; }
      if (p.move[e] === 0) return null;
      seg += `${p.write[e]}${p.move[e] > 0 ? 'R' : 'L'}${p.accept[to] ? 'Z' : letter.get(to)}`;
    }
    segs.push(seg);
  }
  return segs.join('_');
}

/** Working states: the ones that are not halt (accepting) states. */
export function workingStates(p) {
  let n = 0;
  for (let q = 0; q < p.Q; q++) if (!p.accept[q]) n++;
  return n;
}

// ── A plain, fast run ─────────────────────────────────────────────

/**
 * Run from the table's input for at most `max` steps. The same semantics as
 * the classifier's Runner — an accepting state halts on arrival, a missing
 * move halts, a one-way tape's wall stops a left move — with none of its
 * hashing, so it runs at typed-array speed. `probe(t, lo, hi)` is called at
 * each step count listed in `at`.
 */
export function run(p, max, { at = [], probe = null } = {}) {
  let buf = new Uint8Array(1024);
  let base = -512;
  let head = 0, state = p.start, t = 0, lo = 0, hi = 0;
  p.input.forEach((c, x) => { buf[x - base] = c; });
  if (p.input.length) hi = p.input.length - 1;
  const { K, next, write, move, accept, twoWay } = p;
  let ai = 0;
  const marks = [...at].sort((a, b) => a - b);
  let halted = null;
  while (t < max) {
    if (ai < marks.length && t >= marks[ai]) { probe?.(t, lo, hi); ai++; continue; }
    if (accept[state]) { halted = 'accept'; break; }
    let i = head - base;
    const c = buf[i];
    const e = state * K + c;
    const to = next[e];
    if (to < 0) { halted = 'none'; break; }
    buf[i] = write[e];
    let h = head + move[e];
    if (!twoWay && h < 0) h = 0;
    head = h;
    i = head - base;
    if (i < 0 || i >= buf.length) {
      const grown = new Uint8Array(buf.length * 2);
      const shift = i < 0 ? buf.length : 0;
      grown.set(buf, shift);
      base -= shift;
      buf = grown;
    }
    if (head < lo) lo = head; else if (head > hi) hi = head;
    state = to;
    t++;
  }
  while (ai < marks.length && t >= marks[ai]) { probe?.(t, lo, hi); ai++; }
  let ones = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i]) ones++;
  return { halted, steps: t, state, head, lo, hi, cells: hi - lo + 1, ones };
}

// ── The busy beaver bound ─────────────────────────────────────────

/**
 * S(n, k): the most steps an n-state, k-symbol machine can take from a blank
 * two-way tape and still halt — every value here is proved (BB(5) in 2024,
 * formally verified). Keyed "n,k".
 */
export const BB_STEPS = {
  '1,2': 1, '2,2': 6, '3,2': 21, '4,2': 107, '5,2': 47176870,
  '2,3': 38, '2,4': 3932964
};

/** The S(n, k) this machine is bounded by, or null when the model or the value does not apply. */
export function boundFor(p) {
  if (!p.twoWay || p.input.some(c => c !== 0)) return null;
  for (let e = 0; e < p.next.length; e++) if (p.next[e] >= 0 && p.move[e] === 0) return null;
  const n = workingStates(p);
  // A machine that uses fewer symbols is still a k-symbol machine for any
  // larger k, and fewer states still an n-state one; the smallest proved
  // (n', k') ≥ (n, k) bounds it.
  let best = null;
  for (const [key, S] of Object.entries(BB_STEPS)) {
    const [bn, bk] = key.split(',').map(Number);
    if (bn >= n && bk >= p.K && (!best || S < best.S)) best = { n: bn, k: bk, S };
  }
  return best;
}

// ── n-gram Closed Position Set ────────────────────────────────────

/**
 * Try to prove non-halting with windows of `n` cells either side of the head.
 * Returns `{ n, left, right, contexts }` (the certificate: the two gram sets,
 * as arrays of symbol strings) when the closure contains no halting window,
 * null when it does or the search outgrew `maxContexts`.
 */
export function cpsProve(p, n, { maxContexts = 200000 } = {}) {
  if (!p.twoWay || p.input.some(c => c !== 0)) return null;
  const { K, next, write, move, accept } = p;
  const Kn = K ** n, Kn1 = K ** (n - 1);
  if (Kn > 1 << 22) return null;
  // Gram sets, plus indexes by the n-1 symbols a lookup matches on.
  const left = new Set([0]), right = new Set([0]);
  const leftBySuffix = new Map([[0, new Set([0])]]);   // last n-1 → first symbols
  const rightByPrefix = new Map([[0, new Set([0])]]);  // first n-1 → last symbols
  const addLeft = g => {
    if (left.has(g)) return false;
    left.add(g);
    const suf = g % Kn1, first = Math.floor(g / Kn1);
    if (!leftBySuffix.has(suf)) leftBySuffix.set(suf, new Set());
    leftBySuffix.get(suf).add(first);
    return true;
  };
  const addRight = g => {
    if (right.has(g)) return false;
    right.add(g);
    const pre = Math.floor(g / K), last = g % K;
    if (!rightByPrefix.has(pre)) rightByPrefix.set(pre, new Set());
    rightByPrefix.get(pre).add(last);
    return true;
  };
  const key = (q, L, s, R) => ((q * Kn + L) * K + s) * Kn + R;
  const seen = new Set();
  const ctxs = [];
  const push = (q, L, s, R) => {
    const k = key(q, L, s, R);
    if (seen.has(k)) return;
    seen.add(k);
    ctxs.push([q, L, s, R]);
  };
  push(p.start, 0, 0, 0);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < ctxs.length; i++) {
      if (ctxs.length > maxContexts) return null;
      const [q, L, s, R] = ctxs[i];
      if (accept[q]) return null;
      const e = q * K + s;
      const to = next[e];
      if (to < 0) return null;
      if (accept[to]) return null;
      const w = write[e];
      const before = ctxs.length;
      if (move[e] > 0) {
        // The written cell joins the left half-tape; the right's first cell
        // comes under the head and the right window pulls one cell in.
        const nL = (L * K) % Kn + w;
        if (addLeft(nL)) changed = true;
        const ns = Math.floor(R / Kn1);
        const tail = R % Kn1;
        for (const x of rightByPrefix.get(tail) || []) push(to, nL, ns, tail * K + x);
      } else if (move[e] < 0) {
        const nR = w * Kn1 + Math.floor(R / K);
        if (addRight(nR)) changed = true;
        const ns = L % K;
        const pre = Math.floor(L / K);
        for (const y of leftBySuffix.get(pre) || []) push(to, y * Kn1 + pre, ns, nR);
      } else {
        push(to, L, w, R);
      }
      if (ctxs.length !== before) changed = true;
    }
  }
  const str = g => g.toString(K).padStart(n, '0');
  return { n, left: [...left].sort((a, b) => a - b).map(str), right: [...right].sort((a, b) => a - b).map(str), contexts: ctxs.length };
}

// ── Growth ────────────────────────────────────────────────────────

/**
 * How the used tape grows: cells at 10^a … 10^b steps, and the log–log slope
 * over the last decade. A reading, not a proof.
 */
export function growthOf(p, { from = 5, to = 7 } = {}) {
  const at = [];
  for (let e = from; e <= to; e++) at.push(10 ** e);
  const samples = [];
  const r = run(p, at[at.length - 1], { at, probe: (t, lo, hi) => samples.push({ steps: t, cells: hi - lo + 1 }) });
  if (r.halted) return { halted: true, steps: r.steps, samples };
  const a = samples[samples.length - 2], b = samples[samples.length - 1];
  const slope = Math.log(b.cells / a.cells) / Math.log(b.steps / a.steps);
  let shape;
  if (b.cells === a.cells) shape = 'bounded';
  else if (slope < 0.2) shape = 'logarithmic';
  else if (slope >= 0.35 && slope <= 0.65) shape = 'square-root';
  else if (slope >= 0.85 && slope <= 1.15) shape = 'linear';
  else shape = `t^${slope.toFixed(2)}`;
  const say = {
    bounded: 'the tape stopped growing (a long cycle?)',
    logarithmic: 'counter-like: the tape grows logarithmically',
    'square-root': 'bouncer-like: the tape grows as √t',
    linear: 'translated-cycler-like: the tape grows linearly'
  };
  return { halted: false, slope: Number(slope.toFixed(3)), shape, say: say[shape] || `the tape grows as ${shape}`, samples };
}

// ── The pipeline ──────────────────────────────────────────────────

/**
 * Everything, cheapest first: the app's classifier (simulation, cycler,
 * translated cycler, backward reasoning, and — once its budget is spent —
 * bbchallenge's halting segment and finite automata reduction), then CPS for
 * n = 1…cpsMax, then inductive rules over a run-length tape (for at most
 * `inductionMs`), then the busy beaver bound. `{ verdict, method, …evidence }`.
 *
 * `segment` defaults to the reference's own setting, segments up to
 * 2·5 + 1 cells with no node limit. `far` is the largest DFA the direct search
 * tries, with no work limit: the reference searched up to FAR_DEPTH (7) for
 * BB(5), but exhaustively that costs minutes per machine, and each size costs
 * about thirty times the one below, so the default stops at 6 (about a second
 * at worst) and `far: FAR_DEPTH` is the reference's full search.
 */
export const FAR_DEFAULT = 6;

export function decide(p, { budget = 1e6, segment = HALTING_SEGMENT_DISTANCE, far = FAR_DEFAULT, cpsMax = 10, inductionMs = 2000, bound = true, growth = false } = {}) {
  const v = classifyBehaviourNow(p, { budget, segment, segmentNodes: Infinity, far, farWork: Infinity });
  let out = { verdict: v.verdict, method: v.method || null };
  for (const k of ['steps', 'transitions', 'ones', 'cells', 'period', 'from', 'at', 'shift', 'window', 'direction', 'longest', 'how', 'state', 'read', 'before', 'after',
    'size', 'distance', 'nodes', 'side', 'depth', 'dfa', 'nfa', 'accepted', 'states', 'start', 'n']) {
    if (v[k] !== undefined && v[k] !== null) out[k] = v[k];
  }
  if (out.verdict === 'unknown' && cpsMax > 0) {
    for (let n = 1; n <= cpsMax; n++) {
      const cert = cpsProve(p, n, { maxContexts: 1e6 });
      if (cert) { out = { verdict: 'never', method: 'cps', n, left: cert.left, right: cert.right, contexts: cert.contexts }; break; }
    }
  }
  if (out.verdict === 'unknown' && inductionMs > 0) {
    const r = induction(p, { ms: inductionMs });
    if (r) out = { verdict: 'never', method: r.method, B: r.B, rules: r.rules, ruleSteps: r.steps, grows: r.grows, start: r.start, from: r.from, period: r.period };
  }
  if (out.verdict === 'unknown' && bound) {
    const b = boundFor(p);
    if (b) {
      const r = run(p, b.S + 1);
      // The classifier's step convention: a missing transition's read counts.
      if (r.halted) out = { verdict: 'halts', method: 'simulation', steps: r.steps + (r.halted === 'none' ? 1 : 0), transitions: r.steps, ones: r.ones, cells: r.cells, how: r.halted };
      else out = { verdict: 'never', method: 'bound', n: b.n, k: b.k, S: b.S, steps: r.steps };
    }
  }
  if (growth && out.verdict === 'unknown') out.growth = growthOf(p);
  return out;
}

export const METHOD_NAMES = {
  simulation: 'simulation', cycler: 'cycler', translated: 'translated cycler',
  backward: 'backward reasoning', segment: 'halting segment', far: 'finite automata reduction',
  cps: 'closed position set', bound: 'busy beaver bound',
  induction: 'inductive rule', 'cycler-macro': 'cycler (macro)', 'block-loop': 'loops inside a block'
};
