// ══════════════════════════════════════════════════════════════════
//  ELECTRON INTEGRATION
// ══════════════════════════════════════════════════════════════════
// window.electronAPI only exists inside the packaged/dev Electron shell
// (exposed by electron/preload.js). On the website it's undefined, so every
// isElectron branch elsewhere in the app (persistence.js, canvas.js, ui.js)
// falls through to the original browser Blob/<input type=file> behavior.
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

if (isElectron) {
  // Lets CSS (the drag region, the window-control buttons) and markup that's
  // only meaningful inside the packaged app key off a single selector.
  document.documentElement.classList.add('is-electron');

  window.electronAPI.onMenuAction(action => {
    switch (action) {
      case 'new-tab': createTab(); break;
      case 'open': loadJSON(); break;
      case 'save': saveJSON(); break;
      case 'export-png': exportPNG(); break;
      case 'export-settings': exportSettings(); break;
      case 'import-settings':
        showOverlay('settings-modal');
        $('settings-file-input').click();
        break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'copy': if (App.view === 'build') copySelection(); break;
      case 'paste': pasteClipboard(App._lastCanvasWorldPt || null); break;
      case 'select-all': if (App.view === 'build') selectAllStates(); break;
      case 'about': openAboutModal(); break;
    }
  });

  // Custom titlebar: the window is frameless (electron/main.js), so these
  // buttons in the header are the only way to minimize/maximize/close.
  document.getElementById('winctl-minimize')?.addEventListener('click', () => {
    window.electronAPI.windowMinimize();
  });
  document.getElementById('winctl-maximize')?.addEventListener('click', () => {
    window.electronAPI.windowMaximizeToggle();
  });
  document.getElementById('winctl-close')?.addEventListener('click', () => {
    window.electronAPI.windowClose();
  });

  const maximizeBtn = document.getElementById('winctl-maximize');
  const syncMaximizedState = (isMaximized) => {
    maximizeBtn?.classList.toggle('is-maximized', isMaximized);
  };
  window.electronAPI.isWindowMaximized().then(syncMaximizedState);
  window.electronAPI.onWindowMaximizedChange(syncMaximizedState);
}
