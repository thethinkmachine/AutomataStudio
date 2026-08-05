import { tokenizeRHS } from './algorithms-cfg.js';
import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { applyCamera, hideCanvasContextMenu } from './canvas.js';
import { snapshot } from './history.js';
import { importJFLAPText } from './import-jflap.js';
import { closeModal, showOverlay } from './modal.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { runSim } from './simulation.js';
import { $, App, MachineExamples, Workspaces, activeWorkspaceId, exportWorkspaceState, getMachineConfig, normalizeBoundarySymbolsForMachine, setActiveWorkspaceId, setWorkspaces } from './state.js';
import { hideContextMenu } from './states-transitions.js';
import { autoFitLoadedMachine, fitToScreen, hideTabContextMenu, hideTabOverflowMenu, initTabs, markActiveWorkspaceSaved, renderTabs, setSaveState, switchTab } from './ui.js';
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
    cam: App.cam
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
      if (isJflap) { importJFLAPText(ev.target.result); return; }

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
  
  const validMachines = [
    'DFA', 'NFA', 'ε-NFA', '2DFA', '2NFA',
    'DPDA', 'NPDA', 'PDA', 'QA', 'Counter', '2PDA',
    'TM', 'NDTM', 'MTM', 'LBA', 'ITM',
    'Moore', 'Mealy', 'FST'
  ];
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
  if ((data.machine === 'Moore' || data.machine === 'Mealy' || data.machine === 'FST') && !Array.isArray(data.outputAlpha)) {
    throw new Error("Transducers require an 'outputAlpha' array.");
  }
  if ((data.machine === 'TM' || data.machine === 'NDTM' || data.machine === 'MTM' || data.machine === 'LBA' || data.machine === 'ITM') && typeof data.tapeCount !== 'number') {
    throw new Error("Turing Machines require a numeric 'tapeCount'.");
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
  App.states = d.states || [];
  App.transitions = d.transitions || []; App.startId = d.startId || null;
  App.accepts = new Set(d.accepts || []);
  App.notes = Array.isArray(d.notes) ? d.notes : [];
  App.dividers = Array.isArray(d.dividers) ? d.dividers : [];
  App.selectedDividerId = null;
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
  renderAll(); updateLPanel(); updateRPanel();

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
//  LOAD EXAMPLE
// ══════════════════════════════════════════════════════════════════
export function getMachineExampleOptions() {
  const list = (typeof MachineExamples !== 'undefined' && MachineExamples[App.machine]) || null;
  if (list && list.length) return list;
  const cfg = getMachineConfig(App.machine);
  return cfg.file ? [{ file: cfg.file, label: 'Example' }] : [];
}

export function loadExample(trigger) {
  const options = getMachineExampleOptions();
  if (!options.length) return;
  if (options.length === 1) { loadExampleFile(options[0].file); return; }
  toggleExampleMenu(options, trigger);
}

export function toggleExampleMenu(options, trigger) {
  const btn = trigger || $('example-picker-btn');
  const menu = $('example-menu');
  if (!btn || !menu) { loadExampleFile(options[0].file); return; }
  if (menu.style.display === 'block') { closeExampleMenu(); return; }

  // Close the other popovers that share the .ctx layer.
  if (typeof hideTabOverflowMenu === 'function') hideTabOverflowMenu();
  if (typeof hideTabContextMenu === 'function') hideTabContextMenu();
  if (typeof hideContextMenu === 'function') hideContextMenu();
  if (typeof hideCanvasContextMenu === 'function') hideCanvasContextMenu();

  menu.innerHTML = '';
  options.forEach((opt, i) => {
    const item = document.createElement('button');
    item.className = 'example-menu-item' + (i === 0 ? ' flagship' : '');
    item.type = 'button';
    item.setAttribute('role', 'option');
    const dot = document.createElement('span');
    dot.className = 'example-menu-item-dot';
    const name = document.createElement('span');
    name.className = 'example-menu-item-name';
    name.textContent = opt.label || opt.file;
    item.append(dot, name);
    item.onclick = e => {
      e.stopPropagation();
      closeExampleMenu();
      loadExampleFile(opt.file);
    };
    menu.appendChild(item);
  });

  // Measure before placing so the menu can be right-aligned to the button
  // and flipped above it when there isn't room below.
  menu.style.display = 'block';
  menu.style.visibility = 'hidden';
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - m.width - 8)) + 'px';
  const below = r.bottom + 6;
  menu.style.top = (below + m.height > innerHeight - 8
    ? Math.max(8, r.top - 6 - m.height)
    : below) + 'px';
  menu.style.visibility = '';

  setTimeout(() => document.addEventListener('click', closeExampleMenu, { once: true }), 0);
}

export function closeExampleMenu() {
  const menu = $('example-menu');
  if (menu) menu.style.display = 'none';
  const btn = $('example-picker-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function loadExampleFile(file) {
  const executeLoad = () => {
    fetch(`js/examples/${file}.json`)
      .then(res => res.json())
      .then(data => {
        performClear();
        loadData(data, true);
        showExampleCard(data.meta);
        showStatus(`Example: ${App.machine} loaded`);
        snapshot();
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

// Info card in the Simulate panel describing the loaded example, with sample
// inputs as chips that run with one click. Pass null to hide it.
export function showExampleCard(meta) {
  const card = $('example-card');
  if (!card) return;
  card.innerHTML = '';
  if (!meta) { card.style.display = 'none'; return; }

  const head = document.createElement('div');
  head.className = 'example-card-head';
  const title = document.createElement('span');
  title.className = 'example-card-title';
  title.textContent = meta.title || 'Example';
  const close = document.createElement('button');
  close.className = 'example-card-close';
  close.dataset.tip = 'Dismiss';
  close.textContent = '×';
  close.onclick = () => { card.style.display = 'none'; };
  head.append(title, close);
  card.appendChild(head);

  if (meta.blurb) {
    const blurb = document.createElement('div');
    blurb.className = 'example-card-blurb';
    blurb.textContent = meta.blurb;
    card.appendChild(blurb);
  }

  if (Array.isArray(meta.inputs) && meta.inputs.length) {
    const row = document.createElement('div');
    row.className = 'example-card-chips';
    meta.inputs.forEach(sample => {
      const chip = document.createElement('button');
      const tone = sample.expect === 'reject' ? ' chip-rej' : (sample.expect === 'accept' ? ' chip-acc' : '');
      chip.className = 'example-chip' + tone;
      chip.textContent = sample.w;
      const hint = [sample.label, sample.expect || (sample.out !== undefined ? `→ ${sample.out}` : '')]
        .filter(Boolean).join(' — ');
      if (hint) chip.dataset.tip = hint;
      chip.onclick = () => {
        const inp = $('sim-in');
        if (inp) inp.value = sample.w;
        runSim();
      };
      row.appendChild(chip);
    });
    card.appendChild(row);
  }

  card.style.display = 'block';
  const simSection = $('rp-simulate');
  if (simSection) simSection.classList.remove('collapsed');
}
