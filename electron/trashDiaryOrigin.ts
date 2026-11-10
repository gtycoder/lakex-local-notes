import type { DbLike } from "./dbLike.js";

/**
 * 回收站条目的**来源解析**（261110）：沿「原始父链」向上找 space=diary 的笔记本。
 *
 * 为什么要它：
 * · 徽标 —— 回收站里的条目 parent 已被换成「回收站」笔记本，只能靠 `deleted_from_parent_id` 回溯；
 *   **不看标题**（用户点名的「老六」场景：文档标题刚好写成日期，不能被当成日记）。
 * · 恢复 —— 原父（年/月分组）若已被删/也在回收站，旧逻辑回落到「默认笔记本」= 文档空间，
 *   日记条目就会恢复错空间。这里给出日记本 id，让恢复落回日记空间。
 */
export function resolveDiaryOriginNotebookId(db: DbLike, originParentId: string | null): string | null {
  let current = originParentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = db.prepare(
      "SELECT id, node_type, space, parent_id, deleted_from_parent_id FROM tree_nodes WHERE id=?",
    ).get(current) as { id: string; node_type: string; space: string | null; parent_id: string | null; deleted_from_parent_id: string | null } | undefined;
    if (!row) return null;
    if (row.node_type === "notebook" && row.space === "diary") return row.id;
    current = row.deleted_from_parent_id ?? row.parent_id;
  }
  return null;
}

/** 该日记本此刻是否可用（未进回收站、未被 purge；根层笔记本 trashed_at 为 NULL）。 */
export function isNotebookAvailable(db: DbLike, notebookId: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM tree_nodes WHERE id=? AND node_type='notebook' AND deleted_at IS NULL AND trashed_at IS NULL AND is_purged=0",
  ).get(notebookId);
  return Boolean(row);
}

/**
 * 恢复日记条目时**还原它的年/月分组**（261110）：
 * 原父若是被删掉的月分组，恢复到日记本根虽然"空间对"，但结构不对；
 * 这里按标题日期补建 年/月 分组（已存在则复用），让恢复尽量"原路返回"。
 * 标题不是日期 ⇒ 直接回日记本（调用方不会再猜）。
 */
export function ensureDiaryGroupsForRestore(
  db: DbLike,
  createGroup: (parentId: string, title: string) => { id: string },
  notebookId: string,
  title: string,
): string {
  const matched = /^(\d{4})-(\d{2})-\d{2}$/.exec(title.trim());
  if (!matched) return notebookId;
  const yearTitle = matched[1];
  const monthTitle = matched[2];
  const findGroup = (parentId: string, groupTitle: string): string | null => {
    const row = db.prepare(
      "SELECT id FROM tree_nodes WHERE parent_id=? AND node_type='group' AND title=? AND deleted_at IS NULL ORDER BY sort_order LIMIT 1",
    ).get(parentId, groupTitle) as { id?: string } | undefined;
    return row?.id ?? null;
  };
  let yearId = findGroup(notebookId, yearTitle);
  if (!yearId) yearId = createGroup(notebookId, yearTitle).id;
  const monthId = findGroup(yearId, monthTitle);
  if (!monthId) return createGroup(yearId, monthTitle).id;
  return monthId;
}
