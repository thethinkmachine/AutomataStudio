// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// What StateMate is looking at when the reader is inside a block.
//
// A drill-in changed what the reader could see and nothing about what the model
// was shown: `machineToSpec()` sent `App.states` — every state at every depth —
// so asking why the adder rejects a word handed the model the whole processor
// with no way to tell which forty states were the adder. The console said so
// out loud, offering "614 states, 19191 transitions" while eight were on screen.
//
// The subject follows the scope now. Two halves, and the second is the one that
// is dangerous to leave out:
//
//   * **the read half** — the spec is cut to the block and everything under it,
//     plus a boundary saying how it is reached, without which it is a
//     disconnected fragment for the same reason a drilled-in view without ports
//     would be
//   * **the write half** — the diff is bounded to the same subtree. Unbounded, a
//     spec naming only the block's states is an edit that removed every state
//     outside it, so asking a question about the adder would delete the
//     processor around it, silently, in one undoable step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

const harness = createHarness();
const BLANK = '⊔';
const ANY = 'Σ';

// h0 → ALU/ADD → h1, with ADD holding a nested block of its own.
function cpu() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.states = [
    { id: 'h0', name: 'h0', x: -300, y: 0 },
    { id: 'h1', name: 'h1', x: 400, y: 0 },
    { id: 'a1', name: 'ALU/route', x: 0, y: 0, blockId: 'ALU' },
    { id: 'd1', name: 'ALU/ADD/scan', x: 100, y: 100, blockId: 'ADD' },
    { id: 'd2', name: 'ALU/ADD/done', x: 200, y: 100, blockId: 'ADD' },
    { id: 'c1', name: 'ALU/ADD/CARRY/bit', x: 300, y: 200, blockId: 'CARRY' }
  ];
  App.blocks = [
    { id: 'ALU', name: 'ALU', parent: null, entry: 'a1', exits: [{ id: 'a1', label: 'out' }], x: 0, y: 0 },
    { id: 'ADD', name: 'ADD', parent: 'ALU', entry: 'd1', exits: [{ id: 'd2', label: 'sum' }], x: 100, y: 60 },
    { id: 'CARRY', name: 'CARRY', parent: 'ADD', entry: 'c1', exits: [{ id: 'c1', label: 'c' }], x: 300, y: 160 }
  ];
  App.startId = 'h0';
  App.accepts = new Set(['h1']);
  App.transitions = [
    { id: 't1', from: 'h0', to: 'a1', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't2', from: 'a1', to: 'd1', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't3', from: 'd1', to: 'c1', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't4', from: 'c1', to: 'd2', symbol: 'b', write: 'b', dir: 'R' },
    { id: 't5', from: 'd2', to: 'h1', symbol: ANY, write: ANY, dir: 'S' }
  ];
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  return App;
}

const at = scope => { context.App.scope = scope; context.invalidateViewGraph(); };

// ── the read half ─────────────────────────────────────────────────

test('at the top level nothing changes: the whole machine is the subject', () => {
  cpu();
  at([]);
  assert.equal(context.scopedSource(), null, 'no scope, no cut');
  assert.equal(context.machineToSpec().states.length, 6);
});

test('inside a block the subject is that block and everything under it', () => {
  cpu();
  at(['ALU', 'ADD']);
  const src = context.scopedSource();
  assert.deepEqual(src.states.map(s => s.id).sort(), ['c1', 'd1', 'd2'],
    'ADD, and CARRY nested inside it — not the ALU above, not the host');
  assert.deepEqual(src.transitions.map(t => t.id).sort(), ['t3', 't4'],
    'only the edges with both ends inside');
  assert.equal(src.startId, 'd1', 'control arrives at the entry, not at the machine start');
  assert.deepEqual(src.accepts, [], 'h1 is not under this block');
});

test('the cut spec carries how the block is reached', () => {
  // Without it, it is a disconnected fragment — you see the sub-machine and
  // nothing about how it is entered, which is most of what a question about it
  // turns on. Same reason a drilled-in view draws ports.
  cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  assert.equal(spec.states.length, 3);
  assert.equal(spec.scope.path, 'ALU/ADD');
  assert.equal(spec.scope.entry, 'ALU/ADD/scan');
  assert.deepEqual(spec.scope.exits, [{ state: 'ALU/ADD/done', label: 'sum' }]);
  assert.deepEqual(spec.scope.crossings.in, [{ from: 'ALU/route', to: 'ALU/ADD/scan' }]);
  assert.deepEqual(spec.scope.crossings.out, [{ from: 'ALU/ADD/done', to: 'h1' }]);
});

