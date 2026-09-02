import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Pulling a section out of its panel and putting it over the canvas.
//
// Three things are being pinned. That the record is a *preference* — docked is
// the absence of one, and it reaches no serializer, the same rule the section
// order and StateMate's panel side follow. That floating is a reparent of the
// live element and never a copy, which is the whole reason the feature costs
// one `appendChild` rather than a second implementation of every section. And
// that a window put back lands where the reader's order says it belongs.

const harness = createHarness();
const { context } = harness;

const LP = ['lp-alphabet', 'stack-sec', 'output-sec', 'lp-states', 'lp-transitions'];
const RP = ['rp-language', 'rp-simulate', 'rp-batch'];

/**
 * A device the feature is for.
 *
 * The stub answers every media query with `matches: false`, which reads as a
 * narrow, coarse-pointer device — and the feature is deliberately off there.
 * So a test that wants a window has to say it is on a desktop, the same way it
 * would have to supply a viewport.
 */
function desktop(on = true) {
  context.matchMedia = () => ({
    matches: on, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
}

/** Builds the panel containers and the canvas well the way index.html has them. */
function mount() {
  harness.resetApp();
  desktop();
  context.resetPanelFloat();
  ['lpanel', 'rpanel'].forEach(side => {
    context.resetSectionOrder(side);
    const cfg = context.PANEL_SECTIONS[side];
    const container = context.$(cfg.container);
    container.innerHTML = '';
    context.declaredSectionIds(side).forEach(id => {
      const el = context.$(id);
      el.style.display = '';
      el.classList.remove('panel-float', 'collapsed');
      container.appendChild(el);
    });
  });
  const wrap = context.$('canvas-wrap');
  wrap.innerHTML = '';
  return wrap;
}

function domIds(side) {
  const cfg = context.PANEL_SECTIONS[side];
  return context.$(cfg.container).children.map(el => el.id).filter(id => LP.includes(id) || RP.includes(id));
}

// ── the record ────────────────────────────────────────────────────

test('a section is docked until something says otherwise', () => {
  mount();
  assert.equal(context.floatState('rp-simulate'), null);
  assert.equal(context.isSectionFloating('rp-simulate'), false);
  assert.deepEqual(context.dockedSectionIds('rpanel'), RP);
  assert.deepEqual(context.floatingSectionIds('rpanel'), []);
});

test('docked is stored as the absence of a preference', () => {
  // Same rule as the section order: a window put back leaves nothing behind,
  // so a later change to the defaults still reaches a reader who never
  // expressed one.
  mount();
  context.setFloatState('rp-simulate', { x: 40, y: 60, w: 300, h: 240 });
  assert.notEqual(context.localStorage.getItem('automata-rpanel-section-float'), null);
  context.setFloatState('rp-simulate', null);
  assert.equal(context.localStorage.getItem('automata-rpanel-section-float'), null);
});

test('geometry round-trips, and is clamped to something readable', () => {
  mount();
  context.setFloatState('lp-states', { x: 12, y: 34, w: 420, h: 300 });
  assert.deepEqual(context.floatState('lp-states'), { x: 12, y: 34, w: 420, h: 300 });

  context.setFloatState('lp-states', { x: 0, y: 0, w: 10, h: 10 });
  const g = context.floatState('lp-states');
  const min = context.sectionMinSize('lp-states');
  assert.deepEqual({ w: g.w, h: g.h }, min);
});

test('how small a window may be made is a property of the section', () => {
  // "Too small to use" is about the content, not the frame: the alphabet is a
  // wrapping field of chips and shrinks gracefully, while Simulate is a
  // labelled transport with a tape strip under it and stops being operable
  // long before that.
  const alphabet = context.sectionMinSize('lp-alphabet');
  const simulate = context.sectionMinSize('rp-simulate');
  assert.ok(simulate.w > alphabet.w && simulate.h > alphabet.h);
  // And every declared minimum still clears the floor a section that declares
  // nothing would get.
  ['lpanel', 'rpanel'].forEach(side => {
    context.declaredSectionIds(side).forEach(id => {
      const m = context.sectionMinSize(id);
      assert.ok(m.w >= context.FLOAT_MIN_W && m.h >= context.FLOAT_MIN_H, id);
    });
  });
});

test('a stored record the registry no longer has is dropped', () => {
  mount();
  context.localStorage.setItem('automata-rpanel-section-float', JSON.stringify({
    'rp-gone': { x: 1, y: 2, w: 300, h: 300 },
    'rp-batch': { x: 5, y: 6, w: 300, h: 300 }
  }));
  assert.deepEqual(Object.keys(context.floatStates('rpanel')), ['rp-batch']);
});

test('geometry that did not survive the round trip does not position a window at NaN', () => {
  mount();
  context.localStorage.setItem('automata-rpanel-section-float', JSON.stringify({
    'rp-batch': { x: 'left', y: null, w: undefined, h: {} }
  }));
  const g = context.floatStates('rpanel')['rp-batch'];
  assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y));
  assert.ok(g.w >= context.FLOAT_MIN_W && g.h >= context.FLOAT_MIN_H);

  context.localStorage.setItem('automata-rpanel-section-float', 'not json');
  assert.deepEqual(context.floatStates('rpanel'), {});
});

