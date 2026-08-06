import { makeSVG } from './render.js';
import { $, App, R, getMachineConfig } from './state.js';
import { getState } from './states-transitions.js';
import { dismissSymSuggest, trySymSuggestKeydown } from './suggest.js';
import { buildMarkedInputTape, isAnyPDA, isAnyTM, isQueueAutomaton, isTwoStackPDA, parseEps, pickMostSpecificTransition } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  SIMULATION
// ══════════════════════════════════════════════════════════════════
export function tokenize(str, sigma = App.sigma) {
  if (str === '' || !str) return [];
  const syms = [...sigma].filter(s => s !== App.config.sym.eps).sort((a, b) => b.length - a.length);
  function bt(segment) {
    function rec(pos) {
      if (pos === segment.length) return [];
      for (const s of syms) {
        if (segment.startsWith(s, pos)) {
          const rest = rec(pos + s.length);
          if (rest !== null) return [s, ...rest];
        }
      }
      return null;
    }
    return rec(0);
  }
  // Symbols are allowed to be whole words (e.g. "officerOpensReview"), so a
  // human-typed test string will naturally separate them with commas/whitespace
  // — the same delimiters used when symbols are added to Σ. Split on those first,
  // falling back to plain concatenation (undelimited backtracking) per segment
  // so single-character alphabets like {0,1} keep working exactly as before.
  const segments = str.split(/[,\s]+/).filter(seg => seg.length > 0);
  if (segments.length === 0) return [];
  const tokens = [];
  for (const segment of segments) {
    const t = bt(segment);
    if (t === null) return null;
    tokens.push(...t);
  }
  return tokens;
}

export function canApplyPdaPop(top, pop) {
  const eps = App.config.sym.eps;
  if (pop === eps) return true;
  return top !== undefined && (pop === top || pop === App.config.sym.any);
}

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

  // MTM: support optional comma-separated per-tape initialization
  if (App.machine === 'MTM' && raw.includes(',')) {
    const parts = raw.split(',');
    if (parts.length !== App.tapeCount) {
      log(`<span class="t-err">MTM: found ${parts.length} comma-separated segment(s) but machine has ${App.tapeCount} tape(s). Provide one value per tape.</span>`);
      return;
    }
    const tapeTokens = [];
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi].trim();
      const tok = tokenize(p === App.config.sym.eps ? '' : p);
      if (tok === null) { log(`<span class="t-err">Tape ${pi + 1}: cannot tokenize "${p}" using alphabet {${[...App.sigma].join(', ')}}.</span>`); return; }
      tapeTokens.push(tok);
    }
    simMTM(tapeTokens[0], tapeTokens);
    toggleAuto(); // Unified "play" experience
    return;
  }

  const str = raw === App.config.sym.eps ? '' : raw;
  const tokens = tokenize(str);
  if (tokens === null) { log(`<span class="t-err">Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</span>`); return; }
  App.currentTokens = tokens; // Save tokens for highlighting
  if (App.machine === 'DFA') simDFA(tokens);
  else if (App.machine === 'NFA' || App.machine === 'ε-NFA') simNFA(tokens);
  else if (App.machine === 'DPDA' || App.machine === 'PDA') simPDA(tokens);
  else if (App.machine === 'NPDA' || App.machine === 'QA' || App.machine === 'Counter' || App.machine === '2PDA') simNPDA(tokens);
  else if (App.machine === '2DFA') sim2DFA(tokens);
  else if (App.machine === '2NFA') sim2NFA(tokens);
  else if (App.machine === 'Moore') simMoore(tokens);
  else if (App.machine === 'Mealy') simMealy(tokens);
  else if (App.machine === 'FST') simFST(tokens);
  else if (App.machine === 'NDTM') simNDTM(tokens);
  else if (App.machine === 'MTM') simMTM(tokens);
  else if (App.machine === 'LBA') simLBA(tokens);
  else if (App.machine === 'ITM') simITM(tokens);
  else simTM(tokens);

  // Unified playback: automatically start the animation if it loaded correctly
  if (App.simSteps && App.simSteps.length > 0) {
    toggleAuto();
  }
}
export function log(html) { const t = $('trace-log'); t.innerHTML = html; t.scrollTop = t.scrollHeight; }

