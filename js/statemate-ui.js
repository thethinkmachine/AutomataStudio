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
//  Nothing here is reached from an on* attribute. Listeners are attached at
//  creation, the way reference.js does it, so the feature adds exactly one
//  name to bridge.js — the entry point the header button calls.

import { closeModal, registerModal, showOverlay } from './modal.js';
import { $, App, getMachineConfig } from './state.js';
import { undo } from './history.js';
import { renderMarkdown } from './markdown.js';
import { triggerMath } from './reference.js';
import {
  filterMachineExampleOptions, getMachineExampleOptions, loadExampleFile,
  showExampleCard
} from './persistence.js';
import {
  AUTHORITIES, applyPending, cancelStateMate, clearThread, describeError,
  getThread, hasWarnings, isStateMateRunning, machineSignature,
  relayoutLastResult, resultNotes, runStateMate, testHint, verdictLabel
} from './statemate.js';
import { summarizeDiff } from './statemate-compile.js';
import {
  PROVIDERS, getStateMateSettings, isStateMateReady, providerConfig,
  resolveEndpoint, saveStateMateSettings, testConnection
} from './statemate-provider.js';
import { editStarterPrompts, starterPrompts } from './statemate-prompt.js';
import { describeSpecSize } from './statemate-spec.js';
import { openSettingsModal, switchSettingsTab } from './ui.js';
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
  run: null,           // the live entry while a request is in flight
  history: [],         // sent prompts, newest last — ↑ on an empty line
  historyAt: -1,
  lastPrompt: ''
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
  tool: 'M226.76,69a8,8,0,0,0-12.84-2.88l-40.3,37.19-17.23-3.7-3.7-17.23,37.19-40.3A8,8,0,0,0,187,29.24,72,72,0,0,0,88,96,72.34,72.34,0,0,0,94,124.94L33.79,177.79l-.36.34a32,32,0,0,0,45.26,45.26l.34-.36L131.06,162A72,72,0,0,0,232,96,71.56,71.56,0,0,0,226.76,69Z'
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

