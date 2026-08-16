/**
 * 统一日志模块（electron-log v5）。
 *
 * - 主进程：`initLogger()` 后所有分类日志（log.sync / log.s3 / log.history ...）落盘到
 *   `userData/logs/lake-notes.log`（多端用 LAKE_USER_DATA 各自隔离），同时输出到终端。
 * - 渲染进程：不需要 import 本模块，直接 console.log 即可；main.ts 通过
 *   `webContents.on("console-message")` 捕获并转发到 `log.renderer` 落盘。
 * - vitest / 非 Electron 环境：自动静音（不写文件、不输出），保证测试无噪音。
 *
 * 计时约定：耗时统一用 `[perf] <label> <ms>ms`，方便 grep/awk 核对流程执行时间。
 */
import path from "node:path";
import { app } from "electron";
import electronLog from "electron-log/main";

/** 是否运行在真实 Electron 主进程（vitest 里 process.versions.electron 不存在） */
const isElectronMain = typeof process !== "undefined" && !!process.versions?.electron;

function lineFormat(): string {
  return "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}";
}

/** 初始化：必须在 app ready 之后调用一次。 */
export function initLogger(): void {
  if (!isElectronMain) return;
  electronLog.initialize();
  electronLog.transports.file.resolvePathFn = () =>
    path.join(app.getPath("userData"), "logs", "lake-notes.log");
  electronLog.transports.file.maxSize = 5 * 1024 * 1024; // 5MB 后轮转 .old
  electronLog.transports.file.format = lineFormat();
  electronLog.transports.console.format = lineFormat();
}

/** 分类 logger：scope 出现在每行日志（[s3] / [sync] / [history] ...）。 */
export const log = {
  app: electronLog.scope("app"),
  sync: electronLog.scope("sync"),
  s3: electronLog.scope("s3"),
  quick: electronLog.scope("quick"),
  history: electronLog.scope("history"),
  gc: electronLog.scope("gc"),
  store: electronLog.scope("store"),
  renderer: electronLog.scope("renderer"),
  perf: electronLog.scope("perf"),
} as const;

/** 计时：异步 fn 执行耗时（成功/失败都记录）。 */
export async function timed<T>(scope: keyof typeof log, label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log[scope].info(`[perf] ${label} ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    log[scope].warn(`[perf] ${label} FAIL ${Date.now() - start}ms: ${errorMessage(error)}`);
    throw error;
  }
}

/** 计时：同步 fn 执行耗时（成功/失败都记录）。 */
export function timedSync<T>(scope: keyof typeof log, label: string, fn: () => T): T {
  const start = Date.now();
  try {
    const result = fn();
    log[scope].info(`[perf] ${label} ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    log[scope].warn(`[perf] ${label} FAIL ${Date.now() - start}ms: ${errorMessage(error)}`);
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let heapPeakBytes = 0;
/** 记录主进程 V8 堆峰值（仅新峰值时输出），用于评估 --max-old-space-size 是否可下调。 */
export function logHeapPeak(label: string): void {
  const mem = process.memoryUsage();
  if (mem.heapUsed > heapPeakBytes) {
    heapPeakBytes = mem.heapUsed;
    log.perf.info(`[heap] ${label} peak ${(mem.heapUsed / 1048576).toFixed(1)}MB (rss ${(mem.rss / 1048576).toFixed(1)}MB)`);
  }
}

// 非 Electron 环境（vitest）：electron-log 默认 console transport 会打满测试输出，关掉。
if (!isElectronMain) {
  try {
    electronLog.transports.console.level = false;
    electronLog.transports.file.level = false;
  } catch { /* 某些环境下 transports 未就绪，忽略 */ }
}