export function simDFA(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  App.simSteps.push({ state: cur, tokens, remaining: tokens, note: `Start: ${getState(cur)?.name || '?'}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) { App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i), note: `No δ(${getState(cur)?.name},'${sym}') — Implicit REJECT`, final: 'reject' }); break; }
    cur = t.to;
    App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i + 1), note: `Read '${sym}' → ${getState(cur)?.name}`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

export function simNFA(tokens) {
  App.simSteps = [];
  let cur = epsClosure(new Set([App.startId]));
  App.simSteps.push({ states: [...cur], tokens, remaining: tokens, note: `Start ε-closure: {${stateNames(cur)}}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i]; let nx = new Set();
    cur.forEach(sid => App.transitions.filter(t => t.from === sid && (t.symbol === sym || t.symbol === App.config.sym.any)).forEach(t => nx.add(t.to)));
    nx = epsClosure(nx);
    cur = nx;
    App.simSteps.push({ states: [...cur], tokens, remaining: tokens.slice(i + 1), note: `Read '${sym}' → {${stateNames(cur) || '∅'}}` });
    if (!cur.size) break;
  }
  const last = App.simSteps[App.simSteps.length - 1];
  const acc = [...cur].some(id => App.accepts.has(id));
  if (!last.final) { last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

export function epsClosure(states) {
  const c = new Set(states), stk = [...states];
  const eps = App.config.sym.eps;
  while (stk.length) { const s = stk.pop(); App.transitions.filter(t => t.from === s && t.symbol === eps).forEach(t => { if (!c.has(t.to)) { c.add(t.to); stk.push(t.to); } }); }
  return c;
}
export function stateNames(ids) { return [...ids].map(id => getState(id)?.name || id).join(',') }

export function getSingleTapeDeterministicTransition(state, sym) {
  const matching = App.transitions.filter(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
  return pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
}

export function getMultiTapeDeterministicTransition(state, syms) {
  const matching = App.transitions.filter(tr => tr.from === state && tr.tapeSyms && tr.tapeSyms.length === syms.length && tr.tapeSyms.every((s, i) => s === syms[i] || s === App.config.sym.any));
  return pickMostSpecificTransition(matching, tr => tr.tapeSyms.reduce((score, s, i) => score + (s === syms[i] ? 1 : 0), 0));
}

export function legacySimPDA_unused(tokens) {
  App.simSteps = [];
  const isExplicit = App.config.pdaParadigm === 'explicit';
  const init = { state: App.startId, tokens, remaining: tokens, stack: isExplicit ? [App.config.sym.stackBottom] : [], note: 'Start configuration' };
  App.simSteps.push(init);
  let cfgs = [init];
  const visited = new Set(); // Track visited configurations to avoid ε-loops (#8)
  visited.add(init.state + '|' + init.remaining.join('') + '|' + init.stack.join(''));
  for (let step = 0; step < App.config.maxPdaSteps && cfgs.length; step++) {
    const next = [];
    cfgs.forEach(cfg => {
      const { state, remaining, stack } = cfg, top = stack[stack.length - 1];
      const eps = App.config.sym.eps;
      App.transitions.filter(t => t.from === state).forEach(t => {
        const rOk = t.symbol === eps || (remaining.length > 0 && (t.symbol === remaining[0] || t.symbol === App.config.sym.any));
        const pOk = canApplyPdaPop(top, t.pop);
        if (!rOk || !pOk) return;
        const ns = [...stack]; 
        if (t.pop !== eps) ns.pop();
        let pushStr = t.push && t.push !== eps ? t.push : '';
        if (pushStr === App.config.sym.any) pushStr = top; // Write-back popped symbol if wildcard
        if (pushStr) pushStr.split('').reverse().forEach(c => ns.push(c));
        const nr = t.symbol === eps ? remaining : remaining.slice(1);
        const cfgKey = t.to + '|' + nr.join('') + '|' + ns.join('');
        if (visited.has(cfgKey)) return; // Skip already-visited configurations
        visited.add(cfgKey);
        const nc = { state: t.to, tokens, remaining: nr, stack: ns, note: `(${getState(state)?.name},${t.symbol || eps},${top || eps})→(${getState(t.to)?.name},${t.push || eps})` };
        next.push(nc); App.simSteps.push(nc);
      });
    });
    cfgs = next;
  }
  const acc = isExplicit
    ? App.simSteps.some(c => App.accepts.has(c.state) && c.remaining.length === 0)
    : App.simSteps.some(c => c.remaining.length === 0 && c.stack.length === 0);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) {
    if (!acc && cfgs.length > 0) {
      last.final = 'reject'; last.note += ' — STEP LIMIT REACHED — REJECT';
    } else {
      last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`;
    }
  }
  App.simIdx = 0; renderSimStep();
}

export function simTM(tokens) {
  App.simSteps = [];
  let tape = tokens.length ? [...tokens] : [], head = 0, state = App.startId;
  const blank = App.config.sym.blank;
  let via = null;
  const loop = makeLoopTracker();
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    while (tape.length <= head) tape.push(blank);
    const sym = tape[head];
    App.simSteps.push({ state, tokens, tape: [...tape], head, tid: via, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const at = loop.seenAt(ndtmConfigKey(state, tape, head), App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    tape[head] = writeSym; state = t.to; via = t.id;
    const move = t.dir === 'R' ? 1 : (t.dir === 'L' ? -1 : 0);
    head += move; if (head < 0) head = 0;
  }
  const lastTM = App.simSteps[App.simSteps.length - 1];
  // Still running is not the same as rejecting — reporting a timeout as a
  // REJECT is what makes non-halting invisible. See testTM3.
  if (lastTM && !lastTM.final) {
    lastTM.final = 'timeout'; lastTM.limit = App.config.maxTmSteps;
    lastTM.note += ` — NO VERDICT: still running after ${App.config.maxTmSteps} steps`;
  }
  App.simIdx = 0; renderSimStep();
}

export function normalizeTapeConfig(tape, head) {
  const blank = App.config.sym.blank;
  const normalizedHead = Math.max(0, head);
  const normalizedTape = tape.length ? [...tape] : [blank];
  while (normalizedTape.length <= normalizedHead) normalizedTape.push(blank);
  while (normalizedTape.length > normalizedHead + 1 && normalizedTape[normalizedTape.length - 1] === blank) normalizedTape.pop();
  return { tape: normalizedTape, head: normalizedHead };
}

export function ndtmConfigKey(state, tape, head) {
  const normalized = normalizeTapeConfig(tape, head);
  return `${state}|${normalized.head}|${normalized.tape.join('\u0001')}`;
}

// ── loop detection for the deterministic tape machines ────────────
// A deterministic machine that revisits a configuration will revisit it
// forever, so playback can stop there and report a *proven* non-halt
// instead of grinding out the step limit and calling it a reject. The
// tracker is capped: a machine whose tape grows without bound never
// repeats anyway, and its keys would grow with it.
export const LOOP_TRACK_MAX = 5000;

export function makeLoopTracker() {
  let seen = new Map();
  return {
    // Step index where this configuration was first seen, or -1 if new.
    seenAt(key, idx) {
      if (!seen) return -1;
      if (seen.has(key)) return seen.get(key);
      seen.set(key, idx);
      if (seen.size > LOOP_TRACK_MAX) seen = null; // bail out rather than grow
      return -1;
    }
  };
}

export function markLoopStep(step, firstIdx) {
  step.final = 'loop';
  step.loopFrom = firstIdx;
  step.note += ` — LOOP: repeats step ${firstIdx}, so this machine never halts on this input`;
}

export function formatTapeInstantaneousDescription(state, tape, head) {
  const normalized = normalizeTapeConfig(tape, head);
  const stateName = getState(state)?.name || state;
  return `${normalized.tape.slice(0, normalized.head).join('')}[${stateName}]${normalized.tape.slice(normalized.head).join('')}`;
}

export function simNDTM(tokens) {
  App.simSteps = [];
  const blank = App.config.sym.blank;
  const initTape = tokens.length ? [...tokens] : [blank];
  const queue = [{ state: App.startId, tape: initTape, head: 0, depth: 0, branch: 1 }];
  const visited = new Set([ndtmConfigKey(App.startId, initTape, 0)]);
  let accepted = false;
  let branches = 0;
  let maxDepth = 0;
  const log = [];
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxTmSteps) {
    const cfg = queue.shift();
    const { state, depth, branch } = cfg;
    const normalized = normalizeTapeConfig(cfg.tape, cfg.head);
    const tape = normalized.tape;
    const head = normalized.head;
    const sym = tape[head];
    const stateName = getState(state)?.name || state;
    const idStr = formatTapeInstantaneousDescription(state, tape, head);
    branches++;
    maxDepth = Math.max(maxDepth, depth);

    const step = {
      state,
      tokens,
      tape: [...tape],
      head,
      branch,
      note: `Branch ${branch} depth ${depth}: ${stateName} reads '${sym}'`
    };

    if (App.accepts.has(state)) {
      step.final = 'accept';
      step.note += ' — ACCEPT';
      App.simSteps.push(step);
      log.push(`<span class="step-acc">Branch ${branch}: ACCEPT ✓</span><span class="step-sub">State "${stateName}" is accepting.<br>Depth ${depth} · ID: ${idStr}</span>`);
      accepted = true;
      break;
    }

    const matching = App.transitions.filter(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!matching.length) {
      step.note += ' — dead branch';
      App.simSteps.push(step);
      log.push(`Branch ${branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches (${stateName}, '${sym}').<br>Depth ${depth} · ID: ${idStr}</span>`);
      continue;
    }

    step.note += matching.length > 1 ? ` — branching ×${matching.length}` : ' — deterministic step';
    App.simSteps.push(step);

    const subs = [
      `Read '${sym}' at head position ${head}.`,
      `Depth ${depth} · ID: ${idStr}`
    ];
    if (matching.length > 1) {
      subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    }
    log.push(`Branch ${branch}: exploring <em>${stateName}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach(tr => {
      const nextTape = [...tape];
      nextTape[head] = (!tr.write || tr.write === App.config.sym.any) ? sym : tr.write;
      const move = tr.dir === 'R' ? 1 : (tr.dir === 'L' ? -1 : 0);
      const nextHead = Math.max(0, head + move);
      const nextKey = ndtmConfigKey(tr.to, nextTape, nextHead);
      if (visited.has(nextKey)) return;
      visited.add(nextKey);
      queue.push({ state: tr.to, tape: nextTape, head: nextHead, depth: depth + 1, branch: nextBranchId++ });
    });
  }

  if (!accepted) {
    // An exhausted frontier is a real reject; unexplored branches are not.
    const unresolved = queue.length > 0;
    const finalNote = unresolved
      ? `NO VERDICT: exploration limit ${App.config.maxTmSteps} reached — unresolved branches remain`
      : 'All branches halted without acceptance — REJECT';
    const fallbackTape = App.simSteps.at(-1)?.tape || [...initTape];
    const fallbackHead = App.simSteps.at(-1)?.head ?? 0;
    const fallbackState = App.simSteps.at(-1)?.state || App.startId;
    App.simSteps.push({
      state: fallbackState,
      tokens,
      tape: [...fallbackTape],
      head: fallbackHead,
      note: finalNote,
      final: unresolved ? 'timeout' : 'reject',
      limit: unresolved ? App.config.maxTmSteps : undefined
    });
    log.push(`${queue.length ? 'Exploration limit reached' : 'Reject'}<span class="step-sub">${finalNote}.<br>Branches explored: ${branches} · max depth ${maxDepth}</span>`);
  }

  App.simIdx = 0;
  renderSimStep();
  return { accepted, branches, maxDepth, log };
}

export function pdaUsesQueueStorage(machine = App.machine) {
  return isQueueAutomaton(machine);
}

export function pdaUsesSecondStack(machine = App.machine) {
  return isTwoStackPDA(machine);
}

export function pdaPeek(store, queueMode = false) {
  if (!store || !store.length) return undefined;
  return queueMode ? store[0] : store[store.length - 1];
}

export function pdaStoreToString(store, queueMode = false) {
  if (!store || !store.length) return App.config.sym.eps;
  return queueMode ? store.join('') : [...store].reverse().join('');
}

export function applyPdaStoreTransition(store, pop, push, queueMode = false) {
  const eps = App.config.sym.eps;
  const nextStore = [...store];
  let popped = undefined;
  if (pop !== eps) {
    popped = queueMode ? nextStore.shift() : nextStore.pop();
  }
  let pushStr = push && push !== eps ? push : '';
  if (pushStr === App.config.sym.any) pushStr = popped || '';
  if (pushStr) {
    const chars = pushStr.split('');
    if (queueMode) chars.forEach(sym => nextStore.push(sym));
    else chars.reverse().forEach(sym => nextStore.push(sym));
  }
  return nextStore;
}

export function createInitialPdaConfig(tokens) {
  const isExplicit = App.config.pdaParadigm === 'explicit';
  const baseStore = isExplicit ? [App.config.sym.stackBottom] : [];
  const cfg = {
    state: App.startId,
    tokens,
    remaining: [...tokens],
    stack: [...baseStore],
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
  if (pdaUsesSecondStack()) cfg.stack2 = [...baseStore];
  return cfg;
}

export function pdaConfigKey(state, remaining, stack, stack2 = null) {
  const second = Array.isArray(stack2) ? `|${stack2.join('\u0001')}` : '';
  return `${state}|${remaining.join('\u0001')}|${stack.join('\u0001')}${second}`;
}

export function isPdaAcceptingConfig(cfg) {
  if (App.config.pdaParadigm === 'explicit') {
    return App.accepts.has(cfg.state) && cfg.remaining.length === 0;
  }
  if (pdaUsesSecondStack()) {
    return cfg.remaining.length === 0 && cfg.stack.length === 0 && (cfg.stack2 || []).length === 0;
  }
  return cfg.remaining.length === 0 && cfg.stack.length === 0;
}

export function formatPdaInstantaneousDescription(cfg) {
  const stateName = getState(cfg.state)?.name || cfg.state;
  const remaining = cfg.remaining.length ? cfg.remaining.join('') : App.config.sym.eps;
  const primary = pdaStoreToString(cfg.stack, pdaUsesQueueStorage());
  if (pdaUsesSecondStack()) {
    const secondary = pdaStoreToString(cfg.stack2 || []);
    return `(${stateName}, ${remaining}, ${primary}; ${secondary})`;
  }
  return `(${stateName}, ${remaining}, ${primary})`;
}

export function getMatchingPdaTransitions(cfg) {
  const eps = App.config.sym.eps;
  const queueMode = pdaUsesQueueStorage();
  const top = pdaPeek(cfg.stack, queueMode);
  const top2 = pdaUsesSecondStack() ? pdaPeek(cfg.stack2 || []) : undefined;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    const readOk = t.symbol === eps || (cfg.remaining.length > 0 && (t.symbol === cfg.remaining[0] || t.symbol === App.config.sym.any));
    const popOk = canApplyPdaPop(top, t.pop);
    const pop2Sym = t.pop2 || eps;
    const pop2Ok = !pdaUsesSecondStack() || canApplyPdaPop(top2, pop2Sym);
    return readOk && popOk && pop2Ok;
  });
}

export function applyPdaTransitionConfig(cfg, transition, branch = cfg.branch) {
  const eps = App.config.sym.eps;
  const queueMode = pdaUsesQueueStorage();
  const nextCfg = {
    state: transition.to,
    tokens: cfg.tokens,
    remaining: transition.symbol === eps ? [...cfg.remaining] : cfg.remaining.slice(1),
    stack: applyPdaStoreTransition(cfg.stack, transition.pop || eps, transition.push || eps, queueMode),
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: transition
  };
  if (pdaUsesSecondStack()) {
    nextCfg.stack2 = applyPdaStoreTransition(cfg.stack2 || [], transition.pop2 || eps, transition.push2 || eps, false);
  }
  return nextCfg;
}

export function tracePdaPath(cfg) {
  const path = [];
  let cur = cfg;
  while (cur) {
    path.push(cur);
    cur = cur.parent;
  }
  return path.reverse();
}

export function formatPdaTransitionNote(prevCfg, nextCfg) {
  const t = nextCfg.via;
  const fromName = getState(prevCfg.state)?.name || prevCfg.state;
  const toName = getState(nextCfg.state)?.name || nextCfg.state;
  const read = t?.symbol || App.config.sym.eps;
  const pop = t?.pop || App.config.sym.eps;
  const push = t?.push || App.config.sym.eps;
  const pop2 = t?.pop2 || App.config.sym.eps;
  const push2 = t?.push2 || App.config.sym.eps;
  if (pdaUsesSecondStack()) {
    return `Branch ${nextCfg.branch} depth ${nextCfg.depth}: (${fromName}, ${read}, ${pop}/${pop2}) → (${toName}, ${push}/${push2})`;
  }
  return `Branch ${nextCfg.branch} depth ${nextCfg.depth}: (${fromName}, ${read}, ${pop}) → (${toName}, ${push})`;
}

export function buildPdaPathSteps(path, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, idx) => {
    const step = {
      state: cfg.state,
      tokens: cfg.tokens,
      remaining: [...cfg.remaining],
      stack: [...cfg.stack],
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: idx === 0 ? 'Start configuration' : formatPdaTransitionNote(path[idx - 1], cfg)
    };
    if (Array.isArray(cfg.stack2)) step.stack2 = [...cfg.stack2];
    return step;
  });
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function appendPdaSummaryStep(steps, cfg, finalStatus, note) {
  const summary = {
    state: cfg.state,
    tokens: cfg.tokens,
    remaining: [...cfg.remaining],
    stack: [...cfg.stack],
    branch: cfg.branch,
    note,
    final: finalStatus
  };
  if (Array.isArray(cfg.stack2)) summary.stack2 = [...cfg.stack2];
  steps.push(summary);
}

export function simPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(init)) {
    App.simSteps = buildPdaPathSteps([init], 'accept');
    App.simIdx = 0; renderSimStep();
    return { accepted: true };
  }

  let cfg = init;
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack, cfg.stack2)]);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = getMatchingPdaTransitions(cfg);
    if (matching.length > 1) {
      App.simSteps = buildPdaPathSteps(tracePdaPath(cfg));
      appendPdaSummaryStep(
        App.simSteps,
        cfg,
        'reject',
        'Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches.'
      );
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }
    if (!matching.length) {
      App.simSteps = buildPdaPathSteps(tracePdaPath(cfg));
      appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'No valid transition from this configuration — REJECT');
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }

    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
    if (visited.has(nextKey)) {
      App.simSteps = buildPdaPathSteps(tracePdaPath(cfg));
      appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'Repeated configuration detected — possible ε-loop — REJECT');
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }
    visited.add(nextKey);
    cfg = nextCfg;

    if (isPdaAcceptingConfig(cfg)) {
      App.simSteps = buildPdaPathSteps(tracePdaPath(cfg), 'accept');
      App.simIdx = 0; renderSimStep();
      return { accepted: true };
    }
  }

  App.simSteps = buildPdaPathSteps(tracePdaPath(cfg));
  appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'PDA step limit reached — REJECT');
  App.simIdx = 0; renderSimStep();
  return { accepted: false };
}

