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
let s = M;
const a = 1, o = 2, i = {
	owned: null,
	cleanups: null,
	context: null,
	owner: null
};
var r = null;
let c = null, u = null, h = null, p = null, d = null, f = 0;
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
	return N(t, !1);
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
const [k, w] = m(!1);
function $() {
	const t = c && c.running;
	if (this.sources && (t ? this.tState : this.state)) if ((t ? this.tState : this.state) === a) A(this);
	else {
		const t = p;
		p = null, N(() => E(this), !1), p = t;
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
		t.observers && t.observers.length && N(() => {
			for (let e = 0; e < t.observers.length; e += 1) {
				const n = t.observers[e], s = c && c.running;
				s && c.disposed.has(n) || ((s ? n.tState : n.state) || (n.pure ? p.push(n) : d.push(n), n.observers && F(n)), s ? n.tState = a : n.state = a);
			}
			if (p.length > 1e6) throw p = [], /* @__PURE__ */ new Error();
		}, !1);
	}
	return e;
}
function A(t) {
	if (!t.fn) return;
	D(t);
	const e = f;
	T(t, c && c.running && c.sources.has(t) ? t.tValue : t.value, e), c && !c.running && c.sources.has(t) && queueMicrotask(() => {
		N(() => {
			c && (c.running = !0), h = r = t, T(t, t.tValue, e), h = r = null;
		}, !1);
	});
}
function T(t, e, n) {
	let s;
	const o = r, i = h;
	h = r = t;
	try {
		s = t.fn(e);
	} catch (l) {
		return t.pure && (c && c.running ? (t.tState = a, t.tOwned && t.tOwned.forEach(D), t.tOwned = void 0) : (t.state = a, t.owned && t.owned.forEach(D), t.owned = null)), t.updatedAt = n + 1, j(l);
	} finally {
		h = i, r = o;
	}
	(!t.updatedAt || t.updatedAt <= n) && (null != t.updatedAt && "observers" in t ? S(t, s, !0) : c && c.running && t.pure ? (c.sources.has(t) || (t.value = s), c.sources.add(t), t.tValue = s) : t.value = s, t.updatedAt = n);
}
function x(t) {
	const e = c && c.running;
	if (0 === (e ? t.tState : t.state)) return;
	if ((e ? t.tState : t.state) === o) return E(t);
	if (t.suspense && b(t.suspense.inFallback)) return t.suspense.effects.push(t);
	const n = [t];
	for (; (t = t.owner) && (!t.updatedAt || t.updatedAt < f);) {
		if (e && c.disposed.has(t)) return;
		(e ? t.tState : t.state) && n.push(t);
	}
	for (let s = n.length - 1; s >= 0; s--) {
		if (t = n[s], e) {
			let e = t, a = n[s + 1];
			for (; (e = e.owner) && e !== a;) if (c.disposed.has(e)) return;
		}
		if ((e ? t.tState : t.state) === a) A(t);
		else if ((e ? t.tState : t.state) === o) {
			const e = p;
			p = null, N(() => E(t, n[0]), !1), p = e;
		}
	}
}
function N(t, e) {
	if (p) return t();
	let n = !1;
	e || (p = []), d ? n = !0 : d = [], f++;
	try {
		const e = t();
		return function(t) {
			if (p && (M(p), p = null), t) return;
			let e;
			if (c) if (c.promises.size || c.queue.size) {
				if (c.running) return c.running = !1, c.effects.push.apply(c.effects, d), d = null, void w(!0);
			} else {
				const t = c.sources, n = c.disposed;
				d.push.apply(d, c.effects), e = c.resolve;
				for (const e of d) "tState" in e && (e.state = e.tState), delete e.tState;
				c = null, N(() => {
					for (const t of n) D(t);
					for (const e of t) {
						if (e.value = e.tValue, e.owned) for (let t = 0, n = e.owned.length; t < n; t++) D(e.owned[t]);
						e.tOwned && (e.owned = e.tOwned), delete e.tValue, delete e.tOwned, e.tState = 0;
					}
					w(!1);
				}, !1);
			}
			const n = d;
			d = null, n.length && N(() => s(n), !1), e && e();
		}(n), e;
	} catch (a) {
		n || (d = null), p = null, j(a);
	}
}
function M(t) {
	for (let e = 0; e < t.length; e++) x(t[e]);
}
function P(e) {
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
function E(t, e) {
	const n = c && c.running;
	n ? t.tState = 0 : t.state = 0;
	for (let s = 0; s < t.sources.length; s += 1) {
		const i = t.sources[s];
		if (i.sources) {
			const t = n ? i.tState : i.state;
			t === a ? i !== e && (!i.updatedAt || i.updatedAt < f) && x(i) : t === o && E(i, e);
		}
	}
}
function F(t) {
	const e = c && c.running;
	for (let n = 0; n < t.observers.length; n += 1) {
		const s = t.observers[n];
		(e ? s.tState : s.state) || (e ? s.tState = o : s.state = o, s.pure ? p.push(s) : d.push(s), s.observers && F(s));
	}
}
function D(t) {
	let e;
	if (t.sources) for (; t.sources.length;) {
		const e = t.sources.pop(), n = t.sourceSlots.pop(), s = e.observers;
		if (s && s.length) {
			const t = s.pop(), a = e.observerSlots.pop();
			n < s.length && (t.sourceSlots[a] = n, s[n] = t, e.observerSlots[n] = a);
		}
	}
	if (t.tOwned) {
		for (e = t.tOwned.length - 1; e >= 0; e--) D(t.tOwned[e]);
		delete t.tOwned;
	}
	if (c && c.running && t.pure) C(t, !0);
	else if (t.owned) {
		for (e = t.owned.length - 1; e >= 0; e--) D(t.owned[e]);
		t.owned = null;
	}
	if (t.cleanups) {
		for (e = t.cleanups.length - 1; e >= 0; e--) t.cleanups[e]();
		t.cleanups = null;
	}
	c && c.running ? t.tState = 0 : t.state = 0;
}
function C(t, e) {
	if (e || (t.tState = 0, c.disposed.add(t)), t.owned) for (let n = 0; n < t.owned.length; n++) C(t.owned[n]);
}
function j(t, e = r) {
	throw function(t) {
		return t instanceof Error ? t : new Error("string" == typeof t ? t : "Unknown error", { cause: t });
	}(t);
}
const O = { equals: !1 };
var Q = class {
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
			const [n, s] = m(void 0, O);
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
const R = Symbol("track-keys");
var B = class extends Set {
	#e = new Q();
	constructor(t) {
		if (super(), t) for (const e of t) super.add(e);
	}
	[Symbol.iterator]() {
		return this.values();
	}
	get size() {
		return this.#e.track(R), super.size;
	}
	has(t) {
		return this.#e.track(t), super.has(t);
	}
	keys() {
		return this.values();
	}
	*values() {
		this.#e.track(R);
		for (const t of super.values()) yield t;
	}
	*entries() {
		this.#e.track(R);
		for (const t of super.entries()) yield t;
	}
	forEach(t, e) {
		this.#e.track(R), super.forEach(t, e);
	}
	add(t) {
		return super.has(t) || (super.add(t), g(() => {
			this.#e.dirty(t), this.#e.dirty(R);
		})), this;
	}
	delete(t) {
		const e = super.delete(t);
		return e && g(() => {
			this.#e.dirty(t), this.#e.dirty(R);
		}), e;
	}
	clear() {
		super.size && g(() => {
			this.#e.dirty(R);
			for (const t of super.values()) this.#e.dirty(t);
			super.clear();
		});
	}
};
if (!function() {
	let t = 0, e = null;
	(function(t) {
		const e = h, n = r, s = 0 === t.length, a = n, o = s ? i : {
			owned: null,
			cleanups: null,
			context: a ? a.context : null,
			owner: a
		}, c = s ? t : () => t();
		r = o, h = null;
		try {
			return N(c, !0);
		} finally {
			h = e, r = n;
		}
	})(() => {
		const [n, o] = m(0);
		e = () => o((t) => t + 1), function(t, e, n) {
			s = P;
			const o = function(t, e, n, s = a) {
				const o = {
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
				if (c && c.running && (o.state = 0, o.tState = s), null === r || r !== i && (c && c.running && r.pure ? r.tOwned ? r.tOwned.push(o) : r.tOwned = [o] : r.owned ? r.owned.push(o) : r.owned = [o]), u);
				return o;
			}(t, e, !1, a);
			n && n.render || (o.user = !0), d ? d.push(o) : A(o);
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
}, W = {
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
const q = {
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
		theme: "dark",
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
			bg: "#080c18",
			nodeFill: "#161d2e",
			nodeStroke: "rgba(100,130,200,0.22)",
			startStroke: "#69f0ae",
			accStroke: "#ffd54f",
			actFill: "rgba(79,195,247,.18)",
			actStroke: "#4fc3f7",
			edgeStroke: "#4a5878",
			textFill: "#7a8ab0",
			nodeTextFill: "#c8d4f0"
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
for (const Cs of [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts",
	"selectedStates",
	"selectedTransitions",
	"selectedNotes",
	"selectedDividers"
]) L(q, Cs);
let _ = null, z = null, J = -1, V = null, K = null;
function U() {
	return q.simStart || q.startId;
}
function G(t) {
	return function() {
		const t = q.states || [], e = t.length;
		if (z === t && J === e && V === t[0] && K === t[e - 1]) return _;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) n.set(t[s].id, t[s]);
		return _ = n, z = t, J = e, V = t[0], K = t[e - 1], n;
	}().get(t);
}
function H(t) {
	return I[t] || I.DFA;
}
function Z(t = q.machine) {
	return !("LBA" === t || !H(t).twoWayTape && !q.config.twoWayTape);
}
function X() {
	return !1 !== q.config.detectLoops;
}
function Y(t = q.machine) {
	const e = H(t).omegaCondition;
	return W[e] ? e : "buchi";
}
function tt(t) {
	const e = Number(t?.priority);
	return Number.isInteger(e) && e >= 0 ? e : 0;
}
function et() {
	return {
		left: q.config.sym.leftMarker,
		right: q.config.sym.rightMarker
	};
}
q.config.radius;
const st = /* @__PURE__ */ new Map();
function at(t, e) {
	if (st.has(t)) throw new Error(`Machine "${t}" is already defined.`);
	if (!e || "object" != typeof e) throw new Error(`Machine "${t}" needs a definition object.`);
	return st.set(t, {
		id: t,
		...e
	}), st.get(t);
}
function ot(t, e) {
	for (const [n, s] of Object.entries(e)) at(n, {
		...t,
		...s
	});
}
function it(t) {
	return st.get(t) || null;
}
function rt(t = []) {
	const { left: e, right: n } = et();
	return [
		e,
		...t,
		n
	];
}
function ct(t = q.machine) {
	return "QA" === t;
}
function lt(t = q.machine) {
	return "2PDA" === t;
}
function ut(t, e, n = q.config.sym.any) {
	return t === e || t === n || e === n;
}
function ht(t = [], e = () => 0) {
	let n = null, s = -1 / 0;
	for (const a of t) {
		const t = e(a);
		t > s ? (n = a, s = t) : t === s && n && String(a.id || "").localeCompare(String(n.id || ""), void 0, { numeric: !0 }) < 0 && (n = a);
	}
	return n;
}
function pt(t) {
	const e = "function" == typeof t.next ? t : t[Symbol.iterator](), n = [];
	let s = e.next();
	for (; !s.done;) n.push(s.value), s = e.next();
	return q.simSteps = n, q.simIdx = 0, s.value;
}
function dt(t, e = q.sigma) {
	if ("" === t || !t) return [];
	const n = [...e].filter((t) => t !== q.config.sym.eps).sort((t, e) => e.length - t.length), s = t.split(/[,\s]+/).filter((t) => t.length > 0);
	if (0 === s.length) return [];
	const a = [];
	for (const o of s) {
		const t = ft(o, n);
		if (null === t) return null;
		for (const e of t) a.push(e);
	}
	return a;
}
function ft(t, e) {
	const n = t.length, s = new Uint8Array(n + 1);
	s[n] = 1;
	const a = (e, n) => e.length > 0 && 1 === s[n + e.length] && t.startsWith(e, n);
	for (let i = n - 1; i >= 0; i--) for (const t of e) if (a(t, i)) {
		s[i] = 1;
		break;
	}
	if (!s[0]) return null;
	const o = [];
	for (let i = 0; i < n;) for (const t of e) if (a(t, i)) {
		o.push(t), i += t.length;
		break;
	}
	return o;
}
function mt(t) {
	return [...t].map((t) => G(t)?.name || t).join(",");
}
var gt = class {
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
}, bt = class {
	constructor(t = 1024) {
		let e = 16;
		for (; e < 2 * t;) e *= 2;
		this.cap = e, this.size = 0, this.slots = new Int32Array(6 * e);
	}
	add(t, e, n, s, a) {
		return -1 === this.addOrGet(t, e, n, s, a, 0);
	}
	addOrGet(t, e, n, s, a, o) {
		const i = this.slots, r = this.cap - 1, c = t + 1;
		let l = 6 * (function(t, e, n, s, a) {
			let o = Math.imul(t, 2654435761) ^ Math.imul(e + 2135587861, 2246822519);
			return o = Math.imul(o ^ o >>> 15, 739982445) ^ Math.imul(n, 3266489917), o = Math.imul(o ^ o >>> 13, 695872825) ^ Math.imul(s, 668265263) ^ Math.imul(a, 374761393), o = Math.imul(o ^ o >>> 16, 2246822507), (o ^ o >>> 13) >>> 0;
		}(t, e, n, s, a) & r);
		for (; 0 !== i[l];) {
			if (i[l] === c && i[l + 1] === e && i[l + 2] === n && i[l + 3] === s && i[l + 4] === a) return i[l + 5];
			l += 6, l === i.length && (l = 0);
		}
		return i[l] = c, i[l + 1] = e, i[l + 2] = n, i[l + 3] = s, i[l + 4] = a, i[l + 5] = o, 2 * ++this.size > this.cap && this.grow(), -1;
	}
	grow() {
		const t = this.slots;
		this.cap *= 2, this.slots = new Int32Array(6 * this.cap), this.size = 0;
		for (let e = 0; e < t.length; e += 6) 0 !== t[e] && this.addOrGet(t[e] - 1, t[e + 1], t[e + 2], t[e + 3], t[e + 4], t[e + 5]);
	}
};
function yt() {
	const t = /* @__PURE__ */ new Map();
	return (e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = t.size), n;
	};
}
const kt = Object.freeze([]);
let wt = null, vt = null, $t = -1, St = null, At = null;
function Tt(t) {
	return function() {
		const t = q.transitions || kt, e = t.length;
		if (vt === t && $t === e && St === t[0] && At === t[e - 1]) return wt;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) {
			const e = t[s], a = n.get(e.from);
			a ? a.push(e) : n.set(e.from, [e]);
		}
		return wt = n, vt = t, $t = e, St = t[0], At = t[e - 1], n;
	}().get(t) || kt;
}
function xt() {
	const t = q.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let a = e.get(n);
		void 0 === a && e.set(n, a = function(t, e) {
			const n = Tt(t), s = Nt.get(n);
			if (void 0 !== s && function(t, e, n) {
				if (t.any !== n) return !1;
				const { syms: s, ids: a } = t;
				for (let o = 0; o < e.length; o++) if (e[o].symbol !== s[o] || e[o].id !== a[o]) return !1;
				return !0;
			}(s, n, e)) return s;
			const a = /* @__PURE__ */ new Map();
			let o = null;
			const i = new Array(n.length), r = new Array(n.length);
			for (let l = 0; l < n.length; l++) {
				const t = n[l];
				i[l] = t.symbol, r[l] = t.id, t.symbol === e ? o = Mt(o, t) : a.set(t.symbol, Mt(a.get(t.symbol) ?? null, t));
			}
			const c = {
				bySymbol: a,
				wildcard: o,
				any: e,
				syms: i,
				ids: r
			};
			return Nt.set(n, c), c;
		}(n, t));
		const o = a.bySymbol.get(s);
		return void 0 !== o ? o : a.wildcard;
	};
}
const Nt = /* @__PURE__ */ new WeakMap();
function Mt(t, e) {
	return null === t || String(e.id || "").localeCompare(String(t.id || ""), void 0, { numeric: !0 }) < 0 ? e : t;
}
function Pt() {
	const t = /* @__PURE__ */ new Map();
	return (e, n) => {
		let s = t.get(e);
		void 0 === s && t.set(e, s = /* @__PURE__ */ new Map());
		const a = 1 === n.length ? n[0] : n.join("");
		let o = s.get(a);
		return void 0 === o && s.set(a, o = function(t, e) {
			const n = q.config.sym.any;
			return ht(Tt(t).filter((t) => t.tapeSyms && t.tapeSyms.length === e.length && t.tapeSyms.every((t, s) => t === e[s] || t === n)), (t) => t.tapeSyms.reduce((t, n, s) => t + (n === e[s] ? 1 : 0), 0));
		}(e, n)), o;
	};
}
function Et() {
	if (!X()) return {
		seenAt: () => -1,
		seenAtVerified: () => -1
	};
	let t = /* @__PURE__ */ new Map(), e = Ft();
	return {
		seenAt: (e, n) => t ? t.has(e) ? t.get(e) : (t.set(e, n), t.size > 5e3 && (t = null), -1) : -1,
		seenAtVerified(t, n, s, a, o, i) {
			if (!e) return -1;
			const r = e.check(t, n, s, a, o, i);
			return e.size > 5e3 && (e = null), r;
		}
	};
}
function Ft() {
	const t = new bt(), e = yt();
	let n = null;
	return {
		get size() {
			return t.size;
		},
		check(s, a, o, i, r, c) {
			const l = e(s), u = t.addOrGet(l, a, o, i, 0, r);
			if (u < 0) return -1;
			if (c(u)) return u;
			const h = `${l},${a},${o},${i}`;
			n ??= /* @__PURE__ */ new Map();
			const p = n.get(h);
			if (!p) return n.set(h, [r]), -1;
			for (const t of p) if (c(t)) return t;
			return p.push(r), -1;
		}
	};
}
function Dt(t, e) {
	const n = Ft();
	let s = null;
	const a = (n) => t(n) === (s ??= e());
	return (t, e, o, i, r) => (s = null, n.check(t, e, o, i, r, a) >= 0);
}
function Ct(t, e) {
	t.final = "loop", t.loopFrom = e, t.note += ` — LOOP: repeats step ${e}, so this machine never halts on this input`;
}
function jt(t, e = q.config.maxTmSteps) {
	t.final = "timeout", t.limit = e, t.note += ` — NO VERDICT: still running after ${e} steps`, X() || (t.note += ", and loop detection is off");
}
function Ot(t, e, n) {
	const s = function(t, e) {
		const n = q.config.sym.blank, s = Math.max(0, e), a = t.length ? [...t] : [n];
		for (; a.length <= s;) a.push(n);
		for (; a.length > s + 1 && a[a.length - 1] === n;) a.pop();
		return {
			tape: a,
			head: s
		};
	}(e, n), a = G(t)?.name || t;
	return `${s.tape.slice(0, s.head).join("")}[${a}]${s.tape.slice(s.head).join("")}`;
}
function Qt(t) {
	const e = dt(t === q.config.sym.eps ? "" : t);
	return null === e ? {
		ok: !1,
		error: `Input cannot be tokenized using alphabet {${[...q.sigma].join(", ")}}.`
	} : {
		ok: !0,
		input: e,
		tokens: e
	};
}
function Rt(t) {
	return {
		verdict: t ? "acc" : "rej",
		output: null
	};
}
function Bt(t, e) {
	return {
		verdict: t ? "acc" : "rej",
		output: e
	};
}
function It(t, e) {
	return !!t && (!q.config.transducerAccepts || e);
}
function Wt(t) {
	const e = [];
	let n = t;
	for (; n;) e.push(n), n = n.parent;
	return e.reverse();
}
function Lt(t, e, n) {
	return q.transitions.find((s) => s.id !== n && s.from === t && ut(s.symbol, e)) || null;
}
function qt(t) {
	return G(t)?.name || t;
}
function _t() {
	return Math.max(10, q.config.langStepBudget || 400);
}
function zt(t, e) {
	return {
		piece: e,
		prev: t,
		len: t ? t.len + 1 : 1
	};
}
function Jt(t, e) {
	let n = t.kids;
	null === n && (n = t.kids = /* @__PURE__ */ new Map());
	let s = n.get(e);
	if (void 0 === s) {
		const a = null !== e && "object" == typeof e ? e.length : 1;
		s = {
			sym: e,
			below: t,
			length: t.length + 1,
			size: t.size + a,
			id: t.trie.next++,
			kids: null,
			arr: null,
			trie: t.trie
		}, n.set(e, s);
	}
	return s;
}
function Vt(t) {
	if (null !== t.arr) return t.arr;
	const e = new Array(t.length);
	for (let n = t, s = t.length - 1; s >= 0; n = n.below, s--) e[s] = n.sym;
	return t.arr = e, e;
}
function Kt(t, e) {
	for (let n = 0; n < e.length; n++) t = Jt(t, e[n]);
	return t;
}
function Ut(t) {
	return Array.isArray(t) ? t : Vt(t);
}
const Gt = {
	get() {
		return this.tokens.slice(this.pos);
	},
	enumerable: !1,
	configurable: !0
}, Ht = {
	get() {
		return function(t) {
			const e = t ? t.len : 0, n = new Array(e);
			for (let s = t, a = e - 1; s; s = s.prev, a--) n[a] = s.piece;
			return n;
		}(this.outNode);
	},
	enumerable: !1,
	configurable: !0
}, Zt = {
	get() {
		return void 0 === this.stackRef ? void 0 : Ut(this.stackRef);
	},
	enumerable: !1,
	configurable: !0
}, Xt = {
	get() {
		return void 0 === this.stackRef2 ? void 0 : Ut(this.stackRef2);
	},
	enumerable: !1,
	configurable: !0
}, Yt = {
	get() {
		return Vt(this.storeRef).map(Vt);
	},
	enumerable: !1,
	configurable: !0
}, te = {
	get() {
		const t = this.storeRef.sym;
		return t ? Vt(t) : [];
	},
	enumerable: !1,
	configurable: !0
}, ee = Object.defineProperties({}, { remaining: Gt }), ne = Object.defineProperties({}, { outToks: Ht }), se = (Object.defineProperties({}, {
	remaining: Gt,
	outToks: Ht
}), Object.defineProperties({}, {
	remaining: Gt,
	stack: Zt,
	stack2: Xt
})), ae = Object.defineProperties({}, {
	remaining: Gt,
	outToks: Ht,
	stack: Zt,
	stack2: Xt
}), oe = Object.defineProperties({}, {
	remaining: Gt,
	store: Yt,
	stack: te
}), ie = {
	get() {
		const t = this._note;
		return "function" == typeof t ? this._note = t() : t;
	},
	set(t) {
		this._note = t;
	},
	enumerable: !1,
	configurable: !0
}, re = /* @__PURE__ */ new WeakMap();
function ce(t) {
	let e = re.get(t);
	return e || re.set(t, e = Object.create(t, { note: ie })), e;
}
function le(t, e) {
	if (void 0 === e) return Object.assign(Object.create(ee), t);
	const n = Object.assign(Object.create(ce(ee)), t);
	return n._note = e, n;
}
function ue(t, e) {
	if (void 0 === e) return Object.assign(Object.create(ne), t);
	const n = Object.assign(Object.create(ce(ne)), t);
	return n._note = e, n;
}
function he(t) {
	return Object.assign(Object.create(void 0 !== t.outNode ? ae : se), t);
}
function pe(t) {
	return Object.assign(Object.create(oe), t);
}
function de(t, e) {
	return e && t && t[0] && Object.defineProperty(t[0], "branchTree", {
		value: e,
		configurable: !0,
		writable: !0,
		enumerable: !1
	}), t;
}
function* fe(t) {
	let e = U();
	const n = xt();
	let s = le({
		state: e,
		tokens: t,
		pos: 0,
		note: `Start: ${G(e)?.name || "?"}`
	});
	yield s;
	for (let a = 0; a < t.length; a++) {
		const o = t[a], i = n(e, o);
		if (!i) return s = le({
			state: e,
			tokens: t,
			pos: a,
			note: `No δ(${G(e)?.name},'${o}') — Implicit REJECT`,
			final: "reject"
		}), void (yield s);
		const r = e = i.to;
		s = le({
			state: e,
			tokens: t,
			pos: a + 1,
			tid: i.id
		}, () => `Read '${o}' → ${G(r)?.name}`), yield s;
	}
	s.final || (s.final = q.accepts.has(e) ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
var me = class {
	constructor() {
		const { eps: t, any: e } = q.config.sym;
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
			for (const n of Tt(this.ids[t])) n.symbol !== e && n.symbol !== this.any || s.push(this.no(n.to));
			n.set(e, s);
		}
		return s;
	}
	epsTargets(t) {
		let e = this.epsOut[t];
		if (null === e) {
			e = [];
			for (const n of Tt(this.ids[t])) n.symbol === this.eps && e.push(this.no(n.to));
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
			for (const a of this.epsTargets(s)) this.mark[a] !== this.stamp && (this.mark[a] = this.stamp, t.push(a), e[n++] = a);
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
		for (let a = 0; a < e.length; a++) for (const o of this.targets(e[a], t)) this.mark[o] !== s && (this.mark[o] = s, n.push(o));
		this.close(n);
	}
	stateIds() {
		return this.cur.map((t) => this.ids[t]);
	}
	accepts() {
		const t = q.accepts;
		return this.cur.some((e) => t.has(this.ids[e]));
	}
};
function* ge(t) {
	const e = new me();
	e.start(U());
	let n = e.stateIds(), s = le({
		states: n,
		tokens: t,
		pos: 0,
		note: `Start ε-closure: {${mt(n)}}`
	});
	yield s;
	for (let o = 0; o < t.length; o++) {
		const a = t[o];
		e.step(a);
		const i = n = e.stateIds();
		if (s = le({
			states: n,
			tokens: t,
			pos: o + 1
		}, () => `Read '${a}' → {${mt(i) || "∅"}}`), yield s, !n.length) break;
	}
	const a = e.accepts();
	s.final || (s.final = a ? "accept" : "reject", s.note += ` — ${s.final.toUpperCase()}`);
}
function be(t) {
	pt(ge(t));
}
function ye(t) {
	let e = U();
	const n = xt();
	for (const s of t) {
		const t = n(e, s);
		if (!t) return !1;
		e = t.to;
	}
	return q.accepts.has(e);
}
function ke(t) {
	const e = new me();
	e.start(U());
	for (let n = 0; n < t.length && e.cur.length; n++) e.step(t[n]);
	return e.accepts();
}
const we = {
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
function ve(t) {
	const e = Number(t.weight);
	return Number.isFinite(e) ? e : 1;
}
function $e(t) {
	return Number.isFinite(t) ? Number.isInteger(t) ? String(t) : String(Number(t.toFixed(4))) : "0";
}
function Se(t, e) {
	const n = q.config.sym.any, s = /* @__PURE__ */ new Map();
	for (const [a, o] of t) if (o) for (const t of Tt(a)) {
		if (t.symbol !== e && t.symbol !== n) continue;
		const a = ve(t);
		a && s.set(t.to, (s.get(t.to) || 0) + o * a);
	}
	return s;
}
function Ae(t) {
	let e = 0;
	for (const [n, s] of t) q.accepts.has(n) && (e += s);
	return e;
}
function Te(t) {
	const e = [/* @__PURE__ */ new Map([[U(), 1]])];
	for (const n of t) e.push(Se(e[e.length - 1], n));
	return e;
}
function xe(t, e, n, s) {
	const a = q.config.sym.any, o = function(t, e, n) {
		return n < t.length ? t[n] : e[(n - t.length) % e.length];
	}(t, e, s), i = function(t, e, n) {
		return n + 1 < t.length + e.length ? n + 1 : t.length;
	}(t, e, s), r = [];
	for (const c of Tt(n)) c.symbol !== o && c.symbol !== a || r.push({
		state: c.to,
		pos: i,
		via: c
	});
	return r;
}
ot(we, {
	DFA: {
		simulate: function(t) {
			pt(fe(t));
		},
		stream: fe,
		deterministicDelta: !0,
		determinism: {
			conflict: (t, e) => function(t, e, n) {
				return q.transitions.find((s) => s.id !== n && s.from === t && s.symbol === e) || null;
			}(t.from, t.symbol, e),
			say: (t) => `${q.machine} already has δ(${qt(t.from)}, '${t.symbol}'). Each (state, symbol) pair must be unique.`
		},
		decide: (t) => Rt(ye(t)),
		formal: {
			...we.formal,
			delta: () => "Q × Σ → Q"
		}
	},
	NFA: {
		simulate: be,
		stream: ge,
		branches: !0,
		decide: (t) => Rt(ke(t)),
		formal: {
			...we.formal,
			delta: () => "Q × Σ → P(Q)"
		}
	},
	"ε-NFA": {
		simulate: be,
		stream: ge,
		branches: !0,
		decide: (t) => Rt(ke(t)),
		formal: {
			...we.formal,
			delta: () => "Q × (Σ ∪ {ε}) → P(Q)"
		}
	}
}), at("PFA", {
	family: "weighted",
	options: ["cutPoint"],
	simulate: function(t) {
		q.simSteps = [];
		const e = q.config.pfaCutPoint;
		Te(t).forEach((e, n) => {
			const s = function(t) {
				return [...t.entries()].filter(([, t]) => t > 0).sort((t, e) => e[1] - t[1]).map(([t, e]) => `${G(t)?.name || t}:${$e(e)}`);
			}(e);
			q.simSteps.push(le({
				states: [...e.keys()].filter((t) => e.get(t) > 0),
				tokens: t,
				pos: n,
				dist: s,
				accMass: Ae(e),
				note: 0 === n ? `Start: all probability on ${G(U())?.name || U()}` : `Read '${t[n - 1]}' → ${s.length ? s.join("  ") : "total mass 0 — the run has died"}`
			}));
		});
		const n = q.simSteps[q.simSteps.length - 1];
		if (n) {
			const t = n.accMass > e;
			n.final = t ? "accept" : "reject", n.note += ` | P(accept) = ${$e(n.accMass)} ${t ? ">" : "≤"} λ = ${$e(e)} — ${t ? "ACCEPT" : "REJECT"}`;
		}
		const s = function() {
			const t = /* @__PURE__ */ new Map();
			for (const n of q.transitions) {
				const e = `${n.from}|${n.symbol}`;
				t.set(e, (t.get(e) || 0) + ve(n));
			}
			const e = [];
			for (const [n, s] of t) if (Math.abs(s - 1) > 1e-9) {
				const [t, a] = n.split("|");
				e.push({
					from: t,
					symbol: a,
					total: s
				});
			}
			return e;
		}();
		return n && s.length && (n.note += ` | ⚠ ${s.length} (state, symbol) row${s.length > 1 ? "s do" : " does"} not sum to 1`), q.simIdx = 0, {
			accepted: !!n && "accept" === n.final,
			mass: n?.accMass ?? 0,
			malformed: s
		};
	},
	decide: (t) => Rt(function(t) {
		const e = Te(t);
		return Ae(e[e.length - 1]) > q.config.pfaCutPoint;
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
const Ne = (t, e) => `${t}|${e}`;
function Me(t, e, n, s = null) {
	const a = Ne(n.state, n.pos), o = /* @__PURE__ */ new Map(), i = new gt(), r = (t, e) => {
		const n = Ne(e.state, e.pos);
		return n === a || (s && !s(e.state) || o.has(n) || (o.set(n, {
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
		for (; Ne(s.state, s.pos) !== a;) {
			const t = o.get(Ne(s.state, s.pos));
			n.unshift({
				state: s.state,
				pos: s.pos,
				via: t.via
			}), s = t.from;
		}
		return n;
	};
	for (const l of xe(t, e, n.state, n.pos)) if (r(n, l)) return c(n, l);
	for (; i.length;) {
		const n = i.shift();
		for (const s of xe(t, e, n.state, n.pos)) if (r(n, s)) return c(n, s);
	}
	return null;
}
function Pe(t, e) {
	if (!e.length) return {
		accepted: !1,
		reason: "empty-period",
		stem: [],
		loop: []
	};
	if (!U()) return {
		accepted: !1,
		reason: "no-start",
		stem: [],
		loop: []
	};
	const n = {
		state: U(),
		pos: 0,
		via: null
	}, s = /* @__PURE__ */ new Map([[Ne(n.state, n.pos), null]]), a = [n], o = new gt([n]);
	for (; o.length;) {
		const n = o.shift();
		for (const i of xe(t, e, n.state, n.pos)) {
			const t = Ne(i.state, i.pos);
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
			a.push(e), o.push(e);
		}
	}
	const i = (t) => {
		const e = [];
		let n = {
			state: t.state,
			pos: t.pos
		};
		for (;;) {
			const t = s.get(Ne(n.state, n.pos));
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
		const e = Y();
		if ("cobuchi" === e) {
			const e = (t) => !q.accepts.has(t);
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
		return t.filter((t) => q.accepts.has(t.state)).map((t) => ({
			node: t,
			allow: null
		}));
	}(a)) {
		const n = Me(t, e, r, c);
		if (n) return {
			accepted: !0,
			stem: i(r),
			loop: n,
			reason: null
		};
	}
	return {
		accepted: !1,
		stem: i(a[a.length - 1] || n),
		loop: [],
		reason: a.length > 1 ? "no-accepting-cycle" : "stuck"
	};
}
function Ee() {
	const t = function(t = q.transitions) {
		for (let e = 0; e < t.length; e++) for (let n = e + 1; n < t.length; n++) {
			const s = t[e], a = t[n];
			if (s.from === a.from && ut(s.symbol, a.symbol)) return [s, a];
		}
		return null;
	}(q.transitions);
	if (!t) return null;
	const e = G(t[0].from)?.name || t[0].from;
	return { refuse: `Nondeterministic overlap in ${q.machine} mode: ${e} has two moves on '${t[0].symbol}'. Switch to ${q.machine.replace(/^D/, "N")} to explore both branches.` };
}
function Fe() {
	const t = function() {
		const t = /* @__PURE__ */ new Map();
		for (const l of q.states) t.set(l.id, []);
		for (const l of q.transitions) t.has(l.from) && t.get(l.from).push(l.to);
		const e = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Set(), a = [];
		let o = 0, i = null;
		const r = (t) => {
			const e = t.filter((t) => q.accepts.has(t)).length;
			return e > 0 && e < t.length;
		}, c = (c) => {
			const l = [{
				v: c,
				i: 0
			}];
			for (e.set(c, o), n.set(c, o), o++, a.push(c), s.add(c); l.length;) {
				const c = l[l.length - 1], u = t.get(c.v) || [];
				if (c.i < u.length) {
					const t = u[c.i++];
					e.has(t) ? s.has(t) && n.set(c.v, Math.min(n.get(c.v), e.get(t))) : (e.set(t, o), n.set(t, o), o++, a.push(t), s.add(t), l.push({
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
						const t = a.pop();
						if (s.delete(t), e.push(t), t === c.v) break;
					}
					(e.length > 1 || (t.get(e[0]) || []).includes(e[0])) && !i && r(e) && (i = e);
				}
			}
		};
		for (const l of q.states) e.has(l.id) || c(l.id);
		return i;
	}();
	return t ? { warn: `Not a weak automaton: the cycle {${t.map((t) => G(t)?.name || t).join(", ")}} contains both accepting and non-accepting states. A weak condition needs every SCC to sit wholly inside F or wholly outside it. Running it as a Büchi automaton.` } : null;
}
const De = {
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
			error: `${q.machine} reads an infinite word. Write it as <em>u(v)</em> — a finite prefix followed by the repeating period in parentheses, e.g. <em>ab(ba)</em> or <em>(a)</em>.`
		};
		const n = dt(e.prefix === q.config.sym.eps ? "" : e.prefix), s = dt(e.period);
		return null === n || null === s ? {
			ok: !1,
			error: `Input cannot be tokenized using alphabet {${[...q.sigma].join(", ")}}.`
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
		const n = Pe(t, e), s = n.accepted ? [
			...n.stem,
			...n.loop,
			...n.loop
		].slice(0, n.stem.length + 2 * n.loop.length) : n.stem, a = n.accepted ? n.stem.length - 1 : -1, o = Math.max(1, Math.ceil((s.length + 1) / Math.max(1, e.length)) + 1), i = [...t];
		for (let l = 0; l < o; l++) i.push(...e);
		const r = [...t, ...e];
		q.simSteps = s.map((o, c) => {
			const l = G(o.state)?.name || o.state, u = a >= 0 && c >= a;
			let h;
			if (0 === c) h = `Start: ${l}`;
			else {
				const t = G(s[c - 1].state)?.name || s[c - 1].state;
				h = `Read '${i[c - 1]}': ${t} → ${l}`;
			}
			return h += function(t) {
				const e = Y();
				return "parity" === e ? ` · priority ${tt(G(t))}` : q.accepts.has(t) ? "cobuchi" === e ? " ✗ (in F — must stop recurring)" : " ✓ (accepting)" : "";
			}(o.state), u && (h += ` · loop iteration ${Math.floor((c - a) / Math.max(1, n.loop.length)) + 1}`), {
				state: o.state,
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
					blank: q.config.sym.blank,
					readOnly: !0,
					periodFrom: t.length,
					periodLen: e.length
				},
				tid: o.via?.id,
				omegaLoopFrom: a,
				note: h
			};
		});
		const c = q.simSteps[q.simSteps.length - 1];
		return c && (c.final = n.accepted ? "accept" : "reject", c.note += function(t) {
			const e = Y(), n = t.loop.map((t) => G(t.state)?.name || t.state), s = [...new Set(n)].join(" → ");
			return t.accepted ? "cobuchi" === e ? ` — ACCEPT: the cycle ${s} repeats forever and never touches F again` : "parity" === e ? ` — ACCEPT: the cycle ${s} repeats forever and its least priority is ${Math.min(...t.loop.map((t) => tt(G(t.state))))}, which is even` : ` — ACCEPT: the cycle ${s} repeats forever and visits an accepting state each time` : "stuck" === t.reason ? " — REJECT: no run survives the ω-word" : "cobuchi" === e ? " — REJECT: every reachable cycle touches F, so no run can leave it behind for good" : "parity" === e ? " — REJECT: every reachable cycle has an odd least priority" : " — REJECT: every reachable cycle avoids F, so no run visits an accepting state infinitely often";
		}(n)), q.simIdx = 0, n;
	}(t, e),
	decide: ({ u: t, v: e }) => Rt(function(t, e) {
		return Pe(t, e).accepted;
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
}, Ce = { schema: {
	...De.schema,
	stateFields: [
		"name",
		"start",
		"priority"
	]
} }, je = {
	conflict: (t, e) => Lt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has a move from ${qt(t.from)} on '${t.symbol}'. Switch to ${q.machine.replace(/^D/, "N")} if you want to branch on the same symbol.`
}, Oe = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → Q"
}, Qe = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → P(Q)"
};
function Re(t, e) {
	return e === q.config.sym.eps || void 0 !== t && (e === t || e === q.config.sym.any);
}
function Be(t = q.machine) {
	return ct(t);
}
function Ie(t = q.machine) {
	return lt(t);
}
function We(t, e = !1) {
	if (t && t.length) return Array.isArray(t) ? e ? t[0] : t[t.length - 1] : t.sym;
}
function Le(t, e = !1) {
	if (!t || !t.length) return q.config.sym.eps;
	const n = Ut(t);
	return e ? n.join("") : [...n].reverse().join("");
}
function qe(t, e, n) {
	const { eps: s, any: a } = q.config.sym;
	let o;
	e !== s && t.length && (o = t.sym, t = t.below);
	let i = n && n !== s ? n : "";
	i === a && (i = o || "");
	for (let r = i.length - 1; r >= 0; r--) t = Jt(t, i[r]);
	return t;
}
function _e(t, e, n, s = !1) {
	const a = q.config.sym.eps, o = [...t];
	let i;
	e !== a && (i = s ? o.shift() : o.pop());
	let r = n && n !== a ? n : "";
	if (r === q.config.sym.any && (r = i || ""), r) {
		const t = r.split("");
		s ? t.forEach((t) => o.push(t)) : t.reverse().forEach((t) => o.push(t));
	}
	return o;
}
function ze(t) {
	const e = "explicit" === q.config.pdaParadigm ? [q.config.sym.stackBottom] : [], n = {
		sym: void 0,
		below: null,
		length: 0,
		size: 0,
		id: 0,
		kids: null,
		arr: null,
		trie: { next: 1 }
	}, s = {
		state: U(),
		tokens: t,
		pos: 0,
		stack: Be() ? [...e] : e.reduce((t, e) => Jt(t, e), n),
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	};
	return Ie() && (s.stack2 = e.reduce((t, e) => Jt(t, e), n)), s;
}
function Je() {
	const t = new bt(), e = yt();
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
function Ve(t) {
	return "explicit" === q.config.pdaParadigm ? q.accepts.has(t.state) && t.pos >= t.tokens.length : Ie() ? t.pos >= t.tokens.length && 0 === t.stack.length && 0 === (t.stack2 || []).length : t.pos >= t.tokens.length && 0 === t.stack.length;
}
function Ke(t) {
	const e = G(t.state)?.name || t.state, n = t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : q.config.sym.eps, s = Le(t.stack, Be());
	return Ie() ? `(${e}, ${n}, ${s}; ${Le(t.stack2 || [])})` : `(${e}, ${n}, ${s})`;
}
ot(De, {
	DBA: {
		deterministicDelta: !0,
		determinism: je,
		guards: [Ee],
		formal: Oe
	},
	DcoBA: {
		deterministicDelta: !0,
		determinism: je,
		guards: [Ee],
		formal: Oe
	},
	DPA: {
		deterministicDelta: !0,
		determinism: je,
		guards: [Ee],
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
		...Ce
	},
	DWA: {
		deterministicDelta: !0,
		determinism: je,
		guards: [Ee, Fe],
		formal: Oe
	},
	NBA: {
		guards: [],
		formal: Qe
	},
	NcoBA: {
		guards: [],
		formal: Qe
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
		...Ce
	},
	NWA: {
		guards: [Fe],
		formal: Qe
	}
});
const Ue = Symbol("end of input");
function Ge() {
	const t = /* @__PURE__ */ new Map(), e = Be(), n = Ie(), s = (t, e) => {
		let n = t.get(e);
		return void 0 === n && t.set(e, n = /* @__PURE__ */ new Map()), n;
	};
	return (a) => {
		const o = a.pos < a.tokens.length ? a.tokens[a.pos] : Ue;
		let i = s(s(t, a.state), o);
		n && (i = s(i, We(a.stack2 || [])));
		const r = We(a.stack, e);
		let c = i.get(r);
		return void 0 === c && i.set(r, c = function(t) {
			const { eps: e, any: n } = q.config.sym, s = We(t.stack, Be()), a = Ie(), o = a ? We(t.stack2 || []) : void 0, i = t.pos < t.tokens.length, r = i ? t.tokens[t.pos] : void 0, c = [];
			for (const l of Tt(t.state)) {
				const t = l.symbol;
				(t === e || i && (t === r || t === n)) && Re(s, l.pop) && (a && !Re(o, l.pop2 || e) || c.push(l));
			}
			return c;
		}(a)), c;
	};
}
function He() {
	const t = "explicit" === q.config.pdaParadigm, e = Ie(), n = q.accepts;
	return t ? (t) => t.pos >= t.tokens.length && n.has(t.state) : (t) => t.pos >= t.tokens.length && 0 === t.stack.length && (!e || 0 === (t.stack2 || []).length);
}
function Ze(t, e, n = t.branch) {
	const s = q.config.sym.eps, a = e.pop || s, o = e.push || s, i = {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		stack: Array.isArray(t.stack) ? _e(t.stack, a, o, Be()) : qe(t.stack, a, o),
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
	if (void 0 !== t.stack2) {
		const n = e.pop2 || s, a = e.push2 || s;
		i.stack2 = Array.isArray(t.stack2) ? _e(t.stack2, n, a, !1) : qe(t.stack2, n, a);
	}
	return i;
}
function Xe(t, e) {
	const n = e.via, s = G(t.state)?.name || t.state, a = G(e.state)?.name || e.state, o = n?.symbol || q.config.sym.eps, i = n?.pop || q.config.sym.eps, r = n?.push || q.config.sym.eps, c = n?.pop2 || q.config.sym.eps, l = n?.push2 || q.config.sym.eps;
	return Ie() ? `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}/${c}) → (${a}, ${r}/${l})` : `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}) → (${a}, ${r})`;
}
function Ye(t, e = null, n = "") {
	const s = t.map((e, n) => {
		const s = {
			state: e.state,
			tokens: e.tokens,
			pos: e.pos,
			stackRef: e.stack,
			branch: e.branch,
			tid: e.via?.id,
			note: 0 === n ? "Start configuration" : Xe(t[n - 1], e)
		};
		return void 0 !== e.stack2 && (s.stackRef2 = e.stack2), void 0 !== e.outNode && (s.outNode = e.outNode, s.outSoFar = e.outRaw), he(s);
	});
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function tn(t, e, n, s) {
	const a = {
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		stackRef: e.stack,
		branch: e.branch,
		note: s,
		final: n
	};
	void 0 !== e.stack2 && (a.stackRef2 = e.stack2), t.push(he(a));
}
function en(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, a = e.tree || null, o = ze(t), i = new gt([o]), r = Je(), c = He(), l = Ge();
	r(o), a && a.root(o.state, o);
	const u = [];
	let h = null, p = 0, d = 0, f = o, m = 2;
	for (; i.length && p < q.config.maxPdaSteps;) {
		const t = i.shift();
		f = t, p++, d = Math.max(d, t.depth);
		const e = u.length < n, s = e ? G(t.state)?.name || t.state : "", o = e ? Ke(t) : "";
		if (c(t)) {
			h = t, a && a.accept(t.tn), e && u.push(`<span class="step-acc">Branch ${t.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${t.depth}.<br>ID: ${o}</span>`);
			break;
		}
		const g = l(t);
		if (!g.length) {
			a && a.expandCfgs(t, []), e && u.push(`Branch ${t.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${o}.<br>Depth ${t.depth}</span>`);
			continue;
		}
		e && nn(u, t, s, o, g);
		const b = a && !a.full ? [] : null;
		g.forEach((e, n) => {
			const s = 1 === g.length || 0 === n ? t.branch : m++, a = Ze(t, e, s), o = r(a);
			o && i.push(a), b && b.push({
				cfg: a,
				fresh: o
			});
		}), b && a.expandCfgs(t, b);
	}
	return a && a.finish((h || f).tn ?? -1), {
		accepted: !!h,
		branches: p,
		maxDepth: d,
		log: u,
		witnessPath: s ? Wt(h || f) : null,
		finalCfg: h || f,
		unresolved: !h && i.length > 0
	};
}
function nn(t, e, n, s, a) {
	const o = e.tokens[e.pos] || q.config.sym.eps, i = We(e.stack, Be()), r = ct() ? "Queue front" : "Stack top", c = [
		`State "${n}" with next input '${o}'`,
		`Depth ${e.depth} · ${r} ${i || q.config.sym.eps}`,
		`ID: ${s}`
	];
	lt() && c.push(`Second stack top ${We(e.stack2 || []) || q.config.sym.eps}`), a.length > 1 && c.push(`Nondeterministic choice: ${a.length} matching transitions.`), t.push(`Branch ${e.branch}: exploring <em>${n}</em><span class="step-sub">${c.join("<br>")}</span>`);
}
function sn(t, e, n) {
	const s = Ze(t, e, n), a = e.output ?? "";
	return s.outRaw = (t.outRaw || "") + a, s.outKey = Kt(t.outKey, a), s.outNode = zt(t.outNode, "" === a ? q.config.sym.lambda : a), s;
}
function an(t, e = null) {
	const n = ze(t);
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
	const s = new gt([n]), a = Je(), o = He(), i = Ge();
	a(n), e && e.root(n.state, n);
	const r = /* @__PURE__ */ new Set();
	let c = null, l = null, u = n, h = 0, p = 0, d = 2;
	for (; s.length && h < q.config.maxPdaSteps;) {
		const t = s.shift();
		u = t, h++, p = Math.max(p, t.depth);
		const n = o(t);
		t.pos >= t.tokens.length && (It(!0, n) && r.add(t.outRaw), l || (l = t)), n && !c && (c = t), n && e && e.accept(t.tn);
		const f = i(t), m = e && !e.full ? [] : null;
		f.forEach((e, n) => {
			const o = 1 === f.length || 0 === n ? t.branch : d++, i = sn(t, e, o), r = a(i);
			r && s.push(i), m && m.push({
				cfg: i,
				fresh: r
			});
		}), m && e.expandCfgs(t, m);
	}
	const f = c || l || u;
	return e && e.finish(f.tn ?? -1), {
		accepted: !!c,
		outputs: r,
		witnessPath: Wt(f),
		finalCfg: f,
		unresolved: !c && s.length > 0,
		branches: h,
		maxDepth: p
	};
}
const on = {
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
}, rn = () => "explicit" === q.config.pdaParadigm ? [
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
], cn = {
	...on,
	deterministicDelta: !0,
	determinism: {
		conflict: (t, e) => function(t, e = q.transitions, n = null) {
			return e.find((e) => {
				return e.id !== n && (a = t, (s = e).from === a.from && function(t, e, n = q.config.sym.eps, s = q.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.symbol, a.symbol) && function(t, e, n = q.config.sym.eps, s = q.config.sym.any) {
					return t === n || e === n || t === s || e === s || t === e;
				}(s.pop, a.pop));
				var s, a;
			}) || null;
		}({
			from: t.from,
			symbol: t.symbol,
			pop: t.pop
		}, q.transitions, e),
		say: (t) => `DPDA already has an overlapping move from ${qt(t.from)}. Switch to NPDA mode if you want branching on the same configuration.`
	},
	simulate: function(t) {
		const e = ze(t);
		if (Ve(e)) return q.simSteps = Ye([e], "accept"), q.simIdx = 0, { accepted: !0 };
		let n = e;
		const s = Je(), a = He(), o = Ge();
		s(n);
		for (let i = 0; i < q.config.maxPdaSteps; i++) {
			const t = o(n);
			if (t.length > 1) return q.simSteps = Ye(Wt(n)), tn(q.simSteps, n, "reject", "Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches."), q.simIdx = 0, { accepted: !1 };
			if (!t.length) return q.simSteps = Ye(Wt(n)), tn(q.simSteps, n, "reject", "No valid transition from this configuration — REJECT"), q.simIdx = 0, { accepted: !1 };
			const e = Ze(n, t[0], n.branch);
			if (!s(e)) return q.simSteps = Ye(Wt(n)), tn(q.simSteps, n, "reject", "Repeated configuration detected — possible ε-loop — REJECT"), q.simIdx = 0, { accepted: !1 };
			if (n = e, a(n)) return q.simSteps = Ye(Wt(n), "accept"), q.simIdx = 0, { accepted: !0 };
		}
		return q.simSteps = Ye(Wt(n)), tn(q.simSteps, n, "reject", "PDA step limit reached — REJECT"), q.simIdx = 0, { accepted: !1 };
	},
	decide: (t) => Rt(function(t) {
		let e = ze(t);
		if (Ve(e)) return !0;
		const n = Je(), s = He(), a = Ge();
		n(e);
		for (let o = 0; o < q.config.maxPdaSteps; o++) {
			const t = a(e);
			if (1 !== t.length) return !1;
			const o = Ze(e, t[0], e.branch);
			if (!n(o)) return !1;
			if (e = o, s(e)) return !0;
		}
		return !1;
	}(t))
}, ln = {
	...on,
	simulate: function(t) {
		const e = en(t, { tree: null });
		return e.accepted ? q.simSteps = Ye(e.witnessPath, "accept") : (q.simSteps = Ye(e.witnessPath), tn(q.simSteps, e.finalCfg, "reject", e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT")), de(q.simSteps, null), q.simIdx = 0, {
			accepted: e.accepted,
			branches: e.branches,
			maxDepth: e.maxDepth,
			log: e.log,
			witnessLength: e.witnessPath.length
		};
	},
	branches: !0,
	decide: (t) => Rt(function(t) {
		return en(t, {
			log: 0,
			witness: !1
		}).accepted;
	}(t))
};
function un(t) {
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
function hn(t) {
	const e = q.config.sym.eps, n = String(null == t ? "" : t).trim();
	return n && n !== e ? n.split("|").map((t) => t.trim()).filter((t) => t && t !== e).map((t) => un(t).reverse()) : [];
}
function pn(t) {
	return !(t.pos < t.tokens.length) && ("explicit" === q.config.pdaParadigm ? q.accepts.has(t.state) : 1 === t.store.length && 0 === t.store.sym.length);
}
function dn(t) {
	const e = q.config.sym.eps, n = q.config.sym.any, s = t.store.sym.sym;
	return Tt(t.state).filter((a) => (a.symbol === e || t.pos < t.tokens.length && (a.symbol === t.tokens[t.pos] || a.symbol === n)) && function(t, e) {
		const { eps: n, any: s } = q.config.sym;
		return e === n || void 0 !== t && (e === t || e === s);
	}(s, a.pop || e));
}
function fn(t, e, n = t.branch) {
	const { eps: s, any: a } = q.config.sym, o = t.ctx;
	let i, r = t.store.sym;
	(e.pop || s) !== s && r.length && (i = r.sym, r = r.below);
	let c = e.push && e.push !== s ? e.push : "";
	if (c === a && (c = i || ""), c) {
		const t = function(t, e) {
			let n = t.pushes.get(e);
			return n || t.pushes.set(e, n = un(e)), n;
		}(o, c);
		for (let e = t.length - 1; e >= 0; e--) r = Jt(r, t[e]);
	}
	let l = t.store.below;
	for (const u of mn(o, e.below)) l = Jt(l, u);
	l = Jt(l, r);
	for (const u of mn(o, e.above)) l = Jt(l, u);
	for (; l.length > 1 && 0 === l.sym.length;) l = l.below;
	return {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		store: l,
		ctx: o,
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
}
function mn(t, e) {
	const n = e ?? "";
	let s = t.lists.get(n);
	return s || (s = hn(e).map((e) => e.reduce((t, e) => Jt(t, e), t.inner)), t.lists.set(n, s)), s;
}
function gn(t) {
	return `(${G(t.state)?.name || t.state}, ${t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : q.config.sym.eps}, ${function(t) {
		const e = q.config.sym.eps;
		return t.length ? t.map((t) => {
			return t.length ? (n = [...t].reverse()).some((t) => String(t).length > 1) ? n.join(" ") : n.join("") : e;
			var n;
		}).join(" | ") : e;
	}((e = t.store, Array.isArray(e) ? e : Vt(e).map(Vt)))})`;
	var e;
}
function bn(t, e) {
	const n = e.via, s = q.config.sym.eps, a = G(t.state)?.name || t.state, o = G(e.state)?.name || e.state, i = [`(${a}, ${n?.symbol || s}, ${n?.pop || s}) → (${o}, ${n?.push || s}`], r = hn(n?.below), c = hn(n?.above);
	return r.length && i.push(`, ${r.length} below`), c.length && i.push(`, ${c.length} above`), i.push(")"), `Branch ${e.branch} depth ${e.depth}: ${i.join("")} · ${e.store.length} stack${1 === e.store.length ? "" : "s"}`;
}
function yn(t, e = null, n = "") {
	const s = t.map((e, n) => pe({
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		storeRef: e.store,
		branch: e.branch,
		tid: e.via?.id,
		note: 0 === n ? "Start configuration" : bn(t[n - 1], e)
	}));
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function kn(t, e) {
	return t.length <= e.stacks && t.size <= e.symbols;
}
function wn(t, e = {}) {
	const n = e.log ?? 10, s = !1 !== e.witness, a = e.tree || null, o = function(t) {
		const e = {
			sym: void 0,
			below: null,
			length: 0,
			size: 0,
			id: 0,
			kids: null,
			arr: null,
			trie: { next: 1 }
		}, n = "explicit" === q.config.pdaParadigm ? Jt(e, q.config.sym.stackBottom) : e;
		return {
			state: U(),
			tokens: t,
			pos: 0,
			store: Jt({
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
	}(t), i = new gt([o]), r = new bt(), c = yt(), l = (t) => r.add(c(t.state), t.pos, t.store.id, -1, -1);
	l(o), a && a.root(o.state, o);
	const u = [];
	let h = null, p = 0, d = 0, f = 1, m = o, g = 2;
	const b = function(t = []) {
		const e = t.length + 2;
		return {
			stacks: e + 4,
			symbols: 16 * (e + 4)
		};
	}(t);
	let y = !1;
	for (; i.length && p < q.config.maxPdaSteps;) {
		const t = i.shift();
		m = t, p++, d = Math.max(d, t.depth), f = Math.max(f, t.store.length);
		const e = u.length < n;
		if (pn(t)) {
			h = t, a && a.accept(t.tn), e && u.push(`<span class="step-acc">Branch ${t.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${t.depth}.<br>ID: ${gn(t)}</span>`);
			break;
		}
		const s = dn(t);
		if (!s.length) {
			a && a.expandCfgs(t, []), e && u.push(`Branch ${t.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${gn(t)}.<br>Depth ${t.depth}</span>`);
			continue;
		}
		if (e) {
			const e = G(t.state)?.name || t.state, n = [
				`State "${e}" with next input '${t.tokens[t.pos] || q.config.sym.eps}'`,
				`Depth ${t.depth} · ${t.store.length} stack${1 === t.store.length ? "" : "s"} · top ${t.store.sym.sym || q.config.sym.eps}`,
				`ID: ${gn(t)}`
			];
			s.length > 1 && n.push(`Nondeterministic choice: ${s.length} matching transitions.`), u.push(`Branch ${t.branch}: exploring <em>${e}</em><span class="step-sub">${n.join("<br>")}</span>`);
		}
		const o = a && !a.full ? [] : null;
		s.forEach((e, n) => {
			const a = 1 === s.length || 0 === n ? t.branch : g++, r = fn(t, e, a);
			if (!kn(r.store, b)) return void (y = !0);
			const c = l(r);
			c && i.push(r), o && o.push({
				cfg: r,
				fresh: c
			});
		}), o && a.expandCfgs(t, o);
	}
	return a && a.finish((h || m).tn ?? -1), {
		accepted: !!h,
		branches: p,
		maxDepth: d,
		maxStacks: f,
		log: u,
		capped: y,
		witnessPath: s ? Wt(h || m) : null,
		finalCfg: h || m,
		unresolved: !h && (i.length > 0 || y)
	};
}
ot(on, {
	DPDA: {
		...cn,
		formal: {
			tuple: rn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	PDA: {
		...cn,
		formal: {
			tuple: rn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	NPDA: {
		...ln,
		formal: {
			tuple: rn,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Γ*)"
		}
	},
	QA: {
		...ln,
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
		...ln,
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
		...ln,
		schema: {
			...on.schema,
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
		...on,
		simulate: function(t) {
			const e = an(t, null), n = q.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, a = n ? e.accepted ? "Accepting run found" : e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting run found" : "";
			q.simSteps = Ye(e.witnessPath, s, a);
			const o = q.simSteps[q.simSteps.length - 1];
			if (o) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? o.note += ` | Output: "${t[0]}"` : o.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : o.note += " | Output: \"\"";
			}
			return de(q.simSteps, null), q.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = an(t), n = [...e.outputs];
				return {
					accepted: e.accepted,
					output: n.length ? n[0] : "",
					outputs: n
				};
			}(t);
			return Bt(e.accepted, e.output);
		},
		schema: {
			...on.schema,
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
const vn = {
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
at("EPDA", {
	branches: !0,
	...vn,
	storeLabels: [
		"Stack of stacks",
		"Pop",
		"Push"
	],
	schema: {
		...vn.schema,
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
		const e = wn(t, { tree: null });
		var n, s, a;
		return e.accepted ? q.simSteps = yn(e.witnessPath, "accept") : (q.simSteps = yn(e.witnessPath), n = q.simSteps, s = e.finalCfg, a = e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", n.push(pe({
			state: s.state,
			tokens: s.tokens,
			pos: s.pos,
			storeRef: s.store,
			branch: s.branch,
			note: a,
			final: "reject"
		}))), de(q.simSteps, null), q.simIdx = 0, e;
	},
	decide: (t) => function(t) {
		const e = wn(t, {
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
		tuple: () => "explicit" === q.config.pdaParadigm ? [
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
const $n = 2147483647, Sn = 2147483629, An = 911382323, Tn = 972663749;
function xn(t, e, n) {
	return (t * Math.floor(e / 65536) % n * 65536 + t * (e % 65536)) % n;
}
function Nn(t, e, n) {
	let s = 1;
	for (t %= n; e > 0;) e % 2 == 1 && (s = xn(s, t, n)), t = xn(t, t, n), e = Math.floor(e / 2);
	return s;
}
const Mn = /* @__PURE__ */ new Map(), Pn = [[1], [1]];
function En(t) {
	if (t >= 0 && t < 1048576) {
		const e = Pn[0], n = Pn[1];
		for (; e.length <= t;) e.push(xn(e[e.length - 1], An, $n)), n.push(xn(n[n.length - 1], Tn, Sn));
		return Fn[0] = e[t], Fn[1] = n[t], Fn;
	}
	let e = Mn.get(t);
	if (e) return e;
	Mn.size > 65536 && Mn.clear();
	const n = (t % 2147483628 + 2147483628) % 2147483628;
	return e = [Nn(An, (t % 2147483646 + 2147483646) % 2147483646, $n), Nn(Tn, n, Sn)], Mn.set(t, e), e;
}
const Fn = [1, 1], Dn = /* @__PURE__ */ new Map(), Cn = {
	off: 0,
	h1: 0,
	h2: 0
};
function jn(t, e) {
	return void 0 === t || t === e ? null : function(t) {
		let e = Dn.get(t);
		if (e) return e;
		let n = 2166136261;
		for (let s = 0; s < t.length; s++) n = Math.imul(n ^ t.charCodeAt(s), 16777619) >>> 0;
		return e = [1 + n % 2147483646, 1 + (Math.imul(n ^ n >>> 15, 2246822519) >>> 0) % 2147483628], Dn.set(t, e), e;
	}(String(t));
}
function On(t, e, n, s) {
	if (n === s) return;
	let a = (s ? s[0] : 0) - (n ? n[0] : 0), o = (s ? s[1] : 0) - (n ? n[1] : 0);
	a < 0 && (a += $n), o < 0 && (o += Sn);
	const i = En(e - t.lo);
	t.h1 = (t.h1 + xn(a, i[0], $n)) % $n, t.h2 = (t.h2 + xn(o, i[1], Sn)) % Sn;
}
function Qn(t) {
	let e = 1 / 0;
	for (const n of t.keys()) n < e && (e = n);
	return e;
}
var Rn = class t {
	constructor(t = [], e = "⊔", n = !1, s = {}) {
		this.blank = e, this.twoWay = !!n, this.rightBound = s.rightBound ?? null, this.immutable = s.immutable || null, this.head = 0, this.cells = /* @__PURE__ */ new Map(), t.forEach((t, e) => this.cells.set(e, t));
	}
	read() {
		return this.cells.has(this.head) ? this.cells.get(this.head) : this.blank;
	}
	write(t) {
		if (this.immutable && this.immutable.has(this.read())) return !1;
		const e = this._fp, n = e ? jn(this.cells.get(this.head), this.blank) : null;
		return t === this.blank ? this.cells.delete(this.head) : this.cells.set(this.head, t), e && (On(e, this.head, n, jn(t, this.blank)), t !== this.blank ? this.head < e.min && (e.min = this.head) : this.head === e.min && (e.min = Qn(this.cells))), !0;
	}
	trackFingerprint() {
		const t = {
			h1: 0,
			h2: 0,
			min: Qn(this.cells),
			lo: 0
		};
		for (const [e, n] of this.cells) On(t, e, null, jn(n, this.blank));
		return this._fp = t, this;
	}
	fingerprint() {
		const t = this.fingerprintParts();
		return `${t.off}|${t.h1}|${t.h2}`;
	}
	fingerprintParts() {
		const t = this._fp, e = this.twoWay ? Math.min(this.head, t.min) : 0;
		if (e !== t.lo) {
			const n = En(t.lo - e);
			t.h1 = xn(t.h1, n[0], $n), t.h2 = xn(t.h2, n[1], Sn), t.lo = e;
		}
		const n = Cn;
		return n.off = this.head - e, n.h1 = t.h1, n.h2 = t.h2, n;
	}
	move(t) {
		const e = "R" === t ? 1 : "L" === t ? -1 : 0, n = this.head + e;
		return !(!this.twoWay && n < 0 || null !== this.rightBound && n > this.rightBound || (this.head = n, 0));
	}
	snapshot() {
		let t = this.head, e = this.head;
		for (const o of this.cells.keys()) o < t && (t = o), o > e && (e = o);
		const n = this.twoWay ? t : 0, s = null !== this.rightBound ? this.rightBound : Math.max(e, n), a = [];
		for (let o = n; o <= s; o++) a.push(this.cells.has(o) ? this.cells.get(o) : this.blank);
		return {
			tape: a,
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
function Bn(t, e) {
	return `${t}|${e.map((t) => t.key()).join("")}`;
}
function In(t) {
	const e = t.blank, n = t.twoWay, s = t.rightBound, a = t.immutable ? [...t.immutable] : [], o = new Map(t.cells), i = [], r = [], c = [];
	let l = null;
	function u(t, e) {
		const n = r[e];
		void 0 !== n && (void 0 === c[e] ? t.delete(n) : t.set(n, c[e]));
	}
	function h(t) {
		if (l && l.i === t && l.frame) return l.frame;
		const a = function(t) {
			let e, n;
			l && l.i <= t ? (e = l.cells, n = l.i) : (e = new Map(o), n = 0);
			for (let s = n; s < t; s++) u(e, s);
			return e;
		}(t), r = i[t] ?? 0;
		let c, h = 0;
		if (n) {
			h = r;
			for (const t of a.keys()) t < h && (h = t);
		}
		if (null !== s) c = s;
		else {
			c = r > h ? r : h;
			for (const t of a.keys()) t > c && (c = t);
		}
		const p = [];
		for (let n = h; n <= c; n++) p.push(a.has(n) ? a.get(n) : e);
		const d = {
			tape: p,
			head: r - h,
			origin: h
		};
		return l = {
			i: t,
			cells: a,
			frame: d
		}, d;
	}
	return {
		begin(t) {
			const e = i.length;
			return i.push(t), r.push(void 0), c.push(void 0), e;
		},
		noteWrite(t, e, n) {
			r[t] = e, c[t] = n.has(e) ? n.get(e) : void 0;
		},
		frameAt: h,
		journal: () => ({
			initial: o,
			heads: i,
			wCell: r,
			wSym: c,
			blank: e,
			twoWay: n,
			rightBound: s,
			markers: a,
			leftBound: n ? null : 0
		}),
		viewAt(t) {
			const o = h(t);
			return {
				kind: "tape",
				cells: o.tape,
				head: o.head,
				origin: o.origin,
				leftBound: n ? null : 0,
				rightBound: s,
				markers: a,
				blank: e,
				readOnly: !1
			};
		}
	};
}
const Wn = {
	get tape() {
		return this._log.frameAt(this._i).tape;
	},
	get head() {
		return this._log.frameAt(this._i).head;
	},
	get view() {
		return this._log.viewAt(this._i);
	}
}, Ln = {
	get tapes() {
		return this._logs.map((t) => t.frameAt(this._i).tape);
	},
	get heads() {
		return this._logs.map((t) => t.frameAt(this._i).head);
	},
	get views() {
		return this._logs.map((t) => t.viewAt(this._i));
	}
};
function qn(t, e, n, s) {
	const a = Object.create(void 0 === s ? Wn : ce(Wn));
	return a._log = t, a._i = e, void 0 !== s && (a._note = s), Object.assign(a, n);
}
function _n(t, e, n, s) {
	const a = Object.create(void 0 === s ? Ln : ce(Ln));
	return a._logs = t, a._i = e, void 0 !== s && (a._note = s), Object.assign(a, n);
}
var zn = class t {
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
		let a = s;
		for (let o = t.length - 1; o >= 1; o--) a = Jt(a, t[o]);
		this.right = a;
	}
	read() {
		return this.cell;
	}
	write(t) {
		return this.cell = t, !0;
	}
	move(t) {
		if ("R" === t) {
			!this.left.length && this.cell === this.blank && this.twoWay || (this.left = Jt(this.left, this.cell));
			const t = this.right;
			return this.cell = t.length ? t.sym : this.blank, t.length && (this.right = t.below), this.head++, !0;
		}
		if ("L" === t) {
			if (!this.twoWay && 0 === this.head) return !1;
			(this.right.length || this.cell !== this.blank) && (this.right = Jt(this.right, this.cell));
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
		const t = Vt(this.left).slice();
		t.push(this.cell);
		const e = Vt(this.right);
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
function* Jn(t) {
	const e = q.config.sym.blank, n = Z(), s = new Rn(t, e, n).trackFingerprint(), a = In(s);
	let o = U(), i = null;
	const r = Et(), c = xt();
	let l = null;
	const u = (a) => Yn(() => new Rn(t, e, n), a) === (l ??= `${o}|${s.key()}`);
	let h = null, p = 0;
	for (; p < q.config.maxTmSteps; p++) {
		const e = s.read(), d = o, f = s.head, m = a.begin(s.head);
		if (h = qn(a, m, {
			state: o,
			tokens: t,
			tid: i
		}, () => `State:${G(d)?.name} Read:'${e}'${n ? ` @${f}` : ""}`), q.accepts.has(o)) return h.final = "accept", h.note += " — ACCEPT", void (yield h);
		l = null;
		const g = s.fingerprintParts(), b = r.seenAtVerified(o, g.off, g.h1, g.h2, p, u);
		if (b >= 0) return Ct(h, b), void (yield h);
		const y = c(o, e);
		if (!y) return h.final = "reject", h.note += " — REJECT", void (yield h);
		yield h;
		const k = s.head;
		s.write(y.write && y.write !== q.config.sym.any ? y.write : e), a.noteWrite(m, k, s.cells), o = y.to, i = y.id, s.move(y.dir);
	}
	h && !h.final && jt(h);
}
function Vn(t) {
	pt(Jn(t));
}
function Kn(t) {
	const e = q.config.sym.blank, n = Z();
	if (zn.fits(t, e)) {
		const s = new bt(), a = yt(), o = yt();
		return {
			start: new zn(t, e, n),
			seen: (t, e) => s.add(a(t), e.left.id, o(e.cell), e.right.id, 0)
		};
	}
	const s = /* @__PURE__ */ new Set();
	return {
		start: new Rn(t, e, n),
		seen: (t, e) => {
			const n = `${t}|${e.key()}`;
			return !s.has(n) && (s.add(n), !0);
		}
	};
}
function Un() {
	const t = q.config.sym.any, e = /* @__PURE__ */ new Map();
	return (n, s) => {
		let a = e.get(n);
		void 0 === a && e.set(n, a = /* @__PURE__ */ new Map());
		let o = a.get(s);
		return void 0 === o && a.set(s, o = Tt(n).filter((e) => e.symbol === s || e.symbol === t)), o;
	};
}
const Gn = {
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
function* Hn(t) {
	const { start: e, seen: n } = Kn(t), s = Un(), o = new gt([{
		state: U(),
		tape: e,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}]);
	n(U(), e);
	let c = !1, l = 0, u = 0;
	const h = [];
	let p = 2, d = null;
	for (; o.length && l < q.config.maxTmSteps;) {
		const e = o.shift(), { state: a, depth: f, branch: m } = e, g = e.tape.read(), b = G(a)?.name || a, y = h.length < 10, k = y ? e.tape.snapshot() : null, w = y ? Ot(a, k.tape, k.head) : "";
		l++, u = Math.max(u, f);
		const v = Object.assign(Object.create(Gn), {
			state: a,
			tokens: t,
			_tape: e.tape,
			branch: m,
			parent: e.parent,
			via: e.via,
			depth: f,
			tn: e.tn ?? -1,
			note: `Branch ${m} depth ${f}: ${b} reads '${g}'`
		});
		if (q.accepts.has(a)) {
			e.tn, v.final = "accept", v.note += " — ACCEPT", d = v, yield v, y && h.push(`<span class="step-acc">Branch ${m}: ACCEPT ✓</span><span class="step-sub">State "${b}" is accepting.<br>Depth ${f} · ID: ${w}</span>`), c = !0;
			break;
		}
		const $ = s(a, g);
		if (!$.length) {
			v.note += " — dead branch", d = v, yield v, y && h.push(`Branch ${m}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches (${b}, '${g}').<br>Depth ${f} · ID: ${w}</span>`);
			continue;
		}
		if (v.note += $.length > 1 ? ` — branching ×${$.length}` : " — deterministic step", d = v, yield v, y) {
			const t = [`Read '${g}' at head position ${e.tape.twoWay ? e.tape.head : k.head}.`, `Depth ${f} · ID: ${w}`];
			$.length > 1 && t.push(`Nondeterministic choice: ${$.length} matching transitions.`), h.push(`Branch ${m}: exploring <em>${b}</em><span class="step-sub">${t.join("<br>")}</span>`);
		}
		$.forEach((t) => {
			const s = e.tape.clone();
			if (s.write(t.write && t.write !== q.config.sym.any ? t.write : g), s.move(t.dir), !n(t.to, s)) return void 0;
			const a = {
				state: t.to,
				tape: s,
				depth: f + 1,
				branch: p++,
				parent: m,
				via: t.id
			};
			o.push(a);
		});
	}
	if (!c) {
		const n = o.length > 0, s = n ? `NO VERDICT: exploration limit ${q.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", a = d?.tape || e.snapshot().tape, i = d?.head ?? 0;
		yield {
			state: d?.state || U(),
			tokens: t,
			tape: [...a],
			head: i,
			note: s,
			final: n ? "timeout" : "reject",
			limit: n ? q.config.maxTmSteps : void 0
		}, h.push(`${o.length ? "Exploration limit reached" : "Reject"}<span class="step-sub">${s}.<br>Branches explored: ${l} · max depth ${u}</span>`);
	}
	return {
		accepted: c,
		branches: l,
		maxDepth: u,
		log: h
	};
}
function Zn(t, e, n, s) {
	const a = Array.isArray(e) ? null : Array.isArray(e?.tapes) ? e.tapes : null;
	return a ? Array.from({ length: t }, (t, e) => new Rn(a[e] || [], n, s)) : function(t, e, n, s) {
		return Array.from({ length: t }, (t, a) => new Rn(0 === a ? e : [], n, s));
	}(t, Array.isArray(e) ? e : [], n, s);
}
function Xn(t, e, n) {
	const s = q.config.sym.any;
	for (let a = 0; a < t.length; a++) {
		const o = e.tapeWrites?.[a];
		t[a].write(o && o !== s ? o : n[a]);
	}
	for (let a = 0; a < t.length; a++) t[a].move(e.tapeDirs?.[a]);
}
function Yn(t, e) {
	const n = q.config.sym.any, s = t(), a = xt();
	let o = U();
	for (let i = 0; i < e; i++) {
		const t = s.read(), e = a(o, t);
		if (!e) break;
		s.write(e.write && e.write !== n ? e.write : t), s.move(e.dir), o = e.to;
	}
	return `${o}|${s.key()}`;
}
function ts(t, e, n) {
	const s = Zn(t, e, q.config.sym.blank, Z()), a = Pt();
	let o = U();
	for (let i = 0; i < n; i++) {
		const t = s.map((t) => t.read()), e = a(o, t);
		if (!e) break;
		Xn(s, e, t), o = e.to;
	}
	return Bn(o, s);
}
const es = {
	off: 0,
	h1: 0,
	h2: 0
};
function ns(t) {
	let e = 0, n = 0, s = 0;
	for (const a of t) {
		const t = a.fingerprintParts();
		e = Math.imul(e, 668265263) + t.off | 0, n = Math.imul(n, 2654435761) + t.h1 | 0, s = Math.imul(s, 2246822519) + t.h2 | 0;
	}
	return es.off = e, es.h1 = n, es.h2 = s, es;
}
function* ss(t) {
	const e = q.tapeCount, n = q.config.sym.blank, s = Z(), a = function(t) {
		return Array.isArray(t) ? t : t?.tapes?.[0] || [];
	}(t), o = Zn(e, t, n, s);
	o.forEach((t) => t.trackFingerprint());
	let i = U(), r = null;
	const c = o.map((t) => In(t)), l = Et(), u = Pt();
	let h = null;
	const p = (n) => ts(e, t, n) === (h ??= Bn(i, o));
	let d = null;
	for (let f = 0; f < q.config.maxTmSteps; f++) {
		const t = o.map((t) => t.read()), e = i, n = s ? o.map((t) => t.head) : null, m = c[0].begin(o[0].head);
		for (let s = 1; s < c.length; s++) c[s].begin(o[s].head);
		if (d = _n(c, m, {
			state: i,
			tokens: a,
			tid: r
		}, () => `State:${G(e)?.name} Read:[${t.join(",")}]${n ? ` @[${n.join(",")}]` : ""}`), q.accepts.has(i)) return d.final = "accept", d.note += " — ACCEPT", void (yield d);
		h = null;
		const g = ns(o), b = l.seenAtVerified(i, g.off, g.h1, g.h2, f, p);
		if (b >= 0) return Ct(d, b), void (yield d);
		const y = u(i, t);
		if (!y) return d.final = "reject", d.note += " — REJECT", void (yield d);
		yield d;
		const k = o.map((t) => t.head);
		Xn(o, y, t);
		for (let s = 0; s < c.length; s++) c[s].noteWrite(m, k[s], o[s].cells);
		i = y.to, r = y.id;
	}
	d && !d.final && jt(d);
}
function* as(t) {
	const e = is(t).trackFingerprint(), n = In(e);
	let s = U(), a = null;
	const o = Et(), i = xt();
	let r = null;
	const c = (n) => Yn(() => is(t), n) === (r ??= `${s}|${e.key()}`);
	let l = null;
	for (let u = 0; u < q.config.maxTmSteps; u++) {
		const h = e.read(), p = n.begin(e.head), d = s;
		if (l = qn(n, p, {
			state: s,
			tokens: t,
			tid: a
		}, () => `State:${G(d)?.name} Read:'${h}'`), q.accepts.has(s)) return l.final = "accept", l.note += " — ACCEPT", void (yield l);
		r = null;
		const f = e.fingerprintParts(), m = o.seenAtVerified(s, f.off, f.h1, f.h2, u, c);
		if (m >= 0) return Ct(l, m), void (yield l);
		const g = i(s, h);
		if (!g) return l.final = "reject", l.note += " — REJECT", void (yield l);
		yield l;
		const b = e.head;
		e.write(g.write && g.write !== q.config.sym.any ? g.write : h), n.noteWrite(p, b, e.cells), s = g.to, a = g.id;
		const y = "L" === g.dir ? q.config.sym.leftMarker : q.config.sym.rightMarker;
		if (!e.move(g.dir)) return l = qn(n, n.begin(e.head), {
			state: s,
			tokens: t,
			tid: a,
			note: `Attempted to move outside the ${y} boundary. — REJECT`,
			final: "reject"
		}), void (yield l);
	}
	l && !l.final && jt(l);
}
function os(t, e) {
	e = e || _t();
	const n = q.config.sym.any, s = q.config.sym.blank, a = Z(), o = new Rn(t, s, a).trackFingerprint(), i = q.accepts, r = xt();
	let c = U();
	const l = Dt((e) => Yn(() => new Rn(t, s, a), e), () => `${c}|${o.key()}`);
	for (let u = 0; u < e; u++) {
		if (i.has(c)) return "acc";
		const t = o.fingerprintParts();
		if (l(c, t.off, t.h1, t.h2, u)) return "rej";
		const e = o.read(), s = r(c, e);
		if (!s) return "rej";
		o.write(s.write && s.write !== n ? s.write : e), o.move(s.dir), c = s.to;
	}
	return "unk";
}
function is(t) {
	const { leftMarker: e, rightMarker: n, blank: s } = q.config.sym;
	return new Rn(rt(t), s, !1, {
		rightBound: t.length + 1,
		immutable: /* @__PURE__ */ new Set([e, n])
	});
}
const rs = {
	conflict: (t, e) => Lt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has δ(${qt(t.from)}, '${t.symbol}'). Use NDTM mode if you want multiple choices for the same read symbol.`
}, cs = {
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
}, ls = (t) => (e, n = {}) => ({
	verdict: t(e, n.budget),
	output: null
});
function* us(t) {
	let e = U();
	const n = xt(), s = G(e), a = s?.output ?? "";
	let o = a, i = zt(null, a), r = ue({
		state: e,
		tokens: t,
		outNode: i,
		outSoFar: o,
		note: `Start: ${s?.name} — ${q.config.sym.lambda}: '${a}'`
	});
	yield r;
	for (let l = 0; l < t.length; l++) {
		const s = t[l], a = n(e, s);
		if (!a) {
			r = ue({
				state: e,
				tokens: t,
				outNode: i,
				outSoFar: o,
				note: `No δ(${G(e)?.name},'${s}') — HALT`,
				final: "reject"
			}), yield r;
			break;
		}
		e = a.to;
		const c = G(e), u = c?.output ?? "";
		o += u, i = zt(i, u), r = ue({
			state: e,
			tokens: t,
			outNode: i,
			outSoFar: o,
			tid: a.id
		}, () => `Read '${s}' → ${c?.name} — ${q.config.sym.lambda}: '${u}'`), yield r;
	}
	const c = q.config.transducerAccepts;
	!r.final && c && (r.final = q.accepts.has(e) ? "accept" : "reject", r.note += ` — ${r.final.toUpperCase()}`), r.note += ` | Output: "${o}"`;
}
function* hs(t) {
	let e = U();
	const n = xt();
	let s = "", a = null, o = ue({
		state: e,
		tokens: t,
		outNode: a,
		outSoFar: s,
		note: `Start: ${G(e)?.name}`
	});
	yield o;
	for (let r = 0; r < t.length; r++) {
		const i = t[r], c = n(e, i);
		if (!c) {
			o = ue({
				state: e,
				tokens: t,
				outNode: a,
				outSoFar: s,
				note: `No δ(${G(e)?.name},'${i}') — HALT`,
				final: "reject"
			}), yield o;
			break;
		}
		const l = c.output ?? "?";
		s += l, a = zt(a, l);
		const u = e = c.to;
		o = ue({
			state: e,
			tokens: t,
			outNode: a,
			outSoFar: s,
			tid: c.id
		}, () => `Read '${i}' → ${G(u)?.name} — out: '${l}'`), yield o;
	}
	const i = q.config.transducerAccepts;
	!o.final && i && (o.final = q.accepts.has(e) ? "accept" : "reject", o.note += ` — ${o.final.toUpperCase()}`), s.length && (o.note += ` | Output: "${s}"`);
}
function ps(t, e) {
	const n = q.config.sym.eps;
	return Tt(t.state).filter((s) => s.symbol === n || !(t.index >= e.length) && (s.symbol === e[t.index] || s.symbol === q.config.sym.any));
}
function ds(t, e, n) {
	const s = q.config.sym.eps, a = e.output ?? "", o = "" === a ? q.config.sym.lambda : a, i = e.symbol !== s;
	return {
		state: e.to,
		index: i ? t.index + 1 : t.index,
		depth: t.depth + 1,
		branch: n,
		outRaw: t.outRaw + a,
		outKey: Kt(t.outKey, a),
		outNode: zt(t.outNode, o),
		parent: t,
		via: e
	};
}
function fs(t, e = null) {
	const n = {
		state: U(),
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
	}, s = new gt([n]), a = new bt(), o = yt(), i = (t) => a.add(o(t.state), t.index, t.outKey.id, -1, -1);
	i(n), e && e.root(n.state, n);
	const r = /* @__PURE__ */ new Set();
	let c = null, l = null, u = n, h = 0, p = 0, d = 2;
	for (; s.length && h < q.config.maxPdaSteps;) {
		const n = s.shift();
		if (u = n, h++, p = Math.max(p, n.depth), n.index === t.length) {
			const t = q.accepts.has(n.state);
			It(!0, t) && r.add(n.outRaw), l || (l = n), q.config.transducerAccepts && t && !c && (c = n), e && It(!0, t) && e.accept(n.tn);
		}
		const a = ps(n, t), o = e && !e.full ? [] : null;
		a.forEach((t, e) => {
			const r = 1 === a.length || 0 === e ? n.branch : d++, c = ds(n, t, r), l = i(c);
			l && s.push(c), o && o.push({
				cfg: c,
				fresh: l
			});
		}), o && e.expandCfgs(n, o);
	}
	const f = c || l || u;
	return e && e.finish(f.tn ?? -1), {
		accepted: !!c,
		witnessPath: Wt(f),
		finalCfg: f,
		outputs: r,
		unresolved: !c && s.length > 0,
		branches: h,
		maxDepth: p
	};
}
ot(cs, {
	TM: {
		simulate: Vn,
		stream: Jn,
		decide: ls(os),
		deterministicDelta: !0,
		determinism: rs
	},
	NDTM: {
		simulate: function(t) {
			return pt(Hn(t));
		},
		stream: Hn,
		branches: !0,
		decide: ls(function(t, e) {
			e = e || _t();
			const n = q.config.sym.any, s = q.accepts, { start: a, seen: o } = Kn(t), i = Un(), r = new gt([{
				state: U(),
				tape: a
			}]);
			o(U(), a);
			let c = 0;
			for (; r.length;) {
				if (c++ >= e) return "unk";
				const t = r.shift();
				if (s.has(t.state)) return "acc";
				const a = t.tape.read();
				for (const e of i(t.state, a)) {
					const s = t.tape.clone();
					s.write(e.write && e.write !== n ? e.write : a), s.move(e.dir), o(e.to, s) && r.push({
						state: e.to,
						tape: s
					});
				}
			}
			return "rej";
		}),
		formal: {
			...cs.formal,
			delta: () => "Q × Γ → P(Q × Γ × {L, R, S})"
		}
	},
	MTM: {
		deterministicDelta: !0,
		multiTape: !0,
		options: ["tapeCount", "twoWayTape"],
		determinism: {
			conflict: (t, e) => q.transitions.find((n) => n.id !== e && n.from === t.from && function(t = [], e = [], n = q.config.sym.any) {
				return !(!Array.isArray(t) || !Array.isArray(e) || t.length !== e.length) && t.every((t, s) => ut(t, e[s], n));
			}(n.tapeSyms || [n.symbol], t.tapeSyms || [])) || null,
			say: (t) => `MTM already has a transition for (${qt(t.from)}, [${(t.tapeSyms || []).join(", ")}]). Each read tuple must be unique.`
		},
		simulate: function(t) {
			pt(ss(t));
		},
		stream: ss,
		decide: ls(function(t, e) {
			e = e || _t();
			const n = q.tapeCount || 2, s = Zn(n, t, q.config.sym.blank, Z());
			s.forEach((t) => t.trackFingerprint());
			const a = q.accepts, o = Pt();
			let i = U();
			const r = Dt((e) => ts(n, t, e), () => Bn(i, s));
			for (let c = 0; c < e; c++) {
				if (a.has(i)) return "acc";
				const t = ns(s);
				if (r(i, t.off, t.h1, t.h2, c)) return "rej";
				const e = s.map((t) => t.read()), n = o(i, e);
				if (!n) return "rej";
				Xn(s, n, e), i = n.to;
			}
			return "unk";
		}),
		parseInput: function(t) {
			if (!String(t).includes(",")) return Qt(t);
			const e = String(t).split(",");
			if (e.length !== q.tapeCount) return {
				ok: !1,
				error: `MTM: found ${e.length} comma-separated segment(s) but machine has ${q.tapeCount} tape(s). Provide one value per tape.`
			};
			const n = [];
			for (let s = 0; s < e.length; s++) {
				const t = e[s].trim(), a = dt(t === q.config.sym.eps ? "" : t);
				if (null === a) return {
					ok: !1,
					error: `Tape ${s + 1}: cannot tokenize "${t}" using alphabet {${[...q.sigma].join(", ")}}.`
				};
				n.push(a);
			}
			return {
				ok: !0,
				input: { tapes: n },
				tokens: null
			};
		},
		schema: {
			...cs.schema,
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
			...cs.formal,
			delta: () => {
				const t = q.tapeCount || 2;
				return `Q × Γ^${t} → Q × Γ^${t} × {L, R, S}^${t}`;
			}
		}
	},
	LBA: {
		simulate: function(t) {
			pt(as(t));
		},
		stream: as,
		decide: ls(function(t, e) {
			e = e || _t();
			const n = q.config.sym.any, s = is(t).trackFingerprint(), a = q.accepts, o = xt();
			let i = U();
			const r = Dt((e) => Yn(() => is(t), e), () => `${i}|${s.key()}`);
			for (let c = 0; c < e; c++) {
				if (a.has(i)) return "acc";
				const t = s.fingerprintParts();
				if (r(i, t.off, t.h1, t.h2, c)) return "rej";
				const e = s.read(), l = o(i, e);
				if (!l) return "rej";
				if (s.write(l.write && l.write !== n ? l.write : e), i = l.to, !s.move(l.dir)) return "rej";
			}
			return "unk";
		}),
		deterministicDelta: !0,
		determinism: rs,
		options: []
	},
	ITM: {
		simulate: function(t) {
			return Vn(t);
		},
		stream: function(t) {
			return Jn(t);
		},
		decide: ls(function(t, e) {
			return os(t, e);
		}),
		deterministicDelta: !0,
		determinism: rs,
		options: []
	}
});
const ms = {
	conflict: (t, e) => Lt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has δ(${qt(t.from)}, '${t.symbol}'). Each input symbol must map to one output.`
}, gs = {
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
function bs(t) {
	return "R" === t ? 1 : "L" === t ? -1 : 0;
}
function ys(t, e) {
	return e;
}
function ks(t, e) {
	const { left: n, right: s } = et();
	return {
		kind: "tape",
		cells: t,
		head: e,
		origin: 0,
		leftBound: 0,
		rightBound: t.length - 1,
		markers: [n, s],
		blank: q.config.sym.blank,
		readOnly: !0
	};
}
function ws(t, e) {
	const n = q.config.sym.any;
	return Tt(t).filter((t) => t.symbol === e || t.symbol === n);
}
function vs(t, e, n = null, s = "") {
	const a = function(t) {
		return rt(t);
	}(e), o = t.map((n, s) => {
		const o = G(n.state)?.name || n.state, i = {
			state: n.state,
			tokens: e,
			tape: a,
			head: ys(0, n.head),
			view: ks(a, ys(0, n.head)),
			branch: n.branch,
			tid: n.via?.id,
			note: ""
		}, r = void 0 !== n.outNode;
		r && (i.outNode = n.outNode, i.outSoFar = n.outRaw);
		const c = r ? ue(i) : i;
		if (0 === s) c.note = `Start: ${o} at ${a[n.head]}`;
		else {
			const e = t[s - 1], i = G(e.state)?.name || e.state, r = function(t, e) {
				return t[e] ?? null;
			}(a, e.head), l = null === r ? q.config.sym.eps : r;
			c.note = `Branch ${n.branch} depth ${n.depth}: ${i} reads '${l}', move ${n.via?.dir || "S"} → ${o} (head=${n.head})`;
		}
		return c;
	});
	if (o.length && n) {
		const t = o[o.length - 1];
		t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
	}
	return o;
}
function $s(t) {
	const e = rt(t), n = [{
		state: U(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}];
	for (let s = 0; s < q.config.maxTmSteps; s++) {
		const t = n[n.length - 1];
		if (q.accepts.has(t.state)) return {
			accepted: !0,
			path: n,
			finalNote: `Accepted in state ${G(t.state)?.name || t.state}`
		};
		if (t.head < 0 || t.head >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Head moved outside endmarker bounds at index ${t.head}`
		};
		const s = e[t.head], a = ht(ws(t.state, s), (t) => t.symbol === s ? 1 : 0);
		if (!a) return {
			accepted: !1,
			path: n,
			finalNote: `No valid transition on '${s}'`
		};
		const o = t.head + bs(a.dir);
		if (o < 0 || o >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Transition on '${s}' attempted to move outside ${o < 0 ? "⊢" : "⊣"} bound.`
		};
		n.push({
			state: a.to,
			head: o,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: a
		});
	}
	return {
		accepted: !1,
		path: n,
		finalNote: `2DFA step limit ${q.config.maxTmSteps} reached`
	};
}
function Ss(t, e = null) {
	const n = rt(t), s = {
		state: U(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}, a = new gt([s]), o = /* @__PURE__ */ new Set([`${s.state}|${s.head}`]);
	e && e.root(s.state, s);
	let i = null, r = s, c = 0, l = 0, u = 2;
	for (; a.length && c < q.config.maxTmSteps;) {
		const t = a.shift();
		if (r = t, c++, l = Math.max(l, t.depth), q.accepts.has(t.state)) {
			i = t, e && e.accept(t.tn);
			break;
		}
		if (t.head < 0 || t.head >= n.length) {
			e && e.expandCfgs(t, []);
			continue;
		}
		const s = n[t.head], h = ws(t.state, s), p = e && !e.full ? [] : null;
		h.forEach((e, s) => {
			const i = 1 === h.length || 0 === s ? t.branch : u++, r = t.head + bs(e.dir);
			if (r < 0 || r >= n.length) return;
			const c = {
				state: e.to,
				head: r,
				depth: t.depth + 1,
				branch: i,
				parent: t,
				via: e
			}, l = `${c.state}|${c.head}`, d = !o.has(l);
			p && p.push({
				cfg: c,
				fresh: d
			}), d && (o.add(l), a.push(c));
		}), p && e.expandCfgs(t, p);
	}
	const h = i || r;
	return e && e.finish(h.tn ?? -1), {
		accepted: !!i,
		witnessPath: Wt(h),
		finalCfg: h,
		unresolved: !i && a.length > 0,
		branches: c,
		maxDepth: l
	};
}
function As(t) {
	const e = rt(t), n = q.config.sym.lambda, s = [{
		state: U(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null,
		outRaw: "",
		outNode: null
	}];
	for (let a = 0; a < q.config.maxTmSteps; a++) {
		const t = s[s.length - 1];
		if (q.accepts.has(t.state)) return {
			accepted: !0,
			halted: !0,
			path: s,
			finalNote: `Accepted in state ${G(t.state)?.name || t.state}`
		};
		const a = e[t.head], o = ht(ws(t.state, a), (t) => t.symbol === a ? 1 : 0);
		if (!o) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `No valid transition on '${a}'`
		};
		const i = t.head + bs(o.dir);
		if (i < 0 || i >= e.length) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `Transition on '${a}' attempted to move outside ${i < 0 ? q.config.sym.leftMarker : q.config.sym.rightMarker} bound.`
		};
		const r = o.output ?? "";
		s.push({
			state: o.to,
			head: i,
			depth: t.depth + 1,
			branch: t.branch,
			parent: t,
			via: o,
			outRaw: t.outRaw + r,
			outNode: zt(t.outNode, "" === r ? n : r)
		});
	}
	return {
		accepted: !1,
		halted: !1,
		path: s,
		finalNote: `2DFT step limit ${q.config.maxTmSteps} reached`
	};
}
ot(gs, {
	Moore: {
		simulate: function(t) {
			pt(us(t));
		},
		stream: us,
		deterministicDelta: !0,
		determinism: ms,
		decide: (t) => Bt(ye(t), function(t) {
			let e = U();
			const n = xt(), s = [G(e)?.output ?? ""];
			for (const a of t) {
				const t = n(e, a);
				if (!t) break;
				e = t.to, s.push(G(e)?.output ?? "");
			}
			return s.join("");
		}(t)),
		schema: {
			...gs.schema,
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
			pt(hs(t));
		},
		stream: hs,
		deterministicDelta: !0,
		determinism: ms,
		decide: (t) => Bt(ye(t), function(t) {
			let e = U();
			const n = xt(), s = [];
			for (const a of t) {
				const t = n(e, a);
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
			const e = fs(t, null), n = q.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, a = n ? e.accepted ? "Accepting branch found" : e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting branch found" : "";
			q.simSteps = function(t, e, n = null, s = "") {
				const a = t.map((n, s) => {
					const a = G(n.state)?.name || n.state, o = ue({
						state: n.state,
						tokens: e,
						outNode: n.outNode,
						outSoFar: n.outRaw,
						branch: n.branch,
						tid: n.via?.id,
						note: ""
					});
					if (0 === s) o.note = `Start: ${a}`;
					else {
						const e = t[s - 1], i = G(e.state)?.name || e.state, r = n.via?.symbol || q.config.sym.eps, c = void 0 !== n.via?.output && "" !== n.via?.output ? n.via.output : q.config.sym.lambda;
						o.note = `Branch ${n.branch} depth ${n.depth}: (${i}, ${r}/${c}) → ${a}`;
					}
					return o;
				});
				if (a.length && n) {
					const t = a[a.length - 1];
					t.final = n, t.note += "accept" === n ? ` — ${s || "ACCEPT"}` : ` — ${s || "REJECT"}`;
				}
				return a;
			}(e.witnessPath, t, s, a);
			const o = q.simSteps[q.simSteps.length - 1];
			if (o) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? o.note += ` | Output: "${t[0]}"` : o.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : o.note += " | Output: \"\"";
			}
			return de(q.simSteps, null), q.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => {
			const e = function(t) {
				const e = fs(t), n = [...e.outputs];
				let s = "";
				return s = n.length > 1 ? n.join(" | ") : 1 === n.length ? n[0] : e.witnessPath.at(-1)?.outRaw || "", {
					accepted: e.accepted,
					output: s
				};
			}(t);
			return Bt(e.accepted, e.output);
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
const Ts = (t) => ({
	conflict: (t, e) => Lt(t.from, t.symbol, e),
	say: (e) => `${q.machine} already has δ(${qt(e.from)}, '${e.symbol}'). Use ${t} mode if you want multiple choices for the same read symbol.`
}), xs = {
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
function Ns(t) {
	const e = q.simStart;
	if (null == e) return t();
	q.simStart = null;
	try {
		return t();
	} finally {
		q.simStart = e;
	}
}
function Ms(t) {
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
ot(xs, {
	"2DFA": {
		simulate: function(t) {
			const e = $s(t);
			return q.simSteps = vs(e.path, t, e.accepted ? "accept" : "reject", e.finalNote), q.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: Ts("2NFA"),
		decide: (t) => Rt(function(t) {
			return $s(t).accepted;
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
			const e = Ss(t, null), n = e.accepted ? `Accepted in state ${G(e.finalCfg.state)?.name || e.finalCfg.state}` : e.unresolved ? `Exploration limit ${q.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance";
			return q.simSteps = vs(e.witnessPath, t, e.accepted ? "accept" : "reject", n), de(q.simSteps, null), q.simIdx = 0, e;
		},
		branches: !0,
		decide: (t) => Rt(function(t) {
			return Ss(t).accepted;
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
			const e = As(t), n = q.config.transducerAccepts, s = e.halted ? n ? e.accepted ? "accept" : "reject" : null : "timeout";
			q.simSteps = vs(e.path, t, s, e.finalNote);
			const a = q.simSteps[q.simSteps.length - 1];
			return a && (e.halted || (a.limit = q.config.maxTmSteps), a.note += ` | Output: "${e.path[e.path.length - 1]?.outRaw ?? ""}"`), q.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: Ts("FST"),
		decide: (t) => {
			const e = function(t) {
				const e = As(t), n = e.path[e.path.length - 1];
				return {
					accepted: e.accepted,
					halted: e.halted,
					output: n?.outRaw ?? ""
				};
			}(t);
			return e.halted ? Bt(e.accepted, e.output) : {
				verdict: "unk",
				output: e.output
			};
		},
		schema: {
			...xs.schema,
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
const Ps = [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts"
], Es = [
	"machine",
	"tapeCount",
	"startId"
];
function Fs(t, e) {
	if ("load" === t.type) return function(t) {
		for (const e of Es) q[e] = t[e];
		for (const e of Ps) q[e] = new Set(t[e] || []);
		q.states = t.states || [], q.transitions = t.transitions || [], q.config = t.config, q.simSteps = [], q.simIdx = 0;
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
						return !s || s.parseInput ? null : Ns(() => s.decide(e, n, t));
					}(t.machine, e)?.verdict ?? "unk";
				} catch {
					return "unk";
				}
			}) : function(t) {
				const e = q.machine, n = !!H(e).isTransducer;
				return t.map(Ms).map(({ input: t, expect: s }) => function(t, e, n = q.machine, s = null) {
					const a = null === s ? !!H(n).isTransducer : s, o = function(t, e) {
						const n = it(t);
						return n ? (n.parseInput || Qt)(e, t) : {
							ok: !1,
							error: `This build has no implementation for ${t}.`
						};
					}(n, function(t) {
						if (!t) return "";
						const e = t.trim();
						return "eps" === e.toLowerCase() || "epsilon" === e.toLowerCase() ? q.config.sym.eps : e;
					}(t));
					if (!o.ok) return {
						str: t,
						accepted: !1,
						error: !0,
						expect: e
					};
					const { verdict: i, output: r } = function(t, e, n = {}) {
						const s = it(t);
						return s ? Ns(() => s.decide(e, n, t)) : {
							verdict: "unk",
							output: null
						};
					}(n, o.input), c = "unk" === i, l = !c && (a ? q.config.transducerAccepts ? "acc" === i : void 0 : "acc" === i);
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
const Ds = { loaded: -1 };
self.onmessage = (t) => self.postMessage(Fs(t.data, Ds));
