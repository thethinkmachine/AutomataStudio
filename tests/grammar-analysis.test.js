import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { parseGrammarText } from '../js/grammar/parse.js';
import {
  classify, cnfViolations, firstSets, followSets, generatingSet, gnfViolations,
  leftRecursionCycles, nullableSet, properties, reachableSet, usefulCycle
} from '../js/grammar/analysis.js';

// Analysis: the fixed-point sets, the classification and the two decision
// procedures. Every one is a pure function of a grammar model, which is the
// whole reason this file can compare sets instead of matching printed markup —
// the assertion the old grammar view's tests could never make, because every
// algorithm in it ended in an innerHTML write.

const G = text => {
  const p = parseGrammarText(text);
  return { vars: p.vars, start: p.start, rules: p.rules };
};
const sorted = s => [...s].sort();

// ── The fixed points ──────────────────────────────────────────────

test('nullable is the variables that derive ε, transitively', () => {
  const g = G('S -> A B\nA -> a | ε\nB -> A');
  assert.deepEqual(sorted(nullableSet(g)), ['A', 'B', 'S'],
    'B is nullable through A, and S through both');
});

test('generating is the variables that derive some terminal string', () => {
  const g = G('S -> a | B\nB -> b B\nC -> c');
  assert.deepEqual(sorted(generatingSet(g)), ['C', 'S'], 'B can only ever produce more B');
});

test('reachable is the symbols the start symbol can lead to', () => {
  const g = G('S -> a | B\nB -> b\nC -> c');
  const reach = reachableSet(g);
  assert.ok(reach.has('B'));
  assert.ok(!reach.has('C'), 'nothing derives C');
});

test('FIRST carries ε; FOLLOW carries the end marker instead', () => {
  const g = G("E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id");
  const first = firstSets(g);
  const follow = followSets(g, first);
  assert.deepEqual(sorted(first.E), ['(', 'id']);
  assert.deepEqual(sorted(first["E'"]), ['+', 'ε']);
  assert.deepEqual(sorted(follow.E), ['$', ')']);
  assert.deepEqual(sorted(follow.T), ['$', ')', '+']);
  assert.ok(!follow.E.has('ε'), 'ε is never in a FOLLOW set — $ is what stands in its place');
});

// ── Left recursion ────────────────────────────────────────────────

test('direct left recursion is found', () => {
  const cycles = leftRecursionCycles(G('E -> E + T | T\nT -> id'));
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['E', 'E']);
});

test('indirect left recursion is found, which is the case with no rule that looks it', () => {
  const cycles = leftRecursionCycles(G('S -> A a | b\nA -> S d | c'));
  assert.equal(cycles.length, 1, 'S ⇒ A ⇒ S');
  assert.deepEqual(sorted(new Set(cycles[0])), ['A', 'S']);
});

test('recursion through a nullable prefix counts', () => {
  // A is nullable, so B is genuinely the leftmost symbol S can derive.
  const cycles = leftRecursionCycles(G('S -> A B\nA -> ε\nB -> S c | b'));
  assert.ok(cycles.length, 'S ⇒ A B ⇒ B ⇒ S c is left recursion');
});

test('a grammar with no left recursion reports none', () => {
  assert.deepEqual(leftRecursionCycles(G('S -> a S | b')), []);
});

// ── Chomsky classification ────────────────────────────────────────
//
// These two moved here from tests/module-scope.test.js when the classifier
// stopped being a renderer. The old one collapsed Type 0 and Type 1 into one
// bucket and never tested the non-contracting condition at all, so a
// genuinely context-sensitive grammar and an unrestricted one came back
// described identically.

test('a right-linear grammar is Type 3', () => {
  const c = classify(G('S -> a S | b'));
  assert.equal(c.type, 3);
  assert.ok(c.rightLinear);
  assert.ok(!c.leftLinear);
});

test('a left-linear grammar is Type 3 too', () => {
  const c = classify(G('S -> S a | b'));
  assert.equal(c.type, 3);
  assert.ok(c.leftLinear);
});

test('mixing the two orientations is Type 2, not Type 3', () => {
  const c = classify(G('S -> a A | B b\nA -> a\nB -> b'));
  assert.equal(c.type, 2);
  assert.ok(c.blockers.regular, 'and the rule that blocks it is named');
});

