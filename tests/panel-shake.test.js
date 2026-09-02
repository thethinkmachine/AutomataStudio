import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, dispatchDocumentEvent } from './harness.js';

// Shaking a floating window to put the sidebars away.
//
// Three things are being pinned, and they split along the seam the code does.
// That the *detector* separates a shake from a hand placing a window — which
// is the whole risk in a motion gesture, and the reason the legs and the time
// window are both measured rather than either alone. That the *action* is
// reversible and gives back the arrangement the reader had rather than the
// app's default. And that the two are actually wired to the window's title
// bar, driven through the real document listeners.

const harness = createHarness();
const { context } = harness;

const SIDES = ['lpanel', 'rpanel'];

function desktop(on = true) {
  context.matchMedia = () => ({
    matches: on, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
}

/** The panels and the canvas well, the way index.html has them. */
function mount() {
  harness.resetApp();
  desktop();
  context.resetPanelFloat();
  context.resetPanelShake();
  try { context.localStorage.removeItem('automata-shake-minimize'); } catch (e) { /* ignore */ }
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
    // Pinned is the absence of `unpinned`, which is how the markup ships.
    context.$(side).classList.remove('unpinned');
  });
  context.$('canvas-wrap').innerHTML = '';
}

function pinnedSides() {
  return SIDES.filter(side => context.isPanelPinned(side));
}

// ── the primitive the gesture needs ───────────────────────────────

test('pinning is stated, not toggled, and says whether it did anything', () => {
  // The shake asks for a state — both panels away, then exactly the ones it
  // put away back — and a caller that had to read the class and decide whether
  // to call would be the same test written once per caller, wrong the first
  // time one of them forgot it.
  mount();
  assert.equal(context.isPanelPinned('lpanel'), true);
  assert.equal(context.setPanelPinned('lpanel', true), false, 'already pinned');
  assert.equal(context.setPanelPinned('lpanel', false), true);
  assert.equal(context.isPanelPinned('lpanel'), false);
  assert.equal(context.setPanelPinned('lpanel', false), false, 'already unpinned');

  context.togglePanelPin('lpanel');
  assert.equal(context.isPanelPinned('lpanel'), true, 'and the toggle still toggles');
  assert.equal(context.localStorage.getItem('automata-lpanel-pinned'), '1');
});

// ── the action ────────────────────────────────────────────────────

test('a shake puts the sidebars away, and another brings them back', () => {
  mount();
  assert.deepEqual(pinnedSides(), SIDES);

  assert.equal(context.shakeMinimizePanels(), 'minimized');
  assert.deepEqual(pinnedSides(), [], 'both collapsed to hover rails');

  assert.equal(context.shakeMinimizePanels(), 'restored');
  assert.deepEqual(pinnedSides(), SIDES);
});

test('what comes back is what was there, not what the app ships with', () => {
  // The reader had already unpinned the left panel. Restoring "both" would be
  // the gesture undoing a decision it never made — and the second shake is
  // supposed to be an undo of the first, not a reset.
  mount();
  context.setPanelPinned('lpanel', false);
  assert.deepEqual(pinnedSides(), ['rpanel']);

  context.shakeMinimizePanels();
  assert.deepEqual(pinnedSides(), []);
  context.shakeMinimizePanels();
  assert.deepEqual(pinnedSides(), ['rpanel'], 'the left panel is still the reader\'s to pin');
});

test('which way a shake goes is read off the page, not off a flag', () => {
  // The reader shook the panels away and then pinned one back by hand. There
  // is something on screen again, so the next shake puts it away — the gesture
  // is "hide what is showing", not "undo my last shake", and asking the page
  // is what stops the two descriptions drifting apart. What it remembers is
  // the arrangement it found, so the trip back is that one and not the app's.
  mount();
  context.shakeMinimizePanels();
  context.setPanelPinned('rpanel', true);

  assert.equal(context.shakeMinimizePanels(), 'minimized');
  assert.deepEqual(pinnedSides(), []);

  assert.equal(context.shakeMinimizePanels(), 'restored');
  assert.deepEqual(pinnedSides(), ['rpanel'], 'exactly what was there a moment ago');
});

test('a side already back is left alone rather than toggled off', () => {
  // The restore states what it wants rather than toggling, so a panel the
  // reader pinned by hand while the rest were away survives the trip back.
  mount();
  context.shakeMinimizePanels();
  context.setPanelPinned('lpanel', true);
  SIDES.forEach(side => context.setPanelPinned(side, side === 'lpanel'));

  context.shakeMinimizePanels();
  assert.deepEqual(pinnedSides(), [], 'something was showing, so it went away');
  context.shakeMinimizePanels();
  assert.deepEqual(pinnedSides(), ['lpanel']);
});

