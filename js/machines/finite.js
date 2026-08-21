// ══════════════════════════════════════════════════════════════════
//  FINITE AUTOMATA — DFA, NFA, ε-NFA
// ══════════════════════════════════════════════════════════════════
// One state, one symbol, one move. The three types differ in exactly two
// places and nowhere else: whether δ is single-valued, and whether ε is a
// symbol δ may read. Everything they share — reading the most specific
// matching edge, the accepting test at the end — lives in runtime.js
// because the tape machines and the transducers share it too.

import { App } from '../state.js';
import { renderSimStep } from '../simulation.js';
import { getState } from '../states-transitions.js';
import { accepted, epsClosure, firstIdenticalTransition, getSingleTapeDeterministicTransition, nameOfState, stateNames } from './runtime.js';
import { defineFamily } from './registry.js';

export function simDFA(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  App.simSteps.push({ state: cur, tokens, remaining: tokens, note: `Start: ${getState(cur)?.name || '?'}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) { App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i), note: `No δ(${getState(cur)?.name},'${sym}') — Implicit REJECT`, final: 'reject' }); break; }
    cur = t.to;
    App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i + 1), note: `Read '${sym}' → ${getState(cur)?.name}`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

export function simNFA(tokens) {
  App.simSteps = [];
  let cur = epsClosure(new Set([App.startId]));
  App.simSteps.push({ states: [...cur], tokens, remaining: tokens, note: `Start ε-closure: {${stateNames(cur)}}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i]; let nx = new Set();
    cur.forEach(sid => App.transitions.filter(t => t.from === sid && (t.symbol === sym || t.symbol === App.config.sym.any)).forEach(t => nx.add(t.to)));
    nx = epsClosure(nx);
    cur = nx;
    App.simSteps.push({ states: [...cur], tokens, remaining: tokens.slice(i + 1), note: `Read '${sym}' → {${stateNames(cur) || '∅'}}` });
    if (!cur.size) break;
  }
  const last = App.simSteps[App.simSteps.length - 1];
  const acc = [...cur].some(id => App.accepts.has(id));
  if (!last.final) { last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

// ── deciding ──────────────────────────────────────────────────────

export function testDFA(tokens) {
  let cur = App.startId;
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) return false;
    cur = t.to;
  }
  return App.accepts.has(cur);
}

export function testNFA(tokens) {
  let cur = epsClosure(new Set([App.startId]));
  const any = App.config.sym.any;
  for (const sym of tokens) {
    let nx = new Set();
    cur.forEach(s => App.transitions.filter(t => t.from === s && (t.symbol === sym || t.symbol === any)).forEach(t => nx.add(t.to)));
    cur = epsClosure(nx);
  }
  return [...cur].some(id => App.accepts.has(id));
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
    decide: tokens => accepted(testNFA(tokens)),
    formal: { ...finite.formal, delta: () => 'Q × Σ → P(Q)' }
  },
  // The ε-NFA runs the same subset construction — simNFA already closes
  // under ε on every step, which is why one runner serves both — and
  // differs only in δ's domain admitting ε.
  'ε-NFA': {
    simulate: simNFA,
    decide: tokens => accepted(testNFA(tokens)),
    formal: { ...finite.formal, delta: () => 'Q × (Σ ∪ {ε}) → P(Q)' }
  }
});