test('the prompt names the block, and says the machine around it is off the table', () => {
  cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  const msg = context.buildUserMessage({ prompt: 'why does this reject aab?', intent: 'edit', canvasSpec: spec });
  assert.match(msg, /THE BLOCK THE READER IS INSIDE — "ALU\/ADD"/);
  assert.match(msg, /ITS BOUNDARY/);
  assert.match(msg, /Control enters this block at "ALU\/ADD\/scan"/);
  assert.match(msg, /cannot change them/);
  assert.doesNotMatch(msg, /THE MACHINE CURRENTLY ON THE CANVAS/);
});

test('a whole-machine turn is worded exactly as it always was', () => {
  cpu();
  at([]);
  const msg = context.buildUserMessage({ prompt: 'add a trap', intent: 'edit', canvasSpec: context.machineToSpec() });
  assert.match(msg, /THE MACHINE CURRENTLY ON THE CANVAS/);
  assert.doesNotMatch(msg, /ITS BOUNDARY/);
});

// ── the write half ────────────────────────────────────────────────

test('a scoped edit governs the block and leaves the machine around it', () => {
  // The hazard, and it is silent and total: a spec naming only the block's
  // states, diffed against the whole machine, is an edit that removed
  // everything else.
  const App = cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  spec.states.push({ name: 'ALU/ADD/extra', start: false, accept: false, block: 'ALU/ADD' });
  spec.transitions.push({ from: 'ALU/ADD/done', to: 'ALU/ADD/extra', on: 'a', write: 'a', move: 'R' });

  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot(),
    { scope: { subtree: context.blockSubtree('ADD') } });

  const names = candidate.states.map(s => s.name).sort();
  assert.ok(names.includes('h0') && names.includes('h1') && names.includes('ALU/route'),
    'the machine around the block survived');
  assert.ok(names.includes('ALU/ADD/extra'), 'and the edit landed');
  assert.equal(candidate.startId, 'h0', 'q0 is the machine’s, not the block’s entry');
  assert.deepEqual(candidate.accepts, ['h1'], 'and so is F');
});

test('the crossing edges survive, and only while both ends do', () => {
  cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot(),
    { scope: { subtree: context.blockSubtree('ADD') } });
  const byName = new Map(candidate.states.map(s => [s.id, s.name]));
  const pairs = candidate.transitions.map(t => `${byName.get(t.from)}→${byName.get(t.to)}`);
  assert.ok(pairs.includes('ALU/route→ALU/ADD/scan'), 'the way in');
  assert.ok(pairs.includes('ALU/ADD/done→h1'), 'and the way out');
  assert.ok(pairs.includes('h0→ALU/route'), 'and the machine outside is untouched');
});

test('a crossing whose inside end the model deleted is dropped, not left dangling', () => {
  // The outside end was never shown and cannot have moved; the inside end may
  // well be gone, and an endpoint naming nothing is saved to the file, counted
  // in the δ list and drawn nowhere.
  cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  spec.states = spec.states.filter(s => s.name !== 'ALU/ADD/done');
  spec.transitions = spec.transitions.filter(t => !/done/.test(t.from + t.to));

  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot(),
    { scope: { subtree: context.blockSubtree('ADD') } });
  const live = new Set(candidate.states.map(s => s.id));
  assert.ok(candidate.transitions.every(t => live.has(t.from) && live.has(t.to)),
    'every endpoint resolves to a state the machine has');
  assert.ok(!candidate.states.some(s => s.name === 'ALU/ADD/done'));
  assert.ok(candidate.states.some(s => s.name === 'h1'), 'the host is still whole');
});

test('the nested block under the one being edited keeps its records', () => {
  cpu();
  at(['ALU', 'ADD']);
  const spec = context.machineToSpec(context.scopedSource());
  assert.deepEqual(spec.blocks.map(b => b.name), ['ALU/ADD', 'ALU/ADD/CARRY'],
    'the subtree, by path, and nothing above it');
  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot(),
    { scope: { subtree: context.blockSubtree('ADD') } });
  context.applyCandidate(candidate);
  assert.deepEqual(context.liveBlocks().map(b => b.id).sort(), ['ADD', 'ALU', 'CARRY'],
    'including the ALU the edit never mentioned');
});

