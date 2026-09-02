/**
 * 同步编排引擎（lake-core 共享层，V5 §13 高优先 TODO 落地）。
 *
 * 决策机制（reconcileLakeNote/decideUpload/mergeLockState）与执行编排在此统一：
 * 桌面（electron/sync.ts 收敛）+ 移动端（Capacitor）共用同一实现，
 * 平台差异全部经端口注入：
 * - S3Store：对象读写（桌面=ObjectStore，移动端=CapacitorHttpHandler adapter）
 * - SyncDbPort：本地库读写（桌面=store 方法包装，移动端=sql.js）
 *
 * 语义（对齐 docs/SYNC-PROTOCOL.md v4）：
 * - 下载方向：墓碑/恢复分支 → reconcile 对账 → 对象下载（先内容后标志）→ 本地应用
 * - 上传方向：本地回收站 → 墓碑（删除前内容 + deleted 标记）；恢复 → active 覆盖；
 *   正常 → decideUpload（skip-fast）
 * - 记账：sync_base（content_hash / last_synced_meta_at / last_uploaded_hash）
 */
import { reconcileLakeNote } from "./lakeReconcile.js";
import { decideUpload } from "./decideUpload.js";
import { buildUploadEntry, buildTombstoneEntry, decideMetaApply, decideLocalTombstone, decidePurge, decideTombstoneYield, TRASH_NOTEBOOK_ID } from "./syncDecisions.js";
import { mergeLockState } from "./syncDecision.js";
import { shouldSkipZeroChange, isRemoteDescendant, createSupersededTracker } from "./syncPerf.js";
import type { Manifest, ManifestFolder, ManifestNote } from "./manifestTypes.js";
import { sha256Sync } from "./sha256Sync.js";
import { parseLakeManifest, objectKey } from "./syncUtils.js";
import { extractAssetRefs } from "./assetNaming.js";
import { isSafePathSegment } from "./storeUtils.js";
import { MAX_IMAGE_BYTES } from "./storeLimits.js";

/** 单对象大小护栏（对齐桌面 sync.ts:100）：正文 .lake 上限 64MiB。 */
const MAX_REMOTE_NOTE_BYTES = 64 * 1024 * 1024;

/** P3-3：资产传输并发批大小。桌面实测（106 资产 58MB）：串行 RTT 占同步耗时 99%
 * （head 均 24ms + put 均 157ms × 212 次往返 = 19.7s）。并发 4 → 首传约 5s、稳态 HEAD 巡检 <1s；
 * 对齐思源 dejavu 的并发 worker 模式。4 路对七牛 Kodo QPS 安全。 */
const ASSET_CONCURRENCY = 4;

/** P3-3：小型并发池（定长车道，无依赖）：worker 按 index 领任务；结果由调用方按
 * 原索引归位（warnings 顺序 / 字节记账保持确定性，对齐串行语义）。 */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

/** 对象存储读取返回字节；正文对象是纯文本 Lake HTML，解码为字符串。 */
const decodeText = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** D8：下载笔记关联资产（内容寻址 assets/{noteId}/{filename}），校验 size/sha256 后落盘。
 * - strict=false（移动端读优先）：单个资源缺失/损坏 → 该资源跳过 + warning（图片占位），不阻断笔记正文导入。
 * - strict=true（桌面对齐 sync.ts:533-541）：资源缺失/损坏 → 抛 AssetMissingError，调用方跳过整个条目
 *   （不导入半成品；warning 由调用方记 kind=asset_missing）。 */
class AssetMissingError extends Error {}

async function downloadAssets(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, rn: ManifestNote, report: SyncReport, strict: boolean): Promise<void> {
  const assets = rn.assets ?? [];
  // A 方案：记录 manifest 声明的资产元数据（即使某资源文件本地缺失，上传 union 仍可正确声明）。
  if (typeof db.recordDeclaredAssets === "function") db.recordDeclaredAssets(rn.id, assets);
  // P3-3：并发下载（每资产 getObject/校验/saveAsset 相互独立）。worker 不抛错——
  // 失败按索引归位，池结束后统一裁决：warnings 按原顺序入列、首个错误按原顺序抛出，
  // 与旧串行实现的裁决结果逐字节一致（仅失败前的多余请求会发出，结果确定）。
  const errors: Array<Error | null> = new Array(assets.length).fill(null);
  const warnings: Array<string | null> = new Array(assets.length).fill(null);
  const saved: Array<number> = new Array(assets.length).fill(0);
  let aborted = false; // strict 首错后停止落盘（并发车道已在途的请求自然完成但不写盘，防孤儿资产目录）
  await runPool(assets, ASSET_CONCURRENCY, async (asset, i) => {
    try {
      const bytes = await s3.getObject(`${cfg.prefix}/assets/${rn.id}/${asset.filename}`, { maxBytes: MAX_IMAGE_BYTES });
      if (bytes == null) {
        if (strict) { errors[i] = new AssetMissingError(`资源缺失: ${rn.id}/${asset.filename}`); aborted = true; }
        else warnings[i] = `资源缺失（跳过）: ${rn.id}/${asset.filename}`;
        return;
      }
      if (bytes.length !== asset.size) {
        // 损坏（声明 size 不符）→ 严格模式整轮中止（对齐桌面：损坏拒绝，不静默接受）
        if (strict) { errors[i] = new Error(`资源大小不符: ${rn.id}/${asset.filename}（声明 ${asset.size}，实际 ${bytes.length}）`); aborted = true; }
        else warnings[i] = `资源大小不符（跳过）: ${rn.id}/${asset.filename}`;
        return;
      }
      if (sha256Sync(bytes) !== asset.hash) {
        if (strict) { errors[i] = new Error(`资源哈希不符: ${rn.id}/${asset.filename}`); aborted = true; }
        else warnings[i] = `资源哈希不符（跳过）: ${rn.id}/${asset.filename}`;
        return;
      }
      if (aborted) return; // strict 已首错：不落盘（防半成品孤儿资产）
      await db.saveAsset(rn.id, asset.filename, bytes);
      saved[i] = bytes.length;
    } catch (e) {
      // getObject 异常（网络/超限）：与旧实现一致向上传播（两模式均抛，不计入 warning）
      aborted = true;
      errors[i] = e instanceof Error ? e : new Error(String(e));
    }
  });
  for (const w of warnings) if (w) report.warnings.push(w);
  for (const e of errors) if (e) throw e;
  for (const n of saved) report.downloadedBytes += n;
}

/** 兼容 Web/Node 的 UUID（移动端 WebView 也提供 crypto.randomUUID）。 */
function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // 兜底：无 crypto.randomUUID 的环境（极老 WebView）
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface SyncConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

