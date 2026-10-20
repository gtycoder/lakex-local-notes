/**
 * S3 配置迁移码（桌面 ↔ 手机）—— 对应思源「导入 / 导出 S3 同步配置」的两个按钮。
 *
 * 为什么需要：安卓端手填 Endpoint / Region / Bucket / 前缀 / AK / SK 六个字段很痛苦；桌面已经有一份
 * 可用配置，导出成一串迁移码，在另一端粘贴导入即可。
 *
 * 形态：`LNS3.1.<base64url(iv || AES-GCM 密文)>`，明文载荷是 JSON（见 S3TransferPayload）。
 * 为什么加一层加密：迁移码会经过剪贴板 / 微信等第三方文本通道，明文等于把 AK/SK 暴露给任何看到
 * 这段文字的人。**但密钥种子内置在本模块源码里 ⇒ 这只是"防误读 / 防随手转发"的封装，不是安全边界**
 * —— 迁移码只发给自己的设备，别发群 / 公开；怀疑泄露时请在 S3 控制台轮换密钥。
 * （思源同样用内置固定密钥对导出的 S3 配置做 AES 加密；这里换成 WebCrypto AES-GCM，带认证，
 *  迁移码被改掉一个字符就会解码失败。）
 *
 * 红线边界（lake-core）：纯逻辑，不碰 DOM / node:。WebCrypto 是两端（Chromium / Node 24）都有的标准能力。
 */
import { normalizeEndpoint, validateS3Settings, type S3Settings } from "./syncUtils.js";

/** 迁移码前缀（版本化；解码只认这个前缀，便于把「贴错内容」与「码损坏」分开报错）。 */
export const S3_TRANSFER_PREFIX = "LNS3.1.";
/** 迁移码上限：正常 ~400 字符；超过即视为贴错/攻击输入，避免在解码前做无界工作。 */
const MAX_CODE_CHARS = 8 * 1024;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** 固定种子：只为避免明文直出（见文件头）。改这个值会让旧迁移码失效。 */
const KEY_SEED = "lake-notes.s3-config-transfer.v1";

interface S3TransferPayload {
  app: "lake-notes";
  kind: "s3-config";
  v: 1;
  exportedAt: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** 迁移码摘要：只用于 UI 回执（绝不含 Secret；AK 打码）。 */
export interface S3TransferSummary {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyMasked: string;
  forcePathStyle: boolean;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedKey: Promise<CryptoKey> | null = null;

function transferKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = (async () => {
      const seed = new TextEncoder().encode(KEY_SEED);
      const digest = await crypto.subtle.digest("SHA-256", seed);
      return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
  }
  return cachedKey;
}

/** AK 打码：保留首尾各 4 位，中间省略；短于 12 位一律全打码。 */
export function maskAccessKeyId(accessKeyId: string): string {
  const key = accessKeyId.trim();
  if (key.length < 12) return "********";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** 把 S3 配置压成 UI 回执摘要（不含 Secret）。 */
export function summarizeS3Settings(settings: S3Settings): S3TransferSummary {
  return {
    endpoint: settings.endpoint,
    region: settings.region,
    bucket: settings.bucket,
    prefix: settings.prefix,
    accessKeyMasked: maskAccessKeyId(settings.accessKeyId),
    forcePathStyle: settings.forcePathStyle,
  };
}

function decodeBase64UrlOrThrow(text: string): Uint8Array {
  try {
    return base64UrlToBytes(text);
  } catch {
    throw new Error("S3 迁移码无效或已损坏（可能复制不完整）");
  }
}

/**
 * 生成迁移码（导出）。要求本机配置完整、合法且含 Secret —— 缺 Secret 导出去也连不上，直接拒绝。
 */
export async function encodeS3ConfigTransfer(settings: S3Settings, exportedAt: Date = new Date()): Promise<string> {
  if (!settings.secretAccessKey.trim()) throw new Error("本机 S3 配置没有可读取的 Secret Key，无法导出");
  const normalized: S3Settings = {
    ...settings,
    endpoint: normalizeEndpoint(settings.endpoint),
    region: settings.region.trim() || "cn-east-1",
    prefix: settings.prefix,
  };
  try {
    validateS3Settings(normalized);
  } catch (error) {
    throw new Error(`当前 S3 配置不合法，无法导出：${(error as Error).message}`);
  }
  const payload: S3TransferPayload = {
    app: "lake-notes",
    kind: "s3-config",
    v: 1,
    exportedAt: exportedAt.toISOString(),
    endpoint: normalized.endpoint,
    region: normalized.region,
    bucket: normalized.bucket,
    prefix: normalized.prefix,
    accessKeyId: normalized.accessKeyId,
    secretAccessKey: normalized.secretAccessKey,
    forcePathStyle: normalized.forcePathStyle,
  };
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await transferKey(), plaintext));
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return S3_TRANSFER_PREFIX + bytesToBase64Url(packed);
}

/** 配置文件（.json）上限：正常 ~1KB；超过即视为选错文件。 */
const MAX_FILE_CHARS = 64 * 1024;

interface S3TransferFile {
  app: "lake-notes";
  kind: "s3-config";
  version: 1;
  exportedAt: string;
  /** 内层仍是 `LNS3.1.` 迁移码（加密载荷），文件本身不含明文密钥。 */
  payload: string;
}

/** 导出文件名：lake-s3-config-YYYYMMDD-HHmmss.json（本地时间）。 */
export function s3ConfigTransferFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `lake-s3-config-${stamp}.json`;
}