test('where a window sits is a preference and reaches no serializer', () => {
  // exportWorkspaceState deep-copies App.config into every tab and
  // getBackupPayload writes it to IndexedDB, so a layout stored there would
  // travel with the machine — and a `.json` that rearranged the next reader's
  // panels would be a file describing something other than the machine in it.
  mount();
  context.floatSection('rp-simulate', { x: 77, y: 88, w: 361, h: 234 });
  ['exportWorkspaceState', 'getWorkspaceData', 'getEditorSettingsData'].forEach(fn => {
    const json = JSON.stringify(context[fn]());
    assert.ok(!json.includes('rp-simulate'), `${fn} carries the float record`);
    assert.ok(!json.includes('361'), `${fn} carries the float geometry`);
  });
});

// ── floating is a reparent, never a copy ──────────────────────────

test('floating moves the live element into the layer over the canvas', () => {
  const wrap = mount();
  const before = context.$('rp-simulate');
  context.floatSection('rp-simulate', { x: 30, y: 40, w: 360, h: 280 });

  const layer = context.$('panel-float-layer');
  assert.equal(layer.parentNode, wrap, 'the layer lives inside the canvas well');
  assert.ok(layer.children.includes(before), 'and holds the section itself');
  assert.strictEqual(context.$('rp-simulate'), before, 'the same node, not a copy');
  assert.ok(before.classList.contains('panel-float'));
  assert.ok(!domIds('rpanel').includes('rp-simulate'), 'and it has left the panel');
});

test('closing returns the same node to the slot the order gives it', () => {
  // The identity assertion is the one that catches a clone-based
  // implementation: a copy would draw the right picture and strand every
  // listener, cache and back-reference the original carried.
  mount();
  const node = context.$('rp-simulate');
  context.floatSection('rp-simulate');
  context.dockSection('rp-simulate');

  assert.strictEqual(context.$('rp-simulate'), node);
  assert.deepEqual(domIds('rpanel'), RP, 'and to its own slot, not the bottom');
  assert.equal(context.isSectionFloating('rp-simulate'), false);
  assert.ok(!node.classList.contains('panel-float'));
  assert.equal(node.style.left, '');
  assert.equal(node.style.height, '');
});

test('a window returns to the reader\'s order, not the declared one', () => {
  mount();
  context.setSectionOrder('rpanel', ['rp-batch', 'rp-simulate', 'rp-language']);
  context.applySectionOrder('rpanel');
  context.floatSection('rp-simulate');
  assert.deepEqual(domIds('rpanel'), ['rp-batch', 'rp-language']);
  context.dockSection('rp-simulate');
  assert.deepEqual(domIds('rpanel'), ['rp-batch', 'rp-simulate', 'rp-language']);
});

test('toggling is the same act read in both directions', () => {
  mount();
  context.toggleSectionFloat('lp-states');
  assert.equal(context.isSectionFloating('lp-states'), true);
  context.toggleSectionFloat('lp-states');
  assert.equal(context.isSectionFloating('lp-states'), false);
});

// ── the order pass has to know ────────────────────────────────────

test('applySectionOrder leaves the floating ones where they are', () => {
  // It appends every id in the order to the panel container, and `appendChild`
  // on a node in another parent *moves* it — so without this every window
  // would be yanked back into its panel by the next reorder, collapse or
  // machine switch.
  mount();
  context.floatSection('lp-states', { x: 20, y: 20, w: 360, h: 280 });
  const layer = context.$('panel-float-layer');

  context.setSectionOrder('lpanel', ['lp-transitions', 'lp-alphabet', 'stack-sec', 'output-sec', 'lp-states']);
  context.applySectionOrder('lpanel');

  assert.ok(layer.children.includes(context.$('lp-states')), 'still a window');
  assert.deepEqual(domIds('lpanel'), ['lp-transitions', 'lp-alphabet', 'stack-sec', 'output-sec']);
});

test('a floating section keeps its place in the order it is not occupying', () => {
  mount();
  context.floatSection('lp-alphabet');
  assert.deepEqual(context.sectionOrder('lpanel'), LP, 'the order is untouched');
  assert.deepEqual(context.dockedSectionIds('lpanel'), LP.filter(id => id !== 'lp-alphabet'));
  assert.deepEqual(context.floatingSectionIds('lpanel'), ['lp-alphabet']);
});

// ── the panel it left ─────────────────────────────────────────────

