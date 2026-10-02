// ══════════════════════════════════════════════════════════════════
//  ENUMERATING TURING MACHINES IN TREE NORMAL FORM
// ══════════════════════════════════════════════════════════════════
// The way the busy beaver searches enumerate: start from a machine with no
// transitions at all and run it from a blank tape. Where it first reads a
// transition that is not defined, it branches — every way that transition
// could be defined is a child, and "halt here" is a halting machine whose
// step count is known exactly. A machine that never reaches an undefined
// transition behaves the same however the rest is filled in, so one proof
// settles the whole subtree.
//
// Three symmetries keep the tree small without losing a behaviour:
//   states   a new transition may go to any state already seen or the next
//            unseen one — the rest are renamings
//   symbols  likewise for the symbol written (0 and 1 are always allowed)
//   mirror   the very first move is R: a machine and its mirror image take the
//            same number of steps
//
// The busy beaver bound is deliberately not used here: it assumes the answer
// the search is computing.

import { decide, standardFromTable } from './core.mjs';

/** The root: an n-state, k-symbol machine with nothing defined. */
export function rootNode(n, k) {
  const Q = n + 1;
  return { n, k, next: Array(Q * k).fill(-1), write: Array(Q * k).fill(0), move: Array(Q * k).fill(0), defined: 0, maxState: 0, maxSym: 1 };
}

function tableOf(node) {
  const { n, k } = node;
  const accept = new Uint8Array(n + 1);
  accept[n] = 1;
  return {
    ok: true, Q: n + 1, K: k,
    next: Int32Array.from(node.next), write: Int32Array.from(node.write), move: Int8Array.from(node.move),
    accept, start: 0, twoWay: true, input: []
  };
}

export function codeOf(node) {
  return standardFromTable(tableOf(node));
}

/**
 * Classify one node. Returns `{ verdict, method, code }` for a settled or
 * unknown machine, and for one that reached an undefined transition also
 * `halt` (the halting machine made by defining it as a halt) and `children`.
 */
export function bbStep(node, { budget = 1e5, segment = 5, far = 5, loops, ngram, repwl, bouncers, cpsMax = 4, inductionMs = 300 } = {}) {
  const p = tableOf(node);
  const v = decide(p, { budget, segment, far, loops, ngram, repwl, bouncers, cpsMax, inductionMs, bound: false });
  const code = codeOf(node);
  if (v.verdict !== 'halts') return { verdict: v.verdict, method: v.method, code };
  const { n, k } = node;
  const q = v.state, s = v.read;
  const e = q * k + s;
  // Define the missing transition as a halt writing 1: the most ones.
  const haltNext = [...node.next], haltWrite = [...node.write], haltMove = [...node.move];
  haltNext[e] = n; haltWrite[e] = 1; haltMove[e] = 1;
  const halt = {
    // The classifier already counts the step that read the missing
    // transition, which is the step the halt defined here takes.
    steps: v.steps,
    ones: (v.ones ?? 0) + (s === 0 ? 1 : 0),
    code: standardFromTable({ ...p, next: Int32Array.from(haltNext), write: Int32Array.from(haltWrite), move: Int8Array.from(haltMove) })
  };
  const children = [];
  // The last undefined transition, once defined, leaves nothing to halt on.
  if (node.defined + 1 < n * k) {
    const states = Math.min(n - 1, node.maxState + 1);
    const syms = Math.min(k - 1, node.maxSym + 1);
    const moves = node.defined === 0 ? [1] : [1, -1];
    for (let w = 0; w <= syms; w++) {
      for (const d of moves) {
        for (let to = 0; to <= states; to++) {
          const child = {
            n, k, next: [...node.next], write: [...node.write], move: [...node.move],
            defined: node.defined + 1, maxState: Math.max(node.maxState, to), maxSym: Math.max(node.maxSym, w)
          };
          child.next[e] = to; child.write[e] = w; child.move[e] = d;
          children.push(child);
        }
      }
    }
  }
  return { verdict: 'branch', code, halt, children };
}
