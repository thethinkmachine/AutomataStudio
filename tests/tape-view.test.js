import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Drawing a tape, including its ends.
//
// The tracker used to draw a flat row of boxes and nothing else, which made
// the four tapes in the app indistinguishable on screen: TM bounded at cell
// 0, ITM infinite both ways, LBA bounded at both ends, 2DFA read-only
// between two markers. Every one of those differences is a fact about an
// *end*, and an end is precisely what a row of cells cannot show — blank
// tape running on forever and a wall look identical cell for cell.
//
// So these tests are mostly about the caps, and about the two properties
// that keep the cells honest while the caps change: absolute cell numbers,
// and node identity across steps.

const harness = createHarness();
const { context } = harness;

function tracker() {
  return context.$('sim-tracker');
}

function rows() {
  const body = tracker().__tvBody;
  return body ? body.children : [];
}

function partsOf(rowEl) {
  const track = rowEl.children[1].children[0];
  return { capL: track.children[0], cells: track.children[1], capR: track.children[2] };
}

function cellsOf(rowEl) {
  return partsOf(rowEl).cells.children;
}

function classOf(node) {
  return String(node.className || '');
}

function symbols(rowEl) {
  return cellsOf(rowEl).map(c => c.children[0].textContent);
}

function cellNumbers(rowEl) {
  return cellsOf(rowEl).map(c => c.children[1].textContent);
}

function headCell(rowEl) {
  return cellsOf(rowEl).find(c => classOf(c).includes('is-head')) || null;
}

/** Builds a machine straight onto App and runs a word through it. */
function run(machine, states, trans, word, opts = {}) {
  harness.resetApp();
  const { App, setMachine, simulateMachine } = context;
  setMachine(machine);
  const ids = {};
  states.forEach((name, i) => {
    App.states.push({ id: 's' + i, name, x: i * 90, y: 0 });
    ids[name] = 's' + i;
  });
  App.startId = ids[states[0]];
  (opts.accept || []).forEach(n => App.accepts.add(ids[n]));
  trans.forEach((t, i) => App.transitions.push({
    id: 't' + i, from: ids[t.from], to: ids[t.to],
    symbol: t.on, write: t.write, dir: t.dir, pop: t.pop, push: t.push
  }));
  if (opts.alphabet) App.alphabet = new Set(opts.alphabet);
  if (opts.twoWayTape !== undefined) App.config.twoWayTape = opts.twoWayTape;
  simulateMachine(machine, word);
  return ids;
}

/** Draws a particular step, since a run auto-plays past the one we want. */
function at(idx) {
  context.App.simIdx = idx;
  context.renderSimStep();
  return rows();
}

// A machine that walks right over its input, writing x, and halts on blank.
const WALK_RIGHT = [
  { from: 'q0', to: 'q0', on: 'a', write: 'x', dir: 'R' },
  { from: 'q0', to: 'qa', on: '⊔', write: '⊔', dir: 'S' }
];

// ── the caps are the point ────────────────────────────────────────

test('a one-way tape is walled on the left and open on the right', () => {
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a', 'a'], { accept: ['qa'], twoWayTape: false });
  const [tape] = at(1);
  const { capL, capR } = partsOf(tape);
  assert.ok(classOf(capL).includes('is-wall'), 'cell 0 is the leftmost cell');
  assert.ok(classOf(capR).includes('is-open'), 'and the tape runs on to the right');
  assert.ok(capR.children.some(c => classOf(c).includes('tv-inf')),
    'an open end trails off into an ellipsis');
});

test('a two-way tape is open on both sides, and its cells go negative', () => {
  run('ITM', ['q0', 'qa'], [
    { from: 'q0', to: 'q0', on: 'a', write: 'x', dir: 'L' },
    { from: 'q0', to: 'qa', on: '⊔', write: '⊔', dir: 'S' }
  ], ['a'], { accept: ['qa'] });
  const [tape] = at(1);
  const { capL, capR } = partsOf(tape);
  assert.ok(classOf(capL).includes('is-open'), 'there is no leftmost cell');
  assert.ok(classOf(capR).includes('is-open'));
  // The whole reason the view carries an origin: the window renumbered when
  // the tape grew leftward, so the drawn index and the cell diverge.
  assert.deepEqual(cellNumbers(tape), ['-1', '0']);
  assert.equal(headCell(tape).children[1].textContent, '-1',
    'the head is on cell −1, and says so');
});

