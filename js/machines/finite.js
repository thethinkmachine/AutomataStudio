// ══════════════════════════════════════════════════════════════════
//  FINITE AUTOMATA — DFA, NFA, ε-NFA
// ══════════════════════════════════════════════════════════════════
// One state, one symbol, one move. The three types differ in exactly two
// places and nowhere else: whether δ is single-valued, and whether ε is a
// symbol δ may read. Everything they share — reading the most specific
// matching edge, the accepting test at the end — lives in runtime.js
// because the tape machines and the transducers share it too.

import {
  App, getState, runStartId
} from '../state.js';
import { accepted, firstIdenticalTransition, nameOfState, playEagerly, singleTapeLookup, stateNames, transitionsFrom } from './runtime.js';
import { defineFamily } from './registry.js';
import { wordStep } from './step-log.js';
import { BranchTree, attachBranchTree, branchTreesWanted } from './branch-tree.js';

export function* streamDFA(tokens) {
  let cur = runStartId();
  const fires = singleTapeLookup();
  let last = wordStep({ state: cur, tokens, pos: 0, note: `Start: ${getState(cur)?.name || '?'}` });
  yield last;
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = fires(cur, sym);
    if (!t) {
      last = wordStep({ state: cur, tokens, pos: i, note: `No δ(${getState(cur)?.name},'${sym}') — Implicit REJECT`, final: 'reject' });
      yield last;
      return;
    }
    const to = cur = t.to;
    // Formatted only if read — see lazyNoteProto.
    last = wordStep({ state: cur, tokens, pos: i + 1, tid: t.id }, () => `Read '${sym}' → ${getState(to)?.name}`);
    yield last;
  }
  // The word ran out rather than the machine stopping, so the verdict belongs
  // on the step already handed over — see the note in streamTM.
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
}

export function simDFA(tokens) { playEagerly(streamDFA(tokens)); }

// ── the set of states an NFA is in ────────────────────────────────
// A step used to build a Set of state ids from the current Set, then a third
// for its ε-closure: three hashed allocations per step, and every out-edge of
// every current state scanned for the symbol. Here a state is a small integer
// numbered on first sight, the set is a list plus a stamp array (a state is
// in the set when its mark equals the step's stamp, so clearing is one
// increment), and what a state reads on a symbol and where its ε-edges go
// are worked out once per run rather than once per step.
//
// **The set comes out in exactly the order the Set version built it** —
// direct targets in δ's order over the current states, then the ε-closure
// depth first off the end, as epsClosure walks it — because the trace prints
// it: `{q1,q3}` must not become `{q3,q1}`.
class NfaSets {
  constructor() {
    const { eps, any } = App.config.sym;
    this.eps = eps; this.any = any;
    this.num = new Map(); this.ids = [];
    this.direct = []; this.epsOut = [];
    this.mark = new Int32Array(64); this.stamp = 0;
    this.cur = []; this.stack = [];
  }

  no(id) {
    let n = this.num.get(id);
    if (n === undefined) {
      n = this.ids.length;
      this.num.set(id, n);
      this.ids.push(id);
      this.direct.push(null);
      this.epsOut.push(null);
      if (n >= this.mark.length) {
        const grown = new Int32Array(this.mark.length * 2);
        grown.set(this.mark);
        this.mark = grown;
      }
    }
    return n;
  }

  // Where state n goes on `sym` (or on the Σ wildcard), in δ's order.
  targets(n, sym) {
    let bySym = this.direct[n];
    if (bySym === null) bySym = this.direct[n] = new Map();
    let list = bySym.get(sym);
    if (list === undefined) {
      list = [];
      for (const t of transitionsFrom(this.ids[n])) if (t.symbol === sym || t.symbol === this.any) list.push(this.no(t.to));
      bySym.set(sym, list);
    }
    return list;
  }

  epsTargets(n) {
    let list = this.epsOut[n];
    if (list === null) {
      list = [];
      for (const t of transitionsFrom(this.ids[n])) if (t.symbol === this.eps) list.push(this.no(t.to));
      this.epsOut[n] = list;
    }
    return list;
  }

  // Close `next` (already stamped) under ε, appending in epsClosure's order.
  close(next) {
    const stack = this.stack;
    let sp = 0;
    for (let k = 0; k < next.length; k++) stack[sp++] = next[k];
    while (sp > 0) {
      const s = stack[--sp];
      for (const j of this.epsTargets(s)) {
        if (this.mark[j] !== this.stamp) { this.mark[j] = this.stamp; next.push(j); stack[sp++] = j; }
      }
    }
    this.cur = next;
  }

  start(id) {
    this.stamp++;
    const n = this.no(id);
    this.mark[n] = this.stamp;
    this.close([n]);
  }

  step(sym) {
    const cur = this.cur, next = [];
    const stamp = ++this.stamp;
    for (let k = 0; k < cur.length; k++) {
      for (const j of this.targets(cur[k], sym)) {
        if (this.mark[j] !== stamp) { this.mark[j] = stamp; next.push(j); }
      }
    }
    this.close(next);
  }

  stateIds() { return this.cur.map(n => this.ids[n]); }

  accepts() {
    const accepts = App.accepts;
    return this.cur.some(n => accepts.has(this.ids[n]));
  }
}

