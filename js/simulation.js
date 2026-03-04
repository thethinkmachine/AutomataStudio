// ══════════════════════════════════════════════════════════════════
//  SIMULATION
// ══════════════════════════════════════════════════════════════════
function tokenize(str) {
  if (str === '') return [];
  const syms = [...App.sigma].filter(s => s !== 'ε').sort((a, b) => b.length - a.length);
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

function runSim() {
  resetSim();
  const raw = $('sim-in').value;
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
      const tok = tokenize(p === 'ε' ? '' : p);
      if (tok === null) { log(`<span class="t-err">Tape ${pi + 1}: cannot tokenize "${p}" using alphabet {${[...App.sigma].join(', ')}}.</span>`); return; }
      tapeTokens.push(tok);
    }
    simMTM(tapeTokens[0], tapeTokens);
    return;
  }

  const str = raw === 'ε' ? '' : raw;
  const tokens = tokenize(str);
  if (tokens === null) { log(`<span class="t-err">Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</span>`); return; }
  if (App.machine === 'DFA') simDFA(tokens);
  else if (App.machine === 'NFA' || App.machine === 'ε-NFA') simNFA(tokens);
  else if (App.machine === 'PDA') simPDA(tokens);
  else if (App.machine === 'Moore') simMoore(tokens);
  else if (App.machine === 'Mealy') simMealy(tokens);
  else if (App.machine === 'MTM') simMTM(tokens);
  else simTM(tokens);
}
function log(html) { const t = $('trace-log'); t.innerHTML = html; t.scrollTop = t.scrollHeight; }