export function exploreNPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  const queue = [init];
  const visited = new Set([pdaConfigKey(init.state, init.remaining, init.stack, init.stack2)]);
  const log = [];
  let acceptedCfg = null;
  let branches = 0;
  let maxDepth = 0;
  let lastExplored = init;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxPdaSteps) {
    const cfg = queue.shift();
    lastExplored = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);
    const stateName = getState(cfg.state)?.name || cfg.state;
    const idStr = formatPdaInstantaneousDescription(cfg);

    if (isPdaAcceptingConfig(cfg)) {
      acceptedCfg = cfg;
      log.push(`<span class="step-acc">Branch ${cfg.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${cfg.depth}.<br>ID: ${idStr}</span>`);
      break;
    }

    const matching = getMatchingPdaTransitions(cfg);
    if (!matching.length) {
      log.push(`Branch ${cfg.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${idStr}.<br>Depth ${cfg.depth}</span>`);
      continue;
    }

    const nextRead = cfg.remaining[0] || App.config.sym.eps;
    const primaryTop = pdaPeek(cfg.stack, pdaUsesQueueStorage());
    const primaryTopLabel = isQueueAutomaton() ? 'Queue front' : 'Stack top';
    const subs = [
      `State "${stateName}" with next input '${nextRead}'`,
      `Depth ${cfg.depth} · ${primaryTopLabel} ${primaryTop || App.config.sym.eps}`,
      `ID: ${idStr}`
    ];
    if (isTwoStackPDA()) {
      subs.push(`Second stack top ${pdaPeek(cfg.stack2 || []) || App.config.sym.eps}`);
    }
    if (matching.length > 1) {
      subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    }
    log.push(`Branch ${cfg.branch}: exploring <em>${stateName}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdaTransitionConfig(cfg, transition, childBranch);
      const key = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  return {
    accepted: !!acceptedCfg,
    branches,
    maxDepth,
    log,
    witnessPath: tracePdaPath(acceptedCfg || lastExplored),
    finalCfg: acceptedCfg || lastExplored,
    unresolved: !acceptedCfg && queue.length > 0
  };
}

export function simNPDA(tokens) {
  const result = exploreNPDA(tokens);
  if (result.accepted) {
    App.simSteps = buildPdaPathSteps(result.witnessPath, 'accept');
  } else {
    App.simSteps = buildPdaPathSteps(result.witnessPath);
    appendPdaSummaryStep(
      App.simSteps,
      result.finalCfg,
      'reject',
      result.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'All branches halted without acceptance — REJECT'
    );
  }
  App.simIdx = 0;
  renderSimStep();
  return {
    accepted: result.accepted,
    branches: result.branches,
    maxDepth: result.maxDepth,
    log: result.log,
    witnessLength: result.witnessPath.length
  };
}

export function simMoore(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  const s0 = getState(cur);
  const initOut = s0?.output ?? '';
  let outStr = initOut;
  let outputs = [initOut];
  App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${s0?.name} — ${App.config.sym.lambda}: '${initOut}'` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) { App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject' }); break; }
    cur = t.to;
    const sc = getState(cur);
    const out = sc?.output ?? '';
    outStr += out;
    outputs.push(out);
    App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Read '${sym}' → ${sc?.name} — ${App.config.sym.lambda}: '${out}'`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  const showAccepts = App.config.transducerAccepts;
  if (!last.final && showAccepts) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  last.note += ` | Output: "${outStr}"`;
  App.simIdx = 0; renderSimStep();
}

export function simMealy(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  let outStr = '';
  let outputs = [];
  App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${getState(cur)?.name}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) { App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject' }); break; }
    const out = t.output ?? '?';
    outStr += out;
    outputs.push(out);
    cur = t.to;
    App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Read '${sym}' → ${getState(cur)?.name} — out: '${out}'`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  const showAccepts = App.config.transducerAccepts;
  if (!last.final && showAccepts) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  if (outStr.length) last.note += ` | Output: "${outStr}"`;
  App.simIdx = 0; renderSimStep();
}

