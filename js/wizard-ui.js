// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  MACHINE WIZARD — THE DIALOG
// ══════════════════════════════════════════════════════════════════
//  One question per screen, over the draft in js/wizard.js. Nothing here
//  decides anything about a machine: which questions exist, what they say
//  and whether an answer is any good are all questions for that module and
//  js/wizard-copy.js. This one draws.
//
//  Points worth keeping in mind:
//
//  **The button is one button in two modes, and the canvas decides which.**
//  A blank canvas gets a plus and builds; a canvas with a machine on it gets
//  a pencil and edits that machine, prefilled. That removes the fork the
//  wizard would otherwise have to open with — "new, or edit?" — which is a
//  question the app can answer by looking. syncWizardButton() is subscribed
//  to Change.GRAPH, so the mode is never stale.
//
//  **Typing never re-renders.** A text field writes straight into the draft
//  and refreshes only the issue list and the footer; re-rendering the step
//  would take the caret with it. Structural changes — adding a row, changing
//  the machine, moving between steps — re-render the body, and only they do.
//
//  **Listeners are attached at creation**, the way js/reference.js does it,
//  so the whole feature adds exactly one name to js/bridge.js.

import { closeModal, isModalOpen, registerModal, showOverlay } from './modal.js';
import { MachineGuides } from './machine-guide.js';
import {
  $, App, MachineCategories, MachineTypes, getMachineConfig, isBoundarySymbol,
  isEndmarkerMachine, usesParityPriorities
} from './state.js';
import { summarizeDiff } from './statemate-compile.js';
import { describeSpecSize, testKindFor, transitionFieldsFor } from './statemate-spec.js';
import { Change, subscribe } from './store.js';
import { isMultiTape } from './machines/index.js';
// hasStateOutput: a Moore machine prints on arrival, so its output is a
// state field and the states step grows a column for it. Asked of the
// machine rather than spelled `machine === 'Moore'`, so a second
// state-labelled transducer gets the column without an edit here.
import { hasStateOutput, showStatus } from './utils.js';
import { UI_COPY } from './wizard-copy.js';
import {
  Wizard, addState, addTest, addTransition, applyDraft, beginWizard,
  canvasHasMachine, fieldCopy, isFreeTextField, optionCopy, optionsFor,
  previewCandidate, removeState, removeTest, removeTransition, setDraftMachine,
  setDraftTapeCount, setStart, stateFieldCopy, stepIssues, symbolChoices,
  wizardSteps
} from './wizard.js';

const MODAL_ID = 'wizard-modal';

// ══════════════════════════════════════════════════════════════════
//  SMALL DOM HELPERS
// ══════════════════════════════════════════════════════════════════
//  Local rather than shared: the app has no dom module, and the three
//  functions a builder needs are shorter than the import that would fetch
//  them. They are deliberately identical in shape to the ones in
//  js/statemate-ui.js so the two read the same.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function btn(className, text, onclick, { tip, label } = {}) {
  const node = el('button', className, text);
  node.type = 'button';
  if (tip) node.dataset.tip = tip;
  if (label) node.setAttribute('aria-label', label);
  node.onclick = onclick;
  return node;
}

