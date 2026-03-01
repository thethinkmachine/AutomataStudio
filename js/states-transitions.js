// ══════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════
function newId() { return 's' + (++App.stateN); }
function newTId() { return 't' + (++App.transN); }

function createState(x, y, name) {
  snapshot();
  const id = newId();
  const s = { id, x, y, name: name || `q${App.stateN - 1}` };
  App.states.push(s);
  if (!App.startId) App.startId = id;
  renderAll(); updateSidebar(); updateRPanel();
  return s;
}
function deleteState(id) {
  snapshot();
  App.states = App.states.filter(s => s.id !== id);
  App.transitions = App.transitions.filter(t => t.from !== id && t.to !== id);
  App.accepts.delete(id);
  if (App.startId === id) App.startId = App.states[0]?.id || null;
  renderAll(); updateSidebar(); updateRPanel();
}
function getState(id) { return App.states.find(s => s.id === id); }

// ══════════════════════════════════════════════════════════════════
//  TRANSITIONS
// ══════════════════════════════════════════════════════════════════
function openTransModal(from, to) {
  App._pendFrom = from; App._pendTo = to;
  const fs = $('m-from'), ts = $('m-to'), ss = $('m-sym');
  fs.innerHTML = App.states.map(s => `<option value="${s.id}" ${s.id === from ? 'selected' : ''}>${s.name}</option>`).join('');
  ts.innerHTML = App.states.map(s => `<option value="${s.id}" ${s.id === to ? 'selected' : ''}>${s.name}</option>`).join('');
  const epsilonAllowed = App.machine !== 'DFA' && App.machine !== 'NFA';
  const syms = [...(epsilonAllowed ? ['ε'] : []), 'Σ', ...App.sigma, ...(App.machine === 'TM' ? ['⊔'] : [])];
  ss.innerHTML = syms.map(s => `<option value="${s}">${s}</option>`).join('');
  $('m-pda-extra').style.display = App.machine === 'PDA' ? '' : 'none';
  $('m-tm-extra').style.display = App.machine === 'TM' ? '' : 'none';
  showOverlay('trans-modal');
}
function confirmTrans() {
  const from = $('m-from').value, to = $('m-to').value, sym = $('m-sym').value;
  if ((App.machine === 'DFA' || App.machine === 'NFA') && sym === 'ε') {
    showStatus(`${App.machine} cannot have ε-transitions.`); return;
  }
  if (App.machine === 'DFA') {
    const conflict = App.transitions.find(t => t.from === from && t.symbol === sym);
    if (conflict) {
      showStatus(`DFA already has δ(${getState(from)?.name}, '${sym}'). Each (state, symbol) pair must be unique.`); return;
    }
  }
  snapshot();
  const t = { id: newTId(), from, to, symbol: sym };
  if (App.machine === 'PDA') { t.pop = $('m-pop').value || 'ε'; t.push = $('m-push').value || 'ε'; }
  if (App.machine === 'TM') { t.write = $('m-write').value || t.symbol; t.dir = $('m-dir').value; }
  App.transitions.push(t);
  closeModal('trans-modal');
  App.transFrom = null; clearTempLine();
  renderAll(); updateSidebar(); updateRPanel();
}
function deleteTrans(id) {
  snapshot();
  App.transitions = App.transitions.filter(t => t.id !== id);
  renderAll(); updateSidebar(); updateRPanel();
}
function transLabel(t) {
  if (App.machine === 'PDA') return `${t.symbol},${t.pop}/${t.push}`;
  if (App.machine === 'TM') return `${t.symbol}/${t.write},${t.dir}`;
  return t.symbol;
}


// ══════════════════════════════════════════════════════════════════
//  STATE MODAL / CTX
// ══════════════════════════════════════════════════════════════════
function openStateModal(id) {
  App.editId = id;
  const s = getState(id); if (!s) return;
  $('s-name').value = s.name;
  $('s-start').checked = App.startId === id;
  $('s-acc').checked = App.accepts.has(id);
  showOverlay('state-modal');
}
function confirmState() {
  const s = getState(App.editId); if (!s) return closeModal('state-modal');
  snapshot();
  s.name = $('s-name').value.trim() || s.name;
  if ($('s-start').checked) App.startId = s.id;
  if ($('s-acc').checked) App.accepts.add(s.id); else App.accepts.delete(s.id);
  closeModal('state-modal'); renderAll(); updateSidebar(); updateRPanel();
}
function ctxStart() { if (App.ctxId) { App.startId = App.ctxId; snapshot(); renderAll(); updateSidebar(); updateRPanel(); } }
function ctxToggleAcc() { if (!App.ctxId) return; App.accepts.has(App.ctxId) ? App.accepts.delete(App.ctxId) : App.accepts.add(App.ctxId); snapshot(); renderAll(); updateSidebar(); updateRPanel(); }
function ctxRename() { if (App.ctxId) openStateModal(App.ctxId); }
function ctxDel() { if (App.ctxId) deleteState(App.ctxId); }

function showOverlay(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); App._pendFrom = null; App._pendTo = null; App.transFrom = null; clearTempLine(); }

