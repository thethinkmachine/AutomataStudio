// ── the mobile shell ──────────────────────────────────────────────
//
// Below 900px the canvas is the whole app and everything else is one bar at
// the bottom of the screen. This module owns that bar, the popover its More
// cell opens, the sheet the panel cell opens, and the header's workspace
// button.
//
// **What it replaced was three stacked bars.** The floating toolbox sat above
// a three-button panel bar which sat above the home indicator, with the zoom
// cluster and the status toast overlapping each other at the top — roughly a
// quarter of a phone screen spent on chrome, most of it duplicated in the
// header. Worse, the toolbox did not work: it was ~640px of buttons in a
// ~366px box, and `touch-action: none` on `.canvas-area` intersects down the
// ancestor chain, so a finger could not scroll it. Shape, Delete, Undo and
// Redo were permanently unreachable, silently, on every phone.
//
// Two rules hold the replacement together:
//
//   - **Nothing here is a second implementation.** A tool cell calls
//     `toggleTool`, the undo cell calls `undo()`, the panel cell calls
//     `toggleMobilePanelTab` — the same entry points the desktop chrome uses,
//     so the two surfaces cannot come to disagree about what a control does.
//   - **Listeners are attached at creation**, the way js/reference.js does it,
//     so the whole feature adds no names to bridge.js.

import { App, $, Workspaces, activeWorkspaceId } from './state.js';
import { toggleTool, toggleMobilePanelTab, closeMobilePanels, getWorkspaceAccent } from './ui.js';
import { undo, redo } from './history.js';
import { autoLayout, toggleSnapToGrid } from './canvas.js';
import { openSettingsFromQuick } from './quick-settings.js';
import { PANEL_TAB_NAMES, PANEL_TABS, getTabSide, isPanelTabActive } from './panel-state.js';

export const MOBILE_QUERY = '(max-width: 900px)';

export function isMobileShell() {
  return !!(window.matchMedia && window.matchMedia(MOBILE_QUERY).matches);
}

// ── the panel cell ────────────────────────────────────────────────
//
// The cell is named for the tab it opens rather than for the container it
// lives in: "Panels" is not a thing anybody wants, and it hid the fact that
// there are three surfaces behind it. Which one it offers is the last one the
// reader looked at, and the sheet opens with all three on a strip across its
// head — so the other two are one tap away and visible, not hidden behind a
// word. Its own preference, never App.config, which is deep-copied into every
// workspace tab and written to IndexedDB.

export const MOBILE_TAB_KEY = 'automata-mobile-tab';

const TAB_META = {
  workspace: {
    label: 'Workspace',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z"/></svg>'
  },
  inspector: {
    label: 'Inspector',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>'
  },
  statemate: {
    label: 'StateMate',
    icon: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169a8,8,0,0,0-4.74-4.74L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144Z"/></svg>'
  }
};

/** The tab the panel cell offers. Falls back to the first real tab. */
export function preferredMobileTab() {
  let stored = null;
  try { stored = localStorage.getItem(MOBILE_TAB_KEY); } catch (e) { }
  if (stored && PANEL_TABS[stored]) return stored;
  return PANEL_TAB_NAMES.includes('inspector') ? 'inspector' : PANEL_TAB_NAMES[0];
}

export function rememberMobileTab(name) {
  if (!PANEL_TABS[name]) return;
  try { localStorage.setItem(MOBILE_TAB_KEY, name); } catch (e) { }
}

/**
 * The tab the cell should currently name.
 *
 * A sheet that is open outranks the remembered preference — the cell is that
 * sheet's own toggle while it is up, so naming a different tab would make one
 * button mean two things depending on state the reader cannot see.
 */
export function mobileBarTabName() {
  const open = PANEL_TAB_NAMES.find(name => {
    const panel = $(getTabSide(name));
    return panel && panel.dataset.mobileCollapsed !== '1' && isPanelTabActive(name);
  });
  return open || preferredMobileTab();
}

