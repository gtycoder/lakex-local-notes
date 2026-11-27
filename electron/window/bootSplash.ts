/**
 * 启动遮罩窗口（boot splash，C-04 从 main.ts #4 原样搬出）：主进程初始化 + 渲染层加载期间
 * 先显示 logo，避免主窗口白屏；主窗就绪后由 createMainWindow 的 reveal 流程藏/毁。
 * 边界：只管 splash 窗口本身；主窗口、导航安全、崩溃恢复见 window/createMainWindow|windowSecurity。
 * 纪律（S-5）：bootWindow 单例本体留在 main.ts，本文件只经 get/set 读写，不复制引用语义。
 * 契约：底色 261120「都统一白色」用户点单（浅色档纯白）；几何 = windowState 恢复 + clamp。
 *
 * ⚠️ 261127 空白窗口事故（用户报「mac 上偶发空白窗口，Dock 菜单多一条，只能重启」）：
 * splash 是 frameless + resizable:false + 几百毫秒后就销毁的窗口，**绝不能对它做窗口状态转换**
 * （`setFullScreen(true)` / `maximize()` / `setSimpleFullScreen()`）。上次退出在全屏时，旧实现让
 * splash 也进原生全屏 ⇒ macOS 启动全屏过渡、splash 随即 hide+destroy 打断过渡 ⇒ 屏幕上残留一块纯白
 * backing window（无标题/无红绿灯，Dock 菜单里多一条窗口条目），并且系统 Space/Dock 一起异常。
 * 实测：window-state.json = fullscreen:true 时启动必现；去掉 splash 的 setFullScreen 后恢复 1 个窗口。
 * ⇒ 几何只用 `bootSplashBounds()` 算静态矩形（最大化/全屏恢复 = 铺满工作区），窗口本体
 * `fullscreenable/maximizable: false` 兜底（即便将来有人误加调用也不会真的进全屏）。
 */
import { BrowserWindow, nativeTheme, screen } from "electron";
import { log } from "../logger.js";
import { bootSplashBounds, clampWindowState, readWindowState } from "../windowState.js";
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
  // 静态几何：最大化/全屏恢复 ⇒ 直接铺满工作区（与主窗口最终形态一致），不做原生 zoom/全屏过渡。
  const bounds = bootSplashBounds(restored, workArea);
  const boot = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    // 兜底（见文件头注释）：splash 永远不参与原生全屏/最大化，误加调用也不会留下空白过渡窗。
    fullscreenable: false,
    maximizable: false,
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
  // 这里**不**调用 maximize()/setFullScreen()：见文件头 261127 空白窗口事故。
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
