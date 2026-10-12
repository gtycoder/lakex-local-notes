/**
 * 移动端自动同步（261012）：把桌面那套 autoMode 语义在移动端落地。
 *
 * 对应关系（判据在 src/core/syncModes.ts，纯函数、有单测）：
 *   · interval    → 起一个 setInterval，每 autoIntervalMinutes 分钟触发一次 bridge.syncNow()；
 *   · onOpenClose → 冷启动就绪 + **回到前台**各补一次（Android 上"退出前同步"不可靠：进程可能被直接杀，
 *                   所以移动端不假装能"关闭时同步"——语义按"打开/回前台"实现，注释与文档都写清楚）；
 *   · manual      → 什么都不做。
 * 出网与否不在这里判：bridge.syncNow 自己挂 canTouchNetwork(cloudStateOf(...))（AGENTS §3#20），
 * 也自带维护域串行与凭据校验 ⇒ 定时器只管"到点触发"，失败由它的返回值/日志暴露。
 * 设置页写策略走 writeSyncSettings（同一入口），订阅后自动重挂定时器 —— 不会出现"改了模式还在跑旧定时器"。
 */
import { useEffect } from "react";
import { autoSyncIntervalMs, shouldSyncOnForeground } from "../core/syncModes";
import { bridge } from "./bridge";
import { readSyncSettings, subscribeSyncSettings } from "./syncSettingsStore";
import { reportNativeActionError } from "../lib/nativeErrors";

export function useAutoSync(): void {
  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;

    const runOnce = (reason: string) => {
      void bridge.syncNow().catch((error) => reportNativeActionError(reason, error));
    };

    const arm = () => {
      if (disposed) return;
      if (timer != null) { window.clearInterval(timer); timer = null; }
      let settings: ReturnType<typeof readSyncSettings> | null = null;
      try { settings = readSyncSettings(); } catch { settings = null; }
      const ms = autoSyncIntervalMs(settings);
      if (ms != null) timer = window.setInterval(() => runOnce("自动同步"), ms);
    };

    // onOpenClose：启动就绪后一次（与桌面 electron/main.ts:573「应用就绪时对齐一次」对齐）
    let foregroundHandler: (() => void) | null = null;
    const armForeground = () => {
      foregroundHandler = () => {
        let settings: ReturnType<typeof readSyncSettings> | null = null;
        try { settings = readSyncSettings(); } catch { settings = null; }
        if (shouldSyncOnForeground(settings)) runOnce("回到前台同步");
      };
    };

    arm();
    armForeground();
    // 冷启动首次：等桥/引擎就绪后再判断（避免在 booting 阶段白跑）
    window.setTimeout(() => { if (!disposed && foregroundHandler) foregroundHandler(); }, 3000);

    const unsubscribe = subscribeSyncSettings(arm);
    let removeAppListener: (() => void) | null = null;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive && foregroundHandler) foregroundHandler();
        });
        removeAppListener = () => { void handle.remove(); };
      } catch { /* Web 预览/测试环境没有 Capacitor：只保留冷启动那次 */ }
    })();

    return () => {
      disposed = true;
      if (timer != null) window.clearInterval(timer);
      unsubscribe();
      if (removeAppListener) removeAppListener();
    };
  }, []);
}
