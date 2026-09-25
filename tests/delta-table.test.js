import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Transitions δ as a table — js/delta-table.js.
//
// Pinned: which machines get a table (read off the declared transition fields,
// never a list of names), which of them are edited in place, that the columns
// cannot lose a rule, and that editing a cell is one undoable edit that the
// machine's own determinism rule still polices.

const harness = createHarness();
const { context } = harness;

function machine(m, sigma = ['a', 'b']) {
  harness.resetApp();
  context.applyMachineSwitch(m);
  context.App.sigma = new Set(sigma);
  const q0 = context.createState(100, 100, 'q0');
  const q1 = context.createState(250, 100, 'q1');
  const q2 = context.createState(400, 100, 'q2');
  context.App.startId = q0.id;
  return { q0: q0.id, q1: q1.id, q2: q2.id };
}

function cell(from, sym) {
  return context.App.transitions.filter(t => t.from === from && t.symbol === sym).map(t => t.to).sort();
}

// ── which machines ────────────────────────────────────────────────

test('a table is offered exactly where a rule is a state and a symbol', () => {
  for (const m of ['DFA', 'NFA', 'ε-NFA', 'DBA', 'NBA', 'DPA', 'Moore', 'Mealy', 'FST', 'PFA']) {
    assert.ok(context.transTableSupported(m), `${m} has a table`);
  }
  for (const m of ['DPDA', 'NPDA', 'TM', 'MTM', 'LBA', '2DFA', '2DFT', 'EPDA', 'PDT']) {
    assert.ok(!context.transTableSupported(m), `${m} has rules a table cannot hold`);
  }
});

test('cells are chosen in place only where a rule is nothing but its endpoints', () => {
  assert.ok(context.transTableEditable('DFA'));
  assert.ok(context.transTableEditable('NBA'));
  assert.ok(context.transTableEditable('Moore'), 'its output is on the state, not the rule');
  assert.ok(!context.transTableEditable('Mealy'), 'a rule with an output needs the editor');
  assert.ok(!context.transTableEditable('PFA'), 'and so does one with a probability');
});

test('the view is the reader\'s, and a machine without a table shows the list', () => {
  machine('DFA');
  assert.equal(context.transView(), 'list', 'the list until someone asks otherwise');
  context.setTransView('table');
  assert.equal(context.transView(), 'table');
  assert.equal(context.transView('DPDA'), 'list', 'a PDA keeps its list whatever was chosen');
  context.setTransView('list');
  assert.equal(context.localStorage.getItem('automata-trans-view'), null,
    'the list is the absence of a preference');
});

// ── the columns ───────────────────────────────────────────────────

test('columns are Σ in order, then ε where the machine has it', () => {
  machine('ε-NFA', ['b', 'a']);
  const { cols, stray } = context.deltaColumns([]);
  assert.deepEqual(cols, ['b', 'a', context.App.config.sym.eps]);
  assert.equal(stray.size, 0);
});

test('a symbol Σ no longer has still gets a column while a rule reads it', () => {
  const { q0, q1 } = machine('DFA');
  context.App.transitions.push({ id: 't99', from: q0, to: q1, symbol: 'z' });
  const { cols, stray } = context.deltaColumns(context.App.transitions);
  assert.deepEqual(cols, ['a', 'b', 'z']);
  assert.ok(stray.has('z'), 'flagged, not dropped');
});

// ── editing a cell ────────────────────────────────────────────────

test('a DFA cell is set, moved and cleared, one undo point each', () => {
  const { q0, q1, q2 } = machine('DFA');
  const depth = context.App.history.length;
  assert.equal(context.setDeltaCell(q0, 'a', [q1]), true);
  assert.deepEqual(cell(q0, 'a'), [q1]);
  context.setDeltaCell(q0, 'a', [q2]);
  assert.deepEqual(cell(q0, 'a'), [q2], 'moved, not added beside');
  context.setDeltaCell(q0, 'a', []);
  assert.deepEqual(cell(q0, 'a'), [], 'δ may be partial');
  assert.equal(context.App.history.length, depth + 3);

  context.undo();
  assert.deepEqual(cell(q0, 'a'), [q2]);
  assert.equal(context.setDeltaCell(q0, 'a', [q2]), false, 'the same set is no edit');
});

