// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — SHAPES
// ══════════════════════════════════════════════════════════════════
// A shape says what a machine is made of, and that is enough to number every
// machine it describes 0, 1, 2, … with no gaps. Eight parts, each of which
// knows how many objects it has at each *size*:
//
//   fin(k)          one of k choices — a target state, a letter, a move  size 0
//   nat()           0, 1, 2, … — a priority                              its value
//   bits(n)         a subset of a fixed n-element set, as n bits         size 0
//   seq(A)          a string of A's — a push string, an output word      length + items
//   tuple(A, B, …)  one of each                                          the sum
//   oneOf(A, B, …)  a tagged choice                                      the chosen one's
//   option(A)       nothing, or an A                                     0, or A's
//   table(n, A)     n A's in a row — δ over Q × Σ                        the sum
//   subset(A)       a finite set of A's                                  members + 1 each
//   fraction()      a rational in lowest terms                           denominator − 1
//   distribution(n) n rational weights summing to 1 — a PFA's row        common denominator − 1
//
// Every shape answers four questions, all in BigInt:
//
//   count(s)        how many objects of size exactly s
//   unrank(s, r)    the r-th object of size s
//   rank(v)         { s, r } — an object's size and its rank at that size
//   finite          true when every object has size 0
//
// A finite shape is a mixed-radix number: its parts are digits, the first part
// the least significant. That is the fast path DFAs, NFAs and Turing machines
// take, and it is what makes F the lowest digits of a DFA's number — the room's
// map is then striped by acceptance, and the next volume over usually differs
// in what it accepts before it differs in shape. A graded shape (one with a
// seq, nat, fraction or a subset of a graded set in it) is ordered by size
// first, so every object still has a finite number however large the room is.
//
// The recursive method is Nijenhuis and Wilf's; sampling a graded room at a
// chosen size is a uniform draw below count(s), which is the same thing a
// Boltzmann sampler approximates and here can be done exactly.
//
// Import-free and DOM-free: the worker, the website and the command line read
// it as it is.

const ZERO = 0n;
const ONE = 1n;

/** Counts by size, computed once each, in order, for a shape whose count(s) reads its own lower sizes. */
function memo(fn) {
  const cache = [];
  return s => {
    if (s < 0) return ZERO;
    while (cache.length <= s) cache.push(fn(cache.length, cache));
    return cache[s];
  };
}

function badValue(what) {
  return new RangeError(`Not a value of this shape: ${what}`);
}

// ── Leaves ────────────────────────────────────────────────────────

/** One of k choices, 0 … k−1. */
export function fin(k) {
  if (!(Number.isInteger(k) && k >= 1)) throw new RangeError(`fin(${k})`);
  const K = BigInt(k);
  return {
    part: 'fin', finite: true, total: K, k,
    count: s => (s === 0 ? K : ZERO),
    unrank: (s, r) => Number(r),
    rank: v => {
      if (!(Number.isInteger(v) && v >= 0 && v < k)) throw badValue(v);
      return { s: 0, r: BigInt(v) };
    },
    radices: () => [K]
  };
}

/** 0, 1, 2, … — the number n has size n, and is the only object of that size. */
export function nat() {
  return {
    part: 'nat', finite: false,
    count: s => (s >= 0 ? ONE : ZERO),
    unrank: s => s,
    rank: v => {
      if (!(Number.isInteger(v) && v >= 0)) throw badValue(v);
      return { s: v, r: ZERO };
    }
  };
}

/** A subset of n fixed things, as an array of n 0/1 digits; bit i is worth 2^i. */
export function bits(n) {
  if (!(Number.isInteger(n) && n >= 0)) throw new RangeError(`bits(${n})`);
  const total = ONE << BigInt(n);
  return {
    part: 'bits', finite: true, total, n,
    count: s => (s === 0 ? total : ZERO),
    unrank: (s, r) => {
      const out = new Array(n).fill(0);
      const str = r.toString(2);
      for (let i = 0; i < str.length && i < n; i++) out[i] = str.charCodeAt(str.length - 1 - i) === 49 ? 1 : 0;
      return out;
    },
    rank: v => {
      if (!Array.isArray(v) || v.length !== n) throw badValue('bits');
      if (!n) return { s: 0, r: ZERO };
      let str = '';
      for (let i = n - 1; i >= 0; i--) str += v[i] ? '1' : '0';
      return { s: 0, r: BigInt(`0b${str}`) };
    },
    radices: () => new Array(n).fill(2n)
  };
}

