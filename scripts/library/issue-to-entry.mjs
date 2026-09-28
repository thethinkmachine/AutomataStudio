#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  A SUBMISSION ISSUE → A LIBRARY ENTRY
// ══════════════════════════════════════════════════════════════════
// Run by the library's submission workflow when an issue is opened from the
// "Submit a machine" form. Reads the form's answers out of the issue body,
// finds the machine in the "Machine" field — a share link, the file's JSON, a
// Turing machine in the standard text format, or an attached .automaton — and
// writes it into the checkout as an entry, credited to the account that opened
// the issue. Then it analyses the entry exactly as the PR check will, and
// writes the report the workflow posts back on the issue.
//
//   ISSUE_BODY=… ISSUE_AUTHOR=octocat ISSUE_NUMBER=12 \
//     node --conditions=browser --conditions=development \
//       scripts/library/issue-to-entry.mjs --library . --report report.md
//
// Outputs (to $GITHUB_OUTPUT when set): ok, path, id, title, branch.
//
// The author is never read from the form. Whatever the document or the form
// says, meta.library.author.login is the issue's author — the one thing GitHub
// vouches for. An existing entry is replaced only by its own author; anyone
// else's version of the same title lands beside it under a new id.

import './env.mjs';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeSharePayload, SHARE_HASH_PREFIX } from '../../js/persistence.js';
import { standardTMText } from '../../js/interop/standard-tm.js';
import { LIBRARY_LICENSES, analyzeDocument } from '../../js/library/analyze.js';
import { isLibraryId } from '../../js/library/config.js';
import { docFromStandardTM, folderFor, slugify } from './seed.mjs';

// ── The form's answers ────────────────────────────────────────────

// The issue form's fields, in its order. Each `label` is a heading
// parseIssueForm reads back and each `id` a query parameter the app sets —
// the same contract as library-template/.github/ISSUE_TEMPLATE/submit-machine.yml,
// which tests/library.test.js holds this list to. The local emulator draws its
// stand-in form from it.
export const FORM_FIELDS = [
  { id: 'name', label: 'Name', kind: 'input', required: true },
  { id: 'description', label: 'Description', kind: 'textarea', required: true },
  { id: 'machine', label: 'Machine', kind: 'textarea', required: true, render: 'text', hint: 'A share link, the .automaton file’s JSON, or a Turing machine in the standard format.' },
  { id: 'readme', label: 'Write-up', kind: 'textarea' },
  { id: 'tags', label: 'Tags', kind: 'input' },
  { id: 'level', label: 'Level', kind: 'input' },
  { id: 'chapter', label: 'Chapter or source', kind: 'input' },
  { id: 'remix-of', label: 'Remix of', kind: 'input' },
  { id: 'updates', label: 'Updates', kind: 'input' },
  { id: 'display-name', label: 'Display name', kind: 'input' },
  { id: 'license', label: 'Licence', kind: 'input', required: true, value: 'CC-BY-4.0' },
  { id: 'agreement', label: 'Agreement', kind: 'checkbox', required: true, text: 'I made this machine (or have the right to share it) and release it under the licence above.' }
];

const LABELS = new Set(FORM_FIELDS.map(f => f.label.toLowerCase()));

/**
 * GitHub renders an issue form as `### Label` sections. → { label: value }
 *
 * Only the form's own labels start a section, and each only once — the form
 * never repeats one. The write-up is Markdown, and a "### How it works" inside
 * it is part of the write-up, not the end of it.
 */
export function parseIssueForm(body) {
  const out = {};
  let label = null, lines = [];
  const close = () => {
    if (label === null) return;
    let value = lines.join('\n').trim();
    if (value === '_No response_' || value === 'None') value = '';
    out[label] = value;
  };
  for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^### +(.+?)\s*$/.exec(line);
    const heading = m && m[1].toLowerCase();
    if (heading && LABELS.has(heading) && !(heading in out) && heading !== label) {
      close();
      label = heading;
      lines = [];
    } else if (label !== null) {
      lines.push(line);
    }
  }
  close();
  return out;
}

const FIELD = {
  name: 'name', description: 'description', readme: 'write-up', tags: 'tags', level: 'level',
  chapter: 'chapter or source', forkOf: 'remix of', updates: 'updates', displayName: 'display name',
  license: 'licence', machine: 'machine', agreement: 'agreement'
};

// ── Finding the machine ───────────────────────────────────────────

const ATTACHMENT_RE = /https:\/\/github\.com\/(?:user-attachments\/files|[\w.-]+\/[\w.-]+\/files)\/[^\s)>\]]+/;

/**
 * The Machine field → a workspace document. Tries, in order: a share link, the
 * file's JSON (fenced or not), an attached file, a standard-format TM.
 */
