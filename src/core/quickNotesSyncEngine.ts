/**
 * Quick Notes 独立同步引擎（lake-core）。
 *
 * 由桌面 electron/quickNotesSync.ts 的编排下沉而来（行为等价，V5 Step 6）：
 * - 决策纯函数（reconcileQuickNote / decideUpload / 清单校验）与存储端口分离；
 * - 通过 S3Store + QuickNotesSyncDbPort 端口实现环境无关，桌面（node fs + sqlite）
 *   与移动端（native SQLite 单库）共用同一编排；
 * - 协议与 Lake 笔记一致但完全独立：manifest 与对象均在 quick-notes/ 子空间，
 *   不读取/修改 Lake manifest v2（相同 S3 配置下仅共享 bucket/prefix）。
 *
 * 语义（与桌面既有行为逐条对齐，测试 electron/quickNotesSync.test.ts 兜底）：
 * - 墓碑权威：远端 deleted 压本地编辑（唯一例外 restore_pending → local wins 回写 active）；
 * - 墓碑携带删除前内容：先拉删除前对象再软删，回收站/恢复拿到删除方最新版；
 * - 恢复 LWW：远端 active 且 updatedAt 晚于本地墓碑 → 撤销本地墓碑跟随恢复；
 * - 冲突（双端都改）：远端覆盖本地，本地版本归档进回收站（新 id）；
 * - 小记不备份：删除压编辑时本地未同步编辑不留档（与 Lake 的 superseded 留档不同）；
 * - 增量快路径：synced 且远端 hash 与本地基线一致 → 不读本地内容直接复用远端 assets。
 */
import { sha256Sync } from "./sha256Sync.js";
import { decideUpload } from "./decideUpload.js";
import { reconcileQuickNote } from "./quickNoteReconcile.js";
import { mimeTypeFor } from "./syncUtils.js";
import type { ManifestItem, QuickNotesManifest } from "./manifestTypes.js";
import { runAsyncPool, ASSET_TRANSFER_CONCURRENCY } from "./asyncPool.js";
import type { S3Store, SyncConfig } from "./syncEngine.js";

const MANIFEST_VERSION = 1;
const ROOT = "quick-notes";

/** 小记清单护栏（W-13）：字节/条目上限防异常清单打爆同步。 */
export const MAX_QUICK_MANIFEST_BYTES = 10 * 1024 * 1024;
/** V5 §5.6：小记正文单对象上限（投毒防护）。 */
export const MAX_QUICK_NOTE_BYTES = 64 * 1024 * 1024;
export const MAX_QUICK_MANIFEST_ITEMS = 100_000;

export interface QuickNotesSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
}

export interface QuickNotesSyncProgress {
  phase: "quick-notes";
  /** 主循环进度：小记条目 */
  current?: number;
  total?: number;
  /** 小记图片子进度 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
}

export interface QuickNoteSyncItemImage {
  id: string; filename: string; mimeType: string;
  width: number | null; height: number | null; size: number; hash: string;
}

/** 本地小记条目（同步所需子集）。 */
export interface QuickNoteSyncItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  syncState: string;
  isConflict: boolean;
  /** 图片元数据（正文中同款信息；manifest assets 直接映射） */
  images: QuickNoteSyncItemImage[];
}

/**
 * Quick Notes 本地存储端口（平台注入）。
 * 桌面：QuickNotesStore（node sqlite + .qnote 文件）；移动端：native SQLite quick_notes 表 + 内容列。
 */
