// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — THE PALETTE
// ══════════════════════════════════════════════════════════════════
//  One input, four states: browse, working, error, and the result strip
//  that lands in the Simulate panel afterwards.
//
//  The dialog this replaces was the example picker, and the examples are
//  still the first thing in it. Typing filters them and, above them, offers
//  to build what you typed. That ordering is the whole design:
//
//    · with no key configured the palette is exactly the example picker
//    · an exact tool always beats the model — "minimize" surfaces the real
//      DFA Minimize algorithm above the ask row, because algorithms-fa.js
//      is correct and a language model is only usually correct
//    · the model is the escalation for the thing nothing else can do
//
//  Nothing here is reached from an on* attribute. Listeners are attached at
//  creation, the way reference.js does it, so the feature adds exactly one
//  name to bridge.js — the entry point the header button calls.

import { closeModal, registerModal, showOverlay } from './modal.js';
import { $, App, getMachineConfig } from './state.js';
import { undo } from './history.js';
import {
  filterMachineExampleOptions, getMachineExampleOptions, loadExampleFile
} from './persistence.js';
import {
  cancelStateMate, clearFollowUp, describeError, getFollowUp, hasWarnings,
  isStateMateRunning, relayoutLastResult, runStateMate, testHint, verdictLabel
} from './statemate.js';
import { summarizeDiff } from './statemate-compile.js';
import {
  PROVIDERS, getStateMateSettings, isStateMateReady, providerConfig,
  resolveEndpoint, saveStateMateSettings, testConnection
} from './statemate-provider.js';
import { starterPrompts } from './statemate-prompt.js';
import { describeSpecSize } from './statemate-spec.js';
import { openSettingsModal, switchSettingsTab } from './ui.js';
import { showStatus } from './utils.js';
import { setView } from './view.js';

const MODAL_ID = 'statemate-modal';

// The palette's own state. Reset on open, so a cancelled run never greets
// the next one.
const Palette = {
  query: '',
  mode: null,          // null = inferred from the canvas
  attachCanvas: null,  // null = the setting
  phase: 'browse',     // 'browse' | 'working' | 'error' | 'done'
  rows: [],
  activeIndex: 0,
  examples: [],
  exampleRequest: 0,
  stages: [],
  planText: '',
  lastError: null,
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
  search: 'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  tool: 'M226.76,69a8,8,0,0,0-12.84-2.88l-40.3,37.19-17.23-3.7-3.7-17.23,37.19-40.3A8,8,0,0,0,187,29.24,72,72,0,0,0,88,96,72.34,72.34,0,0,0,94,124.94L33.79,177.79l-.36.34a32,32,0,0,0,45.26,45.26l.34-.36L131.06,162A72,72,0,0,0,232,96,71.56,71.56,0,0,0,226.76,69Z',
  close: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  warn: 'M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z',
  undo: 'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
  redo: 'M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16h27.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z'
};

// ══════════════════════════════════════════════════════════════════
//  ROUTING TO THE EXACT TOOL
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

function matchingAlgorithms(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  return algorithmCatalogue().filter(algo => {
    if (algo.label.toLowerCase().includes(q)) return true;
    return (ALGO_SYNONYMS[algo.id] || []).some(syn => q.includes(syn) || syn.includes(q));
  }).slice(0, 3);
}

// ══════════════════════════════════════════════════════════════════
//  MODE
// ══════════════════════════════════════════════════════════════════

function effectiveMode() {
  if (Palette.mode) return Palette.mode;
  return App.states.length ? 'edit' : 'build';
}

function effectiveAttach() {
  if (Palette.attachCanvas !== null) return Palette.attachCanvas;
  return !!getStateMateSettings().attachCanvas;
}

function canvasSummary() {
  const s = App.states.length;
  const t = App.transitions.length;
  if (!s) return 'empty';
  return `${s} state${s === 1 ? '' : 's'}, ${t} transition${t === 1 ? '' : 's'}`;
}

// ══════════════════════════════════════════════════════════════════
//  CHIPS
// ══════════════════════════════════════════════════════════════════

