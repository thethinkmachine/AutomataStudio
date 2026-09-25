import test from 'node:test';
import assert from 'node:assert/strict';
import { context, createHarness, getElement } from './harness.js';
import { assistPolicy, normalizeExercise, sealTarget } from '../js/exercise/model.js';

// What StateMate may do in a tab that holds an exercise. The rule lives in
// runStateMate and applyPending — every route to the model and to the canvas
// passes one of the two — so these drive the pipeline itself rather than the
// console, which only refuses earlier so the refusal reads well.

const App = () => context.App;

function jsonResponse(payload) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'claude-sonnet-5'
    });
  };
  fn.calls = calls;
  return fn;
}

const lastTurnText = call => {
  const c = call.body.messages.at(-1).content;
  return typeof c === 'string' ? c : c.filter(p => p.type === 'text').map(p => p.text).join('');
};

// Parity of a — the machine a model would hand back if it solved the task.
const SOLUTION = {
  kind: 'machine',
  plan: 'Two states tracking parity.',
  machine: 'DFA',
  title: 'Even number of a',
  blurb: 'Parity.',
  sigma: ['a', 'b'],
  states: [{ name: 'even', start: true, accept: true }, { name: 'odd' }],
  transitions: [
    { from: 'even', to: 'odd', on: 'a' }, { from: 'odd', to: 'even', on: 'a' },
    { from: 'even', to: 'even', on: 'b' }, { from: 'odd', to: 'odd', on: 'b' }
  ],
  tests: [{ input: '', expect: 'accept' }, { input: 'a', expect: 'reject' }, { input: 'aa', expect: 'accept' }]
};

const HINT = { kind: 'reply', text: 'Think about what the machine has to remember after each a.' };

function withExercise(assist) {
  const target = {
    kind: 'machine', machine: 'DFA', sigma: ['a', 'b'],
    states: [{ id: 's1', name: 'e' }], transitions: [], startId: 's1', accepts: ['s1'], config: {}
  };
  App().exercise = normalizeExercise({ target: sealTarget(target), allow: ['DFA'], ...(assist ? { assist } : {}) });
}

function setup(answer) {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  const fetch = fakeFetch(answer);
  h.context.fetch = fetch;
  return { h, fetch };
}

test('an exercise without the setting keeps StateMate off; no exercise leaves it on', () => {
  assert.equal(assistPolicy(null), 'on');
  const ex = normalizeExercise({ target: sealTarget({ kind: 'machine' }) });
  assert.equal(ex.assist, 'off');
  assert.equal(assistPolicy(ex), 'off');
  assert.equal(normalizeExercise({ target: 'x1.', assist: 'everything' }).assist, 'off');
  assert.equal(normalizeExercise({ target: 'x1.', assist: 'tutor' }).assist, 'tutor');
});

test('off: the run is refused before any request is made', async () => {
  const { h, fetch } = setup(SOLUTION);
  withExercise('off');
  const before = h.context.exportWorkspaceState();
  await assert.rejects(h.context.runStateMate({ prompt: 'build it for me', authority: 'auto' }),
    e => e.code === 'exercise-off');
  assert.equal(fetch.calls.length, 0, 'nothing was sent to the provider');
  assert.deepEqual(h.context.exportWorkspaceState(), before);
});

test('hints only: a question is answered, read-only, as a tutor, and without the agentic tools', async () => {
  const { h, fetch } = setup(HINT);
  withExercise('tutor');
  const result = await h.context.runStateMate({ prompt: 'why does my machine reject aa?', authority: 'auto' });
  assert.equal(result.kind, 'reply');
  const sent = lastTurnText(fetch.calls[0]);
  assert.match(sent, /a student working on an exercise whose author allows hints only/);
  assert.match(sent, /don't give the answer away in any form/);
  assert.doesNotMatch(sent, /describe the one you would build/, 'ask mode’s "describe it instead" is the answer in prose');
  assert.equal(fetch.calls[0].body.tools, undefined, 'no tool declarations — several of them build machines');
});

test('hints only: a machine answer is discarded unseen, even under auto authority', async () => {
  const { h } = setup(SOLUTION);
  withExercise('tutor');
  const before = h.context.exportWorkspaceState();
  await assert.rejects(h.context.runStateMate({ prompt: 'just build it', authority: 'auto' }),
    e => e.code === 'exercise-tutor');
  assert.deepEqual(h.context.exportWorkspaceState(), before, 'the canvas is untouched');
  assert.ok(!JSON.stringify(h.context.getThread()).includes('Even number of a'), 'the solution is not in the thread either');
});

test('a proposal made outside an exercise cannot be applied inside one', async () => {
  const { h } = setup(SOLUTION);
  const result = await h.context.runStateMate({ prompt: 'even number of a', authority: 'propose', intent: 'build' });
  assert.ok(result.pending, 'held as a proposal');
  withExercise('tutor');
  const before = h.context.exportWorkspaceState();
  assert.equal(h.context.applyPending(result), null);
  assert.deepEqual(h.context.exportWorkspaceState(), before);
  App().exercise = null;
  assert.equal(h.context.applyPending(result).status, 'applied', 'and applies as usual once the tab has no exercise');
});

test('full help: an exercise that allows it changes nothing about a run', async () => {
  const { h } = setup(SOLUTION);
  withExercise('on');
  const result = await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto', intent: 'build' });
  assert.equal(result.status, 'applied');
  assert.equal(App().states.length, 2);
  assert.ok(App().exercise, 'and the exercise is still there');
});

test('the author’s choice reaches the student’s document and is stated in the section', () => {
  createHarness();
  const App_ = App();
  App_.states = [{ id: 's1', name: 'e', x: 0, y: 0 }];
  App_.transitions = [{ id: 't1', from: 's1', to: 's1', symbol: 'a' }];
  App_.startId = 's1';
  App_.accepts = new Set(['s1']);
  App_.sigma = new Set(['a']);
  context.setExerciseDraft({ title: 'T', prompt: '', source: 'machine', answer: 'machine', allow: ['DFA'], maxLength: 4, hints: '', reveal: false, assist: 'tutor' });
  const doc = context.draftDocument();
  assert.equal(doc.exercise.assist, 'tutor');
  createHarness();
  context.loadData(JSON.parse(JSON.stringify(doc)));
  const textOf = n => (n?.textContent || '') + (n?.children || []).map(textOf).join(' ');
  assert.match(textOf(getElement('exercise-body')), /StateMate: hints only/);
});
