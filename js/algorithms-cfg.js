// ══════════════════════════════════════════════════════════════════
//  GRAMMAR VIEW
// ══════════════════════════════════════════════════════════════════
const G = App.grammar;

function renderGramSyms() {
  $('term-chips').innerHTML = [...App.sigma].map(s => `<div class="chip" style="color:var(--gold)">${s}</div>`).join('')
    || '<span style="font-size:.65rem;color:var(--text3);font-style:italic">Mirror from Σ</span>';
}
function addNT() {
  const v = $('nt-in').value.trim(); if (!v) return;
  G.vars.add(v.toUpperCase()); $('nt-in').value = '';
  renderGrammarLPanel(); renderGrammarView();
}
function delNT(v) {
  G.vars.delete(v); G.productions = G.productions.filter(p => p.lhs !== v);
  if (G.start === v) G.start = [...G.vars][0] || '';
  renderGrammarLPanel(); renderGrammarView();
}
function addProduction() {
  const lhs = $('prod-lhs').value.trim().toUpperCase();
  const rhs = $('prod-rhs').value.trim();
  if (!lhs || !rhs) return;
  if (!G.vars.has(lhs)) { G.vars.add(lhs); }
  rhs.split('|').forEach(alt => {
    const trimmed = alt.trim();
    if (trimmed) G.productions.push({ id: 'p' + Date.now() + '_' + Math.random(), lhs, rhs: trimmed });
  });
  $('prod-rhs').value = '';
  renderGrammarLPanel(); renderGrammarView();
}
function delProd(id) { G.productions = G.productions.filter(p => p.id !== id); renderGrammarLPanel(); renderGrammarView(); }
function renderGrammarLPanel() {
  $('nt-chips').innerHTML = [...G.vars].map(v => `<div class="chip" style="color:var(--accent)">${v}<span class="x" onclick="delNT('${v}')">×</span></div>`).join('');
  const pl = $('prod-list');
  pl.innerHTML = G.productions.length ? G.productions.map(p => `
<div class="prod-item"><span style="color:var(--accent)">${p.lhs}</span>
<span class="prod-arrow">→</span><span class="prod-rhs">${p.rhs}</span>
<span class="prod-del" onclick="delProd('${p.id}')">×</span></div>`).join('')
    : '<div class="empty-msg">No productions</div>';
  const ss = $('start-sym');
  ss.innerHTML = [...G.vars].map(v => `<option value="${v}" ${v === G.start ? 'selected' : ''}>${v}</option>`).join('');
  ss.onchange = () => { G.start = ss.value; };
}

function renderGrammarView() {
  const out = $('gram-output'); if (!out) return;
  if (!G.productions.length) { out.innerHTML = '<div style="font-size:.72rem;color:var(--text3);font-style:italic">Add productions to see the grammar.</div>'; return; }
  // Group by LHS
  const byLHS = {};
  G.productions.forEach(p => { if (!byLHS[p.lhs]) byLHS[p.lhs] = []; byLHS[p.lhs].push(p.rhs); });
  let html = '<div class="grammar-display">';
  Object.entries(byLHS).forEach(([lhs, rhss]) => {
    const colored = rhss.map(rhs => {
      return rhs.split('').map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : c === App.config.sym.eps ? `<span class="eps">${App.config.sym.eps}</span>` : `<span class="t">${c}</span>`).join('');
    }).join(' | ');
    html += `<div><span class="nt">${lhs}</span> <span style="color:var(--text3)">→</span> ${colored}</div>`;
  });
  html += `</div><div style="font-size:.7rem;color:var(--text2);margin-bottom:12px">G = ({${[...G.vars].join(',')}}, {${[...App.sigma].join(',')}}, R, ${G.start})</div>`;
  out.innerHTML = html;
}

