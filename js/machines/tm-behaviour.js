// ══════════════════════════════════════════════════════════════════
//  WHAT A TURING MACHINE DOES — halts, never halts, or unknown
// ══════════════════════════════════════════════════════════════════
// There are only ever three answers, and a verdict carries one of them in
// `verdict`: 'halts', 'never', or 'unknown'. What varies is *why* — which
// proof method found it — and that is `method`, a key of METHODS. The two are
// kept apart so that a new method is a new reason, not a new answer: the card
// colours and the header chip read `verdict` and never need to learn a method.
//
//   simulation         halts: it stops. Reported with its step count and what
//                      it left on the tape.
//   cycler             never: it returns to a configuration it has been in —
//                      the same state, head and tape — so it repeats forever.
//   translated         never: it returns to the same state with the same
//                      stretch of tape behind its head, but further along a
//                      tape it is still pushing into, so it repeats, shifted.
//   backward           never: working back from every way it could stop, no
//                      configuration is more than L steps from a halt, and it
//                      has run past L steps.
//
// Anything else after the step budget is **unknown**, and is reported as that:
// not "runs forever". Whether a machine halts is undecidable in general, and
// some small machines (the "cryptids") halt exactly when an open Collatz-style
// problem says they do, so no classifier has an answer for every machine.
// There is deliberately no list of named machines here: every verdict this
// module gives is one it proved.
//
// When more than one method applies, the one reported is the one that
// finished first, in steps of the run: backward reasoning's proof holds from
// step L + 1, a cycler's from μ + λ, a translated cycler's from its second
// record. A machine with no way to halt at all has L = −1 and is settled
// before it takes a step.
//
// ── the cycler ────────────────────────────────────────────────────
// Brent's algorithm: a copy of the configuration is kept at steps 1, 2, 4, 8,
// …, and every step is compared with the copy; once the copy lies inside the
// cycle, the next visit to it gives the period λ. Comparing is cheap because
// the tape carries a Zobrist hash (an XOR of one random word per non-blank
// cell), updated in O(1) per write; a hash match is only ever a candidate, and
// is confirmed cell by cell before it is believed. The step the cycle starts
// at, μ, is then found by running two copies λ apart until they meet.
//
// ── the translated cycler ─────────────────────────────────────────
// A *record* is a step on which the head reaches a cell it has never been on
// — further right than ever (a right record) or, on a two-way tape, further
// left. At a record every cell past the head is blank, because nothing has
// been there. Take two right records, at steps t₁ < t₂, in the same state q,
// with the head at h₁ and h₂. Let m be the leftmost cell the head visited
// between them, and w = h₁ − m. If the w + 1 cells [h₁ − w, h₁] at t₁ read the
// same as the cells [h₂ − w, h₂] at t₂, the machine never halts:
//
//   Between t₁ and t₂ it read only cells in [m, h₂]: the window, and fresh
//   blank tape to its right. At t₂ it is in the same state before the same
//   window, with fresh blank tape to its right again — so it does the same
//   thing, shifted by h₂ − h₁, and ends at t₂ + (t₂ − t₁) in the same state
//   before the same window once more. By induction, forever.
//
// Two things would break that argument and are checked. The window has to be
// as wide as the head actually wandered back (w is measured, not guessed). And
// on a one-way tape the head may have been stopped by the wall at cell 0
// between t₁ and t₂ — shifted right, it would not be — so a pair with a wall
// bump between them does not count. Left records are the mirror image, on a
// two-way tape only.
//
// The leftmost cell visited since each record is kept with a stack of groups
// (records whose minimum has become the same stay merged), so it costs O(1) a
// step amortised however many records there are.
//
// ── backward reasoning ────────────────────────────────────────────
// The other three watch the run; this one never runs the machine. It starts
// from every *halting* configuration — a state with no move for the symbol it
// reads, or an accepting state reading anything — and asks what could have
// led there one step earlier: a transition into that state, from a
// non-halting state, whose written symbol agrees with what is known of the
// tape where it wrote, and whose move puts the head where it now is. Each
// predecessor knows one more cell (what the transition read), so a path back
// is a partial configuration that grows by at most a cell a step. If every
// path dies — some cell would have to hold two symbols at once — within L
// steps, then *no* configuration, on any tape, halts more than L steps later.
// The run from the real start is one of those, so once it has gone L + 1
// steps without halting it never will.
//
// The search is complete, which is what makes it a proof: every real
// predecessor matches one of the branches, and every check is only a
// necessary condition. It is over tapes of the symbols this run can ever
// meet, not all of Γ, so the proof is about this starting tape's alphabet. On a one-way tape a left move may also have been
// stopped by the wall, and that is a branch of its own that fixes where cell
// 0 is — no known cell may lie left of it, and no later (earlier-in-time)
// head may either. A path still alive at BACK_DEPTH, or a search past
// BACK_NODES, gives no proof and the run carries on without one.
//
// DOM-free and import-light like the rest of js/machines/**: a worker could
// run it. It reads the machine through the same lookup the player uses, so a
// wildcard or a missing transition means what it means everywhere else.