function renderChips() {
  const bar = $('sm-chips');
  if (!bar) return;
  bar.innerHTML = '';

  const cfg = getMachineConfig(App.machine);
  const settings = getStateMateSettings();

  const machine = el('span', 'sm-chip sm-chip-static');
  machine.append(el('b', null, cfg.label || App.machine));
  machine.title = cfg.fullName || App.machine;
  bar.appendChild(machine);

  if (isStateMateReady(settings)) {
    // The canvas toggle. It states its own cost, so switching it off is an
    // informed choice rather than a superstition.
    const attached = effectiveAttach() && App.states.length > 0;
    const canvas = el('button', 'sm-chip sm-chip-toggle' + (attached ? ' is-on' : ''));
    canvas.type = 'button';
    canvas.setAttribute('aria-pressed', String(attached));
    canvas.append(icon(attached ? ICONS.check : ICONS.close, 'sm-chip-icon'));
    canvas.append(el('span', null, `Canvas · ${canvasSummary()}`));
    canvas.title = App.states.length
      ? 'Send the machine on the canvas with your prompt. Off means build from scratch.'
      : 'Nothing on the canvas to send.';
    canvas.disabled = !App.states.length;
    canvas.onclick = () => {
      Palette.attachCanvas = !effectiveAttach();
      // Editing without the machine attached is not a coherent request.
      if (!Palette.attachCanvas && effectiveMode() === 'edit') Palette.mode = 'build';
      renderChips();
      renderBody();
    };
    bar.appendChild(canvas);

    if (App.states.length) {
      const mode = el('button', 'sm-chip sm-chip-toggle is-on');
      mode.type = 'button';
      mode.textContent = effectiveMode() === 'edit' ? 'Edit this machine' : 'Build a new one';
      mode.title = 'Switch between editing what is on the canvas and building something new.';
      mode.onclick = () => {
        Palette.mode = effectiveMode() === 'edit' ? 'build' : 'edit';
        if (Palette.mode === 'edit') Palette.attachCanvas = true;
        renderChips();
        renderBody();
      };
      bar.appendChild(mode);
    }

    const model = el('span', 'sm-chip sm-chip-static sm-chip-model');
    model.append(icon(ICONS.spark, 'sm-chip-icon'));
    model.append(el('span', null, resolveEndpoint(settings).model));
    model.title = `${providerConfig(settings.provider).label} · click Settings to change`;
    bar.appendChild(model);
  } else {
    const setup = el('button', 'sm-chip sm-chip-cta');
    setup.type = 'button';
    setup.append(icon(ICONS.spark, 'sm-chip-icon'));
    setup.append(el('span', null, 'Set up StateMate'));
    setup.onclick = openStateMateSettings;
    bar.appendChild(setup);
  }

  const follow = getFollowUp();
  if (follow && isStateMateReady(settings)) {
    const chip = el('button', 'sm-chip sm-chip-follow');
    chip.type = 'button';
    chip.textContent = `↩ following up on “${follow.prompt.slice(0, 40)}${follow.prompt.length > 40 ? '…' : ''}”`;
    chip.title = 'StateMate will treat your next prompt as a correction to this. Click to forget it.';
    chip.onclick = () => { clearFollowUp(); renderChips(); };
    bar.appendChild(chip);
  }
}

// ══════════════════════════════════════════════════════════════════
//  BROWSE
// ══════════════════════════════════════════════════════════════════

function sectionLabel(text, count) {
  const head = el('div', 'sm-sec');
  head.append(el('span', null, text));
  if (count !== undefined) head.append(el('span', 'sm-sec-count', count));
  return head;
}

