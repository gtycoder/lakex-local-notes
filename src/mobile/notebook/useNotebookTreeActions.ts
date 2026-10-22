import { useCallback, useState } from "react";
import { bridge } from "../bridge";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";

/** 目录行动作与浮层目标：重命名、图标、移动、删除、历史版本。 */
export function useNotebookTreeActions(opts: {
  tree: readonly NotebookTreeItem[];
  loadTree: () => Promise<NotebookTreeItem[]>;
  discardTab: (id: string) => void;
}) {
  const { tree, loadTree, discardTab } = opts;
  const [menuFor, setMenuFor] = useState<NotebookTreeItem | null>(null);
  const [infoFor, setInfoFor] = useState<NotebookTreeItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [iconFor, setIconFor] = useState<NotebookTreeItem | null>(null);
  const [historyFor, setHistoryFor] = useState<NotebookTreeItem | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);

  const applyRename = useCallback(async () => {
    const id = renamingId;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!id || !title) return;
    try {
      await bridge.renameTreeNode(id, title);
      await loadTree();
    } catch {
      // 与既有行为一致：重命名为非阻断动作，保留当前目录。
    }
  }, [loadTree, renameValue, renamingId]);

  const applyIcon = useCallback(async (icon: string | null) => {
    const node = iconFor;
    if (!node) return;
    try {
      await bridge.setNodeIcon(node.id, icon);
      setIconFor((current) => current?.id === node.id ? { ...current, icon } : current);
      await loadTree();
    } catch {
      showToast("设置图标失败", { type: "error" });
    }
  }, [iconFor, loadTree]);

  const applyDelete = useCallback(async (node: NotebookTreeItem) => {
    const ok = await confirmMobile({
      title: node.kind === "note" ? "移入回收站？" : "删除分组？",
      body: node.title || "无标题",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await bridge.trashTreeItem(node.id, node.kind === "note" ? "note" : "folder");
      await loadTree();
      // 已打开的标签必须一起关掉：否则回收站文档仍留在 tab 里可继续编辑。
      if (node.kind === "note") discardTab(node.id);
      showToast("已移入回收站");
    } catch {
      showToast("删除失败", { type: "error" });
    }
  }, [discardTab, loadTree]);

  const applyMove = useCallback(async (node: NotebookTreeItem, targetParentId: string) => {
    if (node.parentId === targetParentId || node.id === targetParentId) return;
    try {
      const siblings = tree.filter((item) => item.parentId === targetParentId && item.id !== node.id).map((item) => item.id);
      await bridge.moveTreeNodeOrdered(node.id, targetParentId, [...siblings, node.id]);
      await loadTree();
      showToast("已移动");
    } catch {
      showToast("移动失败", { type: "error" });
    }
  }, [loadTree, tree]);

  const openHistory = useCallback(async (node: NotebookTreeItem) => {
    setHistoryFor(node);
    try {
      setHistoryList(await bridge.listNoteHistory(node.id));
    } catch {
      setHistoryList([]);
    }
  }, []);

  const restoreHistory = useCallback(async (historyId: number) => {
    const ok = await confirmMobile({
      title: "恢复此版本？",
      body: "将用该历史版本覆盖当前正文（当前正文会先自动留档）。",
      confirmText: "恢复",
      danger: true,
    });
    if (!ok) return;
    try {
      await bridge.restoreHistory(historyId);
      setHistoryFor(null);
      await loadTree();
      showToast("已恢复历史版本");
    } catch {
      showToast("恢复失败", { type: "error" });
    }
  }, [loadTree]);

  const deleteHistory = useCallback(async (historyId: number) => {
    try {
      await bridge.deleteHistory(historyId);
      setHistoryList((prev) => prev.filter((history) => history.id !== historyId));
    } catch {
      // 与既有行为一致：单条历史删除失败不打断历史面板。
    }
  }, []);

  return {
    menuFor,
    setMenuFor,
    infoFor,
    setInfoFor,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    iconFor,
    setIconFor,
    historyFor,
    setHistoryFor,
    historyList,
    applyRename,
    applyIcon,
    applyDelete,
    applyMove,
    openHistory,
    restoreHistory,
    deleteHistory,
  };
}
