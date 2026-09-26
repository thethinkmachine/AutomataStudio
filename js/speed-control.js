// ══════════════════════════════════════════════════════════════════
//  THE VARISPEED — playback speed as a dial in the transport
// ══════════════════════════════════════════════════════════════════
// Speed used to be a dropdown parked after the Reset button: a menu to open,
// a list to read, and a label that stopped fitting once the fast end of the
// range arrived. It is a *knob* now, the way a tape deck's varispeed or an
// audio editor's rate control is — a segment of the transport it belongs to,
// showing where it is set at a glance, turned in place:
//
//   click          one detent faster (past Max it comes round to the slowest)
//   shift-click    one detent slower
//   scroll, drag   turn it, up or right is faster
//   alt-click      back to 1×, the way a knob resets to unity
//   keyboard       arrows / PageUp / PageDown step, Home / End go to the ends
//
// It is a slider to assistive technology, because that is what it is: one
// value on a scale with named stops.
//
// The value it turns is `App.config.autoSpeed`, milliseconds per step — the
// same number Settings edits and the settings profile saves, so nothing about
// persistence changed. 0 means Max: as fast as the page can go, which the
// frame-paced clock in simulation.js makes a real speed rather than a timer
// asked to fire every 0ms.

import { $, App } from './state.js';
import { restartAutoTimerIfPlaying } from './simulation.js';

/** The detents, slowest first, in milliseconds per step. 0 is Max. */
export const SPEED_DETENTS = Object.freeze([1000, 500, 250, 100, 50, 10, 1, 0]);

/** The interval 1× names — unity, where the dial's notch sits. */
export const UNITY_MS = 500;

// Wheel travel per detent. A mouse wheel notch is ~100 in pixel mode, so a
// notch is a detent; a trackpad's stream of small deltas has to travel to get
// one, which keeps a flick from spinning through the whole range.
const WHEEL_PER_DETENT = 60;
// Pointer travel per detent while dragging, in CSS pixels.
const DRAG_PER_DETENT = 14;

const speedOf = ms => UNITY_MS / ms;

/** "2×", "0.5×", "Max" — and a sensible reading for a value typed in Settings. */
export function speedLabel(ms) {
  if (!(ms > 0)) return 'Max';
  const x = speedOf(ms);
  const shown = x >= 10 ? Math.round(x) : x >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;
  return `${shown}×`;
}

/** What the speed means, in steps — for the tooltip and the slider's value text. */
export function speedRate(ms) {
  if (!(ms > 0)) return 'as fast as the page can go';
  const perSec = 1000 / ms;
  const n = perSec >= 10 ? Math.round(perSec).toLocaleString() : String(Math.round(perSec * 10) / 10);
  return `${n} step${perSec === 1 ? '' : 's'} a second`;
}

const currentMs = () => {
  const ms = Number(App.config.autoSpeed);
  return Number.isFinite(ms) && ms >= 0 ? ms : UNITY_MS;
};

/**
 * Where on the dial a speed sits, 0 (slowest detent) to 1 (Max).
 *
 * The detents are evenly spaced on the dial and the speeds between them are
 * placed by ratio, so a value typed in Settings — 300ms, say — lands between
 * 1× and 2× where it belongs rather than snapping to either.
 */
export function dialFraction(ms) {
  const last = SPEED_DETENTS.length - 1;
  if (!(ms > 0)) return 1;
  const speeds = SPEED_DETENTS.slice(0, last).map(speedOf);
  const s = speedOf(ms);
  if (s <= speeds[0]) return 0;
  for (let j = 0; j < speeds.length - 1; j++) {
    if (s < speeds[j + 1]) return (j + Math.log(s / speeds[j]) / Math.log(speeds[j + 1] / speeds[j])) / last;
  }
  return (speeds.length - 1) / last;
}

/** The detent a value is at, or -1 if it is between two. */
function detentIndex(ms) {
  return SPEED_DETENTS.findIndex(d => d === ms || (d > 0 && ms > 0 && Math.abs(d - ms) < 1e-9));
}

/**
 * The detent `dir` stops away from a value: +1 is the next faster, -1 the next
 * slower. From a value between detents, one stop is the neighbour on that side.
 * With `wrap`, stepping past either end comes round to the other.
 */
export function stepDetent(ms, dir, { wrap = false } = {}) {
  const last = SPEED_DETENTS.length - 1;
  let i = detentIndex(ms);
  if (i === -1) {
    // Between two detents: the first stop in that direction is the neighbour.
    const f = dialFraction(ms) * last;
    i = dir > 0 ? Math.floor(f) : Math.ceil(f);
  }
  let next = i + dir;
  if (next > last) next = wrap ? 0 : last;
  if (next < 0) next = wrap ? last : 0;
  return SPEED_DETENTS[next];
}

/** Set the speed from anywhere — the dial, a test, a future shortcut. */
export function setPlaybackSpeed(ms) {
  const v = Number(ms);
  App.config.autoSpeed = Number.isFinite(v) && v >= 0 ? v : UNITY_MS;
  restartAutoTimerIfPlaying();
  syncSpeedControl();
}

