// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.

const { app, BrowserWindow, Menu, protocol, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { CLAUDE_CODE_URL, runClaudeCode } = require('./claude-code.cjs');
const { createUpdateController } = require('./updates.cjs');

// `AutomataStudio --cli <command> …` runs the command line instead of the app:
// this executable re-run as Node (ELECTRON_RUN_AS_NODE) on the bundled CLI,
// with the terminal's stdio, exiting with its code. No window, no single-
// instance lock, no userData — so it is handled before any of that. On
// Windows a GUI executable's output does not reach the console, which is why
// the installer also ships resources/cli/automata.cmd, the launcher to put on
// PATH there; this flag is the same thing for macOS and Linux terminals.
{
  const at = process.argv.indexOf('--cli');
  if (at > 0) {
    const cli = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-cli', 'automata.mjs')
      : path.join(__dirname, '..', 'dist-cli', 'automata.mjs');
    const r = require('node:child_process').spawnSync(process.execPath, [cli, ...process.argv.slice(at + 1)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    process.exit(r.status ?? 3);
  }
}

// The product was renamed "Automata Playground" -> "AutomataStudio". Electron derives
// userData from productName, so on an existing install the rename would silently point
// the app at an empty new directory and strand every saved workspace and autosave --
// they live in IndexedDB, which sits under userData. Auto-update makes that automatic
// rather than opt-in, so keep using the old directory wherever it is already there.
// New installs get the AutomataStudio path. Runs at module scope because userData is
// resolved well before app.whenReady().
//
// The name to look for is the one Electron actually wrote, which is package.json's
// `name` -- "automata-playground" -- not the display name. A single candidate spelled
// "Automata Playground" was wrong on both counts (space, capitals), so this migration
// never once fired: every machine that updated through the rename left its workspaces
// behind in the old directory while the app started fresh in the new one. Both
// spellings are checked now, most-likely first, because a directory that is not there
// costs one stat and a directory that is there is somebody's saved work.
const LEGACY_USER_DATA_NAMES = ['automata-playground', 'Automata Playground'];
for (const name of LEGACY_USER_DATA_NAMES) {
  const dir = path.join(app.getPath('appData'), name);
  if (fsSync.existsSync(dir)) { app.setPath('userData', dir); break; }
}

// Set only by `npm run electron:dev` (see package.json), which starts the Vite dev
// server first and points this at it for live reload. Unset in both `electron:preview`
// (built dist/, unpackaged) and the packaged app — both load dist/ via the app:// protocol.
const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
const DIST_ROOT = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// The app's own script (persistence.js) does `fetch('js/examples/...')` to load
// bundled example machines. Chromium's fetch() is unreliable/CORS-blocked for
// file:// pages, so in production we serve dist/ over a privileged custom scheme
// that behaves like http for fetch/CORS purposes instead of loadFile()'ing it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow = null;

// The window is frameless (see createWindow), so the page draws its own
// minimize/maximize/close buttons in the header and calls these over IPC.
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ══════════════════════════════════════════════════════════════════
//  FILES
// ══════════════════════════════════════════════════════════════════
//  Until now this process exposed no filesystem at all, and the desktop build
//  saved through the same Blob + <a download> path as the website — which is
//  why it had no Save As dialog of its own, no Ctrl+S that meant "save", no
//  double-click-to-open and no Recent Files. `will-download` in createWindow
//  papered over the first of those; the rest need a path, which a download
//  never has.
//
//  Every handler answers `{ ok, ... }` rather than throwing, so the renderer
//  reads one shape and a cancel is distinguishable from a failure. A cancel is
//  the reader changing their mind and must never be reported as an error.

const WORKSPACE_EXT = 'automaton';

const OPEN_FILTERS = [
  { name: 'AutomataStudio Machine', extensions: [WORKSPACE_EXT] },
  { name: 'All supported', extensions: [WORKSPACE_EXT, 'json', 'png', 'jff', 'jflap', 'scxml', 'js', 'mjs', 'ts'] },
  { name: 'Workspace JSON', extensions: ['json'] },
  { name: 'JFLAP', extensions: ['jff', 'jflap'] },
  { name: 'Statechart (SCXML, XState)', extensions: ['scxml', 'js', 'mjs', 'ts', 'json'] },
  { name: 'PNG with embedded workspace', extensions: ['png'] },
  { name: 'All files', extensions: ['*'] },
];

const SAVE_FILTERS = [
  { name: 'AutomataStudio Machine', extensions: [WORKSPACE_EXT] },
  { name: 'Workspace JSON', extensions: ['json'] },
];

// A PNG carries the workspace in a trailing text chunk, so it has to reach the
// renderer as bytes rather than as UTF-8 — decoding it first would mangle
// everything before the marker. Base64 is the transport because the IPC
// boundary is structured-clone and a latin1 string round-trips badly.
async function readDocument(filePath) {
  const isPng = path.extname(filePath).toLowerCase() === '.png';
  if (isPng) {
    const buf = await fs.readFile(filePath);
    return { ok: true, path: filePath, base64: buf.toString('base64'), binary: true };
  }
  return { ok: true, path: filePath, text: await fs.readFile(filePath, 'utf8') };
}

ipcMain.handle('file:open-dialog', async () => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Machine',
    properties: ['openFile'],
    filters: OPEN_FILTERS,
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try {
    const doc = await readDocument(result.filePaths[0]);
    rememberDocument(doc.path);
    return doc;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:read', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'No path' };
  try {
    return await readDocument(filePath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:save-dialog', async (_event, payload) => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  const { text, defaultPath } = payload || {};
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Machine',
    defaultPath: defaultPath || `machine.${WORKSPACE_EXT}`,
    filters: SAVE_FILTERS,
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fs.writeFile(result.filePath, String(text ?? ''), 'utf8');
    rememberDocument(result.filePath);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:write', async (_event, payload) => {
  const { path: filePath, text } = payload || {};
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'No path' };
  try {
    await fs.writeFile(filePath, String(text ?? ''), 'utf8');
    rememberDocument(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// What the window is editing: the macOS proxy icon and edited dot, and the OS
// Recent Files list. Cosmetic, and the difference between an app that has
// documents and one that merely reads them.
ipcMain.on('file:note-document', (_event, payload) => {
  const { path: filePath, dirty } = payload || {};
  if (!mainWindow) return;
  if (process.platform === 'darwin') {
    mainWindow.setRepresentedFilename(filePath || '');
    mainWindow.setDocumentEdited(!!dirty);
  }
  if (filePath) rememberDocument(filePath);
});

function rememberDocument(filePath) {
  // Populates the macOS dock menu and the Windows jump list. Unsupported on
  // Linux, where it is a no-op rather than an error.
  try { app.addRecentDocument(filePath); } catch { /* not everywhere */ }
}

// ── A file the OS hands us ────────────────────────────────────────
//  Three ways in, and they arrive at different moments: macOS sends `open-file`
//  (possibly before the window exists), Windows and Linux put the path in argv,
//  and a second launch while this one is running arrives through
//  `second-instance` — which only fires at all because of the lock below.
//
//  `pendingOpenPath` is what bridges the timing: a path that arrives before the
//  renderer is listening is held, and `file:take-pending` is how the renderer
//  collects it once it is ready. Without that, opening the app *by* double-
//  clicking a file — the commonest way there is — would open an empty canvas.

let pendingOpenPath = null;

function looksLikeDocument(arg) {
  if (typeof arg !== 'string' || !arg || arg.startsWith('-')) return false;
  const ext = path.extname(arg).toLowerCase();
  return ['.automaton', '.json', '.jff', '.jflap', '.png'].includes(ext);
}

function documentFromArgv(argv) {
  return (argv || []).slice(1).find(looksLikeDocument) || null;
}

async function deliverOpenPath(filePath) {
  if (!filePath) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingOpenPath = filePath;
    return;
  }
  try {
    const doc = await readDocument(filePath);
    rememberDocument(filePath);
    mainWindow.webContents.send('file:opened', doc);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (err) {
    console.error('[files] could not open', filePath, err);
  }
}

// The renderer asks once, when it has a listener attached.
ipcMain.handle('file:take-pending', async () => {
  const filePath = pendingOpenPath;
  pendingOpenPath = null;
  if (!filePath) return null;
  try {
    rememberDocument(filePath);
    return await readDocument(filePath);
  } catch {
    return null;
  }
});

// Registered at module scope: on macOS this can fire before `whenReady`, and a
// handler installed later would miss the very event that launched the app.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  void deliverOpenPath(filePath);
});

// ── A library link ────────────────────────────────────────────────
//  The library's website offers "Open in the desktop app" as an
//  automata-studio://lib/<id> link. The scheme is registered with the OS, and
//  the link arrives the way a file does: `open-url` on macOS, argv on Windows
//  and Linux, `second-instance` when the app is already running. The renderer
//  parses it (js/library/config.js) — this only carries the string.
const LIBRARY_SCHEME = 'automata-studio';
let pendingLibraryUrl = null;

function libraryUrlFromArgv(argv) {
  return (argv || []).find(a => typeof a === 'string' && a.startsWith(`${LIBRARY_SCHEME}://`)) || null;
}

function deliverLibraryUrl(url) {
  if (!url) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) { pendingLibraryUrl = url; return; }
  mainWindow.webContents.send('library:open-url', url);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

ipcMain.handle('library:take-pending', () => {
  const url = pendingLibraryUrl;
  pendingLibraryUrl = null;
  return url;
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverLibraryUrl(url);
});

// In development the app is `electron .`, and the OS has to be told to launch
// it with the script path — otherwise a link starts a bare Electron.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(LIBRARY_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(LIBRARY_SCHEME);
}

// Backs the header's more-menu entry. The renderer asks whether this build can
// update at all before revealing the item, so the answer has to come from the same
// canAutoUpdate() the startup check uses -- two copies of that rule would drift,
// and the copy in the renderer cannot see app.isPackaged or APPIMAGE anyway.
ipcMain.handle('updates-supported', () => canAutoUpdate());
ipcMain.on('check-for-updates', () => updates.checkManually());
// The page asks for the status it may have missed: update-status is a broadcast
// into a window that may still be loading. See lastStatus in electron/updates.cjs.
ipcMain.handle('update-state', () => updates.lastStatus());
// Refused unless something is staged, and a refused install is reported as UPD-07
// rather than left as a button that does nothing. See install() in updates.cjs.
ipcMain.on('install-update', () => updates.install());

// ── StateMate transport ───────────────────────────────────────────
// The renderer hands over a fully-formed request and gets the raw response
// back. Running it here rather than in the page is what makes the desktop
// build immune to each provider's CORS policy.
//
// Deliberately not a general-purpose fetch bridge: only http(s) is allowed,
// only POST is issued, and the URL is whatever the user typed into their own
// settings. Errors resolve rather than reject so both transports map to the
// same error copy in js/statemate.js.
const STATEMATE_TIMEOUT_MS = 60000;
// The streamed path splits that budget the way js/statemate-provider.js does:
// one clock to prove the provider is there, then one that resets on every chunk.
// A wall-clock limit cannot tell a hung request from a large machine still
// arriving, and kills the second along with the first.
const STATEMATE_FIRST_BYTE_MS = 45000;
const STATEMATE_IDLE_MS = 30000;

function statemateTarget(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (err) {
    return { error: 'That base URL is not a valid address.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: `Unsupported protocol: ${parsed.protocol}` };
  }
  return { url: parsed.toString() };
}

ipcMain.handle('statemate:request', async (_event, payload) => {
  const { url, headers, body, method } = payload || {};
  const target = statemateTarget(url);
  if (target.error) return { ok: false, status: 0, body: target.error };

  // GET is the model listing; a body on it is rejected by fetch outright,
  // which is why the method decides whether there is one rather than the
  // caller remembering to leave it out.
  const verb = String(method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATEMATE_TIMEOUT_MS);
  try {
    const response = await fetch(target.url, {
      method: verb,
      headers: headers && typeof headers === 'object' ? headers : {},
      ...(verb === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) }),
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      // The renderer cannot see response headers across `invoke`, and without
      // this a rate limit's own "wait n seconds" was unreachable on the desktop.
      retryAfter: response.headers.get('retry-after') || '',
      body: await response.text(),
    };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      body: aborted ? 'The provider did not answer in time.' : String((err && err.message) || err),
    };
  } finally {
    clearTimeout(timer);
  }
});

// ── the streamed path ─────────────────────────────────────────────
// `invoke` resolves once, with a whole body, so the shell could not stream, and
// a request in flight could not be cancelled — pressing escape reported success
// while the tokens kept being paid for. This is a channel instead: chunks go
// out as they are read, and `statemate:abort` reaches the fetch.
const statemateStreams = new Map();

ipcMain.on('statemate:abort', (_event, payload) => {
  const controller = statemateStreams.get(payload && payload.id);
  if (controller) controller.abort();
});

ipcMain.on('statemate:stream', async (event, payload) => {
  const { id, url, headers, body } = payload || {};
  if (!id) return;

  const send = (channel, message) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, { id, ...message });
  };

  // The Claude Code provider is a process, not a URL. It answers on the same
  // channel in the same SSE dialect, so the renderer cannot tell the two apart
  // and needs no second transport. See electron/claude-code.cjs.
  if (url === CLAUDE_CODE_URL) {
    let ended = false;
    const run = runClaudeCode(body, (channel, message) => {
      if (channel === 'statemate:end') { ended = true; statemateStreams.delete(id); }
      send(channel, message);
    });
    // A refusal (no CLI, a bad model name) ends before this line is reached.
    if (!ended) statemateStreams.set(id, run);
    return;
  }

  const target = statemateTarget(url);
  if (target.error) return send('statemate:end', { ok: false, status: 0, body: target.error });

  const controller = new AbortController();
  statemateStreams.set(id, controller);

  let timer = null;
  let timedOut = false;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  };

  try {
    arm(STATEMATE_FIRST_BYTE_MS);
    const response = await fetch(target.url, {
      method: 'POST',
      headers: headers && typeof headers === 'object' ? headers : {},
      body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const retryAfter = response.headers.get('retry-after') || '';

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return send('statemate:end', { ok: false, status: response.status, body: text, retryAfter });
    }
    // A proxy that buffered the body away leaves no reader; hand the whole
    // thing over as one chunk rather than failing on a feature nobody asked for.
    if (!response.body || typeof response.body.getReader !== 'function') {
      send('statemate:chunk', { chunk: await response.text() });
      return send('statemate:end', { ok: true, status: response.status, retryAfter });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(STATEMATE_IDLE_MS);
      send('statemate:chunk', { chunk: decoder.decode(value, { stream: true }) });
    }
    send('statemate:end', { ok: true, status: response.status, retryAfter });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    send('statemate:end', {
      ok: false,
      status: 0,
      aborted: aborted && !timedOut,
      timedOut,
      body: String((err && err.message) || err),
    });
  } finally {
    clearTimeout(timer);
    statemateStreams.delete(id);
  }
});

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '' || filePath === '/') filePath = '/index.html';

    const resolved = path.normalize(path.join(DIST_ROOT, filePath));
    if (!resolved.startsWith(DIST_ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.readFile(resolved);
      const type = MIME_TYPES[path.extname(resolved)] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    // The default theme's --bg2, so the window does not open on a dark frame
    // before the page paints. A reader who chose a dark theme sees one light
    // frame instead, which is the cheaper of the two to get wrong.
    backgroundColor: '#eef0f4',
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Frameless means no native minimize/maximize/close buttons either, so the
  // header's custom ones need to know which icon (maximize vs restore) to show.
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-change', false));

  // The page's own beforeunload handler (js/persistence.js) calls preventDefault()
  // when a workspace tab is dirty, to trigger the browser's native "leave site?"
  // prompt. Electron has no such prompt, so left alone this silently blocks the
  // window from ever closing — Alt+F4/Cmd+Q/the close button all become no-ops.
  // The page already flushes a backup save unconditionally before that check runs,
  // so nothing is lost by letting the close proceed anyway.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://index.html/');
  }

  // Any link the page tries to open in a new window/tab (target=_blank, window.open)
  // goes to the OS browser instead of spawning a second app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The app's export flows (Save JSON, Export PNG, Export Settings — persistence.js /
  // canvas.js / ui.js) all just do Blob + <a download>, same as on the website. Left
  // alone, Electron silently drops those into the OS Downloads folder with no prompt.
  // Intercepting will-download and setting save-dialog options turns every one of them
  // into a real native "Save As" dialog, without needing any renderer-side changes.
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: item.getFilename() });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendMenuAction(action) {
  if (mainWindow) mainWindow.webContents.send('menu-action', action);
}

