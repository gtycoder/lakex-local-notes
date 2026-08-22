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
import type { Manifest, ManifestNote } from "./manifestTypes.js";
import { sha256Hex } from "./sha256.js";

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
  /** 读取对象；404 返回 null（首次同步判定），其他错误抛出 */
  getObject(key: string): Promise<string | null>;
  putObject(key: string, body: string | Uint8Array): Promise<void>;
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
}

export interface SyncDbPort {
  getNote(id: string): LocalNoteRow | null;
  getAllNotes(): LocalNoteRow[];
  getSyncBase(id: string): { contentHash: string; lastUploadedHash: string | null } | null;
  applyRemoteNote(note: ManifestNote, content: string): void;
  /** 远端墓碑应用：先拉内容再标记回收站（先内容、后标志；保留可恢复） */
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, deletedFromParentId: string | null, parentId: string | null, sortOrder: number): void;
  /** 本地软删（入回收站）：保留内容，sync_state=local */
  localTrashNote(id: string): void;
  /** 本地恢复：移出回收站 + restore_pending_at（同步时 local-wins 上传 active 覆盖墓碑） */
  localRestoreNote(id: string): void;
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string): void;
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): void;
  log(msg: string): void;
}

const MANIFEST_KEY = "manifests/latest.json";

function objectKey(noteId: string, contentHash: string): string {
  return `objects/${noteId}-${contentHash}.lake`;
}

