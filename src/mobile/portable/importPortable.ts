/**
 * 便携包导入（覆盖本机）的**编排层**：docs/PORTABLE-TRANSFER.md §3。
 *
 * 顺序（任何一步失败 ⇒ 原生回滚到导入前）：
 *   选包/解压（原生）→ 解析清单（core）→ 关闭 DB → 原生隔离出回滚点并写 pending
 *   → 重建空库（不播种）→ 原生复制正文/资产/小记文件 → 分页读桌面库并映射写入
 *   → 写 sync_v3_state 基线（intents/pending/assetsHash 置空）→ 清 note_history/text_cache
 *   → 原生提交（删隔离与 staging）→ 后台重建 FTS。
 *
 * 映射纯逻辑在 ./portableMapping.ts；原生边界在 ../native/portablePackage.ts。
 */
import { parsePortableManifest, type PortableCounts, type PortableManifest } from "../../core/portable/portableFormat";
import { executeBatch, type MobileBatchStatement, type MobileDb } from "../data/sqliteDb";
import { closeDbForPortableImport, ensureDb, reopenDbForPortableImport } from "../bridge/context";
import { ensureV3StateTable, saveV3State, EMPTY_MOBILE_V3_STATE } from "../data/v3StateRepository";
import { clearSearchDerivedCache } from "../data/derivedSearchCache";
import { reconcileIndex } from "../data/searchIndex";
import { readSyncProgress } from "../sync/syncProgressStore";
import { setPortableImportRunning } from "./importFlag";
import {
  isPortableImportNativeAvailable,
  nativeBeginPortableImport,
  nativeCommitPortableImport,
  nativeCopyPortablePayload,
  nativeDiscardPortableStaging,
  nativePickPortablePackage,
  nativePortablePendingInfo,
  nativeReadPortableBaseline,
  nativeReadPortableRows,
  nativeRecoverPortableImport,
  nativeRollbackPortableImport,
  type PortableDbKey,
  type PortableTable,
} from "../native/portablePackage";
import {
  mapDesktopQuickData,
  mapDesktopTree,
  parsePortableBaseline,
  type DesktopRow,
  type MappedQuickData,
} from "./portableMapping";

export interface StagedPortablePackage {
  stagingPath: string;
  manifest: PortableManifest;
  bytes: number;
  entries: number;
}

export type PortableImportPhase =
  | "rollback-point"
  | "copy-files"
  | "read-rows"
  | "write-rows"
  | "baseline"
  | "commit"
  | "done";

export interface PortableImportProgress {
  phase: PortableImportPhase;
  detail: string;
}

export interface PortableImportResult {
  counts: { notes: number; folders: number; quickNotes: number; tags: number; assets: number; bytes: number };
  /** 与清单 counts 不一致时给出提示（不阻断：桌面导出时可能刚好有变动）。 */
  warnings: string[];
  skippedRows: number;
}

const PAGE_SIZE = 500;
const WRITE_BATCH = 400;

/**
 * 选择并校验便携包（不触碰本机数据）。返回 null = 用户取消。
 * 清单解析用 core 单一来源；原生只做解压与粗校验。
 */
export async function pickPortablePackageForImport(): Promise<StagedPortablePackage | null> {
  if (!isPortableImportNativeAvailable()) {
    throw new Error("浏览器预览不支持从便携包导入，请在 Android 上操作");
  }
  const picked = await nativePickPortablePackage();
  if (!picked.ok) {
    if (picked.cancelled) return null;
    throw new Error(picked.error || "便携包无效");
  }
  if (!picked.stagingPath || !picked.manifestJson) {
    await nativeDiscardPortableStaging(picked.stagingPath ?? "");
    throw new Error("便携包无效（缺少 staging 或清单）");
  }
  let manifest: PortableManifest;
  try {
    manifest = parsePortableManifest(JSON.parse(picked.manifestJson));
  } catch (error) {
    await nativeDiscardPortableStaging(picked.stagingPath);
    throw new Error("便携包无效：" + (error instanceof Error ? error.message : String(error)));
  }
  return {
    stagingPath: picked.stagingPath,
    manifest,
    bytes: picked.bytes ?? manifest.counts.bytes,
    entries: picked.entries ?? 0,
  };
}

/** 放弃已选中但尚未导入的便携包（清理 cache staging）。 */
export async function discardStagedPortablePackage(staged: StagedPortablePackage | null): Promise<void> {
  if (!staged) return;
  await nativeDiscardPortableStaging(staged.stagingPath);
}