export interface QuickNotesSyncDbPort {
  listLocalQuickNotes(): Promise<QuickNoteSyncItem[]>;
  /** 本地内容字节（桌面 .qnote 文件 / 移动端 content 列序列化字节）；缺失 → null。 */
  readContent(id: string): Promise<Uint8Array | null>;
  /** 本地图片字节（上传/校验用）；缺失 → null。 */
  readAsset(id: string, filename: string): Promise<Uint8Array | null>;
  /** 应用远端小记（新/覆盖）：写入内容 + 图片 + DB 行。 */
  applyRemoteQuickNote(item: ManifestItem, content: Uint8Array, assets: Array<{ filename: string; bytes: Uint8Array }>): Promise<void>;
  /** 墓碑内容落地（先内容后标志）：把删除方内容写入本地存储，随后 deleteLocalQuickNote。 */
  applyTombstoneContent(id: string, content: Uint8Array): Promise<void>;
  /** 墓碑携带图片（A）：读取删除小记保留内容中的删除前图片元数据；无保留内容/解析失败 → []。 */
  listDeletedQuickNoteAssets(id: string): Promise<QuickNoteSyncItemImage[]>;
  /** 墓碑携带图片（A）：把删除方上传的删除前图片字节写入本地（软删行保留，恢复时图片完整）。 */
  applyTombstoneAssets(id: string, assets: Array<{ metadata: QuickNoteSyncItemImage; bytes: Uint8Array }>): Promise<void>;
  /** 本地软删（保留内容供墓碑携带）。 */
  deleteLocalQuickNote(id: string): Promise<void>;
  /** 冲突：本地版本归档进回收站（新 id），随后 applyRemoteQuickNote 覆盖原 id。 */
  archiveLocalQuickNoteToTrash(id: string): Promise<void>;
  /** 本地删除墓碑（软删/从远端学到的删除）；manifest 墓碑条目需要 createdAt/updatedAt。 */
  listDeletedQuickNotes(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>;
  /** 全部墓碑记录（含已发布 ready=0）：下载方向 LWW（墓碑 vs 远端恢复）需要完整历史才能撤销/跟随恢复。
   * 缺失则回退 listDeletedQuickNotes（仅 ready=1，已发布墓碑会失去恢复跟随能力）。 */
  listAllDeletedQuickNotes?(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>;
  /** 墓碑已发布到 manifest 后清除待同步标记（ready_to_sync=0）——缺失则待同步计数永不归零（对齐 Lake markTombstonesPublished）。 */
  markDeletedPublished?(ids: string[]): Promise<void>;
  /** 转换延迟删除（Lake 放行前不删云端源；移动端无转换场景可不实现 → 返回 []）。 */
  listDeferredDeletedQuickNotes(): Promise<Array<{ id: string }>>;
  rememberDeletedQuickNote(item: { id: string; createdAt: string; updatedAt: string; deletedAt: string }): Promise<void>;
  revokeLocalDeletion(id: string): Promise<void>;
  isRestorePending(id: string): Promise<boolean>;
  baseHash(id: string): Promise<string | null>;
  setBaseHash(id: string, contentHash: string): Promise<void>;
  markSynced(id: string): Promise<void>;
  /**
   * 记账快照保护（I2，见 core/maintenancePolicy）：仅当本地当前内容 hash 仍等于 expectedContentHash
   * （= 同步期间未被编辑）才标 synced；否则保持 local，下轮重传。
   *
   * 为什么必须有：把"本地写"移出维护队列后，小记编辑可以与同步并发；
   * 而 markSynced 无"未变才标"守卫 ⇒ 会上传旧内容却把新内容标成已同步（丢编辑）。
   * 对齐 Lake 侧既有的 markSyncedIfUnchanged（V5 §5.2）。
   * 缺失时引擎退回 markSynced（调用方必须以串行队列保证无并发编辑，如桌面）。
   */
  markSyncedIfUnchanged?(id: string, expectedContentHash: string): Promise<void>;
  log(message: string): void;
}

/** 兼容 Web/Node 的 UUID（移动端 WebView 也提供 crypto.randomUUID；兜底同 syncEngine）。 */
/** 标记已同步：优先"未变才标"守卫（I2）；端口未实现时退回朴素 markSynced（见接口注释）。 */
export async function markSyncedGuarded(qn: QuickNotesSyncDbPort, id: string, expectedContentHash: string): Promise<void> {
  if (typeof qn.markSyncedIfUnchanged === "function") {
    await qn.markSyncedIfUnchanged(id, expectedContentHash);
    return;
  }
  await qn.markSynced(id);
}

export function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 小记清单护栏解析（与 Lake parseLakeManifest 同构，W-13）。 */
export function parseManifest(
  bytes: Uint8Array,
  limits: { maxBytes?: number; maxItems?: number } = {},
): QuickNotesManifest {
  const maxBytes = limits.maxBytes ?? MAX_QUICK_MANIFEST_BYTES;
  if (bytes.length > maxBytes) {
    throw new Error(`小记同步清单过大（${bytes.length} 字节 > ${maxBytes}），拒绝加载`);
  }
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("小记同步清单不是合法 JSON"); }
  if (!manifest || typeof manifest !== "object") throw new Error("小记同步清单格式无效");
  const value = manifest as Partial<QuickNotesManifest>;
  if (value.version !== MANIFEST_VERSION || typeof value.workspaceId !== "string" || typeof value.commitId !== "string" || typeof value.createdAt !== "string" || !Array.isArray(value.items)) {
    throw new Error("小记同步清单版本或字段不兼容");
  }
  if (value.items.length > (limits.maxItems ?? MAX_QUICK_MANIFEST_ITEMS)) {
    throw new Error(`小记同步清单条目过多（${value.items.length}），拒绝加载`);
  }
  const ids = new Set<string>();
  for (const item of value.items) {
    validateRemoteItem(item as ManifestItem);
    if (ids.has(item.id)) throw new Error(`小记同步清单包含重复条目: ${item.id}`);
    ids.add(item.id);
  }
  return value as QuickNotesManifest;
}

function validateRemoteItem(item: ManifestItem): void {
  if (!item || typeof item !== "object" || !isSafeSegment(item.id) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.contentHash !== "string" || (item.deleted !== true && !/^[a-f0-9]{64}$/.test(item.contentHash)) || typeof item.isConflict !== "boolean" || !Array.isArray(item.assets)) {
    throw new Error("小记同步清单条目无效");
  }
  if (item.deleted !== undefined && typeof item.deleted !== "boolean") throw new Error("小记删除标记无效");
  if (item.deletedAt !== undefined && typeof item.deletedAt !== "string") throw new Error("小记删除时间无效");
  for (const asset of item.assets) {
    if (!asset || typeof asset !== "object" || !isSafeSegment(asset.id) || !isSafeSegment(asset.filename) || typeof asset.mimeType !== "string" || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || typeof asset.hash !== "string" || !/^[a-f0-9]{64}$/.test(asset.hash)) {
      throw new Error(`小记同步清单图片无效: ${item.id}`);
    }
    if (asset.width !== null && (!Number.isInteger(asset.width) || asset.width <= 0)) throw new Error(`小记图片宽度无效: ${item.id}/${asset.filename}`);
    if (asset.height !== null && (!Number.isInteger(asset.height) || asset.height <= 0)) throw new Error(`小记图片高度无效: ${item.id}/${asset.filename}`);
  }
}

function isSafeSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}

