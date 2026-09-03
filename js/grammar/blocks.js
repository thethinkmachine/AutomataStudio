// ══════════════════════════════════════════════════════════════════
//  RESULT BLOCK VOCABULARY
// ══════════════════════════════════════════════════════════════════
//  The same arrangement js/guide-blocks.js has with js/reference.js: this
//  module is the vocabulary and is import-free, and js/grammar-ui.js is the
//  only thing that turns a block into DOM. A block kind added here needs a
//  case in `renderBlock()` there, and that is the single place the two halves
//  have to agree.
//
//  A tool answers with blocks rather than with HTML so that its result can be
//  asserted on without a document. Every one of the old grammar algorithms
//  read `$('gram-output')` and wrote `innerHTML`, which is why not one of them
//  had a test that looked at what it computed rather than at what it printed.

export const p = x => ({ t: 'p', x });
export const note = x => ({ t: 'note', x });
export const warn = x => ({ t: 'note', x, kind: 'warn' });
export const err = x => ({ t: 'note', x, kind: 'err' });

/** The headline answer. `ok` decides the colour, never the wording. */
export const verdict = (ok, title, detail = '') => ({ t: 'verdict', ok, title, detail });

/** A rendered rule set. `g` is a grammar model; `mark` highlights rule ids. */
export const rules = (g, opts = {}) => ({ t: 'rules', g, ...opts });

/** One stage of a construction: what it did, and the grammar it left behind. */
export const steps = list => ({ t: 'steps', list });

/**
 * head: [string]; rows: [[cell]] where a cell is a string or {v, k}.
 *
 * `symbolHead` switches off the header's uppercasing, for a table whose
 * headers *are* symbols — `id` and `ID` are two different terminals, and a
 * header row is not the place to invent one.
 */
export const table = (head, rows, opts = {}) => ({ t: 'table', head, rows, ...opts });

/** Facts worth reading at a glance — the chip strip under a title. */
export const facts = list => ({ t: 'facts', list });

/** A derivation: [{ sentential: [sym], rule, pos }]. */
export const derivation = (list, opts = {}) => ({ t: 'derivation', list, ...opts });

/** A laid-out parse tree from js/grammar/tree.js. */
export const tree = (layout, opts = {}) => ({ t: 'tree', layout, ...opts });

/** The CYK triangle. cells[i][j] is a Set; `word` labels the columns. */
export const cyk = (cells, word, opts = {}) => ({ t: 'cyk', cells, word, ...opts });

/** A titled group, so a long result reads as sections rather than as a wall. */
export const sec = (title, ...blocks) => ({ t: 'sec', title, blocks: blocks.flat() });

/**
 * Buttons the view wires up. `act` names a handler in grammar-ui's action
 * table; `arg` is carried back to it verbatim. A tool never touches the DOM,
 * so this is the only way it can offer "apply this to the editor".
 */
export const actions = list => ({ t: 'actions', list });

/** A step transport over frames the view scrubs through without re-running. */
export const scrub = (frames, opts = {}) => ({ t: 'scrub', frames, ...opts });

/** Two blocks side by side where the comparison is the point. */
export const split = (left, right, opts = {}) => ({ t: 'split', left, right, ...opts });

/**
 * The Overview's property strip: [{ ok, label, detail, tool }]. `ok` is the
 * colour and `tool` is where the chip goes when clicked — a property with
 * nowhere to act on it is a fact the reader has to go and find the tool for.
 */
export const chips = list => ({ t: 'chips', list });

/** Words, as a wrapped field of monospace pills. */
export const words = list => ({ t: 'words', list });

/** The library's cards, from js/grammar/examples.js. */
export const examples = list => ({ t: 'examples', list });
