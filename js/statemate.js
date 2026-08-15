// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════
//  Prompt in, machine on the canvas out. Seven stages, and the important
//  property is where the canvas is written: exactly once, at the end, or
//  not at all.
//
//      assemble → request → parse → compile → lint → verify → apply
//                    ↑                                   │
//                    └──────── repair, at most twice ────┘
//
//  Everything before `apply` produces a candidate object and touches
//  nothing else, so a failure at any stage leaves the user's work exactly
//  as it was. That is what makes the button safe to press when there is
//  already something on screen — and it matters more than any amount of
//  model quality, because a feature that sometimes eats your diagram is one
//  you stop using.
//
//  Verification is the reason to trust the output. The model is required to
//  predict what its machine does on a handful of words; those predictions
//  are executed against the candidate through the app's own simulator
//  before anything is drawn. See verifyCandidate below — it is about twenty
//  lines, and it is the difference between "usually right" and "checked".

import { autoLayout } from './canvas.js';
import { commit, snapshot } from './history.js';
import { showExampleCard } from './persistence.js';
import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { computeBatchResults, resetSim } from './simulation.js';
import {
  App, activeWorkspaceId, exportWorkspaceState, getMachineConfig,
  importWorkspaceState, isOmegaAutomaton, normalizeBoundarySymbolsForMachine
} from './state.js';
import { compileSpec, currentMachineSnapshot, summarizeDiff } from './statemate-compile.js';
import { lintCandidate } from './statemate-lint.js';
import {
  buildRepairMessage, buildSystemPrompt, buildUserMessage, threadMessages
} from './statemate-prompt.js';
import { ProviderError, callModel, getStateMateSettings } from './statemate-provider.js';
import {
  MIN_SPEC_TESTS, StateMateError, describeSpecSize, extractSpecJSON,
  machineToSpec, parseTurn, testKindFor
} from './statemate-spec.js';
import { Change, emit } from './store.js';
import { autoFitLoadedMachine, createTab, fitToScreen } from './ui.js';
import { resetIds, showStatus } from './utils.js';
import { applyMachineSwitch } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  RUNTIME STATE
// ══════════════════════════════════════════════════════════════════
//  Module-level, and therefore cleared by resetModuleState() in the test
//  harness — a live abort controller or a stale follow-up leaking between
//  tests is exactly the kind of thing that makes a suite flaky.

let activeRun = null;

// ── the conversation ──────────────────────────────────────────────
//  Strict one-shot has a predictable failure: "no, it should reject the empty
//  string" gives the model no idea what "it" was, because the canvas holds the
//  machine but not the intent behind it. This is the transcript that fixes
//  that, and it stores intent only — a machine turn is kept as its one-line
//  summary, never as the machine. threadMessages() explains why.
//
//  Not persisted, for the same reason the API key is not: exportWorkspaceState()
//  deep-copies into every tab and getBackupPayload() writes to IndexedDB. A log
//  of what someone was trying to build belongs in the session, not in a file
//  they might attach to a bug report.
//
//  It accumulates regardless of the depth setting. `threadDepth` governs how
//  much is *sent* — 0 is the pre-thread behaviour from the model's side — while
//  the palette always has the full exchange to show.
const MAX_THREAD_TURNS = 24;

// How much of a rejected answer is echoed back as its own assistant turn
// during a repair. Enough to be the thing being corrected, capped so a model
// that produced 4000 tokens of nonsense does not get to pay for it twice.
const MAX_ECHO_CHARS = 4000;

let thread = [];
let threadKey = null;

// A conversation is about one machine in one tab. Checked when the thread is
// read rather than driven by a subscription: there is no Change for "the
// machine type switched", and a lazy check cannot be missed the way an event
// that never fires can.
function currentThreadKey() {
  return `${App.machine}::${activeWorkspaceId ?? ''}`;
}

/** The retained exchange, newest last. Empty after a tab or machine change. */
export function getThread() {
  if (threadKey !== null && threadKey !== currentThreadKey()) clearThread();
  return thread;
}

export function clearThread() {
  thread = [];
  threadKey = null;
}

function rememberTurn(entry) {
  const key = currentThreadKey();
  if (threadKey !== key) { thread = []; threadKey = key; }
  thread.push(entry);
  if (thread.length > MAX_THREAD_TURNS) thread = thread.slice(-MAX_THREAD_TURNS);
}

export function isStateMateRunning() {
  return !!activeRun;
}

