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
import { $, APP_VERSION, App, MachineExamples, MachineTypes, Workspaces, activeWorkspaceId, exportWorkspaceState, getMachineConfig, largeMachineProfile, normalizeBoundarySymbolsForMachine, setActiveWorkspaceId, setR, setWorkspaces } from './state.js';
import { WORKSPACE_EXT, fileStem, hasFileHost, noteOpenDocument, openFileDialog, saveFileAs, suggestedFileName, writeFile } from './file-host.js';
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
  block: { x: 0, y: 0, w: 0, h: 0 },
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

// ══════════════════════════════════════════════════════════════════
//  THE DOCUMENT'S VERSION
// ══════════════════════════════════════════════════════════════════
//  A file, a share link, a PNG payload and an IndexedDB record all carry the
//  same document, so they all carry the same three fields — and every one of
//  them goes through `migrateWorkspaceDoc` on the way in.
//
//  `format` is what the thing *is*, so a JSON file that happens to have a
//  `machine` key is not mistaken for one of ours. `schema` is the only field
//  that gates behaviour. `app` is informational: it is what a bug report needs
//  and what a migration author reads, and nothing branches on it — a build
//  number is not a schema, and treating it as one is how you end up unable to
//  ship a patch release.
export const WORKSPACE_FORMAT = 'automata-studio/workspace';

//  Bump this only when a reader written for the previous number would get the
//  document *wrong* — a field that changed meaning, a default that flipped, a
//  shape that moved. Adding an optional field is not a bump: every reader in
//  this file already treats absence as a default, which is what let `blocks`,
//  `scope`, `meta` and `grammar` all arrive without one.
//
//  1 — the first numbered schema. Everything written before it reads as 0.
export const SCHEMA_VERSION = 1;

// What a document with no `schema` field is. Every file this app wrote before
// the field existed, plus every hand-written and third-party one.
export const LEGACY_SCHEMA = 0;

export function readSchemaVersion(d) {
  const raw = d?.schema;
  return Number.isInteger(raw) && raw >= 0 ? raw : LEGACY_SCHEMA;
}

// The refusal, kept separate from the migration so the file-load path can
// report it before anything has been touched.
//
// A document from the future is refused rather than read on a hope. The
// failure it prevents is the quiet one: a newer build's file loads, the fields
// this reader does not know about are dropped on the floor, and the next save
// writes the loss back out. Better to say so and leave the file alone.
export function assertReadableSchema(d) {
  const found = readSchemaVersion(d);
  if (found > SCHEMA_VERSION) {
    throw new Error(
      `This file was written by a newer version of AutomataStudio `
      + `(format ${found}, this build reads ${SCHEMA_VERSION})`
      + `${d?.app ? ` — it says it came from ${d.app}` : ''}. Update to open it.`
    );
  }
  return found;
}

// ── The chain ─────────────────────────────────────────────────────
//  MIGRATIONS[n] takes a document at schema n and returns one at n + 1. They
//  run in order, so a v0 file passes through every step; each one only has to
//  know about the single change it is named for.
//
//  A migration may mutate the document it is handed. Every caller parses fresh
//  — from a file, a link, a fetch or a storage record — so there is no shared
//  object to scribble on, and deep-copying a thousand-state machine on every
//  load to avoid a hazard that does not exist would be a real cost for none.
const MIGRATIONS = [
  // 0 → 1. Nothing about the machine changed; what changed is that the
  // document now says which schema it is. The one genuine v0 concern is the
  // symbol migration, which has always been keyed on `config` being absent —
  // a file predating the configurable-symbol era spells ε, ⊔ and Z literally,
  // and the reader's own symbols may differ.
  d => {
    if (!d.config) migrateLegacySymbols(d);
    return d;
  }
];

// The one way in. Idempotent by construction: it stamps the current schema, so
// a document that has already been through it takes no step. That is what lets
// `loadData` call it as a backstop for the paths that skip `validateSchema`
// (examples, storage records, algorithm results) without the migrations
// running twice on the paths that do not.
export function migrateWorkspaceDoc(d) {
  if (!d || typeof d !== 'object') return d;
  let at = assertReadableSchema(d);
  let doc = d;
  while (at < SCHEMA_VERSION) {
    doc = MIGRATIONS[at](doc) || doc;
    at++;
  }
  doc.format = WORKSPACE_FORMAT;
  doc.schema = SCHEMA_VERSION;
  return doc;
}

