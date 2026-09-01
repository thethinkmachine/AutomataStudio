// ══════════════════════════════════════════════════════════════════
//  PROBABILISTIC FINITE AUTOMATON
// ══════════════════════════════════════════════════════════════════
// The one family whose configuration is not a state, or even a set of
// them, but a distribution over Q. Each edge carries a probability, a
// step is a matrix-vector product, and acceptance is Rabin's cut-point
// rule: w ∈ L(M) iff the mass on F strictly exceeds λ.
//
// That is why it cannot borrow the NFA's runner despite drawing the same
// diagram — the NFA asks whether *some* branch accepts, which is this
// machine with λ = 0 and every weight rounded up to 1.

import { App, getState } from '../state.js';
import { renderSimStep } from './paint.js';
import { accepted } from './runtime.js';
import { defineMachine } from './registry.js';
import { wordStep } from './step-log.js';

// A PFA run is a distribution over Q, not a state, so the simulator is the
// forward algorithm rather than a search: one vector per input position, each
// obtained from the last by a single stochastic matrix multiply. That makes it
// exact and linear — there is nothing to explore and no step budget to exhaust.
export function pfaWeight(t) {
  const w = Number(t.weight);
  return Number.isFinite(w) ? w : 1;
}

export function formatProbability(p) {
  if (!Number.isFinite(p)) return '0';
  if (Number.isInteger(p)) return String(p);
  return String(Number(p.toFixed(4)));
}

export function pfaStepDistribution(dist, sym) {
  const any = App.config.sym.any;
  const next = new Map();
  for (const [q, p] of dist) {
    if (!p) continue;
    for (const t of App.transitions) {
      if (t.from !== q) continue;
      if (t.symbol !== sym && t.symbol !== any) continue;
      const w = pfaWeight(t);
      if (!w) continue;
      next.set(t.to, (next.get(t.to) || 0) + p * w);
    }
  }
  return next;
}

export function pfaAcceptMass(dist) {
  let sum = 0;
  for (const [q, p] of dist) if (App.accepts.has(q)) sum += p;
  return sum;
}

export function runPFA(tokens) {
  const dists = [new Map([[App.startId, 1]])];
  for (const sym of tokens) dists.push(pfaStepDistribution(dists[dists.length - 1], sym));
  return dists;
}

// Rabin's cut-point rule, strictly: w ∈ L(M) iff P(w) > λ.
export function testPFA(tokens) {
  const dists = runPFA(tokens);
  return pfaAcceptMass(dists[dists.length - 1]) > App.config.pfaCutPoint;
}

export function pfaDistributionCells(dist) {
  return [...dist.entries()]
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([q, p]) => `${getState(q)?.name || q}:${formatProbability(p)}`);
}

// Every (state, symbol) row of a PFA's matrix must be a distribution. A row
// that does not sum to 1 is a modelling slip the editor cannot catch per-edge,
// so it is surfaced here rather than silently renormalised.
export function pfaMalformedRows() {
  const rows = new Map();
  for (const t of App.transitions) {
    const key = `${t.from}|${t.symbol}`;
    rows.set(key, (rows.get(key) || 0) + pfaWeight(t));
  }
  const bad = [];
  for (const [key, total] of rows) {
    if (Math.abs(total - 1) > 1e-9) {
      const [from, sym] = key.split('|');
      bad.push({ from, symbol: sym, total });
    }
  }
  return bad;
}

export function simPFA(tokens) {
  App.simSteps = [];
  const cut = App.config.pfaCutPoint;
  const dists = runPFA(tokens);
  dists.forEach((dist, i) => {
    const cells = pfaDistributionCells(dist);
    App.simSteps.push(wordStep({
      states: [...dist.keys()].filter(q => dist.get(q) > 0),
      tokens,
      pos: i,
      dist: cells,
      accMass: pfaAcceptMass(dist),
      note: i === 0
        ? `Start: all probability on ${getState(App.startId)?.name || App.startId}`
        : `Read '${tokens[i - 1]}' → ${cells.length ? cells.join('  ') : 'total mass 0 — the run has died'}`
    }));
  });

  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    const accepted = last.accMass > cut;
    last.final = accepted ? 'accept' : 'reject';
    last.note += ` | P(accept) = ${formatProbability(last.accMass)} ${accepted ? '>' : '≤'} λ = ${formatProbability(cut)} — ${accepted ? 'ACCEPT' : 'REJECT'}`;
  }
  const malformed = pfaMalformedRows();
  if (last && malformed.length) {
    last.note += ` | ⚠ ${malformed.length} (state, symbol) row${malformed.length > 1 ? 's do' : ' does'} not sum to 1`;
  }
  App.simIdx = 0;
  renderSimStep();
  return { accepted: last ? last.final === 'accept' : false, mass: last?.accMass ?? 0, malformed };
}

// ── the definition ────────────────────────────────────────────────

defineMachine('PFA', {
  family: 'weighted',
  // The cut-point λ: acceptance is P(w) > λ, so it is part of the machine
  // rather than a display preference.
  options: ['cutPoint'],
  simulate: simPFA,
  decide: tokens => accepted(testPFA(tokens)),
  schema: {
    transitionFields: ['from', 'to', 'on', 'weight'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma']
  },
  formal: {
    // The last slot is the cut-point, not an output function — see the λ
    // case in langTupleInfo, which is the one place that has to know the
    // difference between this λ and a transducer's.
    tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F', 'λ'],
    delta: () => 'Q × Σ × Q → [0, 1]',
    // λ here is the cut-point, not an output function — the one machine
    // whose tuple reuses that letter for something else.
    cutPoint: true
  }
});