test('a context-free grammar that is not linear is Type 2', () => {
  assert.equal(classify(G('S -> a S b | ε')).type, 2);
});

test('a non-contracting grammar with context on the left is Type 1', () => {
  const c = classify(G('S -> a S B C | a B C\nC B -> B C\na B -> a b\nb B -> b b\nb C -> b c\nc C -> c c'));
  assert.equal(c.type, 1, 'aⁿbⁿcⁿ is context-sensitive and not context-free');
  assert.ok(!c.contextFree);
  assert.ok(c.nonContracting);
  assert.equal(c.blockers.contextFree.lhsArr.length, 2, 'the rule with two symbols on the left');
});

test('a contracting rule drops the grammar to Type 0', () => {
  const c = classify(G('S -> A B c\nA B -> ε'));
  assert.equal(c.type, 0);
  assert.ok(!c.nonContracting);
  assert.ok(c.blockers.contextSensitive, 'and the contracting rule is named');
});

test('S → ε is allowed in a Type 1 grammar, but only while S is on no right-hand side', () => {
  assert.equal(classify(G('S -> a b | ε')).nonContracting, true,
    'the standard exception: ε ∈ L(G) has to stay expressible');
  assert.equal(classify(G('S -> a S b | ε')).nonContracting, false,
    'with S on a right-hand side the surviving S → ε could shorten a sentential form mid-derivation, which is exactly why the CNF conversion introduces a fresh start symbol first');
  assert.equal(classify(G('S -> A\nA -> ε')).nonContracting, false,
    'A → ε shortens and A is not the start symbol');
});

// ── Normal-form membership ────────────────────────────────────────

test('CNF membership is exact about both shapes', () => {
  assert.equal(cnfViolations(G('S -> A B | a\nA -> a\nB -> b')).length, 0);
  assert.equal(cnfViolations(G('S -> A B C')).length, 1, 'three symbols is not CNF');
  assert.equal(cnfViolations(G('S -> A\nA -> a')).length, 1, 'a unit rule is not CNF');
  assert.equal(cnfViolations(G('S -> a B\nB -> b')).length, 1, 'a mixed pair is not CNF');
});

test('GNF membership wants one terminal then variables only', () => {
  assert.equal(gnfViolations(G('S -> a S B | a\nB -> b')).length, 0);
  assert.equal(gnfViolations(G('S -> S a')).length, 1);
  assert.equal(gnfViolations(G('S -> a b')).length, 1, 'a second terminal is not allowed');
});

// ── Emptiness and finiteness ──────────────────────────────────────

test('a grammar whose start symbol generates nothing has an empty language', () => {
  const g = G('S -> A B\nA -> a A\nB -> b');
  assert.ok(!generatingSet(g).has('S'));
  assert.ok(properties(g).empty);
});

test('finiteness turns on a cycle through symbols that are both reachable and generating', () => {
  assert.ok(usefulCycle(G('S -> a S b | ε')), 'aⁿbⁿ is infinite');
  assert.equal(usefulCycle(G('S -> a | b b')), null, 'a two-word language has no cycle');
  // A cycle that generates nothing must not count, or every dead branch would
  // make a finite language look infinite.
  assert.equal(usefulCycle(G('S -> a\nB -> b B')), null);
});

test('the Overview’s properties agree with the individual analyses', () => {
  const g = G('S -> A | ε\nA -> B | a\nB -> A b | b');
  const P = properties(g);
  assert.deepEqual(sorted(P.nullable), sorted(nullableSet(g)));
  assert.deepEqual(sorted(P.generating), sorted(generatingSet(g)));
  assert.equal(P.epsRules.length, 1);
  assert.equal(P.unitRules.length, 2, 'S → A and A → B');
  assert.equal(P.derivesEmpty, true);
  assert.equal(P.classify.type, classify(g).type);
});

// ── Reached through the harness, the way the app reaches it ───────

test('the analyses are exported through the harness and read App.grammar’s model', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S -> a S b | ε');
  h.context.writeGrammar(grammar);
  const g = h.context.readGrammar();
  assert.equal(h.context.classify(g).type, 2);
  assert.ok(h.context.nullableSet(g).has('S'));
});
