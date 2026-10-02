// ══════════════════════════════════════════════════════════════════
//  N-GRAM CLOSED POSITION SET — Coq-BB5's decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is Coq-BB5's Deciders/Decider_NGramCPS.v, Nathan Fenner's
// n-gram CPS as the BB(5) proof implements it, with its three variants:
//
//   impl2   the plain decider, over the machine's own symbols
//   impl1   over symbols augmented with a history: each cell also remembers
//           the last `lenH` (state, symbol) pairs that wrote it
//   LRU     the same, but the history is every (state, symbol) that wrote
//           the cell, most recent first, each once
//
// This is a port of `update_AES_MidWord`, `update_AES` and
// `NGramCPS_decider_0`, down to the order things are visited in: a set is a
// list with new members put first, and the queue is a stack. That order is
// not cosmetic — the gas `m` counts visits, so a different order decides a
// different set of machines at the same parameters.
//
// What it does. A local context (MidWord) is the state, the symbol under the
// head, and `lenL` cells to its left and `lenR` to its right. Each step of a
// context lets an n-gram fall off one side (it is recorded in that side's
// n-gram set) and pulls a cell in on the other, from every n-gram seen there
// that fits. When a whole pass over the contexts adds nothing — no new
// n-gram, no new context, no context that halts — the set is closed and
// holds every configuration reachable from the blank start: the machine never
// halts. The gas `m` bounds both the passes and the visits.
//
// Import-free and DOM-free.

import { bbMachine } from './bb-table.js';

/**
 * Coq-BB5's NGramCPS deciders. `variant` is 'impl2' (plain), 'impl1' (with a
 * history of `lenH` pairs) or 'lru'. Returns { result: 'never', contexts,
 * left, right } when the closed set is found, { result: 'unknown' } when it is
 * not, or { result: 'model', why }.
 */
export function ngramCps(p, { variant = 'impl2', lenH = 0, lenL, lenR, gas }) {
  const mach = bbMachine(p);
  if (mach.why) return { result: 'model', why: mach.why };
  if (!(lenL >= 1 && lenR >= 1)) return { result: 'unknown' };
  const { K, next, write, move } = mach;

  // ── symbols: the machine's own (impl2) or interned (bit, history) pairs ──
  // An augmented symbol is an id; `baseOf[id]` is its bit, `histOf[id]` its
  // history as (state·K + bit) codes, most recent first.
  const augmented = variant !== 'impl2';
  const baseOf = [], histOf = [], idOf = new Map();
  const intern = (b, hist) => {
    const key = `${b}|${hist.join(',')}`;
    let id = idOf.get(key);
    if (id === undefined) { id = baseOf.length; idOf.set(key, id); baseOf.push(b); histOf.push(hist); }
    return id;
  };
  const ZERO = augmented ? intern(0, []) : 0;
  // tm(s, symbol) → [to, dir, out], or null for a halt; cached per pair.
  const trCache = new Map();
  const tm = (s, x) => {
    if (!augmented) {
      const e = s * K + x;
      return next[e] < 0 ? null : [next[e], move[e], write[e]];
    }
    const ck = x * 32 + s;
    if (trCache.has(ck)) return trCache.get(ck);
    const b = baseOf[x], e = s * K + b;
    let out = null;
    if (next[e] >= 0) {
      const pair = s * K + b;
      const hist = variant === 'impl1'
        ? [pair, ...histOf[x]].slice(0, lenH)
        : [pair, ...histOf[x].filter(h => h !== pair)];
      out = [next[e], move[e], intern(write[e], hist)];
    }
    trCache.set(ck, out);
    return out;
  };

  // ── the sets ──
  // An xset maps an n-gram's first n−1 symbols to the list of last symbols
  // seen after them, newest first (`xset_ins` / `xset_as_list`).
  const ngramKey = a => a.join(',');
  const xsetIns = (xs, x) => {
    const k1 = ngramKey(x.slice(0, -1)), last = x[x.length - 1];
    let v = xs.get(k1);
    if (!v) { v = { list: [], has: new Set() }; xs.set(k1, v); }
    if (v.has.has(last)) return true;
    v.has.add(last);
    v.list.unshift(last);
    return false;
  };
  const xsetList = (xs, x1) => {
    const v = xs.get(ngramKey(x1));
    return v ? v.list.slice() : [];
  };
  const lset = new Map(), rset = new Map();
  // The mset: every context seen, in order of arrival (newest last here, so
  // the stack a pass starts from is the array itself), and the set of keys.
  const mlist = [], mkeys = new Set();
  const mwKey = mw => `${mw.s}|${mw.m}|${mw.l.join(',')}|${mw.r.join(',')}`;
  const msetIns = mw => {
    const k = mwKey(mw);
    if (mkeys.has(k)) return true;
    mkeys.add(k);
    mlist.push(mw);
    return false;
  };

  const zeros = n => Array(n).fill(ZERO);
  xsetIns(lset, zeros(lenL));
  xsetIns(rset, zeros(lenR));
  msetIns({ l: zeros(lenL), r: zeros(lenR), m: ZERO, s: mach.start });

  // update_AES_MidWord: visit one context; new contexts go on top of the
  // stack `q`. Returns whether nothing changed (and nothing halted).
  const visit = (q, mw) => {
    const tr = tm(mw.s, mw.m);
    if (!tr) return false;
    const [s1, d, o] = tr;
    let flag1, flag2 = true;
    if (d > 0) {
      flag1 = xsetIns(lset, mw.l);
      const l = [o, ...mw.l.slice(0, -1)], r1 = mw.r.slice(1), m = mw.r[0];
      for (const x of xsetList(rset, r1)) {
        const nw = { l, m, r: [...r1, x], s: s1 };
        if (!msetIns(nw)) { q.push(nw); flag2 = false; }
      }
    } else {
      flag1 = xsetIns(rset, mw.r);
      const r = [o, ...mw.r.slice(0, -1)], l1 = mw.l.slice(1), m = mw.l[0];
      for (const x of xsetList(lset, l1)) {
        const nw = { r, m, l: [...l1, x], s: s1 };
        if (!msetIns(nw)) { q.push(nw); flag2 = false; }
      }
    }
    return flag1 && flag2;
  };

  // NGramCPS_decider_0 with update_AES: `rounds` passes, `fuel` visits in
  // all (both start at `gas`). A pass starts from every context seen, newest
  // first; an empty stack still costs one unit of fuel, as in Coq.
  let fuel = gas;
  for (let rounds = gas; rounds > 0; rounds--) {
    const q = mlist.slice();
    let flag = true, closed = null;
    for (;;) {
      if (fuel === 0) { closed = false; break; }
      if (!q.length) { fuel--; closed = flag; break; }
      const mw = q.pop();
      flag = visit(q, mw) && flag;
      fuel--;
    }
    if (closed) {
      const dump = xs => [...xs].flatMap(([k, v]) => v.list.map(x => (k ? `${k},${x}` : `${x}`)));
      return { result: 'never', contexts: mlist.length, left: dump(lset), right: dump(rset) };
    }
    if (fuel === 0) break;
  }
  return { result: 'unknown' };
}