async function readAllRows(
  stagingPath: string,
  db: PortableDbKey,
  table: PortableTable,
  onProgress?: (progress: PortableImportProgress) => void,
): Promise<DesktopRow[]> {
  const rows: DesktopRow[] = [];
  let offset = 0;
  while (true) {
    const page = await nativeReadPortableRows({ stagingPath, db, table, offset, limit: PAGE_SIZE });
    if (!page.ok) throw new Error(page.error || "读取桌面数据库失败: " + table);
    rows.push(...page.rows);
    if (page.done || page.rows.length === 0) break;
    offset += page.rows.length;
    if (offset > 500_000) throw new Error("桌面数据库行数异常（超过 50 万）");
    onProgress?.({ phase: "read-rows", detail: "读取 " + table + "：" + rows.length + " 行" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return rows;
}

function noteStatements(rows: ReturnType<typeof mapDesktopTree>["notes"]) {
  return rows.map((row): MobileBatchStatement => ({
    statement:
      "INSERT OR REPLACE INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_purged,is_conflict,deleted_at,doc_kind,cloud_deleted,trashed_at,deleted_from_parent_id,restore_pending_at,is_locked,locked_at,icon,text_cache) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    values: [
      row.id, row.title, row.parent_id, row.sort_order, row.updated_at, row.content_hash, row.is_dirty,
      row.is_purged, row.is_conflict, row.deleted_at, row.doc_kind, row.cloud_deleted, row.trashed_at,
      row.deleted_from_parent_id, row.restore_pending_at, row.is_locked, row.locked_at, row.icon, row.text_cache,
    ],
  }));
}

function folderStatements(rows: ReturnType<typeof mapDesktopTree>["folders"]) {
  return rows.map((row): MobileBatchStatement => ({
    statement:
      "INSERT OR REPLACE INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty,is_purged,cloud_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    values: [
      row.id, row.title, row.parent_id, row.sort_order, row.node_type, row.icon, row.updated_at, row.trashed_at,
      row.deleted_from_parent_id, row.is_dirty, row.is_purged, row.cloud_deleted,
    ],
  }));
}

function tombstoneStatements(rows: ReturnType<typeof mapDesktopTree>["tombstones"]) {
  return rows.map((row): MobileBatchStatement => ({
    statement:
      "INSERT OR REPLACE INTO deleted_notes (id,title,parent_id,sort_order,updated_at,deleted_at,node_type,purged_at) VALUES (?,?,?,?,?,?,?,?)",
    values: [row.id, row.title, row.parent_id, row.sort_order, row.updated_at, row.deleted_at, row.node_type, row.purged_at],
  }));
}

function quickStatements(data: MappedQuickData) {
  const statements: MobileBatchStatement[] = [];
  for (const row of data.quickNotes) {
    statements.push({
      statement:
        "INSERT OR REPLACE INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,deleted_at,tags_updated_at,first_image,list_metadata_version,cloud_deleted,ready_to_sync) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      values: [
        row.id, row.created_at, row.updated_at, row.preview_text, row.image_count, row.content_hash, row.is_dirty,
        row.is_conflict, row.restore_pending_at, row.deleted_at, row.tags_updated_at, row.first_image,
        row.list_metadata_version, row.cloud_deleted, row.ready_to_sync,
      ],
    });
  }
  for (const row of data.quickNoteDeleted) {
    statements.push({
      statement: "INSERT OR REPLACE INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) VALUES (?,?,?,?,?)",
      values: [row.id, row.created_at, row.updated_at, row.deleted_at, row.purged_at],
    });
  }
  for (const row of data.tags) {
    statements.push({
      statement: "INSERT OR REPLACE INTO tags (id,name,sort_order,created_at,updated_at) VALUES (?,?,?,?,?)",
      values: [row.id, row.name, row.sort_order, row.created_at, row.updated_at],
    });
  }
  for (const row of data.tagLinks) {
    statements.push({
      statement: "INSERT OR IGNORE INTO tag_links (target_kind,target_id,tag_id,position) VALUES (?,?,?,?)",
      values: [row.target_kind, row.target_id, row.tag_id, row.position],
    });
  }
  for (const row of data.tagLinkVersions) {
    statements.push({
      statement: "INSERT OR REPLACE INTO tag_link_versions (target_kind,target_id,links_updated_at) VALUES (?,?,?)",
      values: [row.target_kind, row.target_id, row.links_updated_at],
    });
  }
  return statements;
}

