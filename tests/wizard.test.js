import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The wizard's logic half. Everything here runs against js/wizard.js and
// js/wizard-copy.js directly — no dialog, no clicking — which is the whole
// reason those two are separate from js/wizard-ui.js.
//
// What is worth pinning, and why:
//
//   * a draft for *every* machine in MachineTypes turns into a spec the real
//     validateSpec accepts. The step list and the fields are derived from the
//     capability flags rather than listed per machine, and this is what says
//     the derivation actually holds for all thirty of them.
//   * the questions a machine is asked match what that machine has. A DFA
//     must not be asked about its stack; an MTM must be asked how many tapes.
//   * state rows reference each other by key, so renaming a state is a
//     rename and not an orphaning.

import { MachineCategories, MachineTypes } from '../js/state.js';
import { validateSpec } from '../js/statemate-spec.js';
import {
  addState, addTransition, draftToSpec, fieldCopy, newDraft, optionsFor,
  removeState, resetWizard, setDraftMachine, setDraftTapeCount, setStart,
  stepCopy, stepIssues, symbolChoices, wizardSteps
} from '../js/wizard.js';

function seed(machine) {
  resetWizard();
  const draft = newDraft(machine);
  draft.sigma = ['a', 'b'];
  addState(draft, 'q1');
  draft.states[1].accept = true;
  const t = addTransition(draft);
  t.from = draft.states[0].key;
  t.to = draft.states[1].key;
  return draft;
}

test('every machine turns a draft into a spec validateSpec accepts', () => {
  createHarness();
  for (const machine of Object.keys(MachineTypes)) {
    const draft = seed(machine);
    const spec = draftToSpec(draft);
    assert.doesNotThrow(
      () => validateSpec(spec, { fallbackMachine: machine }),
      `${machine} produced a spec validateSpec rejected`
    );
  }
});

test('a machine is asked about the storage it actually has', () => {
  createHarness();
  const idsFor = m => wizardSteps(m).map(s => s.id);

  assert.deepEqual(idsFor('DFA'), ['model', 'sigma', 'states', 'transitions', 'describe', 'review']);

  assert.ok(idsFor('NPDA').includes('gamma'), 'a pushdown machine is asked about its stack');
  assert.ok(!idsFor('DFA').includes('gamma'), 'a finite automaton has no store to ask about');
  assert.ok(idsFor('TM').includes('gamma'), 'a tape machine is asked about its tape alphabet');

  assert.ok(idsFor('Mealy').includes('delta'), 'a transducer is asked what it writes');
  assert.ok(!idsFor('NFA').includes('delta'), 'an acceptor writes nothing');

  assert.ok(idsFor('MTM').includes('options'), 'a multi-tape machine is asked how many tapes');
  assert.ok(idsFor('PFA').includes('options'), 'a probabilistic machine is asked for its threshold');
  assert.ok(!idsFor('DFA').includes('options'), 'a DFA has nothing to configure');
});

test('the options offered are the ones the machine has a choice about', () => {
  createHarness();
  assert.deepEqual(optionsFor('MTM'), ['tapeCount', 'twoWayTape']);
  assert.deepEqual(optionsFor('PFA'), ['cutPoint']);
  assert.deepEqual(optionsFor('TM'), ['twoWayTape']);
  // ITM is two-way by being what it is, and an LBA is bounded at both ends by
  // definition. Neither has a tape shape to offer.
  assert.deepEqual(optionsFor('ITM'), []);
  assert.deepEqual(optionsFor('LBA'), []);
  assert.deepEqual(optionsFor('DFA'), []);
});

test('the copy follows the capability, not the machine name', () => {
  createHarness();
  // Every machine with a stack says the same thing about it, and a tape
  // machine says something else entirely through the same step.
  assert.equal(stepCopy('gamma', 'NPDA').flavour, '');
  assert.equal(stepCopy('gamma', 'TM').flavour, 'tape');
  assert.equal(stepCopy('gamma', 'QA').flavour, 'queue');
  assert.notEqual(stepCopy('gamma', 'TM').description, stepCopy('gamma', 'NPDA').description);

  // Parity has no accepting states to describe, so it must not be described
  // as though it had.
  assert.equal(stepCopy('states', 'DPA').flavour, 'parity');
  assert.match(stepCopy('states', 'DPA').description, /priority/);

  // A queue's ends are not a stack's, and calling them push and pop would be
  // technically true and useless.
  assert.match(fieldCopy('QA', 'push').label, /back/);
  assert.match(fieldCopy('NPDA', 'push').label, /Push/);
});

test('every step of every machine has a question and an explanation', () => {
  createHarness();
  for (const machine of Object.keys(MachineTypes)) {
    for (const step of wizardSteps(machine)) {
      assert.ok(step.question.trim(), `${machine}/${step.id} has no question`);
      assert.ok(step.description.trim(), `${machine}/${step.id} has no description`);
      assert.ok(step.short.trim(), `${machine}/${step.id} has no rail label`);
    }
  }
});

test('symbols are offered from the alphabet the reader declared', () => {
  createHarness();
  const draft = newDraft('DFA');
  draft.sigma = ['0', '1'];
  const values = symbolChoices(draft, 'on').map(c => c.value);
  assert.ok(values.includes('0') && values.includes('1'));
  // Σ as a wildcard is legal on a finite automaton and ε is not.
  assert.ok(values.includes('Σ'));
  assert.ok(!values.includes('ε'));

  const enfa = newDraft('ε-NFA');
  enfa.sigma = ['a'];
  assert.ok(symbolChoices(enfa, 'on').map(c => c.value).includes('ε'));

  // A value already in the draft is never dropped from its own menu, even
  // when it is not one of the legal choices.
  const stray = symbolChoices(draft, 'on', 'zzz');
  assert.equal(stray[0].value, 'zzz');
  assert.match(stray[0].note, /not in the alphabet/);
});

