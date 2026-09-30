// ══════════════════════════════════════════════════════════════════
//  TEX — WHERE MATH STARTS AND ENDS IN TEXT
// ══════════════════════════════════════════════════════════════════
//  The delimiters KaTeX's auto-render looks for, stated once. The app's
//  triggerMath (reference.js) and the library website's pages both pass these,
//  so an author's `$a^n b^n$` typesets the same in the Library view, in the
//  submit form's preview and on the machine's page on the website.
//
//  Import-free, so the website build can read it without the app.

export const TEX_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true }
];

/**
 * Whether `text` holds anything auto-render would typeset: a closed pair of
 * one of the delimiters, with something between. A lone `$` is a dollar sign.
 * The website loads KaTeX only on a page where this is true.
 */
export function hasTex(text) {
  const s = String(text || '');
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(s);
}
