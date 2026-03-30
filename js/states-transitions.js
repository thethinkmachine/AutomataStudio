// ══════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════
function newId() { return 's' + (++App.stateN); }
function newTId() { return 't' + (++App.transN); }

function createState(x, y, name) {
  snapshot();
  const id = newId();
  const s = { id, x, y, name: name || `${App.config.statePrefix}${App.stateN - 1}` };
  App.states.push(s);
  if (!App.startId) App.startId = id;
  renderAll(); updateLPanel(); updateRPanel();
  return s;
}
function deleteState(id) {
  snapshot();
  App.states = App.states.filter(s => s.id !== id);
  App.transitions = App.transitions.filter(t => t.from !== id && t.to !== id);
  App.accepts.delete(id);
  if (App.startId === id) App.startId = App.states[0]?.id || null;
  renderAll(); updateLPanel(); updateRPanel();
}
function getState(id) { return App.states.find(s => s.id === id); }

// ══════════════════════════════════════════════════════════════════
//  TRANSITIONS
// ══════════════════════════════════════════════════════════════════
function openTransModal(from, to) {
  App._pendFrom = from; App._pendTo = to;
  const cfg = getMachineConfig(App.machine);
  const { eps, any, blank } = App.config.sym;

  const fs = $('m-from'), ts = $('m-to'), ss = $('m-sym');
  fs.innerHTML = App.states.map(s => `<option value="${s.id}" ${s.id === from ? 'selected' : ''}>${s.name}</option>`).join('');
  ts.innerHTML = App.states.map(s => `<option value="${s.id}" ${s.id === to ? 'selected' : ''}>${s.name}</option>`).join('');

  const syms = [...(cfg.hasEpsilon ? [eps] : []), any, ...App.sigma, ...(cfg.hasTape ? [blank] : [])];
  ss.innerHTML = syms.map(s => `<option value="${s}">${s}</option>`).join('');

  $('m-sym-row').style.display = App.machine === 'MTM' ? 'none' : '';
  $('m-pda-extra').style.display = cfg.hasStack ? '' : 'none';
  $('m-tm-extra').style.display = (App.machine === 'TM') ? '' : 'none';
  $('m-mealy-extra').style.display = (App.machine === 'Mealy') ? '' : 'none';

  const mtmExtra = $('m-mtm-extra');
  mtmExtra.style.display = App.machine === 'MTM' ? '' : 'none';

  // Populate TM/MTM directions
  const dirOpts = App.directions.map(d => `<option value="${d.value}">${d.label} (${d.value})</option>`).join('');
  if (App.machine === 'TM') {
    const dsel = $('m-dir');
    if (dsel) dsel.innerHTML = dirOpts;
  }

  if (App.machine === 'MTM') {
    const k = App.tapeCount;
    const symOpts = syms.map(s => `<option value="${s}">${s}</option>`).join('');
    mtmExtra.innerHTML = Array.from({ length: k }, (_, i) => `
      <div class="modal-section-lbl">Tape ${i + 1}</div>
      <div class="modal-row"><span class="modal-lbl">Read</span><select class="sel" id="m-mtm-read-${i}">${symOpts}</select></div>
      <div class="modal-row"><span class="modal-lbl">Write</span><input class="inp" id="m-mtm-write-${i}" placeholder="symbol"></div>
      <div class="modal-row"><span class="modal-lbl">Move</span><select class="sel" id="m-mtm-dir-${i}">${dirOpts}</select></div>
    `).join('');
  }
  showOverlay('trans-modal');
}
function confirmTrans() {
  const cfg = getMachineConfig(App.machine);
  const { eps } = App.config.sym;
  const from = $('m-from').value, to = $('m-to').value, sym = App.machine === 'MTM' ? null : $('m-sym').value;

  if (!cfg.hasEpsilon && sym === eps) {
    showStatus(`${App.machine} cannot have epsilon-transitions.`); return;
  }
  if (!cfg.isTransducer && App.machine !== 'NFA' && App.machine !== 'ε-NFA' && App.machine !== 'PDA' && !cfg.hasTape) {
    const conflict = App.transitions.find(t => t.from === from && t.symbol === sym);
    if (conflict) {
      showStatus(`${App.machine} already has δ(${getState(from)?.name}, '${sym}'). Each (state, symbol) pair must be unique.`); return;
    }
  }
  snapshot();
  const t = { id: newTId(), from, to, symbol: sym };
  if (App.machine === 'PDA') {
    t.pop = $('m-pop').value || eps;
    t.push = $('m-push').value || eps;
  }
  if (App.machine === 'TM') { t.write = $('m-write').value || t.symbol; t.dir = $('m-dir').value; }
  if (App.machine === 'Mealy') { t.output = $('m-output').value || ''; }
  if (App.machine === 'MTM') {
    const k = App.tapeCount;
    const blank = App.config.sym.blank;
    t.tapeSyms = Array.from({ length: k }, (_, i) => $(`m-mtm-read-${i}`)?.value || blank);
    t.tapeWrites = Array.from({ length: k }, (_, i) => $(`m-mtm-write-${i}`)?.value || blank);
    t.tapeDirs = Array.from({ length: k }, (_, i) => $(`m-mtm-dir-${i}`)?.value || App.directions[0].value);
    t.symbol = t.tapeSyms[0];
  }
  App.transitions.push(t);
  closeModal('trans-modal');
  App.transFrom = null; clearTempLine();
  renderAll(); updateLPanel(); updateRPanel();
}
function deleteTrans(id) {
  snapshot();
  App.transitions = App.transitions.filter(t => t.id !== id);
  renderAll(); updateLPanel(); updateRPanel();
}
function transLabel(t) {
  if (App.machine === 'PDA') return `${t.symbol},${t.pop}/${t.push}`;
  if (App.machine === 'TM') return `${t.symbol}/${t.write},${t.dir}`;
  if (App.machine === 'Mealy') return `${t.symbol}/${t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda}`;
  if (App.machine === 'MTM') {
    const syms = t.tapeSyms || [t.symbol];
    const writes = t.tapeWrites || [t.write || t.symbol];
    const defDir = App.directions[0].value;
    const dirs = t.tapeDirs || [t.dir || defDir];
    return syms.map((s, i) => `${s}/${writes[i] ?? s},${dirs[i] ?? defDir}`).join(' ');
  }
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
  const cfg = getMachineConfig(App.machine);
  if (cfg.isTransducer && !App.config.transducerAccepts) {
    $('s-acc').parentElement.style.display = 'none';
  } else {
    $('s-acc').parentElement.style.display = '';
  }
  $('s-acc').checked = App.accepts.has(id);
  const mooreExtra = $('s-moore-extra');
  mooreExtra.style.display = App.machine === 'Moore' ? '' : 'none';
  if (App.machine === 'Moore') $('s-output').value = s.output || '';
  showOverlay('state-modal');
}
function confirmState() {
  const s = getState(App.editId); if (!s) return closeModal('state-modal');
  snapshot();
  s.name = $('s-name').value.trim() || s.name;
  if ($('s-start').checked) App.startId = s.id;
  if ($('s-acc').checked) App.accepts.add(s.id); else App.accepts.delete(s.id);
  if (App.machine === 'Moore') s.output = $('s-output').value.trim();
  closeModal('state-modal'); renderAll(); updateLPanel(); updateRPanel();
}
function ctxStart() { if (App.ctxId) { App.startId = App.ctxId; snapshot(); renderAll(); updateLPanel(); updateRPanel(); } }
function ctxToggleAcc() { 
  if (!App.ctxId) return; 
  const cfg = getMachineConfig(App.machine);
  if (cfg.isTransducer && !App.config.transducerAccepts) return;
  App.accepts.has(App.ctxId) ? App.accepts.delete(App.ctxId) : App.accepts.add(App.ctxId); 
  snapshot(); renderAll(); updateLPanel(); updateRPanel(); 
}
function ctxRename() { if (App.ctxId) openStateModal(App.ctxId); }
function ctxDel() { if (App.ctxId) deleteState(App.ctxId); }

function showOverlay(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); App._pendFrom = null; App._pendTo = null; App.transFrom = null; clearTempLine(); }

