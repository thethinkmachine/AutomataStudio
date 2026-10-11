// ══════════════════════════════════════════════════════════════════
//  INLINE-HANDLER BRIDGE — being retired
// ══════════════════════════════════════════════════════════════════
// The UI was driven through on*="..." attributes, which are compiled as
// global-scope code and cannot see module bindings. The functions they name
// are re-exposed on window here.
//
// Its replacement is data-action (js/actions.js, js/action-registry.js): the
// markup names an action, and the module that owns the function registers it
// beside the function. New controls use that; nothing new comes here. The
// generated algorithm cards (algorithms-fa.js) have moved, and are where to
// look for the pattern.
//
// So this file is a worklist that only shrinks. tests/actions.test.js holds
// its size to a ceiling, lowered as each batch moves, and lists the files that
// may not grow an inline handler again; issue #141 has the plan. To move a
// handler: give its control a data-action, register the action beside the
// function, delete the name below — and lower the ceiling.
//
// Handlers still reach this file from index.html and from markup built in JS,
// in four shapes: an attribute in a template string, an attribute assembled
// from a function name (chipRemove in alphabet.js, the list rows in
// render.js), setAttribute('onclick', …), and an attribute map ({ onclick: … }
// in ui.js's tab strip). tests/inline-handlers.test.js reads only the first,
// so a name here that looks unused may not be: check all four before deleting
// one that was not just migrated.
//
// Imported by js/main.js before js/init.js so the bridge is in place before
// the boot sequence runs.

