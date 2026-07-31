// ══════════════════════════════════════════════════════════════════
//  LANGUAGE PANEL
// ══════════════════════════════════════════════════════════════════
//  The section answers "what is L(M)?" in one of two registers,
//  chosen by the shape of Σ rather than by machine type:
//
//    symbolic   — every symbol is one character. L is shown as a
//                 fingerprint: Σ* in shortlex order, one cell per
//                 word, accepted cells lit.
//    vocabulary — some symbol is a word. Σ* is exponential in |Σ|,
//                 so at (say) 17 event names a fingerprint never
//                 reaches a length that holds an accepted word. L is
//                 shown as accepted traces instead: shortlex over
//                 L(M) itself, found by walking the machine.
//
//  Both sit under the same one-line formal definition whose
//  components are clickable and cross-highlight the canvas.
// ══════════════════════════════════════════════════════════════════

const LANG_FP_CELLS = 128;        // fingerprint budget, in cells
const LANG_TRACE_ROWS = 6;        // accepted traces listed
const LANG_TRACE_MAXLEN = 24;     // longest trace worth hunting for
const LANG_TRACE_NODES = 40000;   // search ceiling, keeps the panel snappy
const LANG_TRACE_FRONTIER = 2000; // live prefixes carried per length

// ── mode ──────────────────────────────────────────────────────────
// The one heuristic the whole section turns on.
function langIsSymbolic() {
  for (const s of App.sigma) if ([...s].length !== 1) return false;
  return true;
}

// Turing machines are included: testTMVerdict answers three-valued, so a
// word the machine has not decided is drawn as "no verdict" rather than
// silently counted as a reject. A transducer only has an accept/reject
// notion when the user has opted into one.
function langCanDecide() {
  const m = App.machine;
  if (getMachineConfig(m).isTransducer && !App.config.transducerAccepts) return false;
  return true;
}

// Walking the transition graph only yields meaningful words when edges
// consume input left to right. Two-way heads and tapes revisit cells,
// so a path through the graph is not a word.
function langCanTrace() {
  const m = App.machine;
  return m === 'DFA' || m === 'NFA' || m === 'ε-NFA' || isAnyPDA(m);
}

// ── the vocabulary: abbreviations, actor groups, usage ─────────────
// camelCase / PascalCase → initials. "citizenFilesComplaint" → "cFC".
function langAbbrev(sym) {
  const parts = sym.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
  if (!parts.length) return sym.slice(0, 3);
  return parts.map((p, i) => i === 0 ? [...p][0] : [...p][0].toUpperCase()).join('');
}

// Actor = the leading lowercase run before the first capital. A
// PascalCase name has none, which is itself worth surfacing.
function langActor(sym) {
  const m = sym.match(/^[a-z][a-z0-9]*/);
  return m ? m[0] : '';
}

let _langVocab = { key: '', val: null };
function _langVocabKey() {
  return [...App.sigma].join('') + '||' +
    App.transitions.map(t => t.symbol).sort().join('');
}

function langVocab() {
  const key = _langVocabKey();
  if (_langVocab.key === key && _langVocab.val) return _langVocab.val;

  const sigma = [...App.sigma];
  const any = App.config.sym.any;
  const uses = {};
  sigma.forEach(s => { uses[s] = 0; });
  let wildcards = 0;
  for (const t of App.transitions) {
    if (t.symbol === any) wildcards++;
    else if (Object.prototype.hasOwnProperty.call(uses, t.symbol)) uses[t.symbol]++;
  }

  // Digit suffixes only where initials actually collide.
  const taken = Object.create(null), abbr = {};
  for (const s of sigma) {
    let a = langAbbrev(s); const base = a; let n = 2;
    while (taken[a]) a = base + (n++);
    taken[a] = true; abbr[s] = a;
  }

  const groups = {};
  for (const s of sigma) { const g = langActor(s); (groups[g] = groups[g] || []).push(s); }
  // Two categorical hues, never more: the two largest actor groups.
  // Everything else stays neutral, which makes the odd-one-out names
  // flag themselves without anyone writing a rule.
  const ranked = Object.keys(groups)
    .filter(g => g && groups[g].length > 1)
    .sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
  const slot = {};
  sigma.forEach(s => { slot[s] = 0; });
  ranked.slice(0, 2).forEach((g, i) => groups[g].forEach(s => { slot[s] = i + 1; }));

  const dead = wildcards ? [] : sigma.filter(s => !uses[s]);
  const val = { sigma, uses, abbr, groups, ranked, slot, dead, wildcards };
  _langVocab = { key, val };
  return val;
}

