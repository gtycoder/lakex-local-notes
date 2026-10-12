/**
 * 同步策略的**选项与判据单一来源**（261012）。
 *
 * 背景：桌面 SettingsPanel 里「自动同步模式」的三个选项是内联字面量，移动端当时连 UI 都没有
 * ⇒ 两端语义容易漂。这里把「选项清单 + 定时/前台判定」上收到 core（纯函数、零平台依赖），
 * 桌面与移动端都从这里取；颜色数据/命令字典同理（见 MOBILE-TECH-STACK §一「只共享必要逻辑」）。
 *
 * 语义与桌面 electron/main.ts 对齐：
 *   · manual        —— 完全手动：不定时、不在前台补同步；
 *   · interval      —— 按固定间隔：每隔 autoIntervalMinutes 分钟触发一次同步（桌面 setInterval 同口径）；
 *   · onOpenClose   —— 仅在开启/关闭时：桌面是「应用就绪 + 退出前」各一次；移动端「关闭」不可靠
 *                      （Android 可能直接杀进程）⇒ 移动端等价实现为「冷启动就绪 + 回到前台」各一次。
 * 出网判据不在这里 —— 统一走 core 的 canTouchNetwork(cloudStateOf(...))（AGENTS §3#20），
 * 定时器只负责「到点触发」，能不能出网由引擎侧判。
 */
import type { SyncSettings } from "../lib/types.js";

export interface SyncAutoModeOption {
  value: SyncSettings["autoMode"];
  label: string;
}

/** 「自动同步模式」选项（桌面/移动端共用同一份文案与顺序）。 */
export const SYNC_AUTO_MODE_OPTIONS: SyncAutoModeOption[] = [
  { value: "manual", label: "完全手动" },
  { value: "interval", label: "按固定间隔自动同步" },
  { value: "onOpenClose", label: "仅在开启/关闭时同步" },
];

/** 间隔预设（分钟）：移动端用底部 Sheet 选档，桌面仍是 1–1440 的自由输入。 */
export const SYNC_INTERVAL_PRESETS = [5, 15, 30, 60, 120, 360];

/** 间隔候选 = 预设 ∪ 当前值（保证桌面设过的非预设值不会被移动端界面"改掉"），升序去重。 */
export function syncIntervalOptions(current: number): number[] {
  const set = new Set<number>(SYNC_INTERVAL_PRESETS);
  if (Number.isFinite(current) && current >= 1) set.add(Math.floor(current));
  return [...set].sort((a, b) => a - b);
}

/**
 * 定时同步的周期（毫秒）；**null = 不该起定时器**。
 * 判据：开关打开 + autoMode === "interval" + 间隔 ≥1（与桌面 electron/main.ts:558 一致）。
 */
export function autoSyncIntervalMs(
  settings: Pick<SyncSettings, "enabled" | "autoMode" | "autoIntervalMinutes"> | null | undefined
): number | null {
  if (!settings || !settings.enabled) return null;
  if (settings.autoMode !== "interval") return null;
  const minutes = Math.floor(settings.autoIntervalMinutes);
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  return minutes * 60 * 1000;
}

/**
 * 回到前台/冷启动就绪时该不该补一次同步。
 * 判据：开关打开 + autoMode === "onOpenClose"（对应桌面的「应用就绪时对齐一次 + 退出前一次」）。
 */
export function shouldSyncOnForeground(
  settings: Pick<SyncSettings, "enabled" | "autoMode"> | null | undefined
): boolean {
  if (!settings || !settings.enabled) return false;
  return settings.autoMode === "onOpenClose";
}
