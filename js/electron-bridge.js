// ══════════════════════════════════════════════════════════════════
//  ELECTRON INTEGRATION
// ══════════════════════════════════════════════════════════════════
// window.electronAPI only exists inside the packaged/dev Electron shell
// (exposed by electron/preload.js). On the website it's undefined, so every
// isElectron branch elsewhere in the app (persistence.js, canvas.js, ui.js)
// falls through to the original browser Blob/<input type=file> behavior.
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

if (isElectron) {
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
}
