// ══════════════════════════════════════════════════════════════════
//  DELEGATED ACTIONS — data-action in place of on*="..."
// ══════════════════════════════════════════════════════════════════
// One listener per event type, on <html>, reads the data-action attribute of
// the element an event came from and of each ancestor, and runs the named
// actions from js/core/action-registry.js. Markup names what it wants; the module
// that owns the function says what the name means, beside the function.
//
//     <button data-action="algo.loadSubsetAsDFA">               click
//     <input  data-action="keydown.enter->algo.doThompson">     Enter only
//     <div    data-action="activate->ui.selectModel">           click, Enter or Space
//     <button data-action="lists.deleteRow:stop">               …and stop there
//     <input  data-action="suggest.symbols keydown.enter->…">   a behaviour, then a key
//
// A token is `[event[.key]->]name[:modifier…]`; tokens are separated by
// whitespace and run in the order written. With no event a function action
// runs on click, and a behaviour runs whichever of its handlers the event
// matches. Modifiers: `:prevent` calls preventDefault and `:stop`
// stopPropagation, before the action runs. Arguments are not written into the
// attribute: an action reads the element's own data-* attributes
// (data-op="star"), so the markup carries no code and nothing in it needs
// escaping as JavaScript.
//
// This is for markup that exists only as a string — index.html and the
// templates modules render with innerHTML. A node built with createElement
// is simpler wired at creation with addEventListener, the way reference.js
// and the grammar workbench do it.
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
// ── Events that do not bubble ────────────────────────────────────
// `focus`/`blur` are delivered from focusin/focusout and run only for the
// element that gained or lost focus; `mouseenter`/`mouseleave` from
// mouseover/mouseout, only for an element the pointer crossed into or out of;
// `scroll` from a capture listener, only for the element scrolled. Each means
// what its on* attribute meant.
//
// ── A key already claimed ────────────────────────────────────────
// A keyboard action does not run for a key a handler before it claimed
// (preventDefault): the symbol popover accepting a suggestion with Tab is not
// also a Tab for the field's own action. That is the rule
// `if (trySymSuggestKeydown(event)) return;` spelled out by hand at every
// field that had both.

import { getAction } from './action-registry.js';

// What activates a control that is not natively a button. A <button> already
// turns Enter and Space into a click, so for one of these `activate` is the
// click alone — otherwise a key would run the action twice.
const NATIVELY_ACTIVATED = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const isActivationKey = event => event.key === 'Enter' || event.key === ' ';

const contains = (el, other) => !!other && typeof el.contains === 'function' && el.contains(other);

/**
 * Each event a spec may name: the DOM events that deliver it, and whether it
 * applies at a given element on the way up.
 */
const SPEC_EVENTS = {
  click: {}, dblclick: {}, auxclick: {}, contextmenu: {}, mousedown: {},
  input: {}, change: {}, submit: {},
  keydown: {}, keyup: {},
  dragstart: {}, dragover: {}, dragleave: {}, drop: {}, dragend: {},
  focusin: {}, focusout: {},
  focus: { types: ['focusin'], at: (event, el) => el === event.target },
  blur: { types: ['focusout'], at: (event, el) => el === event.target },
  mouseenter: { types: ['mouseover'], at: (event, el) => !contains(el, event.relatedTarget) },
  mouseleave: { types: ['mouseout'], at: (event, el) => !contains(el, event.relatedTarget) },
  scroll: { capture: true, at: (event, el) => el === event.target },
  activate: {
    types: ['click', 'keydown'],
    at: (event, el) => event.type === 'click'
      || (isActivationKey(event) && !NATIVELY_ACTIVATED.has(el.tagName))
  }
};
for (const [name, spec] of Object.entries(SPEC_EVENTS)) spec.types ||= [name];

/** Event names a spec may use, for the tests that check markup. */
export const SPEC_EVENT_NAMES = Object.freeze(Object.keys(SPEC_EVENTS));

/** The DOM events the dispatcher listens for, and in which phase. */
export const DELEGATED_EVENTS = Object.freeze(Object.values(SPEC_EVENTS).reduce((acc, spec) => {
  for (const type of spec.types) acc[type] ||= !!spec.capture;
  return acc;
}, {}));

const KEY_ALIASES = { esc: 'escape', space: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
const MODIFIERS = new Set(['prevent', 'stop']);

const TOKEN = /^(?:([a-z]+)(?:\.([a-z0-9]+))?->)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)((?::[a-z]+)*)$/i;

const parsed = new Map();

/**
 * Parse a data-action value into its tokens. Throws a SyntaxError naming the
 * token on anything it cannot read, including an event it does not deliver.
 * @param {string} spec
 * @returns {ReadonlyArray<{event: string|null, key: string|null, name: string, prevent: boolean, stop: boolean}>}
 */
export function parseActionSpec(spec) {
  const hit = parsed.get(spec);
  if (hit) return hit;
  const tokens = String(spec).trim().split(/\s+/).filter(Boolean).map(token => {
    const m = TOKEN.exec(token);
    if (!m) throw new SyntaxError(`Unreadable action token "${token}" in data-action="${spec}"`);
    const [, event = null, key = null, name, mods = ''] = m;
    if (event && !(event in SPEC_EVENTS)) {
      throw new SyntaxError(`Unknown event "${event}" in data-action="${spec}"`);
    }
    if (key && event !== 'keydown' && event !== 'keyup') {
      throw new SyntaxError(`A key filter needs keydown or keyup, not "${event}", in data-action="${spec}"`);
    }
    const modifiers = mods.split(':').filter(Boolean);
    for (const mod of modifiers) {
      if (!MODIFIERS.has(mod)) throw new SyntaxError(`Unknown modifier ":${mod}" in data-action="${spec}"`);
    }
    return Object.freeze({
      event,
      key: key && key.toLowerCase(),
      name,
      prevent: modifiers.includes('prevent'),
      stop: modifiers.includes('stop')
    });
  });
  const result = Object.freeze(tokens);
  parsed.set(spec, result);
  return result;
}

/** The spec event names `event` satisfies at `el`. */
function specNamesAt(event, el) {
  const names = [];
  for (const [name, spec] of Object.entries(SPEC_EVENTS)) {
    if (spec.types.includes(event.type) && (!spec.at || spec.at(event, el))) names.push(name);
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
  if (!names.length) return;
  const keyboard = event.type === 'keydown' || event.type === 'keyup';
  for (const token of tokens) {
    const action = getAction(token.name);
    if (!action) {
      reportOnce(`name:${token.name}`, new ReferenceError(`No action named "${token.name}"`));
      continue;
    }
    if (token.key && !keyMatches(event, token.key)) continue;
    const handlers = handlersFor(action, token, names);
    if (!handlers.length) continue;
    if (keyboard && event.defaultPrevented) continue;
    if (token.prevent || (token.event === 'activate' && keyboard)) event.preventDefault();
    if (token.stop) event.stopPropagation();
    for (const handler of handlers) {
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
  const each = fn => Object.entries(DELEGATED_EVENTS).forEach(([type, capture]) => fn(type, capture));
  each((type, capture) => root.addEventListener(type, listener, capture));
  const uninstall = () => {
    each((type, capture) => root.removeEventListener(type, listener, capture));
    installed.delete(root);
  };
  installed.set(root, uninstall);
  return uninstall;
}