// ── deciding a word ───────────────────────────────────────────────
// Reuses the same verdict-only runners the batch tester uses, so a
// word shown here is accepted by exactly the simulator the user runs.
function langVerdict(tokens) {
  const m = App.machine;
  try {
    if (isAnyTM(m)) return testTMVerdict(tokens);
    if (m === 'DFA') return testDFA(tokens) ? 'acc' : 'rej';
    if (m === 'NFA' || m === 'ε-NFA') return testNFA(tokens) ? 'acc' : 'rej';
    if (m === 'DPDA' || m === 'PDA') return testPDA(tokens) ? 'acc' : 'rej';
    if (m === 'NPDA' || m === 'QA' || m === 'Counter' || m === '2PDA') return testNPDA(tokens) ? 'acc' : 'rej';
    if (m === '2DFA') return test2DFA(tokens) ? 'acc' : 'rej';
    if (m === '2NFA') return test2NFA(tokens) ? 'acc' : 'rej';
    if (m === 'Moore' || m === 'Mealy') return testDFA(tokens) ? 'acc' : 'rej';
    if (m === 'FST') return testFST(tokens).accepted ? 'acc' : 'rej';
  } catch (e) {
    return 'unk';
  }
  return 'unk';
}

// ── fingerprint (symbolic mode) ───────────────────────────────────
// Shortlex enumeration of Σ*, whole length-blocks only.
function langEnumerate(cap) {
  const sigma = [...App.sigma].filter(s => s !== App.config.sym.eps).sort();
  const blocks = [];
  let words = [[]], total = 0, len = 0;
  while (words.length) {
    if (total + words.length > cap) break;
    blocks.push({ len, words });
    total += words.length; len++;
    const next = [];
    for (const w of words) for (const s of sigma) next.push(w.concat([s]));
    words = next;
  }
  return { blocks, total, sigma };
}

// How many cells a fingerprint would need to reach a given length.
function langCellsToReach(n, L) {
  if (n <= 1) return L + 1;
  return Math.round((Math.pow(n, L + 1) - 1) / (n - 1));
}

