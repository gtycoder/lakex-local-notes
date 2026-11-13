// @vitest-environment jsdom
/**
 * 目录行数据动作（261114 task-8 删除 review）：
 *  · 删除必须用**数据层返回的整棵 subtree note ids** 关闭已打开标签 —— 不依赖当前 tree 是否加载全
 *    （首页入口/未展开子树/未加载的兄弟分支都会漏）；
 *  · 删除前先过统一保存屏障（不丢最后一次输入）；屏障/删除失败都不假装成功。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renameTreeNode: vi.fn(),
  setNodeIcon: vi.fn(),
  trashTreeItem: vi.fn(),
  moveTreeNodeOrdered: vi.fn(),
  listNoteHistory: vi.fn(),
  restoreHistory: vi.fn(),
  deleteHistory: vi.fn(),
  confirmMobile: vi.fn(),
  showToast: vi.fn(),
  dismissNoteTabs: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    renameTreeNode: mocks.renameTreeNode,
    setNodeIcon: mocks.setNodeIcon,
    trashTreeItem: mocks.trashTreeItem,
    moveTreeNodeOrdered: mocks.moveTreeNodeOrdered,
    listNoteHistory: mocks.listNoteHistory,
    restoreHistory: mocks.restoreHistory,
    deleteHistory: mocks.deleteHistory,
  },
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("./tabDismissal", () => ({
  dismissNoteTabs: mocks.dismissNoteTabs,
  registerNoteTabDismisser: vi.fn(() => () => {}),
}));

import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { useNotebookTreeActions } from "./useNotebookTreeActions";

const node = (id: string, kind: "group" | "note", parentId = "nb1", title = id): NotebookTreeItem => ({
  id,
  title,
  kind,
  parentId,
  sortOrder: 0,
  icon: null,
});

type Api = ReturnType<typeof useNotebookTreeActions>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;
let loadTree: ReturnType<typeof vi.fn>;
let flushSaves: ReturnType<typeof vi.fn>;

function Harness({ tree }: { tree: NotebookTreeItem[] }) {
  api = useNotebookTreeActions({
    tree,
    loadTree: loadTree as () => Promise<NotebookTreeItem[]>,
    flushSaves: flushSaves as () => Promise<void>,
  });
  return null;
}

const render = (tree: NotebookTreeItem[]) => {
  act(() => root.render(createElement(Harness, { tree })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  loadTree = vi.fn(async () => []);
  flushSaves = vi.fn(async () => {});
  mocks.confirmMobile.mockResolvedValue(true);
  mocks.trashTreeItem.mockResolvedValue([]);
  mocks.listNoteHistory.mockResolvedValue([{ id: 1, title: "快照", createdAt: "2026-10-22T00:00:00.000Z" }]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useNotebookTreeActions", () => {
  it("重命名保存后刷新目录并退出内联编辑", async () => {
    render([node("g1", "group")]);
    act(() => { api.setRenamingId("g1"); api.setRenameValue("新名字"); });
    await act(async () => { await api.applyRename(); });
    expect(mocks.renameTreeNode).toHaveBeenCalledWith("g1", "新名字");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(api.renamingId).toBeNull();
  });

  it("移动按目标父级现有顺序追加到末尾，并刷新目录", async () => {
    const tree = [node("g1", "group"), node("a", "note", "g1"), node("b", "note")];
    render(tree);
    await act(async () => { await api.applyMove(tree[1], "nb1"); });
    expect(mocks.moveTreeNodeOrdered).toHaveBeenCalledWith("a", "nb1", ["g1", "b", "a"]);
    expect(loadTree).toHaveBeenCalledTimes(1);
  });

  it("删文档：用数据层返回的 ids 关标签（含未在本机 tree 里的级联子文档），删除前先落盘", async () => {
    const note = node("n1", "note");
    // 数据层级联返回：根文档 + 子文档 + 孙文档；其中子/孙文档不在当前 tree（模拟树未加载全）。
    mocks.trashTreeItem.mockResolvedValue(["n1", "n-child", "n-grand"]);
    render([note]);
    await act(async () => { await api.applyDelete(note); });
    expect(mocks.trashTreeItem).toHaveBeenCalledWith("n1", "note");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(mocks.dismissNoteTabs).toHaveBeenCalledWith(["n1", "n-child", "n-grand"]);
    expect(flushSaves).toHaveBeenCalledTimes(1);
    expect(flushSaves.mock.invocationCallOrder[0]).toBeLessThan(mocks.trashTreeItem.mock.invocationCallOrder[0]);
    expect(mocks.showToast).toHaveBeenCalledWith("已移入回收站");
  });

  it("删分组：子树标签按数据层 ids 关闭（不依赖当前 tree 是否加载全）", async () => {
    // 本机 tree 只有 g1 + a；数据层返回 g1 子树里未加载的 b/deep 也一起关。
    const g1 = node("g1", "group");
    const tree = [g1, node("a", "note", "g1")];
    mocks.trashTreeItem.mockResolvedValue(["a", "b", "deep"]);
    render(tree);
    await act(async () => { await api.applyDelete(g1); });
    expect(mocks.trashTreeItem).toHaveBeenCalledWith("g1", "folder");
    expect(mocks.dismissNoteTabs).toHaveBeenCalledWith(["a", "b", "deep"]);
    expect(flushSaves).toHaveBeenCalledTimes(1);
  });

  it("保存屏障失败时不删除（不丢在途编辑、不关标签、不假装成功）", async () => {
    const g1 = node("g1", "group");
    render([g1, node("a", "note", "g1")]);
    flushSaves.mockRejectedValueOnce(new Error("磁盘已满"));
    await act(async () => { await api.applyDelete(g1); });
    expect(mocks.trashTreeItem).not.toHaveBeenCalled();
    expect(mocks.dismissNoteTabs).not.toHaveBeenCalled();
    expect(loadTree).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("删除失败", { type: "error" });
  });

  it("软删失败：不关标签、不刷新目录、给出失败提示", async () => {
    const g1 = node("g1", "group");
    render([g1]);
    mocks.trashTreeItem.mockRejectedValueOnce(new Error("db locked"));
    await act(async () => { await api.applyDelete(g1); });
    expect(mocks.dismissNoteTabs).not.toHaveBeenCalled();
    expect(loadTree).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("删除失败", { type: "error" });
  });

  it("设置图标：成功返回落库值（调用方据此刷新图标面板），失败返回 null", async () => {
    const note = node("g1", "group");
    render([note]);
    let next: string | null = "unset";
    await act(async () => { next = await api.applyIcon(note, "⭐"); });
    expect(mocks.setNodeIcon).toHaveBeenCalledWith("g1", "⭐");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(next).toBe("⭐");

    mocks.setNodeIcon.mockRejectedValueOnce(new Error("boom"));
    let failed: string | null = "unset";
    await act(async () => { failed = await api.applyIcon(note, null); });
    expect(failed).toBeNull();
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it("历史版本：读快照 / 恢复返回结果 / 单条删除；面板归属不在这里（MOB-02）", async () => {
    const note = node("n1", "note");
    render([note]);
    expect(api).not.toHaveProperty("historyFor");
    expect(api).not.toHaveProperty("openHistory");

    await act(async () => { await api.loadHistory(note); });
    expect(mocks.listNoteHistory).toHaveBeenCalledWith("n1");
    expect(api.historyList).toHaveLength(1);

    let restored = false;
    await act(async () => { restored = await api.restoreHistory(1); });
    expect(mocks.restoreHistory).toHaveBeenCalledWith(1);
    expect(restored).toBe(true);

    mocks.confirmMobile.mockResolvedValueOnce(false);
    let cancelled = true;
    await act(async () => { cancelled = await api.restoreHistory(1); });
    expect(cancelled).toBe(false);

    await act(async () => { await api.deleteHistory(1); });
    expect(api.historyList).toEqual([]);
  });
});
