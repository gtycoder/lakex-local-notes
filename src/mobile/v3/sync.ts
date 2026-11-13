import { S3v3SyncEngine, type QuickNotePushResult, type S3v3DeepCleanupResult, type S3v3SyncReport } from "../../core/s3v3Engine.js";
import type { S3v3Remote, S3v3Settings } from "../../core/s3v3Ports.js";
import type { S3v3DeviceStore } from "../../core/s3v3DeviceStore.js";
import type { MobileDb } from "../data/sqliteDb.js";
import * as historyRepository from "../data/historyRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { createMobileS3v3Remote, getMobileS3v3RemoteCached, invalidateMobileS3v3RemoteCache } from "./s3v3Remote.js";
import { countRemoteOps, remoteOpSummary } from "../../core/s3v3/remoteStats.js";
import { runQuickPush } from "../../core/s3v3/quickPush/pipeline.js";
import { rlog } from "../../lib/log";
import { mergeSyncWarnings } from "../../core/syncWarningMerge.js";
import { MOBILE_GC_RETENTION_DAYS } from "../sync/gcPolicy";

/**
 * 移动端 v3 同步编排（feature flag 下由 bridge.syncNow 调用）。
 * 注意：v1 只同步 Lake 文档（无附件/小记/目录写入）；真实库若含这些数据不得切 v3。
 */

const DEVICE_ID_KEY = "lakex-local-notes-mobile.v3.deviceId";
const EMPTY_CLOUD_KEY = "lakex-local-notes-mobile.v3.emptyCloud";

function mobileDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = "mobile-" + globalThis.crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch { return "mobile-unknown"; }
}

export interface MobileV3SyncOptions {
  /** 测试/CLI 注入；缺省用 Capacitor S3 client。 */
  remote?: S3v3Remote;
  deviceId?: string;
  /** 云端为空时的决策；缺省读 localStorage 开关，否则 throw。 */
  emptyCloud?: "upload" | "stay" | "throw";
  /** 阶段耗时回调（bridge 收集成结构化进度，供设置页展示；与桌面 onPhase 同源）。 */
  onPhase?: (phase: string, ms: number) => void;
  /** 结构化进度（阶段 + 计数 + 字节；由 bridge 节流转发到 UI）。 */
  onProgress?: (progress: import("../../core/s3v3Engine.js").S3v3Progress) => void;
  /** 按需资产（P0-4）：首拉不搬媒体字节，打开/预览时补拉。 */
  deferAssets?: boolean;
}

export async function runMobileV3Sync(db: MobileDb, settings: S3v3Settings, opts: MobileV3SyncOptions = {}): Promise<S3v3SyncReport> {
  const store = new MobileDeviceStore(db);
  await store.init();
  const remote = opts.remote ?? createMobileS3v3Remote(settings);
  const engine = new S3v3SyncEngine({
    remote, device: store, deviceId: opts.deviceId ?? mobileDeviceId(),
    onPhase: (phase, ms) => {
      if (ms >= 2000) console.warn(`[v3][slow] ${phase} ${ms}ms`);
      try { opts.onPhase?.(phase, ms); } catch { /* UI 回调自行负责 */ }
    },
    onProgress: (progress) => {
      try { opts.onProgress?.(progress); } catch { /* UI 回调自行负责 */ }
    },
  });
  let mode: "upload" | "stay" | "throw" = opts.emptyCloud ?? "upload";
  if (!opts.emptyCloud) {
    try {
      const override = localStorage.getItem(EMPTY_CLOUD_KEY);
      if (override === "upload" || override === "stay" || override === "throw") mode = override;
    } catch { /* 设备本地调试开关读不到 ⇒ 按默认 upload（不参与同步数据） */ }
  }
  const report = await engine.sync({ ...(mode === "throw" ? {} : { onEmptyCloud: mode }), ...(opts.deferAssets ? { deferAssets: true } : {}) });
  // task-44 / task-66：单篇 apply 失败 = 「本地这篇本轮没落地」，独立 kind apply_skipped（内部类型，非 wire）。
  // 不得复用 remote_incomplete（那是「远端内容不全」，文案会误导用户）；桌面端 desktopSync 同口径。
  const applyWarnings = store.drainApplyWarnings();
  const applyDetails = applyWarnings.map((w) => ({
    kind: "apply_skipped" as const,
    noteId: w.id,
    title: w.title,
    message: w.detail ?? "",
  }));
  for (const w of applyDetails) report.warnings.push("apply 跳过 " + (w.noteId ?? "") + "：" + w.message);
  // W4（261112）：一行式 warning 补成结构化项（无结构化明细者），与已有项去重；两端同一来源。
  const mergedWarnings = mergeSyncWarnings({ structured: report.warningDetails, extra: applyDetails, logLines: report.warnings });
  report.warningDetails.length = 0;
  report.warningDetails.push(...mergedWarnings);
  return report;
}
/**
 * 单条小记推送（parity E2）：只 upsert 这一条，其余条目/标签/墓碑在云端逐字段不变。
 * 返回 full-sync 时由调用方（bridge.pushSingleQuickNote）执行一次整轮，不静默降级。
 */
/** 单条推送专用选项（261110）：device 供测试注入以断言"不重建世界"。 */
export type MobileV3PushOptions = Pick<MobileV3SyncOptions, "remote" | "deviceId"> & { device?: S3v3DeviceStore };