// ── accepted traces (vocabulary mode) ─────────────────────────────
// Candidates come from walking the graph — linear in the machine, not
// exponential in |Σ| — and every candidate is then verified with the
// real simulator, so a stack-sensitive machine never reports a word it
// would actually reject.
//
// Selection is strict shortlex over L(M): shortest first, ties broken
// on the alphabet's own order. That is what makes the list a signature
// — the k shortest words of a language depend on the language alone,
// so two machines accepting the same strings produce the same rows
// however differently they happen to be drawn.
function langAcceptedTraces(K) {
  K = K || LANG_TRACE_ROWS;
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  const sigma = [...App.sigma].filter(s => s !== eps).sort();
  const rank = new Map(sigma.map((s, i) => [s, i]));

  if (!App.startId) return { traces: [], reason: 'no start state' };
  if (!App.accepts.size) return { traces: [], reason: 'no accepting state' };

  // index the graph once
  const out = new Map(), rev = new Map();
  for (const t of App.transitions) {
    if (!out.has(t.from)) out.set(t.from, []);
    out.get(t.from).push(t);
    if (!rev.has(t.to)) rev.set(t.to, []);
    rev.get(t.to).push(t.from);
  }

  // states that can still reach an accepting state — pruning them keeps
  // the frontier small and is a language property, so it cannot skew
  // the ordering
  const live = new Set(App.accepts);
  const stack = [...App.accepts];
  while (stack.length) {
    const x = stack.pop();
    for (const p of (rev.get(x) || [])) if (!live.has(p)) { live.add(p); stack.push(p); }
  }

  const closure = (id) => {
    const seen = new Set([id]), st = [id];
    while (st.length) {
      const x = st.pop();
      for (const t of (out.get(x) || [])) {
        if (t.symbol === eps && !seen.has(t.to)) { seen.add(t.to); st.push(t.to); }
      }
    }
    return seen;
  };

  const cmp = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) return (rank.get(a[i]) ?? 1e9) - (rank.get(b[i]) ?? 1e9);
    }
    return a.length - b.length;
  };

  const traces = [];
  let nodes = 0, truncated = false;
  const startClosure = closure(App.startId);
  if ([...startClosure].some(id => App.accepts.has(id)) && langVerdict([]) === 'acc') {
    traces.push([]);
  }

  let frontier = [...startClosure].filter(id => live.has(id)).map(id => ({ s: id, w: [] }));
  const seenStart = new Set();
  frontier = frontier.filter(n => { if (seenStart.has(n.s)) return false; seenStart.add(n.s); return true; });

  for (let d = 0; d < LANG_TRACE_MAXLEN && traces.length < K && frontier.length; d++) {
    const next = [];
    for (const nd of frontier) {
      for (const t of (out.get(nd.s) || [])) {
        if (t.symbol === eps) continue;
        // a wildcard edge stands for every symbol in Σ
        const syms = t.symbol === any ? sigma : [t.symbol];
        for (const sym of syms) {
          if (!rank.has(sym)) continue;
          const w = nd.w.concat([sym]);
          for (const to of closure(t.to)) {
            if (!live.has(to)) continue;
            if (++nodes > LANG_TRACE_NODES) { truncated = true; break; }
            next.push({ s: to, w });
          }
          if (truncated) break;
        }
        if (truncated) break;
      }
      if (truncated) break;
    }
    if (!next.length) break;

    next.sort((x, y) => cmp(x.w, y.w) || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));

    // accepted words at this length, deduped, in alphabet order —
    // verified against the real simulator before being shown
    const seenW = new Set();
    for (const nd of next) {
      if (traces.length >= K) break;
      if (!App.accepts.has(nd.s)) continue;
      const k = nd.w.join('');
      if (seenW.has(k)) continue;
      seenW.add(k);
      if (langVerdict(nd.w) === 'acc') traces.push(nd.w);
    }

    // carry the lexicographically smallest live prefixes forward
    const seenN = new Set(), kept = [];
    for (const nd of next) {
      const k = nd.s + '' + nd.w.join('');
      if (seenN.has(k)) continue;
      seenN.add(k); kept.push(nd);
      if (kept.length >= LANG_TRACE_FRONTIER) { truncated = true; break; }
    }
    frontier = kept;
    if (truncated && !traces.length) break;
  }

  return { traces, truncated, reason: traces.length ? null : 'no accepted word found within the search budget' };
}

// ── the formal definition, as one line ────────────────────────────
function langTupleSyms() {
  const m = App.machine;
  if (m === '2PDA') return ['Q', 'Σ', 'Γ₁', 'Γ₂', 'δ', 'q₀', 'F'];
  if (m === 'QA' || m === 'Counter') return ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F'];
  if (isAnyPDA(m)) {
    return App.config.pdaParadigm === 'explicit'
      ? ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'Z₀', 'F']
      : ['Q', 'Σ', 'Γ', 'δ', 'q₀'];
  }
  if (m === 'Moore' || m === 'Mealy') return ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀'];
  if (m === 'FST') return ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀', 'F'];
  if (isAnyTM(m)) return ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F'];
  return ['Q', 'Σ', 'δ', 'q₀', 'F'];
}