test('a panel with everything pulled out of it says so', () => {
  mount();
  RP.forEach(id => context.floatSection(id));
  const note = context.$('rpanel-float-empty');
  assert.equal(note.parentNode, context.$('rpanel-content'));
  assert.equal(note.style.display, '');

  context.dockAllSections('rpanel');
  assert.deepEqual(domIds('rpanel'), RP);
  assert.equal(context.$('rpanel-float-empty').style.display, 'none');
});

test('a panel whose only sections are hidden is empty too', () => {
  // applyMachineSwitch hides the stack and output sections with style.display
  // for machines that have neither. A panel showing nothing needs its empty
  // state whether the sections left or were merely hidden.
  mount();
  ['lp-alphabet', 'lp-states', 'lp-transitions'].forEach(id => context.floatSection(id));
  context.$('stack-sec').style.display = 'none';
  context.$('output-sec').style.display = 'none';
  context.syncPanelEmpty('lpanel');
  assert.equal(context.$('lpanel-float-empty').style.display, '');

  context.$('stack-sec').style.display = '';
  context.syncPanelEmpty('lpanel');
  assert.equal(context.$('lpanel-float-empty').style.display, 'none');
});

// ── it is still the panel's section ───────────────────────────────

test('a floating section still redraws when the machine changes', () => {
  // The point of reparenting the live element rather than copying it: every
  // renderer addresses its target by id, so nothing about a window is a
  // special case downstream.
  mount();
  context.floatSection('lp-alphabet');
  context.App.sigma = new Set(['a', 'b', 'c']);
  context.emit(context.Change.ALPHABET, context.Change.GRAPH);
  assert.equal(context.$('lp-count-sigma').textContent, '3');
});

test('minimize is the collapse the section already had', () => {
  // Not a second state to persist: the same class, the same storage key, and
  // the same meaning docked or floating.
  mount();
  context.floatSection('rp-batch', { x: 10, y: 10, w: 360, h: 300 });
  context.setRPSectionCollapsed('rp-batch', true);
  assert.ok(context.$('rp-batch').classList.contains('collapsed'));
  assert.equal(context.localStorage.getItem('automata-rpanel-section-rp-batch'), '1');
  // The stored height survives it, so expanding comes back to the same window.
  assert.equal(context.floatState('rp-batch').h, 300);
  context.setRPSectionCollapsed('rp-batch', false);
});

// ── moving ────────────────────────────────────────────────────────

test('a move repaints and only the commit writes', () => {
  mount();
  context.floatSection('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const moved = context.moveFloatTo('rp-batch', 120, 90);
  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 120, y: 90 });
  assert.equal(context.floatState('rp-batch').x, 10, 'not yet recorded');

  context.commitFloatGeom('rp-batch', moved);
  assert.equal(context.floatState('rp-batch').x, 120);
});

test('moving something that is not a window does nothing', () => {
  mount();
  assert.equal(context.moveFloatTo('rp-batch', 40, 40), null);
});

// ── the restore pass ──────────────────────────────────────────────

test('applyFloatLayout puts a saved layout back on the page', () => {
  mount();
  context.setFloatState('lp-states', { x: 44, y: 55, w: 360, h: 280 });
  context.applyFloatLayout();

  const el = context.$('lp-states');
  assert.ok(el.classList.contains('panel-float'));
  assert.equal(el.style.left, '44px');
  assert.equal(el.style.width, '360px');
  assert.ok(!domIds('lpanel').includes('lp-states'));
});

test('applyFloatLayout is idempotent', () => {
  mount();
  context.floatSection('lp-states', { x: 44, y: 55, w: 360, h: 280 });
  const node = context.$('lp-states');
  context.applyFloatLayout();
  context.applyFloatLayout();
  assert.strictEqual(context.$('lp-states'), node);
  assert.equal(context.$('panel-float-layer').children.filter(c => c === node).length, 1);
});

test('resetPanelFloat docks everything the tests floated', () => {
  mount();
  context.floatSection('lp-states');
  context.resetPanelFloat();
  assert.equal(context.isSectionFloating('lp-states'), false);
  assert.equal(context.isMovingFloat(), false);
});

// ── the gestures ──────────────────────────────────────────────────
//
// Moving and resizing are delegated from `document` rather than wired onto
// each section, and this is the half that pins why. Per-section listeners have
// to be attached by a pass running at the right moment, exactly once, over a
// section whose header the pass could find — three ways to end up with a
// window that paints correctly, looks movable and is inert, none of which
// raise anything. These drive the real document listeners, so a regression
// there fails here rather than on the page.

import { dispatchDocumentEvent } from './harness.js';

