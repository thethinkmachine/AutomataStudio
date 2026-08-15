// ══════════════════════════════════════════════════════════════════
//  GUIDE BLOCKS
// ══════════════════════════════════════════════════════════════════
// The content vocabulary shared by js/machine-guide.js and
// js/concept-guide.js, and the one place js/reference.js's renderer has to
// agree with. A block kind added here needs a case in `renderBlock()`.
//
// This module imports nothing, so the two guide files stay leaves as far as
// evaluation order is concerned.
//
// Writing conventions for the guides that use these:
//   - `math` is KaTeX, so backslashes are doubled inside template literals.
//   - Inline maths in prose is plain Unicode (Σ, δ, ε, ⊆, ⊊, ∅), which avoids
//     KaTeX's `$` delimiters firing inside ordinary sentences.
//   - No outside sources are cited. Everything a reader needs is in the page.

export const p = x => ({ t: 'p', x });

export const ul = (...items) => ({ t: 'ul', x: items });

export const math = x => ({ t: 'math', x });

// Several lines in one box. Two adjacent `math` blocks would draw two boxes,
// which reads as two unrelated statements rather than one definition.
export const mathLines = (...lines) =>
  math(`\\begin{gathered}${lines.join(' \\\\[5pt] ')}\\end{gathered}`);

export const note = x => ({ t: 'note', x });

// `head` is a row of column labels; each row is a list of cells. A cell is
// either a string or {v, k} where k tags the verdict for colour — 'yes',
// 'no', 'semi', or 'na'. The first column of each row is rendered as a header
// cell, because every table in the guides is keyed by class or problem.
export const table = (head, ...rows) => ({ t: 'table', head, rows });

export const sec = (h, ...blocks) => ({ h, blocks });

// Verdict cell shorthands, so a table row reads as its content rather than as
// object literals.
export const yes = v => ({ v, k: 'yes' });
export const no = v => ({ v, k: 'no' });
export const semi = v => ({ v, k: 'semi' });
export const na = (v = '—') => ({ v, k: 'na' });
