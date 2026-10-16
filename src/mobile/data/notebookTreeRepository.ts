import type { MobileDb } from "./sqliteDb";

export interface NotebookTreeItem {
  id: string;
  title: string;
  kind: "group" | "note";
  parentId: string | null;
  sortOrder: number;
  icon: string | null;
}

/** 返回笔记本完整子树；note 也能作为父节点，桌面端嵌套文档在移动端保持可见。 */
export async function listNotebookTree(
  d: MobileDb,
  notebookId: string,
): Promise<NotebookTreeItem[]> {
  const allFolders = await d.prepare(
    "SELECT id, title, parent_id, sort_order, node_type, icon FROM folders WHERE trashed_at IS NULL",
  ).all() as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    sort_order: number;
    node_type: string;
    icon: string | null;
  }>;
  const allNotes = await d.prepare(
    "SELECT id, title, parent_id, sort_order, icon FROM notes WHERE trashed_at IS NULL",
  ).all() as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    sort_order: number;
    icon: string | null;
  }>;

  // folder 和 note 都可作父；从 notebook 根 BFS，支持任意层级嵌套。
  const inTree = new Set<string>();
  const queue = [notebookId];
  while (queue.length > 0) {
    const parentId = queue.pop()!;
    if (inTree.has(parentId)) continue;
    inTree.add(parentId);
    for (const folder of allFolders) {
      if (folder.parent_id === parentId && !inTree.has(folder.id)) queue.push(folder.id);
    }
    for (const note of allNotes) {
      if (note.parent_id === parentId && !inTree.has(note.id)) queue.push(note.id);
    }
  }

  const groups = allFolders.filter(
    (folder) => folder.node_type === "group" && folder.parent_id && inTree.has(folder.parent_id),
  );
  const notes = allNotes.filter((note) => note.parent_id && inTree.has(note.parent_id));
  const items: NotebookTreeItem[] = [
    ...groups.map((group) => ({
      id: group.id,
      title: group.title,
      kind: "group" as const,
      parentId: group.parent_id,
      sortOrder: group.sort_order,
      icon: group.icon ?? null,
    })),
    ...notes.map((note) => ({
      id: note.id,
      title: note.title,
      kind: "note" as const,
      parentId: note.parent_id,
      sortOrder: note.sort_order,
      icon: note.icon ?? null,
    })),
  ];

  // Array#sort 在现代 JS 引擎是稳定排序；不同父节点的相对顺序无业务含义。
  items.sort((a, b) => {
    if (a.parentId !== b.parentId) return 0;
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh");
  });
  return items;
}
