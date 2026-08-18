// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — THE CONSOLE
// ══════════════════════════════════════════════════════════════════
//  A session, not a picker.
//
//  The dialog this replaces was a command palette: one input that meant two
//  things, with the model offered as a row among the examples and the exact
//  algorithms. It searched when you wanted it to build, and the way to reach
//  the model at all was to notice a highlighted row or know about ⌘⏎. The
//  input had no single answer to "what does ⏎ do".
//
//  Here it has exactly one: **⏎ sends what you typed to StateMate**. Anything
//  that is not a prompt is a slash command, which is the only thing that ever
//  takes the keystroke back — and only while the line starts with a slash, so
//  the ambiguity is visible in the text you are looking at.
//
//    · the transcript is the surface: what you asked, what was built, what
//      the checks said, and the buttons to apply it or throw it away
//    · the composer is one line with one meaning, and the status bar under it
//      says what the next ⏎ will do — machine, canvas, authority, model
//    · /examples still browses the bundled machines, so with no API key
//      configured this is the example picker it has always also been
//    · an exact construction ("minimize") is offered as a note above the
//      composer rather than a row that steals ⏎: algorithms-fa.js is correct
//      and a model is only usually correct, but that is a reason to offer the
//      tool, not a reason to reinterpret what you typed
//
//  **There is exactly one setting here, and it is write authority** — ask,
//  propose, auto, on Shift+Tab. Everything else about a turn is inferred:
//  whether it is about the machine on the canvas (turnIntent), and whether it
//  wants an answer or an edit (the model decides, from the prompt). The rule
//  is the one Claude Code follows — a model may infer what you meant, but not
//  how much of your work it is allowed to overwrite.
//
//  The panel is docked to the bottom and drops the overlay's scrim, because
//  the machine is drawn on the canvas behind it — a dialog that hides its own
//  result is one you have to dismiss to use. It stays open across turns for
//  the same reason the transcript exists: the second prompt is usually a
//  correction to the first.
//
//  **And it is a dock rather than a dialog**, which is the same sentence
//  carried through to the pointer: the canvas behind it is live. Click a
//  state, pan, zoom, run a word, with the conversation about it still open.
//  Registered with `dock: true` (js/modal.js), which gives up the scroll lock,
//  the Tab trap and the `anyModalOpen()` gate; the overlay gives up
//  pointer-events and the panel takes them back (css/modals.css). Nothing was
//  gained by blocking — the diagram was visible and inert, and a click meant
//  to select a state dismissed the console instead. The status line hears
//  about what happens out there through the store, which is how a selection
//  made *while* the console is open reaches the context basket.
//
//  **And a dock can be put away without being closed.** Minimizing collapses
//  the panel to its header strip; the transcript, the thread, a held proposal
//  and a request in flight all survive it, because none of them live in the
//  DOM. Closing is the destructive one — its teardown interrupts a run — which
//  is why the ✕ keeps its place beside the caret rather than being replaced by
//  it, and why opening always restores: the strip is a way to put the console
//  aside, not a state to come back to.
//
//  Two rules follow from the transcript being a thing people read rather than
//  watch. **It is diffed, not rebuilt** — entries are keyed by object identity
//  in `Session.nodes`, so an open diff, a text selection and a typeset formula
//  survive the next stage event. And **it follows its tail only while the
//  reader is at it**: scrolling up is a decision, and a streaming reply must
//  not undo it token by token.
//
//  Nothing here is reached from an on* attribute. Listeners are attached at
//  creation, the way reference.js does it, so the feature adds exactly one
//  name to bridge.js — the entry point the header button calls.

import { hlState } from './canvas.js';
import { closeModal, isModalOpen, registerModal, showOverlay } from './modal.js';
import { $, App, getMachineConfig } from './state.js';
import { undo } from './history.js';
import { renderMarkdown } from './markdown.js';
import { resolveNoteAnchorsForContext } from './notes.js';
import { triggerMath } from './reference.js';
import {
  filterMachineExampleOptions, getMachineExampleOptions, loadExampleFile,
  showExampleCard
} from './persistence.js';
import {
  AUTHORITIES, applyPending, cancelStateMate, clearThread, describeError,
  getThread, hasCheckpoint, hasWarnings, isStateMateRunning, machineSignature,
  relayoutLastResult, removeTurn, restoreCheckpoint, resultMetaBits, resultNotes,
  runStateMate, selectSibling, siblingsOf, testHint, verdictLabel
} from './statemate.js';
import { summarizeDiff } from './statemate-compile.js';
import {
  PROVIDERS, getStateMateSettings, isStateMateReady, providerConfig,
  resolveEndpoint, saveStateMateSettings, testConnection
} from './statemate-provider.js';
import { editStarterPrompts, starterPrompts } from './statemate-prompt.js';
import { describeSpecSize, resolveContextRefs } from './statemate-spec.js';
import { Change, emit, subscribe } from './store.js';
import { fitToScreen, openSettingsModal, repositionCanvasInfo, switchSettingsTab } from './ui.js';
import { showStatus } from './utils.js';
import { setView } from './view.js';

const MODAL_ID = 'statemate-modal';

// The console's own state. `log` is the transcript; it is rebuilt from the
// retained thread whenever the two disagree, so a run started from anywhere
// else — or a machine type switch, which drops the thread — is reflected here
// rather than silently diverging.
const Session = {
  log: [],
  authority: 'propose', // 'ask' | 'propose' | 'auto' — see AUTHORITY_COPY
  busy: false,          // a request is in flight, from the console's side
  attachCanvas: null,   // null = the setting
  examples: [],
  exampleRequest: 0,
  menu: { rows: [], index: 0 },
  menuHidden: false,   // dismissed with Escape, without losing the line
  run: null,           // the live entry while a request is in flight
  runNodes: null,      // the live entry's plan/reply nodes — see updateRunText
  history: [],         // sent prompts, newest last — ↑ on an empty line
  historyAt: -1,       // where ↑/↓ have walked to; -1 = not walking
  lastPrompt: '',
  // entry object → the node rendered for it. The transcript is diffed against
  // this rather than rebuilt, which is what keeps an open <details>, a text
  // selection and a typeset formula alive across the next stage event.
  nodes: new Map(),
  welcome: false,      // the empty state is on screen, and it is not an entry
  // Whether the transcript is following its own tail. Maintained by the log's
  // scroll listener: a reader who has scrolled up is reading, and the next
  // token must not drag them back down.
  pinned: true,
  // Selected parts of the canvas that ride with the next prompt. Refs, not
  // snapshots: resolved to names at send time, so a chip added before a rename
  // still points at the right state. See resolveContextRefs.
  context: [],
  // turn id → the rich entry that was built for it. A branch switch rebuilds
  // the transcript from the thread, and the thread only remembers a machine
  // turn as a one-line summary — without this, stepping back onto a branch
  // would strip its diff and its Apply button.
  entries: new Map(),
  // The turn the composer is currently rewriting, if any. Set by "edit", so ⏎
  // replaces that turn rather than following it.
  editing: '',
  // Collapsed to the header strip — the console is still open, and everything
  // about the session outlives it. See the minimize section below.
  minimized: false,
  minSince: 0,          // where the transcript had got to when it went down
  logTop: 0             // the reader's scroll position, which display:none loses
};

// ══════════════════════════════════════════════════════════════════
//  SMALL DOM HELPERS
// ══════════════════════════════════════════════════════════════════

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function btn(className, text, onclick, { tip, type = 'button' } = {}) {
  const node = el('button', className, text);
  node.type = type;
  if (tip) node.title = tip;
  node.onclick = onclick;
  return node;
}

// A labelled action with a leading glyph. The label stays — these are
// decisions ("Apply", "Discard", "Revert this turn") where a bare icon would
// be a guess with consequences — but the glyph is what the eye finds first.
function actionBtn(className, glyph, text, onclick, opts = {}) {
  const node = btn(className, null, onclick, opts);
  if (glyph) node.append(icon(glyph, 'sm-btn-icon'));
  node.append(el('span', null, text));
  return node;
}

/**
 * The footnote under a turn: model, tokens, timings, retries.
 *
 * Built as separate spans rather than one joined string so the separators can
 * recede and the model — the one bit that is a name rather than a number — can
 * carry the weight. `resultMetaBits` puts it first when there is one.
 */
function metaLine(bits) {
  const row = el('div', 'sm-meta');
  bits.forEach((bit, i) => {
    if (i) row.append(el('span', 'sm-meta-sep', '·'));
    row.append(el('span', i === 0 ? 'sm-meta-model' : 'sm-meta-bit', bit));
  });
  return row;
}

