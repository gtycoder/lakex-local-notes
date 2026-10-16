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

export interface MobileSyncStatus {
  /** 本次尝试的时间（ISO）。 */
  at: string;
  ok: boolean;
  /** 成功 = 引擎返回的摘要；失败 = 失败原因（短句，已在 UI 上展示给用户看）。 */
  message: string;
}

const KEY = "lake-notes-mobile.lastSync";
const listeners = new Set<() => void>();

function parse(raw: string | null): MobileSyncStatus | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MobileSyncStatus>;
    if (!value || typeof value.at !== "string" || typeof value.ok !== "boolean" || typeof value.message !== "string") return null;
    return { at: value.at, ok: value.ok, message: value.message };
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

export function writeSyncStatus(next: MobileSyncStatus): void {
  current = next;
  writeLocalStorage(KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 设置页那一行的文案：本机时区的 HH:MM（不是今天就带日期）+ 结果 + 原因。 */
export function describeSyncStatus(status: MobileSyncStatus): string {
  const at = new Date(status.at);
  const valid = !Number.isNaN(at.getTime());
  const now = new Date();
  const sameDay = valid && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  const time = valid
    ? (sameDay ? "" : `${at.getMonth() + 1}月${at.getDate()}日 `) + `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    : status.at;
  if (status.ok) return `${time} · 同步成功${status.message ? `（${status.message}）` : ""}`;
  return `${time} · 同步失败：${status.message}`;
}
