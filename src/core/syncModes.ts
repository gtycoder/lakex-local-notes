/**
 * 同步策略的**选项与判据单一来源**（261012 建；261013 扩「开/关应用」口径）。
 *
 * 背景：桌面 SettingsPanel 里「自动同步模式」的三个选项是内联字面量，移动端当时连 UI 都没有
 * ⇒ 两端语义容易漂。这里把「选项清单 + 定时/开合判定」上收到 core（纯函数、零平台依赖），
 * 桌面与移动端都从这里取；颜色数据/命令字典同理（见 MOBILE-TECH-STACK §一「只共享必要逻辑」）。
 *
 * 语义（261013 用户定稿；与桌面 electron/main.ts 对齐）：
 *   · manual      —— 完全手动：不定时、**开/关应用也不补同步**（唯一"不自动出网"的档）；
 *   · interval    —— 按固定间隔 **＋ 开/关应用各一次**：每隔 autoIntervalMinutes 分钟触发一次
 *                    （桌面 setInterval 同口径），并在应用开启与关闭时各对齐一次（261013 新增）；
 *   · onOpenClose —— **仅**在开启/关闭时：桌面是「应用就绪 + 退出前」各一次；移动端「关闭」不可靠
 *                    （Android 可能直接杀进程）⇒ 移动端等价实现为「冷启动就绪 + 回到前台」各一次。
 *   ⇒ 口径一句话：**只要云同步开着（autoMode ≠ "manual"），开/关应用都各同步一次**。
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

/**
 * 「开/关应用各同步一次」的行为说明（261013）—— 桌面 SettingsPanel 与移动 SettingsDrawer **共用同一份**
 * （与 cloudState.ts 的 CLOUD_PRIVACY_NOTICE 同一做法：文案存 core、无 UI 依赖，渲染用各端自己的原语）。
 * 移动端另补一句等价口径（Android 退出不可靠 ⇒ 以「回到前台」代替），见 SettingsDrawer。
 */
export const SYNC_OPEN_CLOSE_NOTE =
  "云同步开启时，打开应用与关闭应用都会各同步一次（「按固定间隔」也包含这一次对齐）；「完全手动」不自动出网，只有手动同步与恢复补拉才联网。";

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
 * 判据：开关打开 + autoMode === "interval" + 间隔 ≥1（与桌面 electron/main.ts 一致）。
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
 * 「开启/关闭应用」时该不该补一次同步。
 *   桌面 = 应用就绪（ready）+ 退出前（before-quit）；移动端 = 冷启动就绪 + 回到前台
 *   （Android 上"退出前同步"不可靠，见 src/mobile/hooks/useAutoSync.ts）。
 * 判据（261013 扩口径）：开关打开 + **autoMode ≠ "manual"** ⇒ interval 与 onOpenClose 两档都补；
 * 「完全手动」不补 —— 用户 261013 定：那一档保持不自动出网。
 */
export function shouldSyncOnOpenClose(
  settings: Pick<SyncSettings, "enabled" | "autoMode"> | null | undefined
): boolean {
  if (!settings || !settings.enabled) return false;
  return settings.autoMode !== "manual";
}