/** Cancel the run in flight, if any. Safe to call when there is none. */
export function cancelStateMate() {
  if (!activeRun) return false;
  activeRun.controller.abort();
  return true;
}

/** Test seam. */
export function resetStateMateRuntime() {
  if (activeRun) { try { activeRun.controller.abort(); } catch (e) { } }
  activeRun = null;
  clearThread();
}

// ══════════════════════════════════════════════════════════════════
//  VERIFICATION
// ══════════════════════════════════════════════════════════════════

/** A spec test as one line computeBatchResults understands. */
export function formatTestLine(test, machine) {
  const word = test.w === '' ? App.config.sym.eps : test.w;
  if (testKindFor(machine) === 'output') return word;
  return test.expect ? `${word} => ${test.expect}` : word;
}

/**
 * Run the model's own predictions against the candidate, without the canvas
 * ever seeing it.
 *
 * The workspace is stashed, the candidate is imported *without* emitting —
 * so nothing renders — the batch is decided, and the stash goes back in a
 * finally, including when a simulator throws. computeBatchResults is
 * DOM-free by construction (renderBatchResults was split off from it for
 * exactly this reason), so this is the whole sandbox.
 */
export function verifyCandidate(candidate, tests) {
  if (!tests || !tests.length) return null;

  const stash = exportWorkspaceState();
  try {
    importWorkspaceState({
      ...stash,
      machine: candidate.machine,
      sigma: candidate.sigma || [],
      stackAlpha: candidate.stackAlpha || stash.stackAlpha,
      outputAlpha: candidate.outputAlpha || stash.outputAlpha,
      tapeCount: candidate.tapeCount || stash.tapeCount,
      states: candidate.states,
      transitions: candidate.transitions,
      startId: candidate.startId,
      accepts: candidate.accepts || [],
      // The undo stacks are irrelevant to a decision procedure and copying
      // them is the single most expensive part of a workspace snapshot.
      history: [],
      future: []
    });

    const machine = candidate.machine;
    const batch = computeBatchResults(tests.map(t => formatTestLine(t, machine)));

    // Transducers are judged on the word they emit, which the batch reports
    // but cannot check — it has no expectation to compare against.
    if (testKindFor(machine) === 'output') {
      let passed = 0, expected = 0;
      batch.results.forEach((r, i) => {
        const want = tests[i]?.out;
        if (want === undefined) return;
        expected++;
        r.expectedOutput = want;
        r.outputMatches = String(r.output ?? '') === String(want);
        if (r.outputMatches) passed++;
      });
      batch.expected = expected;
      batch.passCount = passed;
      batch.allPassed = expected > 0 && passed === expected;
    }

    return batch;
  } finally {
    importWorkspaceState(stash);
  }
}

/**
 * Failed checks, as data rather than as a sentence.
 *
 * These have two audiences and they need different words. The model is being
 * told it got its own prediction wrong, in the second person — "you predicted
 * accept, it REJECTED" — which is exactly right in a repair message and quite
 * wrong on the result card, where it addresses a reader who predicted nothing
 * and never saw the prediction. So the record is neutral and the phrasing is
 * chosen at the point of use, by failureForModel or failureForUser.
 *
 * @returns {Array<{kind: string, word?: string, expected?: string, actual?: string, detail?: string}>}
 */
export function describeFailures(batch, tests, machine) {
  if (!batch) return [];
  const found = [];
  batch.results.forEach((r, i) => {
    const test = tests[i];
    if (!test) return;
    const word = test.w === '' ? 'ε' : test.w;

    if (r.error) {
      found.push({ kind: 'unreadable', word });
      return;
    }
    if (testKindFor(machine) === 'output') {
      if (r.outputMatches === false) {
        found.push({ kind: 'output', word, expected: String(test.out ?? ''), actual: String(r.output ?? '') });
      }
      return;
    }
    if (!test.expect) return;
    if (r.verdict === 'unknown') {
      // Not a failure: a run still going at the step budget has decided
      // nothing, and counting it against the model would be a false negative.
      return;
    }
    if (r.verdict !== test.expect) {
      found.push({ kind: 'verdict', word, expected: test.expect, actual: r.verdict });
    }
  });
  return found;
}