// --- CNF Conversion ---
function runCNF() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add productions first'); return; }
  G.start = ($('start-sym').value) || G.start;
  let prods = G.productions.map(p => ({ lhs: p.lhs, rhs: p.rhs }));
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">CNF Conversion Steps</h3>';
  const steps = [];

  // Step 1: Add new start
  const S0 = G.start + '₀';
  prods = [{ lhs: S0, rhs: G.start }, ...prods];
  steps.push({ lbl: 'Step 1: New start', desc: `Add ${S0} → ${G.start} to avoid start symbol in RHS`, prods: [...prods] });

  // Step 2: Eliminate ε-productions (find nullable)
  const nullable = new Set();
  prods.forEach(p => { if (p.rhs === App.config.sym.eps) nullable.add(p.lhs); });
  let changed = true;
  while (changed) { changed = false; prods.forEach(p => { if (!nullable.has(p.lhs) && p.rhs.split('').every(c => nullable.has(c) || !c)) { nullable.add(p.lhs); changed = true; } }); }
  const prods2 = [], seen2 = new Set();
  prods.forEach(p => {
    if (p.rhs === App.config.sym.eps) { if (p.lhs === S0) prods2.push(p); return; }
    // Generate all subsets of nullable positions
    const chars = [...p.rhs];
    const nullableIdx = chars.map((c, i) => nullable.has(c) ? i : -1).filter(i => i >= 0);
    const total = 1 << nullableIdx.length; // 2^k subsets
    for (let mask = 0; mask < total; mask++) {
      const kept = chars.filter((c, i) => {
        const ni = nullableIdx.indexOf(i);
        return ni === -1 || !(mask & (1 << ni)); // keep if not nullable or not masked out
      });
      const r = kept.join('');
      if (!r) { // all omitted → ε, only allow for new start
        if (p.lhs === S0) { const k2 = p.lhs + '→' + App.config.sym.eps; if (!seen2.has(k2)) { seen2.add(k2); prods2.push({ lhs: p.lhs, rhs: App.config.sym.eps }); } }
        continue;
      }
      const key = p.lhs + '→' + r;
      if (!seen2.has(key)) { seen2.add(key); prods2.push({ lhs: p.lhs, rhs: r }); }
    }
  });
  steps.push({ lbl: 'Step 2: Remove ε-productions', desc: `Nullable: {${[...nullable].join(',')}}. Add combinations without nullable symbols.`, prods: [...prods2] });

  // Step 3: Eliminate unit rules
  const prods3 = []; const unitVisited = new Set();
  function closeUnit(A) {
    const reach = new Set([A]);
    let ch = true;
    while (ch) { ch = false; prods2.forEach(p => { if (reach.has(p.lhs) && G.vars.has(p.rhs) && !reach.has(p.rhs)) { reach.add(p.rhs); ch = true; } }); }
    return reach;
  }
  [...G.vars, S0].forEach(A => {
    const reach = closeUnit(A);
    reach.forEach(B => { prods2.filter(p => p.lhs === B && !G.vars.has(p.rhs)).forEach(p => prods3.push({ lhs: A, rhs: p.rhs })); });
  });
  steps.push({ lbl: 'Step 3: Remove unit productions', desc: 'Replace chains A→B→... with direct productions.', prods: [...prods3] });

  // Step 4: Binarize + add terminal intermediates
  const prods4 = [...prods3], newVars = new Map();
  let vcnt = 0;
  prods4.forEach(p => p.rhsArr = p.rhs.split(''));
  function termVar(t) { if (!newVars.has(t)) { const v = 'T_' + t; newVars.set(t, v); prods4.push({ lhs: v, rhs: t, rhsArr: [t] }); } return newVars.get(t); }
  const toFix = prods4.filter(p => p.rhs.length >= 2);
  toFix.forEach(p => {
    const syms = p.rhs.split('').map(c => G.vars.has(c) || c === S0 ? c : termVar(c));
    while (syms.length > 2) { const last = syms.pop(); const prev = syms.pop(); const v = 'B_' + (++vcnt); prods4.push({ lhs: v, rhs: prev + last, rhsArr: [prev, last] }); syms.push(v); }
    p.rhs = syms.join('');
    p.rhsArr = [...syms];
  });
  steps.push({ lbl: 'Step 4: Convert to binary & terminal rules (CNF)', desc: 'Each production is now A→BC or A→a.', prods: [...prods4] });

  steps.forEach(step => {
    html += `<div class="cnf-step"><span class="lbl">${step.lbl}</span>${step.desc}<br>`;
    const byLHS = {};
    step.prods.forEach(p => { if (!byLHS[p.lhs]) byLHS[p.lhs] = []; byLHS[p.lhs].push(p.rhs); });
    html += Object.entries(byLHS).map(([l, rs]) => `<span style="color:var(--accent)">${l}</span> → ${rs.join(' | ')}`).join('<br>');
    html += '</div>';
  });
  out.innerHTML = html;
  App._cnfProds = prods4; App._cnfStart = S0;
}

// --- CYK Parsing ---
function runCYK() {
  const str = $('cyk-in').value.trim();
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  if (!App._cnfProds) { showStatus('Run CNF conversion first'); return; }
  const s = str === App.config.sym.eps ? '' : str;
  if (s.length === 0) {
    // Check if start derives ε
    const acc = App._cnfProds.some(p => p.lhs === App._cnfStart && p.rhs === App.config.sym.eps);
    out.innerHTML = `<div class="card"><div class="card-title">CYK Result for ${App.config.sym.eps}</div>
  <div style="font-size:.85rem;color:${acc ? 'var(--green)' : 'var(--red)'}">
    ${acc ? '✓ ACCEPTED' : '✗ REJECTED'}</div></div>`;
    return;
  }
  const n = s.length;
  const prods = App._cnfProds;
  const T = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => new Set()));
  // Fill length 1
  for (let i = 0; i < n; i++) { prods.forEach(p => { if (p.rhs === s[i]) T[i][i].add(p.lhs); }); }
  // Fill length 2..n
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i <= n - len; i++) {
      const j = i + len - 1;
      for (let k = i; k < j; k++) {
        prods.forEach(p => {
          if (p.rhsArr.length === 2) {
            const B = p.rhsArr[0], C = p.rhsArr[1];
            if (T[i][k].has(B) && T[k + 1][j].has(C)) T[i][j].add(p.lhs);
          }
        });
      }
    }
  }
  const accepted = T[0][n - 1].has(App._cnfStart);
  let html = `<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">CYK Parse Table for "${str}"</h3>
<div style="font-size:.85rem;margin-bottom:12px;color:${accepted ? 'var(--green)' : 'var(--red)'}">
  ${accepted ? '✓ ACCEPTED — ' + App._cnfStart + ' ∈ T[0][' + (n - 1) + ']' : '✗ REJECTED — ' + App._cnfStart + ' ∉ T[0][' + (n - 1) + ']'}</div>`;
  html += '<div style="overflow-x:auto"><table class="cyk-table"><thead><tr><th class="cyk-cell header">i\\j</th>';
  for (let j = 0; j < n; j++) html += `<th class="cyk-cell header">${j} (${s[j]})</th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    html += `<tr><th class="cyk-cell header">${i}</th>`;
    for (let j = 0; j < n; j++) {
      if (j < i) { html += '<td class="cyk-cell" style="background:var(--bg3);color:var(--text3)">—</td>'; }
      else {
        const cell = [...T[i][j]];
        const hasStart = cell.includes(App._cnfStart);
        html += `<td class="cyk-cell ${cell.length ? hasStart ? 'has-start' : '' : 'empty-cell'}">${cell.join(',') || '∅'}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  out.innerHTML = html;
}