// ── Normalisations, which are not migrations ──────────────────────
//  These re-derive a machine *type* from the transitions, and they deliberately
//  run for a document of any schema — including one this build just wrote.
//  They are not corrections to an old format: a JFLAP import, a hand-edited
//  file and an algorithm result can all produce a nondeterministic δ under a
//  deterministic type name, and none of those has a version to key on.
//
//  Keeping them out of MIGRATIONS is the point. A migration is allowed to
//  assume it runs once, on the way up from a known older shape; these have to
//  hold every time, forever.
export function normalizeMachineType(d) {
  if (d.machine === 'TM' && hasSingleTapeNondeterminism(d.transitions || [])) {
    return 'NDTM';
  }
  // PDA is a hidden alias of DPDA and is deliberately absent from the model
  // picker; both re-derive from whether δ actually branches.
  if (d.machine === 'PDA' || d.machine === 'DPDA') {
    return hasPdaNondeterminism(d.transitions || []) ? 'NPDA' : 'DPDA';
  }
  return d.machine;
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
    // What this is and how to read it. See THE DOCUMENT'S VERSION above —
    // these three lead the object so that a human opening the file in an
    // editor sees them first.
    format: WORKSPACE_FORMAT,
    schema: SCHEMA_VERSION,
    app: APP_VERSION,
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
    // Building blocks. `blockId` on a state needs nothing here — roundForSave
    // copies a state whole and rounds only the fields it names, so any field
    // the app adds rides along untouched.
    blocks: (App.blocks || []).map(x => roundForSave(x, SAVE_PRECISION.block)),
    scope: [...(App.scope || [])],
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
// Undo/redo stacks are deliberately excluded from anything that reaches
// storage. They can hold 300 JSON snapshots per tab, which is the single
// largest contributor to quota failures, and reloading discards the history
// anyway — persisting it costs the whole save the moment it tips over quota.
export function stripTabForStorage(ws) {
  if (!ws || !ws.data) return ws;
  const { history, future, ...data } = ws.data;
  return { ...ws, data };
}

// The monolithic shape: every workspace in one object. It is what the
// localStorage copy holds and what the pre-v3 IndexedDB record held, so it is
// still the shape `loadBackup` reads — but it is no longer what a save
// *writes* when IndexedDB is available. See THE STORAGE LAYOUT below.
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

export const WORKSPACE_DB_NAME = 'automata-studio';
// The database this one was called before the product was renamed. It is not
// dead weight: an IndexedDB database is identified by its *name*, so renaming
// it points the app at a fresh, empty one and every existing reader's
// workspaces and block library become unreachable in a single release — the
// app simply boots to an empty canvas with nothing to say about it.
//
// electron/main.cjs carries the same scar for userData, where the rename
// stranded every saved workspace because the migration looked for the wrong
// spelling and so never once fired. This is that lesson applied on the way in
// rather than after the fact: the old database is adopted, once, the first
// time the new one is opened.
export const LEGACY_DB_NAMES = ['automata-playground'];
// 3 — one record per workspace. See THE STORAGE LAYOUT below.
export const WORKSPACE_DB_VERSION = 3;
// The v2 store: a single record, key 'current', holding every workspace at
// once. Kept — read-only — as the migration source. Dropping it would mean a
// reader who rolls back to an older build finds no tabs at all.
export const WORKSPACE_STORE_NAME = 'snapshots';
export const WORKSPACE_TABS_STORE = 'workspaces';
export const WORKSPACE_META_STORE = 'meta';
export const WORKSPACE_META_KEY = 'current';

// ══════════════════════════════════════════════════════════════════
//  THE STORAGE LAYOUT
// ══════════════════════════════════════════════════════════════════
//  `workspaces` holds one record per tab, keyed by its id; `meta` holds the
//  one record that says which tabs exist, in what order, which is active, and
//  what the config is. That split is the whole of this stage, and the cost it
//  removes is worth stating plainly.
//
//  Until v3 there was a single record under `snapshots/'current'` carrying
//  *every* workspace. So autosaving one dirty tab meant serialising all of
//  them — `getBackupPayload` maps over the whole of `Workspaces` — writing the
//  lot to IndexedDB, and then serialising them a second time for a synchronous
//  `localStorage.setItem` on the main thread, into a ~5MB quota. Eight tabs
//  open and the reader paid for eight machines, twice, every fifteen seconds,
//  to record a change to one of them. That is the quota failure the comments
//  around `stripTabForStorage` keep circling, and it is O(all tabs) for a
//  change of size one.
//
//  Now a save writes the record that changed plus the small meta record.
//
//  Two things follow that are easy to get wrong:
//
//  - **The meta record is the index, so the tab records are garbage.** A tab
//    closed while the app is shut, or a write that failed halfway, leaves a
//    record nothing points at. Rather than tracking deletions — which is one
//    more thing for a crash to interrupt — every meta write sweeps the store
//    and drops what `order` does not name, in the same transaction. That is
//    the rule `stateIndex()` and `blockIsIntact()` already follow: validate on
//    read, never rely on having been told.
//
//  - **localStorage came off the hot path, not out of the design.** It is
//    still the entire backend when there is no IndexedDB, and still the
//    last-resort copy written on the way out. What it is no longer is a mirror
//    refreshed on every autosave and every tab click. It is refreshed at the
//    two moments a reader would recognise as checkpoints — an explicit Save,
//    and unload — so the stale-fallback window is bounded by something a
//    person can reason about.

function reqDone(request, what) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(what));
  });
}

