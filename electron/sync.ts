import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { Store } from "./store.js";

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

interface Manifest {
  version: number; workspaceId: string; commitId: string; createdAt: string;
  notes: ManifestNote[];
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
}

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  current?: number;
  total?: number;
  message: string;
}

const MANIFEST_VERSION = 3;

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
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      throw new Error(`S3 连接失败: ${errorMessage(error)}`);
    }
  }

  async getOptional(key: string): Promise<Buffer | null> {
    try {
      const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      const bytes = output.Body ? Buffer.from(await output.Body.transformToByteArray()) : Buffer.alloc(0);
      return bytes;
    } catch (error) {
      if (isNoSuchKey(error)) return null;
      throw new Error(`S3 读取失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: bytes,
        ContentType: contentType,
      }));
    } catch (error) {
      throw new Error(`S3 上传失败 (${key}): ${errorMessage(error)}`);
    }
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
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "connect", message: "正在连接 S3..." });
  await remote.test();

  // 1. 读取远程清单
  const manifestBytes = await remote.getOptional("manifests/latest.json");
  const remoteManifest: Manifest | null = manifestBytes ? JSON.parse(manifestBytes.toString("utf8")) : null;
  if (remoteManifest) validateManifest(remoteManifest);

  // 2. 下载阶段：远端有而本地缺失/不同的笔记
  let downloaded = 0;
  let conflicts = 0;
  if (remoteManifest) {
    // 本地已删除笔记的墓碑（下载阶段生效：本地删除优先，不重新拉取）
    const tombstoned = new Set(store.listDeletedNotesForSync().map((d) => d.id));
    // 预建本地索引，避免循环内 N+1 查询
    const localNotesAll = store.listNotesForSync();
    const localById = new Map(localNotesAll.map((n) => [n.id, n]));
    const localIdsAll = new Set(localNotesAll.map((n) => n.id));
    const remoteTotal = remoteManifest.notes.length;
    let remoteIndex = 0;
    for (const rn of remoteManifest.notes) {
      remoteIndex += 1;
      report({ phase: "download", current: remoteIndex, total: remoteTotal, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
      // 审计 #3：manifest 的 note.id / asset.filename 必须先做单路径段校验，
      // 拒绝 ../、绝对路径、反斜杠等（写盘前 fail fast，避免任何写半成品）
      if (!isSafeSegment(rn.id)) throw new Error(`清单包含无效的笔记 ID: ${rn.id}`);
      for (const asset of rn.assets || []) {
        if (!isSafeSegment(asset.filename)) throw new Error(`清单包含无效的资源文件名: ${rn.id}/${asset.filename}`);
      }
      // 云端已删除：本地若有则删除（墓碑防重拉），不下载对象；
      // 本地没有也要留存墓碑（学到的删除），让本设备成为 deleted 标记的保管者，
      // 避免删除方设备清空后标记丢失导致离线设备复活（审计 #2）
      if (rn.deleted) {
        const exists = localIdsAll.has(rn.id);
        if (exists) store.deleteTreeNode(rn.id);
        else store.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
        continue;
      }
      // 本地已删除而云端未标记：本地删除优先，跳过下载（上传阶段会标记 deleted）
      if (tombstoned.has(rn.id)) continue;
      const local = localById.get(rn.id) ?? null;
      const localHash = local ? store.contentHash(local.id) : null;
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
        }
        store.setBaseHash(rn.id, rn.contentHash);
        store.markSynced(rn.id);
        continue;
      }
      // 下载 .lake
      const lakeBytes = await remote.getOptional(`objects/${rn.contentHash}.lake`);
      if (!lakeBytes) throw new Error(`清单引用的文档对象不存在: ${rn.contentHash}`);
      // 下载资源文件（manifest 里列出）；审计 #4：缺失对象必须中止导入，
      // 下载后校验 size 与 sha256（远端损坏/被替换不静默接受）
      const assets: { filename: string; bytes: Buffer }[] = [];
      await Promise.all((rn.assets || []).map(async (asset) => {
        const bytes = await remote.getOptional(`assets/${rn.id}/${asset.filename}`);
        if (!bytes) throw new Error(`清单引用的资源不存在: ${rn.id}/${asset.filename}`);
        if (bytes.length !== asset.size) {
          throw new Error(`资源大小不符: ${rn.id}/${asset.filename}（声明 ${asset.size}，实际 ${bytes.length}）`);
        }
        if (sha256Hex(bytes) !== asset.hash) {
          throw new Error(`资源哈希不符: ${rn.id}/${asset.filename}（已损坏或被替换）`);
        }
        assets.push({ filename: asset.filename, bytes });
      }));
      const base = store.baseHash(rn.id);
      const localChanged = localHash !== null && localHash !== base;
      const remoteChanged = rn.contentHash !== base;
      if (localChanged && remoteChanged) {
        // 本地和远端都改过 → 冲突副本
        const conflictId = crypto.randomUUID();
        const title = `${rn.title}（冲突副本 ${new Date().toISOString().slice(0, 10)}）`;
        store.importRemoteNote(
          { id: conflictId, title, parentId: rn.parentId, sortOrder: rn.sortOrder + 1, updatedAt: rn.updatedAt, isConflict: true },
          lakeBytes, assets
        );
        store.setBaseHash(conflictId, rn.contentHash);
        conflicts += 1;
      } else if (localChanged) {
        // 仅本地改过、远端未改：本地为准，交给上传阶段（不能下载覆盖本地修改）
        continue;
      } else {
        // 正文下载后锁按 LWW 合并：本地刚改的锁不被远端旧状态覆盖
        const merged = local
          ? mergeLockState(!!local.isLocked, local.lockedAt ?? null, !!rn.isLocked, rn.lockedAt ?? null)
          : { locked: !!rn.isLocked, at: rn.lockedAt ?? null };
        store.importRemoteNote(
          { id: rn.id, title: rn.title, parentId: rn.parentId, sortOrder: rn.sortOrder, updatedAt: rn.updatedAt, isConflict: rn.isConflict,
            isLocked: merged.locked, lockedAt: merged.at },
          lakeBytes, assets
        );
        store.setBaseHash(rn.id, rn.contentHash);
        downloaded += 1;
      }
    }
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
  const orphans = new Set(store.listOrphanAssets().map((o) => `${o.noteId}/${o.filename}`));
  let uploaded = 0;
  const manifestNotes: ManifestNote[] = [];

  const localTotal = localNotes.length;
  let localIndex = 0;
  for (const note of localNotes) {
    localIndex += 1;
    report({ phase: "upload", current: localIndex, total: localTotal, message: `上传笔记「${note.title}」` });
    const hash = store.contentHash(note.id);
    // 审计 #1：资源清单必须**每次同步都重扫**（正文 hash 未变时也要保留 assets），
    // 否则第二份 manifest 会把带图笔记的资源列表清空，新设备无法恢复。
    // 上传仍做增量：远端同 hash 资源跳过（remoteAssetHashes 对比），零重传不变。
    const assets: { filename: string; size: number; hash: string }[] = [];
    const dir = store.noteAssetsPathFor(note.id);
    if (fs.existsSync(dir)) {
      for (const filename of fs.readdirSync(dir)) {
        const full = path.join(dir, filename);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;
        if (orphans.has(`${note.id}/${filename}`)) continue;
        let bytes: Buffer;
        try { bytes = fs.readFileSync(full); } catch { continue; }
        const assetHash = sha256Hex(bytes);
        assets.push({ filename, size: bytes.length, hash: assetHash });
        if (remoteAssetHashes.get(`${note.id}/${filename}`) === assetHash) continue;
        await remote.put(`assets/${note.id}/${filename}`, bytes, mimeTypeFor(filename));
      }
    }
    if (remoteHashes.get(note.id) !== hash) {
      // 上传 .lake（正文变化时）
      const lakeBytes = fs.readFileSync(store.notePathFor(note.id));
      await remote.put(`objects/${hash}.lake`, lakeBytes, "text/lake; charset=utf-8");
      uploaded += 1;
    }
    manifestNotes.push({
      id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
      updatedAt: note.updatedAt, contentHash: hash, isConflict: note.isConflict,
      isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, assets,
    });
  }

  // 3.5 墓碑：本地已删除的笔记 → manifest 恒保留 deleted 标记（不重新上传对象）。
  // 审计 #2：墓碑不能写完一次就剪除——长期离线设备上线时若 manifest 已无 deleted
  // 标记，会把旧笔记当本地有效内容重新上传（删除复活）。墓碑/标记体积极小，
  // 按 id 永久保留直到本地重建同名笔记（此时 localIds 命中，不再标记 deleted）。
  const localIds = new Set(localNotes.map((n) => n.id));
  for (const deleted of store.listDeletedNotesForSync()) {
    if (localIds.has(deleted.id)) continue;
    manifestNotes.push({
      id: deleted.id, title: deleted.title, parentId: deleted.parentId,
      sortOrder: deleted.sortOrder, updatedAt: deleted.updatedAt,
      contentHash: deleted.id, // 占位，deleted 标记不会下载对象
      isConflict: false, assets: [],
      deleted: true, deletedAt: deleted.deletedAt,
    });
  }

  // 4. 写新清单（commit + latest）
  report({ phase: "manifest", message: "写入同步清单..." });
  manifestNotes.sort((a, b) => a.sortOrder - b.sortOrder);
  const commitId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    workspaceId: "default",
    commitId,
    createdAt: completedAt,
    notes: manifestNotes,
  };
  const manifestOutput = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await remote.put(`manifests/${commitId}.json`, manifestOutput, "application/json");
  await remote.put("manifests/latest.json", manifestOutput, "application/json");

  for (const note of manifestNotes) {
    store.setBaseHash(note.id, note.contentHash);
    store.markSynced(note.id);
  }
  const result: SyncResult = { uploaded, downloaded, conflicts, manifestId: commitId, completedAt };
  store.markSyncComplete(completedAt);
  store.recordSyncResult(JSON.stringify(result));

  report({ phase: "done", message: "同步完成" });
  return result;
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
  if (!Array.isArray(m.notes)) throw new Error("清单格式无效：notes 不是数组");
  for (const note of m.notes) {
    if (!note || typeof note !== "object") throw new Error("清单格式无效：note 非对象");
    const n = note as Partial<ManifestNote>;
    if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.contentHash !== "string") {
      throw new Error(`清单格式无效：note 缺少 id/title/contentHash（id=${String(n.id)}）`);
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
    }
    if (n.isLocked !== undefined && typeof n.isLocked !== "boolean") throw new Error("清单格式无效：isLocked 非法");
    if (n.lockedAt !== undefined && n.lockedAt !== null && typeof n.lockedAt !== "string") throw new Error("清单格式无效：lockedAt 非法");
    if (n.deleted !== undefined && typeof n.deleted !== "boolean") throw new Error("清单格式无效：deleted 非法");
    if (n.deletedAt !== undefined && typeof n.deletedAt !== "string") throw new Error("清单格式无效：deletedAt 非法");
  }
}

/** 安全单路径段：拒绝空、./.. 以及含 / 或 \\ 的字符串（防目录穿越） */
export function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}
