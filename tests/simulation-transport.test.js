import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The run button's four jobs: play, pause, resume, replay.
//
// It used to have two. The not-playing branch called runSim() whatever the
// state, and runSim() begins with resetSim() — so pausing to look at a
// configuration and pressing play again threw the run away and started it
// over. That made pausing useless on exactly the runs worth pausing, and it
// was not even a new capability being asked for: the step-forward button
// already advances the same paused run without re-simulating.

const harness = createHarness();
const { context } = harness;

/** A DFA over {a, b} that accepts everything, so a run is |w| + 1 steps. */
function loop(word) {
  harness.resetApp();
  const { App, setMachine, $ } = context;
  setMachine('DFA');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.accepts.add('s0');
  App.alphabet = new Set(['a', 'b']);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: 'a' });
  App.transitions.push({ id: 't1', from: 's0', to: 's0', symbol: 'b' });
  $('sim-in').value = word;
}

/** Runs, then stops the timer where a reader's pause would stop it. */
function runAndPauseAt(idx) {
  context.runSim();
  context.stopAutoPlay();
  context.App.simIdx = idx;
  context.renderSimStep();
}

test('pausing and playing again resumes, rather than starting over', () => {
  loop('aaaa');
  runAndPauseAt(2);
  const steps = context.App.simSteps;

  context.handleRunBtnClick();
  assert.equal(context.App.simIdx, 2, 'still where the reader paused');
  assert.equal(context.App.simSteps, steps, 'and it is the same run, not a new one');
  assert.ok(context.App.autoTimer, 'playing again');
  context.stopAutoPlay();
});

test('the button pauses a run that is playing', () => {
  loop('aaaa');
  context.runSim();
  assert.ok(context.App.autoTimer, 'a fresh run auto-plays');
  context.handleRunBtnClick();
  assert.equal(context.App.autoTimer, null);
  assert.ok(context.App.simSteps.length, 'pausing keeps the run');
});

test('a finished run replays from the start', () => {
  loop('aa');
  context.runSim();
  context.stopAutoPlay();
  context.stepToEnd();
  const last = context.App.simSteps.length - 1;
  assert.equal(context.App.simIdx, last);

  assert.equal(context.canResumeSim(), false, 'there is nothing left to resume');
  context.handleRunBtnClick();
  assert.equal(context.App.simIdx, 0, 'the replay icon replays');
  context.stopAutoPlay();
});

test('editing the run box before pressing play runs the new word', () => {
  // The other direction of the same surprise: silently carrying on with the
  // previous word would be as wrong as silently restarting.
  loop('aaaa');
  runAndPauseAt(2);
  context.$('sim-in').value = 'bb';

  assert.equal(context.canResumeSim(), false);
  context.handleRunBtnClick();
  assert.equal(context.App.simIdx, 0);
  assert.equal(context.App.simInput, 'bb');
  assert.equal(context.App.simSteps.length, 3, 'a run of the word now in the box');
  context.stopAutoPlay();
});

test('retyping the same word resumes — it is the word that decides, not the keystrokes', () => {
  loop('aaaa');
  runAndPauseAt(1);
  context.$('sim-in').value = 'aaaa';
  assert.equal(context.canResumeSim(), true);
  context.stopAutoPlay();
});

test('with no run at all, the button runs', () => {
  loop('ab');
  assert.equal(context.canResumeSim(), false);
  context.handleRunBtnClick();
  assert.equal(context.App.simSteps.length, 3);
  context.stopAutoPlay();
});

test('a refused run leaves nothing to resume', () => {
  // runSim records the word *after* the guards, so a run that never started
  // cannot be resumed into.
  loop('aaaa');
  runAndPauseAt(2);
  context.App.startId = null;
  context.$('sim-in').value = 'aaaa';
  context.runSim();
  assert.equal(context.App.simInput, null, 'reset cleared it and nothing replaced it');
  assert.equal(context.canResumeSim(), false);
});

test('resetting clears the word along with the steps', () => {
  loop('aaaa');
  runAndPauseAt(2);
  context.resetSim();
  assert.equal(context.App.simInput, null);
  assert.equal(context.canResumeSim(), false);
});
