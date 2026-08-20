import { tokenizeRHS } from './algorithms-cfg.js';
import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { applyCamera, hideCanvasContextMenu } from './canvas.js';
import { commit, snapshot } from './history.js';
import { importJFLAPText } from './import-jflap.js';
import { closeModal, showOverlay } from './modal.js';
import { refreshQuickSettings } from './quick-settings.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { runSim } from './simulation.js';
import { $, App, MachineExamples, MachineTypes, Workspaces, activeWorkspaceId, exportWorkspaceState, getMachineConfig, normalizeBoundarySymbolsForMachine, setActiveWorkspaceId, setR, setWorkspaces } from './state.js';
import { hideContextMenu } from './states-transitions.js';
import { Change, emit, subscribe } from './store.js';
import { autoFitLoadedMachine, fitToScreen, hideTabContextMenu, hideTabOverflowMenu, initTabs, markActiveWorkspaceSaved, renderTabs, repositionCanvasInfo, setSaveState, switchTab } from './ui.js';
import { hasPdaNondeterminism, hasSingleTapeNondeterminism, isAnyPDA, performClear, resetIds, showStatus } from './utils.js';
import { applyMachineSwitch } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
export function getWorkspaceData() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  
  // Explicitly allow-list only FSM model configuration, dropping all UI/Theme data.
  const cleanConfig = {
    transducerAccepts: App.config.transducerAccepts,
    twoWayTape: App.config.twoWayTape,
    maxPdaSteps: App.config.maxPdaSteps,
    maxTmSteps: App.config.maxTmSteps,
    pdaParadigm: App.config.pdaParadigm,
    sym: { ...App.config.sym },
    statePrefix: App.config.statePrefix
    // Note: gridSnap, layout, zoom, and radius are intentionally dropped as they are editor-specific
  };

  return {
    machine: App.machine,
    config: cleanConfig,
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    states: App.states,
    transitions: App.transitions,
    startId: App.startId,
    accepts: [...App.accepts],
    notes: App.notes,
    dividers: App.dividers,
    grammar: grammarData,
    cam: App.cam,
    // What the author says this machine is. Dropped here for as long as the
    // card was read-only, which is what made a description a property of the
    // file you loaded rather than of the machine you have — save once and it
    // was gone. Null when there is nothing to say; the load path reads
    // `data.meta` and has always tolerated its absence.
    meta: App.meta
  };
}

// ── In-app save ───────────────────────────────────────────────────
// Distinct from the Export actions below, which produce a *file*. This
// commits the workspace to localStorage and clears the tab's dirty mark.
// Edits are already backed up continuously; what this adds is an explicit,
// acknowledged save point, so the dirty dot means "not deliberately saved"
// rather than "not downloaded".
//
// Returns true when the workspace was persisted, false when storage
// rejected it (quota, private-mode) — callers that close a tab afterwards
// must not discard work on a failed save.
export let pendingWorkspaceSave = null;
export let autosaveTimer = null;
export let autosaveInProgress = false;
export let autosaveCountdownTimer = null;
export let autosaveDeadline = 0;
export const WORKSPACE_DB_NAME = 'automata-playground';
export const WORKSPACE_DB_VERSION = 1;
export const WORKSPACE_STORE_NAME = 'snapshots';

// Undo/redo stacks are deliberately excluded from anything that reaches
// storage. They can hold 300 JSON snapshots per tab, which is the single
// largest contributor to quota failures, and reloading discards the history
// anyway — persisting it costs the whole save the moment it tips over quota.
export function stripTabForStorage(ws) {
  if (!ws || !ws.data) return ws;
  const { history, future, ...data } = ws.data;
  return { ...ws, data };
}

export function getBackupPayload(savedIds = []) {
  if (typeof exportWorkspaceState !== 'function' || !activeWorkspaceId) return null;
  const act = Workspaces.find(w => w.id === activeWorkspaceId);
  if (act) act.data = exportWorkspaceState();
  const saved = new Set(savedIds);
  return {
    tabs: Workspaces.map(ws => stripTabForStorage(saved.has(ws.id) ? { ...ws, dirty: false } : ws)),
    activeId: activeWorkspaceId,
    config: App.config
  };
}

export function openWorkspaceDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(WORKSPACE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open workspace storage'));
  });
}

// Reads back what persistWorkspaceAsync wrote. Returns null when there is no
// IndexedDB, no database yet, or no snapshot — every one of which is a normal
// first-run state, so the caller falls back to the localStorage backup rather
// than treating it as an error.
export async function readWorkspaceSnapshot() {
  let db;
  try {
    db = await openWorkspaceDb();
  } catch {
    return null;
  }
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE_NAME, 'readonly');
      const req = tx.objectStore(WORKSPACE_STORE_NAME).get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Could not read workspace storage'));
      tx.onabort = () => reject(tx.error || new Error('Could not read workspace storage'));
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function persistWorkspaceAsync(payload) {
  const db = await openWorkspaceDb();
  if (!db) {
    await Promise.resolve();
    localStorage.setItem('automata-backup', JSON.stringify(payload));
    return 'localStorage';
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_STORE_NAME, 'readwrite');
    tx.objectStore(WORKSPACE_STORE_NAME).put(payload, 'current');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save workspace'));
    tx.onabort = () => reject(tx.error || new Error('Could not save workspace'));
  });
  db.close();
  return 'indexedDB';
}

export async function saveWorkspace(opts = {}) {
  if (pendingWorkspaceSave) return pendingWorkspaceSave;
  if (typeof setSaveState === 'function') setSaveState('saving');

  pendingWorkspaceSave = Promise.resolve().then(async () => {
    const payload = getBackupPayload([activeWorkspaceId]);
    if (!payload) return false;
    const backend = await persistWorkspaceAsync(payload);
    // Keep the legacy backup current for older builds and unload recovery.
    const active = Workspaces.find(ws => ws.id === activeWorkspaceId);
    const wasDirty = active ? active.dirty : false;
    if (active) active.dirty = false;
    // A failed mirror-write is reported no matter which backend took the
    // primary copy: the two stores must not silently diverge, and reporting
    // success here is what previously let a quota error pass as a save.
    if (!saveBackup()) {
      if (active) active.dirty = wasDirty;
      throw new Error('Could not update workspace backup');
    }
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof setSaveState === 'function') setSaveState(Workspaces.some(ws => ws.dirty) ? 'unsaved' : 'saved');
    if (!opts.silent) showStatus('Workspace saved');
    return true;
  }).catch(() => {
    if (typeof setSaveState === 'function') setSaveState('error', 'Save failed');
    showStatus('Could not save — storage is unavailable');
    return false;
  }).finally(() => {
    pendingWorkspaceSave = null;
  });

  return pendingWorkspaceSave;
}

// Saves a specific tab, which may not be the active one (bulk closes walk
// tabs that aren't on screen). Only the active tab holds live state in App,
// so the others just need their existing snapshot flushed.
export async function saveWorkspaceById(id) {
  const ws = Workspaces.find(w => w.id === id);
  if (!ws) return true;
  if (id === activeWorkspaceId) return saveWorkspace({ silent: true });
  const wasDirty = ws.dirty;
  try {
    const payload = getBackupPayload([id]);
    if (!payload) return false;
    await persistWorkspaceAsync(payload);
    ws.dirty = false;
    if (!saveBackup()) throw new Error('Could not update workspace backup');
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof setSaveState === 'function') setSaveState(Workspaces.some(item => item.dirty) ? 'unsaved' : 'saved');
    return true;
  } catch {
    ws.dirty = wasDirty;
    if (typeof setSaveState === 'function') setSaveState('error', 'Save failed');
    showStatus('Could not save — browser storage is full or unavailable');
    return false;
  }
}

