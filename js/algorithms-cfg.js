// ══════════════════════════════════════════════════════════════════
//  GRAMMAR VIEW
// ══════════════════════════════════════════════════════════════════
const G = App.grammar;

function renderGramSyms() {
  const tc = $('term-chips');
  if (!tc) return;
  tc.innerHTML = [...App.sigma].map(s => `<div class="chip" style="color:var(--gold)">${s}</div>`).join('')
    || '<span style="font-size:.65rem;color:var(--text3);font-style:italic">Mirror from Σ</span>';
}
function parseRawGrammar() {
  const text = $('grammar-input').value;
  const lines = text.split('\n').filter(l => l.trim());
  G.vars.clear();
  G.productions = [];
  G.start = '';

  const parsedLines = [];
  // First pass: identify variables (LHS of any rule)
  lines.forEach(line => {
    let parts = line.split(/->|→|=>/);
    if (parts.length >= 2) {
      let lhs = parts[0].trim();
      if (!G.start) G.start = lhs;
      G.vars.add(lhs);
      parsedLines.push({ lhs, rhsRaw: parts.slice(1).join('->').trim() });
    }
  });

  // Second pass: tokenize RHS
  parsedLines.forEach(({ lhs, rhsRaw }) => {
    rhsRaw.split('|').forEach(alt => {
      let altTrimmed = alt.trim();
      if (!altTrimmed) return;
      let isEps = altTrimmed === App.config.sym.eps || altTrimmed.toLowerCase() === 'eps' || altTrimmed.toLowerCase() === 'epsilon';
      let finalRhs = isEps ? App.config.sym.eps : altTrimmed;
      G.productions.push({
        id: 'p' + Date.now() + '_' + Math.random(),
        lhs,
        rhs: finalRhs,
        rhsArr: tokenizeRHS(altTrimmed, G.vars)
      });
    });
  });

  renderGrammarView();
}

function tokenizeRHS(str, vars) {
  const raw = str.trim();
  if (raw === App.config.sym.eps || raw.toLowerCase() === 'eps' || raw.toLowerCase() === 'epsilon') return [App.config.sym.eps];
  const tokens = [];
  let current = '';
  // Simple tokenization: treat known variables as single tokens, everything else as individual terminal chars.
  // Exception: things in brackets `[q0,a,q1]` are parsed as a single non-terminal token.
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[') {
      let j = i;
      while (j < str.length && str[j] !== ']') j++;
      if (j < str.length) {
        let nt = str.slice(i, j + 1);
        vars.add(nt);
        tokens.push(nt);
        i = j;
        continue;
      }
    }
    // If we have a sequence that matches a variable exactly, this is tricky if variables are multi-char (but they aren't unless bracketed or we enforce spaces).
    // For now, if we match any known variable string greedily (descending length):
    let matchedVar = [...vars].sort((a,b)=>b.length - a.length).find(v => str.startsWith(v, i));
    if (matchedVar) {
      tokens.push(matchedVar);
      i += matchedVar.length - 1;
    } else if (str[i] !== ' ') {
      tokens.push(str[i]);
    }
  }
  return tokens.length ? tokens : [App.config.sym.eps];
}

function renderGrammarLPanel() {
  const gi = $('grammar-input');
  if (!gi) return;
  const grouped = {};
  G.productions.forEach(p => {
    if (!grouped[p.lhs]) grouped[p.lhs] = [];
    grouped[p.lhs].push(p.rhs);
  });
  const lines = [];
  for (const k in grouped) {
    if (k !== G.start) continue;
    lines.push(`${k} → ${grouped[k].join(' | ')}`);
  }
  for (const k in grouped) {
    if (k === G.start) continue;
    lines.push(`${k} → ${grouped[k].join(' | ')}`);
  }
  gi.value = lines.join('\n');
  const ss = $('start-sym');
  if (ss) ss.value = G.start || '';
}