import {
  closeModal,
} from './modal.js';
import {
  $, App,
} from './state.js';
import {
  redo, undo,
} from './history.js';
import {
  setBreakScopeFromUI, setRunSubjectFromUI,
} from './run-scope.js';
import {
  closeAuxView, hideMoreMenu, setTapeCount, setView, toggleMoreMenu,
} from './view.js';
import {
  addGSym, addOutSym, addSym, delGSym, delOutSym, delSym,
} from './alphabet.js';
import {
  confirmState, confirmTrans, ctxDel, ctxDeleteTrans, ctxDuplicateTrans,
  ctxEditTrans, ctxRename, ctxResetEdgeShape, ctxReverseTrans, ctxStart,
  ctxToggleAcc, deleteState, deleteTrans, editTransFromList, openStateModal,
} from './states-transitions.js';
import {
  autoLayout, ctxCanvasAddState, ctxCanvasAutoLayout, ctxCanvasFit,
  ctxCanvasPaste, ctxCanvasSelectAll, ctxHighlightIncoming,
  ctxHighlightOutgoing, toggleSnapToGrid,
} from './canvas.js';
import {
  copyBoxText,
} from './render.js';
import {
  ctxDeleteBlock, ctxGroupIntoBlock, ctxOpenBlock, ctxRenameBlock,
  ctxSaveBlockToLibrary, ctxUngroupBlock, openBlockFromList,
} from './blocks-ui.js';
import {
  openSettingsFromQuick, toggleQuickSettings,
} from './quick-settings.js';
import {
  applyNoteFormat, clearNoteFormatting, confirmNote, ctxAddNoteEdge, ctxAddNoteState,
  ctxAnchorNoteToSelection, ctxCanvasAddNote, ctxDeleteNote, ctxDetachNote,
  ctxEditNote, ctxResetNoteSize, ctxSetNoteColor, deleteNoteFromModal,
  handleNoteEditorKeydown, insertNoteNewline, setNoteModalColor, updateNoteEditor,
} from './notes.js';
import {
  confirmDivider, ctxDeleteDivider, ctxEditDivider, ctxSetDividerColor,
  ctxSetDividerStyle, ctxStraightenDivider, deleteDividerFromModal,
  pickShapeTool, setDividerModalColor, setDividerModalStyle,
  showShapeToolMenu,
} from './dividers.js';
import {
  handleRunBtnClick, handleSimInputKeydown, handleTraceScroll, resetSim, revealEarlierTrace, runBatch, scrubSim, stepBack, stepFwd, stepToEnd, stepToStart,
} from './simulation.js';
import {
  toggleFormalDef,
} from './language.js';
import {
  acceptSuggestion, handleBatchInputKeydown, handleSymSuggestActive,
  handleSymSuggestKeyup, hideSymSuggest, refreshSymSuggest,
  trySymSuggestKeydown,
} from './suggest.js';
import {
  copyMachineCode, copyMachineLink, copyShareableLink, ctxCanvasDescribe,
  hideSaveMenu, loadJSON, onFileLoad, saveDocumentAs, saveNow, toggleSaveMenu,
} from './persistence.js';
// The whole StateMate feature adds exactly one name here. Everything else in
// js/statemate-ui.js wires its listeners at creation, the way reference.js
// does — bridge.js is the worklist for removing this seam, not a place to
// grow it.
import {
  openMachineWizard,
} from './wizard-ui.js';
import {
  ctxAddToStateMateContext, ctxAskStateMate, ctxCanvasAskStateMate, openStateMate
} from './statemate-ui.js';
import {
  exportCodeCopy, exportCodeDownload, exportCopyBatchQuick, exportOpenBatch,
  openExportCodeModal, openExportImageModal, runImageExport,
  selectExportFormat, setExportCodeOpt, setExportImageOpt,
} from './export-ui.js';
// algorithms-fa.js names one: setAlgo, from the static list of algorithms in
// index.html. Every control on its generated cards is a data-action now.
import {
  setAlgo,
} from './algorithms-fa.js';
import {
  openAboutModal, showHelpModal,
} from './workspace.js';
import {
  clearAll,
} from './utils.js';
import {
  toggleMinimap,
} from './minimap.js';
import {
  beginRenameTab, closeMobileAuxNav, closeMobilePanels, closeTab,
  commitTabRename, confirmSettings, createTab, ctxCopy, ctxCut, exportSettings, filterAlgos,
  filterStates, filterTransitions, fitToScreen, focusStateFromList,
  focusTransFromList, handleTabAddDragOver,
  handleTabAddDrop, handleTabDragEnd, handleTabDragOver, handleTabDragStart,
  handleTabDrop, handleTabKeydown, handleTabRenameKeydown, hlListHover,
  hlTransListHover, importSettings, openSettingsModal,
  renderTabOverflowMenu, reopenClosedTab, selectModel, toggleThemePicker,
  setZoomFromInput,
  hideTabOverflowMenu,
  showTabContextMenu, switchHelpTab, switchSettingsTab, switchTab, switchTabFromOverflow,
  tabCtxClose, tabCtxCloseAll, tabCtxCloseOthers, tabCtxCloseRight,
  tabCtxDuplicate, tabCtxRename, toggleFullscreen, toggleLPSection,
  toggleLPanelPin, toggleMobilePanel, toggleModelPicker,
  toggleRPSection, toggleRPanelPin, toggleTabOverflowMenu, toggleTool,
  zoomIn, zoomOut,
} from './ui.js';