export async function syncNow(cfg: SyncConfig, s3: S3Store, db: SyncDbPort): Promise<SyncReport> {
  const report: SyncReport = { pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "", warnings: [] };

  // ---- 1. 拉 latest manifest（缺失视为首次同步） ----
  let remote: Manifest | null = null;
  try {
    const raw = await s3.getObject(`${cfg.prefix}/${MANIFEST_KEY}`);
    if (raw != null) {
      remote = JSON.parse(raw) as Manifest;
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
    for (const rn of remote.notes) {
      const local = db.getNote(rn.id);
      const remoteTrashed = !!rn.trashedAt || !!rn.deleted;
      const localTrashed = local?.trashedAt != null;
      const localRestoring = local?.restorePendingAt != null;

      if (remoteTrashed && !localRestoring) {
        // 远端墓碑（删除压编辑）：本地无显式恢复 → 跟随删除
        if (!localTrashed) {
          const content = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
          if (content == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          db.applyRemoteTrash(rn.id, content, rn.title, rn.trashedAt ?? rn.deletedAt ?? rn.updatedAt, rn.deletedFromParentId ?? null, rn.parentId, rn.sortOrder);
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
          const content = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
          if (content == null) {
            report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
            continue;
          }
          // 跟随恢复 = 应用远端 active（dbPort 清 trashed_at）+ 记账
          db.applyRemoteNote({ ...rn, trashedAt: null, deleted: false, deletedAt: undefined, deletedFromParentId: null }, content);
          db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
          report.appliedRemote++;
        } else {
          db.log(`[tombstone] ${rn.id} 本地删除较新，保留删除（远端 active 让位），步骤 3 上传墓碑`);
        }
        continue;
      }

      // 正常对账（含本地显式恢复 restore_pending_at → local-wins 走上传）
      const base = db.getSyncBase(rn.id);
      const localHash = local ? await sha256Hex(local.content) : null;
      // 幂等应用优化：本地内容与远端 hash 一致 → 仅对齐记账，不重复下载应用
      if (localHash === rn.contentHash) {
        db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        continue;
      }
      const action = reconcileLakeNote({
        baseHash: base?.contentHash ?? null,
        localHash,
        remoteHash: rn.contentHash,
        lastUploadedHash: base?.lastUploadedHash ?? null,
        localInTrash: localTrashed,
      });
      if (action.kind === "remote-wins") {
        const content = await s3.getObject(`${cfg.prefix}/${objectKey(rn.id, rn.contentHash)}`);
        if (content == null) {
          report.warnings.push(`对象缺失（跳过+warning，B 方案）: ${rn.id}-${rn.contentHash}`);
          continue;
        }
        db.applyRemoteNote({ ...rn, trashedAt: null, deleted: false }, content);
        db.setSyncBase(rn.id, rn.contentHash, rn.updatedAt, null);
        report.appliedRemote++;
      }
      // local-wins 不在此入队：统一由步骤 3 decideUpload 决定（skip-fast 覆盖）
    }
  }

  // ---- 3. 上传方向：墓碑 / 恢复 / 正常（decideUpload） ----
  const localAll = db.getAllNotes();
  for (const local of localAll) {
    const rn = remote?.notes.find((n) => n.id === local.id) ?? null;
    const localHash = await sha256Hex(local.content);
    const localTrashed = local.trashedAt != null;
    const localRestoring = local.restorePendingAt != null;
    const remoteTrashed = rn ? !!rn.trashedAt || !!rn.deleted : false;

    if (localTrashed && !localRestoring) {
      // 本地回收站 → 墓碑上传（删除前内容对象 + deleted 标记）；远端已是墓碑则 skip
      if (rn && remoteTrashed) {
        db.log(`[tombstone] ${local.id} 两端一致（已删除），skip`);
        db.markLocalNoteSynced(local.id, rn.contentHash, local.updatedAt, rn.contentHash);
        continue;
      }
      db.log(`[tombstone] ${local.id} 上传墓碑（携带删除前内容）`);
      uploadQueue.push({
        id: local.id,
        content: local.content,
        entry: {
          id: local.id, title: local.title, parentId: local.parentId, sortOrder: local.sortOrder,
          updatedAt: local.updatedAt, contentHash: localHash, isConflict: false, assets: [],
          deleted: true, deletedAt: local.trashedAt ?? undefined, trashedAt: local.trashedAt,
          deletedFromParentId: local.parentId,
        },
      });
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
      uploadQueue.push({
        id: local.id,
        content: local.content,
        entry: {
          id: local.id, title: local.title, parentId: local.parentId, sortOrder: local.sortOrder,
          updatedAt: local.updatedAt, contentHash: localHash, isConflict: false, assets: [],
          // 恢复：显式清墓碑字段（覆盖远端墓碑 → local-wins）
          deleted: false, deletedAt: undefined, trashedAt: null, deletedFromParentId: null,
        },
      });
    } else {
      db.log(`[decide] ${local.id} → ${decision}`);
    }
  }

  // ---- 4. 上传对象（内容寻址幂等）+ 组装新 manifest ----
  let next: Manifest | null = null;
  if (uploadQueue.length > 0) {
    for (const item of uploadQueue) {
      const hash = await sha256Hex(item.content);
      if (item.entry.contentHash !== hash) item.entry.contentHash = hash;
      await s3.putObject(`${cfg.prefix}/${objectKey(item.id, item.entry.contentHash)}`, item.content);
      report.uploaded++;
    }
    next = {
      version: 4,
      workspaceId: "default",
      commitId: crypto.randomUUID(),
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
    await s3.putObject(`${cfg.prefix}/manifests/${next.commitId}.json`, JSON.stringify(next));
    await s3.putObject(`${cfg.prefix}/${MANIFEST_KEY}`, JSON.stringify(next));
    report.published = true;

    // ---- 6. 记账 ----
    for (const item of uploadQueue) {
      db.markLocalNoteSynced(item.id, item.entry.contentHash, item.entry.updatedAt, item.entry.contentHash);
    }
  } else {
    // 无上传：把已应用远端的条目记账（对账收尾）
    for (const rn of remote?.notes ?? []) {
      db.markLocalNoteSynced(rn.id, rn.contentHash, rn.updatedAt, rn.contentHash);
    }
  }

  report.message = `拉取 ${remote ? remote.notes.length : 0} 条，应用 ${report.appliedRemote}，上传 ${report.uploaded}，发布 ${report.published ? "是" : "否"}${report.warnings.length ? `，警告 ${report.warnings.length}` : ""}`;
  return report;
}