function txDone(tx, what) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error(what));
    tx.onabort = () => reject(tx.error || new Error(what));
  });
}

// Opens a database only if it is already there. `open` with no version opens
// whatever version exists — and fires `onupgradeneeded` when it had to create
// one, which is how "this did not exist" is detected without `databases()`,
// which Firefox lacked until recently and which no test stub has. A database we
// created just to look inside is deleted again rather than left as litter.
function openIfExists(name) {
  return new Promise(resolve => {
    let req;
    try {
      req = indexedDB.open(name);
    } catch {
      resolve(null);
      return;
    }
    let existed = true;
    req.onupgradeneeded = () => { existed = false; };
    req.onsuccess = () => {
      const db = req.result;
      if (existed) { resolve(db); return; }
      db.close();
      try { indexedDB.deleteDatabase(name); } catch { /* litter, not a failure */ }
      resolve(null);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function storeIsEmpty(db, name) {
  if (!db.objectStoreNames.contains(name)) return Promise.resolve(true);
  return new Promise(resolve => {
    try {
      const req = db.transaction(name, 'readonly').objectStore(name).count();
      req.onsuccess = () => resolve(!req.result);
      req.onerror = () => resolve(true);
    } catch { resolve(true); }
  });
}

async function copyStore(from, to, name) {
  if (!from.objectStoreNames.contains(name) || !to.objectStoreNames.contains(name)) return;
  const readTx = from.transaction(name, 'readonly');
  const src = readTx.objectStore(name);
  if (typeof src.getAllKeys !== 'function' || typeof src.getAll !== 'function') return;
  const keys = await reqDone(src.getAllKeys(), 'Could not list legacy records');
  const values = await reqDone(src.getAll(), 'Could not read legacy records');
  if (!keys || !keys.length) return;

  const writeTx = to.transaction(name, 'readwrite');
  const done = txDone(writeTx, 'Could not adopt legacy records');
  const target = writeTx.objectStore(name);
  keys.forEach((key, i) => target.put(values[i], key));
  await done;
}

// Runs at most once per session, and at most once ever in practice — it copies
// nothing when the new database already has anything in it. Memoised on the
// promise rather than a boolean, because `blocks-ui.js` opens this database too
// and can easily get there first; two concurrent adoptions would race on the
// same stores.
let legacyAdoption = null;

function adoptLegacyDatabases() {
  if (legacyAdoption) return legacyAdoption;
  legacyAdoption = (async () => {
    let target = null;
    try {
      target = await rawOpenWorkspaceDb();
      if (!target) return;
      // Anything already here means this reader has used the renamed database,
      // so there is nothing to adopt and copying would overwrite live work.
      const empty = await Promise.all(
        [WORKSPACE_TABS_STORE, WORKSPACE_META_STORE, WORKSPACE_STORE_NAME, 'blocks']
          .map(name => storeIsEmpty(target, name))
      );
      if (!empty.every(Boolean)) return;

      for (const name of LEGACY_DB_NAMES) {
        const source = await openIfExists(name);
        if (!source) continue;
        try {
          // Every store, because the block library lives here too — a rename
          // that carried the workspaces and dropped the blocks would be half a
          // migration and much harder to notice.
          for (const store of [WORKSPACE_STORE_NAME, WORKSPACE_TABS_STORE, WORKSPACE_META_STORE, 'blocks']) {
            await copyStore(source, target, store);
          }
        } finally {
          source.close();
        }
        break;
      }
    } catch { /* a failed adoption must not stop the app opening */ } finally {
      target?.close();
    }
  })();
  return legacyAdoption;
}

// Cleared by tests/harness.js: the memo would otherwise let one test's
// adoption stand in for the next test's.
export function _resetLegacyAdoptionForTests() {
  legacyAdoption = null;
}

// The plain open, with no adoption in front of it — what the adoption itself
// uses, and what would otherwise recurse.
function rawOpenWorkspaceDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) db.createObjectStore(WORKSPACE_STORE_NAME);
      // One record per workspace, plus the index that names them. See THE
      // STORAGE LAYOUT above.
      if (!db.objectStoreNames.contains(WORKSPACE_TABS_STORE)) db.createObjectStore(WORKSPACE_TABS_STORE);
      if (!db.objectStoreNames.contains(WORKSPACE_META_STORE)) db.createObjectStore(WORKSPACE_META_STORE);
      // The building-block library. A definition is a whole machine, so it
      // belongs here beside the workspace records rather than in
      // localStorage, which is where this app's quota failures already live —
      // and emphatically not in App.config, which is deep-copied into every
      // workspace tab and written into every file the reader saves.
      if (!db.objectStoreNames.contains('blocks')) db.createObjectStore('blocks');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open workspace storage'));
    // A version bump cannot proceed while another tab still holds the database
    // open at the old version: `onupgradeneeded` never fires, `onsuccess` and
    // `onerror` never fire either, and the promise simply never settles — so
    // every awaiting caller (the boot restore, every autosave) hangs silently
    // and forever. Answering null instead sends them down the same path a
    // browser with no IndexedDB takes, which they all already handle.
    request.onblocked = () => resolve(null);
  });
}

