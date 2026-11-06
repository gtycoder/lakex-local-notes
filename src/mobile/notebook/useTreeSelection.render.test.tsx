// @vitest-environment jsdom
/**
 * 文档树多选的动作编排（261106 task-8）：创建副本 / 移动… / 移入回收站 / 返回键。
 * 这里只测 hook（状态 + bridge 调用 + 文案 + 选择态去留），UI 渲染见 NotebookTreeList.render.test 与
 * treeSelectionChrome.render.test；全部走真实 selection 状态机与真实结果文案。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  duplicateNotes: vi.fn(),
  batchNotes: vi.fn(),
  getHomeSnapshot: vi.fn(),
}));
vi.mock("../bridge", () => ({ bridge: bridgeMock }));
const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../ui/toastBus", () => toastMock);
const confirmMock = vi.hoisted(() => ({ confirmMobile: vi.fn() }));
vi.mock("../ui/ConfirmDialog", () => confirmMock);

import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { buildNotebookTreeIndex, flattenVisibleRows } from "./notebookTreeIndex";
import { useTreeSelection } from "./useTreeSelection";
import { consumeBack } from "../ui/backStack";

const node = (id: string, parentId: string | null, sortOrder: number, over: Partial<NotebookTreeItem> = {}): NotebookTreeItem =>
  ({ id, title: "标题-" + id, kind: "note", parentId, sortOrder, icon: null, ...over });

const TREE = [
  node("g1", "nb1", 0, { kind: "group", title: "分组" }),
  node("c1", "g1", 0),
  node("n1", "nb1", 1),
  node("n2", "nb1", 2),
];
const rows = (expanded: string[] = ["nb1"]) => flattenVisibleRows(buildNotebookTreeIndex(TREE), "nb1", new Set(expanded));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let api: ReturnType<typeof useTreeSelection>;
let loadTree: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
let flushSaves: ReturnType<typeof vi.fn<() => Promise<void>>>;

function Harness({ visibleRows }: { visibleRows: ReturnType<typeof rows> }): null {
  api = useTreeSelection({ visibleRows, loadTree, flushSaves });
  return null;
}

async function mount(visibleRows = rows()): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness, { visibleRows })); });
}
const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  bridgeMock.duplicateNotes.mockReset();
  bridgeMock.batchNotes.mockReset();
  bridgeMock.getHomeSnapshot.mockReset();
  toastMock.showToast.mockReset();
  confirmMock.confirmMobile.mockReset().mockResolvedValue(true);
  loadTree = vi.fn(async () => TREE);
  flushSaves = vi.fn(async () => undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("文档树多选：可选集合 / 全选 / 返回键", () => {
  it("可选集合只含文档；全选按目录顺序勾选；返回键先退出选择（不关抽屉）", async () => {
    await mount();
    expect(api.selectableCount).toBe(2); // 可见行 = g1 / n1 / n2（分组不可选；g1 折叠 ⇒ c1 不在可见集合）
    expect(api.selection.active).toBe(false);

    await act(async () => { api.selection.enter(); });
    expect(api.selection.active).toBe(true);
    await act(async () => { api.selection.toggleAll(); });
    expect([...api.selection.ids]).toEqual(["n1", "n2"]); // 分组不可选；g1 折叠 ⇒ 子文档不在可见集合
    expect(api.selection.allSelected).toBe(true);

    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(api.selection.active).toBe(false);
  });
});

describe("文档树多选：创建副本", () => {
  it("批量创建前先 flushSaves（顺序：flush → duplicateNotes）", async () => {
    const order: string[] = [];
    flushSaves.mockImplementationOnce(async () => { order.push("flush"); });
    bridgeMock.duplicateNotes.mockImplementationOnce(async () => {
      order.push("dup");
      return { ok: true, results: [{ id: "n1", ok: true, newId: "x1" }, { id: "n2", ok: true, newId: "x2" }], summary: { total: 2, done: 2, failed: 0 } };
    });
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggleAll(); });
    await act(async () => { api.runAction("duplicate"); });
    await flush();
    expect(order).toEqual(["flush", "dup"]);
  });

  it("flush 失败 ⇒ 不调 duplicateNotes，提示「保存失败，未创建副本」", async () => {
    flushSaves.mockRejectedValueOnce(new Error("disk full"));
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggleAll(); });
    await act(async () => { api.runAction("duplicate"); });
    await flush();
    expect(bridgeMock.duplicateNotes).not.toHaveBeenCalled();
    expect(toastMock.showToast.mock.calls.some(([text]) => String(text).includes("保存失败"))).toBe(true);
  });

  it("成功 ⇒ bridge.duplicateNotes(ids) + toast「已创建 N 个副本」+ 刷新目录 + 退出选择", async () => {
    bridgeMock.duplicateNotes.mockResolvedValue({
      ok: true,
      results: [{ id: "n1", ok: true, newId: "x1" }, { id: "n2", ok: true, newId: "x2" }],
      summary: { total: 2, done: 2, failed: 0 },
    });
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggleAll(); });
    await act(async () => { api.runAction("duplicate"); });
    await flush();

    expect(bridgeMock.duplicateNotes).toHaveBeenCalledWith({ ids: ["n1", "n2"] });
    expect(toastMock.showToast).toHaveBeenCalledWith("已创建 2 个副本");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(api.selection.active).toBe(false);
  });

  it("部分失败 ⇒ toast 给逐条原因 + 保留选择（且已成功的副本仍刷新目录）", async () => {
    bridgeMock.duplicateNotes.mockResolvedValue({
      ok: false,
      results: [{ id: "n1", ok: true, newId: "x1" }, { id: "n2", ok: false, reason: "body-missing" }],
      summary: { total: 2, done: 1, failed: 1 },
    });
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggleAll(); });
    await act(async () => { api.runAction("duplicate"); });
    await flush();

    expect(toastMock.showToast).toHaveBeenCalledWith("已创建 1 个副本，失败 1 项：正文文件缺失，无法复制", { type: "error" });
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(api.selection.active).toBe(true); // 失败保留选择，方便重试
  });

  it("未选任何文档 ⇒ 提示先选，不调桥", async () => {
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.runAction("duplicate"); });
    await flush();
    expect(toastMock.showToast).toHaveBeenCalledWith("请先选择文档");
    expect(bridgeMock.duplicateNotes).not.toHaveBeenCalled();
  });
});

describe("文档树多选：移动… / 移入回收站（复用 bridge.batchNotes）", () => {
  const okBatch = (ids: string[]) => ({ ok: true, results: ids.map((id) => ({ id, ok: true })), summary: { total: ids.length, done: ids.length, failed: 0 } });

  it("移入回收站：二次确认后 batchNotes(trash lake) ⇒ toast + 刷新目录 + 退出选择", async () => {
    bridgeMock.batchNotes.mockResolvedValue(okBatch(["n1", "n2"]));
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggleAll(); });
    await act(async () => { api.runAction("trash"); });
    await flush();

    expect(confirmMock.confirmMobile).toHaveBeenCalledTimes(1);
    expect((confirmMock.confirmMobile.mock.calls[0]?.[0] as { title?: string }).title).toBe("移入回收站？");
    expect(bridgeMock.batchNotes).toHaveBeenCalledWith({ action: "trash", ids: ["n1", "n2"], space: "lake" });
    expect(toastMock.showToast).toHaveBeenCalledWith("已移入回收站 2 项");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(api.selection.active).toBe(false);
  });

  it("移动…：弹目录树（只列容器）→ 确认后 batchNotes(move parentId)", async () => {
    bridgeMock.getHomeSnapshot.mockResolvedValue({
      treeNodes: [
        { id: "nb1", title: "笔记本", parentId: null, nodeType: "notebook" },
        { id: "g1", title: "分组", parentId: "nb1", nodeType: "group" },
        { id: "n1", title: "文档", parentId: "nb1", nodeType: "note" },
      ],
      notes: [{ id: "n1", title: "文档", parentId: "nb1", updatedAt: "2026-11-01T00:00:00.000Z" }],
      quickNotes: { items: [], nextCursor: null },
    });
    bridgeMock.batchNotes.mockResolvedValue(okBatch(["n1"]));
    await mount();
    await act(async () => { api.selection.enter(); });
    await act(async () => { api.selection.toggle("n1"); });
    await act(async () => { api.runAction("move"); });
    await flush();

    expect(api.moveSheet.open).toBe(true);
    expect(api.moveSheet.nodes.map((node) => node.id)).toEqual(["nb1", "g1"]); // 容器才进树；文档不算目标
    expect(api.moveSheet.currentParentId).toBe("nb1");

    await act(async () => { api.moveSheet.onConfirm("g1"); });
    await flush();
    expect(bridgeMock.batchNotes).toHaveBeenCalledWith({ action: "move", ids: ["n1"], space: "lake", parentId: "g1" });
    expect(api.moveSheet.open).toBe(false);
    expect(api.selection.active).toBe(false);
  });
});
