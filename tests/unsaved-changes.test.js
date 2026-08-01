const test = require('node:test');
const assert = require('node:assert');
const { createHarness } = require('./harness');

const harness = createHarness();
const { context, getElement, evalInContext } = harness;

// Builds N workspaces and makes the first one active. `dirtyIds` marks which
// of them carry unsaved changes.
//
// `Workspaces` is a top-level `let` inside the vm context, so assigning
// tabs() would only shadow it with an own-property the module
// code never reads. Everything here goes through the live binding instead:
// splice to reseed, and a helper to read it back.
function seedTabs(names, dirtyIds = []) {
  harness.resetApp();
  const seeded = names.map((name, i) => ({
    id: `w${i}`,
    name,
    dirty: dirtyIds.includes(`w${i}`),
    data: { machine: 'dfa', states: [], transitions: [] }
  }));
  evalInContext(`Workspaces.length = 0; activeWorkspaceId = 'w0';`);
  tabs().push(...seeded);
  return tabs();
}

// Reads the live binding rather than a stale reference: the close paths
// reassign Workspaces wholesale (`Workspaces = Workspaces.filter(...)`).
function tabs() {
  return evalInContext('Workspaces');
}

function unsavedModalShown() {
  return context.isModalOpen('unsaved-modal');
}

// ── The gate itself ───────────────────────────────────────────────

test('closing a clean tab does not prompt', () => {
  seedTabs(['A', 'B']);
  const { closeTab, Workspaces } = context;

  closeTab('w1');

  assert.strictEqual(unsavedModalShown(), false, 'a clean tab must close without a dialog');
  assert.strictEqual(tabs().length, 1);
  assert.ok(!tabs().find(w => w.id === 'w1'), 'the tab should be gone');
});

test('closing a dirty tab prompts instead of closing', () => {
  seedTabs(['A', 'Scratch'], ['w1']);

  context.closeTab('w1');

  assert.strictEqual(unsavedModalShown(), true, 'a dirty tab must raise the prompt');
  assert.strictEqual(tabs().length, 2, 'nothing may close until the user answers');
  assert.match(getElement('unsaved-msg').textContent, /Scratch/, 'the prompt should name the tab');
});

test('Cancel leaves the workspace untouched', () => {
  seedTabs(['A', 'Scratch'], ['w1']);
  context.closeTab('w1');

  context.closeModal('unsaved-modal');

  assert.strictEqual(tabs().length, 2, 'Cancel must not close the tab');
  assert.strictEqual(tabs()[1].dirty, true, 'Cancel must not clear the dirty flag');
});

test('Discard closes the tab without saving', () => {
  seedTabs(['A', 'Scratch'], ['w1']);
  context.closeTab('w1');

  getElement('unsaved-discard-btn').onclick();

  assert.strictEqual(unsavedModalShown(), false, 'the dialog should close');
  assert.strictEqual(tabs().length, 1);
  assert.ok(!tabs().find(w => w.id === 'w1'), 'Discard must close the tab');
});

test('Save persists the tab and then closes it', () => {
  seedTabs(['A', 'Scratch'], ['w1']);
  context.closeTab('w1');

  getElement('unsaved-save-btn').onclick();

  assert.strictEqual(unsavedModalShown(), false, 'the dialog should close');
  assert.strictEqual(tabs().length, 1, 'Save must also close the tab');
  const backup = JSON.parse(context.localStorage.getItem('automata-backup'));
  assert.ok(backup, 'Save must write the backup');
});

// The prompt exists to protect unsaved work; if the save itself fails there
// is nothing to fall back on, so closing anyway would destroy exactly what
// the user asked to keep.
test('a failed save keeps the tab open rather than closing it', () => {
  seedTabs(['A', 'Scratch'], ['w1']);
  context.closeTab('w1');

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    getElement('unsaved-save-btn').onclick();
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(tabs().length, 2, 'a failed save must not close the tab');
  assert.strictEqual(tabs()[1].dirty, true, 'the tab must stay marked dirty');
  assert.strictEqual(unsavedModalShown(), true, 'the dialog stays up so the user can retry');
});

// ── Bulk closes ───────────────────────────────────────────────────

test('Close Others prompts once and reports the number of dirty tabs', () => {
  seedTabs(['Keep', 'B', 'C', 'D'], ['w1', 'w3']);

  context.closeOtherTabs('w0');

  assert.strictEqual(unsavedModalShown(), true);
  assert.match(getElement('unsaved-msg').textContent, /2 tabs/, 'should count only the dirty ones');
  assert.strictEqual(tabs().length, 4, 'nothing closes before the user answers');

  getElement('unsaved-discard-btn').onclick();
  assert.strictEqual(tabs().map(w => w.id).join(','), 'w0');
});

test('Close Others does not prompt when the closed tabs are clean', () => {
  seedTabs(['Keep', 'B', 'C'], ['w0']);

  context.closeOtherTabs('w0');

  assert.strictEqual(unsavedModalShown(), false, 'the dirty tab is the one being kept');
  assert.strictEqual(tabs().map(w => w.id).join(','), 'w0');
});

test('Close to the Right only considers tabs to the right', () => {
  seedTabs(['A', 'B', 'C'], ['w0']);

  context.closeTabsToRight('w0');

  assert.strictEqual(unsavedModalShown(), false, 'the dirty tab is to the left of the cut');
  assert.strictEqual(tabs().map(w => w.id).join(','), 'w0');
});

test('Close to the Right prompts for a dirty tab to the right', () => {
  seedTabs(['A', 'B', 'C'], ['w2']);

  context.closeTabsToRight('w0');

  assert.strictEqual(unsavedModalShown(), true);
  assert.strictEqual(tabs().length, 3, 'nothing closes before the user answers');
});

// ── Save button state ─────────────────────────────────────────────

test('saveWorkspace clears the dirty flag on the active tab', () => {
  seedTabs(['A'], ['w0']);

  const ok = context.saveWorkspace();

  assert.strictEqual(ok, true);
  assert.strictEqual(tabs()[0].dirty, false, 'saving must clear the dirty mark');
});

test('saveWorkspace reports failure when storage rejects the write', () => {
  seedTabs(['A'], ['w0']);

  const realSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  let ok;
  try {
    ok = context.saveWorkspace();
  } finally {
    context.localStorage.setItem = realSetItem;
  }

  assert.strictEqual(ok, false, 'a rejected write must not report success');
  assert.strictEqual(tabs()[0].dirty, true, 'the tab must stay dirty after a failed save');
});

test('the save button surfaces unsaved state', () => {
  seedTabs(['A', 'B'], ['w1']);

  context.updateSaveIndicator();
  assert.strictEqual(getElement('save-now-btn').classList.contains('is-dirty'), true);

  tabs().forEach(w => { w.dirty = false; });
  context.updateSaveIndicator();
  assert.strictEqual(getElement('save-now-btn').classList.contains('is-dirty'), false);
});
