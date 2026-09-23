// ══════════════════════════════════════════════════════════════════
//  LEXER REGULAR EXPRESSIONS
// ══════════════════════════════════════════════════════════════════
// The pattern language of the lexer generator. Import-free and App-free.
//
// It is not `parseRE` in js/algorithms-fa.js, and the difference is the
// reason it exists. That one reads the textbook notation over Σ — no
// escapes, `.` meaning "any symbol of the alphabet", ε written as ε — which
// is the right language for drawing Thompson's construction and the wrong
// one for a lexer, whose rules are about *characters*: `\(`, `\n`, `\d`,
// `[^"\\]` are unavoidable in the first five rules anyone writes. Growing
// escapes into the textbook parser would change what an existing regex
// means in the Algorithms view; a second, small parser changes nothing.
//
// Syntax — the common subset of every regex dialect a working programmer
// already reads, minus what has no meaning in a lexer:
//
//   a|b  ab  a*  a+  a?  a{n}  a{n,}  a{n,m}  (a)  (?:a)
//   [abc]  [a-z]  [^"\\]  .  \d \w \s \D \W \S  \n \t \r \f \v \0
//   \xHH  \uHHHH  \u{H…}  \<punctuation>
//
// Refused, each with a sentence saying why: anchors (a rule always matches
// at the current position, so ^ says nothing and $ is not a character),
// lazy quantifiers (the lexer takes the longest match; laziness is a
// backtracking engine's idea), backreferences and lookaround (not regular).
//
// The AST is four node kinds:
//   { t: 'set', cps: number[], neg: boolean }   one character from a set
//   { t: 'eps' }                                the empty string
//   { t: 'cat', parts: Node[] }  { t: 'alt', parts: Node[] }
//   { t: 'rep', c: Node, min: number, max: number }   max = Infinity
// `.` is `{ t: 'set', cps: [10], neg: true }`: everything but a newline,
// resolved against the lexer's universe of characters when it is built.

export class RegexError extends Error {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}

const cp = ch => ch.codePointAt(0);
const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };

const DIGIT = range(48, 57);
const WORD = [...range(48, 57), ...range(65, 90), 95, ...range(97, 122)];
const SPACE = [9, 10, 11, 12, 13, 32];

const CLASS_ESCAPES = {
  d: { cps: DIGIT, neg: false }, D: { cps: DIGIT, neg: true },
  w: { cps: WORD, neg: false }, W: { cps: WORD, neg: true },
  s: { cps: SPACE, neg: false }, S: { cps: SPACE, neg: true }
};
const CHAR_ESCAPES = { n: 10, t: 9, r: 13, f: 12, v: 11, 0: 0 };

