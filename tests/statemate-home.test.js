import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// A run is about the machine it was sent from. The console is a panel, so the
// reader can switch tabs or go on editing while it works — and every diff the
// run makes is against the machine it started from, so writing its result over
// anything else replaces work nobody showed the model. Pinned here: nothing is
// written over a moved canvas even in `auto`; a held result says where Apply
// and Preview will act and takes the reader there; and the draft is drawn only
// over its own tab.

const h = createHarness();
const C = h.context;

function sseResponse(text) {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":1}}}\n\n',
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
    'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n'
  ];
  let i = 0;
  return {
    ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => (i < chunks.length
      ? { done: false, value: encoder.encode(chunks[i++]) }
      : { done: true, value: undefined }) }) }
  };
}

// An edit of tab A's machine: keeps alpha and beta, adds gamma.
const addGamma = JSON.stringify({
  kind: 'machine', plan: 'Add a trap.', machine: 'DFA', title: 'With a trap', blurb: 'b', sigma: ['a', 'b'],
  states: [{ name: 'alpha', start: true, accept: true }, { name: 'beta' }, { name: 'gamma' }],
  transitions: [
    { from: 'alpha', to: 'beta', on: 'a' }, { from: 'beta', to: 'alpha', on: 'a' },
    { from: 'alpha', to: 'gamma', on: 'b' }, { from: 'beta', to: 'gamma', on: 'b' },
    { from: 'gamma', to: 'gamma', on: 'a' }, { from: 'gamma', to: 'gamma', on: 'b' }
  ],
  tests: [{ w: 'aa', expect: 'accept' }, { w: 'a', expect: 'reject' }, { w: 'b', expect: 'reject' }]
});

const names = () => C.App.states.map(s => s.name).join(',');

/** Two tabs, A and B, each with its own machine. A is on screen. */
function twoTabs() {
  C.createTab('A');
  const A = C.activeWorkspaceId;
  C.App.machine = 'DFA';
  C.App.states = [{ id: 's1', name: 'alpha', x: 0, y: 0 }, { id: 's2', name: 'beta', x: 200, y: 0 }];
  C.App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's2', to: 's1', symbol: 'a' }
  ];
  C.App.startId = 's1';
  C.App.accepts = new Set(['s1']);
  C.App.sigma = new Set(['a', 'b']);
  C.createTab('B');
  const B = C.activeWorkspaceId;
  C.App.machine = 'DFA';
  C.App.states = [{ id: 's1', name: 'bee', x: 0, y: 0 }];
  C.App.transitions = [];
  C.App.startId = 's1';
  C.switchTab(A);
  return { A, B };
}

async function say(prompt) {
  const input = h.getElement('sm-input');
  input.value = prompt;
  input.oninput();
  await input.onkeydown({ key: 'Enter', preventDefault() {} });
}

/** The console, in `auto`, answering with `answer` after `during()` has run. */
async function autoConsole({ during = () => {}, answer = addGamma, preview = true } = {}) {
  C._resetPaletteForTests();
  C.clearDraft();
  C.clearThread();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', livePreview: preview });
  const passthrough = C.fetch;
  C.fetch = async (url, ...rest) => {
    if (!String(url).includes('api.anthropic.com')) return passthrough(url, ...rest);
    during();
    return sseResponse(answer);
  };
  C.openStateMate();
  await say('/mode auto');
  return () => { C.fetch = passthrough; };
}

const cls = n => `${n?.getAttribute?.('class') || ''} ${typeof n?.className === 'string' ? n.className : ''}`;

