import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Blocks validate themselves; they are never invalidated.
//
// `App.states` is pushed to, filtered and reassigned wholesale from around
// twenty places — every algorithm's load path, StateMate's apply, the wizard,
// performClear, an undo — and **not one of them announces it**. That is the
// same problem stateIndex() in js/state.js solves by checking array identity
// rather than being told, and it is the way a feature like this rots: a block
// record survives a subset construction, points at states that no longer
// exist, and the renderer draws a node over nothing.
//
// So the answer is the same one: a record that no longer describes anything is
// dropped when it is next read. These tests drive that through the real
// destroyers rather than by hand, because a hand-made broken record is not
// evidence that the app can make one.
//
// The second half is the save format. A block is document content — it travels
// with the machine through the .json, the share link, the embedded PNG, a tab
// switch and the undo stack — and every one of those is a different serializer.

const harness = createHarness();
const { context } = harness;

const ANY = 'Σ';
const BLANK = '⊔';

function tmCanvas() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  return App;
}

function simpleDef(name = 'seek') {
  return {
    name,
    machine: 'TM',
    sigma: ['a', 'b'],
    stackAlpha: ['a', 'b', BLANK],
    states: [
      { id: 'd1', x: 0, y: 0, name: 'scan' },
      { id: 'd2', x: 120, y: 0, name: 'done' }
    ],
    transitions: [
      { id: 'e1', from: 'd1', to: 'd1', symbol: 'a', write: 'a', dir: 'R' },
      { id: 'e2', from: 'd1', to: 'd2', symbol: BLANK, write: BLANK, dir: 'S' }
    ],
    startId: 'd1', entry: 'd1', accepts: ['d2'], version: 1, key: 'seek'
  };
}

/** A canvas with one block on it, plus one ordinary state beside it. */
function withBlock() {
  const App = tmCanvas();
  const { block } = context.inlineBlock(simpleDef(), { x: 100, y: 100 });
  App.states.push({ id: 's' + (++App.stateN), x: 500, y: 100, name: 'after' });
  return { App, block };
}

// ── the validator ─────────────────────────────────────────────────

test('a block whose states were replaced wholesale is dropped on read', () => {
  const { App, block } = withBlock();
  assert.equal(context.liveBlocks().length, 1);

  // Exactly what loadBuiltMachine, loadSubsetAsDFA and applyCandidate do:
  // assign a new array over the old one, announcing nothing.
  App.states = [{ id: 'z1', x: 0, y: 0, name: 'q0' }];

  assert.equal(context.blockIsIntact(block), false);
  assert.equal(context.liveBlocks().length, 0, 'no node is left pointing at nothing');
});

test('deleting the entry state drops the block; deleting one exit only trims it', () => {
  const { App, block } = withBlock();
  const exitId = block.exits[0].id;

  // One exit of one goes: the block survives with no ports left.
  App.states = App.states.filter(s => s.id !== exitId);
  assert.equal(context.liveBlocks().length, 1, 'the block is still a block');
  assert.equal(context.getBlock(block.id).exits.length, 0, 'but that port has gone');

  // The entry goes: there is nothing left to enter, so the record goes too.
  App.states = App.states.filter(s => s.id !== block.entry);
  assert.equal(context.liveBlocks().length, 0);
});

test('dropping a parent drops its children, to a fixed point', () => {
  const App = tmCanvas();
  const nested = {
    ...simpleDef('outer'),
    states: [
      { id: 'd1', x: 0, y: 0, name: 'in' },
      { id: 'd2', x: 90, y: 0, name: 'mid/step', blockId: 'k1' },
      { id: 'd3', x: 180, y: 0, name: 'out' }
    ],
    transitions: [
      { id: 'e1', from: 'd1', to: 'd2', symbol: ANY, write: ANY, dir: 'S' },
      { id: 'e2', from: 'd2', to: 'd3', symbol: ANY, write: ANY, dir: 'S' }
    ],
    blocks: [{ id: 'k1', name: 'mid', parent: null, entry: 'd2', exits: [{ id: 'd2', label: 'done' }], x: 90, y: 0 }],
    accepts: ['d3']
  };
  const outer = context.inlineBlock(nested, {}).block;
  assert.equal(context.liveBlocks().length, 2);

  // Kill only the outer block's own member. Its child is still intact on its
  // own terms, so a single pass would leave it orphaned — the prune has to
  // run to a fixed point.
  App.states = App.states.filter(s => (s.blockId || null) !== outer.id);
  assert.equal(context.liveBlocks().length, 0, 'the child went with its parent');
});

test('a state whose container is gone stops claiming one', () => {
  const { App, block } = withBlock();
  App.blocks = [];
  context.pruneBlocks();
  assert.ok(App.states.every(s => s.blockId === undefined),
    'no state is left inside a block that does not exist');
  assert.equal(context.getBlock(block.id), null);
});

// ── driven through the real destroyers ────────────────────────────

test('performClear takes the blocks with the diagram', () => {
  const { App } = withBlock();
  context.performClear();
  assert.deepEqual(App.blocks, []);
  assert.equal(App.blockN, 0);
  assert.deepEqual(App.scope, []);
});

