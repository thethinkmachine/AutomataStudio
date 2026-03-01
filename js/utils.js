// ══════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════
function clearAll(silent) {
  App.states = []; App.transitions = []; App.startId = null; App.accepts.clear();
  App.stateN = 0; App.transN = 0; App.history = []; App.future = [];
  resetSim(); renderAll(); updateSidebar(); updateRPanel();
  if (!silent) showStatus('Canvas cleared');
}

function showStatus(msg) {
  const b = $('status-bar'); b.textContent = msg; b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2500);
}

