// Both sidebars are ordinary application chrome — not document content, and
// not modals. Their tab selection lives here, in a tiny import-free leaf, so
// the panel controller and the individual panels can ask the same question
// without creating another UI import cycle.
//
// One registry for both edges. An entry names the tab button and the tabpanel
// it controls, and `home` is the side it is born on — so `syncPanelTabs`, the
// arrow-key walk and the DOM-moving pass all read the list a selection is
// validated against. A name known to the controller but missing from here
// would otherwise coerce silently to the default, which reads as a tab that
// refuses to select.
//
// Declaration order is the default tab order, and `home` the default side.
//
// **Every tab can move to either panel**, the way VS Code lets any view go to
// either sidebar. `movable` used to be StateMate's alone, and a side's default
// was its first *fixed* tab — the one that could never leave. With nothing
// fixed, a side can end up with one tab or none: a side with none is hidden by
// the controller, and its default is null.
//
// `lazy: true` marks a tab that has to be opened through its own lifecycle
// rather than merely selected — StateMate wires its composer in
// `openStateMate`. Such a tab is never chosen as a side's fallback while there
// is any other tab there, and the controller opens it (quietly) when there is
// not.

export const PANEL_SIDES = Object.freeze(['lpanel', 'rpanel']);

export const PANEL_TABS = Object.freeze({
  workspace: Object.freeze({ tab: 'panel-tab-workspace', panel: 'lpanel-content', home: 'lpanel', movable: true }),
  inspector: Object.freeze({ tab: 'panel-tab-inspector', panel: 'rpanel-content', home: 'rpanel', movable: true }),
  // The player and what it draws — see the `run` group in panel-sections.js
  // for where the line with the Inspector is drawn and why.
  run: Object.freeze({ tab: 'panel-tab-run', panel: 'rpanel-run-content', home: 'rpanel', movable: true }),
  statemate: Object.freeze({ tab: 'panel-tab-statemate', panel: 'statemate-panel', home: 'rpanel', movable: true, lazy: true })
});

export const PANEL_TAB_NAMES = Object.freeze(Object.keys(PANEL_TABS));

/** Where a moved tab currently is. A tab on its home side is not in here. */
let tabSides = {};

/** The selected tab per side. */
let activeTab = {};

function isSide(side) {
  return PANEL_SIDES.includes(side);
}

/** The side a tab is on right now — its home unless it has been moved. */
export function getTabSide(name) {
  const entry = PANEL_TABS[name];
  if (!entry) return null;
  return entry.movable ? (tabSides[name] || entry.home) : entry.home;
}

/**
 * The reader's tab order across both strips, or null for declaration order.
 *
 * One list rather than one per side, because a movable tab carries its place
 * with it: dragging StateMate to the left edge between two tabs is a position
 * in *that* strip, and the other strip's order is simply the list filtered to
 * its side. Declaration order is stored as the absence of a preference — the
 * rule the section order follows — so dragging a tab back where it came from
 * leaves no trace.
 */
let tabOrder = null;

/** Every tab name in display order, reconciled against the registry. */
function orderedTabNames() {
  if (!tabOrder) return PANEL_TAB_NAMES;
  const known = tabOrder.filter((name, i) => PANEL_TABS[name] && tabOrder.indexOf(name) === i);
  // A tab the saved order does not mention lands right after the tab declared
  // before it, so a tab added in a later version sits beside its declared
  // neighbour rather than at an index the reader's reordering has since
  // given a different meaning.
  PANEL_TAB_NAMES.forEach((name, i) => {
    if (known.includes(name)) return;
    const prev = PANEL_TAB_NAMES.slice(0, i).reverse().find(n => known.includes(n));
    known.splice(prev ? known.indexOf(prev) + 1 : 0, 0, name);
  });
  return known;
}

/** The tabs hosted by one side, in display order. */
export function panelTabNames(side) {
  return orderedTabNames().filter(name => getTabSide(name) === side);
}

/** The stored order, or null when it is the declared one. */
export function getPanelTabOrder() {
  return tabOrder ? [...tabOrder] : null;
}

/** Restore a saved order. Anything that is not a list reads as "declared". */
export function setPanelTabOrder(order) {
  tabOrder = Array.isArray(order) && order.length ? order.filter(n => typeof n === 'string') : null;
  if (tabOrder && orderedTabNames().every((n, i) => n === PANEL_TAB_NAMES[i])) tabOrder = null;
  return getPanelTabOrder();
}

/** True when a tab can be dropped on this side: its own, or either if movable. */
export function canTabGoTo(name, side) {
  const entry = PANEL_TABS[name];
  if (!entry || !isSide(side)) return false;
  return entry.movable || getTabSide(name) === side;
}

/**
 * Put a tab on `side`, just before `before` (a tab on that side), or last on
 * that side when `before` is null. Answers whether anything changed.
 *
 * The side goes through `setTabSide`, so a moved tab that was showing keeps
 * showing — a drag is a move, and the same rule a menu move follows.
 */
