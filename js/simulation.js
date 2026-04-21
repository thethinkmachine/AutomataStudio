// ══════════════════════════════════════════════════════════════════
//  SIMULATION
// ══════════════════════════════════════════════════════════════════
function tokenize(str, sigma = App.sigma) {
  if (str === '' || !str) return [];
  const syms = [...sigma].filter(s => s !== App.config.sym.eps).sort((a, b) => b.length - a.length);
  function bt(pos) {
    if (pos === str.length) return [];
    for (const s of syms) {
      if (str.startsWith(s, pos)) {
        const rest = bt(pos + s.length);
        if (rest !== null) return [s, ...rest];
      }
    }
    return null;
  }
  return bt(0);
}

function canApplyPdaPop(top, pop) {
  const eps = App.config.sym.eps;
  if (pop === eps) return true;
  return top !== undefined && (pop === top || pop === App.config.sym.any);
}

function runSim() {
  resetSim();
  let raw = parseEps($('sim-in').value);
  if (raw === App.config.sym.eps) $('sim-in').value = raw;
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
function log(html) { const t = $('trace-log'); t.innerHTML = html; t.scrollTop = t.scrollHeight; }

function simDFA(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  App.simSteps.push({ state: cur, tokens, remaining: tokens, note: `Start: ${getState(cur)?.name || '?'}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!t) { App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i), note: `No δ(${getState(cur)?.name},'${sym}') — Implicit REJECT`, final: 'reject' }); break; }
    cur = t.to;
    App.simSteps.push({ state: cur, tokens, remaining: tokens.slice(i + 1), note: `Read '${sym}' → ${getState(cur)?.name}`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

function simNFA(tokens) {
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

function epsClosure(states) {
  const c = new Set(states), stk = [...states];
  const eps = App.config.sym.eps;
  while (stk.length) { const s = stk.pop(); App.transitions.filter(t => t.from === s && t.symbol === eps).forEach(t => { if (!c.has(t.to)) { c.add(t.to); stk.push(t.to); } }); }
  return c;
}
function stateNames(ids) { return [...ids].map(id => getState(id)?.name || id).join(',') }

function legacySimPDA_unused(tokens) {
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

function simTM(tokens) {
  App.simSteps = [];
  let tape = tokens.length ? [...tokens] : [], head = 0, state = App.startId;
  const blank = App.config.sym.blank;
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    while (tape.length <= head) tape.push(blank);
    const sym = tape[head];
    App.simSteps.push({ state, tokens, tape: [...tape], head, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const t = App.transitions.find(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    tape[head] = writeSym; state = t.to;
    const move = t.dir === 'R' ? 1 : (t.dir === 'L' ? -1 : 0);
    head += move; if (head < 0) head = 0;
  }
  const lastTM = App.simSteps[App.simSteps.length - 1];
  if (lastTM && !lastTM.final) { lastTM.final = 'reject'; lastTM.note += ' — STEP LIMIT REACHED (possible loop) — REJECT'; }
  App.simIdx = 0; renderSimStep();
}

function normalizeTapeConfig(tape, head) {
  const blank = App.config.sym.blank;
  const normalizedHead = Math.max(0, head);
  const normalizedTape = tape.length ? [...tape] : [blank];
  while (normalizedTape.length <= normalizedHead) normalizedTape.push(blank);
  while (normalizedTape.length > normalizedHead + 1 && normalizedTape[normalizedTape.length - 1] === blank) normalizedTape.pop();
  return { tape: normalizedTape, head: normalizedHead };
}

function ndtmConfigKey(state, tape, head) {
  const normalized = normalizeTapeConfig(tape, head);
  return `${state}|${normalized.head}|${normalized.tape.join('\u0001')}`;
}

function formatTapeInstantaneousDescription(state, tape, head) {
  const normalized = normalizeTapeConfig(tape, head);
  const stateName = getState(state)?.name || state;
  return `${normalized.tape.slice(0, normalized.head).join('')}[${stateName}]${normalized.tape.slice(normalized.head).join('')}`;
}

function simNDTM(tokens) {
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
    const finalNote = queue.length
      ? `Exploration limit ${App.config.maxTmSteps} reached — unresolved branches remain`
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
      final: 'reject'
    });
    log.push(`${queue.length ? 'Exploration limit reached' : 'Reject'}<span class="step-sub">${finalNote}.<br>Branches explored: ${branches} · max depth ${maxDepth}</span>`);
  }

  App.simIdx = 0;
  renderSimStep();
  return { accepted, branches, maxDepth, log };
}

function pdaUsesQueueStorage(machine = App.machine) {
  return isQueueAutomaton(machine);
}

function pdaUsesSecondStack(machine = App.machine) {
  return isTwoStackPDA(machine);
}

function pdaPeek(store, queueMode = false) {
  if (!store || !store.length) return undefined;
  return queueMode ? store[0] : store[store.length - 1];
}

function pdaStoreToString(store, queueMode = false) {
  if (!store || !store.length) return App.config.sym.eps;
  return queueMode ? store.join('') : [...store].reverse().join('');
}

function applyPdaStoreTransition(store, pop, push, queueMode = false) {
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

function createInitialPdaConfig(tokens) {
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

function pdaConfigKey(state, remaining, stack, stack2 = null) {
  const second = Array.isArray(stack2) ? `|${stack2.join('\u0001')}` : '';
  return `${state}|${remaining.join('\u0001')}|${stack.join('\u0001')}${second}`;
}

function isPdaAcceptingConfig(cfg) {
  if (App.config.pdaParadigm === 'explicit') {
    return App.accepts.has(cfg.state) && cfg.remaining.length === 0;
  }
  if (pdaUsesSecondStack()) {
    return cfg.remaining.length === 0 && cfg.stack.length === 0 && (cfg.stack2 || []).length === 0;
  }
  return cfg.remaining.length === 0 && cfg.stack.length === 0;
}

function formatPdaInstantaneousDescription(cfg) {
  const stateName = getState(cfg.state)?.name || cfg.state;
  const remaining = cfg.remaining.length ? cfg.remaining.join('') : App.config.sym.eps;
  const primary = pdaStoreToString(cfg.stack, pdaUsesQueueStorage());
  if (pdaUsesSecondStack()) {
    const secondary = pdaStoreToString(cfg.stack2 || []);
    return `(${stateName}, ${remaining}, ${primary}; ${secondary})`;
  }
  return `(${stateName}, ${remaining}, ${primary})`;
}

function getMatchingPdaTransitions(cfg) {
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

function applyPdaTransitionConfig(cfg, transition, branch = cfg.branch) {
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

function tracePdaPath(cfg) {
  const path = [];
  let cur = cfg;
  while (cur) {
    path.push(cur);
    cur = cur.parent;
  }
  return path.reverse();
}

function formatPdaTransitionNote(prevCfg, nextCfg) {
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

function buildPdaPathSteps(path, finalStatus = null, finalNote = '') {
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

function appendPdaSummaryStep(steps, cfg, finalStatus, note) {
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

function simPDA(tokens) {
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

function exploreNPDA(tokens) {
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

function simNPDA(tokens) {
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

function simMoore(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  const s0 = getState(cur);
  const initOut = s0?.output ?? '';
  let outStr = initOut;
  let outputs = [initOut];
  App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${s0?.name} — ${App.config.sym.lambda}: '${initOut}'` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === App.config.sym.any));
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

function simMealy(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  let outStr = '';
  let outputs = [];
  App.simSteps.push({ state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${getState(cur)?.name}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === App.config.sym.any));
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

function headMoveDelta(dir) {
  return dir === 'R' ? 1 : (dir === 'L' ? -1 : 0);
}

function isHeadOutOfInput(tokens, head) {
  return head < 0 || head >= tokens.length;
}

function twoWayDisplayTape(tokens) {
  return buildMarkedInputTape(tokens);
}

function twoWayDisplayHead(tokens, head) {
  return head;
}

function twoWayReadSymbol(tokens, head) {
  return tokens[head] ?? null;
}

function getTwoWayMatchingTransitions(state, sym) {
  return App.transitions.filter(t => t.from === state && (t.symbol === sym || t.symbol === App.config.sym.any));
}

function buildTwoWayPathSteps(path, tokens, finalStatus = null, finalNote = '') {
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

function explore2DFA(tokens) {
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
    if (!matching.length) {
      return {
        accepted: false,
        path,
        finalNote: `No valid transition on '${sym}'`
      };
    }
    if (matching.length > 1) {
      return {
        accepted: false,
        path,
        finalNote: 'Nondeterministic overlap detected in 2DFA mode. Switch to 2NFA to explore branching.'
      };
    }

    const t = matching[0];
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

function sim2DFA(tokens) {
  const result = explore2DFA(tokens);
  App.simSteps = buildTwoWayPathSteps(result.path, tokens, result.accepted ? 'accept' : 'reject', result.finalNote);
  App.simIdx = 0;
  renderSimStep();
  return result;
}

function explore2NFA(tokens) {
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

function sim2NFA(tokens) {
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

function fstConfigKey(state, index, outRaw) {
  return `${state}|${index}|${outRaw}`;
}

function getMatchingFstTransitions(cfg, tokens) {
  const eps = App.config.sym.eps;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    if (t.symbol === eps) return true;
    if (cfg.index >= tokens.length) return false;
    return t.symbol === tokens[cfg.index] || t.symbol === App.config.sym.any;
  });
}

function applyFstTransition(cfg, transition, branch) {
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

function buildFstPathSteps(path, tokens, finalStatus = null, finalNote = '') {
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

function exploreFST(tokens) {
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

function simFST(tokens) {
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

function simLBA(tokens) {
  App.simSteps = [];
  const blank = App.config.sym.blank;
  const tape = buildMarkedInputTape(tokens);
  const leftBound = 0;
  const rightBound = tape.length - 1;
  const { leftMarker, rightMarker } = App.config.sym;
  let head = 0;
  let state = App.startId;

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape[head];
    App.simSteps.push({ state, tokens, tape: [...tape], head, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) {
      App.simSteps[App.simSteps.length - 1].final = 'accept';
      App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT';
      break;
    }
    const t = App.transitions.find(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!t) {
      App.simSteps[App.simSteps.length - 1].final = 'reject';
      App.simSteps[App.simSteps.length - 1].note += ' — REJECT';
      break;
    }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    tape[head] = (sym === leftMarker || sym === rightMarker) ? sym : writeSym;
    const nextHead = head + headMoveDelta(t.dir);
    state = t.to;
    if (nextHead < leftBound || nextHead > rightBound) {
      const boundSym = nextHead < leftBound ? '⊢' : '⊣';
      App.simSteps.push({
        state,
        tokens,
        tape: [...tape],
        head,
        note: `Attempted to move outside ${boundSym} bound. — REJECT`,
        final: 'reject'
      });
      break;
    }
    head = nextHead;
  }

  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) {
    last.final = 'reject';
    last.note += ' — STEP LIMIT REACHED (possible loop) — REJECT';
  }
  App.simIdx = 0;
  renderSimStep();
}

function materializeInfiniteTape(tapeMap, head) {
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

function simITM(tokens) {
  App.simSteps = [];
  const blank = App.config.sym.blank;
  const tape = new Map();
  if (tokens.length) tokens.forEach((sym, i) => tape.set(i, sym));
  else tape.set(0, blank);

  let head = 0;
  let state = App.startId;

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape.has(head) ? tape.get(head) : blank;
    const snap = materializeInfiniteTape(tape, head);
    App.simSteps.push({
      state,
      tokens,
      tape: snap.tape,
      head: snap.head,
      note: `State:${getState(state)?.name} Read:'${sym}' @${head}`
    });
    if (App.accepts.has(state)) {
      App.simSteps[App.simSteps.length - 1].final = 'accept';
      App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT';
      break;
    }
    const t = App.transitions.find(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!t) {
      App.simSteps[App.simSteps.length - 1].final = 'reject';
      App.simSteps[App.simSteps.length - 1].note += ' — REJECT';
      break;
    }
    const writeSym = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    if (writeSym === blank) tape.delete(head);
    else tape.set(head, writeSym);
    head += headMoveDelta(t.dir);
    state = t.to;
  }

  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) {
    last.final = 'reject';
    last.note += ' — STEP LIMIT REACHED (possible loop) — REJECT';
  }
  App.simIdx = 0;
  renderSimStep();
}

function simMTM(tokens, allTapeTokens) {
  App.simSteps = [];
  const k = App.tapeCount;
  const blank = App.config.sym.blank;
  const tapes = allTapeTokens
    ? Array.from({ length: k }, (_, i) => { const tok = allTapeTokens[i]; return (tok && tok.length) ? [...tok] : [blank]; })
    : Array.from({ length: k }, (_, i) => i === 0 ? (tokens.length ? [...tokens] : [blank]) : [blank]);
  const heads = Array(k).fill(0);
  let state = App.startId;
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    tapes.forEach((tape, i) => { while (tape.length <= heads[i]) tape.push(blank); });
    const syms = tapes.map((tape, i) => tape[heads[i]]);
    App.simSteps.push({ state, tokens, tapes: tapes.map(t => [...t]), heads: [...heads], note: `State:${getState(state)?.name} Read:[${syms.join(',')}]` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const t = App.transitions.find(tr => tr.from === state && tr.tapeSyms && tr.tapeSyms.length === k && tr.tapeSyms.every((s, i) => s === syms[i] || s === App.config.sym.any));
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    for (let i = 0; i < k; i++) {
      tapes[i][heads[i]] = t.tapeWrites[i] || syms[i];
      const move = t.tapeDirs[i] === 'R' ? 1 : (t.tapeDirs[i] === 'L' ? -1 : 0);
      heads[i] += move;
      if (heads[i] < 0) heads[i] = 0;
    }
    state = t.to;
  }
  const lastMTM = App.simSteps[App.simSteps.length - 1];
  if (lastMTM && !lastMTM.final) { lastMTM.final = 'reject'; lastMTM.note += ' — STEP LIMIT REACHED — REJECT'; }
  App.simIdx = 0; renderSimStep();
}

function renderSimStep() {
  const step = App.simSteps[App.simIdx]; if (!step) return;
  const isLast = App.simIdx === App.simSteps.length - 1;

  // Log update
  const logLines = App.simSteps.slice(0, App.simIdx + 1).map((s, i) => {
    const cl = i === App.simIdx ? (s.final === 'accept' ? 't-ok' : s.final === 'reject' ? 't-err' : 't-step') : '';
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
      return `<div class="tc ${isHead ? 'head' : ''}${resClass}" title="${r.label} index ${ci}">${c}</div>`;
    }).join('');
    return `<div class="mtm-tape-row">
      <span class="tape-label">${r.label}</span>
      <span class="tape-cells">${cellsHtml}</span>
    </div>`;
  }).join('');

  trackerEl.innerHTML = headerHtml + rowsHtml;

  // Visual highlights on canvas
  document.querySelectorAll('.sn').forEach(el => el.classList.remove('act-st', 'rej-st'));
  const hl = step.state ? [step.state] : (step.states || []);
  hl.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add(step.final === 'reject' ? 'rej-st' : 'act-st');
  });
}
function stepFwd() { if (App.simIdx < App.simSteps.length - 1) { App.simIdx++; renderSimStep(); } }
function stepBack() { if (App.simIdx > 0) { App.simIdx--; renderSimStep(); } }
function resetSim() {
  clearInterval(App.autoTimer); App.autoTimer = null;
  App.simSteps = []; App.simIdx = 0; App.currentTokens = null;
  $('auto-btn').classList.remove('playing'); $('auto-btn').innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-right:4px"><path d="M4 2v12l9-6z"/></svg> Auto';
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  $('sim-tracker').innerHTML = ''; $('sim-tracker').style.display = 'none';
  document.querySelectorAll('.sn').forEach(el => el.classList.remove('act-st', 'rej-st'));
}
function toggleAuto() {
  if (App.autoTimer) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-right:4px"><path d="M4 2v12l9-6z"/></svg> Auto'; return; }
  $('auto-btn').classList.add('playing'); $('auto-btn').innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-right:4px"><path d="M5 3h2v10H5zM9 3h2v10H9z"/></svg> Stop';
  App.autoTimer = setInterval(() => { if (App.simIdx >= App.simSteps.length - 1) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-right:4px"><path d="M4 2v12l9-6z"/></svg> Auto'; return; } stepFwd(); }, App.config.autoSpeed);
}

// ══════════════════════════════════════════════════════════════════
//  BATCH TESTING
// ══════════════════════════════════════════════════════════════════
function runBatch() {
  const lines = $('batch-in').value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) return;
  if (!App.startId) {
    $('batch-result').innerHTML = `<div class="br-err">Error: No start state defined.</div>`;
    return;
  }
  const eps = App.config.sym.eps;
  if (isAnyTM(App.machine)) {
    $('batch-result').innerHTML = `<div class="br-err">Batch testing is not supported for ${App.machine}.</div>`;
    return;
  }
  const results = lines.map(line => {
    const raw = parseEps(line);
    const str = raw === App.config.sym.eps ? '' : raw;
    const tokens = tokenize(str);
    if (tokens === null) return { str: line, accepted: false, error: true };
    let accepted = false, output = null;
    if (App.machine === 'DFA') accepted = testDFA(tokens);
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
    return { str: line, accepted, output };
  });
  $('batch-result').innerHTML = results.map(r => {
    if (r.error) return `<div class="br-err">✗ "${r.str}" — cannot tokenize</div>`;
    const outTag = r.output !== null ? ` <span style="color:var(--text3);font-size:.65rem">→ "${r.output}"</span>` : '';
    if (r.accepted === undefined) return `<div class="br-ok" style="border-left-color:var(--text-main)"><span style="color:var(--text-main)">•</span> "${r.str}"${outTag}</div>`;
    return `<div class="${r.accepted ? 'br-ok' : 'br-err'}">${r.accepted ? '✓' : '✗'} "${r.str}"${outTag}</div>`;
  }).join('');
}
function testDFA(tokens) {
  let cur = App.startId;
  const any = App.config.sym.any;
  for (const sym of tokens) {
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === any));
    if (!t) return false;
    cur = t.to;
  }
  return App.accepts.has(cur);
}
function testNFA(tokens) {
  let cur = epsClosure(new Set([App.startId]));
  const any = App.config.sym.any;
  for (const sym of tokens) {
    let nx = new Set();
    cur.forEach(s => App.transitions.filter(t => t.from === s && (t.symbol === sym || t.symbol === any)).forEach(t => nx.add(t.to)));
    cur = epsClosure(nx);
  }
  return [...cur].some(id => App.accepts.has(id));
}

function legacyTestPDA_unused(tokens) {
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

function testPDA(tokens) {
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

function testNPDA(tokens) {
  return exploreNPDA(tokens).accepted;
}

function test2DFA(tokens) {
  return explore2DFA(tokens).accepted;
}

function test2NFA(tokens) {
  return explore2NFA(tokens).accepted;
}

function testFST(tokens) {
  const result = exploreFST(tokens);
  const outs = [...result.outputs];
  let output = '';
  if (outs.length > 1) output = outs.join(' | ');
  else if (outs.length === 1) output = outs[0];
  else output = result.witnessPath.at(-1)?.outRaw || '';
  return { accepted: result.accepted, output };
}

function getMooreOutput(tokens) {
  let cur = App.startId;
  const any = App.config.sym.any;
  const outputs = [getState(cur)?.output ?? ''];
  for (const sym of tokens) {
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === any));
    if (!t) break;
    cur = t.to;
    outputs.push(getState(cur)?.output ?? '');
  }
  return outputs.join('');
}
function getMealyOutput(tokens) {
  let cur = App.startId;
  const any = App.config.sym.any;
  const outputs = [];
  for (const sym of tokens) {
    const t = App.transitions.find(tr => tr.from === cur && (tr.symbol === sym || tr.symbol === any));
    if (!t) break;
    outputs.push(t.output ?? '?');
    cur = t.to;
  }
  return outputs.join('');
}