export async function runAutosave() {
  if (autosaveInProgress || pendingWorkspaceSave || typeof Workspaces === 'undefined') return;
  const dirtyIds = Workspaces.filter(ws => ws.dirty).map(ws => ws.id);
  if (!dirtyIds.length) return;
  autosaveInProgress = true;
  if (typeof setSaveState === 'function') setSaveState('saving', 'Autosaving…');
  let allSaved = true;
  try {
    for (const id of dirtyIds) {
      if (!await saveWorkspaceById(id)) allSaved = false;
    }
  } finally {
    autosaveInProgress = false;
  }
  if (typeof setSaveState === 'function') {
    setSaveState(allSaved && !Workspaces.some(ws => ws.dirty) ? 'saved' : allSaved ? 'unsaved' : 'error');
  }
}

export function restartAutosaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (autosaveCountdownTimer) clearInterval(autosaveCountdownTimer);
  autosaveTimer = null;
  autosaveCountdownTimer = null;
  autosaveDeadline = 0;
  const interval = Number(App.config.autosaveIntervalMs ?? 15000);
  const countdown = $('autosave-countdown');
  if (!Number.isFinite(interval) || interval <= 0) {
    if (countdown) countdown.textContent = '';
    return;
  }
  const safeInterval = Math.max(1000, interval);
  // The countdown only means something when there is unsaved work for the next
  // tick to save. On a clean workspace it counted down forever regardless,
  // which put permanent motion in the corner of the chrome and told the user
  // nothing. Blank unless a tab is actually dirty.
  const updateCountdown = () => {
    if (!countdown) return;
    const pending = typeof Workspaces !== 'undefined' && Workspaces.some(ws => ws.dirty);
    countdown.textContent = pending
      ? String(Math.max(1, Math.ceil((autosaveDeadline - Date.now()) / 1000)))
      : '';
  };
  autosaveDeadline = Date.now() + safeInterval;
  updateCountdown();
  autosaveTimer = setInterval(() => {
    autosaveDeadline = Date.now() + safeInterval;
    updateCountdown();
    void runAutosave();
  }, safeInterval);
  autosaveCountdownTimer = setInterval(updateCountdown, 250);
  autosaveTimer.unref?.();
  autosaveCountdownTimer.unref?.();
}

export function saveJSON() {
  const data = getWorkspaceData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'automaton.json'; a.click();
  showStatus('Saved as JSON!');
  if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
}

export function toggleSaveMenu(e) {
  e.stopPropagation();
  const m = $('save-menu');
  if (!m) return;
  if (m.style.display === 'block') { hideSaveMenu(); return; }
  const r = e.currentTarget.getBoundingClientRect();
  m.style.display = 'block';
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - 248)) + 'px';
  m.style.top = (r.bottom + 6) + 'px';
}
export function hideSaveMenu() {
  const m = $('save-menu');
  if (m) m.style.display = 'none';
}
document.addEventListener('click', () => hideSaveMenu());

export function loadJSON() { $('file-input').click(); }

export function handleFiles(files) {
  const f = files[0]; if (!f) return;
  const lower = f.name.toLowerCase();
  const isPng = lower.endsWith('.png');
  const isJflap = lower.endsWith('.jff') || lower.endsWith('.jflap');
  const reader = new FileReader();

  reader.onload = ev => {
    try {
      // JFLAP files carry their own schema; importJFLAPText validates and
      // loads them, so they never reach the workspace JSON path below.
      // JFLAP carries no description of its own, so anything the previous
      // machine had to say goes away with it.
      if (isJflap) { importJFLAPText(ev.target.result); showExampleCard(null); return; }

      let data;
      if (isPng) {
        const text = new TextDecoder().decode(ev.target.result);
        const marker = "\n--AutomataData--\n";
        const parts = text.split(marker);
        if (parts.length < 2) {
          showStatus('Error: No workspace data found in this PNG');
          return;
        }
        data = JSON.parse(parts[1]);
      } else {
        data = JSON.parse(ev.target.result);
      }
      validateSchema(data);
      loadData(data);
      // A saved workspace usually has no `meta`; an example or a StateMate
      // result saved to disk does. Either way the card is retargeted rather
      // than left describing the machine that was just replaced.
      showExampleCard(data.meta || null);
      showStatus('Workspace loaded!');
    } catch (err) {
      console.error(err);
      if (isJflap) { showStatus(`Could not import JFLAP file: ${err.message}`); return; }
      const isCustomErr = err.message && !err.message.includes('JSON');
      showStatus(isCustomErr ? `Validation Error: ${err.message}` : (isPng ? 'Could not extract workspace data' : 'Invalid JSON file'));
    }
  };

  if (isPng) reader.readAsArrayBuffer(f);
  else reader.readAsText(f);
}

export function onFileLoad(e) {
  handleFiles(e.target.files);
  e.target.value = '';
}

// Drag & Drop
window.addEventListener('dragover', e => {
  e.preventDefault();
  const b = $('status-bar');
  b.textContent = 'Drop to load';
  b.classList.add('show');
  clearTimeout(b._t);
});
window.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) $('status-bar').classList.remove('show');
});
window.addEventListener('drop', e => {
  e.preventDefault();
  handleFiles(e.dataTransfer.files);
});

// ══════════════════════════════════════════════════════════════════
//  SHAREABLE LINK
// ══════════════════════════════════════════════════════════════════
// Unicode-safe base64url codec (plain btoa/atob choke on non-Latin1 chars
// like the ε symbols that show up in every workspace's config).
export function b64UrlEncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64UrlDecodeUnicode(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export const SHARE_HASH_PREFIX = '#share=';

export function getShareableLink() {
  const encoded = b64UrlEncodeUnicode(JSON.stringify(getWorkspaceData()));
  return `${location.origin}${location.pathname}${SHARE_HASH_PREFIX}${encoded}`;
}

export function copyShareableLink() {
  const url = getShareableLink();
  const onCopied = () => showStatus('Shareable link copied to clipboard!');
  const onFailed = () => window.prompt('Copy this link:', url);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onCopied).catch(onFailed);
  } else {
    onFailed();
  }
}

// Reads a #share=… link on page load and swaps it into the current workspace,
// the same way dropping a JSON/PNG file does.
export function loadSharedLinkFromURL() {
  if (!location.hash.startsWith(SHARE_HASH_PREFIX)) return false;
  const encoded = location.hash.slice(SHARE_HASH_PREFIX.length);
  // Strip the hash immediately so refreshing later doesn't re-import stale data
  // over whatever the user has since built.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = JSON.parse(b64UrlDecodeUnicode(encoded));
    validateSchema(data);
    loadData(data);
    saveBackup();
    showStatus('Loaded machine from shared link!');
    return true;
  } catch (err) {
    console.error(err);
    showStatus('Could not load the shared link — it may be corrupted or from an incompatible version.');
    return false;
  }
}

