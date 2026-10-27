import { d as e, m as t } from "./tree-ops-CMYWEuJm.js";
import { a as n } from "./icons-Cp9Z20_6.js";
import { useMemo as r, useRef as i, useState as a } from "react";
import { jsx as o, jsxs as s } from "react/jsx-runtime";
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/utils/import.js
function c(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function l(e) {
	return !(!c(e) || typeof e.id != "string" || typeof e.text != "string" || "children" in e && e.children !== void 0 && (!Array.isArray(e.children) || !e.children.every(l)));
}
function u(t) {
	return Array.isArray(t) ? t.length > 0 && t.every(l) ? t : null : l(t) ? e(t) : null;
}
function d(e, n, r) {
	let i = e.trim();
	if (!i) return {
		ok: !1,
		reason: "empty"
	};
	if (n === "json" || n === "auto" && (i.startsWith("{") || i.startsWith("["))) try {
		let e = u(JSON.parse(i));
		return e ? {
			ok: !0,
			source: "json",
			data: e
		} : {
			ok: !1,
			reason: "invalid-data"
		};
	} catch {
		return {
			ok: !1,
			reason: "invalid-json"
		};
	}
	let a = t(i, r);
	return {
		ok: !0,
		source: "markdown",
		data: a.roots,
		direction: a.direction,
		theme: a.theme
	};
}
//#endregion
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/components/MindMapImportDialog.js
var f = [
	"auto",
	"markdown",
	"json"
], p = [
	"button:not([disabled])",
	"textarea:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"a[href]",
	"[tabindex]:not([tabindex=\"-1\"])"
].join(",");
function m(e, t) {
	return e === "auto" ? t.importAuto : e === "markdown" ? t.importMarkdown : t.importJSON;
}
function h({ messages: e, plugins: t, onImport: c, onClose: l }) {
	let [u, h] = a("auto"), [g, _] = a(""), [v, y] = a(null), b = i(null), x = "mindmap-import-panel", S = r(() => v ? v === "empty" ? e.importEmpty : v === "invalid-json" ? e.importInvalidJSON : e.importInvalidData : null, [v, e]);
	function C() {
		let e = d(g, u, t);
		if (!e.ok) {
			y(e.reason);
			return;
		}
		c(e.data, e.source, {
			direction: e.direction,
			theme: e.theme
		});
	}
	function w(e) {
		h(e), y(null);
	}
	function T(e) {
		let t = f.indexOf(u), n = t;
		if (e.key === "ArrowRight") n = (t + 1) % f.length;
		else if (e.key === "ArrowLeft") n = (t - 1 + f.length) % f.length;
		else if (e.key === "Home") n = 0;
		else if (e.key === "End") n = f.length - 1;
		else return;
		e.preventDefault();
		let r = f[n];
		w(r), (e.currentTarget.parentElement?.querySelectorAll("[role=\"tab\"]"))?.[n]?.focus();
	}
	function E() {
		return Array.from(b.current?.querySelectorAll(p) ?? []).filter((e) => e.offsetParent !== null);
	}
	function D(e) {
		if (e.key === "Escape") {
			e.preventDefault(), l();
			return;
		}
		if (e.key !== "Tab") return;
		let t = E();
		if (t.length === 0) return;
		let n = t[0], r = t[t.length - 1], i = document.activeElement;
		e.shiftKey && i === n ? (e.preventDefault(), r.focus()) : !e.shiftKey && i === r && (e.preventDefault(), n.focus());
	}
	return /* @__PURE__ */ o("div", {
		className: "mindmap-dialog-backdrop",
		role: "presentation",
		onMouseDown: l,
		children: /* @__PURE__ */ s("div", {
			ref: b,
			className: "mindmap-dialog-modal mindmap-import-dialog",
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "mindmap-import-title",
			onMouseDown: (e) => e.stopPropagation(),
			onKeyDown: D,
			children: [
				/* @__PURE__ */ s("div", {
					className: "mindmap-dialog-header",
					children: [/* @__PURE__ */ o("h2", {
						id: "mindmap-import-title",
						className: "mindmap-dialog-title",
						children: e.import
					}), /* @__PURE__ */ o("button", {
						className: "mindmap-dialog-close",
						type: "button",
						"aria-label": e.close,
						onClick: l,
						children: /* @__PURE__ */ o(n, { size: 16 })
					})]
				}),
				/* @__PURE__ */ o("div", {
					className: "mindmap-import-segmented",
					role: "tablist",
					"aria-label": e.import,
					children: f.map((t) => {
						let n = u === t;
						return /* @__PURE__ */ o("button", {
							id: `mindmap-import-tab-${t}`,
							type: "button",
							role: "tab",
							"aria-selected": n,
							"aria-controls": x,
							tabIndex: n ? 0 : -1,
							className: n ? "is-active" : "",
							onClick: () => w(t),
							onKeyDown: T,
							children: m(t, e)
						}, t);
					})
				}),
				/* @__PURE__ */ s("div", {
					id: x,
					role: "tabpanel",
					"aria-labelledby": `mindmap-import-tab-${u}`,
					children: [/* @__PURE__ */ o("textarea", {
						className: "mindmap-import-textarea",
						value: g,
						placeholder: e.importPlaceholder,
						"aria-label": e.importPlaceholder,
						"aria-invalid": v ? !0 : void 0,
						"aria-describedby": S ? "mindmap-import-error" : void 0,
						onChange: (e) => {
							_(e.target.value), y(null);
						},
						onKeyDown: (e) => {
							(e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.preventDefault(), C());
						},
						autoFocus: !0
					}), S && /* @__PURE__ */ o("div", {
						id: "mindmap-import-error",
						className: "mindmap-import-error",
						role: "alert",
						children: S
					})]
				}),
				/* @__PURE__ */ s("div", {
					className: "mindmap-dialog-actions",
					children: [/* @__PURE__ */ o("button", {
						type: "button",
						className: "mindmap-dialog-secondary",
						onClick: l,
						children: e.cancel
					}), /* @__PURE__ */ o("button", {
						type: "button",
						className: "mindmap-dialog-primary",
						onClick: C,
						children: e.importConfirm
					})]
				})
			]
		})
	});
}
//#endregion
export { h as MindMapImportDialog };