/** Collects all terminals used in the current grammar */
function getGrammarTerminals() {
  const terms = new Set();
  G.productions.forEach(p => {
    (p.rhsArr || []).forEach(t => {
      if (!G.vars.has(t) && t !== App.config.sym.eps) terms.add(t);
    });
  });
  [...App.sigma].forEach(s => terms.add(s));
  return terms;
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
      return (G.productions.find(p=>p.lhs === lhs && p.rhs === rhs)?.rhsArr || tokenizeRHS(rhs, G.vars))
        .map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : c === App.config.sym.eps ? `<span class="eps">${App.config.sym.eps}</span>` : `<span class="t">${c}</span>`).join(' ');
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
  G.start = ($('start-sym')?.value) || G.start;
  let prods = G.productions.map(p => ({ lhs: p.lhs, rhs: p.rhs, rhsArr: p.rhsArr || tokenizeRHS(p.rhs, G.vars) }));
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">CNF Conversion Steps</h3>';
  const steps = [];

  const copyProds = (arr) => arr.map(p => ({ ...p, rhsArr: [...p.rhsArr] }));

  // Step 1: Add new start
  const S0 = G.start + '₀';
  prods = [{ lhs: S0, rhs: G.start, rhsArr: [G.start] }, ...prods];
  steps.push({ lbl: 'Step 1: New start', desc: `Add ${S0} → ${G.start} to avoid start symbol in RHS`, prods: copyProds(prods) });

  // Step 2: Eliminate ε-productions (find nullable)
  const nullable = new Set();
  prods.forEach(p => { if (p.rhs === App.config.sym.eps) nullable.add(p.lhs); });
  let changed = true;
  while (changed) { changed = false; prods.forEach(p => { if (!nullable.has(p.lhs) && p.rhsArr.every(c => nullable.has(c) || !c)) { nullable.add(p.lhs); changed = true; } }); }
  const prods2 = [], seen2 = new Set();
  prods.forEach(p => {
    if (p.rhs === App.config.sym.eps) { if (p.lhs === S0) prods2.push(p); return; }
    // Generate all subsets of nullable positions
    const chars = p.rhsArr;
    const nullableIdx = chars.map((c, i) => nullable.has(c) ? i : -1).filter(i => i >= 0);
    const total = 1 << nullableIdx.length; // 2^k subsets
    for (let mask = 0; mask < total; mask++) {
      const kept = chars.filter((c, i) => {
        const ni = nullableIdx.indexOf(i);
        return ni === -1 || !(mask & (1 << ni)); // keep if not nullable or not masked out
      });
      const r = kept.join('');
      const rArr = kept.length ? kept : [App.config.sym.eps];
      if (!kept.length) { // all omitted → ε, only allow for new start
        if (p.lhs === S0) { const k2 = p.lhs + '→' + App.config.sym.eps; if (!seen2.has(k2)) { seen2.add(k2); prods2.push({ lhs: p.lhs, rhs: App.config.sym.eps, rhsArr: rArr }); } }
        continue;
      }
      const key = p.lhs + '→' + r;
      if (!seen2.has(key)) { seen2.add(key); prods2.push({ lhs: p.lhs, rhs: r, rhsArr: rArr }); }
    }
  });
  steps.push({ lbl: 'Step 2: Remove ε-productions', desc: `Nullable: {${[...nullable].join(',')}}. Add combinations without nullable symbols.`, prods: copyProds(prods2) });

  // Step 3: Eliminate unit rules
  const prods3 = []; const unitVisited = new Set();
  function closeUnit(A) {
    const reach = new Set([A]);
    let ch = true;
    while (ch) { ch = false; prods2.forEach(p => { if (reach.has(p.lhs) && G.vars.has(p.rhs) && p.rhsArr.length === 1 && !reach.has(p.rhs)) { reach.add(p.rhs); ch = true; } }); }
    return reach;
  }
  [...G.vars, S0].forEach(A => {
    const reach = closeUnit(A);
    reach.forEach(B => { prods2.filter(p => p.lhs === B && !(G.vars.has(p.rhs) && p.rhsArr.length === 1)).forEach(p => prods3.push({ lhs: A, rhs: p.rhs, rhsArr: p.rhsArr })); });
  });
  steps.push({ lbl: 'Step 3: Remove unit productions', desc: 'Replace chains A→B→... with direct productions.', prods: copyProds(prods3) });

  // Step 4: Binarize + add terminal intermediates
  const prods4 = [...prods3], newVars = new Map(), binVars = new Map();
  let vcnt = 0;
  function termVar(t) { if (!newVars.has(t)) { const v = 'T_' + t; newVars.set(t, v); prods4.push({ lhs: v, rhs: t, rhsArr: [t] }); } return newVars.get(t); }
  const toFix = prods4.filter(p => p.rhsArr.length >= 2);
  toFix.forEach(p => {
    const syms = p.rhsArr.map(c => G.vars.has(c) || c === S0 ? c : termVar(c));
    while (syms.length > 2) {
      const last = syms.pop();
      const prev = syms.pop();
      const key = `${prev} ${last}`;
      if (!binVars.has(key)) {
        const v = 'B_' + (++vcnt);
        binVars.set(key, v);
        prods4.push({ lhs: v, rhs: prev + last, rhsArr: [prev, last] });
      }
      syms.push(binVars.get(key));
    }
    p.rhs = syms.join('');
    p.rhsArr = [...syms];
  });
  steps.push({ lbl: 'Step 4: Convert to binary & terminal rules (CNF)', desc: 'Each production is now A→BC or A→a.', prods: copyProds(prods4) });

  steps.forEach(step => {
    html += `<div class="cnf-step"><span class="lbl">${step.lbl}</span>${step.desc}<br>`;
    const byLHS = {};
    step.prods.forEach(p => { if (!byLHS[p.lhs]) byLHS[p.lhs] = []; byLHS[p.lhs].push(p.rhsArr); });
    html += Object.entries(byLHS).map(([l, rsArr]) => {
      const rhsStr = rsArr.map(arr => arr.join(' ')).join(' | ');
      return `<span style="color:var(--accent)">${l}</span> → ${rhsStr}`;
    }).join('<br>');
    html += '</div>';
  });
  out.innerHTML = html;
  App._cnfProds = prods4; App._cnfStart = S0;
  App._lastParsedWasCnf = true;
}

