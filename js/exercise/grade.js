// ══════════════════════════════════════════════════════════════════
//  GRADING — is this answer the language the exercise asked for?
// ══════════════════════════════════════════════════════════════════
// DOM-free, like js/machines/**: it imports the machine layer and the grammar
// engine and nothing that draws, so the whole of grading is testable with no
// document and could run on a worker.
//
// Two methods, and the result always says which one answered, because they
// make different claims:
//
//   exact    Both sides are finite automata (DFA, NFA, ε-NFA). The product of
//            their subset constructions is explored breadth-first, so the
//            answer is a *proof* — equal, or here is the shortest word on
//            which they differ. This is the symmetric-difference check the
//            Algorithms view's Full Equivalence card does, generalized from
//            DFA × DFA to anything with a subset construction.
//
//   bounded  Everything else — PDAs, Turing machines, transducers, grammars.
//            Equivalence is undecidable for most of these (and for a PDA it
//            is undecidable already), so the honest thing available is to
//            decide every word of Σ* up to a length in shortlex order and
//            compare. Shortlex matters: the first difference found is a
//            shortest one, which is the counterexample a student can
//            actually reason about. A pass is reported as "agrees on these
//            N words", never as "correct".
//
// Deciding the *reference* uses the same simulators the player uses, run
// against the reference's graph. The machine layer reads `App`, so the
// reference is swapped in for the duration of a batch and swapped back in a
// `finally` — the pattern parallel/snapshot.js uses inside a worker, made
// reversible. It is safe on the main thread for a reason worth stating:
// assigning a Set-valued field of App replaces the ReactiveSet behind the
// accessor *without* notifying (see installReactiveSetField), so no memo
// recomputes against the borrowed machine, and nothing here emits.

import { App, getMachineConfig } from '../state.js';
import { decideWord, machineDef } from '../machines/index.js';
import { grammarTerminals, isContextFree, readGrammar } from '../grammar/model.js';
import { toCNF } from '../grammar/transform.js';
import { cykTable } from '../grammar/parsing.js';
import { blankProgress, unsealTarget } from './model.js';

// ── What a machine or grammar is, as data ─────────────────────────

const SEMANTIC_CONFIG = ['pdaParadigm', 'twoWayTape', 'pfaCutPoint'];

/** The machine on the canvas, as a reference or an answer. */
export function machineTargetFromApp() {
  const config = {};
  SEMANTIC_CONFIG.forEach(k => { if (App.config[k] !== undefined) config[k] = App.config[k]; });
  return {
    kind: 'machine',
    machine: App.machine,
    states: App.states.map(s => ({ ...s })),
    transitions: App.transitions.map(t => ({ ...t })),
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    blocks: JSON.parse(JSON.stringify(App.blocks || [])),
    config
  };
}

/** The grammar in the Grammar view, as a reference or an answer. */
export function grammarTargetFromApp() {
  const grammar = {
    vars: [...App.grammar.vars],
    start: App.grammar.start,
    productions: JSON.parse(JSON.stringify(App.grammar.productions || []))
  };
  return { kind: 'grammar', grammar, sigma: [...grammarTerminals(grammarModelOf(grammar))] };
}

// The grammar engine reads App.grammar through readGrammar(), which is where
// the tokenizer rules live — so a stored grammar is read the same way by
// borrowing that field for one call rather than by re-implementing the reader.
function grammarModelOf(data) {
  const held = App.grammar;
  App.grammar = { vars: new Set(data?.vars || []), start: data?.start || '', productions: data?.productions || [] };
  try { return readGrammar(); } finally { App.grammar = held; }
}

// ── Which machines can be graded at all ───────────────────────────

/**
 * Whether this machine type reads a finite word — i.e. whether "the language
 * it accepts" is a set of words the grader can enumerate. The ω-automata read
 * u(v) and a multi-tape run reads a tuple, so both declare their own
 * parseInput, and that declaration is the test.
 */
export function machineIsGradable(m) {
  const def = machineDef(m);
  return !!def && !def.parseInput && !getMachineConfig(m).isOmega;
}

const EXACT_TYPES = new Set(['DFA', 'NFA', 'ε-NFA']);

// The types a student may reasonably answer with when the reference is of a
// given type. The author edits this; it is only the default, and it is
// deliberately conservative — a 2DFA is regular, but "draw a 2DFA" is a
// different exercise from "draw a DFA".
const PEERS = {
  'DFA': ['DFA', 'NFA', 'ε-NFA'],
  'NFA': ['DFA', 'NFA', 'ε-NFA'],
  'ε-NFA': ['DFA', 'NFA', 'ε-NFA'],
  'DPDA': ['DPDA', 'NPDA'],
  'NPDA': ['NPDA', 'DPDA'],
  'TM': ['TM', 'NDTM'],
  'NDTM': ['NDTM', 'TM'],
  '2DFA': ['2DFA', '2NFA'],
  '2NFA': ['2NFA', '2DFA']
};

