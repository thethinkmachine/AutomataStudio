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
      Object.freeze({ id: 'lp-alphabet', collapsed: false }),
      Object.freeze({ id: 'stack-sec', collapsed: false }),
      Object.freeze({ id: 'output-sec', collapsed: false }),
      Object.freeze({ id: 'lp-states', collapsed: false }),
      Object.freeze({ id: 'lp-transitions', collapsed: false })
    ])
  }),
  rpanel: Object.freeze({
    container: 'rpanel-content',
    headerClass: 'rp-section-header',
    titleClass: 'rp-section-title',
    storeKey: 'automata-rpanel-section',
    sections: Object.freeze([
      Object.freeze({ id: 'rp-language', collapsed: false }),
      Object.freeze({ id: 'rp-simulate', collapsed: false }),
      Object.freeze({ id: 'rp-batch', collapsed: true })
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
