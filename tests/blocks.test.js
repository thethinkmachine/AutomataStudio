import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Building blocks, as a *model*.
//
// A block is a macro: placing one inlines its states into the flat machine and
// records a grouping over them. That choice is what keeps every simulator,
// decider, worker and exporter untouched — they all read App.states straight
// off the module-global App — and it is also what these tests are mostly about.
// The invariant underneath all of them is that a block adds no computational
// power: the machine you get by placing two blocks and wiring them together
// decides exactly what the composition of the two decides.
//
// The rest pins the two things that are easy to get subtly wrong and silent to
// break: that two placements of one definition are two independent copies, and
// that a block whose states were replaced behind its back is dropped rather
// than left pointing at nothing.

const harness = createHarness();
const { context } = harness;

const ANY = 'Σ';
const BLANK = '⊔';

/** A blank Turing machine over {a, b}. */
function tmCanvas() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  return App;
}

/**
 * "Walk right until blank." One state, one exit.
 *
 * Deliberately the smallest thing that is still a real subroutine: it moves the
 * head, it halts, and where it halts is the answer it hands back.
 */
function seekBlank(name = 'seek') {
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
      { id: 'e2', from: 'd1', to: 'd1', symbol: 'b', write: 'b', dir: 'R' },
      { id: 'e3', from: 'd1', to: 'd2', symbol: BLANK, write: BLANK, dir: 'S' }
    ],
    startId: 'd1',
    entry: 'd1',
    accepts: ['d2'],
    version: 1,
    key: 'seek-blank'
  };
}

/** "Write x here and stop." Used as the second half of a composition. */
function writeSymbol(sym, name = 'write') {
  return {
    name,
    machine: 'TM',
    sigma: [sym],
    stackAlpha: [sym, BLANK],
    states: [
      { id: 'd1', x: 0, y: 0, name: 'put' },
      { id: 'd2', x: 120, y: 0, name: 'done' }
    ],
    transitions: [
      { id: 'e1', from: 'd1', to: 'd2', symbol: ANY, write: sym, dir: 'S' }
    ],
    startId: 'd1',
    entry: 'd1',
    accepts: ['d2'],
    version: 1,
    key: `write-${sym}`
  };
}

/** The exit edge every host wires a block onward with: consume nothing. */
function exitEdge(from, to) {
  const { App } = context;
  return { id: 't' + (++App.transN), from, to, symbol: ANY, write: ANY, dir: 'S' };
}

// ── the shape of a placement ──────────────────────────────────────

test('placing a block inlines its states into the flat machine', () => {
  const App = tmCanvas();
  const { block, states } = context.inlineBlock(seekBlank(), { x: 100, y: 100 });

  assert.equal(App.states.length, 2, 'both interior states are real states');
  assert.equal(App.transitions.length, 3);
  assert.ok(states.every(s => s.blockId === block.id), 'every one names its container');
  assert.equal(App.blocks.length, 1);
  assert.equal(block.parent, null);
});

test('interior names are prefixed with the instance, and the path reads back', () => {
  const App = tmCanvas();
  const { block } = context.inlineBlock(seekBlank(), {});
  const scan = App.states.find(s => s.name.endsWith('scan'));

  assert.equal(scan.name, 'seek/scan');
  assert.equal(context.blockPathOf(scan.id), 'seek/scan');
  assert.equal(block.name, 'seek');
});

test('the entry is the definition\'s start state and the exits are its accepts', () => {
  const App = tmCanvas();
  const { block } = context.inlineBlock(seekBlank(), {});

  assert.equal(context.getState(block.entry).name, 'seek/scan');
  assert.equal(block.exits.length, 1);
  assert.equal(context.getState(block.exits[0].id).name, 'seek/done');
  assert.equal(block.exits[0].label, 'done');
  // A block finishing is not the machine accepting.
  assert.equal(App.accepts.size, 0, 'the block\'s accept marks do not travel');
});

