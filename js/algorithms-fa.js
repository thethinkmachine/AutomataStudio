import { renderSigma } from './alphabet.js';
import { snapshot } from './history.js';
import { langVerdict } from './language.js';
import { deriveRegex, renderAll, updateLPanel, updateRPanel } from './render.js';
import { log } from './simulation.js';
import { simNPDA } from './machines/pushdown.js';
import { simNDTM } from './machines/turing.js';
import { epsClosure, stateNames, tokenize } from './machines/runtime.js';
import { $, App, R, getMachineConfig } from './state.js';
import { getState } from './states-transitions.js';
import { Change, emit } from './store.js';
import { autoFitLoadedMachine, fitToScreen } from './ui.js';
import { escapeHtml, findPdaNondeterministicPairs, isAnyTM, isClassicPDA, parseEps, showStatus } from './utils.js';
import { applyMachineSwitch, setMachine, setView } from './view.js';
import { getCurrentMachineSnapshot, loadBuiltMachine } from './workspace.js';

// ══════════════════════════════════════════════════════════════════
//  ALGORITHMS VIEW
// ══════════════════════════════════════════════════════════════════
export const ALGO_ICON_LOAD_CANVAS = '<svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor" style="margin-right:6px"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/></svg>';
export function setAlgo(a) {
  // Clear canvas overlay when leaving Dead State Analysis
  if (App.currentAlgo === 'deadStates' && a !== 'deadStates' && App.stateClassification) {
    App.stateClassification = null;
    emit(Change.CANVAS);
  }
  App.currentAlgo = a;
  document.querySelectorAll('.algo-item').forEach(el => el.classList.toggle('active', el.dataset.algo === a));
  renderAlgo(a);
}

export function renderAlgo(a) {
  const c = $('algo-content'); c.innerHTML = '';
  const renders = {
    table: algoTable, nfa2dfa: algoNFA2DFA, minimize: algoMinimize, equiv: algoEquiv,
    re2nfa: algoRE2NFA, nfa2re: algoNFA2RE, enfa2nfa: algoEpsNFA2NFA,
    complement: algoComplement, product: algoProduct,
    isEmpty: algoIsEmpty, isFinite: algoIsFinite, isUniversal: algoIsUniversal, fullEquiv: algoFullEquiv,
    star: algoClopStar, reversal: algoClopReversal, union2: algoClopUnion, intersect: algoClopIntersect, concat2: algoClopConcat,
    nfaTree: algoNFATree, npda: algoNPDA, ndtm: algoNDTM, utm: algoUTM,
    mooreTable: algoMooreTable, mealyTable: algoMealyTable,
    moore2mealy: algoMoore2Mealy, mealy2moore: algoMealy2Moore, mtmTable: algoMTMTable,
    minimizeVisual: algoMinimizeVisual, re2nfaVisual: algoRE2NFAVisual, tm2grammar: algoTM2Grammar,
    epsClosure: algoEpsClosure, dfa2rg: algoDFA2RG, rg2nfa: algoRG2NFA,
    deadStates: algoDeadStates,
  };
  if (renders[a]) renders[a](c);
}

// --- Transition Table ---
export function algoTable(c) {
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
export function algoNFA2DFA(c) {
  c.innerHTML = `<div class="algo-title">NFA → DFA Conversion</div>
<div class="algo-sub">SUBSET CONSTRUCTION (POWERSET CONSTRUCTION)</div>
<div class="info-box">Each DFA state represents a <em>subset of NFA states</em>. Starting from ε-closure(q₀), we compute transitions for each symbol and add new subsets as needed. The resulting DFA is equivalent to the original NFA.</div>`;
  // Subset construction is only sound for a plain one-way NFA over finite
  // words. Every other model on this canvas carries state the powerset has no
  // room for — a probability distribution, a Büchi cycle condition, a stack, a
  // tape — and silently dropping it would offer an "equivalent" DFA that
  // decides a different language.
  if (App.machine !== 'NFA' && App.machine !== 'ε-NFA') {
    const why = App.machine === 'DFA'
      ? 'Your automaton is already a DFA. Switch to NFA or ε-NFA mode to use this.'
      : `Subset construction applies to NFAs and ε-NFAs. ${getMachineConfig(App.machine).label} is not one, and converting it as though it were would discard what makes it different.`;
    c.innerHTML += `<div class="card">${why}</div>`; return;
  }
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadSubsetAsDFA()">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  // Steps
  c.innerHTML += `<div class="card"><div class="card-title">Construction Steps</div><div class="step-list">${result.steps.map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')
    }</div></div>`;
  App._lastSubset = result;
}

export function subsetConstruction() {
  const syms = [...App.sigma];
  const isEpsNFA = App.machine === 'ε-NFA';
  const setKey = set => [...set].sort().join(',');
  const setName = set => { const inner = [...set].map(id => getState(id)?.name).sort().join(','); return inner ? '{' + inner + '}' : '∅'; };
  const start = epsClosure(new Set([App.startId]));
  const startName = setName(start);
  const queue = [start]; const visited = new Map([[setKey(start), start]]);
  const startIsAcc = [...start].some(id => App.accepts.has(id));
  const states = [{ name: startName, set: start, isStart: true, isAcc: startIsAcc }];
  const trans = [], steps = [];

  // --- Step 1: ε-closure of start state ---
  const q0Name = getState(App.startId)?.name;
  let initMain = `ε-closure({${q0Name}}) = <em>${startName}</em> <em>(initial DFA state)</em>`;
  const initSubs = [];
  if (isEpsNFA && start.size > 1) {
    const reached = [...start].filter(id => id !== App.startId).map(id => getState(id)?.name);
    initSubs.push(`ε-transitions from ${q0Name} reach: ${reached.join(', ')}`);
  } else if (!isEpsNFA) {
    initSubs.push(`No ε-transitions (NFA mode) — closure is {${q0Name}}`);
  } else {
    initSubs.push(`No ε-transitions from ${q0Name}`);
  }
  if (startIsAcc) {
    const accNames = [...start].filter(id => App.accepts.has(id)).map(id => getState(id)?.name);
    initSubs.push(`Contains accept state${accNames.length > 1 ? 's' : ''} {${accNames.join(', ')}} → <span class="step-acc">this DFA state is accepting ★</span>`);
  }
  steps.push(initMain + `<span class="step-sub">${initSubs.join('<br>')}</span>`);

  // --- Process each DFA state from the queue ---
  while (queue.length) {
    const cur = queue.shift(), curName = setName(cur);
    syms.forEach(sym => {
      let nx = new Set();
      const contribs = [];
      cur.forEach(sid => {
        const targets = App.transitions.filter(t => t.from === sid && t.symbol === sym);
        const sName = getState(sid)?.name;
        if (targets.length) {
          const tNames = targets.map(t => getState(t.to)?.name);
          contribs.push({ name: sName, targets: tNames, empty: false });
          targets.forEach(t => nx.add(t.to));
        } else {
          contribs.push({ name: sName, targets: [], empty: true });
        }
      });

      const preEps = new Set(nx);
      const preEpsName = nx.size ? setName(preEps) : '∅';
      nx = epsClosure(nx);
      const epsExpanded = nx.size > preEps.size;

      if (!nx.size) {
        let main = `δ(${curName}, '${sym}') = <span class="step-dead">∅</span>`;
        const subs = [];
        if (cur.size === 1) {
          subs.push(`${contribs[0].name} has no transitions on '${sym}'`);
        } else {
          const parts = contribs.map(c => c.empty ? `${c.name} → ∅` : `${c.name} → {${c.targets.join(',')}}`);
          subs.push(`NFA moves: ${parts.join(' · ')}`);
        }
        subs.push(`No reachable states — this maps to the dead/trap state`);
        steps.push(main + `<span class="step-sub">${subs.join('<br>')}</span>`);
        return;
      }

      const nxName = setName(nx), nxKey = setKey(nx);
      trans.push({ from: curName, sym, to: nxName });
      const isNew = !visited.has(nxKey);
      const isAcc = [...nx].some(id => App.accepts.has(id));

      let main = `δ(${curName}, '${sym}') = <em>${nxName}</em>`;
      if (isNew) main += ` <em>(new state!)</em>`;
      const subs = [];

      // Show per-state contributions when subset has multiple states
      if (cur.size > 1) {
        const parts = contribs.map(c => c.empty ? `${c.name} → ∅` : `${c.name} → {${c.targets.join(',')}}`);
        subs.push(`NFA moves: ${parts.join(' · ')}`);
        const nonEmpty = contribs.filter(c => !c.empty);
        if (nonEmpty.length > 1) {
          subs.push(`Union of targets = ${preEpsName}`);
        }
      }

      // Show ε-closure when it expanded the set
      if (epsExpanded) {
        subs.push(`ε-closure(${preEpsName}) = <em>${nxName}</em>`);
      }

      // New vs. existing state
      if (isNew) {
        subs.push(`New DFA state discovered — added to processing queue`);
      } else {
        subs.push(`Already a known DFA state — no new work needed`);
      }

      // Accept state check for newly discovered states
      if (isAcc && isNew) {
        const accNames = [...nx].filter(id => App.accepts.has(id)).map(id => getState(id)?.name);
        subs.push(`Contains NFA accept state${accNames.length > 1 ? 's' : ''} {${accNames.join(', ')}} → <span class="step-acc">accepting ★</span>`);
      }

      if (subs.length) main += `<span class="step-sub">${subs.join('<br>')}</span>`;
      steps.push(main);

      if (isNew) {
        visited.set(nxKey, nx); queue.push(nx);
        states.push({ name: nxName, set: nx, isStart: false, isAcc: isAcc });
      }
    });
  }

  // --- Summary step ---
  const accCount = states.filter(s => s.isAcc).length;
  const summaryMain = `<span class="step-phase">Construction complete ✓</span>`;
  const summarySub = `All reachable subsets explored (queue empty). Resulting DFA has <em>${states.length}</em> state${states.length !== 1 ? 's' : ''} (${accCount} accepting) and <em>${trans.length}</em> transition${trans.length !== 1 ? 's' : ''} over Σ = {${syms.join(', ')}}.`;
  steps.push(summaryMain + `<span class="step-sub">${summarySub}</span>`);

  return { states, trans, steps };
}

export let _subsetData = null;
export function loadSubsetAsDFA() {
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
  applyMachineSwitch('DFA');
  emit(Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('DFA loaded into canvas!');
}

// --- DFA Minimization (Table-Filling) ---
export function algoMinimize(c) {
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
  c.innerHTML += `<div class="card"><div class="card-title">Algorithm Steps</div><div class="step-list">${result.steps.map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s.html}</div></div>`).join('')
    }</div></div>`;
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" onclick="loadMinimizedDFA()">Load Minimized DFA</button></div>`;
  App._lastMin = result;
}