export function headMoveDelta(dir) {
  return dir === 'R' ? 1 : (dir === 'L' ? -1 : 0);
}

export function isHeadOutOfInput(tokens, head) {
  return head < 0 || head >= tokens.length;
}

export function twoWayDisplayTape(tokens) {
  return buildMarkedInputTape(tokens);
}

export function twoWayDisplayHead(tokens, head) {
  return head;
}

export function twoWayReadSymbol(tokens, head) {
  return tokens[head] ?? null;
}

export function getTwoWayMatchingTransitions(state, sym) {
  return App.transitions.filter(t => t.from === state && (t.symbol === sym || t.symbol === App.config.sym.any));
}

export function buildTwoWayPathSteps(path, tokens, finalStatus = null, finalNote = '') {
  const displayTape = twoWayDisplayTape(tokens);
  const steps = path.map((cfg, idx) => {
    const stateName = getState(cfg.state)?.name || cfg.state;
    const step = {
      state: cfg.state,
      tokens,
      tape: [...displayTape],
      head: twoWayDisplayHead(displayTape, cfg.head),
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: ''
    };
    if (idx === 0) {
      step.note = `Start: ${stateName} at ${displayTape[cfg.head]}`;
    } else {
      const prev = path[idx - 1];
      const fromName = getState(prev.state)?.name || prev.state;
      const read = twoWayReadSymbol(displayTape, prev.head);
      const readSym = read === null ? App.config.sym.eps : read;
      step.note = `Branch ${cfg.branch} depth ${cfg.depth}: ${fromName} reads '${readSym}', move ${cfg.via?.dir || 'S'} → ${stateName} (head=${cfg.head})`;
    }
    return step;
  });
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept'
      ? ` — ${finalNote || 'ACCEPT'}`
      : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function explore2DFA(tokens) {
  const tape = buildMarkedInputTape(tokens);
  const init = { state: App.startId, head: 0, depth: 0, branch: 1, parent: null, via: null };
  const path = [init];

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const cfg = path[path.length - 1];
    if (App.accepts.has(cfg.state)) {
      return {
        accepted: true,
        path,
        finalNote: `Accepted in state ${getState(cfg.state)?.name || cfg.state}`
      };
    }

    if (cfg.head < 0 || cfg.head >= tape.length) {
      return {
        accepted: false,
        path,
        finalNote: `Head moved outside endmarker bounds at index ${cfg.head}`
      };
    }

    const sym = tape[cfg.head];
    const matching = getTwoWayMatchingTransitions(cfg.state, sym);
    const t = pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
    if (!t) {
      return {
        accepted: false,
        path,
        finalNote: `No valid transition on '${sym}'`
      };
    }
    const nextHead = cfg.head + headMoveDelta(t.dir);
    if (nextHead < 0 || nextHead >= tape.length) {
      const boundSym = nextHead < 0 ? '⊢' : '⊣';
      return {
        accepted: false,
        path,
        finalNote: `Transition on '${sym}' attempted to move outside ${boundSym} bound.`
      };
    }
    path.push({
      state: t.to,
      head: nextHead,
      depth: cfg.depth + 1,
      branch: cfg.branch,
      parent: cfg,
      via: t
    });
  }

  return {
    accepted: false,
    path,
    finalNote: `2DFA step limit ${App.config.maxTmSteps} reached`
  };
}

