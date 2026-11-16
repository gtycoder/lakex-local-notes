/**
 * 更新中心的设置与运行态（**设备本地** localStorage；不进 S3、不写正文）。
 *
 * 口径（docs/UPDATE-CENTER.md §4）：autoCheck / checkIntervalHours / autoDownload /
 * autoDownloadWifiOnly / ignoredVersion 五项，两端同口径；这里只管**取值、归一化与落盘**，
 * 判据（节流、忽略版本、选包、自动下载闸门）在 updatePolicy.ts。
 *
 * 本模块不得 import node:*、不得 import ui（纯数据层，方便单测）。
 */
export const UPDATE_SETTINGS_STORAGE_KEY = "lakex-local-notes-mobile.update.settings";
export const UPDATE_STATE_STORAGE_KEY = "lakex-local-notes-mobile.update.state";

export interface UpdateSettings {
  /** 启动检查 + 定时检查（默认开）。 */
  autoCheck: boolean;
  /** 检查间隔（小时）：24 / 168 / 720（24 小时 / 每周 / 每月）；0 = 历史「关闭」值（只读兼容）。 */
  checkIntervalHours: number;
  /** 发现新版本即后台下载（默认开；仅 Android 自动下载）。 */
  autoDownload: boolean;
  /** 仅 Wi-Fi 自动下载（默认开；仅 Android 生效）。 */
  autoDownloadWifiOnly: boolean;
  /** 「忽略此版本」记录；下个版本号变化后自然失效。 */
  ignoredVersion: string;
}

export const UPDATE_SETTINGS_DEFAULTS: UpdateSettings = {
  autoCheck: true,
  checkIntervalHours: 24,
  autoDownload: true,
  autoDownloadWifiOnly: true,
  ignoredVersion: "",
};

/**
 * 允许的检查间隔（小时）——**下拉只给这三档**（261116 用户点单，与桌面同口径）：
 * 24 = 24 小时 / 168 = 每周 / 720 = 每月（30 天）。
 * 「关闭」由「自动检查」开关承担，不再是下拉项；历史库里存过 0 的仍按「关闭」读取（兼容），
 * 历史 6 / 12 小时在读取时**收敛到 24**（见 normalizeCheckIntervalHours）。
 */
export const UPDATE_CHECK_INTERVAL_OPTIONS = [24, 168, 720] as const;

/** 运行态（同样只存设备本地）。 */
export interface UpdateRuntimeState {
  /** 上次自动检查时刻（ms）；0 = 从未检查。 */
  lastCheckAt: number;
  /** 已弹过更新窗口的版本（每个版本最多自动弹一次）。 */
  promptedVersion: string;
  /** 已下载待安装的版本 / 路径 / sha256（App 重启后恢复「已下载未安装」）。 */
  downloadedVersion: string;
  downloadedPath: string;
  downloadedSha256: string;
}

export const UPDATE_STATE_DEFAULTS: UpdateRuntimeState = {
  lastCheckAt: 0,
  promptedVersion: "",
  downloadedVersion: "",
  downloadedPath: "",
  downloadedSha256: "",
};

function isAllowedInterval(value: unknown): value is number {
  return typeof value === "number" && (UPDATE_CHECK_INTERVAL_OPTIONS as readonly number[]).includes(value);
}

/** 归一：0（历史「关闭」）保留；24/168/720 原样；旧 6/12 小时与其它非法值一律收敛到默认 24。 */
function normalizeCheckIntervalHours(value: unknown): number {
  if (value === 0) return 0;
  return isAllowedInterval(value) ? value : UPDATE_SETTINGS_DEFAULTS.checkIntervalHours;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 归一化设置：任何字段缺失/非法都回落到默认值（不做抛错，坏存档自愈）。 */
export function normalizeUpdateSettings(raw: unknown): UpdateSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    autoCheck: typeof value.autoCheck === "boolean" ? value.autoCheck : UPDATE_SETTINGS_DEFAULTS.autoCheck,
    checkIntervalHours: normalizeCheckIntervalHours(value.checkIntervalHours),
    autoDownload: typeof value.autoDownload === "boolean" ? value.autoDownload : UPDATE_SETTINGS_DEFAULTS.autoDownload,
    autoDownloadWifiOnly:
      typeof value.autoDownloadWifiOnly === "boolean"
        ? value.autoDownloadWifiOnly
        : UPDATE_SETTINGS_DEFAULTS.autoDownloadWifiOnly,
    ignoredVersion: text(value.ignoredVersion),
  };
}

/** 归一化运行态：非法值回落（lastCheckAt 必须是非负有限数）。 */
export function normalizeUpdateState(raw: unknown): UpdateRuntimeState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lastCheckAt =
    typeof value.lastCheckAt === "number" && Number.isFinite(value.lastCheckAt) && value.lastCheckAt > 0
      ? value.lastCheckAt
      : UPDATE_STATE_DEFAULTS.lastCheckAt;
  return {
    lastCheckAt,
    promptedVersion: text(value.promptedVersion),
    downloadedVersion: text(value.downloadedVersion),
    downloadedPath: text(value.downloadedPath),
    downloadedSha256: text(value.downloadedSha256).toLowerCase(),
  };
}

export function parseUpdateSettingsText(raw: string | null): UpdateSettings {
  if (!raw) return { ...UPDATE_SETTINGS_DEFAULTS };
  try {
    return normalizeUpdateSettings(JSON.parse(raw));
  } catch {
    return { ...UPDATE_SETTINGS_DEFAULTS };
  }
}

export function parseUpdateStateText(raw: string | null): UpdateRuntimeState {
  if (!raw) return { ...UPDATE_STATE_DEFAULTS };
  try {
    return normalizeUpdateState(JSON.parse(raw));
  } catch {
    return { ...UPDATE_STATE_DEFAULTS };
  }
}

/** 局部更新设置（与当前值合并后再归一化）；ignoredVersion 可传空串清除。 */
export function patchUpdateSettings(current: UpdateSettings, patch: Partial<UpdateSettings>): UpdateSettings {
  return normalizeUpdateSettings({ ...current, ...patch });
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadUpdateSettings(store: Storage | null = storage()): UpdateSettings {
  try {
    return parseUpdateSettingsText(store?.getItem(UPDATE_SETTINGS_STORAGE_KEY) ?? null);
  } catch {
    return { ...UPDATE_SETTINGS_DEFAULTS };
  }
}

export function saveUpdateSettings(next: UpdateSettings, store: Storage | null = storage()): void {
  try {
    store?.setItem(UPDATE_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeUpdateSettings(next)));
  } catch {
    /* 存储不可用：本次会话按内存值继续（与 AI 开关同口径，不阻断） */
  }
}

export function loadUpdateRuntimeState(store: Storage | null = storage()): UpdateRuntimeState {
  try {
    return parseUpdateStateText(store?.getItem(UPDATE_STATE_STORAGE_KEY) ?? null);
  } catch {
    return { ...UPDATE_STATE_DEFAULTS };
  }
}

export function saveUpdateRuntimeState(next: UpdateRuntimeState, store: Storage | null = storage()): void {
  try {
    store?.setItem(UPDATE_STATE_STORAGE_KEY, JSON.stringify(normalizeUpdateState(next)));
  } catch {
    /* 同上：只影响「上次检查/已下载」记忆，不影响更新本身 */
  }
}
