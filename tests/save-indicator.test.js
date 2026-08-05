import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const {context, getElement} = harness;

function seedWorkspace({ dirty = false } = {}) {
  harness.resetApp();
  context.Workspaces.length = 0; context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'A', dirty: dirty, data: context.exportWorkspaceState() }); context.setActiveWorkspaceId('w0');
}

const saveState = () => context.saveState;
const hasDot = () => getElement('save-now-btn').classList.contains('is-dirty');
const countdownText = () => getElement('autosave-countdown').textContent;

// ── The save state must not be clobbered by unrelated redraws ─────
// renderTabs() runs from ~18 call sites. Recomputing the indicator from the
// dirty flags alone used to wipe a failed save the moment any tab activity
// redrew, reporting work as stored when it was not.

test('a failed save survives an unrelated tab redraw', () => {
  seedWorkspace({ dirty: true });
  context.setSaveState('error', 'Save failed');

  context.updateSaveIndicator();

  assert.strictEqual(saveState(), 'error',
    'only the save that failed may clear the error state');
});

test('an in-flight save survives an unrelated tab redraw', () => {
  seedWorkspace({ dirty: true });
  context.setSaveState('saving');

  context.updateSaveIndicator();

  assert.strictEqual(saveState(), 'saving');
});

test('the indicator still tracks dirty state from a settled state', () => {
  seedWorkspace({ dirty: true });
  context.setSaveState('saved');

  context.updateSaveIndicator();
  assert.strictEqual(saveState(), 'unsaved', 'a dirty workspace reads as unsaved');

  context.Workspaces[0].dirty = false;
  context.updateSaveIndicator();
  assert.strictEqual(saveState(), 'saved');
});

test('a save failure is still visible after the tab strip rerenders', () => {
  seedWorkspace({ dirty: true });
  context.setSaveState('error', 'Save failed');

  context.renderTabs();

  assert.strictEqual(saveState(), 'error');
  assert.ok(hasDot(), 'failed work is still unsaved, so the marker stays');
});

// ── One source of truth for the button's marker ───────────────────

test('the unsaved dot is derived from the save state', () => {
  seedWorkspace();

  context.setSaveState('unsaved');
  assert.strictEqual(hasDot(), true, 'unsaved work shows the marker');

  context.setSaveState('saved');
  assert.strictEqual(hasDot(), false, 'a stored workspace shows a plain icon');

  context.setSaveState('error');
  assert.strictEqual(hasDot(), true, 'a failed save leaves the work unsaved');
});

test('the dot and the button colour never disagree', () => {
  seedWorkspace();
  for (const state of ['unsaved', 'saved', 'saving', 'error']) {
    context.setSaveState(state);
    const expected = state === 'unsaved' || state === 'error';
    assert.strictEqual(hasDot(), expected,
      `dot should be ${expected} while the button reads "${state}"`);
    assert.strictEqual(getElement('save-now-btn').dataset.saveState, state);
  }
});

// ── The autosave countdown only runs when it means something ──────

test('the countdown stays blank on a clean workspace', () => {
  seedWorkspace({ dirty: false });
  context.App.config.autosaveIntervalMs = 15000;

  context.restartAutosaveTimer();

  assert.strictEqual(countdownText(), '',
    'with nothing to save, a ticking number is motion that conveys nothing');
});

test('the countdown appears once there is unsaved work', () => {
  seedWorkspace({ dirty: true });
  context.App.config.autosaveIntervalMs = 15000;

  context.restartAutosaveTimer();

  assert.match(countdownText(), /^\d+$/, 'pending work gets a real countdown');
});

test('the countdown clears again once the work is saved', () => {
  seedWorkspace({ dirty: true });
  context.App.config.autosaveIntervalMs = 15000;
  context.restartAutosaveTimer();
  assert.match(countdownText(), /^\d+$/);

  context.Workspaces[0].dirty = false;
  context.restartAutosaveTimer();

  assert.strictEqual(countdownText(), '');
});

test('the countdown stays blank when autosave is switched off', () => {
  seedWorkspace({ dirty: true });
  context.App.config.autosaveIntervalMs = 0;

  context.restartAutosaveTimer();

  assert.strictEqual(countdownText(), '',
    'a disabled autosave must not imply a pending one');
});
