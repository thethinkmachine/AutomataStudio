import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, resetApp } from './harness.js';
import { buildLibrary, listingOf, reportMarkdown, writeLibrary } from '../scripts/library/build.mjs';
import { docFromStandardTM } from '../scripts/library/seed.mjs';
import { parseIssueForm, processIssue } from '../scripts/library/issue-to-entry.mjs';
import { guardChanges, maintainersAt } from '../scripts/library/guard.mjs';

// The machine library: a public repository of .automaton files, an index its
// CI builds with this app's engine, the Library view that browses it, and the
// submission path back. What is pinned here is the store's one promise — every
// badge is an answer the machine gave, never a claim someone typed — and the
// places that promise could quietly break: a fingerprint that depends on how a
// machine was drawn, a download that is not the file the index describes, a
// submission credited to whoever the form says.

const sym = () => context.App.config.sym;

// ── Fixtures ──────────────────────────────────────────────────────

function doc(machine, { title = 'A machine', states, transitions, accepts, start = 's1', inputs, sigma = ['0', '1'], library = {}, extra = {} }) {
  return {
    format: context.WORKSPACE_FORMAT, schema: context.SCHEMA_VERSION, machine,
    config: { sym: { ...sym() } }, sigma, stackAlpha: [], outputAlpha: [], tapeCount: 1,
    states, transitions, startId: start, accepts, notes: [], dividers: [], blocks: [],
    meta: { title, blurb: 'Test fixture.', ...(inputs ? { inputs } : {}), library: { author: { login: 'alice' }, license: 'CC-BY-4.0', ...library } },
    ...extra
  };
}

const S = (id, name, x = 0) => ({ id, name, x, y: 0 });
const T = (id, from, to, symbol) => ({ id, from, to, symbol });

/** Even number of 1s — the two-state minimal DFA. */
const evenOnes = (opts = {}) => doc('DFA', {
  title: 'Even number of 1s',
  states: [S('s1', 'even'), S('s2', 'odd', 200)],
  transitions: [T('t1', 's1', 's1', '0'), T('t2', 's1', 's2', '1'), T('t3', 's2', 's2', '0'), T('t4', 's2', 's1', '1')],
  accepts: ['s1'],
  inputs: [{ w: '', expect: 'accept' }, { w: '11', expect: 'accept' }, { w: '1', expect: 'reject' }],
  ...opts
});

/** The same language drawn with a redundant third state. */
const evenOnesBloated = (opts = {}) => doc('DFA', {
  title: 'Even number of 1s, the long way',
  states: [S('s1', 'e0'), S('s2', 'odd', 200), S('s3', 'e1', 400)],
  transitions: [T('t1', 's1', 's3', '0'), T('t2', 's1', 's2', '1'), T('t3', 's2', 's2', '0'), T('t4', 's2', 's3', '1'), T('t5', 's3', 's1', '0'), T('t6', 's3', 's2', '1')],
  accepts: ['s1', 's3'],
  ...opts
});

/** The same language as an NFA with a partial δ-free guess nobody needs. */
const evenOnesNfa = (opts = {}) => doc('NFA', {
  title: 'Even number of 1s, as an NFA',
  states: [S('s1', 'even'), S('s2', 'odd', 200)],
  transitions: [T('t1', 's1', 's1', '0'), T('t2', 's1', 's2', '1'), T('t3', 's2', 's2', '0'), T('t4', 's2', 's1', '1')],
  accepts: ['s1'],
  ...opts
});

const oddOnes = (opts = {}) => ({ ...evenOnes(opts), accepts: ['s2'], meta: { ...evenOnes(opts).meta, title: 'Odd number of 1s', inputs: [{ w: '1', expect: 'accept' }] } });

function fakeResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body };
}

/** A fetch that answers from a URL → body map, and records what it was asked. */
function fakeFetch(routes) {
  const asked = [];
  const fn = async url => {
    asked.push(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.endsWith(pattern)) return typeof body === 'function' ? body(url) : fakeResponse(body);
    }
    return fakeResponse('not found', 404);
  };
  fn.asked = asked;
  return fn;
}

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  return (node.textContent || '') + (node.children || []).map(textOf).join('');
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach(c => findAll(c, pred, out));
  return out;
}

// ── A small library on disk, built once ───────────────────────────

let built = null;
async function builtLibrary() {
  if (built) return built;
  resetApp();
  const root = await mkdtemp(join(tmpdir(), 'as-library-'));
  const put = async (path, value) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  await put('machines/finite/dfa/even-ones.automaton', evenOnes({ library: { tags: ['parity'] } }));
  await put('machines/finite/dfa/even-ones-long.automaton', evenOnesBloated({ library: { author: { login: 'bob' }, forkOf: 'finite/dfa/even-ones' } }));
  await put('machines/finite/nfa/even-ones.automaton', evenOnesNfa());
  await put('machines/finite/dfa/odd-ones.automaton', oddOnes());
  // A card that lies about its machine: the entry must not be published.
  const liar = evenOnes();
  liar.meta.title = 'Wrong on purpose';
  liar.meta.inputs = [{ w: '1', expect: 'accept' }];
  await put('machines/finite/dfa/liar.automaton', liar);
  await put('machines/turing/busy-beaver/bb2.automaton', docFromStandardTM('1RB1LB_1LA1RZ', { title: 'BB(2) champion', author: 'alice', tags: ['busy-beaver'] }));
  await put('machines/turing/non-halting/cycler.automaton', docFromStandardTM('0LB1RZ_1RA1RA_1RC1RB', { title: 'Two cells, forever', author: 'alice' }));
  await put('collections/parity.json', { title: 'Parity', blurb: 'Counting mod 2.', curator: 'alice', entries: ['finite/dfa/even-ones', 'finite/dfa/liar', 'finite/dfa/odd-ones'] });
  const out = await buildLibrary({ library: root, commit: '', site: 'https://example.test/lib/' });
  built = { root, ...out, index: context.normalizeIndex(JSON.parse(JSON.stringify(out.raw))) };
  return built;
}

// ── Hashing and addresses ─────────────────────────────────────────

test('the content hash ignores line endings, so a Windows checkout is not an "update"', () => {
  assert.equal(context.contentHash('{\r\n"a": 1\r\n}'), context.contentHash('{\n"a": 1\n}'));
  assert.match(context.hash64('x'), /^[0-9a-f]{16}$/);
  assert.notEqual(context.hash64('x'), context.hash64('y'));
});

test('library ids refuse anything that could leave the library when put in a URL', () => {
  assert.equal(context.isLibraryId('turing/busy-beaver/bb5'), true);
  for (const bad of ['../secrets', 'a/../b', '/abs', 'a//b', 'a b', '', 'x?y', 'a#b']) assert.equal(context.isLibraryId(bad), false, bad);
});

test('a library link reads the same from the web app and from the desktop scheme', () => {
  for (const req of [{ action: 'open', id: 'turing/busy-beaver/bb5' }, { action: 'show', id: 'finite/dfa/x' }, { action: 'collection', id: 'busy-beavers' }, { action: 'browse' }]) {
    const web = context.webAppLink(req, 'https://app.test/');
    assert.deepEqual(context.parseLibraryHash(web.slice(web.indexOf('#'))), req);
    assert.deepEqual(context.parseLibraryProtocolUrl(context.protocolLink(req)), req);
  }
  assert.equal(context.parseLibraryHash('#lib=..%2Fetc'), null);
  assert.equal(context.parseLibraryHash('#share=abc'), null, 'a share link is not a library link');
});

test('an entry is fetched from jsDelivr pinned to the index commit, with the site as the fallback', () => {
  const e = { path: 'machines/turing/bb 5.automaton' };
  const urls = context.entryFileUrls(e, { repo: 'o/r', commit: 'abc1234' }, 'https://site.test/');
  assert.deepEqual(urls, ['https://cdn.jsdelivr.net/gh/o/r@abc1234/machines/turing/bb%205.automaton', 'https://site.test/machines/turing/bb%205.automaton']);
  assert.deepEqual(context.entryFileUrls(e, { repo: 'o/r', commit: '' }, 'https://site.test/'), ['https://site.test/machines/turing/bb%205.automaton']);
});

// ── The language, not the drawing ─────────────────────────────────

test('equal languages get equal fingerprints however they were drawn, and different ones do not', () => {
  resetApp();
  const fp = d => context.languageFingerprint(context.minimalDfaOf(context.targetFromDoc(d)));
  const a = fp(evenOnes()), b = fp(evenOnesBloated()), c = fp(evenOnesNfa()), d = fp(oddOnes());
  assert.ok(a);
  assert.equal(a, b, 'a redundant state does not change the language');
  assert.equal(a, c, 'nor does calling it an NFA');
  assert.notEqual(a, d);
});

test('the minimal DFA is canonical: numbered from the start, complete over Σ', () => {
  resetApp();
  const m = context.minimalDfaOf(context.targetFromDoc(evenOnesBloated()));
  assert.equal(m.n, 2);
  assert.equal(m.start, 0);
  assert.deepEqual(m.acc, [0]);
  assert.equal(m.delta.length, m.n * m.sigma.length);
  assert.equal(context.dfaAccepts(m, '0110'), true);
  assert.equal(context.dfaAccepts(m, '010'), false);
  assert.equal(context.dfaAccepts(m, '2'), false, 'a word not over Σ is rejected, not guessed at');
});

