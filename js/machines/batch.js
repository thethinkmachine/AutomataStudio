// ══════════════════════════════════════════════════════════════════
//  THE BATCH DECISION, WITHOUT A PAGE
// ══════════════════════════════════════════════════════════════════
// Deciding a list of words and *showing* the verdicts were already separate
// jobs — computeBatchResults() returned data and renderBatchResults() drew it.
// This file finishes the split by moving the deciding half out of
// js/simulation.js, which is the player and imports the renderer.
//
// The reason is that this is the app's one embarrassingly parallel workload:
// every row is an independent run over the same machine. Splitting the rows
// across a pool of workers needs the deciding half to be importable somewhere
// with no document, which js/simulation.js is not and js/machines/** now is.
//
// The split inside is what keeps the two paths honest. decideBatchRows() is
// the map — the part a worker runs on a slice — and summarizeBatch() is the
// fold, which is cheap and always runs on the main thread over the merged
// rows. computeBatchResults() is those two composed, so the serial path and
// the parallel path are not two implementations that could drift: they are
// the same function, called on the whole list or on a quarter of it. A
// parallel batch that scored differently from a serial one would be a far
// worse bug than a slow batch.
import { App, getMachineConfig } from '../state.js';
import { decideMachine, parseMachineInput } from './index.js';
import { parseEps } from './predicates.js';
import { langStepBudget } from './runtime.js';

// Optional trailing "=> accept" / "=> reject" (also: acc/rej, ✓/✗, a/r)
// turns a batch line into a pass/fail expectation instead of a plain probe.
export function parseBatchLine(line) {
  const m = line.match(/^(.*?)(?:=>|→)\s*(accept|reject|acc|rej|✓|✗|a|r)\s*$/i);
  if (!m) return { input: line, expect: null };
  const tag = m[2].toLowerCase();
  const expect = (tag === 'accept' || tag === 'acc' || tag === '✓' || tag === 'a') ? 'accept' : 'reject';
  return { input: m[1].trim(), expect };
}

/**
 * One row: parse the line the way this machine reads input, then decide it.
 *
 * Machine-agnostic. Both halves — how the line is read and what the machine
 * answers — come from the registry, so the eighteen branches this used to
 * carry are down to one question the caller is entitled to ask: is a
 * transducer allowed to have a verdict at all?
 */
export function decideBatchRow(line, expect, m = App.machine, transducer = null) {
  // Whether a transducer decides anything is App.config.transducerAccepts,
  // and that is the *caller's* policy: the machine always answers, and this
  // is where the answer is dropped when the setting is off. `undefined`
  // means "no verdict was asked for", which renderBatchResults draws as a
  // bullet rather than as a tick or a cross.
  const isTransducer = transducer === null ? !!getMachineConfig(m).isTransducer : transducer;

  const parsed = parseMachineInput(m, parseEps(line));
  if (!parsed.ok) return { str: line, accepted: false, error: true, expect };

  const { verdict, output } = decideMachine(m, parsed.input);
  // A run still going at the budget has not rejected, and reporting it as
  // one would be a false negative — the mistake that makes undecidability
  // invisible. Turing machines and an unhalted two-way head both land here.
  const undecided = verdict === 'unk';
  const accepted = undecided ? false
    : isTransducer ? (App.config.transducerAccepts ? verdict === 'acc' : undefined)
      : verdict === 'acc';

  return {
    str: line,
    accepted,
    output: output ?? null,
    expect,
    verdict: undecided ? 'unknown'
      : accepted === undefined ? undefined
        : accepted ? 'accept' : 'reject'
  };
}

/** The map. This is the part that goes wide across the pool. */
export function decideBatchRows(rawLines) {
  const m = App.machine;
  const transducer = !!getMachineConfig(m).isTransducer;
  return rawLines.map(parseBatchLine)
    .map(({ input, expect }) => decideBatchRow(input, expect, m, transducer));
}

/** The fold. Cheap, order-dependent, and always run on the main thread. */
export function summarizeBatch(results) {
  const withExpectation = results.filter(r => r.expect && !r.error);
  // An "unknown" matches no expectation — it is neither a pass nor a
  // rejection, and folding it into either would hide the budget.
  const passCount = withExpectation.filter(r => r.verdict === r.expect).length;
  const unknowns = results.filter(r => r.verdict === 'unknown').length;
  return {
    results,
    expected: withExpectation.length,
    passCount,
    unknowns,
    allPassed: withExpectation.length > 0 && passCount === withExpectation.length,
    machine: App.machine,
    budget: langStepBudget()
  };
}

/** Serial: the whole list, in this thread. Unchanged behaviour, same shape. */
export function computeBatchResults(rawLines) {
  return summarizeBatch(decideBatchRows(rawLines));
}