export function movePanelTabTo(name, side, before = null) {
  if (!canTabGoTo(name, side) || before === name) return false;
  const was = orderedTabNames().join('|');
  const fromSide = getTabSide(name);
  if (fromSide !== side) setTabSide(name, side);
  const rest = orderedTabNames().filter(n => n !== name);
  let at = before && getTabSide(before) === side ? rest.indexOf(before) : -1;
  if (at === -1) {
    // After the last tab on the side, which keeps the other strip's order
    // untouched wherever the moved tab lands in the flat list.
    const last = rest.map(n => getTabSide(n)).lastIndexOf(side);
    at = last + 1;
  }
  rest.splice(at, 0, name);
  setPanelTabOrder(rest);
  return fromSide !== side || orderedTabNames().join('|') !== was;
}

/**
 * The tab a side falls back to, or null for a side with no tabs.
 *
 * The first tab on the side in display order, passing over a `lazy` one while
 * there is anything else — and `except`, which is how a tab leaving asks
 * "what is left behind me".
 */
export function defaultPanelTab(side, except = null) {
  const names = panelTabNames(side).filter(name => name !== except);
  return names.find(name => !PANEL_TABS[name].lazy) || names[0] || null;
}

/** True when a side hosts no tabs at all, and so has nothing to show. */
export function isPanelEmpty(side) {
  return panelTabNames(side).length === 0;
}

/** Tabs that are not on their home side, as `{ name: side }`. */
export function getTabSides() {
  return { ...tabSides };
}

/** Restore saved sides. Unknown names and sides are dropped, home is implied. */
export function setTabSides(sides) {
  tabSides = {};
  if (!sides || typeof sides !== 'object') return getTabSides();
  Object.entries(sides).forEach(([name, side]) => {
    const entry = PANEL_TABS[name];
    if (entry?.movable && isSide(side) && side !== entry.home) tabSides[name] = side;
  });
  return getTabSides();
}

export function getActivePanelTab(side) {
  if (!isSide(side)) return null;
  const on = activeTab[side];
  return on && getTabSide(on) === side ? on : defaultPanelTab(side);
}

export function setActivePanelTab(side, name) {
  if (!isSide(side)) return null;
  activeTab[side] = getTabSide(name) === side ? name : defaultPanelTab(side);
  return activeTab[side];
}

/** True when this tab is the one showing on whichever panel hosts it. */
export function isPanelTabActive(name) {
  const side = getTabSide(name);
  return !!side && getActivePanelTab(side) === name;
}

/**
 * Move a movable tab to the other panel.
 *
 * A tab that was showing keeps showing: it is selected on the side it arrives
 * at, and the side it left falls back to its default. Anything else would move
 * the panel out from under a reader mid-conversation.
 */
export function setTabSide(name, side) {
  const entry = PANEL_TABS[name];
  if (!entry?.movable || !isSide(side)) return getTabSide(name);
  const from = getTabSide(name);
  if (from === side) return from;
  const wasShowing = isPanelTabActive(name);
  if (side === entry.home) delete tabSides[name];
  else tabSides[name] = side;
  if (wasShowing) {
    activeTab[from] = defaultPanelTab(from);
    activeTab[side] = name;
  }
  return side;
}

export function resetPanelTabs() {
  tabSides = {};
  activeTab = {};
  tabOrder = null;
  PANEL_SIDES.forEach(side => { activeTab[side] = defaultPanelTab(side); });
}

resetPanelTabs();

// ── shake to minimize ─────────────────────────────────────────────
//
// Shaking a floating section's window puts both sidebars away, and shaking it
// again brings them back — Aero Shake, aimed at the two things a window is
// competing with for the screen. The gesture itself lives in
// [js/panel-shake.js](panel-shake.js); what is here is only whether it is
// armed, because that is a *preference about the panels* and this is where
// those live.
//
// It goes in `localStorage` rather than in `App.config` for the same reason
// the pinned flags, the tab side and the section order do: `App.config` is
// deep-copied into every workspace tab and written into the `.json`, so a
// setting kept there would travel to the next reader of a file and quietly
// re-answer a question they had answered for themselves. Which sidebars this
// person likes on screen is not a property of the machine.
//
// Absent means **on**, the rule the four `render.*` flags follow: a profile
// written before the gesture existed must not read as "the reader turned it
// off".

const SHAKE_KEY = 'automata-shake-minimize';

export function shakeToMinimizeEnabled() {
  try {
    return localStorage.getItem(SHAKE_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

export function setShakeToMinimizeEnabled(on) {
  try {
    // Stored only when it is *off*, so the default stays the absence of a
    // preference and can still be changed for a reader who never expressed one.
    if (on) localStorage.removeItem(SHAKE_KEY);
    else localStorage.setItem(SHAKE_KEY, '0');
  } catch (e) { /* private mode; correct for this session either way */ }
  return !!on;
}
