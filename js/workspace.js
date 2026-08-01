// ══════════════════════════════════════════════════════════════════
//  HELP MODAL
// ══════════════════════════════════════════════════════════════════
// Read-only dialogs: nothing to lose, so a backdrop click dismisses them.
registerModal('help-modal', { dismissOnBackdrop: true });
registerModal('about-modal', { dismissOnBackdrop: true });

function showHelpModal() { showOverlay('help-modal'); }
function openAboutModal() { showOverlay('about-modal'); }


// ══════════════════════════════════════════════════════════════════
//  WORKSPACE B (M₂)
// ══════════════════════════════════════════════════════════════════
function saveWorkspaceB() {
  App.workspaceB = getCurrentMachineSnapshot();
  showStatus(`M₂ saved: ${App.workspaceB.states.length} states, ${App.workspaceB.transitions.length} transitions`);
  // Refresh current algo panel to update M₂ status display
  if (App.view === 'algo') renderAlgo(App.currentAlgo);
}
function loadWorkspaceB() {
  if (!App.workspaceB) { showStatus('No M₂ saved'); return; }
  loadBuiltMachine(App.workspaceB, App.workspaceB.machine || App.machine);
  showStatus('M₂ loaded into canvas');
}
function getCurrentMachineSnapshot() {
  return {
    machine: App.machine,
    states: App.states.map(s => ({ ...s })),
    transitions: App.transitions.map(t => ({ ...t })),
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
  };
}
function loadBuiltMachine(machine, machineType) {
  snapshot();
  App.states = machine.states.map(s => ({ ...s }));
  App.transitions = machine.transitions.map(t => ({ ...t }));
  App.startId = machine.startId;
  App.accepts = new Set(machine.accepts);
  App.stateN = Math.max(0, ...App.states.map(s => parseInt(s.id.replace(/\D/g, '')) || 0));
  App.transN = Math.max(0, ...App.transitions.map(t => parseInt(t.id.replace(/\D/g, '')) || 0));
  if (machineType) { applyMachineSwitch(machineType); }
  renderAll(); updateLPanel(); updateRPanel();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
}

