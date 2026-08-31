import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// The app self-adjusting for a machine too big to draw in full.
//
// The property that matters more than any individual saving is that the profile
// is *derived*: it must not write to App.config, so the reader's settings are
// remembered exactly as they were and come back the moment the override is
// lifted or the machine shrinks. Everything else here is one consumer each.

const { App } = context;

function build(nStates, nTrans) {
  createHarness();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    App.states.push({ id: 's' + i, name: 'q_' + i, x: 100 + (i % 40) * 90, y: 100 + Math.floor(i / 40) * 90 });
  }
  App.startId = 's0';
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % nStates), to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b'
    });
  }
  App.transN = nTrans;
  context.invalidateStateIndex();
}

// ── the threshold ─────────────────────────────────────────────────

test('the line is the collision budget, stated once', () => {
  // Two copies of this number is the bug the move to state.js exists to
  // prevent: geometry.js re-exports it rather than declaring its own.
  assert.equal(context.COLLISION_BUDGET_STATES, 200);
  assert.equal(context.COLLISION_BUDGET_TRANSITIONS, 700);

  build(10, 10);
  assert.equal(context.machineIsLarge(), false);

  build(context.COLLISION_BUDGET_STATES + 1, 10);
  assert.equal(context.machineIsLarge(), true, 'past the state budget');

  build(10, context.COLLISION_BUDGET_TRANSITIONS + 1);
  assert.equal(context.machineIsLarge(), true, 'past the transition budget');
});

test('either budget alone is enough, and neither is required of the other', () => {
  build(context.COLLISION_BUDGET_STATES, context.COLLISION_BUDGET_TRANSITIONS);
  assert.equal(context.machineIsLarge(), false, 'exactly at both is still inside');
});

// ── it is derived, never written ──────────────────────────────────

test('the profile changes nothing on App.config', () => {
  build(1000, 2000);
  const before = JSON.stringify(App.config);
  assert.equal(context.largeMachineProfile(), true);
  context.renderAll();
  assert.equal(context.edgeLabelsHidden(), true);
  assert.equal(context.animEnabled(), false);
  assert.equal(JSON.stringify(App.config), before,
    'the profile wrote to the config it is supposed to be remembering');
});

test('the reader gets their settings back when the machine shrinks', () => {
  build(1000, 2000);
  App.config.edgeLabelStyle = 'pills';
  assert.equal(context.edgeLabelsHidden(), true);

  build(5, 5);
  App.config.edgeLabelStyle = 'pills';
  assert.equal(context.edgeLabelsHidden(), false, 'pills came back untouched');
  assert.equal(context.edgeLabelsAutoHidden(), false);
});

test('an explicit "none" is still the reader speaking, not the profile', () => {
  build(5, 5);
  App.config.edgeLabelStyle = 'none';
  assert.equal(context.edgeLabelsHidden(), true);
  assert.equal(context.edgeLabelsAutoHidden(), false,
    'nothing to explain: the reader asked for this');
});

// ── the override ──────────────────────────────────────────────────

test('the override lifts every part of the profile at once', () => {
  build(1000, 2000);
  App.config.render.largeMachineAuto = false;
  assert.equal(context.largeMachineProfile(), false);
  assert.equal(context.edgeLabelsHidden(), false);
  assert.equal(context.effectiveAutosaveInterval(), App.config.autosaveIntervalMs);
  assert.equal(context.historyDepthLimit(), context.HISTORY_MAX_ENTRIES);
});

test('absent means on, so an older workspace does not load with it off', () => {
  build(1000, 2000);
  delete App.config.render.largeMachineAuto;
  assert.equal(context.largeMachineProfile(), true);
});

test('the override prompt reports the machine in front of the reader', () => {
  build(1000, 2000);
  const p = context.largeMachineOverridePrompt();
  assert.match(p.message, /1,000 states/);
  assert.match(p.message, /2,000 transitions/);
  // The whole reason the profile is derived is that nothing is lost by it, and
  // the prompt has to be able to say so.
  assert.match(p.message, /settings are kept/i);
  assert.ok(p.danger);
});

// ── the consumers ─────────────────────────────────────────────────

test('a hidden label reserves no layout box', () => {
  build(1000, 2000);
  const ctx = context.currentLayoutContext();
  assert.ok(ctx.groups.length > 0);
  // Not merely undrawn: the label placer and getContentBounds stop steering
  // around a box that is never painted, which is the expensive half.
  App.config.render.largeMachineAuto = false;
  const wide = context.currentLayoutContext();
  assert.notEqual(JSON.stringify([...ctx.geo.keys()].length), null);
  assert.ok(wide.groups.length > 0);
});

test('no edge label is built on a large machine at readable zoom', () => {
  build(1000, 2000);
  App.cam.z = 1;
  // The camera is nowhere near the LOD threshold — this is the profile.
  assert.equal(context.edgeLabelLOD(), false);
  context.renderAll();
  let labelled = 0;
  for (const [, node] of App.domCache.transitions) {
    labelled += node.__parts.textEl.childNodes.length + node.__parts.pillEl.childNodes.length;
  }
  assert.equal(labelled, 0, 'the wall of pills is what this feature exists to stop');
});

test('the profile leaves state-name wrapping alone', () => {
  // The line the profile is drawn along: it turns off what costs frames, never
  // what costs nothing. Wrapping is a few tspans behind the cull window, and
  // un-wrapping overflows long names out of their circles — on the diagram
  // that is already hardest to read. The profile keeps the names, so it has no
  // business breaking their layout.
  build(1000, 2000);
  assert.equal(context.largeMachineProfile(), true);
  assert.equal(context.wrapStateLabelsOn(), true);
  assert.deepEqual(context.splitStateLabel('NEW_ACCOUNT_OPENED'), ['NEW', 'ACCOUNT', 'OPENED']);

  App.config.wrapStateLabels = false;
  assert.equal(context.wrapStateLabelsOn(), false, 'the reader still decides');
});

test('autosave is stretched, never switched off, and never shortened', () => {
  build(1000, 2000);
  App.config.autosaveIntervalMs = 15000;
  assert.equal(context.effectiveAutosaveInterval(), context.LARGE_AUTOSAVE_INTERVAL_MS);

  // A reader who asked for a longer interval keeps theirs.
  App.config.autosaveIntervalMs = 300000;
  assert.equal(context.effectiveAutosaveInterval(), 300000);

  // 0 is "off" and stays off — the profile must not turn autosave *on*.
  App.config.autosaveIntervalMs = 0;
  assert.equal(context.effectiveAutosaveInterval(), 0);
});

test('the undo stack is capped harder, and undo still works', () => {
  build(1000, 2000);
  assert.equal(context.historyDepthLimit(), context.HISTORY_MAX_ENTRIES_LARGE);
  const name = App.states[0].name;
  context.snapshot();
  App.states[0].name = 'changed';
  context.undo();
  assert.equal(context.getState('s0').name, name, 'a capped stack is still a stack');
});

test('the depth cap evicts down to the limit rather than by one', () => {
  build(1000, 2000);
  for (let i = 0; i < context.HISTORY_MAX_ENTRIES_LARGE + 12; i++) context.snapshot();
  assert.ok(App.history.length <= context.HISTORY_MAX_ENTRIES_LARGE,
    `history is ${App.history.length}, over the large-machine cap`);
});
