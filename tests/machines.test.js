import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, getElement } from './harness.js';

// The machine registry, and the reason it exists.
//
// Every question the app asks about a machine — how it reads its input,
// what its transitions carry, how it decides a word, what its tuple is,
// whether a second edge on the same symbol is a branch or a mistake — used
// to be answered by an if-chain over App.machine, in a different file per
// question, each ending in a silent `else`. A machine type added to
// MachineTypes and wired into only four of them did not fail: it ran as a
// Turing machine in the player, reported a DFA's tuple in the panel, and
// offered a queue's fields in the editor.
//
// This file is what makes that impossible. It walks MachineTypes rather
// than a list written here, so a machine added to js/state.js fails these
// tests until it has a definition, and a definition that answers half the
// questions fails them until it answers the rest.

const h = createHarness();
const ctx = h.context;

const ALL = () => Object.keys(ctx.MachineTypes);

const FAMILIES = new Set(['finite', 'twoway', 'weighted', 'omega', 'pushdown', 'turing', 'transducer']);

// A one-state machine of the given type, accepting, with a self-loop on
// every field the type carries. Enough for every simulator and decider to
// run end to end without being about any particular language.
function trivial(type) {
  h.resetApp();
  const { App } = ctx;
  App.machine = type;
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['Z', 'A']);
  App.outputAlpha = new Set(['x']);
  ctx.normalizeBoundarySymbolsForMachine(type);
  App.states = [{ id: 's1', x: 100, y: 100, name: 'q0', output: 'x', priority: 0 }];
  App.startId = 's1';
  App.accepts = new Set(['s1']);
  const fields = ctx.transitionFieldsOf(type);
  const t = { id: 't1', from: 's1', to: 's1', symbol: 'a' };
  if (fields.includes('write')) t.write = 'a';
  if (fields.includes('move')) t.dir = 'R';
  if (fields.includes('pop')) { t.pop = App.config.sym.eps; t.push = App.config.sym.eps; }
  if (fields.includes('pop2')) { t.pop2 = App.config.sym.eps; t.push2 = App.config.sym.eps; }
  if (fields.includes('out')) t.output = 'x';
  if (fields.includes('weight')) t.weight = 1;
  if (fields.includes('tapeSyms')) {
    const k = App.tapeCount;
    t.tapeSyms = Array(k).fill('a');
    t.tapeWrites = Array(k).fill('a');
    t.tapeDirs = Array(k).fill('R');
  }
  App.transitions = [t];
  return App;
}

// ══════════════════════════════════════════════════════════════════
//  COMPLETENESS
// ══════════════════════════════════════════════════════════════════

test('every machine the picker offers has a definition', () => {
  const missing = ALL().filter(m => !ctx.hasMachineDef(m));
  assert.deepEqual(missing, [],
    'a machine in MachineTypes with no defineMachine call under js/machines/ ' +
    'is a machine that would fall through to whatever the last branch was');
});

test('every definition names a machine the picker knows', () => {
  const known = new Set(ALL());
  const orphans = ctx.machineIds().filter(id => !known.has(id));
  assert.deepEqual(orphans, [], 'a definition for a type MachineTypes has no row for is unreachable');
});

