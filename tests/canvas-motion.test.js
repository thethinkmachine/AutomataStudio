import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// The breathing canvas background: a device preference, and a promise about
// cost. See js/canvas-motion.js and .canvas-aurora in css/views.css.

const css = readFileSync(new URL('../css/views.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the background moves by default, and off holds it still', () => {
  const h = createHarness();
  const { context } = h;
  const el = h.getElement('canvas-aurora');

  assert.equal(context.canvasMotionEnabled(), true, 'absent means on');

  context.setCanvasMotionEnabled(false);
  assert.equal(context.canvasMotionEnabled(), false);
  assert.equal(context.localStorage.getItem('automata-canvas-motion'), '0');
  assert.equal(el.classList.contains('is-still'), true);

  context.setCanvasMotionEnabled(true);
  assert.equal(context.localStorage.getItem('automata-canvas-motion'), null,
    'on is stored as the absence of a preference, so the default can still change');
  assert.equal(el.classList.contains('is-still'), false);
  assert.equal(el.classList.contains('is-resting'), false, 'switching it on wakes it');
});

test('the preference is not part of the machine', () => {
  const h = createHarness();
  h.context.setCanvasMotionEnabled(false);
  const blob = JSON.stringify(h.context.exportWorkspaceState());
  assert.ok(!/canvasMotion|canvas-motion/.test(blob),
    'App.config travels in every tab and every saved file; this must not');
});

test('the Settings dialog reads and writes the preference', () => {
  assert.ok(html.includes('id="set-canvas-motion"'));
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const fn = name => {
    const at = ui.indexOf(`export function ${name}(`);
    assert.notEqual(at, -1, `${name} not found`);
    return ui.slice(at, ui.indexOf('\n}', at));
  };
  assert.match(fn('openSettingsModal'), /set-canvas-motion'\)\.checked = canvasMotionEnabled\(\)/);
  assert.match(fn('applySettings'), /setCanvasMotionEnabled\(\$\('set-canvas-motion'\)\.checked\)/);
});

// The whole claim to near-zero cost: every animated property is one the
// compositor can run without the main thread. Animating anything else here —
// a background-position, a filter, a custom property — would repaint the full
// canvas every frame, forever.
test('the background animates only compositor properties', () => {
  const frames = ['canvas-lemniscate', 'canvas-breathe'];
  for (const name of frames) {
    const at = css.indexOf(`@keyframes ${name}`);
    assert.notEqual(at, -1, `@keyframes ${name} not found`);
    let depth = 0, end = at;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = css.slice(at, end);
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]);
    assert.ok(props.length > 0);
    for (const p of props) {
      assert.ok(['translate', 'scale', 'opacity', 'transform'].includes(p),
        `@keyframes ${name} animates ${p}, which is not compositor-only`);
    }
  }
});

test('the breath follows the run on a compressed, capped scale', () => {
  const { context } = createHarness();
  const { tempoFor, UNITY_MS } = context;

  assert.equal(tempoFor(null), 1, 'not playing: the resting breath');
  assert.equal(tempoFor(UNITY_MS), 1.3, "1× on the dial is 1.3 here — the module's unity must match the dial's");
  assert.ok(Math.abs(tempoFor(UNITY_MS / 10) - 1.6) < 1e-9, '10×');
  assert.equal(tempoFor(0), 1.8, 'Max is the cap');
  assert.equal(tempoFor(1), 1.8, '500× is clamped to the cap');
  assert.ok(tempoFor(1000) >= 1.15 && tempoFor(1000) < 1.3, 'slower than 1× still quickens a little');

  // Every setting on the dial is at least as quick as the one below it.
  let prev = 1;
  for (const ms of context.SPEED_DETENTS) {
    const t = tempoFor(ms);
    assert.ok(t >= prev, `${ms}ms breathes slower than a slower speed`);
    prev = t;
  }
});

test('a run starting and stopping sets and clears the tempo', () => {
  const { context } = createHarness();
  context.setCanvasMotionTempo(context.UNITY_MS);
  assert.equal(context.canvasMotionTempo(), 1.3);
  assert.equal(context.canvasMotionResting(), false, 'a run starting wakes a resting canvas');
  context.setCanvasMotionTempo(null);
  assert.equal(context.canvasMotionTempo(), 1);
});

test('the playback clock tells the background its pace', () => {
  const src = readFileSync(new URL('../js/simulation.js', import.meta.url), 'utf8');
  const at = src.indexOf('function syncFastPlayback(');
  assert.notEqual(at, -1);
  // Start, stop and every speed change all pass through syncFastPlayback.
  assert.match(src.slice(at, src.indexOf('\n}', at)),
    /setCanvasMotionTempo\(App\.autoTimer \? playbackIntervalMs\(\) : null\)/);
});

// Changing animation-duration on a running CSS animation re-derives its
// progress and the glows jump. The rate has to go through playbackRate.
test('the tempo changes playback rate, never the CSS duration', () => {
  const src = readFileSync(new URL('../js/canvas-motion.js', import.meta.url), 'utf8');
  assert.ok(!/animationDuration|animation-duration/.test(src.replace(/\/\/.*$/gm, '')),
    'writing a duration makes the pools jump');
  assert.match(src, /updatePlaybackRate/);
});

test('reduced motion and the aux views stop the background', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^{]*\{\s*\.canvas-aurora > i:is\(:first-child, :last-child\)\s*\{\s*animation: none/,
    'reduced motion must beat the per-pool animation rules on specificity');
  assert.match(css, /body\.aux-open \.canvas-aurora > i\s*\{\s*animation-play-state: paused/);
  assert.match(css, /\.canvas-aurora\.is-resting > i/);
});
