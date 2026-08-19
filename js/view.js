import { renderGramSyms, renderGrammarLPanel, renderGrammarView } from './algorithms-cfg.js';
import { renderAlgo } from './algorithms-fa.js';
import { renderGamma, renderOutputAlpha, renderSigma } from './alphabet.js';
import { wrap } from './canvas.js';
import { snapshot } from './history.js';
import { anyModalOpen, closeModal, showOverlay } from './modal.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { resetSim } from './simulation.js';
import { $, App, getMachineConfig, normalizeBoundarySymbolsForMachine } from './state.js';
import { Change, emit } from './store.js';
import { renderReferenceView } from './reference.js';
import { renderTabs, updateMobilePanelChrome, updateModelPickerLabels } from './ui.js';
import { clearAll, isAnyTM, isCounterMachine, showStatus } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  VIEW MANAGEMENT
// ══════════════════════════════════════════════════════════════════
//  Build is the application itself, not one destination among four: the canvas
//  is always mounted and never torn down. The auxiliary views (algo, grammar,
//  reference) render as overlays on top of it.
//
//  setView() stays the single entry point for view changes, so the many
//  `setView('build')` calls that algorithms make to reveal their result on the
//  canvas keep working — they now dismiss the overlay instead of swapping a
//  pane.
export const AUX_VIEWS = ['algo', 'grammar', 'reference'];

// Identity for the shared modal chrome. The subtitle names what the view
// actually operates on, which is otherwise only discoverable by reading it.
export const AUX_META = {
  algo: {
    title: 'Algorithms',
    sub: 'Constructions, conversions and decision procedures',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M200,152a31.84,31.84,0,0,0-19.53,6.68l-23.11-18A31.65,31.65,0,0,0,160,128c0-.74,0-1.48-.08-2.21l13.23-4.41A32,32,0,1,0,168,104c0,.74,0,1.48.08,2.21l-13.23,4.41A32,32,0,0,0,128,96a32.59,32.59,0,0,0-5.27.44L115.89,81A32,32,0,1,0,96,88a32.59,32.59,0,0,0,5.27-.44l6.84,15.4a31.92,31.92,0,0,0-8.57,42.16L73.83,169.22A32.08,32.08,0,1,0,84.66,181l25.71-24.1a31.87,31.87,0,0,0,35.63-1.53l23.11,18A31.65,31.65,0,0,0,168,184a32,32,0,1,0,32-32Z"/></svg>'
  },
  grammar: {
    title: 'Grammar',
    sub: 'G = (V, Σ, R, S) · context-free grammar workbench',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M208,24H72A32,32,0,0,0,40,56V224a8,8,0,0,0,8,8H192a8,8,0,0,0,0-16H56a16,16,0,0,1,16-16H208a8,8,0,0,0,8-8V32A8,8,0,0,0,208,24Zm-8,160H72a31.82,31.82,0,0,0-16,4.29V56A16,16,0,0,1,72,40H200Z"/></svg>'
  },
  reference: {
    title: 'Automata Reference',
    sub: 'Every machine this app can build, defined and explained',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M251.76,88.94l-120-64a8,8,0,0,0-7.52,0l-120,64a8,8,0,0,0,0,14.12L32,117.87v48.42a15.91,15.91,0,0,0,4.06,10.65C49.16,191.53,78.51,216,128,216a130,130,0,0,0,48-8.76V240a8,8,0,0,0,16,0V199.51a115.63,115.63,0,0,0,27.94-22.57A15.91,15.91,0,0,0,224,166.29V117.87l27.76-14.81a8,8,0,0,0,0-14.12ZM128,168a8,8,0,1,1,8-8A8,8,0,0,1,128,168Zm80-1.71c-12.36,13.65-38.65,33.71-80,33.71s-67.64-20.06-80-33.71V126.4l76.24,40.66a8,8,0,0,0,7.52,0L208,126.4Zm-80-15.16L25,96l103-54.94L231,96Z"/></svg>'
  }
};

// Populates the shared modal chrome for the given aux view.
export function applyAuxChrome(v) {
  const meta = AUX_META[v];
  const title = $('aux-overlay-title');
  const sub = $('aux-overlay-sub');
  const icon = $('aux-overlay-icon');
  if (title) title.textContent = meta ? meta.title : '';
  if (sub) sub.textContent = meta ? meta.sub : '';
  if (icon) icon.innerHTML = meta ? meta.icon : '';
}

