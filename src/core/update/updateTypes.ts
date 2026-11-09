/**
 * 更新中心：设备本地设置 + 主进程/渲染层共享状态（两端共用的纯逻辑）。
 *
 * 口径见 docs/UPDATE-CENTER.md §4/§5；本文件不得 import node:* 或 electron
 * （renderer 与 main 两侧共用，且要能在 vitest 里直接跑）。
 */
import type { UpdateAsset, UpdateManifest } from "./updateManifest.js";

/** 自动检查频率（小时）：0 = 关闭（启动时也不再查）。 */
export const UPDATE_CHECK_INTERVAL_OPTIONS = [0, 6, 12, 24] as const;
export type UpdateCheckIntervalHours = (typeof UPDATE_CHECK_INTERVAL_OPTIONS)[number];

export interface UpdateSettings {
  /** 启动检查 + 定时检查；默认开。 */
  autoCheck: boolean;
  /** 6/12/24 小时；0 = 关闭。默认 24。 */
  checkIntervalHours: UpdateCheckIntervalHours;
  /** 发现新版本即后台下载；默认开。 */
  autoDownload: boolean;
  /** 「忽略此版本」记录的版本号；空串 = 未忽略。下个版本自动恢复提示。 */
  ignoredVersion: string;
}

export const UPDATE_SETTINGS_DEFAULTS: UpdateSettings = {
  autoCheck: true,
  checkIntervalHours: 24,
  autoDownload: true,
  ignoredVersion: "",
};

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateDownloadProgress {
  received: number;
  total: number;
}

/** 主进程 UpdateService 的状态快照（IPC update_get_state / update-state 事件同形）。 */
export interface UpdateState {
  status: UpdateStatus;
  /** 当前应用版本（package.json / app.getVersion()）。 */
  currentVersion: string;
  /** 上次检查尝试时间（ISO；失败也记）。 */
  lastCheckAt: string | null;
  /** 上一次检查是否由自动调度发起（渲染层据此决定「每版本最多弹一次」）。 */
  lastCheckWasAuto: boolean;
  /** 最近一次失败的可读原因（成功后清空）。 */
  lastError: string | null;
  /** 检测到的新版本；无 = null。 */
  manifest: UpdateManifest | null;
  /** 当前平台/架构选中的安装包；无 = null。 */
  asset: UpdateAsset | null;
  /** 当前检测版本是否已被用户忽略（不弹窗、不自动下载）。 */
  ignored: boolean;
  progress: UpdateDownloadProgress | null;
  /** 已下载完成的安装包绝对路径（重启后可恢复）。 */
  downloadedPath: string | null;
  settings: UpdateSettings;
}

/** 渲染层保存设置时只传要改的字段。 */
export interface UpdateSettingsPatch {
  autoCheck?: boolean;
  checkIntervalHours?: number;
  autoDownload?: boolean;
  ignoredVersion?: string;
}

function intervalOf(value: unknown): UpdateCheckIntervalHours {
  for (const option of UPDATE_CHECK_INTERVAL_OPTIONS) if (value === option) return option;
  return UPDATE_SETTINGS_DEFAULTS.checkIntervalHours;
}

/** 非法/缺省字段回默认值（坏 settings 行不阻断更新中心，与其它 settings key 同口径）。 */
export function normalizeUpdateSettings(raw: unknown): UpdateSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    autoCheck: typeof value.autoCheck === "boolean" ? value.autoCheck : UPDATE_SETTINGS_DEFAULTS.autoCheck,
    checkIntervalHours: intervalOf(value.checkIntervalHours),
    autoDownload: typeof value.autoDownload === "boolean" ? value.autoDownload : UPDATE_SETTINGS_DEFAULTS.autoDownload,
    ignoredVersion: typeof value.ignoredVersion === "string" ? value.ignoredVersion.trim() : UPDATE_SETTINGS_DEFAULTS.ignoredVersion,
  };
}

/** 合并补丁后归一化（0 是合法值，必须用 ?? 而不是 ||）。 */
export function applyUpdateSettingsPatch(current: UpdateSettings, patch: UpdateSettingsPatch): UpdateSettings {
  return normalizeUpdateSettings({
    autoCheck: patch.autoCheck ?? current.autoCheck,
    checkIntervalHours: patch.checkIntervalHours ?? current.checkIntervalHours,
    autoDownload: patch.autoDownload ?? current.autoDownload,
    ignoredVersion: patch.ignoredVersion ?? current.ignoredVersion,
  });
}
