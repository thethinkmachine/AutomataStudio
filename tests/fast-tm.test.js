import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// js/machines/fast-tm.js takes over a TM run once the loop detector has
// stopped looking, and records straight into the tape log's and the step
// columns' arrays. The claim it rests on: **nothing downstream can tell which
// loop produced a step.** So the oracle here is the slow loop itself
// (`setFastLane(false)`), and every run is compared on everything a reader can
// ask of it — each step's state, transition, note and verdict, each journal
// row including the symbol codes, the checkpoints, and the tape the tracker
// draws, read forwards, backwards and scattered, which is the undo path.

const harness = createHarness();
const { context } = harness;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
}

function bb5() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  for (const s of ['A', 'B', 'C', 'D', 'E', 'H']) App.states.push({ id: s, name: s, x: 0, y: 0 });
  App.startId = 'A';
  App.accepts.add('H');
  App.sigma = new Set(['1']);
  App.tapeAlphabet = new Set(['1', B]);
  App.config.twoWayTape = true;
  [['A', B, '1', 'R', 'B'], ['A', '1', '1', 'L', 'C'], ['B', B, '1', 'R', 'C'], ['B', '1', '1', 'R', 'B'],
    ['C', B, '1', 'R', 'D'], ['C', '1', B, 'L', 'E'], ['D', B, '1', 'L', 'A'], ['D', '1', '1', 'L', 'D'],
    ['E', B, '1', 'R', 'H'], ['E', '1', B, 'L', 'A']]
    .forEach(([from, symbol, write, dir, to], i) => App.transitions.push({ id: 't' + i, from, to, symbol, write, dir }));
}

/**
 * A random deterministic TM over {a, b, x}: some pairs with no transition
 * (a reject), a wildcard read on some states, writes that are omitted or the
 * wildcard (put back what was read), a stay-put direction, an accepting state
 * or none. Returns the input, which may hold an explicit blank.
 */
function randomTM(seed) {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const r = rng(seed);
  const B = App.config.sym.blank, any = App.config.sym.any;
  const Q = 2 + Math.floor(r() * 5);
  const syms = ['a', 'b', 'x', B];
  for (let q = 0; q < Q; q++) App.states.push({ id: 'q' + q, name: 'q' + q, x: 0, y: 0 });
  App.startId = 'q0';
  if (r() < 0.6) App.accepts.add('q' + Math.floor(r() * Q));
  App.sigma = new Set(['a', 'b']);
  App.tapeAlphabet = new Set(syms);
  App.config.twoWayTape = r() < 0.5;
  App.config.detectLoops = r() < 0.5;
  let id = 0;
  const dirs = ['L', 'R', 'R', 'L', 'S'];
  for (let q = 0; q < Q; q++) {
    const wild = r() < 0.2;
    for (const sym of wild ? [any] : syms) {
      if (r() < 0.06) continue;
      const w = r();
      App.transitions.push({
        id: 't' + id++, from: 'q' + q, to: 'q' + Math.floor(r() * Q), symbol: sym,
        write: w < 0.15 ? '' : w < 0.3 ? any : syms[Math.floor(r() * syms.length)],
        dir: dirs[Math.floor(r() * dirs.length)]
      });
    }
  }
  const len = Math.floor(r() * 12);
  return Array.from({ length: len }, () => (r() < 0.1 ? B : r() < 0.5 ? 'a' : 'b'));
}

/** Pull the run the way a reader would: `slices` is the size of each ask. */
function play(tokens, fast, slices) {
  context.setFastLane(fast);
  const run = context.streamMachine('TM', tokens);
  if (!slices) run.drain();
  else for (let k = 0; !run.done; k++) run.drain(slices(k));
  return run;
}

function sameRun(slow, fast, label, r = rng(99)) {
  const a = slow.steps, b = fast.steps;
  assert.equal(b.length, a.length, `${label}: length`);
  const n = a.length;
  const ja = context.stepJournals(a[n - 1])[0], jb = context.stepJournals(b[n - 1])[0];
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    assert.equal(y.state, x.state, `${label}: state at ${i}`);
    assert.equal(y.tid, x.tid, `${label}: transition at ${i}`);
    assert.equal(y.final, x.final, `${label}: verdict at ${i}`);
    assert.equal(y.loopFrom, x.loopFrom, `${label}: loop at ${i}`);
    assert.equal(y.note, x.note, `${label}: note at ${i}`);
    const ra = { ...ja.into(i) }, rb = { ...jb.into(i) };
    assert.deepEqual(rb, ra, `${label}: journal row ${i}`);
  }
  assert.deepEqual(jb.checkpoints.map(c => [c.row, c.lo, [...c.codes]]), ja.checkpoints.map(c => [c.row, c.lo, [...c.codes]]), `${label}: checkpoints`);
  // The tape as the tracker draws it: forwards, backwards, scattered.
  const at = [];
  for (let i = 0; i < n; i += Math.max(1, n >> 7)) at.push(i);
  for (let i = n - 1; i >= 0; i -= Math.max(1, n >> 7)) at.push(i);
  for (let k = 0; k < 64; k++) at.push(Math.floor(r() * n));
  for (const i of at) {
    assert.deepEqual([a[i].tape.join('|'), a[i].head, a[i].view.origin], [b[i].tape.join('|'), b[i].head, b[i].view.origin], `${label}: tape at ${i}`);
  }
}

