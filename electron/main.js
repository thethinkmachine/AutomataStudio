const { app, BrowserWindow, Menu, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

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
        { label: 'About Automata Playground', click: () => sendMenuAction('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerAppProtocol();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