function langTupleInfo(sym) {
  const m = App.machine;
  const names = (ids) => App.states.filter(s => ids.has(s.id)).map(s => s.name);
  const set = (arr) => arr.length ? '{' + arr.join(', ') + '}' : '∅';
  switch (sym) {
    case 'Q': return { n: App.states.length, say: 'states', val: set(App.states.map(s => s.name)) };
    case 'Σ': return { n: App.sigma.size, say: 'input alphabet', val: set([...App.sigma]) };
    case 'Γ': case 'Γ₁': case 'Γ₂':
      return {
        n: App.stackAlpha.size, val: set([...App.stackAlpha]),
        say: isAnyTM(m) ? 'tape alphabet' : m === 'QA' ? 'queue alphabet' : 'stack alphabet'
      };
    case 'Δ': return { n: App.outputAlpha.size, say: 'output alphabet', val: set([...App.outputAlpha]) };
    case 'F': return { n: App.accepts.size, say: 'accepting states', val: set(names(App.accepts)) };
    case 'q₀': return { n: null, say: 'start state', val: getState(App.startId)?.name || '—' };
    case 'Z₀': return { n: null, say: 'initial stack symbol', val: App.config.sym.stackBottom };
    case 'δ': return { n: App.transitions.length, say: 'transition function', val: langDeltaSignature() };
    // Moore emits per state, Mealy and FST per transition, so the
    // cardinality shown has to follow the machine, not the tuple slot.
    case 'λ': return {
      n: m === 'Moore' ? App.states.length : App.transitions.length,
      say: 'output function',
      val: m === 'Moore' ? 'Q → Δ' : m === 'Mealy' ? 'Q × Σ → Δ' : 'Q × (Σ ∪ {ε}) × Q → Δ*'
    };
  }
  return { n: null, say: '', val: '—' };
}

function langDeltaSignature() {
  const m = App.machine;
  if (m === 'DFA') return 'Q × Σ → Q';
  if (m === 'NFA') return 'Q × Σ → P(Q)';
  if (m === 'ε-NFA') return 'Q × (Σ ∪ {ε}) → P(Q)';
  if (m === '2DFA') return 'Q × Σ → Q × {L, R, S}';
  if (m === '2NFA') return 'Q × Σ → P(Q × {L, R, S})';
  if (m === 'QA') return 'Q × (Σ ∪ {ε}) × (Γ ∪ {ε}) → P(Q × Γ*)';
  if (m === '2PDA') return 'Q × (Σ ∪ {ε}) × Γ₁ × Γ₂ → P(Q × Γ₁* × Γ₂*)';
  if (isAnyPDA(m)) return 'Q × (Σ ∪ {ε}) × Γ → ' + (m === 'NPDA' ? 'P(Q × Γ*)' : 'Q × Γ*');
  if (m === 'MTM') { const k = App.tapeCount || 2; return `Q × Γ^${k} → Q × Γ^${k} × {L, R, S}^${k}`; }
  if (m === 'NDTM') return 'Q × Γ → P(Q × Γ × {L, R, S})';
  if (isAnyTM(m)) return 'Q × Γ → Q × Γ × {L, R, S}';
  if (m === 'Moore' || m === 'Mealy') return 'Q × Σ → Q';
  if (m === 'FST') return 'Q × (Σ ∪ {ε}) → P(Q)';
  return '';
}

// ── canvas cross-highlight ────────────────────────────────────────
// Reuses the same classes the state/transition lists use for their
// hover highlight, so pointing at δ here looks like pointing at a
// transition row over there.
function langClearHighlight() {
  document.querySelectorAll('.sn.list-hover-st').forEach(el => el.classList.remove('list-hover-st'));
  document.querySelectorAll('.edge-g.list-hover-t').forEach(el => el.classList.remove('list-hover-t'));
}

