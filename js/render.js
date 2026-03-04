// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
function makeSVG(t) { return document.createElementNS(SVG_NS, t); }

function renderAll() {
  const cfg = getMachineConfig(App.machine);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;
  renderTransitions(); renderStates(); renderMinimap();
}

function groupTrans() {
  const g = {};
  App.transitions.forEach(t => { const k = t.from + '→' + t.to; if (!g[k]) g[k] = { from: t.from, to: t.to, ts: [] }; g[k].ts.push(t); });
  return Object.values(g);
}

function renderTransitions() {
  const g = $('trans-g'); g.innerHTML = '';
  // start arrow
  if (App.startId) {
    const s = getState(App.startId);
    if (s) {
      const a = makeSVG('path');
      const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
      a.setAttribute('d', `M ${s.x - R - al} ${s.y} L ${s.x - R - ah / 3} ${s.y}`);
      a.setAttribute('stroke', 'var(--green)'); a.setAttribute('stroke-width', '1.5'); a.setAttribute('fill', 'none'); a.setAttribute('marker-end', 'url(#arr-g)');
      g.appendChild(a);
    }
  }
  groupTrans().forEach(grp => {
    const from = getState(grp.from), to = getState(grp.to);
    if (!from || !to) return;
    const lbl = grp.ts.map(transLabel).join(', ');
    const isSelf = from.id === to.id;
    let pathEl, textEl;
    if (isSelf) {
      pathEl = makeSVG('path');
      const so = App.config.render.selfLoopOff, ss = App.config.render.selfLoopSize;
      pathEl.setAttribute('d', `M ${from.x - so} ${from.y - R} A ${ss} ${ss} 0 1 1 ${from.x + so} ${from.y - R}`);
      pathEl.setAttribute('marker-end', 'url(#arr)');
      pathEl.classList.add('tarr');
      textEl = makeSVG('text');
      textEl.setAttribute('x', from.x); textEl.setAttribute('y', from.y - R - App.config.render.selfLoopTextOff);
      textEl.classList.add('tlbl'); textEl.textContent = lbl;
    } else {
      const hasRev = App.transitions.some(t => t.from === grp.to && t.to === grp.from);
      const dx = to.x - from.x, dy = to.y - from.y, dist = Math.sqrt(dx * dx + dy * dy);
      const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;
      const crv = hasRev ? App.config.render.curveOff : 0;
      const mx = (from.x + to.x) / 2 + px * crv, my = (from.y + to.y) / 2 + py * crv;
      const sx = from.x + ux * R, sy = from.y + uy * R;
      const ex = to.x - ux * (R + App.config.render.arrowHeadSize), ey = to.y - uy * (R + App.config.render.arrowHeadSize);
      const d = crv ? `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`;
      pathEl = makeSVG('path');
      pathEl.setAttribute('d', d); pathEl.setAttribute('marker-end', 'url(#arr)');
      pathEl.classList.add('tarr');
      textEl = makeSVG('text');
      textEl.setAttribute('x', crv ? mx : (sx + ex) / 2); textEl.setAttribute('y', (crv ? my : (sy + ey) / 2) - App.config.render.textMargin);
      textEl.classList.add('tlbl'); textEl.textContent = lbl;
    }
    g.appendChild(pathEl); g.appendChild(textEl);
  });
}

