import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { Tape, makeTapes, tapesKey } from '../js/tape.js';

// The tape, on its own.
//
// Boundedness used to be three copies of `if (head < 0) head = 0` spread
// across the simulators, which is not a tape model at all: a bounded tape
// should refuse to move, and re-reading cell 0 forever instead means the
// loop detector calls a stuck machine a *rejection*. Putting it in one
// object is what let TM, NDTM and MTM become two-way without any of them
// growing a second machine type.
//
// Tape imports nothing and takes `blank` as an argument, so these run
// without a machine, an App, or a DOM around them.

const BLANK = '_';

const harness = createHarness();
const { context } = harness;

test('a bounded tape refuses to move left off cell 0', () => {
  const t = new Tape(['a'], BLANK, false);
  assert.equal(t.move('L'), false, 'the refusal is reported, not swallowed');
  assert.equal(t.head, 0, 'and the head has not moved');
  assert.equal(t.read(), 'a');
});

test('a two-way tape grows leftward and reads blank there', () => {
  const t = new Tape(['a'], BLANK, true);
  assert.equal(t.move('L'), true);
  assert.equal(t.head, -1);
  assert.equal(t.read(), BLANK, 'an unwritten cell is blank, not undefined');
  t.write('z');
  assert.equal(t.read(), 'z');
});

test('writing a blank clears the cell rather than storing one', () => {
  // Otherwise a tape scrubbed back to empty keeps every cell it ever
  // touched, and no two such configurations ever compare equal.
  const t = new Tape(['a', 'b'], BLANK, true);
  t.write(BLANK);
  assert.equal(t.cells.has(0), false);
  assert.equal(t.read(), BLANK);
});

test('the snapshot window starts at cell 0 on a bounded tape', () => {
  const t = new Tape(['a', 'b'], BLANK, false);
  t.move('R');
  const s = t.snapshot();
  assert.deepEqual(s.tape, ['a', 'b']);
  assert.equal(s.head, 1, 'the drawn index is the cell number here');
});

test('the snapshot window follows a two-way tape leftward', () => {
  const t = new Tape(['a'], BLANK, true);
  t.move('L');
  t.write('z');
  const s = t.snapshot();
  assert.deepEqual(s.tape, ['z', 'a']);
  // The head is at cell -1 but is drawn at index 0 — the distinction the
  // step-through UI needs, and why simTM reports the cell in its note.
  assert.equal(s.head, 0);
  assert.equal(t.head, -1);
});

test('the config key is origin-independent', () => {
  // This is the property loop detection rests on. The same configuration
  // reached two ways must produce one key, even though the second tape has
  // grown leftward and renumbered every cell.
  const a = new Tape(['x'], BLANK, true);

  const b = new Tape(['q', 'x'], BLANK, true);
  b.move('R');           // sits on 'x' at cell 1
  b.head = 1;
  b.cells.delete(0);     // ... with nothing to its left, as in `a`

  assert.equal(a.key(), b.key());
});

test('the config key ignores trailing blanks', () => {
  // A head that ran right over blank tape and came back is in the
  // configuration it started from; without the trim it never matches and a
  // looping machine runs to the step budget instead of being caught.
  const a = new Tape(['a'], BLANK, false);
  const b = new Tape(['a'], BLANK, false);
  b.move('R'); b.write(BLANK); b.move('L');
  assert.equal(a.key(), b.key());
});

test('the config key separates the head from the contents', () => {
  const a = new Tape(['a', 'b'], BLANK, false);
  const b = new Tape(['a', 'b'], BLANK, false);
  b.move('R');
  assert.notEqual(a.key(), b.key(), 'same tape, different head, different key');
});

test('clone is deep enough that a branch cannot corrupt its parent', () => {
  // The nondeterministic simulators fan out by cloning; a shared Map would
  // let one branch's write show up in another's.
  const parent = new Tape(['a'], BLANK, true);
  const child = parent.clone();
  child.write('z');
  child.move('L');
  assert.equal(parent.read(), 'a');
  assert.equal(parent.head, 0);
  assert.equal(child.twoWay, true, 'the tape model travels with the clone');
});

