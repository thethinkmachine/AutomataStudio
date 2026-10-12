// ══════════════════════════════════════════════════════════════════
//  RIGHT-CLICK
// ══════════════════════════════════════════════════════════════════
// One rule for the whole page. A part of the app that has a menu of its own —
// the canvas, a state, an edge, a note, a divider, a workspace tab, a panel
// section's header — handles `contextmenu` itself and prevents the default.
// Everywhere else the browser's own menu is offered only where it has
// something to do:
//
//   a text field          cut, copy, paste, spelling
//   selected text         copy
//   a link                copy or open it
//
// and nowhere else: "Back", "Reload" and "Inspect" over a toolbar are not a
// feature of the app. The desktop shell builds its native menu for the same
// three cases (electron/context-menu.cjs), so the two agree.
//
// The listener is on `document` in the bubble phase, so it runs after every
// element's own listener and after the action dispatcher on <html>: an owner
// that prevented the default has already decided, and is left alone.

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number']);
const EDITABLE = 'textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

function isTextField(el) {
  const input = el.closest?.('input');
  if (input) return TEXT_INPUT_TYPES.has(String(input.getAttribute?.('type') ?? input.type ?? '').toLowerCase());
  return !!el.closest?.(EDITABLE);
}

function isInSelection(el, selection) {
  if (!selection || selection.isCollapsed || !String(selection).trim()) return false;
  return typeof selection.containsNode === 'function' ? selection.containsNode(el, true) : true;
}

/** Whether a right-click on `target` should get the native menu. */
export function nativeContextMenuWanted(target, selection = globalThis.getSelection?.() ?? null) {
  // A text node is not an element; its parent is what was clicked.
  const el = target && target.nodeType === 3 ? target.parentNode : target;
  if (!el || typeof el.closest !== 'function') return false;
  return isTextField(el) || isInSelection(el, selection) || !!el.closest('a[href]');
}

export function applyContextMenuPolicy(event) {
  if (event.defaultPrevented) return;
  if (!nativeContextMenuWanted(event.target)) event.preventDefault();
}

export function installContextMenuPolicy(doc = document) {
  doc.addEventListener('contextmenu', applyContextMenuPolicy);
}
