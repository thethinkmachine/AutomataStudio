import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The sections inside a sidebar, and the order the reader put them in.
//
// Two things are being pinned here. The order itself — a saved list is a
// snapshot of a registry that has since changed, so it is reconciled rather
// than trusted. And the fact that the *list of sections* is now one list:
// it used to be three (an array in `initLPanelSections`, the keys of
// `RP_SECTION_DEFAULTS`, and the markup), and a section in one and not
// another silently never restores its collapsed state.

const harness = createHarness();
const { context } = harness;

// Derived from the registry, not written out again. The whole point of the file
// below is that there is one list of sections; a copy of it here would be a
// second one, and adding a section would mean editing it in two places — which
// is precisely the failure the registry exists to prevent.
const LP = context.declaredSectionIds('lpanel');
const RP = context.declaredSectionIds('rpanel');

/** The declared order with two entries swapped: a custom order, whatever the
 *  registry currently holds. */
function shuffled(ids) {
  const out = ids.slice();
  [out[0], out[out.length - 1]] = [out[out.length - 1], out[0]];
  return out;
}

function clearOrders() {
  ['lpanel', 'rpanel'].forEach(side => context.resetSectionOrder(side));
}

test('the declared order is the order absent any preference', () => {
  clearOrders();
  assert.deepEqual(context.sectionOrder('lpanel'), LP);
  assert.deepEqual(context.sectionOrder('rpanel'), RP);
  assert.equal(context.sectionOrderIsCustom('lpanel'), false);
});

test('a saved order is what comes back', () => {
  clearOrders();
  const custom = shuffled(RP);
  context.setSectionOrder('rpanel', custom);
  assert.deepEqual(context.sectionOrder('rpanel'), custom);
  assert.equal(context.sectionOrderIsCustom('rpanel'), true);
});

test('the default order is stored as the absence of a preference', () => {
  // So dragging a section back where it came from leaves no trace, and a
  // later change to the declared order still reaches a reader who never
  // expressed one. Storing a copy of the default would freeze them out.
  clearOrders();
  context.setSectionOrder('rpanel', shuffled(RP));
  assert.notEqual(context.localStorage.getItem('automata-rpanel-section-order'), null);
  context.setSectionOrder('rpanel', RP);
  assert.equal(context.localStorage.getItem('automata-rpanel-section-order'), null);
});

test('a saved id the registry no longer has is dropped', () => {
  clearOrders();
  context.localStorage.setItem('automata-rpanel-section-order',
    JSON.stringify(['rp-gone', ...RP]));
  assert.deepEqual(context.sectionOrder('rpanel'), RP);
});

test('a section the saved order predates lands where it was declared', () => {
  // The other half of the same rule. A new section must not be exiled to the
  // bottom of every panel that was ever reordered.
  clearOrders();
  context.localStorage.setItem('automata-lpanel-section-order',
    JSON.stringify(['lp-transitions', 'lp-states']));
  const order = context.sectionOrder('lpanel');
  assert.deepEqual([...order].sort(), [...LP].sort(), 'nothing is lost');
  assert.ok(order.indexOf('lp-transitions') < order.indexOf('lp-states'),
    'and the saved preference is kept');
  assert.equal(order[0], 'lp-alphabet', 'the unmentioned first section is still first');
});

test('a duplicated or garbage saved order still yields every section once', () => {
  clearOrders();
  context.localStorage.setItem('automata-rpanel-section-order',
    JSON.stringify(['rp-batch', 'rp-batch', 7, null, 'rp-batch']));
  // What survives the filter is a saved order of just ['rp-batch']; the two
  // it does not mention are then inserted at the positions they are declared
  // at, which pushes Batch Test to the end. There is no better answer for a
  // partial list, and it is the same rule a section added in a later version
  // gets.
  assert.deepEqual(context.sectionOrder('rpanel'), ['rp-language', 'rp-simulate', 'rp-batch']);

  context.localStorage.setItem('automata-rpanel-section-order', 'not json');
  assert.deepEqual(context.sectionOrder('rpanel'), RP);
});

test('moveSection clamps rather than refusing', () => {
  // It is what ↑/↓ drive, and pressing ↑ on the top section should do
  // nothing rather than throw.
  clearOrders();
  assert.deepEqual(context.moveSection('rpanel', 'rp-language', -3), RP);
  assert.deepEqual(context.moveSection('rpanel', 'rp-batch', 99), RP);
  assert.deepEqual(context.moveSection('rpanel', 'rp-batch', 0),
    ['rp-batch', 'rp-language', 'rp-simulate']);
  assert.deepEqual(context.moveSection('rpanel', 'nonexistent', 0),
    ['rp-batch', 'rp-language', 'rp-simulate'], 'an unknown id changes nothing');
});

