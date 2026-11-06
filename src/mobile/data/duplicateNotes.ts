/**
 * 移动端「创建副本」的数据层（261106 task-6）。
 *
 * 语义（与桌面 `store.duplicateNote` / `core/duplicateNotes` 同一套契约）：
 * - 副本 = **全新笔记**：新 id（沿用新建管线的 `crypto.randomUUID()`）、走 `noteRepository.createNote`；
 * - 标题 = 原名称 + " 副本 " + 本地时间（`core/duplicateNotes.duplicateNoteTitle` 单一来源）；
 * - 同父级、紧邻源之后：按**目录显示顺序**取源所在父级的全部未删同级（notes + folders），
 *   在源 index 之后插入副本，再把整组 sort_order 重编号 0..n-1（单事务）。
 *   ※ 移动端 createNote 的 INSERT 不写 sort_order（默认 0），同级常常全是 0 ⇒ 不能用「源+1、只把 >源 的 +1」；
 * - 正文 = 读源正文 → 资源 URL 里原 noteId 段替换成新 id（`rewriteAssetNoteIds`）→ 新建管线落盘；
 * - 资源 = note-assets/{源}/* 全量复制到 note-assets/{新}/（同文件名；外部化/内容寻址天然独立）；
 * - 标签关系 = tag_links(kind='note') 复制一份（集合相同）+ **写一个新版本**（不照搬源版本，避免两端 LWW 比较异常）；
 * - **不复制**：历史快照、锁定状态、回收站状态（新笔记从空历史开始）。
 *
 * 资源复制只用 `native/assetFs` 的现成 API（不自造文件系统访问），App 私有目录路径契约仍是
 * `note-assets/{noteId}/{filename}`（由 assetFs 内部拼接，禁止在这里手拼物理路径）。
 *
 * 失败语义：单条失败抛 `DuplicateNoteError`（带契约 reason），由 bridge 逐条收集；其它异常按 failed。
 */
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import {
  DuplicateNoteFailure,
  duplicateNoteTitle,
} from "../../core/duplicateNotes.js";
import { prepareDuplicateBody } from "../../core/lakeBodyRewrite.js";
import { runPool } from "../../core/asyncPool.js";
import { executeBatchInTransaction, type MobileBatchStatement, type MobileDb } from "./sqliteDb.js";
import { createNote } from "./noteRepository.js";
import { deleteNoteBodies, readNoteBody } from "./noteBodies.js";
import {
  copyNoteAssetsDirNativeFs,
  listNoteAssetKeysFs,
  loadAssetBytesFs,
  removeNoteAssetsDirFs,
  saveAssetBytesFs,
} from "../native/assetFs";
import { indexNote } from "./searchIndex.js";
import { listNoteTagIds, setNoteTagsInTransaction } from "./noteTagLinksRepository.js";

/** 兼容旧名字：统一到 core 的条目级失败类型（桌面 Store 抛同一个类）。 */
export const DuplicateNoteError = DuplicateNoteFailure;

export interface DuplicateNoteOptions {
  /** 测试注入时钟（标题里的本地时间）。 */
  now?: Date;
}

/** 源笔记的元数据（副本需要的最小集合；kind 已归一）。 */
interface DuplicateSource {
  id: string;
  title: string;
  parentId: string | null;
  kind: NoteKind;
}

/** 原生资产写是原子替换：复制时跳过上次中断留下的临时文件（与桌面 collectNoteAssets 同口径）。 */
const TEMP_SUFFIX = ".tmp";

async function tableHasRow(d: MobileDb, table: "folders" | "quick_notes", id: string): Promise<boolean> {
  const row = await d.prepare(`SELECT 1 AS one FROM ${table} WHERE id=?`).get(id);
  return Boolean(row);
}

/**
 * 读源笔记并做**条目级校验**（不存在 / 已 purge / 在回收站 / 笔记本·分组·小记）。
 * 顺序与契约一致：not-found → unsupported（分组/小记）→ already-trashed。
 */
async function loadDuplicateSource(d: MobileDb, sourceId: string): Promise<DuplicateSource> {
  const row = await d.prepare(
    "SELECT id, title, parent_id, doc_kind, trashed_at, is_purged FROM notes WHERE id=?",
  ).get(sourceId) as
    | { id: string; title: string; parent_id: string | null; doc_kind?: string | null; trashed_at: string | null; is_purged: number }
    | undefined;
  if (!row) {
    // 笔记本/分组在小记目录里也不是 notes 行：契约要求 unsupported（不是 not-found）。
    if (await tableHasRow(d, "folders", sourceId)) throw new DuplicateNoteError("unsupported", "笔记本/分组不能创建副本: " + sourceId);
    if (await tableHasRow(d, "quick_notes", sourceId)) throw new DuplicateNoteError("unsupported", "小记不在创建副本范围内: " + sourceId);
    throw new DuplicateNoteError("not-found", "笔记不存在: " + sourceId);
  }
  if (Number(row.is_purged) === 1) throw new DuplicateNoteError("not-found", "笔记已被彻底删除: " + sourceId);
  if (row.trashed_at != null) throw new DuplicateNoteError("already-trashed", "笔记已在回收站: " + sourceId);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    parentId: row.parent_id ?? null,
    kind: normalizeNoteKind(row.doc_kind),
  };
}

