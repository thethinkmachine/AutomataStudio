import { App, Workspaces, activeWorkspaceId, getMachineConfig, setR } from './state.js';
import { Change, emit, subscribe } from './store.js';
import { toggleSnapToGrid } from './canvas.js';
import { refreshQuickSettings } from './quick-settings.js';
import { renderTabs, setSaveState } from './ui.js';
import { isAnyTM, showStatus } from './utils.js';
import { syncMachineSelectors } from './view.js';

/**
 * Record an undo point and announce the change. This is the one call an edit
 * needs to make; it replaces the four-call snapshot/render/panel/panel sequence
 * that used to be copied to every mutation site. Pass a narrower kind (or
 * several) when the edit did not touch the graph.
 */
export function commit(...kinds) {
  snapshot();
  emit(...(kinds.length ? kinds : [Change.GRAPH]));
}

// A structural or alphabet edit dirties the active tab. snapshot() also calls
// markDirty directly, for paths that record an undo point without going through
// commit(); markDirty is idempotent, so the overlap is harmless.
//
// Change.CANVAS deliberately does NOT dirty the tab. It means "repaint only" —
// selection, hover and edge highlights — and none of that is part of what
// exportWorkspaceState persists. Marking dirty there would raise the
// unsaved-changes prompt for merely clicking a state. The camera is the one
// repaint-only thing that IS persisted, and canvas.js calls markDirty for it
// explicitly.
subscribe(Change.GRAPH, markDirty);
subscribe(Change.ALPHABET, markDirty);

// ══════════════════════════════════════════════════════════════════
//  UNDOABLE SETTINGS
// ══════════════════════════════════════════════════════════════════
// App.config holds two different kinds of thing, and only one of them belongs
// in the undo history.
//
// These are *document* settings: they describe how this machine is drawn, they
// travel with the workspace in exportWorkspaceState, and reversing one is the
// same sort of act as reversing a drag. Ctrl+Z covers them.
//
// The rest of App.config is *app preference* — theme, notation symbols, step
// budgets, autosave interval, export resolution. Recording those would make
// Ctrl+Z silently swap your theme or your ε symbol on the way back through an
// unrelated edit, and restoring config.theme without applyTheme() would leave
// the stylesheet disagreeing with the value it was set from. So the list is an
// allowlist rather than "config minus a few".
export const UNDOABLE_SETTINGS = [
  'radius', 'wrapStateLabels', 'edgeLabelStyle', 'clickHighlightMode',
  'snapToGrid', 'gridSnap',
  'layout.algorithm', 'layout.nodeSpacing',
  'render.curveOff', 'render.smartSelfLoops', 'render.autoRouteEdges',
  'render.smartLabels', 'render.avoidNodeOverlap', 'render.animateLayout',
  'render.nodeClearance'
];

function readPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function writePath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

export function captureSettings() {
  const out = {};
  for (const path of UNDOABLE_SETTINGS) {
    const v = readPath(App.config, path);
    if (v !== undefined) out[path] = v;
  }
  return out;
}

// Restores the allowlist and republishes what mirrors it. `radius` is the one
// that has a copy living elsewhere — R, which every module imported — and
// snapToGrid owns a button and a localStorage key, so it goes back through the
// function that holds all three rather than being assigned.
export function applySettings(saved) {
  // Snapshots taken before settings were recorded simply have no config; there
  // is nothing to restore and nothing to correct.
  if (!saved) return;
  const c = App.config;
  const radiusWas = c.radius;
  const snapWas = !!c.snapToGrid;

  for (const path of UNDOABLE_SETTINGS) {
    if (saved[path] !== undefined) writePath(c, path, saved[path]);
  }

  if (c.radius !== radiusWas) setR(c.radius);
  if (!!c.snapToGrid !== snapWas && typeof toggleSnapToGrid === 'function') {
    toggleSnapToGrid(!!c.snapToGrid);
  }
  if (typeof refreshQuickSettings === 'function') refreshQuickSettings();
}

