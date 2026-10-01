// ══════════════════════════════════════════════════════════════════
//  THE BREATHING CANVAS BACKGROUND
// ══════════════════════════════════════════════════════════════════
// Whether it moves, and when it rests. The motion itself is CSS
// (`.canvas-aurora` in css/views.css), animated on `translate`, `scale` and
// `opacity` only, so it runs on the compositor and no frame of it reaches
// the main thread. What CSS cannot know is whether anyone is looking.
//
// A compositor animation is cheap per frame but it is never *idle*: it keeps
// the display pipeline producing frames at the panel's refresh rate for as
// long as it runs, and an app like this spends most of its life open and
// unattended. So it rests — `animation-play-state: paused`, which resumes
// from where it stopped, with nothing to see at this pace — when:
//
//   - nothing has been touched for IDLE_MS,
//   - the window has lost focus,
//   - an aux view covers the canvas (CSS reads `body.aux-open` directly).
//
// A hidden tab or a minimised window is already paused by the browser.
//
// While a run plays, the breath quickens with it, and settles when the run
// stops. Only the breath: the figure-eight drift keeps its own pace, since a
// background travelling faster would compete with the highlights the reader
// is actually watching. See TEMPO below.
//
// The preference goes in `localStorage`, not `App.config`, for the reason
// panel-state.js gives for the shake gesture: `App.config` travels in every
// workspace tab and every saved `.json`, and how this person likes their
// canvas to look is not a property of the machine. Absent means on.

import { $ } from './state.js';

const KEY = 'automata-canvas-motion';
const IDLE_MS = 90_000;

let _enabled = readEnabled();
let _resting = false;
let _last = 0;
let _timer = 0;
let _started = false;

function readEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch (e) {
    return true;
  }
}

export function canvasMotionEnabled() {
  return _enabled;
}

export function setCanvasMotionEnabled(on) {
  _enabled = !!on;
  try {
    // Stored only when off, so the default stays the absence of a preference.
    if (_enabled) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '0');
  } catch (e) { /* private mode; correct for this session either way */ }
  if (_enabled) wake();
  paint();
  // Switching back on starts the CSS animations afresh, at rate 1. A run may
  // already be playing, so they take up the tempo it set.
  if (_enabled && _rate !== 1) setRate(breathAnimations(), _rate);
  return _enabled;
}

/** Whether the background is currently paused for want of a viewer. */
export function canvasMotionResting() {
  return _resting;
}

function paint() {
  const el = $('canvas-aurora');
  if (!el) return;
  el.classList.toggle('is-still', !_enabled);
  el.classList.toggle('is-resting', _enabled && _resting);
}

function rest() {
  if (_resting) return;
  _resting = true;
  paint();
}

// Runs on every pointer move, so it does the least it can: a clock read and
// a branch. The idle timer is one setTimeout, re-armed only when it fires —
// never cleared and re-created per event.
function wake() {
  if (!_enabled) return;
  _last = Date.now();
  if (_resting) {
    _resting = false;
    paint();
  }
  if (!_timer) _timer = later(checkIdle, IDLE_MS);
}

// A timer that does not hold a process open. Node's handles have `unref`, and
// every test that presses Play arms the idle clock, so without it each test
// file would wait out ninety seconds after its last test. A browser's handle
// is a number and the call is skipped.
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  t?.unref?.();
  return t;
}

function checkIdle() {
  _timer = 0;
  if (!_enabled) return;
  const left = IDLE_MS - (Date.now() - _last);
  // A run that is playing is being watched, whether or not anyone touches
  // anything: nobody starts a two-minute run to look away from it.
  if (left > 0 || _tempo > 1) _timer = later(checkIdle, left > 0 ? left : IDLE_MS);
  else rest();
}

// ── TEMPO ──────────────────────────────────────────────────────────
//
// How fast the breath runs while a machine plays. The playback dial spans a
// thousandfold (0.5× to 500×, then Max), so the tempo follows it on a log
// scale and is clamped hard: 1× breathes at 1.3, 10× at 1.6, and nothing
// breathes faster than 1.8. It should read as the canvas working alongside
// the run, not as a speedometer.
//
// The rate goes through the running animations' `playbackRate`, never through
// `animation-duration`: a new duration re-derives each pool's progress from
// elapsed time and the pools would jump. A new playback rate keeps the
// current time, so it is a change of speed with no change of place. That is
// also why the ease can be stepped at 20Hz rather than every frame: each step
// changes a velocity, not a position, and the motion stays on the compositor.

// The dial's 1×, as speed-control.js defines it (a test holds the two equal).
const UNITY_MS = 500;
const TEMPO_FLOOR = 1.15;
const TEMPO_CAP = 1.8;
const EASE_IN_MS = 1200;
const EASE_OUT_MS = 2800;
const TEMPO_TICK_MS = 50;

let _tempo = 1;   // where the breath is heading
let _rate = 1;    // what the animations have now
let _tween = 0;

/** The breath's playback rate for a run at `msPerStep`; null means not playing. */
export function tempoFor(msPerStep) {
  if (msPerStep == null) return 1;
  const speed = msPerStep > 0 ? UNITY_MS / msPerStep : Infinity;
  return Math.min(TEMPO_CAP, Math.max(TEMPO_FLOOR, 1.3 + 0.3 * Math.log10(speed)));
}

export function canvasMotionTempo() {
  return _tempo;
}

/**
 * Called by the playback clock whenever it starts, stops or changes speed,
 * with the interval it is running at, or null when it is not.
 */
export function setCanvasMotionTempo(msPerStep) {
  const to = tempoFor(msPerStep);
  if (to === _tempo) return;
  const settling = to < _tempo;
  _tempo = to;
  // A run starting or ending is something happening on the canvas, so it
  // counts as activity for the idle clock too.
  wake();
  easeTo(to, settling ? EASE_OUT_MS : EASE_IN_MS);
}

function breathAnimations() {
  const el = $('canvas-aurora');
  if (!el || typeof el.getAnimations !== 'function') return [];
  return el.getAnimations({ subtree: true }).filter(a => a.animationName === 'canvas-breathe');
}

function setRate(anims, r) {
  _rate = r;
  for (const a of anims) {
    if (typeof a.updatePlaybackRate === 'function') a.updatePlaybackRate(r);
    else a.playbackRate = r;
  }
}

function easeTo(to, ms) {
  if (_tween) clearTimeout(_tween);
  _tween = 0;
  const anims = breathAnimations();
  // Still, reduced motion, or no Web Animations: nothing is moving, so the
  // rate is simply recorded for when something is.
  if (!anims.length) { _rate = to; return; }
  const from = _rate;
  const start = Date.now();
  const tick = () => {
    const p = Math.min(1, (Date.now() - start) / ms);
    setRate(anims, from + (to - from) * p * p * (3 - 2 * p));
    _tween = p < 1 ? later(tick, TEMPO_TICK_MS) : 0;
  };
  tick();
}

export function initCanvasMotion() {
  paint();
  if (_started || typeof window === 'undefined' || !window.addEventListener) return;
  _started = true;
  const opts = { capture: true, passive: true };
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, wake, opts);
  }
  window.addEventListener('focus', wake);
  window.addEventListener('blur', rest);
  wake();
}

/** Test isolation: forget the rest state, the tempo and the pending timers. */
export function resetCanvasMotion() {
  if (_timer) clearTimeout(_timer);
  if (_tween) clearTimeout(_tween);
  _timer = 0;
  _tween = 0;
  _tempo = 1;
  _rate = 1;
  _resting = false;
  _enabled = readEnabled();
}
