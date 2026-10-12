import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from './dom-stub.js';
import { createHarness, context, getElement } from './harness.js';
import { dispatchActions } from '../js/core/actions.js';

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

// The rows are template markup wired by data-action (js/core/actions.js). The stub
// does not parse HTML, so a control is rebuilt from the attributes the markup
// gave it and pressed through the dispatcher — what a click in a browser does.
function controls(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*data-action="[^"]*"[^>]*>`, 'g'))].map(([open]) => {
    const el = createElement(tag);
    for (const [, name, value] of open.matchAll(/\s(data-[\w-]+)="([^"]*)"/g)) el.setAttribute(name, value);
    return el;
  });
}
const rowButtons = html => controls(html, 'button');
const find = (els, attrs) => els.find(el => Object.entries(attrs).every(([k, v]) => el.dataset[k] === v));
function press(el, type = 'click') {
  const event = {
    type, target: el, defaultPrevented: false, cancelBubble: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { event.cancelBubble = true; }
  };
  dispatchActions(event, el);
  return event;
}

test('a transition row edits the transition it names', () => {
  seed();
  const { App } = context;
  const buttons = rowButtons(transHtml());
  press(find(buttons, { kind: 'trans', rowId: 't2', action: 'lists.editRow:stop' }));
  assert.equal(App.transEditId, 't2');
  press(find(buttons, { kind: 'trans', rowId: 't1', action: 'lists.deleteRow:stop' }));
  assert.ok(!App.transitions.some(t => t.id === 't1'), 't1 is deleted');
  assert.ok(App.transitions.some(t => t.id === 't2'), 'and only t1');
});

test('a state row deletes the state it names', () => {
  seed();
  const { App } = context;
  const buttons = rowButtons(statesHtml());
  press(find(buttons, { kind: 'state', rowId: 's1', action: 'lists.editRow:stop' }));
  assert.equal(App.editId, 's1');
  press(find(buttons, { kind: 'state', rowId: 's2', action: 'lists.deleteRow:stop' }));
  assert.deepEqual(App.states.map(s => s.id), ['s1']);
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
      // :stop — the press must not also reach the row's focus-the-canvas action.
      assert.match(b, /data-action="lists\.(edit|delete)Row:stop"/, `${name}: ${b}`);
    }
  }
  assert.doesNotMatch(transHtml(), /class="dx"/);
  assert.doesNotMatch(statesHtml(), /class="si-edit"/);
});

// Both rows already focused the canvas on a single click; only the state row
// opened its editor on a double one.
test('both rows open their editor on double-click', () => {
  seed();
  const { App } = context;
  press(find(controls(statesHtml(), 'div'), { stateId: 's1' }), 'dblclick');
  assert.equal(App.editId, 's1');
  press(find(controls(transHtml(), 'div'), { transId: 't1' }), 'dblclick');
  assert.equal(App.transEditId, 't1');
});

// [data-id] is how canvas.js, ui.js and simulation.js find a node on the
// canvas with document.querySelector, and the panel comes first in the page —
// a row carrying data-id would be found in the node's place.
test('a row never carries data-id', () => {
  seed();
  assert.doesNotMatch(statesHtml() + transHtml(), /\sdata-id=/);
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
