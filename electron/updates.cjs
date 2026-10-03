// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ── Software update ───────────────────────────────────────────────
// The updater's whole life in the main process: when to check, what a download
// and an install are doing, and what the page is told about it. main.cjs owns only
// the Electron half -- whether this build can update at all, loading
// electron-updater, and the IPC channels -- so this module takes the updater and
// a send() function and nothing else. That is what lets tests/updates.test.js
// drive it with a fake updater: the app's only update bugs so far were in exactly
// this sequencing, and a packaged build is the one place nobody can step through.
//
// The page's half is js/electron-bridge.js, which renders each status into
// #update-modal through js/update-view.js.

// What the user is shown when something fails. electron-updater's own errors are
// unusable here: an HttpError stringifies to the entire response -- status, request
// URL, then every response header, Set-Cookie included -- which fills the dialog
// with session cookies and tells a non-developer nothing they can act on.
//
// So each failure becomes one of these: a sentence saying what to do, plus a stable
// code to quote in a bug report. The code is the half that survives translation,
// screenshots and paraphrasing, which is why it is shown even though the sentence
// is the useful part. Keep this table and docs/update-error-codes.md in step --
// tests/updates.test.js fails on a code with no entry there.
const UpdateErrors = {
  OFFLINE: { code: 'UPD-01', message: 'Could not reach the update server. Check your internet connection and try again.' },
  NO_RELEASE: { code: 'UPD-02', message: 'No update information has been published yet. Please try again later.' },
  REFUSED: { code: 'UPD-03', message: 'The update server refused the request. Please try again in a few minutes.' },
  SERVER: { code: 'UPD-04', message: 'The update server is having problems. Please try again later.' },
  CORRUPT: { code: 'UPD-05', message: 'The downloaded update failed its safety check and was discarded. Please try again.' },
  UNSUPPORTED: { code: 'UPD-06', message: 'This copy cannot update itself. Please download the latest version manually.' },
  // Its own code because "checking" and "installing" fail for different reasons and
  // call for different remedies: a check can simply be retried, while an installer
  // that will not start is usually gone from disk or blocked, and the dependable
  // way out is the installer from the release page.
  INSTALL: { code: 'UPD-07', message: 'The update could not be installed. Please download the latest version manually and run its installer.' },
  UNKNOWN: { code: 'UPD-99', message: 'Something went wrong while updating.' },
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

// ── Release notes ─────────────────────────────────────────────────
// The GitHub provider hands over the release body as HTML (or, with fullChangelog,
// an array of {version, note}). The page gets plain text and nothing else: it is
// shown with textContent, so markup could not run there anyway, but HTML crossing
// the IPC boundary would invite someone to set it as innerHTML later -- and the
// release body is text anyone with write access to the repo can change.
const NOTES_MAX_CHARS = 4000;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const cp = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function releaseNotesText(notes) {
  if (Array.isArray(notes)) notes = notes.map(n => n?.note).filter(Boolean).join('\n');
  if (typeof notes !== 'string') return null;
  const text = decodeEntities(notes
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // A list item starts a line of its own with a bullet; its closing tag adds
    // nothing, or every item would be followed by an empty line.
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|pre|blockquote|tr|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''));
  // Blank lines are dropped outright: in a dialog this size they read as gaps,
  // and the bullets and headings already separate one thing from the next.
  let out = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if (!out) return null;
  if (out.length > NOTES_MAX_CHARS) out = `${out.slice(0, NOTES_MAX_CHARS).trimEnd()}…`;
  return out;
}

// ── The controller ────────────────────────────────────────────────
// A long-running session hears about a release this often. Six hours keeps a
// laptop that is opened in the morning and closed at night to one or two extra
// requests a day -- far inside GitHub's unauthenticated rate limit, which is the
// failure (UPD-03) a tighter loop would buy.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {() => object|null} o.loadUpdater  electron-updater's autoUpdater, or null
 *        when it cannot be loaded. Called lazily; listeners are attached once.
 * @param {() => string} o.appVersion
 * @param {(status: object) => void} o.send  delivers a status to the page.
 * @param {(...args: any[]) => void} [o.log]
 * @param {(fn: () => void, ms: number) => any} [o.every]  the recheck timer.
 */