export function tableFillingMinimize() {
  const reachable = getReachableStates(App.startId);
  const states = App.states.filter(s => reachable.has(s.id));
  const ids = states.map(s => s.id);
  const dist = {}, steps = [];
  // Save snapshot of transitions for later use in loadMinimizedDFA
  const savedTrans = App.transitions
    .filter(t => reachable.has(t.from) && reachable.has(t.to))
    .map(t => ({ ...t }));
  const savedStates = states.map(s => ({ ...s }));
  const savedAccepts = new Set([...App.accepts].filter(id => reachable.has(id)));
  const savedStart = App.startId;

  // --- Step: discard unreachable states ---
  if (states.length !== App.states.length) {
    const discarded = App.states.filter(s => !reachable.has(s.id)).map(s => s.name);
    let main = `Discard ${App.states.length - states.length} unreachable state(s) before minimization.`;
    main += `<span class="step-sub">Removed: {${discarded.join(', ')}}<br>Remaining: ${states.length} reachable states to minimize</span>`;
    steps.push({ type: 'discard', html: main });
  }

  // --- Step: base case marking ---
  const accNames = states.filter(s => App.accepts.has(s.id)).map(s => s.name);
  const nonAccNames = states.filter(s => !App.accepts.has(s.id)).map(s => s.name);
  let basePairsMarked = 0;
  ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
    const key = [a, b].sort().join('|');
    dist[key] = App.accepts.has(a) !== App.accepts.has(b);
    if (dist[key]) basePairsMarked++;
  }));
  let baseMain = `<em>Base case:</em> Mark all pairs where one state is accepting and the other is not.`;
  const baseSubs = [];
  baseSubs.push(`Accept states F = {${accNames.join(', ') || '∅'}} · Non-accept = {${nonAccNames.join(', ') || '∅'}}`);
  baseSubs.push(`Marked <em>${basePairsMarked}</em> pair(s) as distinguishable in this step`);
  baseSubs.push(`Reasoning: an accept state and a non-accept state are trivially distinguishable — the empty string ε distinguishes them`);
  steps.push({ type: 'base', html: baseMain + `<span class="step-sub">${baseSubs.join('<br>')}</span>` });

  // --- Iterative refinement ---
  let changed = true, iter = 0, totalMarked = basePairsMarked;
  while (changed) {
    changed = false; iter++;
    ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
      const key = [a, b].sort().join('|');
      if (dist[key]) return;
      const aName = getState(a)?.name, bName = getState(b)?.name;
      for (const sym of App.sigma) {
        const ta = App.transitions.find(t => t.from === a && t.symbol === sym);
        const tb = App.transitions.find(t => t.from === b && t.symbol === sym);
        const da = ta?.to, db = tb?.to;
        if (da === db) continue;
        if (da && db) {
          const pk = [da, db].sort().join('|');
          if (dist[pk]) {
            dist[key] = true; changed = true; totalMarked++;
            const daName = getState(da)?.name, dbName = getState(db)?.name;
            let main = `Mark (<em>${aName}</em>, <em>${bName}</em>) as distinguishable`;
            const subs = [];
            subs.push(`Iteration ${iter}: examining unmarked pair (${aName}, ${bName}) on symbol '${sym}'`);
            subs.push(`δ(${aName}, '${sym}') = ${daName} · δ(${bName}, '${sym}') = ${dbName}`);
            subs.push(`(${daName}, ${dbName}) is already marked ✗ → (${aName}, ${bName}) must also be distinguishable`);
            steps.push({ type: 'mark', p1: a, p2: b, html: main + `<span class="step-sub">${subs.join('<br>')}</span>` });
            return;
          }
        } else if (da || db) {
          dist[key] = true; changed = true; totalMarked++;
          const hasName = da ? getState(da)?.name : getState(db)?.name;
          const missState = da ? bName : aName;
          let main = `Mark (<em>${aName}</em>, <em>${bName}</em>) as distinguishable`;
          const subs = [];
          subs.push(`Iteration ${iter}: examining unmarked pair (${aName}, ${bName}) on symbol '${sym}'`);
          subs.push(`δ(${aName}, '${sym}') = ${da ? getState(da)?.name : '∅'} · δ(${bName}, '${sym}') = ${db ? getState(db)?.name : '∅'}`);
          subs.push(`${missState} has no transition on '${sym}' (implicit dead/trap) — states are distinguishable`);
          steps.push({ type: 'mark', p1: a, p2: b, html: main + `<span class="step-sub">${subs.join('<br>')}</span>` });
          return;
        }
      }
    }));
    if (iter > ids.length * ids.length) break;
  }

  // --- Fixed point ---
  const totalPairs = ids.length * (ids.length - 1) / 2;
  const unmarkedCount = totalPairs - totalMarked;
  let fpMain = `<span class="step-phase">Fixed point reached ✓</span>`;
  const fpSubs = [];
  fpSubs.push(`Completed after ${iter} iteration(s) — no new pairs could be marked`);
  fpSubs.push(`Total pairs: <em>${totalPairs}</em> · Marked (✗ distinguishable): <em>${totalMarked}</em> · Unmarked (≡ equivalent): <em>${unmarkedCount}</em>`);
  steps.push({ type: 'fixed', html: fpMain + `<span class="step-sub">${fpSubs.join('<br>')}</span>` });

  // --- Group indistinguishable states ---
  const assigned = new Set(), groups = [];
  ids.forEach(a => {
    if (assigned.has(a)) return;
    const grp = [a]; assigned.add(a);
    ids.forEach(b => { if (!assigned.has(b)) { const k = [a, b].sort().join('|'); if (!dist[k]) { grp.push(b); assigned.add(b); } } });
    groups.push(grp);
  });

  // --- Summary step ---
  let sumMain = `<span class="step-phase">Merge equivalent states → ${groups.length} equivalence classes</span>`;
  const sumSubs = [];
  groups.forEach((g, i) => {
    const names = g.map(id => getState(id)?.name);
    const isAcc = g.some(id => App.accepts.has(id));
    sumSubs.push(`Class ${i + 1}: {${names.join(', ')}}${g.length > 1 ? ' — these states are indistinguishable (≡)' : ''}${isAcc ? ' <span class="step-acc">★ accepting</span>' : ''}`);
  });
  if (groups.length < states.length) {
    sumSubs.push(`Minimized DFA: <em>${groups.length}</em> states (reduced from ${states.length})`);
  } else {
    sumSubs.push(`DFA is already minimal — no states could be merged`);
  }
  steps.push({ type: 'summary', html: sumMain + `<span class="step-sub">${sumSubs.join('<br>')}</span>` });

  return { dist, groups, steps, savedTrans, savedStates, savedAccepts, savedStart };
}

export function loadMinimizedDFA() {
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
  applyMachineSwitch('DFA');
  emit(Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus(`Minimized: ${groups.length} states (was ${r.savedStates.length})`);
}

// --- Regex to NFA (Thompson's Construction) ---
export function algoRE2NFA(c) {
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

export function doThompson() {
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
    html += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadThompsonNFA()">${ALGO_ICON_LOAD_CANVAS}Load into Canvas</button></div>`;
    $('re-result').innerHTML = html;
    App._lastThompson = nfaData;
  } catch (err) { $('re-result').innerHTML = `<div class="card" style="color:var(--red);font-size:.75rem">Parse error: ${err.message}</div>`; }
}

// Thompson's Construction
export let _tnc = 0;
export function tnew() { return 'n' + (++_tnc); }
export function thompsonBuild(re) {
  _tnc = 0;
  const ast = parseRE(re);
  const nfa = buildThompson(ast);
  return nfa;
}
export function parseRE(re) {
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
    if (re[pos] === ')') throw new Error("Unexpected ')'");
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
    if (re[pos] === '.') { pos++; return { t: 'any' }; }
    return { t: 'lit', ch: re[pos++] };
  }
  const parsed = parseUnion();
  if (pos !== re.length) throw new Error(`Unexpected token '${re[pos]}'`);
  return parsed;
}
export function buildThompson(ast) {
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
    case 'any': {
      const chars = getAllChars();
      if (chars.length === 0) throw new Error("'.' requires a non-empty alphabet Σ");
      if (chars.length === 1) return buildThompson({ t: 'lit', ch: chars[0] });
      const unions = chars.map(c => ({ t: 'lit', ch: c })).reduce((a, b) => ({ t: 'union', l: a, r: b }));
      return buildThompson(unions);
    }
    case 'bound': {
      if (ast.min === 0 && ast.max === 1) return buildThompson({ t: 'opt', c: ast.c });
      if (ast.min === 0 && ast.max === Infinity) return buildThompson({ t: 'star', c: ast.c });
      if (ast.min === 1 && ast.max === Infinity) return buildThompson({ t: 'plus', c: ast.c });
      let resultAst = null;
      for (let i = 0; i < ast.min; i++) {
        const copy = JSON.parse(JSON.stringify(ast.c));
        resultAst = resultAst ? { t: 'cat', l: resultAst, r: copy } : copy;
      }
      if (ast.max > ast.min && ast.max !== Infinity) {
        for (let i = ast.min; i < ast.max; i++) {
          const copy = JSON.parse(JSON.stringify(ast.c));
          const optAst = { t: 'opt', c: copy };
          resultAst = resultAst ? { t: 'cat', l: resultAst, r: optAst } : optAst;
        }
      }
      if (!resultAst) return buildThompson({ t: 'eps' });
      return buildThompson(resultAst);
    }
    case 'cat': { const L = buildThompson(ast.l), R = buildThompson(ast.r); return { states: [...L.states, ...R.states], trans: [...L.trans, { from: L.accept, sym: App.config.sym.eps, to: R.start }, ...R.trans], start: L.start, accept: R.accept }; }
    case 'union': { const L = buildThompson(ast.l), R = buildThompson(ast.r), s = tnew(), e = tnew(); return { states: [s, ...L.states, ...R.states, e], trans: [{ from: s, sym: App.config.sym.eps, to: L.start }, { from: s, sym: App.config.sym.eps, to: R.start }, ...L.trans, ...R.trans, { from: L.accept, sym: App.config.sym.eps, to: e }, { from: R.accept, sym: App.config.sym.eps, to: e }], start: s, accept: e }; }
    case 'star': { const I = buildThompson(ast.c), s = tnew(), e = tnew(); return { states: [s, ...I.states, e], trans: [{ from: s, sym: App.config.sym.eps, to: I.start }, { from: s, sym: App.config.sym.eps, to: e }, { from: I.accept, sym: App.config.sym.eps, to: I.start }, { from: I.accept, sym: App.config.sym.eps, to: e }, ...I.trans], start: s, accept: e }; }
    case 'plus': { return buildThompson({ t: 'cat', l: JSON.parse(JSON.stringify(ast.c)), r: { t: 'star', c: JSON.parse(JSON.stringify(ast.c)) } }); }
    case 'opt': { return buildThompson({ t: 'union', l: ast.c, r: { t: 'eps' } }); }
    default: throw new Error('Unknown AST node: ' + ast.t);
  }
}
export function getAllChars() {
  const chars = new Set();
  for (let i = 32; i <= 126; i++) chars.add(String.fromCharCode(i));
  return [...chars];
}

