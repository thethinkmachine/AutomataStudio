// ══════════════════════════════════════════════════════════════════
//  MACHINE RUNTIME — the vocabulary every family runs on
// ══════════════════════════════════════════════════════════════════
// The primitives more than one machine family needs: reading the input
// into symbols, finding the transition that fires, and the loop and
// step-budget bookkeeping the tape machines share.
//
// It is deliberately DOM-free, and that is a load-bearing property rather
// than a tidy one. Everything here is called from inside a *decider* as
// well as from inside a simulator, and the deciders run with no page at
// all: computeBatchResults, the Language panel's fingerprint and
// StateMate's verifyCandidate all depend on it. A single $() in this file
// would take that away from all three at once.

import { App, detectsLoops, getState } from '../state.js';
import { renderSimStep } from './paint.js';
import { pickMostSpecificTransition, symbolsOverlap } from './predicates.js';

// ── running a step source to the end, the old way ─────────────────
// Every streaming simulator has a one-line eager wrapper built on this, so
// `simTM(tokens)` still means what it has always meant: run the whole thing,
// write App.simSteps, paint. The player no longer takes that route — it holds
// a cursor and pulls (see js/machines/run.js) — but the batch deciders' tests,
// StateMate and every direct caller do, and a generator that could only be
// consumed lazily would have broken all of them to buy nothing.
export function playEagerly(source) {
  const iter = typeof source.next === 'function' ? source : source[Symbol.iterator]();
  const steps = [];
  let r = iter.next();
  while (!r.done) { steps.push(r.value); r = iter.next(); }
  App.simSteps = steps;
  App.simIdx = 0;
  renderSimStep();
  // A generator's return value, not a step — the run statistics simNDTM and
  // the explorers answer with. Dropping it here would quietly break every
  // caller that reads one.
  return r.value;
}

// ── reading the input ─────────────────────────────────────────────
// Symbols may be whole words, so a typed string is split on the same
// delimiters Σ accepts before each segment is matched greedily.
export function tokenize(str, sigma = App.sigma) {
  if (str === '' || !str) return [];
  const syms = [...sigma].filter(s => s !== App.config.sym.eps).sort((a, b) => b.length - a.length);
  function bt(segment) {
    function rec(pos) {
      if (pos === segment.length) return [];
      for (const s of syms) {
        if (segment.startsWith(s, pos)) {
          const rest = rec(pos + s.length);
          if (rest !== null) return [s, ...rest];
        }
      }
      return null;
    }
    return rec(0);
  }
  // Symbols are allowed to be whole words (e.g. "officerOpensReview"), so a
  // human-typed test string will naturally separate them with commas/whitespace
  // — the same delimiters used when symbols are added to Σ. Split on those first,
  // falling back to plain concatenation (undelimited backtracking) per segment
  // so single-character alphabets like {0,1} keep working exactly as before.
  const segments = str.split(/[,\s]+/).filter(seg => seg.length > 0);
  if (segments.length === 0) return [];
  const tokens = [];
  for (const segment of segments) {
    const t = bt(segment);
    if (t === null) return null;
    tokens.push(...t);
  }
  return tokens;
}

// ── the ε-closure ─────────────────────────────────────────────────
// Shared rather than owned by finite.js: the algorithms panel, the symbol
// suggester and the CFG conversions all take closures, and none of them is
// running an NFA when it asks.

export function epsClosure(states) {
  const c = new Set(states), stk = [...states];
  const eps = App.config.sym.eps;
  while (stk.length) { const s = stk.pop(); App.transitions.filter(t => t.from === s && t.symbol === eps).forEach(t => { if (!c.has(t.to)) { c.add(t.to); stk.push(t.to); } }); }
  return c;
}

export function stateNames(ids) { return [...ids].map(id => getState(id)?.name || id).join(',') }

// ── the transition that fires ─────────────────────────────────────
// Both resolve to the *most specific* matching edge, so an explicit
// symbol beats the Σ wildcard. Nondeterministic families deliberately do
// not come through here — they take every match instead.