// Records an undo point for a settings change, but only when one of the
// undoable values actually moved — otherwise clicking Apply with nothing
// changed would push an entry that undoes to an identical state.
export function snapshotSettings() {
  const now = JSON.stringify(captureSettings());
  const last = App.history[App.history.length - 1];
  if (last) {
    try {
      if (JSON.stringify(JSON.parse(last).config || {}) === now) return false;
    } catch (e) { /* unreadable entry — record rather than guess */ }
  }
  snapshot();
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  UNDO / REDO
// ══════════════════════════════════════════════════════════════════
export function snapshot() {
  const s = JSON.stringify({
    machine: App.machine,
    states: App.states, transitions: App.transitions,
    startId: App.startId, accepts: [...App.accepts],
    sigma: [...App.sigma], stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount,
    stateN: App.stateN, transN: App.transN,
    notes: App.notes, noteN: App.noteN,
    dividers: App.dividers, dividerN: App.dividerN,
    config: captureSettings()
  });
  App.history.push(s);
  App.future = [];
  if (App.history.length > 300) App.history.shift();

  markDirty();
}

// Flags the active workspace as having unsaved changes without pushing an undo
// entry. Some persisted state — the camera above all — is part of what gets
// saved and restored but is not something the user undoes. Without this, panning
// or zooming left the tab clean, so autosave skipped it entirely and the
// viewport survived a reload only when an unrelated edit happened to be pending.
export function markDirty() {
  if (!activeWorkspaceId || typeof Workspaces === 'undefined') return;
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (ws && !ws.dirty) {
    ws.dirty = true;
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof setSaveState === 'function') setSaveState('unsaved');
  }
}
export function undo() {
  if (App.history.length < 2) return showStatus('Nothing to undo');
  App.future.push(App.history.pop());
  restoreSnapshot(App.history[App.history.length - 1]);
}
export function redo() {
  if (!App.future.length) return showStatus('Nothing to redo');
  const s = App.future.pop();
  App.history.push(s);
  restoreSnapshot(s);
}
export function restoreSnapshot(s) {
  const d = JSON.parse(s);
  
  // If machine type changed during undo/redo, safely apply the machine switch internals
  if (d.machine && d.machine !== App.machine) {
    const cfg = getMachineConfig(d.machine);
    App.machine = d.machine;
    if (typeof syncMachineSelectors === 'function') syncMachineSelectors(d.machine);
    const badge = document.getElementById('mach-badge');
    if (badge) { badge.className = `badge ${cfg.badge}`; badge.textContent = cfg.label; }
    const stSec = document.getElementById('stack-sec');
    if (stSec) stSec.style.display = cfg.hasStack ? '' : 'none';
    const stackLbl = stSec?.querySelector('.sec-lbl');
    if (stackLbl) stackLbl.textContent = isAnyTM(d.machine) ? 'Tape Alphabet Γ' : 'Stack Alphabet Γ';
    const outSec = document.getElementById('output-sec');
    if (outSec) outSec.style.display = cfg.isTransducer ? '' : 'none';
    const mtmSec = document.getElementById('mtm-ctrl');
    if (mtmSec) mtmSec.style.display = (d.machine === 'MTM') ? 'flex' : 'none';
  }
  
  if (d.tapeCount !== undefined) {
    App.tapeCount = d.tapeCount;
    const tcSel = document.getElementById('tape-count-sel');
    if (tcSel) tcSel.value = App.tapeCount;
  }
  
  App.states = d.states; App.transitions = d.transitions;
  App.startId = d.startId; App.accepts = new Set(d.accepts || []);
  App.sigma = new Set(d.sigma || []); App.stackAlpha = new Set(d.stackAlpha || [App.config.sym.stackBottom]);
  App.outputAlpha = new Set(d.outputAlpha || ['0', '1']);
  App.stateN = d.stateN; App.transN = d.transN;
  App.notes = d.notes || []; App.noteN = d.noteN || 0;
  App.dividers = d.dividers || []; App.dividerN = d.dividerN || 0;
  if (App.selectedDividerId && !App.dividers.some(dv => dv.id === App.selectedDividerId)) App.selectedDividerId = null;

  // Before the emit: the repaint below reads radius, label style and the
  // routing flags, so they have to be the restored ones.
  applySettings(d.config);

  emit(Change.ALPHABET, Change.GRAPH);
}