function langHighlight(sym) {
  langClearHighlight();
  const litStates = (ids) => ids.forEach(id => {
    const el = App.domCache.states.get(id) || document.querySelector(`.sn[data-id="${id}"]`);
    if (el) el.classList.add('list-hover-st');
  });
  const litEdges = (pred) => {
    const keys = new Set();
    App.transitions.forEach(t => { if (pred(t)) keys.add(t.from + '|' + t.to); });
    keys.forEach(k => {
      const el = App.domCache.transitions.get(k) || document.querySelector(`.edge-g[data-edge="${k}"]`);
      if (el) el.classList.add('list-hover-t');
    });
  };
  if (sym === 'Q') litStates(App.states.map(s => s.id));
  else if (sym === 'F') litStates([...App.accepts]);
  else if (sym === 'q₀') { if (App.startId) litStates([App.startId]); }
  else if (sym === 'δ' || sym === 'λ') litEdges(() => true);
  else if (sym === 'Σ') litEdges(t => App.sigma.has(t.symbol) || t.symbol === App.config.sym.any);
}

// Highlight every transition carrying one particular input symbol.
function langHighlightSymbol(sym, on) {
  const keys = new Set();
  App.transitions.forEach(t => { if (t.symbol === sym) keys.add(t.from + '|' + t.to); });
  keys.forEach(k => {
    const el = App.domCache.transitions.get(k) || document.querySelector(`.edge-g[data-edge="${k}"]`);
    if (el) el.classList.toggle('list-hover-t', on);
  });
}

