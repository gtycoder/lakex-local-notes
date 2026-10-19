/**
 * 正文对象路径契约（桌面/移动端共用单一来源）。
 *
 * 桌面 = workspace 根目录下的这些相对路径；移动端 = Directory.Data（App 私有 files/）下的同名路径。
 * 只有正文/快照/草稿走这里；附件（note-assets）与小记图片（quick-notes/assets）另有自己的契约。
 *
 * 统一目的：两端"同一个 id + kind 落在同一个相对路径"，便于对照、同步对象命名、数据体检与迁移。
 */
import { NOTE_KINDS, type NoteKind } from "./noteKind.js";
import { isSafePathSegment } from "./storeUtils.js";

/** 各 kind 的正文目录（与 docs/STORAGE-LAYERS.md 的磁盘布局一致）。 */
export const NOTE_BODY_DIR: Record<NoteKind, string> = {
  doc: "notes",
  usheet: "usheets",
  bitable: "bitables",
  board: "boards",
};

/** 各 kind 的正文扩展名。doc 是 Lake 标记文本，其余是内部 JSON。 */
export const NOTE_BODY_EXT: Record<NoteKind, string> = {
  doc: ".lake",
  usheet: ".usheet.json",
  bitable: ".bitable.json",
  board: ".board.json",
};

/** 文档正文相对路径：notes/{id}.lake / bitables/{id}.bitable.json … */
export function noteBodyRelativePath(kind: NoteKind, id: string): string {
  if (!isSafePathSegment(id)) throw new Error("无效的笔记 ID: " + id);
  return NOTE_BODY_DIR[kind] + "/" + id + NOTE_BODY_EXT[kind];
}

/** 同一 id 的四种候选正文路径（正文缺失清理 / kind 变更时逐个尝试；与桌面 candidateBodyPaths 同口径）。 */
export function noteBodyCandidatePaths(id: string): string[] {
  if (!isSafePathSegment(id)) throw new Error("无效的笔记 ID: " + id);
  return NOTE_KINDS.map((kind) => noteBodyRelativePath(kind, id));
}

/** 小记正文相对路径（与桌面 .qnote 同构）：quick-notes/items/{id}.qnote */
export function quickNoteBodyRelativePath(id: string): string {
  if (!isSafePathSegment(id)) throw new Error("无效的小记 ID: " + id);
  return "quick-notes/items/" + id + ".qnote";
}

/** 小记图片相对路径（与桌面 quick-notes/assets/{id}/{filename} 同构）。 */
export function quickNoteAssetRelativePath(id: string, filename: string): string {
  if (!isSafePathSegment(id)) throw new Error("无效的小记 ID: " + id);
  if (!isSafePathSegment(filename)) throw new Error("无效的图片文件名: " + filename);
  return "quick-notes/assets/" + id + "/" + filename;
}

/** 历史快照相对路径：history/{noteId}/{filename}（文件名由调用方生成并保证是单段）。 */
export function historySnapshotRelativePath(noteId: string, filename: string): string {
  if (!isSafePathSegment(noteId)) throw new Error("无效的笔记 ID: " + noteId);
  if (!isSafePathSegment(filename)) throw new Error("无效的快照文件名: " + filename);
  return "history/" + noteId + "/" + filename;
}

/** 草稿日志相对路径：draft-journal/{id}.json（与桌面 DraftJournal 同构）。 */
export function draftJournalRelativePath(id: string): string {
  if (!isSafePathSegment(id)) throw new Error("无效的草稿 ID: " + id);
  return "draft-journal/" + id + ".json";
}
