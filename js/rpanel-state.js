// The right sidebar is ordinary application chrome, not document content and
// not a modal. Keep its selection in a tiny import-free leaf so both the panel
// controller and its individual panels can ask the same question without
// creating another UI import cycle.
//
// The map is the registry, and there is one of it: an entry names the tab
// button and the tabpanel it controls, so `syncRPanelTabs` and the arrow-key
// walk read the same list the selection is validated against. A third sibling
// is an entry here plus the markup it names — a name known to the controller
// but missing from this list would otherwise be coerced silently to the
// default, which reads as a tab that refuses to select.
//
// Declaration order is tab order, and the first entry is the default.

export const RPANEL_TABS = Object.freeze({
  inspector: Object.freeze({ tab: 'rpanel-tab-inspector', panel: 'rpanel-content' }),
  statemate: Object.freeze({ tab: 'rpanel-tab-statemate', panel: 'statemate-panel' })
});

export const RPANEL_TAB_NAMES = Object.freeze(Object.keys(RPANEL_TABS));

const DEFAULT_RPANEL_TAB = RPANEL_TAB_NAMES[0];

let activeRPanelTab = DEFAULT_RPANEL_TAB;

export function getActiveRPanelTab() {
  return activeRPanelTab;
}

export function setActiveRPanelTab(name) {
  activeRPanelTab = Object.hasOwn(RPANEL_TABS, name) ? name : DEFAULT_RPANEL_TAB;
  return activeRPanelTab;
}

export function isRPanelTabActive(name) {
  return activeRPanelTab === name;
}

export function resetRPanelTab() {
  activeRPanelTab = DEFAULT_RPANEL_TAB;
}
