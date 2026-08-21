import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { App, exportWorkspaceState } from '../js/state.js';
import { undo } from '../js/history.js';
import {
  Wizard, addState, addTransition, applyDraft, beginWizard, draftFromCanvas,
  newDraft, previewCandidate, resetWizard
} from '../js/wizard.js';
import { _showWizardStep, openMachineWizard, syncWizardButton } from '../js/wizard-ui.js';
import { MachineTypes } from '../js/state.js';
import { wizardSteps } from '../js/wizard.js';

// What the wizard has to be true about, as distinct from what it draws.
//
// The pipeline it borrows from StateMate has one property worth more than
// anything else in it: the canvas is written exactly once, at the end, or not
// at all. These tests are that property, plus the one the *edit* mode adds —
// filling the wizard in from a machine and pressing Create without touching
// anything has to give back the same machine, ids and coordinates included,
// or "edit" would be a redraw wearing an edit's clothes.

/** A small hand-placed DFA, with a note anchored to one of its states. */
function drawMachine() {
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [
    { id: 's1', name: 'even', x: 120, y: 60 },
    { id: 's2', name: 'odd', x: 300, y: 60 }
  ];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a', curve: 40 },
    { id: 't2', from: 's2', to: 's1', symbol: 'a' },
    { id: 't3', from: 's1', to: 's1', symbol: 'b', loopAngle: 1.2 }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s1']);
  App.notes = [{ id: 'n1', text: 'parity', x: 0, y: 0, anchorStates: ['s1'], anchorTransitions: [] }];
}

function seedDraft(machine = 'DFA') {
  const draft = newDraft(machine);
  draft.sigma = ['a', 'b'];
  addState(draft, 'q1');
  draft.states[1].accept = true;
  const t = addTransition(draft);
  t.from = draft.states[0].key;
  t.to = draft.states[1].key;
  t.on = 'a';
  return draft;
}

// ══════════════════════════════════════════════════════════════════
//  THE CANVAS IS WRITTEN ONCE, OR NOT AT ALL
// ══════════════════════════════════════════════════════════════════

test('opening, walking and closing the wizard writes nothing', () => {
  createHarness();
  drawMachine();
  const before = JSON.stringify(exportWorkspaceState());

  openMachineWizard();
  for (let i = 0; i < wizardSteps(App.machine).length; i++) _showWizardStep(i);

  assert.equal(JSON.stringify(exportWorkspaceState()), before);
});

test('a draft that cannot be built leaves the canvas exactly as it was', () => {
  createHarness();
  drawMachine();
  const before = JSON.stringify(exportWorkspaceState());

  const draft = newDraft('DFA');
  draft.sigma = ['a'];
  draft.states = [];              // validateSpec refuses a machine with no states

  const result = applyDraft(draft);
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(JSON.stringify(exportWorkspaceState()), before);
});

test('a machine the linter would have to repair is refused, and nothing is drawn', () => {
  createHarness();
  drawMachine();
  const before = JSON.stringify(exportWorkspaceState());

  // Two rules out of one state on the same letter: legal JSON, and not a DFA.
  const draft = seedDraft('DFA');
  const clash = addTransition(draft);
  clash.from = draft.states[0].key;
  clash.to = draft.states[0].key;
  clash.on = 'a';

  const result = applyDraft(draft);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.severity === 'repair'));
  assert.equal(JSON.stringify(exportWorkspaceState()), before);
});

// ══════════════════════════════════════════════════════════════════
//  EDIT IS AN EDIT
// ══════════════════════════════════════════════════════════════════

