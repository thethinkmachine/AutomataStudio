import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// A tape machine's step no longer carries a copy of the tape — it carries the
// index of a journal entry, and the window is rebuilt for whichever step is
// being looked at. See js/tape-log.js.
//
// The measurement that motivated it: a Turing machine whose head keeps
// travelling cost 921 MB over the default 10,000-step budget, because each
// step held two full copies of a window that grows with head travel. The same
// run is now ~2.4 MB, and the per-step cost is flat rather than quadratic.
//
// The oracle throughout is Tape.snapshot(), which this change did not touch.
// Rebuilding the window is the part that was reimplemented, so it is the part
// that has to be checked against the original rather than against itself.

const harness = createHarness();
const { context } = harness;

/** A tape hydrated to a given set of cells and head, for snapshot() to judge. */
function hydrate(cells, head, twoWay, opts = {}) {
  const { Tape, App } = context;
  const t = new Tape([], App.config.sym.blank, twoWay, opts);
  for (const [k, v] of cells) t.cells.set(k, v);
  t.head = head;
  return t;
}

test('the rebuilt window is the one Tape.snapshot() reports', () => {
  harness.resetApp();
  const { makeTapeLog } = context;

  const cases = [
    { name: 'bounded, head inside the input', cells: [[0, 'a'], [1, 'b'], [2, 'a']], head: 1, twoWay: false, opts: {} },
    { name: 'bounded, head out past the input', cells: [[0, 'a']], head: 6, twoWay: false, opts: {} },
    { name: 'bounded, empty tape', cells: [], head: 0, twoWay: false, opts: {} },
    { name: 'two-way, grown leftward', cells: [[-3, 'x'], [-1, 'y'], [0, 'a']], head: -2, twoWay: true, opts: {} },
    { name: 'two-way, head left of every written cell', cells: [[4, 'z']], head: -5, twoWay: true, opts: {} },
    { name: 'right-bounded, blanks inside the bound', cells: [[0, '⊢'], [1, 'a'], [4, '⊣']], head: 2, twoWay: false, opts: { rightBound: 4 } }
  ];

  for (const c of cases) {
    const cells = new Map(c.cells);
    const oracle = hydrate(cells, c.head, c.twoWay, c.opts).snapshot();

    // A log whose initial state is the case, with no writes recorded.
    const log = makeTapeLog(hydrate(cells, 0, c.twoWay, c.opts));
    log.begin(c.head);
    const frame = log.frameAt(0);

    assert.deepEqual(frame.tape, oracle.tape, `${c.name}: cells`);
    assert.equal(frame.head, oracle.head, `${c.name}: drawn head`);
    assert.equal(frame.origin, oracle.origin, `${c.name}: origin`);
  }
});

/** A TM that lays down x's rightward, then sweeps back left over them. */
function sweeper(limit = 60) {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  App.states.push(
    { id: 'r', name: 'right', x: 0, y: 0 },
    { id: 'l', name: 'left', x: 0, y: 0 },
    { id: 'h', name: 'halt', x: 0, y: 0 }
  );
  App.startId = 'r';
  App.accepts.add('h');
  App.alphabet = new Set(['a']);
  App.tapeAlphabet = new Set(['a', 'x', B]);
  App.transitions.push(
    { id: '1', from: 'r', to: 'r', symbol: 'a', write: 'x', dir: 'R' },
    { id: '2', from: 'r', to: 'l', symbol: B, write: B, dir: 'L' },
    // Scrub the x's back to blank on the way home — a blank write deletes the
    // cell rather than storing a blank, which is the replay case worth pinning.
    { id: '3', from: 'l', to: 'l', symbol: 'x', write: B, dir: 'L' },
    { id: '4', from: 'l', to: 'h', symbol: B, write: B, dir: 'R' }
  );
  App.config.maxTmSteps = limit;
}

test('a step reads the same tape whatever order the steps are read in', () => {
  sweeper();
  const { streamMachine, parseMachineInput } = context;
  const run = streamMachine('TM', parseMachineInput('TM', 'aaaaaa').input);
  run.drain();
  const n = run.steps.length;
  assert.ok(n > 8, 'the machine should actually run');

  const forward = run.steps.map(s => [s.tape.join(''), s.head]);
  const backward = [];
  for (let i = n - 1; i >= 0; i--) backward[i] = [run.steps[i].tape.join(''), run.steps[i].head];
  const scattered = [];
  for (const i of [n - 1, 0, Math.floor(n / 2), 1, n - 2, 3]) {
    scattered.push([i, run.steps[i].tape.join(''), run.steps[i].head]);
  }

  assert.deepEqual(backward, forward, 'a backward scrub rebuilds what playback showed');
  for (const [i, cells, head] of scattered) {
    assert.deepEqual([cells, head], forward[i], `random access to step ${i}`);
  }
});