import { App, usesTwoWayTape } from '../state.js';
import { singleTapeLookup } from './runtime.js';

/** The machine types this module can classify: one deterministic tape. */
export const BEHAVIOUR_MACHINES = new Set(['TM', 'ITM']);

// How many past records per state a new one is compared with, and how much
// tape behind a record is kept to compare. A translated cycler whose period
// holds more than RECORDS records in one state, or that wanders back further
// than WINDOW cells, is left unknown rather than missed wrongly.
const RECORDS = 16;
const WINDOW = 1024;

// How far back backward reasoning follows a path, and how many partial
// configurations it will open in all, before it gives up without a proof.
// It runs in one piece before the first slice, so the node cap is what bounds
// the stall: a node is a copy of a map of at most BACK_DEPTH + 1 cells, ~2µs
// at full depth, so 20,000 is ~40ms at worst. Proofs found on random machines
// opened a few hundred at most; depth first reaches the depth cap long before
// the node cap on a machine whose paths do not die.
const BACK_DEPTH = 48;
const BACK_NODES = 20000;

/**
 * The proof methods, by the key a verdict carries in `method`, with the
 * answer each can give. A verdict's `verdict` is always its method's.
 */
export const METHODS = {
  simulation: { verdict: 'halts', name: 'Simulation' },
  cycler: { verdict: 'never', name: 'Cycler' },
  translated: { verdict: 'never', name: 'Translated cycler' },
  backward: { verdict: 'never', name: 'Backward reasoning' }
};

// ══════════════════════════════════════════════════════════════════
//  THE MACHINE AS A TABLE
// ══════════════════════════════════════════════════════════════════

/**
 * The app's machine as integers: states 0..Q-1, symbols 0..K-1 with 0 the
 * blank, and δ as flat arrays over state * K + symbol. `input` is the word to
 * lay on the tape, as symbols (none: a blank tape).
 *
 * Returns { ok: false, error } for a machine this cannot classify.
 */
