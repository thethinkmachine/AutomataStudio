// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY, FETCHED AND KEPT
// ══════════════════════════════════════════════════════════════════
// Three stores, one small IndexedDB database of their own:
//
//   kv      the last index fetched, with when — so the Library opens instantly
//           and works offline, and a network failure shows the last good copy
//           rather than an empty shelf
//   files   entry files by content hash — a machine opened once opens again
//           without the network, and a changed entry is simply a new key
//   saved   "My Library": entries the reader chose to keep, with their text,
//           available offline and checked against the index for updates
//
// A database of its own (`automata-studio-library`) rather than a store in the
// workspace database: adding a store there means a version bump in
// openWorkspaceDb, whose upgrade path guards the reader's tabs and has a scar
// for every time it went wrong. Nothing in here is precious — every row can be
// fetched again — so it lives where a failure costs a re-download, not a tab.
//
// With no IndexedDB at all (a private window in some browsers, the test DOM)
// the same API runs against a Map, and the Library still works for the session.

import { contentHash, machineStructureHash } from './hash.js';
import { entryFileUrls, indexUrl, libraryBase } from './config.js';
import { normalizeIndex } from './index-model.js';

const DB_NAME = 'automata-studio-library';
const DB_VERSION = 1;
const STORES = ['kv', 'files', 'saved'];

/** How long a fetched index is used without asking the network again. */
export const INDEX_FRESH_MS = 30 * 60 * 1000;

let dbPromise = null;
const memory = { kv: new Map(), files: new Map(), saved: new Map() };

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    let req;
    try {
      if (!globalThis.indexedDB) return resolve(null);
      req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

// One request per transaction, handlers attached before the request can
// complete — the rule persistence.js learned: an await inside a live
// transaction lets it commit underneath you.
async function idb(store, mode, fn) {
  const db = await openDb();
  if (!db || !db.objectStoreNames?.contains?.(store)) return fn(null);
  return new Promise((resolve, reject) => {
    let out;
    try {
      const tx = db.transaction(store, mode);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('Library storage failed'));
      tx.onabort = () => reject(tx.error || new Error('Library storage failed'));
      const req = fn(tx.objectStore(store));
      if (req) req.onsuccess = () => { out = req.result; };
    } catch (e) {
      reject(e);
    }
  });
}

async function get(store, key) {
  try {
    const v = await idb(store, 'readonly', s => (s ? s.get(key) : null));
    return v === undefined || v === null ? (memory[store].get(key) ?? null) : v;
  } catch {
    return memory[store].get(key) ?? null;
  }
}

async function put(store, key, value) {
  memory[store].set(key, value);
  try { await idb(store, 'readwrite', s => (s ? s.put(value, key) : null)); } catch { /* the memory copy stands */ }
}

async function del(store, key) {
  memory[store].delete(key);
  try { await idb(store, 'readwrite', s => (s ? s.delete(key) : null)); } catch { /* nothing to undo */ }
}

async function all(store) {
  try {
    const rows = await idb(store, 'readonly', s => (s ? s.getAll() : null));
    if (Array.isArray(rows)) return rows;
  } catch { /* fall through */ }
  return [...memory[store].values()];
}

/** Test seam: forget the database handle and the in-memory copies. */
export function _resetLibraryClientForTests() {
  dbPromise = null;
  for (const m of Object.values(memory)) m.clear();
  current = null;
  inflight = null;
}

// ── The index ─────────────────────────────────────────────────────

let current = null;   // { index, fetchedAt, base, stale, error }
let inflight = null;

/**
 * The index held in memory right now, without asking anything — and only if
 * it came from the source the app is now reading. An index from before the
 * reader switched sources is another library's, and showing it under the new
 * source's name would put badges on screen that the new one never earned.
 */
export function cachedLibrary() {
  return current && current.base === libraryBase() ? current : null;
}

/**
 * The index, from memory, the database or the network, in that order of
 * preference — unless it is older than INDEX_FRESH_MS or `force` is set, when
 * the network is asked first and the cached copy is the fallback.
 *
 * Resolves `{ index, fetchedAt, stale, error }` and never rejects: a Library
 * that cannot reach the network with a copy in hand shows the copy and says it
 * is offline; one with nothing says so and nothing else.
 */
