import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
const viewCss = readFileSync(new URL('../css/views.css', import.meta.url), 'utf8');

// The examples now live inside StateMate rather than in a dialog of their own —
// see the note at the top of js/statemate-ui.js for why they stayed at all.
// What this test protects is unchanged: one searchable dialog behind the header
// button, and no anchored dropdown.
test('the header button opens a searchable dialog', () => {
  assert.ok(html.includes('id="statemate-modal"'));
  assert.ok(html.includes('id="sm-input"'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
  assert.ok(!html.includes('id="example-menu"'), 'the old anchored dropdown should be gone');
  assert.ok(!html.includes('id="example-modal"'), 'the standalone example dialog is superseded');
});

test('standard and auxiliary overlays share one backdrop blur token', () => {
  assert.match(modalCss, /backdrop-filter:\s*blur\(var\(--overlay-blur\)\)/);
  assert.match(viewCss, /backdrop-filter:\s*blur\(var\(--overlay-blur\)\)/);
});

test('example search matches labels, files, and loaded metadata', () => {
  const h = createHarness();
  const options = [
    {
      file: 'dfa',
      label: 'Divisible by 5',
      meta: {
        title: 'Binary divisibility by five',
        blurb: 'Long division with remainder states.'
      }
    },
    {
      file: 'dfa-classic',
      label: 'Classic: even number of 1s',
      meta: { title: 'Parity checker', blurb: 'Tracks whether the count is even.' }
    }
  ];

  assert.deepEqual(h.context.filterMachineExampleOptions(options, 'binary remainder'), [options[0]]);
  assert.deepEqual(h.context.filterMachineExampleOptions(options, 'dfa classic'), [options[1]]);
  assert.deepEqual(h.context.filterMachineExampleOptions(options, 'even count'), [options[1]]);
  assert.deepEqual(h.context.filterMachineExampleOptions(options, ''), options);
});

test('example search is case and accent insensitive', () => {
  const h = createHarness();
  const options = [{ file: 'twnfa', label: 'Déjà vu', meta: null }];

  assert.deepEqual(h.context.filterMachineExampleOptions(options, 'DEJA'), options);
});
