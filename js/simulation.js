// ══════════════════════════════════════════════════════════════════
//  SIMULATION — the player
// ══════════════════════════════════════════════════════════════════
// What a *run* is, rather than what a machine is. This module owns the
// run box, the trace log, the step tracker, the scrubber, playback and
// the batch tester; it owns nothing about any particular machine.
//
// The machines themselves live under js/machines/, one module per family,
// and reach the player through the registry. So runSim below is the whole
// of the dispatch: parse the input the way this machine reads input, run
// the guards this machine carries, hand the result to this machine's
// simulator. It used to be a seventeen-branch if-chain ending in
// `else simTM(tokens)` — which is what a machine type nobody had wired up
// silently became.

import { makeSVG } from './render.js';
import { $, App, INPUT_LENGTH_NOTICE, R, detectsLoops, execMode, getMachineConfig, isOmegaAutomaton, isWeightedFA, runsLazily } from './state.js';
import { getState, getTransition } from './states-transitions.js';
import { dismissSymSuggest, trySymSuggestKeydown } from './suggest.js';
import { isAnyPDA, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA, parseEps, showStatus } from './utils.js';
import { decideMachine, machineGuards, parseMachineInput, simulateMachine, streamMachine } from './machines/index.js';
import { langStepBudget, stateNames } from './machines/runtime.js';
import { computeBatchResults, decideBatchRows, summarizeBatch } from './machines/batch.js';
import { poolSize, runParallel, shouldParallelize } from './parallel/pool.js';
import { renderTracker, resetTracker } from './tape-view.js';
import { isPainterSuppressed, setSimStepPainter, withPainterSuppressed } from './machines/paint.js';
import { makeRun } from './machines/run.js';
import { nodeIdAtScope, viewEdgeKeyFor, viewGraph, visibleNodeIdFor } from './view-graph.js';

export function runSim() {
  resetSim();
  let raw = parseEps($('sim-in').value);
  if (raw === App.config.sym.eps) $('sim-in').value = raw;
  if (raw !== '') {
    App.simInputHistory = App.simInputHistory || [];
    if (App.simInputHistory[App.simInputHistory.length - 1] !== raw) {
      App.simInputHistory.push(raw);
      if (App.simInputHistory.length > 50) App.simInputHistory.shift();
    }
  }
  App.simHistoryIdx = undefined;
  if (!App.startId) { log('<span class="t-err">No start state.</span>'); return; }

  const m = App.machine;
  // How this machine reads input is the machine's business: a finite word
  // for most, u(v) for an ω-automaton, one value per tape for an MTM.
  const parsed = parseMachineInput(m, raw);
  if (!parsed.ok) { log(`<span class="t-err">${parsed.error}</span>`); return; }

  // Claims about the machine rather than about this word — a D-type whose δ
  // branches, a weak automaton whose SCCs straddle F. A refusal stops the
  // run; a warning is printed and the run continues underneath it.
  for (const fired of machineGuards(m, parsed.input)) {
    if (fired.refuse) { log(`<span class="t-err">${fired.refuse}</span>`); return; }
    log(`<span class="t-warn">${fired.warn}</span>`);
  }

  // A long word is not refused — see INPUT_LENGTH_NOTICE. It is announced,
  // because the tape tracker draws a cell per symbol and the reader should
  // know that is what the pause is before they meet it.
  const wordLen = parsed.tokens?.length ?? 0;
  if (wordLen > INPUT_LENGTH_NOTICE) {
    log(`<span class="t-warn">${wordLen.toLocaleString()} symbols — the run itself is cheap, but the input row draws a cell for each one, so the tracker will take a moment to paint.</span>`);
  }

  // What the canvas highlights against. A multi-tape run has no single
  // token list, and says so by handing back null rather than a guess.
  if (parsed.tokens) App.currentTokens = parsed.tokens;

  // The word these steps belong to, so a later press of play can tell
  // "carry on" from "run this instead". Recorded after the guards, since a
  // refused run has no steps to resume.
  App.simInput = raw;

  beginRun(streamMachine(m, parsed.input), wordLen, m);

  // Unified playback: automatically start the animation if it loaded correctly
  if (App.simSteps && App.simSteps.length > 0) {
    toggleAuto();
  }
}

// How many steps a single drain slice may take before the loop gives the page
// back. "Go to the end" on a machine that never halts is otherwise an
// unbounded loop on the main thread — the run is bounded by maxTmSteps, but
// ten thousand tape snapshots is long enough to lose the frame and the Escape
// key with it.
const DRAIN_SLICE = 500;

/**
 * Take a run from the machine layer and make it the one on screen.
 *
 * Eager and lazy differ here and nowhere else. Eager drains the cursor before
 * the first frame, which is exactly what the app did when every simulator ran
 * to completion and wrote App.simSteps; lazy materializes only the first step
 * and lets playback pull the rest. Either way `App.simSteps` is the cursor's
 * array — the same object for the life of the run — so every reader of it, the
 * trace log's tail and the minimap and StateMate included, is untouched.
 */
export function beginRun(run, inputLen = 0, m = App.machine) {
  App.simRun = run;
  App.simSteps = run.steps;
  const lazy = run.streaming && runsLazily(inputLen, m);
  if (lazy) run.at(0);
  else run.drain();
  streamNote = noteForRun(run, lazy, m);
  App.simIdx = 0;
  renderSimStep();
  return run;
}

// The one-line explanation of why the step counter is showing a '+'. It is a
// property of the run rather than of a step, so it lives beside the run and is
// re-emitted by every log render — written into the log once at the top and
// then wiped by the next tick would be worse than not saying it at all.
//
// Only the automatic path says anything. A reader who chose a mode needs no
// narration, and a run that finished on its first pull is not streaming in any
// sense they could observe.
let streamNote = '';

function noteForRun(run, lazy, m) {
  if (!lazy || run.done || execMode() !== 'auto') return '';
  const cfg = getMachineConfig(m);
  const limit = cfg.hasTape ? App.config.maxTmSteps : App.config.maxPdaSteps;
  return '<div class="t-warn sim-log-stream">Streaming: this machine can run to '
    + `${limit.toLocaleString()} steps, so each is computed as it plays.</div>`;
}

/** The run on screen, or an empty one before anything has been run. */
function currentRun() {
  if (!App.simRun || App.simRun.steps !== App.simSteps) {
    // A direct caller wrote App.simSteps without going through beginRun —
    // every eager simulator does, and so does every test that calls one. An
    // array source is adopted by reference and reported done, so the transport
    // works unchanged on a run this module did not start.
    App.simRun = makeRun(App.simSteps || []);
  }
  return App.simRun;
}

/** Materialize the step at `idx` if the run can still reach it. */
function stepAt(idx) {
  return currentRun().at(idx);
}

/** Is there more run to come than has been materialized? */
export function runIsComplete() {
  return currentRun().done;
}
export function log(html) { const t = $('trace-log'); t.innerHTML = html; t.scrollTop = t.scrollHeight; }