export function defaultAllowFor(m) {
  return [...(PEERS[m] || [m])];
}

// ── Borrowing App for a reference ─────────────────────────────────

const PLAIN = ['machine', 'states', 'transitions', 'startId', 'tapeCount', 'blocks', 'simStart', 'simSteps', 'simIdx'];
const SETS = ['sigma', 'stackAlpha', 'outputAlpha', 'accepts'];

/** Run `fn` with `target` standing in for the machine on the canvas. */
export function withMachine(target, fn) {
  const held = {};
  PLAIN.forEach(k => { held[k] = App[k]; });
  SETS.forEach(k => { held[k] = App[k]; });
  const heldConfig = App.config;
  try {
    App.machine = target.machine;
    App.states = target.states || [];
    App.transitions = target.transitions || [];
    App.startId = target.startId || null;
    App.tapeCount = target.tapeCount || App.tapeCount;
    App.blocks = target.blocks || [];
    App.simStart = null;
    App.sigma = new Set(target.sigma || []);
    App.stackAlpha = new Set(target.stackAlpha || [App.config.sym.stackBottom]);
    App.outputAlpha = new Set(target.outputAlpha || []);
    App.accepts = new Set(target.accepts || []);
    App.config = { ...heldConfig, ...(target.config || {}) };
    return fn();
  } finally {
    App.config = heldConfig;
    SETS.forEach(k => { App[k] = held[k]; });
    PLAIN.forEach(k => { App[k] = held[k]; });
  }
}

// ── Deciding a list of words ──────────────────────────────────────

function machineVerdicts(target, words) {
  return withMachine(target, () => words.map(tokens => {
    try { return decideWord(target.machine, tokens) || { verdict: 'unk', output: null }; }
    catch { return { verdict: 'unk', output: null }; }
  }));
}

/** A context-free grammar → a membership test, CNF computed once. */
export function grammarDecider(data) {
  const g = grammarModelOf(data);
  if (!g.rules.length) return { ok: false, error: 'The grammar has no rules.' };
  if (!isContextFree(g)) {
    return { ok: false, error: 'Only context-free grammars can be checked — every left-hand side has to be a single variable.' };
  }
  const cnf = toCNF(g).grammar;
  const derivesEps = cnf.rules.some(r => r.lhsArr[0] === cnf.start && r.rhsArr.length === 0);
  return {
    ok: true,
    decide(tokens) {
      if (!tokens.length) return derivesEps;
      return cykTable(cnf, tokens).cells[0][tokens.length - 1].has(cnf.start);
    }
  };
}

function verdictsFor(subject, words) {
  if (subject.kind === 'grammar') {
    const d = grammarDecider(subject.grammar);
    if (!d.ok) throw new Error(d.error);
    return words.map(w => ({ verdict: d.decide(w) ? 'acc' : 'rej', output: null }));
  }
  return machineVerdicts(subject, words);
}

/**
 * Σ* in shortlex order, up to `maxLength` symbols, stopping at `maxWords`.
 * `completeLength` is the longest length every word of which was included —
 * what a pass may honestly claim.
 */
export function enumerateWords(sigma, maxLength, maxWords) {
  const words = [[]];
  let frontier = [[]];
  let completeLength = 0;
  if (!sigma.length) return { words, completeLength: maxLength, truncated: false };
  for (let len = 1; len <= maxLength; len++) {
    const next = [];
    for (const w of frontier) for (const a of sigma) next.push([...w, a]);
    if (words.length + next.length > maxWords) {
      words.push(...next.slice(0, Math.max(0, maxWords - words.length)));
      return { words, completeLength, truncated: true };
    }
    words.push(...next);
    frontier = next;
    completeLength = len;
  }
  return { words, completeLength, truncated: false };
}

// ── The exact check, for finite automata ──────────────────────────

