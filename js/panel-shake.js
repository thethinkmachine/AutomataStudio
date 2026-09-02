// Shaking a window to put the sidebars away.
//
// Aero Shake, aimed at the thing a floating section is actually competing with
// for the screen. A reader who has pulled Simulate out to sit beside the
// diagram is telling you the diagram is what matters right now — and the two
// rails either side of it are the largest thing still in the way. Shake the
// window you are holding and both sidebars collapse to hover rails; shake it
// again and exactly the ones that were there come back.
//
// **It is reversible by the same gesture, which is the whole of why it is safe
// to leave on.** The shake never destroys an arrangement: it *remembers* the
// sides it put away, so the return trip is the arrangement the reader had
// rather than the app's default. Everything it does is also reachable from the
// two pin buttons, which do not move and go on saying what they do, so a
// reader who triggers it by accident is one visible click from where they were.
//
// **Only a window already out is shakeable**, and deliberately not a section
// being torn out of a panel. A tear-off is judged against the panel it came
// from — `outsideBy` measures the pointer against that panel's box and
// `panelIsOpen` refuses to dock into a rail — so unpinning mid-tear-off would
// collapse the source panel to zero width and take away the reader's way of
// putting the section back, in the middle of the gesture that is deciding it.
//
// The detector is here rather than in [js/panel-float.js](panel-float.js)
// because it is a question about the *pointer*, not about a window: the window
// is only what is under it. Keeping it apart also keeps `panel-float.js` from
// importing `ui.js`.

import { isPanelPinned, setPanelPinned } from './ui.js';
import { PANEL_SIDES, shakeToMinimizeEnabled } from './panel-state.js';
import { showStatus } from './utils.js';

/**
 * How far the pointer must travel between two reversals for the leg to count
 * as a swing rather than as a hand that is not quite steady.
 *
 * The number a reader has to beat is `SHAKE_LEG_MIN × SHAKE_REVERSALS` px
 * inside `SHAKE_WINDOW_MS`, which is what stops careful positioning from
 * firing it: nudging a window into place is short legs, and a shake is long
 * ones. Placing a window is also *slow* relative to this window, so the two
 * are separated on both axes of the measurement rather than on either alone.
 */
const SHAKE_LEG_MIN = 40;

/** Direction changes that make a shake. Four is two full back-and-forths. */
const SHAKE_REVERSALS = 4;

/** ...that have to happen inside this, or the oldest is forgotten. */
const SHAKE_WINDOW_MS = 700;

/** Before one continued shake may fire a second time. */
const SHAKE_COOLDOWN_MS = 800;

/**
 * The reversals seen so far in the gesture in flight, or null between them.
 *
 * Per gesture rather than per session: a swing left in one drag and a swing
 * right in the next are not a shake, and carrying the count across would make
 * two ordinary moves add up to one.
 */
let track = null;

/** When a shake last fired, so a hand that keeps going does not fire twice. */
let lastFired = 0;

/**
 * The sides the shake put away, so the next one brings back what was there
 * rather than the app's default.
 *
 * Read only when nothing is pinned, so a reader who pins a panel by hand in
 * between simply has it stay pinned — `setPanelPinned` is idempotent and
 * reports that it did nothing.
 */
let stashed = null;

function axis() {
  return { at: null, turn: null, dir: 0 };
}

/**
 * Starts a gesture. Called on every press, whether or not it becomes a drag.
 *
 * Whether the gesture is armed is decided **here**, once, rather than on each
 * sample. `shakeToMinimizeEnabled()` is a `localStorage.getItem`, and a sample
 * is a frame of a drag — the same per-frame cost `liveGeom` and
 * `floatLayerRect` were pulled off that path for, and the drag's storage test
 * in tests/panel-float.test.js is what noticed it going back on. It reads
 * better as well: a reader cannot turn the gesture off halfway through
 * performing it, so the answer that matters is the one at the press.
 */
