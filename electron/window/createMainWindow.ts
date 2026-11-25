/**
 * 主窗口装配（C-04 从 main.ts #6 原样搬出）：窗口几何/平台差异、boot→主窗揭示流程（renderer-ready
 * 首帧信号 + 8s 兜底）、窗口状态持久化、全屏广播、win32 融合标题栏、渲染进程崩溃自恢复。
 * 边界：导航/window.open/console-message 安全面 = window/windowSecurity；splash = window/bootSplash。
 * 纪律（S-5）：mainWindow / bootWindow 单例本体留 main.ts，本文件只经 get/set 读写；定时器回调不捕获值快照。
 * 时序断言（C-04）：serveAppDist 必须先于本函数（boot/startupOrder.assertAppDistServed）。
 * 契约：窗口选项纯函数 = electron/mainWindowOptions.ts；揭示顺序「先藏 boot → show 主窗 → destroy boot」
 * 反序会在 macOS 暴露空白 backing window（见 revealMainWindow 注释）。
 */
import { app, BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainEvent } from "electron";
import { perfMessage } from "../../src/core/logFormat.js";
import { log } from "../logger.js";
import { clampWindowState, readWindowState, writeWindowState } from "../windowState.js";
import { buildMainWindowOptions, shouldHideMenuBar, titleBarOverlayFor } from "../mainWindowOptions.js";
import { APP_ORIGIN } from "../appOrigin.js";
import { DEV_SERVER_URL, rendererMode, windowStatePath } from "../boot/paths.js";
import { preloadPath } from "../buildTarget.js";
import { assertAppDistServed } from "../boot/startupOrder.js";
import { createBootWindow, type BootSplashDeps } from "./bootSplash.js";
import { installWindowSecurity } from "./windowSecurity.js";

export interface MainWindowDeps {
  /** 构建产物目录（dist-electron 运行时绝对路径；由入口 main.ts 算好传入）。 */
  buildDir: string;
  /** 启动计时基准（main.js 加载即开始；perf boot.ready 用它算到主窗口首帧的耗时）。 */
  bootStartedAt: number;
  /** 主窗口/boot 窗口单例（本体在 main.ts，只经 get/set 读写 —— S-5）。 */
  getMainWindow: () => BrowserWindow | null;
  setMainWindow: (win: BrowserWindow | null) => void;
  getBootWindow: () => BrowserWindow | null;
  setBootWindow: (win: BrowserWindow | null) => void;
  /** 本应用创建的窗口 webContents 白名单（本体在 main.ts）。 */
  trustedWebContents: Set<number>;
}