/** 资源复制并发上限（261107 性能）：bridge 单次往返不便宜，3 路并发在手机上兼顾吞吐与内存。 */
const ASSET_COPY_CONCURRENCY = 3;

/**
 * 复制 note-assets/{源}/* → note-assets/{新}/（同文件名）。
 * 只用 assetFs 的 list/load/save（键 = "{noteId}/{filename}"，物理路径由 assetFs 拼接）。
 * 源文件读不到（列到但读不出）按失败处理：宁可这一条失败，也不产出缺资源的副本。
 *
 * 并发：单条内资源用**有界并发**（ASSET_COPY_CONCURRENCY）复制，减少大附件/多图文档的墙钟时间；
 * 整批仍由 bridge 的写域（runWrite）串行，不会与其它写操作交错。
 */
export async function copyNoteAssets(sourceId: string, targetId: string): Promise<number> {
  // 原生整目录拷贝（261107）：一次桥调用、字节不过 WebView；旧 APK/web 预览回退 JS 有界并发。
  const nativeCopied = await copyNoteAssetsDirNativeFs(sourceId, targetId);
  if (nativeCopied !== null) return nativeCopied;
  const keys = [...await listNoteAssetKeysFs(sourceId)].sort();
  const filenames: string[] = [];
  for (const key of keys) {
    const filename = key.slice(sourceId.length + 1);
    if (!filename || filename.includes("/") || filename.endsWith(TEMP_SUFFIX)) continue;
    filenames.push(filename);
  }
  await runPool(filenames, ASSET_COPY_CONCURRENCY, async (filename) => {
    const key = sourceId + "/" + filename;
    const bytes = await loadAssetBytesFs(key);
    if (!bytes) throw new DuplicateNoteError("failed", "源资源读取失败: " + key);
    await saveAssetBytesFs(targetId + "/" + filename, bytes);
  });
  return filenames.length;
}

/** 目录渲染口径的兄弟条目（notes + folders，未删）。 */
interface SiblingRow {
  id: string;
  title: string;
  sortOrder: number;
}

interface SiblingOrderPlan {
  /** 目标显示顺序（副本已插在源 index+1）。 */
  ordered: string[];
  /** 重排前各自的 sort_order（同值表示无需写）。 */
  current: Map<string, number>;
  folderIds: Set<string>;
}

/**
 * 读「源所在父级」的全部未删同级（notes + folders）并算出目标顺序。
 *
 * 排序口径必须与目录渲染一致（notebookTreeRepository.listNotebookTree）：
 * sortOrder 升序 → 标题 localeCompare(zh)（同一父级内）。**不能**用 SQL 的 ORDER BY title
 * （字节序，与 JS 的 zh 排序不同 ⇒ 副本可能插到「看起来不是源后面」的位置）。
 */
async function planSiblingOrderAfterSource(
  d: MobileDb,
  parentId: string | null,
  sourceId: string,
  newId: string,
): Promise<SiblingOrderPlan> {
  const noteRows = await d.prepare(
    "SELECT id, title, sort_order FROM notes WHERE parent_id IS ? AND trashed_at IS NULL",
  ).all(parentId) as Array<{ id: string; title: string; sort_order: number }>;
  const folderRows = await d.prepare(
    "SELECT id, title, sort_order FROM folders WHERE parent_id IS ? AND trashed_at IS NULL",
  ).all(parentId) as Array<{ id: string; title: string; sort_order: number }>;
  const rows: SiblingRow[] = [
    ...noteRows.map((row) => ({ id: String(row.id), title: String(row.title ?? ""), sortOrder: Number(row.sort_order ?? 0) })),
    ...folderRows.map((row) => ({ id: String(row.id), title: String(row.title ?? ""), sortOrder: Number(row.sort_order ?? 0) })),
  ];
  // 与 listNotebookTree 完全一致：Array#sort 稳定 + sortOrder → 标题 zh。
  rows.sort((a, b) => (a.sortOrder - b.sortOrder) || a.title.localeCompare(b.title, "zh"));
  const order = rows.map((row) => row.id);
  const sourceIndex = order.indexOf(sourceId);
  const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : order.length;
  return {
    ordered: [...order.slice(0, insertAt), newId, ...order.slice(insertAt)],
    current: new Map(rows.map((row) => [row.id, row.sortOrder] as const)),
    folderIds: new Set(folderRows.map((row) => String(row.id))),
  };
}

