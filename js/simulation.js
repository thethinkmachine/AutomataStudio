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
import { $, App, R, detectsLoops, getMachineConfig, isOmegaAutomaton, isWeightedFA } from './state.js';
import { getState } from './states-transitions.js';
import { dismissSymSuggest, trySymSuggestKeydown } from './suggest.js';
import { isAnyPDA, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA, parseEps } from './utils.js';
import { decideMachine, machineGuards, parseMachineInput, simulateMachine } from './machines/index.js';
import { langStepBudget, stateNames } from './machines/runtime.js';
import { renderTracker, resetTracker } from './tape-view.js';

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

  // What the canvas highlights against. A multi-tape run has no single
  // token list, and says so by handing back null rather than a guess.
  if (parsed.tokens) App.currentTokens = parsed.tokens;

  // The word these steps belong to, so a later press of play can tell
  // "carry on" from "run this instead". Recorded after the guards, since a
  // refused run has no steps to resume.
  App.simInput = raw;

  simulateMachine(m, parsed.input);

  // Unified playback: automatically start the animation if it loaded correctly
  if (App.simSteps && App.simSteps.length > 0) {
    toggleAuto();
  }
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
let quietDepth = 0;

export function runQuietly(fn) {
  quietDepth++;
  try { return fn(); } finally { quietDepth--; }
}

