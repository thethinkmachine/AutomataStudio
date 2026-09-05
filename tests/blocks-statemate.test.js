// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// Blocks through the candidate pipeline.
//
// StateMate and the wizard share one route from a described machine to a
// machine on the canvas — draftToSpec/parseTurn → validateSpec → compileSpec →
// lintCandidate → applyCandidate — and the whole of what that route promises is
// that an edit keeps what it did not touch. It kept ids, coordinates, curves
// and anchored notes, and it silently destroyed the block hierarchy: compileSpec
// built fresh `{id, name}` states carrying no `blockId`, so blockIsIntact()
// failed on every record and pruneBlocks() dropped the lot. A *no-op* round trip
// emptied App.blocks and reset App.scope, on a machine nobody had asked to
// change.
//
// The rule these tests pin: **absent means unchanged**, the rule the four
// `App.config.render` flags follow. A spec that says nothing about the
// hierarchy has not asked for it to go.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

const harness = createHarness();
const BLANK = '⊔';

/** A TM with a top-level state, a block B, and a block C nested inside it. */
function nested() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.states = [
    { id: 'u', name: 'u', x: 0, y: 0 },
    { id: 'm1', name: 'B/m1', x: 0, y: 200, blockId: 'B' },
    { id: 'm2', name: 'B/m2', x: 120, y: 200, blockId: 'B' },
    { id: 'c1', name: 'B/C/c1', x: 0, y: 400, blockId: 'C' },
    { id: 'c2', name: 'B/C/c2', x: 120, y: 400, blockId: 'C' }
  ];
  App.blocks = [
    { id: 'B', name: 'B', parent: null, entry: 'm1', exits: [{ id: 'm2', label: 'done' }], x: 200, y: 100 },
    { id: 'C', name: 'C', parent: 'B', entry: 'c1', exits: [{ id: 'c2', label: 'done' }], x: 200, y: 300 }
  ];
  App.startId = 'u';
  App.transitions = [
    { id: 't1', from: 'u', to: 'm1', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 'm1', to: 'c1', symbol: 'b', write: 'b', dir: 'R' },
    { id: 't3', from: 'c1', to: 'c2', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't4', from: 'c2', to: 'm2', symbol: 'b', write: 'b', dir: 'R' }
  ];
  App.blockN = 0;
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  return App;
}

/** The pipeline as StateMate and the wizard both run it. */
function roundTrip(spec = context.machineToSpec()) {
  const { candidate } = context.compileSpec(spec);
  context.lintCandidate(candidate);
  context.applyCandidate(candidate);
  return candidate;
}

test('a no-op round trip leaves the hierarchy exactly as it was', () => {
  const App = nested();
  App.scope = ['B'];
  const before = JSON.stringify(App.blocks);

  roundTrip();

  assert.equal(JSON.stringify(context.App.blocks), before,
    'the block records are the ones that went in');
  assert.deepEqual(context.App.states.map(s => s.blockId ?? null),
    [null, 'B', 'B', 'C', 'C'],
    'every state is still in the block it was in');
  assert.deepEqual(context.liveScope(), ['B'],
    'and the reader is still standing where they were');
});

test('the records survive being read back through the validator', () => {
  // The wizard's own assertion — machineToSpec() must round-trip through
  // validateSpec() — so anything the compiler needs has to survive the gate.
  const App = nested();
  const spec = context.validateSpec(context.machineToSpec(), { fallbackMachine: App.machine });
  roundTrip(spec);
  assert.equal(context.liveBlocks().length, 2);
  assert.deepEqual(context.blockMembers('C').map(s => s.id), ['c1', 'c2']);
});

test('an edit that adds a state leaves the blocks alone and puts it on top', () => {
  nested();
  const spec = context.machineToSpec();
  spec.states.push({ name: 'trap', start: false, accept: false });
  spec.transitions.push({ from: 'trap', to: 'trap', on: 'a', write: 'a', move: 'R' });

  roundTrip(spec);

  assert.equal(context.liveBlocks().length, 2, 'both blocks still stand');
  const trap = context.App.states.find(s => s.name === 'trap');
  assert.ok(trap, 'the new state arrived');
  assert.equal(trap.blockId ?? null, null,
    'and it is at the top level — the model said nothing about a container');
});

