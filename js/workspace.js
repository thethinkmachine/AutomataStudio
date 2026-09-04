import { renderAlgo } from './algorithms-fa.js';
import { snapshot } from './history.js';
import { registerModal, showOverlay } from './modal.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { $, APP_VERSION, App } from './state.js';
import { Change, emit } from './store.js';
import { autoFitLoadedMachine, fitToScreen, switchHelpTab } from './ui.js';
import { showStatus } from './utils.js';
import { applyMachineSwitch, setView } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  HELP MODAL
// ══════════════════════════════════════════════════════════════════
// Read-only dialogs: nothing to lose, so a backdrop click dismisses them.
registerModal('help-modal', { dismissOnBackdrop: true });
registerModal('about-modal', { dismissOnBackdrop: true });

// Reopens on the first tab rather than wherever it was left, matching
// openSettingsModal.
export function showHelpModal() {
  if (typeof switchHelpTab === 'function') switchHelpTab('tools');
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
export function getCurrentMachineSnapshot() {
  return {
    machine: App.machine,
    states: App.states.map(s => ({ ...s })),
    transitions: App.transitions.map(t => ({ ...t })),
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
  };
}
export function loadBuiltMachine(machine, machineType) {
  snapshot();
  App.states = machine.states.map(s => ({ ...s }));
  App.transitions = machine.transitions.map(t => ({ ...t }));
  App.startId = machine.startId;
  App.accepts = new Set(machine.accepts);
  App.stateN = Math.max(0, ...App.states.map(s => parseInt(s.id.replace(/\D/g, '')) || 0));
  App.transN = Math.max(0, ...App.transitions.map(t => parseInt(t.id.replace(/\D/g, '')) || 0));
  if (machineType) { applyMachineSwitch(machineType); }
  emit(Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
}