test('"Minimal" is awarded to the smallest DFA and withheld from a larger one', () => {
  resetApp();
  assert.equal(context.isMinimalDfa(context.targetFromDoc(evenOnes())), true);
  assert.equal(context.isMinimalDfa(context.targetFromDoc(evenOnesBloated())), false);
  const r = context.analyzeDocument(evenOnesBloated());
  assert.ok(!r.facts.badges.some(b => b.id === 'minimal'));
  assert.ok(r.warnings.some(w => /needs only 2 live states/.test(w)));
});

test('a partial DFA is held to the live states, a complete one to all of them', () => {
  resetApp();
  // a* over {a, b}: one live state, and a sink for b.
  const partial = states => context.targetFromDoc(doc('DFA', {
    sigma: ['a', 'b'], states, accepts: states.map(s => s.id),
    transitions: states.map((st, i) => T(`t${i}`, st.id, states[(i + 1) % states.length].id, 'a'))
  }));
  assert.equal(context.isMinimalDfa(partial([S('s1', 'p')])), true, 'one state is the least a* needs');
  assert.equal(context.isMinimalDfa(partial([S('s1', 'p'), S('s2', 'q', 100)])), false,
    'two equivalent states are not minimal, even though the complete DFA also has two');
  const complete = context.targetFromDoc(doc('DFA', {
    sigma: ['a', 'b'], states: [S('s1', 'p'), S('s2', 'dead', 100)], accepts: ['s1'],
    transitions: [T('t1', 's1', 's1', 'a'), T('t2', 's1', 's2', 'b'), T('t3', 's2', 's2', 'a'), T('t4', 's2', 's2', 'b')]
  }));
  assert.equal(context.isMinimalDfa(complete), true, 'with its sink drawn, two is the least');
});

// ── Badges are answers ────────────────────────────────────────────

test('declared examples are run: true ones earn "Tests pass", a false one fails the entry', () => {
  resetApp();
  const good = context.analyzeDocument(evenOnes());
  assert.equal(good.ok, true);
  assert.ok(good.facts.badges.some(b => b.id === 'tested' && /3 examples/.test(b.detail)));
  const bad = evenOnes();
  bad.meta.inputs = [{ w: '1', expect: 'accept' }];
  const r = context.analyzeDocument(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /Example "1": the card says accept, the machine gives reject/.test(e)), r.errors.join('\n'));
});

test('a transducer\'s examples are checked on their output', () => {
  resetApp();
  const m = JSON.parse(execFileSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync('js/examples/mealy.json','utf8'))"]).toString());
  m.meta.library = { author: { login: 'alice' }, license: 'CC0-1.0' };
  assert.ok(context.analyzeDocument(structuredClone(m)).facts.badges.some(b => b.id === 'tested'));
  m.meta.inputs[0].out = '0000';
  const r = context.analyzeDocument(m);
  assert.ok(r.errors.some(e => /→ 0000/.test(e)), r.errors.join('\n'));
});

test('an entry needs a title, an author that is a GitHub username, and a library licence', () => {
  resetApp();
  const d = evenOnes();
  d.meta.title = '';
  d.meta.library = { author: { login: 'not a login!' }, license: 'MIT' };
  const r = context.analyzeDocument(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /title/.test(e)));
  assert.ok(r.errors.some(e => /GitHub username/.test(e)));
  assert.ok(r.errors.some(e => /licen[cs]e must be one of/.test(e)));
});

test('a DFA whose δ branches is refused rather than badged', () => {
  resetApp();
  const d = evenOnes();
  d.transitions.push(T('t9', 's1', 's2', '0'));
  const r = context.analyzeDocument(d);
  assert.ok(!r.facts?.badges.some(b => b.id === 'deterministic'));
  assert.ok(r.errors.some(e => /deterministic/.test(e)), r.errors.join('\n'));
});

test('a Turing machine is run from a blank tape: halting is counted, never-halting is proven', () => {
  resetApp();
  const bb2 = context.analyzeDocument(docFromStandardTM('1RB1LB_1LA1RZ', { author: 'alice' }));
  const halts = bb2.facts.badges.find(b => b.id === 'halts');
  assert.equal(halts.detail, '6 steps');
  assert.deepEqual([bb2.facts.behaviour.steps, bb2.facts.behaviour.ones], [6, 4]);
  const loop = context.analyzeDocument(docFromStandardTM('0LB1RZ_1RA1RA_1RC1RB', { author: 'alice' }));
  assert.equal(loop.facts.behaviour.method, 'cycler');
  assert.ok(loop.facts.badges.some(b => b.id === 'never-halts' && b.detail === 'cycler'));
  assert.ok(!loop.warnings.some(w => /no examples/.test(w)), 'a proven TM is not nagged for examples');
});

test('every badge is about the machine: none says what the app can export', () => {
  resetApp();
  const ids = context.analyzeDocument(evenOnes()).facts.badges.map(b => b.id);
  assert.deepEqual(ids.sort(), ['deterministic', 'minimal', 'tested']);
  assert.deepEqual(Object.keys(context.BADGES).sort(), ['deterministic', 'halts', 'minimal', 'never-halts', 'tested']);
});

test('analysing a machine leaves the one on the canvas alone', () => {
  resetApp();
  context.App.machine = 'NFA';
  context.App.states = [S('q', 'mine')];
  context.App.startId = 'q';
  context.analyzeDocument(docFromStandardTM('1RB1LB_1LA1RZ', { author: 'a' }));
  context.analyzeDocument(evenOnes());
  assert.equal(context.App.machine, 'NFA');
  assert.deepEqual(context.App.states.map(s => s.name), ['mine']);
});

// ── Building the library ──────────────────────────────────────────

test('the build publishes what passed, and nothing that points at what failed', async () => {
  const b = await builtLibrary();
  const ids = b.index.entries.map(e => e.id);
  assert.ok(ids.includes('finite/dfa/even-ones'));
  assert.ok(!ids.includes('finite/dfa/liar'), 'an entry whose card lies is not published');
  assert.deepEqual(b.index.collections[0].entries, ['finite/dfa/even-ones', 'finite/dfa/odd-ones']);
  const failing = b.results.find(r => r.id === 'finite/dfa/liar');
  assert.ok(failing.errors.length);
  assert.match(reportMarkdown(b.results), /❌ `machines\/finite\/dfa\/liar\.automaton`/);
  assert.ok(!b.artifacts.some(a => a.path.includes('liar')), 'nor its pictures');
});

test('the published site serves only the files the index lists', async () => {
  const b = await builtLibrary();
  const out = await mkdtemp(join(tmpdir(), 'as-out-'));
  await writeLibrary({ library: b.root, out, noSite: true }, b);
  await readFile(join(out, 'machines/finite/dfa/even-ones.automaton'), 'utf8');
  await assert.rejects(readFile(join(out, 'machines/finite/dfa/liar.automaton'), 'utf8'), 'a file that failed is not served');
});

test('the build records remixes, the same language listed twice, and each entry\'s pictures', async () => {
  const b = await builtLibrary();
  const byId = new Map(b.index.entries.map(e => [e.id, e]));
  assert.deepEqual(byId.get('finite/dfa/even-ones').remixes, ['finite/dfa/even-ones-long']);
  const dups = b.index.entries.filter(e => e.duplicateOf).map(e => e.id);
  assert.ok(dups.includes('finite/nfa/even-ones'));
  assert.ok(!dups.includes('finite/dfa/odd-ones'));
  assert.deepEqual(byId.get('turing/busy-beaver/bb2').art.map(a => a.path), ['art/turing/busy-beaver/bb2/spacetime.svg', 'art/turing/busy-beaver/bb2/diagram.svg']);
  assert.equal(byId.get('finite/dfa/even-ones').hash, context.contentHash(await readFile(join(b.root, 'machines/finite/dfa/even-ones.automaton'), 'utf8')));
});

// ── Asking the index ──────────────────────────────────────────────

test('search reads words, filters, and — for finite automata — what a machine accepts', async () => {
  const { index } = await builtLibrary();
  const ids = q => context.queryLibrary(index, q).map(e => e.id);
  assert.equal(ids('busy beaver')[0], 'turing/busy-beaver/bb2');
  assert.deepEqual(ids('type:NFA'), ['finite/nfa/even-ones']);
  assert.ok(ids('accepts:11').includes('finite/dfa/even-ones'));
  assert.ok(!ids('accepts:11').includes('finite/dfa/odd-ones'));
  assert.ok(ids('accepts:1 rejects:11').includes('finite/dfa/odd-ones'));
  assert.ok(ids('badge:never-halts').includes('turing/non-halting/cycler'));
  assert.ok(ids('states:<3').every(id => index.entries.find(e => e.id === id).stats.states < 3));
  assert.deepEqual(ids('by:bob'), ['finite/dfa/even-ones-long']);
  assert.deepEqual(context.queryLibrary(index, '', { filters: { family: 'tm' } }).map(e => e.category), ['tm', 'tm']);
});

test('an index from a newer build is refused, and one that is not an index at all', () => {
  assert.throws(() => context.normalizeIndex({ format: context.INDEX_FORMAT, version: context.INDEX_VERSION + 1, entries: [] }), /Update the app/);
  assert.throws(() => context.normalizeIndex({ format: 'something-else', entries: [] }), /not an AutomataStudio library index/);
});

