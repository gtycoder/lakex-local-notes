import { extractAssetRefs, extOf } from "../core/assetNaming.js";
import { lakeHtmlToPlain } from "../core/lakeCaches.js";
import { searchTextForKind } from "../core/noteSearchText.js";
import { indexNote, removeNoteFromIndex, searchNotes as searchNotesIndexed } from "./searchIndex.js";
import type { SearchResult } from "../core/searchTypes.js";
import { hasNoteSaveChanges } from "../core/noteSaveDecision.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { loadAssetBytesFs, listNoteAssetKeysFs } from "./assetFs";
import type { MobileDb } from "./sqliteDb";

export interface POCNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  parentId: string | null;
  /** v6/v7 文档类型（缺省 doc）。非 doc 类型移动端只读占位，**不得**交给 Lake 编辑器（会写坏正文）。 */
  kind: "doc" | "sheet" | "bitable" | "board";
}

/** 列表页只需要元数据；正文在 readNote() 打开文档时按需读取。 */
export interface POCNoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  parentId: string | null;
}

function normalizeDocKind(value: unknown): "doc" | "sheet" | "bitable" | "board" {
  return value === "sheet" || value === "bitable" || value === "board" ? value : "doc";
}

function rowToNote(r: Record<string, unknown>): POCNote {
  return { id: String(r.id), title: String(r.title), content: String(r.content), updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null, kind: normalizeDocKind(r.doc_kind) };
}

function rowToNoteSummary(r: Record<string, unknown>): POCNoteSummary {
  return { id: String(r.id), title: String(r.title), updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null };
}

/** 简单 MIME（孤儿列表展示用，等价桌面 mimeTypeForFilename）。 */
function mimeOf(filename: string): string {
  const ext = extOf(filename).toLowerCase();
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav",
    pdf: "application/pdf", zip: "application/zip", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

/** 历史快照引用的资源文件名集合（被历史引用的资源不孤儿，避免清理后历史恢复裂图）。 */
async function getHistoryRefs(d: MobileDb, noteId: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const rows = await d.prepare("SELECT content FROM note_history WHERE note_id=?").all(noteId) as Array<{ content: string }>;
  for (const r of rows) for (const f of extractAssetRefs(r.content)) refs.add(f);
  return refs;
}

/** 孤儿检测（对齐桌面 detectOrphans）：保存正文后，登记「本地有但正文/历史都不引用」的资源。 */
export async function detectOrphans(
  d: MobileDb,
  noteId: string,
  content: string,
  assets: Map<string, Uint8Array>,
): Promise<void> {
  const referenced = extractAssetRefs(content);
  const historyRefs = await getHistoryRefs(d, noteId);
  const prefix = noteId + "/";
  const keys = new Set((await listNoteAssetKeysFs(noteId)).map((key) => key.slice(prefix.length)));
  for (const [key] of assets) if (key.startsWith(prefix)) keys.add(key.slice(prefix.length));
  const insert = d.prepare("INSERT OR IGNORE INTO orphan_assets (note_id, filename, file_path, size, mime_type) VALUES (?,?,?,?,?)");
  const unorphan = d.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?");
  for (const filename of keys) {
    if (referenced.has(filename) || historyRefs.has(filename)) {
      await unorphan.run(noteId, filename);
    } else {
      const bytes = assets.get(prefix + filename) ?? await loadAssetBytesFs(prefix + filename);
      await insert.run(noteId, filename, `note-assets/${noteId}/${filename}`, bytes ? bytes.length : 0, mimeOf(filename));
    }
  }
}

/** 某笔记的孤儿文件名集合（listLocalAssets 跳过 → 孤儿不上传，对齐桌面 syncAdapters）。 */
export async function orphanFilenamesForNote(d: MobileDb, noteId: string): Promise<Set<string>> {
  const rows = await d.prepare("SELECT filename FROM orphan_assets WHERE note_id=?").all(noteId) as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}

export async function listNotes(d: MobileDb): Promise<POCNoteSummary[]> {
  const rows = await d.prepare("SELECT id, title, updated_at, parent_id FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC").all();
  return rows.map(rowToNoteSummary);
}

export async function readNote(d: MobileDb, id: string): Promise<POCNote | null> {
  const row = await d.prepare("SELECT id, title, content, updated_at, parent_id, doc_kind FROM notes WHERE id = ?").get(id);
  return row ? rowToNote(row) : null;
}

/** 打开文档前的"是否已消失"判定原料（AGENTS §3 #16）。 */
export async function noteGoneState(d: MobileDb, id: string): Promise<{ parentId: string | null; syncState: string } | null> {
  const row = await d.prepare("SELECT parent_id, sync_state FROM notes WHERE id = ?").get(id) as { parent_id: string | null; sync_state: string | null } | undefined;
  return row ? { parentId: row.parent_id, syncState: row.sync_state ?? "" } : null;
}

/** 全文搜索：FTS5 + unicode61，与桌面同分词/查询/摘要（src/core/search）。 */
export async function searchNotes(d: MobileDb, query: string): Promise<SearchResult[]> {
  return searchNotesIndexed(d, query);
}

/** 返回 false 表示内容无变化，调用方无需持久化快照。 */
export async function saveNote(
  d: MobileDb,
  id: string,
  title: string,
  content: string,
  parentId: string | null,
  assets: Map<string, Uint8Array>,
  plain?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const safeTitle = title.trim() ? title.trim() : "无标题文档";
  const existing = await d.prepare("SELECT title, content FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as { title: string; content: string } | undefined;
  if (existing && !hasNoteSaveChanges(existing, { title: safeTitle, content })) return false;
  // 首选编辑器 getDocument("text/plain")（与桌面同源）；缺省按 **kind** 派生（sheet/bitable/board 的正文是 JSON，
  // 直接 lakeHtmlToPlain 会把 JSON 碎片写进 text_cache ⇒ 搜索索引与摘要全脏）。口径见 src/core/noteSearchText.ts。
  const kindRow = await d.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
  const kind = normalizeDocKind(kindRow?.doc_kind);
  const bodyPlain = plain ?? searchTextForKind(kind, content).plain ?? "";

  await d.prepare(
    `INSERT INTO notes (id, title, content, parent_id, updated_at, content_hash, sync_state, text_cache) VALUES (?,?,?,?,?,?,'local',?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, updated_at=excluded.updated_at, content_hash=excluded.content_hash, sync_state='local', text_cache=excluded.text_cache`
  ).run(id, safeTitle, content, parentId, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain);
  await detectOrphans(d, id, content, assets);
  await indexNote(d, id);
  return true;
}

/** 本地软删（入回收站）：同步时上传墓碑（删除压编辑）。 */
export async function trashNote(d: MobileDb, id: string): Promise<void> {
  await d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(new Date().toISOString(), id);
  await removeNoteFromIndex(d, id);
}

export async function listTrashed(d: MobileDb): Promise<POCNote[]> {
  const rows = await d.prepare("SELECT id, title, content, updated_at FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all();
  return rows.map(rowToNote);
}
