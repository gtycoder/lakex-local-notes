import { app, BrowserWindow, crashReporter, dialog, Menu, shell } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import type { FileMetadataReconciler } from "./fileMetadataReconcile.js";
import { shouldSyncOnOpenClose } from "../src/core/syncModes.js";
import type { QuickNotesStore } from "./quickNotes.js";
import { getQuickNotesAvailability } from "./quickNotesAvailability.js";
import type { SyncResult, SyncProgress } from "./syncTypes.js";
import type { NoteDocument } from "../src/lib/types.js";
import { syncNowViaEngine } from "./syncEngineController.js";
import { initLogger, log, logHeapPeak, logStartupInfo } from "./logger.js";
import { errorFields, formatLogFields } from "../src/core/logFormat.js";
import { setQuickNotesStoreForV3 } from "./s3v3/quickNotesRegistry.js";
import { readSyncErrorInfo } from "./s3v3/syncErrorInfo.js";
import { installNativeSha256 } from "./sha256Native.js";
import { markStartupClean, removeCrashMarker, writeCrashMarker } from "./startupRecovery.js";
import { removeSafeModeState, type SafeModeState } from "./safeMode.js";
import type { BackupIpcRunner } from "./ipc/registerBackupIpc.js";
import type { UpdateService } from "./update/updateService.js";
import { DraftJournal, draftJournalDir } from "./draftJournal.js";
import type { PortableExportProgress } from "../src/core/portable/portableFormat.js";
import type { WebServerController } from "./webApiServer.js";
import { registerAppSchemePrivileges } from "./appProtocol.js";
import { buildAppMenuTemplate } from "./appMenu.js";
import { installTestDialogHooks } from "./testDialogHooks.js";
import {
  APP_DISPLAY_NAME,
  PROJECT_URL,
  applyUserDataPath,
  isDev,
  workspaceRoot,
} from "./boot/paths.js";
import { registerIpc } from "./boot/ipcWiring.js";
import { appDirOf } from "./buildTarget.js";
// C-04 批次 B：装配外迁（boot/* = 启动接线、window/* = 窗口层；单例仍留本文件，见各 wiring 的 deps）。
import { markNativeSha256Installed, markUserDataPathApplied, assertNativeSha256Installed, assertUserDataPathApplied } from "./boot/startupOrder.js";
import { readStartupSignals, rollbackInterruptedWorkspaceSwap, openStoreWithStartupProbe, backfillS3Seed } from "./boot/startupDecision.js";
import { enterStartupRecovery } from "./boot/recoveryWiring.js";
import { openQuickNotesWorkspace } from "./boot/quickNotesWiring.js";
import { startFileReconciler } from "./boot/fileReconcileWiring.js";
import { startAutoBackup } from "./boot/backupWiring.js";
import { assembleUpdateService } from "./boot/updateWiring.js";
import { startAssetServices, startWebClient } from "./boot/protocolWiring.js";
import { startTimerWiring } from "./boot/timerWiring.js";
import { syncOnAppOpen } from "./boot/syncWiring.js";
import { createBootWindow, type BootSplashDeps } from "./window/bootSplash.js";
import { createWindow, type MainWindowDeps } from "./window/createMainWindow.js";
import { createSenderValidator } from "./window/windowSecurity.js";

/** 构建产物目录（= dist-electron 的运行时绝对路径，**唯一**依赖入口位置的路径）。
 *  boot.html / preload / dist / CDN 镜像都从它派生：派生规则集中在 `electron/buildTarget.ts`
 *  （与 vite 构建配置、package.json build.files 的断言共用同一份契约）。
 *  之所以在入口算而不放进 boot/paths.ts：那里刻意不读 import.meta.url（见该文件头注释）。 */
const BUILD_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 主窗口引用（macOS 菜单「设置…」需要给渲染层发事件；单窗口应用，关窗即清空）。 */
let mainWindow: BrowserWindow | null = null;

/** 启动遮罩窗口：在主进程初始化 + 渲染层加载期间先显示 logo，避免主窗口白屏。 */
let bootWindow: BrowserWindow | null = null;

