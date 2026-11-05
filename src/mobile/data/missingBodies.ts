/**
 * 「缺正文」扫描与恢复落盘（移动端 B-lite，261104）。
 *
 * 背景：正文是**文件**（src/core/noteBodyPaths.ts），SQLite 只有元数据/hash/派生缓存。
 * 手动删掉 .lake / .qnote、或写盘失败后，元数据还在但正文没了。移动端原行为：
 * - 文档：noteRepository.readNote 遇正文 null 直接返回 null（打不开）⇒ 已比"只读"更严，不会覆盖；
 * - 小记：readQuickNote 返回 null ⇒ 打开是**静默 no-op**（用户只看到点了没反应）。
 * 本轮补的是「可处置」：只 stat 不读正文地列出缺正文清单（判据复用 core/missingBody.ts 的
 * missingBodyRecovery / missingQuickNoteRecovery），并给三条恢复动作提供落盘函数。
 *
 * 分工：
 * - 本文件 = 纯判据 + DB/文件落盘（不碰网络；云端拉取在 bridge 里做，失败可明确回报）；
 * - bridge = 单篇云端拉回（priority 域）、缓存纯文本重建（write 域）、彻底删除归现有回收站方法。
 *
 * 关键红线：
 * - **只 stat，不读正文**（缺正文时读必失败；也不该为了"看一眼"去碰文件）；
 * - 扫描不写库（桌面那套「缺正文恢复队列」是事件驱动的 v2 遗产，移动端不引入：每次进资源管理现扫即可）；
 * - 恢复落盘先写文件、再改行（DB 不应声称正文已存在，与 noteRepository.createNote 同序）。
 */
import { missingBodyRecovery, missingQuickNoteRecovery } from "../../core/missingBody.js";
import type { MissingBodyRecovery, MissingQuickNoteRecovery } from "../../core/missingBody.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import {
  normalizeQuickNoteContent,
  previewQuickNote,
  quickNoteBodyFromTextAndImages,
  serializeQuickNoteContent,
  type StoredQuickNoteContent,
} from "../../core/quickNoteModel.js";
import {
  statNoteBodiesBatch,
  statQuickNoteBodiesBatch,
  writeNoteBody,
  writeQuickNoteBody,
} from "./noteBodies.js";
import { loadV3State } from "./v3StateRepository.js";
import { indexNote } from "./searchIndex.js";
import { indexQuickNote } from "./quickNotesSearch.js";
import type { MobileDb } from "./sqliteDb.js";

/**
 * 每次批量 stat 的条数。原生 BodyStore.statMany 一次桥往返可带很多路径，但：
 * 2 万文档全量拼一个数组 ⇒ 两端各自 stringify 一份大 JSON；分批同时让「部分失败」可局部重试，
 * 且与搜索索引 RECONCILE_BATCH_SIZE 的 20/200 口径一致（本文只 stat，200 已远小于正文批）。
 */
export const MISSING_SCAN_BATCH = 200;

/** 缺正文文档（字段与 core MissingBodyDoc 对齐，另加 UI 需要的标题/类型）。 */
export interface MissingNoteBody {
  id: string;
  title: string;
  kind: NoteKind;
  updatedAt: string;
  parentId: string | null;
  historyCount: number;
  lastHistoryId: number | null;
  hasSyncBase: boolean;
  cloudConfigured: boolean;
  recovery: MissingBodyRecovery;
}

/** 缺正文小记（字段与 core MissingQuickNoteDoc 对齐）。 */
export interface MissingQuickNote {
  id: string;
  createdAt: string;
  updatedAt: string;
  previewText: string;
  imageCount: number;
  tags: string;
  hasSyncBase: boolean;
  cloudConfigured: boolean;
  hasTextCache: boolean;
  recovery: MissingQuickNoteRecovery;
}