// ── Fetching and keeping ──────────────────────────────────────────

test('the index is kept, and shown with a note when the network goes away', async () => {
  const { raw } = await builtLibrary();
  resetApp();
  context.fetch = fakeFetch({ 'index.json': JSON.stringify(raw) });
  const first = await context.loadLibrary();
  assert.equal(first.index.entries.length, raw.entries.length);
  context.fetch = async () => { throw new Error('offline'); };
  const again = await context.loadLibrary({ force: true });
  assert.equal(again.stale, true);
  assert.equal(again.index.entries.length, raw.entries.length, 'the last good copy, not an empty shelf');
});

test('switching the library source never shows the old source\'s machines under the new name', async () => {
  const { raw } = await builtLibrary();
  resetApp();
  context._resetLibraryClientForTests();
  context.setLibraryOverride(null);
  try {
    context.fetch = fakeFetch({ 'index.json': JSON.stringify(raw) });
    assert.ok((await context.loadLibrary()).index.entries.length);
    context.setLibraryOverride('http://127.0.0.1:8765/');
    assert.equal(context.cachedLibrary(), null, 'the published index is not this source\'s');
    context.fetch = async () => { throw new Error('connection refused'); };
    const r = await context.loadLibrary({ force: true });
    assert.equal(r.index, null, 'an unreachable source shows nothing, not the last library');
    assert.equal(r.stale, true);
  } finally {
    context.setLibraryOverride(null);
    context._resetLibraryClientForTests();
  }
});

test('a download that is not the file the index lists is refused', async () => {
  const { index } = await builtLibrary();
  resetApp();
  const e = index.entries.find(x => x.id === 'finite/dfa/even-ones');
  const real = JSON.stringify(evenOnes());
  context.fetch = fakeFetch({ 'even-ones.automaton': '{"tampered":true}' });
  await assert.rejects(context.fetchEntryText({ ...e, hash: context.contentHash(real) }, { ...index, commit: '' }), /does not match/);
});

test('My Library keeps a copy offline and says when a newer version is published', async () => {
  const { index } = await builtLibrary();
  resetApp();
  const e = index.entries.find(x => x.id === 'finite/dfa/even-ones');
  await context.saveToMyLibrary(e, 'old text');
  const saved = await context.listMyLibrary();
  assert.deepEqual(saved.map(r => r.id), ['finite/dfa/even-ones']);
  assert.deepEqual(context.updatesFor(saved, index).map(u => u.entry.id), ['finite/dfa/even-ones']);
  assert.equal(context.sourceIsOutdated({ id: e.id, hash: 'nope' }, index), true);
  assert.equal(context.sourceIsOutdated({ id: e.id, hash: e.hash }, index), false);
  // Offline, the saved copy is handed back rather than nothing.
  context.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(context.fetchEntryText({ ...e, hash: 'other' }, index), err => err.message === 'offline-copy' && err.text === 'old text');
});

// ── The machine card keeps its credit ─────────────────────────────

test('meta.library rides on the card through an edit and a save', () => {
  resetApp();
  const lib = { author: { login: 'alice' }, license: 'CC-BY-4.0', source: { id: 'x/y', hash: 'h' } };
  const meta = context.normalizeCardMeta({ title: 'T', library: lib });
  assert.deepEqual(meta.library, lib);
  context.App.meta = meta;
  assert.deepEqual(context.getWorkspaceData().meta.library, lib);
  assert.equal(context.normalizeCardMeta({ title: 'T', library: { big: 'x'.repeat(9000) } }).library, undefined, 'metadata, not a payload');
});

// ── The view ──────────────────────────────────────────────────────

function seedTab() {
  resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.App.machine = 'DFA';
  context.App.states = [S('q0', 'mine')];
  context.App.startId = 'q0';
  context.Workspaces.push({ id: 'w0', name: 'Mine', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

async function serveLibrary() {
  const b = await builtLibrary();
  const files = {};
  for (const e of b.raw.entries) files[e.path] = await readFile(join(b.root, e.path), 'utf8');
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '' }), ...files });
  return b;
}

test('opening an entry puts it in a tab of its own and remembers where it came from', async () => {
  await serveLibrary();
  seedTab();
  await context.loadLibrary();
  const ok = await context.openLibraryEntryById('finite/dfa/even-ones');
  assert.equal(ok, true);
  assert.equal(context.Workspaces.length, 2, 'the machine that was on the canvas keeps its tab');
  assert.equal(context.App.meta.title, 'Even number of 1s');
  assert.equal(context.App.meta.library.source.id, 'finite/dfa/even-ones');
  assert.equal(context.App.meta.library.author.login, 'alice');
  assert.deepEqual(context.recentLibraryIds().slice(0, 1), ['finite/dfa/even-ones']);
  assert.equal(context.Workspaces.find(w => w.id === context.activeWorkspaceId).name, 'Even number of 1s');
});

test('an entry read into an untouched tab gives the tab its name', async () => {
  await serveLibrary();
  resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Workspace 1', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
  await context.loadLibrary();
  await context.openLibraryEntryById('turing/busy-beaver/bb2');
  assert.equal(context.Workspaces.length, 1);
  assert.equal(context.Workspaces[0].name, 'BB(2) champion');
});

test('the Library view draws the discover page and an entry\'s listing', async () => {
  await serveLibrary();
  seedTab();
  context.renderLibraryView();
  await context.loadLibrary();
  context.go('discover', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.match(textOf(host), /A catalogue of automata/);
  assert.match(textOf(host), /Busy|BB\(2\)/);
  context.go('entry', 'turing/busy-beaver/bb2');
  const page = textOf(host);
  assert.match(page, /BB\(2\) champion/);
  assert.match(page, /Halts from a blank tape after/);
  assert.match(page, /Verified by the library/);
  assert.match(page, /Definition/);
  assert.equal(context.libraryRoute().page, 'entry');
});

test('a listing typesets the machine\'s own formal definition from its file', async () => {
  await serveLibrary();
  seedTab();
  context.renderMathInElement = () => {};   // KaTeX is the page's; here the source is what is checked
  try {
    context.renderLibraryView();
    await context.loadLibrary();
    context.go('entry', 'finite/dfa/even-ones', { reset: true });
    const host = context.document.getElementById('lib-content');
    const math = findAll(host, n => n.classList?.contains('lib-math'))[0];
    for (let i = 0; i < 50 && !math.textContent; i++) await new Promise(r => setTimeout(r, 10));
    assert.match(math.textContent, /M &= \(Q, \\Sigma, \\delta, q_0, F\)/);
    assert.match(math.textContent, /\\text\{even\}|even/, 'its own state names, not the canvas machine\'s');
    assert.equal(context.App.states[0].name, 'mine', 'and the canvas is untouched');
  } finally {
    delete context.renderMathInElement;
  }
});

test('a library link opens the listing, and a desktop link that arrives early waits for the boot', async () => {
  await serveLibrary();
  seedTab();
  await context.loadLibrary();
  await context.handleLibraryRequest({ action: 'show', id: 'finite/dfa/odd-ones' });
  assert.deepEqual(context.libraryRoute(), { page: 'entry', id: 'finite/dfa/odd-ones' });
  const seen = [];
  context.setLibraryRequestHandler(null);
  context.requestLibrary('automata-studio://library/finite/dfa/even-ones');
  assert.deepEqual(seen, []);
  context.setLibraryRequestHandler(url => seen.push(url));
  assert.deepEqual(seen, ['automata-studio://library/finite/dfa/even-ones']);
  context.setLibraryRequestHandler(null);
});

test('a library Turing machine drops into a Turing machine as a building block', async () => {
  resetApp();
  context.App.machine = 'TM';
  context.App.states = [];
  const def = context.blockDefinitionFromDoc(docFromStandardTM('1RB1LB_1LA1RZ', { author: 'a' }), 'bb2');
  const block = context.placeBlockDefinition({ ...def, machine: 'TM' }, { x: 0, y: 0 });
  assert.ok(block);
  assert.equal(context.App.states.filter(s => s.blockId === block.id).length, 3);
});

// ── Submitting ────────────────────────────────────────────────────

test('the submission is checked before it is filed: agreement, badges and duplicates', async () => {
  const { index } = await builtLibrary();
  resetApp();
  const d = evenOnesBloated();
  context.loadData(d, true);
  context.App.meta = { title: 'Mine', blurb: 'x', inputs: [{ w: '11', expect: 'accept' }] };
  const fields = { ...context.submissionDefaults(), title: 'Parity again', blurb: 'Counts 1s.', login: 'carol', license: 'CC0-1.0', agreed: false };
  let c = context.precheckSubmission(fields, index);
  assert.equal(c.ok, false);
  assert.ok(c.errors.some(e => /Tick the box/.test(e)));
  c = context.precheckSubmission({ ...fields, agreed: true }, index);
  assert.equal(c.ok, true, c.errors.join('\n'));
  assert.ok(c.duplicates.some(e => e.id === 'finite/dfa/even-ones'), 'the language is already listed');
  assert.equal(c.doc.meta.library.author.login, 'carol');
  assert.equal(c.doc.exercise, undefined);
});

test('a library machine sent straight back is refused; changed, it is a remix', async () => {
  const { index } = await builtLibrary();
  resetApp();
  const text = JSON.stringify(evenOnes());
  const e = index.entries.find(x => x.id === 'finite/dfa/even-ones');
  const opened = context.stampSource(text, e);
  context.loadData(opened, true);
  context.App.meta = opened.meta;
  context.App.states[1].x += 300;   // moved, not changed
  const fields = { ...context.submissionDefaults(), login: 'carol', agreed: true };
  assert.equal(fields.forkOf, 'finite/dfa/even-ones', 'opened from the library, so a remix of it');
  assert.ok(context.precheckSubmission(fields, index).errors.some(x => /exactly as the library has it/.test(x)));
  context.App.accepts = new Set(['s2']);
  assert.ok(!context.precheckSubmission(fields, index).errors.some(x => /exactly as the library has it/.test(x)));
});

test('an author\'s own entry, opened and changed, is an update of it — not a remix of itself', async () => {
  const { index } = await builtLibrary();
  resetApp();
  const e = index.entries.find(x => x.id === 'finite/dfa/even-ones');
  const opened = context.stampSource(JSON.stringify(evenOnes()), e);
  context.loadData(opened, true);
  context.App.meta = opened.meta;
  const fields = { ...context.submissionDefaults(), login: 'alice', agreed: true, blurb: 'Reworded.' };
  const c = context.precheckSubmission(fields, index);
  assert.equal(c.ok, true, c.errors.join('\n'));
  assert.equal(c.update?.id, 'finite/dfa/even-ones', 'rewording your own card is an update');
  assert.equal(c.doc.meta.library.forkOf, undefined, 'and not a remix of itself');
  assert.ok(!c.duplicates.some(d => d.id === e.id), 'nor a duplicate of itself');
  const url = new URL(context.issueUrlFor({ ...fields, updates: c.update.id, forkOf: '' }, 'LINK', 'o/r'));
  assert.equal(url.searchParams.get('updates'), 'finite/dfa/even-ones');
  // Anyone else opening it is remixing it.
  const other = context.precheckSubmission({ ...fields, login: 'carol' }, index);
  assert.equal(other.update, null);
  assert.equal(other.doc.meta.library.forkOf, 'finite/dfa/even-ones');
});

test('the issue URL carries the form, and a machine too long for a URL is left for the clipboard', async () => {
  resetApp();
  const fields = { title: 'T', blurb: 'B', tags: 'a, B c', license: 'CC-BY-4.0', difficulty: 'intro', forkOf: 'x/y', kind: 'machine' };
  const url = new URL(context.issueUrlFor(fields, 'LINK', 'o/r'));
  assert.equal(url.origin + url.pathname, 'https://github.com/o/r/issues/new');
  assert.equal(url.searchParams.get('template'), 'submit-machine.yml');
  assert.equal(url.searchParams.get('tags'), 'a, b-c');
  assert.equal(url.searchParams.get('remix-of'), 'x/y');
  assert.equal(url.searchParams.get('machine'), 'LINK');
  const big = evenOnes();
  // Incompressible on purpose: the link is DEFLATEd, so a repetitive note of
  // any length would still fit.
  let seed = 12345;
  const noise = Array.from({ length: 20000 }, () => String.fromCharCode(33 + ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) % 90)).join('');
  big.notes = [{ id: 'n1', text: noise, x: 0, y: 0 }];
  const res = await context.submissionLink(fields, big, 'o/r');
  assert.equal(res.included, false);
  assert.ok(!new URL(res.url).searchParams.get('machine'));
  assert.ok(res.link.startsWith(context.APP_WEB_URL + '#share='), 'the link a reviewer clicks opens the published app');
});

