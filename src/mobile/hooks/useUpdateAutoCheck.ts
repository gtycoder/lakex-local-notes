/**
 * 更新中心自动检查触发器（启动就绪后一次 + 回前台按 24h 节流）。
 *
 * 与 useAutoSync 同款"就绪信号 + 首个空闲"策略：冷启动页面优先，网络检查不跟首屏抢主线程；
 * 是否真的检查由 updatePolicy.shouldAutoCheck 判定（设置里可关闭/改间隔）。
 * 回前台同时恢复「下载中 / 已下载待安装」状态（原生按 downloadId 查询）。
 */
import { useEffect } from "react";
import { restoreDownloadedUpdate, runScheduledUpdateCheck } from "../update/updateCenterStore";

export function useUpdateAutoCheck(ready = true): void {
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let removeAppListener: (() => void) | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const fire = (): void => {
      if (disposed) return;
      void restoreDownloadedUpdate();
      void runScheduledUpdateCheck();
    };

    // 启动：排到首个空闲（最多 2s 兜底），避免与首屏渲染/首批交互抢主线程。
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") {
      idleHandle = ric(fire, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(fire, 1200);
    }

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) fire();
        });
        removeAppListener = () => {
          void handle.remove();
        };
      } catch {
        /* Web 预览 / vitest：没有 Capacitor 监听，只保留冷启动那次 */
      }
    })();

    return () => {
      disposed = true;
      if (idleHandle !== null) {
        (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      removeAppListener?.();
    };
  }, [ready]);
}
