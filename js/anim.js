import { App } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  LAYOUT ANIMATION
// ══════════════════════════════════════════════════════════════════
// geometry.js decides *where* things belong; this module decides how fast the
// drawing is allowed to get there.
//
// The layout pass re-runs from scratch on every drag frame, and three of its
// stages pick a winner from a discrete candidate set by argmin — twelve loop
// directions, node-sized routing steps, eighteen label slots. Argmin over a
// discrete set is discontinuous in its input, so a one-pixel pointer move can
// flip a decision and teleport a label thirty pixels. Easing the *drawn* value
// toward the chosen one turns that into a glide.
//
// It is deliberately a display layer and nothing more. geometry.js keeps
// returning true targets, so getContentBounds — and therefore fit-to-screen and
// every cropped export — keeps measuring the settled drawing rather than
// whatever happens to be on screen mid-flight.
//
// Imports state.js only. Several modules reach this at module scope, and
// state.js is the one module guaranteed to have finished evaluating (see the
// evaluation-order rules in CLAUDE.md).

// Time constant of the exponential approach, in ms. At TAU the value has closed
// ~63% of its gap; the epsilon snap below ends it at roughly 3·TAU, so this is a
// ~165ms settle — long enough to read as motion, short enough not to feel laggy
// behind a pointer.
const TAU = 55;

// Below these the remaining distance is under a pixel of ink, so continuing to
// interpolate would only cost frames. The track snaps and marks itself done.
const EPS_POS = 0.35;    // px
const EPS_ANGLE = 0.004; // rad, ≈ 0.23°

// A frame longer than this is a stall — a backgrounded tab, a long GC — and
// easing across it in one step would look like a jump. Clamped so the animation
// resumes at a sane rate instead. The floor keeps a 240Hz display from
// integrating in steps so small they lose precision.
const DT_MIN = 4;
const DT_MAX = 64;

// key -> {cur, tgt, done, angular, gen}
const tracks = new Map();

// groupKey -> the objects the group's tracks describe. See claimGroup.
const owners = new Map();

let rafId = null;
let lastT = 0;
let painter = null;

// Bumped once per paint pass so pruneTracks can tell which tracks that pass
// touched. Without it a track outlives the edge it belongs to: deleting an edge
// mid-glide leaves its track at done:false, nothing steps it again, and the
// settle loop below re-arms forever.
let gen = 0;

// ── environment ──

// True when the host runs rAF callbacks synchronously — which tests/dom-stub.js
// deliberately does, so that deferred DOM tails get exercised inline.
//
// A self-arming settle loop would recurse forever there. It cannot be caught by
// checking for a zero delta either: `performance` is not stubbed, so Node's real
// clock hands back microsecond deltas and the loop would converge only after
// hundreds of thousands of nested frames.
//
// So probe once for the behaviour itself. A real browser cannot run the callback
// before requestAnimationFrame returns; only a synchronous stub can.
let syncRAF = null;
function isSyncRAF() {
  if (syncRAF !== null) return syncRAF;
  if (typeof requestAnimationFrame !== 'function') return (syncRAF = true);
  let ranInline = true;
  let settled = false;
  try {
    requestAnimationFrame(() => { settled = ranInline; });
  } catch (e) {
    return (syncRAF = true);
  }
  ranInline = false;
  return (syncRAF = settled);
}

