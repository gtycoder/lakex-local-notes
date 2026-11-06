/**
 * 批量操作（261106）**桌面侧只读端口 + 事务**：把 core/batchNotes 需要的"树/父级/环/sortOrder"查询
 * 收在一处（core 保持零平台依赖；IPC 层只做编排）。
 *
 * 口径与既有实现一致（不要另立判据）：
 * - 节点分类读 `tree_nodes.node_type`（notebook / group / note）；回收站判定 = 父链上出现过回收站笔记本
 *   （回收站子树的条目也按"已在回收站"处理，与 `trashLifecycle` 的软删语义一致）。
 * - 环检测复用同一祖先链判据（`NoteMetadataRepository.wouldCreateParentCycle` 同款；那边是私有的，
 *   这里是批量入口的独立实现，判据相同、都带 visited 防坏库死循环）。
 */
import type { DbLike } from "./dbLike.js";
import type { BatchNotesNodeInfo, BatchNotesParentStatus } from "../src/core/batchNotes.js";

interface TreeRow { id: string; node_type: string; parent_id: string | null; deleted_at: string | null }

/** 防坏库死循环：祖先链超过这个长度一律按"在回收站/成环"处理。 */
const MAX_CHAIN = 100_000;

export class BatchNotesRepository {
  constructor(private readonly deps: { db: DbLike; trashNotebookId: string }) {}

  /** 节点分类；null = 不存在 / 已彻底删除。 */
  describe(id: string): BatchNotesNodeInfo | null {
    const row = this.deps.db.prepare("SELECT id,node_type,parent_id,deleted_at FROM tree_nodes WHERE id=?").get(id) as TreeRow | undefined;
    if (!row || row.deleted_at) return null;
    return { kind: this.kindOf(row.node_type), trashed: this.isInTrashTree(row) };
  }

  /** 目标父级（null = 根层）：必须存在、未删除、是容器（笔记本/分组）、且不在回收站里。 */
  describeParent(parentId: string | null): BatchNotesParentStatus {
    if (parentId === null) return "ok";
    const row = this.deps.db.prepare("SELECT id,node_type,parent_id,deleted_at FROM tree_nodes WHERE id=?").get(parentId) as TreeRow | undefined;
    if (!row || row.deleted_at) return "not-found";
    if (row.node_type === "note") return "not-a-container";
    return this.isInTrashTree(row) ? "in-trash" : "ok";
  }

  /** 把 id 的父改成 parentId 是否成环（自身或后代）。 */
  wouldCreateCycle(id: string, parentId: string | null): boolean {
    if (!parentId) return false;
    let cur: string | null = parentId;
    const seen = new Set<string>();
    while (cur !== null) {
      if (cur === id) return true;
      if (seen.has(cur)) return false; // 已存在的环（不含本节点）不归这里管
      seen.add(cur);
      if (seen.size > MAX_CHAIN) return true;
      const row = this.deps.db.prepare("SELECT parent_id FROM tree_nodes WHERE id=?").get(cur) as { parent_id: string | null } | undefined;
      cur = row?.parent_id ?? null;
    }
    return false;
  }

  /** 追加到目标父级末尾用的 sortOrder（现有最大 + 1；根层也要正确算）。 */
  nextSortOrder(parentId: string | null): number {
    const row = (parentId === null
      ? this.deps.db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS max_order FROM tree_nodes WHERE parent_id IS NULL AND deleted_at IS NULL").get()
      : this.deps.db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS max_order FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL").get(parentId)) as { max_order: number } | undefined;
    return Number(row?.max_order ?? -1) + 1;
  }

  /** 批量操作的**单个事务**（better-sqlite3 支持嵌套 ⇒ 内部单条写方法的 transaction 变成 SAVEPOINT）。 */
  transaction<T>(fn: () => T): T {
    return this.deps.db.transaction(() => fn())() as T;
  }

  private kindOf(nodeType: string): BatchNotesNodeInfo["kind"] {
    if (nodeType === "notebook") return "notebook";
    if (nodeType === "group") return "folder";
    return "note";
  }

  /** 父链上是否出现回收站笔记本（含顶层与子树条目）。 */
  private isInTrashTree(row: TreeRow): boolean {
    if (row.parent_id === this.deps.trashNotebookId) return true;
    let cur: string | null = row.parent_id;
    const seen = new Set<string>([row.id]);
    while (cur !== null) {
      if (cur === this.deps.trashNotebookId) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);
      if (seen.size > MAX_CHAIN) return true;
      const parent = this.deps.db.prepare("SELECT parent_id FROM tree_nodes WHERE id=?").get(cur) as { parent_id: string | null } | undefined;
      cur = parent?.parent_id ?? null;
    }
    return false;
  }
}
