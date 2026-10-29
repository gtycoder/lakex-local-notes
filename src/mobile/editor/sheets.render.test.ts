// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeBack } from "../ui/backStack";

/**
 * MOB-11 收尾：文档列表 / 大纲（底部 sheet 变体）迁到 MobileSheet 后，
 * 返回栈、遮罩、关闭入口、内容不丢都由原语保证。这里**真实挂载**验行为（不验视觉），
 * 与 ui/MobileSheet.render.test.ts 分工一致：原语自身的行为在原语用例里，组件只验接线。
 */
const toc = vi.hoisted(() => ({
  entries: [{ id: "h1", text: "第一节", depth: 1 }] as Array<{ id: string; text: string; depth: number }>,
}));

// 大纲要读内核 TOC：只在这里替换 lakeBridge，避免测试把 1.25MB 内核拖进来。
vi.mock("../../features/editor/lakeRuntime", () => ({
  lakeBridge: () => ({ kernel: { getDocExtraContent: () => ({ toc: toc.entries }) }, renderer: undefined }),
  resolveScrollNode: () => null,
}));

import { DocListSheet } from "./DocListSheet";
import { OutlineSheet } from "./OutlineSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const render = (element: ReactElement) => act(() => { root.render(element); });

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

const docs = [{ id: "n1", title: "第一篇" }, { id: "n2", title: "第二篇" }];

describe("DocListSheet 迁到 MobileSheet（MOB-11）", () => {
  it("遮罩 / 返回键 / × 都走同一个 onClose；DOM 仍是 .mb-scrim + .mb-sheet", () => {
    const onClose = vi.fn();
    render(createElement(DocListSheet, { open: true, documents: docs, activeId: "n1", onPick: () => undefined, onClose }));
    expect(host.querySelector(".mb-scrim")).not.toBeNull();
    expect(host.querySelector(".mb-sheet")).not.toBeNull();
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("文档列表");

    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);

    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    act(() => { (host.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.click(); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("内容不丢：行/选中态在 .mb-sheet__body 里，点行=切换 + 关闭", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(createElement(DocListSheet, { open: true, documents: docs, activeId: "n1", onPick, onClose }));

    const rows = Array.from(host.querySelectorAll(".mb-sheet__body .med-doc-item")) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("第一篇");
    expect(rows[0].className).toContain("med-active");
    expect(rows[1].className).not.toContain("med-active");

    act(() => { rows[1].click(); });
    expect(onPick).toHaveBeenCalledWith("n2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭 / 空列表：不渲染面板、也不占返回栈；空态文案保留", () => {
    render(createElement(DocListSheet, { open: false, documents: docs, activeId: null, onPick: () => undefined, onClose: () => undefined }));
    expect(host.querySelector(".mb-sheet")).toBeNull();
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);

    render(createElement(DocListSheet, { open: true, documents: [], activeId: null, onPick: () => undefined, onClose: () => undefined }));
    expect(host.querySelector(".mb-empty")?.textContent).toContain("暂无文档");
  });
});

describe("OutlineSheet 底部形态迁到 MobileSheet（MOB-11）", () => {
  it("标题/条目来自 TOC；遮罩与返回键都关面板（不再落到父层）", () => {
    const onClose = vi.fn();
    render(createElement(OutlineSheet, { open: true, editor: null, onClose }));
    const sheet = host.querySelector(".mb-sheet.med-outline-sheet");
    expect(sheet).not.toBeNull();
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("大纲");
    expect(host.querySelector(".med-outline-item")?.textContent).toBe("第一节");

    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("点条目跳转后收起（editor 为空时也不抛）", () => {
    const onClose = vi.fn();
    render(createElement(OutlineSheet, { open: true, editor: null, onClose }));
    act(() => { (host.querySelector(".med-outline-item") as HTMLElement).click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭后不渲染，也不占返回栈", () => {
    render(createElement(OutlineSheet, { open: false, editor: null, onClose: () => undefined }));
    expect(host.querySelector(".mb-scrim")).toBeNull();
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);
  });

  it("side 抽屉变体保留：不是底部 sheet（不套 MobileSheet、不登记返回栈）", () => {
    const onClose = vi.fn();
    render(createElement(OutlineSheet, { side: true, open: true, editor: null, onClose }));
    expect(host.querySelector(".side-panel--right")).not.toBeNull();
    expect(host.querySelector(".mb-scrim")).toBeNull();
    expect(host.querySelector(".mb-sheet")).toBeNull();
    expect(host.querySelector(".mb-sheet__body.side-panel-body.mb-list")).not.toBeNull();
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
