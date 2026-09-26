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
  // Symbols are allowed to be whole words (e.g. "officerOpensReview"), so a
  // human-typed test string will naturally separate them with commas/whitespace
  // — the same delimiters used when symbols are added to Σ. Split on those first,
  // falling back to plain concatenation (undelimited backtracking) per segment
  // so single-character alphabets like {0,1} keep working exactly as before.
  const segments = str.split(/[,\s]+/).filter(seg => seg.length > 0);
  if (segments.length === 0) return [];
  const tokens = [];
  for (const segment of segments) {
    const t = splitSegment(segment, syms);
    if (t === null) return null;
    for (const s of t) tokens.push(s);
  }
  return tokens;
}

/**
 * One undelimited run of symbols, split the way the old backtracking search
 * split it — at each position, the first symbol in `syms` order (longest
 * first) whose remainder can itself be split.
 *
 * That search recursed once per symbol and built its answer as
 * `[s, ...rest]` on the way back out, so it was quadratic in the word and
 * overflowed the call stack somewhere past ten thousand symbols typed without
 * separators; a thousand symbols already cost more to tokenize than a DFA
 * cost to run on them. The same answer comes from asking the question the
 * recursion was really asking — "can the rest be split from here?" — once
 * per position, right to left, and then walking forward taking the first
 * symbol that leads somewhere splittable. Linear in the word, no recursion,
 * and step for step the choice the search made.
 */
function splitSegment(segment, syms) {
  const n = segment.length;
  const ok = new Uint8Array(n + 1);
  ok[n] = 1;
  const fits = (s, pos) => s.length > 0 && ok[pos + s.length] === 1 && segment.startsWith(s, pos);
  for (let pos = n - 1; pos >= 0; pos--) {
    for (const s of syms) if (fits(s, pos)) { ok[pos] = 1; break; }
  }
  if (!ok[0]) return null;
  const out = [];
  for (let pos = 0; pos < n;) {
    for (const s of syms) {
      if (fits(s, pos)) { out.push(s); pos += s.length; break; }
    }
  }
  return out;
}

// ── the ε-closure ─────────────────────────────────────────────────
// Shared rather than owned by finite.js: the algorithms panel, the symbol
// suggester and the CFG conversions all take closures, and none of them is
// running an NFA when it asks.

export function epsClosure(states) {
  const c = new Set(states), stk = [...states];
  const eps = App.config.sym.eps;
  while (stk.length) {
    const s = stk.pop();
    for (const t of transitionsFrom(s)) if (t.symbol === eps && !c.has(t.to)) { c.add(t.to); stk.push(t.to); }
  }
  return c;
}

export function stateNames(ids) { return [...ids].map(id => getState(id)?.name || id).join(',') }

// ── a breadth-first queue ─────────────────────────────────────────
// Every nondeterministic search in the machine layer is breadth-first, and
// every one of them dequeued with `Array.prototype.shift`, which moves every
// remaining element down by one: O(frontier) per configuration, so a search
// was quadratic in the configurations it touched. This is the same three
// operations — push, shift, length — at amortized O(1): a read index into the
// array, with the consumed prefix dropped once it is most of the array.
export class Fifo {
  constructor(items = []) { this.items = items; this.head = 0; }
  get length() { return this.items.length - this.head; }
  push(item) { this.items.push(item); return this.length; }
  shift() {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head++] = undefined;   // let a consumed configuration go
    if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
}

// ── a set of configurations ───────────────────────────────────────
// A search's visited set used to be a Set of strings, one built per
// configuration — the state, the position and the store run together with
// separators — and hashed on insert. Once the store is an interned node
// (js/machines/step-log.js) every part of a configuration is a small integer,
// so the set holds the integers: five int32s a slot in one typed array, open
// addressing with linear probing. Exact — a slot is compared field by field —
// and it allocates nothing per configuration. The first field is stored plus
// one, so 0 marks an empty slot and a probe touches one array, not two. Each
// slot has room for one integer beside the tuple, which the tape machines'
// repeat check uses for the step it first saw a configuration at.
export class ConfigSet {
  constructor(capacity = 1024) {
    let cap = 16;
    while (cap < capacity * 2) cap *= 2;
    this.cap = cap;
    this.size = 0;
    this.slots = new Int32Array(cap * 6);
  }