test('an LBA is walled at both ends and marks the cells that refuse a write', () => {
  const { App } = context;
  run('LBA', ['q0', 'qa'], [
    { from: 'q0', to: 'q0', on: '⊢', write: '⊢', dir: 'R' },
    { from: 'q0', to: 'q0', on: 'a', write: 'x', dir: 'R' },
    { from: 'q0', to: 'qa', on: '⊣', write: '⊣', dir: 'S' }
  ], ['a', 'a'], { accept: ['qa'] });
  const [tape] = at(0);
  const { capL, capR } = partsOf(tape);
  assert.ok(classOf(capL).includes('is-wall'));
  assert.ok(classOf(capR).includes('is-wall'), 'bounded at both ends is its definition');

  const marked = cellsOf(tape).filter(c => classOf(c).includes('is-marker'));
  assert.deepEqual(marked.map(c => c.children[0].textContent),
    [App.config.sym.leftMarker, App.config.sym.rightMarker],
    'an end marker is drawn as one — it is a marker by being unwritable');
});

test('the two tapes bounded at both ends still read differently', () => {
  // 2DFA and LBA draw the same shape — walls, markers, a head between them.
  // What separates them is that one never writes, so the badge says so.
  const { tapeModelSay } = context;
  run('2DFA', ['q0', 'qa'], [
    { from: 'q0', to: 'q0', on: '⊢', dir: 'R' },
    { from: 'q0', to: 'q0', on: 'a', dir: 'R' },
    { from: 'q0', to: 'qa', on: '⊣', dir: 'S' }
  ], ['a'], { accept: ['qa'] });
  const twoWayHead = context.App.simSteps[0].view;
  assert.equal(twoWayHead.readOnly, true);
  assert.match(tapeModelSay(twoWayHead).badge, /read-only/);

  run('LBA', ['q0'], [{ from: 'q0', to: 'q0', on: '⊢', write: '⊢', dir: 'R' }], ['a']);
  const lba = context.App.simSteps[0].view;
  assert.equal(lba.readOnly, false);
  assert.doesNotMatch(tapeModelSay(lba).badge, /read-only/);
});

test('every phrase tapeModelSay produces names the ends it was given', () => {
  const { tapeModelSay } = context;
  const base = { cells: ['a'], head: 0, origin: 0, markers: [], blank: '⊔' };
  const say = (l, r, extra = {}) =>
    tapeModelSay({ ...base, leftBound: l, rightBound: r, ...extra });

  assert.match(say(null, null).badge, /infinite both ways/);
  assert.match(say(0, null).badge, /bounded left/);
  assert.match(say(null, 4).badge, /bounded right/);
  assert.match(say(0, 3).badge, /4 cells/, 'inclusive of both ends');
  assert.match(say(0, null, { periodLen: 2 }).badge, /ω/,
    'an ω-word runs on forever into its repeating block, not into blanks');

  // Every one is a distinct sentence — a tooltip that said the same thing
  // for two different tapes would be the bug this whole module exists for.
  const tips = [say(null, null), say(0, null), say(null, 4), say(0, 3)].map(s => s.tip);
  assert.equal(new Set(tips).size, 4);
});

// ── what is not a tape is not drawn as one ────────────────────────

test('a stack gets no walls and no infinities', () => {
  run('DPDA', ['q0'], [
    { from: 'q0', to: 'q0', on: 'a', pop: 'ε', push: 'A' }
  ], ['a', 'a'], { alphabet: ['a'] });
  const drawn = at(2);
  const stack = drawn.find(r => r.children[0].children[0].textContent === 'Stk');
  assert.ok(stack, 'the stack has a row');
  const { capL, capR } = partsOf(stack);
  // A stack's ends are a top and a bottom. Drawing a wall at the bottom
  // would be claiming something about it that is not true.
  assert.ok(!classOf(capL).includes('is-wall') && !classOf(capL).includes('is-open'));
  assert.equal(capL.textContent, 'top');
  assert.equal(capR.textContent, 'bottom');
  assert.equal(stack.getAttribute('data-kind'), 'track');
});

test('a queue names its own ends, which are not a stack\'s', () => {
  run('QA', ['q0'], [
    { from: 'q0', to: 'q0', on: 'a', pop: 'ε', push: 'A' }
  ], ['a'], { alphabet: ['a'] });
  const queue = at(1).find(r => r.children[0].children[0].textContent === 'Que');
  const { capL, capR } = partsOf(queue);
  assert.equal(capL.textContent, 'front');
  assert.equal(capR.textContent, 'back');
});

test('the input row says how long the word is, not how many cells it has', () => {
  run('DFA', ['q0', 'q1'], [
    { from: 'q0', to: 'q1', on: 'a' }, { from: 'q1', to: 'q0', on: 'b' }
  ], ['a', 'b'], { accept: ['q1'], alphabet: ['a', 'b'] });
  const [input] = at(1);
  assert.equal(input.children[0].children[1].textContent, '|w| = 2');
  assert.equal(input.getAttribute('data-kind'), 'tape',
    'it is still drawn as a bounded strip — one idiom, not two');
});

// ── the cells stay honest while the caps change ───────────────────

