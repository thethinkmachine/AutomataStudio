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
// Listeners are attached at creation the way [js/reference.js](reference.js)
// does it, so the whole feature adds nothing to `bridge.js`.

import {
  PANEL_SECTIONS, PANEL_SECTION_SIDES, declaredSectionIds, dockedSectionIds,
  isSectionFloating, sectionOrder, setSectionOrder, moveSection
} from './panel-sections.js';
import {
  commitFloatGeom, dockSection, floatLayerRect, floatSection, floatingEnabled,
  moveFloatTo, syncPanelEmpty
} from './panel-float.js';

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
  const cfg = PANEL_SECTIONS[side];
  const title = el && cfg ? el.querySelector('.' + cfg.titleClass) : null;
  return (title ? title.textContent : '').trim() || id;
}

/**
 * The sections a drag can land between.
 *
 * Hidden ones are skipped — `applyMachineSwitch` hides the stack and output
 * sections for machines without a stack or an output, and a zero-height box
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
  const known = declaredSectionIds(side);
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

function endDrag(commit) {
  if (!drag) return;
  const { side, el, grip, pointerId, floating } = drag;
  const container = containerOf(side);

  if (!commit) {
    // Escape puts it back exactly where it was, which is the whole reason the
    // gesture remembers anything at all — and once the drag can also change
    // which *parent* the section has, "where it was" is a parent as well as a
    // neighbour.
    if (floating) dockSection(el.id);
    if (drag.before !== undefined) {
      if (drag.before) container.insertBefore(el, drag.before);
      else container.appendChild(el);
    }
  } else if (floating) {
    // The move painted every frame and wrote nothing; this is the one write.
    commitFloatGeom(el.id, drag.geom);
  }

  el.classList.remove('is-reordering');
  if (container) container.classList.remove('has-reorder');
  try { grip.releasePointerCapture(pointerId); } catch (e) { /* already gone */ }
  drag = null;

  if (commit && floating) {
    syncGripLabels(side);
    announce(`${sectionName(side, el.id)} floating over the canvas`);
    return;
  }

  const order = domOrder(side);
  if (commit) {
    setSectionOrder(side, order);
    syncGripLabels(side);
    announce(`${sectionName(side, el.id)} moved to position ${visibleSections(side).map(n => n.id).indexOf(el.id) + 1}`);
  } else {
    syncGripLabels(side);
  }
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
 * panel: pulling something out should not also resize it.
 */
function tearOff(e) {
  const { side, el } = drag;
  const rect = floatLayerRect();
  const w = Math.round(drag.grabW || 280);
  const h = Math.round(drag.grabH || 260);
  const g = floatSection(el.id, {
    x: e.clientX - rect.left - drag.grabDX,
    y: e.clientY - rect.top - drag.grabDY,
    w, h
  });
  if (!g) return false;
  drag.floating = true;
  drag.geom = g;
  el.classList.remove('is-reordering');
  const container = containerOf(side);
  if (container) container.classList.remove('has-reorder');
  syncPanelEmpty(side);
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
  const panel = document.getElementById(side);
  if (!panel || typeof panel.getBoundingClientRect !== 'function') return true;
  const r = panel.getBoundingClientRect();
  return !r || !('width' in r) || r.width > 8;
}

/** And back: dropping a window over its own panel re-docks it. */
function tearBack() {
  const { side, el } = drag;
  dockSection(el.id);
  drag.floating = false;
  drag.geom = null;
  el.classList.add('is-reordering');
  const container = containerOf(side);
  if (container) container.classList.add('has-reorder');
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
    drag.el.classList.add('is-reordering');
    const container = containerOf(drag.side);
    if (container) container.classList.add('has-reorder');
  }
  e.preventDefault();
  const container = containerOf(drag.side);

  if (drag.floating) {
    // Back over the panel it came from is the way to put it back, and the
    // midpoint walk below then shows where it will land — the same affordance
    // read in the other direction, for free.
    if (container && outsideBy(container, e.clientX) === 0 && panelIsOpen(drag.side)) {
      tearBack();
      moveToPointer(e.clientY);
      return;
    }
    const rect = floatLayerRect();
    drag.geom = moveFloatTo(drag.el.id,
      e.clientX - rect.left - drag.grabDX,
      e.clientY - rect.top - drag.grabDY) || drag.geom;
    return;
  }

  if (floatingEnabled() && outsideBy(container, e.clientX) > TEAR_THRESHOLD && tearOff(e)) return;

  if (container) edgeScroll(container, e.clientY);
  moveToPointer(e.clientY);
}

function onPointerUp() {
  if (!drag) return;
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
    side, el, grip,
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
  const cfg = PANEL_SECTIONS[side];
  if (!el || !cfg || el.__secGrip) return;
  const header = el.querySelector('.' + cfg.headerClass);
  if (!header) return;

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'panel-sec-grip';
  grip.tabIndex = 0;
  grip.innerHTML = GRIP_SVG;
  grip.setAttribute('data-tip', 'Drag to reorder · ↑ ↓ to move');

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
    beginDrag(side, el, grip, ev);
  });
  grip.addEventListener('keydown', ev => {
    const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (!delta || isSectionFloating(id)) return;
    ev.preventDefault();
    ev.stopPropagation();
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
    applySectionOrder(side);
    syncGripLabels(side);
  });

  if (listening) return;
  listening = true;
  // On `document`, not on the grip: a pointer capture can be lost — the
  // element is re-rendered, the button is released outside the window — and a
  // drag that can never end leaves the panel stuck mid-reorder.
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', () => endDrag(false));
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

/** Whether a reorder gesture is in flight — the tests' way in. */
export function isReorderingSections() {
  return !!(drag && drag.active);
}

/**
 * Drops a half-finished gesture. Module state survives `resetApp`, and a drag
 * left in flight would have the next test moving a section from the last one.
 */
export function resetSectionReorder() {
  drag = null;
}
