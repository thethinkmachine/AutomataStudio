import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

function withSigma(h, symbols) {
  h.context.App.sigma = new Set(symbols);
}

// SymSuggest is a plain module export, so the test can set it directly.
function setSymSuggest(h, target, state) {
  h.context.SymSuggest.target = target;
  h.context.SymSuggest.state = state;
}

function makeInput(h, id, value = '') {
  const el = h.getElement(id);
  el.value = value;
  el.selectionStart = value.length;
  el.focus = () => {};
  el.setSelectionRange = (s) => { el.selectionStart = s; };
  return el;
}

// Compares structure only: the JSON round-trip drops undefined-valued keys and
// any methods the suggestion objects carry, so these assertions stay about the
// shape that matters rather than the exact object identity.
function assertShape(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}

test('empty field offers every Σ symbol plus ε last', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('', true);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1', 'ε'], allSyms: ['0', '1'] });
});

test('non-empty field does not offer ε (ε means "whole field empty")', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('', false);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1'], allSyms: ['0', '1'] });
});

test('typed prefix filters to matching symbols', () => {
  const h = createHarness();
  withSigma(h, ['aab', 'ab', 'b']);
  const state = h.context.computeResidueState('a', true);
  assert.equal(state.mode, 'filter');
  assertShape(state.candidates, ['aab', 'ab']);
});

test('completing the only matching symbol advances to the next-token palette', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('0', true);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1'], allSyms: ['0', '1'] });
});

test('a residue matching no symbol prefix is an error', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('2', true);
  assertShape(state, { mode: 'error', residue: '2', candidates: [], alphabetLabel: 'Σ' });
});

test('an invalid earlier segment is flagged separately from the current residue', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('01x 1', true);
  assertShape(state, { mode: 'error', residue: '', candidates: [], earlier: true, alphabetLabel: 'Σ' });
});

test('a residue that itself decomposes cleanly (concatenated alphabet) needs no suggestion', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('01', true);
  assertShape(state, { mode: 'none' });
});

test('literal ε character is already-complete input', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  assertShape(h.context.computeResidueState('ε', true), { mode: 'none' });
});

test('"eps" and "epsilon" (case-insensitive) are recognized like the ε chip, matching parseEps() at Run time', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  assertShape(h.context.computeResidueState('eps', true), { mode: 'none' });
  assertShape(h.context.computeResidueState('EPSILON', true), { mode: 'none' });
  assertShape(h.context.computeResidueState(' Eps ', true), { mode: 'none' });
});

test('a genuine typo toward "eps" (e.g. a lone "e") still errors, since parseEps would not resolve it either', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const state = h.context.computeResidueState('e', true);
  assert.equal(state.mode, 'error');
});

test('candidates are ordered longest-first, matching tokenize()\'s own greedy match order', () => {
  const h = createHarness();
  withSigma(h, ['1', '10', '100']);
  const state = h.context.computeResidueState('1', false);
  assertShape(state.candidates, ['100', '10', '1']);
});

test('reserved marker symbols never appear as suggestion candidates even if present in Σ', () => {
  const h = createHarness();
  const sym = h.context.App.config.sym;
  withSigma(h, ['0', '1', sym.any, sym.blank, sym.stackBottom, sym.lambda]);
  const state = h.context.computeResidueState('', true);
  assertShape(state.candidates, ['0', '1', 'ε']);
});

test('sim input: getSimSuggestState scopes residue to the caret position, ignoring text after it', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const el = h.getElement('sim-in');
  el.value = '0 1'; // caret sits right after the first "0", well before the trailing "1"
  el.selectionStart = 1;
  const state = h.context.getSimSuggestState(el);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1'], allSyms: ['0', '1'], prefixEnd: 1, replaceEnd: 1 });
});

test('batch input: suggestions are scoped to the current line only', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const el = h.getElement('batch-in');
  el.value = '01\n1';
  el.selectionStart = 4; // caret at end, on the second line
  const state = h.context.getBatchSuggestState(el);
  assert.equal(state.mode, 'palette');
  assertShape(state.candidates, ['0', '1']);
  assert.equal(state.prefixEnd, 4);
});

