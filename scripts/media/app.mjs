// ══════════════════════════════════════════════════════════════════
//  THE DESKTOP APP, ON CAMERA
// ══════════════════════════════════════════════════════════════════
// A tape that shows the app beside the terminal opens the real desktop app
// (Electron, on the built dist/) on a file in the tape's working directory,
// and films its window into the stage's side pane. Saving there writes that
// file, which is the whole point: `automata test --watch` in the terminal
// sees it change.
//
// The app gets a profile of its own, and it has to be set from inside the
// app: on Windows Electron finds the app-data directory through the shell,
// not %APPDATA%, so an environment variable isolates nothing there. A small
// boot script sets Electron's appData and userData paths to a temporary
// directory and then loads electron/main.cjs, whose migration into a legacy
// directory looks under the appData it is given. That keeps the recording
// out of the workspaces of whoever runs it, and keeps the single-instance
// lock (which is per userData) from handing the file to a copy they have
// open.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright-core';

const require = createRequire(import.meta.url);

function bootScript(root, profile) {
  const boot = join(profile, 'boot.cjs');
  writeFileSync(boot, `// Written by scripts/media/app.mjs for one recording.
const { app } = require('electron');
app.setPath('appData', ${JSON.stringify(profile)});
app.setPath('userData', ${JSON.stringify(join(profile, 'userData'))});
// main.cjs registers the library link scheme against argv[1] in a dev launch;
// naming the checkout keeps that registration the one \`electron .\` makes.
process.argv[1] = ${JSON.stringify(root)};
require(${JSON.stringify(join(root, 'electron', 'main.cjs'))});
`);
  return boot;
}

export async function openApp({ root, file, width = 1200, height = 760 }) {
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('The app tapes film the built app: run npm run build first.');
  const profile = mkdtempSync(join(tmpdir(), 'automata-tape-profile-'));
  mkdirSync(join(profile, 'userData'));
  const env = { ...process.env };
  delete env.ELECTRON_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [bootScript(root, profile), file], env, cwd: root });
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (!userData.startsWith(profile)) {
    await app.close().catch(() => {});
    throw new Error(`The app did not take the recording's profile (it is using ${userData}); not filming in someone's real one.`);
  }
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForLoadState('load');
  return { app, page, profile };
}

// ── What the viewer sees of the pointer ──────────────────────────
// Playwright's mouse leaves no cursor in a screenshot, so a clip of a click
// would show a state changing by itself. The page gets a drawn cursor that
// glides to where the real click is about to land, and a badge for keys.

const OVERLAY = `
(() => {
  if (document.getElementById('tape-cursor')) return;
  const css = document.createElement('style');
  css.textContent = \`
    #tape-cursor{position:fixed;left:-40px;top:-40px;width:22px;height:22px;z-index:2147483647;pointer-events:none;
      transition:left .9s cubic-bezier(.3,.7,.3,1),top .9s cubic-bezier(.3,.7,.3,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
    #tape-cursor .ring{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #7aa2ff;opacity:0;transform:scale(.4)}
    #tape-cursor .ring.go{animation:tape-ring .45s ease-out}
    @keyframes tape-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}
    #tape-keys{position:fixed;right:18px;bottom:18px;z-index:2147483647;pointer-events:none;display:flex;gap:6px;opacity:0;transition:opacity .15s}
    #tape-keys.on{opacity:1}
    #tape-keys kbd{font:600 15px ui-monospace,monospace;color:#0d1322;background:#dfe8ff;border-radius:7px;padding:5px 11px;box-shadow:0 2px 0 #8894b0}
  \`;
  document.head.appendChild(css);
  const cur = document.createElement('div');
  cur.id = 'tape-cursor';
  cur.innerHTML = '<div class="ring"></div><svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.3 L10.4 12.8 L16.5 12.8 Z" fill="#fff" stroke="#0d1322" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const keys = document.createElement('div');
  keys.id = 'tape-keys';
  document.body.appendChild(keys);
})()`;

export async function installOverlay(page) {
  await page.evaluate(OVERLAY);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Glide the drawn cursor to (x, y), in the window's CSS pixels. */
export async function cursorTo(page, x, y) {
  await page.evaluate(([x, y]) => {
    const c = document.getElementById('tape-cursor');
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  }, [x, y]);
  await sleep(1000);
}

async function ripple(page) {
  await page.evaluate(() => {
    const r = document.querySelector('#tape-cursor .ring');
    r.classList.remove('go');
    void r.offsetWidth;
    r.classList.add('go');
  });
}

/** Double-click a state, found by its name, the way a person would. */
export async function doubleClickState(page, name) {
  const id = await page.evaluate(n => window.App.states.find(s => String(s.name) === n)?.id, name);
  if (!id) throw new Error(`no state called ${name}`);
  const box = await page.locator(`[data-id="${id}"]`).first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cursorTo(page, x, y);
  await ripple(page);
  await page.mouse.dblclick(x, y);
  await sleep(300);
}

/** Press keys (Playwright's names, e.g. 'Control+S'), showing `label` on screen. */
export async function pressKeys(page, keys, label) {
  await page.evaluate(l => {
    const k = document.getElementById('tape-keys');
    k.innerHTML = l.split(' ').map(p => `<kbd>${p}</kbd>`).join('');
    k.classList.add('on');
    clearTimeout(window.__tapeKeys);
    window.__tapeKeys = setTimeout(() => k.classList.remove('on'), 1100);
  }, label);
  await page.keyboard.press(keys);
}

/** Close the app without its unsaved-changes prompt. */
export async function closeApp({ app }) {
  try { await app.evaluate(({ app: a }) => a.exit(0)); } catch { /* already closing */ }
  try { await app.close(); } catch { /* gone */ }
}
