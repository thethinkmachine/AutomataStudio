import { clearTempLine } from './canvas.js';
import { OpenCustomSelect, closeCustomSelect } from './dropdown.js';
import { ModalRegistry, ModalReturnFocus, ModalStack } from './modal-registry.js';
import { $, App } from './state.js';
import { SymSuggest } from './suggest.js';

export { ModalRegistry, ModalReturnFocus, ModalStack };

// ══════════════════════════════════════════════════════════════════
//  MODAL CORE
// ══════════════════════════════════════════════════════════════════
//  Shared open/close plumbing for the `.overlay` dialogs. The aux-view
//  overlay in view.js already did focus management and a Tab trap; this
//  applies the same treatment to the modal stack, and adds the pieces
//  that only make sense once several dialogs can be open at once:
//  a topmost-wins Escape, per-modal teardown, and Enter-to-submit.

// ModalStack, ModalRegistry and ModalReturnFocus are declared in
// ./modal-registry.js and re-exported above — see that file for why they
// cannot live here.

export const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Declare a modal's behaviour.
 * @param {string} id                    modal element id
 * @param {object} [opts]
 * @param {Function} [opts.onClose]      teardown run on close
 * @param {Function} [opts.submit]       primary action; Enter invokes it
 * @param {Function} [opts.onEscape]     first refusal on Escape; true = consumed
 * @param {boolean} [opts.dismissOnBackdrop] close when the backdrop is clicked
 * @param {string|Function} [opts.initialFocus] what to focus on open — an id, a
 *   selector within the dialog, or a function returning an element. Absent
 *   means the first focusable child in DOM order.
 */
export function registerModal(id, opts = {}) {
  ModalRegistry[id] = {
    onClose: opts.onClose || null,
    submit: opts.submit || null,
    onEscape: opts.onEscape || null,
    dismissOnBackdrop: !!opts.dismissOnBackdrop,
    initialFocus: opts.initialFocus || null
  };
}

export function isModalOpen(id) { return ModalStack.includes(id); }

/** The modal currently on top, or null when none is open. */
export function topModal() { return ModalStack.length ? ModalStack[ModalStack.length - 1] : null; }

/**
 * True while a modal is open — used to gate global canvas shortcuts.
 */
export function anyModalOpen() { return ModalStack.length > 0; }

/** Focusable, visible children of a modal, in tab order. */
export function modalFocusables(shell) {
  return Array.prototype.filter.call(
    shell.querySelectorAll(MODAL_FOCUSABLE),
    el => el.offsetParent !== null && !el.hasAttribute('aria-hidden')
  );
}

// ── Close button ──────────────────────────────────────────────────
// Not one of the thirteen dialogs had one: Escape and — for the four that opt
// into it — a backdrop click were the only ways out, which leaves About and
// Keyboard Shortcuts with a single focusable control between them and no exit
// at all on a touch device.
//
// It is injected rather than written thirteen times so a dialog added later
// gets one without remembering to, the way js/reference.js wires its own
// chrome at creation. It goes inside .modal-title, which is the sticky bar, so
// it stays reachable in a dialog tall enough to scroll — and it is appended to
// the <h2> rather than to the <span class="modal-title-text"> inside it,
// because several dialogs rewrite their title text (the transition editor, the
// divider editor, the update dialog, every confirm) and the wizard rebuilds its
// title on every step. Writing to the span cannot disturb a sibling.
//
// A dialog with no .modal-title — About leads with its logo lockup — gets the
// absolutely positioned variant instead.

// Phosphor's `x`, built as nodes rather than assigned as innerHTML — the same
// stance js/markdown.js takes, and the reason the whole app has one HTML parse
// site to audit rather than several.
const CLOSE_PATH = 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z';

function closeGlyph() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', CLOSE_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * Give a dialog the chrome every dialog gets. Idempotent — called on every
 * open, so it also covers a dialog whose shell was built at runtime.
 */
