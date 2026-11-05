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
      // 文档标签关系（261105 P1）留在**主库** tag_links/versions；这里拼进同步清单。
      const links = store.documentTags.listAll();
      const versions = store.documentTags.allTagsUpdatedAt();
      return store.listNotesSyncMeta().map((note) => {
        const tagIds = links.get(note.id);
        const tagsUpdatedAt = versions.get(note.id) ?? "";
        // P0：有版本时必须显式带 tagIds（空集合也带），否则对端分不清「删光」与「旧索引没字段」。
        return {
          ...note,
          ...(tagsUpdatedAt || (tagIds && tagIds.length > 0) ? { tagIds: [...(tagIds ?? [])] } : {}),
          ...(tagsUpdatedAt ? { tagsUpdatedAt } : {}),
        };
      });
    },
    async listQuickNotesForSync(): Promise<QuickNoteSyncRow[]> {
      if (!qn) return [];
      return qn.listQuickNotesForSync().map((q) => ({
        id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash,
        isConflict: !!q.isConflict,
        // 关系按集合同步：排序后的 ID 列表（顺序是设备本地视图，不传播）。
        tagIds: [...qn.listQuickNoteTagIds(q.id)].sort(),
        tagsUpdatedAt: qn.links.tagsUpdatedAt(q.id),
      }));
    },
    async listQuickTags(): Promise<QuickTagRow[]> {
      if (!qn) return [];
      // 删除 = 缺席（261105）：表里只剩 active 行，**没有墓碑**；顺序是设备本地视图，不发布。
      return qn.tags.list().map((t) => ({
        id: t.id, name: t.name,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
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
    async applyNoteTagLinks(noteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void> {
      // 先按远端 id 落关系（目录可能同一轮才到达），目录收敛在 saveState 末尾统一做（pruneNoteTagLinks）。
      store.documentTags.applyRemote(noteId, tagIds, tagsUpdatedAt);
    },
    async pruneNoteTagLinks(validTagIds: readonly string[]): Promise<void> {
      store.documentTags.cleanupOrphans(new Set(validTagIds));
    },
    // P2-E：文档标签关系版本批量读（主库 tag_link_versions 一次查询；只报有版本的行）。
    async listNoteTagVersions(): Promise<Map<string, string>> {
      return store.documentTags.allTagsUpdatedAt();
    },
    async mergeQuickTags(tags: QuickTagRow[], removedIds: readonly string[] = []): Promise<void> {
      if (!qn) return;
      // 单事务 upsert active 行 + 物理删本轮删除的标签（含清关联/版本、刷搜索索引）全在 QuickNotesStore 里。
      qn.mergeQuickTags(tags, removedIds);
    },
    async listPendingTagDeletes(): Promise<string[]> {
      // 本机待删（离线删过、远端还没确认缺席）：设备本地 DB 记账，不上传。
      return qn ? qn.tags.listPendingDeletes() : [];
    },
    async addPendingTagDeletes(ids: readonly string[]): Promise<void> {
      if (!qn) return;
      // **追加**（幂等）：同步轮进行中用户又删的标签不能被覆盖写丢掉，否则下一轮远端重发就复活。
      qn.tags.addPendingDeletes(ids);
    },
    async settlePendingTagDeletes(ids: readonly string[]): Promise<void> {
      if (!qn) return;
      // **结算**：远端已确认缺席的 id 从待删集合移除；空集合由 store 删掉 device_state 行。
      qn.tags.settlePendingDeletes(ids);
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