test('an empty canvas takes the first block\'s entry as its start state', () => {
  const App = tmCanvas();
  const { block } = context.inlineBlock(seekBlank(), {});
  assert.equal(App.startId, block.entry);

  // ...and a machine that already has one keeps it.
  const before = App.startId;
  context.inlineBlock(seekBlank(), {});
  assert.equal(App.startId, before);
});

test('placing a block unions its alphabets into the workspace', () => {
  const App = tmCanvas();
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', BLANK]);
  context.inlineBlock(writeSymbol('#'), {});

  assert.ok(App.sigma.has('#'), 'Σ grew');
  assert.ok(App.stackAlpha.has('#'), 'Γ grew');
  assert.ok(App.sigma.has('a'), 'and what was there stayed');
});

// ── two placements are two copies ─────────────────────────────────

test('a block placed twice is two independent copies', () => {
  const App = tmCanvas();
  const def = seekBlank();
  const first = context.inlineBlock(def, { x: 0, y: 0 }).block;
  const second = context.inlineBlock(def, { x: 400, y: 0 }).block;

  assert.notEqual(first.id, second.id);
  assert.equal(App.states.length, 4, 'four states, not two shared ones');
  assert.equal(App.blocks.length, 2);

  const a = new Set(context.blockMembers(first.id).map(s => s.id));
  const b = new Set(context.blockMembers(second.id).map(s => s.id));
  assert.equal([...a].filter(id => b.has(id)).length, 0, 'no state belongs to both');

  // Editing one leaves the other exactly as it was — which is what makes
  // "update all instances" an explicit action rather than a consequence.
  const mine = context.getState(first.entry);
  mine.x = 999;
  assert.notEqual(context.getState(second.entry).x, 999);
});

test('sibling blocks get distinct names, so their states do too', () => {
  const App = tmCanvas();
  const def = seekBlank();
  const first = context.inlineBlock(def, {}).block;
  const second = context.inlineBlock(def, {}).block;

  assert.equal(first.name, 'seek');
  assert.equal(second.name, 'seek 2');
  const names = App.states.map(s => s.name);
  assert.equal(new Set(names).size, names.length, 'no two states share a name');
  // The compiler matches by stateNameKey, not by the raw string.
  const keys = names.map(context.stateNameKey);
  assert.equal(new Set(keys).size, keys.length);
});

// ── the invariant: a composition decides what its parts decide ────

test('two blocks wired together decide what the composition decides', () => {
  const App = tmCanvas();
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', '#', BLANK]);

  // seek → (exit) → write '#'.  On input "ab" the head walks to the first
  // blank and stamps a '#' there, so the tape ends "ab#".
  const seek = context.inlineBlock(seekBlank(), { x: 0, y: 0 }).block;
  const write = context.inlineBlock(writeSymbol('#'), { x: 300, y: 0 }).block;
  App.transitions.push(exitEdge(seek.exits[0].id, write.entry));
  App.startId = seek.entry;
  App.accepts.add(write.exits[0].id);

  context.simTM(['a', 'b']);
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'accept');
  assert.deepEqual(last.tape.slice(0, 3), ['a', 'b', '#']);

  // And the DOM-free decider agrees, which is what the batch tester, the
  // Language panel and StateMate's verification all go through.
  assert.equal(context.decideMachine('TM', ['a', 'b']).verdict, 'acc');
});

test('an exit edge consumes nothing, so inlining cannot change the language', () => {
  const App = tmCanvas();
  const seek = context.inlineBlock(seekBlank(), {}).block;
  const write = context.inlineBlock(writeSymbol('#'), {}).block;
  const edge = exitEdge(seek.exits[0].id, write.entry);
  App.transitions.push(edge);

  // Σ / Σ, S: read anything, put back what you read, do not move. simTM reads
  // `write === sym.any` as "put back what you read".
  assert.equal(edge.symbol, ANY);
  assert.equal(edge.write, ANY);
  assert.equal(edge.dir, 'S');
});

// ── nesting ───────────────────────────────────────────────────────

