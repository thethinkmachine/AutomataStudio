import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Dragging a port.
//
// A port is derived — rebuilt from the block record and the machine's wiring
// every time the projection is, and reaching no serializer of its own. That is
// what made it un-draggable: there was nowhere for a hand-set position to live
// that the next rebuild would not throw away.
//
// It lives on the *block record*, which does serialize, keyed by port id. These
// tests pin the three things that makes true, each of which is silent to break:
// the offset survives a rebuild, it is an offset rather than a point (so the
// tab follows the state it is attached to), and it reaches the save file.

const harness = createHarness();
const { context } = harness;

/** A TM with one block, drilled into. */
function drilled() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.states = [
    { id: 's1', name: 'outside', x: 0, y: 0 },
    { id: 's2', name: 'B/entry', x: 200, y: 0, blockId: 'b1' },
    { id: 's3', name: 'B/done', x: 300, y: 0, blockId: 'b1' }
  ];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', read: 'a', write: 'a', move: 'R' }];
  App.startId = 's1';
  App.blocks = [{ id: 'b1', name: 'B', entry: 's2', exits: [{ id: 's3', label: 'ok' }], x: 250, y: 0 }];
  App.scope = ['b1'];
  context.invalidateViewGraph();
  return App;
}

const portsNow = () => context.viewStates().filter(context.isPortNode);

test('a port is placed for you until you place it yourself', () => {
  drilled();
  const entry = portsNow().find(p => p.dir === 'in');
  assert.ok(entry, 'the entry tab is drawn');
  assert.equal(entry.manual, undefined, 'nothing is hand-placed to start with');

  context.setPortOffset('b1', entry.id, -40, -140);
  context.invalidateViewGraph();

  const after = portsNow().find(p => p.id === entry.id);
  assert.equal(after.x, 200 - 40, 'the offset survives the rebuild');
  assert.equal(after.y, 0 - 140);
  assert.equal(after.manual, true, 'and the tab says it was placed by hand');
});

test('a hand-placed port follows the state it is attached to', () => {
  const App = drilled();
  const entry = portsNow().find(p => p.dir === 'in');
  context.setPortOffset('b1', entry.id, -40, -140);

  // An absolute point would leave the tab behind the moment its anchor moved,
  // which is the whole reason the record stores an offset.
  App.states[1].x = 500;
  context.invalidateViewGraph();

  const moved = portsNow().find(p => p.id === entry.id);
  assert.equal(moved.x, 500 - 40, 'the tab travelled with its anchor');
});

test('the placement reaches the save file, and only through the block', () => {
  drilled();
  const entry = portsNow().find(p => p.dir === 'in');
  context.setPortOffset('b1', entry.id, -40, -140);

  const saved = JSON.parse(JSON.stringify(context.getWorkspaceData()));
  assert.deepEqual(saved.blocks[0].ports[entry.id], { dx: -40, dy: -140 });
  // Derived still: nothing about a port is written anywhere else.
  assert.ok(!('ports' in saved), 'ports are not a top-level list');
});

test('resetting hands the port back to the placement pass', () => {
  drilled();
  const entry = portsNow().find(p => p.dir === 'in');
  const auto = { x: entry.x, y: entry.y };

  context.setPortOffset('b1', entry.id, -40, -140);
  context.invalidateViewGraph();
  assert.notEqual(portsNow().find(p => p.id === entry.id).x, auto.x);

  context.resetPortPlacement(entry.id);
  const back = portsNow().find(p => p.id === entry.id);
  assert.deepEqual({ x: back.x, y: back.y }, auto, 'back where it was placed for us');
  assert.equal(back.manual, undefined, 'and no longer claiming to be hand-placed');
});
