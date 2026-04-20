// ══════════════════════════════════════════════════════════════════
//  WORKSPACE TABS UI
// ══════════════════════════════════════════════════════════════════
const TAB_ACCENTS = ['var(--accent)', 'var(--green)', 'var(--gold)', 'var(--orange)', 'var(--purple)', 'var(--red)'];
let editingTabId = null;
let draggingTabId = null;
let tabDropTargetId = null;
let tabDropPosition = null;

function tabHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  return Math.abs(h);
}

function getWorkspaceAccent(id) {
  return TAB_ACCENTS[tabHash(String(id || 'ws')) % TAB_ACCENTS.length];
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
    const nameMarkup = isEditing
      ? `<input class="tab-rename-input" value="${safeName}" maxlength="40" aria-label="Rename workspace" onclick="event.stopPropagation()" onkeydown="handleTabRenameKeydown('${ws.id}', event)" onblur="commitTabRename('${ws.id}', this)">`
      : `<span class="tab-name" title="${safeName}">${safeName}</span>`;

    return `
    <div class="tab ${isActive ? 'active' : ''} ${dragClass}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? '0' : '-1'}" data-tab-id="${ws.id}" style="--tab-accent:${getWorkspaceAccent(ws.id)}" draggable="${isEditing ? 'false' : 'true'}" onclick="switchTab('${ws.id}')" ondblclick="beginRenameTab('${ws.id}', event)" onkeydown="handleTabKeydown('${ws.id}', event)" ondragstart="handleTabDragStart('${ws.id}', event)" ondragover="handleTabDragOver('${ws.id}', event)" ondrop="handleTabDrop('${ws.id}', event)" ondragend="handleTabDragEnd(event)">
      <span class="tab-dot" aria-hidden="true"></span>
      ${nameMarkup}
      ${ws.dirty ? '<span class="tab-dirty" aria-hidden="true" title="Unsaved changes"></span>' : ''}
      ${Workspaces.length > 1 ? `<button class="tab-close" type="button" aria-label="Close ${safeName}" onclick="closeTab('${ws.id}', event)">×</button>` : ''}
    </div>
  `;
  }).join('') + `
    <div class="tab tab-add" role="button" tabindex="0" aria-label="Create workspace" draggable="false" onclick="createTab()" onkeydown="handleCreateTabKeydown(event)" ondragover="handleTabAddDragOver(event)" ondrop="handleTabAddDrop(event)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
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
}

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
      act.dirty = false;
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
      act.dirty = false;
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
  if (typeof updateLPanel === 'function') updateLPanel();
  if (typeof updateRPanel === 'function') updateRPanel();
  saveBackup();
}

function closeTab(id, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (Workspaces.length <= 1) return;
  if (editingTabId === id) editingTabId = null;
  
  const idx = Workspaces.findIndex(w => w.id === id);
  if (idx === -1) return;
  
  Workspaces.splice(idx, 1);
  if (id === activeWorkspaceId) {
    activeWorkspaceId = null;
    let nextIdx = Math.max(0, idx - 1);
    switchTab(Workspaces[nextIdx].id);
  } else {
    renderTabs();
    saveBackup();
  }
}

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
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y' || e.key === 'Z') { e.preventDefault(); redo(); }
    if (e.key === 's') { e.preventDefault(); saveJSON(); }
    return;
  }
  if (e.key === 'v' || e.key === 'V') setTool('move');
  if (e.key === 's' || e.key === 'S') setTool('state');
  if (e.key === 't' || e.key === 'T') setTool('trans');
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); fitToScreen(); }
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  if (e.key === 'd' || e.key === 'D') setTool('del');
  if (e.key === 'x' || e.key === 'X') clearAll();
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (App.selectedStates.size || App.selectedTransitions.size) {
      e.preventDefault();
      snapshot();
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
    }
  }
  if (e.key === 'Escape') {
    const anyModalOpen = document.querySelector('.overlay.show');
    if (anyModalOpen) {
      closeModal('trans-modal'); closeModal('state-modal'); closeModal('help-modal');
    } else {
      App.transFrom = null; clearTempLine(); setTool('pointer');
    }
  }
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (App.currentAlgo === 'utm') utmStepFwd(); else stepFwd();
  }
  if (e.key === 'ArrowLeft') {
    if (App.currentAlgo === 'utm') utmStepBack(); else stepBack();
  }
  if (e.key === ' ' && App.currentAlgo === 'utm') {
    e.preventDefault();
    utmToggleAuto();
  }
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

function updateThemeButton() {
  const btn = $('theme-btn');
  if (!btn) return;
  const nextTheme = App.config.theme === 'light' ? 'dark' : 'light';
  btn.innerHTML = App.config.theme === 'light'
    ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
  btn.title = `Switch to ${nextTheme} theme`;
  btn.setAttribute('aria-label', btn.title);
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  App.states.forEach(s => {
    minX = Math.min(minX, s.x - R);
    minY = Math.min(minY, s.y - R);
    maxX = Math.max(maxX, s.x + R);
    maxY = Math.max(maxY, s.y + R);
  });
  const bw = maxX - minX, bh = maxY - minY;
  const scaleX = (cw - pad * 2) / bw;
  const scaleY = (ch - pad * 2) / bh;
  const z = Math.min(App.config.zoom.max, Math.min(scaleX, scaleY));
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
    btn.title = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
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
}

function minimapNavigate(e) {
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
  
  $('cam-g').classList.add('cam-smooth');
  w.classList.add('cam-smooth');
  applyCamera();
  setTimeout(() => {
    $('cam-g').classList.remove('cam-smooth');
    w.classList.remove('cam-smooth');
  }, 250);
}

function setTool(t) {
  App.tool = t;
  if (App.transFrom && typeof hlState === 'function') hlState(App.transFrom, false);
  App.transFrom = null;
  if (typeof clearTempLine === 'function') clearTempLine();

  const w = $('canvas-wrap');
  if (w) {
    const cursors = { pointer: 'default', move: 'grab', state: 'crosshair', trans: 'crosshair', del: 'not-allowed' };
    w.style.cursor = cursors[t] || 'default';
    w.setAttribute('data-tool', t);
  }

  document.querySelectorAll('.toolbox-btn[id^="t-"]').forEach(b => {
    const isActive = b.id === `t-${t}`;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const msgs = {
    pointer: 'Click or drag states to interact',
    move: 'Drag canvas to pan · drag state to move · click the active tool again to return to Pointer',
    state: 'Click canvas to place state · click the active tool again to return to Pointer',
    trans: 'Click source then target state · click the active tool again to return to Pointer',
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

function stripToolbarClone(root) {
  if (!root) return;
  root.removeAttribute('onclick');
  root.setAttribute('aria-hidden', 'true');
  root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  root.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
  root.querySelectorAll('button').forEach(btn => btn.tabIndex = -1);
}

function ensureToolbarPreview() {
  const wrap = $('canvas-wrap');
  const toolbox = $('canvas-toolbox');
  if (!wrap || !toolbox) return null;
  let preview = $('toolbar-dock-preview');
  if (preview) return preview;
  preview = toolbox.cloneNode(true);
  preview.id = 'toolbar-dock-preview';
  preview.classList.add('toolbar-preview');
  stripToolbarClone(preview);
  wrap.appendChild(preview);
  return preview;
}

function removeToolbarPreview() {
  const preview = $('toolbar-dock-preview');
  if (preview) preview.remove();
  App.toolbarPreviewDock = null;
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

function updateToolbarDockPreview(pointerX, pointerY, wrapRect) {
  const preview = ensureToolbarPreview();
  if (!preview) return null;

  const side = getToolbarDockFromPoint(pointerX, pointerY, wrapRect);
  positionToolbarNode(preview, { side, ratio: 0.5 }, wrapRect);
  const box = preview.getBoundingClientRect();
  const margin = TOOLBAR_MARGIN;
  const ratio = side === 'left' || side === 'right'
    ? clamp01((pointerY - box.height / 2 - margin) / Math.max(1, wrapRect.height - box.height - margin * 2))
    : clamp01((pointerX - box.width / 2 - margin) / Math.max(1, wrapRect.width - box.width - margin * 2));
  const dock = { side, ratio };
  positionToolbarNode(preview, dock, wrapRect);
  preview.classList.add('visible');
  App.toolbarPreviewDock = dock;
  return dock;
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
  positionToolbarNode(toolbox, dock, wrapRect);

  if (persist) saveToolbarDock();
}

function initToolbarDock() {
  App.toolbarDock = readToolbarDock();
  applyToolbarDock(false);

  const grip = $('toolbox-grip');
  if (!grip || grip._toolbarDockInit) return;
  grip._toolbarDockInit = true;

  grip.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const toolbox = $('canvas-toolbox');
    const w = $('canvas-wrap');
    if (!toolbox || !w) return;

    const box = toolbox.getBoundingClientRect();
    App.toolbarDragging = {
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      side: App.toolbarDock?.side || 'left'
    };
    App.toolbarPreviewDock = null;
    ensureToolbarPreview();
    toolbox.classList.add('dragging');
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (!App.toolbarDragging) return;
    const toolbox = $('canvas-toolbox');
    const w = $('canvas-wrap');
    if (!toolbox || !w) return;

    const wrapRect = w.getBoundingClientRect();
    const margin = TOOLBAR_MARGIN;
    const left = e.clientX - wrapRect.left - App.toolbarDragging.grabX;
    const top = e.clientY - wrapRect.top - App.toolbarDragging.grabY;
    const pointerX = e.clientX - wrapRect.left;
    const pointerY = e.clientY - wrapRect.top;
    toolbox.style.left = `${left}px`;
    toolbox.style.top = `${top}px`;
    toolbox.style.right = 'auto';
    toolbox.style.bottom = 'auto';
    toolbox.style.transform = 'none';
    toolbox.style.maxWidth = `${Math.max(120, wrapRect.width - margin * 2)}px`;
    toolbox.classList.add('dragging');
    updateToolbarDockPreview(pointerX, pointerY, wrapRect);
  });

  document.addEventListener('mouseup', e => {
    if (!App.toolbarDragging) return;
    const toolbox = $('canvas-toolbox');
    const w = $('canvas-wrap');
    if (!toolbox || !w) {
      App.toolbarDragging = null;
      removeToolbarPreview();
      return;
    }

    const wrapRect = w.getBoundingClientRect();
    const dock = App.toolbarPreviewDock || { side: App.toolbarDock?.side || 'left', ratio: App.toolbarDock?.ratio ?? 0.5 };

    App.toolbarDragging = null;
    App.toolbarDock = dock;
    toolbox.classList.remove('dragging');
    removeToolbarPreview();
    applyToolbarDock(true);
  });

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
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 13 L8 3 L14 13" />
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
  if (handle) handle.classList.add('active');
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
}

function initPanelResizers() {
  const lHandle = $('lpanel-resizer');
  const rHandle = $('rpanel-resizer');
  if (!lHandle || !rHandle || lHandle.dataset.resizeInit === '1') return;

  lHandle.dataset.resizeInit = '1';
  rHandle.dataset.resizeInit = '1';

  lHandle.addEventListener('mousedown', e => startPanelResize('lpanel', e));
  rHandle.addEventListener('mousedown', e => startPanelResize('rpanel', e));

  lHandle.addEventListener('dblclick', () => setPanelWidth('lpanel', PANEL_WIDTH_LIMITS.lpanel.defaultWidth, true));
  rHandle.addEventListener('dblclick', () => setPanelWidth('rpanel', PANEL_WIDTH_LIMITS.rpanel.defaultWidth, true));

  document.addEventListener('mousemove', handlePanelResizeMove);
  document.addEventListener('mouseup', stopPanelResize);
  window.addEventListener('resize', applyStoredPanelWidths);

  applyStoredPanelWidths();
}

function toggleLPanelPin() {
  const s = $('lpanel');
  const unpinned = s.classList.toggle('unpinned');
  const btn = $('lpanel-pin-btn');
  if (btn) btn.title = unpinned ? 'Pin left panel' : 'Unpin left panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-lpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

function toggleRPanelPin() {
  const r = $('rpanel');
  const unpinned = r.classList.toggle('unpinned');
  const btn = $('rpanel-pin-btn');
  if (btn) btn.title = unpinned ? 'Pin right panel' : 'Unpin right panel';
  if (typeof applyToolbarDock === 'function') applyToolbarDock(false);
  try { localStorage.setItem('automata-rpanel-pinned', unpinned ? '0' : '1'); } catch (e) { }
}

function setMobilePanelCollapsed(id, collapsed, persist = true) {
  const panel = $(id);
  if (!panel) return;
  panel.dataset.mobileCollapsed = collapsed ? '1' : '0';
  const toggle = panel.querySelector('.mobile-panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (persist) {
    try { localStorage.setItem(`automata-mobile-panel-${id}`, collapsed ? '1' : '0'); } catch (e) { }
  }
}

function toggleMobilePanel(id, force) {
  const panel = $(id);
  if (!panel) return;
  const collapsed = force === undefined ? panel.dataset.mobileCollapsed !== '1' : !!force;
  setMobilePanelCollapsed(id, collapsed);
}

function initMobilePanels() {
  ['lpanel', 'rpanel', 'algo-nav', 'gram-left', 'theory-nav'].forEach(id => {
    let collapsed = false;
    try { collapsed = localStorage.getItem(`automata-mobile-panel-${id}`) === '1'; } catch (e) { }
    setMobilePanelCollapsed(id, collapsed, false);
  });
}

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

function toggleRPSection(id) {
  const sec = $(id); if (!sec) return;
  const body = sec.querySelector('.rp-section-body');
  const collapsed = sec.classList.toggle('collapsed');
  if (body) body.style.display = collapsed ? 'none' : '';
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

function openSettingsModal() {
  const c = App.config;
  $('set-theme').value = c.theme || 'dark';
  $('set-transducer-accepts').checked = !!c.transducerAccepts;
  $('set-pda-steps').value = c.maxPdaSteps;
  $('set-pda-paradigm').value = c.pdaParadigm || 'explicit';
  $('set-tm-steps').value = c.maxTmSteps;
  $('set-auto-speed').value = c.autoSpeed;
  $('set-radius').value = c.radius;
  $('set-zoom-step').value = c.zoom.step;
  $('set-grid-snap').value = c.gridSnap;
  $('set-node-spacing').value = c.layout.nodeSpacing;
  $('set-curve-off').value = c.render.curveOff;
  $('set-export-res').value = c.exportRes || 2;
  $('set-sym-eps').value = c.sym.eps;
  $('set-sym-any').value = c.sym.any;
  $('set-sym-blank').value = c.sym.blank;
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
  c.transducerAccepts = $('set-transducer-accepts').checked;
  c.pdaParadigm = $('set-pda-paradigm').value || 'explicit';
  c.maxPdaSteps = parseInt($('set-pda-steps').value) || 2000;
  c.maxTmSteps = parseInt($('set-tm-steps').value) || 10000;
  c.autoSpeed = parseInt($('set-auto-speed').value) || 500;
  c.radius = parseInt($('set-radius').value) || 30;
  c.zoom.step = parseFloat($('set-zoom-step').value) || 0.1;
  c.gridSnap = parseInt($('set-grid-snap').value) || 20;
  c.layout.nodeSpacing = parseInt($('set-node-spacing').value) || 35;
  c.render.curveOff = parseInt($('set-curve-off').value) || 45;
  c.exportRes = parseFloat($('set-export-res').value) || 2;
  const oldSyms = { ...c.sym };
  c.sym.eps = $('set-sym-eps').value || oldSyms.eps;
  c.sym.any = $('set-sym-any').value || oldSyms.any;
  c.sym.blank = $('set-sym-blank').value || oldSyms.blank;
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
    pdaParadigm: c.pdaParadigm,
    transducerAccepts: !!c.transducerAccepts,
    maxPdaSteps: c.maxPdaSteps,
    maxTmSteps: c.maxTmSteps,
    autoSpeed: c.autoSpeed,
    radius: c.radius,
    zoomStep: c.zoom.step,
    gridSnap: c.gridSnap,
    layoutNodeSpacing: c.layout.nodeSpacing,
    renderCurveOff: c.render.curveOff,
    exportRes: c.exportRes,
    symEps: c.sym.eps,
    symAny: c.sym.any,
    symBlank: c.sym.blank,
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
  if (data.pdaParadigm !== undefined) $('set-pda-paradigm').value = data.pdaParadigm;
  if (data.transducerAccepts !== undefined) $('set-transducer-accepts').checked = !!data.transducerAccepts;
  if (data.maxPdaSteps !== undefined) $('set-pda-steps').value = data.maxPdaSteps;
  if (data.maxTmSteps !== undefined) $('set-tm-steps').value = data.maxTmSteps;
  if (data.autoSpeed !== undefined) $('set-auto-speed').value = data.autoSpeed;
  if (data.radius !== undefined) $('set-radius').value = data.radius;
  if (data.zoomStep !== undefined) $('set-zoom-step').value = data.zoomStep;
  if (data.gridSnap !== undefined) $('set-grid-snap').value = data.gridSnap;
  if (data.layoutNodeSpacing !== undefined) $('set-node-spacing').value = data.layoutNodeSpacing;
  if (data.renderCurveOff !== undefined) $('set-curve-off').value = data.renderCurveOff;
  if (data.exportRes !== undefined) $('set-export-res').value = data.exportRes;
  if (data.symEps !== undefined) $('set-sym-eps').value = data.symEps;
  if (data.symAny !== undefined) $('set-sym-any').value = data.symAny;
  if (data.symBlank !== undefined) $('set-sym-blank').value = data.symBlank;
  if (data.symZ0 !== undefined) $('set-sym-z0').value = data.symZ0;
}