test('the machine\'s determinism rule still has the last word', () => {
  // A DBA takes every matching edge rather than the most specific one, so a
  // wildcard and a concrete symbol out of one state are two answers to (q, a).
  // (A DFA resolves the pair by specificity and allows it — which this leaves
  // to the DFA's own rule rather than second-guessing it.)
  const { q0, q1, q2 } = machine('DBA');
  const any = context.App.config.sym.any;
  context.App.transitions.push({ id: 't50', from: q0, to: q2, symbol: any });
  const before = context.App.transitions.length;
  assert.equal(context.setDeltaCell(q0, 'a', [q1]), false,
    'the wildcard already answers for (q0, a)');
  assert.equal(context.App.transitions.length, before);

  const dfa = machine('DFA');
  context.App.transitions.push({ id: 't51', from: dfa.q0, to: dfa.q2, symbol: any });
  assert.equal(context.setDeltaCell(dfa.q0, 'a', [dfa.q1]), true, 'a DFA may have both');
});

test('an NFA cell is a set', () => {
  const { q0, q1, q2 } = machine('NFA');
  context.setDeltaCell(q0, 'a', [q1, q2]);
  assert.deepEqual(cell(q0, 'a'), [q1, q2].sort());
  context.setDeltaCell(q0, 'a', [q2]);
  assert.deepEqual(cell(q0, 'a'), [q2], 'only the one taken out goes');
});

// ── drawing ───────────────────────────────────────────────────────

test('the section draws states by symbols, with the textbook\'s marks', () => {
  const { q0, q1 } = machine('DFA');
  context.App.accepts.add(q1);
  context.setDeltaCell(q0, 'a', [q1]);
  context.setTransView('table');
  context.updateLPanel();
  const host = context.$('trans-list');
  assert.ok(host.classList.contains('is-table'));
  const html = host.innerHTML;
  assert.match(html, /class="dt-q is-start"[^>]*data-sid="[^"]+"[^>]*>q0</, 'q0 carries the start arrow');
  assert.match(html, /class="dt-q is-acc"[^>]*>q1</, 'q1 carries the accepting star');
  assert.match(html, /δ\(q0, a\) = q1/, 'the cell says what it holds');
  assert.match(html, /δ\(q0, b\) = undefined/, 'and an empty DFA cell says δ is undefined there');
  assert.match(context.$('trans-table-head').innerHTML, />a<\/div><div class="dt-hs"[^>]*>b</);

  context.setTransView('list');
  context.updateLPanel();
  assert.ok(!host.classList.contains('is-table'), 'and back');
  assert.equal(context.$('trans-table-head').hidden, true);
});

test('a machine whose rules carry an output opens the editor from its cells', () => {
  const { q0, q1 } = machine('Mealy');
  context.App.outputAlpha = new Set(['0', '1']);
  context.App.transitions.push({ id: 't70', from: q0, to: q1, symbol: 'a', output: '1' });
  context.setTransView('table');
  context.updateLPanel();
  const html = context.$('trans-list').innerHTML;
  assert.match(html, /data-act="entry" data-tid="t70"[^>]*>q1\/1</, 'target and output together');
  assert.match(html, /data-act="add"[^>]*data-sym="b"/, 'an empty cell offers to add one');
  assert.doesNotMatch(html, /data-act="cell"/, 'and nothing is chosen in place');
});

test('the picker opens on a cell and closes with the machine that had it', () => {
  const { q0 } = machine('DFA');
  const anchor = context.document.createElement('button');
  anchor.dataset.from = q0;
  anchor.dataset.sym = 'a';
  context.openDeltaPicker(anchor);
  assert.deepEqual(context.deltaPickerCell(), { from: q0, sym: 'a' });
  context.deleteState(q0);
  assert.equal(context.deltaPickerCell(), null, 'its state is gone, so is the question');
});