test('opening on a machine and pressing Create changes nothing about it', () => {
  createHarness();
  drawMachine();
  const before = JSON.stringify(exportWorkspaceState());

  beginWizard();
  assert.equal(Wizard.mode, 'edit');

  const result = applyDraft(Wizard.draft);
  assert.equal(result.ok, true, result.error?.message);

  // Ids, coordinates, the hand-tuned curve, the loop angle and the note
  // anchored to a state all have to survive: that is the difference between
  // an edit and a redraw.
  assert.deepEqual(App.states.map(s => [s.id, s.name, s.x, s.y]), [
    ['s1', 'even', 120, 60],
    ['s2', 'odd', 300, 60]
  ]);
  assert.equal(App.startId, 's1');
  assert.deepEqual([...App.accepts], ['s1']);
  assert.equal(App.transitions.find(t => t.from === 's1' && t.to === 's2').curve, 40);
  assert.equal(App.transitions.find(t => t.from === 's1' && t.to === 's1').loopAngle, 1.2);
  assert.deepEqual(App.notes[0].anchorStates, ['s1']);

  // The machine is the same machine; only the info card was written.
  const after = JSON.parse(JSON.stringify(exportWorkspaceState()));
  const beforeParsed = JSON.parse(before);
  assert.deepEqual(after.states, beforeParsed.states);
  assert.deepEqual(after.transitions, beforeParsed.transitions);
});

test('adding one state through the wizard adds one circle', () => {
  createHarness();
  drawMachine();

  beginWizard();
  addState(Wizard.draft, 'trap');
  const result = applyDraft(Wizard.draft);

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(App.states.length, 3);
  // The two that were there keep their ids and their places.
  assert.deepEqual(
    App.states.filter(s => s.id === 's1' || s.id === 's2').map(s => [s.x, s.y]),
    [[120, 60], [300, 60]]
  );
});

test('one Ctrl+Z puts back the machine the wizard replaced', () => {
  createHarness();
  drawMachine();
  const before = JSON.stringify(App.states.map(s => [s.id, s.name]));

  beginWizard();
  addState(Wizard.draft, 'trap');
  applyDraft(Wizard.draft);
  assert.equal(App.states.length, 3);

  undo();
  assert.equal(JSON.stringify(App.states.map(s => [s.id, s.name])), before);
});

test('a problem the machine already had does not block editing its title', () => {
  createHarness();
  // A "DFA" with two a-edges out of one state — the shape a JFLAP import or a
  // hand-drawn file can arrive in.
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's1', name: 'p', x: 0, y: 0 }, { id: 's2', name: 'q', x: 90, y: 0 }];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's1', to: 's1', symbol: 'a' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s2']);

  beginWizard();
  Wizard.draft.meta.title = 'Renamed';

  const preview = previewCandidate(Wizard.draft);
  const determinism = preview.findings.find(f => f.rule === 'nondeterministic');
  assert.ok(determinism, 'the conflict is still reported');
  assert.equal(determinism.severity, 'warn', 'but it does not block a title change');
  assert.ok(determinism.inherited);

  assert.equal(applyDraft(Wizard.draft).ok, true);
  assert.equal(App.meta.title, 'Renamed');
});

// ══════════════════════════════════════════════════════════════════
//  CREATE
// ══════════════════════════════════════════════════════════════════

test('building over an occupied canvas opens a tab instead of overwriting it', () => {
  const h = createHarness();
  h.context.createTab('First');
  drawMachine();
  const before = JSON.stringify(App.states.map(s => [s.id, s.name]));
  const tabsBefore = h.context.Workspaces.length;

  const draft = seedDraft('DFA');
  const result = applyDraft(draft, { openNewTab: true });

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.newTab, true);
  // The new machine is what is on screen…
  assert.deepEqual(App.states.map(s => s.name), ['q0', 'q1']);
  // …in a tab of its own, with the machine it did not overwrite still in the
  // one it came from.
  assert.equal(h.context.Workspaces.length, tabsBefore + 1);
  const first = h.context.Workspaces[0];
  assert.equal(JSON.stringify(first.data.states.map(s => [s.id, s.name])), before);
});

