// The sections inside a sidebar: which there are, what they start out as,
// and what order the reader has put them in.
//
// A leaf for the same reason [js/panel-state.js](panel-state.js) is one — the
// panel controller, the boot sequence and the drag handler all have to ask the
// same question, and a shared mutable container written from several modules
// cannot sit anywhere that imports an app module. Its one import is
// panel-state.js, which imports nothing, so the pair stays a closed leaf.
//
// **This is the one list.** The section ids used to be written out three
// times: an array inside `initLPanelSections`, the keys of
// `RP_SECTION_DEFAULTS`, and the markup itself. Two of those are derived from
// here now, so adding a section is an entry plus its markup rather than an
// edit in three places — and a section present in one list and missing from
// another is not a thing that can happen.
//
// Declaration order is the *default* order, which is a different thing from
// the order on screen: the reader may drag a section somewhere else, and that
// choice is theirs and outlives the session. See `sectionOrder`.
//
// A section's title is deliberately *not* here. The alphabet section reads
// "Alphabet Σ" for a machine with one alphabet and "Alphabets" for one with
// several — `syncAlphabetSection` rewrites it — so a copy of the name here
// would be wrong for half the machines. What needs a name reads it off the
// element.

import { getTabSide } from './panel-state.js';

// A *group* of sections is one tabpanel's stack, and the key is historical:
// there were two, one per sidebar, so the group was named for its panel. It is
// a tab's stack now — `tab` names the panel tab whose tabpanel is `container`
// — and since every tab can move between the sidebars, which panel hosts a
// group is a question with a live answer. Anything asking about the *panel*
// (is it open, which edge of the canvas does a window pop out beside) asks
// `sectionHost`, never the group key.
//
// Which group a section is *in* is live too: the reader can drag a card to
// another tab. The registry below is where each one is declared — its home,
// and what its markup is shaped like (`headerClass`, the collapse storage
// key) wherever it goes. `sectionSide` answers where it is now.
// ── how the cards are organised ──────────────────────────────────
//
// Three stacks, one per job, and the tab names say the job:
//
//   Machine  (tab key `workspace`, left)  — what you are building. The task
//            if there is one, the parameters, Σ/Γ/Δ, Q, δ, blocks: every card
//            here is edited, and nothing is derived.
//   Analyze  (tab key `inspector`, right) — the machine over *all* its
//            inputs: the language it recognises, many words at once, how its
//            runs grow. Read-only, recomputed as you edit.
//   Run      (tab key `run`, right) — *one* input, step by step: the player
//            and everything drawn from the run it holds.
//
// The keys predate the names and are kept, because they are what saved
// layouts (tab sides, tab order, card placement) are written in. "Workspace"
// was retired as a label because it already names the document tabs across
// the top, the mobile workspace switcher and a Settings tab; "Inspector"
// because it named no job at all.
//
// The exercise sits at the top of Machine rather than beside Analyze: its
// brief is what you are building towards, and the left panel is the one that
// stays up while you build — on the right it competed with the player for the
// same panel. It keeps the right panel's markup, so its entry says so
// (`headerClass`/`titleClass` override the group's; see `sectionConfig`).
export const PANEL_SECTION_SIDES = Object.freeze(['lpanel', 'rpanel', 'run']);