function makeRow({ kind, label, sub, badges = [], hint, run }) {
  const row = el('button', `sm-row sm-row-${kind}`);
  row.type = 'button';
  row.setAttribute('role', 'option');

  const head = el('div', 'sm-row-head');
  head.append(el('span', 'sm-row-name', label));
  if (badges.length) {
    const holder = el('span', 'sm-row-badges');
    badges.forEach(b => holder.append(el('span', `sm-badge${b.tone ? ' ' + b.tone : ''}`, b.text)));
    head.append(holder);
  }
  row.append(head);
  if (sub) row.append(el('div', 'sm-row-sub', sub));
  if (hint) row.append(el('div', 'sm-row-hint', hint));

  row.onclick = run;
  return { node: row, run };
}

function buildRows() {
  const rows = [];
  const query = Palette.query.trim();
  const settings = getStateMateSettings();
  const ready = isStateMateReady(settings);

  // ── ask ──────────────────────────────────────────────────────
  if (query && ready) {
    const mode = effectiveMode();
    const attached = effectiveAttach() && App.states.length > 0;
    const bits = [];
    bits.push(mode === 'edit' ? 'Edits the machine on the canvas' : 'Builds a new machine');
    if (attached) bits.push(`with ${canvasSummary()} attached`);
    if (mode === 'build' && App.states.length && settings.newTabForBuild) bits.push('in a new tab');

    rows.push(makeRow({
      kind: 'ask',
      label: mode === 'edit' ? 'Edit with StateMate' : 'Build with StateMate',
      sub: bits.join(' · '),
      badges: [{ text: '⌘⏎', tone: 'sm-badge-key' }],
      run: () => startRun(query)
    }));
  } else if (query && !ready) {
    rows.push(makeRow({
      kind: 'ask',
      label: 'Set up StateMate to build this',
      sub: 'Add an API key — your key stays in this browser',
      run: openStateMateSettings
    }));
  }

  // ── exact tools ──────────────────────────────────────────────
  const algos = matchingAlgorithms(query);
  algos.forEach(algo => {
    rows.push(makeRow({
      kind: 'algo',
      label: algo.label,
      sub: 'Exact construction — no model call',
      badges: [{ text: 'Algorithm', tone: 'sm-badge-algo' }],
      run: () => {
        closeModal(MODAL_ID);
        setView('algo');
        // setAlgo lives on the global surface with the rest of the algorithm
        // panel's handlers; reaching it that way avoids a cycle back into
        // algorithms-fa.js from the palette.
        if (typeof window !== 'undefined' && typeof window.setAlgo === 'function') window.setAlgo(algo.id);
      }
    }));
  });

  // ── examples ─────────────────────────────────────────────────
  const matches = filterMachineExampleOptions(Palette.examples, query);
  matches.forEach(opt => {
    const badges = [];
    if (opt.featured) badges.push({ text: 'Featured', tone: 'sm-badge-featured' });
    badges.push({ text: App.machine });
    rows.push(makeRow({
      kind: 'example',
      label: opt.meta?.title || opt.label || opt.file,
      sub: opt.meta?.blurb || '',
      badges,
      run: () => {
        closeModal(MODAL_ID);
        loadExampleFile(opt.file);
      }
    }));
  });

  // ── starters ─────────────────────────────────────────────────
  if (!query && ready) {
    starterPrompts(App.machine).forEach(text => {
      rows.push(makeRow({
        kind: 'starter',
        label: text,
        sub: '',
        run: () => {
          const input = $('sm-input');
          if (input) input.value = text;
          Palette.query = text;
          startRun(text);
        }
      }));
    });
  }

  return { rows, algos, matches };
}