test('with nothing remembered and nothing pinned, a shake gives both back', () => {
  // The gesture has to be total. A shake that did nothing and said nothing
  // reads as a shake that was not detected, which is the one failure a motion
  // gesture cannot afford — the reader has no way to tell the two apart.
  mount();
  SIDES.forEach(side => context.setPanelPinned(side, false));
  context.resetPanelShake();

  assert.equal(context.shakeMinimizePanels(), 'restored');
  assert.deepEqual(pinnedSides(), SIDES);
});

// ── telling a shake from a hand ───────────────────────────────────
//
// The detector takes `now`, so these drive it directly rather than through
// wall-clock timing. A test that had to actually wait 700ms to prove a slow
// wobble is not a shake would be a slow test asserting a race.

/** Arms a gesture and feeds it samples, reporting what fired. */
function feed(samples) {
  context.beginShakeTrack();
  const fired = [];
  samples.forEach(([x, y, t]) => {
    const out = context.noteShakeSample(x, y, t);
    if (out) fired.push(out);
  });
  return fired;
}

/** `n` reversals of `leg` px on the x axis, `gap` ms apart, from `t0`. */
function swings(n, leg, gap, t0 = 1000, from = 400) {
  const out = [[from, 300, t0], [from + leg, 300, t0 + gap]];
  for (let i = 1; i <= n; i++) {
    out.push([i % 2 ? from : from + leg, 300, t0 + gap * (i + 1)]);
  }
  return out;
}

test('four swings inside the window are a shake', () => {
  mount();
  assert.deepEqual(feed(swings(4, 60, 80)), ['minimized']);
  assert.deepEqual(pinnedSides(), []);
});

test('three are not', () => {
  mount();
  assert.deepEqual(feed(swings(3, 60, 80)), []);
  assert.deepEqual(pinnedSides(), SIDES, 'and nothing moved');
});

test('a hand placing a window is not a shake, however many times it corrects', () => {
  // Short legs. Nudging a window into place reverses often and travels barely
  // at all, which is exactly the signal a naive reversal count cannot tell
  // from a shake — so the leg has to clear SHAKE_LEG_MIN to be counted.
  mount();
  assert.deepEqual(feed(swings(12, 12, 40)), []);
  assert.deepEqual(pinnedSides(), SIDES);
});

test('a slow wobble is not a shake either, however far it travels', () => {
  // Long legs, but spread over four seconds. Both halves of the measurement
  // are needed: distance alone calls a careful two-handed reposition a shake,
  // and rate alone calls a tremor one.
  mount();
  assert.deepEqual(feed(swings(6, 120, 500)), []);
  assert.deepEqual(pinnedSides(), SIDES);
});

test('a shake on the other axis is still a shake', () => {
  mount();
  const up = [[400, 300, 1000], [400, 360, 1080]];
  for (let i = 1; i <= 4; i++) up.push([400, i % 2 ? 300 : 360, 1080 + i * 80]);
  assert.deepEqual(feed(up), ['minimized']);
});

test('a hand that keeps shaking does not fire twice', () => {
  // Otherwise one continued gesture minimizes and restores and minimizes
  // again, and where it stops depends on when the reader let go.
  mount();
  const long = swings(12, 60, 40);
  assert.deepEqual(feed(long), ['minimized'], 'twelve swings, one shake');
  assert.deepEqual(pinnedSides(), []);
});

test('past the cooldown the same gesture may shake again', () => {
  mount();
  const first = swings(4, 60, 80, 1000);
  const second = swings(4, 60, 80, 5000);
  context.beginShakeTrack();
  first.forEach(([x, y, t]) => context.noteShakeSample(x, y, t));
  assert.deepEqual(pinnedSides(), []);
  second.forEach(([x, y, t]) => context.noteShakeSample(x, y, t));
  assert.deepEqual(pinnedSides(), SIDES, 'and it is the way back, not a second minimize');
});

test('swings split across two gestures do not add up', () => {
  // Two swings while placing one window and two more while placing the next
  // are not a shake, and a counter that lived past the drag would call them
  // one.
  mount();
  assert.deepEqual(feed(swings(2, 60, 80, 1000)), []);
  assert.deepEqual(feed(swings(2, 60, 80, 1200)), []);
  assert.deepEqual(pinnedSides(), SIDES);
});