test('batch input: "=> " triggers accept/reject keyword suggestions instead of Σ', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const el = h.getElement('batch-in');
  el.value = '01 => acc';
  el.selectionStart = el.value.length;
  const state = h.context.getBatchSuggestState(el);
  assertShape(state, {
    mode: 'filter', residue: 'acc', candidates: ['accept'], isKeyword: true,
    prefixEnd: 6, replaceEnd: 9
  });
});

test('acceptSuggestion inserts a separator only when Σ has a multi-char symbol, to keep chip-built strings unambiguous for tokenize()', () => {
  const h = createHarness();
  withSigma(h, ['a', 'bb']);  const el = makeInput(h, 'sim-in');
  const state = h.context.getSimSuggestState(el);
  setSymSuggest(h, el, state);
  h.context.acceptSuggestion(state.candidates.indexOf('a'));
  assert.equal(el.value, 'a ');
  assertShape(h.context.tokenize(el.value), ['a']);

  // Clicking 'a' again should chain onto a fresh palette rather than merge
  // into the previous token — this is only safe because of the separator.
  el.selectionStart = el.value.length;
  const state2 = h.context.getSimSuggestState(el);
  setSymSuggest(h, el, state2);
  h.context.acceptSuggestion(state2.candidates.indexOf('bb'));
  assert.equal(el.value, 'a bb ');
  assertShape(h.context.tokenize(el.value), ['a', 'bb']);
});

// ══════════════════════════════════════════════════════════════════
//  Tier 1 — Grammar view: CYK / ambiguity-check "string" inputs
// ══════════════════════════════════════════════════════════════════

test('getGrammarSuggestState behaves like getSimSuggestState when the grammar has no extra terminals', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const el = makeInput(h, 'cyk-in');
  const state = h.context.getGrammarSuggestState(el);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1', 'ε'], allSyms: ['0', '1'], prefixEnd: 0, replaceEnd: 0 });
});

test('getGrammarSuggestState offers terminals used in productions even if not in Σ', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  h.context.App.grammar.vars = new Set(['S']);
  h.context.App.grammar.productions = [{ lhs: 'S', rhsArr: ['S', 'c'] }];
  const el = makeInput(h, 'cyk-in');
  const state = h.context.getGrammarSuggestState(el);
  assert.equal(state.mode, 'palette');
  assert.ok(state.candidates.includes('c'), 'expected the production terminal "c" to be offered');
});

test('the dispatcher routes cyk-in/ambig-in through getGrammarSuggestState', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  h.context.App.grammar.productions = [{ lhs: 'S', rhsArr: ['c'] }];
  for (const id of ['cyk-in', 'ambig-in']) {
    const el = makeInput(h, id);
    const state = h.context.getSuggestStateForField(el);
    assert.ok(state.candidates.includes('c'), `expected ${id} to see the grammar terminal "c"`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  Tier 2 — Transition modal: Pop/Push (Γ) and Write (Σ) fields
// ══════════════════════════════════════════════════════════════════

function withPda(h, machine, stackAlpha) {
  h.context.App.machine = machine;
  h.context.App.stackAlpha = new Set(stackAlpha);
}

test('Pop: empty field offers Γ plus the Σ wildcard and ε', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A', 'B']);
  const el = makeInput(h, 'm-pop');
  const state = h.context.getStackSymbolSuggestState(el, false);
  // wholeFieldSymbols is a real Set (not a plain JSON-serializable value), so
  // it's checked separately rather than folded into the assertShape() call.
  const { wholeFieldSymbols, ...rest } = state;
  assertShape(rest, {
    mode: 'palette', candidates: ['A', 'B', 'Z', 'Σ', 'ε'], allSyms: ['A', 'B', 'Z'],
    prefixEnd: 0, replaceEnd: 0, alphabetLabel: 'Γ'
  });
  assert.ok(wholeFieldSymbols.has('Σ') && wholeFieldSymbols.has('ε'));
});

test('Pop: a complete Γ symbol needs no further suggestion', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A']);
  const el = makeInput(h, 'm-pop', 'A');
  const state = h.context.getStackSymbolSuggestState(el, false);
  assertShape(state, { mode: 'none' });
});

test('Pop: a symbol not in Γ is an error labeled Γ, not Σ', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A']);
  const el = makeInput(h, 'm-pop', 'X');
  const state = h.context.getStackSymbolSuggestState(el, false);
  assertShape(state, { mode: 'error', residue: 'X', candidates: [], alphabetLabel: 'Γ' });
});