test('every definition answers all of what a machine is', () => {
  for (const m of ALL()) {
    const def = ctx.machineDef(m);
    assert.ok(FAMILIES.has(def.family), `${m}: unknown family "${def.family}"`);
    assert.equal(typeof def.simulate, 'function', `${m}: no simulator`);
    assert.equal(typeof def.decide, 'function', `${m}: no decider`);
    assert.ok(Array.isArray(def.schema?.transitionFields), `${m}: no transition fields`);
    assert.ok(Array.isArray(def.schema?.stateFields), `${m}: no state fields`);
    assert.ok(Array.isArray(def.schema?.alphabetFields), `${m}: no alphabet fields`);
    assert.equal(typeof def.formal?.tuple, 'function', `${m}: no tuple`);
    assert.equal(typeof def.formal?.delta, 'function', `${m}: no δ signature`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  THE SCHEMA AGREES WITH THE CAPABILITY FLAGS
// ══════════════════════════════════════════════════════════════════
// Two descriptions of one machine: MachineTypes says what it *can* do, the
// definition says what its transitions *carry*. They are separate on
// purpose — a flag is a capability and a field is a form row — but they
// cannot disagree, or a machine has a stack it cannot be given a pop for.

test('a machine with a store carries the fields to use it', () => {
  for (const m of ALL()) {
    const cfg = ctx.MachineTypes[m];
    const fields = ctx.transitionFieldsOf(m);
    if (cfg.hasTape) {
      assert.ok(fields.includes('write') || fields.includes('tapeSyms'),
        `${m}: hasTape but nothing to write with`);
    } else if (cfg.hasStack) {
      assert.ok(fields.includes('pop') && fields.includes('push'),
        `${m}: hasStack but no pop/push`);
    }
  }
});

test('a transducer emits from exactly one end', () => {
  for (const m of ALL()) {
    const onEdge = ctx.transitionFieldsOf(m).includes('out');
    const onState = ctx.stateFieldsOf(m).includes('out');
    if (!ctx.MachineTypes[m].isTransducer) {
      assert.ok(!onEdge && !onState, `${m}: not a transducer but carries an output field`);
      continue;
    }
    assert.ok(onEdge !== onState,
      `${m}: a transducer labels its states or its edges, never both and never neither`);
  }
});

test('a weighted machine carries its weights', () => {
  for (const m of ALL()) {
    assert.equal(ctx.transitionFieldsOf(m).includes('weight'), !!ctx.MachineTypes[m].isWeighted, m);
  }
});

test('a parity machine carries priorities instead of an accepting set', () => {
  for (const m of ALL()) {
    const fields = ctx.stateFieldsOf(m);
    ctx.App.machine = m;
    if (ctx.usesParityPriorities(m)) {
      assert.ok(fields.includes('priority') && !fields.includes('accept'),
        `${m}: α is a priority function, so there is no F to mark`);
    } else {
      assert.ok(fields.includes('accept') && !fields.includes('priority'), m);
    }
  }
});

test('the alphabets a machine declares are the ones it has', () => {
  for (const m of ALL()) {
    const cfg = ctx.MachineTypes[m];
    const alpha = ctx.alphabetFieldsOf(m);
    assert.ok(alpha.includes('sigma'), `${m}: every machine reads an input alphabet`);
    assert.equal(alpha.includes('stackAlpha'), !!cfg.hasStack, `${m}: Γ`);
    assert.equal(alpha.includes('outputAlpha'), !!cfg.isTransducer, `${m}: Δ`);
    assert.equal(alpha.includes('tapeCount'), ctx.isMultiTape(m), `${m}: k`);
  }
});

test('where a machine emits is one fact, however it is asked', () => {
  for (const m of ALL()) {
    trivial(m);
    const onState = ctx.hasStateOutput(m);
    assert.equal(onState, ctx.stateFieldsOf(m).includes('out'), `${m}: predicate vs schema`);
    assert.equal(ctx.hasTransitionOutput(m), ctx.transitionFieldsOf(m).includes('out'), m);
    // The export IR carries its own copy, because everything downstream of
    // buildMachineIR() consumes only the IR. A copy is a thing that drifts,
    // so it is pinned here rather than trusted.
    assert.equal(ctx.buildMachineIR().hasStateOutput, onState,
      `${m}: the IR disagrees with the machine about which end emits`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  DETERMINISM IS ONE ANSWER, NOT TWO
// ══════════════════════════════════════════════════════════════════

test('the editor refuses a second edge exactly when δ is single-valued', () => {
  for (const m of ALL()) {
    ctx.App.machine = m;
    assert.equal(!!ctx.machineDeterminism(m), ctx.hasSingleValuedDelta(m),
      `${m}: a machine whose δ is single-valued must have a rule that says so, ` +
      `and one whose δ branches must not have one`);
  }
});

test('a determinism rule reports the clash it found', () => {
  for (const m of ALL()) {
    const rule = ctx.machineDeterminism(m);
    if (!rule) continue;
    const App = trivial(m);
    const candidate = { ...App.transitions[0], from: 's1', symbol: 'a' };
    const conflict = rule.conflict(candidate, null);
    assert.ok(conflict, `${m}: an identical second edge must clash`);
    assert.match(rule.say(candidate, conflict), /\S/, `${m}: a refusal has to say something`);
    assert.equal(rule.conflict(candidate, 't1'), null,
      `${m}: editing an edge must not find that edge as its own conflict`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  EVERY MACHINE RUNS AND DECIDES
// ══════════════════════════════════════════════════════════════════
// The smoke test the old dispatch could not have: it walks the picker, so
// a machine wired into the batch tester but not the player — or into
// neither — is caught here rather than by a reader clicking Run.

test('every machine parses its own input format', () => {
  for (const m of ALL()) {
    trivial(m);
    const raw = ctx.MachineTypes[m].isOmega ? 'a(a)' : 'aa';
    const parsed = ctx.parseMachineInput(m, raw);
    assert.ok(parsed.ok, `${m}: cannot read "${raw}" — ${parsed.error}`);
    assert.notEqual(parsed.input, undefined, `${m}: parsed nothing`);
  }
});

test('every machine decides a word three-valued', () => {
  for (const m of ALL()) {
    trivial(m);
    const raw = ctx.MachineTypes[m].isOmega ? 'a(a)' : 'aa';
    const parsed = ctx.parseMachineInput(m, raw);
    const result = ctx.decideMachine(m, parsed.input);
    assert.ok(['acc', 'rej', 'unk'].includes(result.verdict),
      `${m}: verdict was ${JSON.stringify(result.verdict)}`);
  }
});

test('every machine simulates a word into steps', () => {
  for (const m of ALL()) {
    const App = trivial(m);
    const raw = ctx.MachineTypes[m].isOmega ? 'a(a)' : 'aa';
    const parsed = ctx.parseMachineInput(m, raw);
    ctx.simulateMachine(m, parsed.input);
    assert.ok(App.simSteps.length > 0, `${m}: a run produced no steps`);
    assert.ok(App.simSteps.every(s => typeof s.note === 'string'),
      `${m}: every step has to say what happened`);
  }
});

test('the batch tester answers for every machine', () => {
  for (const m of ALL()) {
    trivial(m);
    const raw = ctx.MachineTypes[m].isOmega ? 'a(a)' : 'aa';
    const batch = ctx.computeBatchResults([raw]);
    assert.equal(batch.results.length, 1, m);
    assert.ok(!batch.results[0].error, `${m}: could not read its own input format`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  THE FORMAL DEFINITION
// ══════════════════════════════════════════════════════════════════

test('every machine has a tuple and a δ signature', () => {
  for (const m of ALL()) {
    trivial(m);
    const tuple = ctx.langTupleSyms();
    assert.ok(tuple.length >= 4, `${m}: tuple is ${tuple.join(', ')}`);
    assert.ok(tuple.includes('Q') && tuple.includes('Σ') && tuple.includes('δ') && tuple.includes('q₀'),
      `${m}: every machine has states, an alphabet, a transition function and a start state`);
    assert.match(ctx.langDeltaSignature(), /→/, `${m}: δ's signature has to be an arrow`);
  }
});

test('a machine with a store names it in the tuple', () => {
  for (const m of ALL()) {
    trivial(m);
    const tuple = ctx.langTupleSyms();
    const cfg = ctx.MachineTypes[m];
    if (cfg.hasStack || cfg.hasTape) {
      assert.ok(tuple.some(s => s.startsWith('Γ')), `${m}: has a store, names no Γ`);
    }
    if (cfg.isTransducer) {
      assert.ok(tuple.includes('Δ') && tuple.includes('λ'), `${m}: emits, names no Δ/λ`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════
//  THE FAMILY PREDICATES READ THE REGISTRY
// ══════════════════════════════════════════════════════════════════

test('the family predicates and the registry are the same answer', () => {
  for (const m of ALL()) {
    assert.equal(ctx.isAnyTM(m), ctx.machineFamily(m) === 'turing', m);
    assert.equal(ctx.isAnyPDA(m), ctx.machineFamily(m) === 'pushdown', m);
    assert.equal(ctx.isOmegaAutomaton(m), ctx.machineFamily(m) === 'omega', m);
    assert.equal(ctx.isWeightedFA(m), ctx.machineFamily(m) === 'weighted', m);
  }
});

// ══════════════════════════════════════════════════════════════════
//  NOTHING WRITES THE CANVAS BY BEING ASKED A QUESTION
// ══════════════════════════════════════════════════════════════════

test('deciding a word leaves the machine exactly as it was', () => {
  for (const m of ALL()) {
    trivial(m);
    const before = JSON.stringify(ctx.exportWorkspaceState());
    const raw = ctx.MachineTypes[m].isOmega ? 'a(a)' : 'aa';
    ctx.decideMachine(m, ctx.parseMachineInput(m, raw).input);
    assert.equal(JSON.stringify(ctx.exportWorkspaceState()), before,
      `${m}: a decider must not touch the machine it is deciding about`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  THE PLAYER ASKS, THE MACHINE ANSWERS
// ══════════════════════════════════════════════════════════════════
// runSim is now four lines of dispatch — parse, guard, highlight, run —
// so what is worth pinning is that each of the four still reaches the
// machine's own answer and prints it. Every message below is written in a
// machine module; simulation.js only decides what an error looks like.

const traceLog = () => getElement('trace-log').innerHTML;

function runInput(raw) {
  getElement('sim-in').value = raw;
  ctx.runSim();
  ctx.stopAutoPlay();
  return traceLog();
}

test('a word the alphabet cannot spell is refused, not run', () => {
  trivial('DFA');
  assert.match(runInput('zzz'), /cannot be tokenized using alphabet \{a, b\}/);
  assert.equal(ctx.App.simSteps.length, 0, 'nothing should have been simulated');
});

test('an ω-automaton refuses a finite word and says how to write one', () => {
  trivial('DBA');
  const out = runInput('abab');
  assert.match(out, /DBA reads an infinite word/);
  assert.match(out, /u\(v\)/, 'the refusal has to show the format');
});

test('an ω-word with an empty period is a finite word, and is refused as one', () => {
  trivial('DBA');
  assert.match(runInput('a()'), /period must be non-empty/);
});

test("a D-type's guard refuses a branching δ before the run starts", () => {
  const App = trivial('DBA');
  App.transitions = [
    { id: 't1', from: 's1', to: 's1', symbol: 'a' },
    { id: 't2', from: 's1', to: 's1', symbol: 'a' }
  ];
  const out = runInput('a(a)');
  assert.match(out, /Nondeterministic overlap in DBA mode/);
  assert.match(out, /Switch to NBA/, 'a refusal should name the machine that would work');
  assert.equal(App.simSteps.length, 0, 'a refused run leaves no steps behind');
});

test('a multi-tape run counts its segments against the tape count', () => {
  const App = trivial('MTM');
  App.tapeCount = 2;
  assert.match(runInput('a,b,c'), /found 3 comma-separated segment\(s\) but machine has 2 tape\(s\)/);
});

test('a multi-tape run with one value per tape starts', () => {
  const App = trivial('MTM');
  App.tapeCount = 2;
  runInput('a,b');
  assert.ok(App.simSteps.length > 0, 'one value per tape is a legal start');
});

test('no start state stops every machine before it parses anything', () => {
  for (const m of ALL()) {
    const App = trivial(m);
    App.startId = null;
    assert.match(runInput('a'), /No start state/, m);
  }
});

// A machine's δ signature is written out by hand, one string per type, and
// the strings are close enough to copy from each other — Counter's was
// DPDA's, so the Language panel reported a branching machine as
// single-valued while the runtime explored. The codomain is a power set
// exactly when δ may take more than one value, and hasSingleValuedDelta is
// what already knows which that is. A PFA is the one machine excluded, and
// legitimately: its δ is a weight function into [0, 1], not a set-valued map.
test('a nondeterministic machine writes a power set into its δ signature', () => {
  for (const m of ALL()) {
    if (ctx.MachineTypes[m].isWeighted) continue;
    const delta = ctx.machineFormal(m)?.delta?.();
    assert.ok(delta, `${m} states no δ signature`);
    assert.equal(/P\(/.test(delta), !ctx.hasSingleValuedDelta(m),
      `${m} declares δ as "${delta}" but hasSingleValuedDelta says ${ctx.hasSingleValuedDelta(m)}`);
  }
});

// ── moving a piece of one machine onto another ────────────────────
// Copying is the one gesture that crosses machines: a clipboard outlives the
// machine it was filled from, so a fragment written for an MTM can be offered
// to a DFA. What decides it is the registry's own `transitionFields` rather
// than the family or the name, and these walk MachineTypes for the same reason
// the rest of this file does — a machine added to js/state.js must not silently
// become paste-compatible with everything.

test('a fragment is only movable onto a machine that reads the same rules', () => {
  for (const m of ALL()) {
    // The identity case is free and must never refuse: pasting onto the
    // machine you copied from is much the commonest paste there is.
    assert.equal(ctx.transitionShapeRefusal(m, m), null, m);
    // Nothing is claimed about the source, so there is nothing to compare
    // against and the paste goes through — everything the app writes records
    // its machine, so this is the hand-made or older case.
    assert.equal(ctx.transitionShapeRefusal(null, m), null, m);
  }
});

test('the shape rule is the registry field list, not a family or a name', () => {
  for (const a of ALL()) {
    for (const b of ALL()) {
      const same = JSON.stringify(ctx.transitionFieldsOf(a)) === JSON.stringify(ctx.transitionFieldsOf(b));
      assert.equal(ctx.transitionShapeRefusal(a, b) === null, same, `${a} -> ${b}`);
    }
  }
});

test('the machines that differ only in their tape or their δ share their rules', () => {
  // The case worth having: these differ in what the tape is and in whether δ
  // branches, neither of which is a property of a transition.
  for (const m of ['NDTM', 'LBA', 'ITM']) {
    assert.equal(ctx.transitionShapeRefusal('TM', m), null, m);
  }
  for (const m of ['NFA', 'ENFA']) {
    assert.equal(ctx.transitionShapeRefusal('DFA', m), null, m);
  }
  // And the ones that genuinely disagree: a tuple read is not a single read,
  // and a transducer's rule carries an output a plain automaton has no field
  // for.
  assert.ok(ctx.transitionShapeRefusal('MTM', 'TM'));
  assert.ok(ctx.transitionShapeRefusal('TM', 'MTM'));
  assert.ok(ctx.transitionShapeRefusal('Mealy', 'DFA'));
  assert.ok(ctx.transitionShapeRefusal('TM', 'DFA'));
});

test('the refusal names both machines, because the reader switched between them', () => {
  const say = ctx.transitionShapeRefusal('MTM', 'DFA', 'This selection');
  assert.match(say, /This selection/);
  assert.match(say, /MTM/);
  assert.match(say, /DFA/);
});
