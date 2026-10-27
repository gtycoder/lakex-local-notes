import { useEffect as e, useRef as t, useState as n } from "react";
import { Fragment as r, jsx as i, jsxs as a } from "react/jsx-runtime";
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/components/MindMapContextMenu.js
function o({ position: o, messages: s, readonly: c, nodeId: l, canPaste: u, onNewRootNode: d, onImport: f, onExportSVG: p, onExportPNG: m, onExportMarkdown: h, onDirectionChange: g, onAddChildNode: _, onEditNode: v, onDeleteNode: y, onCopyNode: b, onCutNode: x, onPasteNode: S, onClose: C }) {
	let w = t(null), [T, E] = n(!1), [D, O] = n(!1);
	function k(e, t) {
		e.key === "ArrowRight" || e.key === "Enter" || e.key === " " ? (e.preventDefault(), t(!0)) : (e.key === "ArrowLeft" || e.key === "Escape") && (e.preventDefault(), t(!1));
	}
	function A() {
		return Array.from(w.current?.querySelectorAll("[role=\"menuitem\"]") ?? []).filter((e) => !e.hasAttribute("disabled"));
	}
	function j(e) {
		if (e.key === "Escape") {
			e.preventDefault(), C();
			return;
		}
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		let t = A();
		if (t.length === 0) return;
		e.preventDefault();
		let n = t.indexOf(document.activeElement), r = e.key === "ArrowDown" ? 1 : -1;
		t[n < 0 ? 0 : (n + r + t.length) % t.length].focus();
	}
	return e(() => {
		(w.current?.querySelector("[role=\"menuitem\"]"))?.focus();
	}, []), /* @__PURE__ */ a("div", {
		ref: w,
		className: "mindmap-context-menu",
		style: {
			left: o.x,
			top: o.y
		},
		role: "menu",
		onClick: (e) => e.stopPropagation(),
		onKeyDown: j,
		children: [
			l ? /* @__PURE__ */ a(r, { children: [
				!c && /* @__PURE__ */ a(r, { children: [
					/* @__PURE__ */ i("button", {
						type: "button",
						className: "mindmap-ctx-item mindmap-ctx-add-child",
						role: "menuitem",
						onClick: (e) => {
							_?.(e), C();
						},
						children: s.addChild
					}),
					/* @__PURE__ */ i("button", {
						type: "button",
						className: "mindmap-ctx-item mindmap-ctx-edit",
						role: "menuitem",
						onClick: () => {
							v?.(), C();
						},
						children: s.editNode
					}),
					/* @__PURE__ */ i("div", {
						className: "mindmap-ctx-divider",
						role: "separator"
					})
				] }),
				/* @__PURE__ */ i("button", {
					type: "button",
					className: "mindmap-ctx-item mindmap-ctx-copy",
					role: "menuitem",
					onClick: () => {
						b?.(), C();
					},
					children: s.copy
				}),
				!c && /* @__PURE__ */ a(r, { children: [
					/* @__PURE__ */ i("button", {
						type: "button",
						className: "mindmap-ctx-item mindmap-ctx-cut",
						role: "menuitem",
						onClick: () => {
							x?.(), C();
						},
						children: s.cut
					}),
					/* @__PURE__ */ i("button", {
						type: "button",
						className: "mindmap-ctx-item mindmap-ctx-paste",
						role: "menuitem",
						disabled: !u,
						onClick: () => {
							S?.(), C();
						},
						children: s.paste
					}),
					/* @__PURE__ */ i("div", {
						className: "mindmap-ctx-divider",
						role: "separator"
					}),
					/* @__PURE__ */ i("button", {
						type: "button",
						className: "mindmap-ctx-item mindmap-ctx-delete",
						role: "menuitem",
						onClick: () => {
							y?.(), C();
						},
						children: s.deleteNode
					})
				] }),
				/* @__PURE__ */ i("div", {
					className: "mindmap-ctx-divider",
					role: "separator"
				})
			] }) : !c && /* @__PURE__ */ a(r, { children: [
				/* @__PURE__ */ i("button", {
					type: "button",
					className: "mindmap-ctx-item mindmap-ctx-new-root",
					role: "menuitem",
					onClick: d,
					children: s.newRootNode
				}),
				/* @__PURE__ */ i("button", {
					type: "button",
					className: "mindmap-ctx-item mindmap-ctx-import",
					role: "menuitem",
					onClick: f,
					children: s.import
				}),
				/* @__PURE__ */ i("div", {
					className: "mindmap-ctx-divider",
					role: "separator"
				})
			] }),
			/* @__PURE__ */ a("div", {
				className: "mindmap-ctx-submenu-host",
				onMouseEnter: () => O(!0),
				onMouseLeave: () => O(!1),
				children: [/* @__PURE__ */ a("button", {
					type: "button",
					className: "mindmap-ctx-item mindmap-ctx-has-sub mindmap-ctx-layout",
					role: "menuitem",
					"aria-haspopup": "menu",
					"aria-expanded": D,
					onClick: () => O((e) => !e),
					onKeyDown: (e) => k(e, O),
					children: [s.layout, /* @__PURE__ */ i("span", {
						className: "mindmap-ctx-arrow",
						children: "▶"
					})]
				}), D && /* @__PURE__ */ a("div", {
					className: "mindmap-ctx-submenu",
					role: "menu",
					children: [
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-layout-left",
							role: "menuitem",
							onClick: () => {
								g("left"), C();
							},
							children: s.layoutLeft
						}),
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-layout-both",
							role: "menuitem",
							onClick: () => {
								g("both"), C();
							},
							children: s.layoutBoth
						}),
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-layout-right",
							role: "menuitem",
							onClick: () => {
								g("right"), C();
							},
							children: s.layoutRight
						})
					]
				})]
			}),
			/* @__PURE__ */ i("div", {
				className: "mindmap-ctx-divider",
				role: "separator"
			}),
			/* @__PURE__ */ a("div", {
				className: "mindmap-ctx-submenu-host",
				onMouseEnter: () => E(!0),
				onMouseLeave: () => E(!1),
				children: [/* @__PURE__ */ a("button", {
					type: "button",
					className: "mindmap-ctx-item mindmap-ctx-has-sub mindmap-ctx-export",
					role: "menuitem",
					"aria-haspopup": "menu",
					"aria-expanded": T,
					onClick: () => E((e) => !e),
					onKeyDown: (e) => k(e, E),
					children: [s.export, /* @__PURE__ */ i("span", {
						className: "mindmap-ctx-arrow",
						children: "▶"
					})]
				}), T && /* @__PURE__ */ a("div", {
					className: "mindmap-ctx-submenu",
					role: "menu",
					children: [
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-export-svg",
							role: "menuitem",
							onClick: p,
							children: s.exportSVG
						}),
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-export-png",
							role: "menuitem",
							onClick: m,
							children: s.exportPNG
						}),
						/* @__PURE__ */ i("button", {
							type: "button",
							className: "mindmap-ctx-item mindmap-ctx-export-md",
							role: "menuitem",
							onClick: h,
							children: s.exportMarkdown
						})
					]
				})]
			})
		]
	});
}
//#endregion
export { o as MindMapContextMenu };
