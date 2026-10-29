/**
 * 移动端桥的**上下文**（C3-5 第①步：从 bridge.ts 纯抽取，零行为变化）。
 *
 * 这里只放「域无关」的东西：DB 单例/初始化、资源字节缓存、互斥域队列包装、S3 客户端工厂、
 * 同步设置读取。域方法在 assets/sync/notes/quickNotes/tree 五个文件里；bridge.ts 只负责组合。
 * 域之间的少量 helper（mobileCloudState 等）由 sync 域导出给 bridge/quickNotes 复用。
 */
import { NativeSqliteDb } from "../native/nativeSqliteDb";

import { applyMobileSchema } from "../data/schema";
import { seedWelcomeQuickNote } from "../data/welcomeQuickNote";
import { ensureV3StateTable } from "../data/v3StateRepository";
import { reconcileIndex } from "../data/searchIndex";
import { createMobileLocalStorePort, type MobileLocalStorePort } from "../data/localStorePort";
import { sniffImageFormat, readImageDimensions } from "../../core/imageUtils.js";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../../core/storeLimits.js";
import { loadSettings } from "../../lib/settings";
import { classifyOp, type MaintenanceOp, type PriorityOp, type WriteOp } from "../../core/maintenancePolicy.js";
import { normalizeSyncSettings } from "../../core/syncSettings.js";
import { maintenanceQueue, priorityQueue, writeLock } from "../sync/maintenanceLocks";
import { createMobileS3Client } from "../native/s3Store";
import type { S3Settings, SyncSettings } from "../../lib/types";

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lakex-local-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
export const DEFAULT_S3_PREFIX = "lakex-local-notes";

export const S3_STORAGE_KEY = "lakex-local-notes-mobile.s3";
/** 云同步开关 / 自动同步节奏（与桌面 SyncSettings 同形）。关闭 = 纯离线本地空间（用户 261006 定稿）。 */
export const SYNC_STORAGE_KEY = "lakex-local-notes-mobile.sync";
export const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };
const MOBILE_DATABASE = "lakex-local-notes-mobile";