// One side of the product: a subset construction run lazily. A DFA's
// configuration is a set of at most one state, and it resolves an explicit
// symbol over the Σ wildcard the way getSingleTapeDeterministicTransition
// does; an NFA takes every matching edge and closes under ε, as testNFA does.
// tests/exercise.test.js checks both against the simulators word for word.
function subsetSide(target, sym) {
  const det = target.machine === 'DFA';
  const out = new Map();
  (target.transitions || []).forEach(t => {
    if (!out.has(t.from)) out.set(t.from, []);
    out.get(t.from).push(t);
  });
  const acc = new Set(target.accepts || []);
  const closure = set => {
    if (det) return set;
    const c = new Set(set), stk = [...set];
    while (stk.length) {
      const s = stk.pop();
      (out.get(s) || []).forEach(t => {
        if (t.symbol === sym.eps && !c.has(t.to)) { c.add(t.to); stk.push(t.to); }
      });
    }
    return c;
  };
  const norm = set => [...set].sort();
  return {
    start: target.startId ? norm(closure(new Set([target.startId]))) : [],
    step(cfg, a) {
      if (det) {
        if (!cfg.length) return [];
        const edges = out.get(cfg[0]) || [];
        const t = edges.find(e => e.symbol === a) || edges.find(e => e.symbol === sym.any);
        return t ? [t.to] : [];
      }
      const nx = new Set();
      cfg.forEach(s => (out.get(s) || []).forEach(t => {
        if (t.symbol === a || t.symbol === sym.any) nx.add(t.to);
      }));
      return norm(closure(nx));
    },
    accepting: cfg => cfg.some(s => acc.has(s))
  };
}

const EXACT_PAIR_CAP = 200000;

/**
 * L(a) = L(b) over `sigma`, decided. Returns `{ equal: true }`,
 * `{ equal: false, tokens }` with a shortest distinguishing word, or null
 * when the product outgrew its cap (the caller falls back to bounded).
 */
export function exactFiniteEquivalence(a, b, sigma, sym = App.config.sym) {
  const A = subsetSide(a, sym), B = subsetSide(b, sym);
  const key = (x, y) => x.join('\u0001') + '\u0002' + y.join('\u0001');
  const startKey = key(A.start, B.start);
  const parent = new Map([[startKey, null]]);
  const queue = [[A.start, B.start, startKey]];
  for (let head = 0; head < queue.length; head++) {
    const [x, y, k] = queue[head];
    if (A.accepting(x) !== B.accepting(y)) {
      const tokens = [];
      for (let cur = k; parent.get(cur); cur = parent.get(cur).from) tokens.unshift(parent.get(cur).sym);
      return { equal: false, tokens, refAccepts: A.accepting(x) };
    }
    for (const s of sigma) {
      const nx = A.step(x, s), ny = B.step(y, s);
      const nk = key(nx, ny);
      if (parent.has(nk)) continue;
      parent.set(nk, { from: k, sym: s });
      if (parent.size > EXACT_PAIR_CAP) return null;
      queue.push([nx, ny, nk]);
    }
  }
  return { equal: true };
}

// ── The answer's own obligations ──────────────────────────────────

function typeLabel(m) { return getMachineConfig(m)?.label || m; }

