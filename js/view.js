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
  if (m === 'DFA' || m === 'NFA') {
    const violations = [];
    const epsTrans = App.transitions.filter(t => t.symbol === 'ε');
    if (epsTrans.length) violations.push(`${epsTrans.length} ε-transition(s)`);
    if (m === 'DFA') {
      const seen = new Set();
      const dups = App.transitions.filter(t => { const k = `${t.from}:${t.symbol}`; if (seen.has(k)) return true; seen.add(k); return false; });
      if (dups.length) violations.push(`${dups.length} duplicate (state, symbol) transition(s)`);
    }
    if (violations.length) {
      const ok = confirm(`Switching to ${m} requires removing:\n• ${violations.join('\n• ')}\n\nRemove violations and switch?`);
      if (!ok) return;
      snapshot();
      App.transitions = App.transitions.filter(t => t.symbol !== 'ε');
      if (m === 'DFA') {
        const seen = new Set();
        App.transitions = App.transitions.filter(t => { const k = `${t.from}:${t.symbol}`; if (seen.has(k)) return false; seen.add(k); return true; });
      }
    }
  }
  App.machine = m;
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.textContent === m));
  $('mach-badge').className = `badge bd-${m.toLowerCase().replace('ε-', 'e')}`;
  $('mach-badge').textContent = m;
  $('stack-sec').style.display = m === 'PDA' ? '' : 'none';
  $('tape-wrap').style.display = m === 'TM' ? '' : 'none';
  updateRPanel(); renderAll();
  showStatus('Machine: ' + m);
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