/** 应用根目录（asar 内一级目录）：dist / public 的定位锚点。 */
const APP_DIR = appDirOf(BUILD_DIR);
// userData 隔离必须在 app ready 前生效，且早于任何 userDataDir()/workspaceRoot() 读取（时序②）。
applyUserDataPath();
markUserDataPathApplied();

// 时序①：私有协议必须在 app ready 之前注册（Electron 硬要求）⇒ 只能留在模块顶层，断言防搬移。
if (app.isReady()) throw new Error("[startup-order] registerAppSchemePrivileges 必须在 app ready 前（模块顶层）执行");
registerAppSchemePrivileges();

// CORE-06：桌面进程内 SHA-256 走 node:crypto（core 默认纯 JS）。必须在任何正文/资产
// hash 计算（同步、索引、历史）之前注入 —— 放在 app ready 之前的模块初始化段（时序④）。
installNativeSha256();
markNativeSha256Installed();
// 仅 dev/测试：用环境变量替换原生文件对话框（生产 isPackaged 强制忽略）。
if (installTestDialogHooks({ dialog: dialog as unknown as Parameters<typeof installTestDialogHooks>[0]["dialog"], isPackaged: app.isPackaged, env: process.env })) {
  console.warn("[test-hook] 原生文件对话框已被 LAKE_TEST_PICK_FILE/DIR/SAVE_FILE 替换（仅开发环境）");
}

/**
 * 资产服务器访问令牌（审计：防外部网页 CORS 读本地笔记图片）。
 * 本地资源服务对"带 Origin 头的 CORS 请求"要求 ?token=<assetToken> 匹配；
 * 打包版 file:// 页面与 dev 页面经 preload 拿到 token（src/lib/assetPort.ts），
 * <img> 等非 CORS 请求不带 Origin 不受影响。token 每次启动随机，外部站点不可得。
 */
const assetToken = crypto.randomBytes(32).toString("hex");
process.env.LAKE_ASSET_TOKEN = assetToken;
/**
 * 浏览器端 /api 的独立令牌，**与 assetToken 分离**（审计 A.3 替代方案）：
 * assetToken 会出现在资产 URL 的 ?token= 里、暴露面更大；拆开后即便 assetToken 泄漏，
 * 也拿不到 IPC 凭据（原实现两者同值，偷到资产 token 即可调全部 IPC）。
 */
const webApiToken = crypto.randomBytes(32).toString("hex");

let store: Store;
let quickNotes: QuickNotesStore;
/** 浏览器端服务控制器（内存态；启动时默认不监听）。 */
let webServerController: WebServerController | null = null;
/** Batch3-B：本次进程是否处于安全模式（启动判定一次；用户显式退出后置 false）。 */
let safeModeActive = false;
/** 安全模式状态快照（提示条/诊断 IPC 用）；未进入 = null。 */
let safeModeState: SafeModeState | null = null;
let drafts: DraftJournal;
/** Batch4-B：文件↔元数据对账（只报告；261105 起默认每 24h 低频扫描，设置里可改/0 关闭）。 */
let fileReconciler: FileMetadataReconciler | null = null;
/** 扫描间隔设置变更后重建对账器（save_file_scan_settings IPC 调用）。 */
let restartFileScanReconciler: (() => void) | null = null;
/** 自动备份 runner（261105；registerIpc 在 whenReady 里注册，runner 先于此装配）。 */
let autoBackupRunner: BackupIpcRunner | null = null;
/** 更新中心服务（261109；仅桌面：检查 GitHub latest.json / 后台下载 / 用户手动打开安装包）。 */
let updateService: UpdateService | null = null;
/** 261105 P2-B：正常启动是否真正跑通（只有跑通后退出才写「上次 OK」；恢复模式退出保持 dirty ⇒ 下次深检）。 */
let normalStartupCompleted = false;
/** 历史定时器重启函数（配置变更时调用，见 save_history_settings IPC） */
let restartHistoryTimers: (() => void) | null = null;
/** S3 GC 定时器重启函数（配置变更时调用，见 save_s3_gc_settings IPC） */
let restartGcTimers: (() => void) | null = null;
/** 自动同步定时器重启函数（配置变更时调用，见 save_sync_settings IPC） */
let restartSyncTimers: (() => void) | null = null;
/** 本机进程内串行队列：同步、GC、深度清理同一时刻只跑一个（v4.1 唯一必需互斥）。 */
let maintenanceQueue: Promise<unknown> = Promise.resolve();
function enqueueMaintenance<T>(task: () => Promise<T>): Promise<T> {
  const run = maintenanceQueue.then(task, task);
  maintenanceQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** 同步单飞保护：同一时刻只允许一个完整同步（手动 / 自动 / 开关触发共用）。 */
let syncInFlight = false;

/** 执行完整同步（Lake → 小记），与 GC/深度清理共用串行队列。 */
/** 广播同步进度到本进程所有受信任窗口（自动同步/定时同步没有单一触发渲染层时用）。 */
function broadcastSyncProgress(p: SyncProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!trustedWebContents.has(win.webContents.id)) continue;
    try { win.webContents.send("sync-progress", p); } catch { /* 窗口已关闭 */ }
  }
  // 浏览器端（Web 客户端）：走 SSE 推送（未开启时 no-op）
  webServerController?.broadcast("sync-progress", p);
}

