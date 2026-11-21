import { useCallback, useEffect, useMemo, useState } from "react";
import type { TreeNode } from "../../lib/types";
import { bridge } from "../bridge";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import {
  buildNotebookTreeIndex,
  flattenVisibleRows,
  type NotebookTreeRow,
} from "./notebookTreeIndex";

/** 工作区目录的数据所有权：子树、笔记本标题/图标、展开集合与刷新入口。 */
export function useNotebookTreeData(notebookId: string) {
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  /** 目录**首次加载完成**（261122）：工作区的「恢复上次标签」必须等它 —— 树还没到时按空树过滤
   *  会把存档里的标签全判成"已删"、restore([]) 直接清空（用户报「每次打开笔记本标签都被清空」）。 */
  const [treeReady, setTreeReady] = useState(false);
  const [title, setTitle] = useState("知识库");
  const [notebookIcon, setNotebookIcon] = useState<string | null>(null);
  /** 日记本标记（261110）：日记子树的显示顺序 = 时间倒序（判据在 core，不在这里重算）。 */
  const [notebookSpace, setNotebookSpace] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));

  const loadTree = useCallback(async () => {
    const snapshot = await bridge.getWorkspaceSnapshot(notebookId);
    setTree(snapshot.tree);
    setTreeReady(true);
    const notebook = snapshot.notebook;
    if (notebook) {
      setTitle(notebook.title);
      setNotebookIcon(notebook.icon ?? null);
      setNotebookSpace(notebook.space ?? null);
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
  const index = useMemo(
    () => buildNotebookTreeIndex(tree, { diaryRootId: notebookSpace === "diary" ? notebookId : null }),
    [tree, notebookSpace, notebookId],
  );
  const childrenOf = useCallback((parentId: string) => index.childrenOf(parentId), [index]);
  const itemById = useCallback((id: string) => index.byId.get(id), [index]);
  /** 抽屉当前可见的扁平行（只含展开分支）；展开/折叠只重算这一份。 */
  const visibleRows: NotebookTreeRow[] = useMemo(
    () => flattenVisibleRows(index, notebookId, expanded),
    [index, notebookId, expanded],
  );
  // 261120：进入工作区不再自动打开树中第一篇（用户点单：没有标签页就空态）⇒ 这里不再计算 firstNote。

  return {
    tree,
    treeReady,
    setTree,
    title,
    notebookIcon,
    notebookSpace,
    expanded,
    toggleGroup,
    expandGroup,
    childrenOf,
    itemById,
    visibleRows,
    loadTree,
  };
}

export type { NotebookTreeItem, TreeNode };
