// @vitest-environment jsdom
/**
 * 多文档选择气泡（261111 用户点单）：笔记本内的文档在**右侧**列展开（不内联挤走下面的行），
 * 笔记本行首的整本勾选框仍走 `notebookSelectionState / toggleNotebookRefs`。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const h = vi.hoisted(() => ({ listQuickNotes: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: { listQuickNotes: h.listQuickNotes } }));

import { AiDocPicker } from "./AiDocPicker";

/** usePopoverPosition 在 jsdom 里没有 ResizeObserver ⇒ 打个 noop 桩（与 AiWritingSidebar 用例同口径）。 */
class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

const node = (overrides: Partial<TreeNode>): TreeNode => ({
  id: "id", workspaceId: "desktop", parentId: null, nodeType: "note", title: "文档",
  noteFileId: null, sortOrder: 0, createdAt: "", updatedAt: "", isConflict: false, icon: null, space: null,
  ...overrides,
} as TreeNode);

const tree: TreeNode[] = [
  node({ id: "nb1", nodeType: "notebook", title: "个人笔记" }),
  node({ id: "d1", parentId: "nb1", noteFileId: "f-1", title: "文档一" }),
  node({ id: "d2", parentId: "nb1", noteFileId: "f-2", title: "文档二" }),
  node({ id: "nb2", nodeType: "notebook", title: "测试笔记个" }),
  node({ id: "d3", parentId: "nb2", noteFileId: "f-3", title: "文档三" }),
];

function render(mutate: { selected?: Parameters<typeof AiDocPicker>[0]["selected"]; onToggle?: (ref: unknown) => void; onReplace?: (refs: unknown[]) => void } = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(AiDocPicker, {
      open: true,
      anchor: null,
      treeNodes: tree,
      selected: mutate.selected ?? [],
      onToggle: mutate.onToggle as never ?? (() => {}),
      onReplace: mutate.onReplace as never ?? (() => {}),
      onDismiss: () => {},
    }));
  });
}

const rowOf = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".aiw-picker__row")].find((el) => (el.textContent ?? "").includes(label))!;

beforeEach(() => {
  h.listQuickNotes.mockReset();
  h.listQuickNotes.mockResolvedValue([]);
});
afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; });

describe("AiDocPicker · 笔记本文档在右侧展开", () => {
  it("点笔记本行 ⇒ 右侧出现该本的文档列（而不是内联展开）", () => {
    render();
    expect(document.querySelector(".aiw-picker__side")).toBeNull();
    act(() => { rowOf("个人笔记").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const side = document.querySelector(".aiw-picker__side")!;
    expect(side).toBeTruthy();
    expect(side.querySelector(".aiw-picker__side-title")?.textContent).toBe("个人笔记");
    const labels = [...side.querySelectorAll(".aiw-picker__docs label")].map((el) => (el.textContent ?? "").trim());
    // 顺序按 updatedAt 倒序（夹具里都是空串 ⇒ 只校验集合，不锁顺序）
    expect(labels.sort()).toEqual(["文档一", "文档二"]);
    // 左列仍在（布局不被挤走）：笔记本行数量不变
    expect(document.querySelectorAll(".aiw-picker__grouprow").length).toBe(2);
  });

  it("右侧列里勾选单篇 ⇒ onToggle 收到具体引用", () => {
    const onToggle = vi.fn();
    render({ onToggle });
    act(() => { rowOf("个人笔记").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    // 用原生 .click()：合成 dispatchEvent 不跑 checkbox 的默认激活行为（不会触发 change）
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".aiw-picker__docs input[type=checkbox]")];
    const box = boxes.find((el) => ((el.closest("label")?.textContent as string) ?? "").includes("文档一"))!;
    act(() => { box.click(); });
    expect(onToggle).toHaveBeenCalledWith({ kind: "note", id: "f-1", title: "文档一" });
  });

  it("笔记本行首整本勾选框：勾上 = 该本全部文档进 onReplace（多本各自可勾）", () => {
    const onReplace = vi.fn();
    render({ onReplace });
    const check = document.querySelector<HTMLInputElement>('.aiw-picker__check[aria-label="选择整个笔记本：个人笔记"]')!;
    act(() => { check.click(); });
    expect(onReplace).toHaveBeenCalledTimes(1);
    const refs = onReplace.mock.calls[0][0] as Array<{ id: string }>;
    expect(refs.map((ref) => ref.id).sort()).toEqual(["f-1", "f-2"]);
  });
});