test('setSectionOrder cannot write a section that does not exist', () => {
  clearOrders();
  const written = context.setSectionOrder('lpanel', ['lp-states', 'made-up', 'lp-alphabet']);
  assert.deepEqual(written.slice(0, 2), ['lp-states', 'lp-alphabet']);
  assert.deepEqual([...written].sort(), [...LP].sort(),
    'and everything it left out is still there, at the end');
});

test('every section belongs to exactly one side', () => {
  const seen = new Set();
  ['lpanel', 'rpanel'].forEach(side => {
    context.declaredSectionIds(side).forEach(id => {
      assert.equal(context.sectionSide(id), side);
      assert.ok(!seen.has(id), `${id} is declared twice`);
      seen.add(id);
    });
  });
  assert.equal(context.sectionSide('not-a-section'), null);
});

// ── the one list is the one list ──────────────────────────────────

test('the right panel\'s collapse defaults are derived from the registry', () => {
  assert.deepEqual(Object.keys(context.RP_SECTION_DEFAULTS), RP);
  assert.equal(context.RP_SECTION_DEFAULTS['rp-batch'], true,
    'Batch Test starts collapsed, and says so in one place');
  assert.equal(context.RP_SECTION_DEFAULTS['rp-language'], false);
  RP.forEach(id => assert.equal(
    context.RP_SECTION_DEFAULTS[id], context.sectionStartsCollapsed(id)));
});

test('a section restores its collapsed state on both panels', () => {
  // initLPanelSections used to carry its own array of ids; a section missing
  // from it was one whose collapsed state silently never came back.
  harness.resetApp();
  context.localStorage.setItem('automata-lpanel-section-lp-transitions', '1');
  context.localStorage.setItem('automata-rpanel-section-rp-language', '1');
  context.initLPanelSections();
  context.initRPanelSections();
  assert.ok(context.$('lp-transitions').classList.contains('collapsed'));
  assert.ok(context.$('rp-language').classList.contains('collapsed'));
  context.localStorage.removeItem('automata-lpanel-section-lp-transitions');
  context.localStorage.removeItem('automata-rpanel-section-rp-language');
});

// ── applying an order to the page ─────────────────────────────────

/** Builds the panel containers the way index.html has them. */
function mountPanels() {
  harness.resetApp();
  clearOrders();
  ['lpanel', 'rpanel'].forEach(side => {
    const cfg = context.PANEL_SECTIONS[side];
    const container = context.$(cfg.container);
    context.declaredSectionIds(side).forEach(id => container.appendChild(context.$(id)));
  });
}

function domIds(side) {
  return context.$(context.PANEL_SECTIONS[side].container).children.map(el => el.id);
}

test('applySectionOrder puts the DOM in the saved order', () => {
  mountPanels();
  assert.deepEqual(domIds('rpanel'), RP);

  context.setSectionOrder('rpanel', ['rp-simulate', 'rp-batch', 'rp-language']);
  context.applySectionOrder('rpanel');
  assert.deepEqual(domIds('rpanel'), ['rp-simulate', 'rp-batch', 'rp-language']);
});

test('applying an order the DOM already has moves nothing', () => {
  // `appendChild` on a child is a move, and a move can reset the transitions
  // inside the element it moves — so the no-op case has to actually be one.
  mountPanels();
  const before = context.$('rpanel-content').children.slice();
  context.applySectionOrder('rpanel');
  assert.deepEqual(context.$('rpanel-content').children, before);
});

test('reordering keeps every section, not just the visible ones', () => {
  // The stack and output sections are hidden for machines without a stack or
  // an output. They stay in the DOM, so they keep their place in the order.
  mountPanels();
  context.$('stack-sec').style.display = 'none';
  const custom = shuffled(LP);
  context.setSectionOrder('lpanel', custom);
  context.applySectionOrder('lpanel');
  assert.deepEqual(domIds('lpanel'), custom);
  context.$('stack-sec').style.display = '';
});

test('the order survives a reload — it is read back, not held in memory', () => {
  mountPanels();
  const custom = shuffled(LP);
  context.setSectionOrder('lpanel', custom);

  // Put the DOM back the way the markup has it, the way a fresh page would.
  const container = context.$('lpanel-content');
  LP.forEach(id => container.appendChild(context.$(id)));
  assert.deepEqual(domIds('lpanel'), LP);

  context.applySectionOrder('lpanel');
  assert.equal(domIds('lpanel')[0], custom[0]);
});
