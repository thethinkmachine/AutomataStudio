// ══════════════════════════════════════════════════════════════════
//  A TURING MACHINE AS THE BUSY BEAVER DECIDERS READ IT
// ══════════════════════════════════════════════════════════════════
// The ports of bbchallenge's and Coq-BB5's deciders (loop1.js,
// ngram-cps.js, repwl.js, bouncers.js) all read a machine the way the
// references do: states and symbols, one transition each, and "no
// transition" for a halt. This turns the classifier's table
// (tm-behaviour.js) into that, once, and says when the table is outside the
// model the references are written for — a blank two-way tape and L/R moves.
//
// A transition into a halt state is a halt, as `1RZ` is `---` to the
// references: their machines have no halt state, only undefined transitions.
//
// Import-free and DOM-free.

/**
 * The table → { n, K, start, next, write, move } over the working states
 * only, renumbered 0 … n−1 in table order, with `next` −1 for a halt; or
 * { why } when the references' model does not apply.
 */
export function bbMachine(p) {
  if (!p.twoWay) return { why: 'it is about a two-way tape' };
  if (p.input.some(c => c !== 0)) return { why: 'it is about a blank starting tape' };
  if (p.accept[p.start]) return { why: 'the start state halts at once' };
  const work = new Int32Array(p.Q).fill(-1);
  let n = 0;
  for (let q = 0; q < p.Q; q++) if (!p.accept[q]) work[q] = n++;
  const K = p.K;
  const next = new Int32Array(n * K).fill(-1), write = new Int32Array(n * K), move = new Int8Array(n * K);
  for (let q = 0; q < p.Q; q++) {
    if (p.accept[q]) continue;
    for (let c = 0; c < K; c++) {
      const e = q * K + c, to = p.next[e];
      if (to < 0 || p.accept[to]) continue;
      if (p.move[e] === 0) return { why: 'it is about L and R moves only' };
      const f = work[q] * K + c;
      next[f] = work[to];
      write[f] = p.write[e];
      move[f] = p.move[e];
    }
  }
  return { n, K, start: work[p.start], next, write, move };
}