/** A block containing two blocks: the CPU/ALU shape, two levels deep. */
function nestedDefinition() {
  return {
    name: 'ALU',
    machine: 'TM',
    sigma: ['a', 'b'],
    stackAlpha: ['a', 'b', BLANK],
    states: [
      { id: 'd1', x: 0, y: 0, name: 'in' },
      // A definition's nested states already carry their own prefix — that is
      // what placing `add` into `ALU` produced when the definition was built.
      { id: 'd2', x: 100, y: 0, name: 'add/scan', blockId: 'k1' },
      { id: 'd3', x: 200, y: 0, name: 'mul/put', blockId: 'k2' },
      { id: 'd4', x: 300, y: 0, name: 'out' }
    ],
    transitions: [
      { id: 'e1', from: 'd1', to: 'd2', symbol: ANY, write: ANY, dir: 'S' },
      { id: 'e2', from: 'd2', to: 'd3', symbol: ANY, write: ANY, dir: 'S' },
      { id: 'e3', from: 'd3', to: 'd4', symbol: ANY, write: ANY, dir: 'S' }
    ],
    blocks: [
      { id: 'k1', name: 'add', parent: null, entry: 'd2', exits: [{ id: 'd2', label: 'done' }], x: 100, y: 0 },
      { id: 'k2', name: 'mul', parent: null, entry: 'd3', exits: [{ id: 'd3', label: 'done' }], x: 200, y: 0 }
    ],
    startId: 'd1',
    entry: 'd1',
    accepts: ['d4'],
    version: 1,
    key: 'alu'
  };
}

test('placing a nested block expands the whole subtree in one go', () => {
  const App = tmCanvas();
  const { block } = context.inlineBlock(nestedDefinition(), { x: 50, y: 50 });

  assert.equal(App.blocks.length, 3, 'the ALU and its two children');
  assert.equal(App.states.length, 4);

  const children = context.blockChildren(block.id).map(b => b.name).sort();
  assert.deepEqual(children, ['add', 'mul']);
  assert.deepEqual(context.blockSubtree(block.id).length, 3);
  // Depth is a walk up `parent`, so there is nothing to bound.
  const add = context.blockChildren(block.id).find(b => b.name === 'add');
  assert.equal(context.blockDepth(block.id), 0);
  assert.equal(context.blockDepth(add.id), 1);
});

test('a nested path reads as a path, however deep', () => {
  const App = tmCanvas();
  context.inlineBlock(nestedDefinition(), {});
  const scan = App.states.find(s => s.name.endsWith('scan'));

  assert.equal(scan.name, 'ALU/add/scan', 'the name is the path');
  assert.equal(context.blockPathOf(scan.id), 'ALU/add/scan');
  assert.equal(context.localStateName(scan), 'scan', 'and a drilled-in view sees just this');
});

test('a name the reader typed themselves is left whole', () => {
  const App = tmCanvas();
  const { block } = context.inlineBlock(seekBlank(), {});
  const scan = context.getState(block.entry);
  scan.name = 'carry check';

  assert.equal(context.localStateName(scan), 'carry check');
  assert.equal(context.blockPathOf(scan.id), 'seek/carry check');
});

test('renaming a block moves every path under it, touching no state', () => {
  const App = tmCanvas();
  const outer = context.inlineBlock(nestedDefinition(), {}).block;
  const scan = App.states.find(s => s.name.endsWith('scan'));
  const before = scan.name;

  outer.name = 'ALU 7';
  assert.equal(context.blockPathOf(scan.id), 'ALU 7/add/scan');
  assert.equal(scan.name, before, 'the state itself was not rewritten');
  assert.equal(context.localStateName(scan), 'scan', 'and the local name is positional');
});

test('two ALUs nest independently, with distinct paths', () => {
  const App = tmCanvas();
  const def = nestedDefinition();
  context.inlineBlock(def, {});
  context.inlineBlock(def, {});

  assert.equal(App.blocks.length, 6);
  assert.equal(App.states.length, 8);
  const paths = App.states.map(s => context.blockPathOf(s.id));
  assert.equal(new Set(paths).size, paths.length, 'every state has its own path');
  assert.ok(paths.includes('ALU/add/scan'));
  assert.ok(paths.includes('ALU 2/add/scan'));
});

