import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const {context} = harness;

// An in-memory IndexedDB standing in for the real thing. It models what the
// record layout actually needs: named object stores, a transaction that
// completes once rather than once per write, and `getAllKeys`/`delete` so the
// orphan sweep is exercised rather than skipped.
//
// `db` is exposed so assertions can read what was written without going
// through the app code under test. `stores()` names them the way the app does.
function installFakeIndexedDB({ failWrites = false, existingStores = null, databases = null } = {}) {
  // dbName -> (storeName -> Map(key -> value)). Keyed by name because the
  // database was renamed and the adoption is a copy *between* two of them —
  // a fake with one anonymous store set cannot express that at all.
  const all = databases || new Map();
  const dbName = context.WORKSPACE_DB_NAME;
  if (!all.has(dbName)) all.set(dbName, new Map());
  const db = all.get(dbName);
  const puts = [];               // every (store, key) written, in order
  const storeFor = name => {
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name);
  };
  // Which stores the database claims to have. Defaults to all of them; a test
  // migrating from v2 passes only the legacy one.
  const present = existingStores ? new Set(existingStores) : null;

  const fire = (obj, prop, arg) => {
    // Handlers are assigned after the call returns, so defer a turn.
    setTimeout(() => { if (typeof obj[prop] === 'function') obj[prop](arg); }, 0);
  };

  // One database handle. `present` is which stores it claims to have.
  const makeDb = (name, bucketMap, present) => {
    const storeIn = n => {
      if (!bucketMap.has(n)) bucketMap.set(n, new Map());
      return bucketMap.get(n);
    };
    return {
      name,
      objectStoreNames: { contains: n => (present ? present.has(n) : true) },
      createObjectStore: n => { storeIn(n); present?.add(n); },
      close: () => {},
      transaction(names, mode) {
        const tx = { error: null };
        let settled = false;
        const fail = err => {
          if (settled) return;
          settled = true; tx.error = err; fire(tx, 'onerror');
        };
        const complete = () => {
          if (settled) return;
          settled = true; fire(tx, 'oncomplete');
        };
        tx.objectStore = n => {
          const bucket = storeIn(n);
          return {
            put(value, key) {
              if (failWrites && name === dbName) { fail(new Error('quota')); return {}; }
              puts.push({ store: n, key, db: name });
              bucket.set(key, JSON.parse(JSON.stringify(value)));
              return {};
            },
            get(key) {
              const r = { result: bucket.has(key) ? bucket.get(key) : null };
              fire(r, 'onsuccess'); return r;
            },
            getAllKeys() { const r = { result: [...bucket.keys()] }; fire(r, 'onsuccess'); return r; },
            getAll() { const r = { result: [...bucket.values()] }; fire(r, 'onsuccess'); return r; },
            count() { const r = { result: bucket.size }; fire(r, 'onsuccess'); return r; },
            delete(key) { bucket.delete(key); return {}; }
          };
        };
        setTimeout(complete, 0);
        return tx;
      }
    };
  };

  // A version per database, because that is what decides whether
  // `onupgradeneeded` fires — and the app creates its object stores in there.
  const versions = new Map();
  const presentFor = new Map();
  const seed = (name, ver) => {
    if (!all.has(name)) all.set(name, new Map());
    versions.set(name, ver);
    presentFor.set(name, new Set(existingStores && name === dbName
      ? existingStores
      : [...all.get(name).keys()]));
  };
  // Anything the installer was handed already exists, at whatever version.
  for (const name of all.keys()) seed(name, 1);

  context.indexedDB = {
    open(name, version) {
      const req = { result: null, error: null };
      const target = name ?? dbName;
      setTimeout(() => {
        const existed = versions.has(target);
        if (!existed) seed(target, 0);
        const at = versions.get(target);
        // No version: open whatever is there, creating at 1 if absent — which
        // is the only case that upgrades, and is how the app detects that a
        // database it asked about was not already present.
        const want = version === undefined ? (existed ? at : 1) : version;
        req.result = makeDb(target, all.get(target), presentFor.get(target));
        if (want > at) {
          versions.set(target, want);
          if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded();
        }
        if (typeof req.onsuccess === 'function') req.onsuccess();
      }, 0);
      return req;
    },
    deleteDatabase(name) {
      all.delete(name); versions.delete(name); presentFor.delete(name);
      return {};
    }
  };

  return {
    raw: db,
    all,
    puts,
    tabPuts: () => puts.filter(w => w.store === context.WORKSPACE_TABS_STORE).map(w => w.key),
    tabs: () => storeFor(context.WORKSPACE_TABS_STORE),
    meta: () => storeFor(context.WORKSPACE_META_STORE).get(context.WORKSPACE_META_KEY) || null,
    legacy: () => storeFor(context.WORKSPACE_STORE_NAME)
  };
}

