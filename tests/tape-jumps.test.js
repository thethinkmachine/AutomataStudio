import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// A jump in a long run costs a tape's width, not the run's length — see
// js/tape-log.js. The log keeps cost-spaced checkpoints of the tape, and steps
// *back* by undoing a write rather than replaying from the start: what a cell
// held before a step wrote it is the symbol that step read. The reader reaches
// any step by the cheapest of four routes, so every one of them has to land on
// the same tape.
//
// The oracle is independent of the log: a few lines of interpreter over the
// real Tape class, taking Tape.snapshot() at every step. Every order of reading
// is run under each route forced in turn (setJumpRoute), since left to itself
// the log takes whichever is cheapest and a small tape would never undo.

const harness = createHarness();
const { context } = harness;

/** Load a TM from rules, and return what the reference interpreter sees. */
function machine(rules, { start, accept, tokens, twoWay, limit }) {
  harness.resetApp();
  const { App, setMachine, Tape } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  const b = s => (s === '_' ? B : s);
  const ids = new Set(rules.flatMap(r => [r[0], r[4]]).concat(start, accept || []));
  for (const id of ids) App.states.push({ id, name: id, x: 0, y: 0 });
  App.startId = start;
  if (accept) App.accepts.add(accept);
  App.config.twoWayTape = twoWay;
  App.config.maxTmSteps = limit;
  const rows = rules.map(([from, symbol, write, dir, to], i) => ({ id: 't' + i, from, to, symbol: b(symbol), write: b(write), dir }));
  App.transitions.push(...rows);

  const input = tokens.map(b);
  const tape = new Tape(input, B, twoWay);
  const want = [];
  let state = start;
  for (let n = 0; n < limit; n++) {
    const snap = tape.snapshot();
    want.push({ state, tape: snap.tape.join('\u0001'), head: snap.head, origin: snap.origin });
    if (state === accept) break;
    const sym = tape.read();
    const t = rows.find(r => r.from === state && r.symbol === sym);
    if (!t) break;
    tape.write(t.write);
    tape.move(t.dir);
    state = t.to;
  }
  const run = context.streamMachine('TM', input);
  run.drain();
  return { run, want };
}

const got = s => ({ state: s.state, tape: s.tape.join('\u0001'), head: s.head, origin: s.view.origin });

const ROUTES = ['auto', 'near', 'before', 'after'];

function readEveryWay(m, label) {
  let crossed = 0;
  for (const route of ROUTES) {
    context.setJumpRoute(route);
    crossed = readEveryOrder(m, `${label}, ${route}`);
  }
  context.setJumpRoute('auto');
  return crossed;
}

function readEveryOrder({ run, want }, label) {
  const steps = run.steps;
  const n = want.length;
  assert.equal(steps.length, n, `${label}: step count`);
  const check = i => assert.deepEqual(got(steps[i]), want[i], `${label}: step ${i}`);
  for (let i = 0; i < n; i++) check(i);                 // forwards
  for (let i = n - 1; i >= 0; i--) check(i);            // backwards, a step at a time: undo
  for (let k = 0; k < 400; k++) check((k * 7919) % n);  // scattered jumps
  // Either side of every checkpoint, arriving from the far end of the run each
  // time, so the checkpoint on each side is the cheapest way in.
  const cps = steps[0]._log.journal().checkpoints;
  for (const cp of cps) {
    for (const i of [cp.row - 2, cp.row - 1, cp.row, cp.row + 1]) {
      if (i < 0 || i >= n) continue;
      check(i < n / 2 ? n - 1 : 0);
      check(i);
    }
  }
  return cps.length;
}

// The five-state busy beaver champion: writes blanks as well as ones, and
// grows its tape both ways.
const BB5 = [
  ['A', '_', '1', 'R', 'B'], ['A', '1', '1', 'L', 'C'],
  ['B', '_', '1', 'R', 'C'], ['B', '1', '1', 'R', 'B'],
  ['C', '_', '1', 'R', 'D'], ['C', '1', '_', 'L', 'E'],
  ['D', '_', '1', 'L', 'A'], ['D', '1', '1', 'L', 'D'],
  ['E', '_', '1', 'R', 'H'], ['E', '1', '_', 'L', 'A']
];

test('every step reads the same tape by every route to it', () => {
  const m = machine(BB5, { start: 'A', accept: 'H', tokens: [], twoWay: true, limit: 20000 });
  const crossed = readEveryWay(m, 'BB(5)');
  assert.ok(crossed > 5, `the run should cross several checkpoints, crossed ${crossed}`);
});

test('stepping back over an explicit blank puts back the blank, not an empty cell', () => {
  // The input ends in a blank *symbol*, which the tape stores — unlike a
  // written blank, which deletes the cell. It decides where step 0's window
  // ends, so undoing the write over it must restore it exactly: the symbol
  // read there is the blank either way, and only the log's own copy of the
  // tape can tell the two apart.
  const m = machine([
    ['s0', 'a', 'a', 'R', 's1'],
    ['s1', '_', 'x', 'R', 's2'],
    ['s2', '_', 'y', 'L', 's3'],
    ['s3', 'x', 'x', 'L', 'h']
  ], { start: 's0', accept: 'h', tokens: ['a', '_'], twoWay: false, limit: 100 });
  assert.equal(m.want[0].tape.split('\u0001').length, 2, 'the stored blank widens step 0');
  readEveryWay(m, 'explicit blank');
});

test('a jump replays at most about a tape-width, and a step either way is one write', () => {
  const { run } = machine(BB5, { start: 'A', accept: 'H', tokens: [], twoWay: true, limit: 60000 });
  const { CHECKPOINT_MIN } = context;
  const steps = run.steps;
  const n = steps.length;
  const log = steps[0]._log;
  const cost = i => { const before = log.replayed(); void steps[i].tape; return log.replayed() - before; };

  cost(n - 1);
  const width = steps[n - 1].tape.length;
  for (const i of [n >> 1, 1, n - 2, n >> 2, (3 * n) >> 2]) {
    const c = cost(i);
    assert.ok(c <= Math.max(CHECKPOINT_MIN, width), `jump to ${i}: ${c} writes, tape ${width} wide`);
  }
  const at = n >> 1;
  cost(at);
  assert.equal(cost(at - 1), 1, 'a step back undoes one write');
  assert.equal(cost(at), 1, 'and a step forward applies one');
});
