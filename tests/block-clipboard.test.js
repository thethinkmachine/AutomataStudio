import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// Taking a piece of a machine somewhere else.
//
// Copying a block was already a definition on the clipboard and a place through
// inlineBlock — the same path the library uses — so a copy is a real
// independent second copy rather than a record pointing at the original's
// states. What these pin is the half that only shows up once a block is
// *nested*: the name a definition comes out carrying, and that a cut is one
// edit rather than a copy and a delete the reader has to undo twice.
//
// And then the machine it all lands on. A clipboard outlives the machine it was
// filled from, which makes copy the one gesture in the app that crosses
// machines — so these also pin what a paste is allowed to do with a fragment
// written for a different one, for a block and for a loose state alike.

const harness = createHarness();
const { App } = context;
const ANY = 'Σ';
const BLANK = '⊔';

function tmCanvas() {
  harness.resetApp();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.config.render.animateLayout = false;
}

/** An ALU with one plain state and a nested "add" block of two. */
function aluDef(name = 'ALU') {
  return {
    name, machine: 'TM', sigma: ['a', 'b'], stackAlpha: ['a', 'b', BLANK],
    states: [
      { id: 'd0', x: 0, y: 0, name: 'in' },
      { id: 'd1', x: 120, y: 0, name: 'add/scan', blockId: 'k1' },
      { id: 'd2', x: 240, y: 0, name: 'add/done', blockId: 'k1' }
    ],
    transitions: [
      { id: 'e0', from: 'd0', to: 'd1', symbol: ANY, write: ANY, dir: 'S' },
      { id: 'e1', from: 'd1', to: 'd2', symbol: 'a', write: 'a', dir: 'R' }
    ],
    blocks: [{ id: 'k1', name: 'add', parent: null, entry: 'd1', exits: [{ id: 'd2', label: 'done' }], x: 120, y: 0 }],
    startId: 'd0', entry: 'd0', accepts: ['d2'], version: 1
  };
}

function placeALU(name = 'ALU', at = { x: 0, y: 0 }) {
  const outer = context.inlineBlock(aluDef(name), at).block;
  context.invalidateViewGraph();
  return { outer, inner: App.blocks.find(b => b.parent === outer.id) };
}

const nameOf = id => App.states.find(s => s.id === id).name;

/**
 * The machine, without the stacks around it. `exportWorkspaceState` carries
 * `history` and `future`, so an undo can restore the machine exactly and still
 * not compare equal to the blob taken before the edit — the entry it popped is
 * on `future` now, which is the undo working rather than failing.
 */
function machineShot() {
  return JSON.stringify({
    states: App.states, transitions: App.transitions, blocks: App.blocks,
    startId: App.startId, accepts: [...App.accepts]
  });
}

// ── the definition a nested block comes out as ────────────────────

test('outlining a nested block strips its ancestors, not just its own name', () => {
  tmCanvas();
  const { inner } = placeALU();

  // The states are named `ALU/add/scan` on the canvas. A definition is its own
  // space, so what comes out is what would have come out had `add` been drawn
  // at the top level.
  const def = context.outlineBlock(inner.id);
  assert.deepEqual(def.states.map(s => s.name).sort(), ['done', 'scan']);
});

test('a nested block placed again does not accumulate the path it came from', () => {
  tmCanvas();
  const { inner } = placeALU();
  const def = context.outlineBlock(inner.id);

  // The prefix is written once per level, so one level deep is one segment.
  // Matched as a string rather than counted, `add/` does not match
  // `ALU/add/scan` and the result was `add/ALU/add/scan`.
  const placed = context.inlineBlock(def, { parent: null, x: 500, y: 300 });
  assert.deepEqual(placed.states.map(s => s.name).sort(), ['add/done', 'add/scan']);
  for (const s of placed.states) {
    assert.equal(context.blockPathOf(s.id), s.name, 'the tree and the name agree');
  }
});

