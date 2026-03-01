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
  const hideSidebar = v === 'grammar' || v === 'theory';
  $('sidebar').classList.toggle('hidden', hideSidebar);
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
  if (v === 'grammar') { renderGrammarSidebar(); renderGrammarView(); renderGramSyms(); }
  if (v === 'theory') { renderTheoryView(); }
  updateSidebar();
}

// ══════════════════════════════════════════════════════════════════
//  MACHINE TYPE
// ══════════════════════════════════════════════════════════════════
function setMachine(m) {
  if (m !== App.machine && App.states.length > 0) {
    if (!confirm(`Switch to ${m}? The current canvas will be cleared.`)) return;
    clearAll(true);
  }
  App.machine = m;
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.textContent === m));
  $('mach-badge').className = `badge bd-${m.toLowerCase().replace('ε-', 'e')}`;
  $('mach-badge').textContent = m;
  $('stack-sec').style.display = m === 'PDA' ? '' : 'none';
  $('output-sec').style.display = (m === 'Moore' || m === 'Mealy') ? '' : 'none';
  $('tape-wrap').style.display = m === 'TM' ? '' : 'none';
  $('mtm-ctrl').style.display = m === 'MTM' ? 'flex' : 'none';
  $('mtm-tapes').style.display = m === 'MTM' ? '' : 'none';
  updateRPanel(); renderAll();
  showStatus('Machine: ' + m);
}

function setTapeCount(n) {
  const newCount = Math.max(2, Math.min(4, parseInt(n) || 2));
  if (newCount === App.tapeCount) return;
  if (App.transitions.length > 0) {
    if (!confirm(`Changing tape count from ${App.tapeCount} to ${newCount} requires clearing all existing transitions. Continue?`)) {
      $('tape-count-sel').value = App.tapeCount;
      return;
    }
    snapshot();
    App.transitions = [];
    renderAll(); updateSidebar(); updateRPanel();
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

