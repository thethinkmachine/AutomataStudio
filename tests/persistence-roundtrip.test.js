import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const {context} = harness;

// Minimal in-memory IndexedDB standing in for the real thing: enough of the
// request/transaction shape for persistWorkspaceAsync and readWorkspaceSnapshot
// to drive it. `store` is exposed so assertions can read what was written
// without going through the app code that is under test.
function installFakeIndexedDB({ failWrites = false } = {}) {
  const store = new Map();
  const fire = (obj, prop, arg) => {
    // Handlers are assigned after the call returns, so defer a turn.
    setTimeout(() => { if (typeof obj[prop] === 'function') obj[prop](arg); }, 0);
  };
  context.indexedDB = {
    open() {
      const req = { result: null, error: null };
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          close: () => {},
          transaction(_name, mode) {
            const tx = { error: null };
            const objectStore = () => ({
              put(value, key) {
                const putReq = {};
                if (failWrites) {
                  tx.error = new Error('quota');
                  fire(tx, 'onerror');
                } else {
                  store.set(key, JSON.parse(JSON.stringify(value)));
                  fire(tx, 'oncomplete');
                }
                return putReq;
              },
              get(key) {
                const getReq = { result: store.get(key) || null };
                fire(getReq, 'onsuccess');
                return getReq;
              }
            });
            tx.objectStore = objectStore;
            if (mode === 'readwrite') { /* completion fires from put() */ }
            return tx;
          }
        };
        if (typeof req.onsuccess === 'function') req.onsuccess();
      }, 0);
      return req;
    }
  };
  return store;
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
  assert.ok(store.get('current'), 'the snapshot should have reached IndexedDB');

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

test('saveBackupChecked surfaces storage failure through the save indicator', () => {
  clearIndexedDB();
  seedActiveWorkspace();
  context.setSaveState('saved');

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  let ok;
  try {
    ok = context.saveBackupChecked();
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(ok, false);
  assert.strictEqual(context.saveState, 'error',
    'tab operations that fail to persist must not leave the UI reading "Saved"');
});

// ── Autosave ──────────────────────────────────────────────────────

test('autosave persists a tab dirtied by nothing but a camera move', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();
  await context.saveWorkspace({ silent: true });
  assert.strictEqual(context.Workspaces[0].dirty, false);

  // Pan the camera and mark it the way the canvas handlers now do.
  context.App.cam = { x: 500, y: 600, z: 2 };
  context.markDirty();
  assert.strictEqual(context.Workspaces[0].dirty, true,
    'a camera move is a real change to persisted state');

  await context.runAutosave();

  assert.strictEqual(context.Workspaces[0].dirty, false, 'autosave should have saved it');
  assert.deepStrictEqual(store.get('current').tabs[0].data.cam, { x: 500, y: 600, z: 2 });
});

test('autosave is a no-op when nothing is dirty', async () => {
  const store = installFakeIndexedDB();
  seedActiveWorkspace();
  await context.saveWorkspace({ silent: true });
  store.delete('current');

  await context.runAutosave();

  assert.strictEqual(store.get('current'), undefined, 'a clean workspace must not trigger a write');
});
