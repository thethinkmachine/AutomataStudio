import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { toggleSnapToGrid } from './canvas.js';
import { renderBlockLibrary } from './blocks-ui.js';
import { initLangClaimOverflowObserver } from './language.js';
import { loadBackup, loadSharedLinkFromURL, markBootRestored, restartAutosaveTimer, syncDocumentLabels } from './persistence.js';
import { initDefBoxOverflowObserver, updateLPanel, updateRPanel } from './render.js';
import { $, App, Workspaces } from './state.js';
import { DEFAULT_THEME } from './themes.js';
import { initMinimap, toggleMinimap } from './minimap.js';
import { initPanelSectionReorder } from './panel-sections-ui.js';
import { initPanelFloat } from './panel-float.js';
import { applyTheme, initCanvasResizeObserver, initLPanelSections, initMobilePanelBar, initMobilePanels, initPanelResizers, initRPanelSections, initPanelTabs, initTabs, initToolbarCollapse, isMobilePanelLayout, setTool, toggleLPanelPin, toggleRPanelPin } from './ui.js';
import { showStatus } from './utils.js';
import { setMachine, setView } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
try {
  applyTheme(localStorage.getItem('automata-theme') || App.config.theme || DEFAULT_THEME, false);
} catch (e) {
  applyTheme(App.config.theme || DEFAULT_THEME, false);
}
renderSigma(); renderGamma(); renderOutputAlpha();
updateLPanel();
App.stackAlpha = new Set([App.config.sym.stackBottom]);
if ($('sim-speed-sel')) $('sim-speed-sel').value = String(App.config.autoSpeed);
try {
  const st = localStorage.getItem('automata-shape-tool');
  if (st === 'rect' || st === 'divider') App.lastShapeTool = st;
} catch (e) { }
setMachine('DFA'); setTool('pointer'); setView('build');
// No boot snapshot: App.history holds states you can go *back* to, and at boot
// there is nothing behind the empty canvas. An entry here would make the first
// Ctrl+Z a no-op that still consumed a press.
// Attach the minimap's pointer, wheel and keyboard navigation.
initMinimap();
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
// What Save, Save As and Open mean differs between the website and the desktop
// build, and the labels have to say which — see SAYING WHICH HOST THIS IS in
// js/persistence.js. Written once, because the answer cannot change.
if (typeof syncDocumentLabels === 'function') syncDocumentLabels();
if (typeof initMobilePanels === 'function') initMobilePanels();
if (typeof initLPanelSections === 'function') initLPanelSections();
if (typeof initRPanelSections === 'function') initRPanelSections();
// After the collapse state, since the grips go into headers this may reveal.
initPanelSectionReorder();
// And after the reorder: a section restored to a window over the canvas is one
// `applySectionOrder` must already know to leave out of the panel.
initPanelFloat();
if (typeof initPanelResizers === 'function') initPanelResizers();
if (typeof initPanelTabs === 'function') initPanelTabs();
// After the tabs: the mobile sheet's head carries a strip of every tab, and
// `applyPanelLayout` is what decides which panel each one is on.
if (typeof initMobilePanelBar === 'function') initMobilePanelBar();
if (typeof initCanvasResizeObserver === 'function') initCanvasResizeObserver();
if (typeof initDefBoxOverflowObserver === 'function') initDefBoxOverflowObserver();
if (typeof initLangClaimOverflowObserver === 'function') initLangClaimOverflowObserver();
// Restoring now reads IndexedDB first, so it is asynchronous. Everything that
// depends on the restored workspaces — the empty-state guard, the autosave
// timer, and the shared-link import that may overwrite them — has to run after
// it resolves, or it would race a still-empty Workspaces array.
export async function finishBoot() {
  if (Workspaces.length === 0) initTabs(); // Guard for fresh launch
  if (typeof restartAutosaveTimer === 'function') restartAutosaveTimer();
  // setMachine('DFA') above no-ops at boot because DFA is already the default,
  // so nothing has refreshed the Language section yet — without this it would
  // sit on its static placeholder markup until the first edit.
  if (typeof updateRPanel === 'function') updateRPanel();
  // The saved block definitions. Read once at boot and then only when the
  // library itself changes (a save, a delete) — it is an IndexedDB round trip,
  // and nothing about drawing the machine can alter it.
  if (typeof renderBlockLibrary === 'function') {
    Promise.resolve(renderBlockLibrary()).catch(() => { });
  }

  // Reading the link is asynchronous now that the payload is compressed; the
  // whole of finishBoot already runs off a promise, so awaiting it here costs
  // nothing and keeps the status hint timed against what actually happened.
  const sharedLinkLoaded = typeof loadSharedLinkFromURL === 'function' && await loadSharedLinkFromURL();
  // The workspaces are restored and the link, if there was one, has been read.
  // Only now is it safe to let a file the OS handed us onto the canvas: on a
  // cold launch that path arrives while electron-bridge.js is being evaluated,
  // long before any of the above, and the restore would land on top of it. See
  // THE BOOT GATE in js/persistence.js.
  if (typeof markBootRestored === 'function') markBootRestored();
  // Seven keyboard shortcuts, on a device with no keyboard, in a toast that
  // covers the top of the canvas for four seconds — every one of them names a
  // key a phone does not have. The touch shell says the same things with its
  // own labels, so there is nothing to replace it with.
  const bootHint = isMobilePanelLayout()
    ? 'Pick a tool below · pinch to zoom'
    : 'Esc=Pointer · V=Pan · Space+Drag=Pan · S=State · T=Transition · H=Fit · Ctrl+Z=Undo';
  setTimeout(() => showStatus(bootHint), sharedLinkLoaded ? 3200 : 600);
}

if (typeof loadBackup === 'function') {
  Promise.resolve(loadBackup()).catch(e => console.error('Backup load failed:', e)).then(finishBoot);
} else {
  initTabs(); // Create initial tab if no backup logic
  finishBoot();
}
