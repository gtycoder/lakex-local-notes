//#region ../../node_modules/@xiangfa/mindmap/dist/esm/plugins/runner.js
function e(e, t, n) {
	for (let r of e) r.preParseMarkdown && (t = r.preParseMarkdown(t, n));
	return t;
}
function t(e, t, n, r) {
	for (let i of e) if (i.parseLine) {
		let e = i.parseLine(t, n, r);
		if (e) return e;
	}
	return null;
}
function n(e, t, n, r, i) {
	let a = 0;
	for (let o of e) if (o.collectFollowLines) {
		let e = o.collectFollowLines(t, n + a, r, i);
		a += e;
	}
	return a;
}
function r(e, t, n, r) {
	for (let i of e) i.transformNodeData && (t = i.transformNodeData(t, n, r));
	return t;
}
function i(e, t, n) {
	for (let r of e) r.postParseTree && (t = r.postParseTree(t, n));
	return t;
}
function a(e, t) {
	let n = "";
	for (let r of e) if (r.serializePreamble) {
		let e = r.serializePreamble(t);
		e && (n += e);
	}
	return n;
}
function o(e, t, n) {
	let r = n;
	for (let n of e) if (n.serializeListMarker) {
		let e = n.serializeListMarker(t, r);
		if (e !== r) {
			r = e;
			break;
		}
	}
	return r;
}
function s(e, t, n) {
	for (let r of e) r.serializeNodeText && (n = r.serializeNodeText(t, n));
	return n;
}
function c(e, t, n) {
	let r = [];
	for (let i of e) if (i.serializeFollowLines) {
		let e = i.serializeFollowLines(t, n);
		e && r.push(...e);
	}
	return r;
}
function l(e, t, n, r, i) {
	for (let a of e) if (a.adjustNodeSize) {
		let e = a.adjustNodeSize(t, n, r, i);
		n = e.width, r = e.height;
	}
	return {
		width: n,
		height: r
	};
}
function u(e, t, n, r) {
	for (let i of e) i.filterChildren && (n = i.filterChildren(t, n, r));
	return n;
}
function d(e, t, n, r) {
	for (let i of e) i.transformEdge && (t = i.transformEdge(t, n, r));
	return t;
}
function f(e, t, n, r) {
	let i = [];
	for (let a of e) a.generateExtraEdges && i.push(...a.generateExtraEdges(t, n, r));
	return i;
}
function p(e, t, n, r) {
	let i = {};
	for (let a of e) if (a.transformNodeColor) {
		let e = a.transformNodeColor(t, n, r);
		i = {
			...i,
			...e
		};
	}
	return i;
}
function m(e, t, n) {
	let r = [];
	for (let i of e) if (i.renderNodeDecoration) {
		let e = i.renderNodeDecoration(t, n);
		e && r.push(e);
	}
	return r;
}
function h(e, t, n) {
	for (let r of e) if (r.renderInlineToken) {
		let e = r.renderInlineToken(t, n);
		if (e) return e;
	}
	return null;
}
function g(e, t, n, r) {
	let i = [];
	for (let a of e) if (a.renderOverlay) {
		let e = a.renderOverlay(t, n, r);
		e && i.push(e);
	}
	return i;
}
function _(e, t, n, r, i) {
	let a = "";
	for (let o of e) o.exportNodeDecoration && (a += o.exportNodeDecoration(t, n, r, i));
	return a;
}
function v(e, t, n, r) {
	let i = "";
	for (let a of e) a.exportOverlay && (i += a.exportOverlay(t, n, r));
	return i;
}
//#endregion
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/utils/markdown.js
function y(e) {
	let t = e.match(/^\[([ x-])\]\s+(.*)/);
	if (!t) return { text: e };
	let n = t[1], r = t[2];
	return n === " " ? {
		taskStatus: "todo",
		text: r
	} : n === "x" ? {
		taskStatus: "done",
		text: r
	} : n === "-" ? {
		taskStatus: "doing",
		text: r
	} : { text: e };
}
function b(a, o) {
	let s = o && o.length > 0 ? o : void 0, c = s ? {
		lines: [],
		frontMatter: {}
	} : void 0, l = a;
	s && c && (l = e(s, l, c));
	let u = l.split("\n");
	c && (c.lines = u);
	let d = [], f = null, p = [], m = 0;
	for (; m < u.length;) {
		let e = u[m];
		if (/^\s*%%/.test(e)) {
			m++;
			continue;
		}
		let r = s && c ? t(s, e, m, c) : null;
		if (r) {
			let e = r.text.trim(), t = r.taskStatus, { taskStatus: i, text: a } = t ? {
				taskStatus: t,
				text: e
			} : y(e);
			if (a) {
				let e = {
					indent: r.indent,
					text: a,
					taskStatus: i,
					remarkLines: [],
					dottedLine: r.dottedLine,
					collapsed: r.collapsed
				}, t = m + 1;
				for (; t < u.length;) {
					let n = u[t].match(/^(\s*)>\s?(.*)$/);
					if (n) e.remarkLines.push(n[2]), t++;
					else break;
				}
				if (s && c) {
					let r = {
						id: "temp",
						text: a
					}, i = n(s, u, t, r, c);
					Object.assign(e, { _pluginNode: r }), t += i;
				}
				d.push(e), m = t;
				continue;
			}
		}
		let i = e.match(/^(\s*)[*-]\s+(.+)/);
		if (i) {
			let e = i[1].replace(/\t/g, "  ").length, { taskStatus: t, text: r } = y(i[2].trim());
			if (r) {
				let i = {
					indent: e,
					text: r,
					taskStatus: t,
					remarkLines: []
				}, a = m + 1;
				for (; a < u.length;) {
					let e = u[a].match(/^(\s*)>\s?(.*)$/);
					if (e) i.remarkLines.push(e[2]), a++;
					else break;
				}
				if (s && c) {
					let e = {
						id: "temp",
						text: r
					}, t = n(s, u, a, e, c);
					Object.assign(i, { _pluginNode: e }), a += t;
				}
				d.push(i), m = a;
				continue;
			}
		}
		let a = e.match(/^(\s*)[*-]\s*$/);
		if (a && m === u.length - 1) {
			let e = a[1].replace(/\t/g, "  ").length;
			d.push({
				indent: e,
				text: "",
				taskStatus: void 0,
				remarkLines: [],
				placeholder: !0
			}), m++;
			continue;
		}
		if (f === null && d.length === 0) {
			let t = e.trim();
			if (t) {
				f = t;
				let e = m + 1;
				for (; e < u.length;) {
					let t = u[e].match(/^(\s*)>\s?(.*)$/);
					if (t) p.push(t[2]), e++;
					else break;
				}
				m = e;
				continue;
			}
		}
		m++;
	}
	if (d.length === 0 && f === null) return {
		id: "md-0",
		text: "Root"
	};
	let h = (e, t) => {
		t.dottedLine && (e = {
			...e,
			dottedLine: !0
		}), t.collapsed && (e = {
			...e,
			collapsed: !0
		});
		let n = t._pluginNode;
		return n && n.multiLineContent && (e = {
			...e,
			multiLineContent: n.multiLineContent
		}), s && c && (e = r(s, e, e.text, c)), e;
	};
	if (f !== null) {
		let e = {
			id: "md-0",
			text: f,
			children: [],
			...p.length > 0 ? { remark: p.join("\n") } : {}
		};
		if (s && c && (e = r(s, e, f, c)), d.length === 0) return delete e.children, e;
		let t = 2;
		for (let e of d) if (e.indent > 0) {
			t = e.indent;
			break;
		}
		let n = d.map((e) => ({
			level: e.indent > 0 ? Math.round(e.indent / t) : 0,
			text: e.text,
			taskStatus: e.taskStatus,
			remarkLines: e.remarkLines,
			_item: e
		})), a = [[e, -1]];
		for (let e = 0; e < n.length; e++) {
			let { level: t, text: r, taskStatus: i, remarkLines: o, _item: s } = n[e], c = {
				id: "md-tmp",
				text: r,
				...i ? { taskStatus: i } : {},
				...o.length > 0 ? { remark: o.join("\n") } : {},
				...s.placeholder ? { placeholder: !0 } : {}
			};
			for (; a.length > 1 && a[a.length - 1][1] >= t;) a.pop();
			let l = a[a.length - 1][0];
			l.children ||= [], c.id = `${l.id}-${l.children.length}`, c = h(c, s), l.children.push(c), a.push([c, t]);
		}
		if (x(e), s && c) {
			let [t] = i(s, [e], c);
			return t;
		}
		return e;
	}
	let g = 2;
	for (let e of d) if (e.indent > 0) {
		g = e.indent;
		break;
	}
	let _ = d.map((e) => ({
		level: e.indent > 0 ? Math.round(e.indent / g) : 0,
		text: e.text,
		taskStatus: e.taskStatus,
		remarkLines: e.remarkLines,
		_item: e
	})), v = {
		id: "md-0",
		text: _[0].text,
		children: [],
		listRoot: !0,
		..._[0].taskStatus ? { taskStatus: _[0].taskStatus } : {},
		..._[0].remarkLines.length > 0 ? { remark: _[0].remarkLines.join("\n") } : {}
	};
	v = h(v, _[0]._item);
	let b = [[v, 0]], S = Infinity;
	for (let e = 1; e < _.length; e++) _[e].level < S && (S = _[e].level);
	for (let e = 1; e < _.length; e++) {
		let { level: t, text: n, taskStatus: r, remarkLines: i, _item: a } = _[e], o = t - S + 1, s = {
			id: "md-tmp",
			text: n,
			...r ? { taskStatus: r } : {},
			...i.length > 0 ? { remark: i.join("\n") } : {},
			...a.placeholder ? { placeholder: !0 } : {}
		};
		for (; b.length > 1 && b[b.length - 1][1] >= o;) b.pop();
		let c = b[b.length - 1][0];
		c.children ||= [];
		let l = c.children.length;
		s.id = `${c.id}-${l}`, s = h(s, a), c.children.push(s), b.push([s, o]);
	}
	if (x(v), s && c) {
		let [e] = i(s, [v], c);
		return e;
	}
	return v;
}
function x(e) {
	if (e.children && e.children.length === 0) delete e.children;
	else if (e.children) for (let t of e.children) x(t);
}
function S(e, t = 0, n) {
	let r = n && n.length > 0 ? n : void 0, i;
	if (t === 0) {
		let t = e.text;
		r && (t = s(r, e, t)), i = (e.listRoot ? "- " : "") + t + "\n";
	} else {
		let n = "";
		e.taskStatus && (n = {
			todo: "[ ]",
			doing: "[-]",
			done: "[x]"
		}[e.taskStatus] + " ");
		let a = "- ";
		r && (a = o(r, e, a));
		let c = e.text;
		r && (c = s(r, e, c)), i = "  ".repeat(t - 1) + a + n + c + "\n";
	}
	if (e.remark) {
		let n = t === 0 ? "  " : "  ".repeat(t);
		for (let t of e.remark.split("\n")) i += n + "> " + t + "\n";
	}
	if (r) {
		let n = c(r, e, t), a = t === 0 ? "  " : "  ".repeat(t);
		for (let e of n) i += a + e + "\n";
	}
	if (e.children) for (let r of e.children) i += S(r, t + 1, n);
	return i;
}
function C(t, n) {
	let r = n && n.length > 0 ? n : void 0, a = t, o = r ? {
		lines: [],
		frontMatter: {}
	} : void 0;
	r && o && (a = e(r, a, o)), a = a.split("\n").filter((e) => e.trim().length > 0 && !/^\s*%%/.test(e)).join("\n");
	let s = a.split(/\n[ \t]*\n/).filter((e) => e.trim());
	if (s.length === 0) return [{
		id: "md-0",
		text: "Root"
	}];
	let c = r ? r.map((e) => ({
		...e,
		preParseMarkdown: void 0
	})) : void 0;
	if (s.length === 1) {
		let e = [b(a, c)];
		return r && o ? i(r, e, o) : e;
	}
	let l = s.map((e, t) => {
		let n = b(e, c);
		return w(n, `md-${t}`), n;
	});
	return r && o ? i(r, l, o) : l;
}
function w(e, t) {
	if (e.id = t, e.children) for (let n = 0; n < e.children.length; n++) w(e.children[n], `${t}-${n}`);
}
function T(e, t) {
	let n = t && t.length > 0 ? t : void 0, r = "";
	n && (r = a(n, e));
	let i = e.map((e) => S(e, 0, t)).join("\n");
	return r + i;
}
function E(t, n) {
	let r = {
		lines: [],
		frontMatter: {}
	}, a = e(n, t, r);
	a = a.split("\n").filter((e) => e.trim().length > 0 && !/^\s*%%/.test(e)).join("\n");
	let o = n.map((e) => ({
		...e,
		preParseMarkdown: void 0
	})), s = a.split(/\n[ \t]*\n/).filter((e) => e.trim());
	if (s.length === 0) return {
		roots: [{
			id: "md-0",
			text: "Root"
		}],
		frontMatter: r.frontMatter
	};
	let c;
	return c = s.length === 1 ? [b(a, o)] : s.map((e, t) => {
		let n = b(e, o);
		return w(n, `md-${t}`), n;
	}), c = i(n, c, r), {
		roots: c,
		frontMatter: r.frontMatter
	};
}
//#endregion
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/utils/input.js
function D(e) {
	return e === "left" || e === "right" || e === "both" ? e : void 0;
}
function O(e) {
	return e === "light" || e === "dark" || e === "auto" ? e : void 0;
}
function k(e, t) {
	if (t) {
		let { roots: n, frontMatter: r } = E(e, t);
		return {
			roots: n,
			direction: D(r.direction),
			theme: O(r.theme)
		};
	}
	return { roots: C(e) };
}
function A(e, t, n) {
	return e || t === void 0 ? null : k(t, n);
}
//#endregion
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/utils/tree-ops.js
function j() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function M(e) {
	return Array.isArray(e) ? e : [e];
}
function N(e, t, n) {
	if (e.id === t) {
		let t = {
			...e,
			...n
		};
		return "taskStatus" in n && n.taskStatus === void 0 && delete t.taskStatus, "remark" in n && n.remark === void 0 && delete t.remark, "collapsed" in n && n.collapsed === void 0 && delete t.collapsed, t;
	}
	return e.children ? {
		...e,
		children: e.children.map((e) => N(e, t, n))
	} : e;
}
function P(e, t, n) {
	return e.id === t ? {
		...e,
		children: [...e.children || [], n]
	} : e.children ? {
		...e,
		children: e.children.map((e) => P(e, t, n))
	} : e;
}
function F(e, t) {
	if (!e.children) return e;
	let n = e.children.filter((e) => e.id !== t).map((e) => F(e, t));
	return {
		...e,
		children: n.length > 0 ? n : void 0
	};
}
function I(e, t, n) {
	if (!e.children) return e;
	let r = e.children.findIndex((e) => e.id === t);
	if (r !== -1) {
		let t = [...e.children];
		return t.splice(r + 1, 0, n), {
			...e,
			children: t
		};
	}
	return {
		...e,
		children: e.children.map((e) => I(e, t, n))
	};
}
function L(e, t, n) {
	if (!e.children) return e;
	let r = e.children.findIndex((e) => e.id === t), i = e.children.findIndex((e) => e.id === n);
	if (r !== -1 && i !== -1) {
		let t = [...e.children];
		return [t[r], t[i]] = [t[i], t[r]], {
			...e,
			children: t
		};
	}
	return {
		...e,
		children: e.children.map((e) => L(e, t, n))
	};
}
function R(e, t) {
	if (e.id === t) return structuredClone(e);
	if (!e.children) return null;
	for (let n of e.children) {
		let e = R(n, t);
		if (e) return e;
	}
	return null;
}
function z(e) {
	return {
		...e,
		id: j(),
		children: e.children?.map((e) => z(e))
	};
}
function B(e, t) {
	let n = {};
	for (let e of t) e.parentId && (n[e.parentId] || (n[e.parentId] = []), n[e.parentId].push(e.id));
	let r = [], i = [e];
	for (; i.length > 0;) {
		let e = n[i.pop()];
		if (e) for (let t of e) r.push(t), i.push(t);
	}
	return r;
}
function V(e, t, n) {
	return e.map((e) => N(e, t, n));
}
function H(e, t, n) {
	return e.map((e) => P(e, t, n));
}
function U(e, t, n) {
	let r = e.findIndex((e) => e.id === t);
	if (r !== -1) {
		let t = [...e];
		return t.splice(r + 1, 0, n), t;
	}
	return e.map((e) => I(e, t, n));
}
function W(e, t) {
	let n = e.filter((e) => e.id !== t);
	return n.length < e.length ? n : e.map((e) => F(e, t));
}
function G(e, t, n) {
	return e.map((e) => L(e, t, n));
}
function K(e, t) {
	for (let n of e) {
		let e = R(n, t);
		if (e) return e;
	}
	return null;
}
function q(e, t, n, r) {
	let i = [...e.children || []], a = Math.min(r, i.length);
	return n === "right" ? (i.splice(a, 0, t), {
		data: {
			...e,
			children: i
		},
		newSplitIndex: a + 1
	}) : (i.push(t), {
		data: {
			...e,
			children: i
		},
		newSplitIndex: a
	});
}
function J(e, t, n, r) {
	let i = e.children || [], a = i.findIndex((e) => e.id === t);
	if (a === -1) return null;
	let o = Math.min(Math.max(r, 0), i.length);
	if (n === "right" && a < o || n === "left" && a >= o) return null;
	let s = [...i], [c] = s.splice(a, 1);
	return n === "left" ? (s.push(c), {
		data: {
			...e,
			children: s
		},
		newSplitIndex: o - 1
	}) : (s.splice(o, 0, c), {
		data: {
			...e,
			children: s
		},
		newSplitIndex: o + 1
	});
}
//#endregion
export { p as C, m as S, v as T, d as _, U as a, h as b, B as c, M as d, V as f, _ as g, T as h, j as i, G as l, k as m, z as n, q as o, A as p, H as r, K as s, J as t, W as u, f as v, u as w, l as x, g as y };
