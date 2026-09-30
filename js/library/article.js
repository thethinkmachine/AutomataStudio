// ══════════════════════════════════════════════════════════════════
//  ARTICLES — A MACHINE'S ESSAY
// ══════════════════════════════════════════════════════════════════
// An entry's long-form write-up: a Markdown file beside the machine
// (machines/…/bb5.md beside bb5.automaton), or beside a collection
// (collections/busy-beavers.md). Its own file, so prose is written, diffed and
// reviewed as prose, and editing the essay never changes the machine's bytes.
//
// The dialect is small on purpose — a book's, not a blog's:
//
//   ## Heading, ### Subheading        paragraphs, > quotes, - and 1. lists
//   **strong**, *emphasis*, `code`    [text](https://…), [text](lib:turing/busy-beaver/bb4)
//   $inline$ and $$display$$ math     | tables | with a --- rule under the head |
//   a footnote[^1] … [^1]: its text   ``` fenced code ```
//
// and two things only this library can do, both answered by the machine rather
// than by the author:
//
//   {{steps}}  {{ones}}  {{steps turing/busy-beaver/bb4}}
//       A fact the build computed — the same numbers as the badges. An essay
//       quoting 47,176,870 cannot drift from the run that earned it.
//
//   ::: spacetime steps=3000
//   Caption, in the same Markdown.
//   :::
//       A figure drawn from the machine at build time. Numbered, captioned.
//
// Import-free and DOM-free: the renderer takes `fact` and `figure` callbacks,
// so the website's build and (later) the app's Library view share it.

export const ARTICLE_MAX_CHARS = 60000;
const MAX_CHARS = ARTICLE_MAX_CHARS;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const slugOf = s => String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

/** `steps=3000 id=turing/x` → { steps: '3000', id: 'turing/x' }; a bare word is `_`. */
function parseArgs(s) {
  const out = { _: [] };
  for (const m of String(s || '').matchAll(/(\w+)=("[^"]*"|\S+)|(\S+)/g)) {
    if (m[1]) out[m[1]] = m[2].replace(/^"|"$/g, '');
    else out._.push(m[3]);
  }
  return out;
}

// ── Blocks ────────────────────────────────────────────────────────

/**
 * Markdown → a list of blocks. Line-based and forgiving: anything it does not
 * recognise is a paragraph, so a typo shows up as text rather than vanishing.
 */
export function parseArticle(md) {
  const lines = String(md || '').slice(0, MAX_CHARS).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const notes = new Map();
  let i = 0;
  const blank = l => !l.trim();
  const starts = l => /^(#{1,3}\s|>\s?|[-*]\s|\d+\.\s|:::|```|\$\$|\|)/.test(l.trim()) || /^\[\^[^\]]+\]:/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (blank(line)) { i++; continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) {
      // A page has one title and it is the entry's, so # is a section too.
      blocks.push({ kind: 'heading', level: Math.max(2, m[1].length), text: m[2].trim() });
      i++; continue;
    }
    if ((m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line))) {
      const body = [m[2]];
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) body.push(lines[i++].trim());
      notes.set(m[1], body.join(' '));
      continue;
    }
    if (t.startsWith(':::')) {
      const head = t.slice(3).trim();
      const sp = head.search(/\s/);
      const name = (sp < 0 ? head : head.slice(0, sp)).toLowerCase();
      const args = parseArgs(sp < 0 ? '' : head.slice(sp));
      const cap = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') cap.push(lines[i++]);
      i++;   // the closing :::
      blocks.push({ kind: 'figure', name, args, caption: cap.join(' ').trim() });
      continue;
    }
    if (t.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (t.startsWith('$$')) {
      const body = [t];
      if (!(t.length > 2 && t.endsWith('$$') && t !== '$$')) {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i]);
      }
      i++;
      blocks.push({ kind: 'math', text: body.join('\n') });
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      const align = cells(lines[i + 1]).map(c => (c.endsWith(':') ? 'num' : ''));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', head, align, rows });
      continue;
    }
    if (/^>\s?/.test(t)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) body.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    if ((m = /^([-*]|\d+\.)\s+/.exec(t))) {
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length && !blank(lines[i])) {
        const l = lines[i].trim();
        const im = /^([-*]|\d+\.)\s+(.*)$/.exec(l);
        if (im) items.push(im[2]);
        else if (items.length) items[items.length - 1] += ' ' + l;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const body = [];
    while (i < lines.length && !blank(lines[i]) && (!body.length || !starts(lines[i]))) body.push(lines[i++].trim());
    blocks.push({ kind: 'para', text: body.join(' ') });
  }
  return { blocks, notes };
}

// ── Inline ────────────────────────────────────────────────────────

/**
 * One line of Markdown → HTML. Code spans and math are set aside first, so a
 * `*` inside `$a*b$` stays an asterisk for KaTeX, and everything is escaped
 * before any tag is written.
 */
