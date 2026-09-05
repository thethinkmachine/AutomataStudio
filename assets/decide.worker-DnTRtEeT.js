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
const a = 1, o = 2, i = {
	owned: null,
	cleanups: null,
	context: null,
	owner: null
};
var r = null;
let c = null, u = null, d = null, p = null, f = null, h = 0;
function m(t, e) {
	const s = {
		value: t,
		observers: null,
		observerSlots: null,
		comparator: (e = e ? Object.assign({}, n, e) : n).equals || void 0
	};
	return [S.bind(s), (t) => ("function" == typeof t && (t = c && c.running && c.sources.has(s) ? t(s.tValue) : t(s.value)), v(s, t))];
}
function g(t) {
	return x(t, !1);
}
function b(t) {
	if (null === d) return t();
	const e = d;
	d = null;
	try {
		return t();
	} finally {
		d = e;
	}
}
function y(t) {
	return null === r || (null === r.cleanups ? r.cleanups = [t] : r.cleanups.push(t)), t;
}
const [w, k] = m(!1);
function S() {
	const t = c && c.running;
	if (this.sources && (t ? this.tState : this.state)) if ((t ? this.tState : this.state) === a) A(this);
	else {
		const t = p;
		p = null, x(() => D(this), !1), p = t;
	}
	if (d) {
		const t = this.observers;
		if (!t || t[t.length - 1] !== d) {
			const e = t ? t.length : 0;
			d.sources ? (d.sources.push(this), d.sourceSlots.push(e)) : (d.sources = [this], d.sourceSlots = [e]), t ? (t.push(d), this.observerSlots.push(d.sources.length - 1)) : (this.observers = [d], this.observerSlots = [d.sources.length - 1]);
		}
	}
	return t && c.sources.has(this) ? this.tValue : this.value;
}
function v(t, e, n) {
	let s = c && c.running && c.sources.has(t) ? t.tValue : t.value;
	if (!t.comparator || !t.comparator(s, e)) {
		if (c) {
			const s = c.running;
			(s || !n && c.sources.has(t)) && (c.sources.add(t), t.tValue = e), s || (t.value = e);
		} else t.value = e;
		t.observers && t.observers.length && x(() => {
			for (let e = 0; e < t.observers.length; e += 1) {
				const n = t.observers[e], s = c && c.running;
				s && c.disposed.has(n) || ((s ? n.tState : n.state) || (n.pure ? p.push(n) : f.push(n), n.observers && P(n)), s ? n.tState = a : n.state = a);
			}
			if (p.length > 1e6) throw p = [], /* @__PURE__ */ new Error();
		}, !1);
	}
	return e;
}
function A(t) {
	if (!t.fn) return;
	M(t);
	const e = h;
	T(t, c && c.running && c.sources.has(t) ? t.tValue : t.value, e), c && !c.running && c.sources.has(t) && queueMicrotask(() => {
		x(() => {
			c && (c.running = !0), d = r = t, T(t, t.tValue, e), d = r = null;
		}, !1);
	});
}
function T(t, e, n) {
	let s;
	const o = r, i = d;
	d = r = t;
	try {
		s = t.fn(e);
	} catch (l) {
		return t.pure && (c && c.running ? (t.tState = a, t.tOwned && t.tOwned.forEach(M), t.tOwned = void 0) : (t.state = a, t.owned && t.owned.forEach(M), t.owned = null)), t.updatedAt = n + 1, j(l);
	} finally {
		d = i, r = o;
	}
	(!t.updatedAt || t.updatedAt <= n) && (null != t.updatedAt && "observers" in t ? v(t, s, !0) : c && c.running && t.pure ? (c.sources.has(t) || (t.value = s), c.sources.add(t), t.tValue = s) : t.value = s, t.updatedAt = n);
}
function N(t) {
	const e = c && c.running;
	if (0 === (e ? t.tState : t.state)) return;
	if ((e ? t.tState : t.state) === o) return D(t);
	if (t.suspense && b(t.suspense.inFallback)) return t.suspense.effects.push(t);
	const n = [t];
	for (; (t = t.owner) && (!t.updatedAt || t.updatedAt < h);) {
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
			p = null, x(() => D(t, n[0]), !1), p = e;
		}
	}
}
function x(t, e) {
	if (p) return t();
	let n = !1;
	e || (p = []), f ? n = !0 : f = [], h++;
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
				c = null, x(() => {
					for (const t of n) M(t);
					for (const e of t) {
						if (e.value = e.tValue, e.owned) for (let t = 0, n = e.owned.length; t < n; t++) M(e.owned[t]);
						e.tOwned && (e.owned = e.tOwned), delete e.tValue, delete e.tOwned, e.tState = 0;
					}
					k(!1);
				}, !1);
			}
			const n = f;
			f = null, n.length && x(() => s(n), !1), e && e();
		}(n), e;
	} catch (a) {
		n || (f = null), p = null, j(a);
	}
}
function E(t) {
	for (let e = 0; e < t.length; e++) N(t[e]);
}
function F(e) {
	let n, s = 0;
	for (n = 0; n < e.length; n++) {
		const t = e[n];
		t.user ? e[s++] = t : N(t);
	}
	if (t.context) {
		if (t.count) return t.effects || (t.effects = []), void t.effects.push(...e.slice(0, s));
		t.context = void 0;
	}
	for (!t.effects || !t.done && t.count || (e = [...t.effects, ...e], s += t.effects.length, delete t.effects), n = 0; n < s; n++) N(e[n]);
}
function D(t, e) {
	const n = c && c.running;
	n ? t.tState = 0 : t.state = 0;
	for (let s = 0; s < t.sources.length; s += 1) {
		const i = t.sources[s];
		if (i.sources) {
			const t = n ? i.tState : i.state;
			t === a ? i !== e && (!i.updatedAt || i.updatedAt < h) && N(i) : t === o && D(i, e);
		}
	}
}
function P(t) {
	const e = c && c.running;
	for (let n = 0; n < t.observers.length; n += 1) {
		const s = t.observers[n];
		(e ? s.tState : s.state) || (e ? s.tState = o : s.state = o, s.pure ? p.push(s) : f.push(s), s.observers && P(s));
	}
}
function M(t) {
	let e;
	if (t.sources) for (; t.sources.length;) {
		const e = t.sources.pop(), n = t.sourceSlots.pop(), s = e.observers;
		if (s && s.length) {
			const t = s.pop(), a = e.observerSlots.pop();
			n < s.length && (t.sourceSlots[a] = n, s[n] = t, e.observerSlots[n] = a);
		}
	}
	if (t.tOwned) {
		for (e = t.tOwned.length - 1; e >= 0; e--) M(t.tOwned[e]);
		delete t.tOwned;
	}
	if (c && c.running && t.pure) C(t, !0);
	else if (t.owned) {
		for (e = t.owned.length - 1; e >= 0; e--) M(t.owned[e]);
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
const Q = { equals: !1 };
var R = class {
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
		if (!d) return;
		let e = this.#t.get(t);
		if (e) e.n++;
		else {
			const [n, s] = m(void 0, Q);
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
const B = Symbol("track-keys");
var O = class extends Set {
	#e = new R();
	constructor(t) {
		if (super(), t) for (const e of t) super.add(e);
	}
	[Symbol.iterator]() {
		return this.values();
	}
	get size() {
		return this.#e.track(B), super.size;
	}
	has(t) {
		return this.#e.track(t), super.has(t);
	}
	keys() {
		return this.values();
	}
	*values() {
		this.#e.track(B);
		for (const t of super.values()) yield t;
	}
	*entries() {
		this.#e.track(B);
		for (const t of super.entries()) yield t;
	}
	forEach(t, e) {
		this.#e.track(B), super.forEach(t, e);
	}
	add(t) {
		return super.has(t) || (super.add(t), g(() => {
			this.#e.dirty(t), this.#e.dirty(B);
		})), this;
	}
	delete(t) {
		const e = super.delete(t);
		return e && g(() => {
			this.#e.dirty(t), this.#e.dirty(B);
		}), e;
	}
	clear() {
		super.size && g(() => {
			this.#e.dirty(B);
			for (const t of super.values()) this.#e.dirty(t);
			super.clear();
		});
	}
};
if (!function() {
	let t = 0, e = null;
	(function(t) {
		const e = d, n = r, s = 0 === t.length, a = n, o = s ? i : {
			owned: null,
			cleanups: null,
			context: a ? a.context : null,
			owner: a
		}, c = s ? t : () => t();
		r = o, d = null;
		try {
			return x(c, !0);
		} finally {
			d = e, r = n;
		}
	})(() => {
		const [n, o] = m(0);
		e = () => o((t) => t + 1), function(t, e, n) {
			s = F;
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
			n && n.render || (o.user = !0), f ? f.push(o) : A(o);
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
}, L = {
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
function W(t, e) {
	let n = t[e] instanceof O ? t[e] : new O(t[e] || []);
	Object.defineProperty(t, e, {
		get: () => n,
		set(t) {
			n = t instanceof O ? t : new O(t || []);
		},
		enumerable: !0,
		configurable: !0
	});
}
const q = {
	machine: "DFA",
	tool: "move",
	view: "build",
	sigma: new O(["a", "b"]),
	outputAlpha: new O(["0", "1"]),
	stackAlpha: new O(["Z"]),
	tapeCount: 2,
	states: [],
	transitions: [],
	startId: null,
	accepts: new O(),
	selectedStates: new O(),
	selectedTransitions: new O(),
	stateN: 0,
	transN: 0,
	meta: null,
	notes: [],
	noteN: 0,
	activeNoteId: null,
	selectedNotes: new O(),
	ctxNoteId: null,
	editNoteId: null,
	resizeNoteId: null,
	resizeNoteStart: null,
	dividers: [],
	dividerN: 0,
	selectedDividers: new O(),
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
			vars: new O(t),
			start: e,
			productions: n
		};
		return W(s, "vars"), s;
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
for (const wn of [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts",
	"selectedStates",
	"selectedTransitions",
	"selectedNotes",
	"selectedDividers"
]) W(q, wn);
let J = null, z = null, _ = -1, V = null, U = null;
function H() {
	return q.simStart || q.startId;
}
function Z(t) {
	return function() {
		const t = q.states || [], e = t.length;
		if (z === t && _ === e && V === t[0] && U === t[e - 1]) return J;
		const n = /* @__PURE__ */ new Map();
		for (let s = 0; s < e; s++) n.set(t[s].id, t[s]);
		return J = n, z = t, _ = e, V = t[0], U = t[e - 1], n;
	}().get(t);
}
function G(t) {
	return I[t] || I.DFA;
}
function K(t = q.machine) {
	return !("LBA" === t || !G(t).twoWayTape && !q.config.twoWayTape);
}
function X() {
	return !1 !== q.config.detectLoops;
}
function Y(t = q.machine) {
	const e = G(t).omegaCondition;
	return L[e] ? e : "buchi";
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
function dt(t = [], e = () => 0) {
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
function ft(t, e = q.sigma) {
	if ("" === t || !t) return [];
	const n = [...e].filter((t) => t !== q.config.sym.eps).sort((t, e) => e.length - t.length);
	function s(t) {
		return function e(s) {
			if (s === t.length) return [];
			for (const a of n) if (t.startsWith(a, s)) {
				const t = e(s + a.length);
				if (null !== t) return [a, ...t];
			}
			return null;
		}(0);
	}
	const a = t.split(/[,\s]+/).filter((t) => t.length > 0);
	if (0 === a.length) return [];
	const o = [];
	for (const i of a) {
		const t = s(i);
		if (null === t) return null;
		o.push(...t);
	}
	return o;
}
function ht(t) {
	const e = new Set(t), n = [...t], s = q.config.sym.eps;
	for (; n.length;) {
		const t = n.pop();
		q.transitions.filter((e) => e.from === t && e.symbol === s).forEach((t) => {
			e.has(t.to) || (e.add(t.to), n.push(t.to));
		});
	}
	return e;
}
function mt(t) {
	return [...t].map((t) => Z(t)?.name || t).join(",");
}
function gt(t, e) {
	return dt(q.transitions.filter((n) => n.from === t && (n.symbol === e || n.symbol === q.config.sym.any)), (t) => t.symbol === e ? 1 : 0);
}
function bt(t, e) {
	return dt(q.transitions.filter((n) => n.from === t && n.tapeSyms && n.tapeSyms.length === e.length && n.tapeSyms.every((t, n) => t === e[n] || t === q.config.sym.any)), (t) => t.tapeSyms.reduce((t, n, s) => t + (n === e[s] ? 1 : 0), 0));
}
function yt() {
	if (!X()) return { seenAt: () => -1 };
	let t = /* @__PURE__ */ new Map();
	return { seenAt: (e, n) => t ? t.has(e) ? t.get(e) : (t.set(e, n), t.size > 5e3 && (t = null), -1) : -1 };
}
function wt(t, e) {
	t.final = "loop", t.loopFrom = e, t.note += ` — LOOP: repeats step ${e}, so this machine never halts on this input`;
}
function kt(t, e = q.config.maxTmSteps) {
	t.final = "timeout", t.limit = e, t.note += ` — NO VERDICT: still running after ${e} steps`, X() || (t.note += ", and loop detection is off");
}
function $t(t, e, n) {
	const s = function(t, e) {
		const n = q.config.sym.blank, s = Math.max(0, e), a = t.length ? [...t] : [n];
		for (; a.length <= s;) a.push(n);
		for (; a.length > s + 1 && a[a.length - 1] === n;) a.pop();
		return {
			tape: a,
			head: s
		};
	}(e, n), a = Z(t)?.name || t;
	return `${s.tape.slice(0, s.head).join("")}[${a}]${s.tape.slice(s.head).join("")}`;
}
function St(t) {
	const e = ft(t === q.config.sym.eps ? "" : t);
	return null === e ? {
		ok: !1,
		error: `Input cannot be tokenized using alphabet {${[...q.sigma].join(", ")}}.`
	} : {
		ok: !0,
		input: e,
		tokens: e
	};
}
function vt(t) {
	return {
		verdict: t ? "acc" : "rej",
		output: null
	};
}
function At(t, e) {
	return {
		verdict: t ? "acc" : "rej",
		output: e
	};
}
function Tt(t, e) {
	return !!t && (!q.config.transducerAccepts || e);
}
function Nt(t) {
	const e = [];
	let n = t;
	for (; n;) e.push(n), n = n.parent;
	return e.reverse();
}
function xt(t, e, n) {
	return q.transitions.find((s) => s.id !== n && s.from === t && ut(s.symbol, e)) || null;
}
function Et(t) {
	return Z(t)?.name || t;
}
function Ft() {
	return Math.max(10, q.config.langStepBudget || 400);
}
function Dt(t, e) {
	return {
		piece: e,
		prev: t,
		len: t ? t.len + 1 : 1
	};
}
const Pt = {
	get() {
		return this.tokens.slice(this.pos);
	},
	enumerable: !1,
	configurable: !0
}, Mt = {
	get() {
		return function(t) {
			const e = t ? t.len : 0, n = new Array(e);
			for (let s = t, a = e - 1; s; s = s.prev, a--) n[a] = s.piece;
			return n;
		}(this.outNode);
	},
	enumerable: !1,
	configurable: !0
}, Ct = Object.defineProperties({}, { remaining: Pt }), jt = Object.defineProperties({}, { outToks: Mt }), Qt = Object.defineProperties({}, {
	remaining: Pt,
	outToks: Mt
});
function Rt(t) {
	return Object.assign(Object.create(Ct), t);
}
function Bt(t) {
	return Object.assign(Object.create(jt), t);
}
function* Ot(t) {
	let e = H(), n = Rt({
		state: e,
		tokens: t,
		pos: 0,
		note: `Start: ${Z(e)?.name || "?"}`
	});
	yield n;
	for (let s = 0; s < t.length; s++) {
		const a = t[s], o = gt(e, a);
		if (!o) return n = Rt({
			state: e,
			tokens: t,
			pos: s,
			note: `No δ(${Z(e)?.name},'${a}') — Implicit REJECT`,
			final: "reject"
		}), void (yield n);
		e = o.to, n = Rt({
			state: e,
			tokens: t,
			pos: s + 1,
			note: `Read '${a}' → ${Z(e)?.name}`,
			tid: o.id
		}), yield n;
	}
	n.final || (n.final = q.accepts.has(e) ? "accept" : "reject", n.note += ` — ${n.final.toUpperCase()}`);
}
function* It(t) {
	let e = ht(/* @__PURE__ */ new Set([H()])), n = Rt({
		states: [...e],
		tokens: t,
		pos: 0,
		note: `Start ε-closure: {${mt(e)}}`
	});
	yield n;
	for (let a = 0; a < t.length; a++) {
		const s = t[a];
		let o = /* @__PURE__ */ new Set();
		if (e.forEach((t) => q.transitions.filter((e) => e.from === t && (e.symbol === s || e.symbol === q.config.sym.any)).forEach((t) => o.add(t.to))), o = ht(o), e = o, n = Rt({
			states: [...e],
			tokens: t,
			pos: a + 1,
			note: `Read '${s}' → {${mt(e) || "∅"}}`
		}), yield n, !e.size) break;
	}
	const s = [...e].some((t) => q.accepts.has(t));
	n.final || (n.final = s ? "accept" : "reject", n.note += ` — ${n.final.toUpperCase()}`);
}
function Lt(t) {
	pt(It(t));
}
function Wt(t) {
	let e = H();
	for (const n of t) {
		const t = gt(e, n);
		if (!t) return !1;
		e = t.to;
	}
	return q.accepts.has(e);
}
function qt(t) {
	let e = ht(/* @__PURE__ */ new Set([H()]));
	const n = q.config.sym.any;
	for (const s of t) {
		let t = /* @__PURE__ */ new Set();
		e.forEach((e) => q.transitions.filter((t) => t.from === e && (t.symbol === s || t.symbol === n)).forEach((e) => t.add(e.to))), e = ht(t);
	}
	return [...e].some((t) => q.accepts.has(t));
}
const Jt = {
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
function zt(t) {
	const e = Number(t.weight);
	return Number.isFinite(e) ? e : 1;
}
function _t(t) {
	return Number.isFinite(t) ? Number.isInteger(t) ? String(t) : String(Number(t.toFixed(4))) : "0";
}
function Vt(t, e) {
	const n = q.config.sym.any, s = /* @__PURE__ */ new Map();
	for (const [a, o] of t) if (o) for (const t of q.transitions) {
		if (t.from !== a) continue;
		if (t.symbol !== e && t.symbol !== n) continue;
		const i = zt(t);
		i && s.set(t.to, (s.get(t.to) || 0) + o * i);
	}
	return s;
}
function Ut(t) {
	let e = 0;
	for (const [n, s] of t) q.accepts.has(n) && (e += s);
	return e;
}
function Ht(t) {
	const e = [/* @__PURE__ */ new Map([[H(), 1]])];
	for (const n of t) e.push(Vt(e[e.length - 1], n));
	return e;
}
function Zt(t, e, n, s) {
	const a = q.config.sym.any, o = function(t, e, n) {
		return n < t.length ? t[n] : e[(n - t.length) % e.length];
	}(t, e, s), i = function(t, e, n) {
		return n + 1 < t.length + e.length ? n + 1 : t.length;
	}(t, e, s), r = [];
	for (const c of q.transitions) c.from === n && (c.symbol !== o && c.symbol !== a || r.push({
		state: c.to,
		pos: i,
		via: c
	}));
	return r;
}
ot(Jt, {
	DFA: {
		simulate: function(t) {
			pt(Ot(t));
		},
		stream: Ot,
		deterministicDelta: !0,
		determinism: {
			conflict: (t, e) => function(t, e, n) {
				return q.transitions.find((s) => s.id !== n && s.from === t && s.symbol === e) || null;
			}(t.from, t.symbol, e),
			say: (t) => `${q.machine} already has δ(${Et(t.from)}, '${t.symbol}'). Each (state, symbol) pair must be unique.`
		},
		decide: (t) => vt(Wt(t)),
		formal: {
			...Jt.formal,
			delta: () => "Q × Σ → Q"
		}
	},
	NFA: {
		simulate: Lt,
		stream: It,
		decide: (t) => vt(qt(t)),
		formal: {
			...Jt.formal,
			delta: () => "Q × Σ → P(Q)"
		}
	},
	"ε-NFA": {
		simulate: Lt,
		stream: It,
		decide: (t) => vt(qt(t)),
		formal: {
			...Jt.formal,
			delta: () => "Q × (Σ ∪ {ε}) → P(Q)"
		}
	}
}), at("PFA", {
	family: "weighted",
	options: ["cutPoint"],
	simulate: function(t) {
		q.simSteps = [];
		const e = q.config.pfaCutPoint;
		Ht(t).forEach((e, n) => {
			const s = function(t) {
				return [...t.entries()].filter(([, t]) => t > 0).sort((t, e) => e[1] - t[1]).map(([t, e]) => `${Z(t)?.name || t}:${_t(e)}`);
			}(e);
			q.simSteps.push(Rt({
				states: [...e.keys()].filter((t) => e.get(t) > 0),
				tokens: t,
				pos: n,
				dist: s,
				accMass: Ut(e),
				note: 0 === n ? `Start: all probability on ${Z(H())?.name || H()}` : `Read '${t[n - 1]}' → ${s.length ? s.join("  ") : "total mass 0 — the run has died"}`
			}));
		});
		const n = q.simSteps[q.simSteps.length - 1];
		if (n) {
			const t = n.accMass > e;
			n.final = t ? "accept" : "reject", n.note += ` | P(accept) = ${_t(n.accMass)} ${t ? ">" : "≤"} λ = ${_t(e)} — ${t ? "ACCEPT" : "REJECT"}`;
		}
		const s = function() {
			const t = /* @__PURE__ */ new Map();
			for (const n of q.transitions) {
				const e = `${n.from}|${n.symbol}`;
				t.set(e, (t.get(e) || 0) + zt(n));
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
	decide: (t) => vt(function(t) {
		const e = Ht(t);
		return Ut(e[e.length - 1]) > q.config.pfaCutPoint;
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
const Gt = (t, e) => `${t}|${e}`;
function Kt(t, e, n, s = null) {
	const a = Gt(n.state, n.pos), o = /* @__PURE__ */ new Map(), i = [], r = (t, e) => {
		const n = Gt(e.state, e.pos);
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
		for (; Gt(s.state, s.pos) !== a;) {
			const t = o.get(Gt(s.state, s.pos));
			n.unshift({
				state: s.state,
				pos: s.pos,
				via: t.via
			}), s = t.from;
		}
		return n;
	};
	for (const l of Zt(t, e, n.state, n.pos)) if (r(n, l)) return c(n, l);
	for (; i.length;) {
		const n = i.shift();
		for (const s of Zt(t, e, n.state, n.pos)) if (r(n, s)) return c(n, s);
	}
	return null;
}
function Xt(t, e) {
	if (!e.length) return {
		accepted: !1,
		reason: "empty-period",
		stem: [],
		loop: []
	};
	if (!H()) return {
		accepted: !1,
		reason: "no-start",
		stem: [],
		loop: []
	};
	const n = {
		state: H(),
		pos: 0,
		via: null
	}, s = /* @__PURE__ */ new Map([[Gt(n.state, n.pos), null]]), a = [n], o = [n];
	for (; o.length;) {
		const n = o.shift();
		for (const i of Zt(t, e, n.state, n.pos)) {
			const t = Gt(i.state, i.pos);
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
			const t = s.get(Gt(n.state, n.pos));
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
			const e = (t) => tt(Z(t));
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
		const n = Kt(t, e, r, c);
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
function Yt() {
	const t = function(t = q.transitions) {
		for (let e = 0; e < t.length; e++) for (let n = e + 1; n < t.length; n++) {
			const s = t[e], a = t[n];
			if (s.from === a.from && ut(s.symbol, a.symbol)) return [s, a];
		}
		return null;
	}(q.transitions);
	if (!t) return null;
	const e = Z(t[0].from)?.name || t[0].from;
	return { refuse: `Nondeterministic overlap in ${q.machine} mode: ${e} has two moves on '${t[0].symbol}'. Switch to ${q.machine.replace(/^D/, "N")} to explore both branches.` };
}
function te() {
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
	return t ? { warn: `Not a weak automaton: the cycle {${t.map((t) => Z(t)?.name || t).join(", ")}} contains both accepting and non-accepting states. A weak condition needs every SCC to sit wholly inside F or wholly outside it. Running it as a Büchi automaton.` } : null;
}
const ee = {
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
		const n = ft(e.prefix === q.config.sym.eps ? "" : e.prefix), s = ft(e.period);
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
		const n = Xt(t, e), s = n.accepted ? [
			...n.stem,
			...n.loop,
			...n.loop
		].slice(0, n.stem.length + 2 * n.loop.length) : n.stem, a = n.accepted ? n.stem.length - 1 : -1, o = Math.max(1, Math.ceil((s.length + 1) / Math.max(1, e.length)) + 1), i = [...t];
		for (let l = 0; l < o; l++) i.push(...e);
		const r = [...t, ...e];
		q.simSteps = s.map((o, c) => {
			const l = Z(o.state)?.name || o.state, u = a >= 0 && c >= a;
			let d;
			if (0 === c) d = `Start: ${l}`;
			else {
				const t = Z(s[c - 1].state)?.name || s[c - 1].state;
				d = `Read '${i[c - 1]}': ${t} → ${l}`;
			}
			return d += function(t) {
				const e = Y();
				return "parity" === e ? ` · priority ${tt(Z(t))}` : q.accepts.has(t) ? "cobuchi" === e ? " ✗ (in F — must stop recurring)" : " ✓ (accepting)" : "";
			}(o.state), u && (d += ` · loop iteration ${Math.floor((c - a) / Math.max(1, n.loop.length)) + 1}`), {
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
				note: d
			};
		});
		const c = q.simSteps[q.simSteps.length - 1];
		return c && (c.final = n.accepted ? "accept" : "reject", c.note += function(t) {
			const e = Y(), n = t.loop.map((t) => Z(t.state)?.name || t.state), s = [...new Set(n)].join(" → ");
			return t.accepted ? "cobuchi" === e ? ` — ACCEPT: the cycle ${s} repeats forever and never touches F again` : "parity" === e ? ` — ACCEPT: the cycle ${s} repeats forever and its least priority is ${Math.min(...t.loop.map((t) => tt(Z(t.state))))}, which is even` : ` — ACCEPT: the cycle ${s} repeats forever and visits an accepting state each time` : "stuck" === t.reason ? " — REJECT: no run survives the ω-word" : "cobuchi" === e ? " — REJECT: every reachable cycle touches F, so no run can leave it behind for good" : "parity" === e ? " — REJECT: every reachable cycle has an odd least priority" : " — REJECT: every reachable cycle avoids F, so no run visits an accepting state infinitely often";
		}(n)), q.simIdx = 0, n;
	}(t, e),
	decide: ({ u: t, v: e }) => vt(function(t, e) {
		return Xt(t, e).accepted;
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
}, ne = { schema: {
	...ee.schema,
	stateFields: [
		"name",
		"start",
		"priority"
	]
} }, se = {
	conflict: (t, e) => xt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has a move from ${Et(t.from)} on '${t.symbol}'. Switch to ${q.machine.replace(/^D/, "N")} if you want to branch on the same symbol.`
}, ae = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → Q"
}, oe = {
	tuple: () => [
		"Q",
		"Σ",
		"δ",
		"q₀",
		"F"
	],
	delta: () => "Q × Σ → P(Q)"
};
function ie(t, e) {
	return e === q.config.sym.eps || void 0 !== t && (e === t || e === q.config.sym.any);
}
function re(t = q.machine) {
	return ct(t);
}
function ce(t = q.machine) {
	return lt(t);
}
function le(t, e = !1) {
	if (t && t.length) return e ? t[0] : t[t.length - 1];
}
function ue(t, e = !1) {
	return t && t.length ? e ? t.join("") : [...t].reverse().join("") : q.config.sym.eps;
}
function de(t, e, n, s = !1) {
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
function pe(t) {
	const e = "explicit" === q.config.pdaParadigm ? [q.config.sym.stackBottom] : [], n = {
		state: H(),
		tokens: t,
		pos: 0,
		stack: [...e],
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	};
	return ce() && (n.stack2 = [...e]), n;
}
function fe(t, e, n, s = null) {
	const a = Array.isArray(s) ? `|${s.join("")}` : "";
	return `${t}|${e}|${n.join("")}${a}`;
}
function he(t) {
	return "explicit" === q.config.pdaParadigm ? q.accepts.has(t.state) && t.pos >= t.tokens.length : ce() ? t.pos >= t.tokens.length && 0 === t.stack.length && 0 === (t.stack2 || []).length : t.pos >= t.tokens.length && 0 === t.stack.length;
}
function me(t) {
	const e = Z(t.state)?.name || t.state, n = t.pos < t.tokens.length ? t.tokens.slice(t.pos).join("") : q.config.sym.eps, s = ue(t.stack, re());
	return ce() ? `(${e}, ${n}, ${s}; ${ue(t.stack2 || [])})` : `(${e}, ${n}, ${s})`;
}
function ge(t) {
	const e = q.config.sym.eps, n = re(), s = le(t.stack, n), a = ce() ? le(t.stack2 || []) : void 0;
	return q.transitions.filter((n) => {
		if (n.from !== t.state) return !1;
		const o = n.symbol === e || t.pos < t.tokens.length && (n.symbol === t.tokens[t.pos] || n.symbol === q.config.sym.any), i = ie(s, n.pop), r = n.pop2 || e, c = !ce() || ie(a, r);
		return o && i && c;
	});
}
function be(t, e, n = t.branch) {
	const s = q.config.sym.eps, a = re(), o = {
		state: e.to,
		tokens: t.tokens,
		pos: e.symbol === s ? t.pos : t.pos + 1,
		stack: de(t.stack, e.pop || s, e.push || s, a),
		depth: t.depth + 1,
		branch: n,
		parent: t,
		via: e
	};
	return ce() && (o.stack2 = de(t.stack2 || [], e.pop2 || s, e.push2 || s, !1)), o;
}
function ye(t, e) {
	const n = e.via, s = Z(t.state)?.name || t.state, a = Z(e.state)?.name || e.state, o = n?.symbol || q.config.sym.eps, i = n?.pop || q.config.sym.eps, r = n?.push || q.config.sym.eps, c = n?.pop2 || q.config.sym.eps, l = n?.push2 || q.config.sym.eps;
	return ce() ? `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}/${c}) → (${a}, ${r}/${l})` : `Branch ${e.branch} depth ${e.depth}: (${s}, ${o}, ${i}) → (${a}, ${r})`;
}
function we(t, e = null, n = "") {
	const s = t.map((e, n) => {
		const s = {
			state: e.state,
			tokens: e.tokens,
			pos: e.pos,
			stack: e.stack,
			branch: e.branch,
			tid: e.via?.id,
			note: 0 === n ? "Start configuration" : ye(t[n - 1], e)
		};
		Array.isArray(e.stack2) && (s.stack2 = e.stack2);
		const a = void 0 !== e.outNode;
		return a && (s.outNode = e.outNode, s.outSoFar = e.outRaw), a ? function(t) {
			return Object.assign(Object.create(Qt), t);
		}(s) : Rt(s);
	});
	if (s.length && e) {
		const t = s[s.length - 1];
		t.final = e, t.note += "accept" === e ? " — ACCEPT" : ` — ${n || "REJECT"}`;
	}
	return s;
}
function ke(t, e, n, s) {
	const a = Rt({
		state: e.state,
		tokens: e.tokens,
		pos: e.pos,
		stack: e.stack,
		branch: e.branch,
		note: s,
		final: n
	});
	Array.isArray(e.stack2) && (a.stack2 = e.stack2), t.push(a);
}
function $e(t) {
	const e = pe(t), n = [e], s = /* @__PURE__ */ new Set([fe(e.state, e.pos, e.stack, e.stack2)]), a = [];
	let o = null, i = 0, r = 0, c = e, l = 2;
	for (; n.length && i < q.config.maxPdaSteps;) {
		const t = n.shift();
		c = t, i++, r = Math.max(r, t.depth);
		const e = Z(t.state)?.name || t.state, u = me(t);
		if (he(t)) {
			o = t, a.push(`<span class="step-acc">Branch ${t.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${t.depth}.<br>ID: ${u}</span>`);
			break;
		}
		const d = ge(t);
		if (!d.length) {
			a.push(`Branch ${t.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${u}.<br>Depth ${t.depth}</span>`);
			continue;
		}
		const p = t.tokens[t.pos] || q.config.sym.eps, f = le(t.stack, re()), h = ct() ? "Queue front" : "Stack top", m = [
			`State "${e}" with next input '${p}'`,
			`Depth ${t.depth} · ${h} ${f || q.config.sym.eps}`,
			`ID: ${u}`
		];
		lt() && m.push(`Second stack top ${le(t.stack2 || []) || q.config.sym.eps}`), d.length > 1 && m.push(`Nondeterministic choice: ${d.length} matching transitions.`), a.push(`Branch ${t.branch}: exploring <em>${e}</em><span class="step-sub">${m.join("<br>")}</span>`), d.forEach((e, a) => {
			const o = 1 === d.length || 0 === a ? t.branch : l++, i = be(t, e, o), r = fe(i.state, i.pos, i.stack, i.stack2);
			s.has(r) || (s.add(r), n.push(i));
		});
	}
	return {
		accepted: !!o,
		branches: i,
		maxDepth: r,
		log: a,
		witnessPath: Nt(o || c),
		finalCfg: o || c,
		unresolved: !o && n.length > 0
	};
}
function Se(t) {
	return `${fe(t.state, t.pos, t.stack, t.stack2)}|${t.outRaw}`;
}
function ve(t, e, n) {
	const s = be(t, e, n), a = e.output ?? "";
	return s.outRaw = (t.outRaw || "") + a, s.outNode = Dt(t.outNode, "" === a ? q.config.sym.lambda : a), s;
}
function Ae(t) {
	const e = pe(t);
	e.outRaw = "", e.outNode = null;
	const n = [e], s = /* @__PURE__ */ new Set([Se(e)]), a = /* @__PURE__ */ new Set();
	let o = null, i = null, r = e, c = 0, l = 0, u = 2;
	for (; n.length && c < q.config.maxPdaSteps;) {
		const t = n.shift();
		r = t, c++, l = Math.max(l, t.depth);
		const e = he(t);
		t.pos >= t.tokens.length && (Tt(!0, e) && a.add(t.outRaw), i || (i = t)), e && !o && (o = t);
		const d = ge(t);
		d.length && d.forEach((e, a) => {
			const o = 1 === d.length || 0 === a ? t.branch : u++, i = ve(t, e, o), r = Se(i);
			s.has(r) || (s.add(r), n.push(i));
		});
	}
	const d = o || i || r;
	return {
		accepted: !!o,
		outputs: a,
		witnessPath: Nt(d),
		finalCfg: d,
		unresolved: !o && n.length > 0,
		branches: c,
		maxDepth: l
	};
}
ot(ee, {
	DBA: {
		deterministicDelta: !0,
		determinism: se,
		guards: [Yt],
		formal: ae
	},
	DcoBA: {
		deterministicDelta: !0,
		determinism: se,
		guards: [Yt],
		formal: ae
	},
	DPA: {
		deterministicDelta: !0,
		determinism: se,
		guards: [Yt],
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
		...ne
	},
	DWA: {
		deterministicDelta: !0,
		determinism: se,
		guards: [Yt, te],
		formal: ae
	},
	NBA: {
		guards: [],
		formal: oe
	},
	NcoBA: {
		guards: [],
		formal: oe
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
		...ne
	},
	NWA: {
		guards: [te],
		formal: oe
	}
});
const Te = {
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
}, Ne = () => "explicit" === q.config.pdaParadigm ? [
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
], xe = {
	...Te,
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
		say: (t) => `DPDA already has an overlapping move from ${Et(t.from)}. Switch to NPDA mode if you want branching on the same configuration.`
	},
	simulate: function(t) {
		const e = pe(t);
		if (he(e)) return q.simSteps = we([e], "accept"), q.simIdx = 0, { accepted: !0 };
		let n = e;
		const s = /* @__PURE__ */ new Set([fe(n.state, n.pos, n.stack, n.stack2)]);
		for (let a = 0; a < q.config.maxPdaSteps; a++) {
			const t = ge(n);
			if (t.length > 1) return q.simSteps = we(Nt(n)), ke(q.simSteps, n, "reject", "Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches."), q.simIdx = 0, { accepted: !1 };
			if (!t.length) return q.simSteps = we(Nt(n)), ke(q.simSteps, n, "reject", "No valid transition from this configuration — REJECT"), q.simIdx = 0, { accepted: !1 };
			const e = be(n, t[0], n.branch), a = fe(e.state, e.pos, e.stack, e.stack2);
			if (s.has(a)) return q.simSteps = we(Nt(n)), ke(q.simSteps, n, "reject", "Repeated configuration detected — possible ε-loop — REJECT"), q.simIdx = 0, { accepted: !1 };
			if (s.add(a), n = e, he(n)) return q.simSteps = we(Nt(n), "accept"), q.simIdx = 0, { accepted: !0 };
		}
		return q.simSteps = we(Nt(n)), ke(q.simSteps, n, "reject", "PDA step limit reached — REJECT"), q.simIdx = 0, { accepted: !1 };
	},
	decide: (t) => vt(function(t) {
		let e = pe(t);
		if (he(e)) return !0;
		const n = /* @__PURE__ */ new Set([fe(e.state, e.pos, e.stack, e.stack2)]);
		for (let s = 0; s < q.config.maxPdaSteps; s++) {
			const t = ge(e);
			if (1 !== t.length) return !1;
			const s = be(e, t[0], e.branch), a = fe(s.state, s.pos, s.stack, s.stack2);
			if (n.has(a)) return !1;
			if (n.add(a), e = s, he(e)) return !0;
		}
		return !1;
	}(t))
}, Ee = {
	...Te,
	simulate: function(t) {
		const e = $e(t);
		return e.accepted ? q.simSteps = we(e.witnessPath, "accept") : (q.simSteps = we(e.witnessPath), ke(q.simSteps, e.finalCfg, "reject", e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT")), q.simIdx = 0, {
			accepted: e.accepted,
			branches: e.branches,
			maxDepth: e.maxDepth,
			log: e.log,
			witnessLength: e.witnessPath.length
		};
	},
	decide: (t) => vt(function(t) {
		return $e(t).accepted;
	}(t))
};
ot(Te, {
	DPDA: {
		...xe,
		formal: {
			tuple: Ne,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	PDA: {
		...xe,
		formal: {
			tuple: Ne,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → Q × Γ*"
		}
	},
	NPDA: {
		...Ee,
		formal: {
			tuple: Ne,
			delta: () => "Q × (Σ ∪ {ε}) × Γ → P(Q × Γ*)"
		}
	},
	QA: {
		...Ee,
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
		...Ee,
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
		...Ee,
		schema: {
			...Te.schema,
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
		...Te,
		simulate: function(t) {
			const e = Ae(t), n = q.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, a = n ? e.accepted ? "Accepting run found" : e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting run found" : "";
			q.simSteps = we(e.witnessPath, s, a);
			const o = q.simSteps[q.simSteps.length - 1];
			if (o) {
				const t = [...e.outputs];
				t.length ? 1 === t.length ? o.note += ` | Output: "${t[0]}"` : o.note += ` | Outputs: {${t.map((t) => `"${t}"`).join(", ")}}` : o.note += " | Output: \"\"";
			}
			return q.simIdx = 0, e;
		},
		decide: (t) => {
			const e = function(t) {
				const e = Ae(t), n = [...e.outputs];
				return {
					accepted: e.accepted,
					output: n.length ? n[0] : "",
					outputs: n
				};
			}(t);
			return At(e.accepted, e.output);
		},
		schema: {
			...Te.schema,
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
var Fe = class t {
	constructor(t = [], e = "⊔", n = !1, s = {}) {
		this.blank = e, this.twoWay = !!n, this.rightBound = s.rightBound ?? null, this.immutable = s.immutable || null, this.head = 0, this.cells = /* @__PURE__ */ new Map(), t.forEach((t, e) => this.cells.set(e, t));
	}
	read() {
		return this.cells.has(this.head) ? this.cells.get(this.head) : this.blank;
	}
	write(t) {
		return !(this.immutable && this.immutable.has(this.read()) || (t === this.blank ? this.cells.delete(this.head) : this.cells.set(this.head, t), 0));
	}
	move(t) {
		const e = "R" === t ? 1 : "L" === t ? -1 : 0, n = this.head + e;
		return !(!this.twoWay && n < 0 || null !== this.rightBound && n > this.rightBound || (this.head = n, 0));
	}
	snapshot() {
		const t = [...this.cells.keys()], e = this.twoWay ? Math.min(this.head, ...t) : 0, n = null !== this.rightBound ? this.rightBound : Math.max(this.head, ...t, e), s = [];
		for (let a = e; a <= n; a++) s.push(this.cells.has(a) ? this.cells.get(a) : this.blank);
		return {
			tape: s,
			head: this.head - e,
			origin: e
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
		return e.cells = new Map(this.cells), e.head = this.head, e;
	}
};
function De(t, e) {
	return `${t}|${e.map((t) => t.key()).join("")}`;
}
function Pe(t) {
	const e = t.blank, n = t.twoWay, s = t.rightBound, a = t.immutable ? [...t.immutable] : [], o = new Map(t.cells), i = [], r = [], c = [];
	let l = null;
	function u(t, e) {
		const n = r[e];
		void 0 !== n && (void 0 === c[e] ? t.delete(n) : t.set(n, c[e]));
	}
	function d(t) {
		if (l && l.i === t && l.frame) return l.frame;
		const a = function(t) {
			let e, n;
			l && l.i <= t ? (e = l.cells, n = l.i) : (e = new Map(o), n = 0);
			for (let s = n; s < t; s++) u(e, s);
			return e;
		}(t), r = i[t] ?? 0;
		let c, d = 0;
		if (n) {
			d = r;
			for (const t of a.keys()) t < d && (d = t);
		}
		if (null !== s) c = s;
		else {
			c = r > d ? r : d;
			for (const t of a.keys()) t > c && (c = t);
		}
		const p = [];
		for (let n = d; n <= c; n++) p.push(a.has(n) ? a.get(n) : e);
		const f = {
			tape: p,
			head: r - d,
			origin: d
		};
		return l = {
			i: t,
			cells: a,
			frame: f
		}, f;
	}
	return {
		begin(t) {
			const e = i.length;
			return i.push(t), r.push(void 0), c.push(void 0), e;
		},
		noteWrite(t, e, n) {
			r[t] = e, c[t] = n.has(e) ? n.get(e) : void 0;
		},
		frameAt: d,
		viewAt(t) {
			const o = d(t);
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
const Me = {
	get tape() {
		return this._log.frameAt(this._i).tape;
	},
	get head() {
		return this._log.frameAt(this._i).head;
	},
	get view() {
		return this._log.viewAt(this._i);
	}
}, Ce = {
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
function je(t, e, n) {
	const s = Object.create(Me);
	return s._log = t, s._i = e, Object.assign(s, n);
}
function Qe(t, e, n) {
	const s = Object.create(Ce);
	return s._logs = t, s._i = e, Object.assign(s, n);
}
function* Re(t) {
	const e = new Fe(t, q.config.sym.blank, K()), n = Pe(e);
	let s = H(), a = null;
	const o = yt();
	let i = null, r = 0;
	for (; r < q.config.maxTmSteps; r++) {
		const c = e.read(), l = e.twoWay ? ` @${e.head}` : "", u = n.begin(e.head);
		if (i = je(n, u, {
			state: s,
			tokens: t,
			tid: a,
			note: `State:${Z(s)?.name} Read:'${c}'${l}`
		}), q.accepts.has(s)) return i.final = "accept", i.note += " — ACCEPT", void (yield i);
		const d = o.seenAt(`${s}|${e.key()}`, r);
		if (d >= 0) return wt(i, d), void (yield i);
		const p = gt(s, c);
		if (!p) return i.final = "reject", i.note += " — REJECT", void (yield i);
		yield i;
		const f = e.head;
		e.write(p.write && p.write !== q.config.sym.any ? p.write : c), n.noteWrite(u, f, e.cells), s = p.to, a = p.id, e.move(p.dir);
	}
	i && !i.final && kt(i);
}
function Be(t) {
	pt(Re(t));
}
function* Oe(t) {
	const e = new Fe(t, q.config.sym.blank, K()), n = [{
		state: H(),
		tape: e,
		depth: 0,
		branch: 1
	}], s = /* @__PURE__ */ new Set([`${H()}|${e.key()}`]);
	let a = !1, o = 0, i = 0;
	const r = [];
	let c = 2, l = null;
	for (; n.length && o < q.config.maxTmSteps;) {
		const e = n.shift(), { state: u, depth: d, branch: p } = e, f = e.tape.snapshot(), h = f.tape, m = f.head, g = e.tape.read(), b = Z(u)?.name || u, y = $t(u, h, m);
		o++, i = Math.max(i, d);
		const w = {
			state: u,
			tokens: t,
			tape: [...h],
			head: m,
			view: e.tape.view(),
			branch: p,
			note: `Branch ${p} depth ${d}: ${b} reads '${g}'`
		};
		if (q.accepts.has(u)) {
			w.final = "accept", w.note += " — ACCEPT", l = w, yield w, r.push(`<span class="step-acc">Branch ${p}: ACCEPT ✓</span><span class="step-sub">State "${b}" is accepting.<br>Depth ${d} · ID: ${y}</span>`), a = !0;
			break;
		}
		const k = q.transitions.filter((t) => t.from === u && (t.symbol === g || t.symbol === q.config.sym.any));
		if (!k.length) {
			w.note += " — dead branch", l = w, yield w, r.push(`Branch ${p}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches (${b}, '${g}').<br>Depth ${d} · ID: ${y}</span>`);
			continue;
		}
		w.note += k.length > 1 ? ` — branching ×${k.length}` : " — deterministic step", l = w, yield w;
		const $ = [`Read '${g}' at head position ${e.tape.twoWay ? e.tape.head : m}.`, `Depth ${d} · ID: ${y}`];
		k.length > 1 && $.push(`Nondeterministic choice: ${k.length} matching transitions.`), r.push(`Branch ${p}: exploring <em>${b}</em><span class="step-sub">${$.join("<br>")}</span>`), k.forEach((t) => {
			const a = e.tape.clone();
			a.write(t.write && t.write !== q.config.sym.any ? t.write : g), a.move(t.dir);
			const o = `${t.to}|${a.key()}`;
			s.has(o) || (s.add(o), n.push({
				state: t.to,
				tape: a,
				depth: d + 1,
				branch: c++
			}));
		});
	}
	if (!a) {
		const s = n.length > 0, a = s ? `NO VERDICT: exploration limit ${q.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance — REJECT", c = l?.tape || e.snapshot().tape, u = l?.head ?? 0;
		yield {
			state: l?.state || H(),
			tokens: t,
			tape: [...c],
			head: u,
			note: a,
			final: s ? "timeout" : "reject",
			limit: s ? q.config.maxTmSteps : void 0
		}, r.push(`${n.length ? "Exploration limit reached" : "Reject"}<span class="step-sub">${a}.<br>Branches explored: ${o} · max depth ${i}</span>`);
	}
	return {
		accepted: a,
		branches: o,
		maxDepth: i,
		log: r
	};
}
function Ie(t, e, n, s) {
	const a = Array.isArray(e) ? null : Array.isArray(e?.tapes) ? e.tapes : null;
	return a ? Array.from({ length: t }, (t, e) => new Fe(a[e] || [], n, s)) : function(t, e, n, s) {
		return Array.from({ length: t }, (t, a) => new Fe(0 === a ? e : [], n, s));
	}(t, Array.isArray(e) ? e : [], n, s);
}
function Le(t, e, n) {
	const s = q.config.sym.any;
	for (let a = 0; a < t.length; a++) {
		const o = e.tapeWrites?.[a];
		t[a].write(o && o !== s ? o : n[a]);
	}
	for (let a = 0; a < t.length; a++) t[a].move(e.tapeDirs?.[a]);
}
function* We(t) {
	const e = q.tapeCount, n = q.config.sym.blank, s = K(), a = function(t) {
		return Array.isArray(t) ? t : t?.tapes?.[0] || [];
	}(t), o = Ie(e, t, n, s);
	let i = H(), r = null;
	const c = o.map((t) => Pe(t)), l = yt();
	let u = null;
	for (let d = 0; d < q.config.maxTmSteps; d++) {
		const t = o.map((t) => t.read()), e = s ? ` @[${o.map((t) => t.head).join(",")}]` : "", n = c[0].begin(o[0].head);
		for (let s = 1; s < c.length; s++) c[s].begin(o[s].head);
		if (u = Qe(c, n, {
			state: i,
			tokens: a,
			tid: r,
			note: `State:${Z(i)?.name} Read:[${t.join(",")}]${e}`
		}), q.accepts.has(i)) return u.final = "accept", u.note += " — ACCEPT", void (yield u);
		const p = l.seenAt(De(i, o), d);
		if (p >= 0) return wt(u, p), void (yield u);
		const f = bt(i, t);
		if (!f) return u.final = "reject", u.note += " — REJECT", void (yield u);
		yield u;
		const h = o.map((t) => t.head);
		Le(o, f, t);
		for (let s = 0; s < c.length; s++) c[s].noteWrite(n, h[s], o[s].cells);
		i = f.to, r = f.id;
	}
	u && !u.final && kt(u);
}
function* qe(t) {
	const e = ze(t), n = Pe(e);
	let s = H(), a = null;
	const o = yt();
	let i = null;
	for (let r = 0; r < q.config.maxTmSteps; r++) {
		const c = e.read(), l = n.begin(e.head);
		if (i = je(n, l, {
			state: s,
			tokens: t,
			tid: a,
			note: `State:${Z(s)?.name} Read:'${c}'`
		}), q.accepts.has(s)) return i.final = "accept", i.note += " — ACCEPT", void (yield i);
		const u = o.seenAt(`${s}|${e.key()}`, r);
		if (u >= 0) return wt(i, u), void (yield i);
		const d = gt(s, c);
		if (!d) return i.final = "reject", i.note += " — REJECT", void (yield i);
		yield i;
		const p = e.head;
		e.write(d.write && d.write !== q.config.sym.any ? d.write : c), n.noteWrite(l, p, e.cells), s = d.to, a = d.id;
		const f = "L" === d.dir ? q.config.sym.leftMarker : q.config.sym.rightMarker;
		if (!e.move(d.dir)) return i = je(n, n.begin(e.head), {
			state: s,
			tokens: t,
			tid: a,
			note: `Attempted to move outside the ${f} boundary. — REJECT`,
			final: "reject"
		}), void (yield i);
	}
	i && !i.final && kt(i);
}
function Je(t, e) {
	e = e || Ft();
	const n = q.config.sym.any, s = new Fe(t, q.config.sym.blank, K());
	let a = H();
	const o = /* @__PURE__ */ new Set();
	for (let i = 0; i < e; i++) {
		if (q.accepts.has(a)) return "acc";
		const t = `${a}|${s.key()}`;
		if (o.has(t)) return "rej";
		o.add(t);
		const e = s.read(), i = gt(a, e);
		if (!i) return "rej";
		s.write(i.write && i.write !== n ? i.write : e), s.move(i.dir), a = i.to;
	}
	return "unk";
}
function ze(t) {
	const { leftMarker: e, rightMarker: n, blank: s } = q.config.sym;
	return new Fe(rt(t), s, !1, {
		rightBound: t.length + 1,
		immutable: /* @__PURE__ */ new Set([e, n])
	});
}
const _e = {
	conflict: (t, e) => xt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has δ(${Et(t.from)}, '${t.symbol}'). Use NDTM mode if you want multiple choices for the same read symbol.`
}, Ve = {
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
}, Ue = (t) => (e, n = {}) => ({
	verdict: t(e, n.budget),
	output: null
});
function* He(t) {
	let e = H();
	const n = Z(e), s = n?.output ?? "";
	let a = s, o = Dt(null, s), i = Bt({
		state: e,
		tokens: t,
		outNode: o,
		outSoFar: a,
		note: `Start: ${n?.name} — ${q.config.sym.lambda}: '${s}'`
	});
	yield i;
	for (let c = 0; c < t.length; c++) {
		const n = t[c], s = gt(e, n);
		if (!s) {
			i = Bt({
				state: e,
				tokens: t,
				outNode: o,
				outSoFar: a,
				note: `No δ(${Z(e)?.name},'${n}') — HALT`,
				final: "reject"
			}), yield i;
			break;
		}
		e = s.to;
		const r = Z(e), l = r?.output ?? "";
		a += l, o = Dt(o, l), i = Bt({
			state: e,
			tokens: t,
			outNode: o,
			outSoFar: a,
			note: `Read '${n}' → ${r?.name} — ${q.config.sym.lambda}: '${l}'`,
			tid: s.id
		}), yield i;
	}
	const r = q.config.transducerAccepts;
	!i.final && r && (i.final = q.accepts.has(e) ? "accept" : "reject", i.note += ` — ${i.final.toUpperCase()}`), i.note += ` | Output: "${a}"`;
}
function* Ze(t) {
	let e = H(), n = "", s = null, a = Bt({
		state: e,
		tokens: t,
		outNode: s,
		outSoFar: n,
		note: `Start: ${Z(e)?.name}`
	});
	yield a;
	for (let i = 0; i < t.length; i++) {
		const o = t[i], r = gt(e, o);
		if (!r) {
			a = Bt({
				state: e,
				tokens: t,
				outNode: s,
				outSoFar: n,
				note: `No δ(${Z(e)?.name},'${o}') — HALT`,
				final: "reject"
			}), yield a;
			break;
		}
		const c = r.output ?? "?";
		n += c, s = Dt(s, c), e = r.to, a = Bt({
			state: e,
			tokens: t,
			outNode: s,
			outSoFar: n,
			note: `Read '${o}' → ${Z(e)?.name} — out: '${c}'`,
			tid: r.id
		}), yield a;
	}
	const o = q.config.transducerAccepts;
	!a.final && o && (a.final = q.accepts.has(e) ? "accept" : "reject", a.note += ` — ${a.final.toUpperCase()}`), n.length && (a.note += ` | Output: "${n}"`);
}
function Ge(t, e, n) {
	return `${t}|${e}|${n}`;
}
function Ke(t, e) {
	const n = q.config.sym.eps;
	return q.transitions.filter((s) => !(s.from !== t.state || s.symbol !== n && (t.index >= e.length || s.symbol !== e[t.index] && s.symbol !== q.config.sym.any)));
}
function Xe(t, e, n) {
	const s = q.config.sym.eps, a = e.output ?? "", o = "" === a ? q.config.sym.lambda : a, i = e.symbol !== s;
	return {
		state: e.to,
		index: i ? t.index + 1 : t.index,
		depth: t.depth + 1,
		branch: n,
		outRaw: t.outRaw + a,
		outNode: Dt(t.outNode, o),
		parent: t,
		via: e
	};
}
function Ye(t) {
	const e = {
		state: H(),
		index: 0,
		depth: 0,
		branch: 1,
		outRaw: "",
		outNode: null,
		parent: null,
		via: null
	}, n = [e], s = /* @__PURE__ */ new Set([Ge(e.state, e.index, e.outRaw)]), a = /* @__PURE__ */ new Set();
	let o = null, i = null, r = e, c = 0, l = 0, u = 2;
	for (; n.length && c < q.config.maxPdaSteps;) {
		const e = n.shift();
		if (r = e, c++, l = Math.max(l, e.depth), e.index === t.length) {
			const t = q.accepts.has(e.state);
			Tt(!0, t) && a.add(e.outRaw), i || (i = e), q.config.transducerAccepts && t && !o && (o = e);
		}
		const d = Ke(e, t);
		d.length && d.forEach((t, a) => {
			const o = 1 === d.length || 0 === a ? e.branch : u++, i = Xe(e, t, o), r = Ge(i.state, i.index, i.outRaw);
			s.has(r) || (s.add(r), n.push(i));
		});
	}
	const d = o || i || r;
	return {
		accepted: !!o,
		witnessPath: Nt(d),
		finalCfg: d,
		outputs: a,
		unresolved: !o && n.length > 0,
		branches: c,
		maxDepth: l
	};
}
ot(Ve, {
	TM: {
		simulate: Be,
		stream: Re,
		decide: Ue(Je),
		deterministicDelta: !0,
		determinism: _e
	},
	NDTM: {
		simulate: function(t) {
			return pt(Oe(t));
		},
		stream: Oe,
		decide: Ue(function(t, e) {
			e = e || Ft();
			const n = q.config.sym.any, s = new Fe(t, q.config.sym.blank, K()), a = [{
				state: H(),
				tape: s
			}], o = /* @__PURE__ */ new Set([`${H()}|${s.key()}`]);
			let i = 0;
			for (; a.length;) {
				if (i++ >= e) return "unk";
				const t = a.shift();
				if (q.accepts.has(t.state)) return "acc";
				const s = t.tape.read(), r = q.transitions.filter((e) => e.from === t.state && (e.symbol === s || e.symbol === n));
				for (const e of r) {
					const i = t.tape.clone();
					i.write(e.write && e.write !== n ? e.write : s), i.move(e.dir);
					const r = `${e.to}|${i.key()}`;
					o.has(r) || (o.add(r), a.push({
						state: e.to,
						tape: i
					}));
				}
			}
			return "rej";
		}),
		formal: {
			...Ve.formal,
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
			say: (t) => `MTM already has a transition for (${Et(t.from)}, [${(t.tapeSyms || []).join(", ")}]). Each read tuple must be unique.`
		},
		simulate: function(t) {
			pt(We(t));
		},
		stream: We,
		decide: Ue(function(t, e) {
			e = e || Ft();
			const n = Ie(q.tapeCount || 2, t, q.config.sym.blank, K());
			let s = H();
			const a = /* @__PURE__ */ new Set();
			for (let o = 0; o < e; o++) {
				if (q.accepts.has(s)) return "acc";
				const t = De(s, n);
				if (a.has(t)) return "rej";
				a.add(t);
				const e = n.map((t) => t.read()), o = bt(s, e);
				if (!o) return "rej";
				Le(n, o, e), s = o.to;
			}
			return "unk";
		}),
		parseInput: function(t) {
			if (!String(t).includes(",")) return St(t);
			const e = String(t).split(",");
			if (e.length !== q.tapeCount) return {
				ok: !1,
				error: `MTM: found ${e.length} comma-separated segment(s) but machine has ${q.tapeCount} tape(s). Provide one value per tape.`
			};
			const n = [];
			for (let s = 0; s < e.length; s++) {
				const t = e[s].trim(), a = ft(t === q.config.sym.eps ? "" : t);
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
			...Ve.schema,
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
			...Ve.formal,
			delta: () => {
				const t = q.tapeCount || 2;
				return `Q × Γ^${t} → Q × Γ^${t} × {L, R, S}^${t}`;
			}
		}
	},
	LBA: {
		simulate: function(t) {
			pt(qe(t));
		},
		stream: qe,
		decide: Ue(function(t, e) {
			e = e || Ft();
			const n = q.config.sym.any, s = ze(t);
			let a = H();
			const o = /* @__PURE__ */ new Set();
			for (let i = 0; i < e; i++) {
				if (q.accepts.has(a)) return "acc";
				const t = `${a}|${s.key()}`;
				if (o.has(t)) return "rej";
				o.add(t);
				const e = s.read(), i = gt(a, e);
				if (!i) return "rej";
				if (s.write(i.write && i.write !== n ? i.write : e), a = i.to, !s.move(i.dir)) return "rej";
			}
			return "unk";
		}),
		deterministicDelta: !0,
		determinism: _e,
		options: []
	},
	ITM: {
		simulate: function(t) {
			return Be(t);
		},
		stream: function(t) {
			return Re(t);
		},
		decide: Ue(function(t, e) {
			return Je(t, e);
		}),
		deterministicDelta: !0,
		determinism: _e,
		options: []
	}
});
const tn = {
	conflict: (t, e) => xt(t.from, t.symbol, e),
	say: (t) => `${q.machine} already has δ(${Et(t.from)}, '${t.symbol}'). Each input symbol must map to one output.`
}, en = {
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
function nn(t) {
	return "R" === t ? 1 : "L" === t ? -1 : 0;
}
function sn(t, e) {
	return e;
}
function an(t, e) {
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
function on(t, e) {
	return q.transitions.filter((n) => n.from === t && (n.symbol === e || n.symbol === q.config.sym.any));
}
function rn(t, e, n = null, s = "") {
	const a = function(t) {
		return rt(t);
	}(e), o = t.map((n, s) => {
		const o = Z(n.state)?.name || n.state, i = {
			state: n.state,
			tokens: e,
			tape: a,
			head: sn(0, n.head),
			view: an(a, sn(0, n.head)),
			branch: n.branch,
			tid: n.via?.id,
			note: ""
		}, r = void 0 !== n.outNode;
		r && (i.outNode = n.outNode, i.outSoFar = n.outRaw);
		const c = r ? Bt(i) : i;
		if (0 === s) c.note = `Start: ${o} at ${a[n.head]}`;
		else {
			const e = t[s - 1], i = Z(e.state)?.name || e.state, r = function(t, e) {
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
function cn(t) {
	const e = rt(t), n = [{
		state: H(),
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
			finalNote: `Accepted in state ${Z(t.state)?.name || t.state}`
		};
		if (t.head < 0 || t.head >= e.length) return {
			accepted: !1,
			path: n,
			finalNote: `Head moved outside endmarker bounds at index ${t.head}`
		};
		const s = e[t.head], a = dt(on(t.state, s), (t) => t.symbol === s ? 1 : 0);
		if (!a) return {
			accepted: !1,
			path: n,
			finalNote: `No valid transition on '${s}'`
		};
		const o = t.head + nn(a.dir);
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
function ln(t) {
	const e = rt(t), n = {
		state: H(),
		head: 0,
		depth: 0,
		branch: 1,
		parent: null,
		via: null
	}, s = [n], a = /* @__PURE__ */ new Set([`${n.state}|${n.head}`]);
	let o = null, i = n, r = 0, c = 0, l = 2;
	for (; s.length && r < q.config.maxTmSteps;) {
		const t = s.shift();
		if (i = t, r++, c = Math.max(c, t.depth), q.accepts.has(t.state)) {
			o = t;
			break;
		}
		if (t.head < 0 || t.head >= e.length) continue;
		const n = e[t.head], u = on(t.state, n);
		u.length && u.forEach((n, o) => {
			const i = 1 === u.length || 0 === o ? t.branch : l++, r = t.head + nn(n.dir);
			if (r < 0 || r >= e.length) return;
			const c = {
				state: n.to,
				head: r,
				depth: t.depth + 1,
				branch: i,
				parent: t,
				via: n
			}, d = `${c.state}|${c.head}`;
			a.has(d) || (a.add(d), s.push(c));
		});
	}
	const u = o || i;
	return {
		accepted: !!o,
		witnessPath: Nt(u),
		finalCfg: u,
		unresolved: !o && s.length > 0,
		branches: r,
		maxDepth: c
	};
}
function un(t) {
	const e = rt(t), n = q.config.sym.lambda, s = [{
		state: H(),
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
			finalNote: `Accepted in state ${Z(t.state)?.name || t.state}`
		};
		const a = e[t.head], o = dt(on(t.state, a), (t) => t.symbol === a ? 1 : 0);
		if (!o) return {
			accepted: !1,
			halted: !0,
			path: s,
			finalNote: `No valid transition on '${a}'`
		};
		const i = t.head + nn(o.dir);
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
			outNode: Dt(t.outNode, "" === r ? n : r)
		});
	}
	return {
		accepted: !1,
		halted: !1,
		path: s,
		finalNote: `2DFT step limit ${q.config.maxTmSteps} reached`
	};
}
ot(en, {
	Moore: {
		simulate: function(t) {
			pt(He(t));
		},
		stream: He,
		deterministicDelta: !0,
		determinism: tn,
		decide: (t) => At(Wt(t), function(t) {
			let e = H();
			const n = [Z(e)?.output ?? ""];
			for (const s of t) {
				const t = gt(e, s);
				if (!t) break;
				e = t.to, n.push(Z(e)?.output ?? "");
			}
			return n.join("");
		}(t)),
		schema: {
			...en.schema,
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
			pt(Ze(t));
		},
		stream: Ze,
		deterministicDelta: !0,
		determinism: tn,
		decide: (t) => At(Wt(t), function(t) {
			let e = H();
			const n = [];
			for (const s of t) {
				const t = gt(e, s);
				if (!t) break;
				n.push(t.output ?? "?"), e = t.to;
			}
			return n.join("");
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
			const e = Ye(t), n = q.config.transducerAccepts, s = n ? e.accepted ? "accept" : "reject" : null, a = n ? e.accepted ? "Accepting branch found" : e.unresolved ? `Exploration limit ${q.config.maxPdaSteps} reached — unresolved branches remain` : "No accepting branch found" : "";
			q.simSteps = function(t, e, n = null, s = "") {
				const a = t.map((n, s) => {
					const a = Z(n.state)?.name || n.state, o = Bt({
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
						const e = t[s - 1], i = Z(e.state)?.name || e.state, r = n.via?.symbol || q.config.sym.eps, c = void 0 !== n.via?.output && "" !== n.via?.output ? n.via.output : q.config.sym.lambda;
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
			return q.simIdx = 0, e;
		},
		decide: (t) => {
			const e = function(t) {
				const e = Ye(t), n = [...e.outputs];
				let s = "";
				return s = n.length > 1 ? n.join(" | ") : 1 === n.length ? n[0] : e.witnessPath.at(-1)?.outRaw || "", {
					accepted: e.accepted,
					output: s
				};
			}(t);
			return At(e.accepted, e.output);
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
const dn = (t) => ({
	conflict: (t, e) => xt(t.from, t.symbol, e),
	say: (e) => `${q.machine} already has δ(${Et(e.from)}, '${e.symbol}'). Use ${t} mode if you want multiple choices for the same read symbol.`
}), pn = {
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
function fn(t) {
	const e = q.simStart;
	if (null == e) return t();
	q.simStart = null;
	try {
		return t();
	} finally {
		q.simStart = e;
	}
}
function hn(t) {
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
ot(pn, {
	"2DFA": {
		simulate: function(t) {
			const e = cn(t);
			return q.simSteps = rn(e.path, t, e.accepted ? "accept" : "reject", e.finalNote), q.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: dn("2NFA"),
		decide: (t) => vt(function(t) {
			return cn(t).accepted;
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
			const e = ln(t), n = e.accepted ? `Accepted in state ${Z(e.finalCfg.state)?.name || e.finalCfg.state}` : e.unresolved ? `Exploration limit ${q.config.maxTmSteps} reached — unresolved branches remain` : "All branches halted without acceptance";
			return q.simSteps = rn(e.witnessPath, t, e.accepted ? "accept" : "reject", n), q.simIdx = 0, e;
		},
		decide: (t) => vt(function(t) {
			return ln(t).accepted;
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
			const e = un(t), n = q.config.transducerAccepts, s = e.halted ? n ? e.accepted ? "accept" : "reject" : null : "timeout";
			q.simSteps = rn(e.path, t, s, e.finalNote);
			const a = q.simSteps[q.simSteps.length - 1];
			return a && (e.halted || (a.limit = q.config.maxTmSteps), a.note += ` | Output: "${e.path[e.path.length - 1]?.outRaw ?? ""}"`), q.simIdx = 0, e;
		},
		deterministicDelta: !0,
		determinism: dn("FST"),
		decide: (t) => {
			const e = function(t) {
				const e = un(t), n = e.path[e.path.length - 1];
				return {
					accepted: e.accepted,
					halted: e.halted,
					output: n?.outRaw ?? ""
				};
			}(t);
			return e.halted ? At(e.accepted, e.output) : {
				verdict: "unk",
				output: e.output
			};
		},
		schema: {
			...pn.schema,
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
const mn = [
	"sigma",
	"outputAlpha",
	"stackAlpha",
	"accepts"
], gn = [
	"machine",
	"tapeCount",
	"startId"
];
function bn(t, e) {
	if ("load" === t.type) return function(t) {
		for (const e of gn) q[e] = t[e];
		for (const e of mn) q[e] = new Set(t[e] || []);
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
						return !s || s.parseInput ? null : fn(() => s.decide(e, n, t));
					}(t.machine, e)?.verdict ?? "unk";
				} catch {
					return "unk";
				}
			}) : function(t) {
				const e = q.machine, n = !!G(e).isTransducer;
				return t.map(hn).map(({ input: t, expect: s }) => function(t, e, n = q.machine, s = null) {
					const a = null === s ? !!G(n).isTransducer : s, o = function(t, e) {
						const n = it(t);
						return n ? (n.parseInput || St)(e, t) : {
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
						return s ? fn(() => s.decide(e, n, t)) : {
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
const yn = { loaded: -1 };
self.onmessage = (t) => self.postMessage(bn(t.data, yn));
