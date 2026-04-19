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
  else if (App.machine === 'DPDA') simPDA(tokens);
  else if (App.machine === 'NPDA') simNPDA(tokens);
  else if (App.machine === 'Moore') simMoore(tokens);
  else if (App.machine === 'Mealy') simMealy(tokens);
  else if (App.machine === 'NDTM') simNDTM(tokens);
  else if (App.machine === 'MTM') simMTM(tokens);
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

function createInitialPdaConfig(tokens) {
  const isExplicit = App.config.pdaParadigm === 'explicit';
  return {
    state: App.startId,
    tokens,
    remaining: [...tokens],
    stack: isExplicit ? [App.config.sym.stackBottom] : [],
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
}

function pdaConfigKey(state, remaining, stack) {
  return `${state}|${remaining.join('\u0001')}|${stack.join('\u0001')}`;
}

function isPdaAcceptingConfig(cfg) {
  if (App.config.pdaParadigm === 'explicit') {
    return App.accepts.has(cfg.state) && cfg.remaining.length === 0;
  }
  return cfg.remaining.length === 0 && cfg.stack.length === 0;
}

function formatPdaInstantaneousDescription(cfg) {
  const stateName = getState(cfg.state)?.name || cfg.state;
  const remaining = cfg.remaining.length ? cfg.remaining.join('') : App.config.sym.eps;
  const stack = cfg.stack.length ? [...cfg.stack].reverse().join('') : App.config.sym.eps;
  return `(${stateName}, ${remaining}, ${stack})`;
}

function getMatchingPdaTransitions(cfg) {
  const top = cfg.stack[cfg.stack.length - 1];
  const eps = App.config.sym.eps;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    const readOk = t.symbol === eps || (cfg.remaining.length > 0 && (t.symbol === cfg.remaining[0] || t.symbol === App.config.sym.any));
    const popOk = canApplyPdaPop(top, t.pop);
    return readOk && popOk;
  });
}

function applyPdaTransitionConfig(cfg, transition, branch = cfg.branch) {
  const eps = App.config.sym.eps;
  const top = cfg.stack[cfg.stack.length - 1];
  const nextStack = [...cfg.stack];
  if (transition.pop !== eps) nextStack.pop();
  let pushStr = transition.push && transition.push !== eps ? transition.push : '';
  if (pushStr === App.config.sym.any) pushStr = top;
  if (pushStr) pushStr.split('').reverse().forEach(sym => nextStack.push(sym));
  return {
    state: transition.to,
    tokens: cfg.tokens,
    remaining: transition.symbol === eps ? [...cfg.remaining] : cfg.remaining.slice(1),
    stack: nextStack,
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: transition
  };
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
  return `Branch ${nextCfg.branch} depth ${nextCfg.depth}: (${fromName}, ${read}, ${pop}) → (${toName}, ${push})`;
}

function buildPdaPathSteps(path, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, idx) => ({
    state: cfg.state,
    tokens: cfg.tokens,
    remaining: [...cfg.remaining],
    stack: [...cfg.stack],
    branch: cfg.branch,
    tid: cfg.via?.id,
    note: idx === 0 ? 'Start configuration' : formatPdaTransitionNote(path[idx - 1], cfg)
  }));
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

function appendPdaSummaryStep(steps, cfg, finalStatus, note) {
  steps.push({
    state: cfg.state,
    tokens: cfg.tokens,
    remaining: [...cfg.remaining],
    stack: [...cfg.stack],
    branch: cfg.branch,
    note,
    final: finalStatus
  });
}

function simPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(init)) {
    App.simSteps = buildPdaPathSteps([init], 'accept');
    App.simIdx = 0; renderSimStep();
    return { accepted: true };
  }

  let cfg = init;
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack)]);

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
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack);
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
  const visited = new Set([pdaConfigKey(init.state, init.remaining, init.stack)]);
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
    const subs = [
      `State "${stateName}" with next input '${nextRead}'`,
      `Depth ${cfg.depth} · Stack top ${cfg.stack[cfg.stack.length - 1] || App.config.sym.eps}`,
      `ID: ${idStr}`
    ];
    if (matching.length > 1) {
      subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    }
    log.push(`Branch ${cfg.branch}: exploring <em>${stateName}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdaTransitionConfig(cfg, transition, childBranch);
      const key = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack);
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

  if (m === 'TM' || m === 'NDTM') {
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
      rows.push({ label: 'Stk', cells: [...step.stack].reverse(), head: 0 }); // Stack top at index 0
    } else if (['Moore', 'Mealy'].includes(m)) {
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
  $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto';
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  $('sim-tracker').innerHTML = ''; $('sim-tracker').style.display = 'none';
  document.querySelectorAll('.sn').forEach(el => el.classList.remove('act-st', 'rej-st'));
}
function toggleAuto() {
  if (App.autoTimer) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto'; return; }
  $('auto-btn').classList.add('playing'); $('auto-btn').textContent = '⏸ Stop';
  App.autoTimer = setInterval(() => { if (App.simIdx >= App.simSteps.length - 1) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto'; return; } stepFwd(); }, App.config.autoSpeed);
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
    else if (App.machine === 'DPDA') accepted = testPDA(tokens);
    else if (App.machine === 'NPDA') accepted = testNPDA(tokens);
    else if (App.machine === 'Moore') { accepted = App.config.transducerAccepts ? testDFA(tokens) : undefined; output = getMooreOutput(tokens); }
    else if (App.machine === 'Mealy') { accepted = App.config.transducerAccepts ? testDFA(tokens) : undefined; output = getMealyOutput(tokens); }
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
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack)]);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = getMatchingPdaTransitions(cfg);
    if (matching.length !== 1) return false;
    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack);
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