test('Pop/Push candidates exclude multi-character Γ symbols, since applyPdaStoreTransition splits push strings one raw character at a time', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A', 'AB']); // "AB" could exist if a user typo'd it into Γ
  const el = makeInput(h, 'm-pop');
  const state = h.context.getStackSymbolSuggestState(el, false);
  assertShape(state.allSyms, ['A', 'Z']);
});

test('Counter Machine restricts Pop/Push suggestions to its one counting symbol plus the stack bottom, matching confirmTrans()\'s own validation', () => {
  const h = createHarness();
  withPda(h, 'Counter', ['Z', '1']);
  const el = makeInput(h, 'm-pop');
  const state = h.context.getStackSymbolSuggestState(el, false);
  assertShape(state.allSyms, ['1', 'Z']);
});

test('Push: chip-clicking two single-char Γ symbols concatenates with no separator, matching the raw split(\'\') Run-time behavior', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A', 'B']);  const el = makeInput(h, 'm-push');

  const state1 = h.context.getStackSymbolSuggestState(el, true);
  setSymSuggest(h, el, state1);
  h.context.acceptSuggestion(state1.candidates.indexOf('A'));
  assert.equal(el.value, 'A');

  const state2 = h.context.getStackSymbolSuggestState(el, true);
  setSymSuggest(h, el, state2);
  h.context.acceptSuggestion(state2.candidates.indexOf('B'));
  assert.equal(el.value, 'AB');
});

test('Push: an invalid character (not a single-char Γ member) is flagged as an error', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A']);
  const el = makeInput(h, 'm-push', 'AX');
  const state = h.context.getStackSymbolSuggestState(el, true);
  assert.equal(state.mode, 'error');
  assert.equal(state.alphabetLabel, 'Γ');
});

test('Pop: selecting the Σ wildcard from the empty-field palette sets the field to exactly Σ', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A']);  const el = makeInput(h, 'm-pop'); // Σ/ε are only ever offered from an empty field
  const state = h.context.getStackSymbolSuggestState(el, false);
  setSymSuggest(h, el, state);
  h.context.acceptSuggestion(state.candidates.indexOf(h.context.App.config.sym.any));
  assert.equal(el.value, h.context.App.config.sym.any);
});

test('Write: empty field offers Σ plus the tape blank and the Σ wildcard, but never ε', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  const el = makeInput(h, 'm-write');
  const state = h.context.getWriteSymbolSuggestState(el);
  const blank = h.context.App.config.sym.blank;
  const any = h.context.App.config.sym.any;
  assert.deepEqual(new Set(JSON.parse(JSON.stringify(state.candidates))), new Set(['0', '1', blank, any]));
  assert.ok(!state.candidates.includes(h.context.App.config.sym.eps), 'ε should never be offered for Write');
});

test('Write: dispatcher matches both the single-tape field and dynamically-generated per-tape MTM fields', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  for (const id of ['m-write', 'm-mtm-write-0', 'm-mtm-write-3']) {
    const el = makeInput(h, id);
    const state = h.context.getSuggestStateForField(el);
    assert.equal(state.mode, 'palette');
    assert.equal(state.alphabetLabel, 'Σ');
  }
});

test('the dispatcher routes Pop/Pop₂/Push/Push₂ through getStackSymbolSuggestState with the right multiToken flag', () => {
  const h = createHarness();
  withPda(h, '2PDA', ['Z', 'A']);
  const popState = h.context.getSuggestStateForField(makeInput(h, 'm-pop2'));
  const pushState = h.context.getSuggestStateForField(makeInput(h, 'm-push2', 'A'));
  assert.equal(popState.alphabetLabel, 'Γ');
  // Pop with an empty field is a palette; Push with "A" already typed offers
  // the append-next-character palette rather than treating "A" as an error.
  assert.equal(popState.mode, 'palette');
  assert.equal(pushState.mode, 'palette');
});