// ── Mixed radix: the finite products ─────────────────────────────

// A long number is split in halves, not peeled a digit at a time: peeling
// divides the whole number once per digit, which is quadratic in its length —
// 2.5 s for one volume of a 300-state DFA room, and the deep map reads hundreds.
// Halving divides by the product of the low half's radices and recurses, so
// the work is a few big divisions (fast in V8) instead of a long row of small
// ones. Short runs keep the plain loop. The digits are the same either way.
const SPLIT_FROM = 48;

/** The product of radices[lo … hi). */
export function radixProduct(radices, lo = 0, hi = radices.length) {
  if (hi - lo <= 16) {
    let p = ONE;
    for (let i = lo; i < hi; i++) p *= radices[i];
    return p;
  }
  const mid = (lo + hi) >> 1;
  return radixProduct(radices, lo, mid) * radixProduct(radices, mid, hi);
}

/**
 * The products of a row's first i entries, worked out when asked — from the
 * nearest one already known, by a short multiply or division — and only a few
 * kept: a row as long as a big room's number has a product per entry as long
 * as the number, which held all at once is the square of its length.
 * `whole`, when known, is the product of the entire row.
 */
export function prefixProducts(row, whole = null) {
  const n = row.length;
  const known = new Map([[0, ONE]]);
  if (whole !== null) known.set(n, whole);
  return i => {
    let v = known.get(i);
    if (v !== undefined) return v;
    let near = 0;
    for (const k of known.keys()) if (Math.abs(k - i) < Math.abs(near - i)) near = k;
    v = near < i ? known.get(near) * radixProduct(row, near, i) : known.get(near) / radixProduct(row, i, near);
    if (known.size > 72) for (const k of known.keys()) { if (k !== 0 && k !== n) { known.delete(k); break; } }
    known.set(i, v);
    return v;
  };
}

/** Digits → number, the first digit least significant. */
function fromDigits(digits, radices, lo = 0, hi = digits.length) {
  if (hi - lo <= SPLIT_FROM) {
    let r = ZERO;
    for (let i = hi - 1; i >= lo; i--) r = r * radices[i] + digits[i];
    return r;
  }
  const mid = (lo + hi) >> 1;
  return fromDigits(digits, radices, lo, mid) + radixProduct(radices, lo, mid) * fromDigits(digits, radices, mid, hi);
}

/** Number → digits under the given radices, the first least significant. */
function toDigits(r, radices) {
  const out = new Array(radices.length);
  digitsInto(out, r, radices, 0, radices.length);
  return out;
}

// The last digit takes whatever is left modulo its radix, as the loop always did.
function digitsInto(out, r, radices, lo, hi) {
  if (hi - lo <= SPLIT_FROM) {
    for (let i = lo; i < hi; i++) {
      const b = radices[i];
      out[i] = r % b;
      r /= b;
    }
    return;
  }
  const mid = (lo + hi) >> 1;
  const P = radixProduct(radices, lo, mid);
  digitsInto(out, r % P, radices, lo, mid);
  digitsInto(out, r / P, radices, mid, hi);
}

/** A finite product of finite parts: one digit per part. */
function finiteTuple(parts) {
  const totals = parts.map(p => p.total);
  const total = totals.reduce((a, b) => a * b, ONE);
  return {
    part: 'tuple', finite: true, total, parts,
    count: s => (s === 0 ? total : ZERO),
    unrank: (s, r) => toDigits(r, totals).map((d, i) => parts[i].unrank(0, d)),
    rank: v => {
      if (!Array.isArray(v) || v.length !== parts.length) throw badValue('tuple');
      return { s: 0, r: fromDigits(v.map((x, i) => parts[i].rank(x).r), totals) };
    },
    radices: () => parts.flatMap(p => (p.radices ? p.radices() : [p.total]))
  };
}