// ── multi-tape ────────────────────────────────────────────────────

test('a block written for fewer tapes is padded rather than refused', () => {
  harness.resetApp();
  const { App } = context;
  App.machine = 'MTM';
  App.tapeCount = 3;
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', BLANK]);

  const def = {
    name: 'two-tape',
    machine: 'MTM',
    tapeCount: 2,
    sigma: ['a'],
    states: [{ id: 'd1', x: 0, y: 0, name: 'q' }, { id: 'd2', x: 90, y: 0, name: 'h' }],
    transitions: [{
      id: 'e1', from: 'd1', to: 'd2',
      tapeSyms: ['a', 'a'], tapeWrites: ['a', 'a'], tapeDirs: ['R', 'R']
    }],
    startId: 'd1', entry: 'd1', accepts: ['d2']
  };

  const { transitions, warnings } = context.inlineBlock(def, {});
  assert.equal(transitions[0].tapeSyms.length, 3);
  assert.equal(transitions[0].tapeWrites.length, 3);
  assert.equal(transitions[0].tapeDirs.length, 3);
  // The new tape does nothing: a blank read, a blank write, a stationary head.
  assert.equal(transitions[0].tapeSyms[2], BLANK);
  assert.equal(transitions[0].tapeDirs[2], 'S');
  assert.ok(warnings.some(w => w.includes('2 tape')), 'and the reader is told');
});

// ── determinism at the boundary ───────────────────────────────────

test("a block whose own δ branches is reported, in the machine's own words", () => {
  const App = tmCanvas();
  // Two overlapping rules out of one state. A reader can draw this in a block
  // and the editor never sees it, because inlining does not go through the
  // editor — so inlineBlock asks the host machine's own determinism rule.
  const branching = {
    ...seekBlank('branchy'),
    transitions: [
      { id: 'e1', from: 'd1', to: 'd1', symbol: 'a', write: 'a', dir: 'R' },
      { id: 'e2', from: 'd1', to: 'd2', symbol: 'a', write: 'a', dir: 'L' }
    ]
  };

  const { warnings } = context.inlineBlock(branching, {});
  assert.ok(warnings.length, 'the collision was reported');
  assert.ok(warnings[0].includes('TM'), "and the message is the machine's own");
  assert.ok(warnings[0].includes('δ'), 'naming the rule that already exists');
});

test('a block that collides with nothing is placed quietly', () => {
  tmCanvas();
  const { warnings } = context.inlineBlock(seekBlank(), {});
  assert.deepEqual(warnings, []);
});

test('one collision is reported per edge, capped so a bad block is readable', () => {
  tmCanvas();
  const many = {
    ...seekBlank('noisy'),
    transitions: Array.from({ length: 8 }, (_, i) => ({
      id: 'e' + i, from: 'd1', to: 'd2', symbol: 'a', write: 'a', dir: 'R'
    }))
  };
  const { warnings } = context.inlineBlock(many, {});
  assert.ok(warnings.length > 0);
  assert.ok(warnings.length <= 3, 'the reader is not buried in the same complaint');
});

// ── outlining ─────────────────────────────────────────────────────

test('a placed block outlines back to a definition that places identically', () => {
  const App = tmCanvas();
  const placed = context.inlineBlock(seekBlank(), { x: 40, y: 40 }).block;
  const def = context.outlineBlock(placed.id);

  assert.ok(def, 'a definition came back');
  assert.equal(def.states.length, 2);
  // The instance prefix is stripped, so a round trip does not accumulate it.
  assert.deepEqual(def.states.map(s => s.name).sort(), ['done', 'scan']);
  assert.equal(def.exits.length, 1);
  assert.equal(def.exits[0].label, 'done');
  assert.deepEqual(context.validateBlockDefinition(def), []);

  // Place the outlined definition on a clean canvas and it is the same machine.
  tmCanvas();
  const again = context.inlineBlock(def, {}).block;
  assert.equal(context.blockMembers(again.id).length, 2);
  assert.equal(context.getState(again.entry).name, 'seek/scan');
});

