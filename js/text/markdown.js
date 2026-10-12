// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  MARKDOWN — the app's one dialect, which is markdown-it's
// ══════════════════════════════════════════════════════════════════
//  CommonMark with GitHub's tables and ~~strikethrough~~, bare URLs linked,
//  and math left verbatim for KaTeX (js/text/markdown-math.js) — parsed by
//  markdown-it, the same library the library's essays use, so a convention
//  means the same thing everywhere the app shows Markdown: StateMate's
//  replies, an exercise's prompt, and a note on the canvas.
//
//  The app had two hand-rolled dialects before this, and they disagreed: the
//  reply renderer read `__x__` as bold, the notes read it as underline, and
//  the notes refused emphasis inside a word, so bolding part of one wrote
//  `accept**ing**` and drew the asterisks. There is no underline in Markdown,
//  so there is none here.
//
//  **It builds nodes; it never assigns innerHTML, and there is no HTML
//  passthrough.** markdown-it parses to tokens and this module turns tokens
//  into elements with createElement and createTextNode, so a reply containing
//  <script> or <img onerror> renders those characters (`html: false` makes
//  markdown-it treat them as text, and nothing here could draw them anyway).
//  Markdown from a remote model is untrusted input; parse-to-HTML-then-scrub
//  is one CVE in the scrubber away from executing it, and the page's
//  Content-Security-Policy is the second line, not the first.
//
//  · **Links are scheme-checked.** Only http, https and mailto survive as
//    anchors (`validateLink`); anything else stays the text it was written as,
//    so an anchor that exists is an anchor that is safe to click.
//  · **Images are rendered as links.** An <img> is a request to a third party
//    the moment it is drawn — a tracking pixel a model can plant just by
//    answering. The alt text and URL are shown instead; the reader decides.
//  · **Math is passed through verbatim**, delimiters and all, before emphasis
//    can touch it. Typesetting is the caller's job — hand the finished node to
//    triggerMath().
//
//  Imports no app module, so it stays a leaf of the app's graph.

import MarkdownIt from 'markdown-it';
import { mathPlugin } from './markdown-math.js';

// ══════════════════════════════════════════════════════════════════
//  THE PARSER
// ══════════════════════════════════════════════════════════════════

const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * The URL if its scheme is one the app will follow, else ''. Relative URLs
 * mean nothing in a reply rendered from a string, so they are refused too —
 * which leaves exactly three schemes, all of them inert until the reader acts.
 */
export function safeUrl(raw) {
  const url = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!url) return '';
  // Control characters are how "java\nscript:" gets past a naive check.
  const flat = url.replace(/[\u0000- ]/g, '');
  return SAFE_SCHEME.test(flat) ? flat : '';
}

export const markdown = new MarkdownIt('default', { html: false, linkify: true, typographer: false })
  .use(mathPlugin);
markdown.validateLink = url => !!safeUrl(url);

// The same dialect for styled runs, without bare-URL linking: a run draws a
// link as its text anyway, and linkify takes the `~~` after a URL as part of
// it, which would turn the strikethrough around one into text.
const inlineMarkdown = new MarkdownIt('default', { html: false, linkify: false, typographer: false })
  .use(mathPlugin);
inlineMarkdown.validateLink = markdown.validateLink;

// And for a note, a whole one: every line the author ended is a line on the
// canvas (`breaks`), which is how a note has always read and what its editor
// writes — a note is short text in a box, not prose to be reflowed.
const noteMarkdown = new MarkdownIt('default', { html: false, linkify: false, typographer: false, breaks: true })
  .use(mathPlugin);
noteMarkdown.validateLink = markdown.validateLink;

/** A note's block tokens (js/canvas/note-layout.js lays them out). */
export function parseNoteMarkdown(text) {
  return noteMarkdown.parse(String(text ?? ''), {});
}

// ══════════════════════════════════════════════════════════════════
//  RENDERING TO THE DOM
// ══════════════════════════════════════════════════════════════════

const elem = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

// Block tokens and the element each opens. A token not listed opens nothing:
// its children land in the parent, which is the safe failure.
const BLOCK = {
  paragraph_open: t => elem('p', 'md-p'),
  heading_open: t => elem(/^h[1-6]$/.test(t.tag) ? t.tag : 'h6', 'md-h'),
  blockquote_open: () => elem('blockquote', 'md-quote'),
  bullet_list_open: () => elem('ul', 'md-list'),
  ordered_list_open: t => {
    const ol = elem('ol', 'md-list');
    const start = Number(t.attrGet('start'));
    if (Number.isFinite(start) && start !== 1) ol.setAttribute('start', String(start));
    return ol;
  },
  list_item_open: () => elem('li', 'md-li'),
  thead_open: () => elem('thead'),
  tbody_open: () => elem('tbody'),
  tr_open: () => elem('tr'),
  th_open: t => alignedCell('th', t),
  td_open: t => alignedCell('td', t)
};

function alignedCell(tag, token) {
  const cell = elem(tag);
  const align = /text-align:\s*(left|right|center)/.exec(token.attrGet('style') || '');
  if (align) cell.style.textAlign = align[1];
  return cell;
}

