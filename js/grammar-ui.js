import { $, App } from './state.js';
import { Change, emit, subscribe } from './store.js';
import { commit, snapshot } from './history.js';
import { saveBackup } from './persistence.js';
import { inFamily } from './machines/registry.js';
import { isCfgConvertiblePDA, showStatus } from './utils.js';
import { applyMachineSwitch, setView } from './view.js';
import { autoFitLoadedMachine, fitToScreen } from './ui.js';
import { triggerMath } from './reference.js';
import {
  GRAMMAR_STRING_FIELD_IDS, handleSymSuggestActive, handleSymSuggestKeyup,
  hideSymSuggest, refreshSymSuggest, trySymSuggestKeydown
} from './suggest.js';

import { grammarExample } from './grammar/examples.js';
import {
  eps, grammarFromText, grammarText, grammarTerminals, isContextFree,
  readGrammar, terminalsOf, tokenizeWord, writeGrammar
} from './grammar/model.js';
import { defaultToolId, grammarTool, grammarToolNav } from './grammar/registry.js';
import './grammar/tools.js';

// ══════════════════════════════════════════════════════════════════
//  THE GRAMMAR WORKBENCH
// ══════════════════════════════════════════════════════════════════
//  The only DOM-bound module of the grammar layer, and the only one that may
//  reach for `$`, `App` or a renderer. Everything under js/grammar/ answers
//  with a model or with blocks; this turns blocks into nodes.
//
//  **Nothing here is reached from an `on*` attribute.** Listeners are attached
//  at creation, the way js/reference.js and js/machine-card.js do it, so the
//  whole view adds exactly one name to js/bridge.js — where the old grammar
//  view had twenty, one per button in its rail. That rail is what this
//  replaces: eighteen buttons in four loose groups, each blowing away one
//  output div with a string of HTML.
//
//  The shape is nav + content, which is what the Algorithms and Reference
//  views already are. What is new is that the *grammar* rides at the top of
//  the content pane rather than in the rail: a result is only readable beside
//  the rules that produced it, and the editor collapses to a summary strip
//  when a CYK table or a parse tree wants the room.

const ACTIVE_KEY = 'automata-grammar-tool';

let activeTool = null;
let editorMode = 'source';
let editorOpen = true;
let built = false;
let syncing = false;
const inputs = { word: '', words: '' };
/** Per-render scrubber positions, keyed by the block's index in the result. */
const scrubAt = new Map();

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

// ── Which tool is open ────────────────────────────────────────────
//  Kept in localStorage rather than in App.config, which is deep-copied into
//  every workspace tab and written to IndexedDB — a reader's choice of tool is
//  not part of anyone's document, and storing it there would travel to the
//  next person who opens the file.

function storedTool() {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    return id && grammarTool(id) ? id : null;
  } catch { return null; }
}

function rememberTool(id) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
}

// ══════════════════════════════════════════════════════════════════
//  BUILD
// ══════════════════════════════════════════════════════════════════
//  Built once and kept. The marker sits on the container rather than in a
//  module variable, so a torn-down DOM — the test harness resets one between
//  cases — rebuilds itself instead of rendering into nothing.

