// Dragging a sidebar section somewhere else.
//
// The panels are a fixed stack of sections, and which of them matters is a
// property of the reader rather than of the app: someone drawing a big NFA
// lives in States Q and Transitions δ, someone debugging a run lives in
// Simulate, and both of them had to scroll past the other's section every
// time. So the order is theirs, it persists, and it is one mechanism for both
// panels — see [js/panel-sections.js](panel-sections.js) for the registry.
//
// Three decisions worth keeping:
//
// • **The grip is its own control, not the header.** The header already has a
//   job — it collapses the section, from a click *and* from Enter/Space, with
//   `role="button"` saying so. Starting a drag from it would mean guessing
//   from pointer travel which of the two the reader meant, and would leave
//   the keyboard with no way to reorder at all. A `<button>` grip has one
//   meaning, gets ↑/↓ for free, and follows the app's existing rule for row
//   controls: revealed on `:hover` and `:focus-within`, and always shown
//   where there is no hover to reveal it with.
//
// • **The grips are injected, not written into the markup eight times.** Same
//   reasoning as `installModalChrome()`: a control that belongs to every
//   member of a set should be added by the code that knows the set. Adding a
//   section therefore costs an entry in the registry and its markup, and
//   nothing here.
//
// • **The drag reorders the real DOM as it goes.** No ghost element and no
//   drop-line: the section moves when the pointer crosses a neighbour's
//   midpoint, so what you are looking at during the drag is the result. The
//   only state the gesture keeps is what it needs to *undo* itself, because
//   Escape cancels a drag and puts the order back.
//
// • **A card is not tied to its tab.** The same drag carries it to another
//   one: drop it on a tab button and it moves to that tab; pull it across to
//   the other panel and it docks into whatever stack that panel is showing.
//   Right-click (or Shift+F10 on the grip) is the keyboard's route to the
//   same moves. The gesture remembers the group it *started* in, so Escape
//   can put a card back even after it has been docked somewhere else.
//
// Listeners are attached at creation the way [js/reference.js](reference.js)
// does it, so the whole feature adds nothing to `bridge.js`.

import {
  PANEL_SECTIONS, PANEL_SECTION_SIDES, anySectionMoved, declaredGroupOf, declaredSectionIds,
  dockedSectionIds, groupForTab, groupSectionIds, isSectionFloating, moveSection,
  moveSectionToGroup, resetSectionPlacement, sectionConfig, sectionFill, sectionHost,
  sectionOrder, sectionSide, setSectionOrder
} from './panel-sections.js';
import { PANEL_SIDES, PANEL_TABS, PANEL_TAB_NAMES, getActivePanelTab } from './panel-state.js';
import { openActionMenu, revealSection } from './ui.js';
import {
  beginFloatSnap, commitFloatGeom, dockSection, endFloatSnap, floatLayerRect,
  floatSection, floatingEnabled, moveFloatTo, syncPanelEmpty
} from './panel-float.js';
import { redrawAllLists } from './panel-list.js';

/** Pointer travel, in px, before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

/**
 * How far outside the panel a reorder drag has to travel before it becomes a
 * tear-off. Generous, because the two gestures start identically: everything
 * up to this point is still a reorder, and a reader nudging a section past the
 * panel's edge on the way up or down must not have it come away in their hand.
 */
const TEAR_THRESHOLD = 40;

/** How close to a scrolling panel's edge before the drag scrolls it. */
const EDGE_SCROLL_ZONE = 28;
const EDGE_SCROLL_STEP = 10;

const GRIP_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" width="12" height="12"><path d="M92,60A16,16,0,1,1,76,44,16,16,0,0,1,92,60Zm88-16a16,16,0,1,0,16,16A16,16,0,0,0,180,44ZM76,112a16,16,0,1,0,16,16A16,16,0,0,0,76,112Zm104,0a16,16,0,1,0,16,16A16,16,0,0,0,180,112ZM76,180a16,16,0,1,0,16,16A16,16,0,0,0,76,180Zm104,0a16,16,0,1,0,16,16A16,16,0,0,0,180,180Z"/></svg>';

