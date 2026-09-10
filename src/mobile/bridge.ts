/**
 * POC JS 桥（M0/M1）：window.lakeNative 兼容接口的移动端实现。
 * - 数据层：sql.js（WASM 同步 DbLike，见 sqliteDb.ts）+ IndexedDB 快照持久化
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：syncEngine（manifest v4 协议，复用 src/core 决策纯函数）
 * - 范围 = docs/MOBILE-TECH-STACK.md §9.2 的最小 IPC 集（POC 版）
 */
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb";
import { loadSnapshot, saveSnapshot } from "./persistence";
import { saveAssetBytesFs, loadAssetBytesFs, listAssetKeysFs, listNoteAssetKeysFs, removeAssetBytesFs } from "./assetFs";
import { syncNow as runSync, downloadNoteAssets, type SyncConfig, type SyncDbPort, type SyncReport } from "../core/syncEngine.js";
import { buildGcKeepSet } from "../core/gcDecisions.js";
import { parseLakeManifest, objectKey } from "../core/syncUtils.js";
import type { Manifest } from "../core/manifestTypes.js";
import { KeyedAsyncQueue } from "../core/keyedAsyncQueue.js";
import type { QuickNotesSyncResult } from "../core/quickNotesSyncEngine.js";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions.js";
import { createCapacitorS3Store } from "./s3Store";
import { buildAssetFilename, extOf } from "../core/assetNaming.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";
import type { S3Settings, TreeNode } from "../lib/types";
import type { SearchResult } from "../core/searchRepository.js";
import { nextSortOrder } from "../core/treeRules.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { syncQuickNotesViaEngine } from "../core/quickNotesSyncEngine.js";
import { createQuickNotesSyncDbPort } from "./quickNotesDbPort.js";
import { mobileSecretStore } from "./secretStore.js";
import { stageAssetWrites } from "./assetWrites.js";
import { applyMobileSchema } from "./schema.js";
import * as treeRepository from "./treeRepository.js";
import * as noteRepository from "./noteRepository.js";
import type { POCNote, POCNoteSummary } from "./noteRepository.js";
import * as trashRepository from "./trashRepository.js";
import * as quickNotesRepository from "./quickNotesRepository.js";
import { createMobileSyncDbPort } from "./syncDbPort.js";
import * as historyRepository from "./historyRepository.js";
import type { HistoryMobileSettings } from "./historyRepository.js";
import * as orphanAssetRepository from "./orphanAssetRepository.js";
import * as gcRepository from "./gcRepository.js";
import * as diagnosticsRepository from "./diagnosticsRepository.js";
import * as notebookTreeRepository from "./notebookTreeRepository.js";

export type { HistoryMobileSettings } from "./historyRepository.js";

/** 移动端同步结果（P2-5，GPT 审计）：文档/小记分字段，便于 UI 分别展示进度与失败。 */
export interface MobileSyncResult {
  message: string;
  notes: SyncReport | null;
  quickNotes: QuickNotesSyncResult | { error: string } | null;
}

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lake-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
const DEFAULT_S3_PREFIX = "lake-notes";

const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 与桌面一致的初始 Lake 内容（store.ts createNoteInWithContent） */
export const INITIAL_LAKE_CONTENT = `<p class="ne-p"><br></p>`;

let db: SqlJsDb | null = null;
/** 运行期资源缓存（新上传/同步中使用）；持久化资源不在启动时全量载入。key = "{noteId}/{filename}" */
const assets = new Map<string, Uint8Array>();
/** 主维护队列（GPT 审计 P2-6）：同步与本地写操作（保存/删除/恢复）串行化，防交错
 * 覆盖快照/发布旧状态；小记同步与编辑竞态由队列闭合（引擎 markSynced 无"未变才标"守卫时也安全）。 */
const maintenance = new KeyedAsyncQueue();

