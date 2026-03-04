// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
function saveJSON() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  const data = { machine: App.machine, config: App.config, sigma: [...App.sigma], stackAlpha: [...App.stackAlpha], outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount, states: App.states, transitions: App.transitions, startId: App.startId, accepts: [...App.accepts], grammar: grammarData, cam: App.cam };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'automaton.json'; a.click();
  showStatus('Saved!');
}
function loadJSON() { $('file-input').click(); }
function onFileLoad(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      loadData(d);
      showStatus('Loaded!');
    } catch (err) { showStatus('Invalid JSON file'); }
  };
  r.readAsText(f); e.target.value = '';
}

function loadData(d, isExample) {
  App.machine = d.machine || 'DFA'; App.sigma = new Set(d.sigma || []);
  App.stackAlpha = new Set(d.stackAlpha || [App.config.sym.stackBottom]);
  App.outputAlpha = new Set(d.outputAlpha || []);
  if (d.tapeCount) App.tapeCount = d.tapeCount;
  App.states = d.states || [];
  App.transitions = d.transitions || []; App.startId = d.startId || null;
  App.accepts = new Set(d.accepts || []);
  resetIds();
  if (d.grammar) {
    App.grammar.vars = new Set(d.grammar.vars || []);
    App.grammar.start = d.grammar.start || '';
    App.grammar.productions = d.grammar.productions || [];
  }
  if (d.config) { App.config = { ...App.config, ...d.config }; }
  else { migrateLegacySymbols(d); }
  if (d.cam) { App.cam = { ...d.cam }; }

  // Update view without confirm bypass
  if (typeof applyMachineSwitch === 'function') {
    applyMachineSwitch(App.machine);
  }
  renderSigma(); renderGamma(); renderOutputAlpha();
  renderAll(); updateLPanel(); updateRPanel();

  if (d.cam) { applyCamera(); }
  else { setTimeout(() => fitToScreen(), 50); }

  if (!isExample) snapshot();
}

function migrateLegacySymbols(d) {
  const LEGACY_EPS = 'ε', LEGACY_BLANK = '⊔', LEGACY_Z0 = 'Z';
  const newE = App.config.sym.eps, newB = App.config.sym.blank, newZ = App.config.sym.stackBottom;
  const mapSym = s => (s === LEGACY_EPS ? newE : s === LEGACY_BLANK ? newB : s === LEGACY_Z0 ? newZ : s);

  if (d.sigma) d.sigma = d.sigma.map(mapSym);
  if (d.stackAlpha) d.stackAlpha = d.stackAlpha.map(mapSym);
  if (d.outputAlpha) d.outputAlpha = d.outputAlpha.map(mapSym);
  if (d.transitions) {
    d.transitions.forEach(t => {
      if (t.symbol !== undefined) t.symbol = mapSym(t.symbol);
      if (t.write !== undefined) t.write = mapSym(t.write);
      if (t.pop !== undefined) t.pop = mapSym(t.pop);
      if (t.push !== undefined) t.push = mapSym(t.push);
      if (t.tapeSyms) t.tapeSyms = t.tapeSyms.map(mapSym);
      if (t.tapeWrites) t.tapeWrites = t.tapeWrites.map(mapSym);
    });
  }
  if (d.grammar && d.grammar.productions) {
    d.grammar.productions.forEach(p => {
      p.rhs = p.rhs.split('').map(mapSym).join('');
    });
  }
}


// Auto Backup/Restore via LocalStorage
function saveBackup() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  const data = { machine: App.machine, config: App.config, sigma: [...App.sigma], stackAlpha: [...App.stackAlpha], outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount, states: App.states, transitions: App.transitions, startId: App.startId, accepts: [...App.accepts], grammar: grammarData, cam: App.cam };
  try { localStorage.setItem('automata-backup', JSON.stringify(data)); } catch (e) { }
}
function loadBackup() {
  try {
    const raw = localStorage.getItem('automata-backup');
    if (!raw) return;
    loadData(JSON.parse(raw));
  } catch (e) { }
}

window.addEventListener('beforeunload', saveBackup);


// ══════════════════════════════════════════════════════════════════
//  LOAD EXAMPLE
// ══════════════════════════════════════════════════════════════════
function loadExample() {
  const cfg = getMachineConfig(App.machine);
  const file = cfg.file;
  if (!file) return;

  const executeLoad = () => {
    fetch(`js/examples/${file}.json`)
      .then(res => res.json())
      .then(data => {
        performClear();
        loadData(data, true);
        showStatus(`Example: ${App.machine} loaded`);
        snapshot();
      })
      .catch(err => {
        console.error(err);
        showStatus('Failed to load example');
      });
  };

  if (App.states.length > 0) {
    $('confirm-title').textContent = 'Load Example?';
    $('confirm-msg').textContent = `Loading the ${App.machine} example will clear your current workspace. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      executeLoad();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
  } else {
    executeLoad();
  }
}


