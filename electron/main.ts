import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, nativeTheme, powerMonitor, screen, session, shell, type IpcMainEvent, type WebFrameMain } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { FILE_RECONCILE_DEFAULTS, FileMetadataReconciler } from "./fileMetadataReconcile.js";
import { canTouchNetwork, cloudStateOf } from "../src/core/cloudState.js";
import { autoSyncIntervalMs, shouldSyncOnOpenClose } from "../src/core/syncModes.js";
import { historyFallbackMinutes, shouldRunHistoryFallback } from "../src/core/historyFallbackPolicy.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { createUnavailableQuickNotesStore, QuickNotesStore } from "./quickNotes.js";
import { migrateNoteTagLinksToQuickNotes } from "./tagStorage.js";
import {
  decideQuickNotesAvailability,
  getQuickNotesAvailability,
  quickNotesDegradedMessage,
  setQuickNotesAvailability,
} from "./quickNotesAvailability.js";
import { startAssetServer, ASSET_PORT } from "./assetServer.js";
import { createWebServerController, type WebServerController, WEB_API_PORT } from "./webApiServer.js";
import { resolveMirroredCdnRedirect, scanMirroredCdnFiles } from "./cdnRedirect.js";
import type { SyncResult, SyncProgress } from "./syncTypes.js";
import { syncNowViaEngine } from "./syncEngineController.js";
import { initLogger, currentLogLevels, log, logHeapPeak, logStartupInfo } from "./logger.js";
import { isLevelEnabled } from "./logLevels.js";
import { mapRendererConsoleLevel } from "./rendererLogLevel.js";
import { errorFields, formatLogFields, perfMessage } from "../src/core/logFormat.js";
import { ConsoleNoiseFilter } from "./consoleNoise.js";
import { setQuickNotesStoreForV3 } from "./s3v3/quickNotesRegistry.js";
import { readSyncErrorInfo } from "./s3v3/syncErrorInfo.js";
import { readDevS3Settings } from "./devConfig.js";
import { installNativeSha256 } from "./sha256Native.js";
import { prepareCloudRestore, readAndRemoveS3RestoreSeed } from "./workspaceBackup.js";
import {
  backupDatabaseForRecovery,
  decideStartupCheckDepth,
  decideStartupRecovery,
  inspectDatabaseForStartup,
  markStartupClean,
  markStartupInProgress,
  readCrashMarker,
  readStartupRunHealth,
  removeCrashMarker,
  writeCrashMarker,
} from "./startupRecovery.js";
import { showRecoveryWindow } from "./startupRecoveryWindow.js";
import { rememberRestoreCandidate, restoreMainDatabaseFromBackup } from "./workspaceRestoreFromBackup.js";
import { decideSafeMode, readSafeModeState, removeSafeModeState, writeSafeModeState, type SafeModeState } from "./safeMode.js";
import { registerSafeModeIpc } from "./ipc/registerSafeMode.js";
import { registerDataRecoveryIpc } from "./ipc/registerDataRecovery.js";
import { registerSyncConflictIpc } from "./ipc/registerSyncConflictIpc.js";
import { registerBackupIpc, type BackupIpcRunner } from "./ipc/registerBackupIpc.js";
import { registerDiaryIpc } from "./ipc/registerDiary.js";
import { AUTO_BACKUP_TICK_MS, decideAutoBackup, readDatabaseFingerprint, runBackupCycle } from "./autoBackup.js";
import { createIpcRegistrar } from "./ipc/registrar.js";
import { UpdateService } from "./update/updateService.js";
import { pickBackupDatabaseDialog, registerNotesIpc } from "./ipc/registerNotes.js";
import { registerBatchNotesIpc } from "./ipc/registerBatchNotes.js";
import { registerDuplicateNotesIpc } from "./ipc/registerDuplicateNotes.js";
import { registerMarkdownImportIpc } from "./ipc/registerMarkdownImport.js";
import { registerBatchExportIpc } from "./ipc/registerBatchExport.js";
import { DraftJournal, draftJournalDir } from "./draftJournal.js";
import { registerHistoryIpc } from "./ipc/registerHistory.js";
import { registerWebIpc } from "./ipc/registerWeb.js";
import { registerSyncIpc } from "./ipc/registerSync.js";
import { registerQuickNotesIpc } from "./ipc/registerQuickNotes.js";
import { registerLogIpc } from "./ipc/registerLogIpc.js";
import { registerAiIpc } from "./ipc/registerAi.js";
import { registerAiWritingIpc } from "./ipc/registerAiWriting.js";
import { registerSystemInfoIpc } from "./ipc/registerSystemInfo.js";
import { registerUpdateIpc } from "./ipc/registerUpdate.js";
import { registerPortableIpc } from "./ipc/registerPortable.js";
import { portableExportAvailability, portableExportCloudActive, type PortableExportAvailability, type PortableExportProgress } from "../src/core/portable/portableFormat.js";
import { clampWindowState, readWindowState, writeWindowState } from "./windowState.js";
import { TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "../src/lib/layoutMetrics.js";
import { APP_ORIGIN, isAppOriginUrl } from "./appOrigin.js";
import { registerAppSchemePrivileges, serveAppDist } from "./appProtocol.js";
import { buildAppMenuTemplate } from "./appMenu.js";
import { installTestDialogHooks } from "./testDialogHooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
/** 产品显示名（macOS 菜单/关于面板；与 package.json productName 一致）。 */
const APP_DISPLAY_NAME = "LakexLocalNotes";
/** 项目主页（帮助菜单：使用文档 / 反馈问题）。 */
const PROJECT_URL = "https://github.com/gtycoder/lakex-local-notes";
/** 主窗口引用（macOS 菜单「设置…」需要给渲染层发事件；单窗口应用，关窗即清空）。 */
let mainWindow: BrowserWindow | null = null;

/** 启动遮罩窗口：在主进程初始化 + 渲染层加载期间先显示 logo，避免主窗口白屏。 */
let bootWindow: BrowserWindow | null = null;

// userData 隔离（必须在 app ready 前设置）：
// - dev 默认 lakex-local-notes-dev（空库+种子），打包版默认 lakex-local-notes（正式数据）；
// - 两者路径不同、单实例锁各自独立，可同时运行。
// - 任意模式可用 LAKE_USER_DATA 覆盖：dev 模拟多「设备」，打包版隔离测试（避免触碰正式数据）。
const userDataOverride = process.env.LAKE_USER_DATA?.trim();
app.setPath(
  "userData",
  userDataOverride ||
    (isDev
      ? path.join(app.getPath("appData"), "lakex-local-notes-dev")
      : path.join(app.getPath("appData"), "lakex-local-notes")),
);
// dev server 地址可经 LAKE_DEV_SERVER_URL 覆盖：多端/隔离冒烟时避开默认 1421（IPC 信任判定同用此值）。
const DEV_SERVER_URL = process.env.LAKE_DEV_SERVER_URL?.trim() || "http://127.0.0.1:1421";
/**
 * 渲染层加载方式（对齐 DSH 桌面壳：不打 file://）：
 * - `vite`：dev 默认走 vite dev server（保留 HMR；LAKE_DEV_SERVER_URL 可覆盖）；
 * - `scheme`：打包版走私有协议 lakexlocalnotes://app（服务构建产物 dist/）。dev 下亦可用
 *   LAKE_RENDERER=scheme 强制走这条路径（需先 vite build），用于本机验证该分支。
 */
const rendererMode: "vite" | "scheme" = !isDev || process.env.LAKE_RENDERER?.trim() === "scheme" ? "scheme" : "vite";

/** 渲染层构建产物目录：私有协议静态服务与 Web 客户端共用同一份 dist。 */
function rendererDistDir(): string {
  return path.join(__dirname, "..", "dist");
}

// 私有协议必须在 app ready 之前注册（Electron 要求）。
registerAppSchemePrivileges();

// CORE-06：桌面进程内 SHA-256 走 node:crypto（core 默认纯 JS）。必须在任何正文/资产
// hash 计算（同步、索引、历史）之前注入 —— 放在 app ready 之前的模块初始化段。
installNativeSha256();
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
  if (syncInFlight) throw new Error("同步正在进行中，请等待本次同步完成");
  syncInFlight = true;
  // 断点续传标记：开始即置位，成功结束才清（中断/被杀/断网时残留，下次启动自动续）。
  try { store.markSyncInterrupted(new Date().toISOString()); } catch { /* 状态表异常不阻断同步 */ }
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
      store.recordSyncResult(JSON.stringify(result));
      // 验收发现（261028）：v3 路径只写了 last_sync_result，从没写过 last_synced_at ⇒
      // 同步浮窗/状态栏的「上次同步」一直是旧值（新机器上则永远为空）。两条都写。
      try { store.markSyncComplete(result.completedAt ?? new Date().toISOString()); } catch { /* 状态表异常不阻断同步 */ }
      try { store.clearSyncInterrupted(); } catch { /* 同上 */ }
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

/** 应用自身页面的 URL 判定：dev = 固定 dev server；prod = 打包 dist/index.html */
function isAppPageUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  // 私有协议：只信任 lakexlocalnotes://app 自己的页面（该 origin 下只有 dist 产物，无第三方内容）。
  // 判定走 isAppOriginUrl（比 scheme+host）——非特殊 scheme 在 Node 里 URL.origin 恒为 "null"。
  if (rendererMode === "scheme") return isAppOriginUrl(url);
  return parsed.origin === DEV_SERVER_URL;
}

