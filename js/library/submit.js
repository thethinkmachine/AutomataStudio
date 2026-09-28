// ══════════════════════════════════════════════════════════════════
//  SUBMITTING A MACHINE
// ══════════════════════════════════════════════════════════════════
// There is no server. A submission is a GitHub issue filed through the
// library's issue form, pre-filled from here, and the library's CI turns the
// issue into a pull request (scripts/library/issue-to-entry.mjs). So the app
// never holds a token, never signs anyone in, and the credit on an entry is the
// account that opened the issue — which GitHub vouches for and no form field can
// forge.
//
// What this module adds is everything that can be known before the issue
// exists: the same analysis the CI will run (js/library/analyze.js), so the
// reader sees the badges they will earn and the errors that would fail the
// check; and a duplicate search by language fingerprint against the index, so
// "this is already in the library" is said before anyone reviews it.
//
// The machine rides in the issue as a share link — DEFLATEd, base64url — in the
// `machine` field. A pre-filled URL past ISSUE_URL_MAX is not sent; the link is
// put on the clipboard and the form opened without it, with the instruction to
// paste. Very large machines go as a downloaded file dragged into the issue.

import { App } from '../state.js';
import { getWorkspaceData, shareLinkFor } from '../persistence.js';
import { APP_WEB_URL, ISSUE_URL_MAX, LIBRARY_REPO, SUBMIT_TEMPLATE, isLibraryId, repoUrl } from './config.js';
import { LIBRARY_LICENSES, analyzeDocument } from './analyze.js';
import { entryById, sameLanguageAs } from './index-model.js';
import { machineStructureHash } from './hash.js';

/**
 * The form's starting values, read off the machine on the canvas: its card,
 * what the library already recorded about it, and the entry it was opened from
 * — which is what makes a remix a remix without the reader typing an id.
 */
export function submissionDefaults(meta = App.meta) {
  const lib = meta?.library && typeof meta.library === 'object' ? meta.library : {};
  const source = lib.source && typeof lib.source === 'object' ? lib.source : null;
  return {
    title: meta?.title || '',
    blurb: meta?.blurb || '',
    readme: typeof lib.readme === 'string' ? lib.readme : '',
    tags: Array.isArray(lib.tags) ? lib.tags.join(', ') : '',
    difficulty: lib.difficulty || '',
    chapter: lib.chapter || '',
    // A machine opened from the library and changed is a remix of it — or,
    // when the entry is the reader's own, an update of it (updateOf below
    // decides, once the form says who the reader is).
    forkOf: lib.forkOf || source?.id || '',
    login: lib.author?.login || rememberedLogin(),
    name: lib.author?.name || '',
    license: LIBRARY_LICENSES[lib.license] ? lib.license : 'CC-BY-4.0',
    agreed: false,
    kind: App.exercise ? 'exercise' : 'machine'
  };
}

const LOGIN_KEY = 'as.library.login';

export function rememberedLogin() {
  try { return globalThis.localStorage?.getItem(LOGIN_KEY) || ''; } catch { return ''; }
}

export function rememberLogin(login) {
  try { if (login) globalThis.localStorage?.setItem(LOGIN_KEY, login); } catch { /* optional */ }
}

function splitTags(text) {
  return [...new Set(String(text || '').split(/[,\n]/)
    .map(t => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))
    .filter(t => /^[a-z0-9][a-z0-9+.-]{0,39}$/.test(t)))].slice(0, 12);
}