test('a state the reader renamed by hand is left whole', () => {
  tmCanvas();
  const { inner } = placeALU();
  const member = context.blockMembers(inner.id)[0];
  member.name = 'sweep';

  const def = context.outlineBlock(inner.id);
  assert.ok(def.states.some(s => s.name === 'sweep'), 'a short name is not sliced away');
});

// ── the clipboard ─────────────────────────────────────────────────

test('a nested block copies out to the top level as an independent copy', () => {
  tmCanvas();
  const { outer, inner } = placeALU();

  context.enterBlockScope(outer.id);
  App.selectedStates = new Set([inner.id]);
  context.copySelection();
  context.leaveBlockScope();
  context.pasteClipboard({ x: 600, y: 400 });

  const roots = context.liveBlocks().filter(b => !b.parent);
  assert.equal(roots.length, 2, 'the ALU, and the add that came out of it');
  const copy = roots.find(b => b.id !== outer.id);
  assert.equal(copy.name, 'add');

  const original = new Set(context.blockMembers(inner.id).map(s => s.id));
  for (const s of context.blockMembers(copy.id)) {
    assert.ok(!original.has(s.id), 'fresh states, not the original ones');
  }
  assert.ok(copy.entry && nameOf(copy.entry) === 'add/scan', 'the entry came with it');
  assert.equal(copy.exits.length, 1);
});

test('a block pasted while drilled in lands in the block you are standing in', () => {
  tmCanvas();
  const { inner: innerA } = placeALU('A', { x: 0, y: 0 });
  const { outer: b } = placeALU('B', { x: 600, y: 0 });

  App.selectedStates = new Set([innerA.id]);
  context.copySelection();
  context.enterBlockScope(b.id);
  context.pasteClipboard({ x: 700, y: 200 });

  const children = context.liveBlocks().filter(x => x.parent === b.id);
  assert.equal(children.length, 2, 'B kept its own add and gained the pasted one');
  const pasted = children.find(x => x.id !== b.id && context.blockMembers(x.id)
    .some(s => App.clipboard && s.x >= 700));
  assert.ok(pasted, 'the pasted copy is under B');
  for (const s of context.blockMembers(pasted.id)) {
    assert.equal(context.blockPathOf(s.id),
      'B/' + pasted.name + '/' + context.localStateName(s));
  }
});

test('the machine around a copied block is untouched by the copy', () => {
  tmCanvas();
  const { outer, inner } = placeALU();
  const before = JSON.stringify(context.exportWorkspaceState());

  App.selectedStates = new Set([inner.id]);
  context.copySelection();
  assert.equal(JSON.stringify(context.exportWorkspaceState()), before, 'a copy writes nothing');
  assert.ok(App.clipboard.blocks.length === 1 && !App.clipboard.states.length);
  assert.ok(context.getBlock(outer.id), 'and the block it came from is still there');
});

// ── cutting ───────────────────────────────────────────────────────

test('cutting a block takes it away and leaves it on the clipboard', () => {
  tmCanvas();
  const { outer, inner } = placeALU();
  const doomed = context.blockMembers(inner.id).map(s => s.id);

  App.selectedStates = new Set([inner.id]);
  context.cutSelection();

  assert.equal(context.getBlock(inner.id), null, 'the record is gone');
  for (const id of doomed) assert.ok(!App.states.some(s => s.id === id), 'and the states behind it');
  assert.ok(context.getBlock(outer.id), 'the block it was inside stands');
  assert.equal(App.clipboard.blocks.length, 1, 'and it is on the clipboard');
});