// The `automata` command line on a Mac's PATH. A .dmg is drag and drop and runs
// no install script, so the app offers it from its own menu, the way VS Code
// offers "Install 'code' command in PATH": a link in /usr/local/bin, which is on
// every shell's PATH, to the launcher inside the bundle. Windows and the .deb do
// this in their installers (build/installer.nsh, build/linux/after-install.sh).
const CLI_LINK = '/usr/local/bin/automata';
const cliLauncher = () => path.join(process.resourcesPath, 'cli', 'automata');

// Whether the link is ours, someone else's, or not there at all.
function cliLinkState() {
  let target;
  try { target = fsSync.readlinkSync(CLI_LINK); } catch (e) {
    return e.code === 'ENOENT' && !fsSync.existsSync(CLI_LINK) ? 'absent' : 'other';
  }
  return target === cliLauncher() ? 'ours' : 'other';
}

// Run a shell command as an administrator, behind the system's password prompt.
// The command is passed to AppleScript as one string literal, escaped for it.
function runAsAdmin(command) {
  const literal = '"' + command.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const r = require('node:child_process').spawnSync('osascript', ['-e', `do shell script ${literal} with administrator privileges`], { encoding: 'utf8' });
  if (r.status !== 0) {
    // -128 is the user pressing Cancel on the password prompt: not an error.
    if (/-128/.test(r.stderr)) return false;
    throw new Error((r.stderr || '').trim() || `osascript exited ${r.status}`);
  }
  return true;
}

