import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import type { NoteSummary, TreeNode } from "../lib/types";
import { patchNoteById, patchTabById, replaceTreeNode, type OpenTab } from "../desktop/desktopTypes";

export interface UseTreeActionsOptions {
  createNoteIn: (parentId: string | null) => Promise<void>;
  openNote: (id: string) => void;
  setNodeIcon: (node: TreeNode, icon: string | null) => void;
  treeNodes: TreeNode[];
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setConfirmDelete: Dispatch<SetStateAction<TreeNode | null>>;
  setHistoryNoteId: Dispatch<SetStateAction<string | null>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setSearchPanelQuery: Dispatch<SetStateAction<string>>;
  setSearchPanelOpen: Dispatch<SetStateAction<boolean>>;
  setPendingRenameId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/** 树 CRUD 与 Sidebar 操作回调（从 App.tsx 收拢）。 */
export function useTreeActions({
  createNoteIn, openNote, setNodeIcon, treeNodes,
  setTreeNodes, setNotes, setOpenTabs, setConfirmDelete,
  setHistoryNoteId, setHistoryOpen, setSearchPanelQuery, setSearchPanelOpen,
  setPendingRenameId, setError,
}: UseTreeActionsOptions) {
  const createTreeItem = useCallback(async (kind: "notebook" | "group" | "note", parentId: string | null, title?: string) => {
    try {
      if (kind === "note") { await createNoteIn(parentId); return; }
      const resolvedTitle = title?.trim();
      if (!resolvedTitle) return;
      if (kind === "notebook") await native.createNotebook(resolvedTitle);
      else if (parentId) await native.createGroup(parentId, resolvedTitle);
      setTreeNodes(await native.listTreeNodes());
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, []);

  const renameTreeNode = useCallback(async (id: string, title: string) => {
    try {
      const renamed = await native.renameTreeNode(id, title);
      setTreeNodes(replaceTreeNode(renamed));
      if (renamed.noteFileId) {
        setNotes(patchNoteById(renamed.noteFileId, { title: renamed.title, updatedAt: renamed.updatedAt, syncState: "local" }));
        setOpenTabs(patchTabById(renamed.noteFileId, { title: renamed.title }));
      }
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, []);

  const moveTreeNode = useCallback(async (id: string, targetId: string, position: "before" | "inside" | "after") => {
    const moving = treeNodes.find((node) => node.id === id);
    const target = treeNodes.find((node) => node.id === targetId);
    if (!moving || !target) return;
    const parentId = position === "inside" ? target.id : target.parentId;
    // UI 会过滤非法根层落点；这里再做一次边界保护，避免 stale pointerup
    // 或异步树刷新把 note/group 送到根层后弹出"必须位于目录节点下"。
    if (moving.nodeType !== "notebook" && parentId === null) return;
    if (moving.nodeType === "notebook" && parentId !== null) return;
    const sameParent = treeNodes.filter((node) => node.parentId === parentId && node.id !== id).sort((a, b) => a.sortOrder - b.sortOrder);
    const orderedIds = position === "inside"
      ? [...sameParent.map((node) => node.id), id]
      : (() => {
          const at = sameParent.findIndex((node) => node.id === targetId);
          const insertAt = at < 0 ? sameParent.length : position === "after" ? at + 1 : at;
          const next = [...sameParent.map((node) => node.id)];
          next.splice(insertAt, 0, id);
          return next;
        })();
    // 乐观更新：只改受影响节点的 sortOrder/parentId，未涉及的节点保持同一引用 → memo 行不重渲染，落地即时生效。
    // 不再 await 后全量 listTreeNodes（那会让 500+ 行全部重渲染 + FLIP，实测拖一次 ~3s）。
    const orderIndex = new Map(orderedIds.map((childId, index) => [childId, index] as const));
    setTreeNodes((prev) => prev.map((node) => {
      if (node.id === id) return { ...node, parentId, sortOrder: orderIndex.get(id) ?? node.sortOrder };
      const index = orderIndex.get(node.id);
      return index === undefined ? node : { ...node, sortOrder: index };
    }));
    try {
      await native.moveTreeNodeOrdered(id, parentId, orderedIds);
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
      setTreeNodes(await native.listTreeNodes());
    }
  }, [treeNodes, setTreeNodes, setError]);

  // W-2-B：传给 Sidebar 的回调全部稳定化——App 每次渲染（含打字触发的 openTabs 变化）
  // 不再产生新引用，配合 memo(Sidebar) 让树行渲染彻底跳过按键路径。
  const sidebarSelect = useCallback((id: string) => {
    void openNote(id);
  }, [openNote]);
  const sidebarCreate = useCallback((kind: "notebook" | "group" | "note", parentId: string | null, title?: string) => {
    void createTreeItem(kind, parentId, title);
  }, [createTreeItem]);
  const sidebarRename = useCallback((id: string, title: string) => {
    void renameTreeNode(id, title);
  }, [renameTreeNode]);
  const sidebarMove = useCallback((id: string, targetId: string, position: "before" | "inside" | "after") => {
    void moveTreeNode(id, targetId, position);
  }, [moveTreeNode]);
  const sidebarRequestDelete = useCallback((node: TreeNode) => setConfirmDelete(node), []);
  const sidebarSetIcon = useCallback((node: TreeNode, icon: string | null) => {
    void setNodeIcon(node, icon);
  }, [setNodeIcon]);
  const sidebarOpenHistory = useCallback((node: TreeNode) => {
    setHistoryNoteId(node.noteFileId);
    setHistoryOpen(!!node.noteFileId);
  }, []);
  const sidebarOpenSearch = useCallback((q?: string) => {
    setSearchPanelQuery(q ?? "");
    setSearchPanelOpen(true);
  }, []);
  const sidebarPendingRenameConsumed = useCallback(() => setPendingRenameId(null), []);

  /** 复制文档（含附件）：主进程建新文档 → 刷新树 → 打开副本。 */
  const duplicateNode = useCallback(async (node: TreeNode) => {
    if (!node.noteFileId) return;
    try {
      const created = await native.duplicateNote(node.noteFileId);
      setTreeNodes(await native.listTreeNodes());
      openNote(created.id);
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, [openNote, setTreeNodes, setError]);

  return {
    createTreeItem, renameTreeNode, moveTreeNode, duplicateNode,
    sidebarSelect, sidebarCreate, sidebarRename, sidebarMove,
    sidebarRequestDelete, sidebarSetIcon, sidebarOpenHistory, sidebarOpenSearch, sidebarPendingRenameConsumed,
  };
}
