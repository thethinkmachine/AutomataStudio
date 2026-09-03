import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The view itself, driven through the elements the app builds.
//
// Two things it has to get right and one it must not do:
//
//   - the editor and App.grammar are the same grammar, in both directions.
//     The old view kept the source in a textarea, the model in `G` and the
//     start symbol in a *third* place — a free-text input that happily named
//     a variable the grammar did not have, after which every tool answered
//     about a start symbol deriving nothing.
//   - the rail and the result are rebuilt from the registry rather than
//     written out, so a tool added to js/grammar/tools.js appears with no
//     edit here.
//   - and running a tool writes nothing. That is asserted in
//     tests/grammar-workbench.test.js against every tool at once; here it is
//     asserted through the view, which is the path a reader actually takes.

function openGrammar(h) {
  h.context.App.view = 'grammar';
  h.context.renderGrammarView();
  return h.getElement('gram-source');
}

/** Types into the editor the way a reader does — the field, then its listener. */
function type(h, text) {
  const src = h.getElement('gram-source');
  src.value = text;
  src._listeners.input();
  return src;
}

/**
 * The blocks a tool drew. They live under `.gram-res-body` rather than
 * directly in the pane, because the head and the tool's own input fields are
 * built once per tool and only this part is replaced on a re-render — a render
 * runs on every keystroke, and an innerHTML write over a focused field takes
 * the caret with it.
 */
function resultBody(h) {
  return h.getElement('gram-result').children.find(c => c.className === 'gram-res-body');
}

test('opening the view builds the rail from the registry', () => {
  const h = createHarness();
  openGrammar(h);
  const nav = h.getElement('gram-nav-list').innerHTML;
  h.context.grammarToolNav().forEach(group => {
    assert.ok(nav.includes(group.label), `the rail is missing the ${group.label} group`);
    group.tools.forEach(t => assert.ok(nav.includes(`data-tool="${t.id}"`), `${t.id} is not in the rail`));
  });
});

test('the editor shows the grammar the workspace holds', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  const src = openGrammar(h);
  assert.equal(src.value, h.context.grammarText(grammar));
});

test('the start symbol is a choice over V, never a free-text field', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → A\nA → a');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  const sel = h.getElement('gram-start');
  assert.ok(sel.innerHTML.includes('value="S"'));
  assert.ok(sel.innerHTML.includes('value="A"'));
  assert.ok(!sel.innerHTML.includes('value="B"'), 'a variable the grammar does not have must not be offerable');
});

test('the footer counts V, Σ and R', () => {
  const h = createHarness();
  h.context.App.sigma = new Set();
  const { grammar } = h.context.grammarFromText('S → a A\nA → b');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  assert.match(h.getElement('gram-fact-v').innerHTML, /<b>2<\/b>/, 'S and A');
  assert.match(h.getElement('gram-fact-s').innerHTML, /<b>2<\/b>/, 'a and b');
  assert.match(h.getElement('gram-fact-r').innerHTML, /<b>2<\/b>/);
});

test('the parsed rules are shown, coloured by what each symbol turned out to be', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  const rules = h.getElement('gram-rules').innerHTML;
  assert.ok(rules.includes('gsym-v'), 'S is a variable');
  assert.ok(rules.includes('gsym-t'), 'a and b are terminals');
  assert.ok(rules.includes('gsym-e'), 'the ε alternative is marked as the empty word');
  assert.ok(rules.includes('gstart'), 'and the start symbol is marked');
});

test('a malformed line is reported in the editor rather than swallowed', () => {
  const h = createHarness();
  openGrammar(h);
  type(h, 'S -> a\nnot a rule at all');
  const diag = h.getElement('gram-diag').innerHTML;
  assert.ok(diag.includes('is-error'), diag);
  assert.ok(diag.includes('line 2'), 'with the line it is on');
});

test('a malformed line survives losing focus rather than being tidied away', () => {
  const h = createHarness();
  openGrammar(h);
  const src = type(h, 'S -> a\nnot a rule at all');
  // Anything at all can cause a re-render — a Σ edit, a tab switch, an emit
  // from elsewhere — and none of them may erase what the reader typed.
  h.context.renderGrammarView();
  assert.equal(src.value, 'S -> a\nnot a rule at all');
  assert.ok(h.getElement('gram-diag').innerHTML.includes('is-error'));
});

test('a grammar written from elsewhere does replace the field', () => {
  const h = createHarness();
  const src = openGrammar(h);
  type(h, 'S -> a');
  const { grammar } = h.context.grammarFromText('T -> b');
  h.context.writeGrammar(grammar);
  h.context.renderGrammarView();
  assert.equal(src.value, 'T → b', 'a load, an undo or an Apply refreshes the editor');
});