/** A failed check as the repair message puts it: second person, to the model. */
export function failureForModel(f) {
  if (!f) return '';
  switch (f.kind) {
    case 'crash': return `the machine could not be simulated: ${f.detail}`;
    case 'unreadable': return `"${f.word}" could not be read — it uses symbols outside Σ.`;
    case 'output': return `"${f.word}" you predicted output "${f.expected}", it emitted "${f.actual}"`;
    default: return `"${f.word}" you predicted ${f.expected}, it ${f.actual === 'accept' ? 'ACCEPTED' : 'REJECTED'}`;
  }
}

/** The same check as the result card puts it: about the machine, to a reader. */
export function failureForUser(f) {
  if (!f) return '';
  switch (f.kind) {
    case 'crash': return `The machine could not be simulated: ${f.detail}`;
    case 'unreadable': return `“${f.word}” uses symbols outside Σ, so it could not be run.`;
    case 'output': return `“${f.word}” should emit “${f.expected}”, but this machine emits “${f.actual}”.`;
    default: return `“${f.word}” should be ${f.expected === 'accept' ? 'accepted' : 'rejected'}, but this machine ${f.actual === 'accept' ? 'accepts' : 'rejects'} it.`;
  }
}

// ══════════════════════════════════════════════════════════════════
//  APPLY
// ══════════════════════════════════════════════════════════════════

function assignCandidate(candidate) {
  const machineChanged = App.machine !== candidate.machine;

  App.machine = candidate.machine;
  App.sigma = new Set(candidate.sigma || []);
  if (candidate.stackAlpha) App.stackAlpha = new Set(candidate.stackAlpha);
  if (candidate.outputAlpha) App.outputAlpha = new Set(candidate.outputAlpha);
  if (candidate.tapeCount) App.tapeCount = candidate.tapeCount;
  App.states = candidate.states.map(s => ({ ...s }));
  App.transitions = candidate.transitions.map(t => ({ ...t }));
  App.startId = candidate.startId;
  App.accepts = new Set(candidate.accepts || []);
  App.notes = (candidate.notes || []).map(n => ({ ...n }));
  App.dividers = (candidate.dividers || []).map(d => ({ ...d }));

  // Selections and edit targets can outlive the states they point at.
  App.selectedStates.clear();
  App.selectedTransitions.clear();
  App.transFrom = null;
  App.ctxId = null;
  App.ctxEdge = null;
  App.editId = null;
  App.edgeHighlight = null;

  resetIds();
  normalizeBoundarySymbolsForMachine(App.machine);
  resetSim();

  // applyMachineSwitch repaints every panel and announces the change; it is
  // only right when the model actually moved. Otherwise the three alphabet
  // renderers are all that is needed, and the emit below does the rest.
  if (machineChanged) applyMachineSwitch(App.machine);
  else {
    renderSigma();
    renderGamma();
    renderOutputAlpha();
  }
}

/**
 * Put a candidate on the canvas as one undoable step.
 *
 * The snapshot goes before the mutation — commit() takes the edit as a
 * callback precisely so that ordering cannot be got wrong. One Ctrl+Z
 * restores exactly what was on screen before the prompt was sent.
 */
export function applyCandidate(candidate, { openNewTab = false, title = '' } = {}) {
  if (openNewTab) {
    // A new tab is its own workspace with its own history, so the machine
    // is loaded into it rather than over anything.
    createTab(title || 'StateMate');
    snapshot();
    assignCandidate(candidate);
    emit(Change.ALPHABET, Change.GRAPH);
  } else {
    commit(() => assignCandidate(candidate), Change.ALPHABET, Change.GRAPH);
  }

  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else fitToScreen(true);
}

/**
 * Re-run the auto-layout on the machine StateMate just produced. Offered in
 * the result card rather than done automatically, because an edit that kept
 * every existing position is usually what the user wanted.
 */
export function relayoutLastResult() {
  autoLayout();
}

// ══════════════════════════════════════════════════════════════════
//  WRITE AUTHORITY
// ══════════════════════════════════════════════════════════════════
//  The one axis a model must never decide on the user's behalf: how much it
//  may change without being asked. Task type it infers well — reply or edit,
//  build or switch — but "may I overwrite your work" is not an inference.
//
//    ask      never writes. The turn is a conversation about the machine.
//    propose  builds and verifies a candidate, then stops. The canvas is
//             written only when the reader accepts it.
//    auto     writes immediately, as StateMate always has.
//
//  All three run the identical pipeline; they differ in one branch at step 7,
//  which is possible only because the canvas was already written exactly once
//  and at the end. Everything before `apply` is a candidate object.

