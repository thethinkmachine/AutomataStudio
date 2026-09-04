import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

// Notes, dividers and regions are selectable objects like states and
// transitions: one set each, one clear, one Delete, one drag.
const harness = createHarness();
const { context } = harness;

function reset() {
  harness.resetApp();
}

function scene() {
  const { createState, createNote, createDivider } = context;
  const s = createState(0, 0);
  const note = createNote(200, 40);
  const line = createDivider('line', -50, -50, 50, -50);
  const region = createDivider('rect', 100, 100, 300, 300);
  return { s, note, line, region };
}

test('select-all takes notes and dividers along with the machine', () => {
  reset();
  const { App, selectAllStates } = context;
  const { s, note, line, region } = scene();
  selectAllStates();
  assert.ok(App.selectedStates.has(s.id));
  assert.deepStrictEqual([...App.selectedNotes], [note.id]);
  assert.deepStrictEqual([...App.selectedDividers].sort(), [line.id, region.id].sort());
});

test('select-all still does nothing on a canvas with nothing on it', () => {
  reset();
  const { App, selectAllStates } = context;
  selectAllStates();
  assert.strictEqual(App.selectedNotes.size, 0);
  assert.strictEqual(App.selectedDividers.size, 0);
});

test('clearing the selection empties every kind at once', () => {
  reset();
  const { App, selectAllStates, clearSelection, selectionCount } = context;
  scene();
  selectAllStates();
  assert.ok(selectionCount() > 0);
  clearSelection();
  assert.strictEqual(selectionCount(), 0);
  assert.strictEqual(App.selectedNotes.size, 0);
  assert.strictEqual(App.selectedDividers.size, 0);
});

test('a plain pick replaces the selection, a modified pick toggles it', () => {
  reset();
  const { App, pickObject } = context;
  const { note, line, region } = scene();

  // Plain click on something unselected: it becomes the whole selection.
  assert.strictEqual(pickObject(App.selectedNotes, note.id, false), true);
  App.selectedDividers.clear();
  assert.strictEqual(pickObject(App.selectedDividers, line.id, false), true);
  assert.strictEqual(App.selectedNotes.size, 0, 'the note was dropped by the plain pick');

  // Shift/ctrl adds, then removes.
  assert.strictEqual(pickObject(App.selectedDividers, region.id, true), true);
  assert.strictEqual(App.selectedDividers.size, 2);
  assert.strictEqual(pickObject(App.selectedDividers, region.id, true), false);
  assert.strictEqual(App.selectedDividers.size, 1);

  // A plain click on something already selected keeps the selection, so a
  // multi-object drag can start from any member of it.
  App.selectedNotes.add(note.id);
  assert.strictEqual(pickObject(App.selectedDividers, line.id, false), true);
  assert.ok(App.selectedNotes.has(note.id));
});

test('Delete removes a mixed selection in a single undo step', () => {
  reset();
  const { App, selectAllStates, snapshot, removeNotes, removeDividers } = context;
  const { note, line, region } = scene();
  selectAllStates();

  const before = App.history.length;
  snapshot();
  removeNotes([...App.selectedNotes]);
  removeDividers([...App.selectedDividers]);
  assert.strictEqual(App.history.length, before + 1, 'one history step for the whole selection');
  assert.strictEqual(App.notes.length, 0);
  assert.strictEqual(App.dividers.length, 0);
  assert.strictEqual(App.selectedNotes.size, 0);
  assert.strictEqual(App.selectedDividers.size, 0);

  context.undo();
  assert.deepStrictEqual(App.notes.map(n => n.id), [note.id]);
  assert.deepStrictEqual(App.dividers.map(d => d.id), [line.id, region.id]);
});

test('the arrow keys nudge a selected note and region, not just states', () => {
  reset();
  const { App, nudgeSelected } = context;
  const { s, note, region } = scene();
  App.selectedStates.add(s.id);
  App.selectedNotes.add(note.id);
  App.selectedDividers.add(region.id);
  const noteAt = { x: note.x, y: note.y };
  const regionAt = { x1: region.x1, y1: region.y1, x2: region.x2, y2: region.y2 };

  nudgeSelected(5, -3);
  assert.deepStrictEqual({ x: note.x, y: note.y }, { x: noteAt.x + 5, y: noteAt.y - 3 });
  assert.deepStrictEqual(
    { x1: region.x1, y1: region.y1, x2: region.x2, y2: region.y2 },
    { x1: regionAt.x1 + 5, y1: regionAt.y1 - 3, x2: regionAt.x2 + 5, y2: regionAt.y2 - 3 }
  );
});

