import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// A long run, as the player paints it.
//
// The engine was made to cost the same per step at any length — columns, not
// objects; checkpoints, not replays — and the player went on painting as if
// the run were short. Profiled in Chromium on the five-state busy beaver at
// Max, a frame was 35ms at 250k steps and 53ms at 3M, and with the space-time
// diagram open it was 1.7 *seconds* by 3M. Every cost that grew was a paint
// walking something as long as the run or the tape:
//
//   * the tracker drew every cell of the tape's window, and re-appended all of
//     them whenever the window moved — most frames, on a two-way tape;
//   * the space-time layout read every row's state to size its gutter, on
//     every paint, once per cell size "fit" tried;
//   * the trail resolved every step's edge, building each step to do it;
//   * the trace log rebuilt four hundred rows a frame at Max, and ⏭ painted
//     the whole player after every 500 steps it computed.
//
// These pin each of those to what is on screen rather than to the run.

const harness = createHarness();
const { context } = harness;

// ── the tracker draws a band of a long tape ──────────────────────────

const BLANK = '⊔';

function tapeView(n, head, origin = 0) {
  const cells = Array.from({ length: n }, (_, i) => (i % 3 ? '1' : BLANK));
  return { kind: 'tape', cells, head, origin, leftBound: null, rightBound: null, markers: [], blank: BLANK, readOnly: false };
}

function drawTape(host, view) {
  context.renderTracker(host, [{ label: 'Tape', view }]);
  return [...host.__tvRows.values()][0].lastChild.firstChild.childNodes[1];
}

const numbers = wrap => wrap.children.map(c => Number(c.children[1].textContent));

/** Counts what `fn` does to the row's DOM and how many nodes it creates. */
function countOps(wrap, fn) {
  const ops = { inserted: 0, removed: 0, created: 0 };
  const { insertBefore, appendChild, removeChild } = wrap;
  const create = globalThis.document.createElement;
  wrap.insertBefore = function (...a) { ops.inserted++; return insertBefore.apply(this, a); };
  wrap.appendChild = function (...a) { ops.inserted++; return appendChild.apply(this, a); };
  wrap.removeChild = function (...a) { ops.removed++; return removeChild.apply(this, a); };
  globalThis.document.createElement = function (...a) { ops.created++; return create.apply(this, a); };
  try { fn(); } finally {
    Object.assign(wrap, { insertBefore, appendChild, removeChild });
    globalThis.document.createElement = create;
  }
  return ops;
}

test('a short tape is still drawn whole', () => {
  const host = context.document.createElement('div');
  const wrap = drawTape(host, tapeView(200, 50, -20));
  assert.equal(wrap.children.length, 200);
  assert.deepEqual(numbers(wrap), Array.from({ length: 200 }, (_, i) => i - 20));
  assert.equal(wrap.style.paddingLeft || '', '');
  assert.equal(wrap.style.paddingRight || '', '');
});

test('a long tape draws a band around the head, and pads the width of the rest', () => {
  const host = context.document.createElement('div');
  const n = 20000, first = -7000, head = 12000;
  const wrap = drawTape(host, tapeView(n, head, first));
  const drawn = numbers(wrap);
  assert.ok(drawn.length < 300, `${drawn.length} cells drawn of ${n}`);
  assert.ok(drawn.includes(first + head), 'the head is among them');
  drawn.forEach((x, i) => { if (i) assert.equal(x, drawn[i - 1] + 1, 'contiguous, and numbered by cell'); });
  const lo = drawn[0], hi = drawn[drawn.length - 1];
  assert.equal(wrap.style.paddingLeft, `${(lo - first) * 27}px`, 'the cells to the left, as the width they would take');
  assert.equal(wrap.style.paddingRight, `${(first + n - 1 - hi) * 27}px`);
  assert.ok(wrap.children.some(c => String(c.className).includes('is-head')));
});

test('a head pacing inside the band changes no structure', () => {
  const host = context.document.createElement('div');
  const wrap = drawTape(host, tapeView(20000, 10000));
  const ops = countOps(wrap, () => {
    for (let h = 10000; h < 10040; h++) drawTape(host, tapeView(20000, h));
  });
  assert.deepEqual(ops, { inserted: 0, removed: 0, created: 0 });
});

test('a band that jumps rewrites the cells it has, in place', () => {
  // At Max a head sweeping a long tape lands the band somewhere new on most
  // frames. The cells are reused in order, so nothing is created or moved.
  const host = context.document.createElement('div');
  const wrap = drawTape(host, tapeView(20000, 10000));
  const count = wrap.children.length;
  const ops = countOps(wrap, () => drawTape(host, tapeView(20000, 2000)));
  assert.deepEqual(ops, { inserted: 0, removed: 0, created: 0 });
  assert.equal(wrap.children.length, count);
  assert.ok(numbers(wrap).includes(2000));
  const head = wrap.children.find(c => String(c.className).includes('is-head'));
  assert.equal(head.children[1].textContent, '2000');
  assert.match(head.getAttribute('data-tip'), /^Cell 2000 /, 'a reused cell describes the cell it now is');
});

test('a band that slides moves only its ends, and creates nothing', () => {
  const host = context.document.createElement('div');
  const wrap = drawTape(host, tapeView(20000, 10000));
  const before = numbers(wrap);
  const ops = countOps(wrap, () => drawTape(host, tapeView(20000, 10150)));
  const after = numbers(wrap);
  const shift = after[0] - before[0];
  assert.ok(shift > 0 && shift < before.length, `slid by ${shift}`);
  assert.equal(ops.created, 0);
  assert.equal(ops.inserted, shift, 'one move per cell that changed ends');
  after.forEach((x, i) => { if (i) assert.equal(x, after[i - 1] + 1); });
});