test('an empty grammar draws the Overview’s way in rather than an empty pane', () => {
  const h = createHarness();
  h.context.App.grammar.productions = [];
  h.context.App.grammar.vars = new Set();
  openGrammar(h);
  const pane = h.getElement('gram-result');
  assert.ok(pane.children.length, 'the pane is never blank');
});

test('opening a tool renders its title and blurb', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('classify');
  const pane = h.getElement('gram-result');
  const head = pane.children.find(c => c.className === 'gram-res-head');
  assert.ok(head, 'every result leads with its head');
  assert.ok(head.innerHTML.includes('Chomsky class'));
});

test('a tool that needs the canvas says which model it wants instead of drawing nothing', () => {
  const h = createHarness();
  h.context.App.machine = 'DFA';
  openGrammar(h);
  h.context.openTool('pda2cfg');
  const stub = resultBody(h).children.find(c => c.className === 'gram-stub');
  assert.ok(stub, 'the precondition is stated rather than the tool being run against the wrong machine');
  assert.match(stub.children[0].innerHTML, /DPDA or NPDA/);
});

test('a tool that needs a context-free grammar says so', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → A B\nA B → b a');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('cnf');
  const stub = resultBody(h).children.find(c => c.className === 'gram-stub');
  assert.ok(stub);
  assert.match(stub.children[0].innerHTML, /context-free/);
});

test('running every tool through the view leaves the grammar untouched', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  const before = h.context.grammarText(h.context.readGrammar());
  h.context.grammarToolNav().forEach(group => group.tools.forEach(t => {
    h.context.openTool(t.id);
    assert.equal(h.context.grammarText(h.context.readGrammar()), before,
      `opening ${t.id} changed the grammar`);
  }));
});

test('the chosen tool is remembered outside App.config', () => {
  const h = createHarness();
  openGrammar(h);
  h.context.openTool('cnf');
  assert.equal(h.context.localStorage.getItem('automata-grammar-tool'), 'cnf');
  // App.config is deep-copied into every workspace tab and written to
  // IndexedDB, so a reader's choice of tool must not travel with a file.
  const blob = JSON.stringify(h.context.exportWorkspaceState());
  assert.ok(!blob.includes('automata-grammar-tool'));
  assert.ok(!blob.includes('"cnf"'));
});

test('the view rebuilds itself into a torn-down document', () => {
  const h = createHarness();
  openGrammar(h);
  assert.equal(h.getElement('gram-editor').dataset.gramBuilt, '1');
  const fresh = createHarness();          // clears the element registry
  openGrammar(fresh);
  assert.ok(fresh.getElement('gram-nav-list').innerHTML.includes('data-tool="overview"'),
    'the built marker lives on the container, not in a module variable');
});

// ══════════════════════════════════════════════════════════════════
//  WHAT A KEYSTROKE COSTS, AND WHAT IT MUST NOT DESTROY
// ══════════════════════════════════════════════════════════════════
//  A render runs on every keystroke — which is what makes the CYK table and
//  the parse tree belong to the word being typed — so two things have to be
//  true of it that are silent to break: it must not put an undo entry on the
//  stack per character, and it must not rebuild the field the character was
//  typed into.

test('a run of keystrokes is one undo point, not one per character', () => {
  const h = createHarness();
  const { App } = h.context;
  openGrammar(h);
  const before = App.history.length;
  const text = 'S → a S b | ε';
  for (let i = 1; i <= text.length; i++) type(h, text.slice(0, i));
  const cost = App.history.length - before;
  assert.ok(cost >= 1, 'a typed grammar is still undoable');
  assert.ok(cost < 4, `typing ${text.length} characters cost ${cost} undo entries`);
});

test('one undo takes back a run of typing, grammar and all', () => {
  const h = createHarness();
  const { App } = h.context;
  const { grammar } = h.context.grammarFromText('S → a');
  h.context.writeGrammar(grammar);
  openGrammar(h);

  type(h, 'S → a\nT → b');
  assert.equal(h.context.readGrammar().rules.length, 2);

  h.context.undo();
  assert.equal(h.context.grammarText(h.context.readGrammar()), h.context.grammarText(grammar),
    'the grammar is on the undo stack, not merely alongside it');
  assert.equal(App.history.length, 0);
});

test('a hydration that does not announce the grammar cannot leave the editor stale', () => {
  const h = createHarness();
  const { App, Change } = h.context;
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);

  // What a tab switch, a load and an undo all do: write App.grammar wholesale
  // and say so. Without the announcement the field would keep the previous
  // grammar, and the next keystroke would write it back over this one.
  const { grammar: next } = h.context.grammarFromText('T → x T | x');
  h.context.writeGrammar(next);
  h.context.emit(Change.GRAMMAR);
  assert.equal(h.getElement('gram-source').value, h.context.grammarText(next));
  assert.equal(App.grammar.start, 'T');
});

