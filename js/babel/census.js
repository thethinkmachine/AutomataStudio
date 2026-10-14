// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WHAT A VOLUME SAYS, FOR THE MAP
// ══════════════════════════════════════════════════════════════════
// One short answer per volume, cheap enough to ask of thousands: the colour
// of its cell on the room's map. What the answer is depends on the wing:
//
//   fa      the class of its language — ∅, Σ*, finite, cofinite, other —
//           exact, from facts.js
//   omega   whether its ω-language is empty, from its lasso cycles — exact
//   tm      whether it halts from a blank tape — halts, never, or unknown —
//           from the classifier the Behaviour section uses, on a small budget
//   words   what it does on the words up to a short length: none accepted,
//           all accepted, or some — labelled as exactly that
//
// The map's cells are volumes, or for a room too large to draw cell by cell,
// blocks of consecutive volumes each coloured by one sample drawn with a seed
// from the room and the block, so every reader sees the same map.
//
// No DOM: this runs in the worker (babel-worker-core.js) and, where there is
// no worker, on the main thread in slices.

import { App } from '../core/state.js';
import { decideMachine, machineGuards, parseMachineInput } from '../machines/index.js';
import { BEHAVIOUR_MACHINES, classifyBehaviourNow } from '../machines/tm-behaviour.js';
import { invalidateTransitionIndex } from '../machines/runtime.js';
import { dfaOf, languageClass } from './facts.js';
import { documentOf } from './wings.js';
import { volumeAt } from './volumes.js';

/** Every answer a cell can give, with its label. `key` is what a cell stores. */
export const CELL_CLASSES = Object.freeze({
  fa: [
    { key: 'e', label: '∅', say: 'accepts nothing' },
    { key: 'u', label: 'Σ*', say: 'accepts every word' },
    { key: 'f', label: 'finite or cofinite', say: 'accepts or rejects finitely many words' },
    { key: 'o', label: 'something else', say: 'accepts and rejects infinitely many words' }
  ],
  omega: [
    { key: 'e', label: 'empty', say: 'accepts no ω-word' },
    { key: 'o', label: 'non-empty', say: 'accepts some ω-word' }
  ],
  tm: [
    { key: 'h', label: 'halts', say: 'halts from a blank tape' },
    { key: 'n', label: 'never halts', say: 'proved never to halt' },
    { key: 'x', label: 'unknown', say: 'not settled within the map’s budget' }
  ],
  words: [
    { key: 'e', label: 'accepts none', say: 'accepts no word up to the map’s length' },
    { key: 'u', label: 'accepts all', say: 'accepts every word up to the map’s length' },
    { key: 'o', label: 'accepts some', say: 'accepts some and rejects some' },
    { key: 'x', label: 'no verdict', say: 'gives no verdict within the budget' }
  ]
});

/** The longest word the map tries, per wing kind 'words'. */
export const MAP_WORD_LENGTH = 3;
/** The classifier's step budget per volume, for the map. */
export const MAP_TM_BUDGET = 2e4;

// ── Finite automata ──

function faClass(wing, params, body) {
  const t = dfaOf(wing.type, params, body);
  if (!t) return 'x';
  const c = languageClass(t);
  return c === 'c' ? 'f' : c;
}

// ── ω-automata: an accepted lasso exists ──

function omegaGraph(wing, params, body) {
  const [n, k] = params;
  const succ = Array.from({ length: n }, () => new Set());
  if (wing.type.startsWith('D')) {
    const delta = body[1];
    for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) succ[q].add(delta[q * k + a]);
  } else {
    for (const [from, , to] of body[1]) succ[from].add(to);
  }
  return succ.map(s => [...s]);
}

function reachableFrom(succ, start, allow = () => true) {
  const seen = new Uint8Array(succ.length);
  if (!allow(start)) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) { const q = stack.pop(); for (const r of succ[q]) if (!seen[r] && allow(r)) { seen[r] = 1; stack.push(r); } }
  return seen;
}

/** Does some reachable state satisfying `anchor` lie on a cycle inside `allow`? */
function cycleThrough(succ, reach, anchor, allow) {
  for (let q = 0; q < succ.length; q++) {
    if (!reach[q] || !anchor(q) || !allow(q)) continue;
    // q on a cycle within allow: some successor in allow reaches q within allow.
    for (const r of succ[q]) {
      if (!allow(r)) continue;
      if (r === q || reachableFrom(succ, r, allow)[q]) return true;
    }
  }
  return false;
}

export function omegaNonEmpty(wing, params, body) {
  const succ = omegaGraph(wing, params, body);
  const reach = reachableFrom(succ, 0);
  const n = params[0];
  if (wing.omega === 'parity') {
    const pr = body[0];
    for (let q = 0; q < n; q++) {
      const p = pr[q];
      if (p % 2 !== 0 || !reach[q]) continue;
      // A cycle whose least priority is this even p: through q, within priorities ≥ p.
      if (cycleThrough(succ, reach, x => x === q, x => pr[x] >= p)) return true;
    }
    return false;
  }
  const acc = body[0];
  if (wing.omega === 'cobuchi') {
    return cycleThrough(succ, reach, q => !acc[q], q => !acc[q]);
  }
  return cycleThrough(succ, reach, q => !!acc[q], () => true);
}

// ── Turing machines from a blank tape ──