test('makeTapes puts the input on the first tape only', () => {
  const tapes = makeTapes(3, ['a', 'b'], BLANK, false);
  assert.equal(tapes.length, 3);
  assert.deepEqual(tapes[0].snapshot().tape, ['a', 'b']);
  assert.deepEqual(tapes[1].snapshot().tape, [BLANK]);
  assert.equal(tapesKey('q0', tapes) === tapesKey('q1', tapes), false,
    'the state is part of the multi-tape key');
});

// ── the axis, through the app ─────────────────────────────────────

test('usesTwoWayTape reads the type first and the setting second', () => {
  harness.resetApp();
  const { App, usesTwoWayTape } = context;

  App.config.twoWayTape = false;
  assert.equal(usesTwoWayTape('TM'), false);
  // ITM *is* the claim — no setting should be able to make a machine
  // called "Two-Way Infinite TM" bounded.
  assert.equal(usesTwoWayTape('ITM'), true);

  App.config.twoWayTape = true;
  assert.equal(usesTwoWayTape('TM'), true, 'the setting is the whole point');
  assert.equal(usesTwoWayTape('NDTM'), true);
  assert.equal(usesTwoWayTape('MTM'), true);
  // The LBA is bounded at both ends by its end markers, which is the
  // machine's definition rather than its tape's.
  assert.equal(usesTwoWayTape('LBA'), false);

  App.config.twoWayTape = false;
});

test('the same TM decides differently under the two tape models', () => {
  harness.resetApp();
  const { App, loadData, testTMVerdict, tokenize } = context;
  // q1 walks left over the x it wrote, looking for the blank in front of
  // the input. Bounded, the head sticks at cell 0 and re-reads 'x'.
  const machine = {
    machine: 'TM', sigma: ['a'], stackAlpha: ['_', 'a', 'x'], outputAlpha: [],
    states: [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 1, y: 0 }, { id: 's2', name: 'q2', x: 2, y: 0 }],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', write: 'x', dir: 'L' },
      { id: 't1', from: 's1', to: 's1', symbol: 'x', write: 'x', dir: 'L' },
      { id: 't2', from: 's1', to: 's2', symbol: App.config.sym.blank, write: App.config.sym.blank, dir: 'R' }
    ],
    startId: 's0', accepts: ['s2'], notes: [], dividers: []
  };

  loadData(machine);
  App.config.twoWayTape = false;
  assert.equal(testTMVerdict(tokenize('a')), 'rej', 'bounded: stuck, reported as a reject');

  App.config.twoWayTape = true;
  assert.equal(testTMVerdict(tokenize('a')), 'acc', 'two-way: finds the blank');

  App.config.twoWayTape = false;
});

// ── the bounded-both-ends tape ────────────────────────────────────
// An LBA's tape is its input between two end markers and nothing more.
// That is a third boundedness rule, and the point of putting it here is
// that it is the same object — a ceiling as well as a floor, plus two
// cells that refuse to be written.

test('a right bound refuses the move that would pass it', () => {
  const t = new Tape(['a', 'b'], BLANK, false, { rightBound: 1 });
  assert.equal(t.move('R'), true);
  assert.equal(t.head, 1);
  assert.equal(t.move('R'), false, 'the bound is reported, not silently clamped');
  assert.equal(t.head, 1, 'and the head stayed');
});

test('immutable symbols refuse writes, which is what makes a marker', () => {
  const t = new Tape(['<', 'a', '>'], BLANK, false, {
    rightBound: 2, immutable: new Set(['<', '>'])
  });
  assert.equal(t.write('x'), false, 'the left marker refuses');
  assert.equal(t.read(), '<');
  t.move('R');
  assert.equal(t.write('x'), true, 'an ordinary cell accepts');
  assert.equal(t.read(), 'x');
});

