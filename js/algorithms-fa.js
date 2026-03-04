// ══════════════════════════════════════════════════════════════════
//  ALGORITHMS VIEW
// ══════════════════════════════════════════════════════════════════
function setAlgo(a) {
  App.currentAlgo = a;
  document.querySelectorAll('.algo-item').forEach(el => el.classList.toggle('active', el.dataset.algo === a));
  renderAlgo(a);
}

function renderAlgo(a) {
  const c = $('algo-content'); c.innerHTML = '';
  const renders = {
    table: algoTable, nfa2dfa: algoNFA2DFA, minimize: algoMinimize, equiv: algoEquiv,
    re2nfa: algoRE2NFA, nfa2re: algoNFA2RE, enfa2nfa: algoEpsNFA2NFA,
    complement: algoComplement, product: algoProduct,
    isEmpty: algoIsEmpty, isFinite: algoIsFinite, isUniversal: algoIsUniversal, fullEquiv: algoFullEquiv,
    star: algoClopStar, reversal: algoClopReversal, union2: algoClopUnion, intersect: algoClopIntersect, concat2: algoClopConcat,
    nfaTree: algoNFATree, ndtm: algoNDTM, utm: algoUTM,
    mooreTable: algoMooreTable, mealyTable: algoMealyTable,
    moore2mealy: algoMoore2Mealy, mealy2moore: algoMealy2Moore, mtmTable: algoMTMTable,
  };
  if (renders[a]) renders[a](c);
}

// --- Transition Table ---
function algoTable(c) {
  c.innerHTML = `<div class="algo-title">Transition Table δ</div>
<div class="algo-sub">FORMAL REPRESENTATION OF THE TRANSITION FUNCTION</div>`;
  if (!App.states.length) { c.innerHTML += '<div class="card"><div style="color:var(--text3);font-size:.72rem">Build an automaton first in the Build tab.</div></div>'; return; }
  const syms = [...App.sigma];
  const thead = `<tr><th>State</th>${syms.map(s => `<th>${s}</th>`).join('')}</tr>`;
  const rows = App.states.map(s => {
    const prefix = (App.startId === s.id ? '→' : ' ') + (App.accepts.has(s.id) ? '*' : ' ');
    const cells = syms.map(sym => {
      if (App.machine === 'DFA') {
        const t = App.transitions.find(tr => tr.from === s.id && tr.symbol === sym);
        const dest = t ? getState(t.to)?.name : '—';
        return `<td class="${!t ? 'dead-cell' : ''} ${App.accepts.has(t?.to) ? 'acc-cell' : ''}">${dest}</td>`;
      } else {
        const ts = App.transitions.filter(tr => tr.from === s.id && tr.symbol === sym);
        if (!ts.length) return '<td class="dead-cell">∅</td>';
        return `<td>{${ts.map(tr => getState(tr.to)?.name).join(',')}}</td>`;
      }
    }).join('');
    return `<tr><td class="${App.startId === s.id ? 'start-cell' : ''} ${App.accepts.has(s.id) ? 'acc-cell' : ''}">${prefix} ${s.name}</td>${cells}</tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">δ: Q × Σ → ${App.machine === 'DFA' ? 'Q' : '2^Q'}</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">→ = start state &nbsp;&nbsp; * = accept state &nbsp;&nbsp; — = dead state (implicit reject)</div></div>`;
}

// --- NFA to DFA Subset Construction ---
function algoNFA2DFA(c) {
  c.innerHTML = `<div class="algo-title">NFA → DFA Conversion</div>
<div class="algo-sub">SUBSET CONSTRUCTION (POWERSET CONSTRUCTION)</div>
<div class="info-box">Each DFA state represents a <em>subset of NFA states</em>. Starting from ε-closure(q₀), we compute transitions for each symbol and add new subsets as needed. The resulting DFA is equivalent to the original NFA.</div>`;
  if (!App.startId || App.machine === 'DFA') {
    if (App.machine === 'DFA') { c.innerHTML += '<div class="card">Your automaton is already a DFA. Switch to NFA or ε-NFA mode to use this.</div>'; return; }
    c.innerHTML += '<div class="card">No start state defined.</div>'; return;
  }
  const result = subsetConstruction();
  if (!result.states.length) { c.innerHTML += '<div class="card">Empty NFA.</div>'; return; }
  const syms = [...App.sigma];
  const thead = `<tr><th>DFA State (NFA Subset)</th>${syms.map(s => `<th>${s}</th>`).join('')}<th>Type</th></tr>`;
  const rows = result.states.map(ds => {
    const cells = syms.map(sym => {
      const tx = result.trans.find(t => t.from === ds.name && t.sym === sym);
      return `<td>${tx ? tx.to : '∅'}</td>`;
    }).join('');
    const type = (ds.isStart && ds.isAcc ? 'start+acc' : ds.isStart ? 'start' : ds.isAcc ? 'accept' : '—');
    return `<tr><td class="${ds.isStart ? 'start-cell' : ''} ${ds.isAcc ? 'acc-cell' : ''}">${ds.name}</td>${cells}<td>${type}</td></tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Result: ${result.states.length} DFA states from ${App.states.length} NFA states</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div></div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadSubsetAsDFA()">Load Result into Canvas</button></div>`;
  // Steps
  c.innerHTML += `<div class="card"><div class="card-title">Construction Steps</div><div class="step-list">${result.steps.map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')
    }</div></div>`;
  App._lastSubset = result;
}

function subsetConstruction() {
  const syms = [...App.sigma];
  const setKey = set => [...set].sort().join(',');
  const setName = set => { const inner = [...set].map(id => getState(id)?.name).sort().join(','); return inner ? '{' + inner + '}' : '∅'; };
  const start = epsClosure(new Set([App.startId]));
  const startName = setName(start);
  const queue = [start]; const visited = new Map([[setKey(start), start]]);
  const states = [{ name: startName, set: start, isStart: true, isAcc: [...start].some(id => App.accepts.has(id)) }];
  const trans = [], steps = [`ε-closure({${getState(App.startId)?.name}}) = ${startName} <em>(initial DFA state)</em>`];
  while (queue.length) {
    const cur = queue.shift(), curName = setName(cur);
    syms.forEach(sym => {
      let nx = new Set();
      cur.forEach(sid => App.transitions.filter(t => t.from === sid && t.symbol === sym).forEach(t => nx.add(t.to)));
      nx = epsClosure(nx);
      if (!nx.size) { steps.push(`δ(${curName},'${sym}') = ∅`); return; }
      const nxName = setName(nx), nxKey = setKey(nx);
      trans.push({ from: curName, sym, to: nxName });
      steps.push(`δ(${curName},'${sym}') = <em>${nxName}</em>${!visited.has(nxKey) ? ' <em>(new state!)</em>' : ''}`);
      if (!visited.has(nxKey)) {
        visited.set(nxKey, nx); queue.push(nx);
        states.push({ name: nxName, set: nx, isStart: false, isAcc: [...nx].some(id => App.accepts.has(id)) });
      }
    });
  }
  return { states, trans, steps };
}

let _subsetData = null;
function loadSubsetAsDFA() {
  const r = App._lastSubset; if (!r) return;
  snapshot();
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null; App.stateN = 0; App.transN = 0;
  const nameMap = {};
  r.states.forEach((ds, i) => {
    const id = 's' + (i + 1); App.stateN = i + 1;
    App.states.push({ id, x: 120 + (i % 4) * 200, y: 120 + Math.floor(i / 4) * 160, name: ds.name.length > 12 ? `D${i}` : ds.name });
    nameMap[ds.name] = id;
    if (ds.isStart) App.startId = id;
    if (ds.isAcc) App.accepts.add(id);
  });
  r.trans.forEach((t, i) => {
    App.transN = i + 1;
    App.transitions.push({ id: 't' + (i + 1), from: nameMap[t.from], to: nameMap[t.to], symbol: t.sym });
  });
  App.machine = 'DFA'; setMachine('DFA');
  renderAll(); updateSidebar(); updateRPanel();
  setView('build'); showStatus('DFA loaded into canvas!');
}

// --- DFA Minimization (Table-Filling) ---
function algoMinimize(c) {
  c.innerHTML = `<div class="algo-title">DFA Minimization</div>
<div class="algo-sub">TABLE-FILLING ALGORITHM (MYHILL-NERODE)</div>
<div class="info-box">Two states are <em>distinguishable</em> if there exists some string that leads to an accept state from one but not the other. We iteratively mark distinguishable pairs until no new marks can be made.</div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card">Switch to DFA mode to use minimization.</div>'; return; }
  if (App.states.length < 2) { c.innerHTML += '<div class="card">Need at least 2 states.</div>'; return; }
  const result = tableFillingMinimize();
  // Table
  const states = App.states;
  const header = `<tr><th></th>${states.slice(0, -1).map(s => `<th>${s.name}</th>`).join('')}</tr>`;
  const rows = states.slice(1).map((s, i) => {
    const cells = states.slice(0, i + 1).map(t => {
      const key = [s.id, t.id].sort().join('|');
      const marked = result.dist[key];
      return `<td class="${marked ? 'marked' : 'unmarked'}">${marked ? '✗' : '≡'}</td>`;
    }).join('');
    return `<tr><th>${s.name}</th>${cells}</tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Distinguishability Table (✗=distinguishable, ≡=equivalent)</div>
<div class="min-table-wrap"><table class="min-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div></div>`;
  // Groups
  const gHtml = result.groups.map(g => `<div class="state-pill ${g.length === 1 ? '' : 'acc'}">{${g.map(id => getState(id)?.name).join(',')}}</div>`).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Equivalence Classes (${result.groups.length} classes = minimized states)</div>
<div class="nfa-result-states">${gHtml}</div></div>`;
  // Steps
  c.innerHTML += `<div class="card"><div class="card-title">Algorithm Steps</div><div class="step-list">${result.steps.map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')
    }</div></div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadMinimizedDFA()">Load Minimized DFA</button></div>`;
  App._lastMin = result;
}

function tableFillingMinimize() {
  const states = App.states, n = states.length;
  const ids = states.map(s => s.id);
  const dist = {}, steps = [];
  // Save snapshot of transitions for later use in loadMinimizedDFA
  const savedTrans = App.transitions.map(t => ({ ...t }));
  const savedStates = App.states.map(s => ({ ...s }));
  const savedAccepts = new Set(App.accepts);
  const savedStart = App.startId;
  // Init
  ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
    const key = [a, b].sort().join('|');
    dist[key] = App.accepts.has(a) !== App.accepts.has(b);
  }));
  steps.push('Mark pairs where one state is accepting and the other is not.');
  // Iterate
  let changed = true, iter = 0;
  while (changed) {
    changed = false; iter++;
    ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
      const key = [a, b].sort().join('|');
      if (dist[key]) return;
      for (const sym of App.sigma) {
        const ta = App.transitions.find(t => t.from === a && t.symbol === sym);
        const tb = App.transitions.find(t => t.from === b && t.symbol === sym);
        const da = ta?.to, db = tb?.to;
        if (da === db) continue;
        if (da && db) { const pk = [da, db].sort().join('|'); if (dist[pk]) { dist[key] = true; changed = true; steps.push(`Mark (${getState(a)?.name},${getState(b)?.name}): δ on '${sym}' leads to distinguishable pair.`); return; } }
        else if (da || db) { dist[key] = true; changed = true; steps.push(`Mark (${getState(a)?.name},${getState(b)?.name}): one has δ on '${sym}', other doesn't.`); return; }
      }
    }));
    if (iter > ids.length * ids.length) break;
  }
  steps.push('Fixed point reached — no more pairs can be marked.');
  // Group indistinguishable
  const assigned = new Set(), groups = [];
  ids.forEach(a => {
    if (assigned.has(a)) return;
    const grp = [a]; assigned.add(a);
    ids.forEach(b => { if (!assigned.has(b)) { const k = [a, b].sort().join('|'); if (!dist[k]) { grp.push(b); assigned.add(b); } } });
    groups.push(grp);
  });
  return { dist, groups, steps, savedTrans, savedStates, savedAccepts, savedStart };
}

function loadMinimizedDFA() {
  const r = App._lastMin; if (!r) return;
  const { groups, savedTrans, savedAccepts, savedStart } = r;
  snapshot();
  // Group representative mapping: origId -> groupIndex
  const groupOf = {};
  groups.forEach((g, i) => g.forEach(id => groupOf[id] = i));
  const newStates = [], newTrans = [], newAccepts = new Set();
  let newStart = null;
  groups.forEach((g, i) => {
    const id = 's' + (i + 1);
    // Get names from the saved state data
    const stateNames = g.map(oid => r.savedStates.find(s => s.id === oid)?.name || oid);
    newStates.push({ id, x: 160 + (i % 4) * 200, y: 150 + Math.floor(i / 4) * 160, name: stateNames.join('/') });
    if (g.includes(savedStart)) newStart = id;
    if (g.some(oid => savedAccepts.has(oid))) newAccepts.add(id);
  });
  // Rebuild transitions (deduplicated)
  const seenTrans = new Set();
  savedTrans.forEach((t, i) => {
    const fg = groupOf[t.from], tg = groupOf[t.to];
    if (fg === undefined || tg === undefined) return;
    const key = `s${fg + 1}|${t.symbol}|s${tg + 1}`;
    if (seenTrans.has(key)) return;
    seenTrans.add(key);
    newTrans.push({ ...t, id: 't' + (newTrans.length + 1), from: 's' + (fg + 1), to: 's' + (tg + 1), symbol: t.symbol });
  });
  App.states = newStates; App.transitions = newTrans; App.accepts = newAccepts;
  App.startId = newStart; App.stateN = groups.length; App.transN = newTrans.length;
  App.machine = 'DFA'; setMachine('DFA');
  renderAll(); updateSidebar(); updateRPanel();
  setView('build'); showStatus(`Minimized: ${groups.length} states (was ${r.savedStates.length})`);
}