test('the described machine reaches the info card', () => {
  createHarness();
  const draft = seedDraft('DFA');
  draft.meta.title = 'Ends in a';
  draft.meta.blurb = 'Accepts every word whose last letter is a.';
  draft.meta.tests = [{ key: 'k1', w: 'ba', expect: 'accept' }, { key: 'k2', w: 'ab', expect: 'reject' }];

  assert.equal(applyDraft(draft).ok, true);
  assert.equal(App.meta.title, 'Ends in a');
  assert.equal(App.meta.inputs.length, 2);
  assert.equal(App.meta.inputs[0].w, 'ba');
});

test('the settings a graph cannot carry are applied with it', () => {
  createHarness();
  const draft = seedDraft('PFA');
  draft.cutPoint = 0.25;
  draft.transitions[0].weight = 1;
  assert.equal(applyDraft(draft).ok, true);
  assert.equal(App.config.pfaCutPoint, 0.25);

  const tm = seedDraft('TM');
  tm.twoWayTape = true;
  assert.equal(applyDraft(tm, { openNewTab: true }).ok, true);
  assert.equal(App.config.twoWayTape, true);
});

// ══════════════════════════════════════════════════════════════════
//  THE BUTTON, AND THE DRAFT BEHIND IT
// ══════════════════════════════════════════════════════════════════

test('the mode is read off the canvas, never asked', () => {
  createHarness();
  resetWizard();

  beginWizard();
  assert.equal(Wizard.mode, 'create', 'a blank canvas builds');

  drawMachine();
  beginWizard();
  assert.equal(Wizard.mode, 'edit', 'a canvas with a machine on it edits');
  assert.deepEqual(Wizard.draft.states.map(s => s.name), ['even', 'odd']);

  beginWizard({ fresh: true });
  assert.equal(Wizard.mode, 'create', 'and "start a new machine" overrides it');
  assert.equal(Wizard.draft.states.length, 1);
});

test('a draft survives the dialog closing, and is rebuilt when the canvas moves', () => {
  createHarness();
  drawMachine();

  beginWizard();
  Wizard.draft.meta.title = 'in progress';
  beginWizard();
  assert.equal(Wizard.draft.meta.title, 'in progress', 'closing and reopening resumes');

  // The machine underneath changed, so the prefill is stale rather than
  // resumable — applying it would discard whatever happened in between.
  App.states.push({ id: 's3', name: 'third', x: 0, y: 0 });
  beginWizard();
  assert.equal(Wizard.draft.meta.title, '');
  assert.equal(Wizard.draft.states.length, 3);
});

test('the header button says which of its two jobs it is doing', () => {
  const h = createHarness();
  const button = h.context.document.getElementById('machine-wizard-btn');

  syncWizardButton();
  assert.match(button.getAttribute('aria-label'), /Build/);

  drawMachine();
  syncWizardButton();
  assert.match(button.getAttribute('aria-label'), /Edit/);
});

// ══════════════════════════════════════════════════════════════════
//  EVERY MACHINE, END TO END
// ══════════════════════════════════════════════════════════════════

test('every machine can be drawn through the wizard, and every step renders', () => {
  for (const machine of Object.keys(MachineTypes)) {
    const h = createHarness();
    App.machine = machine;
    openMachineWizard({ fresh: true });

    // Every step of every machine is built at least once: a builder that
    // assumes a field a machine does not have throws in a dialog nobody has
    // open, and this is what catches it.
    const steps = wizardSteps(machine);
    for (let i = 0; i < steps.length; i++) _showWizardStep(i);

    const draft = Wizard.draft;
    draft.sigma = ['a'];
    addState(draft, 'q1');
    draft.states[1].accept = true;
    const t = addTransition(draft);
    t.from = draft.states[0].key;
    t.to = draft.states[1].key;

    const result = applyDraft(draft);
    assert.equal(result.ok, true, `${machine}: ${result.error?.message}`);
    assert.equal(App.machine, machine);
    assert.equal(App.states.length, 2, machine);
  }
});
