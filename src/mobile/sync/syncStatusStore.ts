/**
 * 移动端「上次同步」状态（设备本地、不参与同步）—— 用户 261013 定稿：**同步可观测性**。
 *
 * 解决的真问题：自动同步（冷启动 / 回前台 / 进后台 / 定时）失败时只走 `console.warn`（`reportNativeActionError`），
 * **用户在界面上完全看不到**；出问题时无从自查。这里把"上次尝试"落盘 + 常驻显示在设置页。
 *
 * 为什么单独一个 store：`src/lib/settings.ts` 是**两端共用**的设置模型，不该塞移动端专属状态；
 * 写法对齐既有的 `syncSettingsStore`（模块级状态 + 极小订阅 + 落 localStorage）。
 *
 * **写入点唯一**：`bridge.syncNow()`。离线/未配置这种"根本没尝试"**不写**（避免用没发生的事污染状态行）。
 * 读取点：设置页「连接与同步」区块的那一行。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { formatBytesCompact } from "../../lib/formatBytes";
import { formatDateTime } from "../../core/dateFormat";
import { SYNC_WARNING_COPY, syncWarningSummary, type SyncWarningSummary } from "../../core/syncWarningText";
import type { SyncWarning, SyncWarningKind } from "../../core/sharedTypes";

export interface MobileSyncStatus {
  /** 本次尝试的时间（ISO）。 */
  at: string;
  ok: boolean;
  /** 成功 = 引擎返回的摘要；失败 = 失败原因（短句，已在 UI 上展示给用户看）。 */
  message: string;
  /** 261028：上传/下载细分（文档/目录/小记/字节），设置页一行展示；失败或旧记录可缺省。 */
  durationMs?: number;
  uploadedDocuments?: number;
  downloadedDocuments?: number;
  uploadedQuickNotes?: number;
  downloadedQuickNotes?: number;
  uploadedFolders?: number;
  downloadedFolders?: number;
  uploadedBytes?: number;
  downloadedBytes?: number;
  /**
   * task-67：最近一轮的「跳过项」摘要（重启不丢）。**只留前 20 条**（防止 localStorage 膨胀）；
   * 总数/分组计数另存 `warningSummary`（按完整列表算），保证摘要行不因截断而撒谎。
   */
  warnings?: SyncWarning[];
  warningSummary?: SyncWarningSummary;
}

/** 落盘上限：设置页只做「看一眼 + 去恢复」，20 条足够定位；其余按总数展示。 */
export const MAX_PERSISTED_SYNC_WARNINGS = 20;
/** 单条 message 的上限（core 的 detail 可能带长错误串；落盘只需能定位）。 */
const MAX_WARNING_MESSAGE_CHARS = 200;

/** 只保留 SyncWarning 的字段 + 已知 kind（localStorage 被改坏也不让设置页崩在 copy 查询上）。 */
function trimWarning(raw: unknown): SyncWarning | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (!(kind in SYNC_WARNING_COPY)) return null;
  const str = (candidate: unknown): string | undefined => (typeof candidate === "string" && candidate ? candidate : undefined);
  const cut = (candidate: unknown, limit: number): string | undefined => {
    const text = str(candidate);
    return text ? text.slice(0, limit) : undefined;
  };
  const warning: SyncWarning = { kind: kind as SyncWarningKind, message: cut(value.message, MAX_WARNING_MESSAGE_CHARS) ?? "" };
  const noteId = str(value.noteId); if (noteId) warning.noteId = noteId;
  const title = cut(value.title, 80); if (title) warning.title = title;
  const filename = cut(value.filename, 120); if (filename) warning.filename = filename;
  return warning;
}

function trimWarnings(raw: unknown): SyncWarning[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(trimWarning).filter((warning): warning is SyncWarning => warning !== null).slice(0, MAX_PERSISTED_SYNC_WARNINGS);
}

