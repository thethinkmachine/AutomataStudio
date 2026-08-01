// ══════════════════════════════════════════════════════════════════
//  SYMBOL SUGGEST — alphabet-aware autocomplete for text fields that expect
//  a string over Σ, Γ, or a grammar's terminal set: the Simulate / Batch Test
//  inputs, the Grammar view's "String to parse" / "String for ambiguity
//  check" fields, and the transition modal's Pop/Push/Write fields.
//
//  As the user types, the trailing "residue" (the not-yet-delimited chunk
//  right before the caret) is matched against the field's alphabet using the
//  same longest-match backtracking that tokenize() uses at Run time, so what's
//  suggested here is always exactly what would tokenize successfully.
//  Candidates render as chips; clicking or Tab inserts one and — for word
//  alphabets — appends the delimiter tokenize() expects, so clicking chips
//  sequentially builds a valid string.
//
//  The transition modal's Pop/Push/Write fields never go through tokenize()
//  at Run time (Pop/Write hold exactly one symbol; Push is split
//  character-by-character — see applyPdaStoreTransition), so they're driven
//  by simpler, purpose-built state functions further down instead of
//  computeResidueState/getSimSuggestState.
// ══════════════════════════════════════════════════════════════════
const SymSuggest = { target: null, state: null, suppressed: false, activeIdx: 0 };

// Case-insensitive prefix test used for *matching* candidates (so typing "A"
// still finds "a"). Only the matching step is case-insensitive — the "is this
// residue already complete" checks below stay case-sensitive on purpose,
// since tokenize() and the transition-modal's Add-time validation are both
// still case-sensitive. If a wrong-case match silently counted as "complete,"
// the field could look fine here yet fail at Run time with no warning;
// keeping the exact-match check strict means a wrong-case match instead shows
// up as a completable suggestion that fixes the casing for you.
function ciStartsWith(str, prefix) {
  return str.toLowerCase().startsWith(prefix.toLowerCase());
}

// Matches a symbol set against the trailing non-delimiter run of `before`.
// Delimiters (comma/whitespace) mirror tokenize()'s own segmentation so a
// symbol that's mid-completion here is exactly what would be mid-segment
// there. `sigmaSet` defaults to Σ (App.sigma); callers pass e.g. a grammar's
// terminal set for the CYK/ambiguity inputs.
function computeResidueState(before, wholeFieldEmpty, sigmaSet = App.sigma, alphabetLabel = 'Σ') {
  const eps = App.config.sym.eps;
  // A bare ε (from the eps chip, or "eps"/"epsilon" — recognized case-insensitively
  // exactly like parseEps() does at Run time) means "empty string" and is complete
  // the moment it's typed.
  const trimmed = before.trim();
  if (trimmed === eps || /^(eps|epsilon)$/i.test(trimmed)) return { mode: 'none' };

  // Reserved marker symbols (any/blank/boundary/stackBottom/lambda) can end up in
  // an alphabet through lax alphabet-input validation or an imported automaton
  // file — never offer them as ordinary suggestion chips. Sorted longest-first
  // to match tokenize()'s own greedy longest-match order, so the default (Tab)
  // candidate for an overlapping-prefix alphabet is always the one tokenize()
  // would pick.
  const reserved = new Set(Object.values(App.config.sym));
  const syms = [...sigmaSet].filter(s => !reserved.has(s)).sort((a, b) => b.length - a.length);
  if (!syms.length) return { mode: 'none' };

  const residue = (before.match(/[^,\s]*$/) || [''])[0];
  const priorStr = before.slice(0, before.length - residue.length);
  const priorTokens = tokenize(priorStr, sigmaSet);
  if (priorTokens === null) return { mode: 'error', residue: '', candidates: [], earlier: true, alphabetLabel };

  if (residue === '') {
    // eps goes last so it's never the Tab-default over a real symbol.
    const candidates = wholeFieldEmpty ? [...syms, eps] : syms;
    return { mode: 'palette', residue: '', candidates, allSyms: syms };
  }

  const candidates = syms.filter(s => ciStartsWith(s, residue));
  if (candidates.length === 1 && candidates[0] === residue) {
    // Residue already equals a complete symbol and nothing longer extends
    // it — there's nothing left to complete. Advance to the next-token
    // palette instead of re-suggesting the token just typed (this is what
    // lets clicking chips for a single-char alphabet like {0,1} chain:
    // without it, every symbol after the first would only ever match
    // itself and the popover would never offer the rest of Σ again).
    return { mode: 'palette', residue: '', candidates: syms, allSyms: syms };
  }
  if (candidates.length) return { mode: 'filter', residue, candidates, allSyms: syms };

  // Not a prefix of any symbol — but for concatenated alphabets (e.g. {0,1})
  // the residue itself may already fully decompose. That's valid, just with
  // nothing left to suggest, so it's quietly "none" rather than an error.
  if (tokenize(residue, sigmaSet) !== null) return { mode: 'none' };
  return { mode: 'error', residue, candidates: [], alphabetLabel };
}