function renderStates() {
  const g = $('states-g'); g.innerHTML = '';
  App.states.forEach(s => {
    const grp = makeSVG('g');
    grp.classList.add('sn');
    grp.setAttribute('data-id', s.id);
    if (App.startId === s.id) grp.classList.add('start-st');
    if (App.accepts.has(s.id)) grp.classList.add('acc-st');
    const c = makeSVG('circle');
    c.classList.add('bd'); c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', R);
    grp.appendChild(c);
    if (App.accepts.has(s.id)) {
      const r2 = makeSVG('circle');
      r2.setAttribute('cx', s.x); r2.setAttribute('cy', s.y); r2.setAttribute('r', R - 5);
      r2.setAttribute('fill', 'none'); r2.setAttribute('stroke', 'var(--gold)'); r2.setAttribute('stroke-width', '1.5');
      grp.appendChild(r2);
    }
    const t = makeSVG('text'); t.classList.add('slbl'); t.setAttribute('x', s.x);
    t.setAttribute('y', App.machine === 'Moore' ? s.y - App.config.render.textMargin : s.y);
    t.textContent = s.name; grp.appendChild(t);
    if (App.machine === 'Moore') {
      const ot = makeSVG('text'); ot.classList.add('mooreout');
      ot.setAttribute('x', s.x); ot.setAttribute('y', s.y + App.config.render.mooreTextMargin);
      ot.textContent = s.output !== undefined && s.output !== '' ? s.output : '—';
      grp.appendChild(ot);
    }
    grp.addEventListener('mousedown', e => onStateDown(e, s.id));
    grp.addEventListener('contextmenu', e => { e.preventDefault(); App.ctxId = s.id; const m = $('ctx'); m.style.display = 'block'; m.style.left = Math.min(e.clientX, innerWidth - 160) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - 140) + 'px'; });
    grp.addEventListener('dblclick', () => { App.accepts.has(s.id) ? App.accepts.delete(s.id) : App.accepts.add(s.id); snapshot(); renderAll(); updateSidebar(); updateRPanel(); });
    g.appendChild(grp);
  });
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════════════════
function updateSidebar() {
  const sl = $('states-list');
  sl.innerHTML = App.states.length ? App.states.map(s => `
<div class="si ${App.startId === s.id ? 'start' : ''} ${App.accepts.has(s.id) ? 'acc' : ''}" onclick="openStateModal('${s.id}')">
  ${s.name}<div class="dot"></div>
</div>`).join('') : '<div class="empty-msg">No states</div>';
  const tl = $('trans-list');
  tl.innerHTML = App.transitions.length ? App.transitions.map(t => {
    const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
    return `<div class="ti"><span>${fn}</span><span class="arr">–${transLabel(t)}→</span><span>${tn}</span><span class="dx" onclick="deleteTrans('${t.id}')">×</span></div>`;
  }).join('') : '<div class="empty-msg">No transitions</div>';
}

// ══════════════════════════════════════════════════════════════════
//  RIGHT PANEL: LANGUAGE
// ══════════════════════════════════════════════════════════════════
function updateRPanel() {
  updateFormalDef(); updateRegex();
}
function updateFormalDef() {
  const Q = App.states.map(s => s.name).join(', ') || '∅';
  const S = [...App.sigma].join(', ') || '∅';
  const q0 = getState(App.startId)?.name || '—';
  const F = App.states.filter(s => App.accepts.has(s.id)).map(s => s.name).join(', ') || '∅';
  const m = App.machine;
  let txt;
  if (m === 'DFA' || m === 'NFA' || m === 'ε-NFA') {
    txt = `M = (Q, Σ, δ, q₀, F)\n\nQ = {${Q}}\nΣ = {${S}}\nq₀ = ${q0}\nF = {${F}}\nδ: Q×Σ→${m === 'DFA' ? 'Q' : '2^Q'}`;
  } else if (m === 'PDA') {
    const G = [...App.stackAlpha].join(', ') || '∅';
    txt = `M = (Q,Σ,Γ,δ,q₀,Z,F)\n\nQ = {${Q}}\nΣ = {${S}}\nΓ = {${G}}\nq₀ = ${q0}\nF = {${F}}\nδ: Q×(Σ∪{ε})×Γ→2^(Q×Γ*)`;
  } else if (m === 'Moore') {
    const D = [...App.outputAlpha].join(', ') || '∅';
    txt = `M = (Q, Σ, Δ, δ, λ, q₀)\n\nQ = {${Q}}\nΣ = {${S}}\nΔ = {${D}}\nq₀ = ${q0}\nδ: Q×Σ→Q\nλ: Q→Δ`;
  } else if (m === 'Mealy') {
    const D = [...App.outputAlpha].join(', ') || '∅';
    txt = `M = (Q, Σ, Δ, δ, λ, q₀)\n\nQ = {${Q}}\nΣ = {${S}}\nΔ = {${D}}\nq₀ = ${q0}\nδ: Q×Σ→Q\nλ: Q×Σ→Δ`;
  } else if (m === 'MTM') {
    txt = `M = (Q,Σ,Γ,δ,q₀,q_acc,q_rej)\n\nQ = {${Q}}\nΣ = {${S}}\nq₀ = ${q0}\nF = {${F}}\nδ: Q×Γᵏ→Q×Γᵏ×{L,R}ᵏ\nk = ${App.tapeCount} tapes`;
  } else {
    txt = `M = (Q,Σ,Γ,δ,q₀,q_acc,q_rej)\n\nQ = {${Q}}\nΣ = {${S}}\nq₀ = ${q0}\nF = {${F}}\nδ: Q×Γ→Q×Γ×{L,R}`;
  }
  $('def-box').textContent = txt;
}
function updateRegex() {
  const rb = $('regex-box'), m = App.machine;
  if (m === 'PDA') { rb.textContent = 'Context-Free Language'; return; }
  if (m === 'TM' || m === 'MTM') { rb.textContent = 'Recursively Enumerable Language'; return; }
  if (m === 'Moore') { rb.textContent = 'Finite-State Transducer (Moore)'; return; }
  if (m === 'Mealy') { rb.textContent = 'Finite-State Transducer (Mealy)'; return; }
  rb.textContent = deriveRegex() || '∅';
}