/** 对象存储端口（平台注入）：key 为含 prefix 的完整对象键 */
export interface S3Store {
  /** 读取对象；404 返回 null（首次同步判定），其他错误抛出。
   * 返回**已解压**字节（gunzip 在端口内完成，syncEngine 不感知 gzip——红线 §3.2）。
   * opts.maxBytes：超出上限抛错（单对象大小护栏，对齐桌面 sync.ts:507/523）。 */
  getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null>;
  /** 写入对象；opts.gzip 由端口压缩（manifest 传 {gzip:true}，正文/资源不压缩）。 */
  putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  /**
   * HEAD 存在性探测（桌面实现；移动端/测试桩可不实现走整对象 GET 回退）。
   * 探测"远端是否已有此对象"用 HEAD 而非 getObject——大附件（100MiB 级）下
   * 整对象 GET 判存在会每轮同步全量下载，浪费带宽且拖慢同步。
   */
  exists?(key: string): Promise<boolean>;
  /**
   * 流式上传（桌面实现；移动端/测试桩可不实现走字节路径回退）。
   * open 返回 Node Readable（本地文件流）；size 为文件字节数（显式 Content-Length，
   * 避免 aws-chunked 编码——七牛 Kodo 兼容性实测验证）。返回 null = 本地文件缺失。
   */
  putObjectStream?(key: string, size: number, open: () => Promise<unknown | null>): Promise<void>;
}

export interface SyncReport {
  pulled: boolean;
  appliedRemote: number;
  uploaded: number;
  published: boolean;
  message: string;
  warnings: string[];
  /** 本地修改被远端覆盖、已强制留档的文档（对齐桌面 SyncResult.supersededNotes，UI 提醒用）。 */
  supersededNotes: Array<{ id: string; title: string }>;
  /** 同步统计（思源式 tooltip 展示）：上传/下载的目录数与字节数（正文 + 资源 + manifest）。 */
  foldersUploaded: number;
  /** 本次同步移入回收站的文档数：trashedDown=下载方向应用远端墓碑（新增入回收站，不含已一致的重复应用）；
   * trashedUp=上传方向本端软删条目发布。UI"移入回收站"展示用。 */
  trashedDown: number;
  trashedUp: number;
  foldersDownloaded: number;
  uploadedBytes: number;
  downloadedBytes: number;
}

export interface LocalNoteRow {
  /** P3-1 契约：getAllNotes 批量路径只保证元数据 + contentHash，content 可为 ""（桌面 adapter 不读全文）；
   * 需要正文的时刻（留历史快照、上传入队）用 getNote(id) 显式回查。 */
  id: string; title: string; content: string; updatedAt: string; syncState: string;
  trashedAt: string | null; restorePendingAt: string | null; parentId: string | null; sortOrder: number;
  /** 协议字段透传（D9）：锁/图标/冲突标记不得因移动端不展示而丢失（红线 §3.5）。 */
  isLocked: boolean; lockedAt: string | null; icon: string | null; isConflict: boolean;
  /** 当前本地内容 hash（桌面 adapter 用 store.contentHash 提供，避免为算 hash 读 content；
   * 移动端不传则 syncEngine 读 content 自行计算）。 */
  contentHash?: string;
  /** 删除前父目录（回收站条目恢复位置；软删上传必须用它而非删除后的 parentId=TRASH）。 */
  deletedFromParentId?: string | null;
}

export interface SyncDbPort {
  getNote(id: string): LocalNoteRow | null;
  getAllNotes(): LocalNoteRow[];
  getSyncBase(id: string): { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null } | null;
  applyRemoteNote(note: ManifestNote, content: string): void;
  /** 远端墓碑应用：先拉内容再标记回收站（先内容、后标志；保留可恢复） */
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, deletedFromParentId: string | null, parentId: string | null, sortOrder: number): void;
  /** 本地软删（入回收站）：保留内容，sync_state=local */
  localTrashNote(id: string): void;
  /** 本地恢复：移出回收站 + restore_pending_at（同步时 local-wins 上传 active 覆盖墓碑） */
  localRestoreNote(id: string): void;
  /** 收到他端 purge 墓碑（deleted:true）：本地条目移入回收站并标 purged（保留可恢复、不上传）。 */
  applyRemotePurge(id: string): void;
  /** 本地删除墓碑列表（deleted_notes 表：本设备从未持有或已彻底删除的）——远端恢复撤销判定用。
   * 返回 null = 端口不支持（移动端无 deleted_notes 场景时可不实现，撤销判定退化）。 */
  /** nodeType：'folder' 墓碑仅本地下载过滤、不进 manifest.notes（发布方向必须跳过）。 */
  listDeletedNotesForSync?(): Array<{ id: string; deletedAt: string; title?: string; nodeType?: string }>;
  /** 墓碑已发布到 manifest 后标记（port 无此能力则跳过，计数降级为按全部墓碑）。 */
  markTombstonesPublished?(ids: string[]): void;
  /** 读墓碑笔记的删除前内容（墓碑携带内容，他端先拉内容再应用；读失败/不支持 → null 占位符）。 */
  readDeletedContent?(id: string): Promise<string | null>;
  /** 强制读真实内容 hash（远端缺失时回退全量扫描，对齐桌面 cachedBase 优化边界）。 */
  forceHashRead?(id: string): string | null;
  /** 撤销本地删除墓碑（远端恢复较新，下载分支调用；对齐桌面 store.revokeLocalDeletion）。 */
  revokeLocalDeletion?(id: string): void;
  /** 目录记账：同步后标记 folder 为 synced（对齐桌面 store.markFolderSynced；移动端无目录编辑可不实现）。 */
  markFolderSynced?(id: string, expectedUpdatedAt: string): boolean;
  /** 本地已彻底删除（purge）的 folder/group（deleted_notes 带 purged_at）：下载导入远端 folders 前过滤，
   * 防"清空回收站后同步 → 被删笔记本重新导入复活"；发布时检测到也应强制重写 manifest 移除云端残留。 */
  isFolderPurged?(id: string): boolean;
  /** 记录"从云端学到的删除"（本设备从未持有该笔记），防离线设备把残留当新文档上传复活（审计 #2）。 */
  rememberDeleted(note: ManifestNote, deletedAt: string): void;
  /** 正文相同但元数据（标题/父/排序/图标）变化时应用远端较新版本（B3 LWW）。 */
  applyRemoteNoteMeta(note: ManifestNote): void;
  /** 锁字段级 LWW：应用远端锁状态（锁变更不改正文哈希，需独立应用）。 */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void;
  /** lastUploadedHash 传 null = 两端一致 skip 记账（本机未上传该版本内容，须清除误标，防 ownEdit 重复留档）。 */
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null): void;
  /** 记账快照保护（B2，V5 §5.2）：仅当本地当前内容 hash 仍等于 expectedContentHash（同步期间未编辑）才标 synced；否则保持 local 下轮重传。
   * lastUploadedHash 传 null = 下载对账收尾（本机未上传该版本，不得误标"本机是作者"）。 */
  markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string | null): void;
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): void;
  /** 兜底父笔记本 id（系统中没有"默认笔记本"；实现 = 任意存在的笔记本，无则自动创建"未分类"）。 */
  defaultNotebookId(): string;
  /** 导入远端 notebook/group 节点（移动端 folders/tree 表）。 */
  importRemoteFolder(folder: ManifestFolder): void;
  /** 发布方向：列出本地目录树（notebook/group），供 manifest.folders 写入（对齐桌面 listFoldersForSync）。
   * 返回 null = 端口不支持本地目录发布（POC 只读 folders 时可不实现，folders 保持远端透传）。 */
  listFoldersForSync?(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; nodeType: string; icon: string | null; updatedAt: string; trashedAt?: string | null; deletedFromParentId?: string | null }>;
  /** 本机编辑成果被远端覆盖前强制留档（D5，协议 §4.2）：写一条 note_history，防丢数据。 */
  createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }): void;
  /** 资产落地（D8）：把已校验的图片字节写入本地（Capacitor Filesystem / IndexedDB），供本地资源服务显示。 */
  saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void>;
  /** 资产上传扫描（H3）：列出笔记的本地资产（filename + size + sha256），供 manifest.assets 上传。 */
  listLocalAssets(noteId: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  /** A 方案：记录 manifest 声明的资产元数据（即使本地文件缺失，上传 union 仍可正确声明）。 */
  recordDeclaredAssets?(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): void;
  /** A 方案：列出该笔记已声明（含本地缺失但 manifest 声明过）的资产元数据。 */
  listDeclaredAssets?(noteId: string): Array<{ filename: string; size: number; hash: string }>;
  /** 资产上传扫描（H3）：读取本地资产字节（供上传 S3）。 */
  readLocalAsset(noteId: string, filename: string): Promise<Uint8Array | null>;
  /** 资产流式上传（桌面实现）：打开本地资产文件流；缺失返回 null。syncEngine 探测到
   * 本方法 + S3Store.putObjectStream 同时存在才走流式，否则字节路径。 */
  openLocalAssetStream?(noteId: string, filename: string): Promise<unknown | null>;
  /** 零变更早退：本设备上次成功读/写的 manifest commitId（无则 null）。 */
  getLastSeenCommitId(): string | null;
  setLastSeenCommitId(commitId: string): void;
  /** 零变更早退：本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)）。 */
  getLastTombstoneSig(): string;
  setLastTombstoneSig(sig: string): void;
  /** 零变更早退：deleted_notes 的 COUNT:MAX(deleted_at) 签名。 */
  tombstoneSignature(): string;
  /** 零变更早退：本地是否有待上传变更（notes 非 synced 或目录/分组改动）。 */
  hasLocalPendingNotes(): boolean;
  log(msg: string): void;
}

