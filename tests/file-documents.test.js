import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;

// Two hosts, one set of verbs. On the desktop a workspace has a file — a path
// it came from and can be written back to — and in the browser it does not.
// What is pinned here is that the difference lives in js/file-host.js and that
// neither host can be made to overwrite the wrong file.

// A fake `window.electronAPI` with just the file surface. `calls` records what
// the app asked the host to do, which is most of what these assertions are
// about — the renderer's job is to ask for the right thing.
function installFakeHost({ saveResult, writeResult, openResult } = {}) {
  const calls = [];
  const api = {
    isElectron: true,
    saveFileAs: async payload => {
      calls.push({ op: 'saveAs', ...payload });
      return saveResult ?? { ok: true, path: '/tmp/picked.automaton' };
    },
    writeFile: async payload => {
      calls.push({ op: 'write', ...payload });
      return writeResult ?? { ok: true, path: payload.path };
    },
    openFile: async () => {
      calls.push({ op: 'open' });
      return openResult ?? { ok: false, canceled: true };
    },
    readFile: async path => { calls.push({ op: 'read', path }); return { ok: true, path, text: '' }; },
    noteDocument: payload => { calls.push({ op: 'note', ...payload }); },
    onOpenFile: () => () => {}
  };
  context.window.electronAPI = api;
  return calls;
}

function removeFakeHost() {
  delete context.window.electronAPI;
}