function now() {
  return typeof performance === 'object' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// Mirrors simMotionOk() in simulation.js. Inlined rather than imported to keep
// this module a leaf.
export function animMotionOk() {
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Whether eased drawing is on at all. Off ⇒ every read returns the target
 * unchanged, which is exactly the behaviour this module replaced.
 *
 * The config flag follows the collision-avoidance convention: absent means on,
 * so a workspace or preferences blob written before this existed does not read
 * as "animation disabled".
 */
export function animEnabled() {
  const r = (App.config && App.config.render) || {};
  return r.animateLayout !== false && !isSyncRAF() && animMotionOk();
}

// animEnabled() ends in matchMedia(), which allocates a MediaQueryList on every
// call. A paint pass reads four tracks per edge, so asking per read would mean
// hundreds of those a frame. Resolved once per pass instead; beginPass() and
// resetAnim() clear it, so a config or reduced-motion change is picked up by the
// next paint rather than the next reload.
let passEnabled = null;
function enabledNow() {
  if (passEnabled === null) passEnabled = animEnabled();
  return passEnabled;
}

// ── the easing law ──

// Frame-rate independent exponential approach. The obvious `cur += (tgt-cur)*k`
// per frame is not: it would settle twice as fast on a 144Hz display as on 60Hz.
function alphaFor(dt) {
  return 1 - Math.exp(-Math.max(DT_MIN, Math.min(DT_MAX, dt)) / TAU);
}

// Shortest signed way round from a to b, in (-π, π]. Without this a loop moving
// from 350° to 10° would unwind the long way through 180°, sweeping the label
// right across the state it belongs to.
function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Eases one named quantity toward `target` and returns what should be drawn now.
 *
 * A key seen for the first time starts *at* its target — a newly created edge
 * appears where it belongs rather than flying in from the origin.
 */
export function easeTrack(key, target, dt, angular = false) {
  if (!Number.isFinite(target)) return target;
  if (!enabledNow()) { tracks.delete(key); return target; }

  let tr = tracks.get(key);
  if (!tr) {
    tr = { cur: target, tgt: target, done: true, angular, gen };
    tracks.set(key, tr);
    return target;
  }

  tr.tgt = target;
  tr.angular = angular;
  tr.gen = gen;

  const gap = angular ? angleDiff(tr.cur, target) : target - tr.cur;
  const eps = angular ? EPS_ANGLE : EPS_POS;
  if (Math.abs(gap) < eps) {
    tr.cur = target;
    tr.done = true;
    return target;
  }

  tr.cur += gap * alphaFor(dt);
  tr.done = false;
  return tr.cur;
}

/** Drops a key to its target immediately — used where a glide would be wrong. */
export function snapTrack(key, target) {
  const tr = tracks.get(key);
  if (tr) { tr.cur = target; tr.tgt = target; tr.done = true; tr.gen = gen; }
  return target;
}

/** Forgets a key, so the next read of it paints exactly at its target. */
export function dropTrack(key) {
  tracks.delete(key);
}

/**
 * Records which objects a group of tracks describes, and reports whether they
 * have been swapped for different ones since last time.
 *
 * This is how a machine load is detected without a call site. Edge keys are
 * "fromId|toId" and resetIds() regenerates ids as s1, s2, … on every load, so a
 * freshly loaded machine presents the *same* keys as the one before it — and its
 * edges would otherwise ease in from the previous machine's geometry. But every
 * wholesale replacement installs new state *objects*, while a drag mutates x/y
 * on the existing ones, so object identity separates the two cases exactly.
 *
 * First sight is not a change: a brand-new edge starts at its target anyway.
 */
export function claimGroup(groupKey, ...refs) {
  const prev = owners.get(groupKey);
  owners.set(groupKey, { refs, gen });
  if (!prev) return false;
  return prev.refs.length !== refs.length || refs.some((r, i) => r !== prev.refs[i]);
}

/** True while at least one track is still moving. */
export function animRunning() {
  for (const tr of tracks.values()) if (!tr.done) return true;
  return false;
}

/**
 * Opens a paint pass and returns the delta to ease by.
 *
 * Every read during the pass stamps its track with the current generation, so
 * the endPass() that closes it can drop whatever was not read. That matters
 * because an unread track is one whose edge no longer exists, and a track stuck
 * at done:false is exactly what would keep the settle loop below arming itself
 * for the rest of the session.
 */
export function beginPass() {
  gen++;
  passEnabled = null;
  const t = now();
  const dt = lastT ? t - lastT : 16;
  lastT = t;
  return dt;
}

/** Closes the pass opened by beginPass, dropping tracks it did not touch. */
export function endPass() {
  for (const [key, tr] of tracks) if (tr.gen !== gen) tracks.delete(key);
  for (const [key, o] of owners) if (o.gen !== gen) owners.delete(key);
}

/** Forces every track to its target. Called before anything reads the drawn DOM. */
export function settleAll() {
  for (const tr of tracks.values()) { tr.cur = tr.tgt; tr.done = true; }
  stopSettle();
}

/**
 * Drops all animation state.
 *
 * A belt-and-braces reset for the cases where the whole diagram moves on
 * purpose — auto-layout, a radius change — and gliding to the new arrangement
 * would read as a wobble rather than as motion.
 */
export function resetAnim() {
  tracks.clear();
  owners.clear();
  passEnabled = null;
  stopSettle();
}

// ── the settle loop ──
//
// There is no persistent render loop in the app; repaints are event-driven
// through store.js. This is the one exception, and it exists because a drag that
// ends without resolving an overlap emits nothing at all — endPointerInteractions
// only emits Change.GRAPH when resolveNodeOverlaps actually moved something. So
// the glide after release has to drive itself.

/** Registers the geometry-only repaint the loop should call. Set once, at boot. */
export function setSettlePainter(fn) { painter = fn; }

export function stopSettle() {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = null;
}

/**
 * Asks for another frame if anything is still in flight. Safe to call after
 * every paint: it is a no-op once every track has converged, so an idle diagram
 * costs nothing.
 */
export function requestSettle() {
  if (rafId !== null || !painter) return;
  if (!animEnabled() || !animRunning()) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    painter();
  });
}

// Test seam — lets a test drive the loop deterministically without a real clock.
export function _animTracks() { return tracks; }
export function _setSyncRAF(v) { syncRAF = v; }