// ── Graded products ───────────────────────────────────────────────

/**
 * A pair (A, B) ordered by total size, then by A's size, then with A's rank the
 * low digit: r = rA + count_A(sA) · rB. The low-digit convention is the finite
 * tuple's, so a product whose graded parts happen to sit at size 0 numbers its
 * objects exactly as the mixed-radix path would.
 */
function pair(A, B) {
  const count = memo(s => {
    let c = ZERO;
    for (let a = 0; a <= s; a++) {
      const ca = A.count(a);
      if (ca) c += ca * B.count(s - a);
    }
    return c;
  });
  return {
    part: 'pair', finite: false, A, B, count,
    unrank(s, r) {
      for (let a = 0; a <= s; a++) {
        const ca = A.count(a);
        if (!ca) continue;
        const cb = B.count(s - a);
        const block = ca * cb;
        if (r < block) return [A.unrank(a, r % ca), B.unrank(s - a, r / ca)];
        r -= block;
      }
      throw new RangeError('rank past the end of this size');
    },
    rank([va, vb]) {
      const ra = A.rank(va), rb = B.rank(vb);
      const s = ra.s + rb.s;
      let off = ZERO;
      for (let a = 0; a < ra.s; a++) off += A.count(a) * B.count(s - a);
      return { s, r: off + ra.r + A.count(ra.s) * rb.r };
    }
  };
}

/** One of each part, in order. A finite tuple is a mixed-radix number, its first part the low digit. */
export function tuple(...parts) {
  if (parts.length === 1 && Array.isArray(parts[0])) parts = parts[0];
  if (!parts.length) return finiteTuple([]);
  if (parts.every(p => p.finite)) return finiteTuple(parts);
  if (parts.length === 1) {
    const [P] = parts;
    return { part: 'tuple', finite: false, count: P.count, unrank: (s, r) => [P.unrank(s, r)], rank: v => P.rank(v[0]) };
  }
  const head = parts[0], rest = tuple(parts.slice(1));
  const p = pair(head, rest);
  return {
    part: 'tuple', finite: false, parts,
    count: p.count,
    unrank: (s, r) => { const [a, b] = p.unrank(s, r); return [a, ...b]; },
    rank: v => {
      if (!Array.isArray(v) || v.length !== parts.length) throw badValue('tuple');
      return p.rank([v[0], v.slice(1)]);
    }
  };
}

/** n A's in a row. */
export function table(n, A) {
  if (!(Number.isInteger(n) && n >= 0)) throw new RangeError(`table(${n})`);
  if (A.finite) {
    const B = A.total;
    const total = B ** BigInt(n);
    return {
      part: 'table', finite: true, total, n, of: A,
      count: s => (s === 0 ? total : ZERO),
      unrank: (s, r) => toDigits(r, new Array(n).fill(B)).map(d => A.unrank(0, d)),
      rank: v => {
        if (!Array.isArray(v) || v.length !== n) throw badValue('table');
        return { s: 0, r: fromDigits(v.map(x => A.rank(x).r), new Array(n).fill(B)) };
      },
      radices: () => {
        const one = A.radices ? A.radices() : [B];
        const out = [];
        for (let i = 0; i < n; i++) out.push(...one);
        return out;
      }
    };
  }
  return { ...tuple(new Array(n).fill(A)), part: 'table', n, of: A };
}

// ── Choices ───────────────────────────────────────────────────────

/** A tagged choice: { tag, value }. Parts in order, each part's objects before the next part's. */
export function oneOf(...parts) {
  if (parts.length === 1 && Array.isArray(parts[0])) parts = parts[0];
  const finite = parts.every(p => p.finite);
  const count = s => parts.reduce((c, p) => c + p.count(s), ZERO);
  const total = finite ? count(0) : null;
  return {
    part: 'oneOf', finite, total, parts, count,
    unrank(s, r) {
      for (let i = 0; i < parts.length; i++) {
        const c = parts[i].count(s);
        if (r < c) return { tag: i, value: parts[i].unrank(s, r) };
        r -= c;
      }
      throw new RangeError('rank past the end of this size');
    },
    rank(v) {
      if (!v || !Number.isInteger(v.tag) || !parts[v.tag]) throw badValue('oneOf');
      const inner = parts[v.tag].rank(v.value);
      let off = ZERO;
      for (let i = 0; i < v.tag; i++) off += parts[i].count(inner.s);
      return { s: inner.s, r: off + inner.r };
    },
    radices: finite ? () => [total] : undefined
  };
}

