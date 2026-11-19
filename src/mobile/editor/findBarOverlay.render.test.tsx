// @vitest-environment jsdom
/**
 * F-A（261119 移动端平滑度审计 P1）：文档内查找条 = 覆盖式浮条 —— 开/关不得推动正文几何。
 *  · 挂载/卸载 .mb-find 前后，正文容器（.mobile-doc-body）的流内 top / 高度 / 所在 pane 的流内总高不变；
 *  · .mb-find 绝对定位脱离正文流，锚在工作区正文容器顶部（top/left/right = 0，不写估算高度）；
 *  · 层序走既有令牌 --mobile-z-topbar（不写魔法数字）；nested 语义 ⇒ 不消费 --mobile-top-safe-area。
 *
 * jsdom 无真实布局 ⇒ 几何用「流内兄弟累计高度」假布局模型量（absolute/fixed 视为出流；高度走
 * offsetHeight 桩，.mb-find=52 / .mobile-doc-body=640），定位判定用真实 mobile-find.css 注入
 * <style> 后的 getComputedStyle。若 .mb-find 回到流内（回归），查找条的 52px 会重新计入正文
 * top ⇒ 断言必红（模型自证见「假布局里查找条确实有高度」一条）。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../features/editor/LakeEditor", () => ({ LakeEditor: () => createElement("div", { className: "lake-editor-mount" }) }));
vi.mock("./EditorDockHost", () => ({ EditorDockHost: () => null }));
vi.mock("./OutlineSheet", () => ({ OutlineSheet: () => null }));
vi.mock("./DocListSheet", () => ({ DocListSheet: () => null }));
vi.mock("../../features/editor/clipboardHtml", () => ({ installPasteInterceptor: () => undefined }));
vi.mock("../bridge/assets", () => ({ openLocalAssetFile: async () => undefined }));
vi.mock("../../lib/settings", () => ({ loadSettings: () => ({ fontSize: 16 }) }));

import { DocumentEditor, type DocumentEditorProps } from "./DocumentEditor";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIND_CSS = readFileSync(path.join(HERE, "mobile-find.css"), "utf8");
/** 只看声明体（与 topChromeContract.test.ts 同口径：注释里的提及不算引用）。 */
const FIND_CSS_CODE = FIND_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** 假布局高度（jsdom 无布局；只有正文/查找条关心的表面给非零值）。 */
const FAKE_HEIGHT: Array<[string, number]> = [
  ["mb-find", 52],
  ["mobile-doc-body", 640],
  ["mobile-status-msg", 40],
];
function fakeHeight(el: HTMLElement): number {
  for (const [cls, h] of FAKE_HEIGHT) if (el.classList.contains(cls)) return h;
  return 0;
}
function inFlow(el: HTMLElement): boolean {
  const p = getComputedStyle(el).position;
  return p !== "absolute" && p !== "fixed";
}
/** 元素在所在流（doc-pane 内的块级堆叠）里的 top = 流内前序兄弟高度累计。 */
function flowTop(el: HTMLElement): number {
  let top = 0;
  for (let sib = el.previousElementSibling as HTMLElement | null; sib; sib = sib.previousElementSibling as HTMLElement | null) {
    if (inFlow(sib)) top += fakeHeight(sib);
  }
  return top;
}
function flowHeight(parent: HTMLElement): number {
  let h = 0;
  for (const child of Array.from(parent.children) as HTMLElement[]) if (inFlow(child)) h += fakeHeight(child);
  return h;
}

let host: HTMLDivElement;
let style: HTMLStyleElement;
let root: Root;

function renderEditor(findOpen: boolean): void {
  const element: ReactElement = createElement(DocumentEditor, {
    note: { id: "n1", title: "t", content: "<p>正文</p>" },
    content: "<p>正文</p>",
    editing: false,
    onContentChange: () => undefined,
    findOpen,
    onCloseFind: () => undefined,
  } as unknown as DocumentEditorProps);
  // 真实链路：.doc-pane > DocumentEditor 片段（查找条 + .mobile-doc-body + dock/面板）。
  act(() => { root.render(createElement("div", { className: "doc-pane active" }, element)); });
}

const pane = (): HTMLElement => host.querySelector<HTMLElement>(".doc-pane")!;
const body = (): HTMLElement => host.querySelector<HTMLElement>(".mobile-doc-body")!;
const findBar = (): HTMLElement | null => host.querySelector<HTMLElement>(".mb-find");
function geometry(): { top: number; height: number; flowHeight: number } {
  const b = body();
  return { top: flowTop(b), height: b.offsetHeight, flowHeight: flowHeight(pane()) };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  style = document.createElement("style");
  style.textContent = FIND_CSS;
  document.head.append(style);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return fakeHeight(this); });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  style.remove();
  vi.restoreAllMocks();
});

describe("文档内查找条覆盖式（F-A：开/关正文几何不动）", () => {
  it("挂载与卸载查找条：正文容器 top/高度/流内总高完全不变", () => {
    renderEditor(false);
    const closed = geometry();
    expect(closed.top).toBe(0); // 模型自证：关闭时正文在流顶

    renderEditor(true);
    const bar = findBar();
    expect(bar).not.toBeNull();
    expect(fakeHeight(bar!)).toBeGreaterThan(0); // 假布局里查找条确实有高度（防断言空转）
    expect(geometry()).toEqual(closed);

    renderEditor(false);
    expect(findBar()).toBeNull();
    expect(geometry()).toEqual(closed);
  });

  it("查找条是覆盖式浮层：absolute + 贴住工作区正文容器顶部、横跨全宽；层序走既有令牌", () => {
    renderEditor(true);
    const cs = getComputedStyle(findBar()!);
    expect(cs.position).toBe("absolute");
    expect(cs.top).toBe("0px");
    expect(cs.left).toBe("0px");
    expect(cs.right).toBe("0px");
    expect(cs.zIndex).toContain("--mobile-z-topbar");
    // topChrome 契约 nested 语义：inset 恒 0 ⇒ 不消费顶部安全区（浮层定位不写估算值）。
    expect(FIND_CSS_CODE).not.toContain("--mobile-top-safe-area");
  });

  it("查找条挂在正文滚动容器之外（兄弟覆盖，不嵌进 .mobile-doc-body）", () => {
    renderEditor(true);
    const bar = findBar()!;
    expect(body().querySelector(".mb-find")).toBeNull();
    expect(pane().querySelector(":scope > .mb-find")).toBe(bar);
  });
});