test('a nested block outlines with its children intact', () => {
  tmCanvas();
  const placed = context.inlineBlock(nestedDefinition(), {}).block;
  const def = context.outlineBlock(placed.id);

  assert.equal(def.blocks.length, 2);
  assert.deepEqual(def.blocks.map(b => b.name).sort(), ['add', 'mul']);
  assert.ok(def.blocks.every(b => b.parent === null), 'children of the root rebase to top level');
  assert.deepEqual(context.validateBlockDefinition(def), []);

  tmCanvas();
  const again = context.inlineBlock(def, {}).block;
  assert.equal(context.blockSubtree(again.id).length, 3);
});

test('the machine on the canvas can be saved as a block, F becoming its exits', () => {
  const App = tmCanvas();
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'q0' },
    { id: 's2', x: 90, y: 0, name: 'halt' }
  ];
  App.stateN = 2;
  App.startId = 's1';
  App.accepts = new Set(['s2']);
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a', write: 'a', dir: 'R' }];
  App.transN = 1;

  const def = context.machineAsBlockDefinition({ name: 'step-right' });
  assert.equal(def.entry, 's1');
  assert.deepEqual(def.exits, [{ id: 's2', label: 'halt' }]);
  assert.deepEqual(context.validateBlockDefinition(def), []);
});

// ── removal and crossings ─────────────────────────────────────────

test('deleting a block takes its whole subtree with it', () => {
  const App = tmCanvas();
  const outer = context.inlineBlock(nestedDefinition(), {}).block;
  const bystander = context.inlineBlock(writeSymbol('#'), {}).block;

  assert.equal(context.removeBlock(outer.id), true);
  assert.equal(App.blocks.length, 1);
  assert.equal(App.blocks[0].id, bystander.id);
  assert.equal(App.states.length, 2, 'only the bystander\'s states are left');
  assert.ok(App.transitions.every(t => context.getState(t.from) && context.getState(t.to)));
});

test('crossings are split into entry, exit and stray', () => {
  const App = tmCanvas();
  const seek = context.inlineBlock(seekBlank(), {}).block;
  const outside = { id: 's99', x: 500, y: 0, name: 'after' };
  App.states.push(outside);

  App.transitions.push(exitEdge(seek.exits[0].id, outside.id));   // a real exit
  App.transitions.push(exitEdge(outside.id, seek.entry));          // a real entry
  const mid = context.blockMembers(seek.id).find(s => s.id !== seek.entry);
  App.transitions.push(exitEdge(outside.id, mid.id));              // into the middle

  const { incoming, outgoing, stray } = context.blockCrossings(seek.id);
  assert.equal(incoming.length, 1);
  assert.equal(outgoing.length, 1);
  assert.equal(stray.length, 1, 'an edge into the middle has no port to match');
});

// ── the DAG guard ─────────────────────────────────────────────────

test('a definition that would contain itself is refused', () => {
  const library = new Map();
  const alu = { name: 'ALU', blocks: [{ name: 'add', source: 'add' }] };
  const add = { name: 'add', blocks: [{ name: 'ALU', source: 'alu' }] };
  library.set('alu', alu);
  library.set('add', add);
  const resolve = key => library.get(key) || null;

  const cycle = context.blockDefinitionCycle(alu, 'alu', resolve);
  assert.ok(cycle, 'the cycle was found');
  assert.ok(cycle.length >= 2);

  // And a tree that does not close on itself is fine.
  library.set('add', { name: 'add', blocks: [] });
  assert.equal(context.blockDefinitionCycle(alu, 'alu', resolve), null);
});

test('an invalid definition is refused with a sentence, not a broken machine', () => {
  const App = tmCanvas();
  const before = App.states.length;
  assert.throws(
    () => context.inlineBlock({ name: 'x', states: [], transitions: [] }, {}),
    /at least one state/
  );
  assert.equal(App.states.length, before, 'and nothing was written');

  const dangling = { ...seekBlank(), entry: 'nope' };
  assert.ok(context.validateBlockDefinition(dangling).some(m => m.includes('Entry state')));
});