/** Nothing (null), which comes first, or an A. As a digit: 0 is nothing, 1 + rank is an A. */
export function option(A) {
  const count = s => (s === 0 ? ONE : ZERO) + A.count(s);
  const total = A.finite ? ONE + A.total : null;
  return {
    part: 'option', finite: A.finite, total, of: A, count,
    unrank: (s, r) => {
      if (s === 0) return r === ZERO ? null : A.unrank(0, r - ONE);
      return A.unrank(s, r);
    },
    rank: v => {
      if (v === null || v === undefined) return { s: 0, r: ZERO };
      const inner = A.rank(v);
      return { s: inner.s, r: inner.s === 0 ? inner.r + ONE : inner.r };
    },
    radices: A.finite ? () => [total] : undefined
  };
}

// ── Strings ───────────────────────────────────────────────────────

/**
 * A string of A's. Its size is its length plus its items' sizes, so for letters
 * (size 0 each) the size is the length. Within a size, strings are ordered as
 * a dictionary orders them: by the first item, then the rest.
 */
export function seq(A, { min = 0 } = {}) {
  if (min !== 0 && min !== 1) throw new RangeError('seq: min is 0 or 1');
  // S(s): strings of total size s, the empty one included.
  const S = memo((s, cache) => {
    if (s === 0) return ONE;
    let c = ZERO;
    for (let t = 0; t <= s - 1; t++) {
      const ca = A.count(t);
      if (ca) c += ca * cache[s - 1 - t];
    }
    return c;
  });
  const count = s => (s === 0 ? (min === 0 ? ONE : ZERO) : S(s));
  return {
    part: 'seq', finite: false, of: A, min, count,
    unrank(s, r) {
      if (s === 0 && min === 1) throw new RangeError('no non-empty string has size 0');
      const out = [];
      while (s > 0) {
        let placed = false;
        for (let t = 0; t <= s - 1; t++) {
          const ca = A.count(t);
          if (!ca) continue;
          const cr = S(s - 1 - t);
          const block = ca * cr;
          if (r < block) {
            out.push(A.unrank(t, r / cr));
            r %= cr;
            s = s - 1 - t;
            placed = true;
            break;
          }
          r -= block;
        }
        if (!placed) throw new RangeError('rank past the end of this size');
      }
      return out;
    },
    rank(v) {
      if (!Array.isArray(v) || v.length < min) throw badValue('seq');
      const items = v.map(x => A.rank(x));
      let s = items.reduce((a, it) => a + 1 + it.s, 0);
      const total = s;
      let r = ZERO;
      for (const it of items) {
        for (let t = 0; t < it.s; t++) r += A.count(t) * S(s - 1 - t);
        r += it.r * S(s - 1 - it.s);
        s = s - 1 - it.s;
      }
      return { s: total, r };
    }
  };
}

// ── Sets ──────────────────────────────────────────────────────────

/** n choose k, with n a BigInt and k a small integer. */
export function binom(n, k) {
  if (typeof n !== 'bigint') n = BigInt(n);
  if (k < 0 || BigInt(k) > n) return ZERO;
  if (BigInt(k) * 2n > n) k = Number(n - BigInt(k));
  let r = ONE;
  for (let i = 0; i < k; i++) r = (r * (n - BigInt(i))) / BigInt(i + 1);
  return r;
}

/** The r-th k-subset of {0 … N−1} in colexicographic order, ascending. */
function unrankCombination(N, k, r) {
  const out = new Array(k);
  for (let i = k; i >= 1; i--) {
    // The largest a with C(a, i) ≤ r.
    let lo = BigInt(i - 1), hi = N - ONE;
    while (lo < hi) {
      const mid = (lo + hi + ONE) / 2n;
      if (binom(mid, i) <= r) lo = mid; else hi = mid - ONE;
    }
    out[i - 1] = lo;
    r -= binom(lo, i);
  }
  return out;
}

