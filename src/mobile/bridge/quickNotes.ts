/** C3-5 第③步：quickNotes 域（从 bridge.ts 抽取，行为保持）。 */
import { assets, ensureDb, runPriority, runWrite } from "./context";

import { saveAssetBytesFs, loadAssetBytesFs, removeAssetBytesFs } from "../native/assetFs";
import type { QuickNotePushOutcome } from "../../core/quickNotePush.js";
import { buildAssetFilename, mimeTypeForFilename } from "../../core/assetNaming.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { cloudStateHint, type CloudState } from "../../core/cloudState.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import type { QuickNotePage, QuickNotePageOptions } from "../data/quickNotesRepository.js";

import * as quickNotesRepository from "../data/quickNotesRepository.js";
import { mobileCloudState, pushSingleQuickNote, scheduleQuickNoteVerify } from "./sync";


export const quickNotesDomain = {
  async getQuickNotePage(options?: QuickNotePageOptions): Promise<QuickNotePage> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNotePage(d, options);
  },

  async readQuickNote(id: string): Promise<{ id: string; content: StoredQuickNoteContent; previewText: string; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNote(d, id);
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

  async getQuickNoteDraft(): Promise<{ id: string; text: string; body?: string; images: StoredQuickNoteImage[]; tags?: string[]; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNoteDraft(d);
  },

  async saveQuickNoteDraft(draft: { id: string; text: string; body?: string; images?: StoredQuickNoteImage[]; tags?: string[] }): Promise<void> {
    return runWrite("saveQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.writeQuickNoteDraft(d, { id: draft.id, text: draft.text, body: draft.body, images: draft.images ?? [], tags: draft.tags ?? [], updatedAt: new Date().toISOString() });
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

  async saveQuickNoteContent(id: string, payload: { text: string; body: string; images: StoredQuickNoteImage[]; tags?: string[] }): Promise<string> {
    return runWrite("saveQuickNoteContent", async () => {
      const d = await ensureDb();
      return await quickNotesRepository.saveQuickNoteContent(d, id, payload);
    });
  },

  async syncQuickNote(id: string): Promise<QuickNotePushOutcome> {
    if ((await mobileCloudState()) === "offline") throw new Error(cloudStateHint("offline") ?? "云同步已关闭");
    const outcome = await runPriority("syncQuickNote", () => pushSingleQuickNote(id));
    if (outcome.status === "pushed") scheduleQuickNoteVerify(id);
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

  async listQuickNoteTrash(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; previewText: string }>> {
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
      await quickNotesRepository.purgeQuickNote(d, id, removeAssetBytesFs);
    });
  },
};
