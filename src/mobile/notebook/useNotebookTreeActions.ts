import { useCallback, useState } from "react";
import { bridge } from "../bridge";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { reportMobileActionError } from "../lib/reportMobileActionError";

/**
 * 目录行的**数据动作**（重命名 / 图标 / 移动 / 删除 / 历史版本）。
 *
 * 「浮层正在看哪一个节点」不在这里（MOB-02）：唯一 owner 是 `useWorkspaceOverlays` 的 `overlay`，
 * 本 hook 只接纯动作、节点由调用方传入 —— 否则"面板归属"又会散成第二份 state
 * （面板开着、目标却停在旧节点）。例外：`renamingId/renameValue` 是**行内编辑**（不是浮层），留在这里。
 */
export function useNotebookTreeActions(opts: {
  tree: readonly NotebookTreeItem[];
  loadTree: () => Promise<NotebookTreeItem[]>;
  discardTab: (id: string) => void;
}) {
  const { tree, loadTree, discardTab } = opts;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);

  const applyRename = useCallback(async () => {
    const id = renamingId;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!id || !title) return;
    try {
      await bridge.renameTreeNode(id, title);
      await loadTree();
    } catch (error) {
      // 与既有行为一致：重命名为非阻断动作，保留当前目录；至少留下可观测信号。
      reportMobileActionError("重命名目录项", error);
    }
  }, [loadTree, renameValue, renamingId]);

  /** 设置目录图标；成功返回落库的图标值（调用方据此刷新已打开的图标面板），失败返回 null。 */
  const applyIcon = useCallback(async (node: NotebookTreeItem, icon: string | null): Promise<string | null> => {
    try {
      await bridge.setNodeIcon(node.id, icon);
      await loadTree();
      return icon;
    } catch (error) {
      reportMobileActionError("设置目录图标", error);
      showToast("设置图标失败", { type: "error" });
      return null;
    }
  }, [loadTree]);

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
    } catch (error) {
      reportMobileActionError("删除目录项", error);
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
    } catch (error) {
      reportMobileActionError("移动目录项", error);
      showToast("移动失败", { type: "error" });
    }
  }, [loadTree, tree]);

  /** 读某文档的历史快照列表（「打开历史面板」归 overlay owner，读取归这里）。 */
  const loadHistory = useCallback(async (node: NotebookTreeItem): Promise<void> => {
    try {
      setHistoryList(await bridge.listNoteHistory(node.id));
    } catch (error) {
      reportMobileActionError("读取历史版本", error);
      setHistoryList([]);
    }
  }, []);

  /** 恢复历史版本；成功返回 true（面板由调用方收起，面板归属不在这里）。 */
  const restoreHistory = useCallback(async (historyId: number): Promise<boolean> => {
    const ok = await confirmMobile({
      title: "恢复此版本？",
      body: "将用该历史版本覆盖当前正文（当前正文会先自动留档）。",
      confirmText: "恢复",
      danger: true,
    });
    if (!ok) return false;
    try {
      await bridge.restoreHistory(historyId);
      await loadTree();
      showToast("已恢复历史版本");
      return true;
    } catch (error) {
      reportMobileActionError("恢复历史版本", error);
      showToast("恢复失败", { type: "error" });
      return false;
    }
  }, [loadTree]);

  const deleteHistory = useCallback(async (historyId: number) => {
    try {
      await bridge.deleteHistory(historyId);
      setHistoryList((prev) => prev.filter((history) => history.id !== historyId));
    } catch (error) {
      // 与既有行为一致：单条历史删除失败不打断历史面板；至少留下可观测信号。
      reportMobileActionError("删除历史版本", error);
    }
  }, []);

  return {
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    historyList,
    applyRename,
    applyIcon,
    applyDelete,
    applyMove,
    loadHistory,
    restoreHistory,
    deleteHistory,
  };
}