/** 退出时若同步在途，置位并在同步结束后真正退出（避免中断上传/写盘） */
let quitAfterSync = false;
/** 退出兜底：同步卡死（网络黑洞等）超过上限后强制退出，不再等待。 */
const QUIT_SYNC_DEADLINE_MS = 60_000;
let quitDeadlineTimer: NodeJS.Timeout | null = null;
let forceQuit = false;

function scheduleQuitDeadline(): void {
  if (quitDeadlineTimer) return;
  quitDeadlineTimer = setTimeout(() => {
    quitDeadlineTimer = null;
    forceQuit = true;
    log.app.warn("[quit] 等待同步超时，强制退出");
    app.quit();
  }, QUIT_SYNC_DEADLINE_MS);
}

function clearQuitDeadline(): void {
  if (quitDeadlineTimer) {
    clearTimeout(quitDeadlineTimer);
    quitDeadlineTimer = null;
  }
}

async function runFullSync(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  assertNativeSha256Installed("runFullSync"); // 时序④：hash 计算前必须已注入原生 sha256
  if (syncInFlight) throw new Error("同步正在进行中，请等待本次同步完成");
  syncInFlight = true;
  // 断点续传标记：开始即置位，成功结束才清（中断/被杀/断网时残留，下次启动自动续）。
  try { store.syncState.markSyncInterrupted(new Date().toISOString()); } catch { /* 状态表异常不阻断同步 */ }
  const fullSyncStart = Date.now();
  log.sync.info("[perf] runFullSync start");
  try {
    return await enqueueMaintenance(async () => {
      // 手动同步：只发回触发它的渲染层；自动同步：广播给本进程所有窗口。
      const report = (p: SyncProgress) => {
        if (onProgress) { try { onProgress(p); } catch { /* 渲染层已关闭 */ } }
        else { broadcastSyncProgress(p); }
      };
      const result = await syncNowViaEngine(store, report);
      quickNotes.markTargetNotesSynced();
      // 小记已随 v3 同一轮同步；旧 quick-notes 通道已移除。
      result.quickNotes = { uploaded: 0, downloaded: 0, conflicts: 0, completedAt: new Date().toISOString() };
      store.syncState.recordSyncResult(JSON.stringify(result));
      // 验收发现（261028）：v3 路径只写了 last_sync_result，从没写过 last_synced_at ⇒
      // 同步浮窗/状态栏的「上次同步」一直是旧值（新机器上则永远为空）。两条都写。
      try { store.syncState.markSyncComplete(result.completedAt ?? new Date().toISOString()); } catch { /* 状态表异常不阻断同步 */ }
      try { store.syncState.clearSyncInterrupted(); } catch { /* 同上 */ }
      // Batch4-B：同步成功 = 对账的触发点（不立即跑；等进程空闲 + 冷却，只报告不写入）。
      try { fileReconciler?.onSyncComplete(); } catch { /* 对账打点失败不阻断同步 */ }
      report({ phase: "done", message: "同步完成", supersededNotes: result.supersededNotes });
      log.sync.info(`[perf] runFullSync done ${Date.now() - fullSyncStart}ms (uploaded=${result.uploaded}, downloaded=${result.downloaded}, conflicts=${result.conflicts}, superseded=${result.supersededNotes.length}, quickNotes=${result.quickNotes?.error ? "error" : "ok"})`);
      logHeapPeak("sync");
      return result;
    });
  } catch (error) {
    // 同步失败必须留证据（正式环境没有终端，别只靠调用点的 console.warn）。
    log.sync.error("[sync] 同步失败" + formatLogFields({ ...errorFields(error), ms: Date.now() - fullSyncStart }));
    throw error;
  } finally {
    syncInFlight = false;
    clearQuitDeadline();
    // 审计：退出时等本轮同步完成再真正退出（before-quit 置位）
    if (quitAfterSync) {
      quitAfterSync = false;
      app.quit();
    }
  }
}

