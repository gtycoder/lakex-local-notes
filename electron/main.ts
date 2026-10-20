import { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, screen, session, shell, type IpcMainEvent, type WebFrameMain } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { canTouchNetwork, cloudStateOf } from "../src/core/cloudState.js";
import { shouldSyncOnOpenClose } from "../src/core/syncModes.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { QuickNotesStore } from "./quickNotes.js";
import { startAssetServer, ASSET_PORT } from "./assetServer.js";
import { createWebServerController, type WebServerController, WEB_API_PORT } from "./webApiServer.js";
import { resolveMirroredCdnRedirect, scanMirroredCdnFiles } from "./cdnRedirect.js";
import { runGcReconcile } from "./s3Maintenance.js";
import type { SyncResult, SyncProgress } from "./syncTypes.js";
import { syncNowViaEngine } from "./syncEngineController.js";
import { initLogger, log, logHeapPeak } from "./logger.js";
import { syncQuickNotes } from "./quickNotesSync.js";
import { readDevS3Settings } from "./devConfig.js";
import { readAndRemoveS3RestoreSeed } from "./workspaceBackup.js";
import { createIpcRegistrar } from "./ipc/registrar.js";
import { registerNotesIpc } from "./ipc/registerNotes.js";
import { DraftJournal, draftJournalDir } from "./draftJournal.js";
import { registerHistoryIpc } from "./ipc/registerHistory.js";
import { registerWebIpc } from "./ipc/registerWeb.js";
import { registerSyncIpc } from "./ipc/registerSync.js";
import { registerQuickNotesIpc } from "./ipc/registerQuickNotes.js";
import { registerLogIpc } from "./ipc/registerLogIpc.js";
import { registerAiIpc } from "./ipc/registerAi.js";
import { registerSystemInfoIpc } from "./ipc/registerSystemInfo.js";
import { clampWindowState, readWindowState, writeWindowState } from "./windowState.js";
import { TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "../src/lib/layoutMetrics.js";
import { APP_ORIGIN, isAppOriginUrl } from "./appOrigin.js";
import { registerAppSchemePrivileges, serveAppDist } from "./appProtocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** 启动遮罩窗口：在主进程初始化 + 渲染层加载期间先显示 logo，避免主窗口白屏。 */
let bootWindow: BrowserWindow | null = null;

// userData 隔离（必须在 app ready 前设置）：
// - dev 默认 lake-notes-dev（空库+种子），打包版默认 lake-notes-electron（正式数据）；
// - 两者路径不同、单实例锁各自独立，可同时运行。
// - 任意模式可用 LAKE_USER_DATA 覆盖：dev 模拟多「设备」，打包版隔离测试（避免触碰正式数据）。
const userDataOverride = process.env.LAKE_USER_DATA?.trim();
app.setPath(
  "userData",
  userDataOverride ||
    (isDev
      ? path.join(app.getPath("appData"), "lake-notes-dev")
      : path.join(app.getPath("appData"), "lake-notes-electron")),
);
// dev server 地址可经 LAKE_DEV_SERVER_URL 覆盖：多端/隔离冒烟时避开默认 1421（IPC 信任判定同用此值）。
const DEV_SERVER_URL = process.env.LAKE_DEV_SERVER_URL?.trim() || "http://127.0.0.1:1421";
/**
 * 渲染层加载方式（对齐 DSH 桌面壳：不打 file://）：
 * - `vite`：dev 默认走 vite dev server（保留 HMR；LAKE_DEV_SERVER_URL 可覆盖）；
 * - `scheme`：打包版走私有协议 lake://app（服务构建产物 dist/）。dev 下亦可用
 *   LAKE_RENDERER=scheme 强制走这条路径（需先 vite build），用于本机验证该分支。
 */
const rendererMode: "vite" | "scheme" = !isDev || process.env.LAKE_RENDERER?.trim() === "scheme" ? "scheme" : "vite";

/** 渲染层构建产物目录：私有协议静态服务与 Web 客户端共用同一份 dist。 */
function rendererDistDir(): string {
  return path.join(__dirname, "..", "dist");
}

// 私有协议必须在 app ready 之前注册（Electron 要求）。
registerAppSchemePrivileges();

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
let drafts: DraftJournal;
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

/**
 * **高优先队列**（判据 `PRIORITY_OPS`）：用户当场发起的「把这一条推到云端」**不等整轮同步** ——
 * 长按小记 → 写完 → 同步 → 桌面端及时看到 是高频场景（用户 261013 点单）；
 * 与维护队列是两条独立队列，交叉风险由 IPC 侧的"推送后回核"（排维护队尾）兜底。
 */
let priorityQueue: Promise<unknown> = Promise.resolve();
function enqueuePriority<T>(task: () => Promise<T>): Promise<T> {
  const run = priorityQueue.then(task, task);
  priorityQueue = run.then(() => undefined, () => undefined);
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
      try {
        const settings = store.getS3Settings();
        if (!settings) throw new Error("请先保存 S3 配置");
        const quick = await syncQuickNotes(quickNotes, settings, report);
        result.quickNotes = quick;
      } catch (error) {
        result.quickNotes = { uploaded: 0, downloaded: 0, conflicts: 0, completedAt: new Date().toISOString(), error: String(error) };
        report({ phase: "quick-notes", message: `小记同步失败：${String(error)}` });
      }
      store.recordSyncResult(JSON.stringify(result));
      report({ phase: "done", message: "同步完成", supersededNotes: result.supersededNotes });
      log.sync.info(`[perf] runFullSync done ${Date.now() - fullSyncStart}ms (uploaded=${result.uploaded}, downloaded=${result.downloaded}, conflicts=${result.conflicts}, superseded=${result.supersededNotes.length}, quickNotes=${result.quickNotes?.error ? "error" : "ok"})`);
      logHeapPeak("sync");
      return result;
    });
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
  // 私有协议：只信任 lake://app 自己的页面（该 origin 下只有 dist 产物，无第三方内容）。
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
    title: "LocalLakeNotes",
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
  };
  const onRendererReady = (event: IpcMainEvent) => {
    if (event.sender.id === win.webContents.id) revealMainWindow("renderer-ready");
  };
  ipcMain.on("renderer-ready", onRendererReady);
  bootFallback = setTimeout(() => revealMainWindow("fallback-timeout"), 8_000);
  win.once("closed", () => {
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
  win.on("enter-full-screen", persistWindowState);
  win.on("leave-full-screen", persistWindowState);
  win.on("close", persistWindowState);
  if (restored.maximized) win.maximize();
  if (restored.fullscreen) win.setFullScreen(true);

  // 审计 #6：窗口导航与 window.open 全部受控——阻止导航到应用页之外的任何地址；
  // 外链（http/https）交给系统浏览器打开，绝不进入应用窗口
  trustedWebContents.add(win.webContents.id);
  // 渲染进程日志统一落盘：console-message 转发到主进程 logger（scope=renderer）。
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
    log.renderer.info(msg);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppPageUrl(url)) event.preventDefault();
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
  }, afterInvoke);

  registerNotesIpc(ipc, store, drafts, workspaceRoot(), (targetRoot) => {
    // A1 一致性快照：主库 + 小记库各经其连接 VACUUM INTO（单文件、可独立打开）
    const mainTarget = path.join(targetRoot, "metadata.sqlite3");
    store.backupDatabaseTo(mainTarget);
    const quickDir = path.join(targetRoot, "quick-notes");
    fs.mkdirSync(quickDir, { recursive: true });
    quickNotes.backupDatabaseTo(path.join(quickDir, "metadata.sqlite3"));
  }, enqueueMaintenance);
  registerHistoryIpc(ipc, store, () => restartHistoryTimers?.());
  registerAiIpc(ipc, store);
  registerWebIpc(ipc, () => webServerController);
  registerSyncIpc(ipc, {
    store,
    quickNotes,
    runFullSync,
    enqueueMaintenance,
    broadcastSyncProgress,
    restartGcTimers: () => restartGcTimers?.(),
    restartSyncTimers: () => restartSyncTimers?.(),
  });
  registerQuickNotesIpc(ipc, quickNotes, store, enqueueMaintenance, enqueuePriority);
  registerLogIpc(ipc);
  registerSystemInfoIpc(ipc, { store, quickNotes, workspaceRoot });
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
    initLogger();
    createBootWindow();
    log.app.info("app ready: initLogger done");
    store = new Store(workspaceRoot(), createSafeStorageSecretCipher(), log);
    const integrity = store.checkIntegrity();
    if (!integrity.ok) {
      const detail = `integrity_check=${integrity.integrity}，foreign_key_errors=${integrity.foreignKeyErrors}`;
      log.app.error(`[store] database integrity check failed: ${detail}`);
      const choice = dialog.showMessageBoxSync({
        type: "error",
        title: "本地数据需要检查",
        message: "本地数据库完整性检查未通过。",
        detail: `${detail}\n\n继续打开可能导致后续写入风险；建议先备份用户数据。`,
        buttons: ["退出", "继续打开"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 0) { app.quit(); return; }
    }
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
    quickNotes = new QuickNotesStore(workspaceRoot(), log);
    drafts = new DraftJournal(draftJournalDir(workspaceRoot()));
    quickNotes.recoverConversions((noteId) => store.hasNote(noteId), (noteId) => store.removeUntrackedNoteArtifacts(noteId));
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
    createWindow();
    logHeapPeak("startup");

    // U1：自动快照（默认 15 分钟，间隔可配置）+ 启动兜底清理（P5 低频巡检）
    // 启动兜底：清理一次过期快照（惰性清理在创建快照后也会触发，这里是兜底）
    try {
      const r = store.cleanupHistory();
      store.recordHistoryCleanup(r);
      if (r.deletedSnapshots > 0) log.history.info(`[history] 启动兜底清理：删除 ${r.deletedSnapshots} 份过期快照`);
    } catch (error) { console.warn("[history] 启动兜底清理失败:", error); }
    // 定时器管理：配置变更（设置面板保存）后重启定时器
    let snapshotTimer: NodeJS.Timeout | null = null;
    let cleanupTimer: NodeJS.Timeout | null = null;
    const startHistoryTimers = () => {
      if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
      if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
      const cfg = store.getHistorySettings();
      if (cfg.snapshotIntervalMinutes > 0) {
        snapshotTimer = setInterval(() => {
          try {
            const n = store.flushHistorySnapshots();
            if (n > 0) log.history.info(`[history] 自动快照：创建 ${n} 份`);
          } catch (error) { console.warn("[history] 自动快照失败:", error); }
        }, cfg.snapshotIntervalMinutes * 60 * 1000);
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
    let syncTimer: NodeJS.Timeout | null = null;
    const startSyncTimers = () => {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      const cfg = store.getSyncSettings();
      if (!cfg.enabled || cfg.autoMode !== "interval" || cfg.autoIntervalMinutes < 1) return;
      syncTimer = setInterval(() => {
        void runFullSync().catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn("[sync] 自动同步失败:", msg);
          broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg });
        });
      }, cfg.autoIntervalMinutes * 60 * 1000);
    };
    startSyncTimers();
    restartSyncTimers = startSyncTimers;

    // 开启应用时对齐一次（261013：interval 也含在内；manual 不补）。失败仅告警。
    const syncCfgOpen = store.getSyncSettings();
    // 两条判据都走单一来源：能不能出网 = core/cloudState（没配置 或 关闭云同步 ⇒ 不出网）；
    // 该不该在开/关时补一次 = core/syncModes 的 shouldSyncOnOpenClose（enabled 且 autoMode ≠ "manual"）。
    if (canTouchNetwork(cloudStateOf(!!store.getS3Settings(), syncCfgOpen)) && shouldSyncOnOpenClose(syncCfgOpen)) {
      void runFullSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 开启同步失败:", msg);
        broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg });
      });
    }

    // S3 GC 定期对账（gcIntervalHours 默认 24；0=关闭）。云同步关闭时不执行。
    let gcTimer: NodeJS.Timeout | null = null;
    const startGcTimer = () => {
      if (gcTimer) { clearInterval(gcTimer); gcTimer = null; }
      // 云同步关闭 ⇒ 定期对账也不出网（与 core/cloudState 同一判据）。
      if (!canTouchNetwork(cloudStateOf(!!store.getS3Settings(), store.getSyncSettings()))) return;
      const gcCfg = store.getS3GcSettings();
      if (gcCfg.gcIntervalHours > 0) {
        gcTimer = setInterval(() => {
          void enqueueMaintenance(async () => {
            try {
              const r = await runGcReconcile(store);
              if (r.deleted > 0) log.gc.info(`[s3-gc] 定期对账删除 ${r.deleted} 个过期对象`);
            } catch (error) { console.warn("[s3-gc] 定期对账失败:", error); }
          });
        }, gcCfg.gcIntervalHours * 3600 * 1000);
      }
    };
    startGcTimer();

    // 回收站自动过期（trashAutoPurgeDays 默认 60；0=关闭）。本地操作：启动即查一次 + 每天一次。
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
    restartGcTimers = () => { startGcTimer(); startTrashTimer(); };

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// 退出前同步（261013：interval 也做一次，manual 不做）；任何模式只要同步在途都等它完成再退
// （否则可能停在"对象已传、manifest 未写"的中间态）。
let quittingForSync = false;
app.on("before-quit", (event) => {
  if (forceQuit || quittingForSync || !store || !quickNotes) return;
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
  // Best-effort checkpoint after any onOpenClose sync has settled. This keeps
  // the metadata DB/WAL bounded without making shutdown depend on it.
  try { store?.checkpointWal(); } catch { /* app is already exiting */ }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