function seedWorkspace(name = 'Parity Check') {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.App.machine = 'DFA';
  context.App.sigma = new Set(['a', 'b']);
  context.App.states = [{ id: 's0', name: 'q0', x: 10, y: 10 }];
  context.App.transitions = [];
  context.App.startId = 's0';
  context.App.accepts = new Set();
  context.Workspaces.push({ id: 'w0', name, dirty: true, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

// ── Names ─────────────────────────────────────────────────────────

test('a download is named after the workspace, not "automaton"', () => {
  // It was `automaton.json` every single time, so every save after the first
  // landed as `automaton (1)`, `automaton (2)` — a folder of files none of
  // which say what is in them.
  assert.strictEqual(context.suggestedFileName('Parity Check'), 'Parity Check.automaton');
  assert.strictEqual(context.suggestedFileName(''), 'machine.automaton');
});

test('a name no filesystem would take is cleaned rather than refused', () => {
  assert.strictEqual(context.sanitizeFileName('a/b:c*d?'), 'a b c d');
  assert.strictEqual(context.sanitizeFileName('  .hidden.  '), 'hidden');
  assert.strictEqual(context.sanitizeFileName('   '), 'machine');
  assert.ok(context.sanitizeFileName('x'.repeat(200)).length <= 80);
});

test('a path is split on either separator', () => {
  // A Windows path reaches the renderer as a string; nothing here is running
  // on node:path.
  assert.strictEqual(context.fileStem('C:\\Users\\x\\parity.automaton'), 'parity');
  assert.strictEqual(context.fileStem('/home/x/parity.automaton'), 'parity');
  assert.strictEqual(context.fileStem('/home/x/no-extension'), 'no-extension');
  assert.strictEqual(context.fileExt('/a/b.PNG'), 'png');
});

// ── Which host ────────────────────────────────────────────────────

test('there is no file host in the browser', () => {
  removeFakeHost();
  assert.strictEqual(context.hasFileHost(), false);
});

test('the host is read at call time, not latched at import', () => {
  removeFakeHost();
  assert.strictEqual(context.hasFileHost(), false);
  installFakeHost();
  assert.strictEqual(context.hasFileHost(), true);
  removeFakeHost();
  assert.strictEqual(context.hasFileHost(), false);
});

test('every file operation has an answer for "there is no host"', async () => {
  removeFakeHost();
  for (const res of [
    await context.saveFileAs('{}', 'x.automaton'),
    await context.writeFile('/x', '{}'),
    await context.openFileDialog(),
    await context.readFile('/x')
  ]) {
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.noHost, true, 'the browser path is an answer, never an exception');
  }
  assert.strictEqual(typeof context.onExternalOpen(() => {}), 'function');
});

// ── Save means save ───────────────────────────────────────────────

test('the first save asks where, and later ones do not', async () => {
  const calls = installFakeHost();
  seedWorkspace();

  await context.saveDocument();
  assert.strictEqual(calls.filter(c => c.op === 'saveAs').length, 1,
    'with no path yet, Save has to ask');
  assert.strictEqual(context.activeFilePath(), '/tmp/picked.automaton');

  calls.length = 0;
  await context.saveDocument();
  assert.deepStrictEqual(calls.filter(c => c.op !== 'note').map(c => c.op), ['write'],
    'the path is what makes Ctrl+S mean save rather than "ask me again"');
  assert.strictEqual(calls.find(c => c.op === 'write').path, '/tmp/picked.automaton');
  removeFakeHost();
});

test('what is written is the versioned document', async () => {
  const calls = installFakeHost();
  seedWorkspace();
  await context.saveDocument();

  const written = JSON.parse(calls.find(c => c.op === 'saveAs').text);
  assert.strictEqual(written.format, context.WORKSPACE_FORMAT);
  assert.strictEqual(written.schema, context.SCHEMA_VERSION);
  assert.strictEqual(written.machine, 'DFA');
  removeFakeHost();
});

test('saving as renames the tab to the file', async () => {
  installFakeHost({ saveResult: { ok: true, path: '/tmp/even-length.automaton' } });
  seedWorkspace('Workspace 1');

  await context.saveDocumentAs();

  assert.strictEqual(context.Workspaces[0].name, 'even-length',
    'the tab is the document, so it takes the document\'s name');
  removeFakeHost();
});

test('a cancelled Save As changes nothing and reports nothing', async () => {
  installFakeHost({ saveResult: { ok: false, canceled: true } });
  seedWorkspace();
  context.setSaveState('unsaved');

  const ok = await context.saveDocumentAs();

  assert.strictEqual(ok, false);
  assert.strictEqual(context.activeFilePath(), null, 'nothing was written, so nothing is bound');
  assert.strictEqual(context.saveState, 'unsaved',
    'Escape is the reader changing their mind — reporting it as a failure is a bug they will believe');
  removeFakeHost();
});

test('a refused write is reported and leaves the path alone', async () => {
  installFakeHost({ writeResult: { ok: false, error: 'EACCES' } });
  seedWorkspace();
  context.Workspaces[0].filePath = '/read-only/x.automaton';

  const ok = await context.saveDocument();

  assert.strictEqual(ok, false);
  assert.strictEqual(context.saveState, 'error');
  assert.strictEqual(context.activeFilePath(), '/read-only/x.automaton',
    'the file is still the file; only the write failed');
  removeFakeHost();
});

test('in the browser, Save is the download it has always been', async () => {
  removeFakeHost();
  seedWorkspace();
  let downloaded = null;
  const realCreate = context.document.createElement;
  context.document.createElement = tag => {
    const el = realCreate.call(context.document, tag);
    if (tag === 'a') el.click = () => { downloaded = el.download; };
    return el;
  };
  try {
    await context.saveDocument();
  } finally {
    context.document.createElement = realCreate;
  }
  assert.strictEqual(downloaded, 'Parity Check.automaton');
});

// ── Opening ───────────────────────────────────────────────────────

function docFor(path) {
  seedWorkspace();
  const text = JSON.stringify(context.getWorkspaceData());
  harness.resetApp();
  context.Workspaces.length = 0;
  context.Workspaces.push({ id: 'w0', name: 'Untitled', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
  return { ok: true, path, text };
}

test('opening a file binds it and renames the tab', () => {
  installFakeHost();
  const doc = docFor('/home/x/palindrome.automaton');

  assert.strictEqual(context.applyOpenedDocument(doc), true);
  assert.strictEqual(context.activeFilePath(), '/home/x/palindrome.automaton');
  assert.strictEqual(context.Workspaces[0].name, 'palindrome');
  removeFakeHost();
});

test('a file that will not parse does not become the file Ctrl+S writes', () => {
  installFakeHost();
  docFor('/home/x/good.automaton');
  context.Workspaces[0].filePath = '/home/x/good.automaton';

  const ok = context.applyOpenedDocument({ ok: true, path: '/home/x/broken.automaton', text: '{ not json' });

  assert.strictEqual(ok, false);
  assert.strictEqual(context.activeFilePath(), '/home/x/good.automaton',
    'binding a path that failed to load would point Save at it and overwrite it with something else');
  removeFakeHost();
});

test('a document from a newer build is refused on open, not half-loaded', () => {
  installFakeHost();
  const doc = docFor('/home/x/future.automaton');
  const parsed = JSON.parse(doc.text);
  parsed.schema = context.SCHEMA_VERSION + 1;

  const ok = context.applyOpenedDocument({ ...doc, text: JSON.stringify(parsed) });

  assert.strictEqual(ok, false);
  assert.strictEqual(context.activeFilePath(), null);
  removeFakeHost();
});

test('the extension is not the parser — a .automaton is read as JSON', () => {
  seedWorkspace();
  const text = JSON.stringify(context.getWorkspaceData());
  harness.resetApp();
  assert.strictEqual(context.applyDocument(text, 'x.automaton'), true);
  assert.strictEqual(context.App.machine, 'DFA');
});

test('a .json still opens, and always will', () => {
  seedWorkspace();
  const text = JSON.stringify(context.getWorkspaceData());
  harness.resetApp();
  assert.strictEqual(context.applyDocument(text, 'legacy-save.json'), true,
    'a custom extension is a name; every file anyone has already saved keeps opening');
});

test('a PNG with no embedded workspace is refused rather than throwing', () => {
  const bytes = new TextEncoder().encode('not really a png').buffer;
  assert.strictEqual(context.applyDocument(bytes, 'shot.png'), false);
});

test('the open dialog is only reached when there is a host', () => {
  removeFakeHost();
  let clicked = 0;
  const input = context.$('file-input');
  if (input) input.click = () => { clicked++; };
  context.loadJSON();
  assert.strictEqual(clicked, 1, 'the browser opens through the hidden file input');

  const calls = installFakeHost();
  context.loadJSON();
  assert.ok(calls.some(c => c.op === 'open'), 'the desktop opens through the native dialog');
  removeFakeHost();
});

// ── The path is per workspace, and it is remembered ───────────────

test('the file is a property of the tab, not of the app', async () => {
  installFakeHost({ saveResult: { ok: true, path: '/tmp/one.automaton' } });
  seedWorkspace();
  context.Workspaces.push({ id: 'w1', name: 'Other', dirty: false, data: context.exportWorkspaceState() });

  await context.saveDocumentAs();

  assert.strictEqual(context.Workspaces[0].filePath, '/tmp/one.automaton');
  assert.strictEqual(context.Workspaces[1].filePath, undefined,
    'tabs are independent documents');
  removeFakeHost();
});

test('the path rides in the tab record, so it survives a restart', () => {
  installFakeHost();
  seedWorkspace();
  context.Workspaces[0].filePath = '/tmp/kept.automaton';

  const stored = context.stripTabForStorage(context.Workspaces[0]);

  assert.strictEqual(stored.filePath, '/tmp/kept.automaton',
    'closing the app must leave Ctrl+S still meaning the file you were working on');
  removeFakeHost();
});

test('the host is told what the window is editing', async () => {
  const calls = installFakeHost();
  seedWorkspace();
  await context.saveDocumentAs();

  const noted = calls.filter(c => c.op === 'note').pop();
  assert.ok(noted, 'the title, the macOS proxy icon and Recent Files all follow this');
  assert.strictEqual(noted.path, '/tmp/picked.automaton');
  removeFakeHost();
});

// ── Where an opened document lands ────────────────────────────────
//  Opening a file must never destroy the machine already on the canvas, and on
//  a cold launch it must not be destroyed *by* the restore either — which is
//  the one the reader hits, because it is the path a double-click takes.

// A workspace with a machine actually drawn on it. `seedWorkspace` leaves the
// tab occupied but `harness.resetApp()` in docFor() empties it again, which is
// the untouched case; this is the other one.
//
// Split in two because resetApp() also clears the boot gate — so the cold-launch
// cases below have to stand a session up *without* resetting, exactly as
// loadBackup() does when a queued document is already waiting on it.
function restoreSession(name = 'Occupied') {
  context.App.machine = 'DFA';
  context.App.states = [{ id: 's9', name: 'busy', x: 0, y: 0 }];
  context.App.startId = 's9';
  context.Workspaces.length = 0;
  context.Workspaces.push({ id: 'w0', name, dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

function occupiedWorkspace(name = 'Occupied') {
  harness.resetApp();
  context.setActiveWorkspaceId(null);
  restoreSession(name);
}

// The bytes of a saved document, without disturbing what is on the canvas now.
function documentTextFor(stateName) {
  const keep = {
    states: context.App.states, startId: context.App.startId,
    accepts: context.App.accepts, transitions: context.App.transitions
  };
  context.App.states = [{ id: 'sA', name: stateName, x: 5, y: 5 }];
  context.App.startId = 'sA';
  context.App.accepts = new Set();
  context.App.transitions = [];
  const text = JSON.stringify(context.getWorkspaceData());
  Object.assign(context.App, keep);
  return text;
}

test('an occupied canvas gets a tab for the file rather than being overwritten', () => {
  installFakeHost();
  occupiedWorkspace();
  const text = documentTextFor('opened');

  const ok = context.applyOpenedDocument({ ok: true, path: '/home/x/opened.automaton', text });

  assert.strictEqual(ok, true);
  assert.strictEqual(context.Workspaces.length, 2, 'the machine on screen is not the file being opened');
  assert.strictEqual(context.Workspaces[0].data.states.length, 1, 'the tab it was on keeps its machine');
  assert.strictEqual(context.Workspaces[1].name, 'opened');
  assert.strictEqual(context.activeFilePath(), '/home/x/opened.automaton');
  assert.strictEqual(context.App.states[0].name, 'opened');
  removeFakeHost();
});

test('an untouched tab is read into rather than left empty beside the file', () => {
  installFakeHost();
  const doc = docFor('/home/x/palindrome.automaton');

  context.applyOpenedDocument(doc);

  assert.strictEqual(context.Workspaces.length, 1, 'a blank canvas is where a file belongs');
  removeFakeHost();
});

test('a tab that already has a file of its own is never reused', () => {
  installFakeHost();
  const doc = docFor('/home/x/first.automaton');
  context.applyOpenedDocument(doc);
  assert.strictEqual(context.Workspaces.length, 1);

  // Blank again — but bound to a file, which is what Ctrl+S writes.
  context.App.states = [];
  const second = { ok: true, path: '/home/x/second.automaton', text: doc.text };
  context.applyOpenedDocument(second);

  assert.strictEqual(context.Workspaces.length, 2,
    'reusing it would silently retarget the reader Ctrl+S at a different file');
  assert.strictEqual(context.Workspaces[0].filePath, '/home/x/first.automaton');
  assert.strictEqual(context.activeFilePath(), '/home/x/second.automaton');
  removeFakeHost();
});

test('opening a file that is already open goes to its tab', () => {
  installFakeHost();
  const doc = docFor('/home/x/one.automaton');
  context.applyOpenedDocument(doc);
  const firstId = context.Workspaces[0].id;
  context.createTab('Elsewhere');
  assert.notStrictEqual(context.activeWorkspaceId, firstId);

  context.applyOpenedDocument(doc);

  assert.strictEqual(context.Workspaces.length, 2, 'a second copy of one file is two documents that disagree');
  assert.strictEqual(context.activeWorkspaceId, firstId);
  removeFakeHost();
});

test('a file that will not parse costs neither a tab nor the machine on screen', () => {
  installFakeHost();
  occupiedWorkspace();

  const ok = context.applyOpenedDocument({ ok: true, path: '/home/x/broken.automaton', text: '{ not json' });

  assert.strictEqual(ok, false);
  assert.strictEqual(context.Workspaces.length, 1, 'an empty tab to close is not a diagnostic');
  assert.strictEqual(context.App.states[0].name, 'busy');
  removeFakeHost();
});

// ── The boot gate ─────────────────────────────────────────────────

test('a file the OS hands over on a cold launch waits for the restore', () => {
  installFakeHost();
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  const text = documentTextFor('from-the-os');

  // The renderer subscribes while electron-bridge.js is being evaluated, which
  // is before init.js has run at all — so this is what a double-click delivers.
  const applied = context.openExternalDocument({ ok: true, path: '/home/x/from-the-os.automaton', text });
  assert.strictEqual(applied, false, 'held, not dropped');
  assert.strictEqual(context.Workspaces.length, 0, 'nothing has touched the canvas yet');

  // ... and now the restore lands, exactly as loadBackup() does.
  restoreSession('Last session');
  context.markBootRestored();

  assert.strictEqual(context.Workspaces.length, 2);
  assert.strictEqual(context.App.states[0].name, 'from-the-os',
    'the file the reader double-clicked is the one they end up looking at');
  assert.strictEqual(context.Workspaces[0].data.states[0].name, 'busy',
    'and the session that was restored is still there beside it');
  removeFakeHost();
});

test('once the restore has finished a handed-over file lands immediately', () => {
  installFakeHost();
  occupiedWorkspace();
  context.markBootRestored();
  const text = documentTextFor('warm');

  const applied = context.openExternalDocument({ ok: true, path: '/home/x/warm.automaton', text });

  assert.strictEqual(applied, true, 'a running app has nothing left to restore');
  assert.strictEqual(context.App.states[0].name, 'warm');
  removeFakeHost();
});

test('the gate releases what it held in arrival order', () => {
  installFakeHost();
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  const first = documentTextFor('first');
  const second = documentTextFor('second');

  context.openExternalDocument({ ok: true, path: '/home/x/first.automaton', text: first });
  context.openExternalDocument({ ok: true, path: '/home/x/second.automaton', text: second });
  restoreSession('Last session');
  context.markBootRestored();

  assert.deepStrictEqual(context.Workspaces.map(w => w.name), ['Last session', 'first', 'second']);
  removeFakeHost();
});

// ── One Save ──────────────────────────────────────────────────────
//  The button and the shortcut are one act. They were two: the header's Save
//  button persisted the workspace while Ctrl+S, which is what that button's
//  tooltip advertises, also produced a file — a download, on the website, on
//  every press.

// Records what, if anything, reached the Downloads folder.
function watchDownloads(run) {
  const realCreate = context.document.createElement;
  const seen = [];
  context.document.createElement = tag => {
    const el = realCreate.call(context.document, tag);
    if (tag === 'a') el.click = () => { seen.push(el.download); };
    return el;
  };
  try { return { seen, result: run() }; }
  finally { context.document.createElement = realCreate; }
}

test('on the website Save keeps the workspace and downloads nothing', async () => {
  removeFakeHost();
  seedWorkspace();
  const { seen, result } = watchDownloads(() => context.saveNow());
  await result;

  assert.deepStrictEqual(seen, [],
    'a fresh copy in Downloads on every press is not what the Save button does');
  assert.strictEqual(context.Workspaces[0].dirty, false, 'the workspace is what was saved');
});

test('on the website Save As is still the download', async () => {
  removeFakeHost();
  seedWorkspace();
  const { seen, result } = watchDownloads(() => context.saveDocumentAs());
  await result;

  assert.deepStrictEqual(seen, ['Parity Check.automaton']);
});

test('on the desktop Save writes the file and the workspace record', async () => {
  const calls = installFakeHost();
  seedWorkspace();
  context.Workspaces[0].filePath = '/tmp/bound.automaton';

  await context.saveNow();

  const write = calls.find(c => c.op === 'write');
  assert.ok(write, 'Save means save, not "ask me where to put another copy"');
  assert.strictEqual(write.path, '/tmp/bound.automaton');
  assert.strictEqual(context.Workspaces[0].dirty, false);
  removeFakeHost();
});

test('the labels say which host this is', () => {
  const saveBtn = context.$('save-now-btn');
  const saveAs = context.$('save-menu-save-as');
  assert.ok(saveBtn && saveAs, 'both are in the markup for syncDocumentLabels to write');

  removeFakeHost();
  context.syncDocumentLabels();
  assert.match(saveBtn.getAttribute('data-tip'), /browser/i,
    'a reader told "Save workspace" goes looking in Downloads and finds nothing');
  assert.match(saveAs.textContent, /download/i,
    'on the website the one control that writes a file has to say so');

  installFakeHost();
  context.syncDocumentLabels();
  assert.match(saveBtn.getAttribute('data-tip'), /file/i);
  assert.strictEqual(saveAs.textContent, 'Save Machine As…');
  removeFakeHost();
});

test('a machine saved in the browser opens again', () => {
  removeFakeHost();
  seedWorkspace();
  context.App.states = [{ id: 's0', name: 'q0', x: 10, y: 10 }, { id: 's1', name: 'q1', x: 90, y: 10 }];
  context.App.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }];
  context.App.accepts = new Set(['s1']);
  const { seen } = watchDownloads(() => context.saveJSON());
  assert.deepStrictEqual(seen, ['Parity Check.automaton']);

  // The same bytes, back through the hidden file input's parser.
  const text = JSON.stringify(context.getWorkspaceData());
  harness.resetApp();
  assert.strictEqual(context.applyDocument(text, seen[0]), true);
  assert.deepStrictEqual(context.App.states.map(s => s.name), ['q0', 'q1']);
  assert.strictEqual(context.App.transitions.length, 1);
});
