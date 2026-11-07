import { MAX_ATTACHMENT_BYTES as MAX_QUICK_NOTE_ATTACHMENT_BYTES, MAX_IMAGE_BYTES as MAX_QUICK_NOTE_IMAGE_BYTES } from "../../src/core/storeLimits.js";
import { QuickNotesStore } from "../quickNotes.js";
import { convertQuickNoteToLake } from "../quickNoteConversion.js";
import { pushQuickNoteViaEngine } from "../syncEngineController.js";
import { S3v3S3Remote } from "../s3v3/s3Remote.js";
import { fetchQuickNoteFromV3 } from "../s3v3/quickNotesRecovery.js";
import type { QuickNotePushOutcome } from "../../src/core/quickNoteSyncTypes.js";
import { canTouchNetwork, cloudStateOf, cloudStateHint } from "../../src/core/cloudState.js";
import { getQuickNotesAvailability } from "../quickNotesAvailability.js";
import { IpcInputError } from "../ipcLimits.js";
import type { Store } from "../store.js";
import type { IpcRegistrar } from "./registrar.js";
import { toUint8Array } from "./bytes.js";

interface QuickNoteImageInput {
  bytes: number[];
  filename: string;
}

interface SaveQuickNoteInput {
  text: string;
  draftId: string;
  stagedImageIds: string[];
  retainedImageIds?: string[];
}

