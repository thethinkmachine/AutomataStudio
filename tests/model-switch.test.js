import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Switching model used to delete the machine whenever there were any states at
// all — including for switches that lose nothing, which is most of them. DFA and
// NFA have identical capability flags, so promoting a DFA to an NFA (about the
// most common single action in an automata course) destroyed the user's work to
// protect them from a conversion that had nothing to convert.
//
// The rule now: name what the target genuinely cannot express, and discard only
// that. Everything else survives, and a lossless switch does not even ask.

const harness = createHarness();
const { context } = harness;
const { App } = context;

function dfa() {
  harness.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [
    { id: 'q0', x: 0, y: 0, name: 'q0' },
    { id: 'q1', x: 100, y: 0, name: 'q1' }
  ];
  App.transitions = [{ id: 't1', from: 'q0', to: 'q1', symbol: 'a' }];
  App.startId = 'q0';
  App.accepts = new Set(['q1']);
  context.ensureRootComponent();
}

// ── what counts as a loss ─────────────────────────────────────────

test('DFA to NFA loses nothing — the capability sets are identical', () => {
  dfa();
  assert.deepEqual(context.machineSwitchLosses('DFA', 'NFA'), []);
});

test('a widening within the hierarchical family loses nothing', () => {
  dfa();
  App.machine = 'HSM';
  App.states.push({ id: 'R', x: 50, y: 0, name: 'Region', super: true, initial: 'q0' });
  App.states[0].parent = 'R';
  // HSM's capabilities are a strict subset of RSM's, so the picture is already
  // a valid RSM — which is what makes "extract this region as a sub-machine"
  // a reachable instruction rather than one that costs you the diagram.
  assert.deepEqual(context.machineSwitchLosses('HSM', 'RSM'), []);
});

test('a narrowing names only what the machine actually uses', () => {
  dfa();
  App.machine = 'NPDA';
  // No stack operations drawn yet, so nothing is lost despite NPDA having a
  // stack and DFA not: the question is what the PICTURE uses.
  assert.deepEqual(context.machineSwitchLosses('NPDA', 'DFA'), []);
  App.transitions[0].push = 'Z';
  assert.deepEqual(context.machineSwitchLosses('NPDA', 'DFA'), ['stack operations']);
});

test('losing regions and guards is reported separately', () => {
  dfa();
  App.machine = 'HSM';
  App.states.push({ id: 'R', x: 50, y: 0, name: 'Region', super: true, initial: 'q0' });
  App.states[0].parent = 'R';
  App.transitions[0].guard = 'armed';
  const lost = context.machineSwitchLosses('HSM', 'DFA');
  assert.ok(lost.includes('regions'));
  assert.ok(lost.includes('actions and guards'));
});

// ── what a switch actually does ───────────────────────────────────

test('a lossless switch keeps every state and transition', () => {
  dfa();
  context.setMachine('NFA');
  assert.equal(App.machine, 'NFA');
  assert.equal(App.states.length, 2, 'the machine is still there');
  assert.equal(App.transitions.length, 1);
  assert.equal(App.startId, 'q0');
});

// The narrowing path keeps the graph and drops the annotation — the old
// behaviour threw the whole machine away rather than decide what a DFA should
// do with a push.
test('a narrowing keeps the graph and strips only what cannot be expressed', () => {
  dfa();
  App.machine = 'NPDA';
  App.transitions[0].push = 'Z';
  App.transitions[0].pop = App.config.sym.eps;
  context.stripForMachine('DFA');
  assert.equal(App.states.length, 2, 'the states survive');
  assert.equal(App.transitions.length, 1, 'and so does the arrow');
  assert.equal(App.transitions[0].push, undefined);
  assert.equal(App.transitions[0].pop, undefined);
  assert.equal(App.transitions[0].symbol, 'a', 'what it reads is untouched');
});

// Regions are arrows in disguise, so narrowing out of a hierarchical model
// writes them out rather than deleting them: same language, more ink.
test('leaving a hierarchical model flattens the regions instead of dropping them', () => {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x', 'out']);
  App.states = [
    { id: 'R', x: 200, y: 200, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 140, y: 200, name: 'approach', parent: 'R' },
    { id: 'b', x: 260, y: 200, name: 'strike', parent: 'R' },
    { id: 'z', x: 600, y: 200, name: 'flee' }
  ];
  App.transitions = [
    { id: 't1', from: 'a', to: 'b', symbol: 'x' },
    { id: 't2', from: 'R', to: 'z', symbol: 'out' }
  ];
  App.startId = 'a';
  App.accepts = new Set(['z']);
  context.ensureRootComponent();

  context.stripForMachine('NFA');
  assert.ok(!App.states.some(s => s.super), 'no regions left');
  // The one arrow off the region became one arrow off each leaf inside it.
  const outArrows = App.transitions.filter(t => t.symbol === 'out');
  assert.equal(outArrows.length, 2,
    'that number is exactly the succinctness the region was buying');
});

// Guards are compiled into the state space the same way regions are compiled
// into arrows — so leaving a guarded model is a flattening too, not a strip.
test('narrowing out of a guarded model compiles the guards into states', () => {
  dfa();
  App.machine = 'HSM';
  App.flags = ['armed'];
  App.states.push({ id: 'q2', x: 200, y: 0, name: 'q2' });
  // Reachable both ways: 'b' arms the flag, and only then does 'a' fire.
  App.transitions = [
    { id: 't1', from: 'q0', to: 'q0', symbol: 'b', assign: 'armed' },
    { id: 't2', from: 'q0', to: 'q1', symbol: 'a', guard: 'armed' }
  ];
  context.stripForMachine('DFA');

  assert.deepEqual(App.flags, [], 'nothing reads them any more');
  assert.ok(!App.transitions.some(t => t.guard || t.assign),
    'no arrow still carries a condition the target model cannot evaluate');
  // q0 has split into one copy per valuation of `armed` — the guard has become
  // exactly the state it always secretly was.
  assert.ok(App.states.length > 2,
    'the flag was compiled into the state space, which is the only place a DFA can keep it');
});

test('a guarded arrow that can never fire is dropped, not silently kept', () => {
  dfa();
  App.machine = 'HSM';
  App.flags = ['armed'];
  App.transitions[0].guard = 'armed';   // nothing ever sets it
  context.stripForMachine('DFA');
  assert.equal(App.transitions.length, 0,
    'the guard is false on every reachable configuration, so the arrow is unreachable');
});
