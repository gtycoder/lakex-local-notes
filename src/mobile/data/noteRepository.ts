import { extractAssetRefs, extOf } from "../../core/assetNaming.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { indexNote, removeNoteFromIndex, searchDocsByScope } from "./searchIndex.js";
import { searchQuickNotesByScope } from "./quickNotesSearch.js";
import type { MobileSearchResult } from "../search/searchTypes.js";
import { DEFAULT_SEARCH_SCOPE, type SearchScope } from "../search/searchScope.js";
import { hasNoteSaveChanges } from "../../core/noteSaveDecision.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import { loadAssetBytesFs, listNoteAssetKeysFs, statNoteAssetSizesFs } from "../native/assetFs";
import type { MobileDb } from "./sqliteDb";
import { deleteNoteBodies, readNoteBody, writeNoteBody } from "./noteBodies.js";

/**
 * 移动端笔记仓储。
 *
 * 261019 起正文不再存 SQLite：notes 行只有元数据 + content_hash + 派生 text_cache；
 * 正文读写在 native/bodyStore（文件，路径与桌面同构，见 core/noteBodyPaths.ts）。
 */

export interface LocalNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  parentId: string | null;
  /** 文档类型（doc | usheet | bitable | board | ink；缺省 doc）。非 doc/ink 类型移动端只读占位，不得交给 Lake 编辑器。 */
  kind: NoteKind;
  /** 远端已彻底删除、本机仅保留回收站副本（「云端已删除 · 仅本地」）；恢复上传成功后清除。 */
  cloudDeleted?: boolean;
  /** 编辑锁（桌面端锁定 = 只读；移动端必须同语义拦截编辑/保存）。 */
  editLocked?: boolean;
  editLockedAt?: string | null;
}

/** 列表页只需要元数据；正文在 readNote() 打开文档时按需读取。 */
export interface LocalNoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  /** 创建时间（261110，schema v13）：日记同一天多篇按它倒序，**不随编辑漂移**。 */
  createdAt: string;
  parentId: string | null;
}

