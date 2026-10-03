import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { UpdateMenuLabel, stagedUpdateView, updateView } from '../js/update-view.js';

// The software update, both halves without Electron: the main-process controller
// driven through a fake electron-updater, and the table that turns each status it
// sends into the dialog's words. The bugs this feature has had were all sequencing
// -- an install offered with nothing staged, a refusal that said nothing, a
// staged update the page never heard about -- and a packaged build is the one
// place nobody can step through them.

const require = createRequire(import.meta.url);
const {
  createUpdateController, classifyUpdateError, releaseNotesText, UpdateErrors, RECHECK_INTERVAL_MS,
} = require('../electron/updates.cjs');

const flush = () => new Promise(resolve => setImmediate(resolve));

/** A stand-in for electron-updater's autoUpdater: `check` decides each check. */
function fakeUpdater(check) {
  const u = new EventEmitter();
  u.checks = 0;
  u.installs = 0;
  u.cleared = 0;
  u.checkForUpdates = async () => { u.checks++; return check(u); };
  u.quitAndInstall = () => { u.installs++; u.onInstall?.(u); };
  u.downloadedUpdateHelper = { clear: async () => { u.cleared++; } };
  return u;
}

function controller(updater) {
  const sent = [];
  let tick = null;
  let interval = null;
  const c = createUpdateController({
    loadUpdater: () => updater,
    appVersion: () => '3.1.2',
    send: s => sent.push(s),
    log: () => {},
    every: (fn, ms) => { tick = fn; interval = ms; return { unref() {} }; },
  });
  return { c, sent, tick: () => tick?.(), interval: () => interval, last: () => sent.at(-1) };
}

const noUpdate = () => ({ isUpdateAvailable: false, updateInfo: { version: '3.1.2' } });
const updateTo = (version, releaseNotes = null) => () => ({
  isUpdateAvailable: true,
  updateInfo: { version, releaseNotes },
  // A download still running; it is finished by emitting 'update-downloaded'.
  downloadPromise: new Promise(() => {}),
});

// ── The bug that started this ────────────────────────────────────

test('install with nothing downloaded never reaches quitAndInstall', async () => {
  const u = fakeUpdater(noUpdate);
  const h = controller(u);
  await h.c.checkManually();
  assert.deepEqual(h.last(), { state: 'up-to-date', version: '3.1.2' });

  h.c.install();
  assert.equal(u.installs, 0, 'quitAndInstall with nothing staged is what produced UPD-99');
  // The dialog is put back to the truth rather than shown an error.
  assert.deepEqual(h.last(), { state: 'up-to-date', version: '3.1.2' });
});

test('"Up to Date" offers no install, and only a staged update does', () => {
  assert.equal(updateView({ state: 'up-to-date', version: '3.1.2' }).canInstall, undefined);
  for (const state of ['checking', 'available', 'downloading', 'error']) {
    assert.ok(!updateView({ state, version: '3.2.0', percent: 10, message: 'x' }).canInstall, state);
  }
  assert.equal(updateView({ state: 'downloaded', version: '3.2.0' }).canInstall, true);
});

// ── Checks ───────────────────────────────────────────────────────

test('a manual check with nothing newer says so and clears the stale installer cache', async () => {
  const u = fakeUpdater(noUpdate);
  const h = controller(u);
  await h.c.checkManually();
  assert.deepEqual(h.sent.map(s => s.state), ['checking', 'up-to-date']);
  assert.equal(u.cleared, 1);
});

test('a manual check downloads, then opens the dialog with the release notes', async () => {
  const u = fakeUpdater(updateTo('3.2.0', '<h2>Fixes</h2><ul><li>One</li><li>Two</li></ul>'));
  const h = controller(u);
  await h.c.checkManually();
  assert.deepEqual(h.last(), { state: 'available', version: '3.2.0', notes: 'Fixes\n• One\n• Two' });

  u.emit('download-progress', { percent: 41.6 });
  assert.deepEqual(h.last(), { state: 'downloading', version: '3.2.0', percent: 42 });

  u.emit('update-downloaded', { version: '3.2.0' });
  assert.deepEqual(h.last(), { state: 'downloaded', version: '3.2.0', notes: 'Fixes\n• One\n• Two', silent: false });

  h.c.install();
  assert.equal(u.installs, 1);
});