/** A k-subset of {0 … N−1}, ascending, → its colexicographic rank. */
function rankCombination(sorted) {
  let r = ZERO;
  sorted.forEach((a, i) => { r += binom(a, i + 1); });
  return r;
}

/**
 * A finite set of A's, as an array sorted by A's order. Over a finite A it is a
 * row of bits, one per A-object, so the set of an NFA's moves is a plain
 * binary number. Over a graded A every member weighs its size plus one, the set
 * weighs the sum, and within a weight the members are chosen lightest first:
 * how many of weight 1, which ones, then how many of weight 2, and so on.
 */
export function subset(A) {
  if (A.finite) {
    const N = A.total;
    if (N > 1n << 30n) throw new RangeError('subset: too many things to hold as bits');
    const n = Number(N);
    const B = bits(n);
    return {
      part: 'subset', finite: true, total: B.total, of: A,
      count: B.count,
      unrank: (s, r) => {
        const b = B.unrank(0, r), out = [];
        for (let i = 0; i < n; i++) if (b[i]) out.push(A.unrank(0, BigInt(i)));
        return out;
      },
      rank: v => {
        if (!Array.isArray(v)) throw badValue('subset');
        let r = ZERO;
        const seen = new Set();
        for (const x of v) {
          const i = A.rank(x).r;
          const key = String(i);
          if (seen.has(key)) throw badValue('subset with a repeated member');
          seen.add(key);
          r += ONE << i;
        }
        return { s: 0, r };
      },
      radices: B.radices
    };
  }
  // c(w): members of weight w; T(w, t): sets of total weight t using weights ≥ w.
  const c = w => A.count(w - 1);
  const Tcache = new Map();
  const T = (w, t) => {
    if (t === 0) return ONE;
    if (w > t) return ZERO;
    const key = `${w},${t}`;
    const hit = Tcache.get(key);
    if (hit !== undefined) return hit;
    let v = ZERO;
    const cw = c(w);
    for (let j = 0; j * w <= t; j++) {
      const ways = binom(cw, j);
      if (!ways) break;
      v += ways * T(w + 1, t - j * w);
    }
    Tcache.set(key, v);
    return v;
  };
  const count = s => T(1, s);
  return {
    part: 'subset', finite: false, of: A, count,
    unrank(s, r) {
      const out = [];
      let w = 1, t = s;
      while (t > 0) {
        const cw = c(w);
        let chosen = false;
        for (let j = 0; j * w <= t; j++) {
          const ways = binom(cw, j);
          if (!ways) break;
          const rest = T(w + 1, t - j * w);
          const block = ways * rest;
          if (r < block) {
            const comb = unrankCombination(cw, j, r % ways);
            for (const atom of comb) out.push(A.unrank(w - 1, atom));
            r /= ways;
            t -= j * w;
            w += 1;
            chosen = true;
            break;
          }
          r -= block;
        }
        if (!chosen) throw new RangeError('rank past the end of this size');
      }
      return out;
    },
    rank(v) {
      if (!Array.isArray(v)) throw badValue('subset');
      const byWeight = new Map();
      let s = 0;
      for (const x of v) {
        const { s: as, r: ar } = A.rank(x);
        const w = as + 1;
        s += w;
        if (!byWeight.has(w)) byWeight.set(w, []);
        byWeight.get(w).push(ar);
      }
      for (const list of byWeight.values()) {
        list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        for (let i = 1; i < list.length; i++) if (list[i] === list[i - 1]) throw badValue('subset with a repeated member');
      }
      return { s, r: rankFromLevels(byWeight, s) };
    }
  };

  // Rank, level by level, mirroring unrank exactly: at each weight, skip the
  // blocks for fewer members, then the combination is the low digit and the
  // lighter-to-heavier remainder the high one.
  function rankFromLevels(byWeight, s) {
    const levels = [];
    let t = s;
    for (let w = 1; t > 0; w++) {
      const cw = c(w);
      const mine = byWeight.get(w) || [];
      const j = mine.length;
      let off = ZERO;
      for (let jj = 0; jj < j; jj++) off += binom(cw, jj) * T(w + 1, t - jj * w);
      levels.push({ off, ways: binom(cw, j), comb: rankCombination(mine) });
      t -= j * w;
    }
    // unrank at a level: r = off + (comb + ways · deeper)
    let r = ZERO;
    for (let i = levels.length - 1; i >= 0; i--) {
      const L = levels[i];
      r = L.off + L.comb + L.ways * r;
    }
    return r;
  }
}