test('an issue becomes an entry credited to the issue\'s author, whatever the form says', async () => {
  resetApp();
  const root = await mkdtemp(join(tmpdir(), 'as-issue-'));
  const d = evenOnes();
  d.meta.library.author.login = 'mallory';
  const link = await context.shareLinkFor(d);
  const body = [
    '### Name', '', 'Parity checker', '',
    '### Description', '', 'Even number of 1s.', '',
    '### Machine', '', '```text', link, '```', '',
    '### Tags', '', 'parity, Mod 2', '',
    '### Licence', '', 'CC0-1.0', '',
    '### Remix of', '', '_No response_', '',
    '### Agreement', '', '- [X] I made this machine'
  ].join('\n');
  assert.equal(parseIssueForm(body)['remix of'], '');
  const r = await processIssue({ body, author: 'dana', number: 7, root });
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.equal(r.path, 'machines/finite/dfa/parity-checker.automaton');
  const written = JSON.parse(await readFile(join(root, r.path), 'utf8'));
  assert.equal(written.meta.library.author.login, 'dana');
  assert.equal(written.meta.library.license, 'CC0-1.0');
  assert.deepEqual(written.meta.library.tags, ['parity', 'mod-2']);
  // Someone else submitting the same title lands beside it, not over it.
  const r2 = await processIssue({ body, author: 'erin', number: 8, root });
  assert.equal(r2.path, 'machines/finite/dfa/parity-checker-erin.automaton');
  // The author submitting again updates their own.
  const r3 = await processIssue({ body, author: 'dana', number: 9, root });
  assert.equal(r3.path, r.path);
  assert.equal(r3.update, true);
  // No agreement, no entry.
  const r4 = await processIssue({ body: body.replace('[X]', '[ ]'), author: 'dana', number: 10, root });
  assert.equal(r4.ok, false);
  assert.ok(r4.problems.some(p => /agreement/.test(p)));
});

function issue({ name, machine, remixOf = '', updates = '', readme = '' }) {
  return [
    '### Name', '', name, '',
    '### Description', '', 'A machine.', '',
    '### Machine', '', '```text', machine, '```', '',
    '### Write-up', '', readme || '_No response_', '',
    '### Remix of', '', remixOf || '_No response_', '',
    '### Updates', '', updates || '_No response_', '',
    '### Licence', '', 'CC-BY-4.0', '',
    '### Agreement', '', '- [X] I made this machine'
  ].join('\n');
}

test('an update replaces the author\'s entry — under a new title too — and only theirs', async () => {
  resetApp();
  const root = await mkdtemp(join(tmpdir(), 'as-issue-'));
  const link = await context.shareLinkFor(evenOnes());
  const first = await processIssue({ body: issue({ name: 'Parity checker', machine: link }), author: 'dana', number: 1, root });
  assert.equal(first.ok, true, first.problems.join('\n'));
  // The app's path: "Updates" names the entry, and "Remix of" still names it too.
  const r = await processIssue({ body: issue({ name: 'Parity, renamed', machine: link, remixOf: first.id, updates: first.id }), author: 'dana', number: 2, root });
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.equal(r.path, first.path);
  assert.equal(r.update, true);
  const written = JSON.parse(await readFile(join(root, r.path), 'utf8'));
  assert.equal(written.meta.title, 'Parity, renamed');
  assert.equal(written.meta.library.forkOf, undefined, 'an update is not a remix of itself');
  // By hand, "Remix of" naming your own entry means the same.
  const byHand = await processIssue({ body: issue({ name: 'Parity again', machine: link, remixOf: first.id }), author: 'dana', number: 3, root });
  assert.equal(byHand.path, first.path);
  // Someone else cannot update it.
  const theft = await processIssue({ body: issue({ name: 'Mine now', machine: link, updates: first.id }), author: 'erin', number: 4, root });
  assert.equal(theft.ok, false);
  assert.ok(theft.problems.some(p => /only they can update it/.test(p)));
  // A remix of something that is not in the library is refused before it becomes a PR.
  const orphan = await processIssue({ body: issue({ name: 'Orphan', machine: link, remixOf: 'finite/dfa/nowhere' }), author: 'erin', number: 5, root });
  assert.ok(orphan.problems.some(p => /not in the library/.test(p)));
  // The build that publishes it never drops it for naming itself.
  const selfish = JSON.parse(await readFile(join(root, first.path), 'utf8'));
  selfish.meta.library.forkOf = first.id;
  await writeFile(join(root, first.path), JSON.stringify(selfish));
  const built = await buildLibrary({ library: root, site: 'https://x.test/' });
  assert.ok(built.raw.entries.some(e => e.id === first.id), 'a self-remix is ignored, not a reason to unpublish');
});

test('an exercise keeps its checker, which the issue\'s title — not its body — asks for', async () => {
  resetApp();
  const root = await mkdtemp(join(tmpdir(), 'as-issue-'));
  const d = evenOnes();
  const t = context.targetFromDoc(evenOnes());
  d.exercise = { version: 1, id: 'x', title: 'X', prompt: 'Build it.', target: context.sealTarget(t), answer: 'machine', allow: ['DFA'], maxLength: 6, maxWords: 500, hints: [], reveal: false, assist: 'off', progress: {} };
  const body = issue({ name: 'Parity exercise', machine: await context.shareLinkFor(d) });
  const asExercise = await processIssue({ body, author: 'dana', number: 1, root, title: '[Exercise] Parity exercise' });
  assert.equal(asExercise.ok, true, asExercise.problems.join('\n'));
  assert.ok(JSON.parse(await readFile(join(root, asExercise.path), 'utf8')).exercise);
  const asMachine = await processIssue({ body: body.replace('Parity exercise', 'Parity machine'), author: 'dana', number: 2, root, title: '[Machine] Parity machine' });
  assert.equal(JSON.parse(await readFile(join(root, asMachine.path), 'utf8')).exercise, undefined);
});

