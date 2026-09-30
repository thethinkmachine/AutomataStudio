// ══════════════════════════════════════════════════════════════════
//  ARTICLES — A MACHINE'S ESSAY
// ══════════════════════════════════════════════════════════════════
// An entry's long-form write-up: a Markdown file beside the machine
// (machines/…/bb5.md beside bb5.automaton), or beside a collection
// (collections/busy-beavers.md). Its own file, so prose is written, diffed and
// reviewed as prose, and editing the essay never changes the machine's bytes.
//
// The Markdown is all of it — CommonMark and GitHub's extensions, parsed by
// markdown-it: headings, emphasis, ~~strikethrough~~, lists and task lists,
// quotes, tables with alignment, fenced code, links and bare URLs, images,
// footnotes, definition lists, ==highlight==, H~2~O and x^2^, and typographic
// quotes. On top of it, what an author coming from Obsidian expects —
// `> [!note] Title` callouts (foldable with `-`/`+`) and `[[id|text]]` links —
// and three things only this library can do, each answered by the library
// rather than the author:
//
//   $inline$  $$display$$  \(…\)  \[…\]
//       Math, left intact for KaTeX: an underscore in `$a_1$` is a subscript,
//       never emphasis.
//
//   {{steps}}  {{ones}}  {{steps turing/busy-beaver/bb4}}
//       A fact the build computed — the same numbers as the badges. An essay
//       quoting 47,176,870 cannot drift from the run that earned it.
//
//   ::: spacetime steps=3000
//   Caption, in the same Markdown.
//   :::
//       A figure drawn from the machine. Numbered, captioned.
//
// **Nothing an author writes reaches a page as markup it did not earn.** Text
// is escaped; a link must be http(s), mailto, # or lib:; an image must be
// https; raw HTML is allowed only as bare tags from a short list (<kbd>,
// <details>, <sub>, …) with no attributes, and anything else is shown as the
// text it is. Essays are published from other people's pull requests, and the
// page they land on is the app.
//
// DOM-free: the renderer takes `fact`, `figure` and `link` callbacks, so the
// website's build and the app's Library view — and its editor's preview —
// share it. What cannot be answered is kept visible and reported.

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';

export const ARTICLE_MAX_CHARS = 60000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const slugOf = s => String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

