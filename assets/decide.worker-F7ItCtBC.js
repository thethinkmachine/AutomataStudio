const t = {
	context: void 0,
	registry: void 0,
	effects: void 0,
	done: !1,
	getContextId() {
		return e(this.context.count);
	},
	getNextContextId() {
		return e(this.context.count++);
	}
};
function e(e) {
	const n = String(e), s = n.length - 1;
	return t.context.id + (s ? String.fromCharCode(96 + s) : "") + n;
}
const n = { equals: (t, e) => t === e };
let s = E;
const o = 1, a = 2, i = {
	owned: null,
	cleanups: null,
	context: null,
	owner: null
};
var r = null;
let c = null, u = null, h = null, p = null, f = null, d = 0;
function m(t, e) {
	const s = {
		value: t,
		observers: null,
		observerSlots: null,
		comparator: (e = e ? Object.assign({}, n, e) : n).equals || void 0
	};
	return [$.bind(s), (t) => ("function" == typeof t && (t = c && c.running && c.sources.has(s) ? t(s.tValue) : t(s.value)), S(s, t))];
}
function g(t) {
	return M(t, !1);
}
function b(t) {
	if (null === h) return t();
	const e = h;
	h = null;
	try {
		return t();
	} finally {
		h = e;
	}
}
function y(t) {
	return null === r || (null === r.cleanups ? r.cleanups = [t] : r.cleanups.push(t)), t;
}
const [w, k] = m(!1);
function $() {
	const t = c && c.running;
	if (this.sources && (t ? this.tState : this.state)) if ((t ? this.tState : this.state) === o) A(this);
	else {
		const t = p;
		p = null, M(() => P(this), !1), p = t;
	}
	if (h) {
		const t = this.observers;
		if (!t || t[t.length - 1] !== h) {
			const e = t ? t.length : 0;
			h.sources ? (h.sources.push(this), h.sourceSlots.push(e)) : (h.sources = [this], h.sourceSlots = [e]), t ? (t.push(h), this.observerSlots.push(h.sources.length - 1)) : (this.observers = [h], this.observerSlots = [h.sources.length - 1]);
		}
	}
	return t && c.sources.has(this) ? this.tValue : this.value;
}
function S(t, e, n) {
	let s = c && c.running && c.sources.has(t) ? t.tValue : t.value;
	if (!t.comparator || !t.comparator(s, e)) {
		if (c) {
			const s = c.running;
			(s || !n && c.sources.has(t)) && (c.sources.add(t), t.tValue = e), s || (t.value = e);
		} else t.value = e;
		t.observers && t.observers.length && M(() => {
			for (let e = 0; e < t.observers.length; e += 1) {
				const n = t.observers[e], s = c && c.running;
				s && c.disposed.has(n) || ((s ? n.tState : n.state) || (n.pure ? p.push(n) : f.push(n), n.observers && C(n)), s ? n.tState = o : n.state = o);
			}
			if (p.length > 1e6) throw p = [], /* @__PURE__ */ new Error();
		}, !1);
	}
	return e;
}
function A(t) {
	if (!t.fn) return;
	F(t);
	const e = d;
	T(t, c && c.running && c.sources.has(t) ? t.tValue : t.value, e), c && !c.running && c.sources.has(t) && queueMicrotask(() => {
		M(() => {
			c && (c.running = !0), h = r = t, T(t, t.tValue, e), h = r = null;
		}, !1);
	});
}
function T(t, e, n) {
	let s;
	const a = r, i = h;
	h = r = t;
	try {
		s = t.fn(e);
	} catch (l) {
		return t.pure && (c && c.running ? (t.tState = o, t.tOwned && t.tOwned.forEach(F), t.tOwned = void 0) : (t.state = o, t.owned && t.owned.forEach(F), t.owned = null)), t.updatedAt = n + 1, D(l);
	} finally {
		h = i, r = a;
	}
	(!t.updatedAt || t.updatedAt <= n) && (null != t.updatedAt && "observers" in t ? S(t, s, !0) : c && c.running && t.pure ? (c.sources.has(t) || (t.value = s), c.sources.add(t), t.tValue = s) : t.value = s, t.updatedAt = n);
}
function x(t) {
	const e = c && c.running;
	if (0 === (e ? t.tState : t.state)) return;
	if ((e ? t.tState : t.state) === a) return P(t);
	if (t.suspense && b(t.suspense.inFallback)) return t.suspense.effects.push(t);
	const n = [t];
	for (; (t = t.owner) && (!t.updatedAt || t.updatedAt < d);) {
		if (e && c.disposed.has(t)) return;
		(e ? t.tState : t.state) && n.push(t);
	}
	for (let s = n.length - 1; s >= 0; s--) {
		if (t = n[s], e) {
			let e = t, o = n[s + 1];
			for (; (e = e.owner) && e !== o;) if (c.disposed.has(e)) return;
		}
		if ((e ? t.tState : t.state) === o) A(t);
		else if ((e ? t.tState : t.state) === a) {
			const e = p;
			p = null, M(() => P(t, n[0]), !1), p = e;
		}
	}
}
function M(t, e) {
	if (p) return t();
	let n = !1;
	e || (p = []), f ? n = !0 : f = [], d++;
	try {
		const e = t();
		return function(t) {
			if (p && (E(p), p = null), t) return;
			let e;
			if (c) if (c.promises.size || c.queue.size) {
				if (c.running) return c.running = !1, c.effects.push.apply(c.effects, f), f = null, void k(!0);
			} else {
				const t = c.sources, n = c.disposed;
				f.push.apply(f, c.effects), e = c.resolve;
				for (const e of f) "tState" in e && (e.state = e.tState), delete e.tState;
				c = null, M(() => {
					for (const t of n) F(t);
					for (const e of t) {
						if (e.value = e.tValue, e.owned) for (let t = 0, n = e.owned.length; t < n; t++) F(e.owned[t]);
						e.tOwned && (e.owned = e.tOwned), delete e.tValue, delete e.tOwned, e.tState = 0;
					}
					k(!1);
				}, !1);
			}
			const n = f;
			f = null, n.length && M(() => s(n), !1), e && e();
		}(n), e;
	} catch (o) {
		n || (f = null), p = null, D(o);
	}
}
function E(t) {
	for (let e = 0; e < t.length; e++) x(t[e]);
}
function N(e) {
	let n, s = 0;
	for (n = 0; n < e.length; n++) {
		const t = e[n];
		t.user ? e[s++] = t : x(t);
	}
	if (t.context) {
		if (t.count) return t.effects || (t.effects = []), void t.effects.push(...e.slice(0, s));
		t.context = void 0;
	}
	for (!t.effects || !t.done && t.count || (e = [...t.effects, ...e], s += t.effects.length, delete t.effects), n = 0; n < s; n++) x(e[n]);
}
function P(t, e) {
	const n = c && c.running;
	n ? t.tState = 0 : t.state = 0;
	for (let s = 0; s < t.sources.length; s += 1) {
		const i = t.sources[s];
		if (i.sources) {
			const t = n ? i.tState : i.state;
			t === o ? i !== e && (!i.updatedAt || i.updatedAt < d) && x(i) : t === a && P(i, e);
		}
	}
}
function C(t) {
	const e = c && c.running;
	for (let n = 0; n < t.observers.length; n += 1) {
		const s = t.observers[n];
		(e ? s.tState : s.state) || (e ? s.tState = a : s.state = a, s.pure ? p.push(s) : f.push(s), s.observers && C(s));
	}
}
function F(t) {
	let e;
	if (t.sources) for (; t.sources.length;) {
		const e = t.sources.pop(), n = t.sourceSlots.pop(), s = e.observers;
		if (s && s.length) {
			const t = s.pop(), o = e.observerSlots.pop();
			n < s.length && (t.sourceSlots[o] = n, s[n] = t, e.observerSlots[n] = o);
		}
	}
	if (t.tOwned) {
		for (e = t.tOwned.length - 1; e >= 0; e--) F(t.tOwned[e]);
		delete t.tOwned;
	}
	if (c && c.running && t.pure) j(t, !0);
	else if (t.owned) {
		for (e = t.owned.length - 1; e >= 0; e--) F(t.owned[e]);
		t.owned = null;
	}
	if (t.cleanups) {
		for (e = t.cleanups.length - 1; e >= 0; e--) t.cleanups[e]();
		t.cleanups = null;
	}
	c && c.running ? t.tState = 0 : t.state = 0;
}
function j(t, e) {
	if (e || (t.tState = 0, c.disposed.add(t)), t.owned) for (let n = 0; n < t.owned.length; n++) j(t.owned[n]);
}
function D(t, e = r) {
	throw function(t) {
		return t instanceof Error ? t : new Error("string" == typeof t ? t : "Unknown error", { cause: t });
	}(t);
}
const R = { equals: !1 };
var O = class {
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
		if (!h) return;
		let e = this.#t.get(t);
		if (e) e.n++;
		else {
			const [n, s] = m(void 0, R);
			this.#t.set(t, e = {
				$: n,
				$$: s,
				n: 1
			});
		}
		y(() => {
			0 === --e.n && queueMicrotask(() => 0 === e.n && this.#t.delete(t));
		}), e.$();
	}
};
const Q = Symbol("track-keys");
var B = class extends Set {
	#e = new O();
	constructor(t) {
		if (super(), t) for (const e of t) super.add(e);
	}
	[Symbol.iterator]() {
		return this.values();
	}
	get size() {
		return this.#e.track(Q), super.size;
	}
	has(t) {
		return this.#e.track(t), super.has(t);
	}
	keys() {
		return this.values();
	}
	*values() {
		this.#e.track(Q);
		for (const t of super.values()) yield t;
	}
	*entries() {
		this.#e.track(Q);
		for (const t of super.entries()) yield t;
	}
	forEach(t, e) {
		this.#e.track(Q), super.forEach(t, e);
	}
	add(t) {
		return super.has(t) || (super.add(t), g(() => {
			this.#e.dirty(t), this.#e.dirty(Q);
		})), this;
	}
	delete(t) {
		const e = super.delete(t);
		return e && g(() => {
			this.#e.dirty(t), this.#e.dirty(Q);
		}), e;
	}
	clear() {
		super.size && g(() => {
			this.#e.dirty(Q);
			for (const t of super.values()) this.#e.dirty(t);
			super.clear();
		});
	}
};
if (!function() {
	let t = 0, e = null;
	(function(t) {
		const e = h, n = r, s = 0 === t.length, o = n, a = s ? i : {
			owned: null,
			cleanups: null,
			context: o ? o.context : null,
			owner: o
		}, c = s ? t : () => t();
		r = a, h = null;
		try {
			return M(c, !0);
		} finally {
			h = e, r = n;
		}
	})(() => {
		const [n, a] = m(0);
		e = () => a((t) => t + 1), function(t, e, n) {
			s = N;
			const a = function(t, e, n, s = o) {
				const a = {
					fn: t,
					state: s,
					updatedAt: null,
					owned: null,
					sources: null,
					sourceSlots: null,
					cleanups: null,
					value: e,
					owner: r,
					context: r ? r.context : null,
					pure: n
				};
				if (c && c.running && (a.state = 0, a.tState = s), null === r || r !== i && (c && c.running && r.pure ? r.tOwned ? r.tOwned.push(a) : r.tOwned = [a] : r.owned ? r.owned.push(a) : r.owned = [a]), u);
				return a;
			}(t, e, !1, o);
			n && n.render || (a.user = !0), f ? f.push(a) : A(a);
		}(() => {
			n(), t++;
		});
	});
	const n = t;
	return e && e(), n > 0 && t > n;
}()) throw new Error("reactive.js: solid-js resolved to the non-reactive SSR build, so effects and memos will never run. Run Node with --conditions=browser (see the \"test\" script in package.json).");
const I = {
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
}, _ = {
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
function L(t, e) {
	let n = t[e] instanceof B ? t[e] : new B(t[e] || []);
	Object.defineProperty(t, e, {
		get: () => n,
		set(t) {
			n = t instanceof B ? t : new B(t || []);
		},
		enumerable: !0,
		configurable: !0
	});
}
const W = {
	machine: "DFA",
	tool: "move",
	view: "build",
	sigma: new B(["a", "b"]),
	outputAlpha: new B(["0", "1"]),
	stackAlpha: new B(["Z"]),
	tapeCount: 2,
	states: [],
	transitions: [],
	startId: null,
	accepts: new B(),
	selectedStates: new B(),
	selectedTransitions: new B(),
	stateN: 0,
	transN: 0,
	meta: null,
	exercise: null,
	lexer: null,
	notes: [],
	noteN: 0,
	activeNoteId: null,
	selectedNotes: new B(),
	ctxNoteId: null,
	editNoteId: null,
	resizeNoteId: null,
	resizeNoteStart: null,
	dividers: [],
	dividerN: 0,
	selectedDividers: new B(),
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
			vars: new B(t),
			start: e,
			productions: n
		};
		return L(s, "vars"), s;
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
for (const Ks of [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts",
	"selectedStates",
	"selectedTransitions",
	"selectedNotes",
	"selectedDividers"
]) L(W, Ks);
let q = null, z = null, J = -1, U = null, V = null;
function K() {
	return W.simStart || W.startId;
}
function G(t) {
	return function() {
		const t = W.states || [], e = t.length;
		if (z === t && J === e && U === t[0] && V === t[e - 1]) return q;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) n.set(t[s].id, t[s]);
		return q = n, z = t, J = e, U = t[0], V = t[e - 1], n;
	}().get(t);
}
function H(t) {
	return I[t] || I.DFA;
}
function Y(t = W.machine) {
	return !("LBA" === t || !H(t).twoWayTape && !W.config.twoWayTape);
}
function Z() {
	return !1 !== W.config.detectLoops;
}
function X(t = W.machine) {
	const e = H(t).omegaCondition;
	return _[e] ? e : "buchi";
}
function tt(t) {
	const e = Number(t?.priority);
	return Number.isInteger(e) && e >= 0 ? e : 0;
}
function et() {
	return {
		left: W.config.sym.leftMarker,
		right: W.config.sym.rightMarker
	};
}
W.config.radius;
const st = /* @__PURE__ */ new Map();
function ot(t, e) {
	if (st.has(t)) throw new Error(`Machine "${t}" is already defined.`);
	if (!e || "object" != typeof e) throw new Error(`Machine "${t}" needs a definition object.`);
	return st.set(t, {
		id: t,
		...e
	}), st.get(t);
}
function at(t, e) {
	for (const [n, s] of Object.entries(e)) ot(n, {
		...t,
		...s
	});
}
function it(t) {
	return st.get(t) || null;
}
var rt = class {
	constructor(t, e, n) {
		this.count = t, this.last = e, this.at = n;
	}
};
const ct = (t, e, n) => new rt(t, e, n), lt = 4096, ut = 4095, ht = (t, e) => {
	const n = new t(lt);
	return e.push(n), n;
};
var pt = class {
	constructor() {
		this.Type = Uint8Array, this.max = 255, this.chunks = [], this.length = 0;
	}
	push(t) {
		t > this.max && this.widen(t);
		const e = this.length++;
		(this.chunks[e >>> 12] || ht(this.Type, this.chunks))[e & ut] = t;
	}
	get(t) {
		return this.chunks[t >>> 12][t & ut];
	}
	set(t, e) {
		e > this.max && this.widen(e), this.chunks[t >>> 12][t & ut] = e;
	}
	widen(t) {
		const e = t <= 65535 ? Uint16Array : Uint32Array;
		this.chunks = this.chunks.map((t) => e.from(t)), this.Type = e, this.max = e === Uint16Array ? 65535 : 4294967295;
	}
	pushMany(t, e) {
		let n = 0;
		for (let o = 0; o < e; o++) t[o] > n && (n = t[o]);
		n > this.max && this.widen(n);
		let s = 0;
		for (; s < e;) {
			const n = this.length, o = this.chunks[n >>> 12] || ht(this.Type, this.chunks), a = Math.min(e - s, lt - (n & ut));
			o.set(t.subarray(s, s + a), n & ut), this.length += a, s += a;
		}
	}
	bytes() {
		return this.chunks.length * lt * this.Type.BYTES_PER_ELEMENT;
	}
}, ft = class {
	constructor() {
		this.deltas = [], this.anchors = [], this.nAnchors = 0, this.jumps = null, this.length = 0, this.last = 0, this.ci = -1, this.cv = 0;
	}
	push(t) {
		const e = this.length++, n = this.deltas[e >>> 12] || ht(Int8Array, this.deltas);
		if (e % 64 == 0) {
			const e = this.nAnchors++;
			(this.anchors[e >>> 12] || ht(Int32Array, this.anchors))[e & ut] = t;
		}
		const s = 0 === e ? 0 : t - this.last;
		s > -128 && s <= 127 ? n[e & ut] = s : (n[e & ut] = -128, (this.jumps ??= /* @__PURE__ */ new Map()).set(e, t)), this.last = t;
	}
	pushMany(t, e) {
		let n = 0, s = this.last;
		for (; n < e;) {
			let o = this.length;
			const a = this.deltas[o >>> 12] || ht(Int8Array, this.deltas), i = n + Math.min(e - n, lt - (o & ut));
			for (; n < i; n++, o++) {
				const e = t[n];
				if (o % 64 == 0) {
					const t = this.nAnchors++;
					(this.anchors[t >>> 12] || ht(Int32Array, this.anchors))[t & ut] = e;
				}
				const i = 0 === o ? 0 : e - s;
				i > -128 && i <= 127 ? a[o & ut] = i : (a[o & ut] = -128, (this.jumps ??= /* @__PURE__ */ new Map()).set(o, e)), s = e;
			}
			this.length = o;
		}
		this.last = s;
	}
	anchor(t) {
		const e = t / 64;
		return this.anchors[e >>> 12][e & ut];
	}
	after(t, e) {
		const n = this.deltas[t >>> 12][t & ut];
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
			for (let n = this.ci; n > t; n--) e -= this.deltas[n >>> 12][n & ut];
			return this.ci = t, this.cv = e, e;
		}
		let n, s;
		for (this.ci >= e && this.ci < t ? (n = this.ci, s = this.cv) : (n = e, s = this.anchor(e)); n < t;) s = this.after(++n, s);
		return this.ci = t, this.cv = s, s;
	}
	bytes() {
		return (this.deltas.length + 4 * this.anchors.length) * lt;
	}
};
const dt = [
	0,
	255,
	65535,
	0,
	4294967295
];
var mt = class {
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
		e > dt[this.buf.BYTES_PER_ELEMENT] && this.widen(e), this.buf[n] = e, 0 !== e && (t < this.lo && (this.lo = t), t > this.hi && (this.hi = t));
	}
	ensure(t, e) {
		const n = this.buf.length;
		if (n && t >= this.base && e < this.base + n) return;
		const s = n ? Math.min(this.base, t) : t, o = n ? Math.max(this.base + n - 1, e) : e, a = Math.max(64, 2 * (o - s + 1)), i = a - (o - s + 1), r = n && t < this.base, c = n && e >= this.base + n, l = s - (r ? c ? i >> 1 : i : 0), u = new this.buf.constructor(a);
		n && u.set(this.buf, this.base - l), this.buf = u, this.base = l;
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
		e && (this.ensure(t.lo, t.lo + e - 1), t.codes.BYTES_PER_ELEMENT > this.buf.BYTES_PER_ELEMENT && this.widen(dt[t.codes.BYTES_PER_ELEMENT]), this.buf.set(t.codes, t.lo - this.base), this.lo = t.lo, this.hi = t.lo + e - 1);
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
function gt() {
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
function bt(t) {
	const e = t.blank, n = t.twoWay, s = t.rightBound, o = t.immutable ? [...t.immutable] : [], a = new Map(t.cells), i = gt(), r = i.values, c = i.code(e), l = new ft(), u = new pt(), h = new pt();
	let p = null, f = null;
	const d = new mt();
	for (const [N, P] of a) d.set(N, i.code(P));
	const m = [];
	let g = 0;
	function b(t) {
		const e = d.snapshot(t);
		return m.push(e), g = t + Math.max(1024, e.codes.length), g;
	}
	const y = new mt();
	let w = -1, k = -1, v = null, $ = 0;
	function S(t, e) {
		if (t >= e) return;
		$ += e - t;
		const n = p, s = h.chunks, o = l.deltas;
		let a = l.get(t), i = t, r = s[i >>> 12], c = o[i >>> 12];
		for (;;) {
			const t = r[i & ut];
			if (0 !== t && y.set(null !== n && n.has(i) ? n.get(i) : a, 1 === t ? 0 : t - 1), ++i >= e) return;
			4095 & i || (r = s[i >>> 12], c = o[i >>> 12]);
			const u = c[i & ut];
			a = -128 === u ? l.jumps.get(i) : a + u;
		}
	}
	function A(t, e) {
		if (t <= e) return;
		$ += t - e;
		const n = p, s = f;
		let o = t - 1, a = l.get(o);
		for (;;) {
			if (0 !== h.get(o)) {
				let t;
				if (null !== s && s.has(o)) t = s.get(o);
				else {
					const e = u.get(o);
					t = e === c ? 0 : e;
				}
				y.set(null !== n && n.has(o) ? n.get(o) : a, t);
			}
			if (--o < e) return;
			const t = l.deltas[o + 1 >>> 12][o + 1 & ut];
			a = -128 === t ? l.get(o) : a - t;
		}
	}
	function T(t) {
		if (t === w) return;
		let e = 0, n = m.length - 1, s = -1;
		for (; e <= n;) {
			const o = e + n >> 1;
			m[o].row <= t ? (s = o, e = o + 1) : n = o - 1;
		}
		const o = m[s], a = m[s + 1], i = y.lo <= y.hi ? y.hi - y.lo + 1 : 0, r = (t) => (t.codes.length + i) / 32;
		let c = 0, l = o ? t - o.row + r(o) : 1 / 0;
		w >= 0 && Math.abs(t - w) <= l && (c = 1, l = Math.abs(t - w)), a && a.row - t + r(a) < l && (c = 2), 1 === c ? w < t ? S(w, t) : A(w, t) : 2 === c ? (y.load(a), A(a.row, t)) : (y.load(o), S(o.row, t)), w = t;
	}
	function x(t) {
		if (t === k) return v;
		T(t);
		const o = l.get(t) ?? 0, a = y.extent();
		let i, c = 0;
		n && (c = o, a && a[0] < c && (c = a[0])), null !== s ? i = s : (i = o > c ? o : c, a && a[1] > i && (i = a[1]));
		const u = y.buf, h = y.base, p = u.length, f = [];
		for (let n = c; n <= i; n++) {
			const t = n - h, s = t >= 0 && t < p ? u[t] : 0;
			f.push(0 === s ? e : r[s]);
		}
		return v = {
			tape: f,
			head: o - c,
			origin: c
		}, k = t, v;
	}
	const M = (t) => {
		if (0 === h.get(t)) return;
		const e = p?.get(t);
		return void 0 === e ? l.get(t) : e;
	}, E = (t) => {
		const e = h.get(t);
		return e <= 1 ? void 0 : r[e - 1];
	};
	return {
		cols: null,
		begin(t, e) {
			const n = l.length;
			return n >= g && b(n), l.push(t), u.push(void 0 === e ? 0 : i.code(e)), h.push(0), n;
		},
		noteWrite(t, e, n) {
			const s = n.has(e) ? i.code(n.get(e)) : 0;
			h.set(t, 0 === s ? 1 : s + 1);
			const o = e !== l.get(t);
			o && (p ??= /* @__PURE__ */ new Map()).set(t, e);
			const a = d.get(e), r = u.get(t);
			(o || a !== (r === c ? 0 : r)) && (f ??= /* @__PURE__ */ new Map()).set(t, a), d.set(e, s);
		},
		appender: () => ({
			live: d,
			heads: l,
			reads: u,
			writes: h,
			syms: i,
			blankCode: c,
			get nextCheckpoint() {
				return g;
			},
			checkpoint: b,
			undoException(t, e) {
				(f ??= /* @__PURE__ */ new Map()).set(t, e);
			}
		}),
		frameAt: x,
		headAt: (t) => l.get(t),
		readAt(t) {
			const n = u.get(t);
			if (0 !== n) return r[n];
			T(t);
			const s = y.get(l.get(t));
			return 0 === s ? e : r[s];
		},
		replayed: () => $,
		journal() {
			const t = {
				head: void 0,
				cell: void 0,
				sym: void 0,
				code: 0
			};
			let i = -1, c = 0;
			return {
				initial: a,
				blank: e,
				twoWay: n,
				rightBound: s,
				markers: o,
				checkpoints: m,
				leftBound: n ? null : 0,
				get length() {
					return l.length;
				},
				head: (t) => l.get(t),
				cell: M,
				sym: E,
				symbol: (t) => 0 === t ? e : r[t],
				into(e) {
					let n, s;
					if (e === i + 1 && e > 0 && e < l.length) {
						s = c;
						const t = l.deltas[e >>> 12][e & ut];
						n = -128 === t ? l.jumps.get(e) : s + t;
					} else s = e > 0 ? l.get(e - 1) : void 0, n = l.get(e);
					if (void 0 !== n && (i = e, c = n), t.head = n, t.cell = t.sym = void 0, t.code = 0, e > 0 && e <= h.length) {
						const n = e - 1, o = h.chunks[n >>> 12][n & ut];
						0 !== o && (t.cell = null !== p && p.has(n) ? p.get(n) : s, 1 !== o && (t.sym = r[o - 1], t.code = o - 1));
					}
					return t;
				}
			};
		},
		viewAt(t) {
			const a = x(t);
			return {
				kind: "tape",
				cells: a.tape,
				head: a.head,
				origin: a.origin,
				leftBound: n ? null : 0,
				rightBound: s,
				markers: o,
				blank: e,
				readOnly: !1
			};
		},
		bytes: () => l.bytes() + u.bytes() + h.bytes() + d.bytes() + y.bytes() + m.reduce((t, e) => t + e.codes.byteLength, 0)
	};
}
const yt = (t) => (t._log || t._logs[0]).cols, wt = {
	state: {
		get() {
			return yt(this).stateAt(this._i);
		},
		configurable: !0
	},
	tid: {
		get() {
			return yt(this).tidAt(this._i);
		},
		configurable: !0
	},
	tokens: {
		get() {
			return yt(this).tokens;
		},
		configurable: !0
	},
	note: {
		get() {
			const t = yt(this);
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
}, kt = Object.create(Object.prototype, {
	...wt,
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
}), vt = Object.create(Object.prototype, {
	...wt,
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
function $t(t, e, n, s = !1) {
	const o = gt(), a = gt(), i = new pt(), r = new pt();
	function c(e) {
		const n = Object.create(s ? vt : kt);
		return s ? n._logs = t : n._log = t[0], n._i = e, n;
	}
	const l = {
		tokens: e,
		noteAt: n,
		stateAt: (t) => o.value(i.get(t)),
		tidAt: (t) => {
			const e = r.get(t);
			return 0 === e ? null : a.value(e);
		},
		statesSeen: () => o.values,
		step: (t, e, n) => (i.push(o.code(e)), r.push(null == n ? 0 : a.code(n)), c(t)),
		at: c,
		appender: () => ({
			states: o,
			tids: a,
			stateCol: i,
			tidCol: r
		}),
		plain(t, e) {
			if (t._i !== e || yt(t) !== l) return !1;
			let n = 0;
			for (const s in t) {
				if ("_i" !== s && "_log" !== s && "_logs" !== s) return !1;
				n++;
			}
			return 2 === n;
		},
		bytes: () => i.bytes() + r.bytes() + t.reduce((t, e) => t + e.bytes(), 0)
	};
	return t[0].cols = l, l;
}
function St(t = []) {
	const { left: e, right: n } = et();
	return [
		e,
		...t,
		n
	];
}
function At(t = W.machine) {
	return "QA" === t;
}
function Tt(t = W.machine) {
	return "2PDA" === t;
}
function xt(t, e, n = W.config.sym.any) {
	return t === e || t === n || e === n;
}
function Mt(t = [], e = () => 0) {
	let n = null, s = -1 / 0;
	for (const o of t) {
		const t = e(o);
		t > s ? (n = o, s = t) : t === s && n && String(o.id || "").localeCompare(String(n.id || ""), void 0, { numeric: !0 }) < 0 && (n = o);
	}
	return n;
}
function Et(t) {
	const e = "function" == typeof t.next ? t : t[Symbol.iterator](), n = [];
	let s = e.next();
	for (; !s.done;) n.push(s.value), s = e.next();
	return W.simSteps = n, W.simIdx = 0, s.value;
}
function Nt(t, e = W.sigma) {
	if ("" === t || !t) return [];
	const n = [...e].filter((t) => t !== W.config.sym.eps).sort((t, e) => e.length - t.length), s = t.split(/[,\s]+/).filter((t) => t.length > 0);
	if (0 === s.length) return [];
	const o = [];
	for (const a of s) {
		const t = Pt(a, n);
		if (null === t) return null;
		for (const e of t) o.push(e);
	}
	return o;
}
function Pt(t, e) {
	const n = t.length, s = new Uint8Array(n + 1);
	s[n] = 1;
	const o = (e, n) => e.length > 0 && 1 === s[n + e.length] && t.startsWith(e, n);
	for (let i = n - 1; i >= 0; i--) for (const t of e) if (o(t, i)) {
		s[i] = 1;
		break;
	}
	if (!s[0]) return null;
	const a = [];
	for (let i = 0; i < n;) for (const t of e) if (o(t, i)) {
		a.push(t), i += t.length;
		break;
	}
	return a;
}
function Ct(t) {
	return [...t].map((t) => G(t)?.name || t).join(",");
}
var Ft = class {
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
}, jt = class {
	constructor(t = 1024) {
		let e = 16;
		for (; e < 2 * t;) e *= 2;
		this.cap = e, this.size = 0, this.slots = new Int32Array(6 * e);
	}
	add(t, e, n, s, o) {
		return -1 === this.addOrGet(t, e, n, s, o, 0);
	}
	addOrGet(t, e, n, s, o, a) {
		const i = this.slots, r = this.cap - 1, c = t + 1;
		let l = 6 * (function(t, e, n, s, o) {
			let a = Math.imul(t, 2654435761) ^ Math.imul(e + 2135587861, 2246822519);
			return a = Math.imul(a ^ a >>> 15, 739982445) ^ Math.imul(n, 3266489917), a = Math.imul(a ^ a >>> 13, 695872825) ^ Math.imul(s, 668265263) ^ Math.imul(o, 374761393), a = Math.imul(a ^ a >>> 16, 2246822507), (a ^ a >>> 13) >>> 0;
		}(t, e, n, s, o) & r);
		for (; 0 !== i[l];) {
			if (i[l] === c && i[l + 1] === e && i[l + 2] === n && i[l + 3] === s && i[l + 4] === o) return i[l + 5];
			l += 6, l === i.length && (l = 0);
		}
		return i[l] = c, i[l + 1] = e, i[l + 2] = n, i[l + 3] = s, i[l + 4] = o, i[l + 5] = a, 2 * ++this.size > this.cap && this.grow(), -1;
	}
	grow() {
		const t = this.slots;
		this.cap *= 2, this.slots = new Int32Array(6 * this.cap), this.size = 0;
		for (let e = 0; e < t.length; e += 6) 0 !== t[e] && this.addOrGet(t[e] - 1, t[e + 1], t[e + 2], t[e + 3], t[e + 4], t[e + 5]);
	}
};
function Dt() {
	const t = /* @__PURE__ */ new Map();
	return (e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = t.size), n;
	};
}
const Rt = Object.freeze([]);
let Ot = null, Qt = null, Bt = -1, It = null, _t = null;
function Lt(t) {
	return function() {
		const t = W.transitions || Rt, e = t.length;
		if (Qt === t && Bt === e && It === t[0] && _t === t[e - 1]) return Ot;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) {
			const e = t[s], o = n.get(e.from);
			o ? o.push(e) : n.set(e.from, [e]);
		}
		return Ot = n, Qt = t, Bt = e, It = t[0], _t = t[e - 1], n;
	}().get(t) || Rt;
}
function Wt() {
	const t = W.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let o = e.get(n);
		void 0 === o && e.set(n, o = function(t, e) {
			const n = Lt(t), s = qt.get(n);
			if (void 0 !== s && function(t, e, n) {
				if (t.any !== n) return !1;
				const { syms: s, ids: o } = t;
				for (let a = 0; a < e.length; a++) if (e[a].symbol !== s[a] || e[a].id !== o[a]) return !1;
				return !0;
			}(s, n, e)) return s;
			const o = /* @__PURE__ */ new Map();
			let a = null;
			const i = new Array(n.length), r = new Array(n.length);
			for (let l = 0; l < n.length; l++) {
				const t = n[l];
				i[l] = t.symbol, r[l] = t.id, t.symbol === e ? a = zt(a, t) : o.set(t.symbol, zt(o.get(t.symbol) ?? null, t));
			}
			const c = {
				bySymbol: o,
				wildcard: a,
				any: e,
				syms: i,
				ids: r
			};
			return qt.set(n, c), c;
		}(n, t));
		const a = o.bySymbol.get(s);
		return void 0 !== a ? a : o.wildcard;
	};
}
const qt = /* @__PURE__ */ new WeakMap();
function zt(t, e) {
	return null === t || String(e.id || "").localeCompare(String(t.id || ""), void 0, { numeric: !0 }) < 0 ? e : t;
}
function Jt() {
	const t = /* @__PURE__ */ new Map();
	return (e, n) => {
		let s = t.get(e);
		void 0 === s && t.set(e, s = /* @__PURE__ */ new Map());
		const o = 1 === n.length ? n[0] : n.join("");
		let a = s.get(o);
		return void 0 === a && s.set(o, a = function(t, e) {
			const n = W.config.sym.any;
			return Mt(Lt(t).filter((t) => t.tapeSyms && t.tapeSyms.length === e.length && t.tapeSyms.every((t, s) => t === e[s] || t === n)), (t) => t.tapeSyms.reduce((t, n, s) => t + (n === e[s] ? 1 : 0), 0));
		}(e, n)), a;
	};
}
function Ut() {
	if (!Z()) return {
		seenAt: () => -1,
		seenAtVerified: () => -1,
		verifying: !1
	};
	let t = /* @__PURE__ */ new Map(), e = Vt();
	return {
		get verifying() {
			return null !== e;
		},
		seenAt: (e, n) => t ? t.has(e) ? t.get(e) : (t.set(e, n), t.size > 5e3 && (t = null), -1) : -1,
		seenAtVerified(t, n, s, o, a, i) {
			if (!e) return -1;
			const r = e.check(t, n, s, o, a, i);
			return e.size > 5e3 && (e = null), r;
		}
	};
}
function Vt() {
	const t = new jt(), e = Dt();
	let n = null;
	return {
		get size() {
			return t.size;
		},
		check(s, o, a, i, r, c) {
			const l = e(s), u = t.addOrGet(l, o, a, i, 0, r);
			if (u < 0) return -1;
			if (c(u)) return u;
			const h = `${l},${o},${a},${i}`;
			n ??= /* @__PURE__ */ new Map();
			const p = n.get(h);
			if (!p) return n.set(h, [r]), -1;
			for (const t of p) if (c(t)) return t;
			return p.push(r), -1;
		}
	};
}
function Kt(t, e) {
	const n = Vt();
	let s = null;
	const o = (n) => t(n) === (s ??= e());
	return (t, e, a, i, r) => (s = null, n.check(t, e, a, i, r, o) >= 0);
}
function Gt(t, e) {
	t.final = "loop", t.loopFrom = e, t.note += ` — LOOP: repeats step ${e}, so this machine never halts on this input`;
}
function Ht(t, e = W.config.maxTmSteps) {
	t.final = "timeout", t.limit = e, t.note += ` — NO VERDICT: still running after ${e} steps`, Z() || (t.note += ", and loop detection is off");
}
function Yt(t, e, n) {
	const s = function(t, e) {
		const n = W.config.sym.blank, s = Math.max(0, e), o = t.length ? [...t] : [n];
		for (; o.length <= s;) o.push(n);
		for (; o.length > s + 1 && o[o.length - 1] === n;) o.pop();
		return {
			tape: o,
			head: s
		};
	}(e, n), o = G(t)?.name || t;
	return `${s.tape.slice(0, s.head).join("")}[${o}]${s.tape.slice(s.head).join("")}`;
}
function Zt(t) {
	const e = Nt(t === W.config.sym.eps ? "" : t);
	return null === e ? {
		ok: !1,
		error: `Input cannot be tokenized using alphabet {${[...W.sigma].join(", ")}}.`
	} : {
		ok: !0,
		input: e,
		tokens: e
	};
}
function Xt(t) {
	return {
		verdict: t ? "acc" : "rej",
		output: null
	};
}
function te(t, e) {
	return {
		verdict: t ? "acc" : "rej",
		output: e
	};
}
function ee(t, e) {
	return !!t && (!W.config.transducerAccepts || e);
}
function ne(t) {
	const e = [];
	let n = t;
	for (; n;) e.push(n), n = n.parent;
	return e.reverse();
}
function se(t, e, n) {
	return W.transitions.find((s) => s.id !== n && s.from === t && xt(s.symbol, e)) || null;
}
function oe(t) {
	return G(t)?.name || t;
}
function ae() {
	return Math.max(10, W.config.langStepBudget || 400);
}
function ie(t, e) {
	return {
		piece: e,
		prev: t,
		len: t ? t.len + 1 : 1
	};
}
function re(t, e) {
	let n = t.kids;
	null === n && (n = t.kids = /* @__PURE__ */ new Map());
	let s = n.get(e);
	if (void 0 === s) {
		const o = null !== e && "object" == typeof e ? e.length : 1;
		s = {
			sym: e,
			below: t,
			length: t.length + 1,
			size: t.size + o,
			id: t.trie.next++,
			kids: null,
			arr: null,
			trie: t.trie
		}, n.set(e, s);
	}
	return s;
}
function ce(t) {
	if (null !== t.arr) return t.arr;
	const e = new Array(t.length);
	for (let n = t, s = t.length - 1; s >= 0; n = n.below, s--) e[s] = n.sym;
	return t.arr = e, e;
}
function le(t, e) {
	for (let n = 0; n < e.length; n++) t = re(t, e[n]);
	return t;
}
function ue(t) {
	return Array.isArray(t) ? t : ce(t);
}
const he = {
	get() {
		return this.tokens.slice(this.pos);
	},
	enumerable: !1,
	configurable: !0
}, pe = {
	get() {
		return function(t) {
			const e = t ? t.len : 0, n = new Array(e);
			for (let s = t, o = e - 1; s; s = s.prev, o--) n[o] = s.piece;
			return n;
		}(this.outNode);
	},
	enumerable: !1,
	configurable: !0
}, fe = {
	get() {
		return void 0 === this.stackRef ? void 0 : ue(this.stackRef);
	},
	enumerable: !1,
	configurable: !0
}, de = {
	get() {
		return void 0 === this.stackRef2 ? void 0 : ue(this.stackRef2);
	},
	enumerable: !1,
	configurable: !0
}, me = {
	get() {
		return ce(this.storeRef).map(ce);
	},
	enumerable: !1,
	configurable: !0
}, ge = {
	get() {
		const t = this.storeRef.sym;
		return t ? ce(t) : [];
	},
	enumerable: !1,
	configurable: !0
}, be = Object.defineProperties({}, { remaining: he }), ye = Object.defineProperties({}, { outToks: pe }), we = (Object.defineProperties({}, {
	remaining: he,
	outToks: pe
}), Object.defineProperties({}, {
	remaining: he,
	stack: fe,
	stack2: de
})), ke = Object.defineProperties({}, {
	remaining: he,
	outToks: pe,
	stack: fe,
	stack2: de
}), ve = Object.defineProperties({}, {
	remaining: he,
	store: me,
	stack: ge
}), $e = {
	get() {
		const t = this._note;
		return "function" == typeof t ? this._note = t() : t;
	},
	set(t) {
		this._note = t;
	},
	enumerable: !1,
	configurable: !0
}, Se = /* @__PURE__ */ new WeakMap();
function Ae(t) {
	let e = Se.get(t);
	return e || Se.set(t, e = Object.create(t, { note: $e })), e;
}
function Te(t, e) {
	if (void 0 === e) return Object.assign(Object.create(be), t);
	const n = Object.assign(Object.create(Ae(be)), t);
	return n._note = e, n;
}
function xe(t, e) {
	if (void 0 === e) return Object.assign(Object.create(ye), t);
	const n = Object.assign(Object.create(Ae(ye)), t);
	return n._note = e, n;
}
function Me(t) {
	return Object.assign(Object.create(void 0 !== t.outNode ? ke : we), t);
}
function Ee(t) {
	return Object.assign(Object.create(ve), t);
}
function Ne(t, e) {
	return e && t && t[0] && Object.defineProperty(t[0], "branchTree", {
		value: e,
		configurable: !0,
		writable: !0,
		enumerable: !1
	}), t;
}
function* Pe(t) {
	let e = K();
	const n = Wt();
	let s = Te({
		state: e,
		tokens: t,
		pos: 0,
		note: `Start: ${G(e)?.name || "?"}`
	});
	yield s;
	for (let o = 0; o < t.length; o++) {
		const a = t[o], i = n(e, a);
		if (!i) return s = Te({
			state: e,
			tokens: t,
			pos: o,
			note: `No δ(${G(e)?.name},'${a}') — Implicit REJECT`,
			final: "reject"
		}), void (yield s);
		const r = e = i.to;
		s = Te({
			state: e,
			tokens: t,
			pos: o + 1,
			tid: i.id
		}, () => `Read '${a}' → ${G(r)?.name}`), yield s;
	}
	s.final || (s.final = W.accepts.has(e) ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
var Ce = class {
	constructor() {
		const { eps: t, any: e } = W.config.sym;
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
			for (const n of Lt(this.ids[t])) n.symbol !== e && n.symbol !== this.any || s.push(this.no(n.to));
			n.set(e, s);
		}
		return s;
	}
	epsTargets(t) {
		let e = this.epsOut[t];
		if (null === e) {
			e = [];
			for (const n of Lt(this.ids[t])) n.symbol === this.eps && e.push(this.no(n.to));
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
			for (const o of this.epsTargets(s)) this.mark[o] !== this.stamp && (this.mark[o] = this.stamp, t.push(o), e[n++] = o);
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
		for (let o = 0; o < e.length; o++) for (const a of this.targets(e[o], t)) this.mark[a] !== s && (this.mark[a] = s, n.push(a));
		this.close(n);
	}
	stateIds() {
		return this.cur.map((t) => this.ids[t]);
	}
	accepts() {
		const t = W.accepts;
		return this.cur.some((e) => t.has(this.ids[e]));
	}
};
function* Fe(t) {
	const e = new Ce();
	e.start(K());
	let n = e.stateIds(), s = Te({
		states: n,
		tokens: t,
		pos: 0,
		note: `Start ε-closure: {${Ct(n)}}`
	});
	yield s;
	for (let a = 0; a < t.length; a++) {
		const o = t[a];
		e.step(o);
		const i = n = e.stateIds();
		if (s = Te({
			states: n,
			tokens: t,
			pos: a + 1
		}, () => `Read '${o}' → {${Ct(i) || "∅"}}`), yield s, !n.length) break;
	}
	const o = e.accepts();
	s.final || (s.final = o ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
function je(t) {
	Et(Fe(t));
}
function De(t) {
	let e = K();
	const n = Wt();
	for (const s of t) {
		const t = n(e, s);
		if (!t) return !1;
		e = t.to;
	}
	return W.accepts.has(e);
}
function Re(t) {
	const e = new Ce();
	e.start(K());
	for (let n = 0; n < t.length && e.cur.length; n++) e.step(t[n]);
	return e.accepts();
}
const Oe = {
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
function Qe(t) {
	const e = Number(t.weight);
	return Number.isFinite(e) ? e : 1;
}
function Be(t) {
	return Number.isFinite(t) ? Number.isInteger(t) ? String(t) : String(Number(t.toFixed(4))) : "0";
}
function Ie(t, e) {
	const n = W.config.sym.any, s = /* @__PURE__ */ new Map();
	for (const [o, a] of t) if (a) for (const t of Lt(o)) {
		if (t.symbol !== e && t.symbol !== n) continue;
		const o = Qe(t);
		o && s.set(t.to, (s.get(t.to) || 0) + a * o);
	}
	return s;
}
function _e(t) {
	let e = 0;
	for (const [n, s] of t) W.accepts.has(n) && (e += s);
	return e;
}
function Le(t) {
	const e = [/* @__PURE__ */ new Map([[K(), 1]])];
	for (const n of t) e.push(Ie(e[e.length - 1], n));
	return e;
}
function We(t, e, n, s) {
	const o = W.config.sym.any, a = function(t, e, n) {
		return n < t.length ? t[n] : e[(n - t.length) % e.length];
	}(t, e, s), i = function(t, e, n) {
		return n + 1 < t.length + e.length ? n + 1 : t.length;
	}(t, e, s), r = [];
	for (const c of Lt(n)) c.symbol !== a && c.symbol !== o || r.push({
		state: c.to,
		pos: i,
		via: c
	});
	return r;
}
at(Oe, {
	DFA: {
		simulate: function(t) {
			Et(Pe(t));
		},
		stream: Pe,
		deterministicDelta: !0,
		determinism: {
			conflict: (t, e) => function(t, e, n) {
				return W.transitions.find((s) => s.id !== n && s.from === t && s.symbol === e) || null;
			}(t.from, t.symbol, e),
			say: (t) => `${W.machine} already has δ(${oe(t.from)}, '${t.symbol}'). Each (state, symbol) pair must be unique.`
		},
		decide: (t) => Xt(De(t)),
		formal: {
			...Oe.formal,
			delta: () => "Q × Σ → Q"
		}
	},
	NFA: {
		simulate: je,
		stream: Fe,
		branches: !0,
		decide: (t) => Xt(Re(t)),
		formal: {
			...Oe.formal,
			delta: () => "Q × Σ → P(Q)"
		}
	},
	"ε-NFA": {
		simulate: je,
		stream: Fe,
		branches: !0,
		decide: (t) => Xt(Re(t)),
		formal: {
			...Oe.formal,
			delta: () => "Q × (Σ ∪ {ε}) → P(Q)"
		}
	}
}), ot("PFA", {
	family: "weighted",
	options: ["cutPoint"],
	simulate: function(t) {
		W.simSteps = [];
		const e = W.config.pfaCutPoint;
		Le(t).forEach((e, n) => {
			const s = function(t) {
				return [...t.entries()].filter(([, t]) => t > 0).sort((t, e) => e[1] - t[1]).map(([t, e]) => `${G(t)?.name || t}:${Be(e)}`);
			}(e);
			W.simSteps.push(Te({
				states: [...e.keys()].filter((t) => e.get(t) > 0),
				tokens: t,
				pos: n,
				dist: s,
				accMass: _e(e),
				note: 0 === n ? `Start: all probability on ${G(K())?.name || K()}` : `Read '${t[n - 1]}' → ${s.length ? s.join("  ") : "total mass 0 — the run has died"}`
			}));
		});
		const n = W.simSteps[W.simSteps.length - 1];
		if (n) {
			const t = n.accMass > e;
			n.final = t ? "accept" : "reject", n.note += ` | P(accept) = ${Be(n.accMass)} ${t ? ">" : "≤"} λ = ${Be(e)} — ${t ? "ACCEPT" : "REJECT"}`;
		}
		const s = function() {
			const t = /* @__PURE__ */ new Map();
			for (const n of W.transitions) {
				const e = `${n.from}|${n.symbol}`;
				t.set(e, (t.get(e) || 0) + Qe(n));
			}
			const e = [];
			for (const [n, s] of t) if (Math.abs(s - 1) > 1e-9) {
				const [t, o] = n.split("|");
				e.push({
					from: t,
					symbol: o,
					total: s
				});
			}
			return e;
		}();
		return n && s.length && (n.note += ` | ⚠ ${s.length} (state, symbol) row${s.length > 1 ? "s do" : " does"} not sum to 1`), W.simIdx = 0, {
			accepted: !!n && "accept" === n.final,
			mass: n?.accMass ?? 0,
			malformed: s
		};
	},
	decide: (t) => Xt(function(t) {
		const e = Le(t);
		return _e(e[e.length - 1]) > W.config.pfaCutPoint;
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
const qe = (t, e) => `${t}|${e}`;
function ze(t, e, n, s = null) {
	const o = qe(n.state, n.pos), a = /* @__PURE__ */ new Map(), i = new Ft(), r = (t, e) => {
		const n = qe(e.state, e.pos);
		return n === o || (s && !s(e.state) || a.has(n) || (a.set(n, {
			from: t,
			via: e.via
		}), i.push({
			state: e.state,
			pos: e.pos
		})), !1);
	}, c = (t, e) => {
		const n = [{
			state: e.state,
			pos: e.pos,
			via: e.via
		}];
		let s = t;
		for (; qe(s.state, s.pos) !== o;) {
			const t = a.get(qe(s.state, s.pos));
			n.unshift({
				state: s.state,
				pos: s.pos,
				via: t.via
			}), s = t.from;
		}
		return n;
	};
	for (const l of We(t, e, n.state, n.pos)) if (r(n, l)) return c(n, l);
	for (; i.length;) {
		const n = i.shift();
		for (const s of We(t, e, n.state, n.pos)) if (r(n, s)) return c(n, s);
	}
	return null;
}
function Je(t, e) {
	if (!e.length) return {
		accepted: !1,
		reason: "empty-period",
		stem: [],
		loop: []
	};
	if (!K()) return {
		accepted: !1,
		reason: "no-start",
		stem: [],
		loop: []
	};
	const n = {
		state: K(),
		pos: 0,
		via: null
	}, s = /* @__PURE__ */ new Map([[qe(n.state, n.pos), null]]), o = [n], a = new Ft([n]);
	for (; a.length;) {
		const n = a.shift();
		for (const i of We(t, e, n.state, n.pos)) {
			const t = qe(i.state, i.pos);
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
			o.push(e), a.push(e);
		}
	}
	const i = (t) => {
		const e = [];
		let n = {
			state: t.state,
			pos: t.pos
		};
		for (;;) {
			const t = s.get(qe(n.state, n.pos));
			if (e.unshift({
				state: n.state,
				pos: n.pos,
				via: t ? t.via : null
			}), !t) break;
			n = t.from;
		}
		return e;
	};
	for (const { node: r, allow: c } of function(t) {
		const e = X();
		if ("cobuchi" === e) {
			const e = (t) => !W.accepts.has(t);
			return t.filter((t) => e(t.state)).map((t) => ({
				node: t,
				allow: e
			}));
		}
		if ("parity" === e) {
			const e = (t) => tt(G(t));
			return t.filter((t) => e(t.state) % 2 == 0).map((t) => {
				const n = e(t.state);
				return {
					node: t,
					allow: (t) => e(t) >= n
				};
			});
		}
		return t.filter((t) => W.accepts.has(t.state)).map((t) => ({
			node: t,
			allow: null
		}));
	}(o)) {
		const n = ze(t, e, r, c);
		if (n) return {
			accepted: !0,
			stem: i(r),
			loop: n,
			reason: null
		};
	}
	return {
		accepted: !1,
		stem: i(o[o.length - 1] || n),
		loop: [],
		reason: o.length > 1 ? "no-accepting-cycle" : "stuck"
	};
}
function Ue() {
	const t = function(t = W.transitions) {
		for (let e = 0; e < t.length; e++) for (let n = e + 1; n < t.length; n++) {
			const s = t[e], o = t[n];
			if (s.from === o.from && xt(s.symbol, o.symbol)) return [s, o];
		}
		return null;
	}(W.transitions);
	if (!t) return null;
	const e = G(t[0].from)?.name || t[0].from;
	return { refuse: `Nondeterministic overlap in ${W.machine} mode: ${e} has two moves on '${t[0].symbol}'. Switch to ${W.machine.replace(/^D/, "N")} to explore both branches.` };
}
function Ve() {
	const t = function() {
		const t = /* @__PURE__ */ new Map();
		for (const l of W.states) t.set(l.id, []);
		for (const l of W.transitions) t.has(l.from) && t.get(l.from).push(l.to);
		const e = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Set(), o = [];
		let a = 0, i = null;
		const r = (t) => {
			const e = t.filter((t) => W.accepts.has(t)).length;
			return e > 0 && e < t.length;
		}, c = (c) => {
			const l = [{
				v: c,
				i: 0
			}];
			for (e.set(c, a), n.set(c, a), a++, o.push(c), s.add(c); l.length;) {
				const c = l[l.length - 1], u = t.get(c.v) || [];
				if (c.i < u.length) {
					const t = u[c.i++];
					e.has(t) ? s.has(t) && n.set(c.v, Math.min(n.get(c.v), e.get(t))) : (e.set(t, a), n.set(t, a), a++, o.push(t), s.add(t), l.push({
						v: t,
						i: 0
					}));
					continue;
				}
				if (l.pop(), l.length) {
					const t = l[l.length - 1].v;
					n.set(t, Math.min(n.get(t), n.get(c.v)));
				}
				if (n.get(c.v) === e.get(c.v)) {
					const e = [];
					for (;;) {
						const t = o.pop();
						if (s.delete(t), e.push(t), t === c.v) break;
					}
					(e.length > 1 || (t.get(e[0]) || []).includes(e[0])) && !i && r(e) && (i = e);
				}
			}
		};
		for (const l of W.states) e.has(l.id) || c(l.id);
		return i;
	}();
	return t ? { warn: `Not a weak automaton: the cycle {${t.map((t) => G(t)?.name || t).join(", ")}} contains both accepting and non-accepting states. A weak condition needs every SCC to sit wholly inside F or wholly outside it. Running it as a Büchi automaton.` } : null;
}
const Ke = {
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
			error: `${W.machine} reads an infinite word. Write it as <em>u(v)</em> — a finite prefix followed by the repeating period in parentheses, e.g. <em>ab(ba)</em> or <em>(a)</em>.`
		};
		const n = Nt(e.prefix === W.config.sym.eps ? "" : e.prefix), s = Nt(e.period);
		return null === n || null === s ? {
			ok: !1,
			error: `Input cannot be tokenized using alphabet {${[...W.sigma].join(", ")}}.`
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
		const n = Je(t, e), s = n.accepted ? [
			...n.stem,
			...n.loop,
			...n.loop
		].slice(0, n.stem.length + 2 * n.loop.length) : n.stem, o = n.accepted ? n.stem.length - 1 : -1, a = Math.max(1, Math.ceil((s.length + 1) / Math.max(1, e.length)) + 1), i = [...t];
		for (let l = 0; l < a; l++) i.push(...e);
		const r = [...t, ...e];
		W.simSteps = s.map((a, c) => {
			const l = G(a.state)?.name || a.state, u = o >= 0 && c >= o;
			let h;
			if (0 === c) h = `Start: ${l}`;
			else {
				const t = G(s[c - 1].state)?.name || s[c - 1].state;
				h = `Read '${i[c - 1]}': ${t} → ${l}`;
			}
			return h += function(t) {
				const e = X();
				return "parity" === e ? ` · priority ${tt(G(t))}` : W.accepts.has(t) ? "cobuchi" === e ? " ✗ (in F — must stop recurring)" : " ✓ (accepting)" : "";
			}(a.state), u && (h += ` · loop iteration ${Math.floor((c - o) / Math.max(1, n.loop.length)) + 1}`), {
				state: a.state,
				tokens: r,
				tape: i,
				head: c,
				view: {
					kind: "tape",
					cells: i,
					head: c,
					origin: 0,
					leftBound: 0,
					rightBound: null,
					markers: [],
					blank: W.config.sym.blank,
					readOnly: !0,
					periodFrom: t.length,
					periodLen: e.length
				},
				tid: a.via?.id,
				omegaLoopFrom: o,
				note: h
			};
		});
		const c = W.simSteps[W.simSteps.length - 1];
		return c && (c.final = n.accepted ? "accept" : "reject", c.note += function(t) {
			const e = X(), n = t.loop.map((t) => G(t.state)?.name || t.state), s = [...new Set(n)].join(" → ");
			return t.accepted ? "cobuchi" === e ? ` — ACCEPT: the cycle ${s} repeats forever and never touches F again` : "parity" === e ? ` — ACCEPT: the cycle ${s} repeats forever and its least priority is ${Math.min(...t.loop.map((t) => tt(G(t.state))))}, which is even` : ` — ACCEPT: the cycle ${s} repeats forever and visits an accepting state each time` : "stuck" === t.reason ? " — REJECT: no run survives the ω-word" : "cobuchi" === e ? " — REJECT: every reachable cycle touches F, so no run can leave it behind for good" : "parity" === e ? " — REJECT: every reachable cycle has an odd least priority" : " — REJECT: every reachable cycle avoids F, so no run visits an accepting state infinitely often";
		}(n)), W.simIdx = 0, n;
	}(t, e),
	decide: ({ u: t, v: e }) => Xt(function(t, e) {
		return Je(t, e).accepted;
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
}, Ge = { schema: {
	...Ke.schema,
	stateFields: [
		"name",
		"start",
		"priority"
	]
} }, He = {
	conflict: (t, e) => se(t.from, t.symbol, e),
	say: (t) => `${W.machine} already has a move from ${oe(t.from)} on '${t.symbol}'. Switch to ${W.machine.replace(/^D/, "N")} if you want to branch on the same symbol.`
}, Ye = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → Q"
}, Ze = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → P(Q)"
};
function Xe(t, e) {
	return e === W.config.sym.eps || void 0 !== t && (e === t || e === W.config.sym.any);
}
function tn(t = W.machine) {
	return At(t);
}
function en(t = W.machine) {
	return Tt(t);
}
function nn(t, e = !1) {
	if (t && t.length) return Array.isArray(t) ? e ? t[0] : t[t.length - 1] : t.sym;
}
function sn(t, e = !1) {
	if (!t || !t.length) return W.config.sym.eps;
	const n = ue(t);
	return e ? n.join("") : [...n].reverse().join("");
}
function on(t, e, n) {
	const { eps: s, any: o } = W.config.sym;
	let a;
	e !== s && t.length && (a = t.sym, t = t.below);
	let i = n && n !== s ? n : "";
	i === o && (i = a || "");
	for (let r = i.length - 1; r >= 0; r--) t = re(t, i[r]);
	return t;
}
function an(t, e, n, s = !1) {
	const o = W.config.sym.eps, a = [...t];
	let i;
	e !== o && (i = s ? a.shift() : a.pop());
	let r = n && n !== o ? n : "";
	if (r === W.config.sym.any && (r = i || ""), r) {
		const t = r.split("");
		s ? t.forEach((t) => a.push(t)) : t.reverse().forEach((t) => a.push(t));
	}
	return a;
}
function rn(t) {
	const e = "explicit" === W.config.pdaParadigm ? [W.config.sym.stackBottom] : [], n = {
		sym: void 0,
		below: null,
		length: 0,
		size: 0,
		id: 0,
		kids: null,
		arr: null,
		trie: { next: 1 }
	}, s = {
		state: K(),
		tokens: t,
		pos: 0,
		stack: tn() ? [...e] : e.reduce((t, e) => re(t, e), n),
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	};
	return en() && (s.stack2 = e.reduce((t, e) => re(t, e), n)), s;
}
function cn() {
	const t = new jt(), e = Dt();
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
function ln(t) {
	return "explicit" === W.config.pdaParadigm ? W.accepts.has(t.state) && t.pos >= t.tokens.length : en() ? t.pos >= t.tokens.length && 0 === t.stack.length && 0 === (t.stack2 || []).length : t.pos >= t.tokens.length && 0 === t.stack.length;
}
function un(t) {
	const e = G(t.state)?.name || t.state, n = t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : W.config.sym.eps, s = sn(t.stack, tn());
	return en() ? `(${e}, ${n}, ${s}; ${sn(t.stack2 || [])})` : `(${e}, ${n}, ${s})`;
}
at(Ke, {
	DBA: {
		deterministicDelta: !0,
		determinism: He,
		guards: [Ue],
		formal: Ye
	},
	DcoBA: {
		deterministicDelta: !0,
		determinism: He,
		guards: [Ue],
		formal: Ye
	},
	DPA: {
		deterministicDelta: !0,
		determinism: He,
		guards: [Ue],
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
		...Ge
	},
	DWA: {
		deterministicDelta: !0,
		determinism: He,
		guards: [Ue, Ve],
		formal: Ye
	},
	NBA: {
		guards: [],
		formal: Ze
	},
	NcoBA: {
		guards: [],
		formal: Ze
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
		...Ge
	},
	NWA: {
		guards: [Ve],
		formal: Ze
	}
});
const hn = Symbol("end of input");
function pn() {
	const t = /* @__PURE__ */ new Map(), e = tn(), n = en(), s = (t, e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = /* @__PURE__ */ new Map()), n;
	};
	return (o) => {
		const a = o.pos < o.tokens.length ? o.tokens[o.pos] : hn;
		let i = s(s(t, o.state), a);
		n && (i = s(i, nn(o.stack2 || [])));
		const r = nn(o.stack, e);
		let c = i.get(r);
		return void 0 === c && i.set(r, c = function(t) {
			const { eps: e, any: n } = W.config.sym, s = nn(t.stack, tn()), o = en(), a = o ? nn(t.stack2 || []) : void 0, i = t.pos < t.tokens.length, r = i ? t.tokens[t.pos] : void 0, c = [];
			for (const l of Lt(t.state)) {
				const t = l.symbol;
				(t === e || i && (t === r || t === n)) && Xe(s, l.pop) && (o && !Xe(a, l.pop2 || e) || c.push(l));
			}
			return c;
		}(o)), c;
	};
}
function fn() {
	const t = "explicit" === W.config.pdaParadigm, e = en(), n = W.accepts;
	return t ? (t) => t.pos >= t.tokens.length && n.has(t.state) : (t) => t.pos >= t.tokens.length && 0 === t.stack.length && (!e || 0 === (t.stack2 || []).length);
}
function dn(t, e, n = t.branch) {
	const s = W.config.sym.eps, o = e.pop || s, a = e.push || s, i = {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		stack: Array.isArray(t.stack) ? an(t.stack, o, a, tn()) : on(t.stack, o, a),
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
	if (void 0 !== t.stack2) {
		const n = e.pop2 || s, o = e.push2 || s;
		i.stack2 = Array.isArray(t.stack2) ? an(t.stack2, n, o, !1) : on(t.stack2, n, o);
	}
	return i;
}
function mn(t, e) {
	const n = e.via, s = G(t.state)?.name || t.state, o = G(e.state)?.name || e.state, a = n?.symbol || W.config.sym.eps, i = n?.pop || W.config.sym.eps, r = n?.push || W.config.sym.eps, c = n?.pop2 || W.config.sym.eps, l = n?.push2 || W.config.sym.eps;
	return en() ? `Branch ${e.branch} depth ${e.depth}: (${s}, ${a}, ${i}/${c}) → (${o}, ${r}/${l})` : `Branch ${e.branch} depth ${e.depth}: (${s}, ${a}, ${i}) → (${o}, ${r})`;
}
function gn(t, e = null, n = "") {
	const s = t.map((e, n) => {
		const s = {
			state: e.state,
			tokens: e.tokens,
			pos: e.pos,
			stackRef: e.stack,
			branch: e.branch,
			tid: e.via?.id,
			note: 0 === n ? "Start configuration" : mn(t[n - 1], e)
		};
		return void 0 !== e.stack2 && (s.stackRef2 = e.stack2), void 0 !== e.outNode && (s.outNode = e.outNode, s.outSoFar = e.outRaw), Me(s);
	});
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function bn(t, e, n, s) {
	const o = {
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		stackRef: e.stack,
		branch: e.branch,
		note: s,
		final: n
	};
	void 0 !== e.stack2 && (o.stackRef2 = e.stack2), t.push(Me(o));
}
function yn(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, o = e.tree || null, a = rn(t), i = new Ft([a]), r = cn(), c = fn(), l = pn();
	r(a), o && o.root(a.state, a);
	const u = [];
	let h = null, p = 0, f = 0, d = a, m = 2;
	for (; i.length && p < W.config.maxPdaSteps;) {
		const t = i.shift();
		d = t, p++, f = Math.max(f, t.depth);
		const e = u.length < n, s = e ? G(t.state)?.name || t.state : "", a = e ? un(t) : "";
		if (c(t)) {
			h = t, o && o.accept(t.tn), e && u.push(`<span class="step-acc">Branch ${t.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${t.depth}.<br>ID: ${a}</span>`);
			break;
		}
		const g = l(t);
		if (!g.length) {
			o && o.expandCfgs(t, []), e && u.push(`Branch ${t.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${a}.<br>Depth ${t.depth}</span>`);
			continue;
		}
		e && wn(u, t, s, a, g);
		const b = o && !o.full ? [] : null;
		g.forEach((e, n) => {
			const s = 1 === g.length || 0 === n ? t.branch : m++, o = dn(t, e, s), a = r(o);
			a && i.push(o), b && b.push({
				cfg: o,
				fresh: a
			});
		}), b && o.expandCfgs(t, b);
	}
	return o && o.finish((h || d).tn ?? -1), {
		accepted: !!h,
		branches: p,
		maxDepth: f,
		log: u,
		witnessPath: s ? ne(h || d) : null,
		finalCfg: h || d,
		unresolved: !h && i.length > 0
	};
}
function wn(t, e, n, s, o) {
	const a = e.tokens[e.pos] || W.config.sym.eps, i = nn(e.stack, tn()), r = At() ? "Queue front" : "Stack top", c = [
		`State "${n}" with next input '${a}'`,
		`Depth ${e.depth} · ${r} ${i || W.config.sym.eps}`,
		`ID: ${s}`
	];
	Tt() && c.push(`Second stack top ${nn(e.stack2 || []) || W.config.sym.eps}`), o.length > 1 && c.push(`Nondeterministic choice: ${o.length} matching transitions.`), t.push(`Branch ${e.branch}: exploring <em>${n}</em><span class="step-sub">${c.join("<br>")}</span>`);
}
function kn(t, e, n) {
	const s = dn(t, e, n), o = e.output ?? "";
	return s.outRaw = (t.outRaw || "") + o, s.outKey = le(t.outKey, o), s.outNode = ie(t.outNode, "" === o ? W.config.sym.lambda : o), s;
}
function vn(t, e = null) {
	const n = rn(t);
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
	const s = new Ft([n]), o = cn(), a = fn(), i = pn();
	o(n), e && e.root(n.state, n);
	const r = /* @__PURE__ */ new Set();
	let c = null, l = null, u = n, h = 0, p = 0, f = 2;
	for (; s.length && h < W.config.maxPdaSteps;) {
		const t = s.shift();
		u = t, h++, p = Math.max(p, t.depth);
		const n = a(t);
		t.pos >= t.tokens.length && (ee(!0, n) && r.add(t.outRaw), l || (l = t)), n && !c && (c = t), n && e && e.accept(t.tn);
		const d = i(t), m = e && !e.full ? [] : null;
		d.forEach((e, n) => {
			const a = 1 === d.length || 0 === n ? t.branch : f++, i = kn(t, e, a), r = o(i);
			r && s.push(i), m && m.push({
				cfg: i,
				fresh: r
			});
		}), m && e.expandCfgs(t, m);
	}
	const d = c || l || u;
	return e && e.finish(d.tn ?? -1), {
		accepted: !!c,
		outputs: r,
		witnessPath: ne(d),
		finalCfg: d,
		unresolved: !c && s.length > 0,
		branches: h,
		maxDepth: p
	};
}
const $n = {
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
}, Sn = () => "explicit" === W.config.pdaParadigm ? [
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
], An = {
	...$n,
	deterministicDelta: !0,
	determinism: {
		conflict: (t, e) => function(t, e = W.transitions, n = null) {
			return e.find((e) => {
				return e.id !== n && (o = t, (s = e).from === o.from && function(t, e, n = W.config.sym.eps, s = W.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.symbol, o.symbol) && function(t, e, n = W.config.sym.eps, s = W.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.pop, o.pop));
				var s, o;
			}) || null;
		}({
			from: t.from,
			symbol: t.symbol,
			pop: t.pop
		}, W.transitions, e),
		say: (t) => `DPDA already has an overlapping move from ${oe(t.from)}. Switch to NPDA mode if you want branching on the same configuration.`
	},
	simulate: function(t) {
		const e = rn(t);
		if (ln(e)) return W.simSteps = gn([e], "accept"), W.simIdx = 0, { accepted: !0 };
		let n = e;
		const s = cn(), o = fn(), a = pn();
		s(n);
		for (let i = 0; i < W.config.maxPdaSteps; i++) {
			const t = a(n);
			if (t.length > 1) return W.simSteps = gn(ne(n)), bn(W.simSteps, n, "reject", "Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches."), W.simIdx = 0, { accepted: !1 };
			if (!t.length) return W.simSteps = gn(ne(n)), bn(W.simSteps, n, "reject", "No valid transition from this configuration — REJECT"), W.simIdx = 0, { accepted: !1 };
			const e = dn(n, t[0], n.branch);
			if (!s(e)) return W.simSteps = gn(ne(n)), bn(W.simSteps, n, "reject", "Repeated configuration detected — possible ε-loop — REJECT"), W.simIdx = 0, { accepted: !1 };
			if (n = e, o(n)) return W.simSteps = gn(ne(n), "accept"), W.simIdx = 0, { accepted: !0 };
		}
		return W.simSteps = gn(ne(n)), bn(W.simSteps, n, "reject", "PDA step limit reached — REJECT"), W.simIdx = 0, { accepted: !1 };
	},
	decide: (t) => Xt(function(t) {
		let e = rn(t);
		if (ln(e)) return !0;
		const n = cn(), s = fn(), o = pn();
		n(e);
		for (let a = 0; a < W.config.maxPdaSteps; a++) {
			const t = o(e);
			if (1 !== t.length) return !1;
			const a = dn(e, t[0], e.branch);
			if (!n(a)) return !1;
			if (e = a, s(e)) return !0;
		}
		return !1;
	}(t))
}, Tn = {
	...$n,
	simulate: function(t) {
		const e = yn(t, { tree: null });
		return e.accepted ? W.simSteps = gn(e.witnessPath, "accept") : (W.simSteps = gn(e.witnessPath), bn(W.simSteps, e.finalCfg, "reject", e.unresolved ? `Exploration limit ${W.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT")), Ne(W.simSteps, null), W.simIdx = 0, {
			accepted: e.accepted,
			branches: e.branches,
			maxDepth: e.maxDepth,
			log: e.log,
			witnessLength: e.witnessPath.length
		};
	},
	branches: !0,
	decide: (t) => Xt(function(t) {
		return yn(t, {
			log: 0,
			witness: !1
		}).accepted;
	}(t))
};
function xn(t) {
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
function Mn(t) {
	const e = W.config.sym.eps, n = String(null == t ? "" : t).trim();
	return n && n !== e ? n.split("|").map((t) => t.trim()).filter((t) => t && t !== e).map((t) => xn(t).reverse()) : [];
}
function En(t) {
	return !(t.pos < t.tokens.length) && ("explicit" === W.config.pdaParadigm ? W.accepts.has(t.state) : 1 === t.store.length && 0 === t.store.sym.length);
}
function Nn(t) {
	const e = W.config.sym.eps, n = W.config.sym.any, s = t.store.sym.sym;
	return Lt(t.state).filter((o) => (o.symbol === e || t.pos < t.tokens.length && (o.symbol === t.tokens[t.pos] || o.symbol === n)) && function(t, e) {
		const { eps: n, any: s } = W.config.sym;
		return e === n || void 0 !== t && (e === t || e === s);
	}(s, o.pop || e));
}
function Pn(t, e, n = t.branch) {
	const { eps: s, any: o } = W.config.sym, a = t.ctx;
	let i, r = t.store.sym;
	(e.pop || s) !== s && r.length && (i = r.sym, r = r.below);
	let c = e.push && e.push !== s ? e.push : "";
	if (c === o && (c = i || ""), c) {
		const t = function(t, e) {
			let n = t.pushes.get(e);
			return n || t.pushes.set(e, n = xn(e)), n;
		}(a, c);
		for (let e = t.length - 1; e >= 0; e--) r = re(r, t[e]);
	}
	let l = t.store.below;
	for (const u of Cn(a, e.below)) l = re(l, u);
	l = re(l, r);
	for (const u of Cn(a, e.above)) l = re(l, u);
	for (; l.length > 1 && 0 === l.sym.length;) l = l.below;
	return {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		store: l,
		ctx: a,
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
}
function Cn(t, e) {
	const n = e ?? "";
	let s = t.lists.get(n);
	return s || (s = Mn(e).map((e) => e.reduce((t, e) => re(t, e), t.inner)), t.lists.set(n, s)), s;
}
function Fn(t) {
	return `(${G(t.state)?.name || t.state}, ${t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : W.config.sym.eps}, ${function(t) {
		const e = W.config.sym.eps;
		return t.length ? t.map((t) => {
			return t.length ? (n = [...t].reverse()).some((t) => String(t).length > 1) ? n.join(" ") : n.join("") : e;
			var n;
		}).join(" | ") : e;
	}((e = t.store, Array.isArray(e) ? e : ce(e).map(ce)))})`;
	var e;
}
function jn(t, e) {
	const n = e.via, s = W.config.sym.eps, o = G(t.state)?.name || t.state, a = G(e.state)?.name || e.state, i = [`(${o}, ${n?.symbol || s}, ${n?.pop || s}) → (${a}, ${n?.push || s}`], r = Mn(n?.below), c = Mn(n?.above);
	return r.length && i.push(`, ${r.length} below`), c.length && i.push(`, ${c.length} above`), i.push(")"), `Branch ${e.branch} depth ${e.depth}: ${i.join("")} · ${e.store.length} stack${1 === e.store.length ? "" : "s"}`;
}
function Dn(t, e = null, n = "") {
	const s = t.map((e, n) => Ee({
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		storeRef: e.store,
		branch: e.branch,
		tid: e.via?.id,
		note: 0 === n ? "Start configuration" : jn(t[n - 1], e)
	}));
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function Rn(t, e) {
	return t.length <= e.stacks && t.size <= e.symbols;
}
function On(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, o = e.tree || null, a = function(t) {
		const e = {
			sym: void 0,
			below: null,
			length: 0,
			size: 0,
			id: 0,
			kids: null,
			arr: null,
			trie: { next: 1 }
		}, n = "explicit" === W.config.pdaParadigm ? re(e, W.config.sym.stackBottom) : e;
		return {
			state: K(),
			tokens: t,
			pos: 0,
			store: re({
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
	}(t), i = new Ft([a]), r = new jt(), c = Dt(), l = (t) => r.add(c(t.state), t.pos, t.store.id, -1, -1);
	l(a), o && o.root(a.state, a);
	const u = [];
	let h = null, p = 0, f = 0, d = 1, m = a, g = 2;
	const b = function(t = []) {
		const e = t.length + 2;
		return {
			stacks: e + 4,
			symbols: 16 * (e + 4)
		};
	}(t);
	let y = !1;
	for (; i.length && p < W.config.maxPdaSteps;) {
		const t = i.shift();
		m = t, p++, f = Math.max(f, t.depth), d = Math.max(d, t.store.length);
		const e = u.length < n;
		if (En(t)) {
			h = t, o && o.accept(t.tn), e && u.push(`<span class="step-acc">Branch ${t.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${t.depth}.<br>ID: ${Fn(t)}</span>`);
			break;
		}
		const s = Nn(t);
		if (!s.length) {
			o && o.expandCfgs(t, []), e && u.push(`Branch ${t.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${Fn(t)}.<br>Depth ${t.depth}</span>`);
			continue;
		}
		if (e) {
			const e = G(t.state)?.name || t.state, n = [
				`State "${e}" with next input '${t.tokens[t.pos] || W.config.sym.eps}'`,
				`Depth ${t.depth} · ${t.store.length} stack${1 === t.store.length ? "" : "s"} · top ${t.store.sym.sym || W.config.sym.eps}`,
				`ID: ${Fn(t)}`
			];
			s.length > 1 && n.push(`Nondeterministic choice: ${s.length} matching transitions.`), u.push(`Branch ${t.branch}: exploring <em>${e}</em><span class="step-sub">${n.join("<br>")}</span>`);
		}
		const a = o && !o.full ? [] : null;
		s.forEach((e, n) => {
			const o = 1 === s.length || 0 === n ? t.branch : g++, r = Pn(t, e, o);
			if (!Rn(r.store, b)) return void (y = !0);
			const c = l(r);
			c && i.push(r), a && a.push({
				cfg: r,
				fresh: c
			});
		}), a && o.expandCfgs(t, a);
	}
	return o && o.finish((h || m).tn ?? -1), {
		accepted: !!h,
		branches: p,
		maxDepth: f,
		maxStacks: d,
		log: u,
		capped: y,
		witnessPath: s ? ne(h || m) : null,
		finalCfg: h || m,
		unresolved: !h && (i.length > 0 || y)
	};
}
at($n, {
	DPDA: {
		...An,
		formal: {
			tuple: Sn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	PDA: {
		...An,
		formal: {
			tuple: Sn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	NPDA: {
		...Tn,
		formal: {
			tuple: Sn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Γ*)"
		}
	},
	QA: {
		...Tn,
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
		...Tn,
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
		...Tn,
		schema: {
			...$n.schema,
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
		...$n,
		simulate: function(t) {
			const e = vn(t, null), n = W.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, o = n ? e.accepted ? "Accepting run found" : e.unresolved ? `Exploration limit ${W.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting run found" : "";
			W.simSteps = gn(e.witnessPath, s, o);
			const a = W.simSteps[W.simSteps.length - 1];
			if (a) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? a.note += ` | Output: "${t[0]}"` : a.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : a.note += " | Output: \"\"";
			}
			return Ne(W.simSteps, null), W.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = vn(t), n = [...e.outputs];
				return {
					accepted: e.accepted,
					output: n.length ? n[0] : "",
					outputs: n
				};
			}(t);
			return te(e.accepted, e.output);
		},
		schema: {
			...$n.schema,
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
const Qn = {
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
ot("EPDA", {
	branches: !0,
	...Qn,
	storeLabels: [
		"Stack of stacks",
		"Pop",
		"Push"
	],
	schema: {
		...Qn.schema,
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
		const e = On(t, { tree: null });
		var n, s, o;
		return e.accepted ? W.simSteps = Dn(e.witnessPath, "accept") : (W.simSteps = Dn(e.witnessPath), n = W.simSteps, s = e.finalCfg, o = e.unresolved ? `Exploration limit ${W.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", n.push(Ee({
			state: s.state,
			tokens: s.tokens,
			pos: s.pos,
			storeRef: s.store,
			branch: s.branch,
			note: o,
			final: "reject"
		}))), Ne(W.simSteps, null), W.simIdx = 0, e;
	},
	decide: (t) => function(t) {
		const e = On(t, {
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
		tuple: () => "explicit" === W.config.pdaParadigm ? [
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
const Bn = 2147483647, In = 2147483629, _n = 911382323, Ln = 972663749;
function Wn(t, e, n) {
	return (t * Math.floor(e / 65536) % n * 65536 + t * (e % 65536)) % n;
}
function qn(t, e, n) {
	let s = 1;
	for (t %= n; e > 0;) e % 2 == 1 && (s = Wn(s, t, n)), t = Wn(t, t, n), e = Math.floor(e / 2);
	return s;
}
const zn = /* @__PURE__ */ new Map(), Jn = [[1], [1]];
function Un(t) {
	if (t >= 0 && t < 1048576) {
		const e = Jn[0], n = Jn[1];
		for (; e.length <= t;) e.push(Wn(e[e.length - 1], _n, Bn)), n.push(Wn(n[n.length - 1], Ln, In));
		return Vn[0] = e[t], Vn[1] = n[t], Vn;
	}
	let e = zn.get(t);
	if (e) return e;
	zn.size > 65536 && zn.clear();
	const n = (t % 2147483628 + 2147483628) % 2147483628;
	return e = [qn(_n, (t % 2147483646 + 2147483646) % 2147483646, Bn), qn(Ln, n, In)], zn.set(t, e), e;
}
const Vn = [1, 1], Kn = /* @__PURE__ */ new Map(), Gn = {
	off: 0,
	h1: 0,
	h2: 0
};
function Hn(t, e) {
	return void 0 === t || t === e ? null : function(t) {
		let e = Kn.get(t);
		if (e) return e;
		let n = 2166136261;
		for (let s = 0; s < t.length; s++) n = Math.imul(n ^ t.charCodeAt(s), 16777619) >>> 0;
		return e = [1 + n % 2147483646, 1 + (Math.imul(n ^ n >>> 15, 2246822519) >>> 0) % 2147483628], Kn.set(t, e), e;
	}(String(t));
}
function Yn(t, e, n, s) {
	if (n === s) return;
	let o = (s ? s[0] : 0) - (n ? n[0] : 0), a = (s ? s[1] : 0) - (n ? n[1] : 0);
	o < 0 && (o += Bn), a < 0 && (a += In);
	const i = Un(e - t.lo);
	t.h1 = (t.h1 + Wn(o, i[0], Bn)) % Bn, t.h2 = (t.h2 + Wn(a, i[1], In)) % In;
}
function Zn(t) {
	let e = 1 / 0;
	for (const n of t.keys()) n < e && (e = n);
	return e;
}
var Xn = class t {
	constructor(t = [], e = "⊔", n = !1, s = {}) {
		this.blank = e, this.twoWay = !!n, this.rightBound = s.rightBound ?? null, this.immutable = s.immutable || null, this.head = 0, this.cells = /* @__PURE__ */ new Map(), t.forEach((t, e) => this.cells.set(e, t));
	}
	read() {
		return this.cells.has(this.head) ? this.cells.get(this.head) : this.blank;
	}
	write(t) {
		if (this.immutable && this.immutable.has(this.read())) return !1;
		const e = this._fp, n = e ? Hn(this.cells.get(this.head), this.blank) : null;
		return t === this.blank ? this.cells.delete(this.head) : this.cells.set(this.head, t), e && (Yn(e, this.head, n, Hn(t, this.blank)), t !== this.blank ? this.head < e.min && (e.min = this.head) : this.head === e.min && (e.min = Zn(this.cells))), !0;
	}
	trackFingerprint() {
		const t = {
			h1: 0,
			h2: 0,
			min: Zn(this.cells),
			lo: 0
		};
		for (const [e, n] of this.cells) Yn(t, e, null, Hn(n, this.blank));
		return this._fp = t, this;
	}
	fingerprint() {
		const t = this.fingerprintParts();
		return `${t.off}|${t.h1}|${t.h2}`;
	}
	fingerprintParts() {
		const t = this._fp, e = this.twoWay ? Math.min(this.head, t.min) : 0;
		if (e !== t.lo) {
			const n = Un(t.lo - e);
			t.h1 = Wn(t.h1, n[0], Bn), t.h2 = Wn(t.h2, n[1], In), t.lo = e;
		}
		const n = Gn;
		return n.off = this.head - e, n.h1 = t.h1, n.h2 = t.h2, n;
	}
	move(t) {
		const e = "R" === t ? 1 : "L" === t ? -1 : 0, n = this.head + e;
		return !(!this.twoWay && n < 0 || null !== this.rightBound && n > this.rightBound || (this.head = n, 0));
	}
	snapshot() {
		let t = this.head, e = this.head;
		for (const a of this.cells.keys()) a < t && (t = a), a > e && (e = a);
		const n = this.twoWay ? t : 0, s = null !== this.rightBound ? this.rightBound : Math.max(e, n), o = [];
		for (let a = n; a <= s; a++) o.push(this.cells.has(a) ? this.cells.get(a) : this.blank);
		return {
			tape: o,
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
function ts(t, e) {
	return `${t}|${e.map((t) => t.key()).join("")}`;
}
const es = () => !0, ns = (t) => "R" === t ? 1 : "L" === t ? -1 : 0;
function* ss({ log: t, cols: e, fires: n, blank: s, twoWay: o, n: a, state: i, via: r, head: c, last: l, want: u }) {
	const h = t.appender(), { live: p, heads: f, reads: d, writes: m, syms: g, blankCode: b } = h, { states: y, tids: w, stateCol: k, tidCol: v } = e.appender(), $ = g.values, S = (t) => null == t ? 0 : w.code(t), A = [], T = /* @__PURE__ */ new Map(), x = [], M = [];
	function E(t) {
		let e = T.get(t);
		return void 0 === e && (e = A.length, T.set(t, e), A.push(t), x.push(-1), M.push(W.accepts.has(t) ? 1 : 0)), e;
	}
	let N, P, C, F, j, D, R, O = 3, Q = 8;
	function B() {
		const t = Q << O;
		N = new Int32Array(t).fill(-2), P = new Int32Array(t), C = new Int8Array(t), F = new Int32Array(t), j = new Array(t), D = new Array(t), R = [];
	}
	function I(t, e) {
		if (!(t < Q && e < 1 << O)) {
			for (; t >= Q;) Q *= 2;
			for (; e >= 1 << O;) O++;
			B();
		}
	}
	B();
	let _ = W.config.sym.any;
	const L = (t, e) => null === t ? null === e : null !== e && t.to === e[0] && t.write === e[1] && t.dir === e[2] && t.id === e[3];
	function q(t, e) {
		const o = n(A[t], $[e]) ?? null;
		let a = -1, i = -1, r = 0, c = 0;
		o && (a = E(o.to), i = o.write && o.write !== _ ? o.write === s ? 0 : g.code(o.write) : -1, r = ns(o.dir), c = S(o.id)), I(Math.max(t, a), Math.max(e, i));
		const l = t << O | e;
		return N[l] = a, P[l] = i, C[l] = r, F[l] = c, j[l] = o, D[l] = ((t) => t ? [
			t.to,
			t.write,
			t.dir,
			t.id
		] : null)(o), R.push(l), a;
	}
	function z() {
		for (let e = 0; e < A.length; e++) M[e] = W.accepts.has(A[e]) ? 1 : 0;
		let t = W.config.sym.any !== _;
		for (let e = 0; !t && e < R.length; e++) {
			const n = R[e];
			t = !L(j[n], D[n]);
		}
		t && (_ = W.config.sym.any, B());
	}
	let J = E(i), U = c, V = a, K = S(r), G = null, H = 0, Y = 0, Z = null;
	const X = 4096, tt = new Int32Array(X), et = new Uint32Array(X), nt = new Uint32Array(X), st = new Uint32Array(X), ot = new Uint32Array(X);
	function at(t) {
		0 !== t && (f.pushMany(tt, t), d.pushMany(et, t), m.pushMany(nt, t), k.pushMany(st, t), v.pushMany(ot, t));
	}
	function it(t) {
		let e = J, n = U, s = V, a = K, i = h.nextCheckpoint, r = O, c = N, l = P, u = C, f = F, d = 0, m = 0;
		const g = tt, w = et, k = nt, v = st, $ = ot, S = x, T = M, E = b, D = o;
		let R = p.buf, B = p.base, _ = R.length;
		for (G = null;;) {
			m === X && (at(m), m = 0), s >= i && (i = h.checkpoint(s));
			const o = n - B, b = o >= 0 && o < _ ? R[o] : 0, x = 0 === b ? E : b;
			g[m] = n, w[m] = x;
			let M = S[e];
			if (M < 0 && (M = S[e] = y.code(A[e])), v[m] = M, $[m] = a, d++, 1 === T[e]) {
				k[m++] = 0, G = "accept";
				break;
			}
			(e >= Q || x >= 1 << r) && (I(e, x), r = O, c = N, l = P, u = C, f = F);
			let L = e << r | x, W = c[L];
			if (-2 === W && (W = q(e, x), r = O, c = N, l = P, u = C, f = F, L = e << r | x), -1 === W) {
				k[m++] = 0, G = "reject";
				break;
			}
			if (d === t) {
				k[m++] = 0, H = b, Y = x, Z = j[L];
				break;
			}
			const z = l[L], J = -1 === z ? x === E ? 0 : x : z;
			k[m++] = 0 === J ? 1 : J + 1, b === E && h.undoException(s, b), J !== b && (p.set(n, J), R = p.buf, B = p.base, _ = R.length), a = f[L], e = W;
			const U = u[L];
			(D || n + U >= 0) && (n += U), s++;
		}
		return at(m), J = e, U = n, V = s, K = a, d;
	}
	function rt() {
		const t = V;
		t >= h.nextCheckpoint && h.checkpoint(t);
		const e = p.get(U), s = 0 === e ? b : e;
		f.push(U), d.push(s);
		let o = x[J];
		if (o < 0 && (o = x[J] = y.code(A[J])), k.push(o), v.push(K), m.push(0), G = null, W.accepts.has(A[J])) return G = "accept", 1;
		const a = n(A[J], $[s]) ?? null;
		return a ? (H = e, Y = s, Z = a, 1) : (G = "reject", 1);
	}
	function lt() {
		const t = Z, e = $[Y], n = t.write && t.write !== W.config.sym.any ? t.write : e, a = n === s ? 0 : g.code(n);
		m.set(V, 0 === a ? 1 : a + 1), H === b && h.undoException(V, H), p.set(U, a), K = S(t.id), J = E(t.to);
		const i = ns(t.dir);
		(o || U + i >= 0) && (U += i), V++;
	}
	for (;;) {
		const t = W.config.maxTmSteps;
		if (V >= t) return void (l && !l.final && Ht(l));
		const n = Math.min(u >= 1 ? u : 1, t - V);
		let s;
		1 === n ? s = rt() : (z(), s = it(n));
		const o = e.at(V);
		if ("accept" === G ? (o.final = "accept", o.note += " — ACCEPT") : "reject" === G && (o.final = "reject", o.note += " — REJECT"), l = o, u = yield 1 === s ? o : ct(s, o, e.at), G) return;
		lt();
	}
}
var os = class t {
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
		let o = s;
		for (let a = t.length - 1; a >= 1; a--) o = re(o, t[a]);
		this.right = o;
	}
	read() {
		return this.cell;
	}
	write(t) {
		return this.cell = t, !0;
	}
	move(t) {
		if ("R" === t) {
			!this.left.length && this.cell === this.blank && this.twoWay || (this.left = re(this.left, this.cell));
			const t = this.right;
			return this.cell = t.length ? t.sym : this.blank, t.length && (this.right = t.below), this.head++, !0;
		}
		if ("L" === t) {
			if (!this.twoWay && 0 === this.head) return !1;
			(this.right.length || this.cell !== this.blank) && (this.right = re(this.right, this.cell));
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
		const t = ce(this.left).slice();
		t.push(this.cell);
		const e = ce(this.right);
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
function as(t, e) {
	return (n, s) => `State:${G(s.stateAt(n))?.name} Read:'${t.readAt(n)}'${e ? ` @${t.headAt(n)}` : ""}`;
}
function* is(t) {
	const e = W.config.sym.blank, n = Y(), s = new Xn(t, e, n).trackFingerprint(), o = bt(s), a = $t([o], t, as(o, n));
	let i = K(), r = null;
	const c = Ut(), l = Wt();
	let u = null;
	const h = (o) => ds(() => new Xn(t, e, n), o) === (u ??= `${i}|${s.key()}`);
	let p = null, f = 0, d = 1;
	for (; f < W.config.maxTmSteps; f++) {
		if (!c.verifying && es()) return yield* ss({
			log: o,
			cols: a,
			fires: l,
			blank: e,
			twoWay: n,
			n: f,
			state: i,
			via: r,
			head: s.head,
			last: p,
			want: d
		});
		const t = s.read(), m = o.begin(s.head, t);
		if (p = a.step(m, i, r), W.accepts.has(i)) return p.final = "accept", p.note += " — ACCEPT", void (yield p);
		u = null;
		const g = s.fingerprintParts(), b = c.seenAtVerified(i, g.off, g.h1, g.h2, f, h);
		if (b >= 0) return Gt(p, b), void (yield p);
		const y = l(i, t);
		if (!y) return p.final = "reject", p.note += " — REJECT", void (yield p);
		d = yield p;
		const w = s.head;
		s.write(y.write && y.write !== W.config.sym.any ? y.write : t), o.noteWrite(m, w, s.cells), i = y.to, r = y.id, s.move(y.dir);
	}
	p && !p.final && Ht(p);
}
function rs(t) {
	Et(is(t));
}
function cs(t) {
	const e = W.config.sym.blank, n = Y();
	if (os.fits(t, e)) {
		const s = new jt(), o = Dt(), a = Dt();
		return {
			start: new os(t, e, n),
			seen: (t, e) => s.add(o(t), e.left.id, a(e.cell), e.right.id, 0)
		};
	}
	const s = /* @__PURE__ */ new Set();
	return {
		start: new Xn(t, e, n),
		seen: (t, e) => {
			const n = `${t}|${e.key()}`;
			return !s.has(n) && (s.add(n), !0);
		}
	};
}
function ls() {
	const t = W.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let o = e.get(n);
		void 0 === o && e.set(n, o = /* @__PURE__ */ new Map());
		let a = o.get(s);
		return void 0 === a && o.set(s, a = Lt(n).filter((e) => e.symbol === s || e.symbol === t)), a;
	};
}
const us = {
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
function* hs(t) {
	const { start: e, seen: n } = cs(t), s = ls(), a = new Ft([{
		state: K(),
		tape: e,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}]);
	n(K(), e);
	let c = !1, l = 0, u = 0;
	const h = [];
	let p = 2, f = null;
	for (; a.length && l < W.config.maxTmSteps;) {
		const e = a.shift(), { state: o, depth: d, branch: m } = e, g = e.tape.read(), b = G(o)?.name || o, y = h.length < 10, w = y ? e.tape.snapshot() : null, k = y ? Yt(o, w.tape, w.head) : "";
		l++, u = Math.max(u, d);
		const v = Object.assign(Object.create(us), {
			state: o,
			tokens: t,
			_tape: e.tape,
			branch: m,
			parent: e.parent,
			via: e.via,
			depth: d,
			tn: e.tn ?? -1,
			note: `Branch ${m} depth ${d}: ${b} reads '${g}'`
		});
		if (W.accepts.has(o)) {
			e.tn, v.final = "accept", v.note += " — ACCEPT", f = v, yield v, y && h.push(`<span class="step-acc">Branch ${m}: ACCEPT ✓</span><span class="step-sub">State "${b}" is accepting.<br>Depth ${d} · ID: ${k}</span>`), c = !0;
			break;
		}
		const $ = s(o, g);
		if (!$.length) {
			v.note += " — dead branch", f = v, yield v, y && h.push(`Branch ${m}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches (${b}, '${g}').<br>Depth ${d} · ID: ${k}</span>`);
			continue;
		}
		if (v.note += $.length > 1 ? ` — branching ×${$.length}` : " — deterministic step", f = v, yield v, y) {
			const t = [`Read '${g}' at head position ${e.tape.twoWay ? e.tape.head : w.head}.`, `Depth ${d} · ID: ${k}`];
			$.length > 1 && t.push(`Nondeterministic choice: ${$.length} matching transitions.`), h.push(`Branch ${m}: exploring <em>${b}</em><span class="step-sub">${t.join("<br>")}</span>`);
		}
		$.forEach((t) => {
			const s = e.tape.clone();
			if (s.write(t.write && t.write !== W.config.sym.any ? t.write : g), s.move(t.dir), !n(t.to, s)) return void 0;
			const o = {
				state: t.to,
				tape: s,
				depth: d + 1,
				branch: p++,
				parent: m,
				via: t.id
			};
			a.push(o);
		});
	}
	if (!c) {
		const n = a.length > 0, s = n ? `NO VERDICT: exploration limit ${W.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", o = f?.tape || e.snapshot().tape, i = f?.head ?? 0;
		yield {
			state: f?.state || K(),
			tokens: t,
			tape: [...o],
			head: i,
			note: s,
			final: n ? "timeout" : "reject",
			limit: n ? W.config.maxTmSteps : void 0
		}, h.push(`${a.length ? "Exploration limit reached" : "Reject"}<span class="step-sub">${s}.<br>Branches explored: ${l} · max depth ${u}</span>`);
	}
	return {
		accepted: c,
		branches: l,
		maxDepth: u,
		log: h
	};
}
function ps(t, e, n, s) {
	const o = Array.isArray(e) ? null : Array.isArray(e?.tapes) ? e.tapes : null;
	return o ? Array.from({ length: t }, (t, e) => new Xn(o[e] || [], n, s)) : function(t, e, n, s) {
		return Array.from({ length: t }, (t, o) => new Xn(0 === o ? e : [], n, s));
	}(t, Array.isArray(e) ? e : [], n, s);
}
function fs(t, e, n) {
	const s = W.config.sym.any;
	for (let o = 0; o < t.length; o++) {
		const a = e.tapeWrites?.[o];
		t[o].write(a && a !== s ? a : n[o]);
	}
	for (let o = 0; o < t.length; o++) t[o].move(e.tapeDirs?.[o]);
}
function ds(t, e) {
	const n = W.config.sym.any, s = t(), o = Wt();
	let a = K();
	for (let i = 0; i < e; i++) {
		const t = s.read(), e = o(a, t);
		if (!e) break;
		s.write(e.write && e.write !== n ? e.write : t), s.move(e.dir), a = e.to;
	}
	return `${a}|${s.key()}`;
}
function ms(t, e, n) {
	const s = ps(t, e, W.config.sym.blank, Y()), o = Jt();
	let a = K();
	for (let i = 0; i < n; i++) {
		const t = s.map((t) => t.read()), e = o(a, t);
		if (!e) break;
		fs(s, e, t), a = e.to;
	}
	return ts(a, s);
}
const gs = {
	off: 0,
	h1: 0,
	h2: 0
};
function bs(t) {
	let e = 0, n = 0, s = 0;
	for (const o of t) {
		const t = o.fingerprintParts();
		e = Math.imul(e, 668265263) + t.off | 0, n = Math.imul(n, 2654435761) + t.h1 | 0, s = Math.imul(s, 2246822519) + t.h2 | 0;
	}
	return gs.off = e, gs.h1 = n, gs.h2 = s, gs;
}
function* ys(t) {
	const e = W.tapeCount, n = W.config.sym.blank, s = Y(), o = function(t) {
		return Array.isArray(t) ? t : t?.tapes?.[0] || [];
	}(t), a = ps(e, t, n, s);
	a.forEach((t) => t.trackFingerprint());
	let i = K(), r = null;
	const c = a.map((t) => bt(t)), l = $t(c, o, function(t, e) {
		return (n, s) => `State:${G(s.stateAt(n))?.name} Read:[${t.map((t) => t.readAt(n)).join(",")}]${e ? ` @[${t.map((t) => t.headAt(n)).join(",")}]` : ""}`;
	}(c, s), !0), u = Ut(), h = Jt();
	let p = null;
	const f = (n) => ms(e, t, n) === (p ??= ts(i, a));
	let d = null;
	for (let m = 0; m < W.config.maxTmSteps; m++) {
		const t = a.map((t) => t.read()), e = c[0].begin(a[0].head, t[0]);
		for (let i = 1; i < c.length; i++) c[i].begin(a[i].head, t[i]);
		if (d = l.step(e, i, r), W.accepts.has(i)) return d.final = "accept", d.note += " — ACCEPT", void (yield d);
		p = null;
		const n = bs(a), s = u.seenAtVerified(i, n.off, n.h1, n.h2, m, f);
		if (s >= 0) return Gt(d, s), void (yield d);
		const o = h(i, t);
		if (!o) return d.final = "reject", d.note += " — REJECT", void (yield d);
		yield d;
		const g = a.map((t) => t.head);
		fs(a, o, t);
		for (let i = 0; i < c.length; i++) c[i].noteWrite(e, g[i], a[i].cells);
		i = o.to, r = o.id;
	}
	d && !d.final && Ht(d);
}
function* ws(t) {
	const e = vs(t).trackFingerprint(), n = bt(e), s = $t([n], t, as(n, !1));
	let o = K(), a = null;
	const i = Ut(), r = Wt();
	let c = null;
	const l = (n) => ds(() => vs(t), n) === (c ??= `${o}|${e.key()}`);
	let u = null;
	for (let h = 0; h < W.config.maxTmSteps; h++) {
		const t = e.read(), p = n.begin(e.head, t);
		if (u = s.step(p, o, a), W.accepts.has(o)) return u.final = "accept", u.note += " — ACCEPT", void (yield u);
		c = null;
		const f = e.fingerprintParts(), d = i.seenAtVerified(o, f.off, f.h1, f.h2, h, l);
		if (d >= 0) return Gt(u, d), void (yield u);
		const m = r(o, t);
		if (!m) return u.final = "reject", u.note += " — REJECT", void (yield u);
		yield u;
		const g = e.head;
		e.write(m.write && m.write !== W.config.sym.any ? m.write : t), n.noteWrite(p, g, e.cells), o = m.to, a = m.id;
		const b = "L" === m.dir ? W.config.sym.leftMarker : W.config.sym.rightMarker;
		if (!e.move(m.dir)) return u = s.step(n.begin(e.head, e.read()), o, a), u.note = `Attempted to move outside the ${b} boundary. — REJECT`, u.final = "reject", void (yield u);
	}
	u && !u.final && Ht(u);
}
function ks(t, e) {
	e = e || ae();
	const n = W.config.sym.any, s = W.config.sym.blank, o = Y(), a = new Xn(t, s, o).trackFingerprint(), i = W.accepts, r = Wt();
	let c = K();
	const l = Kt((e) => ds(() => new Xn(t, s, o), e), () => `${c}|${a.key()}`);
	for (let u = 0; u < e; u++) {
		if (i.has(c)) return "acc";
		const t = a.fingerprintParts();
		if (l(c, t.off, t.h1, t.h2, u)) return "rej";
		const e = a.read(), s = r(c, e);
		if (!s) return "rej";
		a.write(s.write && s.write !== n ? s.write : e), a.move(s.dir), c = s.to;
	}
	return "unk";
}
function vs(t) {
	const { leftMarker: e, rightMarker: n, blank: s } = W.config.sym;
	return new Xn(St(t), s, !1, {
		rightBound: t.length + 1,
		immutable: /* @__PURE__ */ new Set([e, n])
	});
}
const $s = {
	conflict: (t, e) => se(t.from, t.symbol, e),
	say: (t) => `${W.machine} already has δ(${oe(t.from)}, '${t.symbol}'). Use NDTM mode if you want multiple choices for the same read symbol.`
}, Ss = {
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
}, As = (t) => (e, n = {}) => ({
	verdict: t(e, n.budget),
	output: null
});
function* Ts(t) {
	let e = K();
	const n = Wt(), s = G(e), o = s?.output ?? "";
	let a = o, i = ie(null, o), r = xe({
		state: e,
		tokens: t,
		outNode: i,
		outSoFar: a,
		note: `Start: ${s?.name} — ${W.config.sym.lambda}: '${o}'`
	});
	yield r;
	for (let l = 0; l < t.length; l++) {
		const s = t[l], o = n(e, s);
		if (!o) {
			r = xe({
				state: e,
				tokens: t,
				outNode: i,
				outSoFar: a,
				note: `No δ(${G(e)?.name},'${s}') — HALT`,
				final: "reject"
			}), yield r;
			break;
		}
		e = o.to;
		const c = G(e), u = c?.output ?? "";
		a += u, i = ie(i, u), r = xe({
			state: e,
			tokens: t,
			outNode: i,
			outSoFar: a,
			tid: o.id
		}, () => `Read '${s}' → ${c?.name} — ${W.config.sym.lambda}: '${u}'`), yield r;
	}
	const c = W.config.transducerAccepts;
	!r.final && c && (r.final = W.accepts.has(e) ? "accept" : "reject", r.note += ` — ${r.final.toUpperCase()}`), r.note += ` | Output: "${a}"`;
}
function* xs(t) {
	let e = K();
	const n = Wt();
	let s = "", o = null, a = xe({
		state: e,
		tokens: t,
		outNode: o,
		outSoFar: s,
		note: `Start: ${G(e)?.name}`
	});
	yield a;
	for (let r = 0; r < t.length; r++) {
		const i = t[r], c = n(e, i);
		if (!c) {
			a = xe({
				state: e,
				tokens: t,
				outNode: o,
				outSoFar: s,
				note: `No δ(${G(e)?.name},'${i}') — HALT`,
				final: "reject"
			}), yield a;
			break;
		}
		const l = c.output ?? "?";
		s += l, o = ie(o, l);
		const u = e = c.to;
		a = xe({
			state: e,
			tokens: t,
			outNode: o,
			outSoFar: s,
			tid: c.id
		}, () => `Read '${i}' → ${G(u)?.name} — out: '${l}'`), yield a;
	}
	const i = W.config.transducerAccepts;
	!a.final && i && (a.final = W.accepts.has(e) ? "accept" : "reject", a.note += ` — ${a.final.toUpperCase()}`), s.length && (a.note += ` | Output: "${s}"`);
}
function Ms(t, e) {
	const n = W.config.sym.eps;
	return Lt(t.state).filter((s) => s.symbol === n || !(t.index >= e.length) && (s.symbol === e[t.index] || s.symbol === W.config.sym.any));
}
function Es(t, e, n) {
	const s = W.config.sym.eps, o = e.output ?? "", a = "" === o ? W.config.sym.lambda : o, i = e.symbol !== s;
	return {
		state: e.to,
		index: i ? t.index + 1 : t.index,
		depth: t.depth + 1,
		branch: n,
		outRaw: t.outRaw + o,
		outKey: le(t.outKey, o),
		outNode: ie(t.outNode, a),
		parent: t,
		via: e
	};
}
function Ns(t, e = null) {
	const n = {
		state: K(),
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
	}, s = new Ft([n]), o = new jt(), a = Dt(), i = (t) => o.add(a(t.state), t.index, t.outKey.id, -1, -1);
	i(n), e && e.root(n.state, n);
	const r = /* @__PURE__ */ new Set();
	let c = null, l = null, u = n, h = 0, p = 0, f = 2;
	for (; s.length && h < W.config.maxPdaSteps;) {
		const n = s.shift();
		if (u = n, h++, p = Math.max(p, n.depth), n.index === t.length) {
			const t = W.accepts.has(n.state);
			ee(!0, t) && r.add(n.outRaw), l || (l = n), W.config.transducerAccepts && t && !c && (c = n), e && ee(!0, t) && e.accept(n.tn);
		}
		const o = Ms(n, t), a = e && !e.full ? [] : null;
		o.forEach((t, e) => {
			const r = 1 === o.length || 0 === e ? n.branch : f++, c = Es(n, t, r), l = i(c);
			l && s.push(c), a && a.push({
				cfg: c,
				fresh: l
			});
		}), a && e.expandCfgs(n, a);
	}
	const d = c || l || u;
	return e && e.finish(d.tn ?? -1), {
		accepted: !!c,
		witnessPath: ne(d),
		finalCfg: d,
		outputs: r,
		unresolved: !c && s.length > 0,
		branches: h,
		maxDepth: p
	};
}
at(Ss, {
	TM: {
		simulate: rs,
		stream: is,
		columnar: !0,
		decide: As(ks),
		deterministicDelta: !0,
		determinism: $s
	},
	NDTM: {
		simulate: function(t) {
			return Et(hs(t));
		},
		stream: hs,
		branches: !0,
		decide: As(function(t, e) {
			e = e || ae();
			const n = W.config.sym.any, s = W.accepts, { start: o, seen: a } = cs(t), i = ls(), r = new Ft([{
				state: K(),
				tape: o
			}]);
			a(K(), o);
			let c = 0;
			for (; r.length;) {
				if (c++ >= e) return "unk";
				const t = r.shift();
				if (s.has(t.state)) return "acc";
				const o = t.tape.read();
				for (const e of i(t.state, o)) {
					const s = t.tape.clone();
					s.write(e.write && e.write !== n ? e.write : o), s.move(e.dir), a(e.to, s) && r.push({
						state: e.to,
						tape: s
					});
				}
			}
			return "rej";
		}),
		formal: {
			...Ss.formal,
			delta: () => "Q × Γ → P(Q × Γ × {L, R, S})"
		}
	},
	MTM: {
		deterministicDelta: !0,
		multiTape: !0,
		options: ["tapeCount", "twoWayTape"],
		determinism: {
			conflict: (t, e) => W.transitions.find((n) => n.id !== e && n.from === t.from && function(t = [], e = [], n = W.config.sym.any) {
				return !(!Array.isArray(t) || !Array.isArray(e) || t.length !== e.length) && t.every((t, s) => xt(t, e[s], n));
			}(n.tapeSyms || [n.symbol], t.tapeSyms || [])) || null,
			say: (t) => `MTM already has a transition for (${oe(t.from)}, [${(t.tapeSyms || []).join(", ")}]). Each read tuple must be unique.`
		},
		simulate: function(t) {
			Et(ys(t));
		},
		stream: ys,
		columnar: !0,
		decide: As(function(t, e) {
			e = e || ae();
			const n = W.tapeCount || 2, s = ps(n, t, W.config.sym.blank, Y());
			s.forEach((t) => t.trackFingerprint());
			const o = W.accepts, a = Jt();
			let i = K();
			const r = Kt((e) => ms(n, t, e), () => ts(i, s));
			for (let c = 0; c < e; c++) {
				if (o.has(i)) return "acc";
				const t = bs(s);
				if (r(i, t.off, t.h1, t.h2, c)) return "rej";
				const e = s.map((t) => t.read()), n = a(i, e);
				if (!n) return "rej";
				fs(s, n, e), i = n.to;
			}
			return "unk";
		}),
		parseInput: function(t) {
			if (!String(t).includes(",")) return Zt(t);
			const e = String(t).split(",");
			if (e.length !== W.tapeCount) return {
				ok: !1,
				error: `MTM: found ${e.length} comma-separated segment(s) but machine has ${W.tapeCount} tape(s). Provide one value per tape.`
			};
			const n = [];
			for (let s = 0; s < e.length; s++) {
				const t = e[s].trim(), o = Nt(t === W.config.sym.eps ? "" : t);
				if (null === o) return {
					ok: !1,
					error: `Tape ${s + 1}: cannot tokenize "${t}" using alphabet {${[...W.sigma].join(", ")}}.`
				};
				n.push(o);
			}
			return {
				ok: !0,
				input: { tapes: n },
				tokens: null
			};
		},
		schema: {
			...Ss.schema,
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
			...Ss.formal,
			delta: () => {
				const t = W.tapeCount || 2;
				return `Q × Γ^${t} → Q × Γ^${t} × {L, R, S}^${t}`;
			}
		}
	},
	LBA: {
		simulate: function(t) {
			Et(ws(t));
		},
		stream: ws,
		columnar: !0,
		decide: As(function(t, e) {
			e = e || ae();
			const n = W.config.sym.any, s = vs(t).trackFingerprint(), o = W.accepts, a = Wt();
			let i = K();
			const r = Kt((e) => ds(() => vs(t), e), () => `${i}|${s.key()}`);
			for (let c = 0; c < e; c++) {
				if (o.has(i)) return "acc";
				const t = s.fingerprintParts();
				if (r(i, t.off, t.h1, t.h2, c)) return "rej";
				const e = s.read(), l = a(i, e);
				if (!l) return "rej";
				if (s.write(l.write && l.write !== n ? l.write : e), i = l.to, !s.move(l.dir)) return "rej";
			}
			return "unk";
		}),
		deterministicDelta: !0,
		determinism: $s,
		options: []
	},
	ITM: {
		simulate: function(t) {
			return rs(t);
		},
		stream: function(t) {
			return is(t);
		},
		columnar: !0,
		decide: As(function(t, e) {
			return ks(t, e);
		}),
		deterministicDelta: !0,
		determinism: $s,
		options: []
	}
});
const Ps = {
	conflict: (t, e) => se(t.from, t.symbol, e),
	say: (t) => `${W.machine} already has δ(${oe(t.from)}, '${t.symbol}'). Each input symbol must map to one output.`
}, Cs = {
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
function Fs(t) {
	return "R" === t ? 1 : "L" === t ? -1 : 0;
}
function js(t, e) {
	return e;
}
function Ds(t, e) {
	const { left: n, right: s } = et();
	return {
		kind: "tape",
		cells: t,
		head: e,
		origin: 0,
		leftBound: 0,
		rightBound: t.length - 1,
		markers: [n, s],
		blank: W.config.sym.blank,
		readOnly: !0
	};
}
function Rs(t, e) {
	const n = W.config.sym.any;
	return Lt(t).filter((t) => t.symbol === e || t.symbol === n);
}
function Os(t, e, n = null, s = "") {
	const o = function(t) {
		return St(t);
	}(e), a = t.map((n, s) => {
		const a = G(n.state)?.name || n.state, i = {
			state: n.state,
			tokens: e,
			tape: o,
			head: js(0, n.head),
			view: Ds(o, js(0, n.head)),
			branch: n.branch,
			tid: n.via?.id,
			note: ""
		}, r = void 0 !== n.outNode;
		r && (i.outNode = n.outNode, i.outSoFar = n.outRaw);
		const c = r ? xe(i) : i;
		if (0 === s) c.note = `Start: ${a} at ${o[n.head]}`;
		else {
			const e = t[s - 1], i = G(e.state)?.name || e.state, r = function(t, e) {
				return t[e] ?? null;
			}(o, e.head), l = null === r ? W.config.sym.eps : r;
			c.note = `Branch ${n.branch} depth ${n.depth}: ${i} reads '${l}', move ${n.via?.dir || "S"} → ${a} (head=${n.head})`;
		}
		return c;
	});
	if (a.length && n) {
		const t = a[a.length - 1];
		t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
	}
	return a;
}
function Qs(t) {
	const e = St(t), n = [{
		state: K(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}];
	for (let s = 0; s < W.config.maxTmSteps; s++) {
		const t = n[n.length - 1];
		if (W.accepts.has(t.state)) return {
			accepted: !0,
			path: n,
			finalNote: `Accepted in state ${G(t.state)?.name || t.state}`
		};
		if (t.head < 0 || t.head >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Head moved outside endmarker bounds at index ${t.head}`
		};
		const s = e[t.head], o = Mt(Rs(t.state, s), (t) => t.symbol === s ? 1 : 0);
		if (!o) return {
			accepted: !1,
			path: n,
			finalNote: `No valid transition on '${s}'`
		};
		const a = t.head + Fs(o.dir);
		if (a < 0 || a >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Transition on '${s}' attempted to move outside ${a < 0 ? "⊢" : "⊣"} bound.`
		};
		n.push({
			state: o.to,
			head: a,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: o
		});
	}
	return {
		accepted: !1,
		path: n,
		finalNote: `2DFA step limit ${W.config.maxTmSteps} reached`
	};
}
function Bs(t, e = null) {
	const n = St(t), s = {
		state: K(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}, o = new Ft([s]), a = /* @__PURE__ */ new Set([`${s.state}|${s.head}`]);
	e && e.root(s.state, s);
	let i = null, r = s, c = 0, l = 0, u = 2;
	for (; o.length && c < W.config.maxTmSteps;) {
		const t = o.shift();
		if (r = t, c++, l = Math.max(l, t.depth), W.accepts.has(t.state)) {
			i = t, e && e.accept(t.tn);
			break;
		}
		if (t.head < 0 || t.head >= n.length) {
			e && e.expandCfgs(t, []);
			continue;
		}
		const s = n[t.head], h = Rs(t.state, s), p = e && !e.full ? [] : null;
		h.forEach((e, s) => {
			const i = 1 === h.length || 0 === s ? t.branch : u++, r = t.head + Fs(e.dir);
			if (r < 0 || r >= n.length) return;
			const c = {
				state: e.to,
				head: r,
				depth: t.depth + 1,
				branch: i,
				parent: t,
				via: e
			}, l = `${c.state}|${c.head}`, f = !a.has(l);
			p && p.push({
				cfg: c,
				fresh: f
			}), f && (a.add(l), o.push(c));
		}), p && e.expandCfgs(t, p);
	}
	const h = i || r;
	return e && e.finish(h.tn ?? -1), {
		accepted: !!i,
		witnessPath: ne(h),
		finalCfg: h,
		unresolved: !i && o.length > 0,
		branches: c,
		maxDepth: l
	};
}
function Is(t) {
	const e = St(t), n = W.config.sym.lambda, s = [{
		state: K(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null,
		outRaw: "",
		outNode: null
	}];
	for (let o = 0; o < W.config.maxTmSteps; o++) {
		const t = s[s.length - 1];
		if (W.accepts.has(t.state)) return {
			accepted: !0,
			halted: !0,
			path: s,
			finalNote: `Accepted in state ${G(t.state)?.name || t.state}`
		};
		const o = e[t.head], a = Mt(Rs(t.state, o), (t) => t.symbol === o ? 1 : 0);
		if (!a) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `No valid transition on '${o}'`
		};
		const i = t.head + Fs(a.dir);
		if (i < 0 || i >= e.length) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `Transition on '${o}' attempted to move outside ${i < 0 ? W.config.sym.leftMarker : W.config.sym.rightMarker} bound.`
		};
		const r = a.output ?? "";
		s.push({
			state: a.to,
			head: i,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: a,
			outRaw: t.outRaw + r,
			outNode: ie(t.outNode, "" === r ? n : r)
		});
	}
	return {
		accepted: !1,
		halted: !1,
		path: s,
		finalNote: `2DFT step limit ${W.config.maxTmSteps} reached`
	};
}
at(Cs, {
	Moore: {
		simulate: function(t) {
			Et(Ts(t));
		},
		stream: Ts,
		deterministicDelta: !0,
		determinism: Ps,
		decide: (t) => te(De(t), function(t) {
			let e = K();
			const n = Wt(), s = [G(e)?.output ?? ""];
			for (const o of t) {
				const t = n(e, o);
				if (!t) break;
				e = t.to, s.push(G(e)?.output ?? "");
			}
			return s.join("");
		}(t)),
		schema: {
			...Cs.schema,
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
			Et(xs(t));
		},
		stream: xs,
		deterministicDelta: !0,
		determinism: Ps,
		decide: (t) => te(De(t), function(t) {
			let e = K();
			const n = Wt(), s = [];
			for (const o of t) {
				const t = n(e, o);
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
			const e = Ns(t, null), n = W.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, o = n ? e.accepted ? "Accepting branch found" : e.unresolved ? `Exploration limit ${W.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting branch found" : "";
			W.simSteps = function(t, e, n = null, s = "") {
				const o = t.map((n, s) => {
					const o = G(n.state)?.name || n.state, a = xe({
						state: n.state,
						tokens: e,
						outNode: n.outNode,
						outSoFar: n.outRaw,
						branch: n.branch,
						tid: n.via?.id,
						note: ""
					});
					if (0 === s) a.note = `Start: ${o}`;
					else {
						const e = t[s - 1], i = G(e.state)?.name || e.state, r = n.via?.symbol || W.config.sym.eps, c = void 0 !== n.via?.output && "" !== n.via?.output ? n.via.output : W.config.sym.lambda;
						a.note = `Branch ${n.branch} depth ${n.depth}: (${i}, ${r}/${c}) → ${o}`;
					}
					return a;
				});
				if (o.length && n) {
					const t = o[o.length - 1];
					t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
				}
				return o;
			}(e.witnessPath, t, s, o);
			const a = W.simSteps[W.simSteps.length - 1];
			if (a) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? a.note += ` | Output: "${t[0]}"` : a.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : a.note += " | Output: \"\"";
			}
			return Ne(W.simSteps, null), W.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = Ns(t), n = [...e.outputs];
				let s = "";
				return s = n.length > 1 ? n.join(" | ") : 1 === n.length ? n[0] : e.witnessPath.at(-1)?.outRaw || "", {
					accepted: e.accepted,
					output: s
				};
			}(t);
			return te(e.accepted, e.output);
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
const _s = (t) => ({
	conflict: (t, e) => se(t.from, t.symbol, e),
	say: (e) => `${W.machine} already has δ(${oe(e.from)}, '${e.symbol}'). Use ${t} mode if you want multiple choices for the same read symbol.`
}), Ls = {
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
function Ws(t) {
	const e = W.simStart;
	if (null == e) return t();
	W.simStart = null;
	try {
		return t();
	} finally {
		W.simStart = e;
	}
}
function qs(t) {
	const e = t.match(/^(.*?)(?:=>|→)\s*(accept|reject|acc|rej|✓|✗|a|r)\s*$/i);
	if (!e) return {
		input: t,
		expect: null
	};
	const n = e[2].toLowerCase(), s = "accept" === n || "acc" === n || "✓" === n || "a" === n ? "accept" : "reject";
	return {
		input: e[1].trim(),
		expect: s
	};
}
at(Ls, {
	"2DFA": {
		simulate: function(t) {
			const e = Qs(t);
			return W.simSteps = Os(e.path, t, e.accepted ? "accept" : "reject", e.finalNote), W.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: _s("2NFA"),
		decide: (t) => Xt(function(t) {
			return Qs(t).accepted;
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
			const e = Bs(t, null), n = e.accepted ? `Accepted in state ${G(e.finalCfg.state)?.name || e.finalCfg.state}` : e.unresolved ? `Exploration limit ${W.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance";
			return W.simSteps = Os(e.witnessPath, t, e.accepted ? "accept" : "reject", n), Ne(W.simSteps, null), W.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => Xt(function(t) {
			return Bs(t).accepted;
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
			const e = Is(t), n = W.config.transducerAccepts, s = e.halted ? n ? e.accepted ? "accept" : "reject" : null : "timeout";
			W.simSteps = Os(e.path, t, s, e.finalNote);
			const o = W.simSteps[W.simSteps.length - 1];
			return o && (e.halted || (o.limit = W.config.maxTmSteps), o.note += ` | Output: "${e.path[e.path.length - 1]?.outRaw ?? ""}"`), W.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: _s("FST"),
		decide: (t) => {
			const e = function(t) {
				const e = Is(t), n = e.path[e.path.length - 1];
				return {
					accepted: e.accepted,
					halted: e.halted,
					output: n?.outRaw ?? ""
				};
			}(t);
			return e.halted ? te(e.accepted, e.output) : {
				verdict: "unk",
				output: e.output
			};
		},
		schema: {
			...Ls.schema,
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
const zs = [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts"
], Js = [
	"machine",
	"tapeCount",
	"startId"
];
function Us(t, e) {
	if ("load" === t.type) return function(t) {
		for (const e of Js) W[e] = t[e];
		for (const e of zs) W[e] = new Set(t[e] || []);
		W.states = t.states || [], W.transitions = t.transitions || [], W.config = t.config, W.simSteps = [], W.simIdx = 0;
	}(t.snapshot), e.loaded = t.epoch, {
		type: "ready",
		epoch: t.epoch
	};
	if ("chunk" === t.type) {
		if (t.epoch !== e.loaded) return {
			type: "stale",
			id: t.id,
			offset: t.offset
		};
		try {
			const e = "words" === t.kind ? t.items.map((e) => {
				try {
					return function(t, e, n = {}) {
						const s = it(t);
						return !s || s.parseInput ? null : Ws(() => s.decide(e, n, t));
					}(t.machine, e)?.verdict ?? "unk";
				} catch {
					return "unk";
				}
			}) : function(t) {
				const e = W.machine, n = !!H(e).isTransducer;
				return t.map(qs).map(({ input: t, expect: s }) => function(t, e, n = W.machine, s = null) {
					const o = null === s ? !!H(n).isTransducer : s, a = function(t, e) {
						const n = it(t);
						return n ? (n.parseInput || Zt)(e, t) : {
							ok: !1,
							error: `This build has no implementation for ${t}.`
						};
					}(n, function(t) {
						if (!t) return "";
						const e = t.trim();
						return "eps" === e.toLowerCase() || "epsilon" === e.toLowerCase() ? W.config.sym.eps : e;
					}(t));
					if (!a.ok) return {
						str: t,
						accepted: !1,
						error: !0,
						expect: e
					};
					const { verdict: i, output: r } = function(t, e, n = {}) {
						const s = it(t);
						return s ? Ws(() => s.decide(e, n, t)) : {
							verdict: "unk",
							output: null
						};
					}(n, a.input), c = "unk" === i, l = !c && (o ? W.config.transducerAccepts ? "acc" === i : void 0 : "acc" === i);
					return {
						str: t,
						accepted: l,
						output: r ?? null,
						expect: e,
						verdict: c ? "unknown" : void 0 === l ? void 0 : l ? "accept" : "reject"
					};
				}(t, s, e, n));
			}(t.items);
			return {
				type: "done",
				offset: t.offset,
				rows: e
			};
		} catch (n) {
			return {
				type: "failed",
				offset: t.offset,
				error: String(n && n.message || n)
			};
		}
	}
	return { type: "ignored" };
}
const Vs = { loaded: -1 };
self.onmessage = (t) => self.postMessage(Us(t.data, Vs));
