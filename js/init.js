// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
try {
  applyTheme(localStorage.getItem('automata-theme') || App.config.theme || 'dark', false);
} catch (e) {
  applyTheme(App.config.theme || 'dark', false);
}
renderSigma(); renderGamma(); renderGramSyms(); renderOutputAlpha();
renderGrammarLPanel(); updateLPanel();
App.stackAlpha = new Set([App.config.sym.stackBottom]);
setMachine('DFA'); setTool('pointer'); setView('build');
snapshot();
// Attach minimap click navigation
const _mmCanvas = $('minimap-canvas');
if (_mmCanvas) _mmCanvas.addEventListener('click', minimapNavigate);
// Restore localStorage preferences
try {
  if (localStorage.getItem('automata-minimap') === '0') toggleMinimap();
  if (localStorage.getItem('automata-lpanel-pinned') === '0') toggleLPanelPin();
  if (localStorage.getItem('automata-rpanel-pinned') === '0') toggleRPanelPin();
} catch (e) { }
if (typeof initMobilePanels === 'function') initMobilePanels();
if (typeof loadBackup === 'function') {
  loadBackup();
} else {
  initTabs(); // Create initial tab if no backup logic
}
if (Workspaces.length === 0) initTabs(); // Guard for fresh launch

setTimeout(() => showStatus('Esc=Pointer · V=Pan · Space+Drag=Pan · S=State · T=Transition · H=Fit · Ctrl+Z=Undo'), 600);