function renderBody() {
  const body = $('sm-body');
  if (!body) return;
  if (Palette.phase === 'working') return renderWorking();
  if (Palette.phase === 'error') return renderError();

  body.innerHTML = '';
  body.className = 'sm-body';
  const { rows, algos, matches } = buildRows();
  Palette.rows = rows;

  const query = Palette.query.trim();
  const ready = isStateMateReady();
  let cursor = 0;

  const askCount = query ? 1 : 0;
  if (askCount) {
    body.append(sectionLabel(ready ? 'Ask StateMate' : 'StateMate'));
    body.append(rows[cursor].node);
    cursor += 1;
  }

  if (algos.length) {
    body.append(sectionLabel('Algorithms'));
    algos.forEach(() => body.append(rows[cursor++].node));
  }

  body.append(sectionLabel('Examples', String(matches.length)));
  if (matches.length) {
    matches.forEach(() => body.append(rows[cursor++].node));
  } else {
    body.append(el('div', 'sm-empty', query ? 'No matching examples' : 'No examples for this machine'));
  }

  if (!query && ready) {
    body.append(sectionLabel('Try asking'));
    while (cursor < rows.length) body.append(rows[cursor++].node);
  }

  // The ask row takes the highlight when the query reads like a sentence or
  // when nothing else matched. ⌘⏎ always asks, so a wrong guess here costs a
  // modifier key rather than a mistake.
  const wordy = query.split(/\s+/).filter(Boolean).length > 3;
  const preferAsk = askCount && ready && (wordy || (!matches.length && !algos.length));
  Palette.activeIndex = preferAsk ? 0 : Math.min(askCount, Math.max(0, rows.length - 1));
  if (!rows.length) Palette.activeIndex = -1;
  applyHighlight();
  renderFoot();
}

function applyHighlight() {
  Palette.rows.forEach((row, i) => {
    const active = i === Palette.activeIndex;
    row.node.classList.toggle('is-active', active);
    row.node.setAttribute('aria-selected', String(active));
  });
  const active = Palette.rows[Palette.activeIndex];
  if (active && typeof active.node.scrollIntoView === 'function') {
    active.node.scrollIntoView({ block: 'nearest' });
  }
}

function moveHighlight(delta) {
  if (!Palette.rows.length) return;
  const next = Palette.activeIndex + delta;
  Palette.activeIndex = Math.max(0, Math.min(Palette.rows.length - 1, next));
  applyHighlight();
}

// ══════════════════════════════════════════════════════════════════
//  WORKING
// ══════════════════════════════════════════════════════════════════

const STAGE_ORDER = [
  { id: 'request', label: 'Asking' },
  { id: 'parse', label: 'Reading the answer' },
  { id: 'compile', label: 'Checking the shape' },
  { id: 'verify', label: 'Running checks' },
  { id: 'apply', label: 'Drawing' }
];

function resetStages() {
  Palette.stages = STAGE_ORDER.map(s => ({ ...s, status: 'idle', note: '' }));
  Palette.planText = '';
}

function setStage(id, status, note) {
  const index = Palette.stages.findIndex(s => s.id === id);
  if (index === -1) return;
  // Everything before the stage that just started has, by definition, finished.
  for (let i = 0; i < index; i++) {
    if (Palette.stages[i].status !== 'done') Palette.stages[i].status = 'done';
  }
  Palette.stages[index].status = status;
  if (note !== undefined) Palette.stages[index].note = note;
}

function renderWorking() {
  const body = $('sm-body');
  if (!body) return;
  body.innerHTML = '';
  body.className = 'sm-body sm-body-working';

  const prompt = el('div', 'sm-working-prompt');
  prompt.append(icon(ICONS.spark, 'sm-icon sm-icon-spark'));
  prompt.append(el('span', null, Palette.lastPrompt));
  body.append(prompt);

  const list = el('div', 'sm-stages');
  Palette.stages.forEach(stage => {
    const row = el('div', `sm-stage is-${stage.status}`);
    const mark = el('span', 'sm-stage-mark');
    if (stage.status === 'done') mark.append(icon(ICONS.check, 'sm-stage-icon'));
    else if (stage.status === 'active') mark.append(el('span', 'sm-spinner'));
    else mark.textContent = '·';
    row.append(mark);

    const text = el('div', 'sm-stage-text');
    text.append(el('span', 'sm-stage-label', stage.label));
    if (stage.note) text.append(el('span', 'sm-stage-note', stage.note));
    row.append(text);
    list.append(row);
  });
  body.append(list);

  if (Palette.planText) {
    const plan = el('div', 'sm-plan');
    plan.append(el('span', 'sm-plan-quote', '“'));
    plan.append(el('span', 'sm-plan-text', Palette.planText));
    body.append(plan);
  }

  renderFoot();
}