// --- Regex to NFA (Thompson's Construction) ---
function algoRE2NFA(c) {
  c.innerHTML = `<div class="algo-title">Regex → NFA</div>
<div class="algo-sub">THOMPSON'S CONSTRUCTION</div>
<div class="info-box">Build NFA fragments for each regex operator:<br>
<em>• Literal a</em>: q₀ →ᵃ q₁<br>
<em>• Concatenation ab</em>: NFA(a) ε→ NFA(b)<br>
<em>• Union a|b</em>: new start ε→ NFA(a), ε→ NFA(b); both ε→ new accept<br>
<em>• Kleene a*</em>: new start/accept, ε loops on NFA(a)</div>
<div class="card">
  <div class="card-title">Input Regular Expression</div>
  <div class="regex-input-wrap">
    <input class="inp regex-inp" id="re-input" placeholder="e.g. (a|b)*abb or [a-z]{2,5}" onkeydown="if(event.key==='Enter')doThompson()">
    <button class="algo-btn" onclick="doThompson()">Build NFA</button>
  </div>
  <div style="font-size:.67rem;color:var(--text3)">
    <b>Supported</b>: <b>|</b> union &nbsp; <b>*</b> Kleene star &nbsp; <b>+</b> one-or-more &nbsp; <b>?</b> optional &nbsp; <b>()</b> grouping &nbsp; <b>[abc]</b> char class &nbsp; <b>[a-z]</b> ranges &nbsp; <b>{n,m}</b> bounds &nbsp; ε = epsilon<br>
    <b>Not supported</b>: <b>.</b> = any character &nbsp; <b>[^abc]</b> = negation (limited support)<br>
    This tool uses the mathematical/textbook notation for Thompson's construction.
  </div>
</div>
<div id="re-result"></div>`;
}

function doThompson() {
  const re = $('re-input').value.trim(); if (!re) { showStatus('Enter a regex first'); return; }
  try {
    const nfaData = thompsonBuild(re);
    let html = `<div class="card"><div class="card-title">NFA States: ${nfaData.states.length}</div>
  <div class="nfa-result-states">`;
    nfaData.states.forEach(s => {
      const cls = s === nfaData.start && nfaData.accept === s ? 'both' : s === nfaData.start ? 'start' : s === nfaData.accept ? 'acc' : '';
      html += `<div class="state-pill ${cls}">${s}${s === nfaData.start ? ' (start)' : ''}${s === nfaData.accept ? ' (accept)' : ''}</div>`;
    });
    html += '</div></div>';
    html += `<div class="card"><div class="card-title">Transitions (${nfaData.trans.length})</div>
  <table class="result-table"><thead><tr><th>From</th><th>Symbol</th><th>To</th></tr></thead><tbody>`;
    nfaData.trans.forEach(t => { html += `<tr><td ${t.from === nfaData.start ? 'class="start-cell"' : ''}>${t.from}</td><td>${t.sym}</td><td ${t.to === nfaData.accept ? 'class="acc-cell"' : ''}>${t.to}</td></tr>`; });
    html += '</tbody></table></div>';
    html += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadThompsonNFA()">Load into Canvas</button></div>`;
    $('re-result').innerHTML = html;
    App._lastThompson = nfaData;
  } catch (err) { $('re-result').innerHTML = `<div class="card" style="color:var(--red);font-size:.75rem">Parse error: ${err.message}</div>`; }
}

// Thompson's Construction
let _tnc = 0;
function tnew() { return 'n' + (++_tnc); }
function thompsonBuild(re) {
  _tnc = 0;
  const ast = parseRE(re);
  const nfa = buildThompson(ast);
  return nfa;
}
function parseRE(re) {
  let pos = 0;
  function parseUnion() {
    let r = parseConcat();
    while (pos < re.length && re[pos] === '|') { pos++; r = { t: 'union', l: r, r: parseConcat() }; }
    return r;
  }
  function parseConcat() {
    let r = parseQuant();
    while (pos < re.length && re[pos] !== '|' && re[pos] !== ')') { r = { t: 'cat', l: r, r: parseQuant() }; }
    return r;
  }
  function parseQuant() {
    let r = parseAtom();
    while (pos < re.length) {
      if ('*+?'.includes(re[pos])) { const q = re[pos++]; r = { t: q === '*' ? 'star' : q === '+' ? 'plus' : 'opt', c: r }; }
      else if (re[pos] === '{') {
        pos++; let numStr = '';
        while (pos < re.length && /\d/.test(re[pos])) numStr += re[pos++];
        if (!numStr) throw new Error('Expected digit in {n,m}');
        const n = parseInt(numStr);
        let m = n;
        if (pos < re.length && re[pos] === ',') {
          pos++; numStr = '';
          while (pos < re.length && /\d/.test(re[pos])) numStr += re[pos++];
          m = numStr ? parseInt(numStr) : Infinity;
        }
        if (pos >= re.length || re[pos] !== '}') throw new Error("Expected '}'");
        pos++;
        r = { t: 'bound', c: r, min: n, max: m };
      } else break;
    }
    return r;
  }
  function parseAtom() {
    if (pos >= re.length) throw new Error('Unexpected end');
    if (re[pos] === '(') { pos++; const r = parseUnion(); if (re[pos] !== ')') throw new Error("Expected ')'"); pos++; return r; }
    if (re[pos] === App.config.sym.eps) { pos++; return { t: 'eps' }; }
    if (re[pos] === '[') {
      pos++; const neg = re[pos] === '^' ? (pos++, true) : false; const chars = new Set();
      while (pos < re.length && re[pos] !== ']') {
        const c = re[pos++];
        if (pos < re.length && re[pos] === '-' && re[pos + 1] !== ']') {
          pos++;
          const end = re[pos++];
          for (let i = c.charCodeAt(0); i <= end.charCodeAt(0); i++) chars.add(String.fromCharCode(i));
        } else chars.add(c);
      }
      if (pos >= re.length) throw new Error("Expected ']'");
      pos++;
      return { t: 'class', chars: [...chars], neg };
    }
    return { t: 'lit', ch: re[pos++] };
  }
  return parseUnion();
}
function buildThompson(ast) {
  switch (ast.t) {
    case 'lit': { const s = tnew(), e = tnew(); return { states: [s, e], trans: [{ from: s, sym: ast.ch, to: e }], start: s, accept: e }; }
    case 'eps': { const s = tnew(), e = tnew(); return { states: [s, e], trans: [{ from: s, sym: App.config.sym.eps, to: e }], start: s, accept: e }; }
    case 'class': {
      const chars = ast.neg ? getAllChars().filter(c => !ast.chars.includes(c)) : ast.chars;
      if (chars.length === 0) throw new Error('Empty character class');
      if (chars.length === 1) return buildThompson({ t: 'lit', ch: chars[0] });
      const unions = chars.map(c => ({ t: 'lit', ch: c })).reduce((a, b) => ({ t: 'union', l: a, r: b }));
      return buildThompson(unions);
    }
    case 'bound': {
      if (ast.min === 0 && ast.max === 1) return buildThompson({ t: 'opt', c: ast.c });
      if (ast.min === 0 && ast.max === Infinity) return buildThompson({ t: 'star', c: ast.c });
      if (ast.min === 1 && ast.max === Infinity) return buildThompson({ t: 'plus', c: ast.c });
      let result = null;
      for (let i = 0; i < ast.min; i++) {
        const copy = JSON.parse(JSON.stringify(ast.c));
        result = result ? buildThompson({ t: 'cat', l: result, r: copy }) : buildThompson(copy);
      }
      if (ast.max > ast.min && ast.max !== Infinity) {
        for (let i = ast.min; i < ast.max; i++) {
          const copy = JSON.parse(JSON.stringify(ast.c));
          const opt = buildThompson({ t: 'opt', c: copy });
          result = result ? buildThompson({ t: 'cat', l: result, r: opt }) : opt;
        }
      }
      if (!result) return buildThompson({ t: 'eps' });
      return result;
    }
    case 'cat': { const L = buildThompson(ast.l), R = buildThompson(ast.r); return { states: [...L.states, ...R.states], trans: [...L.trans, { from: L.accept, sym: App.config.sym.eps, to: R.start }, ...R.trans], start: L.start, accept: R.accept }; }
    case 'union': { const L = buildThompson(ast.l), R = buildThompson(ast.r), s = tnew(), e = tnew(); return { states: [s, ...L.states, ...R.states, e], trans: [{ from: s, sym: App.config.sym.eps, to: L.start }, { from: s, sym: App.config.sym.eps, to: R.start }, ...L.trans, ...R.trans, { from: L.accept, sym: App.config.sym.eps, to: e }, { from: R.accept, sym: App.config.sym.eps, to: e }], start: s, accept: e }; }
    case 'star': { const I = buildThompson(ast.c), s = tnew(), e = tnew(); return { states: [s, ...I.states, e], trans: [{ from: s, sym: App.config.sym.eps, to: I.start }, { from: s, sym: App.config.sym.eps, to: e }, { from: I.accept, sym: App.config.sym.eps, to: I.start }, { from: I.accept, sym: App.config.sym.eps, to: e }, ...I.trans], start: s, accept: e }; }
    case 'plus': { return buildThompson({ t: 'cat', l: JSON.parse(JSON.stringify(ast.c)), r: { t: 'star', c: JSON.parse(JSON.stringify(ast.c)) } }); }
    case 'opt': { return buildThompson({ t: 'union', l: ast.c, r: { t: 'eps' } }); }
    default: throw new Error('Unknown AST node: ' + ast.t);
  }
}
function getAllChars() {
  const chars = new Set();
  for (let i = 32; i <= 126; i++) chars.add(String.fromCharCode(i));
  return [...chars];
}

function loadThompsonNFA() {
  const d = App._lastThompson; if (!d) return;
  snapshot();
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null; App.stateN = 0; App.transN = 0;
  App.machine = 'ε-NFA'; setMachine('ε-NFA');
  const nameMap = {};
  d.states.forEach((s, i) => {
    const id = 's' + (i + 1); App.stateN = i + 1; nameMap[s] = id;
    const cols = Math.ceil(Math.sqrt(d.states.length)) + 1;
    App.states.push({ id, x: 100 + (i % cols) * 130, y: 100 + Math.floor(i / cols) * 120, name: s });
    if (s === d.start) App.startId = id;
    if (s === d.accept) App.accepts.add(id);
  });
  d.trans.forEach((t, i) => {
    App.transN = i + 1;
    App.transitions.push({ id: 't' + (i + 1), from: nameMap[t.from], to: nameMap[t.to], symbol: t.sym });
  });
  // Update sigma
  d.trans.forEach(t => { if (t.sym !== App.config.sym.eps) App.sigma.add(t.sym); });
  renderSigma(); renderAll(); updateSidebar(); updateRPanel();
  setView('build'); showStatus('NFA loaded from Thompson\'s construction!');
}