function build() {
  const nav = $('gram-nav-list');
  const editor = $('gram-editor');
  if (!nav || !editor) return false;
  if (editor.dataset.gramBuilt === '1') { built = true; return true; }

  // ── the rail ───────────────────────────────────────────────────
  nav.innerHTML = grammarToolNav().map(group => `
<div class="gram-nav-group">${esc(group.label)}</div>
${group.tools.map(t => `<a class="gram-nav-link" href="#" data-tool="${esc(t.id)}"
  ><span class="gram-nav-label">${esc(t.label)}</span></a>`).join('')}`).join('');

  nav.addEventListener('click', e => {
    const link = e.target.closest('.gram-nav-link');
    if (!link) return;
    e.preventDefault();
    openTool(link.dataset.tool);
  });

  // ── the editor ─────────────────────────────────────────────────
  editor.innerHTML = `
<div class="gram-ed-bar">
  <span class="gram-ed-title">Grammar</span>
  <div class="gram-seg" role="group" aria-label="Editor view">
    <button type="button" class="gram-seg-btn" data-mode="source">Source</button>
    <button type="button" class="gram-seg-btn" data-mode="rules">Rules</button>
  </div>
  <div class="gram-ed-acts">
    <button type="button" class="gram-ed-btn" data-act="examples">Library</button>
    <button type="button" class="gram-ed-btn" data-act="format" data-tip="Rewrite the source in canonical form">Format</button>
    <button type="button" class="gram-ed-btn" data-act="copy">Copy</button>
    <button type="button" class="gram-ed-btn gram-ed-danger" data-act="clear">Clear</button>
    <button type="button" class="gram-ed-fold" data-act="fold" aria-expanded="true"
      aria-label="Collapse the grammar"><svg viewBox="0 0 256 256" fill="currentColor"
      aria-hidden="true"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg></button>
  </div>
</div>
<div class="gram-ed-body">
  <textarea id="gram-source" class="gram-source" spellcheck="false" autocomplete="off"
    aria-label="Grammar rules, one per line"
    placeholder="S &#8594; a S b | &#949;"></textarea>
  <div class="gram-rules" id="gram-rules"></div>
</div>
<div class="gram-diag" id="gram-diag"></div>
<div class="gram-ed-foot">
  <label class="gram-start">Start
    <select id="gram-start" class="gram-start-sel" aria-label="Start symbol"></select>
  </label>
  <span class="gram-foot-fact" id="gram-fact-v"></span>
  <span class="gram-foot-fact" id="gram-fact-s"></span>
  <span class="gram-foot-fact" id="gram-fact-r"></span>
</div>`;

  const src = $('gram-source');
  src.addEventListener('input', onSourceInput);
  src.addEventListener('keydown', e => {
    // A tab in a grammar is whitespace, and whitespace separates symbols — so
    // it has a meaning here and must not walk the focus out of the field.
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const at = src.selectionStart;
    src.value = src.value.slice(0, at) + '  ' + src.value.slice(src.selectionEnd);
    src.selectionStart = src.selectionEnd = at + 2;
    onSourceInput();
  });

  editor.addEventListener('click', e => {
    const seg = e.target.closest('.gram-seg-btn');
    if (seg) { setEditorMode(seg.dataset.mode); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    editorAction(btn.dataset.act);
  });

  $('gram-start').addEventListener('change', e => {
    if (!e.target.value || e.target.value === readGrammar().start) return;
    // Emitting is what redraws; the subscriber below is the only renderer.
    commitGrammar(() => { App.grammar.start = e.target.value; });
  });

  editor.dataset.gramBuilt = '1';
  built = true;
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  THE EDITOR
// ══════════════════════════════════════════════════════════════════

/**
 * The textarea is the source of truth while it is being typed into, and the
 * model is rebuilt from it on every keystroke — which is cheap, and is what
 * makes the Rules view, the diagnostics strip and the tuple in the footer
 * describe *this* keystroke rather than the last committed one.
 *
 * The *undo point* is not per keystroke, and that is the whole of what
 * `commitTyping` is for. An entry on `App.history` is the entire workspace as
 * JSON, so a `commit()` per character both stringified the machine on every
 * keypress and buried the reader's last canvas edit sixty presses deep — and
 * on a large machine the byte cap then evicted it outright. A run of
 * keystrokes is one edit, which is what every text editor means by one undo.
 */
const TYPING_RUN_MS = 900;
let typingRun = null;

/**
 * The run is ended by *anything else* touching the stack, not only by the
 * clock: `App.history.length` moving means an undo, a redo or an edit landed
 * between two keystrokes, and coalescing across one of those would fold two
 * different edits into a single entry.
 */
function commitTyping(grammar) {
  const now = Date.now();
  const sameRun = typingRun
    && now - typingRun.at < TYPING_RUN_MS
    && App.history.length === typingRun.depth;
  if (!sameRun) snapshot();
  writeGrammar(grammar);
  typingRun = { at: now, depth: App.history.length };
  emit(Change.GRAMMAR);
}

/** Every write that is not a keystroke: its own undo point, and it ends the
 *  run so the next keystroke cannot be folded into it. */
function commitGrammar(edit) {
  typingRun = null;
  commit(edit, Change.GRAMMAR);
}

function onSourceInput() {
  if (syncing) return;
  const { grammar } = grammarFromText($('gram-source').value);
  commitTyping(grammar);
}

/**
 * The same rules, whatever the start symbol or the order. Compared on the
 * tokens rather than on the canonical text, because the text is grouped by
 * left-hand side and ordered start-first, so changing the start symbol alone
 * would rewrite it and be read as "the field is stale".
 */
function sameRules(a, b) {
  const key = g => g.rules.map(r => `${r.lhsArr.join(' ')}>${r.rhsArr.join(' ')}`).sort().join(';');
  return key(a) === key(b);
}

function setEditorMode(mode) {
  editorMode = mode === 'rules' ? 'rules' : 'source';
  render();
}

function editorAction(act) {
  if (act === 'fold') { editorOpen = !editorOpen; render(); return; }
  if (act === 'examples') { openTool('examples'); return; }
  if (act === 'format') {
    const g = readGrammar();
    if (!g.rules.length) return;
    setSource(grammarText(g));
    showStatus('Grammar reformatted');
    return;
  }
  if (act === 'copy') {
    const text = grammarText(readGrammar());
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => showStatus('Grammar copied'))
      .catch(() => showStatus('Could not reach the clipboard'));
    return;
  }
  if (act === 'clear') {
    if (!readGrammar().rules.length) return;
    setSource('');
    showStatus('Grammar cleared');
  }
}

/**
 * Writes the source and everything derived from it, in one undo step.
 *
 * The field is written *before* the commit, deliberately: the commit emits,
 * the emit renders, and a render that ran while the field still held the old
 * text would either overwrite the new grammar or paint the old one — the two
 * halves of the same off-by-one.
 */
function setSource(text) {
  const src = $('gram-source');
  if (src) {
    syncing = true;
    src.value = text;
    syncing = false;
  }
  const { grammar } = grammarFromText(text);
  commitGrammar(() => writeGrammar(grammar));
}

function syncEditor(g, diagnostics, fieldAgrees) {
  const src = $('gram-source');
  if (!src) return;
  // The field is only overwritten when it no longer describes the grammar the
  // workspace holds — a load, an undo, an Apply. Overwriting it whenever the
  // two are not *textually* identical would erase a malformed line the moment
  // the reader clicked away, and would take the caret to the end on every
  // keystroke besides.
  if (!fieldAgrees) {
    syncing = true;
    src.value = grammarText(g);
    syncing = false;
  }

  const editor = $('gram-editor');
  editor.classList.toggle('is-folded', !editorOpen);
  editor.classList.toggle('mode-rules', editorMode === 'rules');
  editor.querySelectorAll('.gram-seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === editorMode));
  const fold = editor.querySelector('.gram-ed-fold');
  if (fold) {
    fold.setAttribute('aria-expanded', String(editorOpen));
    fold.setAttribute('aria-label', editorOpen ? 'Collapse the grammar' : 'Expand the grammar');
  }

  $('gram-rules').innerHTML = g.rules.length
    ? rulesHtml(g)
    : '<div class="gram-empty">No rules yet.</div>';

  const start = $('gram-start');
  const options = [...g.vars];
  start.innerHTML = options.length
    ? options.map(v => `<option value="${esc(v)}"${v === g.start ? ' selected' : ''}>${esc(v)}</option>`).join('')
    : '<option value="">—</option>';
  start.disabled = !options.length;

  const terms = terminalsOf(g);
  $('gram-fact-v').innerHTML = `V <b>${g.vars.size}</b>`;
  $('gram-fact-s').innerHTML = `Σ <b>${terms.size}</b>`;
  $('gram-fact-r').innerHTML = `R <b>${g.rules.length}</b>`;

  const diag = $('gram-diag');
  const errors = diagnostics.filter(d => d.kind === 'error');
  const warns = diagnostics.filter(d => d.kind === 'warn');
  const infos = diagnostics.filter(d => d.kind === 'info');
  diag.innerHTML = diagnostics.length
    ? [...errors, ...warns, ...infos].slice(0, 8).map(d => `
<div class="gram-diag-row is-${d.kind}">
  ${d.line ? `<span class="gram-diag-line">line ${d.line}</span>` : '<span class="gram-diag-line">note</span>'}
  <span class="gram-diag-msg">${d.msg}</span>
</div>`).join('')
    : '';
  diag.classList.toggle('is-empty', !diagnostics.length);
  editor.classList.toggle('has-errors', errors.length > 0);
}

/** The parsed grammar, coloured — which is the point: it is what was read. */
function rulesHtml(g) {
  const sym = s => {
    if (g.vars.has(s)) return `<span class="gsym gsym-v">${esc(s)}</span>`;
    return `<span class="gsym gsym-t">${esc(s)}</span>`;
  };
  const groups = new Map();
  const order = [];
  g.rules.forEach(r => {
    if (!groups.has(r.lhs)) { groups.set(r.lhs, []); order.push(r.lhs); }
    groups.get(r.lhs).push(r);
  });
  const keys = [...order.filter(k => k === g.start), ...order.filter(k => k !== g.start)];
  return keys.map(k => {
    const lhs = k.split(' ').map(sym).join(' ');
    const alts = groups.get(k).map(r => (r.rhsArr.length
      ? r.rhsArr.map(sym).join(' ')
      : `<span class="gsym gsym-e">${esc(eps())}</span>`)).join('<span class="gbar">|</span>');
    return `<div class="grule">${k === g.start ? '<span class="gstart" title="start symbol">▸</span>' : '<span class="gstart"></span>'}${lhs}<span class="garr">→</span>${alts}</div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
//  THE RESULT
// ══════════════════════════════════════════════════════════════════

export function openTool(id) {
  if (!grammarTool(id)) return;
  activeTool = id;
  rememberTool(id);
  scrubAt.clear();
  render();
  const pane = $('gram-result');
  if (pane && pane.scrollTo) pane.scrollTo({ top: 0, behavior: 'smooth' });
}

/** What a tool needs before it can say anything, and what to say instead. */
function unmet(tool, g, word) {
  const n = tool.needs || {};
  if (n.rules && !g.rules.length) {
    return {
      msg: 'This tool needs a grammar. Write one in the editor above, or load one from the library.',
      action: { act: 'openTool', label: 'Open the library', kind: 'primary', arg: 'examples' }
    };
  }
  if (n.contextFree && !isContextFree(g)) {
    return {
      msg: 'This tool is defined for context-free grammars, and some rule here has more than one symbol on its left. Every construction below the Chomsky hierarchy’s Type 2 line assumes a single variable there.',
      action: { act: 'openTool', label: 'See the classification', kind: 'primary', arg: 'classify' }
    };
  }
  if (n.machine === 'pda' && !isCfgConvertiblePDA(App.machine)) {
    return { msg: `This construction reads the pushdown automaton on the canvas, and the canvas currently holds a ${App.machine}. Switch the model to DPDA or NPDA to use it.` };
  }
  if (n.machine === 'fa' && !inFamily(App.machine, 'finite')) {
    return { msg: `This construction reads the finite automaton on the canvas, and the canvas currently holds a ${App.machine}. Switch the model to DFA, NFA or ε-NFA to use it.` };
  }
  // `tokenizeWord` refuses a word it cannot read rather than splitting it into
  // characters, which is what lets this say *which* symbol was unknown. Said
  // here rather than in each tool, because a tool that reads `word.tokens`
  // without checking gets an internal error where the reader typed one letter
  // too many — the state a half-typed word is in on every keystroke.
  if (n.word && word && !word.ok) {
    return {
      msg: `“${word.error}” is not a symbol this grammar uses. A word here is read over Σ(G) — everything a right-hand side mentions that no rule defines — together with the canvas’s own Σ.`,
      action: { act: 'openTool', label: 'See Σ(G)', kind: 'primary', arg: 'symbols' }
    };
  }
  return null;
}

function render() {
  if (!build()) return;
  const g = readGrammar();
  const { grammar: fromField, diagnostics } = grammarFromText($('gram-source')?.value ?? '');

  // **The field is authoritative for the diagnostics, and the model for
  // everything else.** They describe the same grammar on every keystroke path,
  // because `onSourceInput` writes what the field parsed to; they differ only
  // when something else wrote the grammar. Deciding this on `document.
  // activeElement` instead — which is the obvious way — meant a malformed line
  // stopped being reported the instant the field lost focus, and was then
  // overwritten by the canonical text on the next render.
  const fieldAgrees = sameRules(fromField, g);
  syncEditor(g, fieldAgrees ? diagnostics : [], fieldAgrees);

  if (!activeTool || !grammarTool(activeTool)) activeTool = storedTool() || defaultToolId();
  document.querySelectorAll('#gram-nav-list .gram-nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.tool === activeTool));

  const tool = grammarTool(activeTool);
  const pane = $('gram-result');
  if (!tool || !pane) return;
  const body = paneBody(pane, tool);

  const word = tokenizeWord(inputs.word, g);
  const block = unmet(tool, g, word);
  if (block) {
    const stub = el('div', 'gram-stub');
    stub.appendChild(el('p', null, block.msg));
    if (block.action) stub.appendChild(renderBlock({ t: 'actions', list: [block.action] }));
    body.appendChild(stub);
    return;
  }

  let result;
  try {
    result = tool.run({
      g,
      word,
      inputs: { ...inputs },
      tokenize: raw => tokenizeWord(raw, g)
    });
  } catch (err) {
    console.error('grammar tool threw', err);
    body.appendChild(el('div', 'gram-note is-err',
      `This tool could not finish: <code>${esc(err && err.message)}</code>. The grammar in the editor is untouched.`));
    return;
  }

  (result.blocks || []).forEach((b, i) => {
    const node = renderBlock(b, i);
    if (node) body.appendChild(node);
  });
  triggerMath(body);
}

/**
 * The pane's frame — the title and the tool's own fields — is built once per
 * *tool*, and only the part below it is replaced on a re-render. **A render
 * runs on every keystroke, including the keystrokes going into those fields**,
 * and an `innerHTML` write on the pane removes the focused field from the
 * document, which takes the focus and the caret with it: the word fields
 * accepted exactly one character each and then went dead. Rebuilding only the
 * result is also what lets the symbol-suggest popover stay anchored to a field
 * that is still the same element it was attached to.
 *
 * `resBody.parentNode` is the validity test rather than a module flag, because
 * the document can be replaced underneath this — the test harness tears one
 * down between cases, and `openTool` must rebuild after `setView` has run.
 */
let resBody = null;
let paneTool = null;

function paneBody(pane, tool) {
  if (paneTool !== tool.id || !resBody || resBody.parentNode !== pane) {
    pane.innerHTML = '';
    pane.appendChild(el('div', 'gram-res-head', `
<h3 class="gram-res-title">${esc(tool.label)}</h3>
<p class="gram-res-sub">${esc(tool.blurb)}</p>`));
    if (tool.inputs.length) pane.appendChild(inputRow(tool));
    resBody = el('div', 'gram-res-body');
    pane.appendChild(resBody);
    paneTool = tool.id;
  } else {
    // A reused frame keeps the fields it has, so anything that wrote `inputs`
    // from elsewhere — a word pill, a loaded example — has to reach them. The
    // guard is what makes that safe during typing: the keystroke handler
    // writes `inputs` before it renders, so the two already agree and nothing
    // is written back over the caret.
    resFields.forEach((node, id) => {
      const want = inputs[id] || '';
      if (node.value !== want) node.value = want;
    });
  }
  resBody.innerHTML = '';
  return resBody;
}

/** The live field nodes of the frame currently in the pane, by input id. */
const resFields = new Map();

function inputRow(tool) {
  const row = el('div', 'gram-inputs');
  resFields.clear();
  tool.inputs.forEach(field => {
    const wrap = el('label', 'gram-input');
    wrap.appendChild(el('span', 'gram-input-label', esc(field.label)));
    const input = field.kind === 'multiline'
      ? el('textarea', 'gram-input-area')
      : el('input', 'gram-input-field');
    if (input.tagName !== 'TEXTAREA') input.type = 'text';
    input.placeholder = field.placeholder || '';
    input.value = inputs[field.id] || '';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.id = `gram-in-${field.id}`;
    // Re-running on every keystroke is what makes the CYK table and the parse
    // tree feel like they belong to the word being typed. Every tool here is
    // polynomial on teaching-sized input; the two that are not (the tree
    // search, word generation) carry their own budget.
    const sync = () => {
      if (inputs[field.id] === input.value) return;
      inputs[field.id] = input.value;
      render();
    };
    input.addEventListener('input', () => { sync(); suggestActive(input); });
    // The symbol popover, on the fields the suggest layer names. It is the
    // same treatment cyk-in and ambig-in had through `on*` attributes in the
    // old markup; this view attaches its listeners at creation instead, so the
    // wiring lives beside the field rather than in index.html.
    if (GRAMMAR_STRING_FIELD_IDS.has(input.id)) {
      input.addEventListener('keydown', e => trySymSuggestKeydown(e));
      input.addEventListener('keyup', () => handleSymSuggestKeyup(input));
      input.addEventListener('focus', () => handleSymSuggestActive(input));
      input.addEventListener('click', () => refreshSymSuggest(input));
      input.addEventListener('blur', () => hideSymSuggest());
    }
    resFields.set(field.id, input);
    wrap.appendChild(input);
    row.appendChild(wrap);
  });
  return row;
}

function suggestActive(input) {
  if (GRAMMAR_STRING_FIELD_IDS.has(input.id)) handleSymSuggestActive(input);
}

// ══════════════════════════════════════════════════════════════════
//  BLOCKS -> DOM
// ══════════════════════════════════════════════════════════════════
//  The one place the vocabulary in js/grammar/blocks.js is turned into
//  elements. A block kind added there needs a case here and nothing else.

function renderBlock(b, idx = 0) {
  if (!b) return null;
  switch (b.t) {
    case 'p': return el('p', 'gram-p', b.x);
    case 'note': return el('div', `gram-note${b.kind ? ' is-' + b.kind : ''}`, b.x);
    case 'verdict': return verdictNode(b);
    case 'facts': return factsNode(b);
    case 'chips': return chipsNode(b);
    case 'words': return wordsNode(b);
    case 'rules': return rulesNode(b);
    case 'steps': return stepsNode(b);
    case 'table': return tableNode(b);
    case 'derivation': return derivationNode(b);
    case 'tree': return treeNode(b);
    case 'cyk': return cykNode(b);
    case 'scrub': return scrubNode(b, idx);
    case 'split': return splitNode(b, idx);
    case 'sec': return secNode(b, idx);
    case 'actions': return actionsNode(b);
    case 'examples': return examplesNode(b);
    default: return null;
  }
}

function secNode(b, idx) {
  const n = el('section', 'gram-sec');
  n.appendChild(el('h4', 'gram-sec-title', esc(b.title)));
  b.blocks.forEach((c, i) => {
    const child = renderBlock(c, idx * 100 + i);
    if (child) n.appendChild(child);
  });
  return n;
}

function verdictNode(b) {
  const n = el('div', `gram-verdict ${b.ok ? 'is-ok' : 'is-no'}`);
  n.appendChild(el('span', 'gram-verdict-mark', b.ok ? '✓' : '✗'));
  const body = el('div', 'gram-verdict-body');
  body.appendChild(el('div', 'gram-verdict-title', b.title));
  if (b.detail) body.appendChild(el('div', 'gram-verdict-detail', b.detail));
  n.appendChild(body);
  return n;
}

function factsNode(b) {
  const n = el('div', 'gram-facts');
  b.list.forEach(f => {
    const item = el('div', 'gram-fact');
    item.appendChild(el('span', 'gram-fact-k', esc(f.k)));
    item.appendChild(el('span', `gram-fact-v${f.mono === false ? '' : ' mono'}`, esc(f.v)));
    n.appendChild(item);
  });
  return n;
}

function chipsNode(b) {
  const n = el('div', 'gram-chips');
  b.list.forEach(c => {
    const chip = el('button', `gram-chip${c.ok === true ? ' is-ok' : c.ok === false ? ' is-no' : ''}`);
    chip.type = 'button';
    chip.innerHTML = `<span class="gram-chip-label">${esc(c.label)}</span>`
      + (c.detail ? `<span class="gram-chip-detail">${esc(c.detail)}</span>` : '');
    if (c.tool) {
      chip.addEventListener('click', () => openTool(c.tool));
      chip.title = `Open ${grammarTool(c.tool)?.label || c.tool}`;
    } else {
      chip.disabled = true;
    }
    n.appendChild(chip);
  });
  return n;
}

function wordsNode(b) {
  const n = el('div', 'gram-words');
  b.list.forEach(w => {
    const pill = el('button', 'gram-word');
    pill.type = 'button';
    pill.textContent = w;
    pill.title = 'Use this word';
    pill.addEventListener('click', () => {
      inputs.word = w === eps() ? '' : w;
      openTool('parse');
    });
    n.appendChild(pill);
  });
  return n;
}

function rulesNode(b) {
  return el('div', 'gram-rules is-result', b.g.rules.length
    ? rulesHtml(b.g)
    : '<div class="gram-empty">No rules.</div>');
}

function stepsNode(b) {
  const n = el('ol', 'gram-steps');
  b.list.forEach(s => {
    const li = el('li', 'gram-step');
    li.appendChild(el('div', 'gram-step-label', esc(s.label)));
    if (s.note) li.appendChild(el('div', 'gram-step-note', s.note));
    if (s.grammar) li.appendChild(el('div', 'gram-rules is-step', rulesHtml(s.grammar)));
    n.appendChild(li);
  });
  return n;
}

function cellHtml(cell, tag) {
  const v = typeof cell === 'string' ? cell : cell.v;
  const k = typeof cell === 'string' ? '' : ` class="v-${cell.k}"`;
  return `<${tag}${k}>${v}</${tag}>`;
}

function tableNode(b) {
  const wrap = el('div', `gram-table-wrap${b.wide ? ' is-wide' : ''}${b.scroll ? ' is-tall' : ''}`
    + (b.symbolHead ? ' is-symbol-head' : ''));
  wrap.innerHTML = `<table class="gram-table">
<thead><tr>${b.head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${b.rows.map(row => `<tr>${row.map((c, i) => cellHtml(c, i === 0 ? 'th' : 'td')).join('')}</tr>`).join('')}</tbody>
</table>`;
  return wrap;
}

function derivationNode(b) {
  const n = el('div', 'gram-deriv');
  b.list.forEach((step, i) => {
    const row = el('div', 'gram-deriv-row');
    row.innerHTML = `<span class="gram-deriv-op">${i === 0 ? '' : '⇒'}</span>`
      + `<span class="gram-deriv-form">${step.form.length
        ? step.form.map(s => esc(s)).join(' ')
        : esc(b.eps || eps())}</span>`
      + (step.rule ? `<span class="gram-deriv-rule">${esc(step.rule.lhs)} → ${esc(step.rule.rhsArr.length ? step.rule.rhsArr.join(' ') : (b.eps || eps()))}</span>` : '');
    n.appendChild(row);
  });
  return n;
}

/**
 * The tree is drawn from the geometry js/grammar/tree.js computed — no
 * measurement here, so the same layout can be asserted on in a test and drawn
 * twice on screen when two trees are being compared.
 */
function treeNode(b) {
  const L = b.layout;
  const wrap = el('div', 'gram-tree-wrap');
  const edges = L.edges.map(e =>
    `<line class="gtree-edge" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/>`).join('');
  const nodes = L.nodes.map(n => {
    const h = L.nodeH;
    const shape = n.kind === 'var'
      ? `<rect class="gtree-var" x="${n.x - n.w / 2}" y="${n.y - h / 2}" width="${n.w}" height="${h}" rx="6"/>`
      : `<rect class="gtree-${n.kind === 'eps' ? 'eps' : 'term'}" x="${n.x - n.w / 2}" y="${n.y - h / 2}" width="${n.w}" height="${h}" rx="${h / 2}"/>`;
    return `${shape}<text class="gtree-text" x="${n.x}" y="${n.y}">${esc(n.sym)}</text>`;
  }).join('');
  wrap.innerHTML = `<svg class="gram-tree" viewBox="0 0 ${L.w} ${L.h}"
    style="width:100%;max-width:${L.w}px" role="img" aria-label="Parse tree">${edges}${nodes}</svg>`;
  if (b.frontier) {
    wrap.appendChild(el('div', 'gram-tree-frontier',
      `Frontier <span class="mono">${esc(b.frontier.join(' '))}</span>`));
  }
  return wrap;
}

function cykNode(b) {
  const n = b.word.length;
  const wrap = el('div', 'gram-table-wrap is-wide');
  let html = '<table class="gram-cyk"><thead><tr><th class="gcyk-h gcyk-corner">i \\ j</th>';
  for (let j = 0; j < n; j++) html += `<th class="gcyk-h">${j}<span class="gcyk-sym">${esc(b.word[j])}</span></th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    html += `<tr><th class="gcyk-h">${i}</th>`;
    for (let j = 0; j < n; j++) {
      if (j < i) { html += '<td class="gcyk-off"></td>'; continue; }
      const cell = [...b.cells[i][j]];
      const cls = [
        'gcyk-cell',
        cell.length ? '' : 'is-empty',
        b.start && cell.includes(b.start) ? 'is-start' : '',
        b.active && b.active.i === i && b.active.j === j ? 'is-active' : ''
      ].filter(Boolean).join(' ');
      html += `<td class="${cls}">${cell.length ? cell.map(esc).join(', ') : '∅'}</td>`;
    }
    html += '</tr>';
  }
  wrap.innerHTML = html + '</tbody></table>';
  return wrap;
}

/**
 * A transport over frames the tool computed up front. Frames are built once
 * and scrubbed without re-running, which is why this can go backwards as
 * cheaply as forwards — the old CYK visualiser rebuilt its whole run to move
 * one step in either direction.
 */
function scrubNode(b, idx) {
  const key = `s${idx}`;
  const total = b.frames.length;
  let at = Math.min(scrubAt.get(key) ?? 0, total - 1);
  const n = el('div', 'gram-scrub');
  const bar = el('div', 'gram-scrub-bar');
  const back = el('button', 'gram-scrub-btn');
  const fwd = el('button', 'gram-scrub-btn');
  const end = el('button', 'gram-scrub-btn is-ghost');
  const range = el('input', 'gram-scrub-range');
  const count = el('span', 'gram-scrub-count');
  back.type = fwd.type = end.type = 'button';
  back.textContent = '‹ Back';
  fwd.textContent = 'Next ›';
  end.textContent = 'To the end';
  range.type = 'range';
  range.min = '0';
  range.max = String(total - 1);
  range.setAttribute('aria-label', b.label || 'Step');

  const body = el('div', 'gram-scrub-body');
  const note = el('div', 'gram-scrub-note');

  const paint = () => {
    scrubAt.set(key, at);
    range.value = String(at);
    count.textContent = `${at + 1} / ${total}`;
    back.disabled = at === 0;
    fwd.disabled = at === total - 1;
    end.disabled = at === total - 1;
    note.innerHTML = b.frames[at].note || '';
    body.innerHTML = '';
    const inner = renderBlock(b.frames[at].block, idx * 100 + 7);
    if (inner) body.appendChild(inner);
  };
  const go = to => { at = Math.max(0, Math.min(total - 1, to)); paint(); };

  back.addEventListener('click', () => go(at - 1));
  fwd.addEventListener('click', () => go(at + 1));
  end.addEventListener('click', () => go(total - 1));
  range.addEventListener('input', () => go(Number(range.value)));

  bar.append(back, fwd, range, count, end);
  n.append(bar, note, body);
  paint();
  return n;
}

function splitNode(b, idx) {
  const n = el('div', `gram-split${b.stack ? ' is-stacked' : ''}`);
  [b.left, b.right].forEach((side, i) => {
    const col = el('div', 'gram-split-col');
    const child = renderBlock(side, idx * 100 + 40 + i);
    if (child) col.appendChild(child);
    n.appendChild(col);
  });
  return n;
}

function actionsNode(b) {
  const n = el('div', 'gram-actions');
  b.list.forEach(a => {
    const btn = el('button', `gram-btn${a.kind === 'primary' ? ' is-primary' : ''}`);
    btn.type = 'button';
    btn.textContent = a.label;
    btn.addEventListener('click', () => runAction(a));
    n.appendChild(btn);
  });
  return n;
}

function examplesNode(b) {
  const n = el('div', 'gram-examples');
  b.list.forEach(ex => {
    const card = el('button', 'gram-example');
    card.type = 'button';
    card.innerHTML = `<span class="gram-example-name">${esc(ex.name)}</span>
<span class="gram-example-blurb">${esc(ex.blurb)}</span>
<span class="gram-example-src">${esc(ex.text).replace(/\n/g, '<br>')}</span>`;
    card.addEventListener('click', () => runAction({ act: 'loadExample', arg: ex.id }));
    n.appendChild(card);
  });
  return n;
}

// ══════════════════════════════════════════════════════════════════
//  ACTIONS
// ══════════════════════════════════════════════════════════════════
//  The only way a tool's result can change anything. A tool computes; the view
//  is what writes — so a tool that throws, or one whose result the reader
//  simply reads and moves on from, leaves the grammar and the canvas exactly
//  as they were.

function runAction(a) {
  switch (a.act) {
    case 'apply':
      setSource(a.arg);
      showStatus('Applied to the editor');
      return;
    case 'copy':
      navigator.clipboard?.writeText(a.arg)
        .then(() => showStatus('Copied'))
        .catch(() => showStatus('Could not reach the clipboard'));
      return;
    case 'openTool':
      openTool(a.arg);
      return;
    case 'loadExample': {
      const ex = grammarExample(a.arg);
      if (!ex) return;
      setSource(ex.text);
      inputs.word = ex.words?.[0] || '';
      inputs.words = (ex.words || []).join('\n');
      openTool('overview');
      showStatus(`Loaded ${ex.name}`);
      return;
    }
    case 'fillWords':
      openTool('batch');
      return;
    case 'loadPda':
      loadPdaToCanvas(a.arg);
      return;
    case 'loadFa':
      loadFaToCanvas(a.arg);
      return;
    default:
  }
}

/** Lays out `n` states on a row, with anything beyond the three named ones
 *  dropped onto a second row rather than piled on the first. */
function placeStates(names, primary) {
  const main = names.filter(n => primary.includes(n));
  const extra = names.filter(n => !primary.includes(n));
  const out = new Map();
  main.forEach((n, i) => out.set(n, { x: 140 + i * 230, y: 200 }));
  const cols = Math.max(1, Math.ceil(Math.sqrt(extra.length || 1)));
  extra.forEach((n, i) => out.set(n, {
    x: 140 + (i % cols) * 190,
    y: 380 + Math.floor(i / cols) * 140
  }));
  return out;
}

function loadPdaToCanvas(res) {
  snapshot();
  const pos = placeStates(res.states, ['q_start', 'q_loop', 'q_accept']);
  const ids = new Map();
  App.states = [];
  App.transitions = [];
  App.accepts.clear();
  App.startId = null;
  App.stateN = 0;
  App.transN = 0;
  res.states.forEach((name, i) => {
    const id = 's' + (i + 1);
    ids.set(name, id);
    App.stateN = i + 1;
    const p = pos.get(name) || { x: 140 + i * 180, y: 200 };
    App.states.push({ id, name, x: p.x, y: p.y });
    if (name === res.start) App.startId = id;
    if (res.accepts.includes(name)) App.accepts.add(id);
  });
  App.sigma = new Set(res.sigma);
  App.stackAlpha = new Set(res.stackAlpha);
  res.transitions.forEach((t, i) => {
    App.transitions.push({ ...t, id: 't' + (i + 1), from: ids.get(t.from), to: ids.get(t.to) });
  });
  App.transN = res.transitions.length;
  // The construction pushes strings and reads Z₀ explicitly, so the 7-tuple
  // paradigm is a property of what was built rather than a preference the
  // reader is being overridden on.
  App.config.pdaParadigm = 'explicit';
  const sel = $('set-pda-paradigm');
  if (sel) sel.value = 'explicit';

  applyMachineSwitch('NPDA');
  emit(Change.ALPHABET, Change.GRAPH);
  saveBackup();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus('NPDA loaded onto the canvas');
}

function loadFaToCanvas(res) {
  snapshot();
  App.states = [];
  App.transitions = [];
  App.accepts.clear();
  App.startId = null;
  App.stateN = 0;
  App.transN = 0;
  const cols = Math.max(2, Math.ceil(Math.sqrt(res.states.length)));
  res.states.forEach((s, i) => {
    App.states.push({ id: s.id, name: s.name, x: 140 + (i % cols) * 190, y: 140 + Math.floor(i / cols) * 160 });
    App.stateN = Math.max(App.stateN, Number(String(s.id).slice(1)) || 0);
    if (s.id === res.startId) App.startId = s.id;
    if (res.accepts.includes(s.id)) App.accepts.add(s.id);
  });
  res.transitions.forEach((t, i) => {
    App.transitions.push({ ...t });
    App.transN = Math.max(App.transN, i + 1);
  });
  res.sigma.forEach(s => App.sigma.add(s));

  applyMachineSwitch(res.machine);
  emit(Change.ALPHABET, Change.GRAPH);
  saveBackup();
  setView('build');
  if (typeof autoFitLoadedMachine === 'function') autoFitLoadedMachine();
  else setTimeout(() => fitToScreen(true), 50);
  showStatus(`${res.machine} loaded onto the canvas`);
}

// ══════════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ══════════════════════════════════════════════════════════════════

/** `setView('grammar')` calls this; so does every path that rehydrates App. */
export function renderGrammarView() {
  render();
}

/**
 * Σ is shared with the canvas, so a symbol added there is a terminal a word
 * can be typed over here. Kept as its own export because js/alphabet.js has
 * called it on every chip edit since the grammar view existed.
 */
export function renderGramSyms() {
  if (App.view === 'grammar') render();
}

/** The suggest layer's alphabet for the word fields. */
export function grammarSuggestTerminals() {
  return grammarTerminals(readGrammar());
}

/**
 * Everything this module remembers between renders — which tool is open, what
 * is in its fields, where each scrubber sits, and which frame the pane is
 * showing. It is session state in the app and must survive a re-render there;
 * in the test harness it is state that outlives `resetApp()`, so a word typed
 * in one case would be answered about in the next. See resetModuleState() in
 * tests/harness.js.
 */
export function resetGrammarView() {
  activeTool = null;
  editorMode = 'source';
  editorOpen = true;
  built = false;
  syncing = false;
  typingRun = null;
  inputs.word = '';
  inputs.words = '';
  scrubAt.clear();
  resFields.clear();
  resBody = null;
  paneTool = null;
}

// A loaded file, an undo, a tab switch and a cleared workspace all arrive as
// a write to App.grammar with no idea this view exists. Subscribing is what
// keeps the editor showing the grammar the workspace actually holds.
subscribe(Change.GRAMMAR, () => { if (App.view === 'grammar') render(); });
subscribe(Change.GRAPH, () => {
  // Two of the conversions read the canvas, so switching the model changes
  // whether they can run at all.
  if (App.view === 'grammar' && grammarTool(activeTool)?.needs?.machine) render();
});