export function loadLibrary({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const base = libraryBase();
  if (inflight && inflight.base === base) return inflight;
  const run = (async () => {
    // Always asynchronous: a fresh copy in memory would otherwise return, and
    // run the `finally` below, before `inflight` was even assigned — leaving
    // a settled promise behind as "in flight", which every later call, a
    // forced refresh included, would be handed back.
    await null;
    try {
      if (current && current.base !== base) current = null;
      if (!current) {
        const kept = await get('kv', 'index');
        if (kept && kept.base === base && kept.raw) {
          try { current = { index: normalizeIndex(kept.raw), fetchedAt: kept.fetchedAt, base, stale: false, error: null }; }
          catch { current = null; }
        }
      }
      const fresh = current && Date.now() - current.fetchedAt < INDEX_FRESH_MS;
      if (fresh && !force) return current;
      try {
        const res = await fetchImpl(indexUrl(base), { cache: 'no-cache' });
        if (!res.ok) throw new Error(`The library answered ${res.status}.`);
        const raw = await res.json();
        const index = normalizeIndex(raw);
        const fetchedAt = Date.now();
        const got = { index, fetchedAt, base, stale: false, error: null };
        await put('kv', 'index', { raw, fetchedAt, base });
        // The source may have been switched while this was on the wire.
        if (libraryBase() === base) current = got;
        return got;
      } catch (e) {
        const error = e?.message || 'The library could not be reached.';
        if (current) { current = { ...current, stale: true, error }; return current; }
        return { index: null, fetchedAt: 0, base, stale: true, error };
      }
    } finally {
      if (inflight === run) inflight = null;
    }
  })();
  run.base = base;
  inflight = run;
  return run;
}

// ── An entry's file ───────────────────────────────────────────────

/**
 * The text of an entry's `.automaton` file, verified against the hash the index
 * lists. From My Library or the file cache when either holds those exact bytes;
 * otherwise from jsDelivr at the index's commit, then from the site.
 *
 * A download whose hash does not match is not used — it is a file other than
 * the one the listing describes, and the badges on screen are claims about that
 * one. The next URL is tried instead, and if none match the error says so.
 */
export async function fetchEntryText(entry, index, { fetchImpl = globalThis.fetch } = {}) {
  if (entry.hash) {
    const saved = await get('saved', entry.id);
    if (saved && saved.hash === entry.hash && typeof saved.text === 'string') return saved.text;
    const cached = await get('files', entry.hash);
    if (typeof cached === 'string') return cached;
  }
  let lastError = null;
  for (const url of entryFileUrls(entry, index)) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) { lastError = new Error(`${res.status} from ${new URL(url).host}`); continue; }
      const text = await res.text();
      if (entry.hash && contentHash(text) !== entry.hash) {
        lastError = new Error('The downloaded file does not match the library index.');
        continue;
      }
      if (entry.hash) await put('files', entry.hash, text);
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  // Offline, with an older copy saved: better the reader's own copy than
  // nothing, and the caller is told it is not the listed version.
  const saved = await get('saved', entry.id);
  if (saved && typeof saved.text === 'string') {
    const err = new Error('offline-copy');
    err.text = saved.text;
    throw err;
  }
  throw lastError || new Error('The machine could not be downloaded.');
}

/**
 * The text of an essay the index lists (`entry.essay` or `collection.essay`):
 * fetched, verified and cached exactly as a machine's file is — from the file
 * cache by hash, else jsDelivr at the index's commit, else the site. So an
 * essay read once reads again offline, and a download that is not the listed
 * text is refused. Never from My Library, which keeps machines, not prose.
 */
export function fetchEssayText(essay, index, opts = {}) {
  return fetchEntryText({ id: `essay:${essay.path}`, path: essay.path, hash: essay.hash }, index, opts);
}

/** A fetched entry's text → a document stamped with where it came from. */
export function stampSource(text, entry) {
  const doc = JSON.parse(text);
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const library = meta.library && typeof meta.library === 'object' ? meta.library : {};
  doc.meta = {
    ...meta,
    library: {
      ...library,
      source: { id: entry.id, hash: contentHash(text), structure: machineStructureHash(doc), version: entry.version || 1, title: entry.title }
    }
  };
  return doc;
}

// ── My Library ────────────────────────────────────────────────────

export async function listMyLibrary() {
  const rows = await all('saved');
  return rows.filter(r => r && r.id).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export async function isInMyLibrary(id) {
  return !!(await get('saved', id));
}

/** Keep an entry offline. The index row is kept with it, so My Library can list it with no network. */
export async function saveToMyLibrary(entry, text) {
  const row = { id: entry.id, hash: contentHash(text), text, entry, savedAt: Date.now() };
  await put('saved', entry.id, row);
  return row;
}

export async function removeFromMyLibrary(id) {
  await del('saved', id);
}

/** Saved entries whose published version has moved on. */
export function updatesFor(saved, index) {
  if (!index) return [];
  const byId = new Map(index.entries.map(e => [e.id, e]));
  return saved.filter(r => {
    const e = byId.get(r.id);
    return e && e.hash && r.hash !== e.hash;
  }).map(r => ({ saved: r, entry: byId.get(r.id) }));
}

/**
 * Whether the machine a document came from has a newer published version.
 * `source` is `meta.library.source` as stampSource wrote it.
 */
export function sourceIsOutdated(source, index) {
  if (!source || !index) return false;
  const e = index.entries.find(x => x.id === source.id);
  return !!(e && e.hash && source.hash && e.hash !== source.hash);
}

// ── Recently opened ───────────────────────────────────────────────

const RECENT_KEY = 'as.library.recent';
const RECENT_MAX = 12;

export function recentLibraryIds() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function noteRecentlyOpened(id) {
  try {
    const next = [id, ...recentLibraryIds().filter(x => x !== id)].slice(0, RECENT_MAX);
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* a remembered list is a convenience */ }
}
