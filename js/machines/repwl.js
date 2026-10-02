// ══════════════════════════════════════════════════════════════════
//  REPEATED WORD LIST — Coq-BB5's decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is Coq-BB5's Deciders/Decider_RepWL.v (`RepWL_ES_decider`,
// by mxdys), and this is a port of it: `pop`, `push`, `WordUpdate`,
// `RepWL_step` and the closed-set searcher `T_close_set_searcher`, with the
// same encodings' equalities and the same stack order, so the gas `n` buys
// exactly the search it buys the reference.
//
// What it does. The tape is cut into words of `len` cells on each side of
// the head, which sits between two words facing one way (`sgn`). A run of
// equal words is one entry, `(w)^k`, and once a word repeats `minRep` times
// it becomes `(w)^minRep+` — at least that many, any number more. A step pops
// the word the head faces and runs the machine inside it (at most `maxT`
// steps) until the head leaves it on one side or the other; the rewritten
// word is pushed onto that side. Popping from `(w)^k+` has two outcomes,
// exactly k − 1 more or still k or more, and both are followed. A closed set
// of these configurations, reached from the blank tape and containing no
// halt, means the machine never halts.
//
// Import-free and DOM-free.

import { bbMachine } from './bb-table.js';

/**
 * Coq-BB5's `RepWL_ES_decider len minRep maxT gas`. Returns
 * { result: 'never', configurations } when the closed set is found,
 * { result: 'unknown' } when it is not, or { result: 'model', why }.
 */
export function repwl(p, { len, minRep, maxT, gas }) {
  const mach = bbMachine(p);
  if (mach.why) return { result: 'model', why: mach.why };
  const { K, next, write, move } = mach;

  // A RepeatWord is { w, c, k }: the word, min_cnt, and is_const. A list of
  // them is immutable and shared, a cons cell { head, tail, id } or null, and
  // every distinct list gets an id once — so a configuration's key is four
  // numbers rather than its whole tape, and a step costs what changed.
  const wordIds = new Map();
  const wordId = w => {
    const k = w.join('.');
    let id = wordIds.get(k);
    if (id === undefined) { id = wordIds.size + 1; wordIds.set(k, id); }
    return id;
  };
  const consIds = new Map();
  const cons = (head, tail) => {
    const k = `${head.id}|${head.c}|${head.k ? 1 : 0}|${tail ? tail.id : 0}`;
    let cell = consIds.get(k);
    if (!cell) { cell = { head, tail, id: consIds.size + 1 }; consIds.set(k, cell); }
    return cell;
  };
  const rw = (w, c, k) => ({ w, id: wordId(w), c, k });
  const zeroWord = Array(len).fill(0);

  // pop: the word faced, and the lists that can remain behind it.
  const pop = wl => {
    if (!wl) return { w: zeroWord, rests: [null] };
    const v = wl.head;
    if (v.c === 0) return null;
    const n0 = v.c - 1;
    const rest = n0 > 0 ? cons(rw(v.w, n0, true), wl.tail) : wl.tail;
    return { w: v.w, rests: v.k ? [rest] : [rest, wl] };
  };

  const push = (wl, w0) => {
    const id0 = wordId(w0);
    if (wl) {
      const v0 = wl.head;
      if (v0.id === id0) {
        const cnt = v0.c + 1;
        return cons(cnt < minRep ? rw(w0, cnt, v0.k) : rw(w0, minRep, false), wl.tail);
      }
      return cons(rw(w0, 1, true), wl);
    }
    return w0.every(x => x === 0) ? null : cons(rw(w0, 1, true), null);
  };

  // WordUpdate: run inside word w0 from state s0, entering it from the side
  // `sgn` faces. Returns [s1, w1, isBack] or null (a halt, or past maxT).
  const wordUpdate = (s0, w0, sgn) => {
    if (!w0.length) return null;
    // A ListES over the word: l, r (nearest first), m, s.
    let l, r, m = w0[0], s = s0;
    if (sgn > 0) { l = []; r = w0.slice(1); } else { l = w0.slice(1); r = []; }
    for (let t = 0; t < maxT; t++) {
      const e = s * K + m;
      if (next[e] < 0) return null;
      const s1 = next[e], o = write[e];
      if (move[e] > 0) {
        if (r.length) { l = [o, ...l]; m = r[0]; r = r.slice(1); s = s1; }
        else return [s1, [o, ...l], sgn < 0];
      } else {
        if (l.length) { r = [o, ...r]; m = l[0]; l = l.slice(1); s = s1; }
        else return [s1, [o, ...r], sgn > 0];
      }
    }
    return null;
  };

  // RepWL_step: every configuration one word-step on, or null on a halt.
  const step = x => {
    const popped = pop(x.r);
    if (!popped) return null;
    const out = [];
    for (const r1 of popped.rests) {
      const u = wordUpdate(x.s, popped.w, x.sgn);
      if (!u) return null;
      const [s1, w1, back] = u;
      out.push(back
        ? { l: push(r1, w1), r: x.l, s: s1, sgn: -x.sgn }
        : { l: push(x.l, w1), r: r1, s: s1, sgn: x.sgn });
    }
    return out;
  };

  const key = x => `${x.sgn}|${x.s}|${x.l ? x.l.id : 0}|${x.r ? x.r.id : 0}`;

  // T_decider0 / T_close_set_searcher: a stack, newest on top.
  const init = { l: null, r: null, s: mach.start, sgn: 1 };
  const seen = new Set([key(init)]);
  const q = [init];
  for (let n = gas; n > 0; n--) {
    if (!q.length) break;
    const x = q.pop();
    const ls = step(x);
    if (!ls) return { result: 'unknown' };
    for (const h of ls) {
      const k = key(h);
      if (!seen.has(k)) { seen.add(k); q.push(h); }
    }
  }
  return q.length ? { result: 'unknown' } : { result: 'never', configurations: seen.size };
}
