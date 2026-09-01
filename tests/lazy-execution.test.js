import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Lazy execution: the run is a cursor over its steps rather than a finished
// array, so a machine that runs to its step budget costs nothing until it is
// watched. See js/machines/run.js and runsLazily() in js/state.js.
//
// The invariant everything else rests on is the first test here. Eager and
// lazy must produce *the same steps*, or `execMode` would not be a performance
// setting at all — it would be a second implementation of every simulator,
// free to disagree with the first. That is the same rule that keeps
// decideBatchRows() serving both the serial and the parallel batch paths.

const harness = createHarness();
const { context } = harness;

/** A DFA over {a, b} accepting everything: a run is |w| + 1 steps. */
function dfa() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('DFA');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.accepts.add('s0');
  App.alphabet = new Set(['a', 'b']);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: 'a' });
  App.transitions.push({ id: 't1', from: 's0', to: 's0', symbol: 'b' });
}

/** A TM that walks right over blank tape forever — it never halts. */
function runawayTM() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.alphabet = new Set(['a']);
  App.tapeAlphabet = new Set(['a', App.config.sym.blank]);
  App.transitions.push({
    id: 't0', from: 's0', to: 's0',
    symbol: App.config.sym.any, write: App.config.sym.any, dir: 'R'
  });
  // Otherwise the repeat check stops it at step 2 and there is no long run.
  App.config.detectLoops = false;
  App.config.maxTmSteps = 300;
}

// ── the invariant ──────────────────────────────────────────────────

test('a streamed run is step-for-step the run that was precomputed', () => {
  const { streamMachine, parseMachineInput, App } = context;
  for (const build of [dfa, runawayTM]) {
    build();
    const m = App.machine;
    const parsed = parseMachineInput(m, m === 'DFA' ? 'abba' : 'a');

    const eager = streamMachine(m, parsed.input);
    eager.drain();

    build();
    const lazy = streamMachine(m, parsed.input);
    assert.equal(lazy.streaming, true, `${m} should stream`);
    while (!lazy.done) lazy.pull();

    assert.equal(lazy.steps.length, eager.steps.length, `${m} step count`);
    assert.deepEqual(
      lazy.steps.map(s => [s.state, s.note, s.final ?? null]),
      eager.steps.map(s => [s.state, s.note, s.final ?? null]),
      `${m} steps`
    );
  }
});

test('a step is computed only when it is asked for', () => {
  runawayTM();
  const { streamMachine, parseMachineInput, App } = context;
  const run = streamMachine('TM', parseMachineInput('TM', 'a').input);

  assert.equal(run.known, 0, 'nothing is computed by constructing the run');
  run.at(0);
  assert.equal(run.known, 1);
  run.at(9);
  assert.equal(run.known, 10, 'exactly as far as was asked for');
  assert.equal(run.done, false, 'the machine has not halted');
  run.drain();
  assert.equal(run.known, App.config.maxTmSteps, 'the budget is still the bound');
});

test('a search-based machine reports that it cannot stream, and still runs', () => {
  harness.resetApp();
  const { App, setMachine, streamMachine, parseMachineInput, machineStreams } = context;
  setMachine('NPDA');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.accepts.add('s0');
  App.alphabet = new Set(['a']);
  const parsed = parseMachineInput('NPDA', 'a');
  const run = streamMachine('NPDA', parsed.input);
  assert.equal(machineStreams('NPDA'), false, 'no prefix exists before the search ends');
  assert.equal(run.streaming, false);
  assert.equal(run.done, true, 'it arrives complete');
  assert.ok(run.steps.length > 0);
});

// ── the policy ─────────────────────────────────────────────────────

test('the mode is chosen by projected run length, not by machine size', () => {
  const { App, runsLazily, projectedRunSteps, LAZY_STEP_THRESHOLD } = context;
  dfa();
  // A thousand states does not make a four-symbol run long.
  for (let i = 0; i < 1000; i++) App.states.push({ id: `pad${i}`, name: `p${i}`, x: 0, y: 0 });
  assert.equal(projectedRunSteps('DFA', 4), 5);
  assert.equal(runsLazily(4, 'DFA'), false, 'a big DFA on a short word is precomputed');

  runawayTM();
  App.config.maxTmSteps = LAZY_STEP_THRESHOLD * 5;
  assert.equal(runsLazily(1, 'TM'), true, 'a three-state TM streams');
});