function clearIndexedDB() {
  context.indexedDB = undefined;
}

// Seeds one active workspace carrying a recognisable camera position and a
// bulky undo history, so tests can assert on both persistence and pruning.
function seedActiveWorkspace() {
  harness.resetApp();
  context.Workspaces.length = 0; context.setActiveWorkspaceId(null);
  context.App.cam = { x: 111, y: 222, z: 3 };
  context.App.history = ['{"a":1}', '{"a":2}'];
  context.App.future = ['{"a":3}'];
  context.Workspaces.push({ id: 'w0', name: 'A', dirty: true, data: context.exportWorkspaceState() }); context.setActiveWorkspaceId('w0');
}

function readLocalBackup() {
  const raw = context.localStorage.getItem('automata-backup');
  return raw ? JSON.parse(raw) : null;
}

// ── Undo history must never reach storage ─────────────────────────

test('saveBackup strips undo history from the persisted payload', () => {
  clearIndexedDB();
  seedActiveWorkspace();

  assert.strictEqual(context.saveBackup(), true);

  const payload = readLocalBackup();
  assert.ok(payload, 'a backup should have been written');
  assert.strictEqual(payload.tabs[0].data.history, undefined, 'history must not be persisted');
  assert.strictEqual(payload.tabs[0].data.future, undefined, 'future must not be persisted');
});

test('stripping history leaves the live in-memory stacks intact', () => {
  clearIndexedDB();
  seedActiveWorkspace();

  context.saveBackup();

  assert.deepStrictEqual(context.App.history, ['{"a":1}', '{"a":2}'],
    'pruning is for the stored copy only — undo must still work in-session');
  assert.deepStrictEqual(context.App.future, ['{"a":3}']);
});

test('the camera survives a save/restore round trip', () => {
  clearIndexedDB();
  seedActiveWorkspace();
  context.saveBackup();

  const payload = readLocalBackup();
  assert.deepStrictEqual(payload.tabs[0].data.cam, { x: 111, y: 222, z: 3 },
    'cam is editor state the user expects to find where they left it');
});

// ── IndexedDB is actually read back ───────────────────────────────

test('loadBackup restores from IndexedDB when a snapshot exists', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();

  await context.saveWorkspace({ silent: true });
  assert.ok(store.tabs().get('w0'), 'the workspace should have reached its own record');
  assert.deepStrictEqual(store.meta().order, ['w0'], 'the index names it');

  // A stale localStorage copy must lose to the IndexedDB snapshot.
  context.localStorage.setItem('automata-backup', JSON.stringify({
    tabs: [{ id: 'stale', name: 'Stale', dirty: false, data: { machine: 'DFA', cam: { x: 9, y: 9, z: 9 } } }],
    activeId: 'stale'
  }));

  const restored = await context.readLatestBackup();
  assert.strictEqual(restored.tabs[0].id, 'w0', 'IndexedDB must win over the localStorage fallback');
  assert.deepStrictEqual(restored.tabs[0].data.cam, { x: 111, y: 222, z: 3 });
});

test('readLatestBackup falls back to localStorage when IndexedDB is empty', async () => {
  installFakeIndexedDB(); // present, but nothing written to it
  seedActiveWorkspace();
  context.saveBackup();

  const restored = await context.readLatestBackup();
  assert.ok(restored, 'the localStorage backup should be used');
  assert.strictEqual(restored.tabs[0].id, 'w0');
});

test('readLatestBackup survives IndexedDB being unavailable', async () => {
  clearIndexedDB();
  seedActiveWorkspace();
  context.saveBackup();

  const restored = await context.readLatestBackup();
  assert.strictEqual(restored.tabs[0].id, 'w0', 'private mode must still restore from localStorage');
});

// ── Failures are reported, never swallowed ────────────────────────

