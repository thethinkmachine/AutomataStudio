// ══════════════════════════════════════════════════════════════════
//  THE ONE CALL THAT TOUCHES THE PAGE
// ══════════════════════════════════════════════════════════════════
// Every simulator ends a step with renderSimStep(). That is the whole of
// what js/machines/** ever asked of the DOM — and it was imported straight
// from js/simulation.js, which imports render.js, suggest.js and tape-view.js
// and so cannot be evaluated without a document.
//
// So the machine layer was DOM-free in what it *did* and DOM-bound in what it
// *imported*, which is the distinction that matters to a module graph. A
// worker importing a simulator to run decide() — which never paints — still
// had to evaluate the renderer.
//
// The fix is the pattern this codebase already uses for a shared mutable
// container written from more than one place (modal-registry.js,
// export-registry.js, machines/registry.js, store.js): an import-free leaf
// holding the binding, with the real implementation installed at module scope
// by the module that owns it. js/simulation.js calls setSimStepPainter() as it
// evaluates; on the main thread that happens before any run can start, because
// a run begins with a user gesture.
//
// Left uninstalled — which is exactly the case inside a worker — painting is a
// no-op. That is correct rather than merely harmless: a worker has no page to
// paint, and it only ever calls decide(), which never reaches this function.
let painter = null;

/** Installed once, at module scope, by js/simulation.js. */
export function setSimStepPainter(fn) {
  painter = typeof fn === 'function' ? fn : null;
}

/** True on the main thread, false in a worker. Nothing branches on it today;
 *  it exists so a mistake here is observable from a test rather than silent. */
export function hasSimStepPainter() {
  return painter !== null;
}

/** What the simulators call. Signature is the painter's — currently no args. */
export function renderSimStep(...args) {
  if (painter) painter(...args);
}
