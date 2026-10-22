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

  it("历史版本打开、恢复与单条删除走同一状态所有者", async () => {
    const note = node("n1", "note");
    render([note]);
    await act(async () => { await api.openHistory(note); });
    expect(api.historyFor).toEqual(note);
    expect(api.historyList).toHaveLength(1);

    await act(async () => { await api.restoreHistory(1); });
    expect(mocks.restoreHistory).toHaveBeenCalledWith(1);
    expect(api.historyFor).toBeNull();

    await act(async () => { await api.deleteHistory(1); });
    expect(api.historyList).toEqual([]);
  });
});
