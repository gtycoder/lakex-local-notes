/**
 * 更新中心装配（C-04 从 main.ts K 原样搬出）：只认 GitHub 稳定版 latest.json；自动检查/自动下载默认开
 * （设置项本机、不进 S3）；网络失败/坏清单只提示、不阻断启动；下载由主进程流式落盘 userData/updates，
 * **不静默安装**。onState 广播给受信任窗口 + 浏览器端（SSE）。
 * 边界：只装配服务与广播；实现 = electron/update/updateService.ts；规格 = docs/UPDATE-CENTER.md。
 */
import { app, BrowserWindow } from "electron";
import { UpdateService } from "../update/updateService.js";
import type { Store } from "../store.js";
import type { WebServerController } from "../webApiServer.js";
import { log } from "../logger.js";

export interface UpdateWiringDeps {
  userDataDir: string;
  store: Store;
  /** 本应用创建的窗口 webContents 白名单（本体在 main.ts，只读）。 */
  trustedWebContents: Set<number>;
  /** 浏览器端服务控制器（内存态；未开启 = null，getter 形式 —— 装配时可能还没就绪）。 */
  getWebServerController: () => WebServerController | null;
}

export function assembleUpdateService(deps: UpdateWiringDeps): UpdateService {
  // 261109 桌面更新中心：只认 GitHub 稳定版 latest.json；自动检查/自动下载默认开（设置项本机、不进 S3）。
  // 网络失败/坏清单只提示，不阻断启动；下载由主进程流式落盘 userData/updates，**不静默安装**。
  return new UpdateService({
    userData: deps.userDataDir,
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    settings: {
      get: () => deps.store.getUpdateSettings(),
      save: (settings) => deps.store.saveUpdateSettings(settings),
    },
    onState: (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!deps.trustedWebContents.has(win.webContents.id)) continue;
        try { win.webContents.send("update-state", state); } catch { /* 窗口已关闭 */ }
      }
      deps.getWebServerController()?.broadcast("update-state", state);
    },
    log: { info: (message) => log.app.info(message), warn: (message) => log.app.warn(message) },
  });
}
