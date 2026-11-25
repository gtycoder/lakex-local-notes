/**
 * 开/关应用同步一次（C-04 从 main.ts R 原样搬出）：开启应用时对齐一次 + 断点续传优先。
 * 判据单一来源：能不能出网 = core/cloudState（没配置/关闭云同步 ⇒ 不出网）；该不该在开/关补一次 =
 * core/syncModes.shouldSyncOnOpenClose（enabled 且 autoMode ≠ manual）；续传不受 autoMode 限制
 *（用户点过同步，退出再进必须接着下）。安全模式不自动同步、也不续传（网络动作）。
 * 边界：只做启动这一次；退出前那次 = main.ts before-quit（顺序敏感，留入口）；定时器 = boot/timerWiring。
 */
import { canTouchNetwork, cloudStateOf } from "../../src/core/cloudState.js";
import { shouldSyncOnOpenClose } from "../../src/core/syncModes.js";
import { formatLogFields } from "../../src/core/logFormat.js";
import type { Store } from "../store.js";
import type { SyncProgress, SyncResult } from "../syncTypes.js";
import { log } from "../logger.js";

export interface SyncOnOpenDeps {
  store: Store;
  runFullSync: () => Promise<SyncResult>;
  broadcastSyncProgress: (p: SyncProgress) => void;
  classifySyncError: (error: unknown) => { code: string; className: "retryable" | "action-required" | "fatal" };
  isSafeModeActive: () => boolean;
  /** 小记库降级 ⇒ 不自动同步（与 boot/timerWiring 同一判据，whenReady 算一次传入）。 */
  autoSyncAllowed: boolean;
}

export function syncOnAppOpen(deps: SyncOnOpenDeps): void {
  // 开启应用时对齐一次（261013：interval 也含在内；manual 不补）+ 断点续传（261026）。
  // 续传优先级最高：上次同步没跑完（进程被杀/崩溃/断网）⇒ 启动就续上，**不受 autoMode 影响**
  // （manual 也一样——用户点过同步，退出再进来必须接着下，而不是等他自己再点一次）。
  const syncCfgOpen = deps.store.getSyncSettings();
  const interruptedAt = deps.store.syncState.getSyncInterruptedAt();
  // 两条判据都走单一来源：能不能出网 = core/cloudState（没配置 或 关闭云同步 ⇒ 不出网）；
  // 该不该在开/关时补一次 = core/syncModes 的 shouldSyncOnOpenClose（enabled 且 autoMode ≠ "manual"）。
  // Batch3-B：安全模式不自动同步，也不续传上次未完成的同步（那是网络动作；手动同步仍可用）。
  if (!deps.isSafeModeActive() && deps.autoSyncAllowed && canTouchNetwork(cloudStateOf(!!deps.store.getS3Settings(), syncCfgOpen)) && (interruptedAt !== null || shouldSyncOnOpenClose(syncCfgOpen))) {
    if (interruptedAt !== null) log.app.info("[sync] 上次同步未完成（" + interruptedAt + "），启动自动续传" + formatLogFields({ backend: "v3" }));
    void deps.runFullSync().catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("[sync] 开启同步失败:", msg);
      const info = deps.classifySyncError(error);
      deps.broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg, errorCode: info.code, errorClass: info.className });
    });
  }
}
