import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The two constructions the hierarchical models rest on, and the only two in
// the app that were computed without ever being shown. flattenComponent fed
// machineTree(), compileToPDA fed the export IR, and neither had a card — so
// every claim the models make was true and unobservable at once, to the point
// that two shipped examples told the reader to "open the flattened view".
//
// These test the compute halves, which is the house pattern: the card renders
// what build*/run* returns, so the assertions belong on the return value.

const harness = createHarness();
const { context } = harness;
const { App } = context;

function regions() {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x', 'hurt', 'calm']);
  App.states = [
    { id: 'R', x: 200, y: 200, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 140, y: 200, name: 'approach', parent: 'R' },
    { id: 'b', x: 260, y: 200, name: 'strike', parent: 'R' },
    { id: 't', x: 600, y: 200, name: 'flee' }
  ];
  App.transitions = [
    { id: 't1', from: 'a', to: 'b', symbol: 'x' },
    { id: 't2', from: 'R', to: 't', symbol: 'hurt' },
    { id: 't3', from: 't', to: 'R', symbol: 'calm' }
  ];
  App.startId = 'a';
  App.accepts = new Set(['t']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
}

// ── HSM → NFA ─────────────────────────────────────────────────────

test('flattening reports the machine the picture denotes', () => {
  regions();
  const flat = context.buildFlattenedNFA();
  assert.ok(flat, 'a machine with regions has something to flatten');
  assert.ok(!flat.states.some(s => s.super), 'no containers survive');
  assert.equal(flat.machine, 'NFA', 'no ε-moves here, so it is an NFA not an ε-NFA');
});

// The number in the card IS the argument for statecharts: one arrow out of the
// region stood for one arrow out of every leaf inside it.
test('the one arrow off the region becomes one off each leaf', () => {
  regions();
  const flat = context.buildFlattenedNFA();
  const hurt = flat.transitions.filter(t => t.symbol === 'hurt');
  assert.equal(hurt.length, 2, 'approach and strike each get one');
  assert.ok(flat.expanded >= 1, 'and the card has a number to report for it');
});

test('an arrow into a region lands on its default entry', () => {
  regions();
  const flat = context.buildFlattenedNFA();
  const calm = flat.transitions.filter(t => t.symbol === 'calm');
  assert.equal(calm.length, 1);
  assert.equal(calm[0].to, 'a', 'the region\'s `initial`');
});

test('flattening is offered only where containment exists', () => {
  regions();
  App.machine = 'DFA';
  assert.equal(context.buildFlattenedNFA(), null);
});

test('loading the flattened NFA leaves a machine with no regions and no flags', () => {
  regions();
  App.flags = ['leftover'];
  context.loadFlattenedNFA();
  assert.equal(App.machine, 'NFA');
  assert.ok(!App.states.some(s => s.super || s.parent),
    'nothing on the canvas still claims to be contained');
  assert.deepEqual(App.flags, [],
    'the valuations are compiled into the states, so the declarations would double it for nothing');
});

// ── RSM → PDA ─────────────────────────────────────────────────────

function recursive() {
  harness.resetApp();
  App.machine = 'RSM';
  App.sigma = new Set(['(', ')']);
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'q0' },
    { id: 's2', x: 120, y: 0, name: 'call', callee: 'c1' },
    { id: 's3', x: 240, y: 0, name: 'q1' }
  ];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: '(' },
    { id: 't2', from: 's2', to: 's3', symbol: ')' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s3']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
  // The one component calls itself: the box's callee is the root.
  App.states[1].callee = App.rootComponentId;
  context.flushActiveComponent();
}

test('compiling produces a PDA whose stack is the call stack', () => {
  recursive();
  const pda = context.compileToPDA();
  assert.ok(pda, 'a machine with a start state compiles');
  assert.equal(pda.machine, 'NPDA');
  assert.ok(pda.stackAlpha.length > 0, 'the return addresses have to live somewhere');
  assert.ok(pda.states.length > App.states.length,
    'a box becomes two states — the call site and the point after the return');
});

test('a recursive component is what makes the stack unavoidable', () => {
  recursive();
  const tree = context.machineTree();
  assert.equal(context.recursiveComponents(tree).size, 1,
    'and that is exactly what the card reports, and why Inline as Region refuses');
});

test('loading the compiled PDA clears the component tree it compiled away', () => {
  recursive();
  context.loadCompiledPDA();
  assert.equal(App.machine, 'NPDA');
  assert.ok(!App.states.some(s => s.callee),
    'no call sites left pointing at components that no longer exist');
});
