// ══════════════════════════════════════════════════════════════════
//  THE GRAMMAR PARSER
// ══════════════════════════════════════════════════════════════════
//  Import-free and App-free — ε arrives as an option — so the parser can be
//  driven from a test with nothing else loaded.
//
//  **Tokenization is declared rather than guessed, and that is the whole
//  reason this module exists.** The old `tokenizeRHS` matched right-hand
//  sides against a variable set that was still being filled *by the same
//  loop*, so the meaning of a line depended on which lines came before it:
//  `S → AB` written above `AB → a` tokenized to two symbols, and written
//  below it to one. A grammar whose meaning changes when you reorder its
//  rules is not a grammar.
//
//  The rule, in order of precedence:
//
//    1. A bracket form — `[q0,A,q1]` or `<Expr>` — is always exactly one
//       symbol. The first is what the PDA → CFG construction emits and the
//       second is how a reader writes a multi-character name that would
//       otherwise collide.
//    2. Whitespace separates symbols. `A B` is two symbols wherever it
//       appears, which is how a context-sensitive left-hand side is written.
//    3. Inside a run with no whitespace, the longest symbol in the known
//       vocabulary wins; anything unmatched is a single character.
//
//  The vocabulary is complete before any right-hand side is read, because it
//  is built from a full first pass over every left-hand side. That is the
//  ordering fix: pass A can only see left-hand sides, and a left-hand side is
//  tokenized against the whitespace-free left-hand sides alone, so it has no
//  dependency on the rules below it either.

const COMMENT = /^\s*(?:\/\/|#|%)/;

export const DEFAULT_EPS = 'ε';
const EPS_WORDS = new Set(['eps', 'epsilon', 'lambda']);

/** The empty string, however it was written. `∅` is deliberately not it. */
export function meansEmpty(raw, eps = DEFAULT_EPS) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return true;
  if (s === eps || s === 'ε' || s === 'λ') return true;
  return EPS_WORDS.has(s.toLowerCase());
}

// ── Symbols ───────────────────────────────────────────────────────

/** Reads a bracket form starting at i, or null. Never spans a line break. */
function readBracket(str, i) {
  const close = str[i] === '[' ? ']' : str[i] === '<' ? '>' : null;
  if (!close) return null;
  const j = str.indexOf(close, i + 1);
  if (j < 0) return null;
  return { sym: str.slice(i, j + 1), next: j + 1 };
}

/**
 * str -> [symbol]. `vocab` is an iterable of known multi-character symbols;
 * longest wins, which is what makes `Expr` one symbol rather than four.
 */
export function tokenizeSymbols(str, vocab = []) {
  const s = String(str == null ? '' : str);
  const known = [...vocab].filter(v => v && v.length > 1).sort((a, b) => b.length - a.length);
  const out = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === ' ' || ch === '	') { i++; continue; }
    const br = readBracket(s, i);
    if (br) { out.push(br.sym); i = br.next; continue; }
    const hit = known.find(v => s.startsWith(v, i));
    if (hit) { out.push(hit); i += hit.length; continue; }
    out.push(ch);
    i++;
  }
  return out;
}

/**
 * V, from the left-hand sides — which is **not** every symbol that appears on
 * one.
 *
 * In a Type 1 grammar a left-hand side is αAβ, and α and β are ordinarily
 * *terminals*: `a B → a b` says B may be rewritten after an a, and nothing
 * whatever about a. Counting every left-hand symbol put a, b and c into V for
 * the bundled aⁿbⁿcⁿ grammar, which left Σ(G) empty — so the Rules view
 * coloured its terminals as variables, the footer read V 6 Σ 0, and every
 * word tool refused the example's own test words as symbols the grammar had
 * never heard of.
 *
 * So a symbol earns V structurally where the text says so: by standing as a
 * whole left-hand side, or by being a bracket form, which is how a name is
 * written. Inside a longer left-hand side there is no structural signal left
 * and the reader's own convention is all there is to read — an initial
 * capital. That last one is a guess, so it is returned separately and
 * announced, exactly the way the multi-character terminal rule is.
 *
 * Exported because `readGrammar` has to reach the same answer from the
 * persisted productions: written twice, the editor and the reload disagreed
 * about V, and a saved context-sensitive grammar came back with its terminals
 * in it.
 */
