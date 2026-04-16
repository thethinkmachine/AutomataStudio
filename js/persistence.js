// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
function getWorkspaceData() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  
  // Explicitly allow-list only FSM model configuration, dropping all UI/Theme data.
  const cleanConfig = {
    transducerAccepts: App.config.transducerAccepts,
    maxPdaSteps: App.config.maxPdaSteps,
    maxTmSteps: App.config.maxTmSteps,
    pdaParadigm: App.config.pdaParadigm,
    sym: { ...App.config.sym },
    statePrefix: App.config.statePrefix
    // Note: gridSnap, layout, zoom, and radius are intentionally dropped as they are editor-specific
  };

  return {
    machine: App.machine,
    config: cleanConfig,
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    states: App.states,
    transitions: App.transitions,
    startId: App.startId,
    accepts: [...App.accepts],
    grammar: grammarData,
    cam: App.cam
  };
}

function saveJSON() {
  const data = getWorkspaceData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'automaton.json'; a.click();
  showStatus('Saved as JSON!');
}

function loadJSON() { $('file-input').click(); }

function handleFiles(files) {
  const f = files[0]; if (!f) return;
  const isPng = f.name.toLowerCase().endsWith('.png');
  const reader = new FileReader();

  reader.onload = ev => {
    try {
      let data;
      if (isPng) {
        const text = new TextDecoder().decode(ev.target.result);
        const marker = "\n--AutomataData--\n";
        const parts = text.split(marker);
        if (parts.length < 2) {
          showStatus('Error: No workspace data found in this PNG');
          return;
        }
        data = JSON.parse(parts[1]);
      } else {
        data = JSON.parse(ev.target.result);
      }
      validateSchema(data);
      loadData(data);
      showStatus('Workspace loaded!');
    } catch (err) {
      console.error(err);
      const isCustomErr = err.message && !err.message.includes('JSON');
      showStatus(isCustomErr ? `Validation Error: ${err.message}` : (isPng ? 'Could not extract workspace data' : 'Invalid JSON file'));
    }
  };

  if (isPng) reader.readAsArrayBuffer(f);
  else reader.readAsText(f);
}

function onFileLoad(e) {
  handleFiles(e.target.files);
  e.target.value = '';
}

// Drag & Drop
window.addEventListener('dragover', e => {
  e.preventDefault();
  const b = $('status-bar');
  b.textContent = 'Drop to load';
  b.classList.add('show');
  clearTimeout(b._t);
});
window.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) $('status-bar').classList.remove('show');
});
window.addEventListener('drop', e => {
  e.preventDefault();
  handleFiles(e.dataTransfer.files);
});

function validateSchema(data) {
  if (!data || typeof data !== 'object') throw new Error("Data must be a valid JSON object.");
  
  const validMachines = ['DFA', 'NFA', 'ε-NFA', 'PDA', 'TM', 'MTM', 'Moore', 'Mealy'];
  if (!data.machine || !validMachines.includes(data.machine)) {
    throw new Error(`Missing or unsupported machine type: ${data.machine || 'undefined'}`);
  }

  // Core properties MUST be present, no partial loading
  if (!Array.isArray(data.sigma)) throw new Error("Missing required 'sigma' array.");
  if (!Array.isArray(data.states)) throw new Error("Missing required 'states' array.");
  if (!Array.isArray(data.transitions)) throw new Error("Missing required 'transitions' array.");
  if (!Array.isArray(data.accepts)) throw new Error("Missing required 'accepts' array.");

  // Conditional requirements based on machine type
  if (data.machine === 'PDA' && !Array.isArray(data.stackAlpha)) {
    throw new Error("PDA requires a 'stackAlpha' array.");
  }
  if ((data.machine === 'Moore' || data.machine === 'Mealy') && !Array.isArray(data.outputAlpha)) {
    throw new Error("Transducers require an 'outputAlpha' array.");
  }
  if ((data.machine === 'TM' || data.machine === 'MTM') && typeof data.tapeCount !== 'number') {
    throw new Error("Turing Machines require a numeric 'tapeCount'.");
  }

  // Validate States deeply
  for (const s of data.states) {
    if (typeof s !== 'object' || s === null || typeof s.id === 'undefined') {
      throw new Error("Each state must be an object containing an 'id' property.");
    }
  }

  // Validate Transitions deeply
  for (const t of data.transitions) {
    if (typeof t !== 'object' || t === null || typeof t.id === 'undefined' || typeof t.from === 'undefined' || typeof t.to === 'undefined') {
      throw new Error("Each transition must be an object with 'id', 'from', and 'to' properties.");
    }
  }

  // Validate Grammar
  if (data.grammar) {
    if (typeof data.grammar !== 'object') throw new Error("'grammar' must be an object.");
    if (data.grammar.vars && !Array.isArray(data.grammar.vars)) throw new Error("'grammar.vars' must be an array.");
    if (data.grammar.productions && !Array.isArray(data.grammar.productions)) throw new Error("'grammar.productions' must be an array.");
  }
  
  return true;
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
  if (d.config) {
    // Drop any legacy theme or presentation properties that might be in old files
    const { theme, export: exp, exportRes, pdaParadigm, ...loadedConfig } = d.config;
    App.config = { ...App.config, ...loadedConfig, pdaParadigm: pdaParadigm || 'explicit' };
  }
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