function workspaceRoot(): string {
  return path.join(app.getPath("userData"), "workspace-default");
}

/** Lake 编辑器 CDN 资源本地镜像（public/vendor/cdn → dist/vendor/cdn） */
function vendorCdnDir(): string {
  return path.join(__dirname, "..", isDev ? "public" : "dist", "vendor", "cdn");
}

/**
 * 资源本地化只接管已随应用镜像的 Lake 运行时资源。gw.alipayobjects.com 同时
 * 承载用户粘贴图片，若按 host 全量重定向，未镜像的 /zos/skylark/... 会变成本地 404。
 */
function registerCdnRedirect() {
  // W-5：镜像清单启动时一次性读入内存（目录随包固定），回调内零 I/O。
  const mirrored = scanMirroredCdnFiles(vendorCdnDir());
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://gw.alipayobjects.com/*"] },
    (details, callback) => {
      const redirectURL = resolveMirroredCdnRedirect(details.url, ASSET_PORT, (relativePath) => mirrored.has(relativePath));
      // 未镜像的资源保持原请求：例如用户粘贴的 gw /zos/skylark 图片。
      callback(redirectURL ? { redirectURL } : {});
    }
  );
}

/**
 * Lake 会为部分图片预加载请求临时追加 `crossOrigin=true`，不会保留正文中的
 * 查询参数。主进程在受信任窗口发出的本地资源请求上补回当前启动 token，
 * 这样既保持正文 URL 稳定，又不让 CORS 预加载被资源服务器拒绝。
 */
function registerAssetTokenRedirect() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`http://127.0.0.1:${ASSET_PORT}/*`] },
    (details, callback) => {
      if (details.webContentsId === undefined || !trustedWebContents.has(details.webContentsId)) {
        callback({});
        return;
      }
      try {
        const url = new URL(details.url);
        if (url.searchParams.get("token") !== assetToken) {
          url.searchParams.set("token", assetToken);
          callback({ redirectURL: url.toString() });
          return;
        }
      } catch {
        // 非法 URL 交给资源服务器按原有规则处理。
      }
      callback({});
    },
  );
}


/**
 * 思源式 boot 窗口：主进程一启动就显示本地 HTML（内嵌 APNG），
 * 主窗口保持 show:false，等渲染层首帧信号后再显示并销毁 boot 窗口。
 */
