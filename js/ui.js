import { utmStepBack, utmStepFwd, utmToggleAuto } from './algorithms-fa.js';
import { renderGamma } from './alphabet.js';
import { settleAll } from './anim.js';
import { applyCamera, clearEdgeDirectionHighlight, clearTempLine, copySelection, duplicateSelection, getContentBounds, hideCanvasContextMenu, hlState, nudgeSelected, pasteClipboard, selectAllStates, toggleSnapToGrid, wrap } from './canvas.js';
import { isQuickSettingsOpen, positionQuickSettings, refreshQuickSettings } from './quick-settings.js';
import { clearDividerSelection, deleteSelectedDivider, includeDividerBounds, updateShapeToolButton } from './dividers.js';
import { markDirty, redo, snapshot, snapshotSettings, undo } from './history.js';
import { renderMinimap, scheduleMinimap } from './minimap.js';
import { anyModalOpen, closeModal, registerModal, showOverlay } from './modal.js';
import { includeNoteBounds, pruneNoteAnchorsExcluding } from './notes.js';
import { restartAutosaveTimer, saveBackupChecked, saveJSON, saveWorkspace, saveWorkspaceById } from './persistence.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { resetSim, restartAutoTimerIfPlaying, stepBack, stepFwd } from './simulation.js';
import { $, App, MachineCategories, MachineTypes, R, Workspaces, activeWorkspaceId, exportWorkspaceState, importWorkspaceState, migrateSystemSymbols, normalizeEdgeLabelStyle, setActiveWorkspaceId, setR, setWorkspaces } from './state.js';
import { getState, getTransition, hideContextMenu } from './states-transitions.js';
import { Change, emit, subscribe } from './store.js';
import { DEFAULT_THEME, Themes } from './themes.js';
import { clearAll, escapeHtml, showStatus } from './utils.js';
import { AUX_VIEWS, applyMachineSwitch, closeAuxView, hideMoreMenu, hideToolsMenu, setMachine, setView } from './view.js';

subscribe(Change.TABS, renderTabs);
subscribe(Change.SAVE, updateSaveIndicator);

// ══════════════════════════════════════════════════════════════════
//  WORKSPACE TABS UI
// ══════════════════════════════════════════════════════════════════
// Tab accent reflects the workspace's machine *category* (not the exact type)
// so a glance at the dot tells you "finite automaton" vs "stack machine" vs
// "Turing machine" vs "transducer" without needing 18 distinct colors.
export const CATEGORY_ACCENT_VAR = { fa: '--accent', mem: '--green', tm: '--orange', special: '--purple' };
export let editingTabId = null;
export let draggingTabId = null;
export let tabDropTargetId = null;
export let tabDropPosition = null;
export let closedWorkspaces = [];
export let saveState = 'saved';

export function getWorkspaceMachine(ws) {
  if (!ws) return null;
  return ws.id === activeWorkspaceId ? App.machine : ws.data?.machine;
}

export function getWorkspaceAccent(ws) {
  const machine = getWorkspaceMachine(ws);
  const cat = machine && MachineTypes[machine] ? MachineTypes[machine].category : null;
  return `var(${CATEGORY_ACCENT_VAR[cat] || '--accent'})`;
}

export function markActiveWorkspaceSaved() {
  if (!activeWorkspaceId) return;
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (ws && ws.dirty) {
    ws.dirty = false;
    renderTabs();
  }
}

// The single source of truth for everything the Save button displays: its
// colour, its tooltip, and the unsaved dot. The dot used to be toggled
// separately from `Workspaces.some(dirty)` while the colour came from here,
// which let the two disagree — an orange icon with no dot, or a dot left over
// after the state moved on. Both are derived from `state` now.
export function setSaveState(state, message) {
  saveState = state;
  const btn = $('save-now-btn');
  const labels = { unsaved: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
  const label = message || labels[state] || labels.saved;
  if (btn) {
    btn.dataset.saveState = state;
    btn.dataset.tip = label === 'Saved' ? 'Save workspace' : `${label} — save workspace`;
    btn.setAttribute('aria-label', label === 'Saved' ? 'Save workspace — saved' : `${label} — save workspace`);
    // "There is something to save" — true while unsaved, and still true when a
    // save failed, since the work is in fact still unsaved.
    btn.classList.toggle('is-dirty', state === 'unsaved' || state === 'error');
  }
}

export function escapeTabText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function updateTabOverflowShadows(tb = $('tab-bar')) {
  if (!tb) return;
  const maxScroll = Math.max(0, tb.scrollWidth - tb.clientWidth);
  const hasOverflow = maxScroll > 2;
  tb.classList.toggle('has-overflow-left', hasOverflow && tb.scrollLeft > 2);
  tb.classList.toggle('has-overflow-right', hasOverflow && tb.scrollLeft < maxScroll - 2);
  // The strip can't fit every tab (which happens with far fewer tabs on a
  // narrow/mobile viewport) — surface the jump-to-tab dropdown as an
  // alternative to hunting via horizontal scroll or drag.
  const btn = $('tab-overflow-btn');
  if (btn) {
    btn.classList.toggle('show', hasOverflow);
    if (!hasOverflow) hideTabOverflowMenu();
  }
}

export function focusTabElement(id) {
  const tb = $('tab-bar');
  if (!tb) return;
  const tab = tb.querySelector(`.tab[data-tab-id="${id}"]`);
  if (tab) tab.focus();
}

export function clearTabDropMarkers(tb = $('tab-bar')) {
  if (!tb) return;
  tb.querySelectorAll('.tab.drop-before, .tab.drop-after, .tab.drop-end').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'drop-end');
  });
}

export function moveWorkspaceTab(sourceId, targetId, position = 'after') {
  const fromIdx = Workspaces.findIndex(w => w.id === sourceId);
  const targetIdx = Workspaces.findIndex(w => w.id === targetId);
  if (fromIdx === -1 || targetIdx === -1 || sourceId === targetId) return false;

  const [moved] = Workspaces.splice(fromIdx, 1);
  const baseIdx = Workspaces.findIndex(w => w.id === targetId);
  const insertIdx = position === 'before' ? baseIdx : baseIdx + 1;
  Workspaces.splice(Math.max(0, insertIdx), 0, moved);
  return true;
}

export function moveWorkspaceTabToEnd(sourceId) {
  const fromIdx = Workspaces.findIndex(w => w.id === sourceId);
  if (fromIdx === -1 || fromIdx === Workspaces.length - 1) return false;
  const [moved] = Workspaces.splice(fromIdx, 1);
  Workspaces.push(moved);
  return true;
}

export function finishTabDrag() {
  clearTabDropMarkers();
  const tb = $('tab-bar');
  if (tb) tb.querySelectorAll('.tab.dragging').forEach(el => el.classList.remove('dragging'));
  draggingTabId = null;
  tabDropTargetId = null;
  tabDropPosition = null;
}

export function handleTabDragStart(id, e) {
  if (editingTabId === id || Workspaces.length < 2) {
    e.preventDefault();
    return;
  }
  draggingTabId = id;
  tabDropTargetId = null;
  tabDropPosition = null;
  if (e.currentTarget) e.currentTarget.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) { }
  }
}