export function sim2DFA(tokens) {
  const result = explore2DFA(tokens);
  App.simSteps = buildTwoWayPathSteps(result.path, tokens, result.accepted ? 'accept' : 'reject', result.finalNote);
  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function explore2NFA(tokens) {
  const tape = buildMarkedInputTape(tokens);
  const init = { state: App.startId, head: 0, depth: 0, branch: 1, parent: null, via: null };
  const queue = [init];
  const visited = new Set([`${init.state}|${init.head}`]);
  let acceptedCfg = null;
  let lastCfg = init;
  let branches = 0;
  let maxDepth = 0;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxTmSteps) {
    const cfg = queue.shift();
    lastCfg = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);

    if (App.accepts.has(cfg.state)) {
      acceptedCfg = cfg;
      break;
    }

    if (cfg.head < 0 || cfg.head >= tape.length) {
      continue;
    }

    const sym = tape[cfg.head];
    const matching = getTwoWayMatchingTransitions(cfg.state, sym);
    if (!matching.length) continue;

    matching.forEach((t, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextHead = cfg.head + headMoveDelta(t.dir);
      if (nextHead < 0 || nextHead >= tape.length) return;
      const nextCfg = {
        state: t.to,
        head: nextHead,
        depth: cfg.depth + 1,
        branch: childBranch,
        parent: cfg,
        via: t
      };
      const key = `${nextCfg.state}|${nextCfg.head}`;
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  const witnessCfg = acceptedCfg || lastCfg;
  return {
    accepted: !!acceptedCfg,
    witnessPath: tracePdaPath(witnessCfg),
    finalCfg: witnessCfg,
    unresolved: !acceptedCfg && queue.length > 0,
    branches,
    maxDepth
  };
}

export function sim2NFA(tokens) {
  const result = explore2NFA(tokens);
  const finalNote = result.accepted
    ? `Accepted in state ${getState(result.finalCfg.state)?.name || result.finalCfg.state}`
    : (result.unresolved
      ? `Exploration limit ${App.config.maxTmSteps} reached — unresolved branches remain`
      : 'All branches halted without acceptance');
  App.simSteps = buildTwoWayPathSteps(
    result.witnessPath,
    tokens,
    result.accepted ? 'accept' : 'reject',
    finalNote
  );
  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function fstConfigKey(state, index, outRaw) {
  return `${state}|${index}|${outRaw}`;
}

export function getMatchingFstTransitions(cfg, tokens) {
  const eps = App.config.sym.eps;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    if (t.symbol === eps) return true;
    if (cfg.index >= tokens.length) return false;
    return t.symbol === tokens[cfg.index] || t.symbol === App.config.sym.any;
  });
}

export function applyFstTransition(cfg, transition, branch) {
  const eps = App.config.sym.eps;
  const rawOut = transition.output ?? '';
  const displayOut = rawOut === '' ? App.config.sym.lambda : rawOut;
  const consumes = transition.symbol !== eps;
  return {
    state: transition.to,
    index: consumes ? cfg.index + 1 : cfg.index,
    depth: cfg.depth + 1,
    branch,
    outRaw: cfg.outRaw + rawOut,
    outToks: [...cfg.outToks, displayOut],
    parent: cfg,
    via: transition
  };
}

export function buildFstPathSteps(path, tokens, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, idx) => {
    const stateName = getState(cfg.state)?.name || cfg.state;
    const step = {
      state: cfg.state,
      tokens,
      outToks: [...cfg.outToks],
      outSoFar: cfg.outRaw,
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: ''
    };
    if (idx === 0) {
      step.note = `Start: ${stateName}`;
    } else {
      const prev = path[idx - 1];
      const fromName = getState(prev.state)?.name || prev.state;
      const read = cfg.via?.symbol || App.config.sym.eps;
      const out = cfg.via?.output !== undefined && cfg.via?.output !== '' ? cfg.via.output : App.config.sym.lambda;
      step.note = `Branch ${cfg.branch} depth ${cfg.depth}: (${fromName}, ${read}/${out}) → ${stateName}`;
    }
    return step;
  });

  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept'
      ? ` — ${finalNote || 'ACCEPT'}`
      : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function exploreFST(tokens) {
  const init = {
    state: App.startId,
    index: 0,
    depth: 0,
    branch: 1,
    outRaw: '',
    outToks: [],
    parent: null,
    via: null
  };
  const queue = [init];
  const visited = new Set([fstConfigKey(init.state, init.index, init.outRaw)]);
  const outputs = new Set();
  let acceptedCfg = null;
  let completedCfg = null;
  let lastCfg = init;
  let branches = 0;
  let maxDepth = 0;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxPdaSteps) {
    const cfg = queue.shift();
    lastCfg = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);

    if (cfg.index === tokens.length) {
      outputs.add(cfg.outRaw);
      if (!completedCfg) completedCfg = cfg;
      if (App.config.transducerAccepts && App.accepts.has(cfg.state)) {
        acceptedCfg = cfg;
        break;
      }
    }

    const matching = getMatchingFstTransitions(cfg, tokens);
    if (!matching.length) continue;

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyFstTransition(cfg, transition, childBranch);
      const key = fstConfigKey(nextCfg.state, nextCfg.index, nextCfg.outRaw);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  const witnessCfg = acceptedCfg || completedCfg || lastCfg;
  return {
    accepted: !!acceptedCfg,
    witnessPath: tracePdaPath(witnessCfg),
    finalCfg: witnessCfg,
    outputs,
    unresolved: !acceptedCfg && queue.length > 0,
    branches,
    maxDepth
  };
}