/** 本应用创建的窗口 webContents 白名单（防导航到其他页面后仍调用 IPC） */
const trustedWebContents = new Set<number>();

/** window/bootSplash 装配依赖（boot 窗口单例本体在本文件，getter 形式 —— S-5）。 */
function bootSplashDeps(): BootSplashDeps {
  return {
    buildDir: BUILD_DIR,
    getBootWindow: () => bootWindow,
    setBootWindow: (w) => { bootWindow = w; },
  };
}

/** window/createMainWindow 装配依赖（main/boot 窗口与白名单单例本体在本文件 —— S-5）。 */
function mainWindowDeps(): MainWindowDeps {
  return {
    buildDir: BUILD_DIR,
    bootStartedAt: BOOT_STARTED_AT,
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    getBootWindow: () => bootWindow,
    setBootWindow: (w) => { bootWindow = w; },
    trustedWebContents,
  };
}

/** 启动计时基准（main.js 加载即开始）：[perf] boot.ready 用它算到主窗口首帧的耗时。 */
const BOOT_STARTED_AT = Date.now();

/**
 * 崩溃 / 未捕获错误留档（261023；261105 P1-5 补持久标记）。
 * 决策：**只记日志、不退出** —— 本地数据由原子写 + 历史快照保证；主进程直接退出会把用户当前编辑打断。
 * 频次与形态由日志统计（grep '[crash]'）；若某类异常持续出现，再按证据收敛到具体调用点。
 *
 * P1-5：uncaughtException 后进程状态不可信，额外落一条**持久** crash 标记
 * （crash-marker.json：time/reason/stack 摘要/累计次数），下次启动在恢复页或启动日志提示。
 * 标记写入自身绝不抛错（崩溃处理里再抛会把现场冲掉），也不做安全模式（下一批）。
 */
function installCrashLogging(userDataDir: string): void {
  process.on("uncaughtException", (error) => {
    log.app.error("[crash] uncaughtException" + formatLogFields(errorFields(error)));
    if (!writeCrashMarker(userDataDir, error)) log.app.warn("[crash] 写启动崩溃标记失败（crash-marker.json）");
  });
  process.on("unhandledRejection", (reason) => {
    log.app.error("[crash] unhandledRejection" + formatLogFields(errorFields(reason)));
  });
}

/** 便携包导出进度（窗口 + Web 客户端 SSE）。 */
/** 261110：正文保存成功 → 广播给所有桌面窗口 + 浏览器端（只带 id/hash，不带正文）。
 *  各客户端自己判断"这篇是否打开 / 是否 dirty"（判据见 src/core/noteBodyBroadcast.ts），未打开不读盘。 */
