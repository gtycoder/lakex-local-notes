/**
 * 移动端同步策略的读写单一入口（261012）。
 *
 * 为什么不直接在 UI 里调 bridge：
 *   · 自动同步定时器（useAutoSync）和设置页都要**同一份**当前值，且设置页改完要立刻重挂定时器；
 *   · 这里把 bridge.getSyncSettings / saveSyncSettings 包一层 + 一个极小订阅（与 toastBus 同款做法），
 *     避免在组件之间传状态，也避免"改了设置但定时器没更新"这类串台。
 */
import type { SyncSettings } from "../../lib/types";
import { bridge } from "../bridge";

type Listener = () => void;
const listeners = new Set<Listener>();

export function readSyncSettings(): SyncSettings {
  return bridge.getSyncSettings();
}

/** 写策略（唯一写入口）：落库后通知订阅者重新读取。 */
export function writeSyncSettings(next: SyncSettings): void {
  bridge.saveSyncSettings(next);
  listeners.forEach((l) => l());
}

export function subscribeSyncSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
