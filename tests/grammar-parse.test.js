import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { formatRules, meansEmpty, parseGrammarText, tokenizeSymbols } from '../js/grammar/parse.js';
import { ReactiveSet } from '../js/reactive.js';

// The grammar parser.
//
// The property everything else rests on is that **a grammar's meaning does not
// depend on the order its rules are written in.** The parser this replaced
// tokenized right-hand sides against a variable set it was filling in the same
// loop, so `S → AB` above `AB → a` meant two symbols and below it meant one.
// Half this file is that one invariant, stated from several directions.
//
// parse.js is import-free and App-free (ε arrives as an option), so most of
// these need no harness at all.

const tokens = g => g.rules.map(r => r.rhsArr);

test('a rule is split into symbols by the declared vocabulary, longest first', () => {
  assert.deepEqual(tokenizeSymbols('aSb', ['S']), ['a', 'S', 'b']);
  assert.deepEqual(tokenizeSymbols('aExprb', ['Expr', 'E']), ['a', 'Expr', 'b']);
  assert.deepEqual(tokenizeSymbols('abc', []), ['a', 'b', 'c']);
});

test('whitespace separates symbols wherever it appears', () => {
  assert.deepEqual(tokenizeSymbols('a S b', []), ['a', 'S', 'b']);
  assert.deepEqual(tokenizeSymbols('  a\tS  ', []), ['a', 'S']);
});

test('a bracket form is always exactly one symbol', () => {
  assert.deepEqual(tokenizeSymbols('[q0,A,q1]x', []), ['[q0,A,q1]', 'x']);
  assert.deepEqual(tokenizeSymbols('<Expr><Term>', []), ['<Expr>', '<Term>']);
  // An unclosed bracket is a bracket character, not a symbol that swallows
  // the rest of the line.
  assert.deepEqual(tokenizeSymbols('[ab', []), ['[', 'a', 'b']);
});

test('the meaning of a rule does not depend on where it is written', () => {
  const above = parseGrammarText('S -> AB\nAB -> a');
  const below = parseGrammarText('AB -> a\nS -> AB');
  // Same rules, opposite order — so compare the rule for S in each.
  const sOf = g => g.rules.find(r => r.lhs === 'S').rhsArr;
  assert.deepEqual(sOf(above), ['AB']);
  assert.deepEqual(sOf(below), ['AB'], 'AB is one symbol whichever line defines it');
});

test('a left-hand side with whitespace is several symbols — the Type 1 shape', () => {
  const g = parseGrammarText('S -> A B\nA B -> b a');
  const cs = g.rules.find(r => r.lhsArr.length > 1);
  assert.deepEqual(cs.lhsArr, ['A', 'B']);
  assert.deepEqual(cs.rhsArr, ['b', 'a']);
});

test('a multi-character alphanumeric run with no variable in it is one terminal', () => {
  const g = parseGrammarText('E -> E + T | T\nT -> id');
  assert.deepEqual(g.rules.find(r => r.lhs === 'T').rhsArr, ['id'],
    '`id` is the commonest terminal in every textbook grammar and must not become {i, d}');
  // And it is announced rather than applied silently, because the rule can be
  // wrong and a space is the way to say the other thing.
  assert.ok(g.diagnostics.some(d => d.kind === 'info' && /id/.test(d.msg)));
});

test('a run containing a variable still splits', () => {
  const g = parseGrammarText('S -> aSb | ε');
  assert.deepEqual(tokens(g)[0], ['a', 'S', 'b']);
});

test('ε is written any of the usual ways and is always the empty sequence', () => {
  for (const spelling of ['ε', 'eps', 'EPSILON', 'lambda', 'λ']) {
    const g = parseGrammarText(`S -> a | ${spelling}`);
    assert.deepEqual(g.rules[1].rhsArr, [], `${spelling} should parse as the empty word`);
  }
  assert.equal(meansEmpty('∅'), false, '∅ is the empty language, not the empty word');
});

test('ε inside a longer right-hand side is dropped, and said so', () => {
  const g = parseGrammarText('S -> a ε b');
  assert.deepEqual(g.rules[0].rhsArr, ['a', 'b']);
  assert.ok(g.diagnostics.some(d => d.kind === 'warn'));
});

test('every arrow spelling is accepted', () => {
  for (const arrow of ['->', '-->', '→', '::=', '=>']) {
    const g = parseGrammarText(`S ${arrow} a`);
    assert.equal(g.rules.length, 1, `${arrow} should be read as an arrow`);
  }
});

test('a malformed line is reported with its line number, not swallowed', () => {
  const g = parseGrammarText('S -> a\nthis is not a rule\nS -> b');
  const bad = g.diagnostics.find(d => d.kind === 'error');
  assert.equal(bad.line, 2);
  assert.equal(g.rules.length, 2, 'the rules either side of it still parse');
});

test('an empty right-hand side and an empty alternative are both errors', () => {
  assert.ok(parseGrammarText('S ->').diagnostics.some(d => d.kind === 'error'));
  assert.ok(parseGrammarText('S -> a |').diagnostics.some(d => d.kind === 'error'));
});

