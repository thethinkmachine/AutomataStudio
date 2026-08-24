// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — THE LINTER
// ══════════════════════════════════════════════════════════════════
//  Everything a language model gets wrong about automata that JSON
//  validity will not catch. A schema can say "this transition has a
//  `pop` field"; only this can say "this DPDA is not deterministic".
//
//  Three severities, and the split is what keeps the feature cheap:
//
//    fix     unambiguous, so it is fixed locally and reported. Extending Σ
//            with a symbol the machine plainly reads costs nothing and is
//            never what the user wanted to be told about instead.
//    repair  a real modelling error with no single right answer. Costs one
//            model round trip.
//    warn    true, worth saying, and possibly deliberate. Never blocks.
//
//  Everything here operates on the candidate it is handed. It never reads
//  App.states or App.transitions, so it can be run against a machine that
//  is not — and may never be — on the canvas.

import {
  App, getMachineConfig, isOmegaAutomaton, isTwoWayFA, usesParityPriorities
} from './state.js';
import {
  counterBottomViolation, hasSingleValuedDelta, isAnyPDA, isAnyTM,
  isCounterMachine, pdaTransitionsOverlap, symbolsOverlap, tapeTuplesOverlap
} from './utils.js';

/** @returns {{rule: string, severity: string, message: string}} */
function finding(rule, severity, message) {
  return { rule, severity, message };
}

// ══════════════════════════════════════════════════════════════════
//  DETERMINISM
// ══════════════════════════════════════════════════════════════════
//  The single most common thing a model gets wrong: a DFA with two edges
//  out of one state on the same letter. The test is overlap rather than
//  equality, because a wildcard edge overlaps every concrete symbol out of
//  the same state — the same test states-transitions.js applies in the
//  editor.

function findDeterminismConflict(candidate) {
  const m = candidate.machine;
  const ts = candidate.transitions || [];

  if (isAnyPDA(m)) {
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (pdaTransitionsOverlap(ts[i], ts[j])) return [ts[i], ts[j]];
      }
    }
    return null;
  }

  if (m === 'MTM') {
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (ts[i].from === ts[j].from && tapeTuplesOverlap(ts[i].tapeSyms, ts[j].tapeSyms)) {
          return [ts[i], ts[j]];
        }
      }
    }
    return null;
  }

  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      if (ts[i].from === ts[j].from && symbolsOverlap(ts[i].symbol, ts[j].symbol)) {
        return [ts[i], ts[j]];
      }
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  REACHABILITY
// ══════════════════════════════════════════════════════════════════

function reachableFrom(candidate, startId) {
  const out = new Map();
  (candidate.states || []).forEach(s => out.set(s.id, []));
  (candidate.transitions || []).forEach(t => out.get(t.from)?.push(t.to));

  const seen = new Set();
  const stack = startId ? [startId] : [];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    (out.get(id) || []).forEach(next => { if (!seen.has(next)) stack.push(next); });
  }
  return seen;
}

function canReachAccepting(candidate) {
  const back = new Map();
  (candidate.states || []).forEach(s => back.set(s.id, []));
  (candidate.transitions || []).forEach(t => back.get(t.to)?.push(t.from));

  const seen = new Set();
  const stack = [...(candidate.accepts || [])];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    (back.get(id) || []).forEach(prev => { if (!seen.has(prev)) stack.push(prev); });
  }
  return seen;
}

// Tarjan, iterative — a weak automaton's defining property is that no SCC
// straddles F, and reporting the straddling component by name is far more
// useful than reporting that the machine "is not weak".
function stronglyConnectedComponents(candidate) {
  const succ = new Map();
  (candidate.states || []).forEach(s => succ.set(s.id, []));
  (candidate.transitions || []).forEach(t => succ.get(t.from)?.push(t.to));

  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [];
  const comps = [];
  let counter = 0;

  for (const s of candidate.states || []) {
    if (index.has(s.id)) continue;
    const work = [{ id: s.id, edge: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const { id } = frame;
      if (frame.edge === 0) {
        index.set(id, counter); low.set(id, counter); counter++;
        stack.push(id); onStack.add(id);
      }
      const edges = succ.get(id) || [];
      if (frame.edge < edges.length) {
        const next = edges[frame.edge++];
        if (!index.has(next)) work.push({ id: next, edge: 0 });
        else if (onStack.has(next)) low.set(id, Math.min(low.get(id), index.get(next)));
        continue;
      }
      if (low.get(id) === index.get(id)) {
        const comp = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          comp.push(popped);
        } while (popped !== id);
        comps.push(comp);
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent), low.get(id)));
      }
    }
  }
  return comps;
}

