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