function icon(path, cls = 'wiz-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

function clear(node) {
  if (!node) return;
  while (node.lastChild) node.removeChild(node.lastChild);
}

// Phosphor, regular weight — the same paths the rest of the app draws these
// acts with, copied rather than approximated.
const ICONS = {
  plusCircle: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm48-88a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z',
  pencil: 'M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z',
  plus: 'M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z',
  trash: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
  caretLeft: 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
  caretRight: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  warn: 'M240.26,186.1,152.81,34.23h0a28.74,28.74,0,0,0-49.62,0L15.74,186.1a27.45,27.45,0,0,0,0,27.71A28.31,28.31,0,0,0,40.55,228h174.9a28.31,28.31,0,0,0,24.81-14.19A27.45,27.45,0,0,0,240.26,186.1Zm-13.87,19.73a12.5,12.5,0,0,1-11,6.17H40.55a12.5,12.5,0,0,1-11-6.17,11.34,11.34,0,0,1,0-11.53L117,42.45a12.74,12.74,0,0,1,22,0l87.44,151.85A11.34,11.34,0,0,1,226.39,205.83ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z',
  info: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z'
};

// A list longer than this gets a filter box. Below it, a filter is a control
// with nothing to do — the whole list is already on screen.
const FILTER_THRESHOLD = 12;

// ══════════════════════════════════════════════════════════════════
//  LIFECYCLE
// ══════════════════════════════════════════════════════════════════

registerModal(MODAL_ID, {
  submit: submitWizard,
  onClose: () => { filters.states = ''; filters.transitions = ''; syncWizardButton(); }
});

subscribe(Change.GRAPH, syncWizardButton);

// Per-step list filters. Not on the draft: they are how the reader is looking
// at it, not part of the machine, and they should not survive a close.
const filters = { states: '', transitions: '' };

// Completion lists already built for the body currently on screen. Cleared on
// every body render, because that is when the old ones stop existing.
let datalistsBuilt = new Set();

/**
 * Open the wizard. Create or edit is read off the canvas, never asked.
 * @param {object}  [opts]
 * @param {boolean} [opts.fresh]  ignore the machine on the canvas
 */
export function openMachineWizard({ fresh = false } = {}) {
  beginWizard({ fresh: !!fresh });
  render();
  showOverlay(MODAL_ID);
  syncWizardButton();
  focusStep();
}

/**
 * The header button, in whichever of its two modes the canvas calls for.
 *
 * Subscribed to Change.GRAPH: drawing the first state turns the button from
 * "build" into "edit", and clearing the canvas turns it back.
 */
export function syncWizardButton() {
  const button = $('machine-wizard-btn');
  if (!button) return;
  const editing = canvasHasMachine();

  button.setAttribute('aria-label', editing ? UI_COPY.editTip : UI_COPY.createTip);
  button.dataset.tip = editing ? UI_COPY.editTitle : UI_COPY.createTitle;
  button.setAttribute('aria-expanded', isWizardOpen() ? 'true' : 'false');

  const path = button.querySelector && button.querySelector('path');
  if (path) path.setAttribute('d', editing ? ICONS.pencil : ICONS.plusCircle);
}

function isWizardOpen() {
  return isModalOpen(MODAL_ID);
}

/**
 * ⏎ inside the dialog. modal.js routes Enter here from any field, so this is
 * also where a field that means something else by it gets first refusal —
 * an "add symbol" box has to add rather than advance the step.
 */
function submitWizard() {
  const active = document.activeElement;
  if (active && typeof active._onEnter === 'function') {
    active._onEnter();
    return;
  }
  goNext();
}

// ══════════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════════

const draft = () => Wizard.draft;
const steps = () => wizardSteps(draft().machine);

function currentStep() {
  const list = steps();
  return list[Math.min(Wizard.step, list.length - 1)];
}

/**
 * Move to a step. Deliberately does *not* mark it seen: arriving at the
 * alphabet question should not greet the reader with "add at least one
 * symbol" before they have had the chance. A step is marked seen when it is
 * left — or when Next is pressed and cannot leave it.
 */
function goTo(index) {
  const list = steps();
  Wizard.step = Math.max(0, Math.min(index, list.length - 1));
  render();
  focusStep();
}

/**
 * Forward, if the answers so far allow it.
 *
 * A blocked Next stays clickable and reveals what is wrong instead of going
 * grey: a disabled button with no explanation is the reader's problem, and
 * they cannot see the validation until the step has been marked seen.
 */
function goNext() {
  const step = currentStep();
  const blocked = stepIssues(draft(), step.id).some(i => i.severity === 'error');
  if (blocked) {
    Wizard.seen.add(step.id);
    render();
    const alert = $('wiz-issues');
    if (alert && alert.scrollIntoView) alert.scrollIntoView({ block: 'nearest' });
    return;
  }
  Wizard.seen.add(step.id);
  if (Wizard.step >= steps().length - 1) create();
  else goTo(Wizard.step + 1);
}

function goBack() {
  if (Wizard.step > 0) goTo(Wizard.step - 1);
}

// ══════════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════════

function render() {
  if (!draft()) return;
  renderTitle();
  renderRail();
  renderBody();
  renderFoot();
}

/** Only the parts that depend on validity — used while typing. */
function refresh() {
  renderIssues();
  renderFoot();
}

function renderTitle() {
  const title = $('wiz-title');
  if (!title) return;
  clear(title);
  title.append(icon(Wizard.mode === 'edit' ? ICONS.pencil : ICONS.plusCircle, 'wiz-title-icon'));
  title.append(el('span', null, Wizard.mode === 'edit' ? UI_COPY.editTitle : UI_COPY.createTitle));
  const badge = el('span', 'wiz-title-badge', MachineTypes[draft().machine]?.label || draft().machine);
  title.append(badge);
}

/**
 * The step rail. Backwards is always allowed; forwards only as far as the
 * answers reach, so the rail cannot be used to skip a question that the Next
 * button would have stopped on.
 */
function renderRail() {
  const rail = $('wiz-rail');
  if (!rail) return;
  clear(rail);

  const list = steps();
  let reachable = true;
  list.forEach((step, i) => {
    const li = el('li', 'wiz-rail-item');
    const done = i < Wizard.step && !stepIssues(draft(), step.id).some(x => x.severity === 'error');
    const item = btn(
      `wiz-rail-step${i === Wizard.step ? ' is-current' : ''}${done ? ' is-done' : ''}${reachable || i <= Wizard.step ? '' : ' is-locked'}`,
      null,
      () => goTo(i)
    );
    item.append(el('span', 'wiz-rail-num', String(i + 1)));
    item.append(el('span', 'wiz-rail-label', step.short));
    if (i === Wizard.step) item.setAttribute('aria-current', 'step');
    if (!reachable && i > Wizard.step) item.disabled = true;
    li.append(item);
    rail.append(li);

    if (stepIssues(draft(), step.id).some(x => x.severity === 'error')) reachable = false;
  });
}

function renderBody() {
  const host = $('wiz-body');
  if (!host) return;
  clear(host);
  datalistsBuilt = new Set();

  const step = currentStep();
  const head = el('div', 'wiz-q');
  head.append(el('h3', 'wiz-question', step.question));
  if (step.description) head.append(el('p', 'wiz-desc', step.description));
  host.append(head);

  if (Wizard.mode === 'edit' && step.id === 'model') {
    host.append(note(ICONS.info, UI_COPY.editNote));
  }

  const builders = {
    model: buildModelStep,
    sigma: () => buildAlphabetStep('sigma'),
    gamma: () => buildAlphabetStep('stackAlpha'),
    delta: () => buildAlphabetStep('outputAlpha'),
    options: buildOptionsStep,
    states: buildStatesStep,
    transitions: buildTransitionsStep,
    describe: buildDescribeStep,
    review: buildReviewStep
  };
  const body = (builders[step.id] || (() => el('div')))();
  host.append(body);

  const issues = el('div', 'wiz-issues', '');
  issues.id = 'wiz-issues';
  issues.setAttribute('role', 'alert');
  host.append(issues);
  renderIssues();
}

/** Everything wrong with the current step, once the reader has been on it. */
function renderIssues() {
  const host = $('wiz-issues');
  if (!host) return;
  clear(host);

  const step = currentStep();
  const list = stepIssues(draft(), step.id)
    .filter(i => i.severity === 'warn' || Wizard.seen.has(step.id));
  if (!list.length) return;

  list.forEach(i => {
    const row = el('div', `wiz-issue is-${i.severity}`);
    row.append(icon(i.severity === 'error' ? ICONS.warn : ICONS.info, 'wiz-issue-icon'));
    row.append(el('span', null, i.message));
    host.append(row);
  });
}

function renderFoot() {
  const foot = $('wiz-foot');
  if (!foot) return;
  clear(foot);

  const list = steps();
  const last = Wizard.step >= list.length - 1;

  const left = el('div', 'modal-foot-group wiz-foot-left');
  left.append(el('span', 'wiz-progress', `Step ${Wizard.step + 1} of ${list.length}`));
  if (Wizard.mode === 'edit' && currentStep().id === 'model') {
    const fresh = btn('wiz-link', UI_COPY.startFresh, () => openMachineWizard({ fresh: true }),
      { tip: UI_COPY.startFreshHint });
    left.append(fresh);
  }
  foot.append(left);

  const right = el('div', 'modal-foot-group');
  const back = btn('btn-g', 'Back', goBack);
  back.disabled = Wizard.step === 0;
  right.append(back);

  const primary = btn('btn-p wiz-primary', null, last ? create : goNext);
  primary.append(el('span', null, last
    ? (Wizard.mode === 'edit' ? 'Update machine' : 'Create machine')
    : 'Next'));
  primary.append(icon(last ? ICONS.check : ICONS.caretRight, 'wiz-btn-icon'));
  right.append(primary);
  foot.append(right);
}

/** A quiet aside — an explanation, never a verdict. */
function note(glyph, text) {
  const row = el('div', 'wiz-note');
  row.append(icon(glyph, 'wiz-note-icon'));
  row.append(el('span', null, text));
  return row;
}

/** A labelled field with its explanation under it. */
function field(labelText, control, hint) {
  const wrap = el('div', 'wiz-field');
  const label = el('label', 'wiz-field-lbl', labelText);
  if (control.id) label.setAttribute('for', control.id);
  wrap.append(label);
  wrap.append(control);
  if (hint) wrap.append(el('p', 'wiz-field-hint', hint));
  return wrap;
}

// ══════════════════════════════════════════════════════════════════
//  STEP: WHICH MACHINE
// ══════════════════════════════════════════════════════════════════

function buildModelStep() {
  const host = el('div', 'wiz-models');

  MachineCategories.forEach(cat => {
    const group = el('div', 'wiz-model-group');
    group.append(el('div', 'wiz-model-group-lbl', cat.label));
    const grid = el('div', 'wiz-model-grid');

    cat.machines.forEach(id => {
      const info = MachineTypes[id];
      if (!info) return;
      const active = draft().machine === id;
      const card = btn(`wiz-model${active ? ' is-active' : ''}`, null, () => {
        if (draft().machine === id) return;
        Wizard.draft = setDraftMachine(draft(), id);
        render();
      });
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
      card.append(el('span', 'wiz-model-name', info.label));
      card.append(el('span', 'wiz-model-full', info.fullName));
      // The one-line "what is this for" every machine already has, in the
      // Reference view. Written once, read in both places.
      const tagline = MachineGuides[id]?.tagline;
      if (tagline) card.append(el('span', 'wiz-model-tag', tagline));
      grid.append(card);
    });

    group.append(grid);
    host.append(group);
  });

  return host;
}

// ══════════════════════════════════════════════════════════════════
//  STEP: THE ALPHABETS
// ══════════════════════════════════════════════════════════════════
//  One builder for all three. Which symbols may not be removed is the only
//  thing that differs, and that is a property of the symbol rather than of
//  the field: Z holds the bottom of a stack, ⊔ is the blank, ⊢ and ⊣ bound
//  an LBA's tape, and none of the three is the reader's to delete.

function lockedSymbol(machine, key, symbol) {
  const sym = App.config.sym;
  if (key !== 'stackAlpha') return false;
  const cfg = getMachineConfig(machine);
  if (cfg.hasTape && symbol === sym.blank) return true;
  if (!cfg.hasTape && symbol === sym.stackBottom) return true;
  return isEndmarkerMachine(machine) && isBoundarySymbol(symbol);
}

/** Why a symbol cannot be removed — said on the chip rather than on refusal. */
function lockedNote(symbol) {
  const sym = App.config.sym;
  if (symbol === sym.stackBottom) return 'marks the bottom of the stack';
  if (symbol === sym.blank) return 'the blank cell';
  if (symbol === sym.leftMarker) return 'left end of the tape';
  if (symbol === sym.rightMarker) return 'right end of the tape';
  return '';
}

function buildAlphabetStep(key) {
  const host = el('div', 'wiz-alphabet');

  const chips = el('div', 'wiz-chips');
  chips.id = 'wiz-chips';
  host.append(chips);

  const row = el('div', 'wiz-add-row');
  const input = el('input', 'inp');
  input.type = 'text';
  input.placeholder = 'a, b, c';
  input.setAttribute('aria-label', 'Add symbols');
  input.autocomplete = 'off';

  const commit = () => {
    const raw = String(input.value || '');
    if (!raw.trim()) return;
    const blocked = [];
    raw.split(/[,\s]+/).forEach(s => {
      const value = s.trim();
      if (!value) return;
      // The boundary markers belong to the tape, never to an alphabet the
      // reader edits — the same rule js/alphabet.js applies to the Σ panel.
      if (key === 'sigma' && isBoundarySymbol(value)) { blocked.push(value); return; }
      if (!draft()[key].includes(value)) draft()[key].push(value);
    });
    input.value = '';
    if (blocked.length) showStatus(`${blocked.join(' ')} — boundary markers are reserved for the tape.`);
    renderChips(chips, key);
    refresh();
  };
  input._onEnter = commit;

  const add = btn('ibtn', null, commit, { label: 'Add symbols' });
  add.append(icon(ICONS.plus, 'wiz-icon-sm'));

  row.append(input);
  row.append(add);
  host.append(row);

  const step = currentStep();
  if (step.examples && step.examples.length) {
    const tries = el('div', 'wiz-examples');
    tries.append(el('span', 'wiz-examples-lbl', 'For example'));
    step.examples.forEach(ex => {
      const chip = btn('wiz-example', ex.label, () => {
        input.value = ex.label;
        commit();
      }, { tip: ex.hint });
      tries.append(chip);
    });
    host.append(tries);
  }

  renderChips(chips, key);
  return host;
}

function renderChips(host, key) {
  clear(host);
  const machine = draft().machine;
  const list = draft()[key] || [];

  if (!list.length) {
    host.append(el('div', 'empty-msg', 'No symbols yet.'));
    return;
  }

  list.forEach(symbol => {
    const locked = lockedSymbol(machine, key, symbol);
    const chip = el('div', `chip${locked ? ' is-locked' : ''}`);
    chip.append(el('span', 'wiz-chip-sym', symbol));
    if (locked) {
      const why = lockedNote(symbol);
      if (why) chip.dataset.tip = why;
    } else {
      const x = btn('x', null, () => {
        draft()[key] = draft()[key].filter(s => s !== symbol);
        renderChips(host, key);
        refresh();
      }, { label: `Remove ${symbol}` });
      x.append(icon(ICONS.trash, 'wiz-chip-x'));
      chip.append(x);
    }
    host.append(chip);
  });
}

// ══════════════════════════════════════════════════════════════════
//  STEP: MACHINE OPTIONS
// ══════════════════════════════════════════════════════════════════

function buildOptionsStep() {
  const host = el('div', 'wiz-options');

  optionsFor(draft().machine).forEach(name => {
    const copy = optionCopy(name);

    if (name === 'tapeCount') {
      const select = el('select', 'sel');
      select.id = 'wiz-tape-count';
      [2, 3, 4].forEach(n => {
        const opt = el('option', null, `${n} tapes`);
        opt.value = String(n);
        if (Number(draft().tapeCount) === n) opt.selected = true;
        select.append(opt);
      });
      select.onchange = () => { setDraftTapeCount(draft(), select.value); refresh(); };
      host.append(field(copy.label, select, copy.hint));
    }

    if (name === 'cutPoint') {
      const input = el('input', 'inp');
      input.id = 'wiz-cut-point';
      input.type = 'number';
      input.min = '0'; input.max = '1'; input.step = '0.05';
      input.value = String(draft().cutPoint ?? 0.5);
      input.oninput = () => { draft().cutPoint = Number(input.value); refresh(); };
      host.append(field(copy.label, input, copy.hint));
    }

    if (name === 'twoWayTape') {
      const label = el('label', 'toggle-switch');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !!draft().twoWayTape;
      box.onchange = () => { draft().twoWayTape = !!box.checked; };
      const track = el('span', 'toggle-track');
      track.append(el('span', 'toggle-thumb'));
      label.append(box);
      label.append(track);
      host.append(field(copy.label, label, copy.hint));
    }
  });

  return host;
}

// ══════════════════════════════════════════════════════════════════
//  STEP: STATES
// ══════════════════════════════════════════════════════════════════

/**
 * A filter box, but only once the list is long enough for one to be worth
 * looking at. A three-state machine — which is most of them, and all of the
 * ones this feature exists for — never sees this control.
 */
function listFilter(kind, count, onChange) {
  if (count <= FILTER_THRESHOLD) return null;
  const wrap = el('div', 'wiz-filter');
  const input = el('input', 'inp');
  input.type = 'search';
  input.placeholder = `Filter ${count} rows`;
  input.value = filters[kind];
  input.setAttribute('aria-label', `Filter ${kind}`);
  input.oninput = () => { filters[kind] = input.value; onChange(); };
  // ⏎ in a filter means "I am done filtering", not "next step".
  input._onEnter = () => {};
  wrap.append(input);
  return wrap;
}

function buildStatesStep() {
  const machine = draft().machine;
  // Moore adds a column, and the header row has to move with it — the grid
  // template is on the container so both stay in step.
  const host = el('div', `wiz-states${hasStateOutput(machine) ? ' has-out' : ''}`);

  const rows = el('div', 'wiz-rows');
  rows.id = 'wiz-state-rows';

  const filter = listFilter('states', draft().states.length, () => renderStateRows(rows));
  if (filter) host.append(filter);

  const parityHead = usesParityPriorities(machine);
  const head = el('div', 'wiz-row wiz-row-head wiz-state-row');
  head.append(headCell(stateFieldCopy(machine, 'start')));
  head.append(headCell(stateFieldCopy(machine, 'name')));
  head.append(headCell(stateFieldCopy(machine, parityHead ? 'priority' : 'accept')));
  if (hasStateOutput(machine)) head.append(headCell(stateFieldCopy(machine, 'out')));
  head.append(el('span', 'wiz-row-spacer'));
  host.append(head);

  host.append(rows);
  renderStateRows(rows);

  const add = btn('wiz-add-btn', null, () => {
    addState(draft());
    renderStateRows(rows);
    refresh();
  });
  add.append(icon(ICONS.plus, 'wiz-btn-icon'));
  add.append(el('span', null, 'Add a state'));
  host.append(add);

  return host;
}

function headCell(copy) {
  const cell = el('span', 'wiz-col-lbl', copy.label);
  if (copy.hint) cell.dataset.tip = copy.hint;
  return cell;
}

function renderStateRows(host) {
  clear(host);
  const machine = draft().machine;
  const parity = usesParityPriorities(machine);
  const query = filters.states.trim().toLowerCase();
  const shown = draft().states.filter(s => !query || String(s.name || '').toLowerCase().includes(query));

  if (!shown.length) {
    host.append(el('div', 'empty-msg', query ? 'No state matches that.' : UI_COPY.emptyStates));
    return;
  }

  shown.forEach(state => {
    const row = el('div', 'wiz-row wiz-state-row');

    const start = el('input');
    start.type = 'radio';
    start.name = 'wiz-start';
    start.className = 'wiz-radio';
    start.checked = !!state.start;
    start.setAttribute('aria-label', `${state.name || 'This state'} is the start state`);
    start.onchange = () => { setStart(draft(), state.key); renderStateRows(host); refresh(); };
    row.append(start);

    const name = el('input', 'inp wiz-name');
    name.type = 'text';
    name.value = state.name || '';
    name.maxLength = 24;
    name.placeholder = 'name';
    name.setAttribute('aria-label', 'State name');
    name.oninput = () => { state.name = name.value; refresh(); };
    row.append(name);

    if (parity) {
      const priority = el('input', 'inp wiz-num');
      priority.type = 'number';
      priority.min = '0';
      priority.step = '1';
      priority.value = String(state.priority ?? 0);
      priority.setAttribute('aria-label', 'Priority');
      priority.oninput = () => { state.priority = Number(priority.value); refresh(); };
      row.append(priority);
    } else {
      const accept = el('label', 'wiz-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !!state.accept;
      box.onchange = () => { state.accept = !!box.checked; refresh(); };
      accept.append(box);
      accept.append(el('span', null, 'Accepting'));
      row.append(accept);
    }

    if (hasStateOutput(machine)) {
      const out = el('input', 'inp wiz-out');
      out.type = 'text';
      out.value = state.out ?? '';
      out.placeholder = 'prints';
      out.setAttribute('aria-label', 'Output printed in this state');
      out.oninput = () => { state.out = out.value; refresh(); };
      row.append(out);
    }

    const del = btn('wiz-row-del', null, () => {
      removeState(draft(), state.key);
      renderStateRows(host);
      refresh();
    }, { label: `Remove state ${state.name || ''}`.trim() });
    del.append(icon(ICONS.trash, 'wiz-icon-sm'));
    del.disabled = draft().states.length <= 1;
    row.append(del);

    host.append(row);
  });
}

// ══════════════════════════════════════════════════════════════════
//  STEP: TRANSITIONS
// ══════════════════════════════════════════════════════════════════
//  The step people drown in, so it is the one that helps most: every symbol
//  is picked out of the alphabet declared two screens ago, and every state
//  out of the list declared one screen ago. A symbol that is not in Σ cannot
//  be typed into a rule by accident, which is the commonest way a
//  hand-built machine silently rejects everything.

/** The columns for this machine, in reading order, from the spec's own list. */
function transitionColumns(machine) {
  const fields = transitionFieldsFor(machine);
  const extras = fields.filter(f => !['from', 'to', 'on'].includes(f));
  return ['from', 'on', ...extras, 'to'];
}

function buildTransitionsStep() {
  const host = el('div', 'wiz-transitions');
  const machine = draft().machine;
  const multiTape = isMultiTape(machine);

  const rows = el('div', 'wiz-rows');
  rows.id = 'wiz-trans-rows';

  const filter = listFilter('transitions', draft().transitions.length, () => renderTransitionRows(rows));
  if (filter) host.append(filter);

  if (!multiTape) {
    const head = el('div', 'wiz-row wiz-row-head wiz-trans-row');
    head.style.setProperty('--wiz-cols', String(transitionColumns(machine).length));
    transitionColumns(machine).forEach(f => head.append(headCell(fieldCopy(machine, f))));
    head.append(el('span', 'wiz-row-spacer'));
    host.append(head);
  }

  host.append(rows);
  renderTransitionRows(rows);

  const add = btn('wiz-add-btn', null, () => {
    addTransition(draft());
    renderTransitionRows(rows);
    refresh();
  });
  add.append(icon(ICONS.plus, 'wiz-btn-icon'));
  add.append(el('span', null, 'Add a transition'));
  host.append(add);

  return host;
}

function renderTransitionRows(host) {
  clear(host);
  const machine = draft().machine;
  const query = filters.transitions.trim().toLowerCase();
  const nameOf = key => draft().states.find(s => s.key === key)?.name || '';

  const shown = draft().transitions.filter(t => {
    if (!query) return true;
    return `${nameOf(t.from)} ${t.on} ${nameOf(t.to)}`.toLowerCase().includes(query);
  });

  if (!shown.length) {
    host.append(el('div', 'empty-msg', query ? 'No rule matches that.' : UI_COPY.emptyTransitions));
    return;
  }

  shown.forEach(t => {
    host.append(isMultiTape(machine) ? multiTapeRow(t, host) : simpleRow(t, host));
  });
}

function simpleRow(t, host) {
  const machine = draft().machine;
  const row = el('div', 'wiz-row wiz-trans-row');
  const columns = transitionColumns(machine);
  row.style.setProperty('--wiz-cols', String(columns.length));

  columns.forEach(f => row.append(transitionCell(t, f)));

  const del = btn('wiz-row-del', null, () => {
    removeTransition(draft(), t.key);
    renderTransitionRows(host);
    refresh();
  }, { label: 'Remove this transition' });
  del.append(icon(ICONS.trash, 'wiz-icon-sm'));
  row.append(del);
  return row;
}

/**
 * A multi-tape rule is not a row. Every tape has its own read, write and
 * direction, so a 4-tape machine has fourteen fields — laid out flat they
 * are a horizontal scroll bar with a machine somewhere inside it.
 */
function multiTapeRow(t, host) {
  const block = el('div', 'wiz-tape-block');

  const top = el('div', 'wiz-row wiz-tape-top');
  top.append(transitionCell(t, 'from'));
  top.append(el('span', 'wiz-arrow', '→'));
  top.append(transitionCell(t, 'to'));
  const del = btn('wiz-row-del', null, () => {
    removeTransition(draft(), t.key);
    renderTransitionRows(host);
    refresh();
  }, { label: 'Remove this transition' });
  del.append(icon(ICONS.trash, 'wiz-icon-sm'));
  top.append(del);
  block.append(top);

  const count = draft().tapeCount || 2;
  for (let i = 0; i < count; i++) {
    const line = el('div', 'wiz-row wiz-tape-line');
    line.append(el('span', 'wiz-tape-lbl', `Tape ${i + 1}`));
    line.append(arrayCell(t, 'tapeSyms', i));
    line.append(el('span', 'wiz-arrow', '→'));
    line.append(arrayCell(t, 'tapeWrites', i));
    line.append(arrayCell(t, 'tapeDirs', i));
    block.append(line);
  }
  return block;
}

/** One field of one transition, as whichever control its values call for. */
function transitionCell(t, f) {
  const machine = draft().machine;
  const copy = fieldCopy(machine, f);

  if (f === 'from' || f === 'to') {
    const select = el('select', 'sel');
    draft().states.forEach(s => {
      const opt = el('option', null, s.name || '(unnamed)');
      opt.value = s.key;
      if (t[f] === s.key) opt.selected = true;
      select.append(opt);
    });
    select.setAttribute('aria-label', copy.label);
    select.onchange = () => { t[f] = select.value; refresh(); };
    return select;
  }

  if (f === 'move') return directionSelect(t.move, v => { t.move = v; refresh(); }, copy.label);

  if (f === 'weight') {
    const input = el('input', 'inp wiz-num');
    input.type = 'number';
    input.min = '0'; input.max = '1'; input.step = '0.05';
    input.value = String(t.weight ?? 1);
    input.setAttribute('aria-label', copy.label);
    input.oninput = () => { t.weight = Number(input.value); refresh(); };
    return input;
  }

  if (isFreeTextField(f)) {
    // A push may be several stack symbols at once and an output may be a
    // word, so these are typed rather than chosen — with the alphabet
    // offered as completions rather than as the only options.
    const input = el('input', 'inp');
    input.type = 'text';
    input.value = t[f] ?? '';
    input.placeholder = App.config.sym.eps;
    input.setAttribute('aria-label', copy.label);
    input.setAttribute('list', datalistFor(f));
    input.oninput = () => { t[f] = input.value; refresh(); };
    input._onEnter = () => {};
    return input;
  }

  return symbolSelect(symbolChoices(draft(), f, t[f]), t[f], v => { t[f] = v; refresh(); }, copy.label);
}

function arrayCell(t, f, index) {
  const copy = fieldCopy(draft().machine, f);
  const label = `${copy.label}, tape ${index + 1}`;
  if (f === 'tapeDirs') {
    return directionSelect(t.tapeDirs[index], v => { t.tapeDirs[index] = v; refresh(); }, label);
  }
  const value = t[f][index];
  return symbolSelect(symbolChoices(draft(), f, value), value, v => { t[f][index] = v; refresh(); }, label);
}

function symbolSelect(choices, value, onChange, label) {
  const select = el('select', 'sel wiz-sym');
  choices.forEach(c => {
    const opt = el('option', null, c.note ? `${c.label}  ·  ${c.note}` : c.label);
    opt.value = c.value;
    if (c.value === value) opt.selected = true;
    select.append(opt);
  });
  select.setAttribute('aria-label', label);
  select.onchange = () => onChange(select.value);
  return select;
}

function directionSelect(value, onChange, label) {
  const select = el('select', 'sel wiz-dir');
  App.directions.forEach(d => {
    const opt = el('option', null, d.label);
    opt.value = d.value;
    if (d.value === value) opt.selected = true;
    select.append(opt);
  });
  select.setAttribute('aria-label', label);
  select.onchange = () => onChange(select.value);
  return select;
}

/**
 * The completion list behind a free-text field.
 *
 * Built once per body render and shared by every row that wants it — one per
 * cell would put a dozen elements with the same id in the document, which is
 * both invalid and a coin toss over which one a field actually gets.
 */
function datalistFor(f) {
  const id = `wiz-dl-${f}`;
  const host = $('wiz-body');
  if (!host || datalistsBuilt.has(id)) return id;
  datalistsBuilt.add(id);

  const values = f === 'out'
    ? (draft().outputAlpha || [])
    : (draft().stackAlpha || []);
  const list = el('datalist');
  list.id = id;
  values.forEach(v => {
    const opt = el('option');
    opt.value = v;
    list.append(opt);
  });
  host.append(list);
  return id;
}

// ══════════════════════════════════════════════════════════════════
//  STEP: DESCRIBE
// ══════════════════════════════════════════════════════════════════

function buildDescribeStep() {
  const host = el('div', 'wiz-describe');
  const meta = draft().meta;

  const title = el('input', 'inp');
  title.id = 'wiz-meta-title';
  title.type = 'text';
  title.value = meta.title || '';
  title.placeholder = 'Divisible by five';
  title.oninput = () => { meta.title = title.value; };
  title._onEnter = () => {};
  host.append(field('Title', title, 'A few words naming what this machine is for.'));

  const blurb = el('textarea', 'inp wiz-blurb');
  blurb.id = 'wiz-meta-blurb';
  blurb.rows = 3;
  blurb.value = meta.blurb || '';
  blurb.placeholder = 'Reads a binary number and accepts when it divides by five.';
  blurb.oninput = () => { meta.blurb = blurb.value; };
  host.append(field('Description', blurb, 'One or two sentences, for whoever opens this next — including you, later.'));

  const words = el('div', 'wiz-tests');
  words.id = 'wiz-test-rows';
  renderTestRows(words);

  const wrap = el('div', 'wiz-field');
  wrap.append(el('label', 'wiz-field-lbl', UI_COPY.wordsLabel));
  wrap.append(words);
  const add = btn('wiz-add-btn', null, () => { addTest(draft()); renderTestRows(words); });
  add.append(icon(ICONS.plus, 'wiz-btn-icon'));
  add.append(el('span', null, 'Add a test word'));
  wrap.append(add);
  wrap.append(el('p', 'wiz-field-hint', UI_COPY.wordsHint));
  host.append(wrap);

  return host;
}

function renderTestRows(host) {
  clear(host);
  const machine = draft().machine;
  const kind = testKindFor(machine);
  const tests = draft().meta.tests;

  tests.forEach(test => {
    const row = el('div', 'wiz-row wiz-test-row');

    const word = el('input', 'inp');
    word.type = 'text';
    word.value = test.w ?? '';
    word.placeholder = kind === 'omega' ? 'ab(ba)' : 'word';
    word.setAttribute('aria-label', 'Test word');
    word.oninput = () => { test.w = word.value; };
    word._onEnter = () => {};
    row.append(word);

    if (kind === 'output') {
      const out = el('input', 'inp');
      out.type = 'text';
      out.value = test.out ?? '';
      out.placeholder = 'expected output';
      out.setAttribute('aria-label', 'Expected output');
      out.oninput = () => { test.out = out.value; };
      out._onEnter = () => {};
      row.append(out);
    } else {
      const expect = el('select', 'sel');
      [['accept', 'should be accepted'], ['reject', 'should be rejected']].forEach(([v, text]) => {
        const opt = el('option', null, text);
        opt.value = v;
        if ((test.expect || 'accept') === v) opt.selected = true;
        expect.append(opt);
      });
      expect.setAttribute('aria-label', 'Expected verdict');
      expect.onchange = () => { test.expect = expect.value; };
      row.append(expect);
    }

    const del = btn('wiz-row-del', null, () => { removeTest(draft(), test.key); renderTestRows(host); },
      { label: 'Remove this test word' });
    del.append(icon(ICONS.trash, 'wiz-icon-sm'));
    row.append(del);

    host.append(row);
  });

  if (!tests.length) host.append(el('div', 'empty-msg', 'None yet.'));
}

// ══════════════════════════════════════════════════════════════════
//  STEP: REVIEW
// ══════════════════════════════════════════════════════════════════

function buildReviewStep() {
  const host = el('div', 'wiz-review');
  const preview = previewCandidate(draft());

  if (preview.error) {
    const box = el('div', 'wiz-issue is-error');
    box.append(icon(ICONS.warn, 'wiz-issue-icon'));
    box.append(el('span', null, preview.error.message || 'This machine cannot be built yet.'));
    host.append(box);
    return host;
  }

  const summary = el('div', 'wiz-summary');
  const machine = MachineTypes[draft().machine];
  summary.append(el('span', 'wiz-summary-machine', machine?.fullName || draft().machine));
  summary.append(el('span', 'wiz-summary-size', describeSpecSize({
    states: draft().states,
    transitions: draft().transitions
  })));
  host.append(summary);

  if (Wizard.mode === 'edit' && preview.diff) {
    const chips = el('div', 'wiz-diff');
    summarizeDiff(preview.diff).forEach(text => chips.append(el('span', 'wiz-diff-chip', text)));
    host.append(chips);
  }

  // Where it lands. In edit mode it replaces the machine it was filled in
  // from; a fresh build over an existing machine goes to a tab of its own,
  // because nothing the reader drew should disappear behind a wizard.
  const newTab = Wizard.mode === 'create' && canvasHasMachine();
  host.append(note(ICONS.info, newTab
    ? 'Your canvas already has a machine, so this one opens in a new tab and leaves it alone.'
    : Wizard.mode === 'edit'
      ? 'This replaces the machine on your canvas. States you did not touch keep their place in the diagram, and one Ctrl+Z puts everything back.'
      : 'This draws onto your canvas. One Ctrl+Z puts it back.'));

  if (preview.findings.length) {
    const list = el('ul', 'wiz-findings');
    // Worst first: what would stop the build has to be read before what is
    // merely worth knowing.
    const order = { repair: 0, warn: 1, fix: 2 };
    [...preview.findings]
      .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
      .forEach(f => {
        const item = el('li', `wiz-finding is-${f.severity}`);
        item.append(icon(f.severity === 'repair' ? ICONS.warn : ICONS.info, 'wiz-issue-icon'));
        const text = f.inherited
          ? `${f.message} (already true of the machine on your canvas)`
          : f.message;
        item.append(el('span', null, text));
        list.append(item);
      });
    host.append(list);
  }

  return host;
}

// ══════════════════════════════════════════════════════════════════
//  CREATE
// ══════════════════════════════════════════════════════════════════

function create() {
  const openNewTab = Wizard.mode === 'create' && canvasHasMachine();
  const result = applyDraft(draft(), { openNewTab });

  if (!result.ok) {
    Wizard.seen.add('review');
    Wizard.step = steps().length - 1;
    render();
    const host = $('wiz-issues');
    if (host) {
      clear(host);
      const row = el('div', 'wiz-issue is-error');
      row.append(icon(ICONS.warn, 'wiz-issue-icon'));
      row.append(el('span', null, result.error?.message || 'That machine could not be built.'));
      host.append(row);
    }
    return;
  }

  // The draft has become a machine; the next opening should read the canvas
  // rather than resume answers that have already been spent.
  Wizard.draft = null;
  Wizard.signature = '';
  closeWizard();
  showStatus(result.newTab
    ? 'Machine created in a new tab'
    : Wizard.mode === 'edit' ? 'Machine updated' : 'Machine created');
  syncWizardButton();
}

function closeWizard() {
  if (isModalOpen(MODAL_ID)) closeModal(MODAL_ID);
}

/**
 * Test seam: move to a step and draw it.
 *
 * The step builders are the part of this module most likely to break silently
 * — a machine whose fields do not match what a builder expects throws in a
 * dialog nobody has open — so the suite walks every step of every machine
 * through this rather than through the buttons.
 */
export function _showWizardStep(index) {
  goTo(index);
}

/** Put the caret where the step's first question is. */
function focusStep() {
  const host = $('wiz-body');
  if (!host || !host.querySelector) return;
  const first = host.querySelector('input:not([type=radio]), select, textarea, button');
  if (first && first.focus) first.focus();
}