test('an axis the detector skipped is left holding a stale position', () => {
  // Both axes are stepped on every sample. Short-circuiting on the first one
  // to swing leaves the other holding a position and a turning point the
  // pointer left several frames ago — so when it does reverse, the leg it
  // measures is against a coordinate that is no longer true.
  //
  // Here x swings three times while y climbs steadily, and the fourth
  // reversal — the one that fires — is y's. Stepped every sample, y has
  // climbed 60px since its last turn and the reversal counts. Skipped on the
  // three samples x won, y still believes it is where it was at the start,
  // reads the climb as *continuing* rather than reversing, and the shake is
  // silently three hits short.
  mount();
  const samples = [
    [400, 300], [460, 315], [400, 330], [460, 345], [400, 360], [340, 345]
  ].map(([x, y], i) => [x, y, 1000 + i * 80]);

  assert.deepEqual(feed(samples), ['minimized'],
    'the fourth reversal is on the axis the other one kept winning');
  assert.deepEqual(pinnedSides(), []);
});

// ── the preference ────────────────────────────────────────────────

test('the gesture is on unless the reader turned it off', () => {
  // Absent means on, the rule the four render flags follow: a profile written
  // before the gesture existed must not read as "the reader turned it off".
  mount();
  assert.equal(context.shakeToMinimizeEnabled(), true);

  context.setShakeToMinimizeEnabled(false);
  assert.equal(context.shakeToMinimizeEnabled(), false);
  assert.deepEqual(feed(swings(8, 60, 40)), [], 'and no shake is detected');
  assert.deepEqual(pinnedSides(), SIDES);

  context.setShakeToMinimizeEnabled(true);
  assert.equal(context.localStorage.getItem('automata-shake-minimize'), null,
    'on is stored as the absence of a preference');
  assert.deepEqual(feed(swings(4, 60, 80)), ['minimized']);
});

test('whether the gesture is armed is decided at the press', () => {
  // `shakeToMinimizeEnabled` is a localStorage read and a sample is a frame of
  // a drag. It also reads better: a reader cannot turn the gesture off halfway
  // through performing it.
  mount();
  context.beginShakeTrack();
  assert.equal(context.isShakeTracking(), true);
  context.setShakeToMinimizeEnabled(false);
  assert.equal(context.isShakeTracking(), true, 'the gesture in flight is unaffected');

  context.beginShakeTrack();
  assert.equal(context.isShakeTracking(), false, 'and the next one is not armed');
  context.setShakeToMinimizeEnabled(true);
});

test('the preference is the reader\'s and reaches no serializer', () => {
  // App.config is deep-copied into every workspace tab and written into the
  // `.json`, so a gesture preference kept there would travel to the next
  // reader of a file and re-answer a question they had answered themselves.
  mount();
  context.setShakeToMinimizeEnabled(false);
  ['exportWorkspaceState', 'getWorkspaceData', 'getEditorSettingsData'].forEach(fn => {
    const json = JSON.stringify(context[fn]());
    assert.ok(!json.includes('shake'), `${fn} carries the shake preference`);
  });
  context.setShakeToMinimizeEnabled(true);
});

// ── wired to the window ───────────────────────────────────────────
//
// Driven through the real document listeners, because a detector nothing calls
// is a detector that passes every test above and does nothing on the page.

/** A floating window with the header index.html gives it. */
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
  header.closest = sel => {
    if (sel === '.panel-float') return el.classList.contains('panel-float') ? el : null;
    if (sel === '.' + cfg.headerClass) return header;
    return null;
  };
  context.floatSection(id, geom);
  Object.values(el.__floatGrabs).forEach(g => {
    g.closest = sel => (sel === '.panel-float' ? el
      : sel === '.panel-float-resize' ? g : null);
  });
  return { el, header, grab: el.__floatGrabs.se };
}

function press(target, x, y) {
  dispatchDocumentEvent('pointerdown', { target, button: 0, pointerId: 1, clientX: x, clientY: y });
}

function drag(x, y) {
  dispatchDocumentEvent('pointermove', { pointerId: 1, clientX: x, clientY: y });
}

test('shaking a window by its title bar hides the panels', () => {
  const { header } = mountWindow('rp-batch', { x: 40, y: 40, w: 360, h: 280 });
  assert.deepEqual(pinnedSides(), SIDES);

  // Six samples: the first sets the origin, the second sets a direction, and
  // the four after it are the reversals.
  press(header, 400, 300);
  [460, 400, 460, 400, 460, 400].forEach(x => drag(x, 300));
  assert.deepEqual(pinnedSides(), [], 'both put away, mid-drag');

  dispatchDocumentEvent('pointerup', { pointerId: 1 });
});