// ── Machine-aware liveness (Simulate input only) ────────────────────
// Purely advisory: dims candidates that can't lead anywhere from the
// machine's *current* state set, without ever removing them from the
// palette or blocking selection — testing a string you expect to be
// rejected is a legitimate, common use of Simulate, so nothing here may
// narrow what's offered or interfere with typing/clicking.
//
// Only defined for machines whose step is a pure (state(s), symbol) →
// state(s) relation with no side channel (stack/tape) that would make
// "replay the already-typed prefix" diverge from what Run actually does:
// DFA, NFA/ε-NFA (state SET, ε-closed — "live" means *any* state in the
// set has an outgoing transition, matching NFA accept-if-any-branch-survives
// semantics), Moore/Mealy (deterministic, same shape as DFA). PDA/TM-family
// machines mutate a stack or tape as they step, so a "state after this
// prefix" can't be computed by replaying symbols alone — left alone
// entirely rather than guessing.
function isLiveAwareMachine(m = App.machine) {
  return m === 'DFA' || m === 'NFA' || m === 'ε-NFA' || m === 'Moore' || m === 'Mealy';
}

// Steps the ε-closed reachable state set forward by one symbol, using
// exactly the transition-matching rule simNFA/getSingleTapeDeterministicTransition
// use at Run time (including the Σ-wildcard). Works for both DFA (singleton
// set) and NFA (multi-state set) uniformly.
function stepLiveStates(states, sym) {
  let nx = new Set();
  states.forEach(sid => App.transitions
    .filter(t => t.from === sid && (t.symbol === sym || t.symbol === App.config.sym.any))
    .forEach(t => nx.add(t.to)));
  return epsClosure(nx);
}

// Replays `tokens` from the start state and returns the live reachable set
// just before the residue being typed — or null if the machine isn't
// liveness-aware, there's no start state, or the prefix itself doesn't
// tokenize (mirrors computeResidueState's own "earlier" error case, where
// liveness is meaningless because Run would already fail earlier).
function getLiveStateSet(priorTokens) {
  if (!isLiveAwareMachine() || !App.startId || priorTokens === null) return null;
  let cur = epsClosure(new Set([App.startId]));
  for (const sym of priorTokens) {
    cur = stepLiveStates(cur, sym);
    if (!cur.size) break; // already dead — every candidate will correctly show dead too
  }
  return cur;
}

// A symbol is "live" from a state set if *any* state in the set has a real
// outgoing transition on it (matches NFA's exists-a-surviving-branch
// semantics; for DFA the set is always a singleton so this degrades to the
// obvious deterministic check).
function isSymbolLive(states, sym) {
  return [...states].some(sid => App.transitions.some(t => t.from === sid && (t.symbol === sym || t.symbol === App.config.sym.any)));
}

