import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// Making a block out of what you have already drawn, and taking one apart.
//
// Grouping is deliberately *not* an inline of a definition: the states are
// already here and already wired, so it is a re-parenting rather than a copy.
// Nothing is added, nothing is removed, and the machine decides exactly what it
// decided a moment before — which is the property that makes this safe to offer
// on a diagram someone has spent an hour on, and the one these tests are mostly
// about.

const harness = createHarness();
const { App } = context;
const ANY = 'Σ';
const BLANK = '⊔';

/**
 * A four-state machine: an outer state, two states that will become a block,
 * and an outer state after them.
 *
 *   before → mid1 → mid2 → after
 */
function chain() {
  harness.resetApp();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'before' },
    { id: 's2', x: 150, y: 0, name: 'mid1' },
    { id: 's3', x: 300, y: 0, name: 'mid2' },
    { id: 's4', x: 450, y: 0, name: 'after' }
  ];
  App.stateN = 4;
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 's2', to: 's3', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't3', from: 's3', to: 's4', symbol: 'b', write: 'b', dir: 'R' }
  ];
  App.transN = 3;
  App.startId = 's1';
  App.accepts = new Set(['s4']);
  context.invalidateViewGraph();
  return App;
}

function selectMiddle() {
  App.selectedStates = new Set(['s2', 's3']);
}

// ── grouping ──────────────────────────────────────────────────────

test('grouping wraps the selection without changing what the machine decides', () => {
  chain();
  const before = context.decideMachine('TM', ['a', 'a', 'b']).verdict;
  assert.equal(before, 'acc', 'the fixture accepts aab');

  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');

  assert.ok(block, 'a block was made');
  assert.equal(App.states.length, 4, 'no state was added or removed');
  assert.equal(App.transitions.length, 3, 'and no transition was');
  assert.equal(context.decideMachine('TM', ['a', 'a', 'b']).verdict, 'acc',
    'so it decides exactly what it decided before');
});

test('the entry is where control arrives from outside', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  assert.equal(block.entry, 's2', 'the edge from `before` lands on mid1');
});

test('the exits are where control leaves the selection', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  assert.equal(block.exits.length, 1);
  assert.equal(block.exits[0].id, 's3', 'the edge to `after` leaves from mid2');
});

test('the start state wins the entry when it is in the selection', () => {
  chain();
  App.selectedStates = new Set(['s1', 's2']);
  const block = context.groupSelectionIntoBlock('head');
  assert.equal(block.entry, 's1');
});

test('a group with no edge leaving it falls back to its accepting states', () => {
  chain();
  App.selectedStates = new Set(['s3', 's4']);
  const block = context.groupSelectionIntoBlock('tail');
  assert.deepEqual(block.exits.map(e => e.id), ['s4'], 'the accepting one');
});

test('grouping is one undo step, whatever it wrapped', () => {
  chain();
  selectMiddle();
  context.groupSelectionIntoBlock('mid');
  assert.equal(context.liveBlocks().length, 1);

  context.undo();
  assert.equal(context.liveBlocks().length, 0);
  assert.ok(App.states.every(s => s.blockId === undefined), 'and no state still claims one');
  assert.equal(context.getState('s2').name, 'mid1', 'the names came back too');
});

test('members are prefixed, so a grouped block reads like a placed one', () => {
  chain();
  selectMiddle();
  context.groupSelectionIntoBlock('mid');
  assert.equal(context.getState('s2').name, 'mid/mid1');
  assert.equal(context.blockPathOf('s2'), 'mid/mid1');
  assert.equal(context.localStateName(context.getState('s2')), 'mid1',
    'and a drilled-in view still shows the short name');
});

test('a selected block becomes a child of the new one — this is how a CPU is built', () => {
  chain();
  selectMiddle();
  const inner = context.groupSelectionIntoBlock('mid');

  // Now select the box and the state beside it, and wrap the lot.
  App.selectedStates = new Set([inner.id, 's1']);
  const outer = context.groupSelectionIntoBlock('unit');

  assert.equal(context.getBlock(inner.id).parent, outer.id);
  assert.equal(context.blockChildren(outer.id).length, 1);
  assert.equal(context.blockDepth(inner.id), 1);
  // And the canvas is drawing one box.
  context.invalidateViewGraph();
  assert.equal(context.viewStates().length, 2, 'the outer box and `after`');
});

test('grouping inside a block puts the new one on that level', () => {
  chain();
  selectMiddle();
  const outer = context.groupSelectionIntoBlock('mid');
  context.enterBlockScope(outer.id);

  App.selectedStates = new Set(['s2']);
  const inner = context.groupSelectionIntoBlock('inner');
  assert.equal(inner.parent, outer.id, 'a block is made where the reader is standing');
});

test('a selection with nothing but a block in it is refused', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  App.selectedStates = new Set([block.id]);
  assert.equal(context.groupSelectionIntoBlock('empty'), null,
    'a block needs at least one state of its own');
});

