/**
 * 同步编排引擎（lake-core 共享层，V5 §13 高优先 TODO 落地）。
 *
 * 决策机制（reconcileLakeNote/decideUpload/mergeLockState）与执行编排在此统一：
 * 桌面（electron/sync.ts 收敛）+ 移动端（Capacitor）共用同一实现，
 * 平台差异全部经端口注入：
 * - S3Store：对象读写（桌面=ObjectStore，移动端=CapacitorHttpHandler adapter）
 * - SyncDbPort：本地库读写（桌面=store 方法包装，移动端=native SQLite）
 *
 * 语义（对齐 docs/SYNC-PROTOCOL.md v4）：
 * - 下载方向：墓碑/恢复分支 → reconcile 对账 → 对象下载（先内容后标志）→ 本地应用
 * - 上传方向：本地回收站 → 墓碑（删除前内容 + deleted 标记）；恢复 → active 覆盖；
 *   正常 → decideUpload（skip-fast）
 * - 记账：sync_base（content_hash / last_synced_meta_at / last_uploaded_hash）
 */
import { reconcileLakeNote } from "./lakeReconcile.js";
import { decideUpload } from "./decideUpload.js";
import { buildUploadEntry, buildTombstoneEntry, decideMetaApply, decideLocalTombstone, decidePurge, decideFolderPurge, decideTombstoneYield, TRASH_NOTEBOOK_ID } from "./syncDecisions.js";
import { mergeLockState } from "./syncDecision.js";
import { shouldSkipZeroChange, isRemoteDescendant, createSupersededTracker } from "./syncPerf.js";
import type { Manifest, ManifestFolder, ManifestNote } from "./manifestTypes.js";
import { sha256Sync } from "./sha256Sync.js";
import { parseLakeManifest, objectKey, MANIFEST_VERSION } from "./syncUtils.js";
import { extractAssetRefs } from "./assetNaming.js";
import { isSafePathSegment } from "./storeUtils.js";
import { AssetMissingError, decodeText, downloadNoteAssets, recordDeclaredAssetsOnly, runAssetPool, scanLocalAssets } from "./syncAssets.js";
import { HISTORY_SNAPSHOT_PROTECT_DAYS, type LocalNoteRow, type S3Store, type SyncConfig, type SyncDbPort, type SyncNowOptions, type SyncReport } from "./syncEngineTypes.js";

export type { LocalNoteRow, S3Store, SyncConfig, SyncDbPort, SyncNowOptions, SyncReport } from "./syncEngineTypes.js";
export { HISTORY_SNAPSHOT_PROTECT_DAYS } from "./syncEngineTypes.js";
export { downloadNoteAssets, scanLocalAssets } from "./syncAssets.js";

/** 单对象大小护栏（对齐桌面 sync.ts:100）：正文 .lake 上限 64MiB。 */
const MAX_REMOTE_NOTE_BYTES = 64 * 1024 * 1024;

/** 正文对象并发上传车道数（内容寻址幂等，条目独立）。 */
const UPLOAD_CONCURRENCY = 4;
/** 跨笔记资产扫描并发车道数（P3-4）。峰值并发 PUT = NOTE_UPLOAD_CONCURRENCY × ASSET_CONCURRENCY = 2×4 = 8
 *  （对齐七牛 Kodo 建议上限 8；16 偏高、日常用不到，徒增限流风险）。正文/下载各自 ≤4 且与资产阶段串行、不叠加。 */
const NOTE_UPLOAD_CONCURRENCY = 2;
/** 下载正文并发车道数（与上传对称）：只并发网络 GET，峰值与上传/资产阶段串行、不叠加（≤4）。 */
const DOWNLOAD_CONCURRENCY = 4;
/** 下载预取窗口（条）：窗口内先并发取"可能用到的正文"，再按原顺序逐条应用；稳态命中 0 条、不产生多余下载。 */
const DOWNLOAD_PREFETCH_WINDOW = 64;
/** 单窗口预取字节上限：超过则未预取的条目回退按需 GET，避免大文档库一次性占满内存。 */
const DOWNLOAD_PREFETCH_BUDGET = 64 * 1024 * 1024;

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

const MANIFEST_KEY = "manifests/latest.json";

