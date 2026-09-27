import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// A deterministic tape machine's run keeps columns, not step objects — see
// js/machines/columns.js, js/tape-log.js and `columnarSteps` in
// js/machines/run.js. The measurement that motivated it: a run of the
// five-state busy beaver kept 250 bytes a step, 10.6 GiB to its halt at
// 47,176,870 steps; it is now 5 bytes a step. `npm run bench -- horizon`
// measures that; these tests pin what makes it safe.
//
// The oracle throughout is the producer itself: its generator, iterated
// directly, hands over the step objects it made, and a columnar run has to
// rebuild exactly those, field for field, in any order they are read.

const harness = createHarness();
const { context } = harness;

// ── the columns ───────────────────────────────────────────────────

test('a head column reads back every position, in any order', () => {
  const { HeadColumn } = context;
  const col = new HeadColumn();
  const want = [];
  let h = 0, r = 7;
  for (let i = 0; i < 20000; i++) {
    r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;
    // Mostly a head's ±1, with the occasional jump no signed byte holds —
    // including the edges of what one does.
    const kind = r % 97;
    h += kind === 0 ? 300 : kind === 1 ? -128 : kind === 2 ? 127 : kind === 3 ? -127 : (r & 2) - 1;
    col.push(h);
    want.push(h);
  }
  for (let i = 0; i < want.length; i++) assert.equal(col.get(i), want[i], `forward ${i}`);
  for (let i = want.length - 1; i >= 0; i--) assert.equal(col.get(i), want[i], `backward ${i}`);
  for (let k = 0; k < 2000; k++) {
    const i = (k * 7919) % want.length;
    assert.equal(col.get(i), want[i], `scattered ${i}`);
  }
  assert.equal(col.get(-1), undefined);
  assert.equal(col.get(want.length), undefined);
});

test('a code column widens when a code outgrows it, and keeps what it held', () => {
  const { CodeColumn } = context;
  const col = new CodeColumn();
  const want = [];
  for (let i = 0; i < 9000; i++) {
    const v = i < 3000 ? i % 256 : i < 6000 ? i * 7 % 65536 : i * 104729 % 4294967296;
    col.push(v);
    want.push(v);
  }
  want.forEach((v, i) => assert.equal(col.get(i), v, `code ${i}`));
  assert.equal(col.Type, Uint32Array);
});

// ── the machines ──────────────────────────────────────────────────

/** A TM that lays down x's rightward and scrubs them back to blank. */
function sweeper(limit, twoWay = false) {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  App.config.twoWayTape = twoWay;
  App.states.push({ id: 'r', name: 'right', x: 0, y: 0 }, { id: 'l', name: 'left', x: 0, y: 0 }, { id: 'h', name: 'halt', x: 0, y: 0 });
  App.startId = 'r';
  App.accepts.add('h');
  App.sigma = new Set(['a']);
  App.tapeAlphabet = new Set(['a', 'x', B]);
  App.transitions.push(
    { id: '1', from: 'r', to: 'r', symbol: 'a', write: 'x', dir: 'R' },
    { id: '2', from: 'r', to: 'l', symbol: B, write: B, dir: 'L' },
    { id: '3', from: 'l', to: 'l', symbol: 'x', write: B, dir: 'L' },
    { id: '4', from: 'l', to: 'h', symbol: B, write: B, dir: 'R' }
  );
  App.config.maxTmSteps = limit;
  return 'TM';
}

/** Runs off the right end of its tape: the LBA's own reject step. */
function lbaOffTheEnd() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('LBA');
  const { rightMarker } = App.config.sym;
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.transitions.push(
    { id: '1', from: 's0', to: 's0', symbol: context.App.config.sym.leftMarker, write: context.App.config.sym.leftMarker, dir: 'R' },
    { id: '2', from: 's0', to: 's0', symbol: 'a', write: 'a', dir: 'R' },
    { id: '3', from: 's0', to: 's0', symbol: rightMarker, write: rightMarker, dir: 'R' }
  );
  App.config.maxTmSteps = 100;
  return 'LBA';
}