export function installModalChrome(shell) {
  if (!shell) return;
  const box = shell.querySelector('.modal');
  if (!box || box.querySelector('.modal-close')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'modal-close';
  btn.setAttribute('aria-label', 'Close dialog');
  btn.appendChild(closeGlyph());
  btn.addEventListener('click', () => closeModal(shell.id));

  const title = box.querySelector('.modal-title');
  if (title) {
    title.appendChild(btn);
  } else {
    btn.classList.add('modal-close-float');
    box.insertBefore(btn, box.firstChild);
  }
}

/**
 * Whether a dialog is hiding content above or below its sticky bars.
 *
 * The title and footer are opaque and pinned, so a dialog taller than the
 * viewport hides its content *behind* them — and with a hairline as the only
 * edge, a sentence cut halfway through its ascenders reads as a clipping bug
 * rather than as "there is more here". A short window is all it takes: a
 * confirm dialog overflowing by thirteen pixels looked broken.
 *
 * Two classes rather than one, because the two ends are independently true.
 */
export function syncModalScroll(box) {
  if (!box || !box.classList) return;
  const height = Number(box.scrollHeight);
  const visible = Number(box.clientHeight);
  const at = Number(box.scrollTop);
  if (!Number.isFinite(height) || !Number.isFinite(visible) || !Number.isFinite(at)) return;
  // A pixel of slack: sub-pixel layout leaves a fraction of overflow on
  // dialogs that visibly have none, which would shadow every title in the app.
  box.classList.toggle('is-scrolled', at > 1);
  box.classList.toggle('has-more', height - visible - at > 1);
}

/** Resolve a registered initialFocus declaration against an open dialog. */
function resolveInitialFocus(shell, decl) {
  if (!decl) return null;
  let el = null;
  if (typeof decl === 'function') el = decl();
  else if (typeof decl === 'string') el = shell.querySelector(decl) || $(decl);
  return el && typeof el.focus === 'function' && shell.contains(el) ? el : null;
}

export function showOverlay(id) {
  const shell = $(id);
  if (!shell) return;
  if (isModalOpen(id)) return;

  installModalChrome(shell);

  // Watched once per dialog, not once per open: the box outlives every open,
  // and thirteen dialogs opened repeatedly would otherwise stack listeners.
  const box = shell.querySelector('.modal');
  if (box && !box.dataset.scrollWatch) {
    box.dataset.scrollWatch = '1';
    box.addEventListener('scroll', () => syncModalScroll(box), { passive: true });
  }

  const measure = () => {
    syncModalScroll(box);
    // Again next frame: `show` is what makes the dialog visible, and a
    // dialog whose body is built at open time has not been laid out yet.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => syncModalScroll(box));
  };

  ModalReturnFocus[id] = document.activeElement;
  shell.classList.add('show');
  ModalStack.push(id);
  // Stack later modals above earlier ones so the backdrop of the inner one
  // covers the outer dialog rather than sliding underneath it.
  shell.style.zIndex = String(900 + ModalStack.length);
  document.body.classList.add('modal-open');

  // Where focus lands is the dialog's to declare — `initialFocus` on its
  // registration — because the fallback is "first focusable in DOM order",
  // which is the close button or a Cancel as often as it is the field the
  // reader came to fill in. Dialogs used to fix that by calling focus() again
  // after this returned, which is a second focus move the reader can see.
  const entry = ModalRegistry[id];
  const wanted = resolveInitialFocus(shell, entry && entry.initialFocus);
  if (wanted) {
    wanted.focus();
    if (typeof wanted.select === 'function' && wanted.tagName === 'INPUT') wanted.select();
    measure();
    return;
  }

  const focusables = modalFocusables(shell);
  if (focusables.length) {
    focusables[0].focus();
  } else if (shell.firstElementChild && shell.firstElementChild.focus) {
    shell.firstElementChild.focus();
  }
  measure();
}

// ══════════════════════════════════════════════════════════════════
//  THE SHARED CONFIRM
// ══════════════════════════════════════════════════════════════════
// #confirm-modal is one dialog reused by every "are you sure?" in the app, so
// its Enter key has to dispatch to whatever handler is currently attached
// rather than to a fixed function. The registration used to live in utils.js;
// it is here because askConfirm() below needs the same onClose hook to tell a
// cancel from a confirm, and two registrations for one id would overwrite each
// other silently.
let confirmCancel = null;

registerModal('confirm-modal', {
  submit: () => {
    const btn = $('confirm-action-btn');
    if (btn && btn.onclick) btn.onclick();
  },
  onClose: () => {
    // Reset the label rather than leaving the last caller's wording for the
    // next one: the sites that drive this dialog by hand set the title and the
    // message and never touch the button, so a stale verb would ride along.
    const btn = $('confirm-action-btn');
    if (btn) {
      btn.textContent = 'Confirm';
      if (btn.classList) btn.classList.remove('btn-danger');
    }
    const cancel = confirmCancel;
    confirmCancel = null;
    if (cancel) cancel();
  }
});

/**
 * Ask a yes/no question through #confirm-modal.
 *
 * Anything that dismisses the dialog without pressing the action button — the
 * Cancel button, the injected ×, Escape, the backdrop — is a cancel, so
 * `onCancel` runs from onClose rather than from a listener on any one of them.
 * `onConfirm` clears the pending cancel before closing, or confirming would
 * fire both.
 */
export function askConfirm({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  if ($('confirm-title')) $('confirm-title').textContent = title;
  if ($('confirm-msg')) $('confirm-msg').textContent = message;
  const btn = $('confirm-action-btn');
  if (btn) {
    btn.textContent = confirmLabel;
    if (btn.classList) btn.classList.toggle('btn-danger', !!danger);
    btn.onclick = () => {
      confirmCancel = null;
      closeModal('confirm-modal');
      if (onConfirm) onConfirm();
    };
  }
  confirmCancel = onCancel || null;
  showOverlay('confirm-modal');
}

export function closeModal(id) {
  const shell = $(id);
  if (!shell) return;
  if (typeof closeCustomSelect === 'function') closeCustomSelect();
  shell.classList.remove('show');
  shell.style.zIndex = '';

  const idx = ModalStack.indexOf(id);
  if (idx !== -1) ModalStack.splice(idx, 1);
  // Recomputed rather than tied to the modal being closed: another dialog may
  // still be open underneath it.
  if (!anyModalOpen()) document.body.classList.remove('modal-open');

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
    if (typeof OpenCustomSelect !== 'undefined' && OpenCustomSelect) {
      e.preventDefault();
      e.stopPropagation();
      closeCustomSelect({ focus: true });
      return;
    }
    // The symbol-suggest popover owns Escape while it is open — dismissing a
    // completion list should not also tear down the dialog around it. This
    // listener captures on document, so it would otherwise pre-empt the
    // inline onkeydown handler that suggest.js binds to the field itself.
    if (typeof SymSuggest !== 'undefined' && SymSuggest.target === e.target && SymSuggest.state) return;
    // A dialog with something open inside it — a completion list, a request in
    // flight — gets first refusal, so one Escape dismisses the innermost thing
    // rather than the whole dialog. Registering the handler rather than
    // importing the owner keeps this module free of the modals it serves.
    const owner = ModalRegistry[top];
    if (owner && owner.onEscape && owner.onEscape(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
    if ((tag === 'TEXTAREA' || active?.isContentEditable) && !(e.ctrlKey || e.metaKey)) return;
    // Let buttons and links act on their own Enter rather than double-firing.
    if (tag === 'BUTTON' || tag === 'A') return;
    e.preventDefault();
    e.stopPropagation();
    entry.submit();
  }
}, true);
