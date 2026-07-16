// ══════════════════════════════════════════════════════════════════
//  SYMBOL SUGGEST — Σ-aware autocomplete for the Simulate / Batch Test inputs
//
//  As the user types, the trailing "residue" (the not-yet-delimited chunk
//  right before the caret) is matched against Σ using the same longest-match
//  backtracking that tokenize() uses at Run time, so what's suggested here is
//  always exactly what would tokenize successfully. Candidates render as
//  chips; clicking or Tab inserts one and — for word alphabets — appends the
//  delimiter tokenize() expects, so clicking chips sequentially builds a
//  valid test string.
// ══════════════════════════════════════════════════════════════════
const SymSuggest = { target: null, state: null, suppressed: false, activeIdx: 0 };

// Matches Σ against the trailing non-delimiter run of `before`. Delimiters
// (comma/whitespace) mirror tokenize()'s own segmentation so a symbol that's
// mid-completion here is exactly what would be mid-segment there.
function computeResidueState(before, wholeFieldEmpty) {
  const eps = App.config.sym.eps;
  // A bare ε (from the eps chip, or "eps"/"epsilon" resolved by parseEps at
  // Run time) means "empty string" and is complete the moment it's typed.
  if (before.trim() === eps) return { mode: 'none' };

  const syms = [...App.sigma].filter(s => s !== eps);
  if (!syms.length) return { mode: 'none' };

  const residue = (before.match(/[^,\s]*$/) || [''])[0];
  const priorStr = before.slice(0, before.length - residue.length);
  const priorTokens = tokenize(priorStr);
  if (priorTokens === null) return { mode: 'error', residue: '', candidates: [], earlier: true };

  if (residue === '') {
    // eps goes last so it's never the Tab-default over a real symbol.
    const candidates = wholeFieldEmpty ? [...syms, eps] : syms;
    return { mode: 'palette', residue: '', candidates };
  }

  const candidates = syms.filter(s => s.startsWith(residue));
  if (candidates.length === 1 && candidates[0] === residue) {
    // Residue already equals a complete symbol and nothing longer extends
    // it — there's nothing left to complete. Advance to the next-token
    // palette instead of re-suggesting the token just typed (this is what
    // lets clicking chips for a single-char alphabet like {0,1} chain:
    // without it, every symbol after the first would only ever match
    // itself and the popover would never offer the rest of Σ again).
    return { mode: 'palette', residue: '', candidates: syms };
  }
  if (candidates.length) return { mode: 'filter', residue, candidates };

  // Not a prefix of any symbol — but for concatenated alphabets (e.g. {0,1})
  // the residue itself may already fully decompose. That's valid, just with
  // nothing left to suggest, so it's quietly "none" rather than an error.
  if (tokenize(residue) !== null) return { mode: 'none' };
  return { mode: 'error', residue, candidates: [] };
}

function getSimSuggestState(el) {
  const caret = el.selectionStart;
  const before = el.value.slice(0, caret);
  const state = computeResidueState(before, el.value.trim() === '');
  if (state.mode === 'none') return state;
  state.prefixEnd = caret - state.residue.length;
  state.replaceEnd = caret;
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

// Caret-only refresh (click/keyup navigation): respects a prior Escape
// dismissal so moving the cursor around doesn't pop the popover back open.
function refreshSymSuggest(el) {
  if (!el || document.activeElement !== el) { hideSymSuggest(); return; }
  if (SymSuggest.suppressed) return;
  const state = el.id === 'batch-in' ? getBatchSuggestState(el) : getSimSuggestState(el);
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
    statusEl.textContent = state.earlier
      ? 'Earlier input doesn’t match Σ'
      : `"${state.residue}" doesn’t match any symbol in Σ`;
  } else {
    el.classList.remove('sim-input-err');
    chipsEl.style.display = 'flex';
    chipsEl.innerHTML = state.candidates.map((s, i) => {
      const isEps = s === App.config.sym.eps;
      const label = isEps ? 'ε' : s;
      return `<button type="button" class="chip sugg-chip${i === SymSuggest.activeIdx ? ' active' : ''}${isEps ? ' sugg-eps' : ''}"
        onmousedown="event.preventDefault(); acceptSuggestion(${i})" title="${isEps ? 'Empty string' : ''}">${label}</button>`;
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

  if (state.isKeyword) {
    newValue = value.slice(0, state.prefixEnd) + symbol + value.slice(state.replaceEnd);
    newCaret = state.prefixEnd + symbol.length;
  } else if (symbol === eps) {
    // ε stands for the whole (empty) string, so it replaces the current
    // line (batch) / whole field (sim) rather than being appended.
    const lineStart = value.lastIndexOf('\n', state.prefixEnd - 1) + 1;
    let lineEnd = value.indexOf('\n', state.prefixEnd);
    if (lineEnd === -1) lineEnd = value.length;
    newValue = value.slice(0, lineStart) + eps + value.slice(lineEnd);
    newCaret = lineStart + eps.length;
  } else {
    const after = value.slice(state.replaceEnd);
    const needsSep = [...App.sigma].some(s => s.length > 1 && s !== eps);
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
document.addEventListener('scroll', () => { if (SymSuggest.target) hideSymSuggest(); }, true);