/** The drag in flight, or null. */
let drag = null;

function containerOf(side) {
  const cfg = PANEL_SECTIONS[side];
  return cfg ? document.getElementById(cfg.container) : null;
}

function sectionEl(id) {
  return document.getElementById(id);
}

/** The title as it currently reads — "Stack Γ" or "Queue", per machine. */
function sectionName(side, id) {
  const el = sectionEl(id);
  const cfg = sectionConfig(id);
  const title = el && cfg ? el.querySelector('.' + cfg.titleClass) : null;
  return (title ? title.textContent : '').trim() || id;
}

/** A group's name as its tab says it — "Workspace", "Run". */
function groupLabel(group) {
  const tab = PANEL_SECTIONS[group]?.tab;
  const btn = tab ? document.getElementById(PANEL_TABS[tab].tab) : null;
  const label = btn?.querySelector?.('.panel-tab-label')?.textContent?.trim();
  return label || (tab ? tab[0].toUpperCase() + tab.slice(1) : group);
}

/**
 * The sections a drag can land between.
 *
 * Hidden ones are skipped — `applyMachineSwitch` hides the Machine and Blocks
 * sections for machines without parameters or blocks, and a zero-height box
 * has a midpoint the pointer is always past, which would make the drop target
 * jump straight through it.
 */
function visibleSections(side) {
  // Built from the DOM's order, not the registry's: the midpoint walk below
  // compares a candidate's index against the dragged section's, so a list in
  // declared order would be answering about a layout that is not on screen.
  return domOrder(side)
    .map(id => sectionEl(id))
    .filter(el => el && el.style.display !== 'none');
}

/** The order the DOM is actually in right now. */
function domOrder(side) {
  const container = containerOf(side);
  if (!container) return [];
  const known = groupSectionIds(side);
  // A card dragged in from another tab is not a member until it is dropped,
  // but it is in this stack and the midpoint walk has to be able to place it.
  if (drag && drag.side === side && !known.includes(drag.el.id)) known.push(drag.el.id);
  return [...container.children]
    .map(el => el.id)
    .filter(id => known.includes(id));
}

// ── applying an order ─────────────────────────────────────────────

/**
 * Puts the DOM in the saved order.
 *
 * `appendChild` on a node that is already a child *moves* it, so this is one
 * pass and no removals — and it is a no-op in the common case where the DOM
 * already agrees, because appending in the order they are already in changes
 * nothing observable.
 */
export function applySectionOrder(side) {
  const container = containerOf(side);
  if (!container) return;
  const current = domOrder(side);
  // The docked ones only. A floating section is not a child of the container,
  // so `domOrder` already leaves it out — but `sectionOrder` does not, and
  // appending it here would yank every window back into its panel on the next
  // reorder, a collapse, or a machine switch.
  const want = dockedSectionIds(side);
  if (want.length !== current.length || !want.every((id, i) => current[i] === id)) {
    want.forEach(id => {
      const el = sectionEl(id);
      if (el) container.appendChild(el);
    });
  }
  // Outside the early return, because a grip's label counts the sections that
  // are *in the panel* — "Reorder Simulate, 2 of 3" — and floating one changes
  // that count without changing the order of what is left. Docking the last
  // section back is the case that made it visible: the DOM already agrees with
  // the order, so the pass returned before relabelling and every grip in the
  // panel went on claiming a total that was one short.
  syncGripLabels(side);
  syncDockFill(side);
}

// ── the docked panel's spare height ───────────────────────────────

