import { copySelection, exportPNG, pasteClipboard, selectAllStates } from './canvas.js';
import { redo, undo } from './history.js';
import { closeModal, isModalOpen, registerModal, showOverlay } from './modal.js';
import { loadJSON, saveJSON } from './persistence.js';
import { $, App } from './state.js';
import { createTab, exportSettings } from './ui.js';
import { hideMoreMenu } from './view.js';
import { openAboutModal } from './workspace.js';

// ══════════════════════════════════════════════════════════════════
//  ELECTRON INTEGRATION
// ══════════════════════════════════════════════════════════════════
// window.electronAPI only exists inside the packaged/dev Electron shell
// (exposed by electron/preload.js). On the website it's undefined, so every
// isElectron branch elsewhere in the app (persistence.js, canvas.js, ui.js)
// falls through to the original browser Blob/<input type=file> behavior.
export const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

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

  // ── Software update ──────────────────────────────────────────────
  // Every surface lives in the page: the main process reports state over
  // update-status and this renders it into #update-modal, the same overlay the
  // rest of the app uses. Nothing here calls an OS dialog.
  registerModal('update-modal', { dismissOnBackdrop: true });

  const updatesBtn = document.getElementById('updates-btn');
  const updateTitle = document.getElementById('update-title');
  const updateMsg = document.getElementById('update-msg');
  const updateCode = document.getElementById('update-code');
  const updateBar = document.getElementById('update-bar');
  const updateFill = document.getElementById('update-bar-fill');
  const updateInstall = document.getElementById('update-install');
  const updateDismiss = document.getElementById('update-dismiss');

  // Set once an update is on disk, by either check. It makes the menu item offer
  // the restart instead of a pointless second check, and survives closing the
  // modal — the download does not have to be repeated to be installed.
  let updateStaged = null;

  // `code` is only ever set on a failure, and is the one string worth quoting back
  // to us — the sentence above it is what the reader acts on. See
  // docs/update-error-codes.md, which has an entry per code.
  const setUpdateView = ({ title, msg, code = null, percent = null, canInstall = false }) => {
    updateTitle.textContent = title;
    updateMsg.textContent = msg;
    updateCode.hidden = !code;
    updateCode.textContent = code ? `Error code ${code}` : '';
    updateBar.hidden = percent === null;
    if (percent !== null) updateFill.style.width = `${percent}%`;
    updateInstall.hidden = !canInstall;
    updateDismiss.textContent = canInstall ? 'Later' : 'Close';
  };

  const markStaged = () => {
    updatesBtn?.classList.add('active');
    const label = document.getElementById('updates-btn-label');
    if (label) label.textContent = 'Restart to Update';
  };

  const showStagedUpdate = () => {
    // Also marks the header: once an update is on disk that is what the menu item
    // says, whether the dialog was opened for it or replayed into it at boot.
    markStaged();
    setUpdateView({
      title: 'Update Ready',
      msg: `Version ${updateStaged} is ready. Your work is saved before restarting.`,
      percent: 100,
      canInstall: true,
    });
  };

  const applyUpdateStatus = status => {
    if (!status) return;
    if (status.state === 'downloaded') {
      updateStaged = status.version;
      // A background download must not seize the screen. The menu item carries
      // the news until the user asks for it.
      if (status.silent) { markStaged(); return; }
      showStagedUpdate();
      return;
    }
    // Progress for a download nobody opened the dialog for would fight whatever
    // the user is doing; the staged-update path above is how that one reports.
    if (!isModalOpen('update-modal')) return;

    switch (status.state) {
      case 'checking':
        setUpdateView({ title: 'Checking for Updates', msg: 'Contacting the update server…' });
        break;
      case 'up-to-date':
        setUpdateView({ title: 'Up to Date', msg: `You have the latest version (${status.version}).` });
        break;
      case 'available':
        setUpdateView({ title: 'Update Available', msg: `Downloading version ${status.version}…`, percent: 0 });
        break;
      case 'downloading':
        setUpdateView({ title: 'Update Available', msg: `Downloading… ${status.percent}%`, percent: status.percent });
        break;
      case 'error':
        setUpdateView({ title: 'Update Failed', msg: status.message, code: status.code });
        break;
    }
  };

  window.electronAPI.onUpdateStatus(applyUpdateStatus);

  // The state that was reported before this listener existed. The startup check
  // begins at app.whenReady() while this module is still being evaluated, and a
  // broadcast into a loading window is simply lost -- which on every launch after
  // the first is the launch where the installer is already cached and
  // 'update-downloaded' therefore lands within a second or two. Without this the
  // page never learned the update was staged, never offered to install it, and
  // downloaded it again on the next launch, forever.
  window.electronAPI.updateState?.().then(applyUpdateStatus).catch(() => {});

  updateInstall?.addEventListener('click', () => window.electronAPI.installUpdate());
  updateDismiss?.addEventListener('click', () => closeModal('update-modal'));

  // Hidden in the markup and revealed only if this build has an update channel —
  // macOS, .deb installs and dev runs have none, and an item that can only ever
  // report "not supported here" is worse than no item. The main process owns that
  // decision; see canAutoUpdate in electron/main.cjs.
  if (updatesBtn) {
    updatesBtn.addEventListener('click', () => {
      hideMoreMenu();
      showOverlay('update-modal');
      // Already downloaded: offer the restart rather than checking again.
      if (updateStaged) { showStagedUpdate(); return; }
      setUpdateView({ title: 'Checking for Updates', msg: 'Contacting the update server…' });
      window.electronAPI.checkForUpdates();
    });
    window.electronAPI.updatesSupported()
      .then(supported => { if (supported) updatesBtn.hidden = false; })
      .catch(() => {});
  }

  const maximizeBtn = document.getElementById('winctl-maximize');
  const syncMaximizedState = (isMaximized) => {
    maximizeBtn?.classList.toggle('is-maximized', isMaximized);
  };
  window.electronAPI.isWindowMaximized().then(syncMaximizedState);
  window.electronAPI.onWindowMaximizedChange(syncMaximizedState);
}