function createUpdateController({ loadUpdater, appVersion, send, log = console.error, every = setInterval }) {
  let updater = null;
  // What the updater is doing. Errors arrive on one 'error' event whatever caused
  // them, and this is how one is told from another: a failed install becomes
  // UPD-07, a failed download is reported even when nobody opened the dialog, and
  // a failed check is left to the check's own promise, which already reports it.
  /** @type {'idle'|'checking'|'downloading'|'installing'} */
  let phase = 'idle';
  // One check at a time, shared. electron-updater reuses its in-flight promise as
  // well, so without this a manual check landing on the background one would see
  // the same result handled twice.
  let inFlight = null;
  let downloading = null;   // {version, notes} while a download runs
  let staged = null;        // {version, notes} once one is on disk
  // Set by the manual check and read once, when the download lands: it is what
  // tells 'update-downloaded' whether a human is waiting on this. A background
  // download reports itself `silent` and only marks the menu item; a requested
  // one opens the dialog the user asked for.
  let promptOnDownloaded = false;
  let manualCheckRunning = false;
  let timer = null;

  // The last thing sent, replayed over the 'update-state' channel. Broadcasts are
  // fire-and-forget into a window that may not have finished loading: the startup
  // check begins at whenReady, while js/electron-bridge.js does not register its
  // listener until the whole module graph has evaluated. On the second and later
  // launches the installer is already in the pending cache, so 'update-downloaded'
  // fires a second or two in -- squarely inside that gap -- and the page never heard
  // that an update was staged, never offered the install, and re-checked from
  // scratch on the next launch. Forever.
  let lastStatus = null;
  const status = payload => {
    lastStatus = payload;
    send(payload);
  };

  function ensureUpdater() {
    if (updater) return updater;
    updater = loadUpdater();
    if (!updater) return null;

    // Said out loud rather than left to the default. With it on, an update that is
    // on disk installs silently when the app next quits normally, so "Later" in the
    // dialog means "next time you close the app" -- which the dialog now says.
    // Turning it off would leave a staged installer waiting on a button some
    // people never press.
    updater.autoInstallOnAppQuit = true;

    // Load-bearing: autoUpdater is an EventEmitter, so an 'error' with no listener
    // would be an uncaught exception, and being offline at launch would take down an
    // app that was working fine without ever having updated.
    updater.on('error', err => {
      log('[updater]', err?.message ?? err);
      if (phase === 'installing') {
        // install() refuses by dispatching an error rather than by throwing -- the
        // installer is gone from the cache, or could not be started. Whatever was
        // staged is not installable any more, so it stops being offered: the next
        // check fetches it again.
        phase = 'idle';
        staged = null;
        status({ state: 'error', phase: 'install', ...UpdateErrors.INSTALL });
      } else if (phase === 'downloading') {
        // Reported even when nobody is watching: the page marks the menu item, so a
        // download that fails on every launch is not a silent loop.
        phase = 'idle';
        const version = downloading?.version ?? null;
        downloading = null;
        const silent = !promptOnDownloaded;
        promptOnDownloaded = false;
        status({ state: 'error', phase: 'download', version, silent, ...classifyUpdateError(err) });
      }
      // A failed check rejects the check's promise as well, and that is where it is
      // reported -- once, by the manual path, and not at all by the background one.
    });

    updater.on('download-progress', ({ percent }) => {
      status({ state: 'downloading', version: downloading?.version ?? null, percent: Math.round(percent) });
    });

    updater.on('update-downloaded', info => {
      const notes = releaseNotesText(info.releaseNotes)
        ?? (downloading?.version === info.version ? downloading.notes : null);
      staged = { version: info.version, notes };
      downloading = null;
      phase = 'idle';
      status({ state: 'downloaded', version: info.version, notes, silent: !promptOnDownloaded });
      promptOnDownloaded = false;
    });

    return updater;
  }

  // electron-updater never empties its own pending directory, so the installer for
  // a version that has since been installed stays on disk at full size -- two of
  // them here, 100 MB each, for 2.0.0 and 2.5.0. It is only cleared on the way to
  // *replacing* it, and "there is nothing newer to install" never takes that path.
  // So do it here, the one moment the answer is known to be that -- and never while
  // something is staged, since that file is the one the next install needs.
  async function clearStaleCache(u) {
    if (staged) return;
    try {
      await u.downloadedUpdateHelper?.clear();
    } catch (err) {
      // Best-effort: a locked or missing cache is no reason to fail a check that
      // has already succeeded.
      log('[updater] could not clear pending cache:', err?.message ?? err);
    }
  }

  function runCheck(u) {
    if (inFlight) return inFlight;
    phase = 'checking';
    inFlight = (async () => {
      try {
        const result = await u.checkForUpdates();
        if (!result?.isUpdateAvailable) {
          phase = 'idle';
          if (result) await clearStaleCache(u);
          return result;
        }
        const version = result.updateInfo.version;
        // A cached installer can validate and land before this line runs; it has
        // already set the phase, and starting a "download" here would strand it.
        if (staged?.version !== version) {
          phase = 'downloading';
          downloading = { version, notes: releaseNotesText(result.updateInfo.releaseNotes) };
        } else {
          phase = 'idle';
        }
        // autoDownload is on, so the fetch is already running. Its failure arrives
        // on 'error' above; this promise rejects with the same error, and nothing
        // else awaits it, so left alone it would be an unhandled rejection.
        result.downloadPromise?.catch?.(() => {});
        return result;
      } catch (err) {
        phase = 'idle';
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  // The startup check and every recheck after it. Quiet by construction: a failure
  // here is not news (being offline at launch is ordinary), and success only ever
  // marks the menu item.
  async function backgroundCheck() {
    // Nothing to do while busy, and nothing worth fetching once an update is on
    // disk -- it installs at the next quit either way.
    if (phase !== 'idle' || staged) return;
    const u = ensureUpdater();
    if (!u) return;
    try {
      await runCheck(u);
    } catch {
      // See above: the background check never reports a failed check.
    }
  }

  return {
    UpdateErrors,

    /** The startup check, then one every RECHECK_INTERVAL_MS. */
    start() {
      void backgroundCheck();
      if (!timer) {
        timer = every(() => void backgroundCheck(), RECHECK_INTERVAL_MS);
        // The timer must not keep a quitting app alive.
        timer?.unref?.();
      }
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    /** The header's "Check for Updates": one click, one visible answer. */
    async checkManually() {
      // checkForUpdates() reuses one in-flight promise internally, so a second click
      // would resolve against the first check's result. Refusing re-entry keeps one
      // click to one answer.
      if (manualCheckRunning) return;
      manualCheckRunning = true;
      try {
        const u = ensureUpdater();
        if (!u) {
          const unavailable = new Error('The updater module failed to load.');
          unavailable.code = 'UPDATER_UNAVAILABLE';
          throw unavailable;
        }
        // Already on disk: the answer is the install, not another check.
        if (staged) {
          status({ state: 'downloaded', ...staged, silent: false });
          return;
        }
        // A background download is under way: show it rather than start another,
        // and open the dialog when it lands.
        if (phase === 'downloading' && downloading) {
          promptOnDownloaded = true;
          status({ state: 'available', ...downloading });
          return;
        }

        status({ state: 'checking' });
        const result = await runCheck(u);
        // isUpdateAvailable is the provider's own verdict. The manifest names the
        // latest version whether or not it is newer, so comparing version strings
        // here would reimplement the comparison electron-updater has already done.
        if (!result?.isUpdateAvailable) {
          status({ state: 'up-to-date', version: appVersion() });
          return;
        }
        // A cached installer may have landed while the check resolved -- silently,
        // since nobody had asked yet. The person clicking is asking now.
        if (staged?.version === result.updateInfo.version) {
          status({ state: 'downloaded', ...staged, silent: false });
          return;
        }
        promptOnDownloaded = true;
        status({ state: 'available', ...downloading });
      } catch (err) {
        promptOnDownloaded = false;
        // The whole error goes here, where a developer can read it; only the code and
        // the sentence cross to the window.
        log('[updater] manual check failed:', err);
        status({ state: 'error', phase: 'check', ...classifyUpdateError(err) });
      } finally {
        manualCheckRunning = false;
      }
    },

    // quitAndInstall closes the window on the way out, which runs the page's
    // beforeunload backup save exactly as an ordinary quit does.
    install() {
      const u = ensureUpdater();
      if (!u) {
        status({ state: 'error', phase: 'install', ...UpdateErrors.UNSUPPORTED });
        return;
      }
      // Nothing downloaded, so nothing to install -- quitAndInstall() would answer
      // with an error. Replaying the last status puts the dialog back to the truth.
      if (!staged) {
        if (lastStatus) send(lastStatus);
        return;
      }
      // Already on its way out. A second quitAndInstall() is ignored by the updater
      // without a word, which is exactly the no-op button this guards against.
      if (phase === 'installing') return;
      phase = 'installing';
      try {
        u.quitAndInstall();
      } catch (err) {
        log('[updater] install failed:', err);
        phase = 'idle';
        staged = null;
        status({ state: 'error', phase: 'install', ...UpdateErrors.INSTALL });
      }
    },

    /** The last status sent, for a page that was not listening yet. */
    lastStatus: () => lastStatus,
  };
}

module.exports = {
  UpdateErrors,
  classifyUpdateError,
  releaseNotesText,
  createUpdateController,
  RECHECK_INTERVAL_MS,
};
