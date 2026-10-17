import { useCallback, useRef, useState } from "react";
import type { SyncToastData } from "../components/app/SyncToast";

/**
 * 同步反馈壳（V5 Phase 4）：同步 toast 状态 + 自动消失计时。
 * useSyncController 负责同步主循环；本 hook 只负责 toast 展示/隐藏。
 */
export function useSyncShell(onAutoHide?: () => void) {
  const [syncToast, setSyncToast] = useState<SyncToastData | null>(null);
  const syncToastTimer = useRef<number | null>(null);

  const showSyncToast = useCallback((data: SyncToastData) => {
    setSyncToast(data);
    if (syncToastTimer.current !== null) window.clearTimeout(syncToastTimer.current);
    // busy 常驻直到成功/失败/关闭；ok 4s / error 6s / 其他（unavailable 等）8s 自动消失
    if (data.kind !== "busy") {
      const ms = data.kind === "ok" ? 4000 : data.kind === "error" ? 6000 : 8000;
      syncToastTimer.current = window.setTimeout(() => {
        setSyncToast(null);
        syncToastTimer.current = null;
        onAutoHide?.();
      }, ms);
    }
  }, [onAutoHide]);

  return { syncToast, setSyncToast, showSyncToast };
}
