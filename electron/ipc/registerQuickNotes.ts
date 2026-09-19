import { MAX_QUICK_NOTE_ATTACHMENT_BYTES, MAX_QUICK_NOTE_IMAGE_BYTES, QuickNotesStore } from "../quickNotes.js";
import { convertQuickNoteToLake } from "../quickNoteConversion.js";
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

export function registerQuickNotesIpc(ipc: IpcRegistrar, quickNotes: QuickNotesStore, store: Store): void {
  ipc.handle("list_quick_notes", () => quickNotes.listQuickNotes());
  ipc.handle("create_quick_note", (input: SaveQuickNoteInput) => quickNotes.createQuickNote(input));
  ipc.handle("update_quick_note", (id: string, input: SaveQuickNoteInput) => quickNotes.updateQuickNote(id, input));
  ipc.handle("delete_quick_note", (id: string) => quickNotes.deleteQuickNote(id));
  ipc.handle("list_quick_note_trash", () => quickNotes.listQuickNoteTrash());
  ipc.handle("restore_quick_note", (id: string) => quickNotes.restoreQuickNote(id));
  ipc.handle("purge_quick_note", (id: string) => quickNotes.purgeQuickNote(id));
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
}
