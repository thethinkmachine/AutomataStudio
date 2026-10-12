// ══════════════════════════════════════════════════════════════════
//  NOTE LAYOUT — a note's Markdown as lines of styled runs
// ══════════════════════════════════════════════════════════════════
// A note is drawn as SVG text, one <tspan> per styled run, so it survives the
// PNG export (which rasterises the SVG) and glyph outlining. That rules out
// HTML layout, and it is why this module exists: it lays a note's Markdown out
// the way a terminal would, in a monospace grid of `width` characters, and
// hands back lines — each an array of runs { text, bold, italic, strike, code,
// rule } — that js/canvas/notes.js draws without knowing what made them.
//
//   paragraph   word-wrapped; every line the author ended stays a line
//   heading     the same, in bold
//   list        • or 1. hanging over the item, nested lists indented
//   blockquote  a │ down the left
//   code block  verbatim, hard-wrapped, in the code ink
//   rule        ────────
//   table       ┌──┬──┐ columns sized to their content, cells wrapped to fit,
//               │  │  │ alignment from the delimiter row, the header bold;
//               └──┴──┘ too many columns for the width and it reads as rows
//
// A run with `rule` is drawing, not text — a border, a bullet, a quote bar —
// and is drawn in a quieter ink. Blank lines between blocks are kept as the
// author wrote them (from the source line numbers markdown-it records), since
// Markdown itself would collapse them.
//
// DOM-free; js/text/markdown.js is the parser.

import { RUN_STYLES, inlineTokenRuns, parseNoteMarkdown } from '../text/markdown.js';

const textLength = runs => runs.reduce((n, r) => n + [...r.text].length, 0);
const rule = text => ({ text, rule: true });
const styleOf = run => Object.fromEntries(RUN_STYLES.map(s => [s, !!run[s]]));

// ── wrapping ─────────────────────────────────────────────────────

/**
 * Word-wraps one line's runs to `width` characters, keeping each run's style
 * across the break. A word longer than the line is cut. Returns lines.
 */
export function wrapRuns(runs, width) {
  const lines = [];
  let line = [], length = 0;
  // Commits the current line, dropping a separator that would dangle past it.
  const flush = () => {
    while (line.length && !line[line.length - 1].text.trim()) line.pop();
    lines.push(line);
    line = []; length = 0;
  };
  for (const run of runs) {
    const style = styleOf(run);
    for (const chunk of run.text.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        if (length) { line.push({ text: ' ' }); length += 1; }
        continue;
      }
      let word = [...chunk];
      while (word.length > width) {
        if (line.length) flush();
        lines.push([{ text: word.slice(0, width).join(''), ...style }]);
        word = word.slice(width);
      }
      if (!word.length) continue;
      if (length && length + word.length > width) flush();
      line.push({ text: word.join(''), ...style });
      length += word.length;
    }
  }
  if (line.length) flush();
  return lines.length ? lines : [[]];
}

// Splits inline tokens at line breaks: every line the author ended is a line.
function inlineLines(children) {
  const lines = [[]];
  for (const token of children || []) {
    if (token.type === 'softbreak' || token.type === 'hardbreak') lines.push([]);
    else lines[lines.length - 1].push(token);
  }
  return lines.map(inlineTokenRuns);
}

// ── the token stream as a tree ───────────────────────────────────

function tree(tokens) {
  const root = { children: [] };
  const stack = [root];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.nesting === 1) {
      const node = { token, type: token.type.replace(/_open$/, ''), children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else {
      top.children.push({ token, type: token.type, children: [] });
    }
  }
  return root;
}

const inlineOf = node => node.children.find(c => c.type === 'inline')?.token.children || [];

// ── blocks ───────────────────────────────────────────────────────

// The note's source lines, for telling where the author left a blank line.
let source = [];

function blocks(nodes, width, { tight = false } = {}) {
  const out = [];
  nodes.forEach((node, i) => {
    const map = node.token.map;
    // A blank line the author left above a block is kept — read off the
    // source, since a list counts the blank line after it as its own. In a
    // tight list, the paragraphs of one item have none.
    if (!tight && i && map) {
      for (let line = map[0] - 1; line >= 0 && !String(source[line] ?? 'x').trim(); line--) out.push([]);
    }
    out.push(...block(node, width));
  });
  return out;
}

function block(node, width) {
  switch (node.type) {
    case 'paragraph':
      return inlineLines(inlineOf(node)).flatMap(runs => wrapRuns(runs, width));
    case 'heading':
      return inlineLines(inlineOf(node))
        .flatMap(runs => wrapRuns(runs.map(r => ({ ...r, bold: true })), width));
    case 'bullet_list':
    case 'ordered_list':
      return list(node, width);
    case 'blockquote':
      return blocks(node.children, Math.max(4, width - 2)).map(line => [rule('│ '), ...line]);
    case 'fence':
    case 'code_block':
      return verbatim(node.token.content, width, { code: true });
    case 'math_block':
      return verbatim(node.token.content, width, {});
    case 'hr':
      return [[rule('─'.repeat(width))]];
    case 'table':
      return table(node, width);
    default:
      return node.children.length ? blocks(node.children, width) : [];
  }
}

function verbatim(content, width, style) {
  return String(content).replace(/\n$/, '').split('\n').flatMap(line => {
    const chars = [...line];
    if (!chars.length) return [[]];
    const out = [];
    for (let i = 0; i < chars.length; i += width) out.push([{ text: chars.slice(i, i + width).join(''), ...style }]);
    return out;
  });
}

