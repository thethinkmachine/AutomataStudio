// Transitions δ as a table: a row per state, a column per symbol, and the
// targets in the cell where they meet.
//
// It is the textbook's picture of a finite automaton, and it answers at a
// glance the questions the list makes you read for — is δ total, which state
// has no move on `b`, where a DFA goes from everywhere on one symbol. The app
// already drew one, as a card in the Algorithms view; that card could only be
// read, and only by leaving the canvas. This one sits in the Transitions
// section, can be floated beside the diagram like any section, and can be
// edited: a cell is a (state, symbol) pair, and clicking it chooses where δ
// sends that pair.
//
// **Which machines.** A table has one cell per (state, symbol), so it is the
// right picture exactly when a transition is keyed by a state and one symbol
// and carries nothing else that needs a column of its own. That is read off
// the machine's declared `transitionFields`, never a list of names: `on` plus
// at most an emitted symbol (`out`, Mealy and the FST) or a probability
// (`weight`, the PFA). A PDA's pop and push, a TM's write and move, a two-way
// head's direction — each would need a table per value, and the list says them
// better. Those machines keep the list and never see the toggle.
//
// **Which cells are edited in place.** Where a transition is nothing *but*
// its endpoints and its symbol, a cell is a set of target states and choosing
// states is the whole edit: a DFA-family machine picks one (or none — δ may be
// partial), the rest pick any. Where a transition carries an output or a
// probability, a cell's entries open the transition editor, and an empty cell
// opens it with the state and the symbol already filled in, because there is
// a value to type that a picker cannot ask for.
//
// **Drawn through js/panel-list.js**, the way the list is: the host is the same
// element (`#trans-list`), the rows are states instead of transitions, and the
// window, the filter and the scroll restoration all come for free — a table
// over a 1000-state machine draws twenty rows. The symbol header is a sibling
// above the host rather than a row inside it, since the list writes its host's
// `innerHTML` on every scroll, and it follows the host's horizontal scroll.
//
// Listeners are delegated from the host and attached once, so the feature adds
// nothing to `bridge.js` and nothing survives a redraw that should not.

import { $, App, getMachineConfig, getState } from './state.js';
import { hasSingleValuedDelta } from './machines/predicates.js';
import { hasStateOutput, hasTransitionOutput, machineDeterminism, transitionFieldsOf } from './machines/index.js';
import { filterList, setListItems } from './panel-list.js';
import { commit } from './history.js';
import { editTransFromList, formatWeight, newTId, openStateModal, openTransModal } from './states-transitions.js';
import { focusStateFromList, focusTransFromList, hlListHover, hlTransListHover } from './ui.js';
import { acceptsAreShown, updateLPanel } from './render.js';
import { viewStates } from './view-graph.js';
import { pruneNoteAnchorsExcluding } from './notes.js';
import { escapeHtml, showStatus } from './utils.js';
import { Change, subscribe } from './store.js';

const VIEW_KEY = 'automata-trans-view';

/** The fields a table can show without a column of its own. */
const TABLE_FIELDS = new Set(['from', 'to', 'on', 'out', 'weight']);

/** Where a transition is only this, a cell is a set of states. */
const BARE_FIELDS = ['from', 'to', 'on'];

// ── which view ────────────────────────────────────────────────────

/** Whether a machine's δ is a table at all. */
export function transTableSupported(m = App.machine) {
  const fields = transitionFieldsOf(m) || [];
  return fields.includes('on') && fields.every(f => TABLE_FIELDS.has(f));
}

/** Whether a cell is chosen in place rather than through the editor. */
export function transTableEditable(m = App.machine) {
  const fields = transitionFieldsOf(m) || [];
  return fields.length === BARE_FIELDS.length && BARE_FIELDS.every(f => fields.includes(f));
}

/**
 * The view the reader chose, as far as this machine can honour it.
 *
 * A preference about the reader rather than the machine, so it lives in
 * `localStorage` and not in `App.config` — the rule the section order and the
 * pinned panels follow, for the same reason: a file should not re-decide how
 * the next person likes to read δ. The list is stored as the absence of a
 * preference.
 */
