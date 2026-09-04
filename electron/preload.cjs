const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // callback(action: string); returns an unsubscribe function
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  },

  // Resolves false on macOS, on .deb installs and in dev, where there is no update
  // channel — the header's "Check for Updates" item stays hidden unless this is true.
  updatesSupported: () => ipcRenderer.invoke('updates-supported'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  // The state the page may have missed. update-status is broadcast into a window
  // that is still loading, and the startup check can resolve before this script's
  // consumer exists — see lastUpdateStatus in electron/main.cjs. Resolves null when
  // nothing has been reported yet.
  updateState: () => ipcRenderer.invoke('update-state'),
  // callback({ state, version?, percent?, message?, silent? }); returns an
  // unsubscribe function. State drives #update-modal; there is no OS dialog.
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },

  // The window is frameless — these back the custom minimize/maximize/close
  // buttons the page draws in its own header.
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.send('window-maximize-toggle'),
  windowClose: () => ipcRenderer.send('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  // callback(isMaximized: boolean); returns an unsubscribe function
  onWindowMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window-maximized-change', listener);
    return () => ipcRenderer.removeListener('window-maximized-change', listener);
  },

  // ── Files ───────────────────────────────────────────────────────
  // The filesystem the website does not have. js/file-host.js is the only
  // consumer, and it is what lets "save the file I opened" be a thing that can
  // be expressed at all — a Blob download has no path, so before these the
  // desktop build could not offer Save, only Save A Copy Somewhere.
  //
  // Each resolves { ok, ... } rather than throwing, so a cancel (`ok: false,
  // canceled: true`) is distinguishable from a failure and never reported as
  // one.
  saveFileAs: (payload) => ipcRenderer.invoke('file:save-dialog', payload),
  writeFile: (payload) => ipcRenderer.invoke('file:write', payload),
  openFile: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  // What the window is editing: the macOS proxy icon and edited dot, and the
  // OS Recent Files list.
  noteDocument: (payload) => ipcRenderer.send('file:note-document', payload),

  // A file the OS handed us — a double-click, an "Open With", a path on the
  // command line, or a second launch while this one is running. callback({ path,
  // text }) or ({ path, base64, binary }) for a PNG.
  //
  // The pending collection is the half that is easy to miss: a path that
  // arrived before this listener existed — which is the case whenever the app
  // was *launched* by double-clicking a file, the commonest way there is — is
  // held in the main process, and asking for it is how the renderer finds out.
  // Without it, opening the app by its own file type shows an empty canvas.
  onOpenFile: (callback) => {
    const listener = (_event, doc) => callback(doc);
    ipcRenderer.on('file:opened', listener);
    ipcRenderer.invoke('file:take-pending').then((doc) => { if (doc) callback(doc); });
    return () => ipcRenderer.removeListener('file:opened', listener);
  },

  // StateMate's model request, proxied through the main process. The browser
  // build has to satisfy each provider's CORS policy — Anthropic needs an
  // explicit opt-in header, and a local Ollama needs OLLAMA_ORIGINS set. None
  // of that applies here, and js/statemate-provider.js prefers this path
  // whenever it exists. Resolves { ok, status, body } rather than throwing, so
  // an HTTP error maps to the same copy in both transports.
  statemateRequest: (payload) => ipcRenderer.invoke('statemate:request', payload),

  // The same request, streamed. `invoke` resolves once with a whole body, which
  // is why the desktop build had no streaming, no way to cancel a request in
  // flight, and no access to `retry-after`. Chunks arrive on their own channel
  // and the returned handle reaches the fetch in the main process.
  //
  // handlers: { onChunk(text), onEnd({ok, status, body, retryAfter, aborted, timedOut}) }
  // Every listener is removed when the end event lands, so a session that
  // sends a hundred prompts does not accumulate a hundred listeners.
  statemateStream: (payload, handlers) => {
    const id = `sm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const onChunk = (_event, message) => {
      if (message && message.id === id && handlers && handlers.onChunk) handlers.onChunk(message.chunk);
    };
    const onEnd = (_event, message) => {
      if (!message || message.id !== id) return;
      cleanup();
      if (handlers && handlers.onEnd) handlers.onEnd(message);
    };
    const cleanup = () => {
      ipcRenderer.removeListener('statemate:chunk', onChunk);
      ipcRenderer.removeListener('statemate:end', onEnd);
    };

    ipcRenderer.on('statemate:chunk', onChunk);
    ipcRenderer.on('statemate:end', onEnd);
    ipcRenderer.send('statemate:stream', { id, ...payload });

    return {
      abort: () => {
        ipcRenderer.send('statemate:abort', { id });
        cleanup();
      },
    };
  },
});