export function registerQuickNotesIpc(
  ipc: IpcRegistrar,
  quickNotes: QuickNotesStore,
  store: Store,
  /** 维护域串行队列（网络操作必须与整轮同步/GC 互斥，但**不得**占用写域 —— F16 红线）。 */
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>,
): void {
  // DT-05：列表只回 summary（不读正文）；编辑/预览按 id 取单条完整文档。
  ipc.handle("list_quick_notes", () => quickNotes.listQuickNotes());
  ipc.handle("read_quick_note", (id: string) => quickNotes.readQuickNote(id));
  ipc.handle("create_quick_note", (input: SaveQuickNoteInput) => quickNotes.createQuickNote(input));
  ipc.handle("update_quick_note", (id: string, input: SaveQuickNoteInput) => quickNotes.updateQuickNote(id, input));
  ipc.handle("delete_quick_note", (id: string) => quickNotes.deleteQuickNote(id));
  // ---- 标签子系统（独立）：目录走 tagService；关系走独立 API，正文保存不携带标签 ----
  ipc.handle("list_quick_note_tags", () => quickNotes.tagService.list());
  ipc.handle("create_quick_note_tag", (name: string) => quickNotes.tagService.create(name));
  ipc.handle("update_quick_note_tag", (id: string, patch: { name?: string }) => quickNotes.tagService.update(id, patch));
  ipc.handle("reorder_quick_note_tags", (ids: string[]) => quickNotes.tagService.reorder(ids));
  // 261105 P1：目录唯一来源 = 小记库 tags；文档关系在**主库**，删除/合并由主进程跨库协调。
  // 261107：标签关系已统一到小记库 ⇒ 目录变更 + 文档关系清理在**同一事务**里完成（不再吞异常）。
  ipc.handle("merge_quick_note_tags", (sourceId: string, targetId: string) => {
    return store.runTagMutation(quickNotes.databaseHandle, () => {
      const result = quickNotes.tagService.merge(sourceId, targetId);
      store.documentTags.mergeTag(sourceId, targetId);
      return result;
    });
  });
  ipc.handle("delete_quick_note_tag", (id: string) => {
    return store.runTagMutation(quickNotes.databaseHandle, () => {
      const result = quickNotes.tagService.delete(id);
      store.documentTags.removeTag(id);
      return result;
    });
  });
  // ---- 文档标签关系（261105 P1）：目录沿用 list_quick_note_tags；这里只读写主库关系 ----
  ipc.handle("list_note_tag_links", () => {
    // 只返回目录里 active 的 tag id（目录不可用/降级 = 空目录 ⇒ 返回空映射，读类不抛）。
    const allowed = new Set(quickNotes.tagService.list().map((tag) => tag.id));
    const out: Record<string, string[]> = {};
    for (const [noteId, tagIds] of store.documentTags.listAll()) {
      const filtered = tagIds.filter((tagId) => allowed.has(tagId));
      if (filtered.length > 0) out[noteId] = filtered;
    }
    return out;
  });
  ipc.handle("set_note_tags", (noteId: string, rawTagIds: string[]) => {
    if (getQuickNotesAvailability().mode === "degraded") throw new IpcInputError("标签目录暂不可用（小记库降级）：无法设置文档标签");
    if (typeof noteId !== "string" || !noteId) throw new IpcInputError("文档 id 无效");
    if (!Array.isArray(rawTagIds)) throw new IpcInputError("标签列表无效");
    // 存在性/归一校验在协调层（目录唯一来源 = 小记库 tags）。
    const existing = new Set(quickNotes.tagService.list().map((tag) => tag.id));
    const unknown = rawTagIds.filter((tagId) => typeof tagId !== "string" || !existing.has(tagId));
    if (unknown.length > 0) throw new IpcInputError("标签不存在或已删除：" + unknown.map(String).join("、"));
    return store.documentTags.setNoteTags(noteId, rawTagIds);
  });
  ipc.handle("set_quick_note_tags", (id: string, tagIds: string[]) => {
    quickNotes.setQuickNoteTags(id, tagIds);
    return quickNotes.readQuickNote(id);
  });
  ipc.handle("list_quick_note_trash", () => quickNotes.listQuickNoteTrash());
  ipc.handle("restore_quick_note", (id: string) => quickNotes.restoreQuickNote(id));
  ipc.handle("purge_quick_note", (id: string) => quickNotes.purgeQuickNote(id));
  // ---- 缺正文小记（261023）：云端恢复 / 搜索缓存纯文本恢复 / 彻底删除 ----
  const quickCloudAvailable = () => canTouchNetwork(cloudStateOf(store.getS3Settings() !== null, store.getSyncSettings()));
  ipc.handle("list_missing_quick_notes", () => quickNotes.listMissingQuickNotes({ cloudConfigured: quickCloudAvailable() }));
  ipc.handle("restore_missing_quick_note_from_cloud", async (id: string) => {
    if (!quickCloudAvailable()) return { ok: false, reason: "cloud-off" };
    const settings = store.getS3Settings();
    if (!settings) return { ok: false, reason: "no-cloud-config" };
    {
      return enqueueMaintenance(async () => {
        try {
          const remote = new S3v3S3Remote({ endpoint: settings.endpoint, region: settings.region, bucket: settings.bucket, accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, prefix: settings.prefix, forcePathStyle: settings.forcePathStyle });
          const snap = await fetchQuickNoteFromV3(remote, id);
          if (!snap) return { ok: false as const, reason: "not-in-cloud" as const };
          quickNotes.importRemoteQuickNote(
            { id, createdAt: snap.entry.createdAt, updatedAt: snap.entry.updatedAt, contentHash: snap.entry.contentHash, isConflict: !!snap.entry.isConflict },
            Buffer.from(snap.content),
            snap.assets.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.bytes) })),
          );
          quickNotes.applyRemoteQuickNoteTagLinks(id, snap.entry.tagIds ?? [], snap.entry.tagsUpdatedAt ?? "");
          return { ok: true as const };
        } catch { return { ok: false as const, reason: "invalid-content" as const }; }
      });
    }
  });
  ipc.handle("restore_missing_quick_note_from_text", (id: string) => quickNotes.recoverQuickNoteFromText(id));
  ipc.handle("purge_missing_quick_note", (id: string) => quickNotes.purgeMissingQuickNote(id));
  ipc.handle("discard_quick_note_draft", (draftId: string) => quickNotes.discardDraft(draftId));
  ipc.handle("discard_staged_quick_note_image", (draftId: string, imageId: string) => quickNotes.discardStagedImage(draftId, imageId));
  ipc.handle("stage_quick_note_image", (draftId: string, input: QuickNoteImageInput) => {
    // 桌面 IPC 传 Uint8Array；Web/移动端经 HTTP JSON 传 number[]（toUint8Array 单一来源）。
    const bytes = toUint8Array(input?.bytes);
    if (!bytes) throw new Error("图片数据无效");
    if (bytes.length > MAX_QUICK_NOTE_IMAGE_BYTES) throw new Error("图片超过 25 MiB");
    return quickNotes.stageImage(draftId, { ...input, bytes });
  });
  // 小记附件（内核 file 卡）：与图片共用 staging/promote，但走附件上限（设置项在渲染层先拦一道）。
  ipc.handle("stage_quick_note_file", (draftId: string, input: QuickNoteImageInput) => {
    const bytes = toUint8Array(input?.bytes);
    if (!bytes) throw new Error("附件数据无效");
    if (bytes.length > MAX_QUICK_NOTE_ATTACHMENT_BYTES) throw new Error("附件超过 100 MiB");
    return quickNotes.stageFile(draftId, { ...input, bytes });
  });
  ipc.handle("convert_quick_note", (quickNoteId: string, notebookId: string) => convertQuickNoteToLake(quickNotes, store, quickNoteId, notebookId));
  /**
   * 「保存并同步」：只推这一条小记（261013）。
   * - **高优先域**：用户当场发起，**不等**在途整轮同步（长按小记 → 写完 → 桌面端及时看到 是高频场景）；
   * - 出网判据单一来源 core/cloudState（AGENTS §3#20）：没配置/关闭云同步 ⇒ 直接抛，零请求；
   */
  ipc.handle("sync_quick_note", async (id: string) => {
    const settings = store.getS3Settings();
    if (!settings) throw new Error("请先保存 S3 配置");
    const state = cloudStateOf(true, store.getSyncSettings());
    if (!canTouchNetwork(state)) throw new Error(cloudStateHint(state) ?? "云同步已关闭：不会联网");
    // v3 单条推送（parity E2）：只 upsert 这一条，其余条目/标签/墓碑在云端逐字段不变。
    // 两条退回整轮的路径（云端无 pointer / 无基线 / 基线不同代；远端墓碑且本机无恢复标记）
    // 由 pushQuickNoteWithV3 内部执行一次整轮并如实回传 full-sync（不静默降级）。
    try { quickNotes.readQuickNote(id); } catch { return { status: "not-found" } satisfies QuickNotePushOutcome; }
    return enqueueMaintenance(() => pushQuickNoteViaEngine(store, id));
  });
}
