import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;

// The document that a file, a share link, a PNG payload and an IndexedDB
// record all carry. What is pinned here is the part that gets expensive
// retroactively: that every document says which schema it is, that a document
// from the future is refused rather than half-read, and that the chain which
// reads an older one is a declared list rather than a pile of `|| []`.

function dfa() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [
    { id: 's0', name: 'q0', x: 100, y: 100 },
    { id: 's1', name: 'q1', x: 300, y: 100 }
  ];
  App.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
}

// ── Every document says what it is ────────────────────────────────

test('a saved document names its format, schema and app', () => {
  dfa();
  const d = context.getWorkspaceData();

  assert.strictEqual(d.format, context.WORKSPACE_FORMAT);
  assert.strictEqual(d.schema, context.SCHEMA_VERSION);
  assert.strictEqual(typeof d.app, 'string');
  assert.ok(d.app.length, 'the build is recorded even when it is the dev placeholder');
});

test('the three fields lead the object', () => {
  dfa();
  // Not cosmetic: this is what a person opening the file in an editor reads
  // first, and it is what a converter written against the format keys on.
  assert.deepStrictEqual(Object.keys(context.getWorkspaceData()).slice(0, 3),
    ['format', 'schema', 'app']);
});

test('the share link and the file carry the same document', async () => {
  dfa();
  const link = await context.getShareableLink();
  const payload = link.slice(link.indexOf(context.SHARE_HASH_PREFIX) + context.SHARE_HASH_PREFIX.length);
  const shared = JSON.parse(await context.decodeSharePayload(payload));

  assert.strictEqual(shared.format, context.WORKSPACE_FORMAT);
  assert.strictEqual(shared.schema, context.SCHEMA_VERSION);
});

// ── A document from the future is refused ─────────────────────────

test('validateSchema refuses a newer schema rather than dropping its fields', () => {
  dfa();
  const future = { ...context.getWorkspaceData(), schema: context.SCHEMA_VERSION + 1 };

  assert.throws(() => context.validateSchema(future), /newer version/i,
    'reading it would silently drop what this build does not know, and the next save writes the loss back');
});

test('the refusal names both versions and the build that wrote it', () => {
  dfa();
  const future = { ...context.getWorkspaceData(), schema: 42, app: '9.9.9' };
  assert.throws(() => context.validateSchema(future), err => {
    assert.match(err.message, /42/);
    assert.match(err.message, new RegExp(String(context.SCHEMA_VERSION)));
    assert.match(err.message, /9\.9\.9/);
    return true;
  });
});

test('loadData refuses a future document too, for the paths that skip validation', () => {
  dfa();
  const future = { ...context.getWorkspaceData(), schema: context.SCHEMA_VERSION + 1 };
  // Examples, storage records and algorithm results all reach loadData without
  // going through validateSchema. The backstop has to be there too.
  assert.throws(() => context.loadData(future), /newer version/i);
});

test('a document at the current schema is accepted', () => {
  dfa();
  assert.strictEqual(context.validateSchema(context.getWorkspaceData()), true);
});

// ── Reading what came before ──────────────────────────────────────

test('a document with no schema field reads as legacy', () => {
  assert.strictEqual(context.readSchemaVersion({}), context.LEGACY_SCHEMA);
  assert.strictEqual(context.readSchemaVersion({ schema: 'nonsense' }), context.LEGACY_SCHEMA);
  assert.strictEqual(context.readSchemaVersion({ schema: -3 }), context.LEGACY_SCHEMA);
  assert.strictEqual(context.readSchemaVersion({ schema: 1 }), 1);
});

test('an unversioned file still loads, and comes out stamped', () => {
  dfa();
  const legacy = context.getWorkspaceData();
  delete legacy.format; delete legacy.schema; delete legacy.app;

  context.loadData(legacy);

  assert.strictEqual(context.App.machine, 'DFA');
  assert.strictEqual(context.App.states.length, 2);
  assert.strictEqual(legacy.schema, context.SCHEMA_VERSION, 'the chain stamps what it migrated');
});