export function getSingleTapeDeterministicTransition(state, sym) {
  const matching = App.transitions.filter(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
  return pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
}

export function getMultiTapeDeterministicTransition(state, syms) {
  const matching = App.transitions.filter(tr => tr.from === state && tr.tapeSyms && tr.tapeSyms.length === syms.length && tr.tapeSyms.every((s, i) => s === syms[i] || s === App.config.sym.any));
  return pickMostSpecificTransition(matching, tr => tr.tapeSyms.reduce((score, s, i) => score + (s === syms[i] ? 1 : 0), 0));
}

// ── tape bookkeeping ──────────────────────────────────────────────

export function normalizeTapeConfig(tape, head) {
  const blank = App.config.sym.blank;
  const normalizedHead = Math.max(0, head);
  const normalizedTape = tape.length ? [...tape] : [blank];
  while (normalizedTape.length <= normalizedHead) normalizedTape.push(blank);
  while (normalizedTape.length > normalizedHead + 1 && normalizedTape[normalizedTape.length - 1] === blank) normalizedTape.pop();
  return { tape: normalizedTape, head: normalizedHead };
}

// ── loop detection for the deterministic tape machines ────────────
// A deterministic machine that revisits a configuration will revisit it
// forever, so playback can stop there and report a *proven* non-halt
// instead of grinding out the step limit and calling it a reject. The
// tracker is capped: a machine whose tape grows without bound never
// repeats anyway, and its keys would grow with it.
export const LOOP_TRACK_MAX = 5000;

export function makeLoopTracker() {
  // The setting acts here and nowhere else, which is what scopes it to
  // playback: makeLoopTracker is used only by simTM, simLBA and simMTM. The
  // batch deciders (testTM3 and friends) keep their own repeat check, because
  // there the repeat *is* the answer — a word nobody is watching run gains
  // nothing from "no verdict" in place of a correct reject.
  if (!detectsLoops()) return { seenAt: () => -1 };

  let seen = new Map();
  return {
    // Step index where this configuration was first seen, or -1 if new.
    seenAt(key, idx) {
      if (!seen) return -1;
      if (seen.has(key)) return seen.get(key);
      seen.set(key, idx);
      if (seen.size > LOOP_TRACK_MAX) seen = null; // bail out rather than grow
      return -1;
    }
  };
}

export function markLoopStep(step, firstIdx) {
  step.final = 'loop';
  step.loopFrom = firstIdx;
  step.note += ` — LOOP: repeats step ${firstIdx}, so this machine never halts on this input`;
}

/**
 * The run reached the step budget.
 *
 * Still running is not the same as rejecting — reporting a timeout as a REJECT
 * is what makes non-halting invisible. And when loop detection is off, say so:
 * otherwise a machine the app could have decided reports "no verdict" with
 * nothing on screen to explain why it did not.
 */
export function markTimeoutStep(step, limit = App.config.maxTmSteps) {
  step.final = 'timeout';
  step.limit = limit;
  step.note += ` — NO VERDICT: still running after ${limit} steps`;
  if (!detectsLoops()) step.note += ', and loop detection is off';
}

export function formatTapeInstantaneousDescription(state, tape, head) {
  const normalized = normalizeTapeConfig(tape, head);
  const stateName = getState(state)?.name || state;
  return `${normalized.tape.slice(0, normalized.head).join('')}[${stateName}]${normalized.tape.slice(normalized.head).join('')}`;
}

// ── the finite-word input ─────────────────────────────────────────
// The run box's text, minus the ε spelling, split into symbols. Every
// family but the ω-automata (which read u(v)) and a comma-separated
// multi-tape run takes exactly this, so it is the default parseInput.
//
// The shape is the one every definition's parseInput returns:
//
//   { ok: true, input, tokens }   input is what simulate/decide take;
//                                 tokens is the flat symbol list the
//                                 canvas highlights against, or null
//                                 when the run has no single one.
//   { ok: false, error }          error is a sentence for the trace log.
//     The caller wraps it — a machine says what went wrong, the player
//     decides what an error looks like.
export function parseWordInput(raw) {
  const str = raw === App.config.sym.eps ? '' : raw;
  const tokens = tokenize(str);
  if (tokens === null) {
    return { ok: false, error: `Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.` };
  }
  return { ok: true, input: tokens, tokens };
}

// The two verdict shapes a decider returns, so no family spells them out.
export function accepted(ok) { return { verdict: ok ? 'acc' : 'rej', output: null }; }
export function transduced(ok, output) { return { verdict: ok ? 'acc' : 'rej', output }; }

// ── the transducers' shared rule ──────────────────────────────────
// Which runs contribute an (input, output) pair to the transduction. With an
// acceptance condition switched on, only accepting runs do — a run that
// consumed the input but halted outside F is not in the relation. Without one
// there is no F to consult, so consuming the input is the whole requirement.
// Shared by every transducer that searches (FST, PDT) so the rule cannot drift
// between them.
export function transducerRunContributes(isComplete, isAccepting) {
  if (!isComplete) return false;
  return !App.config.transducerAccepts || isAccepting;
}

// ── walking a search back to its root ─────────────────────────────
// Every nondeterministic explorer here builds a tree of configurations
// linked by `parent` and then has to hand one branch of it to the step
// builder. The walk is the same for a pushdown store, a two-way head and
// a transducer's output accumulator, because none of it looks at the
// configuration — only at the link.
export function traceSearchPath(cfg) {
  const path = [];
  let cur = cfg;
  while (cur) {
    path.push(cur);
    cur = cur.parent;
  }
  return path.reverse();
}

// ── refusing a second edge ────────────────────────────────────────
// The editor enforces determinism where a second edge for the same read
// is a modelling error rather than a branch. *How* a second edge conflicts
// is the machine's business — exact equality for a DFA, symbol overlap
// wherever the simulator takes every matching edge instead of resolving to
// the most specific one, a whole store configuration for a DPDA — so each
// definition carries its own rule and these are the two shapes most of
// them use.

/** The first edge out of `from` whose read symbol overlaps `symbol`. */
export function firstOverlappingTransition(from, symbol, editId) {
  return App.transitions.find(t => t.id !== editId && t.from === from && symbolsOverlap(t.symbol, symbol)) || null;
}

/** The first edge out of `from` reading exactly `symbol`. */
export function firstIdenticalTransition(from, symbol, editId) {
  return App.transitions.find(t => t.id !== editId && t.from === from && t.symbol === symbol) || null;
}

/** The state's name, for a refusal the reader has to act on. */
export function nameOfState(id) {
  return getState(id)?.name || id;
}

// ── step budgets ──────────────────────────────────────────────────
// The Language panel's per-word budget. Deliberately far smaller than
// maxTmSteps: the fingerprint runs one decision per cell, so this is
// multiplied by ~127. A word that exhausts it is drawn as "no verdict"
// rather than as a reject.
export function langStepBudget() {
  return Math.max(10, App.config.langStepBudget || 400);
}