// The one every caller uses. The adoption runs before the handle is handed
// over, so nothing downstream has to know the database was ever called
// anything else.
export async function openWorkspaceDb() {
  if (typeof indexedDB === 'undefined') return null;
  await adoptLegacyDatabases();
  return rawOpenWorkspaceDb();
}

// The tab records to write, refreshed from live `App` for the active one.
// Marked clean because writing them is what makes them so; a tab not named
// here keeps whatever mark it was last written with.
function tabRecordsFor(ids) {
  const act = Workspaces.find(w => w.id === activeWorkspaceId);
  if (act && typeof exportWorkspaceState === 'function') act.data = exportWorkspaceState();
  const want = new Set(ids);
  return Workspaces.filter(w => want.has(w.id)).map(w => stripTabForStorage({ ...w, dirty: false }));
}

// The index. Small and bounded — ids, a name per tab, and the config — so it
// is cheap to rewrite on every tab click, which is exactly what tab operations
// do. `schema` is stamped so a future layout change has the same one field to
// key on that a document does.
function metaRecordNow() {
  return {
    schema: SCHEMA_VERSION,
    app: APP_VERSION,
    activeId: activeWorkspaceId,
    order: Workspaces.map(w => w.id),
    config: App.config,
    savedAt: Date.now()
  };
}

// Writes the named tab records and the index, in one transaction, and sweeps
// records the index no longer names. Answers which backend took the write, so
// callers can tell a real save from the localStorage fallback.
export async function writeWorkspaceRecords(ids = []) {
  let db = null;
  try {
    db = await openWorkspaceDb();
  } catch {
    db = null;
  }
  if (!db) {
    // No IndexedDB, or a blocked version bump. localStorage is the whole
    // backend here, so it takes the full payload exactly as it always did.
    await Promise.resolve();
    const payload = getBackupPayload(ids);
    // Null when there is no active workspace to describe. Writing it would
    // put the string "null" where a good backup was and lose the reader's
    // tabs on the next boot.
    if (!payload) return 'localStorage';
    localStorage.setItem('automata-backup', JSON.stringify(payload));
    return 'localStorage';
  }
  try {
    const records = tabRecordsFor(ids);
    const meta = metaRecordNow();

    // Nothing is awaited between opening this transaction and issuing its last
    // request, and `txDone` attaches its handlers before the first await. That
    // is not style: an IndexedDB transaction commits as soon as control returns
    // to the event loop with no request outstanding, so an `await` in the
    // middle can leave the writes that follow it throwing into a transaction
    // that is already gone — and a completion handler attached afterwards
    // never fires at all, which is a save that hangs rather than one that
    // fails. The sweep below is a separate transaction for exactly this reason.
    const tx = db.transaction([WORKSPACE_TABS_STORE, WORKSPACE_META_STORE], 'readwrite');
    const written = txDone(tx, 'Could not save workspace');
    const tabs = tx.objectStore(WORKSPACE_TABS_STORE);
    for (const rec of records) tabs.put(rec, rec.id);
    tx.objectStore(WORKSPACE_META_STORE).put(meta, WORKSPACE_META_KEY);
    await written;

    await sweepOrphanRecords(db, new Set(meta.order));
    return 'indexedDB';
  } finally {
    db.close();
  }
}

