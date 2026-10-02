// ══════════════════════════════════════════════════════════════════
//  THE STAGE: A WINDOW IN A HEADLESS BROWSER, FILMED
// ══════════════════════════════════════════════════════════════════
// One page holds what a clip shows: a terminal window (xterm.js, drawn with
// its WebGL renderer so every glyph sits on the cell grid whatever font it
// fell back to, and box drawing is drawn rather than borrowed), and beside it,
// when a tape asks, a second pane holding a picture — the desktop app, filmed
// separately, or a file the command just wrote.
//
// Filming is polling: screenshot, compare with the last one, keep it if it
// differs. Durations come from the wall clock, so a clip runs at the speed
// the commands really ran, with long idle gaps cut down at the end.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import sharp from 'sharp';

import { AnimatedWebP } from './webp.mjs';

const require = createRequire(import.meta.url);
const asset = p => readFileSync(require.resolve(p), 'utf8');
const font = p => readFileSync(require.resolve(`@fontsource/jetbrains-mono/files/${p}`)).toString('base64');

// The CLI's own palette (cli/out.mjs), so the window and the output agree.
export const THEME = {
  background: '#0d1322', foreground: '#dfe8ff', cursor: '#7aa2ff', cursorAccent: '#0d1322',
  selectionBackground: '#26304a',
  black: '#131b2e', red: '#ff6b6b', green: '#69f0ae', yellow: '#ffd54f', blue: '#7aa2ff', magenta: '#f48fb1', cyan: '#4fc3f7', white: '#dfe8ff',
  brightBlack: '#4a5578', brightRed: '#ff8a80', brightGreen: '#b9f6ca', brightYellow: '#ffe57f', brightBlue: '#a5c0ff', brightMagenta: '#f8bbd0', brightCyan: '#80deea', brightWhite: '#ffffff'
};

// ── Finding a browser ─────────────────────────────────────────────
// Playwright's own build if it is installed; otherwise any Chromium already
// on the machine — a Playwright cache from another project, Chrome, Brave or
// Edge. AUTOMATA_MEDIA_BROWSER names one outright.

