import { renderGramSyms } from './algorithms-cfg.js';
import { flagsUsed } from './guards.js';
import { commit } from './history.js';
import { flattenComponent } from './superstates.js';
import { updateLPanelSectionMeta, updateRPanel } from './render.js';
import { $, activeComponentId, App, isBoundarySymbol, isBoundaryTapeMachine } from './state.js';
import { Change, subscribe } from './store.js';
import { escapeHtml, jsAttr, showStatus } from './utils.js';

subscribe(Change.ALPHABET, renderSigma);
subscribe(Change.ALPHABET, renderGamma);
subscribe(Change.ALPHABET, renderOutputAlpha);
subscribe(Change.ALPHABET, renderFlags);
// A flag is declared once and used on arrows anywhere in the tree, so the
// used/declared reconciliation below has to redraw when the graph changes too.
subscribe(Change.GRAPH, renderFlags);

// ══════════════════════════════════════════════════════════════════
//  ALPHABET
// ══════════════════════════════════════════════════════════════════
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
  c.innerHTML = [...App.sigma].map(s => `<div class="chip">${escapeHtml(s)}<span class="x" onclick="delSym(${jsAttr(s)})"><svg viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span></div>`).join('')
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
      return `<div class="chip" ${style}${title}>${escapeHtml(s)}${(isBottom || isBoundary) ? '' : `<span class="x" onclick="delGSym(${jsAttr(s)})"><svg viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span>`}</div>`;
    }).join('') || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}
export function addOutSym() {
  const v = $('outsym-in').value.trim(); if (!v) return;
  v.split(/[,\s]+/).forEach(s => { if (s) App.outputAlpha.add(s); });
  $('outsym-in').value = ''; renderOutputAlpha();
}
export function delOutSym(s) { App.outputAlpha.delete(s); renderOutputAlpha(); }

// ══════════════════════════════════════════════════════════════════
//  FLAGS
// ══════════════════════════════════════════════════════════════════
// The fourth declaration surface, and the only one whose size is a cost rather
// than a vocabulary: each flag doubles the flattened machine. The panel says so
// out loud, because "add one more boolean" is the edit whose price is invisible
// in the picture and visible only after flattening.
//
// App.flags is an ARRAY: declaration order is the bit order of the valuation
// key, so the same valuation reached two ways has to produce the same flat id.
// Adding a flag therefore appends; it never re-sorts.

const FLAG_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Every arrow in the tree, not just the one component on canvas — a flag is
// declared once and used anywhere. The live arrays win for the active
// component, since App.components[active] is a cache that may be stale
// (see the COMPONENTS note in state.js: readers flush, writers don't).
function everyTransition() {
  if (!App.components?.length) return App.transitions || [];
  const active = activeComponentId();
  const out = [];
  for (const c of App.components) {
    for (const t of (c.id === active ? App.transitions : c.transitions) || []) out.push(t);
  }
  return out;
}

export function addFlag() {
  const inp = $('flag-in');
  const v = (inp?.value || '').trim();
  if (!v) return;
  const bad = [];
  let added = 0;
  for (const raw of v.split(/[,\s]+/)) {
    const f = raw.trim();
    if (!f) continue;
    if (!FLAG_RE.test(f)) { bad.push(f); continue; }
    if (App.flags.includes(f)) continue;
    App.flags.push(f);
    added++;
  }
  if (inp) inp.value = '';
  if (added) commit(Change.ALPHABET);
  else renderFlags();
  if (bad.length) showStatus(`Not a flag name: ${bad.join(', ')} — letters, digits and _ only, not starting with a digit.`);
}

/** Declare a flag some arrow already mentions. The one-click fix for the
 *  validator's "used but never declared". */
export function declareFlag(f) {
  if (!f || App.flags.includes(f)) return;
  App.flags.push(f);
  commit(Change.ALPHABET);
}

