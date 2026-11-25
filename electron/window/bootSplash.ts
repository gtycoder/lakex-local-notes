/**
 * 启动遮罩窗口（boot splash，C-04 从 main.ts #4 原样搬出）：主进程初始化 + 渲染层加载期间
 * 先显示 logo，避免主窗口白屏；主窗就绪后由 createMainWindow 的 reveal 流程藏/毁。
 * 边界：只管 splash 窗口本身；主窗口、导航安全、崩溃恢复见 window/createMainWindow|windowSecurity。
 * 纪律（S-5）：bootWindow 单例本体留在 main.ts，本文件只经 get/set 读写，不复制引用语义。
 * 契约：底色 261120「都统一白色」用户点单（浅色档纯白）；几何 = windowState 恢复 + clamp。
 */
import { BrowserWindow, nativeTheme, screen } from "electron";
import { log } from "../logger.js";
import { clampWindowState, readWindowState } from "../windowState.js";
import { windowStatePath } from "../boot/paths.js";
import { bootSplashPath } from "../buildTarget.js";

export interface BootSplashDeps {
  /** 构建产物目录（dist-electron 运行时绝对路径；由入口 main.ts 算好传入）。 */
  buildDir: string;
  /** boot 窗口单例（本体在 main.ts；只经 getter/setter 读写）。 */
  getBootWindow: () => BrowserWindow | null;
  setBootWindow: (win: BrowserWindow | null) => void;
}

/**
 * 思源式 boot 窗口：主进程一启动就显示本地 HTML（内嵌 APNG），
 * 主窗口保持 show:false，等渲染层首帧信号后再显示并销毁 boot 窗口。
 */
export function createBootWindow(deps: BootSplashDeps): void {
  const bootWindow = deps.getBootWindow();
  if (bootWindow && !bootWindow.isDestroyed()) return;
  const windowStateFile = windowStatePath();
  const workArea = screen.getPrimaryDisplay().workArea;
  const restored = clampWindowState(readWindowState(windowStateFile), workArea);
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
    // 261120 用户点单「都统一白色」：浅色档启动底 = 纯白（与 boot.html / 移动端一致；深色档仍 #1e2126）。
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e2126" : "#FFFFFF",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  deps.setBootWindow(boot);
  if (restored.maximized) boot.maximize();
  if (restored.fullscreen) boot.setFullScreen(true);
  boot.once("ready-to-show", () => {
    if (boot.isDestroyed()) return;
    boot.show();
    log.app.info("[boot] splash shown");
  });
  boot.on("closed", () => {
    if (deps.getBootWindow() === boot) deps.setBootWindow(null);
  });
  void boot.loadFile(bootSplashPath(deps.buildDir)).catch((error) => {
    log.app.warn(`[boot] splash load failed: ${(error as Error).message}`);
    if (!boot.isDestroyed()) boot.destroy();
    if (deps.getBootWindow() === boot) deps.setBootWindow(null);
  });
}