const sameLogin = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The entry this submission replaces, or null: the one the machine was opened
 * from, when the form's account is that entry's author. Anyone else's changes
 * to it are a remix. (CI decides the same way, by the issue's account, and
 * only an entry's author can update it whatever this says.)
 */
export function updateOf(fields, index, meta = App.meta) {
  const source = meta?.library?.source;
  const e = source?.id && index ? entryById(index, source.id) : null;
  return e && sameLogin(e.author.login, String(fields.login || '').trim().replace(/^@/, '')) ? e : null;
}

/**
 * The document that will be filed: the workspace as a file would save it, with
 * the form's fields written into its card and `meta.library`. Things that are
 * about this reader's session rather than the machine are left out — the lexer
 * spec, the camera — and so is the exercise, unless the submission *is* an
 * exercise: a machine built in an exercise tab would otherwise carry the
 * sealed reference it was graded against.
 */
export function buildSubmissionDoc(fields, update = null) {
  const doc = getWorkspaceData();
  const lib = {
    author: { login: String(fields.login || '').trim().replace(/^@/, ''), ...(fields.name ? { name: String(fields.name).trim() } : {}) },
    license: fields.license,
    tags: splitTags(fields.tags)
  };
  if (fields.difficulty) lib.difficulty = fields.difficulty;
  if (fields.chapter) lib.chapter = String(fields.chapter).trim();
  if (fields.readme) lib.readme = String(fields.readme).trim();
  // An update keeps what the entry was remixed from; it is not a remix of itself.
  const forkOf = update && fields.forkOf === update.id ? update.forkOf : fields.forkOf;
  if (isLibraryId(forkOf)) lib.forkOf = forkOf;
  const inputs = Array.isArray(doc.meta?.inputs) ? doc.meta.inputs : undefined;
  doc.meta = { title: String(fields.title || '').trim(), blurb: String(fields.blurb || '').trim(), ...(inputs ? { inputs } : {}), library: lib };
  delete doc.lexer;
  delete doc.cam;
  if (fields.kind !== 'exercise') delete doc.exercise;
  return doc;
}

/**
 * Everything the CI will say, said now — plus what only the index can tell:
 * whether the language is already listed, whether the remix the form names
 * exists, and whether this updates the reader's own entry. The halting classifier gets a small budget here; the
 * CI's is large, so a busy beaver's "halts" badge may appear only there, which
 * the dialog says rather than promising it.
 */
export function precheckSubmission(fields, index = null) {
  const update = updateOf(fields, index);
  const doc = buildSubmissionDoc(fields, update);
  const problems = [];
  if (!fields.agreed) problems.push(`Tick the box to release this machine under ${LIBRARY_LICENSES[fields.license] || fields.license}.`);
  const analysis = analyzeDocument(JSON.parse(JSON.stringify(doc)), { behaviourBudget: 2e6, pictures: false });
  const duplicates = [];
  if (index && analysis.facts?.fingerprint) {
    for (const e of sameLanguageAs(index, analysis.facts.fingerprint, update?.id || fields.forkOf || null)) {
      if (e.id === fields.forkOf) continue;
      // Equal fingerprints over equal canonical tables are the same language —
      // the table *is* the minimal automaton, so no further check is needed.
      if (!e.dfa || !analysis.facts.dfa || JSON.stringify(e.dfa) === JSON.stringify(analysis.facts.dfa)) duplicates.push(e);
    }
  }
  // A library machine opened and sent straight back is a copy of an entry, not
  // a remix of it. The structure hash ignores layout, so dragging states about
  // does not count as a change; editing the card alone does not either. Its
  // author may send it back, though: rewording its card is an update.
  const source = App.meta?.library?.source;
  if (!update && source?.structure && source.id === fields.forkOf && machineStructureHash(doc) === source.structure) {
    problems.push(`This is “${source.title || source.id}” exactly as the library has it. Change the machine before submitting it as a remix.`);
  }
  if (index && doc.meta.library.forkOf && !entryById(index, doc.meta.library.forkOf)) problems.push(`There is no library entry "${doc.meta.library.forkOf}" to be a remix of.`);
  return {
    doc,
    update,
    analysis,
    duplicates,
    errors: [...problems, ...analysis.errors],
    warnings: analysis.warnings,
    ok: !problems.length && analysis.ok
  };
}

/**
 * The issue form's URL with every field filled in. Field names are the `id`s in
 * .github/ISSUE_TEMPLATE/submit-machine.yml; GitHub pre-fills inputs and
 * textareas from query parameters of the same name.
 */
export function issueUrlFor(fields, machineText, repo = LIBRARY_REPO, base = null) {
  const params = new URLSearchParams();
  params.set('template', SUBMIT_TEMPLATE);
  params.set('title', `[${fields.kind === 'exercise' ? 'Exercise' : 'Machine'}] ${String(fields.title || '').trim() || 'Untitled'}`);
  const add = (k, v) => { if (v) params.set(k, String(v)); };
  add('name', fields.title);
  add('description', fields.blurb);
  add('tags', splitTags(fields.tags).join(', '));
  add('chapter', fields.chapter);
  add('remix-of', fields.forkOf);
  add('updates', fields.updates);
  add('display-name', fields.name);
  add('readme', fields.readme);
  add('license', fields.license);
  add('level', fields.difficulty);
  if (machineText) params.set('machine', machineText);
  return `${base || `${repoUrl(repo)}/issues/new`}?${params.toString()}`;
}

/**
 * The URL to open, and whether the machine made it into it. Past the length a
 * URL can safely carry, the machine is left out and the caller copies it.
 */
export async function submissionLink(fields, doc, repo = LIBRARY_REPO, base = null) {
  // shareLinkFor builds on this page's own address, which on the desktop is
  // app:// and in development is localhost. A reviewer clicks the link in the
  // issue, so it is re-rooted on the published web app.
  const local = await shareLinkFor(doc);
  const link = APP_WEB_URL + local.slice(local.indexOf('#'));
  const full = issueUrlFor(fields, link, repo, base);
  if (full.length <= ISSUE_URL_MAX) return { url: full, link, included: true };
  return { url: issueUrlFor(fields, '', repo, base), link, included: false };
}