test('the background check stages an update silently, and the next click offers it without checking', async () => {
  const u = fakeUpdater(updateTo('3.2.0'));
  const h = controller(u);
  h.c.start();
  await flush();
  u.emit('update-downloaded', { version: '3.2.0' });
  assert.equal(h.last().silent, true, 'a background download must not open the dialog');

  await h.c.checkManually();
  assert.equal(u.checks, 1, 'a staged update is the answer; checking again is not');
  assert.deepEqual(h.last(), { state: 'downloaded', version: '3.2.0', notes: null, silent: false });
});

test('a click during a background download joins it instead of starting another', async () => {
  const u = fakeUpdater(updateTo('3.2.0'));
  const h = controller(u);
  h.c.start();
  await flush();

  await h.c.checkManually();
  assert.equal(u.checks, 1);
  assert.equal(h.last().state, 'available');

  u.emit('update-downloaded', { version: '3.2.0' });
  assert.equal(h.last().silent, false, 'the person who clicked is waiting on this one');
});

test('a cached installer that lands while the check resolves still opens the dialog', async () => {
  const u = fakeUpdater(u => {
    // electron-updater validates a cached installer and announces it quickly; here
    // it lands before the check's own continuation has run.
    u.emit('update-downloaded', { version: '3.2.0' });
    return updateTo('3.2.0')();
  });
  const h = controller(u);
  await h.c.checkManually();
  assert.deepEqual(h.last(), { state: 'downloaded', version: '3.2.0', notes: null, silent: false });
});

test('a failed manual check is reported once, though the updater announces it twice', async () => {
  const u = fakeUpdater(u => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
    u.emit('error', err);   // electron-updater emits and rejects, both
    throw err;
  });
  const h = controller(u);
  await h.c.checkManually();
  const errors = h.sent.filter(s => s.state === 'error');
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0], { state: 'error', phase: 'check', ...UpdateErrors.OFFLINE });
});