/** 与桌面一致的随机 8-hex 片段（crypto.randomBytes(4) 的等价物）。 */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
  ico: "image/x-icon", tiff: "image/tiff", tif: "image/tiff",
};
function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function ensureDb(): Promise<SqlJsDb> {
  if (db) return db;
  const snap = await loadSnapshot();
  db = snap ? await SqlJsDb.openFrom(snap) : await SqlJsDb.open();
  await applyMobileSchema(db);
  return db;
}

async function createS3Client(cfg: S3Settings): Promise<import("@aws-sdk/client-s3").S3Client> {
  const [{ S3Client }, { CapacitorHttpHandler }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("./capacitorHttpHandler"),
  ]);
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // 请求分层：HTTP 传输走 Capacitor 原生（OkHttp），绕开 WebView CORS（见 capacitorHttpHandler.ts）
    requestHandler: new CapacitorHttpHandler(),
  });
}

const dbPort: SyncDbPort = createMobileSyncDbPort(() => db!, {
  assets,
  saveAssetFile: saveAssetBytesFs,
  loadAssetFile: loadAssetBytesFs,
  removeAssetFile: removeAssetBytesFs,
  listNoteAssetKeys: listNoteAssetKeysFs,
});

/** 下载这些笔记的已声明资产（best-effort）；失败不阻断调用方（恢复/预览红线）。
 * @param onlyMissing true = 只补本地缺失的资源（预览用）；false = 强拉全量（恢复用） */
async function downloadDeclaredAssetsFor(noteIds: string[], onlyMissing = false): Promise<void> {
  if (noteIds.length === 0) return;
  try {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return;
    const syncCfg: SyncConfig = {
      endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix,
    };
    const s3Store = createCapacitorS3Store(syncCfg);
    const report: SyncReport = {
      pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "",
      warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0,
      trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0,
    };
    for (const noteId of noteIds) {
      let assets = typeof dbPort.listDeclaredAssets === "function" ? await dbPort.listDeclaredAssets(noteId) : [];
      if (onlyMissing && assets.length > 0) {
        const local = new Set((await dbPort.listLocalAssets(noteId)).map((a) => a.filename));
        assets = assets.filter((a) => !local.has(a.filename));
      }
      if (assets.length === 0) continue;
      await downloadNoteAssets(syncCfg, s3Store, dbPort, noteId, assets, report, false);
    }
  } catch (e) {
    console.warn("[asset] 资源下载失败（保留调用方，资源下次同步补拉）", e);
  }
}

async function persistDatabaseSnapshot(): Promise<void> {
  const currentDb = await ensureDb();
  await saveSnapshot(currentDb.exportBytes());
}

async function runMaintenanceAndPersist<T>(operation: () => T | Promise<T>): Promise<T> {
  return maintenance.run("main", async () => {
    const result = await operation();
    await persistDatabaseSnapshot();
    return result;
  });
}