export async function machineFromField(text, { fetchImpl = globalThis.fetch } = {}) {
  const raw = String(text || '');
  const at = raw.indexOf(SHARE_HASH_PREFIX);
  if (at >= 0) {
    const m = /^(?:z\.)?[A-Za-z0-9_-]+/.exec(raw.slice(at + SHARE_HASH_PREFIX.length));
    if (m) return { via: 'share link', doc: JSON.parse(await decodeSharePayload(m[0])) };
  }
  // The form renders this field as a code block, so GitHub wraps whatever was
  // typed in a ```text fence. Every reading below is of what is inside it —
  // reading the fence along with a machine's code is what made a busy beaver
  // submitted by its code look like no machine at all.
  const fenced = /```[\w-]*\s*\n([\s\S]*?)```/.exec(raw);
  const inner = (fenced ? fenced[1] : raw).trim();
  const jsonText = inner;
  if (jsonText.startsWith('{')) return { via: 'pasted file', doc: JSON.parse(jsonText) };
  const att = ATTACHMENT_RE.exec(raw);
  if (att) {
    const res = await fetchImpl(att[0]);
    if (!res.ok) throw new Error(`The attached file could not be downloaded (${res.status}).`);
    return { via: 'attached file', doc: JSON.parse(await res.text()) };
  }
  const tm = standardTMText(inner);
  if (tm) return { via: 'standard TM text', doc: docFromStandardTM(tm, {}), standard: tm };
  throw new Error('The Machine field has no share link, no .automaton file and no Turing machine in the standard format.');
}

// ── The entry ─────────────────────────────────────────────────────

function tagsOf(text) {
  return [...new Set(String(text || '').split(/[,\n]/).map(t => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))
    .filter(t => /^[a-z0-9][a-z0-9+.-]{0,39}$/.test(t)))].slice(0, 12);
}

function licenseOf(text) {
  const t = String(text || '').trim();
  if (LIBRARY_LICENSES[t]) return t;
  if (/cc0|public domain/i.test(t)) return 'CC0-1.0';
  if (/cc[- ]?by/i.test(t)) return 'CC-BY-4.0';
  return '';
}

/** The form's answers written into the document. The form wins over the file for what the form asks. */
export function applyForm(doc, form, author) {
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const prior = meta.library && typeof meta.library === 'object' ? meta.library : {};
  const pick = (key, fallback = '') => (form[FIELD[key]] || fallback || '').trim();
  const library = {
    author: { login: author, ...(pick('displayName') ? { name: pick('displayName').slice(0, 80) } : {}) },
    license: licenseOf(pick('license', prior.license)),
    tags: tagsOf(pick('tags') || (prior.tags || []).join(',')),
    ...(['intro', 'intermediate', 'advanced'].includes(pick('level', prior.difficulty)) ? { difficulty: pick('level', prior.difficulty) } : {}),
    ...(pick('chapter', prior.chapter) ? { chapter: pick('chapter', prior.chapter).slice(0, 80) } : {}),
    ...(pick('readme', prior.readme) ? { readme: pick('readme', prior.readme).slice(0, 4000) } : {}),
    ...(isLibraryId(pick('forkOf', prior.forkOf)) ? { forkOf: pick('forkOf', prior.forkOf) } : {})
  };
  doc.meta = {
    title: (pick('name') || meta.title || '').slice(0, 70),
    blurb: (pick('description') || meta.blurb || '').slice(0, 400),
    ...(Array.isArray(meta.inputs) ? { inputs: meta.inputs } : {}),
    library
  };
  // Session state that is not the machine: never published.
  delete doc.cam;
  delete doc.lexer;
  if (!/exercise/i.test(form.kind || '')) delete doc.exercise;
  return doc;
}