export function loadThompsonNFA() {
  const d = App._lastThompson; if (!d) return;
  snapshot();
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null; App.stateN = 0; App.transN = 0;
  applyMachineSwitch('ε-NFA');
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
  emit(Change.ALPHABET, Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('NFA loaded from Thompson\'s construction!');
}

// --- NFA → Regex ---
export function algoNFA2RE(c) {
  c.innerHTML = `<div class="algo-title">NFA → Regular Expression</div>
<div class="algo-sub">GNFA STATE ELIMINATION METHOD</div>
<div class="info-box">Convert the NFA to a <em>Generalized NFA (GNFA)</em> with a new start and accept state, then eliminate states one by one, merging their transitions into regular expressions on edges.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }
  const rex = deriveRegex();
  c.innerHTML += `<div class="card"><div class="card-title">Derived Regular Expression</div>
<div style="font-size:1.1rem;color:var(--gold);padding:12px;background:var(--bg3);border-radius:6px;word-break:break-all;">${rex}</div></div>`;
  if (isClassicPDA(App.machine)) { c.innerHTML += '<div class="card" style="color:var(--text2)">Note: DPDA and NPDA recognize context-free languages, not regular languages. The regex shown is derived from NFA/DFA states only.</div>'; }
}

// --- ε-NFA to NFA ---
export function buildEpsNFAEliminationResult() {
  if (!App.startId) return null;

  const syms = [...App.sigma].filter(sym => sym !== App.config.sym.eps);
  const steps = [];
  const newTransitions = [];
  const newAccepts = new Set();
  const closureMap = {};

  const p1Subs = [];
  App.states.forEach(s => {
    const cl = epsClosure(new Set([s.id]));
    closureMap[s.id] = cl;
    p1Subs.push(`E(${s.name}) = {${[...cl].map(id => getState(id)?.name).join(', ')}}`);
  });
  steps.push(`<span class="step-phase">Phase 1: Compute ε-closures</span><span class="step-sub">${p1Subs.join('<br>')}</span>`);

  const p2Subs = [];
  App.states.forEach(s => {
    const cl = closureMap[s.id];
    const isAcc = [...cl].some(id => App.accepts.has(id));
    if (isAcc) {
      newAccepts.add(s.id);
      if (!App.accepts.has(s.id)) {
        p2Subs.push(`State <em>${s.name}</em> promoted to <span class="step-acc">★ Accept</span> (ε-reachable to an original accept state)`);
      } else {
        p2Subs.push(`State <em>${s.name}</em> remains <span class="step-acc">★ Accept</span>`);
      }
    }
  });
  if (!p2Subs.length) p2Subs.push('No new accept states discovered from ε-paths');
  steps.push(`<span class="step-phase">Phase 2: Update Accept States</span><span class="step-sub">${p2Subs.join('<br>')}</span>`);

  steps.push('<span class="step-phase">Phase 3: Resolve Direct Transitions</span>');
  let totalNewTrans = 0;
  App.states.forEach(s => {
    syms.forEach(sym => {
      const reachedFromEps = closureMap[s.id];
      const midDestinations = new Set();

      reachedFromEps.forEach(epsTgtId => {
        App.transitions.filter(t => t.from === epsTgtId && t.symbol === sym).forEach(t => {
          midDestinations.add(t.to);
        });
      });

      const finalDestinations = epsClosure(midDestinations);

      if (finalDestinations.size > 0) {
        finalDestinations.forEach(destId => {
          newTransitions.push({ from: s.id, to: destId, symbol: sym });
        });

        const pathSubs = [];
        pathSubs.push(`ε-reach: {${[...reachedFromEps].map(id => getState(id)?.name).join(', ')}}`);
        pathSubs.push(`Read '${sym}' → {${[...midDestinations].map(id => getState(id)?.name).join(', ') || '∅'}}`);
        pathSubs.push(`ε-reach from midpoints → {${[...finalDestinations].map(id => getState(id)?.name).join(', ')}}`);
        pathSubs.push(`<b>Result:</b> Adding ${finalDestinations.size} direct transition(s) to targets`);
        steps.push(`Routing ${s.name} on '${sym}'<span class="step-sub">${pathSubs.join('<br>')}</span>`);
        totalNewTrans += finalDestinations.size;
      }
    });
  });

  const epsCount = App.transitions.filter(t => t.symbol === App.config.sym.eps).length;
  steps.push(`<span class="step-phase">Phase 4: Cleanup & Summary</span><span class="step-sub">Discarded ${epsCount} original ε-transition(s)<br>Generated ${totalNewTrans} new direct transition(s) mapping the combined paths<br>Final NFA contains ${App.states.length} states and ${newTransitions.length} transitions</span>`);

  return { steps, transitions: newTransitions, accepts: newAccepts };
}

export function algoEpsNFA2NFA(c) {
  c.innerHTML = `<div class="algo-title">ε-NFA → NFA</div>
<div class="algo-sub">EPSILON ELIMINATION</div>
<div class="info-box">Any NFA with epsilon transitions can be converted into an equivalent NFA without epsilon transitions. This is done by adding direct transitions that bypass the original ε-paths, and promoting states to accept states if they can reach an accept state purely via ε.</div>`;
  if (!App.startId) { c.innerHTML += '<div class="card dec-card-empty">No start state defined.</div>'; return; }
  const result = buildEpsNFAEliminationResult();
  if (!result) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }

  App._lastEpsElim = {
    transitions: result.transitions.map(t => ({ ...t })),
    accepts: new Set(result.accepts)
  };

  c.innerHTML += `<div class="card"><div class="card-title">Algorithm Steps</div>
<div class="step-list">${result.steps.map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')}</div></div>
<div style="margin-top:8px"><button class="algo-btn" onclick="loadEpsEliminatedNFA()">Load NFA without ε-transitions</button></div>`;
}

export function loadEpsEliminatedNFA() {
  const r = buildEpsNFAEliminationResult();
  if (!r) return showStatus('No start state defined.');

  snapshot();

  App.transitions = r.transitions.map((t, i) => ({ id: 't' + (i + 1), from: t.from, to: t.to, symbol: t.symbol }));
  App.transN = App.transitions.length;
  App.accepts = new Set(r.accepts);

  applyMachineSwitch('NFA');
  updateLPanel(); updateRPanel();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('NFA loaded into canvas! (ε-transitions eliminated)');
}

// --- DFA Complement ---
export function algoComplement(c) {
  c.innerHTML = `<div class="algo-title">DFA Complement</div>
<div class="algo-sub">CLOSURE UNDER COMPLEMENT</div>
<div class="info-box">The complement of a DFA is obtained by <em>swapping accept and non-accept states</em>. First, ensure the DFA is complete (add a dead/trap state if needed).</div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card">Switch to DFA mode.</div>'; return; }
  const comp = App.states.map(s => ({ ...s, accept: !App.accepts.has(s.id) }));
  const html = comp.map(s => `<div class="state-pill ${s.accept ? 'acc' : ''}">${s.name} → ${s.accept ? 'ACCEPT' : 'REJECT'}</div>`).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Complemented States</div><div class="nfa-result-states">${html}</div>
<div style="font-size:.7rem;color:var(--text2);margin-top:10px">Note: Original accept states become non-accepting and vice versa. All transitions remain the same.</div></div>
<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadComplement()">${ALGO_ICON_LOAD_CANVAS}Load Complement into Canvas</button></div>`;
}
export function loadComplement() {
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
  App.accepts = newAcc; emit(Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('Complement loaded (DFA completed with trap state if needed)!');
}

// --- Product Construction ---
export function algoProduct(c) {
  c.innerHTML = `<div class="algo-title">Product Construction</div>
<div class="algo-sub">CLOSURE UNDER INTERSECTION AND UNION</div>
<div class="info-box">Given two DFAs M₁ and M₂ over the same alphabet, their <em>product automaton</em> M₁×M₂ simulates both simultaneously. States are pairs (q₁,q₂). Used to prove closure under ∩ (both accept) and ∪ (either accepts).</div>
<div class="card"><div class="card-title">Algorithm</div>
<div class="step-list">
  ${['States: Q₁×Q₂ (pairs of states from each DFA)', 'Start state: (q₀¹, q₀²)', 'Transitions: δ((p,q),a) = (δ₁(p,a), δ₂(q,a))', 'Accept (Intersection): (p,q)∈F iff p∈F₁ AND q∈F₂', 'Accept (Union): (p,q)∈F iff p∈F₁ OR q∈F₂', 'Accept (Difference L₁\\L₂): p∈F₁ AND q∉F₂'].map((s, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')}
</div></div>`;
}

// --- DFA Equivalence ---
export function algoEquiv(c) {
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
    <input class="inp" id="eq-str" placeholder="Enter a test string" autocomplete="off"
      onkeydown="trySymSuggestKeydown(event)" oninput="handleSymSuggestActive(this)"
      onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
      onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()">
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
export function testEquivStr() {
  const str = $('eq-str').value.trim();
  const s = str === App.config.sym.eps ? '' : str;
  const tokens = tokenize(s);
  if (tokens === null) {
    $('eq-result').innerHTML = `<div style="font-size:.75rem;color:var(--red)">Cannot tokenize string using the alphabet Σ.</div>`;
    return;
  }
  // langVerdict dispatches per machine, so this reports what the simulator the
  // user can actually run would say — rather than assuming NFA semantics for
  // anything that is not a DFA.
  const verdict = langVerdict(tokens);
  if (verdict === 'unk') {
    $('eq-result').innerHTML = `<div style="font-size:.75rem;color:var(--text2)">"${str}" — no verdict within the step budget.</div>`;
    return;
  }
  const accepted = verdict === 'acc';
  $('eq-result').innerHTML = `<div style="font-size:.75rem;color:${accepted ? 'var(--green)' : 'var(--red)'}">
"${str}" is ${accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} by the current automaton.</div>`;
}
export function runProductEquiv() {
  const out = $('eq-product-result');
  if (!App.workspaceB) { out.innerHTML = '<div class="pump-result fail">Save an M₂ first using the button above.</div>'; return; }
  if (App.machine !== 'DFA') { out.innerHTML = '<div class="pump-result fail">Switch to DFA mode for product construction.</div>'; return; }
  const m1 = getCurrentMachineSnapshot();
  const m2 = App.workspaceB;
  if ((m2.machine && m2.machine !== 'DFA') || !isDeterministicMachine(m2)) {
    out.innerHTML = '<div class="pump-result fail">M₂ must be a DFA for product-based equivalence checking.</div>';
    return;
  }
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
export function getReachableStates(startId) {
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
export function getReachableStatesGeneral(startId, transitions) {
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
export function getCoReachableStates() {
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
export function hasReachableCycle(stateSet) {
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
export function findShortestAccepted(machine) {
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
export function algoIsEmpty(c) {
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

export function algoIsFinite(c) {
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

export function algoIsUniversal(c) {
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

export function algoFullEquiv(c) {
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

export function runFullEquivCheck() {
  const out = $('full-equiv-result');
  if (!App.workspaceB) { out.innerHTML = '<div class="pump-result fail">Save M₂ first.</div>'; return; }
  if (App.machine !== 'DFA') { out.innerHTML = '<div class="pump-result fail">Switch to DFA mode for product construction.</div>'; return; }
  const m1 = getCurrentMachineSnapshot();
  const m2 = App.workspaceB;
  if ((m2.machine && m2.machine !== 'DFA') || !isDeterministicMachine(m2)) {
    out.innerHTML = '<div class="pump-result fail">M₂ must be a DFA for full equivalence checking.</div>';
    return;
  }
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
export function buildProductDFA(m1, m2, mode) {
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

export function isDeterministicMachine(machine) {
  if (!machine || !machine.startId || !machine.transitions) return false;
  const seen = new Set();
  for (const t of machine.transitions) {
    if (t.symbol === App.config.sym.eps) return false;
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  CLOSURE OPERATIONS
// ══════════════════════════════════════════════════════════════════
export function m2RequiredCard(c, opName) {
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

export function algoClopStar(c) {
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadBuiltNFAResult('star')">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'star', machine: result };
}

export function algoClopReversal(c) {
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadBuiltNFAResult('reversal')">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'reversal', machine: result };
}

export function algoClopUnion(c) {
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadBuiltNFAResult('union')">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'union', machine: result };
}

export function algoClopIntersect(c) {
  const m2status = App.workspaceB ? `<span class="m2-status saved">M₂: ${App.workspaceB.states.length} states</span>` : `<span class="m2-status">No M₂</span>`;
  c.innerHTML = `<div class="algo-title">Intersection with M₂ (Product DFA)</div>
<div class="algo-sub">L(M₁) ∩ L(M₂)</div>
<div class="info-box">Build the product DFA: states are pairs (q₁, q₂). Accept iff BOTH component states are accepting.</div>
  <div class="card"><div class="card-title">M₂ Status: ${m2status}</div>
<button class="ws-save-btn" onclick="saveWorkspaceB()">Save Current as M₂</button></div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card" style="color:var(--red)">Intersection via product construction currently requires M₁ to be a DFA.</div>'; return; }
  if (!m2RequiredCard(c, 'Intersection')) return;
  if (!App.startId) { c.innerHTML += '<div class="card">Build M₁ in Build view first.</div>'; return; }
  const m1 = getCurrentMachineSnapshot(), m2 = App.workspaceB;
  if ((m2.machine && m2.machine !== 'DFA') || !isDeterministicMachine(m2)) {
    c.innerHTML += '<div class="card" style="color:var(--red)">M₂ must be a DFA for product construction.</div>';
    return;
  }
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadBuiltNFAResult('intersect')">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'intersect', machine: product };
}

export function algoClopConcat(c) {
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
  c.innerHTML += `<div style="margin-top:8px"><button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadBuiltNFAResult('concat')">${ALGO_ICON_LOAD_CANVAS}Load Result into Canvas</button></div>`;
  App._lastBuiltNFA = { key: 'concat', machine: result };
}

export function loadBuiltNFAResult(key) {
  if (!App._lastBuiltNFA || App._lastBuiltNFA.key !== key) { showStatus('Run the algorithm first.'); return; }
  const m = App._lastBuiltNFA.machine;
  loadBuiltMachine(m, 'ε-NFA');
}

export function renderBuiltNFAResult(m, title) {
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
export function buildNFAStar(machine) {
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

export function buildNFAReversal(machine) {
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

export function buildNFAUnion(m1, m2) {
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

export function buildNFAConcat(m1, m2) {
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
export function algoNFATree(c) {
  c.innerHTML = `<div class="algo-title">NFA Computation Tree</div>
<div class="algo-sub">ALL EXECUTION PATHS FOR A STRING</div>
<div class="info-box">Shows all possible computation branches of the NFA when reading an input string. Each level corresponds to reading one symbol. Branches split at nondeterministic choices. ε-closures are computed at each step.</div>
<div class="card">
  <div class="card-title">Input String</div>
  <div class="regex-input-wrap">
    <input class="inp" id="nfa-tree-input" placeholder="e.g. ab or 010" autocomplete="off"
      onkeydown="if(trySymSuggestKeydown(event))return;if(event.key==='Enter')buildNFATree()"
      oninput="handleSymSuggestActive(this)" onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
      onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()">
    <button class="algo-btn" onclick="buildNFATree()">Build Tree</button>
  </div>
</div>
<div id="nfa-tree-result"></div>`;
}

export function buildNFATree() {
  const raw = parseEps($('nfa-tree-input').value);
  const s = raw === App.config.sym.eps ? '' : raw;
  const out = $('nfa-tree-result');
  if (!App.startId) { out.innerHTML = '<div class="card">No start state defined.</div>'; return; }

  // tokenize() against Σ (same longest-match backtracking Simulate/NPDA/NDTM
  // use) so word alphabets — not just single-character ones — walk correctly:
  // each tree level below is one *token*, not one raw character.
  const tokens = tokenize(s);
  if (tokens === null) {
    out.innerHTML = `<div class="card" style="border-left-color:var(--red);font-size:.72rem;"><span style="color:var(--red);font-weight:600">Error:</span> Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</div>`;
    return;
  }

  const tree = computeNFATree(tokens);
  out.innerHTML = layoutNFATree(tree, tokens);
}

export function computeNFATree(tokens) {
  // Build a true per-state nondeterministic computation tree (#4)
  const MAX_NODES = 500; let nodeCount = 0;
  function makeNode(stateId, depth, sym) {
    nodeCount++;
    const sName = getState(stateId)?.name || stateId;
    const isAccept = App.accepts.has(stateId);
    const children = [];
    if (nodeCount < MAX_NODES && depth < tokens.length) {
      const nextSym = tokens[depth];
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

export function layoutNFATree(root, tokens) {
  const levelH = 65;
  const positions = [];
  let maxX = 0, maxY = 0;

  // Word-alphabet tokens can be much wider than the fixed-width pill a
  // single character needs — size it to fit so long edge labels (and the
  // node columns beneath them) don't overlap their neighbors.
  const pillWidth = sym => sym ? Math.max(16, [...sym].length * 7 + 8) : 16;

  // Bottom-up width calculation to prevent node overlap
  function calcWidths(node) {
    if (!node.children || !node.children.length) {
      node._w = 60;
      return node._w;
    }
    let sum = 0;
    node.children.forEach(ch => {
      calcWidths(ch);
      ch._w = Math.max(ch._w, pillWidth(ch.sym));
      sum += ch._w + 10;
    });
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
        const w = pillWidth(ch.sym);
        // background pill for text
        edges += `<rect x="${mx - w / 2}" y="${my - 8}" width="${w}" height="16" rx="4" fill="var(--bg2)" />`;
        edges += `<text x="${mx}" y="${my + 3}" fill="var(--gold)" font-family="var(--mono)" font-size="0.75rem" text-anchor="middle">${escapeHtml(ch.sym)}</text>`;
      }
    });

    const isFinal = node.depth === tokens.length;
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
        if (node.isAccept) { stroke = 'var(--green)'; fill = 'var(--green-soft)'; textCol = 'var(--green)'; }
        else { stroke = 'var(--red)'; fill = 'var(--red-soft)'; textCol = 'var(--red)'; }
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
    nodes += `<text x="${node._x}" y="${node._y + 4}" fill="${textCol}" font-family="var(--mono)" font-size="${node.isRoot ? '0.7rem' : '0.75rem'}" text-anchor="middle">${escapeHtml(displayLabel)}</text>`;
  });

  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${svgW} ${svgH}" style="min-width:${svgW}px; height:${svgH}px">${edges}${nodes}</svg></div>`;
}

// ══════════════════════════════════════════════════════════════════
//  NDTM SIMULATION
// ══════════════════════════════════════════════════════════════════
export function algoNPDA(c) {
  c.innerHTML = `<div class="algo-title">Nondeterministic Pushdown Automaton</div>
<div class="algo-sub">BFS OVER STACKED COMPUTATION BRANCHES</div>
<div class="info-box">An NPDA may have multiple enabled moves for the same state, unread input, and stack top. It accepts if <em>any</em> branch reaches acceptance. This is the full stack-machine model equivalent in power to context-free grammars.</div>`;
  if (App.machine !== 'NPDA') { c.innerHTML += `<div class="card"><div style="font-size:.72rem;color:var(--text2)">Switch to NPDA mode to use this simulator.</div></div>`; return; }

  const ndPairs = findPdaNondeterministicPairs();
  const ndHtml = ndPairs.length
    ? ndPairs.map(([a, b], idx) => {
      const fromName = getState(a.from)?.name || a.from;
      return `<div class="step-item"><div class="step-num">${idx + 1}</div><div class="step-text">${fromName}: (${a.symbol}, ${a.pop}) overlaps with (${b.symbol}, ${b.pop})<span class="step-sub">These transitions can both be enabled on at least one stack/input configuration.</span></div></div>`;
    }).join('')
    : '<div style="color:var(--text3);font-size:.7rem">No overlapping stack moves found â€” this NPDA currently behaves deterministically.</div>';

  c.innerHTML += `<div class="card"><div class="card-title">Overlapping NPDA Moves</div><div class="step-list">${ndHtml}</div></div>`;
  c.innerHTML += `<div class="card">
<div class="card-title">Simulate NPDA (BFS over all branches)</div>
<div class="regex-input-wrap">
  <input class="inp" id="npda-input" placeholder="Input string (e.g. aabb or ε)" autocomplete="off"
    onkeydown="trySymSuggestKeydown(event)" oninput="handleSymSuggestActive(this)"
    onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
    onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()">
  <button class="algo-btn" onclick="runNPDASim()">Simulate</button>
</div>
<div id="npda-result" style="margin-top:8px"></div>
</div>`;
}

export function runNPDASim() {
  const raw = parseEps($('npda-input').value);
  const s = raw === App.config.sym.eps ? '' : raw;
  const out = $('npda-result');
  if (!App.startId) { out.innerHTML = '<div style="color:var(--red);">No start state.</div>'; return; }
  const tokens = tokenize(s);
  if (tokens === null) {
    out.innerHTML = `<div style="color:var(--red);font-size:.72rem">Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</div>`;
    return;
  }
  const result = simNPDA(tokens);
  out.innerHTML = `<div class="pump-result ${result.accepted ? 'ok' : 'fail'}">
${result.accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} â€” ${result.branches} branches explored, max depth ${result.maxDepth}, witness length ${result.witnessLength}
</div>
<div class="card" style="margin-top:8px"><div class="card-title">Branch Summary (first 10 explored branches)</div>
<div class="step-list">${result.log.slice(0, 10).map((l, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${l}</div></div>`).join('')}</div>
</div>`;
}

export function algoNDTM(c) {
  c.innerHTML = `<div class="algo-title">Nondeterministic Turing Machine</div>
<div class="algo-sub">BFS OVER ALL COMPUTATION BRANCHES</div>
<div class="info-box">A NDTM is a TM where δ is a relation: the same (state, symbol) pair may have multiple possible transitions. An NDTM accepts if ANY computation branch reaches an accept state. Equivalent in power to a deterministic TM.</div>`;
  if (App.machine !== 'NDTM') { c.innerHTML += `<div class="card"><div style="font-size:.72rem;color:var(--text2)">Switch to NDTM mode to use this simulator.</div></div>`; return; }
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
  }).join('') : '<div style="color:var(--text3);font-size:.7rem">No branching transitions found — this NDTM is currently deterministic.</div>';
  c.innerHTML += `<div class="card"><div class="card-title">Nondeterministic Transitions (same state+symbol, multiple outputs)</div><div class="step-list">${ndHtml}</div></div>`;
  c.innerHTML += `<div class="card">
<div class="card-title">Simulate NDTM (BFS over all branches)</div>
<div class="regex-input-wrap">
  <input class="inp" id="ndtm-input" placeholder="Input string (e.g. 001)" autocomplete="off"
    onkeydown="trySymSuggestKeydown(event)" oninput="handleSymSuggestActive(this)"
    onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
    onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()">
  <button class="algo-btn" onclick="runNDTMSim()">Simulate</button>
</div>
<div id="ndtm-result" style="margin-top:8px"></div>
</div>`;
}

export function runNDTMSim() {
  const raw = parseEps($('ndtm-input').value);
  const s = raw === App.config.sym.eps ? '' : raw;
  const out = $('ndtm-result');
  if (!App.startId) { out.innerHTML = '<div style="color:var(--red);">No start state.</div>'; return; }
  const tokens = tokenize(s);
  if (tokens === null) {
    out.innerHTML = `<div style="color:var(--red);font-size:.72rem">Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.</div>`;
    return;
  }
  const result = simNDTM(tokens);
  out.innerHTML = `<div class="pump-result ${result.accepted ? 'ok' : 'fail'}">
${result.accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'} — ${result.branches} branches explored, max depth ${result.maxDepth}
</div>
<div class="card" style="margin-top:8px"><div class="card-title">Branch Summary (first 10 branches)</div>
<div class="step-list">${result.log.slice(0, 10).map((l, i) => `<div class="step-item"><div class="step-num">${i + 1}</div><div class="step-text">${l}</div></div>`).join('')}</div>
</div>`;
}

export function simNDTMLegacy(tokens) {
  // BFS over configurations {state, tape, head}
  const init = { state: App.startId, tape: tokens.length ? [...tokens] : [], head: 0 };
  const queue = [init];
  let branches = 0, maxDepth = 0, accepted = false;
  const log = [];
  while (queue.length && branches < 2000) {
    const cfg = queue.shift();
    const { state, tape, head } = cfg;
    branches++;
    const t = [...tape]; while (t.length <= head) t.push(App.config.sym.blank);
    const sym = t[head];
    const depth = cfg.depth || 0;
    maxDepth = Math.max(maxDepth, depth);
    const stateName = getState(state)?.name || state;
    const idStr = `${t.slice(0, head).join('')}[${stateName}]${t.slice(head).join('')}`;

    if (App.accepts.has(state)) {
      accepted = true;
      let main = `<span class="step-acc">Branch ${branches}: ACCEPT ✓</span>`;
      const subs = [];
      subs.push(`State "${stateName}" is an accept state — computation halts`);
      subs.push(`Reached at depth ${depth} · ID: ${idStr}`);
      log.push(main + `<span class="step-sub">${subs.join('<br>')}</span>`);
      break;
    }

    if (depth >= 150) {
      let main = `Branch ${branches}: <span class="step-dead">cut off (depth limit)</span>`;
      const subs = [];
      subs.push(`Depth ${depth} ≥ 150 — pruning this branch to prevent infinite exploration`);
      subs.push(`ID: ${idStr}`);
      log.push(main + `<span class="step-sub">${subs.join('<br>')}</span>`);
      continue;
    }

    const matching = App.transitions.filter(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));

    if (!matching.length) {
      let main = `Branch ${branches}: <span class="step-dead">stuck (no transition)</span>`;
      const subs = [];
      subs.push(`State "${stateName}", read '${sym}' — no matching δ(${stateName}, '${sym}')`);
      subs.push(`This branch is a dead end · depth ${depth} · ID: ${idStr}`);
      log.push(main + `<span class="step-sub">${subs.join('<br>')}</span>`);
      continue;
    }

    matching.forEach(tr => {
      const nt = [...t];
      nt[head] = (!tr.write || tr.write === App.config.sym.any) ? sym : tr.write;
      const move = tr.dir === 'R' ? 1 : (tr.dir === 'L' ? -1 : 0);
      const nh = head + move;
      queue.push({ state: tr.to, tape: nt, head: Math.max(0, nh), depth: depth + 1 });
    });

    let main = `Branch ${branches}: exploring state <em>${stateName}</em>`;
    const subs = [];
    subs.push(`Read '${sym}' at head position ${head} · depth ${depth}`);
    if (matching.length > 1) {
      subs.push(`<em>Nondeterministic choice:</em> ${matching.length} transitions match — spawning ${matching.length} child branches`);
      matching.forEach((tr, i) => {
        const toName = getState(tr.to)?.name || tr.to;
        const writeStr = (!tr.write || tr.write === App.config.sym.any) ? sym : tr.write;
        subs.push(`  Choice ${i + 1}: write '${writeStr}', move ${tr.dir}, → ${toName}`);
      });
    } else {
      const tr = matching[0], toName = getState(tr.to)?.name || tr.to;
      const writeStr = (!tr.write || tr.write === App.config.sym.any) ? sym : tr.write;
      subs.push(`Deterministic: write '${writeStr}', move ${tr.dir}, → ${toName}`);
    }
    subs.push(`ID: ${idStr}`);
    log.push(main + `<span class="step-sub">${subs.join('<br>')}</span>`);
  }
  return { accepted, branches, maxDepth, log };
}



// ══════════════════════════════════════════════════════════════════
//  UTM SIMULATOR
// ══════════════════════════════════════════════════════════════════
export const UTM_DEFAULT_TM = JSON.stringify({
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

export const UTM_EXAMPLES = [
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

export function algoUTM(c) {
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
<button class="algo-btn" onclick="runUTMSim()" style="display:flex;align-items:center;justify-content:center;gap:6px"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/></svg> Run UTM</button>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:8px">
<button class="sbtn" onclick="utmStepBack()" data-tip="Step back"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg></button>
<button class="sbtn" onclick="utmStepFwd()" data-tip="Step forward"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg></button>
<button class="sbtn" id="utm-auto-btn" onclick="utmToggleAuto()" data-tip="Auto-play" style="display:flex;align-items:center;justify-content:center;gap:4px"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/></svg> Auto</button>
<button class="sbtn" onclick="utmResetView()" data-tip="Reset"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z"/></svg></button>
  </div>
  <div id="utm-tape-wrap" style="display:flex;flex-wrap:nowrap;overflow-x:auto;gap:2px;min-height:36px;margin-bottom:8px;padding:4px 0;"></div>
  <div id="utm-result"></div>
</div>`;
}

export function loadUTMExample() {
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
export let utmSteps = [], utmIdx = 0, utmAutoTimer = null;

export function runUTMSim() {
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

export function utmValidateTM(tm) {
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

export function simUTM(tm, w) {
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

export function renderUTMStep() {
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

export function utmStepFwd() { if (utmIdx < utmSteps.length - 1) { utmIdx++; renderUTMStep(); } }
export function utmStepBack() { if (utmIdx > 0) { utmIdx--; renderUTMStep(); } }
export function utmResetView() { utmResetTimer(); utmSteps = []; utmIdx = 0; const el = document.getElementById('utm-result'); if (el) el.innerHTML = ''; const t = document.getElementById('utm-tape-wrap'); if (t) t.innerHTML = ''; }
export const UTM_ICON_PLAY = '<svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/></svg>';
export const UTM_ICON_PAUSE = '<svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z"/></svg>';
export function utmResetTimer() { if (utmAutoTimer) { clearInterval(utmAutoTimer); utmAutoTimer = null; } const b = document.getElementById('utm-auto-btn'); if (b) { b.classList.remove('playing'); b.innerHTML = `${UTM_ICON_PLAY} Auto`; } }
export function utmToggleAuto() {
  if (utmAutoTimer) { utmResetTimer(); return; }
  const b = document.getElementById('utm-auto-btn');
  if (b) { b.classList.add('playing'); b.innerHTML = `${UTM_ICON_PAUSE} Stop`; }
  utmAutoTimer = setInterval(() => {
    if (utmIdx >= utmSteps.length - 1) { utmResetTimer(); return; }
    utmIdx++; renderUTMStep();
  }, 400);
}



// ══════════════════════════════════════════════════════════════════
//  MOORE MACHINE ALGORITHMS
// ══════════════════════════════════════════════════════════════════
export function algoMooreTable(c) {
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

export function algoMoore2Mealy(c) {
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

export function loadMooreAsMealy() {
  if (App.machine !== 'Moore') return;
  snapshot();
  App.transitions.forEach(t => { t.output = getState(t.to)?.output || ''; });
  applyMachineSwitch('Mealy');
  updateLPanel();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('Loaded as Mealy machine. Transition outputs set from destination state outputs.');
}


// ══════════════════════════════════════════════════════════════════
//  MEALY MACHINE ALGORITHMS
// ══════════════════════════════════════════════════════════════════
export function algoMealyTable(c) {
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

export function algoMealy2Moore(c) {
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

export function computeMealy2Moore() {
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
    const outs = incomingOutputs[s.id];
    if (!outs || outs.size === 0) {
      if (s.id === App.startId) return;
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

export function loadMealyAsMoore() {
  const r = App._lastMealy2Moore; if (!r) return;
  snapshot();
  App.states = r.states.map((s, i) => ({ ...s, x: 120 + (i % 4) * 180, y: 120 + Math.floor(i / 4) * 160 }));
  App.transitions = r.transitions;
  App.startId = r.startId;
  App.accepts = r.accepts;
  App.stateN = r.states.length; App.transN = r.transitions.length;
  applyMachineSwitch('Moore');
  updateLPanel();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('Loaded as Moore machine.');
}


// ══════════════════════════════════════════════════════════════════
//  MULTI-TAPE TM TABLE
// ══════════════════════════════════════════════════════════════════
export function algoMTMTable(c) {
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
// ══════════════════════════════════════════════════════════════════
//  TM → UNRESTRICTED GRAMMAR (TYPE 0)
// ══════════════════════════════════════════════════════════════════
export function algoTM2Grammar(c) {
  c.innerHTML = `<div class="algo-title">TM &rarr; Unrestricted Grammar</div>
<div class="algo-sub">CHOMSKY TYPE 0 REPRESENTATION</div>
<div class="info-box">Any language accepted by a Turing Machine can be generated by an Unrestricted (Type 0) Grammar. This construction uses a marker-based approach to simulate the head movement and tape contents using phrase-structure rules.</div>`;
  if (!isAnyTM(App.machine)) { c.innerHTML += `<div class="card">Switch to TM, NDTM, or MTM mode to use this conversion.</div>`; return; }
  if (App.machine === 'MTM') {
    c.innerHTML += `<div class="card">This construction currently supports only single-tape TMs. Multi-tape TMs need a separate encoding before they can be converted to a Type 0 grammar.</div>`;
    return;
  }

  const eps = App.config.sym.eps;
  const blank = App.config.sym.blank;
  const sigma = [...App.sigma];
  const gamma = [...new Set([
    ...App.sigma,
    blank,
    ...App.transitions.map(t => t.symbol).filter(x => x && x !== eps),
    ...App.transitions.map(t => t.write).filter(x => x && x !== eps)
  ])];
  const q0 = getState(App.startId)?.name || 'q0';

  const prods = [];
  // 1. Initial configuration: generate an arbitrary input word w ∈ Σ* to the right of q0.
  prods.push({ lhs: 'S', rhs: `⟨L⟩ ${q0} ⟨W⟩ ⟨R⟩` });
  prods.push({ lhs: '⟨L⟩', rhs: blank });
  sigma.forEach(sym => {
    if (sym !== eps) prods.push({ lhs: '⟨W⟩', rhs: `${sym} ⟨W⟩` });
  });
  prods.push({ lhs: '⟨W⟩', rhs: '' });

  // 2. Expand tape end markers to allow infinite movement
  prods.push({ lhs: '⟨R⟩', rhs: `${blank} ⟨R⟩` });
  prods.push({ lhs: '⟨R⟩', rhs: '⟨E⟩' }); // End marker

  // 3. Transitions
  App.transitions.forEach(t => {
    const q = getState(t.from)?.name;
    const p = getState(t.to)?.name;
    const a = t.symbol || blank;
    const b = t.write || a;
    if (t.dir === 'R') {
      // Right move: q a -> b p
      prods.push({ lhs: `${q} ${a}`, rhs: `${b} ${p}` });
    } else {
      // Left move: c q a -> p c b
      gamma.forEach(c => {
        prods.push({ lhs: `${c} ${q} ${a}`, rhs: `${p} ${c} ${b}` });
      });
    }
  });

  // 4. Acceptance: q_acc -> T (Terminal generation phase)
  App.accepts.forEach(aid => {
    const qacc = getState(aid)?.name;
    prods.push({ lhs: qacc, rhs: '⟨ACC⟩' });
  });

  // 5. Cleanup rules to extract trailing symbols
  prods.push({ lhs: '⟨ACC⟩', rhs: '' }); // Erase state
  gamma.forEach(g => {
    if (g !== blank) prods.push({ lhs: `⟨ACC⟩ ${g}`, rhs: `${g} ⟨ACC⟩` });
    else prods.push({ lhs: `⟨ACC⟩ ${g}`, rhs: '⟨ACC⟩' });
  });

  const html = prods.map(p => `<tr><td>${p.lhs}</td><td class="prod-arrow">&rarr;</td><td>${p.rhs || eps}</td></tr>`).join('');
  c.innerHTML += `<div class="card"><div class="card-title">Generated Type 0 Productions (${prods.length})</div>
<table class="result-table"><thead><tr><th>LHS</th><th></th><th>RHS</th></tr></thead><tbody>${html}</tbody></table></div>`;

  c.innerHTML += `<div class="info-box"><b>Note</b>: This is a 1-tape simulation construction. The language generated by this grammar is { w | M accepts w }. Type 0 grammars can have multiple symbols on the LHS.</div>`;
}

// ══════════════════════════════════════════════════════════════════
//  DFA MINIMIZATION VISUALIZER
// ══════════════════════════════════════════════════════════════════
export let _minViz = null;

export function algoMinimizeVisual(c) {
  c.innerHTML = `<div class="algo-title">DFA Minimization: Table Filling</div>
<div class="algo-sub">INTERACTIVE STEP-BY-STEP VISUALIZER</div>`;
  if (App.machine !== 'DFA') { c.innerHTML += '<div class="card">Switch to DFA mode to use minimization.</div>'; return; }
  if (App.states.length < 2) { c.innerHTML += '<div class="card">Need at least 2 states.</div>'; return; }

  const res = tableFillingMinimize();
  _minViz = { ...res, idx: 0 };

  c.innerHTML += `<div class="card">
    <div class="sctrl">
      <button class="sbtn" onclick="minVisStep(-1)" style="display:flex;align-items:center;justify-content:center;gap:4px"><svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg> Back</button>
      <button class="sbtn" id="min-vis-play" onclick="minVisStep(1)" style="display:flex;align-items:center;justify-content:center;gap:4px">Start Step-by-Step <svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg></button>
      <button class="sbtn sec" onclick="renderAlgo('minimizeVisual')">Reset</button>
    </div>
    <div id="min-vis-status" style="font-size:.7rem;color:var(--text2);margin-bottom:12px;min-height:2em">Click Start to begin the Myhill-Nerode process.</div>
  </div>
  <div class="card">
    <div id="min-vis-table-wrap" class="min-table-wrap"></div>
  </div>`;
  renderMinVisTable();
}

export function renderMinVisTable() {
  const { dist, idx, steps } = _minViz;
  const states = App.states;
  const tableWrap = $('min-vis-table-wrap');
  if (!tableWrap) return;

  const header = `<tr><th></th>${states.slice(0, -1).map(s => `<th>${s.name}</th>`).join('')}</tr>`;
  const rows = states.slice(1).map((s, i) => {
    const cells = states.slice(0, i + 1).map(t => {
      const key = [s.id, t.id].sort().join('|');
      // Only show marks up to the current step index
      const isMarked = dist[key];
      // We need to know WHEN it was marked. 
      // Simplified: if current step mentions this pair, highlight it.
      let content = '≡', cls = 'unmarked';
      if (isMarked) {
        // Find if it was marked in steps[0...idx]
        // This is a bit complex based on existing tableFillingMinimize.
        // For the visualizer, we rebuild the partial 'dist' based on steps.
        const currentDist = getDistAtStep(idx);
        if (currentDist[key]) { content = '✗'; cls = 'marked'; }
      }
      return `<td id="cell-${key}" class="${cls}">${content}</td>`;
    }).join('');
    return `<tr><th>${s.name}</th>${cells}</tr>`;
  }).join('');

  tableWrap.innerHTML = `<table class="min-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

export function getDistAtStep(stepIdx) {
  const states = App.states, ids = states.map(s => s.id);
  const d = {};
  // 1. Initial Dist (Accept vs Non-Accept)
  if (stepIdx >= 0) {
    ids.forEach((a, i) => ids.slice(0, i).forEach(b => {
      const k = [a, b].sort().join('|');
      if (App.accepts.has(a) !== App.accepts.has(b)) d[k] = true;
    }));
  }
  // 2. Further marks via step objects
  for (let s = 1; s <= stepIdx; s++) {
    const msg = _minViz.steps[s];
    if (msg.type === 'mark') {
      d[[msg.p1, msg.p2].sort().join('|')] = true;
    }
  }
  return d;
}

export function minVisStep(delta) {
  _minViz.idx = Math.max(0, Math.min(_minViz.steps.length - 1, _minViz.idx + delta));
  const status = $('min-vis-status');
  status.innerHTML = `<b>Step ${_minViz.idx + 1}/${_minViz.steps.length}</b>: ${_minViz.steps[_minViz.idx].html}`;
  $('min-vis-play').textContent = _minViz.idx === 0 ? 'Start Step-by-Step →' : 'Next Step →';
  renderMinVisTable();
}

// ══════════════════════════════════════════════════════════════════
//  THOMPSON CONSTRUCTION VISUALIZER
// ══════════════════════════════════════════════════════════════════
export let _thViz = null;

export function algoRE2NFAVisual(c) {
  c.innerHTML = `<div class="algo-title">Thompson Construction Visualizer</div>
<div class="algo-sub">STEP-BY-STEP ASSEMBLY</div>
<div class="info-box">Each regex operator is mapped to an NFA fragment. Step through the construction to see how primitive NFAs are composed into larger fragments via ε-transitions.</div>
<div class="card">
  <div class="card-title">Input Regular Expression</div>
  <div class="regex-input-wrap">
    <input class="inp regex-inp" id="rev-input" placeholder="e.g. (a|b)*abb" onkeydown="if(event.key==='Enter')startThompsonViz()">
    <button class="algo-btn" onclick="startThompsonViz()">Build Steps</button>
  </div>
  <div style="font-size:.67rem;color:var(--text3);margin-top:8px">
    Supports <b>|</b> union &nbsp; <b>*</b> Kleene star &nbsp; <b>+</b> one-or-more &nbsp; <b>?</b> optional &nbsp; <b>()</b> grouping &nbsp; <b>[a-z]</b> char class
  </div>
</div>
<div id="rev-result"></div>`;
}

export function startThompsonViz() {
  const re = $('rev-input')?.value?.trim();
  const out = $('rev-result');
  if (!re) { showStatus('Enter a regex first'); return; }
  try {
    _tnc = 0;
    const ast = parseRE(re);
    const steps = [];
    const finalNFA = buildThompsonVisual(ast, steps);
    if (!steps.length) {
      out.innerHTML = `<div class="card" style="color:var(--red)">No steps generated. Try a more complex regex.</div>`;
      return;
    }
    // Store the final NFA on the last step so "Load into Canvas" always works
    steps[steps.length - 1].final = finalNFA;
    _thViz = { steps, idx: 0 };
    renderThViz();
  } catch (e) {
    out.innerHTML = `<div class="card" style="color:var(--red)">Parse error: ${e.message}</div>`;
  }
}

// Maps AST node type to a human-readable label
export function thAstLabel(t) {
  const map = { lit: 'LITERAL', eps: 'EPSILON', union: 'UNION (|)', cat: 'CONCAT', star: 'KLEENE *', plus: 'ONE-OR-MORE +', opt: 'OPTIONAL ?', class: 'CHAR CLASS', bound: 'BOUND {n,m}', any: 'ANY (.)' };
  return map[t] || t.toUpperCase();
}

export function buildThompsonVisual(ast, steps) {
  if (!ast) return null;

  if (ast.t === 'lit') {
    const s = tnew(), e = tnew();
    const nfa = { states: [s, e], trans: [{ from: s, sym: ast.ch, to: e }], start: s, accept: e };
    steps.push({ ast, nfa, note: `Create literal fragment for '${ast.ch}': ${s} —'${ast.ch}'→ ${e}<span class="step-sub">2 states, 1 transition · start: ${s}, accept: ${e}<br>Matches exactly one occurrence of symbol '${ast.ch}'</span>` });
    return nfa;
  }

  if (ast.t === 'eps') {
    const s = tnew(), e = tnew();
    const nfa = { states: [s, e], trans: [{ from: s, sym: App.config.sym.eps, to: e }], start: s, accept: e };
    steps.push({ ast, nfa, note: `Create epsilon fragment: ${s} —ε→ ${e}<span class="step-sub">2 states, 1 ε-transition · start: ${s}, accept: ${e}<br>Matches the empty string — no input consumed</span>` });
    return nfa;
  }

  if (ast.t === 'union') {
    const L = buildThompsonVisual(ast.l, steps);
    const R = buildThompsonVisual(ast.r, steps);
    const s = tnew(), e = tnew();
    const nfa = {
      states: [s, ...L.states, ...R.states, e],
      trans: [
        { from: s, sym: App.config.sym.eps, to: L.start },
        { from: s, sym: App.config.sym.eps, to: R.start },
        ...L.trans, ...R.trans,
        { from: L.accept, sym: App.config.sym.eps, to: e },
        { from: R.accept, sym: App.config.sym.eps, to: e }
      ],
      start: s, accept: e
    };
    steps.push({ ast, nfa, note: `Union (|): merge two sub-fragments<span class="step-sub">New start <em>${s}</em> forks via ε to left branch (${L.start}) and right branch (${R.start})<br>Both accept states (${L.accept}, ${R.accept}) converge via ε to new accept <em>${e}</em><br>Result: ${nfa.states.length} states, ${nfa.trans.length} transitions — matches either alternative</span>` });
    return nfa;
  }

  if (ast.t === 'cat') {
    const L = buildThompsonVisual(ast.l, steps);
    const R = buildThompsonVisual(ast.r, steps);
    const nfa = {
      states: [...L.states, ...R.states],
      trans: [...L.trans, { from: L.accept, sym: App.config.sym.eps, to: R.start }, ...R.trans],
      start: L.start, accept: R.accept
    };
    steps.push({ ast, nfa, note: `Concatenation: chain two sub-fragments in sequence<span class="step-sub">Left fragment accept (${L.accept}) bridged via ε to right fragment start (${R.start})<br>Combined start: <em>${L.start}</em> · Combined accept: <em>${R.accept}</em><br>Result: ${nfa.states.length} states, ${nfa.trans.length} transitions — matches left then right</span>` });
    return nfa;
  }

  if (ast.t === 'star') {
    const M = buildThompsonVisual(ast.c, steps);
    const s = tnew(), e = tnew();
    const nfa = {
      states: [s, ...M.states, e],
      trans: [
        { from: s, sym: App.config.sym.eps, to: M.start },
        { from: s, sym: App.config.sym.eps, to: e },
        ...M.trans,
        { from: M.accept, sym: App.config.sym.eps, to: M.start },
        { from: M.accept, sym: App.config.sym.eps, to: e }
      ],
      start: s, accept: e
    };
    steps.push({ ast, nfa, note: `Kleene star (*): wrap sub-fragment with loop and bypass<span class="step-sub">New start <em>${s}</em> has two ε-paths: bypass to <em>${e}</em> (zero repetitions) or enter fragment at ${M.start}<br>Fragment accept ${M.accept} has ε-loop back to ${M.start} (repetition) and ε-exit to <em>${e}</em><br>Result: ${nfa.states.length} states, ${nfa.trans.length} transitions — matches zero or more repetitions</span>` });
    return nfa;
  }

  if (ast.t === 'plus') {
    // M+ = M · M*
    const cCopy = JSON.parse(JSON.stringify(ast.c));
    return buildThompsonVisual({ t: 'cat', l: ast.c, r: { t: 'star', c: cCopy } }, steps);
  }

  if (ast.t === 'opt') {
    // M? = M | ε
    return buildThompsonVisual({ t: 'union', l: ast.c, r: { t: 'eps' } }, steps);
  }

  if (ast.t === 'class') {
    const chars = ast.neg ? getAllChars().filter(c => !ast.chars.includes(c)) : ast.chars;
    if (!chars.length) throw new Error('Empty character class');
    if (chars.length === 1) return buildThompsonVisual({ t: 'lit', ch: chars[0] }, steps);
    const unions = chars.slice(1).reduce((acc, c) => ({ t: 'union', l: acc, r: { t: 'lit', ch: c } }), { t: 'lit', ch: chars[0] });
    return buildThompsonVisual(unions, steps);
  }

  if (ast.t === 'any') {
    const chars = getAllChars();
    if (!chars.length) throw new Error("'.' requires a non-empty alphabet Σ");
    if (chars.length === 1) return buildThompsonVisual({ t: 'lit', ch: chars[0] }, steps);
    const unions = chars.slice(1).reduce((acc, c) => ({ t: 'union', l: acc, r: { t: 'lit', ch: c } }), { t: 'lit', ch: chars[0] });
    const nfa = buildThompsonVisual(unions, steps);
    steps[steps.length - 1].note = `Dot '.': expands to union over Σ = {${chars.join(',')}}`;
    return nfa;
  }

  if (ast.t === 'bound') {
    // Expand {n,m} to cats and opts, mirroring buildThompson
    if (ast.min === 0 && ast.max === 1) return buildThompsonVisual({ t: 'opt', c: ast.c }, steps);
    if (ast.min === 0 && ast.max === Infinity) return buildThompsonVisual({ t: 'star', c: ast.c }, steps);
    if (ast.min === 1 && ast.max === Infinity) return buildThompsonVisual({ t: 'plus', c: ast.c }, steps);
    let result = null;
    for (let i = 0; i < ast.min; i++) {
      const cp = JSON.parse(JSON.stringify(ast.c));
      result = result ? buildThompsonVisual({ t: 'cat', l: result, r: cp }, steps) : buildThompsonVisual(cp, steps);
    }
    if (ast.max > ast.min && ast.max !== Infinity) {
      for (let i = ast.min; i < ast.max; i++) {
        const cp = JSON.parse(JSON.stringify(ast.c));
        const opt = buildThompsonVisual({ t: 'opt', c: cp }, steps);
        result = result ? buildThompsonVisual({ t: 'cat', l: result, r: opt }, steps) : opt;
      }
    }
    return result || buildThompsonVisual({ t: 'eps' }, steps);
  }

  // Unknown node type — emit epsilon as safe fallback
  const s = tnew(), e = tnew();
  const nfa = { states: [s, e], trans: [{ from: s, sym: App.config.sym.eps, to: e }], start: s, accept: e };
  steps.push({ ast: { t: 'eps' }, nfa, note: `Unknown node type '${ast.t}' — emitting ε` });
  return nfa;
}

export function renderThViz() {
  const { steps, idx } = _thViz;
  const step = steps[idx];
  const out = $('rev-result');
  if (!out) return;

  const typeLabel = thAstLabel(step.ast.t);
  const isLast = idx === steps.length - 1;
  const progress = `${idx + 1} / ${steps.length}`;

  const transRows = step.nfa.trans.map(t => {
    const isStart = t.from === step.nfa.start, isAccept = t.to === step.nfa.accept;
    return `<tr>
      <td class="${isStart ? 'start-cell' : ''}">${t.from}</td>
      <td style="color:var(--gold)">${t.sym}</td>
      <td class="${isAccept ? 'acc-cell' : ''}">${t.to}</td>
    </tr>`;
  }).join('');

  out.innerHTML = `
    <div class="card">
      <div class="card-title">Construction Step ${progress}</div>
      <div class="step-item" style="margin-bottom:12px">
        <div class="step-num">${idx + 1}</div>
        <div class="step-text">
          <span style="color:var(--accent);font-weight:700">${typeLabel}</span><br>
          ${step.note}
        </div>
      </div>
      <div class="sctrl">
        <button class="sbtn" onclick="thVizStep(-1)" ${idx === 0 ? 'disabled' : ''} style="display:flex;align-items:center;justify-content:center;gap:4px"><svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg> Back</button>
        <button class="sbtn ${isLast ? '' : 'auto-btn'}" onclick="thVizStep(1)" ${isLast ? 'disabled' : ''} style="display:flex;align-items:center;justify-content:center;gap:4px">Next <svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg></button>
        <button class="sbtn sec" onclick="startThompsonViz()">Restart</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">NFA Fragment &mdash; States: ${step.nfa.states.length} &nbsp;&nbsp; Transitions: ${step.nfa.trans.length}</div>
      <div style="font-size:.68rem;color:var(--text3);margin-bottom:8px">
        Start: <span style="color:var(--green)">${step.nfa.start}</span> &nbsp;&nbsp;
        Accept: <span style="color:var(--gold)">${step.nfa.accept}</span>
      </div>
      <table class="result-table">
        <thead><tr><th>From</th><th>Symbol</th><th>To</th></tr></thead>
        <tbody>${transRows || '<tr><td colspan="3" class="dead-cell">No transitions</td></tr>'}</tbody>
      </table>
    </div>
    ${isLast ? `<button class="algo-btn" style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:6px" onclick="loadThompsonNFA_Viz()"><svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/></svg> Load Final NFA into Canvas</button>` : ''}
  `;
}

export function thVizStep(delta) {
  if (!_thViz) return;
  _thViz.idx = Math.max(0, Math.min(_thViz.steps.length - 1, _thViz.idx + delta));
  renderThViz();
}

export function loadThompsonNFA_Viz() {
  if (!_thViz) return;
  App._lastThompson = _thViz.steps[_thViz.steps.length - 1].nfa;
  loadThompsonNFA();
}


// ══════════════════════════════════════════════════════════════════
//  ε-CLOSURE TABLE
// ══════════════════════════════════════════════════════════════════
export function algoEpsClosure(c) {
  const eps = App.config.sym.eps;
  c.innerHTML = `<div class="algo-title">ε-Closure Table</div>
<div class="algo-sub">ε-CLOSURE OF EACH STATE IN ε-NFA</div>
<div class="info-box">The ε-closure of state <em>q</em> is the set of all states reachable from <em>q</em> using ε-transitions only (including <em>q</em> itself). It is used in the subset construction to convert an ε-NFA to a DFA.</div>`;

  if (App.machine !== 'ε-NFA') {
    c.innerHTML += `<div class="card"><div style="font-size:.72rem;color:var(--text2)">Switch to <b>ε-NFA</b> mode to use this tool. The canvas currently has <b>${App.machine}</b> selected.</div></div>`;
    return;
  }
  if (!App.states.length) { c.innerHTML += '<div class="card">No states defined.</div>'; return; }

  // Compute ε-closure for each state (BFS)
  function epsClosure(stateId) {
    const closure = new Set([stateId]);
    const queue = [stateId];
    while (queue.length) {
      const s = queue.shift();
      App.transitions
        .filter(t => t.from === s && t.symbol === eps)
        .forEach(t => { if (!closure.has(t.to)) { closure.add(t.to); queue.push(t.to); } });
    }
    return closure;
  }

  const closures = App.states.map(s => ({ state: s, closure: epsClosure(s.id) }));

  // Table header – one column per state
  const stateNames = App.states.map(s => s.name);
  const headerCells = stateNames.map(n => `<th>${n}</th>`).join('');
  const rows = closures.map(({ state, closure }) => {
    const inClosure = App.states.map(s => closure.has(s.id));
    const memberCells = inClosure.map((has, i) =>
      `<td style="color:${has ? 'var(--green)' : 'var(--text3)'}; font-weight:${has ? '600' : '400'}">${has ? '✓' : '—'}</td>`
    ).join('');
    const closureNames = App.states.filter(s => closure.has(s.id)).map(s => s.name).join(', ');
    const isStart = state.id === App.startId;
    const isAccept = App.accepts.has(state.id);
    const badge = isStart ? ' →' : '';
    const abadge = isAccept ? ' *' : '';
    return `<tr>
      <th style="color:${isStart ? 'var(--green)' : isAccept ? 'var(--gold)' : 'var(--text)'}">${state.name}${badge}${abadge}</th>
      ${memberCells}
      <td style="color:var(--accent);font-family:var(--mono)">{${closureNames}}</td>
    </tr>`;
  }).join('');

  c.innerHTML += `<div class="card">
  <div class="card-title">ε-CLOSURE(q) Membership Table</div>
  <div class="subset-table-wrap">
    <table class="result-table">
      <thead><tr><th>State q</th>${headerCells}<th>ε-CLOSURE(q)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="font-size:.62rem;color:var(--text3);margin-top:8px">→ = start state &nbsp;&nbsp; * = accept state</div>
</div>`;

  // Show the resulting NFA (move function applied where each row = ε-closure of δ(closure, a))
  const sigma = [...App.sigma].filter(sym => sym !== eps);
  if (sigma.length) {
    const moveRows = closures.map(({ state, closure }) => {
      const cells = sigma.map(sym => {
        // move(closure, sym) = union of ε-closure of all δ(s, sym) for s in closure
        const reachable = new Set();
        closure.forEach(sid => {
          App.transitions
            .filter(t => t.from === sid && t.symbol === sym)
            .forEach(t => { epsClosure(t.to).forEach(id => reachable.add(id)); });
        });
        if (!reachable.size) return `<td style="color:var(--text3)">∅</td>`;
        const names = App.states.filter(s => reachable.has(s.id)).map(s => s.name).join(',');
        const isAcc = App.states.some(s => reachable.has(s.id) && App.accepts.has(s.id));
        return `<td style="color:${isAcc ? 'var(--gold)' : 'var(--text)'}">{${names}}</td>`;
      }).join('');
      return `<tr><th>${state.name}</th>${cells}</tr>`;
    }).join('');

    const symHeaders = sigma.map(sym => `<th>δ̂(q, '${sym}')</th>`).join('');
    c.innerHTML += `<div class="card">
  <div class="card-title">Extended Transition Function δ̂ (after applying ε-closure)</div>
  <div class="subset-table-wrap">
    <table class="result-table">
      <thead><tr><th>State q</th>${symHeaders}</tr></thead>
      <tbody>${moveRows}</tbody>
    </table>
  </div>
</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
//  DFA → RIGHT-LINEAR GRAMMAR
// ══════════════════════════════════════════════════════════════════
export function algoDFA2RG(c) {
  const eps = App.config.sym.eps;
  c.innerHTML = `<div class="algo-title">DFA / NFA &rarr; Regular Grammar</div>
<div class="algo-sub">RIGHT-LINEAR GRAMMAR DERIVATION (TYPE 3)</div>
<div class="info-box">A right-linear grammar has productions of the form <em>A → aB</em> or <em>A → a</em> or <em>A → ε</em>. Every DFA corresponds exactly to such a grammar where states become non-terminals and transitions become productions.</div>`;

  if (!App.states.length) { c.innerHTML += '<div class="card">No states defined.</div>'; return; }
  if (!App.startId) { c.innerHTML += '<div class="card">No start state defined.</div>'; return; }

  const prods = [];
  // For each transition q --a--> p: add production   q → a p
  App.transitions.forEach(t => {
    const from = getState(t.from)?.name, to = getState(t.to)?.name;
    if (from && to) prods.push({ lhs: from, rhs: `${t.symbol} ${to}` });
  });
  // For every accept state: add q → ε
  App.accepts.forEach(aid => {
    const name = getState(aid)?.name;
    if (name) prods.push({ lhs: name, rhs: eps });
  });

  const startName = getState(App.startId)?.name || 'S';
  const vars = [...new Set(App.states.map(s => s.name))];
  const terms = [...App.sigma];

  // Group by LHS for display
  const byLHS = {};
  prods.forEach(p => { if (!byLHS[p.lhs]) byLHS[p.lhs] = []; byLHS[p.lhs].push(p.rhs); });

  const displayRows = prods.map(p =>
    `<tr><td style="color:var(--accent)">${p.lhs}</td><td style="color:var(--text3)">→</td><td>${p.rhs.replace(/ (\w+)$/, (_, nt) => ` <span style="color:var(--accent)">${nt}</span>`)}</td></tr>`
  ).join('');

  const grouped = Object.entries(byLHS).map(([lhs, rhss]) => {
    const rhs = rhss.join(' | ');
    return `<div style="font-family:var(--mono);font-size:.75rem;margin-bottom:4px"><span style="color:var(--accent)">${lhs}</span> <span style="color:var(--text3)">→</span> ${rhs}</div>`;
  }).join('');

  c.innerHTML += `<div class="card">
  <div class="card-title">Right-Linear Grammar G = (V, Σ, R, S)</div>
  <div style="font-size:.68rem;color:var(--text2);margin-bottom:10px;line-height:1.8">
    V = {${vars.join(', ')}} &nbsp;&nbsp; Σ = {${terms.join(', ')}} &nbsp;&nbsp; S = ${startName}
  </div>
  <div style="padding:12px;background:var(--bg3);border-radius:8px;margin-bottom:10px">${grouped}</div>
  <div class="card-title">Production Table (${prods.length} total)</div>
  <table class="result-table"><thead><tr><th>LHS</th><th></th><th>RHS</th></tr></thead>
  <tbody>${displayRows}</tbody></table>
</div>`;

  c.innerHTML += `<div class="info-box"><b>Reading the grammar:</b> Each non-terminal represents a DFA state. <em>A → a B</em> means "from state A, reading 'a', go to state B". <em>A → ε</em> means "state A is an accept state" — the empty string ends the derivation here.</div>`;
}

// ══════════════════════════════════════════════════════════════════
//  REGULAR GRAMMAR → NFA
// ══════════════════════════════════════════════════════════════════
export let _rgNFAData = null;

export function algoRG2NFA(c) {
  c.innerHTML = `<div class="algo-title">Regular Grammar &rarr; NFA</div>
<div class="algo-sub">RIGHT-LINEAR / LEFT-LINEAR TO AUTOMATON</div>
<div class="info-box">Enter a regular grammar using either right-linear productions (<em>A → aB</em>, <em>A → a</em>, <em>A → ε</em>) or left-linear productions (<em>A → Ba</em>, <em>A → a</em>, <em>A → ε</em>). Use one orientation consistently. Each variable becomes a state, plus one helper state.</div>
<div class="card">
  <div class="card-title">Grammar Input</div>
  <div style="font-size:.67rem;color:var(--text3);margin-bottom:8px">Format: one production per line&nbsp; e.g. <code>S → aA | b</code> or <code>A → ε</code></div>
  <textarea id="rg-input" class="batch-in" style="min-height:110px;resize:vertical" placeholder="S → aA | bB | ε&#10;A → aA | a&#10;B → bB | b"></textarea>
  <div style="display:flex;gap:6px;margin-top:6px">
    <input class="inp" id="rg-start" placeholder="Start symbol (e.g. S)" style="width:140px">
    <button class="algo-btn" onclick="buildRG2NFA()">Build NFA</button>
  </div>
</div>
<div id="rg-result"></div>`;
}

export function buildRG2NFA() {
  const raw = $('rg-input')?.value?.trim();
  const startSym = $('rg-start')?.value?.trim() || 'S';
  const out = $('rg-result');
  const eps = App.config.sym.eps;
  if (!raw) { out.innerHTML = '<div class="card" style="color:var(--red)">Enter a grammar first.</div>'; return; }

  try {
    const prods = [];
    raw.split('\n').forEach(line => {
      const line2 = line.trim(); if (!line2) return;
      const arrow = line2.includes('→') ? '→' : '->';
      const parts = line2.split(arrow);
      if (parts.length < 2) return;
      const lhs = parts[0].trim().toUpperCase();
      const alternatives = parts.slice(1).join(arrow).split('|').map(s => s.trim());
      alternatives.forEach(rhs => {
        if (rhs) prods.push({ lhs, rhs });
      });
    });
    if (!prods.length) throw new Error('No valid productions found.');

    const vars = new Set(prods.map(p => p.lhs));
    const helperState = '__helper__';
    const varNames = [...vars].sort((a, b) => b.length - a.length);
    const startVar = startSym.toUpperCase();
    const ruleKinds = new Set();

    function parseRegularRHS(rhs) {
      if (rhs === eps) return { kind: 'epsilon' };

      const rightVar = varNames.find(v => rhs.endsWith(v) && rhs !== v);
      const leftVar = varNames.find(v => rhs.startsWith(v) && rhs !== v);

      if (rightVar) {
        const terminal = rhs.slice(0, rhs.length - rightVar.length).trim();
        if (terminal) return { kind: 'right', terminal, variable: rightVar };
      }
      if (leftVar) {
        const terminal = rhs.slice(leftVar.length).trim();
        if (terminal) return { kind: 'left', terminal, variable: leftVar };
      }
      return { kind: 'terminal', terminal: rhs.trim() };
    }

    const parsedProds = prods.map(p => {
      const parsed = parseRegularRHS(p.rhs);
      if (parsed.kind === 'right' || parsed.kind === 'left') ruleKinds.add(parsed.kind);
      return { ...p, parsed };
    });

    if (ruleKinds.size > 1) {
      throw new Error('Mixed right-linear and left-linear productions are not supported in a single grammar.');
    }

    const orientation = ruleKinds.has('left') ? 'left' : 'right';
    const stateMap = {}; // varName → id
    let sid = 1;
    [...vars].forEach(v => { stateMap[v] = 's' + sid++; });
    stateMap[helperState] = 's' + sid++;

    const states = [...vars].map(v => ({ id: stateMap[v], name: v }));
    states.push({ id: stateMap[helperState], name: orientation === 'left' ? 'qStart' : 'qAcc' });

    const accepts = orientation === 'left'
      ? new Set([stateMap[startVar] || stateMap[[...vars][0]]])
      : new Set([stateMap[helperState]]);
    const startId = orientation === 'left'
      ? stateMap[helperState]
      : (stateMap[startVar] || stateMap[[...vars][0]]);
    const transitions = [];
    let tn = 1;

    parsedProds.forEach(({ lhs, rhs, parsed }) => {
      const from = stateMap[lhs];
      if (!from) return;

      if (orientation === 'left') {
        if (parsed.kind === 'epsilon') {
          transitions.push({ id: 't' + tn++, from: stateMap[helperState], to: from, symbol: eps });
        } else if (parsed.kind === 'left') {
          transitions.push({ id: 't' + tn++, from: stateMap[parsed.variable], to: from, symbol: parsed.terminal });
        } else if (parsed.kind === 'terminal') {
          transitions.push({ id: 't' + tn++, from: stateMap[helperState], to: from, symbol: parsed.terminal });
        } else {
          throw new Error(`Production "${lhs} → ${rhs}" is not left-linear.`);
        }
      } else if (parsed.kind === 'epsilon') {
        transitions.push({ id: 't' + tn++, from, to: stateMap[helperState], symbol: eps });
      } else if (parsed.kind === 'right') {
        transitions.push({ id: 't' + tn++, from, to: stateMap[parsed.variable], symbol: parsed.terminal });
      } else if (parsed.kind === 'terminal') {
        transitions.push({ id: 't' + tn++, from, to: stateMap[helperState], symbol: parsed.terminal });
      } else {
        throw new Error(`Production "${lhs} → ${rhs}" is not right-linear.`);
      }
    });

    _rgNFAData = { states, transitions, accepts, startId };

    const sigma = [...new Set(transitions.map(t => t.symbol).filter(s => s !== eps))];
    const transRows = transitions.map(t => {
      const fn = states.find(s => s.id === t.from)?.name || '?';
      const tn2 = states.find(s => s.id === t.to)?.name || '?';
      const isAcc = accepts.has(t.to);
      return `<tr>
        <td>${fn}</td>
        <td style="color:var(--gold)">${t.symbol}</td>
        <td class="${isAcc ? 'acc-cell' : ''}">${tn2}</td>
      </tr>`;
    }).join('');

    out.innerHTML = `<div class="card">
  <div class="card-title">Constructed NFA — States: ${states.length} Transitions: ${transitions.length}</div>
  <div style="font-size:.68rem;color:var(--text3);margin-bottom:8px">
    Start: <span style="color:var(--green)">${states.find(s => s.id === startId)?.name}</span> &nbsp;&nbsp;
    Accept: <span style="color:var(--gold)">${[...accepts].map(id => states.find(s => s.id === id)?.name).join(', ')}</span> &nbsp;&nbsp;
    Σ = {${sigma.join(', ')}}
  </div>
  <table class="result-table">
    <thead><tr><th>From</th><th>Symbol</th><th>To</th></tr></thead>
    <tbody>${transRows}</tbody>
  </table>
  <div style="margin-top:10px">
    <button class="algo-btn" style="display:flex;align-items:center;justify-content:center" onclick="loadRG2NFAToCanvas()">${ALGO_ICON_LOAD_CANVAS}Load into Canvas</button>
  </div>
</div>`;
  } catch (e) {
    out.innerHTML = `<div class="card" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

export function loadRG2NFAToCanvas() {
  if (!_rgNFAData) return;
  snapshot();
  const { states, transitions, accepts, startId } = _rgNFAData;
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null;
  App.stateN = 0; App.transN = 0;

  const cols = Math.max(Math.ceil(Math.sqrt(states.length)), 2);
  states.forEach((s, i) => {
    App.states.push({ id: s.id, name: s.name, x: 120 + (i % cols) * 170, y: 120 + Math.floor(i / cols) * 150 });
    App.stateN = Math.max(App.stateN, parseInt(s.id.slice(1)) || 0);
    if (s.id === startId) App.startId = s.id;
    if (accepts.has(s.id)) App.accepts.add(s.id);
  });
  transitions.forEach((t, i) => {
    App.transitions.push({ ...t });
    App.transN = Math.max(App.transN, i + 1);
    const sym = t.symbol;
    if (sym && sym !== App.config.sym.eps) App.sigma.add(sym);
  });

  App.machine = transitions.some(t => t.symbol === App.config.sym.eps) ? 'ε-NFA' : 'NFA';
  setMachine(App.machine);
  emit(Change.ALPHABET, Change.GRAPH);
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('Regular Grammar NFA loaded!');
}

// ══════════════════════════════════════════════════════════════════
//  DEAD STATE ANALYSIS
// ══════════════════════════════════════════════════════════════════

/** Compute a Map<stateId → 'live'|'dead'|'unreachable'> for current machine. */
export function computeStateClassification() {
  const map = new Map();
  if (!App.startId) {
    App.states.forEach(s => map.set(s.id, 'unreachable'));
    return map;
  }
  const reachable = getReachableStates(App.startId);    // BFS forward
  const productive = getCoReachableStates();              // BFS backward from accepts

  App.states.forEach(s => {
    if (!reachable.has(s.id)) map.set(s.id, 'unreachable');
    else if (!productive.has(s.id)) map.set(s.id, 'dead');
    else map.set(s.id, 'live');
  });
  return map;
}

/** Activate the canvas overlay from the current classification. */
export function highlightDeadStates() {
  App.stateClassification = computeStateClassification();
  renderAll();
}

/** Remove the canvas overlay. */
export function clearStateHighlights() {
  App.stateClassification = null;
  renderAll();
}

/** Algo panel renderer. */
export function algoDeadStates(c) {
  c.innerHTML = `<div class="algo-title">Dead State Analysis</div>
<div class="algo-sub">REACHABILITY &amp; PRODUCTIVITY CLASSIFICATION</div>
<div class="info-box">
  Every state falls into exactly one category:<br>
  <b style="color:var(--green)">Live</b> — reachable from start AND can reach an accept state.<br>
  <b style="color:var(--text3)">Dead</b> — reachable, but trapped: no accept state is accessible from here.<br>
  <b style="color:var(--orange, #ff9800)">Unreachable</b> — cannot be reached from the start state by any input.
</div>`;

  if (!App.states.length) {
    c.innerHTML += '<div class="card">No states defined on the canvas.</div>';
    return;
  }
  if (!App.startId) {
    c.innerHTML += '<div class="card" style="color:var(--red)">No start state defined — all states are unreachable.</div>';
    return;
  }

  const classification = computeStateClassification();

  const live = App.states.filter(s => classification.get(s.id) === 'live');
  const dead = App.states.filter(s => classification.get(s.id) === 'dead');
  const unreachable = App.states.filter(s => classification.get(s.id) === 'unreachable');

  // Summary pills
  const pill = (label, count, color) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);border-radius:8px;border:1px solid var(--border2)">
      <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <span style="font-family:var(--mono);font-size:.72rem;color:var(--text2)">${label}</span>
      <span style="margin-left:auto;font-family:var(--mono);font-size:.82rem;font-weight:700;color:${color}">${count}</span>
    </div>`;

  c.innerHTML += `<div class="card">
  <div class="card-title">Summary (${App.states.length} states total)</div>
  <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
    ${pill('Live', live.length, 'var(--green)')}
    ${pill('Dead (non-productive)', dead.length, 'var(--text3)')}
    ${pill('Unreachable', unreachable.length, 'var(--orange, #ff9800)')}
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="algo-btn" onclick="highlightDeadStates()" id="dsa-highlight-btn" style="display:flex;align-items:center;justify-content:center;gap:6px">
      <svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg> Highlight on Canvas
    </button>
    <button class="algo-btn sec" onclick="clearStateHighlights()" style="display:flex;align-items:center;justify-content:center;gap:6px">
      <svg viewBox="0 0 256 256" width="13" height="13" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg> Clear Highlights
    </button>
  </div>
</div>`;

  // Detailed per-state table
  const catLabel = { live: 'Live', dead: 'Dead', unreachable: 'Unreachable' };
  const catColor = { live: 'var(--green)', dead: 'var(--text3)', 'unreachable': 'var(--orange, #ff9800)' };

  const rows = App.states.map(s => {
    const cat = classification.get(s.id);
    const isStart = s.id === App.startId;
    const isAccept = App.accepts.has(s.id);
    const markers = [isStart ? '→ start' : '', isAccept ? '★ accept' : ''].filter(Boolean).join('  ');
    return `<tr>
      <td style="font-family:var(--mono)">${s.name}</td>
      <td style="color:${isStart ? 'var(--green)' : 'var(--text3)'};font-size:.68rem">${markers || '—'}</td>
      <td><span style="color:${catColor[cat]};font-weight:600;font-size:.72rem">${catLabel[cat]}</span></td>
      <td style="font-size:.66rem;color:var(--text3)">${cat === 'unreachable' ? 'Not reachable from start' : cat === 'dead' ? 'No path to any accept state' : 'Reachable + productive'}</td>
    </tr>`;
  }).join('');

  c.innerHTML += `<div class="card">
  <div class="card-title">Per-State Breakdown</div>
  <div class="subset-table-wrap">
    <table class="result-table">
      <thead><tr><th>State</th><th>Role</th><th>Category</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;

  // Useless transitions analysis
  const uselessTrans = App.transitions.filter(t => {
    const fromCat = classification.get(t.from);
    const toCat = classification.get(t.to);
    return fromCat !== 'live' || toCat !== 'live';
  });

  if (uselessTrans.length) {
    const transRows = uselessTrans.map(t => {
      const fn = getState(t.from)?.name || '?';
      const tn = getState(t.to)?.name || '?';
      const reason = classification.get(t.from) !== 'live'
        ? `Source state ${fn} is ${classification.get(t.from)}`
        : `Target state ${tn} is ${classification.get(t.to)}`;
      return `<tr>
        <td style="font-family:var(--mono)">${fn}</td>
        <td style="color:var(--gold)">${t.symbol}</td>
        <td style="font-family:var(--mono)">${tn}</td>
        <td style="font-size:.66rem;color:var(--text3)">${reason}</td>
      </tr>`;
    }).join('');

    c.innerHTML += `<div class="card">
  <div class="card-title">Useless Transitions (${uselessTrans.length})</div>
  <div style="font-size:.67rem;color:var(--text3);margin-bottom:8px">These transitions involve at least one dead or unreachable state and can be removed without changing the language.</div>
  <div class="subset-table-wrap">
    <table class="result-table">
      <thead><tr><th>From</th><th>Symbol</th><th>To</th><th>Why Useless</th></tr></thead>
      <tbody>${transRows}</tbody>
    </table>
  </div>
</div>`;
  } else {
    c.innerHTML += `<div class="info-box">✓ No useless transitions — all transitions involve live states.</div>`;
  }

  // If there are no dead/unreachable states, say so
  if (!dead.length && !unreachable.length) {
    c.innerHTML += `<div class="info-box" style="color:var(--green)">
      ✓ All ${App.states.length} states are live — this machine is already minimal (no dead or unreachable states).
    </div>`;
  }
}