/** Pattern text → AST. Throws RegexError with the index of the offending character. */
export function parseLexerRegex(src) {
  const chars = Array.from(String(src));
  let pos = 0;
  const peek = () => chars[pos];
  const done = () => pos >= chars.length;
  const fail = (msg, at = pos) => { throw new RegexError(msg, at); };

  function hex(n) {
    const s = chars.slice(pos, pos + n).join('');
    if (s.length !== n || !/^[0-9a-fA-F]+$/.test(s)) fail(`expected ${n} hex digits`);
    pos += n;
    return parseInt(s, 16);
  }

  // After the backslash. Returns a code point, or a class set when `sets`.
  function escape(sets) {
    if (done()) fail('a pattern cannot end with a backslash', pos - 1);
    const c = chars[pos++];
    if (CLASS_ESCAPES[c]) {
      if (!sets) fail(`\\${c} is a set of characters and cannot be one end of a range`, pos - 2);
      return { set: CLASS_ESCAPES[c] };
    }
    if (c in CHAR_ESCAPES) return CHAR_ESCAPES[c];
    if (c === 'x') return hex(2);
    if (c === 'u') {
      if (peek() === '{') {
        const close = chars.indexOf('}', pos);
        if (close < 0) fail("expected '}' to close \\u{…}");
        const s = chars.slice(pos + 1, close).join('');
        if (!/^[0-9a-fA-F]{1,6}$/.test(s) || parseInt(s, 16) > 0x10FFFF) fail('not a code point', pos);
        pos = close + 1;
        return parseInt(s, 16);
      }
      return hex(4);
    }
    if (c === 'b' || c === 'B') fail('word boundaries are not supported: a lexer rule is matched at the current position', pos - 2);
    if (/[1-9]/.test(c)) fail('backreferences are not regular, so a lexer cannot have them', pos - 2);
    if (/[A-Za-z0-9]/.test(c)) fail(`unknown escape \\${c}`, pos - 2);
    return cp(c);
  }

  function parseClass() {
    const start = pos - 1;
    const neg = peek() === '^' ? (pos++, true) : false;
    const pos_ = [];
    const neg_ = [];
    let first = true;
    while (true) {
      if (done()) fail("expected ']' to close the character class", start);
      let c = chars[pos];
      if (c === ']' && !first) { pos++; break; }
      first = false;
      pos++;
      let lo;
      if (c === '\\') {
        const e = escape(true);
        if (typeof e === 'object') { (e.set.neg ? neg_ : pos_).push(e.set.cps); continue; }
        lo = e;
      } else lo = cp(c);
      if (peek() === '-' && chars[pos + 1] !== undefined && chars[pos + 1] !== ']') {
        pos++;
        let hi;
        const d = chars[pos++];
        if (d === '\\') {
          const e = escape(false);
          hi = e;
        } else hi = cp(d);
        if (hi < lo) fail(`the range ${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)} is backwards`, pos - 3);
        if (hi - lo > 0x10000) fail('that range is too large for a lexer table', pos - 3);
        pos_.push(range(lo, hi));
      } else pos_.push([lo]);
    }
    if (neg_.length) {
      // [\D] or [a\S]: a union with a complement. Kept exact by carrying it
      // as a complement of what is excluded from every part.
      if (neg) fail('a negated class cannot contain \\D, \\W or \\S', start);
      const excluded = neg_.map(s => new Set(s));
      const inAll = [...excluded[0]].filter(c => excluded.every(s => s.has(c)));
      const kept = new Set(pos_.flat());
      return { t: 'set', cps: inAll.filter(c => !kept.has(c)), neg: true };
    }
    return { t: 'set', cps: [...new Set(pos_.flat())], neg };
  }

  function parseAtom() {
    const c = chars[pos];
    if (c === '(') {
      const open = pos++;
      if (peek() === '?') {
        if (chars[pos + 1] === ':') pos += 2;
        else fail('lookaround and named groups are not supported; (?:…) is the only group modifier', open);
      }
      const inner = parseAlt();
      if (peek() !== ')') fail("expected ')'", open);
      pos++;
      return inner;
    }
    if (c === '[') { pos++; return parseClass(); }
    if (c === '.') { pos++; return { t: 'set', cps: [10], neg: true }; }
    if (c === '\\') {
      pos++;
      const e = escape(true);
      return typeof e === 'object' ? { t: 'set', cps: e.set.cps, neg: e.set.neg } : { t: 'set', cps: [e], neg: false };
    }
    if (c === '^' || c === '$') fail(`anchors are not supported: every rule is matched at the current position. Write \\${c} for the character`);
    if (c === '*' || c === '+' || c === '?') fail(`nothing before '${c}' to repeat`);
    if (c === '{' && /^\{\d/.test(chars.slice(pos, pos + 2).join(''))) fail("nothing before '{' to repeat");
    if (c === ')') fail("unmatched ')'");
    pos++;
    return { t: 'set', cps: [cp(c)], neg: false };
  }

  function parseQuant(node) {
    while (!done()) {
      const c = peek();
      let min, max;
      const at = pos;
      if (c === '*') { min = 0; max = Infinity; pos++; }
      else if (c === '+') { min = 1; max = Infinity; pos++; }
      else if (c === '?') { min = 0; max = 1; pos++; }
      else if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(chars.slice(pos, pos + 16).join(''));
        if (!m) break; // a literal brace
        min = +m[1];
        max = m[2] === undefined ? min : (m[3] === '' ? Infinity : +m[3]);
        if (max < min) fail(`{${min},${max}} has its bounds the wrong way round`, at);
        if (Math.max(min, max === Infinity ? 0 : max) > 255) fail('repetition counts above 255 are not supported', at);
        pos += m[0].length;
      } else break;
      if (peek() === '?') fail('lazy quantifiers do not apply: a lexer always takes the longest match');
      node = { t: 'rep', c: node, min, max };
    }
    return node;
  }

  function parseCat() {
    const parts = [];
    while (!done() && peek() !== '|' && peek() !== ')') parts.push(parseQuant(parseAtom()));
    if (!parts.length) return { t: 'eps' };
    return parts.length === 1 ? parts[0] : { t: 'cat', parts };
  }

  function parseAlt() {
    const parts = [parseCat()];
    while (peek() === '|') { pos++; parts.push(parseCat()); }
    return parts.length === 1 ? parts[0] : { t: 'alt', parts };
  }

  if (!chars.length) throw new RegexError('the pattern is empty', 0);
  const ast = parseAlt();
  if (!done()) fail("unmatched ')'");
  return ast;
}

/** Every code point a pattern names positively — the non-ASCII ones extend the universe. */
export function literalCodePoints(ast, out = new Set()) {
  if (ast.t === 'set' && !ast.neg) ast.cps.forEach(c => out.add(c));
  else if (ast.t === 'set') ast.cps.forEach(c => out.add(c));
  else if (ast.t === 'cat' || ast.t === 'alt') ast.parts.forEach(p => literalCodePoints(p, out));
  else if (ast.t === 'rep') literalCodePoints(ast.c, out);
  return out;
}