// --- String Derivation ---
function runDerivation() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  // BFS leftmost derivation
  const start = G.start, max = 150;
  let current = start, steps = [start], found = false;
  for (let i = 0; i < max; i++) {
    let applied = false;
    for (const c of current) {
      if (G.vars.has(c)) {
        const prods = G.productions.filter(p => p.lhs === c);
        if (!prods.length) break;
        const p = prods[Math.floor(Math.random() * prods.length)];
        current = current.replace(c, p.rhs);
        steps.push(current); applied = true;
        if (![...current].some(ch => G.vars.has(ch))) { found = true; break; }
        break;
      }
    }
    if (!applied || found) break;
  }
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Leftmost Derivation from ' + start + '</h3>';
  steps.forEach((step, i) => {
    const colored = step.split('').map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : `<span class="term">${c}</span>`).join('');
    html += `<div class="deriv-step">${i > 0 ? '⇒ ' : ''}${colored}</div>`;
  });
  if (!found) html += `<div style="font-size:.7rem;color:var(--text3);margin-top:8px">Derivation truncated at ${max} steps. Grammar may be recursive.</div>`;
  out.innerHTML = html;
}


// ══════════════════════════════════════════════════════════════════
//  GRAMMAR EXTENSIONS
// ══════════════════════════════════════════════════════════════════
function runRightmostDerivation() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  const start = G.start, max = 150;
  let current = start, steps = [start], found = false;
  for (let i = 0; i < max; i++) {
    let applied = false;
    // Find RIGHTMOST nonterminal
    let rightmostIdx = -1;
    for (let j = current.length - 1; j >= 0; j--) {
      if (G.vars.has(current[j])) { rightmostIdx = j; break; }
    }
    if (rightmostIdx === -1) { found = true; break; }
    const c = current[rightmostIdx];
    const prods = G.productions.filter(p => p.lhs === c);
    if (!prods.length) break;
    const p = prods[Math.floor(Math.random() * prods.length)];
    current = current.slice(0, rightmostIdx) + p.rhs + current.slice(rightmostIdx + 1);
    steps.push(current); applied = true;
    if (![...current].some(ch => G.vars.has(ch))) { found = true; break; }
  }
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Rightmost Derivation from ' + start + '</h3>';
  steps.forEach((step, i) => {
    const colored = step.split('').map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : `<span class="term">${c}</span>`).join('');
    html += `<div class="deriv-step">${i > 0 ? '⇒<sub>rm</sub> ' : ''}${colored}</div>`;
  });
  if (!found) html += `<div style="font-size:.7rem;color:var(--text3);margin-top:8px">Derivation truncated at ${max} steps.</div>`;
  out.innerHTML = html;
}

function runParseTree() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  // Build a simple derivation tree structure via leftmost derivation
  function buildTree(sym, depth) {
    if (depth > 20 || !G.vars.has(sym)) return { sym, children: [] };
    const prods = G.productions.filter(p => p.lhs === sym);
    if (!prods.length) return { sym, children: [] };
    const p = prods[0];
    return { sym, children: p.rhs.split('').map(c => buildTree(c, depth + 1)) };
  }
  const tree = buildTree(G.start, 0);
  // Layout and render as SVG
  const svgData = layoutParseTree(tree);
  out.innerHTML = `<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Parse Tree (first derivation)</h3>${svgData}`;
}

function layoutParseTree(root) {
  const nodeW = 50, nodeH = 40, levelH = 60;
  const positions = [];
  let maxX = 0, maxY = 0;
  function assign(node, x, y) {
    node._x = x; node._y = y;
    positions.push(node);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (node.children.length) {
      const startX = x - (node.children.length - 1) * nodeW / 2;
      node.children.forEach((ch, i) => assign(ch, startX + i * (nodeW + 10), y + levelH));
    }
  }
  assign(root, 300, 30);
  const svgW = Math.max(600, maxX + 60), svgH = maxY + 60;
  let edges = '', nodes = '';
  positions.forEach(node => {
    node.children.forEach(ch => {
      edges += `<line class="pt-edge" x1="${node._x}" y1="${node._y}" x2="${ch._x}" y2="${ch._y}"/>`;
    });
    const isNT = G.vars.has(node.sym);
    const rx = nodeW / 2 - 2;
    if (isNT) {
      nodes += `<rect class="pt-node-nt" x="${node._x - rx}" y="${node._y - 12}" width="${rx * 2}" height="24" rx="4"/>`;
    } else {
      nodes += `<circle class="pt-node-t" cx="${node._x}" cy="${node._y}" r="13"/>`;
    }
    nodes += `<text class="pt-text" x="${node._x}" y="${node._y}">${node.sym === App.config.sym.eps ? App.config.sym.eps : node.sym}</text>`;
  });
  return `<svg class="parse-tree-svg" viewBox="0 0 ${svgW} ${svgH}" style="width:100%;max-width:${svgW}px">${edges}${nodes}</svg>`;
}

