/**
 * 旧 quick-notes 同步通道的类型残留（仅类型，无运行时实现）。
 *
 * 261026 转正 v3 后，旧实现 src/core/quickNotesSyncEngine.ts / quickNotePush.ts 已删除；
 * 仍被 UI/IPC/移动端端口以 **type-only** 引用的几个形状集中在这里，避免它们继续挂在
 * 已删除模块的导入路径上。**不要**在此文件加运行时逻辑，也不要恢复旧通道。
 */
import type { ManifestItem } from "./manifestTypes.js";
import type { QuickNoteTag } from "./quickNoteTags.js";

/** 单条推送的结果（historically: 「保存并同步」的返回类型；现走 v3 整轮同步兜底）。 */
export type QuickNotePushOutcome =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; manifestId: string | null }
  | { status: "full-sync"; reason: "no-remote-manifest" | "remote-deleted"; result: QuickNotesSyncResult }
  | { status: "not-found" };

/** 旧小记整轮同步的汇总（仅移动端 bridge 的历史返回字段引用）。 */
export interface QuickNotesSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
}

export interface QuickNoteSyncItemImage {
  id: string; filename: string; mimeType: string;
  width: number | null; height: number | null; size: number; hash: string;
}

/**
 * 旧 Quick Notes 本地存储端口（平台注入）。
 * 旧引擎已删；移动端 data/quickNotesDbPort.ts 仍实现该形状（schema/端口实现保留，未被 v3 调用）。
 */
export interface QuickNotesSyncDbPort {
  listLocalQuickNotes(): Promise<Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    contentHash: string;
    syncState: string;
    isConflict: boolean;
    images: QuickNoteSyncItemImage[];
    tagIds: string[];
    tagsUpdatedAt: string;
  }>>;
  readContent(id: string): Promise<Uint8Array | null>;
  readAsset(id: string, filename: string): Promise<Uint8Array | null>;
  applyRemoteQuickNote(item: ManifestItem, content: Uint8Array, assets: Array<{ filename: string; bytes: Uint8Array }>): Promise<void>;
  applyRemoteQuickNoteTagLinks(id: string, tagIds: readonly string[], tagsUpdatedAt: string): Promise<void>;
  applyTombstoneContent(id: string, content: Uint8Array): Promise<void>;
  listDeletedQuickNoteAssets(id: string): Promise<QuickNoteSyncItemImage[]>;
  applyTombstoneAssets(id: string, assets: Array<{ metadata: QuickNoteSyncItemImage; bytes: Uint8Array }>): Promise<void>;
  deleteLocalQuickNote(id: string): Promise<void>;
  archiveLocalQuickNoteToTrash(id: string): Promise<void>;
  listDeletedQuickNotes(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>;
  listAllDeletedQuickNotes?(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>;
  markDeletedPublished?(ids: string[]): Promise<void>;
  listDeferredDeletedQuickNotes(): Promise<Array<{ id: string }>>;
  rememberDeletedQuickNote(item: { id: string; createdAt: string; updatedAt: string; deletedAt: string }): Promise<void>;
  revokeLocalDeletion(id: string): Promise<void>;
  isRestorePending(id: string): Promise<boolean>;
  baseHash(id: string): Promise<string | null>;
  setBaseHash(id: string, contentHash: string): Promise<void>;
  markSynced(id: string): Promise<void>;
  markSyncedIfUnchanged?(id: string, expectedContentHash: string): Promise<void>;
  mergeRemoteQuickNoteTags?(remote: readonly QuickNoteTag[]): Promise<QuickNoteTag[]>;
  log(message: string): void;
}