// --- CYK Parsing ---
function runCYK() {
  const strLine = $('cyk-in').value.trim();
  const rawStr = parseEps(strLine);
  const str = rawStr === App.config.sym.eps ? '' : rawStr;
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  if (!App._lastParsedWasCnf) runCNF();
  if (!App._cnfProds) { showStatus('CNF conversion failed'); return; }
  const gTerms = getGrammarTerminals();
  const sTokenized = str === App.config.sym.eps ? [] : tokenize(str, gTerms);
  if (sTokenized === null) {
    showStatus('Input contains symbols not in the grammar');
    out.innerHTML = `<div class="pump-result fail">Input string contains terminals that are not defined in your grammar.</div>`;
    return;
  }
  if (sTokenized.length === 0) {
    // Check if start derives ε
    const acc = App._cnfProds.some(p => p.lhs === App._cnfStart && p.rhs === App.config.sym.eps);
    out.innerHTML = `<div class="card"><div class="card-title">CYK Result for ${App.config.sym.eps}</div>
  <div style="font-size:.85rem;color:${acc ? 'var(--green)' : 'var(--red)'}">
    ${acc ? '✓ ACCEPTED' : '✗ REJECTED'}</div></div>`;
    return;
  }
  const n = sTokenized.length;
  const prods = App._cnfProds;
  const T = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => new Set()));
  // Fill length 1
  for (let i = 0; i < n; i++) { prods.forEach(p => { if (p.rhs === sTokenized[i]) T[i][i].add(p.lhs); }); }
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
  let html = `<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">CYK Parse Table for "${str}"</h3>
<div style="font-size:.85rem;margin-bottom:12px;color:${accepted ? 'var(--green)' : 'var(--red)'}">
  ${accepted ? '✓ ACCEPTED — ' + App._cnfStart + ' ∈ T[0][' + (n - 1) + ']' : '✗ REJECTED — ' + App._cnfStart + ' ∉ T[0][' + (n - 1) + ']'}</div>`;
  html += '<div style="overflow-x:auto"><table class="cyk-table"><thead><tr><th class="cyk-cell header">i\\j</th>';
  for (let j = 0; j < n; j++) html += `<th class="cyk-cell header">${j} (${str === App.config.sym.eps ? '' : sTokenized[j]})</th>`;
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
  G.start = $('start-sym')?.value || G.start;
  // BFS leftmost derivation
  const start = G.start, max = 150;
  let current = [start], steps = [[start]], found = false;
  for (let i = 0; i < max; i++) {
    let applied = false;
    for (let j = 0; j < current.length; j++) {
      const c = current[j];
      if (G.vars.has(c)) {
        const prods = G.productions.filter(p => p.lhs === c);
        if (!prods.length) break;
        const p = prods[Math.floor(Math.random() * prods.length)];
        const newArr = [...current];
        newArr.splice(j, 1, ...(p.rhs === App.config.sym.eps ? [] : p.rhsArr));
        current = newArr;
        steps.push(current); applied = true;
        if (!current.some(ch => G.vars.has(ch))) { found = true; break; }
        break;
      }
    }
    if (!applied || found) break;
  }
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Leftmost Derivation from ' + start + '</h3>';
  steps.forEach((stepArr, i) => {
    const colored = stepArr.length === 0 ? `<span class="eps">${App.config.sym.eps}</span>` : stepArr.map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : `<span class="term">${c}</span>`).join('');
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
  G.start = $('start-sym')?.value || G.start;
  const start = G.start, max = 150;
  let current = [start], steps = [[start]], found = false;
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
    const newArr = [...current];
    newArr.splice(rightmostIdx, 1, ...(p.rhs === App.config.sym.eps ? [] : p.rhsArr));
    current = newArr;
    steps.push(current); applied = true;
    if (!current.some(ch => G.vars.has(ch))) { found = true; break; }
  }
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Rightmost Derivation from ' + start + '</h3>';
  steps.forEach((stepArr, i) => {
    const colored = stepArr.length === 0 ? `<span class="eps">${App.config.sym.eps}</span>` : stepArr.map(c => G.vars.has(c) ? `<span class="nt">${c}</span>` : `<span class="term">${c}</span>`).join('');
    html += `<div class="deriv-step">${i > 0 ? '⇒<sub>rm</sub> ' : ''}${colored}</div>`;
  });
  if (!found) html += `<div style="font-size:.7rem;color:var(--text3);margin-top:8px">Derivation truncated at ${max} steps.</div>`;
  out.innerHTML = html;
}

function runParseTree() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym')?.value || G.start;
  // Build a simple derivation tree structure via leftmost derivation
  function buildTree(sym, depth) {
    if (depth > 20 || !G.vars.has(sym)) return { sym, children: [] };
    const prods = G.productions.filter(p => p.lhs === sym);
    if (!prods.length) return { sym, children: [] };
    const p = prods[0];
    return { sym, children: (p.rhs === App.config.sym.eps ? [App.config.sym.eps] : p.rhsArr).map(c => buildTree(c, depth + 1)) };
  }
  const tree = buildTree(G.start, 0);
  // Layout and render as SVG
  const svgData = layoutParseTree(tree);
  out.innerHTML = `<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Parse Tree (first derivation)</h3>${svgData}`;
}