Object.assign(window, {
  // modal.js
   closeModal,
  // state.js
   $, App,
  // history.js
   redo, undo,
  // run-scope.js
   setBreakScopeFromUI, setRunSubjectFromUI,
  // view.js
   closeAuxView, hideMoreMenu, setTapeCount, setView, toggleMoreMenu,
   // alphabet.js
   addGSym, addOutSym, addSym, delGSym, delOutSym, delSym,
  // states-transitions.js
   confirmState, confirmTrans, ctxDel, ctxDeleteTrans, ctxDuplicateTrans,
   ctxEditTrans, ctxRename, ctxResetEdgeShape, ctxReverseTrans, ctxStart,
   ctxToggleAcc, deleteState, deleteTrans, editTransFromList, openStateModal,
  // canvas.js
   autoLayout, ctxCanvasAddState, ctxCanvasAutoLayout, ctxCanvasFit,
   ctxCanvasPaste, ctxCanvasSelectAll, ctxHighlightIncoming,
   ctxHighlightOutgoing, toggleSnapToGrid,
  // render.js
   copyBoxText,
  // blocks-ui.js
   ctxDeleteBlock, ctxGroupIntoBlock, ctxOpenBlock, ctxRenameBlock,
   ctxSaveBlockToLibrary, ctxUngroupBlock, openBlockFromList,
  // quick-settings.js
   openSettingsFromQuick, toggleQuickSettings,
  // notes.js
   applyNoteFormat, clearNoteFormatting, confirmNote, ctxAddNoteEdge, ctxAddNoteState,
   ctxAnchorNoteToSelection, ctxCanvasAddNote, ctxDeleteNote, ctxDetachNote,
   ctxEditNote, ctxResetNoteSize, ctxSetNoteColor, deleteNoteFromModal,
   handleNoteEditorKeydown, insertNoteNewline, setNoteModalColor, updateNoteEditor,
  // dividers.js
   confirmDivider, ctxDeleteDivider, ctxEditDivider, ctxSetDividerColor,
   ctxSetDividerStyle, ctxStraightenDivider, deleteDividerFromModal,
   pickShapeTool, setDividerModalColor, setDividerModalStyle,
   showShapeToolMenu,
  // simulation.js
   handleRunBtnClick, handleSimInputKeydown, resetSim, runBatch, scrubSim,
   stepBack, stepFwd, stepToEnd, stepToStart,
   handleTraceScroll, revealEarlierTrace,
  // language.js
   toggleFormalDef,
  // suggest.js
   acceptSuggestion, handleBatchInputKeydown, handleSymSuggestActive,
   handleSymSuggestKeyup, hideSymSuggest, refreshSymSuggest,
   trySymSuggestKeydown,
  // persistence.js
   copyMachineCode, copyMachineLink, copyShareableLink, hideSaveMenu,
   loadJSON, onFileLoad, ctxCanvasDescribe, saveDocumentAs, saveNow,
   toggleSaveMenu,
  // wizard-ui.js — the whole wizard, in one name. Everything else inside it
  // is wired at creation, so nothing else needs to be here.
   openMachineWizard,
  // statemate-ui.js
   openStateMate,
  // …plus the three right-click entry points. The header button is no longer
  // the only way in: a diagram you are pointing at is the most common reason
  // to want StateMate, and the menu is where pointing already happens.
   ctxAskStateMate, ctxAddToStateMateContext, ctxCanvasAskStateMate,
  // export-ui.js
   exportCodeCopy, exportCodeDownload, exportCopyBatchQuick, exportOpenBatch,
   openExportCodeModal, openExportImageModal, runImageExport,
   selectExportFormat, setExportCodeOpt, setExportImageOpt,
  // algorithms-fa.js
   setAlgo,
  // js/grammar-ui.js has no entries either: every listener in the grammar
  // workbench is attached at creation, the way reference.js does it.
  // reference.js has no entries: its navigation is generated in JS and its
  // links get their listeners at creation time.
  // workspace.js
   openAboutModal, showHelpModal,
  // utils.js
   clearAll,
  // minimap.js
   toggleMinimap,
  // ui.js
   beginRenameTab, closeMobileAuxNav, closeMobilePanels, closeTab,
   commitTabRename, confirmSettings, createTab, ctxCopy, ctxCut, exportSettings, filterAlgos,
   filterStates, filterTransitions, fitToScreen, focusStateFromList,
   focusTransFromList, handleTabAddDragOver,
   handleTabAddDrop, handleTabDragEnd, handleTabDragOver, handleTabDragStart,
   handleTabDrop, handleTabKeydown, handleTabRenameKeydown, hlListHover,
   hlTransListHover, importSettings, openSettingsModal,
   renderTabOverflowMenu, reopenClosedTab, selectModel, toggleThemePicker,
   setZoomFromInput,
   hideTabOverflowMenu,
   showTabContextMenu, switchHelpTab, switchSettingsTab, switchTab, switchTabFromOverflow,
   tabCtxClose, tabCtxCloseAll, tabCtxCloseOthers, tabCtxCloseRight,
   tabCtxDuplicate, tabCtxRename, toggleFullscreen, toggleLPSection,
   toggleLPanelPin, toggleMobilePanel, toggleModelPicker,
   toggleRPSection, toggleRPanelPin, toggleTabOverflowMenu, toggleTool,
   zoomIn, zoomOut,
});