// GNFA State Elimination (textbook: add new start + new accept, eliminate interior)
let _regexCache = { key: '', val: '' };
function _regexCacheKey() {
  return App.states.map(s => s.id).join(',') + '|' +
    App.transitions.map(t => t.from + t.symbol + t.to).sort().join(',') + '|' +
    App.startId + '|' + [...App.accepts].sort().join(',');
}
function deriveRegex() {
  if (!App.states.length || !App.startId) return '—';
  const accs = [...App.accepts]; if (!accs.length) return '∅';
  // Cache check (#7)
  const ck = _regexCacheKey();
  if (_regexCache.key === ck) return _regexCache.val;

  const ids = App.states.map(s => s.id);
  const gnfa = {};
  // Add new unique start (qs) and accept (qa) states (#3)
  const qs = '__gnfa_qs__', qa = '__gnfa_qa__';
  const allIds = [qs, ...ids, qa];
  allIds.forEach(a => allIds.forEach(b => { gnfa[a + '|' + b] = null; }));
  // ε from new start to old start
  gnfa[qs + '|' + App.startId] = App.config.sym.eps;
  // ε from each old accept to new accept
  accs.forEach(acc => { gnfa[acc + '|' + qa] = gnfa[acc + '|' + qa] ? reUnion(gnfa[acc + '|' + qa], App.config.sym.eps) : App.config.sym.eps; });
  // Copy original transitions
  App.transitions.forEach(t => {
    const k = t.from + '|' + t.to, sym = t.symbol;
    gnfa[k] = gnfa[k] ? reUnion(gnfa[k], sym) : sym;
  });
  // Eliminate all interior states (everything except qs and qa)
  const rem = [...allIds];
  const toElim = ids.slice(); // all original states are interior
  toElim.forEach(mid => {
    const self = gnfa[mid + '|' + mid];
    const star = self ? `(${self})*` : '';
    rem.forEach(a => {
      rem.forEach(b => {
        if (a === mid || b === mid) return;
        const r1 = gnfa[a + '|' + mid], r2 = gnfa[mid + '|' + b];
        if (!r1 || !r2) return;
        const via = reConcat(reConcat(r1, star), r2);
        gnfa[a + '|' + b] = gnfa[a + '|' + b] ? reUnion(gnfa[a + '|' + b], via) : via;
      });
    });
    rem.splice(rem.indexOf(mid), 1);
  });
  // Result is the single edge qs→qa
  const result = gnfa[qs + '|' + qa];
  const val = result ? simplifyRE(result) : '∅';
  _regexCache = { key: ck, val };
  return val;
}
function reUnion(a, b) { if (!a) return b; if (!b) return a; if (a === b) return a; return `${a} | ${b}`; }
function reConcat(a, b) { if (!a || !b) return a || b || ''; if (a === App.config.sym.eps) return b; if (b === App.config.sym.eps) return a; const pa = a.includes(' | '), pb = b.includes(' | '); return `${pa ? '(' + a + ')' : a}${pb ? '(' + b + ')' : b}`; }
function simplifyRE(r) {
  if (!r) return '∅';
  const e = App.config.sym.eps;
  const escE = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp('\\(' + escE + '\\)\\*', 'g');
  const re2 = new RegExp(escE + '\\*', 'g');
  return r.replace(re1, e).replace(re2, e)
    .replace(/\(([a-zA-Z0-9])\)\*/g, '$1*')
    .replace(/\(([a-zA-Z0-9])\)/g, '$1');
}

