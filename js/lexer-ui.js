// ══════════════════════════════════════════════════════════════════
//  THE LEXER GENERATOR — its page in the Algorithms view
// ══════════════════════════════════════════════════════════════════
// The only DOM-bound module of the generator; js/lexer/*.js computes.
//
// The page is the construction the rest of the Algorithms view teaches, run
// to its practical end: regular expressions in, one minimal DFA, and a
// tokenizer out — watched on a sample as you type, drawn on the canvas on
// request, and emitted as a file in three languages.
//
// It follows the grammar workbench's rule for a page that re-renders on
// every keystroke: **the frame is built once and only the results below the
// fields are replaced**, because rebuilding a textarea takes the caret and
// the focus with it. A tab switch is the one time the fields themselves are
// written, and only when what they hold is no longer this workspace's.
//
// The rules live in `App.lexer`, which rides in the workspace document. It
// stays null until the reader edits something, so opening the page to look
// does not turn a workspace into one that carries a lexer.

import { ALGO_ICON_LOAD_CANVAS } from './algorithms-fa.js';
import { exportCopyText, exportDownload } from './export-core.js';
import { DEFAULT_LEXER_RULES, DEFAULT_LEXER_SAMPLE, LEXER_LANGS, buildLexer, lexerToMachine, runLexer } from './lexer/build.js';
import { LEXER_EMITTERS } from './lexer/emit.js';
import { $, App } from './state.js';
import { Change, emit, subscribe } from './store.js';
import { showStatus } from './utils.js';
import { autoLayout } from './canvas.js';
import { createTab } from './ui.js';
import { loadBuiltMachine } from './workspace.js';

const TOKEN_DISPLAY_CAP = 400;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function current() {
  return App.lexer || { rules: DEFAULT_LEXER_RULES, sample: DEFAULT_LEXER_SAMPLE, lang: 'js' };
}

// The last build, keyed on the rules text: typing in the sample re-runs the
// lexer, not the construction.
let built = { rules: null, lx: null };
function lexerFor(rules) {
  if (built.rules !== rules) built = { rules, lx: buildLexer(rules) };
  return built.lx;
}

let refs = null;
let timer = null;

export function algoLexer(c) {
  const doc = current();
  c.innerHTML = '';
  c.append(el('div', 'algo-title', 'Lexer Generator'));
  c.append(el('div', 'algo-sub', 'REGULAR EXPRESSIONS → ONE MINIMAL DFA → A TOKENIZER'));
  const info = el('div', 'info-box');
  info.textContent = 'Each rule is a token name and a pattern. The patterns are compiled together, by Thompson’s construction and the subset construction, into one DFA whose accepting states name a token, then minimized. The lexer runs that DFA as far as it can and takes the longest match; when two rules match the same text, the one listed first wins.';
  c.append(info);

  const rulesCard = el('div', 'card');
  rulesCard.append(el('div', 'card-title', 'Rules'));
  const rules = el('textarea', 'inp lx-rules');
  rules.spellcheck = false;
  rules.rows = Math.min(18, Math.max(8, doc.rules.split('\n').length + 1));
  rules.setAttribute('aria-label', 'Lexer rules, one per line');
  rules.value = doc.rules;
  const diags = el('div', 'lx-diags');
  diags.setAttribute('aria-live', 'polite');
  rulesCard.append(rules, diags);
  c.append(rulesCard);

  const tryCard = el('div', 'card');
  tryCard.append(el('div', 'card-title', 'Try it'));
  const sample = el('textarea', 'inp lx-sample');
  sample.spellcheck = false;
  sample.rows = 3;
  sample.setAttribute('aria-label', 'Sample input');
  sample.value = doc.sample;
  const tokens = el('div', 'lx-tokens');
  tryCard.append(sample, tokens);
  c.append(tryCard);

  const dfaCard = el('div', 'card');
  dfaCard.append(el('div', 'card-title', 'The automaton'));
  const stats = el('div', 'lx-stats');
  const classes = el('div', 'lx-classes');
  const load = el('button', 'algo-btn');
  load.type = 'button';
  load.innerHTML = `${ALGO_ICON_LOAD_CANVAS}Load DFA onto canvas`;
  load.addEventListener('click', loadOntoCanvas);
  dfaCard.append(stats, classes, load);
  c.append(dfaCard);

  const codeCard = el('div', 'card');
  codeCard.append(el('div', 'card-title', 'Generate code'));
  const bar = el('div', 'lx-code-bar');
  const lang = el('select', 'inp lx-lang');
  lang.setAttribute('aria-label', 'Language');
  LEXER_LANGS.forEach(([k, label]) => { const o = el('option', null, label); o.value = k; lang.append(o); });
  lang.value = doc.lang;
  const copy = el('button', 'algo-btn sec', 'Copy');
  copy.type = 'button';
  const download = el('button', 'algo-btn sec', 'Download');
  download.type = 'button';
  bar.append(lang, copy, download);
  const code = el('pre', 'lx-code');
  codeCard.append(bar, code);
  c.append(codeCard);

  refs = { rules, diags, sample, tokens, stats, classes, load, lang, copy, download, code };

  const write = () => {
    App.lexer = { rules: rules.value, sample: sample.value, lang: lang.value };
    emit(Change.LEXER);
  };
  rules.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(write, 120); });
  sample.addEventListener('input', write);
  lang.addEventListener('change', write);
  copy.addEventListener('click', () => {
    const lx = lexerFor(current().rules);
    if (lx.ok) exportCopyText(LEXER_EMITTERS[current().lang].emit(lx), 'Lexer copied to clipboard');
  });
  download.addEventListener('click', () => {
    const lx = lexerFor(current().rules);
    if (!lx.ok) return;
    const e = LEXER_EMITTERS[current().lang];
    exportDownload(`lexer.${e.ext}`, e.emit(lx), e.mime);
  });

  renderResults();
}