/**
 * 单事务内把「源所在父级的同级」重编号 0..n-1（副本落在源 index+1），notes/folders 一起写。
 *
 * 为什么不是「源+1、只把 >源 的 +1」：移动端 noteRepository.createNote 的 INSERT **不写 sort_order**
 * （默认 0），同级文档常常全是 0（设备实测：源(0)、图片文档(0)、副本(1) ⇒ 副本被排到所有 0 之后，
 * 不紧邻源）。按目录显示顺序整组归一化后，副本必然紧邻源，且各条相对顺序不变。
 *
 * 只写「排序值真的变了」的行（副本必写）：正常已经递增的父级不会让全部同级都变 dirty/updated_at。
 * 回收站里的条目不在这一组（不进目录顺序），保持原位不动。
 */
async function writeSiblingOrder(d: MobileDb, plan: SiblingOrderPlan, newId: string, at: string): Promise<void> {
  const statements: MobileBatchStatement[] = [];
  plan.ordered.forEach((id, index) => {
    if (id !== newId && plan.current.get(id) === index) return;
    statements.push(plan.folderIds.has(id)
      ? { statement: "UPDATE folders SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=?", values: [index, at, id] }
      : { statement: "UPDATE notes SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=?", values: [index, at, id] });
  });
  if (statements.length > 0) await executeBatchInTransaction(d, statements);
}

/**
 * 复制单篇（bridge/duplicateNotes 的逐条实现；抛 `DuplicateNoteError` 给契约 reason）。
 *
 * 顺序 = 读源 → 复制资源（写库前落盘）→ 单事务（同级重编号计划 + createNote 管线 + sort_order + 标签）→ 建派生索引。
 * 事务失败时只回收「本事务没成功登记」的正文与资源；绝不误删已登记的副本。
 */
export async function duplicateNote(d: MobileDb, sourceId: string, options: DuplicateNoteOptions = {}): Promise<{ id: string }> {
  const source = await loadDuplicateSource(d, sourceId);
  const sourceBody = await readNoteBody(source.kind, source.id);
  if (sourceBody == null) throw new DuplicateNoteError("body-missing", "正文文件缺失，已拒绝复制空正文: " + source.id);

  const newId = crypto.randomUUID();
  const title = duplicateNoteTitle(source.title, options.now ?? new Date());
  // 正文改写三件套单入口（与桌面共用 core/lakeBodyRewrite.prepareDuplicateBody）。
  const content = prepareDuplicateBody(sourceBody, { sourceId: source.id, newId, kind: source.kind });
  const tagIds = await listNoteTagIds(d, source.id).catch(() => [] as string[]);

  try {
    // 资源先完整复制（写库前落盘）：任何失败都走下面的回收分支，不留下"有元数据、没资源"的副本。
    await copyNoteAssets(source.id, newId);
    await d.transaction(async () => {
      const at = new Date().toISOString();
      // 先按当前目录显示顺序算好「副本紧邻源之后」的目标顺序（此刻副本行还没插，避免算进它自己）。
      const orderPlan = await planSiblingOrderAfterSource(d, source.parentId, source.id, newId);
      // 新建管线（与「新建文档」同一条）：先写正文文件、再插元数据行；正文已重写为指向新 id 的资源 URL。
      // skipSearchIndex：索引写入自带事务，不能在当前事务里嵌套（原生/sql.js 都会报 "Already in transaction"），
      // 事务提交后再单独建一次派生索引（失败只告警，索引可由 reconcileIndex 重建）。
      await createNote(d, newId, title, content, source.parentId, new Map(), undefined, source.kind, { skipSearchIndex: true });
      // 整组同级重编号 0..n-1：副本 = 源 index+1。createNote 的 INSERT 不写 sort_order（默认 0）,
      // 不能靠「源+1 且只把 >源 的 +1」——同级全 0 时那样副本会排到所有 0 之后（设备实测 bug）。
      await writeSiblingOrder(d, orderPlan, newId, at);
      // 标签关系复制到新笔记：集合相同、**写新版本**（照搬源版本会让两端 LWW 比较异常）。
      if (tagIds.length > 0) await setNoteTagsInTransaction(d, newId, tagIds, at);
    });
  } catch (error) {
    const landed = await d.prepare("SELECT 1 AS one FROM notes WHERE id=?").get(newId);
    if (!landed) {
      await deleteNoteBodies(newId).catch(() => undefined);
      await removeNoteAssetsDirFs(newId).catch(() => undefined);
    }
    throw error;
  }

  try {
    await indexNote(d, newId);
  } catch (error) {
    console.warn("[duplicate] 副本已创建，搜索索引失败（可由全量重建修复）:", newId, error);
  }
  return { id: newId };
}