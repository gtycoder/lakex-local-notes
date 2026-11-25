/**
 * 后台定时器装配（C-04 从 main.ts P+Q+S 原样搬出）：历史兜底快照/清理、自动同步（interval）、
 * 回收站自动过期 —— 三组定时器 + 配置变更后的重启闭包。
 * 边界：只装配定时器；同步执行 = runFullSync（main.ts，维护域串行队列的唯一持有者）；
 * 判据单一来源 = core/{historyFallbackPolicy,syncModes}（本文件不自造阈值）。
 * 纪律（S-5）：safeModeActive 等可变单例一律经 getter 读（定时器回调不得捕获值快照）；
 * 绝不新建第二条维护队列（护栏 maintenanceQueueScope.test.ts）。
 */
import { historyFallbackMinutes, shouldRunHistoryFallback } from "../../src/core/historyFallbackPolicy.js";
import { autoSyncIntervalMs } from "../../src/core/syncModes.js";
import type { Store } from "../store.js";
import type { SyncProgress, SyncResult } from "../syncTypes.js";
import { log } from "../logger.js";

export interface TimerWiringDeps {
  store: Store;
  runFullSync: () => Promise<SyncResult>;
  broadcastSyncProgress: (p: SyncProgress) => void;
  /** 同步失败分类广播（实现在 main.ts = readSyncErrorInfo；boot 层不 import s3v3）。 */
  classifySyncError: (error: unknown) => { code: string; className: "retryable" | "action-required" | "fatal" };
  /** 安全模式判定（getter：定时器重启时现取，不捕获快照）。 */
  isSafeModeActive: () => boolean;
  /** 小记库降级 ⇒ 不做自动同步：整轮同步已被 desktopSync 前置断言拦住，定时器只会反复刷失败；
   *  手动同步仍会当场给出可读错误（用户知道为什么 + 去哪恢复）。 */
  autoSyncAllowed: boolean;
}

export interface TimerRestarters {
  restartHistoryTimers: () => void;
  restartSyncTimers: () => void;
  restartGcTimers: () => void;
}

