import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Switching the machine type has to move several pieces of UI at once: the
// model picker label in the header, the badge, the alphabet panels, and the
// sections that only apply to some machines (stack Γ, output Σ', tape count).
// applyMachineSwitch is the one function that does all of it without
// prompting to discard the current work.
//
// Two older idioms in the codebase changed App.machine without going through
// it, and both left part of the UI behind:
//
//   App.machine = m; setMachine(m);   // setMachine early-returns when the
//                                     // machine already matches, so only the
//                                     // picker label was synced
//
//   App.machine = m; /* poke three elements by hand */
//                                     // two of those elements no longer exist
//
// Neither throws. The machine really does change; the header just keeps
// showing the old one.

const label = (h, id) => h.context.MachineTypes[id].label;

test('promoting an NFA to an ε-NFA updates the model picker, not just the badge', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'NFA';
  h.context.applyMachineSwitch('NFA');

  h.context.createState(100, 100, 'q0');
  h.context.createState(260, 100, 'q1');
  App.startId = App.states[0].id;

  // A second start state is expressed with ε-moves, so the machine is
  // promoted. This is the path that used to hand-roll its UI update.
  h.context.applyStartState(App.states[1].id);

  assert.equal(App.machine, 'ε-NFA', 'the machine itself is promoted');
  assert.equal(h.getElement('cur-model-name').textContent, label(h, 'ε-NFA'),
    'the header must not keep reading NFA');
  assert.equal(h.getElement('mach-badge').textContent, label(h, 'ε-NFA'));
});

test('loading an algorithm result hides sections the new machine does not have', () => {
  const h = createHarness();
  const { App } = h.context;

  // Start somewhere with a stack, so there is a section that has to go away.
  h.context.applyMachineSwitch('DPDA');
  assert.equal(h.getElement('stack-sec').style.display, '', 'DPDA shows Γ');

  // Subset construction produces a DFA, which has no stack.
  App._lastSubset = {
    states: [{ name: 'A', isStart: true, isAcc: false }, { name: 'B', isStart: false, isAcc: true }],
    trans: [{ from: 'A', to: 'B', sym: 'a' }]
  };
  h.context.loadSubsetAsDFA();

  assert.equal(App.machine, 'DFA');
  assert.equal(h.getElement('stack-sec').style.display, 'none',
    'a DFA has no stack alphabet, so the section must be hidden');
  assert.equal(h.getElement('cur-model-name').textContent, label(h, 'DFA'));
});

test('applyMachineSwitch keeps the picker label and the badge in agreement', () => {
  const h = createHarness();
  for (const id of ['DFA', 'NFA', 'ε-NFA', 'DPDA', 'TM', 'Moore', 'Mealy']) {
    h.context.applyMachineSwitch(id);
    assert.equal(h.context.App.machine, id);
    assert.equal(h.getElement('cur-model-name').textContent, label(h, id), `picker label for ${id}`);
    assert.equal(h.getElement('mach-badge').textContent, label(h, id), `badge for ${id}`);
  }
});

test('transducer and stack sections follow the machine capabilities', () => {
  const h = createHarness();
  const shown = id => {
    h.context.applyMachineSwitch(id);
    return {
      stack: h.getElement('stack-sec').style.display !== 'none',
      output: h.getElement('output-sec').style.display !== 'none'
    };
  };
  assert.deepEqual(shown('DFA'), { stack: false, output: false });
  assert.deepEqual(shown('DPDA'), { stack: true, output: false });
  assert.deepEqual(shown('Moore'), { stack: false, output: true });
  assert.deepEqual(shown('TM'), { stack: true, output: false }, 'TMs reuse Γ as the tape alphabet');
});
