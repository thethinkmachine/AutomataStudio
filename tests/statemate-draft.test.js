import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// StateMate's work in progress, on the canvas. Three things are pinned:
// that a half-written answer yields the part of the machine that has finished
// arriving; that the preview is paint — the canvas is still written once, at
// apply, or not at all; and that it comes off again when the run is over,
// unless what is left is a proposal waiting for the reader.

const h = createHarness();
const C = h.context;

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => (i < chunks.length
      ? { done: false, value: encoder.encode(chunks[i++]) }
      : { done: true, value: undefined }) }) }
  };
}

/** An Anthropic stream delivering `text` in `parts` pieces. */
function streamOf(text, parts = 4) {
  const size = Math.ceil(text.length / parts);
  const chunks = ['data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":1}}}\n\n'];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(i, i + size) } })}\n\n`);
  }
  chunks.push('data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n');
  return chunks;
}

const parity = (extra = {}) => ({
  kind: 'machine', plan: 'Two states.', machine: 'DFA', title: 'Even a', blurb: 'b', sigma: ['a', 'b'],
  states: [{ name: 'even', start: true, accept: true }, { name: 'odd' }],
  transitions: [
    { from: 'even', to: 'odd', on: 'a' }, { from: 'odd', to: 'even', on: 'a' },
    { from: 'even', to: 'even', on: 'b' }, { from: 'odd', to: 'odd', on: 'b' }
  ],
  tests: [{ w: 'aa', expect: 'accept' }, { w: 'a', expect: 'reject' }, { w: 'ε', expect: 'accept' }],
  ...extra
});

function reset() {
  C.resetApp?.();
  C.resetStateMateSettings();
  C._draftGlideForTests(null);
  C.clearDraft();
  C.clearThread?.();
}

// ── reading a half-written answer ────────────────────────────────

test('a streamed answer yields the states and transitions that have finished arriving', () => {
  const text = JSON.stringify(parity({ states: [{ name: 'a}b', start: true }, { name: 'q"1' }],
    transitions: [{ from: 'a}b', to: 'q"1', on: 'a' }] }));
  const at = marker => text.indexOf(marker);

  assert.equal(C.partialMachine(text.slice(0, at('"states"'))), null, 'nothing to draw before the states begin');
  const first = C.partialMachine(text.slice(0, at('{"name":"q')));
  assert.deepEqual(first.states.map(s => s.name), ['a}b'], 'a brace inside a name does not end the object');
  const half = C.partialMachine(text.slice(0, at('{"name":"q') + 8));
  assert.equal(half.states.length, 1, 'an object still being written waits for the next frame');
  const whole = C.partialMachine(text);
  assert.deepEqual(whole.states.map(s => s.name), ['a}b', 'q"1']);
  assert.equal(whole.transitions.length, 1);
  assert.deepEqual(whole.sigma, ['a', 'b']);

  assert.equal(C.partialMachine('{"kind":"reply","text":"states: ["}'), null, 'a reply is not a machine');
});

test('a draft that would not validate is still drawn — without anything invented', () => {
  const spec = C.lenientSpec({
    states: [{ name: 'p', start: true }, { name: 'q', start: true }, { name: '' }, { name: 'p' }],
    transitions: [{ from: 'p', to: 'q', on: 'a' }, { from: 'p', to: 'nowhere', on: 'b' }]
  }, 'DFA');
  assert.deepEqual(spec.states.map(s => s.name), ['p', 'q']);
  assert.deepEqual(spec.states.map(s => s.start), [true, false], 'one start state, as the canvas can show one');
  assert.equal(spec.transitions.length, 1, 'an edge to a state not yet written is left for a later frame');
  assert.deepEqual(spec.sigma, ['a'], 'Σ read off the transitions when the answer has not given it yet');

  const none = C.lenientSpec({ states: [{ name: 'x' }] }, 'DFA');
  assert.equal(none.states[0].start, false, 'no start state is invented — the reader would see it');
});

// The dialect lists every state before any transition, so a preview that held
// each state where it first landed held it where it was parked before a single
// edge had arrived — and the diagram jumped when the answer was compiled.
const chain = () => {
  const names = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'];
  return parity({
    states: names.map((name, i) => ({ name, start: i === 0, accept: i === 5 })),
    transitions: names.flatMap((n, i) => [
      { from: n, to: names[Math.min(i + 1, 5)], on: 'a' },
      { from: n, to: names[0], on: 'b' }
    ]),
    tests: []
  });
};

/** The frames a stream yields, in the order the dialect writes them. */
function framesOf(spec) {
  const frames = [];
  for (let n = 1; n <= spec.states.length; n++) frames.push({ states: spec.states.slice(0, n), transitions: [] });
  for (let n = 1; n <= spec.transitions.length; n++) frames.push({ states: spec.states, transitions: spec.transitions.slice(0, n) });
  return frames;
}

test('the last frame of a stream is the machine Apply will draw — nothing jumps when the answer lands', () => {
  for (const kind of ['fresh build', 'edit']) {
    reset();
    const spec = chain();
    const blank = C.currentMachineSnapshot();
    // For the edit, half the machine is on the canvas already. Handed in
    // rather than written to App, which later tests start from.
    const half = new Set(['q0', 'q1', 'q2']);
    const live = kind === 'fresh build' ? blank : C.compileSpec(C.validateSpec({
      ...spec,
      states: spec.states.filter(s => half.has(s.name)),
      transitions: spec.transitions.filter(t => half.has(t.from) && half.has(t.to))
    }, { fallbackMachine: 'DFA' }), blank).candidate;
    let last = null;
    for (const frame of framesOf(spec)) last = C.draftCandidate(frame, live, 'DFA') || last;
    const applied = C.compileSpec(C.validateSpec(spec, { fallbackMachine: 'DFA' }), live).candidate;
    for (const s of applied.states) {
      const drawn = last.states.find(x => x.name === s.name);
      assert.deepEqual([drawn.x, drawn.y], [s.x, s.y], `${kind}: ${s.name} is drawn where it will be applied`);
    }
    assert.equal(C.draftSize(last), '6 states · 12 transitions');
  }
});

// ── the run ──────────────────────────────────────────────────────

test('a streamed build is previewed as it arrives, and the canvas is untouched until apply', async () => {
  reset();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  C.fetch = async () => sseResponse(streamOf(JSON.stringify(parity())));
  const before = JSON.stringify(C.exportWorkspaceState());

  const drafts = [];
  const result = await C.runStateMate({
    prompt: 'even number of a',
    authority: 'auto',
    onEvent: event => {
      if (event.type !== 'draft') return;
      drafts.push({ source: event.source, states: event.candidate.states.length });
      assert.equal(JSON.stringify(C.exportWorkspaceState()), before,
        'a preview is paint — the machine is not written while it is being drawn');
    }
  });

  assert.equal(result.status, 'applied');
  assert.ok(drafts.some(d => d.source === 'stream'), 'the answer was drawn while it streamed');
  assert.deepEqual(drafts.at(-1), { source: 'compiled', states: 2 }, 'and the finished machine last, as it is checked');
});

test('a hints-only exercise is never previewed — the draft would be the answer', async () => {
  reset();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  C.App.exercise = { id: 'x', title: 'X', assist: 'tutor', task: { machine: 'DFA' } };
  C.fetch = async () => sseResponse(streamOf(JSON.stringify(parity())));
  const drafts = [];
  await C.runStateMate({ prompt: 'build it', onEvent: e => { if (e.type === 'draft') drafts.push(e); } })
    .catch(() => {});
  C.App.exercise = null;
  assert.equal(drafts.length, 0);
});

// ── the layer ────────────────────────────────────────────────────

test('the draft layer marks what is new, kept and dropped, and never reaches the machine', () => {
  reset();
  const live = {
    machine: 'DFA',
    states: [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'gone', x: 100, y: 0 }],
    transitions: [], accepts: ['s1'], startId: 's1'
  };
  const candidate = C.draftCandidate(
    { states: [{ name: 'even', start: true, accept: true }, { name: 'odd' }], transitions: [{ from: 'even', to: 'odd', on: 'a' }] },
    live, 'DFA');
  const before = JSON.stringify(C.exportWorkspaceState());

  C.showDraft(candidate, live);
  const layer = h.getElement('draft-g');
  const classes = layer.children.map(n => String(n.getAttribute?.('class') ?? n.class ?? ''));
  assert.ok(String(layer.getAttribute?.('class') ?? layer.class).includes('editor-layer'),
    'classed so every exporter strips it');
  assert.ok(!classes.some(c => c.includes('draft-st is-kept')),
    'a state the draft keeps is the real one — drawing it again stacked two machines');
  assert.ok(classes.some(c => c.includes('draft-st is-new')), 'a state it adds');
  assert.ok(classes.some(c => c.includes('draft-st is-removed')), 'a state it drops, ringed where it stands');
  assert.ok(classes.some(c => c.includes('draft-edge is-new')));
  assert.ok(h.getElement('canvas-wrap').classList.contains('has-draft'), 'the real diagram dims underneath');
  assert.equal(JSON.stringify(C.exportWorkspaceState()), before, 'nothing about it is saved');

  C.clearDraft();
  assert.equal(layer.children.length, 0);
  assert.equal(h.getElement('canvas-wrap').classList.contains('has-draft'), false);
  assert.equal(C.isDraftShown(), false);
});

test('only the changes are drawn: kept edges are left to the real renderer, dropped ones are struck out on their own path', () => {
  reset();
  // A real machine on the canvas, rendered, so each edge has a drawn path.
  C.App.machine = 'DFA';
  C.App.states = [{ id: 's1', name: 'p', x: 0, y: 0 }, { id: 's2', name: 'q', x: 200, y: 0 }];
  C.App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's2', to: 's1', symbol: 'b' }
  ];
  C.App.startId = 's1';
  C.App.sigma = new Set(['a', 'b']);
  C.renderAll();
  const live = C.currentMachineSnapshot();

  // Keep p→q on a, drop q→p on b, add q→q on a.
  const candidate = C.draftCandidate({
    states: [{ name: 'p', start: true }, { name: 'q' }],
    transitions: [{ from: 'p', to: 'q', on: 'a' }, { from: 'q', to: 'q', on: 'a' }]
  }, live, 'DFA');
  C.showDraft(candidate, live);

  const nodes = h.getElement('draft-g').children;
  const cls = n => String(n.getAttribute?.('class') ?? '');
  const edges = nodes.filter(n => cls(n).startsWith('draft-edge'));
  const labels = nodes.filter(n => cls(n).startsWith('draft-label'));
  assert.equal(edges.filter(n => cls(n).includes('is-new')).length, 1, 'the added loop');
  assert.equal(labels.length, 1, 'one label — a kept edge\'s label is not drawn a second time beside the real one');
  const struck = edges.filter(n => cls(n).includes('is-removed'));
  assert.equal(struck.length, 1, 'the dropped edge is marked');
  const realPath = C.drawnEdgeEl('t2').__parts.pathEl.getAttribute('d');
  assert.equal(struck[0].getAttribute('d'), realPath, 'on the real edge\'s own path, so the mark lies on the line');
});

test('the draft follows the canvas: a changed state sits on its real counterpart, and a stale mark is redrawn', () => {
  reset();
  const live = {
    machine: 'DFA',
    states: [{ id: 's1', name: 'p', x: 0, y: 0 }, { id: 's2', name: 'gone', x: 300, y: 0 }],
    transitions: [], accepts: [], startId: 's1'
  };
  // p gains an accept mark, so it is drawn — and must be drawn where p is.
  const candidate = C.draftCandidate({ states: [{ name: 'p', start: true, accept: true }] }, live, 'DFA');
  C.showDraft(candidate, live);

  // The reader drags p and deletes "gone" while the draft is up.
  const moved = { ...live, states: [{ id: 's1', name: 'p', x: 500, y: 40 }] };
  C.refreshDraft(moved);
  const nodes = h.getElement('draft-g').children;
  const at = cls => nodes.find(n => String(n.getAttribute?.('class')).includes(cls));
  assert.equal(at('draft-st is-changed').getAttribute('transform'), 'translate(500 40)',
    'drawn where the real state is now, not where it was when the draft was made');
  assert.equal(at('is-removed'), undefined, 'the state already gone from the canvas is no longer marked for removal');
});

test('the preview comes off when the run ends, and stays for a proposal until it is decided', async () => {
  reset();
  C._resetPaletteForTests();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  C.fetch = async () => sseResponse(streamOf(JSON.stringify(parity())));

  C._resetPaletteForTests();
  C.openStateMate();
  C.setAuthority?.('propose', { quiet: true });
  const input = h.getElement('sm-input');
  input.value = 'even number of a';
  input.oninput();
  await input.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(C.isDraftShown(), true, 'a proposal is previewed on the canvas while it waits');

  const discard = findButton(h.getElement('sm-log'), 'Discard');
  assert.ok(discard, 'the proposal card offers Discard');
  discard.onclick();
  assert.equal(C.isDraftShown(), false, 'and discarding it takes the preview away');
});

test('with the preview switched off, the run still says what it is drafting', async () => {
  reset();
  C._resetPaletteForTests();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', livePreview: false });
  C.fetch = async () => sseResponse(streamOf(JSON.stringify(parity())));
  C.openStateMate();
  C.setAuthority?.('propose', { quiet: true });
  const input = h.getElement('sm-input');
  input.value = 'even number of a';
  input.oninput();
  await input.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(C.isDraftShown(), false);
});

test('a tool row says what the call came back with', () => {
  assert.equal(C.summarizeResult('simulate_words', { checked: 5, acc: ['a', 'b', 'c'], rej: ['d', 'e'] }), '3 accept · 2 reject');
  assert.equal(C.summarizeResult('simulate_word', { word: 'a', verdict: 'rej' }), 'reject');
  assert.equal(C.summarizeResult('lint_machine', { fatal: [] }), 'clean');
  assert.equal(C.summarizeResult('lint_machine', { fatal: [{}, {}] }), '2 problems');
  assert.equal(C.summarizeResult('compare_with_canvas', { checked: 31, differences: [{}] }), '1 of 31 differ');
  assert.equal(C.summarizeResult('find_unreachable_states', []), 'all reachable');
  assert.equal(C.summarizeResult('add_state', { anything: 1 }), '', 'a write says nothing here — the canvas shows it');
});

function deepText(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  return `${own} ${(node.children || []).map(deepText).join(' ')}`.trim();
}

/** The button whose label reads `label`, wherever it is under `node`. */
function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.onclick === 'function' && deepText(node).trim() === label) return node;
  for (const kid of node.children || []) {
    const found = findButton(kid, label);
    if (found) return found;
  }
  return null;
}

test('a drag moves the draft with it, frame by frame', () => {
  reset();
  C.App.machine = 'DFA';
  C.App.states = [{ id: 's1', name: 'p', x: 0, y: 0 }];
  C.App.transitions = [];
  C.App.startId = 's1';
  C.App.accepts = new Set();
  C.renderAll();
  const candidate = C.draftCandidate({ states: [{ name: 'p', start: true, accept: true }] }, C.currentMachineSnapshot(), 'DFA');
  C.showDraft(candidate, C.currentMachineSnapshot());

  // A drag frame: the state moves and the renderer is told, nothing is announced.
  C.App.states[0].x = 240;
  C.App.states[0].y = 90;
  C.updateFastDOM();
  const node = h.getElement('draft-g').children.find(n => String(n.getAttribute?.('class')).includes('is-changed'));
  assert.equal(node.getAttribute('transform'), 'translate(240 90)');
  C.clearDraft();
});

// ── continuity, and where the draft may be drawn ─────────────────

// SVG nodes are classed by attribute, the console's by className.
const cls = n => `${n?.getAttribute?.('class') || ''} ${typeof n?.className === 'string' ? n.className : ''}`;

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

/** The draft's drawing of state `name`, as [x, y]. */
function drawnAt(name) {
  const node = h.getElement('draft-g').children
    .find(n => cls(n).includes('draft-st') && (n.children || []).some(k => k.textContent === name));
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(node?.getAttribute('transform') || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

test('a state the draft placed glides to where the next frame puts it; a state on the canvas does not', () => {
  reset();
  C.App.machine = 'DFA';
  C.App.states = [{ id: 's1', name: 'p', x: 0, y: 0 }];
  C.App.transitions = [];
  C.App.startId = 's1';
  C.App.accepts = new Set();
  C.renderAll();

  let now = 0;
  const frames = [];
  const savedRAF = C.requestAnimationFrame;
  C._draftGlideForTests({ now: () => now });
  C.requestAnimationFrame = fn => frames.push(fn);
  try {
    const live = C.currentMachineSnapshot();
    // p gains an accept mark, so it is drawn; q is the draft's own.
    const one = C.draftCandidate({ states: [{ name: 'p', start: true, accept: true }, { name: 'q' }] }, live, 'DFA');
    const from = drawnAt('q') || (C.showDraft(one, live), drawnAt('q'));
    const two = { ...one, states: one.states.map(s => (s.name === 'q' ? { ...s, x: s.x + 300 } : s)) };
    const to = [from[0] + 300, from[1]];

    C.showDraft(two, live);
    assert.deepEqual(drawnAt('q'), from, 'a new frame starts the move from where the reader last saw the state');
    assert.equal(frames.length, 1, 'and asks for a frame to continue it');

    now += 16;
    frames.shift()();
    const mid = drawnAt('q');
    assert.ok(mid[0] > from[0] && mid[0] < to[0], `part of the way there after one frame (${mid[0]})`);

    // A drag mid-glide: the real state is drawn under the pointer, not eased behind it.
    C.App.states[0].x = 240;
    C.updateFastDOM();
    assert.deepEqual(drawnAt('p'), [240, 0]);

    let guard = 0;
    while (frames.length && guard++ < 200) { now += 16; frames.shift()(); }
    assert.deepEqual(drawnAt('q'), to, 'it arrives');
    assert.equal(frames.length, 0, 'and stops asking for frames once it has');
  } finally {
    C.requestAnimationFrame = savedRAF;
    C._draftGlideForTests(null);
    C.clearDraft();
  }
});

test('inside a block the draft is held but not drawn, and stepping out puts it back', () => {
  reset();
  const live = { machine: 'DFA', states: [{ id: 's1', name: 'p', x: 0, y: 0 }], transitions: [], accepts: [], startId: 's1' };
  const candidate = C.draftCandidate({ states: [{ name: 'p', start: true }, { name: 'q' }] }, live, 'DFA');
  const layer = () => h.getElement('draft-g');
  C.showDraft(candidate, live);
  assert.ok(layer().children.length > 0);

  // A projection's coordinates are not the flat candidate's.
  C.App.scope = ['b1'];
  C.refreshDraft(live);
  assert.equal(C.canDrawDraft(), false);
  assert.equal(layer().children.length, 0, 'nothing is drawn over the inside of a block');
  assert.equal(h.getElement('canvas-wrap').classList.contains('has-draft'), false, 'nor is the real diagram dimmed');
  assert.equal(C.isShowingDraft(candidate), true, 'but the draft is still held');

  C.App.scope = [];
  C.refreshDraft(live);
  assert.ok(layer().children.length > 0, 'stepping out draws it again');
  C.clearDraft();
});

// ── the console ──────────────────────────────────────────────────

async function say(prompt) {
  const input = h.getElement('sm-input');
  input.value = prompt;
  input.oninput();
  await input.onkeydown({ key: 'Enter', preventDefault() {} });
}

/** Each held proposal's card, in transcript order. */
const heldCards = () => findAll(h.getElement('sm-log'), n => cls(n).includes('sm-card') && cls(n).includes('is-pending'));
const previewLabels = () => heldCards().map(card =>
  (findButton(card, 'Hide preview') ? 'Hide preview' : findButton(card, 'Preview') ? 'Preview' : null));

function consoleWith(answers) {
  reset();
  C._resetPaletteForTests();
  C.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  // The prompt builder fetches the bundled examples through the same fetch, so
  // only the model's endpoint takes from the queue.
  const passthrough = C.fetch;
  C.fetch = async (url, ...rest) => (String(url).includes('api.anthropic.com')
    ? sseResponse(streamOf(answers.shift()))
    : passthrough(url, ...rest));
  C.openStateMate();
  // `propose` is the console's default, and what these cases need: a held proposal.
}

test('each held proposal\'s Preview is about its own machine, and only its own Discard takes it down', async () => {
  consoleWith([
    JSON.stringify(parity({ title: 'First' })),
    JSON.stringify(parity({ title: 'Second' })),
    JSON.stringify({ kind: 'reply', text: 'Because it counts a.' })
  ]);

  await say('even number of a');
  assert.deepEqual(previewLabels(), ['Hide preview']);
  await say('again, differently');
  assert.deepEqual(previewLabels(), ['Preview', 'Hide preview'],
    'the newer proposal took the canvas, and the older card stopped claiming it');

  findButton(heldCards()[0], 'Preview').onclick();
  assert.deepEqual(previewLabels(), ['Hide preview', 'Preview'],
    'Preview on the first shows the first — it used to hide the second');

  await say('why does it reject a?');
  assert.equal(C.isDraftShown(), true, 'a reply drew nothing, so it takes nothing down');
  assert.deepEqual(previewLabels(), ['Hide preview', 'Preview']);

  findButton(heldCards()[1], 'Discard').onclick();
  assert.equal(C.isDraftShown(), true, 'discarding the second leaves the first on the canvas');
  assert.deepEqual(previewLabels(), ['Hide preview']);

  findButton(heldCards()[0], 'Hide preview').onclick();
  assert.equal(C.isDraftShown(), false);
  assert.deepEqual(previewLabels(), ['Preview']);
});

// Where a draft is drawn across tabs — held for its own tab, never drawn over
// another, back when its tab is — is pinned in statemate-home.test.js,
// through real tab switches: a switch goes through renderAll() and announces
// no Change.GRAPH, which a test that only set the active id could not see.