/** `steps=3000 id=turing/x` → { steps: '3000', id: 'turing/x' }; a bare word is in `_`. */
function parseArgs(s) {
  const out = { _: [] };
  for (const m of String(s || '').matchAll(/(\w+)=("[^"]*"|\S+)|(\S+)/g)) {
    if (m[1]) out[m[1]] = m[2].replace(/^"|"$/g, '');
    else out._.push(m[3]);
  }
  return out;
}

// ── Raw HTML: a short list of bare tags ───────────────────────────

export const HTML_OK = new Set(['sub', 'sup', 'kbd', 'mark', 'br', 'hr', 'details', 'summary', 'ins', 'del', 's', 'u', 'b', 'i', 'em', 'strong', 'small', 'cite', 'q', 'dfn', 'var', 'samp', 'code', 'abbr', 'p', 'div', 'span', 'center']);
const TAG_RE = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
const bareTag = t => {
  const m = /^<\/?([A-Za-z][A-Za-z0-9]*)\s*\/?>$/.exec(t);
  return m && HTML_OK.has(m[1].toLowerCase());
};

/** Raw HTML as written, if every tag in it is a bare allowed one; else null. */
function safeHtml(html) {
  let ok = true;
  const out = String(html).replace(TAG_RE, t => {
    if (t.startsWith('<!--')) return '';
    if (!bareTag(t)) ok = false;
    return t;
  });
  return ok ? out : null;
}

// ── Plugins ───────────────────────────────────────────────────────

/**
 * A caption or a callout's title, rendered inline with the essay's context —
 * but not its footnote list, or the footnote plugin would write the list out
 * again after every caption.
 */
function inlineIn(md, text, env) {
  const { footnotes, ...rest } = env;
  return md.renderInline(text, rest);
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col', 'source', 'area', 'embed', 'meta', 'link']);

/**
 * The finished HTML with every tag closed and no stray closing tag: a closing
 * tag that does not close the innermost open element is dropped, and what is
 * left open is closed at the end. So an author's <details> left open, or a
 * </div> with nothing to close, stays inside the essay — on the website the
 * essay is written into the page's own markup, and could otherwise close the
 * page's elements or swallow what follows it.
 */
export function balanceHtml(html) {
  const stack = [];
  const out = String(html).replace(/<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/g, (tag, name) => {
    const n = name.toLowerCase();
    if (tag.endsWith('/>') || VOID.has(n)) return tag;
    if (tag[1] !== '/') { stack.push(n); return tag; }
    if (stack[stack.length - 1] === n) { stack.pop(); return tag; }
    return '';
  });
  return out + stack.reverse().map(n => `</${n}>`).join('');
}

/** `$…$`, `$$…$$`, `\(…\)`, `\[…\]` inline, and `$$` blocks: kept verbatim for KaTeX. */
function mathPlugin(md) {
  md.inline.ruler.before('escape', 'essay_math', (state, silent) => {
    const src = state.src, pos = state.pos;
    let close = -1, open = '';
    if (src.startsWith('\\(', pos)) { open = '\\('; close = src.indexOf('\\)', pos + 2); if (close >= 0) close += 2; }
    else if (src.startsWith('\\[', pos)) { open = '\\['; close = src.indexOf('\\]', pos + 2); if (close >= 0) close += 2; }
    else if (src.startsWith('$$', pos)) { open = '$$'; close = src.indexOf('$$', pos + 2); if (close > pos + 2) close += 2; else close = -1; }
    else if (src[pos] === '$') {
      // Pandoc's rule, so a price is not math: no space inside either end, and
      // no digit straight after the closing sign ("$5 and $10").
      open = '$';
      if (/\s/.test(src[pos + 1] || ' ')) return false;
      let i = pos + 1;
      while ((i = src.indexOf('$', i)) >= 0) {
        if (src[i - 1] !== '\\' && !/\s/.test(src[i - 1]) && !/\d/.test(src[i + 1] || '')) break;
        i++;
      }
      if (i < 0 || i === pos + 1) return false;
      close = i + 1;
    } else return false;
    if (close < 0 || !open) return false;
    if (!silent) state.push('essay_math', '', 0).content = src.slice(pos, close);
    state.pos = close;
    return true;
  });
  md.block.ruler.before('fence', 'essay_math_block', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!first.startsWith('$$')) return false;
    if (silent) return true;
    let line = start;
    const one = first.length > 4 && first.trimEnd().endsWith('$$');
    if (!one) {
      for (line = start + 1; line < end; line++) {
        const t = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (t.trimEnd().endsWith('$$')) break;
      }
      if (line >= end) line = end - 1;
    }
    const tok = state.push('essay_math_block', 'div', 0);
    tok.content = state.getLines(start, line + 1, state.tShift[start], false).trim();
    tok.map = [start, line + 1];
    state.line = line + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.essay_math = (t, i) => esc(t[i].content);
  md.renderer.rules.essay_math_block = (t, i) => `<div class="essay-math">${esc(t[i].content)}</div>\n`;
}

/** `{{name}}` and `{{name <id>}}`: a fact the library computed. */
function factPlugin(md) {
  md.inline.ruler.before('emphasis', 'essay_fact', (state, silent) => {
    if (!state.src.startsWith('{{', state.pos)) return false;
    const m = /^\{\{\s*(\w+)(?:\s+([\w./-]+))?\s*\}\}/.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) state.push('essay_fact', '', 0).meta = { name: m[1], ref: m[2] || null };
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.essay_fact = (t, i, _o, env) => env.ctx.factHtml(t[i].meta.name, t[i].meta.ref);
}

/** `[[id]]` and `[[id|text]]`, Obsidian's links, to another entry or collection. */
function wikilinkPlugin(md) {
  md.inline.ruler.before('link', 'essay_wikilink', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos)) return false;
    const m = /^\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) state.push('essay_wikilink', '', 0).meta = { target: m[1].trim(), text: (m[2] || m[1]).trim() };
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.essay_wikilink = (t, i, _o, env) => {
    const { target, text } = t[i].meta;
    const url = env.ctx.href(`lib:${target}`);
    return url ? `<a class="textlink-inline" href="${esc(url)}">${esc(text)}</a>` : esc(text);
  };
}

/** `::: name args` … caption … `:::` — a figure drawn from the machine. */
function figurePlugin(md) {
  md.block.ruler.before('fence', 'essay_figure', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const m = /^:::\s*([A-Za-z][\w-]*)(.*)$/.exec(first);
    if (!m) return false;
    if (silent) return true;
    let line = start + 1;
    const cap = [];
    for (; line < end; line++) {
      const t = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      if (t.trim() === ':::') break;
      cap.push(t);
    }
    const tok = state.push('essay_figure', 'figure', 0);
    tok.meta = { name: m[1].toLowerCase(), args: parseArgs(m[2]), caption: cap.join(' ').trim() };
    tok.map = [start, Math.min(line + 1, end)];
    state.line = Math.min(line + 1, end);
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.essay_figure = (t, i, _o, env) => {
    const { name, args, caption } = t[i].meta;
    const f = env.ctx.figure(name, args);
    if (!f) { env.warnings.push(`::: ${name} is not a figure this machine can draw.`); return ''; }
    if (f.plain) return f.html;   // not a figure of the essay's: unnumbered, uncaptioned
    const n = ++env.figures;
    return `<figure class="essay-fig${f.wide ? ' is-wide' : ''}" id="${env.pid(`figure-${n}`)}">${f.html}${caption ? `<figcaption class="figcaption-text"><span class="fig-n">Figure ${n}.</span> ${inlineIn(md, caption, env)}</figcaption>` : ''}</figure>\n`;
  };
}

export const CALLOUT_ALIAS = { summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };

/** `> [!type] Title`, Obsidian's callouts; `-` folds one closed, `+` open. */
function calloutPlugin(md) {
  md.core.ruler.after('block', 'essay_callouts', state => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open' || toks[i + 1]?.type !== 'paragraph_open' || toks[i + 2]?.type !== 'inline') continue;
      const inl = toks[i + 2];
      const m = /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)(?:\n|$)/.exec(inl.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      toks[i].meta = { callout: CALLOUT_ALIAS[kind] || kind, label: kind, fold: m[2], title: m[3].trim() };
      inl.content = inl.content.slice(m[0].length);
      if (!inl.content.trim()) { toks[i + 1].hidden = true; toks[i + 3].hidden = true; }
      // The blockquote this callout closes with.
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type === 'blockquote_open') depth++;
        else if (toks[j].type === 'blockquote_close' && --depth === 0) { toks[j].meta = { ...toks[i].meta }; break; }
      }
    }
  });
  md.renderer.rules.blockquote_open = (t, i, o, env, slf) => {
    const c = t[i].meta?.callout;
    if (!c) return slf.renderToken(t, i, o);
    const title = t[i].meta.title ? inlineIn(md, t[i].meta.title, env) : esc(t[i].meta.label[0].toUpperCase() + t[i].meta.label.slice(1));
    const cls = `callout callout-${esc(c.replace(/[^a-z]/g, ''))}`;
    if (t[i].meta.fold) return `<details class="${cls}"${t[i].meta.fold === '+' ? ' open' : ''}><summary class="callout-title">${title}</summary><div class="callout-body">\n`;
    return `<div class="${cls}"><div class="callout-title">${title}</div><div class="callout-body">\n`;
  };
  md.renderer.rules.blockquote_close = (t, i, o, env, slf) => {
    const c = t[i].meta?.callout;
    if (!c) return slf.renderToken(t, i, o);
    return t[i].meta.fold ? '</div></details>\n' : '</div></div>\n';
  };
}