// ── rendering ─────────────────────────────────────────────────────
function _le(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

// Hue is never the only channel: each code's first letter is the actor
// initial, so the grouping survives CVD, greyscale and forced-colors.
function langSymChip(sym, opts = {}) {
  const v = langVocab();
  const cls = 'lang-sym' + (v.slot[sym] ? ' g' + v.slot[sym] : '') +
    (!opts.plain && !v.uses[sym] && !v.wildcards ? ' dead' : '');
  const c = _le('span', cls, langIsSymbolic() ? sym : v.abbr[sym]);
  const n = v.uses[sym];
  c.title = sym + (v.wildcards ? '' : n ? ` · ${n} transition${n > 1 ? 's' : ''}` : ' · declared in Σ but on no transition');
  if (!opts.static) {
    c.addEventListener('mouseenter', () => langHighlightSymbol(sym, true));
    c.addEventListener('mouseleave', () => langHighlightSymbol(sym, false));
  }
  return c;
}

function langLoadTrace(word) {
  const input = $('sim-in');
  if (!input) return;
  input.value = word.length
    ? (langIsSymbolic() ? word.join('') : word.join(','))
    : App.config.sym.eps;
  const sec = $('rp-simulate');
  if (sec && sec.classList.contains('collapsed') && typeof toggleRPSection === 'function') {
    toggleRPSection('rp-simulate');
  }
  if (typeof runSim === 'function') runSim();
}

// Both the fingerprint and the trace search run the real simulator many
// times over, and updateRPanel() fires on every edit — so the result is
// memoised on the same structural key the regex cache uses. Dragging a
// state around must not re-decide 127 words.
let _langExtCache = { key: '', node: null };
function _langExtKey() {
  const base = typeof _regexCacheKey === 'function'
    ? _regexCacheKey()
    : App.transitions.map(t => t.from + t.symbol + t.to).join(',');
  return App.machine + '|' + [...App.sigma].join('') + '|' +
    [...App.stackAlpha].join('') + '|' + App.config.transducerAccepts + '|' +
    App.config.langStepBudget + '|' + App.tapeCount + '|' + base;
}

function renderLangExtension() {
  const host = $('lang-extension');
  if (!host) return;
  host.innerHTML = '';
  if (!App.states.length) { _langExtCache = { key: '', node: null }; return; }

  const key = _langExtKey();
  if (_langExtCache.key === key && _langExtCache.node) {
    host.appendChild(_langExtCache.node);
    return;
  }

  const box = _le('div');
  if (!langCanDecide()) {
    box.appendChild(_le('div', 'lang-note',
      'Enable "transducers accept" in Settings to list accepted inputs.'));
  } else if (langIsSymbolic()) {
    renderLangFingerprint(box);
  } else {
    renderLangTraces(box);
  }
  _langExtCache = { key, node: box };
  host.appendChild(box);
}

// ── symbolic: the fingerprint ─────────────────────────────────────
function renderLangFingerprint(host) {
  const { blocks, total } = langEnumerate(LANG_FP_CELLS);
  if (!blocks.length) return;

  const head = _le('div', 'lang-head');
  head.appendChild(_le('span', 'lang-cap', 'fingerprint'));
  const count = _le('span', 'lang-cap');
  head.appendChild(count);
  host.appendChild(head);

  const grid = _le('div', 'lang-fp');
  const read = _le('div', 'lang-fp-read');
  let nAcc = 0, nRej = 0, nUnk = 0;

  for (const blk of blocks) {
    const row = _le('div', 'lang-fp-row');
    row.appendChild(_le('div', 'lang-fp-len', String(blk.len)));
    const cells = _le('div', 'lang-fp-cells');
    for (const w of blk.words) {
      const v = langVerdict(w);
      if (v === 'acc') nAcc++; else if (v === 'unk') nUnk++; else nRej++;
      const label = w.length ? w.join('') : App.config.sym.eps;
      const c = _le('button', 'lang-fp-c' + (v === 'acc' ? ' acc' : v === 'unk' ? ' unk' : ''));
      c.type = 'button';
      c.title = `${label} — ${v === 'acc' ? 'accepted' : v === 'unk' ? 'no verdict' : 'rejected'}`;
      c.setAttribute('aria-label', c.title);
      const show = () => {
        read.innerHTML = '';
        read.appendChild(_le('span', 'w', label));
        read.appendChild(_le('span', 'v-' + v,
          v === 'acc' ? 'accepted' : v === 'unk' ? 'no verdict' : 'rejected'));
      };
      c.addEventListener('mouseenter', show);
      c.addEventListener('focus', show);
      c.addEventListener('click', () => {
        grid.querySelectorAll('.lang-fp-c.sel').forEach(x => x.classList.remove('sel'));
        c.classList.add('sel');
        langLoadTrace(w);
      });
      cells.appendChild(c);
    }
    row.appendChild(cells);
    grid.appendChild(row);
  }
  host.appendChild(grid);
  host.appendChild(read);
  count.textContent = `${nAcc} of ${total}`;

  const legend = _le('div', 'lang-legend');
  const kv = (cls, txt) => { const s = _le('span'); s.appendChild(_le('i', cls)); s.appendChild(document.createTextNode(txt)); return s; };
  legend.appendChild(kv('k-acc', `accept ${nAcc}`));
  legend.appendChild(kv('k-rej', `reject ${nRej}`));
  if (nUnk) legend.appendChild(kv('k-unk', `no verdict ${nUnk}`));
  host.appendChild(legend);

  // The hatched cells are the honest part: raising the budget resolves the
  // slow ones, and whatever is left never halts at any budget.
  if (nUnk) {
    host.appendChild(_le('div', 'lang-foot',
      `${nUnk} word${nUnk > 1 ? 's' : ''} still running after ${langStepBudget()} steps — ` +
      'not rejections. Raise the budget in Settings › Turing Machine; whatever stays hatched never halts.'));
  }
}

// ── vocabulary: accepted traces ───────────────────────────────────
function renderLangTraces(host) {
  const v = langVocab();

  const head = _le('div', 'lang-head');
  head.appendChild(_le('span', 'lang-cap', 'accepted traces'));
  const count = _le('span', 'lang-cap');
  head.appendChild(count);
  host.appendChild(head);

  if (!langCanTrace()) {
    host.appendChild(_le('div', 'lang-note',
      isAnyTM(App.machine)
        ? `A ${App.machine} rewrites its tape, so a path through the graph is not an input word. ` +
          'Use Simulate or Batch test to probe specific traces.'
        : `A ${App.machine} head revisits input, so a path through the graph is not a word. ` +
          'Use Batch test to probe specific traces.'));
    return;
  }

  const res = langAcceptedTraces(LANG_TRACE_ROWS);
  count.textContent = res.traces.length ? `${res.traces.length} shortest` : '';

  if (!res.traces.length) {
    host.appendChild(_le('div', 'lang-note', res.reason || 'L(M) = ∅'));
    return;
  }

  const list = _le('div', 'lang-tr');
  const covered = new Set();
  for (const w of res.traces) {
    w.forEach(s => covered.add(s));
    const row = _le('div', 'lang-tr-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.title = (w.length ? w.join(' → ') : 'ε') + '  ·  click to run in Simulate';
    const syms = _le('div', 'lang-tr-syms');
    if (!w.length) syms.appendChild(_le('span', 'lang-tr-eps', App.config.sym.eps));
    else w.forEach(s => syms.appendChild(langSymChip(s)));
    row.appendChild(syms);
    row.appendChild(_le('div', 'lang-tr-len', String(w.length)));
    const go = () => langLoadTrace(w);
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.appendChild(row);
  }
  host.appendChild(list);

  const top = v.ranked.slice(0, 2);
  if (top.length) {
    const legend = _le('div', 'lang-legend');
    const kv = (cls, txt) => { const s = _le('span'); s.appendChild(_le('i', cls)); s.appendChild(document.createTextNode(txt)); return s; };
    top.forEach((g, i) => legend.appendChild(kv('k-g' + (i + 1), `${g} · ${v.groups[g].length}`)));
    const rest = App.sigma.size - top.reduce((n, g) => n + v.groups[g].length, 0);
    if (rest > 0) legend.appendChild(kv('k-g0', `other · ${rest}`));
    host.appendChild(legend);
  }

  const foot = [`${covered.size}/${App.sigma.size} symbols exercised`];
  if (res.truncated) foot.push('search truncated');
  host.appendChild(_le('div', 'lang-foot', foot.join(' · ')));
}

// ── the tuple line ────────────────────────────────────────────────
function renderLangTuple() {
  const strip = $('lang-tuple');
  const open = $('lang-tuple-open');
  if (!strip || !open) return;
  strip.innerHTML = '';
  open.innerHTML = '';
  open.style.display = 'none';

  const syms = langTupleSyms();
  strip.appendChild(_le('span', 'lang-punc', 'M = ('));
  let active = null;

  syms.forEach((s, i) => {
    const info = langTupleInfo(s);
    const b = _le('button', 'lang-chip');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.appendChild(document.createTextNode(s));
    if (info.n != null) b.appendChild(_le('sup', null, String(info.n)));
    b.title = `${s} — ${info.say}`;
    b.addEventListener('click', () => {
      if (active === b) {
        b.setAttribute('aria-expanded', 'false');
        open.style.display = 'none'; active = null; langClearHighlight();
        return;
      }
      strip.querySelectorAll('.lang-chip').forEach(x => x.setAttribute('aria-expanded', 'false'));
      b.setAttribute('aria-expanded', 'true'); active = b;
      renderLangChipBody(open, s, info);
      open.style.display = '';
      langHighlight(s);
    });
    b.addEventListener('mouseenter', () => { if (!active) langHighlight(s); });
    b.addEventListener('mouseleave', () => { if (!active) langClearHighlight(); });
    strip.appendChild(b);
    if (i < syms.length - 1) strip.appendChild(_le('span', 'lang-punc', ','));
  });
  strip.appendChild(_le('span', 'lang-punc', ')'));
}

function renderLangChipBody(open, sym, info) {
  open.innerHTML = '';
  const head = _le('div', 'lang-open-head');
  head.appendChild(_le('span', 'k', sym));
  head.appendChild(document.createTextNode(' — ' + info.say));
  open.appendChild(head);

  // Σ over a word alphabet is a vocabulary, not a set you can print.
  if (sym === 'Σ' && !langIsSymbolic()) { renderLangVocabList(open); return; }

  if (sym === 'Σ') {
    const row = _le('div', 'lang-open-chips');
    [...App.sigma].forEach(s => row.appendChild(langSymChip(s, { plain: true })));
    open.appendChild(row);
    return;
  }
  open.appendChild(_le('div', 'lang-open-val', info.val));
}

// Σ as a vocabulary: ranked by how many transitions actually use each
// symbol. At |Σ| = 2 this is overkill; at 17 the zero-usage row is the
// most useful thing on the panel.
function renderLangVocabList(open) {
  const v = langVocab();
  const search = _le('input', 'lang-voc-search');
  search.type = 'search';
  search.placeholder = `filter ${v.sigma.length} symbols…`;
  open.appendChild(search);

  const list = _le('div', 'lang-voc-list');
  const max = Math.max(1, ...v.sigma.map(s => v.uses[s]));
  const ordered = v.sigma.slice().sort((a, b) => v.uses[b] - v.uses[a] || a.localeCompare(b));
  for (const s of ordered) {
    const row = _le('div', 'lang-voc-row' + (!v.uses[s] && !v.wildcards ? ' dead' : ''));
    row.dataset.name = s.toLowerCase();
    const nm = _le('div', 'lang-voc-name');
    nm.appendChild(langSymChip(s));
    const t = _le('span', 't', s); t.title = s;
    nm.appendChild(t);
    row.appendChild(nm);
    // Meter is magnitude, so one hue on its own soft track; identity
    // lives in the chip beside it, never in the bar's colour.
    const meter = _le('div', 'lang-voc-meter');
    const fill = _le('i');
    fill.style.width = (v.uses[s] / max * 100) + '%';
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(_le('div', 'lang-voc-n', String(v.uses[s])));
    row.addEventListener('mouseenter', () => langHighlightSymbol(s, true));
    row.addEventListener('mouseleave', () => langHighlightSymbol(s, false));
    list.appendChild(row);
  }
  open.appendChild(list);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll('.lang-voc-row').forEach(r => {
      r.style.display = !q || r.dataset.name.includes(q) ? '' : 'none';
    });
  });

  if (v.dead.length) {
    const flag = _le('div', 'lang-flag');
    flag.textContent = `${v.dead.length} symbol${v.dead.length > 1 ? 's' : ''} declared in Σ but on no transition: ` + v.dead.join(', ');
    open.appendChild(flag);
  }
  if (v.ranked.length) {
    open.appendChild(_le('div', 'lang-voc-groups',
      'prefixes  ' + v.ranked.map(g => `${g}·${v.groups[g].length}`).join('  ')));
  }
}