export function beginShakeTrack() {
  track = shakeToMinimizeEnabled() ? { x: axis(), y: axis(), hits: [] } : null;
}

export function endShakeTrack() {
  track = null;
}

/**
 * One axis of one sample.
 *
 * Returns true when this sample turned the pointer around *and* the leg it
 * turned around at was long enough to have been a swing. The leg is measured
 * from the previous reversal rather than from the start of the gesture, or a
 * long drag across the canvas would bank distance and let the first tremor at
 * the end of it count.
 */
function step(t, v) {
  if (t.at === null) { t.at = t.turn = v; return false; }
  const d = v - t.at;
  if (!d) return false;
  const dir = d > 0 ? 1 : -1;
  let swing = false;
  if (t.dir && dir !== t.dir) {
    swing = Math.abs(t.at - t.turn) >= SHAKE_LEG_MIN;
    t.turn = t.at;
  }
  t.dir = dir;
  t.at = v;
  return swing;
}

/**
 * Feeds the detector a pointer position, and fires when it has seen a shake.
 *
 * Both axes, independently, because a shake is a shake whichever way the wrist
 * goes and there is no reason to make the reader guess which one is being
 * watched. A diagonal or circular scribble reverses on both and fires sooner,
 * which is correct — it is more of a shake, not less.
 *
 * Returns what it did (`'minimized'` / `'restored'`) or null.
 */
export function noteShakeSample(x, y, now = Date.now()) {
  if (!track) return null;
  // Both, and never short-circuited: `||` would skip the second axis whenever
  // the first swung, leaving that axis's last position and last turning point
  // behind by however many samples the other one won — so the next leg it
  // measured would be against a coordinate the pointer left several frames
  // ago. One sample that reverses both axes is still one direction change of
  // one pointer, so the two are combined after the fact rather than counted
  // twice.
  const swungX = step(track.x, x);
  const swungY = step(track.y, y);
  if (!swungX && !swungY) return null;

  track.hits.push(now);
  // Only the recent ones. A slow left-right-left over five seconds is someone
  // placing a window, and it must never accumulate into a shake.
  while (track.hits.length && now - track.hits[0] > SHAKE_WINDOW_MS) track.hits.shift();
  if (track.hits.length < SHAKE_REVERSALS) return null;
  if (now - lastFired < SHAKE_COOLDOWN_MS) return null;

  lastFired = now;
  track.hits.length = 0;
  // The axes keep their state: the gesture is still in flight and the reader's
  // hand has not stopped, so the next reversal is measured from where this one
  // left off rather than from a standing start.
  return shakeMinimizePanels();
}

/**
 * Puts the sidebars away, or brings back the ones that were put away.
 *
 * Which of the two it is comes from the page rather than from a flag, so the
 * gesture cannot fall out of step with the pin buttons beside it: if anything
 * is pinned there is something to minimize, and if nothing is, the only thing
 * a reader can be asking for is their panels back. Falling back to *both* when
 * there is nothing remembered is what makes the gesture total — a shake that
 * did nothing and said nothing would read as a shake that was not detected.
 */
export function shakeMinimizePanels() {
  const pinned = PANEL_SIDES.filter(isPanelPinned);
  if (pinned.length) {
    stashed = pinned;
    pinned.forEach(side => setPanelPinned(side, false));
    showStatus('Panels minimized — shake again to bring them back');
    return 'minimized';
  }
  const back = stashed && stashed.length ? stashed : PANEL_SIDES;
  stashed = null;
  const changed = back.filter(side => setPanelPinned(side, true));
  showStatus(changed.length ? 'Panels restored' : 'Panels are already showing');
  return 'restored';
}

/** Whether a gesture is being watched — the tests' way in. */
export function isShakeTracking() {
  return !!track;
}

/** Drops module state between tests, and the cooldown latches. */
export function resetPanelShake() {
  track = null;
  lastFired = 0;
  stashed = null;
}
