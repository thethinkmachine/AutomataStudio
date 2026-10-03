import { requestLibrary } from './library/requests.js';
import { copySelection, exportPNG, selectAllStates } from './canvas.js';
import { redo, undo } from './history.js';
import { closeModal, isModalOpen, registerModal, showOverlay } from './modal.js';
import { loadJSON, openExternalDocument, saveDocumentAs, saveNow } from './persistence.js';
import { $, App, activeWorkspaceId } from './state.js';
import { closeTab, createTab, cutSelection, exportSettings, pasteFromSystemClipboard, reopenClosedTab } from './ui.js';
import { UpdateMenuLabel, stagedUpdateView, updateView } from './update-view.js';
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
      case 'close-tab': if (activeWorkspaceId) closeTab(activeWorkspaceId); break;
      case 'reopen-tab': reopenClosedTab(); break;
      case 'open': loadJSON(); break;
      case 'save': void saveNow(); break;
      case 'save-as': void saveDocumentAs(); break;
      case 'export-png': exportPNG(); break;
      case 'export-settings': exportSettings(); break;
      case 'import-settings':
        showOverlay('settings-modal');
        $('settings-file-input').click();
        break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'cut': if (App.view === 'build') cutSelection(); break;
      case 'copy': if (App.view === 'build') copySelection(); break;
      case 'paste': if (App.view === 'build') void pasteFromSystemClipboard(); break;
      case 'select-all': if (App.view === 'build') selectAllStates(); break;
      case 'about': openAboutModal(); break;
    }
  });

  // A file the OS handed over: a double-click on a .automaton, an "Open With",
  // a path on the command line, or a second launch while this one is running.
  //
  // Subscribing also *collects* a path that arrived before this listener
  // existed — which is the case whenever the app was launched by double-
  // clicking a file, the commonest way there is. Without that collection the
  // app opens its own file type to an empty canvas.
  //
  // That collection is why this goes through openExternalDocument rather than
  // applying straight away: this module is evaluated first in main.js, so a
  // cold launch delivers the file *before* loadBackup() has restored the
  // workspaces — and the restore then overwrote it. See THE BOOT GATE in
  // js/persistence.js.
  window.electronAPI.onOpenFile(doc => { openExternalDocument(doc); });

  // An automata-studio:// link — a website's "Open in the desktop app". Queued
  // until the boot has restored the workspaces, for the reason files are.
  window.electronAPI.onLibraryUrl?.(url => { requestLibrary(url); });

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
  const updateNotes = document.getElementById('update-notes');
  const updateNotesBody = document.getElementById('update-notes-body');

  // {version, notes} once an update is on disk, by either check. It makes the menu
  // item offer the restart instead of a pointless second check, and survives
  // closing the modal — the download does not have to be repeated to be installed.
  let updateStaged = null;

  // The words are js/update-view.js's; this only paints them. `code` is only ever
  // set on a failure, and is the one string worth quoting back to us — the
  // sentence above it is what the reader acts on. See docs/update-error-codes.md.
  // Release notes arrive as plain text from the main process and go in as
  // textContent: they are the release body, which is not ours to trust as markup.
  const setUpdateView = ({ title, msg, code = null, percent = null, canInstall = false, notes }) => {
    updateTitle.textContent = title;
    updateMsg.textContent = msg;
    updateCode.hidden = !code;
    updateCode.textContent = code ? `Error code ${code}` : '';
    updateBar.hidden = percent === null || percent === undefined;
    if (!updateBar.hidden) updateFill.style.width = `${percent}%`;
    updateInstall.hidden = !canInstall;
    updateDismiss.textContent = canInstall ? 'Later' : 'Close';
    if (notes !== undefined && updateNotes) {
      updateNotes.hidden = !notes;
      updateNotesBody.textContent = notes ?? '';
    }
  };

  // The header item says what the updater last found: a staged update, a download
  // that failed with nobody watching, or nothing to report.
  const markUpdateMenu = kind => {
    updatesBtn?.classList.toggle('active', kind === 'staged');
    updatesBtn?.classList.toggle('is-failed', kind === 'failed');
    const label = document.getElementById('updates-btn-label');
    if (label) label.textContent = UpdateMenuLabel[kind ?? 'idle'];
  };

  const showStagedUpdate = () => {
    // Also marks the header: once an update is on disk that is what the menu item
    // says, whether the dialog was opened for it or replayed into it at boot.
    markUpdateMenu('staged');
    setUpdateView(stagedUpdateView(updateStaged));
  };

  const applyUpdateStatus = status => {
    if (!status) return;
    if (status.state === 'downloaded') {
      updateStaged = { version: status.version, notes: status.notes ?? null };
      // A background download must not seize the screen. The menu item carries
      // the news until the user asks for it.
      if (status.silent) { markUpdateMenu('staged'); return; }
      showStagedUpdate();
      return;
    }
    if (status.state === 'error' && status.phase === 'install') {
      // The main process has dropped the staged update; so does the page, or the
      // menu would go on offering a restart into the same failure.
      updateStaged = null;
      markUpdateMenu(null);
    }
    if (!isModalOpen('update-modal')) {
      // A download that failed in the background is the one failure worth the
      // header's attention: otherwise it fails quietly on every launch. A failed
      // background *check* is not — being offline is ordinary.
      if (status.state === 'error' && status.phase === 'download') markUpdateMenu('failed');
      // Anything else for a dialog nobody opened would fight whatever the user is
      // doing; the staged-update path above is how a background download reports.
      return;
    }
    const view = updateView(status);
    if (view) setUpdateView(view);
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
      // A retry after a failed download starts clean; a second failure re-marks it.
      markUpdateMenu(null);
      setUpdateView(updateView({ state: 'checking' }));
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
