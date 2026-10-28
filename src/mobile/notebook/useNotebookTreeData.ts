import { useCallback, useEffect, useMemo, useState } from "react";
import type { TreeNode } from "../../lib/types";
import { bridge } from "../bridge";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import {
  buildNotebookTreeIndex,
  firstNoteInTree,
  flattenVisibleRows,
  type NotebookTreeRow,
} from "./notebookTreeIndex";

/** 工作区目录的数据所有权：子树、笔记本标题/图标、展开集合与刷新入口。 */
export function useNotebookTreeData(notebookId: string) {
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  const [title, setTitle] = useState("知识库");
  const [notebookIcon, setNotebookIcon] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));

  const loadTree = useCallback(async () => {
    const snapshot = await bridge.getWorkspaceSnapshot(notebookId);
    setTree(snapshot.tree);
    const notebook = snapshot.notebook;
    if (notebook) {
      setTitle(notebook.title);
      setNotebookIcon(notebook.icon ?? null);
    }
    return snapshot.tree;
  }, [notebookId]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandGroup = useCallback((id: string) => {
    setExpanded((prev) => prev.has(id) ? prev : new Set(prev).add(id));
  }, []);

  /** 一次 O(n) 的父→子索引：tree 不变就复用（替代每次 filter+sort 的 childrenOf）。 */
  const index = useMemo(() => buildNotebookTreeIndex(tree), [tree]);
  const childrenOf = useCallback((parentId: string) => index.childrenOf(parentId), [index]);
  const itemById = useCallback((id: string) => index.byId.get(id), [index]);
  /** 抽屉当前可见的扁平行（只含展开分支）；展开/折叠只重算这一份。 */
  const visibleRows: NotebookTreeRow[] = useMemo(
    () => flattenVisibleRows(index, notebookId, expanded),
    [index, notebookId, expanded],
  );
  /** 进入工作区自动打开的第一篇文档：一次 O(n)，替代原递归 childrenOf。 */
  const firstNote = useMemo(() => firstNoteInTree(index, notebookId), [index, notebookId]);

  return {
    tree,
    setTree,
    title,
    notebookIcon,
    expanded,
    toggleGroup,
    expandGroup,
    childrenOf,
    itemById,
    visibleRows,
    firstNote,
    loadTree,
  };
}

export type { NotebookTreeItem, TreeNode };
