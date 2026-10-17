function t(t) {
	const e = [];
	return (n) => {
		if (n < 0) return 0n;
		for (; e.length <= n;) e.push(t(e.length, e));
		return e[n];
	};
}
function e(t) {
	return /* @__PURE__ */ new RangeError(`Not a value of this shape: ${t}`);
}
function n(t) {
	if (!(Number.isInteger(t) && t >= 1)) throw new RangeError(`fin(${t})`);
	const n = BigInt(t);
	return {
		part: "fin",
		finite: !0,
		total: n,
		k: t,
		count: (t) => 0 === t ? n : 0n,
		unrank: (t, e) => Number(e),
		rank: (n) => {
			if (!(Number.isInteger(n) && n >= 0 && n < t)) throw e(n);
			return {
				s: 0,
				r: BigInt(n)
			};
		},
		radices: () => [n]
	};
}
function s(t) {
	if (!(Number.isInteger(t) && t >= 0)) throw new RangeError(`bits(${t})`);
	const n = 1n << BigInt(t);
	return {
		part: "bits",
		finite: !0,
		total: n,
		n: t,
		count: (t) => 0 === t ? n : 0n,
		unrank: (e, n) => {
			const s = new Array(t).fill(0), r = n.toString(2);
			for (let o = 0; o < r.length && o < t; o++) s[o] = 49 === r.charCodeAt(r.length - 1 - o) ? 1 : 0;
			return s;
		},
		rank: (n) => {
			if (!Array.isArray(n) || n.length !== t) throw e("bits");
			if (!t) return {
				s: 0,
				r: 0n
			};
			let s = "";
			for (let e = t - 1; e >= 0; e--) s += n[e] ? "1" : "0";
			return {
				s: 0,
				r: BigInt(`0b${s}`)
			};
		},
		radices: () => new Array(t).fill(2n)
	};
}
function r(t, e = 0, n = t.length) {
	if (n - e <= 16) {
		let s = 1n;
		for (let r = e; r < n; r++) s *= t[r];
		return s;
	}
	const s = e + n >> 1;
	return r(t, e, s) * r(t, s, n);
}
function o(t, e, n = 0, s = t.length) {
	if (s - n <= 48) {
		let r = 0n;
		for (let o = s - 1; o >= n; o--) r = r * e[o] + t[o];
		return r;
	}
	const i = n + s >> 1;
	return o(t, e, n, i) + r(e, n, i) * o(t, e, i, s);
}
function i(t, e) {
	const n = new Array(e.length);
	return a(n, t, e, 0, e.length), n;
}
function a(t, e, n, s, o) {
	if (o - s <= 48) {
		for (let r = s; r < o; r++) {
			const s = n[r];
			t[r] = e % s, e /= s;
		}
		return;
	}
	const i = s + o >> 1, l = r(n, s, i);
	a(t, e % l, n, s, i), a(t, e / l, n, i, o);
}
function l(t) {
	const n = t.map((t) => t.total), s = n.reduce((t, e) => t * e, 1n);
	return {
		part: "tuple",
		finite: !0,
		total: s,
		parts: t,
		count: (t) => 0 === t ? s : 0n,
		unrank: (e, s) => i(s, n).map((e, n) => t[n].unrank(0, e)),
		rank: (s) => {
			if (!Array.isArray(s) || s.length !== t.length) throw e("tuple");
			return {
				s: 0,
				r: o(s.map((e, n) => t[n].rank(e).r), n)
			};
		},
		radices: () => t.flatMap((t) => t.radices ? t.radices() : [t.total])
	};
}
function c(...n) {
	if (1 === n.length && Array.isArray(n[0]) && (n = n[0]), !n.length) return l([]);
	if (n.every((t) => t.finite)) return l(n);
	if (1 === n.length) {
		const [t] = n;
		return {
			part: "tuple",
			finite: !1,
			count: t.count,
			unrank: (e, n) => [t.unrank(e, n)],
			rank: (e) => t.rank(e[0])
		};
	}
	const r = (o = n[0], i = c(n.slice(1)), {
		part: "pair",
		finite: !1,
		A: o,
		B: i,
		count: t((t) => {
			let e = 0n;
			for (let n = 0; n <= t; n++) {
				const s = o.count(n);
				s && (e += s * i.count(t - n));
			}
			return e;
		}),
		unrank(t, e) {
			for (let n = 0; n <= t; n++) {
				const s = o.count(n);
				if (!s) continue;
				const r = s * i.count(t - n);
				if (e < r) return [o.unrank(n, e % s), i.unrank(t - n, e / s)];
				e -= r;
			}
			throw new RangeError("rank past the end of this size");
		},
		rank([t, e]) {
			const n = o.rank(t), s = i.rank(e), r = n.s + s.s;
			let a = 0n;
			for (let l = 0; l < n.s; l++) a += o.count(l) * i.count(r - l);
			return {
				s: r,
				r: a + n.r + o.count(n.s) * s.r
			};
		}
	});
	var o, i;
	return {
		part: "tuple",
		finite: !1,
		parts: n,
		count: r.count,
		unrank: (t, e) => {
			const [n, s] = r.unrank(t, e);
			return [n, ...s];
		},
		rank: (t) => {
			if (!Array.isArray(t) || t.length !== n.length) throw e("tuple");
			return r.rank([t[0], t.slice(1)]);
		}
	};
}
function u(t, n) {
	if (!(Number.isInteger(t) && t >= 0)) throw new RangeError(`table(${t})`);
	if (n.finite) {
		const s = n.total, r = s ** BigInt(t);
		return {
			part: "table",
			finite: !0,
			total: r,
			n: t,
			of: n,
			count: (t) => 0 === t ? r : 0n,
			unrank: (e, r) => i(r, new Array(t).fill(s)).map((t) => n.unrank(0, t)),
			rank: (r) => {
				if (!Array.isArray(r) || r.length !== t) throw e("table");
				return {
					s: 0,
					r: o(r.map((t) => n.rank(t).r), new Array(t).fill(s))
				};
			},
			radices: () => {
				const e = n.radices ? n.radices() : [s], r = [];
				for (let n = 0; n < t; n++) r.push(...e);
				return r;
			}
		};
	}
	return {
		...c(new Array(t).fill(n)),
		part: "table",
		n: t,
		of: n
	};
}
function h(...t) {
	1 === t.length && Array.isArray(t[0]) && (t = t[0]);
	const n = t.every((t) => t.finite), s = (e) => t.reduce((t, n) => t + n.count(e), 0n), r = n ? s(0) : null;
	return {
		part: "oneOf",
		finite: n,
		total: r,
		parts: t,
		count: s,
		unrank(e, n) {
			for (let s = 0; s < t.length; s++) {
				const r = t[s].count(e);
				if (n < r) return {
					tag: s,
					value: t[s].unrank(e, n)
				};
				n -= r;
			}
			throw new RangeError("rank past the end of this size");
		},
		rank(n) {
			if (!n || !Number.isInteger(n.tag) || !t[n.tag]) throw e("oneOf");
			const s = t[n.tag].rank(n.value);
			let r = 0n;
			for (let e = 0; e < n.tag; e++) r += t[e].count(s.s);
			return {
				s: s.s,
				r: r + s.r
			};
		},
		radices: n ? () => [r] : void 0
	};
}
function f(t) {
	const e = t.finite ? 1n + t.total : null;
	return {
		part: "option",
		finite: t.finite,
		total: e,
		of: t,
		count: (e) => (0 === e ? 1n : 0n) + t.count(e),
		unrank: (e, n) => 0 === e ? 0n === n ? null : t.unrank(0, n - 1n) : t.unrank(e, n),
		rank: (e) => {
			if (null == e) return {
				s: 0,
				r: 0n
			};
			const n = t.rank(e);
			return {
				s: n.s,
				r: 0 === n.s ? n.r + 1n : n.r
			};
		},
		radices: t.finite ? () => [e] : void 0
	};
}
function p(t, e) {
	if ("bigint" != typeof t && (t = BigInt(t)), e < 0 || BigInt(e) > t) return 0n;
	2n * BigInt(e) > t && (e = Number(t - BigInt(e)));
	let n = 1n;
	for (let s = 0; s < e; s++) n = n * (t - BigInt(s)) / BigInt(s + 1);
	return n;
}
function d(t, e, n) {
	const s = new Array(e);
	for (let r = e; r >= 1; r--) {
		let e = BigInt(r - 1), o = t - 1n;
		for (; e < o;) {
			const t = (e + o + 1n) / 2n;
			p(t, r) <= n ? e = t : o = t - 1n;
		}
		s[r - 1] = e, n -= p(e, r);
	}
	return s;
}
function m(t) {
	let e = 0n;
	return t.forEach((t, n) => {
		e += p(t, n + 1);
	}), e;
}
function g(t) {
	if (t.finite) {
		const n = t.total;
		if (n > 1n << 30n) throw new RangeError("subset: too many things to hold as bits");
		const r = Number(n), o = s(r);
		return {
			part: "subset",
			finite: !0,
			total: o.total,
			of: t,
			count: o.count,
			unrank: (e, n) => {
				const s = o.unrank(0, n), i = [];
				for (let o = 0; o < r; o++) s[o] && i.push(t.unrank(0, BigInt(o)));
				return i;
			},
			rank: (n) => {
				if (!Array.isArray(n)) throw e("subset");
				let s = 0n;
				const r = /* @__PURE__ */ new Set();
				for (const o of n) {
					const n = t.rank(o).r, i = String(n);
					if (r.has(i)) throw e("subset with a repeated member");
					r.add(i), s += 1n << n;
				}
				return {
					s: 0,
					r: s
				};
			},
			radices: o.radices
		};
	}
	const n = (e) => t.count(e - 1), r = /* @__PURE__ */ new Map(), o = (t, e) => {
		if (0 === e) return 1n;
		if (t > e) return 0n;
		const s = `${t},${e}`, i = r.get(s);
		if (void 0 !== i) return i;
		let a = 0n;
		const l = n(t);
		for (let n = 0; n * t <= e; n++) {
			const s = p(l, n);
			if (!s) break;
			a += s * o(t + 1, e - n * t);
		}
		return r.set(s, a), a;
	};
	return {
		part: "subset",
		finite: !1,
		of: t,
		count: (t) => o(1, t),
		unrank(e, s) {
			const r = [];
			let i = 1, a = e;
			for (; a > 0;) {
				const e = n(i);
				let l = !1;
				for (let n = 0; n * i <= a; n++) {
					const c = p(e, n);
					if (!c) break;
					const u = c * o(i + 1, a - n * i);
					if (s < u) {
						const o = d(e, n, s % c);
						for (const e of o) r.push(t.unrank(i - 1, e));
						s /= c, a -= n * i, i += 1, l = !0;
						break;
					}
					s -= u;
				}
				if (!l) throw new RangeError("rank past the end of this size");
			}
			return r;
		},
		rank(n) {
			if (!Array.isArray(n)) throw e("subset");
			const s = /* @__PURE__ */ new Map();
			let r = 0;
			for (const e of n) {
				const { s: n, r: o } = t.rank(e), i = n + 1;
				r += i, s.has(i) || s.set(i, []), s.get(i).push(o);
			}
			for (const t of s.values()) {
				t.sort((t, e) => t < e ? -1 : t > e ? 1 : 0);
				for (let n = 1; n < t.length; n++) if (t[n] === t[n - 1]) throw e("subset with a repeated member");
			}
			return {
				s: r,
				r: i(s, r)
			};
		}
	};
	function i(t, e) {
		const s = [];
		let r = e;
		for (let a = 1; r > 0; a++) {
			const e = n(a), i = t.get(a) || [], l = i.length;
			let c = 0n;
			for (let t = 0; t < l; t++) c += p(e, t) * o(a + 1, r - t * a);
			s.push({
				off: c,
				ways: p(e, l),
				comb: m(i)
			}), r -= l * a;
		}
		let i = 0n;
		for (let n = s.length - 1; n >= 0; n--) {
			const t = s[n];
			i = t.off + t.comb + t.ways * i;
		}
		return i;
	}
}
function y(t, e, { maxSize: n = 1e5 } = {}) {
	if ("bigint" != typeof e && (e = BigInt(e)), e < 0n) throw new RangeError("volumes start at 0");
	if (t.finite) {
		if (e >= t.total) throw new RangeError("past the end of this room");
		return {
			value: t.unrank(0, e),
			size: 0
		};
	}
	let s = e;
	for (let r = 0; r <= n; r++) {
		const e = t.count(r);
		if (s < e) return {
			value: t.unrank(r, s),
			size: r
		};
		s -= e;
	}
	throw new RangeError("this volume is past the sizes the engine will search");
}
function b(t, e) {
	let n = 0n;
	for (let s = 0; s < e; s++) n += t.count(s);
	return n;
}
const w = Object.freeze({
	eps: "ε",
	any: "Σ",
	blank: "⊔",
	leftMarker: "⊢",
	rightMarker: "⊣",
	stackBottom: "Z",
	lambda: "λ"
}), k = [
	"L",
	"R",
	"S"
], v = "abcdefghijklmnopqrstuvwxyz";
function A(t, e) {
	return e < t.length ? t[e] : String.fromCodePoint(19968 + e - t.length);
}
const $ = (t) => A(v, t), S = (t) => A("ABCDEFGHIJKLMNOPQRSTUVWXY", t), M = (t) => 0 === t ? w.blank : t <= 9 ? String(t) : A(v, t - 10), x = (t, e = !1) => e && t < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[t] : `q${t}`, E = (t, e) => String(t).localeCompare(String(e), void 0, { numeric: !0 });
var T = class extends Error {};
const N = (t) => {
	throw new T(t);
}, P = (s, r) => s ? function(n, { min: s = 0 } = {}) {
	if (0 !== s && 1 !== s) throw new RangeError("seq: min is 0 or 1");
	const r = t((t, e) => {
		if (0 === t) return 1n;
		let s = 0n;
		for (let r = 0; r <= t - 1; r++) {
			const o = n.count(r);
			o && (s += o * e[t - 1 - r]);
		}
		return s;
	});
	return {
		part: "seq",
		finite: !1,
		of: n,
		min: s,
		count: (t) => 0 === t ? 0 === s ? 1n : 0n : r(t),
		unrank(t, e) {
			if (0 === t && 1 === s) throw new RangeError("no non-empty string has size 0");
			const o = [];
			for (; t > 0;) {
				let s = !1;
				for (let i = 0; i <= t - 1; i++) {
					const a = n.count(i);
					if (!a) continue;
					const l = r(t - 1 - i), c = a * l;
					if (e < c) {
						o.push(n.unrank(i, e / l)), e %= l, t = t - 1 - i, s = !0;
						break;
					}
					e -= c;
				}
				if (!s) throw new RangeError("rank past the end of this size");
			}
			return o;
		},
		rank(t) {
			if (!Array.isArray(t) || t.length < s) throw e("seq");
			const o = t.map((t) => n.rank(t));
			let i = o.reduce((t, e) => t + 1 + e.s, 0);
			const a = i;
			let l = 0n;
			for (const e of o) {
				for (let t = 0; t < e.s; t++) l += n.count(t) * r(i - 1 - t);
				l += e.r * r(i - 1 - e.s), i = i - 1 - e.s;
			}
			return {
				s: a,
				r: l
			};
		}
	};
}(n(s), r) : c();
function D(t, e, { letters: n = !1 } = {}) {
	const s = [];
	for (let r = 0; r < e; r++) s.push({
		id: `s${r}`,
		name: x(r, n),
		x: 0,
		y: 0
	});
	return {
		machine: t,
		states: s,
		transitions: [],
		startId: "s0",
		accepts: [],
		sigma: [],
		stackAlpha: [],
		outputAlpha: [],
		config: { sym: { ...w } }
	};
}
function I(t, e) {
	e.id = `t${t.transitions.length + 1}`, t.transitions.push(e);
}
const C = (t) => `s${t}`, j = (t, e) => t.length ? t.map(e).join("") : w.eps;
function B(t) {
	const e = t.states.length, n = new Map(t.states.map((t, e) => [t.id, e])), s = Array.from({ length: e }, () => []);
	for (const h of t.transitions) {
		const t = n.get(h.from), e = n.get(h.to);
		void 0 === t || void 0 === e || s[t].includes(e) || s[t].push(e);
	}
	const r = new Array(e).fill(-1), o = [], i = n.get(t.startId) ?? 0;
	r[i] = 0, o.push(i);
	for (let h = 0; h < o.length; h++) for (const t of s[o[h]]) r[t] < 0 && (r[t] = r[o[h]] + 1, o.push(t));
	let a = Math.max(0, ...r);
	for (let h = 0; h < e; h++) r[h] < 0 && (r[h] = a + 1, o.push(h));
	a = Math.max(0, ...r);
	const l = Array.from({ length: a + 1 }, () => []);
	for (const h of o) l[r[h]].push(h);
	const c = Math.max(...l.map((t) => t.length)), u = Math.max(1, Math.ceil(Math.sqrt(1.6 * e)));
	return l.forEach((e, n) => {
		e.forEach((s, r) => {
			const o = t.states[s], i = Math.floor(n / u);
			o.x = 120 + n % u * 150, o.y = 110 + i * (110 * c + 80) + 110 * (r - (e.length - 1) / 2) + (c - 1) / 2 * 110;
		});
	}), t;
}
function F(t) {
	return {
		...w,
		...t?.config?.sym || {}
	};
}
function R(t) {
	t && Array.isArray(t.states) && t.states.length || N("It has no states.");
	const e = t.states.find((e) => e.id === t.startId);
	e || N("It has no start state.");
	const n = [e, ...t.states.filter((t) => t !== e)], s = new Map(n.map((t, e) => [t.id, e])), r = new Set(t.accepts || []);
	return {
		order: n,
		idx: s,
		n: n.length,
		accepting: n.map((t) => r.has(t.id) ? 1 : 0)
	};
}
function O(t, e) {
	const n = t.idx.get(e);
	return void 0 === n && N("A transition leaves from or goes to a state that is not there."), n;
}
function Q(t, e, n) {
	const s = /* @__PURE__ */ new Set();
	for (const r of t || []) null == r || "" === r || n.has(r) || s.add(String(r));
	for (const r of e) null == r || "" === r || n.has(r) || s.add(String(r));
	return [...s].sort(E);
}
function z(t) {
	return (t.transitions || []).filter((t) => !t.port);
}
function L(t, e) {
	return null == t || "" === t || t === e.eps ? [] : [...String(t)];
}
function W(t, e, n) {
	const s = t.indexOf(e);
	return s < 0 && N(`It uses ${n} “${e}”, which is not in its alphabet.`), s;
}
function q(t) {
	return Object.fromEntries(Object.entries(t).filter(([, t]) => Array.isArray(t)));
}
function U(t, e, { allowEps: n }) {
	const s = F(t), r = z(t), o = /* @__PURE__ */ new Set([
		s.eps,
		s.any,
		s.leftMarker,
		s.rightMarker
	]), i = Q(t.sigma, r.map((t) => t.symbol), o), a = [], l = /* @__PURE__ */ new Set();
	for (const u of r) {
		const t = O(e, u.from), r = O(e, u.to);
		if (u.symbol === s.any) continue;
		if (u.symbol === s.eps || "" === u.symbol || void 0 === u.symbol) {
			n || N("It has an ε-move, which this type does not allow."), a.push({
				from: t,
				to: r,
				a: -1
			});
			continue;
		}
		const o = W(i, String(u.symbol), "the letter");
		l.add(`${t}|${o}`), a.push({
			from: t,
			to: r,
			a: o
		});
	}
	const c = [];
	for (const u of r) {
		if (u.symbol !== s.any) continue;
		const t = O(e, u.from), n = O(e, u.to);
		i.forEach((e, s) => {
			l.has(`${t}|${s}`) || a.push({
				from: t,
				to: n,
				a: s
			});
		}), c.length || c.push("Wildcard edges were expanded into the letters they stand for.");
	}
	return i.length || N("It has no letters."), {
		sigma: i,
		moves: a,
		notes: c
	};
}
function _(t, { omega: e = null } = {}) {
	return {
		type: t,
		params: [{
			id: "states",
			min: 1
		}, {
			id: "letters",
			min: 1
		}],
		kind: e ? "omega" : "fa",
		omega: e,
		shape: ([t, e]) => c(s(t), u(t * e, n(t))),
		toDoc([e, n], [s, r]) {
			const o = D(t, s);
			o.sigma = Array.from({ length: r }, (t, e) => $(e)), o.accepts = e.map((t, e) => t ? C(e) : null).filter(Boolean);
			for (let t = 0; t < s; t++) for (let e = 0; e < r; e++) I(o, {
				from: C(t),
				to: C(n[t * r + e]),
				symbol: $(e)
			});
			return B(o);
		},
		fromDoc(e) {
			const n = R(e), { sigma: s, moves: r, notes: o } = U(e, n, { allowEps: !1 }), i = [...n.accepting], a = function(t, e, n, { what: s = "DFA", sink: r = () => {} } = {}) {
				const o = e.length;
				let i = t.n;
				const a = new Array(i * o).fill(null);
				for (const c of n) {
					const t = c.from * o + c.a;
					null !== a[t] && a[t] !== c.to && N(`It has two moves from one state on “${e[c.a]}”; a ${s} has one.`), a[t] = c.to;
				}
				const l = [];
				if (a.includes(null)) {
					const t = i;
					i += 1;
					for (let e = 0; e < a.length; e++) null === a[e] && (a[e] = t);
					for (let e = 0; e < o; e++) a.push(t);
					r(t), l.push(`It was partial, so it is read with a sink state added (${s}s here are complete).`);
				}
				return {
					n: i,
					delta: a,
					notes: l
				};
			}(n, s, r, {
				what: t,
				sink: () => i.push(0)
			});
			return {
				params: [a.n, s.length],
				body: [i, a.delta],
				notes: [...o, ...a.notes],
				names: q({ sigma: s })
			};
		},
		tile: (t, e, [n, s]) => {
			if (0 === t[0]) return {
				key: "F",
				value: null === e ? "" : `{${e.map((t, e) => t ? x(e) : null).filter(Boolean).join(", ")}}`
			};
			const r = t[1], o = Math.floor(r / s), i = r % s;
			return {
				key: `${x(o)} · ${$(i)}`,
				value: x(e),
				edge: [o, e]
			};
		}
	};
}
function K(t, { omega: e = null } = {}) {
	return {
		type: t,
		params: [{
			id: "states",
			min: 1
		}, {
			id: "letters",
			min: 1
		}],
		kind: e ? "omega" : "fa",
		omega: e,
		shape: ([t, e]) => c(s(t), g(c(n(t), n(e), n(t)))),
		toDoc([e, n], [s, r]) {
			const o = D(t, s);
			o.sigma = Array.from({ length: r }, (t, e) => $(e)), o.accepts = e.map((t, e) => t ? C(e) : null).filter(Boolean);
			for (const [t, i, a] of n) I(o, {
				from: C(t),
				to: C(a),
				symbol: $(i)
			});
			return B(o);
		},
		fromDoc(t) {
			const e = R(t), { sigma: n, moves: s, notes: r } = U(t, e, { allowEps: !1 }), o = n.length, i = /* @__PURE__ */ new Set(), a = [];
			for (const l of s) {
				const t = l.a, e = `${l.from}|${t}|${l.to}`;
				i.has(e) || (i.add(e), a.push([
					l.from,
					t,
					l.to
				]));
			}
			return {
				params: [e.n, o],
				body: [[...e.accepting], a],
				notes: r,
				names: q({ sigma: n })
			};
		},
		move: ([t, e, n]) => `${x(t)} —${$(e)}→ ${x(n)}`
	};
}
function J(t) {
	const e = k.indexOf(t || "R");
	return e < 0 && N(`It moves “${t}”, which is not L, R or S.`), e;
}
const H = Object.freeze([w.stackBottom, "1"]), V = (() => {
	const t = H.length;
	return {
		type: "Counter",
		params: [{
			id: "states",
			min: 1
		}, {
			id: "letters",
			min: 1
		}],
		kind: "cf",
		store: !0,
		explicitOnly: !0,
		shape: ([e, r]) => c(s(e), g(((e, s) => c([
			n(e),
			n(s + 1),
			n(t + 1),
			n(e),
			P(t)
		]))(e, r))),
		toDoc([e, n], [s, r]) {
			const o = D("Counter", s);
			o.sigma = Array.from({ length: r }, (t, e) => $(e)), o.stackAlpha = [...H], o.config.pdaParadigm = "explicit", o.accepts = e.map((t, e) => t ? C(e) : null).filter(Boolean);
			const i = (e) => e === t ? w.eps : H[e];
			for (const [t, a, l, c, u] of n) I(o, {
				from: C(t),
				to: C(c),
				symbol: a === r ? w.eps : $(a),
				pop: i(l),
				push: j(u, (t) => H[t])
			});
			return B(o);
		},
		fromDoc(e) {
			const n = R(e), s = function(t) {
				const e = F(t), n = z(t);
				"empty" === (t.config?.pdaParadigm ?? "explicit") && N("It accepts by empty stack; this wing holds the bottom-marker, final-state convention its definition uses.");
				const s = /* @__PURE__ */ new Set([
					e.eps,
					e.any,
					e.leftMarker,
					e.rightMarker
				]), r = Q(t.sigma, n.map((t) => t.symbol), s);
				r.length || N("It has no letters.");
				for (const i of n) for (const t of [
					"pop",
					"push",
					"symbol"
				]) i[t] === e.any && N("It has a wildcard in a move; this wing holds machines without them.");
				const o = H;
				return {
					sym: e,
					ts: n,
					sigma: r,
					k: r.length,
					gamma: o,
					g: (t) => W(o, t, "the stack symbol")
				};
			}(e), r = (t) => L(t, s.sym).map(s.g), o = (e) => null == e || "" === e || e === s.sym.eps ? t : s.g(e), i = /* @__PURE__ */ new Set(), a = [];
			for (const t of s.ts) {
				const e = t.symbol === s.sym.eps || "" === t.symbol || void 0 === t.symbol ? s.k : W(s.sigma, String(t.symbol), "the letter"), l = [
					O(n, t.from),
					e,
					o(t.pop),
					O(n, t.to),
					r(t.push)
				], c = JSON.stringify(l);
				i.has(c) || (i.add(c), a.push(l));
			}
			return {
				params: [n.n, s.k],
				body: [[...n.accepting], a],
				notes: [],
				names: q({
					sigma: s.sigma,
					stackAlpha: s.gamma
				})
			};
		},
		move: (t, [e, n]) => `${x(t[0])} —${t[1] === n ? w.eps : $(t[1])}→ ${x(t[3])}`
	};
})();
function X(t, e) {
	const n = [];
	t && n.push(w.stackBottom);
	for (let s = 0; s < e; s++) n.push(S(s));
	return n;
}
function G(t) {
	const e = F(t), n = z(t), s = "empty" !== (t.config?.pdaParadigm ?? "explicit"), r = /* @__PURE__ */ new Set([
		e.eps,
		e.any,
		e.leftMarker,
		e.rightMarker
	]), o = Q(t.sigma, n.map((t) => t.symbol), r);
	o.length || N("It has no letters.");
	for (const c of n) for (const t of [
		"pop",
		"push",
		"symbol"
	]) c[t] === e.any && N("It has a wildcard in a move; this wing holds machines without them.");
	const i = [];
	for (const c of n) c.pop && c.pop !== e.eps && i.push(c.pop), i.push(...L(c.push, e));
	const a = Q(t.stackAlpha, i, /* @__PURE__ */ new Set([
		e.eps,
		e.stackBottom,
		e.any
	])), l = s ? [e.stackBottom, ...a] : a;
	return {
		sym: e,
		ts: n,
		sigma: o,
		k: o.length,
		explicit: s,
		gamma: l,
		m: a.length,
		g: (t) => W(l, t, "the stack symbol")
	};
}
const Y = (t, e) => t.symbol === e.sym.eps || "" === t.symbol || void 0 === t.symbol ? -1 : W(e.sigma, String(t.symbol), "the letter"), Z = (t) => t.accepting.some(Boolean) ? ["It accepts by empty stack, so its accepting states are not part of it."] : [], tt = (() => {
	const t = (t, e, s) => c([
		n(t),
		n(e + 1),
		n(s + 1),
		n(t),
		P(s)
	]);
	return {
		type: "NPDA",
		params: [
			{
				id: "states",
				min: 1
			},
			{
				id: "letters",
				min: 1
			},
			{
				id: "stack symbols",
				min: 0
			}
		],
		kind: "cf",
		store: !0,
		shape: ([e, n, r]) => h(c(s(e), g(t(e, n, r + 1))), g(t(e, n, r))),
		toDoc(t, [e, n, s]) {
			const r = 0 === t.tag, [o, i] = r ? t.value : [new Array(e).fill(0), t.value], a = X(r, s), l = D("NPDA", e);
			l.sigma = Array.from({ length: n }, (t, e) => $(e)), l.stackAlpha = [...a], l.config.pdaParadigm = r ? "explicit" : "empty", l.accepts = o.map((t, e) => t ? C(e) : null).filter(Boolean);
			const c = (t) => t === a.length ? w.eps : a[t];
			for (const [u, h, f, p, d] of i) I(l, {
				from: C(u),
				to: C(p),
				symbol: h === n ? w.eps : $(h),
				pop: c(f),
				push: j(d, (t) => a[t])
			});
			return B(l);
		},
		fromDoc(t) {
			const e = R(t), n = G(t), s = n.gamma.length, r = /* @__PURE__ */ new Set(), o = [];
			for (const a of n.ts) {
				const t = Y(a, n), i = void 0 === a.pop || null === a.pop || "" === a.pop || a.pop === n.sym.eps ? s : n.g(a.pop), l = [
					O(e, a.from),
					t < 0 ? n.k : t,
					i,
					O(e, a.to),
					L(a.push, n.sym).map(n.g)
				], c = JSON.stringify(l);
				r.has(c) || (r.add(c), o.push(l));
			}
			const i = n.explicit ? {
				tag: 0,
				value: [[...e.accepting], o]
			} : {
				tag: 1,
				value: o
			};
			return {
				params: [
					e.n,
					n.k,
					n.m
				],
				body: i,
				notes: n.explicit ? [] : Z(e),
				names: q({
					sigma: n.sigma,
					stackAlpha: n.gamma
				})
			};
		},
		move: (t, [e, n]) => `${x(t[0])} —${t[1] === n ? w.eps : $(t[1])}→ ${x(t[3])}`
	};
})();
function et(t, e, s) {
	const r = c(n(t), P(s)), o = f(r), i = [r, u(e, h(r, u(s, o)))];
	return s > 0 && i.push(h(Array.from({ length: s }, (t, n) => c(u(n, u(e, o)), r, u(s - 1 - n, h(r, u(e, o))))))), h(i);
}
function nt(t, e, n) {
	const s = [];
	if (0 === t.tag) s.push({
		a: -1,
		X: n,
		mv: t.value
	});
	else if (1 === t.tag) t.value.forEach((t, e) => {
		0 === t.tag ? s.push({
			a: e,
			X: n,
			mv: t.value
		}) : t.value.forEach((t, n) => {
			t && s.push({
				a: e,
				X: n,
				mv: t
			});
		});
	});
	else {
		const e = t.value.tag, [n, r, o] = t.value.value, i = (t, e) => t.forEach((t, n) => {
			t && s.push({
				a: n,
				X: e,
				mv: t
			});
		});
		n.forEach((t, e) => i(t, e)), s.push({
			a: -1,
			X: e,
			mv: r
		}), o.forEach((t, n) => {
			const r = e + 1 + n;
			0 === t.tag ? s.push({
				a: -1,
				X: r,
				mv: t.value
			}) : i(t.value, r);
		});
	}
	return s;
}
const st = {
	type: "DPDA",
	params: [
		{
			id: "states",
			min: 1
		},
		{
			id: "letters",
			min: 1
		},
		{
			id: "stack symbols",
			min: 0
		}
	],
	kind: "dcf",
	store: !0,
	shape: ([t, e, n]) => h(c(s(t), u(t, et(t, e, n + 1))), u(t, et(t, e, n))),
	toDoc(t, [e, n, s]) {
		const r = 0 === t.tag, [o, i] = r ? t.value : [new Array(e).fill(0), t.value], a = X(r, s), l = a.length, c = D("DPDA", e);
		return c.sigma = Array.from({ length: n }, (t, e) => $(e)), c.stackAlpha = [...a], c.config.pdaParadigm = r ? "explicit" : "empty", c.accepts = o.map((t, e) => t ? C(e) : null).filter(Boolean), i.forEach((t, e) => {
			for (const { a: n, X: s, mv: r } of nt(t, 0, l)) I(c, {
				from: C(e),
				to: C(r[0]),
				symbol: n < 0 ? w.eps : $(n),
				pop: s === l ? w.eps : a[s],
				push: j(r[1], (t) => a[t])
			});
		}), B(c);
	},
	fromDoc(t) {
		const e = R(t), n = G(t), s = e.n, r = n.k, o = n.gamma.length, i = Array.from({ length: s }, () => []);
		for (const c of n.ts) {
			const t = void 0 === c.pop || null === c.pop || "" === c.pop || c.pop === n.sym.eps ? o : n.g(c.pop);
			i[O(e, c.from)].push({
				a: Y(c, n),
				X: t,
				mv: [O(e, c.to), L(c.push, n.sym).map(n.g)]
			});
		}
		const a = i.map((t) => function(t, e, n) {
			for (let u = 0; u < t.length; u++) for (let e = u + 1; e < t.length; e++) {
				const s = t[u], r = t[e], o = s.a < 0 || r.a < 0 || s.a === r.a, i = s.X === n || r.X === n || s.X === r.X;
				o && i && N("It can make two moves from one configuration; a DPDA has at most one.");
			}
			const s = t.find((t) => t.a < 0 && t.X === n);
			if (s) return {
				tag: 0,
				value: s.mv
			};
			const r = t.filter((t) => t.a < 0), o = (e, n) => t.find((t) => t.a === e && t.X === n)?.mv || null;
			if (!r.length) return {
				tag: 1,
				value: Array.from({ length: e }, (t, e) => {
					const s = o(e, n);
					return s ? {
						tag: 0,
						value: s
					} : {
						tag: 1,
						value: Array.from({ length: n }, (t, n) => o(e, n))
					};
				})
			};
			const i = Math.min(...r.map((t) => t.X)), a = (t) => Array.from({ length: e }, (e, n) => o(n, t)), l = Array.from({ length: i }, (t, e) => a(e)), c = Array.from({ length: n - 1 - i }, (t, e) => {
				const n = i + 1 + e, s = o(-1, n);
				return s ? {
					tag: 0,
					value: s
				} : {
					tag: 1,
					value: a(n)
				};
			});
			return {
				tag: 2,
				value: {
					tag: i,
					value: [
						l,
						o(-1, i),
						c
					]
				}
			};
		}(t, r, o)), l = n.explicit ? {
			tag: 0,
			value: [[...e.accepting], a]
		} : {
			tag: 1,
			value: a
		};
		return {
			params: [
				s,
				r,
				n.m
			],
			body: l,
			notes: n.explicit ? [] : Z(e),
			names: q({
				sigma: n.sigma,
				stackAlpha: n.gamma
			})
		};
	},
	move: (t) => `to ${x(t[0])}`
};
function rt(t, { twoWay: e }) {
	return {
		type: t,
		params: [{
			id: "states",
			min: 1
		}, {
			id: "tape symbols",
			min: 2
		}],
		kind: "tm",
		shape: ([t, e]) => c(s(t), u(t * e, f(c(n(e), n(3), n(t))))),
		toDoc([n, s], [r, o]) {
			const i = o, a = D(t, r, { letters: !0 }), l = Array.from({ length: o }, (t, e) => M(e)), c = (t) => l[t];
			return a.sigma = l.slice(1), a.stackAlpha = [...l], a.tapeCount = 1, a.config.twoWayTape = e, a.accepts = n.map((t, e) => t ? C(e) : null).filter(Boolean), s.forEach((t, e) => {
				if (!t) return;
				const n = Math.floor(e / i), s = e % i;
				I(a, {
					from: C(n),
					to: C(t[2]),
					symbol: c(s),
					write: c(t[0]),
					dir: k[t[1]]
				});
			}), B(a);
		},
		fromDoc(e) {
			const n = R(e), s = function(t) {
				const e = F(t), n = z(t), s = /* @__PURE__ */ new Set([
					e.eps,
					e.any,
					e.blank,
					e.leftMarker,
					e.rightMarker
				]), r = [];
				for (const u of n) {
					r.push(u.symbol, u.write);
					for (const t of ["tapeSyms", "tapeWrites"]) Array.isArray(u[t]) && r.push(...u[t]);
				}
				const o = Q([...t.stackAlpha || [], ...t.sigma || []], r, s), i = [e.blank, ...o], a = i.length, l = [], c = new Set(t.sigma || []);
				return o.some((t) => !c.has(t)) && l.push("Every non-blank tape symbol is read as an input letter here."), {
					sym: e,
					ts: n,
					gamma: i,
					K: a,
					readIdx: (t) => W(i, String(t), "the tape symbol"),
					notes: l
				};
			}(e), r = n.n, o = s.K, i = o, a = new Array(r * i).fill(null), l = [...s.notes], c = /* @__PURE__ */ new Set();
			for (const u of s.ts) {
				if (u.symbol === s.sym.any) continue;
				const e = O(n, u.from), r = s.readIdx(u.symbol), o = e * i + r;
				a[o] && N(`It has two moves from one state on “${u.symbol}”; a ${t} has one.`), a[o] = [
					u.write === s.sym.any || void 0 === u.write ? r : s.readIdx(u.write),
					J(u.dir),
					O(n, u.to)
				], c.add(o);
			}
			for (const t of s.ts) {
				if (t.symbol !== s.sym.any) continue;
				const e = O(n, t.from);
				for (let r = 0; r < i; r++) {
					const o = e * i + r;
					c.has(o) || (a[o] = [
						t.write === s.sym.any || void 0 === t.write ? r : s.readIdx(t.write),
						J(t.dir),
						O(n, t.to)
					]);
				}
				l.includes("Wildcard edges were expanded into the symbols they stand for.") || l.push("Wildcard edges were expanded into the symbols they stand for.");
			}
			return {
				params: [r, o],
				body: [[...n.accepting], a],
				notes: l,
				names: q({ stackAlpha: s.gamma })
			};
		},
		tile: (t, e, [n, s]) => {
			if (0 === t[0]) return {
				key: "F",
				value: `{${e.map((t, e) => t ? x(e, !0) : null).filter(Boolean).join(", ")}}`
			};
			const r = s, o = t[1], i = Math.floor(o / r), a = o % r, l = M;
			return {
				key: `${x(i, !0)}${l(a)}`,
				value: e ? `${l(e[0])}${k[e[1]]}${x(e[2], !0)}` : "—",
				edge: e ? [i, e[2]] : null
			};
		}
	};
}
const ot = [
	_("DFA"),
	K("NFA"),
	_("DBA", { omega: "buchi" }),
	K("NBA", { omega: "buchi" }),
	st,
	tt,
	V,
	rt("TM", { twoWay: !1 }),
	rt("ITM", { twoWay: !0 })
], it = (t) => t.toLowerCase().replace("ε", "e").replace(/-/g, ""), at = ot.map((t) => Object.freeze({
	...t,
	key: it(t.type)
})), lt = new Map(at.map((t) => [t.key, t])), ct = (new Map(at.map((t) => [t.type, t])), Object.freeze({
	PDA: "DPDA",
	DWA: "DBA",
	NWA: "NBA"
})), ut = new Map(Object.entries(ct).map(([t, e]) => [it(t), it(e)])), ht = /* @__PURE__ */ new Map();
function ft(t, e) {
	const n = pt(t, e);
	let s = ht.get(n);
	return s || (s = t.shape(e), ht.size > 400 && ht.clear(), ht.set(n, s)), s;
}
function pt(t, e) {
	return `${t.key}-${e.join("-")}`;
}
const dt = {
	context: void 0,
	registry: void 0,
	effects: void 0,
	done: !1,
	getContextId() {
		return mt(this.context.count);
	},
	getNextContextId() {
		return mt(this.context.count++);
	}
};
function mt(t) {
	const e = String(t), n = e.length - 1;
	return dt.context.id + (n ? String.fromCharCode(96 + n) : "") + e;
}
const gt = { equals: (t, e) => t === e };
let yt = Wt;
const bt = 1, wt = 2, kt = {
	owned: null,
	cleanups: null,
	context: null,
	owner: null
};
var vt = null;
let At = null, St = null, Mt = null, xt = null, Et = null, Tt = 0;
function Nt(t, e) {
	const n = {
		value: t,
		observers: null,
		observerSlots: null,
		comparator: (e = e ? Object.assign({}, gt, e) : gt).equals || void 0
	};
	return [Ft.bind(n), (t) => ("function" == typeof t && (t = At && At.running && At.sources.has(n) ? t(n.tValue) : t(n.value)), Rt(n, t))];
}
function Pt(t) {
	return Lt(t, !1);
}
function Dt(t) {
	if (null === Mt) return t();
	const e = Mt;
	Mt = null;
	try {
		return t();
	} finally {
		Mt = e;
	}
}
function It(t) {
	return null === vt || (null === vt.cleanups ? vt.cleanups = [t] : vt.cleanups.push(t)), t;
}
const [Ct, jt] = Nt(!1);
function Ft() {
	const t = At && At.running;
	if (this.sources && (t ? this.tState : this.state)) if ((t ? this.tState : this.state) === bt) Ot(this);
	else {
		const t = xt;
		xt = null, Lt(() => Ut(this), !1), xt = t;
	}
	if (Mt) {
		const t = this.observers;
		if (!t || t[t.length - 1] !== Mt) {
			const e = t ? t.length : 0;
			Mt.sources ? (Mt.sources.push(this), Mt.sourceSlots.push(e)) : (Mt.sources = [this], Mt.sourceSlots = [e]), t ? (t.push(Mt), this.observerSlots.push(Mt.sources.length - 1)) : (this.observers = [Mt], this.observerSlots = [Mt.sources.length - 1]);
		}
	}
	return t && At.sources.has(this) ? this.tValue : this.value;
}
function Rt(t, e, n) {
	let s = At && At.running && At.sources.has(t) ? t.tValue : t.value;
	if (!t.comparator || !t.comparator(s, e)) {
		if (At) {
			const s = At.running;
			(s || !n && At.sources.has(t)) && (At.sources.add(t), t.tValue = e), s || (t.value = e);
		} else t.value = e;
		t.observers && t.observers.length && Lt(() => {
			for (let e = 0; e < t.observers.length; e += 1) {
				const n = t.observers[e], s = At && At.running;
				s && At.disposed.has(n) || ((s ? n.tState : n.state) || (n.pure ? xt.push(n) : Et.push(n), n.observers && _t(n)), s ? n.tState = bt : n.state = bt);
			}
			if (xt.length > 1e6) throw xt = [], /* @__PURE__ */ new Error();
		}, !1);
	}
	return e;
}
function Ot(t) {
	if (!t.fn) return;
	Kt(t);
	const e = Tt;
	Qt(t, At && At.running && At.sources.has(t) ? t.tValue : t.value, e), At && !At.running && At.sources.has(t) && queueMicrotask(() => {
		Lt(() => {
			At && (At.running = !0), Mt = vt = t, Qt(t, t.tValue, e), Mt = vt = null;
		}, !1);
	});
}
function Qt(t, e, n) {
	let s;
	const r = vt, o = Mt;
	Mt = vt = t;
	try {
		s = t.fn(e);
	} catch (i) {
		return t.pure && (At && At.running ? (t.tState = bt, t.tOwned && t.tOwned.forEach(Kt), t.tOwned = void 0) : (t.state = bt, t.owned && t.owned.forEach(Kt), t.owned = null)), t.updatedAt = n + 1, Ht(i);
	} finally {
		Mt = o, vt = r;
	}
	(!t.updatedAt || t.updatedAt <= n) && (null != t.updatedAt && "observers" in t ? Rt(t, s, !0) : At && At.running && t.pure ? (At.sources.has(t) || (t.value = s), At.sources.add(t), t.tValue = s) : t.value = s, t.updatedAt = n);
}
function zt(t) {
	const e = At && At.running;
	if (0 === (e ? t.tState : t.state)) return;
	if ((e ? t.tState : t.state) === wt) return Ut(t);
	if (t.suspense && Dt(t.suspense.inFallback)) return t.suspense.effects.push(t);
	const n = [t];
	for (; (t = t.owner) && (!t.updatedAt || t.updatedAt < Tt);) {
		if (e && At.disposed.has(t)) return;
		(e ? t.tState : t.state) && n.push(t);
	}
	for (let s = n.length - 1; s >= 0; s--) {
		if (t = n[s], e) {
			let e = t, r = n[s + 1];
			for (; (e = e.owner) && e !== r;) if (At.disposed.has(e)) return;
		}
		if ((e ? t.tState : t.state) === bt) Ot(t);
		else if ((e ? t.tState : t.state) === wt) {
			const e = xt;
			xt = null, Lt(() => Ut(t, n[0]), !1), xt = e;
		}
	}
}
function Lt(t, e) {
	if (xt) return t();
	let n = !1;
	e || (xt = []), Et ? n = !0 : Et = [], Tt++;
	try {
		const e = t();
		return function(t) {
			if (xt && (Wt(xt), xt = null), t) return;
			let e;
			if (At) if (At.promises.size || At.queue.size) {
				if (At.running) return At.running = !1, At.effects.push.apply(At.effects, Et), Et = null, void jt(!0);
			} else {
				const t = At.sources, n = At.disposed;
				Et.push.apply(Et, At.effects), e = At.resolve;
				for (const e of Et) "tState" in e && (e.state = e.tState), delete e.tState;
				At = null, Lt(() => {
					for (const t of n) Kt(t);
					for (const e of t) {
						if (e.value = e.tValue, e.owned) for (let t = 0, n = e.owned.length; t < n; t++) Kt(e.owned[t]);
						e.tOwned && (e.owned = e.tOwned), delete e.tValue, delete e.tOwned, e.tState = 0;
					}
					jt(!1);
				}, !1);
			}
			const n = Et;
			Et = null, n.length && Lt(() => yt(n), !1), e && e();
		}(n), e;
	} catch (s) {
		n || (Et = null), xt = null, Ht(s);
	}
}
function Wt(t) {
	for (let e = 0; e < t.length; e++) zt(t[e]);
}
function qt(t) {
	let e, n = 0;
	for (e = 0; e < t.length; e++) {
		const s = t[e];
		s.user ? t[n++] = s : zt(s);
	}
	if (dt.context) {
		if (dt.count) return dt.effects || (dt.effects = []), void dt.effects.push(...t.slice(0, n));
		dt.context = void 0;
	}
	for (!dt.effects || !dt.done && dt.count || (t = [...dt.effects, ...t], n += dt.effects.length, delete dt.effects), e = 0; e < n; e++) zt(t[e]);
}
function Ut(t, e) {
	const n = At && At.running;
	n ? t.tState = 0 : t.state = 0;
	for (let s = 0; s < t.sources.length; s += 1) {
		const r = t.sources[s];
		if (r.sources) {
			const t = n ? r.tState : r.state;
			t === bt ? r !== e && (!r.updatedAt || r.updatedAt < Tt) && zt(r) : t === wt && Ut(r, e);
		}
	}
}
function _t(t) {
	const e = At && At.running;
	for (let n = 0; n < t.observers.length; n += 1) {
		const s = t.observers[n];
		(e ? s.tState : s.state) || (e ? s.tState = wt : s.state = wt, s.pure ? xt.push(s) : Et.push(s), s.observers && _t(s));
	}
}
function Kt(t) {
	let e;
	if (t.sources) for (; t.sources.length;) {
		const e = t.sources.pop(), n = t.sourceSlots.pop(), s = e.observers;
		if (s && s.length) {
			const t = s.pop(), r = e.observerSlots.pop();
			n < s.length && (t.sourceSlots[r] = n, s[n] = t, e.observerSlots[n] = r);
		}
	}
	if (t.tOwned) {
		for (e = t.tOwned.length - 1; e >= 0; e--) Kt(t.tOwned[e]);
		delete t.tOwned;
	}
	if (At && At.running && t.pure) Jt(t, !0);
	else if (t.owned) {
		for (e = t.owned.length - 1; e >= 0; e--) Kt(t.owned[e]);
		t.owned = null;
	}
	if (t.cleanups) {
		for (e = t.cleanups.length - 1; e >= 0; e--) t.cleanups[e]();
		t.cleanups = null;
	}
	At && At.running ? t.tState = 0 : t.state = 0;
}
function Jt(t, e) {
	if (e || (t.tState = 0, At.disposed.add(t)), t.owned) for (let n = 0; n < t.owned.length; n++) Jt(t.owned[n]);
}
function Ht(t, e = vt) {
	throw function(t) {
		return t instanceof Error ? t : new Error("string" == typeof t ? t : "Unknown error", { cause: t });
	}(t);
}
const Vt = { equals: !1 };
var Xt = class {
	#t;
	constructor(t = Map) {
		this.#t = new t();
	}
	dirty(t) {
		this.#t.get(t)?.$$();
	}
	dirtyAll() {
		for (const t of this.#t.values()) t.$$();
	}
	track(t) {
		if (!Mt) return;
		let e = this.#t.get(t);
		if (e) e.n++;
		else {
			const [n, s] = Nt(void 0, Vt);
			this.#t.set(t, e = {
				$: n,
				$$: s,
				n: 1
			});
		}
		It(() => {
			0 === --e.n && queueMicrotask(() => 0 === e.n && this.#t.delete(t));
		}), e.$();
	}
};
const Gt = Symbol("track-keys");
var Yt = class extends Set {
	#e = new Xt();
	constructor(t) {
		if (super(), t) for (const e of t) super.add(e);
	}
	[Symbol.iterator]() {
		return this.values();
	}
	get size() {
		return this.#e.track(Gt), super.size;
	}
	has(t) {
		return this.#e.track(t), super.has(t);
	}
	keys() {
		return this.values();
	}
	*values() {
		this.#e.track(Gt);
		for (const t of super.values()) yield t;
	}
	*entries() {
		this.#e.track(Gt);
		for (const t of super.entries()) yield t;
	}
	forEach(t, e) {
		this.#e.track(Gt), super.forEach(t, e);
	}
	add(t) {
		return super.has(t) || (super.add(t), Pt(() => {
			this.#e.dirty(t), this.#e.dirty(Gt);
		})), this;
	}
	delete(t) {
		const e = super.delete(t);
		return e && Pt(() => {
			this.#e.dirty(t), this.#e.dirty(Gt);
		}), e;
	}
	clear() {
		super.size && Pt(() => {
			this.#e.dirty(Gt);
			for (const t of super.values()) this.#e.dirty(t);
			super.clear();
		});
	}
};
if (!function() {
	let t = 0, e = null;
	(function(t) {
		const e = Mt, n = vt, s = 0 === t.length, r = n, o = s ? kt : {
			owned: null,
			cleanups: null,
			context: r ? r.context : null,
			owner: r
		}, i = s ? t : () => t();
		vt = o, Mt = null;
		try {
			return Lt(i, !0);
		} finally {
			Mt = e, vt = n;
		}
	})(() => {
		const [n, s] = Nt(0);
		e = () => s((t) => t + 1), function(t, e, n) {
			yt = qt;
			const s = function(t, e, n, s = bt) {
				const r = {
					fn: t,
					state: s,
					updatedAt: null,
					owned: null,
					sources: null,
					sourceSlots: null,
					cleanups: null,
					value: e,
					owner: vt,
					context: vt ? vt.context : null,
					pure: n
				};
				if (At && At.running && (r.state = 0, r.tState = s), null === vt || vt !== kt && (At && At.running && vt.pure ? vt.tOwned ? vt.tOwned.push(r) : vt.tOwned = [r] : vt.owned ? vt.owned.push(r) : vt.owned = [r]), St);
				return r;
			}(t, e, !1, bt);
			n && n.render || (s.user = !0), Et ? Et.push(s) : Ot(s);
		}(() => {
			n(), t++;
		});
	});
	const n = t;
	return e && e(), n > 0 && t > n;
}()) throw new Error("reactive.js: solid-js resolved to the non-reactive SSR build, so effects and memos will never run. Run Node with --conditions=browser (see the \"test\" script in package.json).");
const Zt = {
	DFA: {
		label: "DFA",
		fullName: "Deterministic Finite Automaton",
		category: "fa",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-dfa",
		file: "dfa"
	},
	NFA: {
		label: "NFA",
		fullName: "Nondeterministic Finite Automaton",
		category: "fa",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-nfa",
		file: "nfa"
	},
	"ε-NFA": {
		label: "ε-NFA",
		fullName: "Finite Automaton with ε-Transitions",
		category: "fa",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-enfa",
		file: "enfa"
	},
	"2DFA": {
		label: "2DFA",
		fullName: "Two-Way Deterministic Finite Automaton",
		category: "fa",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		hasEndMarkers: !0,
		isTransducer: !1,
		badge: "bd-2dfa",
		file: "twdfa"
	},
	"2NFA": {
		label: "2NFA",
		fullName: "Two-Way Nondeterministic Finite Automaton",
		category: "fa",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		hasEndMarkers: !0,
		isTransducer: !1,
		badge: "bd-2nfa",
		file: "twnfa"
	},
	PFA: {
		label: "PFA",
		fullName: "Probabilistic Finite Automaton",
		category: "fa",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isWeighted: !0,
		badge: "bd-pfa",
		file: "pfa"
	},
	DBA: {
		label: "DBA",
		fullName: "Deterministic Büchi Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "buchi",
		deterministic: !0,
		badge: "bd-dba",
		file: "dba"
	},
	DcoBA: {
		label: "DcoBA",
		fullName: "Deterministic co-Büchi Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "cobuchi",
		deterministic: !0,
		badge: "bd-dba",
		file: "dcoba"
	},
	DPA: {
		label: "DPA",
		fullName: "Deterministic Parity Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "parity",
		deterministic: !0,
		badge: "bd-dba",
		file: "dpa"
	},
	DWA: {
		label: "DWA",
		fullName: "Deterministic Weak Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "weak",
		deterministic: !0,
		badge: "bd-dba",
		file: "dwa"
	},
	NBA: {
		label: "NBA",
		fullName: "Nondeterministic Büchi Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "buchi",
		deterministic: !1,
		badge: "bd-nba",
		file: "buchi"
	},
	NcoBA: {
		label: "NcoBA",
		fullName: "Nondeterministic co-Büchi Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "cobuchi",
		deterministic: !1,
		badge: "bd-nba",
		file: "ncoba"
	},
	NPA: {
		label: "NPA",
		fullName: "Nondeterministic Parity Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "parity",
		deterministic: !1,
		badge: "bd-nba",
		file: "npa"
	},
	NWA: {
		label: "NWA",
		fullName: "Nondeterministic Weak Automaton",
		category: "omega",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !1,
		isOmega: !0,
		omegaCondition: "weak",
		deterministic: !1,
		badge: "bd-nba",
		file: "nwa"
	},
	DPDA: {
		label: "DPDA",
		fullName: "Deterministic Pushdown Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-dpda",
		file: "pda"
	},
	PDA: {
		label: "PDA",
		fullName: "Pushdown Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-dpda",
		file: "pda"
	},
	NPDA: {
		label: "NPDA",
		fullName: "Nondeterministic Pushdown Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-npda",
		file: "npda"
	},
	QA: {
		label: "Queue Automaton",
		fullName: "Queue Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-qa",
		file: "queue"
	},
	Counter: {
		label: "Counter Automaton",
		fullName: "One-Counter Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-counter",
		file: "counter"
	},
	"2PDA": {
		label: "2-Stack PDA",
		fullName: "Two-Stack Pushdown Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-2pda",
		file: "twopda"
	},
	EPDA: {
		label: "EPDA",
		fullName: "Embedded Pushdown Automaton",
		category: "mem",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !1,
		badge: "bd-epda",
		file: "epda"
	},
	TM: {
		label: "TM (DTM)",
		fullName: "Deterministic Turing Machine",
		category: "tm",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !0,
		hasTape: !0,
		isTransducer: !1,
		badge: "bd-tm",
		file: "tm"
	},
	NDTM: {
		label: "NDTM",
		fullName: "Nondeterministic Turing Machine",
		category: "tm",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !0,
		hasTape: !0,
		isTransducer: !1,
		badge: "bd-ndtm",
		file: "ndtm"
	},
	MTM: {
		label: "MTM",
		fullName: "Multi-Tape Turing Machine",
		category: "tm",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !0,
		isTransducer: !1,
		badge: "bd-mtm",
		file: "mtm"
	},
	LBA: {
		label: "LBA",
		fullName: "Linear Bounded Automaton",
		category: "tm",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !0,
		hasTape: !0,
		hasEndMarkers: !0,
		isTransducer: !1,
		badge: "bd-lba",
		file: "lba"
	},
	ITM: {
		label: "2-Way Infinite TM",
		fullName: "Two-Way Infinite Turing Machine",
		category: "tm",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !0,
		hasTape: !0,
		isTransducer: !1,
		twoWayTape: !0,
		badge: "bd-itm",
		file: "ittm"
	},
	Moore: {
		label: "Moore",
		fullName: "Moore Machine",
		category: "special",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !0,
		badge: "bd-moore",
		file: "moore"
	},
	Mealy: {
		label: "Mealy",
		fullName: "Mealy Machine",
		category: "special",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !0,
		badge: "bd-mealy",
		file: "mealy"
	},
	FST: {
		label: "FST",
		fullName: "Finite State Transducer",
		category: "special",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !1,
		hasTape: !1,
		isTransducer: !0,
		badge: "bd-fst",
		file: "fst"
	},
	PDT: {
		label: "Pushdown Transducer",
		fullName: "Pushdown Transducer",
		category: "special",
		implemented: !0,
		hasEpsilon: !0,
		hasStack: !0,
		hasTape: !1,
		isTransducer: !0,
		badge: "bd-pdt",
		file: "pdt"
	},
	"2DFT": {
		label: "2-Way Transducer",
		fullName: "Two-Way Deterministic Finite Transducer",
		category: "special",
		implemented: !0,
		hasEpsilon: !1,
		hasStack: !1,
		hasTape: !1,
		hasEndMarkers: !0,
		isTransducer: !0,
		badge: "bd-2dft",
		file: "twodft"
	}
}, te = {
	buchi: {
		label: "Büchi",
		tuple: "F",
		say: "inf(r) ∩ F ≠ ∅ — some accepting state recurs forever",
		usesPriority: !1,
		structural: !1
	},
	cobuchi: {
		label: "co-Büchi",
		tuple: "F",
		say: "inf(r) ∩ F = ∅ — every state of F is visited only finitely often",
		usesPriority: !1,
		structural: !1
	},
	parity: {
		label: "Parity",
		tuple: "Ω",
		say: "the least priority recurring forever is even",
		usesPriority: !0,
		structural: !1
	},
	weak: {
		label: "Weak",
		tuple: "F",
		say: "Büchi acceptance, on an automaton whose every SCC lies inside F or outside it",
		usesPriority: !1,
		structural: !0
	}
};
function ee(t, e) {
	let n = t[e] instanceof Yt ? t[e] : new Yt(t[e] || []);
	Object.defineProperty(t, e, {
		get: () => n,
		set(t) {
			n = t instanceof Yt ? t : new Yt(t || []);
		},
		enumerable: !0,
		configurable: !0
	});
}
const ne = {
	machine: "DFA",
	tool: "move",
	view: "build",
	sigma: new Yt(["a", "b"]),
	outputAlpha: new Yt(["0", "1"]),
	stackAlpha: new Yt(["Z"]),
	tapeCount: 2,
	states: [],
	transitions: [],
	startId: null,
	accepts: new Yt(),
	selectedStates: new Yt(),
	selectedTransitions: new Yt(),
	stateN: 0,
	transN: 0,
	meta: null,
	exercise: null,
	lexer: null,
	notes: [],
	noteN: 0,
	activeNoteId: null,
	selectedNotes: new Yt(),
	ctxNoteId: null,
	editNoteId: null,
	resizeNoteId: null,
	resizeNoteStart: null,
	dividers: [],
	dividerN: 0,
	selectedDividers: new Yt(),
	blocks: [],
	blockN: 0,
	scope: [],
	ctxDividerId: null,
	editDividerId: null,
	dragDividerEndpoint: null,
	dividerDraft: null,
	dividerDraftEl: null,
	lastShapeTool: "divider",
	edgeHighlight: null,
	config: {
		theme: "light",
		transducerAccepts: !1,
		twoWayTape: !1,
		maxTapeCount: 8,
		maxPdaSteps: 2e3,
		maxTmSteps: 1e4,
		detectLoops: !0,
		execMode: "auto",
		langStepBudget: 400,
		autoSpeed: 500,
		autosaveIntervalMs: 15e3,
		cardAutoHideMs: 13e3,
		radius: 30,
		zoom: {
			min: .2,
			max: 3,
			step: .1
		},
		wheelZoom: !0,
		snapToGrid: !1,
		wrapStateLabels: !0,
		edgeLabelStyle: "compact",
		clickHighlightMode: "off",
		layout: {
			minRadius: 80,
			nodeSpacing: 35,
			algorithm: "sugiyama"
		},
		gridSnap: 20,
		sym: {
			eps: "ε",
			any: "Σ",
			blank: "⊔",
			leftMarker: "⊢",
			rightMarker: "⊣",
			stackBottom: "Z",
			lambda: "λ"
		},
		pdaParadigm: "explicit",
		pfaCutPoint: .5,
		statePrefix: "q",
		render: {
			startArrowLen: 28,
			selfLoopSize: 22,
			selfLoopOff: 12,
			selfLoopTextOff: 30,
			curveOff: 45,
			arrowHeadSize: 6,
			textMargin: 8,
			mooreTextMargin: 9,
			nodeClearance: 12,
			labelGap: 5,
			minNodeGap: 8,
			smartSelfLoops: !0,
			autoRouteEdges: !0,
			smartLabels: !0,
			avoidNodeOverlap: !0,
			animateLayout: !0,
			largeMachineAuto: !0
		},
		exportRes: 2,
		export: {
			bg: "#12151b",
			nodeFill: "#1c212b",
			nodeStroke: "rgba(230, 233, 240, 0.13)",
			startStroke: "#4dca8b",
			accStroke: "#f0c14b",
			actFill: "rgba(94, 161, 255, 0.2)",
			actStroke: "#5ea1ff",
			edgeStroke: "#737d90",
			textFill: "#a7afbe",
			nodeTextFill: "#e6e9f0"
		}
	},
	cam: {
		x: 0,
		y: 0,
		z: 1
	},
	history: [],
	future: [],
	drag: null,
	dragOff: {
		x: 0,
		y: 0
	},
	transFrom: null,
	ctxId: null,
	ctxEdge: null,
	ctxMode: null,
	editId: null,
	spacePan: !1,
	toolbarDock: null,
	toolbarDragging: null,
	toolbarPreviewDock: null,
	transEditId: null,
	transModalMode: "add",
	transModalIds: [],
	simSteps: [],
	simIdx: 0,
	simInput: null,
	autoTimer: null,
	simRun: null,
	simDrainTimer: null,
	grammar: function(t = ["S"], e = "S", n = []) {
		const s = {
			vars: new Yt(t),
			start: e,
			productions: n
		};
		return ee(s, "vars"), s;
	}(),
	currentAlgo: "table",
	domCache: {
		states: /* @__PURE__ */ new Map(),
		transitions: /* @__PURE__ */ new Map(),
		notes: /* @__PURE__ */ new Map(),
		dividers: /* @__PURE__ */ new Map(),
		startArrow: null
	},
	stateClassification: null,
	workspaceB: null,
	directions: [
		{
			value: "R",
			label: "Right"
		},
		{
			value: "L",
			label: "Left"
		},
		{
			value: "S",
			label: "Stay"
		}
	]
};
for (const Ni of [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts",
	"selectedStates",
	"selectedTransitions",
	"selectedNotes",
	"selectedDividers"
]) ee(ne, Ni);
let se = null, re = null, oe = -1, ie = null, ae = null;
function le() {
	return ne.simStart || ne.startId;
}
function ce(t) {
	return function() {
		const t = ne.states || [], e = t.length;
		if (re === t && oe === e && ie === t[0] && ae === t[e - 1]) return se;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) n.set(t[s].id, t[s]);
		return se = n, re = t, oe = e, ie = t[0], ae = t[e - 1], n;
	}().get(t);
}
function ue(t) {
	return Zt[t] || Zt.DFA;
}
function he(t = ne.machine) {
	return !("LBA" === t || !ue(t).twoWayTape && !ne.config.twoWayTape);
}
function fe() {
	return !1 !== ne.config.detectLoops;
}
function pe(t = ne.machine) {
	const e = ue(t).omegaCondition;
	return te[e] ? e : "buchi";
}
function de(t) {
	const e = Number(t?.priority);
	return Number.isInteger(e) && e >= 0 ? e : 0;
}
function me() {
	return {
		left: ne.config.sym.leftMarker,
		right: ne.config.sym.rightMarker
	};
}
ne.config.radius;
const ye = /* @__PURE__ */ new Map();
function be(t, e) {
	if (ye.has(t)) throw new Error(`Machine "${t}" is already defined.`);
	if (!e || "object" != typeof e) throw new Error(`Machine "${t}" needs a definition object.`);
	return ye.set(t, {
		id: t,
		...e
	}), ye.get(t);
}
function we(t, e) {
	for (const [n, s] of Object.entries(e)) be(n, {
		...t,
		...s
	});
}
var ke = class {
	constructor(t, e, n) {
		this.count = t, this.last = e, this.at = n;
	}
};
const ve = (t, e, n) => new ke(t, e, n), Ae = 4096, $e = 4095, Se = (t, e) => {
	const n = new t(Ae);
	return e.push(n), n;
};
var Me = class {
	constructor() {
		this.Type = Uint8Array, this.max = 255, this.chunks = [], this.length = 0;
	}
	push(t) {
		t > this.max && this.widen(t);
		const e = this.length++;
		(this.chunks[e >>> 12] || Se(this.Type, this.chunks))[e & $e] = t;
	}
	get(t) {
		return this.chunks[t >>> 12][t & $e];
	}
	set(t, e) {
		e > this.max && this.widen(e), this.chunks[t >>> 12][t & $e] = e;
	}
	widen(t) {
		const e = t <= 65535 ? Uint16Array : Uint32Array;
		this.chunks = this.chunks.map((t) => e.from(t)), this.Type = e, this.max = e === Uint16Array ? 65535 : 4294967295;
	}
	pushMany(t, e) {
		let n = 0;
		for (let r = 0; r < e; r++) t[r] > n && (n = t[r]);
		n > this.max && this.widen(n);
		let s = 0;
		for (; s < e;) {
			const n = this.length, r = this.chunks[n >>> 12] || Se(this.Type, this.chunks), o = Math.min(e - s, Ae - (n & $e));
			r.set(t.subarray(s, s + o), n & $e), this.length += o, s += o;
		}
	}
	bytes() {
		return this.chunks.length * Ae * this.Type.BYTES_PER_ELEMENT;
	}
}, xe = class {
	constructor() {
		this.deltas = [], this.anchors = [], this.nAnchors = 0, this.jumps = null, this.length = 0, this.last = 0, this.ci = -1, this.cv = 0;
	}
	push(t) {
		const e = this.length++, n = this.deltas[e >>> 12] || Se(Int8Array, this.deltas);
		if (e % 64 == 0) {
			const e = this.nAnchors++;
			(this.anchors[e >>> 12] || Se(Int32Array, this.anchors))[e & $e] = t;
		}
		const s = 0 === e ? 0 : t - this.last;
		s > -128 && s <= 127 ? n[e & $e] = s : (n[e & $e] = -128, (this.jumps ??= /* @__PURE__ */ new Map()).set(e, t)), this.last = t;
	}
	pushMany(t, e) {
		let n = 0, s = this.last;
		for (; n < e;) {
			let r = this.length;
			const o = this.deltas[r >>> 12] || Se(Int8Array, this.deltas), i = n + Math.min(e - n, Ae - (r & $e));
			for (; n < i; n++, r++) {
				const e = t[n];
				if (r % 64 == 0) {
					const t = this.nAnchors++;
					(this.anchors[t >>> 12] || Se(Int32Array, this.anchors))[t & $e] = e;
				}
				const i = 0 === r ? 0 : e - s;
				i > -128 && i <= 127 ? o[r & $e] = i : (o[r & $e] = -128, (this.jumps ??= /* @__PURE__ */ new Map()).set(r, e)), s = e;
			}
			this.length = r;
		}
		this.last = s;
	}
	anchor(t) {
		const e = t / 64;
		return this.anchors[e >>> 12][e & $e];
	}
	after(t, e) {
		const n = this.deltas[t >>> 12][t & $e];
		return -128 === n ? this.jumps.get(t) : e + n;
	}
	get(t) {
		if (t === this.ci + 1 && t < this.length && t > 0) return this.cv = this.after(t, this.cv), this.ci = t, this.cv;
		if (!(t >= 0 && t < this.length)) return;
		if (t === this.ci) return this.cv;
		if (t === this.length - 1) return this.last;
		const e = t - t % 64;
		if (this.ci > t && this.ci - t < t - e && this.ci < e + 64 && null === this.jumps) {
			let e = this.cv;
			for (let n = this.ci; n > t; n--) e -= this.deltas[n >>> 12][n & $e];
			return this.ci = t, this.cv = e, e;
		}
		let n, s;
		for (this.ci >= e && this.ci < t ? (n = this.ci, s = this.cv) : (n = e, s = this.anchor(e)); n < t;) s = this.after(++n, s);
		return this.ci = t, this.cv = s, s;
	}
	bytes() {
		return (this.deltas.length + 4 * this.anchors.length) * Ae;
	}
};
const Ee = [
	0,
	255,
	65535,
	0,
	4294967295
];
var Te = class {
	constructor() {
		this.buf = /* @__PURE__ */ new Uint8Array(0), this.base = 0, this.lo = 1 / 0, this.hi = -1 / 0;
	}
	get(t) {
		const e = t - this.base;
		return e >= 0 && e < this.buf.length ? this.buf[e] : 0;
	}
	set(t, e) {
		let n = t - this.base;
		if (n < 0 || n >= this.buf.length) {
			if (0 === e) return;
			this.ensure(t, t), n = t - this.base;
		}
		e > Ee[this.buf.BYTES_PER_ELEMENT] && this.widen(e), this.buf[n] = e, 0 !== e && (t < this.lo && (this.lo = t), t > this.hi && (this.hi = t));
	}
	ensure(t, e) {
		const n = this.buf.length;
		if (n && t >= this.base && e < this.base + n) return;
		const s = n ? Math.min(this.base, t) : t, r = n ? Math.max(this.base + n - 1, e) : e, o = Math.max(64, 2 * (r - s + 1)), i = o - (r - s + 1), a = n && t < this.base, l = n && e >= this.base + n, c = s - (a ? l ? i >> 1 : i : 0), u = new this.buf.constructor(o);
		n && u.set(this.buf, this.base - c), this.buf = u, this.base = c;
	}
	widen(t) {
		const e = t <= 65535 ? Uint16Array : Uint32Array;
		this.buf = e.from(this.buf);
	}
	snapshot(t) {
		return this.lo > this.hi ? {
			row: t,
			lo: 0,
			codes: /* @__PURE__ */ new Uint8Array(0)
		} : {
			row: t,
			lo: this.lo,
			codes: this.buf.slice(this.lo - this.base, this.hi - this.base + 1)
		};
	}
	load(t) {
		this.lo <= this.hi && this.buf.fill(0, this.lo - this.base, this.hi - this.base + 1), this.lo = 1 / 0, this.hi = -1 / 0;
		const e = t.codes.length;
		e && (this.ensure(t.lo, t.lo + e - 1), t.codes.BYTES_PER_ELEMENT > this.buf.BYTES_PER_ELEMENT && this.widen(Ee[t.codes.BYTES_PER_ELEMENT]), this.buf.set(t.codes, t.lo - this.base), this.lo = t.lo, this.hi = t.lo + e - 1);
	}
	extent() {
		const t = this.buf, e = this.base;
		let n = this.lo, s = this.hi;
		for (; n <= s && 0 === t[n - e];) n++;
		if (n > s) return null;
		for (; 0 === t[s - e];) s--;
		return [n, s];
	}
	bytes() {
		return this.buf.length * this.buf.BYTES_PER_ELEMENT;
	}
};
function Ne() {
	const t = /* @__PURE__ */ new Map(), e = [void 0];
	return {
		values: e,
		code(n) {
			let s = t.get(n);
			return void 0 === s && (s = e.length, t.set(n, s), e.push(n)), s;
		},
		value: (t) => e[t]
	};
}
function Pe(t) {
	const e = t.blank, n = t.twoWay, s = t.rightBound, r = t.immutable ? [...t.immutable] : [], o = new Map(t.cells), i = Ne(), a = i.values, l = i.code(e), c = new xe(), u = new Me(), h = new Me();
	let f = null, p = null;
	const d = new Te();
	for (const [N, P] of o) d.set(N, i.code(P));
	const m = [];
	let g = 0;
	function y(t) {
		const e = d.snapshot(t);
		return m.push(e), g = t + Math.max(1024, e.codes.length), g;
	}
	const b = new Te();
	let w = -1, k = -1, v = null, A = 0;
	function $(t, e) {
		if (t >= e) return;
		A += e - t;
		const n = f, s = h.chunks, r = c.deltas;
		let o = c.get(t), i = t, a = s[i >>> 12], l = r[i >>> 12];
		for (;;) {
			const t = a[i & $e];
			if (0 !== t && b.set(null !== n && n.has(i) ? n.get(i) : o, 1 === t ? 0 : t - 1), ++i >= e) return;
			4095 & i || (a = s[i >>> 12], l = r[i >>> 12]);
			const u = l[i & $e];
			o = -128 === u ? c.jumps.get(i) : o + u;
		}
	}
	function S(t, e) {
		if (t <= e) return;
		A += t - e;
		const n = f, s = p;
		let r = t - 1, o = c.get(r);
		for (;;) {
			if (0 !== h.get(r)) {
				let t;
				if (null !== s && s.has(r)) t = s.get(r);
				else {
					const e = u.get(r);
					t = e === l ? 0 : e;
				}
				b.set(null !== n && n.has(r) ? n.get(r) : o, t);
			}
			if (--r < e) return;
			const t = c.deltas[r + 1 >>> 12][r + 1 & $e];
			o = -128 === t ? c.get(r) : o - t;
		}
	}
	function M(t) {
		if (t === w) return;
		let e = 0, n = m.length - 1, s = -1;
		for (; e <= n;) {
			const r = e + n >> 1;
			m[r].row <= t ? (s = r, e = r + 1) : n = r - 1;
		}
		const r = m[s], o = m[s + 1], i = b.lo <= b.hi ? b.hi - b.lo + 1 : 0, a = (t) => (t.codes.length + i) / 32;
		let l = 0, c = r ? t - r.row + a(r) : 1 / 0;
		w >= 0 && Math.abs(t - w) <= c && (l = 1, c = Math.abs(t - w)), o && o.row - t + a(o) < c && (l = 2), 1 === l ? w < t ? $(w, t) : S(w, t) : 2 === l ? (b.load(o), S(o.row, t)) : (b.load(r), $(r.row, t)), w = t;
	}
	function x(t) {
		if (t === k) return v;
		M(t);
		const r = c.get(t) ?? 0, o = b.extent();
		let i, l = 0;
		n && (l = r, o && o[0] < l && (l = o[0])), null !== s ? i = s : (i = r > l ? r : l, o && o[1] > i && (i = o[1]));
		const u = b.buf, h = b.base, f = u.length, p = [];
		for (let n = l; n <= i; n++) {
			const t = n - h, s = t >= 0 && t < f ? u[t] : 0;
			p.push(0 === s ? e : a[s]);
		}
		return v = {
			tape: p,
			head: r - l,
			origin: l
		}, k = t, v;
	}
	const E = (t) => {
		if (0 === h.get(t)) return;
		const e = f?.get(t);
		return void 0 === e ? c.get(t) : e;
	}, T = (t) => {
		const e = h.get(t);
		return e <= 1 ? void 0 : a[e - 1];
	};
	return {
		cols: null,
		begin(t, e) {
			const n = c.length;
			return n >= g && y(n), c.push(t), u.push(void 0 === e ? 0 : i.code(e)), h.push(0), n;
		},
		noteWrite(t, e, n) {
			const s = n.has(e) ? i.code(n.get(e)) : 0;
			h.set(t, 0 === s ? 1 : s + 1);
			const r = e !== c.get(t);
			r && (f ??= /* @__PURE__ */ new Map()).set(t, e);
			const o = d.get(e), a = u.get(t);
			(r || o !== (a === l ? 0 : a)) && (p ??= /* @__PURE__ */ new Map()).set(t, o), d.set(e, s);
		},
		appender: () => ({
			live: d,
			heads: c,
			reads: u,
			writes: h,
			syms: i,
			blankCode: l,
			get nextCheckpoint() {
				return g;
			},
			checkpoint: y,
			undoException(t, e) {
				(p ??= /* @__PURE__ */ new Map()).set(t, e);
			}
		}),
		frameAt: x,
		headAt: (t) => c.get(t),
		readAt(t) {
			const n = u.get(t);
			if (0 !== n) return a[n];
			M(t);
			const s = b.get(c.get(t));
			return 0 === s ? e : a[s];
		},
		replayed: () => A,
		journal() {
			const t = {
				head: void 0,
				cell: void 0,
				sym: void 0,
				code: 0
			};
			let i = -1, l = 0;
			return {
				initial: o,
				blank: e,
				twoWay: n,
				rightBound: s,
				markers: r,
				checkpoints: m,
				leftBound: n ? null : 0,
				get length() {
					return c.length;
				},
				head: (t) => c.get(t),
				cell: E,
				sym: T,
				symbol: (t) => 0 === t ? e : a[t],
				into(e) {
					let n, s;
					if (e === i + 1 && e > 0 && e < c.length) {
						s = l;
						const t = c.deltas[e >>> 12][e & $e];
						n = -128 === t ? c.jumps.get(e) : s + t;
					} else s = e > 0 ? c.get(e - 1) : void 0, n = c.get(e);
					if (void 0 !== n && (i = e, l = n), t.head = n, t.cell = t.sym = void 0, t.code = 0, e > 0 && e <= h.length) {
						const n = e - 1, r = h.chunks[n >>> 12][n & $e];
						0 !== r && (t.cell = null !== f && f.has(n) ? f.get(n) : s, 1 !== r && (t.sym = a[r - 1], t.code = r - 1));
					}
					return t;
				}
			};
		},
		viewAt(t) {
			const o = x(t);
			return {
				kind: "tape",
				cells: o.tape,
				head: o.head,
				origin: o.origin,
				leftBound: n ? null : 0,
				rightBound: s,
				markers: r,
				blank: e,
				readOnly: !1
			};
		},
		bytes: () => c.bytes() + u.bytes() + h.bytes() + d.bytes() + b.bytes() + m.reduce((t, e) => t + e.codes.byteLength, 0)
	};
}
const De = (t) => (t._log || t._logs[0]).cols, Ie = {
	state: {
		get() {
			return De(this).stateAt(this._i);
		},
		configurable: !0
	},
	tid: {
		get() {
			return De(this).tidAt(this._i);
		},
		configurable: !0
	},
	tokens: {
		get() {
			return De(this).tokens;
		},
		configurable: !0
	},
	note: {
		get() {
			const t = De(this);
			return t.noteAt(this._i, t);
		},
		set(t) {
			((t, e) => {
				Object.defineProperty(t, "note", {
					value: e,
					writable: !0,
					enumerable: !0,
					configurable: !0
				});
			})(this, t);
		},
		configurable: !0
	}
}, Ce = Object.create(Object.prototype, {
	...Ie,
	tape: {
		get() {
			return this._log.frameAt(this._i).tape;
		},
		configurable: !0
	},
	head: {
		get() {
			return this._log.frameAt(this._i).head;
		},
		configurable: !0
	},
	view: {
		get() {
			return this._log.viewAt(this._i);
		},
		configurable: !0
	}
}), je = Object.create(Object.prototype, {
	...Ie,
	tapes: {
		get() {
			return this._logs.map((t) => t.frameAt(this._i).tape);
		},
		configurable: !0
	},
	heads: {
		get() {
			return this._logs.map((t) => t.frameAt(this._i).head);
		},
		configurable: !0
	},
	views: {
		get() {
			return this._logs.map((t) => t.viewAt(this._i));
		},
		configurable: !0
	}
});
function Be(t, e, n, s = !1) {
	const r = Ne(), o = Ne(), i = new Me(), a = new Me();
	function l(e) {
		const n = Object.create(s ? je : Ce);
		return s ? n._logs = t : n._log = t[0], n._i = e, n;
	}
	const c = {
		tokens: e,
		noteAt: n,
		stateAt: (t) => r.value(i.get(t)),
		tidAt: (t) => {
			const e = a.get(t);
			return 0 === e ? null : o.value(e);
		},
		statesSeen: () => r.values,
		step: (t, e, n) => (i.push(r.code(e)), a.push(null == n ? 0 : o.code(n)), l(t)),
		at: l,
		appender: () => ({
			states: r,
			tids: o,
			stateCol: i,
			tidCol: a
		}),
		plain(t, e) {
			if (t._i !== e || De(t) !== c) return !1;
			let n = 0;
			for (const s in t) {
				if ("_i" !== s && "_log" !== s && "_logs" !== s) return !1;
				n++;
			}
			return 2 === n;
		},
		bytes: () => i.bytes() + a.bytes() + t.reduce((t, e) => t + e.bytes(), 0)
	};
	return t[0].cols = c, c;
}
function Fe(t = []) {
	const { left: e, right: n } = me();
	return [
		e,
		...t,
		n
	];
}
function Re(t = ne.machine) {
	return "QA" === t;
}
function Oe(t = ne.machine) {
	return "2PDA" === t;
}
function Qe(t, e, n = ne.config.sym.any) {
	return t === e || t === n || e === n;
}
function ze(t = [], e = () => 0) {
	let n = null, s = -1 / 0;
	for (const r of t) {
		const t = e(r);
		t > s ? (n = r, s = t) : t === s && n && String(r.id || "").localeCompare(String(n.id || ""), void 0, { numeric: !0 }) < 0 && (n = r);
	}
	return n;
}
function Le(t) {
	const e = "function" == typeof t.next ? t : t[Symbol.iterator](), n = [];
	let s = e.next();
	for (; !s.done;) n.push(s.value), s = e.next();
	return ne.simSteps = n, ne.simIdx = 0, s.value;
}
function We(t, e = ne.sigma) {
	if ("" === t || !t) return [];
	const n = [...e].filter((t) => t !== ne.config.sym.eps).sort((t, e) => e.length - t.length), s = t.split(/[,\s]+/).filter((t) => t.length > 0);
	if (0 === s.length) return [];
	const r = [];
	for (const o of s) {
		const t = qe(o, n);
		if (null === t) return null;
		for (const e of t) r.push(e);
	}
	return r;
}
function qe(t, e) {
	const n = t.length, s = new Uint8Array(n + 1);
	s[n] = 1;
	const r = (e, n) => e.length > 0 && 1 === s[n + e.length] && t.startsWith(e, n);
	for (let i = n - 1; i >= 0; i--) for (const t of e) if (r(t, i)) {
		s[i] = 1;
		break;
	}
	if (!s[0]) return null;
	const o = [];
	for (let i = 0; i < n;) for (const t of e) if (r(t, i)) {
		o.push(t), i += t.length;
		break;
	}
	return o;
}
function Ue(t) {
	return [...t].map((t) => ce(t)?.name || t).join(",");
}
var _e = class {
	constructor(t = []) {
		this.items = t, this.head = 0;
	}
	get length() {
		return this.items.length - this.head;
	}
	push(t) {
		return this.items.push(t), this.length;
	}
	shift() {
		if (this.head >= this.items.length) return;
		const t = this.items[this.head];
		return this.items[this.head++] = void 0, this.head >= 1024 && 2 * this.head >= this.items.length && (this.items = this.items.slice(this.head), this.head = 0), t;
	}
}, Ke = class {
	constructor(t = 1024) {
		let e = 16;
		for (; e < 2 * t;) e *= 2;
		this.cap = e, this.size = 0, this.slots = new Int32Array(6 * e);
	}
	add(t, e, n, s, r) {
		return -1 === this.addOrGet(t, e, n, s, r, 0);
	}
	addOrGet(t, e, n, s, r, o) {
		const i = this.slots, a = this.cap - 1, l = t + 1;
		let c = 6 * (function(t, e, n, s, r) {
			let o = Math.imul(t, 2654435761) ^ Math.imul(e + 2135587861, 2246822519);
			return o = Math.imul(o ^ o >>> 15, 739982445) ^ Math.imul(n, 3266489917), o = Math.imul(o ^ o >>> 13, 695872825) ^ Math.imul(s, 668265263) ^ Math.imul(r, 374761393), o = Math.imul(o ^ o >>> 16, 2246822507), (o ^ o >>> 13) >>> 0;
		}(t, e, n, s, r) & a);
		for (; 0 !== i[c];) {
			if (i[c] === l && i[c + 1] === e && i[c + 2] === n && i[c + 3] === s && i[c + 4] === r) return i[c + 5];
			c += 6, c === i.length && (c = 0);
		}
		return i[c] = l, i[c + 1] = e, i[c + 2] = n, i[c + 3] = s, i[c + 4] = r, i[c + 5] = o, 2 * ++this.size > this.cap && this.grow(), -1;
	}
	grow() {
		const t = this.slots;
		this.cap *= 2, this.slots = new Int32Array(6 * this.cap), this.size = 0;
		for (let e = 0; e < t.length; e += 6) 0 !== t[e] && this.addOrGet(t[e] - 1, t[e + 1], t[e + 2], t[e + 3], t[e + 4], t[e + 5]);
	}
};
function Je() {
	const t = /* @__PURE__ */ new Map();
	return (e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = t.size), n;
	};
}
const He = Object.freeze([]);
let Ve = null, Xe = null, Ge = -1, Ye = null, Ze = null;
function tn(t) {
	return function() {
		const t = ne.transitions || He, e = t.length;
		if (Xe === t && Ge === e && Ye === t[0] && Ze === t[e - 1]) return Ve;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) {
			const e = t[s], r = n.get(e.from);
			r ? r.push(e) : n.set(e.from, [e]);
		}
		return Ve = n, Xe = t, Ge = e, Ye = t[0], Ze = t[e - 1], n;
	}().get(t) || He;
}
function en() {
	const t = ne.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let r = e.get(n);
		void 0 === r && e.set(n, r = function(t, e) {
			const n = tn(t), s = nn.get(n);
			if (void 0 !== s && function(t, e, n) {
				if (t.any !== n) return !1;
				const { syms: s, ids: r } = t;
				for (let o = 0; o < e.length; o++) if (e[o].symbol !== s[o] || e[o].id !== r[o]) return !1;
				return !0;
			}(s, n, e)) return s;
			const r = /* @__PURE__ */ new Map();
			let o = null;
			const i = new Array(n.length), a = new Array(n.length);
			for (let c = 0; c < n.length; c++) {
				const t = n[c];
				i[c] = t.symbol, a[c] = t.id, t.symbol === e ? o = sn(o, t) : r.set(t.symbol, sn(r.get(t.symbol) ?? null, t));
			}
			const l = {
				bySymbol: r,
				wildcard: o,
				any: e,
				syms: i,
				ids: a
			};
			return nn.set(n, l), l;
		}(n, t));
		const o = r.bySymbol.get(s);
		return void 0 !== o ? o : r.wildcard;
	};
}
const nn = /* @__PURE__ */ new WeakMap();
function sn(t, e) {
	return null === t || String(e.id || "").localeCompare(String(t.id || ""), void 0, { numeric: !0 }) < 0 ? e : t;
}
function rn() {
	const t = /* @__PURE__ */ new Map();
	return (e, n) => {
		let s = t.get(e);
		void 0 === s && t.set(e, s = /* @__PURE__ */ new Map());
		const r = 1 === n.length ? n[0] : n.join("");
		let o = s.get(r);
		return void 0 === o && s.set(r, o = function(t, e) {
			const n = ne.config.sym.any;
			return ze(tn(t).filter((t) => t.tapeSyms && t.tapeSyms.length === e.length && t.tapeSyms.every((t, s) => t === e[s] || t === n)), (t) => t.tapeSyms.reduce((t, n, s) => t + (n === e[s] ? 1 : 0), 0));
		}(e, n)), o;
	};
}
function on() {
	if (!fe()) return {
		seenAt: () => -1,
		seenAtVerified: () => -1,
		verifying: !1
	};
	let t = /* @__PURE__ */ new Map(), e = an();
	return {
		get verifying() {
			return null !== e;
		},
		seenAt: (e, n) => t ? t.has(e) ? t.get(e) : (t.set(e, n), t.size > 5e3 && (t = null), -1) : -1,
		seenAtVerified(t, n, s, r, o, i) {
			if (!e) return -1;
			const a = e.check(t, n, s, r, o, i);
			return e.size > 5e3 && (e = null), a;
		}
	};
}
function an() {
	const t = new Ke(), e = Je();
	let n = null;
	return {
		get size() {
			return t.size;
		},
		check(s, r, o, i, a, l) {
			const c = e(s), u = t.addOrGet(c, r, o, i, 0, a);
			if (u < 0) return -1;
			if (l(u)) return u;
			const h = `${c},${r},${o},${i}`;
			n ??= /* @__PURE__ */ new Map();
			const f = n.get(h);
			if (!f) return n.set(h, [a]), -1;
			for (const t of f) if (l(t)) return t;
			return f.push(a), -1;
		}
	};
}
function ln(t, e) {
	const n = an();
	let s = null;
	const r = (n) => t(n) === (s ??= e());
	return (t, e, o, i, a) => (s = null, n.check(t, e, o, i, a, r) >= 0);
}
function cn(t, e) {
	t.final = "loop", t.loopFrom = e, t.note += ` — LOOP: repeats step ${e}, so this machine never halts on this input`;
}
function un(t, e = ne.config.maxTmSteps) {
	t.final = "timeout", t.limit = e, t.note += ` — NO VERDICT: still running after ${e} steps`, fe() || (t.note += ", and loop detection is off");
}
function hn(t, e, n) {
	const s = function(t, e) {
		const n = ne.config.sym.blank, s = Math.max(0, e), r = t.length ? [...t] : [n];
		for (; r.length <= s;) r.push(n);
		for (; r.length > s + 1 && r[r.length - 1] === n;) r.pop();
		return {
			tape: r,
			head: s
		};
	}(e, n), r = ce(t)?.name || t;
	return `${s.tape.slice(0, s.head).join("")}[${r}]${s.tape.slice(s.head).join("")}`;
}
function fn(t) {
	return {
		verdict: t ? "acc" : "rej",
		output: null
	};
}
function pn(t, e) {
	return {
		verdict: t ? "acc" : "rej",
		output: e
	};
}
function dn(t, e) {
	return !!t && (!ne.config.transducerAccepts || e);
}
function mn(t) {
	const e = [];
	let n = t;
	for (; n;) e.push(n), n = n.parent;
	return e.reverse();
}
function gn(t, e, n) {
	return ne.transitions.find((s) => s.id !== n && s.from === t && Qe(s.symbol, e)) || null;
}
function yn(t) {
	return ce(t)?.name || t;
}
function bn() {
	return Math.max(10, ne.config.langStepBudget || 400);
}
function wn(t, e) {
	return {
		piece: e,
		prev: t,
		len: t ? t.len + 1 : 1
	};
}
function kn(t, e) {
	let n = t.kids;
	null === n && (n = t.kids = /* @__PURE__ */ new Map());
	let s = n.get(e);
	if (void 0 === s) {
		const r = null !== e && "object" == typeof e ? e.length : 1;
		s = {
			sym: e,
			below: t,
			length: t.length + 1,
			size: t.size + r,
			id: t.trie.next++,
			kids: null,
			arr: null,
			trie: t.trie
		}, n.set(e, s);
	}
	return s;
}
function vn(t) {
	if (null !== t.arr) return t.arr;
	const e = new Array(t.length);
	for (let n = t, s = t.length - 1; s >= 0; n = n.below, s--) e[s] = n.sym;
	return t.arr = e, e;
}
function An(t, e) {
	for (let n = 0; n < e.length; n++) t = kn(t, e[n]);
	return t;
}
function $n(t) {
	return Array.isArray(t) ? t : vn(t);
}
const Sn = {
	get() {
		return this.tokens.slice(this.pos);
	},
	enumerable: !1,
	configurable: !0
}, Mn = {
	get() {
		return function(t) {
			const e = t ? t.len : 0, n = new Array(e);
			for (let s = t, r = e - 1; s; s = s.prev, r--) n[r] = s.piece;
			return n;
		}(this.outNode);
	},
	enumerable: !1,
	configurable: !0
}, xn = {
	get() {
		return void 0 === this.stackRef ? void 0 : $n(this.stackRef);
	},
	enumerable: !1,
	configurable: !0
}, En = {
	get() {
		return void 0 === this.stackRef2 ? void 0 : $n(this.stackRef2);
	},
	enumerable: !1,
	configurable: !0
}, Tn = {
	get() {
		return vn(this.storeRef).map(vn);
	},
	enumerable: !1,
	configurable: !0
}, Nn = {
	get() {
		const t = this.storeRef.sym;
		return t ? vn(t) : [];
	},
	enumerable: !1,
	configurable: !0
}, Pn = Object.defineProperties({}, { remaining: Sn }), Dn = Object.defineProperties({}, { outToks: Mn }), In = (Object.defineProperties({}, {
	remaining: Sn,
	outToks: Mn
}), Object.defineProperties({}, {
	remaining: Sn,
	stack: xn,
	stack2: En
})), Cn = Object.defineProperties({}, {
	remaining: Sn,
	outToks: Mn,
	stack: xn,
	stack2: En
}), jn = Object.defineProperties({}, {
	remaining: Sn,
	store: Tn,
	stack: Nn
}), Bn = {
	get() {
		const t = this._note;
		return "function" == typeof t ? this._note = t() : t;
	},
	set(t) {
		this._note = t;
	},
	enumerable: !1,
	configurable: !0
}, Fn = /* @__PURE__ */ new WeakMap();
function Rn(t) {
	let e = Fn.get(t);
	return e || Fn.set(t, e = Object.create(t, { note: Bn })), e;
}
function On(t, e) {
	if (void 0 === e) return Object.assign(Object.create(Pn), t);
	const n = Object.assign(Object.create(Rn(Pn)), t);
	return n._note = e, n;
}
function Qn(t, e) {
	if (void 0 === e) return Object.assign(Object.create(Dn), t);
	const n = Object.assign(Object.create(Rn(Dn)), t);
	return n._note = e, n;
}
function zn(t) {
	return Object.assign(Object.create(void 0 !== t.outNode ? Cn : In), t);
}
function Ln(t) {
	return Object.assign(Object.create(jn), t);
}
function Wn(t, e) {
	return e && t && t[0] && Object.defineProperty(t[0], "branchTree", {
		value: e,
		configurable: !0,
		writable: !0,
		enumerable: !1
	}), t;
}
function* qn(t) {
	let e = le();
	const n = en();
	let s = On({
		state: e,
		tokens: t,
		pos: 0,
		note: `Start: ${ce(e)?.name || "?"}`
	});
	yield s;
	for (let r = 0; r < t.length; r++) {
		const o = t[r], i = n(e, o);
		if (!i) return s = On({
			state: e,
			tokens: t,
			pos: r,
			note: `No δ(${ce(e)?.name},'${o}') — Implicit REJECT`,
			final: "reject"
		}), void (yield s);
		const a = e = i.to;
		s = On({
			state: e,
			tokens: t,
			pos: r + 1,
			tid: i.id
		}, () => `Read '${o}' → ${ce(a)?.name}`), yield s;
	}
	s.final || (s.final = ne.accepts.has(e) ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
var Un = class {
	constructor() {
		const { eps: t, any: e } = ne.config.sym;
		this.eps = t, this.any = e, this.num = /* @__PURE__ */ new Map(), this.ids = [], this.direct = [], this.epsOut = [], this.mark = /* @__PURE__ */ new Int32Array(64), this.stamp = 0, this.cur = [], this.stack = [];
	}
	no(t) {
		let e = this.num.get(t);
		if (void 0 === e && (e = this.ids.length, this.num.set(t, e), this.ids.push(t), this.direct.push(null), this.epsOut.push(null), e >= this.mark.length)) {
			const t = new Int32Array(2 * this.mark.length);
			t.set(this.mark), this.mark = t;
		}
		return e;
	}
	targets(t, e) {
		let n = this.direct[t];
		null === n && (n = this.direct[t] = /* @__PURE__ */ new Map());
		let s = n.get(e);
		if (void 0 === s) {
			s = [];
			for (const n of tn(this.ids[t])) n.symbol !== e && n.symbol !== this.any || s.push(this.no(n.to));
			n.set(e, s);
		}
		return s;
	}
	epsTargets(t) {
		let e = this.epsOut[t];
		if (null === e) {
			e = [];
			for (const n of tn(this.ids[t])) n.symbol === this.eps && e.push(this.no(n.to));
			this.epsOut[t] = e;
		}
		return e;
	}
	close(t) {
		const e = this.stack;
		let n = 0;
		for (let s = 0; s < t.length; s++) e[n++] = t[s];
		for (; n > 0;) {
			const s = e[--n];
			for (const r of this.epsTargets(s)) this.mark[r] !== this.stamp && (this.mark[r] = this.stamp, t.push(r), e[n++] = r);
		}
		this.cur = t;
	}
	start(t) {
		this.stamp++;
		const e = this.no(t);
		this.mark[e] = this.stamp, this.close([e]);
	}
	step(t) {
		const e = this.cur, n = [], s = ++this.stamp;
		for (let r = 0; r < e.length; r++) for (const o of this.targets(e[r], t)) this.mark[o] !== s && (this.mark[o] = s, n.push(o));
		this.close(n);
	}
	stateIds() {
		return this.cur.map((t) => this.ids[t]);
	}
	accepts() {
		const t = ne.accepts;
		return this.cur.some((e) => t.has(this.ids[e]));
	}
};
function* _n(t) {
	const e = new Un();
	e.start(le());
	let n = e.stateIds(), s = On({
		states: n,
		tokens: t,
		pos: 0,
		note: `Start ε-closure: {${Ue(n)}}`
	});
	yield s;
	for (let o = 0; o < t.length; o++) {
		const r = t[o];
		e.step(r);
		const i = n = e.stateIds();
		if (s = On({
			states: n,
			tokens: t,
			pos: o + 1
		}, () => `Read '${r}' → {${Ue(i) || "∅"}}`), yield s, !n.length) break;
	}
	const r = e.accepts();
	s.final || (s.final = r ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
function Kn(t) {
	Le(_n(t));
}
function Jn(t) {
	let e = le();
	const n = en();
	for (const s of t) {
		const t = n(e, s);
		if (!t) return !1;
		e = t.to;
	}
	return ne.accepts.has(e);
}
function Hn(t) {
	const e = new Un();
	e.start(le());
	for (let n = 0; n < t.length && e.cur.length; n++) e.step(t[n]);
	return e.accepts();
}
const Vn = {
	family: "finite",
	schema: {
		transitionFields: [
			"from",
			"to",
			"on"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma"]
	},
	formal: { tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	] }
};
function Xn(t) {
	const e = Number(t.weight);
	return Number.isFinite(e) ? e : 1;
}
function Gn(t) {
	return Number.isFinite(t) ? Number.isInteger(t) ? String(t) : String(Number(t.toFixed(4))) : "0";
}
function Yn(t, e) {
	const n = ne.config.sym.any, s = /* @__PURE__ */ new Map();
	for (const [r, o] of t) if (o) for (const t of tn(r)) {
		if (t.symbol !== e && t.symbol !== n) continue;
		const r = Xn(t);
		r && s.set(t.to, (s.get(t.to) || 0) + o * r);
	}
	return s;
}
function Zn(t) {
	let e = 0;
	for (const [n, s] of t) ne.accepts.has(n) && (e += s);
	return e;
}
function ts(t) {
	const e = [/* @__PURE__ */ new Map([[le(), 1]])];
	for (const n of t) e.push(Yn(e[e.length - 1], n));
	return e;
}
function es(t, e, n, s) {
	const r = ne.config.sym.any, o = function(t, e, n) {
		return n < t.length ? t[n] : e[(n - t.length) % e.length];
	}(t, e, s), i = function(t, e, n) {
		return n + 1 < t.length + e.length ? n + 1 : t.length;
	}(t, e, s), a = [];
	for (const l of tn(n)) l.symbol !== o && l.symbol !== r || a.push({
		state: l.to,
		pos: i,
		via: l
	});
	return a;
}
we(Vn, {
	DFA: {
		simulate: function(t) {
			Le(qn(t));
		},
		stream: qn,
		deterministicDelta: !0,
		determinism: {
			conflict: (t, e) => function(t, e, n) {
				return ne.transitions.find((s) => s.id !== n && s.from === t && s.symbol === e) || null;
			}(t.from, t.symbol, e),
			say: (t) => `${ne.machine} already has δ(${yn(t.from)}, '${t.symbol}'). Each (state, symbol) pair must be unique.`
		},
		decide: (t) => fn(Jn(t)),
		formal: {
			...Vn.formal,
			delta: () => "Q × Σ → Q"
		}
	},
	NFA: {
		simulate: Kn,
		stream: _n,
		branches: !0,
		decide: (t) => fn(Hn(t)),
		formal: {
			...Vn.formal,
			delta: () => "Q × Σ → P(Q)"
		}
	},
	"ε-NFA": {
		simulate: Kn,
		stream: _n,
		branches: !0,
		decide: (t) => fn(Hn(t)),
		formal: {
			...Vn.formal,
			delta: () => "Q × (Σ ∪ {ε}) → P(Q)"
		}
	}
}), be("PFA", {
	family: "weighted",
	options: ["cutPoint"],
	simulate: function(t) {
		ne.simSteps = [];
		const e = ne.config.pfaCutPoint;
		ts(t).forEach((e, n) => {
			const s = function(t) {
				return [...t.entries()].filter(([, t]) => t > 0).sort((t, e) => e[1] - t[1]).map(([t, e]) => `${ce(t)?.name || t}:${Gn(e)}`);
			}(e);
			ne.simSteps.push(On({
				states: [...e.keys()].filter((t) => e.get(t) > 0),
				tokens: t,
				pos: n,
				dist: s,
				accMass: Zn(e),
				note: 0 === n ? `Start: all probability on ${ce(le())?.name || le()}` : `Read '${t[n - 1]}' → ${s.length ? s.join("  ") : "total mass 0 — the run has died"}`
			}));
		});
		const n = ne.simSteps[ne.simSteps.length - 1];
		if (n) {
			const t = n.accMass > e;
			n.final = t ? "accept" : "reject", n.note += ` | P(accept) = ${Gn(n.accMass)} ${t ? ">" : "≤"} λ = ${Gn(e)} — ${t ? "ACCEPT" : "REJECT"}`;
		}
		const s = function() {
			const t = /* @__PURE__ */ new Map();
			for (const n of ne.transitions) {
				const e = `${n.from}|${n.symbol}`;
				t.set(e, (t.get(e) || 0) + Xn(n));
			}
			const e = [];
			for (const [n, s] of t) if (Math.abs(s - 1) > 1e-9) {
				const [t, r] = n.split("|");
				e.push({
					from: t,
					symbol: r,
					total: s
				});
			}
			return e;
		}();
		return n && s.length && (n.note += ` | ⚠ ${s.length} (state, symbol) row${s.length > 1 ? "s do" : " does"} not sum to 1`), ne.simIdx = 0, {
			accepted: !!n && "accept" === n.final,
			mass: n?.accMass ?? 0,
			malformed: s
		};
	},
	decide: (t) => fn(function(t) {
		const e = ts(t);
		return Zn(e[e.length - 1]) > ne.config.pfaCutPoint;
	}(t)),
	schema: {
		transitionFields: [
			"from",
			"to",
			"on",
			"weight"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma"]
	},
	formal: {
		tuple: () => [
			"Q",
			"Σ",
			"δ",
			"q₀",
			"F",
			"λ"
		],
		delta: () => "Q × Σ × Q → [0, 1]",
		cutPoint: !0
	}
});
const ns = (t, e) => `${t}|${e}`;
function ss(t, e, n, s = null) {
	const r = ns(n.state, n.pos), o = /* @__PURE__ */ new Map(), i = new _e(), a = (t, e) => {
		const n = ns(e.state, e.pos);
		return n === r || (s && !s(e.state) || o.has(n) || (o.set(n, {
			from: t,
			via: e.via
		}), i.push({
			state: e.state,
			pos: e.pos
		})), !1);
	}, l = (t, e) => {
		const n = [{
			state: e.state,
			pos: e.pos,
			via: e.via
		}];
		let s = t;
		for (; ns(s.state, s.pos) !== r;) {
			const t = o.get(ns(s.state, s.pos));
			n.unshift({
				state: s.state,
				pos: s.pos,
				via: t.via
			}), s = t.from;
		}
		return n;
	};
	for (const c of es(t, e, n.state, n.pos)) if (a(n, c)) return l(n, c);
	for (; i.length;) {
		const n = i.shift();
		for (const s of es(t, e, n.state, n.pos)) if (a(n, s)) return l(n, s);
	}
	return null;
}
function rs(t, e) {
	if (!e.length) return {
		accepted: !1,
		reason: "empty-period",
		stem: [],
		loop: []
	};
	if (!le()) return {
		accepted: !1,
		reason: "no-start",
		stem: [],
		loop: []
	};
	const n = {
		state: le(),
		pos: 0,
		via: null
	}, s = /* @__PURE__ */ new Map([[ns(n.state, n.pos), null]]), r = [n], o = new _e([n]);
	for (; o.length;) {
		const n = o.shift();
		for (const i of es(t, e, n.state, n.pos)) {
			const t = ns(i.state, i.pos);
			if (s.has(t)) continue;
			s.set(t, {
				from: n,
				via: i.via
			});
			const e = {
				state: i.state,
				pos: i.pos,
				via: i.via
			};
			r.push(e), o.push(e);
		}
	}
	const i = (t) => {
		const e = [];
		let n = {
			state: t.state,
			pos: t.pos
		};
		for (;;) {
			const t = s.get(ns(n.state, n.pos));
			if (e.unshift({
				state: n.state,
				pos: n.pos,
				via: t ? t.via : null
			}), !t) break;
			n = t.from;
		}
		return e;
	};
	for (const { node: a, allow: l } of function(t) {
		const e = pe();
		if ("cobuchi" === e) {
			const e = (t) => !ne.accepts.has(t);
			return t.filter((t) => e(t.state)).map((t) => ({
				node: t,
				allow: e
			}));
		}
		if ("parity" === e) {
			const e = (t) => de(ce(t));
			return t.filter((t) => e(t.state) % 2 == 0).map((t) => {
				const n = e(t.state);
				return {
					node: t,
					allow: (t) => e(t) >= n
				};
			});
		}
		return t.filter((t) => ne.accepts.has(t.state)).map((t) => ({
			node: t,
			allow: null
		}));
	}(r)) {
		const n = ss(t, e, a, l);
		if (n) return {
			accepted: !0,
			stem: i(a),
			loop: n,
			reason: null
		};
	}
	return {
		accepted: !1,
		stem: i(r[r.length - 1] || n),
		loop: [],
		reason: r.length > 1 ? "no-accepting-cycle" : "stuck"
	};
}
function os() {
	const t = function(t = ne.transitions) {
		for (let e = 0; e < t.length; e++) for (let n = e + 1; n < t.length; n++) {
			const s = t[e], r = t[n];
			if (s.from === r.from && Qe(s.symbol, r.symbol)) return [s, r];
		}
		return null;
	}(ne.transitions);
	if (!t) return null;
	const e = ce(t[0].from)?.name || t[0].from;
	return { refuse: `Nondeterministic overlap in ${ne.machine} mode: ${e} has two moves on '${t[0].symbol}'. Switch to ${ne.machine.replace(/^D/, "N")} to explore both branches.` };
}
function is() {
	const t = function() {
		const t = /* @__PURE__ */ new Map();
		for (const c of ne.states) t.set(c.id, []);
		for (const c of ne.transitions) t.has(c.from) && t.get(c.from).push(c.to);
		const e = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Set(), r = [];
		let o = 0, i = null;
		const a = (t) => {
			const e = t.filter((t) => ne.accepts.has(t)).length;
			return e > 0 && e < t.length;
		}, l = (l) => {
			const c = [{
				v: l,
				i: 0
			}];
			for (e.set(l, o), n.set(l, o), o++, r.push(l), s.add(l); c.length;) {
				const l = c[c.length - 1], u = t.get(l.v) || [];
				if (l.i < u.length) {
					const t = u[l.i++];
					e.has(t) ? s.has(t) && n.set(l.v, Math.min(n.get(l.v), e.get(t))) : (e.set(t, o), n.set(t, o), o++, r.push(t), s.add(t), c.push({
						v: t,
						i: 0
					}));
					continue;
				}
				if (c.pop(), c.length) {
					const t = c[c.length - 1].v;
					n.set(t, Math.min(n.get(t), n.get(l.v)));
				}
				if (n.get(l.v) === e.get(l.v)) {
					const e = [];
					for (;;) {
						const t = r.pop();
						if (s.delete(t), e.push(t), t === l.v) break;
					}
					(e.length > 1 || (t.get(e[0]) || []).includes(e[0])) && !i && a(e) && (i = e);
				}
			}
		};
		for (const c of ne.states) e.has(c.id) || l(c.id);
		return i;
	}();
	return t ? { warn: `Not a weak automaton: the cycle {${t.map((t) => ce(t)?.name || t).join(", ")}} contains both accepting and non-accepting states. A weak condition needs every SCC to sit wholly inside F or wholly outside it. Running it as a Büchi automaton.` } : null;
}
const as = {
	family: "omega",
	parseInput: function(t) {
		const e = function(t) {
			const e = String(t ?? "").trim().match(/^(.*?)\(([^()]*)\)\s*(?:ω|\^ω|\^w|w)?$/);
			return e ? {
				prefix: e[1].trim(),
				period: e[2].trim()
			} : null;
		}(t);
		if (!e) return {
			ok: !1,
			error: `${ne.machine} reads an infinite word. Write it as <em>u(v)</em> — a finite prefix followed by the repeating period in parentheses, e.g. <em>ab(ba)</em> or <em>(a)</em>.`
		};
		const n = We(e.prefix === ne.config.sym.eps ? "" : e.prefix), s = We(e.period);
		return null === n || null === s ? {
			ok: !1,
			error: `Input cannot be tokenized using alphabet {${[...ne.sigma].join(", ")}}.`
		} : s.length ? {
			ok: !0,
			input: {
				u: n,
				v: s
			},
			tokens: [...n, ...s]
		} : {
			ok: !1,
			error: "The repeating period must be non-empty — <em>u()</em> is a finite word, not an ω-word."
		};
	},
	simulate: ({ u: t, v: e }) => function(t, e) {
		const n = rs(t, e), s = n.accepted ? [
			...n.stem,
			...n.loop,
			...n.loop
		].slice(0, n.stem.length + 2 * n.loop.length) : n.stem, r = n.accepted ? n.stem.length - 1 : -1, o = Math.max(1, Math.ceil((s.length + 1) / Math.max(1, e.length)) + 1), i = [...t];
		for (let c = 0; c < o; c++) i.push(...e);
		const a = [...t, ...e];
		ne.simSteps = s.map((o, l) => {
			const c = ce(o.state)?.name || o.state, u = r >= 0 && l >= r;
			let h;
			if (0 === l) h = `Start: ${c}`;
			else {
				const t = ce(s[l - 1].state)?.name || s[l - 1].state;
				h = `Read '${i[l - 1]}': ${t} → ${c}`;
			}
			return h += function(t) {
				const e = pe();
				return "parity" === e ? ` · priority ${de(ce(t))}` : ne.accepts.has(t) ? "cobuchi" === e ? " ✗ (in F — must stop recurring)" : " ✓ (accepting)" : "";
			}(o.state), u && (h += ` · loop iteration ${Math.floor((l - r) / Math.max(1, n.loop.length)) + 1}`), {
				state: o.state,
				tokens: a,
				tape: i,
				head: l,
				view: {
					kind: "tape",
					cells: i,
					head: l,
					origin: 0,
					leftBound: 0,
					rightBound: null,
					markers: [],
					blank: ne.config.sym.blank,
					readOnly: !0,
					periodFrom: t.length,
					periodLen: e.length
				},
				tid: o.via?.id,
				omegaLoopFrom: r,
				note: h
			};
		});
		const l = ne.simSteps[ne.simSteps.length - 1];
		return l && (l.final = n.accepted ? "accept" : "reject", l.note += function(t) {
			const e = pe(), n = t.loop.map((t) => ce(t.state)?.name || t.state), s = [...new Set(n)].join(" → ");
			return t.accepted ? "cobuchi" === e ? ` — ACCEPT: the cycle ${s} repeats forever and never touches F again` : "parity" === e ? ` — ACCEPT: the cycle ${s} repeats forever and its least priority is ${Math.min(...t.loop.map((t) => de(ce(t.state))))}, which is even` : ` — ACCEPT: the cycle ${s} repeats forever and visits an accepting state each time` : "stuck" === t.reason ? " — REJECT: no run survives the ω-word" : "cobuchi" === e ? " — REJECT: every reachable cycle touches F, so no run can leave it behind for good" : "parity" === e ? " — REJECT: every reachable cycle has an odd least priority" : " — REJECT: every reachable cycle avoids F, so no run visits an accepting state infinitely often";
		}(n)), ne.simIdx = 0, n;
	}(t, e),
	decide: ({ u: t, v: e }) => fn(function(t, e) {
		return rs(t, e).accepted;
	}(t, e)),
	schema: {
		transitionFields: [
			"from",
			"to",
			"on"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma"]
	}
}, ls = { schema: {
	...as.schema,
	stateFields: [
		"name",
		"start",
		"priority"
	]
} }, cs = {
	conflict: (t, e) => gn(t.from, t.symbol, e),
	say: (t) => `${ne.machine} already has a move from ${yn(t.from)} on '${t.symbol}'. Switch to ${ne.machine.replace(/^D/, "N")} if you want to branch on the same symbol.`
}, us = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → Q"
}, hs = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → P(Q)"
};
we(as, {
	DBA: {
		deterministicDelta: !0,
		determinism: cs,
		guards: [os],
		formal: us
	},
	DcoBA: {
		deterministicDelta: !0,
		determinism: cs,
		guards: [os],
		formal: us
	},
	DPA: {
		deterministicDelta: !0,
		determinism: cs,
		guards: [os],
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"δ",
				"q₀",
				"Ω"
			],
			delta: () => "Q × Σ → Q"
		},
		...ls
	},
	DWA: {
		deterministicDelta: !0,
		determinism: cs,
		guards: [os, is],
		formal: us
	},
	NBA: {
		guards: [],
		formal: hs
	},
	NcoBA: {
		guards: [],
		formal: hs
	},
	NPA: {
		guards: [],
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"δ",
				"q₀",
				"Ω"
			],
			delta: () => "Q × Σ → P(Q)"
		},
		...ls
	},
	NWA: {
		guards: [is],
		formal: hs
	}
});
const fs = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
var ps = class {
	constructor(t) {
		this.markup = t;
	}
	toString() {
		return this.markup;
	}
};
function ds(t) {
	return null == t || !1 === t ? "" : t instanceof ps ? t.markup : Array.isArray(t) ? t.map(ds).join("") : function(t) {
		return String(t).replace(/[&<>"']/g, (t) => fs[t]);
	}(t);
}
function ms(t, ...e) {
	let n = t[0];
	for (let s = 0; s < e.length; s++) n += ds(e[s]) + t[s + 1];
	return new ps(n);
}
const gs = (t) => ms`<span class="step-sub">${t.map((t, e) => ms`${e ? ms`<br>` : ""}${t}`)}</span>`;
function ys(t, ...e) {
	return String(ms`<span class="step-acc">Branch ${t}: ACCEPT ✓</span>${gs(e)}`);
}
function bs(t, ...e) {
	return String(ms`Branch ${t}: <span class="step-dead">stuck</span>${gs(e)}`);
}
function ws(t, e, n) {
	return String(ms`Branch ${t}: exploring <em>${e}</em>${gs(n)}`);
}
function ks(t, e) {
	return e === ne.config.sym.eps || void 0 !== t && (e === t || e === ne.config.sym.any);
}
function vs(t = ne.machine) {
	return Re(t);
}
function As(t = ne.machine) {
	return Oe(t);
}
function $s(t, e = !1) {
	if (t && t.length) return Array.isArray(t) ? e ? t[0] : t[t.length - 1] : t.sym;
}
function Ss(t, e = !1) {
	if (!t || !t.length) return ne.config.sym.eps;
	const n = $n(t);
	return e ? n.join("") : [...n].reverse().join("");
}
function Ms(t, e, n) {
	const { eps: s, any: r } = ne.config.sym;
	let o;
	e !== s && t.length && (o = t.sym, t = t.below);
	let i = n && n !== s ? n : "";
	i === r && (i = o || "");
	for (let a = i.length - 1; a >= 0; a--) t = kn(t, i[a]);
	return t;
}
function xs(t, e, n, s = !1) {
	const r = ne.config.sym.eps, o = [...t];
	let i;
	e !== r && (i = s ? o.shift() : o.pop());
	let a = n && n !== r ? n : "";
	if (a === ne.config.sym.any && (a = i || ""), a) {
		const t = a.split("");
		s ? t.forEach((t) => o.push(t)) : t.reverse().forEach((t) => o.push(t));
	}
	return o;
}
function Es(t) {
	const e = "explicit" === ne.config.pdaParadigm ? [ne.config.sym.stackBottom] : [], n = {
		sym: void 0,
		below: null,
		length: 0,
		size: 0,
		id: 0,
		kids: null,
		arr: null,
		trie: { next: 1 }
	}, s = {
		state: le(),
		tokens: t,
		pos: 0,
		stack: vs() ? [...e] : e.reduce((t, e) => kn(t, e), n),
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	};
	return As() && (s.stack2 = e.reduce((t, e) => kn(t, e), n)), s;
}
function Ts() {
	const t = new Ke(), e = Je();
	let n = null;
	const s = (t) => {
		if (!Array.isArray(t)) return t.id;
		n || (n = /* @__PURE__ */ new Map());
		const e = t.join("");
		let s = n.get(e);
		return void 0 === s && n.set(e, s = n.size), s;
	};
	return (n) => t.add(e(n.state), n.pos, s(n.stack), void 0 !== n.stack2 ? s(n.stack2) : -1, void 0 !== n.outKey ? n.outKey.id : -1);
}
function Ns(t) {
	return "explicit" === ne.config.pdaParadigm ? ne.accepts.has(t.state) && t.pos >= t.tokens.length : As() ? t.pos >= t.tokens.length && 0 === t.stack.length && 0 === (t.stack2 || []).length : t.pos >= t.tokens.length && 0 === t.stack.length;
}
function Ps(t) {
	const e = ce(t.state)?.name || t.state, n = t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : ne.config.sym.eps, s = Ss(t.stack, vs());
	return As() ? `(${e}, ${n}, ${s}; ${Ss(t.stack2 || [])})` : `(${e}, ${n}, ${s})`;
}
const Ds = Symbol("end of input");
function Is() {
	const t = /* @__PURE__ */ new Map(), e = vs(), n = As(), s = (t, e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = /* @__PURE__ */ new Map()), n;
	};
	return (r) => {
		const o = r.pos < r.tokens.length ? r.tokens[r.pos] : Ds;
		let i = s(s(t, r.state), o);
		n && (i = s(i, $s(r.stack2 || [])));
		const a = $s(r.stack, e);
		let l = i.get(a);
		return void 0 === l && i.set(a, l = function(t) {
			const { eps: e, any: n } = ne.config.sym, s = $s(t.stack, vs()), r = As(), o = r ? $s(t.stack2 || []) : void 0, i = t.pos < t.tokens.length, a = i ? t.tokens[t.pos] : void 0, l = [];
			for (const c of tn(t.state)) {
				const t = c.symbol;
				(t === e || i && (t === a || t === n)) && ks(s, c.pop) && (r && !ks(o, c.pop2 || e) || l.push(c));
			}
			return l;
		}(r)), l;
	};
}
function Cs() {
	const t = "explicit" === ne.config.pdaParadigm, e = As(), n = ne.accepts;
	return t ? (t) => t.pos >= t.tokens.length && n.has(t.state) : (t) => t.pos >= t.tokens.length && 0 === t.stack.length && (!e || 0 === (t.stack2 || []).length);
}
function js(t, e, n = t.branch) {
	const s = ne.config.sym.eps, r = e.pop || s, o = e.push || s, i = {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		stack: Array.isArray(t.stack) ? xs(t.stack, r, o, vs()) : Ms(t.stack, r, o),
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
	if (void 0 !== t.stack2) {
		const n = e.pop2 || s, r = e.push2 || s;
		i.stack2 = Array.isArray(t.stack2) ? xs(t.stack2, n, r, !1) : Ms(t.stack2, n, r);
	}
	return i;
}
function Bs(t, e) {
	const n = e.via, s = ce(t.state)?.name || t.state, r = ce(e.state)?.name || e.state, o = n?.symbol || ne.config.sym.eps, i = n?.pop || ne.config.sym.eps, a = n?.push || ne.config.sym.eps, l = n?.pop2 || ne.config.sym.eps, c = n?.push2 || ne.config.sym.eps;
	return As() ? `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}/${l}) → (${r}, ${a}/${c})` : `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}) → (${r}, ${a})`;
}
function Fs(t, e = null, n = "") {
	const s = t.map((e, n) => {
		const s = {
			state: e.state,
			tokens: e.tokens,
			pos: e.pos,
			stackRef: e.stack,
			branch: e.branch,
			tid: e.via?.id,
			note: 0 === n ? "Start configuration" : Bs(t[n - 1], e)
		};
		return void 0 !== e.stack2 && (s.stackRef2 = e.stack2), void 0 !== e.outNode && (s.outNode = e.outNode, s.outSoFar = e.outRaw), zn(s);
	});
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function Rs(t, e, n, s) {
	const r = {
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		stackRef: e.stack,
		branch: e.branch,
		note: s,
		final: n
	};
	void 0 !== e.stack2 && (r.stackRef2 = e.stack2), t.push(zn(r));
}
function Os(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, r = e.tree || null, o = Es(t), i = new _e([o]), a = Ts(), l = Cs(), c = Is();
	a(o), r && r.root(o.state, o);
	const u = [];
	let h = null, f = 0, p = 0, d = o, m = 2;
	for (; i.length && f < ne.config.maxPdaSteps;) {
		const t = i.shift();
		d = t, f++, p = Math.max(p, t.depth);
		const e = u.length < n, s = e ? ce(t.state)?.name || t.state : "", o = e ? Ps(t) : "";
		if (l(t)) {
			h = t, r && r.accept(t.tn), e && u.push(ys(t.branch, `Accepted at depth ${t.depth}.`, `ID: ${o}`));
			break;
		}
		const g = c(t);
		if (!g.length) {
			r && r.expandCfgs(t, []), e && u.push(bs(t.branch, `No transition matches ${o}.`, `Depth ${t.depth}`));
			continue;
		}
		e && Qs(u, t, s, o, g);
		const y = r && !r.full ? [] : null;
		g.forEach((e, n) => {
			const s = 1 === g.length || 0 === n ? t.branch : m++, r = js(t, e, s), o = a(r);
			o && i.push(r), y && y.push({
				cfg: r,
				fresh: o
			});
		}), y && r.expandCfgs(t, y);
	}
	return r && r.finish((h || d).tn ?? -1), {
		accepted: !!h,
		branches: f,
		maxDepth: p,
		log: u,
		witnessPath: s ? mn(h || d) : null,
		finalCfg: h || d,
		unresolved: !h && i.length > 0
	};
}
function Qs(t, e, n, s, r) {
	const o = e.tokens[e.pos] || ne.config.sym.eps, i = $s(e.stack, vs()), a = Re() ? "Queue front" : "Stack top", l = [
		`State "${n}" with next input '${o}'`,
		`Depth ${e.depth} · ${a} ${i || ne.config.sym.eps}`,
		`ID: ${s}`
	];
	Oe() && l.push(`Second stack top ${$s(e.stack2 || []) || ne.config.sym.eps}`), r.length > 1 && l.push(`Nondeterministic choice: ${r.length} matching transitions.`), t.push(ws(e.branch, n, l));
}
function zs(t, e, n) {
	const s = js(t, e, n), r = e.output ?? "";
	return s.outRaw = (t.outRaw || "") + r, s.outKey = An(t.outKey, r), s.outNode = wn(t.outNode, "" === r ? ne.config.sym.lambda : r), s;
}
function Ls(t, e = null) {
	const n = Es(t);
	n.outRaw = "", n.outKey = {
		sym: void 0,
		below: null,
		length: 0,
		size: 0,
		id: 0,
		kids: null,
		arr: null,
		trie: { next: 1 }
	}, n.outNode = null;
	const s = new _e([n]), r = Ts(), o = Cs(), i = Is();
	r(n), e && e.root(n.state, n);
	const a = /* @__PURE__ */ new Set();
	let l = null, c = null, u = n, h = 0, f = 0, p = 2;
	for (; s.length && h < ne.config.maxPdaSteps;) {
		const t = s.shift();
		u = t, h++, f = Math.max(f, t.depth);
		const n = o(t);
		t.pos >= t.tokens.length && (dn(!0, n) && a.add(t.outRaw), c || (c = t)), n && !l && (l = t), n && e && e.accept(t.tn);
		const d = i(t), m = e && !e.full ? [] : null;
		d.forEach((e, n) => {
			const o = 1 === d.length || 0 === n ? t.branch : p++, i = zs(t, e, o), a = r(i);
			a && s.push(i), m && m.push({
				cfg: i,
				fresh: a
			});
		}), m && e.expandCfgs(t, m);
	}
	const d = l || c || u;
	return e && e.finish(d.tn ?? -1), {
		accepted: !!l,
		outputs: a,
		witnessPath: mn(d),
		finalCfg: d,
		unresolved: !l && s.length > 0,
		branches: h,
		maxDepth: f
	};
}
const Ws = {
	family: "pushdown",
	storeLabels: [
		"Stack",
		"Pop",
		"Push"
	],
	schema: {
		transitionFields: [
			"from",
			"to",
			"on",
			"pop",
			"push"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma", "stackAlpha"]
	}
}, qs = () => "explicit" === ne.config.pdaParadigm ? [
	"Q",
	"Σ",
	"Γ",
	"δ",
	"q₀",
	"Z₀",
	"F"
] : [
	"Q",
	"Σ",
	"Γ",
	"δ",
	"q₀"
], Us = {
	...Ws,
	deterministicDelta: !0,
	determinism: {
		conflict: (t, e) => function(t, e = ne.transitions, n = null) {
			return e.find((e) => {
				return e.id !== n && (r = t, (s = e).from === r.from && function(t, e, n = ne.config.sym.eps, s = ne.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.symbol, r.symbol) && function(t, e, n = ne.config.sym.eps, s = ne.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.pop, r.pop));
				var s, r;
			}) || null;
		}({
			from: t.from,
			symbol: t.symbol,
			pop: t.pop
		}, ne.transitions, e),
		say: (t) => `DPDA already has an overlapping move from ${yn(t.from)}. Switch to NPDA mode if you want branching on the same configuration.`
	},
	simulate: function(t) {
		const e = Es(t);
		if (Ns(e)) return ne.simSteps = Fs([e], "accept"), ne.simIdx = 0, { accepted: !0 };
		let n = e;
		const s = Ts(), r = Cs(), o = Is();
		s(n);
		for (let i = 0; i < ne.config.maxPdaSteps; i++) {
			const t = o(n);
			if (t.length > 1) return ne.simSteps = Fs(mn(n)), Rs(ne.simSteps, n, "reject", "Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches."), ne.simIdx = 0, { accepted: !1 };
			if (!t.length) return ne.simSteps = Fs(mn(n)), Rs(ne.simSteps, n, "reject", "No valid transition from this configuration — REJECT"), ne.simIdx = 0, { accepted: !1 };
			const e = js(n, t[0], n.branch);
			if (!s(e)) return ne.simSteps = Fs(mn(n)), Rs(ne.simSteps, n, "reject", "Repeated configuration detected — possible ε-loop — REJECT"), ne.simIdx = 0, { accepted: !1 };
			if (n = e, r(n)) return ne.simSteps = Fs(mn(n), "accept"), ne.simIdx = 0, { accepted: !0 };
		}
		return ne.simSteps = Fs(mn(n)), Rs(ne.simSteps, n, "reject", "PDA step limit reached — REJECT"), ne.simIdx = 0, { accepted: !1 };
	},
	decide: (t) => fn(function(t) {
		let e = Es(t);
		if (Ns(e)) return !0;
		const n = Ts(), s = Cs(), r = Is();
		n(e);
		for (let o = 0; o < ne.config.maxPdaSteps; o++) {
			const t = r(e);
			if (1 !== t.length) return !1;
			const o = js(e, t[0], e.branch);
			if (!n(o)) return !1;
			if (e = o, s(e)) return !0;
		}
		return !1;
	}(t))
}, _s = {
	...Ws,
	simulate: function(t) {
		const e = Os(t, { tree: null });
		return e.accepted ? ne.simSteps = Fs(e.witnessPath, "accept") : (ne.simSteps = Fs(e.witnessPath), Rs(ne.simSteps, e.finalCfg, "reject", e.unresolved ? `Exploration limit ${ne.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT")), Wn(ne.simSteps, null), ne.simIdx = 0, {
			accepted: e.accepted,
			branches: e.branches,
			maxDepth: e.maxDepth,
			log: e.log,
			witnessLength: e.witnessPath.length
		};
	},
	branches: !0,
	decide: (t) => fn(function(t) {
		return Os(t, {
			log: 0,
			witness: !1
		}).accepted;
	}(t))
};
function Ks(t) {
	const e = String(null == t ? "" : t).trim();
	if (!e) return [];
	const n = [];
	for (let s = 0; s < e.length;) {
		const t = e[s];
		if (/\s/.test(t)) s++;
		else {
			if ("<" === t) {
				const t = e.indexOf(">", s + 1);
				if (t > 0) {
					n.push(e.slice(s, t + 1)), s = t + 1;
					continue;
				}
			}
			if (/\s/.test(e)) {
				let t = s;
				for (; t < e.length && !/\s/.test(e[t]);) t++;
				n.push(e.slice(s, t)), s = t;
				continue;
			}
			n.push(t), s++;
		}
	}
	return n;
}
function Js(t) {
	const e = ne.config.sym.eps, n = String(null == t ? "" : t).trim();
	return n && n !== e ? n.split("|").map((t) => t.trim()).filter((t) => t && t !== e).map((t) => Ks(t).reverse()) : [];
}
function Hs(t) {
	return !(t.pos < t.tokens.length) && ("explicit" === ne.config.pdaParadigm ? ne.accepts.has(t.state) : 1 === t.store.length && 0 === t.store.sym.length);
}
function Vs(t) {
	const e = ne.config.sym.eps, n = ne.config.sym.any, s = t.store.sym.sym;
	return tn(t.state).filter((r) => (r.symbol === e || t.pos < t.tokens.length && (r.symbol === t.tokens[t.pos] || r.symbol === n)) && function(t, e) {
		const { eps: n, any: s } = ne.config.sym;
		return e === n || void 0 !== t && (e === t || e === s);
	}(s, r.pop || e));
}
function Xs(t, e, n = t.branch) {
	const { eps: s, any: r } = ne.config.sym, o = t.ctx;
	let i, a = t.store.sym;
	(e.pop || s) !== s && a.length && (i = a.sym, a = a.below);
	let l = e.push && e.push !== s ? e.push : "";
	if (l === r && (l = i || ""), l) {
		const t = function(t, e) {
			let n = t.pushes.get(e);
			return n || t.pushes.set(e, n = Ks(e)), n;
		}(o, l);
		for (let e = t.length - 1; e >= 0; e--) a = kn(a, t[e]);
	}
	let c = t.store.below;
	for (const u of Gs(o, e.below)) c = kn(c, u);
	c = kn(c, a);
	for (const u of Gs(o, e.above)) c = kn(c, u);
	for (; c.length > 1 && 0 === c.sym.length;) c = c.below;
	return {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		store: c,
		ctx: o,
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
}
function Gs(t, e) {
	const n = e ?? "";
	let s = t.lists.get(n);
	return s || (s = Js(e).map((e) => e.reduce((t, e) => kn(t, e), t.inner)), t.lists.set(n, s)), s;
}
function Ys(t) {
	return `(${ce(t.state)?.name || t.state}, ${t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : ne.config.sym.eps}, ${function(t) {
		const e = ne.config.sym.eps;
		return t.length ? t.map((t) => {
			return t.length ? (n = [...t].reverse()).some((t) => String(t).length > 1) ? n.join(" ") : n.join("") : e;
			var n;
		}).join(" | ") : e;
	}((e = t.store, Array.isArray(e) ? e : vn(e).map(vn)))})`;
	var e;
}
function Zs(t, e) {
	const n = e.via, s = ne.config.sym.eps, r = ce(t.state)?.name || t.state, o = ce(e.state)?.name || e.state, i = [`(${r}, ${n?.symbol || s}, ${n?.pop || s}) → (${o}, ${n?.push || s}`], a = Js(n?.below), l = Js(n?.above);
	return a.length && i.push(`, ${a.length} below`), l.length && i.push(`, ${l.length} above`), i.push(")"), `Branch ${e.branch} depth ${e.depth}: ${i.join("")} · ${e.store.length} stack${1 === e.store.length ? "" : "s"}`;
}
function tr(t, e = null, n = "") {
	const s = t.map((e, n) => Ln({
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		storeRef: e.store,
		branch: e.branch,
		tid: e.via?.id,
		note: 0 === n ? "Start configuration" : Zs(t[n - 1], e)
	}));
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function er(t, e) {
	return t.length <= e.stacks && t.size <= e.symbols;
}
function nr(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, r = e.tree || null, o = function(t) {
		const e = {
			sym: void 0,
			below: null,
			length: 0,
			size: 0,
			id: 0,
			kids: null,
			arr: null,
			trie: { next: 1 }
		}, n = "explicit" === ne.config.pdaParadigm ? kn(e, ne.config.sym.stackBottom) : e;
		return {
			state: le(),
			tokens: t,
			pos: 0,
			store: kn({
				sym: void 0,
				below: null,
				length: 0,
				size: 0,
				id: 0,
				kids: null,
				arr: null,
				trie: { next: 1 }
			}, n),
			ctx: {
				inner: e,
				lists: /* @__PURE__ */ new Map(),
				pushes: /* @__PURE__ */ new Map()
			},
			depth: 0,
			branch: 1,
			parent: null,
			via: null
		};
	}(t), i = new _e([o]), a = new Ke(), l = Je(), c = (t) => a.add(l(t.state), t.pos, t.store.id, -1, -1);
	c(o), r && r.root(o.state, o);
	const u = [];
	let h = null, f = 0, p = 0, d = 1, m = o, g = 2;
	const y = function(t = []) {
		const e = t.length + 2;
		return {
			stacks: e + 4,
			symbols: 16 * (e + 4)
		};
	}(t);
	let b = !1;
	for (; i.length && f < ne.config.maxPdaSteps;) {
		const t = i.shift();
		m = t, f++, p = Math.max(p, t.depth), d = Math.max(d, t.store.length);
		const e = u.length < n;
		if (Hs(t)) {
			h = t, r && r.accept(t.tn), e && u.push(ys(t.branch, `Accepted at depth ${t.depth}.`, `ID: ${Ys(t)}`));
			break;
		}
		const s = Vs(t);
		if (!s.length) {
			r && r.expandCfgs(t, []), e && u.push(bs(t.branch, `No transition matches ${Ys(t)}.`, `Depth ${t.depth}`));
			continue;
		}
		if (e) {
			const e = ce(t.state)?.name || t.state, n = [
				`State "${e}" with next input '${t.tokens[t.pos] || ne.config.sym.eps}'`,
				`Depth ${t.depth} · ${t.store.length} stack${1 === t.store.length ? "" : "s"} · top ${t.store.sym.sym || ne.config.sym.eps}`,
				`ID: ${Ys(t)}`
			];
			s.length > 1 && n.push(`Nondeterministic choice: ${s.length} matching transitions.`), u.push(ws(t.branch, e, n));
		}
		const o = r && !r.full ? [] : null;
		s.forEach((e, n) => {
			const r = 1 === s.length || 0 === n ? t.branch : g++, a = Xs(t, e, r);
			if (!er(a.store, y)) return void (b = !0);
			const l = c(a);
			l && i.push(a), o && o.push({
				cfg: a,
				fresh: l
			});
		}), o && r.expandCfgs(t, o);
	}
	return r && r.finish((h || m).tn ?? -1), {
		accepted: !!h,
		branches: f,
		maxDepth: p,
		maxStacks: d,
		log: u,
		capped: b,
		witnessPath: s ? mn(h || m) : null,
		finalCfg: h || m,
		unresolved: !h && (i.length > 0 || b)
	};
}
we(Ws, {
	DPDA: {
		...Us,
		formal: {
			tuple: qs,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	PDA: {
		...Us,
		formal: {
			tuple: qs,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	NPDA: {
		..._s,
		formal: {
			tuple: qs,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Γ*)"
		}
	},
	QA: {
		..._s,
		storeLabels: [
			"Queue",
			"Dequeue",
			"Enqueue"
		],
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Γ",
				"δ",
				"q₀",
				"F"
			],
			delta: () => "Q × (Σ ∪ {ε}) × (Γ ∪ {ε}) → P(Q × Γ*)",
			storeSay: "queue alphabet"
		}
	},
	Counter: {
		..._s,
		storeLabels: [
			"Counter",
			"Test",
			"Update"
		],
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Γ",
				"δ",
				"q₀",
				"F"
			],
			delta: () => "Q × (Σ ∪ {ε}) × (Γ ∪ {ε}) → P(Q × Γ*)"
		}
	},
	"2PDA": {
		..._s,
		schema: {
			...Ws.schema,
			transitionFields: [
				"from",
				"to",
				"on",
				"pop",
				"push",
				"pop2",
				"push2"
			]
		},
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Γ₁",
				"Γ₂",
				"δ",
				"q₀",
				"F"
			],
			delta: () => "Q × (Σ ∪ {ε}) × Γ₁ × Γ₂ → P(Q × Γ₁* × Γ₂*)"
		}
	},
	PDT: {
		...Ws,
		simulate: function(t) {
			const e = Ls(t, null), n = ne.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, r = n ? e.accepted ? "Accepting run found" : e.unresolved ? `Exploration limit ${ne.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting run found" : "";
			ne.simSteps = Fs(e.witnessPath, s, r);
			const o = ne.simSteps[ne.simSteps.length - 1];
			if (o) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? o.note += ` | Output: "${t[0]}"` : o.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : o.note += " | Output: \"\"";
			}
			return Wn(ne.simSteps, null), ne.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = Ls(t), n = [...e.outputs];
				return {
					accepted: e.accepted,
					output: n.length ? n[0] : "",
					outputs: n
				};
			}(t);
			return pn(e.accepted, e.output);
		},
		schema: {
			...Ws.schema,
			transitionFields: [
				"from",
				"to",
				"on",
				"pop",
				"push",
				"out"
			],
			alphabetFields: [
				"sigma",
				"stackAlpha",
				"outputAlpha"
			]
		},
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Γ",
				"Δ",
				"δ",
				"λ",
				"q₀",
				"F"
			],
			delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Γ* × Δ*)",
			outputSay: "Q × (Σ ∪ {ε}) × Γ × Q → Δ*"
		}
	}
});
const sr = {
	family: "embedded",
	schema: {
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma", "stackAlpha"]
	}
};
be("EPDA", {
	branches: !0,
	...sr,
	storeLabels: [
		"Stack of stacks",
		"Pop",
		"Push"
	],
	schema: {
		...sr.schema,
		transitionFields: [
			"from",
			"to",
			"on",
			"pop",
			"push",
			"below",
			"above"
		]
	},
	simulate: function(t) {
		const e = nr(t, { tree: null });
		var n, s, r;
		return e.accepted ? ne.simSteps = tr(e.witnessPath, "accept") : (ne.simSteps = tr(e.witnessPath), n = ne.simSteps, s = e.finalCfg, r = e.unresolved ? `Exploration limit ${ne.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", n.push(Ln({
			state: s.state,
			tokens: s.tokens,
			pos: s.pos,
			storeRef: s.store,
			branch: s.branch,
			note: r,
			final: "reject"
		}))), Wn(ne.simSteps, null), ne.simIdx = 0, e;
	},
	decide: (t) => function(t) {
		const e = nr(t, {
			log: 0,
			witness: !1
		});
		return e.accepted ? {
			verdict: "acc",
			output: null
		} : {
			verdict: e.capped ? "unk" : "rej",
			output: null
		};
	}(t),
	formal: {
		tuple: () => "explicit" === ne.config.pdaParadigm ? [
			"Q",
			"Σ",
			"Γ",
			"δ",
			"q₀",
			"Z₀",
			"F"
		] : [
			"Q",
			"Σ",
			"Γ",
			"δ",
			"q₀"
		],
		delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Υ* × Γ* × Υ*)",
		storeSay: "stack alphabet"
	}
});
const rr = 2147483647, or = 2147483629, ir = 911382323, ar = 972663749;
function lr(t, e, n) {
	return (t * Math.floor(e / 65536) % n * 65536 + t * (e % 65536)) % n;
}
function cr(t, e, n) {
	let s = 1;
	for (t %= n; e > 0;) e % 2 == 1 && (s = lr(s, t, n)), t = lr(t, t, n), e = Math.floor(e / 2);
	return s;
}
const ur = /* @__PURE__ */ new Map(), hr = [[1], [1]];
function fr(t) {
	if (t >= 0 && t < 1048576) {
		const e = hr[0], n = hr[1];
		for (; e.length <= t;) e.push(lr(e[e.length - 1], ir, rr)), n.push(lr(n[n.length - 1], ar, or));
		return pr[0] = e[t], pr[1] = n[t], pr;
	}
	let e = ur.get(t);
	if (e) return e;
	ur.size > 65536 && ur.clear();
	const n = (t % 2147483628 + 2147483628) % 2147483628;
	return e = [cr(ir, (t % 2147483646 + 2147483646) % 2147483646, rr), cr(ar, n, or)], ur.set(t, e), e;
}
const pr = [1, 1], dr = /* @__PURE__ */ new Map(), mr = {
	off: 0,
	h1: 0,
	h2: 0
};
function gr(t, e) {
	return void 0 === t || t === e ? null : function(t) {
		let e = dr.get(t);
		if (e) return e;
		let n = 2166136261;
		for (let s = 0; s < t.length; s++) n = Math.imul(n ^ t.charCodeAt(s), 16777619) >>> 0;
		return e = [1 + n % 2147483646, 1 + (Math.imul(n ^ n >>> 15, 2246822519) >>> 0) % 2147483628], dr.set(t, e), e;
	}(String(t));
}
function yr(t, e, n, s) {
	if (n === s) return;
	let r = (s ? s[0] : 0) - (n ? n[0] : 0), o = (s ? s[1] : 0) - (n ? n[1] : 0);
	r < 0 && (r += rr), o < 0 && (o += or);
	const i = fr(e - t.lo);
	t.h1 = (t.h1 + lr(r, i[0], rr)) % rr, t.h2 = (t.h2 + lr(o, i[1], or)) % or;
}
function br(t) {
	let e = 1 / 0;
	for (const n of t.keys()) n < e && (e = n);
	return e;
}
var wr = class t {
	constructor(t = [], e = "⊔", n = !1, s = {}) {
		this.blank = e, this.twoWay = !!n, this.rightBound = s.rightBound ?? null, this.immutable = s.immutable || null, this.head = 0, this.cells = /* @__PURE__ */ new Map(), t.forEach((t, e) => this.cells.set(e, t));
	}
	read() {
		return this.cells.has(this.head) ? this.cells.get(this.head) : this.blank;
	}
	write(t) {
		if (this.immutable && this.immutable.has(this.read())) return !1;
		const e = this._fp, n = e ? gr(this.cells.get(this.head), this.blank) : null;
		return t === this.blank ? this.cells.delete(this.head) : this.cells.set(this.head, t), e && (yr(e, this.head, n, gr(t, this.blank)), t !== this.blank ? this.head < e.min && (e.min = this.head) : this.head === e.min && (e.min = br(this.cells))), !0;
	}
	trackFingerprint() {
		const t = {
			h1: 0,
			h2: 0,
			min: br(this.cells),
			lo: 0
		};
		for (const [e, n] of this.cells) yr(t, e, null, gr(n, this.blank));
		return this._fp = t, this;
	}
	fingerprint() {
		const t = this.fingerprintParts();
		return `${t.off}|${t.h1}|${t.h2}`;
	}
	fingerprintParts() {
		const t = this._fp, e = this.twoWay ? Math.min(this.head, t.min) : 0;
		if (e !== t.lo) {
			const n = fr(t.lo - e);
			t.h1 = lr(t.h1, n[0], rr), t.h2 = lr(t.h2, n[1], or), t.lo = e;
		}
		const n = mr;
		return n.off = this.head - e, n.h1 = t.h1, n.h2 = t.h2, n;
	}
	move(t) {
		const e = "R" === t ? 1 : "L" === t ? -1 : 0, n = this.head + e;
		return !(!this.twoWay && n < 0 || null !== this.rightBound && n > this.rightBound || (this.head = n, 0));
	}
	snapshot() {
		let t = this.head, e = this.head;
		for (const o of this.cells.keys()) o < t && (t = o), o > e && (e = o);
		const n = this.twoWay ? t : 0, s = null !== this.rightBound ? this.rightBound : Math.max(e, n), r = [];
		for (let o = n; o <= s; o++) r.push(this.cells.has(o) ? this.cells.get(o) : this.blank);
		return {
			tape: r,
			head: this.head - n,
			origin: n
		};
	}
	view() {
		const { tape: t, head: e, origin: n } = this.snapshot();
		return {
			kind: "tape",
			cells: t,
			head: e,
			origin: n,
			leftBound: this.twoWay ? null : 0,
			rightBound: this.rightBound,
			markers: this.immutable ? [...this.immutable] : [],
			blank: this.blank,
			readOnly: !1
		};
	}
	key() {
		const { tape: t, head: e } = this.snapshot();
		let n = t.length;
		if (null === this.rightBound) for (; n > e + 1 && t[n - 1] === this.blank;) n--;
		return `${e}|${t.slice(0, n).join("")}`;
	}
	clone() {
		const e = new t([], this.blank, this.twoWay, {
			rightBound: this.rightBound,
			immutable: this.immutable
		});
		return e.cells = new Map(this.cells), e.head = this.head, this._fp && (e._fp = { ...this._fp }), e;
	}
};
function kr(t, e) {
	return `${t}|${e.map((t) => t.key()).join("")}`;
}
const vr = () => !0, Ar = (t) => "R" === t ? 1 : "L" === t ? -1 : 0;
function* $r({ log: t, cols: e, fires: n, blank: s, twoWay: r, n: o, state: i, via: a, head: l, last: c, want: u }) {
	const h = t.appender(), { live: f, heads: p, reads: d, writes: m, syms: g, blankCode: y } = h, { states: b, tids: w, stateCol: k, tidCol: v } = e.appender(), A = g.values, $ = (t) => null == t ? 0 : w.code(t), S = [], M = /* @__PURE__ */ new Map(), x = [], E = [];
	function T(t) {
		let e = M.get(t);
		return void 0 === e && (e = S.length, M.set(t, e), S.push(t), x.push(-1), E.push(ne.accepts.has(t) ? 1 : 0)), e;
	}
	let N, P, D, I, C, j, B, F = 3, R = 8;
	function O() {
		const t = R << F;
		N = new Int32Array(t).fill(-2), P = new Int32Array(t), D = new Int8Array(t), I = new Int32Array(t), C = new Array(t), j = new Array(t), B = [];
	}
	function Q(t, e) {
		if (!(t < R && e < 1 << F)) {
			for (; t >= R;) R *= 2;
			for (; e >= 1 << F;) F++;
			O();
		}
	}
	O();
	let z = ne.config.sym.any;
	const L = (t, e) => null === t ? null === e : null !== e && t.to === e[0] && t.write === e[1] && t.dir === e[2] && t.id === e[3];
	function W(t, e) {
		const r = n(S[t], A[e]) ?? null;
		let o = -1, i = -1, a = 0, l = 0;
		r && (o = T(r.to), i = r.write && r.write !== z ? r.write === s ? 0 : g.code(r.write) : -1, a = Ar(r.dir), l = $(r.id)), Q(Math.max(t, o), Math.max(e, i));
		const c = t << F | e;
		return N[c] = o, P[c] = i, D[c] = a, I[c] = l, C[c] = r, j[c] = ((t) => t ? [
			t.to,
			t.write,
			t.dir,
			t.id
		] : null)(r), B.push(c), o;
	}
	function q() {
		for (let e = 0; e < S.length; e++) E[e] = ne.accepts.has(S[e]) ? 1 : 0;
		let t = ne.config.sym.any !== z;
		for (let e = 0; !t && e < B.length; e++) {
			const n = B[e];
			t = !L(C[n], j[n]);
		}
		t && (z = ne.config.sym.any, O());
	}
	let U = T(i), _ = l, K = o, J = $(a), H = null, V = 0, X = 0, G = null;
	const Y = 4096, Z = new Int32Array(Y), tt = new Uint32Array(Y), et = new Uint32Array(Y), nt = new Uint32Array(Y), st = new Uint32Array(Y);
	function rt(t) {
		0 !== t && (p.pushMany(Z, t), d.pushMany(tt, t), m.pushMany(et, t), k.pushMany(nt, t), v.pushMany(st, t));
	}
	function ot(t) {
		let e = U, n = _, s = K, o = J, i = h.nextCheckpoint, a = F, l = N, c = P, u = D, p = I, d = 0, m = 0;
		const g = Z, w = tt, k = et, v = nt, A = st, $ = x, M = E, T = y, j = r;
		let B = f.buf, O = f.base, z = B.length;
		for (H = null;;) {
			m === Y && (rt(m), m = 0), s >= i && (i = h.checkpoint(s));
			const r = n - O, y = r >= 0 && r < z ? B[r] : 0, x = 0 === y ? T : y;
			g[m] = n, w[m] = x;
			let E = $[e];
			if (E < 0 && (E = $[e] = b.code(S[e])), v[m] = E, A[m] = o, d++, 1 === M[e]) {
				k[m++] = 0, H = "accept";
				break;
			}
			(e >= R || x >= 1 << a) && (Q(e, x), a = F, l = N, c = P, u = D, p = I);
			let L = e << a | x, q = l[L];
			if (-2 === q && (q = W(e, x), a = F, l = N, c = P, u = D, p = I, L = e << a | x), -1 === q) {
				k[m++] = 0, H = "reject";
				break;
			}
			if (d === t) {
				k[m++] = 0, V = y, X = x, G = C[L];
				break;
			}
			const U = c[L], _ = -1 === U ? x === T ? 0 : x : U;
			k[m++] = 0 === _ ? 1 : _ + 1, y === T && h.undoException(s, y), _ !== y && (f.set(n, _), B = f.buf, O = f.base, z = B.length), o = p[L], e = q;
			const K = u[L];
			(j || n + K >= 0) && (n += K), s++;
		}
		return rt(m), U = e, _ = n, K = s, J = o, d;
	}
	function it() {
		const t = K;
		t >= h.nextCheckpoint && h.checkpoint(t);
		const e = f.get(_), s = 0 === e ? y : e;
		p.push(_), d.push(s);
		let r = x[U];
		if (r < 0 && (r = x[U] = b.code(S[U])), k.push(r), v.push(J), m.push(0), H = null, ne.accepts.has(S[U])) return H = "accept", 1;
		const o = n(S[U], A[s]) ?? null;
		return o ? (V = e, X = s, G = o, 1) : (H = "reject", 1);
	}
	function at() {
		const t = G, e = A[X], n = t.write && t.write !== ne.config.sym.any ? t.write : e, o = n === s ? 0 : g.code(n);
		m.set(K, 0 === o ? 1 : o + 1), V === y && h.undoException(K, V), f.set(_, o), J = $(t.id), U = T(t.to);
		const i = Ar(t.dir);
		(r || _ + i >= 0) && (_ += i), K++;
	}
	for (;;) {
		const t = ne.config.maxTmSteps;
		if (K >= t) return void (c && !c.final && un(c));
		const n = Math.min(u >= 1 ? u : 1, t - K);
		let s;
		1 === n ? s = it() : (q(), s = ot(n));
		const r = e.at(K);
		if ("accept" === H ? (r.final = "accept", r.note += " — ACCEPT") : "reject" === H && (r.final = "reject", r.note += " — REJECT"), c = r, u = yield 1 === s ? r : ve(s, r, e.at), H) return;
		at();
	}
}
var Sr = class t {
	static fits(t, e) {
		return !t.some((t) => t === e);
	}
	constructor(t, e, n, s = {
		sym: void 0,
		below: null,
		length: 0,
		size: 0,
		id: 0,
		kids: null,
		arr: null,
		trie: { next: 1 }
	}) {
		this.blank = e, this.twoWay = !!n, this.head = 0, this.left = s, this.cell = t.length ? t[0] : e;
		let r = s;
		for (let o = t.length - 1; o >= 1; o--) r = kn(r, t[o]);
		this.right = r;
	}
	read() {
		return this.cell;
	}
	write(t) {
		return this.cell = t, !0;
	}
	move(t) {
		if ("R" === t) {
			!this.left.length && this.cell === this.blank && this.twoWay || (this.left = kn(this.left, this.cell));
			const t = this.right;
			return this.cell = t.length ? t.sym : this.blank, t.length && (this.right = t.below), this.head++, !0;
		}
		if ("L" === t) {
			if (!this.twoWay && 0 === this.head) return !1;
			(this.right.length || this.cell !== this.blank) && (this.right = kn(this.right, this.cell));
			const t = this.left;
			return this.cell = t.length ? t.sym : this.blank, t.length && (this.left = t.below), this.head--, !0;
		}
		return !0;
	}
	clone() {
		const e = Object.create(t.prototype);
		return e.blank = this.blank, e.twoWay = this.twoWay, e.head = this.head, e.left = this.left, e.cell = this.cell, e.right = this.right, e;
	}
	snapshot() {
		const t = vn(this.left).slice();
		t.push(this.cell);
		const e = vn(this.right);
		for (let n = e.length - 1; n >= 0; n--) t.push(e[n]);
		for (; t.length > this.left.length + 1 && t[t.length - 1] === this.blank;) t.pop();
		return {
			tape: t,
			head: this.left.length,
			origin: this.head - this.left.length
		};
	}
	view() {
		const { tape: t, head: e, origin: n } = this.snapshot();
		return {
			kind: "tape",
			cells: t,
			head: e,
			origin: n,
			leftBound: this.twoWay ? null : 0,
			rightBound: null,
			markers: [],
			blank: this.blank,
			readOnly: !1
		};
	}
	key() {
		const { tape: t, head: e } = this.snapshot();
		return `${e}|${t.join("")}`;
	}
};
function Mr(t, e) {
	return (n, s) => `State:${ce(s.stateAt(n))?.name} Read:'${t.readAt(n)}'${e ? ` @${t.headAt(n)}` : ""}`;
}
function* xr(t) {
	const e = ne.config.sym.blank, n = he(), s = new wr(t, e, n).trackFingerprint(), r = Pe(s), o = Be([r], t, Mr(r, n));
	let i = le(), a = null;
	const l = on(), c = en();
	let u = null;
	const h = (r) => jr(() => new wr(t, e, n), r) === (u ??= `${i}|${s.key()}`);
	let f = null, p = 0, d = 1;
	for (; p < ne.config.maxTmSteps; p++) {
		if (!l.verifying && vr()) return yield* $r({
			log: r,
			cols: o,
			fires: c,
			blank: e,
			twoWay: n,
			n: p,
			state: i,
			via: a,
			head: s.head,
			last: f,
			want: d
		});
		const t = s.read(), m = r.begin(s.head, t);
		if (f = o.step(m, i, a), ne.accepts.has(i)) return f.final = "accept", f.note += " — ACCEPT", void (yield f);
		u = null;
		const g = s.fingerprintParts(), y = l.seenAtVerified(i, g.off, g.h1, g.h2, p, h);
		if (y >= 0) return cn(f, y), void (yield f);
		const b = c(i, t);
		if (!b) return f.final = "reject", f.note += " — REJECT", void (yield f);
		d = yield f;
		const w = s.head;
		s.write(b.write && b.write !== ne.config.sym.any ? b.write : t), r.noteWrite(m, w, s.cells), i = b.to, a = b.id, s.move(b.dir);
	}
	f && !f.final && un(f);
}
function Er(t) {
	Le(xr(t));
}
function Tr(t) {
	const e = ne.config.sym.blank, n = he();
	if (Sr.fits(t, e)) {
		const s = new Ke(), r = Je(), o = Je();
		return {
			start: new Sr(t, e, n),
			seen: (t, e) => s.add(r(t), e.left.id, o(e.cell), e.right.id, 0)
		};
	}
	const s = /* @__PURE__ */ new Set();
	return {
		start: new wr(t, e, n),
		seen: (t, e) => {
			const n = `${t}|${e.key()}`;
			return !s.has(n) && (s.add(n), !0);
		}
	};
}
function Nr() {
	const t = ne.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let r = e.get(n);
		void 0 === r && e.set(n, r = /* @__PURE__ */ new Map());
		let o = r.get(s);
		return void 0 === o && r.set(s, o = tn(n).filter((e) => e.symbol === s || e.symbol === t)), o;
	};
}
const Pr = {
	get tape() {
		return (this._snap ??= this._tape.snapshot()).tape;
	},
	get head() {
		return (this._snap ??= this._tape.snapshot()).head;
	},
	get view() {
		return this._tape.view();
	}
};
function* Dr(t) {
	const { start: e, seen: n } = Tr(t), s = Nr(), o = new _e([{
		state: le(),
		tape: e,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}]);
	n(le(), e);
	let l = !1, c = 0, u = 0;
	const h = [];
	let f = 2, p = null;
	for (; o.length && c < ne.config.maxTmSteps;) {
		const e = o.shift(), { state: r, depth: d, branch: m } = e, g = e.tape.read(), y = ce(r)?.name || r, b = h.length < 10, w = b ? e.tape.snapshot() : null, k = b ? hn(r, w.tape, w.head) : "";
		c++, u = Math.max(u, d);
		const v = Object.assign(Object.create(Pr), {
			state: r,
			tokens: t,
			_tape: e.tape,
			branch: m,
			parent: e.parent,
			via: e.via,
			depth: d,
			tn: e.tn ?? -1,
			note: `Branch ${m} depth ${d}: ${y} reads '${g}'`
		});
		if (ne.accepts.has(r)) {
			e.tn, v.final = "accept", v.note += " — ACCEPT", p = v, yield v, b && h.push(ys(m, `State "${y}" is accepting.`, `Depth ${d} · ID: ${k}`)), l = !0;
			break;
		}
		const A = s(r, g);
		if (!A.length) {
			v.note += " — dead branch", p = v, yield v, b && h.push(bs(m, `No transition matches (${y}, '${g}').`, `Depth ${d} · ID: ${k}`));
			continue;
		}
		if (v.note += A.length > 1 ? ` — branching ×${A.length}` : " — deterministic step", p = v, yield v, b) {
			const t = [`Read '${g}' at head position ${e.tape.twoWay ? e.tape.head : w.head}.`, `Depth ${d} · ID: ${k}`];
			A.length > 1 && t.push(`Nondeterministic choice: ${A.length} matching transitions.`), h.push(ws(m, y, t));
		}
		A.forEach((t) => {
			const s = e.tape.clone();
			if (s.write(t.write && t.write !== ne.config.sym.any ? t.write : g), s.move(t.dir), !n(t.to, s)) return void 0;
			const r = {
				state: t.to,
				tape: s,
				depth: d + 1,
				branch: f++,
				parent: m,
				via: t.id
			};
			o.push(r);
		});
	}
	if (!l) {
		const n = o.length > 0, s = n ? `NO VERDICT: exploration limit ${ne.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", r = p?.tape || e.snapshot().tape, i = p?.head ?? 0;
		yield {
			state: p?.state || le(),
			tokens: t,
			tape: [...r],
			head: i,
			note: s,
			final: n ? "timeout" : "reject",
			limit: n ? ne.config.maxTmSteps : void 0
		}, h.push(function(t, ...e) {
			return String(ms`${t}${gs(e)}`);
		}(o.length ? "Exploration limit reached" : "Reject", `${s}.`, `Branches explored: ${c} · max depth ${u}`));
	}
	return {
		accepted: l,
		branches: c,
		maxDepth: u,
		log: h
	};
}
function Ir(t, e, n, s) {
	const r = Array.isArray(e) ? null : Array.isArray(e?.tapes) ? e.tapes : null;
	return r ? Array.from({ length: t }, (t, e) => new wr(r[e] || [], n, s)) : function(t, e, n, s) {
		return Array.from({ length: t }, (t, r) => new wr(0 === r ? e : [], n, s));
	}(t, Array.isArray(e) ? e : [], n, s);
}
function Cr(t, e, n) {
	const s = ne.config.sym.any;
	for (let r = 0; r < t.length; r++) {
		const o = e.tapeWrites?.[r];
		t[r].write(o && o !== s ? o : n[r]);
	}
	for (let r = 0; r < t.length; r++) t[r].move(e.tapeDirs?.[r]);
}
function jr(t, e) {
	const n = ne.config.sym.any, s = t(), r = en();
	let o = le();
	for (let i = 0; i < e; i++) {
		const t = s.read(), e = r(o, t);
		if (!e) break;
		s.write(e.write && e.write !== n ? e.write : t), s.move(e.dir), o = e.to;
	}
	return `${o}|${s.key()}`;
}
function Br(t, e, n) {
	const s = Ir(t, e, ne.config.sym.blank, he()), r = rn();
	let o = le();
	for (let i = 0; i < n; i++) {
		const t = s.map((t) => t.read()), e = r(o, t);
		if (!e) break;
		Cr(s, e, t), o = e.to;
	}
	return kr(o, s);
}
const Fr = {
	off: 0,
	h1: 0,
	h2: 0
};
function Rr(t) {
	let e = 0, n = 0, s = 0;
	for (const r of t) {
		const t = r.fingerprintParts();
		e = Math.imul(e, 668265263) + t.off | 0, n = Math.imul(n, 2654435761) + t.h1 | 0, s = Math.imul(s, 2246822519) + t.h2 | 0;
	}
	return Fr.off = e, Fr.h1 = n, Fr.h2 = s, Fr;
}
function* Or(t) {
	const e = ne.tapeCount, n = ne.config.sym.blank, s = he(), r = function(t) {
		return Array.isArray(t) ? t : t?.tapes?.[0] || [];
	}(t), o = Ir(e, t, n, s);
	o.forEach((t) => t.trackFingerprint());
	let i = le(), a = null;
	const l = o.map((t) => Pe(t)), c = Be(l, r, function(t, e) {
		return (n, s) => `State:${ce(s.stateAt(n))?.name} Read:[${t.map((t) => t.readAt(n)).join(",")}]${e ? ` @[${t.map((t) => t.headAt(n)).join(",")}]` : ""}`;
	}(l, s), !0), u = on(), h = rn();
	let f = null;
	const p = (n) => Br(e, t, n) === (f ??= kr(i, o));
	let d = null;
	for (let m = 0; m < ne.config.maxTmSteps; m++) {
		const t = o.map((t) => t.read()), e = l[0].begin(o[0].head, t[0]);
		for (let i = 1; i < l.length; i++) l[i].begin(o[i].head, t[i]);
		if (d = c.step(e, i, a), ne.accepts.has(i)) return d.final = "accept", d.note += " — ACCEPT", void (yield d);
		f = null;
		const n = Rr(o), s = u.seenAtVerified(i, n.off, n.h1, n.h2, m, p);
		if (s >= 0) return cn(d, s), void (yield d);
		const r = h(i, t);
		if (!r) return d.final = "reject", d.note += " — REJECT", void (yield d);
		yield d;
		const g = o.map((t) => t.head);
		Cr(o, r, t);
		for (let i = 0; i < l.length; i++) l[i].noteWrite(e, g[i], o[i].cells);
		i = r.to, a = r.id;
	}
	d && !d.final && un(d);
}
function* Qr(t) {
	const e = Lr(t).trackFingerprint(), n = Pe(e), s = Be([n], t, Mr(n, !1));
	let r = le(), o = null;
	const i = on(), a = en();
	let l = null;
	const c = (n) => jr(() => Lr(t), n) === (l ??= `${r}|${e.key()}`);
	let u = null;
	for (let h = 0; h < ne.config.maxTmSteps; h++) {
		const t = e.read(), f = n.begin(e.head, t);
		if (u = s.step(f, r, o), ne.accepts.has(r)) return u.final = "accept", u.note += " — ACCEPT", void (yield u);
		l = null;
		const p = e.fingerprintParts(), d = i.seenAtVerified(r, p.off, p.h1, p.h2, h, c);
		if (d >= 0) return cn(u, d), void (yield u);
		const m = a(r, t);
		if (!m) return u.final = "reject", u.note += " — REJECT", void (yield u);
		yield u;
		const g = e.head;
		e.write(m.write && m.write !== ne.config.sym.any ? m.write : t), n.noteWrite(f, g, e.cells), r = m.to, o = m.id;
		const y = "L" === m.dir ? ne.config.sym.leftMarker : ne.config.sym.rightMarker;
		if (!e.move(m.dir)) return u = s.step(n.begin(e.head, e.read()), r, o), u.note = `Attempted to move outside the ${y} boundary. — REJECT`, u.final = "reject", void (yield u);
	}
	u && !u.final && un(u);
}
function zr(t, e) {
	e = e || bn();
	const n = ne.config.sym.any, s = ne.config.sym.blank, r = he(), o = new wr(t, s, r).trackFingerprint(), i = ne.accepts, a = en();
	let l = le();
	const c = ln((e) => jr(() => new wr(t, s, r), e), () => `${l}|${o.key()}`);
	for (let u = 0; u < e; u++) {
		if (i.has(l)) return "acc";
		const t = o.fingerprintParts();
		if (c(l, t.off, t.h1, t.h2, u)) return "rej";
		const e = o.read(), s = a(l, e);
		if (!s) return "rej";
		o.write(s.write && s.write !== n ? s.write : e), o.move(s.dir), l = s.to;
	}
	return "unk";
}
function Lr(t) {
	const { leftMarker: e, rightMarker: n, blank: s } = ne.config.sym;
	return new wr(Fe(t), s, !1, {
		rightBound: t.length + 1,
		immutable: /* @__PURE__ */ new Set([e, n])
	});
}
const Wr = {
	conflict: (t, e) => gn(t.from, t.symbol, e),
	say: (t) => `${ne.machine} already has δ(${yn(t.from)}, '${t.symbol}'). Use NDTM mode if you want multiple choices for the same read symbol.`
}, qr = {
	family: "turing",
	supportsBlocks: !0,
	options: ["twoWayTape"],
	schema: {
		transitionFields: [
			"from",
			"to",
			"on",
			"write",
			"move"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma", "stackAlpha"]
	},
	formal: {
		tuple: () => [
			"Q",
			"Σ",
			"Γ",
			"δ",
			"q₀",
			"F"
		],
		delta: () => "Q × Γ → Q × Γ × {L, R, S}",
		storeSay: "tape alphabet"
	}
}, Ur = (t) => (e, n = {}) => ({
	verdict: t(e, n.budget),
	output: null
});
function* _r(t) {
	let e = le();
	const n = en(), s = ce(e), r = s?.output ?? "";
	let o = r, i = wn(null, r), a = Qn({
		state: e,
		tokens: t,
		outNode: i,
		outSoFar: o,
		note: `Start: ${s?.name} — ${ne.config.sym.lambda}: '${r}'`
	});
	yield a;
	for (let c = 0; c < t.length; c++) {
		const s = t[c], r = n(e, s);
		if (!r) {
			a = Qn({
				state: e,
				tokens: t,
				outNode: i,
				outSoFar: o,
				note: `No δ(${ce(e)?.name},'${s}') — HALT`,
				final: "reject"
			}), yield a;
			break;
		}
		e = r.to;
		const l = ce(e), u = l?.output ?? "";
		o += u, i = wn(i, u), a = Qn({
			state: e,
			tokens: t,
			outNode: i,
			outSoFar: o,
			tid: r.id
		}, () => `Read '${s}' → ${l?.name} — ${ne.config.sym.lambda}: '${u}'`), yield a;
	}
	const l = ne.config.transducerAccepts;
	!a.final && l && (a.final = ne.accepts.has(e) ? "accept" : "reject", a.note += ` — ${a.final.toUpperCase()}`), a.note += ` | Output: "${o}"`;
}
function* Kr(t) {
	let e = le();
	const n = en();
	let s = "", r = null, o = Qn({
		state: e,
		tokens: t,
		outNode: r,
		outSoFar: s,
		note: `Start: ${ce(e)?.name}`
	});
	yield o;
	for (let a = 0; a < t.length; a++) {
		const i = t[a], l = n(e, i);
		if (!l) {
			o = Qn({
				state: e,
				tokens: t,
				outNode: r,
				outSoFar: s,
				note: `No δ(${ce(e)?.name},'${i}') — HALT`,
				final: "reject"
			}), yield o;
			break;
		}
		const c = l.output ?? "?";
		s += c, r = wn(r, c);
		const u = e = l.to;
		o = Qn({
			state: e,
			tokens: t,
			outNode: r,
			outSoFar: s,
			tid: l.id
		}, () => `Read '${i}' → ${ce(u)?.name} — out: '${c}'`), yield o;
	}
	const i = ne.config.transducerAccepts;
	!o.final && i && (o.final = ne.accepts.has(e) ? "accept" : "reject", o.note += ` — ${o.final.toUpperCase()}`), s.length && (o.note += ` | Output: "${s}"`);
}
function Jr(t, e) {
	const n = ne.config.sym.eps;
	return tn(t.state).filter((s) => s.symbol === n || !(t.index >= e.length) && (s.symbol === e[t.index] || s.symbol === ne.config.sym.any));
}
function Hr(t, e, n) {
	const s = ne.config.sym.eps, r = e.output ?? "", o = "" === r ? ne.config.sym.lambda : r, i = e.symbol !== s;
	return {
		state: e.to,
		index: i ? t.index + 1 : t.index,
		depth: t.depth + 1,
		branch: n,
		outRaw: t.outRaw + r,
		outKey: An(t.outKey, r),
		outNode: wn(t.outNode, o),
		parent: t,
		via: e
	};
}
function Vr(t, e = null) {
	const n = {
		state: le(),
		index: 0,
		depth: 0,
		branch: 1,
		outRaw: "",
		outKey: {
			sym: void 0,
			below: null,
			length: 0,
			size: 0,
			id: 0,
			kids: null,
			arr: null,
			trie: { next: 1 }
		},
		outNode: null,
		parent: null,
		via: null
	}, s = new _e([n]), r = new Ke(), o = Je(), i = (t) => r.add(o(t.state), t.index, t.outKey.id, -1, -1);
	i(n), e && e.root(n.state, n);
	const a = /* @__PURE__ */ new Set();
	let l = null, c = null, u = n, h = 0, f = 0, p = 2;
	for (; s.length && h < ne.config.maxPdaSteps;) {
		const n = s.shift();
		if (u = n, h++, f = Math.max(f, n.depth), n.index === t.length) {
			const t = ne.accepts.has(n.state);
			dn(!0, t) && a.add(n.outRaw), c || (c = n), ne.config.transducerAccepts && t && !l && (l = n), e && dn(!0, t) && e.accept(n.tn);
		}
		const r = Jr(n, t), o = e && !e.full ? [] : null;
		r.forEach((t, e) => {
			const a = 1 === r.length || 0 === e ? n.branch : p++, l = Hr(n, t, a), c = i(l);
			c && s.push(l), o && o.push({
				cfg: l,
				fresh: c
			});
		}), o && e.expandCfgs(n, o);
	}
	const d = l || c || u;
	return e && e.finish(d.tn ?? -1), {
		accepted: !!l,
		witnessPath: mn(d),
		finalCfg: d,
		outputs: a,
		unresolved: !l && s.length > 0,
		branches: h,
		maxDepth: f
	};
}
we(qr, {
	TM: {
		simulate: Er,
		stream: xr,
		columnar: !0,
		decide: Ur(zr),
		deterministicDelta: !0,
		determinism: Wr
	},
	NDTM: {
		simulate: function(t) {
			return Le(Dr(t));
		},
		stream: Dr,
		branches: !0,
		decide: Ur(function(t, e) {
			e = e || bn();
			const n = ne.config.sym.any, s = ne.accepts, { start: r, seen: o } = Tr(t), i = Nr(), a = new _e([{
				state: le(),
				tape: r
			}]);
			o(le(), r);
			let l = 0;
			for (; a.length;) {
				if (l++ >= e) return "unk";
				const t = a.shift();
				if (s.has(t.state)) return "acc";
				const r = t.tape.read();
				for (const e of i(t.state, r)) {
					const s = t.tape.clone();
					s.write(e.write && e.write !== n ? e.write : r), s.move(e.dir), o(e.to, s) && a.push({
						state: e.to,
						tape: s
					});
				}
			}
			return "rej";
		}),
		formal: {
			...qr.formal,
			delta: () => "Q × Γ → P(Q × Γ × {L, R, S})"
		}
	},
	MTM: {
		deterministicDelta: !0,
		multiTape: !0,
		options: ["tapeCount", "twoWayTape"],
		determinism: {
			conflict: (t, e) => ne.transitions.find((n) => n.id !== e && n.from === t.from && function(t = [], e = [], n = ne.config.sym.any) {
				return !(!Array.isArray(t) || !Array.isArray(e) || t.length !== e.length) && t.every((t, s) => Qe(t, e[s], n));
			}(n.tapeSyms || [n.symbol], t.tapeSyms || [])) || null,
			say: (t) => `MTM already has a transition for (${yn(t.from)}, [${(t.tapeSyms || []).join(", ")}]). Each read tuple must be unique.`
		},
		simulate: function(t) {
			Le(Or(t));
		},
		stream: Or,
		columnar: !0,
		decide: Ur(function(t, e) {
			e = e || bn();
			const n = ne.tapeCount || 2, s = Ir(n, t, ne.config.sym.blank, he());
			s.forEach((t) => t.trackFingerprint());
			const r = ne.accepts, o = rn();
			let i = le();
			const a = ln((e) => Br(n, t, e), () => kr(i, s));
			for (let l = 0; l < e; l++) {
				if (r.has(i)) return "acc";
				const t = Rr(s);
				if (a(i, t.off, t.h1, t.h2, l)) return "rej";
				const e = s.map((t) => t.read()), n = o(i, e);
				if (!n) return "rej";
				Cr(s, n, e), i = n.to;
			}
			return "unk";
		}),
		parseInput: function(t) {
			if (!String(t).includes(",")) return function(t) {
				const e = We(t === ne.config.sym.eps ? "" : t);
				return null === e ? {
					ok: !1,
					error: `Input cannot be tokenized using alphabet {${[...ne.sigma].join(", ")}}.`
				} : {
					ok: !0,
					input: e,
					tokens: e
				};
			}(t);
			const e = String(t).split(",");
			if (e.length !== ne.tapeCount) return {
				ok: !1,
				error: `MTM: found ${e.length} comma-separated segment(s) but machine has ${ne.tapeCount} tape(s). Provide one value per tape.`
			};
			const n = [];
			for (let s = 0; s < e.length; s++) {
				const t = e[s].trim(), r = We(t === ne.config.sym.eps ? "" : t);
				if (null === r) return {
					ok: !1,
					error: `Tape ${s + 1}: cannot tokenize "${t}" using alphabet {${[...ne.sigma].join(", ")}}.`
				};
				n.push(r);
			}
			return {
				ok: !0,
				input: { tapes: n },
				tokens: null
			};
		},
		schema: {
			...qr.schema,
			transitionFields: [
				"from",
				"to",
				"on",
				"tapeSyms",
				"tapeWrites",
				"tapeDirs"
			],
			alphabetFields: [
				"sigma",
				"stackAlpha",
				"tapeCount"
			]
		},
		formal: {
			...qr.formal,
			delta: () => {
				const t = ne.tapeCount || 2;
				return `Q × Γ^${t} → Q × Γ^${t} × {L, R, S}^${t}`;
			}
		}
	},
	LBA: {
		simulate: function(t) {
			Le(Qr(t));
		},
		stream: Qr,
		columnar: !0,
		decide: Ur(function(t, e) {
			e = e || bn();
			const n = ne.config.sym.any, s = Lr(t).trackFingerprint(), r = ne.accepts, o = en();
			let i = le();
			const a = ln((e) => jr(() => Lr(t), e), () => `${i}|${s.key()}`);
			for (let l = 0; l < e; l++) {
				if (r.has(i)) return "acc";
				const t = s.fingerprintParts();
				if (a(i, t.off, t.h1, t.h2, l)) return "rej";
				const e = s.read(), c = o(i, e);
				if (!c) return "rej";
				if (s.write(c.write && c.write !== n ? c.write : e), i = c.to, !s.move(c.dir)) return "rej";
			}
			return "unk";
		}),
		deterministicDelta: !0,
		determinism: Wr,
		options: []
	},
	ITM: {
		simulate: function(t) {
			return Er(t);
		},
		stream: function(t) {
			return xr(t);
		},
		columnar: !0,
		decide: Ur(function(t, e) {
			return zr(t, e);
		}),
		deterministicDelta: !0,
		determinism: Wr,
		options: []
	}
});
const Xr = {
	conflict: (t, e) => gn(t.from, t.symbol, e),
	say: (t) => `${ne.machine} already has δ(${yn(t.from)}, '${t.symbol}'). Each input symbol must map to one output.`
}, Gr = {
	family: "transducer",
	schema: {
		transitionFields: [
			"from",
			"to",
			"on",
			"out"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma", "outputAlpha"]
	}
};
function Yr(t) {
	return "R" === t ? 1 : "L" === t ? -1 : 0;
}
function Zr(t, e) {
	return e;
}
function to(t, e) {
	const { left: n, right: s } = me();
	return {
		kind: "tape",
		cells: t,
		head: e,
		origin: 0,
		leftBound: 0,
		rightBound: t.length - 1,
		markers: [n, s],
		blank: ne.config.sym.blank,
		readOnly: !0
	};
}
function eo(t, e) {
	const n = ne.config.sym.any;
	return tn(t).filter((t) => t.symbol === e || t.symbol === n);
}
function no(t, e, n = null, s = "") {
	const r = function(t) {
		return Fe(t);
	}(e), o = t.map((n, s) => {
		const o = ce(n.state)?.name || n.state, i = {
			state: n.state,
			tokens: e,
			tape: r,
			head: Zr(0, n.head),
			view: to(r, Zr(0, n.head)),
			branch: n.branch,
			tid: n.via?.id,
			note: ""
		}, a = void 0 !== n.outNode;
		a && (i.outNode = n.outNode, i.outSoFar = n.outRaw);
		const l = a ? Qn(i) : i;
		if (0 === s) l.note = `Start: ${o} at ${r[n.head]}`;
		else {
			const e = t[s - 1], i = ce(e.state)?.name || e.state, a = function(t, e) {
				return t[e] ?? null;
			}(r, e.head), c = null === a ? ne.config.sym.eps : a;
			l.note = `Branch ${n.branch} depth ${n.depth}: ${i} reads '${c}', move ${n.via?.dir || "S"} → ${o} (head=${n.head})`;
		}
		return l;
	});
	if (o.length && n) {
		const t = o[o.length - 1];
		t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
	}
	return o;
}
function so(t) {
	const e = Fe(t), n = [{
		state: le(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}];
	for (let s = 0; s < ne.config.maxTmSteps; s++) {
		const t = n[n.length - 1];
		if (ne.accepts.has(t.state)) return {
			accepted: !0,
			path: n,
			finalNote: `Accepted in state ${ce(t.state)?.name || t.state}`
		};
		if (t.head < 0 || t.head >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Head moved outside endmarker bounds at index ${t.head}`
		};
		const s = e[t.head], r = ze(eo(t.state, s), (t) => t.symbol === s ? 1 : 0);
		if (!r) return {
			accepted: !1,
			path: n,
			finalNote: `No valid transition on '${s}'`
		};
		const o = t.head + Yr(r.dir);
		if (o < 0 || o >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Transition on '${s}' attempted to move outside ${o < 0 ? "⊢" : "⊣"} bound.`
		};
		n.push({
			state: r.to,
			head: o,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: r
		});
	}
	return {
		accepted: !1,
		path: n,
		finalNote: `2DFA step limit ${ne.config.maxTmSteps} reached`
	};
}
function ro(t, e = null) {
	const n = Fe(t), s = {
		state: le(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}, r = new _e([s]), o = /* @__PURE__ */ new Set([`${s.state}|${s.head}`]);
	e && e.root(s.state, s);
	let i = null, a = s, l = 0, c = 0, u = 2;
	for (; r.length && l < ne.config.maxTmSteps;) {
		const t = r.shift();
		if (a = t, l++, c = Math.max(c, t.depth), ne.accepts.has(t.state)) {
			i = t, e && e.accept(t.tn);
			break;
		}
		if (t.head < 0 || t.head >= n.length) {
			e && e.expandCfgs(t, []);
			continue;
		}
		const s = n[t.head], h = eo(t.state, s), f = e && !e.full ? [] : null;
		h.forEach((e, s) => {
			const i = 1 === h.length || 0 === s ? t.branch : u++, a = t.head + Yr(e.dir);
			if (a < 0 || a >= n.length) return;
			const l = {
				state: e.to,
				head: a,
				depth: t.depth + 1,
				branch: i,
				parent: t,
				via: e
			}, c = `${l.state}|${l.head}`, p = !o.has(c);
			f && f.push({
				cfg: l,
				fresh: p
			}), p && (o.add(c), r.push(l));
		}), f && e.expandCfgs(t, f);
	}
	const h = i || a;
	return e && e.finish(h.tn ?? -1), {
		accepted: !!i,
		witnessPath: mn(h),
		finalCfg: h,
		unresolved: !i && r.length > 0,
		branches: l,
		maxDepth: c
	};
}
function oo(t) {
	const e = Fe(t), n = ne.config.sym.lambda, s = [{
		state: le(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null,
		outRaw: "",
		outNode: null
	}];
	for (let r = 0; r < ne.config.maxTmSteps; r++) {
		const t = s[s.length - 1];
		if (ne.accepts.has(t.state)) return {
			accepted: !0,
			halted: !0,
			path: s,
			finalNote: `Accepted in state ${ce(t.state)?.name || t.state}`
		};
		const r = e[t.head], o = ze(eo(t.state, r), (t) => t.symbol === r ? 1 : 0);
		if (!o) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `No valid transition on '${r}'`
		};
		const i = t.head + Yr(o.dir);
		if (i < 0 || i >= e.length) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `Transition on '${r}' attempted to move outside ${i < 0 ? ne.config.sym.leftMarker : ne.config.sym.rightMarker} bound.`
		};
		const a = o.output ?? "";
		s.push({
			state: o.to,
			head: i,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: o,
			outRaw: t.outRaw + a,
			outNode: wn(t.outNode, "" === a ? n : a)
		});
	}
	return {
		accepted: !1,
		halted: !1,
		path: s,
		finalNote: `2DFT step limit ${ne.config.maxTmSteps} reached`
	};
}
we(Gr, {
	Moore: {
		simulate: function(t) {
			Le(_r(t));
		},
		stream: _r,
		deterministicDelta: !0,
		determinism: Xr,
		decide: (t) => pn(Jn(t), function(t) {
			let e = le();
			const n = en(), s = [ce(e)?.output ?? ""];
			for (const r of t) {
				const t = n(e, r);
				if (!t) break;
				e = t.to, s.push(ce(e)?.output ?? "");
			}
			return s.join("");
		}(t)),
		schema: {
			...Gr.schema,
			transitionFields: [
				"from",
				"to",
				"on"
			],
			stateFields: [
				"name",
				"start",
				"accept",
				"out"
			]
		},
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Δ",
				"δ",
				"λ",
				"q₀"
			],
			delta: () => "Q × Σ → Q",
			outputSay: "Q → Δ",
			outputPerState: !0
		}
	},
	Mealy: {
		simulate: function(t) {
			Le(Kr(t));
		},
		stream: Kr,
		deterministicDelta: !0,
		determinism: Xr,
		decide: (t) => pn(Jn(t), function(t) {
			let e = le();
			const n = en(), s = [];
			for (const r of t) {
				const t = n(e, r);
				if (!t) break;
				s.push(t.output ?? "?"), e = t.to;
			}
			return s.join("");
		}(t)),
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Δ",
				"δ",
				"λ",
				"q₀"
			],
			delta: () => "Q × Σ → Q",
			outputSay: "Q × Σ → Δ"
		}
	},
	FST: {
		simulate: function(t) {
			const e = Vr(t, null), n = ne.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, r = n ? e.accepted ? "Accepting branch found" : e.unresolved ? `Exploration limit ${ne.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting branch found" : "";
			ne.simSteps = function(t, e, n = null, s = "") {
				const r = t.map((n, s) => {
					const r = ce(n.state)?.name || n.state, o = Qn({
						state: n.state,
						tokens: e,
						outNode: n.outNode,
						outSoFar: n.outRaw,
						branch: n.branch,
						tid: n.via?.id,
						note: ""
					});
					if (0 === s) o.note = `Start: ${r}`;
					else {
						const e = t[s - 1], i = ce(e.state)?.name || e.state, a = n.via?.symbol || ne.config.sym.eps, l = void 0 !== n.via?.output && "" !== n.via?.output ? n.via.output : ne.config.sym.lambda;
						o.note = `Branch ${n.branch} depth ${n.depth}: (${i}, ${a}/${l}) → ${r}`;
					}
					return o;
				});
				if (r.length && n) {
					const t = r[r.length - 1];
					t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
				}
				return r;
			}(e.witnessPath, t, s, r);
			const o = ne.simSteps[ne.simSteps.length - 1];
			if (o) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? o.note += ` | Output: "${t[0]}"` : o.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : o.note += " | Output: \"\"";
			}
			return Wn(ne.simSteps, null), ne.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = Vr(t), n = [...e.outputs];
				let s = "";
				return s = n.length > 1 ? n.join(" | ") : 1 === n.length ? n[0] : e.witnessPath.at(-1)?.outRaw || "", {
					accepted: e.accepted,
					output: s
				};
			}(t);
			return pn(e.accepted, e.output);
		},
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Δ",
				"δ",
				"λ",
				"q₀",
				"F"
			],
			delta: () => "Q × (Σ ∪ {ε}) → P(Q)",
			outputSay: "Q × (Σ ∪ {ε}) × Q → Δ*"
		}
	}
});
const io = (t) => ({
	conflict: (t, e) => gn(t.from, t.symbol, e),
	say: (e) => `${ne.machine} already has δ(${yn(e.from)}, '${e.symbol}'). Use ${t} mode if you want multiple choices for the same read symbol.`
}), ao = {
	family: "twoway",
	schema: {
		transitionFields: [
			"from",
			"to",
			"on",
			"move"
		],
		stateFields: [
			"name",
			"start",
			"accept"
		],
		alphabetFields: ["sigma"]
	}
};
function lo(t, e, n, { nodeLimit: s = 1 / 0 } = {}) {
	const { Q: r, K: o, next: i, write: a, move: l, accept: c, start: u } = t, h = o + 1, f = [1];
	for (let M = 1; M <= e; M++) f.push(f[M - 1] * h);
	if (f[e] * e * (r + 1) > Number.MAX_SAFE_INTEGER) return {
		result: "size",
		nodes: 0
	};
	const p = (t, e) => Math.floor(t / f[e]) % h - 1, d = (t, e, n) => t + (n + 1 - Math.floor(t / f[e]) % h) * f[e], m = (t) => {
		for (let n = 0; n < e; n++) if (p(t, n) > 0) return !1;
		return !0;
	}, g = [], y = [], b = [], w = /* @__PURE__ */ new Set(), k = (t, n, s) => {
		const r = ((t + 1) * e + s) * f[e] + n;
		w.has(r) || (w.add(r), g.push(t), y.push(n), b.push(s));
	}, v = (t, e) => i[t * o + e] < 0 || c[i[t * o + e]], A = [];
	for (let M = 0; M < r; M++) c[M] || A.push(M);
	for (const M of A) for (let t = 0; t < o; t++) v(M, t) && k(M, d(0, n, t), n);
	const $ = e - 1;
	let S = 0;
	for (; S < g.length;) {
		const t = g[S], e = y[S], n = b[S];
		if (S++, (-1 === t || t === u) && m(e)) return {
			result: "start",
			nodes: S
		};
		if (S > s) return {
			result: "nodes",
			nodes: S
		};
		if (-1 === t) for (const s of A) for (let t = 0; t < o; t++) {
			if (v(s, t)) continue;
			const r = s * o + t;
			if (!(0 === n && l[r] < 0 || n === $ && l[r] > 0)) continue;
			const i = p(e, n);
			i >= 0 && i !== a[r] || k(s, d(e, n, t), n);
		}
		else for (const s of A) for (let r = 0; r < o; r++) {
			if (v(s, r)) continue;
			const c = s * o + r;
			if (i[c] !== t) continue;
			if (0 === n && l[c] > 0 || n === $ && l[c] < 0) {
				k(-1, e, n);
				continue;
			}
			const u = l[c] > 0 ? n - 1 : n + 1, h = p(e, u);
			h >= 0 && h !== a[c] || k(s, d(e, u, r), u);
		}
	}
	return {
		result: "never",
		nodes: S
	};
}
function co(t, { distance: e = 5, nodeLimit: n = 1 / 0 } = {}) {
	const s = function(t) {
		if (!t.twoWay) return "it is about a two-way tape";
		if (t.input.some((t) => 0 !== t)) return "it is about a blank starting tape";
		if (t.accept[t.start]) return "the start state halts at once";
		for (let e = 0; e < t.Q; e++) if (!t.accept[e]) for (let n = 0; n < t.K; n++) {
			const s = e * t.K + n;
			if (t.next[s] >= 0 && !t.accept[t.next[s]] && 0 === t.move[s]) return "it is about L and R moves only";
		}
		return null;
	}(t);
	if (s) return {
		ok: !1,
		reason: "model",
		why: s,
		tried: []
	};
	const r = [];
	for (let o = 1; o <= e; o++) {
		const e = 2 * o + 1, s = lo(t, e, o, { nodeLimit: n });
		if ("never" === s.result) return {
			ok: !0,
			size: e,
			distance: o,
			nodes: s.nodes,
			tried: r
		};
		if (r.push({
			size: e,
			nodes: s.nodes,
			result: s.result
		}), "nodes" === s.result || "size" === s.result) return {
			ok: !1,
			reason: s.result,
			tried: r
		};
	}
	return {
		ok: !1,
		reason: "start",
		tried: r
	};
}
we(ao, {
	"2DFA": {
		simulate: function(t) {
			const e = so(t);
			return ne.simSteps = no(e.path, t, e.accepted ? "accept" : "reject", e.finalNote), ne.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: io("2NFA"),
		decide: (t) => fn(function(t) {
			return so(t).accepted;
		}(t)),
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"δ",
				"q₀",
				"F"
			],
			delta: () => "Q × Σ → Q × {L, R, S}"
		}
	},
	"2NFA": {
		simulate: function(t) {
			const e = ro(t, null), n = e.accepted ? `Accepted in state ${ce(e.finalCfg.state)?.name || e.finalCfg.state}` : e.unresolved ? `Exploration limit ${ne.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance";
			return ne.simSteps = no(e.witnessPath, t, e.accepted ? "accept" : "reject", n), Wn(ne.simSteps, null), ne.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => fn(function(t) {
			return ro(t).accepted;
		}(t)),
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"δ",
				"q₀",
				"F"
			],
			delta: () => "Q × Σ → P(Q × {L, R, S})"
		}
	},
	"2DFT": {
		simulate: function(t) {
			const e = oo(t), n = ne.config.transducerAccepts, s = e.halted ? n ? e.accepted ? "accept" : "reject" : null : "timeout";
			ne.simSteps = no(e.path, t, s, e.finalNote);
			const r = ne.simSteps[ne.simSteps.length - 1];
			return r && (e.halted || (r.limit = ne.config.maxTmSteps), r.note += ` | Output: "${e.path[e.path.length - 1]?.outRaw ?? ""}"`), ne.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: io("FST"),
		decide: (t) => {
			const e = function(t) {
				const e = oo(t), n = e.path[e.path.length - 1];
				return {
					accepted: e.accepted,
					halted: e.halted,
					output: n?.outRaw ?? ""
				};
			}(t);
			return e.halted ? pn(e.accepted, e.output) : {
				verdict: "unk",
				output: e.output
			};
		},
		schema: {
			...ao.schema,
			transitionFields: [
				"from",
				"to",
				"on",
				"move",
				"out"
			],
			alphabetFields: ["sigma", "outputAlpha"]
		},
		formal: {
			tuple: () => [
				"Q",
				"Σ",
				"Δ",
				"δ",
				"λ",
				"q₀",
				"F"
			],
			delta: () => "Q × Σ → Q × {L, R, S} × Δ*",
			outputSay: "Q × Σ → Δ*"
		}
	}
});
var uo = class {
	constructor(t, e) {
		this.D = t, this.K = e, this.t = new Int32Array(t * e), this.qb = 0, this.tmax = new Int32Array(t * e + 1), this.skip = !1;
	}
	next() {
		const { D: t, K: e, t: n, tmax: s } = this, r = t - 1;
		if (this.qb < t * e && !this.skip) {
			const t = this.qb;
			return n[t] = s[t] < r && t === e * s[t] + e - 1 ? s[t] + 1 : 0, this.qb++, s[this.qb] = Math.max(s[t], n[t]), t;
		}
		for (this.skip = !1; this.qb > 1;) {
			const t = --this.qb;
			if (n[t] <= s[t] && n[t] < r) return n[t]++, this.qb++, s[this.qb] = Math.max(s[t], n[t]), t;
		}
		return -1;
	}
};
function ho(t, e, n, s) {
	const { n: r, K: o } = t, i = "R" === n ? 1 : -1, a = r * e + 1, l = a + 31 >>> 5, c = r * e, u = l, h = a * l, f = o * h, p = t.start, d = new uo(e, o), m = d.t, g = Array.from({ length: o * e }, () => new Uint32Array(f)), y = Array.from({ length: o * e }, () => new Uint32Array(l)), b = (t, e, n) => t[e + (n >>> 5)] >>> (31 & n) & 1, w = (t, e) => t * h + e * u, k = (n, s) => {
		n.fill(0), s.fill(0), s[c >>> 5] |= 1 << (31 & c);
		for (let t = 0; t < o; t++) n[w(t, c) + (c >>> 5)] |= 1 << (31 & c);
		for (const [o, i] of t.halts) for (let t = 0; t < e; t++) n[w(i, r * t + o) + (c >>> 5)] |= 1 << (31 & c);
	}, v = t.moves.filter((t) => t.d === i), A = Int32Array.from(t.moves.filter((t) => t.d !== i).flatMap((t) => [
		t.f,
		t.r,
		t.w,
		t.t
	])), $ = (t, e, n, s) => {
		for (const { f: a, r: l, w: c, t: u } of v) {
			if (c !== s) continue;
			const e = r * m[o * n + c] + u;
			t[w(l, r * n + a) + (e >>> 5)] |= 1 << (31 & e);
		}
		const i = o * n + s;
		for (let a = !0; a;) {
			a = !1;
			for (let e = 0; e < A.length; e += 4) {
				const n = A[e], s = A[e + 1], c = A[e + 2], u = A[e + 3];
				for (let e = 0; e <= i; e++) {
					const i = e / o | 0, f = w(e - i * o, r * i + u), p = w(s, r * m[e] + n);
					if (1 === l) {
						let e = t[f], n = t[p];
						const s = n;
						for (; e;) {
							const s = e & -e;
							e ^= s, n |= t[c * h + (31 - Math.clz32(s))];
						}
						n !== s && (t[p] = n, a = !0);
						continue;
					}
					for (let e = 0; e < l; e++) {
						let n = t[f + e];
						for (; n;) {
							const s = n & -n;
							n ^= s;
							const r = w(c, (e << 5) + (31 - Math.clz32(s)));
							for (let e = 0; e < l; e++) {
								const n = t[p + e] | t[r + e];
								n !== t[p + e] && (t[p + e] = n, a = !0);
							}
						}
					}
				}
			}
		}
		for (let r = !0; r;) {
			r = !1;
			for (let n = 0; n < a; n++) {
				if (b(e, 0, n)) continue;
				const s = w(0, n);
				for (let o = 0; o < l; o++) if (t[s + o] & e[o]) {
					e[n >>> 5] |= 1 << (31 & n), r = !0;
					break;
				}
			}
		}
	};
	for (;;) {
		const t = d.next();
		if (t < 0) return null;
		if (--s.work < 0) return "budget";
		const r = t / o | 0, i = t - r * o;
		if (0 === t ? k(g[0], y[0]) : (g[t].set(g[t - 1]), y[t].set(y[t - 1])), $(g[t], y[t], r, i), b(y[t], 0, p)) d.skip = !0;
		else if (t === o * e - 1) {
			const s = g[t], r = y[t], i = (t) => Array.from({ length: a }, (e, n) => {
				const r = [];
				for (let o = 0; o < a; o++) b(s, w(t, n), o) && r.push(o);
				return r;
			}), l = [];
			for (let t = 0; t < a; t++) b(r, 0, t) && l.push(t);
			return {
				side: n,
				depth: e,
				dfa: Array.from({ length: e }, (t, e) => Array.from(m.subarray(e * o, e * o + o))),
				nfa: Array.from({ length: o }, (t, e) => i(e)),
				accepted: l
			};
		}
	}
}
function fo(t, { depth: e = 7, work: n = 1 / 0 } = {}) {
	const s = function(t) {
		if (!t.twoWay) return { why: "it is about a two-way tape" };
		if (t.input.some((t) => 0 !== t)) return { why: "it is about a blank starting tape" };
		if (t.accept[t.start]) return { why: "the start state halts at once" };
		const e = new Int32Array(t.Q).fill(-1);
		let n = 0;
		for (let o = 0; o < t.Q; o++) t.accept[o] || (e[o] = n++);
		const s = [], r = [];
		for (let o = 0; o < t.Q; o++) if (!t.accept[o]) for (let n = 0; n < t.K; n++) {
			const i = o * t.K + n, a = t.next[i];
			if (a < 0 || t.accept[a]) s.push([e[o], n]);
			else {
				if (0 === t.move[i]) return { why: "it is about L and R moves only" };
				r.push({
					f: e[o],
					r: n,
					w: t.write[i],
					d: t.move[i],
					t: e[a]
				});
			}
		}
		return {
			n,
			K: t.K,
			start: e[t.start],
			halts: s,
			moves: r
		};
	}(t);
	if (s.why) return {
		ok: !1,
		reason: "model",
		why: s.why
	};
	const r = { work: n };
	for (let o = 1; o <= e; o++) for (const t of ["R", "L"]) {
		const e = ho(s, o, t, r);
		if ("budget" === e) return {
			ok: !1,
			reason: "budget",
			depth: o
		};
		if (e) return {
			ok: !0,
			...e,
			states: s.n * o + 1,
			start: s.start,
			n: s.n
		};
	}
	return {
		ok: !1,
		reason: "none",
		depth: e
	};
}
function po(t) {
	if (!t.twoWay) return { why: "it is about a two-way tape" };
	if (t.input.some((t) => 0 !== t)) return { why: "it is about a blank starting tape" };
	if (t.accept[t.start]) return { why: "the start state halts at once" };
	const e = new Int32Array(t.Q).fill(-1);
	let n = 0;
	for (let a = 0; a < t.Q; a++) t.accept[a] || (e[a] = n++);
	const s = t.K, r = new Int32Array(n * s).fill(-1), o = new Int32Array(n * s), i = new Int8Array(n * s);
	for (let a = 0; a < t.Q; a++) if (!t.accept[a]) for (let n = 0; n < s; n++) {
		const l = a * s + n, c = t.next[l];
		if (c < 0 || t.accept[c]) continue;
		if (0 === t.move[l]) return { why: "it is about L and R moves only" };
		const u = e[a] * s + n;
		r[u] = e[c], o[u] = t.write[l], i[u] = t.move[l];
	}
	return {
		n,
		K: s,
		start: e[t.start],
		next: r,
		write: o,
		move: i
	};
}
function mo(t, e) {
	const n = po(t);
	if (n.why) return {
		result: "model",
		why: n.why
	};
	const { K: s, next: r, write: o, move: i } = n, a = new Int32Array(e + 1), l = new Int32Array(e + 1), c = new Int32Array(e + 1), u = new Uint8Array(e + 1), h = new Uint8Array(e + 1);
	let f = /* @__PURE__ */ new Uint8Array(256), p = 128, d = 0, m = 0, g = 0, y = n.start;
	const b = (t, e) => {
		let n = t + p;
		if (n < 0 || n >= f.length) {
			const e = new Uint8Array(2 * f.length), s = n < 0 ? f.length : 0;
			e.set(f, s), p += s, f = e, n = t + p;
		}
		f[n] = e;
	}, w = (t) => {
		a[t] = y, l[t] = ((t) => {
			const e = t + p;
			return e >= 0 && e < f.length ? f[e] : 0;
		})(d), c[t] = d, u[t] = d === g ? 1 : 0, h[t] = d === m ? 1 : 0;
	};
	w(0);
	for (let v = 0; v < e; v++) {
		const t = y * s + l[v];
		if (r[t] < 0) return {
			result: "halt",
			steps: v + 1,
			state: y,
			read: l[v]
		};
		b(d, o[t]), d += i[t], d > g ? g = d : d < m && (m = d), y = r[t], w(v + 1);
	}
	const k = function(t, e, n, s, r, o) {
		for (let i = 1; t - 2 * i >= 0; i++) {
			const a = t - i, l = t - 2 * i;
			if (e[t] === e[a] && e[t] === e[l] && n[t] === n[a] && n[t] === n[l] && go(t, a, i, s[t] - s[a], e, n, s, r, o)) return {
				period: i,
				shift: s[t] - s[a],
				at: t
			};
		}
		return null;
	}(e, a, l, c, u, h);
	return k ? {
		result: "never",
		...k
	} : { result: "unknown" };
}
function go(t, e, n, s, r, o, i, a, l) {
	for (let c = 0;; c++) {
		const u = t - c, h = e - c;
		if (r[u] !== r[h] || o[u] !== o[h]) return !1;
		if (c >= n && (0 === s ? i[h] === i[u] : s > 0 ? a[h] && i[h] < i[u] : l[h] && i[u] < i[h])) return !0;
		if (h - 1 < 0) return !1;
	}
}
function yo(t, { variant: e = "impl2", lenH: n = 0, lenL: s, lenR: r, gas: o }) {
	const i = po(t);
	if (i.why) return {
		result: "model",
		why: i.why
	};
	if (!(s >= 1 && r >= 1)) return { result: "unknown" };
	const { K: a, next: l, write: c, move: u } = i, h = "impl2" !== e, f = [], p = [], d = /* @__PURE__ */ new Map(), m = (t, e) => {
		const n = `${t}|${e.join(",")}`;
		let s = d.get(n);
		return void 0 === s && (s = f.length, d.set(n, s), f.push(t), p.push(e)), s;
	}, g = h ? m(0, []) : 0, y = /* @__PURE__ */ new Map(), b = (t) => t.join(","), w = (t, e) => {
		const n = b(e.slice(0, -1)), s = e[e.length - 1];
		let r = t.get(n);
		return r || (r = {
			list: [],
			has: /* @__PURE__ */ new Set()
		}, t.set(n, r)), !!r.has.has(s) || (r.has.add(s), r.list.unshift(s), !1);
	}, k = (t, e) => {
		const n = t.get(b(e));
		return n ? n.list.slice() : [];
	}, v = /* @__PURE__ */ new Map(), A = /* @__PURE__ */ new Map(), $ = [], S = /* @__PURE__ */ new Set(), M = (t) => {
		const e = ((t) => `${t.s}|${t.m}|${t.l.join(",")}|${t.r.join(",")}`)(t);
		return !!S.has(e) || (S.add(e), $.push(t), !1);
	}, x = (t) => Array(t).fill(g);
	w(v, x(s)), w(A, x(r)), M({
		l: x(s),
		r: x(r),
		m: g,
		s: i.start
	});
	const E = (t, s) => {
		const r = ((t, s) => {
			if (!h) {
				const e = t * a + s;
				return l[e] < 0 ? null : [
					l[e],
					u[e],
					c[e]
				];
			}
			const r = 32 * s + t;
			if (y.has(r)) return y.get(r);
			const o = f[s], i = t * a + o;
			let d = null;
			if (l[i] >= 0) {
				const r = t * a + o, h = "impl1" === e ? [r, ...p[s]].slice(0, n) : [r, ...p[s].filter((t) => t !== r)];
				d = [
					l[i],
					u[i],
					m(c[i], h)
				];
			}
			return y.set(r, d), d;
		})(s.s, s.m);
		if (!r) return !1;
		const [o, i, d] = r;
		let g, b = !0;
		if (i > 0) {
			g = w(v, s.l);
			const e = [d, ...s.l.slice(0, -1)], n = s.r.slice(1), r = s.r[0];
			for (const s of k(A, n)) {
				const i = {
					l: e,
					m: r,
					r: [...n, s],
					s: o
				};
				M(i) || (t.push(i), b = !1);
			}
		} else {
			g = w(A, s.r);
			const e = [d, ...s.r.slice(0, -1)], n = s.l.slice(1), r = s.l[0];
			for (const s of k(v, n)) {
				const i = {
					r: e,
					m: r,
					l: [...n, s],
					s: o
				};
				M(i) || (t.push(i), b = !1);
			}
		}
		return g && b;
	};
	let T = o;
	for (let N = o; N > 0; N--) {
		const t = $.slice();
		let e = !0, n = null;
		for (;;) {
			if (0 === T) {
				n = !1;
				break;
			}
			if (!t.length) {
				T--, n = e;
				break;
			}
			e = E(t, t.pop()) && e, T--;
		}
		if (n) {
			const t = (t) => [...t].flatMap(([t, e]) => e.list.map((e) => t ? `${t},${e}` : `${e}`));
			return {
				result: "never",
				contexts: $.length,
				left: t(v),
				right: t(A)
			};
		}
		if (0 === T) break;
	}
	return { result: "unknown" };
}
const bo = [
	{
		variant: "impl2",
		lenL: 1,
		lenR: 1,
		gas: 100
	},
	{
		variant: "impl2",
		lenL: 2,
		lenR: 2,
		gas: 200
	},
	{
		variant: "impl2",
		lenL: 3,
		lenR: 3,
		gas: 400
	},
	{
		variant: "impl1",
		lenH: 2,
		lenL: 2,
		lenR: 2,
		gas: 1600
	},
	{
		variant: "impl1",
		lenH: 2,
		lenL: 3,
		lenR: 3,
		gas: 1600
	},
	{
		variant: "impl1",
		lenH: 4,
		lenL: 2,
		lenR: 2,
		gas: 600
	},
	{
		variant: "impl1",
		lenH: 4,
		lenL: 3,
		lenR: 3,
		gas: 1600
	},
	{
		variant: "impl1",
		lenH: 6,
		lenL: 2,
		lenR: 2,
		gas: 3200
	},
	{
		variant: "impl1",
		lenH: 6,
		lenL: 3,
		lenR: 3,
		gas: 3200
	},
	{
		variant: "impl1",
		lenH: 8,
		lenL: 2,
		lenR: 2,
		gas: 1600
	},
	{
		variant: "impl1",
		lenH: 8,
		lenL: 3,
		lenR: 3,
		gas: 1600
	}
];
function wo(t, e = bo) {
	for (const n of e) {
		const e = yo(t, n);
		if ("unknown" !== e.result) return "never" === e.result ? {
			...e,
			params: n
		} : e;
	}
	return { result: "unknown" };
}
function ko(t, { len: e, minRep: n, maxT: s, gas: r }) {
	const o = po(t);
	if (o.why) return {
		result: "model",
		why: o.why
	};
	const { K: i, next: a, write: l, move: c } = o, u = /* @__PURE__ */ new Map(), h = (t) => {
		const e = t.join(".");
		let n = u.get(e);
		return void 0 === n && (n = u.size + 1, u.set(e, n)), n;
	}, f = /* @__PURE__ */ new Map(), p = (t, e) => {
		const n = `${t.id}|${t.c}|${t.k ? 1 : 0}|${e ? e.id : 0}`;
		let s = f.get(n);
		return s || (s = {
			head: t,
			tail: e,
			id: f.size + 1
		}, f.set(n, s)), s;
	}, d = (t, e, n) => ({
		w: t,
		id: h(t),
		c: e,
		k: n
	}), m = Array(e).fill(0), g = (t, e) => {
		const s = h(e);
		if (t) {
			const r = t.head;
			if (r.id === s) {
				const s = r.c + 1;
				return p(s < n ? d(e, s, r.k) : d(e, n, !1), t.tail);
			}
			return p(d(e, 1, !0), t);
		}
		return e.every((t) => 0 === t) ? null : p(d(e, 1, !0), null);
	}, y = (t, e, n) => {
		if (!e.length) return null;
		let r, o, u = e[0], h = t;
		n > 0 ? (r = [], o = e.slice(1)) : (r = e.slice(1), o = []);
		for (let f = 0; f < s; f++) {
			const t = h * i + u;
			if (a[t] < 0) return null;
			const e = a[t], s = l[t];
			if (c[t] > 0) {
				if (!o.length) return [
					e,
					[s, ...r],
					n < 0
				];
				r = [s, ...r], u = o[0], o = o.slice(1), h = e;
			} else {
				if (!r.length) return [
					e,
					[s, ...o],
					n > 0
				];
				o = [s, ...o], u = r[0], r = r.slice(1), h = e;
			}
		}
		return null;
	}, b = (t) => {
		const e = ((t) => {
			if (!t) return {
				w: m,
				rests: [null]
			};
			const e = t.head;
			if (0 === e.c) return null;
			const n = e.c - 1, s = n > 0 ? p(d(e.w, n, !0), t.tail) : t.tail;
			return {
				w: e.w,
				rests: e.k ? [s] : [s, t]
			};
		})(t.r);
		if (!e) return null;
		const n = [];
		for (const s of e.rests) {
			const r = y(t.s, e.w, t.sgn);
			if (!r) return null;
			const [o, i, a] = r;
			n.push(a ? {
				l: g(s, i),
				r: t.l,
				s: o,
				sgn: -t.sgn
			} : {
				l: g(t.l, i),
				r: s,
				s: o,
				sgn: t.sgn
			});
		}
		return n;
	}, w = (t) => `${t.sgn}|${t.s}|${t.l ? t.l.id : 0}|${t.r ? t.r.id : 0}`, k = {
		l: null,
		r: null,
		s: o.start,
		sgn: 1
	}, v = /* @__PURE__ */ new Set([w(k)]), A = [k];
	for (let $ = r; $ > 0 && A.length; $--) {
		const t = b(A.pop());
		if (!t) return { result: "unknown" };
		for (const e of t) {
			const t = w(e);
			v.has(t) || (v.add(t), A.push(e));
		}
	}
	return A.length ? { result: "unknown" } : {
		result: "never",
		configurations: v.size
	};
}
const vo = -1, Ao = -2;
var $o = class extends Error {}, So = class extends Error {}, Mo = class extends Error {}, xo = class extends Error {}, Eo = class t {
	constructor(t, e, n, s, r = 0) {
		this.m = t, this.c = e, this.headPos = n, this.head = s, this.stepCount = r;
	}
	static initial(e) {
		return new t(e, [
			vo,
			Ao,
			vo
		], 1, {
			state: e.start,
			dir: 1
		});
	}
	clone() {
		return new t(this.m, this.c.slice(), this.headPos, { ...this.head }, this.stepCount);
	}
	get len() {
		return this.c.length;
	}
	after(t, e) {
		const n = t + e;
		if (n < 0 || n >= this.c.length) throw new So();
		return n;
	}
	content(t) {
		if (t >= this.c.length) throw new So();
		const e = this.c[t];
		if (e === vo) {
			if (0 === t || t === this.c.length - 1) return vo;
			throw new Mo();
		}
		if (e === Ao) {
			if (t === this.headPos) return Ao;
			throw new Mo();
		}
		return e;
	}
	readPos() {
		if (this.content(this.headPos) !== Ao) throw new Mo();
		return this.after(this.headPos, this.head.dir);
	}
	step() {
		let t = this.readPos();
		const e = this.content(t);
		if (e === Ao) throw new Mo();
		const n = e === vo ? 0 : e, { K: s, next: r, write: o, move: i } = this.m, a = this.head.state * s + n;
		if (r[a] < 0) throw new $o();
		const l = {
			state: r[a],
			dir: i[a]
		};
		e === vo && (0 !== t ? this.c.push(vo) : (this.c.unshift(vo), this.headPos++, t++)), this.c[this.headPos] = Ao, this.c[t] = o[a];
		const c = this.head.dir === l.dir;
		this.head = l, c && (this.c[this.headPos] = this.c[t], this.c[t] = Ao, this.headPos = this.after(this.headPos, l.dir)), this.stepCount++;
	}
	words() {
		const t = [];
		let e = 0;
		for (; e < this.c.length && this.c[e] === vo;) e++;
		for (; e < this.c.length && this.c[e] !== Ao; e++) {
			if (this.c[e] === vo) throw new Mo();
			t.push(this.c[e]);
		}
		const n = [];
		for (let s = this.headPos + 1; s < this.c.length && this.c[s] !== vo; s++) {
			if (this.c[s] === Ao) throw new Mo();
			n.push(this.c[s]);
		}
		return [t, n];
	}
	firstNonInf() {
		const t = this.c.findIndex((t) => t !== vo);
		return t < 0 ? null : t;
	}
	lastNonInf() {
		for (let t = this.c.length - 1; t >= 0; t--) if (this.c[t] !== vo) return t;
		return null;
	}
	sub(e, n) {
		return n <= e || n > this.c.length ? null : new t(this.m, this.c.slice(e, n), this.headPos - e, { ...this.head }, this.stepCount);
	}
	toString() {
		let t = "";
		for (const e of this.c) t += e === vo ? "0∞" : e === Ao ? 1 === this.head.dir ? `${To(this.head.state)}>` : `<${To(this.head.state)}` : e;
		return t;
	}
};
const To = (t) => String.fromCharCode(65 + t), No = (t, e) => t.state === e.state && t.dir === e.dir, Po = (t, e) => t.length === e.length && t.every((t, n) => t === e[n]);
function Do(t, e, n) {
	let s = t.length, r = 0, o = s;
	for (; r < o;) {
		const i = r + (s >> 1), a = n(t[i]);
		if (a < e) r = i + 1;
		else {
			if (!(a > e)) return {
				ok: !0,
				i
			};
			o = i;
		}
		s = o - r;
	}
	return {
		ok: !1,
		i: r
	};
}
var Io = class t {
	constructor(t, e) {
		this.tape = t, this.reps = e;
	}
	clone() {
		return new t(this.tape.clone(), this.reps.map((t) => ({ ...t })));
	}
	word(t) {
		const e = this.reps[t];
		if (!e) throw new Mo();
		const n = [];
		for (let s = e.beg; s < e.end; s++) {
			const t = this.tape.c[s];
			if (void 0 === t || t < 0) throw new Mo();
			n.push(t);
		}
		if (!n.length) throw new Mo();
		return n;
	}
	isBeg(t) {
		return Do(this.reps, t, (t) => t.beg).ok;
	}
	isEnd(t) {
		return Do(this.reps, t, (t) => t.end).ok;
	}
	repRight(t) {
		const e = Do(this.reps, t, (t) => t.beg);
		return e.ok ? this.reps[e.i] : e.i === this.reps.length ? null : this.reps[e.i];
	}
	repLeft(t) {
		const e = Do(this.reps, t, (t) => t.beg);
		return e.ok ? this.reps[e.i] : 0 === e.i ? null : this.reps[e.i - 1];
	}
	facingRepeater() {
		const t = this.tape.head;
		if (this.tape.content(this.tape.headPos) !== Ao) throw new Mo();
		return this.isBeg(this.tape.headPos + 1) && 1 === t.dir || this.isEnd(this.tape.headPos) && -1 === t.dir;
	}
	shiftRuleTape() {
		if (!this.facingRepeater()) throw new xo();
		const t = this.tape.headPos;
		let e, n;
		if (1 === this.tape.head.dir) {
			const s = this.repLeft(t);
			e = s ? s.end : this.tape.firstNonInf(), n = this.repRight(t).end;
		} else {
			e = this.repLeft(t).beg;
			const s = this.repRight(t);
			n = s ? s.beg : this.tape.lastNonInf() + 1;
		}
		const s = this.tape.sub(e, n);
		if (!s) throw new Mo();
		return s;
	}
	detectShiftRule() {
		const t = this.shiftRuleTape(), e = t.clone(), n = { ...e.head }, s = /* @__PURE__ */ new Set([e.toString()]), [r, o] = e.words(), i = 1 === n.dir ? o : r;
		if (!i.length) throw new Mo();
		let a = t.readPos(), l = a, c = 0;
		for (;;) {
			try {
				t.step();
			} catch (u) {
				if (!(u instanceof So)) throw u;
				if (!No(n, t.head)) throw new xo();
				const [s, r] = t.words();
				if (1 === n.dir) {
					if (a >= e.headPos) {
						if (s.length < i.length) throw new xo();
						return {
							head: n,
							tail: [],
							lhs: i,
							rhs: s.slice(s.length - i.length),
							steps: c
						};
					}
					const r = e.sub(a, e.len), o = t.sub(a, t.len);
					if (!r || !o) throw new xo();
					const [l] = r.words(), [u] = o.words();
					if (u.length < i.length || !Po(l, u.slice(i.length))) throw new xo();
					return {
						head: n,
						tail: l,
						lhs: i,
						rhs: u.slice(0, i.length),
						steps: c
					};
				}
				if (l <= e.headPos) {
					if (r.length < i.length) throw new xo();
					return {
						head: n,
						tail: [],
						lhs: i,
						rhs: r.slice(0, i.length),
						steps: c
					};
				}
				const o = e.sub(0, l + 1), h = t.sub(0, l + 1);
				if (!o || !h) throw new xo();
				const [, f] = o.words(), [, p] = h.words();
				if (p.length < f.length || !Po(f, p.slice(0, f.length))) throw new xo();
				return {
					head: n,
					tail: f,
					lhs: i,
					rhs: p.slice(f.length),
					steps: c
				};
			}
			const r = t.toString();
			if (s.has(r)) throw new xo();
			let o;
			s.add(r);
			try {
				o = t.readPos();
			} catch {
				o = null;
			}
			null !== o && (o < a && (a = o), o > l && (l = o)), c++;
		}
	}
	applyShiftRule(t) {
		if (!this.facingRepeater()) throw new Mo();
		const e = this.tape.head.dir, n = this.tape.headPos, s = 1 === e ? this.repRight(n) : this.repLeft(n), r = Do(this.reps, s.beg, (t) => t.beg).i, o = s.end - s.beg, i = 1 === e ? s.beg - t.tail.length - 1 : s.beg + t.tail.length + 1;
		if (i < 0) throw new Mo();
		const a = {
			beg: i,
			end: i + o
		};
		this.reps[r] = a;
		const l = this.tape.c;
		for (let c = 0; c < Math.min(o, t.rhs.length); c++) l[s.beg + c] = t.rhs[c];
		if (1 === e) {
			const t = l.slice(a.beg, s.end), e = t.slice(t.length - o).concat(t.slice(0, t.length - o));
			for (let n = 0; n < e.length; n++) l[a.beg + n] = e[n];
			this.tape.headPos += o;
		} else {
			const t = l.slice(s.beg, a.end), e = t.slice(o).concat(t.slice(0, o));
			for (let n = 0; n < e.length; n++) l[s.beg + n] = e[n];
			this.tape.headPos -= o;
		}
	}
	step() {
		if (!this.facingRepeater()) {
			const t = this.tape.head.dir, e = this.tape.len;
			if (this.tape.step(), this.tape.len > e && -1 === t) for (const n of this.reps) n.beg++, n.end++;
			return null;
		}
		const t = this.detectShiftRule();
		return this.applyShiftRule(t), t;
	}
	leftOf(t) {
		const e = this.reps[t];
		if (!e) throw new Mo();
		if (this.isEnd(e.beg)) return [];
		const n = [];
		for (let s = e.beg - 1; s >= 0; s--) {
			const t = this.tape.c[s];
			if (t === Ao || t === vo) break;
			if (n.push(t), this.isEnd(s)) break;
		}
		return n.reverse();
	}
	rightOf(t) {
		const e = this.reps[t];
		if (!e) throw new Mo();
		const n = [];
		for (let s = e.end; s < this.tape.len && !this.isBeg(s); s++) {
			const t = this.tape.c[s];
			if (t === Ao || t === vo) break;
			n.push(t);
		}
		return n;
	}
	align() {
		for (let t = 0; t < this.reps.length; t++) {
			const e = this.word(t), n = this.reps[t];
			if (n.beg > this.tape.headPos) break;
			if (n.beg === this.tape.headPos) throw new Mo();
			const s = this.leftOf(t);
			for (let r = 0; r < s.length; r++) {
				const o = s.slice(r), i = o.concat(e);
				if (Po(i.slice(e.length), o)) {
					this.reps[t] = {
						beg: n.beg - o.length,
						end: n.end - o.length
					};
					break;
				}
			}
		}
		for (let t = this.reps.length - 1; t >= 0; t--) {
			const e = this.word(t), n = this.reps[t];
			if (n.beg < this.tape.headPos) break;
			if (n.beg <= this.tape.headPos) throw new Mo();
			const s = this.rightOf(t);
			for (let r = s.length; r >= 1; r--) {
				const o = s.slice(0, r), i = e.concat(o);
				if (Po(i.slice(0, o.length), o)) {
					this.reps[t] = {
						beg: n.beg + o.length,
						end: n.end + o.length
					};
					break;
				}
			}
		}
	}
	isSpecialCaseOf(t) {
		if (!No(this.tape.head, t.tape.head)) return !1;
		const e = this.clone();
		e.align();
		const n = t.clone();
		if (n.align(), e.reps.length !== n.reps.length) return !1;
		if (!e.reps.length) throw new Mo();
		if (e.reps[0].beg < e.tape.headPos) {
			if (!Po(e.leftOf(0), n.leftOf(0))) return !1;
		} else if (!Po(e.tape.c.slice(0, e.tape.headPos), n.tape.c.slice(0, n.tape.headPos))) return !1;
		for (let r = 0; r < this.reps.length; r++) {
			const t = this.word(r), s = this.reps[r];
			if (s.beg > this.tape.headPos) break;
			if (s.beg === this.tape.headPos) throw new Mo();
			const o = e.rightOf(r), i = n.rightOf(r);
			if (i.length > o.length) return !1;
			if ((o.length - i.length) % t.length) return !1;
			const a = (o.length - i.length) / t.length;
			if (!Po(o.slice(a * t.length), i)) return !1;
			for (let e = 0; e < a * t.length; e++) if (o[e] !== t[e % t.length]) return !1;
		}
		for (let r = this.reps.length - 1; r >= 0; r--) {
			const t = this.word(r), s = this.reps[r];
			if (s.beg < this.tape.headPos) break;
			if (s.beg <= this.tape.headPos) throw new Mo();
			const o = e.leftOf(r), i = n.leftOf(r);
			if (i.length > o.length) return !1;
			if ((o.length - i.length) % t.length) return !1;
			const a = (o.length - i.length) / t.length;
			if (!Po(o.slice(0, i.length), i)) return !1;
			for (let e = 0; e < a * t.length; e++) if (o[i.length + e] !== t[e % t.length]) return !1;
		}
		const s = e.reps.length - 1;
		if (e.reps[s].beg > e.tape.headPos) {
			if (!Po(e.rightOf(s), n.rightOf(n.reps.length - 1))) return !1;
		} else if (!function(t, e, n, s) {
			if (t.c.length - e !== n.c.length - s) return !1;
			for (let r = 0; r < t.c.length - e; r++) {
				const o = t.c[e + r];
				if (o !== n.c[s + r]) return !1;
				if (o === Ao && !No(t.head, n.head)) return !1;
			}
			return !0;
		}(e.tape, e.tape.headPos, n.tape, n.tape.headPos)) return !1;
		return !0;
	}
	proveNonHalt(t) {
		const e = this.clone();
		this.align();
		for (let n = 0; n < t; n++) if (this.step(), this.align(), this.isSpecialCaseOf(e)) return n + 1;
		return null;
	}
	toString() {
		let t = "";
		return this.tape.c.forEach((e, n) => {
			if (e === vo) t += ".";
			else if (e === Ao) t += 1 === this.tape.head.dir ? `${To(this.tape.head.state)}>` : `<${To(this.tape.head.state)}`;
			else {
				const s = this.isBeg(n), r = this.isEnd(n + 1);
				t += s && r ? `(${e})` : s ? `(${e}` : r ? `${e})` : `${e}`;
			}
		}), t;
	}
};
const Co = (t) => Array.from(t.cells.filter((t) => t >= 0)), jo = (t) => ({
	len: t.len,
	stepCount: t.stepCount,
	head: { ...t.head },
	cells: Int8Array.from(t.c)
});
function Bo(t, e, n) {
	const s = [], r = [], o = -1 === e.dir ? 2 : 1;
	let i = 0;
	n.forEach((t, e) => {
		"number" == typeof t ? s.push(t) : (s.push(...t), r.push({
			beg: o + i + e,
			end: o + i + e + t.length
		}), i += t.length - 1);
	});
	return new Io(new Eo(t, -1 === e.dir ? [
		vo,
		Ao,
		...s,
		vo
	] : [
		vo,
		...s,
		Ao,
		vo
	], -1 === e.dir ? 1 : s.length + 1, { ...e }), r);
}
function Fo(t, e, n, s) {
	const r = { ...e.head }, o = Co(e), i = Co(n), a = Co(s), l = [];
	let c = 0, u = 0;
	t: for (;;) {
		const e = c + u, n = c + 2 * u;
		if (c === o.length && e === i.length) return Bo(t, r, l);
		if (c < o.length && e < i.length && n < a.length && o[c] === i[e] && i[e] === a[n]) {
			l.push(o[c]), c++;
			continue;
		}
		const s = o.length - c, h = i.length - e;
		let f = 0;
		for (; f < h - s && e + f < i.length && n + f < a.length && i[e + f] === a[n + f];) f++;
		for (let t = f; t >= 1; t--) {
			let s = n + 2 * t <= a.length;
			for (let e = 0; s && e < t; e++) a[n + e] !== a[n + t + e] && (s = !1);
			if (s) {
				l.push(i.slice(e, e + t)), u += t;
				continue t;
			}
		}
		return null;
	}
}
const Ro = (t, e, n, s) => n - e - (e - t) === s - n - (n - e);
function Oo(t, e, n, s) {
	if (t.length < 4) return null;
	let r = 0;
	for (let o = 3; o < t.length; o++) {
		const i = t[o];
		for (let a = 2; a < o; a++) {
			const o = t[a], l = i.len - o.len, c = o.len - l;
			if (c < 0) continue;
			const u = Do(t, c, (t) => t.len);
			if (!u.ok) continue;
			const h = t[u.i], f = h.len - l;
			if (f < 0) continue;
			const p = Do(t, f, (t) => t.len);
			if (!p.ok) continue;
			const d = t[p.i];
			if (!Ro(d.stepCount, h.stepCount, o.stepCount, i.stepCount)) continue;
			const m = Fo(s, d, h, o);
			if (!m) continue;
			const g = m.toString();
			let y = null;
			try {
				y = m.proveNonHalt(e);
			} catch {
				y = null;
			}
			if (null !== y) return {
				formula: g,
				steps: o.stepCount,
				macroSteps: y
			};
			if (++r === n) return null;
		}
	}
	return null;
}
function Qo(t, { steps: e = 25e4, macroSteps: n = 5e4, formulas: s = 20, recordCells: r = 67108864 } = {}) {
	const o = po(t);
	if (o.why) return {
		result: "model",
		why: o.why
	};
	const i = Eo.initial(o), a = /* @__PURE__ */ new Map(), l = (t) => 2 * t.state + (1 === t.dir ? 1 : 0);
	a.set(l(i.head), [jo(i)]);
	let c = i.len;
	try {
		for (let t = 0; t < e; t++) {
			i.step();
			const t = i.readPos();
			if (0 === t || t === i.len - 1) {
				const t = l(i.head);
				if (a.has(t) || a.set(t, []), a.get(t).push(jo(i)), c += i.len, c > r) return {
					result: "unknown",
					reason: "records"
				};
			}
		}
	} catch (u) {
		if (u instanceof $o) return { result: "halt" };
		throw u;
	}
	for (const h of [...a.keys()].sort((t, e) => t - e)) {
		const t = Oo(a.get(h), n, s, o);
		if (t) return {
			result: "never",
			...t
		};
	}
	return { result: "unknown" };
}
const zo = /* @__PURE__ */ new Set(["TM", "ITM"]), Lo = bo, Wo = [[4, 3]];
function qo(t, e) {
	let n = Math.imul(1540483477 ^ t, 2654435761) ^ Math.imul(e, 2246822519);
	return n ^= n >>> 15, n = Math.imul(n, 739982445), n ^= n >>> 12, n = Math.imul(n, 695872825), n ^ n >>> 15;
}
var Uo = class {
	constructor(t) {
		this.p = t, this.buf = new (t.K > 255 ? Uint16Array : Uint8Array)(256), this.base = -128, this.head = 0, this.state = t.start, this.t = 0, this.hash = 0, this.lo = 0, this.hi = 0, this.wallAt = -1, this.halted = null, t.input.forEach((t, e) => this.set(e, t)), t.input.length && (this.hi = Math.max(this.hi, t.input.length - 1));
	}
	get(t) {
		const e = t - this.base;
		return e >= 0 && e < this.buf.length ? this.buf[e] : 0;
	}
	set(t, e) {
		let n = t - this.base;
		if (n < 0 || n >= this.buf.length) {
			if (0 === e) return;
			this.grow(t), n = t - this.base;
		}
		const s = this.buf[n];
		s !== e && (this.hash ^= (s ? qo(t, s) : 0) ^ (e ? qo(t, e) : 0), this.buf[n] = e);
	}
	grow(t) {
		const e = this.buf.length, n = Math.max(2 * e, (t < this.base ? this.base - t : t - this.base - e + 1) + e + 64), s = new this.buf.constructor(n), r = t < this.base ? this.base - (n - e) : this.base;
		s.set(this.buf, this.base - r), this.buf = s, this.base = r;
	}
	step() {
		const t = this.p, e = this.state;
		if (t.accept[e]) return this.halted = "accept", !1;
		const n = this.get(this.head), s = e * t.K + n, r = t.next[s];
		if (r < 0) return this.halted = "none", this.haltRead = n, !1;
		this.set(this.head, t.write[s]);
		const o = this.head + t.move[s];
		return !t.twoWay && o < 0 ? this.wallAt = this.t : this.head = o, this.head > this.hi ? this.hi = this.head : this.head < this.lo && (this.lo = this.head), this.state = r, this.t++, !0;
	}
	snapshot() {
		const t = Math.min(this.lo, this.head), e = Math.max(this.hi, this.head), n = new this.buf.constructor(e - t + 1);
		for (let s = t; s <= e; s++) n[s - t] = this.get(s);
		return {
			t: this.t,
			state: this.state,
			head: this.head,
			hash: this.hash,
			lo: t,
			cells: n
		};
	}
	matches(t) {
		if (this.state !== t.state || this.head !== t.head || this.hash !== t.hash) return !1;
		const e = Math.min(this.lo, t.lo), n = Math.max(this.hi, t.lo + t.cells.length - 1);
		for (let s = e; s <= n; s++) {
			const e = s - t.lo;
			if (this.get(s) !== (e >= 0 && e < t.cells.length ? t.cells[e] : 0)) return !1;
		}
		return !0;
	}
	sameAs(t) {
		if (this.state !== t.state || this.head !== t.head || this.hash !== t.hash) return !1;
		const e = Math.min(this.lo, t.lo), n = Math.max(this.hi, t.hi);
		for (let s = e; s <= n; s++) if (this.get(s) !== t.get(s)) return !1;
		return !0;
	}
	ones() {
		let t = 0;
		for (let e = 0; e < this.buf.length; e++) 0 !== this.buf[e] && t++;
		return t;
	}
	cells(t, e) {
		const n = [];
		for (let s = t; s <= e; s++) n.push(this.get(s));
		return n;
	}
}, _o = class {
	constructor(t, e) {
		this.dir = t, this.n = 0, this.gBack = [], this.gFirst = [], this.ring = Array.from({ length: e }, () => []), this.saved = Array(e).fill(null), this.power = new Array(e).fill(1), this.since = new Array(e).fill(0), this.checks = 0;
	}
	visit(t) {
		const e = this.dir, n = this.gBack, s = this.gFirst;
		let r = n.length, o = -1;
		for (; r > 0 && (e > 0 ? n[r - 1] > t : n[r - 1] < t);) r--, o = s[r];
		o >= 0 && (n.length = r, s.length = r, n.push(t), s.push(o));
	}
	backSince(t) {
		const e = this.gFirst;
		let n = 0, s = e.length - 1, r = 0;
		for (; n <= s;) {
			const o = n + s >> 1;
			e[o] <= t ? (r = o, n = o + 1) : s = o - 1;
		}
		return this.gBack[r];
	}
	compare(t, e, n) {
		const s = this.dir, r = e.head;
		if (e.wallAt >= t.t) return null;
		const o = s * (t.head - this.backSince(t.i));
		if (o + 1 > t.cells.length) return null;
		this.checks++;
		for (let c = 0; c <= o; c++) if (t.cells[t.cells.length - 1 - c] !== e.get(r - s * c)) return null;
		const i = [...t.cells.slice(t.cells.length - 1 - o)], a = s > 0 ? t.head - o : t.head, l = s > 0 ? r - o : r;
		return {
			verdict: "never",
			method: "translated",
			direction: s > 0 ? "right" : "left",
			from: t.t,
			at: e.t,
			period: e.t - t.t,
			shift: r - t.head,
			window: o + 1,
			state: n,
			before: {
				t: t.t,
				head: t.head,
				lo: a,
				cells: s > 0 ? i : i.reverse()
			},
			after: {
				t: e.t,
				head: r,
				lo: l,
				cells: e.cells(l, l + o)
			}
		};
	}
	record(t) {
		const e = this.dir, n = t.head, s = t.state, r = this.n++;
		this.gBack.push(n), this.gFirst.push(r);
		const o = this.ring[s];
		for (let h = o.length - 1; h >= 0; h--) {
			const e = this.compare(o[h], t, s);
			if (e) return e;
		}
		const i = this.saved[s];
		if (i && (!o.length || i.i < o[0].i)) {
			const e = this.compare(i, t, s);
			if (e) return e;
		}
		const a = e > 0 ? t.lo : t.hi, l = Math.min(1024, e * (n - a)) + 1, c = new t.buf.constructor(l);
		for (let h = 0; h < l; h++) c[l - 1 - h] = t.get(n - e * h);
		const u = {
			i: r,
			t: t.t,
			head: n,
			cells: c
		};
		return o.push(u), o.length > 16 && o.shift(), (!i || ++this.since[s] >= this.power[s]) && (i && (this.power[s] *= 2), this.saved[s] = u, this.since[s] = 0), null;
	}
};
function Ko(t, e) {
	const n = function(t, { budget: e = 1e7, backward: n = !0, segment: s = 5, segmentNodes: r = 2e5, far: o = 4, farWork: i = 2e5, loops: a = 4100, ngram: l = Lo, repwl: c = Wo, bouncers: u = true } = {}) {
		const h = n ? function(t, { depth: e = 48, nodes: n = 2e4 } = {}) {
			const { Q: s, K: r, next: o, write: i, move: a, accept: l } = t, c = function(t) {
				const { Q: e, K: n, next: s, write: r } = t, o = new Uint8Array(n);
				o[0] = 1;
				for (const i of t.input) o[i] = 1;
				for (let i = !0; i;) {
					i = !1;
					for (let t = 0; t < e * n; t++) s[t] >= 0 && o[t % n] && !o[r[t]] && (o[r[t]] = 1, i = !0);
				}
				return o;
			}(t), u = Array.from({ length: s }, () => []);
			for (let g = 0; g < s; g++) if (!l[g]) for (let t = 0; t < r; t++) {
				const e = g * r + t;
				o[e] >= 0 && c[t] && u[o[e]].push(e);
			}
			const h = (t, e, n, s) => {
				const o = t.tape.get(n);
				if (void 0 !== o && o !== i[e]) return null;
				let a = t.wall;
				if (s) {
					if (null === a) {
						for (const e of t.tape.keys()) if (e < n) return null;
						a = n;
					} else if (a !== n) return null;
				} else if (null !== a && n < a) return null;
				const l = new Map(t.tape);
				return l.set(n, e % r), {
					state: e / r | 0,
					head: n,
					tape: l,
					wall: a,
					depth: t.depth + 1
				};
			}, f = [];
			let p = 0, d = null;
			for (let g = 0; g < s; g++) for (let s = l[g] ? -1 : 0; s < (l[g] ? 0 : r); s++) {
				if (s >= 0 && (o[g * r + s] >= 0 || !c[s])) continue;
				const i = {
					state: g,
					read: s,
					depth: 0
				}, l = [{
					state: g,
					head: 0,
					tape: new Map(s >= 0 ? [[0, s]] : []),
					wall: null,
					depth: 0
				}];
				for (; l.length;) {
					const s = l.pop();
					if (++p > n) return {
						ok: !1,
						reason: "nodes",
						explored: n,
						depth: e
					};
					if (s.depth >= e) return {
						ok: !1,
						reason: "depth",
						explored: p,
						depth: e
					};
					s.depth > i.depth && (i.depth = s.depth), (!d || s.depth > d.n.depth) && (d = {
						n: s,
						halt: i
					});
					for (const e of u[s.state]) {
						const n = a[e], r = h(s, e, s.head - n, !1);
						if (r && l.push(r), n < 0 && !t.twoWay) {
							const t = h(s, e, s.head, !0);
							t && l.push(t);
						}
					}
				}
				f.push(i);
			}
			let m = null;
			if (d) {
				const { n: t, halt: e } = d;
				let n = t.head, s = t.head;
				for (const o of t.tape.keys()) o < n && (n = o), o > s && (s = o);
				const r = [];
				for (let o = n; o <= s; o++) r.push(t.tape.has(o) ? t.tape.get(o) : -1);
				m = {
					state: t.state,
					head: t.head,
					lo: n,
					cells: r,
					wall: t.wall,
					halt: {
						state: e.state,
						read: e.read
					}
				};
			}
			return {
				ok: !0,
				longest: d ? d.n.depth : -1,
				halts: f,
				explored: p,
				witness: m
			};
		}(t) : null, f = h && h.ok ? h.longest : 1 / 0, p = new Uo(t), d = new _o(1, t.Q), m = t.twoWay ? new _o(-1, t.Q) : null;
		let g = p.snapshot(), y = 1, b = 0, w = null;
		const k = () => p.hi - p.lo + 1;
		function v(e) {
			const n = new Uo(t), s = new Uo(t);
			for (let t = 0; t < e; t++) s.step();
			let r = 0;
			for (; !n.sameAs(s);) n.step(), s.step(), r++;
			const o = Math.max(Math.min(p.lo, n.head), n.head - 60), i = Math.min(Math.max(p.hi, n.head), n.head + 60);
			return {
				verdict: "never",
				method: "cycler",
				period: e,
				from: r,
				cells: k(),
				state: n.state,
				at: {
					t: r,
					head: n.head,
					lo: o,
					cells: n.cells(o, i)
				}
			};
		}
		return {
			advance: function(n) {
				if (w) return w;
				for (let A = 0; A < n; A++) {
					if (p.t > f) {
						const { longest: t, halts: e, explored: n, witness: s } = h;
						return w = {
							verdict: "never",
							method: "backward",
							steps: p.t,
							longest: t,
							halts: e,
							explored: n,
							witness: s
						}, w;
					}
					if (p.t >= e) {
						const e = s > 0 ? co(t, {
							distance: s,
							nodeLimit: r
						}) : null;
						if (e && e.ok) return w = {
							verdict: "never",
							method: "segment",
							steps: p.t,
							size: e.size,
							distance: e.distance,
							nodes: e.nodes,
							tried: e.tried
						}, w;
						const n = o > 0 ? fo(t, {
							depth: o,
							work: i
						}) : null;
						if (n && n.ok) {
							const { side: t, depth: e, dfa: s, nfa: r, accepted: o, states: i, start: a, n: l } = n;
							return w = {
								verdict: "never",
								method: "far",
								steps: p.t,
								side: t,
								depth: e,
								dfa: s,
								nfa: r,
								accepted: o,
								states: i,
								start: a,
								n: l
							}, w;
						}
						const f = a > 0 ? mo(t, a) : null;
						if (f && "never" === f.result) return w = {
							verdict: "never",
							method: "loops",
							steps: p.t,
							gas: a,
							period: f.period,
							shift: f.shift,
							at: f.at
						}, w;
						const g = l && l.length ? wo(t, l) : null;
						if (g && "never" === g.result) return w = {
							verdict: "never",
							method: "ngram",
							steps: p.t,
							params: g.params,
							contexts: g.contexts,
							left: g.left,
							right: g.right
						}, w;
						for (const [s, r] of c || []) {
							const e = ko(t, {
								len: s,
								minRep: r,
								maxT: 320,
								gas: 1e4
							});
							if ("never" === e.result) return w = {
								verdict: "never",
								method: "repwl",
								steps: p.t,
								len: s,
								minRep: r,
								configurations: e.configurations
							}, w;
						}
						const y = u ? Qo(t, "object" == typeof u ? u : void 0) : null;
						return y && "never" === y.result ? (w = {
							verdict: "never",
							method: "bouncers",
							steps: p.t,
							formula: y.formula,
							formulaAt: y.steps,
							macroSteps: y.macroSteps
						}, w) : (w = {
							verdict: "unknown",
							method: null,
							steps: p.t,
							cells: k(),
							records: d.n + (m ? m.n : 0),
							backward: h && !h.ok ? {
								reason: h.reason,
								explored: h.explored,
								depth: h.depth
							} : null,
							segment: e ? {
								reason: e.reason,
								why: e.why,
								distance: s,
								tried: e.tried
							} : null,
							far: n ? {
								reason: n.reason,
								why: n.why,
								depth: "budget" === n.reason ? n.depth : o
							} : null,
							tried: [
								f && "loops",
								g && "ngram",
								c?.length && "repwl",
								y && "bouncers"
							].filter(Boolean)
						}, w);
					}
					const n = p.hi, A = p.lo;
					if (!p.step()) return w = {
						verdict: "halts",
						method: "simulation",
						steps: p.t + ("none" === p.halted ? 1 : 0),
						transitions: p.t,
						how: p.halted,
						state: p.state,
						read: "none" === p.halted ? p.haltRead : null,
						ones: p.ones(),
						cells: k()
					}, w;
					const $ = p.head;
					if ($ > n) {
						const t = d.record(p);
						if (t) return w = t;
					} else d.visit($);
					if ($ < A) {
						if (m) {
							const t = m.record(p);
							if (t) return w = t;
						}
					} else m && m.visit($);
					if (b++, p.matches(g)) return w = v(b);
					b === y && (g = p.snapshot(), y *= 2, b = 0);
				}
				return null;
			},
			get steps() {
				return p.t;
			},
			get budget() {
				return e;
			},
			get verdict() {
				return w;
			}
		};
	}(t, e);
	let s = null;
	for (; !(s = n.advance(1 << 20)););
	return s;
}
var Jo = class extends Error {};
function Ho(t) {
	const e = Array.from({ length: t.n }, () => []);
	for (const n of t.moves) e[n.from].push(n);
	return {
		...t,
		from: e
	};
}
const Vo = (t, e, n) => t.pop < 0 || e < n && t.pop === e;
function Xo(t) {
	const { n: e, G: n, moves: s } = t, r = Array.from({ length: e * n }, () => new Uint8Array(e));
	let o = !0;
	for (; o;) {
		o = !1;
		for (const i of s) {
			const s = Go(r, t, i.to, i.push), a = (t, n) => {
				for (let s = 0; s < e; s++) n[s] && !t[s] && (t[s] = 1, o = !0);
			};
			if (i.pop >= 0) a(r[i.from * n + i.pop], s);
			else for (let t = 0; t < n; t++) {
				const o = r[i.from * n + t];
				for (let i = 0; i < e; i++) s[i] && a(o, r[i * n + t]);
			}
		}
	}
	return r;
}
function Go(t, e, n, s, r = s.length) {
	let o = new Uint8Array(e.n);
	o[n] = 1;
	for (let i = 0; i < r; i++) {
		const n = new Uint8Array(e.n), r = s[i];
		for (let s = 0; s < e.n; s++) {
			if (!o[s]) continue;
			const i = t[s * e.G + r];
			for (let t = 0; t < e.n; t++) i[t] && (n[t] = 1);
		}
		o = n;
	}
	return o;
}
function Yo(t, e, n) {
	const s = function(t, e, n) {
		const [s, r] = e, o = [];
		let i, a, l = !0;
		if ("DPDA" === t.type) {
			l = 0 === n.tag, a = l ? e[2] + 1 : e[2];
			const t = l ? n.value[1] : n.value;
			i = l ? n.value[0] : null, t.forEach((t, e) => {
				for (const { a: n, X: s, mv: r } of nt(t, 0, a)) o.push({
					from: e,
					a: n,
					pop: s === a ? -1 : s,
					to: r[0],
					push: r[1]
				});
			});
		} else {
			let s;
			"Counter" === t.type ? (a = H.length, [i, s] = n) : (l = 0 === n.tag, a = l ? e[2] + 1 : e[2], [i, s] = l ? n.value : [null, n.value]);
			for (const [t, e, n, i, l] of s) o.push({
				from: t,
				a: e === r ? -1 : e,
				pop: n === a ? -1 : n,
				to: i,
				push: l
			});
		}
		return {
			n: s,
			k: r,
			G: a,
			explicit: l,
			acc: i ? Uint8Array.from(i) : null,
			moves: o
		};
	}(t, e, n), r = Ho({
		...s,
		q0: 0
	});
	try {
		const e = function(t, e) {
			const { n, G: s, acc: r, explicit: o } = t, i = /* @__PURE__ */ new Map(), a = [], l = [], c = [], u = (t) => {
				let e = i.get(t);
				return void 0 === e && (e = i.size, i.set(t, e), l.push([]), c.push([e, t])), e;
			}, h = (t, e, n) => {
				if (a.length >= 4e5) throw new Jo();
				const s = {
					lhs: t,
					letter: e,
					vars: n
				};
				a.push(s), l[t].push(s);
			}, f = (t, n, r) => 1 === e[t * s + n][r], p = new Map(t.moves.map((t, e) => [t, e])), d = (e, i) => {
				const [a, ...l] = i.split(","), c = l.map(Number);
				if ("S" === a) if (o) {
					h(e, -1, [u(`A,${t.q0},0`)]);
					for (let r = 0; r < n; r++) f(t.q0, 0, r) && h(e, -1, [u(`T,${t.q0},0,${r}`), u(`A,${r},${s}`)]);
				} else h(e, -1, [u(`A,${t.q0},${s}`)]);
				else if ("T" === a) {
					const [n, s, r] = c;
					for (const o of t.from[n]) {
						const t = p.get(o);
						o.pop === s ? h(e, o.a, [u(`C,${t},0,${o.to},${r}`)]) : o.pop < 0 && h(e, o.a, [u(`D,${t},${s},0,${o.to},${r}`)]);
					}
				} else if ("C" === a || "D" === a) {
					const [s, ...r] = c, o = "D" === a ? r[0] : -1, [i, l, p] = "D" === a ? r.slice(1) : r, d = t.moves[s].push;
					if (i === d.length) return void ("C" === a ? l === p && h(e, -1, []) : f(l, o, p) && h(e, -1, [u(`T,${l},${o},${p}`)]));
					const m = "D" === a ? `D,${s},${o},${i + 1}` : `C,${s},${i + 1}`;
					for (let t = 0; t < n; t++) f(l, d[i], t) && h(e, -1, [u(`T,${l},${d[i]},${t}`), u(`${m},${t},${p}`)]);
				} else if ("A" === a) {
					const [n, i] = c;
					(o ? r[n] : i === s) && h(e, -1, []);
					for (const r of t.from[n]) {
						if (!Vo(r, i, s)) continue;
						const t = p.get(r);
						h(e, r.a, [u(r.pop < 0 ? `DA,${t},${i},0,${r.to}` : `CA,${t},0,${r.to}`)]);
					}
				} else {
					const [s, ...r] = c, o = "DA" === a ? r[0] : -1, [i, l] = "DA" === a ? r.slice(1) : r, p = t.moves[s].push;
					if (i === p.length) return void ("DA" === a && h(e, -1, [u(`A,${l},${o}`)]));
					h(e, -1, [u(`A,${l},${p[i]}`)]);
					const d = "DA" === a ? `DA,${s},${o},${i + 1}` : `CA,${s},${i + 1}`;
					for (let t = 0; t < n; t++) f(l, p[i], t) && h(e, -1, [u(`T,${l},${p[i]},${t}`), u(`${d},${t}`)]);
				}
			}, m = u("S");
			for (; c.length;) {
				const [t, e] = c.pop();
				d(t, e);
			}
			return {
				start: m,
				count: i.size,
				rules: a,
				byLhs: l
			};
		}(r, Xo(r)), n = function(t) {
			const e = new Uint8Array(t.count), n = t.rules.map((t) => t.vars.length), s = Array.from({ length: t.count }, () => []);
			t.rules.forEach((t, e) => {
				for (const n of t.vars) s[n].push(e);
			});
			const r = [];
			for (t.rules.forEach((t, s) => {
				n[s] || e[t.lhs] || (e[t.lhs] = 1, r.push(t.lhs));
			}); r.length;) {
				const o = r.pop();
				for (const i of s[o]) 0 !== --n[i] || e[t.rules[i].lhs] || (e[t.rules[i].lhs] = 1, r.push(t.rules[i].lhs));
			}
			return e;
		}(e), o = !n[e.start], i = o || !function(t, e) {
			const n = t.rules.filter((t) => e[t.lhs] && t.vars.every((t) => e[t])), s = new Uint8Array(t.count), r = [t.start];
			s[t.start] = 1;
			const o = Array.from({ length: t.count }, () => []);
			for (const c of n) o[c.lhs].push(c);
			for (; r.length;) {
				const t = r.pop();
				for (const e of o[t]) for (const t of e.vars) s[t] || (s[t] = 1, r.push(t));
			}
			const i = new Uint8Array(t.count);
			for (let c = !0; c;) {
				c = !1;
				for (const t of n) i[t.lhs] || (t.letter >= 0 || t.vars.some((t) => i[t])) && (i[t.lhs] = 1, c = !0);
			}
			const a = Array.from({ length: t.count }, () => []);
			for (const c of n) s[c.lhs] && c.vars.forEach((t, e) => {
				const n = c.letter >= 0 || c.vars.some((t, n) => n !== e && i[t]);
				a[c.lhs].push([t, n]);
			});
			const l = function(t, e, n) {
				const s = new Int32Array(t).fill(-1), r = new Int32Array(t), o = new Int32Array(t).fill(-1), i = new Uint8Array(t), a = [];
				let l = 0, c = 0;
				for (let u = 0; u < t; u++) {
					if (!n[u] || s[u] >= 0) continue;
					const t = [[u, 0]];
					for (s[u] = r[u] = l++, a.push(u), i[u] = 1; t.length;) {
						const u = t[t.length - 1], [h, f] = u;
						if (f < e[h].length) {
							u[1]++;
							const o = e[h][f][0];
							if (!n[o]) continue;
							s[o] < 0 ? (s[o] = r[o] = l++, a.push(o), i[o] = 1, t.push([o, 0])) : i[o] && (r[h] = Math.min(r[h], s[o]));
							continue;
						}
						if (t.pop(), t.length) {
							const e = t[t.length - 1][0];
							r[e] = Math.min(r[e], r[h]);
						}
						if (r[h] === s[h]) {
							let t;
							do
								t = a.pop(), i[t] = 0, o[t] = c;
							while (t !== h);
							c++;
						}
					}
				}
				return o;
			}(t.count, a, s);
			for (let c = 0; c < t.count; c++) if (s[c]) {
				for (const [t, e] of a[c]) if (e && l[t] === l[c]) return !0;
			}
			return !1;
		}(e, n);
		let a = null;
		return "DPDA" === t.type && (a = !i && function(t, e) {
			const { n, G: s, k: r, acc: o, explicit: i } = e, a = [];
			for (const g of t.moves) for (let t = 0; t < 2; t++) {
				const e = (g.a < 0 ? t : 0) | (i && o[g.to] ? 1 : 0);
				a.push({
					from: 2 * g.from + t,
					a: g.a,
					pop: g.pop,
					to: 2 * g.to + e,
					push: g.push
				});
			}
			const l = Ho({
				n: 2 * n,
				G: s,
				k: r,
				moves: a
			}), c = Xo(l), u = i ? o[e.q0] ? 1 : 0 : 1, h = i ? (t) => t : (t) => 1 | t, f = function(t, e, n, s = (t) => t) {
				const { G: r } = t, o = r + 1, i = new Uint8Array(t.n * o), a = [], l = (t, e) => {
					e === r && (t = s(t));
					const n = t * o + e;
					i[n] || (i[n] = 1, a.push(n));
				}, c = (e, n) => {
					for (let s = 0; s < t.n; s++) e[s] && l(s, n);
				};
				for (n.stack.length ? (l(n.q, n.stack[0]), c(e[n.q * r + n.stack[0]], r)) : l(n.q, r); a.length;) {
					const n = a.pop(), s = Math.floor(n / o), i = n % o;
					for (const o of t.from[s]) {
						if (!Vo(o, i, r)) continue;
						const n = o.push;
						if (n.length) {
							l(o.to, n[0]);
							for (let s = 1; s < n.length; s++) c(Go(e, t, o.to, n, s), n[s]);
							o.pop < 0 && c(Go(e, t, o.to, n), i);
						} else o.pop < 0 && l(o.to, i);
					}
				}
				return i;
			}(l, c, {
				q: 2 * e.q0 + u,
				stack: i ? [0] : []
			}, h), { run: p, eps: d } = function(t) {
				const { G: e } = t, n = e + 1, s = new Int32Array(t.n * n).fill(-3), r = new Uint8Array(t.n * n), o = (n, s) => t.from[n].find((t) => t.a < 0 && Vo(t, s, e)) || null, i = (t, e) => {
					const a = t * n + e;
					if (-3 !== s[a]) return s[a];
					if (r[a]) return -2;
					let l;
					r[a] = 1;
					const c = o(t, e);
					if (c) {
						let t = c.to;
						l = null;
						for (const e of c.push) {
							const n = i(t, e);
							if (n < 0) {
								l = n;
								break;
							}
							t = n;
						}
						null === l && (l = c.pop >= 0 ? t : i(t, e));
					} else l = -1;
					return r[a] = 0, s[a] = l, l;
				};
				return {
					run: i,
					eps: o
				};
			}(e), m = s + 1;
			for (let g = 0; g < f.length; g++) {
				if (!f[g]) continue;
				const t = Math.floor(g / m), n = g % m, o = t >> 1, i = 1 & t;
				if (d(o, n)) {
					if (-2 === p(o, n)) return !1;
				} else {
					if (!i) return !1;
					for (let t = 0; t < r; t++) if (!e.from[o].some((e) => e.a === t && Vo(e, n, s))) return !1;
				}
			}
			return !0;
		}(s, r)), {
			empty: o,
			finite: i,
			universal: a,
			grammar: e
		};
	} catch (o) {
		if (o instanceof Jo) return { tooLarge: !0 };
		throw o;
	}
}
function Zo(t, e) {
	const { n, k: s, delta: r } = t, o = Array.from({ length: n }, () => []);
	for (let l = 0; l < n; l++) for (let t = 0; t < s; t++) o[r[l * s + t]].push(l);
	const i = new Uint8Array(n), a = [];
	for (let l = 0; l < n; l++) e(l) && (i[l] = 1, a.push(l));
	for (; a.length;) {
		const t = a.pop();
		for (const e of o[t]) i[e] || (i[e] = 1, a.push(e));
	}
	return i;
}
function ti(t, e) {
	const { n, k: s, delta: r } = t, o = new Uint8Array(n);
	let i = !1;
	return e[0] && (() => {
		const t = [[0, 0]];
		for (o[0] = 1; t.length && !i;) {
			const n = t[t.length - 1];
			if (n[1] >= s) {
				o[n[0]] = 2, t.pop();
				continue;
			}
			const a = r[n[0] * s + n[1]++];
			e[a] && (1 === o[a] ? i = !0 : o[a] || (o[a] = 1, t.push([a, 0])));
		}
	})(), i;
}
function ei(t, e, n) {
	const s = function(t, e) {
		if (!Array.isArray(e) || e.length !== t.params.length) return `A ${t.type} room has ${t.params.length} sizes: ${t.params.map((t) => t.id).join(", ")}.`;
		for (let n = 0; n < e.length; n++) {
			const s = e[n], r = t.params[n];
			if (!Number.isInteger(s) || s < r.min) return `The number of ${r.id} must be at least ${r.min}.`;
		}
		return null;
	}(t, e);
	if (s) throw new RangeError(s);
	const { value: r, size: o } = y(ft(t, e), n);
	return {
		body: r,
		size: o
	};
}
function ni(t) {
	let e = 2166136261;
	for (const r of String(t)) e ^= r.codePointAt(0), e = Math.imul(e, 16777619) >>> 0;
	let n = e || 1;
	const s = () => (n ^= n << 13, n >>>= 0, n ^= n >>> 17, n ^= n << 5, n >>>= 0, n);
	return (t) => {
		if ((t = BigInt(t)) <= 1n) return 0n;
		const e = Math.ceil(t.toString(2).length / 32) + 1;
		let n = "";
		for (let r = 0; r < e; r++) n += s().toString(16).padStart(8, "0");
		return BigInt(`0x${n}`) % t;
	};
}
Object.freeze({
	e: {
		label: "∅",
		say: "accepts nothing"
	},
	u: {
		label: "Σ*",
		say: "accepts every word"
	},
	f: {
		label: "finite",
		say: "accepts finitely many words"
	},
	c: {
		label: "cofinite",
		say: "rejects finitely many words"
	},
	o: {
		label: "something else",
		say: "accepts and rejects infinitely many words"
	}
});
const si = Object.freeze({
	fa: [
		{
			key: "e",
			label: "∅",
			say: "accepts nothing"
		},
		{
			key: "u",
			label: "Σ*",
			say: "accepts every word"
		},
		{
			key: "f",
			label: "finite or cofinite",
			say: "accepts or rejects finitely many words"
		},
		{
			key: "o",
			label: "something else",
			say: "accepts and rejects infinitely many words"
		}
	],
	omega: [{
		key: "e",
		label: "empty",
		say: "accepts no ω-word"
	}, {
		key: "o",
		label: "non-empty",
		say: "accepts some ω-word"
	}],
	tm: [
		{
			key: "h",
			label: "halts",
			say: "halts from a blank tape after one step or more"
		},
		{
			key: "z",
			label: "halts at once",
			say: "stops before its first step"
		},
		{
			key: "n",
			label: "never halts",
			say: "proved never to halt"
		},
		{
			key: "x",
			label: "unknown",
			say: "not settled within the map’s budget"
		}
	],
	cf: [
		{
			key: "e",
			label: "∅",
			say: "accepts no word"
		},
		{
			key: "f",
			label: "finite",
			say: "accepts finitely many words, and at least one"
		},
		{
			key: "i",
			label: "infinite",
			say: "accepts infinitely many words — whether it accepts every word cannot be decided for these machines in general"
		}
	],
	dcf: [
		{
			key: "e",
			label: "∅",
			say: "accepts no word"
		},
		{
			key: "u",
			label: "Σ*",
			say: "accepts every word"
		},
		{
			key: "f",
			label: "finite",
			say: "accepts finitely many words, and at least one"
		},
		{
			key: "i",
			label: "infinite, not Σ*",
			say: "accepts infinitely many words, but not every word"
		}
	]
});
function ri(t, e, n = () => !0) {
	const s = new Uint8Array(t.length);
	if (!n(e)) return s;
	const r = [e];
	for (s[e] = 1; r.length;) {
		const e = r.pop();
		for (const o of t[e]) !s[o] && n(o) && (s[o] = 1, r.push(o));
	}
	return s;
}
function oi(t, e, n, s = {}) {
	return zo.has(t.type) ? Ko(function(t, e, n) {
		const [s, r] = e, [o, i] = n, a = new Int32Array(s * r).fill(-1), l = new Int32Array(s * r), c = new Int8Array(s * r);
		return i.forEach((t, e) => {
			t && (l[e] = t[0], c[e] = 0 === t[1] ? -1 : 1 === t[1] ? 1 : 0, a[e] = t[2]);
		}), {
			ok: !0,
			Q: s,
			K: r,
			next: a,
			write: l,
			move: c,
			accept: Uint8Array.from(o),
			start: 0,
			twoWay: "ITM" === t.type,
			input: [],
			stateNames: Array.from({ length: s }, (t, e) => String(e)),
			symbols: Array.from({ length: r }, (t, e) => String(e))
		};
	}(t, e, n), s) : null;
}
const ii = {
	budget: 2e4,
	segment: 0,
	far: 0,
	loops: 0,
	ngram: [],
	repwl: [],
	bouncers: !1
};
function ai(t, e, n) {
	if ("fa" === t.kind) return function(t, e, n) {
		const s = function(t, e, n) {
			const [s, r] = e;
			if ("DFA" === t || "DBA" === t || "DWA" === t) {
				const [t, e] = n;
				return {
					n: s,
					k: r,
					delta: Int32Array.from(e),
					acc: Uint8Array.from(t)
				};
			}
			if ("NFA" !== t && "ε-NFA" !== t) return null;
			const o = "ε-NFA" === t, [i, a] = n, l = Array.from({ length: s * (r + 1) }, () => []);
			for (const [g, y, b] of a) l[g * (r + 1) + y].push(b);
			const c = (t) => {
				if (!o) return t;
				const e = new Set(t), n = [...t];
				for (; n.length;) {
					const t = n.pop();
					for (const s of l[t * (r + 1) + r]) e.has(s) || (e.add(s), n.push(s));
				}
				return e;
			}, u = (t) => [...t].sort((t, e) => t - e).join(","), h = c(/* @__PURE__ */ new Set([0])), f = /* @__PURE__ */ new Map([[u(h), 0]]), p = [h], d = [];
			for (let g = 0; g < p.length; g++) {
				if (p.length > 4096) return null;
				for (let t = 0; t < r; t++) {
					const e = /* @__PURE__ */ new Set();
					for (const i of p[g]) for (const n of l[i * (r + 1) + t]) e.add(n);
					const n = c(e), s = u(n);
					let o = f.get(s);
					void 0 === o && (o = p.length, f.set(s, o), p.push(n)), d.push(o);
				}
			}
			const m = p.map((t) => [...t].some((t) => i[t]) ? 1 : 0);
			return {
				n: p.length,
				k: r,
				delta: Int32Array.from(d),
				acc: Uint8Array.from(m)
			};
		}(t.type, e, n);
		if (!s) return "x";
		const r = function(t) {
			const e = new Uint8Array(t.n), n = [0];
			for (e[0] = 1; n.length;) {
				const s = n.pop();
				for (let r = 0; r < t.k; r++) {
					const o = t.delta[s * t.k + r];
					e[o] || (e[o] = 1, n.push(o));
				}
			}
			const s = Zo(t, (e) => t.acc[e]), r = Zo(t, (e) => !t.acc[e]);
			return s[0] ? r[0] ? ti(t, s) ? ti(t, r) ? "o" : "c" : "f" : "u" : "e";
		}(s);
		return "c" === r ? "f" : r;
	}(t, e, n);
	if ("omega" === t.kind) return function(t, e, n) {
		const s = function(t, e, n) {
			const [s, r] = e, o = Array.from({ length: s }, () => /* @__PURE__ */ new Set());
			if (t.type.startsWith("D")) {
				const t = n[1];
				for (let e = 0; e < s; e++) for (let n = 0; n < r; n++) o[e].add(t[e * r + n]);
			} else for (const [i, , a] of n[1]) o[i].add(a);
			return o.map((t) => [...t]);
		}(t, e, n), r = ri(s, 0), o = n[0];
		return function(t, e, n, s) {
			for (let r = 0; r < t.length; r++) if (e[r] && n(r) && s()) {
				for (const e of t[r]) if (s() && (e === r || ri(t, e, s)[r])) return !0;
			}
			return !1;
		}(s, r, (t) => !!o[t], () => !0);
	}(t, e, n) ? "o" : "e";
	if ("tm" === t.kind) return function(t, e, n) {
		const s = oi(t, e, n, ii);
		return "halts" === s?.verdict ? s.steps ? "h" : "z" : "never" === s?.verdict ? "n" : "x";
	}(t, e, n);
	if ("cf" === t.kind || "dcf" === t.kind) return function(t, e, n) {
		const s = Yo(t, e, n);
		return s.tooLarge ? "x" : s.empty ? "e" : s.finite ? "f" : s.universal ? "u" : "i";
	}(t, e, n);
	throw new Error(`No map for a ${t.type} wing.`);
}
const li = {
	bits: "set",
	fin: "choice",
	option: "choice",
	fraction: "fraction",
	nat: "number",
	seq: "string",
	subset: "set",
	table: "table",
	tuple: "part",
	oneOf: "choice"
};
function ci(t, e) {
	let n = t;
	return "tuple" === n.part && (n = n.parts[e[0]]), e.length > 1 && "table" === n.part && (n = n.of), n;
}
function ui(t) {
	if ((t = BigInt(t)) < 1n << 50n) return Math.log10(Number(t));
	const e = t.toString(16);
	return Math.log10(parseInt(e.slice(0, 12), 16)) + (e.length - 12) * Math.log10(16);
}
const hi = /* @__PURE__ */ new Map();
function fi(t, e) {
	return hi.size > 64 && hi.clear(), hi.set(t, e), e;
}
function pi(t, e = null) {
	const n = function(t, e = null) {
		const n = t.length, s = /* @__PURE__ */ new Map([[0, 1n]]);
		return null !== e && s.set(n, e), (e) => {
			let o = s.get(e);
			if (void 0 !== o) return o;
			let i = 0;
			for (const t of s.keys()) Math.abs(t - e) < Math.abs(i - e) && (i = t);
			if (o = i < e ? s.get(i) * r(t, i, e) : s.get(i) / r(t, e, i), s.size > 72) {
				for (const t of s.keys()) if (0 !== t && t !== n) {
					s.delete(t);
					break;
				}
			}
			return s.set(e, o), o;
		};
	}(t, e);
	return {
		at: n,
		view: new Proxy([], { get: (e, s) => "length" === s ? t.length + 1 : "string" == typeof s && /^\d+$/.test(s) ? n(Number(s)) : e[s] })
	};
}
function di(t, e) {
	const n = /* @__PURE__ */ new Map();
	return new Proxy([], { get: (s, r) => {
		return "length" === r ? t : "string" == typeof r && /^\d+$/.test(r) ? (o = Number(r), n.has(o) || n.set(o, e(o)), n.get(o)) : s[r];
		var o;
	} });
}
function mi(t, e, n, s) {
	const o = n.length, i = pi(n, r(n)), a = new Float64Array(o + 1);
	for (let r = 0; r < o; r++) a[r + 1] = a[r] + ui(n[r]);
	const l = (t, e) => {
		let s = 1n, r = t;
		for (; s < e && r < o;) s *= n[r], r++;
		return s === e ? r : void 0;
	}, c = [], u = [1];
	let h = 1, f = o, p = 1n;
	const d = BigInt(1024), m = (t, e) => {
		const { cols: s, rows: o } = yi(Number((r(n, t, f) * p + e - 1n) / e), l(f, p), l(t, e), n, h, !0);
		c.push({
			cols: s,
			rows: o,
			colsB: BigInt(s),
			rowsB: BigInt(o),
			ci: t,
			cm: e
		}), h *= o / s, u.push(h), f = t, p = e;
	};
	for (let r = 0; r < 1e8 && (0 !== f || 1n !== p || !c.length); r++) {
		if (a[f] + ui(p) < 3.5 && i.at(f) * p <= d) {
			m(0, 1n);
			break;
		}
		if (p > d) {
			m(f, (p + BigInt(256) - 1n) / BigInt(256));
			continue;
		}
		const t = (t, e) => {
			const s = yi(e, 1n === p ? f : void 0, t, n, h);
			return Math.abs(Math.log(e / 100)) + (s.cols * s.rows === e ? 0 : .8);
		};
		let e = Number(p), s = p > 1n ? {
			j: f,
			F: e,
			score: t(f, e)
		} : null;
		for (let r = f - 1; r >= 0 && (e *= Number(n[r]), e <= 1024); r--) {
			const n = t(r, e);
			(!s || n < s.score) && (s = {
				j: r,
				F: e,
				score: n
			});
		}
		s ? m(s.j, 1n) : (f -= 1, p = n[f]);
	}
	const g = c.length, y = (t) => 0 === t ? e : i.at(c[t - 1].ci) * c[t - 1].cm;
	c.forEach((t, e) => Object.defineProperty(t, "child", {
		get: () => y(e + 1),
		enumerable: !1
	}));
	const b = c.map((t) => t.colsB), w = c.map((t) => t.rowsB), k = pi(b).view, v = pi(w).view, A = new Float64Array(g + 1);
	for (let r = 0; r < g; r++) A[r + 1] = A[r] + Math.log10(c[r].cols);
	const $ = new Float64Array(g + 1);
	for (let r = 0; r <= g; r++) {
		const t = r ? c[r - 1].ci : o, e = r ? c[r - 1].cm : 1n, n = a[t] + ui(e);
		$[r] = n < 14 ? Math.log10(Number(y(r))) : n;
	}
	const S = {
		id: t,
		total: e,
		levels: c,
		aspect: u,
		W: k,
		H: v,
		D: g,
		lvol: $,
		lW: A,
		sizes: di(g + 1, y),
		colsRow: b,
		rowsRow: w,
		blocks: /* @__PURE__ */ new Map(),
		radices: n
	};
	let M;
	return S.picks = di(g, (t) => (void 0 === M && (M = s()), function(t, e, n) {
		if (!n) return {
			names: [],
			whole: !0
		};
		const { levels: s, radices: o } = t, i = s[e], a = o.length, l = e ? s[e - 1].ci : a, c = e ? s[e - 1].cm : 1n, u = (t, e, n) => t < e || t === e && n > 1n, h = (t, e, n) => t > e + 1 || t === e + 1 && e < a && n < o[e], f = n.filter((t) => !u(t.start, i.ci, i.cm) && u(t.start, l, c)), p = f.every((t) => !h(t.end, l, c)), d = f.length ? [] : n.filter((t) => u(t.start, i.ci, i.cm) && h(t.end, i.ci, i.cm)), m = (f.length ? f : d).map((t) => t.key).reverse();
		let g = null, y = null;
		if (2 === f.length && p) {
			const [t, e] = f, n = (t) => r(o, t.start, t.end);
			Number(n(e)) === i.rows && Number(n(t)) === i.cols && (g = e.key, y = t.key);
		}
		return {
			names: m,
			whole: p && f.length > 0,
			down: g,
			across: y
		};
	}(S, t, M))), S;
}
const gi = 2.5;
function yi(t, e, n, s, r = 1, o = !1) {
	const i = (t, e) => Math.abs(Math.log(r * e / t));
	if (void 0 !== e && void 0 !== n && e > n) {
		let t = null;
		for (let r = n; r <= e; r++) {
			let o = 1, a = 1;
			for (let t = n; t < r; t++) o *= Number(s[t]);
			for (let t = r; t < e; t++) a *= Number(s[t]);
			const l = i(o, a);
			(!t || l < t.skew) && (t = {
				cols: o,
				rows: a,
				skew: l
			});
		}
		if (t && t.skew <= Math.log(gi)) return {
			cols: t.cols,
			rows: t.rows
		};
	}
	let a = null;
	for (let u = 1; o && u * u <= t; u++) if (!(t % u)) for (const [e, n] of [[u, t / u], [t / u, u]]) {
		const t = i(n, e);
		t <= Math.log(gi) && (!a || t < a.skew) && (a = {
			cols: n,
			rows: e,
			skew: t
		});
	}
	if (a) return {
		cols: a.cols,
		rows: a.rows
	};
	let l = Math.min(t, Math.max(1, Math.round(Math.sqrt(t / r))));
	const c = Math.ceil(t / l);
	return l = Math.ceil(t / c), {
		cols: c,
		rows: l
	};
}
function bi(t) {
	return t < 1n << 512n ? t.toString() : `x${t.toString(16)}`;
}
function wi(t, e, n) {
	t.size >= 384 && t.delete(t.keys().next().value), t.set(e, n);
}
function ki(t, e, n, s, r, o) {
	if (r.hi - r.lo === 1n) return [r.lo];
	const i = ni(`${t.id}|${e}|${bi(n)}|${bi(s)}`);
	return Array.from({ length: o }, () => r.lo + i(r.hi - r.lo));
}
function vi(t, e, n, s, r) {
	if (r - s <= 32) {
		for (let o = s; o < r; o++) t[o] = Number(e % n), e /= n;
		return;
	}
	const o = s + r >> 1, i = n ** BigInt(o - s);
	vi(t, e % i, n, s, o), vi(t, e / i, n, o, r);
}
function Ai(t, e) {
	const n = function(t) {
		return si[t.kind];
	}(t).map((t) => t.key), s = (t) => {
		const e = n.indexOf(t);
		return e < 0 ? 254 : e;
	}, r = ft(t, e), [o, i] = e;
	if ("DFA" === t.type && o >= 2) {
		const t = function(t, e) {
			const n = t * e, s = new Int32Array(t), r = new Int32Array(n), o = new Int32Array(n), i = new Uint8Array(t), a = new Uint8Array(t), l = new Uint8Array(t), c = new Int32Array(t), u = new Int32Array(n + t);
			for (let p = 0; p < n; p++) o[p] = p / e | 0;
			const h = (e, n, i) => {
				n.fill(0);
				let a = 0;
				for (let s = 0; s < t; s++) e[s] === i && (n[s] = 1, u[a++] = s);
				for (; a;) {
					const t = u[--a];
					for (let e = s[t]; e >= 0; e = r[e]) {
						const t = o[e];
						n[t] || (n[t] = 1, u[a++] = t);
					}
				}
			}, f = (t, n) => {
				if (!n[0]) return !1;
				l.fill(0);
				let s = 0;
				for (u[s++] = 0, l[0] = 1, c[0] = 0; s;) {
					const r = u[s - 1];
					if (c[r] >= e) {
						l[r] = 2, s--;
						continue;
					}
					const o = t[r * e + c[r]++];
					if (n[o]) {
						if (1 === l[o]) return !0;
						l[o] || (l[o] = 1, c[o] = 0, u[s++] = o);
					}
				}
				return !1;
			};
			return (t, e) => {
				s.fill(-1);
				for (let o = 0; o < n; o++) {
					const e = t[o];
					r[o] = s[e], s[e] = o;
				}
				return h(e, i, 1), i[0] ? (h(e, a, 0), a[0] ? f(t, i) ? f(t, a) ? "o" : "c" : "f" : "u") : "e";
			};
		}(o, i), e = {
			e: s("e"),
			u: s("u"),
			f: s("f"),
			c: s("f"),
			o: s("o")
		}, n = BigInt(o), r = (1n << n) - 1n, a = o * i, l = o <= 255 ? new Uint8Array(a) : new Int32Array(a), c = new Uint8Array(o), u = o <= 36 ? (t) => {
			const e = t.toString(o);
			for (let n = 0; n < a; n++) {
				const t = n < e.length ? e.charCodeAt(e.length - 1 - n) : 48;
				l[n] = t <= 57 ? t - 48 : t - 87;
			}
		} : (t) => vi(l, t, n, 0, a);
		let h = null;
		return (s) => {
			const i = (s & r).toString(2);
			for (let t = 0; t < o; t++) c[t] = t < i.length && 49 === i.charCodeAt(i.length - 1 - t) ? 1 : 0;
			const a = s >> n;
			return a !== h && (u(a), h = a), e[t(l, c)];
		};
	}
	return (n) => {
		try {
			return s(ai(t, e, y(r, n).value));
		} catch {
			return 254;
		}
	};
}
function $i(t, e, n, s) {
	const r = ft(t, e), o = r.count(n);
	if (!(o > 0n)) return [];
	const i = b(r, n);
	if (1n === o) return [i];
	const a = ni(`${pt(t, e)}|size|${n}`);
	return Array.from({ length: s }, () => i + a(o));
}
const Si = [
	"verdict",
	"method",
	"steps",
	"ones",
	"cells",
	"period",
	"from",
	"shift",
	"direction",
	"longest",
	"how",
	"size",
	"depth"
];
function Mi(t) {
	if (!t) return null;
	const e = {};
	for (const n of Si) void 0 !== t[n] && null !== t[n] && "object" != typeof t[n] && (e[n] = t[n]);
	return e;
}
const xi = /* @__PURE__ */ new Map();
function Ei(t, e) {
	const n = `${t.key}:${e.join("-")}`;
	let s = xi.get(n);
	return s || (xi.size > 16 && xi.clear(), xi.set(n, s = Ai(t, e))), s;
}
function Ti(t) {
	try {
		const e = function(t) {
			const e = String(t || "").toLowerCase();
			return lt.get(e) || lt.get(ut.get(e)) || null;
		}(t.key);
		if (!e) return {
			id: t.id,
			type: "failed",
			error: `no wing “${t.key}”`
		};
		if ("classify" === t.type) {
			const n = t.volumes.map((n) => {
				try {
					return function(t, e, n) {
						const { body: s } = ei(t, e, n);
						return ai(t, e, s);
					}(e, t.params, BigInt(n));
				} catch {
					return "x";
				}
			});
			return {
				id: t.id,
				type: "classes",
				classes: n
			};
		}
		if ("tile" === t.type) {
			const n = void 0 !== t.size && null !== t.size, s = n ? function(t, e, n) {
				const s = `${pt(t, e)}@${n}`, r = hi.get(s);
				if (r) return r;
				const o = ft(t, e);
				if (o.finite) return null;
				const i = o.count(n);
				if (!(i > 0n)) return null;
				const a = [];
				let l = i;
				for (; l > 10n;) a.push(10n), l = (l + 9n) / 10n;
				l > 1n && a.push(l);
				const c = mi(s, i, a, () => null);
				return c.size = n, c.base = b(o, n), fi(s, c);
			}(e, t.params, t.size) : function(t, e) {
				const n = pt(t, e), s = hi.get(n);
				if (s) return s;
				const r = ft(t, e);
				if (!r.finite) return null;
				const o = (r.radices ? r.radices() : [r.total]).map(BigInt).filter((t) => t > 1n);
				return fi(n, mi(n, r.total, o, () => {
					if (!t.tile) return null;
					try {
						return function(t, e, n) {
							const s = ft(t, e);
							if (!s.finite || "oneOf" === s.part) return null;
							const { parts: r } = function(t, e) {
								const n = [];
								let s = 0n;
								for (; "oneOf" === t.part && e && Number.isInteger(e.tag);) {
									if (n.push(e.tag), t.finite) for (let n = 0; n < e.tag; n++) s += t.parts[n].total;
									t = t.parts[e.tag], e = e.value;
								}
								return "tuple" === t.part && Array.isArray(t.parts) ? {
									conventions: n,
									offset: s,
									parts: t.parts.map((t, n) => ({
										shape: t,
										value: e[n],
										index: n
									}))
								} : {
									conventions: n,
									offset: s,
									parts: [{
										shape: t,
										value: e,
										index: 0
									}]
								};
							}(s, n), o = (n, r) => (t.tile ? t.tile(n, r, e) : null) || { key: li[ci(s, n)?.part] || "part" }, i = (t) => (t.radices ? t.radices() : [t.total]).filter((t) => t > 1n).length, a = [];
							let l = 0;
							const c = (t, e, n) => {
								n && a.push({
									key: o(t, e).key,
									start: l,
									end: l + n
								}), l += n;
							};
							for (const { shape: u, value: h, index: f } of r) if ("table" === u.part) {
								const t = i(u.of);
								h.forEach((e, n) => c([f, n], e, t));
							} else c([f], h, i(u));
							return a;
						}(t, e, y(r, 0n).value);
					} catch {
						return null;
					}
				}));
			}(e, t.params);
			if (!s || !(t.level >= 0 && t.level < s.D)) return {
				id: t.id,
				type: "failed",
				error: "no such tile"
			};
			const r = Ei(e, t.params), o = n ? (t) => r(s.base + t) : r, i = function(t, e, n, s, r, o) {
				const i = t.levels[e], a = i.cols * i.rows, l = e === t.D - 1 ? 1 : o, c = new Uint8Array(a * l).fill(255), u = function(t, e, n, s) {
					if (n < 0n || s < 0n || n >= t.W[e] || s >= t.H[e]) return null;
					if (0 === e) return {
						lo: 0n,
						hi: t.total
					};
					const r = t.blocks, o = r.get(`${e}|${bi(n)}|${bi(s)}`);
					if (o) return o;
					const i = [];
					let a = e, l = n, c = s, u = null;
					for (; a > 0 && i.length < 48;) {
						i.push([l, c]);
						const e = t.levels[a - 1];
						if (l /= e.colsB, c /= e.rowsB, a--, u = 0 === a ? {
							lo: 0n,
							hi: t.total
						} : r.get(`${a}|${bi(l)}|${bi(c)}`), u) break;
					}
					if (!u) return function(t, e, n, s) {
						const r = new Array(e), o = new Array(e), i = /* @__PURE__ */ new Map();
						for (let c = e - 1; c >= 0; c--) {
							const a = t.levels[c];
							e - c <= 4 && i.set(c + 1, [n, s]), r[c] = Number(n % a.colsB), o[c] = Number(s % a.rowsB), n /= a.colsB, s /= a.rowsB;
						}
						let a = 0n, l = t.total;
						for (let c = 0; c < e; c++) {
							const e = t.levels[c], n = e.child, s = a + BigInt(o[c] * e.cols + r[c]) * n;
							if (s >= l) return null;
							a = s, l = s + n < l ? s + n : l;
							const u = i.get(c + 1);
							u && wi(t.blocks, `${c + 1}|${bi(u[0])}|${bi(u[1])}`, {
								lo: a,
								hi: l
							});
						}
						return {
							lo: a,
							hi: l
						};
					}(t, e, n, s);
					let { lo: h, hi: f } = u;
					for (let p = i.length - 1; p >= 0; p--) {
						const [e, n] = i[p], s = t.levels[a], o = Number(n % s.rowsB) * s.cols + Number(e % s.colsB), l = s.child, c = h + BigInt(o) * l;
						if (c >= f) return null;
						h = c, f = c + l < f ? c + l : f, a++, wi(r, `${a}|${bi(e)}|${bi(n)}`, {
							lo: h,
							hi: f
						});
					}
					return {
						lo: h,
						hi: f
					};
				}(t, e, n, s);
				if (!u) return {
					cells: c,
					spp: l,
					lo: null,
					hi: null
				};
				const h = new Array(l);
				for (let f = 0; f < a; f++) {
					const o = u.lo + BigInt(f) * i.child;
					if (o >= u.hi) break;
					const a = o + i.child < u.hi ? o + i.child : u.hi, p = ki(t, e + 1, n * i.colsB + BigInt(f % i.cols), s * i.rowsB + BigInt(Math.floor(f / i.cols)), {
						lo: o,
						hi: a
					}, l);
					for (let t = 0; t < l; t++) h[t] = r(p[t]);
					l > 1 && h.sort((t, e) => t - e);
					for (let t = 0; t < l; t++) c[f * l + t] = h[t];
				}
				return {
					cells: c,
					spp: l,
					lo: u.lo,
					hi: u.hi
				};
			}(s, t.level, BigInt(t.tx), BigInt(t.ty), o, t.samples), a = (t) => null === t ? null : t.toString(16);
			return {
				id: t.id,
				type: "tile",
				cells: i.cells,
				spp: i.spp,
				lo: a(i.lo),
				hi: a(i.hi)
			};
		}
		if ("strip" === t.type) {
			const n = function(t, e, n, s, r, o) {
				const i = new Uint8Array(s * o).fill(255);
				for (let a = 0; a < s; a++) {
					const s = $i(t, e, n + a, o);
					if (!s.length) continue;
					const l = s.map((t) => r(t)).sort((t, e) => t - e);
					for (let t = 0; t < o; t++) i[a * o + t] = l[Math.min(t, l.length - 1)];
				}
				return {
					cells: i,
					spp: o
				};
			}(e, t.params, t.from, t.count, Ei(e, t.params), t.samples);
			return {
				id: t.id,
				type: "strip",
				cells: n.cells,
				spp: n.spp
			};
		}
		if ("behaviour" === t.type) {
			const { body: n } = ei(e, t.params, BigInt(t.volume)), s = oi(e, t.params, n, { budget: t.budget });
			return {
				id: t.id,
				type: "behaviour",
				verdict: Mi(s)
			};
		}
		return {
			id: t.id,
			type: "ignored"
		};
	} catch (e) {
		return {
			id: t.id,
			type: "failed",
			error: String(e?.message || e)
		};
	}
}
self.onmessage = (t) => self.postMessage(Ti(t.data));
