/**
 * 同步纯逻辑工具（lake-core，Step A 拆分产物）。
 *
 * 源：electron/sync.ts（v4 协议基准实现），仅"移动代码位置"，不改语义。
 * 适配（行为等价，见 SYNC-SPLIT-STEPA-PRECHECK）：
 * - Buffer → Uint8Array（core 禁 node:）
 * - Buffer.toString("utf8") → TextDecoder（等价测试）
 * - node:crypto sha256 → sha256Sync（纯 JS 同步，等价测试）
 *
 * CORE-05（261028）：manifest v2 的清单解析 / 逐字段校验 / 版本白名单 / 键构造 / 线上形态映射
 * 已随 v3 转正整体删除（v3 云端只有 pointer + 内容寻址索引，见 src/core/s3v3/protocol/）。
 * 协议版本事实也迁到 `S3V3_POINTER_VERSION`（src/core/s3v3/protocol/s3v3Types.ts），
 * 本模块不再承载任何「协议版本」常量。这里只留两端仍在用的通用工具。
 */
import { sha256Sync } from "./sha256Sync.js";

// ===== 共享类型 =====
export interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

/** gzip 魔数（0x1f 0x8b）。JSON/PNG/JPEG 等实际内容不可能以此开头，可按魔数安全识别 gzip 对象。 */
const GZIP_MAGIC = [0x1f, 0x8b];
/** 键构造统一 ASCII 校验：防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）。 */
const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
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

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY_RE.test(key)) throw new Error(`S3 键包含非法字符: ${key}`);
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