// ══════════════════════════════════════════════════════════════════
//  ERROR
// ══════════════════════════════════════════════════════════════════

function renderError() {
  const body = $('sm-body');
  if (!body) return;
  body.innerHTML = '';
  body.className = 'sm-body sm-body-error';

  const info = describeError(Palette.lastError);
  const card = el('div', 'sm-error');
  const head = el('div', 'sm-error-head');
  head.append(icon(ICONS.warn, 'sm-icon sm-icon-warn'));
  head.append(el('span', null, info.text));
  card.append(head);

  if (info.detail) {
    const details = el('details', 'sm-error-detail');
    details.append(el('summary', null, 'Details'));
    details.append(el('pre', null, String(info.detail).slice(0, 4000)));
    card.append(details);
  }

  const actions = el('div', 'sm-error-actions');
  if (info.action === 'settings') {
    const btn = el('button', 'sm-btn sm-btn-primary', info.label);
    btn.type = 'button';
    btn.onclick = openStateMateSettings;
    actions.append(btn);
  }
  if (info.action === 'retry' || info.action === 'settings') {
    const retry = el('button', `sm-btn${info.action === 'retry' ? ' sm-btn-primary' : ''}`, info.action === 'retry' ? info.label : 'Try again');
    retry.type = 'button';
    retry.onclick = () => startRun(Palette.lastPrompt);
    actions.append(retry);
  }
  const back = el('button', 'sm-btn', 'Back');
  back.type = 'button';
  back.onclick = () => { Palette.phase = 'browse'; renderBody(); focusInput(); };
  actions.append(back);
  card.append(actions);

  body.append(card);
  renderFoot();
}

// ══════════════════════════════════════════════════════════════════
//  FOOTER
// ══════════════════════════════════════════════════════════════════

function renderFoot() {
  const foot = $('sm-foot');
  if (!foot) return;
  foot.innerHTML = '';

  const hints = Palette.phase === 'working'
    ? [['esc', 'cancel']]
    : Palette.phase === 'error'
      ? [['esc', 'close']]
      : isStateMateReady()
        ? [['↑↓', 'move'], ['⏎', 'open'], ['⌘⏎', 'ask StateMate'], ['esc', 'close']]
        : [['↑↓', 'move'], ['⏎', 'open'], ['esc', 'close']];

  hints.forEach(([key, what]) => {
    const hint = el('span', 'sm-hint');
    hint.append(el('kbd', null, key));
    hint.append(el('span', null, what));
    foot.append(hint);
  });

  if (Palette.phase === 'browse') {
    const settings = el('button', 'sm-foot-link', 'Settings');
    settings.type = 'button';
    settings.onclick = openStateMateSettings;
    foot.append(settings);
  }
}

// ══════════════════════════════════════════════════════════════════
//  THE RUN
// ══════════════════════════════════════════════════════════════════

async function startRun(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return;
  if (!isStateMateReady()) return openStateMateSettings();

  Palette.lastPrompt = text;
  Palette.phase = 'working';
  resetStages();
  setStage('request', 'active');
  renderWorking();

  const settings = getStateMateSettings();

  try {
    const result = await runStateMate({
      prompt: text,
      mode: effectiveMode(),
      attachCanvas: effectiveAttach(),
      onEvent: event => {
        if (event.type === 'plan') {
          Palette.planText = event.text;
          renderWorking();
          return;
        }
        if (event.type !== 'stage') return;

        if (event.stage === 'repair') {
          setStage('verify', 'active', 'fixing what failed…');
          renderWorking();
          return;
        }
        const notes = {
          request: settings.provider ? resolveEndpoint(settings).model : '',
          compile: event.size || '',
          verify: event.count ? `${event.count} test${event.count === 1 ? '' : 's'}` : ''
        };
        setStage(event.stage, 'active', notes[event.stage] ?? '');
        renderWorking();
      }
    });

    Palette.stages.forEach(s => { s.status = 'done'; });
    Palette.phase = 'done';
    closeModal(MODAL_ID);
    decorateResultCard(result);

    const chips = summarizeDiff(result.diff);
    const verdict = verdictLabel(result);
    showStatus(`StateMate: ${chips.join(', ')}${verdict ? ` · ${verdict}` : ''}`);
  } catch (err) {
    if (err?.code === 'cancelled') {
      Palette.phase = 'browse';
      renderBody();
      focusInput();
      return;
    }
    Palette.lastError = err;
    Palette.phase = 'error';
    renderError();
  }
}

