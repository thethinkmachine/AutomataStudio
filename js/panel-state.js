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
// Declaration order is tab order, and the first tab homed on a side is that
// side's default — the one that is always there, so a movable tab leaving can
// never strand a panel with nothing selected.
//
// `movable: true` is the whole of "StateMate can live on either panel". It is
// a property of the tab rather than a branch in the controller, so a second
// movable panel is an entry here plus the markup it names.

export const PANEL_SIDES = Object.freeze(['lpanel', 'rpanel']);

export const PANEL_TABS = Object.freeze({
  workspace: Object.freeze({ tab: 'panel-tab-workspace', panel: 'lpanel-content', home: 'lpanel' }),
  inspector: Object.freeze({ tab: 'panel-tab-inspector', panel: 'rpanel-content', home: 'rpanel' }),
  statemate: Object.freeze({ tab: 'panel-tab-statemate', panel: 'statemate-panel', home: 'rpanel', movable: true })
});

export const PANEL_TAB_NAMES = Object.freeze(Object.keys(PANEL_TABS));

/** Where a movable tab currently is. Fixed tabs are never in here. */
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

/** The tabs hosted by one side, in declaration order. */
export function panelTabNames(side) {
  return PANEL_TAB_NAMES.filter(name => getTabSide(name) === side);
}

/**
 * The tab a side falls back to.
 *
 * Deliberately the first *fixed* tab rather than the first tab: a movable one
 * can leave, and a default that can walk off the panel is not a default.
 */
export function defaultPanelTab(side) {
  return PANEL_TAB_NAMES.find(name => !PANEL_TABS[name].movable && PANEL_TABS[name].home === side)
    || panelTabNames(side)[0]
    || null;
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
  tabSides[name] = side;
  if (wasShowing) {
    activeTab[from] = defaultPanelTab(from);
    activeTab[side] = name;
  }
  return side;
}

export function resetPanelTabs() {
  tabSides = {};
  activeTab = {};
  PANEL_SIDES.forEach(side => { activeTab[side] = defaultPanelTab(side); });
}

resetPanelTabs();
