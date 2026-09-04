import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// Which level a note lives on.
//
// A note is written *somewhere* — at the top level, or inside a block someone
// had drilled into — and until it said so it was drawn at every level at once,
// positioned against a state the level it was showing on does not draw. Dragging
// the box then left it behind entirely, because a box moves without its members
// moving: the preview is a *fit* of their coordinates, so where they actually
// sit is irrelevant to the drawing and nothing pulled the note along.
//
// That is not a lookup bug like the highlights around it. It is a note being in
// the wrong place, and the fix is a property of the note rather than of the
// thing that draws it.

const harness = createHarness();
const { App } = context;

function def(name) {
  return {
    name, machine: 'DFA', sigma: ['a'],
    states: [{ id: 'd0', x: 0, y: 0, name: 'i' }, { id: 'd1', x: 90, y: 0, name: 'j' }],
    transitions: [{ id: 'e0', from: 'd0', to: 'd1', symbol: 'a' }],
    startId: 'd0', entry: 'd0', accepts: ['d1'], version: 1
  };
}

function fixture() {
  harness.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.config.render.animateLayout = false;
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'A' });
  App.states.push({ id: 'x2', x: 200, y: 0, name: 'B' });
  App.transitions.push({ id: 'u1', from: 'x1', to: 'x2', symbol: 'a' });
  App.startId = 'x1';
  const { block } = context.inlineBlock(def('sub'), { x: 600, y: 400 });
  App.transitions.push({ id: 'u2', from: 'x2', to: block.entry, symbol: 'a' });
  context.invalidateViewGraph();
  return { block, inside: context.blockMembers(block.id) };
}

const top = () => context.enterBlockScope(null, { to: [] });
const drawnIds = () => context.visibleNotes().map(n => n.id);

// ── the field ─────────────────────────────────────────────────────

test('a note written at the top level carries no scope at all', () => {
  fixture();
  const note = context.createNote(10, 10);
  // Absent means the top level, which is what every note written before this
  // existed already was — so a machine with no blocks in it saves exactly the
  // bytes it saved before and needs no migration.
  assert.equal('scope' in note, false);
  assert.equal(context.noteScopeOf(note), null);
});

test('a note written inside a block says so', () => {
  const { block } = fixture();
  context.enterBlockScope(block.id);
  const note = context.createNote(10, 10);
  assert.equal(note.scope, block.id);
});

// ── what each level draws ─────────────────────────────────────────

test('a level draws its own notes and nobody else’s', () => {
  const { block } = fixture();
  const outer = context.createNote(10, 10);
  context.enterBlockScope(block.id);
  const inner = context.createNote(10, 10);

  assert.deepEqual(drawnIds(), [inner.id], 'inside the block, only the note written there');
  top();
  assert.deepEqual(drawnIds(), [outer.id], 'and back out, only the one written out here');
});

test('only the drawn notes are rendered', () => {
  const { block } = fixture();
  context.createNote(10, 10);
  context.enterBlockScope(block.id);
  const inner = context.createNote(10, 10);
  context.renderAll();

  const layer = context.$('notes-g');
  assert.equal(layer.children.length, 1, 'one note element on the level, not two');
  assert.equal(layer.children[0].getAttribute('data-note-id'), inner.id);
});

test('fit-to-screen frames the notes on screen, not the ones below', () => {
  const { block } = fixture();
  context.enterBlockScope(block.id);
  context.createNote(9000, 9000);
  top();

  let far = false;
  context.includeNoteBounds((x0, y0, x1, y1) => { if (x1 > 5000) far = true; });
  assert.equal(far, false, 'a note two levels down does not pull the frame out to it');
});

// ── one level down ────────────────────────────────────────────────

test('a note anchored to a state since grouped away points at the box', () => {
  const { block, inside } = fixture();
  // The case the whole thing exists for: the note was written out here about a
  // state that is now inside a block. `nodeIdAtScope` already answers which node
  // this level draws for it, so there is no second rule — the note follows the
  // box, and the box is what the reader can see.
  const note = { id: 'n9', x: 0, y: 0, text: '', anchorStates: [inside[1].id], anchorTransitions: [] };
  App.notes.push(note);
  assert.deepEqual(context.resolveNotePos(note), { x: block.x, y: block.y });

  block.x = 2400; block.y = 1600;
  context.invalidateViewGraph();
  assert.deepEqual(context.resolveNotePos(note), { x: 2400, y: 1600 },
    'and it rides along, which it could not do while it was pinned to a hidden state');
});

test('an anchored edge that crosses a boundary takes the box as one end', () => {
  const { block } = fixture();
  const note = { id: 'n9', x: 0, y: 0, text: '', anchorStates: [], anchorTransitions: ['u2'] };
  App.notes.push(note);
  const pos = context.resolveNotePos(note);
  // The midpoint of the line the reader can see — x2 to the box — rather than
  // of one drawn node and one that is not.
  assert.deepEqual(pos, { x: (200 + block.x) / 2, y: (0 + block.y) / 2 });
});

// ── blocks coming apart ───────────────────────────────────────────

test('ungrouping carries a note up to the level its states landed on', () => {
  const { block } = fixture();
  const outer = context.inlineBlock(def('deep'), { x: 0, y: 0, parent: block.id }).block;
  context.enterBlockScope(outer.id);
  const note = context.createNote(10, 10);
  top();

  context.ungroupBlock(outer.id);
  // The parent, not the top: a dissolved block knows where its contents went,
  // and the read-validation below cannot, because the record is gone by then.
  assert.equal(note.scope, block.id);
});