test('one drag moves every selected object together', () => {
  reset();
  const { App, beginSelectionDrag, dragSelectedNotesTo, dragSelectedDividersTo } = context;
  const { note, line } = scene();
  App.selectedNotes.add(note.id);
  App.selectedDividers.add(line.id);

  const grab = { x: 0, y: 0 };
  beginSelectionDrag(grab);
  dragSelectedNotesTo({ x: 40, y: 25 });
  dragSelectedDividersTo({ x: 40, y: 25 });

  assert.deepStrictEqual({ x: note.x, y: note.y }, { x: 240, y: 65 });
  assert.deepStrictEqual(
    { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 },
    { x1: -10, y1: -25, x2: 90, y2: -25 }
  );
});

test('a restored snapshot drops selected objects it no longer holds', () => {
  reset();
  const { App, selectAllStates, deleteNote, deleteDivider } = context;
  const { note, line } = scene();
  selectAllStates();
  deleteNote(note.id);
  deleteDivider(line.id);
  context.undo();
  App.selectedNotes.add('n99');
  App.selectedDividers.add('d99');
  context.undo();
  assert.ok(!App.selectedNotes.has('n99'));
  assert.ok(!App.selectedDividers.has('d99'));
});

// ── the marquee ───────────────────────────────────────────────────
// The sweep rebuilds the selection from the baseline captured at the press on
// every move. Written as an add-only sweep it could take an object in and
// never give it back: dragging past a state and back, or shrinking the box off
// one, left it selected with nothing on screen still covering it — and the
// next Delete took it.

/** Drives the real pointerdown/move listeners over the canvas background. */
function marquee(from, to) {
  const wrap = context.wrap;
  wrap.setPointerCapture = () => { };
  const at = (x, y) => ({
    target: wrap, button: 0, pointerId: 1, pointerType: 'mouse',
    clientX: x, clientY: y, preventDefault() { }
  });
  wrap._listeners.pointerdown(at(from.x, from.y));
  const drag = { to(x, y) { context.handlePointerMove(at(x, y)); return drag; } };
  return drag.to(to.x, to.y);
}

test('a marquee releases what it is dragged back off', () => {
  reset();
  const { App, createState } = context;
  App.tool = 'pointer';
  const near = createState(0, 0);
  const far = createState(300, 0);

  const drag = marquee({ x: -50, y: -50 }, { x: 400, y: 50 });
  assert.deepStrictEqual([...App.selectedStates].sort(), [near.id, far.id].sort());

  // Back over the near state only: the far one is no longer in the box, so it
  // is no longer selected.
  drag.to(50, 50);
  assert.deepStrictEqual([...App.selectedStates], [near.id]);
  assert.strictEqual(
    App.domCache.states.get(far.id).classList.contains('sel-st'), false,
    'and the node it had highlighted is repainted'
  );
});

test('a marquee that covers nothing ends with nothing selected', () => {
  reset();
  const { App, createState } = context;
  App.tool = 'pointer';
  createState(0, 0);

  marquee({ x: -50, y: -50 }, { x: 50, y: 50 }).to(-40, -40);
  assert.strictEqual(App.selectedStates.size, 0);
});

test('a modified marquee keeps what was selected before it started', () => {
  reset();
  const { App, createState } = context;
  App.tool = 'pointer';
  const kept = createState(0, 0);
  const swept = createState(300, 0);
  App.selectedStates.add(kept.id);

  const wrap = context.wrap;
  wrap.setPointerCapture = () => { };
  const at = (x, y) => ({
    target: wrap, button: 0, pointerId: 1, pointerType: 'mouse', shiftKey: true,
    clientX: x, clientY: y, preventDefault() { }
  });
  wrap._listeners.pointerdown(at(200, -50));
  context.handlePointerMove(at(400, 50));
  assert.deepStrictEqual([...App.selectedStates].sort(), [kept.id, swept.id].sort());

  // Shrunk back off the swept state — the baseline it was added to survives.
  context.handlePointerMove(at(210, -40));
  assert.deepStrictEqual([...App.selectedStates], [kept.id]);
});

test('a marquee releases notes and dividers too', () => {
  reset();
  const { App, createNote, createDivider } = context;
  App.tool = 'pointer';
  const note = createNote(100, 100);
  const region = createDivider('rect', 100, 100, 300, 300);

  const drag = marquee({ x: -50, y: -50 }, { x: 500, y: 500 });
  assert.ok(App.selectedNotes.has(note.id));
  assert.ok(App.selectedDividers.has(region.id));

  drag.to(-40, -40);
  assert.strictEqual(App.selectedNotes.size, 0);
  assert.strictEqual(App.selectedDividers.size, 0);
});
