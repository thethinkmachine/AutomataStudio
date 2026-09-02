// The sections inside a sidebar: which there are, what they start out as,
// and what order the reader has put them in.
//
// An import-free leaf for the same reason [js/panel-state.js](panel-state.js)
// is one — the panel controller, the boot sequence and the drag handler all
// have to ask the same question, and a shared mutable container written from
// several modules cannot sit anywhere that imports.
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
// A section's title is deliberately *not* here. The stack section is labelled
// "Stack Γ" for a PDA and "Queue" for a QA — `applyMachineSwitch` rewrites it
// — so a copy of the name here would be wrong for half the machines. What
// needs a name reads it off the element.

export const PANEL_SECTION_SIDES = Object.freeze(['lpanel', 'rpanel']);

export const PANEL_SECTIONS = Object.freeze({
  lpanel: Object.freeze({
    container: 'lpanel-content',
    headerClass: 'lp-section-header',
    titleClass: 'lp-section-title',
    storeKey: 'automata-lpanel-section',
    sections: Object.freeze([
      Object.freeze({ id: 'lp-alphabet', collapsed: false, minW: 240, minH: 170, fill: '.chips' }),
      Object.freeze({ id: 'stack-sec', collapsed: false, minW: 240, minH: 170, fill: '.chips' }),
      Object.freeze({ id: 'output-sec', collapsed: false, minW: 240, minH: 170, fill: '.chips' }),
      Object.freeze({ id: 'lp-states', collapsed: false, minW: 240, minH: 200, fill: '.slist' }),
      Object.freeze({ id: 'lp-transitions', collapsed: false, minW: 300, minH: 200, fill: '.tlist' })
    ])
  }),
  rpanel: Object.freeze({
    container: 'rpanel-content',
    headerClass: 'rp-section-header',
    titleClass: 'rp-section-title',
    storeKey: 'automata-rpanel-section',
    sections: Object.freeze([
      Object.freeze({ id: 'rp-language', collapsed: false, minW: 300, minH: 200 }),
      Object.freeze({ id: 'rp-simulate', collapsed: false, minW: 320, minH: 240, fill: '.trace-log' }),
      Object.freeze({ id: 'rp-batch', collapsed: true, minW: 320, minH: 220, fill: '.batch-result' })
    ])
  })
});

/** The side a section id belongs to, or null. */
export function sectionSide(id) {
  return PANEL_SECTION_SIDES.find(side =>
    PANEL_SECTIONS[side].sections.some(s => s.id === id)) || null;
}

/** Every section of a side, in *declared* order. */
export function declaredSectionIds(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? cfg.sections.map(s => s.id) : [];
}

/** Whether a section starts out collapsed, absent anything saved. */
export function sectionStartsCollapsed(id) {
  const side = sectionSide(id);
  if (!side) return false;
  const entry = PANEL_SECTIONS[side].sections.find(s => s.id === id);
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
  const declared = declaredSectionIds(side);
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
  const declared = declaredSectionIds(side);
  const current = sectionOrder(side);
  return declared.some((id, i) => current[i] !== id);
}

/**
 * Records an order. Ids are filtered through the registry the same way
 * `sectionOrder` filters what it reads, so a caller handing over the DOM's
 * idea of the order cannot write a section that does not exist.
 */
export function setSectionOrder(side, ids) {
  const declared = declaredSectionIds(side);
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
  return declaredSectionIds(side);
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
 * The one part of a section that should absorb a window's spare height, as a
 * selector — or nothing, when none of it should.
 *
 * This is the answer to "the content stretches when I resize". A window is
 * taller than its content is *supposed* to be, and what to do with the slack
 * is a property of the section rather than of the window: States Q has a list
 * that should grow and scroll, Simulate has a trace log that should, and the
 * Language card is a stack of boxes where stretching anything at all just
 * spreads it out. So the default is that **nothing** stretches — the content
 * keeps its natural height at the top of the window and the body scrolls when
 * there is not enough room — and a section names its one elastic region if it
 * has one.
 *
 * One region, deliberately. Two flexible children share the slack between
 * them, which is how a resize turns into a layout nobody designed.
 */
export function sectionFill(id) {
  const side = sectionSide(id);
  const entry = side && PANEL_SECTIONS[side].sections.find(s => s.id === id);
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
  const side = sectionSide(id);
  const entry = side && PANEL_SECTIONS[side].sections.find(s => s.id === id);
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
  const declared = declaredSectionIds(side);
  let parsed = null;
  try {
    const raw = localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out = {};
  for (const id of declared) {
    const g = parsed[id];
    if (!g || typeof g !== 'object') continue;
    const min = sectionMinSize(id);
    out[id] = {
      x: num(g.x, 24), y: num(g.y, 24),
      w: Math.max(min.w, num(g.w, 280)),
      h: Math.max(min.h, num(g.h, 260))
    };
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
  return declaredSectionIds(side).filter(id => states[id]);
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
    const min = sectionMinSize(id);
    states[id] = {
      x: num(geom.x, 24), y: num(geom.y, 24),
      w: Math.max(min.w, num(geom.w, 280)),
      h: Math.max(min.h, num(geom.h, 260))
    };
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
