/**
 * IPC **接线装配**（261112 从 electron/main.ts 拆出，05 报告 S-5）。
 *
 * 为什么单独一层：187 个通道的依赖装配原本与启动流程/窗口/协议混在入口文件里，
 * 「某个域的依赖从哪来」只能靠通读 1300 行找。这里把「通道 → 依赖」收成一张表。
 *
 * 纪律（AGENTS §3#17 / 05 报告 S-5）：
 *  - **纯装配**：本文件不做业务判断、不建窗口、不碰协议与崩溃处理；
 *  - **单例不搬家**：assetToken / webApiToken / trustedWebContents / 各定时器仍归 main.ts 所有，
 *    这里只经 deps 读取（getter 形式，避免把可变状态复制一份）；
 *  - 维护域（串行队列，实现归 main.ts）只注入「轮次级」操作：整轮同步 / 备份快照 / 缺正文补拉。
 *    **本文件不得定义第二条队列**（单飞判据在 main.ts；F16 反向护栏见 maintenanceQueueScope.test.ts）。
 */
import { app, BrowserWindow, type WebFrameMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import type { DraftJournal } from "../draftJournal.js";
import type { WebServerController } from "../webApiServer.js";
import type { UpdateService } from "../update/updateService.js";
import type { BackupIpcRunner } from "../ipc/registerBackupIpc.js";
import type { SafeModeState } from "../safeMode.js";
import type { SyncResult, SyncProgress } from "../syncTypes.js";
import type { NoteDocument } from "../../src/lib/types.js";
import { getQuickNotesAvailability, type QuickNotesAvailability } from "../quickNotesAvailability.js";
import { portableExportAvailability, portableExportCloudActive, type PortableExportAvailability, type PortableExportProgress } from "../../src/core/portable/portableFormat.js";
import { createIpcRegistrar } from "../ipc/registrar.js";
import { registerBatchExportIpc } from "../ipc/registerBatchExport.js";
import { registerMarkdownImportIpc } from "../ipc/registerMarkdownImport.js";
import { registerDuplicateNotesIpc } from "../ipc/registerDuplicateNotes.js";
import { registerBatchNotesIpc } from "../ipc/registerBatchNotes.js";
import { registerNotesIpc } from "../ipc/registerNotes.js";
import { registerDiaryIpc } from "../ipc/registerDiary.js";
import { registerHistoryIpc } from "../ipc/registerHistory.js";
import { registerAiIpc } from "../ipc/registerAi.js";
import { registerAiWritingIpc } from "../ipc/registerAiWriting.js";
import { registerWebIpc } from "../ipc/registerWeb.js";
import { registerSyncIpc } from "../ipc/registerSync.js";
import { registerQuickNotesIpc } from "../ipc/registerQuickNotes.js";
import { registerLogIpc } from "../ipc/registerLogIpc.js";
import { registerSystemInfoIpc } from "../ipc/registerSystemInfo.js";
import { registerSafeModeIpc } from "../ipc/registerSafeMode.js";
import { registerDataRecoveryIpc } from "../ipc/registerDataRecovery.js";
import { registerBackupIpc } from "../ipc/registerBackupIpc.js";
import { registerSyncConflictIpc } from "../ipc/registerSyncConflictIpc.js";
import { registerUpdateIpc } from "../ipc/registerUpdate.js";
import { registerPortableIpc } from "../ipc/registerPortable.js";
import { logFilePath } from "./paths.js";

/**
 * 接线依赖：**全部由 main.ts 显式传入**（没有模块级单例读）。
 * 写成 getter 的那些是 main.ts 里会变/后置赋值的单例（浏览器端控制器、更新服务、定时器重启函数、
 * 自动备份 runner、安全模式状态）—— 传值会把「装配时还没就绪」变成隐式时序。
 */
export interface IpcWiringDeps {
  readonly store: Store;
  readonly quickNotes: QuickNotesStore;
  readonly drafts: DraftJournal;
  /** 工作区根（每次现取：恢复流程会让它指向新目录；与 registerSystemInfoIpc 的签名同形）。 */
  readonly workspaceRoot: () => string;
  /** 维护域串行队列（**唯一实现在 main.ts**；本文件只注入、不定义）。 */
  readonly enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>;
  readonly runFullSync: (onProgress?: (p: SyncProgress) => void) => Promise<SyncResult>;
  readonly broadcastSyncProgress: (p: SyncProgress) => void;
  readonly broadcastNoteBodyChanged: (saved: NoteDocument) => void;
  readonly broadcastPortableProgress: (p: PortableExportProgress) => void;
  /** 浏览器端服务控制器（内存态；未开启 = null）。 */
  readonly getWebServerController: () => WebServerController | null;
  /** 更新中心服务（whenReady 里装配；未装配时 update 通道必须明确报错而不是静默）。 */
  readonly getUpdateService: () => UpdateService | null;
  readonly getAutoBackupRunner: () => BackupIpcRunner | null;
  /** 维护/同步定时器重启函数（配置保存后调用；未就绪 = no-op）。 */
  readonly restartHistoryTimers: () => void;
  readonly restartGcTimers: () => void;
  readonly restartSyncTimers: () => void;
  readonly restartFileScanReconciler: () => void;
  /** 小记库可用性（同步诊断顶部告警用；与 main.ts 的 `getQuickNotesAvailability` 同一来源）。 */
  readonly quickNotesAvailability: () => QuickNotesAvailability;
  /** IPC 来源校验（精确 URL + webContents 白名单；判据在 main.ts 的 isTrustedSenderFrame）。 */
  readonly validateSender: (frame: WebFrameMain | null, sender: Electron.WebContents) => boolean;
  /** 本应用创建的窗口白名单（**集合本体留在 main.ts**，这里只读；广播只发给受信任窗口）。 */
  readonly isTrustedWebContents: (webContentsId: number) => boolean;
  readonly getSafeModeState: () => SafeModeState | null;
  /** 用户显式退出安全模式（清 main.ts 里的 safeModeActive/safeModeState）。 */
  readonly onSafeModeExit: () => void;
}

/** 便携包导出入口可用性（单一判据在 core/portableFormat；这里只喂同步状态）。 */
function portableIpcAvailability(store: Store, quickNotes: QuickNotesStore): PortableExportAvailability {
  try {
    const sync = store.getSyncSettings();
    const status = store.getSyncStatus();
    const pending = store.getSyncPendingSummary();
    const quickPending = getQuickNotesAvailability().mode === "ok" ? quickNotes.getPendingSyncSummary() : { items: 0 };
    return portableExportAvailability({
      s3Configured: store.getS3Settings() !== null,
      sync: { enabled: sync.enabled, autoMode: sync.autoMode },
      lastSyncedAt: status.lastSyncedAt,
      pending: { documents: pending.documents, folders: pending.folders, quickNotes: quickPending.items },
    });
  } catch (error) {
    return { available: false, reason: "读取同步状态失败：" + (error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * 注册全部 IPC 通道，返回「通道 → 调用」表（浏览器端 Web 客户端复用同一批 handler）。
 * 顺序 = 历史顺序，**不要重排**（少数通道的广播/早退依赖相邻注册的装配语义）。
 */
export function registerIpc(deps: IpcWiringDeps): ReadonlyMap<string, (args: unknown[]) => Promise<unknown>> {
  const { store, quickNotes, drafts } = deps;
  // 思源模式收敛：pending 待办计数不再依赖渲染层各操作点手动刷新（历史上有 10+ 处遗漏），
  // 改为 IPC 层单点拦截——每个调用完成后 diff 廉价指纹（微秒级 COUNT），变化才广播完整摘要。
  let lastPendingSig = "";
  /** 目录树结构会变的 IPC 通道：写库后广播 library-changed，让其它窗口（含浏览器端）刷新目录树。 */
  const TREE_CHANGING_CHANNELS = new Set<string>([
    "create_note", "create_notebook", "create_group", "create_note_in",
    "create_usheet_in", "create_bitable_in", "create_board_in", "create_ink_in",
    "rename_tree_node", "set_node_icon",
    "move_tree_node", "move_tree_node_ordered", "reorder_tree_nodes",
    "delete_tree_node", "delete_note", "restore_trash", "purge_trash", "empty_trash",
    // 261106 批量操作：一次调用改多条 ⇒ 整批只广播一次（不逐条）。
    "batch_notes",
    // 261106 创建副本：一次调用可能新建多篇 ⇒ 整批只广播一次。
    "duplicate_notes",
  ]);
  const afterInvoke = (channel: string): void => {
    // 目录树变更：无条件广播（不能被下面 pending 摘要的早退吞掉）。
    if (TREE_CHANGING_CHANNELS.has(channel)) {
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!deps.isTrustedWebContents(win.webContents.id)) continue;
          try { win.webContents.send("library-changed", { channel }); } catch { /* 窗口已关闭 */ }
        }
        deps.getWebServerController()?.broadcast("library-changed", { channel });
      } catch { /* 忽略 */ }
    }
    try {
      const sig = `${store.pendingSignature()}:${quickNotes.getPendingSyncSummary().items}`;
      if (sig === lastPendingSig) return;
      lastPendingSig = sig;
      const lake = store.getSyncPendingSummary();
      const quick = quickNotes.getPendingSyncSummary();
      const summary = { documents: lake.documents, folders: lake.folders, resources: 0, quickNotes: quick.items, total: lake.documents + lake.folders + quick.items, generatedAt: new Date().toISOString() };
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send("pending-summary-changed", summary); } catch { /* 窗口已关闭 */ }
      }
      // 浏览器端（Web 客户端）：走 SSE 推送（未开启时 no-op）
      deps.getWebServerController()?.broadcast("pending-summary-changed", summary);
    } catch { /* store 未就绪（早期调用）忽略 */ }
  };
  const ipc = createIpcRegistrar((event) => {
    if (!deps.validateSender(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
  }, afterInvoke, (channel, payload) => {
    // HTTP 调用方（浏览器端）没有 Electron 窗口：handleEvent 的 send 统一转到 SSE 广播
    //（sync-progress / ai:stream 等），否则浏览器端收不到流式与进度。
    deps.getWebServerController()?.broadcast(channel, payload);
  });

  // 261106 批量导出（数据层 electron/batchExport.ts）：按类型默认格式导出到同一目录，只读不写源。
  registerBatchExportIpc(ipc, { store });
  // 261106 Markdown 导入：文件选择/目录扫描/图片字节（转换与落盘在 renderer 管线，见 src/features/import/）。
  registerMarkdownImportIpc(ipc);
  // 261106 批量操作（A 方案）：core 编排 + 主进程单事务（lake 主库 / quickNotes 小记库）。
  // 删除语义只有"移入回收站"；purge/物理删除仍只在回收站入口（purgeTrashItem / 清空回收站）。
  // 261106 文档「创建副本」：逐条新 id + 新建管线（正文/资源全量复制 + URL 重写），逐条结果。
  registerDuplicateNotesIpc(ipc, { store });
  registerBatchNotesIpc(ipc, {
    store,
    getQuickNotes: () => (getQuickNotesAvailability().mode === "ok" ? quickNotes : null),
    activeTagIds: () => {
      if (getQuickNotesAvailability().mode !== "ok") return null; // 目录不可用 ⇒ tag-add 整批拒绝
      try { return new Set(quickNotes.tagService.list().map((tag) => tag.id)); } catch { return null; }
    },
  });
  registerNotesIpc(ipc, store, quickNotes, drafts, deps.workspaceRoot(), (targetRoot) => {
    // A1 一致性快照：主库 + 小记库各经其连接 VACUUM INTO（单文件、可独立打开）
    const mainTarget = path.join(targetRoot, "metadata.sqlite3");
    store.backupDatabaseTo(mainTarget);
    const quickDir = path.join(targetRoot, "quick-notes");
    fs.mkdirSync(quickDir, { recursive: true });
    quickNotes.backupDatabaseTo(path.join(quickDir, "metadata.sqlite3"));
  }, deps.enqueueMaintenance, deps.broadcastNoteBodyChanged);
  // 261109 日记：幂等打开某天（判据/单事务在 electron/diaryStore.ts；通道见 docs/DIARY.md）。
  registerDiaryIpc(ipc, {
    openDate: (dateKey, options) => store.openDiaryDate(dateKey, options),
    unmark: (notebookId) => store.unmarkDiaryNotebook(notebookId),
  });
  registerHistoryIpc(ipc, store, () => deps.restartHistoryTimers());
  registerAiIpc(ipc, store);
  registerAiWritingIpc(ipc, store);
  registerWebIpc(ipc, () => deps.getWebServerController());
  registerSyncIpc(ipc, {
    store,
    quickNotes,
    // 小记库降级时在「设置→同步诊断」顶部给一条可读告警（复用既有 S3v3DiagnosticReport 通道）。
    quickNotesAvailability: deps.quickNotesAvailability,
    runFullSync: deps.runFullSync,
    enqueueMaintenance: deps.enqueueMaintenance,
    broadcastSyncProgress: deps.broadcastSyncProgress,
    restartGcTimers: () => deps.restartGcTimers(),
    restartSyncTimers: () => deps.restartSyncTimers(),
  });
  registerQuickNotesIpc(ipc, quickNotes, store, deps.enqueueMaintenance);
  registerLogIpc(ipc);
  registerSystemInfoIpc(ipc, { store, quickNotes, workspaceRoot: deps.workspaceRoot });
  // Batch3-B：安全模式三件事（读状态 / 复制诊断 / 显式退出）。通道登记见 electron/ipc/ipcChannelParity.test.ts。
  registerSafeModeIpc(ipc, {
    userDataDir: app.getPath("userData"),
    logPath: logFilePath(),
    appVersion: app.getVersion(),
    platform: process.platform,
    state: () => deps.getSafeModeState(),
    onExit: () => deps.onSafeModeExit(),
  });
  // 261105 Batch4-D：低频扫描设置（0=关闭）+ 手动「重建数据」候选/执行（只允许本次扫描候选）。
  registerDataRecoveryIpc(ipc, {
    store,
    workspaceRoot: deps.workspaceRoot(),
    onFileScanSettingsChanged: () => deps.restartFileScanReconciler(),
  });
  // 261105 Batch4-E：自动备份（配置/状态读取 + 保存 + 立即备份 + 只读占用统计）；备份实现见 whenReady 里的调度器。
  registerBackupIpc(ipc, {
    // 占用统计只读 stat <userData>/backups（与调度器同一个 backupsDir/轮转口径）。
    userDataDir: app.getPath("userData"),
    runner: {
      getSettings: () => deps.getAutoBackupRunner()?.getSettings() ?? store.getAutoBackupSettings(),
      getState: () => deps.getAutoBackupRunner()?.getState() ?? store.getAutoBackupState(),
      saveSettings: (settings) => (deps.getAutoBackupRunner() ?? {
        saveSettings: (value: typeof settings) => store.saveAutoBackupSettings(value),
      }).saveSettings(settings),
      runNow: () => deps.getAutoBackupRunner()?.runNow() ?? Promise.resolve({ state: store.getAutoBackupState(), message: "备份服务未就绪" }),
    },
  });
  // 261105 P1 第 4 项：同步记录账本（设备本地；列表/标已读/恢复动作）。
  registerSyncConflictIpc(ipc, { store, quickNotes });
  // 261109 桌面更新中心（读状态/检查/下载/打开安装包/打开下载页/读写设置/忽略版本）。
  const updateService = deps.getUpdateService();
  if (!updateService) throw new Error("更新服务未装配");
  registerUpdateIpc(ipc, { service: updateService });
  // 261109 桌面 → 手机便携包（docs/PORTABLE-TRANSFER.md）：云开启 + 上轮同步成功 + 无待同步才可用。
  registerPortableIpc(ipc, {
    workspaceRoot: () => deps.workspaceRoot(),
    appVersion: () => app.getVersion(),
    snapshotDatabases: (targetRoot) => {
      // 与 A1 整库备份同一套一致性快照口径（VACUUM INTO；独立于运行中的 WAL）。
      store.backupDatabaseTo(path.join(targetRoot, "metadata.sqlite3"));
      const quickDir = path.join(targetRoot, "quick-notes");
      fs.mkdirSync(quickDir, { recursive: true });
      quickNotes.backupDatabaseTo(path.join(quickDir, "metadata.sqlite3"));
    },
    availability: () => portableIpcAvailability(store, quickNotes),
    cloudState: () => {
      try {
        const sync = store.getSyncSettings();
        const status = store.getSyncStatus();
        const input = {
          s3Configured: store.getS3Settings() !== null,
          sync: { enabled: sync.enabled, autoMode: sync.autoMode },
          lastSyncedAt: status.lastSyncedAt,
          pending: { documents: 0, folders: 0, quickNotes: 0 },
        };
        return { active: portableExportCloudActive(input), lastSyncedAt: status.lastSyncedAt };
      } catch {
        return { active: false, lastSyncedAt: null };
      }
    },
    beforeExport: () => deps.runFullSync(deps.broadcastSyncProgress),
    counts: () => {
      const overview = store.getStorageOverview();
      let quickNotesCount = 0;
      let tagsCount = 0;
      try { quickNotesCount = quickNotes.countQuickNotes(); } catch { quickNotesCount = 0; }
      try { tagsCount = quickNotes.tagService.list().length; } catch { tagsCount = 0; }
      return { folders: overview.notebooks + overview.groups, quickNotes: quickNotesCount, tags: tagsCount };
    },
    broadcastProgress: (progress) => deps.broadcastPortableProgress(progress),
  });
  return ipc.registry;
}