// ══════════════════════════════════════════════════════════════════
//  THE PASS
// ══════════════════════════════════════════════════════════════════

/**
 * Lint a candidate, applying the unambiguous fixes in place.
 *
 * @param {object} candidate a workspace-shaped machine (mutated by 'fix' rules)
 * @returns {{findings: Array, fatal: Array, fixed: Array, warnings: Array}}
 */
export function lintCandidate(candidate) {
  const findings = [];
  const m = candidate.machine;
  const cfg = getMachineConfig(m);
  const sym = App.config.sym;
  const states = candidate.states || [];
  const transitions = candidate.transitions || [];
  const nameOf = id => states.find(s => s.id === id)?.name || id;

  // ── start state ──────────────────────────────────────────────
  if (!candidate.startId || !states.some(s => s.id === candidate.startId)) {
    if (states.length) {
      candidate.startId = states[0].id;
      findings.push(finding('start-missing', 'fix', `No start state was marked — using "${states[0].name}".`));
    } else {
      findings.push(finding('no-states', 'repair', 'The machine has no states.'));
    }
  }

  // ── end markers ──────────────────────────────────────────────
  // An endmarked machine reads ⊢ and ⊣ from the tape, never from Σ. A model
  // that put them in the input alphabet has made a category error that would
  // otherwise show up as a mysterious extra chip in the Σ panel.
  if (cfg.hasEndMarkers) {
    const markers = [sym.leftMarker, sym.rightMarker];
    const strayed = (candidate.sigma || []).filter(s => markers.includes(s));
    if (strayed.length) {
      candidate.sigma = candidate.sigma.filter(s => !markers.includes(s));
      findings.push(finding('markers-in-sigma', 'fix', `Removed the end markers ${strayed.join(' ')} from Σ — they belong to the tape.`));
    }
    if (m === 'LBA') {
      const stack = new Set(candidate.stackAlpha || []);
      if (!markers.every(mk => stack.has(mk))) {
        candidate.stackAlpha = [sym.leftMarker, ...[...stack].filter(s => !markers.includes(s)), sym.rightMarker];
        findings.push(finding('markers-missing', 'fix', 'Added the end markers to Γ — an LBA tape is bounded by them.'));
      }
    }
  }

  // ── alphabet closure ─────────────────────────────────────────
  const sigma = new Set(candidate.sigma || []);
  const readSymbols = new Set();
  transitions.forEach(t => {
    if (m === 'MTM') (t.tapeSyms || []).forEach(s => readSymbols.add(s));
    else if (t.symbol !== undefined) readSymbols.add(t.symbol);
  });

  const specialReads = new Set([sym.eps, sym.any, sym.blank, sym.leftMarker, sym.rightMarker]);
  const missingSigma = [...readSymbols].filter(s => !sigma.has(s) && !specialReads.has(s) && s !== '');
  if (missingSigma.length) {
    // Only genuine input symbols go into Σ. On a tape machine most reads are
    // tape symbols, and those are handled by the Γ rule below.
    const target = cfg.hasTape ? 'stackAlpha' : 'sigma';
    if (target === 'sigma') {
      candidate.sigma = [...sigma, ...missingSigma];
      findings.push(finding('sigma-extended', 'fix', `Extended Σ with ${missingSigma.map(s => `"${s}"`).join(', ')} — the machine reads them.`));
    }
  }

  if (cfg.hasStack) {
    const gamma = new Set(candidate.stackAlpha || []);
    const need = new Set();
    transitions.forEach(t => {
      [t.pop, t.pop2].forEach(s => { if (s && s !== sym.eps && s !== sym.any) need.add(s); });
      [t.push, t.push2].forEach(s => {
        if (!s || s === sym.eps) return;
        // Push is written symbol-by-symbol, so a multi-character push is a
        // string of stack symbols rather than one of them.
        String(s).split('').forEach(ch => need.add(ch));
      });
      if (t.write !== undefined && t.write !== sym.eps) need.add(t.write);
      (t.tapeWrites || []).forEach(s => { if (s) need.add(s); });
      if (cfg.hasTape && t.symbol !== undefined) need.add(t.symbol);
      (t.tapeSyms || []).forEach(s => { if (s) need.add(s); });
    });
    // On a tape machine Σ ⊆ Γ by definition; on a stack machine the two are
    // independent and the input alphabet must not leak into Γ.
    if (cfg.hasTape) (candidate.sigma || []).forEach(s => need.add(s));
    need.add(sym.blank);

    const added = [...need].filter(s => !gamma.has(s) && s !== sym.any && s !== '' && s !== undefined);
    if (added.length) {
      candidate.stackAlpha = [...gamma, ...added];
      const label = cfg.hasTape ? 'Γ (tape)' : 'Γ (stack)';
      findings.push(finding('gamma-extended', 'fix', `Extended ${label} with ${added.map(s => `"${s}"`).join(', ')}.`));
    }
  }

  // ── the counter's bottom marker ──────────────────────────────
  // Γ is pinned to two symbols for this machine, and that alone constrains
  // nothing: an unconstrained two-symbol stack is a full pushdown store. The
  // counter is the height, so Z has to stay underneath it — see
  // counterBottomViolation(). A candidate that buries it has built an NPDA
  // and called it a counter, which the verdicts will not reveal.
  if (isCounterMachine(m)) {
    let offender = null, reason = null;
    for (const t of transitions) {
      reason = counterBottomViolation(t.pop, t.push, sym);
      if (reason) { offender = t; break; }
    }
    if (offender) {
      findings.push(finding('counter-bottom', 'warn',
        `The transition ${nameOf(offender.from)} → ${nameOf(offender.to)} ${reason}, so the store stops being a counter.` +
        ` Keep "${sym.stackBottom}" at the bottom and count with the other symbol.`));
    }
  }

  // ── epsilon legality ─────────────────────────────────────────
  if (!cfg.hasEpsilon) {
    const offenders = transitions.filter(t => t.symbol === sym.eps);
    if (offenders.length) {
      findings.push(finding(
        'epsilon-illegal', 'repair',
        `${m} has no ε-transitions, but ${offenders.length} transition${offenders.length === 1 ? ' reads' : 's read'} ε` +
        ` (e.g. ${nameOf(offenders[0].from)} → ${nameOf(offenders[0].to)}).`
      ));
    }
  }

  // ── head moves ───────────────────────────────────────────────
  if (isAnyTM(m) || isTwoWayFA(m)) {
    const legal = new Set(['L', 'R', 'S']);
    if (m === 'MTM') {
      const bad = transitions.find(t => !Array.isArray(t.tapeDirs) || t.tapeDirs.some(d => !legal.has(d)));
      if (bad) findings.push(finding('bad-move', 'repair', `A transition has a head move that is not L, R or S.`));
      const arity = transitions.find(t =>
        (t.tapeSyms || []).length !== (candidate.tapeCount || 2) ||
        (t.tapeWrites || []).length !== (candidate.tapeCount || 2) ||
        (t.tapeDirs || []).length !== (candidate.tapeCount || 2));
      if (arity) {
        findings.push(finding('tape-arity', 'repair', `A transition does not describe all ${candidate.tapeCount || 2} tapes.`));
      }
    } else {
      const missing = transitions.filter(t => !legal.has(t.dir));
      if (missing.length) {
        // A default of Right is a guess, and a guess about which way the head
        // goes changes the language. This one is worth a round trip.
        findings.push(finding('bad-move', 'repair',
          `${missing.length} transition${missing.length === 1 ? ' has' : 's have'} no valid head move (L, R or S).`));
      }
    }
  }

  // ── determinism ──────────────────────────────────────────────
  if (hasSingleValuedDelta(m)) {
    const conflict = findDeterminismConflict(candidate);
    if (conflict) {
      const [a, b] = conflict;
      findings.push(finding('nondeterministic', 'repair',
        `${m} must be deterministic, but state "${nameOf(a.from)}" has two transitions that both apply on "${a.symbol}"` +
        ` (to "${nameOf(a.to)}" and "${nameOf(b.to)}").`));
    }
  }

  // ── probabilities ────────────────────────────────────────────
  if (cfg.isWeighted) {
    const groups = new Map();
    transitions.forEach(t => {
      const key = `${t.from}|${t.symbol}`;
      groups.set(key, (groups.get(key) || 0) + (Number(t.weight) || 0));
    });
    const off = [...groups.entries()].filter(([, sum]) => Math.abs(sum - 1) > 1e-6);
    const wild = off.filter(([, sum]) => Math.abs(sum - 1) > 0.02);
    if (wild.length) {
      const [key, sum] = wild[0];
      findings.push(finding('weights', 'warn',
        `Probabilities out of "${nameOf(key.split('|')[0])}" on "${key.split('|')[1]}" sum to ${sum.toFixed(3)}, not 1.`));
    } else if (off.length) {
      // Within rounding: normalising is safe and saves a round trip.
      off.forEach(([key, sum]) => {
        transitions.filter(t => `${t.from}|${t.symbol}` === key)
          .forEach(t => { t.weight = (Number(t.weight) || 0) / sum; });
      });
      findings.push(finding('weights', 'fix', 'Normalised transition probabilities that were a rounding error away from 1.'));
    }
  }

  // ── ω conditions ─────────────────────────────────────────────
  if (isOmegaAutomaton(m)) {
    if (usesParityPriorities(m)) {
      const priorities = new Set(states.map(s => s.priority ?? 0));
      if (priorities.size === 1) {
        findings.push(finding('parity-flat', 'warn',
          `Every state has priority ${[...priorities][0]}, so the acceptance condition is trivial.`));
      }
    } else if (!(candidate.accepts || []).length) {
      findings.push(finding('no-accepts', 'warn', 'No accepting states — this machine accepts nothing.'));
    }

    if (cfg.omegaCondition === 'weak') {
      const acc = new Set(candidate.accepts || []);
      const straddling = stronglyConnectedComponents(candidate)
        .filter(comp => comp.length > 1 || (candidate.transitions || []).some(t => t.from === comp[0] && t.to === comp[0]))
        .find(comp => comp.some(id => acc.has(id)) && comp.some(id => !acc.has(id)));
      if (straddling) {
        findings.push(finding('weak-violation', 'warn',
          `A cycle through ${straddling.slice(0, 3).map(nameOf).map(n => `"${n}"`).join(', ')} is partly accepting and partly not,` +
          ` which a weak automaton does not allow.`));
      }
    }
  } else if (!cfg.isTransducer && !(candidate.accepts || []).length) {
    findings.push(finding('no-accepts', 'warn', 'No accepting states — this machine accepts nothing.'));
  }

  // ── reachability ─────────────────────────────────────────────
  const live = reachableFrom(candidate, candidate.startId);
  const unreachable = states.filter(s => !live.has(s.id));
  if (unreachable.length) {
    findings.push(finding('unreachable', 'warn',
      `${unreachable.length === 1 ? 'State' : 'States'} ${unreachable.slice(0, 4).map(s => `"${s.name}"`).join(', ')}` +
      `${unreachable.length > 4 ? ` and ${unreachable.length - 4} more` : ''} cannot be reached from the start state.`));
  }

  if (!cfg.isTransducer && !isOmegaAutomaton(m) && (candidate.accepts || []).length) {
    const productive = canReachAccepting(candidate);
    const dead = states.filter(s => live.has(s.id) && !productive.has(s.id));
    // A single trap state is a deliberate and common construction; several are
    // usually an oversight, and either way this only ever warns.
    if (dead.length > 1) {
      findings.push(finding('dead-states', 'warn',
        `${dead.length} states can never reach an accepting state.`));
    }
  }

  return {
    findings,
    fatal: findings.filter(f => f.severity === 'repair'),
    fixed: findings.filter(f => f.severity === 'fix'),
    warnings: findings.filter(f => f.severity === 'warn')
  };
}
