// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
function makeSVG(t) { return document.createElementNS(SVG_NS, t); }

function renderAll() {
  const cfg = getMachineConfig(App.machine);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;
  renderTransitions(); renderStates(); renderMinimap();
  // Refresh cache after redraw
  App.domCache.states.clear();
  App.domCache.transitions.clear();
  App.domCache.startArrow = $('trans-g').querySelector('[data-start-arrow="true"]');
  document.querySelectorAll('.sn').forEach(el => App.domCache.states.set(el.getAttribute('data-id'), el));
  document.querySelectorAll('.edge-g').forEach(el => App.domCache.transitions.set(el.getAttribute('data-edge'), el));
}

function groupTrans() {
  const g = {};
  App.transitions.forEach(t => { const k = t.from + '→' + t.to; if (!g[k]) g[k] = { from: t.from, to: t.to, ts: [] }; g[k].ts.push(t); });
  return Object.values(g);
}

function renderTransitions() {
  const g = $('trans-g'); g.innerHTML = '';
  const lg = $('trans-lbl-g'); if (lg) lg.innerHTML = '';
  // start arrow
  if (App.startId) {
    const s = getState(App.startId);
    if (s) {
      const a = makeSVG('path');
      const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
      a.setAttribute('d', `M ${s.x - R - al} ${s.y} L ${s.x - R - ah / 3} ${s.y}`);
      a.setAttribute('data-start-arrow', 'true');
      a.setAttribute('stroke', 'var(--green)'); a.setAttribute('stroke-width', '1.5'); a.setAttribute('fill', 'none'); a.setAttribute('marker-end', 'url(#arr-g)');
      g.appendChild(a);
      App.domCache.startArrow = a;
    }
  }
  groupTrans().forEach(grp => {
    const from = getState(grp.from), to = getState(grp.to);
    if (!from || !to) return;
    const lbl = grp.ts.map(transLabel).join(', ');
    const isSelf = from.id === to.id;
    let pathEl, textEl, hitEl;
    const edgeGrp = makeSVG('g');
    edgeGrp.classList.add('edge-g');
    edgeGrp.setAttribute('data-edge', from.id + '|' + to.id);
    if (grp.ts.some(t => App.selectedTransitions.has(t.id))) edgeGrp.classList.add('sel-t');

    if (isSelf) {
      const so = App.config.render.selfLoopOff, ss = App.config.render.selfLoopSize;
      const d = `M ${from.x - so} ${from.y - R} A ${ss} ${ss} 0 1 1 ${from.x + so} ${from.y - R}`;
      pathEl = makeSVG('path');
      pathEl.setAttribute('d', d); pathEl.setAttribute('marker-end', 'url(#arr)');
      pathEl.classList.add('tarr');

      hitEl = makeSVG('path');
      hitEl.setAttribute('d', d); hitEl.classList.add('tarr-hit');

      textEl = makeSVG('text');
      textEl.classList.add('tlbl');
      textEl.textContent = lbl;
      textEl.setAttribute('id', `lbl-${from.id}|${to.id}`);
      
      const arcCentY = from.y - R - Math.sqrt(ss * ss - so * so);
      const ly = arcCentY - ss;
      const lx = from.x;

      textEl.setAttribute('x', lx); textEl.setAttribute('y', ly);
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('text-anchor', 'middle');

      edgeGrp.appendChild(pathEl);
      edgeGrp.appendChild(hitEl);
      if ($('trans-lbl-g')) $('trans-lbl-g').appendChild(textEl);
      else edgeGrp.appendChild(textEl);
    } else {
      const hasRev = App.transitions.some(t => t.from === grp.to && t.to === grp.from);
      const dx = to.x - from.x, dy = to.y - from.y, dist = Math.sqrt(dx * dx + dy * dy);
      const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;

      const defCrv = hasRev ? App.config.render.curveOff : 0;
      const crvVal = grp.ts[0].curve !== undefined ? grp.ts[0].curve : defCrv;

      const mx = (from.x + to.x) / 2 + px * crvVal, my = (from.y + to.y) / 2 + py * crvVal;
      const sx = from.x + ux * R, sy = from.y + uy * R;
      const ex = to.x - ux * (R + App.config.render.arrowHeadSize), ey = to.y - uy * (R + App.config.render.arrowHeadSize);
      const d = crvVal ? `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`;

      pathEl = makeSVG('path');
      pathEl.setAttribute('d', d); pathEl.setAttribute('marker-end', 'url(#arr)');
      pathEl.classList.add('tarr');

      hitEl = makeSVG('path');
      hitEl.setAttribute('d', d);
      hitEl.classList.add('tarr-hit');

      textEl = makeSVG('text');
      textEl.classList.add('tlbl');
      textEl.textContent = lbl;
      textEl.setAttribute('id', `lbl-${from.id}|${to.id}`);
      
      const lx = crvVal ? (sx + 2 * mx + ex) / 4 : (sx + ex) / 2;
      const ly = crvVal ? (sy + 2 * my + ey) / 4 : (sy + ey) / 2;
      
      textEl.setAttribute('x', lx);
      textEl.setAttribute('y', ly);
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('text-anchor', 'middle');

      edgeGrp.appendChild(pathEl);
      edgeGrp.appendChild(hitEl);
      if ($('trans-lbl-g')) $('trans-lbl-g').appendChild(textEl);
      else edgeGrp.appendChild(textEl);
    }

    edgeGrp.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (App.tool === 'del') {
        snapshot();
        const ids = new Set(grp.ts.map(t => t.id));
        App.transitions = App.transitions.filter(t => !ids.has(t.id));
        renderAll(); updateLPanel(); updateRPanel();
        return;
      }
      if (App.tool === 'pointer') {
        const isSel = grp.ts.some(t => App.selectedTransitions.has(t.id));
        if (!e.shiftKey && !isSel) {
          App.selectedStates.clear();
          App.selectedTransitions.clear();
          document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
          grp.ts.forEach(t => App.selectedTransitions.add(t.id));
          edgeGrp.classList.add('sel-t');
        } else if (e.shiftKey) {
          if (isSel) {
            grp.ts.forEach(t => App.selectedTransitions.delete(t.id));
            edgeGrp.classList.remove('sel-t');
            return;
          } else {
            grp.ts.forEach(t => App.selectedTransitions.add(t.id));
            edgeGrp.classList.add('sel-t');
          }
        }
        if (!isSelf) {
          App.dragCurve = { grp, from, to };
        }
      }
    });

    edgeGrp.addEventListener('dblclick', e => {
      if (App.tool !== 'pointer') return;
      e.stopPropagation();
      openTransModal(from.id, to.id);
    });

    edgeGrp.appendChild(pathEl);
    edgeGrp.appendChild(hitEl);
    edgeGrp.appendChild(textEl);
    g.appendChild(edgeGrp);
  });
}