function broadcastNoteBodyChanged(saved: NoteDocument): void {
  const payload = { noteId: saved.id, contentHash: saved.contentHash, title: saved.title, updatedAt: saved.updatedAt };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!trustedWebContents.has(win.webContents.id)) continue;
      try { win.webContents.send("note-body-changed", payload); } catch { /* 窗口已关闭 */ }
    }
  } catch { /* 忽略 */ }
  webServerController?.broadcast("note-body-changed", payload);
}

function broadcastPortableProgress(progress: PortableExportProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!trustedWebContents.has(win.webContents.id)) continue;
    try { win.webContents.send("portable-export-progress", progress); } catch { /* 窗口已关闭 */ }
  }
  webServerController?.broadcast("portable-export-progress", progress);
}

// Increase renderer memory limit for large documents with base64 images
// 主进程 V8 堆上限 4GB（此前 8GB）：heap 峰值由 [heap] perf 日志实测（见 logHeapPeak），大库同步如需更多再上调。
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");

// 单实例锁：双开应用会并发写同一 SQLite 与 .lake 文件，存在丢失更新风险
// 崩溃转储本地留档（不自动上传）：Electron 43 起 renderer OOM 崩溃报告带 JS 堆栈，
// 便于诊断「大纲展开到 X 级」等偶发崩溃（dumps 在 userData/Crashpad）。
crashReporter.start({ submitURL: "http://127.0.0.1:0/", uploadToServer: false, compress: true });

