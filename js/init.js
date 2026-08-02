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
if ($('sim-speed-sel')) $('sim-speed-sel').value = String(App.config.autoSpeed);
try {
  const st = localStorage.getItem('automata-shape-tool');
  if (st === 'rect' || st === 'divider') App.lastShapeTool = st;
} catch (e) { }
setMachine('DFA'); setTool('pointer'); setView('build');
snapshot();
// Attach minimap drag-to-navigate
if (typeof initMinimapDrag === 'function') initMinimapDrag();
// Restore localStorage preferences
try {
  if (localStorage.getItem('automata-minimap') === '0') toggleMinimap();
  if (localStorage.getItem('automata-lpanel-pinned') === '0') toggleLPanelPin();
  if (localStorage.getItem('automata-rpanel-pinned') === '0') toggleRPanelPin();
  const wz = localStorage.getItem('automata-wheel-zoom');
  if (wz !== null) App.config.wheelZoom = wz === '1';
  if (localStorage.getItem('automata-snap-grid') === '1') toggleSnapToGrid(true);
  if (typeof initToolbarCollapse === 'function') initToolbarCollapse();
} catch (e) { }
if (typeof initMobilePanels === 'function') initMobilePanels();
if (typeof initLPanelSections === 'function') initLPanelSections();
if (typeof initRPanelSections === 'function') initRPanelSections();
if (typeof initPanelResizers === 'function') initPanelResizers();
if (typeof initCanvasResizeObserver === 'function') initCanvasResizeObserver();
if (typeof initDefBoxOverflowObserver === 'function') initDefBoxOverflowObserver();
if (typeof initLangClaimOverflowObserver === 'function') initLangClaimOverflowObserver();
// Restoring now reads IndexedDB first, so it is asynchronous. Everything that
// depends on the restored workspaces — the empty-state guard, the autosave
// timer, and the shared-link import that may overwrite them — has to run after
// it resolves, or it would race a still-empty Workspaces array.
function finishBoot() {
  if (Workspaces.length === 0) initTabs(); // Guard for fresh launch
  if (typeof restartAutosaveTimer === 'function') restartAutosaveTimer();
  // setMachine('DFA') above no-ops at boot because DFA is already the default,
  // so nothing has refreshed the Language section yet — without this it would
  // sit on its static placeholder markup until the first edit.
  if (typeof updateRPanel === 'function') updateRPanel();

  const sharedLinkLoaded = typeof loadSharedLinkFromURL === 'function' && loadSharedLinkFromURL();
  setTimeout(() => showStatus('Esc=Pointer · V=Pan · Space+Drag=Pan · S=State · T=Transition · H=Fit · Ctrl+Z=Undo'), sharedLinkLoaded ? 3200 : 600);
}

if (typeof loadBackup === 'function') {
  Promise.resolve(loadBackup()).catch(e => console.error('Backup load failed:', e)).then(finishBoot);
} else {
  initTabs(); // Create initial tab if no backup logic
  finishBoot();
}