function updateFastDOM() {
  App.states.forEach(s => {
    const grp = App.domCache.states.get(s.id) || document.querySelector(`[data-id="${s.id}"]`);
    if (!grp) return;
    if (!App.domCache.states.has(s.id)) App.domCache.states.set(s.id, grp);

    const c = grp.querySelector('circle.bd');
    if (c) { c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); }
    const r2 = grp.querySelector('circle[fill="none"]');
    if (r2) { r2.setAttribute('cx', s.x); r2.setAttribute('cy', s.y); }
    const t = grp.querySelector('text.slbl');
    if (t) { t.setAttribute('x', s.x); t.setAttribute('y', App.machine === 'Moore' ? s.y - App.config.render.textMargin : s.y); }
    const ot = grp.querySelector('text.mooreout');
    if (ot) { ot.setAttribute('x', s.x); ot.setAttribute('y', s.y + App.config.render.mooreTextMargin); }
  });

  const startArrow = App.domCache.startArrow;
  if (startArrow && App.startId) {
    const s = getState(App.startId);
    if (s) {
      const al = App.config.render.startArrowLen, ah = App.config.render.arrowHeadSize;
      startArrow.setAttribute('d', `M ${s.x - R - al} ${s.y} L ${s.x - R - ah / 3} ${s.y}`);
    }
  }

  // Fast transitions update: only update attributes for existing edges
  App.domCache.transitions.forEach((edgeGrp, key) => {
    const [fid, tid] = key.split('|');
    const from = getState(fid), to = getState(tid);
    if (!from || !to) return;
    const isSelf = fid === tid;
    const pathEl = edgeGrp.querySelector('.tarr'), hitEl = edgeGrp.querySelector('.tarr-hit');
    const textEl = document.getElementById(`lbl-${fid}|${tid}`) || edgeGrp.querySelector('.tlbl');
    if (!pathEl || !textEl) return;

    if (isSelf) {
      const so = App.config.render.selfLoopOff, ss = App.config.render.selfLoopSize;
      const d = `M ${from.x - so} ${from.y - R} A ${ss} ${ss} 0 1 1 ${from.x + so} ${from.y - R}`;
      pathEl.setAttribute('d', d);
      if (hitEl) hitEl.setAttribute('d', d);
      
      const arcCentY = from.y - R - Math.sqrt(ss * ss - so * so);
      const ly = arcCentY - ss;
      const lx = from.x;
      
      textEl.setAttribute('x', lx); textEl.setAttribute('y', ly);
    } else {
      const hasRev = App.transitions.some(t => t.from === tid && t.to === fid);
      const dx = to.x - from.x, dy = to.y - from.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) return;
      const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;
      const defCrv = hasRev ? App.config.render.curveOff : 0;
      // Get the curve value from the first transition in the group
      const firstTrans = App.transitions.find(t => t.from === fid && t.to === tid);
      const crvVal = (firstTrans && firstTrans.curve !== undefined) ? firstTrans.curve : defCrv;

      const mx = (from.x + to.x) / 2 + px * crvVal, my = (from.y + to.y) / 2 + py * crvVal;
      const sx = from.x + ux * R, sy = from.y + uy * R;
      const ex = to.x - ux * (R + App.config.render.arrowHeadSize), ey = to.y - uy * (R + App.config.render.arrowHeadSize);
      const d = crvVal ? `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` : `M ${sx} ${sy} L ${ex} ${ey}`;
      
      pathEl.setAttribute('d', d);
      if (hitEl) hitEl.setAttribute('d', d);
      
      const lx = crvVal ? (sx + 2 * mx + ex) / 4 : (sx + ex) / 2;
      const ly = crvVal ? (sy + 2 * my + ey) / 4 : (sy + ey) / 2;
      
      textEl.setAttribute('x', lx);
      textEl.setAttribute('y', ly);
    }
  });
}