// The tuple line is the default view of the definition; the full KaTeX
// block stays one click away so nothing that used to be here is lost.
function toggleFormalDef() {
  const wrap = $('def-box-wrap'), btn = $('def-toggle-btn');
  if (!wrap) return;
  const show = wrap.style.display === 'none';
  wrap.style.display = show ? '' : 'none';
  if (btn) {
    btn.setAttribute('aria-expanded', String(show));
    btn.classList.toggle('open', show);
    btn.title = show ? 'Hide the full formal definition' : 'Show the full formal definition';
  }
  if (show && typeof updateDefBoxOverflowShadow === 'function') updateDefBoxOverflowShadow();
}

// ── entry point ───────────────────────────────────────────────────
function renderLanguagePanel() {
  const wrap = $('rp-language');
  if (wrap) {
    wrap.classList.toggle('lang-vocabulary', !langIsSymbolic());
    wrap.classList.toggle('lang-asserted', App._regexIsDerived === false);
  }
  const claim = $('regex-box');
  if (claim) claim.classList.toggle('asserted', App._regexIsDerived === false);
  const micro = $('lang-micro');
  if (micro) {
    if (App._regexIsDerived === false) {
      micro.textContent = 'asserted by machine type · fixed';
    } else {
      // A regex over word symbols runs to thousands of characters and only
      // its first few lines are visible. Say how much is out of view rather
      // than let the scrollbar imply it is nearly all there.
      const n = (App._regexBoxPlain || '').length;
      micro.textContent = 'derived from the graph · live' +
        (n > 240 ? ` · ${n.toLocaleString()} chars` : '');
    }
  }
  renderLangExtension();
  renderLangTuple();
}
