// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.

const { app, BrowserWindow, Menu, protocol, shell, ipcMain } = require('electron');
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
const legacyUserData = path.join(app.getPath('appData'), 'Automata Playground');
if (fsSync.existsSync(legacyUserData)) app.setPath('userData', legacyUserData);

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

// Backs the header's more-menu entry. The renderer asks whether this build can
// update at all before revealing the item, so the answer has to come from the same
// canAutoUpdate() the startup check uses -- two copies of that rule would drift,
// and the copy in the renderer cannot see app.isPackaged or APPIMAGE anyway.
ipcMain.handle('updates-supported', () => canAutoUpdate());
ipcMain.on('check-for-updates', () => checkForUpdatesManually());
// quitAndInstall closes the window on the way out, which runs the page's
// beforeunload backup save exactly as an ordinary quit does.
ipcMain.on('install-update', () => updater?.quitAndInstall());

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
        { label: 'Save As JSON…', click: () => sendMenuAction('save') },
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
function sendUpdateStatus(payload) {
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

function initAutoUpdater() {
  if (!canAutoUpdate()) return;
  const u = getAutoUpdater();
  if (!u) return;

  // checkForUpdates, not checkForUpdatesAndNotify: the latter raises an OS
  // notification, and every surface this feature has belongs inside the window.
  // autoDownload is on, so a staged update announces itself through the
  // 'update-downloaded' handler above, which marks the menu item and nothing more.
  u.checkForUpdates().catch(() => {});
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

app.whenReady().then(() => {
  registerAppProtocol();
  buildMenu();
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