test('a failed mirror-write fails the save even when IndexedDB accepted it', async () => {
  installFakeIndexedDB();
  seedActiveWorkspace();

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  let ok;
  try {
    ok = await context.saveWorkspace({ silent: true });
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(ok, false, 'a save that could not be fully written must report failure');
  assert.strictEqual(context.Workspaces[0].dirty, true,
    'the dirty mark must survive a failed save — clearing it would claim work was stored');
});

test('a failed save leaves the indicator in the error state', async () => {
  installFakeIndexedDB();
  seedActiveWorkspace();

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    await context.saveWorkspace({ silent: true });
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(context.saveState, 'error');
});

test('a successful save clears the dirty mark', async () => {
  installFakeIndexedDB();
  seedActiveWorkspace();

  const ok = await context.saveWorkspace({ silent: true });

  assert.strictEqual(ok, true);
  assert.strictEqual(context.Workspaces[0].dirty, false);
  assert.strictEqual(context.saveState, 'saved');
});

test('a tab operation that cannot be persisted still reaches the save indicator', async () => {
  // No IndexedDB, so the record write falls back to localStorage — which is
  // the whole backend in that case, and here it refuses.
  clearIndexedDB();
  seedActiveWorkspace();
  context.setSaveState('saved');

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    context.saveBackupChecked();
    await context.persistTabState();
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(context.saveState, 'error',
    'tab operations that fail to persist must not leave the UI reading "Saved"');
});

test('a burst of tab operations collapses into one write', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();

  // A bulk close calls this once per tab. Eight overlapping transactions all
  // describing the same final state is the thing being prevented — so the
  // count that matters is index writes, not database opens, which the legacy
  // adoption also makes.
  for (let i = 0; i < 8; i++) context.saveBackupChecked();
  await context.persistTabState();

  const indexWrites = store.puts.filter(w => w.store === context.WORKSPACE_META_STORE).length;
  assert.ok(indexWrites <= 2, `eight tab operations should coalesce, saw ${indexWrites} index writes`);
  assert.deepStrictEqual(store.meta().order, ['w0']);
});

// ── Autosave ──────────────────────────────────────────────────────

test('autosave persists a tab marked by nothing but a camera move', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();
  await context.saveWorkspace({ silent: true });
  assert.strictEqual(context.Workspaces[0].dirty, false);

  // Pan the camera and mark it the way the canvas handlers now do.
  context.App.cam = { x: 500, y: 600, z: 2 };
  context.markViewDirty();

  await context.runAutosave();

  assert.strictEqual(context.Workspaces[0].viewDirty, false,
    'the quiet mark is cleared by the write that answered it');
  assert.deepStrictEqual(store.tabs().get('w0').data.cam, { x: 500, y: 600, z: 2 },
    'the camera still has to survive a reload — that is the whole reason autosave reads the quiet mark');
});

// The point of the split. Every one of these consumers reads `dirty`, and a
// camera move must reach none of them: being told you have unsaved work
// because you scrolled is a warning about work you never did.
test('a camera move never raises an unsaved-changes alarm', () => {
  seedActiveWorkspace();
  context.Workspaces[0].dirty = false;

  context.App.cam = { x: 500, y: 600, z: 2 };
  context.markViewDirty();

  assert.strictEqual(context.Workspaces[0].dirty, false,
    'the tab dot, the save indicator, beforeunload and the close-tab dialog all read this');
  assert.strictEqual(context.Workspaces[0].viewDirty, true, 'but the write is still owed');
});

// An edit is still an edit — the quiet flag must not have swallowed the loud one.
test('a real edit still marks the tab dirty', () => {
  seedActiveWorkspace();
  context.Workspaces[0].dirty = false;

  context.markDirty();

  assert.strictEqual(context.Workspaces[0].dirty, true);
});

test('a stored record carries neither mark', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();
  context.markDirty();
  context.markViewDirty();

  await context.runAutosave();

  const rec = store.tabs().get('w0');
  assert.strictEqual(rec.dirty, false);
  assert.strictEqual(rec.viewDirty, false,
    'a record is written clean, or the next boot restores a tab that believes it owes a save');
});

test('autosave is a no-op when nothing is dirty', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();
  await context.saveWorkspace({ silent: true });
  store.tabs().delete('w0');

  await context.runAutosave();

  assert.strictEqual(store.tabs().get('w0'), undefined, 'a clean workspace must not trigger a write');
});

// ── The file rounds its geometry; the machine does not ────────────