export function startTimerWiring(deps: TimerWiringDeps): TimerRestarters {
  // U1/Batch4-C：定时兜底快照（默认 10 分钟，0 = 关闭）+ 启动兜底清理（P5 低频巡检）
  // 启动兜底：清理一次过期快照（惰性清理在创建快照后也会触发，这里是兜底）
  try {
    const r = deps.store.cleanupHistory();
    deps.store.syncState.recordHistoryCleanup(r);
    if (r.deletedSnapshots > 0) log.history.info(`[history] 启动兜底清理：删除 ${r.deletedSnapshots} 份过期快照`);
  } catch (error) { console.warn("[history] 启动兜底清理失败:", error); }
  // 定时器管理：配置变更（设置面板保存）后重启定时器
  let snapshotTimer: NodeJS.Timeout | null = null;
  let cleanupTimer: NodeJS.Timeout | null = null;
  /** Batch4-C：兜底快照单飞（上一轮还没跑完就跳过本轮；绝不会叠跑/重入）。 */
  let historyFallbackRunning = false;
  const startHistoryTimers = () => {
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    const cfg = deps.store.getHistorySettings();
    const fallbackMinutes = historyFallbackMinutes(cfg.snapshotIntervalMinutes);
    // Batch4-C 定时兜底快照（默认 10 分钟，0 = 关闭）：只挑「自上次兜底后有正文变化」的文档
    //（持久账本 history_fallback_state + 正文 mtime，重启不丢）；24h 同 hash 去重/引用保护/
    // 保留期清理沿用既有实现。**启动不立即跑**：首轮 = 就绪后一个间隔，避免和启动抢磁盘。
    if (shouldRunHistoryFallback(fallbackMinutes)) {
      snapshotTimer = setInterval(() => {
        if (historyFallbackRunning) return;
        historyFallbackRunning = true;
        // P2-A：分片 + 20s 预算的异步兜底（每 chunk 让出事件循环）。单飞标记覆盖整个异步窗口。
        void deps.store.runHistoryFallback()
          .then((result) => {
            if (result.created > 0 || result.failed > 0) {
              log.history.info("[history] 兜底快照：" + result.created + " 份（正文变化 " + result.changed + " 篇"
                + (result.failed > 0 ? "，失败 " + result.failed + " 篇（已退避）" : "")
                + (result.bootstrap ? "，首轮游标 " + (result.cursor ?? "已完成") : "") + "）");
            }
          })
          .catch((error) => {
            // 兜底本身绝不影响启动/保存：失败只记日志，等下一个间隔。
            log.history.warn("[history] 兜底快照失败（不阻断）：" + (error instanceof Error ? error.message : String(error)));
          })
          .finally(() => { historyFallbackRunning = false; });
      }, fallbackMinutes * 60 * 1000);
    }
    if (cfg.cleanupIntervalHours > 0) {
      cleanupTimer = setInterval(() => {
        try {
          const r = deps.store.cleanupHistory();
          deps.store.syncState.recordHistoryCleanup(r);
          if (r.deletedSnapshots > 0) log.history.info(`[history] 定期清理：删除 ${r.deletedSnapshots} 份过期快照`);
        } catch (error) { console.warn("[history] 定期清理失败:", error); }
      }, cfg.cleanupIntervalHours * 3600 * 1000);
    }
  };
  startHistoryTimers();

  // 自动同步（interval）定时器：仅在云同步开启且模式为 interval 时运行。
  let syncTimer: NodeJS.Timeout | null = null;
  const startSyncTimers = () => {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    // Batch3-B：安全模式不自动同步（手动 syncNow 仍可用；用户显式退出后本进程也不重启定时器）。
    if (deps.isSafeModeActive()) return;
    if (!deps.autoSyncAllowed) return;
    const cfg = deps.store.getSyncSettings();
    // CORE-14：interval 判据单一来源 = core/syncModes.autoSyncIntervalMs（与设置归一/移动端同口径）。
    const intervalMs = autoSyncIntervalMs(cfg);
    if (intervalMs === null) return;
    syncTimer = setInterval(() => {
      void deps.runFullSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 自动同步失败:", msg);
        // 261028 P1：广播里带上分类 ⇒ 渲染层能把「另一台设备在发布」当软提示，不弹红。
        const info = deps.classifySyncError(error);
        deps.broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg, errorCode: info.code, errorClass: info.className });
      });
    }, intervalMs);
  };
  startSyncTimers();

  // 回收站自动过期（trashAutoPurgeDays 默认 90；0=关闭）。本地操作：启动即查一次 + 每天一次。
  let trashTimer: NodeJS.Timeout | null = null;
  const startTrashTimer = () => {
    if (trashTimer) { clearInterval(trashTimer); trashTimer = null; }
    const cfg = deps.store.getS3GcSettings();
    if (cfg.trashAutoPurgeDays <= 0) return;
    const run = () => {
      try {
        const { purged, skipped } = deps.store.autoPurgeExpiredTrash(cfg.trashAutoPurgeDays);
        if (purged > 0 || skipped > 0) {
          log.trash.info(`[trash] 自动过期 purge ${purged} 项（>${cfg.trashAutoPurgeDays} 天）` + (skipped > 0 ? `，跳过 ${skipped} 项（日记本不可删除）` : ""));
        }
      } catch (error) { console.warn("[trash] 自动过期失败:", error); }
    };
    run();
    trashTimer = setInterval(run, 24 * 3600 * 1000);
  };
  startTrashTimer();

  return {
    restartHistoryTimers: startHistoryTimers,
    restartSyncTimers: startSyncTimers,
    restartGcTimers: () => { startTrashTimer(); },
  };
}
