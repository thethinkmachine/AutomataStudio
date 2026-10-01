// ══════════════════════════════════════════════════════════════════
//  THE CARD'S "FROM THE LIBRARY" SLOT
// ══════════════════════════════════════════════════════════════════
// The machine card (js/machine-card.js) draws a line under its title saying
// where a library machine came from and whether a newer version is out. Only
// the Library knows the second half, so it installs the painter — at module
// scope, from js/library-ui.js.
//
// A painter installed at module scope from another module is a shared mutable
// container written across an import cycle, and those live in leaves: were the
// slot a `let` inside machine-card.js, the install would read it before that
// module finished evaluating and throw "Cannot access before initialization".
// The same rule modal-registry.js and export-registry.js exist for.
//
// Import-free.

let painter = null;

export function setCardSourcePainter(fn) {
  painter = typeof fn === 'function' ? fn : null;
}

export function cardSourcePainter() {
  return painter;
}