function layoutParseTree(root) {
  const nodeH = 40, levelH = 60, minGap = 20;
  const positions = [];
  let maxY = 0;
  
  // First pass: compute relative X (Reingold-Tilford style conceptually, simplified)
  function calcMetrics(node) {
    if (!node.children || !node.children.length) {
      node.w = (node.sym.length * 10) + 16; 
      return node.w;
    }
    let tw = 0;
    node.children.forEach(ch => { tw += calcMetrics(ch) + minGap; });
    tw -= minGap;
    node.w = Math.max(tw, (node.sym.length * 10) + 16);
    return node.w;
  }
  calcMetrics(root);

  // Second pass: assign actual X and Y
  function assign(node, cx, y) {
    node._x = cx; node._y = y;
    positions.push(node);
    maxY = Math.max(maxY, y);
    if (node.children && node.children.length) {
      // the total width this node's children need is sum of their widths + gaps
      let totalW = 0;
      node.children.forEach(ch => totalW += ch.w);
      totalW += (node.children.length - 1) * minGap;
      
      let startX = cx - (totalW / 2);
      node.children.forEach(ch => {
        let childCx = startX + (ch.w / 2);
        assign(ch, childCx, y + levelH);
        startX += ch.w + minGap;
      });
    }
  }
  assign(root, Math.max(300, root.w / 2 + 50), 30);
  
  // Third pass to find min/max
  let minX = Infinity, maxX = -Infinity;
  positions.forEach(n => {
    minX = Math.min(minX, n._x - n.w / 2);
    maxX = Math.max(maxX, n._x + n.w / 2);
  });
  // Shift everything positive if minX < 20
  const shiftX = minX < 20 ? 20 - minX : 0;
  if (shiftX > 0) {
    positions.forEach(n => n._x += shiftX);
    maxX += shiftX;
  }

  const svgW = maxX + 40, svgH = maxY + 60;
  let edges = '', nodes = '';
  positions.forEach(node => {
    node.children.forEach(ch => {
      edges += `<line class="pt-edge" x1="${node._x}" y1="${node._y}" x2="${ch._x}" y2="${ch._y}"/>`;
    });
    const isNT = G.vars.has(node.sym);
    const rx = ((node.sym.length * 8) + 16) / 2;
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
  const strLine = $('ambig-in').value.trim() || $('cyk-in').value.trim();
  const strRaw = parseEps(strLine);
  const str = strRaw === App.config.sym.eps ? '' : strRaw;
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  if (!str) { showStatus('Enter a string to check ambiguity'); return; }
  const gTerms = getGrammarTerminals(); let targetSeq = str === App.config.sym.eps ? [] : tokenize(str, gTerms); if (targetSeq === null) return;
  const targetStr = targetSeq.join('');
  G.start = $('start-sym')?.value || G.start;
  // BFS for two different leftmost derivations
  const found = [];
  const visited = new Set([G.start]);
  const queue = [{ sentArr: [G.start], steps: [[G.start]] }];
  let iterations = 0;
  while (queue.length && found.length < 2 && iterations < 5000) {
    iterations++;
    const { sentArr, steps } = queue.shift();
    const sentStr = sentArr.join('');
    // Check if it's the target string (terminal sequence matching input exactly)
    if (sentStr === targetStr && !sentArr.some(c => G.vars.has(c))) { found.push(steps); continue; }
    if (!sentArr.some(c => G.vars.has(c))) continue; // terminal, not the target
    // Find leftmost NT
    for (let i = 0; i < sentArr.length; i++) {
      if (G.vars.has(sentArr[i])) {
        G.productions.filter(p => p.lhs === sentArr[i]).forEach(p => {
          const nxtArr = [...sentArr];
          nxtArr.splice(i, 1, ...(p.rhs === App.config.sym.eps ? [] : p.rhsArr));
          const nxtStr = nxtArr.join('');
          if (!visited.has(nxtStr + '|' + steps.length) && steps.length < 25) {
            visited.add(nxtStr + '|' + steps.length);
            queue.push({ sentArr: nxtArr, steps: [...steps, nxtArr] });
          }
        });
        break;
      }
    }
  }
  let html = `<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Ambiguity Check for "${str}"</h3>`;
  if (found.length === 0) {
    html += `<div class="pump-result fail">String "${str}" is NOT in the language (no leftmost derivation found up to depth 25).</div>`;
  } else if (found.length === 1) {
    html += `<div class="pump-result ok">Likely UNAMBIGUOUS for this string (only one leftmost derivation found within depth 25).</div>`;
    html += '<h4 style="font-size:.75rem;margin:10px 0 6px">Derivation:</h4>';
    found[0].forEach((stepArr, i) => { 
      const txt = stepArr.length === 0 ? App.config.sym.eps : stepArr.join('');
      html += `<div class="deriv-step">${i > 0 ? '⇒ ' : ''}${txt}</div>`; 
    });
  } else {
    html += `<div class="pump-result fail">AMBIGUOUS! Found two different leftmost derivations for "${str}".</div>`;
    found.forEach((deriv, di) => {
      html += `<h4 style="font-size:.75rem;margin:10px 0 6px">Derivation ${di + 1}:</h4>`;
      deriv.forEach((stepArr, i) => { 
        const txt = stepArr.length === 0 ? App.config.sym.eps : stepArr.join('');
        html += `<div class="deriv-step">${i > 0 ? '⇒ ' : ''}${txt}</div>`; 
      });
    });
  }
  out.innerHTML = html;
}

function runUselessElim() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym')?.value || G.start;
  const terms = [...App.sigma];
  // Step 1: Find productive variables
  const productive = new Set(terms);
  let changed = true;
  const prods = G.productions;
  while (changed) {
    changed = false;
    prods.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhsArr = p.rhs === App.config.sym.eps ? [] : p.rhsArr;
        if (rhsArr.every(c => productive.has(c))) {
          productive.add(p.lhs); changed = true;
        }
      }
    });
  }
  const nonproductive = [...G.vars].filter(v => !productive.has(v));
  // Remove non-productive
  let prods2 = prods.filter(p => productive.has(p.lhs) && (p.rhs === App.config.sym.eps || p.rhsArr.every(c => productive.has(c))));
  // Step 2: Find reachable variables from start
  const reachable = new Set([G.start]);
  changed = true;
  while (changed) {
    changed = false;
    prods2.forEach(p => {
      if (reachable.has(p.lhs)) {
        (p.rhs === App.config.sym.eps ? [] : p.rhsArr.filter(c => G.vars.has(c))).forEach(v => {
          if (!reachable.has(v)) { reachable.add(v); changed = true; }
        });
      }
    });
  }
  const unreachable = [...G.vars].filter(v => !reachable.has(v));
  const prods3 = prods2.filter(p => reachable.has(p.lhs));
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Useless Symbol Elimination</h3>';
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
  const prods = App._cnfProds ? App._cnfProds.filter(p => p.rhs.length >= 1) : G.productions.map(p => ({ lhs: p.lhs, rhs: p.rhs, rhsArr: p.rhsArr }));
  // Get variables in order (reversed for Lemma application)
  const vars = [...new Set(prods.map(p => p.lhs))];
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">Greibach Normal Form (GNF)</h3>';
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