// 子进程（GPU/网络/utility 等）异常退出留档，便于定位渲染/同步卡死根因。
app.on("child-process-gone", (_event, details) => {
  if (details.reason === "clean-exit") return;
  log.app.warn(`[crash] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${details.serviceName ? ` service=${details.serviceName}` : ""}`);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // 身份与 macOS 菜单（用户 261029：参考思源裁剪版——只 darwin 装自定义菜单，role+中文 label）：
    // ⚠️ macOS 应用菜单的**标题**取运行体 bundle 的 CFBundleName，**不是** MenuItem.label、也不是 app.name：
    // dev 跑 Electron.app ⇒ 标题固定显示 Electron（改名只能靠打包/重签名那层）；打包版由 electron-builder
    // 写入 productName ⇒ 显示 LakexLocalNotes。setName 只影响 app.getName() 等主进程语义，别指望它改菜单标题。
    app.setName(APP_DISPLAY_NAME);
    app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME, applicationVersion: app.getVersion() });
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({
        appName: APP_DISPLAY_NAME,
        isDev,
        // 与思源一致：菜单只发事件，由渲染层决定开哪块设置（不在主进程造窗口/状态）。
        onOpenSettings: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("open-settings"); },
        onOpenDocs: () => { void shell.openExternal(PROJECT_URL + "#readme"); },
        onFeedback: () => { void shell.openExternal(PROJECT_URL + "/issues/new"); },
        // 数据目录 = userData（workspace-default / logs / sync-v3 都在它下面），与设置页同名动作同语义。
        onOpenDataFolder: () => { void shell.openPath(app.getPath("userData")); },
      })));
    }
    initLogger({ isPackaged: app.isPackaged });
    assertUserDataPathApplied("whenReady"); // 时序②：userData 路径必须已固定
    const userDataDir = app.getPath("userData");
    // 崩溃标记必须在任何启动动作之前读：上次运行留下未捕获异常时，本次启动（含恢复页）要能提示。
    installCrashLogging(userDataDir);
    createBootWindow(bootSplashDeps());
    logStartupInfo();
    log.app.info("app ready: initLogger done" + formatLogFields({ bootMs: Date.now() - BOOT_STARTED_AT }));
    // C+D：崩溃标记/安全模式/换位回滚 + 条件深检 + 完整性预检 + Store 打开 + 恢复决策
    //（boot/startupDecision；P1-5：**先做完整性预检，再建 Store**，坏库不进普通启动）。
    const { crashMarker, safeModeDecision } = readStartupSignals(userDataDir);
    safeModeActive = safeModeDecision.active;
    safeModeState = safeModeDecision.active ? safeModeDecision.state : null;
    rollbackInterruptedWorkspaceSwap(workspaceRoot());
    const startupProbe = openStoreWithStartupProbe({ userDataDir, workspaceRoot, crashMarker });
    const startupDecision = startupProbe.startupDecision;
    if (startupDecision.mode === "recovery" || !startupProbe.openedStore) {
      // E：恢复模式 = 销毁 splash，换成可操作的最小恢复页（boot/recoveryWiring）。
      enterStartupRecovery({ userDataDir, workspaceRoot, getBootWindow: () => bootWindow, setBootWindow: (w) => { bootWindow = w; } }, startupDecision);
      return;
    }
    // 正常启动判定完成；崩溃标记等**启动真正跑通**（建主窗口前）再消费，避免半途失败时丢掉线索。
    store = startupProbe.openedStore;
    // F：文件↔元数据对账（低频只报告；boot/fileReconcileWiring）。
    restartFileScanReconciler = startFileReconciler({
      store,
      workspaceRoot,
      enqueueMaintenance,
      getReconciler: () => fileReconciler,
      setReconciler: (r) => { fileReconciler = r; },
    });
    // G：A2 云端恢复 seed 回填 + 开发版可选 S3 seed（boot/startupDecision）。
    backfillS3Seed({ workspaceRoot, store });
    // H：小记库打开/降级 + 标签迁移 + 孤儿清理（boot/quickNotesWiring；降级不注册 v3）。
    quickNotes = openQuickNotesWorkspace({
      workspaceRoot,
      store,
      registerQuickNotesForV3: (q) => setQuickNotesStoreForV3(q),
    });
    drafts = new DraftJournal(draftJournalDir(workspaceRoot()));
    // J：自动备份 runner + 6h tick（boot/backupWiring；启动不立即跑）。
    autoBackupRunner = startAutoBackup({ store, enqueueMaintenance, workspaceRoot });
    // K：更新中心装配 + onState 广播（boot/updateWiring）。
    updateService = assembleUpdateService({ userDataDir, store, trustedWebContents, getWebServerController: () => webServerController });
    // L：资产服务（固定端口）+ CDN/资产 token 重定向（boot/protocolWiring）。
    await startAssetServices({ workspaceRoot, appDir: APP_DIR, assetToken, trustedWebContents });
    // M：IPC 接线依赖**全部显式传入**（单例仍在 main：token/窗口白名单/定时器/控制器都不搬家）。
    const webApiRegistry = registerIpc({
      store,
      quickNotes,
      drafts,
      workspaceRoot: () => workspaceRoot(),
      enqueueMaintenance,
      runFullSync,
      broadcastSyncProgress,
      broadcastNoteBodyChanged,
      broadcastPortableProgress,
      getWebServerController: () => webServerController,
      getUpdateService: () => updateService,
      getAutoBackupRunner: () => autoBackupRunner,
      restartHistoryTimers: () => restartHistoryTimers?.(),
      restartGcTimers: () => restartGcTimers?.(),
      restartSyncTimers: () => restartSyncTimers?.(),
      restartFileScanReconciler: () => restartFileScanReconciler?.(),
      quickNotesAvailability: () => getQuickNotesAvailability(),
      validateSender: createSenderValidator({ trustedWebContents }),
      isTrustedWebContents: (id) => trustedWebContents.has(id),
      getSafeModeState: () => safeModeState,
      onSafeModeExit: () => { safeModeActive = false; safeModeState = null; },
    });
    // N：浏览器端（Web 客户端）服务装配（boot/protocolWiring；serveAppDist 先于 createWindow）。
    webServerController = startWebClient({ appDir: APP_DIR, registry: webApiRegistry, webApiToken, assetToken });
    // 正常启动已跑通 ⇒ 消费崩溃标记（它已在启动日志里提示过；恢复模式不会走到这里，保留给恢复页）。
    // 正常启动已跑通 ⇒ 消费崩溃标记（旧语义）；安全模式**不清**标记（诊断线索保留到用户显式退出）。
    if (startupDecision.crashMarker && !safeModeActive) removeCrashMarker(userDataDir);
    // 正常启动顺手清掉遗留状态文件：别让下一次启动误读上一次的 active:true。
    if (!safeModeActive) removeSafeModeState(userDataDir);
    void createWindow(mainWindowDeps());
    // 更新中心：启动后延迟一次自动检查 + 每 N 小时（安全模式不联网检查）；失败只记状态，不阻断启动。
    if (!safeModeActive) updateService?.start();
    // P2-B：正常启动已跑通；「上次 OK」在正常退出（will-quit）时落盘，运行中崩溃保持 dirty ⇒ 下次深检。
    normalStartupCompleted = true;
    logHeapPeak("startup");

    // P+Q+S：历史兜底/清理、自动同步（interval）、回收站过期三组定时器（boot/timerWiring）。
    /** 小记库降级 ⇒ 不做自动同步：整轮同步已被 desktopSync 前置断言拦住，定时器只会反复刷失败；
     *  手动同步仍会当场给出可读错误（用户知道为什么 + 去哪恢复）。 */
    const autoSyncAllowed = getQuickNotesAvailability().mode === "ok";
    const timers = startTimerWiring({
      store,
      runFullSync,
      broadcastSyncProgress,
      classifySyncError: readSyncErrorInfo,
      isSafeModeActive: () => safeModeActive,
      autoSyncAllowed,
    });
    restartHistoryTimers = timers.restartHistoryTimers;
    restartSyncTimers = timers.restartSyncTimers;
    restartGcTimers = timers.restartGcTimers;
    // R：开应用对齐一次 + 断点续传（boot/syncWiring）。
    syncOnAppOpen({
      store,
      runFullSync,
      broadcastSyncProgress,
      classifySyncError: readSyncErrorInfo,
      isSafeModeActive: () => safeModeActive,
      autoSyncAllowed,
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(mainWindowDeps());
    });
  });
}

