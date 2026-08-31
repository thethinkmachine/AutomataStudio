import { createVersion, reactiveRoot } from './reactive.js';

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
// This module imports only js/reactive.js, which imports only Solid, which
// imports nothing of ours. That keeps the property the old "no imports at all"
// rule was protecting: store.js is still a leaf of the *app's* graph, so
// subscribers can register at module scope from anywhere and a hoisted
// `subscribe` stays reachable regardless of evaluation order (see the notes in
// js/modal-registry.js for why that matters here). Do not import an app module
// here.
//
// Alongside the subscriber list there is now a version signal per change kind.
// The two are not alternatives and neither replaces the other:
//
//   subscribe/emit stays the dispatch. Ordering is a documented contract
//   (declaration order in Change, not emit order) and 22 function calls are
//   not a cost worth reorganising around.
//
//   changed(kind) is the invalidation token derived values hang off. It is
//   what lets updateFormalDef skip a KaTeX re-typeset when the machine's
//   *structure* did not change — which is the actual expense a plain
//   emit(Change.GRAPH) used to pay on every state drag. See js/render.js.

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

// One version signal per change kind, bumped by deliver(). Memos read these to
// know they may be stale; they are deliberately write-only from the app's side
// (nothing subscribes an *effect* to them) so a bump costs a counter increment
// and marks lazy memos dirty, rather than eagerly recomputing anything.
const versions = reactiveRoot(() => {
  const m = new Map();
  for (const kind of Object.values(Change)) m.set(kind, createVersion());
  return m;
});

/**
 * Track a change kind from inside a memo or effect. Returns an opaque counter;
 * the value means nothing, reading it is the point.
 */
export function changed(kind) {
  const v = versions.get(kind);
  if (!v) throw new Error(`changed: unknown change kind "${kind}"`);
  return v[0]();
}

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
  // Invalidate first, dispatch second. Subscribers such as updateRPanel read
  // derived memos, so those have to be marked stale before anyone reads them —
  // the other order hands the panels the previous edit's values.
  //
  // Wrapped for the same reason the subscriber loop below is. Solid's memos are
  // EAGER: writing the signal recomputes every memo depending on it, right here,
  // so a memo body that throws would abort the whole delivery — taking the
  // canvas down because a panel's derived string could not be built. A memo that
  // throws keeps its previous value, which is stale but survivable.
  for (const kind of seen) {
    try {
      versions.get(kind)?.[1]();
    } catch (err) {
      console.error(`store: a derived value for "${kind}" threw`, err);
    }
  }
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
