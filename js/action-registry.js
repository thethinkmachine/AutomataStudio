// ══════════════════════════════════════════════════════════════════
//  ACTION REGISTRY
// ══════════════════════════════════════════════════════════════════
// The named things markup can ask for. An element says what it wants with
// data-action="algo.loadSubsetAsDFA"; js/actions.js reads the attribute when
// the event arrives and looks the name up here. It replaced on*="..."
// attributes, which could only reach functions put on window — see "Wiring
// controls" in CLAUDE.md.
//
// Import-free for the reason js/modal-registry.js is: modules call
// defineActions() at module scope, beside the functions they wire up, and a
// hoisted function reached across an import cycle can see a `const` only if
// the module holding it has already been evaluated. A leaf always has.
//
// An action is one of two shapes:
//
//   function     ({ el, event }) => …       runs for the event its token names
//                                           (click when the token names none)
//   behaviour    { keydown: fn, focus: fn,  one name for a set of listeners an
//                  blur: fn, … }            element needs together; a bare
//                                           token runs whichever matches
//
// `el` is the element carrying the attribute — what `this` was in an inline
// handler — and `event` the DOM event. Handlers take that context object and
// nothing else, so a function with optional parameters is always wrapped:
// registering `loadBuiltNFAResult` directly would hand it the context as its
// first argument, which it would take for an operation name.

const actions = new Map();

/**
 * Register named actions. A name may be defined once: two modules claiming
 * the same name would leave which one a button runs to module order.
 * @param {Record<string, Function | Record<string, Function>>} table
 */
export function defineActions(table) {
  for (const [name, action] of Object.entries(table)) {
    if (actions.has(name)) throw new Error(`Action "${name}" is already defined`);
    if (!isValidAction(action)) {
      throw new TypeError(`Action "${name}" must be a function or an object of event handlers`);
    }
    actions.set(name, action);
  }
}

function isValidAction(action) {
  if (typeof action === 'function') return true;
  if (!action || typeof action !== 'object') return false;
  const handlers = Object.values(action);
  return handlers.length > 0 && handlers.every(fn => typeof fn === 'function');
}

/** The action registered under `name`, or undefined. */
export function getAction(name) {
  return actions.get(name);
}

/** Every registered name, for the tests that check markup against them. */
export function actionNames() {
  return [...actions.keys()];
}