export function setView(v) {
  const wasAux = AUX_VIEWS.includes(App.view);
  App.view = v;
  const isAux = AUX_VIEWS.includes(v);

  // The build view stays displayed underneath the overlay so canvas geometry
  // (and anything that measures it) remains valid while an aux view is open.
  const build = $('v-build');
  if (build) build.style.display = 'flex';

  AUX_VIEWS.forEach(id => {
    const el = $('v-' + id);
    if (el) el.style.display = (id === v) ? 'flex' : 'none';
  });

  const shell = $('aux-overlay');
  if (shell) shell.classList.toggle('open', isAux);
  const scrim = $('aux-scrim');
  if (scrim) scrim.classList.toggle('open', isAux);
  document.body.classList.toggle('aux-open', isAux);
  if (isAux) document.body.dataset.auxView = v;
  else delete document.body.dataset.auxView;

  applyAuxChrome(v);

  // Keep the Tools trigger lit while an aux view is up, and mark the open item.
  const toolsBtn = $('tools-btn');
  if (toolsBtn) toolsBtn.classList.toggle('view-active', isAux);
  document.querySelectorAll('#tools-menu .ctx-i').forEach(item => {
    item.classList.toggle('active', isAux && item.getAttribute('onclick') === `setView('${v}')`);
  });

  // The left panel and toolbar stay put across every view. They used to be
  // hidden for grammar/reference but not algo, which made the shell appear to
  // collapse depending on which aux view you opened.
  $('lpanel').classList.remove('hidden');

  const tb = $('canvas-toolbox');
  if (tb) tb.style.display = 'flex';

  // The minimap is the exception: it renders the canvas viewport, which is
  // covered by the overlay, so it has nothing meaningful to show.
  const mm = $('minimap-container');
  if (mm) mm.style.visibility = (v === 'build') ? '' : 'hidden';

  if (v === 'algo') { renderAlgo(App.currentAlgo); }
  if (v === 'grammar') { renderGrammarLPanel(); renderGrammarView(); renderGramSyms(); }
  if (v === 'reference') { renderReferenceView(); }
  updateLPanel();
  if (typeof updateMobilePanelChrome === 'function') updateMobilePanelChrome();

  // The dialog is aria-modal, so focus has to actually move into it — and come
  // back to whatever opened it on close.
  if (isAux && !wasAux) {
    auxReturnFocus = document.activeElement;
    if (shell && shell.focus) shell.focus();
  } else if (!isAux && wasAux) {
    const back = auxReturnFocus;
    auxReturnFocus = null;
    if (back && back.focus && document.contains(back)) back.focus();
  }
}

export let auxReturnFocus = null;

// Keeps Tab from escaping the dialog while it is open.
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  if (!AUX_VIEWS.includes(App.view)) return;
  // A modal (e.g. the machine-switch confirm) can open on top of an aux view;
  // while one is up it owns the focus trap.
  if (typeof anyModalOpen === 'function' && anyModalOpen()) return;
  const shell = $('aux-overlay');
  if (!shell) return;
  const focusable = shell.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const visible = Array.prototype.filter.call(focusable, el => el.offsetParent !== null);
  if (!visible.length) return;
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === shell)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// Returning to build is what "closing" an overlay means.
export function closeAuxView() {
  if (AUX_VIEWS.includes(App.view)) setView('build');
}

