/**
 * 移动端笔记本子树查询（只读）：返回笔记本完整子树，供目录抽屉/工作区树渲染。
 * 契约面：NotebookTreeItem（kind=group|note、noteKind 分型取默认图标、createdAt 供日记同日排序）。
 * 不变量：note 也能作父节点（文档下可有多级子文档，AGENTS §3#5）；递归 CTE 只取当前笔记本子树；
 * 本文件只读、不写库、不碰回收站语义（trashSubtree 判据在 data/trashSubtree）。
 */
import type { MobileDb } from "./dbPortTypes";

export interface NotebookTreeItem {
  id: string;
  title: string;
  kind: "group" | "note";
  /** 文档类型（doc / usheet / bitable / board / ink；分组无）——默认图标按它分型（261117）。 */
  noteKind?: string;
  parentId: string | null;
  sortOrder: number;
  icon: string | null;
  /** 创建时间（仅 note 有；261110 日记树同日多篇按它倒序）。 */
  createdAt?: string;
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
    SELECT id, title, parent_id, sort_order, 'group' AS kind, NULL AS note_kind, icon, NULL AS created_at
      FROM folders
     WHERE node_type='group' AND trashed_at IS NULL AND parent_id IN (SELECT id FROM subtree)
    UNION ALL
    SELECT id, title, parent_id, sort_order, 'note' AS kind, doc_kind AS note_kind, icon, created_at
      FROM notes
     WHERE trashed_at IS NULL AND parent_id IN (SELECT id FROM subtree)
  `).all(notebookId) as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    sort_order: number;
    kind: "group" | "note";
    note_kind: string | null;
    icon: string | null;
    created_at: string | null;
  }>;

  const mapped: NotebookTreeItem[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    noteKind: item.note_kind ?? undefined,
    parentId: item.parent_id,
    sortOrder: item.sort_order,
    icon: item.icon ?? null,
    createdAt: item.created_at ?? "",
  }));

  // Array#sort 在现代 JS 引擎是稳定排序；不同父节点的相对顺序无业务含义。
  mapped.sort((a, b) => {
    if (a.parentId !== b.parentId) return 0;
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh");
  });
  return mapped;
}