/**
 * The generic NGramCPS parameters of Coq-BB5's pipelines, in pipeline order
 * (BB5_Deciders_Pipeline.v, BB4_Deciders_Pipeline.v). The BB(5) list is what
 * the proof applies to every machine its loop decider leaves; the BB(4) list
 * adds the LRU variant and a longer history, which BB(5) applies only to the
 * machines its hardcoded tables name.
 */
export const COQ_BB5_NGRAM = [
  { variant: 'impl2', lenL: 1, lenR: 1, gas: 100 },
  { variant: 'impl2', lenL: 2, lenR: 2, gas: 200 },
  { variant: 'impl2', lenL: 3, lenR: 3, gas: 400 },
  { variant: 'impl1', lenH: 2, lenL: 2, lenR: 2, gas: 1600 },
  { variant: 'impl1', lenH: 2, lenL: 3, lenR: 3, gas: 1600 },
  { variant: 'impl1', lenH: 4, lenL: 2, lenR: 2, gas: 600 },
  { variant: 'impl1', lenH: 4, lenL: 3, lenR: 3, gas: 1600 },
  { variant: 'impl1', lenH: 6, lenL: 2, lenR: 2, gas: 3200 },
  { variant: 'impl1', lenH: 6, lenL: 3, lenR: 3, gas: 3200 },
  { variant: 'impl1', lenH: 8, lenL: 2, lenR: 2, gas: 1600 },
  { variant: 'impl1', lenH: 8, lenL: 3, lenR: 3, gas: 1600 }
];

export const COQ_BB4_NGRAM = [
  ...COQ_BB5_NGRAM,
  { variant: 'lru', lenL: 2, lenR: 2, gas: 10000 },
  { variant: 'impl1', lenH: 10, lenL: 4, lenR: 4, gas: 10000 }
];

/**
 * Each parameter set of `list` in turn; the first that closes, with its
 * parameters, or { result: 'unknown' } (or 'model').
 */
export function ngramCpsPipeline(p, list = COQ_BB5_NGRAM) {
  for (const params of list) {
    const r = ngramCps(p, params);
    if (r.result !== 'unknown') return r.result === 'never' ? { ...r, params } : r;
  }
  return { result: 'unknown' };
}