// ── running a machine with no page to run it on ────────────────────
//
// Every simulator ends with `renderSimStep()`, and that call is the only place
// in a run that touches the page — which is exactly what StateMate's trace
// tool must not do. It runs a *private* candidate, so a paint here would
// replay a machine that is not on the reader's canvas across their trace log,
// tape tracker, canvas highlights, scrubber and verdict banner at once.
//
// A counter rather than a boolean so nesting cannot un-silence an outer run,
// and restored in a `finally` so a simulator that throws cannot leave the real
// player mute. `App.simSteps` is written either way — reading it back is how
// the caller gets its trace.
// The counter itself lives in js/machines/paint.js, so the machine layer can
// collect a run without the page — streamMachine() does exactly that for the
// simulators that cannot stream. Two counters for one property would be two
// ways for a run to be half-silenced.
export function runQuietly(fn) {
  return withPainterSuppressed(fn);
}

// The machine layer calls this through js/machines/paint.js rather than
// importing it from here, so that importing a simulator does not drag the
// renderer in behind it. Installing the binding is this module's job because
// this module owns the function; it happens as simulation.js evaluates, which
// on the main thread is long before any run can start.
setSimStepPainter(renderSimStep);

// Steps kept in the trace log. Generous next to the panel's height — scrolling
// back through the last few hundred steps of a run is a real thing to want, and
// scrolling back through ten thousand is what the scrubber is for.
export const SIM_LOG_TAIL = 400;

export function renderSimStep() {
  if (isPainterSuppressed()) return;
  const step = App.simSteps[App.simIdx]; if (!step) return;
  const isLast = App.simIdx === App.simSteps.length - 1;

  // Log update.
  //
  // Only the tail is written. The log used to be rebuilt from step 0 on every
  // tick, which is quadratic in the length of the run and the reason playing
  // back a Turing machine got slower the longer it ran: at maxTmSteps a single
  // tick meant building and parsing ten thousand divs, ten thousand times over.
  // The log scrolls itself to the bottom, so everything above the last screenful
  // was being built to be scrolled past; the count stands in for it instead, and
  // the scrubber is what actually navigates a long run.
  const from = Math.max(0, App.simIdx + 1 - SIM_LOG_TAIL);
  let logLines = streamNote;
  logLines += from
    ? `<div class="t-step sim-log-elided">… ${from.toLocaleString()} earlier step${from === 1 ? '' : 's'}</div>`
    : '';
  for (let i = from; i <= App.simIdx; i++) {
    const s = App.simSteps[i];
    const cl = i === App.simIdx
      ? (s.final === 'accept' ? 't-ok'
        : (s.final === 'reject' || s.final === 'loop') ? 't-err'
          : s.final === 'timeout' ? 't-warn' : 't-step')
      : '';
    logLines += `<div class="${cl}">${i}: ${s.note}</div>`;
  }
  log(logLines);

  // Unified Tracker System
  const trackerEl = $('sim-tracker');
  trackerEl.style.display = 'block';

  const rows = trackerRows(step);
  const finalClass = (isLast && step.final) ? step.final : '';
  rows.forEach(r => { r.finalClass = finalClass; });

  const stateName = getState(step.state)?.name || (step.states ? stateNames(step.states) : '?');
  renderTrackerHeader(trackerEl, stateName, rows);
  renderTracker(trackerBody(trackerEl), rows);

  updateSimCanvasHighlights(step);

  updateSimScrubber();
  updateSimVerdict(step, isLast);
}

// ══════════════════════════════════════════════════════════════════
//  THE STEP TRACKER
// ══════════════════════════════════════════════════════════════════
// What a step *shows*; js/tape-view.js is how a row of it is drawn.
//
// A row is one of two things and the difference is not cosmetic. A tape
// has ends — a wall the head cannot pass, or blank cells running on
// forever — and which ends it has is the whole difference between a TM,
// an ITM, an LBA and a two-way head. That fact comes from the tape
// itself, as `step.view`, for the same reason the clamp does: a machine
// name branch here would be a second, drifting copy of js/tape.js.
//
// A stack, a queue, an output and a probability distribution are *not*
// tapes, and are deliberately not drawn as ones. They get cells and no
// ends, because a stack's ends are a top and a bottom rather than a wall
// and an infinity, and drawing a wall at the bottom of a stack would be
// claiming something about it that is not true.

/**
 * A finite word, said in the tape vocabulary.
 *
 * The input row of a DFA really is a strip bounded at both ends, so it is
 * described as one rather than getting a row shape of its own — the
 * reader who has just watched an LBA scan between two markers should not
 * have to learn a second idiom to read a DFA's input.
 */
function wordView(cells, head, opts = {}) {
  return {
    say: opts.say,
    kind: 'tape',
    cells,
    head,
    origin: 0,
    leftBound: 0,
    rightBound: cells.length - 1,
    markers: [],
    blank: App.config.sym.blank,
    // Not read-only — nothing is being *declined* here. A DFA's input is a
    // word being consumed rather than a tape the machine chooses not to
    // write to, and saying "read-only" of it would put a caveat on the
    // commonest row in the app to describe a restriction that is not one.
    readOnly: false
  };
}

/**
 * A tape row, from the tape if the simulator sent one.
 *
 * The fallback matters: `step.view` is new, and a step can reach here
 * without one — a machine module that has not been taught to send it, or
 * a run restored from somewhere that predates it. Falling back to a plain
 * bounded strip draws the cells correctly and simply declines to claim
 * anything about the ends, which is better than guessing at them from the
 * machine's name.
 */
function tapeRow(label, view, cells, head) {
  return { label, view: view || wordView(cells || [], head ?? -1) };
}

