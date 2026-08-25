// ══════════════════════════════════════════════════════════════════
//  MACHINE PREDICATES  —  the DOM-free half of the old utils.js
// ══════════════════════════════════════════════════════════════════
// Every function here answers a question about a *machine* — its family,
// the shape of its δ, whether two transitions overlap — by reading nothing
// but `App` and the registry. They used to live in js/utils.js, which is a
// UI module: it imports modal.js, render.js, persistence.js and
// simulation.js, and resolves DOM nodes at module scope.
//
// That mattered for one reason. js/machines/** is meant to be DOM-free, and
// CLAUDE.md said it was "DOM-free except for one call" — but runtime.js
// imported `pickMostSpecificTransition` and `symbolsOverlap` from utils.js,
// so importing the machine layer dragged in canvas.js, which resolves
// #canvas-wrap as it evaluates. The layer could only ever run somewhere
// with a document, which ruled out the one place it most wants to run: a
// worker. Deciding a word needs no document, and now nothing on the path to
// it asks for one.
//
// This module is therefore a leaf in the sense the rest of the app uses the
// word: it imports state.js and machines/registry.js, both of which are
// themselves import-free. Nothing here may import a UI module — that is the
// whole point of the file, and it is what js/parallel/decide.worker.js
// depends on.
//
// js/utils.js re-exports all of it, so every existing call site is unchanged.
import { App, getBoundaryMarkers, isTwoWayFA } from '../state.js';
import { inFamily, machineDef } from './registry.js';

export function buildMarkedInputTape(tokens = []) {
  const { left, right } = getBoundaryMarkers();
  return [left, ...tokens, right];
}

// ── the families ──────────────────────────────────────────────────
// A family is what a set of machines shares an implementation along, so
// the registry is what knows the membership: js/machines/turing.js is
// where the five Turing machines are defined, and listing their names
// again here is how the two drift. Adding LBA to the family module and
// forgetting this line used to give a machine that ran as a Turing
// machine and reported a DFA's tuple.

// Everything with one drawn tape — the Turing machines except MTM, plus
// the two-way heads, which are not Turing machines but are displayed as
// one strip with a head on it.
export function isSingleTapeTM(m = App.machine) {
  return (inFamily(m, 'turing') && !machineDef(m)?.multiTape) || isTwoWayFA(m);
}

export function isAnyTM(m = App.machine) {
  return inFamily(m, 'turing');
}

// Everything with a pushdown store, PDT included: it shares the whole
// configuration machinery (createInitialPdaConfig, getMatchingPdaTransitions,
// applyPdaTransitionConfig) and differs only in accumulating output. The
// narrower isClassicPDA below is what gates the CFG conversions.
export function isAnyPDA(m = App.machine) {
  return inFamily(m, 'pushdown');
}

export function isClassicPDA(m = App.machine) {
  return m === 'DPDA' || m === 'NPDA' || m === 'PDA';
}

export function isCfgConvertiblePDA(m = App.machine) {
  return isClassicPDA(m);
}

export function isQueueAutomaton(m = App.machine) {
  return m === 'QA';
}

export function isCounterMachine(m = App.machine) {
  return m === 'Counter';
}

// What makes a one-counter automaton a counter is not |Γ| = 2. A stack over
// two symbols is an ordinary pushdown stack — any stack alphabet binary-
// encodes into it — so a machine free to write Z wherever it likes reaches
// every context-free language, which is strictly more than the one-counter
// languages this model is supposed to have. The counter is the *height*, and
// the height is only a number while the bottom marker stays at the bottom and
// occurs exactly once. The alphabet check in confirmTrans() says which symbols
// a push may use; this says where they may go.
//
// Returns null, or the clause naming what is wrong with this push. Popping Z
// and pushing nothing is deliberately allowed: under the empty-store paradigm
// that is how a counter machine accepts.
export function counterBottomViolation(pop, push, sym = App.config.sym) {
  const bottom = sym.stackBottom;
  if (!push || push === sym.eps || push === sym.any) return null;
  const s = String(push);
  const marks = [...s].filter(c => c === bottom).length;
  if (marks === 0) return null;
  // A wildcard pop matched something unknown, so it cannot have been Z.
  if (pop !== bottom) return `pushes '${bottom}' without having popped it`;
  if (marks > 1) return `pushes '${bottom}' ${marks} times`;
  if (s.slice(-1) !== bottom) return `pushes '${bottom}' above the counter`;
  return null;
}

export function isTwoStackPDA(m = App.machine) {
  return m === '2PDA';
}

