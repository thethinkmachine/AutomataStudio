import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// A share link is a whole workspace carried in a URL, and the only thing that
// can go wrong with it is length: the hash never reaches a server, but every
// chat client, mail client and issue tracker between the two people has its own
// idea of how long a link may be, and the ones that truncate rather than refuse
// hand back a payload that decodes to nothing. So what these pin is that the
// payload got small, that it still round-trips, and that the links written
// before it got small still open.

const { App } = context;

function buildMachine(nStates) {
  createHarness();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    App.states.push({ id: 's' + i, name: 'q' + i, x: 100 + (i % 40) * 90, y: 100 + Math.floor(i / 40) * 90 });
  }
  App.startId = 's0';
  App.accepts.add('s' + (nStates - 1));
  App.stateN = nStates;
  for (let i = 0; i < nStates * 2; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % nStates), to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b'
    });
  }
  App.transN = nStates * 2;
}

const payloadOf = url => url.slice(url.indexOf(context.SHARE_HASH_PREFIX) + context.SHARE_HASH_PREFIX.length);

test('the payload is compressed, and says so', async () => {
  buildMachine(20);
  const payload = payloadOf(await context.getShareableLink());
  assert.ok(payload.startsWith(context.SHARE_COMPRESSED_MARK));
  // The mark carries a character the base64url alphabet does not, so no legacy
  // payload can begin with it — which is the whole of how the reader tells the
  // two generations of link apart.
  assert.ok(/[^A-Za-z0-9_-]/.test(context.SHARE_COMPRESSED_MARK));
  assert.ok(!/[^A-Za-z0-9_-]/.test(context.b64UrlEncodeUnicode('{\"machine\":\"DFA\"}')));
});

test('a workspace survives the round trip', async () => {
  buildMachine(12);
  const before = JSON.stringify(context.getWorkspaceData());
  const payload = payloadOf(await context.getShareableLink());
  assert.equal(await context.decodeSharePayload(payload), before);
});

test('a link written before compression still opens', async () => {
  buildMachine(8);
  const json = JSON.stringify(context.getWorkspaceData());
  // Exactly what getShareableLink used to emit.
  const legacy = context.b64UrlEncodeUnicode(json);
  assert.ok(!legacy.startsWith(context.SHARE_COMPRESSED_MARK));
  assert.equal(await context.decodeSharePayload(legacy), json);
});

test('the codec is byte-exact on the symbols a workspace actually carries', async () => {
  const json = JSON.stringify({ sym: { eps: 'ε', blank: '⊔', end: '⊣' }, note: 'δ over Γ³' });
  assert.equal(context.b64UrlDecodeUnicode(context.b64UrlEncodeUnicode(json)), json);
  assert.equal(await context.decodeSharePayload(await context.compressToB64Url(json)), json);
});

test('a machine big enough to break a link is several times shorter for it', async () => {
  buildMachine(300);
  const json = JSON.stringify(context.getWorkspaceData());
  const plain = context.b64UrlEncodeUnicode(json);
  const packed = payloadOf(await context.getShareableLink());
  // A workspace is the same two dozen key names once per state and once per
  // transition, so the real ratio is an order of magnitude; 4x is the loose
  // budget that catches the compression having quietly stopped happening.
  assert.ok(packed.length * 4 < plain.length, `${packed.length} vs ${plain.length}`);
});

test('loading a shared link imports it and clears the hash', async () => {
  buildMachine(6);
  const url = await context.getShareableLink();
  const shared = JSON.stringify(context.getWorkspaceData());

  createHarness();
  let replaced = false;
  context.history = { ...context.history, replaceState: () => { replaced = true; } };
  context.location = { ...context.location, hash: url.slice(url.indexOf('#')) };

  assert.equal(await context.loadSharedLinkFromURL(), true);
  assert.ok(replaced);
  assert.equal(App.states.length, 6);
  assert.equal(JSON.stringify(context.getWorkspaceData()), shared);
});

test('a truncated link is refused rather than half-imported', async () => {
  buildMachine(30);
  const url = await context.getShareableLink();
  const before = JSON.stringify(context.exportWorkspaceState());

  context.location = { ...context.location, hash: url.slice(url.indexOf('#'), url.length - 40) };
  assert.equal(await context.loadSharedLinkFromURL(), false);
  assert.equal(JSON.stringify(context.exportWorkspaceState()), before);
});
