// ══════════════════════════════════════════════════════════════════
//  NOTES BEFORE MARKDOWN — read once, by the schema 1 → 2 migration
// ══════════════════════════════════════════════════════════════════
// Until schema 2 a note's text was a markup of the app's own, not Markdown:
// `**bold**`, `*italic*` and `__underline__`, recognised only around whole
// words. Under markdown-it's conventions the same characters mean other
// things — `a*b*` is "a" and an italic "b", `__x__` is bold — so a note
// written then would draw differently now. MIGRATIONS[1] in js/persistence.js
// rewrites each one as the Markdown that draws what it drew: the old parser
// below reads it exactly as it always did, and runsToMarkdown writes the
// result, escaping whatever was literal. An underline becomes bold, which is
// what its own markers say in Markdown; Markdown has no underline.
//
// The parser is kept verbatim and nothing but the migration calls it.

import { runsToMarkdown } from './markdown.js';

// Splits raw markup text into { text, bold, italic, underline } runs, one per
// styled span, without crossing newlines (callers split on '\n' first).
// Recognizes **bold**, *italic*, __underline__ — non-greedy and non-nested.
//
// Markers must "flank" a word the way CommonMark requires: the opener sits at
// line start or after whitespace/opening punctuation, the closer at line end or
// before whitespace/closing punctuation, and the content may not begin or end
// with a space. Without that rule this markup would eat notation that shows up
// constantly in this domain — `a*b*`, `Σ*`, `(0|1)*` would silently italicize,
// and `q_start to q_end` would silently underline. Those now render literally;
// the trade-off is that markers can only wrap whole words, not word interiors.
export function parseLegacyNoteRuns(line) {
  const runs = [], active = { bold: 0, italic: 0, underline: 0 };
  const markerStyles = { '**': ['bold'], '***': ['bold', 'italic'], '*': ['italic'], '__': ['underline'] };
  const markerRe = /\*{1,3}|__/g;
  let cursor = 0, match;
  const pushText = text => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    const style = { bold: active.bold > 0, italic: active.italic > 0, underline: active.underline > 0 };
    if (prev && prev.bold === style.bold && prev.italic === style.italic && prev.underline === style.underline) prev.text += text;
    else runs.push({ text, ...style });
  };
  while ((match = markerRe.exec(line))) {
    const marker = match[0], styles = markerStyles[marker];
    const before = match.index ? line[match.index - 1] : '';
    const after = line[match.index + marker.length] || '';
    const leftBoundary = !before || /[\s([{"']/.test(before) || before === '*' || before === '_';
    const rightBoundary = !after || /[\s)\]}"'.,;:!?]/.test(after) || after === '*' || after === '_';
    const canClose = styles && styles.every(style => active[style] > 0) && rightBoundary;
    let closeAt = line.indexOf(marker, match.index + marker.length);
    let hasCloser = false;
    while (closeAt !== -1) {
      const closeAfter = line[closeAt + marker.length] || '';
      if (!closeAfter || /[\s)\]}"'.,;:!?]/.test(closeAfter) || closeAfter === '*' || closeAfter === '_') { hasCloser = true; break; }
      closeAt = line.indexOf(marker, closeAt + marker.length);
    }
    const canOpen = styles && leftBoundary && !/^\s$/.test(after) && hasCloser;
    if (!canClose && !canOpen) continue;
    pushText(line.slice(cursor, match.index));
    styles.forEach(style => { active[style] += canClose ? -1 : 1; });
    cursor = match.index + marker.length;
  }
  pushText(line.slice(cursor));
  return runs;
}

/** A note's text, written in the pre-Markdown markup, as Markdown that draws the same. */
export function migrateLegacyNoteText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n')
    .map(line => runsToMarkdown(parseLegacyNoteRuns(line).map(run => ({
      text: run.text,
      bold: run.bold || run.underline,
      italic: run.italic
    }))))
    .join('\n');
}
