// ══════════════════════════════════════════════════════════════════
//  UNDO / REDO
// ══════════════════════════════════════════════════════════════════
function snapshot() {
  const s = JSON.stringify({
    machine: App.machine,
    states: App.states, transitions: App.transitions,
    startId: App.startId, accepts: [...App.accepts],
    sigma: [...App.sigma], stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount,
    stateN: App.stateN, transN: App.transN
  });
  App.history.push(s);
  App.future = [];
  if (App.history.length > 300) App.history.shift();
}
function undo() {
  if (App.history.length < 2) return showStatus('Nothing to undo');
  App.future.push(App.history.pop());
  restoreSnapshot(App.history[App.history.length - 1]);
}
function redo() {
  if (!App.future.length) return showStatus('Nothing to redo');
  const s = App.future.pop();
  App.history.push(s);
  restoreSnapshot(s);
}
function restoreSnapshot(s) {
  const d = JSON.parse(s);
  
  // If machine type changed during undo/redo, safely apply the machine switch internals
  if (d.machine && d.machine !== App.machine) {
    const cfg = getMachineConfig(d.machine);
    App.machine = d.machine;
    if (typeof syncMachineSelectors === 'function') syncMachineSelectors(d.machine);
    const badge = document.getElementById('mach-badge');
    if (badge) { badge.className = `badge ${cfg.badge}`; badge.textContent = cfg.label; }
    const stSec = document.getElementById('stack-sec');
    if (stSec) stSec.style.display = cfg.hasStack ? '' : 'none';
    const stackLbl = stSec?.querySelector('.sec-lbl');
    if (stackLbl) stackLbl.textContent = isAnyTM(d.machine) ? 'Tape Alphabet Γ' : 'Stack Alphabet Γ';
    const outSec = document.getElementById('output-sec');
    if (outSec) outSec.style.display = cfg.isTransducer ? '' : 'none';
    const mtmSec = document.getElementById('mtm-ctrl');
    if (mtmSec) mtmSec.style.display = (d.machine === 'MTM') ? 'flex' : 'none';
  }
  
  if (d.tapeCount !== undefined) {
    App.tapeCount = d.tapeCount;
    const tcSel = document.getElementById('tape-count-sel');
    if (tcSel) tcSel.value = App.tapeCount;
  }
  
  App.states = d.states; App.transitions = d.transitions;
  App.startId = d.startId; App.accepts = new Set(d.accepts || []);
  App.sigma = new Set(d.sigma || []); App.stackAlpha = new Set(d.stackAlpha || [App.config.sym.stackBottom]);
  App.outputAlpha = new Set(d.outputAlpha || ['0', '1']);
  App.stateN = d.stateN; App.transN = d.transN;

  renderSigma(); renderGamma(); renderOutputAlpha();
  renderAll(); updateLPanel(); updateRPanel();
}