export function validateSchema(data) {
  if (!data || typeof data !== 'object') throw new Error("Data must be a valid JSON object.");
  
  const validMachines = Object.keys(MachineTypes);
  if (!data.machine || !validMachines.includes(data.machine)) {
    throw new Error(`Missing or unsupported machine type: ${data.machine || 'undefined'}`);
  }

  // Core properties MUST be present, no partial loading
  if (!Array.isArray(data.sigma)) throw new Error("Missing required 'sigma' array.");
  if (!Array.isArray(data.states)) throw new Error("Missing required 'states' array.");
  if (!Array.isArray(data.transitions)) throw new Error("Missing required 'transitions' array.");
  if (!Array.isArray(data.accepts)) throw new Error("Missing required 'accepts' array.");

  // Conditional requirements based on machine type
  if (isAnyPDA(data.machine) && !Array.isArray(data.stackAlpha)) {
    throw new Error("Stack/queue-based machines require a 'stackAlpha' array.");
  }
  if (getMachineConfig(data.machine).isTransducer && !Array.isArray(data.outputAlpha)) {
    throw new Error("Transducers require an 'outputAlpha' array.");
  }
  if (getMachineConfig(data.machine).isWeighted) {
    for (const t of data.transitions) {
      if (t.weight === undefined) continue;
      const w = Number(t.weight);
      if (!Number.isFinite(w) || w < 0 || w > 1) {
        throw new Error(`Transition '${t.id}' has probability '${t.weight}' — must be a number between 0 and 1.`);
      }
    }
  }
  // Only the multi-tape machine has a tape count to state; every other Turing
  // machine has exactly one by definition. Demanding it from all of them
  // rejected the bundled tm/ndtm examples on import — they omit the field, and
  // loadExample never validates, so nothing caught it.
  if (data.machine === 'MTM' && typeof data.tapeCount !== 'number') {
    throw new Error("Multi-tape Turing Machines require a numeric 'tapeCount'.");
  }

  // Validate States deeply
  for (const s of data.states) {
    if (typeof s !== 'object' || s === null || typeof s.id === 'undefined') {
      throw new Error("Each state must be an object containing an 'id' property.");
    }
  }

  // Validate Transitions deeply
  for (const t of data.transitions) {
    if (typeof t !== 'object' || t === null || typeof t.id === 'undefined' || typeof t.from === 'undefined' || typeof t.to === 'undefined') {
      throw new Error("Each transition must be an object with 'id', 'from', and 'to' properties.");
    }
  }

  // Notes are optional (older files won't have them); if present, just check the shape.
  if (data.notes !== undefined) {
    if (!Array.isArray(data.notes)) throw new Error("'notes' must be an array.");
    for (const n of data.notes) {
      if (typeof n !== 'object' || n === null || typeof n.id === 'undefined') {
        throw new Error("Each note must be an object containing an 'id' property.");
      }
    }
  }

  // Dividers are optional too, and purely decorative — only the geometry has
  // to be sound, since a NaN coordinate would render an invisible-but-clickable
  // line rather than failing loudly.
  if (data.dividers !== undefined) {
    if (!Array.isArray(data.dividers)) throw new Error("'dividers' must be an array.");
    for (const d of data.dividers) {
      if (typeof d !== 'object' || d === null || typeof d.id === 'undefined') {
        throw new Error("Each divider must be an object containing an 'id' property.");
      }
      if (!['x1', 'y1', 'x2', 'y2'].every(k => Number.isFinite(d[k]))) {
        throw new Error("Each divider needs finite 'x1', 'y1', 'x2', and 'y2' coordinates.");
      }
    }
  }

  const cfg = getMachineConfig(data.machine);
  if (!cfg.hasEpsilon && data.transitions.some(t => t.symbol === App.config.sym.eps)) {
    throw new Error(`${data.machine} does not allow epsilon-read transitions.`);
  }

  // Validate Grammar
  if (data.grammar) {
    if (typeof data.grammar !== 'object') throw new Error("'grammar' must be an object.");
    if (data.grammar.vars && !Array.isArray(data.grammar.vars)) throw new Error("'grammar.vars' must be an array.");
    if (data.grammar.productions && !Array.isArray(data.grammar.productions)) throw new Error("'grammar.productions' must be an array.");
  }
  
  return true;
}

export function normalizeGrammarData(grammar) {
  const productions = Array.isArray(grammar?.productions) ? grammar.productions : [];
  const vars = new Set(Array.isArray(grammar?.vars) ? grammar.vars : []);
  productions.forEach(p => {
    if (typeof p?.lhs === 'string' && p.lhs) vars.add(p.lhs);
  });
  const start = grammar?.start || productions[0]?.lhs || '';
  const normalizedProductions = productions.map(p => {
    const rhs = typeof p?.rhs === 'string' ? p.rhs : App.config.sym.eps;
    const rhsArr = Array.isArray(p?.rhsArr)
      ? [...p.rhsArr]
      : (typeof tokenizeRHS === 'function'
        ? tokenizeRHS(rhs, vars)
        : (rhs === App.config.sym.eps ? [App.config.sym.eps] : rhs.split('')));
    return { ...p, rhs, rhsArr };
  });
  return { vars, start, productions: normalizedProductions };
}

export function loadData(d, isExample) {
  App.machine = d.machine || 'DFA'; App.sigma = new Set(d.sigma || []);
  App.stackAlpha = new Set(d.stackAlpha || [App.config.sym.stackBottom]);
  App.outputAlpha = new Set(d.outputAlpha || []);
  if (d.tapeCount) App.tapeCount = d.tapeCount;
  // The tape model travels with the machine that assumes it — a JFLAP file
  // is written for a two-way tape and decides a different language without
  // one. Only an explicit boolean applies, so a file that says nothing
  // leaves the user's setting alone.
  if (typeof d.twoWayTape === 'boolean') App.config.twoWayTape = d.twoWayTape;
  App.states = d.states || [];
  App.transitions = d.transitions || []; App.startId = d.startId || null;
  App.accepts = new Set(d.accepts || []);
  App.notes = Array.isArray(d.notes) ? d.notes : [];
  App.dividers = Array.isArray(d.dividers) ? d.dividers : [];
  App.selectedNotes.clear();
  App.selectedDividers.clear();
  if (App.machine === 'TM' && hasSingleTapeNondeterminism(App.transitions)) {
    App.machine = 'NDTM';
  }
  // Migration for legacy PDA type
  if (App.machine === 'PDA' || App.machine === 'DPDA') {
    App.machine = hasPdaNondeterminism(App.transitions) ? 'NPDA' : 'DPDA';
  }
  resetIds();
  if (d.grammar) {
    const grammar = normalizeGrammarData(d.grammar);
    App.grammar.vars = grammar.vars;
    App.grammar.start = grammar.start;
    App.grammar.productions = grammar.productions;
  }
  if (d.config) {
    // Drop any legacy theme or presentation properties that might be in old files
    const { theme, export: exp, exportRes, pdaParadigm, sym, ...loadedConfig } = d.config;
    App.config = {
      ...App.config,
      ...loadedConfig,
      sym: { ...App.config.sym, ...(sym || {}) },
      pdaParadigm: pdaParadigm || 'explicit'
    };
    // See importWorkspaceState: R has to be republished whenever config is
    // replaced, or the canvas keeps drawing at the previous radius.
    setR(App.config.radius);
    // The quick-settings popover mirrors five of these keys. It re-reads on
    // open, which covers every path that goes through a click — but a file
    // dropped on the canvas replaces the config without one, leaving an open
    // popover showing the settings of the machine you just replaced.
    refreshQuickSettings();
  }
  else { migrateLegacySymbols(d); }
  if (d.cam) { App.cam = { ...d.cam }; }

  if (typeof normalizeBoundarySymbolsForMachine === 'function') {
    normalizeBoundarySymbolsForMachine(App.machine);
  }

  // Update view without confirm bypass
  if (typeof applyMachineSwitch === 'function') {
    applyMachineSwitch(App.machine);
  }
  renderSigma(); renderGamma(); renderOutputAlpha();
  emit(Change.GRAPH);

  if (d.cam) { applyCamera(); }
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);

  if (!isExample) snapshot();
}