export function simFST(tokens) {
  const result = exploreFST(tokens);
  const usesAcceptance = App.config.transducerAccepts;
  const finalStatus = usesAcceptance ? (result.accepted ? 'accept' : 'reject') : null;
  const finalNote = usesAcceptance
    ? (result.accepted
      ? 'Accepting branch found'
      : (result.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'No accepting branch found'))
    : '';

  App.simSteps = buildFstPathSteps(result.witnessPath, tokens, finalStatus, finalNote);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    const outs = [...result.outputs];
    if (!outs.length) {
      last.note += ' | Output: ""';
    } else if (outs.length === 1) {
      last.note += ` | Output: "${outs[0]}"`;
    } else {
      last.note += ` | Outputs: {${outs.map(o => `"${o}"`).join(', ')}}`;
    }
  }

  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function simLBA(tokens) {
  App.simSteps = [];
  const blank = App.config.sym.blank;
  const tape = buildMarkedInputTape(tokens);
  const leftBound = 0;
  const rightBound = tape.length - 1;
  const { leftMarker, rightMarker } = App.config.sym;
  let head = 0;
  let state = App.startId;
  let via = null;
  // An LBA's tape is bounded, so its configuration space is finite and this
  // check always fires eventually — membership is genuinely decidable here.
  const loop = makeLoopTracker();

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape[head];
    App.simSteps.push({ state, tokens, tape: [...tape], head, tid: via, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) {
      App.simSteps[App.simSteps.length - 1].final = 'accept';
      App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT';
      break;
    }
    const at = loop.seenAt(`${state}|${head}|${tape.join('')}`, App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) {
      App.simSteps[App.simSteps.length - 1].final = 'reject';
      App.simSteps[App.simSteps.length - 1].note += ' — REJECT';
      break;
    }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    tape[head] = (sym === leftMarker || sym === rightMarker) ? sym : writeSym;
    const nextHead = head + headMoveDelta(t.dir);
    state = t.to; via = t.id;
    if (nextHead < leftBound || nextHead > rightBound) {
      const boundSym = nextHead < leftBound ? '⊢' : '⊣';
      App.simSteps.push({
        state,
        tokens,
        tape: [...tape],
        head,
        tid: via,
        note: `Attempted to move outside the ${boundSym} boundary. — REJECT`,
        final: 'reject'
      });
      break;
    }
    head = nextHead;
  }

  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) {
    last.final = 'timeout'; last.limit = App.config.maxTmSteps;
    last.note += ` — NO VERDICT: still running after ${App.config.maxTmSteps} steps`;
  }
  App.simIdx = 0;
  renderSimStep();
}

export function materializeInfiniteTape(tapeMap, head) {
  const blank = App.config.sym.blank;
  const keys = [...tapeMap.keys(), head];
  const min = Math.min(...keys);
  const max = Math.max(...keys);
  const tape = [];
  for (let i = min; i <= max; i++) {
    tape.push(tapeMap.has(i) ? tapeMap.get(i) : blank);
  }
  return { tape, head: head - min };
}

export function simITM(tokens) {
  App.simSteps = [];
  const blank = App.config.sym.blank;
  const tape = new Map();
  if (tokens.length) tokens.forEach((sym, i) => tape.set(i, sym));
  else tape.set(0, blank);

  let head = 0;
  let state = App.startId;
  let via = null;
  const loop = makeLoopTracker();

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape.has(head) ? tape.get(head) : blank;
    const snap = materializeInfiniteTape(tape, head);
    App.simSteps.push({
      state,
      tokens,
      tape: snap.tape,
      head: snap.head,
      tid: via,
      note: `State:${getState(state)?.name} Read:'${sym}' @${head}`
    });
    if (App.accepts.has(state)) {
      App.simSteps[App.simSteps.length - 1].final = 'accept';
      App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT';
      break;
    }
    const at = loop.seenAt(`${state}|${snap.head}|${snap.tape.join('')}`, App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) {
      App.simSteps[App.simSteps.length - 1].final = 'reject';
      App.simSteps[App.simSteps.length - 1].note += ' — REJECT';
      break;
    }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    if (writeSym === blank) tape.delete(head);
    else tape.set(head, writeSym);
    head += headMoveDelta(t.dir);
    state = t.to; via = t.id;
  }

  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) {
    last.final = 'timeout'; last.limit = App.config.maxTmSteps;
    last.note += ` — NO VERDICT: still running after ${App.config.maxTmSteps} steps`;
  }
  App.simIdx = 0;
  renderSimStep();
}

