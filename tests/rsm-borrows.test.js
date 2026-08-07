import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// What RSM borrowed back from HSM.
//
// A region is a visible object: you can see its structure, see where it enters,
// and point at it. A component was none of those things — invisible unless you
// happened to be standing inside it, with no way to see how many existed,
// rename one, or delete an unused one. renameComponent and deleteComponent were
// written, exported, and called from nowhere at all.
//
// And a box said only what it invoked. Not where a call lands, not whether the
// component reaches itself — which is the single fact that decides whether this
// machine is regular or context-free.

const harness = createHarness();
const { context } = harness;
const { App } = context;

function recursive() {
  harness.resetApp();
  App.machine = 'RSM';
  App.sigma = new Set(['(', ')']);
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'q0' },
    { id: 's2', x: 120, y: 0, name: 'call' },
    { id: 's3', x: 240, y: 0, name: 'q1' }
  ];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: '(' },
    { id: 't2', from: 's2', to: 's3', symbol: ')' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s3']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
  App.states[1].callee = App.rootComponentId;   // calls itself
  context.flushActiveComponent();
}

// ── the component list ────────────────────────────────────────────

test('the sub-machine list is hidden for models without call sites', () => {
  recursive();
  App.machine = 'HSM';
  context.renderComponentList();
  assert.equal(context.$('components-sec').style.display, 'none',
    'containment has no components to list');
});

test('the list shows every component, not just the one you are standing in', () => {
  recursive();
  context.promoteToSubmachine('s3', 'Tail');
  context.renderComponentList();
  const html = context.$('components-list').innerHTML;
  assert.match(html, /Tail/);
  assert.equal(context.$('lp-count-components').textContent, String(App.components.length));
});

test('a recursive component is marked, because that is why the stack exists', () => {
  recursive();
  context.renderComponentList();
  assert.match(context.$('components-list').innerHTML, /cmp-rec/,
    'the fact that decides REG vs CFL should not need an algorithm card to find');
});

test('a component nothing reaches is marked unreachable', () => {
  recursive();
  const orphan = context.createComponent('Nobody');
  context.renderComponentList();
  const html = context.$('components-list').innerHTML;
  assert.match(html, /cmp-orphan/);
  assert.ok(orphan.id !== App.rootComponentId);
});

test('the root is marked and cannot be deleted', () => {
  recursive();
  context.renderComponentList();
  assert.match(context.$('components-list').innerHTML, /cmp-root/);
  assert.equal(context.deleteComponent(App.rootComponentId), false);
});

// Both of these were complete, exported, and unreachable from the UI.
test('rename is reachable and keeps names unique', () => {
  recursive();
  const sub = context.createComponent('Expr');
  assert.equal(context.renameComponent(sub.id, 'Term'), true);
  assert.equal(context.getComponent(sub.id).name, 'Term');
});

test('deleting a component turns its call sites back into plain states', () => {
  recursive();
  context.promoteToSubmachine('s1', 'Head');
  const head = App.components.find(c => c.name === 'Head');
  assert.equal(App.states.find(s => s.id === 's1').callee, head.id);
  context.deleteComponent(head.id);
  assert.equal(App.states.find(s => s.id === 's1').callee, undefined,
    'no call site is left pointing at nothing');
  assert.ok(!App.components.some(c => c.id === head.id));
});

// ── the call graph the renderer reads ─────────────────────────────

// recursiveComponents() goes through machineTree(), which flattens every
// component — far too much work for something the renderer asks once per pass.
test('the raw call graph finds recursion without flattening anything', () => {
  recursive();
  const rec = context.recursiveComponentIds();
  assert.equal(rec.has(App.rootComponentId), true);
});

test('the raw call graph agrees with the flattening one', () => {
  recursive();
  const viaTree = context.recursiveComponents(context.machineTree());
  const raw = context.recursiveComponentIds();
  assert.deepEqual([...raw].sort(), [...viaTree].sort(),
    'the cheap read has to be the same read, or the canvas and the card disagree');
});

test('a non-recursive machine reports none', () => {
  recursive();
  delete App.states[1].callee;
  context.flushActiveComponent();
  assert.equal(context.recursiveComponentIds().size, 0);
});

// ── the Nest row ──────────────────────────────────────────────────

test('a run through a nest reports the containment chain', () => {
  harness.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['x']);
  App.states = [
    { id: 'R', x: 0, y: 0, name: 'Combat', super: true, initial: 'I' },
    { id: 'I', x: 0, y: 0, name: 'Melee', super: true, parent: 'R', initial: 'a' },
    { id: 'a', x: 0, y: 0, name: 'strike', parent: 'I' }
  ];
  App.transitions = [{ id: 't1', from: 'a', to: 'a', symbol: 'x' }];
  App.startId = 'a';
  App.accepts = new Set(['a']);
  App.stateN = 20; App.transN = 20;
  context.ensureRootComponent();
  context.simRSM(['x']);
  const step = App.simSteps[0];
  assert.deepEqual(step.nest, ['Combat', 'Melee', 'strike'],
    'being in a state means being in every region containing it');
});

test('a flat machine carries no nest chain', () => {
  recursive();
  context.simRSM(['(']);
  assert.equal(App.simSteps[0].nest, null,
    'a one-item chain is not a hierarchy and would just be noise');
});