test('a write-up with headings of its own is read whole', () => {
  const form = parseIssueForm(issue({ name: 'X', machine: 'M', readme: 'Intro.\n\n### How it works\n\nIt counts.\n\n### Machine\n\nnot the machine' }));
  assert.equal(form['write-up'], 'Intro.\n\n### How it works\n\nIt counts.\n\n### Machine\n\nnot the machine');
  assert.match(form.machine, /^```text\nM\n```$/);
  assert.equal(form['remix of'], '');
});

test('a Turing machine in the standard format is accepted straight from the issue', async () => {
  resetApp();
  const root = await mkdtemp(join(tmpdir(), 'as-issue-'));
  // Fenced, the way GitHub renders the form's `render: text` field.
  const body = '### Name\n\nMy beaver\n\n### Description\n\nTwo states.\n\n### Machine\n\n```text\n1RB1LB_1LA1RZ\n```\n\n### Licence\n\nCC-BY-4.0\n\n### Agreement\n\n- [x] yes';
  const r = await processIssue({ body, author: 'dana', number: 1, root });
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.match(r.path, /^machines\/turing\/ittm\//);
  assert.match(r.report, /halts/);
});

test('only an entry\'s author or a maintainer may change it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'as-guard-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  await mkdir(join(root, 'machines/finite/dfa'), { recursive: true });
  await writeFile(join(root, 'machines/finite/dfa/a.automaton'), JSON.stringify(evenOnes()));
  git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'change');
  const edited = evenOnes(); edited.meta.blurb = 'changed';
  await writeFile(join(root, 'machines/finite/dfa/a.automaton'), JSON.stringify(edited));
  await writeFile(join(root, 'machines/finite/dfa/b.automaton'), JSON.stringify(evenOnes({ library: { author: { login: 'bob' } } })));
  git('add', '-A'); git('commit', '-qm', 'edit');
  const asBob = await guardChanges({ root, base: 'main', author: 'bob' });
  assert.ok(asBob.some(p => /a\.automaton.*credited to @alice/.test(p)));
  assert.ok(!asBob.some(p => /b\.automaton/.test(p)));
  const asAlice = await guardChanges({ root, base: 'main', author: 'alice' });
  assert.ok(asAlice.some(p => /b\.automaton.*credits @bob/.test(p)));
  assert.deepEqual(await guardChanges({ root, base: 'main', author: 'carol', maintainers: ['Carol'] }), []);
  assert.deepEqual(await guardChanges({ root, base: 'main', author: 'github-actions[bot]' }), []);
});

test('a pull request cannot make its own author a maintainer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'as-guard-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  await mkdir(join(root, 'machines/x'), { recursive: true });
  await writeFile(join(root, 'machines/x/a.automaton'), JSON.stringify(evenOnes()));
  await writeFile(join(root, 'library.config.json'), JSON.stringify({ maintainers: ['owner'] }));
  git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'take-over');
  const stolen = evenOnes(); stolen.meta.library.author.login = 'mallory';
  await writeFile(join(root, 'machines/x/a.automaton'), JSON.stringify(stolen));
  await writeFile(join(root, 'library.config.json'), JSON.stringify({ maintainers: ['owner', 'mallory'] }));
  git('add', '-A'); git('commit', '-qm', 'take over');
  const maintainers = maintainersAt(root, 'main');
  assert.deepEqual(maintainers, ['owner'], 'the list is read from the base branch');
  const problems = await guardChanges({ root, base: 'main', author: 'mallory', maintainers });
  assert.ok(problems.some(p => /credited to @alice/.test(p)), problems.join('\n'));
  assert.ok(problems.some(p => /library\.config\.json.*maintainers/.test(p)), problems.join('\n'));
});

// ── StateMate ─────────────────────────────────────────────────────

