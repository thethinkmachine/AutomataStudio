import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context, getElement, resetApp } from './harness.js';

const App = () => context.App;

function textOf(node) {
  if (!node || typeof node !== 'object') return '';
  return (node.textContent || '') + (node.children || []).map(textOf).join(' ');
}

function loadExample(name) {
  resetApp();
  context.loadData(JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8')), true);
}

// The DFA example accepts binary multiples of 5. An author turns it into an
// exercise; this returns the student's document.
function authorFromDfaExample(extra = {}) {
  loadExample('dfa');
  context.setExerciseDraft({
    title: 'Multiples of five', prompt: 'Accept binary numbers divisible by **5**.',
    source: 'machine', answer: 'machine', allow: ['DFA', 'NFA'], maxStates: '', maxLength: 8,
    hints: 'Track the remainder.\nFive remainders, five states.', reveal: true, ...extra
  });
  return context.draftDocument();
}

function drawAnswer(rows, accepts) {
  const s = n => 's' + n;
  App().states = rows.map((_, i) => ({ id: s(i + 1), name: 'r' + i, x: i * 100, y: 0 }));
  App().transitions = [];
  rows.forEach((out, i) => Object.entries(out).forEach(([sym, to]) => {
    App().transitions.push({ id: 't' + (App().transitions.length + 1), from: s(i + 1), to: s(to + 1), symbol: sym });
  }));
  App().startId = 's1';
  App().accepts = new Set(accepts.map(i => s(i + 1)));
}

// n mod 5, reading binary: r → 2r + b.
const MOD5 = [0, 1, 2, 3, 4].map(r => ({ 0: (2 * r) % 5, 1: (2 * r + 1) % 5 }));

test('the student document carries the task and not the answer', () => {
  const doc = authorFromDfaExample();
  assert.equal(doc.states.length, 0);
  assert.equal(doc.transitions.length, 0);
  assert.deepEqual(doc.grammar.productions, []);
  assert.equal(doc.meta, null);
  assert.deepEqual(doc.sigma, ['0', '1']);
  assert.equal(doc.machine, 'DFA');
  assert.equal(doc.exercise.hints.length, 2);
  assert.ok(!JSON.stringify(doc).includes('"accepts":["'), 'the reference is sealed');
  context.validateSchema(doc);
});

test('opening the document shows the section, and checking grades the canvas', () => {
  const doc = authorFromDfaExample();
  resetApp();
  context.loadData(JSON.parse(JSON.stringify(doc)));
  assert.equal(App().exercise.title, 'Multiples of five');
  assert.equal(getElement('rp-exercise').style.display, '');
  assert.match(textOf(getElement('exercise-body')), /Answer with a DFA or NFA/);

  // Empty canvas: not an attempt, and it says why.
  let r = context.checkExerciseNow();
  assert.equal(r.status, 'invalid');
  assert.equal(App().exercise.progress.attempts, 0);
  assert.match(textOf(getElement('exercise-body')), /no start state/);

  // Off by one: accepts remainder 1 instead of 0.
  drawAnswer(MOD5, [1]);
  r = context.checkExerciseNow();
  assert.equal(r.status, 'incorrect');
  assert.deepEqual(r.counterexample.tokens, [], 'ε is a multiple of five and the shortest word that shows it');
  assert.match(textOf(getElement('exercise-body')), /should be accepted, but your machine rejects it/);
  assert.equal(App().exercise.progress.attempts, 1);

  drawAnswer(MOD5, [0]);
  r = context.checkExerciseNow();
  assert.equal(r.status, 'correct');
  assert.equal(App().exercise.progress.solved, true);
  assert.match(textOf(getElement('exercise-body')), /Solved/);
});

test('the exercise and its progress survive a save, a tab switch and Clear, but not undo', () => {
  const doc = authorFromDfaExample();
  resetApp();
  context.loadData(JSON.parse(JSON.stringify(doc)));
  drawAnswer(MOD5, [0]);
  context.checkExerciseNow();

  const saved = JSON.parse(JSON.stringify(context.getWorkspaceData()));
  assert.equal(saved.exercise.progress.solved, true);
  resetApp();
  context.validateSchema(saved);
  context.loadData(saved);
  assert.equal(App().exercise.progress.attempts, 1);

  const blob = context.exportWorkspaceState();
  resetApp();
  context.importWorkspaceState(blob);
  assert.equal(App().exercise.id, doc.exercise.id);

  context.resetWorkspace();
  assert.equal(App().states.length, 0, 'Clear clears the answer');
  assert.equal(App().exercise?.id, doc.exercise.id, 'but not the question');
});

test('a workspace with no exercise saves exactly the file it always did', () => {
  loadExample('dfa');
  const d = context.getWorkspaceData();
  assert.equal('exercise' in d, false);
  assert.equal('lexer' in d, false);
});

test('a grammar can be the reference, and a grammar the answer', () => {
  resetApp();
  const eps = App().config.sym.eps;
  App().grammar.vars = new Set(['S']);
  App().grammar.start = 'S';
  App().grammar.productions = [{ lhs: 'S', rhs: 'a S b' }, { lhs: 'S', rhs: eps }];
  context.setExerciseDraft({ title: 'aⁿbⁿ', prompt: '', source: 'grammar', answer: 'grammar', allow: [], maxLength: 6, hints: '', reveal: false });
  const doc = context.draftDocument();
  assert.deepEqual(doc.sigma.sort(), ['a', 'b']);
  resetApp();
  context.loadData(JSON.parse(JSON.stringify(doc)));
  App().grammar.productions = [{ lhs: 'S', rhs: 'a S b' }, { lhs: 'S', rhs: 'a b' }];
  const r = context.checkExerciseNow();
  assert.equal(r.status, 'incorrect');
  assert.match(textOf(getElement('exercise-body')), /should be accepted, but your grammar does not generate it/);
});

test('hints are shown one at a time and counted', () => {
  const doc = authorFromDfaExample();
  resetApp();
  context.loadData(JSON.parse(JSON.stringify(doc)));
  assert.doesNotMatch(textOf(getElement('exercise-body')), /Track the remainder/);
  App().exercise = { ...App().exercise, progress: { ...App().exercise.progress, hintsShown: 1 } };
  context.emit(context.Change.EXERCISE);
  const text = textOf(getElement('exercise-body'));
  assert.match(text, /Track the remainder/);
  assert.doesNotMatch(text, /Five remainders/);
  assert.match(text, /Show a hint \(2 of 2\)/);
});

test('describeResult says how much a bounded pass actually shows', () => {
  const ex = { answer: 'machine' };
  const d = context.describeResult({ status: 'passed', method: 'bounded', checked: { words: 511, completeLength: 8, truncated: false } }, ex);
  assert.match(d.detail[0], /all 511 words up to length 8/);
  const t = context.describeResult({ status: 'passed', method: 'bounded', checked: { words: 5000, completeLength: 7, truncated: true } }, ex);
  assert.match(t.detail[0], /first 5,000 words/);
});

// ── the lexer page ────────────────────────────────────────────────

test('the lexer page renders a working lexer, and looking at it does not dirty the workspace', () => {
  resetApp();
  App().view = 'algo';
  App().currentAlgo = 'lexer';
  const host = getElement('algo-content');
  context.algoLexer(host);
  assert.equal(App().lexer, null);
  const text = textOf(host);
  assert.match(text, /function tokenize/);
  assert.match(text, /IDENT/);
  assert.match(text, /states × \d+ character classes/);
});

test('an edited rule set is saved with the workspace and comes back on load', () => {
  resetApp();
  App().lexer = { rules: 'A a+\nskip WS \\s+', sample: 'aa a', lang: 'py' };
  const saved = JSON.parse(JSON.stringify(context.getWorkspaceData()));
  assert.deepEqual(saved.lexer, { rules: 'A a+\nskip WS \\s+', sample: 'aa a', lang: 'py' });
  resetApp();
  context.loadData(saved);
  assert.equal(App().lexer.lang, 'py');
  App().view = 'algo';
  App().currentAlgo = 'lexer';
  const host = getElement('algo-content');
  context.algoLexer(host);
  assert.match(textOf(host), /def tokenize/);
});