export function listTypes(types) {
  const labels = types.map(typeLabel);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/** Reasons this answer cannot be graded as it stands — empty when it can. */
export function answerProblems(ex, answer, target) {
  const problems = [];
  if (answer.kind === 'grammar') {
    if (!(answer.grammar.productions || []).length) problems.push('The Grammar view has no rules yet.');
    else {
      const d = grammarDecider(answer.grammar);
      if (!d.ok) problems.push(d.error);
    }
    return problems;
  }
  if (!machineIsGradable(answer.machine)) {
    problems.push(`A ${typeLabel(answer.machine)} does not read finite words, so it cannot answer this exercise.`);
    return problems;
  }
  if (ex.allow.length && !ex.allow.includes(answer.machine)) {
    problems.push(`This exercise asks for a ${listTypes(ex.allow)}; the canvas holds a ${typeLabel(answer.machine)}. Switch the machine type from the header.`);
  }
  if (target.kind === 'machine' && getMachineConfig(target.machine).isTransducer && !getMachineConfig(answer.machine).isTransducer) {
    problems.push('This exercise asks for a transducer — the output is what gets checked.');
  }
  if (!answer.startId) problems.push('The machine has no start state.');
  if (ex.maxStates != null && answer.states.length > ex.maxStates) {
    problems.push(`The machine has ${answer.states.length} states; this exercise allows at most ${ex.maxStates}.`);
  }
  return problems;
}

// ── Grading ───────────────────────────────────────────────────────

function sameOutput(a, b) {
  const norm = o => (o == null ? '' : Array.isArray(o) ? o.join('') : String(o));
  return norm(a) === norm(b);
}

// A transducer's output is compared whatever its verdict. A Mealy or Moore
// machine usually has no F at all, so every run "rejects" and a comparison
// gated on acceptance would pass any machine with the right shape.
function agrees(ref, ans, transducer) {
  if (ref.verdict !== ans.verdict) return false;
  return !transducer || sameOutput(ref.output, ans.output);
}

/**
 * Grade `answer` (a machine or grammar target shape) against the exercise.
 *
 * Returns:
 *   status   'correct'      proved equal (exact method)
 *            'passed'       agrees on every word checked (bounded method)
 *            'incorrect'    here is a word they disagree on
 *            'inconclusive' no disagreement, but the answer gave no verdict
 *                           on some word the reference decided
 *            'invalid'      the answer breaks a rule of the exercise
 *   method   'exact' | 'bounded' | null
 *   counterexample  { tokens, expected: {verdict, output}, got: {verdict, output} }
 *   checked  { words, completeLength, truncated }  (bounded only)
 *   problems, notes  sentences
 */
export function gradeExercise(ex, answer, opts = {}) {
  const target = opts.target || unsealTarget(ex.target);
  const sym = App.config.sym;
  const problems = answerProblems(ex, answer, target);
  if (problems.length) return { status: 'invalid', method: null, problems, notes: [] };

  const sigma = [...(target.sigma || [])].filter(s => s !== sym.eps);
  const notes = [];
  const answerSigma = answer.kind === 'grammar' ? [...grammarTerminals(grammarModelOf(answer.grammar))] : answer.sigma || [];
  const missing = sigma.filter(s => !answerSigma.includes(s));
  const extra = answerSigma.filter(s => !sigma.includes(s) && s !== sym.eps);
  if (missing.length) notes.push(`Your Σ has no ${missing.map(s => `'${s}'`).join(', ')}, so every word containing ${missing.length > 1 ? 'them' : 'it'} is rejected.`);
  if (extra.length) notes.push(`The exercise's alphabet is {${sigma.join(', ')}}; ${extra.map(s => `'${s}'`).join(', ')} ${extra.length > 1 ? 'are' : 'is'} never checked.`);

  const transducer = target.kind === 'machine' && !!getMachineConfig(target.machine).isTransducer;

  if (!transducer && target.kind === 'machine' && answer.kind === 'machine'
    && EXACT_TYPES.has(target.machine) && EXACT_TYPES.has(answer.machine)) {
    const r = exactFiniteEquivalence(target, answer, sigma, sym);
    if (r && r.equal) return { status: 'correct', method: 'exact', problems: [], notes };
    if (r) {
      const expected = { verdict: r.refAccepts ? 'acc' : 'rej', output: null };
      const got = { verdict: r.refAccepts ? 'rej' : 'acc', output: null };
      return { status: 'incorrect', method: 'exact', problems: [], notes, counterexample: { tokens: r.tokens, expected, got } };
    }
    notes.push('The machines were too large to compare exactly, so every word up to the length bound was checked instead.');
  }

  const { words, completeLength, truncated } = enumerateWords(sigma, ex.maxLength, ex.maxWords);
  let refV, ansV;
  try { refV = verdictsFor(target, words); }
  catch (e) { return { status: 'invalid', method: 'bounded', problems: [`The exercise's reference could not be run: ${e.message}`], notes }; }
  try { ansV = verdictsFor(answer, words); }
  catch (e) { return { status: 'invalid', method: 'bounded', problems: [e.message], notes }; }

  let refUnknown = 0, firstUndecided = null;
  for (let i = 0; i < words.length; i++) {
    const ref = refV[i], ans = ansV[i];
    if (ref.verdict === 'unk') { refUnknown++; continue; }
    if (ans.verdict === 'unk') { if (!firstUndecided) firstUndecided = { tokens: words[i], expected: ref, got: ans }; continue; }
    if (!agrees(ref, ans, transducer)) {
      return {
        status: 'incorrect', method: 'bounded', problems: [], notes,
        counterexample: { tokens: words[i], expected: ref, got: ans },
        checked: { words: i + 1, completeLength, truncated }
      };
    }
  }
  if (refUnknown) notes.push(`${refUnknown} word${refUnknown > 1 ? 's were' : ' was'} skipped: the reference itself gave no verdict within the step budget.`);
  const checked = { words: words.length, completeLength, truncated };
  if (firstUndecided) {
    return { status: 'inconclusive', method: 'bounded', problems: [], notes, counterexample: firstUndecided, checked };
  }
  return { status: 'passed', method: 'bounded', problems: [], notes, checked };
}

/** The progress record after an attempt, as a new object. */
export function recordAttempt(progress, result, now = new Date()) {
  const p = { ...blankProgress(), ...(progress || {}) };
  p.attempts += 1;
  const solved = result.status === 'correct' || result.status === 'passed';
  if (solved && !p.solved) { p.solved = true; p.solvedAt = now.toISOString(); }
  p.last = { status: result.status, method: result.method, at: now.toISOString() };
  return p;
}

/** A word as a reader would type it into the run box. */
export function wordText(tokens, sym = App.config.sym) {
  if (!tokens.length) return sym.eps;
  return tokens.every(t => [...t].length === 1) ? tokens.join('') : tokens.join(' ');
}