export function simMTM(tokens, allTapeTokens) {
  App.simSteps = [];
  const k = App.tapeCount;
  const blank = App.config.sym.blank;
  const tapes = allTapeTokens
    ? Array.from({ length: k }, (_, i) => { const tok = allTapeTokens[i]; return (tok && tok.length) ? [...tok] : [blank]; })
    : Array.from({ length: k }, (_, i) => i === 0 ? (tokens.length ? [...tokens] : [blank]) : [blank]);
  const heads = Array(k).fill(0);
  let state = App.startId;
  let via = null;
  const loop = makeLoopTracker();
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    tapes.forEach((tape, i) => { while (tape.length <= heads[i]) tape.push(blank); });
    const syms = tapes.map((tape, i) => tape[heads[i]]);
    App.simSteps.push({ state, tokens, tapes: tapes.map(t => [...t]), heads: [...heads], tid: via, note: `State:${getState(state)?.name} Read:[${syms.join(',')}]` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const at = loop.seenAt(`${state}|${heads.join(',')}|${tapes.map(t => t.join('')).join('')}`, App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getMultiTapeDeterministicTransition(state, syms);
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    for (let i = 0; i < k; i++) {
      tapes[i][heads[i]] = t.tapeWrites[i] || syms[i];
      const move = t.tapeDirs[i] === 'R' ? 1 : (t.tapeDirs[i] === 'L' ? -1 : 0);
      heads[i] += move;
      if (heads[i] < 0) heads[i] = 0;
    }
    state = t.to; via = t.id;
  }
  const lastMTM = App.simSteps[App.simSteps.length - 1];
  if (lastMTM && !lastMTM.final) {
    lastMTM.final = 'timeout'; lastMTM.limit = App.config.maxTmSteps;
    lastMTM.note += ` — NO VERDICT: still running after ${App.config.maxTmSteps} steps`;
  }
  App.simIdx = 0; renderSimStep();
}

export function renderSimStep() {
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
  
  let rows = [];
  const m = App.machine;
  const stateName = getState(step.state)?.name || (step.states ? stateNames(step.states) : '?');

  if (m === 'TM' || m === 'NDTM' || m === 'LBA' || m === 'ITM' || m === '2DFA' || m === '2NFA') {
    rows.push({ label: 'Tape', cells: step.tape, head: step.head });
  } else if (m === 'MTM') {
    step.tapes.forEach((t, i) => rows.push({ label: `T${i + 1}`, cells: t, head: step.heads[i] }));
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
    
    rows.push({ label: 'In', cells: tokensToDisplay, head: tokIdx });

    if (isAnyPDA(m) && step.stack) {
      if (isQueueAutomaton(m)) {
        rows.push({ label: 'Que', cells: [...step.stack], head: 0 });
      } else {
        rows.push({ label: 'Stk', cells: [...step.stack].reverse(), head: 0 });
      }
      if (isTwoStackPDA(m) && step.stack2) {
        rows.push({ label: 'Stk2', cells: [...step.stack2].reverse(), head: 0 });
      }
    } else if (['Moore', 'Mealy', 'FST'].includes(m)) {
      const outToks = step.outToks || [];
      rows.push({ label: 'Out', cells: outToks, head: outToks.length ? outToks.length - 1 : -1 });
    }
  }

  // Header
  const headerHtml = `<div class="tracker-header">
    State: <span class="tracker-val-st">${stateName}</span> &nbsp;
    ${rows.map(r => `${r.label}:<span class="tracker-val-sym">${(r.head >= 0 && r.cells && r.cells[r.head]) || '—'}</span>`).join(' &nbsp; ')}
  </div>`;

  // Row Rendering
  const rowsHtml = rows.map(r => {
    const cellsHtml = (r.cells || []).map((c, ci) => {
      const isHead = ci === r.head;
      const resClass = (isLast && step.final && isHead) ? ` ${step.final}` : '';
      return `<div class="tc ${isHead ? 'head' : ''}${resClass}" data-tip="${r.label} index ${ci}">${c}</div>`;
    }).join('');
    return `<div class="mtm-tape-row">
      <span class="tape-label">${r.label}</span>
      <span class="tape-cells">${cellsHtml}</span>
    </div>`;
  }).join('');

  trackerEl.innerHTML = headerHtml + rowsHtml;

  updateSimCanvasHighlights(step);

  updateSimScrubber();
  updateSimVerdict(step, isLast);
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
    const pt = pathEl.getPointAtLength(len * e);
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

// Clicking run-btn either starts a new simulation, or — while one is
// already playing — pauses it, mirroring standard media-control behavior.
export function handleRunBtnClick() {
  if (App.autoTimer) { stopAutoPlay(); setRunBtnState('idle'); return; }
  runSim();
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
    el.innerHTML = `<span class="sim-verdict-lbl">No verdict</span>` +
      `<span class="sim-verdict-out">still running after ${step.limit || App.config.maxTmSteps} steps — not a rejection</span>`;
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
  App.simSteps = []; App.simIdx = 0; App.currentTokens = null;
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  $('sim-tracker').innerHTML = ''; $('sim-tracker').style.display = 'none';
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
export function computeBatchResults(rawLines) {
  const results = rawLines.map(parseBatchLine).map(({ input: line, expect }) => {
    const raw = parseEps(line);
    const str = raw === App.config.sym.eps ? '' : raw;
    const tokens = tokenize(str);
    if (tokens === null) return { str: line, accepted: false, error: true, expect };
    let accepted = false, output = null, verdict = null;
    // Turing machines answer three-valued: a run still going at the budget
    // has not rejected, and reporting it as one would be a false negative.
    if (isAnyTM(App.machine)) {
      const v = testTMVerdict(tokens);
      verdict = v === 'acc' ? 'accept' : v === 'rej' ? 'reject' : 'unknown';
      accepted = v === 'acc';
    }
    else if (App.machine === 'DFA') accepted = testDFA(tokens);
    else if (App.machine === 'NFA' || App.machine === 'ε-NFA') accepted = testNFA(tokens);
    else if (App.machine === 'DPDA' || App.machine === 'PDA') accepted = testPDA(tokens);
    else if (App.machine === 'NPDA' || App.machine === 'QA' || App.machine === 'Counter' || App.machine === '2PDA') accepted = testNPDA(tokens);
    else if (App.machine === '2DFA') accepted = test2DFA(tokens);
    else if (App.machine === '2NFA') accepted = test2NFA(tokens);
    else if (App.machine === 'Moore') { accepted = App.config.transducerAccepts ? testDFA(tokens) : undefined; output = getMooreOutput(tokens); }
    else if (App.machine === 'Mealy') { accepted = App.config.transducerAccepts ? testDFA(tokens) : undefined; output = getMealyOutput(tokens); }
    else if (App.machine === 'FST') {
      const fstResult = testFST(tokens);
      accepted = App.config.transducerAccepts ? fstResult.accepted : undefined;
      output = fstResult.output;
    }
    if (verdict === null) verdict = accepted === undefined ? undefined : (accepted ? 'accept' : 'reject');
    return { str: line, accepted, output, expect, verdict };
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
export function testDFA(tokens) {
  let cur = App.startId;
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) return false;
    cur = t.to;
  }
  return App.accepts.has(cur);
}
export function testNFA(tokens) {
  let cur = epsClosure(new Set([App.startId]));
  const any = App.config.sym.any;
  for (const sym of tokens) {
    let nx = new Set();
    cur.forEach(s => App.transitions.filter(t => t.from === s && (t.symbol === sym || t.symbol === any)).forEach(t => nx.add(t.to)));
    cur = epsClosure(nx);
  }
  return [...cur].some(id => App.accepts.has(id));
}

export function legacyTestPDA_unused(tokens) {
  const isExplicit = App.config.pdaParadigm === 'explicit';
  const init = {
    state: App.startId,
    tokens,
    remaining: tokens,
    stack: isExplicit ? [App.config.sym.stackBottom] : []
  };
  const visited = new Set();
  visited.add(init.state + '|' + init.remaining.join('') + '|' + init.stack.join(''));
  let cfgs = [init];

  const isAccepted = cfg => isExplicit
    ? App.accepts.has(cfg.state) && cfg.remaining.length === 0
    : cfg.remaining.length === 0 && cfg.stack.length === 0;

  if (isAccepted(init)) return true;

  for (let step = 0; step < App.config.maxPdaSteps && cfgs.length; step++) {
    const next = [];
    cfgs.forEach(cfg => {
      const { state, remaining, stack } = cfg, top = stack[stack.length - 1];
      const eps = App.config.sym.eps;
      App.transitions.filter(t => t.from === state).forEach(t => {
        const rOk = t.symbol === eps || (remaining.length > 0 && (t.symbol === remaining[0] || t.symbol === App.config.sym.any));
        const pOk = canApplyPdaPop(top, t.pop);
        if (!rOk || !pOk) return;
        const ns = [...stack];
        if (t.pop !== eps) ns.pop();
        let pushStr = t.push && t.push !== eps ? t.push : '';
        if (pushStr === App.config.sym.any) pushStr = top;
        if (pushStr) pushStr.split('').reverse().forEach(c => ns.push(c));
        const nr = t.symbol === eps ? remaining : remaining.slice(1);
        const cfgKey = t.to + '|' + nr.join('') + '|' + ns.join('');
        if (visited.has(cfgKey)) return;
        visited.add(cfgKey);
        const nc = { state: t.to, tokens, remaining: nr, stack: ns };
        next.push(nc);
      });
    });
    if (next.some(isAccepted)) return true;
    cfgs = next;
  }

  return cfgs.some(isAccepted);
}

export function testPDA(tokens) {
  let cfg = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(cfg)) return true;
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack, cfg.stack2)]);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = getMatchingPdaTransitions(cfg);
    if (matching.length !== 1) return false;
    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
    if (visited.has(nextKey)) return false;
    visited.add(nextKey);
    cfg = nextCfg;
    if (isPdaAcceptingConfig(cfg)) return true;
  }

  return false;
}