test('StateMate can search the library it has loaded', async () => {
  await serveLibrary();
  resetApp();
  const session = context.createAgentSession(context.machineToSpec ? {} : {}, { intent: 'answer' });
  await context.loadLibrary();
  const [call] = context.executeAgentToolCalls([{ id: 'c1', name: 'search_library', arguments: { query: 'busy beaver', limit: 3 } }], session, { authority: 'ask' });
  assert.equal(call.ok, true, JSON.stringify(call));
  assert.equal(call.result.available, true);
  assert.equal(call.result.results[0].id, 'turing/busy-beaver/bb2');
  assert.match(call.result.results[0].link, /#library=turing%2Fbusy-beaver%2Fbb2$/);
});

// ── Busy beavers, by their code ───────────────────────────────────

test('a one-tape Turing machine is written back in the standard format exactly', async () => {
  resetApp();
  const { readStandardTM, writeStandardTM } = await import('../js/interop/standard-tm.js');
  for (const src of ['1RB1LB_1LA1RZ', '1RB1LB_1LA0LC_1RZ1LD_1RD0RA', '1RB2LA1RA1RA_1LB1LA3RB1RZ', '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', '1LB0RC_0RA---_1LB0LA']) {
    assert.equal(writeStandardTM(readStandardTM(src, sym()), sym()), src);
  }
  // What the notation cannot say is refused, not approximated.
  const tm = readStandardTM('1RB1LB_1LA1RZ', sym());
  assert.equal(writeStandardTM({ ...tm, transitions: tm.transitions.map((t, i) => (i ? t : { ...t, dir: 'S' })) }, sym()), null);
  assert.equal(writeStandardTM({ ...tm, machine: 'MTM' }, sym()), null);
});

test('every library TM carries its code, and searching by the code finds it', async () => {
  const { index } = await builtLibrary();
  const bb2 = index.entries.find(e => e.id === 'turing/busy-beaver/bb2');
  assert.equal(bb2.standard, '1RB1LB_1LA1RZ');
  assert.equal(context.queryLibrary(index, '1RB1LB_1LA1RZ')[0].id, bb2.id);
  assert.equal(index.entries.find(e => e.id === 'finite/dfa/even-ones').standard, null);
});

test('a collection of Turing machines is drawn with its table, and featured collections get a shelf', async () => {
  const b = await builtLibrary();
  resetApp();
  const raw = { ...b.raw, commit: '', featured: ['parity'] };
  raw.collections = [...raw.collections, { id: 'beavers', title: 'Beavers', blurb: '', curator: 'alice', entries: ['turing/busy-beaver/bb2', 'turing/non-halting/cycler'] }];
  context.fetch = fakeFetch({ 'index.json': JSON.stringify(raw) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('discover', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.match(textOf(host), /Parity/);
  context.go('collection', 'beavers');
  const page = textOf(host);
  assert.match(page, /At a glance/);
  assert.match(page, /1RB1LB_1LA1RZ/);
  assert.match(page, /∞/, 'the proven non-halter reads as never halting');
  const hrefs = findAll(host, n => n._attrs && /bbchallenge\.org/.test(n._attrs.get('href') || '')).map(n => n._attrs.get('href'));
  assert.ok(hrefs.includes('https://bbchallenge.org/1RB1LB_1LA1RZ&status=halt'), hrefs.join('\n'));
});

// ── The local emulator ────────────────────────────────────────────

test('a library source link is accepted only for this machine', () => {
  assert.equal(context.parseLibrarySourceHash('#library-source=http%3A%2F%2Flocalhost%3A8765%2F'), 'http://localhost:8765/');
  assert.equal(context.parseLibrarySourceHash('#library-source=http://127.0.0.1:9000'), 'http://127.0.0.1:9000/');
  assert.equal(context.parseLibrarySourceHash('#library-source=https://evil.example/'), null);
  assert.equal(context.parseLibrarySourceHash('#library-source=javascript:alert(1)'), null);
});

test('the emulator\'s form is the real issue form, field for field', async () => {
  const { FORM_FIELDS } = await import('../scripts/library/dev-server.mjs');
  const yml = await readFile(new URL('../library-template/.github/ISSUE_TEMPLATE/submit-machine.yml', import.meta.url), 'utf8');
  const ids = [...yml.matchAll(/^\s+id:\s*(\S+)/gm)].map(m => m[1]);
  const labels = [...yml.matchAll(/^\s+label:\s*(.+)$/gm)].map(m => m[1].trim()).filter(l => !l.startsWith('I made'));
  assert.deepEqual(FORM_FIELDS.map(f => f.id), ids);
  assert.deepEqual(FORM_FIELDS.map(f => f.label), labels);
});

function http(port, method, path, form = null) {
  return import('node:http').then(({ request }) => new Promise((ok, fail) => {
    const data = form ? new URLSearchParams(form).toString() : null;
    const headers = data ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {};
    const r = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', fail);
    r.end(data || undefined);
  }));
}

test('the emulator serves a library, takes a submission through the real pipeline, and rebuilds', async () => {
  resetApp();
  const { createLibraryServer } = await import('../scripts/library/dev-server.mjs');
  const root = await mkdtemp(join(tmpdir(), 'as-emulator-'));
  await mkdir(join(root, 'machines/finite/dfa'), { recursive: true });
  await writeFile(join(root, 'machines/finite/dfa/even-ones.automaton'), JSON.stringify(evenOnes()));
  const port = 19000 + Math.floor(Math.random() * 900);
  const lib = await createLibraryServer({ library: root, port, app: 'http://localhost:5173/', author: 'octocat' }).start();
  try {
    const first = await http(port, 'GET', '/index.json');
    const index = JSON.parse(first.body);
    assert.equal(index.emulator, true);
    assert.equal(index.submit, `http://127.0.0.1:${port}/_emulator/issues/new`);
    assert.equal(first.headers['access-control-allow-origin'], '*');
    assert.match((await http(port, 'GET', '/_emulator/issues/new?name=Hello')).body, /value="Hello"/);
    assert.match((await http(port, 'GET', '/_emulator/')).body, /1 entries · 0 collections/, 'the dashboard draws');
    const link = await context.shareLinkFor(oddOnes());
    const res = await http(port, 'POST', '/_emulator/issues', {
      title: '[Machine] Odd ones', account: 'dana', name: 'Odd number of ones', description: 'Odd parity.',
      machine: link, license: 'CC0-1.0', agreement: 'on'
    });
    assert.equal(res.status, 303);
    assert.match((await http(port, 'GET', res.headers.location)).body, /Merged/);
    const after = JSON.parse((await http(port, 'GET', '/index.json')).body);
    const added = after.entries.find(e => e.id === 'finite/dfa/odd-number-of-ones');
    assert.ok(added, after.entries.map(e => e.id).join(', '));
    assert.equal(added.author.login, 'dana');
    assert.match((await http(port, 'GET', '/m/finite/dfa/odd-number-of-ones/')).body, /Odd number of ones/);
    const escape = await http(port, 'GET', '/%2e%2e/%2e%2e/package.json');
    assert.notEqual(escape.status, 200, 'nothing outside the built site is served');
  } finally {
    await lib.stop();
  }
});

// ── Card art ──────────────────────────────────────────────────────

test('each machine gets the pictures that suit it: a run, a diagram, a language', () => {
  resetApp();
  const kinds = d => context.cardArt(context.targetFromDoc(d)).map(a => a.kind);
  assert.deepEqual(kinds(docFromStandardTM('1RB1LB_1LA1RZ', { author: 'a' })), ['spacetime', 'diagram']);
  assert.deepEqual(kinds(evenOnes()), ['diagram', 'language']);
  const buchi = JSON.parse(execFileSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync('js/examples/buchi.json','utf8'))"]).toString());
  assert.deepEqual(kinds(buchi), ['diagram'], 'an ω-automaton has no finite words to draw');
});

test('the language picture is the same for every machine with the same language', () => {
  resetApp();
  const lang = d => context.cardArt(context.targetFromDoc(d)).find(a => a.kind === 'language').svg;
  assert.equal(lang(evenOnes()), lang(evenOnesBloated()));
  assert.equal(lang(evenOnes()), lang(evenOnesNfa()));
  assert.notEqual(lang(evenOnes()), lang(oddOnes()));
});

test('the build writes every picture and lists them on the entry', async () => {
  const b = await builtLibrary();
  const e = b.index.entries.find(x => x.id === 'turing/busy-beaver/bb2');
  assert.deepEqual(e.art.map(a => a.kind), ['spacetime', 'diagram']);
  for (const a of e.art) assert.ok(b.artifacts.some(x => x.path === a.path && x.text.startsWith('<svg')), a.path);
});

// ── Cards on screen ───────────────────────────────────────────────

test('a plate on the website is the app\'s plate: one figure drawn from the index, a caption, the checks in words', () => {
  const e = { badges: ['tested', 'minimal', 'deterministic', 'halts'].map(id => ({ id, detail: '' })), behaviour: { verdict: 'halts', steps: 47176870 } };
  assert.deepEqual(context.rankBadges(e.badges).map(b => b.id).slice(0, 3), ['halts', 'tested', 'minimal']);
  const tm = { id: 'turing/x', title: 'X <b>', machine: 'ITM', category: 'tm', standard: '1RB1LB_1LA1RZ', stats: { states: 3, sigma: ['1'] }, author: { login: 'a' }, art: [{ kind: 'diagram', path: 'art/x/diagram.svg' }], ...e };
  const html = context.plateHtml(tm);
  assert.match(html, /ITM · 2×2 · halts in 47\.2M/, 'the halting answer is in the caption');
  assert.match(html, />Tested · Minimal · Deterministic</, 'the rest in words, the halt not repeated');
  assert.match(html, /X &lt;b&gt;/, 'the title is escaped');
  assert.equal((html.match(/<svg /g) || []).length, 1, 'one figure');
  assert.match(html, /class="fig is-run"/, 'a Turing machine is known by its run');
  assert.doesNotMatch(html, /<img /, 'drawn, not fetched');
  assert.doesNotMatch(html, /(fill|stroke)="#/, 'inked by the stylesheet');
  assert.match(html, /data-family="tm"/);
  assert.match(html, /data-id="turing\/x"/, 'the search reorders plates by id');
  const big = context.plateHtml({ ...tm, standard: '', behaviour: null, sketch: null });
  assert.match(big, /<img src="\.\/art\/x\/diagram\.svg"/, 'too large for a sketch: the build\'s picture');
});

test('a Turing machine\'s size is read off its code, so a halt state is never counted', () => {
  assert.deepEqual(context.standardSize('1RB1LB_1LA1RZ'), { states: 2, symbols: 2 });
  assert.deepEqual(context.standardSize('1RB2LA1RA1RA_1LB1LA3RB1RZ'), { states: 2, symbols: 4 });
  const e = { machine: 'ITM', standard: '1RB1LB_1LA1RZ', stats: { states: 3, sigma: ['1'] } };
  assert.equal(context.plateCaption({ ...e, behaviour: { verdict: 'halts', steps: 6 } }), 'ITM · 2×2 · halts in 6');
  assert.equal(context.plateCaption({ ...e, behaviour: { verdict: 'unknown' } }), 'ITM · 2×2', 'the same size when the budget ran out');
  assert.equal(context.standardSize(null), null);
});

test('step counts are short and read cleanly', () => {
  assert.deepEqual([999, 2500, 4700000, 999950, 47176870, 3932964].map(context.shortCount), ['999', '2.5k', '4.7M', '1M', '47.2M', '3.93M']);
});

test('a plate holds one figure, drawn in the app from the index, and a listing lets the reader choose', async () => {
  const b = await builtLibrary();
  resetApp();
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '' }) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('browse', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  const plates = findAll(host, n => n.classList?.contains('lib-plate'));
  assert.ok(plates.length > 3);
  for (const p of plates) {
    const figs = findAll(p, n => n.classList?.contains('lib-fig'));
    assert.equal(figs.length, 1);
    assert.match(figs[0].innerHTML, /^<svg class="sk/, 'drawn here, not fetched');
  }
  const bb2 = plates.find(p => /BB\(2\)/.test(textOf(p)));
  assert.match(findAll(bb2, n => n.classList?.contains('lib-fig'))[0].innerHTML, /sk-run/, 'a Turing machine is known by its run');
  assert.match(textOf(bb2), /ITM · 2×2 · halts in 6/);
  context.go('entry', 'finite/dfa/even-ones');
  assert.deepEqual(findAll(host, n => n.classList?.contains('lib-figswitch-btn')).map(t => textOf(t)), ['Diagram', 'Language']);
  context.go('entry', 'turing/busy-beaver/bb2');
  assert.equal(findAll(host, n => n.classList?.contains('lib-figswitch-btn')).length, 0, 'one picture needs no switch');
  assert.ok(findAll(host, n => n.classList?.contains('lib-behaviour-fig') && /sk-run/.test(n.innerHTML || findAll(n, x => x.classList?.contains('lib-fig'))[0]?.innerHTML || '')).length, 'the run is drawn beside what it proves');
});

test('the listing\'s pictures switch over a browser\'s children, which is not an array', () => {
  // A browser's element.children is an HTMLCollection: indexable and iterable,
  // with no filter or find. The stub hands out arrays, which is how code that
  // threw on every call in Chromium once passed here.
  const tab = kind => { const set = new Set(); return { dataset: { kind }, classList: { contains: c => set.has(c), toggle: (c, f) => (f ? set.add(c) : set.delete(c)) }, setAttribute() {} }; };
  const tabs = [tab('diagram'), tab('language')];
  const collection = { length: 2, 0: tabs[0], 1: tabs[1], [Symbol.iterator]: function* () { yield* tabs; } };
  const pictures = new Map([['diagram', { say: 'd', node: { hidden: false } }], ['language', { say: 'l', node: { hidden: true } }]]);
  const stage = { pictures, caption: { textContent: '' }, switcher: { children: collection } };
  context.showPicture(stage, 'language');
  assert.deepEqual([pictures.get('diagram').node.hidden, pictures.get('language').node.hidden], [true, false]);
  assert.deepEqual(tabs.map(t => t.classList.contains('is-on')), [false, true]);
  assert.equal(stage.caption.textContent, 'l');
});

test('Browse shows a batch at a time, starts again for a new search, and keeps its place for the same one', async () => {
  const b = await builtLibrary();
  resetApp();
  const base = b.raw.entries.find(e => e.id === 'finite/dfa/even-ones');
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...base, id: `finite/dfa/copy-${String(i).padStart(3, '0')}`, title: `Copy ${String(i).padStart(3, '0')}`, remixes: [], forkOf: null, duplicateOf: null }));
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '', entries, collections: [], featured: [] }) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('browse', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  const count = () => findAll(host, n => n.classList?.contains('lib-plate')).length;
  const more = () => findAll(host, n => n.classList?.contains('lib-showmore-btn'))[0];
  assert.equal(count(), context.BROWSE_BATCH, 'one batch');
  assert.equal(textOf(more()), 'Show 48 more');
  more()._listeners.click({});
  assert.equal(count(), 96);
  assert.equal(textOf(more()), 'Show 4 more', 'the last batch says how many are left');
  more()._listeners.click({});
  assert.equal(count(), 100);
  assert.equal(findAll(host, n => n.classList?.contains('lib-showmore'))[0].hidden, true, 'nothing left to show');
  context.go('entry', 'finite/dfa/copy-000');
  context.go('browse');
  assert.equal(count(), 100, 'back to the same search: the same place');
  const input = findAll(host, n => n.classList?.contains('lib-search'))[0];
  input.value = 'copy';
  input._listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(count(), context.BROWSE_BATCH, 'a new search starts again');
});

test('a list sorts by date added, last updated, title or size, either way, with undated entries last', () => {
  const entry = (id, title, added, updated, states) => ({ id, title, added, updated, machine: 'DFA', category: 'fa', stats: { states } });
  const idx = context.normalizeIndex({
    format: context.INDEX_FORMAT,
    entries: [
      entry('a', 'Alpha', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', 3),
      // 03:30Z: earlier than c, though "09" sorts after "05" as text.
      entry('b', 'Bravo', '2026-02-01T09:00:00+05:30', '', 5),
      entry('c', 'Charlie', '2026-02-01T05:00:00Z', '', 2),
      entry('d', 'Delta', '', '', 4)
    ]
  });
  const ids = (sort, dir) => context.queryLibrary(idx, '', { sort, dir }).map(e => e.id).join('');
  assert.equal(ids('added', 'desc'), 'cbad', 'newest first, by time rather than by text');
  assert.equal(ids('added', 'asc'), 'abcd', 'oldest first — and undated is still last');
  assert.equal(ids('added'), 'cbad', 'a date starts newest first');
  assert.equal(ids('updated', 'desc'), 'acbd');
  assert.equal(ids('newest'), 'acbd', 'the old name still means last updated');
  assert.equal(ids('title', 'desc'), 'dcba');
  assert.equal(ids('states'), 'cadb', 'fewest first');
  assert.equal(ids('states', 'desc'), 'bdac');
  assert.deepEqual(context.resolveSort('bogus', 'desc'), { key: 'relevance', dir: null });
  assert.deepEqual(context.resolveSort('smallest'), { key: 'states', dir: 'asc' });
  assert.deepEqual(context.recentEntries(idx, 'added', 2).map(e => e.id), ['c', 'b']);
  assert.deepEqual(context.recentEntries(idx, 'updated', 4).map(e => e.id), ['a'], 'recently updated holds only what changed after it was listed');
  assert.equal(context.plateDate(idx.entries[0], 'added'), 'Added 1 Jan 2026');
});

test('an entry git cannot date is dated by its file, and the build names the machine both home pages open on', async () => {
  const b = await builtLibrary();
  // The test library is not a repository of its own, like the emulator's.
  for (const e of b.raw.entries) assert.ok(context.dateOf(e.added) !== null, `${e.id} has a date added`);
  assert.ok(b.index.entries.some(e => e.id === b.index.frontispiece), 'the index names its frontispiece');
  assert.equal(b.index.entries.find(e => e.id === b.index.frontispiece).category, 'fa', 'a small finite automaton');
});

test('Discover opens on the frontispiece and the recently added, and Browse sorts either way', async () => {
  const b = await builtLibrary();
  resetApp();
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '' }) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('discover', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  const front = findAll(host, n => n.classList?.contains('lib-frontis'));
  assert.equal(front.length, 1, 'the masthead has its machine');
  assert.match(textOf(front[0]), new RegExp(b.index.entries.find(e => e.id === b.index.frontispiece).title));
  assert.ok(findAll(host, n => n.classList?.contains('lib-mast') && n.classList.contains('has-frontis')).length);
  assert.match(textOf(host), /Recently added/);
  assert.ok(findAll(host, n => n.classList?.contains('lib-plate-when')).some(n => /^Added /.test(n.textContent)), 'a date shelf dates its plates');
  const heads = findAll(host, n => n.classList?.contains('lib-sechead-title')).map(n => n.textContent);
  assert.ok(heads.indexOf('Recently added') < heads.indexOf('Collections'), 'what is new comes before the collections');
  // Nothing was updated after it was listed, so that shelf is absent — and an
  // absent shelf must not print, as a browser's append(null) would.
  assert.ok(!heads.includes('Recently updated'));
  assert.doesNotMatch(textOf(host), /\bnull\b/);

  context.go('browse');
  const selects = () => findAll(host, n => n.classList?.contains('lib-sort'));
  assert.equal(selects().length, 1, 'best match has one direction, so no second control');
  const sort = selects()[0];
  sort.value = 'title';
  sort._listeners.change();
  const titles = () => findAll(host, n => n.classList?.contains('lib-plate-title')).map(n => n.textContent);
  const az = titles();
  assert.deepEqual(az, [...az].sort((x, y) => x.localeCompare(y)));
  const dir = selects()[1];
  assert.equal(dir.value, 'asc');
  dir.value = 'desc';
  dir._listeners.change();
  assert.deepEqual(titles(), [...az].reverse(), 'Z → A');
});

test('Discover leads with the search, and an empty search offers a way forward', async () => {
  const b = await builtLibrary();
  resetApp();
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '', featured: ['parity'] }) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('discover', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  const page = textOf(host);
  assert.match(page, /A catalogue of automata/);
  assert.match(page, /verified by running/);
  assert.match(page, /Parity/, 'a featured collection is shown');
  assert.match(page, /DFA · NFA/, 'each family lists the types in it');
  assert.ok(findAll(host, n => n.classList?.contains('lib-search')).length);
  context.go('browse');
  const input = findAll(host, n => n.classList?.contains('lib-search'))[0];
  input.value = 'no such machine anywhere';
  input._listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.match(textOf(host), /No machine matches “no such machine anywhere”/);
  assert.match(textOf(host), /Submit a machine/);
});

