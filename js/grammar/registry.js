// ══════════════════════════════════════════════════════════════════
//  GRAMMAR TOOL REGISTRY
// ══════════════════════════════════════════════════════════════════
//  Import-free, for the reason js/machines/registry.js is: the tool modules
//  call `defineTool` at module scope, and a shared mutable container written
//  from several modules at module scope has to sit in a leaf or the const it
//  closes over is unreachable across an import cycle.
//
//  A tool is a declaration, never a button plus a function that writes HTML.
//  `run` is handed the grammar model and the view's inputs and answers with
//  blocks (js/grammar/blocks.js) — so every algorithm in the workbench is
//  testable with no DOM, which is the property the old grammar view did not
//  have anywhere.

/** Groups, in navigation order. Declaration order is what the rail shows. */
export const ToolGroups = [];
/** id -> definition. */
export const Tools = new Map();

export function defineGroup(id, label, hint = '') {
  if (ToolGroups.some(g => g.id === id)) return;
  ToolGroups.push({ id, label, hint });
}

/**
 * @param {object} def
 *   id       stable slug; the nav link, the hash and the test handle
 *   group    a group id declared with defineGroup
 *   label    what the rail says
 *   blurb    one line under the result title
 *   needs    { word?, machine?, rules? } — preconditions the view states
 *            before running, so a tool never has to describe an empty canvas
 *   inputs   [{ id, label, placeholder, kind }] fields the tool reads
 *   run      (ctx) => { title?, blocks: [] }
 */
export function defineTool(def) {
  if (!def || !def.id) throw new Error('a grammar tool needs an id');
  if (Tools.has(def.id)) throw new Error(`duplicate grammar tool: ${def.id}`);
  Tools.set(def.id, {
    needs: {}, inputs: [], blurb: '', ...def
  });
}

export function grammarTool(id) {
  return Tools.get(id) || null;
}

/** Every tool, grouped, in declaration order — what the nav is built from. */
export function grammarToolNav() {
  return ToolGroups.map(g => ({
    ...g,
    tools: [...Tools.values()].filter(t => t.group === g.id)
  })).filter(g => g.tools.length);
}

/** The first tool of the first group — where the view opens. */
export function defaultToolId() {
  const nav = grammarToolNav();
  return nav.length && nav[0].tools.length ? nav[0].tools[0].id : null;
}