export function handleTabDragOver(id, e) {
  if (!draggingTabId || id === draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();

  const tabEl = e.currentTarget;
  if (!tabEl) return;

  const rect = tabEl.getBoundingClientRect();
  const position = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';

  if (tabDropTargetId === id && tabDropPosition === position) return;
  tabDropTargetId = id;
  tabDropPosition = position;

  clearTabDropMarkers();
  tabEl.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

export function handleTabDrop(id, e) {
  if (!draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();

  const tabEl = e.currentTarget;
  const rect = tabEl?.getBoundingClientRect?.();
  const position = rect && (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';

  const moved = moveWorkspaceTab(draggingTabId, id, position);
  const movedId = draggingTabId;
  finishTabDrag();
  if (!moved) return;

  renderTabs();
  saveBackupChecked();
  requestAnimationFrame(() => focusTabElement(movedId));
}

export function handleTabDragEnd() {
  finishTabDrag();
}

export function handleTabAddDragOver(e) {
  if (!draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();
  clearTabDropMarkers();
  if (e.currentTarget) e.currentTarget.classList.add('drop-end');
}

export function handleTabAddDrop(e) {
  if (!draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();
  const movedId = draggingTabId;
  const moved = moveWorkspaceTabToEnd(draggingTabId);
  finishTabDrag();
  if (!moved) return;

  renderTabs();
  saveBackupChecked();
  requestAnimationFrame(() => focusTabElement(movedId));
}

export function handleCreateTabKeydown(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    createTab();
  }
}

export function handleTabKeydown(id, e) {
  if (editingTabId === id) return;

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    switchTab(id);
    return;
  }

  if (e.key === 'F2') {
    e.preventDefault();
    e.stopPropagation();
    beginRenameTab(id, e);
    return;
  }

  if (e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w')) {
    e.preventDefault();
    e.stopPropagation();
    closeTab(id, e);
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    const ids = Workspaces.map(w => w.id);
    if (!ids.length) return;
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextId = ids[(idx + delta + ids.length) % ids.length];
    if (!nextId) return;
    switchTab(nextId);
    requestAnimationFrame(() => focusTabElement(nextId));
  }
}

export function beginRenameTab(id, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  editingTabId = id;
  renderTabs();
}

export function handleTabRenameKeydown(id, e) {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    commitTabRename(id, e.target);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    editingTabId = null;
    renderTabs();
    requestAnimationFrame(() => focusTabElement(id));
  }
}

export function commitTabRename(id, inputEl) {
  if (editingTabId !== id) return;
  const ws = Workspaces.find(w => w.id === id);
  if (!ws) {
    editingTabId = null;
    renderTabs();
    return;
  }

  const candidate = String(inputEl?.value || '').trim();
  if (candidate) ws.name = candidate.slice(0, 40);

  editingTabId = null;
  renderTabs();
  saveBackupChecked();
}

export function renderTabs() {
  const tb = $('tab-bar');
  if (!tb) return;
  tb.setAttribute('role', 'tablist');
  tb.setAttribute('aria-label', 'Workspace tabs');

  tb.innerHTML = Workspaces.map(ws => {
    const isActive = ws.id === activeWorkspaceId;
    const isEditing = ws.id === editingTabId;
    const dragClass = draggingTabId === ws.id ? 'dragging' : '';
    const safeName = escapeTabText(ws.name || 'Workspace');
    const machine = getWorkspaceMachine(ws);
    const machineLabel = machine && MachineTypes[machine] ? MachineTypes[machine].label : '';
    const nameMarkup = isEditing
      ? `<input class="tab-rename-input" value="${safeName}" maxlength="40" aria-label="Rename workspace" onclick="event.stopPropagation()" onkeydown="handleTabRenameKeydown('${ws.id}', event)" onblur="commitTabRename('${ws.id}', this)">`
      : `<span class="tab-name" data-tip="${safeName}${machineLabel ? ' — ' + escapeTabText(machineLabel) : ''}">${safeName}</span>`;

    return `
    <div class="tab ${isActive ? 'active' : ''} ${dragClass}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? '0' : '-1'}" data-tab-id="${ws.id}" style="--tab-accent:${getWorkspaceAccent(ws)}" draggable="${isEditing ? 'false' : 'true'}" onclick="switchTab('${ws.id}')" ondblclick="beginRenameTab('${ws.id}', event)" onkeydown="handleTabKeydown('${ws.id}', event)" oncontextmenu="showTabContextMenu('${ws.id}', event); return false;" ondragstart="handleTabDragStart('${ws.id}', event)" ondragover="handleTabDragOver('${ws.id}', event)" ondrop="handleTabDrop('${ws.id}', event)" ondragend="handleTabDragEnd(event)">
      <span class="tab-dot" aria-hidden="true"></span>
      ${machineLabel ? `<span class="sr-only">${escapeTabText(machineLabel)} — </span>` : ''}
      ${nameMarkup}
      ${ws.dirty ? '<span class="tab-dirty" aria-hidden="true" data-tip="Unsaved changes"></span>' : ''}
      ${Workspaces.length > 1 ? `<button class="tab-close" type="button" aria-label="Close ${safeName}" onclick="closeTab('${ws.id}', event)"><svg width="10" height="10" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></button>` : ''}
    </div>
  `;
  }).join('') + `
    <div class="tab tab-add" role="button" tabindex="0" aria-label="Create workspace" draggable="false" onclick="createTab()" onkeydown="handleCreateTabKeydown(event)" ondragover="handleTabAddDragOver(event)" ondrop="handleTabAddDrop(event)">
      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>
    </div>
  `;

  // Enable horizontal scrolling with standard mouse wheel
  tb.onwheel = (e) => {
    if (e.deltaY !== 0) {
      tb.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  tb.onscroll = () => updateTabOverflowShadows(tb);
  requestAnimationFrame(() => {
    updateTabOverflowShadows(tb);
    if (editingTabId) {
      const input = tb.querySelector('.tab-rename-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  });

  renderTabOverflowMenu();
  updateSaveIndicator();
}

// The Save button carries the same unsaved marker as the tabs. Driven from
// renderTabs, which is already the one place dirty state changes are drawn.
//
// `saving` and `error` are both owned by the save itself and must survive this:
// renderTabs runs from ~18 call sites, so recomputing the state here from
// `dirty` alone used to wipe a "Save failed" the moment any unrelated tab
// activity redrew — reporting a workspace as stored when it was not.
// Whatever started those states is responsible for ending them.
export function updateSaveIndicator() {
  const btn = $('save-now-btn');
  if (!btn) return;
  if (saveState === 'saving' || saveState === 'error') return;
  setSaveState(Workspaces.some(w => w.dirty) ? 'unsaved' : 'saved');
}

export function renderTabOverflowMenu() {
  const menu = $('tab-overflow-menu');
  if (!menu || menu.style.display !== 'block') return;
  menu.innerHTML = Workspaces.map(ws => {
    const isActive = ws.id === activeWorkspaceId;
    const safeName = escapeTabText(ws.name || 'Workspace');
    return `
    <div class="tab-overflow-item ${isActive ? 'active' : ''}" role="option" aria-selected="${isActive ? 'true' : 'false'}" tabindex="0" style="--item-accent:${getWorkspaceAccent(ws)}" onclick="switchTabFromOverflow('${ws.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();switchTabFromOverflow('${ws.id}');}">
      <span class="tab-overflow-item-dot" aria-hidden="true"></span>
      <span class="tab-overflow-item-name" data-tip="${safeName}">${safeName}</span>
      ${ws.dirty ? '<span class="tab-overflow-item-dirty" aria-hidden="true" data-tip="Unsaved changes"></span>' : ''}
      ${Workspaces.length > 1 ? `<button class="tab-overflow-item-close" type="button" aria-label="Close ${safeName}" onclick="event.stopPropagation(); closeTab('${ws.id}', event); renderTabOverflowMenu();"><svg viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></button>` : ''}
    </div>
  `;
  }).join('');
}

export function switchTabFromOverflow(id) {
  hideTabOverflowMenu();
  switchTab(id);
  requestAnimationFrame(() => {
    const tabEl = $('tab-bar')?.querySelector(`.tab[data-tab-id="${id}"]`);
    if (tabEl) tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

export function toggleTabOverflowMenu(e) {
  e.stopPropagation();
  const menu = $('tab-overflow-menu');
  if (!menu) return;
  if (menu.style.display === 'block') { hideTabOverflowMenu(); return; }
  hideTabContextMenu();
  if (typeof hideContextMenu === 'function') hideContextMenu();
  if (typeof hideCanvasContextMenu === 'function') hideCanvasContextMenu();
  const btn = $('tab-overflow-btn');
  const r = e.currentTarget.getBoundingClientRect();
  // Render first so the menu has its real height/width before we place it.
  menu.style.display = 'block';
  menu.style.visibility = 'hidden';
  if (btn) btn.setAttribute('aria-expanded', 'true');
  renderTabOverflowMenu();
  const m = menu.getBoundingClientRect();
  // Right-align the menu to the button, clamped inside the viewport, and
  // flip it above the button when there isn't room below.
  menu.style.left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8)) + 'px';
  const below = r.bottom + 6;
  menu.style.top = (below + m.height > innerHeight - 8
    ? Math.max(8, r.top - 6 - m.height)
    : below) + 'px';
  menu.style.visibility = '';
}

export function hideTabOverflowMenu() {
  const menu = $('tab-overflow-menu');
  if (menu) menu.style.display = 'none';
  const btn = $('tab-overflow-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', () => hideTabOverflowMenu());

export function createTab(name) {
  const body = document.querySelector('.app-body');
  if (body) {
    body.classList.remove('tab-switching');
    void body.offsetWidth;
    body.classList.add('tab-switching');
  }

  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) {
      act.data = exportWorkspaceState();
    }
  }

  let wsName = name || `Workspace ${Workspaces.length + 1}`;
  const newWs = {
    id: 'ws_' + Date.now() + '_' + Math.random().toString(36).substring(2,9),
    name: wsName,
    dirty: false,
    data: {
      machine: 'DFA', sigma: ['a', 'b'], outputAlpha: ['0', '1'], stackAlpha: ['Z'], tapeCount: 2,
      states: [], transitions: [], startId: null, accepts: [], stateN: 0, transN: 0, cam: { x: 0, y: 0, z: 1 },
      history: [], future: [], grammar: { vars: ['S'], start: 'S', productions: [] }
    }
  };
  Workspaces.push(newWs);
  editingTabId = null;
  
  importWorkspaceState(newWs.data);
  setActiveWorkspaceId(newWs.id);

  App.selectedStates.clear();
  App.selectedTransitions.clear();
  if (typeof resetSim === 'function') resetSim();
  if (typeof applyMachineSwitch === 'function') applyMachineSwitch(App.machine);
  
  renderTabs();
  renderAll();
  if (typeof applyCamera === 'function') applyCamera();
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  // Each tab carries its own config, so activating one can bring different
  // canvas settings with it — the same reason R gets republished here.
  if (typeof refreshQuickSettings === 'function') refreshQuickSettings();
  saveBackupChecked();
}

export function switchTab(id) {
  if (id === activeWorkspaceId) return;
  
  const body = document.querySelector('.app-body');
  if (body) {
    body.classList.remove('tab-switching');
    void body.offsetWidth; // trigger reflow
    body.classList.add('tab-switching');
  }

  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) {
      act.data = exportWorkspaceState();
    }
  }

  setActiveWorkspaceId(id);
  editingTabId = null;
  const curr = Workspaces.find(w => w.id === id);
  if (curr && curr.data) {
    importWorkspaceState(curr.data);
  }
  
  App.selectedStates.clear();
  App.selectedTransitions.clear();
  if (typeof resetSim === 'function') resetSim();
  if (typeof applyMachineSwitch === 'function') {
    // Re-bind toolbar UI to match machine switch
    applyMachineSwitch(App.machine);
  }

  renderTabs();
  renderAll();
  if (typeof applyCamera === 'function') applyCamera();
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  // Each tab carries its own config, so activating one can bring different
  // canvas settings with it — the same reason R gets republished here.
  if (typeof refreshQuickSettings === 'function') refreshQuickSettings();
  saveBackupChecked();
}

// ── Unsaved-changes guard ─────────────────────────────────────────
// Closing a tab is undoable via the toast, but the undo stack is capped and
// in-memory, so a dirty tab still deserves an explicit prompt. Every close
// path routes through here: it resolves which of the tabs being closed are
// dirty, and only then runs `proceed`.
//
// `proceed` is invoked for Save and Discard alike — Save just persists first.
// Cancel simply never calls it, leaving the workspace untouched.
export function confirmDiscardingTabs(ids, proceed) {
  const dirty = ids
    .map(id => Workspaces.find(w => w.id === id))
    .filter(ws => ws && ws.dirty);

  if (!dirty.length) { proceed(); return; }

  const many = dirty.length > 1;
  const msgEl = $('unsaved-msg');
  if (msgEl) {
    msgEl.textContent = many
      ? `${dirty.length} tabs have unsaved changes. Save them before closing?`
      : `"${dirty[0].name}" has unsaved changes. Save before closing?`;
  }

  const saveBtn = $('unsaved-save-btn');
  const discardBtn = $('unsaved-discard-btn');
  if (saveBtn) {
    saveBtn.textContent = many ? 'Save all' : 'Save';
    saveBtn.onclick = async () => {
      // A failed save must not close the tab — that would destroy the very
      // work the prompt exists to protect. saveWorkspaceById reports the
      // failure itself; leaving the dialog open lets the user retry or
      // deliberately discard.
      saveBtn.disabled = true;
      let allSaved = true;
      for (const ws of dirty) {
        if (!await saveWorkspaceById(ws.id)) allSaved = false;
      }
      saveBtn.disabled = false;
      if (!allSaved) return;
      closeModal('unsaved-modal');
      proceed();
    };
  }
  if (discardBtn) {
    discardBtn.textContent = many ? 'Discard all' : 'Discard';
    discardBtn.onclick = () => { closeModal('unsaved-modal'); proceed(); };
  }
  showOverlay('unsaved-modal');
}

// Enter activates the primary (Save) action, matching the other dialogs.
registerModal('unsaved-modal', {
  submit: () => { const b = $('unsaved-save-btn'); if (b && b.onclick) b.onclick(); }
});

export function closeTab(id, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (Workspaces.length <= 1) return;
  hideTabContextMenu();
  confirmDiscardingTabs([id], () => performCloseTab(id));
}

export function performCloseTab(id) {
  if (Workspaces.length <= 1) return;
  if (editingTabId === id) editingTabId = null;

  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1) return;

  // Keep the active workspace's in-flight edits in its snapshot before it's
  // possibly the one being removed, so a reopen restores exactly what was on
  // screen rather than whatever was last saved on a prior switch.
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }

  const [removed] = Workspaces.splice(idx, 1);
  recordClosedWorkspace(removed, idx);
  showTabUndoToast(removed.name);

  if (id === activeWorkspaceId) {
    setActiveWorkspaceId(null);
    let nextIdx = Math.max(0, idx - 1);
    switchTab(Workspaces[nextIdx].id);
  } else {
    renderTabs();
    saveBackupChecked();
  }
}

export function closeOtherTabs(id) {
  hideTabContextMenu();
  if (Workspaces.length <= 1 || !Workspaces.find(w => w.id === id)) return;
  confirmDiscardingTabs(
    Workspaces.filter(w => w.id !== id).map(w => w.id),
    () => performCloseOtherTabs(id)
  );
}

export function performCloseOtherTabs(id) {
  if (Workspaces.length <= 1 || !Workspaces.find(w => w.id === id)) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.map((w, i) => ({ w, i })).filter(({ w }) => w.id !== id);
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  setWorkspaces(Workspaces.filter(w => w.id === id));
  if (editingTabId && editingTabId !== id) editingTabId = null;
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
  if (activeWorkspaceId !== id) {
    setActiveWorkspaceId(null);
    switchTab(id);
  } else {
    renderTabs();
    saveBackupChecked();
  }
}

export function closeTabsToRight(id) {
  hideTabContextMenu();
  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1 || idx >= Workspaces.length - 1) return;
  confirmDiscardingTabs(
    Workspaces.slice(idx + 1).map(w => w.id),
    () => performCloseTabsToRight(id)
  );
}

export function performCloseTabsToRight(id) {
  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1 || idx >= Workspaces.length - 1) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.slice(idx + 1).map((w, off) => ({ w, i: idx + 1 + off }));
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  const closingActive = closed.some(({ w }) => w.id === activeWorkspaceId);
  setWorkspaces(Workspaces.slice(0, idx + 1));
  if (editingTabId && !Workspaces.find(w => w.id === editingTabId)) editingTabId = null;
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
  if (closingActive) {
    setActiveWorkspaceId(null);
    switchTab(id);
  } else {
    renderTabs();
    saveBackupChecked();
  }
}

export function closeAllTabs() {
  hideTabContextMenu();
  if (!Workspaces.length) return;
  confirmDiscardingTabs(Workspaces.map(w => w.id), performCloseAllTabs);
}

export function performCloseAllTabs() {
  if (!Workspaces.length) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.map((w, i) => ({ w, i }));
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  setWorkspaces([]);
  setActiveWorkspaceId(null);
  editingTabId = null;
  createTab();
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
}

export function recordClosedWorkspace(workspace, index) {
  closedWorkspaces.push({ workspace, index });
  if (closedWorkspaces.length > 15) closedWorkspaces.shift();
}

export function reopenClosedTab() {
  if (!closedWorkspaces.length) { showStatus('No recently closed tabs'); return; }
  const { workspace, index } = closedWorkspaces.pop();
  if (Workspaces.find(w => w.id === workspace.id)) { reopenClosedTab(); return; }
  const insertAt = Math.max(0, Math.min(index, Workspaces.length));
  Workspaces.splice(insertAt, 0, workspace);
  hideTabUndoToast();
  switchTab(workspace.id);
  showStatus(`Reopened "${workspace.name}"`);
}

export function showTabUndoToast(label, count) {
  const toast = $('tab-undo-toast');
  if (!toast) return;
  const msg = $('tab-undo-msg');
  if (msg) {
    msg.textContent = count && count > 1 ? `Closed ${count} tabs` : `Closed "${label}"`;
  }
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 6000);
}

export function hideTabUndoToast() {
  const toast = $('tab-undo-toast');
  if (!toast) return;
  toast.classList.remove('show');
  clearTimeout(toast._t);
}

// ══════════════════════════════════════════════════════════════════
//  TAB CONTEXT MENU
// ══════════════════════════════════════════════════════════════════
export let tabCtxId = null;

export function showTabContextMenu(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const m = $('tab-ctx-menu');
  if (!m) return;
  if (typeof hideContextMenu === 'function') hideContextMenu();
  if (typeof hideCanvasContextMenu === 'function') hideCanvasContextMenu();
  tabCtxId = id;
  const idx = Workspaces.findIndex(w => w.id === id);
  const closeBtn = $('tab-ctx-close');
  const othersBtn = $('tab-ctx-close-others');
  const rightBtn = $('tab-ctx-close-right');
  if (closeBtn) closeBtn.classList.toggle('disabled', Workspaces.length <= 1);
  if (othersBtn) othersBtn.classList.toggle('disabled', Workspaces.length <= 1);
  if (rightBtn) rightBtn.classList.toggle('disabled', idx === -1 || idx >= Workspaces.length - 1);
  m.style.display = 'block';
  const maxX = 220, maxY = 260;
  m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - maxX)) + 'px';
  m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - maxY)) + 'px';
}

export function hideTabContextMenu() {
  const m = $('tab-ctx-menu');
  if (m) m.style.display = 'none';
  tabCtxId = null;
}

export function tabCtxRename() {
  if (!tabCtxId) return;
  const id = tabCtxId;
  hideTabContextMenu();
  beginRenameTab(id);
}

export function tabCtxDuplicate() {
  if (!tabCtxId) return;
  const src = Workspaces.find(w => w.id === tabCtxId);
  hideTabContextMenu();
  if (!src) return;
  if (src.id === activeWorkspaceId) src.data = exportWorkspaceState();
  const srcIdx = Workspaces.findIndex(w => w.id === src.id);
  const copy = {
    id: 'ws_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
    name: `${src.name} copy`,
    dirty: true,
    data: JSON.parse(JSON.stringify(src.data)),
  };
  Workspaces.splice(srcIdx + 1, 0, copy);
  switchTab(copy.id);
}

export function tabCtxClose() {
  if (!tabCtxId) return;
  const id = tabCtxId;
  closeTab(id);
}