/** A section with the header index.html gives it, plus a working `closest`. */
function mountWindow(id, geom) {
  mount();
  context.initPanelFloat();
  const side = context.sectionSide(id);
  const cfg = context.PANEL_SECTIONS[side];
  const el = context.$(id);

  const header = context.document.createElement('div');
  header.className = cfg.headerClass;
  el.appendChild(header);
  el.querySelector = sel => (sel === '.' + cfg.headerClass ? header : null);

  // The stub has no tree walk; these are the two answers the delegation asks
  // for, and they are what a real `closest` would give.
  const chain = (node, extra) => sel => {
    if (sel === '.panel-float') return el.classList.contains('panel-float') ? el : null;
    if (sel === '.' + cfg.headerClass) return node === header || extra === 'header' ? header : null;
    if (sel === extra) return node;
    return null;
  };
  header.closest = chain(header, 'header');

  context.floatSection(id, geom);
  const grab = el.__floatGrabs.se;
  Object.values(el.__floatGrabs).forEach(g => {
    g.closest = sel => (sel === '.panel-float' ? el
      : sel === '.panel-float-resize' ? g : null);
  });
  const btn = el.__floatBtn;
  btn.closest = chain(btn, '.panel-float-btn');
  return { el, header, grab, btn };
}

function press(target, x, y) {
  dispatchDocumentEvent('pointerdown', {
    target, button: 0, pointerId: 1, clientX: x, clientY: y
  });
}

function drag(x, y) {
  dispatchDocumentEvent('pointermove', { clientX: x, clientY: y });
}

test('a press on the title bar moves the window', () => {
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);
  drag(160, 140);
  assert.equal(context.isMovingFloat(), true);
  assert.equal(el.style.left, '70px');
  assert.equal(el.style.top, '50px');

  dispatchDocumentEvent('pointerup', {});
  assert.equal(context.isMovingFloat(), false);
  assert.equal(context.floatState('rp-batch').x, 70, 'and the release is the one write');
});

test('a move paints every frame and records once', () => {
  const { header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);
  drag(150, 100);
  assert.equal(context.floatState('rp-batch').x, 10, 'nothing written mid-drag');
  drag(200, 100);
  dispatchDocumentEvent('pointerup', {});
  assert.equal(context.floatState('rp-batch').x, 110);
});

test('a press that does not travel is not a move', () => {
  // It is a click on the header, which collapses the section — the same thing
  // it means in the panel.
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);
  drag(101, 101);
  assert.equal(context.isMovingFloat(), false);
  assert.equal(el.style.left, '10px');
  dispatchDocumentEvent('pointerup', {});
});

test('the click a move ends in does not collapse the window', () => {
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);
  drag(180, 160);
  dispatchDocumentEvent('pointerup', {});
  const ev = dispatchDocumentEvent('click', { target: header });
  assert.equal(ev.defaultPrevented, true, 'the drag swallows its own click');

  // ...and the next click is a real one again.
  const next = dispatchDocumentEvent('click', { target: header });
  assert.equal(next.defaultPrevented, false);
  assert.ok(!el.classList.contains('collapsed'));
});

test('the south-east corner resizes and never moves', () => {
  const { el, grab } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(grab, 300, 300);
  drag(380, 360);
  assert.equal(el.style.width, '440px');
  assert.equal(el.style.height, '340px');
  assert.equal(el.style.left, '10px', 'the corner does not drag the window');
  dispatchDocumentEvent('pointerup', {});
  assert.deepEqual(context.floatState('rp-batch'), { x: 10, y: 10, w: 440, h: 340 });
});

test('a resize cannot shrink a window past its section\'s minimum', () => {
  const { el, grab } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const min = context.sectionMinSize('rp-batch');
  press(grab, 300, 300);
  drag(0, 0);
  assert.equal(el.style.width, min.w + 'px');
  assert.equal(el.style.height, min.h + 'px');
  dispatchDocumentEvent('pointerup', {});
});

test('the close button is a control, not a title bar', () => {
  const { el, btn } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(btn, 100, 100);
  drag(200, 200);
  assert.equal(context.isMovingFloat(), false);
  assert.equal(el.style.left, '10px');
  dispatchDocumentEvent('pointerup', {});
});

test('a docked section is not draggable around the canvas', () => {
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  context.dockSection('rp-batch');
  press(header, 100, 100);
  drag(200, 200);
  assert.equal(context.isMovingFloat(), false);
  assert.equal(el.style.left, '');
});

test('a gesture the pointer never finishes does not strand the next one', () => {
  const { header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);
  drag(200, 200);
  dispatchDocumentEvent('pointercancel', {});
  assert.equal(context.isMovingFloat(), false);
});

// ── the click a press must stay ───────────────────────────────────

