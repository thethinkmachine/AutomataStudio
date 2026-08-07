import { App, Workspaces, activeWorkspaceId, adoptComponents, flushActiveComponent, getMachineConfig } from './state.js';
import { Change, emit, subscribe } from './store.js';
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
//  UNDO / REDO
// ══════════════════════════════════════════════════════════════════
export function snapshot() {
  // Reads the whole component tree, so it flushes first — see the COMPONENTS
  // section in state.js for why each reader does this on its own line rather
  // than the store doing it for everyone.
  //
  // Note the cost: history now holds the whole tree per entry, so a machine
  // with N components uses roughly N times the memory it used to at the same
  // 300-entry cap. Worth revisiting (snapshot the touched component plus a
  // tree hash) if that ever bites.
  flushActiveComponent();
  const s = JSON.stringify({
    machine: App.machine,
    states: App.states, transitions: App.transitions,
    components: App.components,
    rootComponentId: App.rootComponentId,
    componentPath: App.componentPath,
    componentN: App.componentN,
    startId: App.startId, accepts: [...App.accepts],
    sigma: [...App.sigma], stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha], flags: [...(App.flags || [])], tapeCount: App.tapeCount,
    stateN: App.stateN, transN: App.transN,
    notes: App.notes, noteN: App.noteN,
    dividers: App.dividers, dividerN: App.dividerN
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
    const flagSec = document.getElementById('flags-sec');
    if (flagSec) flagSec.style.display = cfg.hasActions ? '' : 'none';
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
  App.flags = Array.isArray(d.flags) ? [...d.flags] : [];
  App.stateN = d.stateN; App.transN = d.transN;
  App.notes = d.notes || []; App.noteN = d.noteN || 0;
  App.dividers = d.dividers || []; App.dividerN = d.dividerN || 0;
  if (App.selectedDividerId && !App.dividers.some(dv => dv.id === App.selectedDividerId)) App.selectedDividerId = null;

  // After the flat fields, which are the fallback root for a snapshot taken
  // before hierarchy existed. This is also what moves the canvas back to
  // whichever component the undone edit was made in — the snapshot carries
  // componentPath, so undo lands where the change happened rather than
  // wherever the user happens to be standing.
  adoptComponents(d);

  emit(Change.ALPHABET, Change.GRAPH);
}