export function transView(m = App.machine) {
  let stored = null;
  try { stored = localStorage.getItem(VIEW_KEY); } catch (e) { /* private mode */ }
  return stored === 'table' && transTableSupported(m) ? 'table' : 'list';
}

export function setTransView(view) {
  try {
    if (view === 'table') localStorage.setItem(VIEW_KEY, 'table');
    else localStorage.removeItem(VIEW_KEY);
  } catch (e) { /* the view still changes for this session's next draw */ }
  closeDeltaPicker();
  // The view is part of the section's paint key, so this redraws it.
  updateLPanel();
}

// ── the toggle ────────────────────────────────────────────────────

let toggleWired = false;

/**
 * Shows the List/Table switch where a table is possible and says which is on.
 * Called on every redraw of the section; the listeners go on once.
 */
export function syncTransViewToggle() {
  const box = $('trans-view-toggle');
  if (!box) return;
  const supported = transTableSupported();
  box.hidden = !supported;
  const view = transView();
  for (const btn of [...(box.children || [])]) {
    if (!btn.dataset || !btn.dataset.view) continue;
    const on = btn.dataset.view === view;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const search = $('trans-search');
  if (search) search.placeholder = view === 'table' ? 'Filter states…' : 'Filter transitions…';
  if (!toggleWired && typeof box.addEventListener === 'function') {
    toggleWired = true;
    box.addEventListener('click', e => {
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-view]') : null;
      if (btn) setTransView(btn.dataset.view);
    });
  }
}

// ── the columns ───────────────────────────────────────────────────

/**
 * Σ in the order its chips are in, then ε for a machine that has ε-moves, then
 * anything a transition reads that is not in Σ any more.
 *
 * The last group is the honest one: a symbol removed from Σ leaves the rules
 * that read it standing, and a table built from Σ alone would draw those rules
 * nowhere. They get a column, flagged, rather than silently disappearing.
 */
export function deltaColumns(transitions = App.transitions, m = App.machine) {
  const cols = [...App.sigma];
  const known = new Set(cols);
  const eps = App.config.sym.eps;
  if (getMachineConfig(m).hasEpsilon && !known.has(eps)) { cols.push(eps); known.add(eps); }
  const extra = [];
  for (const t of transitions) {
    if (t.symbol === undefined || t.symbol === null || known.has(t.symbol)) continue;
    known.add(t.symbol);
    extra.push(t.symbol);
  }
  return { cols: [...cols, ...extra], stray: new Set(extra) };
}

/** Transitions grouped by where they start and what they read. */
function cellIndex(transitions) {
  const byState = new Map();
  for (const t of transitions) {
    let row = byState.get(t.from);
    if (!row) byState.set(t.from, row = new Map());
    let cell = row.get(t.symbol);
    if (!cell) row.set(t.symbol, cell = []);
    cell.push(t);
  }
  return byState;
}

// ── drawing ───────────────────────────────────────────────────────

function entryLabel(t, ctx) {
  const name = getState(t.to)?.name ?? '?';
  if (ctx.out) {
    const o = t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda;
    return `${name}/${o}`;
  }
  if (ctx.weighted) return `${name} ${formatWeight(t.weight)}`;
  return String(name);
}

function stateLabel(s, ctx) {
  if (!ctx.stateOut) return escapeHtml(s.name);
  const o = s.output === undefined || s.output === '' ? App.config.sym.lambda : s.output;
  return `${escapeHtml(s.name)}<span class="dt-sub">/${escapeHtml(o)}</span>`;
}