// Drops workspace records the index no longer names — a tab closed while the
// app was shut, or a write that failed partway. Best-effort by design: an
// environment without `getAllKeys` still gets correct saves, it just keeps
// orphans nothing will ever read. Failing a save over unreachable garbage
// would be the wrong trade, so every path here swallows.
async function sweepOrphanRecords(db, live) {
  try {
    const readTx = db.transaction(WORKSPACE_TABS_STORE, 'readonly');
    const store = readTx.objectStore(WORKSPACE_TABS_STORE);
    if (typeof store.getAllKeys !== 'function') return;
    const keys = await reqDone(store.getAllKeys(), 'Could not list workspace records');
    const dead = (keys || []).filter(key => !live.has(key));
    if (!dead.length) return;

    const delTx = db.transaction(WORKSPACE_TABS_STORE, 'readwrite');
    const swept = txDone(delTx, 'Could not sweep workspace records');
    const target = delTx.objectStore(WORKSPACE_TABS_STORE);
    for (const key of dead) target.delete(key);
    await swept;
  } catch { /* orphans are invisible to every reader; leaving them is safe */ }
}

// Reads the v3 layout back into the shape `loadBackup` has always taken:
// `{tabs, activeId, config}`. Null when there is nothing there.
async function readRecordLayout(db) {
  if (!db.objectStoreNames.contains(WORKSPACE_META_STORE)) return null;
  if (!db.objectStoreNames.contains(WORKSPACE_TABS_STORE)) return null;

  const metaTx = db.transaction(WORKSPACE_META_STORE, 'readonly');
  const meta = await reqDone(
    metaTx.objectStore(WORKSPACE_META_STORE).get(WORKSPACE_META_KEY),
    'Could not read workspace index'
  );
  if (!meta || !Array.isArray(meta.order) || !meta.order.length) return null;

  // A second transaction, because the one above is finished with — see the
  // note in writeWorkspaceRecords. Every get is issued synchronously here,
  // before the first await, so the transaction cannot commit out from under
  // them; awaiting them one at a time would be a transaction per tab and boot
  // latency proportional to how many are open.
  const tabsTx = db.transaction(WORKSPACE_TABS_STORE, 'readonly');
  const store = tabsTx.objectStore(WORKSPACE_TABS_STORE);
  const pending = meta.order.map(
    id => reqDone(store.get(id), 'Could not read a workspace').catch(() => null)
  );
  const tabs = (await Promise.all(pending)).filter(Boolean);
  if (!tabs.length) return null;
  return { tabs, activeId: meta.activeId, config: meta.config };
}

// The v2 single record, which is what every existing install has.
async function readLegacySnapshot(db) {
  if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) return null;
  const tx = db.transaction(WORKSPACE_STORE_NAME, 'readonly');
  const found = await reqDone(
    tx.objectStore(WORKSPACE_STORE_NAME).get('current'),
    'Could not read workspace storage'
  );
  return found || null;
}

