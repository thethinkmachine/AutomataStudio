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

// ── Placement ─────────────────────────────────────────────────────
// The stack has one home, the bottom-right, and steps aside along the edge a
// toolbar shares with it rather than crossing the canvas. It used to pick among
// four corners, so dragging the toolbar past the middle of an edge sent the zoom
// controls to the other side of the screen.

const M = 12;
const at = (right, bottom) => ({ x: 'right', y: 'bottom', right, bottom });

test('the stack stays home when the toolbar is on another edge', () => {
  assert.deepStrictEqual({ ...cornerFor('left', 0.5) }, at(M, M));
  assert.deepStrictEqual({ ...cornerFor('top', 0.5) }, at(M, M));
  assert.deepStrictEqual({ ...cornerFor('left', 1) }, at(M, M), 'even hard against the corner edge');
});

test('a bottom toolbar lifts the stack only when it reaches it', () => {
  assert.deepStrictEqual({ ...cornerFor('bottom', 0.1) }, at(M, M), 'docked far left, the corner is free');
  const lift = M + toolbarBox('bottom').height + context.OVERLAY_GAP;
  assert.deepStrictEqual({ ...cornerFor('bottom', 0.9) }, at(M, lift), 'docked right, the stack stands on it');
});

test('a right toolbar moves the stack in beside it only when it hangs low', () => {
  assert.deepStrictEqual({ ...cornerFor('right', 0) }, at(M, M), 'docked high, the corner is free');
  const shift = M + toolbarBox('right').width + context.OVERLAY_GAP;
  assert.deepStrictEqual({ ...cornerFor('right', 1) }, at(shift, M), 'docked low, the stack moves in beside it');
});

// The widths added up, so the old check said "room beside" — but a centred
// toolbar leaves that room split across both ends, and the stack landed on
// top of undo/redo. Measured in the app at 1440×900 with both panels open.
test('a centred bottom toolbar is checked where it sits, not by its width alone', () => {
  const wrap = { left: 0, top: 0, width: 896, height: 838 };
  const box = { width: 488, height: 66 };
  const place = context.canvasOverlayCorner({ side: 'bottom', ratio: 0.5 }, wrap, box, { width: 292, height: 38 });
  assert.strictEqual(place.bottom, M + 66 + context.OVERLAY_GAP);
  assert.strictEqual(place.right, M);
});

test('an unmeasured toolbar leaves the stack at home', () => {
  // layoutCanvasOverlays is called before the toolbar has a box on first paint.
  assert.deepStrictEqual({ ...context.canvasOverlayCorner({ side: 'bottom', ratio: 0.9 }, WRAP, null) }, at(M, M));
});

// Compact mode has no toolbar over the canvas at all any more — the tools are
// cells in the mobile bar — so the bottom corner is free and the stack takes
// it. The top is what is spoken for there: the status toast is a centred pill
// and the info pill sits beside it, and three overlays sharing `top: 12px` is
// what this used to produce.
test('compact mode keeps the stack in the bottom corner, above the mobile bar', () => {
  const realMatchMedia = context.matchMedia;
  context.matchMedia = () => ({ matches: true });
  try {
    assert.deepStrictEqual(
      { ...context.canvasOverlayCorner({ side: 'bottom', ratio: 0.5 }, WRAP, toolbarBox('bottom')) },
      { x: 'right', y: 'bottom', right: 12, bottom: 12 },
      'the toolbar is not on the canvas in compact mode, so nothing displaces the stack'
    );
  } finally {
    context.matchMedia = realMatchMedia;
  }
});

