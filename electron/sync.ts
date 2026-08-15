import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { Store } from "./store.js";
import { log } from "./logger.js";

// ===== 类型 =====
export interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  /** v3：只读锁元数据（独立于正文哈希，按 lockedAt 字段级 LWW 合并） */
  isLocked?: boolean;
  lockedAt?: string | null;
  /** 文档自定义图标（可选字段，旧清单无此字段时本地保持原样） */
  icon?: string | null;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean;
  deletedAt?: string;
}

/** 锁状态 LWW：时间戳新者胜；相同时间戳取“锁优先”（保守防误改）。返回胜出的 {locked, at}。 */
function mergeLockState(localLocked: boolean, localAt: string | null, remoteLocked: boolean, remoteAt: string | null): { locked: boolean; at: string | null } {
  if (!localAt && !remoteAt) return { locked: remoteLocked, at: remoteAt };
  if (!localAt) return { locked: remoteLocked, at: remoteAt };
  if (!remoteAt) return { locked: localLocked, at: localAt };
  if (remoteAt > localAt) return { locked: remoteLocked, at: remoteAt };
  if (remoteAt < localAt) return { locked: localLocked, at: localAt };
  return { locked: localLocked || remoteLocked, at: localAt };
}

interface ManifestFolder {
  id: string; title: string; parentId: string | null;
  sortOrder: number; nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
}

interface Manifest {
  version: number; workspaceId: string; commitId: string;
  prevCommitId: string | null;                 // 上一份 commitId（本设备上次读取/写入的 commit）
  createdAt: string; notes: ManifestNote[];
  /** 目录树（notebook/group）。 */
  folders: ManifestFolder[];
}

export interface QuickNotesSyncStatus {
  uploaded: number; downloaded: number; conflicts: number;
  completedAt: string;
  error?: string;
}

export interface SyncResult {
  uploaded: number; downloaded: number; conflicts: number;
  manifestId: string; completedAt: string;
  /** 小记是独立同步空间，失败不会否定 Lake 文档本身的同步结果。 */
  quickNotes?: QuickNotesSyncStatus;
  /** 本地修改被远端覆盖、已存入历史的文档（用于 UI 提醒） */
  supersededNotes: Array<{ id: string; title: string }>;
}

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  /** 主循环进度：笔记条目 */
  current?: number;
  total?: number;
  /** 资源（图片/附件）子进度 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
  /** done 阶段附带：本地改动被远端覆盖、已存入历史的文档。 */
  supersededNotes?: Array<{ id: string; title: string }>;
  /** 同步失败时附带错误信息。 */
  error?: string;
}

const MANIFEST_VERSION = 4;
/** gzip 魔数（0x1f 0x8b）。JSON/PNG/JPEG 等实际内容不可能以此开头，可按魔数安全识别 gzip 对象。 */
const GZIP_MAGIC = [0x1f, 0x8b];
function isGzip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

const objectKey = (noteId: string, contentHash: string): string => `objects/${noteId}-${contentHash}.lake`;

