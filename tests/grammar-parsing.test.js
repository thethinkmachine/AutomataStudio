import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGrammarText } from '../js/grammar/parse.js';
import {
  ambiguityWitness, cykFrames, cykTable, derivationOf, generateWords,
  ll1Table, ll1Trace, member, parseTrees, treeSignature
} from '../js/grammar/parsing.js';
import { toCNF } from '../js/grammar/transform.js';
import { frontier, layoutTree } from '../js/grammar/tree.js';

// Parsing: membership, derivations, trees, ambiguity, LL(1) and enumeration.
//
// **The two engines and why there are two.** CYK decides membership: it is
// cubic, total, and defined on Chomsky normal form. Everything a reader
// *reads* — a derivation, a tree, an ambiguity witness — has to be about the
// grammar they wrote, so those come from a separate top-down search over the
// original rules. A CNF parse tree is binary and full of X₁ and T_a and
// shares no shape with the one in the textbook.
//
// Three things the old view got wrong are pinned here: a derivation picked its
// productions at *random* (`prods[Math.floor(Math.random() * …)]`), so it was
// a derivation of nothing in particular; a parse tree always took `prods[0]`,
// so it drew a tree for an arbitrary word rather than the one you typed; and
// the two were unrelated to each other and to the ambiguity check.

const G = text => {
  const p = parseGrammarText(text);
  return { vars: p.vars, start: p.start, rules: p.rules };
};
const w = s => (s ? s.split('') : []);

const ANBN = G('S -> a S b | ε');
const BALANCED = G('S -> ( S ) | S S | ε');
const AMBIG = G('E -> E + E | E * E | i');
const LL1 = G("E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | i");

// ── Membership ────────────────────────────────────────────────────

test('CYK decides membership, ε included', () => {
  for (const [word, expected] of [['ab', true], ['aabb', true], ['aab', false], ['ba', false], ['', true]]) {
    assert.equal(member(ANBN, w(word)).accepted, expected, `aⁿbⁿ on "${word || 'ε'}"`);
  }
  assert.equal(member(G('S -> a S b'), []).accepted, false, 'ε ∉ L when no rule derives it');
});

test('the CYK table holds the variables deriving each span', () => {
  const cnf = toCNF(ANBN).grammar;
  const { cells } = cykTable(cnf, w('aabb'));
  assert.ok(cells[0][3].has(cnf.start), 'the whole-word cell holds the start symbol');
  assert.equal(cells[0][2].size, 0, '"aab" is derived by nothing');
});

test('the step-through frames end at the finished table', () => {
  const cnf = toCNF(ANBN).grammar;
  const frames = cykFrames(cnf, w('aabb'));
  const final = frames[frames.length - 1].cells;
  const { cells } = cykTable(cnf, w('aabb'));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      assert.deepEqual([...final[i][j]].sort(), [...cells[i][j]].sort(), `cell ${i},${j}`);
    }
  }
});

test('every frame carries a note and a table of its own, so scrubbing needs no re-run', () => {
  const frames = cykFrames(toCNF(ANBN).grammar, w('aabb'));
  assert.ok(frames.length > 4);
  frames.forEach(f => {
    assert.ok(f.note, 'a frame has to say what it did');
    assert.ok(Array.isArray(f.cells));
  });
  // The snapshots are independent: mutating one must not reach the next.
  frames[0].cells[0][0].add('ZZZ');
  assert.ok(!frames[1].cells[0][0].has('ZZZ'));
});

// ── Trees and derivations ─────────────────────────────────────────

test('a parse tree derives the word it was asked about', () => {
  const { trees } = parseTrees(ANBN, w('aabb'), 1);
  assert.equal(trees.length, 1);
  assert.deepEqual(frontier(trees[0]), ['a', 'a', 'b', 'b'],
    'the tree the old view drew always took the first production, so its frontier was some other word');
});

test('a word not in the language has no tree', () => {
  assert.equal(parseTrees(ANBN, w('aab'), 1).trees.length, 0);
});

test('the leftmost and rightmost derivations are two readings of one tree', () => {
  const { trees } = parseTrees(ANBN, w('aabb'), 1);
  const left = derivationOf(trees[0], 'leftmost');
  const right = derivationOf(trees[0], 'rightmost');
  assert.equal(left.length, right.length, 'the same rules are applied, in a different order');
  assert.deepEqual(left[0].form, ['S']);
  assert.deepEqual(left[left.length - 1].form, ['a', 'a', 'b', 'b']);
  assert.deepEqual(right[right.length - 1].form, ['a', 'a', 'b', 'b']);
});

test('a derivation is of the word, and its every step is a rule of the grammar', () => {
  const { trees } = parseTrees(BALANCED, w('(())'), 1);
  const steps = derivationOf(trees[0]);
  steps.slice(1).forEach(s => {
    assert.ok(s.rule, 'every step past the first applies a rule');
    assert.ok(BALANCED.rules.includes(s.rule), 'and it is one of this grammar’s rules');
  });
});

test('the leftmost derivation expands the leftmost variable, every time', () => {
  const { trees } = parseTrees(BALANCED, w('()()'), 1);
  derivationOf(trees[0], 'leftmost').slice(1).forEach((step, i, all) => {
    const before = i === 0 ? ['S'] : all[i - 1].form;
    const firstVar = before.findIndex(s => BALANCED.vars.has(s));
    assert.equal(step.at, firstVar === -1 ? step.at : firstVar);
  });
});

test('a derivation is deterministic — the same call gives the same steps', () => {
  const a = derivationOf(parseTrees(ANBN, w('aabb'), 1).trees[0]);
  const b = derivationOf(parseTrees(ANBN, w('aabb'), 1).trees[0]);
  assert.deepEqual(a.map(s => s.form), b.map(s => s.form),
    'the old derivation chose its production at random and gave a different answer each press');
});