  /** Add the tuple; true if it was not already present. `a` ≥ 0, every field an int32. */
  add(a, b, c, d, e) {
    return this.addOrGet(a, b, c, d, e, 0) === -1;
  }

  /**
   * Add the tuple with `value` beside it and answer -1, or — if it is already
   * present — answer the value it was added with. `value` ≥ 0.
   */
  addOrGet(a, b, c, d, e, value) {
    const slots = this.slots, mask = this.cap - 1, a1 = a + 1;
    let o = (configHash(a, b, c, d, e) & mask) * 6;
    while (slots[o] !== 0) {
      if (slots[o] === a1 && slots[o + 1] === b && slots[o + 2] === c && slots[o + 3] === d && slots[o + 4] === e) return slots[o + 5];
      o += 6;
      if (o === slots.length) o = 0;
    }
    slots[o] = a1; slots[o + 1] = b; slots[o + 2] = c; slots[o + 3] = d; slots[o + 4] = e; slots[o + 5] = value;
    if (++this.size * 2 > this.cap) this.grow();
    return -1;
  }

  grow() {
    const old = this.slots;
    this.cap *= 2;
    this.slots = new Int32Array(this.cap * 6);
    this.size = 0;
    for (let o = 0; o < old.length; o += 6) {
      if (old[o] !== 0) this.addOrGet(old[o] - 1, old[o + 1], old[o + 2], old[o + 3], old[o + 4], old[o + 5]);
    }
  }
}

function configHash(a, b, c, d, e) {
  let h = Math.imul(a, 0x9E3779B1) ^ Math.imul(b + 0x7F4A7C15, 0x85EBCA77);
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) ^ Math.imul(c, 0xC2B2AE3D);
  h = Math.imul(h ^ (h >>> 13), 0x297A2D39) ^ Math.imul(d, 0x27D4EB2F) ^ Math.imul(e, 0x165667B1);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * State ids → 0, 1, 2 … in the order a search first meets them, so a state
 * can sit in a ConfigSet. One per search.
 */
export function makeStateNumbering() {
  const ids = new Map();
  return state => {
    let n = ids.get(state);
    if (n === undefined) ids.set(state, n = ids.size);
    return n;
  };
}

// ── δ, indexed by source state ────────────────────────────────────
// **A step asks which transitions leave one state, so that is what is
// indexed.** Every simulator used to find its next move with
// `App.transitions.filter(t => t.from === state && …)` — a scan of the whole
// of δ per step, per branch. That made every machine slower in proportion to
// its size whatever it was doing: a DFA step cost 135ns on 20 transitions and
// 39µs on 10,000, when a DFA step should not know how big the machine is.
//
// `transitionsFrom(state)` answers from a Map built once, in δ's own order, so
// every `filter` that used to run over δ runs over the state's out-edges and
// returns exactly the same list — the same transitions, in the same order,
// which is what keeps a nondeterministic search finding the same branch first.
//
// The key is the source state *only*, and that is what makes the index safe
// to keep. Everything else a step tests — the symbol, the pop, the tape
// symbols, the target — is still read live off the transition object, so
// editing any of those in place cannot make the index stale. What can is
// changing the list (validated below the way `stateIndex` validates App.states:
// the array, its length and its two ends, which every push, filter and
// reassignment in the app changes) or changing a transition's `from` in place.
// Two places do the second — the edit dialog and "reverse edges", both in
// js/states-transitions.js — and they call `invalidateTransitionIndex()`.

const NO_TRANSITIONS = Object.freeze([]);
let _tIdx = null, _tArr = null, _tLen = -1, _tFirst = null, _tLast = null;