export function renderSimStep() {
  if (quietDepth) return;
  const step = App.simSteps[App.simIdx]; if (!step) return;
  const isLast = App.simIdx === App.simSteps.length - 1;

  // Log update
  const logLines = App.simSteps.slice(0, App.simIdx + 1).map((s, i) => {
    const cl = i === App.simIdx
      ? (s.final === 'accept' ? 't-ok'
        : (s.final === 'reject' || s.final === 'loop') ? 't-err'
          : s.final === 'timeout' ? 't-warn' : 't-step')
      : '';
    return `<div class="${cl}">${i}: ${s.note}</div>`;
  }).join('');
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
    let tokIdx = -1;
    if (step.remaining) {
      tokIdx = tokens.length - step.remaining.length - 1;
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
  head.innerHTML = `State: <span class="tracker-val-st">${escapeCell(stateName)}</span>`
    + (parts.length ? ' &nbsp; ' + parts.join(' &nbsp; ') : '');
}

function escapeCell(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════
//  CANVAS PATH HIGHLIGHTING
// ══════════════════════════════════════════════════════════════════
export function simMotionOk() {
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function findSimEdgeGroup(key) {
  return App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
}

// Edge(s) traversed to arrive at step `idx`, as "from|to" keys matching the
// grouped edge DOM. Path-style machines record the transition id on the step;
// NFA-style set steps are reconstructed from the previous state set (symbol
// move + ε-closure). NDTM exploration steps carry no path information —
// consecutive steps are BFS order, not a run — so they highlight states only.
export function getSimStepEdgeKeys(idx) {
  const step = App.simSteps[idx];
  if (!step) return [];
  if (step.tid) {
    const t = App.transitions.find(tr => tr.id === step.tid);
    return t ? [t.from + '|' + t.to] : [];
  }
  if (step.states) return getNfaSimStepEdgeKeys(idx);
  return [];
}

export function getNfaSimStepEdgeKeys(idx) {
  const eps = App.config.sym.eps, any = App.config.sym.any;
  const step = App.simSteps[idx];
  const cur = new Set(step.states);
  const keys = new Set();
  let seed;
  if (idx === 0) {
    seed = new Set([App.startId]);
  } else {
    const prev = App.simSteps[idx - 1];
    const prevStates = prev.states || (prev.state ? [prev.state] : []);
    const sym = prev.remaining && prev.remaining.length ? prev.remaining[0] : null;
    seed = new Set();
    if (sym !== null) {
      prevStates.forEach(sid => App.transitions.forEach(t => {
        if (t.from === sid && (t.symbol === sym || t.symbol === any) && cur.has(t.to)) {
          keys.add(t.from + '|' + t.to);
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
        keys.add(t.from + '|' + t.to);
        if (!seen.has(t.to)) { seen.add(t.to); stk.push(t.to); }
      }
    });
  }
  return [...keys];
}

export function clearSimCanvasHighlights() {
  document.querySelectorAll('.sn.act-st, .sn.rej-st, .sn.sim-visited-st')
    .forEach(el => el.classList.remove('act-st', 'rej-st', 'sim-visited-st'));
  document.querySelectorAll('.edge-g.sim-active-t, .edge-g.sim-trail-t')
    .forEach(el => el.classList.remove('sim-active-t', 'sim-trail-t'));
  document.querySelectorAll('.tlbl.sim-active-lbl').forEach(el => el.classList.remove('sim-active-lbl'));
  document.querySelectorAll('.sim-pulse').forEach(el => el.remove());
  removeSimTokens();
}

export function updateSimCanvasHighlights(step) {
  const isNewRun = App._simRenderRun !== App.simSteps;
  const advancedOne = !isNewRun && App.simIdx === App._simRenderIdx + 1;
  App._simRenderRun = App.simSteps;
  App._simRenderIdx = App.simIdx;

  clearSimCanvasHighlights();

  // Trail: everything traversed before the current step accumulates
  // behind the playhead, so the whole route stays visible.
  const visited = new Set();
  const trailKeys = new Set();
  for (let i = 0; i < App.simIdx; i++) {
    const s = App.simSteps[i];
    (s.states || (s.state ? [s.state] : [])).forEach(id => visited.add(id));
    getSimStepEdgeKeys(i).forEach(k => trailKeys.add(k));
  }

  const activeKeys = getSimStepEdgeKeys(App.simIdx);
  const hl = step.state ? [step.state] : (step.states || []);

  visited.forEach(id => {
    if (hl.includes(id)) return;
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('sim-visited-st');
  });
  trailKeys.forEach(k => {
    if (activeKeys.includes(k)) return;
    const el = findSimEdgeGroup(k);
    if (el) el.classList.add('sim-trail-t');
  });

  hl.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add(step.final === 'reject' ? 'rej-st' : 'act-st');
  });
  activeKeys.forEach(k => {
    const el = findSimEdgeGroup(k);
    if (el) el.classList.add('sim-active-t');
    const lbl = document.getElementById(`lbl-${k}`);
    if (lbl) lbl.classList.add('sim-active-lbl');
    const pillLbl = document.getElementById(`pill-lbl-${k}`);
    if (pillLbl) pillLbl.classList.add('sim-active-lbl');
  });

  // Motion: a token slides along each newly-taken edge, then the arrival
  // state pulses (verdict-colored on the final step). Only on a single
  // forward step — scrubbing and jumps update instantly.
  if (!simMotionOk()) return;
  const tone = step.final === 'reject' ? 'rej' : step.final === 'accept' ? 'acc' : '';
  const pulseAll = () => hl.forEach(id => pulseSimState(id, tone));
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
  dot.setAttribute('r', 5);
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

export function pulseSimState(id, tone = '') {
  const grp = App.domCache.states.get(id) || document.querySelector(`[data-id="${id}"]`);
  const c = grp && grp.querySelector('circle.bd');
  if (!c) return;
  const ring = makeSVG('circle');
  ring.setAttribute('cx', c.getAttribute('cx'));
  ring.setAttribute('cy', c.getAttribute('cy'));
  ring.setAttribute('r', R);
  ring.classList.add('sim-pulse');
  if (tone) ring.classList.add(tone);
  grp.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove());
  setTimeout(() => ring.remove(), 900); // safety net if animations are disabled
}

// ── Scrubber / transport ──
export function updateSimScrubber() {
  const row = $('sim-scrubber-row'), scrubber = $('sim-scrubber'), counter = $('sim-step-counter');
  if (!row || !scrubber || !counter) return;
  const total = App.simSteps.length;
  row.style.display = total > 1 ? 'flex' : 'none';
  if (document.activeElement !== scrubber) {
    scrubber.max = String(Math.max(0, total - 1));
    scrubber.value = String(App.simIdx);
  }
  counter.textContent = `${total ? App.simIdx + 1 : 0} / ${total}`;
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
  if (App.simIdx >= App.simSteps.length - 1) return false;
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
  if (!App.autoTimer) return;
  clearInterval(App.autoTimer); App.autoTimer = null;
}

export function stepFwd(stopAuto = true) {
  if (stopAuto) stopAutoPlay();
  if (App.simIdx < App.simSteps.length - 1) { App.simIdx++; renderSimStep(); }
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
  App.simIdx = App.simSteps.length - 1; renderSimStep();
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
    if (App.simIdx >= App.simSteps.length - 1) { stopAutoPlay(); return; }
    stepFwd(false);
  }, App.config.autoSpeed);
}
export function resetSim() {
  stopAutoPlay();
  App.simSteps = []; App.simIdx = 0; App.currentTokens = null; App.simInput = null;
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  resetTracker($('sim-tracker')); $('sim-tracker').style.display = 'none';
  const verdict = $('sim-verdict'); if (verdict) verdict.style.display = 'none';
  const scrubRow = $('sim-scrubber-row'); if (scrubRow) scrubRow.style.display = 'none';
  clearSimCanvasHighlights();
  App._simRenderRun = null; App._simRenderIdx = -1;
  setRunBtnState('idle');
}
export function toggleAuto() {
  if (App.autoTimer) { stopAutoPlay(); setRunBtnState('idle'); return; }
  App.autoTimer = setInterval(() => {
    if (App.simIdx >= App.simSteps.length - 1) { stopAutoPlay(); return; }
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
// Optional trailing "=> accept" / "=> reject" (also: acc/rej, ✓/✗, a/r)
// turns a batch line into a pass/fail expectation instead of a plain probe.
export function parseBatchLine(line) {
  const m = line.match(/^(.*?)(?:=>|→)\s*(accept|reject|acc|rej|✓|✗|a|r)\s*$/i);
  if (!m) return { input: line, expect: null };
  const tag = m[2].toLowerCase();
  const expect = (tag === 'accept' || tag === 'acc' || tag === '✓' || tag === 'a') ? 'accept' : 'reject';
  return { input: m[1].trim(), expect };
}

// Running a batch and showing one are separate jobs. They used to be one
// function that ended in an innerHTML assignment, which meant the results
// only ever existed as markup — nothing could export them, and the pass/fail
// logic could not be tested without a DOM. computeBatchResults() is now the
// whole decision procedure and returns data; renderBatchResults() is the
// only part that touches the page.
//
// It is also machine-agnostic. Both halves of a row — how the line is read
// and what the machine answers — come from the registry, so the eighteen
// branches this used to carry are down to one question the caller is
// entitled to ask: is a transducer allowed to have a verdict at all?
export function computeBatchResults(rawLines) {
  const m = App.machine;
  // Whether a transducer decides anything is App.config.transducerAccepts,
  // and that is the *caller's* policy: the machine always answers, and this
  // is where the answer is dropped when the setting is off. `undefined`
  // means "no verdict was asked for", which renderBatchResults draws as a
  // bullet rather than as a tick or a cross.
  const transducer = !!getMachineConfig(m).isTransducer;

  const results = rawLines.map(parseBatchLine).map(({ input: line, expect }) => {
    const parsed = parseMachineInput(m, parseEps(line));
    if (!parsed.ok) return { str: line, accepted: false, error: true, expect };

    const { verdict, output } = decideMachine(m, parsed.input);
    // A run still going at the budget has not rejected, and reporting it as
    // one would be a false negative — the mistake that makes undecidability
    // invisible. Turing machines and an unhalted two-way head both land here.
    const undecided = verdict === 'unk';
    const accepted = undecided ? false
      : transducer ? (App.config.transducerAccepts ? verdict === 'acc' : undefined)
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
  });

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

export function runBatch() {
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
  const batch = computeBatchResults(rawLines);
  // Held so the export actions report exactly what is on screen rather than
  // silently re-running the machine against an edited textarea.
  App.lastBatch = batch;
  renderBatchResults(batch);
}