const idOf = path => path.replace(/^machines\//, '').replace(/\.automaton$/, '');
const pathOf = id => `machines/${id}.automaton`;

/** Whom an entry is credited to, lowercased; null when there is no such entry. */
async function creditOf(root, id) {
  try {
    const d = JSON.parse(await readFile(join(root, pathOf(id)), 'utf8'));
    return String(d?.meta?.library?.author?.login || '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The entry this issue replaces, or null. Named by the form's "Updates" field —
 * or, for a form filled in by hand, by a "Remix of" that names the author's own
 * entry, since nobody remixes their own machine in place. Only the entry's
 * author may update it: naming someone else's entry is refused, never quietly
 * turned into a new one.
 */
export async function updateTarget(root, form, author) {
  const named = (form[FIELD.updates] || '').trim();
  const who = author.toLowerCase();
  if (named) {
    if (!isLibraryId(named)) return { error: `"${named}" is not a library id.` };
    const owner = await creditOf(root, named);
    if (owner === null) return { error: `There is no entry "${named}" to update.` };
    if (owner !== who) return { error: `"${named}" is credited to @${owner}; only they can update it. Submit your version as a remix instead.` };
    return { id: named };
  }
  const fork = (form[FIELD.forkOf] || '').trim();
  if (isLibraryId(fork) && await creditOf(root, fork) === who) return { id: fork };
  return null;
}

/** Where a new entry goes: its type's folder, named for its title, never over someone else's. */
export async function entryPath(root, doc, author) {
  const folder = folderFor(doc.machine === 'PDA' ? 'DPDA' : doc.machine);
  const base = slugify(doc.meta.title);
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? base : i === 1 ? `${base}-${slugify(author)}` : `${base}-${slugify(author)}-${i}`;
    const path = `${folder}/${name}.automaton`;
    const file = join(root, path);
    if (!existsSync(file)) return { path, update: false };
    try {
      const existing = JSON.parse(await readFile(file, 'utf8'));
      if (String(existing?.meta?.library?.author?.login || '').toLowerCase() === author.toLowerCase()) return { path, update: true };
    } catch { /* unreadable: treat as someone else's */ }
  }
  throw new Error('Could not find a free name for this entry.');
}

// ── Main ──────────────────────────────────────────────────────────

async function output(values) {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`).join('\n') + '\n';
  if (file) await appendFile(file, lines); else process.stdout.write(lines);
}

/**
 * `title` is the issue's title, which is where the app says what is being
 * submitted — "[Machine] …" or "[Exercise] …". The body does not carry it.
 */
export async function processIssue({ body, author, number, root, title = '', kind = '' }) {
  const form = parseIssueForm(body);
  form.kind = kind || (/^\s*\[exercise\]/i.test(title) ? 'exercise' : '');
  const problems = [];
  if (!/\[x\]/i.test(form[FIELD.agreement] || '')) problems.push('The licence agreement box was not ticked.');
  let found;
  try { found = await machineFromField(form[FIELD.machine]); }
  catch (e) { problems.push(e.message); }
  if (!found) return { ok: false, problems, report: null };
  const update = await updateTarget(root, form, author);
  if (update?.error) problems.push(update.error);
  // An update is not a remix of itself: it keeps whatever the entry was
  // remixed from, and a "Remix of" that only named the entry goes.
  if (update?.id && (form[FIELD.forkOf] || '').trim() === update.id) {
    const prior = JSON.parse(await readFile(join(root, pathOf(update.id)), 'utf8'));
    form[FIELD.forkOf] = prior?.meta?.library?.forkOf || '';
    if (found.doc.meta?.library) delete found.doc.meta.library.forkOf;
  }
  const doc = applyForm(found.doc, form, author);
  // The one thing about an entry that depends on another file: what it says
  // it was remixed from has to exist, or the publish build would drop it.
  const forkOf = doc.meta.library.forkOf;
  if (forkOf && !existsSync(join(root, pathOf(forkOf)))) problems.push(`It says it is a remix of "${forkOf}", which is not in the library.`);
  let place;
  if (update?.id) place = { path: pathOf(update.id), update: true };
  else {
    try { place = await entryPath(root, doc, author); } catch (e) { problems.push(e.message); }
  }
  const text = JSON.stringify(doc, null, 2) + '\n';
  const a = analyzeDocument(JSON.parse(text), { text, behaviourBudget: 5e7 });
  problems.push(...a.errors);
  const ok = !problems.length && !!place;
  if (ok) {
    await mkdir(dirname(join(root, place.path)), { recursive: true });
    await writeFile(join(root, place.path), text);
  }
  const id = place ? idOf(place.path) : '';
  const lines = [];
  if (ok) {
    lines.push(`### ✅ Ready for review`, '',
      `Read from the ${found.via}, and ${place.update ? 'updates your existing entry' : 'will be added as'} \`${id}\`.`, '');
    const badges = a.facts?.badges || [];
    if (badges.length) lines.push(`**Verified:** ${badges.map(b => `\`${b.id}\`${b.detail ? ` (${b.detail})` : ''}`).join(' · ')}`, '');
    for (const w of a.warnings) lines.push(`- ⚠️ ${w}`);
    lines.push('', 'A pull request has been opened with the entry; a maintainer will merge it.');
  } else {
    lines.push('### ❌ This submission needs changes', '', ...problems.map(p => `- ${p}`), '',
      'Edit the issue to fix them — the check runs again on every edit.');
  }
  return { ok, problems, id, path: place?.path || '', title: doc.meta.title, update: !!place?.update, report: lines.join('\n'), number };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const root = resolve(arg('--library') || '.');
  const body = arg('--body-file') ? await readFile(arg('--body-file'), 'utf8') : process.env.ISSUE_BODY || '';
  const author = process.env.ISSUE_AUTHOR || arg('--author') || '';
  const number = process.env.ISSUE_NUMBER || arg('--issue') || '0';
  const title = process.env.ISSUE_TITLE || arg('--title') || '';
  if (!author) throw new Error('ISSUE_AUTHOR is required — the entry is credited to it.');
  const r = await processIssue({ body, author, number, root, title });
  if (arg('--report')) await writeFile(resolve(arg('--report')), r.report || `### ❌ This submission needs changes\n\n${r.problems.map(p => `- ${p}`).join('\n')}\n`);
  await output({
    ok: r.ok ? 'true' : 'false', path: r.path || '', id: r.id || '', title: r.title || '',
    update: r.update ? 'true' : 'false', branch: `submission/${number}`
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