function trackerRows(step) {
  const m = App.machine;
  const rows = [];

  // isSingleTapeTM is exactly TM/NDTM/LBA/ITM plus the two-way heads (2DFA,
  // 2NFA, 2DFT) — MTM is deliberately not in it and keeps its own branch.
  if (isSingleTapeTM(m)) {
    rows.push(tapeRow('Tape', step.view, step.tape, step.head));
  } else if (m === 'MTM') {
    step.tapes.forEach((t, i) => rows.push(
      tapeRow(`T${i + 1}`, step.views && step.views[i], t, step.heads[i])
    ));
  } else if (isOmegaAutomaton(m)) {
    // The ω-word is unrolled far enough to cover the witness lasso; the head
    // keeps advancing into the repetitions rather than wrapping in place.
    rows.push(tapeRow('ω', step.view, step.tape, step.head));
  } else {
    // DFA, NFA, PDA, Moore, Mealy
    const tokens = step.tokens || App.currentTokens || [];
    const tokensToDisplay = tokens.length ? tokens : [App.config.sym.eps];

    // Determine token index (which one was JUST read)
    // `pos` is how far the head has got, so the symbol just read is the one
    // before it. Asking for `step.remaining` here would build the suffix
    // array only to measure it — see js/machines/step-log.js.
    let tokIdx = -1;
    if (typeof step.pos === 'number') {
      tokIdx = step.pos - 1;
    } else {
      tokIdx = App.simIdx - 1;
    }

    // The empty word is drawn as the ε placeholder, which is one cell holding
    // a symbol that is not in it — so the length comes from the tokens.
    rows.push({
      label: 'In',
      view: wordView(tokensToDisplay, tokIdx, {
        say: {
          badge: `|w| = ${tokens.length}`,
          tip: `The input word: ${tokens.length} symbol${tokens.length === 1 ? '' : 's'}, read left to right. The head marks the symbol just consumed.`
        }
      })
    });

    if (isAnyPDA(m) && step.stack) {
      if (isQueueAutomaton(m)) {
        rows.push({ label: 'Que', cells: [...step.stack], head: 0, capL: 'front', capR: 'back' });
      } else {
        rows.push({ label: 'Stk', cells: [...step.stack].reverse(), head: 0, capL: 'top', capR: 'bottom' });
      }
      if (isTwoStackPDA(m) && step.stack2) {
        rows.push({ label: 'Stk2', cells: [...step.stack2].reverse(), head: 0, capL: 'top', capR: 'bottom' });
      }
    } else if (isWeightedFA(m) && step.dist) {
      // Not a tape: one cell per state still carrying probability, so the
      // distribution is legible as it spreads and collapses.
      rows.push({ label: 'Pr', cells: step.dist, head: -1 });
    }
  }

  // Any machine that prints gets an output row, wherever its other rows came
  // from — Moore/Mealy/FST alongside the input, PDT alongside the stack,
  // 2DFT alongside the two-way tape.
  if (getMachineConfig(m).isTransducer) {
    const outToks = step.outToks || [];
    rows.push({ label: 'Out', cells: outToks, head: outToks.length ? outToks.length - 1 : -1, capR: 'newest' });
  }

  return rows;
}

/**
 * The tracker is a header and a body, and the body is the part
 * js/tape-view.js caches its nodes in — so the two cannot share an
 * element, or rewriting the header would throw away every cell.
 */
function trackerBody(trackerEl) {
  let body = trackerEl.__tvBody;
  if (!body || body.parentNode !== trackerEl) {
    body = document.createElement('div');
    body.className = 'tv-body';
    trackerEl.appendChild(body);
    trackerEl.__tvBody = body;
  }
  return body;
}

/**
 * One line saying where the machine is: the state, and what is under
 * each head.
 *
 * A tape row also gets its *cell number*, which is the one thing the row
 * of boxes cannot say on its own — on a two-way tape the drawn position
 * and the cell diverge the moment the tape grows leftward, which is why
 * simTM had to put `@-3` in its note.
 */
function renderTrackerHeader(trackerEl, stateName, rows) {
  let head = trackerEl.__tvHeader;
  if (!head || head.parentNode !== trackerEl) {
    head = document.createElement('div');
    head.className = 'tracker-header';
    const text = document.createElement('span');
    text.className = 'tracker-header-text';
    head.appendChild(text);
    head.appendChild(makeTrackerCopyBtn());
    trackerEl.insertBefore(head, trackerEl.firstChild);
    trackerEl.__tvHeader = head;
  }
  const parts = rows.map(r => {
    const view = r.view;
    const cells = view ? view.cells : (r.cells || []);
    const idx = view ? view.head : (r.head ?? -1);
    const sym = (idx >= 0 && cells[idx] !== undefined) ? cells[idx] : '—';
    const at = (view && idx >= 0 && view.origin !== undefined)
      ? `<span class="tracker-val-at">@${view.origin + idx}</span>`
      : '';
    return `${r.label}:<span class="tracker-val-sym">${escapeCell(sym)}</span>${at}`;
  });
  head.firstChild.innerHTML = `State: <span class="tracker-val-st">${escapeCell(stateName)}</span>`
    + (parts.length ? ' &nbsp; ' + parts.join(' &nbsp; ') : '');
}

function escapeCell(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The whole row — every cell, not just the one under the head — as plain
 * text. Symbols join with nothing between them when every one is a single
 * character (the ordinary case: tape and stack alphabets are), or with a
 * space when any symbol is longer, so a multi-character symbol doesn't
 * fuse with its neighbour into a string the reader would have to re-split.
 */
function rowText(row) {
  const view = row.view;
  const cells = (view ? view.cells : (row.cells || [])).map(String);
  const spaced = cells.some(s => s.length > 1);
  return cells.join(spaced ? ' ' : '');
}

// The def-box / regex-box copy icon (index.html's .box-copy-btn), reused
// here rather than redrawn — same affordance, same glyph, wherever a panel
// offers to copy its own content.
const COPY_ICON_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" width="12" height="12">'
  + '<path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" />'
  + '</svg>';

// Built once per tracker header rather than written into index.html: unlike
// the def-box/regex-box copies, this one lives inside a node the tracker
// itself creates, so it is wired the way reference.js and the wizard button
// are — a listener attached at creation — and adds nothing to bridge.js.
function makeTrackerCopyBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tracker-copy-btn';
  btn.setAttribute('data-tip', 'Copy tape contents');
  btn.setAttribute('aria-label', 'Copy tape contents');
  btn.innerHTML = COPY_ICON_SVG;
  btn.addEventListener('click', copyTapeContents);
  return btn;
}

function copyTapeContents(evt) {
  // Captured now rather than read off `evt` inside the .then() below: a
  // DOM event's currentTarget is cleared once dispatch finishes, which is
  // well before the clipboard promise settles.
  const btn = evt && evt.currentTarget;
  const step = App.simSteps[App.simIdx];
  if (!step) { showStatus('Nothing to copy — run a simulation first'); return; }
  const rows = trackerRows(step);
  const text = rows.map(r => `${r.label}: ${rowText(r)}`).join('\n');
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showStatus('Clipboard access unavailable');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showStatus(rows.length > 1 ? 'Copied tape contents' : `Copied ${rows[0].label} contents`);
    if (btn) {
      btn.classList.add('copied');
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1200);
    }
  }).catch(() => showStatus('Copy failed — clipboard access blocked'));
}

