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
