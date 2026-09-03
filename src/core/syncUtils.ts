/**
 * 同步纯逻辑工具（lake-core，Step A 拆分产物）。
 *
 * 源：electron/sync.ts（v4 协议基准实现），仅"移动代码位置"，不改语义。
 * 适配（行为等价，见 SYNC-SPLIT-STEPA-PRECHECK）：
 * - Buffer → Uint8Array（core 禁 node:）
 * - Buffer.toString("utf8") → TextDecoder（等价测试）
 * - node:crypto sha256 → sha256Sync（纯 JS 同步，等价测试）
 * - node:path.extname → extnameLikeNode（纯 JS 复刻，等价测试）
 * 常量（MANIFEST_VERSION / MAX_MANIFEST_* 系列 / SAFE_KEY_RE / GZIP_MAGIC）随迁，sync.ts re-export。
 */
import { sha256Sync } from "./sha256Sync.js";
import type { Manifest, ManifestFolder, ManifestNote } from "./manifestTypes.js";
import { mergeLockState } from "./syncDecision.js";

// ===== 共享类型 =====
export interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

// ===== 常量（随迁，原值不变） =====
export const MANIFEST_VERSION = 4;
export const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
export const MAX_MANIFEST_NOTES = 200_000;
export const MAX_MANIFEST_FOLDERS = 50_000;
/** gzip 魔数（0x1f 0x8b）。JSON/PNG/JPEG 等实际内容不可能以此开头，可按魔数安全识别 gzip 对象。 */
const GZIP_MAGIC = [0x1f, 0x8b];
/** 键构造统一 ASCII 校验：防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）。 */
const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;

// ===== 记账快照（V5 §5.2：构造 markSyncedIfUnchanged 的"同步后应为状态"） =====
export function syncSnapshot(local: {
  title: string; parentId: string | null; sortOrder: number; updatedAt: string;
  isLocked?: boolean; lockedAt?: string | null; icon?: string | null;
}, localHash: string, rn: ManifestNote, metaApplied: boolean, effectiveParent: string | null) {
  const merged = mergeLockState(!!local.isLocked, local.lockedAt ?? null, !!rn.isLocked, rn.lockedAt ?? null);
  return {
    contentHash: localHash,
    updatedAt: metaApplied ? rn.updatedAt : local.updatedAt,
    title: metaApplied ? rn.title : local.title,
    parentId: metaApplied ? effectiveParent : local.parentId,
    sortOrder: metaApplied ? rn.sortOrder : local.sortOrder,
    isLocked: merged.locked,
    lockedAt: merged.at,
    icon: metaApplied ? (rn.icon ?? null) : (local.icon ?? null),
  };
}

/** 解析并校验 Lake 清单：字节上限 → JSON.parse → 结构/条目校验。上限可注入（测试用）。 */
export function parseLakeManifest(
  bytes: Uint8Array,
  limits: { maxBytes?: number; maxNotes?: number; maxFolders?: number } = {},
): Manifest {
  const maxBytes = limits.maxBytes ?? MAX_MANIFEST_BYTES;
  if (bytes.length > maxBytes) {
    throw new Error(`清单过大（${bytes.length} 字节 > ${maxBytes}），拒绝加载`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes)); }
  catch { throw new Error("同步清单不是合法 JSON"); }
  validateManifest(parsed, { maxNotes: limits.maxNotes ?? MAX_MANIFEST_NOTES, maxFolders: limits.maxFolders ?? MAX_MANIFEST_FOLDERS });
  return parsed;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

export function objectKey(noteId: string, contentHash: string): string {
  return `objects/${noteId}-${contentHash}.lake`;
}

/** GC 引用收集（纯 Set 运算）。 */
export function collectManifestRefs(manifest: Manifest, out: Set<string>): void {
  for (const note of manifest.notes) {
    // deleted 墓碑保护删除前正文对象（真实 hash；占位符对象不在云端，加入无害）。
    // 软删笔记的资源由 runDeepCleanup 按"软删前缀"保护（墓碑不携带资源清单）。
    out.add(objectKey(note.id, note.contentHash));
    if (note.deleted) continue;
    for (const asset of note.assets ?? []) out.add(`assets/${note.id}/${asset.filename}`);
  }
}

