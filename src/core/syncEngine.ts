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
import { buildUploadEntry, buildTombstoneEntry, decideMetaApply, decidePurge, TRASH_NOTEBOOK_ID } from "./syncDecisions.js";
import { mergeLockState } from "./syncDecision.js";
import type { Manifest, ManifestFolder, ManifestNote } from "./manifestTypes.js";
import { sha256Sync } from "./sha256Sync.js";
import { parseLakeManifest, objectKey } from "./syncUtils.js";

/** 对象存储读取返回字节；正文对象是纯文本 Lake HTML，解码为字符串。 */
const decodeText = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** D8：下载笔记关联资产（内容寻址 assets/{noteId}/{filename}），校验 size/sha256 后落盘。
 * 读优先移动端语义：单个资源缺失/损坏 → 该资源跳过 + warning（图片占位），不阻断笔记正文导入。 */
async function downloadAssets(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, rn: ManifestNote, report: SyncReport): Promise<void> {
  for (const asset of rn.assets ?? []) {
    const bytes = await s3.getObject(`${cfg.prefix}/assets/${rn.id}/${asset.filename}`);
    if (bytes == null) { report.warnings.push(`资源缺失（跳过）: ${rn.id}/${asset.filename}`); continue; }
    if (bytes.length !== asset.size) { report.warnings.push(`资源大小不符（跳过）: ${rn.id}/${asset.filename}`); continue; }
    if (sha256Sync(bytes) !== asset.hash) { report.warnings.push(`资源哈希不符（跳过）: ${rn.id}/${asset.filename}`); continue; }
    await db.saveAsset(rn.id, asset.filename, bytes);
  }
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
   * 返回**已解压**字节（gunzip 在端口内完成，syncEngine 不感知 gzip——红线 §3.2）。 */
  getObject(key: string): Promise<Uint8Array | null>;
  /** 写入对象；opts.gzip 由端口压缩（manifest 传 {gzip:true}，正文/资源不压缩）。 */
  putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
}

export interface SyncReport {
  pulled: boolean;
  appliedRemote: number;
  uploaded: number;
  published: boolean;
  message: string;
  warnings: string[];
}

export interface LocalNoteRow {
  id: string; title: string; content: string; updatedAt: string; syncState: string;
  trashedAt: string | null; restorePendingAt: string | null; parentId: string | null; sortOrder: number;
  /** 协议字段透传（D9）：锁/图标/冲突标记不得因移动端不展示而丢失（红线 §3.5）。 */
  isLocked: boolean; lockedAt: string | null; icon: string | null; isConflict: boolean;
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
  /** 记录"从云端学到的删除"（本设备从未持有该笔记），防离线设备把残留当新文档上传复活（审计 #2）。 */
  rememberDeleted(note: ManifestNote, deletedAt: string): void;
  /** 正文相同但元数据（标题/父/排序/图标）变化时应用远端较新版本（B3 LWW）。 */
  applyRemoteNoteMeta(note: ManifestNote): void;
  /** 锁字段级 LWW：应用远端锁状态（锁变更不改正文哈希，需独立应用）。 */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void;
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string): void;
  /** 记账快照保护（B2，V5 §5.2）：仅当本地当前内容 hash 仍等于 expectedContentHash（同步期间未编辑）才标 synced；否则保持 local 下轮重传。 */
  markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string): void;
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): void;
  /** 默认个人笔记本 id（effectiveParent 回退基准；对齐桌面 store.ts DEFAULT_NOTEBOOK_ID）。 */
  defaultNotebookId(): string;
  /** 导入远端 notebook/group 节点（移动端 folders/tree 表）。 */
  importRemoteFolder(folder: ManifestFolder): void;
  /** 本机编辑成果被远端覆盖前强制留档（D5，协议 §4.2）：写一条 note_history，防丢数据。 */
  createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }): void;
  /** 资产落地（D8）：把已校验的图片字节写入本地（Capacitor Filesystem / IndexedDB），供 blob 注入。 */
  saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void>;
  log(msg: string): void;
}

const MANIFEST_KEY = "manifests/latest.json";