/**
 * 生成导出文件文本（.json 包装一层元数据，内层是加密迁移码）。
 * 文件便于识别与传输；密钥仍只在 AES-GCM 载荷里，文件本身不含明文。
 */
export async function encodeS3ConfigTransferFile(settings: S3Settings, exportedAt: Date = new Date()): Promise<string> {
  const payload = await encodeS3ConfigTransfer(settings, exportedAt);
  const file: S3TransferFile = {
    app: "lake-notes",
    kind: "s3-config",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    payload,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/**
 * 解析配置文件（导入）。兼容：① 本模块导出的 .json 包装；② 直接是迁移码的 .txt。
 * 只做结构/合法性校验与规范化；`forcePathStyle` 原样返回，由移动端按 D2 定稿强制关闭。
 */
export async function decodeS3ConfigTransferFile(text: string): Promise<S3Settings> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("配置文件是空的");
  if (trimmed.length > MAX_FILE_CHARS) throw new Error("配置文件过大，不像是 S3 配置文件");
  if (trimmed.startsWith(S3_TRANSFER_PREFIX)) return decodeS3ConfigTransfer(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("不是 LocalLakeNotes 的 S3 配置文件");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("不是 LocalLakeNotes 的 S3 配置文件");
  const file = parsed as Partial<S3TransferFile>;
  if (file.app !== "lake-notes" || file.kind !== "s3-config") throw new Error("不是 LocalLakeNotes 的 S3 配置文件");
  if (file.version !== 1) throw new Error("S3 配置文件版本不受支持（请先升级应用）");
  if (typeof file.payload !== "string") throw new Error("S3 配置文件缺少载荷");
  return decodeS3ConfigTransfer(file.payload);
}

/**
 * 解析迁移码（导入）。只做结构/合法性校验与规范化；`forcePathStyle` 原样返回，
 * 由移动端按 D2 定稿强制关闭（并在 UI 说明）。
 */
export async function decodeS3ConfigTransfer(code: string): Promise<S3Settings> {
  const compact = code.replace(/\s+/g, "");
  if (!compact) throw new Error("请先粘贴 S3 迁移码");
  if (compact.length > MAX_CODE_CHARS) throw new Error("S3 迁移码过长，不像是有效内容");
  if (!compact.startsWith(S3_TRANSFER_PREFIX)) {
    throw new Error("不是 LocalLakeNotes 的 S3 迁移码（应以 LNS3.1. 开头）");
  }
  const packed = decodeBase64UrlOrThrow(compact.slice(S3_TRANSFER_PREFIX.length));
  if (packed.length < IV_BYTES + TAG_BYTES) throw new Error("S3 迁移码无效或已损坏（可能复制不完整）");
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, IV_BYTES) },
      await transferKey(),
      packed.slice(IV_BYTES),
    ));
  } catch {
    throw new Error("S3 迁移码无效或已损坏（可能复制不完整）");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("S3 迁移码内容无法解析");
  }
  if (!payload || typeof payload !== "object") throw new Error("S3 迁移码内容无法解析");
  const raw = payload as Partial<S3TransferPayload>;
  if (raw.app !== "lake-notes" || raw.kind !== "s3-config") throw new Error("S3 迁移码来源不是 LocalLakeNotes");
  if (raw.v !== 1) throw new Error("S3 迁移码版本不受支持（请先升级应用）");

  const strings: Array<keyof Pick<S3TransferPayload, "endpoint" | "region" | "bucket" | "prefix" | "accessKeyId" | "secretAccessKey">> = [
    "endpoint", "region", "bucket", "prefix", "accessKeyId", "secretAccessKey",
  ];
  for (const key of strings) {
    const value = raw[key];
    if (typeof value !== "string") throw new Error("S3 迁移码缺少字段或格式不正确");
    if (value.length > 2048) throw new Error("S3 迁移码字段过长");
  }
  if (raw.forcePathStyle !== undefined && typeof raw.forcePathStyle !== "boolean") {
    throw new Error("S3 迁移码字段格式不正确");
  }
  const settings: S3Settings = {
    endpoint: normalizeEndpoint(raw.endpoint!.trim()),
    region: raw.region!.trim() || "cn-east-1",
    bucket: raw.bucket!.trim(),
    prefix: raw.prefix!,
    accessKeyId: raw.accessKeyId!.trim(),
    secretAccessKey: raw.secretAccessKey!.trim(),
    forcePathStyle: raw.forcePathStyle ?? false,
  };
  if (!settings.bucket || !settings.accessKeyId || !settings.secretAccessKey) {
    throw new Error("S3 迁移码缺少必填字段（Bucket / Access Key / Secret Key）");
  }
  try {
    validateS3Settings(settings);
  } catch (error) {
    throw new Error(`S3 迁移码校验失败：${(error as Error).message}`);
  }
  return settings;
}
