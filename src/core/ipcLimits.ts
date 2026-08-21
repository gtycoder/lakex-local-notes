/**
 * IPC 入参统一边界（lake-core，V5 Phase 2）：
 * 常量与字节校验实现解耦——字节计数用标准 TextEncoder（不再依赖 node:buffer）。
 * 渲染层即便被 XSS/导航绕过，主进程也拒绝超大负载与异常长度的写入。全部纯函数，便于单元测试。
 */

/** 单篇笔记正文（Lake HTML）字节上限：防止异常大文档整片进内存/落盘。 */
export const MAX_NOTE_CONTENT_BYTES = 32 * 1024 * 1024;
/** 节点/笔记标题字符上限。 */
export const MAX_TITLE_LENGTH = 500;
/** 节点自定义图标（emoji 或短文本）长度上限。 */
export const MAX_ICON_LENGTH = 64;
/** 搜索结果条数上限（渲染层可传任意 limit，主进程统一封顶）。 */
export const MAX_SEARCH_RESULTS = 200;
/** 历史/同步等数字配置的宽松安全区间。 */
export const MAX_HISTORY_SNAPSHOTS = 10_000;
export const MAX_HISTORY_RETENTION_DAYS = 3650;
export const MAX_INTERVAL_HOURS = 720;
export const MAX_INTERVAL_MINUTES = 1440;

export interface HistorySettingsInput {
  maxSnapshots: number;
  retentionDays: number;
  cleanupIntervalHours: number;
  snapshotIntervalMinutes: number;
}

export class IpcInputError extends Error {
  readonly code = "INVALID_INPUT" as const;
  constructor(message: string) {
    super(message);
    this.name = "IpcInputError";
  }
}

/** UTF-8 字节计数（TextEncoder 为标准 API，不依赖 node:buffer）。 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** 校验并返回标题（必须是字符串、trim 后非空且不超长）。 */
export function assertTitle(value: unknown, label = "标题"): string {
  if (typeof value !== "string") throw new IpcInputError(`${label}格式无效`);
  const title = value.trim();
  if (!title) throw new IpcInputError(`${label}不能为空`);
  if (title.length > MAX_TITLE_LENGTH) {
    throw new IpcInputError(`${label}不能超过 ${MAX_TITLE_LENGTH} 字`);
  }
  return title;
}

/** 校验正文大小（按 UTF-8 字节计，避免 CJK 场景下字符数失真）。 */
export function assertContentBytes(value: unknown, maxBytes = MAX_NOTE_CONTENT_BYTES): string {
  if (typeof value !== "string") throw new IpcInputError("正文格式无效");
  if (utf8ByteLength(value) > maxBytes) {
    throw new IpcInputError(`正文不能超过 ${Math.round(maxBytes / 1024 / 1024)} MiB`);
  }
  return value;
}

/**
 * W-4：可选正文/缓存参数的校验（null/undefined 原样放行）。
 * 用于 update_note_caches / ensure_note_caches / create_history_snapshot——
 * 此前这三个通道绕过 assertContentBytes 直接接收任意大字符串。
 */
export function assertOptionalContentBytes(value: unknown, maxBytes = MAX_NOTE_CONTENT_BYTES): string | null {
  if (value === null || value === undefined) return null;
  return assertContentBytes(value, maxBytes);
}

/** 校验节点图标：null 或 ≤64 字符字符串。 */
export function assertIcon(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_ICON_LENGTH) {
    throw new IpcInputError(`图标不能超过 ${MAX_ICON_LENGTH} 字符`);
  }
  return value;
}

/** 搜索结果 limit 封顶：undefined → 默认 30；非法/负数 → 30；超限 → MAX_SEARCH_RESULTS。 */
export function clampSearchLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return 30;
  return Math.min(Math.floor(limit), MAX_SEARCH_RESULTS);
}

/** 把渲染层传来的历史配置收窄到安全区间（其余字段由 Store 读取侧兜底）。 */
export function clampHistorySettings(settings: unknown): HistorySettingsInput | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
  };
  return {
    maxSnapshots: clamp(s.maxSnapshots, 100, 1, MAX_HISTORY_SNAPSHOTS),
    retentionDays: clamp(s.retentionDays, 30, 1, MAX_HISTORY_RETENTION_DAYS),
    cleanupIntervalHours: clamp(s.cleanupIntervalHours, 24, 0, MAX_INTERVAL_HOURS),
    snapshotIntervalMinutes: clamp(s.snapshotIntervalMinutes, 15, 0, MAX_INTERVAL_MINUTES),
  };
}