function createBootWindow() {
  if (bootWindow && !bootWindow.isDestroyed()) return;
  const windowStatePath = path.join(app.getPath("userData"), "window-state.json");
  const workArea = screen.getPrimaryDisplay().workArea;
  const restored = clampWindowState(readWindowState(windowStatePath), workArea);
  const boot = new BrowserWindow({
    x: restored.x,
    y: restored.y,
    width: restored.width,
    height: restored.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    title: "LakexLocalNotes",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e2126" : "#f3f4f6",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bootWindow = boot;
  if (restored.maximized) boot.maximize();
  if (restored.fullscreen) boot.setFullScreen(true);
  boot.once("ready-to-show", () => {
    if (boot.isDestroyed()) return;
    boot.show();
    log.app.info("[boot] splash shown");
  });
  boot.on("closed", () => {
    if (bootWindow === boot) bootWindow = null;
  });
  void boot.loadFile(path.join(__dirname, "../electron/boot.html")).catch((error) => {
    log.app.warn(`[boot] splash load failed: ${(error as Error).message}`);
    if (!boot.isDestroyed()) boot.destroy();
    if (bootWindow === boot) bootWindow = null;
  });
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

async function createWindow() {
  // macOS 关窗后从 Dock 重开时也要先有 boot 窗口，否则主窗口会隐藏到 renderer-ready 才出现。
  if (!bootWindow || bootWindow.isDestroyed()) createBootWindow();
  const windowStatePath = path.join(app.getPath("userData"), "window-state.json");
  const workArea = screen.getPrimaryDisplay().workArea;
  const restored = clampWindowState(readWindowState(windowStatePath), workArea);
  const win = new BrowserWindow({
    x: restored.x,
    y: restored.y,
    width: restored.width,
    height: restored.height,
    minWidth: 560,
    minHeight: 480,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // 红绿灯垂直居中到「可见头区」中心：y + 直径/2 = (TOPBAR_HEIGHT + TOPBAR_SEAM)/2。
    // **别再把 y 写成常数**：曾因顶栏 38→32 而红绿灯没跟、中心错位 3px（用户 260923 报）。
    // 头区高单一来源 = src/lib/layoutMetrics.ts 的 TOPBAR_HEIGHT + TOPBAR_SEAM（与 CSS 有单测对齐）。
    trafficLightPosition: { x: 14, y: (TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2 },
    webPreferences: {
      // 打包版直接指向 app.asar.unpacked 里的真实文件（asar 内 preload 在 Electron 33 有解析 Bug）
      preload: app.isPackaged
        ? path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")
        : path.join(__dirname, "../electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 260923：preload 已在 package.json 的 build.asarUnpack 中（asar 内沙箱 preload 的旧 Bug 不适用）；
      // 开渲染进程沙箱 = OS 级纵深防御，contextIsolation 仍开启。
      sandbox: true,
      // PDF 内联预览：plugins 默认 false（electron.d.ts 注释确认）会禁用 <embed> 插件渲染
      // → PDF viewer 空白（实测）。plugins: true 启用 Chromium PDF viewer。
      plugins: true,
    },
  });

  mainWindow = win;
  let mainWindowRevealed = false;
  let bootFallback: NodeJS.Timeout | null = null;
  const revealMainWindow = (reason: string) => {
    if (mainWindowRevealed || win.isDestroyed()) return;
    mainWindowRevealed = true;
    if (bootFallback) { clearTimeout(bootFallback); bootFallback = null; }
    if (bootWindow && !bootWindow.isDestroyed()) bootWindow.destroy();
    bootWindow = null;
    win.show();
    win.focus();
    log.app.info(`[boot] main window shown (${reason})`);
    log.perf.info(perfMessage("boot.ready", Date.now() - BOOT_STARTED_AT, { reason }));
  };
  /** macOS 原生全屏（独立 Space）时系统把标题栏/红绿灯一起隐藏 ⇒ 把全屏状态广播给渲染层，
   *  让顶栏不再为红绿灯让位（避免左侧 82px 空缺口）。 */
  const sendWindowFullscreen = () => {
    if (!win.isDestroyed()) win.webContents.send("window-fullscreen", win.isFullScreen());
  };
  const onRendererReady = (event: IpcMainEvent) => {
    if (event.sender.id !== win.webContents.id) return;
    revealMainWindow("renderer-ready");
    // 启动即全屏（从 window-state 恢复）时，渲染层靠这条拿到初始态
    sendWindowFullscreen();
  };
  ipcMain.on("renderer-ready", onRendererReady);
  bootFallback = setTimeout(() => revealMainWindow("fallback-timeout"), 8_000);
  win.once("closed", () => {
    if (mainWindow === win) mainWindow = null;
    if (bootFallback) { clearTimeout(bootFallback); bootFallback = null; }
    ipcMain.removeListener("renderer-ready", onRendererReady);
    if (bootWindow && !bootWindow.isDestroyed()) bootWindow.destroy();
    bootWindow = null;
  });

  const persistWindowState = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    writeWindowState(windowStatePath, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
    });
  };
  win.on("resize", persistWindowState);
  win.on("move", persistWindowState);
  win.on("maximize", persistWindowState);
  win.on("unmaximize", persistWindowState);
  win.on("enter-full-screen", () => { persistWindowState(); sendWindowFullscreen(); });
  win.on("leave-full-screen", () => { persistWindowState(); sendWindowFullscreen(); });
  win.on("close", persistWindowState);
  if (restored.maximized) win.maximize();
  if (restored.fullscreen) win.setFullScreen(true);

  // 审计 #6：窗口导航与 window.open 全部受控——阻止导航到应用页之外的任何地址；
  // 外链（http/https）交给系统浏览器打开，绝不进入应用窗口
  trustedWebContents.add(win.webContents.id);
  // 渲染进程日志统一落盘：console-message 转发到主进程 logger（scope=renderer）。
  // CSP 拦截通知折叠（261023）：粘贴整页网页时内核会为每张远程图各打一条通知（实测 103 行），
  // 逐条落盘会把同期真正需要的日志冲掉 ⇒ 折叠成一行汇总（consoleNoise.ts，排查见 TROUBLESHOOTING §M）。
  const consoleNoise = new ConsoleNoiseFilter({ emit: (line) => log.renderer.info(line) });
  win.on("closed", () => consoleNoise.flush());
  // Electron 33 事件签名：event 对象带 { level, message, lineNumber, sourceId }；
  // 同时兼容旧式 (event, level, message) 回调。
  win.webContents.on("console-message" as unknown as "console-message", (event: unknown, ...args: unknown[]) => {
    const e = event as { message?: unknown };
    const msg = typeof e?.message === "string"
      ? e.message
      : typeof args[1] === "string" ? args[1] : String(args[1] ?? "");
    if (!msg) return;
    // 过滤 DevTools 样式占位与空消息
    if (msg.includes("%c") || msg.length > 4000) return;
    if (consoleNoise.observe(msg)) return;
    // 级别映射（261023）：渲染层 error/warn 不能被压成 info；正式环境 debug 不落盘，避免调试噪音把日志冲掉。
    const rendererLevel = mapRendererConsoleLevel(event as { level?: unknown }, args);
    if (!isLevelEnabled(currentLogLevels().renderer, rendererLevel)) return;
    if (rendererLevel === "error") log.renderer.error(msg);
    else if (rendererLevel === "warn") log.renderer.warn(msg);
    else if (rendererLevel === "debug") log.renderer.debug(msg);
    else log.renderer.info(msg);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppPageUrl(url)) return;
    event.preventDefault();
    log.app.warn("[security] 阻止窗口导航" + formatLogFields({ url }));
  });
  win.webContents.on("destroyed", () => { trustedWebContents.delete(win.webContents.id); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch { /* 非法 URL 忽略 */ }
    return { action: "deny" };
  });

  // 崩溃自动恢复：渲染进程异常退出（非 clean-exit）短暂延迟后 reload；
  // 30s 内连续崩溃超过 3 次则停止自动恢复（避免崩溃循环），留档待查。
  let rendererCrashCount = 0;
  let lastRendererCrashAt = 0;
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const now = Date.now();
    if (now - lastRendererCrashAt > 30_000) rendererCrashCount = 0;
    lastRendererCrashAt = now;
    rendererCrashCount += 1;
    log.app.warn(`[crash] render-process-gone reason=${details.reason} exitCode=${details.exitCode} count=${rendererCrashCount}`);
    if (rendererCrashCount > 3) {
      log.app.error("[crash] 连续崩溃超过 3 次，停止自动恢复，请检查日志/Crashpad 转储");
      return;
    }
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.webContents.reload(); } catch { /* 窗口已销毁 */ }
    }, 800);
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.app.error("[crash] preload-error" + formatLogFields({ path: preloadPath, ...errorFields(error) }));
  });
  win.on("unresponsive", () => log.app.warn("[ui] 窗口无响应（unresponsive）"));
  win.on("responsive", () => log.app.info("[ui] 窗口恢复响应（responsive）"));

  if (rendererMode === "scheme") {
    await win.loadURL(`${APP_ORIGIN}/index.html`);
  } else {
    await win.loadURL(DEV_SERVER_URL);
  }
}