/**
 * Hands a docked panel's spare height to one list.
 *
 * Every list in a panel was capped at `--lp-list-max-h`, so a machine with ten
 * transitions scrolled them inside a 168px box above two hundred pixels of
 * empty panel. The floating window already answered this — the registry names
 * each section's one growable region (`sectionFill`), and exactly one child
 * takes the slack — and this is the same answer for the panel: the *last*
 * open section that declares a region takes it. The last, because a list that
 * grows pushes everything below it down; growing the last one moves nothing
 * but the collapsed headers under it, which settle at the panel's foot.
 *
 * It used to be `#lp-transitions { flex: 1 }`, and was lost when sections
 * became collapsible, reorderable and detachable — an id is the wrong key for
 * "the one at the bottom" once the reader can move them. Asked of the DOM
 * each time, so a collapse, a reorder, a window torn off or docked back, and
 * a machine switch hiding the stack section all land on the same answer.
 */
export function syncDockFill(side) {
  const container = containerOf(side);
  if (!container) return null;
  // Eligibility belongs to the *section*, not to the stack it is in: the
  // Workspace's lists are transparent, so extra height is invisible, while the
  // right panel's regions are drawn boxes and stretching one that holds a
  // single line draws a tall empty card. A States Q dragged into the
  // Inspector still takes that stack's spare height; a Trace dragged into the
  // Workspace does not.
  const eligible = id => !!sectionConfig(id)?.dockFill;
  const members = groupSectionIds(side);
  if (!members.some(eligible)) return null;
  let fill = null;
  for (const id of domOrder(side)) {
    const el = sectionEl(id);
    if (!eligible(id)) continue;
    if (!el || el.style.display === 'none' || el.classList.contains('collapsed')) continue;
    const sel = sectionFill(id);
    if (sel && typeof el.querySelector === 'function' && el.querySelector(sel)) fill = id;
  }
  // Every member, not just the docked ones: a section torn off into a window
  // has left `domOrder` and would otherwise keep the mark it had.
  for (const id of members) {
    const el = sectionEl(id);
    if (!el) continue;
    const sel = sectionFill(id);
    const region = sel && typeof el.querySelector === 'function' ? el.querySelector(sel) : null;
    const on = id === fill;
    el.classList.toggle('panel-dock-fill', on);
    if (region && region.classList) region.classList.toggle('panel-dock-fill-region', on);
  }
  // A list is windowed against its own height at draw time, and a collapse
  // elsewhere in the panel changes that height without the list scrolling or
  // the machine changing — the two things that would otherwise redraw it.
  redrawAllLists();
  return fill;
}

/**
 * Rewrites every grip's label with its section's position.
 *
 * "Reorder Simulate" says what the control does and not where the thing is,
 * which is the half a reader who cannot see the panel actually needs — and
 * after a keyboard move it is the only feedback there is.
 */
function syncGripLabels(side) {
  const order = domOrder(side);
  const shown = visibleSections(side).map(el => el.id);
  order.forEach(id => {
    const el = sectionEl(id);
    const grip = el && el.__secGrip;
    if (!grip) return;
    const at = shown.indexOf(id);
    const name = sectionName(side, id);
    grip.setAttribute('aria-label', at === -1
      ? `Reorder ${name}`
      : `Reorder ${name}, ${at + 1} of ${shown.length}`);
  });
}

