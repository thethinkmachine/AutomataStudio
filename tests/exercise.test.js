import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context, resetApp } from './harness.js';
import {
  EXERCISE_LIMITS, normalizeExercise, sealTarget, unsealTarget, validateExercise
} from '../js/exercise/model.js';
import {
  defaultAllowFor, enumerateWords, exactFiniteEquivalence, gradeExercise, machineIsGradable,
  machineTargetFromApp, recordAttempt, withMachine, wordText
} from '../js/exercise/grade.js';

const App = () => context.App;

// A DFA over {a, b} built from a table: rows are [name, accept, {sym: toName}].
function dfa(rows, machine = 'DFA', sigma = ['a', 'b']) {
  const ids = new Map(rows.map(([n], i) => [n, 's' + (i + 1)]));
  const transitions = [];
  rows.forEach(([n, , out]) => Object.entries(out).forEach(([sym, to]) => {
    transitions.push({ id: 't' + (transitions.length + 1), from: ids.get(n), to: ids.get(to), symbol: sym });
  }));
  return {
    kind: 'machine', machine, sigma,
    states: rows.map(([n], i) => ({ id: ids.get(n), name: n, x: i * 100, y: 0 })),
    transitions,
    startId: ids.get(rows[0][0]),
    accepts: rows.filter(r => r[1]).map(([n]) => ids.get(n)),
    stackAlpha: [], outputAlpha: [], tapeCount: 1, config: {}
  };
}

// Words over {a, b} ending in "ab".
const endsInAb = () => dfa([
  ['p', false, { a: 'q', b: 'p' }],
  ['q', false, { a: 'q', b: 'r' }],
  ['r', true, { a: 'q', b: 'p' }]
]);

// The same language as an NFA that guesses where the suffix starts.
const endsInAbNfa = () => dfa([
  ['x', false, { a: 'x', b: 'x' }],
  ['y', false, { b: 'z' }],
  ['z', true, {}]
], 'NFA');
function addEdge(m, from, to, symbol) {
  const f = m.states.find(s => s.name === from).id, t = m.states.find(s => s.name === to).id;
  m.transitions.push({ id: 't' + (m.transitions.length + 1), from: f, to: t, symbol });
}

function exercise(target, extra = {}) {
  return normalizeExercise({ target: sealTarget(target), allow: [], ...extra });
}

