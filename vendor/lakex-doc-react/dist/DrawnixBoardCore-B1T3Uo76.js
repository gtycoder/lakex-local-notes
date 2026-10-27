import e from "react";
import { createPortal as t } from "react-dom";
import { Fragment as n, jsx as r, jsxs as i } from "react/jsx-runtime";
import { Drawnix as a, saveAsPng as o, saveAsSvg as s } from "lakex-drawnix";
import { BoardTransforms as c, PlaitBoard as l, PlaitHistoryBoard as u, PlaitPointerType as d, ThemeColorMode as f, Transforms as p, WritableClipboardOperationType as m, addSelectedElement as h, clearSelectedElement as g, deleteTemporaryElements as ee, duplicateElements as _, getBoundingRectangleByElements as v, getHitElementByPoint as y, getRectangleByElements as b, getSelectedElements as x, getViewportOrigination as S, toImage as C } from "@plait/core";
import { Alignment as w, BoardCreationMode as T, StrokeStyle as E, buildText as D, getTextEditorsByElement as O, getTextManages as te, setCreationMode as k } from "@plait/common";
import { ArrowLineMarkerType as A, ArrowLineShape as j, BasicShapes as M, DrawTransforms as N, FlowchartSymbols as P, PlaitDrawElement as F, UMLSymbols as I, createArrowLineElement as L, createDefaultGeometry as R, createGeometryElement as ne, memorizeLatestShape as re, setAutoCompleteCommitHost as ie } from "@plait/draw";
import { MindTransforms as z, createEmptyMind as B, createMindElement as ae, getDefaultFontSizeForMindElement as oe } from "@plait/mind";
import { PlaitMarkEditor as se, TextTransforms as ce } from "@plait/text-plugins";
//#region src/cards/DrawingBoard/LakexShapeCatalog.tsx
var V = (e, t, n) => ({
	pointer: e,
	zh: t,
	en: n
}), H = [
	{
		key: "basic",
		zh: "基础图形",
		en: "Basic",
		shapes: [
			V(M.rectangle, "矩形", "Rectangle"),
			V(M.roundRectangle, "圆角矩形", "Rounded rectangle"),
			V(M.ellipse, "圆形", "Ellipse"),
			V(M.triangle, "三角形", "Triangle"),
			V(M.diamond, "菱形", "Diamond"),
			V(M.parallelogram, "平行四边形", "Parallelogram"),
			V(M.trapezoid, "梯形", "Trapezoid"),
			V(M.cross, "十字", "Cross"),
			V(M.pentagon, "五边形", "Pentagon"),
			V(M.hexagon, "六边形", "Hexagon"),
			V(M.octagon, "八边形", "Octagon"),
			V(M.star, "星形", "Star"),
			V(M.leftArrow, "左箭头", "Left arrow"),
			V(M.rightArrow, "右箭头", "Right arrow"),
			V(M.twoWayArrow, "双向箭头", "Two-way arrow"),
			V(M.comment, "标注", "Callout"),
			V(M.roundComment, "圆角标注", "Rounded callout"),
			V(M.cloud, "云形", "Cloud")
		]
	},
	{
		key: "flowchart",
		zh: "流程图",
		en: "Flowchart",
		shapes: [
			V(P.process, "流程", "Process"),
			V(P.terminal, "开始/结束", "Start / End"),
			V(P.decision, "判断", "Decision"),
			V(P.data, "数据", "Data"),
			V(P.connector, "连接符", "Connector"),
			V(P.manualInput, "手动输入", "Manual input"),
			V(P.preparation, "准备", "Preparation"),
			V(P.predefinedProcess, "子流程", "Subprocess"),
			V(P.document, "文档", "Document"),
			V(P.multiDocument, "多文档", "Multiple documents"),
			V(P.database, "数据库", "Database"),
			V(P.internalStorage, "内部存储", "Internal storage"),
			V(P.delay, "延迟", "Delay"),
			V(P.display, "显示", "Display"),
			V(P.offPage, "页外连接", "Off-page connector"),
			V(P.noteSquare, "注释", "Note")
		]
	},
	{
		key: "smart",
		zh: "Smart",
		en: "Smart",
		shapes: [
			V(I.actor, "角色", "Actor"),
			V(I.useCase, "用例", "Use case"),
			V(I.component, "组件", "Component"),
			V(I.container, "容器", "Container"),
			V(I.note, "便签", "Note"),
			V(I.package, "包", "Package")
		]
	},
	{
		key: "uml",
		zh: "UML",
		en: "UML",
		shapes: [
			V(I.simpleClass, "简单类", "Simple class"),
			V(I.class, "类", "Class"),
			V(I.interface, "接口", "Interface"),
			V(I.object, "对象", "Object"),
			V(I.componentBox, "组件框", "Component box"),
			V(I.activityClass, "活动", "Activity"),
			V(I.branchMerge, "分支/合并", "Branch / Merge"),
			V(I.port, "端口", "Port"),
			V(I.combinedFragment, "组合片段", "Combined fragment"),
			V(I.template, "模板", "Template"),
			V(I.activation, "激活", "Activation"),
			V(I.deletion, "销毁", "Deletion")
		]
	},
	{
		key: "er",
		zh: "ER",
		en: "ER",
		shapes: [
			V(M.rectangle, "实体", "Entity"),
			V(M.roundRectangle, "弱实体", "Weak entity"),
			V(M.diamond, "关系", "Relationship"),
			V(M.ellipse, "属性", "Attribute"),
			V(M.parallelogram, "关联实体", "Associative entity"),
			V(I.class, "实体明细", "Entity details")
		]
	}
];
function le({ pointer: e }) {
	switch (String(e)) {
		case M.rectangle: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case M.roundRectangle: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16",
				rx: "3"
			})
		});
		case M.ellipse: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "16",
				rx: "9",
				ry: "9"
			})
		});
		case M.triangle: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 8L25 24L7 24Z" })
		});
		case M.diamond: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case M.parallelogram: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 9L27 9L21 23L5 23Z" })
		});
		case M.trapezoid: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M9 10L23 10L26 22L6 22Z" })
		});
		case M.cross: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M18.8 7C19.5 7 20.1 7.5 20.1 8.2V11.9H23.8C24.5 11.9 25 12.4 25 13.1V18.9C25 19.6 24.5 20.1 23.8 20.1H20.1V23.8C20.1 24.5 19.5 25 18.8 25H13.1C12.4 25 11.9 24.5 11.9 23.8V20.1H8.2C7.5 20.1 7 19.6 7 18.9V13.1C7 12.4 7.5 11.9 8.2 11.9H11.9V8.2C11.9 7.5 12.4 7 13.1 7Z" })
		});
		case M.pentagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25.1 13.6L21.6 24.4H10.4L6.9 13.6Z" })
		});
		case M.hexagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 8H21L26 16L21 24H11L6 16Z" })
		});
		case M.octagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 7H21L25 11V21L21 25H11L7 21V11Z" })
		});
		case M.star: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 6L18.5 12.5L25.5 13L20 17.5L21.8 24.5L16 20.5L10.2 24.5L12 17.5L6.5 13L13.5 12.5Z" })
		});
		case M.leftArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 16L16 7V12H25V20H16V25Z" })
		});
		case M.rightArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M25 16L16 25V20H7V12H16V7Z" })
		});
		case M.twoWayArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 16L13 10V14H19V10L25 16L19 22V18H13V22Z" })
		});
		case M.comment: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 8H26V19H14L9 24V19H6Z" })
		});
		case M.roundComment: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 12C6 9.8 7.8 8 10 8H22C24.2 8 26 9.8 26 12V17C26 19.2 24.2 21 22 21H14L9 25V21H10C7.8 21 6 19.2 6 17Z" })
		});
		case M.cloud: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M9 22C6.8 22 5 20.2 5 18C5 16.1 6.3 14.5 8.1 14.1C8 13.8 8 13.4 8 13C8 10.2 10.2 8 13 8C14.5 8 15.8 8.7 16.7 9.7C17.6 8.6 19 8 20.5 8C23.5 8 26 10.5 26 13.5C26 13.7 26 13.8 26 14C27.7 14.5 29 16.1 29 18C29 20.2 27.2 22 25 22Z" })
		});
		case P.process: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case P.terminal: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "9",
				width: "20",
				height: "14",
				rx: "7"
			})
		});
		case P.decision: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case P.data: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 9L27 9L21 23L5 23Z" })
		});
		case P.connector: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("circle", {
				cx: "16",
				cy: "16",
				r: "8"
			})
		});
		case P.manualInput: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 12L26 8L26 24H6Z" })
		});
		case P.preparation: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M10 8H22L27 16L22 24H10L5 16Z" })
		});
		case P.predefinedProcess: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "7",
				y: "8",
				width: "18",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M10 8V24M22 8V24" })]
		});
		case P.document: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 8H25V20C25 20 22 24 16 20C10 16 7 24 7 24Z" })
		});
		case P.multiDocument: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("path", { d: "M9 10H25V20C25 20 22 24 17 20V22C17 22 14 26 9 22Z" }), /* @__PURE__ */ r("path", { d: "M7 6H23V10H9V18C7 18 7 16.5 7 16.5Z" })]
		});
		case P.database: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "9",
				rx: "9",
				ry: "3.5"
			}), /* @__PURE__ */ r("path", { d: "M7 9V23C7 25 11 26.5 16 26.5S25 25 25 23V9M7 16C7 18 11 19.5 16 19.5S25 18 25 16" })]
		});
		case P.internalStorage: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "7",
				y: "8",
				width: "18",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M7 10H25M9 8V24" })]
		});
		case P.delay: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 8H21A5 8 0 0 1 21 24H6Z" })
		});
		case P.display: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M8 8H26A3 8 0 0 1 26 24H8L4 16Z" })
		});
		case P.offPage: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 8H25V18L16 25L7 18Z" })
		});
		case P.noteSquare: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M12 8H8V24H12" })
		});
		case I.actor: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("circle", {
				cx: "16",
				cy: "6",
				r: "3"
			}), /* @__PURE__ */ r("path", { d: "M16 9V18M9 13H23M16 18L10 27M16 18L22 27" })]
		});
		case I.useCase: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "16",
				rx: "11",
				ry: "8"
			})
		});
		case I.component: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [
				/* @__PURE__ */ r("rect", {
					x: "6",
					y: "8",
					width: "20",
					height: "16"
				}),
				/* @__PURE__ */ r("rect", {
					x: "4",
					y: "12",
					width: "5",
					height: "3",
					rx: "1"
				}),
				/* @__PURE__ */ r("rect", {
					x: "4",
					y: "18",
					width: "5",
					height: "3",
					rx: "1"
				})
			]
		});
		case I.container: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "4",
				y: "8",
				width: "24",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M11 8V24" })]
		});
		case I.note: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("path", { d: "M6 6H20L26 12V26H6ZM20 6V12H26" }), /* @__PURE__ */ r("path", { d: "M10 16H22M10 21H18" })]
		});
		case I.package: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M4 10H14L17 13H28V26H4ZM4 10V6H14L17 10" })
		});
		case I.simpleClass: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			})
		});
		case I.class: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "5",
				width: "20",
				height: "22"
			}), /* @__PURE__ */ r("path", { d: "M6 11H26M6 18H26" })]
		});
		case I.interface: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			}), /* @__PURE__ */ r("path", { d: "M6 13H26" })]
		});
		case I.object: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			})
		});
		case I.componentBox: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [
				/* @__PURE__ */ r("rect", {
					x: "4",
					y: "8",
					width: "24",
					height: "16"
				}),
				/* @__PURE__ */ r("rect", {
					x: "21",
					y: "9",
					width: "6",
					height: "7"
				}),
				/* @__PURE__ */ r("rect", {
					x: "19",
					y: "10",
					width: "2",
					height: "1.5"
				}),
				/* @__PURE__ */ r("rect", {
					x: "19",
					y: "13",
					width: "2",
					height: "1.5"
				})
			]
		});
		case I.activityClass: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			}), /* @__PURE__ */ r("path", { d: "M8.5 6V26M23.5 6V26" })]
		});
		case I.branchMerge: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case I.port: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case I.combinedFragment: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [
				/* @__PURE__ */ r("rect", {
					x: "6",
					y: "6",
					width: "20",
					height: "20"
				}),
				/* @__PURE__ */ r("path", { d: "M6 6L6 12L12 6Z" }),
				/* @__PURE__ */ r("path", { d: "M7 11V7H11" })
			]
		});
		case I.template: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20",
				rx: "3",
				strokeDasharray: "3 2"
			})
		});
		case I.activation: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "12",
				y: "6",
				width: "8",
				height: "20"
			})
		});
		case I.deletion: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M9 9L23 23M23 9L9 23" })
		});
		default: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
	}
}
function ue({ board: t, locale: n, open: a, onClose: o }) {
	let [s, l] = e.useState("basic"), u = e.useRef(null), d = e.useRef({}), f = e.useRef(null), p = n === "zh-CN";
	return a ? /* @__PURE__ */ i("section", {
		className: "lakex-shape-catalog",
		"data-lakex-shape-catalog": !0,
		"aria-label": p ? "图形库" : "Shape library",
		children: [/* @__PURE__ */ r("div", {
			className: "lakex-shape-catalog__tabs",
			role: "tablist",
			children: H.map((e) => /* @__PURE__ */ r("button", {
				type: "button",
				role: "tab",
				"aria-selected": e.key === s,
				className: "lakex-shape-catalog__tab",
				onClick: () => {
					let t = u.current, n = d.current[e.key];
					t && n && (f.current = e.key, l(e.key), t.scrollTo({
						top: n.offsetTop,
						behavior: "smooth"
					}), window.setTimeout(() => {
						f.current = null;
					}, 400));
				},
				children: p ? e.zh : e.en
			}, e.key))
		}), /* @__PURE__ */ r("div", {
			ref: u,
			className: "lakex-shape-catalog__body",
			onScroll: (e) => {
				if (f.current) return;
				let t = e.currentTarget;
				if (t.scrollTop + t.clientHeight >= t.scrollHeight - 2) {
					l(H[H.length - 1].key);
					return;
				}
				let n = t.scrollTop + Math.min(t.clientHeight * .28, 128), r = H[0].key;
				for (let e of H) {
					let t = d.current[e.key];
					t && t.offsetTop <= n && (r = e.key);
				}
				l(r);
			},
			children: H.map((e) => /* @__PURE__ */ i("section", {
				ref: (t) => {
					d.current[e.key] = t;
				},
				className: "lakex-shape-catalog__section",
				"data-shape-category": e.key,
				"aria-labelledby": `lakex-shape-category-${e.key}`,
				children: [/* @__PURE__ */ r("div", {
					id: `lakex-shape-category-${e.key}`,
					className: "lakex-shape-catalog__title",
					children: p ? e.zh : e.en
				}), /* @__PURE__ */ r("div", {
					className: "lakex-shape-catalog__grid",
					children: e.shapes.map((e, n) => {
						let i = p ? e.zh : e.en;
						return /* @__PURE__ */ r("button", {
							type: "button",
							className: "lakex-shape-catalog__shape",
							title: i,
							"aria-label": i,
							onClick: () => {
								t && (k(t, T.drawing), c.updatePointerType(t, e.pointer), o());
							},
							children: /* @__PURE__ */ r(le, { pointer: e.pointer })
						}, `${e.pointer}-${n}`);
					})
				})]
			}, e.key))
		})]
	}) : null;
}
//#endregion
//#region src/cards/DrawingBoard/LakexExportMenu.tsx
var de = () => /* @__PURE__ */ r("svg", {
	viewBox: "0 0 24 24",
	"aria-hidden": "true",
	children: /* @__PURE__ */ r("path", { d: "M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" })
});
function fe({ board: n, locale: a, toolbarHost: c }) {
	let [l, u] = e.useState(!1), d = a === "zh-CN" ? {
		export: "导出",
		svg: "导出 SVG",
		png: "导出 PNG"
	} : {
		export: "Export",
		svg: "Export SVG",
		png: "Export PNG"
	}, f = (e) => {
		n && (u(!1), e(n));
	};
	return c ? t(/* @__PURE__ */ i("div", {
		className: "lakex-drawnix-export",
		"data-lakex-export-menu": !0,
		children: [/* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-drawnix-export__trigger",
			title: d.export,
			"aria-label": d.export,
			"aria-expanded": l,
			onPointerDown: (e) => e.stopPropagation(),
			onClick: () => u((e) => !e),
			children: /* @__PURE__ */ r(de, {})
		}), l && /* @__PURE__ */ i("div", {
			className: "lakex-drawnix-export__menu",
			role: "menu",
			children: [/* @__PURE__ */ r("button", {
				type: "button",
				role: "menuitem",
				onClick: () => f(s),
				children: d.svg
			}), /* @__PURE__ */ r("button", {
				type: "button",
				role: "menuitem",
				onClick: () => f(o),
				children: d.png
			})]
		})]
	}), c) : null;
}
//#endregion
//#region src/cards/DrawingBoard/materialTemplates.ts
var pe = {
	blue: {
		fill: "#E8F1FF",
		stroke: "#5B8FF9"
	},
	indigo: {
		fill: "#EEF0FF",
		stroke: "#6C7BD9"
	},
	green: {
		fill: "#EAF8F0",
		stroke: "#5BB98C"
	},
	yellow: {
		fill: "#FFF6D9",
		stroke: "#D9A441"
	},
	orange: {
		fill: "#FFF0E6",
		stroke: "#E58B50"
	},
	purple: {
		fill: "#F3EBFF",
		stroke: "#9B71D1"
	},
	cyan: {
		fill: "#E7F8F7",
		stroke: "#4FB6B2"
	},
	gray: {
		fill: "#F3F4F6",
		stroke: "#8B95A5"
	}
}, U = (e, t, n, r, i, a, o = "blue", s = "13") => ne(e, [[t, n], [t + r, n + i]], a, {
	fill: pe[o].fill,
	strokeColor: pe[o].stroke,
	strokeWidth: 1.5
}, {
	"font-size": s,
	color: "#273142"
}), W = (e, t, n = "#697586", r = A.arrow) => L(j.straight, [e, t], { marker: A.none }, { marker: r }, void 0, {
	strokeColor: n,
	strokeWidth: 1.5
}), me = (e, t, n, r) => ne(M.text, [[e, t], [e + n, t + 26]], r, void 0, {
	"font-size": "14",
	color: "#273142"
}), G = (e, t, n) => e === "zh-CN" ? t : n, he = [
	{
		id: "product-milestones",
		categories: ["product"],
		zh: "产品里程碑",
		en: "Product milestones",
		sourceId: 18061212,
		docletId: 48173073,
		descriptionZh: "用于跟踪产品或项目开发的关键里程碑。",
		descriptionEn: "Track key milestones in product or project development.",
		usageCount: 23293,
		cover: "https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*KA8xSYmgiYgAAAAAAAAAAAAADvuFAQ/original",
		build: (e) => {
			let t = [
				G(e, "需求调研", "Research"),
				G(e, "方案设计", "Design"),
				G(e, "灰度发布", "Beta"),
				G(e, "正式发布", "Launch")
			], n = [
				"blue",
				"purple",
				"orange",
				"green"
			], r = [me(-250, -120, 200, G(e, "产品里程碑", "Product milestones")), W([-210, 10], [245, 10], "#94A3B8", A.arrow)];
			return t.forEach((e, t) => {
				let i = -230 + t * 145;
				r.push(U(M.ellipse, i, -12, 44, 44, "", n[t]), U(M.roundRectangle, i - 35, 62, 114, 48, e, n[t], "12"), W([i + 22, 32], [i + 22, 62], "#94A3B8", A.none));
			}), r;
		}
	},
	{
		id: "tech-architecture",
		categories: ["technology"],
		zh: "技术架构图",
		en: "Technical architecture",
		build: (e) => {
			let t = [
				[
					G(e, "访问层", "Client"),
					[
						"Web",
						"Mobile",
						"API"
					],
					"blue"
				],
				[
					G(e, "服务层", "Services"),
					[
						G(e, "用户服务", "User"),
						G(e, "业务服务", "Business"),
						G(e, "消息服务", "Message")
					],
					"purple"
				],
				[
					G(e, "数据层", "Data"),
					[
						"MySQL",
						"Redis",
						"Object Storage"
					],
					"green"
				]
			], n = [];
			return t.forEach(([e, r, i], a) => {
				let o = -170 + a * 135;
				n.push(me(-280, o + 20, 90, e)), r.forEach((e, r) => {
					let s = -155 + r * 150;
					n.push(U(M.roundRectangle, s, o, 120, 54, e, i, "11")), a < t.length - 1 && n.push(W([s + 60, o + 54], [s + 60, o + 81], "#8993A4"));
				});
			}), n;
		}
	},
	{
		id: "api-request-flow",
		categories: ["hot", "technology"],
		zh: "API 请求链路",
		en: "API request flow",
		build: (e) => {
			let t = [
				G(e, "客户端", "Client"),
				"API Gateway",
				G(e, "鉴权服务", "Auth"),
				G(e, "业务服务", "Service"),
				"Database"
			], n = [
				"blue",
				"indigo",
				"purple",
				"cyan",
				"green"
			], r = [];
			return t.forEach((e, i) => {
				let a = -340 + i * 170;
				r.push(U(M.roundRectangle, a, -30, 125, 60, e, n[i], "11")), i < t.length - 1 && r.push(W([a + 125, 0], [a + 170, 0]));
			}), r;
		}
	},
	{
		id: "cicd-pipeline",
		categories: ["hot", "technology"],
		zh: "CI/CD 发布流水线",
		en: "CI/CD pipeline",
		build: (e) => {
			let t = [
				G(e, "提交代码", "Commit"),
				G(e, "构建镜像", "Build"),
				G(e, "自动化测试", "Test"),
				G(e, "部署发布", "Deploy")
			], n = [
				"blue",
				"purple",
				"orange",
				"green"
			], r = [me(-300, -110, 240, G(e, "CI/CD 发布流水线", "CI/CD pipeline"))];
			return t.forEach((e, i) => {
				let a = -290 + i * 195;
				r.push(U(P.process, a, -15, 145, 60, e, n[i], "11")), i < t.length - 1 && r.push(W([a + 145, 15], [a + 195, 15]));
			}), r;
		}
	},
	{
		id: "database-er-model",
		categories: ["hot", "technology"],
		zh: "数据库 ER 图",
		en: "Database ER diagram",
		build: (e) => {
			let t = G(e, "用户\nid\nname", "User\nid\nname"), n = G(e, "订单\nid\nuser_id", "Order\nid\nuser_id"), r = G(e, "订单明细\nid\norder_id", "Order item\nid\norder_id");
			return [
				U(M.rectangle, -300, -54, 130, 108, t, "blue", "11"),
				U(M.rectangle, -65, -54, 130, 108, n, "purple", "11"),
				U(M.rectangle, 170, -54, 130, 108, r, "green", "11"),
				W([-170, 0], [-65, 0], "#7A8699", A.none),
				W([65, 0], [170, 0], "#7A8699", A.none)
			];
		}
	},
	{
		id: "frontend-module-map",
		categories: ["hot", "technology"],
		zh: "前端模块架构",
		en: "Frontend module map",
		build: (e) => {
			let t = G(e, "Web 应用", "Web app"), n = [
				G(e, "路由", "Router"),
				G(e, "页面模块", "Pages"),
				G(e, "状态管理", "State"),
				G(e, "组件库", "UI kit")
			], r = [
				"blue",
				"purple",
				"cyan",
				"green"
			], i = [U(M.roundRectangle, -75, -155, 150, 56, t, "indigo")];
			return n.forEach((e, t) => {
				let n = -300 + t * 165;
				i.push(U(M.roundRectangle, n, 20, 130, 52, e, r[t], "11"), W([0, -99], [n + 65, 20]));
			}), i;
		}
	},
	{
		id: "production-troubleshooting",
		categories: ["technology"],
		zh: "线上故障排查",
		en: "Production troubleshooting",
		build: (e) => {
			let t = G(e, "告警", "Alert"), n = [
				G(e, "服务状态", "Service health"),
				G(e, "日志与指标", "Logs & metrics"),
				G(e, "依赖服务", "Dependencies")
			], r = [
				U(P.terminal, -70, -155, 140, 52, t, "orange"),
				U(P.decision, -75, -55, 150, 82, G(e, "是否可复现？", "Reproducible?"), "yellow", "11"),
				W([0, -103], [0, -55])
			];
			return n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(U(M.roundRectangle, n, 100, 140, 50, e, [
					"blue",
					"purple",
					"green"
				][t], "11"), W([0, 27], [n + 70, 100]));
			}), r;
		}
	},
	{
		id: "idea-map",
		categories: ["thinking", "product"],
		zh: "产品创意图",
		en: "Product idea map",
		build: (e) => {
			let t = G(e, "产品创意", "Product idea"), n = [
				[
					-245,
					-140,
					G(e, "用户", "Users"),
					"blue"
				],
				[
					110,
					-140,
					G(e, "场景", "Scenarios"),
					"purple"
				],
				[
					-245,
					100,
					G(e, "价值", "Value"),
					"green"
				],
				[
					110,
					100,
					G(e, "风险", "Risks"),
					"orange"
				]
			], r = [U(M.ellipse, -72, -42, 144, 84, t, "yellow")];
			return n.forEach(([e, t, n, i]) => {
				r.push(U(M.roundRectangle, e, t, 135, 54, n, i), W([e < 0 ? e + 135 : e, t < 0 ? t + 54 : t], [e < 0 ? -62 : 62, t < 0 ? -25 : 25], "#8993A4", A.none));
			}), r;
		}
	},
	{
		id: "user-experience-map",
		categories: ["product", "thinking"],
		zh: "用户体验地图",
		en: "User experience map",
		build: (e) => {
			let t = G(e, "用户目标", "User goal"), n = [
				G(e, "认知", "Discover"),
				G(e, "使用", "Use"),
				G(e, "复购", "Return")
			], r = [U(M.ellipse, -86, -34, 172, 68, t, "yellow")];
			return n.forEach((e, t) => {
				let n = -280 + t * 190;
				r.push(U(M.roundRectangle, n, 100, 140, 52, e, [
					"blue",
					"purple",
					"green"
				][t])), r.push(W([0, 34], [n + 70, 100]));
			}), r;
		}
	},
	{
		id: "service-topology",
		categories: ["technology"],
		zh: "服务拓扑图",
		en: "Service topology",
		build: (e) => {
			let t = G(e, "客户端", "Client"), n = [
				"API",
				G(e, "用户服务", "User"),
				G(e, "订单服务", "Order")
			], r = [U(M.roundRectangle, -70, -170, 140, 52, t, "blue")];
			return n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(U(M.roundRectangle, n, -30, 140, 52, e, "purple"), W([0, -118], [n + 70, -30]));
			}), r.push(U(P.database, -70, 100, 140, 58, G(e, "数据库", "Database"), "green")), n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(W([n + 70, 22], [0, 100]));
			}), r;
		}
	},
	{
		id: "release-checklist",
		categories: ["technology", "teamwork"],
		zh: "发布检查清单",
		en: "Release checklist",
		build: (e) => {
			let t = [
				G(e, "代码冻结", "Code freeze"),
				G(e, "自动化测试", "Automated tests"),
				G(e, "灰度发布", "Canary release"),
				G(e, "全量上线", "Full release")
			];
			return t.flatMap((e, n) => {
				let r = -300 + n * 200;
				return [U(P.process, r, -30, 150, 60, e, n === 3 ? "green" : "gray"), ...n < t.length - 1 ? [W([r + 150, 0], [r + 200, 0])] : []];
			});
		}
	}
], ge = "lakex-drawnix-custom-materials-v1", K = [
	{
		key: "hot",
		zh: "热门推荐",
		en: "Popular",
		icon: "🔥"
	},
	{
		key: "teamwork",
		zh: "团队协作",
		en: "Teamwork"
	},
	{
		key: "product",
		zh: "产品设计",
		en: "Product"
	},
	{
		key: "technology",
		zh: "技术研发",
		en: "Technology"
	},
	{
		key: "thinking",
		zh: "思维方式",
		en: "Thinking"
	}
], q = (e) => JSON.parse(JSON.stringify(e)), J = (e) => !e || typeof e != "object" ? "" : "text" in e && typeof e.text == "string" ? e.text : "children" in e && Array.isArray(e.children) ? e.children.map(J).join("") : "", _e = (e) => {
	let t = e.flatMap((e) => e.points ?? []);
	if (!t.length) return {
		x: -300,
		y: -220,
		width: 600,
		height: 440
	};
	let n = t.map((e) => e[0]), r = t.map((e) => e[1]), i = Math.min(...n), a = Math.min(...r), o = Math.max(...n), s = Math.max(...r), c = Math.max(18, Math.min(o - i, s - a) * .08);
	return {
		x: i - c,
		y: a - c,
		width: Math.max(1, o - i + c * 2),
		height: Math.max(1, s - a + c * 2)
	};
};
function ve({ element: e }) {
	let [t, n] = e.points, a = Math.min(t[0], n[0]), o = Math.min(t[1], n[1]), s = Math.abs(n[0] - t[0]), c = Math.abs(n[1] - t[1]), l = a + s / 2, u = o + c / 2, d = e.fill && e.fill !== "none" ? e.fill : "#fff", f = e.strokeColor || "#718096", p = J(e.text), m = {
		fill: d,
		stroke: f,
		strokeWidth: e.strokeWidth || 1.5
	}, h;
	if (e.shape === M.ellipse) h = /* @__PURE__ */ r("ellipse", {
		cx: l,
		cy: u,
		rx: s / 2,
		ry: c / 2,
		...m
	});
	else if (e.shape === M.diamond || e.shape === P.decision) h = /* @__PURE__ */ r("path", {
		d: `M ${l} ${o} L ${a + s} ${u} L ${l} ${o + c} L ${a} ${u} Z`,
		...m
	});
	else if (e.shape === M.triangle) h = /* @__PURE__ */ r("path", {
		d: `M ${l} ${o} L ${a + s} ${o + c} L ${a} ${o + c} Z`,
		...m
	});
	else {
		let t = e.shape === M.roundRectangle || e.shape === P.terminal;
		h = /* @__PURE__ */ r("rect", {
			x: a,
			y: o,
			width: s,
			height: c,
			rx: t ? Math.min(c / 2, 14) : 2,
			...m
		});
	}
	return /* @__PURE__ */ i("g", { children: [h, p && /* @__PURE__ */ r("text", {
		x: l,
		y: u,
		fill: "#344054",
		fontSize: Math.max(10, Math.min(14, c * .25)),
		textAnchor: "middle",
		dominantBaseline: "central",
		children: p.length > 18 ? `${p.slice(0, 17)}…` : p
	})] });
}
function ye({ elements: e }) {
	let t = _e(e);
	return /* @__PURE__ */ i("svg", {
		className: "lakex-material-card__preview",
		viewBox: `${t.x} ${t.y} ${t.width} ${t.height}`,
		preserveAspectRatio: "xMidYMid meet",
		"aria-hidden": "true",
		children: [/* @__PURE__ */ r("defs", { children: /* @__PURE__ */ r("marker", {
			id: "lakex-material-preview-arrow",
			markerWidth: "7",
			markerHeight: "7",
			refX: "6",
			refY: "3.5",
			orient: "auto",
			children: /* @__PURE__ */ r("path", {
				d: "M0,0 L7,3.5 L0,7 Z",
				fill: "#7A8699"
			})
		}) }), e.map((e) => {
			if (e.type === "geometry") return /* @__PURE__ */ r(ve, { element: e }, e.id);
			let t = e;
			return !Array.isArray(t.points) || t.points.length < 2 ? null : /* @__PURE__ */ r("polyline", {
				points: t.points.map((e) => e.join(",")).join(" "),
				fill: "none",
				stroke: t.strokeColor || "#7A8699",
				strokeWidth: t.strokeWidth || 1.5,
				markerEnd: t.target?.marker && t.target.marker !== "none" ? "url(#lakex-material-preview-arrow)" : void 0
			}, e.id);
		})]
	});
}
var be = () => /* @__PURE__ */ i("svg", {
	viewBox: "0 0 24 24",
	"aria-hidden": "true",
	children: [
		/* @__PURE__ */ r("path", { d: "M5 13.5h12.5v6H5z" }),
		/* @__PURE__ */ r("path", { d: "m7 13.5 3.1-5 3.2 5M16.5 4.5v4M14.5 6.5h4M19 10.5v2M18 11.5h2" }),
		/* @__PURE__ */ r("circle", {
			cx: "6.5",
			cy: "7",
			r: "1.5"
		})
	]
}), xe = () => /* @__PURE__ */ r("svg", {
	viewBox: "0 0 24 24",
	"aria-hidden": "true",
	children: /* @__PURE__ */ r("path", { d: "M5 5l14 14M19 5 5 19" })
}), Y = () => {
	if (typeof window > "u") return [];
	try {
		let e = JSON.parse(window.localStorage.getItem(ge) || "[]");
		return Array.isArray(e) ? e : [];
	} catch {
		return [];
	}
}, Se = e.forwardRef(function({ board: a, locale: o, dark: s, toolbarHost: f, onOpen: h }, _) {
	let [v, y] = e.useState(!1), [C, w] = e.useState("recommended"), [E, D] = e.useState("hot"), [O, te] = e.useState([]), [A, j] = e.useState(null), [M, N] = e.useState(null), [P, F] = e.useState(""), I = e.useRef(null), L = e.useRef(null), R = e.useRef(null), ne = e.useRef(null), re = e.useRef({}), ie = e.useRef(null), z = o === "zh-CN", B = z ? {
		library: "素材库",
		recommended: "推荐素材",
		custom: "自定义素材",
		close: "关闭素材库",
		emptyTitle: "添加自定义素材",
		emptyStepOne: "步骤一：框选需要添加的内容",
		emptyStepTwo: "步骤二：右键打开菜单，选择“添加到素材库”",
		insert: "插入素材",
		remove: "删除",
		use: "使用",
		saved: "已添加到自定义素材库",
		selectionMissing: "请先选择要添加的图形",
		saveFailed: "素材保存失败，请重试",
		nameDialogTitle: "添加到素材库",
		nameDialogHint: "为这个自定义素材命名",
		namePlaceholder: "请输入素材名称",
		cancel: "取消",
		confirm: "添加"
	} : {
		library: "Material library",
		recommended: "Recommended",
		custom: "Custom",
		close: "Close material library",
		emptyTitle: "Add custom materials",
		emptyStepOne: "Step 1: Select the content to add.",
		emptyStepTwo: "Step 2: Right-click and choose “Add to material library”.",
		insert: "Insert material",
		remove: "Delete",
		use: "Use",
		saved: "Added to custom materials",
		selectionMissing: "Select shapes to add first",
		saveFailed: "Could not save the material. Please try again.",
		nameDialogTitle: "Add to material library",
		nameDialogHint: "Name this custom material",
		namePlaceholder: "Enter a material name",
		cancel: "Cancel",
		confirm: "Add"
	};
	e.useEffect(() => {
		if (!v) return;
		let e = (e) => {
			e.key === "Escape" && y(!1);
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	}, [v]), e.useEffect(() => () => {
		L.current !== null && window.clearTimeout(L.current);
	}, []), e.useEffect(() => {
		if (!M) return;
		let e = window.setTimeout(() => R.current?.select(), 0), t = (e) => {
			e.key === "Escape" && (N(null), F(""));
		};
		return window.addEventListener("keydown", t), () => {
			window.clearTimeout(e), window.removeEventListener("keydown", t);
		};
	}, [M]);
	let ae = (e) => {
		j(e), L.current !== null && window.clearTimeout(L.current), L.current = window.setTimeout(() => {
			L.current = null, j(null);
		}, 2200);
	}, oe = (e) => {
		te(e);
		try {
			window.localStorage.setItem(ge, JSON.stringify(e));
		} catch {}
	}, se = () => {
		if (!a) return null;
		let e = x(a);
		if (!e.length) return null;
		let t = _e(e), n;
		try {
			t = b(a, e, !0), n = a.buildFragment(null, t, m.copy, e)?.elements;
		} catch {}
		let r = n?.length ? n : e;
		if (!r?.length) return null;
		let i = {
			elements: q(r),
			width: t.width,
			height: t.height
		};
		return I.current = i, i;
	}, ce = () => {
		te(Y()), h?.(), y(!0);
	}, V = (e, t) => {
		if (!a || !e.length) return;
		k(a, T.drawing), c.updatePointerType(a, d.selection), g(a), p.setSelection(a, null);
		let n = l.getBoardContainer(a).getBoundingClientRect(), r = S(a) ?? [0, 0], i = a.viewport.zoom || 1, o = [r[0] + n.width / 2 / i, r[1] + n.height / 2 / i], s = t ? {
			x: 0,
			y: 0,
			width: t.width,
			height: t.height
		} : _e(e), f = [o[0] - (s.x + s.width / 2), o[1] - (s.y + s.height / 2)];
		u.withNewBatch(a, () => {
			a.insertFragment({ elements: q(e) }, f, m.paste), ee(a), g(a), p.setSelection(a, null);
		}), y(!1);
	}, H = () => {
		let e = se() ?? I.current;
		if (!e) return ae(B.selectionMissing), !1;
		let t = Y();
		return F(z ? `自定义素材 ${t.length + 1}` : `Custom material ${t.length + 1}`), N(e), !0;
	}, le = () => {
		if (M) try {
			let e = Y(), t = P.trim() || (z ? `自定义素材 ${e.length + 1}` : `Custom material ${e.length + 1}`), n = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				name: t,
				createdAt: Date.now(),
				elements: q(M.elements),
				width: M.width,
				height: M.height
			}, r = [n, ...e];
			oe(r);
			let i = Y();
			te(i.some((e) => e.id === n.id) ? i : r), w("custom"), h?.(), y(!0), N(null), F(""), ae(B.saved);
		} catch {
			ae(B.saveFailed);
		}
	};
	e.useImperativeHandle(_, () => ({
		addSelectionToLibrary: H,
		captureSelection: () => !!se()
	}));
	let ue = (e, t, n, a, o, s) => /* @__PURE__ */ i("article", {
		className: "lakex-material-card",
		children: [
			/* @__PURE__ */ i("button", {
				type: "button",
				className: "lakex-material-card__insert",
				title: `${B.insert}: ${t}`,
				onClick: () => V(n, o),
				children: [/* @__PURE__ */ r("span", {
					className: "lakex-material-card__canvas",
					children: /* @__PURE__ */ r(ye, { elements: n })
				}), /* @__PURE__ */ r("span", {
					className: "lakex-material-card__footer",
					children: /* @__PURE__ */ r("span", { children: t })
				})]
			}),
			s && /* @__PURE__ */ i("div", {
				className: "lakex-material-card__details",
				children: [
					/* @__PURE__ */ r("strong", { children: t }),
					/* @__PURE__ */ r("p", { children: s.description }),
					/* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-material-card__use",
						"aria-label": `${B.use}: ${t}`,
						onPointerDown: (e) => e.stopPropagation(),
						onClick: (e) => {
							e.preventDefault(), e.stopPropagation(), V(n, o);
						},
						children: B.use
					})
				]
			}),
			a && /* @__PURE__ */ r("button", {
				type: "button",
				className: "lakex-material-card__remove",
				"aria-label": `${B.remove}: ${t}`,
				title: B.remove,
				onPointerDown: (e) => {
					e.preventDefault(), e.stopPropagation();
				},
				onClick: (e) => {
					e.preventDefault(), e.stopPropagation(), a();
				},
				children: "×"
			})
		]
	}, e), de = f ? t(/* @__PURE__ */ r("div", {
		className: "lakex-material-trigger-wrap",
		"data-tooltip": B.library,
		children: /* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-material-trigger",
			title: B.library,
			"aria-label": B.library,
			"aria-expanded": v,
			onPointerDown: (e) => e.stopPropagation(),
			onClick: ce,
			children: /* @__PURE__ */ r(be, {})
		})
	}), f) : null;
	return /* @__PURE__ */ i(n, { children: [
		de,
		A && typeof document < "u" && t(/* @__PURE__ */ i("div", {
			className: "lakex-material-toast",
			"data-theme": s ? "dark" : "light",
			role: "status",
			children: [/* @__PURE__ */ r("span", { children: "✓" }), A]
		}), document.body),
		M && typeof document < "u" && t(/* @__PURE__ */ r("div", {
			className: "lakex-material-name-dialog__backdrop",
			"data-theme": s ? "dark" : "light",
			onPointerDown: (e) => {
				e.target === e.currentTarget && (N(null), F(""));
			},
			children: /* @__PURE__ */ i("form", {
				className: "lakex-material-name-dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": "lakex-material-name-dialog-title",
				onSubmit: (e) => {
					e.preventDefault(), le();
				},
				children: [
					/* @__PURE__ */ r("strong", {
						id: "lakex-material-name-dialog-title",
						children: B.nameDialogTitle
					}),
					/* @__PURE__ */ r("span", { children: B.nameDialogHint }),
					/* @__PURE__ */ r("input", {
						ref: R,
						value: P,
						placeholder: B.namePlaceholder,
						onChange: (e) => F(e.target.value)
					}),
					/* @__PURE__ */ i("div", {
						className: "lakex-material-name-dialog__actions",
						children: [/* @__PURE__ */ r("button", {
							type: "button",
							onClick: () => {
								N(null), F("");
							},
							children: B.cancel
						}), /* @__PURE__ */ r("button", {
							type: "submit",
							children: B.confirm
						})]
					})
				]
			})
		}), document.body),
		v && /* @__PURE__ */ r("div", {
			className: "lakex-material-library__backdrop",
			onPointerDown: (e) => {
				e.stopPropagation(), e.target === e.currentTarget && y(!1);
			},
			children: /* @__PURE__ */ i("section", {
				className: "lakex-material-library",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": B.library,
				onPointerDown: (e) => e.stopPropagation(),
				children: [/* @__PURE__ */ i("header", {
					className: "lakex-material-library__header",
					children: [/* @__PURE__ */ r("div", {
						className: "lakex-material-library__main-tabs",
						role: "tablist",
						children: ["recommended", "custom"].map((e) => /* @__PURE__ */ r("button", {
							type: "button",
							role: "tab",
							"aria-selected": C === e,
							onClick: () => w(e),
							children: e === "recommended" ? B.recommended : B.custom
						}, e))
					}), /* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-material-library__close",
						"aria-label": B.close,
						title: B.close,
						onClick: () => y(!1),
						children: /* @__PURE__ */ r(xe, {})
					})]
				}), C === "recommended" ? /* @__PURE__ */ i("div", {
					className: "lakex-material-library__recommended",
					children: [/* @__PURE__ */ r("nav", {
						className: "lakex-material-library__categories",
						"aria-label": B.recommended,
						children: K.map((e) => /* @__PURE__ */ i("button", {
							type: "button",
							role: "tab",
							"aria-selected": e.key === E,
							"aria-pressed": e.key === E,
							onClick: () => {
								let t = ne.current, n = re.current[e.key];
								t && n && (ie.current = e.key, D(e.key), t.scrollTo({
									top: n.offsetTop,
									behavior: "smooth"
								}), window.setTimeout(() => {
									ie.current = null;
								}, 400));
							},
							children: [e.icon && /* @__PURE__ */ r("span", { children: e.icon }), z ? e.zh : e.en]
						}, e.key))
					}), /* @__PURE__ */ r("div", {
						ref: ne,
						className: "lakex-material-library__recommended-scroll",
						onScroll: (e) => {
							if (ie.current) return;
							let t = e.currentTarget;
							if (t.scrollTop + t.clientHeight >= t.scrollHeight - 2) {
								D(K[K.length - 1].key);
								return;
							}
							let n = t.scrollTop + Math.min(t.clientHeight * .28, 128), r = K[0].key;
							for (let e of K) {
								let t = re.current[e.key];
								t && t.offsetTop <= n && (r = e.key);
							}
							D(r);
						},
						children: K.map((e) => /* @__PURE__ */ r("section", {
							ref: (t) => {
								re.current[e.key] = t;
							},
							className: "lakex-material-library__recommended-section",
							"aria-label": z ? e.zh : e.en,
							children: /* @__PURE__ */ r("div", {
								className: "lakex-material-library__grid",
								children: he.filter((t) => t.categories.includes(e.key)).map((e) => {
									let t = e.build(o);
									return ue(e.id, z ? e.zh : e.en, t, void 0, void 0, e.sourceId ? { description: z ? e.descriptionZh || "" : e.descriptionEn || "" } : void 0);
								})
							})
						}, e.key))
					})]
				}) : /* @__PURE__ */ r("div", {
					className: "lakex-material-library__custom",
					children: O.length ? /* @__PURE__ */ r("div", {
						className: "lakex-material-library__grid",
						children: O.map((e) => ue(e.id, e.name, e.elements, () => oe(O.filter((t) => t.id !== e.id)), e.width && e.height ? {
							width: e.width,
							height: e.height
						} : void 0))
					}) : /* @__PURE__ */ i("div", {
						className: "lakex-material-library__empty",
						children: [/* @__PURE__ */ i("div", {
							className: "lakex-material-library__empty-copy",
							children: [
								/* @__PURE__ */ r("strong", { children: B.emptyTitle }),
								/* @__PURE__ */ r("span", { children: B.emptyStepOne }),
								/* @__PURE__ */ r("span", { children: B.emptyStepTwo })
							]
						}), /* @__PURE__ */ i("div", {
							className: "lakex-material-library__empty-illustration",
							"aria-hidden": "true",
							children: [/* @__PURE__ */ i("div", {
								className: "lakex-material-library__empty-selection",
								children: [
									/* @__PURE__ */ r("i", {}),
									/* @__PURE__ */ r("b", {}),
									/* @__PURE__ */ r("em", {})
								]
							}), /* @__PURE__ */ i("div", {
								className: "lakex-material-library__empty-menu",
								children: [
									/* @__PURE__ */ r("i", {}),
									/* @__PURE__ */ r("i", {}),
									/* @__PURE__ */ r("b", { children: z ? "添加到素材库" : "Add to library" }),
									/* @__PURE__ */ r("i", {})
								]
							})]
						})]
					})
				})]
			})
		})
	] });
});
//#endregion
//#region src/cards/DrawingBoard/LakexBoardContextMenu.tsx
function Ce({ board: n, locale: a, dark: o, hasContextSelection: s, position: c, onClose: l, onAddText: u, onAddShape: d, onAddLine: f, onFitToCanvas: p, onActualSize: m, onAddToMaterialLibrary: h }) {
	let g = e.useRef(null), ee = a === "zh-CN", v = n ? x(n) : [], y = v.length > 0 || s, b = ee ? {
		addText: "添加文字",
		addShape: "添加图形",
		addLine: "添加连线",
		duplicate: "创建副本",
		addMaterial: "添加到素材库",
		actualSize: "实际尺寸",
		fitToCanvas: "自适应"
	} : {
		addText: "Add text",
		addShape: "Add shape",
		addLine: "Add connector",
		duplicate: "Duplicate",
		addMaterial: "Add to material library",
		actualSize: "Actual size",
		fitToCanvas: "Fit to canvas"
	};
	if (e.useEffect(() => {
		if (!c) return;
		let e = (e) => {
			g.current?.contains(e.target) || l();
		}, t = (e) => {
			e.key === "Escape" && l();
		};
		return document.addEventListener("pointerdown", e, !0), document.addEventListener("keydown", t, !0), () => {
			document.removeEventListener("pointerdown", e, !0), document.removeEventListener("keydown", t, !0);
		};
	}, [l, c]), !n || !c || typeof document > "u") return null;
	let S = Math.max(8, Math.min(c.x, window.innerWidth - 208)), C = Math.max(8, Math.min(c.y, window.innerHeight - 300)), w = (e) => {
		e(), l();
	};
	return t(/* @__PURE__ */ i("div", {
		ref: g,
		className: "lakex-board-context-menu",
		role: "menu",
		"aria-label": ee ? "画板菜单" : "Board menu",
		"data-theme": o ? "dark" : "light",
		style: {
			left: S,
			top: C
		},
		onContextMenu: (e) => {
			e.preventDefault(), e.stopPropagation();
		},
		children: [
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => w(u),
				children: [/* @__PURE__ */ r("span", { children: b.addText }), /* @__PURE__ */ r("kbd", { children: "T" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => w(d),
				children: [/* @__PURE__ */ r("span", { children: b.addShape }), /* @__PURE__ */ r("kbd", { children: "S" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => w(f),
				children: [/* @__PURE__ */ r("span", { children: b.addLine }), /* @__PURE__ */ r("kbd", { children: "⌘+L" })]
			}),
			/* @__PURE__ */ r("div", { className: "lakex-board-context-menu__divider" }),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				disabled: !y,
				onClick: () => w(() => _(n, v)),
				children: [/* @__PURE__ */ r("span", { children: b.duplicate }), /* @__PURE__ */ r("kbd", { children: "⌘+D" })]
			}),
			/* @__PURE__ */ r("button", {
				type: "button",
				role: "menuitem",
				disabled: !y,
				onClick: () => w(() => h()),
				children: /* @__PURE__ */ r("span", { children: b.addMaterial })
			}),
			/* @__PURE__ */ r("div", { className: "lakex-board-context-menu__divider" }),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => w(m),
				children: [/* @__PURE__ */ r("span", { children: b.actualSize }), /* @__PURE__ */ r("kbd", { children: "⌘+0" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => w(p),
				children: [/* @__PURE__ */ r("span", { children: b.fitToCanvas }), /* @__PURE__ */ r("kbd", { children: "⌘+Shift+=" })]
			})
		]
	}), document.body);
}
//#endregion
//#region docs/lakex-drawing-board-json-format-skills.md?raw
var we = "# Lakex AI 画板 JSON 格式规范\n\n本文档用于指导 AI 把自然语言描述转换为 Lakex 画板可导入的 JSON。普通图表使用稳定、受控的 AI 中间格式；原生思维导图允许使用受校验的 `plaitValue` 树结构。应用会校验响应，再转换或挂载为原生画板元素。\n\n<!-- AI_RUNTIME_SPEC_START -->\n\n## AI 运行时精简规范\n\n只输出一个合法 JSON 对象，不要 Markdown、代码围栏、解释或注释。\n\n普通画板、流程图、UML、Smart 和 ER 根结构：\n\n`{\"version\":1,\"diagramType\":\"flowchart\",\"title\":\"可选标题\",\"nodes\":[],\"edges\":[]}`\n\n节点结构：\n\n`{\"id\":\"唯一ID\",\"shape\":\"图形\",\"x\":80,\"y\":80,\"width\":180,\"height\":64,\"text\":\"文字\",\"style\":{\"fill\":\"#E8F1FF\",\"strokeColor\":\"#5B8FF9\",\"strokeWidth\":1.5,\"strokeStyle\":\"solid\",\"fontSize\":14,\"textColor\":\"#273142\"}}`\n\n连线结构：\n\n`{\"id\":\"唯一ID\",\"source\":\"节点ID\",\"target\":\"节点ID\",\"sourceAnchor\":\"bottom\",\"targetAnchor\":\"top\",\"label\":\"可选文字\",\"style\":{\"lineType\":\"elbow\",\"strokeColor\":\"#697586\",\"strokeWidth\":1.5,\"strokeStyle\":\"solid\",\"endMarker\":\"arrow\"}}`\n\n允许的 `shape`：\n\n`rectangle,roundRectangle,ellipse,diamond,triangle,parallelogram,trapezoid,pentagon,hexagon,octagon,cloud,text,process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion`\n\n约束：\n\n- `version` 必须是数字 `1`，不能是字符串。\n- `diagramType` 必须根据用户意图填写为 `board,flowchart,uml,smart,er` 之一，并严格使用第 8 节对应分类的图形和布局规则。\n- ID 只能包含字母、数字、下划线、短横线；全部唯一。\n- 最多 80 个节点、120 条连线。\n- 节点必须使用 `shape` 和 `text` 字段，不能改成 `type`、`label`。\n- 坐标范围 `-5000..5000`；宽 `40..1200`；高 `24..800`。\n- 颜色只能是 `#RRGGBB`，填充可为 `transparent`。\n- 锚点只能是 `top,right,bottom,left`。\n- 线型只能是 `straight,elbow,curve`，箭头只能是 `arrow,none`。\n- 描边样式 `strokeStyle` 只能是 `solid,dashed,dotted`，默认 `solid`。\n- 每条连线必须引用已存在且不同的 source/target 节点。\n- 图形不能重叠；同层节点对齐，间距至少 32；流程图优先从上到下。\n- 连线不得穿过任何非起止节点，平行线段至少间隔 24px；分支节点周围预留至少 48px 连线通道。\n- `decision` 的“是/否”出口必须使用不同 `sourceAnchor`：纵向主流程通常“是”使用 `bottom`，“否”使用 `left` 或 `right`，并把否分支节点放在对应侧；禁止两条分支共用同一出口后重叠。\n- 锚点必须朝向另一个节点：上方来源进入目标用 `targetAnchor:top`，下方来源用 `bottom`，左侧来源用 `left`，右侧来源用 `right`。如果来源中心的 x 落在目标宽度内，禁止从目标 `left/right` 进入；如果来源中心的 y 落在目标高度内，禁止从目标 `top/bottom` 进入。\n- 多条连线进入同一节点且来源方向不同时，必须使用不同 `targetAnchor`；例如上方来源进入 `top`、左侧来源进入 `left`，不能为了对齐而让连线横穿目标图形。\n- 普通节点推荐 180×64，判断节点推荐 180×110。\n- 只要用户要求思维导图、脑图或 mind map，禁止使用 `nodes + edges`，必须返回原生 `plaitValue` 树结构。\n\n思维导图强制根结构：\n\n`{\"plaitValue\":[{\"id\":\"mind_root\",\"type\":\"mind\",\"data\":{\"topic\":{\"children\":[{\"text\":\"中心主题\"}],\"type\":\"paragraph\"}},\"children\":[],\"layout\":\"right\",\"points\":[[0,0]]}]}`\n\n思维导图约束：\n\n- 顶层只能放 `type:\"mind\"` 根节点；所有后代必须是 `type:\"mind_child\"`。\n- 父子关系只通过嵌套 `children` 表达，叶子必须使用 `children:[]`；禁止输出独立 `edges`。\n- 每个节点都必须有唯一 `id` 和 `data.topic`；`topic` 必须是 `{\"children\":[{\"text\":\"文字\"}],\"type\":\"paragraph\"}`。\n- 根节点必须包含 `layout` 和单点 `points`；默认使用 `layout:\"right\"`、`points:[[0,0]]`。后代节点不要输出 `points`。\n- 思维导图响应不要同时输出 `version`、`nodes`、`edges`、`shape`、`x`、`y`、`width` 或 `height`。\n\n<!-- AI_RUNTIME_SPEC_END -->\n\n## 1. 输出要求\n\n1. 只输出一个合法 JSON 对象，不要输出 Markdown 代码块、解释、注释或前后缀。\n2. 普通图表根对象必须包含 `version`、`diagramType`、`nodes`、`edges`；原生思维导图必须改用第 7 节的 `plaitValue`。\n3. 普通图表的 `version` 固定为 `1`。\n4. 所有 `id` 在同一份 JSON 内唯一，只能包含字母、数字、下划线和短横线。\n5. 最多 80 个节点、120 条连线。不要生成孤立且没有信息的装饰元素。\n6. 坐标单位为画板逻辑像素。建议把图形放在 `x=80..1400`、`y=80..900` 范围内。\n7. 图形之间至少保留 32px 间距，避免重叠；同层节点对齐，布局方向保持一致。\n8. 节点文本应简洁。中文通常不超过 20 个字，英文通常不超过 60 个字符。\n9. 不允许输出 HTML、脚本、图片 URL、data URL、事件、函数或 Drawnix/Plait 私有字段。\n\n## 2. 普通图表根对象\n\n```json\n{\n  \"version\": 1,\n  \"diagramType\": \"flowchart\",\n  \"title\": \"可选的图表标题\",\n  \"nodes\": [],\n  \"edges\": []\n}\n```\n\n| 字段      | 类型   | 必填 | 说明                               |\n| --------- | ------ | ---- | ---------------------------------- |\n| `version` | number | 是   | 固定为 `1`                         |\n| `diagramType` | string | 是 | `board,flowchart,uml,smart,er` 之一 |\n| `title`   | string | 否   | 图表标题，应用不会把它自动插入画布 |\n| `nodes`   | array  | 是   | 节点列表                           |\n| `edges`   | array  | 是   | 连线列表                           |\n\n## 3. 节点\n\n```json\n{\n  \"id\": \"node_start\",\n  \"shape\": \"terminal\",\n  \"x\": 120,\n  \"y\": 120,\n  \"width\": 160,\n  \"height\": 64,\n  \"text\": \"开始\",\n  \"style\": {\n    \"fill\": \"#E8F1FF\",\n    \"strokeColor\": \"#5B8FF9\",\n    \"strokeWidth\": 1.5,\n    \"strokeStyle\": \"solid\",\n    \"fontSize\": 14,\n    \"textColor\": \"#273142\"\n  }\n}\n```\n\n### 3.1 节点字段\n\n| 字段     | 类型   | 必填 | 约束                         |\n| -------- | ------ | ---- | ---------------------------- |\n| `id`     | string | 是   | 唯一，1–64 字符              |\n| `shape`  | string | 是   | 必须来自第 3.2 节            |\n| `x`      | number | 是   | 左上角 X，范围 `-5000..5000` |\n| `y`      | number | 是   | 左上角 Y，范围 `-5000..5000` |\n| `width`  | number | 是   | 范围 `40..1200`              |\n| `height` | number | 是   | 范围 `24..800`               |\n| `text`   | string | 否   | 最多 500 字符                |\n| `style`  | object | 否   | 只允许第 3.3 节字段          |\n\n### 3.2 支持的图形\n\n基础图形：\n\n- `rectangle`：矩形\n- `roundRectangle`：圆角矩形\n- `ellipse`：椭圆\n- `diamond`：菱形\n- `triangle`：三角形\n- `parallelogram`：平行四边形\n- `trapezoid`：梯形\n- `pentagon`：五边形\n- `hexagon`：六边形\n- `octagon`：八边形\n- `cloud`：云形\n- `text`：无边框文本\n\n流程图：\n\n- `process`：处理步骤\n- `terminal`：开始或结束\n- `decision`：条件判断\n- `data`：数据输入或输出\n- `connector`：页内连接\n- `manualInput`：手动输入\n- `preparation`：准备\n- `predefinedProcess`：子流程\n- `document`：文档\n- `multiDocument`：多文档\n- `database`：数据库\n- `internalStorage`：内部存储\n- `delay`：延迟\n- `display`：显示\n- `offPage`：页外连接\n- `noteSquare`：注释\n\nSmart：\n\n- `actor`：角色\n- `useCase`：用例\n- `component`：组件\n- `container`：容器\n- `note`：便签\n- `package`：包\n\nUML：\n\n- `actor`：角色\n- `useCase`：用例\n- `component`：组件\n- `container`：容器\n- `note`：便签\n- `package`：包\n- `simpleClass`：简单类\n- `class`：类\n- `interface`：接口\n- `object`：对象\n- `componentBox`：组件框\n- `activityClass`：活动\n- `branchMerge`：分支或合并\n- `port`：端口\n- `combinedFragment`：组合片段\n- `template`：模板\n- `activation`：激活生命线\n- `deletion`：销毁节点\n\nER：\n\n- `rectangle`：实体\n- `roundRectangle`：弱实体\n- `diamond`：关系\n- `ellipse`：属性\n- `parallelogram`：关联实体\n- `class`：带字段明细的实体\n\n### 3.3 节点样式\n\n| 字段          | 类型   | 约束                              |\n| ------------- | ------ | --------------------------------- |\n| `fill`        | string | `#RRGGBB`；透明使用 `transparent` |\n| `strokeColor` | string | `#RRGGBB`                         |\n| `strokeWidth` | number | `0..8`                            |\n| `strokeStyle` | string | `solid`、`dashed`、`dotted`       |\n| `fontSize`    | number | `10..72`                          |\n| `textColor`   | string | `#RRGGBB`                         |\n\n推荐色板：\n\n- 蓝：填充 `#E8F1FF`，描边 `#5B8FF9`\n- 绿：填充 `#EAF8F0`，描边 `#5BB98C`\n- 黄：填充 `#FFF6D9`，描边 `#D9A441`\n- 橙：填充 `#FFF0E6`，描边 `#E58B50`\n- 紫：填充 `#F3EBFF`，描边 `#9B71D1`\n- 灰：填充 `#F3F4F6`，描边 `#8B95A5`\n- 默认正文色：`#273142`\n\n颜色应表达语义并保持一致。普通流程建议使用同一主色，仅给判断、异常或关键节点使用强调色。\n\n## 4. 连线\n\n```json\n{\n  \"id\": \"edge_start_to_check\",\n  \"source\": \"node_start\",\n  \"target\": \"node_check\",\n  \"sourceAnchor\": \"bottom\",\n  \"targetAnchor\": \"top\",\n  \"label\": \"\",\n  \"style\": {\n    \"lineType\": \"elbow\",\n    \"strokeColor\": \"#697586\",\n    \"strokeWidth\": 1.5,\n    \"strokeStyle\": \"solid\",\n    \"endMarker\": \"arrow\"\n  }\n}\n```\n\n### 4.1 连线字段\n\n| 字段           | 类型   | 必填 | 约束                                        |\n| -------------- | ------ | ---- | ------------------------------------------- |\n| `id`           | string | 是   | 唯一，1–64 字符                             |\n| `source`       | string | 是   | 必须引用存在的节点 ID                       |\n| `target`       | string | 是   | 必须引用存在的节点 ID，不能与 `source` 相同 |\n| `sourceAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |\n| `targetAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |\n| `label`        | string | 否   | 最多 120 字符，例如“是”“否”                 |\n| `style`        | object | 否   | 见第 4.2 节                                 |\n\n### 4.2 连线样式\n\n| 字段          | 类型   | 约束                         |\n| ------------- | ------ | ---------------------------- |\n| `lineType`    | string | `straight`、`elbow`、`curve` |\n| `strokeColor` | string | `#RRGGBB`                    |\n| `strokeWidth` | number | `0.5..8`                     |\n| `strokeStyle` | string | `solid`、`dashed`、`dotted`  |\n| `endMarker`   | string | `arrow` 或 `none`            |\n\n默认使用 `elbow` 和 `arrow`。流程方向应通过锚点表达，例如纵向流程使用 `bottom -> top`，横向流程使用 `right -> left`。\n\n### 4.3 防止连线与箭头重叠\n\n- 连线只能在起点和终点处接触节点边界，任何中间线段都不能穿过其他节点。\n- 同一节点有多条出边时，优先分配不同的 `sourceAnchor`；同一节点有多条入边时，优先分配不同的 `targetAnchor`。\n- 纵向流程的普通步骤使用 `bottom -> top`。判断节点的主分支继续向下，使用 `bottom -> top`；另一分支向左或向右展开，使用 `left -> right` 或 `right -> left`。\n- 判断条件的两个出口不得同时使用 `bottom`，否则箭头和“是/否”标签会重叠。默认约定：“是”沿主流程向下，“否”向距离其他节点更远的一侧展开。\n- 分支目标节点必须位于出口方向：从 `left` 离开的目标放在判断节点左侧，从 `right` 离开的目标放在右侧，从 `bottom` 离开的目标放在下方。\n- `targetAnchor` 必须位于面向来源节点的一侧：来源在上方时连接 `top`，来源在下方时连接 `bottom`，来源在左侧时连接 `left`，来源在右侧时连接 `right`。不得选择需要让最后一段连线穿过目标内部才能到达的锚点。\n- 特别注意“斜上方来源”：若来源中心的 x 仍落在目标的 `[x, x + width]` 范围内，应视为上方来源并连接 `top`，不能连接 `left/right`；“斜侧方来源”按相同原则检查 y 投影。\n- 同一目标有多条入边时，根据各来源位置分配不同入口。例如失败节点同时接收上方注册流程和左侧校验流程时，应分别使用 `top` 和 `left`，不能共用入口或让其中一条线穿过失败节点。\n- 两条平行连线的可见线段至少间隔 24px；连线与非起止节点边缘至少间隔 24px；判断节点与分支目标之间建议保留 80px 以上通道。\n- 回流线放在流程外侧，不能逆向穿过主流程节点。回流目标应使用侧边锚点，例如 `top -> left`，不要与主流程的 `bottom -> top` 共用路径。\n- “是”“否”等标签必须属于不同连线并跟随各自出口；标签附近至少保留 16px 空白，不要放在两条线的交叉点或重合线段上。\n\n纵向判断分支推荐结构：\n\n```json\n[\n  {\n    \"id\": \"edge_yes\",\n    \"source\": \"decision_stock\",\n    \"target\": \"deduct_stock\",\n    \"sourceAnchor\": \"bottom\",\n    \"targetAnchor\": \"top\",\n    \"label\": \"是\",\n    \"style\": { \"lineType\": \"elbow\", \"endMarker\": \"arrow\" }\n  },\n  {\n    \"id\": \"edge_no\",\n    \"source\": \"decision_stock\",\n    \"target\": \"sold_out\",\n    \"sourceAnchor\": \"right\",\n    \"targetAnchor\": \"left\",\n    \"label\": \"否\",\n    \"style\": { \"lineType\": \"elbow\", \"endMarker\": \"arrow\" }\n  }\n]\n```\n\n其中 `deduct_stock` 必须位于 `decision_stock` 下方，`sold_out` 必须位于其右侧。若右侧已有节点，则整体镜像到左侧，并改用 `left -> right`。\n\n## 5. 布局规则\n\n- 先确定主方向：流程图优先从上到下，架构图优先从左到右。\n- 同一层级使用相同的 `width`、`height` 和对齐线。\n- 一般节点建议 `width=160..220`、`height=56..88`。\n- 判断节点建议 `width=150..190`、`height=90..120`。\n- UML 类图建议 `width=200..280`、`height=120..220`。\n- 横向节点中心间距建议 240px，纵向节点中心间距建议 140px。\n- 分支汇聚前后留出额外空间，判断分支建议横向中心间距至少 280px，避免连线穿过节点。\n- 先放置节点，再按节点位置分配锚点；若连线会穿过节点，应移动分支节点或切换到另一侧，而不是继续输出重叠连线。\n- 连线只连接语义相关节点，不要用连线绘制装饰边框。\n\n### 5.1 思维导图\n\n思维导图不使用本节的坐标和连线布局规则，也不允许使用普通 `nodes + edges` 图形模拟。必须直接使用第 7 节的原生 `plaitValue` 树结构，由 Plait Mind 组件根据 `children` 和 `layout` 自动计算节点位置与分支连线。\n\n## 6. 普通流程图中间格式示例\n\n用户描述：“生成一个用户提交工单的流程图，审核通过后进入处理中，不通过则退回修改，最后完成。”\n\n模型在使用 `nodes + edges` 模式时应只返回以下 JSON；这段示例是流程图示例，其他类型必须改用第 8 节对应规范，不适用于原生思维导图 `plaitValue` 模式：\n\n```json\n{\n  \"version\": 1,\n  \"diagramType\": \"flowchart\",\n  \"title\": \"工单处理流程\",\n  \"nodes\": [\n    {\n      \"id\": \"start\",\n      \"shape\": \"terminal\",\n      \"x\": 360,\n      \"y\": 80,\n      \"width\": 160,\n      \"height\": 56,\n      \"text\": \"开始\",\n      \"style\": {\n        \"fill\": \"#EAF8F0\",\n        \"strokeColor\": \"#5BB98C\",\n        \"fontSize\": 14,\n        \"textColor\": \"#273142\"\n      }\n    },\n    {\n      \"id\": \"submit\",\n      \"shape\": \"process\",\n      \"x\": 350,\n      \"y\": 190,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"提交工单\"\n    },\n    {\n      \"id\": \"review\",\n      \"shape\": \"decision\",\n      \"x\": 350,\n      \"y\": 310,\n      \"width\": 180,\n      \"height\": 110,\n      \"text\": \"审核通过？\",\n      \"style\": {\n        \"fill\": \"#FFF6D9\",\n        \"strokeColor\": \"#D9A441\"\n      }\n    },\n    {\n      \"id\": \"revise\",\n      \"shape\": \"process\",\n      \"x\": 80,\n      \"y\": 330,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"退回修改\"\n    },\n    {\n      \"id\": \"processing\",\n      \"shape\": \"process\",\n      \"x\": 350,\n      \"y\": 500,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"处理中\"\n    },\n    {\n      \"id\": \"done\",\n      \"shape\": \"terminal\",\n      \"x\": 360,\n      \"y\": 630,\n      \"width\": 160,\n      \"height\": 56,\n      \"text\": \"完成\",\n      \"style\": {\n        \"fill\": \"#EAF8F0\",\n        \"strokeColor\": \"#5BB98C\"\n      }\n    }\n  ],\n  \"edges\": [\n    {\n      \"id\": \"e1\",\n      \"source\": \"start\",\n      \"target\": \"submit\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    },\n    {\n      \"id\": \"e2\",\n      \"source\": \"submit\",\n      \"target\": \"review\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    },\n    {\n      \"id\": \"e3\",\n      \"source\": \"review\",\n      \"target\": \"processing\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\",\n      \"label\": \"是\"\n    },\n    {\n      \"id\": \"e4\",\n      \"source\": \"review\",\n      \"target\": \"revise\",\n      \"sourceAnchor\": \"left\",\n      \"targetAnchor\": \"right\",\n      \"label\": \"否\"\n    },\n    {\n      \"id\": \"e5\",\n      \"source\": \"revise\",\n      \"target\": \"submit\",\n      \"sourceAnchor\": \"top\",\n      \"targetAnchor\": \"left\"\n    },\n    {\n      \"id\": \"e6\",\n      \"source\": \"processing\",\n      \"target\": \"done\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    }\n  ]\n}\n```\n\n注意：实际响应不能包含上面的 Markdown 代码围栏，只包含 JSON 对象。若生成原生思维导图，则应改用第 7 节的 `{ \"plaitValue\": [...] }` 根结构。\n\n<!-- AI_NATIVE_MIND_SPEC_START -->\n\n## 7. AI 原生思维导图 `plaitValue` 规范\n\n`plaitValue` 是思维导图组件和画板卡片使用的原生 Plait 元素数组。普通图表继续使用 `version + nodes + edges`，但 AI 生成思维导图时必须直接返回 `{ \"plaitValue\": [...] }`。不要套用 `drawnix`、`elements` 或其他持久化包裹结构。\n\n### 7.1 原生思维导图结构\n\n思维导图不是由独立的 `edges` 元素组成，而是由一棵嵌套树组成：\n\n- 根节点的 `type` 是 `mind`；兼容旧数据时也可能看到 `mindmap`。\n- 子孙节点的 `type` 是 `mind_child`，关系由父节点的 `children` 表达。\n- 每个节点都必须有唯一 `id`、`data` 和 `children`；叶子节点使用空数组 `children: []`。\n- `data.topic` 是 Slate 段落，不是普通字符串，结构固定为 `{ \"children\": [{ \"text\": \"...\" }], \"type\": \"paragraph\" }`。\n- 根节点通常有 `layout` 和单点 `points`。`points` 是根节点左上角逻辑坐标，格式为 `[[x, y]]`，不是普通图形的 `[[left, top], [right, bottom]]`。\n- `layout` 支持 `right`、`left`、`standard`、`upward`、`downward`，以及 `right-bottom-indented`、`right-top-indented`、`left-top-indented`、`left-bottom-indented`。\n- `rightNodeCount` 用于 `standard` 布局区分根节点左右分支；没有左右分支时可以省略。不要把它写到子节点上。\n- `fill`、`strokeColor`、`strokeWidth`、`strokeStyle`、`shape`、`branchColor`、`branchWidth`、`branchShape`、`isCollapsed`、`manualWidth` 等是可选的原生样式或布局字段，应使用项目已有值，不要创造新的字段名。\n- `shape` 的原生思维导图值是 `round-rectangle` 或 `underline`；它与 AI 中间格式的 `roundRectangle` 不是同一个字段值。\n\n最小可用的原生思维导图示例：\n\n```json\n{\n  \"plaitValue\": [\n    {\n      \"id\": \"tnpPz\",\n      \"type\": \"mind\",\n      \"data\": {\n        \"topic\": {\n          \"children\": [{ \"text\": \"中心主题\" }],\n          \"type\": \"paragraph\"\n        }\n      },\n      \"children\": [\n        {\n          \"id\": \"ntyaw\",\n          \"type\": \"mind_child\",\n          \"data\": {\n            \"topic\": {\n              \"children\": [{ \"text\": \"1111\" }],\n              \"type\": \"paragraph\"\n            }\n          },\n          \"children\": []\n        },\n        {\n          \"id\": \"xNewH\",\n          \"type\": \"mind_child\",\n          \"data\": {\n            \"topic\": {\n              \"children\": [{ \"text\": \"22222\" }],\n              \"type\": \"paragraph\"\n            }\n          },\n          \"children\": []\n        }\n      ],\n      \"layout\": \"right\",\n      \"points\": [[0, 0]]\n    }\n  ]\n}\n```\n\n带二级分支时，只需继续嵌套 `children`，不要新增 `edges`：\n\n```json\n{\n  \"id\": \"ntyaw\",\n  \"type\": \"mind_child\",\n  \"data\": {\n    \"topic\": {\n      \"children\": [{ \"text\": \"用户系统\" }],\n      \"type\": \"paragraph\"\n    }\n  },\n  \"children\": [\n    {\n      \"id\": \"ntyaw-login\",\n      \"type\": \"mind_child\",\n      \"data\": {\n        \"topic\": {\n          \"children\": [{ \"text\": \"登录\" }],\n          \"type\": \"paragraph\"\n        }\n      },\n      \"children\": []\n    }\n  ]\n}\n```\n\n### 7.2 原生思维导图与 AI 格式的转换边界\n\n保存或恢复卡片时读取 `value.plaitValue`。调用 AI 时，普通图表使用 `nodes + edges`，需要通过 `convertAIBoardDocument` 转换；原生思维导图可以直接使用 `{ \"plaitValue\": [...] }`，应用只做安全校验、字段规范化和容器提取，然后通过原生 Mind 插入流程挂载。不要把 `mind_child` 拆成普通几何节点或独立 `edges`；必须保持父子嵌套结构，否则会出现 `mind element has not been mounted` 或无法计算节点边界的问题。\n\n两种响应格式的处理边界如下：\n\n| AI 响应根结构 | 适用场景 | 应用处理 |\n| --- | --- | --- |\n| `{ \"version\": 1, \"diagramType\": \"...\", \"nodes\": [], \"edges\": [] }` | 普通画板、流程图、UML、Smart、ER | 按 `diagramType` 校验图形集合，再转换为 geometry / arrow-line 元素 |\n| `{ \"plaitValue\": [{ \"type\": \"mind\", \"children\": [...] }] }` | 所有思维导图、脑图、mind map 请求 | 提取并校验原生树，直接挂载为 `mind` 元素 |\n\n因此，你给出的 `plaitValue` 不需要再转换成 `nodes + edges`；只需要保留完整的 `mind` / `mind_child` 树结构，并作为 AI 响应的根对象返回。\n\n<!-- AI_NATIVE_MIND_SPEC_END -->\n\n<!-- AI_DIAGRAM_TYPE_SPEC_START -->\n\n## 8. 流程图、UML、Smart 与 ER 分类规范\n\n除原生思维导图外，AI 必须先识别用户需要的图表类型，并在根对象中填写对应的 `diagramType`。除非用户明确要求混合图，否则禁止跨分类借用图形；存在对应语义图形时，不能用普通矩形代替。\n\n类型选择优先级：\n\n- 操作步骤、审批、业务流转、条件分支、异常回退：`flowchart`。\n- 用例图、类图、组件图、活动图、时序或系统建模：`uml`。\n- 角色协作、概念关系、系统模块、容器和便签式架构表达：`smart`。\n- 数据库表、实体、属性、主外键和实体关系：`er`。\n- 只是自由排版、信息卡片或无法归入以上类型：`board`。\n- 思维导图、脑图、mind map 不使用 `diagramType`，必须改用第 7 节的原生 `plaitValue`。\n\n### 8.1 流程图 `flowchart`\n\n只使用 `process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,text`。\n\n- 开始和结束必须使用 `terminal`；普通操作使用 `process`；条件分支使用 `decision`，不能用普通 `diamond` 代替。\n- 输入输出使用 `data`，数据存储按语义使用 `database` 或 `internalStorage`，可复用流程使用 `predefinedProcess`。\n- 主流程优先自上而下。判断节点的不同出口必须使用不同锚点，并在连线 `label` 中明确“是/否”“成功/失败”等条件。\n- 流转线默认 `endMarker:\"arrow\"`；注释线才允许 `endMarker:\"none\"`。\n\n### 8.2 UML `uml`\n\n只使用 `actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion,text`。\n\n按 UML 子类型选择图形：\n\n- 用例图：参与者用 `actor`，用例用 `useCase`，系统边界用 `container`。\n- 类图：类用 `class` 或 `simpleClass`，接口用 `interface`，实例用 `object`，泛型定义用 `template`。`class/interface` 的 `text` 第一行是名称，后续行是属性或方法。\n- 组件图：组件用 `component` 或 `componentBox`，分组用 `package/container`，接口连接点用 `port`。\n- 活动图：活动使用 `activityClass`，判断或汇合使用 `branchMerge`。\n- 时序表达：参与对象使用 `actor/object`，生命期激活使用 `activation`，组合条件使用 `combinedFragment`，销毁点使用 `deletion`。\n\nUML 连线的 `label` 应写明关系语义，如“继承”“实现”“依赖”“关联”“包含”。继承、实现或有向依赖使用 `endMarker:\"arrow\"`；普通关联使用 `endMarker:\"none\"`。同一层的类或组件应对齐，并为关系文字预留空间。\n\n### 8.3 Smart `smart`\n\n只使用 `actor,useCase,component,container,note,package,text`。\n\n- 人员或外部参与方使用 `actor`，目标或能力使用 `useCase`，模块使用 `component`，边界或系统域使用 `container`。\n- 同一业务域用 `package` 分组，补充说明使用 `note`，不能把便签作为流程节点。\n- Smart 图用于高层概念、协作和架构关系，不应混入流程图的 `decision/process` 或 UML 类明细图形。\n- 布局优先从左到右：角色在左、能力或组件居中、容器或系统边界在右；关联线通常使用 `endMarker:\"none\"`，存在明确方向时才使用箭头。\n\n### 8.4 ER `er`\n\n只使用 `rectangle,roundRectangle,diamond,ellipse,parallelogram,class,text`。\n\n- 实体使用 `rectangle`；弱实体使用 `roundRectangle`；关系使用 `diamond`；属性使用 `ellipse`；关联实体使用 `parallelogram`。\n- 需要展示表字段时使用 `class`：第一行是实体名，后续每行一个字段，可用 `PK`、`FK` 标记主键和外键。\n- ER 关系线使用 `endMarker:\"none\"`。基数写入 `label`，使用 `1:1`、`1:N`、`M:N`、`0..1` 或 `0..N` 等明确标记。\n- 实体按主要关系横向或网格排布；关系菱形位于关联实体之间，属性靠近所属实体。禁止连线穿过其他实体或属性。\n- 关系节点必须同时连接至少两个实体；属性只能连接所属实体，不得形成独立业务流程。\n\n### 8.5 分类校验\n\n应用会根据 `diagramType` 校验每个节点的 `shape`。如果 UML、Smart、ER 或流程图使用了其他分类的图形，整份 AI 响应会被拒绝；因此必须先选类型，再生成节点和连线。\n\n<!-- AI_DIAGRAM_TYPE_SPEC_END -->\n", Te = "<!-- AI_RUNTIME_SPEC_START -->", Ee = "<!-- AI_RUNTIME_SPEC_END -->", De = "<!-- AI_NATIVE_MIND_SPEC_START -->", Oe = "<!-- AI_NATIVE_MIND_SPEC_END -->", ke = "<!-- AI_DIAGRAM_TYPE_SPEC_START -->", Ae = "<!-- AI_DIAGRAM_TYPE_SPEC_END -->", je = (e, t, n) => {
	let r = e.indexOf(t), i = e.indexOf(n);
	return r < 0 || i <= r ? e : e.slice(r + t.length, i).trim();
}, Me = je(we, Te, Ee), Ne = je(we, De, Oe), Pe = [
	"你是 Lakex AI 画板数据生成器。",
	"请严格遵守下面的格式规范，根据用户描述生成一份可以直接导入画板的 JSON。",
	"最终响应只能包含 JSON 对象，不能包含 Markdown 代码围栏、解释或注释。",
	"",
	Me,
	"",
	"以下是流程图、UML、Smart 和 ER 必须分别使用的分类规范：",
	je(we, ke, Ae),
	"",
	"以下是思维导图必须直接使用的第 7 条原生规范：",
	Ne
].join("\n"), Fe = {
	rectangle: M.rectangle,
	roundRectangle: M.roundRectangle,
	ellipse: M.ellipse,
	diamond: M.diamond,
	triangle: M.triangle,
	parallelogram: M.parallelogram,
	trapezoid: M.trapezoid,
	pentagon: M.pentagon,
	hexagon: M.hexagon,
	octagon: M.octagon,
	cloud: M.cloud,
	text: M.text,
	process: P.process,
	terminal: P.terminal,
	decision: P.decision,
	data: P.data,
	connector: P.connector,
	manualInput: P.manualInput,
	preparation: P.preparation,
	predefinedProcess: P.predefinedProcess,
	document: P.document,
	multiDocument: P.multiDocument,
	database: P.database,
	internalStorage: P.internalStorage,
	delay: P.delay,
	display: P.display,
	offPage: P.offPage,
	noteSquare: P.noteSquare,
	actor: I.actor,
	useCase: I.useCase,
	component: I.component,
	container: I.container,
	note: I.note,
	package: I.package,
	simpleClass: I.simpleClass,
	class: I.class,
	interface: I.interface,
	object: I.object,
	componentBox: I.componentBox,
	activityClass: I.activityClass,
	branchMerge: I.branchMerge,
	port: I.port,
	combinedFragment: I.combinedFragment,
	template: I.template,
	activation: I.activation,
	deletion: I.deletion
}, Ie = {
	flowchart: /* @__PURE__ */ new Set([
		"process",
		"terminal",
		"decision",
		"data",
		"connector",
		"manualInput",
		"preparation",
		"predefinedProcess",
		"document",
		"multiDocument",
		"database",
		"internalStorage",
		"delay",
		"display",
		"offPage",
		"noteSquare",
		"text"
	]),
	smart: /* @__PURE__ */ new Set([
		"actor",
		"useCase",
		"component",
		"container",
		"note",
		"package",
		"text"
	]),
	uml: /* @__PURE__ */ new Set([
		"actor",
		"useCase",
		"component",
		"container",
		"note",
		"package",
		"simpleClass",
		"class",
		"interface",
		"object",
		"componentBox",
		"activityClass",
		"branchMerge",
		"port",
		"combinedFragment",
		"template",
		"activation",
		"deletion",
		"text"
	]),
	er: /* @__PURE__ */ new Set([
		"rectangle",
		"roundRectangle",
		"diamond",
		"ellipse",
		"parallelogram",
		"class",
		"text"
	])
}, Le = new Map(Object.entries(Fe).map(([e, t]) => [t, e])), X = (e) => !!e && typeof e == "object" && !Array.isArray(e), Re = (e, t, n) => Math.min(n, Math.max(t, e)), Z = (e, t, n, r) => {
	let i = typeof e == "number" ? e : Number(e);
	return Number.isFinite(i) ? Re(i, n, r) : t;
}, Q = (e, t, n = "") => typeof e == "string" ? e.slice(0, t) : n, $ = (e, t, n = !1) => n && e === "transparent" ? "transparent" : typeof e == "string" && /^#[0-9a-f]{6}$/i.test(e) ? e.toUpperCase() : t, ze = (e) => e === "top" || e === "right" || e === "bottom" || e === "left" ? e : void 0, Be = (e) => e === "board" || e === "flowchart" || e === "uml" || e === "smart" || e === "er" ? e : void 0, Ve = (e) => e === E.dashed || e === E.dotted ? e : E.solid, He = (e, t) => Math.max(0, Math.min(e.x + e.width, t.x + t.width) - Math.max(e.x, t.x)) * Math.max(0, Math.min(e.y + e.height, t.y + t.height) - Math.max(e.y, t.y)) / Math.min(e.width * e.height, t.width * t.height), Ue = (e, t) => {
	if (e.length < 2) return e;
	let n = 0;
	for (let t = 0; t < e.length; t += 1) for (let r = t + 1; r < e.length; r += 1) He(e[t], e[r]) >= .35 && (n += 1);
	if (n < e.length - 1) return e;
	let r = new Map(e.map((e) => [e.id, e])), i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map();
	e.forEach((e) => {
		i.set(e.id, []), a.set(e.id, 0);
	}), t.forEach((e) => {
		r.has(e.source) && r.has(e.target) && (i.get(e.source)?.push(e.target), a.set(e.target, (a.get(e.target) ?? 0) + 1));
	});
	let o = e.filter((e) => a.get(e.id) === 0).map((e) => e.id);
	if (!(o.length > 0 && t.length === e.length - o.length && [...a.values()].every((e) => e <= 1))) {
		let t = Math.max(1, Math.ceil(Math.sqrt(e.length)));
		return e.map((e, n) => ({
			...e,
			x: 120 + n % t * 320,
			y: 120 + Math.floor(n / t) * 180
		}));
	}
	let s = new Map(e.map((e) => [e.id, { ...e }])), c = Math.max(...e.map((e) => e.width), 180) + 160, l = Math.max(...e.map((e) => e.height), 64) + 72, u = 120, d = /* @__PURE__ */ new Set(), f = (e, t) => {
		if (d.has(e)) return null;
		let n = s.get(e);
		if (!n) return null;
		d.add(e);
		let r = (i.get(e) ?? []).map((e) => f(e, t + 1)).filter((e) => e !== null), a = r.length ? r.reduce((e, t) => e + t, 0) / r.length : u + n.height / 2;
		return r.length || (u += n.height + l), n.x = 120 + t * c, n.y = a - n.height / 2, a;
	};
	return o.forEach((e) => f(e, 0)), e.forEach((e) => {
		d.has(e.id) || f(e.id, 0);
	}), e.map((e) => s.get(e.id) ?? e);
}, We = (e) => {
	if (typeof e != "string") return e;
	let t = e.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	try {
		return JSON.parse(t);
	} catch {
		throw Error("AI_RESPONSE_NOT_JSON");
	}
}, Ge = /* @__PURE__ */ new Set([
	"right",
	"left",
	"standard",
	"upward",
	"downward",
	"right-bottom-indented",
	"right-top-indented",
	"left-top-indented",
	"left-bottom-indented"
]), Ke = (e, t) => {
	if (!X(e) || e.type !== "paragraph" || !Array.isArray(e.children) || e.children.length === 0) throw Error(`AI_NATIVE_TOPIC_INVALID:${t}`);
	return {
		type: "paragraph",
		children: e.children.map((e, n) => {
			if (!X(e) || typeof e.text != "string") throw Error(`AI_NATIVE_TOPIC_INVALID:${t}.${n}`);
			let r = { text: Q(e.text, 500) };
			return [
				"bold",
				"italic",
				"underline",
				"strikeThrough"
			].forEach((t) => {
				typeof e[t] == "boolean" && (r[t] = e[t]);
			}), typeof e.color == "string" && (r.color = $(e.color, "#273142")), e["font-size"] !== void 0 && (r["font-size"] = String(Z(e["font-size"], 14, 10, 72))), r;
		})
	};
}, qe = (e, t) => {
	if (!Array.isArray(e)) return [t];
	let n = e.filter((e) => Array.isArray(e) && e.length >= 2 && Number.isFinite(Number(e[0])) && Number.isFinite(Number(e[1]))).slice(0, 8).map((e) => [Re(Number(e[0]), -5e3, 5e3), Re(Number(e[1]), -5e3, 5e3)]);
	return n.length ? n : [t];
}, Je = (e, t, n, r, i, a) => {
	if (!X(e) || a > 50) throw Error(`AI_NATIVE_ELEMENT_INVALID:${r}`);
	let o = Q(e.id, 64);
	if (!/^[a-zA-Z0-9_-]+$/.test(o) || t.has(o)) throw Error(`AI_NATIVE_ID_INVALID:${r}`);
	let s = e.type;
	if (n && s !== "mind" && s !== "mindmap" || !n && s !== "mind_child") throw Error(`AI_NATIVE_TYPE_INVALID:${r}`);
	if (!X(e.data)) throw Error(`AI_NATIVE_DATA_INVALID:${r}`);
	let c = e.children ?? [];
	if (!Array.isArray(c)) throw Error(`AI_NATIVE_CHILDREN_INVALID:${r}`);
	t.add(o);
	let l = {
		id: o,
		type: s,
		data: { topic: Ke(e.data.topic, `${r}.data.topic`) },
		children: c.map((e, n) => Je(e, t, !1, `${r}.children[${n}]`, i, a + 1))
	};
	return n ? (l.points = qe(e.points, i), l.layout = Ge.has(String(e.layout)) ? e.layout : "right") : Ge.has(String(e.layout)) && (l.layout = e.layout), typeof e.rightNodeCount == "number" && (l.rightNodeCount = Math.max(0, Math.floor(e.rightNodeCount))), typeof e.manualWidth == "number" && (l.manualWidth = Z(e.manualWidth, 0, 40, 1200)), typeof e.isCollapsed == "boolean" && (l.isCollapsed = e.isCollapsed), (e.shape === "round-rectangle" || e.shape === "underline") && (l.shape = e.shape), (e.branchShape === "bight" || e.branchShape === "polyline") && (l.branchShape = e.branchShape), typeof e.fill == "string" && (l.fill = $(e.fill, "#E8F1FF", !0)), typeof e.strokeColor == "string" && (l.strokeColor = $(e.strokeColor, "#5B8FF9")), e.strokeWidth !== void 0 && (l.strokeWidth = Z(e.strokeWidth, 1.5, 0, 8)), e.strokeStyle !== void 0 && (l.strokeStyle = Ve(e.strokeStyle)), typeof e.branchColor == "string" && (l.branchColor = $(e.branchColor, "#5B8FF9")), e.branchWidth !== void 0 && (l.branchWidth = Z(e.branchWidth, 1.5, .5, 8)), l;
}, Ye = (e) => {
	if (!Array.isArray(e) || e.length === 0 || e.length > 20) throw Error("AI_NATIVE_SIZE_INVALID");
	let t = /* @__PURE__ */ new Set(), n = 0;
	return e.map((e, r) => {
		let i = t.size, a = Je(e, t, !0, `plaitValue[${r}]`, [120 + r * 360, 120], 0);
		if (n += t.size - i, n > 80) throw Error("AI_NATIVE_SIZE_INVALID");
		return a;
	});
};
function Xe(e) {
	let t = We(e);
	if (X(t)) {
		let e = Array.isArray(t.plaitValue) ? t.plaitValue : Array.isArray(t.elements) ? t.elements : null;
		if (e) return {
			kind: "native",
			elements: Ye(e)
		};
	}
	return {
		kind: "intermediate",
		document: Ze(t)
	};
}
function Ze(e) {
	let t = We(e);
	if (!X(t) || t.version !== 1) throw Error("AI_SCHEMA_VERSION_INVALID");
	let n = Be(t.diagramType);
	if (t.diagramType !== void 0 && !n) throw Error("AI_DIAGRAM_TYPE_INVALID");
	if (!Array.isArray(t.nodes) || !Array.isArray(t.edges)) throw Error("AI_SCHEMA_COLLECTION_INVALID");
	if (t.nodes.length === 0 || t.nodes.length > 80 || t.edges.length > 120) throw Error("AI_SCHEMA_SIZE_INVALID");
	let r = /* @__PURE__ */ new Set(), i = t.nodes.map((e, t) => {
		if (!X(e)) throw Error(`AI_NODE_INVALID:${t}`);
		let n = Q(e.id, 64);
		if (!/^[a-zA-Z0-9_-]+$/.test(n) || r.has(n)) throw Error(`AI_NODE_ID_INVALID:${t}`);
		r.add(n);
		let i = Q(e.shape, 32);
		if (!Fe[i]) throw Error(`AI_NODE_SHAPE_INVALID:${i}`);
		let a = X(e.style) ? e.style : {};
		return {
			id: n,
			shape: i,
			x: Z(e.x, 80 + t % 4 * 240, -5e3, 5e3),
			y: Z(e.y, 80 + Math.floor(t / 4) * 140, -5e3, 5e3),
			width: Z(e.width, 180, 40, 1200),
			height: Z(e.height, 64, 24, 800),
			text: Q(e.text, 500),
			style: {
				fill: $(a.fill, "#E8F1FF", !0),
				strokeColor: $(a.strokeColor, "#5B8FF9"),
				strokeWidth: Z(a.strokeWidth, 1.5, 0, 8),
				strokeStyle: Ve(a.strokeStyle),
				fontSize: Z(a.fontSize, 14, 10, 72),
				textColor: $(a.textColor, "#273142")
			}
		};
	}), a = new Set(i.map((e) => e.id)), o = t.edges.map((e, t) => {
		if (!X(e)) throw Error(`AI_EDGE_INVALID:${t}`);
		let n = Q(e.id, 64);
		if (!/^[a-zA-Z0-9_-]+$/.test(n) || r.has(n)) throw Error(`AI_EDGE_ID_INVALID:${t}`);
		r.add(n);
		let i = Q(e.source, 64), o = Q(e.target, 64);
		if (!a.has(i) || !a.has(o) || i === o) throw Error(`AI_EDGE_REFERENCE_INVALID:${t}`);
		let s = X(e.style) ? e.style : {}, c = s.lineType === "straight" || s.lineType === "curve" || s.lineType === "elbow" ? s.lineType : "elbow";
		return {
			id: n,
			source: i,
			target: o,
			sourceAnchor: ze(e.sourceAnchor),
			targetAnchor: ze(e.targetAnchor),
			label: Q(e.label, 120),
			style: {
				lineType: c,
				strokeColor: $(s.strokeColor, "#697586"),
				strokeWidth: Z(s.strokeWidth, 1.5, .5, 8),
				strokeStyle: Ve(s.strokeStyle),
				endMarker: s.endMarker === "none" ? "none" : "arrow"
			}
		};
	}), s = Ue(i, o);
	if (n && n !== "board") {
		let e = Ie[n], t = s.find((t) => !e.has(t.shape));
		if (t) throw Error(`AI_DIAGRAM_SHAPE_MISMATCH:${n}:${t.shape}`);
	}
	return {
		version: 1,
		...n ? { diagramType: n } : {},
		title: Q(t.title, 120) || void 0,
		nodes: s,
		edges: o
	};
}
var Qe = {
	top: [.5, 0],
	right: [1, .5],
	bottom: [.5, 1],
	left: [0, .5]
}, $e = (e, t) => {
	let n = [e.x + e.width / 2, e.y + e.height / 2], r = [t.x + t.width / 2, t.y + t.height / 2], i = r[0] - n[0], a = r[1] - n[1];
	return Math.abs(i) > Math.abs(a) ? i >= 0 ? ["right", "left"] : ["left", "right"] : a >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}, et = (e) => [e.x + e.width / 2, e.y + e.height / 2], tt = (e, t) => {
	let n = et(e), r = et(t), i = r[0] - n[0], a = r[1] - n[1], o = i >= 0 ? "right" : "left", s = a >= 0 ? "bottom" : "top";
	return Math.abs(i) > Math.abs(a) ? [o, s] : [s, o];
}, nt = (e, t, n) => {
	let [r, i] = et(n);
	switch (t) {
		case "top": return i <= e.y;
		case "right": return r >= e.x + e.width;
		case "bottom": return i >= e.y + e.height;
		case "left": return r <= e.x;
	}
}, rt = (e, t, n, r, i) => {
	let a = [
		n,
		r,
		...tt(e, t),
		"top",
		"right",
		"bottom",
		"left"
	].filter((n, r, i) => !!n && i.indexOf(n) === r && nt(e, n, t));
	return a.find((e) => !i.has(e)) ?? a[0] ?? r;
}, it = (e) => {
	let t = new Map(e.nodes.map((e) => [e.id, e])), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
	return e.edges.forEach((e) => {
		let a = t.get(e.source), o = t.get(e.target);
		if (!a || !o) return;
		let s = $e(a, o), c = n.get(a.id) ?? /* @__PURE__ */ new Set(), l = r.get(o.id) ?? /* @__PURE__ */ new Set(), u = rt(a, o, e.sourceAnchor, s[0], c), d = rt(o, a, e.targetAnchor, s[1], l);
		c.add(u), l.add(d), n.set(a.id, c), r.set(o.id, l), i.set(e.id, [u, d]);
	}), i;
}, at = (e, t) => {
	switch (t) {
		case "top": return [e.x + e.width / 2, e.y];
		case "right": return [e.x + e.width, e.y + e.height / 2];
		case "bottom": return [e.x + e.width / 2, e.y + e.height];
		case "left": return [e.x, e.y + e.height / 2];
	}
}, ot = (e) => {
	if (!e || typeof e != "object") return "";
	let t = e;
	return typeof t.text == "string" ? t.text : Array.isArray(t.children) ? t.children.map(ot).join("") : "";
}, st = (e) => {
	if (!e || typeof e != "object") return;
	let t = e;
	if (typeof t.text == "string") return t;
	if (Array.isArray(t.children)) for (let e of t.children) {
		let t = st(e);
		if (t) return t;
	}
}, ct = (e) => e.text ? ot(e.text) : Array.isArray(e.cells) ? e.cells.map((e) => ot(e.text)).filter(Boolean).join("\n") : Array.isArray(e.texts) ? e.texts.map((e) => ot(e.text)).filter(Boolean).join("\n") : "", lt = (e) => {
	let t = st(e.text ?? e.cells?.find((e) => e.text)?.text ?? e.texts?.find((e) => e.text)?.text), n = Number(t?.["font-size"]);
	return {
		fontSize: Number.isFinite(n) ? Re(n, 10, 72) : 14,
		textColor: typeof t?.color == "string" && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toUpperCase() : "#273142"
	};
}, ut = (e) => {
	if (!Array.isArray(e) || e.length < 2) return null;
	let t = e.filter((e) => Array.isArray(e) && e.length >= 2 && Number.isFinite(e[0]) && Number.isFinite(e[1]));
	if (!t.length) return null;
	let n = t.map((e) => e[0]), r = t.map((e) => e[1]), i = Math.min(...n), a = Math.max(...n), o = Math.min(...r), s = Math.max(...r);
	return {
		x: i,
		y: o,
		width: Math.max(40, a - i),
		height: Math.max(24, s - o)
	};
}, dt = (e) => {
	if (!(!Array.isArray(e) || e.length < 2 || !Number.isFinite(e[0]) || !Number.isFinite(e[1]))) return Object.entries(Qe).reduce((t, n) => {
		let r = Math.abs(n[1][0] - e[0]) + Math.abs(n[1][1] - e[1]);
		return r < t.distance ? {
			anchor: n[0],
			distance: r
		} : t;
	}, {
		anchor: "top",
		distance: Infinity
	}).anchor;
};
function ft(e) {
	let t = [], n = /* @__PURE__ */ new Set();
	for (let r of e.children) {
		if (t.length >= 80) break;
		let e = r;
		if (e.type !== "geometry") continue;
		let i = Le.get(e.shape), a = ut(e.points);
		if (!i || !a || !/^[a-zA-Z0-9_-]+$/.test(e.id)) continue;
		let o = lt(e);
		t.push({
			id: e.id,
			shape: i,
			...a,
			text: ct(e).slice(0, 500),
			style: {
				fill: e.fill === "transparent" || /^#[0-9a-f]{6}$/i.test(e.fill) ? e.fill : "#E8F1FF",
				strokeColor: /^#[0-9a-f]{6}$/i.test(e.strokeColor) ? e.strokeColor : "#5B8FF9",
				strokeWidth: Z(e.strokeWidth, 1.5, 0, 8),
				strokeStyle: Ve(e.strokeStyle),
				...o
			}
		}), n.add(e.id);
	}
	let r = [];
	for (let t of e.children) {
		if (r.length >= 120) break;
		let e = t;
		if (e.type !== "arrow-line" || !n.has(e.source?.boundId) || !n.has(e.target?.boundId)) continue;
		let i = e.shape === j.straight || e.shape === j.curve ? e.shape : j.elbow, a = Array.isArray(e.texts) ? e.texts.map((e) => ot(e.text)).join("") : "";
		r.push({
			id: typeof e.id == "string" && /^[a-zA-Z0-9_-]+$/.test(e.id) ? e.id : `edge_${r.length + 1}`,
			source: e.source.boundId,
			target: e.target.boundId,
			sourceAnchor: dt(e.source.connection),
			targetAnchor: dt(e.target.connection),
			label: a.slice(0, 120),
			style: {
				lineType: i,
				strokeColor: /^#[0-9a-f]{6}$/i.test(e.strokeColor) ? e.strokeColor : "#697586",
				strokeWidth: Z(e.strokeWidth, 1.5, .5, 8),
				strokeStyle: Ve(e.strokeStyle),
				endMarker: e.target.marker === A.none ? "none" : "arrow"
			}
		});
	}
	return {
		version: 1,
		nodes: t,
		edges: r
	};
}
var pt = (e) => e.type === "mind" || e.type === "mindmap", mt = (e) => {
	let t = 0, n = (e) => {
		t += 1, Array.isArray(e.children) && e.children.forEach(n);
	};
	return e.forEach((e) => n(e)), t;
};
function ht(e) {
	let t = e.children.filter(pt);
	return t.length ? { plaitValue: t.map((e) => JSON.parse(JSON.stringify(e))) } : ft(e);
}
function gt(e) {
	return "plaitValue" in e ? mt(e.plaitValue) : e.nodes.length;
}
var _t = 20, vt = 8e3;
function yt({ description: e, history: t, currentBoard: n, mode: r }) {
	let i = [], a = 0;
	for (let e = t.length - 1; e >= 0 && i.length < _t; --e) {
		let n = t[e].trim();
		if (n) {
			if (a + n.length > vt) break;
			i.unshift(n), a += n.length;
		}
	}
	let o = i.length ? i.map((e, t) => `${t + 1}. ${e}`).join("\n") : "无，这是本轮会话的第一次提问。", s = JSON.stringify(n), c = gt(n), l = r === "append" ? [
		"本轮模式：添加独立图到当前画布。",
		"当前画布 JSON 仅用于理解已有内容和避免语义重复。",
		"只返回本轮需要新增的完整图表；普通图表返回新增节点与连线，思维导图返回完整的新增 plaitValue 根节点。"
	] : c ? [
		"本轮模式：继续修改当前画布。",
		"必须以当前画布 JSON 为基础完成最新需求。",
		"返回修改后的完整画布 JSON；保留未要求删除的节点、连线及其 ID。"
	] : ["本轮模式：从空画布开始生成。", "请根据最新需求返回一份完整的新画布 JSON。"];
	return [
		"下面是本轮 AI 画板会话上下文。",
		"",
		"用户历史需求（仅记录成功生成后的提问，按时间顺序）：",
		o,
		"",
		"当前画布的最新 JSON（这是唯一一份画布 JSON，已包含用户手工修改）：",
		s,
		"",
		"最新用户需求：",
		e.trim(),
		"",
		...l,
		"严格按照 system message 中的画板格式规范输出，只输出 JSON。"
	].join("\n");
}
function bt(e, t) {
	let n = [], r = it(e), i = /* @__PURE__ */ new Map();
	return e.nodes.forEach((e) => {
		let r = e.shape === "text", a = [[e.x, e.y], [e.x + e.width, e.y + e.height]], o = {
			"font-size": String(e.style.fontSize),
			color: e.style.textColor
		}, s = e.shape === "class" || e.shape === "interface", c = t && s ? R(t, a, Fe[e.shape]) : ne(Fe[e.shape], a, e.text, {
			fill: r ? "transparent" : e.style.fill,
			strokeColor: r ? "transparent" : e.style.strokeColor,
			strokeWidth: r ? 0 : e.style.strokeWidth
		}, o);
		if (t && s && "cells" in c) {
			let t = e.text.split("\n");
			c.cells = c.cells.map((n, r) => {
				let i = r === 0 ? t[0] || e.text : r === 1 ? t.slice(1).join("\n") : "";
				return {
					...n,
					text: D(i, r === 0 ? w.center : w.left, o)
				};
			}), c.fill = e.style.fill, c.strokeColor = e.style.strokeColor, c.strokeWidth = e.style.strokeWidth;
		}
		c.strokeStyle = e.style.strokeStyle, n.push(c), i.set(e.id, {
			source: e,
			element: c
		});
	}), e.edges.forEach((e) => {
		let t = i.get(e.source), a = i.get(e.target);
		if (!t || !a) return;
		let o = $e(t.source, a.source), [s, c] = r.get(e.id) ?? o, l = e.style.lineType === "straight" ? j.straight : e.style.lineType === "curve" ? j.curve : j.elbow, u = L(l, [at(t.source, s), at(a.source, c)], {
			boundId: t.element.id,
			connection: Qe[s],
			marker: A.none
		}, {
			boundId: a.element.id,
			connection: Qe[c],
			marker: e.style.endMarker === "none" ? A.none : A.arrow
		}, e.label ? [{
			text: D(e.label),
			position: .5
		}] : void 0, {
			strokeColor: e.style.strokeColor,
			strokeWidth: e.style.strokeWidth
		});
		u.strokeStyle = e.style.strokeStyle, n.push(u);
	}), n;
}
//#endregion
//#region src/cards/DrawingBoard/LakexAIBoardAssistant.tsx
var xt = {
	"zh-CN": {
		tooltip: "AI 画板助手",
		title: "AI 画板助手",
		description: "描述你想生成的图，AI 会创建可继续编辑的图形和连线。",
		placeholder: "例如：生成一个用户登录流程图，包含输入账号、校验密码、登录成功和失败重试，并标注判断分支。",
		replace: "替换当前画布",
		modify: "继续修改当前画布",
		append: "添加到当前画布",
		cancel: "取消",
		cancelGenerating: "取消生成",
		generate: "生成",
		generating: "正在生成…",
		shortcut: "⌘/Ctrl + Enter 生成",
		missing: "尚未配置 AI 服务。请通过 config.drawingBoardAI.generate 注入项目的模型调用。",
		empty: "请先输入图的详细描述。",
		invalid: "AI 返回的数据不符合画板 JSON 规范，请重试或让模型减少图形数量。",
		failed: "生成失败，请检查 AI 服务后重试。",
		success: "AI 图形已生成",
		memory: (e) => `已记忆 ${e} 条历史需求`,
		boardContext: (e) => e ? `将基于当前画布的 ${e} 个图形继续生成` : "当前为空画布",
		resetMemory: "新对话"
	},
	"en-US": {
		tooltip: "AI board assistant",
		title: "AI board assistant",
		description: "Describe a diagram and AI will create editable shapes and connectors.",
		placeholder: "For example: Create a user login flowchart with credentials, password validation, success, and retry branches.",
		replace: "Replace canvas",
		modify: "Continue editing canvas",
		append: "Add to canvas",
		cancel: "Cancel",
		cancelGenerating: "Cancel generation",
		generate: "Generate",
		generating: "Generating…",
		shortcut: "⌘/Ctrl + Enter to generate",
		missing: "AI is not configured. Provide config.drawingBoardAI.generate from your application.",
		empty: "Describe the diagram first.",
		invalid: "The AI response does not match the board JSON specification. Please try again.",
		failed: "Generation failed. Check the AI service and try again.",
		success: "AI diagram generated",
		memory: (e) => `${e} remembered request${e === 1 ? "" : "s"}`,
		boardContext: (e) => e ? `Continue from ${e} current canvas shape${e === 1 ? "" : "s"}` : "The current canvas is empty",
		resetMemory: "New conversation"
	}
};
function St({ ai: a, board: o, locale: s, dark: c, toolbarHost: l, overlayHost: u, onOpen: d, onApply: f }) {
	let p = xt[s], [m, h] = e.useState(!1), [g, ee] = e.useState(""), [_, v] = e.useState("replace"), [y, b] = e.useState(!1), [x, S] = e.useState(""), [C, w] = e.useState(null), [T, E] = e.useState([]), D = e.useRef(null), O = e.useRef(null), te = e.useRef(0), k = e.useRef(null), A = e.useCallback((e) => {
		k.current !== null && window.clearTimeout(k.current), w(e), k.current = window.setTimeout(() => {
			w(null), k.current = null;
		}, 3200);
	}, []), j = e.useCallback(() => {
		te.current += 1, O.current?.controller.abort(), O.current = null, b(!1), h(!1), S("");
	}, []);
	e.useEffect(() => () => {
		O.current?.controller.abort(), k.current !== null && window.clearTimeout(k.current);
	}, []), e.useEffect(() => {
		if (!m) return;
		let e = window.requestAnimationFrame(() => D.current?.focus()), t = (e) => {
			e.key === "Escape" && j();
		};
		return document.addEventListener("keydown", t, !0), () => {
			window.cancelAnimationFrame(e), document.removeEventListener("keydown", t, !0);
		};
	}, [j, m]);
	let M = e.useCallback(async () => {
		let e = g.trim();
		if (!e) {
			S(p.empty), D.current?.focus();
			return;
		}
		if (!a) {
			S(p.missing);
			return;
		}
		if (!o) {
			S(p.failed);
			return;
		}
		b(!0), S("");
		let t = new AbortController(), n = ++te.current;
		O.current?.controller.abort(), O.current = {
			id: n,
			controller: t
		};
		try {
			let r = ht(o), i = yt({
				description: e,
				history: T,
				currentBoard: r,
				mode: _
			}), c = await a.generate({
				description: e,
				systemPrompt: Pe,
				contextPrompt: i,
				history: T,
				currentBoard: r,
				locale: s,
				signal: t.signal
			});
			if (t.signal.aborted || O.current?.id !== n) return;
			let l = Xe(c);
			f(l.kind === "native" ? l.elements : bt(l.document, o), _), E((t) => [...t, e].slice(-20)), h(!1), ee(""), A({
				type: "success",
				message: p.success
			});
		} catch (e) {
			if (t.signal.aborted || O.current?.id !== n) return;
			let r = e instanceof Error ? e.message : "", i = r.startsWith("AI_") || r.includes("JSON") ? p.invalid : r || p.failed;
			S(i), A({
				type: "error",
				message: i
			});
		} finally {
			O.current?.id === n && (O.current = null, b(!1));
		}
	}, [
		a,
		o,
		g,
		T,
		s,
		_,
		f,
		A,
		p
	]), N = o ? gt(ht(o)) : 0, P = l ? t(/* @__PURE__ */ r("div", {
		className: "lakex-ai-board-trigger-wrap",
		children: /* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-ai-board-trigger",
			title: p.tooltip,
			"data-tooltip": p.tooltip,
			"aria-label": p.tooltip,
			"aria-expanded": m,
			onClick: () => {
				d?.(), S(""), N === 0 && T.length && E([]), h(!0);
			},
			children: /* @__PURE__ */ r("svg", {
				"aria-hidden": "true",
				viewBox: "0 0 24 24",
				children: /* @__PURE__ */ r("use", {
					href: `#icon-ai-board-${c ? "dark" : "default"}`,
					xlinkHref: `#icon-ai-board-${c ? "dark" : "default"}`
				})
			})
		})
	}), l) : null, F = m && u ? t(/* @__PURE__ */ r("div", {
		className: "lakex-ai-board-overlay",
		role: "presentation",
		onPointerDown: (e) => {
			e.stopPropagation(), e.target === e.currentTarget && j();
		},
		children: /* @__PURE__ */ i("section", {
			className: "lakex-ai-board-dialog",
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "lakex-ai-board-title",
			children: [
				/* @__PURE__ */ i("header", {
					className: "lakex-ai-board-dialog__header",
					children: [/* @__PURE__ */ i("div", { children: [/* @__PURE__ */ r("h3", {
						id: "lakex-ai-board-title",
						children: p.title
					}), /* @__PURE__ */ r("p", { children: p.description })] }), /* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-ai-board-dialog__close",
						"aria-label": p.cancel,
						onClick: j,
						children: "×"
					})]
				}),
				/* @__PURE__ */ r("textarea", {
					ref: D,
					value: g,
					maxLength: 4e3,
					placeholder: p.placeholder,
					disabled: y,
					onChange: (e) => {
						ee(e.target.value), x && S("");
					},
					onKeyDown: (e) => {
						e.stopPropagation(), e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), M());
					}
				}),
				/* @__PURE__ */ i("div", {
					className: "lakex-ai-board-dialog__options",
					children: [/* @__PURE__ */ i("label", { children: [/* @__PURE__ */ r("input", {
						type: "radio",
						name: "lakex-ai-board-mode",
						value: "replace",
						checked: _ === "replace",
						disabled: y,
						onChange: () => v("replace")
					}), N ? p.modify : p.replace] }), /* @__PURE__ */ i("label", { children: [/* @__PURE__ */ r("input", {
						type: "radio",
						name: "lakex-ai-board-mode",
						value: "append",
						checked: _ === "append",
						disabled: y,
						onChange: () => v("append")
					}), p.append] })]
				}),
				/* @__PURE__ */ i("div", {
					className: "lakex-ai-board-dialog__memory",
					children: [/* @__PURE__ */ i("div", { children: [/* @__PURE__ */ r("span", { children: p.memory(T.length) }), /* @__PURE__ */ r("span", { children: p.boardContext(N) })] }), /* @__PURE__ */ r("button", {
						type: "button",
						disabled: y || T.length === 0,
						onClick: () => E([]),
						children: p.resetMemory
					})]
				}),
				!a && /* @__PURE__ */ r("p", {
					className: "lakex-ai-board-dialog__notice",
					children: p.missing
				}),
				x && /* @__PURE__ */ r("p", {
					className: "lakex-ai-board-dialog__error",
					role: "alert",
					children: x
				}),
				/* @__PURE__ */ i("footer", {
					className: "lakex-ai-board-dialog__footer",
					children: [/* @__PURE__ */ r("span", { children: p.shortcut }), /* @__PURE__ */ i("div", { children: [/* @__PURE__ */ r("button", {
						type: "button",
						onClick: j,
						children: y ? p.cancelGenerating : p.cancel
					}), /* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-ai-board-dialog__generate",
						disabled: y || !g.trim() || !a,
						onClick: () => void M(),
						children: y ? p.generating : p.generate
					})] })]
				})
			]
		})
	}), u) : null, I = C && u ? t(/* @__PURE__ */ i("div", {
		className: "lakex-ai-board-toast",
		"data-type": C.type,
		role: C.type === "error" ? "alert" : "status",
		children: [/* @__PURE__ */ r("span", {
			"aria-hidden": "true",
			children: C.type === "success" ? "✓" : "!"
		}), C.message]
	}), u) : null;
	return /* @__PURE__ */ i(n, { children: [
		P,
		F,
		I
	] });
}
//#endregion
//#region src/cards/DrawingBoard/LakexQuickShapePicker.tsx
var Ct = 248, wt = 320, Tt = 8, Et = [
	"basic",
	"flowchart",
	"smart"
];
function Dt({ locale: n, anchor: a, recent: o, sourceShape: s, onPick: c, onClose: l }) {
	let u = n === "zh-CN", d = e.useRef(null), [f, p] = e.useState(null);
	e.useLayoutEffect(() => {
		let e = d.current;
		if (!e) return;
		let t = Math.min(e.offsetHeight, wt), n = Math.min(Math.max(Tt, a.x + Tt), window.innerWidth - Ct - Tt), r = Math.min(Math.max(Tt, a.y), Math.max(Tt, window.innerHeight - t - Tt));
		p({
			left: n,
			top: r
		});
	}, [a.x, a.y]), e.useEffect(() => {
		let e = (e) => {
			let t = e.target;
			d.current?.contains(t) || l();
		}, t = (e) => {
			e.key === "Escape" && l();
		};
		return document.addEventListener("pointerdown", e, !0), document.addEventListener("keydown", t), () => {
			document.removeEventListener("pointerdown", e, !0), document.removeEventListener("keydown", t);
		};
	}, [l]);
	let m = [...s ? [s] : [], ...o.filter((e) => e !== s)].slice(0, 7).map((e) => {
		for (let t of H) {
			let n = t.shapes.find((t) => t.pointer === e);
			if (n) return n;
		}
		return null;
	}).filter((e) => e !== null).slice(0, 7), h = (e, t) => {
		let n = u ? e.zh : e.en;
		return /* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-quick-shape__item",
			title: n,
			"aria-label": n,
			onPointerDown: (e) => e.stopPropagation(),
			onClick: () => c(e.pointer),
			children: /* @__PURE__ */ r(le, { pointer: e.pointer })
		}, t);
	};
	return t(/* @__PURE__ */ i("div", {
		ref: d,
		className: "lakex-quick-shape",
		"data-lakex-quick-shape": !0,
		role: "dialog",
		"aria-label": u ? "选择图形" : "Choose shape",
		style: {
			left: f?.left ?? a.x,
			top: f?.top ?? a.y,
			width: Ct,
			maxHeight: wt,
			visibility: f ? "visible" : "hidden"
		},
		onPointerDown: (e) => e.stopPropagation(),
		children: [m.length > 0 && /* @__PURE__ */ i("section", {
			className: "lakex-quick-shape__section",
			children: [/* @__PURE__ */ r("div", {
				className: "lakex-quick-shape__title",
				children: u ? "最近使用" : "Recently used"
			}), /* @__PURE__ */ r("div", {
				className: "lakex-quick-shape__grid",
				children: m.map((e, t) => h(e, `recent-${e.pointer}-${t}`))
			})]
		}), Et.map((e) => {
			let t = H.find((t) => t.key === e);
			return t ? /* @__PURE__ */ i("section", {
				className: "lakex-quick-shape__section",
				children: [/* @__PURE__ */ r("div", {
					className: "lakex-quick-shape__title",
					children: u ? t.zh : t.en
				}), /* @__PURE__ */ r("div", {
					className: "lakex-quick-shape__grid",
					children: t.shapes.map((e, n) => h(e, `${t.key}-${e.pointer}-${n}`))
				})]
			}, t.key) : null;
		})]
	}), document.body);
}
//#endregion
//#region src/cards/DrawingBoard/DrawnixBoardCore.tsx
var Ot = "lake-notes-v3.board-recent-shapes", kt = 7, At = ".draw-toolbar, .lakex-shape-catalog, .lakex-material-library, .lakex-drawnix-export, [data-lakex-quick-shape], [data-lakex-ai-board]";
function jt() {
	try {
		let e = JSON.parse(window.localStorage.getItem(Ot) || "[]");
		return Array.isArray(e) ? e.filter((e) => typeof e == "string").slice(0, kt) : [];
	} catch {
		return [];
	}
}
function Mt(e) {
	try {
		window.localStorage.setItem(Ot, JSON.stringify(e));
	} catch {}
}
var Nt = (e) => {
	let t = [], n = (e) => {
		e.points?.forEach((e) => {
			Number.isFinite(e[0]) && Number.isFinite(e[1]) && t.push(e);
		}), e.children?.forEach(n);
	};
	if (e.forEach((e) => n(e)), !t.length) return null;
	let r = t.map((e) => e[0]), i = t.map((e) => e[1]), a = Math.min(...r), o = Math.max(...r), s = Math.min(...i), c = Math.max(...i);
	return {
		x: a,
		y: s,
		width: o - a,
		height: c - s
	};
}, Pt = (e, t, n) => {
	let r = e, i = { ...r };
	return r.points && (i.points = r.points.map(([e, r]) => [e + t, r + n])), r.children && (i.children = r.children.map((e) => Pt(e, t, n))), i;
}, Ft = (e, t) => {
	if (!e.children.length) return t;
	let n = Nt(t);
	if (!n) return t;
	let r = null;
	try {
		r = v(e, e.children, !0);
	} catch {
		r = Nt(e.children);
	}
	if (!r || !r.width && !r.height) return t;
	let i = r.x + r.width + 120 - n.x, a = r.y + r.height / 2 - (n.y + n.height / 2);
	return t.map((e) => Pt(e, i, a));
}, It = (e, t, n) => {
	let r = L(j.straight, [t, n], { marker: A.none }, { marker: A.arrow });
	p.insertNode(e, r, [e.children.length]);
}, Lt = {
	top: [.5, 0],
	right: [1, .5],
	bottom: [.5, 1],
	left: [0, .5]
}, Rt = (e, t) => {
	let [n, r] = e.points;
	switch (t) {
		case "top": return [(n[0] + r[0]) / 2, n[1]];
		case "right": return [r[0], (n[1] + r[1]) / 2];
		case "bottom": return [(n[0] + r[0]) / 2, r[1]];
		case "left": return [n[0], (n[1] + r[1]) / 2];
	}
}, zt = (e, t, n, r, i) => {
	let a = L(j.straight, [Rt(t, r), Rt(n, i)], {
		boundId: t.id,
		connection: Lt[r],
		marker: A.none
	}, {
		boundId: n.id,
		connection: Lt[i],
		marker: A.arrow
	});
	p.insertNode(e, a, [e.children.length]);
}, Bt = .8, Vt = (e, t) => [t[0] + (e[0] - t[0]) * Bt, t[1] + (e[1] - t[1]) * Bt], Ht = (e, t, n, r) => {
	let i = R(e, t, n), a = D(r, w.center, { "font-size": "12" }), o;
	if ("cells" in i && Array.isArray(i.cells) && i.cells[0]) {
		let e = i.cells.map((e, t) => t === 0 ? {
			...e,
			text: a
		} : e);
		o = {
			...i,
			cells: e
		};
	} else if ("texts" in i && Array.isArray(i.texts)) {
		let e = i.texts.map((e, t) => t === 0 ? {
			...e,
			text: a
		} : e);
		o = {
			...i,
			texts: e
		};
	} else o = {
		...i,
		text: a
	};
	return p.insertNode(e, o, [e.children.length]), o;
}, Ut = (e, t, n) => {
	let r = n === "zh-CN";
	if (t === "flowchart") {
		let t = (e) => Vt(e, [540, 370]), n = Ht(e, [t([460, 120]), t([620, 180])], P.terminal, r ? "开始" : "Start"), i = Ht(e, [t([460, 250]), t([620, 320])], P.process, r ? "处理" : "Process"), a = Ht(e, [t([460, 390]), t([620, 490])], P.decision, r ? "判断" : "Decision"), o = Ht(e, [t([460, 560]), t([620, 620])], P.terminal, r ? "结束" : "End");
		zt(e, n, i, "bottom", "top"), zt(e, i, a, "bottom", "top"), zt(e, a, o, "bottom", "top");
		return;
	}
	if (t === "uml") {
		let t = (e) => Vt(e, [625, 315]), n = Ht(e, [t([230, 245]), t([350, 365])], I.actor, r ? "用户" : "User"), i = Ht(e, [t([470, 260]), t([670, 350])], I.useCase, r ? "提交申请" : "Submit request"), a = Ht(e, [t([790, 205]), t([1020, 405])], I.class, r ? "申请服务" : "Request service");
		zt(e, n, i, "right", "left"), zt(e, i, a, "right", "left");
		return;
	}
	if (t === "mindmap") {
		let t = B(e, [600, 320]);
		t.data.topic = D(r ? "主题" : "Topic", void 0, { "font-size": "14" }), t.children = [
			ae(D(r ? "需求" : "Requirements", void 0, { "font-size": "12" }), {}),
			ae(D(r ? "方案" : "Solution", void 0, { "font-size": "12" }), {}),
			ae(D(r ? "计划" : "Plan", void 0, { "font-size": "12" }), {})
		], t.rightNodeCount = t.children.length, z.insertMind(e, t);
	}
};
function Wt(t) {
	let [n, r] = e.useState(() => typeof window < "u" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	return e.useEffect(() => {
		if (!t || typeof window > "u") return;
		let e = window.matchMedia("(prefers-color-scheme: dark)"), n = () => r(e.matches);
		return n(), e.addEventListener?.("change", n), () => e.removeEventListener?.("change", n);
	}, [t]), n;
}
function Gt({ value: t, readOnly: o, locale: s, theme: m, ai: ee, onChange: _, onViewportPersist: v, fitOnInit: b }) {
	let w = e.useRef(null), E = e.useRef(null), D = e.useRef(null), A = e.useRef(!1), [j, P] = e.useState(null);
	e.useEffect(() => {
		j && (j.options.readonly = !!o);
	}, [j, o]);
	let [I, L] = e.useState(!1), [R, ne] = e.useState(null), [B, ae] = e.useState(!1), [V, H] = e.useState(null), [le, de] = e.useState(() => jt()), pe = e.useRef(null);
	e.useEffect(() => {
		if (!j || o) return;
		let e = (e) => e instanceof Element && !!e.closest(At), t = (t) => {
			if (t.button !== 0 || e(t.target)) {
				pe.current = null;
				return;
			}
			pe.current = {
				ids: new Set(j.children.map((e) => e.id)),
				selectionMode: l.getPointer(j) === d.selection
			};
		}, n = (t) => {
			let n = pe.current;
			pe.current = null, n?.selectionMode && !e(t.target) && window.setTimeout(() => {
				let e = E.current;
				if (!e || e !== j) return;
				let r = e.children.filter((e) => {
					let t = e;
					return !n.ids.has(t.id) && F.isGeometry(t) && !F.isText(t);
				});
				r.length === 1 && H({
					x: t.clientX,
					y: t.clientY,
					elementId: r[0].id
				});
			}, 0);
		};
		return document.addEventListener("pointerdown", t, !0), document.addEventListener("pointerup", n, !0), () => {
			document.removeEventListener("pointerdown", t, !0), document.removeEventListener("pointerup", n, !0);
		};
	}, [j, o]), e.useEffect(() => {
		if (j && !o) return ie(j, {
			hoverPreview: !1,
			requestShapeChoice: (e) => {
				H({
					x: e.clientX,
					y: e.clientY,
					commit: (t) => e.commit(t),
					sourceShape: e.shapeElement.shape
				});
			}
		}), () => ie(j, null);
	}, [j, o]);
	let U = e.useCallback((e) => {
		de((t) => {
			let n = [e, ...t.filter((t) => t !== e)].slice(0, kt);
			return Mt(n), n;
		});
	}, []), W = e.useCallback((e) => {
		let t = V;
		if (H(null), !t) return;
		let n = e;
		if (t.commit) t.commit(n);
		else if (t.elementId) {
			let e = E.current;
			if (e) {
				let r = e.children.find((e) => e.id === t.elementId);
				r && (g(e), h(e, r), N.switchGeometryShape(e, n), re(e, n));
			}
		}
		U(e);
	}, [V, U]), me = e.useCallback(() => {
		let e = V;
		H(null), e?.commit?.();
	}, [V]), G = e.useRef(!1), he = e.useRef(null), ge = e.useRef(0), K = e.useRef(null), q = e.useRef(null), J = e.useRef(null), _e = e.useRef(null), ve = Wt(m === "system"), ye = m === "dark" || m === "system" && ve, be = ye ? f.dark : f.default, xe = s === "zh-CN" ? "zh" : "en";
	e.useEffect(() => () => {
		J.current?.(), J.current = null;
	}, []), e.useEffect(() => {
		E.current && c.updateThemeColor(E.current, be);
	}, [be]), e.useEffect(() => {
		if (!j || o || typeof window > "u") return;
		let e = (e) => {
			let t = w.current, n = e.composedPath();
			if (t && n.some((e) => e instanceof Node && t.contains(e))) {
				A.current = !0;
				return;
			}
			n.some((e) => e instanceof Element && !!e.closest(".plait-board-attached")) || (A.current = !1);
		}, t = (e) => {
			if (e.key !== "Delete" && e.key !== "Backspace" || !A.current && !l.isFocus(j)) return;
			let t = e.target instanceof Element ? e.target : null, n = w.current, r = t?.closest("input, textarea, select, [contenteditable=\"true\"]");
			t?.matches("input, textarea, select") || r && n?.contains(r) || (e.preventDefault(), e.stopImmediatePropagation(), j.globalKeyDown(e), j.keyDown(e));
		};
		return window.addEventListener("pointerdown", e, !0), window.addEventListener("keydown", t, !0), () => {
			window.removeEventListener("pointerdown", e, !0), window.removeEventListener("keydown", t, !0), A.current = !1;
		};
	}, [j, o]), e.useEffect(() => {
		I && document.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: !0
		}));
	}, [I]);
	let Y = t?.plaitValue || [], we = JSON.stringify(Y), [Te, Ee] = e.useState(Y), De = e.useRef(we), Oe = e.useRef(/* @__PURE__ */ new Set()), ke = t?.plaitViewport;
	e.useEffect(() => {
		we !== De.current && (Oe.current.delete(we) || (De.current = we, Ee(Y)));
	}, [Y, we]);
	let Ae = e.useCallback((e) => {
		if (!_ || typeof window > "u") return;
		he.current !== null && window.clearTimeout(he.current);
		let t = ++ge.current;
		he.current = window.setTimeout(() => {
			C(e, { padding: 16 }).then((e) => {
				t === ge.current && e && _({ previewImage: e });
			}).catch(() => {});
		}, 250);
	}, [_]);
	e.useEffect(() => () => {
		he.current !== null && window.clearTimeout(he.current), K.current !== null && window.cancelAnimationFrame(K.current), q.current !== null && window.cancelAnimationFrame(q.current);
	}, []);
	let je = (e) => {
		G.current || (G.current = !0, window.setTimeout(() => {
			G.current = !1;
			for (let t of e.children) {
				let n = t;
				n.shape === M.text && n.autoSize !== !0 && p.setNode(e, { autoSize: !0 }, l.findPath(e, t));
			}
		}, 0));
	}, Me = e.useCallback(() => {
		let e = E.current;
		!e || typeof window > "u" || window.setTimeout(() => {
			window.requestAnimationFrame(() => {
				let t = document.querySelector(".popup-font-size__input"), n = Number(t?.value);
				!Number.isFinite(n) || n <= 0 || (x(e).forEach((t) => {
					let r = O(t);
					if (!r.length) return;
					let i = t.data?.topic ?? t.text, a = i ? se.getMarksByElement(i) : {}, o = 14;
					try {
						o = oe(t) ?? o;
					} catch {}
					Number(a["font-size"] ?? o) !== n && ce.setFontSize(e, String(n), o, r);
				}), window.requestAnimationFrame(() => {
					x(e).forEach((e) => {
						te(e).forEach((e) => e.updateRectangle());
					});
				}));
			});
		}, 0);
	}, []);
	e.useEffect(() => {
		if (!j) return;
		let e = (e) => !!(e instanceof Element ? e : null)?.closest(".popup-font-size, .popup-font-size__stepper-button"), t = (t) => {
			e(t.target) && Me();
		}, n = (t) => {
			e(t.target) && Me();
		}, r = (t) => {
			t.key === "Enter" && e(t.target) && Me();
		};
		return document.addEventListener("pointerup", t, !0), document.addEventListener("blur", n, !0), document.addEventListener("keydown", r, !0), () => {
			document.removeEventListener("pointerup", t, !0), document.removeEventListener("blur", n, !0), document.removeEventListener("keydown", r, !0);
		};
	}, [j, Me]);
	let Ne = (e) => {
		let t = (e instanceof Element ? e : null)?.closest(".draw-toolbar [title]");
		return t?.getAttribute("title") === "形状" || t?.getAttribute("title") === "Shape";
	}, Pe = (e) => {
		let t = e instanceof Element ? e : e instanceof Node ? e.parentElement : null;
		return t?.closest(".plait-board-container") ? !t.closest(".draw-toolbar, .plait-board-attached, [role=dialog], [data-lakex-shape-catalog]") : !1;
	}, Fe = (e, t) => {
		let n = E.current;
		if (!n) return null;
		let r = l.getBoardContainer(n).getBoundingClientRect(), i = S(n) ?? [0, 0], a = n.viewport.zoom || 1;
		return [i[0] + (e - r.left) / a, i[1] + (t - r.top) / a];
	}, Ie = () => R ? Fe(R.x, R.y) : null, Le = () => {
		let e = E.current, t = Ie();
		e && t && N.insertText(e, t, s === "zh-CN" ? "文本" : "Text");
	}, X = () => {
		let e = E.current, t = Ie();
		e && t && N.insertGeometry(e, [t, [t[0] + 160, t[1] + 88]], M.roundRectangle);
	}, Re = () => {
		let e = E.current, t = Ie();
		e && t && It(e, t, [t[0] + 180, t[1]]);
	}, Z = () => {
		let e = E.current;
		e && c.updateViewport(e, S(e) ?? [0, 0], 1);
	}, Q = (e, t) => {
		let n = E.current, r = Fe(e, t);
		if (!n || !r) return !1;
		if (!x(n).length) {
			let e = y(n, r);
			e && (g(n), h(n, e));
		}
		return D.current?.captureSelection() ?? x(n).length > 0;
	}, $ = e.useCallback((e, t) => {
		let n = E.current;
		if (!n || !e.length) return;
		let r = t === "append" ? Ft(n, e) : e;
		g(n), u.withNewBatch(n, () => {
			if (t === "replace") for (let e = n.children.length - 1; e >= 0; --e) p.removeNode(n, [e]);
			r.forEach((e) => {
				e.type === "mind" || e.type === "mindmap" ? z.insertMind(n, e) : p.insertNode(n, e, [n.children.length]);
			});
		}), window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				E.current === n && c.fitViewport(n);
			});
		});
	}, []);
	return /* @__PURE__ */ i("div", {
		ref: w,
		className: `lakex-drawnix-core ${o ? "lakex-drawnix-core--readonly" : ""}`,
		"data-theme": ye ? "dark" : "light",
		"data-prevent-swipe": !0,
		onPointerDownCapture: (e) => {
			if (e.button === 2 && Pe(e.target)) {
				e.preventDefault(), e.stopPropagation(), Q(e.clientX, e.clientY);
				return;
			}
			if (Ne(e.target)) {
				e.preventDefault(), e.stopPropagation(), E.current && (p.setSelection(E.current, null), k(E.current, T.drawing), c.updatePointerType(E.current, M.rectangle)), L((e) => !e);
				return;
			}
			let t = e.target;
			I && !t?.closest("[data-lakex-shape-catalog]") && L(!1);
		},
		onClickCapture: (e) => {
			Ne(e.target) && (e.preventDefault(), e.stopPropagation());
		},
		onContextMenuCapture: (e) => {
			Pe(e.target) && (e.preventDefault(), e.stopPropagation(), A.current = !0, ae(Q(e.clientX, e.clientY)), L(!1), ne({
				x: e.clientX,
				y: e.clientY
			}));
		},
		onKeyDownCapture: (e) => {
			if (e.key !== "Enter" && e.key !== "Backspace" && e.key !== "Delete" || !e.target?.closest(".slate-editable-container")) return;
			let t = E.current, n = t?.viewport.origination ?? (t ? S(t) : null);
			if (t && n) {
				let e = l.getBoardContainer(t), r = l.getHost(t), i = e.matches(".viewport-container") ? e : e.querySelector(".viewport-container");
				_e.current = {
					board: t,
					origination: [...n],
					zoom: t.viewport.zoom,
					host: r,
					hostViewBox: r.getAttribute("viewBox"),
					hostWidth: r.style.width,
					hostHeight: r.style.height,
					viewportContainer: i,
					scrollLeft: i?.scrollLeft ?? 0,
					scrollTop: i?.scrollTop ?? 0
				};
			}
		},
		onKeyDown: (e) => {
			let t = e.target?.closest(".slate-editable-container, input, textarea, select"), n = !!t && !!w.current?.contains(t);
			if ((e.key === "Delete" || e.key === "Backspace") && n && e.stopPropagation(), (e.key === "Enter" || e.key === "Backspace" || e.key === "Delete") && n) {
				e.key === "Enter" && (e.stopPropagation(), e.nativeEvent.stopImmediatePropagation());
				let t = _e.current;
				if (_e.current = null, t && typeof window < "u") {
					J.current?.();
					let e = () => {
						if (E.current !== t.board) return;
						let e = t.board.viewport.origination ?? S(t.board);
						(!e || Math.abs(e[0] - t.origination[0]) > .01 || Math.abs(e[1] - t.origination[1]) > .01 || Math.abs(t.board.viewport.zoom - t.zoom) > .001) && c.updateViewport(t.board, t.origination, t.zoom);
						let { host: n } = t;
						t.hostViewBox === null ? n.hasAttribute("viewBox") && n.removeAttribute("viewBox") : n.getAttribute("viewBox") !== t.hostViewBox && n.setAttribute("viewBox", t.hostViewBox), n.style.width !== t.hostWidth && (n.style.width = t.hostWidth), n.style.height !== t.hostHeight && (n.style.height = t.hostHeight), t.viewportContainer && (Math.abs(t.viewportContainer.scrollLeft - t.scrollLeft) > .5 && (t.viewportContainer.scrollLeft = t.scrollLeft), Math.abs(t.viewportContainer.scrollTop - t.scrollTop) > .5 && (t.viewportContainer.scrollTop = t.scrollTop));
					}, n = new MutationObserver(e);
					n.observe(t.host, {
						attributes: !0,
						attributeFilter: ["viewBox", "style"]
					}), window.queueMicrotask(e);
					let r = !0, i = null, a = null, o = () => {
						r && (e(), i = window.requestAnimationFrame(o));
					};
					i = window.requestAnimationFrame(o);
					let s = () => {
						r && (r = !1, n.disconnect(), i !== null && window.cancelAnimationFrame(i), a !== null && window.clearTimeout(a));
					};
					a = window.setTimeout(() => {
						e(), s(), J.current === s && (J.current = null);
					}, 360), J.current = s;
				}
			}
		},
		onKeyUp: (e) => {
			if (e.key !== "Enter" && e.key !== "Backspace" && e.key !== "Delete") return;
			let t = e.target?.closest(".slate-editable-container, input, textarea, select");
			t && w.current?.contains(t) && (e.stopPropagation(), e.nativeEvent.stopImmediatePropagation());
		},
		children: [/* @__PURE__ */ r(a, {
			value: Te,
			viewport: ke,
			theme: { themeColorMode: be },
			initialLanguage: xe,
			initialToolState: { pointer: d.selection },
			tutorial: !1,
			afterInit: (e) => {
				E.current = e, P(e), e.options.readonly = !!o, c.updateThemeColor(e, be);
				let n = t?.preset;
				!o && n && n !== "drawing" && !t?.presetInitialized && e.children.length === 0 ? K.current = window.requestAnimationFrame(() => {
					K.current = null, !(E.current !== e || e.children.length > 0) && (Ut(e, n, s), _?.({ presetInitialized: !0 }), q.current = window.requestAnimationFrame(() => {
						q.current = null, E.current === e && c.fitViewport(e);
					}));
				}) : b && t?.plaitViewport == null && e.children.length > 0 && (q.current = window.requestAnimationFrame(() => {
					q.current = null, E.current === e && e.children.length > 0 && c.fitViewport(e);
				})), je(e), Ae(e);
			},
			onChange: () => {
				E.current && je(E.current);
			},
			onValueChange: (e) => {
				let t = JSON.stringify(e);
				De.current = t;
				let n = Oe.current;
				if (n.add(t), n.size > 50) {
					let e = n.values().next().value;
					e && n.delete(e);
				}
				Ee(e), E.current && (je(E.current), Ae(E.current)), _?.({
					version: 2,
					engine: "drawnix",
					plaitValue: e
				});
			},
			onViewportChange: (e) => {
				v?.(e);
			}
		}, xe), !o && /* @__PURE__ */ i(n, { children: [
			/* @__PURE__ */ r(ue, {
				board: j,
				locale: s,
				open: I,
				onClose: () => L(!1)
			}),
			/* @__PURE__ */ r(Se, {
				ref: D,
				board: j,
				locale: s,
				dark: ye,
				toolbarHost: w.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null,
				onOpen: () => L(!1)
			}),
			/* @__PURE__ */ r(St, {
				ai: ee,
				board: j,
				locale: s,
				dark: ye,
				toolbarHost: w.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null,
				overlayHost: w.current,
				onOpen: () => L(!1),
				onApply: $
			}),
			/* @__PURE__ */ r(fe, {
				board: j,
				locale: s,
				toolbarHost: w.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null
			}),
			/* @__PURE__ */ r(Ce, {
				board: j,
				locale: s,
				dark: ye,
				hasContextSelection: B,
				position: R,
				onClose: () => {
					ne(null), ae(!1);
				},
				onAddText: Le,
				onAddShape: X,
				onAddLine: Re,
				onFitToCanvas: () => {
					E.current && c.fitViewport(E.current);
				},
				onActualSize: Z,
				onAddToMaterialLibrary: () => D.current?.addSelectionToLibrary() ?? !1
			}),
			V && /* @__PURE__ */ r(Dt, {
				locale: s,
				anchor: {
					x: V.x,
					y: V.y
				},
				recent: le,
				sourceShape: V.sourceShape,
				onPick: W,
				onClose: me
			})
		] })]
	});
}
//#endregion
export { Gt as default };
