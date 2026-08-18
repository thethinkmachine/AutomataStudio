// ══════════════════════════════════════════════════════════════════
//  CHANGE STORE
// ══════════════════════════════════════════════════════════════════
// Publish/subscribe over App, so a mutation says what changed instead of
// listing everyone who needs telling.
//
// The pattern this replaces appeared ~24 times:
//
//     App.transitions.push(t);
//     snapshot(); renderAll(); updateLPanel(); updateRPanel();
//
// and it went wrong in the obvious way — a site would forget updateRPanel, or
// call renderAll twice, or snapshot after mutating something snapshot doesn't
// capture. The replacement is `commit(Change.GRAPH)`.
//
// This module deliberately has no imports. Subscribers register at module
// scope, and a hoisted `subscribe` in an import-free module is reachable from
// anywhere in the graph regardless of evaluation order (see the notes in
// js/modal-registry.js for why that matters here).

// What changed, not who should react to it.
//
// Declaration order is delivery order (see deliver()), and it is chosen to
// match the sequence the hand-written call sites used: alphabet chips, then
// the canvas, then the panels that read both.
export const Change = {
  // Σ, Γ or the output alphabet.
  ALPHABET: 'alphabet',
  // States, transitions, start/accept marks — the machine itself.
  GRAPH: 'graph',
  // Redraw only: selection, highlights, camera. No structural edit, so the
  // panels and the formal definition are already correct.
  CANVAS: 'canvas',
  // The info card's contents — what this machine is called, what it does, and
  // the words worth trying on it. Its own kind rather than part of GRAPH: it
  // is persisted (so unlike CANVAS it dirties the tab) but it is not the
  // machine (so unlike GRAPH it must not drag the panels and the whole
  // diagram through a re-render because a blurb was reworded).
  META: 'meta',
  // The open workspace tabs, their names or their dirty flags.
  TABS: 'tabs',
  // The save indicator's state.
  SAVE: 'save'
};

const subscribers = new Map();
for (const kind of Object.values(Change)) subscribers.set(kind, []);

let batchDepth = 0;
let pending = null;

/**
 * Register a reaction to a change kind. Returns an unsubscribe function.
 * Handlers run in registration order and are called with no arguments — a
 * handler reads whatever it needs from App itself.
 */
export function subscribe(kind, fn) {
  const list = subscribers.get(kind);
  if (!list) throw new Error(`subscribe: unknown change kind "${kind}"`);
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  };
}

/**
 * Announce that something changed.
 *
 * Delivery is synchronous by default. That is deliberate: callers such as
 * fitToScreen and autoFitLoadedMachine measure the DOM on the line after the
 * edit, and deferring the repaint to a microtask would silently hand them
 * stale geometry. Use batch() where coalescing is wanted.
 */
export function emit(...kinds) {
  if (batchDepth > 0) {
    for (const k of kinds) pending.add(k);
    return;
  }
  deliver(kinds);
}

/**
 * Run `fn`, collecting every emit inside it, then deliver each distinct kind
 * once. Nested batches flush with the outermost. Worth using for bulk edits —
 * loading a workspace, subset construction, paste — where the naive path
 * repaints once per element added.
 */
export function batch(fn) {
  if (batchDepth === 0) pending = new Set();
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const kinds = [...pending];
      pending = null;
      if (kinds.length) deliver(kinds);
    }
  }
}

// Deliver in the order the kinds are declared in `Change`, not the order they
// happened to be emitted, so a batch that touched the alphabet and the graph
// always redraws in the same sequence.
function deliver(kinds) {
  const seen = new Set(kinds);
  for (const kind of Object.values(Change)) {
    if (!seen.has(kind)) continue;
    for (const fn of subscribers.get(kind).slice()) {
      try {
        fn();
      } catch (err) {
        // One broken subscriber must not abort the rest of the repaint, or a
        // single bad panel takes the canvas down with it.
        console.error(`store: subscriber for "${kind}" threw`, err);
      }
    }
  }
}

/** Test seam: drop every subscriber. Not used by the app. */
export function _resetSubscribersForTests() {
  for (const list of subscribers.values()) list.length = 0;
  batchDepth = 0;
  pending = null;
}

/** Test seam: how many subscribers a kind has. */
export function _subscriberCount(kind) {
  return (subscribers.get(kind) || []).length;
}