test('a press on the title bar arms the detector, and the release disarms it', () => {
  const { header } = mountWindow('rp-batch', { x: 40, y: 40, w: 360, h: 280 });
  press(header, 400, 300);
  assert.equal(context.isShakeTracking(), true);
  dispatchDocumentEvent('pointerup', { pointerId: 1 });
  assert.equal(context.isShakeTracking(), false);
});

test('a resize is not shakeable', () => {
  // Aero Shake is a window being moved. A resize is a hand already travelling
  // back and forth across one edge, which is the one gesture most likely to
  // look like a shake and least likely to be one.
  const { grab } = mountWindow('rp-batch', { x: 40, y: 40, w: 360, h: 280 });
  press(grab, 400, 300);
  assert.equal(context.isShakeTracking(), false);
  [460, 400, 460, 400, 460, 400].forEach(x => drag(x, 300));
  assert.deepEqual(pinnedSides(), SIDES);
  dispatchDocumentEvent('pointerup', { pointerId: 1 });
});

test('the window stays under the pointer across the layout the shake causes', () => {
  // An unpinned panel is absolutely positioned over the canvas rather than
  // beside it, so the well grows and its left edge travels — and a window's
  // coordinates are local to that well. Left alone, the window jumps sideways
  // by the width of the panel that just got out of the way, at the exact
  // moment the reader is holding it.
  const { el, header } = mountWindow('rp-batch', { x: 200, y: 100, w: 360, h: 280 });
  const wrap = context.$('canvas-wrap');

  // The well is 260px in from the left while the sidebar is pinned and reaches
  // the edge once it is not — which is the relationship the bug is about, so
  // it is modelled rather than staged: the shake moves the well by unpinning,
  // and nothing in the test has to know when.
  const rect = () => {
    const left = context.isPanelPinned('lpanel') ? 260 : 0;
    return { left, top: 0, right: 1400, bottom: 800, width: 1400 - left, height: 800, x: left, y: 0 };
  };
  wrap.getBoundingClientRect = rect;

  const screenX = () => parseFloat(el.style.left) + rect().left;

  press(header, 700, 300);
  drag(700, 300);
  const anchored = screenX();

  // Six samples again, and the fourth reversal — the one that fires — leaves
  // the pointer back at exactly 700, where it was on the line above.
  [760, 700, 760, 700, 760, 700].forEach(x => drag(x, 300));
  assert.deepEqual(pinnedSides(), [], 'the shake landed');

  assert.equal(screenX(), anchored,
    'the same pointer position puts the window in the same place on screen, '
    + 'so the local coordinate absorbed the well moving and nothing jumped');

  drag(800, 300);
  assert.equal(screenX(), anchored + 100, 'and the drag carries on from there');
  dispatchDocumentEvent('pointerup', { pointerId: 1 });
});

test('the re-clamp the shake causes does not take the window off the pointer', () => {
  // Unpinning the sidebars resizes the well, which delivers a ResizeObserver
  // tick on the very next frame of the drag that caused it — and that pass
  // re-applies each window's *record*. A record is where a window was left,
  // and a drag has not committed one yet, so the window would snap back to
  // where the gesture started with the reader still holding it.
  const { el, header } = mountWindow('rp-batch', { x: 200, y: 100, w: 360, h: 280 });
  const wrap = context.$('canvas-wrap');
  const box = (w, h) => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 });

  wrap.getBoundingClientRect = () => box(1400, 800);
  press(header, 700, 300);
  drag(900, 300);
  assert.equal(el.style.left, '400px', 'the drag has moved it 200px');
  assert.equal(context.floatState('rp-batch').x, 200, 'and committed nothing');

  // A well small enough that the *record* no longer fits it, so the pass has
  // something it would want to move. Without the guard it moves the element
  // the reader is holding, to a coordinate that is two hundred pixels stale.
  wrap.getBoundingClientRect = () => box(240, 300);
  context.invalidateFloatRect();
  context._floatTests.reclampAll();
  assert.equal(el.style.left, '400px', 'the gesture is still the authority on it');

  dispatchDocumentEvent('pointerup', { pointerId: 1 });
  assert.equal(context.floatState('rp-batch').x, 164,
    'and the release is the write — clamped into the well it landed in');
});
