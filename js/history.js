// ══════════════════════════════════════════════════════════════════
//  UNDO / REDO
// ══════════════════════════════════════════════════════════════════
function snapshot() {
  const s = JSON.stringify({
    states: App.states, transitions: App.transitions,
    startId: App.startId, accepts: [...App.accepts],
    sigma: [...App.sigma], stackAlpha: [...App.stackAlpha],
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
  App.states = d.states; App.transitions = d.transitions;
  App.startId = d.startId; App.accepts = new Set(d.accepts);
  App.sigma = new Set(d.sigma); App.stackAlpha = new Set(d.stackAlpha);
  App.stateN = d.stateN; App.transN = d.transN;
  renderAll(); updateLPanel(); updateRPanel();
}

