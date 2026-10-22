/**
 * 移动端桥的**上下文**（C3-5 第①步：从 bridge.ts 纯抽取，零行为变化）。
 *
 * 这里只放「域无关」的东西：DB 单例/初始化、资源字节缓存、互斥域队列包装、S3 客户端工厂、
 * 同步设置读取。域方法在 assets/sync/notes/quickNotes/tree 五个文件里；bridge.ts 只负责组合。
 * 域之间的少量 helper（mobileCloudState 等）由 sync 域导出给 bridge/quickNotes 复用。
 */
import { NativeSqliteDb } from "../native/nativeSqliteDb";
import { DEFAULT_MOBILE_DATABASE, migrateSnapshotToNativeSqlite } from "../native/nativeSqliteMigration";
import { saveAssetBytesFs, loadAssetBytesFs, removeAssetBytesFs, listNoteAssetKeysFs } from "../native/assetFs";
import { MOBILE_SCHEMA_VERSION, applyMobileSchema, hasLegacyBodySchema, readMobileSchemaVersion } from "../data/schema";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { reconcileIndex } from "../data/searchIndex";
import { createMobileSyncDbPort } from "../data/syncDbPort";
import { sniffImageFormat, readImageDimensions } from "../../core/imageUtils.js";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../../core/storeLimits.js";
import { classifyOp, type MaintenanceOp, type PriorityOp, type WriteOp } from "../../core/maintenancePolicy.js";
import { maintenanceQueue, priorityQueue, writeLock } from "../sync/maintenanceLocks";
import { createMobileS3Client } from "../native/s3Store";
import type { SyncDbPort } from "../../core/syncEngine.js";
import type { S3Settings, SyncSettings } from "../../lib/types";

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lake-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
export const DEFAULT_S3_PREFIX = "lake-notes";

export const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 云同步开关 / 自动同步节奏（与桌面 SyncSettings 同形）。关闭 = 纯离线本地空间（用户 261006 定稿）。 */
export const SYNC_STORAGE_KEY = "lake-notes-mobile.sync";
export const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };
const NATIVE_SQLITE_MIGRATION_MARKER = "lake-notes-mobile.native-sqlite-migration.v1";
const LEGACY_BODY_RESET_MARKER = "lake-notes-mobile.legacy-body-reset.v1";

function hasNativeSqliteMigrationMarker(): boolean {
  try { return localStorage.getItem(NATIVE_SQLITE_MIGRATION_MARKER) === "1"; }
  catch { return false; }
}

function markNativeSqliteMigrationDone(): void {
  try { localStorage.setItem(NATIVE_SQLITE_MIGRATION_MARKER, "1"); }
  catch { /* 写不上只会多跑一次 isDatabase 幂等探测 */ }
}

function hasLegacyBodyResetMarker(): boolean {
  try { return localStorage.getItem(LEGACY_BODY_RESET_MARKER) === "1"; }
  catch { return false; }
}

function markLegacyBodyResetDone(): void {
  try { localStorage.setItem(LEGACY_BODY_RESET_MARKER, "1"); }
  catch { /* 写不上只会多跑一次幂等目录清理 */ }
}

export function readSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      enabled: parsed.enabled !== false,
      autoMode: parsed.autoMode === "interval" || parsed.autoMode === "onOpenClose" ? parsed.autoMode : "manual",
      autoIntervalMinutes: typeof parsed.autoIntervalMinutes === "number" ? parsed.autoIntervalMinutes : 15,
    };
  } catch {
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

export let db: NativeSqliteDb | null = null;
let dbInitialization: Promise<NativeSqliteDb> | null = null;
/** 运行期资源缓存（新上传/同步中使用）；持久化资源不在启动时全量载入。key = "{noteId}/{filename}" */
export const assets = new Map<string, Uint8Array>();

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
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 协议上限`);
}

/**
 * 旧存储（正文在 SQLite）升级到文件正文时，把上一代数据目录一起清掉：
 * 本阶段按用户定稿「开发阶段数据可删」做一次性重置，不做逐篇迁移。
 * 目录列表与桌面布局对应；旧小记图片还可能在 note-assets/quick-notes 下，整棵 note-assets 一并清。
 */
async function resetLegacyBodyFiles(): Promise<void> {
  const dirs = ["notes", "usheets", "bitables", "boards", "quick-notes", "history", "draft-journal", "note-assets"];
  for (const path of dirs) {
    try {
      await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true });
    } catch { /* 不存在 / Web 预览无文件系统：忽略 */ }
  }
}

export async function initializeDb(): Promise<NativeSqliteDb> {
  const migrationDone = hasNativeSqliteMigrationMarker();
  const migration = migrationDone
    ? { status: "already-native" as const, databaseName: DEFAULT_MOBILE_DATABASE }
    : await migrateSnapshotToNativeSqlite();
  const openedDb = await NativeSqliteDb.open(migration.databaseName);
  if (!migrationDone) markNativeSqliteMigrationDone();
  // 快路径（261021）：schema 版本已到 ⇒ 跳过旧库探测（3 次 PRAGMA）与整库重置判定。
  const schemaVersion = await readMobileSchemaVersion(openedDb);
  const legacyBodySchema = schemaVersion >= MOBILE_SCHEMA_VERSION ? false : await hasLegacyBodySchema(openedDb);
  await applyMobileSchema(openedDb, { legacyBodySchema });
  if (legacyBodySchema && !hasLegacyBodyResetMarker()) {
    await resetLegacyBodyFiles();
    markLegacyBodyResetDone();
  }
  db = openedDb;
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

export const dbPort: SyncDbPort = createMobileSyncDbPort(() => db!, {
  assets,
  saveAssetFile: saveAssetBytesFs,
  loadAssetFile: loadAssetBytesFs,
  removeAssetFile: removeAssetBytesFs,
  listNoteAssetKeys: listNoteAssetKeysFs,
});

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