function loadExample(name) {
  resetApp();
  context.loadData(JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8')), true);
}

// ── the document side ─────────────────────────────────────────────

test('a sealed reference round-trips, and is not readable as plain JSON', () => {
  const target = endsInAb();
  const sealed = sealTarget(target);
  assert.ok(!sealed.includes('"accepts"'), 'the sealed form must not show the machine in the clear');
  assert.deepEqual(unsealTarget(sealed), target);
});

test('normalizeExercise fills defaults and clamps what the author cannot set', () => {
  const ex = normalizeExercise({ target: sealTarget(endsInAb()), maxLength: 999, maxWords: -4, hints: ['one', '', 7] });
  assert.equal(ex.maxLength, EXERCISE_LIMITS.maxLengthCap);
  assert.equal(ex.maxWords, 1);
  assert.deepEqual(ex.hints, ['one']);
  assert.equal(ex.answer, 'machine');
  assert.equal(ex.progress.attempts, 0);
  assert.equal(normalizeExercise({ title: 'no target' }), null);
});

test('validateExercise refuses a reference it cannot read', () => {
  assert.throws(() => validateExercise({ target: 'plain text' }), /could not be read/);
  assert.throws(() => validateExercise({ target: sealTarget({ kind: 'poem' }) }), /machine or a grammar/);
  validateExercise({ target: sealTarget(endsInAb()), answer: 'machine' });
});

// ── the exact method ──────────────────────────────────────────────

test('a DFA and an NFA for the same language are proved equal', () => {
  resetApp();
  const nfa = endsInAbNfa();
  addEdge(nfa, 'x', 'y', 'a');
  const r = gradeExercise(exercise(endsInAb()), nfa);
  assert.equal(r.status, 'correct');
  assert.equal(r.method, 'exact');
});

test('a wrong answer gets the shortest word the two disagree on', () => {
  resetApp();
  // Accepts words ending in b — wrong on "b", which is length 1.
  const wrong = dfa([['p', false, { a: 'p', b: 'q' }], ['q', true, { a: 'p', b: 'q' }]]);
  const r = gradeExercise(exercise(endsInAb()), wrong);
  assert.equal(r.status, 'incorrect');
  assert.deepEqual(r.counterexample.tokens, ['b']);
  assert.equal(r.counterexample.expected.verdict, 'rej');
  assert.equal(r.counterexample.got.verdict, 'acc');
});

test('ε is a counterexample when only the empty word differs', () => {
  resetApp();
  const ref = dfa([['p', true, { a: 'p', b: 'p' }]]);
  const ans = dfa([['p', false, { a: 'q', b: 'q' }], ['q', true, { a: 'q', b: 'q' }]]);
  const r = gradeExercise(exercise(ref), ans);
  assert.deepEqual(r.counterexample.tokens, []);
  assert.equal(wordText([], App().config.sym), App().config.sym.eps);
});

test('the exact product agrees with the simulators word for word, wildcard and ε included', () => {
  resetApp();
  const { sym } = App().config;
  const a = dfa([
    ['p', false, { a: 'q', [sym.any]: 'p' }],
    ['q', true, { b: 'p', [sym.any]: 'q' }]
  ]);
  const b = dfa([['u', false, {}], ['v', true, { a: 'v' }], ['w', false, { b: 'u' }]], 'ε-NFA');
  addEdge(b, 'u', 'v', sym.eps);
  addEdge(b, 'v', 'w', sym.any);
  const sigma = ['a', 'b'];
  const { words } = enumerateWords(sigma, 6, 1000);
  for (const [m, name] of [[a, 'DFA'], [b, 'ε-NFA']]) {
    const self = exactFiniteEquivalence(m, m, sigma, sym);
    assert.equal(self.equal, true, `${name} is equal to itself`);
  }
  const r = exactFiniteEquivalence(a, b, sigma, sym);
  const verdict = (m, w) => withMachine(m, () => context.decideWord(m.machine, w).verdict);
  const firstDiff = words.find(w => verdict(a, w) !== verdict(b, w));
  if (r.equal) assert.equal(firstDiff, undefined);
  else {
    assert.ok(firstDiff, 'a difference the product found exists in the simulators');
    assert.equal(r.tokens.length, firstDiff.length, 'and it is a shortest one');
    assert.notEqual(verdict(a, r.tokens), verdict(b, r.tokens));
  }
});

// ── the bounded method ────────────────────────────────────────────

test('a PDA exercise is checked word by word, and a wrong answer is caught', () => {
  loadExample('npda');
  const target = machineTargetFromApp();
  const ex = exercise(target, { allow: defaultAllowFor('NPDA'), maxLength: 6 });
  const right = gradeExercise(ex, target);
  assert.equal(right.status, 'passed');
  assert.equal(right.method, 'bounded');
  assert.equal(right.checked.completeLength, 6);
  // Drop one transition: the machine now misses some palindromes.
  const broken = { ...target, transitions: target.transitions.slice(1) };
  const wrong = gradeExercise(ex, broken);
  assert.equal(wrong.status, 'incorrect');
  assert.equal(wrong.counterexample.expected.verdict, 'acc');
});

test('a grammar can answer a machine exercise', () => {
  resetApp();
  const ref = dfa([['p', true, { a: 'q' }], ['q', false, { b: 'p' }]]); // (ab)*
  const grammar = (productions) => ({
    kind: 'grammar',
    grammar: { vars: ['S'], start: 'S', productions: productions.map(([lhs, rhs]) => ({ lhs, rhs })) }
  });
  const ex = exercise(ref, { answer: 'grammar', maxLength: 6 });
  const eps = App().config.sym.eps;
  assert.equal(gradeExercise(ex, grammar([['S', 'a b S'], ['S', eps]])).status, 'passed');
  const wrong = gradeExercise(ex, grammar([['S', 'a b S'], ['S', 'a b']]));
  assert.equal(wrong.status, 'incorrect');
  assert.deepEqual(wrong.counterexample.tokens, []);
});

test('a transducer is graded on its output, not only on whether it read the word', () => {
  loadExample('mealy');
  const target = machineTargetFromApp();
  const ex = exercise(target, { allow: ['Mealy'], maxLength: 3 });
  assert.equal(gradeExercise(ex, target).status, 'passed');
  const flipped = {
    ...target,
    transitions: target.transitions.map(t => ({ ...t, output: t.output === '0' ? '1' : '0' }))
  };
  const r = gradeExercise(ex, flipped);
  assert.equal(r.status, 'incorrect');
  assert.equal(r.counterexample.expected.verdict, r.counterexample.got.verdict);
});

test('enumeration is shortlex and says how far it got', () => {
  const { words, completeLength, truncated } = enumerateWords(['a', 'b'], 3, 10);
  assert.deepEqual(words.slice(0, 4), [[], ['a'], ['b'], ['a', 'a']]);
  assert.equal(words.length, 10);
  assert.equal(completeLength, 2);
  assert.equal(truncated, true);
});

// ── the rules of the exercise ─────────────────────────────────────

test('an answer of the wrong type, or too big, is refused before it is compared', () => {
  resetApp();
  const nfa = endsInAbNfa();
  addEdge(nfa, 'x', 'y', 'a');
  const r = gradeExercise(exercise(endsInAb(), { allow: ['DFA'], maxStates: 2 }), nfa);
  assert.equal(r.status, 'invalid');
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /asks for a DFA/);
  assert.match(r.problems[1], /at most 2/);
  const noStart = { ...endsInAb(), startId: null };
  assert.equal(gradeExercise(exercise(endsInAb()), noStart).status, 'invalid');
});

test('ω-automata are not gradable, finite-word machines are', () => {
  assert.equal(machineIsGradable('NBA'), false);
  assert.equal(machineIsGradable('DFA'), true);
  assert.equal(machineIsGradable('TM'), true);
});

test('grading leaves the machine on the canvas exactly as it was', () => {
  loadExample('dfa');
  const before = JSON.stringify(context.getWorkspaceData());
  const acceptsRef = App().accepts;
  gradeExercise(exercise(endsInAb(), { maxLength: 4 }), endsInAb());
  gradeExercise(exercise(machineTargetFromApp(), { answer: 'machine' }), endsInAbNfa());
  assert.equal(JSON.stringify(context.getWorkspaceData()), before);
  assert.equal(App().accepts, acceptsRef, 'the accept set is the same object, so nothing reactive was swapped out');
});

test('an attempt is recorded, and solving is sticky', () => {
  const t = new Date('2026-09-23T10:00:00Z');
  let p = recordAttempt(null, { status: 'incorrect', method: 'exact' }, t);
  assert.equal(p.attempts, 1);
  assert.equal(p.solved, false);
  p = recordAttempt(p, { status: 'correct', method: 'exact' }, t);
  p = recordAttempt(p, { status: 'incorrect', method: 'exact' }, t);
  assert.equal(p.attempts, 3);
  assert.equal(p.solved, true);
  assert.equal(p.last.status, 'incorrect');
});
