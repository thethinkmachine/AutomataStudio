#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  THE MACHINES DOCUMENTED ON THE BBCHALLENGE WIKI
// ══════════════════════════════════════════════════════════════════
// Reads the bbchallenge wiki (wiki.bbchallenge.org) and writes the machines it
// documents to scripts/library/data/bbchallenge.json, which seed.mjs turns into
// library entries. Generated once and committed, so that seeding needs no
// network and a change to the list is a diff someone can review.
//
//   node scripts/library/bbchallenge.mjs                      the live wiki
//   node scripts/library/bbchallenge.mjs --export dump.xml    a Special:Export dump
//   … [--out file] [--example-cap 12] [--api https://…/api.php]
//
// "Documented" means a machine the wiki names or singles out, never a list it
// enumerates:
//
//   page      a page about one machine — an infobox holding a code, or a
//             page titled by the code itself.
//   named     a table row with a code and a Name/Nickname column.
//   example   an unnamed code on a page that mentions few of them. A page
//             past --example-cap unnamed codes is a list of holdouts, and
//             is left out; the report names every page it skipped.
//
// What is copied is facts — the code, the name, where the wiki documents it.
// Never the wiki's prose: entries are CC-BY-4.0, and the blurb seed.mjs writes
// is its own. Every code is checked by the same reader the app uses, and a
// code it refuses (an S move, more than 26 states) is reported, not dropped
// silently.
//
// Import-free of the app except the reader, so it runs without the DOM stub.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStandardTM, StandardTMError } from '../../js/interop/standard-tm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = resolve(HERE, 'data/bbchallenge.json');
export const WIKI = 'https://wiki.bbchallenge.org';
const DEFAULT_API = `${WIKI}/w/api.php`;
const TITLE_MAX = 70;

// ── Codes ─────────────────────────────────────────────────────────

const CODE_RE = /(?<![0-9A-Za-z_-])((?:[0-9][LR][A-Z]|---)+(?:_(?:[0-9][LR][A-Z]|---)+)+)(?![0-9A-Za-z_-])/g;

/** The code with every halt letter written Z, so one machine has one spelling. */
export function canonicalCode(code) {
  const segs = String(code).toUpperCase().split('_');
  const n = segs.length;
  return segs.map(s => s.replace(/([0-9][LR])([A-Z])/g, (_, wm, q) => wm + (q.charCodeAt(0) - 65 < n ? q : 'Z'))).join('_');
}

/** Every distinct code in a piece of wikitext, in order, canonical. */
export function codesIn(text) {
  const seen = new Set();
  for (const m of String(text || '').matchAll(CODE_RE)) seen.add(canonicalCode(m[1]));
  return [...seen];
}

export function sizeOf(code) {
  const segs = code.split('_');
  return { states: segs.length, symbols: segs[0].length / 3 };
}

/** Why the app's reader refuses the code, or null when it reads. */
export function unreadable(code) {
  try { readStandardTM(code, { blank: '⊔' }); return null; } catch (e) {
    if (e instanceof StandardTMError) return e.message;
    throw e;
  }
}

// ── Wikitext ──────────────────────────────────────────────────────

/** Wikitext → the text a reader sees, near enough for a name. */
export function stripWiki(s) {
  let t = String(s || '');
  t = t.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Templates, innermost first.
  for (let i = 0; i < 8 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
  return t;
}

/** A table cell's content: `style="…" | text` is text. */
function cellContent(cell) {
  let depth = 0;
  for (let i = 0; i < cell.length; i++) {
    const two = cell.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; i++; continue; }
    if (cell[i] === '|' && depth === 0) return cell.slice(i + 1);
  }
  return cell;
}

/** Splits `a || b` (or `!!`) at the top level only — a template's `|` is not a cell break. */
function splitCells(line, sep) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < line.length; i++) {
    const two = line.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; i++; continue; }
    if (depth === 0 && two === sep) { out.push(line.slice(from, i)); from = i + 2; i++; }
  }
  out.push(line.slice(from));
  return out;
}

/** Every table in the text: its header cells and its rows of raw cells. */
export function tablesIn(text) {
  const tables = [];
  let cur = null, row = null;
  const endRow = () => { if (cur && row && row.length) cur.rows.push(row); row = null; };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('{|')) { cur = { header: [], rows: [] }; row = null; continue; }
    if (!cur) continue;
    if (line.startsWith('|}')) { endRow(); tables.push(cur); cur = null; continue; }
    if (line.startsWith('|-')) { endRow(); row = []; continue; }
    if (line.startsWith('|+')) continue;
    if (line.startsWith('!')) {
      const cells = splitCells(line.slice(1), '!!').map(c => stripWiki(cellContent(c)));
      if (!cur.rows.length && !(row && row.length)) cur.header.push(...cells);
      else { row = row || []; row.push(...cells.map(c => ({ raw: c, header: true }))); }
      continue;
    }
    if (line.startsWith('|')) {
      row = row || [];
      row.push(...splitCells(line.slice(1), '||').map(c => ({ raw: cellContent(c) })));
      continue;
    }
    // A cell's content running on to the next line.
    if (row && row.length) row[row.length - 1].raw += '\n' + raw;
  }
  return tables;
}