export const PANEL_SECTIONS = Object.freeze({
  lpanel: Object.freeze({
    container: 'lpanel-content',
    tab: 'workspace',
    headerClass: 'lp-section-header',
    titleClass: 'lp-section-title',
    storeKey: 'automata-lpanel-section',
    // Docked, the last open section's list takes the panel's spare height
    // (syncDockFill in js/panel-sections-ui.js). This side only: its regions
    // are transparent lists, where the extra height is invisible. The right
    // panel's are drawn boxes — the trace log has a ground and a border — and
    // stretching one that holds a single line draws a tall empty card.
    dockFill: true,
    sections: Object.freeze([
      // Shown only while the tab carries an exercise (js/exercise-ui.js), and
      // first because it is the reason the tab exists.
      Object.freeze({
        id: 'rp-exercise', collapsed: false, minW: 300, minH: 200,
        headerClass: 'rp-section-header', titleClass: 'rp-section-title'
      }),
      // The machine's own parameters (js/machine-options-ui.js), titled
      // "Parameters" so the card is not a second "Machine" inside the Machine
      // tab. Hidden on the machines that have none, which is most of them.
      Object.freeze({ id: 'lp-machine', collapsed: false, minW: 240, minH: 120 }),
      // Σ, Γ and Δ as rows of one section. No fill: with two or three chip
      // fields in it, stretching the first would push the others to the foot
      // of the window, and each field already scrolls at the panel's cap.
      Object.freeze({ id: 'lp-alphabet', collapsed: false, minW: 240, minH: 170 }),
      Object.freeze({ id: 'lp-states', collapsed: false, minW: 240, minH: 200, fill: '.slist' }),
      Object.freeze({ id: 'lp-transitions', collapsed: false, minW: 300, minH: 200, fill: '.tlist' }),
      Object.freeze({ id: 'lp-blocks', collapsed: true, minW: 260, minH: 180, fill: '.blist' })
    ])
  }),
  rpanel: Object.freeze({
    container: 'rpanel-content',
    tab: 'inspector',
    headerClass: 'rp-section-header',
    titleClass: 'rp-section-title',
    storeKey: 'automata-rpanel-section',
    sections: Object.freeze([
      // What it accepts, then checking that against many words, then what
      // accepting them costs — the order a reader asks the three questions in,
      // and the frequency they ask them at.
      Object.freeze({ id: 'rp-language', collapsed: false, minW: 300, minH: 200 }),
      Object.freeze({ id: 'rp-batch', collapsed: true, minW: 320, minH: 220, fill: '.batch-result' }),
      // How a machine's runs grow with its input — js/complexity-ui.js. The
      // charts are what take a window's spare height.
      Object.freeze({ id: 'rp-complexity', collapsed: true, minW: 360, minH: 320, fill: '.cx-charts' })
    ])
  }),
  // The Run tab: everything that follows the player's cursor. Analyze
  // keeps what is about the machine over *all* its inputs — its language,
  // many words at once, how its runs grow — and these are about *one* run,
  // step by step: every section here is drawn from the run the player holds
  // (`App.simSteps` and the cursor into it). Language, Batch Test, Complexity
  // and the exercise each jump *into* that run — trace this word, replay this
  // row, run the worst case — and that jump reveals this tab.
  //
  // Its own `storeKey` for order and float records, because those are written
  // a group at a time and two groups sharing a key would each overwrite the
  // other's. The *collapse* flags keep their `automata-rpanel-section-<id>`
  // keys (setRPSectionCollapsed), so a reader's open/closed choices survive
  // the move.
  run: Object.freeze({
    container: 'rpanel-run-content',
    tab: 'run',
    headerClass: 'rp-section-header',
    titleClass: 'rp-section-title',
    storeKey: 'automata-run-section',
    sections: Object.freeze([
      // No fill. The elastic part of a run used to be the trace log, and the
      // log is its own card now; what is left is a transport and a tape card,
      // neither of which has anything to do with spare height. Named as the
      // fill, the tracker was squeezed below its own content in a short window
      // — `min-height: 0` — and the tape strip drew straight over its border,
      // and in a tall one it stretched into a padded card of nothing. Without
      // one, everything keeps its natural height and the body scrolls.
      Object.freeze({ id: 'rp-simulate', collapsed: false, minW: 320, minH: 200 }),
      // The trace log is its own card. It was the tail of Simulate, which meant
      // the two things a run produces — a transport you operate and a history
      // you read — shared one box, one scroll and one collapse: reading back
      // through a run pushed the play button off the top of the panel, and
      // collapsing the transport took the log with it. They are also the two
      // sections most worth pulling out into windows *separately*, which the
      // section registry can only offer per card.
      Object.freeze({ id: 'rp-trace', collapsed: false, minW: 300, minH: 200, fill: '.trace-log' }),
      // Every branch of a nondeterministic run — js/branch-tree-ui.js. Open by
      // default, since the machines that show it are the ones where the trace
      // alone hides most of what happened; the tree is what takes the height.
      Object.freeze({ id: 'rp-branches', collapsed: false, minW: 320, minH: 240, fill: '.bt-view' }),
      // The whole run as one picture — js/spacetime-ui.js. Collapsed by
      // default because the sidebar is the wrong shape for it: the tracker's
      // header opens it straight into a window, and the minimum size here is
      // what a window needs to show a toolbar, some rows and the legend.
      Object.freeze({ id: 'rp-spacetime', collapsed: true, minW: 380, minH: 280, fill: '.st-view' })
    ])
  })
});

/** The sidebar element a group's sections are drawn in — wherever its tab is. */
export function sectionHost(group) {
  const cfg = PANEL_SECTIONS[group];
  return cfg ? getTabSide(cfg.tab) : null;
}

/** Every group hosted by one sidebar. */
export function groupsInPanel(panel) {
  return PANEL_SECTION_SIDES.filter(group => sectionHost(group) === panel);
}

