// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  MARKDOWN — FOR TEXT THIS APP DID NOT WRITE
// ══════════════════════════════════════════════════════════════════
//  A CommonMark subset plus the GFM bits a language model actually reaches
//  for, rendered to DOM nodes.
//
//  **It builds nodes; it never assigns innerHTML, and there is no HTML
//  passthrough.** That is the whole security design, and it is a property of
//  the shape rather than of a filter: the only way text becomes content here
//  is document.createTextNode, so a reply containing <script> or <img onerror>
//  renders those characters. There is nothing to sanitise because there is no
//  parser for it to get past. Markdown from a remote model is untrusted input,
//  and the usual answer — parse to HTML, then scrub — is one CVE in the
//  scrubber away from executing it.
//
//  Two consequences of that stance worth knowing:
//
//  · **Links are scheme-checked, not escaped.** Only http, https and mailto
//    survive as anchors; javascript:, data: and the rest render as plain text,
//    so an anchor that exists is an anchor that is safe to click.
//  · **Images are rendered as links.** An <img> is a request to a third party
//    the moment it is drawn — a tracking pixel a model can plant just by
//    answering. The alt text and URL are shown instead; the reader decides.
//
//  Math is passed through *verbatim*, delimiters and all, and deliberately
//  parsed before emphasis: `$a_1 * b_2$` must not lose its asterisk to an
//  emphasis run before KaTeX ever sees it. Typesetting is the caller's job —
//  hand the finished node to triggerMath().
//
//  Imports nothing, so it stays a leaf and is safe to reach from anywhere.