function inline(src, ctx) {
  const kept = [];
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  let s = String(src || '');
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, m => keep(esc(m)));
  s = s.replace(/\{\{\s*(\w+)(?:\s+([\w./-]+))?\s*\}\}/g, (_, name, ref) => keep(ctx.factHtml(name, ref)));
  s = s.replace(/\[\^([^\]]+)\]/g, (_, id) => keep(ctx.noteRef(id)));
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const url = ctx.href(href.replace(/&amp;/g, '&'));
    if (!url) return text;
    const away = ctx.newTab && /^https?:/.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="textlink-inline" href="${esc(url)}"${away}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[+n]);
}

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Markdown → { html, toc, figures, warnings }.
 *
 *   fact(name, ref)     → { value, say } | null — `value` is printed, `say` is
 *                         the tooltip naming where it came from.
 *   figure(name, args)  → { html, alt } | null — the drawing, or null for a
 *                         figure this machine cannot draw.
 *   link(ref)           → a URL for `lib:<id>`, or null.
 *   idPrefix            put before every id the essay writes (headings,
 *                       figures, notes) — in the app the essay shares a
 *                       document with everything else, and "contents" is
 *                       not a safe id to hand out.
 *   newTab              open http(s) links in a new tab, as the app does.
 *
 * What cannot be answered is kept visible and reported in `warnings`, which
 * the build prints: a missing fact reads as [[steps?]], never as a blank.
 */
export function renderArticle(md, { fact = () => null, figure = () => null, link = () => null, idPrefix = '', newTab = false } = {}) {
  const { blocks, notes } = parseArticle(md);
  const pid = s => esc(idPrefix + s);
  const warnings = [];
  const noteOrder = [];
  const ctx = {
    newTab,
    factHtml(name, ref) {
      const f = fact(name, ref);
      if (!f) { warnings.push(`{{${name}${ref ? ' ' + ref : ''}}} is not a fact the library knows.`); return `<span class="fact is-missing">[[${esc(name)}?]]</span>`; }
      return `<span class="fact" title="${esc(f.say)}">${esc(f.value)}</span>`;
    },
    noteRef(id) {
      if (!notes.has(id)) { warnings.push(`Footnote [^${id}] has no text.`); return ''; }
      let n = noteOrder.indexOf(id) + 1;
      if (!n) n = noteOrder.push(id);
      return `<sup class="fn-ref" id="${pid(`fnref-${slugOf(id)}`)}"><a href="#${pid(`fn-${slugOf(id)}`)}">${n}</a></sup>`;
    },
    href(h) {
      if (/^lib:/.test(h)) {
        const url = link(h.slice(4));
        if (!url) warnings.push(`Link "${h}" names nothing in the library.`);
        return url;
      }
      if (/^(https?:\/\/|#)/.test(h)) return h;
      warnings.push(`Link "${h}" is neither http(s) nor lib:.`);
      return null;
    }
  };
  const toc = [];
  const used = new Set();
  let figN = 0;
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'heading') {
      let id = slugOf(b.text);
      while (used.has(id)) id += '-';
      used.add(id);
      const html = inline(b.text, ctx);
      toc.push({ id: idPrefix + id, level: b.level, html });
      out.push(`<h${b.level} class="essay-h${b.level}" id="${pid(id)}">${html}</h${b.level}>`);
    } else if (b.kind === 'para') {
      out.push(`<p>${inline(b.text, ctx)}</p>`);
    } else if (b.kind === 'quote') {
      out.push(`<blockquote>${inline(b.text, ctx)}</blockquote>`);
    } else if (b.kind === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${b.items.map(x => `<li>${inline(x, ctx)}</li>`).join('')}</${tag}>`);
    } else if (b.kind === 'code') {
      out.push(`<pre class="essay-code"><code>${esc(b.text)}</code></pre>`);
    } else if (b.kind === 'math') {
      out.push(`<div class="essay-math">${esc(b.text)}</div>`);
    } else if (b.kind === 'table') {
      const cls = j => (b.align[j] ? ' class="num"' : '');
      out.push(`<div class="table-wrap"><table class="board essay-table"><thead><tr>${b.head.map((c, j) => `<th${cls(j)}>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, j) => `<td${cls(j)}>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (b.kind === 'figure') {
      const f = figure(b.name, b.args);
      if (!f) { warnings.push(`::: ${b.name} is not a figure this machine can draw.`); continue; }
      figN++;
      out.push(`<figure class="essay-fig${f.wide ? ' is-wide' : ''}" id="${pid(`figure-${figN}`)}">${f.html}${b.caption ? `<figcaption class="figcaption-text"><span class="fig-n">Figure ${figN}.</span> ${inline(b.caption, ctx)}</figcaption>` : ''}</figure>`);
    }
  }
  if (noteOrder.length) {
    out.push(`<section class="essay-notes" aria-label="Notes"><ol>${noteOrder.map(id => `<li id="${pid(`fn-${slugOf(id)}`)}">${inline(notes.get(id), ctx)} <a class="fn-back" href="#${pid(`fnref-${slugOf(id)}`)}" aria-label="Back to the text">↩</a></li>`).join('')}</ol></section>`);
  }
  // A heading's own html carries its footnote markers; the contents list does not want them.
  return { html: out.join('\n'), toc: toc.map(x => ({ ...x, html: x.html.replace(/<sup class="fn-ref"[\s\S]*?<\/sup>/g, '') })), figures: figN, warnings };
}

/** Roughly how long the essay takes to read: words at 230 a minute. */
export function readingMinutes(md) {
  const words = String(md || '').replace(/:::[\s\S]*?:::/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