// Reads back whatever IndexedDB holds, newest layout first. Returns null when
// there is no IndexedDB, no database yet, or nothing saved — every one of
// which is a normal first-run state, so the caller falls back to the
// localStorage backup rather than treating it as an error.
export async function readWorkspaceSnapshot() {
  let db;
  try {
    db = await openWorkspaceDb();
  } catch {
    return null;
  }
  if (!db) return null;
  try {
    const current = await readRecordLayout(db);
    if (current) return { ...current, source: 'records' };
    // Nothing in the v3 layout. An install that predates it has its tabs in
    // the v2 record; hand them back and let the next save write them out as
    // records. Migrating here rather than on write is deliberate — a reader
    // who opens the app and closes it again has lost nothing, and a migration
    // that only runs when there is something to migrate cannot corrupt a
    // fresh install.
    const legacy = await readLegacySnapshot(db);
    return legacy ? { ...legacy, source: 'legacy' } : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// ── Tab-structure writes ──────────────────────────────────────────
//  Creating, closing, renaming, reordering and switching tabs all change the
//  index and nothing else about the machine on screen. They fire through here.
//
//  Coalesced, because a bulk close calls this once per tab and each call is a
//  transaction: without it, closing eight tabs opens eight overlapping writes
//  that all describe the same final state. A request arriving while one is in
//  flight sets a flag and is served by a single re-run afterwards.
let tabStateWriteInFlight = null;
let tabStateWriteAgain = false;

// A write left in flight would have the next test's tab operation served by
// the previous one's coalescing pass. Cleared by tests/harness.js.
export function _resetTabStateWritesForTests() {
  tabStateWriteInFlight = null;
  tabStateWriteAgain = false;
}

export function persistTabState() {
  if (tabStateWriteInFlight) {
    tabStateWriteAgain = true;
    return tabStateWriteInFlight;
  }
  const run = async () => {
    do {
      tabStateWriteAgain = false;
      await writeWorkspaceRecords(activeWorkspaceId ? [activeWorkspaceId] : []);
    } while (tabStateWriteAgain);
  };
  tabStateWriteInFlight = run()
    .catch(() => {
      if (typeof setSaveState === 'function') setSaveState('error', 'Save failed');
    })
    .finally(() => { tabStateWriteInFlight = null; });
  return tabStateWriteInFlight;
}

export async function saveWorkspace(opts = {}) {
  if (pendingWorkspaceSave) return pendingWorkspaceSave;
  if (typeof setSaveState === 'function') setSaveState('saving');

  pendingWorkspaceSave = Promise.resolve().then(async () => {
    if (typeof exportWorkspaceState !== 'function' || !activeWorkspaceId) return false;
    const backend = await writeWorkspaceRecords([activeWorkspaceId]);
    const active = Workspaces.find(ws => ws.id === activeWorkspaceId);
    const wasDirty = active ? active.dirty : false;
    if (active) active.dirty = false;
    // An explicit Save is one of the two checkpoints where the localStorage
    // copy is brought back up to date — see THE STORAGE LAYOUT. When
    // localStorage *is* the backend the write above already did it, and a
    // second one would be the double serialisation this stage removed.
    if (backend !== 'localStorage' && !saveBackup()) {
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
// so the others just need their existing record written.
//
// This is autosave's path, so it writes one record and does not touch
// localStorage — which is the whole point of the record layout.
export async function saveWorkspaceById(id) {
  const ws = Workspaces.find(w => w.id === id);
  if (!ws) return true;
  if (id === activeWorkspaceId) return saveWorkspace({ silent: true });
  const wasDirty = ws.dirty;
  try {
    await writeWorkspaceRecords([id]);
    ws.dirty = false;
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

// ══════════════════════════════════════════════════════════════════
//  DOCUMENTS
// ══════════════════════════════════════════════════════════════════
//  Two hosts, one set of verbs. On the desktop a workspace has a *file* — a
//  path it came from and can be written back to — so Save means save. On the
//  website there is no path, a save is a download, and Save can only ever mean
//  "put another copy in the Downloads folder". [js/file-host.js](js/file-host.js)
//  is where that difference lives; everything below reads the same in both.
//
//  The path is tracked per workspace (`ws.filePath`), not globally, because
//  tabs are independent documents — and it rides in the tab record, so closing
//  the app and reopening it leaves Ctrl+S still meaning the file you were
//  working on.

// The active tab, which is what a document verb acts on.
function activeWorkspace() {
  return Workspaces.find(w => w.id === activeWorkspaceId) || null;
}

// Records which file the active workspace is now, and tells the host so the
// title, the macOS proxy icon and the Recent Files list follow.
function bindActiveFile(filePath, { rename = false } = {}) {
  const ws = activeWorkspace();
  if (ws) {
    ws.filePath = filePath || null;
    if (rename && filePath) ws.name = fileStem(filePath) || ws.name;
  }
  noteOpenDocument(filePath, { dirty: !!ws?.dirty });
  if (typeof renderTabs === 'function') renderTabs();
}

export function activeFilePath() {
  return activeWorkspace()?.filePath || null;
}

// The document, as it goes to disk or into a download.
function documentText() {
  return JSON.stringify(getWorkspaceData(), null, 2);
}

// ── Saving ────────────────────────────────────────────────────────

// The primary save. On the desktop it writes the file this workspace came
// from, asking for a location only the first time; in the browser there is no
// file, so it stays the download it has always been.
export async function saveDocument() {
  if (!hasFileHost()) { saveJSON(); return true; }
  const path = activeFilePath();
  if (!path) return saveDocumentAs();

  const res = await writeFile(path, documentText());
  if (!res.ok) {
    // A cancel cannot happen on this path — there is no dialog — so anything
    // that is not success is a real failure worth reporting.
    showStatus(`Could not save: ${res.error || 'unknown error'}`);
    if (typeof setSaveState === 'function') setSaveState('error', 'Save failed');
    return false;
  }
  bindActiveFile(path);
  showStatus(`Saved ${fileStem(path)}${WORKSPACE_EXT}`);
  if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
  return true;
}

// Always asks. In the browser this is the plain download, because a download
// *is* a "where should this go" prompt as far as the user is concerned.
export async function saveDocumentAs() {
  if (!hasFileHost()) { saveJSON(); return true; }
  const ws = activeWorkspace();
  const suggestion = activeFilePath() || suggestedFileName(ws?.name || 'machine');

  const res = await saveFileAs(documentText(), suggestion);
  // Escape is the reader changing their mind. Reporting it as a failure is a
  // bug they will believe, so it is silent.
  if (res.canceled) return false;
  if (!res.ok) {
    showStatus(`Could not save: ${res.error || 'unknown error'}`);
    return false;
  }
  bindActiveFile(res.path, { rename: true });
  showStatus(`Saved ${fileStem(res.path)}${WORKSPACE_EXT}`);
  if (typeof markActiveWorkspaceSaved === 'function') markActiveWorkspaceSaved();
  return true;
}

// The browser's save: a Blob and an `<a download>`. Named after the workspace
// now — it was `automaton.json` every single time, so every save after the
// first landed as `automaton (1)`, `automaton (2)`, a folder of files none of
// which say what is in them.
export function saveJSON() {
  const blob = new Blob([documentText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedFileName(activeWorkspace()?.name || 'machine');
  a.click();
  showStatus('Machine saved');
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

// ── Opening ───────────────────────────────────────────────────────

// The native dialog where there is one, the hidden `<input type=file>` where
// there is not.
export function loadJSON() {
  if (!hasFileHost()) { $('file-input').click(); return; }
  void openDocument();
}

export async function openDocument() {
  const res = await openFileDialog();
  if (res.canceled) return false;
  if (!res.ok) {
    showStatus(`Could not open: ${res.error || 'unknown error'}`);
    return false;
  }
  return applyOpenedDocument(res);
}

// A document the host handed over: from the Open dialog, from a double-click,
// from an "Open With", or from a path on the command line. `binary` is a PNG,
// which carries the workspace in a trailing text chunk and so has to arrive as
// bytes — decoding it as UTF-8 first would mangle everything before the marker.
export function applyOpenedDocument(doc) {
  if (!doc || !doc.path) return false;
  const payload = doc.binary
    ? Uint8Array.from(atob(doc.base64 || ''), c => c.charCodeAt(0)).buffer
    : doc.text;
  const ok = applyDocument(payload, doc.path);
  // A file that would not parse is not the file this workspace is; binding the
  // path anyway would point Ctrl+S at it and overwrite it with something else.
  if (ok) bindActiveFile(doc.path, { rename: true });
  return ok;
}

// ── Reading one ───────────────────────────────────────────────────

// The one parser, shared by the drop handler, the file input and the host.
// `payload` is text, or an ArrayBuffer for a PNG; `name` decides which, and is
// a filename rather than a path so the two callers can both supply it.
//
// Returns whether the document was applied, because the caller has to know
// before it binds a path to the workspace.
export function applyDocument(payload, name) {
  const lower = String(name || '').toLowerCase();
  const isPng = lower.endsWith('.png');
  const isJflap = lower.endsWith('.jff') || lower.endsWith('.jflap');
  try {
    // JFLAP files carry their own schema; importJFLAPText validates and
    // loads them, so they never reach the workspace JSON path below.
    // JFLAP carries no description of its own, so anything the previous
    // machine had to say goes away with it.
    if (isJflap) { importJFLAPText(payload); showExampleCard(null); return true; }

    let data;
    if (isPng) {
      const text = new TextDecoder().decode(payload);
      const marker = "\n--AutomataData--\n";
      const parts = text.split(marker);
      if (parts.length < 2) {
        showStatus('Error: No workspace data found in this PNG');
        return false;
      }
      data = JSON.parse(parts[1]);
    } else {
      data = JSON.parse(payload);
    }
    validateSchema(data);
    loadData(data);
    // A saved workspace usually has no `meta`; an example or a StateMate
    // result saved to disk does. Either way the card is retargeted rather
    // than left describing the machine that was just replaced.
    showExampleCard(data.meta || null);
    showStatus('Machine loaded');
    return true;
  } catch (err) {
    console.error(err);
    if (isJflap) { showStatus(`Could not import JFLAP file: ${err.message}`); return false; }
    const isCustomErr = err.message && !err.message.includes('JSON');
    showStatus(isCustomErr ? `Validation Error: ${err.message}` : (isPng ? 'Could not extract workspace data' : 'Could not read this file'));
    return false;
  }
}

export function handleFiles(files) {
  const f = files[0]; if (!f) return;
  const isPng = f.name.toLowerCase().endsWith('.png');
  const reader = new FileReader();
  // A file dropped from the desktop has a name but no path — the browser does
  // not give one, and Electron's `File.path` was removed in v32. So a drop
  // never binds a file to the workspace: it loads the machine and leaves Ctrl+S
  // meaning whatever it meant before, rather than silently retargeting it at a
  // file the reader only dragged in to look at.
  reader.onload = ev => { applyDocument(ev.target.result, f.name); };
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

  // Before anything else: a document from a newer build is refused outright
  // rather than read with its unknown fields silently dropped.
  assertReadableSchema(data);
  
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
  // Every path in — a file, a link, a PNG, a storage record, an example, an
  // algorithm result — comes through here, so this is where the chain runs.
  // `validateSchema` has already refused a future document on the paths that
  // validate; this is the backstop for the ones that do not.
  d = migrateWorkspaceDoc(d);
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
  App.blocks = Array.isArray(d.blocks) ? d.blocks : [];
  App.scope = Array.isArray(d.scope)
    ? d.scope.filter(id => App.blocks.some(b => b.id === id))
    : [];
  App.selectedNotes.clear();
  App.selectedDividers.clear();
  // Re-derived from the transitions on every load, whatever the schema said —
  // see normalizeMachineType for why this is not a migration.
  App.machine = normalizeMachineType({ machine: App.machine, transitions: App.transitions });
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
  // The `else` that used to call migrateLegacySymbols here is gone: that is a
  // v0 concern and it now runs in MIGRATIONS[0], before any of this reads the
  // document. Running it here as well would map an already-mapped symbol.
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


// ── The localStorage copy ─────────────────────────────────────────
// The whole backend when there is no IndexedDB, and otherwise the last-resort
// copy — see THE STORAGE LAYOUT. It writes every workspace at once, which is
// why it is no longer on the autosave or tab-operation path: it is refreshed
// at the two checkpoints a reader would recognise, an explicit Save and
// unload, and nowhere else.
//
// Returns true when the payload reached localStorage, so a quota error cannot
// pass silently as a successful save.
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
  // Tab operations change the index — which tabs exist, their order, which is
  // active — plus, for a switch, the outgoing tab's own record. Both are the
  // record write, so this no longer serialises every workspace into
  // localStorage to record that one of them was renamed.
  //
  // The write is asynchronous and reports its own failure through the save
  // indicator, which is how `saveWorkspace` has always reported. The return
  // value is kept for the call sites that read like a checked call; no caller
  // has ever branched on it.
  void persistTabState();
  return true;
}

// Prefers the IndexedDB snapshot, which is where saveWorkspace puts the
// authoritative copy; localStorage is the fallback for first run, private
// mode, and builds that predate the IndexedDB backend.
export async function readLatestBackup() {
  const snapshot = await readWorkspaceSnapshot();
  if (snapshot && Array.isArray(snapshot.tabs) && snapshot.tabs.length) return snapshot;
  try {
    const raw = localStorage.getItem('automata-backup');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, source: 'localStorage' };
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

      // Restored from somewhere that is not the record layout — a v2 database,
      // or the localStorage fallback. Write the records out now rather than
      // waiting for the reader's first edit, so that the very next boot is a
      // cheap one and the legacy record stops being the thing keeping the tabs
      // alive. switchTab's own incidental write would mostly cover this; doing
      // it here is what makes it a decision rather than a side effect.
      if (loaded.source && loaded.source !== 'records') {
        void persistTabState();
      }
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
  // The second checkpoint. Autosave and every tab operation have already put
  // the records in IndexedDB, but an edit made since the last tick has not
  // been written anywhere — and an asynchronous write started here is not
  // guaranteed to finish. So the synchronous copy stays, once, on the way out.
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
