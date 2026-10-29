/**
 * 历史设置（每文档快照上限 / 保留天数 / 定时快照间隔 / 定期清理间隔）变更总线。
 *
 * 为什么需要它：历史设置落在 SQLite（不是 `localStorage` 的 AppSettings），
 * 也没有现成的 subscribeSettings。移动端「自动快照定时器」原先只在挂载时读一次
 * `getHistorySettings()` ⇒ 用户改完间隔要重启才生效（MOB-17）。
 * 保存成功后由设置页广播，订阅方（MobileApp 的定时快照）据此重挂定时器。
 *
 * 单一写入点仍是 `bridge.saveHistorySettings`；本模块只负责「保存成功」的通知，
 * 不做缓存、不读库，避免出现第二份设置真相。
 */
import type { HistoryMobileSettings } from "../data/historyRepository";

type Listener = (settings: HistoryMobileSettings) => void;

const listeners = new Set<Listener>();

/** 保存成功后广播最新设置（只在落盘成功后调用；失败的乐观回滚不广播）。 */
export function notifyHistorySettingsChanged(settings: HistoryMobileSettings): void {
  for (const listener of [...listeners]) {
    try {
      listener(settings);
    } catch {
      // 单个订阅方异常不能影响其它订阅方与设置保存流程。
    }
  }
}

/** 订阅历史设置变更；返回退订函数。 */
export function subscribeHistorySettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