function list(node, width) {
  const ordered = node.type === 'ordered_list';
  let n = ordered ? Number(node.token.attrGet('start') || 1) : 0;
  const items = node.children.filter(c => c.type === 'list_item');
  // Every marker of a list is as wide as its widest, so the text aligns.
  const markers = items.map(() => (ordered ? `${n++}. ` : '• '));
  const hang = Math.max(...markers.map(m => m.length));
  const tight = items.every(item => item.children.every(c => c.type !== 'paragraph' || c.token.hidden));
  const out = [];
  items.forEach((item, i) => {
    if (i && !tight) out.push([]);
    const inner = blocks(item.children, Math.max(4, width - hang), { tight });
    inner.forEach((line, k) => {
      const lead = k === 0 ? markers[i].padStart(hang) : ' '.repeat(hang);
      out.push([rule(lead), ...line]);
    });
    if (!inner.length) out.push([rule(markers[i].padStart(hang))]);
  });
  return out;
}

// ── tables ───────────────────────────────────────────────────────

function tableRows(node) {
  const rows = [];
  const walk = n => {
    if (n.type === 'tr') {
      rows.push(n.children.filter(c => c.type === 'th' || c.type === 'td').map(cell => {
        const align = /text-align:\s*(left|right|center)/.exec(cell.token.attrGet('style') || '');
        return {
          runs: inlineTokenRuns(inlineOf(cell)).map(r => (cell.type === 'th' ? { ...r, bold: true } : r)),
          align: align ? align[1] : 'left',
          header: cell.type === 'th'
        };
      }));
    } else n.children.forEach(walk);
  };
  walk(node);
  return rows;
}

/** The width a table would like: each column as wide as its widest cell. */
function naturalColumns(rows) {
  const columns = Math.max(0, ...rows.map(r => r.length));
  return Array.from({ length: columns }, (_, c) => Math.max(1, ...rows.map(r => (r[c] ? textLength(r[c].runs) : 0))));
}

const frame = widths => 3 * widths.length + 1;
const tableWidth = widths => widths.reduce((a, b) => a + b, 0) + frame(widths);

/**
 * Column widths that fit `width`: the natural ones if they do, otherwise every
 * column gets an equal share of what is left after the narrow ones have what
 * they need — so a short column is never squeezed to make room for a long one.
 */
function fitColumns(natural, width) {
  const avail = width - frame(natural);
  if (natural.reduce((a, b) => a + b, 0) <= avail) return natural;
  const widths = natural.slice();
  let left = avail, open = natural.map((_, i) => i);
  for (;;) {
    const share = Math.floor(left / open.length);
    const fits = open.filter(i => natural[i] <= share);
    if (!fits.length) {
      open.forEach((i, k) => { widths[i] = share + (k < left - share * open.length ? 1 : 0); });
      return widths;
    }
    fits.forEach(i => { widths[i] = natural[i]; left -= natural[i]; });
    open = open.filter(i => natural[i] > share);
    if (!open.length) return widths;
  }
}

function padCell(runs, width, align) {
  const space = Math.max(0, width - textLength(runs));
  const before = align === 'right' ? space : align === 'center' ? Math.floor(space / 2) : 0;
  const out = [];
  if (before) out.push({ text: ' '.repeat(before) });
  out.push(...runs);
  if (space - before) out.push({ text: ' '.repeat(space - before) });
  return out;
}

const border = (widths, [left, mid, right]) => [rule(left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right)];

function table(node, width) {
  const rows = tableRows(node);
  if (!rows.length) return [];
  const columns = Math.max(...rows.map(r => r.length));
  rows.forEach(r => { while (r.length < columns) r.push({ runs: [], align: 'left' }); });
  const natural = naturalColumns(rows);
  const widths = fitColumns(natural, width);
  // A column squeezed under three characters — narrower than it needs and too
  // narrow to read — and a grid only gets in the way: each row is written as
  // its cells, separated, the header in bold.
  if (widths.some((w, i) => w < Math.min(3, natural[i]))) {
    return rows.flatMap(row => wrapRuns(row.flatMap((cell, c) => (c ? [{ text: ' · ' }, ...cell.runs] : cell.runs)), width));
  }
  const out = [border(widths, '┌┬┐')];
  rows.forEach((row, r) => {
    const cellLines = row.map((cell, c) => wrapRuns(cell.runs, widths[c]));
    const height = Math.max(...cellLines.map(l => l.length));
    for (let k = 0; k < height; k++) {
      const line = [rule('│ ')];
      row.forEach((cell, c) => {
        if (c) line.push(rule(' │ '));
        line.push(...padCell(cellLines[c][k] || [], widths[c], cell.align));
      });
      line.push(rule(' │'));
      out.push(line);
    }
    if (row.some(cell => cell.header) && r === 0 && rows.length > 1) out.push(border(widths, '├┼┤'));
  });
  out.push(border(widths, '└┴┘'));
  return out;
}

// ── the note ─────────────────────────────────────────────────────

/** A note's Markdown laid out in `width` characters, as lines of runs. */
export function layoutNoteMarkdown(text, width) {
  source = String(text ?? '').split('\n');
  const lines = blocks(tree(parseNoteMarkdown(text)).children, Math.max(6, width));
  return lines.length ? lines : [[]];
}

/**
 * How wide a note's content would like to be, in characters: the widest table
 * at its natural width. An auto-sized note widens for it (up to its maximum),
 * because a table squeezed into twenty-four characters is no longer a table.
 */
export function noteNaturalWidth(text) {
  let widest = 0;
  const walk = node => {
    if (node.type === 'table') widest = Math.max(widest, tableWidth(naturalColumns(tableRows(node))));
    else node.children.forEach(walk);
  };
  walk(tree(parseNoteMarkdown(text)));
  return widest;
}