// ══════════════════════════════════════════════════════════════════
//  THE RESULT STRIP
// ══════════════════════════════════════════════════════════════════
//  The example card in the Simulate panel already renders a title, a blurb
//  and clickable test chips, which is exactly what a StateMate result is.
//  Rather than build a second one, this decorates that card in place.

export function decorateResultCard(result) {
  const card = $('example-card');
  if (!card) return;

  card.classList.add('sm-result');
  card.classList.toggle('sm-result-warn', hasWarnings(result));

  const strip = el('div', 'sm-result-strip');

  const badge = el('span', 'sm-result-badge');
  badge.append(icon(ICONS.spark, 'sm-chip-icon'));
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

  const actions = el('span', 'sm-result-actions');

  const undoBtn = el('button', 'sm-mini', 'Undo');
  undoBtn.type = 'button';
  undoBtn.dataset.tip = 'Undo everything StateMate just did';
  undoBtn.onclick = () => { undo(); card.style.display = 'none'; };
  actions.append(undoBtn);

  const again = el('button', 'sm-mini', 'Regenerate');
  again.type = 'button';
  again.dataset.tip = 'Ask again with the same prompt';
  again.onclick = () => {
    openStateMate();
    const input = $('sm-input');
    if (input) input.value = Palette.lastPrompt;
    Palette.query = Palette.lastPrompt;
    startRun(Palette.lastPrompt);
  };
  actions.append(again);

  const layout = el('button', 'sm-mini', 'Re-layout');
  layout.type = 'button';
  layout.dataset.tip = 'Rearrange the diagram automatically';
  layout.onclick = () => relayoutLastResult();
  actions.append(layout);

  strip.append(actions);
  card.insertBefore(strip, card.firstChild);

  // Everything the run found that is true but not fatal: an extended alphabet,
  // an unreachable state, a check that failed. Shown, never silent — a fix the
  // user cannot see is a fix they cannot distrust.
  const notes = [
    ...(result.lint?.fixed || []),
    ...(result.lint?.warnings || [])
  ];
  if (result.failures?.length) {
    notes.push({ severity: 'fail', message: `${result.failures.length} check${result.failures.length === 1 ? '' : 's'} failed: ${result.failures[0]}` });
  }
  if (notes.length) {
    const list = el('ul', 'sm-result-notes');
    notes.slice(0, 4).forEach(n => {
      const item = el('li', `sm-result-note is-${n.severity}`, n.message);
      list.append(item);
    });
    card.append(list);
  }

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
  onClose: () => {
    Palette.exampleRequest++;
    if (isStateMateRunning()) cancelStateMate();
    const btn = $('example-picker-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
});

function focusInput() {
  const input = $('sm-input');
  if (input) input.focus();
}

function onInputKeydown(e) {
  if (Palette.phase === 'working') {
    if (e.key === 'Escape') { e.preventDefault(); cancelStateMate(); }
    return;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); return; }
  if (e.key === 'Home') { e.preventDefault(); Palette.activeIndex = 0; applyHighlight(); return; }
  if (e.key === 'End') { e.preventDefault(); Palette.activeIndex = Palette.rows.length - 1; applyHighlight(); return; }
  if (e.key !== 'Enter') return;

  e.preventDefault();
  // ⌘⏎ / Ctrl⏎ always asks, whatever is highlighted. That is what makes the
  // default-highlight heuristic safe to be wrong about.
  if (e.metaKey || e.ctrlKey) {
    const query = Palette.query.trim();
    if (query) startRun(query);
    return;
  }
  const row = Palette.rows[Palette.activeIndex];
  if (row) row.run();
}