test('migration is idempotent, so the backstop cannot double-apply it', () => {
  dfa();
  const doc = context.getWorkspaceData();
  delete doc.schema;

  const once = JSON.stringify(context.migrateWorkspaceDoc(doc));
  const twice = JSON.stringify(context.migrateWorkspaceDoc(context.migrateWorkspaceDoc(doc)));

  assert.strictEqual(once, twice,
    'validateSchema and loadData both run the chain; a second pass has to be a no-op');
});

test('a v0 file spelling its symbols literally is remapped to the reader\'s', () => {
  dfa();
  // A file predating configurable symbols writes ε, ⊔ and Z; this reader has
  // chosen different ones. That mapping is keyed on `config` being absent,
  // which is the one genuine v0 concern the chain carries.
  context.App.config.sym = { ...context.App.config.sym, eps: '@', blank: '_', stackBottom: '$' };

  const legacy = {
    machine: 'ε-NFA',
    sigma: ['a', 'ε'],
    states: [{ id: 's0', name: 'q0', x: 0, y: 0 }],
    transitions: [{ id: 't0', from: 's0', to: 's0', symbol: 'ε' }],
    accepts: [],
    startId: 's0'
    // no `config`, and no `schema`
  };

  context.migrateWorkspaceDoc(legacy);

  assert.strictEqual(legacy.transitions[0].symbol, '@');
  assert.ok(legacy.sigma.includes('@'));
});

test('a versioned file is left alone by the symbol migration', () => {
  dfa();
  context.App.config.sym = { ...context.App.config.sym, eps: '@' };
  const doc = { ...context.getWorkspaceData() };
  doc.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'ε' }];

  context.migrateWorkspaceDoc(doc);

  assert.strictEqual(doc.transitions[0].symbol, 'ε',
    'a document that carries its own config already means what it says');
});

// ── Normalisations, which are not migrations ──────────────────────

test('a nondeterministic TM is re-typed whatever schema it claims', () => {
  // This is not an old-format correction: a JFLAP import, a hand-edited file
  // and an algorithm result can all produce a branching δ under a
  // deterministic type name, and none of those has a version to key on.
  const branching = [
    { id: 't0', from: 's0', to: 's0', symbol: 'a', write: 'a', move: 'R' },
    { id: 't1', from: 's0', to: 's1', symbol: 'a', write: 'b', move: 'L' }
  ];

  assert.strictEqual(
    context.normalizeMachineType({ machine: 'TM', transitions: branching }), 'NDTM');
  assert.strictEqual(
    context.normalizeMachineType({ machine: 'TM', transitions: [branching[0]] }), 'TM');
});

test('the hidden PDA alias always re-derives from whether δ branches', () => {
  const one = [{ id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'Z' }];
  assert.strictEqual(context.normalizeMachineType({ machine: 'PDA', transitions: one }), 'DPDA');
  assert.strictEqual(context.normalizeMachineType({ machine: 'DPDA', transitions: one }), 'DPDA');
});

test('a machine with no reason to be re-typed is left alone', () => {
  for (const m of ['DFA', 'NFA', 'DBA', 'Moore', 'LBA']) {
    assert.strictEqual(context.normalizeMachineType({ machine: m, transitions: [] }), m);
  }
});

// ── The round trip ────────────────────────────────────────────────

test('save, validate, load gives back the same machine', () => {
  dfa();
  const saved = JSON.parse(JSON.stringify(context.getWorkspaceData()));

  harness.resetApp();
  context.validateSchema(saved);
  context.loadData(saved);

  assert.strictEqual(context.App.machine, 'DFA');
  assert.deepStrictEqual(context.App.states.map(s => s.name), ['q0', 'q1']);
  assert.deepStrictEqual([...context.App.sigma], ['a', 'b']);
  assert.deepStrictEqual([...context.App.accepts], ['s1']);
  assert.strictEqual(context.App.startId, 's0');
});

test('a document that is not one of ours is still refused on its shape', () => {
  // The format field is identity, not a gate — a file with no `machine` fails
  // for the reason it always did, and the message says so.
  assert.throws(() => context.validateSchema({ format: 'something/else', schema: 1 }),
    /machine type/i);
});