// 退出前同步（261013：interval 也做一次，manual 不做）；任何模式只要同步在途都等它完成再退
// （否则可能停在"对象已传、manifest 未写"的中间态）。
let quittingForSync = false;
app.on("before-quit", (event) => {
  log.app.info("[quit] before-quit" + formatLogFields({ upMs: Date.now() - BOOT_STARTED_AT }));
  if (forceQuit || quittingForSync || !store || !quickNotes) return;
  // 小记库降级 ⇒ 同步会被前置断言拦住；退出路径不再补一次（否则每次退出都记一条失败）。
  if (getQuickNotesAvailability().mode === "degraded") return;
  // Batch3-B：安全模式 = 不自动同步（含退出前这一次）；用户手动同步过才由用户自己决定下次动作。
  if (safeModeActive) return;
  const cfg = store.getSyncSettings();
  if (!cfg.enabled) return;
  if (syncInFlight) {
    event.preventDefault();
    quitAfterSync = true;
    scheduleQuitDeadline();
    return;
  }
  if (shouldSyncOnOpenClose(cfg)) {
    event.preventDefault();
    quittingForSync = true;
    scheduleQuitDeadline();
    void runFullSync().finally(() => {
      clearQuitDeadline();
      app.quit();
    });
  }
});

app.on("will-quit", () => {
  log.app.info("[quit] will-quit" + formatLogFields({ upMs: Date.now() - BOOT_STARTED_AT }));
  // 261105 P2-B：正常退出 ⇒ 记「上次 OK」（下次启动走轻量检查）；恢复模式退出不写，保持 dirty ⇒ 下次深检。
  if (normalStartupCompleted) {
    try { markStartupClean(app.getPath("userData")); } catch { /* 写标记失败不影响退出 */ }
  }
  // Best-effort checkpoint after any onOpenClose sync has settled. This keeps
  // the metadata DB/WAL bounded without making shutdown depend on it.
  try { store?.checkpointWal(); } catch { /* app is already exiting */ }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