async function downloadAssets(
  s3: S3Store,
  assetKey: (id: string, filename: string) => string,
  item: ManifestItem,
  onProgress?: (assetCurrent: number, assetTotal: number) => void,
): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  let done = 0;
  const assets = await runAsyncPool(item.assets, ASSET_TRANSFER_CONCURRENCY, async (asset) => {
    onProgress?.(++done, item.assets.length);
    const bytes = await s3.getObject(assetKey(item.id, asset.filename));
    if (!bytes) throw new Error(`小记清单引用的图片不存在: ${item.id}/${asset.filename}`);
    if (bytes.length !== asset.size || sha256Sync(bytes) !== asset.hash) throw new Error(`小记图片校验失败: ${item.id}/${asset.filename}`);
    return { filename: asset.filename, bytes };
  });
  return assets;
}

export interface QuickNotesSyncOptions {
  /** 进度上报（桌面 UI 用；移动端可不传）。 */
  onProgress?: (progress: QuickNotesSyncProgress) => void;
}

/**
 * Quick Notes 子空间同步主流程（与桌面 syncQuickNotes 行为等价）。
 * 拉取对账（含墓碑权威/恢复 LWW/内容携带）→ 上传发布（含墓碑/延迟删除/清单写入）→ 记账。
 */
export async function syncQuickNotesViaEngine(
  cfg: SyncConfig,
  s3: S3Store,
  qn: QuickNotesSyncDbPort,
  opts?: QuickNotesSyncOptions,
): Promise<QuickNotesSyncResult> {
  const report = (progress: QuickNotesSyncProgress) => { try { opts?.onProgress?.(progress); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "quick-notes", message: "正在同步小记…" });
  const quickStart = Date.now();
  qn.log("[perf] quick-sync start");

  const objectKey = (contentHash: string) => `${cfg.prefix}/${ROOT}/objects/${contentHash}.qnote`;
  const assetKey = (id: string, filename: string) => `${cfg.prefix}/${ROOT}/assets/${id}/${filename}`;
  const manifestKey = `${cfg.prefix}/${ROOT}/manifests/latest.json`;

  const rawManifest = await s3.getObject(manifestKey, { maxBytes: MAX_QUICK_MANIFEST_BYTES });
  let remoteManifest: QuickNotesManifest | null = null;
  if (rawManifest) {
    try {
      remoteManifest = parseManifest(rawManifest);
    } catch (reason) {
      // 清单解析失败（含重复 ID 拒绝）属云端数据异常：记录日志后中止本轮同步，不做静默降级
      qn.log(`[download] 小记清单解析失败，放弃本轮同步: ${(reason as Error).message}`);
      throw reason;
    }
  }
  let downloaded = 0;
  let conflicts = 0;

  if (remoteManifest) {
    // 转换墓碑（Lake 放行前）恒不复活源小记；普通删除墓碑按 LWW（远端恢复较新时撤销本地墓碑并跟随恢复）。
    // 下载方向必须看**全部**墓碑（含已发布 ready=0）：否则已发布墓碑丢失 LWW 上下文，
    // 远端恢复后本机永远无法跟随恢复（对齐 Lake：published_at 只是记账，记录保留供判定）。
    const tombstoneRows = await (qn.listAllDeletedQuickNotes?.() ?? qn.listDeletedQuickNotes());
    const tombstoned = new Map(tombstoneRows.map((item) => [item.id, item.deletedAt] as const));
    const deferredDeletedRows = await qn.listDeferredDeletedQuickNotes();
    const deferredDeletedIds = new Set(deferredDeletedRows.map((item) => item.id));
    const localItems = await qn.listLocalQuickNotes();
    const localById = new Map(localItems.map((item) => [item.id, item]));
    const localIds = new Set(localItems.map((item) => item.id));

    for (let index = 0; index < remoteManifest.items.length; index += 1) {
      const item = remoteManifest.items[index];
      const itemStart = Date.now();
      report({ phase: "quick-notes", current: index + 1, total: remoteManifest.items.length, message: item.deleted ? "处理云端小记删除记录" : "检查云端小记" });
      validateRemoteItem(item);

      if (item.deleted) {
        if (localIds.has(item.id)) {
          // 墓碑权威（与 Lake 一致）：远端 deleted 是权威状态，本地编辑（无论新旧）都不抵抗；
          // 唯一例外是显式恢复标记（restoreQuickNote 写入）→ local wins，上传阶段写回 active 覆盖墓碑。
          if (await qn.isRestorePending(item.id)) {
            qn.log(`[perf] download ${item.id} tombstone-skip (restore pending) ${Date.now() - itemStart}ms`);
            continue;
          }
          // 墓碑权威：先尝试下载删除前内容（墓碑 contentHash，容错：占位符/缺失则跳过）覆盖本地
          // .qnote，再软删——回收站/恢复拿到的是删除方最新版。小记不备份本地版本（云端为主）。
          try {
            const content = await s3.getObject(objectKey(item.contentHash), { maxBytes: MAX_QUICK_NOTE_BYTES });
            if (content) {
              await qn.applyTombstoneContent(item.id, content);
            }
          } catch (error) {
            qn.log(`[download] ${item.id} 删除前内容缺失，跳过`);
          }
          // 墓碑携带图片（A）：删除方上传的删除前图片也落地，恢复时图片完整。
          // 资源缺失/校验失败走 best-effort（跳过该条图片 + 日志），不拖垮删除传播（老墓碑 assets:[] 天然兼容）。
          if (item.assets.length > 0) {
            const tombAssets: Array<{ metadata: (typeof item.assets)[number]; bytes: Uint8Array }> = [];
            for (const asset of item.assets) {
              try {
                const bytes = await s3.getObject(assetKey(item.id, asset.filename));
                if (!bytes) { qn.log(`[download] ${item.id} 墓碑图片 ${asset.filename} 缺失，跳过`); continue; }
                if (bytes.length !== asset.size || sha256Sync(bytes) !== asset.hash) { qn.log(`[download] ${item.id} 墓碑图片 ${asset.filename} 校验失败，跳过`); continue; }
                tombAssets.push({ metadata: asset, bytes });
              } catch (error) { qn.log(`[download] ${item.id} 墓碑图片 ${asset.filename} 下载失败，跳过`); }
            }
            if (tombAssets.length > 0) await qn.applyTombstoneAssets(item.id, tombAssets);
          }
          await qn.deleteLocalQuickNote(item.id);
        } else {
          await qn.rememberDeletedQuickNote({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, deletedAt: item.deletedAt ?? new Date().toISOString() });
        }
        qn.log(`[perf] download ${item.id} deleted ${Date.now() - itemStart}ms`);
        continue;
      }
      if (deferredDeletedIds.has(item.id)) continue;
      // 本地删除墓碑 vs 远端恢复 LWW：远端 active 且 updatedAt 晚于本地墓碑删除时间 →
      // 恢复较新，撤销本地墓碑并跟随恢复；否则本地删除优先，跳过下载（上传阶段会标记 deleted）。
      const tombAt = tombstoned.get(item.id);
      if (tombAt !== undefined) {
        if (item.updatedAt > tombAt) {
          await qn.revokeLocalDeletion(item.id);
          qn.log(`[perf] download ${item.id} remote-restored → local tombstone revoked ${Date.now() - itemStart}ms`);
        } else {
          continue;
        }
      }

      const local = localById.get(item.id) ?? null;
      if (local?.contentHash === item.contentHash) {
        await qn.setBaseHash(item.id, item.contentHash);
        await markSyncedGuarded(qn, item.id, item.contentHash);
        qn.log(`[perf] download ${item.id} unchanged ${Date.now() - itemStart}ms`);
        continue;
      }

      const content = await s3.getObject(objectKey(item.contentHash), { maxBytes: MAX_QUICK_NOTE_BYTES });
      if (!content) {
        // V5 §5.5 B 方案：小记内容对象缺失 → 跳过该条目 + 日志，不覆盖本地（本地优先，下轮重试）
        qn.log(`[download] ${item.id} 远端小记内容缺失，跳过（本地不覆盖）`);
        continue;
      }
      if (sha256Sync(content) !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      const assets = await downloadAssets(s3, assetKey, item, (assetCurrent, assetTotal) => {
        report({ phase: "quick-notes", current: index + 1, total: remoteManifest.items.length, assetCurrent, assetTotal, message: "检查云端小记" });
      });
      // 决策收敛到纯函数 reconcileQuickNote：正文相同（local.contentHash===item.contentHash）已走 unchanged 分支。
      const action = reconcileQuickNote({
        baseHash: await qn.baseHash(item.id),
        localHash: local !== null ? local.contentHash : null,
        remoteHash: item.contentHash,
      });
      if (action.kind === "conflict") {
        // 验收 #4（B 方案）：双端都改 → 远端覆盖本地；本地版本归档进回收站（新 id，恢复后为一条新小记）。
        await qn.archiveLocalQuickNoteToTrash(item.id);
        await qn.applyRemoteQuickNote(item, content, assets);
        await qn.setBaseHash(item.id, item.contentHash);
        conflicts += 1;
        downloaded += 1;
        qn.log(`[perf] download ${item.id} conflict → remote wins, local archived to trash ${Date.now() - itemStart}ms (content=${content.length}B, assets=${assets.length})`);
      } else if (action.kind === "local-wins") {
        // 只在本地变更：上传阶段将其作为权威版本，不以下载覆盖。
        continue;
      } else {
        await qn.applyRemoteQuickNote(item, content, assets);
        await qn.setBaseHash(item.id, item.contentHash);
        downloaded += 1;
        qn.log(`[perf] download ${item.id} new-content ${Date.now() - itemStart}ms (content=${content.length}B, assets=${assets.length})`);
      }
    }
  }
  qn.log(`[perf] quick download phase ${Date.now() - quickStart}ms (downloaded=${downloaded}, conflicts=${conflicts})`);

  const localItems = await qn.listLocalQuickNotes();
  const remoteItemsById = new Map((remoteManifest?.items ?? []).map((item) => [item.id, item]));
  const remoteHashes = new Map<string, string>((remoteManifest?.items ?? []).filter((item) => !item.deleted).map((item) => [item.id, item.contentHash]));
  const remoteAssetHashes = new Map<string, string>();
  for (const item of remoteManifest?.items ?? []) {
    if (item.deleted) continue;
    for (const asset of item.assets) remoteAssetHashes.set(`${item.id}/${asset.filename}`, asset.hash);
  }

  const uploadStart = Date.now();
  let uploaded = 0;
  const manifestItems: ManifestItem[] = [];
  for (let index = 0; index < localItems.length; index += 1) {
    const item = localItems[index];
    const itemUploadStart = Date.now();
    report({ phase: "quick-notes", current: index + 1, total: localItems.length, message: "上传本地小记" });
    // 增量扫描优化（与 Lake 一致）：synced 且远端条目 hash 与本地索引一致 → 跳过内容/图片读取，
    // 复用远端 assets（正文未变 ⇒ 图片引用未变）。非 synced 路径保留"索引与内容不一致则抛错"完整性校验。
    const remoteEntry = remoteItemsById.get(item.id);
    if (decideUpload({
      syncState: item.syncState,
      // synced 条目 base 与 contentHash 已对齐（上传完成时 setBaseHash）；快路径判定以此代替读盘。
      baseHash: item.contentHash,
      remoteContentHash: remoteEntry !== undefined && !remoteEntry.deleted ? remoteEntry.contentHash : null,
      remoteDeleted: remoteEntry?.deleted ?? false,
    }) === "skip-fast") {
      // skip-fast 保证远端条目存在且未删除（decideUpload 输入映射等价于原条件）
      const entry = remoteEntry!;
      manifestItems.push({
        id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
        contentHash: item.contentHash, isConflict: item.isConflict, assets: entry.assets ?? [],
      });
      continue;
    }
    const content = await qn.readContent(item.id);
    if (content === null) throw new Error(`本地小记内容读取失败: ${item.id}`);
    const contentHash = sha256Sync(content);
    if (contentHash !== item.contentHash) throw new Error(`本地小记索引与内容不一致: ${item.id}`);

    const assets = item.images.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash }));
    const pendingAssets: Array<{ filename: string; bytes: Uint8Array; mimeType: string }> = [];
    for (const asset of assets) {
      const bytes = await qn.readAsset(item.id, asset.filename);
      if (bytes === null) throw new Error(`本地小记图片缺失: ${item.id}/${asset.filename}`);
      if (bytes.length !== asset.size || sha256Sync(bytes) !== asset.hash) throw new Error(`本地小记图片校验失败: ${item.id}/${asset.filename}`);
      if (remoteAssetHashes.get(`${item.id}/${asset.filename}`) !== asset.hash) {
        pendingAssets.push({ filename: asset.filename, bytes, mimeType: asset.mimeType || mimeTypeFor(asset.filename) });
      }
    }
    let uploadDone = 0;
    await runAsyncPool(pendingAssets, ASSET_TRANSFER_CONCURRENCY, async (pending) => {
      report({ phase: "quick-notes", current: index + 1, total: localItems.length, assetCurrent: ++uploadDone, assetTotal: pendingAssets.length, message: "上传本地小记" });
      await s3.putObject(assetKey(item.id, pending.filename), pending.bytes);
    });
    let contentUploaded = false;
    if (remoteHashes.get(item.id) !== contentHash) {
      await s3.putObject(objectKey(contentHash), content);
      uploaded += 1;
      contentUploaded = true;
    }
    manifestItems.push({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash, isConflict: item.isConflict, assets });
    qn.log(`[perf] upload ${item.id} ${Date.now() - itemUploadStart}ms (content=${contentUploaded ? `${content.length}B` : "skip"}, assets=${pendingAssets.length})`);
  }
  qn.log(`[perf] quick upload phase ${Date.now() - uploadStart}ms (uploaded=${uploaded})`);

  const localIds = new Set(localItems.map((item) => item.id));
  const readyDeleted = await qn.listDeletedQuickNotes();
  const readyDeletedIds = new Set(readyDeleted.map((item) => item.id));
  const remoteById = new Map((remoteManifest?.items ?? []).map((item) => [item.id, item]));
  const publishedDeletedIds: string[] = [];
  for (const deleted of readyDeleted) {
    if (localIds.has(deleted.id)) continue;
    // 墓碑 vs 远端恢复 LWW：远端 active 且 updatedAt 晚于墓碑删除时间 → 恢复较新，墓碑让位（不回写覆盖）。
    const remoteItem = remoteById.get(deleted.id);
    if (remoteItem && !remoteItem.deleted && remoteItem.updatedAt > deleted.deletedAt) continue;
    // 墓碑携带删除前内容（与 Lake 一致）：读保留的内容算真实 hash 并上传，
    // 使其他设备先拉到"删除前最新版"再应用墓碑。读失败降级为占位符 id。
    let tombHash = deleted.id;
    try {
      const content = await qn.readContent(deleted.id);
      if (content) {
        tombHash = sha256Sync(content);
        await s3.putObject(objectKey(tombHash), content);
      }
    } catch (error) {
      qn.log(`[perf] upload ${deleted.id} tombstone content unreadable, placeholder fallback`);
    }
    // 墓碑携带图片（A）：删除方把删除前图片对象也上传（缺失才传？此处直接幂等覆盖），
    // 墓碑条目带 assets，使其他端恢复时图片完整。无保留内容/无图 → assets: []（旧协议兼容）。
    const tombAssetMetadata = await qn.listDeletedQuickNoteAssets(deleted.id);
    const tombAssets: ManifestItem["assets"] = [];
    for (const asset of tombAssetMetadata) {
      try {
        const bytes = await qn.readAsset(deleted.id, asset.filename);
        if (!bytes || bytes.length !== asset.size || sha256Sync(bytes) !== asset.hash) continue;
        await s3.putObject(assetKey(deleted.id, asset.filename), bytes);
        tombAssets.push(asset);
      } catch (error) {
        qn.log(`[perf] upload ${deleted.id} tombstone asset ${asset.filename} unreadable, skip`);
      }
    }
    manifestItems.push({
      id: deleted.id,
      createdAt: deleted.createdAt,
      updatedAt: deleted.updatedAt,
      contentHash: tombHash,
      isConflict: false,
      assets: tombAssets,
      deleted: true,
      deletedAt: deleted.deletedAt,
    });
    publishedDeletedIds.push(deleted.id);
  }

  // 转换源小记在 Lake 目标文档成功前仍由其远端记录表示；此处省略会在 Lake 跨空间安全条件
  // 满足前意外发布"删除源"的 manifest。
  const deferredDeletedRows = await qn.listDeferredDeletedQuickNotes();
  const deferredDeletedIds = new Set(deferredDeletedRows.map((item) => item.id));
  for (const item of remoteManifest?.items ?? []) {
    if (!item.deleted && deferredDeletedIds.has(item.id) && !localIds.has(item.id) && !readyDeletedIds.has(item.id)) {
      manifestItems.push(item);
    }
  }

  // P1-1（审计）：远端 active 但本地本轮未持有（正文对象缺失被下载阶段跳过）的条目必须原样保留，
  // 否则新 manifest 不再包含它 → "对象暂时缺失、等待重试"被升级为"manifest 删除"，其他设备会误删。
  // 保留后下轮重试下载；墓碑（readyDeleted）与转换延迟删除（deferredDeletedIds）各自已有路径，排除。
  for (const item of remoteManifest?.items ?? []) {
    if (item.deleted) continue;
    if (localIds.has(item.id)) continue;
    if (deferredDeletedIds.has(item.id)) continue;
    if (readyDeletedIds.has(item.id)) continue;
    manifestItems.push(item);
    qn.log(`[perf] publish ${item.id} preserved (remote content missing this round, retry next sync)`);
  }

  const completedAt = new Date().toISOString();
  const manifest: QuickNotesManifest = {
    version: MANIFEST_VERSION,
    workspaceId: "default",
    commitId: randomUUID(),
    createdAt: completedAt,
    items: manifestItems,
  };
  report({ phase: "quick-notes", message: "写入小记同步清单…" });
  const manifestStart = Date.now();
  await s3.putObject(manifestKey, `${JSON.stringify(manifest, null, 2)}\n`, { gzip: true });
  qn.log(`[perf] quick manifest ${manifest.commitId} ${Date.now() - manifestStart}ms (items=${manifestItems.length})`);

  // 墓碑已发布 → 清除待同步标记（对齐 Lake markTombstonesPublished）。缺失此调用会导致
  // getPendingSyncSummary 的墓碑计数永不归零（"待同步"常挂）+ 每轮重复上传墓碑对象。
  if (publishedDeletedIds.length > 0 && typeof qn.markDeletedPublished === "function") {
    await qn.markDeletedPublished(publishedDeletedIds);
  }

  for (const item of localItems) {
    await qn.setBaseHash(item.id, item.contentHash);
    await markSyncedGuarded(qn, item.id, item.contentHash);
  }
  qn.log(`[perf] quick-sync done ${Date.now() - quickStart}ms (uploaded=${uploaded}, downloaded=${downloaded}, conflicts=${conflicts})`);
  return { uploaded, downloaded, conflicts, manifestId: manifest.commitId, completedAt };
}