function codeBlock(token) {
  const pre = elem('pre', 'md-pre');
  const code = elem('code');
  const lang = String(token.info || '').trim().split(/\s+/)[0];
  if (lang) code.setAttribute('data-lang', lang);
  code.textContent = token.content.replace(/\n$/, '');
  pre.append(code);
  return pre;
}

function renderBlocks(tokens, host) {
  const stack = [host];
  const top = () => stack[stack.length - 1];
  for (const token of tokens) {
    if (token.type === 'table_open') {
      // The wrapper scrolls on its own so a wide table never widens the card.
      const wrap = elem('div', 'md-table-wrap');
      const table = elem('table', 'md-table');
      wrap.append(table);
      top().append(wrap);
      stack.push(table);
    } else if (token.nesting === 1) {
      // A tight list's paragraphs are hidden: an item's text is its content,
      // not a paragraph, or every bullet carries a block's worth of margin.
      if (token.hidden) { stack.push(top()); continue; }
      const make = BLOCK[token.type];
      const node = make ? make(token) : null;
      if (node) top().append(node);
      stack.push(node || top());
    } else if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else if (token.type === 'inline') {
      renderInline(token.children || [], top());
    } else if (token.type === 'fence' || token.type === 'code_block') {
      top().append(codeBlock(token));
    } else if (token.type === 'hr') {
      top().append(elem('hr', 'md-hr'));
    } else if (token.type === 'math_block') {
      const block = elem('div', 'md-math');
      block.textContent = token.content;
      top().append(block);
    }
  }
}

const INLINE = {
  strong_open: () => elem('strong'),
  em_open: () => elem('em'),
  s_open: () => elem('del')
};

function anchor(url) {
  const a = elem('a', 'md-link');
  a.setAttribute('href', url);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer nofollow');
  return a;
}

function renderInline(tokens, host) {
  const stack = [host];
  const top = () => stack[stack.length - 1];
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'math_inline':
        top().append(document.createTextNode(token.content));
        break;
      case 'softbreak':
        // A line that wraps in the source is one line in the text: the space a
        // browser shows for markdown-it's own "\n", written as one so that a
        // pre-wrap container (StateMate's prose is one) shows it the same way.
        top().append(document.createTextNode(' '));
        break;
      case 'hardbreak':
        top().append(elem('br'));
        break;
      case 'code_inline': {
        const code = elem('code');
        code.textContent = token.content;
        top().append(code);
        break;
      }
      case 'link_open': {
        // validateLink already refused anything else; checked again here so
        // this function is safe on any token stream, not only markdown-it's.
        const url = safeUrl(token.attrGet('href'));
        const node = url ? anchor(url) : elem('span');
        top().append(node);
        stack.push(node);
        break;
      }
      case 'image': {
        const label = elem('span', 'md-image');
        label.textContent = token.content ? `🖼 ${token.content}` : '🖼 image';
        top().append(label);
        const url = safeUrl(token.attrGet('src'));
        if (url) {
          const a = anchor(url);
          a.textContent = url;
          top().append(document.createTextNode(' '), a);
        }
        break;
      }
      default:
        if (token.nesting === 1) {
          const node = (INLINE[token.type] || (() => elem('span')))(token);
          top().append(node);
          stack.push(node);
        } else if (token.nesting === -1 && stack.length > 1) {
          stack.pop();
        }
    }
  }
}

/**
 * Render markdown into `host`, which is emptied first.
 *
 * @param {string} src
 * @param {Element} host
 * @returns {Element} host, for chaining into triggerMath()
 */
export function renderMarkdown(src, host) {
  if (!host) return host;
  host.innerHTML = '';   // clearing only — no markup is ever assigned
  renderBlocks(markdown.parse(String(src ?? ''), {}), host);
  return host;
}

// ══════════════════════════════════════════════════════════════════
//  STYLED RUNS — Markdown for text that is not HTML
// ══════════════════════════════════════════════════════════════════
//  A note is drawn in SVG text (so it survives PNG export) and edited in a
//  rich-text box, and both want the same thing from Markdown: one line as a
//  list of runs, each a piece of text and the styles over it. These two
//  functions are that, in both directions, and they are each other's inverse:
//  markdownRuns(runsToMarkdown(runs)) gives back the runs, which
//  tests/markdown.test.js checks over every combination of styles.

/** The styles a run can carry: what Markdown can say inside a line. */
export const RUN_STYLES = ['bold', 'italic', 'strike', 'code'];

const sameStyle = (a, b) => RUN_STYLES.every(s => !!a[s] === !!b[s]);

function pushRun(runs, text, style) {
  if (!text) return;
  const prev = runs[runs.length - 1];
  if (prev && sameStyle(prev, style)) prev.text += text;
  else runs.push({ text, ...Object.fromEntries(RUN_STYLES.map(s => [s, !!style[s]])) });
}

/**
 * One line of Markdown as styled runs. A link is its text; math and an image
 * are their source, verbatim — a note shows what was written, not a request.
 */
export function markdownRuns(line) {
  const [inline] = inlineMarkdown.parseInline(String(line ?? ''), {});
  return inlineTokenRuns(inline?.children || []);
}