function icon(path, cls = 'sm-icon') {
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

const ICONS = {
  spark: 'M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  close: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  tool: 'M226.76,69a8,8,0,0,0-12.84-2.88l-40.3,37.19-17.23-3.7-3.7-17.23,37.19-40.3A8,8,0,0,0,187,29.24,72,72,0,0,0,88,96,72.34,72.34,0,0,0,94,124.94L33.79,177.79l-.36.34a32,32,0,0,0,45.26,45.26l.34-.36L131.06,162A72,72,0,0,0,232,96,71.56,71.56,0,0,0,226.76,69Z',
  plus: 'M216,120H136V40a8,8,0,0,0-16,0v80H40a8,8,0,0,0,0,16h80v80a8,8,0,0,0,16,0V136h80a8,8,0,0,0,0-16Z',
  // Every glyph below is already used elsewhere in this app — the same Phosphor
  // path, copied rather than approximated, so the console's icons are the
  // icons the rest of the UI uses for the same act. `undo` is the header's undo
  // arrow, `trash` the Delete row's, `pencil` the Rename row's, and so on: a
  // reader who has learnt one has learnt both.
  undo: 'M232,144a64.07,64.07,0,0,1-64,64H80a8,8,0,0,1,0-16h88a48,48,0,0,0,0-96H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,45.66L51.31,80H168A64.07,64.07,0,0,1,232,144Z',
  retry: 'M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A96,96,0,1,1,195.88,60.19L224,85.53V56a8,8,0,1,1,16,0Z',
  copy: 'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
  trash: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
  pencil: 'M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160,136,75.31,152.69,92,68,176.69ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188,164,103.31,180.69,120Zm96-96L147.31,64l24-24L216,84.68Z',
  code: 'M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z',
  layout: 'M160,112h48a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16V64H128a24,24,0,0,0-24,24v32H72v-8A16,16,0,0,0,56,96H24A16,16,0,0,0,8,112v32a16,16,0,0,0,16,16H56a16,16,0,0,0,16-16v-8h32v32a24,24,0,0,0,24,24h16v16a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V160a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16v16H128a8,8,0,0,1-8-8V88a8,8,0,0,1,8-8h16V96A16,16,0,0,0,160,112ZM56,144H24V112H56v32Zm104,16h48v48H160Zm0-112h48V96H160Z',
  gear: 'M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z',
  caretLeft: 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
  caretRight: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  state: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z',
  edge: 'M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z',
  note: 'M88,96a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,96Zm8,40h64a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16Zm32,16H96a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16ZM224,48V156.69A15.86,15.86,0,0,1,219.31,168L168,219.31A15.86,15.86,0,0,1,156.69,224H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H152V160a8,8,0,0,1,8-8h48V48H48Zm120-40v28.7L196.69,168Z',
  word: 'M40,64H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm176,48H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z',
  eyeOpen: 'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
  // The composer's own two. `send` is the arrow the static markup ships with,
  // repeated here because setBusy swaps between them; `stop` is the one glyph
  // in this file the app did not already have a use for.
  send: 'M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z',
  stop: 'M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Z',
  eyeClose: 'M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z',
};

// ══════════════════════════════════════════════════════════════════
//  CONTEXT
// ══════════════════════════════════════════════════════════════════

/**
 * What this turn is *about* — as opposed to how much it may write, which is
 * the authority below and the only one of the two a person sets.
 *
 * It is inferred rather than toggled, and there is nothing left to toggle: a
 * turn is about the machine on the canvas when there is one and it is being
 * sent, and is a fresh build otherwise. `/new` overrides it for one turn,
 * which is the only case inference cannot cover — "yes there is a machine
 * there, no I do not mean that one".
 */
function turnIntent() {
  return App.states.length && effectiveAttach() ? 'edit' : 'build';
}

// ── write authority ──────────────────────────────────────────────
//  How much StateMate may change without being asked — the one thing a model
//  must not decide on your behalf. Shift+Tab cycles it, the way Claude Code
//  cycles its permission modes.

// Exported so the copy can be reworded without that being a test failure —
// the same reason PROVIDERS is compared against rather than quoted.
export const AUTHORITY_COPY = {
  ask: {
    label: 'Chat',
    blurb: 'Read-only. StateMate answers and explains; the canvas is never touched.',
    tip: 'Read-only: questions get answers and nothing is drawn. Shift+Tab to cycle.'
  },
  propose: {
    label: 'Build',
    blurb: 'Not finding what you are looking for? StateMate builds and checks a machine, then shows you the diff before drawing it.',
    tip: 'Every machine is built, checked and shown to you before it reaches the canvas. Shift+Tab to cycle.'
  },
  auto: {
    label: 'Auto',
    blurb: 'StateMate draws straight onto the canvas. One Ctrl+Z undoes a turn.',
    tip: 'Machines are drawn as soon as they pass their checks. A replacing edit still stops to ask. Shift+Tab to cycle.'
  }
};

function setAuthority(next, { quiet = false } = {}) {
  if (!AUTHORITIES.includes(next)) return;
  Session.authority = next;
  if (!quiet) note(`${AUTHORITY_COPY[next].label} — ${AUTHORITY_COPY[next].blurb}`);
  renderStatus();
  setBusy(isStateMateRunning());
}

function cycleAuthority() {
  const at = AUTHORITIES.indexOf(Session.authority);
  setAuthority(AUTHORITIES[(at + 1) % AUTHORITIES.length]);
}

function effectiveAttach() {
  if (Session.attachCanvas !== null) return Session.attachCanvas;
  return !!getStateMateSettings().attachCanvas;
}

function canvasSummary() {
  const s = App.states.length;
  const t = App.transitions.length;
  if (!s) return 'empty';
  return `${s} state${s === 1 ? '' : 's'}, ${t} transition${t === 1 ? '' : 's'}`;
}

// ══════════════════════════════════════════════════════════════════
//  THE EXACT TOOL
// ══════════════════════════════════════════════════════════════════
//  Read from the algorithm list in index.html rather than duplicated here,
//  so an algorithm added to the markup is routable the same day.

function algorithmCatalogue() {
  return Array.from(document.querySelectorAll('.algo-item'))
    .map(item => ({
      id: item.dataset.algo,
      label: (item.textContent || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(a => a.id && a.label);
}

// Words that mean "run the real construction", mapped to what the user is
// likely to type rather than to the algorithm's formal name.
const ALGO_SYNONYMS = {
  minimize: ['minimise', 'minimal', 'smallest equivalent'],
  nfa2dfa: ['determinize', 'determinise', 'subset construction', 'powerset'],
  enfa2nfa: ['remove epsilon', 'eliminate epsilon'],
  nfa2re: ['to regex', 'regular expression'],
  re2nfa: ['from regex', 'regex to'],
  complement: ['complement', 'invert', 'negate'],
  product: ['intersection', 'union', 'product'],
  dfa2rg: ['to grammar'],
  equiv: ['equivalent', 'same language']
};

function matchingAlgorithms(query, { min = 3 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < min) return [];
  return algorithmCatalogue().filter(algo => {
    if (algo.label.toLowerCase().includes(q)) return true;
    return (ALGO_SYNONYMS[algo.id] || []).some(syn => q.includes(syn) || syn.includes(q));
  }).slice(0, 4);
}

function openAlgorithm(id) {
  closeModal(MODAL_ID);
  setView('algo');
  // setAlgo lives on the global surface with the rest of the algorithm panel's
  // handlers; reaching it that way avoids a cycle back into algorithms-fa.js.
  if (typeof window !== 'undefined' && typeof window.setAlgo === 'function') window.setAlgo(id);
}

// ══════════════════════════════════════════════════════════════════
//  THE TRANSCRIPT
// ══════════════════════════════════════════════════════════════════

function push(entry) {
  // Stamped on the way in rather than at render time: the transcript is
  // rebuilt from scratch on every event, and a time computed there would be
  // the time of the last repaint rather than the time of the turn.
  const stamped = { at: Date.now(), ...entry };
  Session.log.push(stamped);
  if (stamped.turnId) Session.entries.set(stamped.turnId, stamped);
  return stamped;
}

function note(text) {
  push({ kind: 'note', text });
  announce(text);
  renderLog();
}

/**
 * Drop an entry's cached node, so the next render rebuilds it.
 *
 * Needed only where an entry is mutated *in place* — accepting a proposal, or
 * a canvas edit that makes a held one stale. Everything else replaces the
 * entry object, and object identity is the cache key.
 */
function invalidate(entry) {
  if (entry) Session.nodes.delete(entry);
}

// ── the spoken summary ───────────────────────────────────────────
//  The transcript is a log with `aria-live="off"`, because it is rebuilt as
//  entries arrive and a live region over the whole of it re-announces the
//  session on every stage event. This is the one line a screen reader hears
//  per turn, and it is written where the turn ends rather than where it draws.

function announce(text) {
  const live = $('sm-live');
  if (live) live.textContent = String(text || '');
}

// ── following the tail ───────────────────────────────────────────
//  A transcript pins itself to the newest line only while the reader is
//  already there. Scrolling up to re-read a turn is a decision, and a run
//  streaming underneath it must not undo it several times a second.

const SCROLL_PIN_SLACK = 48;

function isPinned(log) {
  if (!log) return true;
  const gap = (log.scrollHeight || 0) - (log.scrollTop || 0) - (log.clientHeight || 0);
  return gap <= SCROLL_PIN_SLACK;
}

function syncJump() {
  const jump = $('sm-jump');
  if (jump) jump.hidden = Session.pinned;
}

/** @param {boolean} [force] scroll even if the reader has scrolled away. */
function scrollLogToEnd(force = false) {
  const log = $('sm-log');
  if (!log) return;
  if (force) Session.pinned = true;
  if (Session.pinned) log.scrollTop = log.scrollHeight;
  syncJump();
}

function onLogScroll() {
  const log = $('sm-log');
  if (!log) return;
  Session.pinned = isPinned(log);
  syncJump();
}

function replaceEntry(target, next) {
  const stamped = { at: target?.at ?? Date.now(), ...next };
  const i = Session.log.indexOf(target);
  if (i === -1) Session.log.push(stamped);
  else Session.log[i] = stamped;
  if (stamped.turnId) Session.entries.set(stamped.turnId, stamped);
  return stamped;
}

/**
 * Remember an entry under the thread id the run reported for it.
 *
 * `turn` is set *here* and nowhere else, and that is load-bearing:
 * syncLogWithThread compares the flagged entries against the thread, so an
 * entry flagged before the thread has recorded it would make the two disagree
 * and trigger a rebuild. A failed run's prompt is exactly that case — flagged
 * early, it and the error beneath it are wiped by the next open, which erases
 * the message the reader came back to read.
 */
function keyEntry(entry, turnId) {
  if (!entry || !turnId) return entry;
  entry.turnId = turnId;
  entry.turn = true;
  Session.entries.set(turnId, entry);
  // The id arrives after the entry has been drawn — a prompt is on screen well
  // before the thread has recorded the turn it belongs to — and it is what the
  // branch stepper is keyed on. So the node built without one is dropped, or a
  // retried turn keeps the tools of a turn that had no alternatives.
  invalidate(entry);
  return entry;
}

// ── the clock ────────────────────────────────────────────────────
//  Mono, because a timestamp is instrumentation rather than language, and
//  short, because the useful question is "how long ago" and the exact second
//  is a hover away.

function clockLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clockTitle(at) {
  if (!at) return '';
  try { return new Date(at).toLocaleString(); } catch (e) { return new Date(at).toISOString(); }
}

// ── the clipboard ────────────────────────────────────────────────

/**
 * Copy text, saying so either way.
 *
 * What gets copied is always the *source* — the raw prompt, the reply's
 * markdown, the spec's JSON — never the rendered nodes. A reply is built as
 * DOM and never as markup, so reading it back off the page would hand over
 * prose with its formatting silently flattened.
 */
function copyText(text, what = 'Copied') {
  const value = String(text ?? '');
  const ok = () => showStatus(`${what} to the clipboard`);
  const failed = () => showStatus('Could not reach the clipboard');

  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (clip && typeof clip.writeText === 'function') {
    try {
      Promise.resolve(clip.writeText(value)).then(ok, failed);
      return;
    } catch (e) { /* denied outright — fall through */ }
  }

  // The legacy path, for a page served over http or a denied permission.
  try {
    const holder = document.createElement('textarea');
    holder.value = value;
    document.body.appendChild(holder);
    if (typeof holder.select === 'function') holder.select();
    const worked = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(holder);
    return void (worked ? ok() : failed());
  } catch (e) {
    failed();
  }
}

// ── the per-entry tools ──────────────────────────────────────────
//  One row per entry, revealed on hover: the timestamp, the alternatives at
//  this fork, and the handful of things you can do to a turn after the fact.
//
//  Glyph-only, because there are four of them per turn and the transcript is
//  the thing being read — four words per entry turns a conversation into a page
//  of controls. Each one carries its own tooltip and an accessible name, so the
//  label is a hover or a screen reader away rather than gone; `data-tip` is the
//  app's own tooltip, which is what the rest of the UI uses.

function toolButton(glyph, label, onclick, tip) {
  const node = btn('sm-tool', null, onclick, { tip });
  node.append(icon(glyph, 'sm-tool-icon'));
  node.setAttribute('aria-label', label);
  node.dataset.tip = tip || label;
  return node;
}

/**
 * The alternatives at a fork, as a stepper.
 *
 * Only rendered when there is more than one, so an ordinary conversation shows
 * nothing — the branching is invisible until it exists.
 */
function branchStepper(turnId) {
  const { list, index } = siblingsOf(turnId);
  if (list.length < 2 || index < 0) return null;

  const wrap = el('span', 'sm-branch');
  const step = delta => () => {
    const next = list[(index + delta + list.length) % list.length];
    if (!next) return;
    selectSibling(next.id);
    rebuildFromThread();
    renderLog();
  };
  const arrow = (glyph, label, onclick) => {
    const node = btn('sm-branch-btn', null, onclick, { tip: label });
    node.append(icon(glyph, 'sm-branch-icon'));
    node.setAttribute('aria-label', label);
    return node;
  };
  wrap.append(arrow(ICONS.caretLeft, 'The previous attempt at this turn', step(-1)));
  wrap.append(el('span', 'sm-branch-at', `${index + 1}/${list.length}`));
  wrap.append(arrow(ICONS.caretRight, 'The next attempt at this turn', step(1)));
  return wrap;
}

function entryTools(entry, tools = []) {
  const row = el('div', 'sm-tools');

  const stepper = entry.turnId ? branchStepper(entry.turnId) : null;
  if (stepper) row.append(stepper);

  tools.filter(Boolean).forEach(tool => row.append(tool));

  const stamp = el('time', 'sm-stamp', clockLabel(entry.at));
  if (entry.at) stamp.title = clockTitle(entry.at);
  row.append(stamp);
  return row;
}

/** Forget a turn. The canvas keeps whatever it was given — see removeTurn. */
function deleteEntry(entry) {
  if (entry.turnId) {
    removeTurn(entry.turnId);
    Session.entries.delete(entry.turnId);
    rebuildFromThread();
  } else {
    const i = Session.log.indexOf(entry);
    if (i !== -1) Session.log.splice(i, 1);
  }
  renderLog();
}

/**
 * The retained thread is the source of truth across openings. When the log
 * does not account for it — a machine type switch dropped it, `/clear` emptied
 * it, or a run happened somewhere else — the log is rebuilt from it rather
 * than left to describe a conversation that is no longer there.
 *
 * Only entries that made it into the thread are counted: an interruption or a
 * failure leaves a turn on screen that the thread never took, and rebuilding
 * over it would erase the error message the reader opened the console to read.
 */
/**
 * Rebuild the transcript from the active path.
 *
 * Rich entries are recovered by turn id where they exist, because the thread
 * itself only keeps a machine turn as its one-line summary — rebuilding from
 * the thread alone would strip every diff, every check result and every Apply
 * button, which is exactly what a branch switch would then cost.
 *
 * Trailing entries that never made it into the thread are kept: a failed or
 * interrupted run leaves its error on screen, and erasing that would delete the
 * message the reader opened the console to read.
 */
function rebuildFromThread() {
  // Every node is dropped rather than diffed. A kept entry's own content has
  // not changed, but its branch stepper reads siblingsOf() at render time, and
  // stepping onto a sibling is exactly what makes "1/2" wrong on a reused one.
  Session.nodes = new Map();
  const thread = getThread();
  const lastTurnAt = Session.log.reduce((at, entry, i) => (entry.turn ? i : at), -1);
  const trailing = lastTurnAt === -1 ? [] : Session.log.slice(lastTurnAt + 1).filter(e => !e.turn);

  Session.log = thread.map(turn => {
    const kept = Session.entries.get(turn.id);
    if (kept) return kept;
    const base = { turnId: turn.id, turn: true, at: turn.at };
    if (turn.role === 'user') return { ...base, kind: 'user', text: turn.text };
    if (turn.kind === 'reply') return { ...base, kind: 'reply', text: turn.text };
    return { ...base, kind: 'machine', title: turn.text, chips: [], notes: [], result: null };
  }).concat(trailing);
}

function syncLogWithThread() {
  const thread = getThread();
  const shown = Session.log.filter(e => e.turn);
  const agrees = shown.length === thread.length
    && shown.every((entry, i) => !entry.turnId || entry.turnId === thread[i].id);
  if (agrees) return;
  rebuildFromThread();
}

// ── the empty state ──────────────────────────────────────────────
//  It has one job: say what ⏎ does. With no key it has a second one, and the
//  examples are it — this dialog is still the only way to reach them.

function renderWelcome(host) {
  const ready = isStateMateReady();
  const cfg = getMachineConfig(App.machine);
  const wrap = el('div', 'sm-entry sm-welcome');

  const line = el('div', 'sm-line');
  line.append(icon(ICONS.spark, 'sm-mark sm-mark-icon'));

  const body = el('div', 'sm-welcome-line');
  if (ready && turnIntent() === 'edit') {
    // The machine is already there, so the opening move is a conversation
    // about it rather than a description of one.
    body.append(el('b', null, `Ask about this ${cfg.label || App.machine}, or ask for a change.`));
    body.append(document.createTextNode(
      ' A question gets an answer and leaves the diagram alone; a change is drawn and checked before you see it.'
    ));
  } else if (ready) {
    body.append(el('b', null, `Describe a ${cfg.label || App.machine} and press `));
    body.append(el('span', 'sm-kbd', '⏎'));
    body.append(document.createTextNode(
      '. StateMate draws it on the canvas, then runs its own test words against it before you see it.'
    ));
  } else {
    body.append(el('b', null, 'StateMate builds and edits automata from a prompt.'));
    body.append(document.createTextNode(' It needs an API key first — your key stays in this browser.'));
  }
  line.append(body);
  wrap.append(line);

  if (!ready) {
    const actions = el('div', 'sm-actions sm-hang');
    actions.append(btn('sm-btn sm-btn-primary', 'Set up StateMate', openStateMateSettings));
    wrap.append(actions);
  }

  host.append(wrap);

  // Starters are a cold-start affordance, and this is the only cold start.
  if (ready) {
    const starters = el('div', 'sm-list');
    const openers = turnIntent() === 'edit'
      ? editStarterPrompts(App.machine)
      : starterPrompts(App.machine);
    openers.forEach(text => {
      const row = btn('sm-listrow', null, () => {
        setComposer(text);
        focusInput();
      });
      const head = el('div', 'sm-listrow-head');
      head.append(el('span', 'sm-listrow-name', text));
      head.append(el('span', 'sm-listrow-tag', 'try'));
      row.append(head);
      starters.append(row);
    });
    host.append(starters);
  }

  // With no key the examples are the whole of what this dialog can do, so they
  // are listed rather than hidden behind a command nobody has been told about.
  if (!ready) {
    host.append(exampleList(''));
  } else {
    const hint = el('div', 'sm-entry is-note sm-line');
    hint.append(el('span', 'sm-mark', '⎿'));
    hint.append(el('span', null, 'Type / for commands — /examples to browse examples, /help to list the rest.'));
    host.append(hint);
  }
}

// ── entries ──────────────────────────────────────────────────────

function renderUser(entry) {
  const wrap = el('div', 'sm-entry is-user');
  const row = el('div', 'sm-line');
  row.append(el('span', 'sm-mark', '›'));

  const body = el('div', 'sm-user-body');
  body.append(el('div', 'sm-user-text', entry.text));

  // Retry and edit are the same operation — replace this turn rather than
  // follow it — and both go through `branch`, so the answer being replaced
  // never reaches the model as something it already did.
  body.append(entryTools(entry, [
    toolButton(ICONS.retry, 'Retry', () => send(entry.text, { branch: entry.turnId }),
      'Ask again, replacing this turn rather than adding to it'),
    toolButton(ICONS.pencil, 'Edit and resend', () => beginEditingTurn(entry),
      'Put this prompt back in the composer and replace the turn'),
    toolButton(ICONS.copy, 'Copy prompt', () => copyText(entry.text, 'Prompt copied'),
      'Copy this prompt'),
    toolButton(ICONS.trash, 'Delete turn', () => deleteEntry(entry),
      'Forget this turn. Anything it drew stays on the canvas')
  ]));

  row.append(body);
  wrap.append(row);
  return wrap;
}

/** Load a past prompt back into the composer, marked as a replacement. */
function beginEditingTurn(entry) {
  Session.editing = entry.turnId || '';
  setComposer(entry.text);
  focusInput();
  renderChrome();
}

function renderNote(entry) {
  const row = el('div', 'sm-entry is-note sm-line');
  row.append(el('span', 'sm-mark', '⎿'));
  row.append(el('span', null, entry.text));
  return row;
}

const STAGE_ORDER = [
  { id: 'request', label: 'Asking' },
  { id: 'parse', label: 'Reading the answer' },
  { id: 'compile', label: 'Checking the shape' },
  { id: 'verify', label: 'Running checks' },
  { id: 'apply', label: 'Drawing' }
];

function renderRun(entry) {
  const wrap = el('div', 'sm-entry is-run');

  const head = el('div', 'sm-run-head');
  const dot = el('span', 'sm-dot');
  dot.append(el('span', 'sm-spinner'));
  head.append(dot);
  head.append(el('span', null, entry.label || 'Working'));
  // Time to first token, live. It is the number that explains a run that feels
  // slow, and it is knowable long before the answer is.
  const ttft = el('span', 'sm-step-note', entry.ttft || '');
  head.append(ttft);
  wrap.append(head);

  const steps = el('div', 'sm-steps');
  entry.stages.forEach(stage => {
    if (stage.status === 'idle') return;
    const row = el('div', `sm-step is-${stage.status}`);
    const mark = el('span', 'sm-step-mark');
    if (stage.status === 'done') mark.append(icon(ICONS.check, 'sm-step-icon'));
    else mark.textContent = '⎿';
    row.append(mark);
    row.append(el('span', null, stage.label));
    if (stage.note) row.append(el('span', 'sm-step-note', stage.note));
    steps.append(row);
  });
  wrap.append(steps);

  // A wait the app chose has to say so. A silent eight-second stall while a
  // rate limit clears is indistinguishable from a hang, and the user's only
  // move is to abandon a request that was about to succeed.
  if (entry.retry) {
    const line = el('div', 'sm-retry');
    line.append(el('span', 'sm-step-mark', '↻'));
    line.append(el('span', null, entry.retry));
    wrap.append(line);
  }

  const plan = el('div', 'sm-plan', entry.plan || '');
  if (!entry.plan) plan.hidden = true;
  wrap.append(plan);

  // A reply streams as plain text and is re-rendered as markdown once it is
  // whole: half a fenced block or an unclosed emphasis run parses as neither
  // the markup nor the text, and re-parsing on every delta would be the most
  // expensive thing in the loop.
  const reply = el('div', 'sm-prose sm-stream', entry.reply || '');
  if (!entry.reply) reply.hidden = true;
  wrap.append(reply);

  Session.runNodes = { entry, plan, reply, ttft };
  return wrap;
}

/**
 * Update the live entry's streamed text without rebuilding the transcript.
 *
 * renderLog() clears and rebuilds every entry, which is fine for the handful
 * of stage events and quite wrong for a token stream. This touches the three
 * nodes that change, and falls back to a full render when the structure itself
 * has to change — the first delta of a reply, for instance, which needs a node
 * that is not there yet.
 */
function updateRunText(entry) {
  const nodes = Session.runNodes;
  if (!nodes || nodes.entry !== entry) return void renderLog();

  if (nodes.plan) {
    nodes.plan.textContent = entry.plan || '';
    nodes.plan.hidden = !entry.plan;
  }
  if (nodes.reply) {
    nodes.reply.textContent = entry.reply || '';
    nodes.reply.hidden = !entry.reply;
  }
  if (nodes.ttft) nodes.ttft.textContent = entry.ttft || '';

  scrollLogToEnd();
}

/** Draw a held proposal, and turn its entry into an ordinary applied machine. */
function acceptProposal(entry) {
  const applied = applyPending(entry.result);
  if (!applied) return;
  entry.result = applied;
  entry.chips = summarizeDiff(applied.diff);
  // Mutated in place, so the diff cannot find it by identity — see invalidate.
  invalidate(entry);
  renderLog();
  decorateResultCard(applied);
  const verdict = verdictLabel(applied);
  const summary = `${entry.chips.join(', ')}${verdict ? ` · ${verdict}` : ''}`;
  announce(`Applied ${entry.title}. ${summary}`);
  showStatus(`StateMate: ${summary}`);
}

// The op glyphs, and what each one costs to read. '-' is written as a real
// minus so the column lines up under a proportional-hinted mono.
const DIFF_OPS = { '+': { glyph: '+', cls: 'add' }, '-': { glyph: '−', cls: 'del' }, '~': { glyph: '~', cls: 'mod' } };

/**
 * The diff, line by line, the way a diff is normally read.
 *
 * Open by default on a held proposal and closed once applied, because in
 * `propose` mode the diff *is* the thing being approved, and afterwards it is
 * history. Scrolls in its own box: an MTM transition line is wider than the
 * console and must not take the page sideways with it.
 */
function diffDetails(result, { open = false } = {}) {
  const lines = result?.diff?.lines || [];
  if (!lines.length) return null;

  const details = el('details', 'sm-diff');
  details.open = open;
  const shown = lines.filter(l => l.op !== ' ').length;
  details.append(el('summary', 'sm-diff-summary',
    `${shown} change${shown === 1 ? '' : 's'}, line by line`));

  const body = el('div', 'sm-diff-body');
  lines.forEach(line => {
    const op = DIFF_OPS[line.op] || { glyph: ' ', cls: 'ctx' };
    const row = el('div', `sm-diff-line is-${op.cls}`);
    row.append(el('span', 'sm-diff-op', op.glyph));
    row.append(el('span', 'sm-diff-text', line.text));
    body.append(row);
  });
  details.append(body);
  return details;
}

/**
 * Put the canvas back to before this turn.
 *
 * Not undo(): that pops the top of App.history, which is this turn only until
 * the next edit and one of *those* afterwards. A checkpoint is correct however
 * much happened in between, which is what lets the button say what it does.
 */
function revertTurn(entry) {
  const id = entry.result?.checkpoint;
  if (!id || !hasCheckpoint(id)) {
    return note('That turn is too far back to restore — its checkpoint has been dropped.');
  }
  restoreCheckpoint(id);
  showExampleCard(null);
  note(`Restored the canvas to before “${entry.title}”.`);
}

/**
 * Frame the machine on the canvas the console is docked over.
 *
 * Silent, because this is a look rather than an edit: `fitToScreen()` would
 * otherwise mark the tab dirty for a camera the reader only asked to see.
 */
function showOnCanvas() {
  if (!App.states.length) return void showStatus('Nothing on the canvas yet');
  fitToScreen(true);
  showStatus('Framed the machine behind the console');
}

function renderMachine(entry) {
  const wrap = el('div', 'sm-entry is-machine sm-line');
  wrap.append(icon(ICONS.spark, 'sm-mark sm-mark-icon'));

  const result = entry.result;
  const held = !!result?.pending;
  const card = el('div',
    `sm-card${held ? ' is-pending' : ''}${result && hasWarnings(result) ? ' is-warn' : ''}`);
  card.append(el('div', 'sm-card-title', entry.title));

  // A held machine says so before it says anything else: the reader is looking
  // at something that is not on their canvas, and every number below is a
  // prediction rather than a report.
  if (held) {
    const reason = result.hold === 'scope'
      ? `Held back — ${result.holdDetail}. Check it before it lands.`
      : result.hold === 'ask'
        ? 'Ask mode is read-only, so this was not drawn.'
        : 'Not drawn yet — this is what would change.';
    card.append(el('div', 'sm-hold', reason));
  }

  const chips = entry.chips || [];
  const verdict = result ? verdictLabel(result) : '';
  if (chips.length || verdict) {
    const line = el('div', 'sm-chipline');
    chips.forEach(text => line.append(el('span', 'sm-chip', text)));
    if (verdict) {
      line.append(el('span', `sm-chip ${result.batch?.allPassed ? 'is-pass' : 'is-fail'}`, verdict));
    }
    card.append(line);
  }

  const notes = entry.notes || [];
  if (notes.length) {
    const list = el('ul', 'sm-notes');
    notes.slice(0, 5).forEach(n => list.append(el('li', `sm-note is-${n.severity}`, n.message)));
    card.append(list);
  }

  // A machine turn rebuilt from the thread has no result behind it, so the
  // actions that operate on one are not offered.
  if (result) {
    // Expanded while it is a proposal, because that is what is being approved.
    const detail = diffDetails(result, { open: held });
    if (detail) card.append(detail);

    const actions = el('div', 'sm-actions');
    if (held) {
      const stale = result.pending.signature !== machineSignature();
      actions.append(actionBtn('sm-btn sm-btn-primary', ICONS.check, stale ? 'Apply anyway' : 'Apply',
        () => acceptProposal(entry),
        {
          tip: stale
            ? 'The canvas has changed since this was proposed — applying replaces it wholesale'
            : 'Draw this on the canvas'
        }));
      actions.append(actionBtn('sm-btn', ICONS.close, 'Discard', () => {
        replaceEntry(entry, { kind: 'note', text: `Discarded “${entry.title}”. Nothing was drawn.` });
        renderLog();
      }, { tip: 'Throw the proposal away' }));
      actions.append(actionBtn('sm-btn', ICONS.retry, 'Ask again',
        () => send(entry.prompt, { branch: entry.turnId }),
        { tip: 'Send the same prompt again, replacing this turn' }));
      card.append(actions);
      if (stale) {
        card.append(el('div', 'sm-hold is-stale',
          'The canvas has changed since this was proposed, so the numbers above no longer describe it.'));
      }
    } else {
      // The console is a dock, so looking at the machine no longer costs the
      // conversation: this frames it behind the panel instead of dismissing.
      actions.append(actionBtn('sm-btn sm-btn-primary', ICONS.eyeOpen, 'Show on canvas',
        showOnCanvas, { tip: 'Frame the diagram on the canvas behind the console' }));

      // A restorable turn gets the honest button; one whose checkpoint has
      // aged out says so rather than offering an undo() that would take back
      // whatever happened to be on top of the stack instead.
      if (result.openedNewTab) {
        actions.append(actionBtn('sm-btn', ICONS.undo, 'Close that tab', () => {
          note('This machine went into a tab of its own — close the tab to undo it.');
        }, { tip: 'This landed in a new tab, so there is nothing here to revert' }));
      } else if (hasCheckpoint(result.checkpoint)) {
        actions.append(actionBtn('sm-btn', ICONS.undo, 'Revert this turn', () => revertTurn(entry),
          { tip: 'Put the canvas back exactly as it was before this turn, whatever has happened since' }));
      }

      actions.append(actionBtn('sm-btn', ICONS.retry, 'Ask again',
        () => send(entry.prompt, { branch: entry.turnId }),
        { tip: 'Send the same prompt again, replacing this turn' }));
      actions.append(actionBtn('sm-btn', ICONS.layout, 'Re-layout', () => {
        relayoutLastResult();
        note('Rearranged the diagram.');
      }, { tip: 'Rearrange the diagram automatically' }));
      card.append(actions);
    }

    const bits = resultMetaBits(result);
    const hint = testHint(App.machine);
    if (hint) bits.push(hint);
    if (bits.length) card.append(metaLine(bits));
  }

  // The card and its tools share the content column: `sm-line` is a two-column
  // grid, so a third child would land back in the 15px gutter.
  const col = el('div', 'sm-col');
  col.append(card);
  // The spec rather than the title: the JSON is what someone copying a machine
  // turn actually wants, and it is the same dialect they could paste back.
  col.append(entryTools(entry, [
    result?.spec ? toolButton(ICONS.code, 'Copy machine spec',
      () => copyText(JSON.stringify(result.spec, null, 2), 'Machine spec copied'),
      'Copy this machine as StateMate spec JSON') : null,
    toolButton(ICONS.trash, 'Delete turn', () => deleteEntry(entry),
      'Forget this turn. The machine stays on the canvas')
  ]));
  wrap.append(col);
  return wrap;
}

// A reply is the only place the model writes prose for a person to read, so it
// is the only place worth rendering as markdown. renderMarkdown builds nodes
// and never assigns markup, which is what makes running it over text from a
// remote provider safe; triggerMath then typesets whatever `$…$` came through,
// exactly as the formal-definition box does.
function renderReply(entry) {
  const wrap = el('div', 'sm-entry is-reply sm-line');
  wrap.append(icon(ICONS.spark, 'sm-mark sm-mark-icon'));
  const card = el('div', 'sm-card is-reply');
  const prose = el('div', 'sm-prose sm-md');
  renderMarkdown(entry.text, prose);
  card.append(prose);

  // Ask mode's way out of ask mode: the description above becomes a real
  // machine by re-running the same prompt with the authority to write.
  if (entry.offerBuild && entry.prompt) {
    const actions = el('div', 'sm-actions');
    actions.append(actionBtn('sm-btn sm-btn-primary', ICONS.spark, 'Build this', () => {
      setAuthority('propose', { quiet: true });
      send(entry.prompt);
    }, { tip: 'Leave ask mode and build it, so you can review the machine before it lands' }));
    card.append(actions);
  }

  // The same instrumentation the machine card carries — model, tokens, time to
  // first token, retries. A reply is a request to the same provider at the same
  // price, and the strip only ever existed on the machine path because that is
  // where it was written; `testHint` is left out because there is no machine
  // here to run a word against.
  const bits = resultMetaBits(entry.result);
  if (bits.length) card.append(metaLine(bits));

  const col = el('div', 'sm-col');
  col.append(card);
  // The markdown source, not the rendered nodes — see copyText.
  col.append(entryTools(entry, [
    toolButton(ICONS.copy, 'Copy answer', () => copyText(entry.text, 'Answer copied'),
      'Copy this answer as Markdown'),
    entry.prompt ? toolButton(ICONS.retry, 'Retry', () => send(entry.prompt, { branch: entry.turnId }),
      'Ask the same thing again, replacing this turn') : null,
    toolButton(ICONS.trash, 'Delete turn', () => deleteEntry(entry), 'Forget this turn')
  ]));
  wrap.append(col);
  triggerMath(prose);
  return wrap;
}

function renderErrorEntry(entry) {
  const info = describeError(entry.error);
  const wrap = el('div', 'sm-entry is-error sm-line');
  wrap.append(el('span', 'sm-mark', '✕'));

  const card = el('div', 'sm-card is-error');
  card.append(el('div', 'sm-card-title', info.text));

  if (info.detail) {
    const details = el('details', 'sm-error-detail');
    details.append(el('summary', null, 'Details'));
    details.append(el('pre', null, String(info.detail).slice(0, 4000)));
    card.append(details);
  }

  const actions = el('div', 'sm-actions');
  if (info.action === 'settings') {
    actions.append(actionBtn('sm-btn sm-btn-primary', ICONS.gear, info.label, openStateMateSettings));
  }
  if (info.action === 'retry' || info.action === 'settings') {
    const primary = info.action === 'retry';
    actions.append(actionBtn(`sm-btn${primary ? ' sm-btn-primary' : ''}`, ICONS.retry,
      primary ? info.label : 'Try again',
      () => send(entry.prompt, { branch: entry.turnId })));
  }
  if (actions.children.length) card.append(actions);

  wrap.append(card);
  return wrap;
}

function renderList(entry) {
  const wrap = el('div', 'sm-entry is-list');
  const head = el('div', 'sm-line is-note');
  head.append(el('span', 'sm-mark', '⎿'));
  head.append(el('span', null, entry.text));
  wrap.append(head);
  if (entry.build) wrap.append(entry.build());
  return wrap;
}

const RENDERERS = {
  user: renderUser,
  note: renderNote,
  run: renderRun,
  machine: renderMachine,
  reply: renderReply,
  error: renderErrorEntry,
  list: renderList
};

/**
 * Draw the transcript, reusing the nodes already on screen.
 *
 * This used to clear the container and rebuild every entry, which is fine for
 * a handful of stage events and quite wrong for a conversation: it collapsed
 * whatever `<details>` the reader had opened, destroyed a text selection they
 * were part-way through making, and re-ran KaTeX over every past reply — all
 * of it several times per run, because a stage event is a render.
 *
 * So entries are diffed against `Session.nodes` by object identity, the way
 * `renderAll()` diffs states by id. A changed entry is a *new* object —
 * `replaceEntry` builds one — and the two places that mutate an entry in place
 * call `invalidate()`. The one node rebuilt on every pass is the live run's,
 * which is the only entry that changes without being replaced.
 */
function renderLog() {
  const log = $('sm-log');
  if (!log) return;

  if (!Session.log.length) {
    log.innerHTML = '';
    Session.nodes = new Map();
    Session.welcome = true;
    renderWelcome(log);
    renderChrome();
    return void scrollLogToEnd(true);
  }

  // The welcome block is not an entry, so nothing evicts it.
  if (Session.welcome) {
    log.innerHTML = '';
    Session.nodes = new Map();
    Session.welcome = false;
  }

  let cursor = log.firstChild;
  Session.log.forEach(entry => {
    let node = Session.nodes.get(entry);
    // The live entry's stages, plan and reply change under it without the
    // object being replaced, so it is the one that always rebuilds.
    if (node && entry === Session.run) {
      Session.nodes.delete(entry);
      node = null;
    }
    if (!node) {
      const build = RENDERERS[entry.kind];
      if (!build) return;
      node = build(entry);
      Session.nodes.set(entry, node);
    }
    if (node === cursor) {
      cursor = cursor.nextSibling;
      return;
    }
    // insertBefore detaches first, so this both inserts a new node and moves
    // one that has shifted — a reorder is a single call, not a rebuild.
    log.insertBefore(node, cursor);
  });

  // Anything still after the cursor belongs to entries that are gone.
  while (cursor) {
    const next = cursor.nextSibling;
    log.removeChild(cursor);
    cursor = next;
  }
  const live = new Set(Session.log);
  Array.from(Session.nodes.keys()).forEach(entry => {
    if (!live.has(entry)) Session.nodes.delete(entry);
  });

  renderChrome();
  // The newest line is the one being read; a transcript that opens at the top
  // makes the reader scroll to find out what just happened. Only while they
  // have not scrolled away from it — see scrollLogToEnd.
  scrollLogToEnd();
}

// ══════════════════════════════════════════════════════════════════
//  EXAMPLES AND ALGORITHMS AS OUTPUT
// ══════════════════════════════════════════════════════════════════

function exampleList(query) {
  const matches = filterMachineExampleOptions(Session.examples, query);
  if (!matches.length) {
    return el('div', 'sm-empty', query ? `No examples match “${query}”.` : 'No examples for this machine.');
  }
  const list = el('div', 'sm-list');
  matches.forEach(opt => {
    const row = btn('sm-listrow', null, () => {
      closeModal(MODAL_ID);
      loadExampleFile(opt.file);
    });
    const head = el('div', 'sm-listrow-head');
    head.append(el('span', 'sm-listrow-name', opt.meta?.title || opt.label || opt.file));
    head.append(el('span', 'sm-listrow-tag', App.machine));
    row.append(head);
    const blurb = opt.meta?.blurb;
    if (blurb) row.append(el('div', 'sm-listrow-sub', blurb));
    list.append(row);
  });
  return list;
}

function algorithmList(query) {
  const all = algorithmCatalogue();
  const q = String(query || '').trim().toLowerCase();
  const matches = q
    ? (matchingAlgorithms(q, { min: 1 }).length
      ? matchingAlgorithms(q, { min: 1 })
      : all.filter(a => a.label.toLowerCase().includes(q)))
    : all;
  if (!matches.length) return el('div', 'sm-empty', `No construction matches “${query}”.`);

  const list = el('div', 'sm-list');
  matches.slice(0, 12).forEach(algo => {
    const row = btn('sm-listrow', null, () => openAlgorithm(algo.id));
    const head = el('div', 'sm-listrow-head');
    head.append(el('span', 'sm-listrow-name', algo.label));
    head.append(el('span', 'sm-listrow-tag', 'exact'));
    row.append(head);
    list.append(row);
  });
  return list;
}

// ══════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ══════════════════════════════════════════════════════════════════
//  Everything the console can do that is not a prompt. Adding one is an entry
//  in `Commands`, not a branch anywhere:
//
//    {
//      name:   'settings',            // what follows the slash; must be unique
//      args:   '[tab]',               // shown greyed beside the name; omit if none
//      hint:   "The app's own settings",
//      suggest: query => [ … ],       // optional argument completions:
//                                     //   {label, hint, run} — ⏎ picks one
//      run:    query => { … }         // ⏎ with nothing to pick, or no suggest
//    }
//
//  `suggest` is what turns a command into two keystrokes rather than a name to
//  remember: ⏎ on a command that has one completes to "/name " and hands the
//  menu over to its arguments. A command without `suggest` runs on ⏎ outright.
//  `/help` renders the list from this array, so a command documents itself.

// Detaching the canvas is how you say "not about this machine" — turnIntent()
// reads it directly, so there is no second switch to keep in step with it.
function toggleCanvas() {
  if (!App.states.length) return note('Nothing on the canvas to send.');
  const next = !effectiveAttach();
  Session.attachCanvas = next;
  note(next
    ? `The canvas rides with your next prompt — ${canvasSummary()}.`
    : 'The canvas stays out of your next prompt, so a machine is built fresh.');
}

function clearSession() {
  clearThread();
  Session.log = [];
  Session.entries = new Map();
  Session.run = null;
  Session.runNodes = null;
  Session.editing = '';
  renderLog();
}

/** `/context` and the status bar's way in: whatever is selected right now. */
function addSelectionToContext() {
  const refs = [];
  if (App.selectedStates.size) refs.push({ kind: 'states', ids: [...App.selectedStates] });
  if (App.selectedTransitions.size) refs.push({ kind: 'transitions', ids: [...App.selectedTransitions] });
  if (!refs.length) return note('Nothing is selected on the canvas.');
  addStateMateContext(refs);
  renderLog();
  note(`The next prompt is about ${describeContext()}.`);
}

// The settings dialog's own tab strip, read from the markup the way
// algorithmCatalogue() reads the algorithm list — so a tab added to
// index.html is completable here without an edit, and one without a
// data-tab is simply not offered.
function settingsTabs() {
  return Array.from(document.querySelectorAll('#settings-tabs .modal-tab'))
    .map(tab => ({
      id: tab.dataset.tab,
      label: (tab.textContent || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(tab => tab.id && tab.label);
}

/** Open the app's settings, optionally on a named tab. */
function openAppSettings(tabId = '') {
  closeModal(MODAL_ID);
  openSettingsModal();
  if (tabId && typeof switchSettingsTab === 'function') switchSettingsTab(tabId);
}

const Commands = [
  {
    name: 'examples',
    args: '[search]',
    hint: 'Browse the bundled machines',
    suggest: query => filterMachineExampleOptions(Session.examples, query).slice(0, 8).map(opt => ({
      label: opt.meta?.title || opt.label || opt.file,
      hint: opt.meta?.blurb || 'Load this example',
      run: () => { closeModal(MODAL_ID); loadExampleFile(opt.file); }
    })),
    run: query => {
      push({
        kind: 'list',
        text: query ? `Examples matching “${query}”` : `Examples for ${App.machine}`,
        build: () => exampleList(query)
      });
      renderLog();
    }
  },
  {
    name: 'algorithms',
    args: '[search]',
    hint: 'Run an exact construction instead',
    suggest: query => {
      const all = algorithmCatalogue();
      const q = query.trim().toLowerCase();
      const matches = q ? all.filter(a => a.label.toLowerCase().includes(q)) : all;
      return matches.slice(0, 8).map(algo => ({
        label: algo.label,
        hint: 'Exact — no model call',
        run: () => openAlgorithm(algo.id)
      }));
    },
    run: query => {
      push({
        kind: 'list',
        text: query ? `Constructions matching “${query}”` : 'Exact constructions — no model call',
        build: () => algorithmList(query)
      });
      renderLog();
    }
  },
  {
    name: 'mode',
    args: '[ask|propose|auto]',
    hint: 'How much StateMate may change without asking',
    // One entry rather than three, because they are one setting. Three names
    // in the command list read as three unrelated things you could do.
    suggest: query => {
      const q = query.trim().toLowerCase();
      return AUTHORITIES.filter(id => !q || id.startsWith(q)).map(id => ({
        label: id,
        hint: AUTHORITY_COPY[id].blurb,
        run: () => setAuthority(id)
      }));
    },
    run: query => {
      const q = query.trim().toLowerCase();
      if (AUTHORITIES.includes(q)) return setAuthority(q);
      return cycleAuthority();
    }
  },
  {
    name: 'new',
    args: '<what to build>',
    hint: 'Build from scratch, ignoring the machine on the canvas',
    // The one thing inference cannot cover: there is a machine on the canvas,
    // and you do not mean that one. It is an override for a single turn, not
    // a mode to be left switched on and forgotten.
    run: query => (query
      ? send(query, { intent: 'build' })
      : note('Say what to build: /new a DFA for strings ending in b'))
  },
  { name: 'canvas', hint: 'Send the canvas with your prompt, or stop', run: toggleCanvas },
  {
    name: 'context',
    args: '[selection|clear]',
    hint: 'Which parts of the diagram the next prompt is about',
    suggest: query => {
      const q = query.trim().toLowerCase();
      const rows = [];
      const selected = App.selectedStates.size + App.selectedTransitions.size;
      if (selected) {
        rows.push({
          label: 'selection',
          hint: `Add the ${selected} selected item${selected === 1 ? '' : 's'}`,
          run: () => addSelectionToContext()
        });
      }
      if (Session.context.length) {
        rows.push({ label: 'clear', hint: 'Empty the context', run: () => { clearStateMateContext(); note('Context cleared.'); } });
      }
      return rows.filter(r => !q || r.label.startsWith(q));
    },
    run: query => {
      const q = query.trim().toLowerCase();
      if (q === 'clear') { clearStateMateContext(); return note('Context cleared.'); }
      if (q === '' || q === 'selection') return addSelectionToContext();
      note('Say /context selection to add what is selected, or /context clear.');
    }
  },
  {
    name: 'undo',
    hint: 'Undo the last change on the canvas',
    run: () => { undo(); showExampleCard(null); note('Undid the last change.'); }
  },
  { name: 'clear', hint: 'Forget the conversation and start over', run: clearSession },
  { name: 'model', hint: 'StateMate’s key, model and behaviour', run: openStateMateSettings },
  {
    name: 'settings',
    args: '[tab]',
    hint: 'The app’s own settings',
    suggest: query => {
      const q = query.trim().toLowerCase();
      return settingsTabs()
        .filter(tab => !q || tab.label.toLowerCase().includes(q) || tab.id.startsWith(q))
        .map(tab => ({
          label: tab.label,
          hint: `Open the ${tab.label} settings`,
          run: () => openAppSettings(tab.id)
        }));
    },
    // A bare /settings opens the dialog where it opens itself — on whichever
    // tab was left active — rather than guessing which one was meant.
    run: query => {
      const q = query.trim().toLowerCase();
      const hit = settingsTabs().find(tab => tab.id === q || tab.label.toLowerCase() === q);
      openAppSettings(hit ? hit.id : '');
    }
  },
  {
    name: 'help',
    hint: 'What you can type here',
    run: () => {
      push({
        kind: 'list',
        text: 'Type a description of a machine and press ⏎. These do the rest:',
        build: () => {
          const list = el('div', 'sm-list');
          Commands.forEach(cmd => {
            const row = btn('sm-listrow', null, () => {
              setComposer(cmd.suggest ? `/${cmd.name} ` : `/${cmd.name}`);
              focusInput();
            });
            const head = el('div', 'sm-listrow-head');
            head.append(el('span', 'sm-listrow-name', `/${cmd.name}${cmd.args ? ' ' + cmd.args : ''}`));
            head.append(el('span', 'sm-listrow-tag', 'command'));
            row.append(head);
            row.append(el('div', 'sm-listrow-sub', cmd.hint));
            list.append(row);
          });
          return list;
        }
      });
      renderLog();
    }
  }
];

function findCommand(name) {
  return Commands.find(c => c.name === name.toLowerCase()) || null;
}

/** `/examples binary` → {name: 'examples', query: 'binary', spaced: true} */
function parseSlash(text) {
  const m = /^\/(\S*)(\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  return { name: m[1] || '', query: (m[3] || '').trim(), spaced: m[2] !== undefined };
}

// ══════════════════════════════════════════════════════════════════
//  THE COMPLETION MENU
// ══════════════════════════════════════════════════════════════════

function menuRows(text) {
  const slash = parseSlash(text);
  if (!slash) return [];

  // Still typing the name: complete it. A command with arguments completes to
  // "/name " and waits; one without runs on ⏎, so the whole interaction is a
  // name and a keystroke.
  if (!slash.spaced) {
    return Commands
      .filter(cmd => cmd.name.startsWith(slash.name))
      .map(cmd => ({
        label: `/${cmd.name}`,
        args: cmd.args || '',
        hint: cmd.hint,
        run: () => {
          if (cmd.suggest) {
            setComposer(`/${cmd.name} `);
            focusInput();
            renderMenu();
          } else {
            setComposer('');
            cmd.run('');
          }
        }
      }));
  }

  const cmd = findCommand(slash.name);
  if (!cmd) return [];
  if (!cmd.suggest) {
    // The query goes through. A command whose argument is free text — /new —
    // has no completions to offer, and dropping what was typed after the name
    // made ⏎ run it empty.
    return [{
      label: `/${cmd.name}`,
      args: slash.query ? `“${slash.query}”` : cmd.args || '',
      hint: cmd.hint,
      // The return value goes back out, the way onInputKeydown passes its
      // send() promise up. A command that starts a run is otherwise
      // unawaitable, which a DOM handler does not care about and a test does.
      run: () => { setComposer(''); return cmd.run(slash.query); }
    }];
  }

  const rows = cmd.suggest(slash.query).map(row => ({
    label: row.label,
    args: '',
    hint: row.hint,
    run: () => { setComposer(''); return row.run(); }
  }));
  // A search with no hit still has an answer: print the empty list, which says
  // so in the transcript rather than leaving ⏎ doing nothing.
  if (!rows.length) {
    return [{
      label: `/${cmd.name} ${slash.query}`.trim(),
      args: '',
      hint: 'No match — show the full list',
      run: () => { setComposer(''); return cmd.run(slash.query); }
    }];
  }
  return rows;
}

function renderMenu() {
  const menu = $('sm-menu');
  const input = $('sm-input');
  if (!menu || !input) return;

  // Escape hides the menu without touching the line — see onEscape. The flag
  // is cleared by the next keystroke, so the menu comes back on typing rather
  // than staying dismissed for a command that is still being written.
  const rows = (isStateMateRunning() || Session.menuHidden) ? [] : menuRows(input.value || '');
  Session.menu.rows = rows;
  if (Session.menu.index >= rows.length) Session.menu.index = 0;

  menu.innerHTML = '';
  menu.hidden = rows.length === 0;
  if (!rows.length) return;

  let active = null;
  rows.forEach((row, i) => {
    const selected = i === Session.menu.index;
    const node = btn(`sm-cmd${selected ? ' is-active' : ''}`, null, () => {
      Session.menu.index = i;
      row.run();
    });
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(selected));
    node.append(el('span', 'sm-cmd-name', row.label));
    if (row.args) node.append(el('span', 'sm-cmd-args', row.args));
    if (row.hint) node.append(el('span', 'sm-cmd-hint', row.hint));
    menu.append(node);
    if (selected) active = node;
  });

  // The cursor is the keyboard's, not the focus ring's — the composer keeps
  // focus throughout — so a long list has to be scrolled on its behalf.
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function menuOpen() {
  const menu = $('sm-menu');
  return !!menu && menu.hidden === false && Session.menu.rows.length > 0;
}

function moveMenu(delta) {
  const n = Session.menu.rows.length;
  if (!n) return;
  Session.menu.index = (Session.menu.index + delta + n) % n;
  renderMenu();
}

// ══════════════════════════════════════════════════════════════════
//  THE CONTEXT BASKET
// ══════════════════════════════════════════════════════════════════
//  Selected parts of the diagram, riding *with* the attached machine rather
//  than instead of it.
//
//  The gap this closes: `attachCanvas` is all-or-nothing, so on a forty-state
//  machine there was no way to say "why does **this** state reject" — the most
//  natural question anyone has in front of an automaton. The whole machine is
//  still sent, because almost no question about one state can be answered
//  without the rest of the diagram; this says which part the sentence is about.
//
//  Refs, never snapshots. They resolve to names at send time, so a chip added
//  and then a state renamed still points at the right state, and one that
//  stops resolving is dropped with a count rather than guessed at.

const CONTEXT_LIMIT = 12;

function contextKey(ref) {
  return ref.kind === 'word' ? `word::${ref.w}` : `${ref.kind}::${[...(ref.ids || [])].sort().join(',')}`;
}

/**
 * Add refs to the basket.
 *
 * @param {Array} refs
 * @param {object} [opts]
 * @param {boolean} [opts.open]  open the console afterwards
 */
export function addStateMateContext(refs, { open = false } = {}) {
  const incoming = (Array.isArray(refs) ? refs : [refs]).filter(r => r && (r.ids?.length || r.kind === 'word'));
  if (!incoming.length) {
    if (open) openStateMate();
    return 0;
  }

  const seen = new Set(Session.context.map(contextKey));
  let added = 0;
  incoming.forEach(ref => {
    const key = contextKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    Session.context.push(ref);
    added++;
  });
  if (Session.context.length > CONTEXT_LIMIT) {
    Session.context = Session.context.slice(-CONTEXT_LIMIT);
  }

  if (open) {
    openStateMate();
  } else {
    renderContext();
    renderStatus();
    const summary = describeContext();
    showStatus(summary ? `StateMate context: ${summary}` : 'Added to StateMate context');
  }
  return added;
}

export function clearStateMateContext() {
  Session.context = [];
  renderContext();
  renderStatus();
}

/** A short phrase for the status toast and the composer's placeholder. */
function describeContext() {
  const focus = resolveContextRefs(Session.context);
  const parts = [];
  if (focus.states.length) parts.push(`${focus.states.length} state${focus.states.length === 1 ? '' : 's'}`);
  if (focus.transitions.length) parts.push(`${focus.transitions.length} transition${focus.transitions.length === 1 ? '' : 's'}`);
  if (focus.notes.length) parts.push(`${focus.notes.length} note${focus.notes.length === 1 ? '' : 's'}`);
  if (focus.words.length) parts.push(`${focus.words.length} word${focus.words.length === 1 ? '' : 's'}`);
  return parts.join(', ');
}

// One glyph per kind, in place of the word: a chip is already a name plus a
// close button, and a third piece of text made it a sentence.
const CONTEXT_TAGS = { states: 'state', transitions: 'edge', notes: 'note', word: 'word' };
const CONTEXT_ICONS = { states: 'state', transitions: 'edge', notes: 'note', word: 'word' };

/** One chip's label, resolved now rather than remembered from when it was added. */
function describeRef(ref) {
  const focus = resolveContextRefs([ref]);
  if (ref.kind === 'word') return focus.words[0] ?? '';
  if (ref.kind === 'states') return focus.states.join(', ');
  if (ref.kind === 'transitions') return focus.transitions.join('  ·  ');
  if (ref.kind === 'notes') return focus.notes.join(' ').slice(0, 60);
  return '';
}

/** Select what a chip points at, so clicking it answers "which one is that?" */
function revealRef(ref) {
  if (ref.kind === 'states') {
    App.selectedStates = new Set(ref.ids);
    App.selectedTransitions.clear();
    if (ref.ids.length === 1 && typeof hlState === 'function') hlState(ref.ids[0]);
  } else if (ref.kind === 'transitions') {
    App.selectedTransitions = new Set(ref.ids);
    App.selectedStates.clear();
  } else {
    return;
  }
  emit(Change.CANVAS);
}

function renderContext() {
  const host = $('sm-context');
  if (!host) return;
  host.innerHTML = '';
  if (!Session.context.length) return;

  const bar = el('div', 'sm-ctxbar');
  bar.append(el('span', 'sm-ctxbar-label', 'about'));

  Session.context.forEach(ref => {
    const label = describeRef(ref);
    const chip = el('span', 'sm-ctxchip');
    const tag = el('span', 'sm-ctxchip-tag');
    tag.append(icon(ICONS[CONTEXT_ICONS[ref.kind]] || ICONS.state, 'sm-ctxchip-icon'));
    tag.setAttribute('aria-label', CONTEXT_TAGS[ref.kind] || ref.kind);
    tag.dataset.tip = CONTEXT_TAGS[ref.kind] || ref.kind;
    chip.append(tag);
    // The name is the button: clicking it selects the thing on the canvas,
    // which is the answer to "which one was that again".
    chip.append(btn('sm-ctxchip-name', label || '(gone)', () => revealRef(ref),
      { tip: 'Select this on the canvas' }));
    chip.append(btn('sm-ctxchip-x', '✕', () => {
      Session.context = Session.context.filter(r => r !== ref);
      renderContext();
      renderStatus();
    }, { tip: 'Leave this out of the next prompt' }));
    bar.append(chip);
  });

  if (Session.context.length > 1) {
    bar.append(btn('sm-ctxbar-clear', 'clear', clearStateMateContext, { tip: 'Empty the context' }));
  }
  host.append(bar);
}

// ── from the canvas ──────────────────────────────────────────────
//  The right-click menus' way in. Selection-aware through the same helper the
//  note anchors use, so "add these to context" and "anchor a note to these"
//  mean the same set — right-clicking one of several selected states acts on
//  the selection, and on an unselected one acts on it alone.

function refsFromContextMenu() {
  const refs = [];
  if (App.ctxMode === 'note' && App.ctxNoteId) {
    refs.push({ kind: 'notes', ids: [App.ctxNoteId] });
    return refs;
  }
  const { states, transitions } = resolveNoteAnchorsForContext();
  if (states.length) refs.push({ kind: 'states', ids: states });
  if (transitions.length) refs.push({ kind: 'transitions', ids: transitions });
  return refs;
}

function closeCanvasMenus() {
  ['hideContextMenu', 'hideCanvasContextMenu'].forEach(fn => {
    if (typeof window !== 'undefined' && typeof window[fn] === 'function') window[fn]();
  });
}

/** Right-click → "Ask StateMate about this": adds the refs and opens. */
export function ctxAskStateMate() {
  const refs = refsFromContextMenu();
  closeCanvasMenus();
  addStateMateContext(refs, { open: true });
}

/** Right-click → "Add to StateMate context": adds without interrupting. */
export function ctxAddToStateMateContext() {
  const refs = refsFromContextMenu();
  closeCanvasMenus();
  if (!refs.length) return void showStatus('Nothing to add');
  addStateMateContext(refs);
}

/** Right-click on empty canvas → open the console with nothing selected. */
export function ctxCanvasAskStateMate() {
  closeCanvasMenus();
  openStateMate();
}

/** The current selection, from a keyboard shortcut or the status bar. */
export function askStateMateAboutSelection() {
  const refs = [];
  if (App.selectedStates.size) refs.push({ kind: 'states', ids: [...App.selectedStates] });
  if (App.selectedTransitions.size) refs.push({ kind: 'transitions', ids: [...App.selectedTransitions] });
  addStateMateContext(refs, { open: true });
}

// ══════════════════════════════════════════════════════════════════
//  THE NUDGE
// ══════════════════════════════════════════════════════════════════
//  An exact construction, offered without taking ⏎ away from the sentence
//  being typed.

function renderNudge() {
  const slot = $('sm-nudge');
  const input = $('sm-input');
  if (!slot || !input) return;
  slot.innerHTML = '';

  const text = String(input.value || '');
  if (isStateMateRunning() || text.startsWith('/')) return;
  const hit = matchingAlgorithms(text)[0];
  if (!hit) return;

  const bar = el('div', 'sm-nudge');
  bar.append(icon(ICONS.tool, 'sm-nudge-icon'));
  bar.append(el('span', null, `${hit.label} is built in — exact, and no model call.`));
  bar.append(btn('sm-nudge-link', 'Open it', () => openAlgorithm(hit.id)));
  slot.append(bar);
}

// ══════════════════════════════════════════════════════════════════
//  CHROME: HEADER ACTIONS AND THE STATUS LINE
// ══════════════════════════════════════════════════════════════════

// The placeholder is chrome too: it names the subject and the authority, both
// of which change under it. Setting it only on open left it describing a
// context that had since moved — "change this DFA" after the canvas was
// detached, "describe a DFA" after one was built.
function renderChrome() {
  renderHeadActions();
  renderStatus();
  renderContext();
  renderEditing();
  syncPlaceholder();
}

// ── rewriting a past turn ────────────────────────────────────────
//  ⏎ replaces a turn rather than adding one while this is up, which is the
//  only state in the console where the keystroke means something else. A
//  placeholder said so and the first character typed covered it up, so it is a
//  bar above the composer and a mark on the turn itself — and it has a way out
//  that is not "send something you did not mean to send".

function renderEditing() {
  const slot = $('sm-editing');
  if (!slot) return;
  slot.innerHTML = '';
  if (Session.editing) {
    const bar = el('div', 'sm-editing');
    bar.append(icon(ICONS.pencil, 'sm-editing-icon'));
    bar.append(el('span', null, 'Rewriting a turn — ⏎ replaces it, and everything after it.'));
    bar.append(btn('sm-editing-cancel', 'Cancel', cancelEditing,
      { tip: 'Leave the turn as it is' }));
    slot.append(bar);
  }
  syncEditingHighlight();
}

/**
 * Mark the turn being rewritten, on the node already on screen.
 *
 * Written straight to the DOM rather than through a re-render, the way
 * canvas.js toggles selection on the diagram: the class is not part of what
 * built the entry, and rebuilding it to add one would throw away an open diff.
 */
function syncEditingHighlight() {
  Session.nodes.forEach((node, entry) => {
    if (!node || !node.classList) return;
    node.classList.toggle('is-editing', !!Session.editing && entry.turnId === Session.editing);
  });
}

function cancelEditing() {
  Session.editing = '';
  setComposer('');
  renderChrome();
  focusInput();
}

function syncPlaceholder() {
  const input = $('sm-input');
  if (!input) return;
  // Session.busy rather than isStateMateRunning(): the console goes busy the
  // moment ⏎ is pressed, a beat before the orchestrator has an active run to
  // report, and a placeholder that flickers back to the idle text in between
  // is worse than one that is simply wrong.
  input.placeholder = Session.busy
    ? 'Working… esc or the stop button to interrupt'
    : composerPlaceholder();
}

// ── minimize ─────────────────────────────────────────────────────
//  The last thing between the console and the canvas it is docked over is its
//  own height. Minimizing gives that up and keeps everything else: the
//  transcript, the thread, the held proposal and a request in flight all
//  survive, because none of them live in the DOM. **Closing is the destructive
//  one** — its teardown interrupts a run — so this is deliberately not that,
//  and the ✕ stays beside it rather than being replaced by it.
//
//  Opening, by contrast, is never a no-op: the sparkle button, ⌘K and "ask
//  about this selection" all land in openStateMate, and a console that stayed
//  down for them would read as a broken button. So minimized is a way to put
//  the panel aside, not a state to come back to.

const UNREAD_KINDS = new Set(['machine', 'reply', 'error']);

/**
 * Turns that landed while the console was down.
 *
 * Derived from the transcript rather than tallied as entries arrive:
 * `minSince` is where it had got to when the console went down, and a run
 * entry is replaced *in place* by whatever it turns out to be. So an
 * interrupted run counts for nothing and a repaired one counts once, with no
 * bookkeeping at the three places a turn can end.
 */
function unreadCount() {
  if (!Session.minimized) return 0;
  return Session.log.slice(Session.minSince).filter(e => UNREAD_KINDS.has(e.kind)).length;
}

/** Write the collapsed state to the DOM — the class, and the button's two faces. */
function applyMinimized() {
  const shell = $(MODAL_ID);
  if (shell && shell.classList) shell.classList.toggle('is-min', Session.minimized);
  // The console is an obstacle the info card routes around, and putting it
  // away or bringing it back changes its footprint by most of the panel — so
  // the card gets its corner re-picked here, the way it is on a redock.
  repositionCanvasInfo();
  const button = $('sm-min');
  if (!button) return;
  button.setAttribute('aria-expanded', String(!Session.minimized));
  button.setAttribute('aria-label', Session.minimized ? 'Restore StateMate' : 'Minimize StateMate');
  button.dataset.tip = Session.minimized ? 'Restore' : 'Minimize';
}

function setMinimized(next) {
  const to = !!next;
  if (to === Session.minimized) return;
  const log = $('sm-log');

  if (to) {
    // A run in flight is the first thing the reader is waiting on, so the
    // count starts *at* it rather than after it — the entry is replaced in
    // place by whatever it turns out to be.
    const live = Session.run ? Session.log.indexOf(Session.run) : -1;
    Session.minSince = live === -1 ? Session.log.length : live;
    // A hidden element does not keep its scroll offset, and a reader who
    // scrolled up to re-read a turn should find it there on the way back —
    // the same decision scrollLogToEnd respects.
    Session.logTop = log ? log.scrollTop : 0;
  }

  Session.minimized = to;
  applyMinimized();
  renderChrome();

  if (to) return;
  if (log && !Session.pinned) log.scrollTop = Session.logTop;
  scrollLogToEnd();
  focusInput();
}

function renderHeadActions() {
  const host = $('sm-head-actions');
  if (!host) return;
  host.innerHTML = '';

  // Collapsed, the strip carries state rather than controls: Clear and
  // Settings act on a transcript that is not on screen to be acted on.
  if (Session.minimized) {
    const unread = unreadCount();
    if (Session.busy) {
      const chip = el('span', 'sm-minstat');
      chip.append(el('span', 'sm-spinner'));
      chip.append(el('span', null, 'Working…'));
      host.append(chip);
    } else if (unread) {
      host.append(el('span', 'sm-minstat is-new', `${unread} new`));
    }
    return;
  }

  if (getThread().length) {
    host.append(actionBtn('sm-headbtn', ICONS.trash, 'Clear', clearSession,
      { tip: 'Forget the conversation' }));
  }
  host.append(actionBtn('sm-headbtn', ICONS.gear, 'Settings', openStateMateSettings,
    { tip: 'API key, model and behaviour' }));
}

function statChip(text, { on = false, cta = false, onclick = null, tip = '', bold = '', disabled = false } = {}) {
  const node = onclick ? el('button', 'sm-stat') : el('span', 'sm-stat');
  if (onclick) {
    node.type = 'button';
    node.onclick = onclick;
    node.disabled = disabled;
  }
  if (on) node.classList.add('is-on');
  if (cta) node.classList.add('is-cta');
  if (tip) node.title = tip;
  if (bold) node.append(el('b', null, bold));
  if (text) node.append(el('span', null, text));
  return node;
}

function renderStatus() {
  const bar = $('sm-status');
  if (!bar) return;
  bar.innerHTML = '';

  const cfg = getMachineConfig(App.machine);
  const settings = getStateMateSettings();
  const ready = isStateMateReady(settings);

  bar.append(statChip('', { bold: cfg.label || App.machine, tip: cfg.fullName || App.machine }));

  if (ready) {
    const attached = effectiveAttach() && App.states.length > 0;
    const canvas = statChip(`Current canvas: ${canvasSummary()}`, {
      on: attached,
      disabled: !App.states.length,
      onclick: toggleCanvas,
      tip: App.states.length
        ? 'Show StateMate your current canvas state.'
        : 'Nothing on the canvas to send.'
    });
    canvas.setAttribute('aria-pressed', String(attached));
    canvas.insertBefore(icon(attached ? ICONS.eyeOpen : ICONS.eyeClose, 'sm-stat-icon'), canvas.firstChild);
    bar.append(canvas);

    const authority = AUTHORITY_COPY[Session.authority];
    bar.append(statChip(authority.label, {
      on: Session.authority !== 'auto',
      cta: Session.authority === 'ask',
      onclick: cycleAuthority,
      tip: authority.tip
    }));

    // Only when there is one. An empty basket needs no chip — the selection
    // arrives from the canvas, not from here.
    if (Session.context.length) {
      const focus = statChip(describeContext(), {
        on: true,
        onclick: clearStateMateContext,
        tip: 'The parts of the diagram this prompt is about — click to clear'
      });
      bar.append(focus);
    }

    // The canvas under the dock is live, so a selection can be made *while*
    // the console is open — which is the whole reason the basket exists and
    // was, until the panel stopped blocking, impossible without closing it.
    // Offered only when there is something selected that is not already in.
    const picked = App.selectedStates.size + App.selectedTransitions.size;
    if (picked && !Session.context.length) {
      const add = statChip(`Ask about ${picked} selected`, {
        cta: true,
        onclick: addSelectionToContext,
        tip: 'Make the next prompt about what is selected on the canvas'
      });
      add.insertBefore(icon(ICONS.plus, 'sm-stat-icon'), add.firstChild);
      bar.append(add);
    }

    // How much of the conversation rides with the next prompt. It is a real
    // setting with a real effect on the answer, and it was the one input to a
    // turn the status line did not state.
    const depth = Number(settings.threadDepth ?? 10);
    const turns = getThread().length;
    if (turns) {
      const sent = depth > 0 ? Math.min(turns, depth) : 0;
      bar.append(statChip(sent ? `${sent} recalled` : 'one-shot', {
        onclick: openStateMateSettings,
        tip: sent
          ? `The last ${sent} turn${sent === 1 ? '' : 's'} of this conversation are sent with the next prompt (of ${turns} kept). Click to change.`
          : 'History is off — each prompt is sent on its own. Click to change.'
      }));
    }

    const model = statChip(resolveEndpoint(settings).model, {
      onclick: openStateMateSettings,
      tip: `${providerConfig(settings.provider).label} · click to change`
    });
    model.insertBefore(icon(ICONS.spark, 'sm-stat-icon'), model.firstChild);
    bar.append(model);
  } else {
    const setup = statChip('Set up StateMate', { cta: true, onclick: openStateMateSettings });
    setup.insertBefore(icon(ICONS.spark, 'sm-stat-icon'), setup.firstChild);
    bar.append(setup);
  }

  const keys = el('div', 'sm-keys');
  const hints = isStateMateRunning()
    ? [['esc', 'interrupt']]
    : menuOpen()
      ? [['↑↓', 'move'], ['⏎', 'pick'], ['esc', 'dismiss']]
      : [['⏎', 'send'], ['⇧⏎', 'newline'], ['⇧⇥', AUTHORITY_COPY[Session.authority].label], ['/', 'commands'], ['esc', 'minimize']];
  hints.forEach(([key, what]) => {
    const hint = el('span', 'sm-key');
    hint.append(el('kbd', null, key));
    hint.append(el('span', null, what));
    keys.append(hint);
  });
  bar.append(keys);
}

// ══════════════════════════════════════════════════════════════════
//  THE COMPOSER
// ══════════════════════════════════════════════════════════════════

function focusInput() {
  // A minimized console has no composer on screen. Focusing it is a no-op in
  // the browser and a lie everywhere else — the caret would be reported as
  // being somewhere the reader cannot see.
  if (Session.minimized) return;
  const input = $('sm-input');
  if (input) input.focus();
}

function setComposer(text) {
  const input = $('sm-input');
  if (!input) return;
  input.value = text;
  Session.menuHidden = false;
  autosize();
  renderMenu();
  renderNudge();
  renderStatus();
}

/** The composer's own input handler: a keystroke un-dismisses the menu. */
function onComposerInput() {
  Session.menuHidden = false;
  autosize();
  renderMenu();
  renderNudge();
  renderStatus();
}

// ── the prompt history ───────────────────────────────────────────
//  ↑ and ↓ walk what has already been sent, the way a shell does.
//
//  It used to be ↑ only, and gated on an empty line — which meant it worked
//  exactly once: the recalled prompt filled the line, and the same guard then
//  refused to move again. Walking continues while the line still *is* the entry
//  it was filled with, so editing a recalled prompt ends the walk rather than
//  overwriting the edit, and ↓ comes back out of the history to an empty line.

/**
 * @param {number} delta -1 for older, +1 for newer.
 * @returns {boolean} true if the keystroke was spent on the history.
 */
function recallHistory(delta) {
  const input = $('sm-input');
  if (!input || !Session.history.length) return false;

  const at = Session.historyAt;
  const walking = at >= 0 && at < Session.history.length && input.value === Session.history[at];
  if (!walking) {
    // A draft is not history: ↑ only enters from an empty line, and ↓ has
    // nothing to come forward from until the walk has started.
    if (delta > 0 || input.value) return false;
    Session.historyAt = Session.history.length;
  }

  const next = Session.historyAt + delta;
  if (next < 0) return true;                       // already at the oldest
  if (next >= Session.history.length) {            // stepped back out of it
    Session.historyAt = -1;
    setComposer('');
    return true;
  }
  Session.historyAt = next;
  setComposer(Session.history[next]);
  return true;
}

/**
 * Whether an arrow key should walk the history rather than move the caret.
 *
 * A recalled prompt can be several lines long, and moving through it is what
 * the arrow is for once it is on the line — so ↑ only walks from the very
 * start of the text and ↓ only from the very end.
 */
function caretAtEdge(input, delta) {
  if (!input) return false;
  const value = String(input.value || '');
  const caret = typeof input.selectionStart === 'number' ? input.selectionStart : null;
  if (caret === null) return true;                 // a field that cannot say
  return delta < 0 ? caret === 0 : caret >= value.length;
}

function autosize() {
  const input = $('sm-input');
  if (!input || !input.style) return;
  input.style.height = 'auto';
  const h = Math.min(Number(input.scrollHeight) || 0, 132);
  if (h) input.style.height = `${h}px`;
}

/**
 * Reflect a request in flight.
 *
 * The send button becomes the stop button rather than going grey. Escape has
 * always interrupted, but a keystroke named in a placeholder is not a control
 * — and the one place the eye already is during a run is the button it just
 * pressed. `disabled` stays false for the same reason: it is a live control
 * throughout, it just does the opposite thing.
 */
function setBusy(busy) {
  Session.busy = !!busy;
  const composer = $('sm-composer');
  const sendBtn = $('sm-send');
  if (composer) composer.classList.toggle('is-busy', busy);
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.classList.toggle('is-stop', !!busy);
    sendBtn.setAttribute('aria-label', busy ? 'Stop StateMate' : 'Send to StateMate');
    sendBtn.dataset.tip = busy ? 'Stop' : 'Send';
    sendBtn.dataset.tipKbd = busy ? 'esc' : '⏎';
    sendBtn.innerHTML = '';
    sendBtn.append(icon(busy ? ICONS.stop : ICONS.send, 'sm-send-icon'));
  }
  // The minimized strip states this too, and it is the only thing on screen
  // while it is down — so the run's start and end are both rendered from here
  // rather than left to whoever happens to redraw the header next.
  renderHeadActions();
  syncPlaceholder();
}

/**
 * Put the caret back in the composer — unless the reader has taken it
 * somewhere else.
 *
 * A run ends whenever it ends, and by then the focus may be on the canvas
 * behind the dock or on a control in the transcript. Grabbing it back there is
 * the same bug as scrolling to the bottom under someone who scrolled up.
 */
function refocusComposer() {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const shell = $(MODAL_ID);
  const ours = !active
    || active === document.body
    || (shell && typeof shell.contains === 'function' && shell.contains(active));
  if (ours) focusInput();
}

function composerPlaceholder() {
  const cfg = getMachineConfig(App.machine);
  if (!isStateMateReady()) return 'Set up StateMate to build machines — or type /examples';
  // Rewriting a past turn is the one state where ⏎ does something other than
  // add to the conversation, so it says so where the caret is.
  if (Session.editing) return 'Rewrite this prompt — ⏎ replaces that turn';
  const about = Session.context.length ? ` about ${describeContext()}` : '';
  if (Session.authority === 'ask') {
    return `Ask${about ? about : ` about this ${cfg.label || App.machine}`} — read-only, nothing is drawn`;
  }
  if (about) return `Ask or change something${about} — or / for commands`;
  return turnIntent() === 'edit'
    ? `Ask about or change this ${cfg.label || App.machine} — or / for commands`
    : `Describe a ${cfg.label || App.machine} to build — or / for commands`;
}

/**
 * Send what is in the composer — the single path for ⏎ and for the button.
 *
 * It is one function because it was two: the button's copy dropped the
 * `branch`, so clicking Send while rewriting a past turn quietly appended a
 * new one instead of replacing it, in direct contradiction of the placeholder
 * promising the opposite.
 *
 * The promise is returned rather than dropped. A DOM event handler ignores the
 * value, so this changes nothing at runtime — it is what lets a test await the
 * run the keystroke starts.
 */
function submitComposer() {
  const input = $('sm-input');
  const text = String(input?.value || '').trim();
  if (!text) return void focusInput();

  // A slash line that got here has no menu — an unknown command. Say so rather
  // than sending "/wat" to a language model.
  if (text.startsWith('/')) {
    const slash = parseSlash(text);
    const cmd = slash && findCommand(slash.name);
    setComposer('');
    if (cmd) return cmd.run(slash.query);
    return note(`Unknown command “/${slash?.name || ''}”. Type / to see the list.`);
  }

  const replacing = Session.editing;
  setComposer('');
  return send(text, { branch: replacing });
}

function onInputKeydown(e) {
  if (e.key === 'Escape') return;   // handled by onEscape below, before the modal sees it

  // ⌘K opened this; with the caret in the composer it puts it back down, so
  // the one keystroke is the whole toggle. The other half is in ui.js, which
  // ignores keys aimed at the console precisely so this can answer them.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    return setMinimized(true);
  }

  // The arrows do one of two things and the menu has first claim: while it is
  // open they move the cursor through it, and otherwise they walk the history.
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    if (menuOpen()) {
      e.preventDefault();
      return moveMenu(delta);
    }
    const input = $('sm-input');
    if (caretAtEdge(input, delta) && recallHistory(delta)) {
      e.preventDefault();
      return;
    }
    return;                          // an ordinary caret move
  }

  // Shift+Tab cycles write authority, the way Claude Code cycles its
  // permission modes. Plain Tab still belongs to the completion menu.
  if (e.key === 'Tab' && e.shiftKey && !menuOpen()) {
    e.preventDefault();
    return cycleAuthority();
  }

  if (e.key === 'Tab' && menuOpen()) {
    e.preventDefault();
    const row = Session.menu.rows[Session.menu.index];
    return row ? row.run() : undefined;
  }

  if (e.key !== 'Enter') return;
  if (e.shiftKey) return;           // newline

  e.preventDefault();

  if (menuOpen()) {
    const row = Session.menu.rows[Session.menu.index];
    return row ? row.run() : undefined;
  }

  return submitComposer();
}

// ══════════════════════════════════════════════════════════════════
//  THE RUN
// ══════════════════════════════════════════════════════════════════

function setStage(entry, id, status, stageNote) {
  const index = entry.stages.findIndex(s => s.id === id);
  if (index === -1) return;
  // Everything before the stage that just started has, by definition, finished.
  for (let i = 0; i < index; i++) entry.stages[i].status = 'done';
  entry.stages[index].status = status;
  if (stageNote !== undefined) entry.stages[index].note = stageNote;
}

// Measured from ⏎ rather than from the request, because that is the wait the
// person actually sat through — the system prompt is assembled first.
function firstTokenLabel(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s to first token`;
}

async function send(prompt, { intent = turnIntent(), branch = '' } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return;
  if (!isStateMateReady()) {
    push({ kind: 'user', text });
    push({ kind: 'error', prompt: text, error: { code: 'no-key' } });
    renderLog();
    return;
  }

  // Replacing a turn rather than following it: drop the branch being left from
  // the transcript first, so the alternatives do not both appear as history.
  // The thread keeps them — the stepper on the surviving turn is how you get
  // back — but showing two answers to one question would read as two turns.
  const branchAt = branch || '';
  if (branchAt) {
    const at = Session.log.findIndex(e => e.turnId === branchAt);
    if (at !== -1) Session.log = Session.log.slice(0, at);
  }
  Session.editing = '';

  Session.lastPrompt = text;
  Session.historyAt = -1;
  if (Session.history[Session.history.length - 1] !== text) Session.history.push(text);

  // Not flagged as a turn yet — keyEntry does that once the thread has one.
  push({ kind: 'user', text });

  const entry = push({
    kind: 'run',
    prompt: text,
    label: 'Working',
    plan: '',
    reply: '',
    ttft: '',
    retry: '',
    stages: STAGE_ORDER.map(s => ({ ...s, status: 'idle', note: '' }))
  });
  Session.run = entry;
  setStage(entry, 'request', 'active');
  setBusy(true);
  renderLog();
  renderMenu();
  renderNudge();

  const settings = getStateMateSettings();
  const sentContext = Session.context.slice();
  let firstTokenSeen = false;
  const startedAt = Date.now();

  try {
    const result = await runStateMate({
      prompt: text,
      intent,
      attachCanvas: effectiveAttach(),
      authority: Session.authority,
      context: sentContext,
      branch: branchAt,
      onEvent: event => {
        // The two streamed fields go through the targeted update: a token
        // stream would otherwise rebuild the whole transcript per delta.
        if (event.type === 'plan') {
          entry.plan = event.text;
          if (!firstTokenSeen) { firstTokenSeen = true; entry.ttft = firstTokenLabel(startedAt); }
          updateRunText(entry);
          return;
        }
        if (event.type === 'reply-delta') {
          const had = !!entry.reply;
          entry.reply = event.text;
          if (!firstTokenSeen) { firstTokenSeen = true; entry.ttft = firstTokenLabel(startedAt); }
          // The first delta needs a node that does not exist yet.
          if (had) updateRunText(entry); else renderLog();
          return;
        }
        if (event.type === 'retry') {
          const wait = Math.round(event.waitMs / 100) / 10;
          entry.retry = `${describeError({ code: event.code, message: '' }).text} Retrying in ${wait}s (${event.attempt}/${event.of}).`;
          renderLog();
          return;
        }
        if (event.type === 'turn') {
          // The ids arrive once the thread has recorded the turn; from here the
          // entry can be found again after a branch switch.
          const userEntry = [...Session.log].reverse().find(e => e.kind === 'user' && !e.turnId);
          if (userEntry) keyEntry(userEntry, event.userId);
          entry.turnId = event.assistantId;
          return;
        }
        if (event.type !== 'stage') return;

        if (event.stage === 'repair') {
          setStage(entry, 'verify', 'active', 'fixing what failed…');
          renderLog();
          return;
        }
        const notes = {
          request: event.note || (settings.provider ? resolveEndpoint(settings).model : ''),
          compile: event.size || '',
          verify: event.count ? `${event.count} test${event.count === 1 ? '' : 's'}` : '',
          apply: event.hold ? 'held for review' : ''
        };
        setStage(entry, event.stage, 'active', notes[event.stage] ?? '');
        renderLog();
      }
    });

    Session.run = null;
    Session.runNodes = null;
    // The basket is spent: it described *that* sentence, and leaving it armed
    // would silently qualify every prompt after it.
    if (sentContext.length) clearStateMateContext();

    // A reply drew nothing. It is the whole of its turn, so it is shown in
    // full — and the console was going to stay open regardless.
    if (result.kind === 'reply') {
      const replyEntry = replaceEntry(entry, {
        kind: 'reply',
        text: result.reply,
        prompt: text,
        turnId: result.answerId || entry.turnId,
        // In ask mode a reply describing a machine is the plan; building it is
        // the same prompt again with the authority to write. That is the
        // "exit plan mode" step, and it is one button.
        offerBuild: Session.authority === 'ask',
        result
      });
      keyEntry(replyEntry, replyEntry.turnId);
      renderLog();
      announce('StateMate replied. Nothing was drawn.');
      showStatus('StateMate replied — nothing was drawn');
      return result;
    }

    const machineEntry = replaceEntry(entry, {
      kind: 'machine',
      title: result.spec?.title || 'Machine',
      prompt: text,
      turnId: result.answerId || entry.turnId,
      chips: summarizeDiff(result.diff),
      notes: resultNotes(result),
      result
    });
    keyEntry(machineEntry, machineEntry.turnId);
    renderLog();

    if (result.status === 'proposed') {
      announce(`StateMate proposed ${machineEntry.title}: ${machineEntry.chips.join(', ')}. Not drawn yet.`);
      showStatus(result.hold === 'scope'
        ? 'StateMate held a large edit back — review it in the console'
        : 'StateMate proposed a machine — review it in the console');
      return result;
    }

    // The info card over the canvas is the same result seen from the diagram's
    // side; the console is behind it and does not replace it.
    decorateResultCard(result);

    const verdict = verdictLabel(result);
    const summary = `${summarizeDiff(result.diff).join(', ')}${verdict ? ` · ${verdict}` : ''}`;
    announce(`StateMate drew ${machineEntry.title}. ${summary}`);
    showStatus(`StateMate: ${summary}`);
    return result;
  } catch (err) {
    Session.run = null;
    if (err?.code === 'cancelled') {
      replaceEntry(entry, { kind: 'note', text: 'Interrupted.' });
      announce('Interrupted.');
      renderLog();
      return;
    }
    replaceEntry(entry, { kind: 'error', prompt: text, error: err });
    announce(describeError(err).text);
    renderLog();
  } finally {
    Session.runNodes = null;
    setBusy(false);
    renderMenu();
    renderNudge();
    renderStatus();
    refocusComposer();
  }
}

// ══════════════════════════════════════════════════════════════════
//  THE RESULT STRIP
// ══════════════════════════════════════════════════════════════════
//  The info card over the canvas already renders a title, a blurb and
//  clickable test chips, which is exactly what a StateMate result is. Rather
//  than build a second one, this decorates that card in place — so the result
//  lands beside the diagram it describes as well as in the transcript.

export function decorateResultCard(result) {
  const card = $('example-card');
  if (!card) return;

  card.classList.add('sm-result');
  card.classList.toggle('sm-result-warn', hasWarnings(result));

  const strip = el('div', 'sm-result-strip');

  const badge = el('span', 'sm-result-badge');
  badge.append(icon(ICONS.spark, 'sm-stat-icon'));
  badge.append(el('span', null, 'StateMate'));
  strip.append(badge);

  const chips = el('span', 'sm-result-chips');
  summarizeDiff(result.diff).forEach(text => chips.append(el('span', 'sm-result-chip', text)));

  const verdict = verdictLabel(result);
  if (verdict) {
    const tone = result.batch?.allPassed ? ' is-pass' : ' is-fail';
    chips.append(el('span', `sm-result-chip sm-result-verdict${tone}`, verdict));
  }
  strip.append(chips);

  // The card leads with the machine's own name — it is the title of the thing
  // on screen. What changed is a line under it, and what you can do about it
  // is at the bottom, where a footer belongs. Prepending the strip put a row
  // of diff chips and three buttons above the name, which read as the card's
  // heading and pushed the title into the middle of its own card.
  const head = card.firstChild;
  card.insertBefore(strip, head ? head.nextSibling : null);

  // Everything the run found that is true but not fatal: an extended alphabet,
  // an unreachable state, a check that failed, the model's own caveat. Shown,
  // never silent — a fix the user cannot see is a fix they cannot distrust.
  // resultNotes() orders them by severity, because only the first few fit.
  const notes = resultNotes(result);
  if (notes.length) {
    const list = el('ul', 'sm-result-notes');
    notes.slice(0, 4).forEach(n => list.append(el('li', `sm-result-note is-${n.severity}`, n.message)));
    card.append(list);
  }

  const actions = el('div', 'sm-result-actions');
  // The same checkpoint the console offers, for the same reason: undo() pops
  // whatever is on top of the stack, which stops being this turn as soon as
  // anything else is edited.
  if (hasCheckpoint(result.checkpoint)) {
    actions.append(actionBtn('sm-mini', ICONS.undo, 'Revert', () => {
      restoreCheckpoint(result.checkpoint);
      showExampleCard(null);
    }, { tip: 'Put the canvas back as it was before this turn' }));
  } else {
    actions.append(actionBtn('sm-mini', ICONS.undo, 'Undo', () => { undo(); showExampleCard(null); },
      { tip: 'Undo the last change' }));
  }
  actions.append(actionBtn('sm-mini', ICONS.retry, 'Regenerate', () => {
    openStateMate();
    send(Session.lastPrompt, { branch: result.turnId });
  }, { tip: 'Ask again with the same prompt' }));
  actions.append(actionBtn('sm-mini', ICONS.layout, 'Re-layout', () => relayoutLastResult(),
    { tip: 'Rearrange the diagram automatically' }));
  card.append(actions);

  const foot = el('div', 'sm-result-foot');
  const bits = resultMetaBits(result);
  const hint = testHint(App.machine);
  if (hint) bits.push(hint);
  foot.textContent = bits.join(' · ');
  if (bits.length) card.append(foot);
}

// ══════════════════════════════════════════════════════════════════
//  OPEN / CLOSE
// ══════════════════════════════════════════════════════════════════

registerModal(MODAL_ID, {
  // A dock, not a dialog: the canvas behind it stays live, so the console
  // keeps its Escape chain and its close bookkeeping and gives up the scroll
  // lock, the Tab trap and the pointer. See `dock` in js/modal.js.
  dock: true,
  // …and with the canvas reachable, a click on it is work rather than a
  // dismissal. Closing is the ✕, Escape, or the header button that opened it.
  dismissOnBackdrop: false,
  // Escape has three jobs here and the modal core owns the last one. Taking
  // the first two through the registry keeps modal.js from importing this
  // module — the same reason the symbol-suggest popover is exempted there.
  onEscape: () => {
    if (menuOpen()) {
      // The menu goes, the line stays. Clearing the composer here meant
      // dismissing a completion list also deleted the command being written.
      Session.menuHidden = true;
      renderMenu();
      renderStatus();
      return true;
    }
    if (isStateMateRunning()) {
      cancelStateMate();
      return true;
    }
    // Escape puts the console away rather than tearing it down. A session is
    // worth more than the keystroke that dismisses a dialog, and closing is
    // the one that ends a run and hands the transcript back to the thread.
    // The ladder still bottoms out: with the strip already down Escape is not
    // consumed, so the second one closes and the third belongs to the canvas.
    if (!Session.minimized) {
      setMinimized(true);
      return true;
    }
    return false;
  },
  onClose: () => {
    Session.exampleRequest++;
    if (isStateMateRunning()) cancelStateMate();
    const btnEl = $('example-picker-btn');
    if (btnEl) btnEl.setAttribute('aria-expanded', 'false');
    // The bottom of the canvas is free again; the card may want it back.
    repositionCanvasInfo();
  }
});

// ── the canvas underneath ────────────────────────────────────────
//  A dock does not freeze what it sits over, so the diagram can change while
//  the console is open: a state selected, a transition drawn, a word run, an
//  undo. Everything here that *states* the canvas has to hear about it.
//
//  Subscribed at module scope beside the functions they call, the way
//  render.js and alphabet.js do it, and gated on the console being open so a
//  closed one costs nothing.

subscribe(Change.CANVAS, () => {
  if (!isModalOpen(MODAL_ID)) return;
  renderContext();
  renderStatus();
});

subscribe(Change.GRAPH, () => {
  if (!isModalOpen(MODAL_ID)) return;
  // A held proposal was computed against a particular machine, and its card
  // says so by comparing signatures at render time. An edit made behind the
  // console is exactly the case that comparison exists for, so the card has to
  // be rebuilt — otherwise "Apply" goes on claiming to be current.
  let held = false;
  Session.log.forEach(entry => {
    if (entry.kind !== 'machine' || !entry.result?.pending) return;
    invalidate(entry);
    held = true;
  });
  if (held) renderLog();
  else {
    renderContext();
    renderStatus();
  }
});

/** The header button's entry point — the one name this feature adds to bridge.js. */
export function openStateMate() {
  // Close the lightweight popovers before the modal takes the focus stack.
  ['hideTabOverflowMenu', 'hideTabContextMenu', 'hideContextMenu', 'hideCanvasContextMenu']
    .forEach(fn => {
      if (typeof window !== 'undefined' && typeof window[fn] === 'function') window[fn]();
    });

  Session.attachCanvas = null;
  Session.menu = { rows: [], index: 0 };
  Session.menuHidden = false;
  Session.historyAt = -1;
  // Opening lands on the newest line, whatever the last session's reader had
  // scrolled to.
  Session.pinned = true;
  // A half-finished rewrite does not survive closing the dialog: ⏎ would
  // otherwise replace a turn the reader has stopped looking at.
  Session.editing = '';
  // Authority is deliberately *not* reset on open. It is a standing decision
  // about how much this tool may touch your work, and one that silently
  // reverted to the default every time the dialog opened would be worse than
  // no setting at all.
  syncLogWithThread();

  const request = ++Session.exampleRequest;
  Session.examples = getMachineExampleOptions().map(opt => ({ ...opt, meta: null }));

  const input = $('sm-input');
  if (input) {
    input.value = '';
    input.placeholder = composerPlaceholder();
    input.oninput = onComposerInput;
    input.onkeydown = onInputKeydown;
  }

  const send$ = $('sm-send');
  if (send$) {
    // One control, two jobs, and which one it is doing is on its face — see
    // setBusy. Both go through the same path the keyboard does.
    send$.onclick = () => (isStateMateRunning() ? cancelStateMate() : submitComposer());
  }

  const log = $('sm-log');
  if (log) log.onscroll = onLogScroll;

  const jump = $('sm-jump');
  if (jump) jump.onclick = () => { scrollLogToEnd(true); focusInput(); };

  const minBtn = $('sm-min');
  if (minBtn) minBtn.onclick = () => setMinimized(!Session.minimized);

  // Collapsed, the strip itself is the way back up — except where the click
  // landed on one of its own buttons, which have their own jobs.
  const head = $('sm-head');
  if (head) {
    head.onclick = e => {
      if (!Session.minimized) return;
      if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return;
      setMinimized(false);
    };
  }

  // Opening is never a no-op — see the note above setMinimized.
  setMinimized(false);

  const opener = $('example-picker-btn');
  if (opener) opener.setAttribute('aria-expanded', 'true');

  setBusy(isStateMateRunning());
  renderLog();
  renderMenu();
  renderNudge();
  renderContext();
  showOverlay(MODAL_ID);
  focusInput();
  // Now that the console is on screen and measurable, move the info card out
  // from under it — applyMinimized above ran while it was still hidden.
  repositionCanvasInfo();

  // Rich descriptions arrive from the same JSON files the loader uses. The
  // list is already usable; this only fills in the blurbs, and a malformed
  // file must not close the dialog or move the focus.
  Promise.all(Session.examples.map(opt =>
    fetch(`js/examples/${opt.file}.json`)
      .then(res => (res.ok === false ? null : res.json()))
      .then(data => ({ ...opt, meta: data?.meta || null }))
      .catch(() => opt)
  )).then(enriched => {
    if (request !== Session.exampleRequest) return;
    Session.examples = enriched;
    renderLog();
    renderMenu();
  });
}

// ══════════════════════════════════════════════════════════════════
//  SETTINGS PANEL
// ══════════════════════════════════════════════════════════════════
//  App.config is deliberately not involved — see the note at the top of
//  statemate-provider.js. These two functions are called from
//  openSettingsModal / confirmSettings in ui.js.

export function openStateMateSettings() {
  openAppSettings('ai');
}

function setValue(id, value) {
  const node = $(id);
  if (!node) return;
  if (node.type === 'checkbox') node.checked = !!value;
  else node.value = value ?? '';
}

function getValue(id, fallback = '') {
  const node = $(id);
  if (!node) return fallback;
  return node.type === 'checkbox' ? node.checked : node.value;
}

/** Reflect the provider preset into the placeholder text and hints. */
function syncProviderHints() {
  const provider = getValue('set-sm-provider', 'anthropic');
  const preset = PROVIDERS[provider] || PROVIDERS.anthropic;
  const base = $('set-sm-base');
  const model = $('set-sm-model');
  const key = $('set-sm-key');
  const noteEl = $('sm-provider-note');
  if (base) base.placeholder = preset.baseUrl;
  if (model) model.placeholder = preset.model;
  if (key) key.placeholder = preset.keyHint;
  if (noteEl) noteEl.textContent = preset.browserNote;
  const keyLabel = $('sm-key-label');
  if (keyLabel) keyLabel.textContent = preset.keyLabel;
}

export function populateStateMateSettings() {
  const s = getStateMateSettings();
  setValue('set-sm-enabled', s.enabled);
  setValue('set-sm-provider', s.provider);
  setValue('set-sm-base', s.baseUrl);
  setValue('set-sm-model', s.model);
  setValue('set-sm-key', s.apiKey);
  setValue('set-sm-attach', s.attachCanvas);
  setValue('set-sm-verify', s.verify);
  setValue('set-sm-repairs', String(s.repairAttempts ?? 1));
  setValue('set-sm-notes', s.writeNotes);
  setValue('set-sm-newtab', s.newTabForBuild);
  setValue('set-sm-thread', String(s.threadDepth ?? 10));
  syncProviderHints();

  const status = $('sm-conn-status');
  if (status) { status.textContent = ''; status.className = 'sm-conn-status'; }

  const provider = $('set-sm-provider');
  if (provider && !provider.dataset.wired) {
    provider.dataset.wired = '1';
    provider.addEventListener('change', syncProviderHints);
  }

  const test = $('sm-test-btn');
  if (test && !test.dataset.wired) {
    test.dataset.wired = '1';
    test.addEventListener('click', runConnectionTest);
  }

  const clear = $('sm-clear-key');
  if (clear && !clear.dataset.wired) {
    clear.dataset.wired = '1';
    clear.addEventListener('click', () => {
      setValue('set-sm-key', '');
      saveStateMateSettings({ apiKey: '' });
      showStatus('StateMate key cleared');
    });
  }
}

export function applyStateMateSettings() {
  saveStateMateSettings({
    enabled: !!getValue('set-sm-enabled', false),
    provider: getValue('set-sm-provider', 'anthropic'),
    baseUrl: String(getValue('set-sm-base', '')).trim(),
    model: String(getValue('set-sm-model', '')).trim(),
    apiKey: String(getValue('set-sm-key', '')).trim(),
    attachCanvas: !!getValue('set-sm-attach', true),
    verify: !!getValue('set-sm-verify', true),
    repairAttempts: Number(getValue('set-sm-repairs', '1')) || 0,
    writeNotes: !!getValue('set-sm-notes', false),
    newTabForBuild: !!getValue('set-sm-newtab', true),
    threadDepth: Number(getValue('set-sm-thread', '10')) || 0
  });
}

async function runConnectionTest() {
  const status = $('sm-conn-status');
  const button = $('sm-test-btn');
  if (!status) return;

  // The dialog's values are what the user is testing, not what was last saved.
  applyStateMateSettings();

  status.textContent = 'Testing…';
  status.className = 'sm-conn-status is-busy';
  if (button) button.disabled = true;

  try {
    const result = await testConnection();
    status.textContent = `Connected to ${result.model} in ${result.ms}ms`;
    status.className = 'sm-conn-status is-ok';
  } catch (err) {
    const info = describeError(err);
    status.textContent = info.text;
    status.className = 'sm-conn-status is-bad';
  } finally {
    if (button) button.disabled = false;
  }
}

/** Test seam — module-level session state must not cross tests. */
export function _resetPaletteForTests() {
  Session.log = [];
  Session.authority = 'propose';
  Session.attachCanvas = null;
  Session.examples = [];
  Session.exampleRequest = 0;
  Session.menu = { rows: [], index: 0 };
  Session.menuHidden = false;
  Session.run = null;
  Session.runNodes = null;
  Session.history = [];
  Session.historyAt = -1;
  Session.lastPrompt = '';
  Session.context = [];
  Session.entries = new Map();
  Session.editing = '';
  Session.nodes = new Map();
  Session.welcome = false;
  Session.pinned = true;
  Session.busy = false;
  Session.minimized = false;
  Session.minSince = 0;
  Session.logTop = 0;
}

export { describeSpecSize };
