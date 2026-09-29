// library — search and fetch the machine library from the terminal.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { LIBRARY_SITE_URL, entryPageUrl } from '../../js/library/config.js';
import { entryById, normalizeIndex, queryLibrary } from '../../js/library/index-model.js';
import { CliError } from '../io.mjs';
import { c, print, printJson, table } from '../out.mjs';

/**
 * Where the library is: a URL (the published site, or any build of it), or a
 * local checkout — its `_site/` after `npm run library:build`, or a directory
 * holding index.json. `--library` wins, then $AUTOMATA_LIBRARY, then the
 * published site.
 */
function sourceOf(opts) {
  const where = opts.library || process.env.AUTOMATA_LIBRARY || LIBRARY_SITE_URL;
  if (/^https?:\/\//.test(where)) return { kind: 'url', base: where.replace(/\/?$/, '/') };
  const dir = resolve(where);
  const site = existsSync(join(dir, '_site', 'index.json')) ? join(dir, '_site') : dir;
  if (!existsSync(join(site, 'index.json'))) throw new CliError(`${where} has no index.json (nor _site/index.json). Build it with npm run library:build -- --library ${where}.`);
  return { kind: 'dir', site, root: dir };
}

async function fetchText(url) {
  let res;
  try { res = await fetch(url); } catch (e) { throw new CliError(`Could not reach ${url}: ${e.cause?.code || e.message}.`); }
  if (!res.ok) throw new CliError(`${url} answered ${res.status}. If the library is not published yet, point --library (or $AUTOMATA_LIBRARY) at a local checkout.`);
  return res.text();
}

async function loadIndex(src) {
  const text = src.kind === 'url' ? await fetchText(src.base + 'index.json') : readFileSync(join(src.site, 'index.json'), 'utf8');
  try { return normalizeIndex(JSON.parse(text)); } catch (e) { throw new CliError(e.message); }
}

async function entryText(src, index, entry) {
  if (src.kind === 'dir') {
    for (const base of [src.root, src.site]) {
      const p = join(base, entry.path);
      if (existsSync(p)) return readFileSync(p, 'utf8');
    }
    throw new CliError(`${entry.path} is not in ${src.root}.`);
  }
  const urls = [];
  if (/^[0-9a-f]{7,40}$/.test(index.commit || '') && index.repo) urls.push(`https://cdn.jsdelivr.net/gh/${index.repo}@${index.commit}/${entry.path}`);
  urls.push(src.base + entry.path.split('/').map(encodeURIComponent).join('/'));
  let last;
  for (const u of urls) { try { return await fetchText(u); } catch (e) { last = e; } }
  throw last;
}

const library = {
  usage: `automata library search [query]
       automata library show <id>
       automata library pull <id> [-o file]

The query is the Library view's: words, plus type:DFA, family:tm, tag:…,
by:login, is:minimal, level:intro, states:<5, accepts:0110, rejects:…

  --library URL|DIR   another build of the library, or a local checkout
                      (also $AUTOMATA_LIBRARY)
  --sort KEY          relevance, added, updated, states, title
  --limit N           at most N results (default 30)
  --json`,
  options: {
    library: { type: 'string' }, sort: { type: 'string' }, limit: { type: 'string' }, output: { type: 'string', short: 'o' }
  },
  async run({ args, opts }) {
    const [sub, ...rest] = args;
    const src = sourceOf(opts);
    const index = await loadIndex(src);
    if (!sub || sub === 'search') {
      const found = queryLibrary(index, rest.join(' '), { sort: opts.sort || 'relevance' }).slice(0, Number(opts.limit ?? 30));
      if (opts.json) { printJson(found.map(e => ({ id: e.id, title: e.title, machine: e.machine, states: e.stats.states, tags: e.tags, author: e.author.login }))); return 0; }
      if (!found.length) { print(c.yellow('Nothing matches.')); return 1; }
      print(table(found.map(e => [e.id, e.title, c.dim(e.machine), c.dim(`${e.stats.states} states`), c.dim(e.tags.slice(0, 4).join(' '))])));
      return 0;
    }
    const id = rest[0];
    if (!id) throw new CliError(`library ${sub} takes an entry id.`);
    const entry = entryById(index, id);
    if (!entry) throw new CliError(`No entry "${id}". Try automata library search.`);
    if (sub === 'show') {
      if (opts.json) { printJson(entry); return 0; }
      const rows = [
        ['id', entry.id], ['title', entry.title], ['machine', `${entry.machine}${entry.languageClass ? ` — ${entry.languageClass}` : ''}`],
        ['size', `${entry.stats.states} states, ${entry.stats.transitions} transitions, Σ = {${entry.stats.sigma.join(', ')}}`],
        ['author', entry.author.name || entry.author.login || '—'], ['license', entry.license || '—'],
        ['badges', entry.badges.map(b => b.id).join(', ') || '—'], ['tags', entry.tags.join(', ') || '—'],
        ['added', entry.added || '—'], ['page', entryPageUrl(entry.id, index.site || LIBRARY_SITE_URL)]
      ];
      if (entry.standard) rows.push(['standard', entry.standard]);
      print(table(rows.map(([k, v]) => [c.dim(k), v])));
      if (entry.blurb) print(`\n${entry.blurb}`);
      return 0;
    }
    if (sub === 'pull') {
      const text = await entryText(src, index, entry);
      const out = opts.output || `${entry.id.split('/').pop()}.automaton`;
      if (out === '-') process.stdout.write(text);
      else { writeFileSync(out, text); print(`${entry.title} → ${out}`); }
      return 0;
    }
    throw new CliError(`"${sub}" is not a library command: search, show or pull.`);
  }
};

export const commands = { library };