/** Says what just happened, for a reader who is not looking at the panel. */
function announce(message) {
  let live = document.getElementById('panel-sec-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'panel-sec-live';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = message;
}

// ── the gesture ───────────────────────────────────────────────────

/** Puts a card back where the gesture found it: its own stack, its own slot. */
function restoreOrigin() {
  const { origin, side, el, floating } = drag;
  if (floating) dockSection(el.id);
  const home = containerOf(origin);
  if (!home) return;
  if (drag.before && drag.before.parentNode === home) home.insertBefore(el, drag.before);
  else if (drag.before !== undefined) home.appendChild(el);
  if (side !== origin) {
    containerOf(side)?.classList.remove('has-reorder');
    syncPanelEmpty(side);
    syncGripLabels(side);
  }
  syncPanelEmpty(origin);
}

function endDrag(commit) {
  if (!drag) return;
  const { side, origin, el, grip, pointerId, floating } = drag;
  const target = drag.tabTarget;
  const container = containerOf(side);
  markTabTarget(null);

  // Dropped on a tab: the card moves to that tab's stack. On its *own* tab it
  // goes back where it was — hovering the strip held it wherever the pointer
  // left the stack, which is not a position anyone chose.
  const toTab = commit && target ? target.group : null;
  if (!commit || (toTab && toTab === origin)) {
    // Escape puts it back exactly where it was, which is the whole reason the
    // gesture remembers anything at all — and once the drag can also change
    // which *parent* the section has, "where it was" is a parent as well as a
    // neighbour.
    restoreOrigin();
  } else if (toTab) {
    if (floating) dockSection(el.id);
  } else if (floating) {
    // The move painted every frame and wrote nothing; this is the one write.
    commitFloatGeom(el.id, drag.geom);
  }

  el.classList.remove('is-reordering');
  if (container) container.classList.remove('has-reorder');
  containerOf(origin)?.classList.remove('has-reorder');
  try { grip.releasePointerCapture(pointerId); } catch (e) { /* already gone */ }
  drag = null;
  endFloatSnap();

  if (!commit || (toTab && toTab === origin)) {
    syncGripLabels(origin);
    return;
  }

  if (toTab) {
    moveCardTo(el.id, toTab);
    revealSection(el.id);
    return;
  }

  if (floating) {
    syncGripLabels(origin);
    announce(`${sectionName(origin, el.id)} floating over the canvas`);
    return;
  }

  if (side !== origin) {
    // Docked into another tab's stack mid-gesture: the registry learns it now,
    // at the slot the midpoint walk left it in.
    const index = domOrder(side).indexOf(el.id);
    moveSectionToGroup(el.id, side, index);
    settleAfterMove(el.id, origin, side);
    announce(`${sectionName(side, el.id)} moved to ${groupLabel(side)}`);
    return;
  }

  setSectionOrder(side, domOrder(side));
  syncGripLabels(side);
  announce(`${sectionName(side, el.id)} moved to position ${visibleSections(side).map(n => n.id).indexOf(el.id) + 1}`);
}

function moveToPointer(y) {
  const { side, el } = drag;
  const container = containerOf(side);
  const shown = visibleSections(side);
  const from = shown.indexOf(el);
  if (from === -1) return;

  for (let i = 0; i < shown.length; i++) {
    const other = shown[i];
    if (other === el) continue;
    const r = other.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (i < from && y < mid) { container.insertBefore(el, other); return; }
    if (i > from && y > mid) { container.insertBefore(el, other.nextSibling); return; }
  }
}

/**
 * How far outside its panel the pointer has travelled, in px. Zero while it is
 * still inside.
 *
 * Horizontal only. A section dragged off the top or bottom of a tall panel is
 * being reordered past its neighbours, which is the gesture the reader is
 * already in; only leaving *sideways* is unambiguous about wanting out.
 */
function outsideBy(container, x) {
  if (!container || typeof container.getBoundingClientRect !== 'function') return 0;
  const r = container.getBoundingClientRect();
  // A panel with no width is an *unpinned* one that has auto-closed, which
  // happens mid-drag the moment the pointer leaves it. Reporting "inside" here
  // told the gesture the window had been brought back over its panel, so it
  // docked itself into a rail that is `visibility: hidden` — the window simply
  // vanished. There is no panel to be inside of, so it is outside.
  if (!r.width) return Infinity;
  if (x < r.left) return r.left - x;
  if (x > r.right) return x - r.right;
  return 0;
}

/**
 * Turns a reorder into a window, mid-gesture.
 *
 * The pointer keeps its grip on the same spot of the same element — `grabDX`
 * and `grabDY` were measured at the press — so nothing jumps under the hand at
 * the moment the section comes away. The section keeps the size it had in the
 * panel: pulling something out should not also resize it. And it keeps
 * following its content, as it did in the panel — `fit`, see `applyGeom` in
 * js/panel-float.js.
 */
function tearOff(e) {
  const { side, el } = drag;
  // A card that had been docked into another tab's stack mid-gesture is taken
  // back to its own group's bookkeeping first: a window belongs to the group
  // the registry says it is in, and nothing has told the registry otherwise.
  if (side !== drag.origin) {
    const home = containerOf(drag.origin);
    if (home) home.appendChild(el);
    containerOf(side)?.classList.remove('has-reorder');
    drag.side = drag.origin;
    syncPanelEmpty(side);
  }
  const rect = floatLayerRect();
  const w = Math.round(drag.grabW || 280);
  const h = Math.round(drag.grabH || 260);
  const g = floatSection(el.id, {
    x: e.clientX - rect.left - drag.grabDX,
    y: e.clientY - rect.top - drag.grabDY,
    w, h, fit: true
  });
  if (!g) return false;
  drag.floating = true;
  drag.geom = g;
  // The rest of the gesture is a window being moved, and it snaps the way
  // one moved by its title bar does.
  beginFloatSnap(el.id);
  el.classList.remove('is-reordering');
  const container = containerOf(drag.side);
  if (container) container.classList.remove('has-reorder');
  syncPanelEmpty(drag.side);
  return true;
}

/**
 * Whether a panel is showing enough of itself to drop a window back into.
 *
 * An unpinned panel is a hover rail whose children are `visibility: hidden`,
 * and docking into one puts the section somewhere the reader cannot see and
 * did not ask for. Belt to `outsideBy`'s braces: that answers about the
 * pointer, this about the panel.
 */
function panelIsOpen(side) {
  const panel = document.getElementById(sectionHost(side));
  if (!panel || typeof panel.getBoundingClientRect !== 'function') return true;
  const r = panel.getBoundingClientRect();
  return !r || !('width' in r) || r.width > 8;
}

/**
 * And back: dropping a window over a stack docks it there — its own, or the
 * one another tab is showing. Only the DOM moves; the registry learns about a
 * change of tab when the gesture commits, so Escape has nothing to undo there.
 */
function tearBack(group = drag.origin) {
  const { el } = drag;
  endFloatSnap();
  if (drag.floating) dockSection(el.id);
  drag.floating = false;
  drag.geom = null;
  if (group !== drag.side) {
    const left = drag.side;
    const into = containerOf(group);
    if (into) into.appendChild(el);
    drag.side = group;
    syncPanelEmpty(left);
    syncPanelEmpty(group);
  }
  el.classList.add('is-reordering');
  const container = containerOf(drag.side);
  if (container) container.classList.add('has-reorder');
}

// ── where a card can be dropped ───────────────────────────────────
//  Measured once, when the press becomes a drag: the tab buttons a card can be
//  dropped on, and the stacks the two panels are showing. Neither moves during
//  the gesture — except that an unpinned panel closes as the pointer leaves it,
//  which `panelIsOpen` asks about live before anything is docked there.

function measureDropTargets() {
  const box = el => (el && typeof el.getBoundingClientRect === 'function')
    ? el.getBoundingClientRect() : null;
  const inside = (r, x, y) => !!r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const tabs = PANEL_TAB_NAMES
    .map(tab => ({ tab, group: groupForTab(tab), btn: document.getElementById(PANEL_TABS[tab].tab) }))
    .filter(t => t.group && t.btn)
    .map(t => ({ ...t, rect: box(t.btn) }))
    .filter(t => t.rect && t.rect.width > 0);
  const stacks = PANEL_SIDES
    .map(side => groupForTab(getActivePanelTab(side)))
    .filter(Boolean)
    .map(group => ({ group, rect: box(containerOf(group)) }))
    .filter(z => z.rect && z.rect.width > 0);
  return {
    tabAt: (x, y) => tabs.find(t => inside(t.rect, x, y)) || null,
    stackAt: (x, y) => stacks.find(z => inside(z.rect, x, y)) || null
  };
}

function markTabTarget(target) {
  if (!drag) return;
  if (drag.tabTarget?.btn && drag.tabTarget !== target) {
    drag.tabTarget.btn.classList.remove('is-card-drop-target');
  }
  drag.tabTarget = target;
  if (target?.btn) target.btn.classList.add('is-card-drop-target');
}

/** Keeps a long panel usable: dragging near an edge scrolls it. */
function edgeScroll(container, y) {
  const r = container.getBoundingClientRect();
  if (y < r.top + EDGE_SCROLL_ZONE) container.scrollTop -= EDGE_SCROLL_STEP;
  else if (y > r.bottom - EDGE_SCROLL_ZONE) container.scrollTop += EDGE_SCROLL_STEP;
}

function onPointerMove(e) {
  if (!drag) return;
  if (!drag.active) {
    // Either axis, now: a press that travels sideways out of the panel is a
    // tear-off, and gating the whole gesture on vertical travel would mean a
    // reader pulling straight out got nothing until they wobbled.
    if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD &&
      Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
    drag.active = true;
    drag.targets = measureDropTargets();
    drag.el.classList.add('is-reordering');
    const container = containerOf(drag.side);
    if (container) container.classList.add('has-reorder');
  }
  e.preventDefault();

  // Over a tab button, the card is being moved to that tab: say so, and hold
  // it where it is rather than walking it through a stack it is leaving.
  const overTab = drag.targets?.tabAt(e.clientX, e.clientY) || null;
  markTabTarget(overTab);
  if (overTab && !drag.floating) return;

  const container = containerOf(drag.side);

  if (drag.floating) {
    // Back over a stack is the way to put it in one — the one it came from,
    // or whichever the other panel is showing — and the midpoint walk below
    // then shows where it will land: the same affordance read in the other
    // direction, for free.
    const stack = overTab ? null : drag.targets?.stackAt(e.clientX, e.clientY);
    if (stack && panelIsOpen(stack.group)) {
      tearBack(stack.group);
      moveToPointer(e.clientY);
      return;
    }
    if (!drag.targets && container && outsideBy(container, e.clientX) === 0 && panelIsOpen(drag.side)) {
      tearBack();
      moveToPointer(e.clientY);
      return;
    }
    const rect = floatLayerRect();
    drag.geom = moveFloatTo(drag.el.id,
      e.clientX - rect.left - drag.grabDX,
      e.clientY - rect.top - drag.grabDY, { snap: !(e.ctrlKey || e.metaKey) }) || drag.geom;
    return;
  }

  if (floatingEnabled() && outsideBy(container, e.clientX) > TEAR_THRESHOLD && tearOff(e)) return;

  if (container) edgeScroll(container, e.clientY);
  moveToPointer(e.clientY);
}

// ── the click a drag ends in ──
// The release of a drag that travelled is followed by a click, and the header
// the grip sits in collapses its section on click. The grip's pointer capture
// was meant to keep that click on the grip, whose own handler drops it — but
// the drag *moves the section*: into the float layer on a tear-off, and to a
// new slot on a reorder. Moving a node releases pointer capture, so the release
// lands on whatever is under the pointer, which is the section's own title.
// Chromium then drops the click; Firefox delivers it to the element the grip
// and the title share, which is the header, and the window collapsed the
// moment it was pulled out.
//
// So the drag swallows its own click rather than relying on capture, the way a
// title-bar move in panel-float.js does. Only until the end of the task the
// release arrived in: a click follows its pointerup within that task or not at
// all, and a swallow left armed past it would eat the reader's next deliberate
// click on the header in exactly the browsers that sent none.
let swallowClick = false;
// Escape ends the drag before the button comes up, and the release that
// follows is still the end of a drag.
let releasePending = null;

function armClickSwallow() {
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
}

function onClickCapture(e) {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}

function onPointerUp(e) {
  if (!drag) {
    if (releasePending !== null && (e.pointerId === undefined || e.pointerId === releasePending)) {
      releasePending = null;
      armClickSwallow();
    }
    return;
  }
  if (drag.active) armClickSwallow();
  // A press that never became a drag committed nothing, so there is nothing
  // to write — and writing anyway would replace "no preference" with a copy
  // of the default order on every stray click.
  endDrag(drag.active);
}

function onKeyDown(e) {
  if (!drag) return;
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  if (drag.active) releasePending = drag.pointerId;
  endDrag(false);
}

function beginDrag(side, el, grip, e) {
  if (drag) endDrag(true);
  // Where in the section the reader took hold of it, so a tear-off can keep
  // that spot under the pointer instead of snapping the window to a corner.
  let grabDX = 12;
  let grabDY = 12;
  let grabW = 280;
  let grabH = 260;
  if (typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect();
    if (r.width) {
      grabDX = e.clientX - r.left;
      grabDY = e.clientY - r.top;
      grabW = r.width;
      grabH = r.height;
    }
  }
  drag = {
    side, origin: side, el, grip,
    targets: null,
    tabTarget: null,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    floating: false,
    geom: null,
    grabDX, grabDY, grabW, grabH,
    before: el.nextSibling
  };
  try { grip.setPointerCapture(e.pointerId); } catch (err) { /* mouse still works */ }
}

// ── installing ────────────────────────────────────────────────────

function installGrip(side, id) {
  const el = sectionEl(id);
  const cfg = sectionConfig(id);
  if (!el || !cfg || el.__secGrip) return;
  const header = el.querySelector('.' + cfg.headerClass);
  if (!header) return;

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'panel-sec-grip';
  grip.tabIndex = 0;
  grip.innerHTML = GRIP_SVG;
  grip.setAttribute('data-tip', 'Drag to reorder or onto a tab · ↑ ↓ to move');

  // Right-click anywhere on the header: the way to reach a tab the drag
  // cannot see (one hidden behind the selected tab of a collapsed panel), and
  // with the grip's Shift+F10 the only way from a keyboard.
  header.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    openCardMenu(id, { x: ev.clientX, y: ev.clientY });
  });

  // The header collapses the section on click, and the grip is inside it —
  // so every way a press on the grip can reach the header has to be stopped,
  // or reordering would fold the thing being reordered.
  grip.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); });
  grip.addEventListener('pointerdown', ev => {
    if (ev.button !== undefined && ev.button !== 0) return;
    // A floating section has no position in the panel to reorder. Deliberately
    // *without* stopping propagation, so the press reaches the header's own
    // move gesture and the grip goes on being what it looks like — the thing
    // you take hold of to move this section around.
    if (isSectionFloating(id)) return;
    ev.stopPropagation();
    ev.preventDefault();
    // Asked now, not at install: the card may have been moved to another tab.
    beginDrag(sectionSide(id), el, grip, ev);
  });
  grip.addEventListener('keydown', ev => {
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      ev.stopPropagation();
      openCardMenu(id, null, grip);
      return;
    }
    const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (!delta || isSectionFloating(id)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const side = sectionSide(id);
    // Moved past the *visible* neighbours, not the declared ones: stepping
    // onto a hidden section would look like the key did nothing.
    const shown = visibleSections(side).map(n => n.id);
    const at = shown.indexOf(id);
    if (at === -1) return;
    const target = shown[at + delta];
    if (!target) return;
    moveSection(side, id, sectionOrder(side).indexOf(target));
    applySectionOrder(side);
    grip.focus();
    announce(`${sectionName(side, id)} moved to position ${at + delta + 1} of ${shown.length}`);
  });

  header.insertBefore(grip, header.firstChild);
  el.__secGrip = grip;
}