// ── Numbers ───────────────────────────────────────────────────────

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * A rational p/q in lowest terms, 0 ≤ p ≤ q, of size q − 1. Size 0 holds 0/1
 * (when `zero`) and 1/1; size s holds the φ(s + 1) fractions with denominator
 * s + 1, smallest numerator first. A probability in a PFA, a cut point.
 */
export function fraction({ zero = false } = {}) {
  const phiCache = new Map();
  const coprimes = q => {
    if (q === 1) return zero ? [0, 1] : [1];
    let list = phiCache.get(q);
    if (!list) {
      list = [];
      for (let p = 1; p < q; p++) if (gcd(p, q) === 1) list.push(p);
      phiCache.set(q, list);
    }
    return list;
  };
  return {
    part: 'fraction', finite: false, zero,
    count: s => (s < 0 ? ZERO : BigInt(coprimes(s + 1).length)),
    unrank: (s, r) => {
      const q = s + 1, list = coprimes(q);
      const p = list[Number(r)];
      if (p === undefined) throw new RangeError('rank past the end of this size');
      return { p, q };
    },
    rank: v => {
      if (!v || !Number.isInteger(v.p) || !Number.isInteger(v.q) || v.q < 1 || v.p < 0 || v.p > v.q) throw badValue('fraction');
      const g = gcd(v.p, v.q) || 1;
      const p = v.p / g, q = v.q / g;
      const i = coprimes(q).indexOf(p);
      if (i < 0) throw badValue('fraction');
      return { s: q - 1, r: BigInt(i) };
    }
  };
}

/** The Möbius function, by trial division: 0 on a square factor, else ±1 by the count of primes. */
function mobius(n) {
  let m = n, k = 0;
  for (let p = 2; p * p <= m; p++) {
    if (m % p) continue;
    m /= p;
    if (m % p === 0) return 0;
    k++;
  }
  if (m > 1) k++;
  return k % 2 ? -1 : 1;
}

function divisorsOf(n) {
  const small = [], large = [];
  for (let e = 1; e * e <= n; e++) {
    if (n % e) continue;
    small.push(e);
    if (e * e !== n) large.push(n / e);
  }
  return [...small, ...large.reverse()];
}

/**
 * A probability distribution over n outcomes with rational weights, held as
 * whole parts over their least common denominator: { d, parts } with the
 * parts summing to d and sharing no factor (else a smaller d says the same
 * thing), so every distribution has exactly one form. Its size is d − 1: size
 * 0 holds the n certainties, and each size after holds the distributions
 * whose weights need that denominator. A PFA's row, δ(q, a).
 *
 * Counting k parts of sum m whose gcd with g (the parts so far) is 1 is a
 * Möbius sum over the common divisors of g and m — the compositions with every
 * part divisible by e, inverted.
 */