// ── the console says which of the two it is doing ─────────────────

test('the chip reports what is attached, not how big the machine is', () => {
  cpu();
  at([]);
  context.renderStateMateStatus?.();
  assert.equal(context.scopedSource(), null);

  at(['ALU', 'ADD']);
  const src = context.scopedSource();
  assert.equal(src.states.length, 3, 'three, not six — and the chip reads this');
  assert.equal(src.scope.path, 'ALU/ADD');
});

// ── the agent takes the same cut ──────────────────────────────────
//
// Agentic mode was the one route past the write half. The model was prompted
// with the block (`scopedSource`), and its tools edited a draft built from the
// *whole* machine and compiled against it with no scope — so the two halves
// disagreed about what "this machine" meant, and one `replace_candidate_from_-
// spec` carrying the block it had been shown was the deletion this file exists
// to prevent.

const scopeArg = id => ({ subtree: context.blockSubtree(id), source: context.scopedSource() });

test('an agent session is shown the same block the prompt was', () => {
  cpu();
  at(['ALU', 'ADD']);
  const session = context.createAgentSession(context.currentMachineSnapshot(),
    { intent: 'edit', scope: scopeArg('ADD') });
  const names = session.draft.states.map(s => s.name).sort();
  assert.deepEqual(names, ['ALU/ADD/CARRY/bit', 'ALU/ADD/done', 'ALU/ADD/scan'],
    'the draft is the cut, not the processor around it');
  assert.equal(session.base.states.length, 6,
    'while the base stays whole, because that is what the remainder is carried from');
});

test('an agent rewriting the block it was shown does not delete the machine', () => {
  const App = cpu();
  at(['ALU', 'ADD']);
  const session = context.createAgentSession(context.currentMachineSnapshot(),
    { intent: 'edit', scope: scopeArg('ADD') });

  // What `replace_candidate_from_spec` does: the whole draft, swapped out for a
  // spec naming only what the model was shown.
  session.draft = { ...context.machineToSpec(context.scopedSource()), tests: [], title: 't', blurb: '', caveat: '', notes: [] };
  const results = context.executeAgentToolCalls(
    [{ id: 'c1', name: 'get_candidate', args: {} }], session, { authority: 'auto' });
  assert.equal(results.length, 1, 'the tool round ran');

  const names = session.candidate.states.map(s => s.name).sort();
  assert.ok(names.includes('h0') && names.includes('h1') && names.includes('ALU/route'),
    'the machine around the block is still there');
  assert.equal(session.candidate.startId, 'h0');
});

test('at the top level an agent session is the whole machine, as before', () => {
  cpu();
  at([]);
  const session = context.createAgentSession(context.currentMachineSnapshot(), { intent: 'edit' });
  assert.equal(session.scope, null);
  assert.equal(session.draft.states.length, 6);
});

// ── absent means unchanged; empty means empty ─────────────────────

test('a spec that says nothing about blocks keeps them', () => {
  cpu();
  at([]);
  const spec = context.machineToSpec();
  delete spec.blocks;
  spec.states.forEach(s => { delete s.block; });
  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot());
  assert.equal(candidate.blocks.length, 3, 'absent is not a request to dissolve');
});

test('an empty blocks list is a request, not an absence', () => {
  // `blocks: []` is the only way for a model to say "no hierarchy any more",
  // and read as "unchanged" it was a request the dialect could not express: the
  // records were handed straight back and the reader watched a dissolve they
  // had asked for silently not happen.
  cpu();
  at([]);
  const spec = context.validateSpec({ ...context.machineToSpec(), blocks: [] });
  assert.deepEqual(spec.blocks, [], 'the declaration survives validation');
  assert.ok(spec.states.every(s => s.block === undefined),
    'and no state is left naming a container that is gone');

  const { candidate } = context.compileSpec(spec, context.currentMachineSnapshot());
  assert.deepEqual(candidate.blocks, [], 'the hierarchy goes');
  assert.equal(candidate.states.length, 6, 'and not one state with it');
});