test('a tape machine reads the tape, not the input alphabet', () => {
  createHarness();
  const draft = newDraft('TM');
  draft.sigma = ['a'];
  draft.stackAlpha = ['⊔', 'X'];
  const values = symbolChoices(draft, 'on').map(c => c.value);
  assert.ok(values.includes('X'), 'a scratch symbol is readable');
  assert.ok(values.includes('⊔'), 'so is the blank');
});

test('transitions reference states by key, so a rename is only a rename', () => {
  createHarness();
  const draft = seed('DFA');
  draft.states[0].name = 'even';
  const spec = draftToSpec(draft);
  assert.equal(spec.transitions[0].from, 'even');
  assert.doesNotThrow(() => validateSpec(spec, { fallbackMachine: 'DFA' }));
});

test('removing a state takes its rules with it', () => {
  createHarness();
  const draft = seed('DFA');
  assert.equal(draft.transitions.length, 1);
  removeState(draft, draft.states[1].key);
  assert.equal(draft.transitions.length, 0, 'a rule pointing at nothing is not left behind');
});

test('there is always exactly one start state', () => {
  createHarness();
  const draft = seed('DFA');
  setStart(draft, draft.states[1].key);
  assert.deepEqual(draft.states.map(s => s.start), [false, true]);
  // Deleting the start state hands the mark to someone rather than leaving
  // the machine with no way in.
  removeState(draft, draft.states[1].key);
  assert.equal(draft.states.filter(s => s.start).length, 1);
});

test('two states that differ only in case are refused', () => {
  createHarness();
  const draft = seed('DFA');
  draft.states[1].name = 'Q0';
  draft.states[0].name = 'q0';
  const issues = stepIssues(draft, 'states');
  // stateNameKey is what the compiler matches on, so these are one state to
  // it — accepting them here would silently merge half the diagram.
  assert.ok(issues.some(i => i.severity === 'error' && /Two states/.test(i.message)));
});

test('an empty alphabet blocks the alphabet step and nothing else', () => {
  createHarness();
  const draft = newDraft('DFA');
  assert.ok(stepIssues(draft, 'sigma').some(i => i.severity === 'error'));
  draft.sigma = ['a'];
  assert.deepEqual(stepIssues(draft, 'sigma'), []);
});

test('a probability outside 0..1 is refused', () => {
  createHarness();
  const draft = seed('PFA');
  draft.transitions[0].weight = 4;
  assert.ok(stepIssues(draft, 'transitions').some(i => i.severity === 'error' && i.field === 'weight'));
  draft.transitions[0].weight = 1;
  assert.ok(!stepIssues(draft, 'transitions').some(i => i.severity === 'error'));
});

test('a machine with no accepting states is a warning, never a refusal', () => {
  createHarness();
  const draft = seed('DFA');
  draft.states.forEach(s => { s.accept = false; });
  const issues = stepIssues(draft, 'states');
  assert.ok(issues.length);
  assert.ok(issues.every(i => i.severity === 'warn'));
});

test('the tape count keeps every per-tape array as wide as itself', () => {
  createHarness();
  const draft = seed('MTM');
  setDraftTapeCount(draft, 4);
  const t = draft.transitions[0];
  assert.equal(t.tapeSyms.length, 4);
  assert.equal(t.tapeWrites.length, 4);
  assert.equal(t.tapeDirs.length, 4);
  setDraftTapeCount(draft, 2);
  assert.equal(draft.transitions[0].tapeSyms.length, 2);
  assert.doesNotThrow(() => validateSpec(draftToSpec(draft), { fallbackMachine: 'MTM' }));
});

test('changing the machine keeps the graph and re-shapes the fields', () => {
  createHarness();
  const draft = seed('DFA');
  const next = setDraftMachine(draft, 'NPDA');
  assert.deepEqual(next.states.map(s => s.name), draft.states.map(s => s.name));
  assert.equal(next.transitions.length, 1);
  assert.ok('pop' in next.transitions[0], 'a pushdown rule gained its stack fields');
  assert.ok(!('pop' in draft.transitions[0]), 'and the DFA never had them');
  assert.doesNotThrow(() => validateSpec(draftToSpec(next), { fallbackMachine: 'NPDA' }));
});

test('a parity machine carries priorities and no accepting set', () => {
  createHarness();
  const draft = seed('DPA');
  draft.states[1].priority = 2;
  const spec = draftToSpec(draft);
  assert.equal(spec.states[1].priority, 2);
  assert.ok(!('accept' in spec.states[1]), 'parity has no F to describe');
});

test('the model step offers every machine the picker offers', () => {
  createHarness();
  const listed = MachineCategories.flatMap(c => c.machines);
  for (const machine of listed) {
    assert.ok(MachineTypes[machine], `${machine} is listed but not defined`);
    assert.ok(wizardSteps(machine).length >= 5, `${machine} has no wizard`);
  }
  // PDA is a hidden alias of DPDA and is deliberately absent from the picker;
  // the wizard follows the picker, so it must be absent here too.
  assert.ok(!listed.includes('PDA'));
});