function cellHTML(s, sym, ctx) {
  const ts = ctx.cells.get(s.id)?.get(sym) || [];
  const sel = ts.some(t => App.selectedTransitions.has(t.id)) ? ' lp-selected' : '';
  const stray = ctx.stray.has(sym) ? ' is-stray' : '';
  const edges = escapeHtml(ts.map(t => `${t.from}|${t.to}`).join(','));
  const names = ts.map(t => entryLabel(t, ctx));
  const said = names.length ? (ctx.single && names.length === 1 ? names[0] : `{${names.join(', ')}}`)
    : (ctx.single ? 'undefined' : '∅');
  const tip = escapeHtml(`δ(${s.name}, ${sym}) = ${said}`);
  const symAttr = escapeHtml(sym);

  if (ctx.editable) {
    const inner = ts.length
      ? ts.map(t => `<span class="dt-t${ctx.accepts && App.accepts.has(t.to) ? ' is-acc' : ''}">${escapeHtml(entryLabel(t, ctx))}</span>`).join('')
      : `<span class="dt-none">${ctx.single ? '—' : '∅'}</span>`;
    return `<button type="button" class="dt-cell${sel}${stray}" data-act="cell" data-from="${s.id}" data-sym="${symAttr}"`
      + ` data-edges="${edges}" data-tip="${tip} · click to choose" aria-label="${tip}" aria-haspopup="dialog">${inner}</button>`;
  }

  // Entries carry a value a picker cannot ask for, so each is its own button
  // into the editor, and an empty cell is an invitation to add one.
  const inner = ts.length
    ? ts.map(t => `<button type="button" class="dt-t is-btn${ctx.accepts && App.accepts.has(t.to) ? ' is-acc' : ''}" data-act="entry" data-tid="${t.id}"`
      + ` data-edges="${escapeHtml(`${t.from}|${t.to}`)}" data-tip="Click to focus · Double-click to edit">${escapeHtml(entryLabel(t, ctx))}</button>`).join('')
    : `<button type="button" class="dt-add" data-act="add" data-from="${s.id}" data-sym="${symAttr}" aria-label="Add δ(${escapeHtml(s.name)}, ${symAttr})"`
      + ` data-tip="Add a transition on ${symAttr}">+</button>`;
  return `<div class="dt-cell is-static${sel}${stray}" data-tip="${tip}">${inner}</div>`;
}

function rowHTML(s, ctx) {
  const start = App.startId === s.id;
  const acc = ctx.accepts && App.accepts.has(s.id);
  const sel = App.selectedStates.has(s.id) ? ' lp-selected' : '';
  const marks = `${start ? ' is-start' : ''}${acc ? ' is-acc' : ''}`;
  let html = `<div class="dt-row${sel}">`;
  html += `<button type="button" class="dt-q${marks}" data-act="state" data-sid="${s.id}"`
    + ` data-tip="Click to focus · Double-click to edit">${stateLabel(s, ctx)}</button>`;
  for (const sym of ctx.cols) html += cellHTML(s, sym, ctx);
  return html + '</div>';
}

/**
 * Column widths, as one template both the header and every row use — the
 * rows are separate grids, so they line up only because they are told the
 * same thing. The state column is sized to the longest name it holds; the
 * symbol columns share what is left and never go below a readable minimum,
 * past which the table scrolls sideways under a pinned state column.
 */
function columnTemplate(states, ctx) {
  const longest = states.reduce((n, s) => Math.max(n, String(s.name).length + (ctx.stateOut ? 3 : 0)), 2);
  const qch = Math.min(18, longest) + 3;
  const cellMin = ctx.out || ctx.weighted ? 64 : 46;
  return {
    cols: `calc(${qch}ch + 14px) repeat(${Math.max(1, ctx.cols.length)}, minmax(${cellMin}px, 1fr))`,
    minW: `calc(${qch}ch + 14px + ${ctx.cols.length * cellMin}px)`
  };
}

function headHTML(ctx) {
  const cells = ctx.cols.map(sym => {
    const stray = ctx.stray.has(sym);
    const tip = stray ? `${sym} — not in Σ, but a transition still reads it` : `On ${sym}`;
    return `<div class="dt-hs${stray ? ' is-stray' : ''}" data-tip="${escapeHtml(tip)}">${escapeHtml(sym)}</div>`;
  }).join('');
  return `<div class="dt-hrow"><div class="dt-hq" data-tip="→ start state · * accepting state">δ</div>${cells}</div>`;
}

/**
 * Draws δ as a table into the Transitions host.
 *
 * `states` and `transitions` are what the list would show — this level of the
 * machine, inside a block if the reader is in one — so the two views never
 * disagree about what is on screen.
 */