export function distribution(n) {
  if (!(Number.isInteger(n) && n >= 1)) throw new RangeError(`distribution(${n})`);
  const cache = new Map();
  // F(m, k, g): k parts summing to m, the gcd of g with all of them 1.
  const F = (m, k, g) => {
    if (k === 0) return m === 0 && g === 1 ? ONE : ZERO;
    const key = `${m},${k},${g}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let v = ZERO;
    for (const e of divisorsOf(gcd(g, m))) {
      const mu = mobius(e);
      if (mu) v += BigInt(mu) * binom(BigInt(m / e + k - 1), k - 1);
    }
    cache.set(key, v);
    return v;
  };
  return {
    part: 'distribution', finite: false, n,
    count: s => (s < 0 ? ZERO : F(s + 1, n, 0)),
    unrank(s, r) {
      const d = s + 1, parts = [];
      let m = d, g = 0;
      for (let i = 0; i < n; i++) {
        let placed = false;
        for (let x = 0; x <= m; x++) {
          const c = F(m - x, n - i - 1, gcd(g, x));
          if (r < c) { parts.push(x); g = gcd(g, x); m -= x; placed = true; break; }
          r -= c;
        }
        if (!placed) throw new RangeError('rank past the end of this size');
      }
      return { d, parts };
    },
    rank(v) {
      if (!v || !Number.isInteger(v.d) || v.d < 1 || !Array.isArray(v.parts) || v.parts.length !== n) throw badValue('distribution');
      if (v.parts.some(x => !Number.isInteger(x) || x < 0) || v.parts.reduce((a, x) => a + x, 0) !== v.d) throw badValue('distribution');
      if (v.parts.reduce((a, x) => gcd(a, x), 0) !== 1) throw badValue('distribution not over its least common denominator');
      let r = ZERO, m = v.d, g = 0;
      v.parts.forEach((x, i) => {
        for (let y = 0; y < x; y++) r += F(m - y, n - i - 1, gcd(g, y));
        g = gcd(g, x);
        m -= x;
      });
      return { s: v.d - 1, r };
    }
  };
}

/** Weights that sum to 1 → their distribution, over the least common denominator; null if they do not. */
export function distributionOf(weights, maxQ = 1e6) {
  const fs = weights.map(x => fractionOf(x, maxQ));
  if (fs.some(f => !f)) return null;
  const lcm = fs.reduce((a, f) => (a / gcd(a, f.q)) * f.q, 1);
  if (!Number.isSafeInteger(lcm)) return null;
  const parts = fs.map(f => (f.p * lcm) / f.q);
  if (parts.reduce((a, x) => a + x, 0) !== lcm) return null;
  return { d: lcm, parts };
}

/** The fraction p/q closest to x with the smallest denominator that reads back as x exactly. */
export function fractionOf(x, maxQ = 1e9) {
  if (!Number.isFinite(x) || x < 0 || x > 1) return null;
  if (x === 0) return { p: 0, q: 1 };
  if (x === 1) return { p: 1, q: 1 };
  // Continued fraction convergents until one reads back as x.
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, y = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(y);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxQ) break;
    if (h2 / k2 === x) return { p: h2, q: k2 };
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const frac = y - a;
    if (frac === 0) break;
    y = 1 / frac;
  }
  return null;
}

// ── Rooms: a shape read as one long shelf ─────────────────────────

/**
 * A room is a shape's objects laid end to end, smaller first: volume v is the
 * object at size s with rank v − (everything smaller). A finite room is the
 * shape's mixed-radix number itself.
 */
export function volumeOf(shape, value) {
  const { s, r } = shape.rank(value);
  if (shape.finite) return r;
  let before = ZERO;
  for (let t = 0; t < s; t++) before += shape.count(t);
  return before + r;
}

/** The inverse of volumeOf, with the object's size. Throws past a finite room's end. */
export function valueAt(shape, volume, { maxSize = 1e5 } = {}) {
  if (typeof volume !== 'bigint') volume = BigInt(volume);
  if (volume < ZERO) throw new RangeError('volumes start at 0');
  if (shape.finite) {
    if (volume >= shape.total) throw new RangeError('past the end of this room');
    return { value: shape.unrank(0, volume), size: 0 };
  }
  let v = volume;
  for (let s = 0; s <= maxSize; s++) {
    const c = shape.count(s);
    if (v < c) return { value: shape.unrank(s, v), size: s };
    v -= c;
  }
  throw new RangeError('this volume is past the sizes the engine will search');
}

/** Volumes of size below s — where a size's stretch of the room begins. */
export function volumesBefore(shape, s) {
  let before = ZERO;
  for (let t = 0; t < s; t++) before += shape.count(t);
  return before;
}

/** The size a volume falls at, without building it. */
export function sizeOfVolume(shape, volume, { maxSize = 1e5 } = {}) {
  if (shape.finite) return 0;
  let v = BigInt(volume);
  for (let s = 0; s <= maxSize; s++) {
    const c = shape.count(s);
    if (v < c) return s;
    v -= c;
  }
  return -1;
}
