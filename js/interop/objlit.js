// ══════════════════════════════════════════════════════════════════
//  A JAVASCRIPT OBJECT LITERAL, READ AS DATA
// ══════════════════════════════════════════════════════════════════
// Import-free. What an XState machine is written as, in the wild, is not
// JSON: unquoted keys, single quotes, trailing commas, comments — and values
// that are *code*, because a statechart's guards and actions are functions:
//
//   createMachine({
//     initial: 'idle',
//     states: { idle: { on: { FETCH: { target: 'loading', actions: assign({…}) } } } }
//   })
//
// The structure is all a flattener needs, and it is all literal. So this
// reads the literal parts exactly and captures every other value as
// `{ __expr: '<source text>' }`, skipped by bracket-balancing to the next
// separator — never evaluated. Running someone's file to read its shape
// would mean running their `assign()` too.

export class LiteralError extends Error {
  constructor(message, index) { super(message); this.index = index; }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

export function parseJsLiteral(src, start = 0) {
  let pos = start;
  const fail = (msg, at = pos) => { throw new LiteralError(msg, at); };

  function ws() {
    while (pos < src.length) {
      const c = src[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') pos++;
      else if (c === '/' && src[pos + 1] === '/') { while (pos < src.length && src[pos] !== '\n') pos++; }
      else if (c === '/' && src[pos + 1] === '*') {
        const end = src.indexOf('*/', pos + 2);
        if (end < 0) fail('unterminated comment');
        pos = end + 2;
      } else break;
    }
  }

  function string() {
    const q = src[pos++];
    let out = '';
    while (true) {
      if (pos >= src.length) fail('unterminated string');
      const c = src[pos++];
      if (c === q) return out;
      if (q === '`' && c === '$' && src[pos] === '{') return null; // a template with code in it
      if (c === '\\') {
        const e = src[pos++];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
        if (e in map) out += map[e];
        else if (e === 'u') {
          if (src[pos] === '{') { const end = src.indexOf('}', pos); out += String.fromCodePoint(parseInt(src.slice(pos + 1, end), 16)); pos = end + 1; }
          else { out += String.fromCharCode(parseInt(src.slice(pos, pos + 4), 16)); pos += 4; }
        } else if (e === 'x') { out += String.fromCharCode(parseInt(src.slice(pos, pos + 2), 16)); pos += 2; }
        else if (e === '\n') { /* line continuation */ }
        else out += e;
      } else out += c;
    }
  }

  // Skip an expression we will not interpret: up to the next , } or ] at
  // bracket depth zero, stepping over strings and comments on the way.
  function skipExpr() {
    const from = pos;
    let depth = 0;
    while (pos < src.length) {
      const c = src[pos];
      if (c === '"' || c === "'" || c === '`') { const q = c; pos++; while (pos < src.length && src[pos] !== q) { if (src[pos] === '\\') pos++; pos++; } pos++; continue; }
      if (c === '/' && (src[pos + 1] === '/' || src[pos + 1] === '*')) { ws(); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      pos++;
    }
    return { __expr: src.slice(from, pos).trim() };
  }

  function key() {
    ws();
    const c = src[pos];
    if (c === '"' || c === "'") { const k = string(); if (k === null) fail('a key cannot be a template'); return k; }
    if (c === '[') fail('computed keys are not supported');
    if (IDENT_START.test(c) || /[0-9]/.test(c)) {
      const from = pos;
      while (pos < src.length && IDENT_PART.test(src[pos])) pos++;
      return src.slice(from, pos);
    }
    fail(`expected a key, found ${JSON.stringify(c || 'end of input')}`);
  }

  function object() {
    pos++; // {
    const out = {};
    while (true) {
      ws();
      if (src[pos] === '}') { pos++; return out; }
      if (src.startsWith('...', pos)) { pos += 3; skipExpr(); }
      else {
        const k = key();
        ws();
        if (src[pos] === ':') { pos++; out[k] = value(); }
        else if (src[pos] === '(') { skipExpr(); out[k] = { __expr: 'method' }; } // foo() { … }
        else out[k] = { __expr: k }; // shorthand { foo }
      }
      ws();
      if (src[pos] === ',') { pos++; continue; }
      if (src[pos] === '}') { pos++; return out; }
      fail("expected ',' or '}'");
    }
  }

  function array() {
    pos++; // [
    const out = [];
    while (true) {
      ws();
      if (src[pos] === ']') { pos++; return out; }
      out.push(value());
      ws();
      if (src[pos] === ',') { pos++; continue; }
      if (src[pos] === ']') { pos++; return out; }
      fail("expected ',' or ']'");
    }
  }

  function value() {
    ws();
    const c = src[pos];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"' || c === "'" || c === '`') {
      const at = pos;
      const s = string();
      if (s !== null) {
        ws();
        // 'a' + b is an expression, not a literal.
        if (src[pos] === ',' || src[pos] === '}' || src[pos] === ']' || pos >= src.length) return s;
      }
      pos = at;
      return skipExpr();
    }
    const m = /^-?(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(src.slice(pos, pos + 40));
    if (m) {
      const after = src[pos + m[0].length];
      if (after === undefined || /[\s,}\]]/.test(after)) { pos += m[0].length; return Number(m[0]); }
    }
    for (const [word, v] of [['true', true], ['false', false], ['null', null], ['undefined', undefined]]) {
      if (src.startsWith(word, pos) && !IDENT_PART.test(src[pos + word.length] || '')) {
        const at = pos;
        pos += word.length;
        ws();
        if (src[pos] === ',' || src[pos] === '}' || src[pos] === ']' || pos >= src.length) return v;
        pos = at;
        break;
      }
    }
    if (pos >= src.length) fail('unexpected end of input');
    return skipExpr();
  }

  ws();
  if (src[pos] !== '{' && src[pos] !== '[') fail('expected an object literal');
  const v = value();
  return { value: v, end: pos };
}

/**
 * The machine config out of a source file: JSON, or the object literal handed
 * to `createMachine(…)`, or the one after `export default` / `= `. Throws a
 * LiteralError naming what it looked for.
 */
export function extractMachineLiteral(text) {
  const src = String(text);
  const trimmed = src.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* relaxed syntax below */ }
    return parseJsLiteral(trimmed).value;
  }
  const call = /\bcreateMachine\s*\(\s*\{/.exec(src);
  if (call) return parseJsLiteral(src, call.index + call[0].length - 1).value;
  // Anchored to a declaration at the start of a line, so an `=` in a banner
  // comment above it (codegenXState writes one) is not taken for it.
  const assign = /^[ \t]*(?:export\s+default|(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=|module\.exports\s*=)\s*\{/m.exec(src);
  if (assign) return parseJsLiteral(src, assign.index + assign[0].length - 1).value;
  throw new LiteralError('no createMachine({ … }) call or exported object literal was found', 0);
}
