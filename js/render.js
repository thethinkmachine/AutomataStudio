// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
function makeSVG(t) { return document.createElementNS(SVG_NS, t); }

function renderAll() {
  const cfg = getMachineConfig(App.machine);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;
  if (typeof pruneNoteAnchors === 'function') pruneNoteAnchors();
  renderTransitions(); renderStates(); renderNotes(); renderMinimap();
  // Refresh cache after redraw
  App.domCache.states.clear();
  App.domCache.transitions.clear();
  App.domCache.notes.clear();
  App.domCache.startArrow = $('trans-g').querySelector('[data-start-arrow="true"]');
  document.querySelectorAll('.sn').forEach(el => App.domCache.states.set(el.getAttribute('data-id'), el));
  document.querySelectorAll('.edge-g').forEach(el => App.domCache.transitions.set(el.getAttribute('data-edge'), el));
  document.querySelectorAll('.note-g').forEach(el => App.domCache.notes.set(el.getAttribute('data-note-id'), el));
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
    const lbls = grp.ts.map(transLabel);
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
      textEl.setAttribute('id', `lbl-${from.id}|${to.id}`);
      
      const arcCentY = from.y - R - Math.sqrt(ss * ss - so * so);
      const ly = arcCentY - ss;
      const lx = from.x;

      lbls.forEach((lbl, i) => {
        const tspan = makeSVG('tspan');
        tspan.textContent = lbl;
        tspan.setAttribute('x', lx);
        tspan.setAttribute('dy', i === 0 ? `-${(lbls.length - 1) * 0.6}em` : '1.2em');
        textEl.appendChild(tspan);
      });

      textEl.setAttribute('x', lx); textEl.setAttribute('y', ly);
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('text-anchor', 'middle');

      const titleEl = makeSVG('title');
      titleEl.textContent = grp.ts.map(t => transLabelDescriptive(t)).join('\n');
      textEl.appendChild(titleEl);
      const titleEl2 = makeSVG('title'); titleEl2.textContent = titleEl.textContent; edgeGrp.appendChild(titleEl2);

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
      textEl.setAttribute('id', `lbl-${from.id}|${to.id}`);
      
      const lx = crvVal ? (sx + 2 * mx + ex) / 4 : (sx + ex) / 2;
      const ly = crvVal ? (sy + 2 * my + ey) / 4 : (sy + ey) / 2;
      
      lbls.forEach((lbl, i) => {
        const tspan = makeSVG('tspan');
        tspan.textContent = lbl;
        tspan.setAttribute('x', lx);
        tspan.setAttribute('dy', i === 0 ? `-${(lbls.length - 1) * 0.6}em` : '1.2em');
        textEl.appendChild(tspan);
      });

      textEl.setAttribute('x', lx);
      textEl.setAttribute('y', ly);
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('text-anchor', 'middle');

      const titleEl = makeSVG('title');
      titleEl.textContent = grp.ts.map(t => transLabelDescriptive(t)).join('\n');
      textEl.appendChild(titleEl);
      const titleEl2 = makeSVG('title'); titleEl2.textContent = titleEl.textContent; edgeGrp.appendChild(titleEl2);

      edgeGrp.appendChild(pathEl);
      edgeGrp.appendChild(hitEl);
      if ($('trans-lbl-g')) $('trans-lbl-g').appendChild(textEl);
      else edgeGrp.appendChild(textEl);

      // Discoverability handle: a visible grip at the curve control point
      // when the edge is selected, hinting that it can be dragged to bend.
      if (grp.ts.some(t => App.selectedTransitions.has(t.id))) {
        const handle = makeSVG('circle');
        handle.classList.add('curve-handle');
        handle.setAttribute('cx', mx); handle.setAttribute('cy', my); handle.setAttribute('r', 4.5);
        edgeGrp.appendChild(handle);
      }
    }

    edgeGrp.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (App.spacePan) return;
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
        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
        if (!multi && !isSel) {
          App.selectedStates.clear();
          App.selectedTransitions.clear();
          document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
          grp.ts.forEach(t => App.selectedTransitions.add(t.id));
          edgeGrp.classList.add('sel-t');
        } else if (multi) {
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
          try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
        }
      }
    });

    edgeGrp.addEventListener('dblclick', e => {
      if (App.tool !== 'pointer') return;
      e.stopPropagation();
      openTransModal(from.id, to.id);
    });

      const onEdgeContextMenu = e => {
        e.preventDefault();
        e.stopPropagation();
        App.ctxId = null;
        App.ctxMode = 'edge';
        App.ctxEdge = { from: from.id, to: to.id, transitionIds: grp.ts.map(t => t.id), primaryId: grp.ts[0]?.id || null };
        // If this edge is already part of a larger selection (e.g. built with
        // ctrl+click across states and edges), keep it intact — right-clicking
        // shouldn't collapse a combo selection down to just this one edge.
        const alreadySelected = grp.ts.some(t => App.selectedTransitions.has(t.id));
        if (!alreadySelected) {
          App.selectedStates.clear();
          App.selectedTransitions.clear();
          document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
          grp.ts.forEach(t => App.selectedTransitions.add(t.id));
          edgeGrp.classList.add('sel-t');
        }
        showContextMenu('edge', e.clientX, e.clientY);
      };
      edgeGrp.addEventListener('contextmenu', onEdgeContextMenu);

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
    if (t) {
      t.setAttribute('x', s.x); t.setAttribute('y', App.machine === 'Moore' ? s.y - App.config.render.textMargin : s.y);
      t.querySelectorAll('tspan').forEach(ts => ts.setAttribute('x', s.x));
    }
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
      const tspans = textEl.querySelectorAll('tspan');
      if (tspans.length > 0) tspans.forEach(ts => ts.setAttribute('x', lx));
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
      const tspans = textEl.querySelectorAll('tspan');
      if (tspans.length > 0) tspans.forEach(ts => ts.setAttribute('x', lx));

      const handleEl = edgeGrp.querySelector('.curve-handle');
      if (handleEl) { handleEl.setAttribute('cx', mx); handleEl.setAttribute('cy', my); }
    }
  });

  // Anchored notes ride along with the states/edges they're pinned to.
  if (typeof updateNotesDOM === 'function') updateNotesDOM();
}