function deepText(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  return `${own} ${(node.children || []).map(deepText).join(' ')}`.trim();
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

const heldCard = () => findAll(h.getElement('sm-log'), n => cls(n).includes('sm-card') && cls(n).includes('is-pending')).at(-1);
const buttonsOf = card => findAll(card, n => typeof n.onclick === 'function' && cls(n).includes('sm-btn'));
const button = (card, label) => buttonsOf(card).find(b => deepText(b) === label);
const labels = card => buttonsOf(card).map(deepText);

// ── nothing is written over a canvas that moved ──────────────────

test('an auto run that finishes on another tab writes nothing there, and Apply takes the reader back', async () => {
  const { A, B } = twoTabs();
  const restore = await autoConsole({ during: () => C.switchTab(B) });
  try {
    await say('add a trap state');
    assert.equal(C.activeWorkspaceId, B);
    assert.equal(names(), 'bee', 'the tab the reader moved to keeps its own machine — it used to be replaced by the other tab\'s edit');

    const card = heldCard();
    assert.ok(card, 'the result is held, not lost');
    assert.match(deepText(card), /switched tabs while it was being written/);
    assert.ok(labels(card).includes('Apply in “A”'), `the card says where Apply acts (${labels(card)})`);
    assert.ok(labels(card).includes('Preview in “A”'));

    button(card, 'Apply in “A”').onclick();
    assert.equal(C.activeWorkspaceId, A, 'Apply switched to the tab the machine was made for');
    assert.equal(names(), 'alpha,beta,gamma', 'and drew it there');
    C.switchTab(B);
    assert.equal(names(), 'bee', 'B is still untouched');
  } finally {
    restore();
  }
});

test('an auto run holds its result when the canvas was edited while it worked, and the edit survives', async () => {
  twoTabs();
  const restore = await autoConsole({
    during: () => C.App.states.push({ id: 's9', name: 'delta', x: 400, y: 0 })   // the reader goes on working
  });
  try {
    await say('add a trap state');
    assert.equal(names(), 'alpha,beta,delta', 'the edit made while waiting is still there');
    const card = heldCard();
    assert.match(deepText(card), /canvas changed while it was being written/);
    assert.ok(labels(card).includes('Apply anyway'),
      'and the card warns that applying replaces it — the signature is the machine the diff was made against');
  } finally {
    restore();
  }
});

test('a proposal made while the canvas was being edited reads as stale, not current', async () => {
  twoTabs();
  const restore = await autoConsole({ during: () => C.App.states.push({ id: 's9', name: 'delta', x: 400, y: 0 }) });
  try {
    await say('/mode propose');
    await say('add a trap state');
    // The signature used to be taken when the run *ended*, so an edit made
    // during it counted as current and Apply replaced it without a word.
    assert.ok(labels(heldCard()).includes('Apply anyway'), `${labels(heldCard())}`);
  } finally {
    restore();
  }
});

test('a proposal whose tab was closed is applied in a tab of its own, over nothing', async () => {
  const { A, B } = twoTabs();
  const restore = await autoConsole({ during: () => C.switchTab(B) });
  try {
    await say('add a trap state');
    C.setWorkspaces(C.Workspaces.filter(w => w.id !== A));   // A is closed
    C.emit(C.Change.EXERCISE);                               // what a tab activation announces
    const card = heldCard();
    assert.ok(labels(card).includes('Apply in a new tab'), `${labels(card)}`);
    const preview = button(card, 'Preview');
    assert.equal(preview.getAttribute('aria-disabled'), 'true', 'nothing to preview it over');

    const tabs = C.Workspaces.length;
    button(card, 'Apply in a new tab').onclick();
    assert.equal(C.Workspaces.length, tabs + 1, 'a tab of its own');
    assert.equal(names(), 'alpha,beta,gamma');
    C.switchTab(B);
    assert.equal(names(), 'bee');
  } finally {
    restore();
  }
});

test('the turn is recorded in the conversation it belongs to, not the tab on screen when it ends', async () => {
  const { A, B } = twoTabs();
  const restore = await autoConsole({ during: () => C.switchTab(B) });
  try {
    await say('add a trap state');
    C.switchTab(A);
    const thread = C.getThread();
    assert.deepEqual(thread.map(t => t.role), ['user', 'assistant'], 'A\'s conversation has the exchange');
    assert.equal(thread[0].text, 'add a trap state');
  } finally {
    restore();
  }
});

// ── the draft belongs to its tab ─────────────────────────────────

test('a draft is drawn only over its own tab, and comes back with it', async () => {
  const { A, B } = twoTabs();
  const layer = () => h.getElement('draft-g');
  const restore = await autoConsole();
  try {
    await say('/mode propose');
    await say('add a trap state');
    assert.equal(C.isDraftHere(), true);
    assert.ok(layer().children.length > 0, 'the proposal is drawn over A');

    // A real switch: it goes through renderAll and never announces Change.GRAPH.
    C.switchTab(B);
    assert.equal(layer().children.length, 0, 'nothing of A\'s proposal is drawn over B');
    assert.equal(h.getElement('canvas-wrap').classList.contains('has-draft'), false, 'nor is B dimmed');
    assert.ok(labels(heldCard()).includes('Preview in “A”'), 'the card says the preview is A\'s');

    C.switchTab(A);
    assert.ok(layer().children.length > 0, 'back on A, the proposal is drawn again');
  } finally {
    restore();
  }
});

test('Preview from another tab takes the reader to the proposal\'s tab and draws it there', async () => {
  const { A, B } = twoTabs();
  const restore = await autoConsole();
  try {
    await say('/mode propose');
    await say('add a trap state');
    button(heldCard(), 'Hide preview').onclick();
    C.switchTab(B);
    button(heldCard(), 'Preview in “A”').onclick();
    assert.equal(C.activeWorkspaceId, A);
    assert.equal(C.isDraftHere(), true);
    assert.ok(h.getElement('draft-g').children.length > 0);
  } finally {
    restore();
  }
});