export function tabCtxCloseOthers() {
  if (!tabCtxId) return;
  closeOtherTabs(tabCtxId);
}

export function tabCtxCloseRight() {
  if (!tabCtxId) return;
  closeTabsToRight(tabCtxId);
}

export function tabCtxCloseAll() {
  closeAllTabs();
}

document.addEventListener('click', () => hideTabContextMenu());

export function renameTab(id, e) {
  beginRenameTab(id, e);
}

export function initTabs() {
  if (Workspaces.length === 0) {
    Workspaces.push({
      id: 'ws_initial',
      name: 'Workspace 1',
      dirty: false,
      data: exportWorkspaceState()
    });
    setActiveWorkspaceId('ws_initial');
  }
  Workspaces.forEach((ws, idx) => {
    if (!ws.name) ws.name = `Workspace ${idx + 1}`;
    ws.dirty = !!ws.dirty;
  });
  if (!Workspaces.find(w => w.id === activeWorkspaceId)) setActiveWorkspaceId(Workspaces[0].id);
  editingTabId = null;
  renderTabs();
}

window.addEventListener('resize', () => updateTabOverflowShadows());

// ══════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // A modal is blocking, so canvas shortcuts must not reach through it —
  // bare keys here would otherwise still switch tools, toggle fullscreen or
  // step the simulation underneath the dialog. Escape and Enter are handled
  // by modal.js, which sees them first from its capture-phase listener.
  if (typeof anyModalOpen === 'function' && anyModalOpen()) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y' || e.key === 'Z') { e.preventDefault(); redo(); }
    // Ctrl+S is the in-app save; Ctrl+Shift+S exports a JSON file, which is
    // what Ctrl+S used to do.
    if (e.key === 's') { e.preventDefault(); saveWorkspace(); }
    if (e.key === 'S' && e.shiftKey) { e.preventDefault(); saveJSON(); }
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (App.view === 'build') selectAllStates(); }
    if (e.key === 'c' || e.key === 'C') { if (App.view === 'build') copySelection(); }
    if (e.key === 'v' || e.key === 'V') { if (App.view === 'build') { e.preventDefault(); pasteClipboard(App._lastCanvasWorldPt || null); } }
    if (e.key === 'd' || e.key === 'D') { if (App.view === 'build') { e.preventDefault(); duplicateSelection(); } }
    if (e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); reopenClosedTab(); }
    return;
  }
  if (e.key === 'v' || e.key === 'V') setTool('move');
  if (e.key === 's' || e.key === 'S') setTool('state');
  if (e.key === 't' || e.key === 'T') setTool('trans');
  if (e.key === 'l' || e.key === 'L') setTool('divider');
  if (e.key === 'r' || e.key === 'R') setTool('rect');
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); fitToScreen(); }
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  if (e.key === 'd' || e.key === 'D') setTool('del');
  // Bare X previously cleared the entire canvas with no confirmation-free
  // undo path — require Shift so a stray keypress can't wipe the workspace.
  if ((e.key === 'x' || e.key === 'X') && e.shiftKey) clearAll();
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (App.selectedStates.size || App.selectedTransitions.size) {
      e.preventDefault();
      snapshot();
      if (typeof pruneNoteAnchorsExcluding === 'function') {
        const removedTransIds = new Set(App.selectedTransitions);
        App.transitions.forEach(t => {
          if (App.selectedStates.has(t.from) || App.selectedStates.has(t.to)) removedTransIds.add(t.id);
        });
        pruneNoteAnchorsExcluding([...App.selectedStates], [...removedTransIds]);
      }
      App.selectedStates.forEach(id => {
        App.states = App.states.filter(s => s.id !== id);
        App.transitions = App.transitions.filter(t => t.from !== id && t.to !== id);
        if (App.startId === id) App.startId = null;
        App.accepts.delete(id);
      });
      App.selectedTransitions.forEach(tid => {
        App.transitions = App.transitions.filter(t => t.id !== tid);
      });
      App.selectedStates.clear();
      App.selectedTransitions.clear();
      emit(Change.GRAPH);
    } else if (App.selectedDividerId && typeof deleteSelectedDivider === 'function') {
      e.preventDefault();
      deleteSelectedDivider();
    }
  }
  if (e.key === 'Escape') {
    // Open modals are handled in modal.js and never reach this far.
    const menuOpen = document.querySelector('#tools-menu.open, #hdr-more-menu.open');
    if (menuOpen) {
      // Dismiss header menus before anything else they sit above.
      if (typeof hideToolsMenu === 'function') hideToolsMenu();
      if (typeof hideMoreMenu === 'function') hideMoreMenu();
    } else if (typeof AUX_VIEWS !== 'undefined' && AUX_VIEWS.includes(App.view)) {
      // Escape from an auxiliary view returns to the canvas.
      closeAuxView();
    } else {
      App.selectedStates.clear();
      App.selectedTransitions.clear();
      document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
      if (typeof clearEdgeDirectionHighlight === 'function') clearEdgeDirectionHighlight();
      if (typeof clearDividerSelection === 'function') clearDividerSelection();
      App.transFrom = null; clearTempLine(); setTool('pointer');
    }
  }
  if (e.key.startsWith('Arrow') && App.selectedStates.size && App.view === 'build') {
    e.preventDefault();
    const amt = e.shiftKey ? (App.config.gridSnap || 20) : 1;
    const dx = e.key === 'ArrowRight' ? amt : e.key === 'ArrowLeft' ? -amt : 0;
    const dy = e.key === 'ArrowDown' ? amt : e.key === 'ArrowUp' ? -amt : 0;
    nudgeSelected(dx, dy);
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (App.currentAlgo === 'utm') utmStepFwd(); else stepFwd();
  } else if (e.key === 'ArrowLeft') {
    if (App.currentAlgo === 'utm') utmStepBack(); else stepBack();
  }
  if (e.key === ' ' && App.currentAlgo === 'utm') {
    e.preventDefault();
    utmToggleAuto();
  }
  // 1 returns to the canvas (closing any auxiliary view); 2-4 open one.
  if (e.key === '1') setView('build');
  if (e.key === '2') setView('algo');
  if (e.key === '3') setView('grammar');
  if (e.key === '4') setView('theory');
});

export function syncThemeExportPalette(theme) {
  const t = Themes[theme] || Themes[DEFAULT_THEME];
  App.config.export = { ...App.config.export, ...t.export };
}

// ── Theme picker ──────────────────────────────────────────────────
// The card preview is a miniature of the thing being themed: start state,
// active state, accepting state, two edges. A two-colour swatch cannot
// separate 35 themes — measured across the registry, dozens of bg/accent
// pairs are perceptually near-identical (kanagawa/nightfox, rivers/himalaya,
// dark/cyberpunk), because what actually distinguishes them is the ring and
// edge colours a swatch throws away. Drawing the real diagram costs nothing
// extra: `export` already carries every colour, since it is what the PNG
// exporter and minimap paint from.
//
// Geometry is identical for every card and only the colours vary, so this is
// a template with holes rather than a layout pass.
const THEME_PREVIEW_GEOM = {
  start: 26, mid: 69, end: 112, cy: 23, r: 9,
  // stem then arrowhead, for the start marker and the two edges
  edges: [[5, 12, 11, 16], [35, 56, 55, 60], [78, 99, 98, 103]]
};

