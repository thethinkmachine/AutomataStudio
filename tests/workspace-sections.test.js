import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The top of the Workspace panel: the Machine section, the alphabets as rows
// of one section, and the Blocks section appearing only when there is
// something in it.
//
// What is pinned is mostly *where the answer comes from*. The Machine section
// reads each machine's declared `options` rather than a list of its own, the
// alphabet rows are decided by one function shared by the machine switch and
// the undo path, and the parameters moved out of the Settings dialog are
// edits to the machine — undoable, and saved with it.

const harness = createHarness();
const { context } = harness;

function withHeader(id) {
  const el = context.$(id);
  el.innerHTML = '';
  delete el.__secStatus;
  const header = context.document.createElement('div');
  header.className = 'lp-section-header';
  header.querySelector = () => null;
  el.appendChild(header);
  return el;
}

function labels() {
  return context.$('machine-opts').children.map(row => row.children[0].textContent);
}

function fresh(machine) {
  harness.resetApp();
  context.resetMachineOptions();
  context.$('machine-opts').innerHTML = '';
  withHeader('lp-machine');
  context.applyMachineSwitch(machine);
}

// ── the Machine section ───────────────────────────────────────────

test('a machine with no parameters has no Machine section', () => {
  fresh('DFA');
  assert.equal(context.$('lp-machine').style.display, 'none');
  assert.deepEqual(labels(), []);
});

test('the rows are the machine\'s own declared options', () => {
  fresh('MTM');
  assert.equal(context.$('lp-machine').style.display, '');
  assert.deepEqual(labels(), ['Tapes', 'Two-way tape']);

  fresh('PFA');
  assert.deepEqual(labels(), ['Cut-point λ']);

  fresh('ITM');
  assert.equal(context.$('lp-machine').style.display, 'none',
    'always two-way, so there is nothing to choose');
});

test('folded, the section says what the parameters are', () => {
  fresh('MTM');
  assert.equal(context.sectionStatus('lp-machine').text, `${context.App.tapeCount} tapes · one-way`);
  context.setTwoWayTape(true);
  assert.equal(context.sectionStatus('lp-machine').text, `${context.App.tapeCount} tapes · two-way`);
});

test('the cut-point is clamped, undoable, and saved with the machine', () => {
  fresh('PFA');
  const before = context.App.config.pfaCutPoint ?? 0.5;
  context.setCutPoint('1.7');
  assert.equal(context.App.config.pfaCutPoint, 1, 'outside [0, 1] nothing could ever cross it');
  assert.equal(context.getWorkspaceData().config.pfaCutPoint, 1,
    'the same δ with a different λ is a different machine');
  context.undo();
  assert.equal(context.App.config.pfaCutPoint, before, 'and Ctrl+Z puts it back like any edit');
});

test('the two-way tape is undoable, and setting it to what it is costs nothing', () => {
  fresh('TM');
  context.App.config.twoWayTape = false;
  const depth = context.App.history.length;
  context.setTwoWayTape(false);
  assert.equal(context.App.history.length, depth, 'no edit, no undo point');
  context.setTwoWayTape(true);
  assert.equal(context.App.config.twoWayTape, true);
  context.undo();
  assert.equal(context.App.config.twoWayTape, false);
});

// ── the alphabets ─────────────────────────────────────────────────

test('one alphabet reads as it always did; several become labelled rows', () => {
  harness.resetApp();
  context.syncAlphabetSection('DFA');
  assert.equal(context.$('lp-alphabet').classList.contains('is-multi'), false);
  assert.match(context.$('lp-alphabet-title').innerHTML, /^Alphabet /);
  assert.equal(context.$('stack-sec').style.display, 'none');
  assert.equal(context.$('output-sec').style.display, 'none');

  context.syncAlphabetSection('DPDA');
  assert.equal(context.$('lp-alphabet').classList.contains('is-multi'), true);
  assert.equal(context.$('lp-alphabet-title').innerHTML, 'Alphabets');
  assert.equal(context.$('stack-sec').style.display, '');
  assert.match(context.$('stack-sec-lbl').innerHTML, /^Stack /);

  context.syncAlphabetSection('TM');
  assert.match(context.$('stack-sec-lbl').innerHTML, /^Tape /, 'a Turing machine\'s Γ is a tape alphabet');

  context.syncAlphabetSection('Mealy');
  assert.equal(context.$('output-sec').style.display, '');
  assert.equal(context.$('stack-sec').style.display, 'none');
});

test('undoing across a machine switch puts the rows back the way the switch does', () => {
  harness.resetApp();
  context.applyMachineSwitch('DFA');
  context.snapshot();
  context.applyMachineSwitch('DPDA');
  assert.equal(context.$('stack-sec').style.display, '');
  context.undo();
  assert.equal(context.App.machine, 'DFA');
  assert.equal(context.$('stack-sec').style.display, 'none');
  assert.equal(context.$('lp-alphabet').classList.contains('is-multi'), false);
});

// ── the Blocks section ────────────────────────────────────────────

test('Blocks appears with the first block, and never on a machine that cannot have one', () => {
  harness.resetApp();
  context.$('block-library-list').hidden = true;
  context.applyMachineSwitch('TM');
  context.App.blocks = [];
  context.syncBlocksSection();
  assert.equal(context.$('lp-blocks').style.display, 'none', 'nothing to list, so no section');

  context.App.blocks = [{ id: 'b1', name: 'add' }];
  context.syncBlocksSection();
  assert.equal(context.$('lp-blocks').style.display, '');

  context.App.blocks = [];
  context.$('block-library-list').hidden = false;       // a saved definition
  context.syncBlocksSection();
  assert.equal(context.$('lp-blocks').style.display, '', 'the library is something to list too');

  context.applyMachineSwitch('DFA');
  assert.equal(context.$('lp-blocks').style.display, 'none');
  context.$('block-library-list').hidden = true;
});