/** 资源管理一次读到的全量快照（文档 + 小记 + 云可用性）。 */
export interface MissingBodiesSnapshot {
  /** 允许出网（已配置 S3 且未关闭云同步）；false 时「从云端拉回」一律不可用。 */
  cloudConfigured: boolean;
  docs: MissingNoteBody[];
  quickNotes: MissingQuickNote[];
}

/** 按固定大小切片（纯函数；空数组 → 空数组）。 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size 必须为正");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 从「与 ids 对齐的 stat 结果」里挑出文件缺失的 id（顺序保持输入顺序）。 */
export function missingIdsByStats(ids: readonly string[], stats: ReadonlyArray<{ exists: boolean }>): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length && i < stats.length; i += 1) if (!stats[i].exists) out.push(ids[i]);
  return out;
}

/** UI 分组：可云恢复 / 仅历史 / 无备份（顺序固定，与桌面资源页分组一致）。 */
export function groupMissingDocs(docs: readonly MissingNoteBody[]): { cloud: MissingNoteBody[]; history: MissingNoteBody[]; none: MissingNoteBody[] } {
  return {
    cloud: docs.filter((doc) => doc.recovery === "cloud"),
    history: docs.filter((doc) => doc.recovery === "history"),
    none: docs.filter((doc) => doc.recovery === "none"),
  };
}

/** UI 分组：可云恢复 / 可重建纯文本 / 无备份（小记没有历史快照，**不要**造历史路径）。 */
export function groupMissingQuickNotes(items: readonly MissingQuickNote[]): { cloud: MissingQuickNote[]; text: MissingQuickNote[]; none: MissingQuickNote[] } {
  return {
    cloud: items.filter((item) => item.recovery === "cloud"),
    text: items.filter((item) => item.recovery === "text"),
    none: items.filter((item) => item.recovery === "none"),
  };
}

/** 读 v3 账本（表未建/坏行按空账本处理：缺正文扫描不该因为同步账本读失败而整体失败）。 */
async function safeLoadV3State(d: MobileDb): Promise<Awaited<ReturnType<typeof loadV3State>>> {
  try { return await loadV3State(d); }
  catch (error) { console.warn("[missing-body] 读取 v3 账本失败，按未同步处理", error); return { baseline: null, intents: [], pending: [], remotePurged: [], restorePending: [], assetsHash: {} }; }
}

/** 本轮成功同步过的云端文档 id 集合（v3 基线 = 上轮发布的索引；与桌面 Del-6 的 remoteNoteIds 同义）。 */
function cloudDocIds(state: Awaited<ReturnType<typeof loadV3State>>): Set<string> {
  return new Set((state.baseline?.lake?.notes ?? []).map((entry) => String(entry.id)));
}

/** 本轮成功同步过的云端小记 id 集合。 */
function cloudQuickNoteIds(state: Awaited<ReturnType<typeof loadV3State>>): Set<string> {
  return new Set((state.baseline?.quickNotes?.items ?? []).map((entry) => String(entry.id)));
}