test('deleting a block deletes the notes written inside it', () => {
  const { block } = fixture();
  context.enterBlockScope(block.id);
  const inside = [context.createNote(10, 10), context.createNote(20, 20), context.createNote(30, 30)];
  top();
  const outside = context.createNote(0, 0);
  App.selectedNotes = new Set(inside.map(n => n.id));

  context.removeBlock(block.id);
  context.invalidateViewGraph();

  // Surfacing them instead would empty every note in the block onto the machine
  // above — at coordinates from another level, each one pointing at states this
  // call has just removed. On a block with thirty notes in it that is the
  // workspace buried. Deleting a block means deleting what was in it.
  assert.deepEqual(App.notes.map(n => n.id), [outside.id]);
  assert.equal(App.selectedNotes.size, 0, 'and nothing is left selected that is gone');
});

test('the whole subtree goes, not just the level named', () => {
  const { block } = fixture();
  const deep = context.inlineBlock(def('deep'), { x: 0, y: 0, parent: block.id }).block;
  context.enterBlockScope(deep.id);
  context.createNote(10, 10);
  top();

  context.removeBlock(block.id);
  assert.deepEqual(App.notes, [], 'a note two levels down is inside the block too');
});

test('a note that only anchors into a deleted block is kept, where it was', () => {
  const { block, inside } = fixture();
  const note = context.createNote(0, 0, [inside[1].id], []);
  const was = context.resolveNotePos(note);

  // What both delete paths do, and the reason blockRemovalIds is exported: the
  // prune has to run while the ids are still resolvable. `App.selectedStates`
  // holds the *box's* id for a selected block and no state inside it, so naming
  // the selection alone named nothing and the note jumped to its stored offset.
  const gone = context.blockRemovalIds(block.id);
  context.pruneNoteAnchorsExcluding([...gone.states], gone.transitions);
  context.removeBlock(block.id);
  context.invalidateViewGraph();

  // The note lives out here, so it is not part of what was deleted — only its
  // anchor was. It stays, loses the dangling anchor, and holds its position.
  assert.deepEqual(App.notes.map(n => n.id), [note.id]);
  assert.deepEqual(note.anchorStates, []);
  assert.deepEqual(context.resolveNotePos(note), was);
});

test('a scope that vanished some other way still surfaces its notes', () => {
  const { block } = fixture();
  context.enterBlockScope(block.id);
  const note = context.createNote(10, 10);
  top();

  // Not a deletion: an algorithm result, an import or StateMate's apply replaces
  // App.states wholesale and blockIsIntact prunes the record on the next read.
  // Nothing announces that, so noteScopeOf validating on read is what stops the
  // note being invisible at every level — text somebody wrote, silently gone.
  App.blocks = [];
  context.invalidateViewGraph();
  assert.equal(context.noteScopeOf(note), null);
  assert.deepEqual(drawnIds(), [note.id]);
});

// ── the bookkeeping this must not disturb ─────────────────────────

test('pruning an anchor holds a note still, even one on another level', () => {
  const { block, inside } = fixture();
  context.enterBlockScope(block.id);
  const note = context.createNote(400, 300, [inside[1].id], []);
  const was = context.resolveNotePos(note);
  top();

  // pruneNoteAnchorsRemoving runs over every note at every level to preserve
  // each one's position while its anchors go — so it is running from out here
  // on a note that lives in there. Resolved against the *reader's* level this
  // note answers the box's position rather than its own, and the prune freezes
  // it at a place it was never drawn. Against the note's own level there is one
  // answer whoever is asking.
  context.pruneNoteAnchorsRemoving([inside[1].id], []);
  assert.deepEqual(context.resolveNotePos(note), was);
  assert.deepEqual(note.anchorStates, []);
});

// ── selection ─────────────────────────────────────────────────────

test('a selection does not survive going where it cannot be seen', () => {
  const { block } = fixture();
  const note = context.createNote(10, 10);
  App.selectedNotes = new Set([note.id]);

  context.enterBlockScope(block.id);
  // Before a note had a level they were all drawn, so a stale selection was at
  // least a visible one. Now Delete would take something nobody can see.
  assert.equal(App.selectedNotes.size, 0);
});

test('select-all and the marquee take only what is drawn', () => {
  const { block } = fixture();
  context.createNote(10, 10);
  context.enterBlockScope(block.id);
  const inner = context.createNote(10, 10);

  context.selectAllStates();
  assert.deepEqual([...App.selectedNotes], [inner.id]);
});

// ── the file ──────────────────────────────────────────────────────

test('the level a note lives on survives a round trip', () => {
  const { block } = fixture();
  context.enterBlockScope(block.id);
  const note = context.createNote(10, 10);
  top();

  // No serializer was edited for this: roundForSave copies a note whole and
  // rounds only the fields it names, so `scope` rides along exactly as `blockId`
  // does on a state.
  const data = JSON.parse(JSON.stringify(context.getWorkspaceData()));
  const saved = data.notes.find(n => n.id === note.id);
  assert.equal(saved.scope, block.id);

  context.loadData(data);
  assert.equal(context.getNote(note.id).scope, block.id);
});