function runAmbiguityCheck() {
  const str = $('ambig-in').value.trim() || $('cyk-in').value.trim();
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  if (!str) { showStatus('Enter a string to check ambiguity'); return; }
  const s = str === App.config.sym.eps ? '' : str;
  G.start = $('start-sym').value || G.start;
  // BFS for two different leftmost derivations
  const found = [];
  const visited = new Set([G.start]);
  const queue = [{ sent: G.start, steps: [G.start] }];
  let iterations = 0;
  while (queue.length && found.length < 2 && iterations < 2000) {
    iterations++;
    const { sent, steps } = queue.shift();
    // Check if it's the target string
    if (sent === s) { found.push(steps); continue; }
    if (![...sent].some(c => G.vars.has(c))) continue; // terminal, not the target
    // Find leftmost NT
    for (let i = 0; i < sent.length; i++) {
      if (G.vars.has(sent[i])) {
        G.productions.filter(p => p.lhs === sent[i]).forEach(p => {
          const nxt = sent.slice(0, i) + (p.rhs === App.config.sym.eps ? '' : p.rhs) + sent.slice(i + 1);
          if (!visited.has(nxt + '|' + steps.length) && steps.length < 20) {
            visited.add(nxt + '|' + steps.length);
            queue.push({ sent: nxt, steps: [...steps, nxt] });
          }
        });
        break;
      }
    }
  }
  let html = `<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Ambiguity Check for "${str}"</h3>`;
  if (found.length === 0) {
    html += `<div class="pump-result fail">String "${str}" is NOT in the language (no derivation found up to depth 20).</div>`;
  } else if (found.length === 1) {
    html += `<div class="pump-result ok">Likely UNAMBIGUOUS for this string (only one leftmost derivation found within depth 20).</div>`;
    html += '<h4 style="font-size:.75rem;margin:10px 0 6px">Derivation:</h4>';
    found[0].forEach((step, i) => { html += `<div class="deriv-step">${i > 0 ? '⇒ ' : ''}${step}</div>`; });
  } else {
    html += `<div class="pump-result fail">AMBIGUOUS! Found two different leftmost derivations for "${str}".</div>`;
    found.forEach((deriv, di) => {
      html += `<h4 style="font-size:.75rem;margin:10px 0 6px">Derivation ${di + 1}:</h4>`;
      deriv.forEach((step, i) => { html += `<div class="deriv-step">${i > 0 ? '⇒ ' : ''}${step}</div>`; });
    });
  }
  out.innerHTML = html;
}

function runUselessElim() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  const terms = [...App.sigma];
  // Step 1: Find productive variables
  const productive = new Set(terms);
  let changed = true;
  const prods = G.productions;
  while (changed) {
    changed = false;
    prods.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhs = p.rhs === App.config.sym.eps ? [] : p.rhs.split('');
        if (rhs.every(c => productive.has(c))) {
          productive.add(p.lhs); changed = true;
        }
      }
    });
  }
  const nonproductive = [...G.vars].filter(v => !productive.has(v));
  // Remove non-productive
  let prods2 = prods.filter(p => productive.has(p.lhs) && (p.rhs === App.config.sym.eps || p.rhs.split('').every(c => productive.has(c))));
  // Step 2: Find reachable variables from start
  const reachable = new Set([G.start]);
  changed = true;
  while (changed) {
    changed = false;
    prods2.forEach(p => {
      if (reachable.has(p.lhs)) {
        (p.rhs === App.config.sym.eps ? [] : p.rhs.split('').filter(c => G.vars.has(c))).forEach(v => {
          if (!reachable.has(v)) { reachable.add(v); changed = true; }
        });
      }
    });
  }
  const unreachable = [...G.vars].filter(v => !reachable.has(v));
  const prods3 = prods2.filter(p => reachable.has(p.lhs));
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Useless Symbol Elimination</h3>';
  html += `<div class="cnf-step"><span class="lbl">Step 1:</span>Non-productive: {${nonproductive.join(',') || '∅'}}. Removed productions with non-productive variables.</div>`;
  html += `<div class="cnf-step"><span class="lbl">Step 2:</span>Unreachable from ${G.start}: {${unreachable.join(',') || '∅'}}. Removed their productions.</div>`;
  html += '<div class="cnf-step"><span class="lbl">Result:</span>';
  const byLHS = {};
  prods3.forEach(p => { if (!byLHS[p.lhs]) byLHS[p.lhs] = []; byLHS[p.lhs].push(p.rhs); });
  html += Object.entries(byLHS).map(([l, rs]) => `<span style="color:var(--accent)">${l}</span> → ${rs.join(' | ')}`).join('<br>');
  if (!prods3.length) html += '<span style="color:var(--text3)">Empty grammar</span>';
  html += '</div>';
  out.innerHTML = html;
}

function runGNF() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  // Ensure CNF first
  if (!App._cnfProds) { runCNF(); }
  const prods = App._cnfProds ? App._cnfProds.filter(p => p.rhs.length >= 1) : G.productions.map(p => ({ lhs: p.lhs, rhs: p.rhs, rhsArr: p.rhs.split('') }));
  // Get variables in order (reversed for Lemma application)
  const vars = [...new Set(prods.map(p => p.lhs))];
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">Greibach Normal Form (GNF)</h3>';
  html += '<div class="cnf-step"><span class="lbl">Note:</span>GNF conversion requires CNF, elimination of left recursion, and ensuring all productions start with a terminal. This shows a simplified pedagogical version.</div>';
  html += '<div class="cnf-step"><span class="lbl">Input (CNF):</span>';
  const byLHS0 = {};
  prods.forEach(p => { if (!byLHS0[p.lhs]) byLHS0[p.lhs] = []; byLHS0[p.lhs].push(p.rhs); });
  html += Object.entries(byLHS0).map(([l, rs]) => `<span style="color:var(--accent)">${l}</span> → ${rs.join(' | ')}`).join('<br>');
  html += '</div>';
  // Check for left recursion
  const leftRec = prods.filter(p => p.rhsArr && p.rhsArr[0] === p.lhs);
  if (leftRec.length) {
    html += `<div class="cnf-step"><span class="lbl">Left recursion detected:</span>${leftRec.map(p => `${p.lhs} → ${p.rhs}`).join(', ')}<br>GNF requires removing left recursion first (full elimination algorithm not shown here — apply standard left recursion elimination manually).</div>`;
  }
  // Show which productions already start with a terminal
  const startsTerminal = prods.filter(p => p.rhsArr && p.rhsArr.length > 0 && !G.vars.has(p.rhsArr[0]));
  const startsVar = prods.filter(p => p.rhsArr && p.rhsArr.length > 0 && G.vars.has(p.rhsArr[0]));
  html += `<div class="cnf-step"><span class="lbl">Already in GNF form:</span>${startsTerminal.map(p => `${p.lhs} → ${p.rhs}`).join(', ') || 'none'}</div>`;
  html += `<div class="cnf-step"><span class="lbl">Needs substitution (starts with variable):</span>${startsVar.map(p => `${p.lhs} → ${p.rhs}`).join(', ') || 'none'}</div>`;
  out.innerHTML = html;
}