test('a tape scrubbed back to empty reconstructs as empty', () => {
  sweeper();
  const { streamMachine, parseMachineInput, App } = context;
  const run = streamMachine('TM', parseMachineInput('TM', 'aaa').input);
  run.drain();
  const last = run.steps[run.steps.length - 1];
  // Every x was written back to blank, so nothing but blanks is left.
  assert.equal(last.tape.every(c => c === App.config.sym.blank), true,
    `expected all blanks, got ${JSON.stringify(last.tape)}`);
});

test("an LBA's refused write over an end marker replays as the no-op it was", () => {
  harness.resetApp();
  const { App, setMachine, streamMachine, parseMachineInput } = context;
  setMachine('LBA');
  const { leftMarker, rightMarker, blank } = App.config.sym;
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 0, y: 0 });
  App.startId = 's0';
  App.alphabet = new Set(['a']);
  App.tapeAlphabet = new Set(['a', blank, leftMarker, rightMarker]);
  App.transitions.push(
    // Try to overwrite the left marker. Tape.immutable refuses it.
    { id: '1', from: 's0', to: 's1', symbol: leftMarker, write: 'a', dir: 'R' },
    { id: '2', from: 's1', to: 's1', symbol: 'a', write: 'a', dir: 'R' }
  );
  const run = streamMachine('LBA', parseMachineInput('LBA', 'a').input);
  run.drain();
  for (const s of run.steps) {
    assert.equal(s.tape[0], leftMarker, 'the marker survives every reconstruction');
  }
});

test('a multi-tape step rebuilds every one of its tapes', () => {
  harness.resetApp();
  const { App, loadData, streamMachine, parseMachineInput } = context;
  loadData({
    machine: 'MTM',
    sigma: ['a'],
    stackAlpha: ['a', 'y', '⊔'],
    tapeCount: 3,
    states: [{ id: 's1', x: 0, y: 0, name: 'q0' }, { id: 's2', x: 100, y: 0, name: 'q1' }],
    startId: 's1',
    accepts: ['s2'],
    transitions: [
      { id: 't1', from: 's1', to: 's1', symbol: 'a', tapeSyms: ['a', '⊔', '⊔'], tapeWrites: ['y', 'y', 'y'], tapeDirs: ['R', 'R', 'R'] }
    ]
  });
  App.config.maxTmSteps = 40;
  const run = streamMachine('MTM', parseMachineInput('MTM', 'aaa,,').input);
  run.drain();
  assert.ok(run.steps.length > 2, `expected a few steps, got ${run.steps.length}`);
  const s = run.steps[2];
  assert.equal(s.tapes.length, 3, 'three tapes');
  assert.equal(s.heads.length, 3);
  assert.equal(s.views.length, 3);
  assert.equal(s.tapes[0][0], 'y', 'tape 1 was written on the way past');
  for (let k = 0; k < 3; k++) {
    assert.equal(s.views[k].cells, s.tapes[k], `tape ${k} is not stored twice`);
  }
});

// ── the structural guard against the quadratic coming back ─────────

test('a step stores no tape of its own', () => {
  sweeper();
  const { streamMachine, parseMachineInput } = context;
  const run = streamMachine('TM', parseMachineInput('TM', 'aaaa').input);
  run.drain();
  const own = Object.getOwnPropertyNames(run.steps[1]);
  for (const field of ['tape', 'head', 'view']) {
    assert.equal(own.includes(field), false,
      `${field} is an own property again — that is the O(steps × window) cost returning`);
    assert.notEqual(run.steps[1][field], undefined, `${field} still reads`);
  }
});

test('the tape and the view are one array, not two copies of one', () => {
  sweeper();
  const { streamMachine, parseMachineInput } = context;
  const run = streamMachine('TM', parseMachineInput('TM', 'aaaa').input);
  run.drain();
  const s = run.steps[2];
  assert.equal(s.view.cells, s.tape, 'view() used to take a second snapshot of its own');
});
