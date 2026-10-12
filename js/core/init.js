import { renderGamma, renderOutputAlpha, renderSigma } from '../editor/alphabet.js';
import { toggleSnapToGrid } from '../canvas/canvas.js';
import { renderBlockLibrary } from '../editor/blocks-ui.js';
import { initLangClaimOverflowObserver } from '../algorithms/language.js';
import { loadBackup, loadSharedLinkFromURL, markBootRestored, restartAutosaveTimer, syncDocumentLabels } from '../io/persistence.js';
import { checkLibraryUpdatesSoon, startLibraryLinks } from '../library/library-ui.js';
import { initDefBoxOverflowObserver, updateLPanel, updateRPanel } from '../canvas/render.js';
import { $, App, Workspaces } from './state.js';
import { DEFAULT_THEME } from '../ui/themes.js';
import { initMinimap, toggleMinimap } from '../canvas/minimap.js';
import { initPanelSectionReorder } from '../ui/panel-sections-ui.js';
import { initPanelFloat } from '../ui/panel-float.js';
import { applyTheme, initCanvasResizeObserver, initLPanelSections, initMobilePanelBar, initMobilePanels, initPanelResizers, initRPanelSections, initPanelTabs, initTabs, initToolbarCollapse, isMobilePanelLayout, setTool, toggleLPanelPin, toggleRPanelPin } from '../ui/ui.js';
import { showStatus } from './utils.js';
import { formatKbd, localizeKbdLabels } from '../ui/kbd.js';
import { setMachine, setView } from '../ui/view.js';
import { syncHistoryButtons } from './history.js';
import { initFraming } from '../ui/ui.js';
import { initSpeedControl } from '../simulation/speed-control.js';
import { initCanvasMotion } from '../canvas/canvas-motion.js';
import { installActions } from './actions.js';
import { installContextMenuPolicy } from '../ui/context-menu.js';
import { startAnalytics } from './analytics.js';
import { readFlag, readPref } from './prefs.js';

// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
// First, so every data-action control works from the first paint — the
// listener is delegated, so markup rendered later needs nothing further.
installActions();
// The browser's right-click menu only where it has something to do; the
// app's own menus are unaffected (js/ui/context-menu.js).
installContextMenuPolicy();
// The website reports its visits; dev, preview and the desktop app do not.
startAnalytics();
// KaTeX's auto-render, once, for any math already in the page — what the
// script tag's onload used to do. It is a deferred script ahead of this module
// and has normally run by now; if not, wait for it. Offline it never arrives.
if (typeof renderMathInElement === 'function') {
  renderMathInElement(document.body);
} else {
  document.querySelector('script[src*="katex"][src*="auto-render"]')
    ?.addEventListener('load', () => renderMathInElement(document.body), { once: true });
}
try {
  applyTheme(localStorage.getItem('automata-theme') || App.config.theme || DEFAULT_THEME, false);
} catch (e) {
  applyTheme(App.config.theme || DEFAULT_THEME, false);
}
renderSigma(); renderGamma(); renderOutputAlpha();
updateLPanel();
App.stackAlpha = new Set([App.config.sym.stackBottom]);
initSpeedControl();
const shapeTool = readPref('automata-shape-tool');
if (shapeTool === 'rect' || shapeTool === 'divider') App.lastShapeTool = shapeTool;
setMachine('DFA'); setTool('pointer'); setView('build');
// No boot snapshot: App.history holds states you can go *back* to, and at boot
// there is nothing behind the empty canvas. An entry here would make the first
// Ctrl+Z a no-op that still consumed a press.
// Attach the minimap's pointer, wheel and keyboard navigation.
initMinimap();
// Restore localStorage preferences
if (!readFlag('automata-minimap', true)) toggleMinimap();
if (!readFlag('automata-lpanel-pinned', true)) toggleLPanelPin();
if (!readFlag('automata-rpanel-pinned', true)) toggleRPanelPin();
App.config.wheelZoom = readFlag('automata-wheel-zoom', App.config.wheelZoom);
if (readFlag('automata-snap-grid')) toggleSnapToGrid(true);
initToolbarCollapse();
// Undo/redo start dimmed; edits and loads keep them current from history.js.
syncHistoryButtons();
// A fitted machine stays fitted as the overlays over it change.
initFraming();
// The breathing background: apply the preference, and rest when unattended.
initCanvasMotion();
// What Save, Save As and Open mean differs between the website and the desktop
// build, and the labels have to say which — see SAYING WHICH HOST THIS IS in
// js/io/persistence.js. Written once, because the answer cannot change.
syncDocumentLabels();
// And the shortcut labels, for the same reason: `⌘Z` on a Mac, `Ctrl+Z`
// everywhere else, from the one spec each label carries. See js/ui/kbd.js.
localizeKbdLabels();
initMobilePanels();
initLPanelSections();
initRPanelSections();
// After the collapse state, since the grips go into headers this may reveal.
initPanelSectionReorder();
// And after the reorder: a section restored to a window over the canvas is one
// `applySectionOrder` must already know to leave out of the panel.
initPanelFloat();
initPanelResizers();
initPanelTabs();
// After the tabs: the mobile sheet's head carries a strip of every tab, and
// `applyPanelLayout` is what decides which panel each one is on.
initMobilePanelBar();
initCanvasResizeObserver();
initDefBoxOverflowObserver();
initLangClaimOverflowObserver();
// Restoring now reads IndexedDB first, so it is asynchronous. Everything that
// depends on the restored workspaces — the empty-state guard, the autosave
// timer, and the shared-link import that may overwrite them — has to run after
// it resolves, or it would race a still-empty Workspaces array.
export async function finishBoot() {
  if (Workspaces.length === 0) initTabs(); // Guard for fresh launch
  restartAutosaveTimer();
  // setMachine('DFA') above no-ops at boot because DFA is already the default,
  // so nothing has refreshed the Language section yet — without this it would
  // sit on its static placeholder markup until the first edit.
  updateRPanel();
  // The saved block definitions. Read once at boot and then only when the
  // library itself changes (a save, a delete) — it is an IndexedDB round trip,
  // and nothing about drawing the machine can alter it.
  Promise.resolve(renderBlockLibrary()).catch(() => { });

  // Reading the link is asynchronous now that the payload is compressed; the
  // whole of finishBoot already runs off a promise, so awaiting it here costs
  // nothing and keeps the status hint timed against what actually happened.
  const sharedLinkLoaded = await loadSharedLinkFromURL();
  // The workspaces are restored and the link, if there was one, has been read.
  // Only now is it safe to let a file the OS handed us onto the canvas: on a
  // cold launch that path arrives while electron-bridge.js is being evaluated,
  // long before any of the above, and the restore would land on top of it. See
  // THE BOOT GATE in js/io/persistence.js.
  markBootRestored();
  // A library link — #lib=<id> from the website's "Open" button, #library=<id>
  // from a shared listing — is read after the restore for the reason the file
  // gate above exists: opening it places a tab, and the restore would otherwise
  // land on top of it. And a machine opened from the library last session is
  // checked against the published version, once, a few seconds in.
  const libraryLinkLoaded = await startLibraryLinks();
  if (!libraryLinkLoaded) checkLibraryUpdatesSoon();
  // Seven keyboard shortcuts, on a device with no keyboard, in a toast that
  // covers the top of the canvas for four seconds — every one of them names a
  // key a phone does not have. The touch shell says the same things with its
  // own labels, so there is nothing to replace it with.
  const bootHint = isMobilePanelLayout()
    ? 'Pick a tool below · pinch to zoom'
    : 'Esc=Select · V=Pan · Space+Drag=Pan · S=State · T=Transition · H=Fit · ' + formatKbd('Mod+Z') + '=Undo';
  setTimeout(() => showStatus(bootHint), sharedLinkLoaded ? 3200 : 600);
}

Promise.resolve(loadBackup()).catch(e => console.error('Backup load failed:', e)).then(finishBoot);