// ══════════════════════════════════════════════════════════════════
//  Algorithms view: eq-str / npda-input / ndtm-input / nfa-tree-input
// ══════════════════════════════════════════════════════════════════

test('eq-str, npda-input, ndtm-input, and nfa-tree-input all fall through to the default Σ/tokenize() suggester, same as sim-in', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  for (const id of ['eq-str', 'npda-input', 'ndtm-input', 'nfa-tree-input']) {
    const el = makeInput(h, id);
    const state = h.context.getSuggestStateForField(el);
    assertShape(state, { mode: 'palette', residue: '', candidates: ['0', '1', 'ε'], allSyms: ['0', '1'], prefixEnd: 0, replaceEnd: 0 });
  }
});

test('nfa-tree-input now suggests full word-alphabet symbols (computeNFATree walks tokens, not raw characters)', () => {
  const h = createHarness();
  withSigma(h, ['ab', 'cd']);
  const el = makeInput(h, 'nfa-tree-input');
  const state = h.context.getSuggestStateForField(el);
  assert.equal(state.mode, 'palette');
  assertShape(state.candidates, ['ab', 'cd', 'ε']);
});

test('buildNFATree walks one *token* per tree level for a word alphabet, not one raw character', () => {
  const h = createHarness();
  const App = h.context.App;
  App.sigma = new Set(['ab', 'cd']);
  App.states = [{ id: 1, name: 'q0', x: 0, y: 0 }, { id: 2, name: 'q1', x: 0, y: 0 }, { id: 3, name: 'q2', x: 0, y: 0 }];
  App.startId = 1;
  App.accepts = new Set([3]);
  App.transitions = [
    { id: 't1', from: 1, to: 2, symbol: 'ab' },
    { id: 't2', from: 2, to: 3, symbol: 'cd' }
  ];
  const el = h.getElement('nfa-tree-input');
  el.value = 'abcd'; el.selectionStart = 4;
  h.context.buildNFATree();
  const html = h.getElement('nfa-tree-result').innerHTML;
  assert.ok(!html.includes('Error'), `expected no tokenize error, got: ${html.slice(0, 200)}`);
  assert.ok(html.includes('>ab<'), 'expected the first edge to be labeled with the whole token "ab"');
  assert.ok(html.includes('>cd<'), 'expected the second edge to be labeled with the whole token "cd"');
});

test('buildNFATree recognizes "eps"/"epsilon" text the same way parseEps() does at Run time elsewhere', () => {
  const h = createHarness();
  const App = h.context.App;
  App.sigma = new Set(['0', '1']);
  App.states = [{ id: 1, name: 'q0', x: 0, y: 0 }];
  App.startId = 1;
  App.accepts = new Set([1]);
  App.transitions = [];
  const el = h.getElement('nfa-tree-input');
  el.value = 'eps'; el.selectionStart = 3;
  h.context.buildNFATree();
  const html = h.getElement('nfa-tree-result').innerHTML;
  assert.ok(!html.includes('Error'), `expected "eps" to resolve to the empty string, got: ${html.slice(0, 200)}`);
});

test('buildNFATree HTML-escapes Σ tokens and state names in the rendered SVG', () => {
  const h = createHarness();
  const App = h.context.App;
  // Whitespace-free payload: tokenize() splits typed input on commas/whitespace
  // before backtracking, so a symbol containing a space could never actually
  // be produced as a token here regardless of escaping — this uses "/" instead
  // (a well-known valid HTML attribute separator) so it genuinely round-trips
  // through tokenize() as one token and exercises the escaping path for real.
  App.sigma = new Set(['<img/src=x/onerror=alert(1)>']);
  App.states = [{ id: 1, name: 'q0', x: 0, y: 0 }, { id: 2, name: '<b>evil</b>', x: 0, y: 0 }];
  App.startId = 1;
  App.accepts = new Set([2]);
  App.transitions = [{ id: 't1', from: 1, to: 2, symbol: '<img/src=x/onerror=alert(1)>' }];
  const el = h.getElement('nfa-tree-input');
  el.value = '<img/src=x/onerror=alert(1)>'; el.selectionStart = el.value.length;
  h.context.buildNFATree();
  const html = h.getElement('nfa-tree-result').innerHTML;
  assert.ok(!html.includes('<img/src=x/onerror'), 'the malicious Σ symbol must not appear unescaped in the output HTML');
  assert.ok(!html.includes('<b>evil</b>'), 'the malicious state name must not appear unescaped in the output HTML');
  assert.ok(html.includes('&lt;img'), 'expected the symbol to appear HTML-escaped instead');
});