// Break a state name into per-line words at underscore/space/hyphen
// boundaries, e.g. "NEW_ACCOUNT_OPENED" -> ["NEW","ACCOUNT","OPENED"],
// so long descriptive names stack inside the fixed-radius circle
// instead of overflowing it. Names with no such boundary are left as
// a single line untouched.
function splitStateLabel(name) {
  if (!App.config.wrapStateLabels) return [String(name)];
  const parts = String(name).split(/[_\s-]+/).filter(Boolean);
  return parts.length > 1 ? parts : [String(name)];
}

// Writes `lines` into `textEl` as centered tspans and returns the line
// count, so callers can size the font to fit the circle.
function setStateLabelLines(textEl, lines, cx) {
  textEl.innerHTML = '';
  const lineH = 1.05;
  lines.forEach((line, i) => {
    const tspan = makeSVG('tspan');
    tspan.textContent = line;
    tspan.setAttribute('x', cx);
    tspan.setAttribute('dy', i === 0 ? `-${(lines.length - 1) * lineH / 2}em` : `${lineH}em`);
    textEl.appendChild(tspan);
  });
  textEl.setAttribute('font-size', lines.length >= 4 ? '8.5px' : lines.length === 3 ? '9.5px' : '11px');
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
    setStateLabelLines(t, splitStateLabel(s.name), s.x);
    grp.appendChild(t);
    if (App.machine === 'Moore') {
      const ot = makeSVG('text'); ot.classList.add('mooreout');
      ot.setAttribute('x', s.x); ot.setAttribute('y', s.y + App.config.render.mooreTextMargin);
      ot.textContent = s.output !== undefined && s.output !== '' ? s.output : '—';
      grp.appendChild(ot);
    }

    let stTitle = `State '${s.name}'`;
    const isStart = App.startId === s.id;
    const isAcc = showAccepts && App.accepts.has(s.id);
    if (isStart || isAcc) {
      const statuses = [];
      if (isStart) statuses.push('Start');
      if (isAcc) statuses.push('Accept');
      stTitle += ` (${statuses.join(', ')})`;
    }
    if (App.machine === 'Moore') {
      const o = s.output !== undefined && s.output !== '' ? s.output : App.config.sym.lambda;
      stTitle += `\nOutput: '${o}'`;
    }
    const stTitleEl = makeSVG('title'); stTitleEl.textContent = stTitle;
    grp.appendChild(stTitleEl);
    grp.addEventListener('pointerdown', e => onStateDown(e, s.id));
    grp.addEventListener('contextmenu', e => { 
      e.preventDefault();
      App.ctxId = s.id; 
      App.ctxEdge = null;
      App.ctxMode = 'state';
      const toggleOpt = $('ctx-toggle-acc');
      const renameLbl = document.querySelector('#ctx-rename .ctx-label');
      if (toggleOpt) toggleOpt.style.display = showAccepts ? '' : 'none';
      if (renameLbl) renameLbl.textContent = (App.machine === 'Moore' || App.machine === 'Mealy') ? 'Configure' : 'Rename';
      showContextMenu('state', e.clientX, e.clientY); 
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
function updateLPanelSectionMeta() {
  const setCount = (id, value) => {
    const el = $(id);
    if (el) el.textContent = String(value);
  };

  setCount('lp-count-sigma', App.sigma?.size || 0);
  setCount('lp-count-stack', App.stackAlpha?.size || 0);
  setCount('lp-count-output', App.outputAlpha?.size || 0);
  setCount('lp-count-states', App.states?.length || 0);
  setCount('lp-count-trans', App.transitions?.length || 0);
}

function updateLPanel() {
  const sl = $('states-list');
  const showAccepts = !(getMachineConfig(App.machine).isTransducer && !App.config.transducerAccepts);
  sl.innerHTML = App.states.length ? App.states.map(s => {
    let mooreOut = '';
    if (App.machine === 'Moore') {
      const outSym = (s.output === undefined || s.output === '') ? App.config.sym.lambda : s.output;
      mooreOut = `<span style="color:var(--text3);font-size:0.75em;margin-left:4px">/ ${outSym}</span>`;
    }
    const sel = App.selectedStates.has(s.id) ? 'sel' : '';
    return `<div class="si ${App.startId === s.id ? 'start' : ''} ${showAccepts && App.accepts.has(s.id) ? 'acc' : ''} ${sel}"
  onclick="focusStateFromList('${s.id}')" ondblclick="openStateModal('${s.id}')"
  onmouseenter="hlListHover('${s.id}', true)" onmouseleave="hlListHover('${s.id}', false)"
  title="Click to focus · Double-click to edit">
  ${s.name}${mooreOut}
  <button class="si-edit" onclick="event.stopPropagation(); openStateModal('${s.id}')" title="Edit state" aria-label="Edit ${s.name}">
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-8 8-3.5.5.5-3.5z"/></svg>
  </button>
  <div class="dot"></div>
</div>`;
  }).join('') : '<div class="empty-msg">No states</div>';
  const tl = $('trans-list');
  tl.innerHTML = App.transitions.length ? App.transitions.map(t => {
    const fn = getState(t.from)?.name || '?', tn = getState(t.to)?.name || '?';
    const sel = App.selectedTransitions.has(t.id) ? 'sel' : '';
    const fullTitle = `${fn} → ${tn}\n${transLabelDescriptive(t)}\nClick to focus on canvas`;
    return `<div class="ti ${sel}" onclick="focusTransFromList('${t.id}')"
  onmouseenter="hlTransListHover('${t.from}','${t.to}', true)" onmouseleave="hlTransListHover('${t.from}','${t.to}', false)"
  title="${fullTitle.replace(/"/g, '&quot;')}">
  <span class="ti-from">${fn}</span><span class="arr">–${transLabel(t)}→</span><span class="ti-to">${tn}</span>
  <span class="dx" onclick="event.stopPropagation(); deleteTrans('${t.id}')" title="Delete transition"><svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></span>
</div>`;
  }).join('') : '<div class="empty-msg">No transitions</div>';
  if (typeof filterStates === 'function') filterStates();
  if (typeof filterTransitions === 'function') filterTransitions();
  updateLPanelSectionMeta();
}

// ══════════════════════════════════════════════════════════════════
//  RIGHT PANEL: LANGUAGE
// ══════════════════════════════════════════════════════════════════
function updateRPanel() {
  updateFormalDef(); 
  updateRegex();
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
// User-supplied names (states, symbols) get interpolated straight into KaTeX
// source. Left unescaped, a name containing '_' is read as a LaTeX subscript
// operator (breaking the render), and any multi-letter name renders in the
// slanted math-variable font instead of as a normal word. Escape the LaTeX
// special characters and typeset anything that isn't the classic q0/s1
// short-name convention as upright text instead.
function escapeLatexText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([_%$#&{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function formatStateName(name) {
  if (!name) return '\\text{—}';
  const m = /^([a-zA-Z]+)(\d+)$/.exec(name);
  if (m) return `${m[1]}_{${m[2]}}`;
  return `\\text{${escapeLatexText(name)}}`;
}

function formatSet(items) {
  if (!items || !items.length) return '\\emptyset';
  return `\\{ ${items.map(formatStateName).join(', ')} \\}`;
}

function updateFormalDef() {
  const m = App.machine;
  const Q_str = formatSet(App.states.map(s => s.name));
  const S_str = formatSet([...App.sigma]);
  const q0_name = getState(App.startId)?.name;
  const q0_str = q0_name ? formatStateName(q0_name) : '\\text{—}';
  const F_str = formatSet(App.states.filter(s => App.accepts.has(s.id)).map(s => s.name));
  
  let txt = `$$ \\begin{aligned} `;
  
  if (m === 'DFA' || m === 'NFA' || m === 'ε-NFA') {
    const codomain = m === 'DFA' ? 'Q' : '\\mathcal{P}(Q)';
    const eps = (m === 'ε-NFA') ? '\\cup \\{\\varepsilon\\}' : '';
    const mapDom = (m === 'ε-NFA') ? `\\Sigma ${eps}` : '\\Sigma';
    txt += `M &= (Q, \\Sigma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times ${mapDom} \\to ${codomain}`;
  } else if (m === '2DFA' || m === '2NFA') {
    const left = App.config.sym.leftMarker;
    const right = App.config.sym.rightMarker;
    const codomain = m === '2DFA' ? 'Q \\times \\{L, R, S\\}' : '\\mathcal{P}(Q \\times \\{L, R, S\\})';
    txt += `M &= (Q, \\Sigma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${left}, ${right}\\}) \\to ${codomain} \\\\`;
  } else if (m === 'QA') {
    const G_str = formatSet([...App.stackAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q \\times \\Gamma^*)`;
  } else if (m === 'Counter') {
    const bottom = formatStateName(App.config.sym.stackBottom);
    const counterSym = formatStateName([...App.stackAlpha].find(sym => sym !== App.config.sym.stackBottom) || '1');
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\{${counterSym}, ${bottom}\\}, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times \\{${counterSym}, ${bottom}, ${eps}\\} \\to \\mathcal{P}(Q \\times \\{${counterSym}, ${bottom}, ${eps}\\}^*)`;
  } else if (m === '2PDA') {
    const G_str = formatSet([...App.stackAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Gamma_1, \\Gamma_2, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma_1 = \\Gamma_2 &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma_1 \\cup \\{${eps}\\}) \\times (\\Gamma_2 \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q \\times \\Gamma_1^* \\times \\Gamma_2^*)`;
  } else if (isAnyPDA(m)) {
    const G_str = formatSet([...App.stackAlpha]);
    const stackBottomStr = formatStateName(App.config.sym.stackBottom);
    const eps = '\\varepsilon';
    const codomain = m === 'NPDA' ? '\\mathcal{P}(Q \\times \\Gamma^*)' : 'Q \\times \\Gamma^*';
    const emptyCodomain = m === 'NPDA' ? `\\mathcal{P}(Q \\times (\\Gamma \\cup \\{${eps}\\})^*)` : `Q \\times (\\Gamma \\cup \\{${eps}\\})^*`;
    
    if (App.config.pdaParadigm === 'explicit') {
      txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, Z_0, F) \\\\`;
      txt += `Q &= ${Q_str} \\\\`;
      txt += `\\Sigma &= ${S_str} \\\\`;
      txt += `\\Gamma &= ${G_str} \\\\`;
      txt += `q_0 &= ${q0_str} \\\\`;
      txt += `Z_0 &= ${stackBottomStr} \\\\`;
      txt += `F &= ${F_str} \\\\`;
      txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times \\Gamma \\to ${codomain}`;
    } else {
      txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0) \\\\`;
      txt += `Q &= ${Q_str} \\\\`;
      txt += `\\Sigma &= ${S_str} \\\\`;
      txt += `\\Gamma &= ${G_str} \\\\`;
      txt += `q_0 &= ${q0_str} \\\\`;
      txt += `\\text{Acc} &= \\text{empty stack} \\\\`;
      txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times (\\Gamma \\cup \\{${eps}\\}) \\to ${emptyCodomain}`;
    }
  } else if (m === 'Moore') {
    const D_str = formatSet([...App.outputAlpha]);
    const lambda = '\\lambda';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, ${lambda}, q_0) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\to Q \\\\`;
    txt += `${lambda} &: Q \\to \\Delta`;
  } else if (m === 'Mealy') {
    const D_str = formatSet([...App.outputAlpha]);
    const lambda = '\\lambda';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, ${lambda}, q_0) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `\\delta &: Q \\times \\Sigma \\to Q \\\\`;
    txt += `${lambda} &: Q \\times \\Sigma \\to \\Delta`;
  } else if (m === 'FST') {
    const D_str = formatSet([...App.outputAlpha]);
    const eps = '\\varepsilon';
    txt += `M &= (Q, \\Sigma, \\Delta, \\delta, \\lambda, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Delta &= ${D_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\to \\mathcal{P}(Q) \\\\`;
    txt += `\\lambda &: Q \\times (\\Sigma \\cup \\{${eps}\\}) \\times Q \\to \\Delta^*`;
  } else if (m === 'NDTM') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma \\times \\{L, R, S\\})`;
  } else if (m === 'MTM') {
    const G_str = formatSet([...App.stackAlpha]);
    const k = App.tapeCount || 2;
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma^{${k}} \\to Q \\times \\Gamma^{${k}} \\times \\{L, R, S\\}^{${k}}`;
  } else if (m === 'LBA') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\} \\\\`;
    txt += `\\text{Tape bound} &: |\\text{tape}| \\le |w|`;
  } else if (m === 'ITM') {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\} \\\\`;
    txt += `\\text{Tape index set} &: \\mathbb{Z}`;
  } else {
    const G_str = formatSet([...App.stackAlpha]);
    txt += `M &= (Q, \\Sigma, \\Gamma, \\delta, q_0, F) \\\\`;
    txt += `Q &= ${Q_str} \\\\`;
    txt += `\\Sigma &= ${S_str} \\\\`;
    txt += `\\Gamma &= ${G_str} \\\\`;
    txt += `q_0 &= ${q0_str} \\\\`;
    txt += `F &= ${F_str} \\\\`;
    txt += `\\delta &: Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\}`;
  }
  txt += ` \\end{aligned} $$`;

  App._defBoxLatex = txt;
  const defBox = $('def-box');
  defBox.innerHTML = txt;
  if (typeof triggerMath === 'function') triggerMath(defBox);
  updateDefBoxOverflowShadow();
}

// Same edge-fade hint the workspace tab bar uses, applied to the formal
// definition box so a horizontally-scrollable Σ/Q set doesn't look like a
// hard cutoff.
function updateDefBoxOverflowShadow() {
  const box = $('def-box');
  if (!box) return;
  const maxScroll = Math.max(0, box.scrollWidth - box.clientWidth);
  const hasOverflow = maxScroll > 2;
  box.classList.toggle('has-overflow-left', hasOverflow && box.scrollLeft > 2);
  box.classList.toggle('has-overflow-right', hasOverflow && box.scrollLeft < maxScroll - 2);
}

function initDefBoxOverflowObserver() {
  const box = $('def-box');
  if (!box || box._overflowObsInit) return;
  box._overflowObsInit = true;
  box.addEventListener('scroll', updateDefBoxOverflowShadow);
  if ('ResizeObserver' in window) {
    new ResizeObserver(updateDefBoxOverflowShadow).observe(box);
  }
}

function copyBoxText(id) {
  const text = id === 'def-box'
    ? (App._defBoxLatex || $(id).textContent)
    : (App._regexBoxPlain !== undefined ? App._regexBoxPlain : $(id).textContent);
  const btn = $(id === 'def-box' ? 'def-copy-btn' : 'regex-copy-btn');
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showStatus('Clipboard access unavailable');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showStatus(id === 'def-box' ? 'Copied LaTeX source' : 'Copied regular expression');
    if (btn) {
      btn.classList.add('copied');
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1200);
    }
  }).catch(() => showStatus('Copy failed — clipboard access blocked'));
}

