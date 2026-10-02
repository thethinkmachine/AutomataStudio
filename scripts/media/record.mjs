// npm run media:cli [-- <tape> …] → docs/media/cli-<tape>.webp
//
// Re-films the command line's clips from the tapes in docs/media/tapes/, the
// way `npm run glyphs` and `npm run icons` regenerate what they own: run by
// hand after a change to what a command prints, output committed. A tape is a
// script, so a clip that has gone stale is one command away from fresh rather
// than a screen recording nobody can repeat.
//
//   npm run media:cli                 every tape, then the pictures
//   npm run media:cli -- play halts   just these
//   npm run media:cli -- --list       what there is
//   npm run media:cli -- --keep       leave the working directories behind
//   npm run media:cli -- --no-build   film the app from dist/ as it is
//
// Each tape runs in a fresh copy of examples/cli/, so it starts from the same
// files the guide tells a reader to cd into. Recording needs a Chromium (see
// stage.mjs) and bash (Git for Windows on Windows); the app tapes also build
// dist/ and open the desktop app, with a profile of their own.

import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Stage, launchBrowser } from './stage.mjs';
import { Terminal } from './terminal.mjs';
import { tapeContext } from './context.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TAPES = join(ROOT, 'docs', 'media', 'tapes');
const OUT = join(ROOT, 'docs', 'media');
const FIXTURES = join(ROOT, 'examples', 'cli');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const wanted = argv.filter(a => !a.startsWith('--'));

const all = readdirSync(TAPES).filter(f => f.endsWith('.tape.mjs')).map(f => f.replace(/\.tape\.mjs$/, '')).sort();
if (flags.has('--list')) {
  for (const name of all) {
    const tape = (await import(pathToFileURL(join(TAPES, `${name}.tape.mjs`)))).default;
    process.stdout.write(`${name.padEnd(12)} ${tape.about || ''}\n`);
  }
  process.stdout.write(`${'pictures'.padEnd(12)} the pictures the CLI draws itself: animate, --gif, sheet, svg\n`);
  process.exit(0);
}
const unknown = wanted.filter(w => w !== 'pictures' && !all.includes(w));
if (unknown.length) {
  process.stderr.write(`No tape called ${unknown.join(', ')}. Tapes: ${all.join(', ')}, pictures.\n`);
  process.exit(3);
}
const tapes = wanted.length ? wanted.filter(w => w !== 'pictures') : all;
const pictures = !wanted.length || wanted.includes('pictures');

const kb = n => `${(n / 1024).toFixed(0)} KB`;

async function film(name, browser) {
  const tape = (await import(pathToFileURL(join(TAPES, `${name}.tape.mjs`)))).default;
  // A tape that needs something this machine lacks (the mcp tape needs
  // Claude Code) says so, and the clip already committed stays.
  const missing = tape.available?.();
  if (missing) {
    process.stdout.write(`  ${name.padEnd(12)} skipped: ${missing}\n`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), `automata-tape-${name}-`));
  cpSync(FIXTURES, dir, { recursive: true });
  const cols = tape.cols ?? 100, rows = tape.rows ?? 26;
  const stage = await Stage.open(browser, { scale: tape.scale, cols, rows, fontSize: tape.fontSize ?? 15, title: tape.title ?? `automata ${name}`, side: tape.side ?? null });
  const term = new Terminal({ stage, dir, cols, rows, env: tape.env });
  const t = tapeContext({ term, stage, dir, root: ROOT });
  const t0 = performance.now();
  try {
    await term.ready();
    if (tape.setup) await tape.setup(t);
    if (tape.app) await t.openApp(tape.app);
    await term.clear();
    await stage.start();
    await tape.run(t);
    await stage.stop();
  } catch (e) {
    // What the tape was looking at when it gave up, for whoever has to find out why.
    const screen = join(tmpdir(), `automata-tape-${name}-screen.txt`);
    try {
      writeFileSync(screen, (await stage.lines()).join('\n'));
      e.message += `\n               the screen at the time: ${screen}`;
    } catch { /* the page is gone */ }
    throw e;
  } finally {
    stage.filming = false;
    await term.close();
    await t.closeApp?.();
  }
  const { file, frames, width, height } = await stage.encode({ maxIdle: tape.maxIdle, hold: tape.hold, quality: tape.quality });
  await stage.close();
  const out = join(OUT, `cli-${name}.webp`);
  writeFileSync(out, file);
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  process.stdout.write(`  ${name.padEnd(12)} ${frames} frames, ${width}×${height}, ${kb(file.length)}  (${secs}s)  → ${join('docs', 'media', basename(out))}\n`);
  if (flags.has('--keep')) process.stdout.write(`               working directory kept: ${dir}\n`);
  // Windows keeps the directory busy until the console host lets go of it; a
  // temporary directory left behind is not worth failing a clip over.
  else try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in the temp folder */ }
}

let failed = 0;
// The app tapes film the built app, and a dist/ from before the last change
// would film the app as it was. --no-build when it is known to be fresh.
if (!flags.has('--no-build')) {
  const needsApp = [];
  for (const name of tapes) if ((await import(pathToFileURL(join(TAPES, `${name}.tape.mjs`)))).default.app) needsApp.push(name);
  if (needsApp.length) {
    process.stdout.write(`Building dist/ for ${needsApp.join(', ')}…\n`);
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('npm run build', { cwd: ROOT, shell: true, stdio: 'ignore' });
    if (r.status !== 0) { process.stderr.write('npm run build failed; not filming the app.\n'); process.exit(1); }
  }
}
if (tapes.length) {
  const browser = await launchBrowser();
  process.stdout.write(`Filming with ${browser.browserType().name()} ${browser.version()}\n`);
  for (const name of tapes) {
    try { await film(name, browser); } catch (e) {
      failed++;
      process.stderr.write(`  ${name.padEnd(12)} failed: ${e.stack || e.message}\n`);
    }
  }
  await browser.close();
}
if (pictures) {
  const { drawPictures } = await import(pathToFileURL(join(TAPES, 'pictures.mjs')));
  try {
    for (const [file, size] of await drawPictures({ root: ROOT, fixtures: FIXTURES, out: OUT })) {
      process.stdout.write(`  ${'pictures'.padEnd(12)} ${kb(size).padStart(7)}  → docs/media/${file}\n`);
    }
  } catch (e) {
    failed++;
    process.stderr.write(`  pictures     failed: ${e.stack || e.message}\n`);
  }
}
// node-pty keeps a handle open on Windows after its process exits.
process.exit(failed ? 1 : 0);