// ── the branches inside the set ───────────────────────────────────
// The set run above is the right way to *decide* — one set per position, never
// more than |Q| states in it — and it is also why an NFA's trace says nothing
// about branches: the set is their union, and which branch put a state there
// is exactly what a union forgets. This rebuilds that, for the Computation
// Tree card and the canvas's tokens.
//
// A node is a state at a position, and the tree merges the way the set does:
// the first branch to reach a state at a position owns it, and every later one
// is recorded as a leaf that merged into it. Without that an NFA as small as
// {q0 →a q0, q0 →a q1, q1 →a q0} has a Fibonacci number of branches after
// twenty symbols, and the tree would be the one thing on screen that did not
// fit; with it there are at most |Q| live branches per position, which is the
// set, drawn with its history. ε-moves stay at their position, so a level of
// the tree is exactly the ε-closed set the trace prints for that step.
export function buildNfaTree(tokens) {
  const tree = new BranchTree('level');
  const { eps, any } = App.config.sym;
  const root = tree.root(runStartId());
  let level = [root];
  for (let d = 0; d <= tokens.length && level.length && !tree.truncated; d++) {
    const sym = d < tokens.length ? tokens[d] : null;
    const here = new Map(level.map(id => [tree.node(id).state, id]));
    const next = [];
    const there = new Map();
    // `level` grows while it is walked: an ε-child joins the position it is at.
    for (let i = 0; i < level.length && !tree.truncated; i++) {
      const id = level[i];
      const from = tree.node(id).state;
      const kids = [];
      for (const t of transitionsFrom(from)) {
        if (t.symbol === eps) {
          const into = here.get(t.to);
          kids.push({ state: t.to, tid: t.id, depth: d, fresh: into === undefined, into, eps: true });
          if (into === undefined) here.set(t.to, -2);
        } else if (sym !== null && (t.symbol === sym || t.symbol === any)) {
          const into = there.get(t.to);
          kids.push({ state: t.to, tid: t.id, depth: d + 1, fresh: into === undefined, into, eps: false });
          if (into === undefined) there.set(t.to, -2);
        }
      }
      const ids = tree.expand(id, kids);
      kids.forEach((k, j) => {
        if (!k.fresh || ids[j] < 0) return;
        if (k.eps) { here.set(k.state, ids[j]); level.push(ids[j]); } else { there.set(k.state, ids[j]); next.push(ids[j]); }
      });
      // A merge into a sibling from this same expansion was recorded before
      // the sibling had an id; it has one now.
      kids.forEach((k, j) => {
        if (k.into === -2 && ids[j] >= 0) tree.node(ids[j]).into = (k.eps ? here : there).get(k.state) ?? -1;
      });
      if (d === tokens.length && App.accepts.has(from)) tree.accept(id);
    }
    level = next;
  }
  return tree.finish();
}

export function* streamNFA(tokens) {
  const sets = new NfaSets();
  sets.start(runStartId());
  let cur = sets.stateIds();
  let last = wordStep({ states: cur, tokens, pos: 0, note: `Start ε-closure: {${stateNames(cur)}}` });
  if (branchTreesWanted()) attachBranchTree([last], buildNfaTree(tokens));
  yield last;
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    sets.step(sym);
    const now = cur = sets.stateIds();
    last = wordStep({ states: cur, tokens, pos: i + 1 }, () => `Read '${sym}' → {${stateNames(now) || '∅'}}`);
    yield last;
    if (!cur.length) break;
  }
  const acc = sets.accepts();
  if (!last.final) { last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
}

export function simNFA(tokens) { playEagerly(streamNFA(tokens)); }

// ── deciding ──────────────────────────────────────────────────────

export function testDFA(tokens) {
  let cur = runStartId();
  const fires = singleTapeLookup();
  for (const sym of tokens) {
    const t = fires(cur, sym);
    if (!t) return false;
    cur = t.to;
  }
  return App.accepts.has(cur);
}

export function testNFA(tokens) {
  const sets = new NfaSets();
  sets.start(runStartId());
  for (let i = 0; i < tokens.length && sets.cur.length; i++) sets.step(tokens[i]);
  return sets.accepts();
}

// ── the definitions ───────────────────────────────────────────────
// A DFA and an NFA read the same input and carry the same fields; the
// whole of the difference is which of the two runners answers. Spelling
// that out per type is what removed the "and everything else is a DFA"
// branch this used to end in.

const finite = {
  family: 'finite',
  schema: {
    transitionFields: ['from', 'to', 'on'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma']
  },
  formal: { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F'] }
};

defineFamily(finite, {
  'DFA': {
    simulate: simDFA,
    stream: streamDFA,
    deterministicDelta: true,
    // Equality, not overlap: getSingleTapeDeterministicTransition resolves
    // a wildcard against a concrete symbol by specificity, so the two can
    // coexist here and still leave δ single-valued.
    determinism: {
      conflict: (c, editId) => firstIdenticalTransition(c.from, c.symbol, editId),
      say: c => `${App.machine} already has δ(${nameOfState(c.from)}, '${c.symbol}'). Each (state, symbol) pair must be unique.`
    },
    decide: tokens => accepted(testDFA(tokens)),
    formal: { ...finite.formal, delta: () => 'Q × Σ → Q' }
  },
  'NFA': {
    simulate: simNFA,
    stream: streamNFA,
    branches: true,
    decide: tokens => accepted(testNFA(tokens)),
    formal: { ...finite.formal, delta: () => 'Q × Σ → P(Q)' }
  },
  // The ε-NFA runs the same subset construction — simNFA already closes
  // under ε on every step, which is why one runner serves both — and
  // differs only in δ's domain admitting ε.
  'ε-NFA': {
    simulate: simNFA,
    stream: streamNFA,
    branches: true,
    decide: tokens => accepted(testNFA(tokens)),
    formal: { ...finite.formal, delta: () => 'Q × (Σ ∪ {ε}) → P(Q)' }
  }
});