export const AUTHORITIES = ['ask', 'propose', 'auto'];

// Even in auto, an edit that deletes most of the machine is not the edit
// anyone asked for — it is a replacement wearing an edit's clothes. It drops
// to a proposal and says why, which is the whole reason auto is safe to leave
// switched on.
const SCOPE_REMOVAL_RATIO = 0.5;

function scopeGuard(diff, before, { intent, openNewTab }) {
  // The guard is about edits, not builds. "Build me a DFA for X" over an
  // existing machine removes every state it had, and that is the request, not
  // an overreach — doubly so when the build lands in a tab of its own.
  if (intent !== 'edit' || openNewTab) return '';
  const had = before.states.length;
  if (!had || !diff) return '';
  const removed = diff.statesRemoved.length;
  if (removed > had * SCOPE_REMOVAL_RATIO) {
    return `it removes ${removed} of the ${had} state${had === 1 ? '' : 's'} already on the canvas`;
  }
  return '';
}

/**
 * A cheap fingerprint of what is on the canvas, for noticing that it moved
 * while a proposal was pending. The diff a reader approved was computed
 * against a particular machine; applying it over a different one silently
 * discards whatever they did in between.
 */
export function machineSignature() {
  return [
    App.machine,
    App.states.map(s => s.name).sort().join(','),
    App.transitions.length
  ].join('|');
}

/** The info card a result shows over the canvas — the same for either path. */
function resultCardMeta(spec) {
  return {
    title: spec.title,
    blurb: spec.blurb,
    inputs: (spec.tests || []).map(t => ({
      w: t.w,
      expect: t.expect,
      out: t.out,
      label: t.out !== undefined ? `→ ${t.out}` : undefined
    }))
  };
}

/**
 * Draw a result that was held back. The canvas-writing stays in this module
 * so `apply` remains the single place the user's work is touched.
 *
 * @returns {object|null} the result, now applied
 */
export function applyPending(result) {
  const pending = result?.pending;
  if (!pending) return null;
  applyCandidate(pending.candidate, { openNewTab: pending.openNewTab, title: pending.spec.title });
  showExampleCard(resultCardMeta(pending.spec));
  return {
    ...result,
    status: 'applied',
    hold: '',
    holdDetail: '',
    openedNewTab: pending.openNewTab,
    pending: null
  };
}

// ══════════════════════════════════════════════════════════════════
//  THE RUN
// ══════════════════════════════════════════════════════════════════

function inferIntent() {
  return App.states.length ? 'edit' : 'build';
}

/**
 * One prompt, start to finish.
 *
 * @param {object}   opts
 * @param {string}   opts.prompt
 * @param {string}   [opts.intent]       'build' | 'edit'; inferred from the canvas when absent
 * @param {boolean}  [opts.attachCanvas] default from settings
 * @param {string}   [opts.authority]    'ask' | 'propose' | 'auto'
 * @param {Function} [opts.onEvent]      progress: {type, …}
 * @returns {Promise<object>} the run result
 */