export function renderTransTable(host, states, transitions) {
  if (!host) return;
  const m = App.machine;
  const { cols, stray } = deltaColumns(transitions, m);
  const ctx = {
    cols, stray,
    cells: cellIndex(transitions),
    editable: transTableEditable(m),
    single: hasSingleValuedDelta(m),
    out: hasTransitionOutput(m),
    weighted: (transitionFieldsOf(m) || []).includes('weight'),
    stateOut: hasStateOutput(m),
    accepts: acceptsAreShown()
  };
  const tpl = columnTemplate(states, ctx);
  const head = $('trans-table-head');
  if (head) {
    head.hidden = false;
    head.innerHTML = headHTML(ctx);
    setVars(head, tpl);
  }
  host.classList.add('is-table');
  setVars(host, tpl);
  wireHost(host);
  setListItems(host, states, {
    html: s => rowHTML(s, ctx),
    text: s => String(s.name),
    empty: '<div class="empty-msg">No states</div>'
  });
  filterList(host, $('trans-search')?.value || '');
  syncHeadScroll(host);
}

/** Puts the host back the way the list draws it. */
export function leaveTransTable(host) {
  const head = $('trans-table-head');
  if (head) { head.hidden = true; head.innerHTML = ''; }
  if (host && host.classList) host.classList.remove('is-table');
  closeDeltaPicker();
}

function setVars(el, tpl) {
  if (!el.style || typeof el.style.setProperty !== 'function') return;
  el.style.setProperty('--dt-cols', tpl.cols);
  el.style.setProperty('--dt-minw', tpl.minW);
}

function syncHeadScroll(host) {
  const head = $('trans-table-head');
  if (head && host) head.scrollLeft = host.scrollLeft || 0;
}

// ── the host's events ─────────────────────────────────────────────

let hovered = null;

function actOf(e) {
  const t = e.target;
  return t && typeof t.closest === 'function' ? t.closest('[data-act]') : null;
}

function highlight(el, on) {
  if (!el || !el.dataset) return;
  if (el.dataset.act === 'state') { hlListHover(el.dataset.sid, on); return; }
  for (const pair of String(el.dataset.edges || '').split(',')) {
    const [from, to] = pair.split('|');
    if (from && to) hlTransListHover(from, to, on);
  }
}

function wireHost(host) {
  if (host.__dtWired || typeof host.addEventListener !== 'function') return;
  host.__dtWired = true;
  host.addEventListener('click', e => {
    if (!host.classList.contains('is-table')) return;
    const el = actOf(e);
    if (!el) return;
    const { act } = el.dataset;
    if (act === 'state') focusStateFromList(el.dataset.sid);
    else if (act === 'cell') openDeltaPicker(el);
    else if (act === 'entry') focusTransFromList(el.dataset.tid);
    else if (act === 'add') openTransModal(el.dataset.from, el.dataset.from, { mode: 'add', symbol: el.dataset.sym });
  });
  host.addEventListener('dblclick', e => {
    if (!host.classList.contains('is-table')) return;
    const el = actOf(e);
    if (!el) return;
    if (el.dataset.act === 'state') openStateModal(el.dataset.sid);
    else if (el.dataset.act === 'entry') editTransFromList(el.dataset.tid);
  });
  host.addEventListener('mouseover', e => {
    if (!host.classList.contains('is-table')) return;
    const el = actOf(e);
    if (el === hovered) return;
    highlight(hovered, false);
    hovered = el;
    highlight(el, true);
  });
  host.addEventListener('mouseleave', () => {
    highlight(hovered, false);
    hovered = null;
  });
  host.addEventListener('scroll', () => {
    if (!host.classList.contains('is-table')) return;
    syncHeadScroll(host);
    // A picker is anchored to a cell, and the cell has just moved.
    closeDeltaPicker();
  }, { passive: true });
}

// ── editing a cell ────────────────────────────────────────────────

/**
 * Makes δ(from, sym) the given set of states, as one undoable edit.
 *
 * Only the rules on exactly this cell are touched; one that reads the wildcard
 * is a different cell. The machine's own determinism rule is asked before
 * anything changes, with the rule being replaced excused from the question —
 * so a DFA can move δ(q, a) from one state to another, and is refused only
 * where something else already answers for (q, a), such as a wildcard edge.
 *
 * Returns whether anything changed.
 */