function rowToNote(r: Record<string, unknown>, content: string): LocalNote {
  return {
    id: String(r.id), title: String(r.title), content, updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null,
    kind: normalizeNoteKind(r.doc_kind),
    ...(Number(r.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
    ...(Number(r.is_locked) === 1 ? { editLocked: true } : {}),
    ...(r.locked_at ? { editLockedAt: String(r.locked_at) } : {}),
  };
}

function rowToNoteSummary(r: Record<string, unknown>): LocalNoteSummary {
  // created_at：v13 前的老行由迁移回填 = updated_at；查询未带该列时也回落 updatedAt（防御性，避免空串排序错位）。
  return {
    id: String(r.id), title: String(r.title), updatedAt: String(r.updated_at),
    createdAt: String(r.created_at ?? "") || String(r.updated_at),
    parentId: r.parent_id ? String(r.parent_id) : null,
  };
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

/** 历史快照引用的资源文件名集合（来自 note_history.refs_json，不读快照正文）。 */
async function getHistoryRefs(d: MobileDb, noteId: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const rows = await d.prepare("SELECT refs_json FROM note_history WHERE note_id=?").all(noteId) as Array<{ refs_json: string }>;
  for (const row of rows) {
    try {
      for (const filename of JSON.parse(row.refs_json) as string[]) refs.add(filename);
    } catch { /* 单条坏账不影响其它快照 */ }
  }
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
  // 261027：孤儿行只需要 size —— 优先原生 stat（不读内容）。旧实现会对每个未引用文件 loadAssetBytesFs
  // 读整份字节，25MB 附件 × N 时每次保存都是几十 MB 桥流量（真机实测保存 3 个 25MB 文件读回 78MB）。
  let sizes: Map<string, number> | null = null;
  try { sizes = await statNoteAssetSizesFs(noteId); } catch { sizes = null; }
  const insert = d.prepare("INSERT OR IGNORE INTO orphan_assets (note_id, filename, file_path, size, mime_type) VALUES (?,?,?,?,?)");
  const unorphan = d.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?");
  for (const filename of keys) {
    if (referenced.has(filename) || historyRefs.has(filename)) {
      await unorphan.run(noteId, filename);
    } else {
      const memBytes = assets.get(prefix + filename);
      const size = memBytes?.length ?? sizes?.get(filename) ?? (await loadAssetBytesFs(prefix + filename))?.length ?? 0;
      await insert.run(noteId, filename, `note-assets/${noteId}/${filename}`, size, mimeOf(filename));
    }
  }
}

/** 某笔记的孤儿文件名集合（listLocalAssets 跳过 → 孤儿不上传，对齐桌面适配器（manifest 时代 syncAdapters 已删，语义由 delta 判据承担））。 */
export async function orphanFilenamesForNote(d: MobileDb, noteId: string): Promise<Set<string>> {
  const rows = await d.prepare("SELECT filename FROM orphan_assets WHERE note_id=?").all(noteId) as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}

export async function listNotes(d: MobileDb): Promise<LocalNoteSummary[]> {
  const rows = await d.prepare("SELECT id, title, updated_at, created_at, parent_id FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC").all();
  return rows.map(rowToNoteSummary);
}

export async function readNote(d: MobileDb, id: string): Promise<LocalNote | null> {
  const row = await d.prepare("SELECT id, title, updated_at, parent_id, doc_kind, cloud_deleted, is_locked, locked_at FROM notes WHERE id = ?").get(id);
  if (!row) return null;
  const kind = normalizeNoteKind(row.doc_kind);
  const content = await readNoteBody(kind, id);
  if (content == null) {
    // 行在、正文文件缺失（外部删除/写盘失败）：按"打不开"处理，绝不返回空正文让编辑器覆盖。
    console.warn("[mobile] 正文文件缺失，拒绝打开:", id, kind);
    return null;
  }
  return rowToNote(row, content);
}

/** 打开文档前的"是否已消失"判定原料（AGENTS §3 #16）。
 *  **trashedAt 必须是判定原料**：删笔记本/分组时只有根节点的 parent_id 变化，子文档 parent_id 不变、只标
 *  trashed_at（trashLifecycle.deleteTreeNode 级联）⇒ 只按 parentId 判会漏掉整棵子树的回收站文档。 */
export interface NoteGoneState {
  parentId: string | null;
  syncState: string;
  trashedAt: string | null;
}

export async function noteGoneState(d: MobileDb, id: string): Promise<NoteGoneState | null> {
  const row = await d.prepare("SELECT parent_id, trashed_at, is_dirty, is_purged FROM notes WHERE id = ?").get(id) as
    | { parent_id: string | null; trashed_at: string | null; is_dirty: number; is_purged: number }
    | undefined;
  return row
    ? {
        parentId: row.parent_id,
        trashedAt: row.trashed_at,
        syncState: row.is_purged === 1 ? "purged" : row.is_dirty === 1 ? "local" : "synced",
      }
    : null;
}

/**
 * 全文搜索（按范围）：FTS5 + unicode61，与桌面同分词/查询/摘要（src/core/search）。
 * 顺序 = 文档在前、小记在后（小记最多 20 条），与既有「全部」口径一致。
 * 范围是**设备本地视图**（只影响召回字段，不改数据/不同步，定义见 src/mobile/search/searchScope.ts）。
 */
export async function searchNotes(d: MobileDb, query: string, scope: SearchScope = DEFAULT_SEARCH_SCOPE): Promise<MobileSearchResult[]> {
  // 顺序执行：同一连接上的索引对账与搜索不能交叉（既有约定）。
  const notes = await searchDocsByScope(d, query, scope);
  const quickNotes = await searchQuickNotesByScope(d, query, scope, 20);
  return [...notes, ...quickNotes];
}

/** 写入边界判定（审计 F06）：missing = 无行；gone = 已在回收站（trashed_at）或被 purge（is_purged=1,is_dirty=0）。 */
export async function noteWriteState(d: MobileDb, id: string): Promise<"missing" | "gone" | "active"> {
  const row = await d.prepare("SELECT trashed_at, is_purged FROM notes WHERE id=?").get(id) as
    | { trashed_at: string | null; is_purged: number }
    | undefined;
  if (!row) return "missing";
  return row.trashed_at != null || row.is_purged === 1 ? "gone" : "active";
}

/** 该 id 是否已有永久墓碑（purge 后行被物理删除，只剩 deleted_notes）——缺失的 id 只有在无墓碑时才允许初始化。 */
export async function isTombstoned(d: MobileDb, id: string): Promise<boolean> {
  const row = await d.prepare("SELECT 1 FROM deleted_notes WHERE id=?").get(id);
  return !!row;
}

/** 同步批量导入用的写路径开关（默认全开；同步导入由调用方显式关闭重活）。 */
export interface NoteWriteOptions {
  /** 跳过逐篇 FTS 索引：派生索引统一由 reconcileIndex 后台重建（首拉 2k 篇时省掉 2k 次 FTS 写）。 */
  skipSearchIndex?: boolean;
  /** 跳过孤儿扫描：远端导入的附件由声明/资产流水线负责，不走本地孤儿补扫。 */
  skipOrphanScan?: boolean;
  /** 跳过“内容是否变化”的读盘比较：正文来自云端权威数据，无需再读旧文件比对。 */
  skipChangeCheck?: boolean;
  /**
   * 目录排序位（261107 根因修复）：缺省 = 追加到同级末尾（notes+folders 的 MAX(sort_order)+1）。
   * 创建副本等"插到指定位置"场景显式传入（源 sort_order+1，调用方先移位同事务）。
   */
  sortOrder?: number;
}

/** 同级（notes+folders，未删）末尾的排序位；空父级 = 0。 */
async function nextSiblingSortOrder(d: MobileDb, parentId: string | null): Promise<number> {
  const row = await d.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM (" +
      "SELECT sort_order FROM notes WHERE parent_id IS ? AND trashed_at IS NULL " +
      "UNION ALL SELECT sort_order FROM folders WHERE parent_id IS ? AND trashed_at IS NULL" +
    ")",
  ).get(parentId, parentId) as { max_order?: number } | undefined;
  return Number(row?.max_order ?? -1) + 1;
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
  kind: NoteKind = "doc",
  opts: NoteWriteOptions = {},
): Promise<void> {
  const now = new Date().toISOString();
  const safeTitle = title.trim() ? title.trim() : (kind === "usheet" ? "无标题表格" : "无标题文档");
  // 261107：新笔记必须有明确的目录排序位（此前恒写默认 0 ⇒ 同级全是 0，复制"紧邻源"只能靠整组重排）。
  const sortOrder = opts.sortOrder ?? await nextSiblingSortOrder(d, parentId);
  // 先写正文文件、再提交 DB（对齐桌面 NoteContentRepository：DB 不应声称正文已存在）。
  await writeNoteBody(kind, id, content);
  try {
    const bodyPlain = plain ?? searchTextForKind(kind, content).plain ?? "";
    await d.prepare(
      "INSERT INTO notes (id, title, parent_id, sort_order, updated_at, created_at, content_hash, is_dirty, text_cache, doc_kind) VALUES (?,?,?,?,?,?,?,1,?,?)"
    ).run(id, safeTitle, parentId, sortOrder, now, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain, kind);
  } catch (error) {
    // 只有"DB 里确实没有这一行"才清理刚写的正文：INSERT 失败也可能来自 id 已存在（并发/调用方误用），
    // 这时删正文会毁掉既有笔记。
    const exists = await d.prepare("SELECT 1 FROM notes WHERE id=?").get(id);
    if (!exists) await deleteNoteBodies(id).catch(() => undefined);
    throw error;
  }
  if (!opts.skipOrphanScan) await detectOrphans(d, id, content, assets);
  if (!opts.skipSearchIndex) await indexNote(d, id);
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
  opts: NoteWriteOptions = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  const safeTitle = title.trim() ? title.trim() : "无标题文档";
  const existing = await d.prepare("SELECT title, doc_kind, trashed_at, is_purged FROM notes WHERE id=?").get(id) as
    | { title: string; doc_kind?: string | null; trashed_at: string | null; is_purged: number }
    | undefined;
  if (!existing) throw new Error("笔记不存在，不能保存（新建请走 createNote）");
  if (existing.trashed_at != null || existing.is_purged === 1) {
    throw new Error("笔记已在回收站或已被删除，保存被拒绝；请先显式恢复");
  }
  const kind = normalizeNoteKind(existing.doc_kind);
  // 同步批量导入（skipChangeCheck）：正文是云端权威数据，不必读旧文件比对。
  const previous = opts.skipChangeCheck ? null : await readNoteBody(kind, id);
  if (previous != null && !hasNoteSaveChanges({ title: existing.title, content: previous }, { title: safeTitle, content })) return false;
  // 首选编辑器 getDocument("text/plain")（与桌面同源）；缺省按 **kind** 派生（usheet/bitable/board 的正文是 JSON，
  // 直接 lakeHtmlToPlain 会把 JSON 碎片写进 text_cache ⇒ 搜索索引与摘要全脏）。口径见 src/core/noteSearchText.ts。
  const bodyPlain = plain ?? searchTextForKind(kind, content).plain ?? "";

  await writeNoteBody(kind, id, content);
  // 写边界二次守卫：检查与写入之间若状态变为 trash/purge，UPDATE 不命中 → 回滚正文并抛错，绝不静默写脏。
  // 保存正文**不是树操作**：父节点为空时保留原归属（COALESCE）。
  // 261020 实测 bug：移动端自动保存 / 「完成」都不传 parentId（它们只关心正文），旧实现直接写
  // parent_id=? ⇒ 每次保存把文档从笔记本里摘出来（parent_id 变 NULL），表现为「编辑一下计数就少一篇、
  // 目录里也找不到」。显式移动必须走 moveTreeNodeOrdered（那才是树操作）。
  const changed = (await d.prepare(
    `UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), updated_at=?, content_hash=?, is_dirty=1, text_cache=?
     WHERE id=? AND trashed_at IS NULL AND is_purged=0`
  ).run(safeTitle, parentId, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain, id)).changes;
  if (changed === 0) {
    if (previous != null) await writeNoteBody(kind, id, previous).catch(() => undefined);
    throw new Error("笔记状态已变化（回收站/已删除），保存被拒绝");
  }
  if (!opts.skipOrphanScan) await detectOrphans(d, id, content, assets);
  if (!opts.skipSearchIndex) await indexNote(d, id);
  return true;
}

/**
 * 恢复历史快照专用写（261112 task-53 修正口径）：**只写内容，不动生命周期**。
 * 与 saveNote 的差异 = 允许写「已进回收站」的行（对齐桌面 NoteContentRepository.saveSynced/allowTrashed）：
 * 回收站行的 trashed_at / parent_id / restore_pending_at **原样保留**；purged 仍拒绝（不可复活）。
 * 「恢复历史版本」是内容动作；改变生命周期只能由回收站里显式「恢复」入口做（用户裁决）。
 */
export async function saveRestoredNoteContent(d: MobileDb, id: string, title: string, content: string): Promise<void> {
  const existing = await d.prepare("SELECT doc_kind, trashed_at, is_purged FROM notes WHERE id=?").get(id) as
    | { doc_kind?: string | null; trashed_at: string | null; is_purged: number }
    | undefined;
  if (!existing) throw new Error("笔记不存在，无法恢复历史版本");
  if (existing.is_purged === 1) throw new Error("笔记已被彻底删除（不可恢复），无法恢复历史版本");
  const kind = normalizeNoteKind(existing.doc_kind);
  const now = new Date().toISOString();
  const safeTitle = title.trim() ? title.trim() : "无标题文档";
  const bodyPlain = searchTextForKind(kind, content).plain ?? "";
  await writeNoteBody(kind, id, content);
  const changed = (await d.prepare(
    "UPDATE notes SET title=?, updated_at=?, content_hash=?, is_dirty=1, text_cache=? WHERE id=?",
  ).run(safeTitle, now, sha256Sync(new TextEncoder().encode(content)), bodyPlain, id)).changes;
  if (changed === 0) throw new Error("笔记状态已变化，恢复历史版本失败");
  // 回收站行不重建派生索引（trashNote 已把它移出 FTS；显式回收站恢复入口会 reconcileIndex）；
  // 活跃行与普通保存同口径补索引/孤儿扫描。
  if (existing.trashed_at == null) {
    await detectOrphans(d, id, content, new Map());
    await indexNote(d, id);
  }
}

/** 本地软删（入回收站）：同步时上传墓碑（删除压编辑）。 */
export async function trashNote(d: MobileDb, id: string): Promise<void> {
  // 261026：软删必须 bump updated_at —— v3 索引的 trashedAt/恢复靠 updatedAt 做 LWW 传播；
  // 不 bump 时对端看到的 updatedAt 没变，回收站状态永远同步不过去（conformance 抓到）。
  const now = new Date().toISOString();
  // 261112 task-55（N2）：软删必须记「删除前父」——恢复原路返回、跨端恢复位置都依赖它（桌面同语义）。
  await d.prepare(
    "UPDATE notes SET trashed_at=?, updated_at=?, is_dirty=1, restore_pending_at=NULL, deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id) WHERE id=?",
  ).run(now, now, id);
  await removeNoteFromIndex(d, id);
}

export async function listTrashed(d: MobileDb): Promise<LocalNote[]> {
  const rows = await d.prepare("SELECT id, title, updated_at, parent_id, doc_kind, cloud_deleted FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all() as Array<Record<string, unknown>>;
  const notes: LocalNote[] = [];
  for (const row of rows) {
    const kind = normalizeNoteKind(row.doc_kind);
    const content = await readNoteBody(kind, String(row.id));
    notes.push(rowToNote(row, content ?? ""));
  }
  return notes;
}
