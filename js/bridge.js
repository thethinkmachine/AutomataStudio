// ══════════════════════════════════════════════════════════════════
//  INLINE-HANDLER BRIDGE
// ══════════════════════════════════════════════════════════════════
// The UI is driven through on*="..." attributes, which are compiled as
// global-scope code and cannot see module bindings. The functions they name
// are re-exposed on window here.
//
// 214 functions across 21 modules, reached from 482 attributes:
//    357  static, in index.html
//    125  in markup the app builds at runtime (algorithm cards,
//         export dialogs, alphabet chips, context menus)
//
// That second group is the reason this list is longer than a scan of
// index.html suggests. Previously the same coupling existed against every
// top-level name in js/ at once, undeclared; the point of writing it down is
// that it is now bounded and greppable.
//
// It is also the worklist for removing it: move a handler to a delegated
// data-action listener, delete the name here, and the surface shrinks by one.
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
  closeAuxView, hideMoreMenu, setTapeCount, setView, toggleMoreMenu,
  toggleToolsMenu,
} from './view.js';
import {
  addGSym, addOutSym, addSym, delGSym, delOutSym, delSym,
} from './alphabet.js';
import {
  confirmState, confirmTrans, ctxDel, ctxDeleteTrans, ctxDuplicateTrans,
  ctxEditTrans, ctxRename, ctxReverseTrans, ctxStart, ctxToggleAcc,
  deleteTrans, openStateModal,
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
  applyNoteFormat, confirmNote, ctxAddNoteEdge, ctxAddNoteState,
  ctxAnchorNoteToSelection, ctxCanvasAddNote, ctxDeleteNote, ctxDetachNote,
  ctxEditNote, ctxResetNoteSize, ctxSetNoteColor, deleteNoteFromModal,
  insertNoteNewline, setNoteModalColor, updateNoteCharCount,
} from './notes.js';
import {
  confirmDivider, ctxDeleteDivider, ctxEditDivider, ctxSetDividerColor,
  ctxSetDividerStyle, ctxStraightenDivider, deleteDividerFromModal,
  pickShapeTool, setDividerModalColor, setDividerModalStyle,
  showShapeToolMenu,
} from './dividers.js';
import {
  handleRunBtnClick, handleSimInputKeydown, resetSim, runBatch, scrubSim,
  setAutoSpeedPreset, stepBack, stepFwd, stepToEnd, stepToStart,
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
  copyShareableLink, hideSaveMenu, loadExample, loadJSON, onFileLoad,
  saveJSON, saveWorkspace, toggleSaveMenu,
} from './persistence.js';
import {
  exportCodeCopy, exportCodeDownload, exportCopyBatchQuick, exportOpenBatch,
  openExportCodeModal, openExportImageModal, runImageExport,
  selectExportFormat, setExportCodeOpt, setExportImageOpt,
} from './export-ui.js';
import {
  buildNFATree, buildRG2NFA, clearStateHighlights, doThompson,
  highlightDeadStates, loadBuiltNFAResult, loadComplement,
  loadEpsEliminatedNFA, loadMealyAsMoore, loadMinimizedDFA, loadMooreAsMealy,
  loadRG2NFAToCanvas, loadSubsetAsDFA, loadThompsonNFA, loadThompsonNFA_Viz,
  loadUTMExample, minVisStep, renderAlgo, runFullEquivCheck, runNDTMSim,
  runNPDASim, runProductEquiv, runUTMSim, setAlgo, startThompsonViz,
  testEquivStr, thVizStep, utmResetView, utmStepBack, utmStepFwd,
  utmToggleAuto,
} from './algorithms-fa.js';
import {
  cykVisStep, loadCFGPDA, parseRawGrammar, renderCFLPumpVis,
  runAmbiguityCheck, runCFG2PDA, runCFGIsEmpty, runCFGIsFinite, runCNF,
  runCYK, runCYKVisual, runChomskyClassify, runDerivation, runFirstFollow,
  runGNF, runLL1Table, runLeftRecursionRemoval, runPDA2CFG, runParseTree,
  runRightmostDerivation, runUselessElim,
} from './algorithms-cfg.js';
import {
  renderPumpVis, theoryNavClick,
} from './theory.js';
import {
  loadWorkspaceB, openAboutModal, saveWorkspaceB, showHelpModal,
} from './workspace.js';
import {
  clearAll,
} from './utils.js';
import {
  beginRenameTab, closeMobileAuxNav, closeMobilePanels, closeTab,
  commitTabRename, confirmSettings, createTab, exportSettings, filterAlgos,
  filterStates, filterTransitions, fitToScreen, focusStateFromList,
  focusTransFromList, handleCreateTabKeydown, handleTabAddDragOver,
  handleTabAddDrop, handleTabDragEnd, handleTabDragOver, handleTabDragStart,
  handleTabDrop, handleTabKeydown, handleTabRenameKeydown, hlListHover,
  hlTransListHover, importSettings, openSettingsModal, openThemeModal,
  renderTabOverflowMenu, reopenClosedTab, selectTheme, setZoomFromInput,
  showTabContextMenu, switchSettingsTab, switchTab, switchTabFromOverflow,
  tabCtxClose, tabCtxCloseAll, tabCtxCloseOthers, tabCtxCloseRight,
  tabCtxDuplicate, tabCtxRename, toggleFullscreen, toggleLPSection,
  toggleLPanelPin, toggleMinimap, toggleMobilePanel, toggleModelPicker,
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
  // view.js
   closeAuxView, hideMoreMenu, setTapeCount, setView, toggleMoreMenu,
   toggleToolsMenu,
  // alphabet.js
   addGSym, addOutSym, addSym, delGSym, delOutSym, delSym,
  // states-transitions.js
   confirmState, confirmTrans, ctxDel, ctxDeleteTrans, ctxDuplicateTrans,
   ctxEditTrans, ctxRename, ctxReverseTrans, ctxStart, ctxToggleAcc,
   deleteTrans, openStateModal,
  // canvas.js
   autoLayout, ctxCanvasAddState, ctxCanvasAutoLayout, ctxCanvasFit,
   ctxCanvasPaste, ctxCanvasSelectAll, ctxHighlightIncoming,
   ctxHighlightOutgoing, toggleSnapToGrid,
  // render.js
   copyBoxText,
  // notes.js
   applyNoteFormat, confirmNote, ctxAddNoteEdge, ctxAddNoteState,
   ctxAnchorNoteToSelection, ctxCanvasAddNote, ctxDeleteNote, ctxDetachNote,
   ctxEditNote, ctxResetNoteSize, ctxSetNoteColor, deleteNoteFromModal,
   insertNoteNewline, setNoteModalColor, updateNoteCharCount,
  // dividers.js
   confirmDivider, ctxDeleteDivider, ctxEditDivider, ctxSetDividerColor,
   ctxSetDividerStyle, ctxStraightenDivider, deleteDividerFromModal,
   pickShapeTool, setDividerModalColor, setDividerModalStyle,
   showShapeToolMenu,
  // simulation.js
   handleRunBtnClick, handleSimInputKeydown, resetSim, runBatch, scrubSim,
   setAutoSpeedPreset, stepBack, stepFwd, stepToEnd, stepToStart,
  // language.js
   toggleFormalDef,
  // suggest.js
   acceptSuggestion, handleBatchInputKeydown, handleSymSuggestActive,
   handleSymSuggestKeyup, hideSymSuggest, refreshSymSuggest,
   trySymSuggestKeydown,
  // persistence.js
   copyShareableLink, hideSaveMenu, loadExample, loadJSON, onFileLoad,
   saveJSON, saveWorkspace, toggleSaveMenu,
  // export-ui.js
   exportCodeCopy, exportCodeDownload, exportCopyBatchQuick, exportOpenBatch,
   openExportCodeModal, openExportImageModal, runImageExport,
   selectExportFormat, setExportCodeOpt, setExportImageOpt,
  // algorithms-fa.js
   buildNFATree, buildRG2NFA, clearStateHighlights, doThompson,
   highlightDeadStates, loadBuiltNFAResult, loadComplement,
   loadEpsEliminatedNFA, loadMealyAsMoore, loadMinimizedDFA,
   loadMooreAsMealy, loadRG2NFAToCanvas, loadSubsetAsDFA, loadThompsonNFA,
   loadThompsonNFA_Viz, loadUTMExample, minVisStep, renderAlgo,
   runFullEquivCheck, runNDTMSim, runNPDASim, runProductEquiv, runUTMSim,
   setAlgo, startThompsonViz, testEquivStr, thVizStep, utmResetView,
   utmStepBack, utmStepFwd, utmToggleAuto,
  // algorithms-cfg.js
   cykVisStep, loadCFGPDA, parseRawGrammar, renderCFLPumpVis,
   runAmbiguityCheck, runCFG2PDA, runCFGIsEmpty, runCFGIsFinite, runCNF,
   runCYK, runCYKVisual, runChomskyClassify, runDerivation, runFirstFollow,
   runGNF, runLL1Table, runLeftRecursionRemoval, runPDA2CFG, runParseTree,
   runRightmostDerivation, runUselessElim,
  // theory.js
   renderPumpVis, theoryNavClick,
  // workspace.js
   loadWorkspaceB, openAboutModal, saveWorkspaceB, showHelpModal,
  // utils.js
   clearAll,
  // ui.js
   beginRenameTab, closeMobileAuxNav, closeMobilePanels, closeTab,
   commitTabRename, confirmSettings, createTab, exportSettings, filterAlgos,
   filterStates, filterTransitions, fitToScreen, focusStateFromList,
   focusTransFromList, handleCreateTabKeydown, handleTabAddDragOver,
   handleTabAddDrop, handleTabDragEnd, handleTabDragOver, handleTabDragStart,
   handleTabDrop, handleTabKeydown, handleTabRenameKeydown, hlListHover,
   hlTransListHover, importSettings, openSettingsModal, openThemeModal,
   renderTabOverflowMenu, reopenClosedTab, selectTheme, setZoomFromInput,
   showTabContextMenu, switchSettingsTab, switchTab, switchTabFromOverflow,
   tabCtxClose, tabCtxCloseAll, tabCtxCloseOthers, tabCtxCloseRight,
   tabCtxDuplicate, tabCtxRename, toggleFullscreen, toggleLPSection,
   toggleLPanelPin, toggleMinimap, toggleMobilePanel, toggleModelPicker,
   toggleRPSection, toggleRPanelPin, toggleTabOverflowMenu, toggleTool,
   zoomIn, zoomOut,
});