/** Paints the panel cell and the tool cells. Cheap, and called from both. */
export function syncMobileBar() {
  const name = mobileBarTabName();
  const meta = TAB_META[name] || TAB_META.inspector;
  const icon = $('mobile-panel-btn-icon');
  const label = $('mobile-panel-btn-label');
  const btn = $('mobile-panel-btn');
  if (icon && icon.dataset.tab !== name) { icon.innerHTML = meta.icon; icon.dataset.tab = name; }
  if (label) label.textContent = meta.label;
  if (btn) {
    const panel = $(getTabSide(name));
    const open = !!panel && panel.dataset.mobileCollapsed !== '1' && isPanelTabActive(name);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-label', open ? `Close ${meta.label}` : `Open ${meta.label}`);
  }
  syncMobileTools();
  syncMobileSheetTabs();
}

/**
 * Marks the cell for the tool that is on.
 *
 * Divider and Region both live behind More, and neither has a cell — so when
 * one is active every cell is unmarked, which is the honest report: the mode
 * the canvas is in is not one of the three on the bar. `setTool` calls this,
 * so the bar and the desktop toolbox are lit by the same line.
 */
export function syncMobileTools() {
  document.querySelectorAll('[data-mobile-tool]').forEach(b => {
    const on = b.getAttribute('data-mobile-tool') === App.tool;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// ── the More popover ──────────────────────────────────────────────
//
// Everything the desktop toolbox and nav cluster carry that does not earn a
// cell. Pan is here rather than on the bar because one finger already pans a
// touch canvas; the zoom stepper is not here at all, because pinch is the zoom
// control and a −/+/% trio on a phone is three cells saying what two fingers
// already say. Fit to screen is the exception and gets its own button over the
// canvas: it is the recovery tap after a pinch goes wrong, and burying the way
// back to your own diagram two taps deep is the wrong trade.

const MORE_ITEMS = [
  { id: 'move', label: 'Pan', kbd: 'V', tool: 'move', icon: 'M90.34,61.66a8,8,0,0,1,0-11.32l32-32a8,8,0,0,1,11.32,0l32,32a8,8,0,0,1-11.32,11.32L136,43.31V96a8,8,0,0,1-16,0V43.31L101.66,61.66A8,8,0,0,1,90.34,61.66Zm64,132.68L136,212.69V160a8,8,0,0,0-16,0v52.69l-18.34-18.35a8,8,0,0,0-11.32,11.32l32,32a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Zm83.32-72-32-32a8,8,0,0,0-11.32,11.32L212.69,120H160a8,8,0,0,0,0,16h52.69l-18.35,18.34a8,8,0,0,0,11.32,11.32l32-32A8,8,0,0,0,237.66,122.34ZM43.31,136H96a8,8,0,0,0,0-16H43.31l18.35-18.34A8,8,0,0,0,50.34,90.34l-32,32a8,8,0,0,0,0,11.32l32,32a8,8,0,0,0,11.32-11.32Z' },
  { id: 'divider', label: 'Divider', kbd: 'L', tool: 'divider', icon: 'M214.64,41.36a32,32,0,0,0-50.2,38.89L80.25,164.44a32.06,32.06,0,0,0-38.89,4.94h0a32,32,0,1,0,50.2,6.37l84.19-84.19a32,32,0,0,0,38.89-50.2Zm-139.33,162a16,16,0,0,1-22.64-22.64h0a16,16,0,0,1,22.63,0h0A16,16,0,0,1,75.31,203.33Zm128-128a16,16,0,1,1,0-22.63A16,16,0,0,1,203.33,75.3Z' },
  { id: 'rect', label: 'Region', kbd: 'R', tool: 'rect', icon: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z' },
  { id: 'del', label: 'Delete', kbd: 'D', tool: 'del', danger: true, icon: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z' },
  { sep: true },
  { id: 'redo', label: 'Redo', kbd: '⌘Y', run: () => redo(), icon: 'M170.34,130.34,204.69,96H88a48,48,0,0,0,0,96h88a8,8,0,0,1,0,16H88A64,64,0,0,1,88,80H204.69L170.34,45.66a8,8,0,0,1,11.32-11.32l48,48a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32-11.32Z' },
  { id: 'layout', label: 'Auto-layout', run: () => autoLayout(), icon: 'M160,112h48a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16V64H128a24,24,0,0,0-24,24v32H72v-8A16,16,0,0,0,56,96H24A16,16,0,0,0,8,112v32a16,16,0,0,0,16,16H56a16,16,0,0,0,16-16v-8h32v32a24,24,0,0,0,24,24h16v16a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V160a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16v16H128a8,8,0,0,1-8-8V88a8,8,0,0,1,8-8h16V96A16,16,0,0,0,160,112ZM56,144H24V112H56v32Zm104,16h48v48H160Zm0-112h48V96H160Z' },
  { id: 'snap', label: 'Snap to grid', toggle: () => !!App.config?.snapToGrid, run: () => toggleSnapToGrid(), icon: 'M216,48H40A16,16,0,0,0,24,64V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM104,144V112h48v32Zm48,16v32H104V160ZM40,112H88v32H40Zm64-16V64h48V96Zm64,16h48v32H168Zm48-16H168V64h48ZM88,64V96H40V64ZM40,160H88v32H40Zm176,32H168V160h48v32Z' },
  { sep: true },
  { id: 'settings', label: 'Canvas settings', run: () => openSettingsFromQuick('rendering'), icon: 'M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Z' }
];

export function isMobileMoreOpen() {
  const menu = $('mobile-more-menu');
  return !!menu && menu.classList.contains('open');
}

export function hideMobileMore() {
  const menu = $('mobile-more-menu');
  if (menu) menu.classList.remove('open');
  const btn = $('mobile-more-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderMobileMore() {
  const menu = $('mobile-more-menu');
  if (!menu) return;
  menu.innerHTML = MORE_ITEMS.map(item => {
    if (item.sep) return '<div class="ctx-divider"></div>';
    const on = item.tool ? App.tool === item.tool : (item.toggle ? item.toggle() : false);
    return `<div class="ctx-i${item.danger ? ' danger' : ''}${on ? ' active' : ''}" role="menuitem" tabindex="0" data-more="${item.id}">
      <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${item.icon}"/></svg>
      ${item.label}${item.kbd ? `<span class="ctx-kbd-hint">${item.kbd}</span>` : ''}
    </div>`;
  }).join('');
}

function runMoreItem(id) {
  const item = MORE_ITEMS.find(i => i.id === id);
  if (!item) return;
  hideMobileMore();
  if (item.tool) { toggleTool(item.tool); return; }
  if (item.run) item.run();
}

export function toggleMobileMore(e) {
  if (e) e.stopPropagation();
  if (isMobileMoreOpen()) { hideMobileMore(); return; }
  const menu = $('mobile-more-menu');
  const btn = $('mobile-more-btn');
  if (!menu || !btn) return;
  renderMobileMore();
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // Anchored to the cell and clamped into the viewport, opening upward — the
  // bar is on the bottom edge, so there is never room below it.
  const r = btn.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - m.width / 2, innerWidth - m.width - 8))}px`;
  menu.style.top = `${Math.max(8, r.top - m.height - 8)}px`;
}

// ── the sheet ─────────────────────────────────────────────────────
//
// A sheet at `min(78dvh, 620px)` over a 100px bar left about 76px of canvas on
// a 390×844 phone — you could not watch a run while the trace log that
// describes it was open, which is the only reason to put it in a sheet rather
// than in a dialog. So it has detents: half by default, full when dragged up,
// dismissed when dragged down past the bottom one.
//
// The strip of tabs across the head is what lets one bar cell stand for three
// surfaces. It lists **every** tab, not the hosting panel's own — the two
// build panels are separate elements, so switching from Workspace to Inspector
// is a change of sheet, and `toggleMobilePanelTab` already knows how to do
// that. Injected rather than written into both panels' markup, the same
// reasoning as `installModalChrome()`.

export const SHEET_DETENTS = Object.freeze({ half: 0.52, full: 0.88 });
export const SHEET_DISMISS_TRAVEL = 90;
export const MOBILE_SHEET_IDS = ['lpanel', 'rpanel'];

/** The detent a sheet is resting at. Not persisted: a sheet opens at half. */
let sheetDetent = 'half';

export function mobileSheetDetent() { return sheetDetent; }

export function setMobileSheetDetent(name) {
  sheetDetent = SHEET_DETENTS[name] ? name : 'half';
  MOBILE_SHEET_IDS.forEach(id => {
    const el = $(id);
    if (el) el.dataset.detent = sheetDetent;
  });
}

function sheetTabsMarkup() {
  return PANEL_TAB_NAMES.map(name => {
    const meta = TAB_META[name] || { label: name, icon: '' };
    const on = isPanelTabActive(name) && $(getTabSide(name))?.dataset.mobileCollapsed !== '1';
    return `<button class="mobile-sheet-tab${on ? ' is-on' : ''}" type="button" role="tab"
      aria-selected="${on ? 'true' : 'false'}" data-sheet-tab="${name}">
      <span class="mobile-sheet-tab-icon" aria-hidden="true">${meta.icon}</span>
      <span class="mobile-sheet-tab-label">${meta.label}</span>
    </button>`;
  }).join('');
}

/** Repaints the selected mark on every injected strip. */
export function syncMobileSheetTabs() {
  document.querySelectorAll('[data-sheet-tab]').forEach(btn => {
    const name = btn.getAttribute('data-sheet-tab');
    const panel = $(getTabSide(name));
    const on = isPanelTabActive(name) && !!panel && panel.dataset.mobileCollapsed !== '1';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

/**
 * The grab handle, the tab strip and the close button, once per sheet.
 *
 * Idempotent, and the flag is set last so a throw halfway through leaves the
 * sheet un-chromed rather than half-chromed — the rule `installChrome` in
 * js/panel-float.js follows for the same reason.
 */
function installSheetChrome(id) {
  const panel = $(id);
  if (!panel || panel._mobileSheetChrome) return;
  const head = document.createElement('div');
  head.className = 'mobile-sheet-head';
  head.innerHTML = `
    <button class="mobile-sheet-grab" type="button" aria-label="Resize panel"
            aria-expanded="false"><span aria-hidden="true"></span></button>
    <div class="mobile-sheet-tabs" role="tablist" aria-label="Panels">${sheetTabsMarkup()}</div>`;

  head.querySelectorAll('[data-sheet-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-sheet-tab');
      rememberMobileTab(name);
      toggleMobilePanelTab(name);
      // The tab may have moved the sheet to the other panel; repaint both.
      syncMobileBar();
    });
  });

  const grab = head.querySelector('.mobile-sheet-grab');
  if (grab) installSheetDrag(grab, panel);

  panel.insertBefore(head, panel.firstChild);
  panel._mobileSheetChrome = true;
}

/**
 * Drag the head to resize, tap it to toggle between the two detents.
 *
 * **The capture is taken on `pointerdown`, not on the first movement**, which
 * is the opposite of what js/panel-float.js does — and the difference is the
 * handle's height. A title bar is tall enough that the first few pixels of a
 * drag are still over it; this mark is 20px, so the very first `pointermove`
 * of an upward drag has already left the element and the gesture silently
 * never started. Capturing early is safe here only because there is no `click`
 * listener to lose: a tap is `pointerup` with no travel, handled below, so
 * nothing depends on the browser's click target surviving the retarget.
 *
 * One gesture, one pointer: these are the same rules the float windows follow,
 * for the same reason — a second finger would otherwise drive the sheet from
 * its own coordinates.
 */
function installSheetDrag(grab, panel) {
  let drag = null;

  const height = () => (window.visualViewport?.height || innerHeight);

  grab.addEventListener('pointerdown', e => {
    if (!isMobileShell() || drag) return;
    drag = { id: e.pointerId, y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
    try { grab.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  });

  grab.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      panel.classList.add('is-dragging');
    }
    // Downward drag shrinks; the floor is well under the smaller detent so the
    // sheet visibly follows the finger all the way into a dismissal.
    const next = Math.max(80, Math.min(drag.h - dy, height() * 0.92));
    panel.style.height = `${next}px`;
    e.preventDefault();
  });

  const finish = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const started = drag;
    drag = null;
    try { grab.releasePointerCapture(e.pointerId); } catch (err) { }
    panel.classList.remove('is-dragging');
    panel.style.height = '';

    if (!started.moved) {
      setMobileSheetDetent(sheetDetent === 'full' ? 'half' : 'full');
      grab.setAttribute('aria-expanded', sheetDetent === 'full' ? 'true' : 'false');
      return;
    }
    const dy = e.clientY - started.y;
    if (dy > SHEET_DISMISS_TRAVEL && sheetDetent === 'half') { closeMobilePanels(); return; }
    if (dy > SHEET_DISMISS_TRAVEL) { setMobileSheetDetent('half'); return; }
    if (dy < -SHEET_DISMISS_TRAVEL / 2) setMobileSheetDetent('full');
    grab.setAttribute('aria-expanded', sheetDetent === 'full' ? 'true' : 'false');
  };
  grab.addEventListener('pointerup', finish);
  grab.addEventListener('pointercancel', finish);
}

// ── the header's workspace button ─────────────────────────────────

/** Names the active workspace on the button that opens the list of them. */
export function syncMobileWorkspaceButton() {
  const name = $('mobile-ws-name');
  const dirty = $('mobile-ws-dirty');
  const btn = $('mobile-ws-btn');
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (name) name.textContent = ws ? (ws.name || 'Workspace') : 'Workspace';
  if (dirty) dirty.hidden = !(ws && ws.dirty);
  if (btn) {
    btn.setAttribute('aria-label',
      `Switch workspace — ${ws ? (ws.name || 'Workspace') : 'Workspace'}${Workspaces.length > 1 ? ` of ${Workspaces.length}` : ''}`);
    btn.style.setProperty('--ws-accent', ws ? getWorkspaceAccent(ws) : 'var(--accent)');
  }
}

// ── wiring ────────────────────────────────────────────────────────

export function initMobileShell() {
  document.querySelectorAll('[data-mobile-tool]').forEach(btn => {
    if (btn._mobileInit) return;
    btn._mobileInit = true;
    btn.addEventListener('click', () => {
      hideMobileMore();
      toggleTool(btn.getAttribute('data-mobile-tool'));
    });
  });

  const more = $('mobile-more-btn');
  if (more && !more._mobileInit) {
    more._mobileInit = true;
    more.addEventListener('click', toggleMobileMore);
  }

  const menu = $('mobile-more-menu');
  if (menu && !menu._mobileInit) {
    menu._mobileInit = true;
    // Delegated, because the rows are rebuilt on every open to carry the
    // active marks.
    menu.addEventListener('click', e => {
      const row = e.target.closest && e.target.closest('[data-more]');
      if (!row) return;
      e.stopPropagation();
      runMoreItem(row.getAttribute('data-more'));
    });
    menu.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest && e.target.closest('[data-more]');
      if (!row) return;
      e.preventDefault();
      runMoreItem(row.getAttribute('data-more'));
    });
  }

  const undoBtn = $('mobile-undo-btn');
  if (undoBtn && !undoBtn._mobileInit) {
    undoBtn._mobileInit = true;
    undoBtn.addEventListener('click', () => { hideMobileMore(); undo(); });
  }

  const panelBtn = $('mobile-panel-btn');
  if (panelBtn && !panelBtn._mobileInit) {
    panelBtn._mobileInit = true;
    panelBtn.addEventListener('click', () => {
      hideMobileMore();
      const name = mobileBarTabName();
      rememberMobileTab(name);
      setMobileSheetDetent('half');
      toggleMobilePanelTab(name);
      syncMobileBar();
    });
  }

  MOBILE_SHEET_IDS.forEach(installSheetChrome);
  setMobileSheetDetent(sheetDetent);
  syncMobileWorkspaceButton();
  syncMobileBar();
}

/**
 * Everything this module remembers between calls.
 *
 * `sheetDetent` is the one piece of module state that survives a reset of the
 * app, and the chrome flags live on elements the stub throws away — so this is
 * only ever one line. `resetModuleState()` in tests/harness.js calls it: a
 * sheet left at its full detent would otherwise have the next test measuring a
 * height it never asked for.
 */
export function resetMobileShell() {
  sheetDetent = 'half';
  hideMobileMore();
}

// A tap anywhere else dismisses the popover, the way every other .ctx menu in
// the app behaves. Capture-phase would pre-empt the bar's own cells.
document.addEventListener('click', () => hideMobileMore());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isMobileMoreOpen()) { hideMobileMore(); e.stopPropagation(); }
});