test('a press on the title bar takes no pointer capture until it travels', () => {
  // This is the whole of the minimize bug. Capturing on `pointerdown`
  // retargets the `pointerup` to the captured element, so the browser computes
  // the click's target as the nearest common ancestor of the two — the
  // section, which is the header's *parent*. The header's own `onclick` then
  // never runs and the window cannot be collapsed at all. A press is a click
  // until it moves, so the capture waits until it is not one.
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const captured = [];
  el.setPointerCapture = id => captured.push(id);
  el.releasePointerCapture = () => {};

  press(header, 100, 100);
  assert.deepEqual(captured, [], 'nothing captured on the press');
  drag(101, 101);
  assert.deepEqual(captured, [], 'nor on travel below the threshold');
  dispatchDocumentEvent('pointerup', {});
  assert.deepEqual(captured, [], 'nor by a press that was only ever a click');
});

test('a move does take the pointer, once it is a move', () => {
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const captured = [];
  el.setPointerCapture = id => captured.push(id);
  el.releasePointerCapture = () => {};

  press(header, 100, 100);
  drag(160, 140);
  assert.deepEqual(captured, [1], 'taken exactly once, at the threshold');
  drag(200, 180);
  assert.deepEqual(captured, [1], 'and not again on every frame');
  dispatchDocumentEvent('pointerup', {});
});

// ── two windows are two windows ───────────────────────────────────

test('windows opened from the button cascade instead of stacking', () => {
  // Three sections popped out from their buttons would otherwise land on the
  // same coordinates, and the reader would see one window with no sign that
  // the other two had opened underneath it.
  mount();
  context.floatSection('rp-language');
  context.floatSection('rp-simulate');
  context.floatSection('rp-batch');
  const at = ['rp-language', 'rp-simulate', 'rp-batch'].map(id => {
    const g = context.floatState(id);
    return g.x + ',' + g.y;
  });
  assert.equal(new Set(at).size, 3, `three windows, three positions: ${at}`);
});

test('a window reopened where it was left does not cascade again', () => {
  // The cascade is for a window that has never had a position. One that has is
  // put back exactly where the reader left it.
  mount();
  context.setFloatState('rp-batch', { x: 200, y: 150, w: 360, h: 280 });
  context.floatSection('rp-batch');
  assert.deepEqual(context.floatState('rp-batch'),
    { x: 200, y: 150, w: 360, h: 280 });
});

// ── the DOM the browser actually hands back ───────────────────────

test('the empty-state check survives a real HTMLCollection', () => {
  // `container.children` is an HTMLCollection in a browser, and an
  // HTMLCollection has none of Array's methods — `.some()` there is
  // `undefined`, and calling it throws. The stub backs `children` with a real
  // array, so this is precisely the kind of mistake a test DOM cannot notice
  // on its own: it crashed `floatSection` mid-way through, leaving a section
  // reparented into the layer while the gesture that moved it carried on
  // believing it was still reordering a panel.
  //
  // Only the read is swapped, and only for the length of the call — the stub's
  // own appendChild needs the array back, so anything wider than this would be
  // testing the stub rather than the code.
  mount();
  const container = context.$('rpanel-content');
  const real = container.children;
  const collection = { length: real.length, [Symbol.iterator]: () => real[Symbol.iterator]() };
  real.forEach((el, i) => { collection[i] = el; });
  assert.equal(typeof collection.some, 'undefined', 'array-like, as the browser gives it');

  Object.defineProperty(container, 'children', { get: () => collection, configurable: true });
  try {
    assert.doesNotThrow(() => context.syncPanelEmpty('rpanel'));
    assert.equal(context.$('rpanel-float-empty').style.display, 'none',
      'and it still reads the panel correctly');
  } finally {
    Object.defineProperty(container, 'children', { value: real, writable: true, configurable: true });
  }
});