function parseWarningSummary(raw: unknown): SyncWarningSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const count = (candidate: unknown): number | null => (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : null);
  const total = count(value.total), needsAction = count(value.needsAction), retryable = count(value.retryable);
  if (total === null || needsAction === null || retryable === null) return undefined;
  return { total, needsAction, retryable };
}

const KEY = "lakex-local-notes-mobile.lastSync";
const listeners = new Set<() => void>();

function parse(raw: string | null): MobileSyncStatus | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MobileSyncStatus>;
    if (!value || typeof value.at !== "string" || typeof value.ok !== "boolean" || typeof value.message !== "string") return null;
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const warnings = trimWarnings(value.warnings);
    const warningSummary = parseWarningSummary(value.warningSummary)
      ?? (warnings && warnings.length > 0 ? syncWarningSummary(warnings) : undefined);
    return {
      at: value.at, ok: value.ok, message: value.message,
      durationMs: num(value.durationMs),
      uploadedDocuments: num(value.uploadedDocuments), downloadedDocuments: num(value.downloadedDocuments),
      uploadedQuickNotes: num(value.uploadedQuickNotes), downloadedQuickNotes: num(value.downloadedQuickNotes),
      uploadedFolders: num(value.uploadedFolders), downloadedFolders: num(value.downloadedFolders),
      uploadedBytes: num(value.uploadedBytes), downloadedBytes: num(value.downloadedBytes),
      ...(warnings ? { warnings } : {}),
      ...(warningSummary ? { warningSummary } : {}),
    };
  } catch {
    return null;
  }
}

let current: MobileSyncStatus | null = (() => {
  try { return parse(localStorage.getItem(KEY)); } catch { return null; }
})();

export function readSyncStatus(): MobileSyncStatus | null {
  return current;
}

/**
 * 写入「上次同步」。若调用方带了 warnings（完整列表），这里统一**精简 + 截断到 20 条**再落盘，
 * 并用完整列表算好总数/分组计数（`warningSummary`）——设置页重启后仍能如实显示「N 项被跳过」。
 */
export function writeSyncStatus(next: MobileSyncStatus): void {
  current = normalizeStatus(next);
  writeLocalStorage(KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
}

function normalizeStatus(status: MobileSyncStatus): MobileSyncStatus {
  if (!status.warnings) {
    if (status.warningSummary === undefined) return status;
    const copy: MobileSyncStatus = { ...status };
    delete copy.warningSummary;
    return copy;
  }
  const full = status.warnings;
  return {
    ...status,
    warnings: full.map(trimWarning).filter((warning): warning is SyncWarning => warning !== null).slice(0, MAX_PERSISTED_SYNC_WARNINGS),
    warningSummary: syncWarningSummary(full),
  };
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 设置页那一行的文案：本机时区的 HH:MM（不是今天就带日期）+ 结果 + 原因。 */
export function describeSyncStatus(status: MobileSyncStatus): string {
  const at = new Date(status.at);
  const valid = !Number.isNaN(at.getTime());
  // 261017（Q10/B）：状态行属「细节时间」⇒ 固定绝对口径，不再用「10月16日」这种局部格式。
  const time = valid ? formatDateTime(at) : status.at;
  if (status.ok) return `${time}，同步成功${status.message ? `（${status.message}）` : ""}`;
  return `${time}，同步失败：${status.message}`;
}

/** 261028：上传/下载细分一行（文档/目录/小记/字节；旧记录没有细分时返回 null）。 */
export function describeSyncBreakdown(status: MobileSyncStatus): string | null {
  if (status.uploadedDocuments == null && status.downloadedDocuments == null) return null;
  const up = `上传 ${status.uploadedDocuments ?? 0}/${status.uploadedFolders ?? 0}/${status.uploadedQuickNotes ?? 0}，${formatBytesCompact(status.uploadedBytes ?? 0)}`;
  const down = `下载 ${status.downloadedDocuments ?? 0}/${status.downloadedFolders ?? 0}/${status.downloadedQuickNotes ?? 0}，${formatBytesCompact(status.downloadedBytes ?? 0)}`;
  return `${up}；${down}（文档/目录/小记）`;
}
