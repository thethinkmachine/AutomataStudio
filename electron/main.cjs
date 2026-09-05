// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.

const { app, BrowserWindow, Menu, protocol, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

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
  { name: 'All supported', extensions: [WORKSPACE_EXT, 'json', 'png', 'jff', 'jflap'] },
  { name: 'Workspace JSON', extensions: ['json'] },
  { name: 'JFLAP', extensions: ['jff', 'jflap'] },
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

// Backs the header's more-menu entry. The renderer asks whether this build can
// update at all before revealing the item, so the answer has to come from the same
// canAutoUpdate() the startup check uses -- two copies of that rule would drift,
// and the copy in the renderer cannot see app.isPackaged or APPIMAGE anyway.
ipcMain.handle('updates-supported', () => canAutoUpdate());
ipcMain.on('check-for-updates', () => checkForUpdatesManually());
// The other half of sendUpdateStatus: the page asks for the state it may have
// missed. update-status is a broadcast into a window that is still loading, so
// without this the renderer's only knowledge of the updater is whatever happened
// to arrive after its listener existed. See lastUpdateStatus.
ipcMain.handle('update-state', () => lastUpdateStatus);

// quitAndInstall closes the window on the way out, which runs the page's
// beforeunload backup save exactly as an ordinary quit does.
//
// It can also decline, and silently: BaseUpdater.install() returns false without
// throwing when quitAndInstallCalled is already set or the downloaded file is no
// longer known, and dispatchError's only listener writes to a console a packaged
// GUI app does not have. The page was left showing "Restart & Install" over a
// button that had become a no-op for the rest of the session -- which reads as an
// update that refuses to install. A refusal is now an error like any other.
ipcMain.on('install-update', () => {
  if (!updater) {
    sendUpdateStatus({ state: 'error', ...UpdateErrors.UNSUPPORTED });
    return;
  }
  try {
    updater.quitAndInstall();
  } catch (err) {
    console.error('[updater] install failed:', err);
    const { code, message } = classifyUpdateError(err);
    sendUpdateStatus({ state: 'error', code, message });
  }
});

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
    backgroundColor: '#0f0f14',
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

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
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
        { label: 'New Workspace Tab', click: () => sendMenuAction('new-tab') },
        { type: 'separator' },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { label: 'Export as PNG…', click: () => sendMenuAction('export-png') },
        { type: 'separator' },
        { label: 'Export Settings…', click: () => sendMenuAction('export-settings') },
        { label: 'Import Settings…', click: () => sendMenuAction('import-settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
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

// The startup check and the Help menu's manual check share one updater, so the
// listeners below are registered exactly once no matter which runs first.
let updater = null;
let updaterUnavailable = false;
// Set only by the manual check, and read once, when the download lands: it is what
// tells 'update-downloaded' whether a human is waiting on this. A startup download
// reports itself `silent` and only marks the menu item; a requested one opens the
// dialog the user asked for.
let promptOnDownloaded = false;
let manualCheckRunning = false;

function getAutoUpdater() {
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

  // Load-bearing: a failed update check must be a no-op, and by default it is not.
  // autoUpdater is an EventEmitter, so an 'error' with no listener registered
  // becomes an uncaught exception. Being offline, or hitting a release whose
  // latest.yml has not finished uploading, would otherwise take down an app that
  // was working fine without ever having updated. The manual check reports failures
  // through its own rejected promise; this keeps the process alive either way.
  updater.on('error', (err) => {
    console.error('[updater]', err?.message ?? err);
    // Forwarded as well as logged, because this is the only channel a *failed
    // install* has: quitAndInstall() reports through dispatchError rather than by
    // throwing. It stays safe for a background check because the renderer drops an
    // error arriving while #update-modal is closed -- so a failed startup check is
    // still the no-op it has to be, and a failed click is not.
    const { code, message } = classifyUpdateError(err);
    sendUpdateStatus({ state: 'error', code, message });
  });

  updater.on('download-progress', ({ percent }) => {
    sendUpdateStatus({ state: 'downloading', percent: Math.round(percent) });
  });

  updater.on('update-downloaded', ({ version }) => {
    // `silent` separates the startup check from a click. The startup download
    // must not take over the screen, so the page only marks its menu item; a
    // click opts into the dialog. Either way the update is already on disk.
    sendUpdateStatus({ state: 'downloaded', version, silent: !promptOnDownloaded });
    promptOnDownloaded = false;
  });

  return updater;
}

// The whole vocabulary between the two processes: main owns the updater, the page
// owns how any of it looks. Deliberately not dialog.showMessageBox -- an OS dialog
// is the one piece of window chrome this app does not draw itself, and it would be
// the only framed surface in a frameless window. See js/electron-bridge.js for the
// receiving end and index.html #update-modal for the markup.
// The last thing sent, replayed over the 'update-state' channel above. Broadcasts
// are fire-and-forget into a window that may not have finished loading: the startup
// check begins at whenReady, while js/electron-bridge.js does not register its
// listener until the whole module graph has evaluated. On the second and later
// launches the installer is already in the pending cache, so 'update-downloaded'
// fires a second or two in -- squarely inside that gap -- and the page never heard
// that an update was staged, never offered the install, and re-checked from scratch
// on the next launch. Forever.
let lastUpdateStatus = null;

function sendUpdateStatus(payload) {
  lastUpdateStatus = payload;
  mainWindow?.webContents.send('update-status', payload);
}

// What the user is shown when a check fails. electron-updater's own errors are
// unusable here: an HttpError stringifies to the entire response -- status, request
// URL, then every response header, Set-Cookie included -- which fills the dialog
// with session cookies and tells a non-developer nothing they can act on.
//
// So each failure becomes one of these: a sentence saying what to do, plus a stable
// code to quote in a bug report. The code is the half that survives translation,
// screenshots and paraphrasing, which is why it is shown even though the sentence
// is the useful part. Keep this table and docs/update-error-codes.md in step --
// a code with no entry there is worse than no code.
const UpdateErrors = {
  OFFLINE: { code: 'UPD-01', message: 'Could not reach the update server. Check your internet connection and try again.' },
  NO_RELEASE: { code: 'UPD-02', message: 'No update information has been published yet. Please try again later.' },
  REFUSED: { code: 'UPD-03', message: 'The update server refused the request. Please try again in a few minutes.' },
  SERVER: { code: 'UPD-04', message: 'The update server is having problems. Please try again later.' },
  CORRUPT: { code: 'UPD-05', message: 'The downloaded update failed its safety check and was discarded. Please try again.' },
  UNSUPPORTED: { code: 'UPD-06', message: 'This copy cannot update itself. Please download the latest version manually.' },
  UNKNOWN: { code: 'UPD-99', message: 'Something went wrong while checking for updates.' },
};

const NETWORK_ERRNOS = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE',
]);

function classifyUpdateError(err) {
  const text = String(err?.message ?? err);
  if (err?.code === 'UPDATER_UNAVAILABLE') return UpdateErrors.UNSUPPORTED;
  if (NETWORK_ERRNOS.has(err?.code)) return UpdateErrors.OFFLINE;
  if (/checksum|sha512|signature/i.test(text)) return UpdateErrors.CORRUPT;

  // The provider usually rethrows its HttpError wrapped in a plain Error, so the
  // status survives only inside the message text -- hence the fallback parse.
  const status = typeof err?.statusCode === 'number'
    ? err.statusCode
    : Number(/HttpError:\s*(\d{3})/.exec(text)?.[1]) || null;

  // "Cannot find latest.yml …" means the release exists but carries no manifest,
  // which is the same story for the user as no release at all.
  if (status === 404 || /Cannot find .*(?:in the (?:latest )?release|update info)/i.test(text)) {
    return UpdateErrors.NO_RELEASE;
  }
  if (status === 401 || status === 403 || status === 429) return UpdateErrors.REFUSED;
  if (status !== null && status >= 500) return UpdateErrors.SERVER;
  return UpdateErrors.UNKNOWN;
}

// electron-updater never empties its own pending directory, so the installer for a
// version that has since been installed stays on disk at full size -- two of them
// here, 100 MB each, for 2.0.0 and 2.5.0. It is only cleared on the way to
// *replacing* it (a cached file whose checksum no longer matches the manifest), and
// "there is nothing newer to install" never takes that path. So do it here, which is
// the one moment the answer is known to be that.
async function clearStaleUpdateCache(u) {
  try {
    await u.downloadedUpdateHelper?.clear();
  } catch (err) {
    // Best-effort: a locked or missing cache is not a reason to fail a check that
    // has already succeeded.
    console.error('[updater] could not clear pending cache:', err?.message ?? err);
  }
}

function initAutoUpdater() {
  if (!canAutoUpdate()) return;
  const u = getAutoUpdater();
  if (!u) return;

  // checkForUpdates, not checkForUpdatesAndNotify: the latter raises an OS
  // notification, and every surface this feature has belongs inside the window.
  // autoDownload is on, so a staged update announces itself through the
  // 'update-downloaded' handler above, which marks the menu item and nothing more.
  u.checkForUpdates()
    .then(result => { if (result && !result.isUpdateAvailable) clearStaleUpdateCache(u); })
    .catch(() => {});
}

// Wired to Help > Check for Updates…, which is only built when canAutoUpdate() is
// true -- an always-present item that can only ever answer "not supported here"
// is worse than no item at all.
async function checkForUpdatesManually() {
  // checkForUpdates() reuses one in-flight promise internally, so a second click
  // would silently resolve against the first check's result. Refusing re-entry
  // keeps one click to one visible answer.
  if (manualCheckRunning) return;
  manualCheckRunning = true;
  sendUpdateStatus({ state: 'checking' });
  try {
    const u = getAutoUpdater();
    if (!u) {
      const unavailable = new Error('The updater module failed to load.');
      unavailable.code = 'UPDATER_UNAVAILABLE';
      throw unavailable;
    }

    const result = await u.checkForUpdates();
    // isUpdateAvailable is the provider's own verdict. The manifest names the latest
    // version whether or not it is newer, so comparing version strings here would
    // reimplement the comparison electron-updater has already done.
    if (!result?.isUpdateAvailable) {
      sendUpdateStatus({ state: 'up-to-date', version: app.getVersion() });
      clearStaleUpdateCache(u);
      return;
    }

    // autoDownload is on, so the fetch is already running by the time checkForUpdates
    // resolves; 'download-progress' and 'update-downloaded' carry it from here.
    promptOnDownloaded = true;
    sendUpdateStatus({ state: 'available', version: result.updateInfo.version });
  } catch (err) {
    promptOnDownloaded = false;
    // The whole error goes here, where a developer can read it; only the code and
    // the sentence cross to the window.
    console.error('[updater] manual check failed:', err);
    const { code, message } = classifyUpdateError(err);
    sendUpdateStatus({ state: 'error', code, message });
  } finally {
    manualCheckRunning = false;
  }
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
    const filePath = documentFromArgv(argv);
    if (filePath) void deliverOpenPath(filePath);
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