function runCFG2PDA() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  // Build standard PDA for CFG
  // States: q_start, q_loop, q_accept
  // From q_start: push S, go to q_loop (ε, ε/S)
  // From q_loop: for each A → α, add (ε, A/α)
  // From q_loop: for each terminal a, add (a, a/ε)
  // From q_loop: to q_accept when stack symbol is bottom and input empty (ε, Z/ε)
  const trans = [];
  let tnum = 1;
  trans.push({ from: 'q_start', to: 'q_loop', symbol: App.config.sym.eps, pop: App.config.sym.stackBottom, push: G.start + App.config.sym.stackBottom, id: 't' + tnum++ });
  G.productions.forEach(p => {
    trans.push({ from: 'q_loop', to: 'q_loop', symbol: App.config.sym.eps, pop: p.lhs, push: p.rhs === App.config.sym.eps ? App.config.sym.eps : p.rhs, id: 't' + tnum++ });
  });
  [...App.sigma].forEach(a => {
    trans.push({ from: 'q_loop', to: 'q_loop', symbol: a, pop: a, push: App.config.sym.eps, id: 't' + tnum++ });
  });
  trans.push({ from: 'q_loop', to: 'q_accept', symbol: App.config.sym.eps, pop: App.config.sym.stackBottom, push: App.config.sym.eps, id: 't' + tnum++ });
  const rows = trans.map(t => `<tr><td>${t.from}</td><td>${t.symbol}</td><td>${t.pop}</td><td>${t.push}</td><td>${t.to}</td></tr>`).join('');
  let html = `<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">CFG → PDA</h3>
<div style="font-size:.72rem;color:var(--text2);margin-bottom:10px;line-height:1.8">
  States: {q_start, q_loop, q_accept} &nbsp;&nbsp; Start: q_start &nbsp;&nbsp; Accept: q_accept<br>
  Stack alphabet: {${[...G.vars].join(',')}, ${[...App.sigma].join(',')}, ${App.config.sym.stackBottom} (bottom)}
</div>
<div style="overflow-x:auto"><table class="result-table">
<thead><tr><th>From</th><th>Read</th><th>Pop</th><th>Push</th><th>To</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div style="margin-top:10px"><button class="algo-btn" onclick="loadCFGPDA()">Load to Canvas (PDA)</button></div>`;
  out.innerHTML = html;
  App._lastCFGPDA = trans;
}

function loadCFGPDA() {
  if (!App._lastCFGPDA) return;
  snapshot();
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null; App.stateN = 0; App.transN = 0;
  const stateNames = ['q_start', 'q_loop', 'q_accept'];
  const xs = [120, 340, 560], ys = [200, 200, 200];
  const idMap = {};
  stateNames.forEach((name, i) => {
    const id = 's' + (i + 1); App.stateN = i + 1;
    App.states.push({ id, x: xs[i], y: ys[i], name });
    idMap[name] = id;
    if (name === 'q_start') App.startId = id;
    if (name === 'q_accept') App.accepts.add(id);
  });
  App._lastCFGPDA.forEach((t, i) => {
    App.transitions.push({ ...t, id: 't' + (i + 1), from: idMap[t.from], to: idMap[t.to] });
  });
  App.transN = App._lastCFGPDA.length;
  App.machine = 'PDA'; setMachine('PDA');
  renderAll(); updateLPanel(); updateRPanel();
  setView('build'); showStatus('PDA loaded for CFG!');
}

// ══════════════════════════════════════════════════════════════════
//  CFG DECISION ALGORITHMS
// ══════════════════════════════════════════════════════════════════
function runCFGIsEmpty() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  const terms = [...App.sigma];
  const productive = new Set(terms);
  productive.add(App.config.sym.eps);
  let changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhs = p.rhs === App.config.sym.eps ? [] : p.rhs.split('');
        if (rhs.every(c => productive.has(c))) { productive.add(p.lhs); changed = true; }
      }
    });
  }
  const nonproductive = [...G.vars].filter(v => !productive.has(v));
  const isEmpty = !productive.has(G.start);
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">CFG Emptiness Check</h3>';
  html += `<div class="cnf-step"><span class="lbl">Productive variables:</span>{${[...productive].filter(v => G.vars.has(v)).join(',') || '∅'}}</div>`;
  html += `<div class="cnf-step"><span class="lbl">Non-productive:</span>{${nonproductive.join(',') || '∅'}}</div>`;
  html += `<div class="pump-result ${isEmpty ? 'fail' : 'ok'}">${isEmpty ? 'EMPTY — Start symbol ' + G.start + ' is non-productive → L(G) = ∅' : 'NON-EMPTY — Start symbol ' + G.start + ' is productive → L(G) ≠ ∅'}</div>`;
  out.innerHTML = html;
}