// Reorders candidates so live symbols surface above dead ones — a stable
// partition, not a fresh sort: within "live" and within "dead" the existing
// longest-match/alphabetical order from computeResidueState is preserved,
// this just interleaves the two bands. ε is pinned at the end regardless
// (an existing invariant: it must never become the Tab-default over a real
// symbol), so it's excluded from the partition and re-appended.
function reorderByLiveness(candidates, liveSet) {
  const eps = App.config.sym.eps;
  const hasEps = candidates.includes(eps);
  const rest = hasEps ? candidates.filter(s => s !== eps) : candidates;
  const live = rest.filter(s => liveSet.has(s));
  const dead = rest.filter(s => !liveSet.has(s));
  const ordered = [...live, ...dead];
  return hasEps ? [...ordered, eps] : ordered;
}

function annotateLiveness(state, priorTokens) {
  if (state.mode !== 'palette' && state.mode !== 'filter') return state;
  const liveSet = getLiveStateSet(priorTokens);
  if (liveSet === null) return state;
  const liveCandidates = new Set(state.candidates.filter(s => s !== App.config.sym.eps && isSymbolLive(liveSet, s)));
  // Only reorder when the split is meaningful — an all-live or all-dead
  // palette has nothing to gain from reordering, and skipping it avoids
  // needlessly perturbing candidate order (and thus which chip is at index 0)
  // for machines/inputs where liveness never actually disagrees with anything.
  const nonEpsCount = state.candidates.filter(s => s !== App.config.sym.eps).length;
  if (liveCandidates.size > 0 && liveCandidates.size < nonEpsCount) {
    state.candidates = reorderByLiveness(state.candidates, liveCandidates);
  }
  state.liveSet = liveCandidates;
  return state;
}

function getSimSuggestState(el, sigmaSet = App.sigma, alphabetLabel = 'Σ') {
  const caret = el.selectionStart;
  const before = el.value.slice(0, caret);
  const state = computeResidueState(before, el.value.trim() === '', sigmaSet, alphabetLabel);
  if (state.mode === 'none') return state;
  state.prefixEnd = caret - state.residue.length;
  state.replaceEnd = caret;
  if (sigmaSet === App.sigma) {
    const priorStr = before.slice(0, state.prefixEnd);
    annotateLiveness(state, tokenize(priorStr, sigmaSet));
  }
  return state;
}

// Batch Test is a textarea: suggestions are scoped to the current line, plus
// a special case for the trailing "=> accept/reject" expectation syntax.
function getBatchSuggestState(el) {
  const value = el.value, caret = el.selectionStart;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineBefore = value.slice(lineStart, caret);

  const arrowMatch = lineBefore.match(/(=>|→)\s*([A-Za-z]*)$/);
  if (arrowMatch) {
    const partial = arrowMatch[2].toLowerCase();
    const candidates = ['accept', 'reject'].filter(o => o.startsWith(partial));
    if (!candidates.length) return { mode: 'none' };
    return {
      mode: 'filter', residue: arrowMatch[2], candidates, isKeyword: true,
      prefixEnd: caret - arrowMatch[2].length, replaceEnd: caret
    };
  }

  const state = computeResidueState(lineBefore, lineBefore.trim() === '');
  if (state.mode === 'none') return state;
  state.prefixEnd = lineStart + lineBefore.length - state.residue.length;
  state.replaceEnd = caret;
  return state;
}

// Grammar view: "String to parse" (CYK) / "String for ambiguity check" — both
// are validated at Run time by the exact same tokenize() call Simulate uses,
// just against the grammar's terminal set (Σ plus any terminal already used
// in a production) rather than Σ directly, so this is a straight reuse of
// getSimSuggestState with that alphabet swapped in.
function getGrammarSuggestState(el) {
  const terms = typeof getGrammarTerminals === 'function' ? getGrammarTerminals() : App.sigma;
  return getSimSuggestState(el, terms, 'Σ');
}

