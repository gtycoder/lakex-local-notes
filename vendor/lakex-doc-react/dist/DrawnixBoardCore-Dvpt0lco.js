import e from "react";
import { createPortal as t } from "react-dom";
import { Fragment as n, jsx as r, jsxs as i } from "react/jsx-runtime";
import { Drawnix as a, saveAsPng as o, saveAsSvg as s } from "lakex-drawnix";
import { BoardTransforms as c, PlaitBoard as l, PlaitHistoryBoard as u, PlaitPointerType as d, ThemeColorMode as f, Transforms as p, WritableClipboardOperationType as m, addSelectedElement as h, clearSelectedElement as g, deleteTemporaryElements as ee, duplicateElements as _, getBoundingRectangleByElements as te, getHitElementByPoint as v, getRectangleByElements as y, getSelectedElements as b, getViewportOrigination as x, toImage as S } from "@plait/core";
import { Alignment as C, BoardCreationMode as w, StrokeStyle as T, buildText as E, getTextEditorsByElement as D, getTextManages as ne, setCreationMode as O } from "@plait/common";
import { ArrowLineMarkerType as k, ArrowLineShape as A, BasicShapes as j, DrawTransforms as M, FlowchartSymbols as N, PlaitDrawElement as P, UMLSymbols as F, createArrowLineElement as I, createDefaultGeometry as L, createGeometryElement as R, memorizeLatestShape as re, setAutoCompleteCommitHost as ie } from "@plait/draw";
import { MindTransforms as ae, createEmptyMind as oe, createMindElement as z, getDefaultFontSizeForMindElement as B } from "@plait/mind";
import { PlaitMarkEditor as se, TextTransforms as ce } from "@plait/text-plugins";
// src/cards/DrawingBoard/LakexShapeCatalog.tsx
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
			V(j.rectangle, "矩形", "Rectangle"),
			V(j.roundRectangle, "圆角矩形", "Rounded rectangle"),
			V(j.ellipse, "圆形", "Ellipse"),
			V(j.triangle, "三角形", "Triangle"),
			V(j.diamond, "菱形", "Diamond"),
			V(j.parallelogram, "平行四边形", "Parallelogram"),
			V(j.trapezoid, "梯形", "Trapezoid"),
			V(j.cross, "十字", "Cross"),
			V(j.pentagon, "五边形", "Pentagon"),
			V(j.hexagon, "六边形", "Hexagon"),
			V(j.octagon, "八边形", "Octagon"),
			V(j.star, "星形", "Star"),
			V(j.leftArrow, "左箭头", "Left arrow"),
			V(j.rightArrow, "右箭头", "Right arrow"),
			V(j.twoWayArrow, "双向箭头", "Two-way arrow"),
			V(j.comment, "标注", "Callout"),
			V(j.roundComment, "圆角标注", "Rounded callout"),
			V(j.cloud, "云形", "Cloud")
		]
	},
	{
		key: "flowchart",
		zh: "流程图",
		en: "Flowchart",
		shapes: [
			V(N.process, "流程", "Process"),
			V(N.terminal, "开始/结束", "Start / End"),
			V(N.decision, "判断", "Decision"),
			V(N.data, "数据", "Data"),
			V(N.connector, "连接符", "Connector"),
			V(N.manualInput, "手动输入", "Manual input"),
			V(N.preparation, "准备", "Preparation"),
			V(N.predefinedProcess, "子流程", "Subprocess"),
			V(N.document, "文档", "Document"),
			V(N.multiDocument, "多文档", "Multiple documents"),
			V(N.database, "数据库", "Database"),
			V(N.internalStorage, "内部存储", "Internal storage"),
			V(N.delay, "延迟", "Delay"),
			V(N.display, "显示", "Display"),
			V(N.offPage, "页外连接", "Off-page connector"),
			V(N.noteSquare, "注释", "Note")
		]
	},
	{
		key: "smart",
		zh: "Smart",
		en: "Smart",
		shapes: [
			V(F.actor, "角色", "Actor"),
			V(F.useCase, "用例", "Use case"),
			V(F.component, "组件", "Component"),
			V(F.container, "容器", "Container"),
			V(F.note, "便签", "Note"),
			V(F.package, "包", "Package")
		]
	},
	{
		key: "uml",
		zh: "UML",
		en: "UML",
		shapes: [
			V(F.simpleClass, "简单类", "Simple class"),
			V(F.class, "类", "Class"),
			V(F.interface, "接口", "Interface"),
			V(F.object, "对象", "Object"),
			V(F.componentBox, "组件框", "Component box"),
			V(F.activityClass, "活动", "Activity"),
			V(F.branchMerge, "分支/合并", "Branch / Merge"),
			V(F.port, "端口", "Port"),
			V(F.combinedFragment, "组合片段", "Combined fragment"),
			V(F.template, "模板", "Template"),
			V(F.activation, "激活", "Activation"),
			V(F.deletion, "销毁", "Deletion")
		]
	},
	{
		key: "er",
		zh: "ER",
		en: "ER",
		shapes: [
			V(j.rectangle, "实体", "Entity"),
			V(j.roundRectangle, "弱实体", "Weak entity"),
			V(j.diamond, "关系", "Relationship"),
			V(j.ellipse, "属性", "Attribute"),
			V(j.parallelogram, "关联实体", "Associative entity"),
			V(F.class, "实体明细", "Entity details")
		]
	}
];
function U({ pointer: e }) {
	switch (String(e)) {
		case j.rectangle: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case j.roundRectangle: return /* @__PURE__ */ r("svg", {
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
		case j.ellipse: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "16",
				rx: "9",
				ry: "9"
			})
		});
		case j.triangle: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 8L25 24L7 24Z" })
		});
		case j.diamond: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case j.parallelogram: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 9L27 9L21 23L5 23Z" })
		});
		case j.trapezoid: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M9 10L23 10L26 22L6 22Z" })
		});
		case j.cross: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M18.8 7C19.5 7 20.1 7.5 20.1 8.2V11.9H23.8C24.5 11.9 25 12.4 25 13.1V18.9C25 19.6 24.5 20.1 23.8 20.1H20.1V23.8C20.1 24.5 19.5 25 18.8 25H13.1C12.4 25 11.9 24.5 11.9 23.8V20.1H8.2C7.5 20.1 7 19.6 7 18.9V13.1C7 12.4 7.5 11.9 8.2 11.9H11.9V8.2C11.9 7.5 12.4 7 13.1 7Z" })
		});
		case j.pentagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25.1 13.6L21.6 24.4H10.4L6.9 13.6Z" })
		});
		case j.hexagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 8H21L26 16L21 24H11L6 16Z" })
		});
		case j.octagon: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 7H21L25 11V21L21 25H11L7 21V11Z" })
		});
		case j.star: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 6L18.5 12.5L25.5 13L20 17.5L21.8 24.5L16 20.5L10.2 24.5L12 17.5L6.5 13L13.5 12.5Z" })
		});
		case j.leftArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 16L16 7V12H25V20H16V25Z" })
		});
		case j.rightArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M25 16L16 25V20H7V12H16V7Z" })
		});
		case j.twoWayArrow: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 16L13 10V14H19V10L25 16L19 22V18H13V22Z" })
		});
		case j.comment: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 8H26V19H14L9 24V19H6Z" })
		});
		case j.roundComment: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 12C6 9.8 7.8 8 10 8H22C24.2 8 26 9.8 26 12V17C26 19.2 24.2 21 22 21H14L9 25V21H10C7.8 21 6 19.2 6 17Z" })
		});
		case j.cloud: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M9 22C6.8 22 5 20.2 5 18C5 16.1 6.3 14.5 8.1 14.1C8 13.8 8 13.4 8 13C8 10.2 10.2 8 13 8C14.5 8 15.8 8.7 16.7 9.7C17.6 8.6 19 8 20.5 8C23.5 8 26 10.5 26 13.5C26 13.7 26 13.8 26 14C27.7 14.5 29 16.1 29 18C29 20.2 27.2 22 25 22Z" })
		});
		case N.process: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case N.terminal: return /* @__PURE__ */ r("svg", {
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
		case N.decision: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case N.data: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M11 9L27 9L21 23L5 23Z" })
		});
		case N.connector: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("circle", {
				cx: "16",
				cy: "16",
				r: "8"
			})
		});
		case N.manualInput: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 12L26 8L26 24H6Z" })
		});
		case N.preparation: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M10 8H22L27 16L22 24H10L5 16Z" })
		});
		case N.predefinedProcess: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "7",
				y: "8",
				width: "18",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M10 8V24M22 8V24" })]
		});
		case N.document: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 8H25V20C25 20 22 24 16 20C10 16 7 24 7 24Z" })
		});
		case N.multiDocument: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("path", { d: "M9 10H25V20C25 20 22 24 17 20V22C17 22 14 26 9 22Z" }), /* @__PURE__ */ r("path", { d: "M7 6H23V10H9V18C7 18 7 16.5 7 16.5Z" })]
		});
		case N.database: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "9",
				rx: "9",
				ry: "3.5"
			}), /* @__PURE__ */ r("path", { d: "M7 9V23C7 25 11 26.5 16 26.5S25 25 25 23V9M7 16C7 18 11 19.5 16 19.5S25 18 25 16" })]
		});
		case N.internalStorage: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "7",
				y: "8",
				width: "18",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M7 10H25M9 8V24" })]
		});
		case N.delay: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M6 8H21A5 8 0 0 1 21 24H6Z" })
		});
		case N.display: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M8 8H26A3 8 0 0 1 26 24H8L4 16Z" })
		});
		case N.offPage: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M7 8H25V18L16 25L7 18Z" })
		});
		case N.noteSquare: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M12 8H8V24H12" })
		});
		case F.actor: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("circle", {
				cx: "16",
				cy: "6",
				r: "3"
			}), /* @__PURE__ */ r("path", { d: "M16 9V18M9 13H23M16 18L10 27M16 18L22 27" })]
		});
		case F.useCase: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("ellipse", {
				cx: "16",
				cy: "16",
				rx: "11",
				ry: "8"
			})
		});
		case F.component: return /* @__PURE__ */ i("svg", {
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
		case F.container: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "4",
				y: "8",
				width: "24",
				height: "16"
			}), /* @__PURE__ */ r("path", { d: "M11 8V24" })]
		});
		case F.note: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("path", { d: "M6 6H20L26 12V26H6ZM20 6V12H26" }), /* @__PURE__ */ r("path", { d: "M10 16H22M10 21H18" })]
		});
		case F.package: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M4 10H14L17 13H28V26H4ZM4 10V6H14L17 10" })
		});
		case F.simpleClass: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			})
		});
		case F.class: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "5",
				width: "20",
				height: "22"
			}), /* @__PURE__ */ r("path", { d: "M6 11H26M6 18H26" })]
		});
		case F.interface: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			}), /* @__PURE__ */ r("path", { d: "M6 13H26" })]
		});
		case F.object: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			})
		});
		case F.componentBox: return /* @__PURE__ */ i("svg", {
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
		case F.activityClass: return /* @__PURE__ */ i("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ r("rect", {
				x: "6",
				y: "6",
				width: "20",
				height: "20"
			}), /* @__PURE__ */ r("path", { d: "M8.5 6V26M23.5 6V26" })]
		});
		case F.branchMerge: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("path", { d: "M16 7L25 16L16 25L7 16Z" })
		});
		case F.port: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "8",
				y: "8",
				width: "16",
				height: "16"
			})
		});
		case F.combinedFragment: return /* @__PURE__ */ i("svg", {
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
		case F.template: return /* @__PURE__ */ r("svg", {
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
		case F.activation: return /* @__PURE__ */ r("svg", {
			viewBox: "0 0 32 32",
			"aria-hidden": "true",
			children: /* @__PURE__ */ r("rect", {
				x: "12",
				y: "6",
				width: "8",
				height: "20"
			})
		});
		case F.deletion: return /* @__PURE__ */ r("svg", {
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
function le({ board: t, locale: n, open: a, onClose: o }) {
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
								t && (O(t, w.drawing), c.updatePointerType(t, e.pointer), o());
							},
							children: /* @__PURE__ */ r(U, { pointer: e.pointer })
						}, `${e.pointer}-${n}`);
					})
				})]
			}, e.key))
		})]
	}) : null;
}
// src/cards/DrawingBoard/LakexExportMenu.tsx
var ue = () => /* @__PURE__ */ r("svg", {
	viewBox: "0 0 24 24",
	"aria-hidden": "true",
	children: /* @__PURE__ */ r("path", { d: "M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" })
});
function de({ board: n, locale: a, toolbarHost: c }) {
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
			children: /* @__PURE__ */ r(ue, {})
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
// src/cards/DrawingBoard/materialTemplates.ts
var fe = {
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
}, W = (e, t, n, r, i, a, o = "blue", s = "13") => R(e, [[t, n], [t + r, n + i]], a, {
	fill: fe[o].fill,
	strokeColor: fe[o].stroke,
	strokeWidth: 1.5
}, {
	"font-size": s,
	color: "#273142"
}), G = (e, t, n = "#697586", r = k.arrow) => I(A.straight, [e, t], { marker: k.none }, { marker: r }, void 0, {
	strokeColor: n,
	strokeWidth: 1.5
}), pe = (e, t, n, r) => R(j.text, [[e, t], [e + n, t + 26]], r, void 0, {
	"font-size": "14",
	color: "#273142"
}), K = (e, t, n) => e === "zh-CN" ? t : n, me = [
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
				K(e, "需求调研", "Research"),
				K(e, "方案设计", "Design"),
				K(e, "灰度发布", "Beta"),
				K(e, "正式发布", "Launch")
			], n = [
				"blue",
				"purple",
				"orange",
				"green"
			], r = [pe(-250, -120, 200, K(e, "产品里程碑", "Product milestones")), G([-210, 10], [245, 10], "#94A3B8", k.arrow)];
			return t.forEach((e, t) => {
				let i = -230 + t * 145;
				r.push(W(j.ellipse, i, -12, 44, 44, "", n[t]), W(j.roundRectangle, i - 35, 62, 114, 48, e, n[t], "12"), G([i + 22, 32], [i + 22, 62], "#94A3B8", k.none));
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
					K(e, "访问层", "Client"),
					[
						"Web",
						"Mobile",
						"API"
					],
					"blue"
				],
				[
					K(e, "服务层", "Services"),
					[
						K(e, "用户服务", "User"),
						K(e, "业务服务", "Business"),
						K(e, "消息服务", "Message")
					],
					"purple"
				],
				[
					K(e, "数据层", "Data"),
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
				n.push(pe(-280, o + 20, 90, e)), r.forEach((e, r) => {
					let s = -155 + r * 150;
					n.push(W(j.roundRectangle, s, o, 120, 54, e, i, "11")), a < t.length - 1 && n.push(G([s + 60, o + 54], [s + 60, o + 81], "#8993A4"));
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
				K(e, "客户端", "Client"),
				"API Gateway",
				K(e, "鉴权服务", "Auth"),
				K(e, "业务服务", "Service"),
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
				r.push(W(j.roundRectangle, a, -30, 125, 60, e, n[i], "11")), i < t.length - 1 && r.push(G([a + 125, 0], [a + 170, 0]));
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
				K(e, "提交代码", "Commit"),
				K(e, "构建镜像", "Build"),
				K(e, "自动化测试", "Test"),
				K(e, "部署发布", "Deploy")
			], n = [
				"blue",
				"purple",
				"orange",
				"green"
			], r = [pe(-300, -110, 240, K(e, "CI/CD 发布流水线", "CI/CD pipeline"))];
			return t.forEach((e, i) => {
				let a = -290 + i * 195;
				r.push(W(N.process, a, -15, 145, 60, e, n[i], "11")), i < t.length - 1 && r.push(G([a + 145, 15], [a + 195, 15]));
			}), r;
		}
	},
	{
		id: "database-er-model",
		categories: ["hot", "technology"],
		zh: "数据库 ER 图",
		en: "Database ER diagram",
		build: (e) => {
			let t = K(e, "用户\nid\nname", "User\nid\nname"), n = K(e, "订单\nid\nuser_id", "Order\nid\nuser_id"), r = K(e, "订单明细\nid\norder_id", "Order item\nid\norder_id");
			return [
				W(j.rectangle, -300, -54, 130, 108, t, "blue", "11"),
				W(j.rectangle, -65, -54, 130, 108, n, "purple", "11"),
				W(j.rectangle, 170, -54, 130, 108, r, "green", "11"),
				G([-170, 0], [-65, 0], "#7A8699", k.none),
				G([65, 0], [170, 0], "#7A8699", k.none)
			];
		}
	},
	{
		id: "frontend-module-map",
		categories: ["hot", "technology"],
		zh: "前端模块架构",
		en: "Frontend module map",
		build: (e) => {
			let t = K(e, "Web 应用", "Web app"), n = [
				K(e, "路由", "Router"),
				K(e, "页面模块", "Pages"),
				K(e, "状态管理", "State"),
				K(e, "组件库", "UI kit")
			], r = [
				"blue",
				"purple",
				"cyan",
				"green"
			], i = [W(j.roundRectangle, -75, -155, 150, 56, t, "indigo")];
			return n.forEach((e, t) => {
				let n = -300 + t * 165;
				i.push(W(j.roundRectangle, n, 20, 130, 52, e, r[t], "11"), G([0, -99], [n + 65, 20]));
			}), i;
		}
	},
	{
		id: "production-troubleshooting",
		categories: ["technology"],
		zh: "线上故障排查",
		en: "Production troubleshooting",
		build: (e) => {
			let t = K(e, "告警", "Alert"), n = [
				K(e, "服务状态", "Service health"),
				K(e, "日志与指标", "Logs & metrics"),
				K(e, "依赖服务", "Dependencies")
			], r = [
				W(N.terminal, -70, -155, 140, 52, t, "orange"),
				W(N.decision, -75, -55, 150, 82, K(e, "是否可复现？", "Reproducible?"), "yellow", "11"),
				G([0, -103], [0, -55])
			];
			return n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(W(j.roundRectangle, n, 100, 140, 50, e, [
					"blue",
					"purple",
					"green"
				][t], "11"), G([0, 27], [n + 70, 100]));
			}), r;
		}
	},
	{
		id: "idea-map",
		categories: ["thinking", "product"],
		zh: "产品创意图",
		en: "Product idea map",
		build: (e) => {
			let t = K(e, "产品创意", "Product idea"), n = [
				[
					-245,
					-140,
					K(e, "用户", "Users"),
					"blue"
				],
				[
					110,
					-140,
					K(e, "场景", "Scenarios"),
					"purple"
				],
				[
					-245,
					100,
					K(e, "价值", "Value"),
					"green"
				],
				[
					110,
					100,
					K(e, "风险", "Risks"),
					"orange"
				]
			], r = [W(j.ellipse, -72, -42, 144, 84, t, "yellow")];
			return n.forEach(([e, t, n, i]) => {
				r.push(W(j.roundRectangle, e, t, 135, 54, n, i), G([e < 0 ? e + 135 : e, t < 0 ? t + 54 : t], [e < 0 ? -62 : 62, t < 0 ? -25 : 25], "#8993A4", k.none));
			}), r;
		}
	},
	{
		id: "user-experience-map",
		categories: ["product", "thinking"],
		zh: "用户体验地图",
		en: "User experience map",
		build: (e) => {
			let t = K(e, "用户目标", "User goal"), n = [
				K(e, "认知", "Discover"),
				K(e, "使用", "Use"),
				K(e, "复购", "Return")
			], r = [W(j.ellipse, -86, -34, 172, 68, t, "yellow")];
			return n.forEach((e, t) => {
				let n = -280 + t * 190;
				r.push(W(j.roundRectangle, n, 100, 140, 52, e, [
					"blue",
					"purple",
					"green"
				][t])), r.push(G([0, 34], [n + 70, 100]));
			}), r;
		}
	},
	{
		id: "service-topology",
		categories: ["technology"],
		zh: "服务拓扑图",
		en: "Service topology",
		build: (e) => {
			let t = K(e, "客户端", "Client"), n = [
				"API",
				K(e, "用户服务", "User"),
				K(e, "订单服务", "Order")
			], r = [W(j.roundRectangle, -70, -170, 140, 52, t, "blue")];
			return n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(W(j.roundRectangle, n, -30, 140, 52, e, "purple"), G([0, -118], [n + 70, -30]));
			}), r.push(W(N.database, -70, 100, 140, 58, K(e, "数据库", "Database"), "green")), n.forEach((e, t) => {
				let n = -260 + t * 190;
				r.push(G([n + 70, 22], [0, 100]));
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
				K(e, "代码冻结", "Code freeze"),
				K(e, "自动化测试", "Automated tests"),
				K(e, "灰度发布", "Canary release"),
				K(e, "全量上线", "Full release")
			];
			return t.flatMap((e, n) => {
				let r = -300 + n * 200;
				return [W(N.process, r, -30, 150, 60, e, n === 3 ? "green" : "gray"), ...n < t.length - 1 ? [G([r + 150, 0], [r + 200, 0])] : []];
			});
		}
	}
], he = "lakex-drawnix-custom-materials-v1", q = [
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
], ge = (e) => JSON.parse(JSON.stringify(e)), J = (e) => !e || typeof e != "object" ? "" : "text" in e && typeof e.text == "string" ? e.text : "children" in e && Array.isArray(e.children) ? e.children.map(J).join("") : "", Y = (e) => {
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
function _e({ element: e }) {
	let [t, n] = e.points, a = Math.min(t[0], n[0]), o = Math.min(t[1], n[1]), s = Math.abs(n[0] - t[0]), c = Math.abs(n[1] - t[1]), l = a + s / 2, u = o + c / 2, d = e.fill && e.fill !== "none" ? e.fill : "#fff", f = e.strokeColor || "#718096", p = J(e.text), m = {
		fill: d,
		stroke: f,
		strokeWidth: e.strokeWidth || 1.5
	}, h;
	if (e.shape === j.ellipse) h = /* @__PURE__ */ r("ellipse", {
		cx: l,
		cy: u,
		rx: s / 2,
		ry: c / 2,
		...m
	});
	else if (e.shape === j.diamond || e.shape === N.decision) h = /* @__PURE__ */ r("path", {
		d: `M ${l} ${o} L ${a + s} ${u} L ${l} ${o + c} L ${a} ${u} Z`,
		...m
	});
	else if (e.shape === j.triangle) h = /* @__PURE__ */ r("path", {
		d: `M ${l} ${o} L ${a + s} ${o + c} L ${a} ${o + c} Z`,
		...m
	});
	else {
		let t = e.shape === j.roundRectangle || e.shape === N.terminal;
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
function ve({ elements: e }) {
	let t = Y(e);
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
			if (e.type === "geometry") return /* @__PURE__ */ r(_e, { element: e }, e.id);
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
var ye = () => /* @__PURE__ */ i("svg", {
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
}), be = () => /* @__PURE__ */ r("svg", {
	viewBox: "0 0 24 24",
	"aria-hidden": "true",
	children: /* @__PURE__ */ r("path", { d: "M5 5l14 14M19 5 5 19" })
}), xe = () => {
	if (typeof window > "u") return [];
	try {
		let e = JSON.parse(window.localStorage.getItem(he) || "[]");
		return Array.isArray(e) ? e : [];
	} catch {
		return [];
	}
}, Se = (e) => {
	if (typeof window < "u") try {
		window.localStorage.setItem(he, JSON.stringify(e));
	} catch {}
}, Ce = {
	async load() {
		return xe();
	},
	async save({ name: e, elements: t, width: n, height: r }) {
		let i = xe(), a = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: e,
			createdAt: Date.now(),
			elements: t,
			...n === void 0 ? {} : { width: n },
			...r === void 0 ? {} : { height: r }
		};
		return Se([a, ...i]), a;
	},
	async remove(e) {
		Se(xe().filter((t) => t.id !== e));
	}
}, we = e.forwardRef(function({ board: a, locale: o, dark: s, toolbarHost: f, onOpen: h, materialStorage: _ }, te) {
	let v = _ ?? Ce, [S, C] = e.useState(!1), [T, E] = e.useState("recommended"), [D, ne] = e.useState("hot"), [k, A] = e.useState([]), [j, M] = e.useState(null), [N, P] = e.useState(null), [F, I] = e.useState(""), L = e.useRef(null), R = e.useRef(null), re = e.useRef(null), ie = e.useRef(null), ae = e.useRef({}), oe = e.useRef(null), z = o === "zh-CN", B = z ? {
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
		openFolder: "打开素材文件夹",
		folderHint: "素材保存在本机文件夹，可自行拷贝/放置画板文档",
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
		openFolder: "Open materials folder",
		folderHint: "Materials live in a local folder you can copy or drop board documents into",
		nameDialogTitle: "Add to material library",
		nameDialogHint: "Name this custom material",
		namePlaceholder: "Enter a material name",
		cancel: "Cancel",
		confirm: "Add"
	};
	e.useEffect(() => {
		if (!S) return;
		let e = (e) => {
			e.key === "Escape" && C(!1);
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	}, [S]), e.useEffect(() => () => {
		R.current !== null && window.clearTimeout(R.current);
	}, []), e.useEffect(() => {
		if (!N) return;
		let e = window.setTimeout(() => re.current?.select(), 0), t = (e) => {
			e.key === "Escape" && (P(null), I(""));
		};
		return window.addEventListener("keydown", t), () => {
			window.clearTimeout(e), window.removeEventListener("keydown", t);
		};
	}, [N]);
	let se = (e) => {
		M(e), R.current !== null && window.clearTimeout(R.current), R.current = window.setTimeout(() => {
			R.current = null, M(null);
		}, 2200);
	};
	e.useEffect(() => {
		if (!S) return;
		let e = !0;
		return v.load().then((t) => {
			e && A(t);
		}).catch(() => {}), () => {
			e = !1;
		};
	}, [S, v]);
	let ce = async (e) => {
		try {
			await v.remove(e), A((t) => t.filter((t) => t.id !== e));
		} catch {
			se(B.saveFailed);
		}
	}, V = () => {
		if (!a) return null;
		let e = b(a);
		if (!e.length) return null;
		let t = Y(e), n;
		try {
			t = y(a, e, !0), n = a.buildFragment(null, t, m.copy, e)?.elements;
		} catch {}
		let r = n?.length ? n : e;
		if (!r?.length) return null;
		let i = {
			elements: ge(r),
			width: t.width,
			height: t.height
		};
		return L.current = i, i;
	}, H = () => {
		A(xe()), h?.(), C(!0);
	}, U = (e, t) => {
		if (!a || !e.length) return;
		O(a, w.drawing), c.updatePointerType(a, d.selection), g(a), p.setSelection(a, null);
		let n = l.getBoardContainer(a).getBoundingClientRect(), r = x(a) ?? [0, 0], i = a.viewport.zoom || 1, o = [r[0] + n.width / 2 / i, r[1] + n.height / 2 / i], s = t ? {
			x: 0,
			y: 0,
			width: t.width,
			height: t.height
		} : Y(e), f = [o[0] - (s.x + s.width / 2), o[1] - (s.y + s.height / 2)];
		u.withNewBatch(a, () => {
			a.insertFragment({ elements: ge(e) }, f, m.paste), ee(a), g(a), p.setSelection(a, null);
		}), C(!1);
	}, le = () => {
		let e = V() ?? L.current;
		if (!e) return se(B.selectionMissing), !1;
		let t = k.length;
		return I(z ? `自定义素材 ${t + 1}` : `Custom material ${t + 1}`), P(e), !0;
	}, ue = async () => {
		if (N) try {
			let e = F.trim() || (z ? `自定义素材 ${k.length + 1}` : `Custom material ${k.length + 1}`), t = await v.save({
				name: e,
				elements: ge(N.elements),
				...N.width === void 0 ? {} : { width: N.width },
				...N.height === void 0 ? {} : { height: N.height }
			});
			A((e) => [t, ...e.filter((e) => e.id !== t.id)]), E("custom"), h?.(), C(!0), P(null), I(""), se(B.saved);
		} catch {
			se(B.saveFailed);
		}
	};
	e.useImperativeHandle(te, () => ({
		addSelectionToLibrary: le,
		captureSelection: () => !!V()
	}));
	let de = (e, t, n, a, o, s) => /* @__PURE__ */ i("article", {
		className: "lakex-material-card",
		children: [
			/* @__PURE__ */ i("button", {
				type: "button",
				className: "lakex-material-card__insert",
				title: `${B.insert}: ${t}`,
				onClick: () => U(n, o),
				children: [/* @__PURE__ */ r("span", {
					className: "lakex-material-card__canvas",
					children: /* @__PURE__ */ r(ve, { elements: n })
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
							e.preventDefault(), e.stopPropagation(), U(n, o);
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
	}, e), fe = f ? t(/* @__PURE__ */ r("div", {
		className: "lakex-material-trigger-wrap",
		"data-tooltip": B.library,
		children: /* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-material-trigger",
			title: B.library,
			"aria-label": B.library,
			"aria-expanded": S,
			onPointerDown: (e) => e.stopPropagation(),
			onClick: H,
			children: /* @__PURE__ */ r(ye, {})
		})
	}), f) : null;
	return /* @__PURE__ */ i(n, { children: [
		fe,
		j && typeof document < "u" && t(/* @__PURE__ */ i("div", {
			className: "lakex-material-toast",
			"data-theme": s ? "dark" : "light",
			role: "status",
			children: [/* @__PURE__ */ r("span", { children: "✓" }), j]
		}), document.body),
		N && typeof document < "u" && t(/* @__PURE__ */ r("div", {
			className: "lakex-material-name-dialog__backdrop",
			"data-theme": s ? "dark" : "light",
			onPointerDown: (e) => {
				e.target === e.currentTarget && (P(null), I(""));
			},
			children: /* @__PURE__ */ i("form", {
				className: "lakex-material-name-dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": "lakex-material-name-dialog-title",
				onSubmit: (e) => {
					e.preventDefault(), ue();
				},
				children: [
					/* @__PURE__ */ r("strong", {
						id: "lakex-material-name-dialog-title",
						children: B.nameDialogTitle
					}),
					/* @__PURE__ */ r("span", { children: B.nameDialogHint }),
					/* @__PURE__ */ r("input", {
						ref: re,
						value: F,
						placeholder: B.namePlaceholder,
						onChange: (e) => I(e.target.value)
					}),
					/* @__PURE__ */ i("div", {
						className: "lakex-material-name-dialog__actions",
						children: [/* @__PURE__ */ r("button", {
							type: "button",
							onClick: () => {
								P(null), I("");
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
		S && /* @__PURE__ */ r("div", {
			className: "lakex-material-library__backdrop",
			onPointerDown: (e) => {
				e.stopPropagation(), e.target === e.currentTarget && C(!1);
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
							"aria-selected": T === e,
							onClick: () => E(e),
							children: e === "recommended" ? B.recommended : B.custom
						}, e))
					}), /* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-material-library__close",
						"aria-label": B.close,
						title: B.close,
						onClick: () => C(!1),
						children: /* @__PURE__ */ r(be, {})
					})]
				}), T === "recommended" ? /* @__PURE__ */ i("div", {
					className: "lakex-material-library__recommended",
					children: [/* @__PURE__ */ r("nav", {
						className: "lakex-material-library__categories",
						"aria-label": B.recommended,
						children: q.map((e) => /* @__PURE__ */ i("button", {
							type: "button",
							role: "tab",
							"aria-selected": e.key === D,
							"aria-pressed": e.key === D,
							onClick: () => {
								let t = ie.current, n = ae.current[e.key];
								t && n && (oe.current = e.key, ne(e.key), t.scrollTo({
									top: n.offsetTop,
									behavior: "smooth"
								}), window.setTimeout(() => {
									oe.current = null;
								}, 400));
							},
							children: [e.icon && /* @__PURE__ */ r("span", { children: e.icon }), z ? e.zh : e.en]
						}, e.key))
					}), /* @__PURE__ */ r("div", {
						ref: ie,
						className: "lakex-material-library__recommended-scroll",
						onScroll: (e) => {
							if (oe.current) return;
							let t = e.currentTarget;
							if (t.scrollTop + t.clientHeight >= t.scrollHeight - 2) {
								ne(q[q.length - 1].key);
								return;
							}
							let n = t.scrollTop + Math.min(t.clientHeight * .28, 128), r = q[0].key;
							for (let e of q) {
								let t = ae.current[e.key];
								t && t.offsetTop <= n && (r = e.key);
							}
							ne(r);
						},
						children: q.map((e) => /* @__PURE__ */ r("section", {
							ref: (t) => {
								ae.current[e.key] = t;
							},
							className: "lakex-material-library__recommended-section",
							"aria-label": z ? e.zh : e.en,
							children: /* @__PURE__ */ r("div", {
								className: "lakex-material-library__grid",
								children: me.filter((t) => t.categories.includes(e.key)).map((e) => {
									let t = e.build(o);
									return de(e.id, z ? e.zh : e.en, t, void 0, void 0, e.sourceId ? { description: z ? e.descriptionZh || "" : e.descriptionEn || "" } : void 0);
								})
							})
						}, e.key))
					})]
				}) : /* @__PURE__ */ i("div", {
					className: "lakex-material-library__custom",
					children: [v.openFolder && /* @__PURE__ */ i("div", {
						className: "lakex-material-library__folder-row",
						children: [/* @__PURE__ */ r("button", {
							type: "button",
							className: "lakex-material-library__folder-open",
							onClick: () => v.openFolder?.(),
							children: B.openFolder
						}), /* @__PURE__ */ r("span", {
							className: "lakex-material-library__folder-hint",
							children: B.folderHint
						})]
					}), k.length ? /* @__PURE__ */ r("div", {
						className: "lakex-material-library__grid",
						children: k.map((e) => de(e.id, e.name, e.elements, () => void ce(e.id), e.width && e.height ? {
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
					})]
				})]
			})
		})
	] });
});
// src/cards/DrawingBoard/LakexBoardContextMenu.tsx
function Te({ board: n, locale: a, dark: o, hasContextSelection: s, position: c, onClose: l, onAddText: u, onAddShape: d, onAddLine: f, onFitToCanvas: p, onActualSize: m, onAddToMaterialLibrary: h }) {
	let g = e.useRef(null), ee = a === "zh-CN", te = n ? b(n) : [], v = te.length > 0 || s, y = ee ? {
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
	let x = Math.max(8, Math.min(c.x, window.innerWidth - 208)), S = Math.max(8, Math.min(c.y, window.innerHeight - 300)), C = (e) => {
		e(), l();
	};
	return t(/* @__PURE__ */ i("div", {
		ref: g,
		className: "lakex-board-context-menu",
		role: "menu",
		"aria-label": ee ? "画板菜单" : "Board menu",
		"data-theme": o ? "dark" : "light",
		style: {
			left: x,
			top: S
		},
		onContextMenu: (e) => {
			e.preventDefault(), e.stopPropagation();
		},
		children: [
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => C(u),
				children: [/* @__PURE__ */ r("span", { children: y.addText }), /* @__PURE__ */ r("kbd", { children: "T" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => C(d),
				children: [/* @__PURE__ */ r("span", { children: y.addShape }), /* @__PURE__ */ r("kbd", { children: "S" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => C(f),
				children: [/* @__PURE__ */ r("span", { children: y.addLine }), /* @__PURE__ */ r("kbd", { children: "⌘+L" })]
			}),
			/* @__PURE__ */ r("div", { className: "lakex-board-context-menu__divider" }),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				disabled: !v,
				onClick: () => C(() => _(n, te)),
				children: [/* @__PURE__ */ r("span", { children: y.duplicate }), /* @__PURE__ */ r("kbd", { children: "⌘+D" })]
			}),
			/* @__PURE__ */ r("button", {
				type: "button",
				role: "menuitem",
				disabled: !v,
				onClick: () => C(() => h()),
				children: /* @__PURE__ */ r("span", { children: y.addMaterial })
			}),
			/* @__PURE__ */ r("div", { className: "lakex-board-context-menu__divider" }),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => C(m),
				children: [/* @__PURE__ */ r("span", { children: y.actualSize }), /* @__PURE__ */ r("kbd", { children: "⌘+0" })]
			}),
			/* @__PURE__ */ i("button", {
				type: "button",
				role: "menuitem",
				onClick: () => C(p),
				children: [/* @__PURE__ */ r("span", { children: y.fitToCanvas }), /* @__PURE__ */ r("kbd", { children: "⌘+Shift+=" })]
			})
		]
	}), document.body);
}
// docs/lakex-drawing-board-json-format-skills.md?raw
var Ee = "# Lakex AI 画板 JSON 格式规范\n\n本文档用于指导 AI 把自然语言描述转换为 Lakex 画板可导入的 JSON。普通图表使用稳定、受控的 AI 中间格式；原生思维导图允许使用受校验的 `plaitValue` 树结构。应用会校验响应，再转换或挂载为原生画板元素。\n\n<!-- AI_RUNTIME_SPEC_START -->\n\n## AI 运行时精简规范\n\n只输出一个合法 JSON 对象，不要 Markdown、代码围栏、解释或注释。\n\n普通画板、流程图、UML、Smart 和 ER 根结构：\n\n`{\"version\":1,\"diagramType\":\"flowchart\",\"title\":\"可选标题\",\"nodes\":[],\"edges\":[]}`\n\n节点结构：\n\n`{\"id\":\"唯一ID\",\"shape\":\"图形\",\"x\":80,\"y\":80,\"width\":180,\"height\":64,\"text\":\"文字\",\"style\":{\"fill\":\"#E8F1FF\",\"strokeColor\":\"#5B8FF9\",\"strokeWidth\":1.5,\"strokeStyle\":\"solid\",\"fontSize\":14,\"textColor\":\"#273142\"}}`\n\n连线结构：\n\n`{\"id\":\"唯一ID\",\"source\":\"节点ID\",\"target\":\"节点ID\",\"sourceAnchor\":\"bottom\",\"targetAnchor\":\"top\",\"label\":\"可选文字\",\"style\":{\"lineType\":\"elbow\",\"strokeColor\":\"#697586\",\"strokeWidth\":1.5,\"strokeStyle\":\"solid\",\"endMarker\":\"arrow\"}}`\n\n允许的 `shape`：\n\n`rectangle,roundRectangle,ellipse,diamond,triangle,parallelogram,trapezoid,pentagon,hexagon,octagon,cloud,text,process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion`\n\n约束：\n\n- `version` 必须是数字 `1`，不能是字符串。\n- `diagramType` 必须根据用户意图填写为 `board,flowchart,uml,smart,er` 之一，并严格使用第 8 节对应分类的图形和布局规则。\n- ID 只能包含字母、数字、下划线、短横线；全部唯一。\n- 最多 80 个节点、120 条连线。\n- 节点必须使用 `shape` 和 `text` 字段，不能改成 `type`、`label`。\n- 坐标范围 `-5000..5000`；宽 `40..1200`；高 `24..800`。\n- 颜色只能是 `#RRGGBB`，填充可为 `transparent`。\n- 锚点只能是 `top,right,bottom,left`。\n- 线型只能是 `straight,elbow,curve`，箭头只能是 `arrow,none`。\n- 描边样式 `strokeStyle` 只能是 `solid,dashed,dotted`，默认 `solid`。\n- 每条连线必须引用已存在且不同的 source/target 节点。\n- 图形不能重叠；同层节点对齐，间距至少 32；流程图优先从上到下。\n- 连线不得穿过任何非起止节点，平行线段至少间隔 24px；分支节点周围预留至少 48px 连线通道。\n- `decision` 的“是/否”出口必须使用不同 `sourceAnchor`：纵向主流程通常“是”使用 `bottom`，“否”使用 `left` 或 `right`，并把否分支节点放在对应侧；禁止两条分支共用同一出口后重叠。\n- 锚点必须朝向另一个节点：上方来源进入目标用 `targetAnchor:top`，下方来源用 `bottom`，左侧来源用 `left`，右侧来源用 `right`。如果来源中心的 x 落在目标宽度内，禁止从目标 `left/right` 进入；如果来源中心的 y 落在目标高度内，禁止从目标 `top/bottom` 进入。\n- 多条连线进入同一节点且来源方向不同时，必须使用不同 `targetAnchor`；例如上方来源进入 `top`、左侧来源进入 `left`，不能为了对齐而让连线横穿目标图形。\n- 普通节点推荐 180×64，判断节点推荐 180×110。\n- 只要用户要求思维导图、脑图或 mind map，禁止使用 `nodes + edges`，必须返回原生 `plaitValue` 树结构。\n\n思维导图强制根结构：\n\n`{\"plaitValue\":[{\"id\":\"mind_root\",\"type\":\"mind\",\"data\":{\"topic\":{\"children\":[{\"text\":\"中心主题\"}],\"type\":\"paragraph\"}},\"children\":[],\"layout\":\"right\",\"points\":[[0,0]]}]}`\n\n思维导图约束：\n\n- 顶层只能放 `type:\"mind\"` 根节点；所有后代必须是 `type:\"mind_child\"`。\n- 父子关系只通过嵌套 `children` 表达，叶子必须使用 `children:[]`；禁止输出独立 `edges`。\n- 每个节点都必须有唯一 `id` 和 `data.topic`；`topic` 必须是 `{\"children\":[{\"text\":\"文字\"}],\"type\":\"paragraph\"}`。\n- 根节点必须包含 `layout` 和单点 `points`；默认使用 `layout:\"right\"`、`points:[[0,0]]`。后代节点不要输出 `points`。\n- 思维导图响应不要同时输出 `version`、`nodes`、`edges`、`shape`、`x`、`y`、`width` 或 `height`。\n\n<!-- AI_RUNTIME_SPEC_END -->\n\n## 1. 输出要求\n\n1. 只输出一个合法 JSON 对象，不要输出 Markdown 代码块、解释、注释或前后缀。\n2. 普通图表根对象必须包含 `version`、`diagramType`、`nodes`、`edges`；原生思维导图必须改用第 7 节的 `plaitValue`。\n3. 普通图表的 `version` 固定为 `1`。\n4. 所有 `id` 在同一份 JSON 内唯一，只能包含字母、数字、下划线和短横线。\n5. 最多 80 个节点、120 条连线。不要生成孤立且没有信息的装饰元素。\n6. 坐标单位为画板逻辑像素。建议把图形放在 `x=80..1400`、`y=80..900` 范围内。\n7. 图形之间至少保留 32px 间距，避免重叠；同层节点对齐，布局方向保持一致。\n8. 节点文本应简洁。中文通常不超过 20 个字，英文通常不超过 60 个字符。\n9. 不允许输出 HTML、脚本、图片 URL、data URL、事件、函数或 Drawnix/Plait 私有字段。\n\n## 2. 普通图表根对象\n\n```json\n{\n  \"version\": 1,\n  \"diagramType\": \"flowchart\",\n  \"title\": \"可选的图表标题\",\n  \"nodes\": [],\n  \"edges\": []\n}\n```\n\n| 字段      | 类型   | 必填 | 说明                               |\n| --------- | ------ | ---- | ---------------------------------- |\n| `version` | number | 是   | 固定为 `1`                         |\n| `diagramType` | string | 是 | `board,flowchart,uml,smart,er` 之一 |\n| `title`   | string | 否   | 图表标题，应用不会把它自动插入画布 |\n| `nodes`   | array  | 是   | 节点列表                           |\n| `edges`   | array  | 是   | 连线列表                           |\n\n## 3. 节点\n\n```json\n{\n  \"id\": \"node_start\",\n  \"shape\": \"terminal\",\n  \"x\": 120,\n  \"y\": 120,\n  \"width\": 160,\n  \"height\": 64,\n  \"text\": \"开始\",\n  \"style\": {\n    \"fill\": \"#E8F1FF\",\n    \"strokeColor\": \"#5B8FF9\",\n    \"strokeWidth\": 1.5,\n    \"strokeStyle\": \"solid\",\n    \"fontSize\": 14,\n    \"textColor\": \"#273142\"\n  }\n}\n```\n\n### 3.1 节点字段\n\n| 字段     | 类型   | 必填 | 约束                         |\n| -------- | ------ | ---- | ---------------------------- |\n| `id`     | string | 是   | 唯一，1–64 字符              |\n| `shape`  | string | 是   | 必须来自第 3.2 节            |\n| `x`      | number | 是   | 左上角 X，范围 `-5000..5000` |\n| `y`      | number | 是   | 左上角 Y，范围 `-5000..5000` |\n| `width`  | number | 是   | 范围 `40..1200`              |\n| `height` | number | 是   | 范围 `24..800`               |\n| `text`   | string | 否   | 最多 500 字符                |\n| `style`  | object | 否   | 只允许第 3.3 节字段          |\n\n### 3.2 支持的图形\n\n基础图形：\n\n- `rectangle`：矩形\n- `roundRectangle`：圆角矩形\n- `ellipse`：椭圆\n- `diamond`：菱形\n- `triangle`：三角形\n- `parallelogram`：平行四边形\n- `trapezoid`：梯形\n- `pentagon`：五边形\n- `hexagon`：六边形\n- `octagon`：八边形\n- `cloud`：云形\n- `text`：无边框文本\n\n流程图：\n\n- `process`：处理步骤\n- `terminal`：开始或结束\n- `decision`：条件判断\n- `data`：数据输入或输出\n- `connector`：页内连接\n- `manualInput`：手动输入\n- `preparation`：准备\n- `predefinedProcess`：子流程\n- `document`：文档\n- `multiDocument`：多文档\n- `database`：数据库\n- `internalStorage`：内部存储\n- `delay`：延迟\n- `display`：显示\n- `offPage`：页外连接\n- `noteSquare`：注释\n\nSmart：\n\n- `actor`：角色\n- `useCase`：用例\n- `component`：组件\n- `container`：容器\n- `note`：便签\n- `package`：包\n\nUML：\n\n- `actor`：角色\n- `useCase`：用例\n- `component`：组件\n- `container`：容器\n- `note`：便签\n- `package`：包\n- `simpleClass`：简单类\n- `class`：类\n- `interface`：接口\n- `object`：对象\n- `componentBox`：组件框\n- `activityClass`：活动\n- `branchMerge`：分支或合并\n- `port`：端口\n- `combinedFragment`：组合片段\n- `template`：模板\n- `activation`：激活生命线\n- `deletion`：销毁节点\n\nER：\n\n- `rectangle`：实体\n- `roundRectangle`：弱实体\n- `diamond`：关系\n- `ellipse`：属性\n- `parallelogram`：关联实体\n- `class`：带字段明细的实体\n\n### 3.3 节点样式\n\n| 字段          | 类型   | 约束                              |\n| ------------- | ------ | --------------------------------- |\n| `fill`        | string | `#RRGGBB`；透明使用 `transparent` |\n| `strokeColor` | string | `#RRGGBB`                         |\n| `strokeWidth` | number | `0..8`                            |\n| `strokeStyle` | string | `solid`、`dashed`、`dotted`       |\n| `fontSize`    | number | `10..72`                          |\n| `textColor`   | string | `#RRGGBB`                         |\n\n推荐色板：\n\n- 蓝：填充 `#E8F1FF`，描边 `#5B8FF9`\n- 绿：填充 `#EAF8F0`，描边 `#5BB98C`\n- 黄：填充 `#FFF6D9`，描边 `#D9A441`\n- 橙：填充 `#FFF0E6`，描边 `#E58B50`\n- 紫：填充 `#F3EBFF`，描边 `#9B71D1`\n- 灰：填充 `#F3F4F6`，描边 `#8B95A5`\n- 默认正文色：`#273142`\n\n颜色应表达语义并保持一致。普通流程建议使用同一主色，仅给判断、异常或关键节点使用强调色。\n\n## 4. 连线\n\n```json\n{\n  \"id\": \"edge_start_to_check\",\n  \"source\": \"node_start\",\n  \"target\": \"node_check\",\n  \"sourceAnchor\": \"bottom\",\n  \"targetAnchor\": \"top\",\n  \"label\": \"\",\n  \"style\": {\n    \"lineType\": \"elbow\",\n    \"strokeColor\": \"#697586\",\n    \"strokeWidth\": 1.5,\n    \"strokeStyle\": \"solid\",\n    \"endMarker\": \"arrow\"\n  }\n}\n```\n\n### 4.1 连线字段\n\n| 字段           | 类型   | 必填 | 约束                                        |\n| -------------- | ------ | ---- | ------------------------------------------- |\n| `id`           | string | 是   | 唯一，1–64 字符                             |\n| `source`       | string | 是   | 必须引用存在的节点 ID                       |\n| `target`       | string | 是   | 必须引用存在的节点 ID，不能与 `source` 相同 |\n| `sourceAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |\n| `targetAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |\n| `label`        | string | 否   | 最多 120 字符，例如“是”“否”                 |\n| `style`        | object | 否   | 见第 4.2 节                                 |\n\n### 4.2 连线样式\n\n| 字段          | 类型   | 约束                         |\n| ------------- | ------ | ---------------------------- |\n| `lineType`    | string | `straight`、`elbow`、`curve` |\n| `strokeColor` | string | `#RRGGBB`                    |\n| `strokeWidth` | number | `0.5..8`                     |\n| `strokeStyle` | string | `solid`、`dashed`、`dotted`  |\n| `endMarker`   | string | `arrow` 或 `none`            |\n\n默认使用 `elbow` 和 `arrow`。流程方向应通过锚点表达，例如纵向流程使用 `bottom -> top`，横向流程使用 `right -> left`。\n\n### 4.3 防止连线与箭头重叠\n\n- 连线只能在起点和终点处接触节点边界，任何中间线段都不能穿过其他节点。\n- 同一节点有多条出边时，优先分配不同的 `sourceAnchor`；同一节点有多条入边时，优先分配不同的 `targetAnchor`。\n- 纵向流程的普通步骤使用 `bottom -> top`。判断节点的主分支继续向下，使用 `bottom -> top`；另一分支向左或向右展开，使用 `left -> right` 或 `right -> left`。\n- 判断条件的两个出口不得同时使用 `bottom`，否则箭头和“是/否”标签会重叠。默认约定：“是”沿主流程向下，“否”向距离其他节点更远的一侧展开。\n- 分支目标节点必须位于出口方向：从 `left` 离开的目标放在判断节点左侧，从 `right` 离开的目标放在右侧，从 `bottom` 离开的目标放在下方。\n- `targetAnchor` 必须位于面向来源节点的一侧：来源在上方时连接 `top`，来源在下方时连接 `bottom`，来源在左侧时连接 `left`，来源在右侧时连接 `right`。不得选择需要让最后一段连线穿过目标内部才能到达的锚点。\n- 特别注意“斜上方来源”：若来源中心的 x 仍落在目标的 `[x, x + width]` 范围内，应视为上方来源并连接 `top`，不能连接 `left/right`；“斜侧方来源”按相同原则检查 y 投影。\n- 同一目标有多条入边时，根据各来源位置分配不同入口。例如失败节点同时接收上方注册流程和左侧校验流程时，应分别使用 `top` 和 `left`，不能共用入口或让其中一条线穿过失败节点。\n- 两条平行连线的可见线段至少间隔 24px；连线与非起止节点边缘至少间隔 24px；判断节点与分支目标之间建议保留 80px 以上通道。\n- 回流线放在流程外侧，不能逆向穿过主流程节点。回流目标应使用侧边锚点，例如 `top -> left`，不要与主流程的 `bottom -> top` 共用路径。\n- “是”“否”等标签必须属于不同连线并跟随各自出口；标签附近至少保留 16px 空白，不要放在两条线的交叉点或重合线段上。\n\n纵向判断分支推荐结构：\n\n```json\n[\n  {\n    \"id\": \"edge_yes\",\n    \"source\": \"decision_stock\",\n    \"target\": \"deduct_stock\",\n    \"sourceAnchor\": \"bottom\",\n    \"targetAnchor\": \"top\",\n    \"label\": \"是\",\n    \"style\": { \"lineType\": \"elbow\", \"endMarker\": \"arrow\" }\n  },\n  {\n    \"id\": \"edge_no\",\n    \"source\": \"decision_stock\",\n    \"target\": \"sold_out\",\n    \"sourceAnchor\": \"right\",\n    \"targetAnchor\": \"left\",\n    \"label\": \"否\",\n    \"style\": { \"lineType\": \"elbow\", \"endMarker\": \"arrow\" }\n  }\n]\n```\n\n其中 `deduct_stock` 必须位于 `decision_stock` 下方，`sold_out` 必须位于其右侧。若右侧已有节点，则整体镜像到左侧，并改用 `left -> right`。\n\n## 5. 布局规则\n\n- 先确定主方向：流程图优先从上到下，架构图优先从左到右。\n- 同一层级使用相同的 `width`、`height` 和对齐线。\n- 一般节点建议 `width=160..220`、`height=56..88`。\n- 判断节点建议 `width=150..190`、`height=90..120`。\n- UML 类图建议 `width=200..280`、`height=120..220`。\n- 横向节点中心间距建议 240px，纵向节点中心间距建议 140px。\n- 分支汇聚前后留出额外空间，判断分支建议横向中心间距至少 280px，避免连线穿过节点。\n- 先放置节点，再按节点位置分配锚点；若连线会穿过节点，应移动分支节点或切换到另一侧，而不是继续输出重叠连线。\n- 连线只连接语义相关节点，不要用连线绘制装饰边框。\n\n### 5.1 思维导图\n\n思维导图不使用本节的坐标和连线布局规则，也不允许使用普通 `nodes + edges` 图形模拟。必须直接使用第 7 节的原生 `plaitValue` 树结构，由 Plait Mind 组件根据 `children` 和 `layout` 自动计算节点位置与分支连线。\n\n## 6. 普通流程图中间格式示例\n\n用户描述：“生成一个用户提交工单的流程图，审核通过后进入处理中，不通过则退回修改，最后完成。”\n\n模型在使用 `nodes + edges` 模式时应只返回以下 JSON；这段示例是流程图示例，其他类型必须改用第 8 节对应规范，不适用于原生思维导图 `plaitValue` 模式：\n\n```json\n{\n  \"version\": 1,\n  \"diagramType\": \"flowchart\",\n  \"title\": \"工单处理流程\",\n  \"nodes\": [\n    {\n      \"id\": \"start\",\n      \"shape\": \"terminal\",\n      \"x\": 360,\n      \"y\": 80,\n      \"width\": 160,\n      \"height\": 56,\n      \"text\": \"开始\",\n      \"style\": {\n        \"fill\": \"#EAF8F0\",\n        \"strokeColor\": \"#5BB98C\",\n        \"fontSize\": 14,\n        \"textColor\": \"#273142\"\n      }\n    },\n    {\n      \"id\": \"submit\",\n      \"shape\": \"process\",\n      \"x\": 350,\n      \"y\": 190,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"提交工单\"\n    },\n    {\n      \"id\": \"review\",\n      \"shape\": \"decision\",\n      \"x\": 350,\n      \"y\": 310,\n      \"width\": 180,\n      \"height\": 110,\n      \"text\": \"审核通过？\",\n      \"style\": {\n        \"fill\": \"#FFF6D9\",\n        \"strokeColor\": \"#D9A441\"\n      }\n    },\n    {\n      \"id\": \"revise\",\n      \"shape\": \"process\",\n      \"x\": 80,\n      \"y\": 330,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"退回修改\"\n    },\n    {\n      \"id\": \"processing\",\n      \"shape\": \"process\",\n      \"x\": 350,\n      \"y\": 500,\n      \"width\": 180,\n      \"height\": 64,\n      \"text\": \"处理中\"\n    },\n    {\n      \"id\": \"done\",\n      \"shape\": \"terminal\",\n      \"x\": 360,\n      \"y\": 630,\n      \"width\": 160,\n      \"height\": 56,\n      \"text\": \"完成\",\n      \"style\": {\n        \"fill\": \"#EAF8F0\",\n        \"strokeColor\": \"#5BB98C\"\n      }\n    }\n  ],\n  \"edges\": [\n    {\n      \"id\": \"e1\",\n      \"source\": \"start\",\n      \"target\": \"submit\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    },\n    {\n      \"id\": \"e2\",\n      \"source\": \"submit\",\n      \"target\": \"review\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    },\n    {\n      \"id\": \"e3\",\n      \"source\": \"review\",\n      \"target\": \"processing\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\",\n      \"label\": \"是\"\n    },\n    {\n      \"id\": \"e4\",\n      \"source\": \"review\",\n      \"target\": \"revise\",\n      \"sourceAnchor\": \"left\",\n      \"targetAnchor\": \"right\",\n      \"label\": \"否\"\n    },\n    {\n      \"id\": \"e5\",\n      \"source\": \"revise\",\n      \"target\": \"submit\",\n      \"sourceAnchor\": \"top\",\n      \"targetAnchor\": \"left\"\n    },\n    {\n      \"id\": \"e6\",\n      \"source\": \"processing\",\n      \"target\": \"done\",\n      \"sourceAnchor\": \"bottom\",\n      \"targetAnchor\": \"top\"\n    }\n  ]\n}\n```\n\n注意：实际响应不能包含上面的 Markdown 代码围栏，只包含 JSON 对象。若生成原生思维导图，则应改用第 7 节的 `{ \"plaitValue\": [...] }` 根结构。\n\n<!-- AI_NATIVE_MIND_SPEC_START -->\n\n## 7. AI 原生思维导图 `plaitValue` 规范\n\n`plaitValue` 是思维导图组件和画板卡片使用的原生 Plait 元素数组。普通图表继续使用 `version + nodes + edges`，但 AI 生成思维导图时必须直接返回 `{ \"plaitValue\": [...] }`。不要套用 `drawnix`、`elements` 或其他持久化包裹结构。\n\n### 7.1 原生思维导图结构\n\n思维导图不是由独立的 `edges` 元素组成，而是由一棵嵌套树组成：\n\n- 根节点的 `type` 是 `mind`；兼容旧数据时也可能看到 `mindmap`。\n- 子孙节点的 `type` 是 `mind_child`，关系由父节点的 `children` 表达。\n- 每个节点都必须有唯一 `id`、`data` 和 `children`；叶子节点使用空数组 `children: []`。\n- `data.topic` 是 Slate 段落，不是普通字符串，结构固定为 `{ \"children\": [{ \"text\": \"...\" }], \"type\": \"paragraph\" }`。\n- 根节点通常有 `layout` 和单点 `points`。`points` 是根节点左上角逻辑坐标，格式为 `[[x, y]]`，不是普通图形的 `[[left, top], [right, bottom]]`。\n- `layout` 支持 `right`、`left`、`standard`、`upward`、`downward`，以及 `right-bottom-indented`、`right-top-indented`、`left-top-indented`、`left-bottom-indented`。\n- `rightNodeCount` 用于 `standard` 布局区分根节点左右分支；没有左右分支时可以省略。不要把它写到子节点上。\n- `fill`、`strokeColor`、`strokeWidth`、`strokeStyle`、`shape`、`branchColor`、`branchWidth`、`branchShape`、`isCollapsed`、`manualWidth` 等是可选的原生样式或布局字段，应使用项目已有值，不要创造新的字段名。\n- `shape` 的原生思维导图值是 `round-rectangle` 或 `underline`；它与 AI 中间格式的 `roundRectangle` 不是同一个字段值。\n\n最小可用的原生思维导图示例：\n\n```json\n{\n  \"plaitValue\": [\n    {\n      \"id\": \"tnpPz\",\n      \"type\": \"mind\",\n      \"data\": {\n        \"topic\": {\n          \"children\": [{ \"text\": \"中心主题\" }],\n          \"type\": \"paragraph\"\n        }\n      },\n      \"children\": [\n        {\n          \"id\": \"ntyaw\",\n          \"type\": \"mind_child\",\n          \"data\": {\n            \"topic\": {\n              \"children\": [{ \"text\": \"1111\" }],\n              \"type\": \"paragraph\"\n            }\n          },\n          \"children\": []\n        },\n        {\n          \"id\": \"xNewH\",\n          \"type\": \"mind_child\",\n          \"data\": {\n            \"topic\": {\n              \"children\": [{ \"text\": \"22222\" }],\n              \"type\": \"paragraph\"\n            }\n          },\n          \"children\": []\n        }\n      ],\n      \"layout\": \"right\",\n      \"points\": [[0, 0]]\n    }\n  ]\n}\n```\n\n带二级分支时，只需继续嵌套 `children`，不要新增 `edges`：\n\n```json\n{\n  \"id\": \"ntyaw\",\n  \"type\": \"mind_child\",\n  \"data\": {\n    \"topic\": {\n      \"children\": [{ \"text\": \"用户系统\" }],\n      \"type\": \"paragraph\"\n    }\n  },\n  \"children\": [\n    {\n      \"id\": \"ntyaw-login\",\n      \"type\": \"mind_child\",\n      \"data\": {\n        \"topic\": {\n          \"children\": [{ \"text\": \"登录\" }],\n          \"type\": \"paragraph\"\n        }\n      },\n      \"children\": []\n    }\n  ]\n}\n```\n\n### 7.2 原生思维导图与 AI 格式的转换边界\n\n保存或恢复卡片时读取 `value.plaitValue`。调用 AI 时，普通图表使用 `nodes + edges`，需要通过 `convertAIBoardDocument` 转换；原生思维导图可以直接使用 `{ \"plaitValue\": [...] }`，应用只做安全校验、字段规范化和容器提取，然后通过原生 Mind 插入流程挂载。不要把 `mind_child` 拆成普通几何节点或独立 `edges`；必须保持父子嵌套结构，否则会出现 `mind element has not been mounted` 或无法计算节点边界的问题。\n\n两种响应格式的处理边界如下：\n\n| AI 响应根结构 | 适用场景 | 应用处理 |\n| --- | --- | --- |\n| `{ \"version\": 1, \"diagramType\": \"...\", \"nodes\": [], \"edges\": [] }` | 普通画板、流程图、UML、Smart、ER | 按 `diagramType` 校验图形集合，再转换为 geometry / arrow-line 元素 |\n| `{ \"plaitValue\": [{ \"type\": \"mind\", \"children\": [...] }] }` | 所有思维导图、脑图、mind map 请求 | 提取并校验原生树，直接挂载为 `mind` 元素 |\n\n因此，你给出的 `plaitValue` 不需要再转换成 `nodes + edges`；只需要保留完整的 `mind` / `mind_child` 树结构，并作为 AI 响应的根对象返回。\n\n<!-- AI_NATIVE_MIND_SPEC_END -->\n\n<!-- AI_DIAGRAM_TYPE_SPEC_START -->\n\n## 8. 流程图、UML、Smart 与 ER 分类规范\n\n除原生思维导图外，AI 必须先识别用户需要的图表类型，并在根对象中填写对应的 `diagramType`。除非用户明确要求混合图，否则禁止跨分类借用图形；存在对应语义图形时，不能用普通矩形代替。\n\n类型选择优先级：\n\n- 操作步骤、审批、业务流转、条件分支、异常回退：`flowchart`。\n- 用例图、类图、组件图、活动图、时序或系统建模：`uml`。\n- 角色协作、概念关系、系统模块、容器和便签式架构表达：`smart`。\n- 数据库表、实体、属性、主外键和实体关系：`er`。\n- 只是自由排版、信息卡片或无法归入以上类型：`board`。\n- 思维导图、脑图、mind map 不使用 `diagramType`，必须改用第 7 节的原生 `plaitValue`。\n\n### 8.1 流程图 `flowchart`\n\n只使用 `process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,text`。\n\n- 开始和结束必须使用 `terminal`；普通操作使用 `process`；条件分支使用 `decision`，不能用普通 `diamond` 代替。\n- 输入输出使用 `data`，数据存储按语义使用 `database` 或 `internalStorage`，可复用流程使用 `predefinedProcess`。\n- 主流程优先自上而下。判断节点的不同出口必须使用不同锚点，并在连线 `label` 中明确“是/否”“成功/失败”等条件。\n- 流转线默认 `endMarker:\"arrow\"`；注释线才允许 `endMarker:\"none\"`。\n\n### 8.2 UML `uml`\n\n只使用 `actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion,text`。\n\n按 UML 子类型选择图形：\n\n- 用例图：参与者用 `actor`，用例用 `useCase`，系统边界用 `container`。\n- 类图：类用 `class` 或 `simpleClass`，接口用 `interface`，实例用 `object`，泛型定义用 `template`。`class/interface` 的 `text` 第一行是名称，后续行是属性或方法。\n- 组件图：组件用 `component` 或 `componentBox`，分组用 `package/container`，接口连接点用 `port`。\n- 活动图：活动使用 `activityClass`，判断或汇合使用 `branchMerge`。\n- 时序表达：参与对象使用 `actor/object`，生命期激活使用 `activation`，组合条件使用 `combinedFragment`，销毁点使用 `deletion`。\n\nUML 连线的 `label` 应写明关系语义，如“继承”“实现”“依赖”“关联”“包含”。继承、实现或有向依赖使用 `endMarker:\"arrow\"`；普通关联使用 `endMarker:\"none\"`。同一层的类或组件应对齐，并为关系文字预留空间。\n\n### 8.3 Smart `smart`\n\n只使用 `actor,useCase,component,container,note,package,text`。\n\n- 人员或外部参与方使用 `actor`，目标或能力使用 `useCase`，模块使用 `component`，边界或系统域使用 `container`。\n- 同一业务域用 `package` 分组，补充说明使用 `note`，不能把便签作为流程节点。\n- Smart 图用于高层概念、协作和架构关系，不应混入流程图的 `decision/process` 或 UML 类明细图形。\n- 布局优先从左到右：角色在左、能力或组件居中、容器或系统边界在右；关联线通常使用 `endMarker:\"none\"`，存在明确方向时才使用箭头。\n\n### 8.4 ER `er`\n\n只使用 `rectangle,roundRectangle,diamond,ellipse,parallelogram,class,text`。\n\n- 实体使用 `rectangle`；弱实体使用 `roundRectangle`；关系使用 `diamond`；属性使用 `ellipse`；关联实体使用 `parallelogram`。\n- 需要展示表字段时使用 `class`：第一行是实体名，后续每行一个字段，可用 `PK`、`FK` 标记主键和外键。\n- ER 关系线使用 `endMarker:\"none\"`。基数写入 `label`，使用 `1:1`、`1:N`、`M:N`、`0..1` 或 `0..N` 等明确标记。\n- 实体按主要关系横向或网格排布；关系菱形位于关联实体之间，属性靠近所属实体。禁止连线穿过其他实体或属性。\n- 关系节点必须同时连接至少两个实体；属性只能连接所属实体，不得形成独立业务流程。\n\n### 8.5 分类校验\n\n应用会根据 `diagramType` 校验每个节点的 `shape`。如果 UML、Smart、ER 或流程图使用了其他分类的图形，整份 AI 响应会被拒绝；因此必须先选类型，再生成节点和连线。\n\n<!-- AI_DIAGRAM_TYPE_SPEC_END -->\n", De = "<!-- AI_RUNTIME_SPEC_START -->", Oe = "<!-- AI_RUNTIME_SPEC_END -->", ke = "<!-- AI_NATIVE_MIND_SPEC_START -->", Ae = "<!-- AI_NATIVE_MIND_SPEC_END -->", je = "<!-- AI_DIAGRAM_TYPE_SPEC_START -->", Me = "<!-- AI_DIAGRAM_TYPE_SPEC_END -->", Ne = (e, t, n) => {
	let r = e.indexOf(t), i = e.indexOf(n);
	return r < 0 || i <= r ? e : e.slice(r + t.length, i).trim();
}, Pe = Ne(Ee, De, Oe), Fe = Ne(Ee, ke, Ae), Ie = [
	"你是 Lakex AI 画板数据生成器。",
	"请严格遵守下面的格式规范，根据用户描述生成一份可以直接导入画板的 JSON。",
	"最终响应只能包含 JSON 对象，不能包含 Markdown 代码围栏、解释或注释。",
	"",
	Pe,
	"",
	"以下是流程图、UML、Smart 和 ER 必须分别使用的分类规范：",
	Ne(Ee, je, Me),
	"",
	"以下是思维导图必须直接使用的第 7 条原生规范：",
	Fe
].join("\n"), Le = {
	rectangle: j.rectangle,
	roundRectangle: j.roundRectangle,
	ellipse: j.ellipse,
	diamond: j.diamond,
	triangle: j.triangle,
	parallelogram: j.parallelogram,
	trapezoid: j.trapezoid,
	pentagon: j.pentagon,
	hexagon: j.hexagon,
	octagon: j.octagon,
	cloud: j.cloud,
	text: j.text,
	process: N.process,
	terminal: N.terminal,
	decision: N.decision,
	data: N.data,
	connector: N.connector,
	manualInput: N.manualInput,
	preparation: N.preparation,
	predefinedProcess: N.predefinedProcess,
	document: N.document,
	multiDocument: N.multiDocument,
	database: N.database,
	internalStorage: N.internalStorage,
	delay: N.delay,
	display: N.display,
	offPage: N.offPage,
	noteSquare: N.noteSquare,
	actor: F.actor,
	useCase: F.useCase,
	component: F.component,
	container: F.container,
	note: F.note,
	package: F.package,
	simpleClass: F.simpleClass,
	class: F.class,
	interface: F.interface,
	object: F.object,
	componentBox: F.componentBox,
	activityClass: F.activityClass,
	branchMerge: F.branchMerge,
	port: F.port,
	combinedFragment: F.combinedFragment,
	template: F.template,
	activation: F.activation,
	deletion: F.deletion
}, Re = {
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
}, ze = new Map(Object.entries(Le).map(([e, t]) => [t, e])), X = (e) => !!e && typeof e == "object" && !Array.isArray(e), Be = (e, t, n) => Math.min(n, Math.max(t, e)), Z = (e, t, n, r) => {
	let i = typeof e == "number" ? e : Number(e);
	return Number.isFinite(i) ? Be(i, n, r) : t;
}, Q = (e, t, n = "") => typeof e == "string" ? e.slice(0, t) : n, $ = (e, t, n = !1) => n && e === "transparent" ? "transparent" : typeof e == "string" && /^#[0-9a-f]{6}$/i.test(e) ? e.toUpperCase() : t, Ve = (e) => e === "top" || e === "right" || e === "bottom" || e === "left" ? e : void 0, He = (e) => e === "board" || e === "flowchart" || e === "uml" || e === "smart" || e === "er" ? e : void 0, Ue = (e) => e === T.dashed || e === T.dotted ? e : T.solid, We = (e, t) => Math.max(0, Math.min(e.x + e.width, t.x + t.width) - Math.max(e.x, t.x)) * Math.max(0, Math.min(e.y + e.height, t.y + t.height) - Math.max(e.y, t.y)) / Math.min(e.width * e.height, t.width * t.height), Ge = (e, t) => {
	if (e.length < 2) return e;
	let n = 0;
	for (let t = 0; t < e.length; t += 1) for (let r = t + 1; r < e.length; r += 1) We(e[t], e[r]) >= .35 && (n += 1);
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
}, Ke = (e) => {
	if (typeof e != "string") return e;
	let t = e.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	try {
		return JSON.parse(t);
	} catch {
		throw Error("AI_RESPONSE_NOT_JSON");
	}
}, qe = /* @__PURE__ */ new Set([
	"right",
	"left",
	"standard",
	"upward",
	"downward",
	"right-bottom-indented",
	"right-top-indented",
	"left-top-indented",
	"left-bottom-indented"
]), Je = (e, t) => {
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
}, Ye = (e, t) => {
	if (!Array.isArray(e)) return [t];
	let n = e.filter((e) => Array.isArray(e) && e.length >= 2 && Number.isFinite(Number(e[0])) && Number.isFinite(Number(e[1]))).slice(0, 8).map((e) => [Be(Number(e[0]), -5e3, 5e3), Be(Number(e[1]), -5e3, 5e3)]);
	return n.length ? n : [t];
}, Xe = (e, t, n, r, i, a) => {
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
		data: { topic: Je(e.data.topic, `${r}.data.topic`) },
		children: c.map((e, n) => Xe(e, t, !1, `${r}.children[${n}]`, i, a + 1))
	};
	return n ? (l.points = Ye(e.points, i), l.layout = qe.has(String(e.layout)) ? e.layout : "right") : qe.has(String(e.layout)) && (l.layout = e.layout), typeof e.rightNodeCount == "number" && (l.rightNodeCount = Math.max(0, Math.floor(e.rightNodeCount))), typeof e.manualWidth == "number" && (l.manualWidth = Z(e.manualWidth, 0, 40, 1200)), typeof e.isCollapsed == "boolean" && (l.isCollapsed = e.isCollapsed), (e.shape === "round-rectangle" || e.shape === "underline") && (l.shape = e.shape), (e.branchShape === "bight" || e.branchShape === "polyline") && (l.branchShape = e.branchShape), typeof e.fill == "string" && (l.fill = $(e.fill, "#E8F1FF", !0)), typeof e.strokeColor == "string" && (l.strokeColor = $(e.strokeColor, "#5B8FF9")), e.strokeWidth !== void 0 && (l.strokeWidth = Z(e.strokeWidth, 1.5, 0, 8)), e.strokeStyle !== void 0 && (l.strokeStyle = Ue(e.strokeStyle)), typeof e.branchColor == "string" && (l.branchColor = $(e.branchColor, "#5B8FF9")), e.branchWidth !== void 0 && (l.branchWidth = Z(e.branchWidth, 1.5, .5, 8)), l;
}, Ze = (e) => {
	if (!Array.isArray(e) || e.length === 0 || e.length > 20) throw Error("AI_NATIVE_SIZE_INVALID");
	let t = /* @__PURE__ */ new Set(), n = 0;
	return e.map((e, r) => {
		let i = t.size, a = Xe(e, t, !0, `plaitValue[${r}]`, [120 + r * 360, 120], 0);
		if (n += t.size - i, n > 80) throw Error("AI_NATIVE_SIZE_INVALID");
		return a;
	});
};
function Qe(e) {
	let t = Ke(e);
	if (X(t)) {
		let e = Array.isArray(t.plaitValue) ? t.plaitValue : Array.isArray(t.elements) ? t.elements : null;
		if (e) return {
			kind: "native",
			elements: Ze(e)
		};
	}
	return {
		kind: "intermediate",
		document: $e(t)
	};
}
function $e(e) {
	let t = Ke(e);
	if (!X(t) || t.version !== 1) throw Error("AI_SCHEMA_VERSION_INVALID");
	let n = He(t.diagramType);
	if (t.diagramType !== void 0 && !n) throw Error("AI_DIAGRAM_TYPE_INVALID");
	if (!Array.isArray(t.nodes) || !Array.isArray(t.edges)) throw Error("AI_SCHEMA_COLLECTION_INVALID");
	if (t.nodes.length === 0 || t.nodes.length > 80 || t.edges.length > 120) throw Error("AI_SCHEMA_SIZE_INVALID");
	let r = /* @__PURE__ */ new Set(), i = t.nodes.map((e, t) => {
		if (!X(e)) throw Error(`AI_NODE_INVALID:${t}`);
		let n = Q(e.id, 64);
		if (!/^[a-zA-Z0-9_-]+$/.test(n) || r.has(n)) throw Error(`AI_NODE_ID_INVALID:${t}`);
		r.add(n);
		let i = Q(e.shape, 32);
		if (!Le[i]) throw Error(`AI_NODE_SHAPE_INVALID:${i}`);
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
				strokeStyle: Ue(a.strokeStyle),
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
			sourceAnchor: Ve(e.sourceAnchor),
			targetAnchor: Ve(e.targetAnchor),
			label: Q(e.label, 120),
			style: {
				lineType: c,
				strokeColor: $(s.strokeColor, "#697586"),
				strokeWidth: Z(s.strokeWidth, 1.5, .5, 8),
				strokeStyle: Ue(s.strokeStyle),
				endMarker: s.endMarker === "none" ? "none" : "arrow"
			}
		};
	}), s = Ge(i, o);
	if (n && n !== "board") {
		let e = Re[n], t = s.find((t) => !e.has(t.shape));
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
var et = {
	top: [.5, 0],
	right: [1, .5],
	bottom: [.5, 1],
	left: [0, .5]
}, tt = (e, t) => {
	let n = [e.x + e.width / 2, e.y + e.height / 2], r = [t.x + t.width / 2, t.y + t.height / 2], i = r[0] - n[0], a = r[1] - n[1];
	return Math.abs(i) > Math.abs(a) ? i >= 0 ? ["right", "left"] : ["left", "right"] : a >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}, nt = (e) => [e.x + e.width / 2, e.y + e.height / 2], rt = (e, t) => {
	let n = nt(e), r = nt(t), i = r[0] - n[0], a = r[1] - n[1], o = i >= 0 ? "right" : "left", s = a >= 0 ? "bottom" : "top";
	return Math.abs(i) > Math.abs(a) ? [o, s] : [s, o];
}, it = (e, t, n) => {
	let [r, i] = nt(n);
	switch (t) {
		case "top": return i <= e.y;
		case "right": return r >= e.x + e.width;
		case "bottom": return i >= e.y + e.height;
		case "left": return r <= e.x;
	}
}, at = (e, t, n, r, i) => {
	let a = [
		n,
		r,
		...rt(e, t),
		"top",
		"right",
		"bottom",
		"left"
	].filter((n, r, i) => !!n && i.indexOf(n) === r && it(e, n, t));
	return a.find((e) => !i.has(e)) ?? a[0] ?? r;
}, ot = (e) => {
	let t = new Map(e.nodes.map((e) => [e.id, e])), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
	return e.edges.forEach((e) => {
		let a = t.get(e.source), o = t.get(e.target);
		if (!a || !o) return;
		let s = tt(a, o), c = n.get(a.id) ?? /* @__PURE__ */ new Set(), l = r.get(o.id) ?? /* @__PURE__ */ new Set(), u = at(a, o, e.sourceAnchor, s[0], c), d = at(o, a, e.targetAnchor, s[1], l);
		c.add(u), l.add(d), n.set(a.id, c), r.set(o.id, l), i.set(e.id, [u, d]);
	}), i;
}, st = (e, t) => {
	switch (t) {
		case "top": return [e.x + e.width / 2, e.y];
		case "right": return [e.x + e.width, e.y + e.height / 2];
		case "bottom": return [e.x + e.width / 2, e.y + e.height];
		case "left": return [e.x, e.y + e.height / 2];
	}
}, ct = (e) => {
	if (!e || typeof e != "object") return "";
	let t = e;
	return typeof t.text == "string" ? t.text : Array.isArray(t.children) ? t.children.map(ct).join("") : "";
}, lt = (e) => {
	if (!e || typeof e != "object") return;
	let t = e;
	if (typeof t.text == "string") return t;
	if (Array.isArray(t.children)) for (let e of t.children) {
		let t = lt(e);
		if (t) return t;
	}
}, ut = (e) => e.text ? ct(e.text) : Array.isArray(e.cells) ? e.cells.map((e) => ct(e.text)).filter(Boolean).join("\n") : Array.isArray(e.texts) ? e.texts.map((e) => ct(e.text)).filter(Boolean).join("\n") : "", dt = (e) => {
	let t = lt(e.text ?? e.cells?.find((e) => e.text)?.text ?? e.texts?.find((e) => e.text)?.text), n = Number(t?.["font-size"]);
	return {
		fontSize: Number.isFinite(n) ? Be(n, 10, 72) : 14,
		textColor: typeof t?.color == "string" && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toUpperCase() : "#273142"
	};
}, ft = (e) => {
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
}, pt = (e) => {
	if (!(!Array.isArray(e) || e.length < 2 || !Number.isFinite(e[0]) || !Number.isFinite(e[1]))) return Object.entries(et).reduce((t, n) => {
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
function mt(e) {
	let t = [], n = /* @__PURE__ */ new Set();
	for (let r of e.children) {
		if (t.length >= 80) break;
		let e = r;
		if (e.type !== "geometry") continue;
		let i = ze.get(e.shape), a = ft(e.points);
		if (!i || !a || !/^[a-zA-Z0-9_-]+$/.test(e.id)) continue;
		let o = dt(e);
		t.push({
			id: e.id,
			shape: i,
			...a,
			text: ut(e).slice(0, 500),
			style: {
				fill: e.fill === "transparent" || /^#[0-9a-f]{6}$/i.test(e.fill) ? e.fill : "#E8F1FF",
				strokeColor: /^#[0-9a-f]{6}$/i.test(e.strokeColor) ? e.strokeColor : "#5B8FF9",
				strokeWidth: Z(e.strokeWidth, 1.5, 0, 8),
				strokeStyle: Ue(e.strokeStyle),
				...o
			}
		}), n.add(e.id);
	}
	let r = [];
	for (let t of e.children) {
		if (r.length >= 120) break;
		let e = t;
		if (e.type !== "arrow-line" || !n.has(e.source?.boundId) || !n.has(e.target?.boundId)) continue;
		let i = e.shape === A.straight || e.shape === A.curve ? e.shape : A.elbow, a = Array.isArray(e.texts) ? e.texts.map((e) => ct(e.text)).join("") : "";
		r.push({
			id: typeof e.id == "string" && /^[a-zA-Z0-9_-]+$/.test(e.id) ? e.id : `edge_${r.length + 1}`,
			source: e.source.boundId,
			target: e.target.boundId,
			sourceAnchor: pt(e.source.connection),
			targetAnchor: pt(e.target.connection),
			label: a.slice(0, 120),
			style: {
				lineType: i,
				strokeColor: /^#[0-9a-f]{6}$/i.test(e.strokeColor) ? e.strokeColor : "#697586",
				strokeWidth: Z(e.strokeWidth, 1.5, .5, 8),
				strokeStyle: Ue(e.strokeStyle),
				endMarker: e.target.marker === k.none ? "none" : "arrow"
			}
		});
	}
	return {
		version: 1,
		nodes: t,
		edges: r
	};
}
var ht = (e) => e.type === "mind" || e.type === "mindmap", gt = (e) => {
	let t = 0, n = (e) => {
		t += 1, Array.isArray(e.children) && e.children.forEach(n);
	};
	return e.forEach((e) => n(e)), t;
};
function _t(e) {
	let t = e.children.filter(ht);
	return t.length ? { plaitValue: t.map((e) => JSON.parse(JSON.stringify(e))) } : mt(e);
}
function vt(e) {
	return "plaitValue" in e ? gt(e.plaitValue) : e.nodes.length;
}
var yt = 20, bt = 8e3;
function xt({ description: e, history: t, currentBoard: n, mode: r }) {
	let i = [], a = 0;
	for (let e = t.length - 1; e >= 0 && i.length < yt; --e) {
		let n = t[e].trim();
		if (n) {
			if (a + n.length > bt) break;
			i.unshift(n), a += n.length;
		}
	}
	let o = i.length ? i.map((e, t) => `${t + 1}. ${e}`).join("\n") : "无，这是本轮会话的第一次提问。", s = JSON.stringify(n), c = vt(n), l = r === "append" ? [
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
function St(e, t) {
	let n = [], r = ot(e), i = /* @__PURE__ */ new Map();
	return e.nodes.forEach((e) => {
		let r = e.shape === "text", a = [[e.x, e.y], [e.x + e.width, e.y + e.height]], o = {
			"font-size": String(e.style.fontSize),
			color: e.style.textColor
		}, s = e.shape === "class" || e.shape === "interface", c = t && s ? L(t, a, Le[e.shape]) : R(Le[e.shape], a, e.text, {
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
					text: E(i, r === 0 ? C.center : C.left, o)
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
		let o = tt(t.source, a.source), [s, c] = r.get(e.id) ?? o, l = e.style.lineType === "straight" ? A.straight : e.style.lineType === "curve" ? A.curve : A.elbow, u = I(l, [st(t.source, s), st(a.source, c)], {
			boundId: t.element.id,
			connection: et[s],
			marker: k.none
		}, {
			boundId: a.element.id,
			connection: et[c],
			marker: e.style.endMarker === "none" ? k.none : k.arrow
		}, e.label ? [{
			text: E(e.label),
			position: .5
		}] : void 0, {
			strokeColor: e.style.strokeColor,
			strokeWidth: e.style.strokeWidth
		});
		u.strokeStyle = e.style.strokeStyle, n.push(u);
	}), n;
}
// src/cards/DrawingBoard/LakexAIBoardAssistant.tsx
var Ct = {
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
function wt({ ai: a, board: o, locale: s, dark: c, toolbarHost: l, overlayHost: u, onOpen: d, onApply: f }) {
	let p = Ct[s], [m, h] = e.useState(!1), [g, ee] = e.useState(""), [_, te] = e.useState("replace"), [v, y] = e.useState(!1), [b, x] = e.useState(""), [S, C] = e.useState(null), [w, T] = e.useState([]), E = e.useRef(null), D = e.useRef(null), ne = e.useRef(0), O = e.useRef(null), k = e.useCallback((e) => {
		O.current !== null && window.clearTimeout(O.current), C(e), O.current = window.setTimeout(() => {
			C(null), O.current = null;
		}, 3200);
	}, []), A = e.useCallback(() => {
		ne.current += 1, D.current?.controller.abort(), D.current = null, y(!1), h(!1), x("");
	}, []);
	e.useEffect(() => () => {
		D.current?.controller.abort(), O.current !== null && window.clearTimeout(O.current);
	}, []), e.useEffect(() => {
		if (!m) return;
		let e = window.requestAnimationFrame(() => E.current?.focus()), t = (e) => {
			e.key === "Escape" && A();
		};
		return document.addEventListener("keydown", t, !0), () => {
			window.cancelAnimationFrame(e), document.removeEventListener("keydown", t, !0);
		};
	}, [A, m]);
	let j = e.useCallback(async () => {
		let e = g.trim();
		if (!e) {
			x(p.empty), E.current?.focus();
			return;
		}
		if (!a) {
			x(p.missing);
			return;
		}
		if (!o) {
			x(p.failed);
			return;
		}
		y(!0), x("");
		let t = new AbortController(), n = ++ne.current;
		D.current?.controller.abort(), D.current = {
			id: n,
			controller: t
		};
		try {
			let r = _t(o), i = xt({
				description: e,
				history: w,
				currentBoard: r,
				mode: _
			}), c = await a.generate({
				description: e,
				systemPrompt: Ie,
				contextPrompt: i,
				history: w,
				currentBoard: r,
				locale: s,
				signal: t.signal
			});
			if (t.signal.aborted || D.current?.id !== n) return;
			let l = Qe(c);
			f(l.kind === "native" ? l.elements : St(l.document, o), _), T((t) => [...t, e].slice(-20)), h(!1), ee(""), k({
				type: "success",
				message: p.success
			});
		} catch (e) {
			if (t.signal.aborted || D.current?.id !== n) return;
			let r = e instanceof Error ? e.message : "", i = r.startsWith("AI_") || r.includes("JSON") ? p.invalid : r || p.failed;
			x(i), k({
				type: "error",
				message: i
			});
		} finally {
			D.current?.id === n && (D.current = null, y(!1));
		}
	}, [
		a,
		o,
		g,
		w,
		s,
		_,
		f,
		k,
		p
	]), M = o ? vt(_t(o)) : 0, N = l ? t(/* @__PURE__ */ r("div", {
		className: "lakex-ai-board-trigger-wrap",
		children: /* @__PURE__ */ r("button", {
			type: "button",
			className: "lakex-ai-board-trigger",
			title: p.tooltip,
			"data-tooltip": p.tooltip,
			"aria-label": p.tooltip,
			"aria-expanded": m,
			onClick: () => {
				d?.(), x(""), M === 0 && w.length && T([]), h(!0);
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
	}), l) : null, P = m && u ? t(/* @__PURE__ */ r("div", {
		className: "lakex-ai-board-overlay",
		role: "presentation",
		onPointerDown: (e) => {
			e.stopPropagation(), e.target === e.currentTarget && A();
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
						onClick: A,
						children: "×"
					})]
				}),
				/* @__PURE__ */ r("textarea", {
					ref: E,
					value: g,
					maxLength: 4e3,
					placeholder: p.placeholder,
					disabled: v,
					onChange: (e) => {
						ee(e.target.value), b && x("");
					},
					onKeyDown: (e) => {
						e.stopPropagation(), e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), j());
					}
				}),
				/* @__PURE__ */ i("div", {
					className: "lakex-ai-board-dialog__options",
					children: [/* @__PURE__ */ i("label", { children: [/* @__PURE__ */ r("input", {
						type: "radio",
						name: "lakex-ai-board-mode",
						value: "replace",
						checked: _ === "replace",
						disabled: v,
						onChange: () => te("replace")
					}), M ? p.modify : p.replace] }), /* @__PURE__ */ i("label", { children: [/* @__PURE__ */ r("input", {
						type: "radio",
						name: "lakex-ai-board-mode",
						value: "append",
						checked: _ === "append",
						disabled: v,
						onChange: () => te("append")
					}), p.append] })]
				}),
				/* @__PURE__ */ i("div", {
					className: "lakex-ai-board-dialog__memory",
					children: [/* @__PURE__ */ i("div", { children: [/* @__PURE__ */ r("span", { children: p.memory(w.length) }), /* @__PURE__ */ r("span", { children: p.boardContext(M) })] }), /* @__PURE__ */ r("button", {
						type: "button",
						disabled: v || w.length === 0,
						onClick: () => T([]),
						children: p.resetMemory
					})]
				}),
				!a && /* @__PURE__ */ r("p", {
					className: "lakex-ai-board-dialog__notice",
					children: p.missing
				}),
				b && /* @__PURE__ */ r("p", {
					className: "lakex-ai-board-dialog__error",
					role: "alert",
					children: b
				}),
				/* @__PURE__ */ i("footer", {
					className: "lakex-ai-board-dialog__footer",
					children: [/* @__PURE__ */ r("span", { children: p.shortcut }), /* @__PURE__ */ i("div", { children: [/* @__PURE__ */ r("button", {
						type: "button",
						onClick: A,
						children: v ? p.cancelGenerating : p.cancel
					}), /* @__PURE__ */ r("button", {
						type: "button",
						className: "lakex-ai-board-dialog__generate",
						disabled: v || !g.trim() || !a,
						onClick: () => void j(),
						children: v ? p.generating : p.generate
					})] })]
				})
			]
		})
	}), u) : null, F = S && u ? t(/* @__PURE__ */ i("div", {
		className: "lakex-ai-board-toast",
		"data-type": S.type,
		role: S.type === "error" ? "alert" : "status",
		children: [/* @__PURE__ */ r("span", {
			"aria-hidden": "true",
			children: S.type === "success" ? "✓" : "!"
		}), S.message]
	}), u) : null;
	return /* @__PURE__ */ i(n, { children: [
		N,
		P,
		F
	] });
}
// src/cards/DrawingBoard/LakexQuickShapePicker.tsx
var Tt = 248, Et = 320, Dt = 8, Ot = [
	"basic",
	"flowchart",
	"smart"
];
function kt({ locale: n, anchor: a, recent: o, sourceShape: s, onPick: c, onClose: l }) {
	let u = n === "zh-CN", d = e.useRef(null), [f, p] = e.useState(null);
	e.useLayoutEffect(() => {
		let e = d.current;
		if (!e) return;
		let t = Math.min(e.offsetHeight, Et), n = Math.min(Math.max(Dt, a.x + Dt), window.innerWidth - Tt - Dt), r = Math.min(Math.max(Dt, a.y), Math.max(Dt, window.innerHeight - t - Dt));
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
			children: /* @__PURE__ */ r(U, { pointer: e.pointer })
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
			width: Tt,
			maxHeight: Et,
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
		}), Ot.map((e) => {
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
// src/cards/DrawingBoard/DrawnixBoardCore.tsx
var At = "lake-notes-v3.board-recent-shapes", jt = 7, Mt = ".draw-toolbar, .lakex-shape-catalog, .lakex-material-library, .lakex-drawnix-export, [data-lakex-quick-shape], [data-lakex-ai-board]";
function Nt() {
	try {
		let e = JSON.parse(window.localStorage.getItem(At) || "[]");
		return Array.isArray(e) ? e.filter((e) => typeof e == "string").slice(0, jt) : [];
	} catch {
		return [];
	}
}
function Pt(e) {
	try {
		window.localStorage.setItem(At, JSON.stringify(e));
	} catch {}
}
var Ft = (e) => {
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
}, It = (e, t, n) => {
	let r = e, i = { ...r };
	return r.points && (i.points = r.points.map(([e, r]) => [e + t, r + n])), r.children && (i.children = r.children.map((e) => It(e, t, n))), i;
}, Lt = (e, t) => {
	if (!e.children.length) return t;
	let n = Ft(t);
	if (!n) return t;
	let r = null;
	try {
		r = te(e, e.children, !0);
	} catch {
		r = Ft(e.children);
	}
	if (!r || !r.width && !r.height) return t;
	let i = r.x + r.width + 120 - n.x, a = r.y + r.height / 2 - (n.y + n.height / 2);
	return t.map((e) => It(e, i, a));
}, Rt = (e, t, n) => {
	let r = I(A.straight, [t, n], { marker: k.none }, { marker: k.arrow });
	p.insertNode(e, r, [e.children.length]);
}, zt = {
	top: [.5, 0],
	right: [1, .5],
	bottom: [.5, 1],
	left: [0, .5]
}, Bt = (e, t) => {
	let [n, r] = e.points;
	switch (t) {
		case "top": return [(n[0] + r[0]) / 2, n[1]];
		case "right": return [r[0], (n[1] + r[1]) / 2];
		case "bottom": return [(n[0] + r[0]) / 2, r[1]];
		case "left": return [n[0], (n[1] + r[1]) / 2];
	}
}, Vt = (e, t, n, r, i) => {
	let a = I(A.straight, [Bt(t, r), Bt(n, i)], {
		boundId: t.id,
		connection: zt[r],
		marker: k.none
	}, {
		boundId: n.id,
		connection: zt[i],
		marker: k.arrow
	});
	p.insertNode(e, a, [e.children.length]);
}, Ht = .8, Ut = (e, t) => [t[0] + (e[0] - t[0]) * Ht, t[1] + (e[1] - t[1]) * Ht], Wt = (e, t, n, r) => {
	let i = L(e, t, n), a = E(r, C.center, { "font-size": "12" }), o;
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
}, Gt = (e, t, n) => {
	let r = n === "zh-CN";
	if (t === "flowchart") {
		let t = (e) => Ut(e, [540, 370]), n = Wt(e, [t([460, 120]), t([620, 180])], N.terminal, r ? "开始" : "Start"), i = Wt(e, [t([460, 250]), t([620, 320])], N.process, r ? "处理" : "Process"), a = Wt(e, [t([460, 390]), t([620, 490])], N.decision, r ? "判断" : "Decision"), o = Wt(e, [t([460, 560]), t([620, 620])], N.terminal, r ? "结束" : "End");
		Vt(e, n, i, "bottom", "top"), Vt(e, i, a, "bottom", "top"), Vt(e, a, o, "bottom", "top");
	} else if (t === "uml") {
		let t = (e) => Ut(e, [625, 315]), n = Wt(e, [t([230, 245]), t([350, 365])], F.actor, r ? "用户" : "User"), i = Wt(e, [t([470, 260]), t([670, 350])], F.useCase, r ? "提交申请" : "Submit request"), a = Wt(e, [t([790, 205]), t([1020, 405])], F.class, r ? "申请服务" : "Request service");
		Vt(e, n, i, "right", "left"), Vt(e, i, a, "right", "left");
	} else if (t === "mindmap") {
		let t = oe(e, [600, 320]);
		t.data.topic = E(r ? "主题" : "Topic", void 0, { "font-size": "14" }), t.children = [
			z(E(r ? "需求" : "Requirements", void 0, { "font-size": "12" }), {}),
			z(E(r ? "方案" : "Solution", void 0, { "font-size": "12" }), {}),
			z(E(r ? "计划" : "Plan", void 0, { "font-size": "12" }), {})
		], t.rightNodeCount = t.children.length, ae.insertMind(e, t);
	}
};
function Kt(t) {
	let [n, r] = e.useState(() => typeof window < "u" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	return e.useEffect(() => {
		if (!t || typeof window > "u") return;
		let e = window.matchMedia("(prefers-color-scheme: dark)"), n = () => r(e.matches);
		return n(), e.addEventListener?.("change", n), () => e.removeEventListener?.("change", n);
	}, [t]), n;
}
function qt({ value: t, readOnly: o, locale: s, theme: m, ai: ee, onChange: _, onViewportPersist: te, fitOnInit: y, materialStorage: C }) {
	let T = e.useRef(null), E = e.useRef(null), k = e.useRef(null), A = e.useRef(!1), [N, F] = e.useState(null);
	e.useEffect(() => {
		N && (N.options.readonly = !!o);
	}, [N, o]);
	let [I, L] = e.useState(!1), [R, oe] = e.useState(null), [z, V] = e.useState(!1), [H, U] = e.useState(null), [ue, fe] = e.useState(() => Nt()), W = e.useRef(null);
	e.useEffect(() => {
		if (!N || o) return;
		let e = (e) => e instanceof Element && !!e.closest(Mt), t = (t) => {
			t.button !== 0 || e(t.target) ? W.current = null : W.current = {
				ids: new Set(N.children.map((e) => e.id)),
				selectionMode: l.getPointer(N) === d.selection
			};
		}, n = (t) => {
			let n = W.current;
			W.current = null, n?.selectionMode && !e(t.target) && window.setTimeout(() => {
				let e = E.current;
				if (!e || e !== N) return;
				let r = e.children.filter((e) => {
					let t = e;
					return !n.ids.has(t.id) && P.isGeometry(t) && !P.isText(t);
				});
				r.length === 1 && U({
					x: t.clientX,
					y: t.clientY,
					elementId: r[0].id
				});
			}, 0);
		};
		return document.addEventListener("pointerdown", t, !0), document.addEventListener("pointerup", n, !0), () => {
			document.removeEventListener("pointerdown", t, !0), document.removeEventListener("pointerup", n, !0);
		};
	}, [N, o]), e.useEffect(() => {
		if (N && !o) return ie(N, {
			hoverPreview: !1,
			requestShapeChoice: (e) => {
				U({
					x: e.clientX,
					y: e.clientY,
					commit: (t) => e.commit(t),
					sourceShape: e.shapeElement.shape
				});
			}
		}), () => ie(N, null);
	}, [N, o]);
	let G = e.useCallback((e) => {
		fe((t) => {
			let n = [e, ...t.filter((t) => t !== e)].slice(0, jt);
			return Pt(n), n;
		});
	}, []), pe = e.useCallback((e) => {
		let t = H;
		if (U(null), !t) return;
		let n = e;
		if (t.commit) t.commit(n);
		else if (t.elementId) {
			let e = E.current;
			if (e) {
				let r = e.children.find((e) => e.id === t.elementId);
				r && (g(e), h(e, r), M.switchGeometryShape(e, n), re(e, n));
			}
		}
		G(e);
	}, [H, G]), K = e.useCallback(() => {
		let e = H;
		U(null), e?.commit?.();
	}, [H]), me = e.useRef(!1), he = e.useRef(null), q = e.useRef(0), ge = e.useRef(null), J = e.useRef(null), Y = e.useRef(null), _e = e.useRef(null), ve = Kt(m === "system"), ye = m === "dark" || m === "system" && ve, be = ye ? f.dark : f.default, xe = s === "zh-CN" ? "zh" : "en";
	e.useEffect(() => () => {
		Y.current?.(), Y.current = null;
	}, []), e.useEffect(() => {
		E.current && c.updateThemeColor(E.current, be);
	}, [be]), e.useEffect(() => {
		if (!N || o || typeof window > "u") return;
		let e = (e) => {
			let t = T.current, n = e.composedPath();
			t && n.some((e) => e instanceof Node && t.contains(e)) ? A.current = !0 : n.some((e) => e instanceof Element && !!e.closest(".plait-board-attached")) || (A.current = !1);
		}, t = (e) => {
			if (e.key !== "Delete" && e.key !== "Backspace" || !A.current && !l.isFocus(N)) return;
			let t = e.target instanceof Element ? e.target : null, n = T.current, r = t?.closest("input, textarea, select, [contenteditable=\"true\"]");
			t?.matches("input, textarea, select") || r && n?.contains(r) || (e.preventDefault(), e.stopImmediatePropagation(), N.globalKeyDown(e), N.keyDown(e));
		};
		return window.addEventListener("pointerdown", e, !0), window.addEventListener("keydown", t, !0), () => {
			window.removeEventListener("pointerdown", e, !0), window.removeEventListener("keydown", t, !0), A.current = !1;
		};
	}, [N, o]), e.useEffect(() => {
		I && document.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: !0
		}));
	}, [I]);
	let Se = t?.plaitValue || [], Ce = JSON.stringify(Se), [Ee, De] = e.useState(Se), Oe = e.useRef(Ce), ke = e.useRef(/* @__PURE__ */ new Set()), Ae = t?.plaitViewport;
	e.useEffect(() => {
		Ce !== Oe.current && (ke.current.delete(Ce) || (Oe.current = Ce, De(Se)));
	}, [Se, Ce]);
	let je = e.useCallback((e) => {
		if (!_ || typeof window > "u") return;
		he.current !== null && window.clearTimeout(he.current);
		let t = ++q.current;
		he.current = window.setTimeout(() => {
			S(e, { padding: 16 }).then((e) => {
				t === q.current && e && _({ previewImage: e });
			}).catch(() => {});
		}, 250);
	}, [_]);
	e.useEffect(() => () => {
		he.current !== null && window.clearTimeout(he.current), ge.current !== null && window.cancelAnimationFrame(ge.current), J.current !== null && window.cancelAnimationFrame(J.current);
	}, []);
	let Me = (e) => {
		me.current || (me.current = !0, window.setTimeout(() => {
			me.current = !1;
			for (let t of e.children) {
				let n = t;
				n.shape === j.text && n.autoSize !== !0 && p.setNode(e, { autoSize: !0 }, l.findPath(e, t));
			}
		}, 0));
	}, Ne = e.useCallback(() => {
		let e = E.current;
		e && typeof window < "u" && window.setTimeout(() => {
			window.requestAnimationFrame(() => {
				let t = document.querySelector(".popup-font-size__input"), n = Number(t?.value);
				!Number.isFinite(n) || n <= 0 || (b(e).forEach((t) => {
					let r = D(t);
					if (!r.length) return;
					let i = t.data?.topic ?? t.text, a = i ? se.getMarksByElement(i) : {}, o = 14;
					try {
						o = B(t) ?? o;
					} catch {}
					Number(a["font-size"] ?? o) !== n && ce.setFontSize(e, String(n), o, r);
				}), window.requestAnimationFrame(() => {
					b(e).forEach((e) => {
						ne(e).forEach((e) => e.updateRectangle());
					});
				}));
			});
		}, 0);
	}, []);
	e.useEffect(() => {
		if (!N) return;
		let e = (e) => !!(e instanceof Element ? e : null)?.closest(".popup-font-size, .popup-font-size__stepper-button"), t = (t) => {
			e(t.target) && Ne();
		}, n = (t) => {
			e(t.target) && Ne();
		}, r = (t) => {
			t.key === "Enter" && e(t.target) && Ne();
		};
		return document.addEventListener("pointerup", t, !0), document.addEventListener("blur", n, !0), document.addEventListener("keydown", r, !0), () => {
			document.removeEventListener("pointerup", t, !0), document.removeEventListener("blur", n, !0), document.removeEventListener("keydown", r, !0);
		};
	}, [N, Ne]);
	let Pe = (e) => {
		let t = (e instanceof Element ? e : null)?.closest(".draw-toolbar [title]");
		return t?.getAttribute("title") === "形状" || t?.getAttribute("title") === "Shape";
	}, Fe = (e) => {
		let t = e instanceof Element ? e : e instanceof Node ? e.parentElement : null;
		return t?.closest(".plait-board-container") ? !t.closest(".draw-toolbar, .plait-board-attached, [role=dialog], [data-lakex-shape-catalog]") : !1;
	}, Ie = (e, t) => {
		let n = E.current;
		if (!n) return null;
		let r = l.getBoardContainer(n).getBoundingClientRect(), i = x(n) ?? [0, 0], a = n.viewport.zoom || 1;
		return [i[0] + (e - r.left) / a, i[1] + (t - r.top) / a];
	}, Le = () => R ? Ie(R.x, R.y) : null, Re = () => {
		let e = E.current, t = Le();
		e && t && M.insertText(e, t, s === "zh-CN" ? "文本" : "Text");
	}, ze = () => {
		let e = E.current, t = Le();
		e && t && M.insertGeometry(e, [t, [t[0] + 160, t[1] + 88]], j.roundRectangle);
	}, X = () => {
		let e = E.current, t = Le();
		e && t && Rt(e, t, [t[0] + 180, t[1]]);
	}, Be = () => {
		let e = E.current;
		e && c.updateViewport(e, x(e) ?? [0, 0], 1);
	}, Z = (e, t) => {
		let n = E.current, r = Ie(e, t);
		if (!n || !r) return !1;
		if (!b(n).length) {
			let e = v(n, r);
			e && (g(n), h(n, e));
		}
		return k.current?.captureSelection() ?? b(n).length > 0;
	}, Q = e.useCallback((e, t) => {
		let n = E.current;
		if (!n || !e.length) return;
		let r = t === "append" ? Lt(n, e) : e;
		g(n), u.withNewBatch(n, () => {
			if (t === "replace") for (let e = n.children.length - 1; e >= 0; --e) p.removeNode(n, [e]);
			r.forEach((e) => {
				e.type === "mind" || e.type === "mindmap" ? ae.insertMind(n, e) : p.insertNode(n, e, [n.children.length]);
			});
		}), window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				E.current === n && c.fitViewport(n);
			});
		});
	}, []);
	return /* @__PURE__ */ i("div", {
		ref: T,
		className: `lakex-drawnix-core ${o ? "lakex-drawnix-core--readonly" : ""}`,
		"data-theme": ye ? "dark" : "light",
		"data-prevent-swipe": !0,
		onPointerDownCapture: (e) => {
			if (e.button === 2 && Fe(e.target)) {
				e.preventDefault(), e.stopPropagation(), Z(e.clientX, e.clientY);
				return;
			}
			if (Pe(e.target)) {
				e.preventDefault(), e.stopPropagation(), E.current && (p.setSelection(E.current, null), O(E.current, w.drawing), c.updatePointerType(E.current, j.rectangle)), L((e) => !e);
				return;
			}
			let t = e.target;
			I && !t?.closest("[data-lakex-shape-catalog]") && L(!1);
		},
		onClickCapture: (e) => {
			Pe(e.target) && (e.preventDefault(), e.stopPropagation());
		},
		onContextMenuCapture: (e) => {
			Fe(e.target) && (e.preventDefault(), e.stopPropagation(), A.current = !0, V(Z(e.clientX, e.clientY)), L(!1), oe({
				x: e.clientX,
				y: e.clientY
			}));
		},
		onKeyDownCapture: (e) => {
			if (e.key !== "Enter" && e.key !== "Backspace" && e.key !== "Delete" || !e.target?.closest(".slate-editable-container")) return;
			let t = E.current, n = t?.viewport.origination ?? (t ? x(t) : null);
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
			let t = e.target?.closest(".slate-editable-container, input, textarea, select"), n = !!t && !!T.current?.contains(t);
			if ((e.key === "Delete" || e.key === "Backspace") && n && e.stopPropagation(), (e.key === "Enter" || e.key === "Backspace" || e.key === "Delete") && n) {
				e.key === "Enter" && (e.stopPropagation(), e.nativeEvent.stopImmediatePropagation());
				let t = _e.current;
				if (_e.current = null, t && typeof window < "u") {
					Y.current?.();
					let e = () => {
						if (E.current !== t.board) return;
						let e = t.board.viewport.origination ?? x(t.board);
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
						e(), s(), Y.current === s && (Y.current = null);
					}, 360), Y.current = s;
				}
			}
		},
		onKeyUp: (e) => {
			if (e.key !== "Enter" && e.key !== "Backspace" && e.key !== "Delete") return;
			let t = e.target?.closest(".slate-editable-container, input, textarea, select");
			t && T.current?.contains(t) && (e.stopPropagation(), e.nativeEvent.stopImmediatePropagation());
		},
		children: [/* @__PURE__ */ r(a, {
			value: Ee,
			viewport: Ae,
			theme: { themeColorMode: be },
			initialLanguage: xe,
			initialToolState: { pointer: d.selection },
			tutorial: !1,
			afterInit: (e) => {
				E.current = e, F(e), e.options.readonly = !!o, c.updateThemeColor(e, be);
				let n = t?.preset;
				!o && n && n !== "drawing" && !t?.presetInitialized && e.children.length === 0 ? ge.current = window.requestAnimationFrame(() => {
					ge.current = null, !(E.current !== e || e.children.length > 0) && (Gt(e, n, s), _?.({ presetInitialized: !0 }), J.current = window.requestAnimationFrame(() => {
						J.current = null, E.current === e && c.fitViewport(e);
					}));
				}) : y && t?.plaitViewport == null && e.children.length > 0 && (J.current = window.requestAnimationFrame(() => {
					J.current = null, E.current === e && e.children.length > 0 && c.fitViewport(e);
				})), Me(e), je(e);
			},
			onChange: () => {
				E.current && Me(E.current);
			},
			onValueChange: (e) => {
				let t = JSON.stringify(e);
				Oe.current = t;
				let n = ke.current;
				if (n.add(t), n.size > 50) {
					let e = n.values().next().value;
					e && n.delete(e);
				}
				De(e), E.current && (Me(E.current), je(E.current)), _?.({
					version: 2,
					engine: "drawnix",
					plaitValue: e
				});
			},
			onViewportChange: (e) => {
				te?.(e);
			}
		}, xe), !o && /* @__PURE__ */ i(n, { children: [
			/* @__PURE__ */ r(le, {
				board: N,
				locale: s,
				open: I,
				onClose: () => L(!1)
			}),
			/* @__PURE__ */ r(we, {
				ref: k,
				board: N,
				locale: s,
				dark: ye,
				toolbarHost: T.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null,
				onOpen: () => L(!1),
				materialStorage: C
			}),
			/* @__PURE__ */ r(wt, {
				ai: ee,
				board: N,
				locale: s,
				dark: ye,
				toolbarHost: T.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null,
				overlayHost: T.current,
				onOpen: () => L(!1),
				onApply: Q
			}),
			/* @__PURE__ */ r(de, {
				board: N,
				locale: s,
				toolbarHost: T.current?.querySelector(".draw-toolbar .stack_horizontal") ?? null
			}),
			/* @__PURE__ */ r(Te, {
				board: N,
				locale: s,
				dark: ye,
				hasContextSelection: z,
				position: R,
				onClose: () => {
					oe(null), V(!1);
				},
				onAddText: Re,
				onAddShape: ze,
				onAddLine: X,
				onFitToCanvas: () => {
					E.current && c.fitViewport(E.current);
				},
				onActualSize: Be,
				onAddToMaterialLibrary: () => k.current?.addSelectionToLibrary() ?? !1
			}),
			H && /* @__PURE__ */ r(kt, {
				locale: s,
				anchor: {
					x: H.x,
					y: H.y
				},
				recent: ue,
				sourceShape: H.sourceShape,
				onPick: pe,
				onClose: K
			})
		] })]
	});
}
export { qt as default };