export function testNPDA(tokens) {
  return exploreNPDA(tokens).accepted;
}

export function test2DFA(tokens) {
  return explore2DFA(tokens).accepted;
}

export function test2NFA(tokens) {
  return explore2NFA(tokens).accepted;
}

export function testFST(tokens) {
  const result = exploreFST(tokens);
  const outs = [...result.outputs];
  let output = '';
  if (outs.length > 1) output = outs.join(' | ');
  else if (outs.length === 1) output = outs[0];
  else output = result.witnessPath.at(-1)?.outRaw || '';
  return { accepted: result.accepted, output };
}

// ══════════════════════════════════════════════════════════════════
//  TURING-MACHINE MEMBERSHIP — THREE-VALUED
// ══════════════════════════════════════════════════════════════════
// A machine that has not halted inside a step budget has NOT rejected.
// Collapsing the two is the mistake that makes undecidability invisible,
// so these return 'unk' for "no verdict yet" and keep 'rej' for a real
// answer. Two situations turn a non-halt back INTO a real answer:
//
//   • a repeated configuration in a deterministic machine — it will now
//     repeat forever, so the word is provably never accepted;
//   • an exhausted search frontier in a nondeterministic one — every
//     branch halted without accepting.
//
// An LBA is decidable outright: its tape is bounded, so the
// configuration space is finite and the repeat check always fires.
export function langStepBudget() {
  return Math.max(10, App.config.langStepBudget || 400);
}

export function testTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const blank = App.config.sym.blank, any = App.config.sym.any;
  const tape = tokens.length ? [...tokens] : [];
  let head = 0, state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    while (tape.length <= head) tape.push(blank);
    if (App.accepts.has(state)) return 'acc';
    const key = ndtmConfigKey(state, tape, head);
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape[head];
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    tape[head] = (!t.write || t.write === any) ? sym : t.write;
    head += headMoveDelta(t.dir);
    if (head < 0) head = 0;
    state = t.to;
  }
  return 'unk';
}

export function testLBA3(tokens, budget) {
  budget = budget || langStepBudget();
  const any = App.config.sym.any;
  const { leftMarker, rightMarker } = App.config.sym;
  const tape = buildMarkedInputTape(tokens);
  const rightBound = tape.length - 1;
  let head = 0, state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const key = `${state}|${head}|${tape.join('')}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape[head];
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    const writeSym = (!t.write || t.write === any) ? sym : t.write;
    tape[head] = (sym === leftMarker || sym === rightMarker) ? sym : writeSym;
    const nextHead = head + headMoveDelta(t.dir);
    state = t.to;
    if (nextHead < 0 || nextHead > rightBound) return 'rej';
    head = nextHead;
  }
  return 'unk';
}

export function testITM3(tokens, budget) {
  budget = budget || langStepBudget();
  const blank = App.config.sym.blank, any = App.config.sym.any;
  const tape = new Map();
  tokens.forEach((sym, i) => tape.set(i, sym));
  let head = 0, state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const snap = materializeInfiniteTape(tape, head);
    const key = `${state}|${snap.head}|${snap.tape.join('')}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape.has(head) ? tape.get(head) : blank;
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    const writeSym = (!t.write || t.write === any) ? sym : t.write;
    if (writeSym === blank) tape.delete(head); else tape.set(head, writeSym);
    head += headMoveDelta(t.dir);
    state = t.to;
  }
  return 'unk';
}

export function testMTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const k = App.tapeCount || 2, blank = App.config.sym.blank;
  const tapes = Array.from({ length: k }, (_, i) =>
    i === 0 ? (tokens.length ? [...tokens] : [blank]) : [blank]);
  const heads = Array(k).fill(0);
  let state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    tapes.forEach((tape, i) => { while (tape.length <= heads[i]) tape.push(blank); });
    if (App.accepts.has(state)) return 'acc';
    const key = `${state}|${heads.join(',')}|${tapes.map(t => t.join('')).join('')}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const syms = tapes.map((tape, i) => tape[heads[i]]);
    const t = getMultiTapeDeterministicTransition(state, syms);
    if (!t) return 'rej';
    for (let i = 0; i < k; i++) {
      tapes[i][heads[i]] = t.tapeWrites[i] || syms[i];
      heads[i] += headMoveDelta(t.tapeDirs[i]);
      if (heads[i] < 0) heads[i] = 0;
    }
    state = t.to;
  }
  return 'unk';
}

export function testNDTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const blank = App.config.sym.blank, any = App.config.sym.any;
  const init = tokens.length ? [...tokens] : [blank];
  const queue = [{ state: App.startId, tape: init, head: 0 }];
  const visited = new Set([ndtmConfigKey(App.startId, init, 0)]);
  let expanded = 0;
  while (queue.length) {
    if (expanded++ >= budget) return 'unk';
    const cfg = queue.shift();
    if (App.accepts.has(cfg.state)) return 'acc';
    const norm = normalizeTapeConfig(cfg.tape, cfg.head);
    const tape = norm.tape, head = norm.head, sym = tape[head];
    const matching = App.transitions.filter(tr =>
      tr.from === cfg.state && (tr.symbol === sym || tr.symbol === any));
    for (const tr of matching) {
      const next = [...tape];
      next[head] = (!tr.write || tr.write === any) ? sym : tr.write;
      const nh = Math.max(0, head + headMoveDelta(tr.dir));
      const key = ndtmConfigKey(tr.to, next, nh);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ state: tr.to, tape: next, head: nh });
    }
  }
  // Frontier exhausted with nothing accepting — a definitive answer.
  return 'rej';
}

export function testTMVerdict(tokens, budget) {
  switch (App.machine) {
    case 'NDTM': return testNDTM3(tokens, budget);
    case 'MTM': return testMTM3(tokens, budget);
    case 'LBA': return testLBA3(tokens, budget);
    case 'ITM': return testITM3(tokens, budget);
    default: return testTM3(tokens, budget);
  }
}

export function getMooreOutput(tokens) {
  let cur = App.startId;
  const outputs = [getState(cur)?.output ?? ''];
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) break;
    cur = t.to;
    outputs.push(getState(cur)?.output ?? '');
  }
  return outputs.join('');
}
export function getMealyOutput(tokens) {
  let cur = App.startId;
  const outputs = [];
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) break;
    outputs.push(t.output ?? '?');
    cur = t.to;
  }
  return outputs.join('');
}

