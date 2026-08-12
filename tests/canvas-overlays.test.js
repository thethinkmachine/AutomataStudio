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
  const wrap = getElement('canvas-wrap');

  wrap.getBoundingClientRect = () => WRAP;
  nav.getBoundingClientRect = () => ({ width: 160, height: 36 });
  map.getBoundingClientRect = () => ({ width: 174, height: 122 });

  if (minimapHidden) map.classList.add('minimap-hidden');
  else map.classList.remove('minimap-hidden');

  return { nav, map };
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

// Hiding the minimap leaves nothing in its slot — the toggle that brings it
// back lives in the nav bar — so the nav controls are the whole stack.
test('a hidden minimap leaves nothing parked above the nav controls', () => {
  const { nav, map } = seedOverlays({ minimapHidden: true });
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(nav.style.bottom, '12px', 'the nav controls stay on the corner');
  assert.ok(!map.style.bottom || map.style.bottom !== '56px', 'the hidden map is not placed');
});

test('overlays hidden entirely are skipped', () => {
  const { nav, map } = seedOverlays();
  map.offsetParent = null;   // e.g. the <=640px rule that hides the minimap
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

// ── minimap toggle ────────────────────────────────────────────────

// The toggle moved into the nav bar, replacing a floating stand-in button that
// took the minimap's slot when it was collapsed. The button is now the only
// thing carrying the state, so it has to stay in step with the map.
test('the nav-bar toggle tracks whether the minimap is showing', () => {
  harness.resetApp();
  const map = getElement('minimap-container');
  const btn = getElement('minimap-toggle-btn');
  map.classList.remove('minimap-hidden');
  btn.classList.add('active');

  context.toggleMinimap();
  assert.ok(map.classList.contains('minimap-hidden'), 'the map hides');
  assert.equal(btn.classList.contains('active'), false, 'the toggle releases with it');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.match(btn.getAttribute('data-tip'), /Show/, 'the tip offers the way back');

  context.toggleMinimap();
  assert.equal(map.classList.contains('minimap-hidden'), false);
  assert.equal(btn.classList.contains('active'), true);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.match(btn.getAttribute('data-tip'), /Hide/);
});

// ── crowding on a narrow canvas ───────────────────────────────────

// A horizontal toolbar and the overlay stack both want the bottom edge. The
// choice used to come from `ratio` alone, which silently assumed there was an
// opposite end to retreat to — true on a wide canvas, false once the toolbar
// spans most of the width. Then both bars sat on the bottom edge fighting for
// the same pixels.
const NARROW = { left: 0, top: 0, width: 700, height: 800 };

test('a bottom toolbar that fits leaves the stack on the bottom edge', () => {
  assert.strictEqual(
    context.bottomEdgeHasRoomBeside(WRAP, toolbarBox('bottom')), true,
    '1200px wrap easily fits a 520px toolbar beside the stack'
  );
  assert.deepStrictEqual(
    { ...context.canvasOverlayCorner({ side: 'bottom', ratio: 0.1 }, WRAP, toolbarBox('bottom')) },
    { x: 'right', y: 'bottom' }
  );
});

test('a bottom toolbar with no room beside it sends the stack over the top', () => {
  assert.strictEqual(
    context.bottomEdgeHasRoomBeside(NARROW, toolbarBox('bottom')), false,
    '520 + 250 + margins does not fit in 700'
  );

  // Both halves, because the old code answered from ratio and would still
  // return a bottom corner for either.
  for (const ratio of [0.1, 0.95]) {
    assert.deepStrictEqual(
      { ...context.canvasOverlayCorner({ side: 'bottom', ratio }, NARROW, toolbarBox('bottom')) },
      { x: 'right', y: 'top' },
      `ratio ${ratio} must clear the toolbar rather than share the edge`
    );
  }
});

test('the crowding check scales with the stack it is asked about', () => {
  // A wider stack needs more room, so the same canvas can fit one and not the other.
  assert.strictEqual(context.bottomEdgeHasRoomBeside(WRAP, toolbarBox('bottom'), 200), true);
  assert.strictEqual(context.bottomEdgeHasRoomBeside(WRAP, toolbarBox('bottom'), 900), false);
});

test('an unmeasured toolbar is treated as leaving room rather than crowding', () => {
  // layoutCanvasOverlays is called before the toolbar has a box on first paint;
  // guessing "crowded" there would park the stack at the top and then move it.
  assert.strictEqual(context.bottomEdgeHasRoomBeside(WRAP, null), true);
  assert.strictEqual(context.bottomEdgeHasRoomBeside(WRAP, { width: 0, height: 0 }), true);
});

// The JS mode check and the stylesheet rule that actually relocates the toolbar
// have to name the same width. They drifted once — CSS at 900, JS at 820 —
// leaving an 80px band where the toolbar had moved to the bottom edge but the
// overlay stack had not been told, so the two bars overlapped.
test('the compact breakpoint matches the stylesheet that moves the toolbar', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/canvas.css', import.meta.url), 'utf8');

  const width = context.COMPACT_TOOLBAR_QUERY.match(/(\d+)px/)[1];
  const block = new RegExp(`@media \\(max-width: ${width}px\\)[^{]*\\{[\\s\\S]*?\\.canvas-toolbox\\s*\\{`);
  assert.ok(block.test(css),
    `css/canvas.css has no max-width: ${width}px rule for .canvas-toolbox — the JS and CSS breakpoints have drifted`);
});

test('the default dock follows the same breakpoint as compact mode', () => {
  const realMatchMedia = context.matchMedia;
  try {
    context.matchMedia = () => ({ matches: true });
    assert.strictEqual(context.getDefaultToolbarDock().side, 'bottom',
      'a narrow window defaults the toolbar to the bottom');

    context.matchMedia = () => ({ matches: false });
    assert.strictEqual(context.getDefaultToolbarDock().side, 'left');
  } finally {
    context.matchMedia = realMatchMedia;
  }
});

// ── stability across unrelated clicks ─────────────────────────────

// The corner has to come from the DOM, not from whoever called. applyToolbarDock
// passes the box it just computed; toggleMinimap and the quick-settings
// reposition pass nothing — and an absent box used to change the answer, so
// closing the minimap moved the nav bar to a different corner.
test('closing the minimap does not move the nav controls', () => {
  harness.resetApp();
  const nav = getElement('canvas-nav-controls');
  const map = getElement('minimap-container');
  const wrap = getElement('canvas-wrap');
  const toolbox = getElement('canvas-toolbox');

  // A right-docked toolbar: the branch whose answer depends on the toolbar box.
  wrap.getBoundingClientRect = () => WRAP;
  nav.getBoundingClientRect = () => ({ width: 250, height: 36 });
  map.getBoundingClientRect = () => ({ width: 174, height: 122 });
  toolbox.getBoundingClientRect = () => toolbarBox('right');
  toolbox.offsetParent = {};
  map.classList.remove('minimap-hidden');
  // ratio 0.3 is inside the band where the toolbar's own height decides the
  // answer, so omitting the box genuinely flips the corner. A ratio outside it
  // would agree either way and the test would pass without testing anything.
  context.App.toolbarDock = { side: 'right', ratio: 0.3 };

  // As applyToolbarDock calls it — with a measured box.
  context.layoutCanvasOverlays(WRAP, toolbarBox('right'));
  const seated = { left: nav.style.left, right: nav.style.right, bottom: nav.style.bottom };

  // As toggleMinimap calls it — with nothing.
  context.layoutCanvasOverlays();

  assert.deepStrictEqual(
    { left: nav.style.left, right: nav.style.right, bottom: nav.style.bottom },
    seated,
    'the nav bar must stay put when a caller omits the toolbar box'
  );
});

test('a toolbar that is not on screen measures as absent, not as zero-width', () => {
  const toolbox = getElement('canvas-toolbox');
  const realParent = toolbox.offsetParent;
  try {
    toolbox.offsetParent = null;
    assert.strictEqual(context.measuredToolbarBox(toolbox), null);

    toolbox.offsetParent = {};
    toolbox.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.strictEqual(context.measuredToolbarBox(toolbox), null,
      'a zero rect is a hidden node, not a toolbar of no width');
  } finally {
    toolbox.offsetParent = realParent;
  }
});
