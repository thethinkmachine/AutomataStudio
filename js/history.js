import { App, Workspaces, activeWorkspaceId, getMachineConfig, largeMachineProfile, setR } from './state.js';
import { isMultiTape } from './machines/index.js';
import { Change, emit, subscribe } from './store.js';
import { toggleSnapToGrid } from './canvas.js';
import { refreshQuickSettings } from './quick-settings.js';
import { renderTabs, setSaveState } from './ui.js';
import { isAnyTM, showStatus } from './utils.js';
import { syncMachineSelectors } from './view.js';

/**
 * Run an edit as one undoable step: record where to come back to, apply it,
 * then announce it. Pass a narrower kind (or several) when the edit did not
 * touch the graph.
 *
 *     commit(() => { App.accepts.add(id); });
 *     commit(() => { … }, Change.ALPHABET, Change.GRAPH);
 *
 * It takes the edit rather than trusting the caller to have not made it yet.
 * The previous shape — `mutate(); commit();` — put the snapshot *after* the
 * change, while the ~45 `snapshot(); …; emit()` sites put it before. Two
 * orderings for one stack, and undo can only be written for one of them; the
 * mismatch cost a step on every undo. Handing the edit in makes the wrong
 * order unsayable.
 */
export function commit(edit, ...kinds) {
  snapshot();
  if (typeof edit === 'function') edit();
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
// repaint-only thing that IS persisted, and it takes the quiet mark
// (markViewDirty) rather than this one — it is saved, but it is not an edit.
subscribe(Change.GRAPH, markDirty);
subscribe(Change.ALPHABET, markDirty);
// Change.META is the third: the info card's text is part of what
// exportWorkspaceState and getWorkspaceData write, so rewording a blurb is an
// unsaved change in exactly the way moving the camera is.
subscribe(Change.META, markDirty);
subscribe(Change.GRAMMAR, markDirty);

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
// Everything an undo point has to put back. Serialising is separate from
// recording because undo and redo need the *current* state as a string without
// pushing it onto the stack they are about to pop.
function serializeState() {
  return JSON.stringify({
    machine: App.machine,
    states: App.states, transitions: App.transitions,
    startId: App.startId, accepts: [...App.accepts],
    sigma: [...App.sigma], stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount,
    stateN: App.stateN, transN: App.transN,
    notes: App.notes, noteN: App.noteN,
    dividers: App.dividers, dividerN: App.dividerN,
    // Building blocks are document content, so one Ctrl+Z takes back placing
    // one the way it takes back drawing a state. `blockId` rides along on the
    // states themselves — this is stringifying them whole.
    blocks: App.blocks, blockN: App.blockN, scope: App.scope,
    meta: App.meta,
    // The grammar rides along for the same reason App.meta does: it is part of
    // what getWorkspaceData saves, so one Ctrl+Z has to take back a retyped
    // rule the way it takes back a dragged state. Left out, the workbench put
    // an entry on this stack per keystroke and undid none of them.
    grammar: {
      vars: [...App.grammar.vars],
      start: App.grammar.start,
      productions: App.grammar.productions
    },
    config: captureSettings()
  });
}

/**
 * Record where to come back to, then make the edit.
 *
 * `App.history` holds *past* states only — the state you are looking at is
 * never on it. So this is called immediately BEFORE a mutation, which is what
 * the ~45 `snapshot(); …; emit()` sites throughout the app already do:
 *
 *     snapshot();
 *     App.accepts.add(id);
 *     emit(Change.GRAPH);
 */
// Two limits, because one of them is the wrong shape on its own. A depth of 300
// is generous for a ten-state machine and ruinous for a thousand-state one: an
// entry there is the whole workspace as JSON, a third of a megabyte, so three
// hundred of them is a hundred megabytes of retained string for a session that
// has done nothing but drag states around. The byte budget is what actually
// bounds the memory; the depth stays because on a small machine it is the
// friendlier limit and is never the one that bites.
export const HISTORY_MAX_ENTRIES = 300;
export const HISTORY_MAX_BYTES = 24 * 1024 * 1024;
// And a third, under the large-machine profile. The byte budget alone already
// bounds the memory, but it bounds it by *evicting*, so a thousand-state
// machine sits permanently at the cap with eighty entries of a third of a
// megabyte each, shifting one off the front on every edit. Capping the depth
// directly settles it sooner and keeps the stack a size the reader might
// actually walk back through. The per-edit stringify is not avoidable — it is
// what an undo point *is* — so this is a memory bound, not a frame one.
export const HISTORY_MAX_ENTRIES_LARGE = 60;

// And a fourth, for a tab the reader is not looking at.
//
// The two limits above bound the *live* stack, which is the one being pushed
// to. They say nothing about the other tabs, and every one of those holds a
// full stack of its own: exportWorkspaceState() copies history and future
// into the tab's blob, and Workspaces keeps every blob alive. Measured on a
// 200-state machine with 60 edits per tab, the stacks were 3,579 KB of a
// 3,641 KB tab — 98% of it — and eight such tabs retained 105 MB.
//
// stripTabForStorage() already makes this call for persistence, naming the
// stacks as the single largest cause of quota failure. The same reasoning is
// what this is: a stack you are not editing against is worth keeping some of,
// and is not worth a hundred megabytes.
//
// It is a trim rather than a drop, so switching back to a tab still finds its
// recent history. What it costs is depth: a background tab remembers the last
// HISTORY_STOWED_MAX_ENTRIES edits rather than all 300 of them.
export const HISTORY_STOWED_MAX_ENTRIES = 40;
export const HISTORY_STOWED_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Cap the undo and redo stacks of a workspace blob on its way into the
 * background. Mutates the blob rather than copying it — the caller has just
 * built it and nothing else holds it yet.
 *
 * The *newest* entries are what survive, because both stacks are popped from
 * the end: the top of App.history is the edit undo reaches first.
 */
export function trimStowedHistory(data) {
  if (!data) return data;
  for (const key of ['history', 'future']) {
    const stack = data[key];
    if (!Array.isArray(stack) || !stack.length) continue;
    let kept = stack.length > HISTORY_STOWED_MAX_ENTRIES
      ? stack.slice(stack.length - HISTORY_STOWED_MAX_ENTRIES)
      : stack;
    // Then by bytes, for the machine whose forty entries are still a third of
    // a megabyte each. One entry always survives, the way snapshot()'s own
    // byte loop keeps one.
    let bytes = 0;
    for (const entry of kept) bytes += entry.length;
    let from = 0;
    while (from < kept.length - 1 && bytes > HISTORY_STOWED_MAX_BYTES) {
      bytes -= kept[from].length;
      from++;
    }
    if (from) kept = kept.slice(from);
    if (kept !== stack) data[key] = kept;
  }
  return data;
}

export function historyDepthLimit() {
  return largeMachineProfile() ? HISTORY_MAX_ENTRIES_LARGE : HISTORY_MAX_ENTRIES;
}

function historyBytes() {
  let n = 0;
  for (const entry of App.history) n += entry.length;
  return n;
}

export function snapshot() {
  App.history.push(serializeState());
  App.future = [];
  while (App.history.length > historyDepthLimit()) App.history.shift();
  // Summed rather than tracked incrementally: undo and redo move entries
  // between the two stacks, and a counter maintained in three places is a
  // counter that drifts. Three hundred additions cost nothing next to the
  // stringify that just happened.
  let bytes = historyBytes();
  while (App.history.length > 1 && bytes > HISTORY_MAX_BYTES) {
    bytes -= App.history.shift().length;
  }

  markDirty();
}

// Flags the active workspace as having unsaved changes without pushing an undo
// entry. Some persisted state is part of what gets saved and restored but is
// not something the user undoes.
//
// This is the *loud* mark: it is what the tab's unsaved dot, the save
// indicator, the autosave countdown, the beforeunload prompt and the
// close-tab dialog all read. Use it only for a change the reader would call
// an edit. The camera is not one — see markViewDirty below.
export function markDirty() {
  if (!activeWorkspaceId || typeof Workspaces === 'undefined') return;
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (ws && !ws.dirty) {
    ws.dirty = true;
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof setSaveState === 'function') setSaveState('unsaved');
  }
}