function dragged() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [
    { id: 's0', name: 'q0', x: 100.35847091674805, y: 240.7412839471625 },
    { id: 's1', name: 'q1', x: -12.5, y: 0.49, priority: 2, output: 'x' }
  ];
  App.transitions = [
    { id: 't0', from: 's0', to: 's1', symbol: 'a', curve: 24.918273645 },
    { id: 't1', from: 's1', to: 's1', symbol: 'a', loopAngle: 1.5707963267948966 }
  ];
  App.notes = [{ id: 'n0', text: 'hi', x: 3.7, y: 9.2, w: 180.4, h: 90.6, anchorStates: [], anchorTransitions: [] }];
  App.dividers = [{ id: 'd0', kind: 'line', x1: 1.4, y1: 2.6, x2: 3.5, y2: 4.5 }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.cam = { x: -412.3849172, y: 88.10394857, z: 0.83471926354 };
}

test('a saved coordinate is a whole number', () => {
  dragged();
  const data = context.getWorkspaceData();

  // Math.round takes a .5 toward +∞; either pixel is the same pixel.
  assert.deepStrictEqual(data.states.map(s => [s.x, s.y]), [[100, 241], [-12, 0]]);
  assert.deepStrictEqual([data.notes[0].x, data.notes[0].y, data.notes[0].w, data.notes[0].h], [4, 9, 180, 91]);
  assert.deepStrictEqual([data.dividers[0].x1, data.dividers[0].y1, data.dividers[0].x2, data.dividers[0].y2], [1, 3, 4, 5]);
  assert.deepStrictEqual([data.cam.x, data.cam.y], [-412, 88]);
  assert.strictEqual(data.transitions[0].curve, 25);
});

test('the two that need decimals keep them', () => {
  dragged();
  const data = context.getWorkspaceData();
  // A whole number of radians is a quarter turn, and a whole-numbered zoom is
  // one zoom level — rounding either is not a sub-pixel change.
  assert.strictEqual(data.transitions[1].loopAngle, 1.571);
  assert.strictEqual(data.cam.z, 0.8347);
});

test('rounding is a property of the file, never of the machine', () => {
  dragged();
  const { App } = context;
  const before = JSON.stringify([App.states, App.transitions, App.notes, App.dividers, App.cam]);
  context.getWorkspaceData();
  assert.strictEqual(JSON.stringify([App.states, App.transitions, App.notes, App.dividers, App.cam]), before,
    'the machine on screen keeps full precision — the layout passes iterate on their own output');
});

test('a field the rounder does not know about rides along untouched', () => {
  dragged();
  const data = context.getWorkspaceData();
  assert.strictEqual(data.states[1].priority, 2);
  assert.strictEqual(data.states[1].output, 'x');
  assert.strictEqual(data.transitions[0].symbol, 'a');
});

test('a rounded machine is about half the link a dragged one was', async () => {
  harness.resetApp();
  const { App } = context;
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < 300; i++) {
    App.states.push({
      id: 's' + i, name: 'q' + i,
      x: 100 + (i % 40) * 90 + Math.sin(i) * 0.35847091674805,
      y: 100 + Math.floor(i / 40) * 90 + Math.cos(i) * 0.7412839471625
    });
  }
  App.startId = 's0';
  App.accepts.add('s299');
  for (let i = 0; i < 600; i++) {
    App.transitions.push({ id: 't' + i, from: 's' + (i % 300), to: 's' + ((i * 7 + 3) % 300), symbol: i % 2 ? 'a' : 'b' });
  }

  const rounded = context.getWorkspaceData();
  // The same blob with the machine's own floats put back — what the file used
  // to carry.
  const raw = { ...rounded, states: App.states, transitions: App.transitions, cam: App.cam };

  const packed = async o => (await context.compressToB64Url(JSON.stringify(o))).length;
  const [was, is] = [await packed(raw), await packed(rounded)];
  assert.ok(is * 1.5 < was, `${is} vs ${was}`);
});

// ══════════════════════════════════════════════════════════════════
//  THE RECORD LAYOUT
// ══════════════════════════════════════════════════════════════════
//  The reason this stage exists: a save used to cost every open workspace,
//  twice. These pin that it now costs the one that changed.

// Three tabs, each with a machine of its own, all already written out.
async function seedThreeTabs(store) {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  for (const id of ['w0', 'w1', 'w2']) {
    context.App.states = [{ id: 's' + id, name: id, x: 10, y: 10 }];
    context.Workspaces.push({ id, name: id, dirty: false, data: context.exportWorkspaceState() });
  }
  context.setActiveWorkspaceId('w0');
  await context.writeWorkspaceRecords(['w0', 'w1', 'w2']);
  store.puts.length = 0;
  return store;
}

