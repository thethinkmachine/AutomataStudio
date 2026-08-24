import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';

// The two left-panel lists.
//
// States Q and Transitions δ are the same row twice — a label, then the pair of
// controls that acts on what the label names. They had drifted into halves of
// one control: a state row carried a pencil and no way to delete, a transition
// row a delete and no way to edit, and the delete was a <span onclick> where
// the pencil was a <button>, so only one of the two was reachable by keyboard.
// Nothing failed loudly for either gap, which is what these pin.
//
// The DOM stub does not parse HTML, so `innerHTML` reads back as the string
// updateLPanel() wrote. That is the right level here: what is being asserted is
// the markup both lists agree on, not what a browser makes of it.

function seed() {
  const h = createHarness();
  const { App } = context;
  App.machine = 'DFA';
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'q0' },
    { id: 's2', x: 90, y: 0, name: 'q1' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s2']);
  App.sigma = new Set(['a', 'b']);
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's2', to: 's1', symbol: 'b' }
  ];
  context.updateLPanel();
  return h;
}

const statesHtml = () => getElement('states-list').innerHTML;
const transHtml = () => getElement('trans-list').innerHTML;

test('both lists offer the same pair of row actions', () => {
  seed();
  for (const [name, html] of [['states', statesHtml()], ['transitions', transHtml()]]) {
    const edits = html.match(/class="lp-row-btn is-edit"/g) || [];
    const dels = html.match(/class="lp-row-btn is-del"/g) || [];
    assert.equal(edits.length, 2, `${name}: one edit button per row`);
    assert.equal(dels.length, 2, `${name}: one delete button per row`);
  }
});

test('a transition row edits the transition it names', () => {
  seed();
  assert.match(transHtml(), /editTransFromList\('t1'\)/);
  assert.match(transHtml(), /editTransFromList\('t2'\)/);
  assert.match(transHtml(), /deleteTrans\('t1'\)/);
});

test('a state row deletes the state it names', () => {
  seed();
  assert.match(statesHtml(), /openStateModal\('s1'\)/);
  assert.match(statesHtml(), /deleteState\('s1'\)/);
});

// A <span onclick> is not a control: no tab stop, no Enter, nothing for a
// screen reader to announce. Both actions are buttons, and both carry a label,
// because the only thing inside them is an icon.
test('every row action is a labelled button', () => {
  seed();
  for (const [name, html] of [['states', statesHtml()], ['transitions', transHtml()]]) {
    const btns = html.match(/<button[^>]*class="lp-row-btn[^"]*"[^>]*>/g) || [];
    assert.equal(btns.length, 4, `${name}: four action buttons across two rows`);
    for (const b of btns) {
      assert.match(b, /type="button"/, `${name}: ${b}`);
      assert.match(b, /aria-label="[^"]+"/, `${name}: ${b}`);
      assert.match(b, /event\.stopPropagation\(\)/, `${name}: ${b}`);
    }
  }
  assert.doesNotMatch(transHtml(), /class="dx"/);
  assert.doesNotMatch(statesHtml(), /class="si-edit"/);
});

// Both rows already focused the canvas on a single click; only the state row
// opened its editor on a double one.
test('both rows open their editor on double-click', () => {
  seed();
  assert.match(statesHtml(), /ondblclick="openStateModal\('s1'\)"/);
  assert.match(transHtml(), /ondblclick="editTransFromList\('t1'\)"/);
});

// The names reach the row through innerHTML, and a Σ symbol can arrive from an
// imported .jff — so they are escaped, in the label and in the aria-label both.
test('a name that looks like markup is escaped, not rendered', () => {
  seed();
  const { App } = context;
  App.states[0].name = '<img src=x>';
  App.transitions[0].symbol = '"&<>';
  context.updateLPanel();
  assert.doesNotMatch(statesHtml(), /<img/);
  assert.match(statesHtml(), /&lt;img src=x&gt;/);
  assert.doesNotMatch(transHtml(), /"&<>/);
});

// editTransFromList is the list's route into the editor. It has to resolve the
// edge the transition sits on, because that is what openTransModal is addressed
// by — and it has to select the transition that was actually clicked, not the
// first one on the edge, or a parallel edge would be uneditable from the list.
test('editing from the list selects the transition that was clicked', () => {
  seed();
  const { App } = context;
  App.transitions.push({ id: 't3', from: 's1', to: 's2', symbol: 'b' });
  context.editTransFromList('t3');
  assert.equal(App.transEditId, 't3');
  assert.equal(App._pendFrom, 's1');
  assert.equal(App._pendTo, 's2');
  assert.equal(App.transModalMode, 'edit');
  // The whole edge is offered in the picker, so the other parallel edge is
  // still reachable once the dialog is open.
  assert.deepEqual(App.transModalIds, ['t1', 't3']);
});

test('editing a transition that is gone opens nothing', () => {
  seed();
  const { App } = context;
  App.transEditId = null;
  context.editTransFromList('nope');
  assert.equal(App.transEditId, null);
});