// ── Transition-modal Pop/Push/Write fields ──────────────────────────
// Γ candidates for Pop/Push: single-character stack-alphabet members only —
// applyPdaStoreTransition() pushes/pops Γ symbols one raw character at a
// time, so a multi-character Γ symbol would silently be split apart and
// corrupt the stack; suggesting one here would just hand the user a broken
// chip. Counter Machines further restrict Γ to their one counting symbol
// plus the stack bottom, mirroring confirmTrans()'s own validation
// (states-transitions.js) exactly, so nothing suggested here can fail that
// check on Add. ε and Σ (the wildcard) are excluded from the base list and
// added back explicitly by callers to avoid duplicate chips if either
// character ever ends up in Γ through the same lax add-symbol validation.
function getStackAlphabetCandidates() {
  const bottom = App.config.sym.stackBottom;
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  let base;
  if (isCounterMachine(App.machine)) {
    const counterSym = [...App.stackAlpha].find(s => s !== bottom) || '1';
    base = [counterSym, bottom];
  } else {
    base = [...App.stackAlpha].filter(s => s.length === 1);
  }
  return [...new Set(base)].filter(s => s !== eps && s !== any).sort();
}

// multiToken=false → Pop/Pop₂: exactly one symbol, or ε, or Σ (wildcard) —
//   selecting any candidate replaces the field's entire value.
// multiToken=true  → Push/Push₂: an append-only chain of single Γ
//   characters (no separator — Run time concatenates them raw), or the
//   field can instead be exactly ε or Σ as a whole.
function getStackSymbolSuggestState(el, multiToken) {
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  const value = el.value;
  const trimmed = value.trim();
  if (trimmed === eps || /^(eps|epsilon)$/i.test(trimmed) || trimmed === any) return { mode: 'none' };

  const syms = getStackAlphabetCandidates();
  if (!syms.length) return { mode: 'none' };
  const wholeFieldSymbols = new Set([eps, any]);

  if (!multiToken) {
    if (trimmed === '') {
      return { mode: 'palette', candidates: [...syms, any, eps], allSyms: syms, prefixEnd: 0, replaceEnd: value.length, alphabetLabel: 'Γ', wholeFieldSymbols };
    }
    if (syms.includes(trimmed)) return { mode: 'none' };
    const candidates = syms.filter(s => ciStartsWith(s, trimmed));
    if (candidates.length) return { mode: 'filter', residue: trimmed, candidates, allSyms: syms, prefixEnd: 0, replaceEnd: value.length, alphabetLabel: 'Γ', wholeFieldSymbols };
    return { mode: 'error', residue: trimmed, candidates: [], alphabetLabel: 'Γ' };
  }

  // Push: every character typed so far must be a legal single Γ symbol; the
  // palette is always the full candidate list so the next chip click appends.
  if (trimmed === '') {
    return { mode: 'palette', candidates: [...syms, any, eps], allSyms: syms, prefixEnd: value.length, replaceEnd: value.length, alphabetLabel: 'Γ', wholeFieldSymbols };
  }
  const invalid = [...new Set([...value].filter(c => !syms.includes(c)))];
  if (invalid.length) return { mode: 'error', residue: invalid.join(', '), candidates: [], alphabetLabel: 'Γ' };
  return { mode: 'palette', candidates: syms, allSyms: syms, prefixEnd: value.length, replaceEnd: value.length, alphabetLabel: 'Γ', wholeFieldSymbols };
}

