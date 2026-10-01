// ══════════════════════════════════════════════════════════════════
//  LIBRARY LINKS THAT ARRIVE BEFORE THE APP IS READY
// ══════════════════════════════════════════════════════════════════
// The desktop app registers the automata-studio:// scheme, so a website's
// "Open in the desktop app" button can launch it. That link reaches the page
// through js/electron-bridge.js, which main.js evaluates first — long before
// the workspaces are restored. Acting on it then would open the machine in a
// tab and have the restore paint over it: the boot gate js/persistence.js has
// for files, for the same reason.
//
// So a link is queued here until the Library says it is ready (at the end of
// the boot, in js/init.js), and handed straight through after that. A leaf, so
// electron-bridge.js can import it without evaluating the Library's UI early.
//
// Import-free.

let handler = null;
const queued = [];

/** A link from outside the page. Handled now, or once the app is ready. */
export function requestLibrary(url) {
  if (handler) return handler(url);
  queued.push(url);
  return null;
}

/** Called once, when the app can act on a link. Flushes what arrived before. */
export function setLibraryRequestHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
  if (!handler) return;
  while (queued.length) {
    try { handler(queued.shift()); } catch (e) { console.error(e); }
  }
}
