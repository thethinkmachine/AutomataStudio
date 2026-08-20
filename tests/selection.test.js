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