// Plain text, not KaTeX: regex notation (| * ( )) reads fine unstyled, and
// unlike math mode it wraps naturally instead of needing horizontal scroll —
// and it can't misrender symbols that contain LaTeX-special characters.
function updateRegex() {
  const rb = $('regex-box'), m = App.machine;
  let txt = '';
  if (m === '2DFA' || m === '2NFA') { txt = 'Regular Language (Two-Way Head Motion with Endmarkers)'; }
  else if (m === 'QA') { txt = 'Queue Automaton Language Family'; }
  else if (m === 'Counter') { txt = 'Counter Language Family'; }
  else if (m === '2PDA') { txt = 'Two-Stack PDA (TM-Equivalent Power)'; }
  else if (m === 'LBA') { txt = 'Context-Sensitive Language (Endmarked Tape)'; }
  else if (m === 'ITM') { txt = 'Recursively Enumerable Language'; }
  else if (isAnyPDA(m)) { txt = 'Context-Free Language'; }
  else if (isAnyTM(m)) { txt = 'Recursively Enumerable Language'; }
  else if (m === 'Moore') { txt = 'Finite-State Transducer (Moore)'; }
  else if (m === 'Mealy') { txt = 'Finite-State Transducer (Mealy)'; }
  else if (m === 'FST') { txt = 'Finite-State Transducer (Nondeterministic)'; }
  else { txt = deriveRegex() || '∅'; }

  App._regexBoxPlain = txt;
  rb.textContent = txt;
}

function reUnion(a, b) { if (!a) return b; if (!b) return a; if (a === b) return a; return `${a} | ${b}`; }
// The explicit "·" keeps concatenation unambiguous once symbols can be whole
// words instead of single characters (e.g. "citizenFilesComplaint·officerOpensReview"
// instead of the two runs silently glued together).
function reConcat(a, b) {
  if (!a || !b) return a || b || '';
  if (a === App.config.sym.eps) return b;
  if (b === App.config.sym.eps) return a;
  const pa = a.includes(' | '), pb = b.includes(' | ');
  const left = pa ? '(' + a + ')' : a;
  const right = pb ? '(' + b + ')' : b;
  return `${left}·${right}`;
}
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
