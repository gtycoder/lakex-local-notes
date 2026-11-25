/**
 * 主窗口安全面（C-04 从 main.ts #7 原样搬出）：导航与 window.open 全拦截、渲染层 console-message
 * 转发落盘、IPC 发送方可信判定。审计 #6：不信任任意 file://、任意 localhost、devtools://、about:blank。
 * 边界：只在既有 win 上接线；建窗/揭示/崩溃自恢复见 window/createMainWindow；可信页面判定单一来源
 * = boot/protocolWiring.isAppPageUrl（与 CDN/资产 token 重定向同源）。
 * 纪律（S-5）：trustedWebContents 白名单本体留 main.ts，本文件只读。
 */
import { shell, type WebFrameMain } from "electron";
import type { BrowserWindow } from "electron";
import { errorFields, formatLogFields } from "../../src/core/logFormat.js";
import { ConsoleNoiseFilter } from "../consoleNoise.js";
import { currentLogLevels, log } from "../logger.js";
import { isLevelEnabled } from "../logLevels.js";
import { mapRendererConsoleLevel } from "../rendererLogLevel.js";
import { isAppPageUrl } from "../boot/protocolWiring.js";

export interface WindowSecurityDeps {
  /** 本应用创建的窗口 webContents 白名单（本体在 main.ts，只读）。 */
  trustedWebContents: Set<number>;
}

/** IPC 只接受本应用窗口（精确 URL + webContents 白名单）发来的调用（审计 #6）。 */
export function createSenderValidator(deps: WindowSecurityDeps): (frame: WebFrameMain | null, sender: Electron.WebContents) => boolean {
  return (frame, sender) => {
    if (!frame) return false;
    if (!deps.trustedWebContents.has(sender.id)) return false;
    return isAppPageUrl(frame.url);
  };
}

/** 安全 handler 接线：导航/window.open 拦截 + console-message 转发 + 加载失败留档。 */
export function installWindowSecurity(win: BrowserWindow, deps: WindowSecurityDeps): void {
  // 渲染进程日志统一落盘：console-message 转发到主进程 logger（scope=renderer）。
  // CSP 拦截通知折叠（261023）：粘贴整页网页时内核会为每张远程图各打一条通知（实测 103 行），
  // 逐条落盘会把同期真正需要的日志冲掉 ⇒ 折叠成一行汇总（consoleNoise.ts，排查见 TROUBLESHOOTING §M）。
  const consoleNoise = new ConsoleNoiseFilter({ emit: (line) => log.renderer.info(line) });
  win.on("closed", () => consoleNoise.flush());
  // Electron 44 事件签名（electron.d.ts WebContentsConsoleMessageEventParams）：event 对象恒带
  // { message, level, lineNumber, sourceId }；旧式 (event, level, message) 兜底已删（261125 核实恒为新形状）。
  win.webContents.on("console-message" as unknown as "console-message", (event: unknown) => {
    const e = event as { message?: unknown };
    const msg = typeof e?.message === "string" ? e.message : "";
    if (!msg) return;
    // 过滤 DevTools 样式占位与空消息
    if (msg.includes("%c") || msg.length > 4000) return;
    if (consoleNoise.observe(msg)) return;
    // 级别映射（261023）：渲染层 error/warn 不能被压成 info；正式环境 debug 不落盘，避免调试噪音把日志冲掉。
    const rendererLevel = mapRendererConsoleLevel(event as { level?: unknown });
    if (!isLevelEnabled(currentLogLevels().renderer, rendererLevel)) return;
    if (rendererLevel === "error") log.renderer.error(msg);
    else if (rendererLevel === "warn") log.renderer.warn(msg);
    else if (rendererLevel === "debug") log.renderer.debug(msg);
    else log.renderer.info(msg);
  });
  // 审计 #6：窗口导航与 window.open 全部受控——阻止导航到应用页之外的任何地址；
  // 外链（http/https）交给系统浏览器打开，绝不进入应用窗口
  deps.trustedWebContents.add(win.webContents.id);
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppPageUrl(url)) return;
    event.preventDefault();
    log.app.warn("[security] 阻止窗口导航" + formatLogFields({ url }));
  });
  win.webContents.on("destroyed", () => { deps.trustedWebContents.delete(win.webContents.id); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch { /* 非法 URL 忽略 */ }
    return { action: "deny" };
  });
  win.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    log.app.error(`[boot] did-fail-load code=${code} description=${description} url=${validatedURL}`);
  });
  win.webContents.on("preload-error", (_event, preloadFile, error) => {
    log.app.error("[crash] preload-error" + formatLogFields({ path: preloadFile, ...errorFields(error) }));
  });
}
