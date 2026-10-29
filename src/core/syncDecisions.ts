/**
 * 同步语义载体（lake-core）：purge 分支判定 + 回收站/已删判定 + 行映射。
 *
 * 源：electron/sync.ts 下载/上传/记账段内联判定 + electron/noteQueries.ts 行映射。
 * 仅"移动代码位置 + 纯函数化"，不改语义（表驱动测试覆盖原内联路径输入输出）。
 * 执行（store 写 / S3 IO）留在各端执行壳，由判定结果驱动——两端共享同一批函数实例。
 */
import { normalizeNoteKind, type NoteKind } from "./noteKind.js";

/** 回收站笔记本 ID —— **单一来源**（CORE-09）：桌面 electron/store.ts 从这里 import/再导出，
 * 不要再在两端各写一份字面量（此前两份字面量无任何相等断言，漂了没人发现）。
 * v4 协议：软删（回收站）= parentId 指向此 + trashedAt；deleted:true 仅用于 purge。
 * ⚠️ 这个字面量是持久化契约（历史 SQLite 行与云端索引都按它判定）⇒ 改它等于数据迁移。 */
export const TRASH_NOTEBOOK_ID = "notebook-trash";

/** 决策函数输入的本地状态快照（普通对象；桌面从 Store 行映射，移动端从 native SQLite 行映射）。 */
export interface LocalNoteState {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; syncState?: string; isConflict: boolean;
  isEditLocked?: boolean; editLockedAt?: string | null; icon?: string | null;
  trashedAt?: string | null; deletedFromParentId?: string | null;
  /** 文档类型（doc | usheet | bitable | board | ink；缺省 doc）。 */
  kind?: NoteKind;
}

/** 行映射输入（对齐桌面 noteQueries.ts SyncNoteRow 字段形态）。 */
export interface SyncNoteRowShape {
  id: string; title: string; parent_id: string | null; sort_order: number;
  updated_at: string; is_dirty: number; is_purged?: number; is_conflict: number;
  is_locked: number; locked_at: string | null; icon: string | null;
  trashed_at: string | null; deleted_from_parent_id: string | null;
  kind?: string | null;
}

// ===== G5：行映射（两端同一映射，避免"同一状态两种解读"） =====
export function rowToLocalState(row: SyncNoteRowShape): LocalNoteState {
  return {
    id: row.id, title: row.title, parentId: row.parent_id, sortOrder: row.sort_order,
    updatedAt: row.updated_at, syncState: row.is_purged === 1 ? "purged" : row.is_dirty === 1 ? "local" : "synced", isConflict: !!row.is_conflict,
    // SQLite 列名冻结：is_locked / locked_at（两端同列）；这里映射成内存名 isEditLocked / editLockedAt。
    isEditLocked: !!row.is_locked, editLockedAt: row.locked_at ?? null, icon: row.icon ?? null,
    trashedAt: row.trashed_at ?? null, deletedFromParentId: row.deleted_from_parent_id ?? null,
    kind: normalizeNoteKind(row.kind),
  };
}

// ===== 下载分支判定 =====

// 261028 清理：manifest v2 的 7 个 legacy 决策（folder 墓碑 / 本地墓碑 / meta LWW /
// 墓碑让位 / upload 条目 / 墓碑条目 / 记账）已删；v3 的同类判断在 s3v3Merge/s3v3Decision。
// decidePurge / rowToLocalState / isGoneNote 保留（rowToLocalState、isGoneNote 仍是生产判据）。

/** purge（deleted:true）分支。前置：rn.deleted === true。 */
export type PurgeDecision = "skip-restore-pending" | "skip-already-purged" | "apply-purge" | "remember-deleted";
export function decidePurge(local: LocalNoteState | null, isRestorePending: boolean): PurgeDecision {
  if (local) {
    if (isRestorePending) return "skip-restore-pending";
    // 幂等跳过：本地行已标 purged（移动端 purge 表示 = 行保留标 purged 可恢复）→ 远端 purge 无新信息，
    // 不重复应用；否则每轮同步重放 applyRemotePurge → appliedRemote 不收敛 + 连带重发布 manifest。
    if (local.syncState === "purged") return "skip-already-purged";
    return "apply-purge";
  }
  return "remember-deleted";
}

/** 文档是否"已进回收站 / 已被他端彻底删除"：这类文档不得再被编辑保存。
 * 打开（含启动恢复最后文档）与同步刷新共用同一判定——此前只有同步路径标记，
 * 于是重启后自动重开的回收站文档会以正常可编辑标签出现（2026-09-04 实数据踩到）。 */
export function isGoneNote(note: { parentId: string | null; syncState?: string; isPurged?: boolean }): boolean {
  return note.parentId === TRASH_NOTEBOOK_ID || note.isPurged === true || note.syncState === "purged";
}
