import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGrammarText } from '../js/grammar/parse.js';
import { cnfViolations, gnfViolations, leftRecursionCycles } from '../js/grammar/analysis.js';
import { member } from '../js/grammar/parsing.js';
import {
  leftFactor, removeEpsilon, removeLeftRecursion, removeUnit, removeUseless, toCNF, toGNF
} from '../js/grammar/transform.js';

// The transforms.
//
// **Every one of these claims to leave L(G) unchanged, so that is what is
// tested** — not the shape of the output. `sameLanguage` enumerates every word
// over the grammar's terminals up to a length and compares the two verdicts
// word for word, which catches the failure a shape check cannot: a conversion
// that produces a perfectly well-formed CNF grammar for a different language.
//
// The other half is that each transform actually achieves what it is named
// for. GNF is the one that matters most: the tool this replaced printed which
// rules already started with a terminal and stopped, under a note calling
// itself a "simplified pedagogical version".

const G = text => {
  const p = parseGrammarText(text);
  return { vars: p.vars, start: p.start, rules: p.rules };
};

/** Σ(G), as the transforms leave it — a fresh variable is never a terminal. */
function alphabet(g) {
  const t = new Set();
  g.rules.forEach(r => r.rhsArr.forEach(s => { if (!g.vars.has(s)) t.add(s); }));
  return [...t].sort();
}

/** Every word over `syms` of length ≤ n, shortest first, ε included. */
function allWords(syms, n) {
  let level = [[]];
  const out = [[]];
  for (let i = 0; i < n; i++) {
    const next = [];
    level.forEach(w => syms.forEach(s => next.push([...w, s])));
    next.forEach(w => out.push(w));
    level = next;
  }
  return out;
}

/**
 * The two grammars decide every short word the same way. The alphabet is the
 * *union*, so a transform that quietly dropped a terminal is caught by the
 * words that used it rather than passing because neither grammar was asked.
 */
function sameLanguage(a, b, n = 5) {
  const syms = [...new Set([...alphabet(a), ...alphabet(b)])].sort();
  const words = allWords(syms, n);
  const differ = words.filter(w => member(a, w).accepted !== member(b, w).accepted);
  assert.deepEqual(
    differ.map(w => w.join('') || 'ε'), [],
    `these words are decided differently by the two grammars (Σ = {${syms.join(', ')}})`);
  assert.ok(words.some(w => member(a, w).accepted),
    'the check is vacuous unless at least one word is in the language');
}

const CASES = [
  ['aⁿbⁿ', 'S -> a S b | ε'],
  ['balanced parentheses', 'S -> ( S ) | S S | ε'],
  ['equal a and b', 'S -> a S b S | b S a S | ε'],
  ['unit chain with ε-rules', 'S -> A | ε\nA -> B | a\nB -> A b | b'],
  ['Sipser 2.10', 'S -> A S A | a B\nA -> B | S\nB -> b | ε'],
  ['even palindromes', 'S -> a S a | b S b | ε']
];

// ── The language is preserved ─────────────────────────────────────

for (const [name, text] of CASES) {
  test(`ε-removal preserves the language — ${name}`, () => {
    sameLanguage(G(text), removeEpsilon(G(text)).grammar);
  });
  test(`unit removal preserves the language — ${name}`, () => {
    sameLanguage(G(text), removeUnit(G(text)).grammar);
  });
  test(`useless-symbol removal preserves the language — ${name}`, () => {
    sameLanguage(G(text), removeUseless(G(text)).grammar);
  });
  test(`CNF preserves the language — ${name}`, () => {
    sameLanguage(G(text), toCNF(G(text)).grammar);
  });
  test(`GNF preserves the language — ${name}`, () => {
    sameLanguage(G(text), toGNF(G(text)).grammar, 4);
  });
}