// ══════════════════════════════════════════════════════════════════
//  CANVAS PATH HIGHLIGHTING
// ══════════════════════════════════════════════════════════════════
export function simMotionOk() {
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function findSimEdgeGroup(key) {
  if (!key) return null;
  return App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
}

// ── the run, projected onto what is drawn ─────────────────────────
// The machine is flat and the canvas is a projection of it (js/view-graph.js),
// so a run's own ids are not always ids the canvas has anything under. A step
// inside a block names a state that is not drawn, and a step that crosses a
// block's boundary names a transition drawn as `x2|b1` — a pair the *model*
// does not contain. Built from the transition's own endpoints, every one of
// those lookups came back empty: no trail, no active edge, no travelling token
// and no pulse, from the first step a run touched a block onward. The run was
// correct throughout; the whole of what was lost was the drawing of it.
//
// So both halves go through the projection. What resolves to nothing is dropped
// rather than guessed at: an edge *wholly inside* a block is not on screen, and
// the box standing in for it is already lit by the state half below.

/** The drawn edge a real transition is part of, or null when it is not drawn. */
function drawnEdgeKey(t) {
  return t ? viewEdgeKeyFor(t.id) : null;
}

/** The drawn node a real state is shown by — itself, or the box it is inside. */
function drawnNodeId(stateId) {
  return visibleNodeIdFor(stateId) || null;
}

// Edge(s) traversed to arrive at step `idx`, as "from|to" keys matching the
// grouped edge DOM. Path-style machines record the transition id on the step;
// NFA-style set steps are reconstructed from the previous state set (symbol
// move + ε-closure). NDTM exploration steps carry no path information —
// consecutive steps are BFS order, not a run — so they highlight states only.
export function getSimStepEdgeKeys(idx) {
  const keyOf = viewGraph().keyOf;
  const keys = new Set();
  for (const t of simStepTransitions(idx)) {
    const key = keyOf.get(t.id);
    // The *drawn* edge, which several real transitions can share — a Set is
    // what keeps a block's four incoming rules one highlight. What resolves to
    // nothing is an edge wholly inside a block, which is not on screen at all.
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * The real transitions a step was taken along.
 *
 * Split out from the keys because the two halves of the highlight want
 * different things from it: the canvas wants the *drawn* edge, and a block's
 * preview wants the transition itself, to find the mark for it one level in.
 * Written twice they would be two answers to "which edge fired", and the
 * preview would light one the canvas did not.
 */
function simStepTransitions(idx) {
  const step = App.simSteps[idx];
  if (!step) return [];
  if (step.tid) {
    const t = getTransition(step.tid);
    return t ? [t] : [];
  }
  if (step.states) return nfaStepTransitions(idx);
  return [];
}

export function getNfaSimStepEdgeKeys(idx) {
  const keyOf = viewGraph().keyOf;
  const keys = new Set();
  for (const t of nfaStepTransitions(idx)) {
    const key = keyOf.get(t.id);
    if (key) keys.add(key);
  }
  return [...keys];
}

function nfaStepTransitions(idx) {
  const eps = App.config.sym.eps, any = App.config.sym.any;
  const out = [];
  const step = App.simSteps[idx];
  const cur = new Set(step.states);
  let seed;
  if (idx === 0) {
    seed = new Set([App.startId]);
  } else {
    const prev = App.simSteps[idx - 1];
    const prevStates = prev.states || (prev.state ? [prev.state] : []);
    // The next symbol the previous step had to read, taken by index rather
    // than off the front of a suffix this would otherwise have to build.
    const prevToks = prev.tokens;
    const sym = (prevToks && typeof prev.pos === 'number' && prev.pos < prevToks.length)
      ? prevToks[prev.pos]
      : null;
    seed = new Set();
    if (sym !== null) {
      prevStates.forEach(sid => App.transitions.forEach(t => {
        if (t.from === sid && (t.symbol === sym || t.symbol === any) && cur.has(t.to)) {
          out.push(t);
          seed.add(t.to);
        }
      }));
    }
  }
  // ε-edges that expanded the closure into the current set
  const stk = [...seed], seen = new Set(seed);
  while (stk.length) {
    const s = stk.pop();
    App.transitions.forEach(t => {
      if (t.from === s && t.symbol === eps && cur.has(t.to)) {
        out.push(t);
        if (!seen.has(t.to)) { seen.add(t.to); stk.push(t.to); }
      }
    });
  }
  return out;
}

// What the last paint lit, so undoing it is a walk over a few dozen elements
// rather than four document-wide selector matches per step of playback.
let simLit = [];

// The preview paths whose `d` the last paint wrote. Kept apart from simLit
// because what has to be undone there is an attribute rather than a class —
// and blanking every block's path unconditionally would mean a write per box on
// screen per step, on boxes with no run anywhere near them.
let simLitPaths = [];

function litAdd(el, ...classes) {
  if (!el) return;
  el.classList.add(...classes);
  simLit.push([el, classes]);
}

export function clearSimCanvasHighlights() {
  for (const [el, classes] of simLit) el.classList.remove(...classes);
  simLit = [];
  for (const el of simLitPaths) el.setAttribute('d', '');
  simLitPaths = [];
  // Pulses are transient rings the animation appends and removes itself; the
  // sweep is a safety net for the ones whose animationend never fired, and it is
  // scoped to the states layer rather than the document.
  const layer = $('states-g');
  if (layer) layer.querySelectorAll('.sim-pulse').forEach(el => el.remove());
  removeSimTokens();
}

// The trail — every state and edge the run has been through — accumulates as
// the playhead advances, so it is carried forward rather than recomputed. It
// used to be rebuilt from step 0 on every step, and each of those steps resolved
// its transition by scanning App.transitions: at a machine's ten-thousandth step
// that is twenty million comparisons, for one frame of playback, and the run got
// slower with every step it took.
//
// Only a jump backwards costs a rebuild, which is what a scrub is and is
// bounded by where it lands.
function trailUpTo(idx) {
  // The keys are *drawn* keys, so the scope is part of what makes the cache
  // valid: drilling into a block while a run is paused changes which node every
  // step of it is shown by, and a trail carried across that would be a set of
  // keys for a diagram that is no longer on screen. Rebuilding costs what a
  // backward scrub costs, and only on a scope change.
  const scopeKey = (App.scope || []).join('/');
  let c = App._simTrail;
  if (!c || c.run !== App.simSteps || c.upTo > idx || c.scope !== scopeKey) {
    c = { run: App.simSteps, scope: scopeKey, upTo: 0, visited: new Set(), keys: new Set() };
  }
  for (let i = c.upTo; i < idx; i++) {
    const s = App.simSteps[i];
    (s.states || (s.state ? [s.state] : [])).forEach(id => c.visited.add(id));
    getSimStepEdgeKeys(i).forEach(k => c.keys.add(k));
  }
  c.upTo = Math.max(c.upTo, idx);
  App._simTrail = c;
  return c;
}

export function updateSimCanvasHighlights(step) {
  const isNewRun = App._simRenderRun !== App.simSteps;
  const advancedOne = !isNewRun && App.simIdx === App._simRenderIdx + 1;
  App._simRenderRun = App.simSteps;
  App._simRenderIdx = App.simIdx;

  clearSimCanvasHighlights();

  const trail = trailUpTo(App.simIdx);
  const visited = trail.visited;
  const trailKeys = trail.keys;

  const activeKeys = getSimStepEdgeKeys(App.simIdx);
  const activeSet = new Set(activeKeys);
  const hl = step.state ? [step.state] : (step.states || []);

  // Resolved to *drawn* nodes before anything is compared, and deduped there:
  // several states inside one block are one box on screen, so a set of real ids
  // would light it once per member and — worse — the "is this one already
  // active?" test below would answer about ids the canvas does not have.
  const hlNodes = new Set();
  hl.forEach(id => { const n = drawnNodeId(id); if (n) hlNodes.add(n); });
  const visitedNodes = new Set();
  visited.forEach(id => { const n = drawnNodeId(id); if (n && !hlNodes.has(n)) visitedNodes.add(n); });

  // The registries rather than the document: after culling only the drawn
  // window has nodes, and a state the trail passed through that is currently
  // off screen has nothing to mark.
  visitedNodes.forEach(id => {
    litAdd(App.domCache.states.get(id), 'sim-visited-st');
  });
  trailKeys.forEach(k => {
    if (activeSet.has(k)) return;
    litAdd(findSimEdgeGroup(k), 'sim-trail-t');
  });

  hlNodes.forEach(id => {
    litAdd(App.domCache.states.get(id) || document.querySelector(`[data-id="${id}"]`),
      step.final === 'reject' ? 'rej-st' : 'act-st');
  });
  activeKeys.forEach(k => {
    litAdd(findSimEdgeGroup(k), 'sim-active-t');
    litAdd(document.getElementById(`lbl-${k}`), 'sim-active-lbl');
    litAdd(document.getElementById(`pill-lbl-${k}`), 'sim-active-lbl');
  });

  // ── one level in ──
  // A box on the canvas is a small drawing of the machine inside it, so the
  // marks above stop one level short of what the reader can actually see: the
  // box lights, and the dot that is really running stays the same grey as the
  // twenty around it. These write onto elements the preview already built, so
  // the cost is a class per mark and nothing is rebuilt — see markPreviewRun.
  markPreviewRun(hl, visited, simStepTransitions(App.simIdx), step);

  // Motion: a token slides along each newly-taken edge, then the arrival
  // state pulses (verdict-colored on the final step). Only on a single
  // forward step — scrubbing and jumps update instantly.
  if (!simMotionOk()) return;
  const tone = step.final === 'reject' ? 'rej' : step.final === 'accept' ? 'acc' : '';
  // Over the drawn nodes, so a run that has stepped inside a block pulses the
  // box once rather than pulsing nothing four times.
  const pulseAll = () => hlNodes.forEach(id => pulseSimNode(id, tone));
  if (advancedOne && activeKeys.length) {
    const dur = App.autoTimer
      ? Math.max(160, Math.min(App.config.autoSpeed * 0.6, 500))
      : 280;
    activeKeys.slice(0, 8).forEach((k, i) => {
      animateSimToken(k, dur, i === 0 ? pulseAll : null);
    });
  } else if ((advancedOne && step.final) || (isNewRun && App.simIdx === 0)) {
    pulseAll();
  }
}

/**
 * The run, marked inside the previews the blocks on screen are drawing.
 *
 * **Nothing here rebuilds a preview**, and that is the whole of why it is
 * affordable. `renderAll` draws a preview only when `blockPreviewKey` changes,
 * and a run changes no position and no transition — so the dots and the edge
 * subpaths this writes to were built once and are still there. Per step the
 * work is: a short ancestry walk per marked state (nodeIdAtScope), a Map get
 * per mark, and one `d` write per box the run is actually inside. It runs on a
 * step change rather than on a frame, so it is off the render path entirely.
 *
 * What it deliberately does not do is send a travelling token in there. At
 * preview scale an interior edge is a dozen pixels and a node is two, so the
 * dot would be larger than the states it travels between — the one part of the
 * canvas animation that does not survive being shrunk.
 */
function markPreviewRun(active, visited, transitions, step) {
  const boxes = App.domCache.states;
  const activeCls = step.final === 'reject' ? 'is-rej' : 'is-active';

  // A state is marked in a preview only when it is *inside* a box — a state at
  // this scope is drawn as itself and already has the canvas mark.
  const markState = (stateId, cls) => {
    const boxId = drawnNodeId(stateId);
    if (!boxId || boxId === stateId) return;
    const g = boxes.get(boxId);
    if (!g || !g.__pvIndex) return;   // off screen, or blanked by the zoom LOD
    const pvId = nodeIdAtScope(stateId, boxId);
    const el = pvId && g.__pvIndex.get(pvId);
    if (el) litAdd(el, cls);
  };

  visited.forEach(id => markState(id, 'is-visited'));
  active.forEach(id => markState(id, activeCls));

  // The edge, which is only drawn when both ends are immediate members of the
  // same box: an edge deeper than that is inside the nested rect the state half
  // has already lit, and one crossing the box's own boundary is the canvas edge
  // above.
  const byBox = new Map();
  for (const t of transitions) {
    const boxId = drawnNodeId(t.from);
    if (!boxId || boxId === t.from || drawnNodeId(t.to) !== boxId) continue;
    const g = boxes.get(boxId);
    if (!g || !g.__pvEdgeD) continue;
    const a = nodeIdAtScope(t.from, boxId), b = nodeIdAtScope(t.to, boxId);
    if (!a || !b || a === b) continue;
    const d = g.__pvEdgeD.get(a + '|' + b);
    if (!d) continue;
    const acc = byBox.get(g);
    if (acc) acc.push(d); else byBox.set(g, [d]);
  }
  for (const [g, parts] of byBox) {
    const el = g.__parts.pvActive;
    el.setAttribute('d', parts.join(' '));
    simLitPaths.push(el);
    if (step.final === 'reject') litAdd(el, 'is-rej');
  }
}

export function removeSimTokens() {
  (App._simTokens || []).forEach(t => { cancelAnimationFrame(t.raf); t.el.remove(); });
  App._simTokens = [];
}

export function animateSimToken(edgeKey, dur, onDone) {
  const grp = findSimEdgeGroup(edgeKey);
  const pathEl = grp && grp.querySelector('.tarr');
  const layer = $('sim-anim-g');
  // Probe only — the flight itself re-measures per frame (see tick below). A path
  // with no length, or a host without getTotalLength at all, means there is
  // nothing to travel along, so hand straight back to the caller.
  let len = 0;
  try { len = pathEl && layer ? pathEl.getTotalLength() : 0; } catch (e) { }
  if (!len) { if (onDone) onDone(); return; }
  const dot = makeSVG('circle');
  // The radius is in world units, so the camera divides it: on a machine drawn
  // at 8% a 5px token is half a pixel of the one thing that says which edge is
  // being taken right now. It is sized against the zoom instead, never below
  // its own 5px, so it stays the same dot on screen however far out you are.
  dot.setAttribute('r', Math.max(5, 5 / (App.cam?.z || 1)));
  dot.classList.add('sim-token');
  const p0 = pathEl.getPointAtLength(0);
  dot.setAttribute('cx', p0.x); dot.setAttribute('cy', p0.y);
  layer.appendChild(dot);
  const token = { el: dot, raf: 0 };
  App._simTokens = App._simTokens || [];
  App._simTokens.push(token);
  const t0 = performance.now();
  const finish = () => {
    dot.remove();
    App._simTokens = (App._simTokens || []).filter(t => t !== token);
    if (onDone) onDone();
  };
  const tick = now => {
    if (!pathEl.isConnected) { finish(); return; }
    const p = Math.min(1, (now - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOutQuad
    // Re-read the length rather than reusing the one measured above: the edge
    // under the token may still be easing toward a new route (js/anim.js), and a
    // stale length against a path that has since changed leaves the token short
    // of the arrowhead or past it. getTotalLength is path-data arithmetic, not a
    // style or layout read, so this costs nothing per frame.
    const pt = pathEl.getPointAtLength(pathEl.getTotalLength() * e);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    if (p < 1) token.raf = requestAnimationFrame(tick);
    else finish();
  };
  token.raf = requestAnimationFrame(tick);
}

/**
 * The arrival ring, on a *drawn* node — which is a circle for a state and a box
 * for a block or a port.
 *
 * The shape is asked of the node rather than assumed, because the ring has to
 * trace the outline the reader can see: a circle of radius R centred on a box
 * two hundred pixels wide is a ring floating inside it, which reads as a second
 * unexplained mark rather than as "control arrived here".
 *
 * The scale is the shape's too. `.sim-pulse` grows 1.7x from its own centre,
 * which is right for a 22px circle and far too much for a block's box — it
 * would sweep out over half the diagram. `.is-box` is the gentler ramp.
 */
export function pulseSimNode(nodeId, tone = '') {
  const grp = App.domCache.states.get(nodeId) || document.querySelector(`[data-id="${nodeId}"]`);
  if (!grp) return;
  const parts = grp.__parts || {};
  const box = (grp.__kind === 'block' || grp.__kind === 'port') ? parts.body : null;
  let ring;
  if (box) {
    ring = makeSVG('rect');
    ring.setAttribute('x', box.getAttribute('x'));
    ring.setAttribute('y', box.getAttribute('y'));
    ring.setAttribute('width', box.getAttribute('width'));
    ring.setAttribute('height', box.getAttribute('height'));
    const rx = box.getAttribute('rx');
    if (rx) ring.setAttribute('rx', rx);
    ring.classList.add('is-box');
  } else {
    const c = parts.circle || (grp.querySelector && grp.querySelector('circle.bd'));
    if (!c) return;
    ring = makeSVG('circle');
    ring.setAttribute('cx', c.getAttribute('cx'));
    ring.setAttribute('cy', c.getAttribute('cy'));
    ring.setAttribute('r', R);
  }
  ring.classList.add('sim-pulse');
  if (tone) ring.classList.add(tone);
  grp.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove());
  setTimeout(() => ring.remove(), 900); // safety net if animations are disabled
}

/** The same, addressed by a *machine* state id. */
export function pulseSimState(id, tone = '') {
  const nodeId = drawnNodeId(id);
  if (nodeId) pulseSimNode(nodeId, tone);
}

// ── Scrubber / transport ──
export function updateSimScrubber() {
  const row = $('sim-scrubber-row'), scrubber = $('sim-scrubber'), counter = $('sim-step-counter');
  if (!row || !scrubber || !counter) return;
  // Under a streaming run this is what has been materialized, not the length
  // of the run — which is not knowable until the machine halts. The counter
  // says so with a '+' rather than quietly reporting a total that will grow;
  // the slider addresses the prefix and its max moves with it.
  const known = App.simSteps.length;
  const complete = runIsComplete();
  row.style.display = known > 1 ? 'flex' : 'none';
  if (document.activeElement !== scrubber) {
    scrubber.max = String(Math.max(0, known - 1));
    scrubber.value = String(App.simIdx);
  }
  counter.textContent = `${known ? App.simIdx + 1 : 0} / ${known}${complete ? '' : '+'}`;
}

export const SIM_ICON_ACCEPT = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>';
export const SIM_ICON_REJECT = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';
export const SIM_ICON_PLAY = '<svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/></svg>';
export const SIM_ICON_PAUSE = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M200,28H160a20,20,0,0,0-20,20V208a20,20,0,0,0,20,20h40a20,20,0,0,0,20-20V48A20,20,0,0,0,200,28Zm-4,176H164V52h32ZM96,28H56A20,20,0,0,0,36,48V208a20,20,0,0,0,20,20H96a20,20,0,0,0,20-20V48A20,20,0,0,0,96,28ZM92,204H60V52H92Z"/></svg>';
export const SIM_ICON_REPEAT = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M228,48V96a12,12,0,0,1-12,12H168a12,12,0,0,1,0-24h19l-7.8-7.8a75.55,75.55,0,0,0-53.32-22.26h-.43A75.49,75.49,0,0,0,72.39,75.57,12,12,0,1,1,55.61,58.41a99.38,99.38,0,0,1,69.87-28.47H126A99.42,99.42,0,0,1,196.2,59.23L204,67V48a12,12,0,0,1,24,0ZM183.61,180.43a75.49,75.49,0,0,1-53.09,21.63h-.43A75.55,75.55,0,0,1,76.77,179.8L69,172H88a12,12,0,0,0,0-24H40a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V189l7.8,7.8A99.42,99.42,0,0,0,130,226.06h.56a99.38,99.38,0,0,0,69.87-28.47,12,12,0,0,0-16.78-17.16Z"/></svg>';
export const SIM_ICON_SEPARATOR = '<span class="run-btn-sep">|</span>';

// Clicking run-btn plays, pauses, resumes or replays — one button, the way
// a media control works.
//
// **Pause then play resumes; it does not start over.** It used to call
// runSim() unconditionally, which begins with resetSim() — so pausing to
// look at a configuration and pressing play again threw the run away and
// re-ran it from step 0. That is the one thing a pause button must not do,
// and it made pausing useless on exactly the runs worth pausing: a long
// tape machine, where getting back to where you were meant holding the
// step key. Resuming is not a new capability either — the ▶| button already
// advances the same paused run without re-simulating.
//
// Two things are deliberately *not* resumed. A run sitting on its last step
// has nothing to resume, and the button is already showing the replay icon
// by then, so it re-runs. And a run whose word no longer matches the run box
// re-runs too: editing the box and pressing play means "run this", and
// silently continuing the previous word would be the same class of surprise
// in the other direction.
export function handleRunBtnClick() {
  if (App.autoTimer) { stopAutoPlay(); setRunBtnState('idle'); return; }
  if (canResumeSim()) { toggleAuto(); return; }
  runSim();
}

/** Is there a paused run left to carry on with, for the word in the box? */
export function canResumeSim() {
  if (!App.simSteps.length) return false;
  // At the frontier of a run that has not finished is a resumable position:
  // the next press pulls the next step. Only a *finished* run sitting on its
  // last step has nothing left to carry on with.
  if (App.simIdx >= App.simSteps.length - 1 && runIsComplete()) return false;
  return App.simInput !== null && App.simInput === parseEps($('sim-in').value);
}

// Run doubles as the verdict/transport readout — recoloring/relabeling this
// one button communicates play state and accept/reject at a glance instead
// of separate controls/banner. 'idle' is pre-run/paused/mid-scrub; 'playing'
// while the auto-play timer is running; 'accept'/'reject' only apply once
// isLast is true and get cleared the moment you step away from the final
// step, reset, or start a new run.
export function setRunBtnState(mode) {
  const btn = $('run-btn');
  if (!btn) return;
  btn.classList.remove('accept', 'reject');
  if (mode === 'accept') { btn.classList.add('accept'); btn.innerHTML = `${SIM_ICON_ACCEPT}${SIM_ICON_SEPARATOR}${SIM_ICON_REPEAT}`; return; }
  if (mode === 'reject') { btn.classList.add('reject'); btn.innerHTML = `${SIM_ICON_REJECT}${SIM_ICON_SEPARATOR}${SIM_ICON_REPEAT}`; return; }
  btn.innerHTML = App.autoTimer ? SIM_ICON_PAUSE : SIM_ICON_PLAY;
}

export function updateSimVerdict(step, isLast) {
  const el = $('sim-verdict');
  if (!el) return;
  if (!isLast) { el.style.display = 'none'; setRunBtnState('idle'); return; }
  if (step.final === 'accept' || step.final === 'reject') {
    el.style.display = 'none';
    setRunBtnState(step.final);
    return;
  }
  // A proven loop IS a decision — the machine never halts, so the input is
  // not accepted — but it is a different fact from halting in a non-accepting
  // state, and the banner says which one happened.
  if (step.final === 'loop') {
    setRunBtnState('reject');
    el.style.display = 'flex';
    el.className = 'sim-verdict loop';
    el.innerHTML = `<span class="sim-verdict-lbl">Loop</span>` +
      `<span class="sim-verdict-out">configuration repeats step ${step.loopFrom ?? 0} — never halts, so the input is not accepted</span>`;
    return;
  }
  // A run that never halted has no verdict at all. Saying so is the point —
  // the alternative is a red REJECT that quietly asserts something false.
  if (step.final === 'timeout') {
    setRunBtnState('idle');
    el.style.display = 'flex';
    el.className = 'sim-verdict timeout';
    // With loop detection off this is where a proven non-halt would have been
    // reported, so the banner names the setting rather than leaving the
    // reader to wonder why the app stopped deciding.
    const off = detectsLoops() ? '' : ', and loop detection is off';
    el.innerHTML = `<span class="sim-verdict-lbl">No verdict</span>` +
      `<span class="sim-verdict-out">still running after ${step.limit || App.config.maxTmSteps} steps — not a rejection${off}</span>`;
    return;
  }
  setRunBtnState('idle');
  const cfg = getMachineConfig(App.machine);
  if (cfg.isTransducer && step.outToks !== undefined) {
    el.style.display = 'flex';
    el.className = 'sim-verdict output';
    el.innerHTML = `<span class="sim-verdict-lbl">Output</span><span class="sim-verdict-out">${step.outToks.length ? step.outToks.join('') : '—'}</span>`;
    return;
  }
  el.style.display = 'none';
}

export function stopAutoPlay() {
  stopDraining();
  if (!App.autoTimer) return;
  clearInterval(App.autoTimer); App.autoTimer = null;
}

export function stepFwd(stopAuto = true) {
  if (stopAuto) stopAutoPlay();
  // The pull is the bounds check: on a streaming run the next step may not
  // exist yet, and asking for it is what computes it.
  if (stepAt(App.simIdx + 1)) { App.simIdx++; renderSimStep(); }
}
export function stepBack() {
  stopAutoPlay();
  if (App.simIdx > 0) { App.simIdx--; renderSimStep(); }
}
export function stepToStart() {
  if (!App.simSteps.length) return;
  stopAutoPlay();
  App.simIdx = 0; renderSimStep();
}
export function stepToEnd() {
  if (!App.simSteps.length) return;
  stopAutoPlay();
  // On a streaming run "the end" is a computation rather than an index, so it
  // is drained in slices with the page given back between them — a machine
  // that never halts runs to its budget here, and holding the main thread for
  // all of it would take the Escape key with it.
  const run = currentRun();
  if (!run.done) {
    const tick = () => {
      run.drain(DRAIN_SLICE);
      App.simIdx = Math.max(0, App.simSteps.length - 1);
      renderSimStep();
      if (!run.done) App.simDrainTimer = setTimeout(tick, 0);
      else App.simDrainTimer = null;
    };
    stopDraining();
    tick();
    return;
  }
  App.simIdx = App.simSteps.length - 1; renderSimStep();
}

/** Stop a "go to the end" that is still draining a streaming run. */
export function stopDraining() {
  if (App.simDrainTimer) { clearTimeout(App.simDrainTimer); App.simDrainTimer = null; }
}
export function scrubSim(value) {
  const idx = parseInt(value, 10);
  if (isNaN(idx) || idx < 0 || idx >= App.simSteps.length) return;
  stopAutoPlay();
  App.simIdx = idx;
  renderSimStep();
}
export function setAutoSpeedPreset(ms) {
  App.config.autoSpeed = parseInt(ms, 10) || 500;
  restartAutoTimerIfPlaying();
}
// Re-arms the auto-play interval at the current autoSpeed, but only if
// playback is already running — called whenever autoSpeed changes so an
// in-progress run picks up the new pace instead of finishing out the old one.
export function restartAutoTimerIfPlaying() {
  if (!App.autoTimer) return;
  clearInterval(App.autoTimer);
  App.autoTimer = setInterval(() => {
    // stepFwd pulls, so on a streaming run playback is what drives the
    // computation: the machine advances one step per tick because the animation
    // asked for it, rather than the whole run having been built beforehand.
    if (!stepAt(App.simIdx + 1)) { stopAutoPlay(); return; }
    stepFwd(false);
  }, App.config.autoSpeed);
}
export function resetSim() {
  stopAutoPlay();
  App.simSteps = []; App.simIdx = 0; App.currentTokens = null; App.simInput = null;
  // The cursor goes with the steps it was producing. An abandoned generator is
  // collected on its own; what must not survive is a run whose `steps` array is
  // no longer the one App.simSteps points at.
  App.simRun = null;
  streamNote = '';
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  resetTracker($('sim-tracker')); $('sim-tracker').style.display = 'none';
  const verdict = $('sim-verdict'); if (verdict) verdict.style.display = 'none';
  const scrubRow = $('sim-scrubber-row'); if (scrubRow) scrubRow.style.display = 'none';
  clearSimCanvasHighlights();
  App._simRenderRun = null; App._simRenderIdx = -1;
  // The accumulated trail is keyed on the steps array it was built from, and
  // the assignment above hands out a new one — but clearing it here keeps that
  // an explicit reset rather than a consequence of how resetSim happens to
  // empty the run.
  App._simTrail = null;
  setRunBtnState('idle');
}
export function toggleAuto() {
  if (App.autoTimer) { stopAutoPlay(); setRunBtnState('idle'); return; }
  App.autoTimer = setInterval(() => {
    // stepFwd pulls, so on a streaming run playback is what drives the
    // computation: the machine advances one step per tick because the animation
    // asked for it, rather than the whole run having been built beforehand.
    if (!stepAt(App.simIdx + 1)) { stopAutoPlay(); return; }
    stepFwd(false);
  }, App.config.autoSpeed);
  setRunBtnState('playing');
}

// ── Input history (↑ / ↓ recall previously-run strings) ──
export function handleSimInputKeydown(e) {
  if (typeof trySymSuggestKeydown === 'function' && trySymSuggestKeydown(e)) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    // dismissSymSuggest (not hideSymSuggest) — Enter's keyup still fires
    // after this keydown handler returns, and would otherwise pop the
    // popover back open via the onkeyup caret-refresh handler.
    if (typeof dismissSymSuggest === 'function') dismissSymSuggest();
    runSim();
    return;
  }
  const hist = App.simInputHistory || [];
  if (!hist.length) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (App.simHistoryIdx === undefined || App.simHistoryIdx < 0) App.simHistoryIdx = hist.length;
    App.simHistoryIdx = Math.max(0, App.simHistoryIdx - 1);
    e.target.value = hist[App.simHistoryIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (App.simHistoryIdx === undefined) return;
    App.simHistoryIdx = Math.min(hist.length, App.simHistoryIdx + 1);
    e.target.value = App.simHistoryIdx >= hist.length ? '' : hist[App.simHistoryIdx];
  }
}

// ══════════════════════════════════════════════════════════════════
//  BATCH TESTING
// ══════════════════════════════════════════════════════════════════
// The deciding half of the batch tester moved to js/machines/batch.js so a
// worker can run it — see the header there. Re-exported from here because
// this is where every caller already imports it from, and because a batch
// run is still a *run*: the player owns the control flow, the machine layer
// owns the verdict.
export { computeBatchResults, decideBatchRows, parseBatchLine, summarizeBatch } from './machines/batch.js';

export function renderBatchResults(batch) {
  const summaryEl = $('batch-summary');
  const { results } = batch;

  if (summaryEl) {
    if (batch.expected) {
      summaryEl.style.display = 'block';
      summaryEl.className = `batch-summary ${batch.allPassed ? 'all-pass' : 'has-fail'}`;
      summaryEl.textContent = `${batch.passCount} / ${batch.expected} expectations passed`;
    } else {
      summaryEl.style.display = 'none';
    }
  }

  const sub = 'color:var(--text3);font-size:.65rem';
  const rows = results.map(r => {
    if (r.error) return `<div class="br-err">✗ "${r.str}" — cannot tokenize</div>`;
    const outTag = r.output !== null ? ` <span style="${sub}">→ "${r.output}"</span>` : '';
    if (r.verdict === 'unknown') {
      const why = r.expect ? `expected ${r.expect}, still running` : 'still running';
      return `<div class="br-unk">? "${r.str}" <span style="${sub}">(${why} after ${batch.budget} steps — not a rejection)</span></div>`;
    }
    if (r.expect) {
      const got = r.verdict;
      const pass = got === r.expect;
      return `<div class="${pass ? 'br-ok' : 'br-err'}">${pass ? '✓' : '✗'} "${r.str}" <span style="${sub}">(expected ${r.expect}, got ${got})</span>${outTag}</div>`;
    }
    if (r.accepted === undefined) return `<div class="br-ok" style="border-left-color:var(--text-main)"><span style="color:var(--text-main)">•</span> "${r.str}"${outTag}</div>`;
    return `<div class="${r.accepted ? 'br-ok' : 'br-err'}">${r.accepted ? '✓' : '✗'} "${r.str}"${outTag}</div>`;
  }).join('');

  const unknowns = batch.unknowns;
  const budgetNote = unknowns
    ? `<div class="br-note">${unknowns} input${unknowns > 1 ? 's' : ''} had no verdict inside ${batch.budget} steps. ` +
      `Raise <em>Language Fingerprint Budget</em> in Settings › Turing Machine; whatever stays unresolved never halts.</div>`
    : '';
  $('batch-result').innerHTML = rows + budgetNote;
  const bar = $('batch-export-bar');
  if (bar) bar.style.display = results.length ? 'flex' : 'none';
}

// Incremented on every run, so a parallel result that lands after the reader
// has started another one — of either kind — is dropped instead of painting
// over it. The serial branch bumps it too: a short run started while a long
// one is still out must not be overwritten when the long one returns.
let batchRunToken = 0;

export function runBatch() {
  const token = ++batchRunToken;
  const rawLines = $('batch-in').value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (!rawLines.length) return;
  if (!App.startId) {
    $('batch-result').innerHTML = `<div class="br-err">Error: No start state defined.</div>`;
    const summaryEl = $('batch-summary');
    if (summaryEl) summaryEl.style.display = 'none';
    const bar = $('batch-export-bar');
    if (bar) bar.style.display = 'none';
    App.lastBatch = null;
    return;
  }
  // Every row is an independent run over one unchanging machine, which is the
  // one workload in the app that goes wide for free. Under the threshold — or
  // wherever workers are unavailable — this is the same synchronous call it
  // always was, and both paths run the identical decideBatchRows().
  if (!shouldParallelize(rawLines.length, App.machine)) {
    const batch = computeBatchResults(rawLines);
    // Held so the export actions report exactly what is on screen rather than
    // silently re-running the machine against an edited textarea.
    App.lastBatch = batch;
    renderBatchResults(batch);
    return;
  }

  renderBatchPending(rawLines.length);
  runParallel({
    kind: 'batch', items: rawLines, machine: App.machine, serial: decideBatchRows
  }).then(rows => {
    // A second Run pressed while this one was out supersedes it — the results
    // on screen must be the ones for the words in the box now.
    if (token !== batchRunToken) return;
    const batch = summarizeBatch(rows);
    App.lastBatch = batch;
    renderBatchResults(batch);
  });
}

// A parallel batch is the only one that can take long enough to need saying
// so. Deliberately plain: the results table replaces this the moment the pool
// returns, and a progress bar that is usually on screen for 80ms is noise.
function renderBatchPending(n) {
  // The previous run's rows are no longer what the box says, and the export
  // actions read App.lastBatch — so it goes now rather than when the pool
  // returns, or a fast click exports results for words that are gone.
  App.lastBatch = null;
  const el = $('batch-result');
  if (el) el.innerHTML = `<div class="br-note">Running ${n} words on ${poolSize()} threads…</div>`;
  const summaryEl = $('batch-summary');
  if (summaryEl) summaryEl.style.display = 'none';
  const bar = $('batch-export-bar');
  if (bar) bar.style.display = 'none';
}