test('a repeated rule is reported and stored once', () => {
  const g = parseGrammarText('S -> a\nS -> a');
  assert.equal(g.rules.length, 1);
  assert.ok(g.diagnostics.some(d => d.kind === 'warn'));
});

test('comments and blank lines are skipped without complaint', () => {
  const g = parseGrammarText('# a comment\n\n// another\nS -> a');
  assert.equal(g.rules.length, 1);
  assert.equal(g.diagnostics.length, 0);
});

test('the start symbol is the first rule’s left-hand side', () => {
  assert.equal(parseGrammarText('A -> a\nS -> b').start, 'A');
});

test('formatting round-trips: the canonical text reparses to the same rules', () => {
  const source = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
  const first = parseGrammarText(source);
  const text = formatRules(first.rules, first.start);
  const second = parseGrammarText(text);
  assert.deepEqual(tokens(second), tokens(first));
  assert.deepEqual(formatRules(second.rules, second.start), text, 'and formatting is idempotent');
});

test('the canonical text puts the start symbol first', () => {
  const g = parseGrammarText('A -> a S\nS -> b');
  const text = formatRules(g.rules, 'S');
  assert.ok(text.startsWith('S →'), text);
});

// ── The App seam ──────────────────────────────────────────────────

test('a legacy production carrying no rhsArr is re-read against the declared variables', () => {
  const h = createHarness();
  h.context.loadData({
    machine: 'DFA', sigma: ['a'], states: [], transitions: [], startId: null, accepts: [],
    grammar: { vars: ['S'], start: 'S', productions: [{ lhs: 'S', rhs: 'a' }] }
  });
  assert.deepEqual(h.context.App.grammar.productions[0].rhsArr, ['a']);
  const g = h.context.readGrammar();
  assert.equal(g.start, 'S');
  assert.deepEqual(g.rules[0].rhsArr, ['a']);
});

test('reading and writing App.grammar round-trips the model', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  const back = h.context.readGrammar();
  assert.equal(h.context.grammarText(back), h.context.grammarText(grammar));
  assert.ok(h.context.App.grammar.vars.has('S'));
});

test('writing the grammar keeps App.grammar.vars reactive', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a');
  h.context.writeGrammar(grammar);
  assert.ok(h.context.App.grammar.vars instanceof ReactiveSet,
    'state.js installs a coercing accessor; writing a plain Set must not downgrade the field');
});

test('a word is tokenized against the grammar’s own alphabet, and an unknown symbol is named', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('E -> E + T | T\nT -> id');
  assert.deepEqual(h.context.tokenizeWord('id+id', grammar).tokens, ['id', '+', 'id']);
  const bad = h.context.tokenizeWord('id&id', grammar);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, '&', 'the tool has to be able to say which symbol was unknown');
});

// ══════════════════════════════════════════════════════════════════
//  V IS NOT EVERY SYMBOL ON A LEFT-HAND SIDE
// ══════════════════════════════════════════════════════════════════
//  A Type 1 left-hand side is αAβ, and α and β are ordinarily terminals.
//  Reading them all as variables emptied Σ(G) for the bundled aⁿbⁿcⁿ grammar,
//  which made its own declared test words unreadable by its own tools.

const CS = 'S → a S B C | a B C\nC B → B C\na B → a b\nb B → b b\nb C → b c\nc C → c c';

test('a context-sensitive left-hand side keeps its terminals out of V', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText(CS);
  assert.deepEqual([...grammar.vars].sort(), ['B', 'C', 'S']);
  assert.deepEqual([...h.context.terminalsOf(grammar)].sort(), ['a', 'b', 'c']);
});

test('the guess a longer left-hand side forces is announced', () => {
  const h = createHarness();
  const { diagnostics } = h.context.grammarFromText(CS);
  const said = diagnostics.map(d => d.msg).join(' ');
  assert.match(said, /<code>B<\/code> is read as a variable/);
  assert.match(said, /<code>C<\/code> is read as a variable/);
});

test('V survives the round trip through App.grammar', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText(CS);
  h.context.writeGrammar(grammar);
  const back = h.context.readGrammar();
  assert.deepEqual([...back.vars].sort(), ['B', 'C', 'S'],
    'readGrammar runs on every render, so its answer is the one the view shows');
  assert.deepEqual([...h.context.terminalsOf(back)].sort(), ['a', 'b', 'c']);
});

test('a context-free grammar’s V is untouched by the rule', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | A\nA → c');
  assert.deepEqual([...grammar.vars].sort(), ['A', 'S']);
  assert.deepEqual([...h.context.terminalsOf(grammar)].sort(), ['a', 'b', 'c']);
});

test('every bundled example can read the words it declares', () => {
  const h = createHarness();
  h.context.GrammarExamples.forEach(ex => {
    const { grammar, diagnostics } = h.context.grammarFromText(ex.text);
    assert.equal(diagnostics.filter(d => d.kind === 'error').length, 0,
      `${ex.id} does not parse cleanly`);
    (ex.words || []).forEach(w => {
      assert.ok(h.context.tokenizeWord(w, grammar).ok,
        `${ex.id} declares ${JSON.stringify(w)}, which its own grammar cannot read`);
    });
  });
});