/** `- [ ]` and `- [x]`: GitHub's task lists, drawn as boxes that are not controls. */
function taskPlugin(md) {
  md.core.ruler.after('inline', 'essay_tasks', state => {
    const toks = state.tokens;
    for (let i = 2; i < toks.length; i++) {
      if (toks[i].type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
      const first = toks[i].children?.[0];
      const m = first?.type === 'text' && /^\[([ xX])\][ \t]/.exec(first.content);
      if (!m) continue;
      first.content = first.content.slice(m[0].length);
      const box = new state.Token('essay_task', '', 0);
      box.meta = { done: m[1] !== ' ' };
      toks[i].children.unshift(box);
      toks[i - 2].attrJoin('class', 'task-item');
    }
  });
  md.renderer.rules.essay_task = (t, i) => `<input class="task-box" type="checkbox" disabled${t[i].meta.done ? ' checked' : ''}> `;
}

/**
 * Headings get ids and a contents list; the shallowest heading becomes an h2,
 * since the page's one h1 is the entry's title — so an essay written with `#`
 * (Obsidian's habit) and one written with `##` read the same.
 */
function headingPlugin(md) {
  md.core.ruler.after('inline', 'essay_headings', state => {
    const env = state.env;
    const heads = state.tokens.filter(t => t.type === 'heading_open');
    if (!heads.length) return;
    const shift = 2 - Math.min(...heads.map(t => Number(t.tag.slice(1))));
    const used = new Set();
    state.tokens.forEach((t, i) => {
      if (t.type !== 'heading_open' && t.type !== 'heading_close') return;
      const level = Math.min(6, Number(t.tag.slice(1)) + shift);
      t.tag = `h${level}`;
      if (t.type === 'heading_close') return;
      const inline = state.tokens[i + 1];
      const text = (inline.children || []).filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('');
      let id = slugOf(text);
      while (used.has(id)) id += '-';
      used.add(id);
      t.attrSet('id', env.idPrefix + id);
      t.attrJoin('class', `essay-h${level}`);
      env.toc.push({ id: env.idPrefix + id, level, inline });
    });
  });
}

/**
 * Every link and image is judged here, after linkify has added its own, so a
 * bare URL is held to the same rule as a written one. A link that fails keeps
 * its text; an image that fails keeps its alt text; both are reported.
 */
function linkPolicyPlugin(md) {
  md.validateLink = () => true;   // judged below, where a failure can be reported
  md.core.ruler.push('essay_links', state => {
    const env = state.env;
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const kids = block.children;
      const open = [];
      for (let i = 0; i < kids.length; i++) {
        const t = kids[i];
        if (t.type === 'link_open') {
          const url = env.ctx.href(t.attrGet('href') || '');
          open.push(t);
          if (!url) { t.type = 'essay_dropped'; continue; }
          t.attrSet('href', url);
          t.attrJoin('class', 'textlink-inline');
          if (env.newTab && /^https?:/.test(url)) { t.attrSet('target', '_blank'); t.attrSet('rel', 'noopener noreferrer'); }
        } else if (t.type === 'link_close') {
          const o = open.pop();
          if (o?.type === 'essay_dropped') t.type = 'essay_dropped';
        } else if (t.type === 'image') {
          const src = t.attrGet('src') || '';
          if (!/^https:\/\//i.test(src)) {
            env.warnings.push(`Image "${src}" is not an https:// address; its alt text is shown instead.`);
            t.type = 'text';
            t.content = t.content || '';
            continue;
          }
          t.attrSet('loading', 'lazy');
          t.attrSet('referrerpolicy', 'no-referrer');
          t.attrJoin('class', 'essay-img');
        }
      }
    }
  });
  md.renderer.rules.essay_dropped = () => '';
}