// The quiet mark, and the whole of the difference is who reads it.
//
// The camera is persisted — exportWorkspaceState carries `cam`, so where you
// were looking is part of the workspace — but it is not an *edit*. Marking it
// with markDirty() meant panning fed seven consumers that have no business
// caring about the viewport: the tab's unsaved dot, the overflow menu's, the
// mobile one, the orange save indicator, the autosave countdown, and — the two
// that actually cost the reader something — the browser's "you have unsaved
// changes" prompt and the save-before-closing dialog. Scrolling the canvas
// warned you that you were about to lose work you had not done.
//
// So the viewport gets a flag of its own. `runAutosave` unions it into the set
// of tabs it writes, which is what keeps the camera surviving a reload; nothing
// else reads it. Cleared wherever `dirty` is cleared, because the write that
// clears one has just written the other.
//
// Idempotent for the same reason markDirty is: minimap navigation calls this
// per drag frame.
export function markViewDirty() {
  if (!activeWorkspaceId || typeof Workspaces === 'undefined') return;
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (ws) ws.viewDirty = true;
}
// Step back one entry, handing the state being left behind to redo.
//
// This used to discard the newest entry and restore the one *beneath* it, which
// is only right if the newest entry is the state you are currently looking at.
// It is not: snapshot() records the state before an edit, so the top of the
// stack is where that edit started. Restoring the entry below it therefore
// landed one action too early — after three edits, the first undo jumped back
// two of them, and the third was left unreachable by redo.
export function undo() {
  if (!App.history.length) return showStatus('Nothing to undo');
  App.future.push(serializeState());
  restoreSnapshot(App.history.pop());
}

export function redo() {
  if (!App.future.length) return showStatus('Nothing to redo');
  App.history.push(serializeState());
  restoreSnapshot(App.future.pop());
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
    if (mtmSec) mtmSec.style.display = isMultiTape(d.machine) ? 'flex' : 'none';
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
  App.blocks = d.blocks || []; App.blockN = d.blockN || 0;
  App.scope = (d.scope || []).filter(id => App.blocks.some(b => b.id === id));
  App.meta = d.meta || null;
  // Guarded rather than defaulted: an entry written before the grammar was
  // recorded here — one restored from IndexedDB across a version — must leave
  // the grammar standing rather than wipe it.
  if (d.grammar) {
    App.grammar.vars = new Set(d.grammar.vars || []);
    App.grammar.start = d.grammar.start || '';
    App.grammar.productions = d.grammar.productions || [];
  }
  // A restored snapshot can be missing objects the selection still names.
  App.selectedNotes.forEach(id => { if (!App.notes.some(n => n.id === id)) App.selectedNotes.delete(id); });
  App.selectedDividers.forEach(id => { if (!App.dividers.some(dv => dv.id === id)) App.selectedDividers.delete(id); });

  // Before the emit: the repaint below reads radius, label style and the
  // routing flags, so they have to be the restored ones.
  applySettings(d.config);

  emit(Change.ALPHABET, Change.GRAPH, Change.META, Change.GRAMMAR);
}

