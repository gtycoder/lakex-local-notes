/**
 * 同步语义载体（lake-core，Step B 拆分产物）：分支判定 + 条目构造 + 记账决策 + 行映射。
 *
 * 源：electron/sync.ts 下载/上传/记账段内联判定 + electron/noteQueries.ts 行映射。
 * 仅"移动代码位置 + 纯函数化"，不改语义（表驱动测试覆盖原内联路径输入输出）。
 * 执行（store 写 / S3 IO）留在各端执行壳，由判定结果驱动——两端共享同一批函数实例。
 */
import type { ManifestNote } from "./manifestTypes.js";
import { normalizeNoteKind, type NoteKind } from "./noteKind.js";

/** 回收站笔记本（对齐桌面 electron/store.ts:33 TRASH_NOTEBOOK_ID）。
 * v4 协议：软删（回收站）= parentId 指向此 + trashedAt；deleted:true 仅用于 purge。 */
export const TRASH_NOTEBOOK_ID = "notebook-trash";

/** 决策函数输入的本地状态快照（普通对象；桌面从 Store 行映射，移动端从 native SQLite 行映射）。 */
export interface LocalNoteState {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; syncState?: string; isConflict: boolean;
  isLocked?: boolean; lockedAt?: string | null; icon?: string | null;
  trashedAt?: string | null; deletedFromParentId?: string | null;
  /** v6：文档类型（缺省 doc）。 */
  kind?: NoteKind;
}

/** 行映射输入（对齐桌面 noteQueries.ts SyncNoteRow 字段形态）。 */
export interface SyncNoteRowShape {
  id: string; title: string; parent_id: string | null; sort_order: number;
  updated_at: string; sync_state: string; is_conflict: number;
  is_locked: number; locked_at: string | null; icon: string | null;
  trashed_at: string | null; deleted_from_parent_id: string | null;
  kind?: string | null;
}

// ===== G5：行映射（两端同一映射，避免"同一状态两种解读"） =====
export function rowToLocalState(row: SyncNoteRowShape): LocalNoteState {
  return {
    id: row.id, title: row.title, parentId: row.parent_id, sortOrder: row.sort_order,
    updatedAt: row.updated_at, syncState: row.sync_state, isConflict: !!row.is_conflict,
    isLocked: !!row.is_locked, lockedAt: row.locked_at ?? null, icon: row.icon ?? null,
    trashedAt: row.trashed_at ?? null, deletedFromParentId: row.deleted_from_parent_id ?? null,
    kind: normalizeNoteKind(row.kind),
  };
}

// ===== 下载分支判定 =====

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

/** v5 folder 墓碑（deleted:true）分支。输入：本地是否已有 folder 墓碑（isFolderPurged）、是否有活跃行（listFoldersForSync 含软删行、过滤 purged）。 */
export type FolderPurgeDecision = "skip-already-purged" | "apply-purge" | "remember-deleted";
export function decideFolderPurge(isFolderPurged: boolean, hasLiveFolder: boolean): FolderPurgeDecision {
  if (isFolderPurged) return "skip-already-purged";
  return hasLiveFolder ? "apply-purge" : "remember-deleted";
}

/** 本地墓碑 vs 远端 active：按 updatedAt LWW（删除 vs 远端恢复）。tombAt undefined → none。 */
export type LocalTombstoneDecision = "none" | "revoke" | "keep-local-delete";
export function decideLocalTombstone(remoteUpdatedAt: string, tombAt: string | undefined): LocalTombstoneDecision {
  if (tombAt === undefined) return "none";
  return remoteUpdatedAt > tombAt ? "revoke" : "keep-local-delete";
}

/** 元数据 LWW（正文相同分支）：远端 updatedAt 新于已确认版本 → 应用远端。 */
export function decideMetaApply(remoteUpdatedAt: string, lastSyncedMetaAt: string | null): boolean {
  return lastSyncedMetaAt === null || remoteUpdatedAt > lastSyncedMetaAt;
}

// ===== 上传分支判定 =====

/** 墓碑 vs 远端恢复 LWW：远端已 active 且更新 → 墓碑让位（不回写覆盖）。 */
export function decideTombstoneYield(deletedAt: string, remoteNote: ManifestNote | null | undefined): boolean {
  if (!remoteNote) return false;
  return !remoteNote.deleted && remoteNote.updatedAt > deletedAt;
}

// ===== G1：manifest 条目构造（v4 编码，防旧 C1 编码漂移复发） =====

export interface UploadEntryInput {
  note: LocalNoteState;
  contentHash: string;
  assets: ManifestNote["assets"];
  /** TRASH 时传入（skip-fast 传远端 entry.trashedAt，正常上传传本地 note.trashedAt） */
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

export function buildUploadEntry(input: UploadEntryInput): ManifestNote {
  const { note, contentHash, assets } = input;
  const inTrash = note.parentId === TRASH_NOTEBOOK_ID;
  return {
    id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
    updatedAt: note.updatedAt, contentHash, isConflict: note.isConflict,
    isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, assets,
    // 只写非 doc：键缺席 = doc（旧端/旧清单兼容，且纯文档库的条目保持逐字节不变）
    ...(note.kind && note.kind !== "doc" ? { kind: note.kind } : {}),
    trashedAt: inTrash ? (input.trashedAt ?? null) : undefined,
    deletedFromParentId: inTrash ? (input.deletedFromParentId ?? null) : undefined,
  };
}

/** 墓碑条目：轻量（只带正文 contentHash，不携带资源列表；deleted:true + deletedAt）。 */
export function buildTombstoneEntry(
  deleted: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string },
  tombHash: string,
): ManifestNote {
  return {
    id: deleted.id, title: deleted.title, parentId: deleted.parentId,
    sortOrder: deleted.sortOrder, updatedAt: deleted.updatedAt,
    contentHash: tombHash, isConflict: false, assets: [],
    deleted: true, deletedAt: deleted.deletedAt,
  };
}

// ===== G2：记账决策（lastUploadedHash 语义 = 已发布到 latest 的 hash；deleted 墓碑跳过） =====

export interface BookkeepingItem {
  id: string;
  contentHash: string;
  snapshot: {
    contentHash: string; updatedAt: string; title: string;
    parentId: string | null; sortOrder: number;
    isLocked: boolean; lockedAt: string | null; icon: string | null;
  };
}

export function computeBookkeeping(manifestNotes: ManifestNote[]): BookkeepingItem[] {
  const out: BookkeepingItem[] = [];
  for (const note of manifestNotes) {
    // 墓碑是占位 contentHash，绝不写入 sync_base/lastUploadedHash（对齐桌面 sync.ts:784）
    if (note.deleted) continue;
    out.push({
      id: note.id,
      contentHash: note.contentHash,
      snapshot: {
        contentHash: note.contentHash,
        updatedAt: note.updatedAt,
        title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
        isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null,
      },
    });
  }
  return out;
}

/** 文档是否"已进回收站 / 已被他端彻底删除"：这类文档不得再被编辑保存。
 * 打开（含启动恢复最后文档）与同步刷新共用同一判定——此前只有同步路径标记，
 * 于是重启后自动重开的回收站文档会以正常可编辑标签出现（2026-09-04 实数据踩到）。 */
export function isGoneNote(note: { parentId: string | null; syncState: string }): boolean {
  return note.parentId === TRASH_NOTEBOOK_ID || note.syncState === "purged";
}
