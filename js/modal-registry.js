// ══════════════════════════════════════════════════════════════════
//  MODAL REGISTRY STATE
// ══════════════════════════════════════════════════════════════════
// The three containers behind js/modal.js, split out because eight modules call
// registerModal() at module scope (workspace.js, ui.js, export-ui.js,
// states-transitions.js, dividers.js, notes.js, utils.js).
//
// A hoisted function like registerModal is reachable across an import cycle
// before its own module has finished evaluating — but the `const` it closes
// over is not: reading it throws "Cannot access before initialization". Keeping
// these here, in a module with no imports of its own, guarantees they are
// initialised before anything that could reach registerModal, whatever order
// the graph happens to be walked in.
//
// Nothing outside js/modal.js should touch these directly.

// Open modals, innermost last. Escape and the Tab trap only ever act on the top
// of this stack, so a modal opened from another modal behaves.
export const ModalStack = [];

// id → { onClose, submit, dismissOnBackdrop }. Each modal registers its own
// teardown instead of growing a shared if-chain in closeModal.
export const ModalRegistry = Object.create(null);

// The element focus returns to when a modal closes, keyed by modal id.
export const ModalReturnFocus = Object.create(null);