export function setDeltaCell(from, sym, targets) {
  const want = new Set((targets || []).filter(id => getState(id)));
  const cur = App.transitions.filter(t => t.from === from && t.symbol === sym);
  const have = new Set(cur.map(t => t.to));
  if (want.size === have.size && [...want].every(id => have.has(id))) return false;

  const rule = machineDeterminism(App.machine);
  if (rule && want.size) {
    const probe = { from, to: [...want][0], symbol: sym };
    const conflict = rule.conflict(probe, cur[0]?.id);
    if (conflict) { showStatus(rule.say(probe, conflict)); return false; }
  }

  const gone = cur.filter(t => !want.has(t.to)).map(t => t.id);
  commit(() => {
    if (gone.length) {
      pruneNoteAnchorsExcluding([], gone);
      const drop = new Set(gone);
      App.transitions = App.transitions.filter(t => !drop.has(t.id));
    }
    for (const to of want) {
      if (!have.has(to)) App.transitions.push({ id: newTId(), from, to, symbol: sym });
    }
  });
  return true;
}

// ── the picker ────────────────────────────────────────────────────
//
// A small popover under the cell: the states, each with a mark, and a click to
// choose. A deterministic machine gets one choice and the popover closes on
// it; a nondeterministic one gets a set, and it stays open while the reader
// ticks through it — each tick an edit of its own, so Ctrl+Z walks back one
// state at a time. Not a modal: the canvas stays live behind it, and the
// states it adds appear on the diagram as they are chosen.

let picker = null;

/**
 * The states a cell can send its pair to: the ones on screen, which inside a
 * block are that block's — the same set the table's rows are.
 */
function pickerStates() {
  return viewStates().filter(s => s.kind === undefined);
}

export function openDeltaPicker(cell) {
  if (!cell || !cell.dataset) return;
  const from = cell.dataset.from;
  const sym = cell.dataset.sym;
  if (!getState(from)) return;
  closeDeltaPicker();
  const el = document.createElement('div');
  el.className = 'dt-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Where δ(${getState(from).name}, ${sym}) goes`);
  picker = { el, from, sym, anchor: cell, single: hasSingleValuedDelta(App.machine), query: '' };
  buildPicker();
  document.body.appendChild(el);
  placePicker();
  if (typeof el.addEventListener === 'function') {
    el.addEventListener('keydown', onPickerKey);
    el.addEventListener('click', onPickerClick);
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', onOutside, true);
  }
  const first = pickerOptions().find(o => o.getAttribute('aria-selected') === 'true') || pickerOptions()[0];
  if (first && typeof first.focus === 'function') first.focus();
}

export function closeDeltaPicker(opts = {}) {
  if (!picker) return;
  const { el, anchor } = picker;
  picker = null;
  if (el.parentNode) el.parentNode.removeChild(el);
  if (typeof document.removeEventListener === 'function') {
    document.removeEventListener('pointerdown', onOutside, true);
  }
  if (opts.refocus && anchor && typeof anchor.focus === 'function' && anchor.isConnected !== false) anchor.focus();
}

/** Whether the picker is open, and on which cell — the tests' way in. */
export function deltaPickerCell() {
  return picker ? { from: picker.from, sym: picker.sym } : null;
}

function currentTargets() {
  return new Set(App.transitions
    .filter(t => t.from === picker.from && t.symbol === picker.sym)
    .map(t => t.to));
}