test('an explicit mode overrides the projection in both directions', () => {
  const { App, runsLazily } = context;
  dfa();
  App.config.execMode = 'lazy';
  assert.equal(runsLazily(4, 'DFA'), true);
  App.config.execMode = 'eager';
  runawayTM();
  assert.equal(runsLazily(1, 'TM'), false);
});

test('absent reads as auto, so an older profile is not pinned to one strategy', () => {
  const { App, execMode } = context;
  dfa();
  delete App.config.execMode;
  assert.equal(execMode(), 'auto');
  App.config.execMode = 'nonsense';
  assert.equal(execMode(), 'auto');
});

test('the expensive-run judgement is derived, so a new machine cannot fall out of it', () => {
  const { hasExpensiveRuns, MachineTypes } = context;
  for (const m of ['TM', 'NDTM', 'MTM', 'LBA', 'ITM', 'NPDA', 'QA', 'Counter', '2PDA', 'PDT', '2DFA', '2NFA', '2DFT']) {
    assert.equal(hasExpensiveRuns(m), true, m);
  }
  for (const m of ['DFA', 'NFA', 'Moore', 'Mealy']) {
    assert.equal(hasExpensiveRuns(m), false, m);
  }
  // Every tape or stack machine in the table, without naming any of them.
  for (const [m, cfg] of Object.entries(MachineTypes)) {
    if (cfg.hasTape || cfg.hasStack) assert.equal(hasExpensiveRuns(m), true, m);
  }
});

// ── it is a preference, not a property of the machine ──────────────

test('the mode rides the settings profile and never the workspace', () => {
  const { App, getEditorSettingsData, getWorkspaceData } = context;
  dfa();
  App.config.execMode = 'lazy';
  assert.equal(getEditorSettingsData().execMode, 'lazy');
  // Unlike detectLoops and twoWayTape, this cannot change what a run decides,
  // so a file must not carry it — the next reader keeps their own setting.
  assert.equal('execMode' in getWorkspaceData(), false);
});

// ── the transport ──────────────────────────────────────────────────

test('the counter admits it does not know the length of a streaming run', () => {
  runawayTM();
  const { App, $, runSim, updateSimScrubber } = context;
  App.config.execMode = 'lazy';
  $('sim-in').value = 'a';
  runSim();
  context.stopAutoPlay();
  updateSimScrubber();
  assert.match($('sim-step-counter').textContent, /\+$/, 'a "+" rather than a total that will grow');

  dfa();
  App.config.execMode = 'eager';
  $('sim-in').value = 'ab';
  runSim();
  context.stopAutoPlay();
  updateSimScrubber();
  assert.equal($('sim-step-counter').textContent.includes('+'), false);
});

test('stepping forward past the frontier computes the next step', () => {
  runawayTM();
  const { App, $, runSim, stepFwd } = context;
  App.config.execMode = 'lazy';
  $('sim-in').value = 'a';
  runSim();
  context.stopAutoPlay();
  const before = App.simSteps.length;
  stepFwd();
  assert.equal(App.simSteps.length, before + 1, 'the pull is the bounds check');
  assert.equal(App.simIdx, before);
});

test('a paused streaming run is resumable at its frontier', () => {
  runawayTM();
  const { App, $, runSim, canResumeSim } = context;
  App.config.execMode = 'lazy';
  $('sim-in').value = 'a';
  runSim();
  context.stopAutoPlay();
  App.simIdx = App.simSteps.length - 1;
  assert.equal(canResumeSim(), true, 'at the frontier is not the end');

  dfa();
  App.config.execMode = 'eager';
  $('sim-in').value = 'ab';
  runSim();
  context.stopAutoPlay();
  App.simIdx = App.simSteps.length - 1;
  assert.equal(canResumeSim(), false, 'a finished run on its last step has nothing left');
});
