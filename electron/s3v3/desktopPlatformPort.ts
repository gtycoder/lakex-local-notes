import type { Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import type {
  NoteSearchCaches, PlatformDataPort, PurgedTombstoneRow, QuickAssetWrite, QuickDeletedRow, QuickPurgeRow,
  QuickNoteSyncRow, QuickNoteWrite, QuickTagRow, SyncFolderRow, SyncNoteMetaRow, SyncNoteWrite,
} from "../../src/core/s3v3/state/platformPort.js";

/**
 * 桌面 `PlatformDataPort`（E2-4 phase B）：把 Store / QuickNotesStore 的既有语义方法映射成窄端口。
 * 这里**不做任何决策**，只做调用转接与类型映射；决策/合并/落库顺序全在 core/state/deviceStore.ts。
 * 所有方法幂等性沿用 Store 实现（importRemoteNote/applyRemoteNoteMeta 等本就幂等）。
 */
export function createDesktopPlatformPort(store: Store, quickNotes?: QuickNotesStore): PlatformDataPort {
  const qn = quickNotes;
  const requireQuick = (): QuickNotesStore => {
    if (!qn) throw new Error("quickNotes 未注入");
    return qn;
  };
  return {
    async listFoldersForSync(): Promise<SyncFolderRow[]> {
      return store.listFoldersForSync();
    },
    async listNotesSyncMeta(): Promise<SyncNoteMetaRow[]> {
      return store.listNotesSyncMeta();
    },
    async listQuickNotesForSync(): Promise<QuickNoteSyncRow[]> {
      if (!qn) return [];
      return qn.listQuickNotesForSync().map((q) => ({
        id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash,
        isConflict: !!q.isConflict,
        tagIds: qn.listQuickNoteTagIds(q.id),
        tagsUpdatedAt: qn.links.tagsUpdatedAt(q.id),
      }));
    },
    async listQuickTags(): Promise<QuickTagRow[]> {
      if (!qn) return [];
      return qn.tags.list({ includeDeleted: true }).map((t) => ({
        id: t.id, name: t.name, sortOrder: t.sortOrder, pinned: t.pinned,
        createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.deletedAt ? { deletedAt: t.deletedAt } : {}),
      }));
    },
    /** 桌面旧口径：quickDeletes 含已 purge 行（保持迁移前行为，由引擎用 quickPurges 区分不可恢复）。 */
    async listQuickDeleted(): Promise<QuickDeletedRow[]> {
      if (!qn) return [];
      return qn.listAllDeleted().map((d) => ({ id: d.id, purgedAt: d.purgedAt ?? null }));
    },
    async listQuickPurges(): Promise<QuickPurgeRow[]> {
      if (!qn) return [];
      const out: QuickPurgeRow[] = [];
      for (const d of qn.listAllDeleted()) if (d.purgedAt) out.push({ id: d.id, purgedAt: d.purgedAt });
      return out;
    },
    async listPurgedTombstones(): Promise<PurgedTombstoneRow[]> {
      return store.listPurgedTombstones().map((t) => ({ id: t.id, purgedAt: t.purgedAt }));
    },
    async listRestorePendingNoteIds(): Promise<string[]> {
      return store.listRestorePendingNoteIds();
    },
    async listRestorePendingQuickNoteIds(): Promise<string[]> {
      return qn ? qn.listRestorePendingQuickNoteIds() : [];
    },
    async listBodyRecoveryPending(): Promise<string[]> {
      return store.listBodyRecoveryPending();
    },
    noteBodyPath(noteId: string): string {
      return store.notePathFor(noteId);
    },
    quickNoteBodyPath(quickNoteId: string): string {
      return requireQuick().quickNotePathFor(quickNoteId);
    },
    async hasNote(noteId: string): Promise<boolean> {
      return store.hasNote(noteId);
    },
    async hasTreeNode(nodeId: string): Promise<boolean> {
      return store.hasTreeNode(nodeId);
    },
    async defaultNotebookId(): Promise<string> {
      return store.defaultNotebookId();
    },
    async importRemoteNote(note: SyncNoteWrite, content: Uint8Array | null, _opts?: { staged?: boolean }): Promise<void> {
      // 桌面 staging 正文在内存（core 已解码传入）；content=null 只可能来自移动 staging 路径。
      if (!content) throw new Error("DesktopStoreDevice: staged 正文缺失（桌面应在内存 staging 中）");
      store.importRemoteNote(note as never, Buffer.from(content), []);
    },
    async saveNote(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void> {
      store.saveNote(noteId, title, content, caches ?? undefined);
    },
    async applyRemoteNoteMeta(note: SyncNoteWrite): Promise<void> {
      store.applyRemoteNoteMeta(note as never);
    },
    async applyRemoteEditLock(noteId: string, locked: boolean, editLockedAt: string | null): Promise<void> {
      store.applyRemoteEditLock(noteId, locked, editLockedAt);
    },
    async setNodeIcon(noteId: string, icon: string): Promise<void> {
      store.setNodeIcon(noteId, icon);
    },
    async deleteNote(noteId: string): Promise<void> {
      store.deleteNote(noteId);
    },
    async restoreTrashItem(noteId: string): Promise<void> {
      store.restoreTrashItem(noteId);
    },
    async applyNotesCloudDeleted(noteIds: string[]): Promise<void> {
      store.applyNotesCloudDeleted(noteIds);
    },
    async markBodyRecoveryPending(noteIds: string[]): Promise<void> {
      store.markBodyRecoveryPending(noteIds);
    },
    async clearBodyRecoveryPending(): Promise<void> {
      store.clearBodyRecoveryPending();
    },
    async importRemoteFolder(folder: SyncFolderRow): Promise<void> {
      store.importRemoteFolder(folder as never);
    },
    async applyRemoteFolderMeta(folder: SyncFolderRow): Promise<void> {
      store.applyRemoteFolderMeta(folder as never);
    },
    async deleteTreeNode(nodeId: string): Promise<void> {
      store.deleteTreeNode(nodeId);
    },
    async listMissingQuickNoteIds(): Promise<string[]> {
      return qn ? qn.listMissingQuickNoteIds() : [];
    },
    async purgeOrphanQuickNote(quickNoteId: string): Promise<void> {
      requireQuick().purgeOrphanQuickNote(quickNoteId);
    },
    async importRemoteQuickNote(item: QuickNoteWrite, body: Uint8Array, assets: QuickAssetWrite[]): Promise<void> {
      requireQuick().importRemoteQuickNote(
        { ...item },
        Buffer.from(body),
        assets.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.bytes) })),
      );
    },
    async markQuickNoteSyncedIfUnchanged(quickNoteId: string, expectedContentHash: string): Promise<void> {
      if (!qn) return;
      qn.markSyncedIfUnchanged(quickNoteId, expectedContentHash);
    },
    async applyQuickNoteTagLinks(quickNoteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void> {
      if (!qn) return;
      qn.applyRemoteQuickNoteTagLinks(quickNoteId, tagIds, tagsUpdatedAt);
    },
    async mergeQuickTags(tags: QuickTagRow[]): Promise<void> {
      if (!qn) return;
      qn.tags.mergeRemote(tags.map((t) => ({
        id: t.id, name: t.name, sortOrder: t.sortOrder, pinned: !!t.pinned,
        createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt ?? null,
      })));
    },
    async purgeQuickNote(quickNoteId: string): Promise<void> {
      requireQuick().purgeQuickNote(quickNoteId);
    },
    async deleteQuickNote(quickNoteId: string): Promise<void> {
      requireQuick().deleteQuickNote(quickNoteId);
    },
    async markQuickNotesCloudDeleted(quickNoteIds: string[]): Promise<void> {
      if (!qn) return;
      qn.markQuickNoteTrashCloudDeleted(quickNoteIds);
    },
  };
}
