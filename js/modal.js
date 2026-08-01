// ══════════════════════════════════════════════════════════════════
//  MODAL CORE
// ══════════════════════════════════════════════════════════════════
//  Shared open/close plumbing for the `.overlay` dialogs. The aux-view
//  overlay in view.js already did focus management and a Tab trap; this
//  applies the same treatment to the modal stack, and adds the pieces
//  that only make sense once several dialogs can be open at once:
//  a topmost-wins Escape, per-modal teardown, and Enter-to-submit.

// Open modals, innermost last. Escape and the Tab trap only ever act on
// the top of this stack, so a modal opened from another modal behaves.
const ModalStack = [];

// id → { onClose, submit, dismissOnBackdrop }. Each modal registers its
// own teardown instead of growing a shared if-chain in closeModal.
const ModalRegistry = Object.create(null);

// The element focus returns to when a modal closes, keyed by modal id.
const ModalReturnFocus = Object.create(null);

const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Declare a modal's behaviour.
 * @param {string} id                    overlay element id
 * @param {object} [opts]
 * @param {Function} [opts.onClose]      teardown run on close
 * @param {Function} [opts.submit]       primary action; Enter invokes it
 * @param {boolean} [opts.dismissOnBackdrop] close when the backdrop is clicked
 */
function registerModal(id, opts = {}) {
  ModalRegistry[id] = {
    onClose: opts.onClose || null,
    submit: opts.submit || null,
    dismissOnBackdrop: !!opts.dismissOnBackdrop
  };
}

function isModalOpen(id) { return ModalStack.includes(id); }

/** The modal currently on top, or null when none is open. */
function topModal() { return ModalStack.length ? ModalStack[ModalStack.length - 1] : null; }

/** True while any modal is open — used to gate global canvas shortcuts. */
function anyModalOpen() { return ModalStack.length > 0; }

/** Focusable, visible children of a modal, in tab order. */
function modalFocusables(shell) {
  return Array.prototype.filter.call(
    shell.querySelectorAll(MODAL_FOCUSABLE),
    el => el.offsetParent !== null && !el.hasAttribute('aria-hidden')
  );
}

function showOverlay(id) {
  const shell = $(id);
  if (!shell) return;
  if (isModalOpen(id)) return;

  ModalReturnFocus[id] = document.activeElement;
  shell.classList.add('show');
  ModalStack.push(id);
  // Stack later modals above earlier ones so the backdrop of the inner one
  // covers the outer dialog rather than sliding underneath it.
  shell.style.zIndex = String(900 + ModalStack.length);
  document.body.classList.add('modal-open');

  // Autofocus the first field so keyboard users land inside the dialog.
  // Modals that focus a specific control do it themselves after this call.
  const focusables = modalFocusables(shell);
  if (focusables.length) {
    focusables[0].focus();
  } else if (shell.firstElementChild && shell.firstElementChild.focus) {
    shell.firstElementChild.focus();
  }
}

function closeModal(id) {
  const shell = $(id);
  if (!shell) return;
  shell.classList.remove('show');
  shell.style.zIndex = '';

  const idx = ModalStack.indexOf(id);
  if (idx !== -1) ModalStack.splice(idx, 1);
  if (!ModalStack.length) document.body.classList.remove('modal-open');

  const entry = ModalRegistry[id];
  if (entry && entry.onClose) entry.onClose();

  // Shared canvas teardown: a modal dismissed mid-gesture must not leave a
  // dangling transition-in-progress behind it.
  App._pendFrom = null; App._pendTo = null; App.transFrom = null;
  if (typeof clearTempLine === 'function') clearTempLine();

  const back = ModalReturnFocus[id];
  delete ModalReturnFocus[id];
  if (back && back.focus && document.contains(back)) back.focus();
}

// ── Backdrop dismissal ────────────────────────────────────────────
// Only registered opt-in modals dismiss this way: the editing dialogs hold
// unsaved input, and a stray backdrop click should not discard it.
document.addEventListener('mousedown', e => {
  if (!e.target.classList || !e.target.classList.contains('overlay')) return;
  const id = e.target.id;
  const entry = ModalRegistry[id];
  if (!entry || !entry.dismissOnBackdrop) return;
  if (!isModalOpen(id)) return;
  // Guard against a drag that starts inside the dialog and releases on the
  // backdrop — that is a text selection, not a dismissal.
  e.target.dataset.backdropArmed = '1';
});

document.addEventListener('click', e => {
  if (!e.target.classList || !e.target.classList.contains('overlay')) return;
  const armed = e.target.dataset.backdropArmed === '1';
  delete e.target.dataset.backdropArmed;
  if (!armed) return;
  const entry = ModalRegistry[e.target.id];
  if (entry && entry.dismissOnBackdrop && isModalOpen(e.target.id)) closeModal(e.target.id);
});

// ── Keyboard ──────────────────────────────────────────────────────
// Runs in the capture phase so Escape and Enter are handled before the
// global canvas shortcut handler in ui.js, which ignores key events coming
// from form fields and would otherwise never see them.
document.addEventListener('keydown', e => {
  const top = topModal();
  if (!top) return;
  const shell = $(top);
  if (!shell) return;

  if (e.key === 'Escape') {
    // The symbol-suggest popover owns Escape while it is open — dismissing a
    // completion list should not also tear down the dialog around it. This
    // listener captures on document, so it would otherwise pre-empt the
    // inline onkeydown handler that suggest.js binds to the field itself.
    if (typeof SymSuggest !== 'undefined' && SymSuggest.target === e.target && SymSuggest.state) return;
    e.preventDefault();
    e.stopPropagation();
    closeModal(top);
    return;
  }

  if (e.key === 'Tab') {
    const visible = modalFocusables(shell);
    if (!visible.length) return;
    const first = visible[0];
    const last = visible[visible.length - 1];
    const active = document.activeElement;
    // Focus outside the dialog (or on the shell) re-enters at the near edge.
    if (!shell.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
    return;
  }

  if (e.key === 'Enter') {
    const entry = ModalRegistry[top];
    if (!entry || !entry.submit) return;
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    // A textarea keeps Enter as newline; Ctrl/Cmd+Enter submits instead.
    if (tag === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) return;
    // Let buttons and links act on their own Enter rather than double-firing.
    if (tag === 'BUTTON' || tag === 'A') return;
    e.preventDefault();
    e.stopPropagation();
    entry.submit();
  }
}, true);