function buildPicker() {
  const { el, from, sym, single } = picker;
  const states = pickerStates();
  const chosen = currentTargets();
  const name = escapeHtml(getState(from)?.name ?? '?');
  const filter = states.length > 10
    ? `<input class="dt-picker-filter" type="search" placeholder="Filter ${states.length} states…" aria-label="Filter states" value="${escapeHtml(picker.query)}">`
    : '';
  const q = picker.query.toLowerCase();
  const shown = q ? states.filter(s => String(s.name).toLowerCase().includes(q)) : states;
  const opt = (id, label, on, extra = '') =>
    `<button type="button" class="dt-opt${on ? ' is-on' : ''}${extra}" role="option" aria-selected="${on}" data-to="${id}">`
    + `<span class="dt-opt-mark${single ? ' is-radio' : ''}" aria-hidden="true"></span>`
    + `<span class="dt-opt-name">${label}</span></button>`;
  const rows = [];
  if (single) rows.push(opt('', '<span class="dt-opt-none">none</span>', chosen.size === 0));
  for (const s of shown) {
    const acc = acceptsAreShown() && App.accepts.has(s.id) ? ' is-acc' : '';
    rows.push(opt(s.id, escapeHtml(s.name), chosen.has(s.id), acc));
  }
  const list = rows.join('') + (q && !shown.length ? '<div class="dt-picker-empty">No state matches</div>' : '');
  el.innerHTML = `<div class="dt-picker-head"><span>δ(<b>${name}</b>, <b>${escapeHtml(sym)}</b>) =</span>`
    + `<span class="dt-picker-kind">${single ? 'one state' : 'any states'}</span></div>`
    + filter
    + `<div class="dt-picker-list" role="listbox" aria-multiselectable="${!single}">${list}</div>`;
  const input = typeof el.querySelector === 'function' ? el.querySelector('.dt-picker-filter') : null;
  if (input) {
    input.addEventListener('input', () => {
      picker.query = input.value;
      const at = input.selectionStart;
      buildPicker();
      const again = picker.el.querySelector('.dt-picker-filter');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* ignore */ } }
    });
  }
}

function pickerOptions() {
  if (!picker || typeof picker.el.querySelectorAll !== 'function') return [];
  return [...picker.el.querySelectorAll('.dt-opt')];
}

/**
 * Under the cell, or over it when there is no room below; never off the
 * side of the window. Fixed rather than inside the panel, so a window or a
 * scrolling list cannot clip it.
 */
function placePicker() {
  const { el, anchor } = picker;
  if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth || 200;
  const h = el.offsetHeight || 240;
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  const below = r.bottom + 4;
  const top = below + h > vh - 8 ? Math.max(8, r.top - h - 4) : below;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function choose(to) {
  if (!picker) return;
  const { from, sym, single } = picker;
  if (single) {
    setDeltaCell(from, sym, to ? [to] : []);
    closeDeltaPicker({ refocus: true });
    return;
  }
  const next = currentTargets();
  if (next.has(to)) next.delete(to); else next.add(to);
  setDeltaCell(from, sym, [...next]);
}

function onPickerClick(e) {
  const t = e.target && typeof e.target.closest === 'function' ? e.target.closest('.dt-opt') : null;
  if (t) choose(t.dataset.to);
}

/**
 * The picker's keys stay in the picker. The canvas shortcuts listen on the
 * document and would otherwise switch the tool on a letter or step the run on
 * an arrow while the reader is choosing states.
 */
function onPickerKey(e) {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDeltaPicker({ refocus: true });
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const opts = pickerOptions();
  if (!opts.length) return;
  const at = opts.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? Math.min(opts.length - 1, at + 1) : Math.max(0, at - 1);
  opts[next].focus();
}

function onOutside(e) {
  if (!picker) return;
  const t = e.target;
  if (t && typeof picker.el.contains === 'function' && picker.el.contains(t)) return;
  // Pressing the same cell again is a toggle, which the click then reopens —
  // so it is excused here and handled by leaving the picker as it is.
  if (t && picker.anchor && typeof picker.anchor.contains === 'function' && picker.anchor.contains(t)) return;
  closeDeltaPicker();
}

// A tick in a nondeterministic cell is an edit, and an edit redraws the list
// the picker's anchor lives in. The picker stays open across that and re-reads
// its marks; a cell whose state has gone closes it.
subscribe(Change.GRAPH, () => {
  if (!picker) return;
  if (!getState(picker.from) || !transTableSupported()) { closeDeltaPicker(); return; }
  const focusedTo = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.to : undefined;
  buildPicker();
  if (focusedTo !== undefined) {
    const back = pickerOptions().find(o => o.dataset.to === focusedTo);
    if (back) back.focus();
  }
  // The anchor was redrawn; follow the new node for Escape's refocus.
  const host = $('trans-list');
  if (host && typeof host.querySelectorAll === 'function') {
    for (const c of host.querySelectorAll('.dt-cell[data-from]')) {
      if (c.dataset.from === picker.from && c.dataset.sym === picker.sym) { picker.anchor = c; break; }
    }
  }
});

/** Drops module state between tests. */
export function resetDeltaTable() {
  closeDeltaPicker();
  hovered = null;
}