async function writeInBatches(db: MobileDb, statements: MobileBatchStatement[], onProgress?: (progress: PortableImportProgress) => void): Promise<void> {
  for (let index = 0; index < statements.length; index += WRITE_BATCH) {
    const batch = statements.slice(index, index + WRITE_BATCH);
    await executeBatch(db, batch);
    onProgress?.({
      phase: "write-rows",
      detail: "写入数据 " + Math.min(index + batch.length, statements.length) + " / " + statements.length,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 清空本机业务/账本表（新库只有 schema 种子，这里一并清掉，避免残留「个人笔记」空目录）。 */
async function clearImportedTables(db: MobileDb): Promise<void> {
  const tables = [
    "notes", "folders", "deleted_notes", "quick_notes", "quick_note_deleted", "tags",
    "tag_links", "tag_link_versions", "note_history", "sync_v3_state",
  ];
  await executeBatch(db, tables.map((table) => ({ statement: "DELETE FROM " + table, values: [] })));
}

function compareCounts(manifestCounts: PortableCounts, result: PortableImportResult): string[] {
  const warnings: string[] = [];
  const check = (name: string, expected: number, actual: number): void => {
    if (expected !== actual) warnings.push(name + "：清单 " + expected + "，实际导入 " + actual);
  };
  check("笔记", manifestCounts.notes, result.counts.notes);
  // 手机端启动/导入会确保固定「回收站」目录，但它不在桌面 manifest 的 folders 里 ⇒ 允许 +1，不告警。
  if (result.counts.folders !== manifestCounts.folders && result.counts.folders !== manifestCounts.folders + 1) {
    warnings.push("目录：清单 " + manifestCounts.folders + "，实际导入 " + result.counts.folders);
  }
  check("小记", manifestCounts.quickNotes, result.counts.quickNotes);
  check("标签", manifestCounts.tags, result.counts.tags);
  return warnings;
}

/**
 * 执行导入（覆盖本机）。失败会回滚并抛错（message 已带「已回滚/下次启动再回滚」）。
 */
export async function runPortableImport(
  staged: StagedPortablePackage,
  onProgress?: (progress: PortableImportProgress) => void,
): Promise<PortableImportResult> {
  if (!isPortableImportNativeAvailable()) throw new Error("浏览器预览不支持从便携包导入，请在 Android 上操作");
  if (!isUpdateImportSyncIdle()) {
    // 同步进行中导入会与同步写库交错：直接拒绝，用户稍后再试（也允许关掉自动同步）。
    throw new Error("正在同步，请等本轮同步结束后再导入（或先关闭自动同步）");
  }
  // 同步入口（bridge/sync.ts 的 syncNow）据此拒绝启动，避免导入替换数据库时正好有一轮同步在写。
  setPortableImportRunning(true);
  try {
    return await runPortableImportInner(staged, onProgress);
  } finally {
    setPortableImportRunning(false);
  }
}

function isUpdateImportSyncIdle(): boolean {
  try {
    return readSyncProgress() === null;
  } catch {
    return true;
  }
}

async function runPortableImportInner(
  staged: StagedPortablePackage,
  onProgress?: (progress: PortableImportProgress) => void,
): Promise<PortableImportResult> {
  // 先读基线（只读 staging）：基线不合法就在动数据之前失败。
  const baselineFile = await nativeReadPortableBaseline(staged.stagingPath);
  if (!baselineFile.ok || !baselineFile.json) {
    throw new Error("便携包缺少可用的同步基线：" + (baselineFile.error || "未知原因"));
  }
  let parsedBaseline: ReturnType<typeof parsePortableBaseline>;
  try {
    parsedBaseline = parsePortableBaseline(JSON.parse(baselineFile.json));
  } catch (error) {
    throw new Error("便携包同步基线不合法：" + (error instanceof Error ? error.message : String(error)));
  }

  let dbOpened = false;
  try {
    onProgress?.({ phase: "rollback-point", detail: "关闭数据库并建立回滚点…" });
    await closeDbForPortableImport();
    const begun = await nativeBeginPortableImport(staged.stagingPath);
    if (!begun.ok) throw new Error(begun.error || "无法建立回滚点");

    onProgress?.({ phase: "rollback-point", detail: "重建本机数据库…" });
    const db = await reopenDbForPortableImport();
    dbOpened = true;
    await clearImportedTables(db);

    onProgress?.({ phase: "copy-files", detail: "复制正文 / 附件 / 小记文件…" });
    const copied = await nativeCopyPortablePayload(staged.stagingPath);
    if (!copied.ok) throw new Error(copied.error || "复制文件失败");

    onProgress?.({ phase: "read-rows", detail: "读取桌面数据库…" });
    const [treeRows, noteRows] = await Promise.all([
      readAllRows(staged.stagingPath, "main", "tree_nodes", onProgress),
      readAllRows(staged.stagingPath, "main", "notes", onProgress),
    ]);
    const quickInput = {
      quickNotes: await readAllRows(staged.stagingPath, "quick", "quick_notes", onProgress),
      quickNoteDeleted: await readAllRows(staged.stagingPath, "quick", "quick_note_deleted", onProgress),
      tags: await readAllRows(staged.stagingPath, "quick", "tags", onProgress),
      // 261107 起文档与小记的标签关系都在 quick-notes 库（主库旧行是迁移残留，不再读）。
      tagLinks: await readAllRows(staged.stagingPath, "quick", "tag_links", onProgress),
      tagLinkVersions: await readAllRows(staged.stagingPath, "quick", "tag_link_versions", onProgress),
    };
    const treeData = mapDesktopTree(treeRows, noteRows, parsedBaseline);
    const quickData = mapDesktopQuickData({ ...quickInput, baseline: parsedBaseline });

    onProgress?.({ phase: "write-rows", detail: "写入文档与目录…" });
    await writeInBatches(db, folderStatements(treeData.folders), onProgress);
    await writeInBatches(db, noteStatements(treeData.notes), onProgress);
    await writeInBatches(db, tombstoneStatements(treeData.tombstones), onProgress);
    await writeInBatches(db, quickStatements(quickData), onProgress);

    onProgress?.({ phase: "baseline", detail: "写入已同步基线…" });
    await ensureV3StateTable(db);
    await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, baseline: parsedBaseline.baseline });
    await executeBatch(db, [
      { statement: "DELETE FROM note_history", values: [] },
      { statement: "UPDATE notes SET text_cache=NULL", values: [] },
    ]);

    const result: PortableImportResult = {
      counts: {
        notes: treeData.notes.length,
        folders: treeData.folders.length,
        quickNotes: quickData.quickNotes.length,
        tags: quickData.tags.length,
        assets: copied.files ?? 0,
        bytes: copied.bytes ?? 0,
      },
      warnings: [],
      skippedRows: treeData.skipped + quickData.skipped,
    };
    result.warnings = compareCounts(staged.manifest.counts, result);

    onProgress?.({ phase: "commit", detail: "提交并清理临时文件…" });
    const committed = await nativeCommitPortableImport();
    if (!committed.ok) {
      // 提交失败不能回滚（数据已就绪）：下次启动 pending 会回滚成旧数据，必须明说。
      throw new Error("导入已写入但清理临时文件失败；请重启 App 后检查数据（若数据不对，重启会自动回滚）");
    }

    onProgress?.({ phase: "done", detail: "重建搜索索引…" });
    void (async () => {
      try {
        await clearSearchDerivedCache(db);
      } catch (error) {
        console.warn("[portable] 清除派生搜索缓存失败（后台重建会继续）", error);
      }
      try {
        await reconcileIndex(db);
      } catch (error) {
        console.warn("[portable] 导入后搜索索引重建失败（下次启动会继续）", error);
      }
    })();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 回滚：先关掉新库，再让原生把旧库/旧目录放回；最后按正常启动流程重开。
    if (dbOpened) {
      try { await closeDbForPortableImport(); } catch { /* 已在失败路径 */ }
    }
    const rollback = await nativeRollbackPortableImport();
    try { await ensureDb(); } catch (rebuildError) { console.warn("[portable] 回滚后重开数据库失败", rebuildError); }
    // rollback.ok = 原生已把「当前数据」收拾干净（begin 半途失败时它已内部恢复；有 pending 时 restored=true）。
    if (rollback.ok) {
      throw new Error("导入失败，已回滚到导入前的数据：" + message);
    }
    throw new Error("导入失败，自动回滚未成功（下次启动会按 pending 再回滚）：" + message);
  }
}

// ---- 启动时 pending 恢复（必须在 bridge.init / 打开数据库之前调用） ----

let recoveryNotice: string | null = null;

/**
 * 上次导入中断（崩溃/断电）：原生按 pending 自动回滚。
 * 返回 true = 发现并处理了 pending；调用方可在 UI 就绪后 consumePortableRecoveryNotice() 提示。
 */
export async function recoverInterruptedPortableImport(): Promise<boolean> {
  if (!isPortableImportNativeAvailable()) return false;
  try {
    const info = await nativePortablePendingInfo();
    if (!info.pending) return false;
    const result = await nativeRecoverPortableImport();
    recoveryNotice = result.ok
      ? "上次便携包导入未完成，已自动回滚到导入前的数据"
      : "上次便携包导入未完成，自动回滚失败（" + (result.error || "未知原因") + "）";
    return true;
  } catch (error) {
    recoveryNotice = "上次便携包导入未完成，自动回滚失败：" + (error instanceof Error ? error.message : String(error));
    return true;
  }
}

/** 取出并清空「上次导入已回滚」提示（UI 就绪后调用一次）。 */
export function consumePortableRecoveryNotice(): string | null {
  const notice = recoveryNotice;
  recoveryNotice = null;
  return notice;
}
