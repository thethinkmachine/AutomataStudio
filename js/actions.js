// ══════════════════════════════════════════════════════════════════
//  DELEGATED ACTIONS — data-action in place of on*="..."
// ══════════════════════════════════════════════════════════════════
// One listener per event type, on <html>, reads the data-action attribute of
// the element an event came from and of each ancestor, and runs the named
// actions from js/action-registry.js. Markup names what it wants; the module
// that owns the function says what the name means, beside the function.
//
//     <button data-action="algo.loadSubsetAsDFA">              click
//     <input  data-action="keydown.enter->algo.doThompson">    Enter only
//     <input  data-action="suggest.symbols keydown.enter->…">  a behaviour, then a key
//
// A token is `[event[.key]->]name`, tokens are separated by whitespace and run
// in the order written. With no event a function action runs on click, and a
// behaviour runs whichever of its handlers the event matches. Arguments are not
// written into the attribute: an action reads the element's own data-*
// attributes (data-op="star"), so the markup carries no code and nothing in it
// needs escaping as JavaScript.
//
// ── Why <html>, in the bubble phase ──────────────────────────────
// An inline handler ran at its element, before any listener on document. Code
// leans on that order: view.js closes the aux window on Escape unless
// something already claimed the key (`e.defaultPrevented`), and the symbol
// popover claims it from its own keydown handler; ui.js and view.js close
// their menus from document click listeners, after the click that opened one.
// <html> is the last node before document on the way up, so listening there,
// bubbling, keeps every action ahead of every document listener, as before,
// and behind any listener on the element itself.
//
// ── Two departures from inline handlers, both deliberate ─────────
// `focus` and `blur` do not bubble, so they are delivered from focusin and
// focusout and run only for the element that gained or lost focus — a
// container asking for `focus->x` is not told when a field inside it is
// focused, which is what onfocus meant. And a keyboard action does not run
// for a key that has already been claimed (preventDefault): the symbol
// popover accepting a suggestion with Tab is not also a Tab for the field's
// own action. That is the rule `if (trySymSuggestKeydown(event)) return;`
// spelled out by hand at every field that had both.

import { getAction } from './action-registry.js';

// Spec event → the DOM event that delivers it, and whether it is only for the
// element the event happened to.
const SPEC_EVENTS = {
  click: 'click', dblclick: 'dblclick', contextmenu: 'contextmenu',
  input: 'input', change: 'change', submit: 'submit',
  keydown: 'keydown', keyup: 'keyup',
  dragover: 'dragover', drop: 'drop',
  focusin: 'focusin', focusout: 'focusout',
  focus: 'focusin', blur: 'focusout'
};
const TARGET_ONLY = { focus: 'focusin', blur: 'focusout' };
const KEYBOARD = new Set(['keydown', 'keyup']);

/** The DOM events the dispatcher listens for. */
export const DELEGATED_EVENTS = Object.freeze([...new Set(Object.values(SPEC_EVENTS))]);

/** Event names a spec may use, for the tests that check markup. */
export const SPEC_EVENT_NAMES = Object.freeze(Object.keys(SPEC_EVENTS));

const KEY_ALIASES = { esc: 'escape', space: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };

const TOKEN = /^(?:([a-z]+)(?:\.([a-z0-9]+))?->)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/i;

const parsed = new Map();

/**
 * Parse a data-action value into its tokens. Throws a SyntaxError naming the
 * token on anything it cannot read, including an event it does not deliver.
 * @param {string} spec
 * @returns {ReadonlyArray<{event: string|null, key: string|null, name: string}>}
 */
export function parseActionSpec(spec) {
  const hit = parsed.get(spec);
  if (hit) return hit;
  const tokens = String(spec).trim().split(/\s+/).filter(Boolean).map(token => {
    const m = TOKEN.exec(token);
    if (!m) throw new SyntaxError(`Unreadable action token "${token}" in data-action="${spec}"`);
    const [, event = null, key = null, name] = m;
    if (event && !(event in SPEC_EVENTS)) {
      throw new SyntaxError(`Unknown event "${event}" in data-action="${spec}"`);
    }
    if (key && !KEYBOARD.has(event)) {
      throw new SyntaxError(`A key filter needs keydown or keyup, not "${event}", in data-action="${spec}"`);
    }
    return Object.freeze({ event, key: key && key.toLowerCase(), name });
  });
  const result = Object.freeze(tokens);
  parsed.set(spec, result);
  return result;
}

/**
 * The spec event names `event` satisfies at `el`: its own type, plus focus or
 * blur when `el` is the element whose focus changed.
 */
function specNamesAt(event, el) {
  const names = [event.type];
  for (const [name, type] of Object.entries(TARGET_ONLY)) {
    if (event.type === type && el === event.target) names.push(name);
  }
  return names;
}

function handlersFor(action, token, names) {
  if (typeof action === 'function') {
    return names.includes(token.event || 'click') ? [action] : [];
  }
  const wanted = token.event ? [token.event] : Object.keys(action);
  return wanted.filter(name => names.includes(name) && action[name]).map(name => action[name]);
}

function keyMatches(event, key) {
  return String(event.key).toLowerCase() === (KEY_ALIASES[key] || key);
}

const reported = new Set();

function report(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

function reportOnce(key, error) {
  if (reported.has(key)) return;
  reported.add(key);
  report(error);
}

function propagationStopped(event) {
  return event.cancelBubble === true || event.propagationStopped === true;
}

function runSpec(spec, el, event) {
  let tokens;
  try {
    tokens = parseActionSpec(spec);
  } catch (error) {
    reportOnce(`spec:${spec}`, error);
    return;
  }
  const names = specNamesAt(event, el);
  for (const token of tokens) {
    const action = getAction(token.name);
    if (!action) {
      reportOnce(`name:${token.name}`, new ReferenceError(`No action named "${token.name}"`));
      continue;
    }
    if (token.key && !keyMatches(event, token.key)) continue;
    if (KEYBOARD.has(event.type) && event.defaultPrevented) continue;
    for (const handler of handlersFor(action, token, names)) {
      // One action failing is reported, not propagated: the next token and the
      // ancestors' actions run regardless, the way separate inline handlers did.
      try {
        handler({ el, event });
      } catch (error) {
        report(error);
      }
    }
  }
}

/**
 * Run the actions `event` reaches, from its target up to and including `root`.
 * An action that stops propagation stops the walk at its element.
 */
export function dispatchActions(event, root) {
  for (let el = event.target; el; el = el.parentNode) {
    const spec = typeof el.getAttribute === 'function' ? el.getAttribute('data-action') : null;
    if (spec) runSpec(spec, el, event);
    if (el === root || propagationStopped(event)) return;
  }
}

const installed = new Map();

/**
 * Start delivering actions under `root` (by default the whole page). Safe to
 * call twice; returns the function that stops it.
 */
export function installActions(root = document.documentElement) {
  if (installed.has(root)) return installed.get(root);
  const listener = event => dispatchActions(event, root);
  for (const type of DELEGATED_EVENTS) root.addEventListener(type, listener);
  const uninstall = () => {
    for (const type of DELEGATED_EVENTS) root.removeEventListener(type, listener);
    installed.delete(root);
  };
  installed.set(root, uninstall);
  return uninstall;
}