// Σ candidates for Write/per-tape-Write: Σ plus the tape blank (⊔) — both are
// meaningful things to write — and Σ-the-wildcard (write back whatever was
// read). No ε: an epsilon *character* written onto the tape isn't a
// supported concept the way an epsilon *pop* is, so it's never offered here.
function getWriteSymbolSuggestState(el) {
  const any = App.config.sym.any;
  const blank = App.config.sym.blank;
  const value = el.value;
  const trimmed = value.trim();
  if (trimmed === any) return { mode: 'none' };

  const reserved = new Set(Object.values(App.config.sym));
  reserved.delete(blank); // blank is a meaningful write target despite being a reserved marker
  const syms = [...new Set([...App.sigma, blank])].filter(s => !reserved.has(s)).sort((a, b) => b.length - a.length);
  if (!syms.length) return { mode: 'none' };
  const wholeFieldSymbols = new Set([any]);

  if (trimmed === '') {
    return { mode: 'palette', candidates: [...syms, any], allSyms: syms, prefixEnd: 0, replaceEnd: value.length, alphabetLabel: 'Σ', wholeFieldSymbols };
  }
  if (syms.includes(trimmed)) return { mode: 'none' };
  const candidates = syms.filter(s => ciStartsWith(s, trimmed));
  if (candidates.length) return { mode: 'filter', residue: trimmed, candidates, allSyms: syms, prefixEnd: 0, replaceEnd: value.length, alphabetLabel: 'Σ', wholeFieldSymbols };
  return { mode: 'error', residue: trimmed, candidates: [], alphabetLabel: 'Σ' };
}

const GRAMMAR_STRING_FIELD_IDS = new Set(['cyk-in', 'ambig-in']);
const STACK_POP_FIELD_IDS = new Set(['m-pop', 'm-pop2']);
const STACK_PUSH_FIELD_IDS = new Set(['m-push', 'm-push2']);

// Routes a field to the right state-builder by id. m-mtm-write-${i} fields
// are generated dynamically (states-transitions.js) so they're matched by
// pattern rather than listed individually. Fields not listed here fall
// through to the default Σ/tokenize()-based getSimSuggestState — this covers
// the Algorithms view's other "test a string against the current machine"
// inputs (eq-str, npda-input, ndtm-input, nfa-tree-input), which all validate
// exactly the same way Simulate's sim-in does.
function getSuggestStateForField(el) {
  const id = el.id;
  if (id === 'batch-in') return getBatchSuggestState(el);
  if (GRAMMAR_STRING_FIELD_IDS.has(id)) return getGrammarSuggestState(el);
  if (STACK_POP_FIELD_IDS.has(id)) return getStackSymbolSuggestState(el, false);
  if (STACK_PUSH_FIELD_IDS.has(id)) return getStackSymbolSuggestState(el, true);
  if (id === 'm-write' || /^m-mtm-write-\d+$/.test(id)) return getWriteSymbolSuggestState(el);
  return getSimSuggestState(el);
}

// Caret-only refresh (click/keyup navigation): respects a prior Escape
// dismissal so moving the cursor around doesn't pop the popover back open.
function refreshSymSuggest(el) {
  if (!el || document.activeElement !== el) { hideSymSuggest(); return; }
  if (SymSuggest.suppressed) return;
  const state = getSuggestStateForField(el);
  if (state.mode === 'none') { hideSymSuggest(); return; }
  SymSuggest.target = el;
  SymSuggest.state = state;
  SymSuggest.activeIdx = 0;
  renderSymSuggest(el, state);
}

// Typing or (re)focusing is an active signal to show suggestions again,
// overriding any earlier Escape dismissal.
function handleSymSuggestActive(el) {
  SymSuggest.suppressed = false;
  refreshSymSuggest(el);
}

// keyup always follows keydown, even when the keydown handler called
// preventDefault(). Arrow-cycling already applied its effect (and nothing
// about the text changed), so a keyup-triggered refresh would just
// recompute the same state and reset the cycle position back to 0 — skip
// the one keyup that corresponds to an arrow press trySymSuggestKeydown
// already handled.
function handleSymSuggestKeyup(el) {
  if (SymSuggest.skipNextKeyup) { SymSuggest.skipNextKeyup = false; return; }
  refreshSymSuggest(el);
}

function hideSymSuggest() {
  const pop = $('sym-suggest');
  if (pop) pop.style.display = 'none';
  if (SymSuggest.target) SymSuggest.target.classList.remove('sim-input-err');
  SymSuggest.target = null;
  SymSuggest.state = null;
}

