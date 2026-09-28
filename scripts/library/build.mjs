#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  BUILD THE LIBRARY
// ══════════════════════════════════════════════════════════════════
// Reads a checkout of the library repository, analyses every machine in it
// with the app's own engine, and writes what the app and the website read:
//
//   <out>/index.json              the catalogue (js/library/index-model.js)
//   <out>/machines/**             the published entry files, verbatim
//   <out>/art/<id>/<kind>.svg     each entry's pictures (analyze.js cardArt)
//   <out>/**.html + assets/       the website (scripts/library/site.mjs)
//
//   node --conditions=browser --conditions=development scripts/library/build.mjs \
//     --library ../automata-library --out ../automata-library/_site
//
// Flags:
//   --check            analyse and report only; exit 1 if any entry fails
//   --report FILE      write the report as Markdown (for a PR comment)
//   --commit SHA       the library commit the index describes (pins downloads)
//   --site URL         the site's own address, for absolute links
//   --no-site          write the data only
//   (programmatic only) cache: a Map kept between builds, so an unchanged
//                      file is not analysed again
//   --changed-since REF  judge only the files changed since REF (a pull request's
//                      base); every entry is still analysed, since a new one can
//                      make an old one a duplicate or a remix target
//
// Library layout:
//   machines/<anything>/<name>.automaton   entries; the id is the path under
//                                          machines/ without the extension
//   collections/<id>.json                  { title, blurb, curator, entries: [id] }
//   library.config.json                    optional: { site, repo, maintainers, featured }

import './env.mjs';
import { APP_VERSION } from './env.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeDocument } from '../../js/library/analyze.js';
import { contentHash } from '../../js/library/hash.js';
import { INDEX_FORMAT, INDEX_VERSION, LIBRARY_REPO, LIBRARY_SITE_URL, isLibraryId } from '../../js/library/config.js';
import { normalizeIndex } from '../../js/library/index-model.js';
import { writeSite } from './site.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Arguments ─────────────────────────────────────────────────────

export function parseArgs(argv) {
  const a = { library: process.cwd(), out: null, check: false, report: null, commit: '', site: null, noSite: false, changedSince: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--library') a.library = next();
    else if (k === '--out') a.out = next();
    else if (k === '--check') a.check = true;
    else if (k === '--report') a.report = next();
    else if (k === '--commit') a.commit = next();
    else if (k === '--site') a.site = next();
    else if (k === '--no-site') a.noSite = true;
    else if (k === '--changed-since') a.changedSince = next();
    else throw new Error(`Unknown flag ${k}`);
  }
  a.library = resolve(a.library);
  a.out = resolve(a.out || join(a.library, '_site'));
  return a;
}

// ── Reading the checkout ──────────────────────────────────────────

async function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p, ext));
    else if (d.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

const posix = p => p.split(sep).join('/');

/**
 * Whether `root` is the top of a git repository of its own. A library directory
 * that merely sits *inside* one — the emulator's .library-dev/, inside the app's
 * checkout — would otherwise read its dates out of the wrong repository, one
 * slow `git log` per file.
 */
function isOwnRepo(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return resolve(top).toLowerCase() === resolve(root).toLowerCase();
  } catch {
    return false;
  }
}

