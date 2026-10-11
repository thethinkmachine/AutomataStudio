// ══════════════════════════════════════════════════════════════════
//  NOTE EDITOR — what the toolbar does to the Markdown
// ══════════════════════════════════════════════════════════════════
// The note editor is the Markdown itself, in a plain text box, with a live
// preview beside it drawn by the canvas's own renderer. Its toolbar does what
// a Markdown editor's does: it writes syntax around the selection, or takes
// it away again. Each function here takes the text and the selection and
// answers the edit as { from, to, insert, select: [start, end] } — replace
// from..to with `insert`, then select — so the caller can apply it through
// the text box's own editing (and its own undo).
//
// DOM-free.

export const INLINE_MARKERS = { bold: '**', italic: '*', strike: '~~', code: '`' };

/**
 * Wrap the selection in `marker`, or unwrap it if it is already wrapped —
 * inside the selection or just outside it. With nothing selected, the markers
 * go in with the caret between them.
 */
export function toggleInline(text, start, end, marker) {
  const m = marker.length;
  const sel = text.slice(start, end);
  // Already wrapped inside the selection: `**word**` selected.
  if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)
    && !(marker === '*' && sel.startsWith('**') && !sel.startsWith('***'))) {
    const inner = sel.slice(m, -m);
    return { from: start, to: end, insert: inner, select: [start, start + inner.length] };
  }
  // Wrapped just outside it: `word` selected inside `**word**`. Asterisks are
  // counted, since one run of them can be both styles at once — 1 is italic,
  // 2 bold, 3 both — and italic must not take an asterisk that bold owns.
  const outside = (() => {
    if (marker === '*' || marker === '**') {
      let left = 0, right = 0;
      while (text[start - 1 - left] === '*') left++;
      while (text[end + right] === '*') right++;
      return marker === '*' ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2;
    }
    return text.slice(start - m, start) === marker && text.slice(end, end + m) === marker;
  })();
  if (outside) {
    return { from: start - m, to: end + m, insert: sel, select: [start - m, start - m + sel.length] };
  }
  // Whitespace at the selection's edges stays outside the markers, where
  // Markdown needs it: `** word**` is not bold.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(sel);
  if (!core) {
    return { from: start, to: end, insert: sel + marker + marker, select: [end + m, end + m] };
  }
  const insert = lead + marker + core + marker + trail;
  const at = start + lead.length + m;
  return { from: start, to: end, insert, select: [at, at + core.length] };
}

const LIST_PREFIX = { bullet: /^(\s*)[-*+] /, numbered: /^(\s*)\d+[.)] / };

/**
 * Make every line the selection touches a list item, or take the marker off
 * if they all have one already. A numbered list counts from 1.
 */
export function toggleList(text, start, end, kind) {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', Math.max(start, end - (end > start ? 1 : 0)));
  const to = lineEnd === -1 ? text.length : lineEnd;
  const lines = text.slice(from, to).split('\n');
  const marked = lines.every(line => !line.trim() || LIST_PREFIX[kind].test(line));
  let n = 0;
  const insert = lines.map(line => {
    if (!line.trim()) return line;
    if (marked) return line.replace(LIST_PREFIX[kind], '$1');
    const bare = line.replace(LIST_PREFIX.bullet, '$1').replace(LIST_PREFIX.numbered, '$1');
    const indent = /^\s*/.exec(bare)[0];
    return `${indent}${kind === 'bullet' ? '- ' : `${++n}. `}${bare.slice(indent.length)}`;
  }).join('\n');
  return { from, to, insert, select: [from, from + insert.length] };
}

/**
 * A table to fill in, on lines of its own, with the first header cell
 * selected. Two columns, one row: the shape most notes want, and the shape
 * that shows how to add more.
 */
export function insertTable(text, start, end) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const table = '| Column | Column |\n| --- | --- |\n|  |  |';
  const at = start + lead.length + 2;
  return { from: start, to: end, insert: lead + table + tail, select: [at, at + 'Column'.length] };
}
