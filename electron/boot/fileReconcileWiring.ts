/**
 * 文件↔元数据对账装配（C-04 从 main.ts F 原样搬出）：低频只报告（默认每 24h，设置可改、0 = 关闭），
 * 同步成功打点 + 进程空闲（≥5min）门控，与同步/GC 共用维护域串行队列；报告经 runDataHealthCheck 暴露。
 * 边界：只装配对账器与重启闭包；实现/唤醒策略 = electron/fileMetadataReconcile.ts（纯报告，不写库）。
 * 纪律（S-5）：fileReconciler 单例本体留 main.ts，本文件只经 get/set 读写。
 */
import { powerMonitor } from "electron";
import { FILE_RECONCILE_DEFAULTS, FileMetadataReconciler } from "../fileMetadataReconcile.js";
import type { Store } from "../store.js";
import { log } from "../logger.js";

export interface FileReconcileWiringDeps {
  store: Store;
  workspaceRoot: () => string;
  /** 维护域串行队列（唯一实现在 main.ts；本文件只注入、不定义第二条）。 */
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>;
  /** 对账器单例（本体在 main.ts，只经 get/set 读写）。 */
  getReconciler: () => FileMetadataReconciler | null;
  setReconciler: (reconciler: FileMetadataReconciler | null) => void;
}

/** 装配并立即启动；返回重启闭包（save_file_scan_settings IPC 调用，见 boot/ipcWiring）。 */
export function startFileReconciler(deps: FileReconcileWiringDeps): () => void {
  const start = () => {
    deps.getReconciler()?.dispose();
    const configured = deps.store.getFileScanSettings().intervalHours;
    const enabledByEnv = process.env.LAKE_FILE_RECONCILE !== "0";
    const intervalHours = enabledByEnv ? configured : 0;
    const enabled = intervalHours > 0;
    deps.setReconciler(new FileMetadataReconciler({
      root: deps.workspaceRoot(),
      listKnownNoteIds: () => deps.store.listNotesSyncMeta().map((n) => n.id),
      getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
      enqueueMaintenance: deps.enqueueMaintenance,
      enabled,
      intervalHours,
      cooldownMs: intervalHours > 0 ? Math.max(1, intervalHours * 3600_000) : FILE_RECONCILE_DEFAULTS.cooldownMs,
      // P2-B：上次成功扫描时间跨重启持久化（settings；缺失/损坏按未跑过）。
      loadLastRunAt: () => deps.store.getFileReconcileState().lastScanAt,
      saveLastRunAt: (at) => deps.store.saveFileReconcileState({ lastScanAt: at }),
      log: (message) => log.app.info(message),
    }));
    deps.store.setFileReconcileReportProvider(() => deps.getReconciler()?.getLastReport() ?? null);
    log.app.info("[reconcile] 文件↔元数据对账" + (enabled ? "已启用（间隔 " + intervalHours + "h，只报告）" : "已关闭（0h / LAKE_FILE_RECONCILE=0）"));
  };
  start();
  return start;
}