// The bar is a fixed element over the viewport and the overlays are absolute
// inside the canvas well, so the clearance is measured rather than read off a
// token — `env(safe-area-inset-bottom)` is inside the bar's own height and
// there is no way to ask CSS for it from here.
test('the stack clears the mobile bar rather than the canvas edge', () => {
  const realMatchMedia = context.matchMedia;
  const { nav } = seedOverlays({ minimapHidden: true });
  const bar = getElement('mobile-bar');
  // 64px of bar reaching up into an 800px-tall well.
  bar.offsetParent = getElement('app-body');
  bar.getBoundingClientRect = () => ({ left: 0, top: 736, right: 1200, bottom: 800, width: 1200, height: 64 });
  context.matchMedia = () => ({ matches: true });
  try {
    context.App.toolbarDock = { side: 'bottom', ratio: 0.5 };
    context.layoutCanvasOverlays({ ...WRAP, bottom: 800 });
    assert.strictEqual(nav.style.bottom, '76px', '12px margin above a 64px bar');
  } finally {
    context.matchMedia = realMatchMedia;
    bar.offsetParent = null;
  }
});

// A bar that is not on screen — an auxiliary view is open, or this is a
// desktop — is no clearance at all. It is asked by *rect* and never by
// `offsetParent`, which is how the rest of this file tests visibility: the bar
// is `position: fixed`, which has no offsetParent at all, so read that way it
// always answered "hidden", the inset was always zero, and the Fit button sat
// underneath the bar it was supposed to clear.
test('a hidden mobile bar reserves nothing', () => {
  const realMatchMedia = context.matchMedia;
  const { nav } = seedOverlays({ minimapHidden: true });
  const bar = getElement('mobile-bar');
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  context.matchMedia = () => ({ matches: true });
  try {
    context.App.toolbarDock = { side: 'bottom', ratio: 0.5 };
    context.layoutCanvasOverlays({ ...WRAP, bottom: 800 });
    assert.strictEqual(nav.style.bottom, '12px');
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
  // The status toast is an obstacle for the info pill. It is `position:
  // absolute` and laid out whether or not a message is showing, so it is
  // stubbed here rather than per test: a corner that only became unavailable
  // once a message arrived would move the pill under the reader's finger.
  const status = getElement('status-bar');
  status.getBoundingClientRect = () => ({ left: 500, top: 10, right: 700, bottom: 34, width: 200, height: 24 });
  // The bar is off unless a test turns it on; the stub's default 800x600 rect
  // would otherwise reserve most of the well.
  getElement('mobile-bar').getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

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

test('a right toolbar moves the whole stack in, and keeps its spacing', () => {
  const { nav, map } = seedOverlays();
  context.App.toolbarDock = { side: 'right', ratio: 1 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('right'));

  const shift = `${M + toolbarBox('right').width + context.OVERLAY_GAP}px`;
  assert.strictEqual(nav.style.right, shift);
  assert.strictEqual(nav.style.left, 'auto', 'it never changes sides');
  assert.strictEqual(map.style.right, shift, 'the minimap moves with it');
  assert.strictEqual(map.style.bottom, '56px', 'spacing is unchanged by the shift');
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

// ── The info pill ─────────────────────────────────────────────────
//  The pill and its card live in the top-left. A toolbar docked across that
//  corner pushes them along the edge — beside a left column, below a top row —
//  and never to another corner: the pill used to search all four, scored
//  partly by where the drawing was, and turned up somewhere new at each window
//  size.

function seedInfo({ open = false, card = { width: 310, height: 140 } } = {}) {
  const { nav, map } = seedOverlays();
  const btn = getElement('canvas-info-btn');
  const cardEl = getElement('example-card');
  btn.getBoundingClientRect = () => ({ width: 24, height: 24 });
  cardEl.getBoundingClientRect = () => card;
  // The layout size is what gets read (it ignores the card's scale-in), and the
  // stub's default for it is 800×600.
  btn.offsetWidth = 24; btn.offsetHeight = 24;
  cardEl.offsetWidth = card.width; cardEl.offsetHeight = card.height;
  cardEl.classList.toggle('is-open', open);
  cardEl.style.maxHeight = '';
  return { nav, map, btn, card: cardEl };
}

const originOf = el => `${el.style.left},${el.style.top}`;

test('the info pill keeps its home corner while nothing is in it', () => {
  const { btn, card } = seedInfo();
  // Docked down the left edge but centred vertically — it never reaches the
  // top-left, so there is nothing to step around.
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(originOf(card), '12px,12px');
  assert.strictEqual(originOf(btn), '12px,12px', 'the pill and its card share an anchor');
  assert.strictEqual(card.dataset.corner, 'top-left', 'and the CSS is told, so it grows the right way');
});

test('a top toolbar across the corner moves the pill below it, not elsewhere', () => {
  const { btn, card } = seedInfo();
  context.App.toolbarDock = { side: 'top', ratio: 0 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('top'));

  const below = `${M + toolbarBox('top').height + context.OVERLAY_GAP}px`;
  assert.strictEqual(originOf(card), `12px,${below}`);
  assert.strictEqual(originOf(btn), `12px,${below}`);
  assert.strictEqual(card.dataset.corner, 'top-left', 'still the top-left corner');
});

test('a left toolbar reaching the corner moves the pill in beside it', () => {
  const { btn } = seedInfo();
  context.App.toolbarDock = { side: 'left', ratio: 0 };

  context.layoutCanvasOverlays(WRAP, toolbarBox('left'));

  assert.strictEqual(originOf(btn), `${M + toolbarBox('left').width + context.OVERLAY_GAP}px,12px`);
});

// The pill takes the corner it fits in; only the card steps aside. Sizing the
// pill's spot for the card pushed a 24px button out beside a left toolbar,
// alone in the middle of nowhere.
test('the pill keeps the corner the card is too big for, and the card opens beside it', () => {
  const shut = seedInfo({ open: false });
  // Far enough right that the 24px pill clears the toolbar; the card does not.
  context.App.toolbarDock = { side: 'top', ratio: 0.18 };
  context.layoutCanvasOverlays(WRAP, toolbarBox('top'));
  assert.strictEqual(originOf(shut.btn), '12px,12px', 'the pill stays in the corner');
  const cardAt = originOf(shut.card);
  assert.notStrictEqual(cardAt, '12px,12px', 'the card steps down below the toolbar');

  const open = seedInfo({ open: true });
  context.App.toolbarDock = { side: 'top', ratio: 0.18 };
  context.layoutCanvasOverlays(WRAP, toolbarBox('top'));
  assert.strictEqual(originOf(open.card), cardAt, 'opening it does not move it');
  // It grows out of the pill: the scale starts at the pill's centre.
  const dy = 12 - parseInt(cardAt.split(',')[1], 10) + 12;
  assert.strictEqual(open.card.style.transformOrigin, `12px ${dy}px`);
});

// On a narrow canvas the stack spans most of the width, and the card used to
// open straight over it — every corner was "taken", so the search settled for
// the least-bad one. It keeps its corner now and scrolls instead.
test('the card stops short of the stack beneath it', () => {
  const { card } = seedInfo({ card: { width: 310, height: 700 } });
  const narrow = { left: 0, top: 0, width: 480, height: 600 };
  getElement('canvas-wrap').getBoundingClientRect = () => narrow;
  getElement('canvas-nav-controls').getBoundingClientRect = () => ({ width: 292, height: 38 });
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };
  // No toolbar on screen: the stub's default rect would otherwise be measured as one.
  const toolbox = getElement('canvas-toolbox');
  const realParent = toolbox.offsetParent;
  toolbox.offsetParent = null;
  try {
    context.layoutCanvasOverlays(narrow, null);
  } finally {
    toolbox.offsetParent = realParent;
  }

  // map: 600 - 12 - 38 - 8 - 122 = 420 from the top; minus a gap, minus the card's top.
  assert.strictEqual(card.style.maxHeight, `${420 - context.OVERLAY_GAP - 12}px`);
});

test('the card is never capped below a readable height', () => {
  const { card } = seedInfo();
  const tiny = { left: 0, top: 0, width: 360, height: 200 };
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };

  context.layoutCanvasInfo(tiny, null, [{ left: 0, top: 40, width: 360, height: 160 }]);

  assert.strictEqual(card.style.maxHeight, `${context.CARD_MIN_HEIGHT}px`);
  assert.strictEqual(card.style.position, 'absolute', 'and it is still placed');
});

// ── The status toast ──────────────────────────────────────────────
// Given a lane rather than measured: the message is written after layout runs,
// so a toast placed for the last message was wrong for the next one.

test('a top-docked toolbar pushes the status toast below it', () => {
  const status = getElement('status-bar');
  context.App.toolbarDock = { side: 'top', ratio: 0.5 };
  context.positionStatusToast(WRAP, { left: 200, top: 12, width: 480, height: 66 });
  assert.strictEqual(status.style.top, `${12 + 66 + context.OVERLAY_GAP}px`);
  assert.strictEqual(status.style.left, '600px', 'centred on the canvas');
  assert.strictEqual(status.style.maxWidth, `${1200 - 24}px`);
});

test('the toast centres in the lane right of an open card', () => {
  const status = getElement('status-bar');
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };
  const card = { left: 12, top: 12, width: 320, height: 167 };
  context.positionStatusToast(WRAP, null, [card]);
  const left = 12 + 320 + context.OVERLAY_GAP, right = 1200 - 12;
  assert.strictEqual(status.style.top, '10px', 'it keeps the top strip');
  assert.strictEqual(status.style.left, `${(left + right) / 2}px`);
  assert.strictEqual(status.style.maxWidth, `${right - left}px`);
});

test('with no lane worth reading in, the toast drops beneath what crowded it', () => {
  const status = getElement('status-bar');
  context.App.toolbarDock = { side: 'left', ratio: 0.5 };
  const narrow = { left: 0, top: 0, width: 480, height: 600 };
  const card = { left: 12, top: 12, width: 320, height: 167 };
  context.positionStatusToast(narrow, null, [card]);
  assert.strictEqual(status.style.top, `${12 + 167 + context.OVERLAY_GAP}px`);
  assert.strictEqual(status.style.maxWidth, `${480 - 24}px`);
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

// ── A toolbar that does not fit ───────────────────────────────────
// Folds to icons by itself and unfolds when there is room, without touching the
// reader's own collapse preference.

test('a row too long for its edge folds itself, and unfolds with room', () => {
  harness.resetApp();
  const toolbox = getElement('canvas-toolbox');
  const wrap = getElement('canvas-wrap');
  wrap.getBoundingClientRect = () => WRAP;
  toolbox.getBoundingClientRect = () => ({ width: 520, height: 56 });
  toolbox.offsetParent = {};
  context.App.toolbarDock = { side: 'top', ratio: 0.5 };
  context.App.toolbarCollapsed = false;

  toolbox.clientWidth = 400; toolbox.scrollWidth = 520;
  context.applyToolbarDock(false);
  assert.ok(toolbox.classList.contains('collapsed'), 'overflowing, it folds');
  assert.ok(toolbox.classList.contains('is-squeezed'));
  assert.strictEqual(context.App.toolbarCollapsed, false, 'the preference is untouched');

  toolbox.clientWidth = 520; toolbox.scrollWidth = 520;
  context.applyToolbarDock(false);
  assert.ok(!toolbox.classList.contains('collapsed'), 'with room again, it unfolds');
  assert.ok(!toolbox.classList.contains('is-squeezed'));
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

// ══════════════════════════════════════════════════════════════════
//  A CLOSED OVERLAY MUST NOT TAKE THE POINTER
// ══════════════════════════════════════════════════════════════════
//  Twelve overlays sit in the DOM at all times, in front of the page at
//  opacity 0. What keeps them from swallowing every click is one declaration
//  — `.overlay { pointer-events: none }` — and the fact that `pointer-events`
//  is *inherited*: the children get it for free, and `.overlay.show` hands it
//  back only while the dialog is open.
//
//  Which makes a `pointer-events: auto` on any child of an overlay a trap. It
//  overrides the inherited `none` in both states, so the closed dialog goes on
//  intercepting the pointer, invisibly. The StateMate console is docked to the
//  bottom at 900px wide, so declaring it unscoped put an invisible panel over
//  the canvas toolbar that ate every click and showed a text cursor for its own
//  textarea — with nothing on screen to explain it.
//
//  A source-level assertion because no screenshot can catch it: the failing
//  state looks exactly like the working one.

import { readFileSync as readCssFile } from 'node:fs';
import { fileURLToPath as cssPath } from 'node:url';

const MODAL_CSS = readCssFile(cssPath(new URL('../css/modals.css', import.meta.url)), 'utf8');
const PANELS_CSS = readCssFile(cssPath(new URL('../css/panels.css', import.meta.url)), 'utf8');

/** Every `selector { … }` rule in a stylesheet, comments stripped. */
function cssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
}

test('nothing inside an overlay claims the pointer while the overlay is closed', () => {
  const offenders = cssRules(MODAL_CSS)
    .filter(rule => /pointer-events\s*:\s*(auto|all)\s*[;}]?/.test(rule.body))
    // Rules for the overlay itself are how the mechanism works; this is about
    // its children, which inherit and must not opt out unconditionally.
    .filter(rule => !/^\.overlay(\.show)?$/.test(rule.selector))
    .filter(rule => !/\.show\b/.test(rule.selector));

  assert.deepEqual(offenders.map(r => r.selector), [],
    'a child of an overlay may only take the pointer under .show — otherwise the '
    + 'closed dialog keeps intercepting clicks it cannot be seen to be intercepting');
});

test('StateMate is a panel in flow, with none of the dock plumbing left behind', () => {
  const rules = cssRules(MODAL_CSS);

  // The dock was an `.overlay` + `.modal` that spent a dozen rules undoing its
  // own inheritance — transparent ground, no backdrop-filter, pointer-events
  // off and then back on — so that the canvas underneath stayed usable. As the
  // right panel's second tab it does not cover the canvas at all, and every
  // one of those rules is gone rather than rewritten. Asserted at source
  // because the failing state looks exactly like the working one: a stray
  // `.sm-overlay` rule would silently reintroduce a full-viewport layer.
  const stale = rules.filter(r => /\.sm-(overlay|console)\b/.test(r.selector));
  assert.deepEqual(stale.map(r => r.selector), [],
    'the overlay and its console are gone; .sm-panel is the surface now');

  const panel = rules.find(r => r.selector === '.sm-panel');
  assert.ok(panel, '.sm-panel is declared');
  assert.doesNotMatch(panel.body, /position\s*:\s*(fixed|absolute)/,
    'a panel takes layout space rather than floating over the canvas');
  // The hiding rule is not StateMate's own: `hidden` is what the panel
  // controller sets, and one rule in panels.css makes it hide every tabpanel
  // on both sides — so this is matched out of a selector list there rather
  // than looked up as a rule of its own here.
  const hiddenPanel = cssRules(PANELS_CSS).find(r =>
    r.selector.split(',').some(sel => sel.trim() === '.sm-panel[hidden]'));
  assert.match(hiddenPanel?.body || '', /display\s*:\s*none/,
    'the inactive native tabpanel is removed from layout');

  // No glass anywhere in the panel. It was justified by the live diagram
  // underneath, and there is no longer a diagram underneath — a backdrop
  // filter here would cost a compositor layer that re-rasterizes on every pan
  // and return nothing.
  const glass = rules.filter(r => /^\.sm-/.test(r.selector) && /backdrop-filter/.test(r.body));
  assert.deepEqual(glass.map(r => r.selector), [],
    'the translucency went with the dock that justified it');
});

test('the StateMate panel lives inside the right panel, not the overlay stack', () => {
  const html = readCssFile(cssPath(new URL('../index.html', import.meta.url)), 'utf8');
  const rpanel = html.slice(html.indexOf('<div class="rpanel"'), html.indexOf('AUXILIARY VIEWS'));

  assert.ok(rpanel.includes('id="statemate-panel"'),
    'the console is a child of the right panel');
  assert.ok(rpanel.includes('id="panel-tab-statemate"') && rpanel.includes('id="panel-tab-inspector"'),
    'and the strip that switches between it and the Inspector is in the panel header');
  assert.ok(!/<div class="overlay[^"]*" id="statemate-panel"/.test(html),
    'it is no longer registered markup-side as an overlay');
});

// ══════════════════════════════════════════════════════════════════
//  A FRAMED MACHINE STAYS FRAMED
// ══════════════════════════════════════════════════════════════════
//  After a fit, the view is framed for as long as the camera is the one the fit
//  set. While it is, any change to what floats over the canvas fits again — in
//  either direction. A camera the reader has moved is never moved for them.

const FRAME_WRAP = { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };

function seedFraming() {
  harness.resetApp();
  const wrap = getElement('canvas-wrap');
  wrap.getBoundingClientRect = () => FRAME_WRAP;
  // The toolbar is the one overlay in play; everything else is off screen.
  for (const id of ['canvas-nav-controls', 'minimap-container', 'canvas-info-btn', 'example-card']) {
    getElement(id).offsetParent = null;
  }
  getElement('mobile-bar').getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const toolbox = getElement('canvas-toolbox');
  toolbox.offsetParent = {};
  const place = (left, top, width = 60, height = 400) => {
    toolbox.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height });
  };
  place(12, 200);
  context.App.states = [{ id: 'q0', name: 'q0', x: 100, y: 100 }, { id: 'q1', name: 'q1', x: 400, y: 300 }];
  context.App.cam = { x: 0, y: 0, z: 1 };
  context.fitToScreen(true);
  context.markFramed({ quiet: false });
  assert.strictEqual(context.checkFraming(), false, 'the first measurement is only a baseline');
  return { place, wrap };
}

test('a framed view fits again when an overlay changes', () => {
  const { place } = seedFraming();
  const before = { ...context.App.cam };
  place(12, 200, 260, 400);   // the toolbar grows, as it does when it unfolds
  assert.strictEqual(context.checkFraming(), true);
  assert.notDeepStrictEqual({ ...context.App.cam }, before);
  assert.ok(context.isFramed(), 'and it is framed again afterwards');
});

test('it fits back the other way when the overlay goes away', () => {
  const { place } = seedFraming();
  place(12, 200, 400, 400);
  context.markFramed({ quiet: false });
  context.checkFraming();                         // re-baseline with the big overlay
  context.markFramed({ quiet: false });
  const out = context.App.cam.z;
  place(12, 200, 60, 400);
  assert.strictEqual(context.checkFraming(), true, 'a card folding away gives the room back');
  assert.ok(context.App.cam.z >= out);
});

test('a camera the reader moved is left alone', () => {
  const { place } = seedFraming();
  context.App.cam.x += 40;                        // a pan, from any source
  assert.strictEqual(context.isFramed(), false);
  const before = { ...context.App.cam };
  place(12, 200, 260, 400);
  assert.strictEqual(context.checkFraming(), false);
  assert.deepStrictEqual({ ...context.App.cam }, before);
});

test('pressing Fit hands the camera back', () => {
  seedFraming();
  context.App.cam.z *= 2;
  assert.strictEqual(context.isFramed(), false);
  context.fitToScreen(true);
  assert.strictEqual(context.isFramed(), true);
});

test('a change under the tolerance is noise, not a trigger', () => {
  const { place } = seedFraming();
  place(12, 200, 62, 400);
  assert.strictEqual(context.checkFraming(), false);
});

test('nothing fits while the reader is mid-gesture', () => {
  const { place } = seedFraming();
  context.App.dragOffsets = { q0: { dx: 0, dy: 0 } };
  place(12, 200, 260, 400);
  try {
    assert.strictEqual(context.checkFraming(), false, 'it waits for the gesture to end');
  } finally {
    context.App.dragOffsets = null;
  }
  assert.strictEqual(context.checkFraming(), true, 'and then acts');
});

test('a canvas that changed size is left to the resize path', () => {
  const { place, wrap } = seedFraming();
  wrap.getBoundingClientRect = () => ({ ...FRAME_WRAP, right: 1000, width: 1000 });
  place(12, 200, 260, 400);
  assert.strictEqual(context.checkFraming(), false);
});

test('a check just after a fit adopts what moved instead of fitting again', () => {
  const { place } = seedFraming();
  context.fitToScreen(true);                      // quiet window open
  place(12, 200, 260, 400);
  assert.strictEqual(context.checkFraming(), false, 'what moved in the settle window moved because of the fit');
});
