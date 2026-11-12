/**
 * 启动期**路径与模式判据**（261112 从 electron/main.ts 拆出，05 报告 S-5）。
 *
 * 边界（只搬这些，其余留在 main.ts）：
 *  - 搬：userData 覆盖/隔离、workspaceRoot、渲染层 dist、CDN 镜像目录、日志/窗口状态文件路径、
 *        dev 判据、dev server 地址、渲染层装载模式。
 *  - 不搬：单实例锁、窗口（boot/主窗口）、私有协议服务、CDN/资产 token 重定向、崩溃与安全模式判定 ——
 *        它们依赖 Electron 生命周期与处理顺序，搬出去只会把顺序风险变成隐式约束。
 *
 * 纪律：**不读 import.meta.url**。构建产物位置锚点由入口（main.ts）决定并通过 appDir 传入，
 * 这样 vite-plugin-electron 的行内打包与将来可能的独立产物都不会改变路径语义。
 */
import { app } from "electron";
import path from "node:path";

/** dev = 未打包（菜单 isDev / 日志档位 / dev S3 seed 分支共用同一判据）。 */
export const isDev = !app.isPackaged;

/** 产品显示名（macOS 菜单/关于面板；与 package.json productName 一致）。 */
export const APP_DISPLAY_NAME = "LakexLocalNotes";
/** 项目主页（帮助菜单：使用文档 / 反馈问题）。 */
export const PROJECT_URL = "https://github.com/gtycoder/lakex-local-notes";

// dev server 地址可经 LAKE_DEV_SERVER_URL 覆盖：多端/隔离冒烟时避开默认 1421（IPC 信任判定同用此值）。
export const DEV_SERVER_URL = process.env.LAKE_DEV_SERVER_URL?.trim() || "http://127.0.0.1:1421";

/**
 * 渲染层加载方式（对齐 DSH 桌面壳：不打 file://）：
 * - `vite`：dev 默认走 vite dev server（保留 HMR；LAKE_DEV_SERVER_URL 可覆盖）；
 * - `scheme`：打包版走私有协议 lakexlocalnotes://app（服务构建产物 dist/）。dev 下亦可用
 *   LAKE_RENDERER=scheme 强制走这条路径（需先 vite build），用于本机验证该分支。
 */
export const rendererMode: "vite" | "scheme" = !isDev || process.env.LAKE_RENDERER?.trim() === "scheme" ? "scheme" : "vite";

/**
 * userData 隔离（**必须在 app ready 前调用**，且在任何 userDataDir()/workspaceRoot() 之前）：
 * - dev 默认 lakex-local-notes-dev（空库+种子），打包版默认 lakex-local-notes（正式数据）；
 * - 两者路径不同、单实例锁各自独立，可同时运行。
 * - 任意模式可用 LAKE_USER_DATA 覆盖：dev 模拟多「设备」，打包版隔离测试（避免触碰正式数据）。
 */
export function applyUserDataPath(env: NodeJS.ProcessEnv = process.env): void {
  const override = env.LAKE_USER_DATA?.trim();
  app.setPath(
    "userData",
    override ||
      (isDev
        ? path.join(app.getPath("appData"), "lakex-local-notes-dev")
        : path.join(app.getPath("appData"), "lakex-local-notes")),
  );
}

/** 当前生效的 userData 目录（隔离后）。 */
export function userDataDir(): string {
  return app.getPath("userData");
}

/** 工作区根（metadata.sqlite3 / 正文 / note-assets / sync-v3 / quick-notes 都在它下面）。 */
export function workspaceRoot(): string {
  return path.join(userDataDir(), "workspace-default");
}

/** 渲染层构建产物目录：私有协议静态服务与 Web 客户端共用同一份 dist。 */
export function rendererDistDir(appDir: string): string {
  return path.join(appDir, "dist");
}

/** Lake 编辑器 CDN 资源本地镜像（public/vendor/cdn → dist/vendor/cdn）。 */
export function vendorCdnDir(appDir: string): string {
  return path.join(appDir, isDev ? "public" : "dist", "vendor", "cdn");
}

/** 主日志文件（与 docs/LOGGING.md 同名；恢复页与安全模式诊断共用这一份路径）。 */
export function logFilePath(): string {
  return path.join(userDataDir(), "logs", "lakex-local-notes.log");
}

/** 窗口几何持久化文件（boot 窗口与主窗口共用）。 */
export function windowStatePath(): string {
  return path.join(userDataDir(), "window-state.json");
}