test('a move keeps the size the window was resized to', () => {
  // The size used to be read out of storage. A write that failed — a full
  // quota, a private-mode refusal — would then snap the window to the minimum
  // the moment it was dragged, having painted correctly until then.
  const { el, grab, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(grab, 300, 300);
  drag(400, 380);
  dispatchDocumentEvent('pointerup', {});
  assert.equal(el.style.width, '460px');

  press(header, 100, 100);
  drag(150, 130);
  assert.equal(el.style.width, '460px', 'the move did not resize it');
  assert.equal(el.style.height, '360px');
  dispatchDocumentEvent('pointerup', {});
});

// ── resizing from every side ──────────────────────────────────────

/** Drives one resize gesture and reports the box it left. */
function resizeBy(id, edge, dx, dy) {
  const el = context.$(id);
  const grab = el.__floatGrabs[edge];
  press(grab, 500, 500);
  drag(500 + dx, 500 + dy);
  dispatchDocumentEvent('pointerup', {});
  return context.floatState(id);
}

test('a window resizes from all eight of its edges', () => {
  const box = { x: 200, y: 200, w: 400, h: 320 };
  const cases = {
    e: { x: 200, y: 200, w: 440, h: 320 },
    s: { x: 200, y: 200, w: 400, h: 360 },
    se: { x: 200, y: 200, w: 440, h: 360 },
    w: { x: 240, y: 200, w: 360, h: 320 },
    n: { x: 200, y: 240, w: 400, h: 280 },
    nw: { x: 240, y: 240, w: 360, h: 280 },
    ne: { x: 200, y: 240, w: 440, h: 280 },
    sw: { x: 240, y: 200, w: 360, h: 360 }
  };
  for (const [edge, want] of Object.entries(cases)) {
    mountWindow('rp-batch', box);
    assert.deepEqual(resizeBy('rp-batch', edge, 40, 40), want, `dragging ${edge}`);
  }
});

test('a west or north edge stops at the minimum instead of walking away', () => {
  // The opposite edge is pinned rather than the width merely clamped. Clamping
  // alone lets `x` go on travelling once the width has bottomed out, so a
  // window dragged past its own minimum from the left creeps off to the right
  // while apparently refusing to resize.
  const min = context.sectionMinSize('rp-batch');
  mountWindow('rp-batch', { x: 200, y: 200, w: 400, h: 320 });
  const g = resizeBy('rp-batch', 'w', 900, 0);
  assert.equal(g.w, min.w);
  assert.equal(g.x, 200 + 400 - min.w, 'the east edge has not moved');

  mountWindow('rp-batch', { x: 200, y: 200, w: 400, h: 320 });
  const h = resizeBy('rp-batch', 'n', 0, 900);
  assert.equal(h.h, min.h);
  assert.equal(h.y, 200 + 320 - min.h, 'the south edge has not moved');
});

// ── the device ────────────────────────────────────────────────────

test('there are no windows on a phone, and nothing is forgotten either', () => {
  // A window wants a pointer that can hover a 6px band and hold a title bar,
  // and below the breakpoint the panels are bottom sheets with nothing to
  // float over. What the reader arranged on a desktop has to survive being
  // opened on a phone, so the feature suspends rather than docking for good.
  mount();
  context.floatSection('rp-batch', { x: 40, y: 40, w: 360, h: 280 });
  assert.equal(context.isSectionFloating('rp-batch'), true);

  desktop(false);
  context.applyFloatLayout();
  assert.equal(context.floatingEnabled(), false);
  assert.ok(!context.$('rp-batch').classList.contains('panel-float'), 'docked on the page');
  assert.deepEqual(context.floatState('rp-batch'), { x: 40, y: 40, w: 360, h: 280 },
    'and still remembered');
  assert.equal(context.floatSection('lp-states'), null, 'nothing new floats either');

  desktop(true);
  context.applyFloatLayout();
  assert.ok(context.$('rp-batch').classList.contains('panel-float'), 'back where it was');
  assert.equal(context.$('rp-batch').style.left, '40px');
});

// ── what stretches when a window does ─────────────────────────────

test('one region of a section absorbs a window\'s spare height', () => {
  // Everything else keeps the height it was drawn for, so resizing grows the
  // list or the trace log and leaves the fields and transport controls above
  // it alone. Two flexible children would share the slack between them, which
  // is how a resize turns into a layout nobody designed.
  ['lpanel', 'rpanel'].forEach(side => {
    context.declaredSectionIds(side).forEach(id => {
      const sel = context.sectionFill(id);
      assert.ok(sel === null || typeof sel === 'string', id);
    });
  });
  assert.equal(context.sectionFill('lp-states'), '.slist');
  assert.equal(context.sectionFill('rp-simulate'), '.trace-log');
  assert.equal(context.sectionFill('rp-language'), null,
    'a stack of boxes has nothing that should grow');
});

test('the elastic region is marked only while the section is a window', () => {
  mount();
  const el = context.$('lp-states');
  const list = context.$('states-list');
  list.classList.add('slist');
  el.querySelector = sel => (sel === '.slist' ? list : null);

  context.floatSection('lp-states', { x: 20, y: 20, w: 360, h: 300 });
  assert.ok(list.classList.contains('panel-float-fill'));
  context.dockSection('lp-states');
  assert.ok(!list.classList.contains('panel-float-fill'),
    'back in the panel the list is capped again, not stretched');
});

// ── the panel that closes under the drag ──────────────────────────

test('an auto-closed panel is not somewhere a window can be dropped', () => {
  // An unpinned panel is a hover rail: it collapses to zero width the moment
  // the pointer leaves it, which is exactly *during* the drag pulling a
  // section out of it. A zero-width panel used to answer "the pointer is
  // inside me", so the gesture docked the window straight back into a rail
  // that is `visibility: hidden` — the window vanished as the panel closed.
  const { outsideBy, panelIsOpen } = context._dropTests;
  const open = { left: 0, top: 0, right: 256, bottom: 800, width: 256, height: 800 };
  const shut = { left: 0, top: 0, right: 0, bottom: 800, width: 0, height: 800 };

  const at = rect => ({ getBoundingClientRect: () => rect });
  assert.equal(outsideBy(at(open), 120), 0, 'inside an open panel');
  assert.ok(outsideBy(at(open), 400) > 0, 'and outside it past its edge');
  assert.equal(outsideBy(at(shut), 120), Infinity,
    'a panel with no width is not somewhere to be inside of');

  const panel = context.$('lpanel');
  panel.getBoundingClientRect = () => shut;
  assert.equal(panelIsOpen('lpanel'), false);
  panel.getBoundingClientRect = () => open;
  assert.equal(panelIsOpen('lpanel'), true);
});

// ── what a gesture costs per frame ────────────────────────────────
//
// A drag is sixty of these a second, and two of the things a frame used to do
// are among the most expensive calls in the app. Neither is visible on a
// three-state machine, which is what makes them worth a test rather than a
// profile: the feature works perfectly and gets slower with the diagram.

/** Counts calls to one method for the length of a block, then puts it back. */
function counting(obj, name, body) {
  const real = obj[name];
  let calls = 0;
  obj[name] = function (...args) { calls += 1; return real.apply(this, args); };
  try { body(); } finally { obj[name] = real; }
  return calls;
}

test('the canvas well is measured once a gesture, not once a frame', () => {
  // `getBoundingClientRect` on #canvas-wrap forces a synchronous layout flush
  // against the whole diagram — the same 8.4ms measurement the guard over
  // renderExampleCard exists for. Read per frame it was the dominant cost of
  // moving a window over a large machine, and in the tear-off path it was read
  // twice a frame, once by panel-sections-ui.js and again inside moveFloatTo.
  const { header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const wrap = context.$('canvas-wrap');

  const reads = counting(wrap, 'getBoundingClientRect', () => {
    press(header, 100, 100);
    for (let i = 1; i <= 20; i++) drag(100 + i * 4, 100 + i * 4);
    dispatchDocumentEvent('pointerup', {});
  });
  assert.equal(reads, 1, 'twenty frames, one measurement');
});

test('a gesture re-measures the well it starts in', () => {
  // The other half of the cache: it is kept for a gesture, not for a session.
  // A panel pinned, a window resized, the toolbar collapsed — all change the
  // well, and a window clamped against a box that is no longer there would be
  // dragged to coordinates that do not exist.
  const { header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const wrap = context.$('canvas-wrap');

  const reads = counting(wrap, 'getBoundingClientRect', () => {
    for (let g = 0; g < 3; g++) {
      press(header, 100, 100);
      drag(140, 140);
      dispatchDocumentEvent('pointerup', {});
    }
  });
  assert.equal(reads, 3, 'once each, and once per gesture');
});

test('a drag reads no storage, however long it is', () => {
  // `liveGeom` used to ask `floatState` for the size on every frame — a
  // localStorage read, a JSON.parse and a walk of the side's sections, to
  // arrive at numbers that are already on the element. Storage is the memory
  // of where a window was left; the element is where it is.
  const { header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  const store = context.localStorage;

  const short = counting(store, 'getItem', () => {
    press(header, 100, 100);
    for (let i = 1; i <= 4; i++) drag(100 + i * 4, 100 + i * 4);
    dispatchDocumentEvent('pointerup', {});
  });
  const long = counting(store, 'getItem', () => {
    press(header, 100, 100);
    for (let i = 1; i <= 40; i++) drag(100 + i * 4, 100 + i * 4);
    dispatchDocumentEvent('pointerup', {});
  });
  assert.equal(short, long, 'ten times the frames, the same number of reads');
});

// ── one gesture, one pointer ──────────────────────────────────────

test('a second pointer does not drive a window it did not press', () => {
  // These listeners are on `document`, so every pointer on the page delivers
  // here: a second finger, a stylus alongside a mouse, a pointer belonging to
  // some other gesture entirely. Each would move this window from its own
  // coordinates, snapping it across the canvas mid-drag.
  const { el, header } = mountWindow('rp-batch', { x: 10, y: 10, w: 360, h: 280 });
  press(header, 100, 100);

  dispatchDocumentEvent('pointermove', { pointerId: 2, clientX: 900, clientY: 900 });
  assert.equal(el.style.left, '10px', 'the other pointer moved nothing');
  assert.equal(context.isMovingFloat(), false, 'and did not even start the drag');

  dispatchDocumentEvent('pointerup', { pointerId: 2 });
  dispatchDocumentEvent('pointermove', { pointerId: 1, clientX: 160, clientY: 140 });
  assert.equal(el.style.left, '70px',
    'and the pointer that pressed still owns the gesture the other one tried to end');
  dispatchDocumentEvent('pointerup', { pointerId: 1 });
});

// ── resizing against the edge of the well ─────────────────────────

/** A well with a real box, so the clamps have something to clamp against. */
function well(w, h) {
  const wrap = context.$('canvas-wrap');
  wrap.getBoundingClientRect = () => ({
    left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0
  });
  return wrap;
}

test('a north edge held at the top of the well keeps its bottom edge', () => {
  // The opposite edge is the fixed one all the way through a resize — that is
  // what `resizeGeom` already does at the minimum. Clamping `y` at the top of
  // the well and leaving `h` alone broke it at the other end: pushing the top
  // edge above the canvas stopped `y` and let the *bottom* slide down, so a
  // gesture that was shrinking the window grew it instead.
  mountWindow('rp-batch', { x: 200, y: 100, w: 400, h: 300 });
  well(1200, 800);

  const g = resizeBy('rp-batch', 'n', 0, -200);
  assert.equal(g.y, 0, 'held at the top of the well');
  assert.equal(g.h, 400, 'and the south edge is where it was');
  assert.equal(g.y + g.h, 400);
});

test('a record the well has outgrown is written back, not only repainted', () => {
  // applyFloatLayout clamps a stored box into the well it is restoring into.
  // Painting that and leaving the record alone puts the element and the memory
  // of it out of step, and the next read of the record — a restore into a
  // wider well, a gesture whose inline styles did not parse — puts the window
  // back where it could not be seen.
  mount();
  well(1200, 800);
  context.initPanelFloat();
  const min = context.sectionMinSize('rp-batch');
  context.floatSection('rp-batch', { x: 900, y: 600, w: min.w, h: min.h });
  assert.deepEqual(context.floatState('rp-batch'), { x: 900, y: 600, w: min.w, h: min.h });

  well(400, 300);
  context.applyFloatLayout();

  const g = context.floatState('rp-batch');
  assert.deepEqual(g, { x: 324, y: 262, w: min.w, h: min.h },
    'pulled back inside the smaller well');
  assert.equal(context.$('rp-batch').style.left, '324px',
    'and the element says the same thing the record does');
  well(0, 0);
});

// ── what the panel says it still has ──────────────────────────────

test('a grip counts the sections in the panel, and a window has left it', () => {
  // "Reorder Simulate, 2 of 3" is the only feedback a reader who cannot see
  // the panel gets after a keyboard move, and floating a section changes that
  // count without changing the order of what is left behind. Docking the
  // *last* window back is the case that showed it: the DOM already agreed with
  // the order, so applySectionOrder returned before relabelling and every grip
  // went on claiming a total one short.
  mount();
  const labels = {};
  RP.forEach(id => {
    context.$(id).__secGrip = {
      setAttribute(k, v) { if (k === 'aria-label') labels[id] = v; }
    };
  });

  context.applySectionOrder('rpanel');
  assert.match(labels['rp-language'], /1 of 3/);
  assert.match(labels['rp-batch'], /3 of 3/);

  context.floatSection('rp-batch', { x: 20, y: 20, w: 340, h: 260 });
  assert.match(labels['rp-language'], /1 of 2/, 'the panel has one fewer section in it');
  assert.match(labels['rp-simulate'], /2 of 2/);

  context.dockSection('rp-batch');
  assert.match(labels['rp-language'], /1 of 3/, 'and it is back');
  assert.match(labels['rp-batch'], /3 of 3/);
});

// ── the cascade, which no assertion about the DOM can reach ───────

import { readFileSync as readFloatCss } from 'node:fs';

const FLOAT_CSS = readFloatCss(new URL('../css/panels.css', import.meta.url), 'utf8');

/** Every `selector { … }` rule in a stylesheet, comments stripped. */
function floatCssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
}

test('the one region that stretches is also the one allowed to shrink', () => {
  // A source-level assertion because the failing state looks exactly like the
  // working one until the window is made smaller than its content.
  //
  // `.panel-float .panel-float-fill` and `.panel-float > .lp-section-body > *`
  // are both (0,2,0), so the blanket rule — which exists to stop the fields
  // and transport controls above the elastic region being squeezed — wins on
  // source order and left the fill `flex: 1 0 auto`. With its `max-height`
  // already lifted by the same rule that made it elastic, a States Q window
  // shorter than its list then refused to shrink the list at all: the *body*
  // scrolled instead, carrying the search box off the top of the window. That
  // is the exact failure the `min-height: 0` note over `.lp-section-body`
  // says must not happen.
  // The rules that pin a *child of a window's body* — not `.panel-float-btn`,
  // whose own `flex-shrink` is about the title bar squeezing its controls.
  const blanket = floatCssRules(FLOAT_CSS).filter(rule =>
    /flex-shrink\s*:\s*0/.test(rule.body) && /\.panel-float\b.*-section-body\s*>/.test(rule.selector));

  assert.ok(blanket.length, 'the rule pinning a window\'s inelastic children is still here');
  blanket.forEach(rule => assert.ok(rule.selector.includes(':not(.panel-float-fill)'),
    `${rule.selector} pins flex-shrink on every child of a window, the elastic one included`));
});
