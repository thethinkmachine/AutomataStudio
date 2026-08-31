// ══════════════════════════════════════════════════════════════════
//  REACTIVE PRIMITIVES
// ══════════════════════════════════════════════════════════════════
// The app's one dependency on Solid, and the only module allowed to import it.
// Everything else takes its primitives from here, so the reactive library is a
// single named seam rather than 80 import sites.
//
// WHAT IS AND IS NOT REACTIVE, because getting this wrong is expensive rather
// than broken:
//
//   The canvas hot path is deliberately NOT reactive. buildLayoutContext,
//   updateFastDOM, resolveNodeOverlaps and cullViewport read plain properties
//   off plain objects on App, sixty times a second, and they must keep doing
//   so. Wrapping App in a store proxy (createMutable) was measured at ~260x
//   slower per property read — 780us/frame for six reads across a 1000-state
//   machine, before any geometry or DOM work, against a 16.7ms budget. It is
//   the Proxy trap that costs, not the dependency bookkeeping, so untrack()
//   does not buy it back. There is no version of "make App reactive" that is
//   not a regression on exactly the machines this app works hardest to draw.
//
//   What IS reactive is the derived panel content: the formal definition, the
//   regex/class label, and the alphabets and accept-marks they read. Those
//   recompute per structural edit, not per frame, and they were the real cost —
//   see the notes over defLatex in js/render.js.
//
// This module imports only Solid, which imports nothing of the app's, so it is
// a leaf and safe to import from js/state.js without breaking that module's
// "imports nothing (of ours)" rule. See the note there.

import { createSignal, createMemo, createEffect, createRoot, untrack, batch as solidBatch } from 'solid-js';
import { ReactiveSet } from '@solid-primitives/set';

export { createSignal, createMemo, createEffect, createRoot, untrack, solidBatch, ReactiveSet };

// ── The build guard ───────────────────────────────────────────────
// Node resolves the "node" export condition of solid-js to dist/server.js, the
// SSR build, in which createEffect is literally `function createEffect(fn,
// value) {}` — an empty function. Nothing throws: effects simply never run,
// every memo is inert, and a test suite asserting reactions passes while
// testing nothing at all. That is the exact silent-failure shape this codebase
// is written against, so it is asserted at load instead of discovered later.
//
// The fix at the call site is `node --conditions=browser`; see the test script
// in package.json. Vite picks the browser condition on its own.
function probeReactivity() {
  let runs = 0;
  let bump = null;
  createRoot(() => {
    const [n, setN] = createSignal(0);
    bump = () => setN(v => v + 1);
    createEffect(() => { n(); runs++; });
  });
  const settled = runs;
  if (bump) bump();
  return settled > 0 && runs > settled;
}

export const REACTIVITY_LIVE = probeReactivity();

if (!REACTIVITY_LIVE) {
  throw new Error(
    'reactive.js: solid-js resolved to the non-reactive SSR build, so effects and ' +
    'memos will never run. Run Node with --conditions=browser (see the "test" ' +
    'script in package.json).'
  );
}

// ── Version signals ───────────────────────────────────────────────
/**
 * A monotonic counter used purely as an invalidation token. `equals: false`
 * so every bump notifies even though the value is uninteresting — memos
 * downstream compare their own *results*, which is where the short-circuit
 * that matters actually happens.
 */
export function createVersion() {
  const [read, write] = createSignal(0, { equals: false });
  return [read, () => write(v => v + 1)];
}

/**
 * Run `fn` inside a root that is never disposed. For module-scope graphs that
 * live as long as the page — which is all of ours. Without an owner Solid warns
 * that the computation can never be cleaned up.
 */
export function reactiveRoot(fn) {
  return createRoot(fn);
}