test('BB(5): the fast lane records what the slow loop does, from the hand-over at ~5,000 steps', () => {
  bb5();
  context.App.config.maxTmSteps = 300000;
  const slow = play([], false);
  const fast = play([], true);
  assert.equal(fast.steps[fast.steps.length - 1].final, 'timeout');
  sameRun(slow, fast, 'bb5');
});

test('BB(5) with loop detection off: the fast lane runs from step 0', () => {
  bb5();
  context.App.config.detectLoops = false;
  context.App.config.maxTmSteps = 100000;
  sameRun(play([], false), play([], true), 'bb5 no loops');
});

test('BB(5) runs to its halt the same either way, however it is pulled', () => {
  bb5();
  context.App.config.detectLoops = false;
  context.App.config.maxTmSteps = 47176871;
  const run = play([], true);
  const last = run.steps[run.steps.length - 1];
  assert.equal(run.steps.length, 47176871);
  assert.equal(last.final, 'accept');
  assert.equal(last.tape.filter(s => s === '1').length, 4098);
});

test('random machines agree on every step, pulled in slices of every size', () => {
  let handed = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const tokens = randomTM(seed);
    context.App.config.maxTmSteps = 3000 + (seed % 7) * 2000;
    const slow = play(tokens, false);
    if (slow.steps.length > 5001 || !context.App.config.detectLoops) handed++;
    const r = rng(seed);
    // One step at a time, the drain's slices, and odd sizes between.
    const pick = seed % 3 === 0 ? () => 1 : seed % 3 === 1 ? () => 500 : () => 1 + Math.floor(r() * 900);
    sameRun(slow, play(tokens, true, pick), `seed ${seed}`);
  }
  // The comparison is only worth something if the fast lane actually ran.
  assert.ok(handed > 60, `the fast lane ran on ${handed} machines`);
});

test('an edit made while a run is paused is obeyed from the next step, in both loops', () => {
  const edited = fast => {
    bb5();
    context.App.config.detectLoops = false;
    context.App.config.maxTmSteps = 60000;
    context.setFastLane(fast);
    const run = context.streamMachine('TM', []);
    run.drain(20000);
    // In place, as the transition dialog edits: a write, a target and a
    // direction changed, and an accepting mark moved.
    const t = context.App.transitions;
    t[3].write = context.App.config.sym.blank;
    t[5].to = 'D';
    t[6].dir = 'R';
    context.App.accepts.delete('H');
    context.App.accepts.add('E');
    // One at a time for a while — the path that asks δ directly — then in
    // slices, which re-check the table.
    for (let k = 0; k < 50; k++) run.pull();
    run.drain(15000);
    t[5].to = 'E';
    context.App.accepts.delete('E');
    for (let k = 0; k < 50; k++) run.pull();
    run.drain();
    return run;
  };
  sameRun(edited(false), edited(true), 'edited');
});

test('simTM, which pulls one step per next(), gets the same steps', () => {
  bb5();
  context.App.config.detectLoops = false;
  context.App.config.maxTmSteps = 20000;
  context.setFastLane(false);
  context.simTM([]);
  const slow = { steps: context.App.simSteps };
  context.setFastLane(true);
  context.simTM([]);
  sameRun(slow, { steps: context.App.simSteps }, 'simTM');
});

test('an explicit blank in the input is put back when stepping backwards', () => {
  // A blank and an explicit blank draw the same, so the difference only shows
  // at an end: a trailing blank in the input is part of step 0's window. The
  // machine writes over it at once and runs on; walking back to step 0 one
  // write at a time — no checkpoint to lean on — must put it back.
  const trailing = fast => {
    harness.resetApp();
    const { App, setMachine } = context;
    setMachine('TM');
    const B = App.config.sym.blank;
    App.states.push({ id: 'r', name: 'r', x: 0, y: 0 });
    App.startId = 'r';
    App.sigma = new Set(['1']);
    App.tapeAlphabet = new Set(['1', 'x', B]);
    App.transitions.push({ id: 'w', from: 'r', to: 'r', symbol: App.config.sym.any, write: 'x', dir: 'R' });
    App.config.detectLoops = false;
    App.config.maxTmSteps = 3000;
    const run = play(['1', '1', B], fast);
    context.setJumpRoute('near');
    const n = run.steps.length;
    run.steps[n - 1].tape;
    const first = run.steps[0].tape;
    context.setJumpRoute('auto');
    return first;
  };
  const slow = trailing(false);
  assert.equal(slow.length, 3, 'the slow loop keeps the trailing blank in step 0');
  assert.deepEqual(trailing(true), slow);
});