test('loadBuiltMachine leaves no ghost block behind', () => {
  const { App } = withBlock();
  context.loadBuiltMachine({
    states: [{ id: 'n1', x: 0, y: 0, name: 'q0' }],
    transitions: [],
    startId: 'n1',
    accepts: []
  }, 'DFA');
  assert.equal(context.liveBlocks().length, 0);
});

test('the subset construction leaves no ghost block behind', () => {
  const { App } = withBlock();
  App._lastSubset = {
    states: [{ name: 'A', isStart: true, isAcc: false }, { name: 'B', isStart: false, isAcc: true }],
    trans: [{ from: 'A', to: 'B', sym: 'a' }]
  };
  context.loadSubsetAsDFA();
  assert.equal(context.liveBlocks().length, 0);
  assert.ok(App.states.every(s => s.blockId === undefined));
});

test('resetIds recovers the block counter from the ids in the file', () => {
  const App = tmCanvas();
  App.blocks = [{ id: 'b7', name: 'x', parent: null, entry: 's1', exits: [] }];
  App.states = [{ id: 's1', x: 0, y: 0, name: 'q', blockId: 'b7' }];
  App.transitions = [];
  App.blockN = 0;
  context.resetIds();
  assert.equal(App.blockN, 7, 'the next block cannot reuse an id in the file');
});

// ── the serializers ───────────────────────────────────────────────

test('a block survives a tab switch, which is exportWorkspaceState', () => {
  const { App, block } = withBlock();
  const blob = context.exportWorkspaceState();

  assert.equal(blob.blocks.length, 1);
  assert.equal(blob.blockN, App.blockN);
  assert.notEqual(blob.blocks[0], block, 'deep-copied, like states and transitions');

  harness.resetApp();
  context.importWorkspaceState(blob);
  assert.equal(context.liveBlocks().length, 1);
  assert.equal(context.getBlock(block.id).name, 'seek');
  assert.equal(context.blockMembers(block.id).length, 2);
});

test('a block survives the save format, which is getWorkspaceData / loadData', () => {
  const { block } = withBlock();
  const data = JSON.parse(JSON.stringify(context.getWorkspaceData()));

  assert.equal(data.blocks.length, 1);
  // `blockId` needs no work in the save format: roundForSave copies a state
  // whole and rounds only the fields it names.
  assert.ok(data.states.some(s => s.blockId === block.id));

  harness.resetApp();
  context.loadData(data);
  assert.equal(context.liveBlocks().length, 1);
  assert.equal(context.blockPathOf(context.getBlock(block.id).entry), 'seek/scan');
});

test('a block survives the undo stack', () => {
  const { App, block } = withBlock();
  context.snapshot();
  context.removeBlock(block.id);
  assert.equal(context.liveBlocks().length, 0);

  context.undo();
  assert.equal(context.liveBlocks().length, 1);
  assert.equal(context.blockMembers(block.id).length, 2);
});

test('a scope naming a block the file does not have is dropped, not trusted', () => {
  const { block } = withBlock();
  const blob = context.exportWorkspaceState();
  blob.scope = [block.id, 'b999'];
  blob.blocks = blob.blocks.filter(b => b.id !== block.id);

  harness.resetApp();
  context.importWorkspaceState(blob);
  assert.deepEqual(context.App.scope, [], 'no canvas drawn inside a block that is not there');
});

test('an empty workspace has no blocks, and Clear returns to one', () => {
  const blank = context.blankWorkspaceData();
  assert.deepEqual(blank.blocks, []);
  assert.equal(blank.blockN, 0);
  assert.deepEqual(blank.scope, []);

  const { App } = withBlock();
  context.resetWorkspace();
  assert.deepEqual(App.blocks, []);
  assert.equal(App.blockN, 0);
});

// ── the machine layer is untouched ────────────────────────────────

test('the flat machine is what runs, so blocks reach no decider', () => {
  const { App, block } = withBlock();
  App.startId = block.entry;
  App.accepts.add(block.exits[0].id);

  // The whole point of inlining: nothing below js/machines/ knows a block
  // exists, and the snapshot posted to a worker carries no trace of one.
  const snap = context.snapshotMachine();
  assert.equal(snap.blocks, undefined);
  assert.equal(snap.states.length, App.states.length);
  assert.equal(context.decideMachine('TM', ['a']).verdict, 'acc');
});

test('blocks are a Turing-family capability, declared rather than named', () => {
  assert.equal(context.machineSupportsBlocks('TM'), true);
  assert.equal(context.machineSupportsBlocks('NDTM'), true);
  assert.equal(context.machineSupportsBlocks('MTM'), true);
  assert.equal(context.machineSupportsBlocks('LBA'), true);
  assert.equal(context.machineSupportsBlocks('ITM'), true);
  // A machine with no stay move cannot leave a block without eating a symbol.
  assert.equal(context.machineSupportsBlocks('DFA'), false);
  assert.equal(context.machineSupportsBlocks('NPDA'), false);
  assert.equal(context.machineSupportsBlocks('Moore'), false);

  // The whole family, from the registry rather than from a list written here.
  for (const id of context.familyMembers('turing')) {
    assert.equal(context.machineSupportsBlocks(id), true, id);
  }
});