export async function runStateMate({
  prompt, intent, attachCanvas, authority = 'auto', onEvent = () => { }
} = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new StateMateError('empty', 'Type what you want built.');

  // One request in flight at a time — a second ask supersedes the first
  // rather than racing it onto the canvas.
  if (activeRun) cancelStateMate();

  const settings = getStateMateSettings();
  const controller = new AbortController();
  const run = { controller };
  activeRun = run;

  const resolvedIntent = intent || inferIntent();
  const useCanvas = attachCanvas === undefined ? settings.attachCanvas : attachCanvas;
  const machine = App.machine;
  const before = currentMachineSnapshot();

  const cancelled = () => controller.signal.aborted;
  const guard = () => {
    if (cancelled()) throw new StateMateError('cancelled', 'Cancelled.');
  };

  try {
    // ── 1 · assemble ──────────────────────────────────────────
    onEvent({ type: 'stage', stage: 'request' });
    const system = await buildSystemPrompt(machine, { notes: !!settings.writeNotes });
    guard();

    const canvasSpec = useCanvas && App.states.length ? machineToSpec() : null;

    // The thread is the tail of the retained exchange; the live prompt is a
    // turn of its own, and the canvas rides with it rather than with any of
    // the history, so the model is always editing the machine that exists now.
    const depth = Math.max(0, settings.threadDepth | 0);
    const messages = [
      ...(depth ? threadMessages(getThread().slice(-depth)) : []),
      {
        role: 'user',
        content: buildUserMessage({ prompt: text, intent: resolvedIntent, canvasSpec, authority })
      }
    ];

    let attempt = 0;
    const maxAttempts = 1 + Math.max(0, Math.min(2, settings.repairAttempts ?? 1));
    let spec = null, candidate = null, diff = null, lint = null, batch = null;
    let usage = null, model = null, repaired = false;
    let lastFailures = [], lastFindings = [];

    while (attempt < maxAttempts) {
      attempt++;
      guard();

      // ── 2 · request ─────────────────────────────────────────
      onEvent({ type: 'stage', stage: 'request', attempt });
      const response = await callModel({
        system,
        messages,
        signal: controller.signal,
        onText: full => {
          // "plan" is the first key in the schema specifically so it arrives
          // early enough to show while the rest is still streaming.
          const planned = full.match(/"plan"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (planned) {
            onEvent({ type: 'plan', text: planned[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') });
          }
        }
      });
      guard();
      usage = response.usage;
      model = response.model;

      // ── 3 · parse & validate ────────────────────────────────
      onEvent({ type: 'stage', stage: 'parse' });
      let turn;
      try {
        // Prose is only an answer on the first attempt. Past that the model is
        // being asked to fix a machine it already committed to, and "I would
        // rather talk about it" is not a correction.
        turn = parseTurn(extractSpecJSON(response.text), {
          fallbackMachine: machine,
          allowReply: attempt === 1
        });
      } catch (err) {
        // A malformed answer is worth exactly one silent reformat before it
        // becomes the user's problem.
        if (attempt < maxAttempts && (err.code === 'no-json' || err.code === 'bad-json' || err.code === 'schema')) {
          onEvent({ type: 'stage', stage: 'repair', reason: err.message });
          messages.push(
            { role: 'assistant', content: response.text.slice(0, MAX_ECHO_CHARS) },
            { role: 'user', content: `That answer could not be used: ${err.message}\nReturn ONLY the JSON object described above.` }
          );
          repaired = true;
          continue;
        }
        throw err;
      }

      // ── 3a · the model had something to say instead ─────────
      // This leaves by a door that does not pass compile, lint, verify or
      // apply. No candidate is ever built, so there is nothing that could
      // reach the canvas even by accident.
      if (turn.kind === 'reply') {
        rememberTurn({ role: 'user', text });
        rememberTurn({ role: 'assistant', kind: 'reply', text: turn.text });
        const replied = {
          status: 'replied',
          kind: 'reply',
          reply: turn.text,
          usage, model,
          repaired,
          thread: getThread()
        };
        onEvent({ type: 'done', result: replied });
        return replied;
      }

      spec = turn.spec;

      // A model that volunteers notes when they were not asked for is adding
      // clutter to someone's diagram, so they are dropped rather than drawn.
      if (!settings.writeNotes) spec.notes = [];

      // ── 4 · compile ─────────────────────────────────────────
      onEvent({ type: 'stage', stage: 'compile', size: describeSpecSize(spec) });
      ({ candidate, diff } = compileSpec(spec, before));

      // ── 5 · lint ────────────────────────────────────────────
      onEvent({ type: 'stage', stage: 'lint' });
      lint = lintCandidate(candidate);
      lastFindings = lint.fatal;

      // ── 6 · verify ──────────────────────────────────────────
      batch = null;
      lastFailures = [];
      if (settings.verify && spec.tests.length) {
        onEvent({ type: 'stage', stage: 'verify', count: spec.tests.length });
        try {
          batch = verifyCandidate(candidate, spec.tests);
          lastFailures = describeFailures(batch, spec.tests, candidate.machine);
        } catch (err) {
          // A simulator that throws on a malformed machine is information,
          // not a crash — it becomes a repair note like any other.
          lastFailures = [{ kind: 'crash', detail: err.message }];
          batch = null;
        }
      }
      guard();

      const needsRepair = lint.fatal.length || lastFailures.length;
      if (!needsRepair || attempt >= maxAttempts) break;

      onEvent({
        type: 'stage',
        stage: 'repair',
        failures: lastFailures.length,
        findings: lint.fatal.length
      });
      // The rejected answer goes back as its own assistant turn, so the model
      // is correcting its own last message rather than a quotation of it.
      messages.push(
        { role: 'assistant', content: response.text.slice(0, MAX_ECHO_CHARS) },
        {
          role: 'user',
          content: buildRepairMessage({
            prompt: text,
            failures: lastFailures.map(failureForModel),
            findings: lint.fatal
          })
        }
      );
      repaired = true;
    }

    guard();

    // A machine that is still structurally invalid never reaches the canvas:
    // an ε-transition on a DFA or a head with no direction is not a machine
    // with a flaw, it is not that machine at all.
    if (lint.fatal.length) {
      throw new StateMateError(
        'invalid-machine',
        `The result was not a valid ${candidate.machine}: ${lint.fatal[0].message}`,
        lint.fatal.map(f => `· ${f.message}`).join('\n')
      );
    }

    // ── 7 · apply, or hold ────────────────────────────────────
    // The single branch the three authorities differ by. Everything above ran
    // identically; nothing below this line has touched the canvas yet.
    const openNewTab = resolvedIntent === 'build'
      && before.states.length > 0
      && settings.newTabForBuild;

    const overreach = scopeGuard(diff, before, { intent: resolvedIntent, openNewTab });
    const hold = authority === 'ask' ? 'ask'
      : authority === 'propose' ? 'propose'
      : (overreach ? 'scope' : '');

    // One stage either way — the last step of a run is deciding what happens
    // to the candidate, and `hold` says which way it went. A stage id the UI
    // has no row for would simply be dropped.
    onEvent({ type: 'stage', stage: 'apply', hold });
    if (!hold) {
      applyCandidate(candidate, { openNewTab, title: spec.title });
      showExampleCard(resultCardMeta(spec));
    }

    const verdict = batch
      ? { passed: batch.passCount, expected: batch.expected, unknowns: batch.unknowns, allPassed: batch.allPassed }
      : null;

    // Intent, not machines: the summary is what travels to the next turn. A
    // held proposal is remembered too — the exchange happened, and a follow-up
    // ("no, smaller") is a correction to it whether or not it was drawn.
    rememberTurn({ role: 'user', text });
    rememberTurn({
      role: 'assistant',
      kind: 'machine',
      text: `${spec.title} — ${describeSpecSize(spec)}${hold ? ' (proposed, not applied)' : ''}`
    });

    const result = {
      status: hold ? 'proposed' : 'applied',
      kind: 'machine',
      hold,
      holdDetail: overreach,
      // Everything applyPending() needs, and nothing that has been drawn. The
      // signature is what tells the reader later that the canvas moved under
      // the diff they are about to accept.
      pending: hold ? { candidate, spec, openNewTab, signature: machineSignature() } : null,
      spec,
      candidate,
      diff,
      lint,
      batch,
      verdict,
      failures: lastFailures,
      usage,
      model,
      repaired,
      openedNewTab: hold ? false : openNewTab,
      summary: summarizeDiff(diff),
      thread: getThread()
    };
    onEvent({ type: 'done', result });
    return result;
  } catch (err) {
    if (cancelled() && !(err instanceof ProviderError && err.code !== 'cancelled')) {
      const cancelErr = new StateMateError('cancelled', 'Cancelled.');
      onEvent({ type: 'error', error: cancelErr });
      throw cancelErr;
    }
    onEvent({ type: 'error', error: err });
    throw err;
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

// ══════════════════════════════════════════════════════════════════
//  ERROR COPY
// ══════════════════════════════════════════════════════════════════
//  Every failure gets a sentence a person can act on and one button. The
//  action ids are resolved by the UI; keeping the mapping here means the
//  strings are testable without a DOM.

const ERROR_COPY = {
  disabled: { text: 'StateMate is switched off.', action: 'settings', label: 'Turn it on' },
  'no-key': { text: 'StateMate needs an API key to chat and build machines.', action: 'settings', label: 'Set up' },
  auth: { text: 'Your API key was rejected.', action: 'settings', label: 'Check key' },
  'rate-limit': { text: 'The provider is rate-limiting requests.', action: 'retry', label: 'Retry' },
  server: { text: 'The provider is having trouble right now.', action: 'retry', label: 'Retry' },
  'not-found': { text: 'That model or base URL does not exist.', action: 'settings', label: 'Open settings' },
  http: { text: 'The provider refused the request.', action: 'settings', label: 'Open settings' },
  network: { text: 'Could not reach the provider.', action: 'settings', label: 'Open settings' },
  timeout: { text: 'The model did not answer in time.', action: 'retry', label: 'Retry' },
  'bad-response': { text: 'The provider did not return JSON.', action: 'retry', label: 'Retry' },
  'no-json': { text: "StateMate's answer was not a machine.", action: 'retry', label: 'Try again' },
  'bad-json': { text: "StateMate's answer was not valid JSON.", action: 'retry', label: 'Try again' },
  schema: { text: 'StateMate returned an incomplete machine.', action: 'retry', label: 'Try again' },
  'unknown-machine': { text: 'StateMate proposed a model this app does not build.', action: 'retry', label: 'Try again' },
  'too-large': { text: 'That machine is too large to draw.', action: 'retry', label: 'Try again' },
  'invalid-machine': { text: 'The result was not a valid machine, so nothing was changed.', action: 'retry', label: 'Try again' },
  empty: { text: 'Type what you want built.', action: 'none', label: '' },
  cancelled: { text: 'Cancelled.', action: 'none', label: '' }
};

/** @returns {{text: string, action: string, label: string, detail: string}} */
export function describeError(err) {
  const copy = ERROR_COPY[err?.code] || {
    text: 'StateMate could not finish that request.',
    action: 'retry',
    label: 'Try again'
  };
  // The thrown message is usually more specific than the generic copy —
  // "Your API key was rejected by api.anthropic.com" beats "was rejected".
  const text = err?.message && err.message !== 'Cancelled.' && err.code !== 'empty'
    ? err.message
    : copy.text;
  const extra = err?.code === 'rate-limit' && err.retryAfter
    ? ` Try again in ${err.retryAfter}s.`
    : '';
  return { ...copy, text: text + extra, detail: err?.detail || null };
}

/** Whether a run's verdict should be shown as a warning rather than a pass. */
export function hasWarnings(result) {
  if (!result) return false;
  if (result.batch && result.batch.expected > 0 && !result.batch.allPassed) return true;
  if (result.spec?.caveat) return true;
  return (result.lint?.warnings?.length || 0) > 0;
}

// Severity decides which notes survive the card's line budget, so the order
// here is the order of consequence: a machine that does not do what was
// predicted, then things that are true but not fatal, then the edits made on
// the way through.
const NOTE_RANK = { fail: 0, warn: 1, fix: 2 };

/**
 * Everything a finished run has to tell the user, most consequential first.
 * Pure, and separate from the card that draws it, so the ordering is testable.
 *
 * The sort is the point. These used to be concatenated in the order they were
 * produced — fixes, warnings, then the failed check appended last — and the
 * card renders only the first few. Four routine fixes ("Extended Σ with…",
 * "Added the end markers to Γ") are an ordinary run, and they pushed the one
 * line saying the machine failed its own author's predictions off the end.
 *
 * The model's caveat ranks with the warnings, never above them: it is a claim
 * the model makes, not evidence the app gathered.
 */
export function resultNotes(result) {
  if (!result) return [];

  const notes = [
    ...(result.lint?.fixed || []),
    ...(result.lint?.warnings || [])
  ];
  if (result.spec?.caveat) notes.push({ severity: 'warn', message: result.spec.caveat });
  if (result.failures?.length) {
    const n = result.failures.length;
    notes.push({
      severity: 'fail',
      message: `${n} check${n === 1 ? '' : 's'} failed. ${failureForUser(result.failures[0])}`
    });
  }

  // Array.prototype.sort is stable, so notes of equal severity keep the order
  // the pipeline produced them in.
  return notes.sort((a, b) => (NOTE_RANK[a.severity] ?? 3) - (NOTE_RANK[b.severity] ?? 3));
}

/** The chip the result card shows for the test run. */
export function verdictLabel(result) {
  const batch = result?.batch;
  if (!batch || !batch.expected) return null;
  const suffix = batch.unknowns ? ` · ${batch.unknowns} undecided` : '';
  return `${batch.passCount}/${batch.expected} checks${suffix}`;
}

/**
 * Machines whose language is decided over infinite words need their tests
 * written as u(v); the UI uses this to explain a rejected test word.
 */
export function testHint(machine = App.machine) {
  if (isOmegaAutomaton(machine)) return 'ω-words are written u(v) — a stem, then a period repeated forever.';
  if (getMachineConfig(machine).isTransducer) return 'Transducer tests compare the emitted output word.';
  return '';
}

/** Sanity check used by the UI before enabling the ask row. */
export function minimumTests() {
  return MIN_SPEC_TESTS;
}

export { showStatus };
