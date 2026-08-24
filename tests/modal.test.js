import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness, getElement } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The base dialog shell.
//
// Three things moved into it that every dialog had been living without: a way
// to say where focus lands, a close button, and tab strips that a keyboard can
// reach. The fourth fix — a closed overlay leaving the page's tab order — is a
// stylesheet change (`visibility: hidden` on .overlay) and has nothing here to
// assert against; see the note over that rule in css/modals.css.

// The stub's elements answer querySelector with null and contains with false,
// which is right for most tests and wrong for these two: both are how the modal
// core finds things inside a dialog it was handed. Each test that needs one
// installs it over the specific element and puts it back afterwards.
function withinShell(shell, matches) {
  const realQS = shell.querySelector;
  const realContains = shell.contains;
  shell.querySelector = sel => matches[sel] || null;
  shell.contains = () => true;
  return () => { shell.querySelector = realQS; shell.contains = realContains; };
}

test('a dialog declares where focus lands, rather than taking the first control', () => {
  const h = createHarness();
  const shell = getElement('probe-modal');
  const field = getElement('probe-field');
  const cancel = getElement('probe-cancel');
  // First in DOM order, so it is what the fallback would pick.
  shell.appendChild(cancel);
  shell.appendChild(field);

  let focused = null;
  cancel.focus = () => { focused = 'cancel'; };
  field.focus = () => { focused = 'field'; };

  const restore = withinShell(shell, { '#probe-field': field });
  try {
    h.context.registerModal('probe-modal', { initialFocus: '#probe-field' });
    h.context.showOverlay('probe-modal');
    assert.equal(focused, 'field',
      'the declared target wins over the first focusable in DOM order');
  } finally {
    restore();
    h.context.closeModal('probe-modal');
  }
});

test('an undeclared dialog still falls back to its first focusable', () => {
  const h = createHarness();
  const shell = getElement('plain-modal');
  const first = getElement('plain-first');
  shell.appendChild(first);
  shell.querySelectorAll = () => [first];

  let focused = false;
  first.focus = () => { focused = true; };

  h.context.registerModal('plain-modal', {});
  h.context.showOverlay('plain-modal');
  try {
    assert.equal(focused, true, 'no initialFocus means the old behaviour, unchanged');
  } finally {
    h.context.closeModal('plain-modal');
  }
});

test('every dialog is given a close button, and only ever one', () => {
  const h = createHarness();
  const shell = getElement('chrome-modal');
  const box = getElement('chrome-box');
  const title = getElement('chrome-title');
  box.appendChild(title);
  shell.appendChild(box);

  // .modal-close is looked up on the box to decide whether the chrome is
  // already installed, so it has to answer from what has actually been added.
  box.querySelector = sel => {
    if (sel === '.modal') return box;
    if (sel === '.modal-title') return title;
    if (sel === '.modal-close') return title.children.find(c => c.className === 'modal-close') || null;
    return null;
  };
  shell.querySelector = sel => (sel === '.modal' ? box : null);

  h.context.installModalChrome(shell);
  h.context.installModalChrome(shell);
  h.context.installModalChrome(shell);

  const closers = title.children.filter(c => c.className === 'modal-close');
  assert.equal(closers.length, 1, 'installing is idempotent — it runs on every open');
  assert.equal(closers[0].getAttribute('aria-label'), 'Close dialog');
});

test('the close button goes beside the title text, not inside it', () => {
  const h = createHarness();
  const shell = getElement('sib-modal');
  const box = getElement('sib-box');
  const title = getElement('sib-title');
  const text = getElement('sib-title-text');
  title.appendChild(text);
  box.appendChild(title);
  shell.appendChild(box);

  box.querySelector = sel => {
    if (sel === '.modal-title') return title;
    if (sel === '.modal-close') return title.children.find(c => c.className === 'modal-close') || null;
    return null;
  };
  shell.querySelector = sel => (sel === '.modal' ? box : null);

  h.context.installModalChrome(shell);

  // This is the whole reason the id moved onto an inner span: the transition
  // editor, the divider editor, the update dialog and every confirm rewrite
  // their title with textContent, and the wizard rebuilds its title on every
  // step. A button written into the element being rewritten would not survive.
  text.textContent = 'Edit Transition';
  assert.equal(title.children.filter(c => c.className === 'modal-close').length, 1,
    'rewriting the title text cannot reach the button beside it');
});

test('switching a modal tab moves the selection, the tab order and what is hidden', () => {
  const h = createHarness();
  h.context.openSettingsModal();
  h.context.switchSettingsTab('rendering');

  const tab = getElement('settings-tab-rendering');
  const panel = getElement('tab-rendering');

  // Only the tab being selected is asserted, for the reason the settings suite
  // already records: deselecting the rest goes through querySelectorAll, which
  // the DOM stub does not implement. What matters here is that selecting now
  // writes three things where it used to write one class.

  // aria-selected is what a screen reader reads. These were <div onclick>s, so
  // there was no selected state to read at all.
  assert.equal(tab.getAttribute('aria-selected'), 'true');

  // A roving tabindex: the selected tab is the strip's one stop in the page's
  // tab order, and the arrows walk from there.
  assert.equal(tab.tabIndex, 0);

  // `hidden` is what hides a panel — an author display rule beats the UA's
  // [hidden] rule, so the class can no longer be what decides.
  assert.equal(panel.hidden, false);

  h.context.switchSettingsTab('symbols');
  assert.equal(getElement('settings-tab-symbols').getAttribute('aria-selected'), 'true');
  assert.equal(getElement('tab-symbols').hidden, false);
});

