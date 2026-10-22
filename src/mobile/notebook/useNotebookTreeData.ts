import { useCallback, useEffect, useState } from "react";
import type { TreeNode } from "../../lib/types";
import { bridge } from "../bridge";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";

/** 工作区目录的数据所有权：子树、笔记本标题/图标、展开集合与刷新入口。 */
export function useNotebookTreeData(notebookId: string) {
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  const [title, setTitle] = useState("知识库");
  const [notebookIcon, setNotebookIcon] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));

  const loadTree = useCallback(async () => {
    const [treeItems, nodes] = await Promise.all([bridge.listNotebookTree(notebookId), bridge.listTreeNodes()]);
    setTree(treeItems);
    const notebook = nodes.find((node) => node.id === notebookId);
    if (notebook) {
      setTitle(notebook.title);
      setNotebookIcon(notebook.icon ?? null);
    }
    return treeItems;
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

  const childrenOf = useCallback((parentId: string) => (
    tree.filter((item) => item.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  ), [tree]);

  return { tree, setTree, title, notebookIcon, expanded, toggleGroup, expandGroup, childrenOf, loadTree };
}

export type { NotebookTreeItem, TreeNode };