function runCFGIsFinite() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym').value || G.start;
  // Build dependency graph: A depends on B if A → ...B...
  const deps = {};
  [...G.vars].forEach(v => deps[v] = new Set());
  G.productions.forEach(p => {
    if (p.rhs !== App.config.sym.eps) { p.rhs.split('').filter(c => G.vars.has(c)).forEach(v => deps[p.lhs].add(v)); }
  });
  // Find productive variables
  const terms = [...App.sigma]; const productive = new Set(terms); productive.add(App.config.sym.eps);
  let changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhs = p.rhs === App.config.sym.eps ? [] : p.rhs.split('');
        if (rhs.every(c => productive.has(c))) { productive.add(p.lhs); changed = true; }
      }
    });
  }
  const prodVars = [...G.vars].filter(v => productive.has(v));
  // Check for cycles among productive vars
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  prodVars.forEach(v => color[v] = WHITE);
  let hasCycle = false, cycleVars = [];
  function dfs(u) {
    color[u] = GRAY;
    for (const v of deps[u] || []) {
      if (!prodVars.includes(v)) continue;
      if (color[v] === GRAY) { hasCycle = true; cycleVars.push(u, v); return; }
      if (color[v] === WHITE) dfs(v);
      if (hasCycle) return;
    }
    color[u] = BLACK;
  }
  prodVars.forEach(v => { if (color[v] === WHITE && !hasCycle) dfs(v); });
  // Is cycle reachable from start?
  const reachableFromStart = new Set([G.start]);
  changed = true;
  while (changed) {
    changed = false;
    for (const v of reachableFromStart) {
      for (const dep of (deps[v] || [])) {
        if (prodVars.includes(dep) && !reachableFromStart.has(dep)) { reachableFromStart.add(dep); changed = true; }
      }
    }
  }
  const cycleReachable = hasCycle && cycleVars.some(v => reachableFromStart.has(v));
  let html = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:12px">CFG Finiteness Check</h3>';
  html += `<div class="cnf-step"><span class="lbl">Productive variables:</span>{${prodVars.join(',') || '∅'}}</div>`;
  html += `<div class="cnf-step"><span class="lbl">Dependency cycle:</span>${hasCycle ? 'Yes — involving ' + [...new Set(cycleVars)].join(', ') : 'No cycles found'}</div>`;
  html += `<div class="pump-result ${cycleReachable ? 'fail' : 'ok'}">${cycleReachable ? 'INFINITE — Cycle reachable from start → L(G) is infinite' : 'FINITE — No reachable cycle → L(G) is a finite set'}</div>`;
  out.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
//  CFL PUMPING LEMMA VISUALIZATION
// ══════════════════════════════════════════════════════════════════
function renderCFLPumpVis() {
  const pEl = $('cfl-pump-vis'); if (!pEl) return;
  const pw = $('cfl-pump-w'); if (!pw) return;
  const w = pw.value;
  const u = parseInt($('cfl-pump-u')?.value) || 0;
  const v = parseInt($('cfl-pump-v')?.value) || 1;
  const x = parseInt($('cfl-pump-x')?.value) || 1;
  const y = parseInt($('cfl-pump-y')?.value) || 1;
  const p = parseInt($('cfl-pump-p')?.value) || 4;
  const pi = parseInt($('cfl-pump-i')?.value) || 2;
  const resEl = $('cfl-pump-result'); if (!resEl) return;
  if (u + v + x + y > w.length) { resEl.innerHTML = '<div class="pump-result fail">|uvxy| exceeds string length.</div>'; return; }
  if (v + y < 1) { resEl.innerHTML = '<div class="pump-result fail">|vy| must be ≥ 1.</div>'; return; }
  if (v + x + y > p) { resEl.innerHTML = '<div class="pump-result fail">|vxy| must be ≤ p.</div>'; return; }
  const uPart = w.slice(0, u);
  const vPart = w.slice(u, u + v);
  const xPart = w.slice(u + v, u + v + x);
  const yPart = w.slice(u + v + x, u + v + x + y);
  const zPart = w.slice(u + v + x + y);
  const pumped = uPart + vPart.repeat(pi) + xPart + yPart.repeat(pi) + zPart;
  pEl.innerHTML =
    [...uPart].map(c => `<div class="pump-char u-part">${c}</div>`).join('') +
    [...vPart].map(c => `<div class="pump-char v-part">${c}</div>`).join('') +
    [...xPart].map(c => `<div class="pump-char x-part2">${c}</div>`).join('') +
    [...yPart].map(c => `<div class="pump-char y-part2">${c}</div>`).join('') +
    [...zPart].map(c => `<div class="pump-char z-part2">${c}</div>`).join('');
  const info = `u="${uPart}"(${u})  v="${vPart}"(${v})  x="${xPart}"(${x})  y="${yPart}"(${y})  z="${zPart}"`;
  resEl.innerHTML = `<div style="font-size:.68rem;color:var(--text2);margin-bottom:6px">${info}</div>
<div class="pump-result ok">Pumped: uv^${pi}xy^${pi}z = "${pumped}"<br>Verify i=0: "${uPart + xPart + zPart}" &nbsp; i=1: "${uPart + vPart + xPart + yPart + zPart}" &nbsp; i=2: "${uPart + vPart.repeat(2) + xPart + yPart.repeat(2) + zPart}"</div>`;
}