function candidates() {
  const out = [];
  if (process.env.AUTOMATA_MEDIA_BROWSER) out.push(process.env.AUTOMATA_MEDIA_BROWSER);
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    join(home, '.cache', 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright')
  ].filter(Boolean);
  for (const dir of caches) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      out.push(join(dir, b, 'chrome-win64', 'chrome.exe'), join(dir, b, 'chrome-win', 'chrome.exe'), join(dir, b, 'chrome-linux64', 'chrome'), join(dir, b, 'chrome-linux', 'chrome'),
        join(dir, b, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(dir, b, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of pf) {
    out.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  out.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  return out;
}

const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--font-render-hinting=none'];

export async function launchBrowser() {
  try { return await chromium.launch({ args: LAUNCH_ARGS }); } catch { /* not installed: look for one */ }
  for (const executablePath of candidates()) {
    if (!existsSync(executablePath)) continue;
    try { return await chromium.launch({ executablePath, args: LAUNCH_ARGS }); } catch { /* try the next */ }
  }
  throw new Error('No Chromium to record with. Run `npx playwright install chromium`, or set AUTOMATA_MEDIA_BROWSER to a Chrome, Brave or Edge executable.');
}

// ── The page ──────────────────────────────────────────────────────

function pageHtml({ cols, rows, fontSize, title, side }) {
  const faces = [
    ['latin-400-normal', 400], ['latin-700-normal', 700], ['latin-ext-400-normal', 400], ['greek-400-normal', 400]
  ].map(([f, w]) => `@font-face{font-family:"JBM";font-weight:${w};src:url(data:font/woff2;base64,${font(`jetbrains-mono-${f}.woff2`)}) format("woff2")}`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
${asset('@xterm/xterm/css/xterm.css')}
html,body{margin:0;background:transparent}
#stage{display:inline-flex;gap:16px;align-items:stretch;padding:1px}
/* A pane above or below takes the terminal's width, so a clip stays narrow enough
   to be shown near full size; beside it, it takes its own. */
#stage.below{flex-direction:column}
#stage.above{flex-direction:column-reverse}
.win{position:relative;background:${THEME.background};border:1px solid #26304a;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.bar{height:36px;flex:none;display:flex;align-items:center;padding:0 14px;background:#141c30;border-bottom:1px solid #222b42;position:relative}
.bar i{width:12px;height:12px;border-radius:50%;margin-right:8px;display:inline-block}
.bar i:nth-child(1){background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
.bar b{position:absolute;left:70px;right:70px;text-align:center;font:500 13px "JBM",monospace;color:#8894b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#term{padding:12px 16px 14px;position:relative}
.xterm-viewport{overflow:hidden!important;background:${THEME.background}!important}
#keys{position:absolute;right:16px;top:46px;display:flex;gap:6px;opacity:0;transition:opacity .12s}
#keys.on{opacity:1}
#keys kbd{font:600 13px "JBM",monospace;color:#0d1322;background:#dfe8ff;border-radius:6px;padding:4px 9px;box-shadow:0 2px 0 #8894b0}
.side{display:flex;flex-direction:column}
/* The picture is out of the flow, so whatever its size the window keeps the terminal's height. */
.side .pane{flex:1;position:relative;background:${side?.background || '#fbfaf7'}}
/* Fills the pane either way: an SVG in an <img> is only ever scaled down by max-width. */
.side img{position:absolute;inset:0;margin:auto;width:calc(100% - 32px);height:calc(100% - 32px);object-fit:contain}
/* Hidden keeps its place: a clip is one size from its first frame to its last. */
.side.hidden{visibility:hidden}
/* A bare pane holds a window that draws its own chrome — the desktop app. */
.side.bare .bar{display:none}
.side.bare img{width:100%;height:100%;object-fit:cover}
</style></head><body><div id="stage" class="${side?.position || 'right'}">
<div class="win" id="termwin"><div class="bar"><i></i><i></i><i></i><b id="title"></b></div><div id="term"></div><div id="keys"></div></div>
${side ? `<div class="win side${side.hidden ? ' hidden' : ''}${side.bare ? ' bare' : ''}" id="side"${side.width && (side.position || 'right') === 'right' ? ` style="width:${side.width}px"` : ''}><div class="bar"><i></i><i></i><i></i><b id="sidetitle"></b></div><div class="pane"${side.height ? ` style="flex:none;height:${side.height}px"` : ""}><img id="sideimg" alt=""></div></div>` : ''}
</div>
<script>${asset('@xterm/xterm/lib/xterm.js')}</script>
<script>${asset('@xterm/addon-webgl/lib/addon-webgl.js')}</script>
<script>
document.getElementById('title').textContent = ${JSON.stringify(title)};
${side ? `document.getElementById('sidetitle').textContent = ${JSON.stringify(side.title || '')};` : ''}
window.ready = (async () => {
  await document.fonts.load('400 ${fontSize}px JBM');
  await document.fonts.load('700 ${fontSize}px JBM');
  const term = new Terminal({
    cols: ${cols}, rows: ${rows}, fontSize: ${fontSize}, lineHeight: 1.18,
    fontFamily: '"JBM", "DejaVu Sans Mono", "Cascadia Mono", "Segoe UI Symbol", "Noto Sans Symbols 2", monospace',
    theme: ${JSON.stringify(THEME)}, cursorBlink: false, cursorStyle: 'bar', allowProposedApi: true,
    customGlyphs: true, scrollback: 0, convertEol: false, drawBoldTextInBrightColors: false
  });
  term.open(document.getElementById('term'));
  term.loadAddon(new WebglAddon.WebglAddon());
  term.focus();
  window.term = term;
})();
// A redaction blanks every row from the first row matching it to the last,
// right after the write that drew them is parsed — before xterm paints — so
// what it covers never reaches a frame, however often the program repaints it,
// and whichever of its edges a repaint has scrolled away. Blanked in place:
// nothing moves, so a program redrawing relative to the cursor is not thrown off.
window.redaction = null;
const redact = () => new Promise(r => {
  const b = term.buffer.active;
  let first = -1, last = -1;
  for (let y = 0; y < term.rows; y++) {
    if (window.redaction.test(b.getLine(b.viewportY + y)?.translateToString(true) || '')) { if (first < 0) first = y; last = y; }
  }
  if (last < 0) return r();
  let s = '\\x1b7';
  for (let y = first; y <= last; y++) s += '\\x1b[' + (y + 1) + ';1H\\x1b[2K';
  term.write(s + '\\x1b8', r);
});
window.write = d => new Promise(r => term.write(d, () => (window.redaction ? redact().then(r) : r())));
window.lines = () => {
  const b = term.buffer.active, out = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true));
  return out;
};
window.cursorLine = () => term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true);
let keyTimer = null;
window.showKey = label => {
  const k = document.getElementById('keys');
  k.innerHTML = '';
  for (const part of label.split(' ')) { const e = document.createElement('kbd'); e.textContent = part; k.appendChild(e); }
  k.classList.add('on');
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => k.classList.remove('on'), 900);
};
window.setSide = (src, title) => new Promise(r => {
  const s = document.getElementById('side');
  s.classList.remove('hidden');
  if (title !== undefined) document.getElementById('sidetitle').textContent = title;
  const img = document.getElementById('sideimg');
  if (img.src === src) return r();
  img.onload = () => img.decode().then(r, r);
  img.onerror = r;
  img.src = src;
});
window.hideSide = () => document.getElementById('side').classList.add('hidden');
</script></body></html>`;
}

/**
 * A stage for one clip. `side` is null, or `{ width, height, title,
 * background, hidden }` for a second pane.
 */
export class Stage {
  static async open(browser, { cols = 100, rows = 26, fontSize = 15, title = '', side = null, scale = 2 } = {}) {
    const s = new Stage();
    s.scale = scale;
    s.page = await browser.newPage({ viewport: { width: 2400, height: 1600 }, deviceScaleFactor: scale });
    await s.page.setContent(pageHtml({ cols, rows, fontSize, title, side }));
    await s.page.evaluate(() => window.ready);
    s.cdp = await s.page.context().newCDPSession(s.page);
    await s.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    s.frames = [];
    s.filming = false;
    s.hidden = false;
    s.lastHash = null;
    s.writes = Promise.resolve();
    await s.measure();
    return s;
  }

  async measure() {
    this.clip = await this.page.evaluate(() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return { x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
  }

  /** Terminal output, in order. Resolves once xterm has parsed it. */
  write(data) {
    this.writes = this.writes.then(() => this.page.evaluate(d => window.write(d), data)).catch(() => {});
    return this.writes;
  }

  lines() { return this.page.evaluate(() => window.lines()); }

  /** Blank the rows from the first matching `pattern` (a RegExp) to the last, from now on. */
  redact(pattern) { return this.page.evaluate(src => { window.redaction = new RegExp(src); }, pattern.source); }
  cursorLine() { return this.page.evaluate(() => window.cursorLine()); }
  showKey(label) { return this.page.evaluate(l => window.showKey(l), label); }

  async setSide(png, title, type = 'image/png') {
    const src = `data:${type};base64,${png.toString('base64')}`;
    await this.page.evaluate(([s, t]) => window.setSide(s, t), [src, title]);
  }

  async setSideSvg(svgText, title) {
    const src = `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`;
    await this.page.evaluate(([s, t]) => window.setSide(s, t), [src, title]);
  }

  async shot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...this.clip, scale: this.scale }, fromSurface: true, captureBeyondViewport: false });
    return Buffer.from(data, 'base64');
  }

  /** One look at the stage: kept if it differs from the last kept frame. */
  async capture() {
    const png = await this.shot();
    const hash = createHash('sha1').update(png).digest('hex');
    const t = performance.now();
    if (hash === this.lastHash) return false;
    this.lastHash = hash;
    this.frames.push({ t, png, cut: this.cutPending, speed: this.speed ?? 1 });
    this.cutPending = false;
    return true;
  }

  /**
   * Film another page — the desktop app's window — into the side pane. It is
   * filmed on its own loop, at its own pace, and laid into the pane when the
   * clip is encoded: done in one loop, each tick waited on the app's picture,
   * then on the stage repainting with it, and a frame took half a second.
   */
  attachApp(page) {
    this.app = page;
    this.appFrames = [];
    this.appHash = null;
  }

  async captureApp() {
    // At CSS scale and as a JPEG: a full-density PNG of the app's window
    // took twice as long, and the pane shows it smaller than that anyway.
    const jpg = await this.app.screenshot({ type: 'jpeg', quality: 92, scale: 'css', animations: 'allow', caret: 'initial' });
    const hash = createHash('sha1').update(jpg).digest('hex');
    if (hash === this.appHash) return;
    this.appHash = hash;
    this.appFrames.push({ t: performance.now(), img: jpg });
  }

  /**
   * Play what follows `factor` times faster — for a computation worth seeing
   * move but not worth a minute of anyone's time. 1 is real time again.
   */
  setSpeed(factor) { this.speed = factor; }

  // Measured here rather than at open: the WebGL renderer settles its cell
  // size a frame or two after it loads, and a clip taken from the first
  // measurement cut the window's right edge off.
  async start() {
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await this.measure();
    if (this.app) {
      this.pane = await this.page.evaluate(() => {
        const r = document.querySelector('#side .pane').getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
    }
    this.filming = true;
    const every = (fn, ms) => (async () => {
      while (this.filming) {
        const t0 = performance.now();
        if (!this.hidden) await fn().catch(() => {});
        await new Promise(r => setTimeout(r, Math.max(5, ms - (performance.now() - t0))));
      }
    })();
    this.loop = Promise.all([every(() => this.capture(), 40), this.app ? every(() => this.captureApp(), 40) : null]);
  }

  async stop() {
    this.filming = false;
    await this.loop;
    await this.writes;
    if (!this.hidden && this.app) await this.captureApp().catch(() => {});
    if (!this.hidden) await this.capture();
    this.stoppedAt = performance.now();
  }

  /** Stop filming without stopping the world: what happens now is not shown. */
  hide() { this.hidden = true; }
  async show() {
    await this.writes;
    this.hidden = false;
    // The next frame follows a gap that is not real time on screen.
    this.cutPending = true;
    await this.capture();
  }

  /**
   * The clip. Each frame lasts until the next; an idle stretch longer than
   * `maxIdle` is cut to it, and the last frame holds for `hold`.
   *
   * Frames are filmed at 2× and written at 1.5× (`resize`), lossy at quality
   * 78: text stays crisp on a high-density screen and a busy clip stays near
   * a megabyte, where lossless came to three or four times that. Filming at
   * 1.5× directly is not an option — xterm's WebGL renderer spaces cells
   * wider than its canvas at a fractional density, and the last columns fall
   * off the window.
   *
   * A frame sped up past `minFrame` milliseconds is dropped and its time
   * given to the frame before it: a counter played ten times faster does not
   * need every tick, and browsers stretch very short frames anyway.
   */
  async encode({ maxIdle = 3000, hold = 3500, lossless = false, quality = 78, resize = 0.75, minFrame = 60 } = {}) {
    const enc = new AnimatedWebP({ lossless, quality });
    const width = this.frames.length ? Math.round((await sharp(this.frames[0].png).metadata()).width * resize) : 0;
    const frames = this.app ? this.mergeApp() : this.frames;
    const timed = frames.map((fr, i, all) => {
      const next = all[i + 1];
      const ms = next ? (next.cut ? 400 : (next.t - fr.t) / fr.speed) : 0;
      return { png: fr.png, app: fr.app, ms: Math.min(ms, maxIdle), fast: fr.speed > 1 };
    });
    const kept = [];
    for (const fr of timed) {
      const prev = kept.at(-1);
      if (prev && prev.fast && fr.fast && prev.ms < minFrame) { prev.ms += fr.ms; prev.png = fr.png; prev.app = fr.app; continue; }
      kept.push({ ...fr });
    }
    for (const fr of kept) {
      const whole = fr.app ? await this.composite(fr.png, fr.app) : fr.png;
      const png = resize === 1 ? whole : await sharp(whole).resize({ width, kernel: 'lanczos3' }).png().toBuffer();
      await enc.add(png, Math.max(20, fr.ms));
    }
    enc.hold(hold);
    return { file: enc.finish(), frames: enc.frames.length, width: enc.width, height: enc.height };
  }

  /**
   * The two films as one: a frame wherever either changed, each carrying the
   * stage's picture and the app's picture of that moment.
   */
  mergeApp() {
    const events = [
      ...this.frames.map(f => ({ ...f, kind: 'stage' })),
      ...this.appFrames.map(f => ({ t: f.t, img: f.img, kind: 'app' }))
    ].sort((a, b) => a.t - b.t);
    const out = [];
    let stage = null, app = null;
    for (const e of events) {
      if (e.kind === 'stage') stage = e; else app = e.img;
      if (!stage) continue;
      out.push({ t: e.t, png: stage.png, app, cut: e.kind === 'stage' && e.cut, speed: stage.speed });
    }
    return out;
  }

  /** The app's picture laid into the pane, in the window's rounded corners. */
  async composite(png, img) {
    this.paneCache ??= new Map();
    let fitted = this.paneCache.get(img);
    if (!fitted) {
      const k = this.scale, w = Math.round(this.pane.w * k), h = Math.round(this.pane.h * k), r = Math.round(11 * k);
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`);
      fitted = await sharp(img).resize(w, h, { fit: 'cover', kernel: 'lanczos3' }).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      this.paneCache.set(img, fitted);
    }
    const left = Math.round((this.pane.x - this.clip.x) * this.scale), top = Math.round((this.pane.y - this.clip.y) * this.scale);
    return sharp(png).composite([{ input: fitted, left, top }]).png().toBuffer();
  }

  async close() { await this.page.close(); }
}
