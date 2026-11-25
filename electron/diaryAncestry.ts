/**
 * 日记子树归属判据——**单一实现**（审计 261125 01-core-backend.md C-03；AGENTS §3#25 日记本固定不可变）。
 *
 * 语义：沿 parent 链向上找 space='diary' 的笔记本；命中返回日记本节点 id，否则 null
 *（节点不存在也返回 null，由调用方的 NotFound 判据兜底）。UNION 防环递归 CTE（原 electron/store.ts 版）：
 * 去重后环上节点各计一次、递归必然收敛（坏库/并发写入不能让守卫死循环）。
 * 调用方：store.diaryNotebookOfTreeNode / diaryNotebookOfNote、noteMetadataRepository 的日记守卫
 *（改名/图标/移动/排序/新建目标判据，AGENTS §3#25）。
 *
 * ⚠️ 变体勿合并：electron/trashDiaryOrigin.ts 的 resolveDiaryOriginNotebookId 沿「原始父链」
 *（deleted_from_parent_id ?? parent_id）走——那是回收站条目的来源解析（徽标/恢复落位），
 * 与本判据边语义不同，**保留独立实现**（两处注释互引，禁止强行合并，AGENTS §3#17）。
 */
import type { DbLike } from "./dbLike.js";
import { DIARY_FOLDER_SPACE } from "../src/core/diary.js";

/** 节点（tree_nodes 行 id）所属日记本 id；不在日记子树返回 null。
 *  链行按「自身 → 逐级祖先」顺序物化，LIMIT 1 取最近命中；正常数据里一条链至多一本日记本
 *（日记本不可嵌套：assertDiaryMove/assertNotDiaryCreateTarget 挡移动/新建，同步 space 单调）。
 *  锚点带 deleted_at IS NULL（原 store.ts 版语义）：已删节点不参与归属判定。 */
export function diaryNotebookOfNode(db: DbLike, id: string): string | null {
  const row = db.prepare(
    "WITH RECURSIVE chain(id,parent_id,node_type,space) AS (" +
      " SELECT id,parent_id,node_type,space FROM tree_nodes WHERE id=? AND deleted_at IS NULL" +
      " UNION" +
      " SELECT t.id,t.parent_id,t.node_type,t.space FROM tree_nodes t JOIN chain c ON t.id=c.parent_id" +
    ") SELECT id FROM chain WHERE node_type='notebook' AND space=? LIMIT 1"
  ).get(id, DIARY_FOLDER_SPACE) as { id: string } | undefined;
  return row?.id ?? null;
}

/** 笔记（notes 行 id）所属日记本 id：先解析 tree_nodes 行（note_file_id 或自身 id 两路边），再走同一条链判据。
 *  原 store.ts 版语义原样保留（F-04 转换前置判据）。 */
export function diaryNotebookOfNote(db: DbLike, noteId: string): string | null {
  const row = db.prepare(
    "SELECT id FROM tree_nodes WHERE (note_file_id=? OR id=?) AND deleted_at IS NULL LIMIT 1"
  ).get(noteId, noteId) as { id: string } | undefined;
  return row ? diaryNotebookOfNode(db, row.id) : null;
}
