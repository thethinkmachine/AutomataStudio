// ══════════════════════════════════════════════════════════════════
//  WORKSPACE TABS UI
// ══════════════════════════════════════════════════════════════════
// Tab accent reflects the workspace's machine *category* (not the exact type)
// so a glance at the dot tells you "finite automaton" vs "stack machine" vs
// "Turing machine" vs "transducer" without needing 18 distinct colors.
const CATEGORY_ACCENT_VAR = { fa: '--accent', mem: '--green', tm: '--orange', special: '--purple' };
let editingTabId = null;
let draggingTabId = null;
let tabDropTargetId = null;
let tabDropPosition = null;
let closedWorkspaces = [];

function getWorkspaceMachine(ws) {
  if (!ws) return null;
  return ws.id === activeWorkspaceId ? App.machine : ws.data?.machine;
}

function getWorkspaceAccent(ws) {
  const machine = getWorkspaceMachine(ws);
  const cat = machine && MachineTypes[machine] ? MachineTypes[machine].category : null;
  return `var(${CATEGORY_ACCENT_VAR[cat] || '--accent'})`;
}

function markActiveWorkspaceSaved() {
  if (!activeWorkspaceId) return;
  const ws = Workspaces.find(w => w.id === activeWorkspaceId);
  if (ws && ws.dirty) {
    ws.dirty = false;
    renderTabs();
  }
}

function escapeTabText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateTabOverflowShadows(tb = $('tab-bar')) {
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

function focusTabElement(id) {
  const tb = $('tab-bar');
  if (!tb) return;
  const tab = tb.querySelector(`.tab[data-tab-id="${id}"]`);
  if (tab) tab.focus();
}

function clearTabDropMarkers(tb = $('tab-bar')) {
  if (!tb) return;
  tb.querySelectorAll('.tab.drop-before, .tab.drop-after, .tab.drop-end').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'drop-end');
  });
}

function moveWorkspaceTab(sourceId, targetId, position = 'after') {
  const fromIdx = Workspaces.findIndex(w => w.id === sourceId);
  const targetIdx = Workspaces.findIndex(w => w.id === targetId);
  if (fromIdx === -1 || targetIdx === -1 || sourceId === targetId) return false;

  const [moved] = Workspaces.splice(fromIdx, 1);
  const baseIdx = Workspaces.findIndex(w => w.id === targetId);
  const insertIdx = position === 'before' ? baseIdx : baseIdx + 1;
  Workspaces.splice(Math.max(0, insertIdx), 0, moved);
  return true;
}

function moveWorkspaceTabToEnd(sourceId) {
  const fromIdx = Workspaces.findIndex(w => w.id === sourceId);
  if (fromIdx === -1 || fromIdx === Workspaces.length - 1) return false;
  const [moved] = Workspaces.splice(fromIdx, 1);
  Workspaces.push(moved);
  return true;
}

function finishTabDrag() {
  clearTabDropMarkers();
  const tb = $('tab-bar');
  if (tb) tb.querySelectorAll('.tab.dragging').forEach(el => el.classList.remove('dragging'));
  draggingTabId = null;
  tabDropTargetId = null;
  tabDropPosition = null;
}