export function deriveVars(lhsArrays, seed = []) {
  const vars = new Set(seed);
  lhsArrays.forEach(a => { if (a && a.length === 1) vars.add(a[0]); });
  const guessed = new Set();
  lhsArrays.forEach(a => {
    if (!a || a.length < 2) return;
    a.forEach(sym => {
      if (vars.has(sym) || !/^[A-Z]/.test(sym)) return;
      vars.add(sym);
      guessed.add(sym);
    });
  });
  return { vars, guessed };
}

/** Every bracket form anywhere in the text — vocabulary, before any rule. */
function bracketForms(text) {
  const found = new Set();
  const rx = /\[[^\]\r\n]*\]|<[^>\r\n]*>/g;
  let m;
  while ((m = rx.exec(text))) found.add(m[0]);
  return found;
}

// ── Lines ─────────────────────────────────────────────────────────

function splitArrow(line) {
  const m = /-{1,2}>|→|::=|=>|:-/.exec(line);
  if (!m) return null;
  return { lhs: line.slice(0, m.index), rhs: line.slice(m.index + m[0].length) };
}

/**
 * text -> { rules, vars, start, diagnostics }.
 *
 * A rule is { id, lhs, lhsArr, rhs, rhsArr, line } — `lhs`/`rhs` the display
 * strings and the `*Arr` the tokens. That is a superset of the persisted
 * shape ({lhs, rhs, rhsArr}), so the save format is untouched.
 */
