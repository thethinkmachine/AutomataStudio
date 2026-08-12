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
  h.context.commit(() => {                               // graph change on top
    App.states.push({ id: 's1', x: 10, y: 10, name: 'q0' });
  });

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
  h.context.commit(() => { App.states.push({ id: 'x', x: 0, y: 0, name: 'q0' }); });
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
  // snapshot() records where to come back to, then the edit happens.
  h.context.snapshot();
  App.config.radius = 55;
  h.context.setR(55);
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

// ── the round trip ────────────────────────────────────────────────

// N edits, N undos, N redos, back to N. This is the property the two competing
// snapshot orderings broke: undo restored the entry *beneath* the newest, which
// is only the previous state if the newest entry is the current one. It is not
// — snapshot() records the state an edit starts from — so every undo landed one
// action early, and the newest edit could never be redone at all.
test('every edit can be undone and redone, one step at a time', () => {
  const h = createHarness();
  const { App } = h.context;
  const N = 5;

  for (let i = 0; i < N; i++) h.context.createState(i * 80, 0, `q${i}`);
  assert.equal(App.states.length, N);

  const down = [];
  for (let i = 0; i < N; i++) { h.context.undo(); down.push(App.states.length); }
  assert.deepEqual(down, [4, 3, 2, 1, 0], 'each undo removes exactly one state');

  const up = [];
  for (let i = 0; i < N; i++) { h.context.redo(); up.push(App.states.length); }
  assert.deepEqual(up, [1, 2, 3, 4, 5], 'each redo puts exactly one back');
  assert.equal(App.states.length, N, 'a full round trip is lossless');
});

test('undo stops at the beginning instead of running past it', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'q0');

  h.context.undo();
  assert.equal(App.states.length, 0);
  h.context.undo();                       // nothing left
  assert.equal(App.states.length, 0, 'an extra undo is a no-op, not a throw');

  h.context.redo();
  assert.equal(App.states.length, 1, 'and redo still works after over-undoing');
});

test('a fresh session has nothing to undo', () => {
  const h = createHarness();
  assert.equal(h.context.App.history.length, 0,
    'a boot snapshot would make the first Ctrl+Z a no-op that still spent a press');
});