const NAME_HEADER = /^(?:(?:machine|cryptid)\s+)?(?:nick)?names?$/i;
const TOPIC_TITLE = /^(?:BB\s*\(|list\b|lists\b)|holdouts?|champions?|\bcategory\b/i;
const MACHINE_TEMPLATE = /^\{\{\s*(?:infobox[^|}]*|machine[^|}]*)\|/i;

/** A name worth giving a machine: some letters, not a code, not a sentence. */
function nameOf(s) {
  const t = stripWiki(s);
  if (!t || t.length > 40 || !/[A-Za-z]/.test(t) || codesIn(t).length) return null;
  return t;
}

/** The templates at the top level of the text, raw. */
function templatesIn(text) {
  const out = [];
  let depth = 0, from = -1;
  for (let i = 0; i < text.length - 1; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{') { if (depth++ === 0) from = i; i++; } else if (two === '}}' && depth > 0) { if (--depth === 0) out.push(text.slice(from, i + 2)); i++; }
  }
  return out;
}

/** The wiki's [[Category:…]] links. */
export function categoriesIn(text) {
  return [...String(text || '').matchAll(/\[\[\s*Category\s*:\s*([^\]|]+)(?:\|[^\]]*)?\]\]/gi)].map(m => m[1].trim());
}

/**
 * What one page documents. `page` is { title, text, categories? }.
 * Returns { machines: [{ code, name, role }], unnamed, skipped }.
 */
export function machinesOnPage(page, { exampleCap = 12 } = {}) {
  const title = String(page.title || '').trim();
  const text = String(page.text || '');
  const machines = new Map();
  const add = (code, name, role) => {
    const prev = machines.get(code);
    const rank = { page: 3, named: 2, example: 1 };
    if (!prev || rank[role] > rank[prev.role]) machines.set(code, { code, name: name || prev?.name || null, role });
  };

  // A page about one machine.
  const titleCodes = codesIn(title.replace(/ /g, '_'));
  if (titleCodes.length === 1) {
    const bold = /'''([^']+)'''/.exec(text.split(/\n==/)[0]);
    add(titleCodes[0], bold ? nameOf(bold[1]) : null, 'page');
  } else if (!TOPIC_TITLE.test(title)) {
    const box = templatesIn(text).find(t => MACHINE_TEMPLATE.test(t) && codesIn(t).length);
    if (box) add(codesIn(box)[0], nameOf(title), 'page');
  }

  // Named rows.
  for (const table of tablesIn(text)) {
    const col = table.header.findIndex(h => NAME_HEADER.test(h));
    if (col < 0) continue;
    for (const row of table.rows) {
      const codes = codesIn(row.map(c => c.raw).join(' '));
      if (codes.length !== 1) continue;
      const name = row[col] ? nameOf(row[col].raw) : null;
      if (name) add(codes[0], name, 'named');
    }
  }

  // Everything else on the page is an example, unless there are too many.
  const rest = codesIn(text).filter(c => !machines.has(c));
  if (rest.length && rest.length <= exampleCap) rest.forEach(c => add(c, null, 'example'));
  return { machines: [...machines.values()], unnamed: rest.length, skipped: rest.length > exampleCap ? rest.length : 0 };
}

/** Wiki title → the page's URL. */
export function wikiUrl(title) {
  return `${WIKI}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':')}`;
}

/**
 * Every page → the machine list and the report. A machine documented on
 * several pages is one machine: it takes the strongest role's name, and keeps
 * every page it appears on.
 */
export function collectMachines(pages, opts = {}) {
  const byCode = new Map();
  const report = { pages: pages.length, skippedPages: [], unreadable: [] };
  const rank = { page: 3, named: 2, example: 1 };
  for (const page of pages) {
    const { machines, skipped } = machinesOnPage(page, opts);
    if (skipped) report.skippedPages.push({ title: page.title, codes: skipped });
    const cats = [...new Set([...(page.categories || []), ...categoriesIn(page.text)])];
    for (const m of machines) {
      const why = unreadable(m.code);
      if (why) { report.unreadable.push({ code: m.code, page: page.title, why }); continue; }
      const prev = byCode.get(m.code);
      const ref = { title: page.title, role: m.role };
      if (!prev) {
        byCode.set(m.code, { code: m.code, name: m.name, role: m.role, pages: [ref], categories: m.role === 'page' ? cats : [] });
        continue;
      }
      prev.pages.push(ref);
      if (m.role === 'page') prev.categories = [...new Set([...prev.categories, ...cats])];
      if (rank[m.role] > rank[prev.role]) { prev.role = m.role; prev.name = m.name || prev.name; } else if (!prev.name && m.name) prev.name = m.name;
    }
  }
  // The page that documents it best comes first.
  const machines = [...byCode.values()].map(m => ({
    ...m, pages: m.pages.sort((a, b) => rank[b.role] - rank[a.role])
  }));
  machines.sort((a, b) => {
    const sa = sizeOf(a.code), sb = sizeOf(b.code);
    return sa.states - sb.states || sa.symbols - sb.symbols || (a.name || '~').localeCompare(b.name || '~') || a.code.localeCompare(b.code);
  });
  return { machines, report };
}