export function parseGrammarText(text, opts = {}) {
  const eps = opts.eps || DEFAULT_EPS;
  const src = String(text == null ? '' : text);
  const lines = src.split('\n');
  const diagnostics = [];
  const brackets = bracketForms(src);

  // ── Pass A: the vocabulary, from left-hand sides only ────────────
  const raw = [];
  lines.forEach((line, i) => {
    if (!line.trim() || COMMENT.test(line)) return;
    const parts = splitArrow(line);
    if (!parts) {
      diagnostics.push({
        line: i + 1, kind: 'error',
        msg: 'No arrow on this line. A rule looks like <code>S → a S b</code> — type <code>-&gt;</code> if you have no arrow key.'
      });
      return;
    }
    if (!parts.lhs.trim()) {
      diagnostics.push({ line: i + 1, kind: 'error', msg: 'Nothing on the left of the arrow.' });
      return;
    }
    raw.push({ line: i + 1, lhsRaw: parts.lhs.trim(), rhsRaw: parts.rhs.trim() });
  });

  const lhsVocab = new Set(brackets);
  raw.forEach(r => { if (!/\s/.test(r.lhsRaw)) lhsVocab.add(r.lhsRaw); });

  raw.forEach(r => { r.lhsArr = tokenizeSymbols(r.lhsRaw, lhsVocab); });

  const { vars, guessed: guessedVars } = deriveVars(raw.map(r => r.lhsArr), brackets);
  guessedVars.forEach(v => diagnostics.push({
    line: 0, kind: 'info',
    msg: `<code>${v}</code> is read as a variable. It only appears inside a longer left-hand side, where nothing in the text says which symbols are variables, so the capital is what decides — give it a rule of its own to say so outright.`
  }));

  // ── Multi-character terminals ────────────────────────────────────
  // `F → ( E ) | id` is the commonest grammar in every textbook, and reading
  // `id` as two symbols makes it a grammar over {i, d} that no reader wrote.
  // So a whitespace-isolated alphanumeric run longer than one character, in
  // which no declared variable appears, is one terminal. The condition is
  // what keeps `aSb` splitting: S occurs inside it.
  //
  // The rule can still be wrong — `S → a S b | ab` gets one terminal `ab`
  // where two were probably meant — so it is *announced* rather than applied
  // silently, and writing `a b` is the way to say the other thing.
  const varList = [...vars].filter(Boolean);
  const promoted = new Set();
  raw.forEach(r => {
    r.rhsRaw.split('|').forEach(alt => {
      alt.trim().split(/\s+/).forEach(run => {
        if (run.length < 2 || !/^[A-Za-z0-9_]+$/.test(run)) return;
        if (meansEmpty(run, eps)) return;
        if (vars.has(run) || varList.some(v => run.includes(v))) return;
        promoted.add(run);
      });
    });
  });
  promoted.forEach(t => diagnostics.push({
    line: 0, kind: 'info',
    msg: `<code>${t}</code> is read as one terminal. Write <code>${t.split('').join(' ')}</code> for ${t.length} separate symbols.`
  }));

  // ── Pass B: right-hand sides, against the complete vocabulary ────
  const vocab = new Set([...vars, ...brackets, ...promoted]);
  const rules = [];
  const seen = new Set();
  let n = 0;

  raw.forEach(r => {
    if (r.rhsRaw === '') {
      diagnostics.push({
        line: r.line, kind: 'error',
        msg: `Nothing on the right of the arrow. Write <code>${eps}</code> if this rule derives the empty string.`
      });
      return;
    }
    r.rhsRaw.split('|').forEach(alt => {
      const trimmed = alt.trim();
      if (!trimmed) {
        diagnostics.push({
          line: r.line, kind: 'error',
          msg: `Empty alternative — a <code>|</code> with nothing beside it. Write <code>${eps}</code> for the empty string.`
        });
        return;
      }
      const empty = meansEmpty(trimmed, eps);
      const tokens = empty ? [] : tokenizeSymbols(trimmed, vocab);
      // ε inside a longer right-hand side is the reader meaning "nothing
      // here", and silently keeping it would put a symbol in Σ that no word
      // can ever contain.
      const cleaned = tokens.filter(sym => !meansEmpty(sym, eps));
      if (!empty && cleaned.length !== tokens.length) {
        diagnostics.push({
          line: r.line, kind: 'warn',
          msg: `<code>${eps}</code> inside a longer right-hand side means nothing and was dropped.`
        });
      }
      const key = `${r.lhsArr.join(' ')} ${cleaned.join(' ')}`;
      if (seen.has(key)) {
        diagnostics.push({ line: r.line, kind: 'warn', msg: 'This rule repeats one written above.' });
        return;
      }
      seen.add(key);
      rules.push({
        id: 'r' + (++n),
        line: r.line,
        lhs: r.lhsArr.join(' '),
        lhsArr: r.lhsArr,
        rhs: cleaned.length ? cleaned.join(' ') : eps,
        rhsArr: cleaned
      });
    });
  });

  const start = raw.length ? (raw[0].lhsArr[0] || '') : '';
  return { rules, vars, start, diagnostics };
}

// ── Back to text ──────────────────────────────────────────────────

/**
 * Rules -> the canonical source, start symbol first. Tokens are joined with
 * a space, which round-trips exactly (whitespace is the first tokenizer rule)
 * and is the only spelling that stays right when a symbol is multi-character.
 */
export function formatRules(rules, start, eps = DEFAULT_EPS) {
  const order = [];
  const byLhs = new Map();
  rules.forEach(r => {
    const key = r.lhs != null ? r.lhs : (r.lhsArr || []).join(' ');
    if (!byLhs.has(key)) { byLhs.set(key, []); order.push(key); }
    byLhs.get(key).push(r.rhsArr && r.rhsArr.length ? r.rhsArr.join(' ') : eps);
  });
  return [...order.filter(k => k === start), ...order.filter(k => k !== start)]
    .map(k => `${k} → ${byLhs.get(k).join(' | ')}`)
    .join('\n');
}
