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
  App.stackAlpha = new Set(d.stackAlpha || ['Z']);
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
  if (d.cam) { App.cam = { ...d.cam }; }

  // Update view without confirm bypass
  if (typeof applyMachineSwitch === 'function') {
    applyMachineSwitch(App.machine);
  }
  renderSigma(); renderGamma(); renderOutputAlpha();
  renderAll(); updateSidebar(); updateRPanel();

  if (d.cam) { applyCamera(); }
  else { setTimeout(() => fitToScreen(), 50); }

  if (!isExample) snapshot();
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
        showStatus(`Example: ${m} loaded`);
        snapshot();
      })
      .catch(err => {
        console.error(err);
        showStatus('Failed to load example');
      });
  };

  if (App.states.length > 0) {
    $('confirm-title').textContent = 'Load Example?';
    $('confirm-msg').textContent = `Loading the ${m} example will clear your current workspace. Continue?`;
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