test('autosaving one dirty tab writes one record, not every workspace', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);

  context.Workspaces[1].dirty = true;
  await context.runAutosave();

  assert.deepStrictEqual(store.tabPuts(), ['w1'],
    'a change of size one must not re-serialise the other tabs — that was the whole cost');
  assert.strictEqual(context.Workspaces[1].dirty, false);
});

test('the other tabs are left byte-identical by a neighbour saving', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  const before = JSON.stringify(store.tabs().get('w2'));

  context.Workspaces[1].dirty = true;
  await context.runAutosave();

  assert.strictEqual(JSON.stringify(store.tabs().get('w2')), before);
});

test('autosave does not touch localStorage', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  context.localStorage.removeItem('automata-backup');

  context.Workspaces[1].dirty = true;
  await context.runAutosave();

  assert.strictEqual(context.localStorage.getItem('automata-backup'), null,
    'the synchronous full-payload mirror is off the hot path; it belongs to Save and unload');
});

test('an explicit Save does refresh the localStorage copy', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  context.localStorage.removeItem('automata-backup');

  await context.saveWorkspace({ silent: true });

  assert.ok(context.localStorage.getItem('automata-backup'),
    'Save is one of the two checkpoints where the fallback is brought up to date');
});

test('a record the index no longer names is swept', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  assert.ok(store.tabs().get('w2'), 'precondition: three records');

  // Close a tab the way the app does, then let any write go through.
  context.setWorkspaces(context.Workspaces.filter(w => w.id !== 'w2'));
  await context.writeWorkspaceRecords(['w0']);

  assert.strictEqual(store.tabs().get('w2'), undefined,
    'the index is the authority; a record it does not name is garbage');
  assert.deepStrictEqual(store.meta().order, ['w0', 'w1']);
});

test('the record layout round-trips several tabs in order', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  context.setActiveWorkspaceId('w1');
  await context.writeWorkspaceRecords(['w1']);

  const restored = await context.readWorkspaceSnapshot();
  assert.deepStrictEqual(restored.tabs.map(t => t.id), ['w0', 'w1', 'w2']);
  assert.strictEqual(restored.activeId, 'w1');
  assert.strictEqual(restored.source, 'records');
});

// ── Migrating an existing install ─────────────────────────────────

test('a v2 database is read back through the legacy record', async () => {
  // Faithfully v2: only the legacy store exists until the version bump's
  // onupgradeneeded creates the other two, empty.
  const store = installFakeIndexedDB({ existingStores: ['snapshots', 'blocks'] });
  seedActiveWorkspace();
  // What every existing install has: one record holding every workspace.
  store.legacy().set('current', {
    tabs: [{ id: 'old', name: 'Old', dirty: false, data: { machine: 'DFA', cam: { x: 7, y: 8, z: 1 } } }],
    activeId: 'old',
    config: {}
  });

  const restored = await context.readWorkspaceSnapshot();
  assert.strictEqual(restored.tabs[0].id, 'old', 'a v2 install must not boot to an empty canvas');
  assert.strictEqual(restored.source, 'legacy', 'and it must say where it came from');
});

test('the v3 layout wins over a v2 record once one exists', async () => {
  const store = installFakeIndexedDB();
  await seedThreeTabs(store);
  store.legacy().set('current', {
    tabs: [{ id: 'old', name: 'Old', dirty: false, data: { machine: 'DFA' } }],
    activeId: 'old'
  });

  const restored = await context.readWorkspaceSnapshot();
  assert.strictEqual(restored.source, 'records');
  assert.deepStrictEqual(restored.tabs.map(t => t.id), ['w0', 'w1', 'w2']);
});

// ── The two ways a record write can go wrong quietly ──────────────

test('a refused write rejects rather than hanging', async () => {
  installFakeIndexedDB({ failWrites: true });
  seedActiveWorkspace();

  // The hazard this guards: IndexedDB commits a transaction as soon as
  // control returns to the event loop with nothing outstanding, so a
  // completion handler attached after an await can never fire — a save that
  // never settles rather than one that fails. Every caller awaits this.
  await assert.rejects(
    () => Promise.race([
      context.writeWorkspaceRecords(['w0']),
      new Promise((_, rej) => setTimeout(() => rej(new Error('write never settled')), 500))
    ]),
    err => err.message !== 'write never settled'
  );
});

test('a failed record write leaves the tab dirty and the indicator in error', async () => {
  installFakeIndexedDB({ failWrites: true });
  seedActiveWorkspace();
  context.setSaveState('saved');

  const ok = await context.saveWorkspace({ silent: true });

  assert.strictEqual(ok, false);
  assert.strictEqual(context.Workspaces[0].dirty, true,
    'clearing the mark would claim work was stored');
  assert.strictEqual(context.saveState, 'error');
});