// ── Tools menu (auxiliary views) ──
export function toggleToolsMenu(e) {
  if (e) e.stopPropagation();
  const picker = $('tools-picker');
  const menu = $('tools-menu');
  const btn = $('tools-btn');
  if (!picker || !menu) return;
  const open = !menu.classList.contains('open');
  hideMoreMenu();
  menu.classList.toggle('open', open);
  picker.classList.toggle('open', open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function hideToolsMenu() {
  const menu = $('tools-menu');
  const picker = $('tools-picker');
  const btn = $('tools-btn');
  if (menu) menu.classList.remove('open');
  if (picker) picker.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// ── Header overflow menu ──
export function toggleMoreMenu(e) {
  if (e) e.stopPropagation();
  const wrap = $('hdr-more');
  const menu = $('hdr-more-menu');
  const btn = $('hdr-more-btn');
  if (!wrap || !menu) return;
  const open = !menu.classList.contains('open');
  hideToolsMenu();
  menu.classList.toggle('open', open);
  wrap.classList.toggle('open', open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function hideMoreMenu() {
  const menu = $('hdr-more-menu');
  const wrap = $('hdr-more');
  const btn = $('hdr-more-btn');
  if (menu) menu.classList.remove('open');
  if (wrap) wrap.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', () => { hideToolsMenu(); hideMoreMenu(); });

// ══════════════════════════════════════════════════════════════════
//  MACHINE TYPE
// ══════════════════════════════════════════════════════════════════
export function setMachine(m) {
  if (m === App.machine) {
    syncMachineSelectors(m);
    return;
  }
  if (App.states.length > 0) {
    syncMachineSelectors(App.machine);
    $('confirm-title').textContent = 'Switch Machine Type?';
    $('confirm-msg').textContent = `Switching to ${m} will delete your current machine work. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      clearAll(true);
      applyMachineSwitch(m);
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  applyMachineSwitch(m);
}

export function syncMachineSelectors(m) {
  if (typeof updateModelPickerLabels === 'function') {
    updateModelPickerLabels();
  }
}

export function applyMachineSwitch(m) {
  const cfg = getMachineConfig(m);
  App.machine = m;

  if (isCounterMachine(m)) {
    const bottom = App.config.sym.stackBottom;
    const counterSym = [...App.stackAlpha].find(sym => sym !== bottom) || '1';
    App.stackAlpha = new Set([bottom, counterSym]);
    if (typeof renderGamma === 'function') renderGamma();
  }

  if (typeof normalizeBoundarySymbolsForMachine === 'function') {
    normalizeBoundarySymbolsForMachine(m);
  }

  // Update UI Tabs and Badges
  syncMachineSelectors(m);
  $('mach-badge').className = `badge ${cfg.badge}`;
  $('mach-badge').textContent = cfg.label;

  if (typeof renderSigma === 'function') renderSigma();
  if (typeof renderGamma === 'function') renderGamma();
  if (typeof renderOutputAlpha === 'function') renderOutputAlpha();

  // Toggle UI Sections based on Machine Features
  $('stack-sec').style.display = cfg.hasStack ? '' : 'none';
  const stackLbl = $('stack-sec').querySelector('.sec-lbl');
  if (stackLbl) stackLbl.textContent = isAnyTM(m) ? 'Tape Alphabet Γ' : 'Stack Alphabet Γ';
  
  $('output-sec').style.display = cfg.isTransducer ? '' : 'none';
  $('mtm-ctrl').style.display = (m === 'MTM') ? 'flex' : 'none';

  // An ω-automaton reads u·vᵂ. Without saying so the placeholder invites a
  // finite word, which is the one thing the machine cannot take.
  const simIn = $('sim-in');
  if (simIn) simIn.placeholder = cfg.isOmega ? 'u(v) — e.g. ab(ba)' : App.config.sym.eps;

  updateRPanel();
  renderAll();
  if (typeof renderTabs === 'function') renderTabs();
  showStatus('Machine: ' + m);
}

export function setTapeCount(n) {
  const newCount = Math.max(2, Math.min(4, parseInt(n) || 2));
  if (newCount === App.tapeCount) return;
  if (App.transitions.length > 0) {
    $('confirm-title').textContent = 'Change Tape Count?';
    $('confirm-msg').textContent = `Changing to ${newCount} tapes will clear all existing multi-tape transitions. Continue?`;
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      snapshot();
      App.transitions = [];
      App.tapeCount = newCount;
      $('tape-count-sel').value = App.tapeCount;
      resetSim();
      emit(Change.GRAPH);
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  App.tapeCount = newCount;
  $('tape-count-sel').value = App.tapeCount;
  resetSim();
}

// ══════════════════════════════════════════════════════════════════
//  TOOLS
// ══════════════════════════════════════════════════════════════════
// setTool lives in js/ui.js. An older copy used to sit here too; because
// index.html loaded ui.js second, that copy was silently overwritten at load
// and had been dead for a while — it predated the divider/rect shape tools.