/** 缺正文文档清单（只 stat 不读正文）。 */
export async function scanMissingNoteBodies(d: MobileDb, opts: { cloudConfigured: boolean }): Promise<MissingNoteBody[]> {
  const rows = await d.prepare(
    "SELECT id, title, parent_id, updated_at, doc_kind FROM notes WHERE trashed_at IS NULL AND is_purged=0",
  ).all() as Array<{ id: string; title: string; parent_id: string | null; updated_at: string; doc_kind?: string | null }>;
  if (rows.length === 0) return [];
  const items = rows.map((row) => ({ kind: normalizeNoteKind(row.doc_kind), id: String(row.id) }));
  const stats: Array<{ exists: boolean; size: number }> = [];
  for (const part of chunk(items, MISSING_SCAN_BATCH)) stats.push(...await statNoteBodiesBatch(part));
  const missingIds = missingIdsByStats(items.map((item) => item.id), stats);
  if (missingIds.length === 0) return [];
  const missingSet = new Set(missingIds);
  const history = await historyCounts(d, missingIds);
  const state = await safeLoadV3State(d);
  const cloudIds = cloudDocIds(state);
  const out: MissingNoteBody[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const id = String(row.id);
    if (!missingSet.has(id)) continue;
    const historyCount = history.get(id)?.count ?? 0;
    const hasSyncBase = cloudIds.has(id);
    const cloudConfigured = opts.cloudConfigured;
    out.push({
      id,
      title: String(row.title ?? ""),
      kind: items[i].kind,
      updatedAt: String(row.updated_at ?? ""),
      parentId: row.parent_id == null ? null : String(row.parent_id),
      historyCount,
      lastHistoryId: history.get(id)?.last ?? null,
      hasSyncBase,
      cloudConfigured,
      recovery: missingBodyRecovery({ cloudConfigured, hasSyncBase, historyCount }),
    });
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

/** 每篇文档的历史快照数与最新快照 id（只查缺正文的那批，避免全表 N+1）。 */
async function historyCounts(d: MobileDb, noteIds: readonly string[]): Promise<Map<string, { count: number; last: number | null }>> {
  const out = new Map<string, { count: number; last: number | null }>();
  for (const part of chunk(noteIds, MISSING_SCAN_BATCH)) {
    const placeholders = part.map(() => "?").join(",");
    let rows: Array<{ note_id: string; c: number; last: number | null }> = [];
    try {
      rows = await d.prepare(
        `SELECT note_id, COUNT(*) AS c, MAX(id) AS last FROM note_history WHERE note_id IN (${placeholders}) GROUP BY note_id`,
      ).all(...part) as Array<{ note_id: string; c: number; last: number | null }>;
    } catch { rows = []; } // 历史表在老库/裁剪环境可能不存在：按无历史处理，不影响其它恢复路径
    for (const row of rows) out.set(String(row.note_id), { count: Number(row.c) || 0, last: row.last == null ? null : Number(row.last) });
  }
  return out;
}

/** 缺正文小记清单（只 stat 不读正文；搜索缓存文本只查派生表，不碰 .qnote）。 */
export async function scanMissingQuickNotes(d: MobileDb, opts: { cloudConfigured: boolean }): Promise<MissingQuickNote[]> {
  const rows = await d.prepare(
    "SELECT id, created_at, updated_at, preview_text, image_count FROM quick_notes WHERE deleted_at IS NULL AND restore_pending_at IS NULL",
  ).all() as Array<{ id: string; created_at: string; updated_at: string; preview_text: string; image_count: number }>;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const stats: Array<{ exists: boolean; size: number }> = [];
  for (const part of chunk(ids, MISSING_SCAN_BATCH)) stats.push(...await statQuickNoteBodiesBatch(part));
  const missingIds = new Set(missingIdsByStats(ids, stats));
  if (missingIds.size === 0) return [];
  const cached = await quickNoteTextCache(d, [...missingIds]);
  const state = await safeLoadV3State(d);
  const cloudIds = cloudQuickNoteIds(state);
  const out: MissingQuickNote[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (!missingIds.has(id)) continue;
    const textCache = cached.get(id)?.text ?? "";
    const hasTextCache = textCache.trim().length > 0;
    const hasSyncBase = cloudIds.has(id);
    const cloudConfigured = opts.cloudConfigured;
    out.push({
      id,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      previewText: String(row.preview_text ?? ""),
      imageCount: Number(row.image_count) || 0,
      tags: cached.get(id)?.tags ?? "",
      hasSyncBase,
      cloudConfigured,
      hasTextCache,
      recovery: missingQuickNoteRecovery({ cloudConfigured, hasSyncBase, hasTextCache }),
    });
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

/** 小记搜索索引里的全文缓存与标签文本（派生表缺失按"没有缓存"处理）。 */
async function quickNoteTextCache(d: MobileDb, ids: readonly string[]): Promise<Map<string, { text: string; tags: string }>> {
  const out = new Map<string, { text: string; tags: string }>();
  for (const part of chunk(ids, MISSING_SCAN_BATCH)) {
    const placeholders = part.map(() => "?").join(",");
    let rows: Array<{ quick_note_id: string; text_cache?: string | null; tags?: string | null }> = [];
    try {
      rows = await d.prepare(
        `SELECT quick_note_id, text_cache, tags FROM quick_notes_search_index WHERE quick_note_id IN (${placeholders})`,
      ).all(...part) as typeof rows;
    } catch { rows = []; }
    for (const row of rows) {
      out.set(String(row.quick_note_id), {
        text: typeof row.text_cache === "string" ? row.text_cache : "",
        tags: typeof row.tags === "string" ? row.tags : "",
      });
    }
  }
  return out;
}

/** 资源管理入口一次拿全量（文档 + 小记 + 云可用性）。 */
export async function scanMissingBodies(d: MobileDb, opts: { cloudConfigured: boolean }): Promise<MissingBodiesSnapshot> {
  const docs = await scanMissingNoteBodies(d, opts);
  const quickNotes = await scanMissingQuickNotes(d, opts);
  return { cloudConfigured: opts.cloudConfigured, docs, quickNotes };
}

/**
 * 云端拉回的**内容是否可信**：sha256 必须与索引条目的 contentHash 一致。
 * 纯函数（bridge 拉取后调用；单元测试覆盖"错 hash 不落盘"）。
 */
export function restoredBodyMatchesHash(content: string, expectedHash: string): boolean {
  return sha256Sync(new TextEncoder().encode(content)) === expectedHash;
}

/** 恢复落盘（文档）：先写正文文件，再更新行（is_dirty=0 = 正文与云端一致，无需再上传）。 */
export async function applyRestoredNoteBody(d: MobileDb, id: string, kind: NoteKind, content: string, opts: { synced: boolean }): Promise<void> {
  const contentHash = sha256Sync(new TextEncoder().encode(content));
  const plain = searchTextForKind(kind, content).plain ?? "";
  await writeNoteBody(kind, id, content);
  const changed = await d.prepare(
    "UPDATE notes SET content_hash=?, text_cache=?, is_dirty=? WHERE id=? AND trashed_at IS NULL AND is_purged=0",
  ).run(contentHash, plain, opts.synced ? 0 : 1, id);
  if (!changed.changes) throw new Error("正文已恢复但文档行状态已变化（回收站/已删除），未写入");
  await indexNote(d, id);
}

/** 由搜索缓存纯文本重建小记内容（图片与格式会丢；重建后 is_dirty=1 待上传）。 */
export function rebuildQuickNoteContentFromText(text: string): StoredQuickNoteContent {
  const body = quickNoteBodyFromTextAndImages(text, [], () => "", () => crypto.randomUUID());
  return normalizeQuickNoteContent(text, body, []);
}

/** 恢复落盘（小记）：先写正文文件，再更新行；synced=false 用于"搜索缓存重建"（本地版本，待同步）。 */
export async function applyRestoredQuickNote(
  d: MobileDb,
  id: string,
  content: StoredQuickNoteContent,
  opts: { synced: boolean; updatedAt?: string },
): Promise<void> {
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(content.text, content.images.length);
  const firstImage = content.images[0]?.filename ?? null;
  await writeQuickNoteBody(id, serialized);
  const changed = await d.prepare(
    "UPDATE quick_notes SET updated_at=COALESCE(?, updated_at), preview_text=?, image_count=?, content_hash=?, is_dirty=?, is_conflict=0, first_image=?, list_metadata_version=1 WHERE id=?",
  ).run(opts.updatedAt ?? null, preview, content.images.length, contentHash, opts.synced ? 0 : 1, firstImage, id);
  if (!changed.changes) throw new Error("小记正文已恢复但行不存在（可能已被删除）");
  await indexQuickNote(d, id, true);
}