test('typing into a tool’s field does not rebuild the field', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('parse');

  const pane = h.getElement('gram-result');
  const row = pane.children.find(c => c.className === 'gram-inputs');
  assert.ok(row, 'the tool draws its fields');
  const field = row.children[0].children.find(c => c.id === 'gram-in-word');
  assert.ok(field, 'the word field carries the id the suggest layer names');

  field.value = 'a';
  field._listeners.input();
  const after = h.getElement('gram-result').children.find(c => c.className === 'gram-inputs');
  assert.equal(after, row, 'the input row survives a keystroke');
  assert.equal(after.children[0].children.find(c => c.id === 'gram-in-word'), field,
    'so does the field — rebuilding it takes the focus and the caret with it');
});

test('a field is written back into step when something else changes the word', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('parse');
  const field = h.getElement('gram-result').children
    .find(c => c.className === 'gram-inputs').children[0].children
    .find(c => c.id === 'gram-in-word');

  field.value = 'ab';
  field._listeners.input();
  // Re-opening the tool that is already open reuses the frame, so the reused
  // field is the one that has to be brought up to date.
  h.context.openTool('parse');
  assert.equal(field.value, 'ab');
});

// ══════════════════════════════════════════════════════════════════
//  A WORD THE GRAMMAR CANNOT READ
// ══════════════════════════════════════════════════════════════════
//  `tokenizeWord` refuses such a word rather than splitting it into
//  characters, which is what lets a tool name the symbol — but the refusal
//  carries no `tokens`, so a tool that reads them without checking throws.
//  A half-typed word is in exactly that state on every keystroke, so this is
//  the common path, not the edge case.

test('a word using a symbol the grammar has never heard of is stated, not thrown', () => {
  const h = createHarness();
  h.context.App.sigma = new Set();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);

  const wordTools = h.context.grammarToolNav().flatMap(g => g.tools)
    .filter(t => t.needs && t.needs.word);
  assert.ok(wordTools.length, 'the word tools declare what they need');

  wordTools.forEach(t => {
    h.context.openTool(t.id);
    const field = h.getElement('gram-result').children
      .find(c => c.className === 'gram-inputs').children[0].children
      .find(c => c.id === 'gram-in-word');
    field.value = 'q';
    field._listeners.input();
    const body = resultBody(h);
    const stub = body.children.find(c => c.className === 'gram-stub');
    assert.ok(stub, `${t.id} threw or drew nothing for an unreadable word`);
    assert.match(stub.children[0].innerHTML, /“q”/);
    assert.ok(!body.children.some(c => /could not finish/.test(c.innerHTML || '')),
      `${t.id} reported an internal error to the reader`);
  });
});

test('a word that is readable again clears the refusal', () => {
  const h = createHarness();
  h.context.App.sigma = new Set();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('parse');
  const field = h.getElement('gram-result').children
    .find(c => c.className === 'gram-inputs').children[0].children
    .find(c => c.id === 'gram-in-word');

  field.value = 'q';
  field._listeners.input();
  assert.ok(resultBody(h).children.find(c => c.className === 'gram-stub'));

  field.value = 'aabb';
  field._listeners.input();
  assert.ok(!resultBody(h).children.some(c => c.className === 'gram-stub'));
  assert.ok(resultBody(h).children.length > 1, 'the parse is drawn');
});

test('LL(1) traces the word that was typed, and says so when it cannot', () => {
  const h = createHarness();
  h.context.App.sigma = new Set();
  const { grammar } = h.context.grammarFromText('S → a S b | ε');
  h.context.writeGrammar(grammar);
  openGrammar(h);
  h.context.openTool('ll1');
  const field = h.getElement('gram-result').children
    .find(c => c.className === 'gram-inputs').children[0].children
    .find(c => c.id === 'gram-in-word');

  // Walked rather than read off the top level: a `sec` block puts its title in
  // a child element, so the text is one node down.
  const walk = n => (n.innerHTML || '') + (n.children || []).map(walk).join('');
  const said = () => walk(resultBody(h));
  assert.ok(!/Predictive parse/.test(said()), 'nothing is traced before a word is typed');

  field.value = 'aabb';
  field._listeners.input();
  assert.match(said(), /Predictive parse/,
    'the trace reads the word, which it could not while it tested a field tokenizeWord never set');

  // The table is about the grammar, so an unreadable word narrows the answer
  // rather than replacing it.
  field.value = 'zz';
  field._listeners.input();
  assert.ok(resultBody(h).children.length > 1, 'the table survives an unreadable word');
  assert.ok(!resultBody(h).children.some(c => c.className === 'gram-stub'));
});