test('a cut is one edit, so one undo puts it back', () => {
  tmCanvas();
  const { inner } = placeALU();
  // Normalised first: an ALU whose own exit is a state inside its child `add`
  // loses that exit at the first prune (pruneBlocks wants a *direct* member),
  // which is a separate, pre-existing bug — read it here and the two sides of
  // the undo would differ over it rather than over anything a cut did.
  context.liveBlocks();
  const before = machineShot();
  const depth = App.history.length;

  App.selectedStates = new Set([inner.id]);
  context.cutSelection();
  assert.notEqual(machineShot(), before);
  assert.equal(App.history.length, depth + 1, 'one entry, not one for the copy and one for the delete');

  context.undo();
  assert.equal(machineShot(), before, 'one Ctrl+Z, not two');
});

test('a cut block pastes back somewhere else', () => {
  tmCanvas();
  const { outer, inner } = placeALU();

  context.enterBlockScope(outer.id);
  App.selectedStates = new Set([inner.id]);
  context.cutSelection();
  context.leaveBlockScope();
  context.pasteClipboard({ x: 700, y: 500 });

  const roots = context.liveBlocks().filter(b => !b.parent);
  assert.equal(roots.length, 2);
  const moved = roots.find(b => b.id !== outer.id);
  assert.deepEqual(context.blockMembers(moved.id).map(s => s.name).sort(),
    ['add/done', 'add/scan']);
});

test('cutting nothing says so and writes nothing', () => {
  tmCanvas();
  placeALU();
  const before = JSON.stringify(context.exportWorkspaceState());
  context.clearSelection();

  context.cutSelection();
  assert.equal(JSON.stringify(context.exportWorkspaceState()), before);
});

// ── the affordance ────────────────────────────────────────────────

test('a clipboard holding only a block still offers Paste', () => {
  tmCanvas();
  const { inner } = placeALU();
  App.selectedStates = new Set([inner.id]);
  context.copySelection();

  // pasteClipboard counts states *and* blocks, so the menu has to as well —
  // gated on states alone the row was greyed out for a paste Ctrl+V performs.
  context.showCanvasContextMenu(10, 10);
  const item = context.$('canvas-ctx-paste');
  assert.ok(item && !item.classList.contains('disabled'));
});

// ── the machine the clipboard lands on ────────────────────────────
// The clipboard is the one thing in the app that outlives the machine it was
// filled from: nothing clears it on a machine switch, deliberately, so copy on
// a TM / look at something else / switch back / paste keeps working. Which
// makes this the one path by which a block definition could reach a machine
// that has no concept of one, and it did — the records simply landed, and the
// DFA then carried a `blocks` array over states named `ALU/add/scan` whose
// transitions held a `write` and a `dir` it has no reader for, all the way into
// the `.json`. Nothing threw and nothing said anything.

test('a block copied on a TM cannot be pasted onto a DFA', () => {
  tmCanvas();
  const { outer } = placeALU();
  App.selectedStates = new Set([outer.id]);
  context.copySelection();

  // The switch is what the reader does between the two: it empties the diagram
  // and keeps Σ, and the clipboard is neither of those.
  App.machine = 'DFA';
  context.performClear();
  const before = JSON.stringify(context.exportWorkspaceState());

  context.pasteClipboard({ x: 100, y: 100 });
  assert.equal(JSON.stringify(context.exportWorkspaceState()), before);
  assert.equal(App.blocks.length, 0);
});

test('the refusal says why, in the machine it was asked of', () => {
  tmCanvas();
  assert.equal(context.blockPlacementRefusal(aluDef(), 'TM'), null);
  const say = context.blockPlacementRefusal(aluDef(), 'DFA');
  assert.match(say, /DFA/);
  assert.match(say, /stay move/);
});

test('a refused paste keeps the clipboard, so switching back still works', () => {
  tmCanvas();
  const { outer } = placeALU();
  App.selectedStates = new Set([outer.id]);
  context.copySelection();

  App.machine = 'DFA';
  context.performClear();
  context.pasteClipboard({ x: 100, y: 100 });

  App.machine = 'TM';
  context.pasteClipboard({ x: 100, y: 100 });
  assert.equal(context.liveBlocks().filter(b => !b.parent).length, 1);
});