test('a block whose states are deleted is reported by the diff', () => {
  // The diff is where both sides are in hand, which is why blocks are answered
  // there and not in the linter -- that pass is handed the candidate alone,
  // deliberately, so it can lint a machine that is not on the canvas.
  nested();
  const spec = context.machineToSpec();
  spec.states = spec.states.filter(s => !s.name.startsWith('B/C/'));
  spec.transitions = spec.transitions.filter(t => !/B\/C\//.test(t.from + t.to));

  const { candidate, diff } = context.compileSpec(spec);
  context.applyCandidate(candidate);

  assert.deepEqual(context.liveBlocks().map(b => b.id), ['B'], 'C is gone, B stands');
  assert.deepEqual(diff.blocksRemoved, ['B/C'], 'named by path, not by its local name');
  assert.equal(diff.unchanged, false, 'and an edit that only drops a block is not "unchanged"');
  assert.ok(diff.lines.some(l => l.op === '-' && l.kind === 'block' && /B\/C/.test(l.text)),
    'so it reaches the card the reader actually looks at');
});

test('a stale record the compiler had to carry is named by the linter', () => {
  // The other half, and the one the linter can see on its own: with no `blocks`
  // in the spec the records are carried forward verbatim, so a candidate can
  // arrive holding one whose entry it also deleted.
  nested();
  const spec = context.machineToSpec();
  delete spec.blocks;                       // absent means unchanged
  spec.states = spec.states.filter(s => !s.name.startsWith('B/C/'));
  spec.transitions = spec.transitions.filter(t => !/B\/C\//.test(t.from + t.to));

  const { candidate } = context.compileSpec(spec);
  const { findings, warnings } = context.lintCandidate(candidate);
  context.applyCandidate(candidate);

  assert.deepEqual(context.liveBlocks().map(b => b.id), ['B'], 'pruned on read, as ever');
  const said = findings.find(f => f.rule === 'block-dissolved');
  assert.ok(said, 'the linter named it');
  assert.equal(said.severity, 'warn', 'and did not block the edit for it');
  assert.match(said.message, /\bC\b/);
  assert.ok(warnings.includes(said), 'so it reaches resultNotes');
});

test('a declared block the model left alone keeps its id, its box and its ports', () => {
  // Matched by path, which is the block-shaped version of matching a state by
  // name: the record survives, and with the id go the box the reader drew, the
  // tab they placed and anything else anchored to it.
  const App = nested();
  App.blocks[0].w = 240;
  App.blocks[0].ports = { __in__: { dx: -40, dy: 12 } };

  const spec = context.machineToSpec();
  assert.deepEqual(spec.blocks.map(b => b.name), ['B', 'B/C'],
    'a block is addressed by path, because a name is unique among siblings only');
  assert.equal(spec.blocks[1].parent, 'B');
  assert.equal(spec.states.find(s => s.name === 'B/C/c1').block, 'B/C');

  const { candidate, diff } = context.compileSpec(spec);
  const b = candidate.blocks.find(x => x.id === 'B');
  assert.equal(b.name, 'B', 'a record keeps its *local* name; the path is derived');
  assert.equal(b.w, 240, 'the box the reader drew it at');
  assert.deepEqual(b.ports, { __in__: { dx: -40, dy: 12 } }, 'and the tab they placed');
  const c = candidate.blocks.find(x => x.id === 'C');
  assert.equal(c.name, 'C');
  assert.equal(c.parent, 'B');
  assert.deepEqual([diff.blocksAdded, diff.blocksRemoved], [[], []]);
});

test('a block the model adds is minted, and its members follow it', () => {
  nested();
  const spec = context.machineToSpec();
  spec.blocks.push({ name: 'D', parent: null, entry: 'u', exits: [] });
  spec.states.find(s => s.name === 'u').block = 'D';

  const { candidate, diff } = context.compileSpec(spec);
  const d = candidate.blocks.find(x => x.name === 'D');
  assert.ok(d && d.id !== 'B' && d.id !== 'C', 'a fresh id, off the workspace counter');
  assert.equal(d.entry, 'u', 'resolved from the state name the spec used');
  assert.equal(candidate.states.find(s => s.name === 'u').blockId, d.id);
  assert.deepEqual(diff.blocksAdded, ['D']);
});

test('a block naming a state the machine does not have is refused', () => {
  nested();
  const spec = context.machineToSpec();
  spec.blocks[0].entry = 'nowhere';
  assert.throws(() => context.validateSpec(spec, { fallbackMachine: 'TM' }), /entry/);
});

test('two blocks that contain each other are refused', () => {
  nested();
  const spec = context.machineToSpec();
  spec.blocks = [
    { name: 'B', parent: 'B/C', entry: 'B/m1', exits: [] },
    { name: 'B/C', parent: 'B', entry: 'B/C/c1', exits: [] }
  ];
  assert.throws(() => context.validateSpec(spec, { fallbackMachine: 'TM' }), /contain each other/);
});

test('a machine with no stay move is never given blocks', () => {
  // machineSupportsBlocks is declared on the turing family: a machine that
  // cannot leave a block without eating a symbol cannot have one, because
  // inlining would change the language.
  nested();
  const spec = context.machineToSpec();
  const dfa = context.validateSpec({
    ...spec,
    machine: 'DFA',
    transitions: spec.transitions.map(t => ({ from: t.from, to: t.to, on: 'a' }))
  }, { fallbackMachine: 'DFA' });
  assert.equal(dfa.blocks, undefined);
  assert.ok(dfa.states.every(s => s.block === undefined));
});

test('dropping a parent takes its children, and the scope comes back out', () => {
  const App = nested();
  App.scope = ['B', 'C'];
  const spec = context.machineToSpec();
  spec.states = spec.states.filter(s => !s.name.startsWith('B/'));
  spec.transitions = spec.transitions.filter(t => !/B\//.test(t.from + t.to));

  roundTrip(spec);

  assert.deepEqual(context.liveBlocks(), [], 'pruned to a fixed point');
  assert.deepEqual(context.liveScope(), [], 'and the reader is at the top level');
});

test('a machine-type change starts clean rather than half-inheriting', () => {
  // The rule compileSpec already states for ids, positions and curves. A block
  // is a grouping over a machine, and the machine is a different object now --
  // so neither the carried records nor a declared list survives the switch.
  nested();
  const spec = context.machineToSpec();
  spec.machine = 'DFA';
  spec.transitions = spec.transitions.map(t => ({ from: t.from, to: t.to, on: 'a' }));

  const { candidate } = context.compileSpec(spec);
  assert.deepEqual(candidate.blocks, []);
  assert.ok(candidate.states.every(s => s.blockId === undefined));
});