/** How the rest is drawn: the website's classes, and raw HTML through the list above. */
function rendererPlugin(md) {
  const rules = md.renderer.rules;
  // A dollar sign that is not math — "$5 and $10", or a written \$ — gets an
  // element of its own. KaTeX's auto-render, which typesets the page after it
  // is drawn, matches delimiters only within one run of text, so a price
  // stays a price instead of becoming "5 and " in italics.
  rules.text = (t, i) => esc(t[i].content).replace(/\$/g, '<span class="md-dollar">$</span>');
  const warnHtml = (html, env) => {
    const ok = safeHtml(html);
    if (ok !== null) return ok;
    env.warnings.push(`HTML ${String(html).trim().slice(0, 40)} is not allowed in an essay; it is shown as text.`);
    return esc(html);
  };
  rules.html_inline = (t, i, _o, env) => warnHtml(t[i].content, env);
  rules.html_block = (t, i, _o, env) => warnHtml(t[i].content, env);
  rules.table_open = () => '<div class="table-wrap"><table class="board essay-table">\n';
  rules.table_close = () => '</table></div>\n';
  const cell = (t, i, o, env, slf) => {
    const style = t[i].attrGet('style') || '';
    if (/text-align:\s*right/.test(style)) t[i].attrJoin('class', 'num');
    else if (/text-align:\s*center/.test(style)) t[i].attrJoin('class', 'center');
    if (style) t[i].attrs = t[i].attrs.filter(([k]) => k !== 'style');
    return slf.renderToken(t, i, o);
  };
  rules.th_open = cell;
  rules.td_open = cell;
  const fence = rules.fence;
  rules.fence = (...a) => fence(...a).replace(/^<pre>/, '<pre class="essay-code">');
  const block = rules.code_block;
  rules.code_block = (...a) => block(...a).replace(/^<pre>/, '<pre class="essay-code">');
  // Footnotes, numbered in the order they are cited, with the essay's ids.
  rules.footnote_anchor_name = (t, i) => String(t[i].meta.id + 1);
  rules.footnote_caption = (t, i) => String(t[i].meta.id + 1);
  rules.footnote_ref = (t, i, o, env, slf) => {
    const n = slf.rules.footnote_anchor_name(t, i, o, env, slf);
    const refId = t[i].meta.subId > 0 ? `${n}-${t[i].meta.subId}` : n;
    return `<sup class="fn-ref" id="${env.pid(`fnref-${refId}`)}"><a href="#${env.pid(`fn-${n}`)}">${n}</a></sup>`;
  };
  rules.footnote_block_open = () => '<section class="essay-notes" aria-label="Notes"><ol>\n';
  rules.footnote_block_close = () => '</ol></section>\n';
  rules.footnote_open = (t, i, o, env, slf) => `<li id="${env.pid(`fn-${slf.rules.footnote_anchor_name(t, i, o, env, slf)}`)}">`;
  rules.footnote_anchor = (t, i, o, env, slf) => {
    const n = slf.rules.footnote_anchor_name(t, i, o, env, slf);
    const refId = t[i].meta.subId > 0 ? `${n}-${t[i].meta.subId}` : n;
    return ` <a class="fn-back" href="#${env.pid(`fnref-${refId}`)}" aria-label="Back to the text">↩</a>`;
  };
}