test('a mixed clipboard is refused whole, not half', () => {
  tmCanvas();
  const { outer } = placeALU();
  App.states.push({ id: 'x9', x: 400, y: 0, name: 'loose' });
  App.selectedStates = new Set([outer.id, 'x9']);
  context.copySelection();

  App.machine = 'DFA';
  context.performClear();
  context.pasteClipboard({ x: 100, y: 100 });

  // Pasting the states and dropping the block would leave the interior of a
  // subroutine loose on the canvas under names that no longer mean anything.
  assert.equal(App.states.length, 0);
});

test('a block written for one tape count cannot be pasted onto a machine that reads tuples', () => {
  tmCanvas();
  const { outer } = placeALU();
  App.selectedStates = new Set([outer.id]);
  context.copySelection();

  // MTM has a stay move, so the first question says yes — and its rules are a
  // read *tuple*, so a single-tape block's transitions would arrive with no
  // `tapeSyms` at all and the machine would run reading undefined.
  App.machine = 'MTM';
  context.performClear();
  context.pasteClipboard({ x: 100, y: 100 });
  assert.equal(App.blocks.length, 0);
});

test('the tape machines that share a transition shape share their blocks', () => {
  for (const m of ['TM', 'NDTM', 'LBA', 'ITM']) {
    assert.equal(context.blockPlacementRefusal(aluDef(), m), null, m);
  }
});

// ── loose states cross machines too ───────────────────────────────
// A block definition records the machine it was written for; a state and its
// transitions record nothing, and a transition is a plain object whose every
// field is optional — so a DFA handed a rule carrying `tapeSyms` and no
// `symbol` does not throw, it decides against `undefined`, which rejects
// everything and looks exactly like a machine that is merely wrong. The
// clipboard now carries the machine it was filled from, which is what there is
// to ask at paste time.

test('states copied on a TM cannot be pasted onto a DFA either', () => {
  tmCanvas();
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'p' });
  App.states.push({ id: 'x2', x: 120, y: 0, name: 'q' });
  App.transitions.push({ id: 'u1', from: 'x1', to: 'x2', symbol: 'a', write: 'a', dir: 'R' });
  App.selectedStates = new Set(['x1', 'x2']);
  context.copySelection();

  App.machine = 'DFA';
  context.performClear();
  context.pasteClipboard({ x: 100, y: 100 });

  assert.equal(App.states.length, 0);
  assert.equal(App.transitions.length, 0);
});

test('the clipboard records the machine it was filled from', () => {
  tmCanvas();
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'p' });
  App.selectedStates = new Set(['x1']);
  context.copySelection();
  assert.equal(App.clipboard.machine, 'TM');
});

test('a paste onto a machine that reads the same rules still works', () => {
  tmCanvas();
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'p' });
  App.states.push({ id: 'x2', x: 120, y: 0, name: 'q' });
  App.transitions.push({ id: 'u1', from: 'x1', to: 'x2', symbol: 'a', write: 'a', dir: 'R' });
  App.selectedStates = new Set(['x1', 'x2']);
  context.copySelection();

  // A TM and an LBA differ in their tape, not in their rules — which is the
  // case the shape test exists to keep working rather than to refuse.
  App.machine = 'LBA';
  context.performClear();
  context.pasteClipboard({ x: 100, y: 100 });
  assert.equal(App.states.length, 2);
  assert.equal(App.transitions.length, 1);
});

test('the clipboard is session state and reaches no serializer', () => {
  tmCanvas();
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'p' });
  App.selectedStates = new Set(['x1']);
  context.copySelection();

  // What is on the clipboard is a property of this reader's hand, not of the
  // document — the same reasoning the run subject and the per-scope cameras
  // carry. A file recording it would be a file describing someone else's copy.
  assert.equal(JSON.stringify(context.getWorkspaceData()).includes('clipboard'), false);
  assert.equal(JSON.stringify(context.exportWorkspaceState()).includes('clipboard'), false);
});