function runCFG2PDA(mode = 'topdown') {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym')?.value || G.start;
  const trans = [];
  let tnum = 1;
  const eps = App.config.sym.eps;
  const stateNamesSet = new Set(['q_start', 'q_loop', 'q_accept']);

  if (mode === 'topdown') {
    // Top-Down (Expand-Match)
    trans.push({ from: 'q_start', to: 'q_loop', symbol: eps, pop: App.config.sym.stackBottom, push: G.start + App.config.sym.stackBottom, id: 't' + tnum++ });
    G.productions.forEach(p => {
      trans.push({ from: 'q_loop', to: 'q_loop', symbol: eps, pop: p.lhs, push: p.rhs === eps ? eps : p.rhs, id: 't' + tnum++ });
    });
    [...App.sigma].forEach(a => {
      trans.push({ from: 'q_loop', to: 'q_loop', symbol: a, pop: a, push: eps, id: 't' + tnum++ });
    });
    trans.push({ from: 'q_loop', to: 'q_accept', symbol: eps, pop: App.config.sym.stackBottom, push: eps, id: 't' + tnum++ });
  } else {
    // Bottom-Up (Shift-Reduce)
    trans.push({ from: 'q_start', to: 'q_loop', symbol: eps, pop: App.config.sym.stackBottom, push: App.config.sym.stackBottom, id: 't' + tnum++ });
    
    // Shift: Read input and push onto stack
    [...App.sigma].forEach(a => {
      trans.push({ from: 'q_loop', to: 'q_loop', symbol: a, pop: eps, push: a, id: 't' + tnum++ });
    });
    
    // Reduce: For each production A -> α, pop reverse(α), push A
    G.productions.forEach((p, idx) => {
      const rhsArr = p.rhsArr || [eps];
      // Due to PDA single-pop constraint, string reductions require intermediate states
      if (rhsArr.length === 0 || (rhsArr.length === 1 && rhsArr[0] === eps)) {
        trans.push({ from: 'q_loop', to: 'q_loop', symbol: eps, pop: eps, push: p.lhs, id: 't' + tnum++ });
      } else if (rhsArr.length === 1) {
        trans.push({ from: 'q_loop', to: 'q_loop', symbol: eps, pop: rhsArr[0], push: p.lhs, id: 't' + tnum++ });
      } else {
        let currState = 'q_loop';
        // Pop in reverse order:
        for (let i = rhsArr.length - 1; i >= 0; i--) {
          const symToPop = rhsArr[i];
          const isLastPop = (i === 0);
          const nextState = isLastPop ? 'q_loop' : `q_red_${idx}_${i}`;
          if (!isLastPop) stateNamesSet.add(nextState);
          const pushSym = isLastPop ? p.lhs : eps;
          trans.push({ from: currState, to: nextState, symbol: eps, pop: symToPop, push: pushSym, id: 't' + tnum++ });
          currState = nextState;
        }
      }
    });

    // Accept when stack only contains the start symbol S above the bottom marker
    trans.push({ from: 'q_loop', to: 'q_accept', symbol: eps, pop: G.start, push: eps, id: 't' + tnum++ });
  }

  const rows = trans.map(t => `<tr><td>${t.from}</td><td>${t.symbol}</td><td>${t.pop}</td><td>${t.push}</td><td>${t.to}</td></tr>`).join('');
  let html = `<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">CFG → NPDA (${mode === 'topdown' ? 'Top-Down / Leftmost' : 'Bottom-Up / Rightmost'})</h3>
<div style="font-size:.72rem;color:var(--text2);margin-bottom:10px;line-height:1.8">
  States: {${[...stateNamesSet].join(', ')}} &nbsp;&nbsp; Start: q_start &nbsp;&nbsp; Accept: q_accept<br>
  Stack alphabet: {${[...G.vars].join(',')}, ${[...App.sigma].join(',')}, ${App.config.sym.stackBottom} (bottom)}
</div>
<div style="overflow-x:auto;max-height:300px;"><table class="result-table">
<thead><tr><th>From</th><th>Read</th><th>Pop</th><th>Push</th><th>To</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div style="margin-top:10px"><button class="algo-btn" onclick="loadCFGPDA()">Load to Canvas (NPDA)</button></div>`;
  out.innerHTML = html;
  App._lastCFGPDA = trans;
  App._lastCFGPDANames = [...stateNamesSet];
}

function loadCFGPDA() {
  if (!App._lastCFGPDA) return;
  snapshot();
  App.states = []; App.transitions = []; App.accepts.clear(); App.startId = null; App.stateN = 0; App.transN = 0;
  
  const stateNames = App._lastCFGPDANames || ['q_start', 'q_loop', 'q_accept'];
  const idMap = {};
  
  // Distribute dynamically across an arc/grid
  stateNames.forEach((name, i) => {
    const id = 's' + (i + 1); App.stateN = i + 1;
    // q_start, q_loop, q_accept get fixed nice positions, others are distributed below
    let x, y;
    if (name === 'q_start') { x = 120; y = 200; }
    else if (name === 'q_loop') { x = 340; y = 200; }
    else if (name === 'q_accept') { x = 560; y = 200; }
    else {
      // Dynamic positioning for intermediate reduce states
      x = 340 + ((i % 2 === 0 ? 1 : -1) * ((Math.floor(i / 2) + 1) * 60));
      y = 300 + (Math.floor(i / 2) * 50);
    }
    App.states.push({ id, x, y, name });
    idMap[name] = id;
    if (name === 'q_start') App.startId = id;
    if (name === 'q_accept') App.accepts.add(id);
  });
  
  App.sigma = new Set();
  App.stackAlpha = new Set([App.config.sym.stackBottom]);
  App._lastCFGPDA.forEach((t, i) => {
    App.transitions.push({ ...t, id: 't' + (i + 1), from: idMap[t.from], to: idMap[t.to] });
    if (t.symbol && t.symbol !== App.config.sym.eps && t.symbol !== App.config.sym.any) App.sigma.add(t.symbol);
    if (t.pop && t.pop !== App.config.sym.eps && t.pop !== App.config.sym.any) App.stackAlpha.add(t.pop);
    if (t.push && t.push !== App.config.sym.eps && t.push !== App.config.sym.any) t.push.split('').forEach(ch => App.stackAlpha.add(ch));
  });
  App.transN = App._lastCFGPDA.length;
  
  // Natively force Explicit Stack Base (7-Tuple) paradigm since CFG algorithm structurally utilizes Z0 and string pushing
  App.config.pdaParadigm = 'explicit';
  const paradigmDropdown = document.getElementById('set-pda-paradigm');
  if (paradigmDropdown) paradigmDropdown.value = 'explicit';

  applyMachineSwitch('NPDA');
  renderAll(); updateLPanel(); updateRPanel();
  saveBackup(); // Required to persist to localStorage after programmatically loading a structure
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('NPDA loaded for CFG! (Forced 7-Tuple Paradigm)');
}

// ══════════════════════════════════════════════════════════════════
//  CFG DECISION ALGORITHMS
// ══════════════════════════════════════════════════════════════════
function runCFGIsEmpty() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym')?.value || G.start;
  const terms = [...App.sigma];
  const productive = new Set(terms);
  productive.add(App.config.sym.eps);
  let changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhs = p.rhs === App.config.sym.eps ? [] : p.rhsArr;
        if (rhs.every(c => productive.has(c))) { productive.add(p.lhs); changed = true; }
      }
    });
  }
  const nonproductive = [...G.vars].filter(v => !productive.has(v));
  const isEmpty = !productive.has(G.start);
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">CFG Emptiness Check</h3>';
  html += `<div class="cnf-step"><span class="lbl">Productive variables:</span>{${[...productive].filter(v => G.vars.has(v)).join(',') || '∅'}}</div>`;
  html += `<div class="cnf-step"><span class="lbl">Non-productive:</span>{${nonproductive.join(',') || '∅'}}</div>`;
  html += `<div class="pump-result ${isEmpty ? 'fail' : 'ok'}">${isEmpty ? 'EMPTY — Start symbol ' + G.start + ' is non-productive → L(G) = ∅' : 'NON-EMPTY — Start symbol ' + G.start + ' is productive → L(G) ≠ ∅'}</div>`;
  out.innerHTML = html;
}