/** A TM volume → the compiled table classifyBehaviour reads, with no document in between. */
export function compiledTm(wing, params, body) {
  const [n, K] = params;
  const [acc, delta] = body;
  const next = new Int32Array(n * K).fill(-1);
  const write = new Int32Array(n * K);
  const move = new Int8Array(n * K);
  delta.forEach((m, e) => {
    if (!m) return;
    write[e] = m[0];
    move[e] = m[1] === 0 ? -1 : m[1] === 1 ? 1 : 0;
    next[e] = m[2];
  });
  return {
    ok: true, Q: n, K, next, write, move, accept: Uint8Array.from(acc), start: 0,
    // The tape is the wing's, never the reader's setting: TM is one-way, ITM two-way.
    twoWay: wing.type === 'ITM', input: [],
    stateNames: Array.from({ length: n }, (_, i) => String(i)),
    symbols: Array.from({ length: K }, (_, i) => String(i))
  };
}

/** Whether a TM volume halts from a blank tape: { verdict, method, steps, … } from the classifier. */
export function tmBehaviour(wing, params, body, opts = {}) {
  if (!BEHAVIOUR_MACHINES.has(wing.type)) return null;
  return classifyBehaviourNow(compiledTm(wing, params, body), opts);
}

const MAP_TM_OPTS = { budget: MAP_TM_BUDGET, segment: 0, far: 0, loops: 0, ngram: [], repwl: [], bouncers: false };

function tmClass(wing, params, body) {
  const v = tmBehaviour(wing, params, body, MAP_TM_OPTS);
  return v?.verdict === 'halts' ? 'h' : v?.verdict === 'never' ? 'n' : 'x';
}

// ── Anything else: its verdicts on short words ──

const DECIDE_FIELDS = ['states', 'transitions', 'config', 'machine', 'sigma', 'accepts', 'stackAlpha', 'outputAlpha', 'startId', 'tapeCount'];

/**
 * Put a volume's document into this thread's App, as the decide worker's
 * snapshot does — but without touching the player's steps, since on the main
 * thread they are the reader's run.
 */
export function loadForDeciding(doc) {
  App.machine = doc.machine;
  App.tapeCount = doc.tapeCount || 1;
  App.startId = doc.startId;
  App.states = doc.states;
  App.transitions = doc.transitions;
  App.sigma = new Set(doc.sigma || []);
  App.outputAlpha = new Set(doc.outputAlpha || []);
  App.stackAlpha = new Set(doc.stackAlpha || []);
  App.accepts = new Set(doc.accepts || []);
  App.config = { ...App.config, ...doc.config, sym: { ...App.config.sym, ...(doc.config?.sym || {}) } };
  invalidateTransitionIndex();
}

/** Run `fn` with a volume's machine in App, and put the reader's back after. */
export function withVolumeLoaded(doc, fn) {
  const held = {};
  for (const k of DECIDE_FIELDS) held[k] = App[k];
  try {
    loadForDeciding(doc);
    return fn();
  } finally {
    for (const k of DECIDE_FIELDS) App[k] = held[k];
    invalidateTransitionIndex();
  }
}

function wordsUpTo(letters, maxLen) {
  const out = [[]];
  let layer = [[]];
  for (let len = 1; len <= maxLen; len++) {
    const next = [];
    for (const w of layer) for (const a of letters) next.push([...w, a]);
    out.push(...next);
    layer = next;
  }
  return out;
}

/**
 * A word as the run box would read it → the machine's verdict, with the run
 * box's own parsing (a multi-tape machine reads its input differently) and
 * guards. Call with the machine loaded.
 */
export function decideText(m, raw) {
  const parsed = parseMachineInput(m, raw);
  if (!parsed.ok) return { verdict: 'err', error: parsed.error };
  const refusal = machineGuards(m, parsed.input).find(g => g.refuse);
  if (refusal) return { verdict: 'err', error: refusal.message || refusal.say || 'This machine cannot be run as drawn.' };
  const r = decideMachine(m, parsed.input) || { verdict: 'unk', output: null };
  return { verdict: r.verdict, output: r.output ?? null };
}

function wordsClass(wing, params, body) {
  const doc = documentOf(wing, params, body);
  return withVolumeLoaded(doc, () => {
    let acc = 0, rej = 0;
    for (const w of wordsUpTo(doc.sigma, MAP_WORD_LENGTH)) {
      let v;
      try { v = decideText(doc.machine, w.join(''))?.verdict; } catch { v = 'unk'; }
      if (v === 'acc') acc++;
      else if (v === 'rej') rej++;
      else return 'x';
    }
    return acc && rej ? 'o' : acc ? 'u' : 'e';
  });
}

/** One volume's cell class. */
export function classifyBody(wing, params, body) {
  if (wing.kind === 'fa') return faClass(wing, params, body);
  if (wing.kind === 'omega') return omegaNonEmpty(wing, params, body) ? 'o' : 'e';
  if (wing.kind === 'tm') return tmClass(wing, params, body);
  return wordsClass(wing, params, body);
}

export function classifyVolume(wing, params, volume) {
  const { body } = volumeAt(wing, params, volume);
  return classifyBody(wing, params, body);
}

/** The classes a wing's map uses. */
export function cellClassesOf(wing) {
  return CELL_CLASSES[wing.kind] || CELL_CLASSES.words;
}
