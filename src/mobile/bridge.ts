/**
 * 移动端运行时桥：实现 window.lakeNative 契约（对齐桌面 preload 的 IPC 语义），
 * 数据层与同步编排都在这里接线；同步决策不在本文件，一律复用 src/core 的纯函数。
 *
 * - 数据层：Android 原生 SQLite（WAL，见 nativeSqliteDb.ts）
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：共享 src/core/syncEngine（**Lake Manifest V1**，260928 协议重置）
 * - 互斥域：写域 / 维护域分离，判据见 src/core/maintenancePolicy.ts（F16）
 * - 结构：docs/MOBILE-TECH-STACK.md；跨端能力矩阵见该文档
 */
import { NativeSqliteDb } from "./nativeSqliteDb";
import { writeLocalStorage } from "../lib/localStorageSafe";
import { migrateSnapshotToNativeSqlite } from "./nativeSqliteMigration";
import { saveAssetBytesFs, loadAssetBytesFs, listAssetKeysFs, listNoteAssetKeysFs, removeAssetBytesFs, bytesToBase64 } from "./assetFs";
import { isSafeShellOpenFilename } from "../core/assetNaming.js";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { registerPlugin } from "@capacitor/core";
import { scanAssetCards, fileKindOf } from "../core/fileCard.js";
import { lakeHtmlToPlain } from "../core/lakeCaches.js";
import { syncNow as runSync, downloadNoteAssets, type SyncConfig, type SyncDbPort, type SyncReport } from "../core/syncEngine.js";
import { buildGcKeepSet } from "../core/gcDecisions.js";
import { parseLakeManifest, objectKey } from "../core/syncUtils.js";
import type { Manifest } from "../core/manifestTypes.js";
import { classifyOp, type MaintenanceOp, type PriorityOp, type WriteOp } from "../core/maintenancePolicy.js";
import { maintenanceQueue, priorityQueue, writeLock } from "./maintenanceLocks";
import type { QuickNotesSyncResult } from "../core/quickNotesSyncEngine.js";
import { emptyLakeBody } from "../core/lakeDocForm.js";
import { createCapacitorS3Store } from "./s3Store";
import { CapacitorHttpHandler } from "./capacitorHttpHandler";
import { buildAssetFilename, mimeTypeForFilename } from "../core/assetNaming.js";
import { readImageDimensions, sniffImageFormat } from "../core/imageUtils.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../core/storeLimits.js";
import type { S3Settings, SyncSettings, TreeNode } from "../lib/types";
import { canTouchNetwork, cloudStateHint, cloudStateOf, type CloudState } from "../core/cloudState.js";
import type { SearchResult } from "../core/searchTypes.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { syncQuickNotesViaEngine } from "../core/quickNotesSyncEngine.js";
import { pushQuickNote, type QuickNotePushOutcome } from "../core/quickNotePush.js";
import { createQuickNotesSyncDbPort } from "./quickNotesDbPort.js";
import { mobileSecretStore } from "./secretStore.js";
import { writeSyncStatus } from "./syncStatusStore";

/** 系统默认应用打开本地文件（与 DocumentEditor 同插件）。 */
const OpenFile = registerPlugin<{
  open: (opts: { path: string }) => Promise<void>;
  saveAs: (opts: { path: string; name: string; mime?: string }) => Promise<void>;
}>("OpenFile");
import { applyMobileSchema } from "./schema.js";
import * as treeRepository from "./treeRepository.js";
import * as noteRepository from "./noteRepository.js";
import { indexNote, reconcileIndex } from "./searchIndex.js";
import type { LocalNote, LocalNoteSummary } from "./noteRepository.js";
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
  /** 同步收尾对账搜索索引的耗时（ms）；移动端性能专项观测用。 */
  indexMs?: number;
}

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lake-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
const DEFAULT_S3_PREFIX = "lake-notes";

const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 云同步开关 / 自动同步节奏（与桌面 SyncSettings 同形）。关闭 = 纯离线本地空间（用户 261006 定稿）。 */
const SYNC_STORAGE_KEY = "lake-notes-mobile.sync";
const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };

function readSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      enabled: parsed.enabled !== false,
      autoMode: parsed.autoMode === "interval" || parsed.autoMode === "onOpenClose" ? parsed.autoMode : "manual",
      autoIntervalMinutes: typeof parsed.autoIntervalMinutes === "number" ? parsed.autoIntervalMinutes : 15,
    };
  } catch {
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

/** 云端状态（单一判据，与桌面同源 src/core/cloudState）：没配置 或 关闭云同步 ⇒ 一律不出网。 */
async function mobileCloudState(): Promise<CloudState> {
  const cfg = await bridge.getS3Settings();
  return cloudStateOf(Boolean(cfg), readSyncSettings());
}
/* 初始 Lake 正文与桌面同一来源：src/core/lakeDocForm.ts（勿在此手拼正文）。 */

let db: NativeSqliteDb | null = null;
let dbInitialization: Promise<NativeSqliteDb> | null = null;
/** 运行期资源缓存（新上传/同步中使用）；持久化资源不在启动时全量载入。key = "{noteId}/{filename}" */
const assets = new Map<string, Uint8Array>();
/**
 * 互斥域（判据单一来源：src/core/maintenancePolicy.ts —— F16 的红线化）。
 *
 * 旧实现把「整轮同步（含全部网络往返）」与「所有本地写」塞进**同一条** key 固定为 "main" 的队列，
 * 于是弱网下用户保存要等整轮同步（实测 152.0s；基线写 32ms）。现按判据分两条：
 *  - 写域 writeLock：本地写（saveNote / 目录 / 小记 / 历史 / 回收站 / GC 账本）——**不被网络阻塞**；
 *  - 维护域 maintenanceQueue：轮次级网络与维护（syncNow / gcDeepCleanup / ensureTrashNoteAssets）——彼此串行。
 *
 * I3：两条队列都无重入 ⇒ **禁止同域嵌套**（由 src/mobile/maintenancePolicyCoverage.test.ts 静态卡住）。
 * I2：跨网络窗口的「读 → 标记已同步」靠"未变才标"守卫，不靠全局互斥
 *     （Lake 侧既有 markSyncedIfUnchanged；小记侧守卫见 quickNotesSyncEngine）。
 */
// 两个域的实际实例见 ./maintenanceLocks（同步侧的 DB 片段短锁也取同一实例）。

function assertResourceBytes(bytes: Uint8Array): void {
  if (sniffImageFormat(bytes) != null) {
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("图片为空或超过 25 MiB");
    }
    const dimensions = readImageDimensions(bytes);
    if (dimensions && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
      throw new Error(`图片尺寸过大（${dimensions.width}x${dimensions.height}），上限 ${MAX_IMAGE_PIXELS} 像素`);
    }
    return;
  }
  if (bytes.length === 0) throw new Error("附件为空");
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 协议上限`);
  }
}

async function initializeDb(): Promise<NativeSqliteDb> {
  const migration = await migrateSnapshotToNativeSqlite();
  const openedDb = await NativeSqliteDb.open(migration.databaseName);
  await applyMobileSchema(openedDb);
  db = openedDb;
  // 搜索索引对账：首次建索引 / 修复跨会话漂移（失败不阻断启动）。
  try { await reconcileIndex(openedDb); } catch (error) { console.warn("[search] reconcile failed:", error); }
  return openedDb;
}

async function ensureDb(): Promise<NativeSqliteDb> {
  if (db) return db;
  dbInitialization ??= initializeDb().catch((error: unknown) => {
    dbInitialization = null;
    throw error;
  });
  return dbInitialization;
}

/** S3 配置齐全性检查（261009）：密钥缺失时给**可执行**的提示。
 *  背景：移动端 SecretStore 曾用 IndexedDB（重启即丢，见 secretStore.ts 头注释），密钥读回为空时
 *  请求会用空密钥签名，用户看到的是 "The request signature we calculated does not match..." 这种无从下手的报错。
 *  放在这里（所有 S3 客户端的唯一入口）⇒ 同步 / 测连通 / 上传三条路径统一受益。 */
function assertS3Credentials(cfg: S3Settings): void {
  if (!cfg.bucket) throw new Error("S3 未配置 Bucket：请到「设置 → 同步设置」填写并保存");
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 密钥缺失（本机未保存或已被清除）：请到「设置 → 同步设置」重新填写 Access Key / Secret Key");
  }
}

async function createS3Client(cfg: S3Settings): Promise<import("@aws-sdk/client-s3").S3Client> {
  assertS3Credentials(cfg);
  // @aws-sdk/client-s3 保持动态（懒加载）；CapacitorHttpHandler 已是静态依赖（s3Store.ts 也静态用），
  // 这里再动态 import 只会触发 INEFFECTIVE_DYNAMIC_IMPORT，故提到模块顶部静态引入。
  const { S3Client } = await import("@aws-sdk/client-s3");
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
    // 单一判据：没配置 或 关闭云同步 ⇒ **一个请求都不发**（用户 261006：关闭云同步 = 离线本地空间）
    const state = await mobileCloudState();
    if (!canTouchNetwork(state)) { console.info(`[asset] 跳过补拉（${state}）`); return; }
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

/** 判据校验：调用点声明的类别必须与 src/core/maintenancePolicy.ts 的表一致（写错当场抛，不静默降级）。 */
function assertOpClass(op: string, expected: "write" | "maintenance" | "priority"): void {
  const actual = classifyOp(op);
  if (actual !== expected) {
    throw new Error("桥操作 " + op + " 被判据登记为 " + actual + "，但这里按 " + expected + " 入队（改其一必须同时改另一处）");
  }
}

/** 入**写域**：本地写。可与网络阶段并行，同域内串行。 */
function runWrite<T>(op: WriteOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "write");
  return writeLock.run("write", async () => await operation());
}

/** 入**维护域**：轮次级网络/维护操作。禁止在其中持有写域（I1）。 */
function runMaintenance<T>(op: MaintenanceOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "maintenance");
  return maintenanceQueue.run("maintenance", async () => await operation());
}

/**
 * 入**高优先域**：用户当场发起、且必须不等整轮同步的操作（判据 PRIORITY_OPS）。
 * 与维护域是两条独立队列 ⇒ 长按小记「保存并同步」不会被在途的整轮同步堵住（用户 261013 点单）。
 */
function runPriority<T>(op: PriorityOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "priority");
  return priorityQueue.run("priority", async () => await operation());
}

/** 单条推送的一次尝试（高优先域与"推送后回核"共用；云状态判据在调用方）。 */
async function pushSingleQuickNote(id: string): Promise<QuickNotePushOutcome> {
  const cfg = await bridge.getS3Settings();
  if (!cfg) throw new Error("未配置 S3");
  try { assertS3Credentials(cfg); } catch (e) { throw new Error((e as Error).message); }
  const d = await ensureDb();
  const syncCfg: SyncConfig = {
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    prefix: cfg.prefix,
  };
  return await pushQuickNote(syncCfg, createCapacitorS3Store(syncCfg), createQuickNotesSyncDbPort(d, {
    assetBytes: assets,
    saveAssetFile: saveAssetBytesFs,
    loadAssetFile: loadAssetBytesFs,
    removeAssetFile: removeAssetBytesFs,
  }), id);
}

/**
 * 推送后回核（幂等；排**维护域队尾** ⇒ 任何在途/排队的整轮同步跑完之后才轮到它）：
 * 整轮同步若在"读到本地清单快照"之后才被我们插进来写清单，它落地时会把这一条覆盖掉；
 * 回核就是把那一条补回来（`pushQuickNote` 在远端缺该条时会重传，不缺则只读一次清单）。
 * 失败静默：下轮整轮同步仍会自愈（远端缺条目 ⇒ decideUpload 走 upload）。
 */
function scheduleQuickNoteVerify(id: string): void {
  void maintenanceQueue.run("maintenance", async () => {
    try {
      if ((await mobileCloudState()) === "offline") return;
      await pushSingleQuickNote(id);
    } catch { /* 安全网失败：交给下轮整轮同步自愈 */ }
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
    return runWrite("createNotebook", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createNotebook(d, input);
      return node;
    });
  },

  /** 新建 group：父节点必须存在（且非回收站），名称校验共享 treeRules。 */
  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return runWrite("createGroup", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createGroup(d, parentId, title);
      return node;
    });
  },

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return runWrite("renameTreeNode", async () => {
      const d = await ensureDb();
      const node = await treeRepository.renameTreeNode(d, id, title);
      // 重命名即时更新搜索索引（folder 重命名时 indexNote 找不到 notes 行，自动 no-op）。
      await indexNote(d, id);
      return node;
    });
  },

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return runWrite("setNodeIcon", async () => {
      const d = await ensureDb();
      const node = await treeRepository.setNodeIcon(d, id, icon);
      return node;
    });
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return runWrite("moveTreeNodeOrdered", async () => {
      const d = await ensureDb();
      const node = await treeRepository.moveTreeNodeOrdered(d, id, parentId, orderedIds);
      return node;
    });
  },

  /** 同级重排（自定义排序）：单事务更新 sort_order，不改父节点。对齐桌面 reorderTreeNodes。 */
  async reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<void> {
    return runWrite("reorderSiblings", async () => {
      const d = await ensureDb();
      await treeRepository.reorderSiblings(d, parentId, orderedIds);
    });
  },

  async listNotes(): Promise<LocalNoteSummary[]> {
    const d = await ensureDb();
    return await noteRepository.listNotes(d);
  },

  async readNote(id: string): Promise<LocalNote | null> {
    const d = await ensureDb();
    return await noteRepository.readNote(d, id);
  },

  /** 打开文档前的"是否已消失"判定原料（AGENTS §3 #16：所有打开入口都要判，判定逻辑用共享纯函数 isGoneNote）。 */
  async noteGoneState(id: string): Promise<{ parentId: string | null; syncState: string } | null> {
    const d = await ensureDb();
    return await noteRepository.noteGoneState(d, id);
  },

  /** Phase 0B-5：搜索 fallback（LIKE；标题+正文，参数化 + ESCAPE，不依赖 FTS5）。 */
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
    return runWrite("saveQuickNote", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, images);
      return result;
    });
  },

  /** 带图片字节保存小记（composer 用）：图片字节落盘为文件（canonical URL 由本地 AssetServer 服务），
   * 与桌面端小记完全一致——纯文件存储，完全不用 BLOB。文件名用 buildAssetFilename 唯一化（同文件多次添加不覆盖）。
   * 全量替换本小记图片（编辑时传已有图片字节 + 新增字节；简单一致，不引入 staged/retained 两段式）。 */
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

  /** 闪念速记未提交草稿（纯本地 device_state，不进 S3）：进程被杀后能恢复。 */
  async getQuickNoteDraft(): Promise<{ id: string; text: string; body?: string; images: StoredQuickNoteImage[]; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNoteDraft(d);
  },

  /** 写草稿（写作者已在输入侧做防抖，这里只落库；图片一加入就已落盘，这里只记引用）。 */
  async saveQuickNoteDraft(draft: { id: string; text: string; body?: string; images?: StoredQuickNoteImage[] }): Promise<void> {
    return runWrite("saveQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.writeQuickNoteDraft(d, { id: draft.id, text: draft.text, body: draft.body, images: draft.images ?? [], updatedAt: new Date().toISOString() });
    });
  },

  /** 清除草稿（保存成功 / 用户主动取消后）。 */
  async clearQuickNoteDraft(): Promise<void> {
    return runWrite("clearQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.clearQuickNoteDraft(d);
    });
  },

  /**
   * 小记资源落盘（内核编辑器插入图片/附件时调用）：直接写**正式目录** `quick-notes/{id}/{资产名}`，
   * 返回 canonical URL（局域网外的可达性由本机 AssetServer 负责）。
   *
   * 与桌面的差异：桌面走「staging → 保存时 promote」（有草稿日志/崩溃恢复那套基建），移动端没有这套基建，
   * 编辑目标 id 一开始就已知 ⇒ 直接写正式目录；用户中途取消留下的文件由既有孤儿/GC 清理回收（与文档资源同口径）。
   */
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

  /** 保存内核编辑器产出的小记正文（body + text 镜像 + 资源清单）。 */
  async saveQuickNoteContent(id: string, payload: { text: string; body: string; images: StoredQuickNoteImage[] }): Promise<string> {
    return runWrite("saveQuickNoteContent", async () => {
      const d = await ensureDb();
      return await quickNotesRepository.saveQuickNoteContent(d, id, payload);
    });
  },

  /**
   * 「保存并同步」（261013）：只把**这一条**小记（正文 + 它的图片）推到 S3，其余小记在云端原样保留
   * （core/quickNotePush 的合并语义）。
   *
   * 入**高优先域**（不是维护域）：长按小记 → 写完 → 同步 → 桌面端及时看到 是高频场景，
   * **绝不能**排在在途的整轮同步后面（弱网整轮可到分钟级）。推送成功后往维护域队尾排一次
   * **幂等回核**，兜住唯一交叉风险（整轮同步拿旧快照覆盖我们刚写的清单条目）。
   * 出网判据与 syncNow 同一来源（AGENTS §3#20）：关闭云同步 ⇒ 直接抛、零请求。
   */
  async syncQuickNote(id: string): Promise<QuickNotePushOutcome> {
    if ((await mobileCloudState()) === "offline") throw new Error(cloudStateHint("offline") ?? "云同步已关闭");
    const outcome = await runPriority("syncQuickNote", () => pushSingleQuickNote(id));
    if (outcome.status === "pushed") scheduleQuickNoteVerify(id);
    return outcome;
  },

  /**
   * 当前云同步状态（判据单一来源 `mobileCloudState` → core/cloudState）。
   * UI 用它决定「保存并同步」是否可用（用户 261013：关闭云同步时置灰）。
   */
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

  /** 本地删除小记：软删（保留 content 供墓碑携带），同步时上传墓碑跨端传播删除。 */
  async deleteQuickNote(id: string): Promise<void> {
    return runWrite("deleteQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.deleteQuickNote(d, id);
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
    return runWrite("restoreQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.restoreQuickNote(d, id);
    });
  },

  /** 小记彻底删除（回收站 → 不可恢复）：删行 + 删图片；保留墓碑记录（同步继续传播删除，正文已删 → 占位符 hash）。 */
  async purgeQuickNote(id: string): Promise<void> {
    return runWrite("purgeQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.purgeQuickNote(d, id, removeAssetBytesFs);
    });
  },

  /** 保存文档（编辑器自动保存 / createNote 的落库入口）。审计 F06：create 与 save 分离——
   * gone（回收站 / sync_state='purged'）明确拒绝；missing 仅当无永久墓碑时初始化新文档；
   * 绝不 upsert 覆盖回收站/已 purge 的行，也不复活已写墓碑的条目。 */
  async saveNote(id: string, title: string, content: string, parentId: string | null = null, plain?: string): Promise<void> {
    return runWrite("saveNote", async () => {
      const d = await ensureDb();
      const state = await noteRepository.noteWriteState(d, id);
      if (state === "gone") throw new Error("笔记已在回收站或已被删除，保存被拒绝；请先显式恢复");
      if (state === "missing") {
        if (await noteRepository.isTombstoned(d, id)) throw new Error("笔记已被彻底删除，保存被拒绝");
        await noteRepository.createNote(d, id, title, content, parentId, assets, plain);
        return;
      }
      await noteRepository.saveNote(d, id, title, content, parentId, assets, plain);
    });
  },

  /** 列出某文档的历史快照（纯本地；冲突留档/手动快照）。 */
  async listNoteHistory(noteId: string): Promise<Array<{ id: number; title: string; createdAt: string }>> {
    const d = await ensureDb();
    return await historyRepository.listNoteHistory(d, noteId);
  },

  /** 文档属性（移动端：正文在本地 DB，资源在 app Data 目录）。 */
  async getNoteInfo(id: string) {
    const d = await ensureDb();
    const note = await noteRepository.readNote(d, id);
    if (!note) throw new Error("笔记不存在");
    const row = await d.prepare("SELECT sync_state, is_conflict, updated_at FROM notes WHERE id=?").get(id) as
      { sync_state: string; is_conflict: number; updated_at: string } | undefined;
    const plain = lakeHtmlToPlain(note.content);
    const charCount = plain.replace(/\s+/g, "").length;
    const wordCount = (plain.match(/[\u4e00-\u9fff]/g)?.length ?? 0) + (plain.match(/[A-Za-z0-9]+/g)?.length ?? 0);
    const seen = new Set<string>();
    const assets: Array<{ filename: string; size: number; kind: string }> = [];
    for (const card of scanAssetCards(note.content)) {
      if (!card.filename || seen.has(card.filename)) continue;
      seen.add(card.filename);
      assets.push({ filename: card.filename, size: card.size, kind: fileKindOf(card.filename) });
    }
    const cardCounts = new Map<string, number>();
    for (const m of note.content.matchAll(/<card\b[^>]*\bname="([^"]+)"/g)) cardCounts.set(m[1], (cardCounts.get(m[1]) ?? 0) + 1);
    const tableCount = (note.content.match(/<table\b/g) ?? []).length;
    if (tableCount > 0) cardCounts.set("table", (cardCounts.get("table") ?? 0) + tableCount);
    const labels: Record<string, string> = { image: "图片", video: "视频", audio: "音频", file: "附件", codeblock: "代码块", table: "表格", board: "画板", mindmap: "思维导图", bookmark: "书签", database: "数据库", hr: "分隔线", math: "公式" };
    const cardStats = [...cardCounts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
    const parents: Array<{ id: string; title: string }> = [];
    let pid = note.parentId;
    let guard = 0;
    while (pid && guard++ < 64) {
      const parent = (await d.prepare("SELECT id,title,parent_id FROM folders WHERE id=?").get(pid)
        ?? await d.prepare("SELECT id,title,parent_id FROM notes WHERE id=?").get(pid)) as
        { id: string; title: string; parent_id: string | null } | undefined;
      if (!parent) break;
      parents.unshift({ id: parent.id, title: parent.title });
      pid = parent.parent_id;
    }
    const history = (await historyRepository.listNoteHistory(d, id)).map((h) => ({ id: h.id, createdAt: h.createdAt, size: 0 }));
    return {
      id,
      title: note.title,
      parentPath: parents.map((p) => p.title).join(" / "),
      parents,
      cardStats,
      createdAt: null,
      updatedAt: row?.updated_at ?? note.updatedAt,
      syncState: row?.sync_state ?? "local",
      isConflict: Boolean(row?.is_conflict),
      isLocked: false,
      lakePath: "(移动端：正文存于本地数据库)",
      assetsDir: `note-assets/${id}`,
      sizeBytes: new TextEncoder().encode(note.content).length,
      charCount,
      wordCount,
      assets,
      assetTotalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      history,
    };
  },

  /** 本地资源预览（仅图片返回 dataUrl）。 */
  async readAssetPreview(noteId: string, filename: string) {
    const mimeType = mimeTypeForFilename(filename);
    if (!mimeType.startsWith("image/")) return { filename, mimeType, supported: false };
    const bytes = await loadAssetBytesFs(`${noteId}/${filename}`);
    if (!bytes || bytes.length > 32 * 1024 * 1024) return { filename, mimeType, supported: false };
    return { filename, mimeType, supported: true, dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}` };
  },

  /** 历史快照预览（返回 HTML，供属性面板内联渲染）。 */
  async previewHistorySnapshot(historyId: number) {
    const d = await ensureDb();
    const h = await historyRepository.readHistory(d, historyId);
    if (!h) return null;
    return { plain: lakeHtmlToPlain(h.content), html: h.content, createdAt: "", contentHash: "" };
  },

  /** 系统默认应用打开本地附件（OpenFile 原生插件）。 */
  async openAttachment(noteId: string, filename: string) {
    // 与桌面 open_attachment 对齐：禁止 shell/ACTION_VIEW 打开可执行类附件
    if (!isSafeShellOpenFilename(filename)) {
      throw new Error("该附件类型不允许用系统应用打开（疑似可执行文件）");
    }
    const uri = await Filesystem.getUri({ path: `note-assets/${noteId}/${filename}`, directory: Directory.Data });
    await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
    return { ok: true };
  },

  /**
   * 另存为到用户可见区域：图片 → 相册（MediaStore），其它附件 → SAF 系统“保存到”面板。
   * 私有 Data 目录里的文件用户看不到，这是把它转出去的唯一合规路径。
   */
  async saveAssetAs(noteId: string, filename: string, name?: string) {
    const uri = await Filesystem.getUri({ path: `note-assets/${noteId}/${filename}`, directory: Directory.Data });
    await OpenFile.saveAs({ path: uri.uri.replace(/^file:\/\//, ""), name: name || filename });
    return { ok: true };
  },

  /** 恢复历史快照：对齐桌面端——先给当前正文留档（可反悔），再把快照正文+标题写回（sync_state=local → 下轮同步上传覆盖远端）。 */
  async restoreHistory(historyId: number): Promise<void> {
    const d = await ensureDb();
    const mobileDb = d;
    const snapshot = await historyRepository.readHistory(mobileDb, historyId);
    if (!snapshot) return;
    await historyRepository.backupCurrentNote(mobileDb, snapshot.noteId);
    await bridge.saveNote(snapshot.noteId, snapshot.title, snapshot.content);
  },

  /** 手动删除单个历史快照（对齐桌面 deleteHistory）。 */
  async deleteHistory(historyId: number): Promise<void> {
    await runWrite("deleteHistory", async () => {
      const d = await ensureDb();
      await historyRepository.deleteHistory(d, historyId);
    });
  },

  /** 读取历史快照设置（对齐桌面 getHistorySettings；存 device_state，纯本地）。 */
  async getHistorySettings(): Promise<HistoryMobileSettings> {
    const d = await ensureDb();
    return await historyRepository.getHistorySettings(d);
  },

  /** 保存历史快照设置（对齐桌面 saveHistorySettings）。 */
  async saveHistorySettings(settings: HistoryMobileSettings): Promise<void> {
    await runWrite("saveHistorySettings", async () => {
      const d = await ensureDb();
      await historyRepository.saveHistorySettings(d, settings);
    });
  },

  /** 给某笔记创建快照（定时自动快照用；读当前正文，24h 去重）。 */
  async snapshotNote(noteId: string): Promise<void> {
    await runWrite("snapshotNote", async () => {
      const d = await ensureDb();
      await historyRepository.snapshotNote(d, noteId);
    });
  },

  /** 历史快照清理（对齐桌面 cleanupHistory：分层保留 + 上限 + 保留天数，设置可配置）。 */
  async cleanupHistory(): Promise<{ deleted: number }> {
    return runWrite("cleanupHistory", async () => {
      const d = await ensureDb();
      const mobileDb = d;
      return await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
    });
  },

  /** 全局孤儿资源列表（对齐桌面 listOrphanAssets）。 */
  async listOrphanAssets(): Promise<Array<{ id: number; noteId: string; filename: string; size: number; mimeType: string; detectedAt: string }>> {
    const d = await ensureDb();
    return await orphanAssetRepository.listOrphanAssets(d);
  },

  /** 删除单个孤儿资源（本地文件 + 登记）。 */
  async deleteOrphanAsset(id: number): Promise<void> {
    await runWrite("deleteOrphanAsset", async () => {
      const d = await ensureDb();
      await orphanAssetRepository.deleteOrphanAsset(d, id, {
        assets,
        removeAssetFile: removeAssetBytesFs,
      });
    });
  },

  /** 清理全部孤儿资源（本地文件 + 登记）。 */
  async cleanOrphanAssets(): Promise<void> {
    await runWrite("cleanOrphanAssets", async () => {
      const d = await ensureDb();
      await orphanAssetRepository.cleanOrphanAssets(d, {
        assets,
        removeAssetFile: removeAssetBytesFs,
      });
    });
  },

  /** GC：登记待回收键（新 manifest 不再引用，对齐桌面 addS3GcPending）。 */
  async addS3GcPending(key: string): Promise<void> {
    await runWrite("addS3GcPending", async () => {
      const d = await ensureDb();
      await gcRepository.addS3GcPending(d, key);
    });
  },

  /** GC：从待回收表移除已被重新引用的键。 */
  async removeS3GcPending(keys: string[]): Promise<void> {
    await runWrite("removeS3GcPending", async () => {
      const d = await ensureDb();
      await gcRepository.removeS3GcPending(d, keys);
    });
  },

  /** GC：列出全部待回收键。 */
  async listS3GcPending(): Promise<Array<{ key: string; markedAt: string }>> {
    const d = await ensureDb();
    return await gcRepository.listS3GcPending(d);
  },

  /** GC：记录删除（对齐桌面 recordS3GcLog）。 */
  async recordS3GcLog(action: string, key: string, reason: string, ok: boolean): Promise<void> {
    await runWrite("recordS3GcLog", async () => {
      const d = await ensureDb();
      await gcRepository.recordS3GcLog(d, action, key, reason, ok);
    });
  },

  async createNote(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // 无父新建 → 兜底父笔记本（存在的笔记本；无则自动创建"未分类"）
    const pid = parentId ?? await dbPort.defaultNotebookId();
    const content = emptyLakeBody(id);
    await bridge.saveNote(id, title, content, pid);
    return { id, title, content, updatedAt: now, parentId: pid, kind: "doc" };
  },

  /** 本地软删（入回收站）：同步时上传墓碑（删除压编辑） */
  async trashNote(id: string): Promise<void> {
    return runWrite("trashNote", async () => {
      const d = await ensureDb();
      await noteRepository.trashNote(d, id);
    });
  },

  /** 回收站预览：按需补拉该笔记本地缺失的资源（不恢复、不移出回收站）。best-effort。 */
  async ensureTrashNoteAssets(id: string): Promise<void> {
    return runMaintenance("ensureTrashNoteAssets", async () => {
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
  async listTrashed(): Promise<LocalNote[]> {
    const d = await ensureDb();
    return await noteRepository.listTrashed(d);
  },

  /** 软删除（入回收站）：folder = 整棵子树（含深层 folders + 子树 notes）标 trashed_at；note = 单条。
   * 与桌面 deleteTreeNode 同语义（删除 = 移入回收站，回收站条目是普通条目，移动即同步传播）：
   * 移动端无 notebook-trash 容器行，用 trashed_at 标记 + listFoldersForSync 输出 trashedAt 传播；
   * parent_id 不变（恢复即原地清 trashed_at，对齐 restoreTreeItem）。
   * 仅提供 API（lakeNative 契约/未来 UI 用），当前移动端 UI 未接入删除笔记本入口。 */
  async trashTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("trashTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.trashTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },

  /** B2：统一回收站树（folders 笔记本/分组 + notes 文档）。复用桌面 TrashPanel 语义：仅根节点可恢复（整棵连带），任意节点可彻底删除。 */
  async listTrashTree(): Promise<Array<{ id: string; title: string; kind: "folder" | "note"; parentId: string | null; deletedAt: string | null }>> {
    const d = await ensureDb();
    return await trashRepository.listTrashTree(d);
  },

  /** B2：恢复回收站项。folder = 恢复整棵（含深层子树）；note = 文档级恢复。恢复标记 restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("restoreTreeItem", async () => {
      const d = await ensureDb();
      // 261006 B 方案（与桌面一致）：恢复**不等网络**。puller 立刻返回，缺失资源排到本次任务之后
      // 在后台按需补拉（onlyMissing，走**维护域**）：与当前写域不同域、且不 await ⇒ 不会自锁（I3）；失败只告警，下次同步补拉。
      await trashRepository.restoreTreeItem(d, id, kind, (noteIds) => {
        void runMaintenance("ensureTrashNoteAssets", () => downloadDeclaredAssetsFor(noteIds, true)).catch((error) => {
          console.warn("[trash] 恢复后的资源补拉失败（下次同步补拉）", error);
        });
        return Promise.resolve();
      });
      await reconcileIndex(d);
    });
  },

  /** B2：彻底删除回收站项（purge）。folder = 子树全部 purge；note = 单条 purge（同步发墓碑）。
   * 对齐桌面 purgeTrashItem：物理删除行 + 写 deleted_notes 墓碑（purged_at + node_type）。
   * 墓碑经 syncEngine 发布 deleted:true 传播到其他端（否则仅从 manifest 移除 → 其他端保留 active 副本，删除不传播）；
   * folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
   * 与收到他端 purge（applyRemotePurge：行保留标 purged、可恢复）语义不同：本地主动 purge 不可恢复。 */
  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("purgeTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.purgeTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },

  // ---- 云同步开关（与桌面同语义：关闭 = 离线本地空间） ----

  getSyncSettings(): SyncSettings {
    return readSyncSettings();
  },

  saveSyncSettings(next: SyncSettings): void {
    writeLocalStorage(SYNC_STORAGE_KEY, JSON.stringify(next));
  },

  // ---- S3（连接检查 / 单发上传 / 深度清理） ----

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
        writeLocalStorage(S3_STORAGE_KEY, JSON.stringify(parsed));
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
    writeLocalStorage(S3_STORAGE_KEY, JSON.stringify(rest));
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


  /** D8+：图片/附件上传（Lake 编辑器粘贴/插入调用）。本地落盘 + 返回 canonical URL（本地 AssetServer 服务）。
   * 附件（非图片）同样走本路径：任意字节落盘 + 保留原扩展名（与桌面 assetNaming 命名一致）。 */
  async uploadResource(
    input: { bytes: Uint8Array; filename: string },
    noteId: string
  ): Promise<{ url: string; resourceRef: string; filename: string; mimeType: string; size: number }> {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes as unknown as ArrayLike<number>);
    assertResourceBytes(bytes);
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
    const mimeType = mimeTypeForFilename(name);
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
    const mobileDb = d;
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
      await runMaintenance("gcDeepCleanup", async () => {
        const mobileDb = d;
        for (const key of keys) await gcRepository.recordS3GcLog(mobileDb, "delete", key, "deep-clean", true);
      });
    }
    return { candidateCount: all.length, deletedCount, keys };
  },

  /** 运行诊断（移动端"日志查看/关于"等价）：存储统计。 */
  async getDiagnostics(): Promise<diagnosticsRepository.MobileDiagnostics> {
    const d = await ensureDb();
    const mobileDb = d;
    return diagnosticsRepository.getDiagnostics(mobileDb, {
      listAssetKeys: listAssetKeysFs,
      getDatabaseSizeBytes: () => mobileDb.databaseSizeBytes(),
    });
  },

  /** 整轮同步：Lake Manifest V1（拉取对账 + 上传发布）+ 小记 quick-notes/ 子空间同步，复用 src/core 引擎。
   * P2-5/6（GPT 审计）：结构化返回（notes/quickNotes 分字段）；主维护队列串行化防与本地写操作交错。 */
  async syncNow(): Promise<MobileSyncResult> {
    // 关闭云同步 = 纯离线本地空间：直接说明原因，**零请求**（与桌面 runSync 同一判据）
    if ((await mobileCloudState()) === "offline") {
      return { message: cloudStateHint("offline") ?? "云同步已关闭", notes: null, quickNotes: null };
    }
    try {
      const result = await runMaintenance("syncNow", async () => {
      const cfg = await bridge.getS3Settings();
      if (!cfg) return { message: "未配置 S3", notes: null, quickNotes: null };
      // 同步也走同一条"密钥缺失"提示（别让用户以为"同步失败"却看不出该重填密钥）。
      try { assertS3Credentials(cfg); } catch (e) { return { message: (e as Error).message, notes: null, quickNotes: null }; }
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
      const mobileDb = d;
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
        // 清理可能部分成功；失败不拖垮同步，下一次同步继续按策略清理。
        try {
          const mobileDb = d;
          await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
        } catch {
          // 清理失败不拖垮同步；下一次同步会继续按策略清理。
        }
      // 同步可能增删改文档：对账搜索索引（本地派生数据，随同步刷新）。
      let indexMs = 0;
      try {
        const indexStart = Date.now();
        await reconcileIndex(d);
        indexMs = Date.now() - indexStart;
        console.log(`[sync] reconcileIndex ms=${indexMs}`);
      } catch { /* 索引对账失败不影响同步结果 */ }
      return { message: report.message + quickMsg, notes: report, quickNotes, indexMs };
      });
      // 可观测性（用户 261013）：**每次尝试只写一处**，成功与否按"**真的跑了引擎**"判（notes 非 null）——
      // 「未配置 S3」「密钥缺失」是正常返回（不抛错）但**没跑成**，必须记成失败，否则状态行会显示"同步成功：未配置 S3"（探针实测踩到）。
      writeSyncStatus({ at: new Date().toISOString(), ok: result.notes !== null, message: result.message });
      return result;
    } catch (error) {
      // 引擎抛错（网络/协议）：记失败原因，错误照旧抛给调用方（它决定要不要 toast）
      writeSyncStatus({ at: new Date().toISOString(), ok: false, message: (error as Error)?.message ?? String(error) });
      throw error;
    }
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