function dismissSymSuggest() {
  SymSuggest.suppressed = true;
  hideSymSuggest();
}

function renderSymSuggest(el, state) {
  const pop = $('sym-suggest');
  const chipsEl = $('sym-suggest-chips');
  const statusEl = $('sym-suggest-status');
  if (!pop || !chipsEl || !statusEl) return;

  if (state.mode === 'error') {
    el.classList.add('sim-input-err');
    chipsEl.style.display = 'none';
    chipsEl.innerHTML = '';
    statusEl.className = 'sym-suggest-status err';
    const label = state.alphabetLabel || 'Σ';
    statusEl.textContent = state.earlier
      ? `Earlier input doesn’t match ${label}`
      : `"${state.residue}" doesn’t match any symbol in ${label}`;
  } else {
    el.classList.remove('sim-input-err');
    chipsEl.style.display = 'flex';
    chipsEl.innerHTML = state.candidates.map((s, i) => {
      const isEps = s === App.config.sym.eps;
      const label = isEps ? 'ε' : escapeHtml(s);
      // liveSet is advisory-only: a symbol missing from it just means no
      // transition exists from the current state(s), which merely dims the
      // chip — it stays fully clickable/Tab-able like any other candidate,
      // since testing a string expected to be rejected is a normal thing to do.
      const isDead = state.liveSet && !isEps && !state.liveSet.has(s);
      const title = isEps ? 'Empty string' : (isDead ? 'No transition from the current state — would dead-end here' : '');
      return `<button type="button" class="chip sugg-chip${i === SymSuggest.activeIdx ? ' active' : ''}${isEps ? ' sugg-eps' : ''}${isDead ? ' sugg-dead' : ''}"
        onmousedown="event.preventDefault(); acceptSuggestion(${i})" data-tip="${title}">${label}</button>`;
    }).join('');
    statusEl.className = 'sym-suggest-status';
    updateSuggestStatusHint(state);
  }

  pop.style.display = 'block';
  positionSymSuggest(el);
}

function updateSuggestStatusHint(state) {
  const statusEl = $('sym-suggest-status');
  if (!statusEl || state.mode === 'error') return;
  const active = state.candidates && state.candidates[SymSuggest.activeIdx];
  const activeIsDead = state.liveSet && active && active !== App.config.sym.eps && !state.liveSet.has(active);
  if (activeIsDead) {
    statusEl.textContent = `“${active}” has no transition from here — would dead-end the simulation`;
    return;
  }
  statusEl.textContent = (state.mode === 'filter' && state.candidates.length)
    ? `Tab ↹ to insert “${state.candidates[SymSuggest.activeIdx]}”` : '';
}

// Moves the highlighted candidate without a full re-render (keeps hover
// state intact, scrolls the new pick into view if the chip list overflows).
function setActiveSuggestIdx(idx) {
  const chipsEl = $('sym-suggest-chips');
  if (!chipsEl) return;
  SymSuggest.activeIdx = idx;
  [...chipsEl.children].forEach((c, i) => c.classList.toggle('active', i === idx));
  const chip = chipsEl.children[idx];
  if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateSuggestStatusHint(SymSuggest.state);
}

function positionSymSuggest(el) {
  const pop = $('sym-suggest');
  const r = el.getBoundingClientRect();
  const margin = 8;
  const width = Math.max(r.width, 200);
  pop.style.width = width + 'px';
  pop.style.left = Math.max(margin, Math.min(r.left, innerWidth - width - margin)) + 'px';

  const spaceBelow = innerHeight - r.bottom;
  if (spaceBelow < 100 && r.top > 100) {
    pop.style.top = 'auto';
    pop.style.bottom = (innerHeight - r.top + 6) + 'px';
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = (r.bottom + 6) + 'px';
  }
}