/** The group whose stack a panel tab shows, or null (StateMate has none). */
export function groupForTab(tab) {
  return PANEL_SECTION_SIDES.find(group => PANEL_SECTIONS[group].tab === tab) || null;
}

// ── where a section is ───────────────────────────────────────────

/** The group a section is declared in: its home, and the shape of its markup. */
export function declaredGroupOf(id) {
  return PANEL_SECTION_SIDES.find(side =>
    PANEL_SECTIONS[side].sections.some(s => s.id === id)) || null;
}

function sectionEntry(id) {
  const group = declaredGroupOf(id);
  return group ? PANEL_SECTIONS[group].sections.find(s => s.id === id) : null;
}

/**
 * The declared group's config, with the card's own markup classes over it:
 * header and title classes follow the markup, and a card may be declared in a
 * stack whose other cards are built differently (the exercise, in Machine).
 */
export function sectionConfig(id) {
  const group = declaredGroupOf(id);
  if (!group) return null;
  const entry = sectionEntry(id);
  const cfg = PANEL_SECTIONS[group];
  if (!entry.headerClass && !entry.titleClass) return cfg;
  return {
    ...cfg,
    headerClass: entry.headerClass || cfg.headerClass,
    titleClass: entry.titleClass || cfg.titleClass
  };
}

/** Every declared card built on one header class, wherever it is declared. */
export function sectionsWithHeader(headerClass) {
  return PANEL_SECTION_SIDES
    .flatMap(group => PANEL_SECTIONS[group].sections.map(s => s.id))
    .filter(id => sectionConfig(id).headerClass === headerClass);
}

const PLACEMENT_KEY = 'automata-section-groups';

// Held in memory, because `sectionSide` is on per-frame paths — a window move
// asks it which group a section is in — and a storage read there is the cost
// panel-float.js has already had to take off that path twice. Read once,
// written through.
let placementCache = null;

function placement() {
  if (placementCache) return placementCache;
  placementCache = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PLACEMENT_KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([id, group]) => {
        const home = declaredGroupOf(id);
        if (PANEL_SECTIONS[group] && home && home !== group) placementCache[id] = group;
      });
    }
  } catch (e) { /* unreadable reads as "nothing moved" */ }
  return placementCache;
}

function writePlacement() {
  try {
    // Home is stored as the absence of a record, like every other layout
    // preference here, so a card dragged back leaves nothing behind.
    if (Object.keys(placementCache || {}).length) {
      localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placementCache));
    } else {
      localStorage.removeItem(PLACEMENT_KEY);
    }
  } catch (e) { /* private mode; correct for this session */ }
}

/** The group a section is in now: its home unless the reader moved it. */
export function sectionSide(id) {
  const home = declaredGroupOf(id);
  if (!home) return null;
  return placement()[id] || home;
}

/** True when any section is not in the group it was declared in. */
export function anySectionMoved() {
  return Object.keys(placement()).length > 0;
}

/**
 * The sections a group holds now: its own that have not left, in declared
 * order, then those moved in from elsewhere, in the order they are declared.
 */
export function groupSectionIds(group) {
  if (!PANEL_SECTIONS[group]) return [];
  const all = PANEL_SECTION_SIDES.flatMap(g => PANEL_SECTIONS[g].sections.map(s => s.id));
  const own = PANEL_SECTIONS[group].sections.map(s => s.id).filter(id => sectionSide(id) === group);
  const guests = all.filter(id => !own.includes(id) && sectionSide(id) === group);
  return [...own, ...guests];
}

/**
 * Moves a section to another group, at `index` in that group's order (the end
 * when omitted). Answers the group's new order, or null when there is no such
 * section or group.
 *
 * Registry state only. The element is reparented by `applySectionOrder`, and a
 * floating section is docked first (panel-sections-ui does both), because
 * float records are kept per group and a record left in the old group's store
 * would describe a window its new group cannot see.
 */