function themePreviewSVG(x) {
  const g = THEME_PREVIEW_GEOM;
  const stems = g.edges.map(([a, b]) => `M${a} ${g.cy}H${b}`).join('');
  const heads = g.edges.map(([, , a, tip]) =>
    `M${a} ${g.cy - 2.8}L${tip} ${g.cy}L${a} ${g.cy + 2.8}Z`).join('');
  const node = (cx, fill) => `<circle cx="${cx}" cy="${g.cy}" r="${g.r}" fill="${fill}"/>`;
  const ring = (cx, stroke, r, w) =>
    `<circle cx="${cx}" cy="${g.cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
  // Fills first, then every stroke, so no ring is half-covered by a later node.
  return `<svg class="theme-card-preview" viewBox="0 0 126 46" aria-hidden="true">
    <rect width="126" height="46" rx="6" fill="${x.bg}"/>
    <path d="${stems}" stroke="${x.edgeStroke}" stroke-width="1.6" fill="none"/>
    <path d="${heads}" fill="${x.edgeStroke}"/>
    ${node(g.start, x.nodeFill)}${node(g.mid, x.nodeFill)}${node(g.end, x.nodeFill)}
    <circle cx="${g.mid}" cy="${g.cy}" r="${g.r}" fill="${x.actFill}"/>
    ${ring(g.start, x.startStroke, g.r, 1.8)}
    ${ring(g.mid, x.actStroke, g.r, 1.8)}
    ${ring(g.end, x.accStroke, g.r, 1.5)}
    ${ring(g.end, x.accStroke, g.r - 3.2, 1.2)}
  </svg>`;
}

// Same rule tests/themes.test.js uses to check `color-scheme`, so the
// grouping can never disagree with what the stylesheet declares.
function themeIsLight(t) {
  const c = [0, 2, 4].map(i => parseInt(t.export.bg.replace('#', '').slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.45;
}

const CHECK_PATH = 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z';

// Cards are toggle buttons, not listbox options: a listbox promises arrow-key
// navigation and roving focus that this grid does not implement, and claiming
// the role without the behaviour is worse for a screen reader than not
// claiming it. `aria-pressed` describes exactly what these are.
export function renderThemeCards() {
  const grid = $('theme-grid');
  if (!grid) return;
  const current = App.config.theme;
  const groups = [['dark', 'Dark'], ['light', 'Light']];
  grid.innerHTML = groups.map(([key, heading]) => {
    const cards = Object.entries(Themes)
      .filter(([, t]) => (themeIsLight(t) ? 'light' : 'dark') === key)
      .map(([id, t]) => `<button type="button" class="theme-card${id === current ? ' active' : ''}"
        data-theme="${id}" aria-pressed="${id === current}" tabindex="${id === current ? '0' : '-1'}"
        title="${escapeHtml(t.label || id)}">
        ${themePreviewSVG(t.export)}
        <span class="theme-card-name">${escapeHtml(t.label || id)}</span>
        <svg class="theme-card-check" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${CHECK_PATH}"/></svg>
      </button>`).join('');
    return `<section class="theme-group" data-group="${key}">
      <h3 class="theme-group-hd">${heading}</h3>
      <div class="theme-group-grid">${cards}</div>
    </section>`;
  }).join('');
}

// Only the selection marker changes on a theme switch, so applyTheme syncs
// it in place rather than rebuilding 35 cards' worth of innerHTML — which
// would also destroy the very card the pointer is hovering, cancelling the
// preview that triggered it.
export function syncThemeCardSelection() {
  const grid = $('theme-grid');
  if (!grid) return;
  grid.querySelectorAll('.theme-card').forEach(el => {
    const on = el.dataset.theme === App.config.theme;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

// Substring match over label and id, with group headings hiding themselves
// once every card beneath them is filtered out.
function filterThemeCards() {
  const grid = $('theme-grid');
  const q = ($('theme-search')?.value || '').trim().toLowerCase();
  if (!grid) return;
  let shown = 0;
  grid.querySelectorAll('.theme-card').forEach(el => {
    const hit = !q || `${el.dataset.theme} ${el.textContent}`.toLowerCase().includes(q);
    el.classList.toggle('is-filtered', !hit);
    if (hit) shown++;
  });
  grid.querySelectorAll('.theme-group').forEach(sec => {
    const any = sec.querySelector('.theme-card:not(.is-filtered)');
    sec.classList.toggle('is-filtered', !any);
  });
  const empty = $('theme-empty');
  if (empty) empty.hidden = shown > 0;
  // Filtering can hide whichever card held the tab stop, which would leave the
  // grid unreachable by keyboard entirely.
  setThemeRoving();
}

// ── Grid keyboard navigation ──────────────────────────────────────
// Rows are read off the laid-out boxes rather than assumed, because the grid
// is `auto-fill` (column count varies with panel width), the last row of a
// section is ragged, and Dark/Light are two separate grids stacked — so there
// is no single column count that Up/Down could be computed from. Working from
// geometry handles all three without knowing about any of them.
//
// Pure so it can be tested without a layout engine: `boxes` is one
// {top, left, width} per *visible* card, in DOM order. Returns the index to
// move to, or -1 meaning "leave the grid upward", which the caller turns into
// focusing the search field.
export function themeGridNeighbor(boxes, index, key) {
  const n = boxes.length;
  if (!n) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key === 'ArrowRight') return Math.min(index + 1, n - 1);
  if (key === 'ArrowLeft') return Math.max(index - 1, 0);
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return index;

  const rowOf = b => Math.round(b.top);
  const rows = [...new Set(boxes.map(rowOf))].sort((a, b) => a - b);
  const target = rows[rows.indexOf(rowOf(boxes[index])) + (key === 'ArrowDown' ? 1 : -1)];
  // Up from the first row exits to the search field; Down from the last stays.
  if (target === undefined) return key === 'ArrowUp' ? -1 : index;

  // Keep the horizontal position across the jump, so a ragged row or a
  // narrower section lands under the finger rather than at its edge.
  const centre = boxes[index].left + boxes[index].width / 2;
  let best = index, bestD = Infinity;
  boxes.forEach((b, i) => {
    if (rowOf(b) !== target) return;
    const d = Math.abs(b.left + b.width / 2 - centre);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function visibleThemeCards() {
  const grid = $('theme-grid');
  if (!grid) return [];
  return Array.prototype.filter.call(
    grid.querySelectorAll('.theme-card'), el => !el.classList.contains('is-filtered'));
}

// Exactly one card carries the tab stop, so Tab enters and leaves the grid in
// one press instead of walking all 35. Preference order: the card being moved
// to, else the selected theme, else the first visible one.
function setThemeRoving(target) {
  const cards = visibleThemeCards();
  if (!cards.length) return;
  const stop = (target && cards.includes(target) && target)
    || cards.find(c => c.dataset.theme === App.config.theme)
    || cards[0];
  cards.forEach(c => c.setAttribute('tabindex', c === stop ? '0' : '-1'));
  return stop;
}

function focusThemeCard(card) {
  const stop = setThemeRoving(card);
  if (stop && stop.focus) stop.focus();
}

// A non-blocking popover rather than a modal, which is what makes the rest of
// this simple. A modal scrim (`.overlay` blurs at 6px) hides the canvas — so
// the only way to judge a theme was to apply it on hover and unwind it after,
// and re-theming the whole page as a pointer crosses a grid reads as flashing
// rather than as preview. With the diagram left visible, clicking *is* the
// preview: it applies, you see your real machine in it, and another click
// changes your mind. The dwell timers, the origin tracking and the revert are
// all gone with the scrim that made them necessary.
let themePickerBound = false;

export function isThemePickerOpen() {
  const p = $('theme-panel');
  return !!p && p.classList.contains('open');
}

export function closeThemePicker(focusTrigger = false) {
  const p = $('theme-panel');
  if (!p) return;
  p.classList.remove('open');
  const btn = $('theme-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  // The trigger lives inside the More menu, which is closed by now, so focus
  // goes back to the button that opens it rather than to a hidden row.
  if (focusTrigger) {
    const more = $('hdr-more-btn');
    if (more && more.focus) more.focus();
  }
}

// Bound once, lazily, on first open: the grid is built by this module rather
// than present in index.html, so there is nothing to attach to at load time.
// Delegated rather than per-card inline handlers, which also keeps the whole
// picker off the window surface in bridge.js.
function bindThemePicker() {
  if (themePickerBound) return;
  const grid = $('theme-grid');
  if (!grid) return;
  themePickerBound = true;

  // Selecting does not close the panel. Comparing themes is the whole task,
  // and a picker that dismissed itself on every pick would have to be
  // reopened to make the comparison it exists for.
  grid.addEventListener('click', e => {
    const card = e.target.closest('.theme-card');
    if (card) selectTheme(card.dataset.theme);
  });

  const NAV = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
  grid.addEventListener('keydown', e => {
    const card = e.target.closest && e.target.closest('.theme-card');
    if (!card) return;
    if (NAV.has(e.key)) {
      const cards = visibleThemeCards();
      const at = cards.indexOf(card);
      if (at === -1) return;
      e.preventDefault();
      const next = themeGridNeighbor(cards.map(c => c.getBoundingClientRect()), at, e.key);
      if (next === -1) {
        const s = $('theme-search');
        if (s && s.focus) s.focus();
      } else {
        focusThemeCard(cards[next]);
      }
      return;
    }
    // A printable key means the user is naming a theme, and there is already
    // one place for that. Routing it to the field beats a second, invisible
    // type-ahead that matches by different rules than the box above it.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const s = $('theme-search');
      if (!s) return;
      e.preventDefault();
      s.value += e.key;
      s.focus();
      filterThemeCards();
    }
  });

  const search = $('theme-search');
  if (search) {
    search.addEventListener('input', filterThemeCards);
    search.addEventListener('keydown', e => {
      const cards = visibleThemeCards();
      if (!cards.length) return;
      // Down walks into the results; Enter takes the top one outright, which
      // is the whole point of having typed — and one more click undoes it.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusThemeCard(cards[0]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectTheme(cards[0].dataset.theme);
        focusThemeCard(cards[0]);
      }
    });
  }
  const close = $('theme-panel-close');
  if (close) close.addEventListener('click', () => closeThemePicker(true));
}

export function openThemePicker() {
  const p = $('theme-panel');
  if (!p) return;
  renderThemeCards();
  bindThemePicker();
  const search = $('theme-search');
  if (search) search.value = '';
  filterThemeCards();
  p.classList.add('open');
  const btn = $('theme-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  if (search && search.focus) search.focus();
}

export function toggleThemePicker(event) {
  // The opening click also reaches the document listeners below and the one in
  // view.js that dismisses the header menus. Closing that menu is wanted; this
  // panel seeing its own opening click and closing again is not — so the
  // propagation stops here and the menu is dismissed explicitly.
  if (event && event.stopPropagation) event.stopPropagation();
  hideMoreMenu();
  if (isThemePickerOpen()) closeThemePicker();
  else openThemePicker();
}

// Dismissal, matching quick-settings.js: a click outside, or Escape. Escape
// still reaches here from inside the search field, because the global shortcut
// handler that ignores form fields is a separate listener.
document.addEventListener('click', event => {
  if (!isThemePickerOpen()) return;
  const p = $('theme-panel');
  if (p && p.contains && p.contains(event.target)) return;
  closeThemePicker();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isThemePickerOpen()) closeThemePicker(true);
});

// The header row's small trailing label (e.g. "Nord") so the current theme
// is visible without opening the modal.
export function updateThemeMenuLabel() {
  const el = $('theme-btn-current');
  if (!el) return;
  const t = Themes[App.config.theme];
  el.textContent = t ? t.label : '';
}

// Builds the Settings dropdown's options from the theme registry. Run once —
// the dropdown-enhancer (js/dropdown.js) watches the native <select> for
// further mutations, so this never needs to run again after the first open.
export function populateThemeSelect() {
  const sel = $('set-theme');
  if (!sel || sel.children.length) return;
  sel.innerHTML = Object.entries(Themes)
    .map(([id, t]) => `<option value="${id}">${escapeHtml(t.label || id)}</option>`)
    .join('');
}

export function applyTheme(theme, persist = true) {
  const resolved = Themes[theme] ? theme : DEFAULT_THEME;
  App.config.theme = resolved;
  document.documentElement.dataset.theme = resolved;
  syncThemeExportPalette(resolved);
  syncThemeCardSelection();
  updateThemeMenuLabel();
  if ($('set-theme')) $('set-theme').value = resolved;
  // The minimap paints from App.config.export.*, which syncThemeExportPalette
  // has just rewritten, so it has to be repainted or it keeps the old theme's
  // colours until some unrelated edit happens to trigger a redraw. Painted
  // synchronously rather than scheduled so a theme switch never shows a frame
  // of the old palette.
  renderMinimap();
  if (persist) {
    try { localStorage.setItem('automata-theme', resolved); } catch (e) { }
  }
}

// Entry point for interactive theme picks (theme-panel cards); applyTheme
// alone is also used at boot and from Settings, where a repaint/status
// message would be premature or redundant.
export function selectTheme(theme) {
  applyTheme(theme);
  if (typeof renderAll === 'function') renderAll();
  saveBackupChecked();
  showStatus(`Theme: ${Themes[App.config.theme]?.label || App.config.theme}`);
}


// ══════════════════════════════════════════════════════════════════
//  ZOOM / FIT / MINIMAP / SIDEBAR / FILTER FUNCTIONS
// ══════════════════════════════════════════════════════════════════
export function zoomIn() {
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const r = w.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const newZ = Math.min(cfg.max, App.cam.z * 1.25);
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  if (typeof markDirty === 'function') markDirty();
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth')
    w.classList.remove('cam-smooth');
  }, 250);
}

export function zoomOut() {
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const r = w.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const newZ = Math.max(cfg.min, App.cam.z / 1.25);
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  if (typeof markDirty === 'function') markDirty();
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth')
    w.classList.remove('cam-smooth');
  }, 250);
}

export function setZoomFromInput(val) {
  const num = parseFloat(val.replace('%', ''));
  if (isNaN(num)) {
    applyCamera(); return;
  }
  if (!App.states.length) {
    const w = $('canvas-wrap'); if (!w) return;
    const mx = w.clientWidth / 2, my = w.clientHeight / 2;
    App.cam = { x: mx, y: my, z: 1 };
    if (typeof markDirty === 'function') markDirty();
    $('cam-g').classList.add('cam-smooth');
    w.classList.add('cam-smooth');
    applyCamera();
    setTimeout(() => {
      $('cam-g').classList.remove('cam-smooth')
      w.classList.remove('cam-smooth');
    }, 250);
    return;
  }
  const w = $('canvas-wrap'); if (!w) return;
  const cfg = App.config.zoom;
  const newZ = Math.max(cfg.min, Math.min(cfg.max, num / 100));

  const mx = w.clientWidth / 2, my = w.clientHeight / 2;
  App.cam.x = mx - (mx - App.cam.x) * newZ / App.cam.z;
  App.cam.y = my - (my - App.cam.y) * newZ / App.cam.z;
  App.cam.z = newZ;
  if (typeof markDirty === 'function') markDirty();
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth')
    w.classList.remove('cam-smooth');
  }, 250);
}

// The canvas spans the full width of the workspace, but a pinned panel sits
// beside it while an *unpinned* one is absolutely positioned on top of it
// (see .lpanel.unpinned in css/lpanel.css). clientWidth therefore counts the
// strip hidden underneath an overlaying panel as visible space, which pushes
// anything centred on it off toward the covered side and makes the minimap's
// viewport rect wider than what the user can actually see. This reports the
// genuinely visible box, in canvas-wrap-local CSS pixels.
export function visibleCanvasBox() {
  const w = $('canvas-wrap');
  if (!w) return { x: 0, y: 0, w: 600, h: 400 };
  const full = { x: 0, y: 0, w: w.clientWidth, h: w.clientHeight };
  if (typeof w.getBoundingClientRect !== 'function') return full;
  const wrapRect = w.getBoundingClientRect();
  if (!wrapRect.width || !wrapRect.height) return full;
  let left = wrapRect.left, right = wrapRect.right;
  ['lpanel', 'rpanel'].forEach(id => {
    const p = $(id);
    // Only panels drawn over the canvas steal visible space; a pinned panel
    // already shrinks canvas-wrap, so counting it would subtract twice.
    if (!p || typeof p.getBoundingClientRect !== 'function') return;
    if (p.classList && !p.classList.contains('unpinned')) return;
    const r = p.getBoundingClientRect();
    if (!r.width) return;
    if (r.left <= wrapRect.left) left = Math.max(left, r.right);
    else right = Math.min(right, r.left);
  });
  if (!(right > left)) return full;
  return { x: left - wrapRect.left, y: 0, w: right - left, h: wrapRect.height };
}

export function fitToScreen(silent = false) {
  if (!App.states.length) return;
  const w = $('canvas-wrap'); if (!w) return;
  // Fit into the region the user can actually see, not the strip an
  // overlaying panel is covering, so the machine lands centred on screen.
  const vis = visibleCanvasBox();
  const cw = vis.w, ch = vis.h;
  const R = App.config.radius + 4; // state radius + some padding
  const pad = 90;
  const b = getContentBounds(R);
  if (!b) return;
  const { minX, minY, maxX, maxY } = b;
  const bw = maxX - minX, bh = maxY - minY;
  const scaleX = (cw - pad * 2) / bw;
  const scaleY = (ch - pad * 2) / bh;
  const z = Math.max(App.config.zoom.min, Math.min(App.config.zoom.max, Math.min(scaleX, scaleY)));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  App.cam.x = vis.x + cw / 2 - cx * z;
  App.cam.y = vis.y + ch / 2 - cy * z;
  App.cam.z = z;
  // `silent` marks the programmatic fits that run on load/restore. Those must
  // not dirty the tab — the camera they set is the one that was just restored.
  if (!silent && typeof markDirty === 'function') markDirty();
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth');
    w.classList.remove('cam-smooth');
  }, 250);
  if (!silent) showStatus('Fit to screen');
}

export function autoFitLoadedMachine() {
  // Wait a tick so view switches and panel layout changes settle before fitting.
  setTimeout(() => fitToScreen(true), 50);
}

// ── Keep the diagram framed as the canvas area changes shape ──
// (panel resize/pin/unpin, fullscreen toggle, browser window resize)
export function isMachineFullyVisible(vw, vh) {
  if (!App.states.length) return false;
  const R_PAD = App.config.radius + 4;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  App.states.forEach(s => {
    minX = Math.min(minX, s.x - R_PAD); minY = Math.min(minY, s.y - R_PAD);
    maxX = Math.max(maxX, s.x + R_PAD); maxY = Math.max(maxY, s.y + R_PAD);
  });
  if (typeof includeNoteBounds === 'function') {
    includeNoteBounds((x0, y0, x1, y1) => {
      minX = Math.min(minX, x0); minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    });
  }
  if (typeof includeDividerBounds === 'function') {
    includeDividerBounds((x0, y0, x1, y1) => {
      minX = Math.min(minX, x0); minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    });
  }
  const vpMinX = -App.cam.x / App.cam.z, vpMinY = -App.cam.y / App.cam.z;
  const vpMaxX = (vw - App.cam.x) / App.cam.z, vpMaxY = (vh - App.cam.y) / App.cam.z;
  return minX >= vpMinX && minY >= vpMinY && maxX <= vpMaxX && maxY <= vpMaxY;
}

export let _lastCanvasSize = null;
export let _resizeWasFullyVisible = false;
export let _resizeSettleTimer = null;

export function notifyCanvasResize() {
  const w = $('canvas-wrap');
  if (!w) return;
  const rect = w.getBoundingClientRect();
  const newSize = { w: rect.width, h: rect.height };
  const prev = _lastCanvasSize;
  _lastCanvasSize = newSize;
  if (!prev || !prev.w || !prev.h || !newSize.w || !newSize.h) return;
  const dw = newSize.w - prev.w, dh = newSize.h - prev.h;
  if (!dw && !dh) return;

  if (!_resizeSettleTimer) {
    // Start of a resize gesture — remember whether the whole diagram was in
    // view, so the same framing can be restored once the resize settles.
    _resizeWasFullyVisible = isMachineFullyVisible(prev.w, prev.h);
  }
  // Keep the world point at the viewport center fixed frame-to-frame instead
  // of letting the camera silently drift while the canvas area is resizing.
  App.cam.x += dw / 2;
  App.cam.y += dh / 2;
  applyCamera(true);

  clearTimeout(_resizeSettleTimer);
  _resizeSettleTimer = setTimeout(() => {
    _resizeSettleTimer = null;
    if (_resizeWasFullyVisible) fitToScreen(true);
    else scheduleMinimap();
  }, 150);
}

export function initCanvasResizeObserver() {
  const w = $('canvas-wrap');
  if (!w || !('ResizeObserver' in window) || w._resizeObserverInit) return;
  w._resizeObserverInit = true;
  const rect = w.getBoundingClientRect();
  _lastCanvasSize = { w: rect.width, h: rect.height };
  new ResizeObserver(() => notifyCanvasResize()).observe(w);
}

export function centerCameraOn(x, y, animate = true) {
  const w = $('canvas-wrap'); if (!w) return;
  App.cam.x = w.clientWidth / 2 - x * App.cam.z;
  App.cam.y = w.clientHeight / 2 - y * App.cam.z;
  if (typeof markDirty === 'function') markDirty();
  if (animate) { $('cam-g').classList.add('cam-smooth'); w.classList.add('cam-smooth'); }
  applyCamera();
  if (animate) {
    setTimeout(() => { $('cam-g').classList.remove('cam-smooth'); w.classList.remove('cam-smooth'); }, 250);
  }
}

// ── Panel list ↔ canvas cross-highlighting ──
export function focusStateFromList(id) {
  const s = getState(id); if (!s) return;
  App.selectedStates = new Set([id]);
  App.selectedTransitions.clear();
  document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.classList.add('sel-st');
  centerCameraOn(s.x, s.y, true);
  updateLPanel();
  if (isMobilePanelLayout()) setMobilePanelCollapsed('lpanel', true);
}

export function hlListHover(id, on) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.classList.toggle('list-hover-st', on);
}

export function focusTransFromList(id) {
  const t = getTransition(id); if (!t) return;
  const from = getState(t.from), to = getState(t.to);
  if (!from || !to) return;
  App.selectedTransitions = new Set([id]);
  App.selectedStates.clear();
  document.querySelectorAll('.sn.sel-st, .edge-g.sel-t').forEach(n => n.classList.remove('sel-st', 'sel-t'));
  renderAll();
  centerCameraOn((from.x + to.x) / 2, (from.y + to.y) / 2, true);
  updateLPanel();
  if (isMobilePanelLayout()) setMobilePanelCollapsed('lpanel', true);
}

export function hlTransListHover(fromId, toId, on) {
  const el = document.querySelector(`[data-edge="${fromId}|${toId}"]`);
  if (el) el.classList.toggle('list-hover-t', on);
}

export function filterTransitions() {
  const q = ($('trans-search')?.value || '').toLowerCase();
  document.querySelectorAll('#trans-list .ti').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

export function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => showStatus(`Fullscreen failed: ${err.message}`));
  } else {
    document.exitFullscreen().catch(err => showStatus(`Exit fullscreen failed: ${err.message}`));
  }
}
document.addEventListener('fullscreenchange', () => {
  const btn = $('fs-btn');
  if (btn) {
    btn.dataset.tip = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    btn.dataset.tipKbd = 'F';
    btn.style.opacity = document.fullscreenElement ? '0.7' : '1';
  }
});


export function setTool(t) {
  App.tool = t;
  if (App.transFrom && typeof hlState === 'function') hlState(App.transFrom, false);
  App.transFrom = null;
  if (typeof clearTempLine === 'function') clearTempLine();

  const w = $('canvas-wrap');
  if (w) {
    const cursors = { pointer: 'default', move: 'grab', state: 'crosshair', trans: 'crosshair', divider: 'crosshair', rect: 'crosshair', del: 'not-allowed' };
    w.style.cursor = cursors[t] || 'default';
    w.setAttribute('data-tool', t);
  }

  // Divider and Rect share one toolbar slot (#t-shape), so both map to it here.
  const isShapeTool = t === 'divider' || t === 'rect';
  const activeBtnId = isShapeTool ? 't-shape' : `t-${t}`;
  document.querySelectorAll('.toolbox-btn[id^="t-"]').forEach(b => {
    const isActive = b.id === activeBtnId;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  if (isShapeTool) {
    App.lastShapeTool = t;
    try { localStorage.setItem('automata-shape-tool', t); } catch (e) { }
  }
  if (typeof updateShapeToolButton === 'function') updateShapeToolButton(App.lastShapeTool);

  const msgs = {
    pointer: 'Click or drag states to interact',
    move: 'Drag canvas to pan · drag state to move · click the active tool again to return to Pointer',
    state: 'Click canvas to place state · click the active tool again to return to Pointer',
    trans: 'Click source then target state · click the active tool again to return to Pointer',
    divider: 'Drag on the canvas to draw a divider · hold Shift to lock to 0° / 45° / 90°',
    rect: 'Drag on the canvas to draw a region box · hold Shift for a square',
    del: 'Click state or transition to delete · press Esc or click Pointer to return'
  };
  showStatus(msgs[t] || '');
}

export function toggleTool(t) {
  setTool(App.tool === t && t !== 'pointer' ? 'pointer' : t);
}

export const TOOLBAR_DOCK_KEY = 'automata-toolbar-dock';
export const TOOLBAR_MARGIN = 12;

// Must stay in step with the `@media (max-width: 900px)` block in css/canvas.css
// that pins .canvas-toolbox across the bottom. These two disagreed — CSS at
// 900, JS at 820 — which left an 80px band where the stylesheet had already
// moved the toolbar to the bottom edge while this still reported "not compact",
// so the overlay stack stayed in the bottom corner and the two bars crowded
// each other. One constant, read by both the mode check and the default dock.
export const COMPACT_TOOLBAR_QUERY = '(max-width: 900px)';

export function isCompactToolbarMode() {
  return !!(window.matchMedia && window.matchMedia(COMPACT_TOOLBAR_QUERY).matches);
}

export function normalizeToolbarDock(dock) {
  const fallback = dock && ['top', 'bottom', 'left', 'right'].includes(dock.side)
    ? dock
    : getDefaultToolbarDock();
  if (isCompactToolbarMode()) return { side: 'bottom', ratio: 0.5 };
  return { side: fallback.side, ratio: clamp01(typeof fallback.ratio === 'number' ? fallback.ratio : 0.5) };
}

export function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function getDefaultToolbarDock() {
  return { side: isCompactToolbarMode() ? 'bottom' : 'left', ratio: 0.5 };
}

export function readToolbarDock() {
  try {
    const raw = localStorage.getItem(TOOLBAR_DOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && ['top', 'bottom', 'left', 'right'].includes(parsed.side)) {
        return normalizeToolbarDock({ side: parsed.side, ratio: parsed.ratio });
      }
    }
  } catch (e) { }
  return normalizeToolbarDock(getDefaultToolbarDock());
}

export function saveToolbarDock() {
  try {
    if (App.toolbarDock) localStorage.setItem(TOOLBAR_DOCK_KEY, JSON.stringify(App.toolbarDock));
  } catch (e) { }
}

export function getToolbarDockFromPoint(pointerX, pointerY, wrapRect) {
  const distances = [
    { side: 'left', value: pointerX },
    { side: 'right', value: wrapRect.width - pointerX },
    { side: 'top', value: pointerY },
    { side: 'bottom', value: wrapRect.height - pointerY }
  ];
  return distances.reduce((best, item) => item.value < best.value ? item : best).side;
}

// A translucent ghost clone of the toolbar, positioned exactly where it will
// land (same positioning math as the real dock, so it can't drift out of
// sync) — shows the actual final shape/size/orientation, not just an edge.
export function stripToolbarPreviewClone(root) {
  root.removeAttribute('onclick');
  root.setAttribute('aria-hidden', 'true');
  root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  root.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
  root.querySelectorAll('button, input, select').forEach(el => { el.tabIndex = -1; });
}

export function ensureToolbarPreview() {
  const wrap = $('canvas-wrap');
  const toolbox = $('canvas-toolbox');
  if (!wrap || !toolbox) return null;
  let preview = $('toolbar-dock-preview');
  if (preview) return preview;
  preview = toolbox.cloneNode(true);
  preview.id = 'toolbar-dock-preview';
  preview.classList.remove('dragging');
  preview.classList.add('toolbar-preview');
  stripToolbarPreviewClone(preview);
  wrap.appendChild(preview);
  return preview;
}

export function showToolbarPreview(dock, wrapRect) {
  const preview = ensureToolbarPreview();
  if (!preview) return;
  positionToolbarNode(preview, dock, wrapRect);
  preview.classList.add('visible');
}

export function removeToolbarPreview() {
  const preview = $('toolbar-dock-preview');
  if (preview) preview.remove();
}

export const TOOLBAR_COLLAPSE_KEY = 'automata-toolbar-collapsed';
export function toggleToolbarCollapsed(force) {
  const toolbox = $('canvas-toolbox');
  if (!toolbox) return;
  App.toolbarCollapsed = force !== undefined ? !!force : !App.toolbarCollapsed;
  toolbox.classList.toggle('collapsed', App.toolbarCollapsed);
  try { localStorage.setItem(TOOLBAR_COLLAPSE_KEY, App.toolbarCollapsed ? '1' : '0'); } catch (e) { }
  requestAnimationFrame(() => applyToolbarDock(false));
}
export function initToolbarCollapse() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(TOOLBAR_COLLAPSE_KEY) === '1'; } catch (e) { }
  App.toolbarCollapsed = collapsed;
  const toolbox = $('canvas-toolbox');
  if (toolbox) toolbox.classList.toggle('collapsed', collapsed);
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
}

export function computeToolbarRatio(side, pointerX, pointerY, wrapRect, box) {
  const margin = TOOLBAR_MARGIN;
  return side === 'left' || side === 'right'
    ? clamp01((pointerY - box.height / 2 - margin) / Math.max(1, wrapRect.height - box.height - margin * 2))
    : clamp01((pointerX - box.width / 2 - margin) / Math.max(1, wrapRect.width - box.width - margin * 2));
}

export function positionToolbarNode(node, dock, wrapRect) {
  const margin = TOOLBAR_MARGIN;
  const compact = isCompactToolbarMode();
  const normalizedDock = compact ? { side: 'bottom', ratio: 0.5 } : dock;
  const isHorizontal = compact || normalizedDock.side === 'top' || normalizedDock.side === 'bottom';
  node.dataset.dock = normalizedDock.side;
  node.style.position = 'absolute';
  node.style.transform = 'none';
  node.style.right = 'auto';
  node.style.bottom = 'auto';
  node.style.boxSizing = 'border-box';
  node.style.flexDirection = isHorizontal ? 'row' : 'column';
  node.style.alignItems = isHorizontal ? 'center' : 'stretch';
  node.style.gap = isHorizontal ? '6px' : '4px';
  node.style.width = compact ? 'auto' : 'max-content';
  node.style.maxWidth = compact ? 'none' : (isHorizontal ? `calc(100% - ${margin * 2}px)` : 'none');
  node.style.overflowX = isHorizontal ? 'auto' : 'hidden';
  node.style.overflowY = isHorizontal ? 'hidden' : 'auto';
  node.style.justifyContent = 'flex-start';

  if (compact) {
    node.style.left = `${margin}px`;
    node.style.right = `${margin}px`;
    node.style.top = 'auto';
    node.style.bottom = `${margin}px`;
    node.style.padding = '6px 8px';
    return node.getBoundingClientRect();
  }

  const box = node.getBoundingClientRect();
  const availableX = Math.max(1, wrapRect.width - box.width - margin * 2);
  const availableY = Math.max(1, wrapRect.height - box.height - margin * 2);
  const ratio = clamp01(normalizedDock.ratio);
  const left = isHorizontal
    ? margin + ratio * availableX
    : normalizedDock.side === 'left' ? margin : wrapRect.width - box.width - margin;
  const top = isHorizontal
    ? normalizedDock.side === 'top' ? margin : wrapRect.height - box.height - margin
    : margin + ratio * availableY;

  node.style.left = `${Math.max(margin, Math.min(left, wrapRect.width - box.width - margin))}px`;
  node.style.top = `${Math.max(margin, Math.min(top, wrapRect.height - box.height - margin))}px`;
  return box;
}

export function applyToolbarDock(persist = false) {
  const toolbox = $('canvas-toolbox');
  const w = $('canvas-wrap');
  if (!toolbox || !w) return;

  const dock = normalizeToolbarDock(App.toolbarDock || readToolbarDock());
  App.toolbarDock = dock;
  toolbox.dataset.dock = dock.side;
  toolbox.classList.toggle('dragging', !!App.toolbarDragging);

  const wrapRect = w.getBoundingClientRect();
  const box = positionToolbarNode(toolbox, dock, wrapRect);
  layoutCanvasOverlays(wrapRect, box);

  if (persist) saveToolbarDock();
}

// ── Overlay placement ─────────────────────────────────────────────
// The minimap, its show-button and the zoom controls form one stack in a
// corner of the canvas. The toolbar is draggable to any edge, so a fixed
// corner meant it could be sat on — the stack now picks the corner that
// stays clear of wherever the toolbar currently is.
//
// Both are positioned from the same margin and share one vertical rhythm,
// so whichever corner they land in they line up with each other and sit
// the same distance from the edges as the toolbar does.
export const OVERLAY_GAP = 8;

// Width the overlay stack needs before it can share an edge with a horizontal
// toolbar. The nav controls are the widest member; this is that bar at its
// current button count plus breathing room, and it is a floor rather than a
// measurement so the corner can be resolved before anything is laid out.
export const STACK_MIN_WIDTH = 250;

// A horizontal toolbar and the overlay stack both want the bottom edge. On a
// wide canvas they take opposite ends and never meet, which is what `ratio`
// alone assumed. On a narrow one the toolbar spans nearly the full width and
// there is no opposite end left — so ask whether the two actually fit side by
// side rather than trusting which half the toolbar was dropped in.
export function bottomEdgeHasRoomBeside(wrapRect, toolbarBox, stackWidth = STACK_MIN_WIDTH) {
  if (!toolbarBox || !toolbarBox.width || !wrapRect || !wrapRect.width) return true;
  // Margin outside each bar, plus one gap between them.
  return toolbarBox.width + stackWidth + TOOLBAR_MARGIN * 3 <= wrapRect.width;
}

export function canvasOverlayCorner(dock, wrapRect, toolbarBox, stackWidth) {
  // Compact mode pins the toolbar across the bottom, leaving only the top
  // free; the stack goes top-right, clear of the header controls.
  if (isCompactToolbarMode()) return { x: 'right', y: 'top' };

  const side = dock && dock.side;
  const ratio = clamp01(dock ? dock.ratio : 0.5);

  // A left/top toolbar never reaches the default corner.
  if (side === 'left' || side === 'top') return { x: 'right', y: 'bottom' };

  if (side === 'right') {
    // Vertical bar down the right edge. It only clears the bottom-right
    // corner when docked high enough that its lower edge stops short of
    // the stack — otherwise move to the left.
    const bottom = toolbarBox ? toolbarBox.height : 0;
    const reach = TOOLBAR_MARGIN + ratio * Math.max(1, wrapRect.height - bottom - TOOLBAR_MARGIN * 2) + bottom;
    return reach < wrapRect.height * 0.55
      ? { x: 'right', y: 'bottom' }
      : { x: 'left', y: 'bottom' };
  }

  if (side === 'bottom') {
    // No room to share the edge — go over the top rather than onto the toolbar.
    if (!bottomEdgeHasRoomBeside(wrapRect, toolbarBox, stackWidth)) return { x: 'right', y: 'top' };
    // Otherwise sitting left of centre leaves the bottom-right free, and vice
    // versa.
    return ratio > 0.5 ? { x: 'left', y: 'bottom' } : { x: 'right', y: 'bottom' };
  }

  return { x: 'right', y: 'bottom' };
}

// The toolbar's live box, or null when it is not on screen. A hidden node
// measures as a zero rect, which every consumer here reads as "no toolbar" —
// returning null says that outright instead of leaving zeros to be interpreted.
export function measuredToolbarBox(toolbox) {
  if (!toolbox || !toolbox.getBoundingClientRect) return null;
  if (toolbox.offsetParent === null) return null;
  const box = toolbox.getBoundingClientRect();
  return box && box.width ? box : null;
}

// Places the visible members of the stack in the chosen corner, stacking
// upward from the bottom edge (or downward from the top).
export function layoutCanvasOverlays(wrapRect, toolbarBox) {
  const w = $('canvas-wrap');
  if (!w) return;
  const rect = wrapRect || w.getBoundingClientRect();

  const nav = $('canvas-nav-controls');
  const map = $('minimap-container');

  // Measure the toolbar whenever the caller did not just position it. Only
  // applyToolbarDock has a box to hand; toggleMinimap and the quick-settings
  // reposition call in with nothing, and an absent box makes canvasOverlayCorner
  // answer differently — so the stack changed corners on clicks that had no
  // business moving it. The corner has to depend on the DOM, not on the caller.
  const toolbox = $('canvas-toolbox');
  const box = toolbarBox || measuredToolbarBox(toolbox);

  // Measure the widest member so that adding a button to the nav bar keeps the
  // crowding check honest. STACK_MIN_WIDTH stands in only when there is nothing
  // to measure — on first paint, or with the bar not yet laid out. Taking the
  // larger of the two instead would demand 250px of clearance for a bar that
  // genuinely measures less, and push the stack off an edge that had room.
  const navWidth = nav && nav.getBoundingClientRect ? nav.getBoundingClientRect().width : 0;
  const corner = canvasOverlayCorner(App.toolbarDock, rect, box, navWidth || STACK_MIN_WIDTH);
  const margin = TOOLBAR_MARGIN;

  // Bottom-up in visual order: zoom controls sit outermost, the minimap rests
  // on top of them. A hidden map leaves nothing behind — its toggle lives in
  // the nav bar — so the stack is just the one member.
  const stack = [nav, (map && !map.classList.contains('minimap-hidden')) ? map : null]
    .filter(el => el && el.offsetParent !== null);

  let offset = margin;
  for (const el of stack) {
    el.style.position = 'absolute';
    el.style.left = corner.x === 'left' ? `${margin}px` : 'auto';
    el.style.right = corner.x === 'right' ? `${margin}px` : 'auto';
    el.style.top = corner.y === 'top' ? `${offset}px` : 'auto';
    el.style.bottom = corner.y === 'bottom' ? `${offset}px` : 'auto';
    offset += el.getBoundingClientRect().height + OVERLAY_GAP;
  }

  if (map) map.dataset.corner = `${corner.y}-${corner.x}`;

  // The popover anchors off the corner stamped above, so it has to follow the
  // stack when the toolbar redocks or the panel resizes underneath it.
  if (typeof isQuickSettingsOpen === 'function' && isQuickSettingsOpen()) positionQuickSettings();
}

export function initToolbarDock() {
  App.toolbarDock = readToolbarDock();
  applyToolbarDock(false);

  const grip = $('toolbox-grip');
  if (!grip || grip._toolbarDockInit) return;
  grip._toolbarDockInit = true;

  // A click on the grip toggles collapse; a drag past a small threshold
  // redocks the toolbar. Pointer capture keeps tracking even if the
  // pointer leaves the grip element mid-drag.
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const toolbox = $('canvas-toolbox');
    const w = $('canvas-wrap');
    if (!toolbox || !w) return;

    const box = toolbox.getBoundingClientRect();
    App.toolbarDragging = {
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    };
    App.toolbarPreviewDock = null;
    try { grip.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
    e.stopPropagation();
  });

  grip.addEventListener('pointermove', e => {
    const dragging = App.toolbarDragging;
    if (!dragging) return;
    const toolbox = $('canvas-toolbox');
    const w = $('canvas-wrap');
    if (!toolbox || !w) return;

    if (!dragging.moved) {
      if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) < 4) return;
      dragging.moved = true;
      toolbox.classList.add('dragging');
    }

    const wrapRect = w.getBoundingClientRect();
    const margin = TOOLBAR_MARGIN;
    const left = e.clientX - wrapRect.left - dragging.grabX;
    const top = e.clientY - wrapRect.top - dragging.grabY;
    const pointerX = e.clientX - wrapRect.left;
    const pointerY = e.clientY - wrapRect.top;
    toolbox.style.left = `${left}px`;
    toolbox.style.top = `${top}px`;
    toolbox.style.right = 'auto';
    toolbox.style.bottom = 'auto';
    toolbox.style.transform = 'none';
    toolbox.style.maxWidth = `${Math.max(120, wrapRect.width - margin * 2)}px`;

    const side = getToolbarDockFromPoint(pointerX, pointerY, wrapRect);
    const box = toolbox.getBoundingClientRect();
    const ratio = computeToolbarRatio(side, pointerX, pointerY, wrapRect, box);
    App.toolbarPreviewDock = { side, ratio };
    showToolbarPreview({ side, ratio }, wrapRect);
  });

  const finishGripInteraction = e => {
    const dragging = App.toolbarDragging;
    if (!dragging) return;
    const toolbox = $('canvas-toolbox');
    App.toolbarDragging = null;
    removeToolbarPreview();
    try { grip.releasePointerCapture(e.pointerId); } catch (err) { }

    if (!dragging.moved) {
      toggleToolbarCollapsed();
      return;
    }
    if (toolbox) toolbox.classList.remove('dragging');
    const dock = App.toolbarPreviewDock || { side: App.toolbarDock?.side || 'left', ratio: App.toolbarDock?.ratio ?? 0.5 };
    App.toolbarPreviewDock = null;
    App.toolbarDock = dock;
    applyToolbarDock(true);
  };
  grip.addEventListener('pointerup', finishGripInteraction);
  grip.addEventListener('pointercancel', finishGripInteraction);

  window.addEventListener('resize', () => applyToolbarDock(false));
}

if (typeof initToolbarDock === 'function') initToolbarDock();

document.addEventListener('keyup', e => {
  if (e.code !== 'Space') return;
  if (!App.spacePan) return;
  App.spacePan = false;
  const w = $('canvas-wrap');
  if (w) w.classList.remove('space-pan');
});

// ══════════════════════════════════════════════════════════════════
//  MODEL PICKER LOGIC
// ══════════════════════════════════════════════════════════════════

export function renderModelPicker() {
  const menu = $('model-picker-menu');
  if (!menu) return;
  
  let html = '';
  MachineCategories.forEach(cat => {
    html += `
      <div class="model-cat-group">
        <div class="model-cat-group-title">${cat.label}</div>
        ${cat.machines.map(mid => {
          const m = MachineTypes[mid];
          if (!m) return '';
          const isActive = App.machine === mid;
          const isDisabled = m.implemented === false;
          const full = m.fullName || m.label;
          // The short code earns its slot only when it isn't already the opening
          // words of the full name ("Moore" / "Moore Machine" reads as a stutter).
          const showCode = !full.startsWith(mid);
          return `
            <div class="model-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}"
                 onclick="${isDisabled ? '' : `selectModel('${mid}')`}">
              <span class="model-item-label">${full}</span>
              ${isDisabled ? '<span class="model-item-status">Coming Soon</span>'
                           : (showCode ? `<span class="model-item-code">${mid}</span>` : '')}
            </div>
          `;
        }).join('')}
      </div>
    `;
  });

  // Power Hierarchy Summary
  html += `
    <div class="model-hierarchy-summary">
      <div class="model-hierarchy-title">
        <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor">
          <path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z" />
        </svg>
        Chomsky Power Hierarchy
      </div>
      <div class="model-hierarchy-math">
        DFA = NFA < DPDA < NPDA ≤ QA ≤ 2PDA = TM
      </div>
    </div>
  `;

  menu.innerHTML = html;
}

export function toggleModelPicker(force) {
  const container = $('model-picker-container');
  if (!container) return;
  const isOpen = force === undefined ? container.classList.contains('open') : !force;
  
  if (!isOpen) { // Opening
    renderModelPicker();
    container.classList.add('open');
    // Global click listener for and close on outside click
    setTimeout(() => {
      window.addEventListener('click', closeModelPickerOnClickOutside);
    }, 0);
  } else {
    container.classList.remove('open');
    window.removeEventListener('click', closeModelPickerOnClickOutside);
  }
}

export function closeModelPickerOnClickOutside(e) {
  const container = $('model-picker-container');
  if (container && !container.contains(e.target)) {
    toggleModelPicker(false);
  }
}

export function selectModel(id) {
  if (MachineTypes[id] && MachineTypes[id].implemented) {
    setMachine(id);
    toggleModelPicker(false);
  }
}

export function updateModelPickerLabels() {
  const m = MachineTypes[App.machine];
  if (!m) return;
  const cat = MachineCategories.find(c => c.id === m.category);
  
  const catEl = $('cur-model-cat');
  const nameEl = $('cur-model-name');
  if (catEl) catEl.textContent = cat ? cat.label : 'Automata';
  if (nameEl) nameEl.textContent = m.label;
}

// Initial call to set labels
document.addEventListener('DOMContentLoaded', () => {
    updateModelPickerLabels();
});


export function clearSpacePan() {
  if (!App.spacePan) return;
  App.spacePan = false;
  const w = $('canvas-wrap');
  if (w) w.classList.remove('space-pan');
}

export function cancelToolbarDrag() {
  if (!App.toolbarDragging) return;
  App.toolbarDragging = null;
  App.toolbarPreviewDock = null;
  const toolbox = $('canvas-toolbox');
  if (toolbox) toolbox.classList.remove('dragging');
  removeToolbarPreview();
  applyToolbarDock(false);
}

window.addEventListener('blur', () => {
  clearSpacePan();
  cancelToolbarDrag();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  clearSpacePan();
  cancelToolbarDrag();
});

document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target !== document.body && e.target !== document.documentElement && e.target !== $('canvas-wrap')) return;
  // Don't activate spacePan when UTM algo is using Space for auto-play toggle
  if (App.currentAlgo === 'utm') return;
  App.spacePan = true;
  const w = $('canvas-wrap');
  if (w) w.classList.add('space-pan');
  e.preventDefault();
});

export const PANEL_WIDTH_LIMITS = {
  lpanel: { min: 220, max: 420, defaultWidth: 256, storageKey: 'automata-lpanel-width', cssVar: '--lpanel-width' },
  rpanel: { min: 240, max: 480, defaultWidth: 288, storageKey: 'automata-rpanel-width', cssVar: '--rpanel-width' }
};
export let activePanelResize = null;

export function isMobilePanelLayout() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
}

export function clampPanelWidth(panelId, width) {
  const cfg = PANEL_WIDTH_LIMITS[panelId];
  if (!cfg) return width;
  return Math.max(cfg.min, Math.min(cfg.max, width));
}

export function readStoredPanelWidth(panelId) {
  const cfg = PANEL_WIDTH_LIMITS[panelId];
  if (!cfg) return null;
  try {
    const raw = localStorage.getItem(cfg.storageKey);
    if (!raw) return cfg.defaultWidth;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return cfg.defaultWidth;
    return clampPanelWidth(panelId, parsed);
  } catch (e) {
    return cfg.defaultWidth;
  }
}

export function setPanelWidth(panelId, width, persist = true) {
  const cfg = PANEL_WIDTH_LIMITS[panelId];
  if (!cfg) return null;
  const next = Math.round(clampPanelWidth(panelId, width));
  document.documentElement.style.setProperty(cfg.cssVar, `${next}px`);
  if (persist) {
    try { localStorage.setItem(cfg.storageKey, String(next)); } catch (e) { }
  }
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  return next;
}

export function applyStoredPanelWidths() {
  if (isMobilePanelLayout()) return;
  setPanelWidth('lpanel', readStoredPanelWidth('lpanel'), false);
  setPanelWidth('rpanel', readStoredPanelWidth('rpanel'), false);
}

export function startPanelResize(panelId, e) {
  if (e.button !== 0 || isMobilePanelLayout()) return;
  const panel = $(panelId);
  if (!panel || panel.classList.contains('unpinned')) return;
  const cfg = PANEL_WIDTH_LIMITS[panelId];
  if (!cfg) return;

  const handle = panelId === 'lpanel' ? $('lpanel-resizer') : $('rpanel-resizer');
  if (handle) { handle.classList.add('active'); try { handle.setPointerCapture(e.pointerId); } catch (err) { } }
  activePanelResize = {
    panelId,
    startX: e.clientX,
    startWidth: panel.getBoundingClientRect().width
  };
  document.body.classList.add('panel-resizing');
  e.preventDefault();
}

export function handlePanelResizeMove(e) {
  if (!activePanelResize) return;
  const { panelId, startX, startWidth } = activePanelResize;
  const delta = e.clientX - startX;
  const next = panelId === 'lpanel' ? startWidth + delta : startWidth - delta;
  setPanelWidth(panelId, next, false);
}

export function stopPanelResize() {
  if (!activePanelResize) return;
  const { panelId } = activePanelResize;
  const panel = $(panelId);
  if (panel) setPanelWidth(panelId, panel.getBoundingClientRect().width, true);
  const handle = panelId === 'lpanel' ? $('lpanel-resizer') : $('rpanel-resizer');
  if (handle) handle.classList.remove('active');
  activePanelResize = null;
  document.body.classList.remove('panel-resizing');
  if (typeof notifyCanvasResize === 'function') notifyCanvasResize();
}

export function initPanelResizers() {
  const lHandle = $('lpanel-resizer');
  const rHandle = $('rpanel-resizer');
  if (!lHandle || !rHandle || lHandle.dataset.resizeInit === '1') return;

  lHandle.dataset.resizeInit = '1';
  rHandle.dataset.resizeInit = '1';

  lHandle.addEventListener('pointerdown', e => startPanelResize('lpanel', e));
  rHandle.addEventListener('pointerdown', e => startPanelResize('rpanel', e));

  lHandle.addEventListener('dblclick', () => setPanelWidth('lpanel', PANEL_WIDTH_LIMITS.lpanel.defaultWidth, true));
  rHandle.addEventListener('dblclick', () => setPanelWidth('rpanel', PANEL_WIDTH_LIMITS.rpanel.defaultWidth, true));

  document.addEventListener('pointermove', handlePanelResizeMove);
  document.addEventListener('pointerup', stopPanelResize);
  document.addEventListener('pointercancel', stopPanelResize);
  window.addEventListener('resize', applyStoredPanelWidths);

  applyStoredPanelWidths();
}

export function toggleLPanelPin() {
  const s = $('lpanel');
  const unpinned = s.classList.toggle('unpinned');
  const btn = $('lpanel-pin-btn');
  if (btn) btn.dataset.tip = unpinned ? 'Pin left panel' : 'Unpin left panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-lpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

export function toggleRPanelPin() {
  const r = $('rpanel');
  const unpinned = r.classList.toggle('unpinned');
  const btn = $('rpanel-pin-btn');
  if (btn) btn.dataset.tip = unpinned ? 'Pin right panel' : 'Unpin right panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-rpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

export const MOBILE_BUILD_PANEL_IDS = ['lpanel', 'rpanel'];
export const MOBILE_AUX_PANEL_IDS = ['algo-nav', 'gram-left', 'theory-nav'];
export const MOBILE_AUX_PANEL_BY_VIEW = {
  algo: 'algo-nav',
  grammar: 'gram-left',
  theory: 'theory-nav'
};

export function updateMobilePanelChrome() {
  const openId = MOBILE_BUILD_PANEL_IDS.find(id => $(id)?.dataset.mobileCollapsed !== '1') || null;
  const auxId = MOBILE_AUX_PANEL_BY_VIEW[App.view];
  const auxOpen = !!auxId && $(auxId)?.dataset.mobileCollapsed !== '1';
  const scrim = $('mobile-panel-scrim');
  if (scrim) scrim.classList.toggle('open', !!openId);
  const auxScrim = $('mobile-aux-sheet-scrim');
  if (auxScrim) auxScrim.classList.toggle('open', auxOpen);

  document.querySelectorAll('[data-mobile-panel-toggle]').forEach(toggle => {
    const id = toggle.dataset.mobilePanelToggle;
    const isOpen = id === openId || !!$(id) && $(id).dataset.mobileCollapsed !== '1';
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggle.classList.toggle('active', isOpen);
  });
}

export function setMobilePanelCollapsed(id, collapsed, persist = true) {
  const panel = $(id);
  if (!panel) return;
  panel.dataset.mobileCollapsed = collapsed ? '1' : '0';
  panel.querySelectorAll('.mobile-panel-toggle').forEach(toggle => {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  document.querySelectorAll(`[data-mobile-panel-toggle="${id}"]`).forEach(toggle => {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  if (persist) {
    try { localStorage.setItem(`automata-mobile-panel-${id}`, collapsed ? '1' : '0'); } catch (e) { }
  }
  updateMobilePanelChrome();
}

export function toggleMobilePanel(id, force) {
  const panel = $(id);
  if (!panel) return;
  const collapsed = force === undefined ? panel.dataset.mobileCollapsed !== '1' : !!force;

  // Build panels behave like mutually exclusive bottom sheets on mobile. The
  // auxiliary-view navigation panels remain independent because they live in
  // their own overlay.
  if (!collapsed && isMobilePanelLayout() && MOBILE_BUILD_PANEL_IDS.includes(id)) {
    MOBILE_BUILD_PANEL_IDS.filter(otherId => otherId !== id).forEach(otherId => {
      setMobilePanelCollapsed(otherId, true, false);
    });
  }
  setMobilePanelCollapsed(id, collapsed);
}

export function closeMobilePanels() {
  MOBILE_BUILD_PANEL_IDS.forEach(id => setMobilePanelCollapsed(id, true));
}

export function closeMobileAuxNav() {
  const id = MOBILE_AUX_PANEL_BY_VIEW[App.view];
  if (id) setMobilePanelCollapsed(id, true);
}

export function initMobilePanels() {
  let openedBuildPanel = false;
  [...MOBILE_BUILD_PANEL_IDS, ...MOBILE_AUX_PANEL_IDS].forEach(id => {
    let stored = null;
    try { stored = localStorage.getItem(`automata-mobile-panel-${id}`); } catch (e) { }
    // A fresh mobile session should reveal the canvas first. Existing explicit
    // preferences still win, but two build sheets can never be open together.
    const isBuildPanel = MOBILE_BUILD_PANEL_IDS.includes(id);
    const isAuxPanel = MOBILE_AUX_PANEL_IDS.includes(id);
    let collapsed = stored === null ? (isMobilePanelLayout() && (isBuildPanel || isAuxPanel)) : stored === '1';
    if (isMobilePanelLayout() && isBuildPanel && !collapsed) {
      if (openedBuildPanel) collapsed = true;
      else openedBuildPanel = true;
    }
    setMobilePanelCollapsed(id, collapsed, false);
  });
  updateMobilePanelChrome();
}

// Selecting a tool should return the user to the result, not leave the
// navigation sheet covering it. Inputs stay open so a grammar can still be
// edited without repeatedly reopening the sheet.
document.addEventListener('click', e => {
  if (!isMobilePanelLayout()) return;
  const target = e.target && e.target.closest ? e.target.closest.bind(e.target) : null;
  const algoItem = target && target('#algo-nav .algo-item');
  const theoryLink = target && target('#theory-nav .theory-nav-link');
  if (algoItem) {
    requestAnimationFrame(() => setMobilePanelCollapsed('algo-nav', true));
    return;
  }
  if (theoryLink) {
    requestAnimationFrame(() => setMobilePanelCollapsed('theory-nav', true));
    return;
  }
  const grammarAction = target && target('#gram-left button:not(.mobile-panel-toggle)');
  if (grammarAction) requestAnimationFrame(() => setMobilePanelCollapsed('gram-left', true));
});

export function filterStates() {
  const q = ($('state-search')?.value || '').toLowerCase();
  document.querySelectorAll('#states-list .si').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

export function setLPSectionCollapsed(id, collapsed, persist = true) {
  const sec = $(id);
  if (!sec) return;
  sec.classList.toggle('collapsed', !!collapsed);
  const body = sec.querySelector('.lp-section-body');
  if (body) body.style.display = collapsed ? 'none' : '';
  const hdr = sec.querySelector('.lp-section-header');
  if (hdr) hdr.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (persist) {
    try { localStorage.setItem(`automata-lpanel-section-${id}`, collapsed ? '1' : '0'); } catch (e) { }
  }
}

export function toggleLPSection(id) {
  const sec = $(id);
  if (!sec) return;
  const collapsed = !sec.classList.contains('collapsed');
  setLPSectionCollapsed(id, collapsed, true);
}

export function initLPanelSections() {
  ['lp-alphabet', 'stack-sec', 'output-sec', 'lp-states', 'lp-transitions'].forEach(id => {
    let collapsed = false;
    try { collapsed = localStorage.getItem(`automata-lpanel-section-${id}`) === '1'; } catch (e) { }
    setLPSectionCollapsed(id, collapsed, false);
  });
}

export const RP_SECTION_DEFAULTS = { 'rp-language': false, 'rp-simulate': false, 'rp-batch': true };

export function setRPSectionCollapsed(id, collapsed, persist = true) {
  const sec = $(id);
  if (!sec) return;
  sec.classList.toggle('collapsed', !!collapsed);
  const body = sec.querySelector('.rp-section-body');
  if (body) body.style.display = collapsed ? 'none' : '';
  if (persist) {
    try { localStorage.setItem(`automata-rpanel-section-${id}`, collapsed ? '1' : '0'); } catch (e) { }
  }
}

export function toggleRPSection(id) {
  const sec = $(id); if (!sec) return;
  setRPSectionCollapsed(id, !sec.classList.contains('collapsed'), true);
}

export function initRPanelSections() {
  Object.keys(RP_SECTION_DEFAULTS).forEach(id => {
    let collapsed = RP_SECTION_DEFAULTS[id];
    try {
      const raw = localStorage.getItem(`automata-rpanel-section-${id}`);
      if (raw !== null) collapsed = raw === '1';
    } catch (e) { }
    setRPSectionCollapsed(id, collapsed, false);
  });
}

export function filterAlgos() {
  const q = ($('algo-search')?.value || '').toLowerCase();
  document.querySelectorAll('.algo-item').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
  document.querySelectorAll('.algo-grp').forEach(grp => {
    let sib = grp.nextElementSibling, any = false;
    while (sib && sib.classList.contains('algo-item')) {
      if (sib.style.display !== 'none') any = true;
      sib = sib.nextElementSibling;
    }
    grp.style.display = any ? '' : 'none';
  });
}

registerModal('settings-modal', { submit: () => confirmSettings() });

export function openSettingsModal() {
  const c = App.config;
  populateThemeSelect();
  $('set-theme').value = c.theme || DEFAULT_THEME;
  if ($('set-wheel-zoom')) $('set-wheel-zoom').checked = !!c.wheelZoom;
  if ($('set-snap-grid')) $('set-snap-grid').checked = !!c.snapToGrid;
  if ($('set-state-prefix')) $('set-state-prefix').value = c.statePrefix || 'q';
  $('set-transducer-accepts').checked = !!c.transducerAccepts;
  $('set-pda-steps').value = c.maxPdaSteps;
  $('set-pda-paradigm').value = c.pdaParadigm || 'explicit';
  if ($('set-pfa-cutpoint')) $('set-pfa-cutpoint').value = c.pfaCutPoint ?? 0.5;
  $('set-tm-steps').value = c.maxTmSteps;
  if ($('set-lang-budget')) $('set-lang-budget').value = c.langStepBudget ?? 400;
  $('set-auto-speed').value = c.autoSpeed;
  if ($('set-autosave-interval')) $('set-autosave-interval').value = String(c.autosaveIntervalMs ?? 15000);
  $('set-radius').value = c.radius;
  if ($('set-wrap-labels')) $('set-wrap-labels').checked = c.wrapStateLabels !== false;
  if ($('set-edge-label-style')) $('set-edge-label-style').value = normalizeEdgeLabelStyle(c.edgeLabelStyle);
  if ($('set-click-highlight-mode')) $('set-click-highlight-mode').value = c.clickHighlightMode || 'off';
  $('set-zoom-step').value = c.zoom.step;
  $('set-grid-snap').value = c.gridSnap;
  if ($('set-layout-algo')) $('set-layout-algo').value = c.layout.algorithm || 'sugiyama';
  $('set-node-spacing').value = c.layout.nodeSpacing;
  $('set-curve-off').value = c.render.curveOff;
  // An imported or restored config predating collision avoidance has none of
  // these keys, and every pass treats "absent" as on — so the boxes have to as
  // well, or opening Settings would silently turn them all off.
  if ($('set-smart-loops')) $('set-smart-loops').checked = c.render.smartSelfLoops !== false;
  if ($('set-auto-route')) $('set-auto-route').checked = c.render.autoRouteEdges !== false;
  if ($('set-smart-labels')) $('set-smart-labels').checked = c.render.smartLabels !== false;
  if ($('set-avoid-overlap')) $('set-avoid-overlap').checked = c.render.avoidNodeOverlap !== false;
  if ($('set-animate-layout')) $('set-animate-layout').checked = c.render.animateLayout !== false;
  if ($('set-node-clearance')) $('set-node-clearance').value = c.render.nodeClearance ?? 12;
  $('set-export-res').value = c.exportRes || 2;
  $('set-sym-eps').value = c.sym.eps;
  if ($('set-sym-lambda')) $('set-sym-lambda').value = c.sym.lambda;
  $('set-sym-any').value = c.sym.any;
  $('set-sym-blank').value = c.sym.blank;
  $('set-sym-left').value = c.sym.leftMarker;
  $('set-sym-right').value = c.sym.rightMarker;
  $('set-sym-z0').value = c.sym.stackBottom;

  if (typeof switchSettingsTab === 'function') switchSettingsTab('general');
  sizeSettingsPanels();
  showOverlay('settings-modal');
}

export function switchSettingsTab(tabId) {
  const tabs = document.querySelectorAll('#settings-tabs .modal-tab');
  const contents = document.querySelectorAll('#settings-modal .modal-tab-content');

  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.remove('active'));

  const targetTab = document.querySelector(`#settings-tabs [onclick="switchSettingsTab('${tabId}')"]`);
  const targetContent = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');
  if (targetContent) targetContent.classList.add('active');
}

