// ══════════════════════════════════════════════════════════════════
//  MATH IN MARKDOWN — a markdown-it plugin
// ══════════════════════════════════════════════════════════════════
// `$…$`, `$$…$$`, `\(…\)` and `\[…\]` inline, and `$$` blocks, kept verbatim —
// delimiters and all — for KaTeX's auto-render to typeset after the text is
// drawn. Parsed before emphasis and escapes, so an underscore in `$a_1$` is a
// subscript and never the start of an emphasis run, and a backslash in
// `\frac` is TeX rather than a Markdown escape.
//
// It makes two tokens, `math_inline` and `math_block`, each carrying its
// source in `content`; a renderer says how to draw them. The library's essays
// (js/library/article.js) and the app's own Markdown (js/markdown.js) share
// it, so a formula reads the same in both.
//
// Imports nothing.

export function mathPlugin(md) {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
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
    if (!silent) state.push('math_inline', '', 0).content = src.slice(pos, close);
    state.pos = close;
    return true;
  });
  md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
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
    const tok = state.push('math_block', 'div', 0);
    tok.content = state.getLines(start, line + 1, state.tShift[start], false).trim();
    tok.map = [start, line + 1];
    state.line = line + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