export function moveSectionToGroup(id, group, index = Infinity) {
  const from = sectionSide(id);
  if (!from || !PANEL_SECTIONS[group]) return null;
  if (from === group) return moveSection(group, id, Math.min(index, sectionOrder(group).length - 1));
  const map = placement();
  if (declaredGroupOf(id) === group) delete map[id];
  else map[id] = group;
  writePlacement();
  // The group it left forgets it; the one it joins places it.
  setSectionOrder(from, sectionOrder(from));
  const order = sectionOrder(group).filter(x => x !== id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  return setSectionOrder(group, order);
}

/** Every section back in the group it was declared in. */
export function resetSectionPlacement() {
  placementCache = {};
  writePlacement();
}

/** Every section of a side, in *declared* order. */
export function declaredSectionIds(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? cfg.sections.map(s => s.id) : [];
}

/** Whether a section starts out collapsed, absent anything saved. */
export function sectionStartsCollapsed(id) {
  const entry = sectionEntry(id);
  return !!(entry && entry.collapsed);
}

// ── the reader's order ────────────────────────────────────────────

function orderKey(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? `${cfg.storeKey}-order` : null;
}

function readStored(side) {
  const key = orderKey(side);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch (e) {
    return [];
  }
}

/**
 * The order to draw a side's sections in.
 *
 * Reconciled against the registry rather than trusted, because a saved order
 * is a snapshot of a list that has since changed. Two rules, and both are the
 * "absent reads as the default" rule the render flags and `detectsLoops`
 * follow:
 *
 *   • an id the registry no longer has is dropped, or a removed section
 *     would keep a slot on screen forever;
 *   • an id the *saved* order does not mention is inserted at the position it
 *     is declared at, so a section added in a later version lands where its
 *     author put it instead of being exiled to the bottom of every panel that
 *     was ever reordered.
 */
export function sectionOrder(side) {
  const declared = groupSectionIds(side);
  if (!declared.length) return [];

  const seen = new Set();
  const out = [];
  for (const id of readStored(side)) {
    if (!declared.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  declared.forEach((id, i) => {
    if (seen.has(id)) return;
    out.splice(Math.min(i, out.length), 0, id);
  });
  return out;
}

/** True when the reader has moved something — the default order is not saved. */
export function sectionOrderIsCustom(side) {
  const declared = groupSectionIds(side);
  const current = sectionOrder(side);
  return declared.some((id, i) => current[i] !== id);
}

/**
 * Records an order. Ids are filtered through the registry the same way
 * `sectionOrder` filters what it reads, so a caller handing over the DOM's
 * idea of the order cannot write a section that does not exist.
 */
export function setSectionOrder(side, ids) {
  const declared = groupSectionIds(side);
  if (!declared.length) return [];
  const seen = new Set();
  const clean = [];
  for (const id of ids || []) {
    if (!declared.includes(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push(id);
  }
  declared.forEach(id => { if (!seen.has(id)) clean.push(id); });

  const key = orderKey(side);
  try {
    // The default order is stored as the absence of a preference rather than
    // as a list — so dragging a section back where it came from leaves no
    // trace, and a later change to the declared order still reaches a reader
    // who never expressed one.
    if (clean.every((id, i) => declared[i] === id)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(clean));
  } catch (e) { /* private mode; the order is still correct for this session */ }
  return clean;
}

/**
 * Moves one section to an index, and returns the resulting order.
 *
 * The index is clamped rather than refused: this is what the ↑/↓ keys drive,
 * and pressing ↑ on the topmost section should be a no-op, not an error.
 */
export function moveSection(side, id, index) {
  const order = sectionOrder(side);
  const from = order.indexOf(id);
  if (from === -1) return order;
  const to = Math.max(0, Math.min(order.length - 1, index));
  if (to === from) return order;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return setSectionOrder(side, order);
}

/** Puts a side back the way it was declared. */
export function resetSectionOrder(side) {
  try { localStorage.removeItem(orderKey(side)); } catch (e) { /* ignore */ }
  return groupSectionIds(side);
}

// ── floating a section out of its panel ───────────────────────────
//
// A section is **docked** or **floating**. Floating means the same element,
// reparented into a layer over the canvas — see [js/panel-float.js](panel-float.js)
// for why that is one `appendChild` rather than a second copy of the section.
//
// The geometry is screen space: px from the top-left of the canvas well. These
// are instruments rather than annotations — a Simulate window that scrolled
// away when you panned the machine would be useless, and at 8% zoom a
// world-anchored one would be twenty pixels wide. Notes and dividers are the
// world-anchored kind and already exist; this is the other thing.
//
// Docked is stored as the *absence* of a record, the same rule `sectionOrder`
// follows, so a section dragged back into its panel leaves nothing behind.

/** A floating window narrower or shorter than this is not readable. */
export const FLOAT_MIN_W = 200;
export const FLOAT_MIN_H = 110;

function floatKey(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? `${cfg.storeKey}-float` : null;
}

/**
 * The one part of a section that gives when its window is shorter than its
 * content, as a selector — or nothing, when none of it should.
 *
 * Every window fits its content (see `applyGeom` in js/panel-float.js), so
 * there is no spare height to hand out; the question is the other one. A
 * States Q window shorter than its list should scroll the *list* and keep the
 * search box above it, a Trace window should scroll the log and keep the
 * heading — while the Language card is a stack of boxes with nothing to
 * favour, and without a region named the body scrolls as a whole.
 *
 * One region, deliberately. Two flexible children share the shortfall between
 * them, which is how a resize turns into a layout nobody designed.
 */
export function sectionFill(id) {
  const entry = sectionEntry(id);
  return (entry && entry.fill) || null;
}

/**
 * The smallest a section's window may be made.
 *
 * Per section rather than one number for all of them, because what "too small
 * to use" means is a property of the content: the alphabet is a wrapping field
 * of chips and shrinks gracefully, while Simulate is a labelled row of
 * transport controls with a tape strip under it and stops being operable
 * long before that. `FLOAT_MIN_*` stays as the floor a section that declares
 * nothing gets, so adding a section costs no edit here.
 */
export function sectionMinSize(id) {
  const entry = sectionEntry(id);
  return {
    w: Math.max(FLOAT_MIN_W, (entry && entry.minW) || 0),
    h: Math.max(FLOAT_MIN_H, (entry && entry.minH) || 0)
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A record's geometry, with the edges it is anchored to.
 *
 * `r` and `b` are optional, and each is a distance: from the well's right edge
 * and from its bottom edge. A window near the right of the canvas keeps its
 * distance to the right as the canvas changes width — see `placeInWell` in
 * js/panel-float.js for why. Absent means the ordinary anchor, left and top,
 * which is what `x`/`y` already say — so a record written before anchors
 * existed reads exactly as it always did.
 *
 * `typeof` rather than `num`: `Number(null)` is 0, and a JSON `null` must read
 * as "no anchor", not as "flush against the edge".
 */
function recordGeom(g, min) {
  const out = {
    x: num(g.x, 24), y: num(g.y, 24),
    w: Math.max(min.w, num(g.w, 280)),
    h: Math.max(min.h, num(g.h, 260))
  };
  if (typeof g.r === 'number' && Number.isFinite(g.r)) out.r = g.r;
  if (typeof g.b === 'number' && Number.isFinite(g.b)) out.b = g.b;
  // Follows its content rather than holding a ceiling — see `applyGeom`.
  // Absent means false, so a record written before it existed reads the same.
  if (g.fit === true) out.fit = true;
  return out;
}

/**
 * Every float record of a side, reconciled against the registry.
 *
 * Read rather than trusted for the same two reasons the order is: an id the
 * registry no longer has would keep a window on screen with nothing to put in
 * it, and a record whose geometry did not survive a JSON round trip would
 * position a window at NaN, which paints nowhere and cannot be dragged back.
 */
export function floatStates(side) {
  const key = floatKey(side);
  if (!key) return {};
  const members = groupSectionIds(side);
  let parsed = null;
  try {
    const raw = localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out = {};
  for (const id of members) {
    const g = parsed[id];
    if (!g || typeof g !== 'object') continue;
    out[id] = recordGeom(g, sectionMinSize(id));
  }
  return out;
}

/** Where a section is floating, or null when it is docked. */
export function floatState(id) {
  const side = sectionSide(id);
  return side ? (floatStates(side)[id] || null) : null;
}

export function isSectionFloating(id) {
  return !!floatState(id);
}

/** The floating sections of a side, in declared order. */
export function floatingSectionIds(side) {
  const states = floatStates(side);
  return groupSectionIds(side).filter(id => states[id]);
}

/** The docked ones — what `applySectionOrder` may put back in the panel. */
export function dockedSectionIds(side) {
  const states = floatStates(side);
  return sectionOrder(side).filter(id => !states[id]);
}

/**
 * Records where a section is floating, or docks it when handed null.
 *
 * Writing the whole side at once rather than one key per section: the records
 * are read together on every layout pass, and a key per section would leave a
 * removed section's geometry in storage forever with nothing to reconcile it
 * against.
 */
export function setFloatState(id, geom) {
  const side = sectionSide(id);
  if (!side) return null;
  const states = floatStates(side);
  if (geom) {
    states[id] = recordGeom(geom, sectionMinSize(id));
  } else {
    delete states[id];
  }
  const key = floatKey(side);
  try {
    // Docked is the absence of a preference, so a side with nothing floating
    // holds no record at all rather than an empty object.
    if (!Object.keys(states).length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(states));
  } catch (e) { /* private mode; correct for this session either way */ }
  return geom ? states[id] : null;
}

/** Docks every section of a side. */
export function resetFloatStates(side) {
  const key = floatKey(side);
  if (!key) return;
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}