/** The header button's entry point — the one name this feature adds to bridge.js. */
export function openStateMate() {
  const cfg = getMachineConfig(App.machine);

  // Close the lightweight popovers before the modal takes the focus stack.
  ['hideTabOverflowMenu', 'hideTabContextMenu', 'hideContextMenu', 'hideCanvasContextMenu']
    .forEach(fn => {
      if (typeof window !== 'undefined' && typeof window[fn] === 'function') window[fn]();
    });

  Palette.query = '';
  Palette.mode = null;
  Palette.attachCanvas = null;
  Palette.phase = 'browse';
  Palette.lastError = null;

  const request = ++Palette.exampleRequest;
  Palette.examples = getMachineExampleOptions().map((opt, i) => ({ ...opt, featured: i === 0, meta: null }));

  const input = $('sm-input');
  if (input) {
    input.value = '';
    input.placeholder = isStateMateReady()
      ? `Describe a ${cfg.label || App.machine}, or search examples…`
      : 'Search examples…';
    input.oninput = () => {
      Palette.query = input.value;
      renderBody();
    };
    input.onkeydown = onInputKeydown;
  }

  const btn = $('example-picker-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');

  renderChips();
  renderBody();
  showOverlay(MODAL_ID);
  focusInput();

  // Rich descriptions arrive from the same JSON files the loader uses. The
  // list is already usable; this only fills in the blurbs, and a malformed
  // file must not close the dialog or move the focus.
  Promise.all(Palette.examples.map(opt =>
    fetch(`js/examples/${opt.file}.json`)
      .then(res => (res.ok === false ? null : res.json()))
      .then(data => ({ ...opt, meta: data?.meta || null }))
      .catch(() => opt)
  )).then(enriched => {
    if (request !== Palette.exampleRequest) return;
    Palette.examples = enriched;
    if (Palette.phase === 'browse') renderBody();
  });
}

// ══════════════════════════════════════════════════════════════════
//  SETTINGS PANEL
// ══════════════════════════════════════════════════════════════════
//  App.config is deliberately not involved — see the note at the top of
//  statemate-provider.js. These two functions are called from
//  openSettingsModal / confirmSettings in ui.js.

export function openStateMateSettings() {
  closeModal(MODAL_ID);
  openSettingsModal();
  if (typeof switchSettingsTab === 'function') switchSettingsTab('ai');
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
  const note = $('sm-provider-note');
  if (base) base.placeholder = preset.baseUrl;
  if (model) model.placeholder = preset.model;
  if (key) key.placeholder = preset.keyHint;
  if (note) note.textContent = preset.browserNote;
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
  setValue('set-sm-followup', s.followUp);
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
    followUp: !!getValue('set-sm-followup', true)
  });
}

async function runConnectionTest() {
  const status = $('sm-conn-status');
  const btn = $('sm-test-btn');
  if (!status) return;

  // The dialog's values are what the user is testing, not what was last saved.
  applyStateMateSettings();

  status.textContent = 'Testing…';
  status.className = 'sm-conn-status is-busy';
  if (btn) btn.disabled = true;

  try {
    const result = await testConnection();
    status.textContent = `Connected to ${result.model} in ${result.ms}ms`;
    status.className = 'sm-conn-status is-ok';
  } catch (err) {
    const info = describeError(err);
    status.textContent = info.text;
    status.className = 'sm-conn-status is-bad';
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Test seam — module-level palette state must not cross tests. */
export function _resetPaletteForTests() {
  Palette.query = '';
  Palette.mode = null;
  Palette.attachCanvas = null;
  Palette.phase = 'browse';
  Palette.rows = [];
  Palette.activeIndex = 0;
  Palette.examples = [];
  Palette.exampleRequest = 0;
  Palette.stages = [];
  Palette.planText = '';
  Palette.lastError = null;
  Palette.lastPrompt = '';
}

export { describeSpecSize };