// ── Sources ───────────────────────────────────────────────────────

async function api(base, params) {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'AutomataStudio library importer (github.com/thethinkmachine/AutomataStudio)' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

/** Every article on the wiki, with its wikitext and categories, through the MediaWiki API. */
export async function fetchWikiPages(base = DEFAULT_API) {
  const titles = [];
  let cont = {};
  do {
    const r = await api(base, { action: 'query', list: 'allpages', apnamespace: '0', apfilterredir: 'nonredirects', aplimit: 'max', ...cont });
    titles.push(...r.query.allpages.map(p => p.title));
    cont = r.continue || null;
  } while (cont);

  const pages = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const byTitle = new Map();
    let c = {};
    do {
      const r = await api(base, { action: 'query', prop: 'revisions|categories', rvprop: 'content', rvslots: 'main', cllimit: 'max', clshow: '!hidden', titles: batch.join('|'), ...c });
      for (const p of r.query.pages || []) {
        const e = byTitle.get(p.title) || { title: p.title, text: '', categories: [] };
        const content = p.revisions?.[0]?.slots?.main?.content;
        if (typeof content === 'string') e.text = content;
        for (const cat of p.categories || []) e.categories.push(cat.title.replace(/^Category:/, ''));
        byTitle.set(p.title, e);
      }
      c = r.continue || null;
    } while (c);
    pages.push(...byTitle.values());
    process.stderr.write(`\r${Math.min(i + 50, titles.length)}/${titles.length} pages`);
  }
  process.stderr.write('\n');
  return pages;
}

const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

/** A Special:Export XML dump → the same pages, articles only. */
export function pagesFromExport(xml) {
  const pages = [];
  for (const m of String(xml).matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    const body = m[1];
    const ns = /<ns>(\d+)<\/ns>/.exec(body)?.[1];
    if (ns !== undefined && ns !== '0') continue;
    if (/<redirect\b/.test(body)) continue;
    const title = unxml(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] || '');
    const text = unxml(/<text\b[^>]*>([\s\S]*?)<\/text>/.exec(body)?.[1] || '');
    pages.push({ title, text, categories: [] });
  }
  return pages;
}

// ── From the list to library entries ──────────────────────────────

/** The title an entry gets: the wiki's name, else the code, else nothing that fits. */
export function entryTitle(m) {
  if (m.name) return m.name.slice(0, TITLE_MAX);
  return m.code.length <= TITLE_MAX ? m.code : null;
}

/** A blurb in the library's words. The wiki's prose stays on the wiki. */
export function entryBlurb(m) {
  const { states, symbols } = sizeOf(m.code);
  const shape = `${states}-state, ${symbols}-symbol`;
  const where = m.pages[0]?.title;
  const lead = m.name ? `${m.name}: a ${shape} Turing machine` : `A ${shape} Turing machine`;
  const role = m.pages[0]?.role === 'example' ? 'discussed' : 'documented';
  return `${lead} ${role} on the bbchallenge wiki${where ? ` (${where})` : ''}. Run it on the empty word; whether it halts is what the analysis below could prove.`.slice(0, 400);
}

export function entryReadme(m) {
  const lines = [`Standard format: ${m.code}`];
  lines.push(`Documented on the bbchallenge wiki:\n${m.pages.slice(0, 20).map(p => wikiUrl(p.title)).join('\n')}`);
  lines.push('Imported from the bbchallenge wiki by scripts/library/bbchallenge.mjs. The code and name are the wiki\'s; the description is the library\'s, and every badge is the library\'s own analysis of the machine.');
  return lines.join('\n\n').slice(0, 4000);
}

export function sizeTag({ states, symbols }) {
  return symbols === 2 ? `bb${states}` : `bb${states}x${symbols}`;
}

// ── CLI ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const exportFile = opt('--export');
  const out = resolve(opt('--out') || DATA_FILE);
  const exampleCap = Number(opt('--example-cap') ?? 12);
  const source = exportFile ? `export:${exportFile}` : (opt('--api') || DEFAULT_API);

  const pages = exportFile ? pagesFromExport(await readFile(exportFile, 'utf8')) : await fetchWikiPages(source);
  const { machines, report } = collectMachines(pages, { exampleCap });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ source: exportFile ? 'Special:Export dump' : source, fetched: new Date().toISOString().slice(0, 10), exampleCap, machines }, null, 2) + '\n');

  const count = r => machines.filter(m => m.role === r).length;
  console.log(`${report.pages} pages → ${machines.length} machines (${count('page')} with a page, ${count('named')} named in a table, ${count('example')} examples) → ${out}`);
  for (const s of report.skippedPages) console.log(`  skipped: ${s.title} — ${s.codes} unnamed codes, a list rather than examples`);
  for (const u of report.unreadable) console.log(`  unreadable: ${u.code} (${u.page}) — ${u.why}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}