// ══════════════════════════════════════════════════════════════════
//  Case-insensitive matching
// ══════════════════════════════════════════════════════════════════

test('wrong-case residue is offered as a completable suggestion instead of an error', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);
  const state = h.context.computeResidueState('A', true);
  assertShape(state, { mode: 'filter', residue: 'A', candidates: ['a'], allSyms: ['a', 'b'] });
});

test('correct-case residue still advances straight to the next-token palette (case-insensitivity does not weaken the exact-match fast path)', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);
  const state = h.context.computeResidueState('a', true);
  assertShape(state, { mode: 'palette', residue: '', candidates: ['a', 'b'], allSyms: ['a', 'b'] });
});

test('accepting a wrong-case suggestion inserts the canonically-cased symbol, not the typed casing', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);  const el = makeInput(h, 'sim-in', 'A');
  const state = h.context.getSimSuggestState(el);
  setSymSuggest(h, el, state);
  h.context.acceptSuggestion(state.candidates.indexOf('a'));
  assert.equal(el.value, 'a');
});

test('an unrecognizable residue (wrong case AND not a real prefix) is still a hard error', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);
  const state = h.context.computeResidueState('Z', true);
  assert.equal(state.mode, 'error');
});

test('Pop: a wrong-case Γ symbol is offered as a completable suggestion, but is not silently treated as already-valid (Add-time validation is case-sensitive)', () => {
  const h = createHarness();
  withPda(h, 'PDA', ['Z', 'A']);
  const filterState = h.context.getStackSymbolSuggestState(makeInput(h, 'm-pop', 'a'), false);
  const { wholeFieldSymbols, ...rest } = filterState;
  assertShape(rest, { mode: 'filter', residue: 'a', candidates: ['A'], allSyms: ['A', 'Z'], prefixEnd: 0, replaceEnd: 1, alphabetLabel: 'Γ' });
  const exactState = h.context.getStackSymbolSuggestState(makeInput(h, 'm-pop', 'A'), false);
  assert.equal(exactState.mode, 'none');
});

test('Write: a wrong-case Σ symbol is offered as a completable suggestion', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);
  const state = h.context.getWriteSymbolSuggestState(makeInput(h, 'm-write', 'A'));
  assert.equal(state.mode, 'filter');
  assertShape(state.candidates, ['a']);
});

// ══════════════════════════════════════════════════════════════════
//  Machine-aware liveness — sim-in only, advisory (dims, never filters)
// ══════════════════════════════════════════════════════════════════

function withDfa(h, transitions, startId, accepts) {
  h.context.App.machine = 'DFA';
  h.context.App.startId = startId;
  h.context.App.accepts = new Set(accepts);
  h.context.App.transitions = transitions;
}

test('DFA: liveSet reflects only symbols with a real transition from the start state', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '0' }], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assertShape([...state.liveSet], ['0']);
});

test('DFA: liveSet advances as tokens are consumed, reflecting the state *after* the typed prefix', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [
    { id: 't1', from: 1, to: 2, symbol: '0' },
    { id: 't2', from: 2, to: 3, symbol: '1' },
  ], 1, [3]);
  const el = makeInput(h, 'sim-in', '0');
  el.selectionStart = 1;
  const state = h.context.getSimSuggestState(el);
  assertShape([...state.liveSet], ['1']);
});

test('DFA: a dead-end state (no outgoing transitions) yields an empty liveSet, not an error', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '0' }], 1, [2]);
  const el = makeInput(h, 'sim-in', '0');
  el.selectionStart = 1;
  const state = h.context.getSimSuggestState(el);
  assertShape([...state.liveSet], []);
  assert.equal(state.mode, 'palette'); // still fully selectable, just nothing marked live
});