const MANIFEST_KEY = "manifests/latest.json";

/** 扫描本地资产：上传到 S3（缺失才传）并返回清单条目（H3 与软删上云共用）。
 * 存在性探测优先 HEAD（s3.exists），避免整对象 GET 判存在；上传优先流式
 * （s3.putObjectStream + db.openLocalAssetStream 同时可用时），否则字节路径。
 * stats 传入时累计实际上传字节数（流式取声明 size，字节路径取 bytes.length）。
 * 导出供单元测试直接覆盖流式/HEAD 选择逻辑。 */
export async function scanLocalAssets(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, noteId: string, stats?: { uploadedBytes: number }): Promise<ManifestNote["assets"]> {
  const localAssets = await db.listLocalAssets(noteId);
  const canStream = !!s3.putObjectStream && typeof db.openLocalAssetStream === "function";
  // P3-3：并发 HEAD+PUT（桌面实测串行 RTT 占同步耗时 99%）。worker 不抛错——错误按索引
  // 归位，池结束后按原顺序抛首个错误（与旧串行"逐个 await、首错即止"裁决一致）；
  // 字节记账按索引归位（流式=声明 size，字节路径=实际 bytes.length）。
  const uploadedSize: Array<number | null> = new Array(localAssets.length).fill(null);
  const errors: Array<unknown> = new Array(localAssets.length).fill(null);
  await runPool(localAssets, ASSET_CONCURRENCY, async (a, i) => {
    try {
      const key = `${cfg.prefix}/assets/${noteId}/${a.filename}`;
      // 存在性探测：HEAD 优先；端口未实现则整对象 GET 判存在（兼容移动端/测试桩）
      const exists = s3.exists ? await s3.exists(key) : (await s3.getObject(key)) != null;
      if (!exists) {
        if (canStream && s3.putObjectStream) {
          await s3.putObjectStream(key, a.size, () => db.openLocalAssetStream!(noteId, a.filename));
          uploadedSize[i] = a.size;
        } else {
          const bytes = await db.readLocalAsset(noteId, a.filename);
          if (bytes) {
            await s3.putObject(key, bytes);
            uploadedSize[i] = bytes.length;
          }
        }
      }
    } catch (e) {
      errors[i] = e;
    }
  });
  for (const e of errors) if (e) throw e;
  if (stats) {
    for (const n of uploadedSize) if (n != null) stats.uploadedBytes += n;
  }
  return localAssets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash }));
}

export interface SyncNowOptions {
  /** 进度上报（桌面 UI 用；移动端可不传）。phase 阶段与桌面 sync.ts 对齐。 */
  onProgress?: (phase: string, message: string) => void;
  /** 本机编辑被远端覆盖前的留档钩子（桌面 createHistorySnapshot；移动端已由 SyncDbPort.createHistorySnapshot 覆盖）。 */
  onSuperseded?: (noteId: string, content: string) => void;
  /** 发布后回调（next + prev manifest）：桌面 GC 差集标记（4.5）用；移动端可不传。 */
  onPublished?: (next: Manifest, prev: Manifest | null) => void;
  /** 严格资源语义（桌面=true，对齐 sync.ts 资源缺失跳过整条目；移动端默认 false 宽松图片占位）。 */
  strictAssets?: boolean;
}