function simDFA(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  App.simSteps.push({ state: cur, remaining: tokens.join(''), note: `Start: ${getState(cur)?.name || '?'}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym);
    if (!t) { App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `No δ(${getState(cur)?.name},'${sym}') — REJECT`, final: 'reject' }); break; }
    cur = t.to;
    App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `Read '${sym}' → ${getState(cur)?.name}`, tid: t.id });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

function simNFA(tokens) {
  App.simSteps = [];
  let cur = epsClosure(new Set([App.startId]));
  App.simSteps.push({ states: [...cur], remaining: tokens.join(''), note: `Start ε-closure: {${stateNames(cur)}}` });
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i]; let nx = new Set();
    cur.forEach(sid => App.transitions.filter(t => t.from === sid && t.symbol === sym).forEach(t => nx.add(t.to)));
    nx = epsClosure(nx);
    cur = nx;
    App.simSteps.push({ states: [...cur], remaining: tokens.slice(i + 1).join(''), note: `Read '${sym}' → {${stateNames(cur) || '∅'}}` });
    if (!cur.size) break;
  }
  const last = App.simSteps[App.simSteps.length - 1];
  const acc = [...cur].some(id => App.accepts.has(id));
  if (!last.final) { last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

function epsClosure(states) {
  const c = new Set(states), stk = [...states];
  while (stk.length) { const s = stk.pop(); App.transitions.filter(t => t.from === s && t.symbol === 'ε').forEach(t => { if (!c.has(t.to)) { c.add(t.to); stk.push(t.to); } }); }
  return c;
}
function stateNames(ids) { return [...ids].map(id => getState(id)?.name || id).join(',') }

function simPDA(tokens) {
  App.simSteps = [];
  const init = { state: App.startId, remaining: tokens, stack: ['Z'], note: 'Start configuration' };
  App.simSteps.push(init);
  let cfgs = [init];
  const visited = new Set(); // Track visited configurations to avoid ε-loops (#8)
  visited.add(init.state + '|' + init.remaining.join('') + '|' + init.stack.join(''));
  for (let step = 0; step < 2000 && cfgs.length; step++) {
    const next = [];
    cfgs.forEach(cfg => {
      const { state, remaining, stack } = cfg, top = stack[stack.length - 1];
      App.transitions.filter(t => t.from === state).forEach(t => {
        const rOk = t.symbol === 'ε' || (remaining.length > 0 && t.symbol === remaining[0]);
        const pOk = t.pop === 'ε' || t.pop === top;
        if (!rOk || !pOk) return;
        const ns = [...stack]; if (t.pop !== 'ε') ns.pop();
        if (t.push && t.push !== 'ε') t.push.split('').reverse().forEach(c => ns.push(c));
        const nr = t.symbol === 'ε' ? remaining : remaining.slice(1);
        const cfgKey = t.to + '|' + nr.join('') + '|' + ns.join('');
        if (visited.has(cfgKey)) return; // Skip already-visited configurations
        visited.add(cfgKey);
        const nc = { state: t.to, remaining: nr, stack: ns, note: `(${getState(state)?.name},${t.symbol || 'ε'},${top})→(${getState(t.to)?.name},${t.push || 'ε'})  [${ns.join('')}]` };
        next.push(nc); App.simSteps.push(nc);
      });
    });
    cfgs = next;
  }
  const acc = App.simSteps.some(c => App.accepts.has(c.state) && c.remaining.length === 0);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) { last.final = acc ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  App.simIdx = 0; renderSimStep();
}

function simTM(tokens) {
  App.simSteps = [];
  let tape = tokens.length ? [...tokens] : [], head = 0, state = App.startId;
  for (let step = 0; step < 10000; step++) {
    while (tape.length <= head) tape.push('⊔');
    const sym = tape[head];
    App.simSteps.push({ state, tape: [...tape], head, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const t = App.transitions.find(tr => tr.from === state && tr.symbol === sym);
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    tape[head] = t.write || sym; state = t.to; head += t.dir === 'R' ? 1 : -1; if (head < 0) head = 0;
  }
  const lastTM = App.simSteps[App.simSteps.length - 1];
  if (lastTM && !lastTM.final) { lastTM.final = 'reject'; lastTM.note += ' — STEP LIMIT REACHED (possible loop) — REJECT'; }
  App.simIdx = 0; renderSimStep();
}

function simMoore(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  const s0 = getState(cur);
  const initOut = s0?.output ?? '';
  App.simSteps.push({ state: cur, remaining: tokens.join(''), note: `Start: ${s0?.name} — λ: '${initOut}'`, output: initOut });
  const outputs = [initOut];
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym);
    if (!t) { App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject' }); break; }
    cur = t.to;
    const sc = getState(cur);
    const out = sc?.output ?? '';
    outputs.push(out);
    App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `Read '${sym}' → ${sc?.name} — λ: '${out}'`, tid: t.id, output: out });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  last.note += ` | Output: "${outputs.join('')}"`;
  App.simIdx = 0; renderSimStep();
}

function simMealy(tokens) {
  App.simSteps = [];
  let cur = App.startId;
  App.simSteps.push({ state: cur, remaining: tokens.join(''), note: `Start: ${getState(cur)?.name}`, outSoFar: '' });
  const outputs = [];
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym);
    if (!t) { App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject', outSoFar: outputs.join('') }); break; }
    outputs.push(t.output ?? '?');
    cur = t.to;
    App.simSteps.push({ state: cur, remaining: tokens.slice(i + 1).join(''), note: `Read '${sym}' → ${getState(cur)?.name} — out: '${t.output ?? '?'}'`, tid: t.id, outSoFar: outputs.join('') });
  }
  const last = App.simSteps[App.simSteps.length - 1];
  if (!last.final) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  if (outputs.length) last.note += ` | Output: "${outputs.join('')}"`;
  App.simIdx = 0; renderSimStep();
}

function simMTM(tokens, allTapeTokens) {
  App.simSteps = [];
  const k = App.tapeCount;
  const tapes = allTapeTokens
    ? Array.from({ length: k }, (_, i) => { const tok = allTapeTokens[i]; return (tok && tok.length) ? [...tok] : ['⊔']; })
    : Array.from({ length: k }, (_, i) => i === 0 ? (tokens.length ? [...tokens] : ['⊔']) : ['⊔']);
  const heads = Array(k).fill(0);
  let state = App.startId;
  for (let step = 0; step < 10000; step++) {
    tapes.forEach((tape, i) => { while (tape.length <= heads[i]) tape.push('⊔'); });
    const syms = tapes.map((tape, i) => tape[heads[i]]);
    App.simSteps.push({ state, tapes: tapes.map(t => [...t]), heads: [...heads], note: `State:${getState(state)?.name} Read:[${syms.join(',')}]` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const t = App.transitions.find(tr => tr.from === state && tr.tapeSyms && tr.tapeSyms.length === k && tr.tapeSyms.every((s, i) => s === syms[i] || s === 'Σ'));
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    for (let i = 0; i < k; i++) {
      tapes[i][heads[i]] = t.tapeWrites[i] || syms[i];
      heads[i] += t.tapeDirs[i] === 'R' ? 1 : -1;
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
  const lines = App.simSteps.slice(0, App.simIdx + 1).map((s, i) => {
    const cl = i === App.simIdx ? (s.final === 'accept' ? 't-ok' : s.final === 'reject' ? 't-err' : 't-step') : '';
    return `<div class="${cl}">${i}: ${s.note}</div>`;
  }).join('');
  log(lines);
  document.querySelectorAll('.sn').forEach(el => el.classList.remove('act-st', 'rej-st'));
  const hl = step.state ? [step.state] : (step.states || []);
  hl.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add(step.final === 'reject' ? 'rej-st' : 'act-st');
  });
  if (App.machine === 'TM' && step.tape) {
    const tw = $('tape-wrap'); tw.style.display = 'flex';
    tw.innerHTML = step.tape.map((c, i) => `<div class="tc ${i === step.head ? 'head' : ''}">${c}</div>`).join('');
  }
  if (App.machine === 'MTM' && step.tapes) {
    const mtmDiv = $('mtm-tapes'); mtmDiv.style.display = '';
    mtmDiv.innerHTML = step.tapes.map((tape, ti) =>
      `<div class="mtm-tape-row"><span class="tape-label">T${ti + 1}</span><span class="tape-cells">${tape.map((c, ci) => `<div class="tc ${ci === step.heads[ti] ? 'head' : ''}">${c}</div>`).join('')}</span></div>`
    ).join('');
  }
}
function stepFwd() { if (App.simIdx < App.simSteps.length - 1) { App.simIdx++; renderSimStep(); } }
function stepBack() { if (App.simIdx > 0) { App.simIdx--; renderSimStep(); } }
function resetSim() {
  clearInterval(App.autoTimer); App.autoTimer = null;
  App.simSteps = []; App.simIdx = 0;
  $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto';
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  $('tape-wrap').innerHTML = ''; $('tape-wrap').style.display = 'none';
  $('mtm-tapes').innerHTML = ''; $('mtm-tapes').style.display = 'none';
  document.querySelectorAll('.sn').forEach(el => el.classList.remove('act-st', 'rej-st'));
}
function toggleAuto() {
  if (App.autoTimer) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto'; return; }
  $('auto-btn').classList.add('playing'); $('auto-btn').textContent = '⏸ Stop';
  App.autoTimer = setInterval(() => { if (App.simIdx >= App.simSteps.length - 1) { clearInterval(App.autoTimer); App.autoTimer = null; $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto'; return; } stepFwd(); }, 500);
}

// ══════════════════════════════════════════════════════════════════
//  BATCH TESTING
// ══════════════════════════════════════════════════════════════════
function runBatch() {
  const lines = $('batch-in').value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) return;
  if (App.machine === 'PDA' || App.machine === 'TM' || App.machine === 'MTM') {
    $('batch-result').innerHTML = `<div class="br-err">Batch testing is not supported for ${App.machine}.</div>`;
    return;
  }
  const results = lines.map(line => {
    const str = line === 'ε' ? '' : line;
    const tokens = tokenize(str);
    if (tokens === null) return { str: line, accepted: false, error: true };
    let accepted = false, output = null;
    if (App.machine === 'DFA') accepted = testDFA(tokens);
    else if (App.machine === 'NFA' || App.machine === 'ε-NFA') accepted = testNFA(tokens);
    else if (App.machine === 'Moore') { accepted = testDFA(tokens); output = getMooreOutput(tokens); }
    else if (App.machine === 'Mealy') { accepted = testDFA(tokens); output = getMealyOutput(tokens); }
    return { str: line, accepted, output };
  });
  $('batch-result').innerHTML = results.map(r => {
    if (r.error) return `<div class="br-err">✗ "${r.str}" — cannot tokenize</div>`;
    const outTag = r.output !== null ? ` <span style="color:var(--text3);font-size:.65rem">→ "${r.output}"</span>` : '';
    return `<div class="${r.accepted ? 'br-ok' : 'br-err'}">${r.accepted ? '✓' : '✗'} "${r.str}"${outTag}</div>`;
  }).join('');
}
function testDFA(tokens) {
  let cur = App.startId;
  for (const sym of tokens) { const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym); if (!t) return false; cur = t.to; }
  return App.accepts.has(cur);
}
function testNFA(tokens) {
  let cur = epsClosure(new Set([App.startId]));
  for (const sym of tokens) { let nx = new Set(); cur.forEach(s => App.transitions.filter(t => t.from === s && t.symbol === sym).forEach(t => nx.add(t.to))); cur = epsClosure(nx); }
  return [...cur].some(id => App.accepts.has(id));
}
function getMooreOutput(tokens) {
  let cur = App.startId;
  const outputs = [getState(cur)?.output ?? ''];
  for (const sym of tokens) {
    const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym);
    if (!t) break;
    cur = t.to;
    outputs.push(getState(cur)?.output ?? '');
  }
  return outputs.join('');
}
function getMealyOutput(tokens) {
  let cur = App.startId;
  const outputs = [];
  for (const sym of tokens) {
    const t = App.transitions.find(tr => tr.from === cur && tr.symbol === sym);
    if (!t) break;
    outputs.push(t.output ?? '?');
    cur = t.to;
  }
  return outputs.join('');
}

