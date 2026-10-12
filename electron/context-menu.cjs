'use strict';
// The native right-click menu in the desktop app.
//
// Electron shows no context menu at all unless the shell builds one, so a
// text field in the app had no cut, copy or paste. This builds one for the
// same three places the page allows it (js/ui/context-menu.js) — a text
// field, selected text, a link — and none anywhere else. Where the app has a
// menu of its own the page prevents the event, and Electron does not raise
// `context-menu` at all, so the two never both open.

/**
 * The menu for a right-click, as a template, or [] for none.
 * `params` is Electron's ContextMenuParams; `openExternal` opens a link in
 * the system browser, `copyText` puts text on the clipboard, and
 * `replaceMisspelling` swaps a suggestion in for the misspelled word.
 */
function contextMenuTemplate(params, { openExternal, copyText, replaceMisspelling } = {}) {
  const items = [];
  const flags = params.editFlags || {};

  if (params.isEditable) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
    if (params.misspelledWord) {
      if (suggestions.length) {
        for (const word of suggestions) items.push({ label: word, click: () => replaceMisspelling?.(word) });
      } else {
        items.push({ label: 'No spelling suggestions', enabled: false });
      }
      items.push({ type: 'separator' });
    }
    items.push(
      { role: 'undo', enabled: !!flags.canUndo },
      { role: 'redo', enabled: !!flags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: !!flags.canCut },
      { role: 'copy', enabled: !!flags.canCopy },
      { role: 'paste', enabled: !!flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: flags.canSelectAll !== false }
    );
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ role: 'copy' });
  }

  if (params.linkURL && /^(https?|mailto):/i.test(params.linkURL)) {
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: 'Open Link in Browser', click: () => openExternal?.(params.linkURL) },
      { label: 'Copy Link Address', click: () => copyText?.(params.linkURL) }
    );
  }
  return items;
}

/** Show the menu on every right-click the page let through. */
function attachContextMenu(webContents, { Menu, shell, clipboard }) {
  webContents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params, {
      openExternal: url => shell.openExternal(url),
      copyText: text => clipboard.writeText(text),
      replaceMisspelling: word => webContents.replaceMisspelling(word)
    });
    if (template.length) Menu.buildFromTemplate(template).popup();
  });
}

module.exports = { contextMenuTemplate, attachContextMenu };