export function migrateLegacySymbols(d) {
  const LEGACY_EPS = 'ε', LEGACY_BLANK = '⊔', LEGACY_Z0 = 'Z';
  const newE = App.config.sym.eps, newB = App.config.sym.blank, newZ = App.config.sym.stackBottom;
  const mapSym = s => (s === LEGACY_EPS ? newE : s === LEGACY_BLANK ? newB : s === LEGACY_Z0 ? newZ : s);

  if (d.sigma) d.sigma = d.sigma.map(mapSym);
  if (d.stackAlpha) d.stackAlpha = d.stackAlpha.map(mapSym);
  if (d.outputAlpha) d.outputAlpha = d.outputAlpha.map(mapSym);
  if (d.transitions) {
    d.transitions.forEach(t => {
      if (t.symbol !== undefined) t.symbol = mapSym(t.symbol);
      if (t.write !== undefined) t.write = mapSym(t.write);
      if (t.pop !== undefined) t.pop = mapSym(t.pop);
      if (t.push !== undefined) t.push = mapSym(t.push);
      if (t.tapeSyms) t.tapeSyms = t.tapeSyms.map(mapSym);
      if (t.tapeWrites) t.tapeWrites = t.tapeWrites.map(mapSym);
    });
  }
  if (d.grammar && d.grammar.productions) {
    d.grammar.productions.forEach(p => {
      p.rhs = p.rhs.split('').map(mapSym).join('');
    });
  }
}


// Auto Backup/Restore via LocalStorage
// Returns true when the payload reached localStorage. The explicit Save
// action reports failure to the user, so a quota error can no longer pass
// silently as a successful save.
export function saveBackup() {
  if (typeof exportWorkspaceState !== 'function' || !activeWorkspaceId) return false;
  // Ensure the active tab gets its latest snapshot
  const act = Workspaces.find(w => w.id === activeWorkspaceId);
  if (act) act.data = exportWorkspaceState();

  const payload = {
    tabs: Workspaces.map(stripTabForStorage),
    activeId: activeWorkspaceId,
    config: App.config
  };
  try {
    localStorage.setItem('automata-backup', JSON.stringify(payload));
    return true;
  } catch (e) {
    return false;
  }
}

// The incidental persistence that tab operations do (switch, create, close,
// reorder). These are not user-initiated saves, so they stay quiet on success
// — but a failure here means storage is full or unavailable, and silently
// leaving the indicator on "Saved" would misreport the workspace as durable.
export function saveBackupChecked() {
  const ok = saveBackup();
  if (!ok && typeof setSaveState === 'function') setSaveState('error', 'Save failed');
  return ok;
}