// Panels vary a lot in height (Symbols vs. Transducers), so switching tabs
// with a plain display:none/block toggle made the whole modal resize —
// it's centered via flexbox, so both edges jumped at once. Locking the
// panel wrapper to the tallest tab's height keeps the dialog a fixed size
// no matter which tab is active. Run once per open: measures each panel in
// turn (each becomes visible on its own for a synchronous layout read, so
// nothing actually paints mid-loop) and re-picks the tallest.
export function sizeSettingsPanels() {
  const panels = $('settings-tab-panels');
  if (!panels) return;
  const contents = document.querySelectorAll('#settings-modal .modal-tab-content');
  const prevActive = document.querySelector('#settings-modal .modal-tab-content.active');

  let max = 0;
  contents.forEach(c => {
    c.classList.add('active');
    max = Math.max(max, c.scrollHeight);
    if (c !== prevActive) c.classList.remove('active');
  });
  panels.style.height = max + 'px';
}

export function confirmSettings() {
  const c = App.config;
  applyTheme($('set-theme').value || c.theme || DEFAULT_THEME);
  if ($('set-wheel-zoom')) {
    c.wheelZoom = $('set-wheel-zoom').checked;
    try { localStorage.setItem('automata-wheel-zoom', c.wheelZoom ? '1' : '0'); } catch (e) { }
  }
  if ($('set-snap-grid')) toggleSnapToGrid($('set-snap-grid').checked);
  if ($('set-state-prefix')) c.statePrefix = $('set-state-prefix').value.trim() || 'q';
  c.transducerAccepts = $('set-transducer-accepts').checked;
  c.pdaParadigm = $('set-pda-paradigm').value || 'explicit';
  if ($('set-pfa-cutpoint')) {
    // A cut-point outside [0, 1] can never be crossed in one direction or the
    // other, which would make every word accept or every word reject.
    const cut = parseFloat($('set-pfa-cutpoint').value);
    c.pfaCutPoint = Number.isFinite(cut) ? Math.min(1, Math.max(0, cut)) : 0.5;
  }
  c.maxPdaSteps = parseInt($('set-pda-steps').value) || 2000;
  c.maxTmSteps = parseInt($('set-tm-steps').value) || 10000;
  if ($('set-lang-budget')) {
    c.langStepBudget = Math.max(10, parseInt($('set-lang-budget').value) || 400);
  }
  c.autoSpeed = parseInt($('set-auto-speed').value) || 500;
  if ($('set-autosave-interval')) {
    const interval = parseInt($('set-autosave-interval').value);
    c.autosaveIntervalMs = Number.isFinite(interval) && interval >= 0 ? interval : 15000;
    if (typeof restartAutosaveTimer === 'function') restartAutosaveTimer();
  }
  if ($('sim-speed-sel')) $('sim-speed-sel').value = String(c.autoSpeed);
  if (typeof restartAutoTimerIfPlaying === 'function') restartAutoTimerIfPlaying();
  c.radius = parseInt($('set-radius').value) || 30;
  if ($('set-wrap-labels')) c.wrapStateLabels = $('set-wrap-labels').checked;
  if ($('set-edge-label-style')) c.edgeLabelStyle = normalizeEdgeLabelStyle($('set-edge-label-style').value);
  if ($('set-click-highlight-mode')) {
    c.clickHighlightMode = $('set-click-highlight-mode').value || 'off';
    if (c.clickHighlightMode === 'off' && typeof clearEdgeDirectionHighlight === 'function') clearEdgeDirectionHighlight();
  }
  c.zoom.step = parseFloat($('set-zoom-step').value) || 0.1;
  c.gridSnap = parseInt($('set-grid-snap').value) || 20;
  if ($('set-layout-algo')) c.layout.algorithm = $('set-layout-algo').value || 'sugiyama';
  // Gap between node edges during auto-layout. Clamped so a stray 0 or a
  // negative can't collapse the layout; layoutGap() enforces the same floor
  // for configs that arrive from imports rather than this modal.
  c.layout.nodeSpacing = Math.max(8, parseInt($('set-node-spacing').value) || 35);
  c.render.curveOff = parseInt($('set-curve-off').value) || 45;
  if ($('set-smart-loops')) c.render.smartSelfLoops = $('set-smart-loops').checked;
  if ($('set-auto-route')) c.render.autoRouteEdges = $('set-auto-route').checked;
  if ($('set-smart-labels')) c.render.smartLabels = $('set-smart-labels').checked;
  if ($('set-avoid-overlap')) c.render.avoidNodeOverlap = $('set-avoid-overlap').checked;
  if ($('set-animate-layout')) c.render.animateLayout = $('set-animate-layout').checked;
  if ($('set-node-clearance')) {
    // Clamped because it is a distance every routing search steps in: zero makes
    // "clear of a node" mean "touching it", and an outsized value pushes every
    // label off the diagram.
    const clearance = parseInt($('set-node-clearance').value);
    c.render.nodeClearance = Number.isFinite(clearance) ? Math.min(80, Math.max(0, clearance)) : 12;
  }
  c.exportRes = parseFloat($('set-export-res').value) || 2;
  const oldSyms = { ...c.sym };
  c.sym.eps = $('set-sym-eps').value || oldSyms.eps;
  if ($('set-sym-lambda')) c.sym.lambda = $('set-sym-lambda').value || oldSyms.lambda;
  c.sym.any = $('set-sym-any').value || oldSyms.any;
  c.sym.blank = $('set-sym-blank').value || oldSyms.blank;
  c.sym.leftMarker = $('set-sym-left').value || oldSyms.leftMarker;
  c.sym.rightMarker = $('set-sym-right').value || oldSyms.rightMarker;
  c.sym.stackBottom = $('set-sym-z0').value || oldSyms.stackBottom;

  if (typeof migrateSystemSymbols === 'function') {
    migrateSystemSymbols(oldSyms, c.sym);
  }

  // Apply visual changes
  setR(c.radius);
  // A radius change moves every endpoint, every loop and every label at once,
  // and the animation toggle may itself have just been turned off. Either way
  // the new settings should be what you see, not something being eased toward.
  settleAll();
  renderAll();
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  if (typeof renderGamma === 'function') renderGamma();
  // The quick popover mirrors several of the controls just written, so it
  // re-reads rather than keeping whatever it showed when it was last opened.
  if (typeof refreshQuickSettings === 'function') refreshQuickSettings();
  // Undoable settings changed here should be undoable from here too, or the
  // same setting would behave differently depending on which surface you used.
  // No-ops when only app preferences (theme, symbols, step budgets) moved.
  if (typeof snapshotSettings === 'function') snapshotSettings();
  closeModal('settings-modal');
  showStatus('Settings applied!');
  saveBackupChecked();
}

