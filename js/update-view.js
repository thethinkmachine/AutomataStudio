// What #update-modal and the header's update item say for each status the main
// process sends (electron/updates.cjs). Import-free and DOM-free: it is a table
// from status to words, which is the half of the update dialog a test can reach
// without an Electron shell. js/electron-bridge.js does the painting.

/** The header item's label, per what the updater last reported. */
export const UpdateMenuLabel = {
  idle: 'Check for Updates',
  staged: 'Restart to Update',
  failed: 'Update Failed — Retry',
};

/**
 * The dialog for an update that is on disk. `canInstall` is true here and nowhere
 * else: "Restart & Install" with nothing staged is the button that used to end in
 * UPD-99.
 */
export function stagedUpdateView({ version, notes = null }) {
  return {
    title: 'Update Ready',
    // "Later" is not "never": the updater installs a staged update when the app next
    // quits normally (autoInstallOnAppQuit, set on purpose in updates.cjs). Saying so
    // is the difference between a choice and a surprise.
    msg: `Version ${version} is ready. Restart now to install it, or it installs the next time you close AutomataStudio. Your work is saved either way.`,
    percent: 100,
    canInstall: true,
    notes,
  };
}

/**
 * The dialog for one status, or null for a status that changes nothing on screen.
 * `notes` is undefined where the status says nothing about them (download progress
 * keeps whatever "Update Available" showed) and null where they should go away.
 */
export function updateView(status) {
  switch (status?.state) {
    case 'checking':
      return { title: 'Checking for Updates', msg: 'Contacting the update server…', notes: null };
    case 'up-to-date':
      return { title: 'Up to Date', msg: `You have the latest version (${status.version}).`, notes: null };
    case 'available':
      return {
        title: 'Update Available',
        msg: `Downloading version ${status.version}…`,
        percent: 0,
        notes: status.notes ?? null,
      };
    case 'downloading':
      return {
        title: 'Update Available',
        msg: status.version
          ? `Downloading version ${status.version}… ${status.percent}%`
          : `Downloading… ${status.percent}%`,
        percent: status.percent,
        notes: undefined,
      };
    case 'downloaded':
      return stagedUpdateView(status);
    case 'error':
      return {
        title: status.phase === 'install' ? 'Install Failed'
          : status.phase === 'download' ? 'Download Failed'
          : 'Update Failed',
        msg: status.message,
        code: status.code,
        notes: null,
      };
    default:
      return null;
  }
}
