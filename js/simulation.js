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
  const raw = $('sim-in').value, str = raw === 'ε' ? '' : raw;
  if (!App.startId) { log('<span class="t-err">No start state.</span>'); return; }
  const tokens = tokenize(str);
  if (tokens === null) { log(`<span class="t-err">Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</span>`); return; }
  if (App.machine === 'DFA') simDFA(tokens);
  else if (App.machine === 'NFA' || App.machine === 'ε-NFA') simNFA(tokens);
  else if (App.machine === 'PDA') simPDA(tokens);
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
}
function stepFwd() { if (App.simIdx < App.simSteps.length - 1) { App.simIdx++; renderSimStep(); } }
function stepBack() { if (App.simIdx > 0) { App.simIdx--; renderSimStep(); } }
function resetSim() {
  clearInterval(App.autoTimer); App.autoTimer = null;
  App.simSteps = []; App.simIdx = 0;
  $('auto-btn').classList.remove('playing'); $('auto-btn').textContent = '⏵ Auto';
  log('<span style="color:var(--text3);font-style:italic">Run a string to simulate…</span>');
  $('tape-wrap').innerHTML = '';
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
  const lines = $('batch-in').value.split('\n').map(l => l.trim()).filter(l => l !== undefined);
  if (!lines.length) return;
  if (App.machine === 'PDA' || App.machine === 'TM') {
    $('batch-result').innerHTML = `<div class="br-err">Batch testing is not supported for ${App.machine}. Switch to DFA, NFA, or ε-NFA.</div>`;
    return;
  }
  const results = lines.map(line => {
    const str = line === 'ε' ? '' : line;
    const tokens = tokenize(str);
    if (tokens === null) return { str: line, accepted: false, error: true };
    let accepted = false;
    if (App.machine === 'DFA') accepted = testDFA(tokens);
    else if (App.machine === 'NFA' || App.machine === 'ε-NFA') accepted = testNFA(tokens);
    return { str: line, accepted };
  });
  $('batch-result').innerHTML = results.map(r =>
    r.error
      ? `<div class="br-err">✗ "${r.str}" — cannot tokenize</div>`
      : `<div class="${r.accepted ? 'br-ok' : 'br-err'}">${r.accepted ? '✓' : '✗'} "${r.str}"</div>`
  ).join('');
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