// Whether the page is on screen — the frame outlives it in `refs` after the
// reader moves to another algorithm, and writing into a detached frame is
// wasted work at best.
function pageShowing() {
  return !!refs && App.view === 'algo' && App.currentAlgo === 'lexer';
}

function renderResults() {
  if (!pageShowing()) return;
  const doc = current();
  const lx = lexerFor(doc.rules);
  const { diags, tokens, stats, classes, load, copy, download, code } = refs;

  diags.innerHTML = '';   // clearing only — every node below is built
  lx.diagnostics.forEach(d => {
    const row = el('div', `lx-diag is-${d.level}`);
    row.append(el('span', 'lx-diag-line', `line ${d.line}`), el('span', null, d.message));
    diags.append(row);
  });

  [load, copy, download].forEach(b => { b.disabled = !lx.ok; });
  tokens.innerHTML = '';
  classes.innerHTML = '';
  if (!lx.ok) {
    stats.textContent = 'Fix the rules above to build the lexer.';
    code.textContent = '';
    return;
  }

  const run = runLexer(lx, doc.sample);
  run.tokens.slice(0, TOKEN_DISPLAY_CAP).forEach(t => {
    const tok = el('span', `lx-tok${t.skip ? ' is-skip' : ''}`);
    tok.title = `${t.type} at line ${t.line}, column ${t.col}${t.skip ? ' (skipped)' : ''}`;
    // Whitespace is drawn as itself made visible, or a skipped run of spaces
    // is an empty chip that says nothing about what was skipped.
    const shown = t.text.replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/ /g, '·');
    tok.append(el('span', 'lx-tok-type', t.type), el('span', 'lx-tok-text', shown));
    tokens.append(tok);
  });
  if (run.tokens.length > TOKEN_DISPLAY_CAP) tokens.append(el('span', 'lx-more', `…and ${run.tokens.length - TOKEN_DISPLAY_CAP} more`));
  if (run.error) {
    tokens.append(el('div', 'lx-diag is-error',
      `No rule matches ${JSON.stringify(run.error.char)} at line ${run.error.line}, column ${run.error.col}. The lexer stops here.`));
  } else if (!run.tokens.length) {
    tokens.append(el('span', 'lx-more', 'Type some input to see its tokens.'));
  }

  const kept = run.tokens.filter(t => !t.skip).length;
  stats.textContent = `${lx.rules.length} rules → ${lx.nStates} states × ${lx.nClasses} character classes. ${kept} token${kept === 1 ? '' : 's'} in the sample${run.tokens.length > kept ? `, ${run.tokens.length - kept} skipped` : ''}.`;

  const table = el('div', 'lx-class-list');
  lx.labels.forEach((label, k) => {
    const row = el('span', 'lx-class');
    row.title = `${lx.classes[k].length} character${lx.classes[k].length === 1 ? '' : 's'}`;
    row.textContent = label;
    table.append(row);
  });
  classes.append(el('div', 'lx-classes-head', 'Character classes: each column of the DFA, and each symbol of Σ on the canvas.'), table);

  code.textContent = LEXER_EMITTERS[doc.lang].emit(lx);
}

function loadOntoCanvas() {
  const lx = lexerFor(current().rules);
  if (!lx.ok) return;
  const m = lexerToMachine(lx);
  // A tab of its own. The DFA has nothing to do with the machine this tab
  // holds — which may be a student's answer to an exercise — and replacing it
  // would be an edit nobody asked for. The rules go with it, so reopening the
  // generator there shows what built the diagram.
  const spec = App.lexer ? { ...App.lexer } : null;
  createTab('Lexer DFA');
  App.lexer = spec;
  App.sigma = new Set(m.sigma);
  loadBuiltMachine(m, 'DFA');
  autoLayout();
  emit(Change.ALPHABET, Change.LEXER);
  showStatus(`Lexer DFA loaded: ${m.states.length} states. Accepting states are named after the token they produce.`);
}

// A tab switch or a loaded file brings a different rule set. Typing brings
// the same one back, so the fields are only written when they disagree.
subscribe(Change.LEXER, () => {
  if (!pageShowing()) return;
  const doc = current();
  if (refs.rules.value !== doc.rules) refs.rules.value = doc.rules;
  if (refs.sample.value !== doc.sample) refs.sample.value = doc.sample;
  if (refs.lang.value !== doc.lang) refs.lang.value = doc.lang;
  renderResults();
});
