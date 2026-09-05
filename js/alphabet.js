import { renderGramSyms } from './grammar-ui.js';
import { updateLPanelSectionMeta, updateRPanel } from './render.js';
import { $, App, isBoundarySymbol, isBoundaryTapeMachine } from './state.js';
import { Change, subscribe } from './store.js';
import { escapeHtml, jsAttr, showStatus } from './utils.js';

subscribe(Change.ALPHABET, renderSigma);
subscribe(Change.ALPHABET, renderGamma);
subscribe(Change.ALPHABET, renderOutputAlpha);
// Σ is shared with the Grammar workbench: a symbol added here is a terminal a
// word can be typed over there.
subscribe(Change.ALPHABET, renderGramSyms);

// ══════════════════════════════════════════════════════════════════
//  ALPHABET
// ══════════════════════════════════════════════════════════════════

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

