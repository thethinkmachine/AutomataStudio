// ══════════════════════════════════════════════════════════════════
//  ALPHABET
// ══════════════════════════════════════════════════════════════════
function addSym() {
  const v = $('sym-in').value.trim(); if (!v) return;
    const blocked = [];
    v.split(/[,\s]+/).forEach(s => {
      if (!s) return;
      if (isBoundarySymbol(s)) { blocked.push(s); return; }
      App.sigma.add(s);
    });
  $('sym-in').value = ''; renderSigma(); updateRPanel(); renderGramSyms();
    if (blocked.length && typeof showStatus === 'function') showStatus('Boundary markers are reserved and cannot be added to Σ.');
}
  function delSym(s) { 
    App.sigma.delete(s); 
    renderSigma(); 
    renderGramSyms(); 
  }
function renderSigma() {
  const c = $('sigma-chips');
  c.innerHTML = [...App.sigma].map(s => `<div class="chip">${s}<span class="x" onclick="delSym('${s}')">×</span></div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}
function addGSym() {
  const v = $('gsym-in').value.trim(); if (!v) return;
    const blocked = [];
    v.split(/[,\s]+/).forEach(s => {
      if (!s) return;
      if (isBoundarySymbol(s)) { blocked.push(s); return; }
      App.stackAlpha.add(s);
    });
  $('gsym-in').value = ''; renderGamma();
    if (blocked.length && typeof showStatus === 'function') showStatus('Boundary markers are reserved for the tape boundary and were not added here.');
}
  function delGSym(s) { 
    if (isBoundaryTapeMachine(App.machine) && isBoundarySymbol(s)) return; 
    App.stackAlpha.delete(s); 
    renderGamma(); 
  }
function renderGamma() {
  const c = $('gamma-chips');
    c.innerHTML = [...App.stackAlpha].map(s => {
      const isBottom = s === App.config.sym.stackBottom;
      const isBoundary = isBoundaryTapeMachine(App.machine) && isBoundarySymbol(s);
      const style = isBottom ? 'style="color:var(--green)"' : (isBoundary ? 'style="color:var(--gold)"' : '');
      const title = isBoundary ? ` title="${s === App.config.sym.leftMarker ? 'Left boundary marker' : 'Right boundary marker'}"` : '';
      return `<div class="chip" ${style}${title}>${s}${(isBottom || isBoundary) ? '' : `<span class="x" onclick="delGSym('${s}')">×</span>`}</div>`;
    }).join('') || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}
function addOutSym() {
  const v = $('outsym-in').value.trim(); if (!v) return;
  v.split(/[,\s]+/).forEach(s => { if (s) App.outputAlpha.add(s); });
  $('outsym-in').value = ''; renderOutputAlpha();
}
function delOutSym(s) { App.outputAlpha.delete(s); renderOutputAlpha(); }
function renderOutputAlpha() {
  const c = $('output-chips');
  c.innerHTML = [...App.outputAlpha].map(s => `<div class="chip">${s}<span class="x" onclick="delOutSym('${s}')">×</span></div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}