function transitionIndex() {
  const arr = App.transitions || NO_TRANSITIONS;
  const n = arr.length;
  if (_tArr === arr && _tLen === n && _tFirst === arr[0] && _tLast === arr[n - 1]) return _tIdx;
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const t = arr[i];
    const list = map.get(t.from);
    if (list) list.push(t); else map.set(t.from, [t]);
  }
  _tIdx = map; _tArr = arr; _tLen = n; _tFirst = arr[0]; _tLast = arr[n - 1];
  return map;
}

/**
 * The transitions leaving `state`, in δ's order. Read-only: the array is the
 * index's own, so filter it rather than mutating it.
 */
export function transitionsFrom(state) {
  return transitionIndex().get(state) || NO_TRANSITIONS;
}

/** A transition's `from` was changed in place; rebuild on the next lookup. */
export function invalidateTransitionIndex() {
  _tArr = null;
}

// ── the transition that fires ─────────────────────────────────────
// Both resolve to the *most specific* matching edge, so an explicit
// symbol beats the Σ wildcard. Nondeterministic families deliberately do
// not come through here — they take every match instead.

export function getSingleTapeDeterministicTransition(state, sym) {
  const any = App.config.sym.any;
  const matching = transitionsFrom(state).filter(tr => tr.symbol === sym || tr.symbol === any);
  return pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
}

export function getMultiTapeDeterministicTransition(state, syms) {
  const any = App.config.sym.any;
  const matching = transitionsFrom(state).filter(tr => tr.tapeSyms && tr.tapeSyms.length === syms.length && tr.tapeSyms.every((s, i) => s === syms[i] || s === any));
  return pickMostSpecificTransition(matching, tr => tr.tapeSyms.reduce((score, s, i) => score + (s === syms[i] ? 1 : 0), 0));
}

// ── the same, remembered for one run ──────────────────────────────
// Which transition fires depends on the state and what is read, and a run
// asks about the same few pairs over and over: a Turing machine sweeping its
// tape asks the same (state, symbol) thousands of times. Resolving each pair
// once — the filter over the state's edges, the specificity tie-break — and
// remembering it for the rest of the run makes a step two Map lookups however
// many edges leave the state. Per run and never kept, because δ can be edited
// in place between runs and nothing announces it (see transitionIndex).

/**
 * getSingleTapeDeterministicTransition, remembered per state.
 *
 * The first time a run is in a state, the state's edges are read once into a
 * row: for each symbol the edge that would win on it, and the Σ-wildcard edge
 * that wins on anything else. After that a step is two Map lookups however
 * many edges leave the state and however many of its symbols the run has not
 * met yet — resolving per (state, symbol) instead would still scan a state
 * with two hundred edges once per symbol it reads.
 *
 * The row is the same answer getSingleTapeDeterministicTransition gives: an
 * explicit symbol beats the wildcard, and among equals the lower id wins, by
 * the comparison pickMostSpecificTransition makes.
 */
export function singleTapeLookup() {
  const any = App.config.sym.any;
  const rows = new Map();
  return (state, sym) => {
    let row = rows.get(state);
    if (row === undefined) rows.set(state, row = singleTapeRow(state, any));
    const t = row.bySymbol.get(sym);
    return t !== undefined ? t : row.wildcard;
  };
}

// Rows outlive a run, but only on proof. A row is filed under the out-edge
// list it was read from — the index's own array, which is never mutated and is
// replaced whenever δ is — and it remembers each edge's symbol and id. Reusing
// it checks those against the edges as they are now, which catches an edge
// edited in place with nothing announcing it: a comparison per edge, where
// building the row is a Map write per edge. A replaced index takes its rows
// with it (a WeakMap).
const rowCache = new WeakMap();

function singleTapeRow(state, any) {
  const edges = transitionsFrom(state);
  const kept = rowCache.get(edges);
  if (kept !== undefined && rowStillHolds(kept, edges, any)) return kept;
  const bySymbol = new Map();
  let wildcard = null;
  const syms = new Array(edges.length), ids = new Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const t = edges[i];
    syms[i] = t.symbol; ids[i] = t.id;
    if (t.symbol === any) wildcard = lowerIdOf(wildcard, t);
    else bySymbol.set(t.symbol, lowerIdOf(bySymbol.get(t.symbol) ?? null, t));
  }
  const row = { bySymbol, wildcard, any, syms, ids };
  rowCache.set(edges, row);
  return row;
}