// --- NFA → Regex ---
function algoNFA2RE(c) {
  c.innerHTML = `<div class="algo-title">NFA → Regular Expression</div>
<div class="algo-sub">GNFA STATE ELIMINATION METHOD</div>
<div class="info-box">Convert the NFA to a <em>Generalized NFA (GNFA)</em> with a new start and accept state, then eliminate states one by one, merging their transitions into regular expressions on edges.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }
  const rex = deriveRegex();
  c.innerHTML += `<div class="card"><div class="card-title">Derived Regular Expression</div>
<div style="font-size:1.1rem;color:var(--gold);padding:12px;background:var(--bg3);border-radius:6px;word-break:break-all;">${rex}</div></div>`;
  if (App.machine === 'PDA') { c.innerHTML += '<div class="card" style="color:var(--text2)">Note: PDA recognizes CFLs, not regular languages. The regex shown is derived from NFA/DFA states only.</div>'; }
}

// --- ε-NFA to NFA ---
function algoEpsNFA2NFA(c) {
  c.innerHTML = `<div class="algo-title">ε-NFA → NFA</div>
<div class="algo-sub">EPSILON CLOSURE REMOVAL</div>
<div class="info-box">Replace each ε-closure of a state with direct transitions. A state becomes accepting if its ε-closure contains an accept state.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }
  const syms = [...App.sigma];
  const rows = App.states.map(s => {
    const cl = epsClosure(new Set([s.id]));
    const clNames = [...cl].map(id => getState(id)?.name).join(',');
    const isAcc = [...cl].some(id => App.accepts.has(id));
    const cells = syms.map(sym => {
      let nx = new Set();
      cl.forEach(sid => App.transitions.filter(t => t.from === sid && t.symbol === sym).forEach(t => nx.add(t.to)));
      nx = epsClosure(nx);
      return `<td>{${[...nx].map(id => getState(id)?.name).join(',') || '∅'}}</td>`;
    }).join('');
    return `<tr><td class="${isAcc ? 'acc-cell' : ''}">${s.name} [ε*={${clNames}}]</td>${cells}</tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">New NFA (ε-transitions removed)</div>
<div class="subset-table-wrap"><table class="result-table"><thead><tr><th>State + ε-closure</th>${syms.map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// --- DFA Complement ---
function algoComplement(c) {
  c.innerHTML = `<div class="algo-title">DFA Complement</div>
<div class="algo-sub">CLOSURE UNDER COMPLEMENT</div>
<div class="info-box">The complement of a DFA is obtained by <em>swapping accept and non-accept states</em>. First, ensure the DFA is complete (add a dead/trap state if needed).</div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card">Switch to DFA mode.</div>'; return; }
  const comp = App.states.map(s => ({ ...s, accept: !App.accepts.has(s.id) }));
  const html = comp.map(s => `<div class="state-pill ${s.accept ? 'acc' : ''}">${s.name} → ${s.accept ? 'ACCEPT' : 'REJECT'}</div>`).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Complemented States</div><div class="nfa-result-states">${html}</div>
<div style="font-size:.7rem;color:var(--text2);margin-top:10px">Note: Original accept states become non-accepting and vice versa. All transitions remain the same.</div></div>
<div style="margin-top:8px"><button class="algo-btn" onclick="loadComplement()">Load Complement into Canvas</button></div>`;
}
function loadComplement() {
  snapshot();
  // Complete the DFA first: add trap state for missing transitions (#9)
  const syms = [...App.sigma];
  const needTrap = App.states.some(s => syms.some(sym => !App.transitions.some(t => t.from === s.id && t.symbol === sym)));
  if (needTrap) {
    const trapId = 's' + (++App.stateN);
    App.states.push({ id: trapId, x: 80, y: 80, name: 'trap' });
    // Fill missing transitions for all states (including trap itself)
    App.states.forEach(s => {
      syms.forEach(sym => {
        if (!App.transitions.some(t => t.from === s.id && t.symbol === sym)) {
          App.transitions.push({ id: 't' + (++App.transN), from: s.id, to: trapId, symbol: sym });
        }
      });
    });
  }
  // Swap accept / non-accept
  const newAcc = new Set(App.states.filter(s => !App.accepts.has(s.id)).map(s => s.id));
  App.accepts = newAcc; renderAll(); updateSidebar(); updateRPanel();
  setView('build'); showStatus('Complement loaded (DFA completed with trap state if needed)!');
}

// --- Product Construction ---
function algoProduct(c) {
  c.innerHTML = `<div class="algo-title">Product Construction</div>
<div class="algo-sub">CLOSURE UNDER INTERSECTION AND UNION</div>
<div class="info-box">Given two DFAs M₁ and M₂ over the same alphabet, their <em>product automaton</em> M₁×M₂ simulates both simultaneously. States are pairs (q₁,q₂). Used to prove closure under ∩ (both accept) and ∪ (either accepts).</div>
<div class="card"><div class="card-title">Algorithm</div>
<div class="step-list">
  ${['States: Q₁×Q₂ (pairs of states from each DFA)', 'Start state: (q₀¹, q₀²)', 'Transitions: δ((p,q),a) = (δ₁(p,a), δ₂(q,a))', 'Accept (Intersection): (p,q)∈F iff p∈F₁ AND q∈F₂', 'Accept (Union): (p,q)∈F iff p∈F₁ OR q∈F₂', 'Accept (Difference L₁\\L₂): p∈F₁ AND q∉F₂'].map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')}
</div></div>`;
}

// --- DFA Equivalence ---
function algoEquiv(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂ saved: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂ saved</span>`;
  c.innerHTML = `<div class="algo-title">DFA Equivalence</div>
<div class="algo-sub">ARE TWO DFAs EQUIVALENT?</div>
<div class="info-box">Two DFAs are equivalent iff they accept exactly the same language. We check equivalence by minimizing both and comparing, or by running the product construction on their symmetric difference (L₁△L₂ = ∅).</div>
<div class="card">
  <div class="card-title">Method A: String Testing</div>
  <div style="font-size:.72rem;color:var(--text2);line-height:1.8">
    Test if a specific string is accepted:
  </div>
  <div class="row" style="margin-top:10px">
    <input class="inp" id="eq-str" placeholder="Enter a test string">
    <button class="algo-btn" onclick="testEquivStr()">Test</button>
  </div>
  <div id="eq-result" style="margin-top:8px"></div>
</div>
<div class="card">
  <div class="card-title">Method B: Product Construction (L₁△L₂ = ∅)</div>
  <div style="font-size:.72rem;color:var(--text2);line-height:1.8;margin-bottom:10px">
    L₁ = L₂ iff their symmetric difference is empty.<br>
    Load a second automaton as M₂, then run the check.<br>
    M₂ status: ${m2status}
  </div>
  <button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button>
  <button class="algo-btn sec" onclick="runProductEquiv()">Check Equivalence via Product</button>
  <div id="eq-product-result" style="margin-top:8px"></div>
</div>`;
}
function testEquivStr() {
  const str = $('eq-str').value.trim();
  const s = str === App.config.sym.eps ? '' : str;
  const accepted = App.machine === 'DFA' ? testDFA(s) : testNFA(s);
  $('eq-result').innerHTML = `<div style="font-size:.75rem;color:${accepted ? 'var(--green)' : 'var(--red)'}">
"${str}" is ${accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} by the current automaton.</div>`;
}
function runProductEquiv() {
  const out = $('eq-product-result');
  if (!App.workspaceB) { out.innerHTML = '<div class="pump-result fail">Save an M₂ first using the button above.</div>'; return; }
  if (App.machine !== 'DFA') { out.innerHTML = '<div class="pump-result fail">Switch to DFA mode for product construction.</div>'; return; }
  const m1 = getCurrentMachineSnapshot();
  const m2 = App.workspaceB;
  // Build product DFA with symmetric difference accept condition
  const product = buildProductDFA(m1, m2, 'diff');
  // Check if any accept state is reachable
  const reachable = getReachableStatesGeneral(product.startId, product.transitions);
  const hasAccept = product.accepts.some(id => reachable.has(id));
  if (!hasAccept) {
    out.innerHTML = '<div class="pump-result ok">EQUIVALENT ✓ — Symmetric difference is empty. L(M₁) = L(M₂)</div>';
  } else {
    // Try to find a counterexample by BFS
    const cex = findShortestAccepted(product);
    out.innerHTML = `<div class="pump-result fail">NOT EQUIVALENT ✗ — Symmetric difference is non-empty.<br>Distinguishing string: "${cex || '(found)'}"</div>`;
  }
}


// ══════════════════════════════════════════════════════════════════
//  HELPER: REACHABILITY
// ══════════════════════════════════════════════════════════════════
function getReachableStates(startId) {
  if (!startId) return new Set();
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const s = queue.shift();
    App.transitions.filter(t => t.from === s).forEach(t => {
      if (!visited.has(t.to)) { visited.add(t.to); queue.push(t.to); }
    });
  }
  return visited;
}
function getReachableStatesGeneral(startId, transitions) {
  if (!startId) return new Set();
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const s = queue.shift();
    transitions.filter(t => t.from === s).forEach(t => {
      if (!visited.has(t.to)) { visited.add(t.to); queue.push(t.to); }
    });
  }
  return visited;
}
function getCoReachableStates() {
  // States that can reach an accept state — BFS on reversed transitions
  const visited = new Set([...App.accepts]);
  const queue = [...App.accepts];
  while (queue.length) {
    const s = queue.shift();
    App.transitions.filter(t => t.to === s).forEach(t => {
      if (!visited.has(t.from)) { visited.add(t.from); queue.push(t.from); }
    });
  }
  return visited;
}
function hasReachableCycle(stateSet) {
  // DFS cycle detection on subgraph of stateSet
  const states = [...stateSet];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  states.forEach(s => color[s] = WHITE);
  function dfs(u) {
    color[u] = GRAY;
    const neighbors = App.transitions.filter(t => t.from === u && stateSet.has(t.to)).map(t => t.to);
    for (const v of neighbors) {
      if (color[v] === GRAY) return true; // back edge = cycle
      if (color[v] === WHITE && dfs(v)) return true;
    }
    color[u] = BLACK;
    return false;
  }
  for (const s of states) { if (color[s] === WHITE && dfs(s)) return true; }
  return false;
}
function findShortestAccepted(machine) {
  // BFS on machine to find shortest accepted string
  if (!machine.startId) return null;
  const queue = [{ state: machine.startId, str: '' }];
  const visited = new Set([machine.startId]);
  while (queue.length) {
    const { state, str } = queue.shift();
    if (machine.accepts.includes ? machine.accepts.includes(state) : machine.accepts.has(state)) return str;
    const syms = machine.sigma || [...App.sigma];
    for (const sym of syms) {
      const t = machine.transitions.find(tr => tr.from === state && tr.symbol === sym);
      if (t && !visited.has(t.to)) {
        visited.add(t.to);
        queue.push({ state: t.to, str: str + sym });
        if (str.length > 25) return str + sym; // safety limit
      }
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  DECISION ALGORITHMS
// ══════════════════════════════════════════════════════════════════
function algoIsEmpty(c) {
  c.innerHTML = `<div class="algo-title">Is L(M) Empty?</div>
<div class="algo-sub">REACHABILITY FROM START STATE</div>
<div class="info-box">A language is empty iff no accept state is reachable from the start state via BFS/DFS on the transition graph.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card dec-card-empty">No start state defined.</div>'; return; }
  const reachable = getReachableStates(App.startId);
  const reachableAccepts = [...App.accepts].filter(id => reachable.has(id));
  const isEmpty = reachableAccepts.length === 0;
  const pillsHtml = [...reachable].map(id => {
    const s = getState(id);
    const cls = App.accepts.has(id) ? 'acc' : App.startId === id ? 'start' : '';
    return `<div class="state-pill ${cls}">${s?.name || id}${App.accepts.has(id) ? ' ★' : ''}</div>`;
  }).join('');
  c.innerHTML += `<div class="card ${isEmpty ? 'dec-card-empty' : 'dec-card-nonempty'}">
<div class="card-title">Reachable States (${reachable.size} of ${App.states.length})</div>
<div class="nfa-result-states">${pillsHtml || '<span style="color:var(--text3)">None</span>'}</div>
</div>`;
  c.innerHTML += `<div class="card ${isEmpty ? 'dec-card-empty' : 'dec-card-nonempty'}">
<div style="font-family:var(--serif);font-size:1.2rem;font-weight:600;color:${isEmpty ? 'var(--red)' : 'var(--green)'}">
  ${isEmpty ? 'EMPTY ∅' : 'NON-EMPTY ✓'}
</div>
<div style="font-size:.72rem;color:var(--text2);margin-top:8px">
  ${isEmpty ? 'No accept state is reachable from the start → L(M) = ∅' : `Accept states reachable: {${reachableAccepts.map(id => getState(id)?.name).join(', ')}}`}
</div>
</div>`;
}

function algoIsFinite(c) {
  c.innerHTML = `<div class="algo-title">Is L(M) Finite?</div>
<div class="algo-sub">CYCLE DETECTION ON USEFUL STATES</div>
<div class="info-box">A regular language is finite iff the minimal DFA for it has no cycles among "useful" states (reachable from start AND can reach an accept state). Equivalently: the shortest/longest accepted string has bounded length.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }
  const fwd = getReachableStates(App.startId);
  const bwd = getCoReachableStates();
  const useful = new Set([...fwd].filter(id => bwd.has(id)));
  const hasCycle = hasReachableCycle(useful);
  const isFinite = !hasCycle;
  const usefulPills = [...useful].map(id => {
    const s = getState(id); const cls = App.accepts.has(id) ? 'acc' : App.startId === id ? 'start' : '';
    return `<div class="state-pill ${cls}">${s?.name || id}</div>`;
  }).join('');
  c.innerHTML += `<div class="card">
<div class="card-title">Useful States (reachable from start AND can reach accept): ${useful.size}</div>
<div class="nfa-result-states">${usefulPills || '<span style="color:var(--text3)">None (language is empty)</span>'}</div>
</div>`;
  c.innerHTML += `<div class="card ${isFinite ? 'dec-card-finite' : 'dec-card-infinite'}">
<div style="font-family:var(--serif);font-size:1.2rem;font-weight:600;color:${isFinite ? 'var(--green)' : 'var(--orange)'}">
  ${isFinite ? 'FINITE ✓' : 'INFINITE ∞'}
</div>
<div style="font-size:.72rem;color:var(--text2);margin-top:8px">
  ${isFinite ? 'No cycles among useful states → L(M) is a finite set of strings.' : 'There is a cycle among useful states → L(M) contains infinitely many strings (due to the cycle allowing repetition).'}
</div>
</div>`;
}

function algoIsUniversal(c) {
  c.innerHTML = `<div class="algo-title">Is L(M) Universal?</div>
<div class="algo-sub">L(M) = Σ* ? (DFA ONLY)</div>
<div class="info-box">A DFA accepts Σ* iff its complement accepts ∅. Complement the DFA (swap accepts/non-accepts, add trap state for missing transitions), then check if the complement's language is empty.</div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card dec-card-notuniversal">Switch to DFA mode to check universality.</div>'; return; }
  if (!App.startId) { c.innerHTML += '<div class="card dec-card-notuniversal">No start state defined.</div>'; return; }
  // Build completed DFA (add trap state for missing transitions)
  const syms = [...App.sigma];
  const trapId = '__trap__';
  const allStates = [...App.states.map(s => s.id), trapId];
  // Build complement: swap accepts, complete DFA
  // Check if all states are accepting in original (then universe)
  const completedTrans = [];
  App.states.forEach(s => {
    syms.forEach(sym => {
      const hasT = App.transitions.some(t => t.from === s.id && t.symbol === sym);
      if (!hasT) completedTrans.push({ from: s.id, to: trapId, symbol: sym });
    });
  });
  // Complement: non-accepts become accepts
  const compAccepts = new Set(App.states.filter(s => !App.accepts.has(s.id)).map(s => s.id));
  compAccepts.add(trapId); // trap is non-accepting in original, so accepting in complement
  const allTrans = [...App.transitions, ...completedTrans];
  // BFS to find if any comp accept state is reachable
  const compReachable = new Set([App.startId]);
  const queue = [App.startId];
  while (queue.length) {
    const st = queue.shift();
    allTrans.filter(t => t.from === st).forEach(t => {
      if (!compReachable.has(t.to)) { compReachable.add(t.to); queue.push(t.to); }
    });
  }
  const compAccReachable = [...compAccepts].filter(id => compReachable.has(id));
  const isUniversal = compAccReachable.length === 0;
  c.innerHTML += `<div class="card">
<div class="card-title">Complement Analysis</div>
<div style="font-size:.72rem;color:var(--text2);line-height:1.8">
  Added ${completedTrans.length} trap transitions.<br>
  Complement accept states (non-original-accept): {${[...compAccepts].filter(id => id !== trapId).map(id => getState(id)?.name).join(', ') || '∅'}}${compAccepts.has(trapId) ? (completedTrans.length > 0 ? ' + trap' : '') : ''}<br>
  Reachable complement accept states: ${compAccReachable.length ? '{' + compAccReachable.map(id => id === trapId ? 'trap' : getState(id)?.name).join(',') + '}' : '∅'}
</div>
</div>`;
  c.innerHTML += `<div class="card ${isUniversal ? 'dec-card-universal' : 'dec-card-notuniversal'}">
<div style="font-family:var(--serif);font-size:1.2rem;font-weight:600;color:${isUniversal ? 'var(--green)' : 'var(--red)'}">
  ${isUniversal ? 'UNIVERSAL ✓  L(M) = Σ*' : 'NOT UNIVERSAL ✗  L(M) ≠ Σ*'}
</div>
<div style="font-size:.72rem;color:var(--text2);margin-top:8px">
  ${isUniversal ? 'Complement DFA has empty language → original DFA accepts everything.' : 'Complement DFA is non-empty → some strings are rejected.'}
</div>
</div>`;
}

function algoFullEquiv(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂ saved: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂ saved</span>`;
  c.innerHTML = `<div class="algo-title">Full Equivalence Check</div>
<div class="algo-sub">L(M₁) = L(M₂) VIA SYMMETRIC DIFFERENCE</div>
<div class="info-box">Two automata are equivalent iff their symmetric difference L(M₁)△L(M₂) = ∅.
Build the product DFA with accept condition: (p,q) accepts iff exactly one of p, q is accepting. Then check emptiness.</div>
<div class="card">
<div class="card-title">M₂ Status: ${m2status}</div>
<button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button>
<button class="ws-save-btn" onclick="loadWorkspaceB()">Restore M₂ to Canvas</button>
</div>`;
  if (!App.workspaceB) {
    c.innerHTML += `<div class="card dec-card-empty">
  <div style="font-size:.72rem;color:var(--text2);line-height:1.8">
    To check equivalence:<br>
    1. Build your first machine (M₁) in the Build view<br>
    2. Come back here and click "Save Current as M₂"<br>
    3. Go back to Build view and build your second machine (M₂... well, load/build M₁ actually — confusing naming! Load machine M₁ here as current, save M₂ there)<br>
    4. Come back and click "Run Equivalence Check"
  </div>
</div>`;
    return;
  }
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="runFullEquivCheck()">Run Equivalence Check</button></div>
<div id="full-equiv-result" style="margin-top:12px"></div>`;
}

function runFullEquivCheck() {
  const out = $('full-equiv-result');
  if (!App.workspaceB) { out.innerHTML = '<div class="pump-result fail">Save M₂ first.</div>'; return; }
  if (App.machine !== 'DFA') { out.innerHTML = '<div class="pump-result fail">Switch to DFA mode for product construction.</div>'; return; }
  const m1 = getCurrentMachineSnapshot();
  const m2 = App.workspaceB;
  const product = buildProductDFA(m1, m2, 'diff');
  const reachable = getReachableStatesGeneral(product.startId, product.transitions);
  const hasAccept = product.accepts.some(id => reachable.has(id));
  if (!hasAccept) {
    out.innerHTML = `<div class="pump-result ok">EQUIVALENT ✓ — L(M₁) = L(M₂)<br>The symmetric difference DFA is empty.</div>`;
  } else {
    const cex = findShortestAccepted(product);
    out.innerHTML = `<div class="pump-result fail">NOT EQUIVALENT ✗ — L(M₁) ≠ L(M₂)<br>Distinguishing string: "${cex || '(found, too long to display)'}"</div>
<div class="card" style="margin-top:8px"><div class="card-title">Symmetric Difference Product DFA</div>
<div style="font-size:.7rem;color:var(--text2)">
  Product states: ${product.states.length}<br>
  Product accept states (distinguishing): ${product.accepts.filter(id => reachable.has(id)).length}<br>
  Accept condition: exactly one of the component states is accepting
</div></div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
//  PRODUCT DFA BUILDER
// ══════════════════════════════════════════════════════════════════
function buildProductDFA(m1, m2, mode) {
  // mode: 'intersection' | 'union' | 'diff' (symmetric difference)
  const sigma = [...new Set([...(m1.sigma || []), ...(m2.sigma || [])])];
  const trapId1 = '__trap1__', trapId2 = '__trap2__';
  const m1acc = new Set(m1.accepts);
  const m2acc = new Set(m2.accepts);
  function delta1(state, sym) {
    if (state === trapId1) return trapId1;
    const t = m1.transitions.find(tr => tr.from === state && tr.symbol === sym);
    return t ? t.to : trapId1;
  }
  function delta2(state, sym) {
    if (state === trapId2) return trapId2;
    const t = m2.transitions.find(tr => tr.from === state && tr.symbol === sym);
    return t ? t.to : trapId2;
  }
  function isAccept(s1, s2) {
    const a1 = s1 !== trapId1 && m1acc.has(s1);
    const a2 = s2 !== trapId2 && m2acc.has(s2);
    if (mode === 'intersection') return a1 && a2;
    if (mode === 'union') return a1 || a2;
    if (mode === 'diff') return (a1 && !a2) || (!a1 && a2); // symmetric diff
    return false;
  }
  const startPair = `${m1.startId}|${m2.startId}`;
  const states = [], transitions = [], accepts = [];
  const visited = new Map([[startPair, startPair]]);
  const queue = [[m1.startId, m2.startId]];
  while (queue.length) {
    const [s1, s2] = queue.shift();
    const pid = `${s1}|${s2}`;
    states.push({ id: pid, name: `(${s1},${s2})` });
    if (isAccept(s1, s2)) accepts.push(pid);
    sigma.forEach(sym => {
      const n1 = delta1(s1, sym), n2 = delta2(s2, sym);
      const nid = `${n1}|${n2}`;
      transitions.push({ id: `t_${pid}_${sym}`, from: pid, to: nid, symbol: sym });
      if (!visited.has(nid)) { visited.set(nid, nid); queue.push([n1, n2]); }
    });
  }
  return { states, transitions, startId: startPair, accepts, sigma };
}

// ══════════════════════════════════════════════════════════════════
//  CLOSURE OPERATIONS
// ══════════════════════════════════════════════════════════════════
function m2RequiredCard(c, opName) {
  const haM2 = !!App.workspaceB;
  if (!haM2) {
    c.innerHTML += `<div class="card dec-card-empty">
  <div class="card-title">M₂ Required for ${opName}</div>
  <div style="font-size:.72rem;color:var(--text2);line-height:1.8;margin-bottom:10px">
    First save your M₂:<br>
    1. Go to Build view and build/load your second machine<br>
    2. Come back to Algorithms and click the button below<br>
    3. Then load the first machine and come back here
  </div>
  <button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button>
</div>`;
    return false;
  }
  return true;
}

function algoClopStar(c) {
  c.innerHTML = `<div class="algo-title">Kleene Star (NFA Construction)</div>
<div class="algo-sub">L* = {ε} ∪ L ∪ LL ∪ LLL ∪ ...</div>
<div class="info-box">To build NFA for L*:<br>
1. Add new start state q_new (also accepting, for ε)<br>
2. Add ε-transition from q_new to original start<br>
3. Add ε-transitions from each original accept back to original start<br>
4. q_new is the only accept state (plus original accepts remain accepting)</div>`;
  if (!App.startId || !App.states.length) { c.innerHTML += '<div class="card">Build an automaton first.</div>'; return; }
  const m = getCurrentMachineSnapshot();
  const result = buildNFAStar(m);
  const html = renderBuiltNFAResult(result, 'Kleene Star NFA');
  c.innerHTML += html;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadBuiltNFAResult('star')">Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'star', machine: result };
}

function algoClopReversal(c) {
  c.innerHTML = `<div class="algo-title">Reversal (NFA Construction)</div>
<div class="algo-sub">L^R = {w^R : w ∈ L}</div>
<div class="info-box">To build NFA for L^R:<br>
1. Reverse all transitions (swap from/to)<br>
2. Swap start and accept states (new start = old accepts, new accept = old start)<br>
3. If multiple old accepts, add new start with ε to each</div>`;
  if (!App.startId || !App.states.length) { c.innerHTML += '<div class="card">Build an automaton first.</div>'; return; }
  const m = getCurrentMachineSnapshot();
  const result = buildNFAReversal(m);
  const html = renderBuiltNFAResult(result, 'Reversal NFA');
  c.innerHTML += html;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadBuiltNFAResult('reversal')">Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'reversal', machine: result };
}

function algoClopUnion(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂</span>`;
  c.innerHTML = `<div class="algo-title">Union with M₂ (NFA Construction)</div>
<div class="algo-sub">L(M₁) ∪ L(M₂)</div>
<div class="info-box">Add a new start state with ε-transitions to both original start states. Both original accept states remain accepting.</div>
<div class="card"><div class="card-title">M₂ Status: ${m2status}</div>
<button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button></div>`;
  if (!m2RequiredCard(c, 'Union')) return;
  if (!App.startId) { c.innerHTML += '<div class="card">Build M₁ in Build view first.</div>'; return; }
  const m1 = getCurrentMachineSnapshot(), m2 = App.workspaceB;
  const result = buildNFAUnion(m1, m2);
  c.innerHTML += renderBuiltNFAResult(result, 'Union NFA');
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadBuiltNFAResult('union')">Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'union', machine: result };
}

function algoClopIntersect(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂</span>`;
  c.innerHTML = `<div class="algo-title">Intersection with M₂ (Product DFA)</div>
<div class="algo-sub">L(M₁) ∩ L(M₂)</div>
<div class="info-box">Build the product DFA: states are pairs (q₁, q₂). Accept iff BOTH component states are accepting.</div>
<div class="card"><div class="card-title">M₂ Status: ${m2status}</div>
<button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button></div>`;
  if (!m2RequiredCard(c, 'Intersection')) return;
  if (!App.startId) { c.innerHTML += '<div class="card">Build M₁ in Build view first.</div>'; return; }
  const m1 = getCurrentMachineSnapshot(), m2 = App.workspaceB;
  const product = buildProductDFA(m1, m2, 'intersection');
  const reachable = getReachableStatesGeneral(product.startId, product.transitions);
  const reachableStates = product.states.filter(s => reachable.has(s.id));
  const thead = `<tr><th>Product State</th><th>Accepting?</th></tr>`;
  const rows = reachableStates.slice(0, 20).map(s =>
    `<tr><td class="${product.accepts.includes(s.id) ? 'acc-cell' : ''}">${s.name}</td><td>${product.accepts.includes(s.id) ? '✓ Yes' : 'No'}</td></tr>`
  ).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Product DFA States (showing up to 20 reachable)</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>
<div style="font-size:.68rem;color:var(--text3);margin-top:8px">${product.states.length} total product states, ${reachableStates.length} reachable</div>
</div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadBuiltNFAResult('intersect')">Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'intersect', machine: product };
}

function algoClopConcat(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂</span>`;
  c.innerHTML = `<div class="algo-title">Concatenation with M₂ (NFA Construction)</div>
<div class="algo-sub">L(M₁) · L(M₂)</div>
<div class="info-box">Add ε-transitions from each M₁ accept state to M₂'s start state. M₁'s accept states become non-accepting; M₂'s accept states are the result's accept states.</div>
<div class="card"><div class="card-title">M₂ Status: ${m2status}</div>
<button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button></div>`;
  if (!m2RequiredCard(c, 'Concatenation')) return;
  if (!App.startId) { c.innerHTML += '<div class="card">Build M₁ in Build view first.</div>'; return; }
  const m1 = getCurrentMachineSnapshot(), m2 = App.workspaceB;
  const result = buildNFAConcat(m1, m2);
  c.innerHTML += renderBuiltNFAResult(result, 'Concatenation NFA');
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadBuiltNFAResult('concat')">Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'concat', machine: result };
}

function loadBuiltNFAResult(key) {
  if (!App._lastBuiltNFA || App._lastBuiltNFA.key !== key) { showStatus('Run the algorithm first.'); return; }
  const m = App._lastBuiltNFA.machine;
  loadBuiltMachine(m, 'ε-NFA');
}

function renderBuiltNFAResult(m, title) {
  const states = m.states || [];
  const trans = m.transitions || [];
  const accepts = m.accepts || [];
  const pillsHtml = states.map(s => {
    const isAcc = accepts.includes ? accepts.includes(s.id) : accepts.has(s.id);
    const isStart = s.id === m.startId;
    return `<div class="state-pill ${isAcc ? 'acc' : isStart ? 'start' : ''}">${s.name || s.id}${isStart ? ' (start)' : ''}${isAcc ? ' ★' : ''}</div>`;
  }).join('');
  const rows = trans.slice(0, 30).map(t => {
    const fn = states.find(s => s.id === t.from)?.name || t.from;
    const tn = states.find(s => s.id === t.to)?.name || t.to;
    return `<tr><td>${fn}</td><td>${t.symbol}</td><td>${tn}</td></tr>`;
  }).join('');
  return `<div class="card"><div class="card-title">${title}: ${states.length} states, ${trans.length} transitions</div>
<div class="nfa-result-states" style="margin-bottom:10px">${pillsHtml}</div>
<div class="subset-table-wrap"><table class="result-table"><thead><tr><th>From</th><th>Symbol</th><th>To</th></tr></thead><tbody>${rows}${trans.length > 30 ? '<tr><td colspan="3" class="dead-cell">... ' + (trans.length - 30) + ' more</td></tr>' : ''}</tbody></table></div>
</div>`;
}

// ──── NFA Builders ────
function buildNFAStar(machine) {
  const prefix = 'star_';
  const states = machine.states.map(s => ({ id: prefix + s.id, name: s.name }));
  const newStart = { id: 'star_q_new', name: 'q_s' };
  states.unshift(newStart);
  // Only the new start state is accepting (Thompson's: it doubles as new accept) (#5)
  const accepts = [newStart.id];
  const transitions = machine.transitions.map(t => ({ ...t, id: prefix + t.id, from: prefix + t.from, to: prefix + t.to }));
  // ε from new start to original start
  transitions.push({ id: 'star_e1', from: newStart.id, to: prefix + machine.startId, symbol: App.config.sym.eps });
  // ε from each original accept back to original start (for looping) (#11)
  machine.accepts.forEach((id, i) => {
    transitions.push({ id: `star_loop_${i}`, from: prefix + id, to: prefix + machine.startId, symbol: App.config.sym.eps });
  });
  // ε from each original accept to new start (to reach the accept state) (#11)
  machine.accepts.forEach((id, i) => {
    transitions.push({ id: `star_acc_${i}`, from: prefix + id, to: newStart.id, symbol: App.config.sym.eps });
  });
  return { states, transitions, startId: newStart.id, accepts, sigma: machine.sigma };
}

function buildNFAReversal(machine) {
  const prefix = 'rev_';
  const states = machine.states.map(s => ({ id: prefix + s.id, name: s.name + '^R' }));
  // Reverse all transitions
  const transitions = machine.transitions.map(t => ({ ...t, id: prefix + t.id, from: prefix + t.to, to: prefix + t.from }));
  // New start = collect of old accepts; new accepts = old start
  let startId, newAccepts;
  if (machine.accepts.length === 1) {
    startId = prefix + machine.accepts[0];
    newAccepts = [prefix + machine.startId];
  } else {
    // Multiple old accepts: add new super-start
    const superStart = { id: 'rev_super_start', name: 'q_r' };
    states.unshift(superStart);
    machine.accepts.forEach((id, i) => {
      transitions.push({ id: `rev_es_${i}`, from: superStart.id, to: prefix + id, symbol: App.config.sym.eps });
    });
    startId = superStart.id;
    newAccepts = [prefix + machine.startId];
  }
  return { states, transitions, startId, accepts: newAccepts, sigma: machine.sigma };
}

function buildNFAUnion(m1, m2) {
  const p1 = 'u1_', p2 = 'u2_';
  const states = [
    { id: 'union_start', name: 'q_u' },
    ...m1.states.map(s => ({ id: p1 + s.id, name: 'M1_' + s.name })),
    ...m2.states.map(s => ({ id: p2 + s.id, name: 'M2_' + s.name })),
  ];
  const transitions = [
    { id: 'u_e1', from: 'union_start', to: p1 + m1.startId, symbol: App.config.sym.eps },
    { id: 'u_e2', from: 'union_start', to: p2 + m2.startId, symbol: App.config.sym.eps },
    ...m1.transitions.map(t => ({ ...t, id: p1 + t.id, from: p1 + t.from, to: p1 + t.to })),
    ...m2.transitions.map(t => ({ ...t, id: p2 + t.id, from: p2 + t.from, to: p2 + t.to })),
  ];
  const accepts = [
    ...m1.accepts.map(id => p1 + id),
    ...m2.accepts.map(id => p2 + id),
  ];
  return { states, transitions, startId: 'union_start', accepts, sigma: [...new Set([...(m1.sigma || []), ...(m2.sigma || [])])] };
}

function buildNFAConcat(m1, m2) {
  const p1 = 'c1_', p2 = 'c2_';
  const states = [
    ...m1.states.map(s => ({ id: p1 + s.id, name: 'M1_' + s.name })),
    ...m2.states.map(s => ({ id: p2 + s.id, name: 'M2_' + s.name })),
  ];
  const transitions = [
    ...m1.transitions.map(t => ({ ...t, id: p1 + t.id, from: p1 + t.from, to: p1 + t.to })),
    ...m2.transitions.map(t => ({ ...t, id: p2 + t.id, from: p2 + t.from, to: p2 + t.to })),
    // ε from each M1 accept to M2 start
    ...m1.accepts.map((id, i) => ({ id: `c_e_${i}`, from: p1 + id, to: p2 + m2.startId, symbol: App.config.sym.eps })),
  ];
  const accepts = m2.accepts.map(id => p2 + id);
  return { states, transitions, startId: p1 + m1.startId, accepts, sigma: [...new Set([...(m1.sigma || []), ...(m2.sigma || [])])] };
}

// ══════════════════════════════════════════════════════════════════
//  NFA COMPUTATION TREE
// ══════════════════════════════════════════════════════════════════
function algoNFATree(c) {
  c.innerHTML = `<div class="algo-title">NFA Computation Tree</div>
<div class="algo-sub">ALL EXECUTION PATHS FOR A STRING</div>
<div class="info-box">Shows all possible computation branches of the NFA when reading an input string. Each level corresponds to reading one symbol. Branches split at nondeterministic choices. ε-closures are computed at each step.</div>
<div class="card">
  <div class="card-title">Input String</div>
  <div class="regex-input-wrap">
    <input class="inp" id="nfa-tree-input" placeholder="e.g. ab or 010" onkeydown="if(event.key==='Enter')buildNFATree()">
    <button class="algo-btn" onclick="buildNFATree()">Build Tree</button>
  </div>
</div>
<div id="nfa-tree-result"></div>`;
}

function buildNFATree() {
  const str = $('nfa-tree-input').value;
  const s = str === App.config.sym.eps ? '' : str;
  const out = $('nfa-tree-result');
  if (!App.startId) { out.innerHTML = '<div class="card">No start state defined.</div>'; return; }

  // Validate input against alphabet (Sigma)
  const invalidChars = [...s].filter(c => !App.sigma.has(c));
  if (invalidChars.length > 0) {
    out.innerHTML = `<div class="card" style="border-left-color:var(--red);  font-size:.72rem;"><span style="color:var(--red);font-weight:600">Error:</span> Input sequence must be an element of Σ*. Found invalid characters: "${[...new Set(invalidChars)].join('", "')}"</div>`;
    return;
  }

  const tree = computeNFATree(s);
  out.innerHTML = layoutNFATree(tree, s);
}

function computeNFATree(str) {
  // Build a true per-state nondeterministic computation tree (#4)
  const MAX_NODES = 500; let nodeCount = 0;
  function makeNode(stateId, depth, sym) {
    nodeCount++;
    const sName = getState(stateId)?.name || stateId;
    const isAccept = App.accepts.has(stateId);
    const children = [];
    if (nodeCount < MAX_NODES && depth < str.length) {
      const nextSym = str[depth];
      // Direct transitions on this symbol
      const directTargets = App.transitions.filter(t => t.from === stateId && t.symbol === nextSym);
      directTargets.forEach(t => {
        // For each target, expand ε-closure and create child nodes
        const ecl = epsClosure(new Set([t.to]));
        ecl.forEach(eid => {
          if (nodeCount < MAX_NODES) children.push(makeNode(eid, depth + 1, nextSym));
        });
      });
    }
    return { label: sName, stateId, sym: sym || '', isAccept, isDead: false, depth, children };
  }
  // Start: ε-closure of start state, each becomes a root child
  const initStates = epsClosure(new Set([App.startId]));
  const rootChildren = [...initStates].map(sid => makeNode(sid, 0, ''));
  return { label: 'Start', stateId: null, sym: '', isAccept: false, isDead: false, depth: -1, children: rootChildren, isRoot: true };
}

function layoutNFATree(root, fullStr) {
  const levelH = 65;
  const positions = [];
  let maxX = 0, maxY = 0;

  // Bottom-up width calculation to prevent node overlap
  function calcWidths(node) {
    if (!node.children || !node.children.length) {
      node._w = 60;
      return node._w;
    }
    let sum = 0;
    node.children.forEach(ch => { sum += calcWidths(ch) + 10; });
    node._w = Math.max(60, sum - 10);
    return node._w;
  }

  // Top-down position assignment
  function assign(node, x, y) {
    node._x = x; node._y = y;
    positions.push(node);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (node.children && node.children.length) {
      let curX = x - node._w / 2;
      node.children.forEach(ch => {
        curX += ch._w / 2;
        assign(ch, curX, y + levelH);
        curX += ch._w / 2 + 10;
      });
    }
  }

  calcWidths(root);
  assign(root, root._w / 2 + 30, 30);

  const svgW = maxX + 60, svgH = maxY + 60;
  let edges = '', nodes = '';

  positions.forEach(node => {
    node.children.forEach(ch => {
      // Draw edge 
      edges += `<line x1="${node._x}" y1="${node._y + 15}" x2="${ch._x}" y2="${ch._y - 15}" stroke="var(--border)" stroke-width="1.5" />`;
      // Draw edge symbol
      if (ch.sym) {
        const mx = (node._x + ch._x) / 2;
        const my = (node._y + 15 + ch._y - 15) / 2;
        // background pill for text
        edges += `<rect x="${mx - 8}" y="${my - 8}" width="16" height="16" rx="4" fill="var(--bg2)" />`;
        edges += `<text x="${mx}" y="${my + 3}" fill="var(--gold)" font-family="var(--mono)" font-size="0.75rem" text-anchor="middle">${ch.sym}</text>`;
      }
    });

    const isFinal = node.depth === fullStr.length;
    let stroke = 'var(--accent)';
    let fill = 'var(--bg2)';
    let textCol = 'var(--text)'; // Used to be --text1, which resulted in dark text
    let label = node.label;

    if (node.isRoot) {
      stroke = 'var(--text3)';
      label = 'Start';
      textCol = 'var(--text)';
      node._r = 20;
    } else {
      node._r = 16;
      if (node.isDead) { // died early
        stroke = 'var(--red)'; fill = 'var(--bg3)'; textCol = 'var(--text3)';
      } else if (isFinal) {
        if (node.isAccept) { stroke = 'var(--green)'; fill = '#1a3320'; textCol = 'var(--green)'; }
        else { stroke = 'var(--red)'; fill = '#331a1a'; textCol = 'var(--red)'; }
      }
    }

    // Node circle
    nodes += `<circle cx="${node._x}" cy="${node._y}" r="${node._r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    // Extra ring for accept state
    if (!node.isRoot && node.isAccept && isFinal) {
      nodes += `<circle cx="${node._x}" cy="${node._y}" r="${node._r - 4}" fill="none" stroke="var(--green)" stroke-width="1.5"/>`;
    }
    // Node text
    let displayLabel = label.length > 5 ? '..' : label;
    if (node.isRoot) displayLabel = label;
    nodes += `<text x="${node._x}" y="${node._y + 4}" fill="${textCol}" font-family="var(--mono)" font-size="${node.isRoot ? '0.7rem' : '0.75rem'}" text-anchor="middle">${displayLabel}</text>`;
  });

  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${svgW} ${svgH}" style="min-width:${svgW}px; height:${svgH}px">${edges}${nodes}</svg></div>`;
}

// ══════════════════════════════════════════════════════════════════
//  NDTM SIMULATION
// ══════════════════════════════════════════════════════════════════
function algoNDTM(c) {
  c.innerHTML = `<div class="algo-title">Nondeterministic Turing Machine</div>
<div class="algo-sub">BFS OVER ALL COMPUTATION BRANCHES</div>
<div class="info-box">A NDTM is a TM where δ is a relation: the same (state, symbol) pair may have multiple possible transitions. An NDTM accepts if ANY computation branch reaches an accept state. Equivalent in power to a deterministic TM.</div>`;
  if (App.machine !== 'TM') { c.innerHTML += `<div class="card"><div style="font-size:.72rem;color:var(--text2)">Switch to TM mode to use this simulator.</div></div>`; return; }
  // Show nondeterministic transitions (same state+symbol, multiple outputs)
  const groups = {};
  App.transitions.forEach(t => {
    const k = `${t.from}|${t.symbol}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  const ndTrans = Object.entries(groups).filter(([, ts]) => ts.length > 1);
  const ndHtml = ndTrans.length ? ndTrans.map(([k, ts]) => {
    const [sid, sym] = k.split('|');
    const sn = getState(sid)?.name || sid;
    return `<div class="step-item"><div class="step-num">ND</div><div class="step-text">δ(${sn}, '${sym}') = {${ts.map(t => `(${getState(t.to)?.name}, '${t.write}', ${t.dir})`).join('; ')}}</div></div>`;
  }).join('') : '<div style="color:var(--text3);font-size:.7rem">No nondeterministic transitions found — this TM is deterministic.</div>';
  c.innerHTML += `<div class="card"><div class="card-title">Nondeterministic Transitions (same state+symbol, multiple outputs)</div><div class="step-list">${ndHtml}</div></div>`;
  c.innerHTML += `<div class="card">
<div class="card-title">Simulate NDTM (BFS over all branches)</div>
<div class="regex-input-wrap">
  <input class="inp" id="ndtm-input" placeholder="Input string (e.g. 001)">
  <button class="algo-btn" onclick="runNDTMSim()">Simulate</button>
</div>
<div id="ndtm-result" style="margin-top:8px"></div>
</div>`;
}

function runNDTMSim() {
  const str = $('ndtm-input').value;
  const s = str === App.config.sym.eps ? '' : str;
  const out = $('ndtm-result');
  if (!App.startId) { out.innerHTML = '<div style="color:var(--red);">No start state.</div>'; return; }
  const result = simNDTM(s);
  out.innerHTML = `<div class="pump-result ${result.accepted ? 'ok' : 'fail'}">
${result.accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} — ${result.branches} branches explored, max depth ${result.maxDepth}
</div>
<div class="card" style="margin-top:8px"><div class="card-title">Branch Summary (first 10 branches)</div>
<div class="step-list">${result.log.slice(0, 10).map((l, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${l}</div></div>`).join('')}</div>
</div>`;
}

function simNDTM(str) {
  // BFS over configurations {state, tape, head}
  const init = { state: App.startId, tape: str ? str.split('') : [], head: 0 };
  const queue = [init];
  let branches = 0, maxDepth = 0, accepted = false;
  const log = [];
  const steps = 0;
  while (queue.length && branches < 2000) {
    const cfg = queue.shift();
    const { state, tape, head } = cfg;
    branches++;
    const t = [...tape]; while (t.length <= head) t.push(App.config.sym.blank);
    const sym = t[head];
    const depth = cfg.depth || 0;
    maxDepth = Math.max(maxDepth, depth);
    const idStr = `${t.slice(0, head).join('')}[${getState(state)?.name || state}]${t.slice(head).join('')}`;
    if (App.accepts.has(state)) {
      accepted = true;
      log.push(`Branch ${branches}: ACCEPT — ID: ${idStr}`);
      break;
    }
    if (depth >= 150) { log.push(`Branch ${branches}: cut off (depth 150) — ID: ${idStr}`); continue; }
    const matching = App.transitions.filter(tr => tr.from === state && tr.symbol === sym);
    if (!matching.length) { log.push(`Branch ${branches}: stuck (no transition) — ID: ${idStr}`); continue; }
    matching.forEach(tr => {
      const nt = [...t]; nt[head] = tr.write || sym;
      const nh = head + (tr.dir === 'R' ? 1 : -1);
      queue.push({ state: tr.to, tape: nt, head: Math.max(0, nh), depth: depth + 1 });
    });
    log.push(`Branch ${branches}: read '${sym}' at ${getState(state)?.name}, ${matching.length} choice(s) — ID: ${idStr}`);
  }
  return { accepted, branches, maxDepth, log };
}


// ══════════════════════════════════════════════════════════════════
//  UTM SIMULATOR
// ══════════════════════════════════════════════════════════════════
const UTM_DEFAULT_TM = JSON.stringify({
  "comment": "Accepts {0^n 1^n | n >= 1}",
  "states": ["q0", "q1", "q2", "q3", "q_accept"],
  "start": "q0",
  "accept": ["q_accept"],
  "transitions": [
    { "from": "q0", "read": "0", "write": "X", "dir": "R", "to": "q1" },
    { "from": "q1", "read": "0", "write": "0", "dir": "R", "to": "q1" },
    { "from": "q1", "read": "Y", "write": "Y", "dir": "R", "to": "q1" },
    { "from": "q1", "read": "1", "write": "Y", "dir": "L", "to": "q2" },
    { "from": "q2", "read": "0", "write": "0", "dir": "L", "to": "q2" },
    { "from": "q2", "read": "Y", "write": "Y", "dir": "L", "to": "q2" },
    { "from": "q2", "read": "X", "write": "X", "dir": "R", "to": "q0" },
    { "from": "q0", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
    { "from": "q3", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
    { "from": "q3", "read": "⊔", "write": "⊔", "dir": "R", "to": "q_accept" }
  ]
}, null, 2);

const UTM_EXAMPLES = [
  {
    label: "0ⁿ1ⁿ Recognizer (default)",
    input: "0001111",
    tm: {
      "comment": "Accepts {0^n 1^n | n >= 1}",
      "states": ["q0", "q1", "q2", "q3", "q_accept"],
      "start": "q0",
      "accept": ["q_accept"],
      "transitions": [
        { "from": "q0", "read": "0", "write": "X", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "0", "write": "0", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "Y", "write": "Y", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "1", "write": "Y", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "0", "write": "0", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "Y", "write": "Y", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "X", "write": "X", "dir": "R", "to": "q0" },
        { "from": "q0", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
        { "from": "q3", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
        { "from": "q3", "read": "⊔", "write": "⊔", "dir": "R", "to": "q_accept" }
      ]
    }
  },
  {
    label: "Binary Evenness Checker",
    input: "10110",
    tm: {
      "name": "Binary Evenness Checker",
      "states": ["q0", "q_last_0", "q_last_1", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_last_1", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_1", "read": "1", "dir": "R", "to": "q_last_1" }
      ]
    }
  },
  {
    label: "Binary Oddness Checker",
    input: "10111",
    tm: {
      "name": "Binary Oddness Checker",
      "states": ["q0", "q_last_0", "q_last_1", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_1", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_1", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_1", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Adder (+1)",
    input: "1011",
    tm: {
      "name": "Binary Adder (+1)",
      "states": ["q0", "q_right", "q_carry", "q_rewind", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "⊔", "dir": "L", "to": "q_carry" },
        { "from": "q_carry", "read": "1", "write": "0", "dir": "L", "to": "q_carry" },
        { "from": "q_carry", "read": "0", "write": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_carry", "read": "⊔", "write": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Subtractor (-1)",
    input: "1100",
    tm: {
      "name": "Binary Subtractor (-1)",
      "states": ["q0", "q_right", "q_borrow", "q_rewind", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "⊔", "dir": "L", "to": "q_borrow" },
        { "from": "q_borrow", "read": "0", "write": "1", "dir": "L", "to": "q_borrow" },
        { "from": "q_borrow", "read": "1", "write": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Unary Multiplier",
    input: "11*111",
    tm: {
      "name": "Unary Multiplier",
      "states": ["q0", "q_mark_left", "q_find_right", "q_copy", "q_return_copy", "q_reset_right", "q_return_left", "q_cleanup", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "1", "write": "X", "dir": "R", "to": "q_find_right" },
        { "from": "q0", "read": "*", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_find_right", "read": "1", "dir": "R", "to": "q_find_right" },
        { "from": "q_find_right", "read": "*", "dir": "R", "to": "q_copy" },
        { "from": "q_copy", "read": "1", "write": "Y", "dir": "R", "to": "q_return_copy" },
        { "from": "q_copy", "read": "Y", "dir": "R", "to": "q_copy" },
        { "from": "q_copy", "read": "=", "dir": "R", "to": "q_reset_right" },
        { "from": "q_copy", "read": "⊔", "write": "=", "dir": "L", "to": "q_reset_right" },
        { "from": "q_return_copy", "read": "1", "dir": "R", "to": "q_return_copy" },
        { "from": "q_return_copy", "read": "=", "dir": "R", "to": "q_return_copy" },
        { "from": "q_return_copy", "read": "⊔", "write": "1", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "1", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "=", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "Y", "write": "Y", "dir": "R", "to": "q_copy" },
        { "from": "q_reset_right", "read": "Y", "write": "1", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "*", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "1", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "X", "dir": "R", "to": "q0" },
        { "from": "q_cleanup", "read": "1", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "=", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "X", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Palindrome Checker",
    input: "101101",
    tm: {
      "name": "Binary Palindrome Checker",
      "states": ["q0", "q_scan_right_0", "q_scan_right_1", "q_check_0", "q_check_1", "q_scan_left", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "write": "⊔", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q0", "read": "1", "write": "⊔", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q0", "read": "⊔", "write": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_scan_right_0", "read": "0", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q_scan_right_0", "read": "1", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q_scan_right_0", "read": "⊔", "dir": "L", "to": "q_check_0" },
        { "from": "q_scan_right_1", "read": "0", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q_scan_right_1", "read": "1", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q_scan_right_1", "read": "⊔", "dir": "L", "to": "q_check_1" },
        { "from": "q_check_0", "read": "0", "write": "⊔", "dir": "L", "to": "q_scan_left" },
        { "from": "q_check_0", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_check_1", "read": "1", "write": "⊔", "dir": "L", "to": "q_scan_left" },
        { "from": "q_check_1", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_scan_left", "read": "0", "dir": "L", "to": "q_scan_left" },
        { "from": "q_scan_left", "read": "1", "dir": "L", "to": "q_scan_left" },
        { "from": "q_scan_left", "read": "⊔", "dir": "R", "to": "q0" }
      ]
    }
  },
  {
    label: "3-State Busy Beaver",
    input: "",
    tm: {
      "name": "3-State Busy Beaver",
      "states": ["qA", "qB", "qC", "q_acc"],
      "start": "qA",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "qA", "read": "⊔", "write": "1", "dir": "R", "to": "qB" },
        { "from": "qA", "read": "1", "write": "1", "dir": "R", "to": "q_acc" },
        { "from": "qB", "read": "⊔", "write": "⊔", "dir": "R", "to": "qC" },
        { "from": "qB", "read": "1", "write": "1", "dir": "R", "to": "qB" },
        { "from": "qC", "read": "⊔", "write": "1", "dir": "L", "to": "qC" },
        { "from": "qC", "read": "1", "write": "1", "dir": "L", "to": "qA" }
      ]
    }
  }
];

function algoUTM(c) {
  c.innerHTML = `<div class="algo-title">Universal Turing Machine</div>
<div class="algo-sub">META-INTERPRETER: A TM THAT SIMULATES ANY TM</div>
<div class="info-box">
  A <strong>Universal Turing Machine (UTM)</strong> U takes two inputs:
  <strong>⟨M, w⟩</strong> — an encoding of a Turing Machine M and an input string w —
  and simulates M on w. The UTM reads the description of M (its states, alphabet, and
  transition function), then interprets M's transitions step by step on w's tape.
  This panel acts as a UTM: describe any deterministic TM in JSON and run it on any input.
</div>
<div class="card" style="margin-bottom:8px">
  <div class="card-title">To Emulate</div>
  <div style="display:flex;gap:6px;align-items:center">
<select id="utm-example-select" class="inp" style="flex:1;font-size:.72rem;padding:4px 6px">
  ${UTM_EXAMPLES.map((e, i) => `<option value="${i}">${e.label}</option>`).join('')}
</select>
<button class="algo-btn" onclick="loadUTMExample()">Load</button>
  </div>
</div>
<div class="card">
  <div class="card-title">Inner TM Description ⟨M⟩</div>
  <div style="font-size:.65rem;color:var(--text2);margin-bottom:6px">
JSON format · fields: states[], start, accept[], transitions[{from, read, write, dir, to}]<br>
<em>write</em> defaults to <em>read</em> if omitted · <em>dir</em>: "L" or "R" · blank = "⊔"
  </div>
  <textarea id="utm-tm-desc" rows="18"
style="width:100%;font-size:.68rem;background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:var(--r);padding:8px;resize:vertical;outline:none;line-height:1.5;"
placeholder="Paste TM JSON here…">${UTM_DEFAULT_TM}</textarea>
</div>
<div class="card" style="margin-top:8px">
  <div class="card-title">Input Tape ⟨w⟩</div>
  <div class="regex-input-wrap" style="margin-bottom:8px">
<input class="inp" id="utm-input" placeholder="Input string (ε for empty)" style="flex:1">
<button class="algo-btn" onclick="runUTMSim()">▶ Run UTM</button>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:8px">
<button class="sbtn" onclick="utmStepBack()" title="Step back">◀</button>
<button class="sbtn" onclick="utmStepFwd()" title="Step forward">▶</button>
<button class="sbtn" id="utm-auto-btn" onclick="utmToggleAuto()" title="Auto-play">⏵ Auto</button>
<button class="sbtn" onclick="utmResetView()" title="Reset">↺</button>
  </div>
  <div id="utm-tape-wrap" style="display:flex;flex-wrap:nowrap;overflow-x:auto;gap:2px;min-height:36px;margin-bottom:8px;padding:4px 0;"></div>
  <div id="utm-result"></div>
</div>`;
}

function loadUTMExample() {
  const sel = document.getElementById('utm-example-select');
  if (!sel) return;
  const ex = UTM_EXAMPLES[parseInt(sel.value, 10)];
  if (!ex) return;
  const descEl = document.getElementById('utm-tm-desc');
  const inputEl = document.getElementById('utm-input');
  if (descEl) descEl.value = JSON.stringify(ex.tm, null, 2);
  if (inputEl) inputEl.value = ex.input;
  utmResetView();
}

// UTM state
let utmSteps = [], utmIdx = 0, utmAutoTimer = null;

function runUTMSim() {
  utmResetTimer();
  utmSteps = []; utmIdx = 0;
  const descEl = document.getElementById('utm-tm-desc');
  const inputEl = document.getElementById('utm-input');
  const outEl = document.getElementById('utm-result');
  if (!descEl || !inputEl || !outEl) return;
  let tm;
  try { tm = JSON.parse(descEl.value); } catch (e) {
    outEl.innerHTML = `<div style="color:var(--red);font-size:.72rem">JSON parse error: ${e.message}</div>`;
    return;
  }
  const errs = utmValidateTM(tm);
  if (errs.length) {
    outEl.innerHTML = `<div style="color:var(--red);font-size:.72rem">${errs.join('<br>')}</div>`;
    return;
  }
  const raw = inputEl.value; const w = (raw === App.config.sym.eps || raw === '') ? '' : raw;
  utmSteps = simUTM(tm, w);
  utmIdx = 0;
  renderUTMStep();
}

function utmValidateTM(tm) {
  const errs = [];
  if (!tm.states || !Array.isArray(tm.states) || !tm.states.length) errs.push('Missing or empty "states" array.');
  if (!tm.start) errs.push('Missing "start" state.');
  if (!tm.accept || !Array.isArray(tm.accept)) errs.push('Missing or invalid "accept" array.');
  if (!tm.transitions || !Array.isArray(tm.transitions)) errs.push('Missing or invalid "transitions" array.');
  if (tm.start && tm.states && !tm.states.includes(tm.start)) errs.push(`Start state "${tm.start}" not in states.`);
  if (errs.length) return errs;
  tm.transitions.forEach((tr, i) => {
    if (!tr.from) errs.push(`Transition ${i}: missing "from".`);
    if (tr.read === undefined || tr.read === null) errs.push(`Transition ${i}: missing "read".`);
    if (!tr.dir || (tr.dir !== 'L' && tr.dir !== 'R')) errs.push(`Transition ${i}: "dir" must be "L" or "R".`);
    if (!tr.to) errs.push(`Transition ${i}: missing "to".`);
  });
  return errs;
}

function simUTM(tm, w) {
  const steps = [];
  const stateSet = new Set(tm.states);
  const acceptSet = new Set(tm.accept);
  // Build transition map indexed by from+read
  const delta = {};
  tm.transitions.forEach(tr => {
    const key = tr.from + '\x00' + (tr.read === '' ? App.config.sym.blank : tr.read);
    delta[key] = { write: tr.write !== undefined ? (tr.write === '' ? App.config.sym.blank : tr.write) : (tr.read === '' ? App.config.sym.blank : tr.read), dir: tr.dir, to: tr.to };
  });

  let tape = w.length ? w.split('') : [];
  let head = 0, state = tm.start;
  const BLANK = App.config.sym.blank;
  const MAX_STEPS = App.config.maxTmSteps;

  for (let i = 0; i < MAX_STEPS; i++) {
    while (tape.length <= head) tape.push(BLANK);
    const sym = tape[head] || BLANK;
    const key = state + '\x00' + sym;
    const tr = delta[key];

    // generate a rich configuration string (instantaneous description)
    const left = tape.slice(0, head).join('');
    const right = tape.slice(head + 1).join('');
    const idStr = `${left}[${state}]${tape[head]}${right}`.replace(/⊔+$/, '') || `[${state}]⊔`;

    if (acceptSet.has(state)) {
      steps.push({ tape: [...tape], head, state, note: `UTM: inner state "${state}" is an accept state — ACCEPT`, id: idStr, final: 'accept', step: i });
      break;
    }

    if (!tr) {
      steps.push({ tape: [...tape], head, state, note: `UTM: no transition for (${state}, '${sym}') — REJECT`, id: idStr, final: 'reject', step: i });
      break;
    }

    steps.push({ tape: [...tape], head, state, note: `UTM step ${i + 1}: state="${state}", read='${sym}' → write='${tr.write}', dir=${tr.dir}, → state="${tr.to}"`, id: idStr, step: i });

    tape[head] = tr.write;
    state = tr.to;
    head = head + (tr.dir === 'R' ? 1 : -1);
    if (head < 0) head = 0;
  }

  if (steps.length && !steps[steps.length - 1].final) {
    while (tape.length <= head) tape.push(BLANK);
    const idStr = `${tape.slice(0, head).join('')}[${state}]${tape.slice(head).join('')}`.replace(/⊔+$/, '');
    steps.push({ tape: [...tape], head, state, note: `UTM: step limit (${MAX_STEPS}) reached — possible infinite loop, halting`, id: idStr, final: 'loop', step: MAX_STEPS });
  }
  return steps;
}

function renderUTMStep() {
  const outEl = document.getElementById('utm-result');
  const tapeEl = document.getElementById('utm-tape-wrap');
  if (!outEl || !tapeEl) return;
  if (!utmSteps.length) return;
  const step = utmSteps[utmIdx];

  // Render tape
  const BLANK = App.config.sym.blank;
  const tapeDisplay = [...step.tape]; while (tapeDisplay.length <= step.head) tapeDisplay.push(BLANK);
  tapeEl.innerHTML = tapeDisplay.map((c, i) =>
    `<div style="min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.8rem;border:1px solid ${i === step.head ? 'var(--accent)' : 'var(--border2)'};border-radius:3px;background:${i === step.head ? 'var(--surface3)' : 'var(--surface)'};color:${i === step.head ? 'var(--accent)' : 'var(--text)'};">${c}</div>`
  ).join('') + `<div style="min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:var(--text3);border:1px dashed var(--border);border-radius:3px;">…</div>`;

  // Render trace log
  const lines = utmSteps.slice(0, utmIdx + 1).map((s, i) => {
    const cls = i === utmIdx ? (s.final === 'accept' ? 't-ok' : s.final === 'reject' ? 't-err' : s.final === 'loop' ? 't-err' : 't-step') : '';
    return `<div class="${cls}" style="font-size:.68rem;padding:2px 0;">${i}: ${s.note}</div>`;
  }).join('');

  const finalStep = utmSteps[utmSteps.length - 1];
  const resultBar = (utmIdx === utmSteps.length - 1 && finalStep.final) ?
    `<div class="pump-result ${finalStep.final === 'accept' ? 'ok' : 'fail'}" style="margin-bottom:8px">
      ${finalStep.final === 'accept' ? 'ACCEPTED ✓' : finalStep.final === 'loop' ? 'LOOP DETECTED — did not halt' : 'REJECTED ✗'}
      &nbsp;·&nbsp; ${utmSteps.length} steps total
    </div>` : '';

  outEl.innerHTML = resultBar + `<div class="card"><div class="card-title">Computation Trace (step ${utmIdx + 1} / ${utmSteps.length})</div>
<div id="utm-trace-scroll" style="max-height:220px;overflow-y:auto;">${lines}</div>
</div>`;
  // Auto-scroll trace to bottom
  setTimeout(() => {
    const traceEl = document.getElementById('utm-trace-scroll');
    if (traceEl) traceEl.scrollTop = traceEl.scrollHeight;
  }, 0);
}

function utmStepFwd() { if (utmIdx < utmSteps.length - 1) { utmIdx++; renderUTMStep(); } }
function utmStepBack() { if (utmIdx > 0) { utmIdx--; renderUTMStep(); } }
function utmResetView() { utmResetTimer(); utmSteps = []; utmIdx = 0; const el = document.getElementById('utm-result'); if (el) el.innerHTML = ''; const t = document.getElementById('utm-tape-wrap'); if (t) t.innerHTML = ''; }
function utmResetTimer() { if (utmAutoTimer) { clearInterval(utmAutoTimer); utmAutoTimer = null; } const b = document.getElementById('utm-auto-btn'); if (b) { b.classList.remove('playing'); b.textContent = '⏵ Auto'; } }
function utmToggleAuto() {
  if (utmAutoTimer) { utmResetTimer(); return; }
  const b = document.getElementById('utm-auto-btn');
  if (b) { b.classList.add('playing'); b.textContent = '⏸ Stop'; }
  utmAutoTimer = setInterval(() => {
    if (utmIdx >= utmSteps.length - 1) { utmResetTimer(); return; }
    utmIdx++; renderUTMStep();
  }, 400);
}



// ══════════════════════════════════════════════════════════════════
//  MOORE MACHINE ALGORITHMS
// ══════════════════════════════════════════════════════════════════
function algoMooreTable(c) {
  c.innerHTML = `<div class="algo-title">Moore Machine Table</div>
<div class="algo-sub">TRANSITION TABLE WITH STATE OUTPUTS &#955;: Q &#8594; &#916;</div>
<div class="info-box">Each state has an associated output symbol &#955;(q). The output produced on input string w = a&#8321;...a&#8345; is &#955;(q&#8320;)&#955;(q&#8321;)...&#955;(q&#8345;), where q&#7522; = &#948;(q&#7522;&#8331;&#8321;, a&#7522;). Output length is always |w|+1.</div>`;
  if (App.machine !== 'Moore') { c.innerHTML += '<div class="card">Switch to Moore machine mode to use this table.</div>'; return; }
  if (!App.states.length) { c.innerHTML += '<div class="card">Build a Moore machine first in the Build tab.</div>'; return; }
  const syms = [...App.sigma];
  const thead = `<tr><th>State</th><th style="color:var(--green)">&#955;(q)</th>${syms.map(s => `<th>${s}</th>`).join('')}</tr>`;
  const rows = App.states.map(s => {
    const prefix = (App.startId === s.id ? '&#8594;' : ' ') + (App.accepts.has(s.id) ? '*' : ' ');
    const outCell = `<td style="color:var(--green);font-weight:600">${s.output || '&#8212;'}</td>`;
    const cells = syms.map(sym => {
      const t = App.transitions.find(tr => tr.from === s.id && tr.symbol === sym);
      const dest = t ? getState(t.to)?.name : '&#8212;';
      return `<td class="${!t ? 'dead-cell' : ''}">${dest}</td>`;
    }).join('');
    return `<tr><td class="${App.startId === s.id ? 'start-cell' : ''} ${App.accepts.has(s.id) ? 'acc-cell' : ''}">${prefix} ${s.name}</td>${outCell}${cells}</tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">&#948;: Q &times; &#931; &#8594; Q &nbsp;|&nbsp; &#955;: Q &#8594; &#916;</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">&#8594; = start state &nbsp;&nbsp; * = accept state &nbsp;&nbsp; &#955;(q) = output of state q</div></div>`;
  const outSyms = [...new Set(App.states.map(s => s.output).filter(Boolean))];
  c.innerHTML += `<div class="card"><div class="card-title">Output Alphabet &#916; used</div>
<div class="nfa-result-states">${outSyms.map(o => `<div class="state-pill">${o}</div>`).join('') || '<span style="color:var(--text3);font-size:.72rem">No outputs defined</span>'}</div></div>`;
}

function algoMoore2Mealy(c) {
  c.innerHTML = `<div class="algo-title">Moore &#8594; Mealy Conversion</div>
<div class="algo-sub">OUTPUT MOVES FROM STATES TO TRANSITIONS</div>
<div class="info-box">For each Moore transition (p, a) &#8594; q with &#955;(q) = b, the equivalent Mealy transition is (p, a) &#8594; q with output b. State structure is unchanged; only output attribution shifts from destination states to incoming transitions.</div>`;
  if (App.machine !== 'Moore') { c.innerHTML += '<div class="card">Switch to Moore machine mode to use this conversion.</div>'; return; }
  if (!App.states.length) { c.innerHTML += '<div class="card">Build a Moore machine first.</div>'; return; }
  const rows = App.transitions.map(t => {
    const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
    const mealyOut = getState(t.to)?.output || '&#8212;';
    return `<tr><td>${fn}</td><td>${t.symbol}</td><td>${tn}</td><td style="color:var(--accent);font-weight:600">${mealyOut}</td></tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Equivalent Mealy Transitions</div>
<div class="subset-table-wrap"><table class="result-table">
  <thead><tr><th>From</th><th>Input</th><th>To</th><th style="color:var(--accent)">Output &#955;(to)</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="dead-cell">No transitions</td></tr>'}</tbody>
</table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">
  Mealy output = &#955;<sub>Moore</sub>(destination state). State structure unchanged.<br>
  Note: The initial Moore output &#955;(q&#8320;) has no Mealy equivalent &mdash; Mealy output sequence is one symbol shorter.
</div></div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadMooreAsMealy()">Load as Mealy Machine</button></div>`;
}

function loadMooreAsMealy() {
  if (App.machine !== 'Moore') return;
  snapshot();
  App.transitions.forEach(t => { t.output = getState(t.to)?.output || ''; });
  App.machine = 'Mealy';
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.textContent === 'Mealy'));
  $('mach-badge').className = 'badge bd-mealy'; $('mach-badge').textContent = 'Mealy';
  $('output-sec').style.display = '';
  $('stack-sec').style.display = 'none';
  updateRPanel(); renderAll(); updateSidebar();
  setView('build'); showStatus('Loaded as Mealy machine. Transition outputs set from destination state outputs.');
}


// ══════════════════════════════════════════════════════════════════
//  MEALY MACHINE ALGORITHMS
// ══════════════════════════════════════════════════════════════════
function algoMealyTable(c) {
  c.innerHTML = `<div class="algo-title">Mealy Machine Table</div>
<div class="algo-sub">TRANSITION TABLE WITH TRANSITION OUTPUTS &#955;: Q &times; &#931; &#8594; &#916;</div>
<div class="info-box">Each transition (q, a) &#8594; p carries an output symbol &#955;(q, a). The output produced on w = a&#8321;...a&#8345; is &#955;(q&#8320;,a&#8321;)&#955;(q&#8321;,a&#8322;)...&#955;(q&#8345;&#8331;&#8321;,a&#8345;), exactly n symbols. No output before the first input.</div>`;
  if (App.machine !== 'Mealy') { c.innerHTML += '<div class="card">Switch to Mealy machine mode to use this table.</div>'; return; }
  if (!App.states.length) { c.innerHTML += '<div class="card">Build a Mealy machine first in the Build tab.</div>'; return; }
  const syms = [...App.sigma];
  const thead = `<tr><th>State</th>${syms.map(s => `<th>${s}<br><span style="font-size:.58rem;color:var(--text3)">to / out</span></th>`).join('')}</tr>`;
  const rows = App.states.map(s => {
    const prefix = (App.startId === s.id ? '&#8594;' : ' ') + (App.accepts.has(s.id) ? '*' : ' ');
    const cells = syms.map(sym => {
      const t = App.transitions.find(tr => tr.from === s.id && tr.symbol === sym);
      if (!t) return '<td class="dead-cell">&#8212; / &#8212;</td>';
      const dest = getState(t.to)?.name || '?';
      const out = t.output || '&#8212;';
      return `<td>${dest} / <span style="color:var(--accent);font-weight:600">${out}</span></td>`;
    }).join('');
    return `<tr><td class="${App.startId === s.id ? 'start-cell' : ''} ${App.accepts.has(s.id) ? 'acc-cell' : ''}">${prefix} ${s.name}</td>${cells}</tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">&#948;: Q &times; &#931; &#8594; Q &nbsp;|&nbsp; &#955;: Q &times; &#931; &#8594; &#916; &nbsp;(format: &#948;(q,a) / &#955;(q,a))</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">&#8594; = start state &nbsp;&nbsp; * = accept state &nbsp;&nbsp; format: next-state / output</div></div>`;
}

function algoMealy2Moore(c) {
  c.innerHTML = `<div class="algo-title">Mealy &#8594; Moore Conversion</div>
<div class="algo-sub">OUTPUT MOVES FROM TRANSITIONS TO STATES (STATE SPLITTING)</div>
<div class="info-box">Each Mealy state q is split into copies (q, b) for each output symbol b that appears on any transition entering q. The Moore output of copy (q, b) is b. An initial copy (q&#8320;, &#8709;) is added for the start state with no output.</div>`;
  if (App.machine !== 'Mealy') { c.innerHTML += '<div class="card">Switch to Mealy machine mode to use this conversion.</div>'; return; }
  if (!App.states.length) { c.innerHTML += '<div class="card">Build a Mealy machine first.</div>'; return; }
  const result = computeMealy2Moore();
  const stateHtml = result.states.map(s => {
    const isAcc = result.accepts.has(s.id), isStart = s.id === result.startId;
    return `<div class="state-pill ${isAcc ? 'acc' : isStart ? 'start' : ''}">${s.name} [&#955;=${s.output || '&#8709;'}]</div>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Moore States (${result.states.length} from ${App.states.length} Mealy states)</div>
<div class="nfa-result-states">${stateHtml}</div></div>`;
  const rows = result.transitions.map(t => {
    const fn = result.states.find(s => s.id === t.from)?.name || t.from;
    const tn = result.states.find(s => s.id === t.to)?.name || t.to;
    const toOut = result.states.find(s => s.id === t.to)?.output || '&#8212;';
    return `<tr><td>${fn}</td><td>${t.symbol}</td><td>${tn}</td><td style="color:var(--green)">${toOut}</td></tr>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Moore Transitions (${result.transitions.length})</div>
<div class="subset-table-wrap"><table class="result-table">
  <thead><tr><th>From</th><th>Input</th><th>To</th><th style="color:var(--green)">&#955;(to)</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="dead-cell">No transitions</td></tr>'}</tbody>
</table></div></div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadMealyAsMoore()">Load as Moore Machine</button></div>`;
  App._lastMealy2Moore = result;
}

function computeMealy2Moore() {
  const incomingOutputs = {};
  App.states.forEach(s => { incomingOutputs[s.id] = new Set(); });
  App.transitions.forEach(t => { if (t.output) incomingOutputs[t.to]?.add(t.output); });
  const mooreStates = []; const idMap = {};
  const s0 = App.startId ? getState(App.startId) : null;
  if (s0) {
    const sid = 'm_' + s0.id + '_init';
    mooreStates.push({ id: sid, name: s0.name, output: '', origId: s0.id });
    idMap[s0.id + '_init'] = sid;
  }
  App.states.forEach(s => {
    if (s.id === App.startId) return;
    const outs = incomingOutputs[s.id];
    if (!outs || outs.size === 0) {
      const sid = 'm_' + s.id + '_none';
      mooreStates.push({ id: sid, name: s.name, output: '', origId: s.id });
      idMap[s.id + '_none'] = sid;
    } else {
      outs.forEach(b => {
        const sid = 'm_' + s.id + '_' + b;
        mooreStates.push({ id: sid, name: s.name + '/' + b, output: b, origId: s.id });
        idMap[s.id + '_' + b] = sid;
      });
    }
  });
  const mooreTrans = [];
  App.transitions.forEach((t, ti) => {
    const b = t.output || '';
    const toKey = b ? (t.to + '_' + b) : (t.to + '_none');
    const toId = idMap[toKey] || idMap[t.to + '_init'] || null;
    const fromCopies = mooreStates.filter(s => s.id.startsWith('m_' + t.from + '_'));
    fromCopies.forEach((fc, fi) => {
      if (toId) mooreTrans.push({ id: 'mt_' + ti + '_' + fi, from: fc.id, to: toId, symbol: t.symbol });
    });
  });
  const startId = mooreStates[0]?.id || null;
  const accepts = new Set(mooreStates.filter(s => s.origId && App.accepts.has(s.origId)).map(s => s.id));
  return { states: mooreStates, transitions: mooreTrans, startId, accepts };
}

function loadMealyAsMoore() {
  const r = App._lastMealy2Moore; if (!r) return;
  snapshot();
  App.states = r.states.map((s, i) => ({ ...s, x: 120 + (i % 4) * 180, y: 120 + Math.floor(i / 4) * 160 }));
  App.transitions = r.transitions;
  App.startId = r.startId;
  App.accepts = r.accepts;
  App.stateN = r.states.length; App.transN = r.transitions.length;
  App.machine = 'Moore';
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.textContent === 'Moore'));
  $('mach-badge').className = 'badge bd-moore'; $('mach-badge').textContent = 'Moore';
  $('output-sec').style.display = '';
  $('stack-sec').style.display = 'none';
  updateRPanel(); renderAll(); updateSidebar();
  setView('build'); showStatus('Loaded as Moore machine.');
}


// ══════════════════════════════════════════════════════════════════
//  MULTI-TAPE TM TABLE
// ══════════════════════════════════════════════════════════════════
function algoMTMTable(c) {
  c.innerHTML = `<div class="algo-title">Multi-Tape TM Transition Table</div>
<div class="algo-sub">&#948;: Q &times; &#915;&#7503; &#8594; Q &times; &#915;&#7503; &times; {L,R}&#7503;</div>
<div class="info-box">Each transition reads one symbol from each of the k tapes, writes one symbol to each tape, and moves each head independently. The table shows one row per transition: symbols read from all tapes, the destination state, and writes/directions for all tapes.</div>`;
  if (App.machine !== 'MTM') { c.innerHTML += '<div class="card">Switch to MTM mode to use this table.</div>'; return; }
  if (!App.states.length) { c.innerHTML += '<div class="card">Build an MTM first in the Build tab.</div>'; return; }
  const k = App.tapeCount;
  const readHdrs = Array.from({ length: k }, (_, i) => `<th>T${i + 1} read</th>`).join('');
  const writeHdrs = Array.from({ length: k }, (_, i) => `<th>T${i + 1} write/dir</th>`).join('');
  const thead = `<tr><th>State</th>${readHdrs}<th>Next State</th>${writeHdrs}</tr>`;
  const rows = App.transitions.map(t => {
    const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
    const reads = Array.from({ length: k }, (_, i) => `<td>${(t.tapeSyms || [])[i] || t.symbol || '&#8212;'}</td>`).join('');
    const writes = Array.from({ length: k }, (_, i) => {
      const w = (t.tapeWrites || [])[i] || '&#8212;', d = (t.tapeDirs || [])[i] || '&#8212;';
      return `<td>${w}/${d}</td>`;
    }).join('');
    const fromClass = App.startId === t.from ? 'start-cell' : App.accepts.has(t.from) ? 'acc-cell' : '';
    const toClass = App.accepts.has(t.to) ? 'acc-cell' : '';
    return `<tr><td class="${fromClass}">${fn}</td>${reads}<td class="${toClass}">${tn}</td>${writes}</tr>`;
  }).join('');
  const emptyCols = 2 + 2 * k;
  c.innerHTML += `<div class="card"><div class="card-title">${k}-Tape TM Transitions (${App.transitions.length} total)</div>
<div class="subset-table-wrap"><table class="result-table"><thead>${thead}</thead><tbody>${rows || `<tr><td colspan="${emptyCols}" class="dead-cell">No transitions defined</td></tr>`}</tbody></table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">
  T1 = primary input tape &nbsp;&nbsp; T2..Tk = work tapes &nbsp;&nbsp; format: write-symbol/direction
</div></div>`;
  const statePills = App.states.map(s => {
    const cls = App.accepts.has(s.id) ? 'acc' : App.startId === s.id ? 'start' : '';
    return `<div class="state-pill ${cls}">${s.name}${App.startId === s.id ? ' (start)' : ''}${App.accepts.has(s.id) ? ' &#9733;' : ''}</div>`;
  }).join('');
  c.innerHTML += `<div class="card"><div class="card-title">States Q (${App.states.length})</div>
<div class="nfa-result-states">${statePills}</div></div>`;
}
