import { tokenizeSymbols } from './grammar/parse.js';
import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { applyCamera } from './canvas.js';
import { snapshot } from './history.js';
import { importJFLAPText } from './import-jflap.js';
import { closeModal, showOverlay } from './modal.js';
import { refreshQuickSettings } from './quick-settings.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { showExampleCard } from './machine-card.js';
import { isMultiTape } from './machines/index.js';
import { $, App, MachineExamples, MachineTypes, Workspaces, activeWorkspaceId, exportWorkspaceState, getMachineConfig, largeMachineProfile, normalizeBoundarySymbolsForMachine, setActiveWorkspaceId, setR, setWorkspaces } from './state.js';
import { hideContextMenu } from './states-transitions.js';
import { Change, emit } from './store.js';
import { autoFitLoadedMachine, fitToScreen, hideTabContextMenu, hideTabOverflowMenu, initTabs, markActiveWorkspaceSaved, renderTabs, setSaveState, switchTab } from './ui.js';
import { hasPdaNondeterminism, hasSingleTapeNondeterminism, isAnyPDA, performClear, resetIds, showStatus } from './utils.js';
import { applyMachineSwitch } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
// ── The file rounds its geometry; the machine does not ────────────
// A coordinate is a float the moment a state has been dragged, and
// `100.35847091674805` is eighteen characters written twice per state — on a
// diagram of any size the file is mostly coordinates. Whole pixels are
// invisible at the zoom a diagram is read at (a state is 28 of them across the
// radius, and the stroke around it is wider than the error), so the precision
// buys nothing that reaches a reader.
//
// It happens **here, on the way out, and never on `App`**. Rounding a state as
// it is dragged would quantise the drag itself, and the layout passes iterate
// on their own output — `resolveNodeOverlaps` pushes a state a fraction at a
// time — where a rounding error accumulates into a visible drift. So the
// machine on screen keeps full precision and the file gets whole numbers.
//
// `exportWorkspaceState` deliberately does *not* do this, which is the line
// between the two serializers: a tab switch and an undo have to give back
// exactly the machine that was there, not one within half a pixel of it.
//
// The value is the decimal places to keep; 0 means a whole number. Only
// `loopAngle` (radians, where a whole number is a quarter turn) and the
// camera's zoom need any.
const SAVE_PRECISION = {
  state: { x: 0, y: 0 },
  transition: { curve: 0, loopAngle: 3 },
  note: { x: 0, y: 0, w: 0, h: 0 },
  divider: { x1: 0, y1: 0, x2: 0, y2: 0 },
  cam: { x: 0, y: 0, z: 4 }
};

// Copies rather than edits, so the object on `App` is untouched, and rounds
// only the fields named — anything else a state or a note carries rides along
// as it is.
function roundForSave(obj, precision) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const key in precision) {
    const v = out[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[key] = precision[key] ? Number(v.toFixed(precision[key])) : Math.round(v);
  }
  return out;
}

