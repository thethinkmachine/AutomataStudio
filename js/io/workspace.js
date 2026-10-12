import { defineActions } from '../core/action-registry.js';
import { renderAlgo } from '../algorithms/algorithms-fa.js';
import { isPlaced, layoutStates } from '../canvas/canvas.js';
import { snapshot } from '../core/history.js';
import { registerModal, showOverlay } from '../ui/modal.js';
import { showExampleCard } from '../ui/machine-card.js';
import { $, APP_VERSION, App, clampTapeCount } from '../core/state.js';
import { Change, emit } from '../core/store.js';
import { autoFitLoadedMachine, switchHelpTab } from '../ui/ui.js';
import { performClear, showStatus } from '../core/utils.js';
import { applyMachineSwitch, setView } from '../ui/view.js';

// ══════════════════════════════════════════════════════════════════
//  HELP MODAL
// ══════════════════════════════════════════════════════════════════
// Read-only dialogs: nothing to lose, so a backdrop click dismisses them.
registerModal('help-modal', { dismissOnBackdrop: true });
registerModal('about-modal', { dismissOnBackdrop: true });

// Reopens on the first tab rather than wherever it was left, matching
// openSettingsModal.
export function showHelpModal() {
  switchHelpTab('tools');
  showOverlay('help-modal');
}

// Declared in state.js, which is a leaf — the save format stamps it into every
// file, and persistence.js reading a `const` out of this module would be
// reaching across an import cycle. Re-exported so the name still resolves here.
export { APP_VERSION };

export function openAboutModal() {
  const el = $('about-version');
  if (el) el.textContent = APP_VERSION;
  showOverlay('about-modal');
}


// ══════════════════════════════════════════════════════════════════
//  WORKSPACE B (M₂)
// ══════════════════════════════════════════════════════════════════
export function saveWorkspaceB() {
  App.workspaceB = getCurrentMachineSnapshot();
  showStatus(`M₂ saved: ${App.workspaceB.states.length} states, ${App.workspaceB.transitions.length} transitions`);
  // Refresh current algo panel to update M₂ status display
  if (App.view === 'algo') renderAlgo(App.currentAlgo);
}
export function loadWorkspaceB() {
  if (!App.workspaceB) { showStatus('No M₂ saved'); return; }
  loadBuiltMachine(App.workspaceB, App.workspaceB.machine || App.machine);
  showStatus('M₂ loaded into canvas');
}

defineActions({
  'workspace.saveWorkspaceB': () => saveWorkspaceB(),
  'workspace.loadWorkspaceB': () => loadWorkspaceB(),
  'workspace.openAboutModal': () => openAboutModal(),
  'workspace.showHelpModal': () => showHelpModal()
});
export function getCurrentMachineSnapshot() {
  return {
    machine: App.machine,
    states: App.states.map(s => ({ ...s })),
    transitions: App.transitions.map(t => ({ ...t })),
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
  };
}

// Σ for a machine that does not say: what its transitions read, less ε and
// the wildcard. A construction that knows its alphabet (union and
// concatenation merge both; subset construction and minimisation keep the
// source's) says so with `sigma`, which wins — a symbol with no edge is still
// in Σ, and a DFA is complete over all of it.
function builtSigma(machine) {
  const { eps, any } = App.config.sym;
  const given = machine.sigma ? [...machine.sigma] : [];
  const syms = given.length ? given : machine.transitions.map(t => t.symbol);
  return [...new Set(syms.filter(sym => sym !== undefined && sym !== null && sym !== '' && sym !== eps && sym !== any))];
}

/**
 * Put a machine an algorithm built on the canvas, as a new machine.
 *
 * A built result is what loading an example is: a clean canvas apart from the
 * machine. This used to replace the states, transitions, start and F and
 * nothing else, so everything else about the machine that had been there
 * stayed, describing one that was gone — Σ (the Run box refused M₂'s words on
 * a union that accepts them), notes anchored to ids the result does not have
 * (drawn at their offset, near the origin, over whatever state landed there),
 * dividers placed for the old diagram, and the card. performClear() is the
 * one definition of "the graph and everything anchored to it", so this goes
 * through it rather than clearing fields by hand.
 *
 * `card` is what the card says instead — what was built, which is useful on a
 * derived machine — or nothing, which takes the card away. One Ctrl+Z brings
 * back the machine and all of it.
 */
export function loadBuiltMachine(machine, machineType, card = null) {
  snapshot();
  // performClear empties the undo stacks as part of clearing the canvas; they
  // are the session's, and the entry just taken is the one that undoes this.
  const history = App.history;
  performClear();
  App.history = history;
  App.future = [];
  App.sigma = new Set(builtSigma(machine));
  if (machine.stackAlpha) App.stackAlpha = new Set(machine.stackAlpha);
  if (machine.outputAlpha) App.outputAlpha = new Set(machine.outputAlpha);
  if (machine.tapeCount) App.tapeCount = clampTapeCount(machine.tapeCount);
  // A state of a saved M₂ can still name the block it sat in, and the blocks
  // went with performClear — no block comes with a built machine.
  App.states = machine.states.map(({ blockId, ...s }) => s);
  App.transitions = machine.transitions.map(t => ({ ...t }));
  App.startId = machine.startId;
  // A construction says what a machine is, not where it goes: the closure
  // builders (star, reversal, union, concatenation) make states with no
  // coordinates, and those reached the canvas as NaN — no circle, no label,
  // an edge to nowhere. One state without a place means the old places do not
  // fit the new machine either, so the whole of it is laid out, the way
  // Arrange would. A machine that has its places (M₂ restored) keeps them.
  if (!App.states.every(isPlaced)) layoutStates(App.states, App.transitions, App.startId);
  App.accepts = new Set(machine.accepts);
  App.stateN = Math.max(0, ...App.states.map(s => parseInt(s.id.replace(/\D/g, '')) || 0));
  App.transN = Math.max(0, ...App.transitions.map(t => parseInt(t.id.replace(/\D/g, '')) || 0));
  showExampleCard(card);
  applyMachineSwitch(machineType || App.machine);
  emit(Change.ALPHABET, Change.META, Change.GRAPH);
  setView('build');
  autoFitLoadedMachine();
}