/** First and last commit dates, and how many commits touched the file. Null outside a git checkout. */
function gitHistory(root, rel, ownRepo = true) {
  if (!ownRepo) return null;
  try {
    const log = execFileSync('git', ['-C', root, 'log', '--follow', '--format=%aI', '--', rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean);
    if (!log.length) return null;
    return { added: log[log.length - 1], updated: log[0], version: log.length };
  } catch {
    return null;
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// ── Analysis ──────────────────────────────────────────────────────

/**
 * Every entry in the checkout, analysed. Returns the index (not yet
 * normalised), the per-file results for the report, and the pictures and code
 * to write.
 */
export async function buildLibrary(opts) {
  const root = opts.library;
  const config = await readJson(join(root, 'library.config.json'), {});
  const repo = config.repo || LIBRARY_REPO;
  const site = (opts.site || config.site || LIBRARY_SITE_URL).replace(/\/?$/, '/');

  const ownRepo = isOwnRepo(root);
  const results = [];
  const entries = [];
  const artifacts = [];   // { path, text } to write under out/

  // ── machines ──
  for (const file of await walk(join(root, 'machines'), '.automaton')) {
    const rel = posix(relative(root, file));
    const id = rel.replace(/^machines\//, '').replace(/\.automaton$/, '');
    const r = { file: rel, id, errors: [], warnings: [], badges: [] };
    results.push(r);
    if (!isLibraryId(id)) { r.errors.push(`"${id}" is not a usable id — use letters, digits, dots, dashes and slashes.`); continue; }
    const text = await readFile(file, 'utf8');
    let doc;
    try { doc = JSON.parse(text); } catch (e) { r.errors.push(`Not JSON: ${e.message}`); continue; }
    // A long-running caller (the local emulator) keeps analyses by content
    // hash, so a rebuild re-runs only the files that changed — BB(5) alone is
    // 47 million steps. The cached result is read, never written to.
    const key = `${contentHash(text)}:${opts.behaviourBudget ?? ''}`;
    const a = opts.cache?.get(key) || analyzeDocument(doc, { text, pictures: true, behaviourBudget: opts.behaviourBudget });
    opts.cache?.set(key, a);
    r.errors.push(...a.errors);
    r.warnings.push(...a.warnings);
    if (!a.facts) continue;
    r.badges = a.facts.badges.map(b => b.id);
    const hist = gitHistory(root, rel, ownRepo);
    const f = a.facts;
    const entry = {
      id, path: rel,
      title: f.title, blurb: f.blurb, machine: f.machine, category: f.category, languageClass: f.languageClass,
      tags: f.tags, author: f.author, license: f.license, difficulty: f.difficulty, chapter: f.chapter, standard: f.standard,
      added: hist?.added || '', updated: hist?.updated || '', version: hist?.version || 1,
      hash: contentHash(text), bytes: Buffer.byteLength(text),
      // Copied: with the emulator's cache, `a` outlives this build, and what
      // this build writes onto an entry must not land in the next one's.
      stats: f.stats, badges: [...f.badges], behaviour: f.behaviour, fingerprint: f.fingerprint, dfa: f.dfa, sketch: f.sketch, tests: f.tests,
      forkOf: f.forkOf, remixes: [], collections: [], art: []
    };
    for (const v of a.art || []) {
      const path = `art/${id}/${v.kind}.svg`;
      entry.art.push({ kind: v.kind, path });
      artifacts.push({ path, text: v.svg });
    }
    entries.push(entry);
  }

  const byId = new Map(entries.map(e => [e.id, e]));
  const resultOf = id => results.find(r => r.id === id);

  // ── remixes ──
  for (const e of entries) {
    if (!e.forkOf) continue;
    const parent = byId.get(e.forkOf);
    if (!parent) { resultOf(e.id).errors.push(`It says it is a remix of "${e.forkOf}", which is not in the library.`); continue; }
    // Harmless, and not worth dropping an entry over: the link is ignored.
    if (parent.id === e.id) { resultOf(e.id).warnings.push('It names itself as what it was remixed from; that is ignored.'); e.forkOf = null; continue; }
    parent.remixes.push(e.id);
  }

  // ── the same language, twice ──
  // The first to arrive keeps the language; later ones point at it. Not an
  // error: a different construction for a known language is often the point.
  const byPrint = new Map();
  for (const e of [...entries].sort((x, y) => (x.added || '~').localeCompare(y.added || '~') || x.id.localeCompare(y.id))) {
    if (!e.fingerprint) continue;
    const first = byPrint.get(e.fingerprint);
    if (!first) { byPrint.set(e.fingerprint, e); continue; }
    if (JSON.stringify(first.dfa) !== JSON.stringify(e.dfa)) continue;
    e.duplicateOf = first.id;
    resultOf(e.id).warnings.push(`Recognises the same language as ${first.id}.`);
  }

  // ── collections ──
  const collections = [];
  for (const file of await walk(join(root, 'collections'), '.json')) {
    const id = posix(relative(join(root, 'collections'), file)).replace(/\.json$/, '');
    const c = await readJson(file, null);
    const r = { file: posix(relative(root, file)), id: `collection:${id}`, errors: [], warnings: [], badges: [] };
    results.push(r);
    if (!c || typeof c !== 'object') { r.errors.push('Not a JSON object.'); continue; }
    if (!isLibraryId(id)) { r.errors.push(`"${id}" is not a usable id.`); continue; }
    const listed = Array.isArray(c.entries) ? c.entries : [];
    const missing = listed.filter(x => !byId.has(x));
    if (missing.length) r.errors.push(`Lists entries that do not exist: ${missing.join(', ')}.`);
    const kept = listed.filter(x => byId.has(x));
    kept.forEach(x => byId.get(x).collections.push(id));
    collections.push({ id, title: String(c.title || id), blurb: String(c.blurb || ''), curator: String(c.curator || ''), entries: kept });
  }

  // ── what is published ──
  // An entry that failed a check is reported and left out, and so is every
  // reference to it — a collection, a remix list. On main
  // this never happens, because the PR check stops it; it is the build's own
  // guarantee that the index only ever lists what passed.
  const failed = new Set(results.filter(r => r.errors.length).map(r => r.id));
  const published = entries.filter(e => !failed.has(e.id));
  for (const e of published) e.remixes = e.remixes.filter(x => !failed.has(x));
  for (const c of collections) c.entries = c.entries.filter(x => !failed.has(x));
  const pubIds = new Set(published.map(e => e.id));
  const keepArtifact = a => {
    const m = /^art\/(.+)\/[a-z]+\.svg$/.exec(a.path);
    return !m || pubIds.has(m[1]);
  };

  const raw = {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    generated: new Date().toISOString(),
    engine: APP_VERSION,
    repo,
    commit: opts.commit || '',
    site,
    entries: published.sort((a, b) => a.id.localeCompare(b.id)),
    collections,
    // Collections the home page shows first, in this order.
    featured: (Array.isArray(config.featured) ? config.featured : []).filter(id => collections.some(c => c.id === id)),
    // Set only by the local emulator (dev-server.mjs): where its stand-in for
    // GitHub's issue form lives, so the app's Submit goes there instead.
    ...(opts.submit ? { submit: opts.submit } : {}),
    ...(opts.emulator ? { emulator: true } : {})
  };
  // Round-trip through the reader the app uses, so an index the app would
  // refuse cannot be published.
  normalizeIndex(JSON.parse(JSON.stringify(raw)));
  return { raw, results, artifacts: artifacts.filter(keepArtifact), config: { ...config, repo, site } };
}

// ── The report ────────────────────────────────────────────────────

export function reportMarkdown(results, { only = null } = {}) {
  const shown = only ? results.filter(r => only.has(r.file)) : results;
  const elsewhere = only ? results.filter(r => !only.has(r.file) && r.errors.length) : [];
  const failed = shown.filter(r => r.errors.length);
  const lines = [];
  lines.push(failed.length
    ? `### ❌ ${failed.length} of ${shown.length} file${shown.length === 1 ? '' : 's'} need changes`
    : `### ✅ ${shown.length} file${shown.length === 1 ? '' : 's'} checked`);
  lines.push('');
  for (const r of shown) {
    const mark = r.errors.length ? '❌' : r.warnings.length ? '⚠️' : '✅';
    lines.push(`**${mark} \`${r.file}\`**${r.badges.length ? ` — ${r.badges.map(b => `\`${b}\``).join(' ')}` : ''}`);
    for (const e of r.errors) lines.push(`- ❌ ${e}`);
    for (const w of r.warnings) lines.push(`- ⚠️ ${w}`);
    lines.push('');
  }
  if (elsewhere.length) {
    lines.push(`<details><summary>${elsewhere.length} file${elsewhere.length === 1 ? '' : 's'} this change does not touch also fail</summary>`, '');
    for (const r of elsewhere) lines.push(`- \`${r.file}\`: ${r.errors[0]}`);
    lines.push('', '</details>', '');
  }
  lines.push('<sub>Checked by the AutomataStudio engine — the same analysis the app runs before you submit.</sub>');
  return lines.join('\n');
}

/** Files under the library's content folders changed since `ref`. */
function changedFiles(root, ref) {
  try {
    return new Set(execFileSync('git', ['-C', root, 'diff', '--name-only', `${ref}...HEAD`, '--', 'machines', 'collections'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

// ── Writing it out ────────────────────────────────────────────────

async function put(out, path, text) {
  const file = join(out, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function writeLibrary(opts, built) {
  const { out, library } = opts;
  await mkdir(out, { recursive: true });
  await put(out, 'index.json', JSON.stringify(built.raw));
  for (const a of built.artifacts) await put(out, a.path, a.text);
  // Only what was published: a file that failed its check is not listed, and
  // is not served either.
  for (const e of built.raw.entries) {
    const dest = join(out, ...e.path.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(library, ...e.path.split('/')), dest);
  }
  // Pages serves Jekyll by default, which drops paths starting with an
  // underscore and rewrites nothing we want rewritten.
  await put(out, '.nojekyll', '');
  if (!opts.noSite) {
    const index = normalizeIndex(JSON.parse(JSON.stringify(built.raw)));
    await writeSite(out, index, built.config, {
      assets: { 'config.js': join(HERE, '../../js/library/config.js'), 'index-model.js': join(HERE, '../../js/library/index-model.js'), 'card-html.js': join(HERE, '../../js/library/card-html.js') }
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const built = await buildLibrary(opts);
  const only = opts.changedSince ? changedFiles(opts.library, opts.changedSince) : null;
  const md = reportMarkdown(built.results, { only });
  if (opts.report) await writeFile(resolve(opts.report), md);
  const failed = built.results.filter(r => r.errors.length && (!only || only.has(r.file)));
  for (const r of built.results) {
    const mark = r.errors.length ? 'FAIL' : r.warnings.length ? 'warn' : ' ok ';
    console.log(`${mark}  ${r.file}${r.badges.length ? `  [${r.badges.join(', ')}]` : ''}`);
    for (const e of r.errors) console.log(`        ✗ ${e}`);
    for (const w of r.warnings) console.log(`        ! ${w}`);
  }
  console.log(`\n${built.raw.entries.length} entries, ${built.raw.collections.length} collections — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!opts.check) {
    await writeLibrary(opts, built);
    console.log(`Wrote ${opts.out}`);
  }
  // The published build lists only what passed; a failing entry never reaches
  // main through the PR check, so a failure here is a check-mode answer.
  process.exitCode = failed.length && opts.check ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
