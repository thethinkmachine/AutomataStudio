// The Workspace panel's Machine section: the parameters a machine has beyond
// its alphabets and its graph.
//
// How many tapes, whether the tape runs left of the input, a PFA's cut-point.
// Each is a component of the machine's tuple — k in Γᵏ, λ in the acceptance
// condition — and each used to live somewhere different: the tape count in a
// row at the foot of the Language card, the other two in two different tabs of
// the Settings dialog, which is the app's place for *preferences*. The reader
// changing what their machine decides was sent to the same dialog as the one
// that changes the theme.
//
// The rows are not a list kept here. Every machine already declares its
// `options` (js/machines/*.js) and the wizard already builds its options step
// from them, so this reads the same declaration: a machine added with an
// option gets a row, and one with none — a DFA, most of them — has no section
// at all, rather than an empty one.
//
// Listeners are attached at creation, the way js/reference.js does it, so the
// section adds nothing to `bridge.js`.

import { $, App } from './state.js';
import { machineOptions } from './machines/index.js';
import { OPTION_COPY } from './wizard-copy.js';
import { setTapeCount, syncTapeCountUI } from './view.js';
import { snapshot } from './history.js';
import { resetSim } from './simulation.js';
import { Change, emit, subscribe } from './store.js';
import { setSectionStatus } from './section-status.js';
import { showStatus } from './utils.js';

/**
 * What each row is called in the panel. The wizard asks questions ("How many
 * tapes?"); a panel row is a label, so the short form lives here and the
 * wizard's explanation rides on the tooltip.
 */
const ROW_LABELS = Object.freeze({
  tapeCount: 'Tapes',
  twoWayTape: 'Two-way tape',
  cutPoint: 'Cut-point λ'
});

/** The machine and option list the rows were last built for. */
let builtFor = null;

function row(name, control) {
  const wrap = document.createElement('div');
  wrap.className = 'mopt';
  const label = document.createElement('label');
  label.className = 'mopt-lbl';
  label.textContent = ROW_LABELS[name] || name;
  if (control.id) label.htmlFor = control.id;
  const hint = OPTION_COPY[name] && OPTION_COPY[name].hint;
  if (hint) label.setAttribute('data-tip', hint);
  wrap.appendChild(label);
  wrap.appendChild(control.el || control);
  return wrap;
}

function tapeCountControl() {
  const select = document.createElement('select');
  select.className = 'sel mopt-sel';
  // The id the picker has always had: syncTapeCountUI fills it, the undo path
  // writes it, and the multi-tape tests address it by name.
  select.id = 'tape-count-sel';
  select.setAttribute('aria-label', 'Number of tapes');
  select.addEventListener('change', () => setTapeCount(select.value));
  return select;
}

function twoWayControl() {
  const label = document.createElement('label');
  label.className = 'toggle-switch';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'mopt-two-way';
  box.setAttribute('aria-label', 'Two-way infinite tape');
  box.addEventListener('change', () => setTwoWayTape(box.checked));
  const track = document.createElement('span');
  track.className = 'toggle-track';
  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';
  track.appendChild(thumb);
  label.appendChild(box);
  label.appendChild(track);
  return { el: label, id: box.id };
}

function cutPointControl() {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'inp mopt-num';
  input.id = 'mopt-cut-point';
  input.min = '0';
  input.max = '1';
  input.step = '0.05';
  // `change`, not `input`: every value is an undo point and a re-decided
  // language panel, and typing "0.75" is not three edits.
  input.addEventListener('change', () => setCutPoint(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  return input;
}

const CONTROLS = Object.freeze({
  tapeCount: tapeCountControl,
  twoWayTape: twoWayControl,
  cutPoint: cutPointControl
});

/**
 * Shows the section for a machine that has options, fills it, and says what
 * they are while it is folded.
 *
 * Rebuilt only when the list of options changes — a machine switch — and
 * otherwise only re-read, because this runs on every graph change (an undo can
 * restore any of these) and a rebuild would take the focus out of a field the
 * reader is typing in.
 */
export function renderMachineOptions() {
  const sec = $('lp-machine');
  const host = $('machine-opts');
  if (!sec || !host) return;
  const names = machineOptions(App.machine).filter(name => CONTROLS[name]);
  sec.style.display = names.length ? '' : 'none';

  const key = names.join(',');
  if (key !== builtFor || !host.firstChild) {
    host.innerHTML = '';
    names.forEach(name => host.appendChild(row(name, CONTROLS[name]())));
    builtFor = key;
  }
  syncMachineOptionValues();
}

/** Puts the machine's values into the controls, and into the folded header. */
export function syncMachineOptionValues() {
  const names = machineOptions(App.machine);
  const said = [];
  if (names.includes('tapeCount')) {
    syncTapeCountUI();
    said.push(`${App.tapeCount} tapes`);
  }
  if (names.includes('twoWayTape')) {
    const box = $('mopt-two-way');
    if (box) box.checked = !!App.config.twoWayTape;
    said.push(App.config.twoWayTape ? 'two-way' : 'one-way');
  }
  if (names.includes('cutPoint')) {
    const input = $('mopt-cut-point');
    const cut = App.config.pfaCutPoint ?? 0.5;
    // Not while the reader is in it: a re-render mid-edit would put back the
    // value they are in the middle of replacing.
    if (input && document.activeElement !== input) input.value = String(cut);
    said.push(`λ ${cut}`);
  }
  setSectionStatus('lp-machine', said.join(' · '));
}

/**
 * Whether the tape extends left of the input.
 *
 * An edit to the machine rather than a preference — it changes what a run
 * decides, which is why it travels with the workspace — so it is an undo
 * point, the run on screen is dropped, and the change is announced like any
 * other edit.
 */
export function setTwoWayTape(on) {
  const next = !!on;
  if (!!App.config.twoWayTape === next) return;
  snapshot();
  App.config.twoWayTape = next;
  resetSim();
  emit(Change.GRAPH);
  showStatus(next ? 'Tape extends left of the input' : 'Tape starts at the input');
}

/**
 * A PFA's cut-point. Clamped to [0, 1]: outside it the threshold can never be
 * crossed one way or the other, and every word would accept or every word
 * reject — the same clamp the Settings dialog applied when this lived there.
 */
export function setCutPoint(value) {
  const n = parseFloat(value);
  const next = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  if ((App.config.pfaCutPoint ?? 0.5) === next) { syncMachineOptionValues(); return; }
  snapshot();
  App.config.pfaCutPoint = next;
  resetSim();
  emit(Change.GRAPH);
  showStatus(`Cut-point λ = ${next}`);
}

/** Drops the build memo between tests; the section's DOM is the stub's. */
export function resetMachineOptions() {
  builtFor = null;
}

subscribe(Change.GRAPH, renderMachineOptions);