function rowStillHolds(row, edges, any) {
  if (row.any !== any) return false;
  const { syms, ids } = row;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].symbol !== syms[i] || edges[i].id !== ids[i]) return false;
  }
  return true;
}

// pickMostSpecificTransition's tie-break between two equally specific edges,
// `best` having come first in δ.
function lowerIdOf(best, t) {
  if (best === null) return t;
  return String(t.id || '').localeCompare(String(best.id || ''), undefined, { numeric: true }) < 0 ? t : best;
}

/** getMultiTapeDeterministicTransition, remembered per (state, symbols read). */
export function multiTapeLookup() {
  const rows = new Map();
  return (state, syms) => {
    let row = rows.get(state);
    if (row === undefined) rows.set(state, row = new Map());
    const k = syms.length === 1 ? syms[0] : syms.join('\u0001');
    let t = row.get(k);
    if (t === undefined) row.set(k, t = getMultiTapeDeterministicTransition(state, syms));
    return t;
  };
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
  if (!detectsLoops()) return { seenAt: () => -1, seenAtVerified: () => -1 };

  let seen = new Map();
  let fps = makeFingerprintTable();
  return {
    // Step index where this configuration was first seen, or -1 if new.
    seenAt(key, idx) {
      if (!seen) return -1;
      if (seen.has(key)) return seen.get(key);
      seen.set(key, idx);
      if (seen.size > LOOP_TRACK_MAX) seen = null; // bail out rather than grow
      return -1;
    },
    // The same, keyed by a fingerprint (Tape#fingerprintParts) rather than
    // the configuration itself, which costs O(1) a step where a key costs the
    // tape. A fingerprint match is a candidate: `same(j)` confirms that step
    // j really held this configuration before it is reported as a loop.
    seenAtVerified(state, off, h1, h2, idx, same) {
      if (!fps) return -1;
      const at = fps.check(state, off, h1, h2, idx, same);
      if (fps.size > LOOP_TRACK_MAX) fps = null;
      return at;
    }
  };
}

/**
 * A table of fingerprinted configurations, confirming every match.
 *
 * `check(state, off, h1, h2, step, same)` records the configuration at
 * `step` and answers -1, or — if an earlier step had the same fingerprint and
 * `same(j)` confirms it held the same configuration — that step. The state is
 * numbered and the fingerprint is three integers, so a step costs one probe
 * of a typed table and no string. Two configurations with one fingerprint
 * (which the double hash makes vanishingly rare) are kept apart in a Map
 * beside the table rather than trusted.
 */
export function makeFingerprintTable() {
  const table = new ConfigSet();
  const stateNo = makeStateNumbering();
  let clashes = null;
  return {
    get size() { return table.size; },
    check(state, off, h1, h2, step, same) {
      const s = stateNo(state);
      const first = table.addOrGet(s, off, h1, h2, 0, step);
      if (first < 0) return -1;
      if (same(first)) return first;
      const k = `${s},${off},${h1},${h2}`;
      clashes ??= new Map();
      const list = clashes.get(k);
      if (!list) { clashes.set(k, [step]); return -1; }
      for (const j of list) if (same(j)) return j;
      list.push(step);
      return -1;
    }
  };
}

/**
 * Exact repeat detection for a deterministic decider, keyed by fingerprint.
 *
 * `keyAt(j)` rebuilds step j's configuration key (by replaying the run — a
 * deterministic machine reaches step j the same way twice) and is asked only
 * when a fingerprint recurs, which for a machine that loops is once and for
 * one that does not is, in practice, never. So a verdict of "repeats" is the
 * one the key-per-step check reached, and the price per step is a hash.
 */
export function makeRepeatDetector(keyAt, keyNow) {
  const table = makeFingerprintTable();
  let now = null;
  const same = j => keyAt(j) === (now ??= keyNow());
  return (state, off, h1, h2, step) => {
    now = null;
    return table.check(state, off, h1, h2, step, same) >= 0;
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
