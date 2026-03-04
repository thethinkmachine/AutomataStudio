// ══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════════
function saveJSON() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  const data = { machine: App.machine, sigma: [...App.sigma], stackAlpha: [...App.stackAlpha], outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount, states: App.states, transitions: App.transitions, startId: App.startId, accepts: [...App.accepts], grammar: grammarData, cam: App.cam };
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
      App.stackAlpha = new Set(d.stackAlpha || ['Z']);
      App.outputAlpha = new Set(d.outputAlpha || []);
      if (d.tapeCount) App.tapeCount = d.tapeCount;
      App.states = d.states || [];
      App.transitions = d.transitions || []; App.startId = d.startId || null;
      App.accepts = new Set(d.accepts || []);
      App.stateN = Math.max(0, ...App.states.map(s => { const m = s.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
      App.transN = Math.max(0, ...App.transitions.map(t => { const m = t.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
      if (d.grammar) {
        App.grammar.vars = new Set(d.grammar.vars || []);
        App.grammar.start = d.grammar.start || '';
        App.grammar.productions = d.grammar.productions || [];
      }
      if (d.cam) { App.cam = { ...d.cam }; }
      setMachine(App.machine); renderSigma(); renderGamma(); renderOutputAlpha();
      renderAll(); updateSidebar(); updateRPanel(); showStatus('Loaded!');
      if (d.cam) { applyCamera(); } else { setTimeout(() => fitToScreen(), 50); }
      snapshot();
    } catch (err) { showStatus('Invalid JSON file'); }
  };
  r.readAsText(f); e.target.value = '';
}

// Auto Backup/Restore via LocalStorage
function saveBackup() {
  const grammarData = { vars: [...App.grammar.vars], start: App.grammar.start, productions: App.grammar.productions };
  const data = { machine: App.machine, sigma: [...App.sigma], stackAlpha: [...App.stackAlpha], outputAlpha: [...App.outputAlpha], tapeCount: App.tapeCount, states: App.states, transitions: App.transitions, startId: App.startId, accepts: [...App.accepts], grammar: grammarData, cam: App.cam };
  try { localStorage.setItem('automata-backup', JSON.stringify(data)); } catch (e) { }
}
function loadBackup() {
  try {
    const raw = localStorage.getItem('automata-backup');
    if (!raw) return;
    const d = JSON.parse(raw);
    App.machine = d.machine || 'DFA'; App.sigma = new Set(d.sigma || []);
    App.stackAlpha = new Set(d.stackAlpha || ['Z']); App.outputAlpha = new Set(d.outputAlpha || []);
    if (d.tapeCount) App.tapeCount = d.tapeCount;
    App.states = d.states || []; App.transitions = d.transitions || []; App.startId = d.startId || null; App.accepts = new Set(d.accepts || []);
    App.stateN = Math.max(0, ...App.states.map(s => { const m = s.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
    App.transN = Math.max(0, ...App.transitions.map(t => { const m = t.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
    if (d.grammar) { App.grammar.vars = new Set(d.grammar.vars || []); App.grammar.start = d.grammar.start || ''; App.grammar.productions = d.grammar.productions || []; }
    if (d.cam) { App.cam = { ...d.cam }; }
    setMachine(App.machine); renderSigma(); renderGamma(); renderOutputAlpha();
    renderAll(); updateSidebar(); updateRPanel();
    if (d.cam) { applyCamera(); } else { setTimeout(() => fitToScreen(), 50); }
  } catch (e) { }
}

window.addEventListener('beforeunload', saveBackup);


// ══════════════════════════════════════════════════════════════════
//  LOAD EXAMPLE
// ══════════════════════════════════════════════════════════════════
function loadExample() {
  clearAll(true);
  const m = App.machine;
  if (m === 'DFA') {
    // DFA: even number of 1s (parity checker)
    App.sigma = new Set(['0', '1']); renderSigma();
    const q0 = createState(140, 200, 'q_even');
    const q1 = createState(360, 200, 'q_odd');
    App.startId = q0.id; App.accepts.add(q0.id);
    [{ f: q0.id, t: q0.id, s: '0' }, { f: q0.id, t: q1.id, s: '1' },
    { f: q1.id, t: q1.id, s: '0' }, { f: q1.id, t: q0.id, s: '1' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 4; showStatus('Example: DFA accepting even number of 1s');
  } else if (m === 'NFA') {
    // NFA: strings containing "aa" or "bb"
    App.sigma = new Set(['a', 'b']); renderSigma();
    const q0 = createState(100, 200, 'q0');
    const q1 = createState(220, 200, 'q1');
    const q2 = createState(340, 200, 'q2');
    const q3 = createState(460, 200, 'q3');
    App.startId = q0.id; App.accepts.add(q3.id);
    [{ f: q0.id, t: q0.id, s: 'a' }, { f: q0.id, t: q0.id, s: 'b' },
    { f: q0.id, t: q1.id, s: 'a' }, { f: q0.id, t: q2.id, s: 'b' },
    { f: q1.id, t: q3.id, s: 'a' }, { f: q2.id, t: q3.id, s: 'b' },
    { f: q3.id, t: q3.id, s: 'a' }, { f: q3.id, t: q3.id, s: 'b' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 8; showStatus('Example: NFA accepting strings with "aa" or "bb"');
  } else if (m === 'ε-NFA') {
    // ε-NFA: strings containing "ab" or "ba"
    App.sigma = new Set(['a', 'b']); renderSigma();
    const q0 = createState(80, 200, 'q0');
    const qa = createState(200, 200, 'q_a');
    const qb = createState(320, 200, 'q_b');
    const q_ab = createState(440, 200, 'q_ab');
    const q_ba = createState(560, 200, 'q_ba');
    App.startId = q0.id; App.accepts.add(q_ab.id); App.accepts.add(q_ba.id);
    [{ f: q0.id, t: q0.id, s: 'a' }, { f: q0.id, t: q0.id, s: 'b' },
    { f: q0.id, t: qa.id, s: 'a' }, { f: q0.id, t: qb.id, s: 'b' },
    { f: qa.id, t: q0.id, s: 'a' }, { f: qa.id, t: q_ab.id, s: 'b' },
    { f: qb.id, t: q_ba.id, s: 'a' }, { f: qb.id, t: q0.id, s: 'b' },
    { f: q_ab.id, t: q_ab.id, s: 'a' }, { f: q_ab.id, t: q_ab.id, s: 'b' },
    { f: q_ba.id, t: q_ba.id, s: 'a' }, { f: q_ba.id, t: q_ba.id, s: 'b' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 12; showStatus('Example: ε-NFA accepting "ab" or "ba"');
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
  } else if (m === 'Moore') {
    // Moore: traffic light (red → green → yellow → red)
    App.sigma = new Set(['tick']); renderSigma();
    App.outputAlpha = new Set(['RED', 'GREEN', 'YELLOW']); renderOutputAlpha();
    const q0 = createState(160, 200, 'q_red'); q0.output = 'RED';
    const q1 = createState(360, 200, 'q_green'); q1.output = 'GREEN';
    const q2 = createState(560, 200, 'q_yellow'); q2.output = 'YELLOW';
    App.startId = q0.id; App.accepts.add(q0.id);
    [{ f: q0.id, t: q1.id, s: 'tick' }, { f: q1.id, t: q2.id, s: 'tick' }, { f: q2.id, t: q0.id, s: 'tick' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s }));
    App.transN = 3; showStatus('Example: Moore traffic light (RED→GREEN→YELLOW→RED)');
  } else if (m === 'Mealy') {
    // Mealy: count 0s and 1s, output on each symbol
    App.sigma = new Set(['0', '1']); renderSigma();
    App.outputAlpha = new Set(['seen0', 'seen1']); renderOutputAlpha();
    const q0 = createState(160, 200, 'q0');
    const q1 = createState(360, 200, 'q1');
    App.startId = q0.id; App.accepts.add(q0.id); App.accepts.add(q1.id);
    [{ f: q0.id, t: q0.id, s: '0', o: 'seen0' }, { f: q0.id, t: q1.id, s: '1', o: 'seen1' },
    { f: q1.id, t: q0.id, s: '0', o: 'seen0' }, { f: q1.id, t: q1.id, s: '1', o: 'seen1' }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.s, output: tr.o }));
    App.transN = 4; showStatus('Example: Mealy machine tagging 0s and 1s');
  } else if (m === 'MTM') {
    // MTM: 2-tape copy machine — copies tape 1 content to tape 2
    // Demonstrates basic multi-tape operation: T1 = input (read-only role), T2 = work tape
    // The transition reads [x, ⊔] from both tapes and writes x to T2 until T1 is blank
    App.sigma = new Set(['a', 'b']); renderSigma();
    App.tapeCount = 2; if ($('tape-count-sel')) $('tape-count-sel').value = 2;
    const q0 = createState(200, 200, 'q_copy');
    const qa = createState(480, 200, 'q_done');
    App.startId = q0.id; App.accepts.add(qa.id);
    // Read x from T1, blank from T2 → write x to T2, advance both heads
    [{ f: q0.id, t: q0.id, ts: ['a', '⊔'], tw: ['a', 'a'], td: ['R', 'R'] },
    { f: q0.id, t: q0.id, ts: ['b', '⊔'], tw: ['b', 'b'], td: ['R', 'R'] },
    { f: q0.id, t: qa.id, ts: ['⊔', '⊔'], tw: ['⊔', '⊔'], td: ['R', 'R'] }]
      .forEach((tr, i) => App.transitions.push({ id: 't' + (i + 1), from: tr.f, to: tr.t, symbol: tr.ts[0], tapeSyms: tr.ts, tapeWrites: tr.tw, tapeDirs: tr.td }));
    App.transN = 3; showStatus('Example: MTM 2-tape — copies tape 1 content to tape 2');
  }
  snapshot(); renderAll(); updateSidebar(); updateRPanel();
}

