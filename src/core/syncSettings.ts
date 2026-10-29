/**
 * SyncSettings 归一的**单一来源**（CORE-14）。
 *
 * 背景：同一份残缺/旧版 `sync_settings` 曾有三处不同解析 —— 桌面 `settingsRepository.getSyncSettings`
 * （非法 autoMode 回落默认）、移动 `bridge/context.readSyncSettings`（enabled 缺省即 true、
 * interval 不校验 ≥1）、IPC `registerSync`（非法直接抛错）。同一份设置了在三端得到三种状态。
 *
 * 归一只有一套：autoMode 白名单回退 + autoIntervalMinutes ≥ 1（向下取整）+ deferAssets 缺省 false。
 * **默认值由调用方传**（fallback）：两端的「默认 enabled」来源不同（桌面 = 是否已配置 S3；
 * 移动 = 是否存过 S3），口径见 AGENTS §3#20；本函数只负责"非法/缺失字段怎么落回"。
 *
 * 纯函数：不读存储、不碰时钟；同一 (raw, fallback) 必得同一结果（跨端可复现）。
 */
import type { SyncSettings } from "./sharedTypes.js";

/** 合法自动同步模式（与 UI 选项同源语义；非法值一律回落 fallback）。 */
const AUTO_MODES: readonly SyncSettings["autoMode"][] = ["interval", "onOpenClose", "manual"];

/**
 * 归一存储里读出的 SyncSettings（raw 可以是任意 JSON，函数自己判型）。
 *
 * - `enabled`：只认 boolean，其余回落 fallback.enabled；
 * - `autoMode`：白名单外回落 fallback.autoMode；
 * - `autoIntervalMinutes`：非有限数 / < 1 / 非 number 回落 fallback；合法值向下取整（桌面原口径）；
 *   上限 1440 在写入侧（IPC clamp）管，读侧不静默改用户值；
 * - `deferAssets`：**只有显式 true 才开**；否则不写该键（缺省 = 全量语义，保持既有存储形态）。
 */
export function normalizeSyncSettings(raw: unknown, fallback: SyncSettings): SyncSettings {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<SyncSettings>;
  const autoMode = AUTO_MODES.includes(parsed.autoMode as SyncSettings["autoMode"])
    ? (parsed.autoMode as SyncSettings["autoMode"])
    : fallback.autoMode;
  const minutes = parsed.autoIntervalMinutes;
  const autoIntervalMinutes = typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 1
    ? Math.floor(minutes)
    : fallback.autoIntervalMinutes;
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : fallback.enabled,
    autoMode,
    autoIntervalMinutes,
    ...(parsed.deferAssets === true ? { deferAssets: true } : {}),
  };
}