test('NFA: a symbol is live if *any* state in the ε-closed set has a transition on it (exists-a-surviving-branch semantics)', () => {
  const h = createHarness();
  withSigma(h, ['a', 'b']);
  h.context.App.machine = 'NFA';
  h.context.App.startId = 1;
  h.context.App.accepts = new Set([3]);
  const eps = h.context.App.config.sym.eps;
  h.context.App.transitions = [
    { id: 't1', from: 1, to: 2, symbol: eps },
    { id: 't2', from: 1, to: 3, symbol: eps },
    { id: 't3', from: 2, to: 2, symbol: 'a' },
    // state 3 has no outgoing transitions — only branch 2 keeps 'a' alive
  ];
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assertShape([...state.liveSet], ['a']);
});

test('the Σ wildcard symbol counts as a live transition, matching simNFA/getSingleTapeDeterministicTransition', () => {
  const h = createHarness();
  const any = 'Σ';
  withSigma(h, ['a', 'b']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: any }], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assertShape([...state.liveSet].sort(), ['a', 'b']);
});

test('liveness is only computed for sim-in — Grammar\'s reuse of getSimSuggestState (different alphabet) never gets a liveSet', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '0' }], 1, [2]);
  const state = h.context.getGrammarSuggestState(makeInput(h, 'cyk-in'));
  assert.equal(state.liveSet, undefined);
});

test('liveness is not computed for machine families that mutate a stack/tape (PDA, TM, ...) — replaying tokens alone can\'t reproduce their state', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  h.context.App.machine = 'PDA';
  h.context.App.startId = 1;
  h.context.App.accepts = new Set([2]);
  h.context.App.transitions = [{ id: 't1', from: 1, to: 2, symbol: '0', pop: h.context.App.config.sym.eps, push: h.context.App.config.sym.eps }];
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assert.equal(state.liveSet, undefined);
});

test('liveness never narrows candidates or changes mode — dead symbols stay fully present and selectable', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '0' }], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assertShape(state.candidates, ['0', '1', 'ε']); // '1' stays offered even though it's dead
  assertShape([...state.liveSet], ['0']);
});

test('accepting a dead-end suggestion still works exactly like any other — liveness is purely advisory', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '0' }], 1, [2]);  const el = makeInput(h, 'sim-in');
  const state = h.context.getSimSuggestState(el);
  setSymSuggest(h, el, state);
  h.context.acceptSuggestion(state.candidates.indexOf('1')); // '1' is dead but still chooseable
  assert.equal(el.value, '1');
});

test('live candidates are reordered to the front, ahead of dead ones, even when alphabetical/longest-match order would put a dead symbol first', () => {
  const h = createHarness();
  withSigma(h, ['0', '1', '2']); // alphabetical order puts dead '0' and '1' ahead of live '2'
  withDfa(h, [{ id: 't1', from: 1, to: 2, symbol: '2' }], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  // live symbol surfaces first; dead symbols keep their relative order after it; ε stays pinned last
  assertShape(state.candidates, ['2', '0', '1', 'ε']);
  assertShape([...state.liveSet], ['2']);
});

test('reordering is a stable partition — relative order within the live band and within the dead band is preserved, not re-sorted', () => {
  const h = createHarness();
  withSigma(h, ['c', 'a', 'd', 'b']);
  withDfa(h, [
    { id: 't1', from: 1, to: 2, symbol: 'a' },
    { id: 't2', from: 1, to: 2, symbol: 'c' },
  ], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  // original candidate order (from computeResidueState) is ['c','a','d','b'] (Σ insertion order, same-length so no length-sort churn)
  assertShape(state.candidates, ['c', 'a', 'd', 'b', 'ε']);
});

test('an all-live or all-dead palette is left in its original order — nothing to gain from reordering', () => {
  const h = createHarness();
  withSigma(h, ['0', '1']);
  withDfa(h, [
    { id: 't1', from: 1, to: 2, symbol: '0' },
    { id: 't2', from: 1, to: 2, symbol: '1' },
  ], 1, [2]);
  const state = h.context.getSimSuggestState(makeInput(h, 'sim-in'));
  assertShape(state.candidates, ['0', '1', 'ε']);
  assertShape([...state.liveSet].sort(), ['0', '1']);
});