// ===== ObjectStore：S3 兼容客户端（七牛云等） =====
export class ObjectStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(settings: S3Settings) {
    this.bucket = settings.bucket.trim();
    this.prefix = settings.prefix.trim().replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      region: settings.region.trim() || "cn-east-1",
      // 参照思源 NormalizeEndpoint：规范化 endpoint（协议/斜杠/尾部）
      endpoint: normalizeEndpoint(settings.endpoint),
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId.trim(),
        secretAccessKey: settings.secretAccessKey.trim(),
      },
      maxAttempts: 3,
      requestHandler: undefined,
    });
  }

  private key(suffix: string): string {
    return this.prefix ? `${this.prefix}/${suffix}` : suffix;
  }

  async test(): Promise<void> {
    const t0 = Date.now();
    try {
      // 七牛 Kodo S3 兼容层不支持 HeadBucket（对存在的桶也会返回 404/UnknownError），
      // 改用 ListObjectsV2 探测连接与桶存在性。
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      log.s3.info(`[perf] test ${Date.now() - t0}ms ok`);
    } catch (error) {
      log.s3.warn(`[perf] test FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 连接失败: ${errorMessage(error)}`);
    }
  }

  async getOptional(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      const bytes = output.Body ? Buffer.from(await output.Body.transformToByteArray()) : Buffer.alloc(0);
      // manifest 等 gzip 对象透明解压（按魔数识别；ContentEncoding 自动解压与原始字节两种响应均兼容）
      const out = isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes;
      log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms (${bytes.length}B${out !== bytes ? ` -> ${out.length}B gzip` : ""})`);
      return out;
    } catch (error) {
      if (isNoSuchKey(error)) { log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms MISS`); return null; }
      log.s3.warn(`[perf] get ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 读取失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async put(key: string, bytes: Buffer, contentType: string, opts?: { cacheControl?: "no-cache" | "no-store"; gzip?: boolean }): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    let body = bytes;
    const command: Record<string, unknown> = {
      Bucket: this.bucket,
      Key: this.key(key),
      Body: body,
      ContentType: contentType,
      CacheControl: opts?.cacheControl ?? "no-cache",
    };
    if (opts?.gzip) {
      body = zlib.gzipSync(bytes, { level: 9 });
      command.Body = body;
      command.ContentEncoding = "gzip";
    }
    try {
      await this.client.send(new PutObjectCommand(command as never));
      log.s3.info(`[perf] put ${key} ${Date.now() - t0}ms (${body.length}B${opts?.gzip ? ` gzip of ${bytes.length}B` : ""})`);
    } catch (error) {
      log.s3.warn(`[perf] put ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 上传失败 (${key}): ${errorMessage(error)}`);
    }
  }

  /** ListObjectsV2 分页列出前缀下键（返回相对键 + LastModified）。 */
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string }>> {
    const t0 = Date.now();
    const fullPrefix = this.key(prefix);
    const out: Array<{ key: string; lastModified: string }> = [];
    let continuationToken: string | undefined;
    let pages = 0;
    do {
      pages += 1;
      const output = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of output.Contents ?? []) {
        if (typeof obj.Key !== "string") continue;
        out.push({ key: this.unkey(obj.Key), lastModified: obj.LastModified?.toISOString() ?? "" });
      }
      continuationToken = output.NextContinuationToken;
    } while (continuationToken);
    log.s3.info(`[perf] list ${prefix} ${Date.now() - t0}ms (${out.length} keys, ${pages} pages)`);
    return out;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      log.s3.info(`[perf] delete ${key} ${Date.now() - t0}ms`);
    } catch (error) {
      if (isNoSuchKey(error)) return;
      log.s3.warn(`[perf] delete ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 删除失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const t0 = Date.now();
    for (const chunk of chunkArray(keys, 1000)) {
      for (const k of chunk) assertSafeKey(k);
      try {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: this.key(k) })), Quiet: true },
        }));
      } catch (error) {
        log.s3.warn(`[perf] deleteMany ${chunk.length} keys FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
        throw new Error(`S3 批量删除失败 (${chunk.length} 键): ${errorMessage(error)}`);
      }
    }
    log.s3.info(`[perf] deleteMany ${keys.length} keys ${Date.now() - t0}ms`);
  }

  /** 前缀删除：列出 + 分批删除（用于 purge）。404 与空列表均幂等。 */
  async deletePrefix(prefix: string): Promise<number> {
    const t0 = Date.now();
    const items = await this.list(prefix);
    const keys = items.map((i) => i.key);
    await this.deleteMany(keys);
    log.s3.info(`[perf] deletePrefix ${prefix} ${Date.now() - t0}ms (${keys.length} keys)`);
    return keys.length;
  }

  private unkey(full: string): string {
    return this.prefix && full.startsWith(`${this.prefix}/`) ? full.slice(this.prefix.length + 1) : full;
  }
}

// ===== 对外 API =====

export async function testConnection(store: Store): Promise<string> {
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  await remote.test();
  return "连接成功，Bucket 可访问";
}

export async function syncNow(store: Store, onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const syncStart = Date.now();
  log.sync.info("[perf] syncNow start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "connect", message: "正在连接 S3..." });
  const connectStart = Date.now();
  await remote.test();
  log.sync.info(`[perf] connect ${Date.now() - connectStart}ms`);

  // 1. 读取远程清单
  const manifestBytes = await remote.getOptional("manifests/latest.json");
  const remoteManifest: Manifest | null = manifestBytes ? JSON.parse(manifestBytes.toString("utf8")) : null;
  if (remoteManifest) validateManifest(remoteManifest);

  // 2. 下载阶段：远端有而本地缺失/不同的笔记
  let downloaded = 0;
  let conflicts = 0;
  const supersededNotes: Array<{ id: string; title: string }> = [];
  if (remoteManifest) {
    // 本地已删除笔记的墓碑（下载阶段生效）：id -> deletedAt。
    // 删除 vs 远端恢复按时间 LWW（last-writer-wins）：远端 active 且 updatedAt 晚于
    // 本地墓碑删除时间 → 远端恢复较新，撤销本地墓碑并跟随恢复；否则本地删除优先。
    const tombstoned = new Map(store.listDeletedNotesForSync().map((d) => [d.id, d.deletedAt] as const));
    // 预建本地索引，避免循环内 N+1 查询
    const localNotesAll = store.listNotesForSync();
    const localById = new Map(localNotesAll.map((n) => [n.id, n]));
    const localIdsAll = new Set(localNotesAll.map((n) => n.id));
    // 先导入目录树，再导入笔记，保证文档的父 notebook/group 已存在。
    const validParents = new Set<string>([store.defaultNotebookId()]);
    for (const folder of remoteManifest.folders) {
      if (!isSafeSegment(folder.id)) throw new Error(`清单包含无效的目录 ID: ${folder.id}`);
      if (folder.parentId !== null && !isSafeSegment(folder.parentId)) throw new Error(`清单包含无效的目录 parentId: ${folder.parentId}`);
      store.importRemoteFolder(folder);
      validParents.add(folder.id);
    }
    const downloadStart = Date.now();
    const remoteTotal = remoteManifest.notes.length;
    let remoteIndex = 0;
    for (const rn of remoteManifest.notes) {
      const noteStart = Date.now();
      remoteIndex += 1;
      report({ phase: "download", current: remoteIndex, total: remoteTotal, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
      // 审计 #3：manifest 的 note.id / asset.filename 必须先做单路径段校验，
      // 拒绝 ../、绝对路径、反斜杠等（写盘前 fail fast，避免任何写半成品）
      if (!isSafeSegment(rn.id)) throw new Error(`清单包含无效的笔记 ID: ${rn.id}`);
      for (const asset of rn.assets || []) {
        if (!isSafeSegment(asset.filename)) throw new Error(`清单包含无效的资源文件名: ${rn.id}/${asset.filename}`);
      }
      // 目录树同步前的旧 manifest 可能没有 folders，父目录缺失时归到默认个人笔记本，避免文档"消失"。
      const effectiveParent = rn.parentId !== null && validParents.has(rn.parentId) ? rn.parentId : store.defaultNotebookId();
      // 云端已删除：本地若有则删除（墓碑防重拉），不下载对象；
      // 本地没有也要留存墓碑（学到的删除），让本设备成为 deleted 标记的保管者，
      // 避免删除方设备清空后标记丢失导致离线设备复活（审计 #2）
      if (rn.deleted) {
        const local = localById.get(rn.id);
        // 墓碑权威（目录强一致）：远端 deleted 是权威状态，本地编辑（无论新旧）都不抵抗——
        // 被删前强制留档本地版本（与 superseded 同机制，数据不丢）。
        // 唯一例外：显式恢复标记（restoreTrashItem 写入）→ local wins，上传阶段写回 active 并覆盖墓碑。
        if (local) {
          if (store.isRestorePending(rn.id)) {
            log.sync.info(`[perf] download ${rn.id} tombstone-skip (restore pending) ${Date.now() - noteStart}ms`);
            continue;
          }
          // 墓碑权威：本地版本先强制留档（历史可找回），再尝试下载"删除前内容"（墓碑 contentHash，
          // 容错：对象缺失/占位符则跳过），最后软删——回收站/恢复拿到的就是删除方的最新版。
          store.createHistorySnapshot(rn.id, undefined, true);
          try {
            const lakeBytes = await remote.getOptional(objectKey(rn.id, rn.contentHash));
            if (lakeBytes) fs.writeFileSync(store.notePathFor(rn.id), lakeBytes);
            // list assets/{id}/ 前缀补全缺失资源：B 上次同步旧版时缺 A 删除前新增的资源，
            // 下载到本地保证回收站/恢复 = 删除方完整版本（本地已有的跳过，正常情况 0 下载）。
            const remoteAssets = await remote.list(`assets/${rn.id}/`);
            const dir = store.noteAssetsPathFor(rn.id);
            for (const a of remoteAssets) {
              const filename = a.key.slice(`assets/${rn.id}/`.length);
              if (!filename || filename.includes("/")) continue;
              if (fs.existsSync(path.join(dir, filename))) continue;
              const bytes = await remote.getOptional(`assets/${rn.id}/${filename}`);
              if (!bytes) continue;
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, filename), bytes);
            }
          } catch (error) {
            log.sync.warn(`[perf] download ${rn.id} tombstone content missing, skip`);
          }
          store.deleteTreeNode(rn.id);
          log.sync.info(`[perf] download ${rn.id} remote-deleted → soft-delete applied (local archived) ${Date.now() - noteStart}ms`);
        } else {
          store.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
          log.sync.info(`[perf] download ${rn.id} remote-deleted → tombstone learned ${Date.now() - noteStart}ms`);
        }
        continue;
      }
      // 本地已删除而云端未标记：删除 vs 远端恢复按时间 LWW（见上）。
      const tombAt = tombstoned.get(rn.id);
      if (tombAt !== undefined) {
        if (rn.updatedAt > tombAt) {
          // 远端恢复较新：撤销本地墓碑并跟随恢复（随后走正常下载/对账分支，按远端对齐 markSynced）。
          store.revokeLocalDeletion(rn.id);
          log.sync.info(`[perf] download ${rn.id} remote-restored → local tombstone revoked ${Date.now() - noteStart}ms`);
          // 刷新本地索引：恢复后该笔记在本设备变为 active（软删场景行已保留，仅清 deleted_at）。
          const revived = store.listNotesForSync().find((n) => n.id === rn.id) ?? null;
          if (revived) {
            localById.set(rn.id, revived);
            localIdsAll.add(rn.id);
          }
        } else {
          // 本地删除较新：本地删除优先，跳过下载（上传阶段会标记 deleted）。
          continue;
        }
      }
      const local = localById.get(rn.id) ?? null;
      // 增量扫描优化：synced 笔记信任"本地自上次同步后无写入"，直接用基线 hash 比对，
      // 跳过 .lake 文件读取；local/异常状态仍读文件核对（out-of-band 外部改文件不在本期覆盖）。
      const cachedBase = local && local.syncState === "synced" ? store.baseHash(local.id) : null;
      const localHash = local ? (cachedBase ?? store.contentHash(local.id)) : null;
      if (localHash === rn.contentHash) {
        // 正文相同：锁状态作为独立元数据按 LWW 合并（锁变更不改正文哈希，
        // 不能因哈希相等就跳过，否则远端锁状态永远下不来）
        if (local) {
          const localLocked = !!local.isLocked;
          const remoteLocked = !!rn.isLocked;
          if (localLocked !== remoteLocked) {
            const merged = mergeLockState(localLocked, local.lockedAt ?? null, remoteLocked, rn.lockedAt ?? null);
            store.applyRemoteLock(rn.id, merged.locked, merged.at);
          }
          // 标题/父目录/排序/图标也是元数据，正文未变时也要对账（否则文件夹调整不会同步）。
          store.applyRemoteNoteMeta({ ...rn, parentId: effectiveParent });
        }
        store.setBaseHash(rn.id, rn.contentHash);
        store.markSynced(rn.id);
        log.sync.info(`[perf] download ${rn.id} unchanged (meta LWW) ${Date.now() - noteStart}ms`);
        continue;
      }
      // 下载 .lake
      const lakeBytes = await remote.getOptional(objectKey(rn.id, rn.contentHash));
      if (!lakeBytes) throw new Error(`清单引用的文档对象不存在: ${rn.contentHash}`);
      // 下载资源文件（manifest 里列出）；审计 #4：缺失对象必须中止导入，
      // 下载后校验 size 与 sha256（远端损坏/被替换不静默接受）
      const assets: { filename: string; bytes: Buffer }[] = [];
      const assetList = rn.assets || [];
      for (let ai = 0; ai < assetList.length; ai += 1) {
        const asset = assetList[ai];
        report({ phase: "download", current: remoteIndex, total: remoteTotal, assetCurrent: ai + 1, assetTotal: assetList.length, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
        const bytes = await remote.getOptional(`assets/${rn.id}/${asset.filename}`);
        if (!bytes) throw new Error(`清单引用的资源不存在: ${rn.id}/${asset.filename}`);
        if (bytes.length !== asset.size) {
          throw new Error(`资源大小不符: ${rn.id}/${asset.filename}（声明 ${asset.size}，实际 ${bytes.length}）`);
        }
        if (sha256Hex(bytes) !== asset.hash) {
          throw new Error(`资源哈希不符: ${rn.id}/${asset.filename}（已损坏或被替换）`);
        }
        assets.push({ filename: asset.filename, bytes });
      }
      const base = store.baseHash(rn.id);
      const localChanged = localHash !== null && localHash !== base;
      const remoteChanged = rn.contentHash !== base;
      // P0-1（既定方案）：以 last_uploaded_hash 判定"远端是否本机最后一次上传的版本"。
      // - 远端 == 本机最后上传（本机传的）→ 本地为准（恢复版/新编辑），上传覆盖，不产生冲突副本；
      // - 远端 != 本机最后上传（其他设备改的）→ 接受远端最新，本地当前内容已在历史（恢复留档/编辑前）
      //   可找回，不产生冲突副本（历史已兜底）。
      // 注意：last_uploaded_hash 每次本机上传成功都会更新，因此能准确反映"远端是不是我传的"。
      const uploadedByUs = local !== null && rn.contentHash === store.lastUploadedHash(rn.id);
      if (localHash === rn.contentHash) {
        // 正文一致：锁状态按 LWW 合并（下面统一走 else 合并锁；此处直接继续）
        // 落到 else 分支处理（远端=本地，走下载不会发生，但锁需要合并）
        if (local) {
          const localLocked = !!local.isLocked;
          const remoteLocked = !!rn.isLocked;
          if (localLocked !== remoteLocked) {
            const merged = mergeLockState(localLocked, local.lockedAt ?? null, remoteLocked, rn.lockedAt ?? null);
            store.applyRemoteLock(rn.id, merged.locked, merged.at);
          }
        }
        store.setBaseHash(rn.id, rn.contentHash);
        store.markSynced(rn.id);
        continue;
      } else if (uploadedByUs) {
        // 远端是本机传的 + 本地有变化（恢复/新编辑）→ 本地为准，上传覆盖（不产生冲突副本）
        store.setBaseHash(rn.id, localHash!);
        store.markSynced(rn.id);
        continue;
      } else if (localChanged) {
        // 远端是其他设备改的（或本机从未上传过该文档）→ 接受远端最新，
        // 本地当前内容立即留快照（默认 24h 同 hash 去重：刚被自动快照过的内容不重复写；
        // 表里没有则必写，确保不丢，即使未到 15 分钟周期）。记录 supersededNotes 供 UI 提醒。
        try { store.createHistorySnapshot(rn.id, undefined, false); } catch { /* 留档失败不阻断同步 */ }
        const merged = local
          ? mergeLockState(!!local.isLocked, local.lockedAt ?? null, !!rn.isLocked, rn.lockedAt ?? null)
          : { locked: !!rn.isLocked, at: rn.lockedAt ?? null };
        store.importRemoteNote(
          { id: rn.id, title: rn.title, parentId: effectiveParent, sortOrder: rn.sortOrder, updatedAt: rn.updatedAt, isConflict: false,
            isLocked: merged.locked, lockedAt: merged.at, icon: rn.icon ?? null },
          lakeBytes, assets
        );
        store.setBaseHash(rn.id, rn.contentHash);
        supersededNotes.push({ id: rn.id, title: rn.title });
        downloaded += 1;
        log.sync.info(`[perf] download ${rn.id} superseded-local→remote ${Date.now() - noteStart}ms (lake=${lakeBytes.length}B, assets=${assets.length})`);
      } else {
        // 本地相对基线无变化（或本地无此笔记）且远端是其他设备改的 → 接受远端。
        // 本地有内容时同样会被覆盖：即使自上次同步后未编辑，当前版本也强制留档，
        // 否则"别人改了我同步过的内容，我本地的这一版"会被静默丢弃（A/B 联调发现）。
        let superseded = false;
        if (local) {
          try { store.createHistorySnapshot(rn.id, undefined, false); } catch { /* 留档失败不阻断同步 */ }
          supersededNotes.push({ id: rn.id, title: rn.title });
          superseded = true;
        }
        // 正文下载后锁按 LWW 合并：本地刚改的锁不被远端旧状态覆盖
        const merged = local
          ? mergeLockState(!!local.isLocked, local.lockedAt ?? null, !!rn.isLocked, rn.lockedAt ?? null)
          : { locked: !!rn.isLocked, at: rn.lockedAt ?? null };
        store.importRemoteNote(
          { id: rn.id, title: rn.title, parentId: effectiveParent, sortOrder: rn.sortOrder, updatedAt: rn.updatedAt, isConflict: rn.isConflict,
            isLocked: merged.locked, lockedAt: merged.at, icon: rn.icon ?? null },
          lakeBytes, assets
        );
        store.setBaseHash(rn.id, rn.contentHash);
        downloaded += 1;
        log.sync.info(`[perf] download ${rn.id} ${superseded ? "superseded-idle-local→remote" : "new-content"} ${Date.now() - noteStart}ms (lake=${lakeBytes.length}B, assets=${assets.length})`);
      }
    }
    log.sync.info(`[perf] download phase ${Date.now() - downloadStart}ms (downloaded=${downloaded}, conflicts=${conflicts})`);
  }

  // 3. 上传阶段：本地有而远端缺失/不同的笔记（含资源，跳过孤儿）
  const localNotes = store.listNotesForSync();
  const remoteHashes = new Map<string, string>(
    (remoteManifest?.notes ?? []).map((n) => [n.id, n.contentHash])
  );
  // 远端清单已登记的资源 hash（filename 不可变 + 内容寻址，hash 一致即无需重传）
  const remoteAssetHashes = new Map<string, string>();
  for (const rn of remoteManifest?.notes ?? []) {
    for (const a of rn.assets || []) remoteAssetHashes.set(`${rn.id}/${a.filename}`, a.hash);
  }
  // 远端条目 map（上传跳过判定 + 墓碑 LWW 复用；命名避开外层 ObjectStore 的 remote）
  const remoteNotesById = new Map((remoteManifest?.notes ?? []).map((n) => [n.id, n]));
  let uploaded = 0;
  const manifestNotes: ManifestNote[] = [];

  const uploadStart = Date.now();
  const localTotal = localNotes.length;
  let localIndex = 0;
  for (const note of localNotes) {
    localIndex += 1;
    const noteUploadStart = Date.now();
    report({ phase: "upload", current: localIndex, total: localTotal, message: `上传笔记「${note.title}」` });
    // 增量扫描优化：synced 且远端条目 hash 与本地上次基线一致 → 本地无变更，
    // 直接复用缓存 hash + 远端 assets（正文未变 ⇒ 资源引用未变 ⇒ assets 一致），
    // 跳过 .lake 读取与资源扫描（9000+ 条笔记时每次同步省 ~2 万次文件 IO）。
    const remoteEntry = remoteNotesById.get(note.id);
    const cachedHash = store.baseHash(note.id);
    if (note.syncState === "synced" && cachedHash !== null && remoteEntry && !remoteEntry.deleted && remoteEntry.contentHash === cachedHash) {
      manifestNotes.push({
        id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
        updatedAt: note.updatedAt, contentHash: cachedHash, isConflict: note.isConflict,
        isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null,
        assets: remoteEntry.assets ?? [],
      });
      continue;
    }
    const hash = store.contentHash(note.id);
    // 审计 #1：资源清单必须**每次同步都重扫**（正文 hash 未变时也要保留 assets）。
    // §5.1：仅当前正文引用的资源有上传资格；历史引用资源不上传（本地保留，云端 B1 保留）。
    const currentRefs = store.getCurrentContentRefs(note.id);
    const assets: { filename: string; size: number; hash: string }[] = [];
    const pendingAssets: Array<{ filename: string; bytes: Buffer }> = [];
    const dir = store.noteAssetsPathFor(note.id);
    if (fs.existsSync(dir)) {
      for (const filename of fs.readdirSync(dir)) {
        if (!currentRefs.has(filename)) continue;
        const full = path.join(dir, filename);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;
        let bytes: Buffer;
        try { bytes = fs.readFileSync(full); } catch { continue; }
        const assetHash = sha256Hex(bytes);
        assets.push({ filename, size: bytes.length, hash: assetHash });
        if (remoteAssetHashes.get(`${note.id}/${filename}`) !== assetHash) {
          pendingAssets.push({ filename, bytes });
        }
      }
    }
    // 上传资源（子进度，独立于笔记主进度）
    for (let ai = 0; ai < pendingAssets.length; ai += 1) {
      report({ phase: "upload", current: localIndex, total: localTotal, assetCurrent: ai + 1, assetTotal: pendingAssets.length, message: `上传笔记「${note.title}」` });
      const pending = pendingAssets[ai];
      await remote.put(`assets/${note.id}/${pending.filename}`, pending.bytes, mimeTypeFor(pending.filename));
    }
    let lakeUploaded = false;
    let lakeBytesLen = 0;
    if (remoteHashes.get(note.id) !== hash) {
      // 上传 .lake（正文变化时）
      const lakeBytes = fs.readFileSync(store.notePathFor(note.id));
      lakeBytesLen = lakeBytes.length;
      await remote.put(objectKey(note.id, hash), lakeBytes, "text/lake; charset=utf-8");
      uploaded += 1;
      lakeUploaded = true;
    }
    manifestNotes.push({
      id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
      updatedAt: note.updatedAt, contentHash: hash, isConflict: note.isConflict,
      isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, assets,
    });
    log.sync.info(`[perf] upload ${note.id} ${note.title} ${Date.now() - noteUploadStart}ms (lake=${lakeUploaded ? `${lakeBytesLen}B` : "skip"}, assets=${pendingAssets.length})`);
  }
  log.sync.info(`[perf] upload phase ${Date.now() - uploadStart}ms (uploaded=${uploaded}, local=${localNotes.length})`);

  // 3.5 墓碑：本地已删除的笔记 → manifest 恒保留 deleted 标记（不重新上传对象）。
  // 审计 #2：墓碑不能写完一次就剪除——长期离线设备上线时若 manifest 已无 deleted
  // 标记，会把旧笔记当本地有效内容重新上传（删除复活）。墓碑/标记体积极小，
  // 按 id 永久保留直到本地重建同名笔记（此时 localIds 命中，不再标记 deleted）。
  const localIds = new Set(localNotes.map((n) => n.id));
  for (const deleted of store.listDeletedNotesForSync()) {
    if (localIds.has(deleted.id)) continue;
    // 墓碑 vs 远端恢复 LWW：远端已是 active 且 updatedAt 晚于本墓碑删除时间 →
    // 其他设备恢复较新，墓碑让位（不回写覆盖，避免恢复被撤销）。
    // 反向（本墓碑删除较新）仍回写，保证离线设备删除能传播（审计 #2）。
    const remoteNote = remoteNotesById.get(deleted.id);
    if (remoteNote && !remoteNote.deleted && remoteNote.updatedAt > deleted.deletedAt) {
      log.sync.info(`[perf] upload ${deleted.id} tombstone-yield (remote restored newer)`);
      continue;
    }
    // 墓碑携带删除前内容：读本设备保留的 .lake（软删不删文件）算真实 hash 并上传，
    // 使其他设备能先拉到"删除前最新版"再应用墓碑（先内容、后标志）。读失败降级为占位符 id。
    let tombHash = deleted.id;
    try {
      const lakeBytes = fs.readFileSync(store.notePathFor(deleted.id));
      tombHash = sha256Hex(lakeBytes);
      // 内容寻址，PUT 幂等（对象可能已被其他设备上传，重复 PUT 无害）
      await remote.put(objectKey(deleted.id, tombHash), lakeBytes, "text/lake; charset=utf-8");
    } catch (error) {
      log.sync.warn(`[perf] upload ${deleted.id} tombstone content unreadable, placeholder fallback`);
    }
    // 墓碑保持轻量：只带正文 contentHash，不携带资源列表（资源由 GC 按软删前缀保护 + B 端 list 补全）。
    manifestNotes.push({
      id: deleted.id, title: deleted.title, parentId: deleted.parentId,
      sortOrder: deleted.sortOrder, updatedAt: deleted.updatedAt,
      contentHash: tombHash,
      isConflict: false, assets: [],
      deleted: true, deletedAt: deleted.deletedAt,
    });
  }

  // 4. 写新清单（commit + latest）
  report({ phase: "manifest", message: "写入同步清单..." });
  const manifestStart = Date.now();
  manifestNotes.sort((a, b) => a.sortOrder - b.sortOrder);
  // 目录树也要同步：否则文档会引用一个远端不存在的 notebook/group（设计完整性）。
  const manifestFolders: ManifestFolder[] = store.listFoldersForSync().map((f) => ({
    id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType,
    icon: f.icon, updatedAt: f.updatedAt,
  }));
  const commitId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    workspaceId: "default",
    commitId,
    prevCommitId: remoteManifest?.commitId ?? null,
    createdAt: completedAt,
    notes: manifestNotes,
    folders: manifestFolders,
  };
  const manifestOutput = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await remote.put(`manifests/${commitId}.json`, manifestOutput, "application/json", { gzip: true });
  await remote.put("manifests/latest.json", manifestOutput, "application/json", { gzip: true });
  log.sync.info(`[perf] manifest ${commitId} ${Date.now() - manifestStart}ms (notes=${manifestNotes.length}, folders=${manifestFolders.length}, bytes=${manifestOutput.length}, prev=${manifest.prevCommitId ?? "none"})`);

  // P0-1 修正：lastUploadedHash 语义 = 已成功发布到 latest 的 hash，必须在 manifest 写成功后再更新。
  // 仅对 active 笔记更新；deleted 墓碑是占位 contentHash，绝不写入 sync_base/lastUploadedHash。
  for (const note of manifestNotes) {
    if (note.deleted) continue;
    store.setLastUploadedHash(note.id, note.contentHash);
    store.setBaseHash(note.id, note.contentHash);
    store.markSynced(note.id);
  }

  // 4.5 标记回收 + 撤销（v4 差集模型：只标记，不立即删）
  const prevById = new Map((remoteManifest?.notes ?? []).map((n) => [n.id, n]));
  const newById = new Map(manifestNotes.map((n) => [n.id, n]));
  for (const prev of remoteManifest?.notes ?? []) {
    if (prev.deleted) continue;
    const next = newById.get(prev.id);
    if (!next || next.deleted) continue; // 软删/墓碑不在此标记；purge 见 M4
    if (next.contentHash !== prev.contentHash) {
      store.addS3GcPending(objectKey(prev.id, prev.contentHash));
    }
    const nextAssets = new Set((next.assets ?? []).map((a) => a.filename));
    for (const asset of prev.assets ?? []) {
      if (nextAssets.has(asset.filename)) continue;
      if (!store.getProtectedRefs(prev.id).has(asset.filename)) {
        store.addS3GcPending(`assets/${prev.id}/${asset.filename}`);
      }
    }
  }
  // 撤销：被新 manifest 重新引用的键立即解除待回收（P0-1 双保险第一层）
  const referencedNow = new Set<string>();
  for (const note of manifestNotes) {
    if (note.deleted) continue;
    referencedNow.add(objectKey(note.id, note.contentHash));
    for (const asset of note.assets ?? []) referencedNow.add(`assets/${note.id}/${asset.filename}`);
  }
  store.removeS3GcPending([...referencedNow]);

  // 4.6 purge 前缀立即删（M4）：先写 manifest（上面已完成）→ 再删 objects/assets 前缀。
  const purgedNotes = store.listPurgedNotesForSync();
  for (const note of purgedNotes) {
    const purgeStart = Date.now();
    const objs = await remote.deletePrefix(`objects/${note.id}-`);
    const assets = await remote.deletePrefix(`assets/${note.id}/`);
    // 删除成功后清除 purged_at（保留墓碑），避免后续每次同步重复删前缀。
    store.markPurgeSynced(note.id);
    log.sync.info(`[perf] purge ${note.id} ${Date.now() - purgeStart}ms (objects=${objs}, assets=${assets})`);
  }

  const result: SyncResult = { uploaded, downloaded, conflicts, manifestId: commitId, completedAt, supersededNotes };
  store.markSyncComplete(completedAt);
  store.recordSyncResult(JSON.stringify(result));

  report({ phase: "done", message: "同步完成", supersededNotes });
  log.sync.info(`[perf] syncNow done ${Date.now() - syncStart}ms (uploaded=${uploaded}, downloaded=${downloaded}, conflicts=${conflicts}, superseded=${supersededNotes.length})`);
  return result;
}

// ===== S3 GC：差集对账执行器（M5） =====
export interface GcReconcileResult {
  deleted: number;
  kept: number;
}

function collectManifestRefs(manifest: Manifest, out: Set<string>): void {
  for (const note of manifest.notes) {
    // deleted 墓碑保护删除前正文对象（真实 hash；占位符对象不在云端，加入无害）。
    // 软删笔记的资源由 runDeepCleanup 按"软删前缀"保护（墓碑不携带资源清单）。
    out.add(objectKey(note.id, note.contentHash));
    if (note.deleted) continue;
    for (const asset of note.assets ?? []) out.add(`assets/${note.id}/${asset.filename}`);
  }
}

export async function runGcReconcile(store: Store): Promise<GcReconcileResult> {
  const gcStart = Date.now();
  log.gc.info("[perf] gc-reconcile start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);

  const latestBytes = await remote.getOptional("manifests/latest.json");
  if (!latestBytes) { log.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (no manifest)`); return { deleted: 0, kept: 0 }; }
  const latest = JSON.parse(latestBytes.toString("utf8")) as Manifest;
  validateManifest(latest);

  const keep = new Set<string>();
  collectManifestRefs(latest, keep);

  // prevCommitId 链最多 3 份 commit 的引用一并保留
  let prev = latest.prevCommitId;
  let chain = 0;
  while (prev && chain < 3) {
    const bytes = await remote.getOptional(`manifests/${prev}.json`);
    if (!bytes) break;
    const m = JSON.parse(bytes.toString("utf8")) as Manifest;
    validateManifest(m);
    collectManifestRefs(m, keep);
    prev = m.prevCommitId;
    chain += 1;
  }

  // 本设备历史引用保护（B1：最佳努力）
  for (const noteId of store.listNoteIdsWithHistory()) {
    for (const filename of store.getProtectedRefs(noteId)) {
      keep.add(`assets/${noteId}/${filename}`);
    }
  }

  const cfg = store.getS3GcSettings();
  const cutoff = Date.now() - cfg.gcRetentionDays * 24 * 3600 * 1000;
  const pending = store.listS3GcPending().filter((p) => Date.parse(p.markedAt) <= cutoff);
  const toDelete = pending.filter((p) => !keep.has(p.key)).map((p) => p.key);
  if (toDelete.length > 0) {
    await remote.deleteMany(toDelete);
    store.removeS3GcPending(toDelete);
    for (const key of toDelete) store.recordS3GcLog("delete", key, "retention", latest.commitId, "local", true);
  }
  log.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (deleted=${toDelete.length}, kept=${pending.length - toDelete.length}, pending=${pending.length})`);
  return { deleted: toDelete.length, kept: pending.length - toDelete.length };
}

// ===== S3 GC：深度清理（M7，Lake 侧；小记 keep 由调用方额外提供） =====
export interface DeepCleanupResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  keys: string[];
}

export async function runDeepCleanup(store: Store, opts?: { dryRun?: boolean; extraKeep?: Set<string> }): Promise<DeepCleanupResult> {
  const deepStart = Date.now();
  log.gc.info(`[perf] deep-cleanup start (dryRun=${opts?.dryRun ?? false})`);
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  const dryRun = opts?.dryRun ?? false;
  const extraKeep = opts?.extraKeep ?? new Set<string>();

  const latestBytes = await remote.getOptional("manifests/latest.json");
  if (!latestBytes) { log.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const latest = JSON.parse(latestBytes.toString("utf8")) as Manifest;
  validateManifest(latest);

  const keep = new Set<string>(extraKeep);
  // 元数据 keep：manifest 文件本身
  keep.add("manifests/latest.json");
  collectManifestRefs(latest, keep);

  // commit 链（最多 3 份）
  let prev = latest.prevCommitId;
  let chain = 0;
  while (prev && chain < 3) {
    keep.add(`manifests/${prev}.json`);
    const bytes = await remote.getOptional(`manifests/${prev}.json`);
    if (!bytes) break;
    const m = JSON.parse(bytes.toString("utf8")) as Manifest;
    validateManifest(m);
    collectManifestRefs(m, keep);
    prev = m.prevCommitId;
    chain += 1;
  }

  // 历史引用保护
  for (const noteId of store.listNoteIdsWithHistory()) {
    for (const filename of store.getProtectedRefs(noteId)) {
      keep.add(`assets/${noteId}/${filename}`);
    }
  }

  const cfg = store.getS3GcSettings();
  const cutoff = Date.now() - cfg.gcRetentionDays * 24 * 3600 * 1000;
  // 空间隔离：只枚举 Lake 自己的三个子空间；quick-notes/ 由 runQuickNotesDeepCleanup 单独处理。
  const all = [
    ...(await remote.list("objects/")),
    ...(await remote.list("assets/")),
    ...(await remote.list("manifests/")),
  ];
  // 软删笔记（回收站）的资源按前缀保护：墓碑不携带资源清单，无法逐个 keep；
  // 软删笔记的整个 assets/{id}/ 前缀保留到 purge（purge 时 deletePrefix 全删）。
  const softDeletedIds = new Set(latest.notes.filter((n) => n.deleted).map((n) => n.id));
  const candidates = all
    .filter((item) => !keep.has(item.key))
    .filter((item) => Date.parse(item.lastModified) < cutoff)
    .filter((item) => {
      const m = item.key.match(/^assets\/([^/]+)\//);
      return !(m && softDeletedIds.has(m[1]));
    })
    .map((item) => item.key);

  if (dryRun || candidates.length === 0) {
    log.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, deletedCount: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  for (const key of candidates) store.recordS3GcLog("delete", key, "deep-clean", latest.commitId, "local", true);
  log.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, deletedCount: candidates.length, keys: candidates };
}

// ===== 工具 =====
/** 参照思源 util.NormalizeEndpoint：规范化 S3 endpoint */
function normalizeEndpoint(endpoint: string): string {
  let e = endpoint.trim();
  if (!e) return "";
  // 修复误写的 http(s):// 组合
  e = e.replace(/^https?:\/\/https?:\/\//i, "https://");
  // 无协议时默认 https（七牛云等 S3 服务均为 https）
  if (!/^https?:\/\//i.test(e)) e = `https://${e}`;
  // 去除 host 后的重复斜杠
  const scheme = e.match(/^https?:\/\//i)?.[0] ?? "";
  let rest = e.slice(scheme.length);
  rest = rest.replace(/\/+/g, "/");
  return (scheme + rest).replace(/\/+$/, "");
}

