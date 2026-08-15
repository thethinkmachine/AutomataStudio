import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
const viewCss = readFileSync(new URL('../css/views.css', import.meta.url), 'utf8');

test('the Examples button opens a searchable dialog', () => {
  assert.ok(html.includes('id="example-modal"'));
  assert.ok(html.includes('id="example-search"'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
  assert.ok(!html.includes('id="example-menu"'), 'the old anchored dropdown should be gone');
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