export async function createWindow(deps: MainWindowDeps): Promise<void> {
  const splashDeps: BootSplashDeps = {
    buildDir: deps.buildDir,
    getBootWindow: deps.getBootWindow,
    setBootWindow: deps.setBootWindow,
  };
  // macOS 关窗后从 Dock 重开时也要先有 boot 窗口，否则主窗口会隐藏到 renderer-ready 才出现。
  if (!deps.getBootWindow() || deps.getBootWindow()!.isDestroyed()) createBootWindow(splashDeps);
  const windowStateFile = windowStatePath();
  const workArea = screen.getPrimaryDisplay().workArea;
  const restored = clampWindowState(readWindowState(windowStateFile), workArea);
  // 窗口选项（含 win32 融合标题栏 / macOS 红绿灯居中等平台差异）= 纯函数构造，见 electron/mainWindowOptions.ts。
  const win = new BrowserWindow(buildMainWindowOptions({
    platform: process.platform,
    bounds: { x: restored.x, y: restored.y, width: restored.width, height: restored.height },
    dark: nativeTheme.shouldUseDarkColors,
    preload: preloadPath(deps.buildDir, app.isPackaged),
  }));
  // win32 融合标题栏：菜单栏只藏视觉、保留默认菜单的快捷键（shouldHideMenuBar 单一判据）；
  // 窗口 show:false 到 renderer-ready，不会闪出菜单栏。
  if (shouldHideMenuBar(process.platform)) win.setMenuBarVisibility(false);

  deps.setMainWindow(win);
  let mainWindowRevealed = false;
  let bootFallback: NodeJS.Timeout | null = null;
  const revealMainWindow = (reason: string) => {
    if (mainWindowRevealed || win.isDestroyed()) return;
    mainWindowRevealed = true;
    if (bootFallback) { clearTimeout(bootFallback); bootFallback = null; }
    const boot = deps.getBootWindow();
    // 顺序固定：先藏 boot，再显示主窗，最后销毁 boot。
    // 反过来（先 destroy）会让 macOS 在两者切换间短暂暴露一块空白 backing window。
    if (boot && !boot.isDestroyed()) boot.hide();
    deps.setBootWindow(null);
    win.show();
    win.focus();
    if (boot && !boot.isDestroyed()) boot.destroy();
    log.app.info(`[boot] main window shown (${reason})`);
    log.perf.info(perfMessage("boot.ready", Date.now() - deps.bootStartedAt, { reason }));
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
  /** win32 融合标题栏：渲染层把主题色阶（light/dark 档）上报给原生窗口控制按钮配色（setTitleBarOverlay）。
   *  只收两档字符串（白名单校验，渲染层输入不直接下传）；非 win32 / 主进程外发件方一律忽略。 */
  const onTitleBarOverlayScheme = (event: IpcMainEvent, scheme: unknown) => {
    if (event.sender.id !== win.webContents.id) return;
    if (process.platform !== "win32" || win.isDestroyed()) return;
    if (scheme !== "light" && scheme !== "dark") return;
    win.setTitleBarOverlay(titleBarOverlayFor(scheme));
  };
  ipcMain.on("set-title-bar-overlay", onTitleBarOverlayScheme);
  bootFallback = setTimeout(() => revealMainWindow("fallback-timeout"), 8_000);
  win.once("closed", () => {
    if (deps.getMainWindow() === win) deps.setMainWindow(null);
    if (bootFallback) { clearTimeout(bootFallback); bootFallback = null; }
    ipcMain.removeListener("renderer-ready", onRendererReady);
    ipcMain.removeListener("set-title-bar-overlay", onTitleBarOverlayScheme);
    const boot = deps.getBootWindow();
    if (boot && !boot.isDestroyed()) boot.destroy();
    deps.setBootWindow(null);
  });

  const persistWindowState = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    writeWindowState(windowStateFile, {
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
  // win32 的 F11 全屏不触发 enter/leave-full-screen（那对事件只在 macOS 触发）⇒ 用 resize 边沿检测补广播，
  // 渲染层才能在全屏时撤掉融合标题栏的窗口控制按钮让位（window-chrome.css 同款收口）。
  if (process.platform === "win32") {
    let lastFullScreen = win.isFullScreen();
    win.on("resize", () => {
      const fs = win.isFullScreen();
      if (fs !== lastFullScreen) { lastFullScreen = fs; sendWindowFullscreen(); }
    });
  }
  win.on("close", persistWindowState);
  if (restored.maximized) win.maximize();
  if (restored.fullscreen) win.setFullScreen(true);

  installWindowSecurity(win, { trustedWebContents: deps.trustedWebContents });

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
    // reload 期间 renderer 没有任何可绘制内容：把主窗藏起来、重新显示 boot，
    // 新渲染进程发出 renderer-ready 后走同一个 reveal 流程。避免用户看到一块白色窗口。
    mainWindowRevealed = false;
    win.hide();
    createBootWindow(splashDeps);
    if (bootFallback) clearTimeout(bootFallback);
    bootFallback = setTimeout(() => revealMainWindow("crash-fallback-timeout"), 8_000);
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.webContents.reload(); } catch { /* 窗口已销毁 */ }
    }, 800);
  });
  win.on("unresponsive", () => log.app.warn("[ui] 窗口无响应（unresponsive）"));
  win.on("responsive", () => log.app.info("[ui] 窗口恢复响应（responsive）"));

  // 时序断言（C-04 不可动③）：私有协议 serveAppDist 必须已经跑过，窗口加载的页面才服务得到。
  assertAppDistServed("createWindow");
  if (rendererMode === "scheme") {
    await win.loadURL(`${APP_ORIGIN}/index.html`);
  } else {
    await win.loadURL(DEV_SERVER_URL);
  }
}