export async function syncNow(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, opts?: SyncNowOptions): Promise<SyncReport> {
  const report: SyncReport = { pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "", warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0, trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0 };
  // superseded 去重（与桌面同单点）：Lake 下载阶段冲突语义由 supersededNotes 表达，Set 去重防重复记。
  const supersededTracker = createSupersededTracker();
  // 批量 hash 账本：一次全表读，替代下载/上传环里逐条 db.getSyncBase（移动端每条=一次原生往返）。
  // 下载环用同步前快照；上传环前重载一次以对齐下载阶段写入（语义与逐条读一致）。
  let syncBases = typeof db.getAllSyncBases === "function" ? await db.getAllSyncBases() : null;
  const baseOf = async (id: string): Promise<{ contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null } | null> =>
    syncBases ? (syncBases.get(id) ?? null) : await db.getSyncBase(id);
  // H5：本机编辑成果判定（软删/purge 覆盖前留档共用）——本地相对基线有改动，或本机上传过当前版本（本机是作者）。
  const ownEditOf = async (local: LocalNoteRow | null, id: string): Promise<boolean> => {
    if (!local) return false;
    const base = await baseOf(id);
    const localHash = local.contentHash ?? sha256Sync(new TextEncoder().encode(local.content));
    return (base !== null && localHash !== base.contentHash) || (base?.lastUploadedHash != null && localHash === base.lastUploadedHash);
  };
  // P3-1：按需取正文——批量行（getAllNotes）content 可为 ""（桌面 adapter 元数据路径），
  // 仅在留历史快照/上传入队时刻调用；行已带正文（移动端/测试桩）则直接用，不产生额外 IO。
  const contentOf = async (row: LocalNoteRow | null): Promise<string> => {
    if (!row) return "";
    if (row.content) return row.content;
    return (await db.getNote(row.id))?.content ?? "";
  };
  // A 方案：上传 manifest 的 assets = 本地文件 ∪ (正文引用的、且有已声明元数据的资源)。
  // 保证备份声明完整；正文引用（当前内容）不含已删除引用，避免历史把已删资源挂回当前文档。
  const resolveUploadAssets = async (
    localId: string, content: string,
    cloudAssets?: ManifestNote["assets"] | null,
  ): Promise<ManifestNote["assets"]> => {
    // 差集上传：以已下载远端清单中本笔记声明的资产文件名为「云端已存在」依据（对齐思源 dejavu），
    // 不再逐对象 HEAD。cloudAssets 缺省/为空（新笔记、桶重置 rn=null）→ 全部按缺失上传。
    const cloudDeclared = cloudAssets && cloudAssets.length ? new Set(cloudAssets.map((a) => a.filename)) : undefined;
    const localFiles = await scanLocalAssets(cfg, s3, db, localId, report, cloudDeclared);
    const declared = typeof db.listDeclaredAssets === "function" ? ((await db.listDeclaredAssets(localId)) ?? []) : [];
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
      report.warnings.push({ kind: "remote_incomplete", noteId: rn.id, title: rn.title, message: `正文哈希不符（跳过）: ${rn.id}-${rn.contentHash}` });
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
      await db.log("首次同步：无 latest manifest");
    }
  } catch (e) {
    const msg = (e as Error).message;
    // 拉取清单失败一律中止整轮并抛出。对象缺失（= 首次同步）不是异常：S3 端口对 NoSuchKey 返回 null，
    // 走上面的 else 分支，所以到这里的全是真失败（网络/权限/限流、非法 JSON、清单过大、版本不兼容）。
    // 旧实现只重抛「版本不兼容|清单格式」、其余降级成 report.message + return，而桌面 Controller
    // 不检查该字段 → UI 显示「同步完成、上传 0 下载 0」（假安全，审计 260918 F2）。
    // 中止同时避免了 Controller 在引擎早退后仍执行 purge 前缀删除 + markPurgeSynced。
    await db.log(`[sync] 拉取 manifest 失败，整轮中止: ${msg}`);
    throw new Error(`拉取同步清单失败：${msg}`);
  }

  // 本地目录树 vs 远端语义差异（早退与发布共用）：folders 变更（回收站笔记本 / 移动 / 改名 / 图标）
  // 必须传播——对齐桌面 sync.ts 每次同步无条件发布 manifest 的语义（迁移回归修复：
  // 否则删笔记本不传播 + 目录记账抹掉 local，且 hasLocalPendingNotes 被抹后早退跳过）。
  let foldersChanged = false;
  // 开头快照：下载环判"本地是否有该 folder 活跃行"用（此时本轮尚未应用任何远端变更；
  // purged 行已被 listFoldersForSync 过滤 → absent = 无活跃副本）。
  const localFolderIdsAtStart = new Set<string>();
  if (typeof db.listFoldersForSync === "function") {
    const localFolders = (await db.listFoldersForSync()) ?? [];
    for (const f of localFolders) localFolderIdsAtStart.add(f.id);
    const remoteFolders = new Map((remote?.folders ?? []).map((f) => [f.id, f]));
    for (const f of localFolders) {
      const rf = remoteFolders.get(f.id);
      // v5：远端同 id 条目是墓碑（deleted:true）→ 下载环会应用删除（applyRemoteFolderDelete），
      // 本地行随之下轮消失；此处只需阻止早退，不作为上传方向计数。
      if (rf?.deleted) { foldersChanged = true; continue; }
      // 本地新增（远端无此 folder）或内容有差异 → 需要发布
      if (!rf || rf.title !== f.title || (rf.parentId ?? null) !== (f.parentId ?? null) || rf.sortOrder !== f.sortOrder ||
        rf.nodeType !== f.nodeType || (rf.icon ?? null) !== (f.icon ?? null) ||
        (rf.trashedAt ?? null) !== (f.trashedAt ?? null) || (rf.deletedFromParentId ?? null) !== (f.deletedFromParentId ?? null)) {
        foldersChanged = true;
        report.foldersUploaded++;
      }
    }
    // 远端存在**活跃**的 folder 而本地已 purge（deleted_notes 带 folder 墓碑）：必须强制发布重写 manifest，
    // 从云端移除残留（否则每轮同步都会尝试重新导入 → 复活）。
    // v5 收窄：远端墓碑条目（deleted:true）不触发——墓碑已在云端，重写属空转（每轮 commitId 震荡的根因之一）。
    if (!foldersChanged && typeof db.isFolderPurged === "function") {
      for (const rf of remoteFolders.values()) {
        if (!rf.deleted && await db.isFolderPurged(rf.id)) { foldersChanged = true; await db.log(`[publish] folder ${rf.id} locally purged, force rewrite manifest`); break; }
      }
    }
    // 同步统计：远端存在而本地没有的**活跃**目录 → 下载方向新导入（墓碑条目计入无意义）
    if (remote) {
      for (const rf of remoteFolders.values()) {
        if (!rf.deleted && !localFolderIdsAtStart.has(rf.id)) report.foldersDownloaded++;
      }
    }
  }

  // 零变更早退（性能）：远端 commitId 与上次成功读/写相同 + 本地无待上传 + 墓碑签名一致 → 整轮跳过。
  // 与桌面 sync.ts 同语义（shouldSkipZeroChange 单点），10k 条时从秒级降到 ~100ms（纯性能、语义等价）。
  if (!foldersChanged && shouldSkipZeroChange({
    remoteCommitId: remote?.commitId ?? null,
    lastSeenCommitId: await db.getLastSeenCommitId(),
    hasPending: await db.hasLocalPendingNotes(),
    tombstoneSig: await db.tombstoneSignature(),
    lastTombstoneSig: await db.getLastTombstoneSig(),
  })) {
    // 早退前加一道「元数据漂移」护栏：远端 parent 与本地不一致时**不得早退**。
    // 历史 bug：文档被落到兜底笔记本后 updated_at 与云端相同，严格时间戳判定永远跳过 → 两端永久不一致。
    let metaDrift = false;
    if (remote) {
      const localNotesForDrift = await db.getAllNotes();
      // 只看"本地活跃"的 note：本地已进回收站/已 purge 的行与远端活跃条目不同属正常（墓碑语义），不算父级漂移。
      const localParentById = new Map(
        localNotesForDrift
          .filter((n) => n.syncState !== "purged" && (n.parentId ?? null) !== TRASH_NOTEBOOK_ID)
          .map((n) => [n.id, n.parentId ?? null] as const)
      );
      metaDrift = remote.notes.some((rn) => !rn.deleted && localParentById.has(rn.id) && (localParentById.get(rn.id) ?? null) !== (rn.parentId ?? null));
    }
    if (!metaDrift) {
      // remote 可能为 null（空桶首次同步 + 本地无变更的极端组合）——用 ?. 防御，避免空指针
      await db.log(`[perf] zero-change sync skipped (commit=${remote?.commitId.slice(0, 8) ?? "none"}, notes=${remote?.notes.length ?? 0})`);
      report.message = `零变更跳过（${remote?.notes.length ?? 0} 条）`;
      return report;
    }
    await db.log("[sync] meta parent drift detected → 跳过零变更早退，走完整对账自愈");
  }

  // tombstone=true：墓碑条目。content="" 为占位符（内容已物理删除，发布阶段不传空对象、保留占位符 hash）。
  const uploadQueue: Array<{ id: string; entry: ManifestNote; content: string; tombstone?: boolean }> = [];
  progress("pull", `拉取 ${remote ? remote.notes.length : 0} 条`);

  // ---- 2. 下载方向：墓碑/恢复分支 → reconcile 对账 → 应用远端 ----
  if (remote) {
    // D4：先导入目录树（保证文档父 notebook/group 已存在），并构建 validParents——
    // 父节点集合 = 回收站笔记本 + 远端 folders + 远端 active 笔记 id + 本地已有节点（兜底父笔记本惰性解析，见下，创建前不入集合）。
    // effectiveParent 据此回退，防"父目录缺失 → 文档消失/归属错位"（对齐桌面 sync.ts:344-363/395）。
    // 兜底父笔记本惰性解析：db.defaultNotebookId() 在本地无任何笔记本时会新建普通笔记本"未分类"（红线：仅"必须给内容一个家"时才建）。
    // 旧实现在下载阶段开头无条件调用 → 空库同步即使 downloaded=0、没有任何笔记需要安家，也会凭空创建"未分类"并上传扩散到云端；
    // 且它在目录导入之前执行，即便远端 folders 即将提供真实归属也会误建。改为首次真正需要兜底父时再解析并缓存（本轮至多建一次）。
    let defaultNotebook: string | null = null;
    const resolveDefaultNotebook = async (): Promise<string> => (defaultNotebook ??= await db.defaultNotebookId());
    // 兜底笔记本惰性创建，创建前其 id 未知，故不预置进 validParents（其随机 id 也不会被任何远端 rn.parentId 引用）。
    const validParents = new Set<string>([TRASH_NOTEBOOK_ID]);
    // 本地已有的 folder 也算合法父：否则"本地有这个笔记本、但本次远端清单没列出它"时父判定失败，
    // 会落到 defaultNotebookId() 兜底（历史 bug：文档被错挂到最老的笔记本、且时间戳相同无法自愈）。
    for (const id of localFolderIdsAtStart) validParents.add(id);
    // 本地 folder 墓碑（deleted_notes node_type='folder'）：远端活跃条目恢复撤销判定用
    // （对齐 note 的 decideLocalTombstone：远端 updatedAt 新于墓碑时间 → 撤销墓碑跟随恢复）。
    const folderTombstoned = new Map(
      ((typeof db.listDeletedNotesForSync === "function" ? await db.listDeletedNotesForSync() : []) ?? [])
        .filter((d) => d.nodeType === "folder")
        .map((d) => [d.id, d.deletedAt] as const)
    );
    for (const folder of remote.folders) {
      if (!isSafePathSegment(folder.id)) throw new Error(`清单包含无效的目录 ID: ${folder.id}`);
      if (folder.parentId !== null && !isSafePathSegment(folder.parentId)) throw new Error(`清单包含无效的目录 parentId: ${folder.parentId}`);
      // v5 folder 墓碑：远端已彻底删除该目录 → 本地子树移入回收站标 purged（行保留可恢复）；从未持有 → 记墓碑防复活
      if (folder.deleted) {
        const action = decideFolderPurge(
          (typeof db.isFolderPurged === "function" && await db.isFolderPurged(folder.id)) ?? false,
          localFolderIdsAtStart.has(folder.id),
        );
        if (action === "skip-already-purged") {
          continue; // 幂等：发起端墓碑 / 学习端已应用（已记墓碑）
        } else if (action === "apply-purge") {
          if (typeof db.applyRemoteFolderDelete !== "function") {
            await db.log(`[pull] folder ${folder.id} 远端墓碑但端口不支持目录删除，跳过`);
            continue;
          }
          await db.applyRemoteFolderDelete(folder.id, folder.deletedAt ?? new Date().toISOString());
          await db.log(`[pull] folder ${folder.id} 远端 purge，子树移入回收站`);
          report.appliedRemote++;
        } else {
          if (typeof db.rememberFolderDeleted === "function") {
            await db.rememberFolderDeleted(folder, folder.deletedAt ?? new Date().toISOString());
          }
          await db.log(`[pull] folder ${folder.id} 远端 purge（本地无副本），记墓碑防复活`);
        }
        continue;
      }
      // 活跃 folder vs 本地 folder 墓碑：远端恢复较新（updatedAt LWW）→ 撤销墓碑跟随恢复（对齐 note 墓碑撤销）
      const folderTombAt = folderTombstoned.get(folder.id);
      if (folderTombAt !== undefined && folder.updatedAt > folderTombAt) {
        await db.log(`[tombstone] folder ${folder.id} 远端恢复较新，撤销本地墓碑`);
        if (typeof db.revokeLocalDeletion === "function") await db.revokeLocalDeletion(folder.id);
      }
      // 本地已 purge 的 folder（deleted_notes 带 folder 墓碑且远端活跃条目较旧 = 云端残留）：不重新导入
      // （防"清空回收站后同步 → 被删的又回来"；v5 后此分支仅在旧清单残留窗口触发）
      if (typeof db.isFolderPurged === "function" && await db.isFolderPurged(folder.id)) {
        await db.log(`[pull] folder ${folder.id} locally purged, skip import`);
        continue;
      }
      await db.importRemoteFolder(folder);
      validParents.add(folder.id);
    }
    for (const rn of remote.notes) if (!rn.deleted) validParents.add(rn.id);
    // P3-1：一次全表（仅元数据）建本地索引，validParents 与下载环共用——
    // 替代原先"validParents 全量行 + 下载环每条远端笔记一次全表 SQL + 读全文"的 O(N²)。
    const localById = new Map((await db.getAllNotes()).map((n) => [n.id, n]));
    for (const id of localById.keys()) validParents.add(id);
    // 远端 parent 映射（仅 active 笔记）：结构环检测用——本地移动与远端已提交移动互成父子
    // （循环移动）时保留本地会成环 → 必须跟随远端打破环（先提交先确认，对齐桌面 sync.ts:363-380）。
    const remoteParentMap = new Map<string, string | null>();
    for (const rn of remote.notes) if (!rn.deleted) remoteParentMap.set(rn.id, rn.parentId);
    // 本地删除墓碑（deleted_notes）：远端恢复撤销判定（对齐桌面 sync.ts:131-147 decideLocalTombstone）
    const tombstoned = new Map(
      ((typeof db.listDeletedNotesForSync === "function" ? await db.listDeletedNotesForSync() : []) ?? [])
        .map((d) => [d.id, d.deletedAt] as const)
    );

    // 有界并发预取：把「取正文」这段网络等待重叠起来（旧实现逐条 await，首同步/大变更时长尾极重）。
    // 只并发网络 GET，不改变墓碑/冲突/留档/父目录等决策与落库顺序：每窗口先按只读判据预取，
    // 再沿用原逐条逻辑消费；未命中按需回退 GET。稳态（本地 hash == 远端 hash）不预取任何对象。
    const prefetched = new Map<string, Uint8Array | null>();
    const contentKey = (id: string, hash: string): string => id + "|" + hash;
    let prefetchBudget = DOWNLOAD_PREFETCH_BUDGET;
    const prefetchWindow = async (windowNotes: readonly ManifestNote[]): Promise<void> => {
      prefetched.clear();
      const need: ManifestNote[] = [];
      for (const rn of windowNotes) {
        if (rn.deleted || !isSafePathSegment(rn.id)) continue;
        const local = localById.get(rn.id) ?? null;
        if (local === null || (local.contentHash ?? null) !== rn.contentHash) need.push(rn);
      }
      await runAssetPool(need, DOWNLOAD_CONCURRENCY, async (rn) => {
        const key = contentKey(rn.id, rn.contentHash);
        if (prefetched.has(key) || prefetchBudget <= 0) return;
        const bytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
        prefetched.set(key, bytes ?? null);
        if (bytes) prefetchBudget -= bytes.length;
      });
    };
    const fetchRemoteContent = async (id: string, hash: string): Promise<Uint8Array | null> => {
      const key = contentKey(id, hash);
      if (prefetched.has(key)) return prefetched.get(key) ?? null;
      const bytes = await s3.getObject(`${cfg.prefix}/${objectKey(id, hash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
      prefetched.set(key, bytes ?? null);
      return bytes ?? null;
    };

    for (let win = 0; win < remote.notes.length; win += DOWNLOAD_PREFETCH_WINDOW) {
      const windowNotes = remote.notes.slice(win, win + DOWNLOAD_PREFETCH_WINDOW);
      await prefetchWindow(windowNotes);
      if (typeof db.beginNoteBatch === "function") await db.beginNoteBatch();
      for (const rn of windowNotes) {
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
        await db.log(`[tombstone] ${rn.id} 远端恢复较新，撤销本地墓碑`);
        if (typeof db.revokeLocalDeletion === "function") await db.revokeLocalDeletion(rn.id);
      } else if (tombDecision === "keep-local-delete") {
        await db.log(`[tombstone] ${rn.id} 本地删除较新，跳过下载（上传阶段会标记 deleted）`);
        continue;
      }
      const remoteTrashed = !!rn.trashedAt;   // 软删（回收站）；purge（deleted:true）已单独处理
      const localTrashed = local?.trashedAt != null;
      const localRestoring = local?.restorePendingAt != null;
      // 有效父惰性求值：父合法时直接用它；仅当确需回退兜底位时才解析（并可能创建）"未分类"（按 note 记忆，避免重复解析）。
      let effectiveParentMemo: string | undefined;
      const effectiveParent = async (): Promise<string> =>
        (effectiveParentMemo ??= rn.parentId !== null && validParents.has(rn.parentId) ? rn.parentId : await resolveDefaultNotebook());

      // B4：purge（deleted:true）——本地有副本→移入回收站标 purged（可恢复、不上传）；无→记住删除（防复活）
      if (rn.deleted) {
        const purgeAction = decidePurge(local, localRestoring);
        if (purgeAction === "skip-restore-pending") {
          await db.log(`[purge] ${rn.id} 本地显式恢复，跳过 purge`);
        } else if (purgeAction === "skip-already-purged") {
          // 幂等：本地已学习过 purge（行保留标 purged），只对齐记账不重复应用。
          await db.log(`[purge] ${rn.id} 本地已 purged，跳过重复应用`);
        } else if (purgeAction === "apply-purge") {
          // W-1：与软删分支对称——本地未同步编辑（或本机是作者）被远端 purge 覆盖前强制留档。
          // purged 条目保留 .lake 可恢复，但无历史快照；清空回收站/自动过期后即彻底丢失。
          if (await ownEditOf(local, rn.id)) {
            await db.createHistorySnapshot(rn.id, await contentOf(local), { title: local!.title, parentId: local!.parentId, sortOrder: local!.sortOrder, protectedDays: HISTORY_SNAPSHOT_PROTECT_DAYS });
            supersededTracker.push(rn.id, rn.title);
          }
          await db.applyRemotePurge(rn.id);
          report.appliedRemote++;
        } else {
          await db.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
        }
        continue;
      }

      if (remoteTrashed && localRestoring) {
        // 恢复例外（对齐桌面 trash-cross skip-restore-pending）：本地显式恢复中 → 远端墓碑让位，
        // 不应用远端墓碑（不压回回收站、不改 meta），由上传方向 local-wins 覆盖（恢复例外传播）。
        await db.log(`[trash-cross] ${rn.id} 本地恢复中，跳过远端墓碑`);
        continue;
      }

      if (remoteTrashed && !localRestoring) {
        // P3-3b：幂等跳过——本地已在回收站、正文 hash 与墓碑一致、墓碑时间不新于本地 → 完全一致，
        // 只对齐记账，不重复下载正文/资产。此前每轮"有变更的同步"都会重拉回收站全部文档
        // （实测 B 端同 hash 对象重复下载；106 资产大文档批量删除后每轮重拉数十 MB）。
        // 语义等价：applyRemoteTrash 重写相同内容/元数据是 no-op；hash 不同（回收站内编辑 S4）
        // 或墓碑时间更新（回收站元数据变更）仍走完整应用路径。
        if (local !== null && localTrashed && local.contentHash === rn.contentHash && (local.updatedAt ?? "") >= (rn.updatedAt ?? "")) {
          await db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          continue;
        }
        // 远端墓碑（删除压编辑）：本地无显式恢复 → 跟随删除
        if (local === null) {
          // 本地从未持有（全新设备/重装）：导入远端 trash 条目（先拉删除前内容再建回收站条目，内容可恢复）。
          const contentBytes = await fetchRemoteContent(rn.id, rn.contentHash);
          if (contentBytes == null) {
            report.warnings.push({ kind: "remote_incomplete", noteId: rn.id, title: rn.title, message: `对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}` });
            continue;
          }
          if (!verifyNoteHash(contentBytes, rn)) continue;
          report.downloadedBytes += contentBytes.length;
          // 回收站惰性下载：只记录声明资产元数据（冻结清点），不下载资源文件。
          // 进回收站不可编辑 → 清点不变；他端删除可能随后被清空 → 先不拉资源；恢复时再强拉全量。
          await recordDeclaredAssetsOnly(db, rn.id, rn.assets);
          await db.applyRemoteNote({ ...rn, parentId: TRASH_NOTEBOOK_ID, trashedAt: rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, deletedFromParentId: rn.deletedFromParentId ?? null, deleted: false, deletedAt: undefined }, decodeText(contentBytes));
          await db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
          report.trashedDown++; // 全新设备首次导入即入回收站（UI 移入回收站计数）
          continue;
        }
        // H5/回收站内编辑（对齐桌面 sync.ts:427-441 + S4）：仅当"本机编辑成果"被删除覆盖
        // 才强制留档 + 报 superseded——本地相对基线有改动，或本机上传过当前版本（本机是作者）。
        // 纯跟随删除传播（从未编辑/上传）→ 只移入回收站（或已在内），不留档不报。
        // 回收站内编辑（localTrashed=true 且内容被改）同样压制回删除前内容 + 留档（S4）。
        if (await ownEditOf(local, rn.id)) {
          await db.createHistorySnapshot(rn.id, await contentOf(local), { title: local!.title, parentId: local!.parentId, sortOrder: local!.sortOrder, protectedDays: HISTORY_SNAPSHOT_PROTECT_DAYS });
          supersededTracker.push(rn.id, rn.title);
        }
        // 下载差集（对齐缺口1「验真实字节」哲学，不盲信缓存）：删除不改正文 → 仅当【本地实读正文的 sha256 == 远端 hash】
        // 才用本地内容标记入回收站、省一次正文 GET。local.contentHash 对 synced 笔记走 baseHash 缓存、不读文件（syncAdapters.localHashOf），
        // 只作便宜预筛；真判定以「读盘 + sha256 相等」为准 → 缓存说等于、文件却缺失/损坏时实读不符 → 回退 GET 权威内容自愈（旧行为）。
        // hash 不等（S4 回收站内编辑 / 删除方携带更新的删除前内容）同样必须 GET 权威 + H5 留档（删除内容权威红线不动）。
        let trashContent: string;
        const localBodyCacheMatch = local.contentHash != null && local.contentHash === rn.contentHash;
        const localBody = localBodyCacheMatch ? await contentOf(local) : "";
        if (localBody !== "" && sha256Sync(new TextEncoder().encode(localBody)) === rn.contentHash) {
          trashContent = localBody;
        } else {
          const contentBytes = await fetchRemoteContent(rn.id, rn.contentHash);
          if (contentBytes == null) {
            report.warnings.push({ kind: "remote_incomplete", noteId: rn.id, title: rn.title, message: `对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}` });
            continue;
          }
          if (!verifyNoteHash(contentBytes, rn)) continue;
          report.downloadedBytes += contentBytes.length;
          trashContent = decodeText(contentBytes);
        }
        await db.applyRemoteTrash(rn.id, trashContent, rn.title, rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, rn.deletedFromParentId ?? null, rn.parentId, rn.sortOrder);
        await recordDeclaredAssetsOnly(db, rn.id, rn.assets);
        report.appliedRemote++;
        // UI 移入回收站计数：仅"本次新入回收站"（本地原先不在回收站）才计；已在回收站的重复应用不计
        if (!localTrashed) report.trashedDown++;
        // 本地已在回收站 → 一致，无操作
        continue;
      }

      if (localTrashed && !localRestoring) {
        // 本地在回收站、远端 active：时间比较决定胜负
        // - 远端 updatedAt 新于（或等于）本地删除时间 → 远端恢复较新，跟随恢复。
        //   `>=` 容错：恢复方未 bump updated_at 的历史数据（如旧版移动端单条恢复）上传条目
        //   updatedAt == 本地 trashedAt——严格相等只可能来自"原样恢复"（他端真实编辑时刻
        //   不可能与本端删除时刻精确相等），判恢复胜符合"恢复传播"语义。
        // - 本地删除时间新于远端 → 本地删除压远端 active（删除压编辑），保留删除，步骤 3 上传墓碑
        const remoteNewer = (rn.updatedAt ?? "") >= (local.trashedAt ?? "");
        if (remoteNewer) {
          const contentBytes = await fetchRemoteContent(rn.id, rn.contentHash);
          if (contentBytes == null) {
            report.warnings.push({ kind: "remote_incomplete", noteId: rn.id, title: rn.title, message: `对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}` });
            continue;
          }
          if (!verifyNoteHash(contentBytes, rn)) continue;
          report.downloadedBytes += contentBytes.length;
          // 跟随恢复 = 应用远端 active（dbPort 清 trashed_at）+ 记账
          if (opts?.strictAssets) {
            try { await downloadNoteAssets(cfg, s3, db, rn.id, rn.assets, report, true, rn.title); }
            catch (e) { if (e instanceof AssetMissingError) { report.warnings.push({ kind: "asset_missing", noteId: rn.id, title: rn.title, filename: e.filename, message: `资源缺失（跳过该条目）: ${rn.id}` }); continue; } throw e; }
          }
          await db.applyRemoteNote({ ...rn, parentId: await effectiveParent(), trashedAt: null, deleted: false, deletedAt: undefined, deletedFromParentId: null }, decodeText(contentBytes));
          if (!opts?.strictAssets) await downloadNoteAssets(cfg, s3, db, rn.id, rn.assets, report, false, rn.title);
          await db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
        } else {
          await db.log(`[tombstone] ${rn.id} 本地删除较新，保留删除（远端 active 让位），步骤 3 上传墓碑`);
        }
        continue;
      }

      // 正常对账（含本地显式恢复 restore_pending_at → local-wins 走上传）
      const base = await baseOf(rn.id);
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
            await db.applyRemoteLock(rn.id, merged.locked, merged.at);
          }
          // 元数据 LWW（标题/父/排序/图标）：远端 updatedAt 新于本设备已确认版本 → 应用远端（先同步者胜）
          // 结构环检测（先提交先确认）：本地移动（local.parentId）若在远端树中位于本节点之下
          // （B 把 888 移入 999 下，而 A 已把 999 移入 888 下并提交）→ 保留本地会与远端成环，
          // 即使本地 updatedAt 较新也强制跟随远端打破环（对齐桌面 sync.ts:484-492）。
          // 结构环检测只在「远端父合法且与本地父不同」时才可能成环（远端父非法将落兜底位，不产生子树环）。
          // 关键：此处不得调用 effectiveParent()——兜底笔记本惰性解析，若只为探测就把远端父非法的条目算出兜底位，
          // 会在「最终未应用(skip)」时凭空创建并上传"未分类"（点#1 空库同步幽灵笔记本的残留路径）。仅在下面真应用时才解析。
          const remoteParentValid = rn.parentId !== null && validParents.has(rn.parentId);
          const localParentConflicts =
            local.parentId !== null && remoteParentValid && local.parentId !== rn.parentId && isRemoteDescendant(local.parentId, rn.id, remoteParentMap);
          // 字段判据（修历史 bug）：父合法且与本地不同时，只要本地没有待上传的 meta 变更（sync_state!=='local'）就跟随远端。
          // 只靠时间戳严格 `>` 时，"updatedAt 相同但 parent 不同"的错挂会被永久跳过、两端再也对不齐。
          const remoteParentDiffers = remoteParentValid && (local.parentId ?? null) !== (rn.parentId ?? null);
          const localMetaPending = local.syncState === "local";
          if (decideMetaApply(rn.updatedAt, base?.lastSyncedMetaAt ?? null) || localParentConflicts || (remoteParentDiffers && !localMetaPending)) {
            await db.applyRemoteNoteMeta({ ...rn, parentId: await effectiveParent() });
          }
        }
        await db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
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
        const contentBytes = await fetchRemoteContent(rn.id, rn.contentHash);
        if (contentBytes == null) {
          report.warnings.push({ kind: "remote_incomplete", noteId: rn.id, title: rn.title, message: `对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}` });
          continue;
        }
        if (!verifyNoteHash(contentBytes, rn)) continue;
        report.downloadedBytes += contentBytes.length;
        // D5：本机编辑成果被远端覆盖 → 先强制留档（协议 §4.2，防丢数据），再接受远端
        if (action.superseded && local) {
          await db.createHistorySnapshot(rn.id, await contentOf(local), { title: local.title, parentId: local.parentId, sortOrder: local.sortOrder, protectedDays: HISTORY_SNAPSHOT_PROTECT_DAYS });
          supersededTracker.push(rn.id, rn.title);
        }
        if (opts?.strictAssets) {
          try { await downloadNoteAssets(cfg, s3, db, rn.id, rn.assets, report, true, rn.title); }
          catch (e) { if (e instanceof AssetMissingError) { report.warnings.push({ kind: "asset_missing", noteId: rn.id, title: rn.title, filename: e.filename, message: `资源缺失（跳过该条目）: ${rn.id}` }); continue; } throw e; }
        }
        await db.applyRemoteNote({ ...rn, parentId: await effectiveParent(), trashedAt: null, deleted: false }, decodeText(contentBytes));
        if (!opts?.strictAssets) await downloadNoteAssets(cfg, s3, db, rn.id, rn.assets, report, false, rn.title);
        await db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        report.appliedRemote++;
      }
      // local-wins 不在此入队：统一由步骤 3 decideUpload 决定（skip-fast 覆盖）
      }
      if (typeof db.flushNoteBatch === "function") await db.flushNoteBatch();
    }
  }

  // ---- 3. 上传方向：墓碑 / 恢复 / 正常（decideUpload） ----
  // 位置不变：必须在上传环开头重新取——这里看到的是下载合并后的状态（刚应用的笔记 syncState=synced），
  // 提前取会让它们被误判 upload 造成回环重传（P3-1 语义关键点）。
  // 上传环前重载 hash 账本（下载阶段已写入新 base），保持 baseOf 与逐条读语义一致。
  if (typeof db.getAllSyncBases === "function") syncBases = await db.getAllSyncBases();
  const localAll = await db.getAllNotes();
  // P3-1：远端条目索引一次建好——上传环与墓碑环节共用（原先各自 .find，O(N²)）。
  const remoteById = new Map((remote?.notes ?? []).map((n) => [n.id, n]));
  // B4：本地已 purge（收到他端删除后的保留副本）不上传——恢复 = 清 purged 后再上传（对齐桌面 sync.ts:641）。
  // 同时记录 purged id：作为"必须发布 manifest"的强制理由（防本地 purge 因零变更早退而永不上云）。
  // 收敛减枝：远端 manifest 已带同 id 墓碑（deleted:true）→ 墓碑已在云端，无需再作为发布理由；
  // 否则移动端（purge 表示 = 行保留标 purged）会每轮 purgedIds 非空 → 每轮重发布 manifest → 四端 commitId 永不稳定。
  const purgedIds = new Set(localAll.filter((n) => n.syncState === "purged").map((n) => n.id));
  if (remote) {
    for (const rn of remote.notes) if (rn.deleted) purgedIds.delete(rn.id);
  }
  // P3-4 跨笔记资产扫描并发化：扫描/上传某笔记缺失资产是同步里唯一的“每笔记网络活”，旧实现逐篇 await（串行长尾，
  // 大库首次同步多篇带图笔记时尤甚）。决策环内只登记任务（正文与条目照常构建、entry.assets 暂空），环后用并发池统一
  // 解析并回填 entry.assets。语义与串行完全一致：同一 resolveUploadAssets、同样的失败吞并日志、最终 manifest.assets 同集合，
  // 仅把各笔记的 IO 等待重叠起来；uploadQueue 顺序不变（改写的是已入队的同一 entry 对象）。
  const assetTasks: Array<{ noteId: string; content: string; rnAssets: ManifestNote["assets"] | null; entry: ManifestNote; onError: (msg: string) => Promise<void> }> = [];
  // P1（资产失败硬化，审计 260903）：本轮资产扫描/上传抛错的笔记 id 集；这些条目发布后不 markSynced（保持 local，下轮重扫重传），
  // 避免「资产扫描失败→assets:[] 发布→被标 synced→永不重扫→原声明资产被 GC 误删」。语义仍为「资产失败不阻断正文」（正文照常发布，仅留该篇待重试）。
  const assetScanFailed = new Set<string>();
  for (const local of localAll) {
    if (local.syncState === "purged") continue;
    const rn = remoteById.get(local.id) ?? null;
    // 远端条目缺失（桶重置/被清空）→ 回退全量扫描：synced 笔记也强制读真实 hash 重传（对齐桌面 cachedBase 边界）
    let localHash = local.contentHash ?? sha256Sync(new TextEncoder().encode(local.content));
    if (rn === null && typeof db.forceHashRead === "function") {
      const real = await db.forceHashRead(local.id);
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
        await db.log(`[tombstone] ${local.id} 两端一致（已删除），skip`);
        // 两端一致 skip：本机未上传该版本内容，lastUploadedHash 传 null 清除误标——
        // 否则跟随删除被 ownEdit 判定误认为"本机是作者"，每次同步重复留档 + superseded 提示（实机回归）。
        await db.markLocalNoteSynced(local.id, rn.contentHash, local.updatedAt, null);
        continue;
      }
      await db.log(`[tombstone] ${local.id} 上传软删条目（parentId=TRASH + trashedAt，非 deleted）`);
      // 回收站条目携带资源清单（对齐桌面：trash 上云带 assets，B 端下载全文+资源可恢复）
      const uploadContent = await contentOf(local);
      const entry = buildUploadEntry({
        // kind 必须透传：否则非 doc 文档（sheet/bitable/board）上云后在他端被当 doc 导入（260925 多端实测）。
        note: { id: local.id, title: local.title, parentId: TRASH_NOTEBOOK_ID, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon, kind: local.kind, trashedAt: local.trashedAt, deletedFromParentId: local.deletedFromParentId ?? null },
        contentHash: localHash,
        assets: [],
        trashedAt: local.trashedAt,
        deletedFromParentId: local.deletedFromParentId ?? null,
      });
      assetTasks.push({ noteId: local.id, content: uploadContent, rnAssets: rn?.assets ?? null, entry, onError: async (m) => { await db.log(`[tombstone] ${local.id} 资源扫描失败（跳过）：${m}`); } });
      // P3-1：上传条目此刻才取正文（仅待上传的少数笔记产生 IO）
      uploadQueue.push({ id: local.id, content: uploadContent, entry });
      report.trashedUp++; // 本端软删发布（UI 移入回收站计数）
      continue;
    }

    // 正常（含恢复：restore_pending_at → active 上传覆盖墓碑）
    const base = await baseOf(local.id);
    const decision = decideUpload({
      syncState: local.syncState,
      baseHash: base?.contentHash ?? null,
      remoteContentHash: rn?.contentHash ?? null,
      remoteDeleted: remoteTrashed,
    });
    if (decision === "upload") {
      await db.log(`[decide] ${local.id} → upload（恢复=${localRestoring}）`);
      // H3：上传前扫描本地资产 → 上传 S3 → 填入 manifest.assets（供他端下载）。P3-4：解析登记为并发任务、环后执行。
      const uploadContent = await contentOf(local);
      const entry = buildUploadEntry({
        // kind 必须透传（同软删分支）：漏了的话 manifest 不含 kind → 他端把表格/画板当 doc 导入。
        note: { id: local.id, title: local.title, parentId: local.parentId, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon, kind: local.kind },
        contentHash: localHash,
        assets: [],
        // 恢复：显式清墓碑字段（覆盖远端墓碑 → local-wins）
        trashedAt: localRestoring ? null : undefined,
        deletedFromParentId: localRestoring ? null : undefined,
      });
      assetTasks.push({ noteId: local.id, content: uploadContent, rnAssets: rn?.assets ?? null, entry, onError: async (m) => { await db.log(`[H3] ${local.id} 资产扫描失败（跳过，不影响正文上传）: ${m}`); } });
      // P3-1：上传条目此刻才取正文（仅待上传的少数笔记产生 IO）
      uploadQueue.push({ id: local.id, content: uploadContent, entry });
    } else {
      await db.log(`[decide] ${local.id} → ${decision}`);
    }
  }

  // 3.5 墓碑上传：本地已删除（deleted_notes）的条目 → manifest 恒保留 deleted 标记（审计#2：防删除复活）。
  // note 墓碑携带删除前内容（读本地 .lake 算真实 hash 上传，先内容后标志）；内容已物理删除（purge）→ 占位符 id。
  // v5 folder 墓碑（nodeType='folder'）：进 manifest.folders（deleted:true，纯元数据无对象）——folder 删除传播。
  // 墓碑 vs 远端恢复 LWW：远端已 active 且更新 → 墓碑让位（decideTombstoneYield）。
  const tombstonePublishedIds: string[] = [];
  const folderTombstoneEntries: ManifestFolder[] = [];
  {
    const localIds = new Set(localAll.map((n) => n.id));
    // P3-1：remoteById 复用上传环前建好的远端索引
    const deletedNotes = typeof db.listDeletedNotesForSync === "function" ? await db.listDeletedNotesForSync() : [];
    const remoteFolderById = new Map((remote?.folders ?? []).map((f) => [f.id, f]));
    for (const deleted of deletedNotes) {
      if (localIds.has(deleted.id)) continue;
      if (deleted.nodeType === "folder") {
        const rf = remoteFolderById.get(deleted.id);
        // 收敛减枝：远端已带同 id folder 墓碑 → 墓碑已在云端，不重建条目重发布（仅对齐记账标 published）。
        if (rf?.deleted) { tombstonePublishedIds.push(deleted.id); continue; }
        // 墓碑让位（对齐 note decideTombstoneYield）：远端活跃且 updatedAt 新于墓碑时间（恢复传播）→ 不发布墓碑。
        if (rf && !rf.deleted && rf.updatedAt > deleted.deletedAt) {
          await db.log(`[tombstone] folder ${deleted.id} 远端恢复较新，墓碑让位`);
          continue;
        }
        // 纯元数据墓碑条目（无正文对象）：nodeType 用 notebook 占位（读取端 deleted:true 时不消费该字段）。
        folderTombstoneEntries.push({
          id: deleted.id, title: deleted.title ?? deleted.id, parentId: deleted.parentId ?? null,
          sortOrder: deleted.sortOrder ?? 0, nodeType: "notebook", icon: null, updatedAt: deleted.deletedAt,
          deleted: true, deletedAt: deleted.deletedAt,
        });
        tombstonePublishedIds.push(deleted.id);
        continue;
      }
      const remoteNote = remoteById.get(deleted.id);
      if (decideTombstoneYield(deleted.deletedAt, remoteNote)) {
        await db.log(`[tombstone] ${deleted.id} 远端恢复较新，墓碑让位`);
        continue;
      }
      // 收敛减枝：远端 manifest 已带 deleted:true 墓碑 → 墓碑已在云端，无需重建占位符条目重发布
      // （否则每次真实变更后每台设备都会因占位符墓碑再各发布一轮 manifest）。仅对齐记账（标 published）。
      if (remoteNote?.deleted) {
        tombstonePublishedIds.push(deleted.id);
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

  // P3-4：跨笔记并发解析并回填 entry.assets（各任务只改写自己那份已入队 entry，顺序无关；失败沿用原「吞并+日志、不影响正文发布」语义）。
  if (assetTasks.length > 0) {
    await runAssetPool(assetTasks, NOTE_UPLOAD_CONCURRENCY, async (t) => {
      try {
        t.entry.assets = await resolveUploadAssets(t.noteId, t.content, t.rnAssets);
      } catch (e) {
        assetScanFailed.add(t.noteId);
        await t.onError((e as Error).message);
      }
    });
  }

  // ---- 4. 上传对象（内容寻址幂等）+ 组装新 manifest ----
  progress("upload", `上传 ${uploadQueue.length} 条`);
  let next: Manifest | null = null;
  // 发布条件：有上传，或本地存在 purged 条目（须重写 manifest 移除该条目——云端删除已完成，
  // 对齐桌面"purged 不上传且 manifestNotes 不含 purged"的语义），
  // 或本地目录树有变更（回收站笔记本 / 移动 / 改名 / 图标——对齐桌面 sync.ts 每次同步无条件发布
  // manifest，folders 变更必须传播；迁移回归修复：否则删笔记本不传播 + 目录记账抹掉 local），
  // 或存在待发布的 folder 墓碑（v5：folder 删除传播）。
  if (uploadQueue.length > 0 || purgedIds.size > 0 || foldersChanged || folderTombstoneEntries.length > 0) {
    // 正文对象上传：内容寻址幂等、条目相互独立 → 并发池（对齐 P3-3 资产并发；旧串行逐条 await，
    // 实测 N 篇笔记正文上传是同步尾部长尾）。worker 内不抛错——错误按索引收集、池后按序抛首个，
    // 避免某条失败时其它并发车道的拒绝变成 unhandledRejection；且任一上传失败必须让整轮同步报错、
    // 不得继续发布 manifest 引用未落盘正文（与旧串行首错即止等价：失败即中止，manifest 不写）。
    const contentErrors: Array<unknown> = new Array(uploadQueue.length).fill(null);
    await runAssetPool(uploadQueue, UPLOAD_CONCURRENCY, async (item, i) => {
      try {
        // 占位符墓碑（tombstone && content 为空，purge 已物理删除内容）：不重算 hash（保留占位符 id）、
        // 不传空对象（否则 contentHash 被覆盖成 sha256(空串) + 空对象残留——迁移回归），仅写 deleted 标记。
        if (item.tombstone && item.content === "") return;
        const contentBytes = new TextEncoder().encode(item.content);
        const hash = sha256Sync(contentBytes);
        if (item.entry.contentHash !== hash) item.entry.contentHash = hash;
        await s3.putObject(`${cfg.prefix}/${objectKey(item.id, item.entry.contentHash)}`, item.content);
        report.uploaded++;
        report.uploadedBytes += contentBytes.length;
      } catch (e) {
        contentErrors[i] = e;
      }
    });
    for (const e of contentErrors) if (e) throw e;
    next = {
      version: MANIFEST_VERSION,
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
      const localFolders = await db.listFoldersForSync();
      // 空数组也必须覆盖（≠ null）：本地树为空（如 purge 清空全部目录）时，活跃条目必须清空
      // 移除云端残留（否则远端 folders 残留被保留，下轮同步重新导入 → "清空回收站后同步 → 被删的又回来"）。
      // 仅 null（端口未实现目录发布）才保持远端透传。
      if (localFolders !== null && localFolders !== undefined) {
        // v5 合并规则（同 id 后写覆盖）：远端墓碑保留（防复活）← 本地活跃行（恢复场景胜出）← 本轮新墓碑（删除胜出）。
        // 学习端（行标 purged 被 listFoldersForSync 过滤）天然缺席 → 不回填；purged 行下轮恢复时以活跃行覆盖墓碑。
        const folderById = new Map((remote?.folders ?? []).filter((f) => f.deleted).map((f) => [f.id, f]));
        for (const f of localFolders) {
          folderById.set(f.id, {
            id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType as "notebook" | "group",
            icon: f.icon, updatedAt: f.updatedAt,
            trashedAt: f.trashedAt ?? undefined,
            deletedFromParentId: f.deletedFromParentId ?? undefined,
          });
        }
        for (const t of folderTombstoneEntries) folderById.set(t.id, t);
        next.folders = [...folderById.values()];
      } else if (folderTombstoneEntries.length > 0) {
        // 端口不发布目录（POC 透传）：仅追加本轮新墓碑（同 id 覆盖活跃残留）。
        const folderById = new Map((remote?.folders ?? []).map((f) => [f.id, f]));
        for (const t of folderTombstoneEntries) folderById.set(t.id, t);
        next.folders = [...folderById.values()];
      }
    }

    // ---- 5. 发布：commit（简化，仅 latest）+ latest ----
    const manifestJson = JSON.stringify(next);
    await s3.putObject(`${cfg.prefix}/manifests/${next.commitId}.json`, manifestJson, { gzip: true });
    await s3.putObject(`${cfg.prefix}/${MANIFEST_KEY}`, manifestJson, { gzip: true });
    report.uploadedBytes += manifestJson.length * 2;
    report.published = true;
    // 桌面 GC 差集标记钩子（4.5）：发布后暴露 next/prev，桌面 Controller 算待回收引用
    try { await opts?.onPublished?.(next, remote); } catch { /* 钩子失败不阻断 */ }
    progress("publish", `发布 manifest（应用 ${report.appliedRemote}，上传 ${report.uploaded}）`);

    // ---- 6. 记账（B2 快照保护：同步期间被编辑则不标，等下轮重传） ----
    for (const item of uploadQueue) {
      // P1：本轮资产扫描失败的笔记不 markSynced → 保持 local，下轮自动重扫重传其资产，防止 assets:[] 发布后被误标已同步、
      // 再不清空声明导致原资产被 GC 误删（AGENTS #11 全量声明红线）。其余正常条目照常按 B2 快照保护记账。
      if (assetScanFailed.has(item.id)) { await db.log(`[H3] ${item.id} 本轮资产未齐，保持 local 待下轮重扫（不 markSynced）`); continue; }
      // 软删（trashedAt）/墓碑（deleted）条目本机未上传新正文：不写 lastUploadedHash，
      // 否则误标"本机是作者"→ 后续 ownEdit 判定恒成立、每次同步重复留档（对齐旧 sync.ts locallyUploadedIds）。
      const lastUploaded = item.entry.trashedAt || item.entry.deleted ? null : item.entry.contentHash;
      await db.markSyncedIfUnchanged(item.id, item.entry.contentHash, item.entry.updatedAt, lastUploaded);
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
      await db.markSyncedIfUnchanged(rn.id, rn.contentHash, rn.updatedAt, null);
    }
  }

  // 墓碑记账收尾（无论本轮是否发布 manifest）：push 进 tombstonePublishedIds 的两种情况——
  // ①收敛减枝（远端已带同 id 墓碑，无需再发布）②本轮已随 manifest 发布。两种情况的墓碑都已在云端，
  // 必须标 published_at 从待上传计数移除；原先只在发布分支内 mark → 收敛减枝场景永不记账，
  // purge 后 pending documents/folders 永久挂起（260910 实测：B 端两轮同步后 published_at 仍 NULL）。
  if (tombstonePublishedIds.length > 0 && typeof db.markTombstonesPublished === "function") {
    await db.markTombstonesPublished(tombstonePublishedIds);
  }

  // 目录记账（对齐桌面 sync.ts:789-793）：latest 发布成功后，用构建 manifest 时的 updatedAt 快照
  // 归位 folders——同步期间本地再改 group 则 updated_at 变化 → 不归位，保持 local 下轮重传。
  if (typeof db.markFolderSynced === "function" && typeof db.listFoldersForSync === "function") {
    try {
      for (const f of (await db.listFoldersForSync()) ?? []) {
        await db.markFolderSynced(f.id, f.updatedAt);
      }
    } catch { /* 目录记账失败不阻断 */ }
  }

  // 零变更早退的基线：记录本次成功读/写的 commitId 与墓碑签名（对齐桌面 sync.ts:827-828）。
  // 有发布 → 新 commitId；仅拉取对账 → 远端 latest 的 commitId（下次无变化时即可早退）。
  const finalCommitId = next?.commitId ?? remote?.commitId ?? null;
  if (finalCommitId != null) {
    await db.setLastSeenCommitId(finalCommitId);
    await db.setLastTombstoneSig(await db.tombstoneSignature());
  }
  report.supersededNotes = supersededTracker.list();

  const warnSuffix = report.warnings.length > 0 ? `，警告 ${report.warnings.length}` : "";
  report.message = `拉取 ${remote ? remote.notes.length : 0} 条，应用 ${report.appliedRemote}，上传 ${report.uploaded}，发布 ${report.published ? "是" : "否"}${warnSuffix}`;
  return report;
}