// ══════════════════════════════════════════════════════════════════
//  BLOCKS
// ══════════════════════════════════════════════════════════════════

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\n]*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const HR = /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^( {0,7})([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/** Split a table row into cells, honouring \| escapes and optional edge pipes. */
function tableCells(line) {
  const cells = [];
  let cell = '';
  let i = 0;
  const src = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|[ \t]*$/, '');
  while (i < src.length) {
    if (src[i] === '\\' && src[i + 1] === '|') { cell += '|'; i += 2; continue; }
    if (src[i] === '|') { cells.push(cell.trim()); cell = ''; i++; continue; }
    cell += src[i++];
  }
  cells.push(cell.trim());
  return cells;
}

function alignments(delim) {
  return tableCells(delim).map(spec => {
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

/**
 * Lines → block objects. Recursive: a blockquote and a list item hold blocks
 * of their own, which is what makes nesting work without a special case per
 * depth.
 */
export function parseBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // ── fenced code ──────────────────────────────────────────────
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const width = fence[1].length;
      const lang = fence[2].trim().split(/\s+/)[0] || '';
      const body = [];
      i++;
      while (i < lines.length) {
        const close = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${width},}[ \\t]*$`);
        if (close.test(lines[i])) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    // ── thematic break ───────────────────────────────────────────
    if (HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    // ── heading ──────────────────────────────────────────────────
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    // ── blockquote ───────────────────────────────────────────────
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && inner.length && !ITEM.test(lines[i])))) {
        const m = QUOTE.exec(lines[i]);
        inner.push(m ? m[1] : lines[i]);   // lazy continuation
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
      continue;
    }

    // ── table ────────────────────────────────────────────────────
    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1])) {
      const head = tableCells(line);
      const align = alignments(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, align, rows });
      continue;
    }

    // ── list ─────────────────────────────────────────────────────
    const item = ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const start = ordered ? parseInt(item[2], 10) : 1;
      const items = [];
      let loose = false;

      while (i < lines.length) {
        const head = ITEM.exec(lines[i]);
        if (!head) break;
        if (/\d/.test(head[2]) !== ordered) break;   // a different list starts here

        // Everything indented past this marker belongs to the item, so a
        // nested list or a second paragraph comes back out of parseBlocks
        // rather than needing a rule of its own.
        const indent = head[1].length + head[2].length + head[3].length;
        const body = [head[4]];
        i++;
        let trailingBlank = false;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            // A blank line ends the item unless indented content follows it.
            const next = lines[i + 1];
            if (next && next.trim() && next.search(/\S/) >= indent) {
              body.push('');
              trailingBlank = true;
              i++;
              continue;
            }
            break;
          }
          if (lines[i].search(/\S/) >= indent) { body.push(lines[i].slice(indent)); i++; continue; }
          if (ITEM.test(lines[i]) || HR.test(lines[i])) break;
          body.push(lines[i].trim());   // lazy paragraph continuation
          i++;
        }
        if (trailingBlank) loose = true;
        items.push(parseBlocks(body));

        while (i < lines.length && !lines[i].trim()) {
          // A blank line between items makes the list loose; two end it.
          if (i + 1 < lines.length && ITEM.test(lines[i + 1])) { loose = true; i++; continue; }
          break;
        }
      }
      blocks.push({ type: 'list', ordered, start, loose, items });
      continue;
    }

    // ── paragraph ────────────────────────────────────────────────
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !HR.test(lines[i])
      && !QUOTE.test(lines[i]) && !ITEM.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) blocks.push({ type: 'para', text: para.join('\n') });
    else i++;   // nothing consumed; do not spin
  }

  return blocks;
}

// ══════════════════════════════════════════════════════════════════
//  INLINE
// ══════════════════════════════════════════════════════════════════

const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>$';

// Math is matched before anything else can claim its contents. The delimiters
// stay in the text so KaTeX's auto-render can find them later.
const MATH = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
  { open: '\\(', close: '\\)' },
  { open: '$', close: '$' }
];

const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * A URL is either safe to make clickable or it is text. Relative links have no
 * meaning in a dialog rendered from a string, so they are text too — which
 * leaves exactly three schemes, all of them inert until the reader acts.
 */
export function safeUrl(raw) {
  const url = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!url) return '';
  // Control characters are how "java\nscript:" gets past a naive check.
  const flat = url.replace(/[\u0000-\u0020]/g, '');
  return SAFE_SCHEME.test(flat) ? flat : '';
}

function textNode(text) { return document.createTextNode(text); }

function elem(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Find the end of a run opened at `i`, skipping escapes. */
function findClose(src, from, close) {
  let i = from;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src.startsWith(close, i)) return i;
    i++;
  }
  return -1;
}

// `_` must not fire inside a word — q_0 and snake_case are ordinary text in a
// tool about automata, and treating them as emphasis is the single most
// common way a naive renderer mangles a reply.
function isWordChar(ch) { return !!ch && /[\p{L}\p{N}]/u.test(ch); }

/** Inline markdown → an array of nodes. */
export function inlineNodes(src) {
  const out = [];
  let buffer = '';
  const flush = () => { if (buffer) { out.push(textNode(buffer)); buffer = ''; } };
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // ── backslash escape ─────────────────────────────────────────
    if (ch === '\\' && ESCAPABLE.includes(src[i + 1])) { buffer += src[i + 1]; i += 2; continue; }

    // ── hard break ───────────────────────────────────────────────
    if (ch === '\n') {
      const hard = /[ ]{2,}$/.test(src.slice(0, i)) || src[i - 1] === '\\';
      if (hard) {
        buffer = buffer.replace(/[ \\]+$/, '');
        flush();
        out.push(elem('br'));
      } else {
        buffer += ' ';   // a soft break is a space, the way markdown means it
      }
      i++;
      continue;
    }

    // ── math, before emphasis can eat into it ────────────────────
    const math = MATH.find(m => src.startsWith(m.open, i));
    if (math) {
      const end = src.indexOf(math.close, i + math.open.length);
      // A lone $ is a dollar sign, not an unterminated formula.
      if (end !== -1 && end > i + math.open.length) {
        flush();
        out.push(textNode(src.slice(i, end + math.close.length)));
        i = end + math.close.length;
        continue;
      }
    }

    // ── code span ────────────────────────────────────────────────
    if (ch === '`') {
      const ticks = /^`+/.exec(src.slice(i))[0];
      const end = src.indexOf(ticks, i + ticks.length);
      if (end !== -1) {
        flush();
        const code = elem('code');
        code.textContent = src.slice(i + ticks.length, end).replace(/^ (.*) $/, '$1');
        out.push(code);
        i = end + ticks.length;
        continue;
      }
    }

    // ── image → a link, never a request ──────────────────────────
    if (ch === '!' && src[i + 1] === '[') {
      const link = matchLink(src, i + 1);
      if (link) {
        flush();
        out.push(...imageNodes(link));
        i = link.end;
        continue;
      }
    }

    // ── link ─────────────────────────────────────────────────────
    if (ch === '[') {
      const link = matchLink(src, i);
      if (link) {
        flush();
        out.push(anchorNode(link));
        i = link.end;
        continue;
      }
    }

    // ── autolink ─────────────────────────────────────────────────
    if (ch === '<') {
      const close = src.indexOf('>', i);
      if (close !== -1) {
        const url = safeUrl(src.slice(i + 1, close));
        if (url) {
          flush();
          out.push(anchorNode({ text: src.slice(i + 1, close), url, literal: true }));
          i = close + 1;
          continue;
        }
      }
    }

    // ── bare URL ─────────────────────────────────────────────────
    if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(src.slice(i))) {
      const raw = /^[^\s<>()]+/.exec(src.slice(i))[0].replace(/[.,;:!?]+$/, '');
      const url = safeUrl(raw);
      if (url) {
        flush();
        out.push(anchorNode({ text: raw, url, literal: true }));
        i += raw.length;
        continue;
      }
    }

    // ── emphasis ─────────────────────────────────────────────────
    const emphasis = matchEmphasis(src, i);
    if (emphasis) {
      flush();
      const node = elem(emphasis.tag);
      inlineNodes(emphasis.inner).forEach(child => node.append(child));
      out.push(node);
      i = emphasis.end;
      continue;
    }

    buffer += ch;
    i++;
  }

  flush();
  return out;
}

/** `[text](url "title")` starting at `[`. */
function matchLink(src, at) {
  if (src[at] !== '[') return null;
  let depth = 1;
  let i = at + 1;
  while (i < src.length && depth) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    if (depth) i++;
  }
  if (depth || src[i + 1] !== '(') return null;
  const text = src.slice(at + 1, i);
  const close = findClose(src, i + 2, ')');
  if (close === -1) return null;
  const target = src.slice(i + 2, close).trim();
  const url = safeUrl(target.replace(/\s+["'(].*$/, ''));
  return { text, url, end: close + 1 };
}

/**
 * `literal` marks a label that is already final — an autolink, a bare URL, the
 * address beside an image. Without it the label is re-parsed, spots the URL it
 * is made of, and builds another anchor around it, forever.
 */
function anchorNode({ text, url, literal = false }) {
  // A link whose scheme did not survive is shown, not followed.
  if (!url) {
    const span = elem('span');
    span.textContent = text || '';
    return span;
  }
  const a = elem('a', 'md-link');
  a.setAttribute('href', url);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer nofollow');
  if (literal) a.textContent = text;
  else inlineNodes(text).forEach(child => a.append(child));
  return a;
}

function imageNodes({ text, url }) {
  const label = elem('span', 'md-image');
  label.textContent = text ? `🖼 ${text}` : '🖼 image';
  return url ? [label, textNode(' '), anchorNode({ text: url, url, literal: true })] : [label];
}

const EMPHASIS = [
  { marker: '***', tag: 'strong', wrap: 'em' },
  { marker: '___', tag: 'strong', wrap: 'em' },
  { marker: '**', tag: 'strong' },
  { marker: '__', tag: 'strong' },
  { marker: '~~', tag: 'del' },
  { marker: '*', tag: 'em' },
  { marker: '_', tag: 'em' }
];

function matchEmphasis(src, i) {
  for (const rule of EMPHASIS) {
    if (!src.startsWith(rule.marker, i)) continue;

    // Intraword underscores are not emphasis.
    if (rule.marker[0] === '_' && isWordChar(src[i - 1])) continue;

    const from = i + rule.marker.length;
    if (src[from] === ' ' || src[from] === undefined) continue;   // "a * b" is arithmetic

    let end = from;
    for (;;) {
      end = findClose(src, end, rule.marker);
      if (end === -1) break;
      if (rule.marker[0] === '_' && isWordChar(src[end + rule.marker.length])) { end += rule.marker.length; continue; }
      if (src[end - 1] === ' ') { end += rule.marker.length; continue; }
      break;
    }
    if (end === -1 || end === from) continue;

    const inner = src.slice(from, end);
    if (rule.wrap) {
      // ***both*** — one node inside the other, so the markers stay honest.
      const outer = { tag: rule.tag, inner: `${rule.wrap === 'em' ? '*' : ''}${inner}${rule.wrap === 'em' ? '*' : ''}` };
      return { ...outer, end: end + rule.marker.length };
    }
    return { tag: rule.tag, inner, end: end + rule.marker.length };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════════

function renderBlock(block, host) {
  switch (block.type) {
    case 'heading': {
      const node = elem(`h${Math.min(6, block.level)}`, 'md-h');
      inlineNodes(block.text).forEach(child => node.append(child));
      host.append(node);
      break;
    }
    case 'para': {
      const node = elem('p', 'md-p');
      inlineNodes(block.text).forEach(child => node.append(child));
      host.append(node);
      break;
    }
    case 'code': {
      const pre = elem('pre', 'md-pre');
      const code = elem('code');
      if (block.lang) code.setAttribute('data-lang', block.lang);
      code.textContent = block.text;
      pre.append(code);
      host.append(pre);
      break;
    }
    case 'quote': {
      const node = elem('blockquote', 'md-quote');
      block.blocks.forEach(child => renderBlock(child, node));
      host.append(node);
      break;
    }
    case 'hr':
      host.append(elem('hr', 'md-hr'));
      break;
    case 'list': {
      const list = elem(block.ordered ? 'ol' : 'ul', 'md-list');
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
      block.items.forEach(blocks => {
        const li = elem('li', 'md-li');
        blocks.forEach(child => {
          // In a tight list an item's paragraphs are its contents, not
          // paragraphs — otherwise every bullet carries a block's worth of
          // margin, and a bullet with a nested list under it carries two. The
          // unwrap is per block, not only when the paragraph is alone: an item
          // is usually [text, sublist], and that is exactly the case where the
          // stray <p> shows.
          if (!block.loose && child.type === 'para') {
            inlineNodes(child.text).forEach(node => li.append(node));
          } else {
            renderBlock(child, li);
          }
        });
        list.append(li);
      });
      host.append(list);
      break;
    }
    case 'table': {
      // The wrapper scrolls on its own so a wide table never widens the card.
      const wrap = elem('div', 'md-table-wrap');
      const table = elem('table', 'md-table');
      const thead = elem('thead');
      const hrow = elem('tr');
      block.head.forEach((cell, n) => {
        const th = elem('th');
        if (block.align[n]) th.style.textAlign = block.align[n];
        inlineNodes(cell).forEach(child => th.append(child));
        hrow.append(th);
      });
      thead.append(hrow);
      table.append(thead);

      const tbody = elem('tbody');
      block.rows.forEach(row => {
        const tr = elem('tr');
        // Ragged rows are normal in generated tables; pad rather than drop.
        for (let n = 0; n < block.head.length; n++) {
          const td = elem('td');
          if (block.align[n]) td.style.textAlign = block.align[n];
          inlineNodes(row[n] || '').forEach(child => td.append(child));
          tr.append(td);
        }
        tbody.append(tr);
      });
      table.append(tbody);
      wrap.append(table);
      host.append(wrap);
      break;
    }
    default:
      break;
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
  const lines = String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');
  parseBlocks(lines).forEach(block => renderBlock(block, host));
  return host;
}
