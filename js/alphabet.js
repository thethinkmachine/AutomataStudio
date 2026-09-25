import { renderGramSyms } from './grammar-ui.js';
import { updateLPanelSectionMeta, updateRPanel } from './render.js';
import { $, App, getMachineConfig, isBoundarySymbol, isBoundaryTapeMachine } from './state.js';
import { Change, subscribe } from './store.js';
import { escapeHtml, isAnyTM, jsAttr, showStatus } from './utils.js';

subscribe(Change.ALPHABET, renderSigma);
subscribe(Change.ALPHABET, renderGamma);
subscribe(Change.ALPHABET, renderOutputAlpha);
// Σ is shared with the Grammar workbench: a symbol added here is a terminal a
// word can be typed over there.
subscribe(Change.ALPHABET, renderGramSyms);

// ══════════════════════════════════════════════════════════════════
//  ALPHABET
// ══════════════════════════════════════════════════════════════════

// ── which alphabets the machine has ───────────────────────────────
//
// Σ, Γ and Δ are rows of one section rather than three sections: a PDT used to
// open on three near-identical headers before its first state, each with its
// own collapse, grip and pop-out for a field of chips nobody pulls out alone.
// The rows keep the ids the sections had (`stack-sec`, `output-sec`), so a
// test or a stale layout that asks for them by name still finds them.
//
// This is the one place that decides which rows show and what they are
// called. The machine switch and the undo path each carried a copy, and the
// copies had already drifted — one relabelled Γ for a Turing machine and the
// other did not.
export function syncAlphabetSection(m = App.machine) {
  const cfg = getMachineConfig(m);
  const stack = $('stack-sec');
  const output = $('output-sec');
  if (stack) stack.style.display = cfg.hasStack ? '' : 'none';
  if (output) output.style.display = cfg.isTransducer ? '' : 'none';
  const stackLbl = $('stack-sec-lbl');
  if (stackLbl) stackLbl.innerHTML = `${isAnyTM(m) ? 'Tape' : 'Stack'} <span class="sym">Γ</span>`;

  // One row reads as it always did — "Alphabet Σ" with its count in the
  // header — and the row's own label would only repeat the title. Two or more
  // and the header names the set while each row names itself.
  const multi = !!(cfg.hasStack || cfg.isTransducer);
  const sec = $('lp-alphabet');
  if (sec && sec.classList) sec.classList.toggle('is-multi', multi);
  const title = $('lp-alphabet-title');
  if (title) title.innerHTML = multi ? 'Alphabets' : 'Alphabet <span class="sym">Σ</span>';
}

// ── the remove control on a chip ──────────────────────────────────
//
// A <button>, and written once rather than three times. It was a
// `<span class="x" onclick=…>` inline in each of the three renderers below,
// which cost it two things at once: no keyboard could reach it — the same
// half of a control rowActions() in js/render.js found missing on the list
// rows, here on the only destructive control Σ, Γ and Δ have — and a screen
// reader had nothing to announce it as, because an SVG with no title inside a
// span with no role is not a control at all.
//
// The name says which symbol goes. "Remove" repeated down a row of chips
// names the button and not the thing it acts on.
const REMOVE_ICON = '<svg viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

function chipRemove(fn, sym) {
  // jsAttr already runs escapeHtml over the JSON literal — see js/utils.js.
  return `<button type="button" class="x" onclick="${fn}(${jsAttr(sym)})" `
    + `aria-label="Remove ${escapeHtml(sym)}" data-tip="Remove ${escapeHtml(sym)}">`
    + `${REMOVE_ICON}</button>`;
}

export function addSym() {
  const v = $('sym-in').value.trim(); if (!v) return;
    const blocked = [];
    v.split(/[,\s]+/).forEach(s => {
      if (!s) return;
      if (isBoundarySymbol(s)) { blocked.push(s); return; }
      App.sigma.add(s);
    });
  $('sym-in').value = ''; renderSigma(); updateRPanel(); renderGramSyms();
    if (blocked.length && typeof showStatus === 'function') showStatus('Boundary markers are reserved and cannot be added to Σ.');
}
  export function delSym(s) { 
    App.sigma.delete(s); 
    renderSigma(); 
    renderGramSyms();
  }
export function renderSigma() {
  const c = $('sigma-chips');
  c.innerHTML = [...App.sigma].map(s => `<div class="chip">${escapeHtml(s)}${chipRemove('delSym', s)}</div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}
export function addGSym() {
  const v = $('gsym-in').value.trim(); if (!v) return;
    const blocked = [];
    v.split(/[,\s]+/).forEach(s => {
      if (!s) return;
      if (isBoundarySymbol(s)) { blocked.push(s); return; }
      App.stackAlpha.add(s);
    });
  $('gsym-in').value = ''; renderGamma();
    if (blocked.length && typeof showStatus === 'function') showStatus('Boundary markers are reserved for the tape boundary and were not added here.');
}
  export function delGSym(s) { 
    if (isBoundaryTapeMachine(App.machine) && isBoundarySymbol(s)) return; 
    App.stackAlpha.delete(s); 
    renderGamma(); 
  }
export function renderGamma() {
  const c = $('gamma-chips');
    c.innerHTML = [...App.stackAlpha].map(s => {
      const isBottom = s === App.config.sym.stackBottom;
      const isBoundary = isBoundaryTapeMachine(App.machine) && isBoundarySymbol(s);
      const style = isBottom ? 'style="color:var(--green)"' : (isBoundary ? 'style="color:var(--gold)"' : '');
      const title = isBoundary ? ` data-tip="${s === App.config.sym.leftMarker ? 'Left boundary marker' : 'Right boundary marker'}"` : '';
      return `<div class="chip" ${style}${title}>${escapeHtml(s)}${(isBottom || isBoundary) ? '' : chipRemove('delGSym', s)}</div>`;
    }).join('') || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}
export function addOutSym() {
  const v = $('outsym-in').value.trim(); if (!v) return;
  v.split(/[,\s]+/).forEach(s => { if (s) App.outputAlpha.add(s); });
  $('outsym-in').value = ''; renderOutputAlpha();
}
export function delOutSym(s) { App.outputAlpha.delete(s); renderOutputAlpha(); }
export function renderOutputAlpha() {
  const c = $('output-chips');
  c.innerHTML = [...App.outputAlpha].map(s => `<div class="chip">${escapeHtml(s)}${chipRemove('delOutSym', s)}</div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}