function nudge(dir, opts) {
  const before = currentMs();
  const after = stepDetent(before, dir, opts);
  if (after === before) return;
  setPlaybackSpeed(after);
  flash();
}

// The readout blinks accent for a moment when the value changes under a
// pointer or a key, so a turn is seen to have registered. Restarting a CSS
// animation needs a reflow between the two class writes; this only runs on a
// deliberate gesture, never per frame.
function flash() {
  const el = $('sim-speed');
  if (!el || !el.classList) return;
  el.classList.remove('is-nudged');
  void el.offsetWidth;
  el.classList.add('is-nudged');
}

/** Redraw the dial and readout from `App.config.autoSpeed`. */
export function syncSpeedControl() {
  const el = $('sim-speed');
  if (!el) return;
  const ms = currentMs();
  const f = dialFraction(ms);
  const label = speedLabel(ms);
  const rate = speedRate(ms);
  const parts = el.__speedParts || {};
  if (parts.readout) parts.readout.textContent = label;
  // pathLength="100" on the arcs makes the fill a percentage of the sweep.
  if (parts.value) parts.value.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
  // The pointer is drawn straight up; the sweep starts 135° to its left.
  if (parts.pointer) parts.pointer.style.transform = `rotate(${(f * 270 - 135).toFixed(1)}deg)`;
  el.classList.toggle('is-max', !(ms > 0));
  el.setAttribute('aria-valuenow', String(Math.round(f * (SPEED_DETENTS.length - 1))));
  el.setAttribute('aria-valuetext', `${label}, ${rate}`);
  el.setAttribute('data-tip',
    `Speed ${label} — ${rate}. Click for faster, Shift-click slower; scroll or drag to turn; Alt-click for 1×.`);
}

/** Wire the dial. Idempotent; called once at boot. */
export function initSpeedControl() {
  const el = $('sim-speed');
  if (!el || el.__speedWired) return;
  el.__speedWired = true;
  el.__speedParts = {
    readout: el.querySelector ? el.querySelector('.speed-readout') : null,
    value: el.querySelector ? el.querySelector('.sd-value') : null,
    pointer: el.querySelector ? el.querySelector('.sd-pointer') : null
  };

  // A drag that turned the dial must not also count as the click it ends in.
  let swallowClick = false;
  let drag = null;

  el.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; return; }
    if (e.altKey) { if (currentMs() !== UNITY_MS) { setPlaybackSpeed(UNITY_MS); flash(); } return; }
    nudge(e.shiftKey ? -1 : 1, { wrap: true });
  });

  let wheelTravel = 0;
  el.addEventListener('wheel', e => {
    e.preventDefault();   // the panel under the dial must not scroll while it turns
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // Reversing direction starts a fresh turn rather than unwinding the last.
    if (Math.sign(px) !== Math.sign(wheelTravel)) wheelTravel = 0;
    wheelTravel += px;
    while (Math.abs(wheelTravel) >= WHEEL_PER_DETENT) {
      const dir = wheelTravel < 0 ? 1 : -1;   // wheel up is faster
      wheelTravel += dir * WHEEL_PER_DETENT;
      nudge(dir);
    }
  }, { passive: false });

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const last = SPEED_DETENTS.length - 1;
    drag = { x: e.clientX, y: e.clientY, from: Math.round(dialFraction(currentMs()) * last), turned: false, id: e.pointerId };
    swallowClick = false;
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    // Up or right turns it faster, as on a fader or a knob.
    const travel = (drag.y - e.clientY) + (e.clientX - drag.x);
    const steps = Math.trunc(travel / DRAG_PER_DETENT);
    if (!drag.turned && steps === 0) return;
    if (!drag.turned) {
      drag.turned = true;
      el.classList.add('is-turning');
      if (typeof el.setPointerCapture === 'function') { try { el.setPointerCapture(drag.id); } catch (_) { /* already released */ } }
    }
    const i = Math.max(0, Math.min(SPEED_DETENTS.length - 1, drag.from + steps));
    if (SPEED_DETENTS[i] !== currentMs()) { setPlaybackSpeed(SPEED_DETENTS[i]); flash(); }
  });
  const endDrag = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.turned) swallowClick = true;
    el.classList.remove('is-turning');
    drag = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener('keydown', e => {
    const last = SPEED_DETENTS.length - 1;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': case 'PageUp': nudge(1); break;
      case 'ArrowDown': case 'ArrowLeft': case 'PageDown': nudge(-1); break;
      case 'Home': setPlaybackSpeed(SPEED_DETENTS[0]); flash(); break;
      case 'End': setPlaybackSpeed(SPEED_DETENTS[last]); flash(); break;
      // A div is not a button to the browser, so Enter and Space are the click.
      case 'Enter': case ' ': nudge(e.shiftKey ? -1 : 1, { wrap: true }); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      // The canvas listens for arrows on document; a dial being turned is not
      // a selection being nudged.
      e.stopPropagation();
    }
  });

  syncSpeedControl();
}
