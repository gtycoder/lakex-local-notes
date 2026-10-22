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
  // folder 和 note 都可作父：递归 CTE 只取当前笔记本子树，结果不再把全库行送到 JS。
  const items = await d.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM folders WHERE id=? AND trashed_at IS NULL
      UNION
      SELECT child.id
        FROM (
          SELECT id, parent_id FROM folders WHERE trashed_at IS NULL
          UNION ALL
          SELECT id, parent_id FROM notes WHERE trashed_at IS NULL
        ) child
        JOIN subtree parent ON child.parent_id=parent.id
    )
    SELECT id, title, parent_id, sort_order, 'group' AS kind, icon
      FROM folders
     WHERE node_type='group' AND trashed_at IS NULL AND parent_id IN (SELECT id FROM subtree)
    UNION ALL
    SELECT id, title, parent_id, sort_order, 'note' AS kind, icon
      FROM notes
     WHERE trashed_at IS NULL AND parent_id IN (SELECT id FROM subtree)
  `).all(notebookId) as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    sort_order: number;
    kind: "group" | "note";
    icon: string | null;
  }>;

  const mapped: NotebookTreeItem[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    parentId: item.parent_id,
    sortOrder: item.sort_order,
    icon: item.icon ?? null,
  }));

  // Array#sort 在现代 JS 引擎是稳定排序；不同父节点的相对顺序无业务含义。
  mapped.sort((a, b) => {
    if (a.parentId !== b.parentId) return 0;
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh");
  });
  return mapped;
}