test('the website: an entry credits its author with a search, and a collection of TMs gets its table', async () => {
  const b = await builtLibrary();
  const out = await mkdtemp(join(tmpdir(), 'as-site-'));
  const { writeSite } = await import('../scripts/library/site.mjs');
  const index = context.normalizeIndex(JSON.parse(JSON.stringify(b.raw)));
  index.collections.push({ id: 'beavers', title: 'Beavers', blurb: '', curator: '', entries: ['turing/busy-beaver/bb2', 'turing/non-halting/cycler'] });
  const listings = new Map(index.entries.map(e => [e.id, listingOf(b.sources.get(e.id), e)]));
  await writeSite(out, index, { site: 'https://x.test/', repo: 'o/r' }, { listings });
  const home = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(home, /class="mast[ "]/);
  assert.match(home, /BB\(2\) champion/);
  assert.match(home, /<span class="logo">Automata<em>Studio<\/em><\/span>/, 'the app\'s lockup');
  assert.match(home, /<figure class="frontis"[^>]*>[\s\S]*?class="sk-name"/, 'the masthead opens on a machine, drawn with its names');
  assert.match(home, /<head>[\s\S]*d\.dataset\.theme=t[\s\S]*<\/head>/, 'the scheme is set before the first paint');
  assert.match(home, /class="theme-toggle"/, 'and the reader can switch it');
  assert.match(home, /Recently added[\s\S]*?<div class="plates" data-when="added">[\s\S]*Collections/, 'the recently added, dated, before the collections');
  assert.match(home, /<select id="dir" class="sort" aria-label="Order" hidden>/, 'and the sort has a direction');
  const { frontispieceOf } = await import('../scripts/library/site.mjs');
  assert.equal(frontispieceOf(index, { frontispiece: 'turing/busy-beaver/bb2' }, listings).id, 'turing/busy-beaver/bb2', 'the library can choose its own');
  assert.equal(frontispieceOf(index, {}, listings).category, 'fa', 'otherwise a small finite automaton');
  assert.equal(await readFile(join(out, 'assets/favicon.svg'), 'utf8'), await readFile(new URL('../svgs/favicon.svg', import.meta.url), 'utf8'), 'and the app\'s own tab icon');
  assert.equal((home.match(/class="plate"/g) || []).length >= index.entries.length, true, 'every machine is on the page for the search to reorder');
  const page = await readFile(join(out, 'm/turing/busy-beaver/bb2/index.html'), 'utf8');
  assert.match(page, /href="\.\.\/\.\.\/\.\.\/\.\.\/\?q=by%3Aalice#all"/);
  assert.match(page, /og:image" content="https:\/\/x\.test\/art\/turing\/busy-beaver\/bb2\/diagram\.svg"/);
  assert.match(page, /Halts from a blank tape after <strong>6<\/strong> steps/);
  assert.match(page, /class="math">\$\$ \\begin\{aligned\} M &amp;= \(Q, \\Sigma, \\Gamma/, 'the definition, typeset from the file');
  const dfa = await readFile(join(out, 'm/finite/dfa/even-ones/index.html'), 'utf8');
  assert.match(dfa, /class="sk-name"/, 'the listing\'s diagram names its states');
  assert.match(dfa, /id="pic-language"/, 'and switches to the language without a script');
  assert.match(dfa, /class="verdict is-acc"/, 'the author\'s examples, run');
  const coll = await readFile(join(out, 'c/beavers/index.html'), 'utf8');
  assert.match(coll, /At a glance/);
  assert.match(coll, /<td class="mono" title="states × symbols">2 × 2<\/td>/);
  const lost = await readFile(join(out, '404.html'), 'utf8');
  assert.match(lost, /href="https:\/\/x\.test\/assets\/site\.css"/, 'served at any depth, so its links are absolute');
});

test('a second emulator on a busy port gives up before it watches anything', async () => {
  resetApp();
  const { createLibraryServer } = await import('../scripts/library/dev-server.mjs');
  const root = await mkdtemp(join(tmpdir(), 'as-emulator-'));
  await mkdir(join(root, 'machines/finite/dfa'), { recursive: true });
  await writeFile(join(root, 'machines/finite/dfa/even-ones.automaton'), JSON.stringify(evenOnes()));
  const port = 19000 + Math.floor(Math.random() * 900);
  const first = await createLibraryServer({ library: root, port, app: 'http://localhost:5173/' }).start();
  try {
    const second = createLibraryServer({ library: root, port, app: 'http://localhost:5173/' });
    await assert.rejects(second.start(), /EADDRINUSE/);
    assert.equal(second.state.built, null, 'it never built, so it never started watching');
  } finally {
    await first.stop();
  }
});

// ── Listings built around the run ─────────────────────────────────

test('a word\'s trace names the states, the edges and the symbols the player would show', () => {
  resetApp();
  const t = context.targetFromDoc(evenOnes());
  const tr = context.traceWord(t, '101');
  assert.deepEqual(tr.steps.map(s => s.states), [['s1'], ['s2'], ['s2'], ['s1']]);
  assert.deepEqual(tr.steps.map(s => s.tid), [null, 't2', 't3', 't4']);
  assert.deepEqual(tr.steps.map(s => s.read), [null, '1', '0', '1']);
  assert.equal(tr.final, 'accept', 'two 1s');
  assert.equal(tr.cut, false);
  assert.equal(context.traceWord(t, '1').final, 'reject');
  const nfa = context.traceWord(context.targetFromDoc(evenOnesNfa()), '11');
  assert.deepEqual(nfa.steps.at(-1).states, ['s1']);
  assert.ok(context.traceWord(t, 'x2').error, 'a word off Σ is an error, not a run');
});

test('a trace stops at its cap, so a machine that runs for millions of steps costs a few hundred', () => {
  resetApp();
  const bb = context.targetFromDoc(docFromStandardTM('1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', { author: 'a' }));
  const t0 = Date.now();
  const tr = context.traceWord(bb, '', 50);
  assert.equal(tr.steps.length, 51);
  assert.equal(tr.cut, true);
  assert.ok(Date.now() - t0 < 2000);
});

test('the live diagram addresses every state and every drawn edge', () => {
  resetApp();
  const live = context.liveDiagram(context.targetFromDoc(evenOnes()));
  for (const s of ['s1', 's2']) assert.ok(live.svg.includes(`data-s="${s}"`), s);
  for (const k of ['s1|s1', 's1|s2', 's2|s2', 's2|s1']) assert.ok(live.svg.includes(`data-e="${k}"`), k);
  assert.equal(live.edgeOf.get('t2'), 's1|s2');
  assert.equal(live.names.get('s2'), 'odd');
});

test('the listing leads with one action, keeps the rest in a menu, and reads as one page', async () => {
  const b = await builtLibrary();
  resetApp();
  context.fetch = fakeFetch({ 'index.json': JSON.stringify({ ...b.raw, commit: '' }) });
  context.renderLibraryView();
  await context.loadLibrary({ force: true });
  context.go('entry', 'turing/busy-beaver/bb2', { reset: true });
  const host = context.document.getElementById('lib-content');
  const primary = findAll(host, n => n.classList?.contains('btn-p') && textOf(n) === 'Open in a new tab');
  assert.equal(primary.length, 1);
  const menu = findAll(host, n => n.classList?.contains('lib-more-menu'))[0];
  assert.match(textOf(menu), /Download the \.automaton file/);
  assert.match(textOf(menu), /Copy link/);
  const heads = () => findAll(host, n => n.classList?.contains('lib-sechead-title')).map(t => textOf(t));
  assert.ok(findAll(host, n => n.classList?.contains('lib-try-input')).length, 'Try it sits under the figure');
  assert.deepEqual(heads().filter(t => t !== 'Notes'), ['Behaviour'], 'nothing related to show, so no section for it');
  context.go('entry', 'finite/dfa/even-ones');
  assert.ok(heads().includes('Related'), 'this one was remixed');
  assert.ok(!heads().includes('Behaviour'));
});

// ── Figures, in the theme's ink ───────────────────────────────────

test('a sketch is the machine\'s top level, packed small for the index and read back', () => {
  resetApp();
  const t = context.targetFromDoc(evenOnes());
  const sk = context.sketchFromTarget(t, x => x.symbol);
  assert.deepEqual(sk.nodes.map(n => [n.id, n.start, n.accept]), [['s1', true, true], ['s2', false, false]]);
  assert.deepEqual(sk.edges.map(e => [e.key, e.label]), [['s1|s1', '0'], ['s1|s2', '1'], ['s2|s2', '0'], ['s2|s1', '1']]);
  const packed = context.packSketch(sk);
  assert.deepEqual(packed.e, [[0, 0], [0, 1], [1, 1], [1, 0]]);
  const back = context.unpackSketch(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(back.nodes.map(n => [n.start, n.accept]), [[true, true], [false, false]]);
  assert.equal(context.unpackSketch({ n: [[0, 0, 0]], e: [[0, 5]] }).edges.length, 0, 'an edge to nowhere is dropped');
  const big = { nodes: Array.from({ length: 61 }, (_, i) => ({ id: `q${i}`, x: i, y: 0 })), edges: [] };
  assert.equal(context.packSketch(big), null, 'past the limit a card uses the build\'s picture');
});

test('a figure is inked by classes, never by colours, so it reads in every theme', () => {
  resetApp();
  const t = context.targetFromDoc(evenOnes({ states: [S('s1', '<even>'), S('s2', 'odd', 200)] }));
  const svg = context.drawSketch(context.sketchFromTarget(t, x => x.symbol), { w: 640, h: 360, names: true, labels: true, live: true });
  assert.doesNotMatch(svg, /(fill|stroke)="#/, 'no baked colour');
  assert.equal((svg.match(/class="sk-ah"/g) || []).length, 4, 'every edge ends in an arrowhead');
  assert.equal((svg.match(/class="sk-a"/g) || []).length, 1, 'one accepting ring');
  assert.equal((svg.match(/class="sk-s"/g) || []).length, 1, 'one start arrow');
  assert.match(svg, /&lt;even&gt;/, 'names are escaped');
  assert.match(svg, /data-s="s1"/);
  assert.match(svg, /data-e="s1\|s2"/);
  assert.equal(context.sketchAspect({ nodes: [{ x: 0, y: 0 }, { x: 1600, y: 0 }] }), 2.8, 'a wide machine gets a wide figure, within bounds');
});

test('the language picture is read off the minimal DFA, and a Turing machine\'s run off its code', () => {
  resetApp();
  const rows = context.languageRows(context.minimalDfaOf(context.targetFromDoc(evenOnes())));
  assert.deepEqual(rows.slice(0, 3), [[true], [true, false], [true, false, false, true]], 'ε, then 0 and 1, then 00 01 10 11');
  assert.equal(context.languageRows({ sigma: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], n: 1, start: 0, acc: [0], delta: Array(7).fill(0) }), null, 'too wide an alphabet for enough lengths');
  const frames = context.framesFromStandard('1RB1LB_1LA1RZ');
  assert.equal(frames.length, 7, 'six steps, and the halted tape');
  assert.equal(frames.at(-1).cells.length, 4, 'four ones');
  assert.equal(context.framesFromStandard('1RB1XB'), null, 'not a code');
  assert.doesNotMatch(context.drawRun(frames), /(fill|stroke)="#/);
  const fromTarget = context.runFramesOf(context.targetFromDoc(docFromStandardTM('1RB1LB_1LA1RZ', { author: 'a' })));
  assert.deepEqual(fromTarget.map(f => f.head), frames.slice(0, fromTarget.length).map(f => f.head), 'the engine\'s run and the code\'s agree');
});

test('the index carries each machine\'s sketch, and refuses one that is not', async () => {
  const b = await builtLibrary();
  const e = b.index.entries.find(x => x.id === 'finite/dfa/even-ones');
  assert.equal(e.sketch.n.length, 2);
  const bad = context.normalizeIndex({ format: context.INDEX_FORMAT, entries: [{ id: 'a/b', title: 'x', sketch: { n: [[0, 0, 0]], e: [[0, 3]] } }] });
  assert.equal(bad.entries[0].sketch, null);
});