// ── Ambiguity ─────────────────────────────────────────────────────

test('two structurally different trees are a conclusive ambiguity witness', () => {
  const res = ambiguityWitness(AMBIG, w('i+i*i'));
  assert.ok(res.ambiguous);
  assert.equal(res.trees.length, 2);
  assert.notEqual(treeSignature(res.trees[0]), treeSignature(res.trees[1]));
  res.trees.forEach(t => assert.deepEqual(frontier(t), w('i+i*i'),
    'both witnesses have to be trees for the same word, or they witness nothing'));
});

test('an unambiguous grammar yields one tree, and the result says so', () => {
  const res = ambiguityWitness(LL1, w('i+i*i'));
  assert.equal(res.ambiguous, false);
  assert.equal(res.trees.length, 1);
});

test('a word outside the language yields no witness at all', () => {
  const res = ambiguityWitness(AMBIG, w('i+'));
  assert.equal(res.trees.length, 0);
  assert.equal(res.ambiguous, false);
});

// ── LL(1) ─────────────────────────────────────────────────────────

test('the LL(1) table of an LL(1) grammar has no conflicts', () => {
  const t = ll1Table(LL1);
  assert.ok(t.isLL1);
  assert.deepEqual(t.conflicts, []);
  assert.deepEqual(t.table.get("E|i").map(r => r.rhs), ["T E'"]);
});

test('a conflicted cell reports every rule competing for it, not the first arrival', () => {
  const t = ll1Table(AMBIG);
  assert.ok(!t.isLL1);
  const c = t.conflicts[0];
  assert.ok(c.rules.length > 1, 'which rules collide is the whole content of "not LL(1)"');
});

test('left recursion shows up as a conflict', () => {
  assert.ok(!ll1Table(G('E -> E + T | T\nT -> i')).isLL1);
});

test('the predictive parse accepts a word in the language and rejects one outside it', () => {
  const t = ll1Table(LL1);
  assert.equal(ll1Trace(LL1, w('i+i*i'), t).status, 'accept');
  const bad = ll1Trace(LL1, w('i+*'), t);
  assert.equal(bad.status, 'reject');
  assert.equal(bad.rows[bad.rows.length - 1].kind, 'error', 'and the row that failed is marked');
});

test('every trace row carries the stack and the input left, which is what makes it readable', () => {
  const rows = ll1Trace(LL1, w('i'), ll1Table(LL1)).rows;
  rows.forEach(r => {
    assert.ok(Array.isArray(r.stack) && r.stack.length);
    assert.ok(Array.isArray(r.rest) && r.rest[r.rest.length - 1] === '$');
    assert.ok(r.action);
  });
});

// ── Enumeration ───────────────────────────────────────────────────

test('generated words are the shortest ones, in order', () => {
  const res = generateWords(ANBN, { count: 5 });
  assert.deepEqual(res.words.map(x => x.join('') || 'ε'), ['ε', 'ab', 'aabb', 'aaabbb', 'aaaabbbb']);
  assert.equal(res.complete, false, 'aⁿbⁿ is infinite, and the result must not claim otherwise');
});

test('every generated word really is in the language', () => {
  for (const g of [ANBN, BALANCED, LL1]) {
    generateWords(g, { count: 12, maxLen: 8 }).words.forEach(word => {
      assert.ok(member(g, word).accepted, `"${word.join('') || 'ε'}" was generated but CYK rejects it`);
    });
  }
});

test('a finite language is enumerated completely, and reports that it was', () => {
  const res = generateWords(G('S -> a | b b | c'), { count: 40, maxLen: 10 });
  assert.deepEqual(res.words.map(x => x.join('')).sort(), ['a', 'bb', 'c']);
  assert.equal(res.complete, true);
});

test('an empty language generates nothing rather than looping', () => {
  const res = generateWords(G('S -> A B\nA -> a A\nB -> b'), { count: 5, maxLen: 8 });
  assert.deepEqual(res.words, []);
});

// ── Layout ────────────────────────────────────────────────────────

test('the tree layout places every node inside the box it reports', () => {
  const { trees } = parseTrees(BALANCED, w('(())'), 1);
  const L = layoutTree(trees[0]);
  assert.ok(L.w > 0 && L.h > 0);
  L.nodes.forEach(n => {
    assert.ok(n.x - n.w / 2 >= 0, `${n.sym} runs off the left edge`);
    assert.ok(n.x + n.w / 2 <= L.w, `${n.sym} runs off the right edge`);
    assert.ok(n.y >= 0 && n.y <= L.h);
  });
});

test('siblings on one row never overlap', () => {
  const { trees } = parseTrees(AMBIG, w('i+i*i'), 1);
  const L = layoutTree(trees[0]);
  const rows = new Map();
  L.nodes.forEach(n => {
    if (!rows.has(n.y)) rows.set(n.y, []);
    rows.get(n.y).push(n);
  });
  rows.forEach((row, y) => {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i].x - row[i].w / 2 >= row[i - 1].x + row[i - 1].w / 2 - 0.01,
        `${row[i - 1].sym} and ${row[i].sym} overlap on row ${y}`);
    }
  });
});

test('an ε-rule still draws a child, so an expanded variable never looks unexpanded', () => {
  const { trees } = parseTrees(ANBN, w('ab'), 1);
  const L = layoutTree(trees[0], { eps: 'ε' });
  assert.ok(L.nodes.some(n => n.kind === 'eps'));
  assert.deepEqual(frontier(trees[0], 'ε'), ['a', 'b'], 'but it contributes nothing to the word');
});