/** Three tapes, the first read and the other two written. */
function threeTapes(limit) {
  harness.resetApp();
  context.loadData({
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
  context.App.config.maxTmSteps = limit;
  return 'MTM';
}

/** Two states bouncing on one cell: a loop the detector proves. */
function bouncer() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  App.states.push({ id: 'p', name: 'p', x: 0, y: 0 }, { id: 'q', name: 'q', x: 0, y: 0 });
  App.startId = 'p';
  App.sigma = new Set(['a']);
  App.transitions.push(
    { id: '1', from: 'p', to: 'q', symbol: B, write: B, dir: 'R' },
    { id: '2', from: 'q', to: 'p', symbol: B, write: B, dir: 'L' }
  );
  App.config.maxTmSteps = 1000;
  return 'TM';
}

const CASES = [
  ['TM, halts', () => sweeper(1000), 'aaaaaa'],
  ['TM, two-way, budget runs out', () => sweeper(9, true), 'aaaaaa'],
  ['TM, proven loop', bouncer, ''],
  ['LBA, runs off its end', lbaOffTheEnd, 'aaa'],
  ['MTM, three tapes', () => threeTapes(40), 'aaa,,']
];

const fields = s => ({
  state: s.state, tid: s.tid, note: s.note, final: s.final, loopFrom: s.loopFrom,
  tape: s.tape && s.tape.join('\u0001'), head: s.head,
  tapes: s.tapes && s.tapes.map(t => t.join('\u0001')), heads: s.heads,
  origin: s.view ? s.view.origin : s.views && s.views.map(v => v.origin)
});

test('a columnar run is step for step what its producer yielded', () => {
  for (const [name, build, raw] of CASES) {
    const m = build();
    const { machineDef, parseMachineInput, streamMachine } = context;
    const input = parseMachineInput(m, raw).input;
    // The producer's own objects, kept whole — what the player used to hold.
    const originals = [...machineDef(m).stream(input, m)].map(fields);
    const run = streamMachine(m, input);
    run.drain();
    assert.ok(originals.length > 2, `${name}: the machine should actually run`);
    assert.equal(run.steps.length, originals.length, `${name}: step count`);

    const order = [];
    for (let i = 0; i < originals.length; i++) order.push(i);
    for (let i = originals.length - 1; i >= 0; i--) order.push(i);
    for (let k = 0; k < originals.length; k++) order.push((k * 7) % originals.length);
    for (const i of order) assert.deepEqual(fields(run.steps[i]), originals[i], `${name}: step ${i}`);
    assert.equal(run.steps[0].tokens, run.steps[originals.length - 1].tokens, `${name}: one word, shared`);
  }
});

test('how the run ended is kept on the step that says it', () => {
  const ends = {};
  for (const [name, build, raw] of CASES) {
    const m = build();
    const run = context.streamMachine(m, context.parseMachineInput(m, raw).input);
    run.drain();
    const last = run.steps[run.steps.length - 1];
    ends[name] = last.final;
    // The rest carry no verdict: a verdict is the run's last word.
    for (let i = 0; i < run.steps.length - 1; i++) assert.equal(run.steps[i].final, undefined, `${name}: step ${i}`);
  }
  assert.deepEqual(ends, {
    'TM, halts': 'accept',
    'TM, two-way, budget runs out': 'timeout',
    'TM, proven loop': 'loop',
    'LBA, runs off its end': 'reject',
    'MTM, three tapes': 'reject'
  });
});

test('the steps are still an array to everyone who reads them', () => {
  const m = sweeper(1000);
  const run = context.streamMachine(m, context.parseMachineInput(m, 'aaaa').input);
  run.drain();
  const steps = run.steps;
  const n = steps.length;
  assert.equal(Array.isArray(steps), true);
  assert.deepEqual(steps.slice(1, 3).map(s => s.state), [steps[1].state, steps[2].state]);
  assert.equal([...steps].length, n);
  let seen = 0;
  for (const s of steps) { assert.ok(s.note); seen++; }
  assert.equal(seen, n);
  assert.equal(steps.at(-1).final, 'accept');
  assert.equal(steps[n], undefined);
  assert.equal(n - 1 in steps, true);
  assert.equal(n in steps, false);
  assert.equal(steps.findIndex(s => s.final), n - 1);
});

test('a step keeps its address and nothing else', () => {
  let m = sweeper(1000);
  let run = context.streamMachine(m, context.parseMachineInput(m, 'aaaa').input);
  run.drain();
  assert.deepEqual(Object.keys(run.steps[2]), ['_log', '_i'], 'a tape step is its log and its index');

  m = threeTapes(40);
  run = context.streamMachine(m, context.parseMachineInput(m, 'aaa,,').input);
  run.drain();
  assert.deepEqual(Object.keys(run.steps[2]), ['_logs', '_i'], 'k tapes in lockstep share one index');
});

test('a step read twice is one object, and the newest is the producer’s own', () => {
  const m = sweeper(1000);
  const { machineDef, parseMachineInput, makeRun, stepColumnsOf } = context;
  const handed = [];
  const gen = machineDef(m).stream(parseMachineInput(m, 'aaaa').input, m);
  const run = makeRun({ next: () => { const r = gen.next(); if (!r.done) handed.push(r.value); return r; } }, { columnsOf: stepColumnsOf });
  run.at(3);
  assert.equal(run.steps[3], handed[3], 'the newest step is the object the producer holds');
  run.drain();
  assert.equal(run.steps[2], run.steps[2]);
  assert.equal(run.steps.at(-1), handed.at(-1));
});

test('a long run holds a few bytes a step', () => {
  harness.resetApp();
  const { App, setMachine, streamMachine, stepColumnsOf } = context;
  // Walks off down its tape forever, so it runs the whole budget — long
  // enough that the chunks a short run rounds up to are noise.
  setMachine('TM');
  const B = App.config.sym.blank;
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: B, write: 'x', dir: 'R' });
  App.config.maxTmSteps = 200000;
  const run = streamMachine('TM', []);
  run.drain();
  assert.equal(run.steps.length, 200000);
  const cols = stepColumnsOf(run.steps[0]);
  const perStep = cols.bytes() / run.steps.length;
  assert.ok(perStep < 8, `${perStep.toFixed(2)} bytes a step — a column went back to an array, or a wider type`);
});