const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function installCliCommand() {
  const launcher = cliLauncher();
  // A copy run straight from the disk image or from Downloads is moved to a
  // random read-only path by Gatekeeper (App Translocation); a link to it
  // would break as soon as the app quit.
  if (!app.isPackaged || /\/AppTranslocation\/|^\/Volumes\//.test(launcher)) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Move AutomataStudio to Applications first',
      detail: 'The command line has to point at the app where it will stay. Drag AutomataStudio into Applications, open it from there, and choose this again.'
    });
    return;
  }
  const state = cliLinkState();
  if (state === 'ours') {
    await dialog.showMessageBox(mainWindow, { type: 'info', message: "'automata' is already installed", detail: `${CLI_LINK} points at this app. Open a terminal and run: automata --help` });
    return;
  }
  if (state === 'other') {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `${CLI_LINK} already exists`,
      detail: 'Something else is installed under that name — perhaps automata from npm. Replace it with a link to this app?'
    });
    if (response !== 0) return;
  }
  try {
    // Try as the user first: on many Macs /usr/local/bin is theirs (Homebrew).
    try {
      fsSync.mkdirSync(path.dirname(CLI_LINK), { recursive: true });
      fsSync.rmSync(CLI_LINK, { force: true });
      fsSync.symlinkSync(launcher, CLI_LINK);
    } catch (e) {
      if (e.code !== 'EACCES' && e.code !== 'EPERM') throw e;
      if (!runAsAdmin(`mkdir -p /usr/local/bin && ln -sfn ${shellQuote(launcher)} ${shellQuote(CLI_LINK)}`)) return;
    }
    await dialog.showMessageBox(mainWindow, { type: 'info', message: "'automata' is installed", detail: 'Open a new terminal and run: automata --help' });
  } catch (e) {
    dialog.showErrorBox("Could not install 'automata'", `${e.message}\n\nYou can make the link yourself:\nsudo ln -sf "${launcher}" ${CLI_LINK}`);
  }
}