test('scrolling a long tape brings the band to where the reader is', () => {
  const host = context.document.createElement('div');
  const wrap = drawTape(host, tapeView(20000, 10000));
  const strip = [...host.__tvRows.values()][0].lastChild;
  strip.clientWidth = 400;
  wrap.offsetLeft = 0;
  strip.scrollLeft = 500 * 27;
  strip._listeners.scroll();
  const drawn = numbers(wrap);
  assert.ok(drawn[0] <= 500 && drawn[drawn.length - 1] >= 500 + 400 / 27, `cells ${drawn[0]}..${drawn[drawn.length - 1]} cover the view`);
  assert.equal(wrap.style.paddingLeft, `${drawn[0] * 27}px`);
});

// ── the space-time layout does not read the run ──────────────────────

function busyBeaver(budget) {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.config.twoWayTape = true;
  App.config.maxTmSteps = budget;
  const B = App.config.sym.blank;
  App.sigma = new Set(['1']);
  App.stackAlpha = new Set(['1', B]);
  App.states = ['A', 'B', 'C', 'D', 'E', 'H'].map(id => ({ id, name: id, x: 0, y: 0 }));
  App.startId = 'A';
  App.accepts = new Set(['H']);
  App.transitions = [
    ['A', B, '1', 'R', 'B'], ['A', '1', '1', 'L', 'C'],
    ['B', B, '1', 'R', 'C'], ['B', '1', '1', 'R', 'B'],
    ['C', B, '1', 'R', 'D'], ['C', '1', B, 'L', 'E'],
    ['D', B, '1', 'L', 'A'], ['D', '1', '1', 'L', 'D'],
    ['E', B, '1', 'R', 'H'], ['E', '1', B, 'L', 'A']
  ].map(([from, symbol, write, dir, to], i) => ({ id: 't' + i, from, to, symbol, write, dir }));
  return App;
}

test('laying out a whole diagram costs the states, not the rows', () => {
  busyBeaver(20000);
  const { App, streamMachine, makeSpaceTime, spaceTimeLayout } = context;
  const run = streamMachine('TM', []);
  run.drain();
  const model = makeSpaceTime(run.steps, { alphabet: [...App.sigma, ...App.stackAlpha] });
  model.extend(run.steps.length);
  const name = id => (id === 'D' ? 'a rather long name' : App.states.find(s => s.id === id)?.name ?? '');

  const reads = { n: 0 };
  const stateAt = model.stateAt;
  model.stateAt = i => { reads.n++; return stateAt(i); };
  const L = spaceTimeLayout(model, { cell: 16, stateName: name });
  assert.equal(reads.n, 0, 'no row was read');
  assert.equal(L.stateChars, 14, 'and the gutter still fits the longest name the run was in, capped');

  // A range — an export of some of the steps — measures the rows it draws.
  const R = spaceTimeLayout(model, { cell: 16, stateName: name, rowFrom: 0, rowTo: 2 });
  assert.equal(R.stateChars, 5, 'A, B and C: the gutter\'s floor');
  assert.ok(reads.n > 0);
});

// ── the trail is found per transition, and is the same trail ─────────

test('the trail of a columnar run is the trail a step-by-step walk finds', () => {
  busyBeaver(5000);
  const { App, runSim, stepToEnd, getSimStepEdgeKeys } = context;
  context.$('sim-in').value = '';
  runSim();
  context.stopAutoPlay();
  stepToEnd();
  assert.equal(App.simDrainTimer, null, 'a 5,000-step run finishes in the first slice');
  const want = { visited: new Set(), keys: new Set() };
  for (let i = 0; i < App.simIdx; i++) {
    want.visited.add(App.simSteps[i].state);
    getSimStepEdgeKeys(i).forEach(k => want.keys.add(k));
  }
  assert.deepEqual([...App._simTrail.visited].sort(), [...want.visited].sort());
  assert.deepEqual([...App._simTrail.keys].sort(), [...want.keys].sort());
});

// ── the trace log while the run is moving too fast to read ───────────

const traceRows = () => context.$('trace-log').children.filter(c => String(c.className).includes('tr-row')).length;

test('fast playback draws a short tail, and pausing brings the whole one back', () => {
  busyBeaver(5000);
  const { App, runSim, stepToEnd, renderTraceLog, toggleAuto, SIM_LOG_TAIL, SIM_LOG_FAST_TAIL } = context;
  context.$('sim-in').value = '';
  runSim();
  context.stopAutoPlay();
  stepToEnd();
  App.simIdx = 3000;
  App.config.autoSpeed = 0;
  App.autoTimer = { cancel() {} };    // playing, at Max
  context.resetTraceWindow();
  renderTraceLog();
  assert.equal(traceRows(), SIM_LOG_FAST_TAIL);
  toggleAuto();                        // pause
  assert.equal(App.autoTimer, null);
  assert.equal(traceRows(), SIM_LOG_TAIL);
});

test('⏭ ends on a painted frame with the whole tail, however many slices it took', async () => {
  busyBeaver(400000);
  const { App, runSim, stepToEnd, SIM_LOG_TAIL } = context;
  context.$('sim-in').value = '';
  runSim();
  context.stopAutoPlay();
  stepToEnd();
  for (let i = 0; i < 400 && App.simDrainTimer; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(App.simDrainTimer, null, 'the drain finished');
  assert.equal(App.simIdx, App.simSteps.length - 1);
  assert.equal(App.simSteps.length, 400000);
  assert.equal(App.simSteps[App.simIdx].final, 'timeout');
  assert.equal(traceRows(), SIM_LOG_TAIL, 'the last paint is not a drain frame');
  assert.equal(context.$('trace-log').__traceWin.to, App.simIdx, 'and it is of the last step');
});