function acceptSuggestion(idx) {
  const el = SymSuggest.target;
  const state = SymSuggest.state;
  if (!el || !state || !state.candidates || !state.candidates[idx]) return;
  const symbol = state.candidates[idx];
  const eps = App.config.sym.eps;
  const value = el.value;
  let newValue, newCaret;
  SymSuggest.suppressed = false;

  const wholeFieldSymbols = state.wholeFieldSymbols || new Set([eps]);

  if (state.isKeyword) {
    newValue = value.slice(0, state.prefixEnd) + symbol + value.slice(state.replaceEnd);
    newCaret = state.prefixEnd + symbol.length;
  } else if (wholeFieldSymbols.has(symbol)) {
    // ε (and, for Pop/Push/Write, the Σ wildcard) stands for the field's
    // entire value, so it replaces the current line (batch) / whole field
    // (everything else) rather than being appended.
    const lineStart = value.lastIndexOf('\n', state.prefixEnd - 1) + 1;
    let lineEnd = value.indexOf('\n', state.prefixEnd);
    if (lineEnd === -1) lineEnd = value.length;
    newValue = value.slice(0, lineStart) + symbol + value.slice(lineEnd);
    newCaret = lineStart + symbol.length;
  } else {
    const after = value.slice(state.replaceEnd);
    const needsSep = (state.allSyms || [...App.sigma]).some(s => s.length > 1 && s !== eps);
    const sep = (needsSep && !/^[,\s]/.test(after)) ? ' ' : '';
    newValue = value.slice(0, state.prefixEnd) + symbol + sep + after;
    newCaret = state.prefixEnd + symbol.length + sep.length;
  }

  el.value = newValue;
  el.focus();
  el.setSelectionRange(newCaret, newCaret);
  refreshSymSuggest(el);
}

// Returns true if the key was consumed by the suggestion popover, so callers
// (handleSimInputKeydown / handleBatchInputKeydown) can bail out early.
// Enter and ArrowUp/ArrowDown are deliberately left untouched — Enter always
// runs the simulation and Up/Down always recall input history, popover open
// or not.
function trySymSuggestKeydown(e) {
  if (SymSuggest.target !== e.target || !SymSuggest.state) return false;
  const state = SymSuggest.state;
  if (e.key === 'Escape') {
    e.preventDefault();
    dismissSymSuggest();
    return true;
  }
  if (e.key === 'Tab' && state.candidates && state.candidates.length) {
    e.preventDefault();
    acceptSuggestion(SymSuggest.activeIdx);
    return true;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.candidates && state.candidates.length > 1) {
    // Only steal the arrow when the caret sits at the very end of the text
    // being edited (end of the field for Simulate, end of the current line
    // for Batch Test) — everywhere else, arrows keep moving the caret as
    // normal, so editing an earlier part of the string is unaffected.
    const el = e.target;
    let textEnd = el.value.length;
    if (el.id === 'batch-in') {
      const nl = el.value.indexOf('\n', el.selectionStart);
      textEnd = nl === -1 ? el.value.length : nl;
    }
    const atCompletionPoint = el.selectionStart === el.selectionEnd && el.selectionStart === textEnd;
    if (atCompletionPoint) {
      e.preventDefault();
      const n = state.candidates.length;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      setActiveSuggestIdx(((SymSuggest.activeIdx + dir) % n + n) % n);
      SymSuggest.skipNextKeyup = true;
      return true;
    }
  }
  return false;
}

function handleBatchInputKeydown(e) {
  trySymSuggestKeydown(e);
}

window.addEventListener('resize', () => { if (SymSuggest.target) hideSymSuggest(); });
// Capture-phase so any ancestor scrolling (which would strand the popover's
// fixed position) dismisses it — except a scroll that originates from inside
// the popover itself (i.e. the candidate-chip list scrolling), which should
// just scroll in place rather than close the thing being scrolled.
document.addEventListener('scroll', (e) => {
  if (!SymSuggest.target) return;
  const pop = $('sym-suggest');
  if (pop && pop.contains(e.target)) return;
  hideSymSuggest();
}, true);