export function getEditorSettingsData() {
  const c = App.config;
  return {
    theme: c.theme,
    wheelZoom: !!c.wheelZoom,
    snapToGrid: !!c.snapToGrid,
    statePrefix: c.statePrefix || 'q',
    pdaParadigm: c.pdaParadigm,
    pfaCutPoint: c.pfaCutPoint,
    transducerAccepts: !!c.transducerAccepts,
    maxPdaSteps: c.maxPdaSteps,
    maxTmSteps: c.maxTmSteps,
    langStepBudget: c.langStepBudget,
    autoSpeed: c.autoSpeed,
    autosaveIntervalMs: c.autosaveIntervalMs,
    radius: c.radius,
    wrapStateLabels: !!c.wrapStateLabels,
    edgeLabelStyle: normalizeEdgeLabelStyle(c.edgeLabelStyle),
    clickHighlightMode: c.clickHighlightMode || 'off',
    zoomStep: c.zoom.step,
    gridSnap: c.gridSnap,
    layoutAlgorithm: c.layout.algorithm,
    layoutNodeSpacing: c.layout.nodeSpacing,
    renderCurveOff: c.render.curveOff,
    renderSmartSelfLoops: c.render.smartSelfLoops !== false,
    renderAutoRouteEdges: c.render.autoRouteEdges !== false,
    renderSmartLabels: c.render.smartLabels !== false,
    renderAvoidNodeOverlap: c.render.avoidNodeOverlap !== false,
    renderAnimateLayout: c.render.animateLayout !== false,
    renderNodeClearance: c.render.nodeClearance ?? 12,
    exportRes: c.exportRes,
    symEps: c.sym.eps,
    symLambda: c.sym.lambda,
    symAny: c.sym.any,
    symBlank: c.sym.blank,
    symLeft: c.sym.leftMarker,
    symRight: c.sym.rightMarker,
    symZ0: c.sym.stackBottom
  };
}