test('a write with no active workspace does not clobber the backup', async () => {
  clearIndexedDB();
  seedActiveWorkspace();
  context.saveBackup();
  const good = context.localStorage.getItem('automata-backup');
  assert.ok(good);

  // Nothing to describe. The payload builder answers null here, and writing
  // that would put the string "null" where the reader's tabs were.
  context.setActiveWorkspaceId(null);
  await context.writeWorkspaceRecords([]);

  assert.strictEqual(context.localStorage.getItem('automata-backup'), good,
    'an empty save must leave a good backup alone');
});

// ══════════════════════════════════════════════════════════════════
//  THE DATABASE WAS RENAMED
// ══════════════════════════════════════════════════════════════════
//  An IndexedDB database is identified by its name, so renaming it points the
//  app at a fresh empty one and every existing reader's work becomes
//  unreachable in a single release. electron/main.cjs carries the same scar for
//  userData. These pin that the old database is adopted instead.

// A machine that has been using the app under the old name, with tabs in the
// record layout and a block library beside them.
function seedLegacyDatabase({ blocks = true } = {}) {
  const all = new Map();
  const legacy = new Map();
  legacy.set('workspaces', new Map([
    ['old1', { id: 'old1', name: 'Pumping Lemma', dirty: false, data: { machine: 'DFA', cam: { x: 5, y: 6, z: 1 } } }]
  ]));
  legacy.set('meta', new Map([
    ['current', { schema: 1, activeId: 'old1', order: ['old1'], config: {} }]
  ]));
  if (blocks) {
    legacy.set('blocks', new Map([['adder', { key: 'adder', name: 'Adder', states: [] }]]));
  }
  all.set('automata-playground', legacy);
  return { all, store: installFakeIndexedDB({ databases: all }) };
}

test('the renamed database adopts the one it replaced', async () => {
  const { store } = seedLegacyDatabase();
  seedActiveWorkspace();

  const restored = await context.readWorkspaceSnapshot();

  assert.ok(restored, 'a rename that lost the tabs would boot to an empty canvas');
  assert.strictEqual(restored.tabs[0].id, 'old1');
  assert.strictEqual(restored.tabs[0].name, 'Pumping Lemma');
});

test('the block library is adopted too, not just the workspaces', async () => {
  const { store } = seedLegacyDatabase();
  seedActiveWorkspace();

  await context.readWorkspaceSnapshot();

  const adopted = store.raw.get('blocks');
  assert.ok(adopted && adopted.get('adder'),
    'a rename that carried the workspaces and dropped the blocks is half a migration, and much harder to notice');
});

test('adoption runs once and copies nothing into a database in use', async () => {
  const { all, store } = seedLegacyDatabase();
  // This reader has already used the renamed database.
  all.get(context.WORKSPACE_DB_NAME).set('workspaces', new Map([
    ['mine', { id: 'mine', name: 'Mine', dirty: false, data: { machine: 'NFA' } }]
  ]));
  all.get(context.WORKSPACE_DB_NAME).set('meta', new Map([
    ['current', { schema: 1, activeId: 'mine', order: ['mine'], config: {} }]
  ]));
  seedActiveWorkspace();

  const restored = await context.readWorkspaceSnapshot();

  assert.strictEqual(restored.tabs[0].id, 'mine',
    'copying over live work would be worse than not migrating at all');
});

test('a fresh install adopts nothing and leaves no stray database', async () => {
  const store = installFakeIndexedDB();   // nothing under the old name
  seedActiveWorkspace();

  await context.writeWorkspaceRecords(['w0']);

  assert.strictEqual(store.all.has('automata-playground'), false,
    'a database opened only to look inside is deleted again rather than left as litter');
});

test('the adoption happens once however many callers open the database', async () => {
  const { store } = seedLegacyDatabase();
  seedActiveWorkspace();

  // blocks-ui.js opens this database too and can easily get there first; two
  // concurrent adoptions would race on the same stores.
  await Promise.all([
    context.readWorkspaceSnapshot(),
    context.readWorkspaceSnapshot(),
    context.openWorkspaceDb().then(db => db?.close())
  ]);

  const copied = store.puts.filter(w => w.db === context.WORKSPACE_DB_NAME && w.key === 'old1');
  assert.strictEqual(copied.length, 1, `adopted ${copied.length} times`);
});
