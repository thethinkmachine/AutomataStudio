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
  App, exportWorkspaceState, getMachineConfig, importWorkspaceState,
  isOmegaAutomaton, normalizeBoundarySymbolsForMachine
} from './state.js';
import { compileSpec, currentMachineSnapshot, summarizeDiff } from './statemate-compile.js';
import { lintCandidate } from './statemate-lint.js';
import {
  buildRepairMessage, buildSystemPrompt, buildUserMessage
} from './statemate-prompt.js';
import { ProviderError, callModel, getStateMateSettings } from './statemate-provider.js';
import {
  MIN_SPEC_TESTS, StateMateError, describeSpecSize, extractSpecJSON,
  machineToSpec, testKindFor, validateSpec
} from './statemate-spec.js';
import { Change, emit, subscribe } from './store.js';
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

// One retained turn, not zero. Strict one-shot has a predictable failure:
// "no, it should reject the empty string" gives the model no idea what "it"
// was, because the canvas holds the machine but not the intent behind it.
// This is one slot — not a transcript — and it expires the moment anything
// else touches the graph.
let followUpSlot = null;
let applyingOwnChange = false;

subscribe(Change.GRAPH, () => {
  if (!applyingOwnChange) followUpSlot = null;
});

export function getFollowUp() {
  if (!getStateMateSettings().followUp) return null;
  return followUpSlot;
}

export function clearFollowUp() {
  followUpSlot = null;
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
  followUpSlot = null;
  applyingOwnChange = false;
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

/** Failed checks as the one-line-each report the repair message carries. */
export function describeFailures(batch, tests, machine) {
  if (!batch) return [];
  const lines = [];
  batch.results.forEach((r, i) => {
    const test = tests[i];
    if (!test) return;
    const word = test.w === '' ? 'ε' : test.w;

    if (r.error) {
      lines.push(`"${word}" could not be read — it uses symbols outside Σ.`);
      return;
    }
    if (testKindFor(machine) === 'output') {
      if (r.outputMatches === false) {
        lines.push(`"${word}" you predicted output "${test.out}", it emitted "${r.output ?? ''}"`);
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
      lines.push(`"${word}" you predicted ${test.expect}, it ${r.verdict === 'accept' ? 'ACCEPTED' : 'REJECTED'}`);
    }
  });
  return lines;
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
  applyingOwnChange = true;
  try {
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
  } finally {
    applyingOwnChange = false;
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
//  THE RUN
// ══════════════════════════════════════════════════════════════════

function inferMode() {
  return App.states.length ? 'edit' : 'build';
}

/**
 * One prompt, start to finish.
 *
 * @param {object}   opts
 * @param {string}   opts.prompt
 * @param {string}   [opts.mode]         'build' | 'edit'; inferred when absent
 * @param {boolean}  [opts.attachCanvas] default from settings
 * @param {Function} [opts.onEvent]      progress: {type, …}
 * @returns {Promise<object>} the run result
 */
export async function runStateMate({ prompt, mode, attachCanvas, onEvent = () => { } } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new StateMateError('empty', 'Type what you want built.');

  // One request in flight at a time — a second ask supersedes the first
  // rather than racing it onto the canvas.
  if (activeRun) cancelStateMate();

  const settings = getStateMateSettings();
  const controller = new AbortController();
  const run = { controller };
  activeRun = run;

  const resolvedMode = mode || inferMode();
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
    let user = buildUserMessage({
      prompt: text,
      mode: resolvedMode,
      canvasSpec,
      followUp: getFollowUp()
    });

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
        user,
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
      let parsed;
      try {
        parsed = extractSpecJSON(response.text);
        spec = validateSpec(parsed, { fallbackMachine: machine });
      } catch (err) {
        // A malformed answer is worth exactly one silent reformat before it
        // becomes the user's problem.
        if (attempt < maxAttempts && (err.code === 'no-json' || err.code === 'bad-json' || err.code === 'schema')) {
          onEvent({ type: 'stage', stage: 'repair', reason: err.message });
          user = `${user}\n\nYour previous answer could not be used: ${err.message}\nReturn ONLY the JSON object described above.`;
          repaired = true;
          continue;
        }
        throw err;
      }

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
          lastFailures = [`the machine could not be simulated: ${err.message}`];
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
      user = buildRepairMessage({
        prompt: text,
        spec,
        failures: lastFailures,
        findings: lint.fatal
      });
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

    // ── 7 · apply ─────────────────────────────────────────────
    onEvent({ type: 'stage', stage: 'apply' });

    const openNewTab = resolvedMode === 'build'
      && before.states.length > 0
      && settings.newTabForBuild;

    applyCandidate(candidate, { openNewTab, title: spec.title });

    showExampleCard({
      title: spec.title,
      blurb: spec.blurb,
      inputs: (spec.tests || []).map(t => ({
        w: t.w,
        expect: t.expect,
        out: t.out,
        label: t.out !== undefined ? `→ ${t.out}` : undefined
      }))
    });

    const verdict = batch
      ? { passed: batch.passCount, expected: batch.expected, unknowns: batch.unknowns, allPassed: batch.allPassed }
      : null;

    followUpSlot = settings.followUp
      ? { prompt: text, summary: `${spec.title} — ${describeSpecSize(spec)}`, at: Date.now() }
      : null;

    const result = {
      status: 'applied',
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
      openedNewTab: openNewTab,
      summary: summarizeDiff(diff)
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
  'no-key': { text: 'StateMate needs an API key to build machines.', action: 'settings', label: 'Set up' },
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
  return (result.lint?.warnings?.length || 0) > 0;
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
