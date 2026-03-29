// ══════════════════════════════════════════════════════════════════
//  VIEW MANAGEMENT
// ══════════════════════════════════════════════════════════════════
function setView(v) {
  App.view = v;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  ['build', 'algo', 'grammar', 'theory'].forEach(id => {
    const el = $('v-' + id);
    if (el) el.style.display = (id === v) ? 'flex' : 'none';
  });
  const hideLPanel = v === 'grammar' || v === 'theory';
  $('lpanel').classList.toggle('hidden', hideLPanel);
  // Sub-toolbar only on build/algo views
  const stb = $('sub-toolbar');
  if (stb) stb.style.display = (v === 'build' || v === 'algo') ? 'flex' : 'none';
  // Canvas toolbox only on build view
  const tb = $('canvas-toolbox');
  if (tb) tb.style.display = (v === 'build') ? 'flex' : 'none';
  // Minimap only on build view
  const mm = $('minimap-container');
  if (mm) mm.style.visibility = (v === 'build') ? '' : 'hidden';
  const mmsb = $('minimap-show-btn');
  if (mmsb) mmsb.style.visibility = (v === 'build') ? '' : 'hidden';
  if (v === 'algo') { renderAlgo(App.currentAlgo); }
  if (v === 'grammar') { renderGrammarLPanel(); renderGrammarView(); renderGramSyms(); }
  if (v === 'theory') { renderTheoryView(); }
  updateLPanel();
}

// ══════════════════════════════════════════════════════════════════
//  MACHINE TYPE
// ══════════════════════════════════════════════════════════════════
function setMachine(m) {
  if (m === App.machine) {
    syncMachineSelectors(m);
    return;
  }
  if (App.states.length > 0) {
    syncMachineSelectors(App.machine);
    $('confirm-title').textContent = 'Switch Machine Type?';
    $('confirm-msg').textContent = `Switching to ${m} will delete your current machine work. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      clearAll(true);
      applyMachineSwitch(m);
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  applyMachineSwitch(m);
}

function syncMachineSelectors(m) {
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.textContent === m));
  const mobileSelect = $('mobile-machine-select');
  if (mobileSelect) mobileSelect.value = m;
}

function applyMachineSwitch(m) {
  const cfg = getMachineConfig(m);
  App.machine = m;

  // Update UI Tabs and Badges
  syncMachineSelectors(m);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;

  // Toggle UI Sections based on Machine Features
  $('stack-sec').style.display = cfg.hasStack ? '' : 'none';
  $('output-sec').style.display = cfg.isTransducer ? '' : 'none';
  $('tape-wrap').style.display = (m === 'TM') ? '' : 'none';
  $('mtm-ctrl').style.display = (m === 'MTM') ? 'flex' : 'none';
  $('mtm-tapes').style.display = (m === 'MTM') ? '' : 'none';

  updateRPanel();
  renderAll();
  showStatus('Machine: ' + m);
}

function setTapeCount(n) {
  const newCount = Math.max(2, Math.min(4, parseInt(n) || 2));
  if (newCount === App.tapeCount) return;
  if (App.transitions.length > 0) {
    $('confirm-title').textContent = 'Change Tape Count?';
    $('confirm-msg').textContent = `Changing to ${newCount} tapes will clear all existing multi-tape transitions. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      snapshot();
      App.transitions = [];
      App.tapeCount = newCount;
      $('tape-count-sel').value = App.tapeCount;
      resetSim();
      renderAll(); updateLPanel(); updateRPanel();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  App.tapeCount = newCount;
  $('tape-count-sel').value = App.tapeCount;
  resetSim();
}

// ══════════════════════════════════════════════════════════════════
//  TOOLS
// ══════════════════════════════════════════════════════════════════
function setTool(t) {
  App.tool = t; App.transFrom = null; clearTempLine();
  document.querySelectorAll('.toolbox-btn[id^="t-"]').forEach(b => b.classList.remove('active'));
  const el = $('t-' + t);
  if (el) el.classList.add('active');
  const curs = { pointer: 'default', move: 'grab', state: 'crosshair', trans: 'crosshair', del: 'not-allowed' };
  $('canvas-wrap').style.cursor = curs[t] || 'default';
  const msgs = { pointer: 'Click or drag states to interact', move: 'Drag canvas to pan · Drag state to move', state: 'Click canvas to place state', trans: 'Click source then target state', del: 'Click state to delete' };
  showStatus(msgs[t]);
}