test('a failed background check says nothing', async () => {
  const u = fakeUpdater(() => { throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' }); });
  const h = controller(u);
  h.c.start();
  await flush();
  assert.deepEqual(h.sent, []);
});

test('a second click while a check runs gets no second answer', async () => {
  let release;
  const u = fakeUpdater(() => new Promise(resolve => { release = () => resolve(noUpdate()); }));
  const h = controller(u);
  const first = h.c.checkManually();
  await h.c.checkManually();
  release();
  await first;
  assert.equal(u.checks, 1);
  assert.deepEqual(h.sent.map(s => s.state), ['checking', 'up-to-date']);
});

// ── Downloads that fail ──────────────────────────────────────────

test('a background download that fails is reported for the menu, classified', async () => {
  const err = new Error('sha512 checksum mismatch');
  const u = fakeUpdater(() => ({
    isUpdateAvailable: true,
    updateInfo: { version: '3.2.0' },
    // Rejects as electron-updater's does; left unhandled it would fail this test.
    downloadPromise: Promise.reject(err),
  }));
  const h = controller(u);
  h.c.start();
  await flush();
  u.emit('error', err);
  assert.deepEqual(h.last(), { state: 'error', phase: 'download', version: '3.2.0', silent: true, ...UpdateErrors.CORRUPT });
  assert.equal(updateView(h.last()).title, 'Download Failed');

  // And the next check is a real one, not refused as "busy".
  await h.c.checkManually();
  assert.equal(u.checks, 2);
});

// ── Installs that fail ───────────────────────────────────────────

test('an install the updater refuses becomes UPD-07, and the update stops being offered', async () => {
  const u = fakeUpdater(updateTo('3.2.0'));
  // BaseUpdater.install() refuses by dispatching an error, synchronously, not by throwing.
  u.onInstall = u => u.emit('error', new Error("No update filepath provided, can't quit and install"));
  const h = controller(u);
  await h.c.checkManually();
  u.emit('update-downloaded', { version: '3.2.0' });

  h.c.install();
  assert.deepEqual(h.last(), { state: 'error', phase: 'install', ...UpdateErrors.INSTALL });
  assert.equal(updateView(h.last()).title, 'Install Failed');

  h.c.install();
  assert.equal(u.installs, 1, 'nothing is staged any more, so there is nothing to retry into');

  await h.c.checkManually();
  assert.equal(u.checks, 2, 'the next click fetches it again');
});

test('an install that throws becomes UPD-07 too', async () => {
  const u = fakeUpdater(updateTo('3.2.0'));
  u.onInstall = () => { throw new Error('spawn EACCES'); };
  const h = controller(u);
  await h.c.checkManually();
  u.emit('update-downloaded', { version: '3.2.0' });
  h.c.install();
  assert.equal(h.last().code, 'UPD-07');
});

test('a second install click while the first is on its way out does nothing', async () => {
  const u = fakeUpdater(updateTo('3.2.0'));
  const h = controller(u);
  await h.c.checkManually();
  u.emit('update-downloaded', { version: '3.2.0' });
  h.c.install();
  h.c.install();
  assert.equal(u.installs, 1);
});

test('a staged update installs on quit, on purpose', () => {
  const u = fakeUpdater(noUpdate);
  u.autoInstallOnAppQuit = false;
  const h = controller(u);
  h.c.start();
  assert.equal(u.autoInstallOnAppQuit, true);
  // ... and the dialog says so, which is what makes "Later" a choice.
  assert.match(stagedUpdateView({ version: '3.2.0' }).msg, /next time you close/);
});

// ── Rechecks ─────────────────────────────────────────────────────

test('a long session rechecks on a timer, and stops once something is staged', async () => {
  let next = noUpdate;
  const u = fakeUpdater(() => next());
  const h = controller(u);
  h.c.start();
  await flush();
  assert.equal(h.interval(), RECHECK_INTERVAL_MS);
  assert.equal(u.checks, 1);

  next = updateTo('3.2.0');
  h.tick();
  await flush();
  assert.equal(u.checks, 2);
  u.emit('update-downloaded', { version: '3.2.0' });

  h.tick();
  await flush();
  assert.equal(u.checks, 2, 'an update on disk installs at the next quit; there is nothing to fetch');
});

// ── Release notes ────────────────────────────────────────────────

test('release notes become plain text', () => {
  assert.equal(releaseNotesText(null), null);
  assert.equal(releaseNotesText(''), null);
  assert.equal(releaseNotesText('<p>   </p>'), null);
  assert.equal(
    releaseNotesText('<h2>What&#39;s new</h2>\n<ul>\n<li>Faster &amp; <code>smaller</code></li>\n<li>Fix &lt;tab&gt;</li>\n</ul>'),
    "What's new\n• Faster & smaller\n• Fix <tab>",
  );
  assert.equal(releaseNotesText('one<br>two<br/>three'), 'one\ntwo\nthree');
  assert.equal(releaseNotesText('<script>alert(1)</script><p>safe</p>'), 'safe');
  // The fullChangelog form.
  assert.equal(releaseNotesText([{ version: '3.2.0', note: '<p>A</p>' }, { version: '3.1.9', note: '<p>B</p>' }]), 'A\nB');
  const long = releaseNotesText(`<p>${'x'.repeat(5000)}</p>`);
  assert.equal(long.length, 4001);
  assert.ok(long.endsWith('…'));
});

// ── The dialog's words ───────────────────────────────────────────

test('the header label follows what the updater found', () => {
  assert.deepEqual(Object.keys(UpdateMenuLabel).sort(), ['failed', 'idle', 'staged']);
});

test('download progress keeps the notes "Update Available" showed', () => {
  assert.equal(updateView({ state: 'downloading', version: '3.2.0', percent: 5 }).notes, undefined);
  assert.equal(updateView({ state: 'checking' }).notes, null);
  assert.equal(updateView({ state: 'available', version: '3.2.0', notes: 'n' }).notes, 'n');
  assert.equal(updateView({ state: 'nonsense' }), null);
});

// ── Codes ────────────────────────────────────────────────────────

test('every update error code is documented', () => {
  const doc = fs.readFileSync(new URL('../docs/update-error-codes.md', import.meta.url), 'utf8');
  const codes = Object.values(UpdateErrors).map(e => e.code);
  assert.equal(new Set(codes).size, codes.length, 'codes are unique');
  for (const code of codes) assert.match(doc, new RegExp(`\\| \`${code}\` \\|`), code);
});

test('errors are classified by what the reader can do about them', () => {
  assert.equal(classifyUpdateError({ code: 'ECONNRESET' }).code, 'UPD-01');
  assert.equal(classifyUpdateError(new Error('HttpError: 404 Not Found')).code, 'UPD-02');
  assert.equal(classifyUpdateError({ statusCode: 429, message: '' }).code, 'UPD-03');
  assert.equal(classifyUpdateError({ statusCode: 503, message: '' }).code, 'UPD-04');
  assert.equal(classifyUpdateError(new Error('sha512 checksum mismatch')).code, 'UPD-05');
  assert.equal(classifyUpdateError({ code: 'UPDATER_UNAVAILABLE' }).code, 'UPD-06');
  assert.equal(classifyUpdateError(new Error('who knows')).code, 'UPD-99');
});
