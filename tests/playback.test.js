import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Playback: paced by frames, painted once per frame, and each paint writing
// only what changed. See "the playback clock" in js/simulation.js.
//
// Profiled in Chromium before any of this, a step's paint cost 8–54ms against
// a 16.7ms frame and a step's computation 0.7–16µs, so the player was never
// short of CPU for the machine — it was spending it redrawing things that had
// not changed. These pin the three halves of the fix: the clock does many
// steps per paint when asked to, the tape tracker leaves unchanged cells alone,
// and the canvas highlights are a diff.

const harness = createHarness();
const { context } = harness;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** A DFA over {a} that accepts everything, so a run of `aⁿ` is n + 1 steps. */
function loopDFA(n, states = 1) {
  harness.resetApp();
  const { App, setMachine, $ } = context;
  setMachine('DFA');
  for (let i = 0; i < states; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i * 120, y: 0 });
  App.startId = 's0';
  App.states.forEach(s => App.accepts.add(s.id));
  App.sigma = new Set(['a']);
  for (let i = 0; i < states; i++) App.transitions.push({ id: 't' + i, from: 's' + i, to: 's' + ((i + 1) % states), symbol: 'a' });
  $('sim-in').value = 'a'.repeat(n);
  return App;
}

test('at Max, a frame performs many steps and playback stops at the end', async () => {
  const App = loopDFA(300);
  App.config.autoSpeed = 0;
  context.runSim();          // a fresh run auto-plays
  assert.ok(App.autoTimer, 'playing');
  for (let i = 0; i < 50 && App.autoTimer; i++) await wait(20);
  assert.equal(App.simIdx, 300, 'every step, in a handful of frames rather than one per step');
  assert.equal(App.autoTimer, null, 'and the clock stopped itself at the end');
});

test('at a slow speed, nothing is due until an interval has passed', async () => {
  const App = loopDFA(10);
  App.config.autoSpeed = 1000;
  context.runSim();
  await wait(60);   // several frames
  assert.equal(App.simIdx, 0, 'the first step lands one interval after play, as the timer did');
  context.stopAutoPlay();
});

test('pausing mid-run stops the clock; the frame it had armed does nothing', async () => {
  const App = loopDFA(100);
  App.config.autoSpeed = 0;
  context.runSim();
  context.stopAutoPlay();
  const at = App.simIdx;
  await wait(60);
  assert.equal(App.simIdx, at);
  assert.equal(App.autoTimer, null);
});

test('a tape cell that did not change is not written', () => {
  // Every step used to rewrite every cell's class, text and tooltip — for a
  // 2,000-symbol word that was 37% of a step, to change the two cells the head
  // moved between.
  const host = context.document.createElement('div');
  const view = head => ({ kind: 'tape', cells: ['a', 'b', 'c', 'd', 'e'], head, origin: 0, leftBound: 0, rightBound: 4, markers: [], blank: '_', readOnly: false });
  context.renderTracker(host, [{ label: 'In', view: view(1) }]);
  const cells = [...host.__tvRows.values()][0].lastChild.firstChild.childNodes[1].__tvCells;
  const writes = new Map();
  for (const [abs, node] of cells) {
    const set = node.setAttribute.bind(node);
    node.setAttribute = (k, v) => { writes.set(abs, (writes.get(abs) || 0) + 1); set(k, v); };
  }
  context.renderTracker(host, [{ label: 'In', view: view(2) }]);
  assert.deepEqual([...writes.keys()].sort(), [1, 2], 'the cell the head left and the one it reached');
  assert.ok(cells.get(2).className.includes('is-head'));
  assert.ok(!cells.get(1).className.includes('is-head'));
});

test('a canvas mark that stays is not rewritten from one step to the next', () => {
  // The trail and the visited states only grow as a run plays forward, but the
  // frame used to strip every mark and put every one back — thousands of class
  // writes per step on a machine a run had wandered across. A three-state
  // cycle: q0 → q1 → q2 → q0 …
  const App = loopDFA(8, 3);
  context.renderAll();
  context.runSim();
  context.stopAutoPlay();
  App.simIdx = 5; context.renderSimStep();     // q2 current; q0 and q1 visited
  const q1 = App.domCache.states.get('s1');
  const q2 = App.domCache.states.get('s2');
  assert.ok(q1.classList.contains('sim-visited-st'));
  assert.ok(q2.classList.contains('act-st'));

  const spy = node => {
    const log = [];
    const { add, remove } = node.classList;
    node.classList.add = (...c) => { log.push('+' + c.join()); add(...c); };
    node.classList.remove = (...c) => { log.push('-' + c.join()); remove(...c); };
    return log;
  };
  const q1Writes = spy(q1), q2Writes = spy(q2);
  App.simIdx = 6; context.renderSimStep();     // current moves q2 → q0; q1 stays visited
  assert.deepEqual(q1Writes, [], 'a mark that stays is left alone — it used to come off and go back on');
  assert.deepEqual(q2Writes.sort(), ['+sim-visited-st', '-act-st'], 'and one that changes changes once');

  // A reset takes everything this module lit back off.
  context.resetSim();
  for (const n of [q1, q2]) assert.ok(!n.classList.contains('sim-visited-st') && !n.classList.contains('act-st'));
});