/** IPC 只接受本应用窗口（精确 URL + webContents 白名单）发来的调用。
 * 审计 #6：不再信任任意 file://、任意 localhost 端口、devtools://、about:blank——
 * 页面被导航到恶意本地页后 preload 暴露的全量能力即失效。 */
function isTrustedSenderFrame(frame: WebFrameMain | null, sender: Electron.WebContents): boolean {
  if (!frame) return false;
  if (!trustedWebContents.has(sender.id)) return false;
  return isAppPageUrl(frame.url);
}

/** 便携包导出入口可用性（单一判据在 core/portableFormat；这里只喂同步状态）。 */
function portableIpcAvailability(): PortableExportAvailability {
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

/** 便携包导出进度（窗口 + Web 客户端 SSE）。 */
function broadcastPortableProgress(progress: PortableExportProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!trustedWebContents.has(win.webContents.id)) continue;
    try { win.webContents.send("portable-export-progress", progress); } catch { /* 窗口已关闭 */ }
  }
  webServerController?.broadcast("portable-export-progress", progress);
}

function registerIpc(): ReadonlyMap<string, (args: unknown[]) => Promise<unknown>> {
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
          if (!trustedWebContents.has(win.webContents.id)) continue;
          try { win.webContents.send("library-changed", { channel }); } catch { /* 窗口已关闭 */ }
        }
        webServerController?.broadcast("library-changed", { channel });
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
      webServerController?.broadcast("pending-summary-changed", summary);
    } catch { /* store 未就绪（早期调用）忽略 */ }
  };
  const ipc = createIpcRegistrar((event) => {
    if (!isTrustedSenderFrame(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
  }, afterInvoke, (channel, payload) => {
    // HTTP 调用方（浏览器端）没有 Electron 窗口：handleEvent 的 send 统一转到 SSE 广播
    //（sync-progress / ai:stream 等），否则浏览器端收不到流式与进度。
    webServerController?.broadcast(channel, payload);
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
  registerNotesIpc(ipc, store, quickNotes, drafts, workspaceRoot(), (targetRoot) => {
    // A1 一致性快照：主库 + 小记库各经其连接 VACUUM INTO（单文件、可独立打开）
    const mainTarget = path.join(targetRoot, "metadata.sqlite3");
    store.backupDatabaseTo(mainTarget);
    const quickDir = path.join(targetRoot, "quick-notes");
    fs.mkdirSync(quickDir, { recursive: true });
    quickNotes.backupDatabaseTo(path.join(quickDir, "metadata.sqlite3"));
  }, enqueueMaintenance);
  // 261109 日记：幂等打开某天（判据/单事务在 electron/diaryStore.ts；通道见 docs/DIARY.md）。
  registerDiaryIpc(ipc, { openDate: (dateKey) => store.openDiaryDate(dateKey) });
  registerHistoryIpc(ipc, store, () => restartHistoryTimers?.());
  registerAiIpc(ipc, store);
  registerAiWritingIpc(ipc, store);
  registerWebIpc(ipc, () => webServerController);
  registerSyncIpc(ipc, {
    store,
    quickNotes,
    // 小记库降级时在「设置→同步诊断」顶部给一条可读告警（复用既有 S3v3DiagnosticReport 通道）。
    quickNotesAvailability: () => getQuickNotesAvailability(),
    runFullSync,
    enqueueMaintenance,
    broadcastSyncProgress,
    restartGcTimers: () => restartGcTimers?.(),
    restartSyncTimers: () => restartSyncTimers?.(),
  });
  registerQuickNotesIpc(ipc, quickNotes, store, enqueueMaintenance);
  registerLogIpc(ipc);
  registerSystemInfoIpc(ipc, { store, quickNotes, workspaceRoot });
  // Batch3-B：安全模式三件事（读状态 / 复制诊断 / 显式退出）。通道登记见 electron/ipc/ipcChannelParity.test.ts。
  registerSafeModeIpc(ipc, {
    userDataDir: app.getPath("userData"),
    logPath: path.join(app.getPath("userData"), "logs", "lakex-local-notes.log"),
    appVersion: app.getVersion(),
    platform: process.platform,
    state: () => safeModeState,
    onExit: () => { safeModeActive = false; safeModeState = null; },
  });
  // 261105 Batch4-D：低频扫描设置（0=关闭）+ 手动「重建数据」候选/执行（只允许本次扫描候选）。
  registerDataRecoveryIpc(ipc, {
    store,
    workspaceRoot: workspaceRoot(),
    onFileScanSettingsChanged: () => restartFileScanReconciler?.(),
  });
  // 261105 Batch4-E：自动备份（配置/状态读取 + 保存 + 立即备份 + 只读占用统计）；备份实现见 whenReady 里的调度器。
  registerBackupIpc(ipc, {
    // 占用统计只读 stat <userData>/backups（与调度器同一个 backupsDir/轮转口径）。
    userDataDir: app.getPath("userData"),
    runner: {
      getSettings: () => autoBackupRunner?.getSettings() ?? store.getAutoBackupSettings(),
      getState: () => autoBackupRunner?.getState() ?? store.getAutoBackupState(),
      saveSettings: (settings) => (autoBackupRunner ?? {
        saveSettings: (value: typeof settings) => store.saveAutoBackupSettings(value),
      }).saveSettings(settings),
      runNow: () => autoBackupRunner?.runNow() ?? Promise.resolve({ state: store.getAutoBackupState(), message: "备份服务未就绪" }),
    },
  });
  // 261105 P1 第 4 项：同步记录账本（设备本地；列表/标已读/恢复动作）。
  registerSyncConflictIpc(ipc, { store, quickNotes });
  // 261109 桌面更新中心（读状态/检查/下载/打开安装包/打开下载页/读写设置/忽略版本）。
  if (!updateService) throw new Error("更新服务未装配");
  registerUpdateIpc(ipc, { service: updateService });
  // 261109 桌面 → 手机便携包（docs/PORTABLE-TRANSFER.md）：云开启 + 上轮同步成功 + 无待同步才可用。
  registerPortableIpc(ipc, {
    workspaceRoot: () => workspaceRoot(),
    appVersion: () => app.getVersion(),
    snapshotDatabases: (targetRoot) => {
      // 与 A1 整库备份同一套一致性快照口径（VACUUM INTO；独立于运行中的 WAL）。
      store.backupDatabaseTo(path.join(targetRoot, "metadata.sqlite3"));
      const quickDir = path.join(targetRoot, "quick-notes");
      fs.mkdirSync(quickDir, { recursive: true });
      quickNotes.backupDatabaseTo(path.join(quickDir, "metadata.sqlite3"));
    },
    availability: portableIpcAvailability,
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
    beforeExport: () => runFullSync(broadcastSyncProgress),
    counts: () => {
      const overview = store.getStorageOverview();
      let quickNotesCount = 0;
      let tagsCount = 0;
      try { quickNotesCount = quickNotes.countQuickNotes(); } catch { quickNotesCount = 0; }
      try { tagsCount = quickNotes.tagService.list().length; } catch { tagsCount = 0; }
      return { folders: overview.notebooks + overview.groups, quickNotes: quickNotesCount, tags: tagsCount };
    },
    broadcastProgress: (progress) => broadcastPortableProgress(progress),
  });
  return ipc.registry;
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

  app.whenReady().then(() => {
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
    const userDataDir = app.getPath("userData");
    // 崩溃标记必须在任何启动动作之前读：上次运行留下未捕获异常时，本次启动（含恢复页）要能提示。
    installCrashLogging(userDataDir);
    createBootWindow();
    logStartupInfo();
    log.app.info("app ready: initLogger done" + formatLogFields({ bootMs: Date.now() - BOOT_STARTED_AT }));
    // P1-5：**先做完整性预检，再建 Store**。坏库/打不开时不再继续普通启动
    //（旧实现先构造 Store 再弹阻塞式 dialog，Store 构造抛错时会直接卡死在 boot splash）。
    const crashMarker = readCrashMarker(userDataDir);
    if (crashMarker) {
      log.app.warn("[crash] 上次运行捕获到未捕获异常" + formatLogFields({ time: crashMarker.time, occurrences: crashMarker.occurrences, reason: crashMarker.reason }));
    }
    // Batch3-B：崩溃反复出现（occurrences>=2 或 30 分钟内连续 2 次）⇒ 本次进安全模式：
    // 不自动同步 / 不恢复上次标签页 / 不预热内核；主界面照常可用可编辑（语义见 electron/safeMode.ts）。
    const safeModeDecision = decideSafeMode({ previous: readSafeModeState(userDataDir), crashMarker, now: new Date() });
    safeModeActive = safeModeDecision.active;
    safeModeState = safeModeDecision.active ? safeModeDecision.state : null;
    if (safeModeDecision.active) {
      writeSafeModeState(userDataDir, safeModeDecision.state);
      log.app.warn("[safe-mode] 本次启动进入安全模式（不自动同步/不恢复标签页/不预热内核）"
        + formatLogFields({ reason: safeModeDecision.reason, occurrences: crashMarker?.occurrences ?? 0 }));
    }
    // 261105 P2-B：条件深检（只读打开）。上次正常退出且无 crash-marker ⇒ 轻量检查（只读打开 + 关键表）；
    // 上次脏退出/有崩溃标记 ⇒ 才跑全库 quick_check + foreign_key_check。
    // 启动开始即标 dirty：进程在本次启动/运行中崩溃 ⇒ 下次自动深检；正常退出才写「上次 OK」。
    const previousRun = readStartupRunHealth(userDataDir);
    markStartupInProgress(userDataDir);
    const startupCheckDepth = decideStartupCheckDepth({ crashMarker, previousRun });
    log.app.info("[store] 启动预检深度=" + startupCheckDepth + formatLogFields({ previousRun: previousRun?.lastRun ?? "unknown", crashMarker: !!crashMarker }));
    const startupIntegrity = inspectDatabaseForStartup(path.join(workspaceRoot(), "metadata.sqlite3"), { deep: startupCheckDepth === "deep" });
    let startupOpenError: unknown = null;
    let openedStore: Store | null = null;
    if (startupIntegrity.ok) {
      try {
        openedStore = new Store(workspaceRoot(), createSafeStorageSecretCipher(), log);
      } catch (error) {
        startupOpenError = error;
        log.app.error("[store] 打开本地数据库失败" + formatLogFields(errorFields(error)));
      }
    } else {
      log.app.error("[store] 启动完整性预检未通过" + formatLogFields({ detail: startupIntegrity.detail }));
    }
    const startupDecision = decideStartupRecovery({ integrity: startupIntegrity, openError: startupOpenError, crashMarker });
    if (startupDecision.mode === "recovery" || !openedStore) {
      // 恢复模式：销毁 splash，换成一个可操作的最小恢复页（备份后重试 / 云端恢复 / 打开目录 / 退出）。
      log.app.error("[store] 进入启动恢复模式" + formatLogFields({ cause: startupDecision.cause, detail: startupDecision.detail }));
      if (bootWindow && !bootWindow.isDestroyed()) bootWindow.destroy();
      bootWindow = null;
      showRecoveryWindow({
        reason: startupDecision.reason || "无法打开本地数据库",
        detail: startupDecision.detail,
        dataDir: userDataDir,
        workspacePath: workspaceRoot(),
        logPath: path.join(userDataDir, "logs", "lakex-local-notes.log"),
        // P2-B：与自动备份同一目录口径（<userData>/backups/），恢复页不再展示另一个目录。
        backupDir: path.join(userDataDir, "backups"),
        crashMarker: startupDecision.crashMarker,
      }, {
        async backupAndRetry() {
          const backup = backupDatabaseForRecovery({ dbPath: path.join(workspaceRoot(), "metadata.sqlite3"), userDataDir });
          if (!backup.ok) return { ok: false, message: backup.message };
          // 备份成功后**重试打开**（完整走一次 Store 构造/迁移）；成功后重启走正常启动路径。
          try {
            const probe = new Store(workspaceRoot(), createSafeStorageSecretCipher(), log);
            probe.close();
          } catch (error) {
            log.app.error("[recovery] 备份后重试打开仍失败" + formatLogFields(errorFields(error)));
            return { ok: false, message: backup.message + "；但重试打开仍失败：" + (error instanceof Error ? error.message : String(error)) };
          }
          return { ok: true, message: backup.message + "；重试打开通过，正在重启…", restart: true };
        },
        async cloudRestore() {
          try {
            // 复用 A2：把当前 workspace 改名隔离保留 → 空库重启。坏库读不到 S3 凭据，重启后需重新配置。
            const { quarantinePath } = prepareCloudRestore(workspaceRoot());
            log.app.info("[recovery] 云端恢复：原数据已隔离到 " + quarantinePath);
            return {
              ok: true,
              message: "原数据已隔离保留在 " + quarantinePath + "，将以全新空库重启；重启后需在设置里重新配置云同步，再从云端拉回。正在重启…",
              restart: true,
            };
          } catch (error) {
            log.app.error("[recovery] 云端恢复准备失败" + formatLogFields(errorFields(error)));
            return { ok: false, message: "云端恢复准备失败：" + (error instanceof Error ? error.message : String(error)) };
          }
        },
        async restoreFromBackup() {
          // Batch4-A：从整库备份导入恢复。文件选择框在主进程（渲染层拿不到任意路径），
          // defaultPath 与设置入口共用同一个选择框（autoBackup.backupsDir 单一来源）。
          const chosen = await pickBackupDatabaseDialog(userDataDir, { buttonLabel: "用此备份恢复" });
          if (!chosen) return { ok: false, message: "已取消选择备份文件" };
          if (!rememberRestoreCandidate(chosen)) {
            return { ok: false, message: "备份文件无效：请选择由本应用「整库备份/导出」产生的 metadata*.sqlite3 文件（其他文件名不支持）" };
          }
          const result = restoreMainDatabaseFromBackup({
            backupPath: chosen,
            currentDbPath: path.join(workspaceRoot(), "metadata.sqlite3"),
            userDataDir,
          });
          if (!result.ok) {
            log.app.error("[recovery] 从备份恢复失败" + formatLogFields({ reason: result.reason ?? "", rolledBack: result.rolledBack ?? false }));
            return { ok: false, message: "从备份恢复失败：" + (result.message ?? result.reason ?? "未知原因") };
          }
          log.app.info("[recovery] 从备份恢复成功，原库隔离到 " + result.quarantinePath);
          return { ok: true, message: result.message ?? "已从备份恢复，正在重启…", restart: true };
        },
        async openDataFolder() {
          const openError = await shell.openPath(userDataDir);
          return openError
            ? { ok: false, message: "打开数据目录失败：" + openError }
            : { ok: true, message: "已打开数据目录：" + userDataDir };
        },
        restart() { app.relaunch(); app.exit(0); },
        quit() { app.quit(); },
      });
      return;
    }
    // 正常启动判定完成；崩溃标记等**启动真正跑通**（建主窗口前）再消费，避免半途失败时丢掉线索。
    store = openedStore;
    // Batch4-B/D（261105）：文件↔元数据对账 = **低频只报告**（默认每 24h，设置里可改、0 = 关闭）。
    // 仍由同步成功打点 + 进程空闲（≥5min）门控，与同步/GC 共用维护域串行队列；报告经 runDataHealthCheck 暴露。
    // 旧环境变量保留：LAKE_FILE_RECONCILE=0 强制关闭（=1 是历史开关，语义等同使用设置里的间隔）。
    const startFileReconciler = () => {
      fileReconciler?.dispose();
      const configured = store.getFileScanSettings().intervalHours;
      const enabledByEnv = process.env.LAKE_FILE_RECONCILE !== "0";
      const intervalHours = enabledByEnv ? configured : 0;
      const enabled = intervalHours > 0;
      fileReconciler = new FileMetadataReconciler({
        root: workspaceRoot(),
        listKnownNoteIds: () => store.listNotesSyncMeta().map((n) => n.id),
        getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
        enqueueMaintenance,
        enabled,
        intervalHours,
        cooldownMs: intervalHours > 0 ? Math.max(1, intervalHours * 3600_000) : FILE_RECONCILE_DEFAULTS.cooldownMs,
        // P2-B：上次成功扫描时间跨重启持久化（settings；缺失/损坏按未跑过）。
        loadLastRunAt: () => store.getFileReconcileState().lastScanAt,
        saveLastRunAt: (at) => store.saveFileReconcileState({ lastScanAt: at }),
        log: (message) => log.app.info(message),
      });
      store.setFileReconcileReportProvider(() => fileReconciler?.getLastReport() ?? null);
      log.app.info("[reconcile] 文件↔元数据对账" + (enabled ? "已启用（间隔 " + intervalHours + "h，只报告）" : "已关闭（0h / LAKE_FILE_RECONCILE=0）"));
    };
    startFileReconciler();
    restartFileScanReconciler = startFileReconciler;
    // A2 云端恢复（换机/坏库）：重启后若存在恢复 seed（prepareCloudRestore 写入的 settings 密文行），
    // 原样写回新库再删除——secretAccessKey 保持 enc:v1: 密文（绝不明文落盘），同机 safeStorage 可解。
    try {
      const seed = readAndRemoveS3RestoreSeed(workspaceRoot());
      if (seed && typeof seed === "string" && !store.getS3Settings()) {
        store.importS3SettingsRow(seed);
        log.app.info("[restore] S3 凭据（密文行）已从恢复 seed 回填新库");
      }
    } catch (e) { log.app.warn(`[restore] S3 seed 回填失败: ${(e as Error).message}`); }
    // 开发版可选 S3 seed（多端联调用）：凭据只从环境变量读取；
    // 没有配置时保持纯本地模式，不把共享密钥打进源码或新开发数据。
    if (isDev && !store.getS3Settings()) {
      const devS3Settings = readDevS3Settings();
      if (devS3Settings) store.saveS3Settings(devS3Settings);
      else log.app.info("dev S3 seed skipped: credentials are not configured");
    }
    // Batch3-A（261105）：小记**独立库**损坏不得卡住整个应用。QuickNotesStore 单独 try/catch：
    // 失败 ⇒ 降级「无小记」模式（主库/文档/表格照常启动），小记相关 IPC 返回可读错误、v3 同步暂停；
    // 绝不把整库判为坏库（启动恢复页只管主库，语义见 startupRecovery）。
    let quickNotesOpenError: unknown = null;
    try {
      quickNotes = new QuickNotesStore(workspaceRoot(), log);
    } catch (error) {
      quickNotesOpenError = error;
    }
    const quickNotesAvailability = decideQuickNotesAvailability({ openError: quickNotesOpenError });
    setQuickNotesAvailability(quickNotesAvailability);
    if (quickNotesAvailability.mode === "degraded") {
      const degradedMessage = quickNotesDegradedMessage(quickNotesAvailability);
      quickNotes = createUnavailableQuickNotesStore(degradedMessage);
      log.app.error("[quick-notes] 小记库不可用，进入降级模式（文档/表格不受影响）"
        + formatLogFields({ reason: quickNotesAvailability.reason, detail: quickNotesAvailability.detail }));
      log.sync.warn("[sync] 小记库降级中：v3 同步已暂停（避免空小记世界被误判为删除）；出口见 设置→同步诊断");
    } else {
      // 只有正常打开时才注册给 v3：降级替身的空世界会被同步判成删除/下载（desktopSync 另有前置断言）。
      setQuickNotesStoreForV3(quickNotes);
      quickNotes.recoverConversions((noteId) => store.hasNote(noteId), (noteId) => store.removeUntrackedNoteArtifacts(noteId));
      // 261107（上线前最后一批）：标签存储统一 —— 文档标签关系一次性迁入小记库，成功后把 documentTags 切到小记库；
      // 失败则保持主库旧关系（可回退），并在下次启动重试；旧表保留一个版本，不删除。
      try {
        const migration = migrateNoteTagLinksToQuickNotes({
          mainDbPath: store.databasePath,
          quickDb: quickNotes.databaseHandle,
          log: (message) => log.app.info(message),
        });
        if (migration.ok) {
          store.attachDocumentTagsDatabase(quickNotes.databaseHandle);
          if (!migration.already) log.app.info("[tags] 标签存储已统一到小记库（moved=" + migration.moved + "）");
        } else {
          log.app.warn("[tags] 标签存储迁移失败，继续使用主库旧关系：" + (migration.reason ?? "unknown"));
        }
      } catch (error) {
        log.app.warn("[tags] 标签存储迁移异常，继续使用主库旧关系：" + (error as Error).message);
      }
      // 261105 P1：启动自检清理「文档关系指向不存在标签」的孤儿行（目录唯一来源 = 小记库 tags）。
      try {
        const cleanup = store.documentTags.cleanupOrphans(new Set(quickNotes.tags.list().map((tag) => tag.id)));
        if (cleanup.links > 0) log.app.warn("[tags] 启动清理孤儿文档标签关系 " + cleanup.links + " 行（" + cleanup.tags + " 个标签）");
      } catch (error) { log.app.warn("[tags] 孤儿文档标签关系清理失败：" + (error as Error).message); }
    }
    drafts = new DraftJournal(draftJournalDir(workspaceRoot()));
    // 261105 Batch4-E：自动备份（主库 + 小记库）。就绪后**每 6h tick，启动不立即跑**；单飞 + 维护域串行，
    // 内容未变（size+mtime）跳过；轮转保留 N 份/总大小上限。失败只记日志，绝不阻断主流程。
    {
      let autoBackupBusy = false;
      const runBackup = async (manual: boolean): Promise<{ state: ReturnType<typeof store.getAutoBackupState>; message: string }> => {
        if (autoBackupBusy) return { state: store.getAutoBackupState(), message: "已有备份正在进行中" };
        autoBackupBusy = true;
        try {
          // 维护域串行（与同步/GC 互斥）：runBackupCycle 做 VACUUM INTO + 轮转，不在写域、不阻塞本地保存。
          return await enqueueMaintenance(async () => {
            const settings = store.getAutoBackupSettings();
            const state = store.getAutoBackupState();
            const mainDbPath = path.join(workspaceRoot(), "metadata.sqlite3");
            const decision = decideAutoBackup({
              enabled: settings.enabled,
              busy: false,
              nowMs: Date.now(),
              lastBackupAtMs: state ? Date.parse(state.lastBackupAt) || null : null,
              intervalDays: settings.intervalDays,
              fingerprint: readDatabaseFingerprint(mainDbPath),
              lastFingerprint: state?.fingerprint ?? null,
              manual,
            });
            if (!decision.run) {
              log.app.info("[backup] 本轮跳过（" + decision.reason + "）");
              return { state, message: "未备份（" + (manual ? "内容未变" : decision.reason) + "）" };
            }
            const result = runBackupCycle({
              userDataDir: app.getPath("userData"),
              mainDbPath,
              // 小记库降级（损坏）时不带路径 ⇒ 不备份小记库，结果明说「小记库不可用」。
              quickNotesDbPath: getQuickNotesAvailability().mode === "ok" ? path.join(workspaceRoot(), "quick-notes", "metadata.sqlite3") : null,
              settings,
              log: (message) => log.app.info(message),
            });
            if (result.state) {
              try { store.saveAutoBackupState(result.state); } catch (error) { log.app.warn("[backup] 状态落盘失败：" + (error as Error).message); }
            }
            return { state: result.state, message: result.message };
          });
        } catch (error) {
          log.app.warn("[backup] 备份失败（不阻断主流程）：" + (error as Error).message);
          return { state: store.getAutoBackupState(), message: "备份失败：" + (error as Error).message };
        } finally {
          autoBackupBusy = false;
        }
      };
      autoBackupRunner = {
        getSettings: () => store.getAutoBackupSettings(),
        getState: () => store.getAutoBackupState(),
        saveSettings: (settings) => store.saveAutoBackupSettings(settings),
        runNow: () => runBackup(true),
      };
      // 每 6h tick；首 tick 在 6h 后（启动不立即跑，避免抢首屏/首同步 IO）。
      const timer = setInterval(() => { void runBackup(false); }, AUTO_BACKUP_TICK_MS);
      timer.unref?.();
    }
    // 261109 桌面更新中心：只认 GitHub 稳定版 latest.json；自动检查/自动下载默认开（设置项本机、不进 S3）。
    // 网络失败/坏清单只提示，不阻断启动；下载由主进程流式落盘 userData/updates，**不静默安装**。
    updateService = new UpdateService({
      userData: userDataDir,
      currentVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      settings: {
        get: () => store.getUpdateSettings(),
        save: (settings) => store.saveUpdateSettings(settings),
      },
      onState: (state) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!trustedWebContents.has(win.webContents.id)) continue;
          try { win.webContents.send("update-state", state); } catch { /* 窗口已关闭 */ }
        }
        webServerController?.broadcast("update-state", state);
      },
      log: { info: (message) => log.app.info(message), warn: (message) => log.app.warn(message) },
    });
    registerCdnRedirect();
    registerAssetTokenRedirect();
    startAssetServer(path.join(workspaceRoot(), "note-assets"), vendorCdnDir(), path.join(workspaceRoot(), "quick-notes"), assetToken);
    const webApiRegistry = registerIpc();
    // 浏览器端（桌面附属窗口）：默认不启动（纯内存态，不落盘；每次启动都从关闭开始）。
    // 设置里打开/关闭即时起停服务；只绑 127.0.0.1、不做局域网伺服；复用同一批 IPC handler。
    serveAppDist(rendererDistDir());
    webServerController = createWebServerController({
      distDir: rendererDistDir(),
      registry: webApiRegistry,
      token: webApiToken,
      assetToken,
      assetPort: ASSET_PORT,
      port: WEB_API_PORT,
      log: { info: (m) => log.app.info(m), warn: (m) => log.app.warn(m) },
    });
    // 正常启动已跑通 ⇒ 消费崩溃标记（它已在启动日志里提示过；恢复模式不会走到这里，保留给恢复页）。
    // 正常启动已跑通 ⇒ 消费崩溃标记（旧语义）；安全模式**不清**标记（诊断线索保留到用户显式退出）。
    if (startupDecision.crashMarker && !safeModeActive) removeCrashMarker(userDataDir);
    // 正常启动顺手清掉遗留状态文件：别让下一次启动误读上一次的 active:true。
    if (!safeModeActive) removeSafeModeState(userDataDir);
    createWindow();
    // 更新中心：启动后延迟一次自动检查 + 每 N 小时（安全模式不联网检查）；失败只记状态，不阻断启动。
    if (!safeModeActive) updateService?.start();
    // P2-B：正常启动已跑通；「上次 OK」在正常退出（will-quit）时落盘，运行中崩溃保持 dirty ⇒ 下次深检。
    normalStartupCompleted = true;
    logHeapPeak("startup");

    // U1/Batch4-C：定时兜底快照（默认 10 分钟，0 = 关闭）+ 启动兜底清理（P5 低频巡检）
    // 启动兜底：清理一次过期快照（惰性清理在创建快照后也会触发，这里是兜底）
    try {
      const r = store.cleanupHistory();
      store.recordHistoryCleanup(r);
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
      const cfg = store.getHistorySettings();
      const fallbackMinutes = historyFallbackMinutes(cfg.snapshotIntervalMinutes);
      // Batch4-C 定时兜底快照（默认 10 分钟，0 = 关闭）：只挑「自上次兜底后有正文变化」的文档
      //（持久账本 history_fallback_state + 正文 mtime，重启不丢）；24h 同 hash 去重/引用保护/
      // 保留期清理沿用既有实现。**启动不立即跑**：首轮 = 就绪后一个间隔，避免和启动抢磁盘。
      if (shouldRunHistoryFallback(fallbackMinutes)) {
        snapshotTimer = setInterval(() => {
          if (historyFallbackRunning) return;
          historyFallbackRunning = true;
          // P2-A：分片 + 20s 预算的异步兜底（每 chunk 让出事件循环）。单飞标记覆盖整个异步窗口。
          void store.runHistoryFallback()
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
            const r = store.cleanupHistory();
            store.recordHistoryCleanup(r);
            if (r.deletedSnapshots > 0) log.history.info(`[history] 定期清理：删除 ${r.deletedSnapshots} 份过期快照`);
          } catch (error) { console.warn("[history] 定期清理失败:", error); }
        }, cfg.cleanupIntervalHours * 3600 * 1000);
      }
    };
    startHistoryTimers();
    restartHistoryTimers = startHistoryTimers;

    // 自动同步（interval）定时器：仅在云同步开启且模式为 interval 时运行。
    /** 小记库降级 ⇒ 不做自动同步：整轮同步已被 desktopSync 前置断言拦住，定时器只会反复刷失败；
     *  手动同步仍会当场给出可读错误（用户知道为什么 + 去哪恢复）。 */
    const autoSyncAllowed = getQuickNotesAvailability().mode === "ok";
    let syncTimer: NodeJS.Timeout | null = null;
    const startSyncTimers = () => {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      // Batch3-B：安全模式不自动同步（手动 syncNow 仍可用；用户显式退出后本进程也不重启定时器）。
      if (safeModeActive) return;
      if (!autoSyncAllowed) return;
      const cfg = store.getSyncSettings();
      // CORE-14：interval 判据单一来源 = core/syncModes.autoSyncIntervalMs（与设置归一/移动端同口径）。
      const intervalMs = autoSyncIntervalMs(cfg);
      if (intervalMs === null) return;
      syncTimer = setInterval(() => {
        void runFullSync().catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn("[sync] 自动同步失败:", msg);
          // 261028 P1：广播里带上分类 ⇒ 渲染层能把「另一台设备在发布」当软提示，不弹红。
          const info = readSyncErrorInfo(error);
          broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg, errorCode: info.code, errorClass: info.className });
        });
      }, intervalMs);
    };
    startSyncTimers();
    restartSyncTimers = startSyncTimers;

    // 开启应用时对齐一次（261013：interval 也含在内；manual 不补）+ 断点续传（261026）。
    // 续传优先级最高：上次同步没跑完（进程被杀/崩溃/断网）⇒ 启动就续上，**不受 autoMode 影响**
    // （manual 也一样——用户点过同步，退出再进来必须接着下，而不是等他自己再点一次）。
    const syncCfgOpen = store.getSyncSettings();
    const interruptedAt = store.getSyncInterruptedAt();
    // 两条判据都走单一来源：能不能出网 = core/cloudState（没配置 或 关闭云同步 ⇒ 不出网）；
    // 该不该在开/关时补一次 = core/syncModes 的 shouldSyncOnOpenClose（enabled 且 autoMode ≠ "manual"）。
    // Batch3-B：安全模式不自动同步，也不续传上次未完成的同步（那是网络动作；手动同步仍可用）。
    if (!safeModeActive && autoSyncAllowed && canTouchNetwork(cloudStateOf(!!store.getS3Settings(), syncCfgOpen)) && (interruptedAt !== null || shouldSyncOnOpenClose(syncCfgOpen))) {
      if (interruptedAt !== null) log.app.info("[sync] 上次同步未完成（" + interruptedAt + "），启动自动续传" + formatLogFields({ backend: "v3" }));
      void runFullSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 开启同步失败:", msg);
        const info = readSyncErrorInfo(error);
        broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg, errorCode: info.code, errorClass: info.className });
      });
    }

    // 回收站自动过期（trashAutoPurgeDays 默认 90；0=关闭）。本地操作：启动即查一次 + 每天一次。
    let trashTimer: NodeJS.Timeout | null = null;
    const startTrashTimer = () => {
      if (trashTimer) { clearInterval(trashTimer); trashTimer = null; }
      const cfg = store.getS3GcSettings();
      if (cfg.trashAutoPurgeDays <= 0) return;
      const run = () => {
        try {
          const n = store.autoPurgeExpiredTrash(cfg.trashAutoPurgeDays);
          if (n > 0) log.trash.info(`[trash] 自动过期 purge ${n} 项（>${cfg.trashAutoPurgeDays} 天）`);
        } catch (error) { console.warn("[trash] 自动过期失败:", error); }
      };
      run();
      trashTimer = setInterval(run, 24 * 3600 * 1000);
    };
    startTrashTimer();
    restartGcTimers = () => { startTrashTimer(); };

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