export async function syncNow(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, opts?: SyncNowOptions): Promise<SyncReport> {
  const report: SyncReport = { pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "", warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0, trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0 };
  // superseded 去重（与桌面同单点）：Lake 下载阶段冲突语义由 supersededNotes 表达，Set 去重防重复记。
  const supersededTracker = createSupersededTracker();
  // H5：本机编辑成果判定（软删/purge 覆盖前留档共用）——本地相对基线有改动，或本机上传过当前版本（本机是作者）。
  const ownEditOf = (local: LocalNoteRow | null, id: string): boolean => {
    if (!local) return false;
    const base = db.getSyncBase(id);
    const localHash = local.contentHash ?? sha256Sync(new TextEncoder().encode(local.content));
    return (base !== null && localHash !== base.contentHash) || (base?.lastUploadedHash != null && localHash === base.lastUploadedHash);
  };
  // P3-1：按需取正文——批量行（getAllNotes）content 可为 ""（桌面 adapter 元数据路径），
  // 仅在留历史快照/上传入队时刻调用；行已带正文（移动端/测试桩）则直接用，不产生额外 IO。
  const contentOf = (row: LocalNoteRow | null): string => {
    if (!row) return "";
    if (row.content) return row.content;
    return db.getNote(row.id)?.content ?? "";
  };
  // A 方案：上传 manifest 的 assets = 本地文件 ∪ (正文引用的、且有已声明元数据的资源)。
  // 保证备份声明完整；正文引用（当前内容）不含已删除引用，避免历史把已删资源挂回当前文档。
  const resolveUploadAssets = async (localId: string, content: string): Promise<ManifestNote["assets"]> => {
    const localFiles = await scanLocalAssets(cfg, s3, db, localId, report);
    const declared = typeof db.listDeclaredAssets === "function" ? (db.listDeclaredAssets(localId) ?? []) : [];
    const byName = new Map(declared.map((d) => [d.filename, d]));
    const seen = new Set(localFiles.map((f) => f.filename));
    for (const ref of extractAssetRefs(content)) {
      if (seen.has(ref)) continue;
      const d = byName.get(ref);
      if (d) { localFiles.push({ filename: d.filename, size: d.size, hash: d.hash }); seen.add(ref); }
    }
    return localFiles;
  };
  // W-2：正文下载后校验 hash（与资产强校验对齐）。不符 → 同“对象缺失”等级降级：warning + 跳过，不应用损坏正文。
  const verifyNoteHash = (contentBytes: Uint8Array, rn: ManifestNote): boolean => {
    if (sha256Sync(contentBytes) !== rn.contentHash) {
      report.warnings.push(`正文哈希不符（跳过）: ${rn.id}-${rn.contentHash}`);
      return false;
    }
    return true;
  };
  const progress = (phase: string, message: string) => { try { opts?.onProgress?.(phase, message); } catch { /* 渲染层已关闭 */ } };

  // ---- 1. 拉 latest manifest（缺失视为首次同步） ----
  let remote: Manifest | null = null;
  try {
    const manifestBytes = await s3.getObject(`${cfg.prefix}/${MANIFEST_KEY}`);
    if (manifestBytes != null) {
      remote = parseLakeManifest(manifestBytes);
      report.pulled = true;
      report.downloadedBytes += manifestBytes.length;
    } else {
      db.log("首次同步：无 latest manifest");
    }
  } catch (e) {
    const msg = (e as Error).message;
    // 结构校验错误（清单版本不兼容/格式字段非法）→ 协议级损坏，整轮中止并抛出（对齐桌面审计#19）；
    // "不是合法 JSON"（JSON.parse 失败）与网络/对象缺失 → 记录 message 返回（移动端容忍，下次再试）。
    if (/版本不兼容|清单格式/.test(msg)) throw e;
    report.message = `拉取 manifest 失败: ${msg}`;
    return report;
  }

  // 本地目录树 vs 远端语义差异（早退与发布共用）：folders 变更（回收站笔记本 / 移动 / 改名 / 图标）
  // 必须传播——对齐桌面 sync.ts 每次同步无条件发布 manifest 的语义（迁移回归修复：
  // 否则删笔记本不传播 + 目录记账抹掉 local，且 hasLocalPendingNotes 被抹后早退跳过）。
  let foldersChanged = false;
  if (typeof db.listFoldersForSync === "function") {
    const localFolders = db.listFoldersForSync() ?? [];
    const remoteFolders = new Map((remote?.folders ?? []).map((f) => [f.id, f]));
    for (const f of localFolders) {
      const rf = remoteFolders.get(f.id);
      // 本地新增（远端无此 folder）或内容有差异 → 需要发布
      if (!rf || rf.title !== f.title || (rf.parentId ?? null) !== (f.parentId ?? null) || rf.sortOrder !== f.sortOrder ||
        rf.nodeType !== f.nodeType || (rf.icon ?? null) !== (f.icon ?? null) ||
        (rf.trashedAt ?? null) !== (f.trashedAt ?? null) || (rf.deletedFromParentId ?? null) !== (f.deletedFromParentId ?? null)) {
        foldersChanged = true;
        report.foldersUploaded++;
      }
    }
    // 远端 folders 中存在本地已 purge 的（deleted_notes 带 purged_at）：必须强制发布重写 manifest，
    // 从云端移除残留（否则每轮同步都会尝试重新导入 → 复活）。
    if (!foldersChanged && typeof db.isFolderPurged === "function") {
      for (const rf of remoteFolders.values()) {
        if (db.isFolderPurged(rf.id)) { foldersChanged = true; db.log(`[publish] folder ${rf.id} locally purged, force rewrite manifest`); break; }
      }
    }
    // 同步统计：远端存在而本地没有的目录 → 下载方向新导入
    if (remote) {
      const localIds = new Set(localFolders.map((f) => f.id));
      for (const rf of remoteFolders.values()) {
        if (!localIds.has(rf.id)) report.foldersDownloaded++;
      }
    }
  }

  // 零变更早退（性能）：远端 commitId 与上次成功读/写相同 + 本地无待上传 + 墓碑签名一致 → 整轮跳过。
  // 与桌面 sync.ts 同语义（shouldSkipZeroChange 单点），10k 条时从秒级降到 ~100ms（纯性能、语义等价）。
  if (!foldersChanged && shouldSkipZeroChange({
    remoteCommitId: remote?.commitId ?? null,
    lastSeenCommitId: db.getLastSeenCommitId(),
    hasPending: db.hasLocalPendingNotes(),
    tombstoneSig: db.tombstoneSignature(),
    lastTombstoneSig: db.getLastTombstoneSig(),
  })) {
    // remote 可能为 null（空桶首次同步 + 本地无变更的极端组合）——用 ?. 防御，避免空指针
    db.log(`[perf] zero-change sync skipped (commit=${remote?.commitId.slice(0, 8) ?? "none"}, notes=${remote?.notes.length ?? 0})`);
    report.message = `零变更跳过（${remote?.notes.length ?? 0} 条）`;
    return report;
  }

  // tombstone=true：墓碑条目。content="" 为占位符（内容已物理删除，发布阶段不传空对象、保留占位符 hash）。
  const uploadQueue: Array<{ id: string; entry: ManifestNote; content: string; tombstone?: boolean }> = [];
  progress("pull", `拉取 ${remote ? remote.notes.length : 0} 条`);

  // ---- 2. 下载方向：墓碑/恢复分支 → reconcile 对账 → 应用远端 ----
  if (remote) {
    // D4：先导入目录树（保证文档父 notebook/group 已存在），并构建 validParents——
    // 父节点集合 = 兜底父笔记本（无默认笔记本概念）+ 回收站笔记本 + 远端 folders + 远端 active 笔记 id + 本地已有节点。
    // effectiveParent 据此回退，防"父目录缺失 → 文档消失/归属错位"（对齐桌面 sync.ts:344-363/395）。
    const defaultNotebook = db.defaultNotebookId();
    const validParents = new Set<string>([defaultNotebook, TRASH_NOTEBOOK_ID]);
    for (const folder of remote.folders) {
      if (!isSafePathSegment(folder.id)) throw new Error(`清单包含无效的目录 ID: ${folder.id}`);
      if (folder.parentId !== null && !isSafePathSegment(folder.parentId)) throw new Error(`清单包含无效的目录 parentId: ${folder.parentId}`);
      // 本地已 purge 的 folder（deleted_notes 带 purged_at）：不重新导入（防"清空回收站后同步 → 被删的又回来"）
      if (typeof db.isFolderPurged === "function" && db.isFolderPurged(folder.id)) {
        db.log(`[pull] folder ${folder.id} locally purged, skip import`);
        continue;
      }
      db.importRemoteFolder(folder);
      validParents.add(folder.id);
    }
    for (const rn of remote.notes) if (!rn.deleted) validParents.add(rn.id);
    // P3-1：一次全表（仅元数据）建本地索引，validParents 与下载环共用——
    // 替代原先"validParents 全量行 + 下载环每条远端笔记一次全表 SQL + 读全文"的 O(N²)。
    const localById = new Map(db.getAllNotes().map((n) => [n.id, n]));
    for (const id of localById.keys()) validParents.add(id);
    // 远端 parent 映射（仅 active 笔记）：结构环检测用——本地移动与远端已提交移动互成父子
    // （循环移动）时保留本地会成环 → 必须跟随远端打破环（先提交先确认，对齐桌面 sync.ts:363-380）。
    const remoteParentMap = new Map<string, string | null>();
    for (const rn of remote.notes) if (!rn.deleted) remoteParentMap.set(rn.id, rn.parentId);
    // 本地删除墓碑（deleted_notes）：远端恢复撤销判定（对齐桌面 sync.ts:131-147 decideLocalTombstone）
    const tombstoned = new Map(
      (typeof db.listDeletedNotesForSync === "function" ? db.listDeletedNotesForSync() : [])
        .map((d) => [d.id, d.deletedAt] as const)
    );

    for (const rn of remote.notes) {
      // 审计#3：note.id / asset.filename 必须先做单路径段校验（拒绝 ../、绝对路径、反斜杠），
      // 写盘前 fail fast（对齐桌面 sync.ts:396-401）
      if (!isSafePathSegment(rn.id)) throw new Error(`清单包含无效的笔记 ID: ${rn.id}`);
      for (const asset of rn.assets ?? []) {
        if (!isSafePathSegment(asset.filename)) throw new Error(`清单包含无效的资源文件名: ${rn.id}/${asset.filename}`);
      }
      // P3-1：本地行来自 localById（元数据），需要正文的分支由 contentOf 回查
      const local = localById.get(rn.id) ?? null;
      // 本地已删除而云端未标记（本地墓碑 vs 远端恢复）：按时间 LWW——
      // 远端 updatedAt 新于本地删除时间 → 撤销本地墓碑并跟随恢复；本地删除较新 → 跳过下载。
      const tombAt = tombstoned.get(rn.id);
      const tombDecision = decideLocalTombstone(rn.updatedAt, tombAt);
      if (tombDecision === "revoke") {
        db.log(`[tombstone] ${rn.id} 远端恢复较新，撤销本地墓碑`);
        if (typeof db.revokeLocalDeletion === "function") db.revokeLocalDeletion(rn.id);
      } else if (tombDecision === "keep-local-delete") {
        db.log(`[tombstone] ${rn.id} 本地删除较新，跳过下载（上传阶段会标记 deleted）`);
        continue;
      }
      const remoteTrashed = !!rn.trashedAt;   // 软删（回收站）；purge（deleted:true）已单独处理
      const localTrashed = local?.trashedAt != null;
      const localRestoring = local?.restorePendingAt != null;
      const effectiveParent = rn.parentId !== null && validParents.has(rn.parentId) ? rn.parentId : defaultNotebook;

      // B4：purge（deleted:true）——本地有副本→移入回收站标 purged（可恢复、不上传）；无→记住删除（防复活）
      if (rn.deleted) {
        const purgeAction = decidePurge(local, localRestoring);
        if (purgeAction === "skip-restore-pending") {
          db.log(`[purge] ${rn.id} 本地显式恢复，跳过 purge`);
        } else if (purgeAction === "apply-purge") {
          // W-1：与软删分支对称——本地未同步编辑（或本机是作者）被远端 purge 覆盖前强制留档。
          // purged 条目保留 .lake 可恢复，但无历史快照；清空回收站/自动过期后即彻底丢失。
          if (ownEditOf(local, rn.id)) {
            db.createHistorySnapshot(rn.id, contentOf(local), { title: local!.title, parentId: local!.parentId, sortOrder: local!.sortOrder });
            supersededTracker.push(rn.id, rn.title);
          }
          db.applyRemotePurge(rn.id);
          report.appliedRemote++;
        } else {
          db.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
        }
        continue;
      }

      if (remoteTrashed && localRestoring) {
        // 恢复例外（对齐桌面 trash-cross skip-restore-pending）：本地显式恢复中 → 远端墓碑让位，
        // 不应用远端墓碑（不压回回收站、不改 meta），由上传方向 local-wins 覆盖（恢复例外传播）。
        db.log(`[trash-cross] ${rn.id} 本地恢复中，跳过远端墓碑`);
        continue;
      }

      if (remoteTrashed && !localRestoring) {
        // P3-3b：幂等跳过——本地已在回收站、正文 hash 与墓碑一致、墓碑时间不新于本地 → 完全一致，
        // 只对齐记账，不重复下载正文/资产。此前每轮"有变更的同步"都会重拉回收站全部文档
        // （实测 B 端同 hash 对象重复下载；106 资产大文档批量删除后每轮重拉数十 MB）。
        // 语义等价：applyRemoteTrash 重写相同内容/元数据是 no-op；hash 不同（回收站内编辑 S4）
        // 或墓碑时间更新（回收站元数据变更）仍走完整应用路径。
        if (local !== null && localTrashed && local.contentHash === rn.contentHash && (local.updatedAt ?? "") >= (rn.updatedAt ?? "")) {
          db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          continue;
        }
        // 远端墓碑（删除压编辑）：本地无显式恢复 → 跟随删除
        if (local === null) {
          // 本地从未持有（全新设备/重装）：导入远端 trash 条目（先拉删除前内容再建回收站条目，内容可恢复）。
          const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
          if (contentBytes == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          if (!verifyNoteHash(contentBytes, rn)) continue;
          report.downloadedBytes += contentBytes.length;
          // 资产先下载（严格模式：缺失 → 跳过该条目，不导入半成品；对齐桌面 sync.ts:533-541）
          if (opts?.strictAssets) {
            try { await downloadAssets(cfg, s3, db, rn, report, true); }
            catch (e) { if (e instanceof AssetMissingError) { report.warnings.push(`资源缺失（跳过该条目）: ${rn.id}`); continue; } throw e; }
          }
          db.applyRemoteNote({ ...rn, parentId: TRASH_NOTEBOOK_ID, trashedAt: rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, deletedFromParentId: rn.deletedFromParentId ?? null, deleted: false, deletedAt: undefined }, decodeText(contentBytes));
          if (!opts?.strictAssets) await downloadAssets(cfg, s3, db, rn, report, false);
          db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
          report.trashedDown++; // 全新设备首次导入即入回收站（UI 移入回收站计数）
          continue;
        }
        // H5/回收站内编辑（对齐桌面 sync.ts:427-441 + S4）：仅当"本机编辑成果"被删除覆盖
        // 才强制留档 + 报 superseded——本地相对基线有改动，或本机上传过当前版本（本机是作者）。
        // 纯跟随删除传播（从未编辑/上传）→ 只移入回收站（或已在内），不留档不报。
        // 回收站内编辑（localTrashed=true 且内容被改）同样压制回删除前内容 + 留档（S4）。
        if (ownEditOf(local, rn.id)) {
          db.createHistorySnapshot(rn.id, contentOf(local), { title: local!.title, parentId: local!.parentId, sortOrder: local!.sortOrder });
          supersededTracker.push(rn.id, rn.title);
        }
        const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
        if (contentBytes == null) {
          report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
          continue;
        }
        if (!verifyNoteHash(contentBytes, rn)) continue;
        report.downloadedBytes += contentBytes.length;
        db.applyRemoteTrash(rn.id, decodeText(contentBytes), rn.title, rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, rn.deletedFromParentId ?? null, rn.parentId, rn.sortOrder);
        await downloadAssets(cfg, s3, db, rn, report, opts?.strictAssets ?? false);
        report.appliedRemote++;
        // UI 移入回收站计数：仅"本次新入回收站"（本地原先不在回收站）才计；已在回收站的重复应用不计
        if (!localTrashed) report.trashedDown++;
        // 本地已在回收站 → 一致，无操作
        continue;
      }

      if (localTrashed && !localRestoring) {
        // 本地在回收站、远端 active：时间比较决定胜负
        // - 远端 updatedAt 新于本地删除时间 → 远端恢复较新，跟随恢复
        // - 本地删除时间新于远端 → 本地删除压远端 active（删除压编辑），保留删除，步骤 3 上传墓碑
        const remoteNewer = (rn.updatedAt ?? "") > (local.trashedAt ?? "");
        if (remoteNewer) {
          const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
          if (contentBytes == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          if (!verifyNoteHash(contentBytes, rn)) continue;
          report.downloadedBytes += contentBytes.length;
          // 跟随恢复 = 应用远端 active（dbPort 清 trashed_at）+ 记账
          if (opts?.strictAssets) {
            try { await downloadAssets(cfg, s3, db, rn, report, true); }
            catch (e) { if (e instanceof AssetMissingError) { report.warnings.push(`资源缺失（跳过该条目）: ${rn.id}`); continue; } throw e; }
          }
          db.applyRemoteNote({ ...rn, parentId: effectiveParent, trashedAt: null, deleted: false, deletedAt: undefined, deletedFromParentId: null }, decodeText(contentBytes));
          if (!opts?.strictAssets) await downloadAssets(cfg, s3, db, rn, report, false);
          db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
        } else {
          db.log(`[tombstone] ${rn.id} 本地删除较新，保留删除（远端 active 让位），步骤 3 上传墓碑`);
        }
        continue;
      }

      // 正常对账（含本地显式恢复 restore_pending_at → local-wins 走上传）
      const base = db.getSyncBase(rn.id);
      const localHash = local ? (local.contentHash ?? sha256Sync(new TextEncoder().encode(local.content))) : null;
      // 幂等应用优化：本地内容与远端 hash 一致 → 仅对齐记账，不重复下载应用。
      // B3：但仍须对账元数据（标题/父/排序/图标/锁）——锁与元数据变更不改正文哈希，
      // 不能因哈希相等就跳过，否则远端锁/元数据状态永远下不来（对齐桌面 sync.ts:474-515）。
      if (localHash === rn.contentHash) {
        if (local) {
          // 锁 LWW：锁变更不改 updated_at，必须显式按字段比对
          const localLocked = local.isLocked;
          const remoteLocked = !!rn.isLocked;
          if (localLocked !== remoteLocked) {
            const merged = mergeLockState(localLocked, local.lockedAt ?? null, remoteLocked, rn.lockedAt ?? null);
            db.applyRemoteLock(rn.id, merged.locked, merged.at);
          }
          // 元数据 LWW（标题/父/排序/图标）：远端 updatedAt 新于本设备已确认版本 → 应用远端（先同步者胜）
          // 结构环检测（先提交先确认）：本地移动（local.parentId）若在远端树中位于本节点之下
          // （B 把 888 移入 999 下，而 A 已把 999 移入 888 下并提交）→ 保留本地会与远端成环，
          // 即使本地 updatedAt 较新也强制跟随远端打破环（对齐桌面 sync.ts:484-492）。
          const localParentConflicts =
            local.parentId !== null && local.parentId !== effectiveParent && isRemoteDescendant(local.parentId, rn.id, remoteParentMap);
          if (decideMetaApply(rn.updatedAt, base?.lastSyncedMetaAt ?? null) || localParentConflicts) {
            db.applyRemoteNoteMeta({ ...rn, parentId: effectiveParent });
          }
        }
        db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        continue;
      }
      const action = reconcileLakeNote({
        baseHash: base?.contentHash ?? null,
        localHash,
        remoteHash: rn.contentHash,
        lastUploadedHash: base?.lastUploadedHash ?? null,
        remoteUpdatedAt: rn.updatedAt,
        lastSyncedMetaAt: base?.lastSyncedMetaAt ?? null,
        localInTrash: localTrashed,
      });
      if (action.kind === "remote-wins") {
        const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
        if (contentBytes == null) {
          report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
          continue;
        }
        if (!verifyNoteHash(contentBytes, rn)) continue;
        report.downloadedBytes += contentBytes.length;
        // D5：本机编辑成果被远端覆盖 → 先强制留档（协议 §4.2，防丢数据），再接受远端
        if (action.superseded && local) {
          db.createHistorySnapshot(rn.id, contentOf(local), { title: local.title, parentId: local.parentId, sortOrder: local.sortOrder });
          supersededTracker.push(rn.id, rn.title);
        }
        if (opts?.strictAssets) {
          try { await downloadAssets(cfg, s3, db, rn, report, true); }
          catch (e) { if (e instanceof AssetMissingError) { report.warnings.push(`资源缺失（跳过该条目）: ${rn.id}`); continue; } throw e; }
        }
        db.applyRemoteNote({ ...rn, parentId: effectiveParent, trashedAt: null, deleted: false }, decodeText(contentBytes));
        if (!opts?.strictAssets) await downloadAssets(cfg, s3, db, rn, report, false);
        db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        report.appliedRemote++;
      }
      // local-wins 不在此入队：统一由步骤 3 decideUpload 决定（skip-fast 覆盖）
    }
  }

  // ---- 3. 上传方向：墓碑 / 恢复 / 正常（decideUpload） ----
  // 位置不变：必须在上传环开头重新取——这里看到的是下载合并后的状态（刚应用的笔记 syncState=synced），
  // 提前取会让它们被误判 upload 造成回环重传（P3-1 语义关键点）。
  const localAll = db.getAllNotes();
  // P3-1：远端条目索引一次建好——上传环与墓碑环节共用（原先各自 .find，O(N²)）。
  const remoteById = new Map((remote?.notes ?? []).map((n) => [n.id, n]));
  // B4：本地已 purge（收到他端删除后的保留副本）不上传——恢复 = 清 purged 后再上传（对齐桌面 sync.ts:641）。
  // 同时记录 purged id：发布 manifest 时从 notes 中移除（云端删除已完成，manifest 不再携带该条目，
  // 对齐桌面 sync.ts:630-632 跳过 + manifestNotes 只含非 purged）。
  const purgedIds = new Set(localAll.filter((n) => n.syncState === "purged").map((n) => n.id));
  for (const local of localAll) {
    if (local.syncState === "purged") continue;
    const rn = remoteById.get(local.id) ?? null;
    // 远端条目缺失（桶重置/被清空）→ 回退全量扫描：synced 笔记也强制读真实 hash 重传（对齐桌面 cachedBase 边界）
    let localHash = local.contentHash ?? sha256Sync(new TextEncoder().encode(local.content));
    if (rn === null && typeof db.forceHashRead === "function") {
      const real = db.forceHashRead(local.id);
      if (real != null) localHash = real;
    }
    const localTrashed = local.trashedAt != null;
    const localRestoring = local.restorePendingAt != null;
    const remoteTrashed = rn ? !!rn.trashedAt || !!rn.deleted : false;

    if (localTrashed && !localRestoring) {
      // 本地回收站（软删）→ 用 buildUploadEntry 编码：parentId=TRASH + trashedAt，**无 deleted:true**。
      // 与桌面一致——软删=移动到"回收站笔记本"，deleted:true 仅用于 purge 墓碑（红线 §3、踩坑 #4）。
      // 混用=普通删除被当永久删除，是 B1 致命 bug（当前改前实现就写 deleted:true）。
      if (rn && remoteTrashed) {
        db.log(`[tombstone] ${local.id} 两端一致（已删除），skip`);
        // 两端一致 skip：本机未上传该版本内容，lastUploadedHash 传 null 清除误标——
        // 否则跟随删除被 ownEdit 判定误认为"本机是作者"，每次同步重复留档 + superseded 提示（实机回归）。
        db.markLocalNoteSynced(local.id, rn.contentHash, local.updatedAt, null);
        continue;
      }
      db.log(`[tombstone] ${local.id} 上传软删条目（parentId=TRASH + trashedAt，非 deleted）`);
      // 回收站条目携带资源清单（对齐桌面：trash 上云带 assets，B 端下载全文+资源可恢复）
      let trashAssets: ManifestNote["assets"] = [];
      const uploadContent = contentOf(local);
      try {
        trashAssets = await resolveUploadAssets(local.id, uploadContent);
      } catch (e) {
        db.log(`[tombstone] ${local.id} 资源扫描失败（跳过）：${(e as Error).message}`);
      }
      const entry = buildUploadEntry({
        note: { id: local.id, title: local.title, parentId: TRASH_NOTEBOOK_ID, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon, trashedAt: local.trashedAt, deletedFromParentId: local.deletedFromParentId ?? null },
        contentHash: localHash,
        assets: trashAssets,
        trashedAt: local.trashedAt,
        deletedFromParentId: local.deletedFromParentId ?? null,
      });
      // P3-1：上传条目此刻才取正文（仅待上传的少数笔记产生 IO）
      uploadQueue.push({ id: local.id, content: uploadContent, entry });
      report.trashedUp++; // 本端软删发布（UI 移入回收站计数）
      continue;
    }

    // 正常（含恢复：restore_pending_at → active 上传覆盖墓碑）
    const base = db.getSyncBase(local.id);
    const decision = decideUpload({
      syncState: local.syncState,
      baseHash: base?.contentHash ?? null,
      remoteContentHash: rn?.contentHash ?? null,
      remoteDeleted: remoteTrashed,
    });
    if (decision === "upload") {
      db.log(`[decide] ${local.id} → upload（恢复=${localRestoring}）`);
      // H3：上传前扫描本地资产 → 上传 S3 → 填入 manifest.assets（供他端下载）
      let assets: ManifestNote["assets"] = [];
      const uploadContent = contentOf(local);
      try {
        assets = await resolveUploadAssets(local.id, uploadContent);
      } catch (e) {
        db.log(`[H3] 资产扫描失败（跳过，不影响正文上传）: ${(e as Error).message}`);
      }
      const entry = buildUploadEntry({
        note: { id: local.id, title: local.title, parentId: local.parentId, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon },
        contentHash: localHash,
        assets,
        // 恢复：显式清墓碑字段（覆盖远端墓碑 → local-wins）
        trashedAt: localRestoring ? null : undefined,
        deletedFromParentId: localRestoring ? null : undefined,
      });
      // P3-1：上传条目此刻才取正文（仅待上传的少数笔记产生 IO）
      uploadQueue.push({ id: local.id, content: uploadContent, entry });
    } else {
      db.log(`[decide] ${local.id} → ${decision}`);
    }
  }

  // 3.5 墓碑上传：本地已删除（deleted_notes）的笔记 → manifest 恒保留 deleted 标记（审计#2：防删除复活）。
  // 墓碑携带删除前内容（读本地 .lake 算真实 hash 上传，先内容后标志）；内容已物理删除（purge）→ 占位符 id。
  // folder/group 墓碑（nodeType='folder'）仅本地下载过滤，不进 manifest.notes（发布方向跳过，避免污染他端 deleted_notes）。
  // 墓碑 vs 远端恢复 LWW：远端已 active 且更新 → 墓碑让位（decideTombstoneYield）。
  const tombstonePublishedIds: string[] = [];
  {
    const localIds = new Set(localAll.map((n) => n.id));
    // P3-1：remoteById 复用上传环前建好的远端索引
    const deletedNotes = typeof db.listDeletedNotesForSync === "function" ? db.listDeletedNotesForSync() : [];
    for (const deleted of deletedNotes) {
      if (localIds.has(deleted.id)) continue;
      if (deleted.nodeType === "folder") continue;
      const remoteNote = remoteById.get(deleted.id);
      if (decideTombstoneYield(deleted.deletedAt, remoteNote)) {
        db.log(`[tombstone] ${deleted.id} 远端恢复较新，墓碑让位`);
        continue;
      }
      // 墓碑携带删除前内容：content 传真实内容 → 发布阶段上传对象（先内容后标志，其他设备可恢复删除前最新版）。
      // 修复（迁移回归）：内容缺失（purge 已物理删除 .lake，含 remembered 墓碑）此前直接 continue →
      // 墓碑永不发布、删除不传播、deleted_notes 永不标记已发布 → 待上传计数永远不降。现降级占位符 id 照常发布。
      const tombBase = { id: deleted.id, title: deleted.title ?? deleted.id, parentId: null, sortOrder: 0, updatedAt: deleted.deletedAt, deletedAt: deleted.deletedAt };
      let tombHash = deleted.id;
      let content = "";
      if (typeof db.readDeletedContent === "function") {
        const tombContent = await db.readDeletedContent(deleted.id);
        if (tombContent != null) {
          content = tombContent;
          tombHash = sha256Sync(new TextEncoder().encode(tombContent));
        }
      }
      uploadQueue.push({
        id: deleted.id,
        content,
        entry: buildTombstoneEntry(tombBase, tombHash),
        tombstone: true,
      });
      tombstonePublishedIds.push(deleted.id);
    }
  }

  // ---- 4. 上传对象（内容寻址幂等）+ 组装新 manifest ----
  progress("upload", `上传 ${uploadQueue.length} 条`);
  let next: Manifest | null = null;
  // 发布条件：有上传，或本地存在 purged 条目（须重写 manifest 移除该条目——云端删除已完成，
  // 对齐桌面"purged 不上传且 manifestNotes 不含 purged"的语义），
  // 或本地目录树有变更（回收站笔记本 / 移动 / 改名 / 图标——对齐桌面 sync.ts 每次同步无条件发布
  // manifest，folders 变更必须传播；迁移回归修复：否则删笔记本不传播 + 目录记账抹掉 local）。
  if (uploadQueue.length > 0 || purgedIds.size > 0 || foldersChanged) {
    for (const item of uploadQueue) {
      // 占位符墓碑（tombstone && content 为空，purge 已物理删除内容）：不重算 hash（保留占位符 id）、
      // 不传空对象（否则 contentHash 被覆盖成 sha256(空串) + 空对象残留——迁移回归），仅写 deleted 标记。
      if (item.tombstone && item.content === "") continue;
      const contentBytes = new TextEncoder().encode(item.content);
      const hash = sha256Sync(contentBytes);
      if (item.entry.contentHash !== hash) item.entry.contentHash = hash;
      await s3.putObject(`${cfg.prefix}/${objectKey(item.id, item.entry.contentHash)}`, item.content);
      report.uploaded++;
      report.uploadedBytes += contentBytes.length;
    }
    next = {
      version: 4,
      workspaceId: "default",
      commitId: randomUUID(),
      prevCommitId: remote?.commitId ?? null,
      createdAt: new Date().toISOString(),
      notes: [...(remote?.notes ?? [])],
      folders: remote?.folders ?? [],
    };
    // P3-1：id → 下标索引一次建好，替代逐项 findIndex（O(U×N) → O(N)）。
    // 语义与 findIndex 一致：同 id 后项覆盖前项写同一位置（uploadQueue 内 id 唯一）。
    const nextIndexById = new Map(next.notes.map((n, i) => [n.id, i] as const));
    for (const item of uploadQueue) {
      const idx = nextIndexById.get(item.id);
      if (idx !== undefined) next.notes[idx] = item.entry;
      else {
        nextIndexById.set(item.id, next.notes.length);
        next.notes.push(item.entry);
      }
    }
    // B4 修复：purged 条目（收到他端删除后本地保留的回收站副本）**不得**从 manifest 移除——
    // next.notes 继承 remote.notes，该条目必为 deleted:true（墓碑权威）；若被过滤掉，
    // 墓碑消失 → 离线第三端把残留当 active 上传 → 已删除内容复活（删除传播漏洞，双端复现）。
    // purged 不上传已由上传循环（syncState==='purged' continue）保证，manifest 保留墓碑即可。
    // M6：manifest 排序（notes 按 sortOrder，对齐桌面 sync.ts:733）+ 目录树发布
    // （folders 从本地发布，对齐桌面 listFoldersForSync；端口未实现则保持远端透传）。
    next.notes.sort((a, b) => a.sortOrder - b.sortOrder);
    if (typeof db.listFoldersForSync === "function") {
      const localFolders = db.listFoldersForSync();
      // 空数组也必须覆盖（≠ null）：本地树为空（如 purge 清空全部目录）时，next.folders 必须清空
      // 移除云端残留（否则远端 folders 残留被保留，下轮同步重新导入 → "清空回收站后同步 → 被删的又回来"）。
      // 仅 null（端口未实现目录发布）才保持远端透传。
      if (localFolders !== null && localFolders !== undefined) {
        next.folders = localFolders.map((f) => ({
          id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType as "notebook" | "group",
          icon: f.icon, updatedAt: f.updatedAt,
          trashedAt: f.trashedAt ?? undefined,
          deletedFromParentId: f.deletedFromParentId ?? undefined,
        }));
      }
    }

    // ---- 5. 发布：commit（简化，仅 latest）+ latest ----
    const manifestJson = JSON.stringify(next);
    await s3.putObject(`${cfg.prefix}/manifests/${next.commitId}.json`, manifestJson, { gzip: true });
    await s3.putObject(`${cfg.prefix}/${MANIFEST_KEY}`, manifestJson, { gzip: true });
    report.uploadedBytes += manifestJson.length * 2;
    report.published = true;
    // 墓碑已发布 → 标记 published_at（从待上传计数移除；墓碑本体保留防删除标记丢失，审计 #2）
    if (tombstonePublishedIds.length > 0 && typeof db.markTombstonesPublished === "function") {
      db.markTombstonesPublished(tombstonePublishedIds);
    }
    // 桌面 GC 差集标记钩子（4.5）：发布后暴露 next/prev，桌面 Controller 算待回收引用
    try { await opts?.onPublished?.(next, remote); } catch { /* 钩子失败不阻断 */ }
    progress("publish", `发布 manifest（应用 ${report.appliedRemote}，上传 ${report.uploaded}）`);

    // ---- 6. 记账（B2 快照保护：同步期间被编辑则不标，等下轮重传） ----
    for (const item of uploadQueue) {
      // 软删（trashedAt）/墓碑（deleted）条目本机未上传新正文：不写 lastUploadedHash，
      // 否则误标"本机是作者"→ 后续 ownEdit 判定恒成立、每次同步重复留档（对齐旧 sync.ts locallyUploadedIds）。
      const lastUploaded = item.entry.trashedAt || item.entry.deleted ? null : item.entry.contentHash;
      db.markSyncedIfUnchanged(item.id, item.entry.contentHash, item.entry.updatedAt, lastUploaded);
    }
  } else {
    // 无上传：把已应用/对账的条目记账（对账收尾）。
    // 只标记"本地仍有、非 purge、远端非墓碑"的 active 条目——purge 墓碑与 remembered 删除
    // 不得被重标 synced（B4：否则本地 purge 后的保留副本被误当正常上传、删除复活）。
    // P3-1：复用 localAll（下载环之后取、墓碑环节只读文件不写 notes 表，仍新鲜）建索引，
    // 替代每条远端笔记一次 getNote（原先 = 2N 次全表 SQL + N 次全文读盘，空闲同步最热路径）。
    const localAfterById = new Map(localAll.map((n) => [n.id, n]));
    for (const rn of remote?.notes ?? []) {
      if (rn.deleted) continue;
      const loc = localAfterById.get(rn.id);
      if (!loc || loc.syncState === "purged") continue;
      // 下载对账收尾：lastUploadedHash 传 null——本机未上传该版本（下载的远端笔记不得误标"本机是作者"，对齐桌面语义）
      db.markSyncedIfUnchanged(rn.id, rn.contentHash, rn.updatedAt, null);
    }
  }

  // 目录记账（对齐桌面 sync.ts:789-793）：latest 发布成功后，用构建 manifest 时的 updatedAt 快照
  // 归位 folders——同步期间本地再改 group 则 updated_at 变化 → 不归位，保持 local 下轮重传。
  if (typeof db.markFolderSynced === "function" && typeof db.listFoldersForSync === "function") {
    try {
      for (const f of db.listFoldersForSync() ?? []) {
        db.markFolderSynced(f.id, f.updatedAt);
      }
    } catch { /* 目录记账失败不阻断 */ }
  }

  // 零变更早退的基线：记录本次成功读/写的 commitId 与墓碑签名（对齐桌面 sync.ts:827-828）。
  // 有发布 → 新 commitId；仅拉取对账 → 远端 latest 的 commitId（下次无变化时即可早退）。
  const finalCommitId = next?.commitId ?? remote?.commitId ?? null;
  if (finalCommitId != null) {
    db.setLastSeenCommitId(finalCommitId);
    db.setLastTombstoneSig(db.tombstoneSignature());
  }
  report.supersededNotes = supersededTracker.list();

  const warnSuffix = report.warnings.length > 0 ? `，警告 ${report.warnings.length}` : "";
  report.message = `拉取 ${remote ? remote.notes.length : 0} 条，应用 ${report.appliedRemote}，上传 ${report.uploaded}，发布 ${report.published ? "是" : "否"}${warnSuffix}`;
  return report;
}