// Prefers the IndexedDB snapshot, which is where saveWorkspace puts the
// authoritative copy; localStorage is the fallback for first run, private
// mode, and builds that predate the IndexedDB backend.
export async function readLatestBackup() {
  const snapshot = await readWorkspaceSnapshot();
  if (snapshot && Array.isArray(snapshot.tabs) && snapshot.tabs.length) return snapshot;
  try {
    const raw = localStorage.getItem('automata-backup');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadBackup() {
  try {
    const loaded = await readLatestBackup();
    if (!loaded) return;

    // Check if it's the new multi-tab format
    if (loaded.tabs && Array.isArray(loaded.tabs)) {
      if (loaded.config) {
        // Hydrate config safely preserving theme/defaults
          const { theme, export: exp, exportRes, pdaParadigm, sym, ...loadedConfig } = loaded.config;
          App.config = {
            ...App.config,
            ...loadedConfig,
            sym: { ...App.config.sym, ...(sym || {}) },
            pdaParadigm: pdaParadigm || 'explicit'
          };
      }
      
      setWorkspaces(loaded.tabs);
      const targetId = loaded.activeId || Workspaces[0].id;
      
      // We set activeWorkspaceId to null to force switchTab to inject the data fully
      setActiveWorkspaceId(null);
      switchTab(targetId);
    } else {
      // Monolithic fallback migration
      loadData(loaded);
      
      // Inject the monolith state into a fresh tab correctly
      if (typeof initTabs === 'function') initTabs();
    }
  } catch (e) { console.error('Backup load failed:', e); }
}

// Work is always flushed on the way out, so nothing is lost outright — but a
// tab left dirty was never deliberately saved, and reloading also discards
// the undo history and the reopen-closed-tab stack. Browsers render their own
// generic wording here; the returnValue assignment is what triggers it.
window.addEventListener('beforeunload', e => {
  saveBackup();
  if (typeof Workspaces === 'undefined' || !Workspaces.some(w => w.dirty)) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
});


// ══════════════════════════════════════════════════════════════════
//  EXAMPLES
// ══════════════════════════════════════════════════════════════════
//  The catalogue and the loader. The dialog that presents them belongs to
//  js/statemate-ui.js, which puts the examples under one input alongside
//  the exact algorithms and the model — see the note at the top of that
//  file for why the examples stayed rather than being replaced.

export function getMachineExampleOptions() {
  const list = (typeof MachineExamples !== 'undefined' && MachineExamples[App.machine]) || null;
  if (list && list.length) return list;
  const cfg = getMachineConfig(App.machine);
  return cfg.file ? [{ file: cfg.file, label: 'Example' }] : [];
}

function searchableExampleText(opt) {
  return [opt.label, opt.file, opt.meta?.title, opt.meta?.blurb]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

export function filterMachineExampleOptions(options, query) {
  const terms = String(query || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return options;
  return options.filter(opt => {
    const text = searchableExampleText(opt);
    return terms.every(term => text.includes(term));
  });
}

export function loadExampleFile(file) {
  const executeLoad = () => {
    fetch(`js/examples/${file}.json`)
      .then(res => res.json())
      .then(data => {
        // The undo point goes before the edit, not after it. This used to end
        // in snapshot(), which recorded the example that had just been loaded
        // — so the first Ctrl+Z restored the example rather than the work it
        // replaced. performClear() empties App.history as part of clearing the
        // canvas, so the stack is carried across it by hand; without that,
        // loading an example is an edit that cannot be undone AND discards
        // every undo point behind it.
        snapshot();
        const history = App.history.slice();
        performClear();
        App.history = history;
        App.future = [];

        loadData(data, true);
        showExampleCard(data.meta);
        showStatus(`Example: ${App.machine} loaded`);
      })
      .catch(err => {
        console.error(err);
        showStatus('Failed to load example');
      });
  };

  if (App.states.length > 0) {
    $('confirm-title').textContent = 'Load Example?';
    $('confirm-msg').textContent = `Loading the ${App.machine} example will clear your current workspace. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      executeLoad();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
  } else {
    executeLoad();
  }
}

// ══════════════════════════════════════════════════════════════════
//  THE INFO CARD
// ══════════════════════════════════════════════════════════════════
//  THE INFO CARD
// ══════════════════════════════════════════════════════════════════
//  What the machine on the canvas is, floating over the canvas itself. It
//  shows itself briefly after a load or a StateMate run and then folds back
//  into the small button at the top-left corner, which is the way back to it.
//
//  Two rules make the auto-hide unobtrusive rather than annoying. A card the
//  *reader* opened never times out — only one the app opened on their behalf.
//  And the countdown stops the moment the pointer is over the card or the
//  caret is in it, because the one certain sign someone is still reading is
//  that they are pointing at it. How long it waits is App.config.cardAutoHideMs
//  (0 = never), because "it vanished while I was reading" and "it sat there in
//  my way" are both real complaints and neither is a bug.
//
//  It is also *writable*, which is why the text lives in `App.meta` rather
//  than in a module-scoped variable here. The card used to be readable only,
//  and reachable only by loading something that arrived with a description —
//  a bundled example, or a StateMate result — so a machine you drew yourself
//  could never have one, and a described machine lost its description the
//  moment you saved over it, because saveJSON never wrote `meta` back out.
//  Putting it on App fixes both at once by making the card document content:
//  exportWorkspaceState carries it between tabs, getWorkspaceData writes it
//  to the .json and the embedded PNG and the share link, and serializeState
//  puts it on the undo stack beside the diagram it describes.
//
//  ── There is one card, and it is the editor ──
//
//  The card used to have two states: a read view, and an edit *mode* reached
//  through a ✎ and left through Save or Cancel. There is now one view whose
//  fields happen to be writable — click the title and the caret is in the
//  title. That is one less thing to discover, but it also moves where the
//  commit boundary is, and the three rules that keep it honest are:
//
//    * **A field commits when you leave it**, on ⏎ or on blur, and never per
//      keystroke — otherwise every letter is an undo point. Escape puts the
//      field back to what App.meta says and gives up focus, which is what
//      Cancel used to be, at the granularity of the thing you were editing.
//    * **A commit of ours does not redraw the card.** `localMetaWrite` is up
//      while our own `commit()` runs, so the Change.META subscriber stands
//      down: the DOM is already what the write says, and rebuilding it under
//      a pointer that is mid-gesture (cycling a verdict, clicking the next
//      chip) destroys the node the gesture is on. Every other writer of
//      App.meta — undo, a load, a tab switch — still gets the full redraw.
//    * **A word being typed for the first time is not in App.meta yet.** The
//      chip the + button makes is `pending`: it lives in the DOM, commits on
//      ⏎ or on blur, and removes itself if it is abandoned empty. Committing
//      on the click instead would put a bare ε on the card and cost an undo
//      point to take back, and would make "add a word" two steps of history
//      for one thing the reader did.
//
//  A chip still *runs* its word on click — that is the one thing the card can
//  do that no panel can, and losing it to an edit gesture would be a poor
//  trade. Editing a chip's text is therefore the deliberate gesture beside it:
//  double-click, or F2 from the keyboard.

// Default countdown. App.config.cardAutoHideMs is what actually runs; this is
// what an imported config predating the setting reads as.
export const CARD_AUTO_HIDE_MS = 13000;
// Caps, not validation: the card is ~320px wide and floats over the diagram,
// so the limit is what still reads as a card rather than what fits in memory.
export const CARD_TITLE_MAX = 70;
export const CARD_BLURB_MAX = 400;
export const CARD_WORD_MAX = 60;
export const CARD_WORDS_MAX = 12;

// The verdict a test word carries, cycled by the mark on its chip. The empty
// string is a word worth trying with nothing claimed about the outcome — the
// honest state for "watch what happens here", and the one a chip typed into a
// blank row starts from if the author does not commit to an answer.
const EXPECT_CYCLE = ['accept', 'reject', ''];
// A filled dot, an open ring, and a faint dot — one shape at three weights,
// which is what makes the three states read as one control at a glance. They
// were a ✓ and an ✕ until the ✕ turned out to be the same glyph as the remove
// button two pixels away: a rejecting chip appeared to carry two close
// buttons, and the one that meant "expected to reject" looked destructive.
// The colour already carries accept-vs-reject; the mark only has to carry
// *claimed* vs *not claimed*.
const EXPECT_MARK = { accept: '●', reject: '○', '': '·' };
const EXPECT_TIP = {
  accept: 'Expected to be accepted — click to change',
  reject: 'Expected to be rejected — click to change',
  '': 'No verdict claimed — click to change'
};

let cardTimer = null;
// The card's own nodes, set as it is drawn: `{title, blurb, chips, add}`, with
// each chip carrying `__parts` of its own. Reached this way rather than through
// querySelector for the same reason render.js does it — the node is already in
// hand at the one place that made it, and a selector is a second description of
// the DOM that can drift from the first.
let cardParts = {};
// Up while this module's own commit() runs. The card's DOM is already what the
// write says, so redrawing it would only destroy the node the gesture that
// caused the write is standing on.
let localMetaWrite = false;
// Which field the caret is in, or null. Read by isEditingExampleCard, and the
// reason a card being typed into never times out.
let cardFocusField = null;

function clearCardTimer() {
  if (cardTimer !== null) { clearTimeout(cardTimer); cardTimer = null; }
}

/**
 * Trim a card down to what is worth keeping, or to null when that is nothing.
 * Empty fields are dropped rather than stored, so "has a card" stays one
 * truthiness test everywhere else instead of a search for a non-blank field.
 */
export function normalizeCardMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const title = String(meta.title ?? '').trim().slice(0, CARD_TITLE_MAX);
  const blurb = String(meta.blurb ?? '').trim().slice(0, CARD_BLURB_MAX);
  const inputs = (Array.isArray(meta.inputs) ? meta.inputs : [])
    // The empty word is a legitimate test, so a row is dropped for being
    // *absent* rather than for being empty — w: '' is content.
    .filter(s => s && s.w !== undefined && s.w !== null)
    .slice(0, CARD_WORDS_MAX)
    .map(s => {
      const row = { ...s, w: String(s.w).slice(0, CARD_WORD_MAX) };
      if (row.expect !== 'accept' && row.expect !== 'reject') delete row.expect;
      return row;
    });
  if (!title && !blurb && !inputs.length) return null;
  const out = {};
  if (title) out.title = title;
  if (blurb) out.blurb = blurb;
  if (inputs.length) out.inputs = inputs;
  return out;
}

/** Is there a description to read, or a machine that could have one? */
function cardOffered() {
  return !!App.meta || App.states.length > 0;
}

function cardIsOpen() {
  const card = $('example-card');
  return !!card && card.classList.contains('is-open');
}

/** How long an app-opened card waits before folding away; 0 never does. */
function cardAutoHideMs() {
  const ms = App.config?.cardAutoHideMs;
  return Number.isFinite(ms) ? Math.max(0, ms) : CARD_AUTO_HIDE_MS;
}

/** Collapse the card back to its button, dropping anything half-typed. */
export function hideExampleCard() {
  clearCardTimer();
  cardFocusField = null;
  const card = $('example-card');
  const btn = $('canvas-info-btn');
  if (card) card.classList.remove('is-open');
  // Redraw from App.meta rather than leaving a half-typed field behind the
  // fade, to be found still sitting there on the next open.
  if (card) renderExampleCard();
  if (card) card.classList.remove('is-open');
  if (btn) {
    btn.hidden = !cardOffered();
    btn.setAttribute('aria-expanded', 'false');
    if (!btn.hidden) btn.dataset.tip = App.meta ? 'About this machine' : 'Describe this machine';
  }
}

/**
 * Open the card. With nothing written about the machine yet this opens the
 * same card with its fields empty and the caret in the title — the button is
 * only offered at all when there is either something to read or something to
 * describe.
 *
 * @param {boolean} [opts.autoHide] close again after App.config.cardAutoHideMs
 */
export function openExampleCard({ autoHide = false } = {}) {
  if (!cardOffered()) return;
  clearCardTimer();
  const card = $('example-card');
  const btn = $('canvas-info-btn');
  if (!card) return;
  card.classList.add('is-open');
  if (btn) {
    btn.hidden = true;
    btn.setAttribute('aria-expanded', 'true');
  }
  renderExampleCard();
  // An undescribed machine opens on the one field that has to be filled in
  // first; a described one opens as something to read, caret nowhere.
  if (!App.meta) focusCardField('title');

  const wait = cardAutoHideMs();
  if (autoHide && wait > 0) {
    cardTimer = setTimeout(hideExampleCard, wait);
    // Node returns a Timeout object that keeps the process alive; a browser
    // returns a number and has no unref. Without this every test that draws a
    // card holds the runner open for the length of the countdown.
    if (typeof cardTimer?.unref === 'function') cardTimer.unref();
  }
}

export function toggleExampleCard() {
  if (cardIsOpen()) hideExampleCard();
  else openExampleCard();
}

/**
 * Open the card with the caret already in it — the canvas context menu's way
 * in, and the answer to "how do I describe a machine I drew myself?".
 *
 * The (i) button has always offered this, but a 24px circle in a corner is a
 * way *back* to something already read, not somewhere anyone looks to start
 * writing. Right-clicking the canvas is.
 */
export function ctxCanvasDescribe() {
  hideCanvasContextMenu();
  openExampleCard();
  focusCardField('title');
}

export function exampleCardMeta() {
  return App.meta;
}

/** Is the caret in one of the card's fields? For the tests, and for the timer. */
export function isEditingExampleCard() {
  return !!cardFocusField;
}

/** Test seam — the timer and a stale focus must not cross tests. */
export function _resetExampleCardForTests() {
  clearCardTimer();
  cardFocusField = null;
  localMetaWrite = false;
  cardParts = {};
}

// ── Writing ───────────────────────────────────────────────────────

/** A mutable copy of what the card currently says, safe to edit in place. */
function metaDraft() {
  const m = App.meta;
  return {
    title: m?.title || '',
    blurb: m?.blurb || '',
    // Rows keep whatever else they arrived with — a StateMate result labels
    // its words with the transducer output it predicted, and rewording the
    // blurb is no reason to throw that away.
    inputs: (m?.inputs || []).map(s => ({ ...s }))
  };
}

/**
 * Write an edited draft back as one undoable step, and answer whether anything
 * actually changed. A field opened and left alone is not an edit: it spends no
 * undo point and does not dirty the tab.
 *
 * The Change.META subscriber stands down for the duration — see the header.
 */
function writeCardMeta(draft) {
  const next = normalizeCardMeta(draft);
  if (JSON.stringify(next ?? null) === JSON.stringify(App.meta ?? null)) return false;
  localMetaWrite = true;
  try {
    commit(() => { App.meta = next; }, Change.META);
  } finally {
    localMetaWrite = false;
  }
  return true;
}

/** Commit one field of the card, by name. */
function setCardField(name, value) {
  const draft = metaDraft();
  draft[name] = value;
  return writeCardMeta(draft);
}

/** Commit an edit to the word list, given as a function over the rows. */
function editCardWords(fn) {
  const draft = metaDraft();
  fn(draft.inputs);
  return writeCardMeta(draft);
}

function cardWords() {
  return Array.isArray(App.meta?.inputs) ? App.meta.inputs : [];
}

/**
 * The card cleared itself — every field emptied — so there is nothing left to
 * read. Fold it away rather than leave an empty shell floating over the
 * diagram; the (i) button is still there to start again from.
 */
function foldIfEmpty() {
  if (!App.meta) hideExampleCard();
}

// ── Rendering ─────────────────────────────────────────────────────

function elem(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cardButton(cls, label, tip, onClick) {
  const b = elem('button', cls, label);
  b.type = 'button';
  if (tip) b.dataset.tip = tip;
  b.setAttribute('aria-label', tip || label);
  b.onclick = onClick;
  return b;
}

/** Grow a textarea to its content, so a blurb is never a two-line window. */
function autoGrow(area) {
  if (!area || !area.style || typeof area.scrollHeight !== 'number') return;
  area.style.height = 'auto';
  area.style.height = `${Math.min(220, area.scrollHeight)}px`;
}

/** Put the caret in a named field, if the card is showing one. */
function focusCardField(name) {
  const node = cardParts[name];
  if (node && node.focus) node.focus();
}

/**
 * Wire a seamless field: focus bookkeeping, commit on blur, and Escape to put
 * it back. `read` is what the field should say according to App.meta, so
 * Escape and the commit-was-a-no-op case share one source of truth.
 */
function wireField(node, name, { read, write, onEnter }) {
  node.dataset.field = name;
  node.onfocus = () => { cardFocusField = name; clearCardTimer(); };
  node.onblur = () => {
    if (cardFocusField === name) cardFocusField = null;
    write(node.value);
  };
  node.onkeydown = e => {
    if (e.key === 'Escape') {
      // Handled here rather than by the card's own listener so that a field
      // reverts to its saved text; the listener below only closes the card.
      e.stopPropagation();
      node.value = read();
      if (node.blur) node.blur();
      return;
    }
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter(node);
    }
  };
}

// Wired once, here rather than through an on* attribute, so the card adds no
// names to bridge.js — the same way reference.js and statemate-ui.js do it.
function wireCardChrome(card) {
  const btn = $('canvas-info-btn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', toggleExampleCard);
  }
  if (card && !card.dataset.wired) {
    card.dataset.wired = '1';
    card.addEventListener('pointerenter', clearCardTimer);
    // Escape from the card itself — not from a field, which reverts instead
    // and stops the event — puts the card away. The card is not a modal, so
    // modal.js never sees this key and the dialog chain is not involved.
    card.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      hideExampleCard();
    });
  }
}

function renderHead(card, meta) {
  const head = elem('div', 'example-card-head');

  const title = elem('input', 'example-card-input example-card-title');
  title.type = 'text';
  title.value = meta.title || '';
  title.maxLength = CARD_TITLE_MAX;
  title.placeholder = 'Name this machine';
  title.setAttribute('aria-label', 'Machine name');
  wireField(title, 'title', {
    read: () => App.meta?.title || '',
    write: value => { if (setCardField('title', value)) foldIfEmpty(); },
    // ⏎ in a one-line field means "done", the way it does in the tab rename
    // and the state rename. The blurb below is the exception, because a
    // description is allowed more than one line.
    onEnter: node => node.blur && node.blur()
  });
  head.append(title);
  cardParts.title = title;

  const tools = elem('span', 'example-card-tools');
  tools.append(cardButton('example-card-close', '×', 'Dismiss', hideExampleCard));
  head.append(tools);
  card.appendChild(head);
}

function renderBlurb(card, meta) {
  const blurb = elem('textarea', 'example-card-area');
  blurb.value = meta.blurb || '';
  blurb.maxLength = CARD_BLURB_MAX;
  blurb.rows = 2;
  blurb.placeholder = 'What does it accept, and how?';
  blurb.setAttribute('aria-label', 'What this machine does');
  wireField(blurb, 'blurb', {
    read: () => App.meta?.blurb || '',
    write: value => { if (setCardField('blurb', value)) foldIfEmpty(); }
  });
  blurb.oninput = () => autoGrow(blurb);
  card.appendChild(blurb);
  cardParts.blurb = blurb;
  autoGrow(blurb);
}

/** Run a word on the canvas — the one thing the card does that no panel does. */
function runCardWord(word) {
  const inp = $('sim-in');
  if (inp) inp.value = word;
  runSim();
}

/**
 * One test word: a chip that runs on click, with the verdict as a mark you can
 * cycle and a × that only shows itself when the chip is under the pointer.
 *
 * A pending chip is one the + button just made. It is not in App.meta yet, so
 * its index is one past the end and its commit appends; abandoning it empty
 * removes it and costs nothing.
 */
function chipNode(sample, i, { pending = false } = {}) {
  const expect = sample.expect === 'accept' || sample.expect === 'reject' ? sample.expect : '';
  const chip = elem('span', 'example-chip');
  // Through classList rather than baked into the class string, because
  // cycleChipVerdict takes them off again the same way — one node, one place
  // its state is written from.
  if (expect === 'accept') chip.classList.add('chip-acc');
  if (expect === 'reject') chip.classList.add('chip-rej');
  if (pending) chip.classList.add('is-pending');
  chip.dataset.i = String(i);
  chip.dataset.expect = expect;

  const run = elem('button', 'example-chip-run');
  run.type = 'button';
  // The empty word is a test like any other, and drawn as "" it is a blank
  // pill that reads as a rendering fault. Show the symbol; run the real
  // (empty) string.
  const word = sample.w === undefined || sample.w === null ? '' : String(sample.w);
  run.textContent = word === '' ? (App.config?.sym?.eps || 'ε') : word;
  const hint = [sample.label, expect || (sample.out !== undefined ? `→ ${sample.out}` : '')]
    .filter(Boolean).join(' — ');
  run.dataset.tip = hint ? `${hint} · double-click to edit` : 'Run this word · double-click to edit';
  run.setAttribute('aria-label', `Run ${word === '' ? 'the empty word' : word}`);
  run.onclick = () => runCardWord(word);
  run.ondblclick = e => { e.preventDefault(); editChipWord(chip); };
  // The rename gesture reachable without a pointer. F2 is what renames things
  // everywhere else a list of short names is edited in place.
  run.onkeydown = e => { if (e.key === 'F2') { e.preventDefault(); editChipWord(chip); } };
  chip.append(run);

  const mark = cardButton('example-chip-expect', EXPECT_MARK[expect], EXPECT_TIP[expect],
    () => cycleChipVerdict(chip));
  chip.append(mark);

  const drop = cardButton('example-chip-drop', '×', 'Remove this word', () => dropChip(chip));
  chip.append(drop);
  chip.__parts = { run, mark, drop, word: null };
  return chip;
}

/** Swap a chip's word for an input, in place. */
function editChipWord(chip) {
  if (!chip || !chip.__parts || chip.__parts.word) return;
  const run = chip.__parts.run;
  const i = Number(chip.dataset.i);
  const pending = chip.classList.contains('is-pending');
  const current = pending ? '' : String(cardWords()[i]?.w ?? '');

  const input = elem('input', 'example-card-input example-card-word');
  input.type = 'text';
  input.value = current;
  input.maxLength = CARD_WORD_MAX;
  // The placeholder is ε because a field left blank *is* the empty word — the
  // chip will read ε too, so it shows what it is about to become rather than
  // the usual "type here".
  input.placeholder = App.config?.sym?.eps || 'ε';
  input.setAttribute('aria-label', 'Test word');
  input.dataset.field = `word-${i}`;
  input.onfocus = () => { cardFocusField = `word-${i}`; clearCardTimer(); };
  input.oninput = () => sizeWordInput(input);
  input.onblur = () => {
    if (cardFocusField === `word-${i}`) cardFocusField = null;
    commitChipWord(chip, input.value);
  };
  input.onkeydown = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // Escape is the way to take a word back: a new one leaves nothing
      // behind, an edited one goes back to what it said.
      if (pending) removePendingChip(chip);
      else redrawChips();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // ⏎ commits, and on the last chip offers another — which is how a list of
    // words gets typed.
    const wasLast = pending || i === cardWords().length - 1;
    commitChipWord(chip, input.value);
    if (wasLast && cardWords().length < CARD_WORDS_MAX) addCardWord();
  };

  chip.insertBefore(input, run || null);
  if (run && run.remove) run.remove();
  chip.__parts.run = null;
  chip.__parts.word = input;
  sizeWordInput(input);
  if (input.focus) input.focus();
  if (input.select) input.select();
  repositionCanvasInfo();
}

// The field is as wide as what is in it, so a chip being edited stays a chip
// rather than becoming a text box the width of the card.
function sizeWordInput(input) {
  if (!input || !input.style) return;
  const len = Math.max(1, String(input.value || input.placeholder || '').length);
  input.style.width = `${Math.min(22, len + 1)}ch`;
}

/**
 * Write a chip's word back, exactly once.
 *
 * **Once** is the whole of the first bug this guards. Committing redraws the
 * row, which destroys the field being typed into — and a destroyed field that
 * had focus fires `blur` on its way out, which lands back here. So ⏎ committed
 * the word and then its own blur committed it a second time, and a pending
 * chip appends: every word added with the keyboard arrived twice.
 *
 * **The empty word is a word.** A pending chip used to be dropped on blur
 * unless it had been typed into, on the theory that a + clicked by accident
 * should leave nothing behind — but the field a + opens is one whose
 * placeholder is ε, and ε is a legitimate test. That rule made the empty word
 * the one input the card could not be given with a pointer at all. The + now
 * always adds a word; Escape and the × are how one is taken back, which is a
 * gesture rather than a guess about intent.
 */
function commitChipWord(chip, value) {
  if (!chip || chip.dataset.committed === '1') return;
  chip.dataset.committed = '1';
  // Belt and braces for the same re-entry: the node is about to be discarded,
  // and a discarded field must not have anything left to say.
  if (chip.__parts?.word) chip.__parts.word.onblur = null;

  if (chip.classList.contains('is-pending')) {
    const expect = chip.dataset.expect || '';
    editCardWords(rows => {
      if (rows.length < CARD_WORDS_MAX) rows.push(expect ? { w: value, expect } : { w: value });
    });
  } else {
    const i = Number(chip.dataset.i);
    editCardWords(rows => { if (rows[i]) rows[i].w = value; });
  }
  redrawChips();
  foldIfEmpty();
}

function cycleChipVerdict(chip) {
  const now = chip.dataset.expect || '';
  const next = EXPECT_CYCLE[(EXPECT_CYCLE.indexOf(now) + 1) % EXPECT_CYCLE.length];
  chip.dataset.expect = next;
  chip.classList.remove('chip-acc', 'chip-rej');
  if (next === 'accept') chip.classList.add('chip-acc');
  if (next === 'reject') chip.classList.add('chip-rej');
  const mark = chip.__parts?.mark;
  if (mark) {
    mark.textContent = EXPECT_MARK[next];
    mark.dataset.tip = EXPECT_TIP[next];
    mark.setAttribute('aria-label', EXPECT_TIP[next]);
  }
  // A pending chip has nothing to write to yet; its verdict rides on the node
  // until the word beside it is committed.
  if (chip.classList.contains('is-pending')) return;
  const i = Number(chip.dataset.i);
  editCardWords(rows => {
    if (!rows[i]) return;
    if (next) rows[i].expect = next;
    else delete rows[i].expect;
  });
}

function dropChip(chip) {
  if (chip.classList.contains('is-pending')) { removePendingChip(chip); return; }
  const i = Number(chip.dataset.i);
  editCardWords(rows => rows.splice(i, 1));
  redrawChips();
  foldIfEmpty();
}

function removePendingChip(chip) {
  // Removing a node that holds focus fires its blur, which would otherwise
  // land in commitChipWord and add the word this is discarding — the same
  // re-entry the commit guard is about, arriving from the other direction.
  chip.dataset.committed = '1';
  if (chip.__parts?.word) chip.__parts.word.onblur = null;
  if (chip.parentNode && chip.parentNode.removeChild) chip.parentNode.removeChild(chip);
  if (cardParts.pending === chip) cardParts.pending = null;
  cardFocusField = null;
  repositionCanvasInfo();
}

/** Add a word: a chip that is not in App.meta until it has been typed into. */
export function addCardWord() {
  const row = cardParts.chips;
  if (!row || cardParts.pending) return;
  if (cardWords().length >= CARD_WORDS_MAX) return;
  const chip = chipNode({ w: '', expect: 'accept' }, cardWords().length, { pending: true });
  cardParts.pending = chip;
  row.insertBefore(chip, cardParts.add || null);
  editChipWord(chip);
}

/**
 * Redraw the word row only. Rows are addressed by index, so a commit that
 * changes their number has to renumber the chips — but the fields above are
 * left alone, which is what lets a word be edited without the caret jumping
 * out of the blurb.
 */
function redrawChips() {
  const row = cardParts.chips;
  if (!row) return;
  // Any field in the row is about to be discarded, and a discarded field that
  // held focus fires blur on the way out. Nothing it says then is wanted: the
  // write it would report has either just happened or has just been undone.
  (row.children || []).forEach(chip => {
    if (chip.dataset) chip.dataset.committed = '1';
    if (chip.__parts?.word) chip.__parts.word.onblur = null;
  });
  row.innerHTML = '';
  fillChips(row);
  repositionCanvasInfo();
}

function fillChips(row) {
  cardParts.pending = null;
  cardParts.add = null;
  cardWords().forEach((sample, i) => row.append(chipNode(sample, i)));
  if (cardWords().length < CARD_WORDS_MAX) {
    cardParts.add = cardButton('example-card-add', '+', 'Add a test word', addCardWord);
    row.append(cardParts.add);
  }
}

function renderChips(card) {
  const row = elem('div', 'example-card-chips');
  cardParts.chips = row;
  fillChips(row);
  card.appendChild(row);
}

/**
 * Draw the card from App.meta. Subscribed to Change.META, so everything that
 * writes it and announces it lands here: an undo, a tab switch, a loaded file,
 * a StateMate result — everything, that is, except this module's own commits,
 * which have already put the DOM where they want it.
 */
export function renderExampleCard() {
  const card = $('example-card');
  if (!card) return;
  card.innerHTML = '';
  cardParts = {};
  wireCardChrome(card);

  // Closed and undescribed is the one case with nothing to draw. Open, the
  // card is its own editor, so an empty one is a card of placeholders rather
  // than no card at all.
  if (!App.meta && !cardIsOpen()) {
    card.classList.remove('is-open');
    syncCanvasInfoButton();
    return;
  }

  const meta = App.meta || {};
  renderHead(card, meta);
  renderBlurb(card, meta);
  renderChips(card);

  // The corner is chosen for the card's footprint, and the footprint is only
  // final now that the fields and the chips are in it — a card that grew two
  // rows taller may no longer clear the toolbar it was anchored beside.
  repositionCanvasInfo();
}

/**
 * Show or hide the (i) button. It is offered whenever there is a description
 * to read *or* a machine that could have one — the second half is what makes
 * the card reachable at all for a machine you drew yourself. With neither, it
 * stays away: a button that opens an empty card is worse than no button.
 */
export function syncCanvasInfoButton() {
  const btn = $('canvas-info-btn');
  if (!btn) return;
  const wasHidden = btn.hidden;
  const described = !!App.meta;
  btn.hidden = cardIsOpen() || !cardOffered();
  btn.dataset.tip = described ? 'About this machine' : 'Describe this machine';
  // A bare (i) is a way back to something already read. With nothing written
  // about the machine yet there is nothing to go back *to*, and the same
  // circle then reads as decoration — so it says what it does instead. This is
  // the second half of the answer to "how do I describe a machine I drew?",
  // the first being the canvas context menu.
  btn.classList.toggle('is-invite', !described);
  const label = btn.querySelector?.('.canvas-info-label');
  if (label) label.textContent = described ? '' : 'Describe';
  if (wasHidden !== btn.hidden) repositionCanvasInfo();
}

// The button appears with the first state and goes away with the last, so it
// tracks the graph. Deliberately *not* a full card re-render: a StateMate
// result decorates the card in place, and redrawing on every edit to the
// diagram would wipe that strip off between the run and the reading of it.
subscribe(Change.GRAPH, syncCanvasInfoButton);
subscribe(Change.META, () => { if (!localMetaWrite) renderExampleCard(); });

/**
 * Describe the machine now on the canvas. Pass null to say nothing about it,
 * which also takes the card away.
 *
 * This is the loaders' entry point — a bundled example, a dropped file, a
 * StateMate result — so it writes App.meta and draws without an undo point of
 * its own; each of those paths already records one for the load as a whole.
 */
export function showExampleCard(meta) {
  const card = $('example-card');
  if (!card) return;
  clearCardTimer();
  cardFocusField = null;
  App.meta = normalizeCardMeta(meta);

  if (!App.meta) {
    card.classList.remove('is-open');
    renderExampleCard();
    hideExampleCard();
    return;
  }
  openExampleCard({ autoHide: true });
}
