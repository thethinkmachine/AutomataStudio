import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context, getElement } = harness;

const WRAP = { left: 0, top: 0, width: 1200, height: 800 };

// The toolbar box as measured when docked on a given side. Widths/heights
// approximate the real vertical and horizontal pills.
function toolbarBox(side) {
  return side === 'left' || side === 'right'
    ? { width: 92, height: 380 }
    : { width: 520, height: 56 };
}

function cornerFor(side, ratio) {
  return context.canvasOverlayCorner({ side, ratio }, WRAP, toolbarBox(side));
}

// ── Corner selection ──────────────────────────────────────────────

test('the overlay stack stays bottom-right when the toolbar is far away', () => {
  assert.deepStrictEqual(
    { ...cornerFor('left', 0.5) },
    { x: 'right', y: 'bottom' },
    'a left-docked toolbar never reaches the default corner'
  );
  assert.deepStrictEqual(
    { ...cornerFor('top', 0.5) },
    { x: 'right', y: 'bottom' },
    'a top-docked toolbar never reaches the default corner'
  );
});

test('a bottom-docked toolbar pushes the stack aside only when it reaches it', () => {
  assert.deepStrictEqual(
    { ...cornerFor('bottom', 0.1) },
    { x: 'right', y: 'bottom' },
    'docked far left along the bottom, the right corner is still free'
  );
  assert.deepStrictEqual(
    { ...cornerFor('bottom', 0.9) },
    { x: 'left', y: 'bottom' },
    'docked right along the bottom, the stack must move left'
  );
});

test('a right-docked toolbar pushes the stack aside only when it hangs low', () => {
  assert.deepStrictEqual(
    { ...cornerFor('right', 0) },
    { x: 'right', y: 'bottom' },
    'docked high on the right edge, the bottom corner stays clear'
  );
  assert.deepStrictEqual(
    { ...cornerFor('right', 1) },
    { x: 'left', y: 'bottom' },
    'docked low on the right edge, the stack must move left'
  );
});

test('compact mode sends the stack to the top, clear of the bottom toolbar', () => {
  const realMatchMedia = context.matchMedia;
  context.matchMedia = () => ({ matches: true });
  try {
    assert.deepStrictEqual(
      { ...context.canvasOverlayCorner({ side: 'bottom', ratio: 0.5 }, WRAP, toolbarBox('bottom')) },
      { x: 'right', y: 'top' },
      'compact mode pins the toolbar across the bottom'
    );
  } finally {
    context.matchMedia = realMatchMedia;
  }
});

// ── Stacking ──────────────────────────────────────────────────────

function seedOverlays({ minimapHidden = false } = {}) {
  harness.resetApp();
  const nav = getElement('canvas-nav-controls');
  const map = getElement('minimap-container');
  const showBtn = getElement('minimap-show-btn');
  const wrap = getElement('canvas-wrap');

  wrap.getBoundingClientRect = () => WRAP;
  nav.getBoundingClientRect = () => ({ width: 160, height: 36 });
  map.getBoundingClientRect = () => ({ width: 174, height: 122 });
  showBtn.getBoundingClientRect = () => ({ width: 62, height: 26 });

  if (minimapHidden) map.classList.add('minimap-hidden');
  else map.classList.remove('minimap-hidden');
  showBtn.offsetParent = minimapHidden ? {} : null;

  return { nav, map, showBtn };
}

test('members stack upward from the corner without overlapping', () => {
  const { nav, map } = seedOverlays();
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(nav.style.right, '12px');
  assert.strictEqual(nav.style.bottom, '12px', 'zoom controls sit outermost');
  assert.strictEqual(nav.style.left, 'auto');

  // nav height 36 + gap 8 + margin 12 = 56
  assert.strictEqual(map.style.bottom, '56px', 'the minimap rests above the zoom controls');
  assert.strictEqual(map.style.right, '12px', 'both share the same edge');
});

test('the stack flips to the left edge and keeps its spacing', () => {
  const { nav, map } = seedOverlays();
  context.App.toolbarDock = { side: 'bottom', ratio: 0.95 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('bottom'));

  assert.strictEqual(nav.style.left, '12px');
  assert.strictEqual(nav.style.right, 'auto', 'the old right offset must be cleared, not just overridden');
  assert.strictEqual(map.style.left, '12px');
  assert.strictEqual(map.style.bottom, '56px', 'spacing is unchanged by the flip');
});

// A collapsed minimap is replaced by a much shorter button, so anything
// stacked with it has to re-measure rather than keep the map's height.
test('the collapsed stand-in takes the minimap slot', () => {
  const { nav, map, showBtn } = seedOverlays({ minimapHidden: true });
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(showBtn.style.bottom, '56px', 'the show button takes the map position');
  assert.strictEqual(nav.style.bottom, '12px');
  assert.ok(!map.style.bottom || map.style.bottom !== '56px', 'the hidden map is not placed');
});

test('overlays hidden entirely are skipped', () => {
  const { nav, map, showBtn } = seedOverlays();
  map.offsetParent = null;   // e.g. the <=640px rule that hides the minimap
  showBtn.offsetParent = null;
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(nav.style.bottom, '12px', 'the remaining member still anchors to the corner');
});

// ── Language claim overflow ───────────────────────────────────────
// The claim is a single line now, so a long regex is clipped rather than
// wrapped; the fade is the only cue that it continues.

test('the fade appears only while there is more expression to the right', () => {
  harness.resetApp();
  const box = getElement('regex-box');
  const wrap = getElement('lang-claim-wrap');
  box.parentElement = wrap;

  box.scrollWidth = 1400; box.clientWidth = 240; box.scrollLeft = 0;
  context.updateLangClaimOverflow();
  assert.strictEqual(wrap.classList.contains('has-more'), true, 'a clipped regex is marked');

  // Scrolled to the far end: nothing further right to hint at.
  box.scrollLeft = 1400 - 240;
  context.updateLangClaimOverflow();
  assert.strictEqual(wrap.classList.contains('has-more'), false, 'the fade clears at the end');

  box.scrollWidth = 200; box.clientWidth = 240; box.scrollLeft = 0;
  context.updateLangClaimOverflow();
  assert.strictEqual(wrap.classList.contains('has-more'), false, 'a short regex needs no fade');
});

test('the copy button reports the length of a regex too long to show', () => {
  harness.resetApp();
  const btn = getElement('regex-copy-btn');
  const box = getElement('regex-box');
  box.parentElement = getElement('lang-claim-wrap');

  context.App._regexIsDerived = true;
  context.App._regexBoxPlain = 'a'.repeat(1827);
  context.renderLanguagePanel();
  assert.match(btn.dataset.tip, /1,827 chars/, 'the count moved onto the copy affordance');

  context.App._regexBoxPlain = 'ab*';
  context.renderLanguagePanel();
  assert.strictEqual(btn.dataset.tip, 'Copy regular expression', 'a short regex needs no count');

  // An asserted class label is a constant phrase, not a derivation.
  context.App._regexIsDerived = false;
  context.App._regexBoxPlain = 'Context-Free Language';
  context.renderLanguagePanel();
  assert.strictEqual(btn.dataset.tip, 'Copy regular expression');
});