let listening = false;

/**
 * Gives every section of every panel a grip, and puts both panels in the
 * order the reader left them in.
 *
 * Idempotent — a second call re-labels and re-orders without adding a second
 * grip to anything, which is what lets a caller run it after the DOM has been
 * rebuilt without having to know whether it already ran.
 */
export function initPanelSectionReorder() {
  PANEL_SECTION_SIDES.forEach(side => {
    declaredSectionIds(side).forEach(id => installGrip(side, id));
  });
  // A second pass, because a card moved to another tab is appended by its
  // *new* group's order — every grip has to exist before any stack is laid out.
  PANEL_SECTION_SIDES.forEach(side => {
    applySectionOrder(side);
    syncPanelEmpty(side);
  });

  if (listening) return;
  listening = true;
  // On `document`, not on the grip: a pointer capture can be lost — the
  // element is re-rendered, the button is released outside the window — and a
  // drag that can never end leaves the panel stuck mid-reorder.
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', () => { releasePending = null; endDrag(false); });
  // Capture, so it is ahead of the header's inline `onclick`.
  document.addEventListener('click', onClickCapture, true);
  // Capture, so Escape cancels the drag before anything else claims it —
  // the same reason StateMate's Escape ladder listens in the capture phase.
  document.addEventListener('keydown', onKeyDown, true);
}