for (const [name, text] of [
  ['direct', 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | i'],
  ['indirect', 'S -> A a | b\nA -> A c | S d | f']
]) {
  test(`left-recursion removal preserves the language — ${name}`, () => {
    sameLanguage(G(text), removeLeftRecursion(G(text)).grammar, 4);
  });
  test(`left factoring preserves the language — ${name}`, () => {
    sameLanguage(G(text), leftFactor(G(text)).grammar, 4);
  });
}

// ── And each does what it is named for ────────────────────────────

test('ε-removal leaves no ε-rule when ε is not in the language', () => {
  const res = removeEpsilon(G('S -> A B\nA -> a | ε\nB -> b'));
  assert.deepEqual(res.grammar.rules.filter(r => !r.rhsArr.length), []);
  assert.ok(res.grammar.rules.some(r => r.lhs === 'S' && r.rhsArr.join(' ') === 'B'),
    'the A-less variant of S → A B takes its place');
});

test('ε-removal keeps exactly one ε-rule when ε is in the language', () => {
  const res = removeEpsilon(G('S -> A B\nA -> a | ε\nB -> b | ε'));
  const epsRules = res.grammar.rules.filter(r => !r.rhsArr.length);
  assert.deepEqual(epsRules.map(r => r.lhs), ['S'],
    'every variable here is nullable, so ε ∈ L(G) and the start symbol keeps its rule');
});

test('ε-removal keeps ε when the language contains it, behind a fresh start if needed', () => {
  const res = removeEpsilon(G('S -> a S b | ε'));
  const epsRules = res.grammar.rules.filter(r => !r.rhsArr.length);
  assert.equal(epsRules.length, 1);
  assert.equal(epsRules[0].lhs, res.grammar.start);
  assert.notEqual(res.grammar.start, 'S', 'S was on a right-hand side, so a fresh start was needed');
  assert.ok(res.notes.some(n => /fresh start/i.test(n)), 'and the reader is told why');
});

test('unit removal leaves no A → B', () => {
  const g = removeUnit(G('S -> A | a\nA -> B | b\nB -> c')).grammar;
  assert.equal(g.rules.filter(r => r.rhsArr.length === 1 && g.vars.has(r.rhsArr[0])).length, 0);
});

test('useless removal drops both kinds, in the order that works', () => {
  const res = removeUseless(G('S -> a | B\nB -> b B\nC -> c'));
  assert.ok(!res.grammar.vars.has('B'), 'B derives nothing');
  assert.ok(!res.grammar.vars.has('C'), 'C is unreachable');
  assert.equal(res.stages.length, 2, 'and each pass is shown separately');
});

test('a grammar whose start symbol is useless reduces to nothing, and says so', () => {
  const res = removeUseless(G('S -> A B\nA -> a A\nB -> b'));
  assert.equal(res.grammar.rules.length, 0);
  assert.ok(res.notes.some(n => /L\(G\) = ∅/.test(n)));
});

for (const [name, text] of CASES) {
  test(`CNF output is in Chomsky normal form — ${name}`, () => {
    const g = toCNF(G(text)).grammar;
    assert.deepEqual(cnfViolations(g).map(r => `${r.lhs} → ${r.rhs}`), []);
  });
  test(`GNF output is in Greibach normal form — ${name}`, () => {
    const g = toGNF(G(text)).grammar;
    assert.deepEqual(gnfViolations(g).map(r => `${r.lhs} → ${r.rhs}`), [],
      'every rule must be A → a α, which is the thing the old tool never actually did');
  });
}

test('CNF is idempotent', () => {
  const once = toCNF(G('S -> A S A | a B\nA -> B | S\nB -> b | ε')).grammar;
  const twice = toCNF(once).grammar;
  assert.deepEqual(cnfViolations(twice), []);
  sameLanguage(once, twice);
});

test('left-recursion removal removes the indirect kind too', () => {
  const g = removeLeftRecursion(G('S -> A a | b\nA -> A c | S d | f')).grammar;
  assert.deepEqual(leftRecursionCycles(g), [],
    'a rewrite of one rule leaves S ⇒ A ⇒ S exactly as recursive as it found it');
});

test('a variable whose every alternative is left-recursive is left alone, and the reason given', () => {
  const res = removeLeftRecursion(G('S -> S a'));
  assert.deepEqual(res.blocked, ['S']);
  assert.ok(res.notes.some(n => /S/.test(n) && /language/.test(n)),
    'there is no non-recursive alternative to anchor the rewrite on, so rewriting would change the language');
  assert.ok(res.grammar.rules.some(r => r.lhs === 'S' && r.rhsArr.join(' ') === 'S a'),
    'the rule survives unchanged');
});

test('left factoring pulls out the whole shared prefix, not one symbol of it', () => {
  const res = leftFactor(G('S -> i E t S | i E t S e S | a\nE -> b'));
  assert.equal(res.stages.length, 1, 'four shared symbols, one fresh variable');
  const factored = res.grammar.rules.find(r => r.lhs === 'S' && r.rhsArr[0] === 'i');
  assert.deepEqual(factored.rhsArr, ['i', 'E', 't', 'S', "S'"]);
});

test('left factoring reports when there is nothing to do', () => {
  const res = leftFactor(G('S -> a S | b'));
  assert.equal(res.stages.length, 0);
  assert.ok(res.notes.length);
});

// ── Every transform is pure ───────────────────────────────────────

test('a transform never mutates the grammar it was handed', () => {
  const original = 'S -> A S A | a B\nA -> B | S\nB -> b | ε';
  for (const fn of [removeEpsilon, removeUnit, removeUseless, toCNF, toGNF, removeLeftRecursion, leftFactor]) {
    const g = G(original);
    const before = JSON.stringify({ start: g.start, vars: [...g.vars].sort(), rules: g.rules });
    fn(g);
    const after = JSON.stringify({ start: g.start, vars: [...g.vars].sort(), rules: g.rules });
    assert.equal(after, before, `${fn.name} mutated its input`);
  }
});

test('every stage carries a grammar of its own, so the construction can be read', () => {
  const res = toCNF(G('S -> A S A | a B\nA -> B | S\nB -> b | ε'));
  assert.ok(res.stages.length >= 5, 'START, DEL, UNIT, TERM, BIN');
  res.stages.forEach(s => {
    assert.ok(s.label, 'a stage needs a name');
    assert.ok(s.grammar && Array.isArray(s.grammar.rules), 'and the grammar it left behind');
  });
  // The last stage is the result, or the reader is being shown a construction
  // that ends somewhere other than where the answer is.
  const last = res.stages[res.stages.length - 1];
  assert.deepEqual(last.grammar.rules.map(r => r.rhs), res.grammar.rules.map(r => r.rhs));
});