function runCFGIsFinite() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  G.start = $('start-sym')?.value || G.start;
  // Build dependency graph: A depends on B if A → ...B...
  const deps = {};
  [...G.vars].forEach(v => deps[v] = new Set());
  G.productions.forEach(p => {
    if (p.rhs !== App.config.sym.eps) { p.rhsArr.filter(c => G.vars.has(c)).forEach(v => deps[p.lhs].add(v)); }
  });
  // Find productive variables
  const terms = [...App.sigma]; const productive = new Set(terms); productive.add(App.config.sym.eps);
  let changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(p => {
      if (!productive.has(p.lhs)) {
        const rhs = p.rhs === App.config.sym.eps ? [] : p.rhsArr;
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
  let html = '<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:12px">CFG Finiteness Check</h3>';
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
//  DPDA/NPDA → CFG (Sipser Construction)
// ══════════════════════════════════════════════════════════════════
function runPDA2CFG(mode = 'raw') {
  const out = $('gram-output');
  if (!isCfgConvertiblePDA(App.machine)) {
    out.innerHTML = `<div class="cnf-step"><span class="lbl">Switch to DPDA or NPDA mode to use this conversion.</span></div>`;
    return;
  }
  if (App.config.pdaParadigm === 'empty') {
    out.innerHTML = `<div class="cnf-step"><span class="lbl" style="color:var(--error-color)">Conversion Failed.</span> The DPDA / NPDA → CFG (Triple Construction) algorithm conceptually requires transitions to evaluate explicitly popped elements from Γ. Change the Engine settings to '7-Tuple (Explicit Stack Base)' and normalize your DPDA or NPDA to pop exactly 1 symbol per transition.</div>`;
    return;
  }
  if (!App.states.length) { out.innerHTML = '<div class="cnf-step"><span class="lbl">No DPDA or NPDA states defined.</span></div>'; return; }
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

  let startName = 'qStart';
  while (stateNames.includes(startName)) startName += '_';
  let drainName = 'qDrain';
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

  let prods = [];
  prods.push({ lhs: 'S', rhs: `[${startName},${freshBottom},${drainName}]`, rhsArr: [`[${startName},${freshBottom},${drainName}]`] });

  trans.forEach(t => {
    const p = t.from;
    const q = t.to;
    const a = t.symbol || eps;
    const pop = t.pop || eps;
    const push = t.push || eps;
    const pushSyms = push === eps ? [] : push.split('');

    if (pushSyms.length === 0) {
      prods.push({ lhs: `[${p},${pop},${q}]`, rhs: a, rhsArr: a === eps ? [] : [a] });
    } else if (pushSyms.length === 1) {
      states.forEach(r => {
        const rn = r.name;
        const rhsA = a === eps ? [] : [a];
        rhsA.push(`[${q},${pushSyms[0]},${rn}]`);
        const rhsStr = rhsA.join('');
        prods.push({ lhs: `[${p},${pop},${rn}]`, rhs: rhsStr, rhsArr: rhsA });
      });
    } else if (pushSyms.length === 2) {
      states.forEach(s => {
        states.forEach(r => {
          const sn = s.name, rn = r.name;
          const rhsA = a === eps ? [] : [a];
          rhsA.push(`[${q},${pushSyms[0]},${sn}]`);
          rhsA.push(`[${sn},${pushSyms[1]},${rn}]`);
          const rhsStr = rhsA.join('');
          prods.push({ lhs: `[${p},${pop},${rn}]`, rhs: rhsStr, rhsArr: rhsA });
        });
      });
    }
  });

  let prunedMessage = '';
  if (mode === 'pruned') {
    const totalOriginal = prods.length;
    // Step 1: Find Generating Variables
    let generating = new Set([...App.sigma, eps]); // terminals are generating
    let changed = true;
    while (changed) {
      changed = false;
      prods.forEach(p => {
        if (!generating.has(p.lhs)) {
          const allGen = p.rhsArr.every(sym => !sym.startsWith('[') || generating.has(sym));
          if (allGen) { generating.add(p.lhs); changed = true; }
        }
      });
    }
    prods = prods.filter(p => generating.has(p.lhs) && p.rhsArr.every(sym => !sym.startsWith('[') || generating.has(sym)));
    
    // Step 2: Find Reachable Variables
    let reachable = new Set(['S']);
    changed = true;
    while (changed) {
      changed = false;
      prods.forEach(p => {
        if (reachable.has(p.lhs)) {
          p.rhsArr.forEach(sym => {
            if (sym.startsWith('[') && !reachable.has(sym)) {
              reachable.add(sym);
              changed = true;
            }
          });
        }
      });
    }
    prods = prods.filter(p => reachable.has(p.lhs));

    prunedMessage = `&nbsp;&nbsp; Pruned ${totalOriginal - prods.length} useless rules.`;
  }

  const byLHS = {};
  prods.forEach(p => {
    if (!byLHS[p.lhs]) byLHS[p.lhs] = new Set();
    byLHS[p.lhs].add(p);
  });

  const textFormat = Object.entries(byLHS).map(([lhs, pSet]) => {
    return `${lhs} -> ${[...pSet].map(p => p.rhs === '' ? eps : p.rhs).join(' | ')}`;
  }).join('\n');
  const isEmptyLanguage = prods.length === 0;

  const rows = Object.entries(byLHS).map(([lhs, pSet]) => {
    const rhsList = [...pSet].map(p => p.rhs === '' ? eps : p.rhs).join(' | ');
    return `<tr>
      <td style="color:var(--accent);font-family:var(--mono);font-size:.67rem">${lhs}</td>
      <td style="color:var(--text3)">&#8594;</td>
      <td style="font-family:var(--mono);font-size:.67rem">${rhsList}</td>
    </tr>`;
  }).join('');

  out.innerHTML = `
<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
  <span>DPDA / NPDA &#8594; CFG (Sipser Triple Construction)</span>
  <button id="copy-cfg-btn" class="icon-btn" title="Copy to Editor" ${isEmptyLanguage ? 'disabled' : ''} style="font-size:0.75rem;padding:4px 8px;border:1px solid var(--border);cursor:${isEmptyLanguage ? 'not-allowed' : 'pointer'};border-radius:4px;background:var(--bg3);color:var(--text);font-family:var(--sans);opacity:${isEmptyLanguage ? '0.55' : '1'}">Apply to Editor</button>
</h3>
<div style="font-size:.7rem;color:var(--text2);margin-bottom:12px;line-height:1.8">
  Non-terminal <b>[p, A, q]</b>: starting in state p with stack symbol A on top, consume some input and end in state q with A removed.<br>
  Start variable: <b>S</b> &nbsp;&nbsp; DPDA/NPDA states: ${states.length} &nbsp;&nbsp; Generated rules: ${prods.length} ${prunedMessage}
</div>
${isEmptyLanguage ? `<div class="pump-result fail">No productions remain after pruning. The resulting CFG denotes the empty language.</div>` : `<div style="overflow-x:auto"><table class="result-table">
  <thead><tr><th>LHS</th><th></th><th>RHS</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`}
<div style="font-size:.62rem;color:var(--text3);margin-top:8px">
  Assumes the input DPDA/NPDA pops exactly 1 symbol and pushes at most 2 per transition. Longer push strings require decomposition.
</div>
`;

  setTimeout(() => {
    const btn = $('copy-cfg-btn');
    if (btn && !isEmptyLanguage) {
      btn.onclick = () => {
        $('grammar-input').value = textFormat;
        parseRawGrammar();
      };
    }
  }, 10);
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
  const sRaw = parseEps(str);
  const s = sRaw === App.config.sym.eps ? '' : sRaw;
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
<h3 style="font-family:var(--sans);font-size:1.1rem;margin-bottom:8px">CYK Step-Through &mdash; "<span style="color:var(--gold)">${s}</span>"</h3>
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


// ══════════════════════════════════════════════════════════════════
//  ADVANCED & COMPILER THEORY
// ══════════════════════════════════════════════════════════════════

/** Chomsky Hierarchy Classification */
function runChomskyClassify() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  
  let type = 3; // Start assuming Regular
  let isRightLinear = true;
  let isLeftLinear = true;
  let isType2 = true;
  let isType1 = true;

  const eps = App.config.sym.eps;

  G.productions.forEach(rule => {
    const lhs = rule.lhs;
    const rhsArr = rule.rhsArr;

    // Type 2 Check: LHS must be a single variable
    if (!G.vars.has(lhs)) {
        isType2 = false;
        isType3 = false;
    }

    // Type 3 (Regular) Check
    // Right linear: A -> a or A -> aB
    // Left linear: A -> a or A -> Ba
    let hasNonTerminal = false;
    let ntPos = -1;
    rhsArr.forEach((token, idx) => {
        if (G.vars.has(token)) {
            if (hasNonTerminal) { isRightLinear = false; isLeftLinear = false; }
            hasNonTerminal = true;
            ntPos = idx;
        }
    });

    if (hasNonTerminal) {
        if (ntPos !== rhsArr.length - 1) isRightLinear = false;
        if (ntPos !== 0) isLeftLinear = false;
    }
  });

  if (!isType2) type = 0; // Simplified check for Type 0/1
  else if (isRightLinear || isLeftLinear) type = 3;
  else type = 2;

  const desc = {
    3: "<b>Type 3: Regular Grammar</b><br>Rules are right-linear or left-linear. This grammar can be recognized by a Finite Automaton.",
    2: "<b>Type 2: Context-Free Grammar</b><br>LHS is always a single variable. This grammar can be recognized by a Pushdown Automaton.",
    0: "<b>Type 0/1: Unrestricted/Context-Sensitive</b><br>LHS contains multiple symbols or terminals. Beyond context-free."
  };

  out.innerHTML = `<div class="card">
    <div class="card-title" style="color:var(--gold)">Chomsky Hierarchy Result</div>
    <div style="font-size:1.1rem;margin:10px 0">${desc[type]}</div>
    <div style="font-size:0.75rem;color:var(--text3)">Classification is based on the structural constraints of the production rules.</div>
  </div>`;
}

/** Compute First and Follow Sets */
function computeFirstFollow() {
  const vars = [...G.vars];
  const first = {};
  const follow = {};
  const eps = App.config.sym.eps;

  vars.forEach(v => { first[v] = new Set(); follow[v] = new Set(); });

  // 1. Compute FIRST sets
  let changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(rule => {
      const A = rule.lhs;
      const rhs = rule.rhsArr;

      if (rhs.length === 1 && rhs[0] === eps) {
        if (!first[A].has(eps)) { first[A].add(eps); changed = true; }
      } else {
        let canBeEps = true;
        for (const sym of rhs) {
          if (!G.vars.has(sym)) {
            if (!first[A].has(sym)) { first[A].add(sym); changed = true; }
            canBeEps = false; break;
          } else {
            let addedAnything = false;
            for (const f of first[sym]) {
              if (f !== eps && !first[A].has(f)) { first[A].add(f); changed = true; addedAnything = true; }
            }
            if (!first[sym].has(eps)) { canBeEps = false; break; }
          }
        }
        if (canBeEps && !first[A].has(eps)) { first[A].add(eps); changed = true; }
      }
    });
  }

  // 2. Compute FOLLOW sets
  const start = G.start;
  if (follow[start]) follow[start].add('$');

  changed = true;
  while (changed) {
    changed = false;
    G.productions.forEach(rule => {
      const A = rule.lhs;
      const rhs = rule.rhsArr;

      for (let i = 0; i < rhs.length; i++) {
        const B = rhs[i];
        if (G.vars.has(B)) {
          let trailer = new Set(follow[A]);
          for (let j = rhs.length - 1; j > i; j--) {
            const C = rhs[j];
            if (!G.vars.has(C)) {
                trailer = new Set([C]);
            } else {
                const fC = first[C];
                if (fC.has(eps)) {
                    fC.forEach(x => { if(x !== eps) trailer.add(x); });
                } else {
                    trailer = new Set(fC);
                }
            }
          }
          const oldSize = follow[B].size;
          trailer.forEach(t => follow[B].add(t));
          if (follow[B].size > oldSize) changed = true;
        }
      }
    });
  }
  return { first, follow };
}

function runFirstFollow() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  
  const { first, follow } = computeFirstFollow();
  
  const rows = Object.keys(first).map(v => `<tr>
    <td style="color:var(--accent);font-family:var(--mono)">${v}</td>
    <td style="font-family:var(--mono)">{ ${[...first[v]].join(', ')} }</td>
    <td style="font-family:var(--mono)">{ ${[...follow[v]].join(', ')} }</td>
  </tr>`).join('');

  out.innerHTML = `<div class="card">
    <div class="card-title">First & Follow Sets</div>
    <table class="result-table">
        <thead><tr><th>Variable</th><th>First(V)</th><th>Follow(V)</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** LL(1) Parsing Table Generation */
function runLL1Table() {
  const out = $('gram-output');
  if (!G.productions.length) { showStatus('Add a grammar first'); return; }
  
  const { first, follow } = computeFirstFollow();
  const terminals = new Set();
  G.productions.forEach(p => p.rhsArr.forEach(t => { if(!G.vars.has(t) && t !== App.config.sym.eps) terminals.add(t); }));
  terminals.add('$');

  const table = {};
  let conflict = false;

  G.productions.forEach(rule => {
    const A = rule.lhs;
    const rhs = rule.rhsArr;
    if (!table[A]) table[A] = {};

    // Compute FIRST(rhs)
    const firstRHS = new Set();
    let canBeEps = true;
    for (const sym of rhs) {
      if (!G.vars.has(sym)) {
        if (sym !== App.config.sym.eps) firstRHS.add(sym);
        canBeEps = (sym === App.config.sym.eps);
        break;
      } else {
        first[sym].forEach(f => { if(f !== App.config.sym.eps) firstRHS.add(f); });
        if (!first[sym].has(App.config.sym.eps)) { canBeEps = false; break; }
      }
    }
    if (canBeEps) firstRHS.add(App.config.sym.eps);

    firstRHS.forEach(terminal => {
      if (terminal !== App.config.sym.eps) {
        if (table[A][terminal]) conflict = true;
        else table[A][terminal] = rule.rhs;
      } else {
        follow[A].forEach(fTerminal => {
          if (table[A][fTerminal]) conflict = true;
          else table[A][fTerminal] = rule.rhs;
        });
      }
    });
  });

  const terms = [...terminals].sort();
  const header = `<tr><th></th>${terms.map(t => `<th>${t}</th>`).join('')}</tr>`;
  const rows = Object.keys(table).map(v => {
    return `<tr><th style="background:var(--surface2)">${v}</th>${terms.map(t => `<td>${table[v][t] || ''}</td>`).join('')}</tr>`;
  }).join('');

  out.innerHTML = `<div class="card">
    <div class="card-title">LL(1) Parsing Table</div>
    ${conflict ? `<div class="pump-result fail" style="margin-bottom:12px">⚠️ Conflicts detected! Grammar is not LL(1).</div>` : ''}
    <div style="overflow-x:auto"><table class="result-table">
        <thead>${header}</thead>
        <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

/** Remove Direct Left Recursion */
function runLeftRecursionRemoval() {
    const out = $('gram-output');
    if (!G.productions.length) { showStatus('Add a grammar first'); return; }
    
    const vars = [...G.vars];
    const newProds = [];
    const warnings = [];
    const eps = App.config.sym.eps;

    vars.forEach(A => {
        const rulesA = G.productions
          .filter(p => p.lhs === A)
          .map(p => ({ ...p, rhsArr: p.rhsArr || tokenizeRHS(p.rhs, G.vars) }));
        const recursive = rulesA.filter(p => p.rhsArr[0] === A);
        const nonRecursive = rulesA.filter(p => p.rhsArr[0] !== A);

        if (recursive.length > 0) {
            if (nonRecursive.length === 0) {
                rulesA.forEach(p => newProds.push(p));
                warnings.push(`Skipped ${A}: no non-left-recursive alternative exists, so removing direct left recursion would change the language.`);
                return;
            }
            const ARime = A + "'";
            nonRecursive.forEach(p => {
                const newRhs = (p.rhs === eps ? [] : p.rhsArr).concat([ARime]);
                newProds.push({ lhs: A, rhs: newRhs.join(''), rhsArr: newRhs });
            });
            recursive.forEach(p => {
                const alpha = p.rhsArr.slice(1);
                const newRhs = alpha.concat([ARime]);
                newProds.push({ lhs: ARime, rhs: newRhs.join(''), rhsArr: newRhs });
            });
            newProds.push({ lhs: ARime, rhs: eps, rhsArr: [eps] });
        } else {
            rulesA.forEach(p => newProds.push(p));
        }
    });

    const formatRule = p => `${p.lhs} → ${p.rhs}`;
    out.innerHTML = `<div class="card">
        <div class="card-title">Left Recursion Removal</div>
        ${warnings.length ? `<div class="pump-result fail" style="margin-bottom:12px">${warnings.join('<br>')}</div>` : ''}
        <div style="font-family:var(--mono);font-size:0.8rem;line-height:1.6">
            ${newProds.map(p => `<div><span style="color:var(--accent)">${p.lhs}</span> → ${p.rhs}</div>`).join('')}
        </div>
        <div class="pump-result ok" style="margin-top:12px">Transformed grammar is now suitable for top-down parsing.</div>
    </div>`;
}