export async function runMobileV3PushQuickNote(
  db: MobileDb,
  settings: S3v3Settings,
  id: string,
  opts: MobileV3PushOptions = {},
): Promise<QuickNotePushResult> {
  const store = opts.device ?? new MobileDeviceStore(db);
  // 单条推送不等整轮 staging 清点（省一次原生往返）；表结构用模块级 WeakSet 缓存，不重复 DDL。
  await store.init({ skipStagingCleanup: true });
  const remote = opts.remote ?? getMobileS3v3RemoteCached(settings);
  // 261110 提速证据：请求数 + 分段耗时，一行 [perf]（低频用户动作 ⇒ info；LOGGING §8）。
  const counted = countRemoteOps(remote);
  const phases: Array<{ phase: string; ms: number }> = [];
  const quickPushDeps = {
    remote: counted.remote, device: store, deviceId: opts.deviceId ?? mobileDeviceId(),
    onPhase: (phase: string, ms: number) => { if (ms >= 2000) console.warn("[v3][slow] push " + phase + " " + ms + "ms"); phases.push({ phase, ms }); },
  };
  const startedAt = Date.now();
  const log = (status: string, extra: Record<string, string | number> = {}): void => {
    rlog.perf("sync.push-single", Date.now() - startedAt, {
      id, status,
      req: remoteOpSummary(counted.stats),
      phases: phases.map((p) => p.phase + "=" + p.ms).join(","),
      ...extra,
    });
  };
  try {
    const result = await runQuickPush(quickPushDeps, id);
    const extra: Record<string, string | number> = result.status === "pushed"
      ? { uploaded: result.uploadedContent ? 1 : 0, assets: result.uploadedAssets, unchanged: result.unchanged ? 1 : 0 }
      : result.status === "full-sync" ? { reason: result.reason } : {};
    log(result.status, extra);
    return result;
  } catch (error) {
    log("failed", { error: error instanceof Error ? error.message : String(error) });
    // 只有真实 remote 才失效缓存；测试注入的 remote 无缓存可失效。
    if (!opts.remote) invalidateMobileS3v3RemoteCache();
    throw error;
  }
}
/** 云清理结果 + 本轮可清理对象的总体积（引擎只回 key；字节在 list 回包里顺带收集，零额外请求）。 */
export interface MobileDeepCleanupResult extends S3v3DeepCleanupResult {
  /** 可清理对象总字节；任一条拿不到 size 时为 null（绝不瞎猜）。 */
  bytes: number | null;
}

/**
 * 包一层 remote，把 deepCleanup 内部 list 回包里的对象体积留下来。
 * 为什么不在 bridge 再 list 一遍：deepCleanup 本身已按 7 个前缀全量 list，重复列一遍等于把
 * 大库（2 万文档/20 万附件）的请求数翻倍；这里只是转发 + 记 Map，零额外网络。
 * deepCleanup 只用 get/list/deleteMany（readPointer/getDeclaration 走 get），可选流式方法无需转发。
 */
function withObjectSizes(remote: S3v3Remote): {
  remote: S3v3Remote;
  bytesOf: (keys: readonly string[]) => number | null;
} {
  const sizes = new Map<string, number>();
  const tracked: S3v3Remote = {
    get: (key) => remote.get(key),
    put: (key, bytes, putOpts) => remote.put(key, bytes, putOpts),
    list: async (prefix) => {
      const items = await remote.list(prefix);
      for (const item of items) sizes.set(item.key, item.size);
      return items;
    },
    deleteMany: (keys) => remote.deleteMany(keys),
    deleteByPrefix: (prefix) => remote.deleteByPrefix(prefix),
  };
  return {
    remote: tracked,
    bytesOf: (keys) => {
      let total = 0;
      for (const key of keys) {
        const size = sizes.get(key);
        if (size === undefined) return null;
        total += size;
      }
      return total;
    },
  };
}

/**
 * 移动端云清理（v3 原生，parity：旧实现读 v3 永不写的 manifests/latest.json ⇒ 恒 0）：
 * pointer → 索引/声明算 keep 集 → 引擎 deepCleanup（保留窗口 + 本机历史引用保护）。
 * 与桌面 `runV3DeepCleanup` 同语义；删除明细由 bridge 写 s3_gc_log。
 *
 * `dryRun: true` = 只统计不删（引擎 dryRun 分支不调 deleteMany、不写 device state）；
 * 设置页「预览」走这条，数字与真删同源，避免预览和实删两套口径。
 */
export async function runMobileV3DeepCleanup(
  db: MobileDb,
  settings: S3v3Settings,
  opts: { dryRun?: boolean; retentionDays?: number; remote?: S3v3Remote; deviceId?: string } = {},
): Promise<MobileDeepCleanupResult> {
  const store = new MobileDeviceStore(db);
  await store.init();
  const { remote, bytesOf } = withObjectSizes(opts.remote ?? createMobileS3v3Remote(settings));
  const engine = new S3v3SyncEngine({ remote, device: store, deviceId: opts.deviceId ?? mobileDeviceId() });
  const extraKeep = await historyRepository.historyAssetRefs(db).catch(() => new Set<string>());
  const result = await engine.deepCleanup({
    dryRun: opts.dryRun,
    extraKeep,
    retentionDays: opts.retentionDays ?? MOBILE_GC_RETENTION_DAYS,
  });
  return { ...result, bytes: bytesOf(result.deleted) };
}
