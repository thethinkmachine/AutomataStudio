import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;
const { App } = context;

// A share link or a saved file's JSON, pasted on the canvas, opens the machine
// it carries — which is how a machine travels through a chat. What is pinned
// here is that both open the machine that was shared, that the link is found
// in the sentence it was pasted with, that neither replaces what is on the
// canvas, and that other text still reaches the in-app clipboard.

const status = () => harness.getElement('status-bar').textContent;

// Two states over {a, b}, accepting words ending in b — small enough to check
// by eye, and with a card, since the card is part of what is shared.
function sharedDoc() {
  harness.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [{ id: 's0', name: 'even', x: 100, y: 100 }, { id: 's1', name: 'endsB', x: 300, y: 100 }];
  App.transitions = [
    { id: 't0', from: 's0', to: 's1', symbol: 'b' }, { id: 't1', from: 's0', to: 's0', symbol: 'a' },
    { id: 't2', from: 's1', to: 's1', symbol: 'b' }, { id: 't3', from: 's1', to: 's0', symbol: 'a' }
  ];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.meta = { title: 'Ends in b' };
  return context.getWorkspaceData();
}

// A second workspace to paste into: `occupied` puts a machine on it.
function receiver({ occupied = false } = {}) {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  if (occupied) {
    App.machine = 'NFA';
    App.states = [{ id: 's0', name: 'mine', x: 0, y: 0 }];
    App.startId = 's0';
  }
  context.Workspaces.push({ id: 'w0', name: 'Workspace 1', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

function assertSharedMachine() {
  assert.equal(App.machine, 'DFA');
  assert.deepEqual(App.states.map(s => s.name), ['even', 'endsB']);
  assert.equal(App.transitions.length, 4);
  assert.deepEqual([...App.accepts], ['s1']);
}

// ── a share link ──────────────────────────────────────────────────

test('a pasted share link opens the machine it carries', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  receiver();
  assert.equal(await context.applyPastedText(link), true);
  assertSharedMachine();
  assert.match(status(), /pasted link/);
});

test('the link is found inside the sentence it was pasted with', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  for (const text of [`try this one: ${link}.`, `<${link}>`, `${link}\n\nit accepts words ending in b`]) {
    receiver();
    assert.equal(await context.applyPastedText(text), true, text.slice(0, 30));
    assertSharedMachine();
  }
});

test('a link from before compression still opens', async () => {
  const legacy = `https://example.org/app/${context.SHARE_HASH_PREFIX}${context.b64UrlEncodeUnicode(JSON.stringify(sharedDoc()))}`;
  receiver();
  assert.equal(await context.applyPastedText(legacy), true);
  assertSharedMachine();
});

test('a link cut off in transit is refused and named, and changes nothing', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  receiver({ occupied: true });
  const opened = context.applyPastedText(link.slice(0, link.length - 40));
  assert.notEqual(opened, null, 'still recognised as a link');
  assert.equal(await opened, false);
  assert.match(status(), /cut off/);
  assert.equal(context.Workspaces.length, 1, 'no tab opened for it');
  assert.deepEqual(App.states.map(s => s.name), ['mine']);
});

// ── a saved file's JSON ───────────────────────────────────────────

test('a pasted .automaton file opens, fenced or not', async () => {
  const json = JSON.stringify(sharedDoc(), null, 2);
  for (const text of [json, `\`\`\`json\n${json}\n\`\`\``]) {
    receiver();
    assert.equal(await context.applyPastedText(text), true);
    assertSharedMachine();
  }
});

test('a file written before `format` existed is still recognised', async () => {
  const { format, schema, app, ...old } = sharedDoc();
  receiver();
  assert.equal(await context.applyPastedText(JSON.stringify(old)), true);
  assertSharedMachine();
});

test('a file cut short is refused and named', async () => {
  const json = JSON.stringify(sharedDoc());
  receiver();
  const opened = context.applyPastedText(json.slice(0, json.length / 2));
  assert.notEqual(opened, null);
  assert.equal(await opened, false);
  assert.match(status(), /incomplete/);
});

test('a file that is ours but invalid is refused with the reason', async () => {
  const doc = sharedDoc();
  doc.machine = 'NotAMachine';
  receiver();
  assert.equal(await context.applyPastedText(JSON.stringify(doc)), false);
  assert.match(status(), /unsupported machine type/i);
});

test('a card travels with the pasted machine', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  receiver();
  await context.applyPastedText(link);
  assert.equal(App.meta?.title, 'Ends in b');
});

// ── where it lands, and what is not a machine ─────────────────────

test('pasting over an occupied canvas opens a tab and keeps the machine there', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  receiver({ occupied: true });
  await context.applyPastedText(link);
  assert.equal(context.Workspaces.length, 2);
  assertSharedMachine();
  const first = context.Workspaces.find(w => w.id === 'w0');
  assert.deepEqual(first.data.states.map(s => s.name), ['mine']);
});

test('other JSON, and other text, are not machines', () => {
  receiver();
  for (const text of ['{"a": 1}', '[1, 2]', '{"states": {"idle": {}}}', 'see https://example.org/#top', 'hello']) {
    assert.equal(context.applyPastedText(text), null, text);
  }
});

test('Ctrl+V with a link on the system clipboard opens it', async () => {
  const link = await context.shareLinkFor(sharedDoc());
  receiver();
  harness.dispatchDocumentEvent('keydown', { key: 'v', ctrlKey: true });
  const ev = harness.dispatchDocumentEvent('paste', { clipboardData: { getData: () => link } });
  assert.equal(ev.defaultPrevented, true);
  // The link inflates asynchronously; give it the ticks it takes.
  for (let i = 0; i < 50 && App.states.length !== 2; i++) await new Promise(r => setTimeout(r, 5));
  assertSharedMachine();
});
