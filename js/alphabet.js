// ══════════════════════════════════════════════════════════════════
//  ALPHABET
// ══════════════════════════════════════════════════════════════════
function addSym() {
  const v = $('sym-in').value.trim(); if (!v) return;
  v.split(/[,\s]+/).forEach(s => { if (s) App.sigma.add(s); });
  $('sym-in').value = ''; renderSigma(); updateRPanel(); renderGramSyms();
}
function delSym(s) { App.sigma.delete(s); renderSigma(); renderGramSyms(); }
function renderSigma() {
  const c = $('sigma-chips');
  c.innerHTML = [...App.sigma].map(s => `<div class="chip">${s}<span class="x" onclick="delSym('${s}')">×</span></div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
}
function addGSym() {
  const v = $('gsym-in').value.trim(); if (!v) return;
  App.stackAlpha.add(v); $('gsym-in').value = ''; renderGamma();
}
function delGSym(s) { App.stackAlpha.delete(s); renderGamma(); }
function renderGamma() {
  const c = $('gamma-chips');
  c.innerHTML = [...App.stackAlpha].map(s => `<div class="chip">${s}<span class="x" onclick="delGSym('${s}')">×</span></div>`).join('');
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
}