export function exportSettings() {
  const data = getEditorSettingsData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'automata-settings.json';
  a.click();
  showStatus('Settings profile exported!');
}

export function importSettings(e) {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      populateSettingsModalInputs(data);
      showStatus('Settings loaded! Click Apply to save or Discard to cancel.');
    } catch (err) {
      console.error(err);
      showStatus('Invalid settings file');
    }
  };
  reader.readAsText(f);
}

export function populateSettingsModalInputs(data) {
  populateThemeSelect();
  if (data.theme !== undefined) $('set-theme').value = data.theme;
  if (data.wheelZoom !== undefined && $('set-wheel-zoom')) $('set-wheel-zoom').checked = !!data.wheelZoom;
  if (data.snapToGrid !== undefined && $('set-snap-grid')) $('set-snap-grid').checked = !!data.snapToGrid;
  if (data.statePrefix !== undefined && $('set-state-prefix')) $('set-state-prefix').value = data.statePrefix;
  if (data.pdaParadigm !== undefined) $('set-pda-paradigm').value = data.pdaParadigm;
  if (data.pfaCutPoint !== undefined && $('set-pfa-cutpoint')) $('set-pfa-cutpoint').value = data.pfaCutPoint;
  if (data.transducerAccepts !== undefined) $('set-transducer-accepts').checked = !!data.transducerAccepts;
  if (data.maxPdaSteps !== undefined) $('set-pda-steps').value = data.maxPdaSteps;
  if (data.maxTmSteps !== undefined) $('set-tm-steps').value = data.maxTmSteps;
  if (data.langStepBudget !== undefined && $('set-lang-budget')) $('set-lang-budget').value = data.langStepBudget;
  if (data.autoSpeed !== undefined) $('set-auto-speed').value = data.autoSpeed;
  if (data.autosaveIntervalMs !== undefined && $('set-autosave-interval')) $('set-autosave-interval').value = data.autosaveIntervalMs;
  if (data.radius !== undefined) $('set-radius').value = data.radius;
  if (data.wrapStateLabels !== undefined && $('set-wrap-labels')) $('set-wrap-labels').checked = !!data.wrapStateLabels;
  if (data.edgeLabelStyle !== undefined && $('set-edge-label-style')) $('set-edge-label-style').value = normalizeEdgeLabelStyle(data.edgeLabelStyle);
  if (data.clickHighlightMode !== undefined && $('set-click-highlight-mode')) $('set-click-highlight-mode').value = data.clickHighlightMode;
  if (data.zoomStep !== undefined) $('set-zoom-step').value = data.zoomStep;
  if (data.gridSnap !== undefined) $('set-grid-snap').value = data.gridSnap;
  if (data.layoutAlgorithm !== undefined && $('set-layout-algo')) $('set-layout-algo').value = data.layoutAlgorithm;
  if (data.layoutNodeSpacing !== undefined) $('set-node-spacing').value = data.layoutNodeSpacing;
  if (data.renderCurveOff !== undefined) $('set-curve-off').value = data.renderCurveOff;
  if (data.renderSmartSelfLoops !== undefined && $('set-smart-loops')) $('set-smart-loops').checked = !!data.renderSmartSelfLoops;
  if (data.renderAutoRouteEdges !== undefined && $('set-auto-route')) $('set-auto-route').checked = !!data.renderAutoRouteEdges;
  if (data.renderSmartLabels !== undefined && $('set-smart-labels')) $('set-smart-labels').checked = !!data.renderSmartLabels;
  if (data.renderAvoidNodeOverlap !== undefined && $('set-avoid-overlap')) $('set-avoid-overlap').checked = !!data.renderAvoidNodeOverlap;
  if (data.renderAnimateLayout !== undefined && $('set-animate-layout')) $('set-animate-layout').checked = !!data.renderAnimateLayout;
  if (data.renderNodeClearance !== undefined && $('set-node-clearance')) $('set-node-clearance').value = data.renderNodeClearance;
  if (data.exportRes !== undefined) $('set-export-res').value = data.exportRes;
  if (data.symEps !== undefined) $('set-sym-eps').value = data.symEps;
  if (data.symLambda !== undefined && $('set-sym-lambda')) $('set-sym-lambda').value = data.symLambda;
  if (data.symAny !== undefined) $('set-sym-any').value = data.symAny;
  if (data.symBlank !== undefined) $('set-sym-blank').value = data.symBlank;
  if (data.symLeft !== undefined) $('set-sym-left').value = data.symLeft;
  if (data.symRight !== undefined) $('set-sym-right').value = data.symRight;
  if (data.symZ0 !== undefined) $('set-sym-z0').value = data.symZ0;
}