export function compileBehaviourMachine(input = [], m = App.machine) {
  if (!BEHAVIOUR_MACHINES.has(m)) return { ok: false, error: 'Only a deterministic one-tape Turing machine can be classified here.' };
  const startId = App.startId;
  if (!startId || !App.states.some(s => s.id === startId)) return { ok: false, error: 'The machine has no start state.' };
  const { blank, any } = App.config.sym;

  const syms = [blank];
  const code = new Map([[blank, 0]]);
  const intern = s => {
    let c = code.get(s);
    if (c === undefined) { c = syms.length; code.set(s, c); syms.push(s); }
    return c;
  };
  for (const s of App.sigma) if (s !== App.config.sym.eps) intern(s);
  for (const s of App.stackAlpha || []) intern(s);
  for (const t of App.transitions) {
    if (t.symbol && t.symbol !== any) intern(t.symbol);
    if (t.write && t.write !== any) intern(t.write);
  }
  for (const s of input) intern(s);
  if (syms.length > 65535) return { ok: false, error: 'The tape alphabet is too large to classify.' };

  const ids = App.states.map(s => s.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const Q = ids.length, K = syms.length;
  const next = new Int32Array(Q * K).fill(-1);
  const write = new Int32Array(Q * K);
  const move = new Int8Array(Q * K);
  const accept = new Uint8Array(Q);
  const fires = singleTapeLookup();
  for (let s = 0; s < Q; s++) {
    accept[s] = App.accepts.has(ids[s]) ? 1 : 0;
    for (let c = 0; c < K; c++) {
      const t = fires(ids[s], syms[c]);
      const e = s * K + c;
      if (!t || !index.has(t.to)) continue;
      next[e] = index.get(t.to);
      write[e] = (!t.write || t.write === any) ? c : (t.write === blank ? 0 : code.get(t.write));
      move[e] = t.dir === 'R' ? 1 : t.dir === 'L' ? -1 : 0;
    }
  }
  return {
    ok: true,
    Q, K, next, write, move, accept,
    start: index.get(startId),
    twoWay: usesTwoWayTape(m),
    input: input.map(s => code.get(s)),
    stateNames: App.states.map(s => s.name ?? s.id),
    symbols: syms
  };
}

// ══════════════════════════════════════════════════════════════════
//  A RUNNING COPY
// ══════════════════════════════════════════════════════════════════

// One pseudo-random word per (cell, symbol), for the tape's hash.
function zob(x, c) {
  let h = Math.imul(x ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(c, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  return (h ^ (h >>> 15)) | 0;
}

class Runner {
  constructor(p) {
    this.p = p;
    this.buf = new (p.K > 255 ? Uint16Array : Uint8Array)(256);
    this.base = -128;
    this.head = 0;
    this.state = p.start;
    this.t = 0;
    this.hash = 0;
    this.lo = 0;       // the leftmost and rightmost cells the head has been on,
    this.hi = 0;       // and the input's cells, which it may not have been on yet
    this.wallAt = -1;  // the last step the head was stopped by cell 0
    this.halted = null;
    p.input.forEach((c, x) => this.set(x, c));
    if (p.input.length) this.hi = Math.max(this.hi, p.input.length - 1);
  }

  get(x) {
    const i = x - this.base;
    return i >= 0 && i < this.buf.length ? this.buf[i] : 0;
  }

  set(x, c) {
    let i = x - this.base;
    if (i < 0 || i >= this.buf.length) {
      if (c === 0) return;
      this.grow(x);
      i = x - this.base;
    }
    const old = this.buf[i];
    if (old === c) return;
    this.hash ^= (old ? zob(x, old) : 0) ^ (c ? zob(x, c) : 0);
    this.buf[i] = c;
  }

  grow(x) {
    const len = this.buf.length;
    const need = Math.max(len * 2, (x < this.base ? this.base - x : x - this.base - len + 1) + len + 64);
    const buf = new this.buf.constructor(need);
    const base = x < this.base ? this.base - (need - len) : this.base;
    buf.set(this.buf, this.base - base);
    this.buf = buf;
    this.base = base;
  }

  /**
   * One transition. Returns true while the machine runs; false once it has
   * halted, with `halted` saying how.
   */
  step() {
    const p = this.p, s = this.state;
    if (p.accept[s]) { this.halted = 'accept'; return false; }
    const c = this.get(this.head);
    const e = s * p.K + c;
    const to = p.next[e];
    if (to < 0) { this.halted = 'none'; this.haltRead = c; return false; }
    this.set(this.head, p.write[e]);
    const h = this.head + p.move[e];
    if (!p.twoWay && h < 0) this.wallAt = this.t;
    else this.head = h;
    // Every copy keeps its own range, because the cell-by-cell confirmation
    // compares exactly this range: a copy that did not would confirm a hash
    // match on too little of the tape.
    if (this.head > this.hi) this.hi = this.head;
    else if (this.head < this.lo) this.lo = this.head;
    this.state = to;
    this.t++;
    return true;
  }

  /** A copy of the configuration, for Brent's comparison. */
  snapshot() {
    const lo = Math.min(this.lo, this.head), hi = Math.max(this.hi, this.head);
    const cells = new this.buf.constructor(hi - lo + 1);
    for (let x = lo; x <= hi; x++) cells[x - lo] = this.get(x);
    return { t: this.t, state: this.state, head: this.head, hash: this.hash, lo, cells };
  }

  /** Whether this is exactly the configuration a snapshot holds. */
  matches(snap) {
    if (this.state !== snap.state || this.head !== snap.head || this.hash !== snap.hash) return false;
    const lo = Math.min(this.lo, snap.lo), hi = Math.max(this.hi, snap.lo + snap.cells.length - 1);
    for (let x = lo; x <= hi; x++) {
      const k = x - snap.lo;
      if (this.get(x) !== (k >= 0 && k < snap.cells.length ? snap.cells[k] : 0)) return false;
    }
    return true;
  }

  sameAs(o) {
    if (this.state !== o.state || this.head !== o.head || this.hash !== o.hash) return false;
    const lo = Math.min(this.lo, o.lo), hi = Math.max(this.hi, o.hi);
    for (let x = lo; x <= hi; x++) if (this.get(x) !== o.get(x)) return false;
    return true;
  }

  /** The non-blank cells: Σ, in busy beaver terms. */
  ones() {
    let n = 0;
    for (let i = 0; i < this.buf.length; i++) if (this.buf[i] !== 0) n++;
    return n;
  }

  cells(lo, hi) {
    const out = [];
    for (let x = lo; x <= hi; x++) out.push(this.get(x));
    return out;
  }
}

// ── the records, one direction ────────────────────────────────────
// `dir` is +1 for right records (the head further right than ever) and −1 for
// left ones. Everything is written for the right and mirrored by `dir`: "the
// cell furthest back" is the minimum for right records and the maximum for
// left ones.
class Records {
  constructor(dir, Q) {
    this.dir = dir;
    this.n = 0;                           // records so far; a record's index
    this.gBack = [];                      // groups: the furthest-back cell since
    this.gFirst = [];                     // any record from gFirst on
    this.ring = Array.from({ length: Q }, () => []);
    this.checks = 0;
  }

  // The head moved to h on a step that was not a record.
  visit(h) {
    const d = this.dir, back = this.gBack, first = this.gFirst;
    let k = back.length, f = -1;
    while (k > 0 && (d > 0 ? back[k - 1] > h : back[k - 1] < h)) { k--; f = first[k]; }
    if (f >= 0) { back.length = k; first.length = k; back.push(h); first.push(f); }
  }

  // The furthest-back cell the head has been on since record i.
  backSince(i) {
    const first = this.gFirst;
    let lo = 0, hi = first.length - 1, g = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (first[mid] <= i) { g = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return this.gBack[g];
  }

  /**
   * A record at the runner's current step. Returns the proof when this one and
   * an earlier record in the same state show a translated cycle, else null.
   */
  record(r) {
    const d = this.dir, h = r.head, q = r.state;
    const i = this.n++;
    this.gBack.push(h);
    this.gFirst.push(i);
    const ring = this.ring[q];
    for (let k = ring.length - 1; k >= 0; k--) {
      const a = ring[k];
      if (r.wallAt >= a.t) continue;            // the wall stopped the head since
      const w = d * (a.head - this.backSince(a.i));
      if (w + 1 > a.cells.length) continue;      // wandered back past what was kept
      this.checks++;
      let same = true;
      for (let j = 0; j <= w && same; j++) {
        // j cells back from the record's cell, which is the last kept.
        same = a.cells[a.cells.length - 1 - j] === r.get(h - d * j);
      }
      if (same) {
        // The two windows, left to right on the tape, for the proof's picture.
        const kept = [...a.cells.slice(a.cells.length - 1 - w)];
        const lo1 = d > 0 ? a.head - w : a.head, lo2 = d > 0 ? h - w : h;
        return {
          verdict: 'never', method: 'translated', direction: d > 0 ? 'right' : 'left',
          from: a.t, at: r.t, period: r.t - a.t, shift: h - a.head, window: w + 1, state: q,
          before: { t: a.t, head: a.head, lo: lo1, cells: d > 0 ? kept : kept.reverse() },
          after: { t: r.t, head: h, lo: lo2, cells: r.cells(lo2, lo2 + w) }
        };
      }
    }
    // Keep this one: the tape behind the head, up to WINDOW cells, nearest last.
    const far = d > 0 ? r.lo : r.hi;
    const keep = Math.min(WINDOW, d * (h - far)) + 1;
    const cells = new r.buf.constructor(keep);
    for (let j = 0; j < keep; j++) cells[keep - 1 - j] = r.get(h - d * j);
    ring.push({ i, t: r.t, head: h, cells });
    if (ring.length > RECORDS) ring.shift();
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
//  BACKWARD REASONING
// ══════════════════════════════════════════════════════════════════

/**
 * Which symbols can ever be on the tape: the blank, the input's, and whatever
 * a transition reading one of those writes, to a fixed point. A symbol Γ
 * declares and nothing writes — Σ's, on a blank tape — is never read, so a
 * missing move on it is no way to halt, and a path back may not have read it
 * either. Left in, it gives nearly every machine a halt reachable from as far
 * back as you like, and backward reasoning would prove almost nothing.
 */
export function symbolsMet(p) {
  const { Q, K, next, write } = p;
  const met = new Uint8Array(K);
  met[0] = 1;
  for (const c of p.input) met[c] = 1;
  for (let grew = true; grew;) {
    grew = false;
    for (let e = 0; e < Q * K; e++) {
      if (next[e] >= 0 && met[e % K] && !met[write[e]]) { met[write[e]] = 1; grew = true; }
    }
  }
  return met;
}

/**
 * Every path back from every halting configuration, searched depth first,
 * over tapes of the symbols the run can meet (`symbolsMet`).
 *
 * Returns { ok: true, longest, halts, explored, witness } when every path
 * dies: `longest` is L, the most steps any configuration can be from a halt
 * (−1 when there is no way to halt at all); `halts` is one entry per halting
 * configuration, { state, read, depth }, with `read` −1 for an accepting
 * state; `witness` is a configuration exactly L steps from a halt, as
 * { state, head, lo, cells, wall, halt }, a cell −1 where any symbol will do
 * and `wall` the cell that must be 0 on a one-way tape (null: anywhere).
 *
 * Returns { ok: false, reason: 'depth' | 'nodes', explored, depth } when it
 * gave up, which proves nothing either way.
 */
export function backwardReasoning(p, { depth = BACK_DEPTH, nodes = BACK_NODES } = {}) {
  const { Q, K, next, write, move, accept } = p;
  const meets = symbolsMet(p);
  // The transitions into each state. A step is only ever taken from a
  // configuration that has not halted, so none leaves an accepting state.
  const into = Array.from({ length: Q }, () => []);
  for (let s = 0; s < Q; s++) {
    if (accept[s]) continue;
    for (let c = 0; c < K; c++) {
      const e = s * K + c;
      if (next[e] >= 0 && meets[c]) into[next[e]].push(e);
    }
  }

  // The predecessor of n by transition e, whose head was at `from`; null when
  // it contradicts what n already knows.
  const before = (n, e, from, bump) => {
    const had = n.tape.get(from);
    if (had !== undefined && had !== write[e]) return null;
    let wall = n.wall;
    if (bump) {
      if (wall === null) {
        for (const x of n.tape.keys()) if (x < from) return null;
        wall = from;
      } else if (wall !== from) return null;
    } else if (wall !== null && from < wall) return null;
    const tape = new Map(n.tape);
    tape.set(from, e % K);
    return { state: (e / K) | 0, head: from, tape, wall, depth: n.depth + 1 };
  };

  const halts = [];
  let explored = 0, deepest = null;
  for (let s = 0; s < Q; s++) {
    for (let c = accept[s] ? -1 : 0; c < (accept[s] ? 0 : K); c++) {
      if (c >= 0 && (next[s * K + c] >= 0 || !meets[c])) continue;
      const halt = { state: s, read: c, depth: 0 };
      const stack = [{ state: s, head: 0, tape: new Map(c >= 0 ? [[0, c]] : []), wall: null, depth: 0 }];
      while (stack.length) {
        const n = stack.pop();
        if (++explored > nodes) return { ok: false, reason: 'nodes', explored: nodes, depth };
        if (n.depth >= depth) return { ok: false, reason: 'depth', explored, depth };
        if (n.depth > halt.depth) halt.depth = n.depth;
        if (!deepest || n.depth > deepest.n.depth) deepest = { n, halt };
        for (const e of into[n.state]) {
          const d = move[e];
          const a = before(n, e, n.head - d, false);
          if (a) stack.push(a);
          // On a one-way tape a left move may have been stopped by the wall.
          if (d < 0 && !p.twoWay) {
            const b = before(n, e, n.head, true);
            if (b) stack.push(b);
          }
        }
      }
      halts.push(halt);
    }
  }

  let witness = null;
  if (deepest) {
    const { n, halt } = deepest;
    let lo = n.head, hi = n.head;
    for (const x of n.tape.keys()) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const cells = [];
    for (let x = lo; x <= hi; x++) cells.push(n.tape.has(x) ? n.tape.get(x) : -1);
    witness = { state: n.state, head: n.head, lo, cells, wall: n.wall, halt: { state: halt.state, read: halt.read } };
  }
  return { ok: true, longest: deepest ? deepest.n.depth : -1, halts, explored, witness };
}

// ══════════════════════════════════════════════════════════════════
//  CLASSIFYING
// ══════════════════════════════════════════════════════════════════

/**
 * A classification in progress. `advance(n)` runs up to n more steps and
 * returns the verdict once there is one (or the budget is spent), else null —
 * so a caller on the main thread can run it a slice at a time.
 *
 * A verdict is { verdict, method, ...its proof }, one of
 *   halts    simulation  { steps, how: 'accept' | 'none', state, read, ones, cells }
 *   never    cycler      { period, from, cells, state, at }
 *   never    translated  { direction, period, shift, from, at, window, state, before, after }
 *   never    backward    { steps, longest, halts, explored, witness }
 *   unknown  null        { steps, cells, records, backward }
 * with `steps` counted as transitions made. An unknown's `backward` says why
 * backward reasoning gave up, or is null when it was not asked for.
 *
 * `backward: false` leaves backward reasoning out, so a test can reach the
 * run's own methods on a machine it would settle first.
 */
export function classifyBehaviour(p, { budget = 1e7, backward = true } = {}) {
  // Static, and bounded by BACK_NODES, so it is done before the first slice.
  const back = backward ? backwardReasoning(p) : null;
  const safeAfter = back && back.ok ? back.longest : Infinity;
  const r = new Runner(p);
  const right = new Records(1, p.Q);
  const left = p.twoWay ? new Records(-1, p.Q) : null;
  let saved = r.snapshot();
  let power = 1, lam = 0;
  let verdict = null;

  const cellsUsed = () => r.hi - r.lo + 1;

  function finishCycle(period) {
    // Two copies λ apart, stepped together until they meet: that step is μ.
    const a = new Runner(p), b = new Runner(p);
    for (let k = 0; k < period; k++) b.step();
    let mu = 0;
    while (!a.sameAs(b)) { a.step(); b.step(); mu++; }
    // The configuration the cycle starts from, over every cell the cycle goes
    // on to use (r's range — a has not been to all of them yet at μ), up to
    // 60 cells either side of the head, for the proof's picture.
    const lo = Math.max(Math.min(r.lo, a.head), a.head - 60);
    const hi = Math.min(Math.max(r.hi, a.head), a.head + 60);
    return {
      verdict: 'never', method: 'cycler', period, from: mu, cells: cellsUsed(), state: a.state,
      at: { t: mu, head: a.head, lo, cells: a.cells(lo, hi) }
    };
  }

  function advance(n) {
    if (verdict) return verdict;
    for (let k = 0; k < n; k++) {
      if (r.t > safeAfter) {
        const { longest, halts, explored, witness } = back;
        verdict = { verdict: 'never', method: 'backward', steps: r.t, longest, halts, explored, witness };
        return verdict;
      }
      if (r.t >= budget) {
        verdict = {
          verdict: 'unknown', method: null, steps: r.t, cells: cellsUsed(), records: right.n + (left ? left.n : 0),
          backward: back && !back.ok ? { reason: back.reason, explored: back.explored, depth: back.depth } : null
        };
        return verdict;
      }
      const hi0 = r.hi, lo0 = r.lo;
      if (!r.step()) {
        verdict = {
          verdict: 'halts', method: 'simulation', steps: r.t, how: r.halted, state: r.state,
          read: r.halted === 'none' ? r.haltRead : null, ones: r.ones(), cells: cellsUsed()
        };
        return verdict;
      }
      const h = r.head;
      if (h > hi0) {
        const proof = right.record(r);
        if (proof) return (verdict = proof);
      } else right.visit(h);
      if (h < lo0) {
        if (left) {
          const proof = left.record(r);
          if (proof) return (verdict = proof);
        }
      } else if (left) left.visit(h);
      // Brent: compare with the copy; move the copy up at each power of two.
      lam++;
      if (r.matches(saved)) return (verdict = finishCycle(lam));
      if (lam === power) { saved = r.snapshot(); power *= 2; lam = 0; }
    }
    return null;
  }

  return {
    advance,
    get steps() { return r.t; },
    get budget() { return budget; },
    get verdict() { return verdict; }
  };
}

/** Classify to the end in one call — for tests and for a caller that can wait. */
export function classifyBehaviourNow(p, opts) {
  const c = classifyBehaviour(p, opts);
  let v = null;
  while (!(v = c.advance(1 << 20)));
  return v;
}
