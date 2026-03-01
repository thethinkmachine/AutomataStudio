// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
renderSigma(); renderGamma(); renderGramSyms();
renderGrammarSidebar(); updateSidebar();
setMachine('DFA'); setTool('pointer'); setView('build');
snapshot();
// Attach minimap click navigation
const _mmCanvas = $('minimap-canvas');
if (_mmCanvas) _mmCanvas.addEventListener('click', minimapNavigate);
// Restore localStorage preferences
try {
  if (localStorage.getItem('automata-minimap') === '0') toggleMinimap();
  if (localStorage.getItem('automata-sidebar') === '0') toggleSidebar();
} catch(e) {}
setTimeout(() => showStatus('Esc=Pointer · V=Pan · S=State · T=Transition · H=Fit · Ctrl+Z=Undo'), 600);
