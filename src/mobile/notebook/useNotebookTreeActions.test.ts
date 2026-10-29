// @vitest-environment jsdom
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
let discardTab: ReturnType<typeof vi.fn>;

function Harness({ tree }: { tree: NotebookTreeItem[] }) {
  api = useNotebookTreeActions({
    tree,
    loadTree: loadTree as () => Promise<NotebookTreeItem[]>,
    discardTab: discardTab as (id: string) => void,
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
  discardTab = vi.fn();
  mocks.confirmMobile.mockResolvedValue(true);
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

  it("删除文档会移入回收站、刷新目录并丢弃对应标签", async () => {
    const note = node("n1", "note");
    render([note]);
    await act(async () => { await api.applyDelete(note); });
    expect(mocks.trashTreeItem).toHaveBeenCalledWith("n1", "note");
    expect(loadTree).toHaveBeenCalledTimes(1);
    expect(discardTab).toHaveBeenCalledWith("n1");
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
    // 面板"看哪个节点"由 useWorkspaceOverlays 拥有 ⇒ 本 hook 只接节点、不存目标
    expect(api).not.toHaveProperty("historyFor");
    expect(api).not.toHaveProperty("openHistory");

    await act(async () => { await api.loadHistory(note); });
    expect(mocks.listNoteHistory).toHaveBeenCalledWith("n1");
    expect(api.historyList).toHaveLength(1);

    let restored = false;
    await act(async () => { restored = await api.restoreHistory(1); });
    expect(mocks.restoreHistory).toHaveBeenCalledWith(1);
    expect(restored).toBe(true);

    // 用户取消确认框 ⇒ false（调用方据此决定不收面板）
    mocks.confirmMobile.mockResolvedValueOnce(false);
    let cancelled = true;
    await act(async () => { cancelled = await api.restoreHistory(1); });
    expect(cancelled).toBe(false);

    await act(async () => { await api.deleteHistory(1); });
    expect(api.historyList).toEqual([]);
  });
});