/** 是否已存过 S3 配置（只判本地是否存在，不读密钥；密钥在 Keystore）。 */
function hasStoredS3Settings(): boolean {
  try {
    return Boolean(localStorage.getItem(S3_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** 是否**存过**同步设置（261027「新设备默认按需」判定：存过就以用户值为准，绝不再改）。 */
export function hasStoredSyncSettings(): boolean {
  try {
    return localStorage.getItem(SYNC_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function readSyncSettings(): SyncSettings {
  // 261022（用户点单，与桌面同口径）：**默认开关 = 是否已配置 S3** —— 全新安装没有任何 S3 配置时
  // 「启用云同步」默认关闭（没配置与关掉语义等价）；已配置的旧库仍默认开着（不回归）；存过的值优先。
  const fallback: SyncSettings = { ...DEFAULT_SYNC_SETTINGS, enabled: hasStoredS3Settings() };
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return fallback;
    // 归一单一来源 = core/syncSettings（CORE-14）：与桌面同一套白名单 / interval≥1 / deferAssets 缺省。
    return normalizeSyncSettings(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export let db: NativeSqliteDb | null = null;
let dbInitialization: Promise<NativeSqliteDb> | null = null;
/** 运行期资源缓存（新上传/同步中使用）；持久化资源不在启动时全量载入。key = "{noteId}/{filename}" */
export const assets = new Map<string, Uint8Array>();

/** 附件实际上限 = 设置里的「附件大小上限」（与设置页同键），并夹到协议上限。
 *  图片仍走 MAX_IMAGE_BYTES（图片档位与附件档位是两件事，不合并）。 */
export function effectiveAttachmentLimitBytes(): number {
  const configured = loadSettings().maxAttachmentBytes;
  if (!Number.isFinite(configured) || configured <= 0) return MAX_ATTACHMENT_BYTES;
  return Math.min(configured, MAX_ATTACHMENT_BYTES);
}

export function assertResourceBytes(bytes: Uint8Array): void {
  if (sniffImageFormat(bytes) != null) {
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("图片为空或超过 25 MiB");
    const dimensions = readImageDimensions(bytes);
    if (dimensions && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
      throw new Error(`图片尺寸过大（${dimensions.width}x${dimensions.height}），上限 ${MAX_IMAGE_PIXELS} 像素`);
    }
    return;
  }
  if (bytes.length === 0) throw new Error("附件为空");
  const limit = effectiveAttachmentLimitBytes();
  if (bytes.length > limit) throw new Error(`附件超过 ${limit / 1024 / 1024} MiB 上传上限`);
}

export async function initializeDb(): Promise<NativeSqliteDb> {
  const openedDb = await NativeSqliteDb.open(MOBILE_DATABASE);
  await applyMobileSchema(openedDb);
  // 261027 真机新装发现：v3 账本表原来只在 MobileDeviceStore.init 里建，而「新设备默认按需」判定/
  // 打开文档补拉（ensureAssetsNative）会在首次同步前读它 ⇒ 全新安装直接报 no such table。统一在开库时建。
  await ensureV3StateTable(openedDb);
  db = openedDb;
  // 首启默认小记（261029 用户点单）：全新库写入与桌面欢迎文档同一份欢迎页（含 Gitee/GitHub 使用说明链接）。
  // 必须在 reconcileIndex 之前写，索引重建才能把它一起收进去；内部失败只 warn，不阻断启动。
  try { await seedWelcomeQuickNote(openedDb); } catch (error) { console.warn("[welcome] 默认小记初始化异常：", error); }
  try { await reconcileIndex(openedDb); } catch (error) { console.warn("[search] reconcile failed:", error); }
  return openedDb;
}

export async function ensureDb(): Promise<NativeSqliteDb> {
  if (db) return db;
  dbInitialization ??= initializeDb().catch((error: unknown) => {
    dbInitialization = null;
    throw error;
  });
  return dbInitialization;
}

/** S3 配置齐全性检查（261009）：密钥缺失时给**可执行**的提示（详见 bridge.ts 历史注释）。 */
export function assertS3Credentials(cfg: S3Settings): void {
  if (!cfg.bucket) throw new Error("S3 未配置 Bucket：请到「设置 → 同步设置」填写并保存");
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 密钥缺失（本机未保存或已被清除）：请到「设置 → 同步设置」重新填写 Access Key / Secret Key");
  }
}

export async function createS3Client(cfg: S3Settings): Promise<import("@aws-sdk/client-s3").S3Client> {
  assertS3Credentials(cfg);
  // D6（261016）：与全部同步路径共用**同一个**工厂。
  return createMobileS3Client({
    region: cfg.region, endpoint: cfg.endpoint, accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey, forcePathStyle: cfg.forcePathStyle,
  });
}

/** 同步仍需要的本地存储最小面（D-7 收口后：兜底笔记本 + 墓碑族；v2 SyncDbPort 其余方法已删）。 */
export const dbPort: MobileLocalStorePort = createMobileLocalStorePort(() => db!);

/** 判据校验：调用点声明的类别必须与 src/core/maintenancePolicy.ts 的表一致（写错当场抛，不静默降级）。 */
export function assertOpClass(op: string, expected: "write" | "maintenance" | "priority"): void {
  const actual = classifyOp(op);
  if (actual !== expected) throw new Error("桥操作 " + op + " 被判据登记为 " + actual + "，但这里按 " + expected + " 入队（改其一必须同时改另一处）");
}
export function runWrite<T>(op: WriteOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "write");
  return writeLock.run("write", async () => await operation());
}
export function runMaintenance<T>(op: MaintenanceOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "maintenance");
  return maintenanceQueue.run("maintenance", async () => await operation());
}
export function runPriority<T>(op: PriorityOp, operation: () => T | Promise<T>): Promise<T> {
  assertOpClass(op, "priority");
  return priorityQueue.run("priority", async () => await operation());
}
