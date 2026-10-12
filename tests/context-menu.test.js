import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './harness.js';
import { applyContextMenuPolicy, nativeContextMenuWanted } from '../js/ui/context-menu.js';

const require = createRequire(import.meta.url);
const { contextMenuTemplate } = require('../electron/context-menu.cjs');

// The DOM stub's closest() always answers null, so these are elements of
// their own: a tag, attributes, a parent, and closest() over the simple
// selectors the policy uses (`tag`, `[attr]`, `[attr="v"]`, `tag[attr]`).
function el(tag, attrs = {}, parent = null) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), parentNode: parent,
    getAttribute: name => (name in attrs ? attrs[name] : null),
    matches(selector) {
      return selector.split(',').some(part => {
        const m = /^\s*([a-z]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?\s*$/.exec(part);
        if (!m) return false;
        const [, t, attr, value] = m;
        if (t && t !== tag) return false;
        if (attr && !(attr in attrs)) return false;
        if (value !== undefined && attrs[attr] !== value) return false;
        return true;
      });
    },
    closest(selector) {
      for (let n = node; n; n = n.parentNode) if (n.matches(selector)) return n;
      return null;
    }
  };
  if ('type' in attrs) node.type = attrs.type;
  return node;
}

const NO_SELECTION = { isCollapsed: true, toString: () => '' };
const wanted = (target, selection = NO_SELECTION) => nativeContextMenuWanted(target, selection);

test('the native menu is offered in a text field, and only a text field', () => {
  const panel = el('div');
  assert.equal(wanted(el('input', {}, panel)), true, 'an input with no type is text');
  assert.equal(wanted(el('input', { type: 'search' }, panel)), true);
  assert.equal(wanted(el('input', { type: 'number' }, panel)), true);
  assert.equal(wanted(el('textarea', {}, panel)), true);
  assert.equal(wanted(el('span', {}, el('div', { contenteditable: 'true' }))), true, 'inside an editable region');
  assert.equal(wanted(el('input', { type: 'checkbox' }, panel)), false, 'a checkbox has nothing to paste into');
  assert.equal(wanted(el('input', { type: 'range' }, panel)), false);
  assert.equal(wanted(el('div', { contenteditable: 'false' }, panel)), false);
});

test('on selected text, and on a link', () => {
  const para = el('p');
  const selection = { isCollapsed: false, toString: () => 'δ(q0, a)', containsNode: node => node === para };
  assert.equal(wanted(para, selection), true, 'right-click on the selection: copy');
  assert.equal(wanted(el('p'), selection), false, 'a selection elsewhere does not make every click a copy');
  assert.equal(wanted(el('span', {}, el('a', { href: 'https://example.org' }))), true);
  assert.equal(wanted(el('a')), false, 'an anchor without an href is not a link');
});

test('nowhere else: chrome, buttons and panels get no browser menu', () => {
  for (const target of [el('button'), el('div'), el('svg'), el('span', {}, el('header'))]) {
    const event = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    applyContextMenuPolicy(event);
    assert.equal(event.defaultPrevented, true, target.tagName);
  }
});

test('a part of the app with its own menu is left to it', () => {
  // The canvas, a state, a tab: their listener ran first and prevented the
  // default. The policy does not second-guess it — nor, in a text field, does
  // it re-enable a menu an owner chose to suppress.
  let calls = 0;
  const event = { target: el('textarea'), defaultPrevented: true, preventDefault() { calls++; } };
  applyContextMenuPolicy(event);
  assert.equal(calls, 0);
});

test('the desktop shell builds its native menu for the same three places', () => {
  const editable = contextMenuTemplate({ isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } });
  assert.deepEqual(editable.filter(i => i.role).map(i => i.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  assert.equal(editable.find(i => i.role === 'undo').enabled, false, 'undo is offered only when there is something to undo');

  assert.deepEqual(contextMenuTemplate({ selectionText: 'q0' }).map(i => i.role), ['copy']);
  assert.deepEqual(contextMenuTemplate({ selectionText: '   ' }), [], 'whitespace is not worth a menu');
  assert.deepEqual(contextMenuTemplate({}), [], 'nowhere else');

  const opened = [], copied = [];
  const link = contextMenuTemplate({ linkURL: 'https://example.org/x' }, { openExternal: u => opened.push(u), copyText: t => copied.push(t) });
  link.find(i => i.label === 'Open Link in Browser').click();
  link.find(i => i.label === 'Copy Link Address').click();
  assert.deepEqual([opened, copied], [['https://example.org/x'], ['https://example.org/x']]);
  assert.deepEqual(contextMenuTemplate({ linkURL: 'javascript:alert(1)' }), [], 'only web and mail links');
});

test('a misspelled word offers its suggestions first', () => {
  const replaced = [];
  const t = contextMenuTemplate(
    { isEditable: true, misspelledWord: 'automatn', dictionarySuggestions: ['automaton', 'automata'], editFlags: {} },
    { replaceMisspelling: w => replaced.push(w) });
  assert.deepEqual(t.slice(0, 2).map(i => i.label), ['automaton', 'automata']);
  t[0].click();
  assert.deepEqual(replaced, ['automaton']);
});