export function validateS3Settings(settings: S3Settings): void {
  if (!settings.endpoint.trim() || !settings.bucket.trim() || !settings.accessKeyId.trim() || !settings.secretAccessKey.trim()) {
    throw new Error("Endpoint、Bucket 和访问密钥均不能为空");
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as { name?: string; message?: string; $metadata?: unknown };
    return anyError.message || String(error);
  }
  return String(error);
}

function isNoSuchKey(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = error.message ?? "";
  return name === "NoSuchKey" || message.includes("NoSuchKey") || message.includes("404");
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function mimeTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

/** 键构造统一 ASCII 校验：防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）。 */
const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;
function assertSafeKey(key: string): void {
  if (!SAFE_KEY_RE.test(key)) throw new Error(`S3 键包含非法字符: ${key}`);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 审计 #3/#19：远程 manifest 运行时 schema 校验（远程 JSON 不可信，不能直接断言类型） */
function validateManifest(manifest: unknown): asserts manifest is Manifest {
  if (!manifest || typeof manifest !== "object") throw new Error("清单格式无效：非对象");
  const m = manifest as Partial<Manifest>;
  if (m.version !== MANIFEST_VERSION) {
    throw new Error(`清单版本不兼容（本地 ${MANIFEST_VERSION}，远端 ${String(m.version)}）`);
  }
  if (typeof m.workspaceId !== "string" || typeof m.commitId !== "string" || typeof m.createdAt !== "string") {
    throw new Error("清单格式无效：workspaceId/commitId/createdAt 字段缺失");
  }
  if (m.prevCommitId !== undefined && m.prevCommitId !== null && typeof m.prevCommitId !== "string") {
    throw new Error("清单格式无效：prevCommitId 非法");
  }
  if (!Array.isArray(m.notes)) throw new Error("清单格式无效：notes 不是数组");
  for (const note of m.notes) {
    if (!note || typeof note !== "object") throw new Error("清单格式无效：note 非对象");
    const n = note as Partial<ManifestNote>;
    if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.contentHash !== "string") {
      throw new Error(`清单格式无效：note 缺少 id/title/contentHash（id=${String(n.id)}）`);
    }
    // deleted 墓碑的 contentHash 是占位符（= note id），不做 sha256 hex 校验；仅 active 笔记要求 64 位 hex。
    if (n.deleted !== true && !/^[a-f0-9]{64}$/.test(n.contentHash)) {
      throw new Error(`清单格式无效：contentHash 非法（id=${String(n.id)}）`);
    }
    if (n.parentId !== null && typeof n.parentId !== "string") throw new Error("清单格式无效：parentId 非法");
    if (typeof n.sortOrder !== "number" || typeof n.updatedAt !== "string") throw new Error("清单格式无效：sortOrder/updatedAt 非法");
    if (n.assets !== undefined && !Array.isArray(n.assets)) throw new Error("清单格式无效：assets 非数组");
    for (const asset of n.assets ?? []) {
      if (!asset || typeof asset !== "object") throw new Error("清单格式无效：asset 非对象");
      const a = asset as Partial<ManifestNote["assets"][number]>;
      if (typeof a.filename !== "string" || typeof a.size !== "number" || typeof a.hash !== "string") {
        throw new Error("清单格式无效：asset 缺少 filename/size/hash");
      }
      if (!/^[a-f0-9]{64}$/.test(a.hash)) throw new Error("清单格式无效：asset hash 非法");
    }
    if (n.isLocked !== undefined && typeof n.isLocked !== "boolean") throw new Error("清单格式无效：isLocked 非法");
    if (n.lockedAt !== undefined && n.lockedAt !== null && typeof n.lockedAt !== "string") throw new Error("清单格式无效：lockedAt 非法");
    if (n.deleted !== undefined && typeof n.deleted !== "boolean") throw new Error("清单格式无效：deleted 非法");
    if (n.deletedAt !== undefined && typeof n.deletedAt !== "string") throw new Error("清单格式无效：deletedAt 非法");
  }
  if (!Array.isArray(m.folders)) throw new Error("清单格式无效：folders 非数组");
  for (const folder of m.folders) {
    if (!folder || typeof folder !== "object") throw new Error("清单格式无效：folder 非对象");
    const f = folder as Partial<ManifestFolder>;
    if (typeof f.id !== "string" || typeof f.title !== "string" || typeof f.sortOrder !== "number") {
      throw new Error("清单格式无效：folder 缺少 id/title/sortOrder");
    }
    if (f.parentId !== null && typeof f.parentId !== "string") throw new Error("清单格式无效：folder.parentId 非法");
    if (f.nodeType !== "notebook" && f.nodeType !== "group") throw new Error("清单格式无效：folder.nodeType 非法");
  }
}

/** 安全单路径段：拒绝空、./.. 以及含 / 或 \\ 的字符串（防目录穿越） */
export function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}
