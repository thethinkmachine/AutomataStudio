// ══════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════
function clearAll(silent) {
  if (!silent && App.states.length > 0) {
    $('confirm-title').textContent = 'Clear Canvas?';
    $('confirm-msg').textContent = 'This will permanently delete all states and transitions from the workspace.';
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      performClear();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  performClear();
  if (!silent) showStatus('Canvas cleared');
}

function performClear() {
  App.states = []; App.transitions = []; App.startId = null; App.accepts.clear();
  App.stateN = 0; App.transN = 0; App.history = []; App.future = [];
  resetSim(); renderAll(); updateSidebar(); updateRPanel();
}

function showStatus(msg) {
  const b = $('status-bar'); b.textContent = msg; b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2500);
}

