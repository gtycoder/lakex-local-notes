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
interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean;
  deletedAt?: string;
}

interface Manifest {
  version: number; workspaceId: string; commitId: string; createdAt: string;
  notes: ManifestNote[];
}

export interface SyncResult {
  uploaded: number; downloaded: number; conflicts: number;
  manifestId: string; completedAt: string;
}

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "done";
  current?: number;
  total?: number;
  message: string;
}

const MANIFEST_VERSION = 2;

// ===== ObjectStore：S3 兼容客户端（七牛云等） =====
class ObjectStore {
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
  validate(settings);
  const remote = new ObjectStore(settings);
  await remote.test();
  return "连接成功，Bucket 可访问";
}

export async function syncNow(store: Store, onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validate(settings);
  const remote = new ObjectStore(settings);
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "connect", message: "正在连接 S3..." });
  await remote.test();

  // 1. 读取远程清单
  const manifestBytes = await remote.getOptional("manifests/latest.json");
  const remoteManifest: Manifest | null = manifestBytes ? JSON.parse(manifestBytes.toString("utf8")) : null;
  if (remoteManifest && remoteManifest.version !== MANIFEST_VERSION) {
    throw new Error(`清单版本不兼容（本地 ${MANIFEST_VERSION}，远端 ${remoteManifest.version}）`);
  }

  // 2. 下载阶段：远端有而本地缺失/不同的笔记
  let downloaded = 0;
  let conflicts = 0;
  if (remoteManifest) {
    // 本地已删除笔记的墓碑（下载阶段生效：本地删除优先，不重新拉取）
    const tombstoned = new Set(store.listDeletedNotesForSync().map((d) => d.id));
    const remoteTotal = remoteManifest.notes.length;
    let remoteIndex = 0;
    for (const rn of remoteManifest.notes) {
      remoteIndex += 1;
      report({ phase: "download", current: remoteIndex, total: remoteTotal, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
      // 云端已删除：本地若有则删除（墓碑防重拉），不下载对象
      if (rn.deleted) {
        const exists = store.listNotesForSync().some((n) => n.id === rn.id);
        if (exists) store.deleteTreeNode(rn.id);
        continue;
      }
      // 本地已删除而云端未标记：本地删除优先，跳过下载（上传阶段会标记 deleted）
      if (tombstoned.has(rn.id)) continue;
      const local = store.listNotesForSync().find((n) => n.id === rn.id);
      const localHash = local ? store.contentHash(local.id) : null;
      if (localHash === rn.contentHash) {
        store.setBaseHash(rn.id, rn.contentHash);
        store.markSynced(rn.id);
        continue;
      }
      // 下载 .lake
      const lakeBytes = await remote.getOptional(`objects/${rn.contentHash}.lake`);
      if (!lakeBytes) throw new Error(`清单引用的文档对象不存在: ${rn.contentHash}`);
      // 下载资源文件（manifest 里列出）
      const assets: { filename: string; bytes: Buffer }[] = [];
      for (const asset of rn.assets || []) {
        const bytes = await remote.getOptional(`assets/${rn.id}/${asset.filename}`);
        if (bytes) assets.push({ filename: asset.filename, bytes });
      }
      const base = store.baseHash(rn.id);
      const localChanged = localHash !== null && localHash !== base;
      const remoteChanged = rn.contentHash !== base;
      if (localChanged && remoteChanged) {
        // 本地和远端都改过 → 冲突副本
        const conflictId = crypto.randomUUID();
        const title = `${rn.title}（冲突副本 ${new Date().toISOString().slice(0, 10)}）`;
        store.importRemoteNote(
          { id: conflictId, title, parentId: rn.parentId, sortOrder: rn.sortOrder + 1, updatedAt: rn.updatedAt, isConflict: true, contentHash: rn.contentHash },
          lakeBytes, assets
        );
        store.setBaseHash(conflictId, rn.contentHash);
        conflicts += 1;
      } else if (localChanged) {
        // 仅本地改过、远端未改：本地为准，交给上传阶段（不能下载覆盖本地修改）
        continue;
      } else {
        store.importRemoteNote(
          { id: rn.id, title: rn.title, parentId: rn.parentId, sortOrder: rn.sortOrder, updatedAt: rn.updatedAt, isConflict: rn.isConflict, contentHash: rn.contentHash },
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
  const remoteById = new Map<string, ManifestNote>(
    (remoteManifest?.notes ?? []).map((n) => [n.id, n])
  );
  const orphans = new Set(store.listOrphanAssets().map((o) => `${o.noteId}/${o.filename}`));
  let uploaded = 0;
  const manifestNotes: ManifestNote[] = [];

  const localTotal = localNotes.length;
  let localIndex = 0;
  for (const note of localNotes) {
    localIndex += 1;
    report({ phase: "upload", current: localIndex, total: localTotal, message: `上传笔记「${note.title}」` });
    const hash = store.contentHash(note.id);
    const assets: { filename: string; size: number; hash: string }[] = [];
    if (remoteHashes.get(note.id) !== hash) {
      // 上传 .lake
      const lakeBytes = fs.readFileSync(store.notePathFor(note.id));
      await remote.put(`objects/${hash}.lake`, lakeBytes, "text/lake; charset=utf-8");
      // 上传资源（跳过孤儿）
      const dir = store.noteAssetsPathFor(note.id);
      if (fs.existsSync(dir)) {
        for (const filename of fs.readdirSync(dir)) {
          const full = path.join(dir, filename);
          const stat = fs.statSync(full);
          if (!stat.isFile()) continue;
          if (orphans.has(`${note.id}/${filename}`)) continue;
          const bytes = fs.readFileSync(full);
          await remote.put(`assets/${note.id}/${filename}`, bytes, mimeTypeFor(filename));
          assets.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
        }
      }
      uploaded += 1;
    }
    manifestNotes.push({
      id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
      updatedAt: note.updatedAt, contentHash: hash, isConflict: note.isConflict, assets,
    });
  }

  // 3.5 墓碑：云端有而本地已删除的笔记 → 标记 deleted（不重新上传对象）
  const localIds = new Set(localNotes.map((n) => n.id));
  for (const deleted of store.listDeletedNotesForSync()) {
    if (remoteById.has(deleted.id) && !localIds.has(deleted.id)) {
      manifestNotes.push({
        id: deleted.id, title: deleted.title, parentId: deleted.parentId,
        sortOrder: deleted.sortOrder, updatedAt: deleted.updatedAt,
        contentHash: deleted.id, // 占位，deleted 标记不会下载对象
        isConflict: false, assets: [],
        deleted: true, deletedAt: deleted.deletedAt,
      });
    }
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

function validate(settings: S3Settings): void {
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

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function mimeTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}