test('a cell keeps its node across steps, so its highlight can animate', () => {
  // The old tracker rebuilt its innerHTML every step, which meant the CSS
  // transition on a cell never once fired: the highlighted node was always
  // a brand new element with no previous state to animate from.
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a', 'a', 'a'], { accept: ['qa'], twoWayTape: false });
  const before = cellsOf(at(0)[0]).slice(0, 2);
  const after = cellsOf(at(1)[0]).slice(0, 2);
  assert.equal(after[0], before[0], 'cell 0 is the same element');
  assert.equal(after[1], before[1], 'and so is cell 1');
  assert.equal(headCell(at(0)[0]).children[1].textContent, '0');
  assert.equal(headCell(at(1)[0]).children[1].textContent, '1',
    'the head moved without the cells being rebuilt under it');
});

test('a cell is keyed by its cell number, not by its position in the window', () => {
  // A two-way tape renumbers its window the moment it grows leftward. Keyed
  // by position, every cell would be reused as its own neighbour and the
  // whole row would appear to shift by one.
  run('ITM', ['q0', 'qa'], [
    { from: 'q0', to: 'q0', on: 'a', write: 'a', dir: 'L' },
    { from: 'q0', to: 'q0', on: '⊔', write: 'z', dir: 'L' }
  ], ['a'], { accept: ['qa'] });
  const cellZero = cellsOf(at(0)[0])[0];
  assert.equal(cellZero.children[1].textContent, '0');

  const grown = cellsOf(at(2)[0]);
  assert.equal(grown.length, 3, 'the tape has grown two cells leftward');
  assert.deepEqual(grown.map(c => c.children[1].textContent), ['-2', '-1', '0']);
  assert.equal(grown[2], cellZero, 'cell 0 is still cell 0, and still its node');
});

test('the verdict lands on the head cell, and only on the last step', () => {
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a'], { accept: ['qa'], twoWayTape: false });
  const last = context.App.simSteps.length - 1;
  assert.equal(context.App.simSteps[last].final, 'accept');
  assert.ok(classOf(headCell(at(last)[0])).includes('accept'));
  assert.ok(!classOf(headCell(at(0)[0])).includes('accept'),
    'a step in the middle of a run has not decided anything');
});

test('every cell carries its number and a sentence about itself', () => {
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a', 'a'], { accept: ['qa'], twoWayTape: false });
  const [tape] = at(1);
  assert.deepEqual(symbols(tape), ['x', 'a']);
  assert.deepEqual(cellNumbers(tape), ['0', '1']);
  assert.match(headCell(tape).getAttribute('data-tip'), /Cell 1/);
  assert.match(headCell(tape).getAttribute('data-tip'), /head is here/);
});

// ── the rows follow the machine ───────────────────────────────────

test('a multi-tape machine gets one row per tape, each with its own ends', () => {
  harness.resetApp();
  const { App, setMachine, simMTM } = context;
  setMachine('MTM');
  App.tapeCount = 2;
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  simMTM(['a']);
  const drawn = at(0);
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn.map(r => r.children[0].children[0].textContent), ['T1', 'T2']);
  drawn.forEach(r => {
    assert.ok(classOf(partsOf(r).capL).includes('is-wall'));
    assert.ok(classOf(partsOf(r).capR).includes('is-open'));
  });
});

test('switching machine rebuilds the rows rather than leaving the old ones', () => {
  run('DPDA', ['q0'], [
    { from: 'q0', to: 'q0', on: 'a', pop: 'ε', push: 'A' }
  ], ['a'], { alphabet: ['a'] });
  assert.deepEqual(at(1).map(r => r.children[0].children[0].textContent), ['In', 'Stk']);

  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a'], { accept: ['qa'], twoWayTape: false });
  assert.deepEqual(at(0).map(r => r.children[0].children[0].textContent), ['Tape'],
    'no stack left over from the machine before');
});

test('resetSim drops the cached nodes with the ones it removed', () => {
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a'], { accept: ['qa'], twoWayTape: false });
  at(0);
  context.resetSim();
  assert.equal(tracker().children.length, 0);
  assert.equal(tracker().__tvBody, null, 'the handle goes with the node');

  // And drawing again after a reset works rather than writing into a
  // detached element.
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a', 'a'], { accept: ['qa'], twoWayTape: false });
  assert.deepEqual(symbols(at(1)[0]), ['x', 'a']);
});

// ── a step with no view still draws ───────────────────────────────

test('a step that predates the view still draws its cells', () => {
  // `view` is new: a machine module that has not been taught to send one,
  // or a run restored from somewhere older, must still render. It falls
  // back to a bounded strip and declines to claim anything about the ends
  // rather than guessing at them from the machine's name.
  run('TM', ['q0', 'qa'], WALK_RIGHT, ['a', 'a'], { accept: ['qa'], twoWayTape: false });
  context.App.simSteps.forEach(s => { delete s.view; });
  const [tape] = at(1);
  assert.deepEqual(symbols(tape), ['x', 'a']);
  assert.ok(headCell(tape), 'the head is still marked');
});