export function getWorkspaceData() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  
  // Explicitly allow-list only FSM model configuration, dropping all UI/Theme data.
  const cleanConfig = {
    transducerAccepts: App.config.transducerAccepts,
    twoWayTape: App.config.twoWayTape,
    detectLoops: App.config.detectLoops,
    maxPdaSteps: App.config.maxPdaSteps,
    maxTapeCount: App.config.maxTapeCount,
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
    states: App.states.map(x => roundForSave(x, SAVE_PRECISION.state)),
    transitions: App.transitions.map(x => roundForSave(x, SAVE_PRECISION.transition)),
    startId: App.startId,
    accepts: [...App.accepts],
    notes: App.notes.map(x => roundForSave(x, SAVE_PRECISION.note)),
    dividers: App.dividers.map(x => roundForSave(x, SAVE_PRECISION.divider)),
    grammar: grammarData,
    cam: roundForSave(App.cam, SAVE_PRECISION.cam),
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

// How often a tick may fire. A tick is JSON.stringify over every workspace,
// written to IndexedDB on the main thread — a few kilobytes on an ordinary
// machine and several megabytes on a thousand-state one, where the reader gets
// a visible hitch every fifteen seconds for a save nothing asked for.
//
// Stretched rather than switched off. Autosave is what makes a crash survivable
// and a large machine is the one you would least like to redraw, so the profile
// buys frames by saving less often, never by not saving. 0 still means off, and
// a reader who set a *longer* interval than the floor keeps theirs.
export const LARGE_AUTOSAVE_INTERVAL_MS = 60000;

export function effectiveAutosaveInterval() {
  const interval = Number(App.config.autosaveIntervalMs ?? 15000);
  if (!Number.isFinite(interval) || interval <= 0) return interval;
  return largeMachineProfile() ? Math.max(interval, LARGE_AUTOSAVE_INTERVAL_MS) : interval;
}

export function restartAutosaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (autosaveCountdownTimer) clearInterval(autosaveCountdownTimer);
  autosaveTimer = null;
  autosaveCountdownTimer = null;
  autosaveDeadline = 0;
  const interval = effectiveAutosaveInterval();
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
// like the ε symbols that show up in every workspace's config). The byte
// halves are separate because the compressed payload below is bytes that were
// never a string, and round-tripping it through TextDecoder would corrupt it.
function bytesToB64Url(bytes) {
  // fromCharCode.apply over a whole array overflows the argument stack on a
  // payload of any real size, which is precisely the payload that gets shared.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64UrlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
export function b64UrlEncodeUnicode(str) {
  return bytesToB64Url(new TextEncoder().encode(str));
}
export function b64UrlDecodeUnicode(b64url) {
  return new TextDecoder().decode(b64UrlToBytes(b64url));
}

// ── The payload is DEFLATEd ───────────────────────────────────────
// A workspace is JSON carrying the same two dozen key names once per state and
// once per transition, which is the shape DEFLATE is best at: a 300-state
// machine goes from a 60KB link to a 7.8KB one, a 1000-state one from 200KB to
// 30KB. Length is the whole issue —
// the hash never reaches a server, but every chat client, mail client and
// issue tracker between the two people has its own idea of how long a URL may
// be, and the ones that *truncate* rather than refuse hand back a payload that
// decodes to nothing. Base64 costs a third on top of the JSON, so the
// uncompressed link was ~1.35× a file that is mostly repetition.
//
// Compressing is best-effort. `CompressionStream` is asynchronous and not
// everywhere (Safari < 16.4, and any context that has stripped it), so a
// failure falls through to the old encoding: an uncompressed link is a longer
// link, never a broken one.
//
// `SHARE_COMPRESSED_MARK` is what the reader dispatches on, and `.` is outside
// the base64url alphabet — so a link written before this existed can never be
// mistaken for a compressed one, and every one of them still opens.
export const SHARE_COMPRESSED_MARK = 'z.';
const SHARE_CODEC = 'deflate-raw';

function canCompress() {
  return typeof CompressionStream === 'function' && typeof ReadableStream === 'function';
}

// The bytes are pushed through the transform by hand rather than through
// Blob().stream() or Response.arrayBuffer(), so the only globals this needs
// are the two streams it names — the codec stays usable anywhere the app runs.
async function pipeBytes(bytes, transform) {
  const source = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = source.pipeThrough(transform).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Resolves to a marked, compressed payload, or to null when this browser
// cannot compress — the caller decides what to do with the second answer.
export async function compressToB64Url(str) {
  if (!canCompress()) return null;
  try {
    const out = await pipeBytes(new TextEncoder().encode(str), new CompressionStream(SHARE_CODEC));
    return SHARE_COMPRESSED_MARK + bytesToB64Url(out);
  } catch (err) {
    console.warn('Share link compression unavailable, falling back to plain base64:', err);
    return null;
  }
}

// The one reader for both link generations.
export async function decodeSharePayload(payload) {
  if (!payload.startsWith(SHARE_COMPRESSED_MARK)) return b64UrlDecodeUnicode(payload);
  const bytes = b64UrlToBytes(payload.slice(SHARE_COMPRESSED_MARK.length));
  const out = await pipeBytes(bytes, new DecompressionStream(SHARE_CODEC));
  return new TextDecoder().decode(out);
}

export const SHARE_HASH_PREFIX = '#share=';

export async function getShareableLink() {
  const json = JSON.stringify(getWorkspaceData());
  const payload = (await compressToB64Url(json)) ?? b64UrlEncodeUnicode(json);
  return `${location.origin}${location.pathname}${SHARE_HASH_PREFIX}${payload}`;
}

export function copyShareableLink() {
  const link = getShareableLink();
  const onCopied = () => showStatus('Shareable link copied to clipboard!');
  const onFailed = () => link.then(url => window.prompt('Copy this link:', url), () => {});
  const viaText = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return onFailed();
    link.then(url => navigator.clipboard.writeText(url)).then(onCopied, onFailed);
  };
  // Compressing puts a tick between the click and the write, and Safari grants
  // the clipboard only inside the gesture that asked for it. Handing write() a
  // promise is the sanctioned way to hold that grant open while the payload is
  // still being built; writeText is the path for everything with no
  // ClipboardItem, and the prompt is the path for everything else.
  if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
    try {
      const blob = link.then(url => new Blob([url], { type: 'text/plain' }));
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(onCopied, viaText);
      return;
    } catch (err) {
      // Firefox accepted a promise here only from 125 on; older ones throw.
    }
  }
  viaText();
}

// Reads a #share=… link on page load and swaps it into the current workspace,
// the same way dropping a JSON/PNG file does.
export async function loadSharedLinkFromURL() {
  if (!location.hash.startsWith(SHARE_HASH_PREFIX)) return false;
  const encoded = location.hash.slice(SHARE_HASH_PREFIX.length);
  // Strip the hash immediately so refreshing later doesn't re-import stale data
  // over whatever the user has since built.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = JSON.parse(await decodeSharePayload(encoded));
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
  if (isMultiTape(data.machine) && typeof data.tapeCount !== 'number') {
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
    // A legacy production carries only {lhs, rhs}, so its right-hand side is
    // re-read against the *declared* variable set — the one the file names,
    // not one inferred from the rules, which is what made the old tokenizer's
    // answer depend on the order the rules were written in.
    const rhsArr = Array.isArray(p?.rhsArr)
      ? [...p.rhsArr]
      : (rhs === App.config.sym.eps ? [App.config.sym.eps] : tokenizeSymbols(rhs, vars));
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
  if (Number.isInteger(d.maxTapeCount)) App.config.maxTapeCount = d.maxTapeCount;
  if (typeof d.detectLoops === 'boolean') App.config.detectLoops = d.detectLoops;
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
  // Change.GRAMMAR because a loaded file carries one: without it the Grammar
  // workbench keeps the rules of whatever was open before the load.
  emit(Change.GRAPH, Change.GRAMMAR);

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
//  THE MACHINE CARD
// ══════════════════════════════════════════════════════════════════
//  The card over the canvas is document content, not persistence — it lives
//  in App.meta and is drawn by js/machine-card.js. It is re-exported here
//  because the loaders in this file are its main writer, and because the rest
//  of the app has always reached it through this module.
export {
  CARD_AUTO_HIDE_MS, CARD_BLURB_MAX, CARD_TITLE_MAX, CARD_WORDS_MAX, CARD_WORD_MAX,
  _resetExampleCardForTests, addCardWord, ctxCanvasDescribe, exampleCardMeta,
  hideExampleCard, isEditingExampleCard, normalizeCardMeta, openExampleCard,
  renderExampleCard, showExampleCard, syncCanvasInfoButton, toggleExampleCard
} from './machine-card.js';
