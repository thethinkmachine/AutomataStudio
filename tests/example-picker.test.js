import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
const viewCss = readFileSync(new URL('../css/views.css', import.meta.url), 'utf8');

// The examples live inside StateMate rather than in a dialog of their own — see
// the note at the top of js/statemate-ui.js for why they stayed at all. One
// searchable surface, and no anchored dropdown.
//
// StateMate no longer has a header button: that slot is the machine wizard's.
// What this pins is that losing it cost StateMate nothing — the panel tab, the
// ⋯ menu and the two keyboard routes are all still there — because a surface
// reachable only from a button that has been repurposed is a surface nobody
// finds again.
test('StateMate is a searchable panel, reachable without a header button', () => {
  assert.ok(html.includes('id="statemate-panel"'));
  assert.ok(html.includes('id="sm-input"'));
  assert.ok(html.includes('id="panel-tab-statemate"'), 'the panel tab is the primary route');
  assert.ok(html.includes('aria-controls="statemate-panel"'));
  assert.ok(html.includes('onclick="openStateMate()"'), 'and the ⋯ menu is the second');
  assert.ok(!html.includes('id="example-picker-btn"'), 'the header sparkle is gone');
  assert.ok(!html.includes('id="example-menu"'), 'the old anchored dropdown should be gone');
  assert.ok(!html.includes('id="example-modal"'), 'the standalone example dialog is superseded');
});

// The button that replaced it. Two modes, one element — js/wizard-ui.js swaps
// the glyph on Change.GRAPH — so the markup carries the create-mode icon and
// the dialog it controls, and nothing else.
test('the header button opens the machine wizard', () => {
  const button = html.match(/<button[^>]+id="machine-wizard-btn"[^>]*>/s)?.[0] || '';
  assert.ok(button, 'the wizard button is in the header');
  assert.ok(button.includes('onclick="openMachineWizard()"'));
  assert.ok(button.includes('aria-haspopup="dialog"'));
  assert.ok(button.includes('aria-controls="wizard-modal"'));
  assert.ok(html.includes('id="wizard-modal"'), 'and the dialog it names exists');

  // The rail, the body and the footer are all generated, so the shell holds
  // their hosts and not one inline handler.
  const shell = html.match(/<div class="overlay" id="wizard-modal"[\s\S]*?\n  <\/div>/)?.[0] || '';
  assert.ok(shell.includes('id="wiz-rail"') && shell.includes('id="wiz-body"') && shell.includes('id="wiz-foot"'));
  assert.ok(!/\son[a-z]+=/.test(shell), 'the wizard dialog wires itself at creation');
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
