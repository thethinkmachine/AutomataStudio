import { createElement } from './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { dispatchActions } from '../js/core/actions.js';

// The model picker is markup built as a string, so its items are wired by
// data-action. It is also the control that once shipped dead — selectModel was
// missing from window, the picker rendered fine and every item did nothing —
// so these drive an item through the dispatcher rather than calling
// selectModel directly.

function pickerItems(html) {
  return [...html.matchAll(/data-action="([^"]*)" data-model="([^"]*)"/g)]
    .map(([, spec, model]) => ({ spec, model }));
}

/** A stand-in for one rendered item, carrying the attributes the markup gave it. */
function itemElement({ spec, model }) {
  const el = createElement('div');
  el.setAttribute('data-action', spec);
  el.setAttribute('data-model', model);
  return el;
}

test('picking a model from the picker switches the machine', () => {
  const h = createHarness();
  const { App } = h.context;
  assert.equal(App.machine, 'DFA');

  h.context.renderModelPicker();
  const nfa = pickerItems(h.getElement('model-picker-menu').innerHTML).find(i => i.model === 'NFA');
  assert.ok(nfa, 'the picker should render an item for the NFA');

  const el = itemElement(nfa);
  dispatchActions({ type: 'click', target: el }, el);
  assert.equal(App.machine, 'NFA', 'clicking an item switches to its model');
});

test('an item is activated from the keyboard as well as by a click', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.renderModelPicker();
  const pda = pickerItems(h.getElement('model-picker-menu').innerHTML).find(i => i.model === 'PDA' || i.model === 'DPDA');
  const el = itemElement(pda);

  let prevented = false;
  dispatchActions({ type: 'keydown', key: ' ', target: el, preventDefault() { prevented = true; } }, el);
  assert.equal(App.machine, pda.model);
  assert.ok(prevented, 'Space must not also scroll the menu');
});

test('every implemented model has an item, and nothing unimplemented can be picked', () => {
  const h = createHarness();
  const { MachineCategories, MachineTypes } = h.context;
  h.context.renderModelPicker();
  const picked = new Set(pickerItems(h.getElement('model-picker-menu').innerHTML).map(i => i.model));

  for (const mid of MachineCategories.flatMap(c => c.machines)) {
    assert.equal(picked.has(mid), MachineTypes[mid].implemented !== false, mid);
  }
});

test('the model picker lists full names, not the compact labels', () => {
  const h = createHarness();
  const { MachineCategories, MachineTypes } = h.context;
  h.context.renderModelPicker();
  const html = h.getElement('model-picker-menu').innerHTML;

  for (const mid of MachineCategories.flatMap(c => c.machines)) {
    const m = MachineTypes[mid];
    assert.ok(m.fullName, `${mid} needs a fullName to appear in the picker`);
    assert.ok(
      html.includes(`<span class="model-item-label">${m.fullName}</span>`),
      `${mid} should be listed as "${m.fullName}"`
    );
  }

  // The abbreviation stays visible beside the name, except where it would
  // stutter against a full name that already opens with it.
  assert.ok(html.includes('<span class="model-item-code">DFA</span>'));
  assert.ok(!html.includes('<span class="model-item-code">Moore</span>'));
});