test('a right-bounded tape keeps its length when a blank is written', () => {
  // The blank is a cell the machine wrote, not tape it has not reached —
  // so neither the window nor the key may shrink past it.
  const t = new Tape(['a', 'b'], BLANK, false, { rightBound: 1 });
  t.move('R');
  t.write(BLANK);
  assert.deepEqual(t.snapshot().tape, ['a', BLANK]);
  const other = new Tape(['a'], BLANK, false, { rightBound: 1 });
  other.move('R');
  assert.equal(t.key(), other.key(), 'both are "a" then a blank, head at 1');
});

test('an unbounded tape still trims trailing blanks', () => {
  // The other half of the same rule: here a trailing blank *is* unvisited
  // tape, and not trimming would leave a looping machine undetected.
  const t = new Tape(['a'], BLANK, false);
  t.move('R'); t.write(BLANK); t.move('L');
  assert.equal(t.key(), new Tape(['a'], BLANK, false).key());
});

test('clone carries the bound and the markers', () => {
  const t = new Tape(['<', 'a'], BLANK, false, {
    rightBound: 1, immutable: new Set(['<'])
  });
  const c = t.clone();
  assert.equal(c.rightBound, 1);
  assert.equal(c.write('x'), false, 'the clone still refuses the marker');
});

test('makeLbaTape bounds the tape to the input plus its markers', () => {
  harness.resetApp();
  const { App, makeLbaTape } = context;
  const tape = makeLbaTape(['a', 'b']);
  assert.deepEqual(tape.snapshot().tape,
    [App.config.sym.leftMarker, 'a', 'b', App.config.sym.rightMarker]);
  assert.equal(tape.move('L'), false, 'cannot leave on the left');
  tape.head = 3;
  assert.equal(tape.move('R'), false, 'nor on the right');
});

// ── what the tape says about its own shape ────────────────────────
//
// snapshot() says what the cells hold; view() says whether the head could
// keep going, which is the one fact the tracker could not draw before it
// existed — a wall and blank tape running on forever look identical cell
// for cell. It comes from here rather than from a machine-name branch in
// the renderer for the same reason the clamp does.

test('view() reports a bounded tape as walled at cell 0 and open on the right', () => {
  const t = new Tape(['a', 'b'], BLANK, false);
  const v = t.view();
  assert.equal(v.leftBound, 0);
  assert.equal(v.rightBound, null, 'null is "no wall", not "wall at zero"');
  assert.deepEqual(v.cells, ['a', 'b']);
  assert.equal(v.origin, 0);
});

test('view() reports a two-way tape as walled on neither side', () => {
  const t = new Tape(['a'], BLANK, true);
  t.move('L');
  const v = t.view();
  assert.equal(v.leftBound, null);
  assert.equal(v.rightBound, null);
  // The window has grown leftward, so the drawn head is 0 and the *cell*
  // is −1 — which is exactly why the view carries the origin.
  assert.equal(v.head, 0);
  assert.equal(v.origin, -1);
  assert.equal(v.origin + v.head, -1, 'the cell the machine is actually on');
});

test('view() reports an LBA tape as walled at both ends, with its markers', () => {
  harness.resetApp();
  const { App, makeLbaTape } = context;
  const v = makeLbaTape(['a', 'b']).view();
  assert.equal(v.leftBound, 0);
  assert.equal(v.rightBound, 3, 'the input plus its two markers');
  assert.deepEqual(v.markers.sort(),
    [App.config.sym.leftMarker, App.config.sym.rightMarker].sort());
});

test('the bounds view() reports are the ones the tape enforces', () => {
  // The point of asking the tape rather than the machine: a drawn wall the
  // head can walk through would be worse than no wall at all.
  for (const t of [
    new Tape(['a'], BLANK, false),
    new Tape(['a'], BLANK, true),
    new Tape(['a', 'b'], BLANK, false, { rightBound: 1 })
  ]) {
    const v = t.view();
    t.head = v.leftBound === null ? -50 : v.leftBound;
    assert.equal(t.move('L'), v.leftBound === null,
      'a left wall is drawn exactly when the tape refuses to pass it');
    t.head = v.rightBound === null ? 50 : v.rightBound;
    assert.equal(t.move('R'), v.rightBound === null,
      'and likewise on the right');
  }
});
