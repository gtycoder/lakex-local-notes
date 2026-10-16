import { extractAssetRefs, extOf } from "../../core/assetNaming.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { indexNote, removeNoteFromIndex, searchNotes as searchNotesIndexed } from "./searchIndex.js";
import type { SearchResult } from "../../core/searchTypes.js";
import { hasNoteSaveChanges } from "../../core/noteSaveDecision.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { loadAssetBytesFs, listNoteAssetKeysFs } from "../native/assetFs";
import type { MobileDb } from "./sqliteDb";

export interface LocalNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  parentId: string | null;
  /** v6/v7 文档类型（缺省 doc）。非 doc 类型移动端只读占位，**不得**交给 Lake 编辑器（会写坏正文）。 */
  kind: "doc" | "usheet" | "bitable" | "board";
}

/** 列表页只需要元数据；正文在 readNote() 打开文档时按需读取。 */
export interface LocalNoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  parentId: string | null;
}

function normalizeDocKind(value: unknown): "doc" | "usheet" | "bitable" | "board" {
  // 表格（kind=usheet）：移动端按「非 doc 只读占位」处理，**绝不**交给 Lake 编辑器。
  // 已废弃的旧 kind：不做迁移 / 兼容（AGENTS §3#7），直接回退 doc。
  return value === "usheet" || value === "bitable" || value === "board" ? value : "doc";
}

function rowToNote(r: Record<string, unknown>): LocalNote {
  return { id: String(r.id), title: String(r.title), content: String(r.content), updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null, kind: normalizeDocKind(r.doc_kind) };
}

function rowToNoteSummary(r: Record<string, unknown>): LocalNoteSummary {
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

export async function listNotes(d: MobileDb): Promise<LocalNoteSummary[]> {
  const rows = await d.prepare("SELECT id, title, updated_at, parent_id FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC").all();
  return rows.map(rowToNoteSummary);
}

export async function readNote(d: MobileDb, id: string): Promise<LocalNote | null> {
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

/** 写入边界判定（审计 F06）：missing = 无行；gone = 已在回收站（trashed_at）或被 purge（sync_state='purged'）。 */
export async function noteWriteState(d: MobileDb, id: string): Promise<"missing" | "gone" | "active"> {
  const row = await d.prepare("SELECT trashed_at, sync_state FROM notes WHERE id=?").get(id) as
    | { trashed_at: string | null; sync_state: string | null }
    | undefined;
  if (!row) return "missing";
  return row.trashed_at != null || row.sync_state === "purged" ? "gone" : "active";
}

/** 该 id 是否已有永久墓碑（purge 后行被物理删除，只剩 deleted_notes）——缺失的 id 只有在无墓碑时才允许初始化。 */
export async function isTombstoned(d: MobileDb, id: string): Promise<boolean> {
  const row = await d.prepare("SELECT 1 FROM deleted_notes WHERE id=?").get(id);
  return !!row;
}

/** 新建笔记（审计 F06：create 与 save 分离——新建走 INSERT，不对任何既有 id 做 upsert）。 */
export async function createNote(
  d: MobileDb,
  id: string,
  title: string,
  content: string,
  parentId: string | null,
  assets: Map<string, Uint8Array>,
  plain?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const safeTitle = title.trim() ? title.trim() : "无标题文档";
  const bodyPlain = plain ?? searchTextForKind("doc", content).plain ?? "";
  await d.prepare(
    "INSERT INTO notes (id, title, content, parent_id, updated_at, content_hash, sync_state, text_cache) VALUES (?,?,?,?,?,?,'local',?)"
  ).run(id, safeTitle, content, parentId, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain);
  await detectOrphans(d, id, content, assets);
  await indexNote(d, id);
}

/** 保存已有笔记（审计 F06）：missing/gone 明确拒绝，绝不做 upsert 自愈。
 * 生命周期判定在写边界（不依赖当前屏幕 editing 标记）：回收站条目/他端 purge 的保留副本不得被改成 local 并覆写正文。
 * 返回 false 表示内容无变化，调用方无需持久化快照。 */
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
  const existing = await d.prepare("SELECT title, content, doc_kind, trashed_at, sync_state FROM notes WHERE id=?").get(id) as
    | { title: string; content: string; doc_kind?: string | null; trashed_at: string | null; sync_state: string | null }
    | undefined;
  if (!existing) throw new Error("笔记不存在，不能保存（新建请走 createNote）");
  if (existing.trashed_at != null || existing.sync_state === "purged") {
    throw new Error("笔记已在回收站或已被删除，保存被拒绝；请先显式恢复");
  }
  if (!hasNoteSaveChanges(existing, { title: safeTitle, content })) return false;
  // 首选编辑器 getDocument("text/plain")（与桌面同源）；缺省按 **kind** 派生（usheet/bitable/board 的正文是 JSON，
  // 直接 lakeHtmlToPlain 会把 JSON 碎片写进 text_cache ⇒ 搜索索引与摘要全脏）。口径见 src/core/noteSearchText.ts。
  const kind = normalizeDocKind(existing.doc_kind);
  const bodyPlain = plain ?? searchTextForKind(kind, content).plain ?? "";

  // 写边界二次守卫：检查与写入之间若状态变为 trash/purge，UPDATE 不命中 → 抛错，绝不静默写脏。
  const changed = (await d.prepare(
    `UPDATE notes SET title=?, content=?, parent_id=?, updated_at=?, content_hash=?, sync_state='local', text_cache=?
     WHERE id=? AND trashed_at IS NULL AND sync_state != 'purged'`
  ).run(safeTitle, content, parentId, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain, id)).changes;
  if (changed === 0) throw new Error("笔记状态已变化（回收站/已删除），保存被拒绝");
  await detectOrphans(d, id, content, assets);
  await indexNote(d, id);
  return true;
}

/** 本地软删（入回收站）：同步时上传墓碑（删除压编辑）。 */
export async function trashNote(d: MobileDb, id: string): Promise<void> {
  await d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(new Date().toISOString(), id);
  await removeNoteFromIndex(d, id);
}

export async function listTrashed(d: MobileDb): Promise<LocalNote[]> {
  const rows = await d.prepare("SELECT id, title, content, updated_at FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all();
  return rows.map(rowToNote);
}
