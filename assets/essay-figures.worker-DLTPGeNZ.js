function t(t, { maxSteps: e = 1e8, want: s = () => !1, see: n = () => {} } = {}) {
	const o = function(t) {
		const e = String(t || "").split("_").filter(Boolean);
		if (!e.length || e[0].length % 3) return null;
		const s = e[0].length / 3, n = [];
		for (const o of e) {
			if (o.length !== 3 * s) return null;
			const t = [];
			for (let n = 0; n < s; n++) {
				const s = /^(\d)([LR])([A-Z])$/.exec(o.slice(3 * n, 3 * n + 3));
				if (!s) {
					t.push(null);
					continue;
				}
				const a = s[3].charCodeAt(0) - 65;
				t.push({
					write: Number(s[1]),
					move: "L" === s[2] ? -1 : 1,
					next: a < e.length ? a : -1
				});
			}
			n.push(t);
		}
		return n;
	}(t);
	if (!o) return null;
	const a = new Uint8Array(1 << 20);
	let l = 524288, r = 0, h = 0, c = 0, i = l, u = l, f = !1;
	for (; h < e;) {
		s(h) && n(h, a, l, c);
		const t = o[r]?.[a[l]];
		if (!t) {
			f = !0;
			break;
		}
		if (c += (t.write ? 1 : 0) - (a[l] ? 1 : 0), a[l] = t.write, l += t.move, h++, l < i && (i = l), l > u && (u = l), t.next < 0) {
			f = !0;
			break;
		}
		if (l <= 0 || l >= 1048575) break;
		r = t.next;
	}
	return n(h, a, l, c), {
		steps: h,
		ones: c,
		halted: f,
		lo: i - 524288,
		hi: u - 524288
	};
}
const e = (t) => Math.round(10 * t) / 10, s = (t) => Number(t).toLocaleString("en-US");
function n(t) {
	const e = Math.round(Math.log10(t)), s = String(e).split("").map((t) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+t]).join("");
	return 0 === e ? "1" : 1 === e ? "10" : `10${s}`;
}
function o(t) {
	const e = 10 ** Math.floor(Math.log10(t / 4)), s = [
		1,
		2,
		2.5,
		5,
		10
	].map((t) => t * e).find((e) => t / e <= 6) || t / 4, n = [];
	for (let o = 0; o <= t + 1e-9; o += s) n.push(o);
	return n;
}
function a(a, l, r = {}) {
	return "spacetime" === a ? function(n, { steps: o = 2e3, w: a = 680, h: l = 420 } = {}) {
		const r = [], h = Math.max(1, Math.ceil(o / l)), c = t(n, {
			maxSteps: o,
			want: (t) => t % h === 0,
			see: (t, e, s) => {
				const n = [];
				let o = -1;
				const a = e.length >> 1;
				for (let l = a - 4096; l <= a + 4096; l++) {
					const t = e[l];
					t && o < 0 && (o = l), !t && o >= 0 && (n.push([
						o - a,
						l - a,
						e[o]
					]), o = -1);
				}
				r.push({
					t,
					head: s - a,
					on: n
				});
			}
		});
		if (!c) return null;
		let i = 0, u = 0;
		for (const t of r) {
			i = Math.min(i, t.head), u = Math.max(u, t.head);
			for (const [e, s] of t.on) i = Math.min(i, e), u = Math.max(u, s - 1);
		}
		const f = (a - 28) / (u - i + 1), g = (l - 28) / r.length, p = (t) => 14 + (t - i) * f, x = (t) => 14 + t * g, $ = [`<svg class="sk sk-run essay-st" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a} ${l}" preserveAspectRatio="none" role="img" aria-label="Space-time diagram of the first ${s(c.steps)} steps from a blank tape">`];
		return r.forEach((t, s) => {
			for (const [n, o, a] of t.on) $.push(`<rect class="rn-${Math.min(a, 4)}" x="${e(p(n))}" y="${e(x(s))}" width="${e(Math.max(f * (o - n), .6))}" height="${e(g + .15)}"/>`);
		}), 1 === h && $.push(`<path class="st-head" d="${r.map((t, s) => `${s ? "L" : "M"}${e(p(t.head) + f / 2)} ${e(x(s) + g / 2)}`).join("")}"/>`), $.push("</svg>"), $.join("");
	}(l, r) : "growth" === a ? function(a, { maxSteps: l = 1e8, w: r = 680, h = 300, scale: c = "log", yScale: i = "linear" } = {}) {
		const u = [], f = "log" === c, g = /* @__PURE__ */ new Set();
		if (f) for (let t = 0; t <= 2400; t++) g.add(Math.floor(Math.pow(10, t / 300)));
		let p = 0;
		const x = f ? null : t(a, { maxSteps: l });
		f || (p = Math.max(1, Math.floor((x?.steps || l) / 1200)));
		let $ = 0;
		const m = t(a, {
			maxSteps: l,
			want: (t) => f ? g.has(t) : t % p === 0,
			see: (t, e, s, n) => {
				u.push([t, n]), n > $ && ($ = n);
			}
		});
		if (!m || u.length < 2) return null;
		const M = Math.max(m.steps, 10), d = "log" === i, w = d ? 10 ** Math.ceil(Math.log10(Math.max($, 10))) : function(t) {
			const e = 10 ** Math.floor(Math.log10(t));
			for (const s of [
				1,
				1.25,
				1.5,
				2,
				2.5,
				3,
				4,
				5,
				6,
				8,
				10
			]) if (s * e >= t) return s * e;
			return 10 * e;
		}(Math.max($, m.ones, 1)), y = 34, v = (t) => 64 + (f ? Math.log10(Math.max(t, 1)) / Math.log10(M) : t / M) * (r - 64 - 16), S = (t) => h - y - (d ? Math.log10(Math.max(t, 1)) / Math.log10(w) : t / w) * (h - 14 - y), k = [`<svg class="sk essay-growth" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r} ${h}" role="img" aria-label="Non-blank cells against steps${f ? ", steps on a log scale" : ""}">`], b = f ? Array.from({ length: Math.floor(Math.log10(M)) + 1 }, (t, e) => 10 ** e) : o(M);
		for (const t of b) {
			const o = e(v(t));
			k.push(`<line class="gr-grid" x1="${o}" y1="14" x2="${o}" y2="${h - y}"/>`), k.push(`<text class="gr-tick" x="${o}" y="${h - y + 18}" text-anchor="middle">${f ? n(t) : s(t)}</text>`);
		}
		for (const t of d ? Array.from({ length: Math.log10(w) + 1 }, (t, e) => 10 ** e) : o(w)) {
			const n = e(S(t));
			k.push(`<line class="gr-grid" x1="64" y1="${n}" x2="${r - 16}" y2="${n}"/>`), k.push(`<text class="gr-tick" x="56" y="${n + 4}" text-anchor="end">${s(t)}</text>`);
		}
		k.push(`<line class="gr-axis" x1="64" y1="${h - y}" x2="${r - 16}" y2="${h - y}"/>`);
		let A = "";
		return u.forEach(([t, s], n) => {
			const o = e(v(t)), a = e(S(s));
			A += n ? `H${o}V${a}` : `M${o} ${a}`;
		}), k.push(`<path class="gr-line" d="${A}"/>`), m.halted && k.push(`<circle class="gr-end" cx="${e(v(m.steps))}" cy="${e(S(m.ones))}" r="3.5"/>`), k.push("</svg>"), k.join("");
	}(l, r) : null;
}
self.onmessage = ({ data: t }) => {
	let e = null;
	try {
		e = a(t.kind, t.code, t.opts);
	} catch {}
	self.postMessage({
		id: t.id,
		svg: e
	});
};
