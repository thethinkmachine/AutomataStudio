import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
// Safe after harness.js, which installs the DOM stub and its localStorage.
import { forgetPref, readFlag, readJsonPref, readPref, writeFlag, writeJsonPref, writePref } from '../js/core/prefs.js';

test('a preference reads back what was written, and its default when absent', () => {
  forgetPref('t-pref');
  assert.equal(readPref('t-pref', 'dflt'), 'dflt');
  writePref('t-pref', 42);
  assert.equal(readPref('t-pref'), '42');

  forgetPref('t-flag');
  assert.equal(readFlag('t-flag', true), true);
  writeFlag('t-flag', false);
  assert.equal(readFlag('t-flag', true), false);

  writeJsonPref('t-json', { side: 'left' });
  assert.deepEqual(readJsonPref('t-json'), { side: 'left' });
  writePref('t-json', '{not json');
  assert.equal(readJsonPref('t-json', 'fallback'), 'fallback');
});

test('storage that throws reads as the default and writes as nothing', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  try {
    assert.equal(readPref('x', 'dflt'), 'dflt');
    assert.equal(readFlag('x', true), true);
    assert.doesNotThrow(() => { writePref('x', 1); writeFlag('x', true); forgetPref('x'); });
  } finally {
    globalThis.localStorage = real;
  }
});

test('the toolbar comes back collapsed when it was left collapsed', () => {
  // The DOM stub has no #canvas-toolbox until a test makes one, so this path
  // went unexercised and a refactor left it reading a variable that no
  // longer existed — which threw on every page load in a real browser.
  const h = createHarness();
  writeFlag('automata-toolbar-collapsed', true);
  const toolbox = h.getElement('canvas-toolbox');
  h.context.initToolbarCollapse();
  assert.equal(h.context.App.toolbarCollapsed, true);
  assert.ok(toolbox.classList.contains('collapsed'));
});