function renderStates() {
  const g = $('states-g'); g.innerHTML = '';
  App.states.forEach(s => {
    const grp = makeSVG('g');
    grp.classList.add('sn');
    grp.setAttribute('data-id', s.id);
    if (App.startId === s.id) grp.classList.add('start-st');
    const showAccepts = !(getMachineConfig(App.machine).isTransducer && !App.config.transducerAccepts);
    if (showAccepts && App.accepts.has(s.id)) grp.classList.add('acc-st');
    // Dead/unreachable overlay (set by Dead State Analysis algo)
    if (App.stateClassification) {
      const cls = App.stateClassification.get(s.id);
      if (cls === 'unreachable') grp.classList.add('unreachable-st');
      else if (cls === 'dead') grp.classList.add('dead-st');
    }
    const c = makeSVG('circle');
    c.classList.add('bd'); c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', R);
    grp.appendChild(c);
    if (showAccepts && App.accepts.has(s.id)) {
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
    grp.addEventListener('contextmenu', e => { 
      e.preventDefault(); App.ctxId = s.id; 
      const m = $('ctx'); 
      const toggleOpt = $('ctx-toggle-acc');
      if (toggleOpt) toggleOpt.style.display = showAccepts ? '' : 'none';
      m.style.display = 'block'; 
      m.style.left = Math.min(e.clientX, innerWidth - 160) + 'px'; 
      m.style.top = Math.min(e.clientY, innerHeight - 140) + 'px'; 
    });
    grp.addEventListener('dblclick', () => { 
      if (!showAccepts) return;
      App.accepts.has(s.id) ? App.accepts.delete(s.id) : App.accepts.add(s.id); 
      snapshot(); renderAll(); updateLPanel(); updateRPanel(); 
    });
    g.appendChild(grp);
  });
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════════════════
function updateLPanel() {
  const sl = $('states-list');
  const showAccepts = !(getMachineConfig(App.machine).isTransducer && !App.config.transducerAccepts);
  sl.innerHTML = App.states.length ? App.states.map(s => `
<div class="si ${App.startId === s.id ? 'start' : ''} ${showAccepts && App.accepts.has(s.id) ? 'acc' : ''}" onclick="openStateModal('${s.id}')">
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
    const { eps, stackBottom } = App.config.sym;
    txt = `M = (Q,Σ,Γ,δ,q₀,${stackBottom},F)\n\nQ = {${Q}}\nΣ = {${S}}\nΓ = {${G}}\nq₀ = ${q0}\nF = {${F}}\nδ: Q×(Σ∪{${eps}})×Γ→2^(Q×Γ*)`;
  } else if (m === 'Moore') {
    const D = [...App.outputAlpha].join(', ') || '∅';
    const { lambda } = App.config.sym;
    txt = `M = (Q, Σ, Δ, δ, ${lambda}, q₀)\n\nQ = {${Q}}\nΣ = {${S}}\nΔ = {${D}}\nq₀ = ${q0}\nδ: Q×Σ→Q\n${lambda}: Q→Δ`;
  } else if (m === 'Mealy') {
    const D = [...App.outputAlpha].join(', ') || '∅';
    const { lambda } = App.config.sym;
    txt = `M = (Q, Σ, Δ, δ, ${lambda}, q₀)\n\nQ = {${Q}}\nΣ = {${S}}\nΔ = {${D}}\nq₀ = ${q0}\nδ: Q×Σ→Q\n${lambda}: Q×Σ→Δ`;
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