test('the shortcuts rail switches the same way the settings rail does', () => {
  const h = createHarness();
  // Both dialogs are the same shell, so they go through one switcher — and the
  // help rail is the one that carried no data-tab at all, which is why the
  // target used to be resolved by matching its onclick attribute's text.
  h.context.switchHelpTab('canvas');
  assert.equal(getElement('help-tab-btn-canvas').getAttribute('aria-selected'), 'true');
  assert.equal(getElement('help-tab-btn-canvas').tabIndex, 0);
  assert.equal(getElement('help-tab-canvas').hidden, false);
});

test('measuring the settings panels reveals them the way the tabs now hide them', () => {
  const h = createHarness();
  h.context.openSettingsModal();
  h.context.switchSettingsTab('general');
  // sizeSettingsPanels locks the dialog to its tallest panel by revealing each
  // in turn. It toggled `.active` to do that, which no longer draws anything —
  // it would have measured a stack of display:none boxes and collapsed the
  // dialog to the height of whichever panel happened to be open.
  assert.doesNotThrow(() => h.context.sizeSettingsPanels());
  assert.equal(getElement('tab-general').hidden, false,
    'the panel that was open is still open afterwards');
});

// ── the scroll cue ────────────────────────────────────────────────
//
// The sticky title and footer are opaque, so a dialog taller than the window
// hides its content behind them. With a hairline as the only edge, a sentence
// cut through its ascenders reads as a clipping bug — a confirm dialog
// overflowing by thirteen pixels was the report.

const box = (scrollHeight, clientHeight, scrollTop) => {
  const classes = new Set();
  return {
    scrollHeight, clientHeight, scrollTop,
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      has: name => classes.has(name)
    },
    has: name => classes.has(name)
  };
};

test('a dialog that fits carries no scroll cue', () => {
  const h = createHarness();
  const el = box(220, 220, 0);
  h.context.syncModalScroll(el);
  assert.equal(el.has('is-scrolled'), false);
  assert.equal(el.has('has-more'), false, 'a shadow under every title in the app is worse than none');
});

test('the two ends are independently true', () => {
  const h = createHarness();

  const top = box(600, 300, 0);
  h.context.syncModalScroll(top);
  assert.equal(top.has('is-scrolled'), false, 'nothing is hidden above the title yet');
  assert.equal(top.has('has-more'), true, 'but the footer is covering something');

  const middle = box(600, 300, 150);
  h.context.syncModalScroll(middle);
  assert.equal(middle.has('is-scrolled'), true);
  assert.equal(middle.has('has-more'), true);

  const bottom = box(600, 300, 300);
  h.context.syncModalScroll(bottom);
  assert.equal(bottom.has('is-scrolled'), true);
  assert.equal(bottom.has('has-more'), false);
});

test('a sub-pixel fraction of overflow is not a scroll', () => {
  const h = createHarness();
  const el = box(300.4, 300, 0.3);
  h.context.syncModalScroll(el);
  assert.equal(el.has('is-scrolled'), false);
  assert.equal(el.has('has-more'), false);
});

test('an element that cannot be measured is left alone', () => {
  const h = createHarness();
  const el = box(undefined, undefined, undefined);
  h.context.syncModalScroll(el);
  assert.equal(el.has('is-scrolled'), false);
  assert.equal(el.has('has-more'), false);
  assert.doesNotThrow(() => h.context.syncModalScroll(null));
});

// ── the sticky bleed ──────────────────────────────────────────────
//
// A sticky inset is resolved against the element's *margin* box, so the
// negative bleed margin that pulls the title and footer out to the dialog's
// edges is subtracted from the offset the browser pins them to. With `top: 0`
// the title came to rest --modal-py below the scrollport and the footer the
// same distance above it, leaving a strip at each end of a scrolling dialog
// that the body passed through in the open and was cut off in — the fields
// sliced through the middle with nothing over them. Cancelling the margin in
// the inset is what puts each bar's border box against the edge it belongs to.
//
// There is no JS here to exercise and the stub computes no styles, so this
// reads the rule. It is worth reading: nothing about the wrong version throws,
// renders blank or fails a screenshot of a dialog short enough to fit.
const modalsCss = readFileSync(join(ROOT, 'css/modals.css'), 'utf8');

function ruleBody(css, selector) {
  const i = css.indexOf(selector + ' {');
  assert.notEqual(i, -1, `${selector} is missing from css/modals.css`);
  return css.slice(i, css.indexOf('}', i));
}

test('the sticky bars cancel their own bleed margin in the inset', () => {
  const title = ruleBody(modalsCss, '.modal-title');
  assert.match(title, /margin:\s*calc\(var\(--modal-py\) \* -1\)/,
    'the title still bleeds to the top edge');
  assert.match(title, /\btop:\s*calc\(var\(--modal-py\) \* -1\);/,
    'and the inset still cancels that margin');

  const foot = ruleBody(modalsCss, '.modal-foot');
  assert.match(foot, /margin:[^;]*calc\(var\(--modal-py\) \* -1\);/,
    'the footer still bleeds to the bottom edge');
  assert.match(foot, /\bbottom:\s*calc\(var\(--modal-py\) \* -1\);/,
    'and the inset still cancels that margin');
});

// A literal rgba(0, 0, 0, ...) is invisible against a dark ground, which is
// half the range these dialogs are read in. --tab-overflow-shadow is the
// app's existing "there is more past this edge" colour and follows the theme.
test('the scroll cue is drawn in the themed overflow colour', () => {
  for (const selector of ['.modal.is-scrolled > .modal-title', '.modal.has-more > .modal-foot']) {
    const body = ruleBody(modalsCss, selector);
    assert.match(body, /box-shadow:[^;]*var\(--tab-overflow-shadow\)/, selector);
  }
});