export function isTwoWayNondeterministicFA(m = App.machine) {
  return m === '2NFA';
}

export function isPushdownTransducer(m = App.machine) {
  return m === 'PDT';
}

// Where the emitted symbol lives, asked from both ends. Defined beside the
// schema it reads (js/machines/index.js) and re-exported here, because most
// of the callers are UI modules that already import utils.js — and two
// homes for one predicate is the duplication it was written to remove.

// True when a second edge for the same (state, read) is a modelling error
// rather than a branch, so the editor should refuse it. Nondeterministic
// families (NFA, 2NFA, NPDA, NDTM) are excluded, and so are the two whose
// semantics *are* the multiple edges: a PFA distributes probability across
// them, and an NBA guesses among them.
//
// Each machine declares this for itself, which is what removed the
// ordering trap the answer used to carry: half the ω-automata are
// precisely the single-valued case, so they had to be tested *before* the
// "nondeterministic families are exempt" rule — and a list that has to be
// read in the right order is a list that will eventually be read in the
// wrong one, letting the editor draw an NBA and call it a DBA.
export function hasSingleValuedDelta(m = App.machine) {
  return !!machineDef(m)?.deterministicDelta;
}

export function isTwoWayTransducer(m = App.machine) {
  return m === '2DFT';
}

export function isLBA(m = App.machine) {
  return m === 'LBA';
}

export function isInfiniteTapeTM(m = App.machine) {
  return m === 'ITM';
}

// The first (state, symbol) an ω-automaton's δ sends to two places, or null.
// This is the whole difference between the two Büchi models, so it is worth
// reporting as a pair the caller can name rather than a bare boolean.
// Unlike hasSingleTapeNondeterminism this respects the wildcard, since one
// `any` edge overlaps every concrete symbol out of the same state.
export function findOmegaDeterminismConflict(transitions = App.transitions) {
  for (let i = 0; i < transitions.length; i++) {
    for (let j = i + 1; j < transitions.length; j++) {
      const a = transitions[i], b = transitions[j];
      if (a.from === b.from && symbolsOverlap(a.symbol, b.symbol)) return [a, b];
    }
  }
  return null;
}

export function hasSingleTapeNondeterminism(transitions = App.transitions) {
  const seen = new Set();
  for (const t of transitions) {
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function pdaReadPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

export function pdaPopPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

export function pdaTransitionsOverlap(a, b) {
  return a.from === b.from
    && pdaReadPatternsOverlap(a.symbol, b.symbol)
    && pdaPopPatternsOverlap(a.pop, b.pop);
}

export function symbolsOverlap(a, b, any = App.config.sym.any) {
  return a === b || a === any || b === any;
}

export function tapeTuplesOverlap(aSyms = [], bSyms = [], any = App.config.sym.any) {
  if (!Array.isArray(aSyms) || !Array.isArray(bSyms) || aSyms.length !== bSyms.length) return false;
  return aSyms.every((sym, i) => symbolsOverlap(sym, bSyms[i], any));
}

export function pickMostSpecificTransition(transitions = [], scoreFn = () => 0) {
  let best = null;
  let bestScore = -Infinity;
  for (const transition of transitions) {
    const score = scoreFn(transition);
    if (score > bestScore) {
      best = transition;
      bestScore = score;
      continue;
    }
    if (score === bestScore && best && String(transition.id || '').localeCompare(String(best.id || ''), undefined, { numeric: true }) < 0) {
      best = transition;
    }
  }
  return best;
}

export function findPdaNondeterministicPairs(transitions = App.transitions) {
  const pairs = [];
  for (let i = 0; i < transitions.length; i++) {
    for (let j = i + 1; j < transitions.length; j++) {
      if (pdaTransitionsOverlap(transitions[i], transitions[j])) {
        pairs.push([transitions[i], transitions[j]]);
      }
    }
  }
  return pairs;
}

export function hasPdaNondeterminism(transitions = App.transitions) {
  return findPdaNondeterministicPairs(transitions).length > 0;
}

export function getPdaDeterminismConflict(candidate, transitions = App.transitions, ignoreId = null) {
  return transitions.find(t =>
    t.id !== ignoreId
    && pdaTransitionsOverlap(t, candidate)
  ) || null;
}

// The run box reads `eps`/`epsilon` as the empty word. Here rather than in
// utils.js because the batch path parses input before it ever reaches a DOM.
export function parseEps(str) {
  if (!str) return '';
  const s = str.trim();
  if (s.toLowerCase() === 'eps' || s.toLowerCase() === 'epsilon') return App.config.sym.eps;
  return s;
}