test('a machine with no stay move cannot have blocks', () => {
  chain();
  context.applyMachineSwitch('DFA');
  App.states = [{ id: 's1', x: 0, y: 0, name: 'q0' }];
  App.selectedStates = new Set(['s1']);
  assert.equal(context.groupSelectionIntoBlock('nope'), null);
  assert.equal(context.liveBlocks().length, 0);
});

// ── ungrouping ────────────────────────────────────────────────────

test('ungrouping puts the states back and drops the box', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  const verdict = context.decideMachine('TM', ['a', 'a', 'b']).verdict;

  assert.equal(context.ungroupBlock(block.id), true);
  assert.equal(context.liveBlocks().length, 0);
  assert.equal(App.states.length, 4, 'the states never went anywhere');
  assert.ok(App.states.every(s => s.blockId === undefined));
  assert.equal(context.decideMachine('TM', ['a', 'a', 'b']).verdict, verdict);
});

test('ungrouping re-parents children rather than orphaning them', () => {
  chain();
  selectMiddle();
  const inner = context.groupSelectionIntoBlock('mid');
  App.selectedStates = new Set([inner.id, 's1']);
  const outer = context.groupSelectionIntoBlock('unit');

  context.ungroupBlock(outer.id);
  assert.equal(context.getBlock(inner.id).parent, null, 'the child came up a level');
  assert.equal(context.liveBlocks().length, 1, 'and survived');
});

test('ungrouping is one undo step', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  context.ungroupBlock(block.id);
  context.undo();
  assert.equal(context.liveBlocks().length, 1);
  assert.equal(context.blockMembers(block.id).length, 2);
});

// ── round trip ────────────────────────────────────────────────────

test('group, save, and place gives an independent second copy', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('mid');
  const def = context.outlineBlock(block.id);

  assert.deepEqual(context.validateBlockDefinition(def), []);
  const placed = context.placeBlockDefinition(def, { x: 900, y: 400 });

  assert.ok(placed);
  assert.notEqual(placed.id, block.id);
  assert.equal(context.liveBlocks().length, 2);
  assert.equal(App.states.length, 6, 'two more states, not two shared ones');

  const a = new Set(context.blockMembers(block.id).map(s => s.id));
  const b = new Set(context.blockMembers(placed.id).map(s => s.id));
  assert.equal([...a].filter(id => b.has(id)).length, 0);
});

test('the block list names every block at every depth, with its path', () => {
  chain();
  selectMiddle();
  const inner = context.groupSelectionIntoBlock('mid');
  App.selectedStates = new Set([inner.id, 's1']);
  const outer = context.groupSelectionIntoBlock('unit');

  const rows = context.allBlocks();
  assert.equal(rows.length, 2);
  const deep = rows.find(r => r.id === inner.id);
  assert.equal(deep.name, 'mid');
  assert.equal(deep.path, 'unit', 'so two blocks with one name are still telling apart');
});

// ══════════════════════════════════════════════════════════════════
//  COPY, PASTE AND SCOPE
// ══════════════════════════════════════════════════════════════════

test('a paste lands where the reader is standing, not where it was copied from', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('seek');
  context.enterBlockScope(block.id);

  const inner = context.viewStates().filter(n => n.kind === undefined);
  App.selectedStates = new Set(inner.map(n => n.id));
  context.copySelection();

  context.enterBlockScope(null, { to: [] });
  const before = App.states.length;
  context.pasteClipboard({ x: 900, y: 500 });

  const added = App.states.slice(before);
  assert.ok(added.length, 'something was pasted');
  // `{...s}` carried the source's own blockId, so states copied inside a block
  // arrived still claiming to belong to it: they vanished straight back inside
  // the block they came from, with nothing on screen to say where they went.
  for (const st of added) {
    assert.equal(st.blockId, undefined, 'a paste at the top level is at the top level');
  }
  const drawn = new Set(context.viewStates().map(n => n.id));
  for (const st of added) assert.ok(drawn.has(st.id), 'and it is on screen');
});

test('copying a block copies the block, not nothing', () => {
  chain();
  selectMiddle();
  const block = context.groupSelectionIntoBlock('seek');
  App.selectedStates = new Set([block.id]);

  // `ids` held `b1`, no state matched it, and the clipboard came back empty:
  // "Copied 0 states", then "Nothing to paste".
  context.copySelection();
  const blocksBefore = App.blocks.length;
  const statesBefore = App.states.length;
  context.pasteClipboard({ x: 900, y: 500 });

  assert.equal(App.blocks.length, blocksBefore + 1, 'a second block exists');
  assert.equal(App.states.length, statesBefore + 2, 'with its own copy of the interior');

  // Independent copies, not two records over one set of states.
  const copy = App.blocks[App.blocks.length - 1];
  assert.notEqual(copy.id, block.id);
  const mine = context.blockMembers(block.id).map(s => s.id).sort();
  const theirs = context.blockMembers(copy.id).map(s => s.id).sort();
  assert.deepEqual(mine.filter(id => theirs.includes(id)), [], 'they share no state');
});