let parser = null;
function markdown() {
  if (parser) return parser;
  parser = new MarkdownIt({ html: true, linkify: true, typographer: true });
  parser.use(footnote).use(deflist).use(sub).use(sup).use(mark)
    .use(mathPlugin).use(factPlugin).use(wikilinkPlugin).use(figurePlugin)
    .use(calloutPlugin).use(taskPlugin).use(headingPlugin).use(linkPolicyPlugin).use(rendererPlugin);
  return parser;
}

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Markdown → { html, toc, figures, warnings }.
 *
 *   fact(name, ref)     → { value, say } | null — `value` is printed, `say` is
 *                         the tooltip naming where it came from.
 *   figure(name, args)  → { html, wide } | null — the drawing, or null for a
 *                         figure this machine cannot draw.
 *   link(ref)           → a URL for `lib:<id>` (and `[[id]]`), or null.
 *   idPrefix            put before every id the essay writes (headings,
 *                       figures, notes) — in the app the essay shares a
 *                       document with everything else, and "contents" is
 *                       not a safe id to hand out.
 *   anchorPrefix        what a `#heading` link is given, so it reaches the
 *                       heading it names (the idPrefix unless told otherwise).
 *   newTab              open http(s) links in a new tab, as the app does.
 *
 * What cannot be answered is kept visible and reported in `warnings`, which
 * the build prints: a missing fact reads as [[steps?]], never as a blank.
 */