async function uninstallCliCommand() {
  if (cliLinkState() !== 'ours') {
    await dialog.showMessageBox(mainWindow, { type: 'info', message: "'automata' is not installed by this app", detail: `${CLI_LINK} is missing or points somewhere else, so it was left alone.` });
    return;
  }
  try {
    try { fsSync.unlinkSync(CLI_LINK); } catch (e) {
      if (e.code !== 'EACCES' && e.code !== 'EPERM') throw e;
      if (!runAsAdmin(`rm -f ${shellQuote(CLI_LINK)}`)) return;
    }
    await dialog.showMessageBox(mainWindow, { type: 'info', message: "'automata' was removed from PATH" });
  } catch (e) {
    dialog.showErrorBox("Could not remove 'automata'", e.message);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: "Install 'automata' Command in PATH", click: () => installCliCommand() },
        { label: "Uninstall 'automata' Command from PATH", click: () => uninstallCliCommand() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        // The page binds these keys itself (js/ui.js, handleWorkspaceShortcut),
        // so the accelerators are shown but not registered: a registered one
        // would be a second, competing handler for the same keystroke.
        { label: 'New Workspace Tab', accelerator: 'CmdOrCtrl+T', registerAccelerator: false, click: () => sendMenuAction('new-tab') },
        { label: 'Close Workspace Tab', accelerator: 'CmdOrCtrl+W', registerAccelerator: false, click: () => sendMenuAction('close-tab') },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', registerAccelerator: false, click: () => sendMenuAction('reopen-tab') },
        { type: 'separator' },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { label: 'Export as PNG…', click: () => sendMenuAction('export-png') },
        { type: 'separator' },
        { label: 'Export Settings…', click: () => sendMenuAction('export-settings') },
        { label: 'Import Settings…', click: () => sendMenuAction('import-settings') },
        { type: 'separator' },
        // Cmd+W closes a workspace tab, as in every tabbed Mac app; the window
        // takes Shift+Cmd+W.
        isMac ? { role: 'close', accelerator: 'Shift+Cmd+W' } : { role: 'quit' },
      ],
    },
    {
      // Deliberately no accelerators here: the page already binds Ctrl/Cmd+Z/Y/A/C/V/D
      // itself (js/ui.js), so these entries are mouse-clickable equivalents only —
      // giving them accelerators too would create a second, competing key handler.
      label: 'Edit',
      submenu: [
        { label: 'Undo', click: () => sendMenuAction('undo') },
        { label: 'Redo', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { label: 'Cut', click: () => sendMenuAction('cut') },
        { label: 'Copy', click: () => sendMenuAction('copy') },
        { label: 'Paste', click: () => sendMenuAction('paste') },
        { label: 'Select All', click: () => sendMenuAction('select-all') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
    },
    {
      label: 'Help',
      submenu: [
        // No "Check for Updates" here on purpose. This menu is only ever rendered
        // by macOS, which puts it in the system menu bar -- every other platform
        // gets `frame: false` (see createWindow) and so draws no menu bar at all,
        // which is why the page has its own header controls. An update check
        // belongs where it can be clicked on the two platforms that can update:
        // the header's more-menu, wired through the check-for-updates channel.
        { label: 'About AutomataStudio', click: () => sendMenuAction('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Auto-update reaches Windows and Linux/AppImage only, and the three exclusions
// below are each a hard blocker rather than a preference:
//
//   - Unpackaged runs (electron:dev, electron:preview) have no app-update.yml —
//     electron-builder writes that beside the packaged app, from build.publish.
//   - macOS updates go through Squirrel.Mac, which refuses to apply an update to
//     an unsigned app, and there is no Developer ID to sign with (electron-build.yml
//     sets CSC_IDENTITY_AUTO_DISCOVERY=false). package.json sets mac.publish to null
//     to match, so the mac build ships no update metadata to act on either way.
//   - A .deb install is apt's to manage and electron-updater has no provider for it.
//     Only an AppImage run sets APPIMAGE, which is what distinguishes the two on a
//     Linux build that produces both.
//
// Anything ruled out here simply keeps the manual path: download the new installer
// from the GitHub release.
function canAutoUpdate() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return false;
}

// electron-updater's autoUpdater, or null when it cannot be loaded. Everything the
// updater *does* -- checks, downloads, installs, what the page is told -- lives in
// electron/updates.cjs; this is only the Electron half it cannot reach itself.
let updater = null;
let updaterUnavailable = false;

function loadUpdater() {
  if (updater || updaterUnavailable) return updater;

  // Required here rather than at the top of the file, and inside the try, because
  // electron-updater's `autoUpdater` is a lazy getter that constructs the platform
  // updater the moment it is read -- and construction reads app.getVersion(). At
  // module scope that runs before `app` is ready, so a require that looks inert
  // is really the first thing to touch the Electron app object. Loading it behind
  // canAutoUpdate() also keeps it off every path that will never use it: dev runs,
  // macOS, and .deb installs never load the module at all.
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    updaterUnavailable = true;
    console.error('[updater] unavailable:', err?.message ?? err);
    return null;
  }
  return updater;
}

// The whole vocabulary between the two processes: main owns the updater, the page
// owns how any of it looks. Deliberately not dialog.showMessageBox -- an OS dialog
// is the one piece of window chrome this app does not draw itself, and it would be
// the only framed surface in a frameless window. See js/electron-bridge.js for the
// receiving end and index.html #update-modal for the markup.
const updates = createUpdateController({
  loadUpdater,
  appVersion: () => app.getVersion(),
  send: payload => mainWindow?.webContents.send('update-status', payload),
});

// checkForUpdates, not checkForUpdatesAndNotify: the latter raises an OS
// notification, and every surface this feature has belongs inside the window.
function initAutoUpdater() {
  if (!canAutoUpdate()) return;
  updates.start();
}

// Double-clicking a second `.automaton` file while the app is running must open
// it *here*, not start a second copy with its own window, its own IndexedDB
// connection and its own idea of which tabs exist. Two instances sharing one
// userData directory is also how the version-bump deadlock `openWorkspaceDb`
// guards against actually happens in the wild.
//
// The loser exits immediately; the winner is handed its argv through
// `second-instance`, which is where the path it was asked to open arrives.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const libraryUrl = libraryUrlFromArgv(argv);
    const filePath = documentFromArgv(argv);
    if (libraryUrl) deliverLibraryUrl(libraryUrl);
    else if (filePath) void deliverOpenPath(filePath);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    buildMenu();
    createWindow();
    initAutoUpdater();

    // Windows and Linux pass the double-clicked file on the command line. It
    // is held rather than sent: the renderer is not listening yet, and
    // `file:take-pending` is how it collects this once it is.
    const launchedWith = documentFromArgv(process.argv);
    if (launchedWith) pendingOpenPath = launchedWith;
    const launchedLink = libraryUrlFromArgv(process.argv);
    if (launchedLink) pendingLibraryUrl = launchedLink;

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