function handleTabDragStart(id, e) {
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

function handleTabDragOver(id, e) {
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

function handleTabDrop(id, e) {
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
  saveBackup();
  requestAnimationFrame(() => focusTabElement(movedId));
}

function handleTabDragEnd() {
  finishTabDrag();
}

function handleTabAddDragOver(e) {
  if (!draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();
  clearTabDropMarkers();
  if (e.currentTarget) e.currentTarget.classList.add('drop-end');
}

function handleTabAddDrop(e) {
  if (!draggingTabId) return;
  e.preventDefault();
  e.stopPropagation();
  const movedId = draggingTabId;
  const moved = moveWorkspaceTabToEnd(draggingTabId);
  finishTabDrag();
  if (!moved) return;

  renderTabs();
  saveBackup();
  requestAnimationFrame(() => focusTabElement(movedId));
}

function handleCreateTabKeydown(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    createTab();
  }
}

function handleTabKeydown(id, e) {
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

function beginRenameTab(id, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  editingTabId = id;
  renderTabs();
}

function handleTabRenameKeydown(id, e) {
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

function commitTabRename(id, inputEl) {
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
  saveBackup();
}

function renderTabs() {
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
function updateSaveIndicator() {
  const btn = $('save-now-btn');
  if (!btn) return;
  const anyDirty = Workspaces.some(w => w.dirty);
  btn.classList.toggle('is-dirty', anyDirty);
  const label = anyDirty ? 'Save workspace — unsaved changes' : 'Workspace saved';
  btn.dataset.tip = label;
  btn.setAttribute('aria-label', label);
}

function renderTabOverflowMenu() {
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

function switchTabFromOverflow(id) {
  hideTabOverflowMenu();
  switchTab(id);
  requestAnimationFrame(() => {
    const tabEl = $('tab-bar')?.querySelector(`.tab[data-tab-id="${id}"]`);
    if (tabEl) tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function toggleTabOverflowMenu(e) {
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

function hideTabOverflowMenu() {
  const menu = $('tab-overflow-menu');
  if (menu) menu.style.display = 'none';
  const btn = $('tab-overflow-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', () => hideTabOverflowMenu());

function createTab(name) {
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
  activeWorkspaceId = newWs.id;

  App.selectedStates.clear();
  App.selectedTransitions.clear();
  if (typeof resetSim === 'function') resetSim();
  if (typeof applyMachineSwitch === 'function') applyMachineSwitch(App.machine);
  
  renderTabs();
  renderAll();
  if (typeof applyCamera === 'function') applyCamera();
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  saveBackup();
}

function switchTab(id) {
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

  activeWorkspaceId = id;
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
  saveBackup();
}

// ── Unsaved-changes guard ─────────────────────────────────────────
// Closing a tab is undoable via the toast, but the undo stack is capped and
// in-memory, so a dirty tab still deserves an explicit prompt. Every close
// path routes through here: it resolves which of the tabs being closed are
// dirty, and only then runs `proceed`.
//
// `proceed` is invoked for Save and Discard alike — Save just persists first.
// Cancel simply never calls it, leaving the workspace untouched.
function confirmDiscardingTabs(ids, proceed) {
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
    saveBtn.onclick = () => {
      // A failed save must not close the tab — that would destroy the very
      // work the prompt exists to protect. saveWorkspaceById reports the
      // failure itself; leaving the dialog open lets the user retry or
      // deliberately discard.
      const allSaved = dirty.every(ws => saveWorkspaceById(ws.id));
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

function closeTab(id, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (Workspaces.length <= 1) return;
  hideTabContextMenu();
  confirmDiscardingTabs([id], () => performCloseTab(id));
}

function performCloseTab(id) {
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
    activeWorkspaceId = null;
    let nextIdx = Math.max(0, idx - 1);
    switchTab(Workspaces[nextIdx].id);
  } else {
    renderTabs();
    saveBackup();
  }
}

function closeOtherTabs(id) {
  hideTabContextMenu();
  if (Workspaces.length <= 1 || !Workspaces.find(w => w.id === id)) return;
  confirmDiscardingTabs(
    Workspaces.filter(w => w.id !== id).map(w => w.id),
    () => performCloseOtherTabs(id)
  );
}

function performCloseOtherTabs(id) {
  if (Workspaces.length <= 1 || !Workspaces.find(w => w.id === id)) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.map((w, i) => ({ w, i })).filter(({ w }) => w.id !== id);
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  Workspaces = Workspaces.filter(w => w.id === id);
  if (editingTabId && editingTabId !== id) editingTabId = null;
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
  if (activeWorkspaceId !== id) {
    activeWorkspaceId = null;
    switchTab(id);
  } else {
    renderTabs();
    saveBackup();
  }
}

function closeTabsToRight(id) {
  hideTabContextMenu();
  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1 || idx >= Workspaces.length - 1) return;
  confirmDiscardingTabs(
    Workspaces.slice(idx + 1).map(w => w.id),
    () => performCloseTabsToRight(id)
  );
}

function performCloseTabsToRight(id) {
  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1 || idx >= Workspaces.length - 1) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.slice(idx + 1).map((w, off) => ({ w, i: idx + 1 + off }));
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  const closingActive = closed.some(({ w }) => w.id === activeWorkspaceId);
  Workspaces = Workspaces.slice(0, idx + 1);
  if (editingTabId && !Workspaces.find(w => w.id === editingTabId)) editingTabId = null;
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
  if (closingActive) {
    activeWorkspaceId = null;
    switchTab(id);
  } else {
    renderTabs();
    saveBackup();
  }
}

function closeAllTabs() {
  hideTabContextMenu();
  if (!Workspaces.length) return;
  confirmDiscardingTabs(Workspaces.map(w => w.id), performCloseAllTabs);
}

function performCloseAllTabs() {
  if (!Workspaces.length) return;
  if (activeWorkspaceId) {
    const act = Workspaces.find(w => w.id === activeWorkspaceId);
    if (act) act.data = exportWorkspaceState();
  }
  const closed = Workspaces.map((w, i) => ({ w, i }));
  closed.forEach(({ w, i }) => recordClosedWorkspace(w, i));
  Workspaces = [];
  activeWorkspaceId = null;
  editingTabId = null;
  createTab();
  showTabUndoToast(closed.length === 1 ? closed[0].w.name : `${closed.length} tabs`, closed.length);
}

function recordClosedWorkspace(workspace, index) {
  closedWorkspaces.push({ workspace, index });
  if (closedWorkspaces.length > 15) closedWorkspaces.shift();
}

function reopenClosedTab() {
  if (!closedWorkspaces.length) { showStatus('No recently closed tabs'); return; }
  const { workspace, index } = closedWorkspaces.pop();
  if (Workspaces.find(w => w.id === workspace.id)) { reopenClosedTab(); return; }
  const insertAt = Math.max(0, Math.min(index, Workspaces.length));
  Workspaces.splice(insertAt, 0, workspace);
  hideTabUndoToast();
  switchTab(workspace.id);
  showStatus(`Reopened "${workspace.name}"`);
}

function showTabUndoToast(label, count) {
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

function hideTabUndoToast() {
  const toast = $('tab-undo-toast');
  if (!toast) return;
  toast.classList.remove('show');
  clearTimeout(toast._t);
}

// ══════════════════════════════════════════════════════════════════
//  TAB CONTEXT MENU
// ══════════════════════════════════════════════════════════════════
let tabCtxId = null;

function showTabContextMenu(id, e) {
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

function hideTabContextMenu() {
  const m = $('tab-ctx-menu');
  if (m) m.style.display = 'none';
  tabCtxId = null;
}

function tabCtxRename() {
  if (!tabCtxId) return;
  const id = tabCtxId;
  hideTabContextMenu();
  beginRenameTab(id);
}

function tabCtxDuplicate() {
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

function tabCtxClose() {
  if (!tabCtxId) return;
  const id = tabCtxId;
  closeTab(id);
}

function tabCtxCloseOthers() {
  if (!tabCtxId) return;
  closeOtherTabs(tabCtxId);
}

function tabCtxCloseRight() {
  if (!tabCtxId) return;
  closeTabsToRight(tabCtxId);
}

function tabCtxCloseAll() {
  closeAllTabs();
}

document.addEventListener('click', () => hideTabContextMenu());

function renameTab(id, e) {
  beginRenameTab(id, e);
}

function initTabs() {
  if (Workspaces.length === 0) {
    Workspaces.push({
      id: 'ws_initial',
      name: 'Workspace 1',
      dirty: false,
      data: exportWorkspaceState()
    });
    activeWorkspaceId = 'ws_initial';
  }
  Workspaces.forEach((ws, idx) => {
    if (!ws.name) ws.name = `Workspace ${idx + 1}`;
    ws.dirty = !!ws.dirty;
  });
  if (!Workspaces.find(w => w.id === activeWorkspaceId)) activeWorkspaceId = Workspaces[0].id;
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
      renderAll(); updateLPanel(); updateRPanel();
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

const ThemeExports = {
  dark: {
    bg: '#080c18',
    nodeFill: '#161d2e',
    nodeStroke: 'rgba(100,130,200,0.22)',
    startStroke: '#69f0ae',
    accStroke: '#ffd54f',
    actFill: 'rgba(79,195,247,.18)',
    actStroke: '#4fc3f7',
    edgeStroke: '#4a5878',
    textFill: '#7a8ab0',
    nodeTextFill: '#c8d4f0',
    viewportStroke: 'rgba(79,195,247,0.6)'
  },
  light: {
    bg: '#eef4fb',
    nodeFill: '#ffffff',
    nodeStroke: 'rgba(41,73,109,0.2)',
    startStroke: '#198b63',
    accStroke: '#b7791f',
    actFill: 'rgba(23,142,216,.12)',
    actStroke: '#178ed8',
    edgeStroke: '#7d92a6',
    textFill: '#496277',
    nodeTextFill: '#16324a',
    viewportStroke: 'rgba(23,142,216,0.45)'
  }
};

function syncThemeExportPalette(theme) {
  App.config.export = { ...App.config.export, ...(ThemeExports[theme] || ThemeExports.dark) };
}

// The theme control lives in the header overflow menu as an icon + label row,
// so only the icon is swapped — replacing innerHTML would drop the label.
function updateThemeButton() {
  const btn = $('theme-btn');
  if (!btn) return;
  const isLight = App.config.theme === 'light';
  const nextTheme = isLight ? 'dark' : 'light';
  const icon = isLight
    ? `<svg viewBox="0 0 256 256" fill="currentColor"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>`
    : `<svg viewBox="0 0 256 256" fill="currentColor"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/></svg>`;

  const svg = btn.querySelector && btn.querySelector('svg');
  if (svg) svg.outerHTML = icon;
  else btn.innerHTML = icon;

  const label = btn.querySelector && btn.querySelector('.theme-btn-label');
  if (label) label.textContent = `Switch to ${nextTheme} theme`;

  btn.dataset.tip = `Switch to ${nextTheme} theme`;
  btn.setAttribute('aria-label', btn.dataset.tip);
}

function applyTheme(theme, persist = true) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  App.config.theme = resolved;
  document.documentElement.dataset.theme = resolved;
  syncThemeExportPalette(resolved);
  updateThemeButton();
  if ($('set-theme')) $('set-theme').value = resolved;
  if (typeof drawMinimap === 'function') drawMinimap();
  if (persist) {
    try { localStorage.setItem('automata-theme', resolved); } catch (e) { }
  }
}

function toggleTheme() {
  applyTheme(App.config.theme === 'light' ? 'dark' : 'light');
  if (typeof renderAll === 'function') renderAll();
  saveBackup();
  showStatus(`Theme: ${App.config.theme}`);
}


// ══════════════════════════════════════════════════════════════════
//  ZOOM / FIT / MINIMAP / SIDEBAR / FILTER FUNCTIONS
// ══════════════════════════════════════════════════════════════════
function zoomIn() {
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

function zoomOut() {
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

function setZoomFromInput(val) {
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

function fitToScreen(silent = false) {
  if (!App.states.length) return;
  const w = $('canvas-wrap'); if (!w) return;
  const cw = w.clientWidth, ch = w.clientHeight;
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
  App.cam.x = cw / 2 - cx * z;
  App.cam.y = ch / 2 - cy * z;
  App.cam.z = z;
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth');
    w.classList.remove('cam-smooth');
  }, 250);
  if (!silent) showStatus('Fit to screen');
}

function autoFitLoadedMachine() {
  // Wait a tick so view switches and panel layout changes settle before fitting.
  setTimeout(() => fitToScreen(true), 50);
}

// ── Keep the diagram framed as the canvas area changes shape ──
// (panel resize/pin/unpin, fullscreen toggle, browser window resize)
function isMachineFullyVisible(vw, vh) {
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

let _lastCanvasSize = null;
let _resizeWasFullyVisible = false;
let _resizeSettleTimer = null;

function notifyCanvasResize() {
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
    else renderMinimap();
  }, 150);
}

function initCanvasResizeObserver() {
  const w = $('canvas-wrap');
  if (!w || !('ResizeObserver' in window) || w._resizeObserverInit) return;
  w._resizeObserverInit = true;
  const rect = w.getBoundingClientRect();
  _lastCanvasSize = { w: rect.width, h: rect.height };
  new ResizeObserver(() => notifyCanvasResize()).observe(w);
}

function centerCameraOn(x, y, animate = true) {
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
function focusStateFromList(id) {
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

function hlListHover(id, on) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.classList.toggle('list-hover-st', on);
}

function focusTransFromList(id) {
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

function hlTransListHover(fromId, toId, on) {
  const el = document.querySelector(`[data-edge="${fromId}|${toId}"]`);
  if (el) el.classList.toggle('list-hover-t', on);
}

function filterTransitions() {
  const q = ($('trans-search')?.value || '').toLowerCase();
  document.querySelectorAll('#trans-list .ti').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function toggleFullscreen() {
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


function renderMinimap() {
  const canvas = $('minimap-canvas'); if (!canvas) return;
  if (!canvas.isConnected) return;
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = App.config.export.bg;
  ctx.fillRect(0, 0, cw, ch);
  if (!App.states.length) return;
  // Compute world bounding box
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
  // Also include viewport extent
  const vw = $('canvas-wrap')?.clientWidth || 600, vh = $('canvas-wrap')?.clientHeight || 400;
  const vpMinX = -App.cam.x / App.cam.z, vpMinY = -App.cam.y / App.cam.z;
  const vpMaxX = (vw - App.cam.x) / App.cam.z, vpMaxY = (vh - App.cam.y) / App.cam.z;
  minX = Math.min(minX, vpMinX); minY = Math.min(minY, vpMinY);
  maxX = Math.max(maxX, vpMaxX); maxY = Math.max(maxY, vpMaxY);
  const bw = maxX - minX, bh = maxY - minY;
  if (!bw || !bh) return;
  const pad = 4;
  const scaleX = (cw - pad * 2) / bw, scaleY = (ch - pad * 2) / bh;
  const mmScale = Math.min(scaleX, scaleY);
  const mmOffX = pad + (cw - pad * 2 - bw * mmScale) / 2;
  const mmOffY = pad + (ch - pad * 2 - bh * mmScale) / 2;
  // Save for click navigation
  canvas._mmScale = mmScale; canvas._mmOffX = mmOffX; canvas._mmOffY = mmOffY;
  canvas._mmMinX = minX; canvas._mmMinY = minY;
  // Draw dividers first so they sit behind the machine, as on the canvas
  if (App.dividers && App.dividers.length) {
    ctx.save();
    ctx.strokeStyle = App.config.export.textFill;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    App.dividers.forEach(d => {
      const ax = (d.x1 - minX) * mmScale + mmOffX, ay = (d.y1 - minY) * mmScale + mmOffY;
      const bx = (d.x2 - minX) * mmScale + mmOffX, by = (d.y2 - minY) * mmScale + mmOffY;
      ctx.beginPath();
      if (typeof isRectDivider === 'function' && isRectDivider(d)) {
        // The two stored points are opposite corners, so a plain moveTo/lineTo
        // would draw the box's diagonal instead of the box.
        ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      } else {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    });
    ctx.restore();
  }
  // Draw transitions
  ctx.strokeStyle = App.config.export.edgeStroke;
  ctx.lineWidth = 1;
  App.transitions.forEach(tr => {
    const fs = App.states.find(s => s.id === tr.from);
    const ts2 = App.states.find(s => s.id === tr.to);
    if (!fs || !ts2) return;
    ctx.beginPath();
    ctx.moveTo((fs.x - minX) * mmScale + mmOffX, (fs.y - minY) * mmScale + mmOffY);
    ctx.lineTo((ts2.x - minX) * mmScale + mmOffX, (ts2.y - minY) * mmScale + mmOffY);
    ctx.stroke();
  });
  // Draw states
  App.states.forEach(s => {
    const sx = (s.x - minX) * mmScale + mmOffX;
    const sy = (s.y - minY) * mmScale + mmOffY;
    const sr = Math.max(2, R_PAD * mmScale * 0.7);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = App.accepts.has(s.id) ? App.config.export.accStroke : App.config.export.actStroke;
    ctx.fill();
  });
  // Draw notes as small squares
  if (typeof resolveNotePos === 'function') {
    ctx.fillStyle = App.config.export.textFill;
    App.notes.forEach(note => {
      const pos = resolveNotePos(note);
      const nx = (pos.x - minX) * mmScale + mmOffX;
      const ny = (pos.y - minY) * mmScale + mmOffY;
      const s = 3;
      ctx.fillRect(nx - s / 2, ny - s / 2, s, s);
    });
  }
  // Draw viewport rect
  const rx = (vpMinX - minX) * mmScale + mmOffX;
  const ry = (vpMinY - minY) * mmScale + mmOffY;
  const rw = (vpMaxX - vpMinX) * mmScale;
  const rh = (vpMaxY - vpMinY) * mmScale;
  ctx.strokeStyle = App.config.export.viewportStroke || App.config.export.actStroke;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rx, ry, rw, rh);
}

function toggleMinimap() {
  const mm = $('minimap-container'), sb = $('minimap-show-btn');
  if (!mm) return;
  const hidden = mm.classList.toggle('minimap-hidden');
  if (sb) sb.style.display = hidden ? '' : 'none';
  try { localStorage.setItem('automata-minimap', hidden ? '0' : '1'); } catch (e) { }
  // The collapsed stand-in is a different height from the map it replaces,
  // so the stack above it has to be re-stacked.
  if (typeof layoutCanvasOverlays === 'function') layoutCanvasOverlays();
}

function minimapNavigate(e, animate = true) {
  const canvas = $('minimap-canvas'); if (!canvas) return;
  if (!canvas._mmScale) return;
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy2 = e.clientY - rect.top;
  // Convert minimap coords → world coords
  const worldX = (cx - canvas._mmOffX) / canvas._mmScale + canvas._mmMinX;
  const worldY = (cy2 - canvas._mmOffY) / canvas._mmScale + canvas._mmMinY;
  // Pan camera to center on this world point
  const w = $('canvas-wrap'); if (!w) return;
  App.cam.x = w.clientWidth / 2 - worldX * App.cam.z;
  App.cam.y = w.clientHeight / 2 - worldY * App.cam.z;

  if (animate) { $('cam-g').classList.add('cam-smooth'); w.classList.add('cam-smooth'); }
  applyCamera(true);
  if (animate) {
    setTimeout(() => {
      $('cam-g').classList.remove('cam-smooth');
      w.classList.remove('cam-smooth');
    }, 250);
  }
}

// Minimap viewport is draggable, not just click-to-jump.
let _minimapDragging = false;
function initMinimapDrag() {
  const canvas = $('minimap-canvas');
  if (!canvas || canvas._dragInit) return;
  canvas._dragInit = true;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    _minimapDragging = true;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    minimapNavigate(e, false);
  });
  canvas.addEventListener('pointermove', e => {
    if (!_minimapDragging) return;
    minimapNavigate(e, false);
  });
  const end = () => {
    if (!_minimapDragging) return;
    _minimapDragging = false;
    canvas.classList.remove('dragging');
    renderMinimap();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function setTool(t) {
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

function toggleTool(t) {
  setTool(App.tool === t && t !== 'pointer' ? 'pointer' : t);
}

const TOOLBAR_DOCK_KEY = 'automata-toolbar-dock';
const TOOLBAR_MARGIN = 12;

function isCompactToolbarMode() {
  return window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
}

function normalizeToolbarDock(dock) {
  const fallback = dock && ['top', 'bottom', 'left', 'right'].includes(dock.side)
    ? dock
    : getDefaultToolbarDock();
  if (isCompactToolbarMode()) return { side: 'bottom', ratio: 0.5 };
  return { side: fallback.side, ratio: clamp01(typeof fallback.ratio === 'number' ? fallback.ratio : 0.5) };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function getDefaultToolbarDock() {
  const isNarrow = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  return { side: isNarrow ? 'bottom' : 'left', ratio: 0.5 };
}

function readToolbarDock() {
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

function saveToolbarDock() {
  try {
    if (App.toolbarDock) localStorage.setItem(TOOLBAR_DOCK_KEY, JSON.stringify(App.toolbarDock));
  } catch (e) { }
}

function getToolbarDockFromPoint(pointerX, pointerY, wrapRect) {
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
function stripToolbarPreviewClone(root) {
  root.removeAttribute('onclick');
  root.setAttribute('aria-hidden', 'true');
  root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  root.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
  root.querySelectorAll('button, input, select').forEach(el => { el.tabIndex = -1; });
}

function ensureToolbarPreview() {
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

function showToolbarPreview(dock, wrapRect) {
  const preview = ensureToolbarPreview();
  if (!preview) return;
  positionToolbarNode(preview, dock, wrapRect);
  preview.classList.add('visible');
}

function removeToolbarPreview() {
  const preview = $('toolbar-dock-preview');
  if (preview) preview.remove();
}

const TOOLBAR_COLLAPSE_KEY = 'automata-toolbar-collapsed';
function toggleToolbarCollapsed(force) {
  const toolbox = $('canvas-toolbox');
  if (!toolbox) return;
  App.toolbarCollapsed = force !== undefined ? !!force : !App.toolbarCollapsed;
  toolbox.classList.toggle('collapsed', App.toolbarCollapsed);
  try { localStorage.setItem(TOOLBAR_COLLAPSE_KEY, App.toolbarCollapsed ? '1' : '0'); } catch (e) { }
  requestAnimationFrame(() => applyToolbarDock(false));
}
function initToolbarCollapse() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(TOOLBAR_COLLAPSE_KEY) === '1'; } catch (e) { }
  App.toolbarCollapsed = collapsed;
  const toolbox = $('canvas-toolbox');
  if (toolbox) toolbox.classList.toggle('collapsed', collapsed);
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
}

function computeToolbarRatio(side, pointerX, pointerY, wrapRect, box) {
  const margin = TOOLBAR_MARGIN;
  return side === 'left' || side === 'right'
    ? clamp01((pointerY - box.height / 2 - margin) / Math.max(1, wrapRect.height - box.height - margin * 2))
    : clamp01((pointerX - box.width / 2 - margin) / Math.max(1, wrapRect.width - box.width - margin * 2));
}

function positionToolbarNode(node, dock, wrapRect) {
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

function applyToolbarDock(persist = false) {
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
const OVERLAY_GAP = 8;

function canvasOverlayCorner(dock, wrapRect, toolbarBox) {
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
    // Horizontal bar along the bottom. Sitting left of centre leaves the
    // bottom-right free; otherwise drop the stack to the bottom-left.
    return ratio > 0.5 ? { x: 'left', y: 'bottom' } : { x: 'right', y: 'bottom' };
  }

  return { x: 'right', y: 'bottom' };
}

// Places the visible members of the stack in the chosen corner, stacking
// upward from the bottom edge (or downward from the top).
function layoutCanvasOverlays(wrapRect, toolbarBox) {
  const w = $('canvas-wrap');
  if (!w) return;
  const rect = wrapRect || w.getBoundingClientRect();
  const corner = canvasOverlayCorner(App.toolbarDock, rect, toolbarBox);
  const margin = TOOLBAR_MARGIN;

  const nav = $('canvas-nav-controls');
  const map = $('minimap-container');
  const showBtn = $('minimap-show-btn');

  // Bottom-up in visual order: zoom controls sit outermost, the minimap (or
  // its collapsed stand-in) rests on top of them.
  const stack = [nav, (map && !map.classList.contains('minimap-hidden')) ? map : showBtn]
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
}

function initToolbarDock() {
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

function renderModelPicker() {
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
          return `
            <div class="model-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" 
                 onclick="${isDisabled ? '' : `selectModel('${mid}')`}">
              <span class="model-item-label">${m.label}</span>
              ${isDisabled ? '<span class="model-item-status">Coming Soon</span>' : ''}
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

function toggleModelPicker(force) {
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

function closeModelPickerOnClickOutside(e) {
  const container = $('model-picker-container');
  if (container && !container.contains(e.target)) {
    toggleModelPicker(false);
  }
}

function selectModel(id) {
  if (MachineTypes[id] && MachineTypes[id].implemented) {
    setMachine(id);
    toggleModelPicker(false);
  }
}

function updateModelPickerLabels() {
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


function clearSpacePan() {
  if (!App.spacePan) return;
  App.spacePan = false;
  const w = $('canvas-wrap');
  if (w) w.classList.remove('space-pan');
}

function cancelToolbarDrag() {
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

const PANEL_WIDTH_LIMITS = {
  lpanel: { min: 220, max: 420, defaultWidth: 256, storageKey: 'automata-lpanel-width', cssVar: '--lpanel-width' },
  rpanel: { min: 240, max: 480, defaultWidth: 288, storageKey: 'automata-rpanel-width', cssVar: '--rpanel-width' }
};
let activePanelResize = null;

function isMobilePanelLayout() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
}

function clampPanelWidth(panelId, width) {
  const cfg = PANEL_WIDTH_LIMITS[panelId];
  if (!cfg) return width;
  return Math.max(cfg.min, Math.min(cfg.max, width));
}

function readStoredPanelWidth(panelId) {
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

function setPanelWidth(panelId, width, persist = true) {
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

function applyStoredPanelWidths() {
  if (isMobilePanelLayout()) return;
  setPanelWidth('lpanel', readStoredPanelWidth('lpanel'), false);
  setPanelWidth('rpanel', readStoredPanelWidth('rpanel'), false);
}

function startPanelResize(panelId, e) {
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

function handlePanelResizeMove(e) {
  if (!activePanelResize) return;
  const { panelId, startX, startWidth } = activePanelResize;
  const delta = e.clientX - startX;
  const next = panelId === 'lpanel' ? startWidth + delta : startWidth - delta;
  setPanelWidth(panelId, next, false);
}

function stopPanelResize() {
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

function initPanelResizers() {
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

function toggleLPanelPin() {
  const s = $('lpanel');
  const unpinned = s.classList.toggle('unpinned');
  const btn = $('lpanel-pin-btn');
  if (btn) btn.dataset.tip = unpinned ? 'Pin left panel' : 'Unpin left panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-lpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

function toggleRPanelPin() {
  const r = $('rpanel');
  const unpinned = r.classList.toggle('unpinned');
  const btn = $('rpanel-pin-btn');
  if (btn) btn.dataset.tip = unpinned ? 'Pin right panel' : 'Unpin right panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-rpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

const MOBILE_BUILD_PANEL_IDS = ['lpanel', 'rpanel'];
const MOBILE_AUX_PANEL_IDS = ['algo-nav', 'gram-left', 'theory-nav'];
const MOBILE_AUX_PANEL_BY_VIEW = {
  algo: 'algo-nav',
  grammar: 'gram-left',
  theory: 'theory-nav'
};

function updateMobilePanelChrome() {
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

function setMobilePanelCollapsed(id, collapsed, persist = true) {
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

function toggleMobilePanel(id, force) {
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

function closeMobilePanels() {
  MOBILE_BUILD_PANEL_IDS.forEach(id => setMobilePanelCollapsed(id, true));
}

function closeMobileAuxNav() {
  const id = MOBILE_AUX_PANEL_BY_VIEW[App.view];
  if (id) setMobilePanelCollapsed(id, true);
}

function initMobilePanels() {
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

function filterStates() {
  const q = ($('state-search')?.value || '').toLowerCase();
  document.querySelectorAll('#states-list .si').forEach(el => {
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function setLPSectionCollapsed(id, collapsed, persist = true) {
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

function toggleLPSection(id) {
  const sec = $(id);
  if (!sec) return;
  const collapsed = !sec.classList.contains('collapsed');
  setLPSectionCollapsed(id, collapsed, true);
}

function initLPanelSections() {
  ['lp-alphabet', 'stack-sec', 'output-sec', 'lp-states', 'lp-transitions'].forEach(id => {
    let collapsed = false;
    try { collapsed = localStorage.getItem(`automata-lpanel-section-${id}`) === '1'; } catch (e) { }
    setLPSectionCollapsed(id, collapsed, false);
  });
}

const RP_SECTION_DEFAULTS = { 'rp-language': false, 'rp-simulate': false, 'rp-batch': true };

function setRPSectionCollapsed(id, collapsed, persist = true) {
  const sec = $(id);
  if (!sec) return;
  sec.classList.toggle('collapsed', !!collapsed);
  const body = sec.querySelector('.rp-section-body');
  if (body) body.style.display = collapsed ? 'none' : '';
  if (persist) {
    try { localStorage.setItem(`automata-rpanel-section-${id}`, collapsed ? '1' : '0'); } catch (e) { }
  }
}

function toggleRPSection(id) {
  const sec = $(id); if (!sec) return;
  setRPSectionCollapsed(id, !sec.classList.contains('collapsed'), true);
}

function initRPanelSections() {
  Object.keys(RP_SECTION_DEFAULTS).forEach(id => {
    let collapsed = RP_SECTION_DEFAULTS[id];
    try {
      const raw = localStorage.getItem(`automata-rpanel-section-${id}`);
      if (raw !== null) collapsed = raw === '1';
    } catch (e) { }
    setRPSectionCollapsed(id, collapsed, false);
  });
}

function filterAlgos() {
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

function openSettingsModal() {
  const c = App.config;
  $('set-theme').value = c.theme || 'dark';
  if ($('set-wheel-zoom')) $('set-wheel-zoom').checked = !!c.wheelZoom;
  $('set-transducer-accepts').checked = !!c.transducerAccepts;
  $('set-pda-steps').value = c.maxPdaSteps;
  $('set-pda-paradigm').value = c.pdaParadigm || 'explicit';
  $('set-tm-steps').value = c.maxTmSteps;
  if ($('set-lang-budget')) $('set-lang-budget').value = c.langStepBudget ?? 400;
  $('set-auto-speed').value = c.autoSpeed;
  $('set-radius').value = c.radius;
  if ($('set-wrap-labels')) $('set-wrap-labels').checked = c.wrapStateLabels !== false;
  if ($('set-click-highlight-mode')) $('set-click-highlight-mode').value = c.clickHighlightMode || 'off';
  $('set-zoom-step').value = c.zoom.step;
  $('set-grid-snap').value = c.gridSnap;
  if ($('set-layout-algo')) $('set-layout-algo').value = c.layout.algorithm || 'sugiyama';
  $('set-node-spacing').value = c.layout.nodeSpacing;
  $('set-curve-off').value = c.render.curveOff;
  $('set-export-res').value = c.exportRes || 2;
  $('set-sym-eps').value = c.sym.eps;
  $('set-sym-any').value = c.sym.any;
  $('set-sym-blank').value = c.sym.blank;
  $('set-sym-left').value = c.sym.leftMarker;
  $('set-sym-right').value = c.sym.rightMarker;
  $('set-sym-z0').value = c.sym.stackBottom;
  
  if (typeof switchSettingsTab === 'function') switchSettingsTab('general');
  showOverlay('settings-modal');
}

function switchSettingsTab(tabId) {
  const tabs = document.querySelectorAll('#settings-tabs .modal-tab');
  const contents = document.querySelectorAll('#settings-modal .modal-tab-content');
  
  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.remove('active'));
  
  const targetTab = document.querySelector(`#settings-tabs [onclick="switchSettingsTab('${tabId}')"]`);
  const targetContent = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');
  if (targetContent) targetContent.classList.add('active');
}

function confirmSettings() {
  const c = App.config;
  applyTheme($('set-theme').value || c.theme || 'dark');
  if ($('set-wheel-zoom')) {
    c.wheelZoom = $('set-wheel-zoom').checked;
    try { localStorage.setItem('automata-wheel-zoom', c.wheelZoom ? '1' : '0'); } catch (e) { }
  }
  c.transducerAccepts = $('set-transducer-accepts').checked;
  c.pdaParadigm = $('set-pda-paradigm').value || 'explicit';
  c.maxPdaSteps = parseInt($('set-pda-steps').value) || 2000;
  c.maxTmSteps = parseInt($('set-tm-steps').value) || 10000;
  if ($('set-lang-budget')) {
    c.langStepBudget = Math.max(10, parseInt($('set-lang-budget').value) || 400);
  }
  c.autoSpeed = parseInt($('set-auto-speed').value) || 500;
  if ($('sim-speed-sel')) $('sim-speed-sel').value = String(c.autoSpeed);
  if (typeof restartAutoTimerIfPlaying === 'function') restartAutoTimerIfPlaying();
  c.radius = parseInt($('set-radius').value) || 30;
  if ($('set-wrap-labels')) c.wrapStateLabels = $('set-wrap-labels').checked;
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
  c.exportRes = parseFloat($('set-export-res').value) || 2;
  const oldSyms = { ...c.sym };
  c.sym.eps = $('set-sym-eps').value || oldSyms.eps;
  c.sym.any = $('set-sym-any').value || oldSyms.any;
  c.sym.blank = $('set-sym-blank').value || oldSyms.blank;
  c.sym.leftMarker = $('set-sym-left').value || oldSyms.leftMarker;
  c.sym.rightMarker = $('set-sym-right').value || oldSyms.rightMarker;
  c.sym.stackBottom = $('set-sym-z0').value || oldSyms.stackBottom;

  if (typeof migrateSystemSymbols === 'function') {
    migrateSystemSymbols(oldSyms, c.sym);
  }

  // Apply visual changes
  R = c.radius;
  renderAll();
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  if (typeof renderGamma === 'function') renderGamma();
  closeModal('settings-modal');
  showStatus('Settings applied!');
  saveBackup();
}

function getEditorSettingsData() {
  const c = App.config;
  return {
    theme: c.theme,
    wheelZoom: !!c.wheelZoom,
    pdaParadigm: c.pdaParadigm,
    transducerAccepts: !!c.transducerAccepts,
    maxPdaSteps: c.maxPdaSteps,
    maxTmSteps: c.maxTmSteps,
    langStepBudget: c.langStepBudget,
    autoSpeed: c.autoSpeed,
    radius: c.radius,
    wrapStateLabels: !!c.wrapStateLabels,
    clickHighlightMode: c.clickHighlightMode || 'off',
    zoomStep: c.zoom.step,
    gridSnap: c.gridSnap,
    layoutAlgorithm: c.layout.algorithm,
    layoutNodeSpacing: c.layout.nodeSpacing,
    renderCurveOff: c.render.curveOff,
    exportRes: c.exportRes,
    symEps: c.sym.eps,
    symAny: c.sym.any,
    symBlank: c.sym.blank,
    symLeft: c.sym.leftMarker,
    symRight: c.sym.rightMarker,
    symZ0: c.sym.stackBottom
  };
}

function exportSettings() {
  const data = getEditorSettingsData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'automata-settings.json';
  a.click();
  showStatus('Settings profile exported!');
}

function importSettings(e) {
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

function populateSettingsModalInputs(data) {
  if (data.theme !== undefined) $('set-theme').value = data.theme;
  if (data.wheelZoom !== undefined && $('set-wheel-zoom')) $('set-wheel-zoom').checked = !!data.wheelZoom;
  if (data.pdaParadigm !== undefined) $('set-pda-paradigm').value = data.pdaParadigm;
  if (data.transducerAccepts !== undefined) $('set-transducer-accepts').checked = !!data.transducerAccepts;
  if (data.maxPdaSteps !== undefined) $('set-pda-steps').value = data.maxPdaSteps;
  if (data.maxTmSteps !== undefined) $('set-tm-steps').value = data.maxTmSteps;
  if (data.langStepBudget !== undefined && $('set-lang-budget')) $('set-lang-budget').value = data.langStepBudget;
  if (data.autoSpeed !== undefined) $('set-auto-speed').value = data.autoSpeed;
  if (data.radius !== undefined) $('set-radius').value = data.radius;
  if (data.wrapStateLabels !== undefined && $('set-wrap-labels')) $('set-wrap-labels').checked = !!data.wrapStateLabels;
  if (data.clickHighlightMode !== undefined && $('set-click-highlight-mode')) $('set-click-highlight-mode').value = data.clickHighlightMode;
  if (data.zoomStep !== undefined) $('set-zoom-step').value = data.zoomStep;
  if (data.gridSnap !== undefined) $('set-grid-snap').value = data.gridSnap;
  if (data.layoutAlgorithm !== undefined && $('set-layout-algo')) $('set-layout-algo').value = data.layoutAlgorithm;
  if (data.layoutNodeSpacing !== undefined) $('set-node-spacing').value = data.layoutNodeSpacing;
  if (data.renderCurveOff !== undefined) $('set-curve-off').value = data.renderCurveOff;
  if (data.exportRes !== undefined) $('set-export-res').value = data.exportRes;
  if (data.symEps !== undefined) $('set-sym-eps').value = data.symEps;
  if (data.symAny !== undefined) $('set-sym-any').value = data.symAny;
  if (data.symBlank !== undefined) $('set-sym-blank').value = data.symBlank;
  if (data.symLeft !== undefined) $('set-sym-left').value = data.symLeft;
  if (data.symRight !== undefined) $('set-sym-right').value = data.symRight;
  if (data.symZ0 !== undefined) $('set-sym-z0').value = data.symZ0;
}