export function renderArticle(md, { fact = () => null, figure = () => null, link = () => null, idPrefix = '', anchorPrefix = idPrefix, newTab = false } = {}) {
  const src = stripFrontMatter(md).slice(0, ARTICLE_MAX_CHARS);
  const warnings = [];
  const ctx = {
    factHtml(name, ref) {
      const f = fact(name, ref);
      if (!f) { warnings.push(`{{${name}${ref ? ' ' + ref : ''}}} is not a fact the library knows.`); return `<span class="fact is-missing">[[${esc(name)}?]]</span>`; }
      return `<span class="fact${f.pending ? ' is-pending' : ''}" title="${esc(f.say)}">${esc(f.value)}</span>`;
    },
    href(h) {
      if (/^lib:/.test(h)) {
        const url = link(h.slice(4));
        if (!url) warnings.push(`Link "${h}" names nothing in the library.`);
        return url;
      }
      // A #heading means this essay's heading, which carries the prefix.
      if (h.startsWith('#')) return `#${anchorPrefix}${h.slice(1)}`;
      if (/^(https?:\/\/|mailto:)/i.test(h)) return h;
      warnings.push(`Link "${h}" is neither http(s), mailto, # nor lib:.`);
      return null;
    },
    figure
  };
  const env = { ctx, warnings, toc: [], figures: 0, idPrefix, newTab, pid: s => esc(idPrefix + s) };
  const p = markdown();
  const html = balanceHtml(p.render(src, env));
  // A footnote cited and never written is left as the text [^x]; say so.
  // Code is left out of the search: an essay may show the syntax in `[^x]`.
  const prose = src.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/(`+)[^`]*?\1/g, '');
  const defined = new Set([...prose.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map(m => m[1]));
  for (const id of new Set([...prose.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map(m => m[1]))) {
    if (!defined.has(id)) warnings.push(`Footnote [^${id}] has no text.`);
  }
  // A heading's own html carries its footnote markers; the contents list does not want them.
  const toc = env.toc.map(t => ({
    id: t.id, level: t.level,
    html: p.renderer.renderInline(t.inline.children || [], p.options, env).replace(/<sup class="fn-ref"[\s\S]*?<\/sup>/g, '').trim()
  }));
  return { html, toc, figures: env.figures, warnings: [...new Set(warnings)] };
}

/**
 * A file's YAML front matter (`---` … `---` at the very top, as Obsidian and
 * most static-site tools write it) is the file's own bookkeeping, not prose,
 * so it is left out — it would otherwise read as a rule and a paragraph of keys.
 */
export function stripFrontMatter(md) {
  const s = String(md || '').replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/** Roughly how long the essay takes to read: words at 230 a minute. */
export function readingMinutes(md) {
  const words = stripFrontMatter(md).replace(/:::[\s\S]*?:::/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
