import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Settings changes in the undo history.
//
// Only the *document* settings are recorded — how this machine is drawn. App
// preferences (theme, notation, step budgets) deliberately stay out, because
// Ctrl+Z crossing an unrelated edit must not swap the user's theme.

test('a canvas setting can be undone and redone', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.edgeLabelStyle = 'compact';
  h.context.snapshot();                       // baseline

  h.context.setQuickSetting('qs-edge-labels', 'none');
  assert.equal(App.config.edgeLabelStyle, 'none');

  h.context.undo();
  assert.equal(App.config.edgeLabelStyle, 'compact', 'undo restores the previous style');

  h.context.redo();
  assert.equal(App.config.edgeLabelStyle, 'none', 'redo puts it back');
});

test('undo carries the setting back across an unrelated graph edit', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.edgeLabelStyle = 'compact';
  h.context.snapshot();

  h.context.setQuickSetting('qs-edge-labels', 'none');   // settings change
  // A graph edit through commit() — snapshot-after, the same model the settings
  // change above uses. (createState snapshots *before* mutating, so mixing the
  // two here would be testing that inconsistency rather than this feature.)
  App.states.push({ id: 's1', x: 10, y: 10, name: 'q0' });
  h.context.commit();                                    // graph change on top

  h.context.undo();                                      // undo the state
  assert.equal(App.config.edgeLabelStyle, 'none', 'the setting still stands');
  h.context.undo();                                      // undo the setting
  assert.equal(App.config.edgeLabelStyle, 'compact');
});

test('app preferences are NOT undoable', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.snapshot();

  App.config.theme = 'nord';
  App.config.sym.eps = '@';
  App.config.maxTmSteps = 999;
  h.context.createState(0, 0, 'q0');
  h.context.commit();
  h.context.undo();

  assert.equal(App.config.theme, 'nord', 'undo must not swap the theme');
  assert.equal(App.config.sym.eps, '@', 'undo must not rewrite notation');
  assert.equal(App.config.maxTmSteps, 999, 'undo must not revert step budgets');
});

test('restoring radius republishes R to the renderer', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();
  const circle = App.domCache.states.get(App.states[0].id).__parts.circle;
  h.context.snapshot();

  App.config.radius = 55;
  h.context.setR(55);
  h.context.snapshot();
  h.context.renderAll();
  assert.equal(Number(circle.getAttribute('r')), 55);

  h.context.undo();
  assert.equal(App.config.radius, 30);
  assert.equal(Number(circle.getAttribute('r')), 30, 'R must follow, not just App.config');
});

test('a settings snapshot is skipped when nothing undoable changed', () => {
  const h = createHarness();
  h.context.snapshot();
  const depth = h.context.App.history.length;

  assert.equal(h.context.snapshotSettings(), false, 'no change, no entry');
  assert.equal(h.context.App.history.length, depth);

  h.context.App.config.edgeLabelStyle = 'pills';
  assert.equal(h.context.snapshotSettings(), true);
  assert.equal(h.context.App.history.length, depth + 1);
});

test('a snapshot predating settings history restores without throwing', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.edgeLabelStyle = 'pills';
  // An entry written before config was recorded: no `config` key at all.
  const legacy = JSON.stringify({
    machine: 'DFA', states: [], transitions: [], startId: null, accepts: [],
    sigma: ['a'], stackAlpha: [], outputAlpha: [], stateN: 0, transN: 0
  });
  assert.doesNotThrow(() => h.context.restoreSnapshot(legacy));
  assert.equal(App.config.edgeLabelStyle, 'pills', 'settings are left as they were');
});

test('a quick settings change marks the tab unsaved', () => {
  const h = createHarness();
  h.context.createTab('T');
  const ws = h.context.Workspaces.find(w => w.id === h.context.activeWorkspaceId);
  ws.dirty = false;

  h.context.setQuickSetting('qs-edge-labels', 'none');
  assert.equal(ws.dirty, true, 'these settings are saved with the workspace');
});
