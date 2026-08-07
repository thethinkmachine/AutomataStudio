import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The half of a statechart configuration that is not in the picture.
//
// A guarded machine takes a different arrow out of the same drawn state on
// different visits, and a history region resumes somewhere that depends on
// where the run has already been. Both are the point of the feature — "a flag
// is a state you didn't draw" is the title of the shipped example — and neither
// was anywhere in the simulator, which showed only the highlighted node.
//
// productFlatten had the values all along; it just dropped them on the floor
// after building the flat state id. These pin them to the step objects the
// panel reads.

const harness = createHarness();
const { context } = harness;
const { App } = context;

// The guards example, reduced: a key has to be taken before the door opens.
function vault() {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['takeKey', 'open']);
  App.flags = ['hasKey'];
  App.states = [
    { id: 'h', x: 0, y: 0, name: 'hall' },
    { id: 'v', x: 200, y: 0, name: 'vault' }
  ];
  App.transitions = [
    { id: 't1', from: 'h', to: 'h', symbol: 'takeKey', assign: 'hasKey' },
    { id: 't2', from: 'h', to: 'v', symbol: 'open', guard: 'hasKey' }
  ];
  App.startId = 'h';
  App.accepts = new Set(['v']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
}

const run = word => context.simRSM(word === '' ? [] : word.split(' '));

test('the flag valuation rides on every step', () => {
  vault();
  run('takeKey open');
  assert.ok(App.simSteps.length);
  for (const step of App.simSteps) {
    assert.ok(step.vals && 'hasKey' in step.vals,
      'every configuration has a valuation, including the first');
  }
});

test('the valuation shows the flag flipping, which is the whole point', () => {
  vault();
  run('takeKey open');
  assert.equal(App.simSteps[0].vals.hasKey, false, 'starts false');
  assert.equal(App.simSteps[App.simSteps.length - 1].vals.hasKey, true,
    'and the assignment is visible as a change rather than inferred');
});

// Same drawn state, same drawn arrow, different answer — the reason the panel
// has to show something the canvas cannot.
test('the same drawn state appears with two different valuations', () => {
  vault();
  run('takeKey open');
  const inHall = App.simSteps.filter(s => s.state === 'h');
  const seen = new Set(inHall.map(s => (s.vals.hasKey ? '1' : '0')));
  assert.equal(seen.size, 2,
    'hall is two configurations; the picture draws it once');
});

test('a machine with no flags carries no valuation row', () => {
  vault();
  App.flags = [];
  App.transitions = [{ id: 't2', from: 'h', to: 'v', symbol: 'open' }];
  run('open');
  assert.equal(App.simSteps[0].vals, null,
    'an empty row would be noise on every non-guarded machine');
});

// ── history memory ────────────────────────────────────────────────

function player() {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['next', 'pause', 'resume']);
  App.states = [
    { id: 'P', x: 0, y: 0, name: 'Playing', super: true, initial: 'd1' },
    { id: 'd1', x: -60, y: 0, name: 'DiscOne', parent: 'P' },
    { id: 'd2', x: 60, y: 0, name: 'DiscTwo', parent: 'P' },
    { id: 'z', x: 300, y: 0, name: 'Paused' }
  ];
  App.transitions = [
    { id: 't1', from: 'd1', to: 'd2', symbol: 'next' },
    { id: 't2', from: 'P', to: 'z', symbol: 'pause' },
    { id: 't3', from: 'z', to: 'P', symbol: 'resume', entryMode: 'history' }
  ];
  App.startId = 'd1';
  App.accepts = new Set(['d2']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
}

test('history memory rides on every step, named by region and child', () => {
  player();
  run('next pause resume');
  const last = App.simSteps[App.simSteps.length - 1];
  assert.ok(last.mem, 'the region remembers something');
  assert.ok('Playing' in last.mem, 'keyed by the region\'s NAME, not its id');
  assert.equal(last.mem.Playing, 'DiscTwo',
    'resume lands back where the run left, and the panel can say so');
});

test('a region never visited reads as unset rather than as absent', () => {
  player();
  run('pause');
  assert.ok(App.simSteps[0].mem, 'the row exists from step 0');
  assert.equal(typeof App.simSteps[0].mem.Playing, 'string',
    'so the row keeps a stable shape instead of growing a column mid-run');
});

// ── the flag-name autocomplete ────────────────────────────────────

test('typing a prefix in a guard field offers the declared flags', () => {
  vault();
  App.flags = ['hasKey', 'alarm'];
  const el = context.$('m-guard');
  el.value = 'has';
  el.selectionStart = 3;
  const state = context.getFlagSuggestState(el);
  assert.equal(state.mode, 'filter');
  assert.deepEqual(state.candidates, ['hasKey']);
  assert.equal(state.prefixEnd, 0, 'the identifier under the caret is what gets replaced');
  assert.equal(state.replaceEnd, 3);
});

test('completion targets the identifier at the caret, not the whole expression', () => {
  vault();
  App.flags = ['hasKey', 'alarm'];
  const el = context.$('m-guard');
  el.value = 'hasKey && al';
  el.selectionStart = el.value.length;
  const state = context.getFlagSuggestState(el);
  assert.deepEqual(state.candidates, ['alarm']);
  assert.equal(state.prefixEnd, 10, 'splices over "al" only, leaving the && intact');
});

test('an undeclared name is not an error — it reads false, and the dialog offers to declare it', () => {
  vault();
  App.flags = ['hasKey'];
  const el = context.$('m-guard');
  el.value = 'zzz';
  el.selectionStart = 3;
  assert.equal(context.getFlagSuggestState(el).mode, 'none',
    'shouting here would be the third message about one typo');
});

test('no declared flags means no popover at all', () => {
  vault();
  App.flags = [];
  const el = context.$('m-guard');
  el.value = 'a';
  el.selectionStart = 1;
  assert.equal(context.getFlagSuggestState(el).mode, 'none');
});
