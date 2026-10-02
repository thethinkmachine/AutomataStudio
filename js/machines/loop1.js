// ══════════════════════════════════════════════════════════════════
//  LOOPS — Coq-BB5's loop decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is Coq-BB5's Deciders/Decider_Loop.v (`loop1_decider`), the
// first decider of the BB(5) proof's pipeline, and this is a line-for-line
// port: `loop1_decider0`, `find_loop1_0`, `find_loop1` and `verify_loop1`
// over the same history, so it gives the reference's answer on every machine
// for the same gas.
//
// What it does. Run the machine for exactly `n` steps, keeping the history
// of (state, symbol read, head position). A halt within them is a halt. At
// the end, look back from the last configuration h0 for a period p: the
// configurations p and 2p steps earlier are in the same state reading the
// same symbol, and walking back from h0 and from p steps before it in
// lockstep, every pair agrees for at least p steps until one of them is a
// record — the earlier configuration at the edge of the tape visited so far
// (in the direction the period moves) — or the two are at the same cell.
// Then the run repeats forever: in place (a cycler) or shifted onto fresh
// tape (a translated cycler).
//
// Coq's `ListES` stores the cells the head has visited on each side; its
// right list is empty exactly when the head is on the rightmost cell visited
// so far, and likewise the left. That is all `verify_loop1` asks of it, so
// the history here keeps the head and the visited range.
//
// Import-free and DOM-free.

import { bbMachine } from './bb-table.js';

/**
 * Coq-BB5's `loop1_decider n`. Returns { result: 'halt', steps, state, read }
 * (`steps` counts the step that reads the missing transition, as bbchallenge
 * does), { result: 'never', period, shift, at }, or { result: 'unknown' }; or
 * { result: 'model', why } outside the model.
 */
export function loop1(p, n) {
  const m = bbMachine(p);
  if (m.why) return { result: 'model', why: m.why };
  const { K, next, write, move } = m;
  // The history: time t's state, symbol under the head, head position, and
  // whether the head is on the rightmost / leftmost cell visited so far.
  const S = new Int32Array(n + 1), M = new Int32Array(n + 1), D = new Int32Array(n + 1);
  const atR = new Uint8Array(n + 1), atL = new Uint8Array(n + 1);
  let tape = new Uint8Array(256), base = 128;
  let head = 0, lo = 0, hi = 0, s = m.start;
  const read = x => {
    const i = x + base;
    return i >= 0 && i < tape.length ? tape[i] : 0;
  };
  const put = (x, c) => {
    let i = x + base;
    if (i < 0 || i >= tape.length) {
      const grown = new Uint8Array(tape.length * 2);
      const shift = i < 0 ? tape.length : 0;
      grown.set(tape, shift);
      base += shift;
      tape = grown;
      i = x + base;
    }
    tape[i] = c;
  };
  const record = t => {
    S[t] = s; M[t] = read(head); D[t] = head;
    atR[t] = head === hi ? 1 : 0;
    atL[t] = head === lo ? 1 : 0;
  };
  record(0);
  for (let t = 0; t < n; t++) {
    const e = s * K + M[t];
    if (next[e] < 0) return { result: 'halt', steps: t + 1, state: s, read: M[t] };
    put(head, write[e]);
    head += move[e];
    if (head > hi) hi = head; else if (head < lo) lo = head;
    s = next[e];
    record(t + 1);
  }
  const loop = findLoop1(n, S, M, D, atR, atL);
  return loop ? { result: 'never', ...loop } : { result: 'unknown' };
}

// `verify_loop1`: walking back from i0 and i1 in lockstep, every pair has
// the same state and symbol; after at least `period` pairs, one satisfies the
// end condition for `dpos`.
function verifyLoop1(i0, i1, period, dpos, S, M, D, atR, atL) {
  for (let k = 0; ; k++) {
    const a = i0 - k, b = i1 - k;
    if (S[a] !== S[b] || M[a] !== M[b]) return false;
    if (k >= period) {
      if (dpos === 0 ? D[b] === D[a]
        : dpos > 0 ? atR[b] && D[b] < D[a]
        : atL[b] && D[a] < D[b]) return true;
    }
    if (b - 1 < 0) return false;
  }
}

// `find_loop1_0` and `find_loop1`: h0 is the last configuration, h1 is p
// steps before it and h2 is 2p, for p = 1, 2, … while h2 exists.
function findLoop1(T, S, M, D, atR, atL) {
  for (let p = 1; T - 2 * p >= 0; p++) {
    const h1 = T - p, h2 = T - 2 * p;
    if (S[T] === S[h1] && S[T] === S[h2] && M[T] === M[h1] && M[T] === M[h2]
      && verifyLoop1(T, h1, p, D[T] - D[h1], S, M, D, atR, atL)) {
      return { period: p, shift: D[T] - D[h1], at: T };
    }
  }
  return null;
}