/** 参照思源 util.NormalizeEndpoint：规范化 S3 endpoint */
export function normalizeEndpoint(endpoint: string): string {
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
  // V5 §5.6：强制 https（localhost/127.0.0.1 开发例外；防签名请求重放到明文端）
  let parsed: URL;
  try { parsed = new URL(normalizeEndpoint(settings.endpoint)); } catch { throw new Error("S3 Endpoint 不是合法 URL"); }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error("S3 Endpoint 必须使用 HTTPS（本地开发可用 http://localhost）");
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as { name?: string; message?: string; $metadata?: unknown };
    return anyError.message || String(error);
  }
  return String(error);
}

export function isNoSuchKey(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = error.message ?? "";
  // 404 缺失对象判定：缺失对象的错误名随操作/供应商不同——GetObject=NoSuchKey，部分操作（AWS/七牛 Kodo）
  // 返回 NotFound 且消息文本可能是 "UnknownError" 等，故必须按 name 判定，不能只看 message。
  return name === "NoSuchKey" || name === "NotFound" || message.includes("NoSuchKey") || message.includes("404");
}

/** SHA-256 hex（同步，Uint8Array 输入；输出与 node:crypto 一致，见 sha256Sync.test.ts） */
export function sha256Hex(bytes: Uint8Array): string {
  return sha256Sync(bytes);
}

/**
 * 纯 JS 复刻 node:path.extname（core 禁 node:path）。
 * 对资产文件名（安全段 `^[A-Za-z0-9._/-]+$`，无反斜杠）行为与 path.extname 完全一致；
 * 等价测试覆盖边界（.gitignore / a. / a.b.c / 目录前缀 / 中文）。
 * 算法参考 node:path posix 实现。
 */
export function extnameLikeNode(p: string): string {
  let startDot = -1;
  let startIndex = 0;
  let endIndex = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = p.length - 1; i >= 0; --i) {
    const code = p.charCodeAt(i);
    if (code === 47 /* / */) {
      if (!matchedSlash) { startIndex = i + 1; break; }
      continue;
    }
    if (endIndex === -1) { matchedSlash = false; endIndex = i + 1; }
    if (code === 46 /* . */) {
      if (startDot === -1) { startDot = i; }
      else if (preDotState !== 1) { preDotState = 1; }
    } else if (startDot !== -1) { preDotState = -1; }
  }
  if (startDot === -1 || endIndex === -1 || preDotState === 0 || (preDotState === 1 && startDot === endIndex - 1 && startDot === startIndex + 1)) {
    return "";
  }
  return p.slice(startDot, endIndex);
}

export function mimeTypeFor(filename: string): string {
  const ext = extnameLikeNode(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY_RE.test(key)) throw new Error(`S3 键包含非法字符: ${key}`);
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 审计 #3/#19：远程 manifest 运行时 schema 校验（远程 JSON 不可信，不能直接断言类型） */
export function validateManifest(manifest: unknown, limits: { maxNotes: number; maxFolders: number }): asserts manifest is Manifest {
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
  if (m.notes.length > limits.maxNotes) throw new Error(`清单条目过多（${m.notes.length} > ${limits.maxNotes}），拒绝加载`);
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
    if (n.trashedAt !== undefined && n.trashedAt !== null && typeof n.trashedAt !== "string") throw new Error("清单格式无效：trashedAt 非法");
    if (n.deletedFromParentId !== undefined && n.deletedFromParentId !== null && typeof n.deletedFromParentId !== "string") throw new Error("清单格式无效：deletedFromParentId 非法");
  }
  if (!Array.isArray(m.folders)) throw new Error("清单格式无效：folders 非数组");
  if (m.folders.length > limits.maxFolders) throw new Error(`清单目录条目过多（${m.folders.length} > ${limits.maxFolders}），拒绝加载`);
  for (const folder of m.folders) {
    if (!folder || typeof folder !== "object") throw new Error("清单格式无效：folder 非对象");
    const f = folder as Partial<ManifestFolder>;
    if (typeof f.id !== "string" || typeof f.title !== "string" || typeof f.sortOrder !== "number") {
      throw new Error("清单格式无效：folder 缺少 id/title/sortOrder");
    }
    if (f.parentId !== null && typeof f.parentId !== "string") throw new Error("清单格式无效：folder.parentId 非法");
    if (f.nodeType !== "notebook" && f.nodeType !== "group") throw new Error("清单格式无效：folder.nodeType 非法");
    if (f.trashedAt !== undefined && f.trashedAt !== null && typeof f.trashedAt !== "string") throw new Error("清单格式无效：folder.trashedAt 非法");
    if (f.deletedFromParentId !== undefined && f.deletedFromParentId !== null && typeof f.deletedFromParentId !== "string") throw new Error("清单格式无效：folder.deletedFromParentId 非法");
  }
}