const AUTHORITY_COPY = {
  ask: {
    label: 'ask',
    blurb: 'Read-only. StateMate answers and explains; the canvas is never touched.',
    tip: 'Read-only: questions get answers and nothing is drawn. Shift+Tab to cycle.'
  },
  propose: {
    label: 'propose',
    blurb: 'StateMate builds and checks a machine, then shows you the diff before drawing it.',
    tip: 'Every machine is built, checked and shown to you before it reaches the canvas. Shift+Tab to cycle.'
  },
  auto: {
    label: 'auto',
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
  Session.log.push(entry);
  return entry;
}

function note(text) {
  push({ kind: 'note', text });
  renderLog();
}

function replaceEntry(target, next) {
  const i = Session.log.indexOf(target);
  if (i === -1) push(next);
  else Session.log[i] = next;
  return next;
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
function syncLogWithThread() {
  const thread = getThread();
  if (Session.log.filter(e => e.turn).length === thread.length) return;

  Session.log = thread.map(turn => {
    if (turn.role === 'user') return { kind: 'user', text: turn.text, turn: true };
    if (turn.kind === 'reply') return { kind: 'reply', text: turn.text, turn: true };
    return { kind: 'machine', title: turn.text, chips: [], notes: [], result: null, turn: true };
  });
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
    hint.append(el('span', null, 'Type / for commands — /examples browses the bundled machines, /help lists the rest.'));
    host.append(hint);
  }
}

// ── entries ──────────────────────────────────────────────────────

function renderUser(entry) {
  const row = el('div', 'sm-entry is-user sm-line');
  row.append(el('span', 'sm-mark', '›'));
  row.append(el('div', 'sm-user-text', entry.text));
  return row;
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

  if (entry.plan) wrap.append(el('div', 'sm-plan', entry.plan));
  return wrap;
}

/** Draw a held proposal, and turn its entry into an ordinary applied machine. */
function acceptProposal(entry) {
  const applied = applyPending(entry.result);
  if (!applied) return;
  entry.result = applied;
  entry.chips = summarizeDiff(applied.diff);
  renderLog();
  decorateResultCard(applied);
  const verdict = verdictLabel(applied);
  showStatus(`StateMate: ${entry.chips.join(', ')}${verdict ? ` · ${verdict}` : ''}`);
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
    const actions = el('div', 'sm-actions');
    if (held) {
      const stale = result.pending.signature !== machineSignature();
      actions.append(btn('sm-btn sm-btn-primary', stale ? 'Apply anyway' : 'Apply', () => acceptProposal(entry),
        {
          tip: stale
            ? 'The canvas has changed since this was proposed — applying replaces it wholesale'
            : 'Draw this on the canvas'
        }));
      actions.append(btn('sm-btn', 'Discard', () => {
        replaceEntry(entry, { kind: 'note', text: `Discarded “${entry.title}”. Nothing was drawn.` });
        renderLog();
      }, { tip: 'Throw the proposal away' }));
      actions.append(btn('sm-btn', 'Ask again', () => send(entry.prompt),
        { tip: 'Send the same prompt again' }));
      card.append(actions);
      if (stale) {
        card.append(el('div', 'sm-hold is-stale',
          'The canvas has changed since this was proposed, so the numbers above no longer describe it.'));
      }
    } else {
      actions.append(btn('sm-btn sm-btn-primary', 'Show on canvas', () => closeModal(MODAL_ID),
        { tip: 'Close the console and look at the diagram' }));
      actions.append(btn('sm-btn', 'Undo', () => {
        undo();
        showExampleCard(null);
        note('Undid the last change.');
      }, { tip: 'Undo everything StateMate just did' }));
      actions.append(btn('sm-btn', 'Ask again', () => send(entry.prompt),
        { tip: 'Send the same prompt again' }));
      actions.append(btn('sm-btn', 'Re-layout', () => {
        relayoutLastResult();
        note('Rearranged the diagram.');
      }, { tip: 'Rearrange the diagram automatically' }));
      card.append(actions);
    }

    const bits = [];
    if (result.model) bits.push(result.model);
    if (result.usage?.input || result.usage?.output) {
      bits.push(`${result.usage.input ?? '?'} in / ${result.usage.output ?? '?'} out`);
    }
    if (result.repaired) bits.push('repaired once');
    if (result.openedNewTab) bits.push('opened in a new tab');
    const hint = testHint(App.machine);
    if (hint) bits.push(hint);
    if (bits.length) card.append(el('div', 'sm-meta', bits.join(' · ')));
  }

  wrap.append(card);
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
    actions.append(btn('sm-btn sm-btn-primary', 'Build this', () => {
      setAuthority('propose', { quiet: true });
      send(entry.prompt);
    }, { tip: 'Leave ask mode and build it, so you can review the machine before it lands' }));
    card.append(actions);
  }

  wrap.append(card);
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
    actions.append(btn('sm-btn sm-btn-primary', info.label, openStateMateSettings));
  }
  if (info.action === 'retry' || info.action === 'settings') {
    const primary = info.action === 'retry';
    actions.append(btn(`sm-btn${primary ? ' sm-btn-primary' : ''}`, primary ? info.label : 'Try again',
      () => send(entry.prompt)));
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

function renderLog() {
  const log = $('sm-log');
  if (!log) return;
  log.innerHTML = '';

  if (!Session.log.length) renderWelcome(log);
  else Session.log.forEach(entry => {
    const build = RENDERERS[entry.kind];
    if (build) log.append(build(entry));
  });

  renderChrome();
  // The newest line is the one being read; a transcript that opens at the top
  // makes the reader scroll to find out what just happened.
  log.scrollTop = log.scrollHeight;
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
  Session.run = null;
  renderLog();
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

  const rows = isStateMateRunning() ? [] : menuRows(input.value || '');
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
  syncPlaceholder();
}

function syncPlaceholder() {
  const input = $('sm-input');
  if (!input) return;
  // Session.busy rather than isStateMateRunning(): the console goes busy the
  // moment ⏎ is pressed, a beat before the orchestrator has an active run to
  // report, and a placeholder that flickers back to the idle text in between
  // is worse than one that is simply wrong.
  input.placeholder = Session.busy
    ? 'Working… press esc to interrupt'
    : composerPlaceholder();
}

function renderHeadActions() {
  const host = $('sm-head-actions');
  if (!host) return;
  host.innerHTML = '';

  if (getThread().length) {
    host.append(btn('sm-headbtn', 'Clear', clearSession, { tip: 'Forget the conversation' }));
  }
  host.append(btn('sm-headbtn', 'Settings', openStateMateSettings, { tip: 'API key, model and behaviour' }));
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
    const canvas = statChip(`canvas · ${canvasSummary()}`, {
      on: attached,
      disabled: !App.states.length,
      onclick: toggleCanvas,
      tip: App.states.length
        ? 'Send the machine on the canvas with your prompt. Off means build from scratch.'
        : 'Nothing on the canvas to send.'
    });
    canvas.setAttribute('aria-pressed', String(attached));
    canvas.insertBefore(icon(attached ? ICONS.check : ICONS.close, 'sm-stat-icon'), canvas.firstChild);
    bar.append(canvas);

    const authority = AUTHORITY_COPY[Session.authority];
    bar.append(statChip(authority.label, {
      on: Session.authority !== 'auto',
      cta: Session.authority === 'ask',
      onclick: cycleAuthority,
      tip: authority.tip
    }));

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
      : [['⏎', 'send'], ['⇧⏎', 'newline'], ['⇧⇥', AUTHORITY_COPY[Session.authority].label], ['/', 'commands'], ['esc', 'close']];
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
  const input = $('sm-input');
  if (input) input.focus();
}

function setComposer(text) {
  const input = $('sm-input');
  if (!input) return;
  input.value = text;
  autosize();
  renderMenu();
  renderNudge();
  renderStatus();
}

function autosize() {
  const input = $('sm-input');
  if (!input || !input.style) return;
  input.style.height = 'auto';
  const h = Math.min(Number(input.scrollHeight) || 0, 132);
  if (h) input.style.height = `${h}px`;
}

function setBusy(busy) {
  const composer = $('sm-composer');
  const sendBtn = $('sm-send');
  if (composer) composer.classList.toggle('is-busy', busy);
  if (sendBtn) sendBtn.disabled = busy;
  syncPlaceholder();
}

function composerPlaceholder() {
  const cfg = getMachineConfig(App.machine);
  if (!isStateMateReady()) return 'Set up StateMate to build machines — or type /examples';
  if (Session.authority === 'ask') {
    return `Ask about this ${cfg.label || App.machine} — read-only, nothing is drawn`;
  }
  return turnIntent() === 'edit'
    ? `Ask about or change this ${cfg.label || App.machine} — or / for commands`
    : `Describe a ${cfg.label || App.machine} to build — or / for commands`;
}

function onInputKeydown(e) {
  if (e.key === 'Escape') return;   // handled by onEscape below, before the modal sees it

  if (e.key === 'ArrowDown' && menuOpen()) { e.preventDefault(); return moveMenu(1); }
  if (e.key === 'ArrowUp' && menuOpen()) { e.preventDefault(); return moveMenu(-1); }

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

  // ↑ on an empty line walks back through what was already sent, the way a
  // shell does. It is only bound while the line is empty, so it never fights
  // with moving the caret through a prompt being edited.
  const input = $('sm-input');
  if (e.key === 'ArrowUp' && input && !input.value && Session.history.length) {
    e.preventDefault();
    Session.historyAt = Session.historyAt < 0
      ? Session.history.length - 1
      : Math.max(0, Session.historyAt - 1);
    setComposer(Session.history[Session.historyAt]);
    return;
  }

  if (e.key !== 'Enter') return;
  if (e.shiftKey) return;           // newline

  e.preventDefault();

  if (menuOpen()) {
    const row = Session.menu.rows[Session.menu.index];
    return row ? row.run() : undefined;
  }

  const text = String(input?.value || '').trim();
  if (!text) return;

  // A slash line that got here has no menu — an unknown command. Say so rather
  // than sending "/wat" to a language model.
  if (text.startsWith('/')) {
    const slash = parseSlash(text);
    const cmd = slash && findCommand(slash.name);
    setComposer('');
    if (cmd) return cmd.run(slash.query);
    return note(`Unknown command “/${slash?.name || ''}”. Type / to see the list.`);
  }

  setComposer('');
  // The promise is returned rather than dropped. A DOM event handler ignores
  // the value, so this changes nothing at runtime — it is what lets a test
  // await the run the keystroke starts.
  return send(text);
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

async function send(prompt, { intent = turnIntent() } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return;
  if (!isStateMateReady()) {
    push({ kind: 'user', text });
    push({ kind: 'error', prompt: text, error: { code: 'no-key' } });
    renderLog();
    return;
  }

  Session.lastPrompt = text;
  Session.historyAt = -1;
  if (Session.history[Session.history.length - 1] !== text) Session.history.push(text);

  push({ kind: 'user', text });

  const entry = push({
    kind: 'run',
    prompt: text,
    label: 'Working',
    plan: '',
    stages: STAGE_ORDER.map(s => ({ ...s, status: 'idle', note: '' }))
  });
  Session.run = entry;
  setStage(entry, 'request', 'active');
  setBusy(true);
  renderLog();
  renderMenu();
  renderNudge();

  const settings = getStateMateSettings();

  try {
    const result = await runStateMate({
      prompt: text,
      intent,
      attachCanvas: effectiveAttach(),
      authority: Session.authority,
      onEvent: event => {
        if (event.type === 'plan') {
          entry.plan = event.text;
          renderLog();
          return;
        }
        if (event.type !== 'stage') return;

        if (event.stage === 'repair') {
          setStage(entry, 'verify', 'active', 'fixing what failed…');
          renderLog();
          return;
        }
        const notes = {
          request: settings.provider ? resolveEndpoint(settings).model : '',
          compile: event.size || '',
          verify: event.count ? `${event.count} test${event.count === 1 ? '' : 's'}` : '',
          apply: event.hold ? 'held for review' : ''
        };
        setStage(entry, event.stage, 'active', notes[event.stage] ?? '');
        renderLog();
      }
    });

    Session.run = null;

    // A reply drew nothing. It is the whole of its turn, so it is shown in
    // full — and the console was going to stay open regardless.
    if (result.kind === 'reply') {
      replaceEntry(entry, {
        kind: 'reply',
        text: result.reply,
        prompt: text,
        // In ask mode a reply describing a machine is the plan; building it is
        // the same prompt again with the authority to write. That is the
        // "exit plan mode" step, and it is one button.
        offerBuild: Session.authority === 'ask',
        result
      });
      renderLog();
      showStatus('StateMate replied — nothing was drawn');
      return result;
    }

    replaceEntry(entry, {
      kind: 'machine',
      title: result.spec?.title || 'Machine',
      prompt: text,
      chips: summarizeDiff(result.diff),
      notes: resultNotes(result),
      result
    });
    renderLog();

    if (result.status === 'proposed') {
      showStatus(result.hold === 'scope'
        ? 'StateMate held a large edit back — review it in the console'
        : 'StateMate proposed a machine — review it in the console');
      return result;
    }

    // The info card over the canvas is the same result seen from the diagram's
    // side; the console is behind it and does not replace it.
    decorateResultCard(result);

    const verdict = verdictLabel(result);
    showStatus(`StateMate: ${summarizeDiff(result.diff).join(', ')}${verdict ? ` · ${verdict}` : ''}`);
    return result;
  } catch (err) {
    Session.run = null;
    if (err?.code === 'cancelled') {
      replaceEntry(entry, { kind: 'note', text: 'Interrupted.' });
      renderLog();
      return;
    }
    replaceEntry(entry, { kind: 'error', prompt: text, error: err });
    renderLog();
  } finally {
    setBusy(false);
    renderMenu();
    renderNudge();
    renderStatus();
    focusInput();
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
  actions.append(btn('sm-mini', 'Undo', () => { undo(); showExampleCard(null); },
    { tip: 'Undo everything StateMate just did' }));
  actions.append(btn('sm-mini', 'Regenerate', () => {
    openStateMate();
    send(Session.lastPrompt);
  }, { tip: 'Ask again with the same prompt' }));
  actions.append(btn('sm-mini', 'Re-layout', () => relayoutLastResult(),
    { tip: 'Rearrange the diagram automatically' }));
  card.append(actions);

  const foot = el('div', 'sm-result-foot');
  const bits = [];
  if (result.model) bits.push(result.model);
  if (result.usage?.input || result.usage?.output) {
    bits.push(`${result.usage.input ?? '?'} in / ${result.usage.output ?? '?'} out`);
  }
  if (result.repaired) bits.push('repaired once');
  if (result.openedNewTab) bits.push('opened in a new tab');
  const hint = testHint(App.machine);
  if (hint) bits.push(hint);
  foot.textContent = bits.join(' · ');
  if (bits.length) card.append(foot);
}

// ══════════════════════════════════════════════════════════════════
//  OPEN / CLOSE
// ══════════════════════════════════════════════════════════════════

registerModal(MODAL_ID, {
  dismissOnBackdrop: true,
  // Escape has three jobs here and the modal core owns the last one. Taking
  // the first two through the registry keeps modal.js from importing this
  // module — the same reason the symbol-suggest popover is exempted there.
  onEscape: () => {
    if (menuOpen()) {
      setComposer('');
      return true;
    }
    if (isStateMateRunning()) {
      cancelStateMate();
      return true;
    }
    return false;
  },
  onClose: () => {
    Session.exampleRequest++;
    if (isStateMateRunning()) cancelStateMate();
    const btnEl = $('example-picker-btn');
    if (btnEl) btnEl.setAttribute('aria-expanded', 'false');
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
  Session.historyAt = -1;
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
    input.oninput = () => { autosize(); renderMenu(); renderNudge(); renderStatus(); };
    input.onkeydown = onInputKeydown;
  }

  const send$ = $('sm-send');
  if (send$) {
    send$.disabled = false;
    send$.onclick = () => {
      const text = String($('sm-input')?.value || '').trim();
      if (!text) return focusInput();
      if (text.startsWith('/')) {
        const slash = parseSlash(text);
        const cmd = slash && findCommand(slash.name);
        setComposer('');
        return cmd ? cmd.run(slash.query) : note(`Unknown command “/${slash?.name || ''}”.`);
      }
      setComposer('');
      return send(text);
    };
  }

  const opener = $('example-picker-btn');
  if (opener) opener.setAttribute('aria-expanded', 'true');

  setBusy(isStateMateRunning());
  renderLog();
  renderMenu();
  renderNudge();
  showOverlay(MODAL_ID);
  focusInput();

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
  Session.run = null;
  Session.history = [];
  Session.historyAt = -1;
  Session.lastPrompt = '';
}

export { describeSpecSize };