/**
 * The two questions a tear-off drag asks about a panel, exposed for the tests.
 *
 * Both were one bug: an unpinned panel auto-closes the moment the pointer
 * leaves it, which is *during* the drag that is pulling a section out of it,
 * and a zero-width panel used to answer "the pointer is inside me".
 */
export const _dropTests = { outsideBy, panelIsOpen };

/**
 * Drops a half-finished gesture. Module state survives `resetApp`, and a drag
 * left in flight would have the next test moving a section from the last one.
 */
export function resetSectionReorder() {
  drag = null;
  swallowClick = false;
  releasePending = null;
}

// ── moving a card to another tab ──────────────────────────────────

/** The stacks on both sides of a move, re-laid out and relabelled. */
function settleAfterMove(id, from, to) {
  const el = sectionEl(id);
  // The dock-fill mark is a property of the stack it was set in.
  if (el) {
    el.classList.remove('panel-dock-fill');
    const sel = sectionFill(id);
    const region = sel && typeof el.querySelector === 'function' ? el.querySelector(sel) : null;
    if (region?.classList) region.classList.remove('panel-dock-fill-region');
  }
  applySectionOrder(from);
  applySectionOrder(to);
  syncPanelEmpty(from);
  syncPanelEmpty(to);
}

/**
 * Moves a card to another tab's stack, at `index` (the end by default).
 *
 * A floating card is docked first: a window belongs to the group that holds
 * its record, and a card changing groups would otherwise leave its record in
 * a store its new group never reads.
 */
