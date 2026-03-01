// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
function saveJSON() {
  const data = { machine: App.machine, sigma: [...App.sigma], stackAlpha: [...App.stackAlpha], states: App.states, transitions: App.transitions, startId: App.startId, accepts: [...App.accepts], grammar: App.grammar };
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
      App.machine = d.machine || 'DFA'; App.sigma = new Set(d.sigma || []);
      App.stackAlpha = new Set(d.stackAlpha || ['Z']); App.states = d.states || [];
      App.transitions = d.transitions || []; App.startId = d.startId || null;
      App.accepts = new Set(d.accepts || []);
      App.stateN = Math.max(0, ...App.states.map(s => parseInt(s.id.slice(1)) || 0));
      App.transN = Math.max(0, ...App.transitions.map(t => parseInt(t.id.slice(1)) || 0));
      if (d.grammar) App.grammar = d.grammar;
      setMachine(App.machine); renderSigma(); renderGamma();
      renderAll(); updateSidebar(); updateRPanel(); showStatus('Loaded!');
      snapshot();
    } catch (err) { showStatus('Invalid JSON file'); }
  };
  r.readAsText(f); e.target.value = '';
}


// ══════════════════════════════════════════════════════════════════
//  LOAD EXAMPLE
// ══════════════════════════════════════════════════════════════════
function loadExample() {
  clearAll(true);
  const m = App.machine;
  if (m === 'DFA') {
    // DFA: ends in 'b'
    App.sigma = new Set(['a', 'b']); renderSigma();
    const q0 = createState(180, 200, 'q0'); const q1 = createState(380, 200, 'q1');
    App.startId = q0.id; App.accepts.add(q1.id);
    [{ f: q0.id, t: q0.id, s: 'a' }, { f: q0.id, t: q1.id, s: 'b' }, { f: q1.id, t: q0.id, s: 'a' }, { f: q1.id, t: q1.id, s: 'b' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 4; showStatus('Example: DFA accepting strings ending in b');
  } else if (m === 'ε-NFA') {
    // ε-NFA: (a|ε)b — accepts "b" and "ab"
    App.sigma = new Set(['a', 'b']); renderSigma();
    const q0 = createState(160, 200, 'q0'), q1 = createState(340, 200, 'q1'), q2 = createState(520, 200, 'q2');
    App.startId = q0.id; App.accepts.add(q2.id);
    [{ f: q0.id, t: q1.id, s: 'ε' }, { f: q0.id, t: q1.id, s: 'a' }, { f: q1.id, t: q2.id, s: 'b' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 3; showStatus('Example: ε-NFA accepting (a|ε)b — accepts "b" and "ab"');
  } else if (m === 'NFA') {
    // NFA: strings ending in 01
    App.sigma = new Set(['0', '1']); renderSigma();
    const q0 = createState(160, 200, 'q0'), q1 = createState(320, 200, 'q1'), q2 = createState(480, 200, 'q2');
    App.startId = q0.id; App.accepts.add(q2.id);
    [{ f: q0.id, t: q0.id, s: '0' }, { f: q0.id, t: q0.id, s: '1' }, { f: q0.id, t: q1.id, s: '0' }, { f: q1.id, t: q2.id, s: '1' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 4; showStatus('Example: NFA accepting strings ending in 01');
  } else if (m === 'PDA') {
    // PDA: a^n b^n
    App.sigma = new Set(['a', 'b']); renderSigma();
    const q0 = createState(160, 200, 'q0'), q1 = createState(340, 200, 'q1'), q2 = createState(520, 200, 'q2');
    App.startId = q0.id; App.accepts.add(q2.id);
    [{ f: q0.id, t: q0.id, s: 'a', pop: 'Z', push: 'AZ' }, { f: q0.id, t: q0.id, s: 'a', pop: 'A', push: 'AA' },
    { f: q0.id, t: q1.id, s: 'ε', pop: 'Z', push: 'Z' }, { f: q1.id, t: q1.id, s: 'b', pop: 'A', push: 'ε' },
    { f: q1.id, t: q2.id, s: 'ε', pop: 'Z', push: 'Z' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s, pop: tr.pop, push: tr.push }));
    App.transN = 5; showStatus('Example: PDA accepting aⁿbⁿ');
  } else if (m === 'TM') {
    // TM: decides 0^n1^n
    App.sigma = new Set(['0', '1']); renderSigma();
    const q0 = createState(120, 200, 'q0'), q1 = createState(280, 200, 'q1'), q2 = createState(440, 200, 'q2'),
      q3 = createState(600, 200, 'q3'), qa = createState(360, 340, 'q_acc');
    App.startId = q0.id; App.accepts.add(qa.id);
    [{ f: q0.id, t: q1.id, s: '0', w: 'X', d: 'R' }, { f: q1.id, t: q1.id, s: '0', w: '0', d: 'R' },
    { f: q1.id, t: q1.id, s: 'Y', w: 'Y', d: 'R' }, { f: q1.id, t: q2.id, s: '1', w: 'Y', d: 'L' },
    { f: q2.id, t: q2.id, s: '0', w: '0', d: 'L' }, { f: q2.id, t: q2.id, s: 'Y', w: 'Y', d: 'L' },
    { f: q2.id, t: q0.id, s: 'X', w: 'X', d: 'R' }, { f: q0.id, t: q3.id, s: 'Y', w: 'Y', d: 'R' },
    { f: q3.id, t: q3.id, s: 'Y', w: 'Y', d: 'R' }, { f: q3.id, t: qa.id, s: '⊔', w: '⊔', d: 'R' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s, write: tr.w, dir: tr.d }));
    App.transN = 10; showStatus('Example: TM deciding 0ⁿ1ⁿ');
  }
  snapshot(); renderAll(); updateSidebar(); updateRPanel();
}