// ══════════════════════════════════════════════════════════════════
//  PDA → CFG (Sipser Construction)
// ══════════════════════════════════════════════════════════════════
function runPDA2CFG() {
  const out = $('gram-output');
  if (App.machine !== 'PDA') {
    out.innerHTML = `<div class="cnf-step"><span class="lbl">Switch to PDA mode to use this conversion.</span></div>`;
    return;
  }
  if (!App.states.length) { out.innerHTML = '<div class="cnf-step"><span class="lbl">No PDA states defined.</span></div>'; return; }
  if (!App.startId) { out.innerHTML = '<div class="cnf-step"><span class="lbl">No start state defined.</span></div>'; return; }

  const eps = App.config.sym.eps;
  const Z = App.config.sym.stackBottom;
  const sname = id => App.states.find(s => s.id === id)?.name || id;
  const stateNames = App.states.map(s => s.name);
  const stackSymbols = new Set([Z]);
  App.transitions.forEach(t => {
    if (t.pop && t.pop !== eps && t.pop !== App.config.sym.any) stackSymbols.add(t.pop);
    if (t.push && t.push !== eps && t.push !== App.config.sym.any) t.push.split('').forEach(sym => stackSymbols.add(sym));
  });

  const freshBottomCandidates = ['$', '#', '@', '%', '&'];
  let freshBottom = freshBottomCandidates.find(sym => !stackSymbols.has(sym)) || '$';
  while (stackSymbols.has(freshBottom)) freshBottom += '$';
  stackSymbols.add(freshBottom);

  let startName = '__pda_cfg_start__';
  while (stateNames.includes(startName)) startName += '_';
  let drainName = '__pda_cfg_drain__';
  while (stateNames.includes(drainName) || drainName === startName) drainName += '_';

  const states = [
    ...stateNames.map(name => ({ name })),
    { name: startName },
    { name: drainName }
  ];
  const trans = [];
  trans.push({ from: startName, to: sname(App.startId), symbol: eps, pop: freshBottom, push: `${Z}${freshBottom}` });
  App.transitions.forEach(t => {
    trans.push({
      from: sname(t.from),
      to: sname(t.to),
      symbol: t.symbol || eps,
      pop: t.pop || eps,
      push: t.push || eps
    });
  });
  App.accepts.forEach(afid => {
    const accName = sname(afid);
    [...stackSymbols].forEach(sym => {
      trans.push({ from: accName, to: drainName, symbol: eps, pop: sym, push: eps });
    });
  });
  [...stackSymbols].forEach(sym => {
    trans.push({ from: drainName, to: drainName, symbol: eps, pop: sym, push: eps });
  });

  const prods = [];
  prods.push({ lhs: 'S', rhs: `[${startName},${freshBottom},${drainName}]` });

  trans.forEach(t => {
    const p = t.from;
    const q = t.to;
    const a = t.symbol || eps;
    const pop = t.pop || eps;
    const push = t.push || eps;
    const pushSyms = push === eps ? [] : push.split('');

    if (pushSyms.length === 0) {
      prods.push({ lhs: `[${p},${pop},${q}]`, rhs: a });
    } else if (pushSyms.length === 1) {
      states.forEach(r => {
        const rn = r.name;
        const rhsStr = `${a === eps ? '' : a}[${q},${pushSyms[0]},${rn}]`.trim();
        prods.push({ lhs: `[${p},${pop},${rn}]`, rhs: rhsStr || eps });
      });
    } else if (pushSyms.length === 2) {
      states.forEach(s => {
        states.forEach(r => {
          const sn = s.name, rn = r.name;
          const rhsStr = `${a === eps ? '' : a}[${q},${pushSyms[0]},${sn}][${sn},${pushSyms[1]},${rn}]`.trim();
          prods.push({ lhs: `[${p},${pop},${rn}]`, rhs: rhsStr });
        });
      });
    }
  });

  const byLHS = {};
  prods.forEach(p => {
    if (!byLHS[p.lhs]) byLHS[p.lhs] = new Set();
    byLHS[p.lhs].add(p.rhs || eps);
  });

  const rows = Object.entries(byLHS).map(([lhs, rhsSet]) => {
    const rhs = [...rhsSet].join(' | ');
    return `<tr>
      <td style="color:var(--accent);font-family:var(--mono);font-size:.67rem">${lhs}</td>
      <td style="color:var(--text3)">→</td>
      <td style="font-family:var(--mono);font-size:.67rem">${rhs}</td>
    </tr>`;
  }).join('');

  out.innerHTML = `
<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:6px">PDA → CFG (Sipser Triple Construction)</h3>
<div style="font-size:.7rem;color:var(--text2);margin-bottom:12px;line-height:1.8">
  Non-terminal <b>[p, A, q]</b>: starting in state p with stack symbol A on top, consume some input and end in state q with A removed.<br>
  Start variable: <b>S</b> &nbsp;&nbsp; PDA states: ${states.length} &nbsp;&nbsp; Transitions: ${trans.length} &nbsp;&nbsp; Generated rules: ${prods.length}
</div>
<div style="overflow-x:auto"><table class="result-table">
  <thead><tr><th>LHS</th><th></th><th>RHS</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">
  Assumes PDA pops exactly 1 symbol and pushes at most 2 per transition. Longer push strings require decomposition.
</div>`;
}

// ══════════════════════════════════════════════════════════════════
//  CYK STEP-THROUGH VISUALIZER
// ══════════════════════════════════════════════════════════════════
let _cykViz = null;