export const bridge = {
  async init(): Promise<void> {
    await ensureDb();
    // 资源显示走 AssetServer（Filesystem 文件直读，无需预加载/迁移）。
  },

  // ---- 目录树 CRUD（Phase 0B：对齐共享 TreeRepository 接口，§20 ports.ts） ----

  async listTreeNodes(): Promise<TreeNode[]> {
    const d = await ensureDb();
    return await treeRepository.listTreeNodes(d);
  },


  /** 笔记本详情（含文档套文档）——实现见模块级 listNotebookTreeImpl（bridge 对象与 lakeNative 契约共用）。 */

  /** 新建 notebook：根层创建，名称必填（trim 校验，共享 treeRules），默认图标不落库（icon 由 setNodeIcon 单独写入）。 */
  async createNotebook(input: { title: string; icon: string | null }): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createNotebook(d, input);
      await saveSnapshot(d.exportBytes());
      return node;
    });
  },

  /** 新建 group：父节点必须存在（且非回收站），名称校验共享 treeRules。 */
  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createGroup(d, parentId, title);
      await saveSnapshot(d.exportBytes());
      return node;
    });
  },

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const node = await treeRepository.renameTreeNode(d, id, title);
      await saveSnapshot(d.exportBytes());
      return node;
    });
  },

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const node = await treeRepository.setNodeIcon(d, id, icon);
      await saveSnapshot(d.exportBytes());
      return node;
    });
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const node = await treeRepository.moveTreeNodeOrdered(d, id, parentId, orderedIds);
      await saveSnapshot(d.exportBytes());
      return node;
    });
  },

  /** 同级重排（自定义排序）：单事务更新 sort_order，不改父节点。对齐桌面 reorderTreeNodes。 */
  async reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await treeRepository.reorderSiblings(d, parentId, orderedIds);
      await saveSnapshot(d.exportBytes());
    });
  },

  async listNotes(): Promise<POCNoteSummary[]> {
    const d = await ensureDb();
    return await noteRepository.listNotes(d);
  },

  async readNote(id: string): Promise<POCNote | null> {
    const d = await ensureDb();
    return await noteRepository.readNote(d, id);
  },

  /** 打开文档前的"是否已消失"判定原料（AGENTS §3 #16：所有打开入口都要判，判定逻辑用共享纯函数 isGoneNote）。 */
  async noteGoneState(id: string): Promise<{ parentId: string | null; syncState: string } | null> {
    const d = await ensureDb();
    return await noteRepository.noteGoneState(d, id);
  },

  /** Phase 0B-5：搜索 fallback（sql.js 无 FTS5 → LIKE；标题+正文，参数化 + ESCAPE）。 */
  async searchNotes(query: string): Promise<SearchResult[]> {
    const d = await ensureDb();
    return await noteRepository.searchNotes(d, query);
  },

  // ---- 小记（Phase B3：本地 CRUD + 列表；同步后置，依赖 quick-notes/ 子空间端口化） ----

  async listQuickNotes(): Promise<Array<{ id: string; previewText: string; imageCount: number; updatedAt: string; firstImage: string | null }>> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNotes(d);
  },

  async readQuickNote(id: string): Promise<{ id: string; content: StoredQuickNoteContent; previewText: string; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNote(d, id);
  },

  async saveQuickNote(id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, images);
      await saveSnapshot(d.exportBytes());
      return result;
    });
  },

  /** 带图片字节保存小记（composer 用）：图片字节落盘为文件（canonical URL 由本地 AssetServer 服务），
   * 与桌面端小记完全一致——纯文件存储，完全不用 BLOB。文件名用 buildAssetFilename 唯一化（同文件多次添加不覆盖）。
   * 全量替换本小记图片（编辑时传已有图片字节 + 新增字节；简单一致，不引入 staged/retained 两段式）。 */
  async saveQuickNoteWithImages(id: string, text: string, imageFiles: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }> = []): Promise<string> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNoteWithImages(d, id, text, imageFiles, {
        assets,
        saveAssetFile: saveAssetBytesFs,
      });
      await saveSnapshot(d.exportBytes());
      return result;
    });
  },

  async createQuickNote(text: string): Promise<string> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const id = crypto.randomUUID();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, []);
      await saveSnapshot(d.exportBytes());
      return result;
    });
  },

  /** 本地删除小记：软删（保留 content 供墓碑携带），同步时上传墓碑跨端传播删除。 */
  async deleteQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await quickNotesRepository.deleteQuickNote(d, id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 小记图片字节读取（composer/卡片显示用；缺失 → null）。纯文件为准（无 BLOB）。 */
  async getQuickNoteImage(id: string, filename: string): Promise<Uint8Array | null> {
    return loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  },

  /** 小记回收站列表（软删行；含冲突归档的 ready_to_sync=0 条目——它们也是可恢复的本地内容）。 */
  async listQuickNoteTrash(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; previewText: string }>> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNoteTrash(d);
  },

  /** 小记恢复（回收站 → active）：restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await quickNotesRepository.restoreQuickNote(d, id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 小记彻底删除（回收站 → 不可恢复）：删行 + 删图片；保留墓碑记录（同步继续传播删除，正文已删 → 占位符 hash）。 */
  async purgeQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await quickNotesRepository.purgeQuickNote(d, id, removeAssetBytesFs);
      await saveSnapshot(d.exportBytes());
    });
  },

  async saveNote(id: string, title: string, content: string, parentId: string | null = null): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const changed = await noteRepository.saveNote(d, id, title, content, parentId, assets);
      if (changed) await saveSnapshot(d.exportBytes());
    });
  },

  /** 列出某文档的历史快照（纯本地；冲突留档/手动快照）。 */
  async listNoteHistory(noteId: string): Promise<Array<{ id: number; title: string; createdAt: string }>> {
    const d = await ensureDb();
    return await historyRepository.listNoteHistory(new SqlJsAsyncDb(d), noteId);
  },

  /** 恢复历史快照：对齐桌面端——先给当前正文留档（可反悔），再把快照正文+标题写回（sync_state=local → 下轮同步上传覆盖远端）。 */
  async restoreHistory(historyId: number): Promise<void> {
    const d = await ensureDb();
    const mobileDb = new SqlJsAsyncDb(d);
    const snapshot = await historyRepository.readHistory(mobileDb, historyId);
    if (!snapshot) return;
    await historyRepository.backupCurrentNote(mobileDb, snapshot.noteId);
    await bridge.saveNote(snapshot.noteId, snapshot.title, snapshot.content);
  },

  /** 手动删除单个历史快照（对齐桌面 deleteHistory）。 */
  async deleteHistory(historyId: number): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await historyRepository.deleteHistory(new SqlJsAsyncDb(d), historyId);
    });
  },

  /** 读取历史快照设置（对齐桌面 getHistorySettings；存 device_state，纯本地）。 */
  async getHistorySettings(): Promise<HistoryMobileSettings> {
    const d = await ensureDb();
    return await historyRepository.getHistorySettings(new SqlJsAsyncDb(d));
  },

  /** 保存历史快照设置（对齐桌面 saveHistorySettings）。 */
  async saveHistorySettings(settings: HistoryMobileSettings): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await historyRepository.saveHistorySettings(new SqlJsAsyncDb(d), settings);
    });
  },

  /** 给某笔记创建快照（定时自动快照用；读当前正文，24h 去重）。 */
  async snapshotNote(noteId: string): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await historyRepository.snapshotNote(new SqlJsAsyncDb(d), noteId);
    });
  },

  /** 历史快照清理（对齐桌面 cleanupHistory：分层保留 + 上限 + 保留天数，设置可配置）。 */
  async cleanupHistory(): Promise<{ deleted: number }> {
    return runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      const mobileDb = new SqlJsAsyncDb(d);
      return await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
    });
  },

  /** 全局孤儿资源列表（对齐桌面 listOrphanAssets）。 */
  async listOrphanAssets(): Promise<Array<{ id: number; noteId: string; filename: string; size: number; mimeType: string; detectedAt: string }>> {
    const d = await ensureDb();
    return await orphanAssetRepository.listOrphanAssets(new SqlJsAsyncDb(d));
  },

  /** 删除单个孤儿资源（本地文件 + 登记）。 */
  async deleteOrphanAsset(id: number): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await orphanAssetRepository.deleteOrphanAsset(new SqlJsAsyncDb(d), id, {
        assets,
        removeAssetFile: removeAssetBytesFs,
      });
    });
  },

  /** 清理全部孤儿资源（本地文件 + 登记）。 */
  async cleanOrphanAssets(): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await orphanAssetRepository.cleanOrphanAssets(new SqlJsAsyncDb(d), {
        assets,
        removeAssetFile: removeAssetBytesFs,
      });
    });
  },

  /** GC：登记待回收键（新 manifest 不再引用，对齐桌面 addS3GcPending）。 */
  async addS3GcPending(key: string): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await gcRepository.addS3GcPending(new SqlJsAsyncDb(d), key);
    });
  },

  /** GC：从待回收表移除已被重新引用的键。 */
  async removeS3GcPending(keys: string[]): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await gcRepository.removeS3GcPending(new SqlJsAsyncDb(d), keys);
    });
  },

  /** GC：列出全部待回收键。 */
  async listS3GcPending(): Promise<Array<{ key: string; markedAt: string }>> {
    const d = await ensureDb();
    return await gcRepository.listS3GcPending(new SqlJsAsyncDb(d));
  },

  /** GC：记录删除（对齐桌面 recordS3GcLog）。 */
  async recordS3GcLog(action: string, key: string, reason: string, ok: boolean): Promise<void> {
    await runMaintenanceAndPersist(async () => {
      const d = await ensureDb();
      await gcRepository.recordS3GcLog(new SqlJsAsyncDb(d), action, key, reason, ok);
    });
  },

  async createNote(title: string, parentId: string | null = null): Promise<POCNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // 无父新建 → 兜底父笔记本（存在的笔记本；无则自动创建"未分类"）
    const pid = parentId ?? await dbPort.defaultNotebookId();
    await bridge.saveNote(id, title, INITIAL_LAKE_CONTENT, pid);
    return { id, title, content: INITIAL_LAKE_CONTENT, updatedAt: now, parentId: pid };
  },

  /** 本地软删（入回收站）：同步时上传墓碑（删除压编辑） */
  async trashNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await noteRepository.trashNote(d, id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 回收站预览：按需补拉该笔记本地缺失的资源（不恢复、不移出回收站）。best-effort。 */
  async ensureTrashNoteAssets(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      await downloadDeclaredAssetsFor([id], true);
    });
  },

  /** 本地恢复单条笔记：restore_pending_at → 同步时 local-wins 上传 active 覆盖墓碑。
   * 与 restoreTreeItem(id, "note") 完全等价（同一实现）；回收站 UI 统一走 restoreTreeItem，
   * 本方法仅供 lakeNative 调试契约使用，避免两套恢复入口语义分叉。 */
  async restoreNote(id: string): Promise<void> {
    return bridge.restoreTreeItem(id, "note");
  },

  /** 回收站列表 */
  async listTrashed(): Promise<POCNote[]> {
    const d = await ensureDb();
    return await noteRepository.listTrashed(d);
  },

  /** 软删除（入回收站）：folder = 整棵子树（含深层 folders + 子树 notes）标 trashed_at；note = 单条。
   * 与桌面 deleteTreeNode 同语义（删除 = 移入回收站，回收站条目是普通条目，移动即同步传播）：
   * 移动端无 notebook-trash 容器行，用 trashed_at 标记 + listFoldersForSync 输出 trashedAt 传播；
   * parent_id 不变（恢复即原地清 trashed_at，对齐 restoreTreeItem）。
   * 仅提供 API（lakeNative 契约/未来 UI 用），当前移动端 UI 未接入删除笔记本入口。 */
  async trashTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await trashRepository.trashTreeItem(d, id, kind);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** B2：统一回收站树（folders 笔记本/分组 + notes 文档）。复用桌面 TrashPanel 语义：仅根节点可恢复（整棵连带），任意节点可彻底删除。 */
  async listTrashTree(): Promise<Array<{ id: string; title: string; kind: "folder" | "note"; parentId: string | null; deletedAt: string | null }>> {
    const d = await ensureDb();
    return await trashRepository.listTrashTree(d);
  },

  /** B2：恢复回收站项。folder = 恢复整棵（含深层子树）；note = 文档级恢复。恢复标记 restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await trashRepository.restoreTreeItem(d, id, kind, downloadDeclaredAssetsFor);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** B2：彻底删除回收站项（purge）。folder = 子树全部 purge；note = 单条 purge（同步发墓碑）。
   * 对齐桌面 purgeTrashItem：物理删除行 + 写 deleted_notes 墓碑（purged_at + node_type）。
   * 墓碑经 syncEngine 发布 deleted:true 传播到其他端（否则仅从 manifest 移除 → 其他端保留 active 副本，删除不传播）；
   * folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
   * 与收到他端 purge（applyRemotePurge：行保留标 purged、可恢复）语义不同：本地主动 purge 不可恢复。 */
  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      await trashRepository.purgeTreeItem(d, id, kind);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 导出当前库快照字节（S3 通路验证 + 后续同步协议用） */
  async exportSnapshotBytes(): Promise<Uint8Array> {
    const d = await ensureDb();
    return d.exportBytes();
  },

  // ---- S3（POC 通路验证） ----

  async getS3Settings(): Promise<S3Settings | null> {
    try {
      const raw = localStorage.getItem(S3_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<S3Settings>;
      // §17.5/§22.3：secret 不落 localStorage 明文——从 secretStore（WebCrypto 加密 IndexedDB）读取；
      // 旧版本明文 secret 在 saveS3Settings 时已迁移，此处兜底兼容（读到则加密回存并清明文）。
      let secret = parsed.secretAccessKey ?? "";
      const stored = await mobileSecretStore.read("s3.secretAccessKey");
      if (stored !== null) secret = stored;
      else if (secret) {
        await mobileSecretStore.write("s3.secretAccessKey", secret);
        delete parsed.secretAccessKey;
        localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(parsed));
      }
      return { ...parsed, prefix: parsed.prefix ?? DEFAULT_S3_PREFIX, secretAccessKey: secret } as S3Settings;
    } catch {
      return null;
    }
  },

  async saveS3Settings(cfg: S3Settings): Promise<void> {
    // P2-8（GPT 审计）：secret 加密存储失败必须让保存整体失败（否则 UI 显示已保存但同步密钥缺失）
    await mobileSecretStore.write("s3.secretAccessKey", cfg.secretAccessKey);
    const { secretAccessKey: _s, ...rest } = cfg;
    localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(rest));
  },

  /** 七牛验证必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404，AGENTS.md 踩坑 #4） */
  async testS3Connection(): Promise<string> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return "未配置 S3";
    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = await createS3Client(cfg);
      const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }));
      return `OK（对象数 ≥ ${out.KeyCount ?? 0}）`;
    } catch (e) {
      return `FAIL: ${(e as Error).message}`;
    }
  },

  async uploadObject(key: string, body: Uint8Array | string): Promise<string> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) throw new Error("S3 未配置");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await createS3Client(cfg);
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body }));
    return key;
  },

  /** D8+：图片/附件上传（Lake 编辑器粘贴/插入调用）。本地落盘 + 返回 canonical URL（本地 AssetServer 服务）。
   * 附件（非图片）同样走本路径：任意字节落盘 + 保留原扩展名（与桌面 assetNaming 命名一致）。 */
  async uploadResource(
    input: { bytes: Uint8Array; filename: string },
    noteId: string
  ): Promise<{ url: string; resourceRef: string; filename: string; mimeType: string; size: number }> {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes as unknown as ArrayLike<number>);
    // 与桌面一致的资产文件名（共享 buildAssetFilename：{13ts}_{8hex}.{ext}，extractAssetRefs 正则匹配）
    const name = buildAssetFilename(input.filename);
    // 本地存储（内存 + Filesystem 持久化，AssetServer 读取显示）
    // P1-8（GPT 审计）：必须等待 Filesystem 落盘成功再返回，否则"正文保存成功但图片重启后丢失"
    const key = noteId + "/" + name;
    assets.set(key, bytes);
    try {
      await saveAssetBytesFs(key, bytes);
    } catch (e) {
      assets.delete(key);
      throw new Error("图片落盘失败: " + (e as Error).message);
    }
    const mimeType = mimeForExt(extOf(name));
    const url = localAssetHttpUrl(noteId, name);
    // filename 字段 = 原始文件名（Lake file 卡片展示名；磁盘名/同步用 URL 里的生成名，与桌面一致）
    const displayName = input.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "附件";
    return { url, resourceRef: url, filename: displayName, mimeType, size: bytes.length };
  },

  /** 云端 GC（对齐桌面 runDeepCleanup）：删「未被 latest/prev 链清单/历史快照引用 ∧ 双锚窗口（创建 + 待回收标记）已过」的 objects/assets。 */
  async gcDeepCleanup(): Promise<{ candidateCount: number; deletedCount: number; keys: string[] }> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return { candidateCount: 0, deletedCount: 0, keys: [] };
    const syncCfg: SyncConfig = { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix };
    const s3Store = createCapacitorS3Store(syncCfg);
    if (!s3Store.listObjects || !s3Store.deleteMany) return { candidateCount: 0, deletedCount: 0, keys: [] };
    const latestBytes = await s3Store.getObject(`${syncCfg.prefix}/manifests/latest.json`, { maxBytes: 20 * 1024 * 1024 });
    if (!latestBytes) return { candidateCount: 0, deletedCount: 0, keys: [] }; // 无清单 → 不 GC（安全）
    let manifest;
    try { manifest = parseLakeManifest(latestBytes); } catch { return { candidateCount: 0, deletedCount: 0, keys: [] }; } // 清单损坏 → 不 GC
    // prev 链引用保护（最多 3 层，对齐桌面 MANIFEST_CHAIN_KEEP）
    const prevManifests: Manifest[] = [];
    let prev = manifest.prevCommitId;
    let chain = 0;
    while (prev && chain < 3) {
      const pb = await s3Store.getObject(`${syncCfg.prefix}/manifests/${prev}.json`, { maxBytes: 20 * 1024 * 1024 });
      if (!pb) break;
      try { const pm = parseLakeManifest(pb); prevManifests.push(pm); prev = pm.prevCommitId; } catch { break; }
      chain += 1;
    }
    const d = await ensureDb();
    const mobileDb = new SqlJsAsyncDb(d);
    const keep = buildGcKeepSet({
      manifest,
      extraManifests: prevManifests,
      prefix: syncCfg.prefix,
      historyRefs: await historyRepository.historyAssetRefs(mobileDb),
    });
    const pendingByKey = new Map((await bridge.listS3GcPending()).map((p) => [p.key, p.markedAt] as const));
    const all = [...(await s3Store.listObjects(`${syncCfg.prefix}/objects/`)), ...(await s3Store.listObjects(`${syncCfg.prefix}/assets/`))];
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000; // 7 天窗口
    const toDelete: string[] = [];
    for (const o of all) {
      if (keep.has(o.key)) continue;
      if (new Date(o.lastModified).getTime() > cutoff) continue; // 创建不足窗口 → 保护
      const marked = pendingByKey.get(o.key);
      if (marked && new Date(marked).getTime() > cutoff) continue; // 本机待回收标记但窗口未过 → 保护
      toDelete.push(o.key);
    }
    const keys = toDelete;
    const deletedCount = keys.length ? await s3Store.deleteMany(keys) : 0;
    if (keys.length > 0) {
      await runMaintenanceAndPersist(async () => {
        const mobileDb = new SqlJsAsyncDb(d);
        for (const key of keys) await gcRepository.recordS3GcLog(mobileDb, "delete", key, "deep-clean", true);
      });
    }
    return { candidateCount: all.length, deletedCount, keys };
  },

  /** 运行诊断（移动端"日志查看/关于"等价）：存储统计。 */
  async getDiagnostics(): Promise<diagnosticsRepository.MobileDiagnostics> {
    const d = await ensureDb();
    const mobileDb = new SqlJsAsyncDb(d);
    return diagnosticsRepository.getDiagnostics(mobileDb, {
      listAssetKeys: listAssetKeysFs,
      getDatabaseSizeBytes: () => mobileDb.databaseSizeBytes(),
    });
  },

  /** M1 同步：manifest v4 协议（拉取对账 + 上传发布）+ 小记 quick-notes/ 子空间同步，复用 src/core 引擎。
   * P2-5/6（GPT 审计）：结构化返回（notes/quickNotes 分字段）；主维护队列串行化防与本地写操作交错。 */
  async syncNow(): Promise<MobileSyncResult> {
    return maintenance.run("main", async () => {
      const cfg = await bridge.getS3Settings();
      if (!cfg) return { message: "未配置 S3", notes: null, quickNotes: null };
      const d = await ensureDb();
      const syncCfg: SyncConfig = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        bucket: cfg.bucket,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        prefix: cfg.prefix,
      };
      const s3Store = createCapacitorS3Store(syncCfg);
      const mobileDb = new SqlJsAsyncDb(d);
      try {
        const report = await runSync(syncCfg, s3Store, dbPort, {
          onPublished: async (next, prev) => {
            // GC 差集标记（对齐桌面 syncEngineController.onPublished）：新 manifest 不再引用的旧正文/资源 → 待回收。用 full key（含 prefix）与 gcDeepCleanup 一致。
            try {
              const newById = new Map(next.notes.map((n) => [n.id, n]));
              for (const p of prev?.notes ?? []) {
                if (p.deleted) continue;
                const nx = newById.get(p.id);
                if (!nx || nx.deleted) continue;
                if (nx.contentHash !== p.contentHash) await gcRepository.addS3GcPending(mobileDb, `${syncCfg.prefix}/${objectKey(p.id, p.contentHash)}`);
                const nextAssets = new Set((nx.assets ?? []).map((a) => a.filename));
                for (const asset of p.assets ?? []) {
                  if (nextAssets.has(asset.filename)) continue;
                  await gcRepository.addS3GcPending(mobileDb, `${syncCfg.prefix}/assets/${p.id}/${asset.filename}`);
                }
              }
              const referencedNow = new Set<string>();
              for (const note of next.notes) {
                if (note.deleted) continue;
                referencedNow.add(`${syncCfg.prefix}/${objectKey(note.id, note.contentHash)}`);
                for (const asset of note.assets ?? []) referencedNow.add(`${syncCfg.prefix}/assets/${note.id}/${asset.filename}`);
              }
              await gcRepository.removeS3GcPending(mobileDb, [...referencedNow]);
            } catch { /* 不影响同步 */ }
          },
        });
        // 小记独立子空间同步（quick-notes/ 前缀，同一 S3 配置；墓碑/恢复/冲突语义与桌面一致）。
        // 失败不拖垮笔记同步（对齐桌面 main.ts：quickNotes 错误单独上报）。
        let quickNotes: QuickNotesSyncResult | { error: string };
        let quickMsg = "；小记已同步";
        try {
          quickNotes = await syncQuickNotesViaEngine(syncCfg, s3Store, createQuickNotesSyncDbPort(d, {
            assetBytes: assets,
            saveAssetFile: saveAssetBytesFs,
            loadAssetFile: loadAssetBytesFs,
            removeAssetFile: removeAssetBytesFs,
          }));
          if (quickNotes.uploaded + quickNotes.downloaded > 0) {
            quickMsg = `；小记 ↓${quickNotes.downloaded} ↑${quickNotes.uploaded}`;
          }
        } catch (reason) {
          quickNotes = { error: (reason as Error).message };
          quickMsg = `；小记同步失败：${quickNotes.error}`;
        }
        // 清理可能部分成功；即便失败也要把当前内存库落盘，避免下一次启动回退到旧状态。
        try {
          const mobileDb = new SqlJsAsyncDb(d);
          await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
        } catch {
          // 清理失败不拖垮同步；下一次同步会继续按策略清理。
        }
        return { message: report.message + quickMsg, notes: report, quickNotes };
      } finally {
        // 同步中途失败时，已应用的远端变更也必须持久化，不能只在成功路径保存。
        await saveSnapshot(d.exportBytes());
      }
    });
  },
  // ---- 目录树只读契约（同步调试/测试用） ----
  async listNotebookTree(notebookId: string): Promise<notebookTreeRepository.NotebookTreeItem[]> {
    const d = await ensureDb();
    return await notebookTreeRepository.listNotebookTree(d, notebookId);
  },
  // ---- 墓碑只读契约（同步调试/测试用；生产同步路径直接走 dbPort，不经此对象） ----
  async listDeletedNotesForSync() { return dbPort.listDeletedNotesForSync!(); },
  readDeletedContent(id: string) { return dbPort.readDeletedContent!(id); },
  async markTombstonesPublished(ids: string[]) { await dbPort.markTombstonesPublished!(ids); },
  async isFolderPurged(id: string): Promise<boolean> { return dbPort.isFolderPurged!(id); },
};