export function moveCardTo(id, group, index = Infinity) {
  const from = sectionSide(id);
  if (!from || !PANEL_SECTIONS[group]) return false;
  if (from === group) return false;
  if (isSectionFloating(id)) dockSection(id);
  moveSectionToGroup(id, group, index);
  settleAfterMove(id, from, group);
  announce(`${sectionName(group, id)} moved to ${groupLabel(group)}`);
  return true;
}

/** Every card back on the tab it was declared on, in that tab's default order. */
export function resetCardLayout() {
  const moved = PANEL_SECTION_SIDES.flatMap(g => PANEL_SECTIONS[g].sections.map(s => s.id))
    .filter(id => sectionSide(id) !== declaredGroupOf(id));
  moved.forEach(id => { if (isSectionFloating(id)) dockSection(id); });
  resetSectionPlacement();
  PANEL_SECTION_SIDES.forEach(group => {
    applySectionOrder(group);
    syncPanelEmpty(group);
  });
  announce('Cards back on their own tabs');
}

/** Right-click on a card, or Shift+F10 on its grip: where else it can go. */
export function openCardMenu(id, at, anchor = null) {
  const from = sectionSide(id);
  if (!from) return false;
  const items = PANEL_SECTION_SIDES.filter(g => g !== from).map(group => ({
    label: `Move to ${groupLabel(group)}`,
    run: () => { moveCardTo(id, group); revealSection(id); }
  }));
  if (anySectionMoved()) {
    items.push({ divider: true }, { label: 'Reset Card Layout', run: resetCardLayout });
  }
  return openActionMenu(items, { at, anchor, label: `${sectionName(from, id)} card actions` });
}
