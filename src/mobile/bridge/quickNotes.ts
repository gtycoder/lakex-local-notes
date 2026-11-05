/** C3-5 第③步：quickNotes 域（从 bridge.ts 抽取，行为保持）。 */
import { assertS3Credentials, assets, ensureDb, runPriority, runWrite } from "./context";

import { saveAssetBytesFs, loadAssetBytesFs, removeQuickNoteAssetsDirFs } from "../native/assetFs";
import type { QuickNotePushOutcome } from "../../core/quickNoteSyncTypes.js";
import { buildAssetFilename, mimeTypeForFilename } from "../../core/assetNaming.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { canTouchNetwork, cloudStateHint, type CloudState } from "../../core/cloudState.js";
import { validateQuickNoteContent, type StoredQuickNoteContent, type StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { sha256Hex } from "../../core/syncUtils.js";
import type { QuickNotePage, QuickNotePageOptions, QuickNoteTrashItem } from "../data/quickNotesRepository.js";

import * as quickNotesRepository from "../data/quickNotesRepository.js";
import { mobileQuickNoteTags } from "../data/quickNoteTagService.js";
import { ensureAssetsNative, mobileCloudState, pushSingleQuickNote, syncDomain } from "./sync";
import { applyRestoredQuickNote, rebuildQuickNoteContentFromText } from "../data/missingBodies.js";


export const quickNotesDomain = {
  async getQuickNotePage(options?: QuickNotePageOptions): Promise<QuickNotePage> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNotePage(d, options);
  },

  async readQuickNote(id: string): Promise<{ id: string; content: StoredQuickNoteContent; tagIds: string[]; tags: string[]; previewText: string; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNote(d, id);
  },

  // ---- 标签子系统（独立）：目录走 service；关系走独立 API ----
  async listQuickNoteTags() {
    const d = await ensureDb();
    return await mobileQuickNoteTags.list(d);
  },

  async createQuickNoteTag(name: string) {
    return runWrite("createQuickNoteTag", async () => {
      const d = await ensureDb();
      return await mobileQuickNoteTags.create(d, name);
    });
  },

  async updateQuickNoteTag(id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }) {
    return runWrite("updateQuickNoteTag", async () => {
      const d = await ensureDb();
      return await mobileQuickNoteTags.update(d, id, patch);
    });
  },

  async reorderQuickNoteTags(ids: string[]) {
    return runWrite("reorderQuickNoteTags", async () => {
      const d = await ensureDb();
      return await mobileQuickNoteTags.reorder(d, ids);
    });
  },

  async mergeQuickNoteTags(sourceId: string, targetId: string) {
    return runWrite("mergeQuickNoteTags", async () => {
      const d = await ensureDb();
      return await mobileQuickNoteTags.merge(d, sourceId, targetId);
    });
  },

  async deleteQuickNoteTag(id: string) {
    return runWrite("deleteQuickNoteTag", async () => {
      const d = await ensureDb();
      return await mobileQuickNoteTags.delete(d, id);
    });
  },

  /** 标签关系（独立 API）：整组替换。 */
  async setQuickNoteTags(id: string, tagIds: string[]) {
    return runWrite("setQuickNoteTags", async () => {
      const d = await ensureDb();
      await mobileQuickNoteTags.setNoteTags(d, id, tagIds);
      return await quickNotesRepository.readQuickNote(d, id);
    });
  },

  async saveQuickNote(id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
    return runWrite("saveQuickNote", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, images);
      return result;
    });
  },

  async saveQuickNoteWithImages(id: string, text: string, imageFiles: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }> = []): Promise<string> {
    return runWrite("saveQuickNoteWithImages", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNoteWithImages(d, id, text, imageFiles, {
        assets,
        saveAssetFile: saveAssetBytesFs,
      });
      return result;
    });
  },

  async getQuickNoteDraft(): Promise<{ id: string; text: string; body?: string; images: StoredQuickNoteImage[]; tagIds?: string[]; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNoteDraft(d);
  },

  async saveQuickNoteDraft(draft: { id: string; text: string; body?: string; images?: StoredQuickNoteImage[]; tagIds?: string[] }): Promise<void> {
    return runWrite("saveQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.writeQuickNoteDraft(d, { id: draft.id, text: draft.text, body: draft.body, images: draft.images ?? [], tagIds: draft.tagIds ?? [], updatedAt: new Date().toISOString() });
    });
  },

  async clearQuickNoteDraft(): Promise<void> {
    return runWrite("clearQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.clearQuickNoteDraft(d);
    });
  },

  async stageQuickNoteAsset(id: string, input: { filename: string; bytes: Uint8Array }): Promise<{ filename: string; mimeType: string; size: number; url: string }> {
    if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.length === 0) throw new Error("资源数据无效");
    const stored = buildAssetFilename(input.filename);
    const key = `quick-notes/${id}/${stored}`;
    assets.set(key, input.bytes);
    await saveAssetBytesFs(key, input.bytes);
    return {
      filename: stored,
      mimeType: mimeTypeForFilename(stored),
      size: input.bytes.length,
      url: localAssetHttpUrl(id, stored, { space: "quick-notes" }),
    };
  },

  async saveQuickNoteContent(id: string, payload: { text: string; body: string; images: StoredQuickNoteImage[] }): Promise<string> {
    return runWrite("saveQuickNoteContent", async () => {
      const d = await ensureDb();
      return await quickNotesRepository.saveQuickNoteContent(d, id, payload);
    });
  },

  async syncQuickNote(id: string): Promise<QuickNotePushOutcome> {
    if ((await mobileCloudState()) === "offline") throw new Error(cloudStateHint("offline") ?? "云同步已关闭");
    const outcome = await runPriority("syncQuickNote", () => pushSingleQuickNote(id));
    return outcome;
  },

  async getCloudState(): Promise<CloudState> {
    return mobileCloudState();
  },

  async createQuickNote(text: string): Promise<string> {
    return runWrite("createQuickNote", async () => {
      const d = await ensureDb();
      const id = crypto.randomUUID();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, []);
      return result;
    });
  },

  async deleteQuickNote(id: string): Promise<void> {
    return runWrite("deleteQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.deleteQuickNote(d, id);
    });
  },

  async getQuickNoteImage(id: string, filename: string): Promise<Uint8Array | null> {
    return loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  },

  async listQuickNoteTrash(): Promise<QuickNoteTrashItem[]> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNoteTrash(d);
  },

  async restoreQuickNote(id: string): Promise<void> {
    return runWrite("restoreQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.restoreQuickNote(d, id);
    });
  },

  async purgeQuickNote(id: string): Promise<void> {
    return runWrite("purgeQuickNote", async () => {
      const d = await ensureDb();
      // MOB-06：彻底删除连图片目录一起清（quick-notes/assets/{id}/）；失败由仓储告警、不阻断墓碑。
      await quickNotesRepository.purgeQuickNote(d, id, removeQuickNoteAssetsDirFs);
    });
  },

  // ---- 缺正文小记的恢复（261104 B-lite）----
  // 小记**没有历史快照**（AGENTS §3#3 小记不备份）：只有两条路 —— 云端镜像，或搜索索引全文缓存（有损）。

  /**
   * 「从云端拉回」这一条小记（用户显式发起，高优先域）。
   * 链路与桌面 electron/s3v3/quickNotesRecovery 同源：pointer → quick-notes 索引 → 内容寻址正文
   * quick-notes/objects/{hash}.qnote → **校验 sha256** → 落盘并标 synced；图片走按需补拉 best-effort。
   * 失败明确回报 reason（不静默、不写空正文）。
   */
  async restoreMissingQuickNoteFromCloud(
    id: string,
  ): Promise<{ ok: true } | { ok: false; reason: "cloud-off" | "no-cloud-config" | "not-found" | "not-in-cloud" | "object-missing" | "hash-mismatch" | "invalid-content" }> {
    return runPriority("restoreMissingQuickNoteFromCloud", async () => {
      if (!canTouchNetwork(await mobileCloudState())) return { ok: false as const, reason: "cloud-off" as const };
      const cfg = await syncDomain.getS3Settings();
      if (!cfg) return { ok: false as const, reason: "no-cloud-config" as const };
      try { assertS3Credentials(cfg); } catch { return { ok: false as const, reason: "no-cloud-config" as const }; }
      const d = await ensureDb();
      const row = await d.prepare("SELECT 1 AS one FROM quick_notes WHERE id=?").get(id);
      if (!row) return { ok: false as const, reason: "not-found" as const };
      // P9：v3 远端/协议常量按需加载（缺正文恢复低频，不进首屏静态图）。
      const [{ createMobileS3v3Remote }, keys, indexMod, types] = await Promise.all([
        import("../v3/s3v3Remote.js"),
        import("../../core/s3v3/protocol/s3v3Keys.js"),
        import("../../core/s3v3/protocol/s3v3Index.js"),
        import("../../core/s3v3/protocol/s3v3Types.js"),
      ]);
      const remote = createMobileS3v3Remote(cfg);
      const pointerBytes = await remote.get(keys.S3V3_POINTER_KEY);
      if (!pointerBytes) return { ok: false as const, reason: "not-in-cloud" as const };
      let pointer: { quickNotes: { commit: string } };
      try {
        const parsed = types.validatePointer(JSON.parse(new TextDecoder().decode(pointerBytes)));
        if (!parsed.ok) return { ok: false as const, reason: "not-in-cloud" as const };
        pointer = parsed.pointer;
      } catch { return { ok: false as const, reason: "not-in-cloud" as const }; }
      const indexBytes = await remote.get(keys.indexKey("quickNotes", pointer.quickNotes.commit));
      if (!indexBytes) return { ok: false as const, reason: "not-in-cloud" as const };
      let entry: { contentHash: string; updatedAt: string } | undefined;
      try { entry = indexMod.parseQuickNotesIndexBytes(indexBytes).index.items.find((item) => item.id === id); }
      catch { return { ok: false as const, reason: "not-in-cloud" as const }; }
      if (!entry) return { ok: false as const, reason: "not-in-cloud" as const };
      const bytes = await remote.get(keys.quickNoteBodyKey(entry.contentHash));
      if (!bytes) return { ok: false as const, reason: "object-missing" as const };
      if (sha256Hex(bytes) !== entry.contentHash) return { ok: false as const, reason: "hash-mismatch" as const };
      let content: StoredQuickNoteContent;
      try { content = validateQuickNoteContent(JSON.parse(new TextDecoder().decode(bytes))); }
      catch { return { ok: false as const, reason: "invalid-content" as const }; }
      await applyRestoredQuickNote(d, id, content, { synced: true, updatedAt: entry.updatedAt });
      try { await ensureAssetsNative([id], { space: "quickNotes" }); } catch (error) { console.warn("[missing-body] 小记正文已恢复，图片补拉失败（可点占位图重试）", error); }
      return { ok: true as const };
    });
  },

  /**
   * 用搜索索引的全文缓存重建纯文本小记（有损：图片与富格式丢失 ⇒ 标 local 待上传）。
   * 只读派生表 + 写正文文件/行，不出网。
   */
  async recoverMissingQuickNoteFromText(id: string): Promise<{ ok: true } | { ok: false; reason: "not-found" | "no-text" | "invalid" }> {
    return runWrite("recoverMissingQuickNoteFromText", async () => {
      const d = await ensureDb();
      const row = await d.prepare("SELECT 1 AS one FROM quick_notes WHERE id=?").get(id);
      if (!row) return { ok: false as const, reason: "not-found" as const };
      const cached = await d.prepare("SELECT text_cache FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as
        | { text_cache?: string | null }
        | undefined;
      const text = typeof cached?.text_cache === "string" ? cached.text_cache : "";
      if (!text.trim()) return { ok: false as const, reason: "no-text" as const };
      let content: StoredQuickNoteContent;
      try { content = rebuildQuickNoteContentFromText(text); }
      catch { return { ok: false as const, reason: "invalid" as const }; }
      await applyRestoredQuickNote(d, id, content, { synced: false });
      return { ok: true as const };
    });
  },
};