export function delFlag(f) {
  const i = App.flags.indexOf(f);
  if (i === -1) return;
  App.flags.splice(i, 1);
  commit(Change.ALPHABET);
  // Deliberately does NOT rewrite the arrows that name it. An undeclared flag
  // reads false everywhere (see evalGuard), so those arrows are disabled rather
  // than broken, the validator says which ones, and re-declaring undoes it.
  const orphans = [...flagsUsed(everyTransition())].filter(u => !App.flags.includes(u));
  if (orphans.includes(f)) showStatus(`'${f}' is still used on some arrows — they now read it as false. Re-add it to re-enable them.`);
}

export function renderFlags() {
  const c = $('flag-chips');
  if (!c) return;
  const declared = App.flags || [];
  // Hidden for every machine that has no guards; skip the whole-tree walk
  // rather than parsing every arrow on every graph change for nothing.
  const shown = $('flags-sec') && $('flags-sec').style.display !== 'none';
  const used = shown ? flagsUsed(everyTransition()) : new Set();

  const chips = declared.map(f => {
    const unused = shown && !used.has(f);
    const tip = unused ? ' data-tip="Declared but never used — it doubles the flattened machine for nothing"' : '';
    const style = unused ? ' style="color:var(--text3)"' : '';
    return `<div class="chip"${style}${tip}>${escapeHtml(f)}<span class="x" onclick="delFlag(${jsAttr(f)})"><svg viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span></div>`;
  });

  for (const f of used) {
    if (declared.includes(f)) continue;
    chips.push(`<div class="chip chip-undeclared" onclick="declareFlag(${jsAttr(f)})" data-tip="Used on an arrow but never declared, so it reads false everywhere — click to declare">${escapeHtml(f)}<span class="x">+</span></div>`);
  }

  c.innerHTML = chips.join('') || '<div class="empty-msg">Add flags</div>';

  renderFlatCost(shown, declared.length);
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}

/**
 * The price of the declarations above, as the number it actually is.
 *
 * "n flags → x2^n" is the worst case and is almost never what you get: the
 * product is reachability-driven, so most valuations of most states are never
 * reached. Showing the real flattened size turns the succinctness claim into a
 * gauge you can watch move as you draw — and turns the maxFlatStates ceiling
 * from an invisible failure into a bar filling up.
 */
function renderFlatCost(shown, flagCount) {
  const cost = $('flag-cost');
  if (!cost) return;
  if (!shown) { cost.textContent = ''; cost.className = 'flag-cost'; return; }

  const drawn = (App.states || []).filter(s => !s.super).length;
  let flat = null, truncated = false;
  try {
    const f = flattenComponent({
      states: App.states, transitions: App.transitions,
      startId: App.startId, accepts: App.accepts
    });
    flat = f.states.length;
    truncated = !!f.truncated;
  } catch (e) { /* a half-drawn machine is not an error worth reporting here */ }

  const budget = App.config.maxFlatStates || 4000;
  const flagNote = flagCount
    ? `${flagCount} flag${flagCount === 1 ? '' : 's'} · `
    : '';
  cost.className = 'flag-cost' + (truncated ? ' flag-cost-over' : '');
  if (flat === null) { cost.textContent = ''; return; }
  cost.textContent = truncated
    ? `${flagNote}flattening exceeded ${budget} states — the simulator is answering for a TRUNCATED machine. Raise “Max Flattened States” in Settings → Hierarchical.`
    : `${flagNote}${drawn} drawn → ${flat} flat state${flat === 1 ? '' : 's'}${flat > budget * 0.6 ? ` of ${budget}` : ''}`;
}

export function renderOutputAlpha() {
  const c = $('output-chips');
  c.innerHTML = [...App.outputAlpha].map(s => `<div class="chip">${escapeHtml(s)}<span class="x" onclick="delOutSym(${jsAttr(s)})"><svg viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span></div>`).join('')
    || '<div class="empty-msg">Add symbols</div>';
  if (typeof updateLPanelSectionMeta === 'function') updateLPanelSectionMeta();
}