function runCYKVisual() {
  const str = $('cyk-in').value.trim();
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  if (!App._cnfProds) { showStatus('Run CNF conversion first then use step-through'); return; }
  const s = str === App.config.sym.eps ? '' : str;
  if (!s.length) { runCYK(); return; }

  const n = s.length;
  const prods = App._cnfProds;
  const cnfStart = App._cnfStart;

  const T = Array.from({ length: n }, () => Array.from({ length: n }, () => new Set()));
  const steps = [];

  // Phase 1: base case
  for (let i = 0; i < n; i++) {
    let fired = false;
    prods.forEach(p => {
      if (p.rhs === s[i] && !T[i][i].has(p.lhs)) {
        T[i][i].add(p.lhs);
        steps.push({
          i, j: i, k: null, added: p.lhs,
          note: `<b>Base:</b> T[${i}][${i}] &larr; <span style="color:var(--accent)">${p.lhs}</span> &nbsp; via ${p.lhs} &rarr; '${p.rhs}' &nbsp; (char '${s[i]}' at pos ${i})`,
          snapshot: T.map(row => row.map(cell => new Set(cell)))
        });
        fired = true;
      }
    });
    if (!fired) {
      steps.push({ i, j: i, k: null, added: null,
        note: `<b>Base:</b> T[${i}][${i}] — no terminal production matches '${s[i]}'`,
        snapshot: T.map(row => row.map(cell => new Set(cell)))
      });
    }
  }

  // Phase 2: recursive fill
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i <= n - len; i++) {
      const j = i + len - 1;
      let firedAny = false;
      for (let k = i; k < j; k++) {
        prods.forEach(p => {
          if (p.rhsArr && p.rhsArr.length === 2) {
            const [B, C] = p.rhsArr;
            if (T[i][k].has(B) && T[k+1][j].has(C) && !T[i][j].has(p.lhs)) {
              T[i][j].add(p.lhs);
              steps.push({
                i, j, k, added: p.lhs,
                note: `<b>Fill T[${i}][${j}]</b> (span "<span style="color:var(--gold)">${s.slice(i,j+1)}</span>"): <span style="color:var(--accent)">${p.lhs}</span> &larr; ${p.lhs} &rarr; ${B}&thinsp;${C}, split k=${k} &rarr; T[${i}][${k}]&ni;${B}, T[${k+1}][${j}]&ni;${C}`,
                snapshot: T.map(row => row.map(cell => new Set(cell)))
              });
              firedAny = true;
            }
          }
        });
      }
      if (!firedAny) {
        steps.push({ i, j, k: null, added: null,
          note: `<b>Fill T[${i}][${j}]</b> (span "<span style="color:var(--gold)">${s.slice(i,j+1)}</span>"): no production fires &rarr; T[${i}][${j}] = &empty;`,
          snapshot: T.map(row => row.map(cell => new Set(cell)))
        });
      }
    }
  }

  const accepted = T[0][n-1].has(cnfStart);
  _cykViz = { steps, idx: 0, n, s, cnfStart, accepted };
  renderCYKVisStep(out);
}

function renderCYKVisStep(out) {
  if (!out) out = $('gram-output');
  if (!_cykViz) return;
  const { steps, idx, n, s, cnfStart, accepted } = _cykViz;
  const step = steps[idx];
  const T = step.snapshot;

  let table = '<div style="overflow-x:auto"><table class="cyk-table"><thead><tr><th class="cyk-cell header">i﹨j</th>';
  for (let j = 0; j < n; j++) table += `<th class="cyk-cell header">${j} <span style="color:var(--gold)">${s[j]}</span></th>`;
  table += '</tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    table += `<tr><th class="cyk-cell header">${i}</th>`;
    for (let j = 0; j < n; j++) {
      if (j < i) {
        table += '<td class="cyk-cell" style="background:var(--bg3);color:var(--text3)">—</td>';
      } else {
        const cell = [...T[i][j]];
        const isActive = step.i === i && step.j === j;
        const hasStart = cell.includes(cnfStart);
        const justAdded = isActive && step.added && cell.includes(step.added);
        let ex = '';
        if (justAdded) ex = 'background:rgba(79,195,247,.16);outline:1.5px solid var(--accent);';
        else if (isActive) ex = 'background:rgba(255,213,79,.08);outline:1px solid var(--gold);';
        table += `<td class="cyk-cell ${hasStart ? 'has-start' : cell.length ? '' : 'empty-cell'}" style="${ex}">${cell.join(',') || '∅'}</td>`;
      }
    }
    table += '</tr>';
  }
  table += '</tbody></table></div>';

  const isLast = idx === steps.length - 1;
  const progress = `${idx + 1} / ${steps.length}`;

  out.innerHTML = `
<h3 style="font-family:var(--serif);font-size:1.1rem;margin-bottom:8px">CYK Step-Through &mdash; "<span style="color:var(--gold)">${s}</span>"</h3>
<div class="sctrl" style="margin-bottom:10px">
  <button class="sbtn" onclick="cykVisStep(-1)" ${idx===0?'disabled':''}>← Back</button>
  <button class="sbtn auto-btn" onclick="cykVisStep(1)" ${isLast?'disabled':''}>Next →</button>
  <span style="font-family:var(--mono);font-size:.63rem;color:var(--text3);padding:4px 8px">${progress}</span>
  <button class="sbtn sec" onclick="runCYKVisual()">↺ Reset</button>
</div>
<div class="step-item" style="margin-bottom:12px">
  <div class="step-num">${idx + 1}</div>
  <div class="step-text">${step.note}</div>
</div>
${table}
${isLast ? `<div class="pump-result ${accepted ? 'ok' : 'fail'}" style="margin-top:14px">
  ${accepted ? `✓ ACCEPTED — ${cnfStart} ∈ T[0][${n-1}]` : `✗ REJECTED — ${cnfStart} ∉ T[0][${n-1}]`}
</div>` : ''}`;
}

function cykVisStep(delta) {
  if (!_cykViz) return;
  _cykViz.idx = Math.max(0, Math.min(_cykViz.steps.length - 1, _cykViz.idx + delta));
  renderCYKVisStep($('gram-output'));
}