/** Inline tokens — an `inline` token's children — as styled runs. A break is a space. */
export function inlineTokenRuns(tokens) {
  const runs = [];
  const style = { bold: 0, italic: 0, strike: 0, code: 0 };
  const flags = () => Object.fromEntries(RUN_STYLES.map(s => [s, style[s] > 0]));
  for (const token of tokens) {
    switch (token.type) {
      case 'strong_open': style.bold++; break;
      case 'strong_close': style.bold--; break;
      case 'em_open': style.italic++; break;
      case 'em_close': style.italic--; break;
      case 's_open': style.strike++; break;
      case 's_close': style.strike--; break;
      case 'code_inline': pushRun(runs, token.content, { ...flags(), code: true }); break;
      case 'image': pushRun(runs, token.content || token.attrGet('src') || '', flags()); break;
      case 'softbreak': case 'hardbreak': pushRun(runs, ' ', flags()); break;
      default:
        if (token.type === 'text' || token.type === 'math_inline') pushRun(runs, token.content, flags());
    }
  }
  return runs;
}

const isWordChar = ch => !!ch && /[\p{L}\p{N}]/u.test(ch);

// A character that could start syntax inside a line gets a backslash, and
// only where it could: `q_start` stays as written (an underscore inside a word
// is not emphasis in CommonMark), `(a|b)*` becomes `(a|b)\*`. Math needs no
// escaping here — it comes back verbatim, delimiters included — and block
// syntax cannot occur, since a line is parsed as inline text only.
function escapeText(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], prev = text[i - 1], next = text[i + 1];
    const special = ch === '\\' || ch === '`' || ch === '*' || ch === '~'
      || (ch === '_' && !(isWordChar(prev) && isWordChar(next)))
      // A link needs `](`, so escaping that `]` is enough to keep one literal.
      // Not `[`: `\[` opens display math (js/text/markdown-math.js).
      || (ch === ']' && next === '(')
      || (ch === '<' && /[A-Za-z/!?]/.test(next || ''))
      || (ch === '&' && /^#?\w+;/.test(text.slice(i + 1)));
    out += special ? `\\${ch}` : ch;
  }
  return out;
}

function codeSpan(text) {
  // A fence one backtick longer than the longest run inside it, padded when
  // the code starts or ends with one, as CommonMark spells it.
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map(r => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
  return fence + pad + text + pad + fence;
}

// Each character of some runs, with the styles it is drawn in — whitespace
// with none, since a marker never sits around it.
function styledChars(runs) {
  return runs.flatMap(r => [...r.text].map(ch => (/\s/u.test(ch) ? ch : `${ch}\u0000${RUN_STYLES.filter(s => r[s]).join('+')}`)));
}

function writeRun(part, styled) {
  if (!part.core) return part.run.text;
  let out = part.body;
  if (styled) {
    if (part.run.strike) out = `~~${out}~~`;
    if (part.run.italic) out = `*${out}*`;
    if (part.run.bold) out = `**${out}**`;
  }
  return part.lead + out + part.trail;
}

/**
 * Styled runs as one line of Markdown that parses back to them. Whitespace at
 * a run's edges is moved outside its markers — `** bold**` is not bold — and a
 * run of nothing but whitespace carries no markers at all.
 *
 * Whether a marker opens or closes depends on the characters either side of
 * it (CommonMark's flanking rules), and some places admit none: a run that
 * ends in punctuation with a letter straight after it (`*x.*y`). A marker
 * there is not markup but the text `*`. So the line is checked against the
 * parser itself rather than predicted: written, read back, and any run that
 * did not come back as it went in is written unstyled and the line tried
 * again. The characters are always what the reader wrote; at worst the
 * emphasis on a run Markdown has no way to say is dropped. Each pass drops at
 * least one style, so it ends.
 */
export function runsToMarkdown(runs) {
  const merged = [];
  for (const run of runs || []) pushRun(merged, run.text, run);
  const parts = merged.map(run => {
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text);
    return { run, lead, core, trail, body: core && run.code ? codeSpan(core) : escapeText(core) };
  });
  const want = styledChars(merged);
  // Where each part's characters start in `want`.
  const starts = [];
  parts.reduce((at, part) => { starts.push(at); return at + [...part.run.text].length; }, 0);
  const styled = parts.map(p => !!p.core && !!(p.run.bold || p.run.italic || p.run.strike));
  for (;;) {
    const line = parts.map((part, i) => writeRun(part, styled[i])).join('');
    const got = styledChars(markdownRuns(line));
    const at = want.findIndex((c, i) => got[i] !== c);
    if (at === -1 && got.length === want.length) return line;
    // The part the first difference falls in, or the styled one before it —
    // a marker that failed to close shows up in the run after its own.
    const inPart = Math.max(0, starts.findLastIndex(s => s <= (at === -1 ? want.length - 1 : at)));
    const culprit = styled[inPart] ? inPart : styled.slice(0, inPart).lastIndexOf(true);
    if (culprit === -1) return parts.map(part => writeRun(part, false)).join('');
    styled[culprit] = false;
  }
}
