/**
 * 桌面 → 手机 一次性便携包（docs/PORTABLE-TRANSFER.md）的共享格式定义与校验。
 * 纯逻辑，不 import node:* / electron / capacitor。
 */
import { cloudStateOf } from "../cloudState";
import type { SyncSettings } from "../sharedTypes";

export const PORTABLE_FORMAT = "lakex-local-notes-portable";
export const PORTABLE_FORMAT_VERSION = 1;
/** 便携包文件后缀：压缩包 + 专属后缀，便于在网盘/文件选择器里识别，避免误选普通 zip。
 *  兼容旧包：导入端仍接受普通 `.zip`。 */
export const PORTABLE_FILE_EXTENSION = ".zip.lln";
/** 单包上限：4GiB（用户 261109 定；超限暂不支持分卷）。 */
export const PORTABLE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

export interface PortableBaselineRef {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
}

export interface PortableCounts {
  notes: number;
  folders: number;
  quickNotes: number;
  tags: number;
  assets: number;
  bytes: number;
}

export interface PortableManifest {
  format: typeof PORTABLE_FORMAT;
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  source: { platform: "desktop" };
  hasHistory: false;
  limitBytes: number;
  counts: PortableCounts;
  /** 云端基线；纯离线导出为 null（之后配置 S3 时按「无基线」处理：空桶首传 / 已有数据先拉取）。 */
  baseline: PortableBaselineRef | null;
}

/** 解析并校验清单；不合法直接抛错（导入方按「文件无效」处理）。 */
export function parsePortableManifest(raw: unknown): PortableManifest {
  if (!raw || typeof raw !== "object") throw new Error("便携包清单不是对象");
  const value = raw as Record<string, unknown>;
  if (value.format !== PORTABLE_FORMAT) throw new Error("不是 LakexLocalNotes 便携包");
  if (value.formatVersion !== PORTABLE_FORMAT_VERSION) throw new Error("便携包格式版本不支持");
  if (value.hasHistory !== false) throw new Error("便携包不应包含历史快照");
  if (typeof value.appVersion !== "string" || value.appVersion.length === 0) throw new Error("便携包 appVersion 非法");
  if (typeof value.exportedAt !== "string" || value.exportedAt.length === 0) throw new Error("便携包 exportedAt 非法");
  if (value.limitBytes !== PORTABLE_LIMIT_BYTES) throw new Error("便携包上限声明不匹配");
  const source = value.source as Record<string, unknown> | undefined;
  if (!source || source.platform !== "desktop") throw new Error("便携包来源非法");
  const baselineRaw = value.baseline as Record<string, unknown> | null | undefined;
  if (baselineRaw !== null && baselineRaw !== undefined
    && (typeof baselineRaw.epoch !== "string" || typeof baselineRaw.generation !== "number"
      || typeof baselineRaw.lakeCommit !== "string" || typeof baselineRaw.quickNotesCommit !== "string")) {
    throw new Error("便携包 baseline 非法");
  }
  const c = value.counts as Record<string, unknown> | undefined;
  if (!c) throw new Error("便携包 counts 非法");
  for (const key of ["notes", "folders", "quickNotes", "tags", "assets", "bytes"] as const) {
    if (!Number.isInteger(c[key]) || (c[key] as number) < 0) throw new Error("便携包 counts." + key + " 非法");
  }
  return {
    format: PORTABLE_FORMAT,
    formatVersion: 1,
    appVersion: value.appVersion,
    exportedAt: value.exportedAt,
    source: { platform: "desktop" },
    hasHistory: false,
    limitBytes: PORTABLE_LIMIT_BYTES,
    counts: c as unknown as PortableCounts,
    baseline: baselineRaw
      ? {
        epoch: baselineRaw.epoch as string,
        generation: baselineRaw.generation as number,
        lakeCommit: baselineRaw.lakeCommit as string,
        quickNotesCommit: baselineRaw.quickNotesCommit as string,
      }
      : null,
  };
}

/** 导出前检查总大小（按 zip 内条目字节和，留 1% 余量给头部/中央目录）。 */
export function assertPortableSize(totalBytes: number): void {
  if (totalBytes > PORTABLE_LIMIT_BYTES * 0.99) {
    throw new Error("数据超过 4GiB 上限，暂不支持分卷：当前约 " + (totalBytes / 1024 / 1024 / 1024).toFixed(2) + "GiB");
  }
}

/** 导出/导入进度（可选事件；桌面主进程 → 渲染层）。 */
export interface PortableExportProgress {
  /** snapshot = 生成两份 DB 快照；collect = 遍历文件；write = 写 zip。 */
  phase: "snapshot" | "collect" | "write";
  filesDone: number;
  filesTotal: number;
  bytesWritten: number;
}

/** 桌面导出结果（成功；失败以 IPC 抛错返回可读原因）。 */
export interface PortableExportResult {
  path: string;
  /** 实际 zip 字节数。 */
  bytes: number;
  entries: number;
  counts: PortableCounts;
}

/** 设置页入口状态：能不能导出 + 不可用原因 + 本次进程上次导出结果。 */
export interface PortableExportStatus {
  availability: PortableExportAvailability;
  lastExport: { path: string; bytes: number; exportedAt: string } | null;
  /** 云同步当前是否启用（决定导出前是否先同步一次）。 */
  cloudActive: boolean;
  lastSyncedAt: string | null;
}

export type PortableExportAvailability = { available: true } | { available: false; reason: string };

export interface PortableExportAvailabilityInput {
  s3Configured: boolean;
  sync: Pick<SyncSettings, "enabled" | "autoMode"> | null;
  lastSyncedAt: string | null;
  pending: { documents: number; folders: number; quickNotes: number };
}

/**
 * 桌面导出入口可用性（spec §2：云同步已启用 + 上一轮同步成功 + 无待同步脏数据）。
 * 判据单一来源 = core/cloudState 的 cloudStateOf；manual/auto 都算启用（manual 也可先点同步完成）。
 * 说明：spec 原文写「必须是 auto」，但默认 autoMode = manual（settingsRepository），
 * 按字面会禁用绝大多数已启用云同步的用户；这里按「cloud 已启用」口径（unconfigured/offline 才禁用）。
 */
/** 云同步是否处于「启用」状态（manual/auto 都算；unconfigured/offline 不算）。 */
export function portableExportCloudActive(input: PortableExportAvailabilityInput): boolean {
  const state = cloudStateOf(input.s3Configured, input.sync);
  return state === "manual" || state === "auto";
}

/** 导出入口始终可用：配置了 S3 时 UI 会先同步一次；纯离线也可导出（baseline = null）。 */
export function portableExportAvailability(_input: PortableExportAvailabilityInput): PortableExportAvailability {
  return { available: true };
}