export async function syncNow(cfg: SyncConfig, s3: S3Store, db: SyncDbPort): Promise<SyncReport> {
  const report: SyncReport = { pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "", warnings: [] };

  // ---- 1. 拉 latest manifest（缺失视为首次同步） ----
  let remote: Manifest | null = null;
  try {
    const manifestBytes = await s3.getObject(`${cfg.prefix}/${MANIFEST_KEY}`);
    if (manifestBytes != null) {
      remote = parseLakeManifest(manifestBytes);
      report.pulled = true;
    } else {
      db.log("首次同步：无 latest manifest");
    }
  } catch (e) {
    report.message = `拉取 manifest 失败: ${(e as Error).message}`;
    return report;
  }

  const uploadQueue: Array<{ id: string; entry: ManifestNote; content: string }> = [];

  // ---- 2. 下载方向：墓碑/恢复分支 → reconcile 对账 → 应用远端 ----
  if (remote) {
    // D4：先导入目录树（保证文档父 notebook/group 已存在），并构建 validParents——
    // 父节点集合 = 默认笔记本 + 回收站笔记本 + 远端 folders + 远端 active 笔记 id + 本地已有节点。
    // effectiveParent 据此回退，防"父目录缺失 → 文档消失/归属错位"（对齐桌面 sync.ts:344-363/395）。
    const defaultNotebook = db.defaultNotebookId();
    const validParents = new Set<string>([defaultNotebook, TRASH_NOTEBOOK_ID]);
    for (const folder of remote.folders) {
      db.importRemoteFolder(folder);
      validParents.add(folder.id);
    }
    for (const rn of remote.notes) if (!rn.deleted) validParents.add(rn.id);
    for (const localNote of db.getAllNotes()) validParents.add(localNote.id);

    for (const rn of remote.notes) {
      const local = db.getNote(rn.id);
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
          db.applyRemotePurge(rn.id);
          report.appliedRemote++;
        } else {
          db.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
        }
        continue;
      }

      if (remoteTrashed && !localRestoring) {
        // 远端墓碑（删除压编辑）：本地无显式恢复 → 跟随删除
        if (!localTrashed) {
          const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
          if (contentBytes == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          db.applyRemoteTrash(rn.id, decodeText(contentBytes), rn.title, rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, rn.deletedFromParentId ?? null, rn.parentId, rn.sortOrder);
          await downloadAssets(cfg, s3, db, rn, report);
          report.appliedRemote++;
        }
        // 本地已在回收站 → 一致，无操作
        continue;
      }

      if (localTrashed && !localRestoring) {
        // 本地在回收站、远端 active：时间比较决定胜负
        // - 远端 updatedAt 新于本地删除时间 → 远端恢复较新，跟随恢复
        // - 本地删除时间新于远端 → 本地删除压远端 active（删除压编辑），保留删除，步骤 3 上传墓碑
        const remoteNewer = (rn.updatedAt ?? "") > (local.trashedAt ?? "");
        if (remoteNewer) {
          const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
          if (contentBytes == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          // 跟随恢复 = 应用远端 active（dbPort 清 trashed_at）+ 记账
          db.applyRemoteNote({ ...rn, parentId: effectiveParent, trashedAt: null, deleted: false, deletedAt: undefined, deletedFromParentId: null }, decodeText(contentBytes));
          await downloadAssets(cfg, s3, db, rn, report);
          db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
        } else {
          db.log(`[tombstone] ${rn.id} 本地删除较新，保留删除（远端 active 让位），步骤 3 上传墓碑`);
        }
        continue;
      }

      // 正常对账（含本地显式恢复 restore_pending_at → local-wins 走上传）
      const base = db.getSyncBase(rn.id);
      const localHash = local ? sha256Sync(new TextEncoder().encode(local.content)) : null;
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
          if (decideMetaApply(rn.updatedAt, base?.lastSyncedMetaAt ?? null)) {
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
        const contentBytes = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
        if (contentBytes == null) {
          report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
          continue;
        }
        // D5：本机编辑成果被远端覆盖 → 先强制留档（协议 §4.2，防丢数据），再接受远端
        if (action.superseded && local) {
          db.createHistorySnapshot(rn.id, local.content, { title: local.title, parentId: local.parentId, sortOrder: local.sortOrder });
        }
        db.applyRemoteNote({ ...rn, parentId: effectiveParent, trashedAt: null, deleted: false }, decodeText(contentBytes));
        await downloadAssets(cfg, s3, db, rn, report);
        db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        report.appliedRemote++;
      }
      // local-wins 不在此入队：统一由步骤 3 decideUpload 决定（skip-fast 覆盖）
    }
  }

  // ---- 3. 上传方向：墓碑 / 恢复 / 正常（decideUpload） ----
  const localAll = db.getAllNotes();
  for (const local of localAll) {
    // B4：本地已 purge（收到他端删除后的保留副本）不上传——恢复 = 清 purged 后再上传（对齐桌面 sync.ts:641）
    if (local.syncState === "purged") continue;
    const rn = remote?.notes.find((n) => n.id === local.id) ?? null;
    const localHash = sha256Sync(new TextEncoder().encode(local.content));
    const localTrashed = local.trashedAt != null;
    const localRestoring = local.restorePendingAt != null;
    const remoteTrashed = rn ? !!rn.trashedAt || !!rn.deleted : false;

    if (localTrashed && !localRestoring) {
      // 本地回收站（软删）→ 用 buildUploadEntry 编码：parentId=TRASH + trashedAt，**无 deleted:true**。
      // 与桌面一致——软删=移动到"回收站笔记本"，deleted:true 仅用于 purge 墓碑（红线 §3、踩坑 #4）。
      // 混用=普通删除被当永久删除，是 B1 致命 bug（当前改前实现就写 deleted:true）。
      if (rn && remoteTrashed) {
        db.log(`[tombstone] ${local.id} 两端一致（已删除），skip`);
        db.markLocalNoteSynced(local.id, rn.contentHash, local.updatedAt, rn.contentHash);
        continue;
      }
      db.log(`[tombstone] ${local.id} 上传软删条目（parentId=TRASH + trashedAt，非 deleted）`);
      const entry = buildUploadEntry({
        note: { id: local.id, title: local.title, parentId: TRASH_NOTEBOOK_ID, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon, trashedAt: local.trashedAt, deletedFromParentId: local.parentId },
        contentHash: localHash,
        assets: [],
        trashedAt: local.trashedAt,
        deletedFromParentId: local.parentId,
      });
      uploadQueue.push({ id: local.id, content: local.content, entry });
      continue;
    }

    // 正常（含恢复：restore_pending_at → active 上传覆盖墓碑）
    const base = db.getSyncBase(local.id);
    db.log(
      `[decide] ${local.id} syncState=${local.syncState} restoring=${localRestoring} trashed=${localTrashed} baseHash=${base?.contentHash ?? "null"} localHash=${localHash.slice(0, 8)} remoteHash=${rn?.contentHash?.slice(0, 8) ?? "null"} remoteTrashed=${remoteTrashed}`
    );
    const decision = decideUpload({
      syncState: local.syncState,
      baseHash: base?.contentHash ?? null,
      remoteContentHash: rn?.contentHash ?? null,
      remoteDeleted: remoteTrashed,
    });
    if (decision === "upload") {
      db.log(`[decide] ${local.id} → upload（恢复=${localRestoring}）`);
      const entry = buildUploadEntry({
        note: { id: local.id, title: local.title, parentId: local.parentId, sortOrder: local.sortOrder, updatedAt: local.updatedAt, syncState: local.syncState, isConflict: local.isConflict, isLocked: local.isLocked, lockedAt: local.lockedAt, icon: local.icon },
        contentHash: localHash,
        assets: [],
        // 恢复：显式清墓碑字段（覆盖远端墓碑 → local-wins）
        trashedAt: localRestoring ? null : undefined,
        deletedFromParentId: localRestoring ? null : undefined,
      });
      uploadQueue.push({ id: local.id, content: local.content, entry });
    } else {
      db.log(`[decide] ${local.id} → ${decision}`);
    }
  }

  // ---- 4. 上传对象（内容寻址幂等）+ 组装新 manifest ----
  let next: Manifest | null = null;
  if (uploadQueue.length > 0) {
    for (const item of uploadQueue) {
      const hash = sha256Sync(new TextEncoder().encode(item.content));
      if (item.entry.contentHash !== hash) item.entry.contentHash = hash;
      await s3.putObject(`${cfg.prefix}/${objectKey(item.id, item.entry.contentHash)}`, item.content);
      report.uploaded++;
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
    for (const item of uploadQueue) {
      const idx = next.notes.findIndex((n) => n.id === item.id);
      if (idx >= 0) next.notes[idx] = item.entry;
      else next.notes.push(item.entry);
    }

    // ---- 5. 发布：commit（简化，仅 latest）+ latest ----
    await s3.putObject(`${cfg.prefix}/manifests/${next.commitId}.json`, JSON.stringify(next), { gzip: true });
    await s3.putObject(`${cfg.prefix}/${MANIFEST_KEY}`, JSON.stringify(next), { gzip: true });
    report.published = true;

    // ---- 6. 记账（B2 快照保护：同步期间被编辑则不标，等下轮重传） ----
    for (const item of uploadQueue) {
      db.markSyncedIfUnchanged(item.id, item.entry.contentHash, item.entry.updatedAt, item.entry.contentHash);
    }
  } else {
    // 无上传：把已应用/对账的条目记账（对账收尾）。
    // 只标记"本地仍有、非 purge、远端非墓碑"的 active 条目——purge 墓碑与 remembered 删除
    // 不得被重标 synced（B4：否则本地 purge 后的保留副本被误当正常上传、删除复活）。
    for (const rn of remote?.notes ?? []) {
      if (rn.deleted) continue;
      const loc = db.getNote(rn.id);
      if (!loc || loc.syncState === "purged") continue;
      db.markSyncedIfUnchanged(rn.id, rn.contentHash, rn.updatedAt, rn.contentHash);
    }
  }

  report.message = `拉取 ${remote ? remote.notes.length : 0} 条，应用 ${report.appliedRemote}，上传 ${report.uploaded}，发布 ${report.published ? "是" : "否"}${report.warnings.length ? `，警告 ${report.warnings.length}` : ""}`;
  return report;
}
