import { MAX_QUICK_NOTE_ATTACHMENT_BYTES, MAX_QUICK_NOTE_IMAGE_BYTES, QuickNotesStore } from "../quickNotes.js";
import { convertQuickNoteToLake } from "../quickNoteConversion.js";
import { pushQuickNoteToS3, restoreQuickNoteFromCloud } from "../quickNotesSync.js";
import { syncNowViaEngine } from "../syncEngineController.js";
import type { QuickNotePushOutcome } from "../../src/core/quickNotePush.js";
import { canTouchNetwork, cloudStateOf, cloudStateHint } from "../../src/core/cloudState.js";
import type { Store } from "../store.js";
import type { IpcRegistrar } from "./registrar.js";

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
  /** 高优先域串行队列（用户当场发起的单条推送**不等整轮同步** —— 判据 PRIORITY_OPS）。 */
  enqueuePriority: <T>(task: () => Promise<T>) => Promise<T>,
): void {
  ipc.handle("list_quick_notes", () => quickNotes.listQuickNotes());
  ipc.handle("create_quick_note", (input: SaveQuickNoteInput) => quickNotes.createQuickNote(input));
  ipc.handle("update_quick_note", (id: string, input: SaveQuickNoteInput) => quickNotes.updateQuickNote(id, input));
  ipc.handle("delete_quick_note", (id: string) => quickNotes.deleteQuickNote(id));
  // ---- 标签子系统（独立）：目录走 tagService；关系走独立 API，正文保存不携带标签 ----
  ipc.handle("list_quick_note_tags", () => quickNotes.tagService.list());
  ipc.handle("create_quick_note_tag", (name: string) => quickNotes.tagService.create(name));
  ipc.handle("update_quick_note_tag", (id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }) => quickNotes.tagService.update(id, patch));
  ipc.handle("reorder_quick_note_tags", (ids: string[]) => quickNotes.tagService.reorder(ids));
  ipc.handle("merge_quick_note_tags", (sourceId: string, targetId: string) => quickNotes.tagService.merge(sourceId, targetId));
  ipc.handle("delete_quick_note_tag", (id: string) => quickNotes.tagService.delete(id));
  ipc.handle("set_quick_note_tags", (id: string, tagIds: string[]) => {
    quickNotes.setQuickNoteTags(id, tagIds);
    return quickNotes.readQuickNote(id);
  });
  ipc.handle("list_quick_note_trash", () => quickNotes.listQuickNoteTrash());
  ipc.handle("restore_quick_note", (id: string) => quickNotes.restoreQuickNote(id));
  ipc.handle("purge_quick_note", (id: string) => quickNotes.purgeQuickNote(id));
  // ---- 缺正文小记（261023）：云端恢复 / 搜索缓存纯文本恢复 / 彻底删除 ----
  const quickCloudAvailable = () => canTouchNetwork(cloudStateOf(store.getS3Settings() !== null, store.getSyncSettings()));
  const quickV3 = () => process.env.LAKE_SYNC_PROTOCOL !== "legacy" && process.env.LAKE_S3V3_QUICK_NOTES !== "0";
  ipc.handle("list_missing_quick_notes", () => quickNotes.listMissingQuickNotes({ cloudConfigured: quickCloudAvailable() }));
  ipc.handle("restore_missing_quick_note_from_cloud", async (id: string) => {
    if (!quickCloudAvailable()) return { ok: false, reason: "cloud-off" };
    const settings = store.getS3Settings();
    if (!settings) return { ok: false, reason: "no-cloud-config" };
    return enqueueMaintenance(() => restoreQuickNoteFromCloud(quickNotes, settings, id));
  });
  ipc.handle("restore_missing_quick_note_from_text", (id: string) => quickNotes.recoverQuickNoteFromText(id));
  ipc.handle("purge_missing_quick_note", (id: string) => quickNotes.purgeMissingQuickNote(id));
  ipc.handle("discard_quick_note_draft", (draftId: string) => quickNotes.discardDraft(draftId));
  ipc.handle("discard_staged_quick_note_image", (draftId: string, imageId: string) => quickNotes.discardStagedImage(draftId, imageId));
  ipc.handle("stage_quick_note_image", (draftId: string, input: QuickNoteImageInput) => {
    // 桌面 IPC 传 Uint8Array（结构化克隆，省内存/时间）；移动端 HTTP JSON 传 number[]，两种都收。
    if (!input || !(input.bytes instanceof Uint8Array) && !Array.isArray(input.bytes)) throw new Error("图片数据无效");
    if (input.bytes.length > MAX_QUICK_NOTE_IMAGE_BYTES) throw new Error("图片超过 25 MiB");
    return quickNotes.stageImage(draftId, input);
  });
  // 小记附件（内核 file 卡）：与图片共用 staging/promote，但走附件上限（设置项在渲染层先拦一道）。
  ipc.handle("stage_quick_note_file", (draftId: string, input: QuickNoteImageInput) => {
    if (!input || !(input.bytes instanceof Uint8Array) && !Array.isArray(input.bytes)) throw new Error("附件数据无效");
    if (input.bytes.length > MAX_QUICK_NOTE_ATTACHMENT_BYTES) throw new Error("附件超过 100 MiB");
    return quickNotes.stageFile(draftId, input);
  });
  ipc.handle("convert_quick_note", (quickNoteId: string, notebookId: string) => convertQuickNoteToLake(quickNotes, store, quickNoteId, notebookId));
  /**
   * 「保存并同步」：只推这一条小记（261013）。
   * - **高优先域**：用户当场发起，**不等**在途整轮同步（长按小记 → 写完 → 桌面端及时看到 是高频场景）；
   * - 出网判据单一来源 core/cloudState（AGENTS §3#20）：没配置/关闭云同步 ⇒ 直接抛，零请求；
   * - 推送成功后往**维护域队尾**排一次**幂等回核**：整轮同步若在"读到本地清单快照"之后才落地，
   *   会把这一条覆盖掉，回核负责补回来（远端不缺则只多读一次清单）。
   */
  ipc.handle("sync_quick_note", async (id: string) => {
    const settings = store.getS3Settings();
    if (!settings) throw new Error("请先保存 S3 配置");
    const state = cloudStateOf(true, store.getSyncSettings());
    if (!canTouchNetwork(state)) throw new Error(cloudStateHint(state) ?? "云同步已关闭：不会联网");
    // v3 转正后：单条推送用整轮 v3 同步兜底（同一设备/索引串行；先检查本地是否存在）。
    if (quickV3()) {
      try { quickNotes.readQuickNote(id); } catch { return { status: "not-found" } satisfies QuickNotePushOutcome; }
      await enqueueMaintenance(async () => { await syncNowViaEngine(store, undefined); });
      return { status: "pushed", uploadedContent: true, uploadedAssets: 0, unchanged: false, manifestId: null } satisfies QuickNotePushOutcome;
    }
    const outcome = await enqueuePriority(() => pushQuickNoteToS3(quickNotes, settings, id));
    if (outcome.status === "pushed") {
      void enqueueMaintenance(async () => {
        try {
          const latest = store.getS3Settings();
          if (!latest) return;
          if (!canTouchNetwork(cloudStateOf(true, store.getSyncSettings()))) return;
          await pushQuickNoteToS3(quickNotes, latest, id);
        } catch { /* 安全网失败：下轮整轮同步自愈（远端缺条目 ⇒ decideUpload 走 upload） */ }
      });
    }
    return outcome;
  });
}
