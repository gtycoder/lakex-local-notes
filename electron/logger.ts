/**
 * 统一日志模块（electron-log v5）—— 分级 / 落盘 / 现场排障（261023 重做）。
 *
 * 分级口径（单一来源 electron/logLevels.ts，单测覆盖）：
 * - 开发环境（!app.isPackaged）：file / console / renderer 全开 debug；
 * - 正式环境：file = info、console = 关闭、renderer = info（debug 不落盘）；
 * - 现场覆盖：LAKE_LOG_LEVEL=debug|info|warn|error（file+renderer）、LAKE_LOG_CONSOLE=1（开 console）。
 *
 * 约定（docs/LOGGING.md）：
 * - 耗时一律 [perf] <label> <ms>ms key=value（formatPerf，跨进程同一来源 src/core/logFormat.ts）；
 * - 错误一律带 error="Name: message" + 前 3 帧调用栈；不记录正文内容/密钥；
 * - 落盘目录 userData/logs/local-lakex-notes.log，10MB 轮转（electron-log 默认保留一份 .old）。
 *
 * 渲染层：不 import 本模块；console.* 由 main.ts 的 console-message 转发（按级别映射 + CSP 折叠）。
 */
import path from "node:path";
import { app } from "electron";
import electronLog from "electron-log/main";
import { formatLogFields, type LogFields } from "../src/core/logFormat.js";
import { resolveLogLevels, type LogLevel, type LogLevelConfig } from "./logLevels.js";

/** 是否运行在真实 Electron 主进程（vitest 里 process.versions.electron 不存在） */
const isElectronMain = typeof process !== "undefined" && !!process.versions?.electron;

/** 单文件上限：info 级正常使用约 1–2 个月一轮转；排障期可临时调 debug。 */
export const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;

function lineFormat(): string {
  return "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}";
}

/** 当前的生效级别（initLogger 之前用正式环境默认值，避免未初始化时把 debug 写出去）。 */
let activeLevels: LogLevelConfig = { file: "info", console: false, renderer: "info" };

export function currentLogLevels(): LogLevelConfig {
  return activeLevels;
}

/** 初始化：必须在 app ready 之后调用一次。返回生效的级别（main 用它转发渲染层日志）。 */
export function initLogger(options: { isPackaged?: boolean } = {}): LogLevelConfig {
  activeLevels = resolveLogLevels({
    isPackaged: options.isPackaged ?? (isElectronMain ? app.isPackaged : false),
    envLevel: process.env.LAKE_LOG_LEVEL,
    envConsole: process.env.LAKE_LOG_CONSOLE,
  });
  if (!isElectronMain) return activeLevels;
  electronLog.initialize();
  electronLog.transports.file.resolvePathFn = () =>
    path.join(app.getPath("userData"), "logs", "local-lakex-notes.log");
  electronLog.transports.file.maxSize = LOG_FILE_MAX_BYTES;
  electronLog.transports.file.format = lineFormat();
  electronLog.transports.file.level = activeLevels.file;
  electronLog.transports.console.level = activeLevels.console;
  electronLog.transports.console.format = lineFormat();
  return activeLevels;
}

/** 分类 logger：scope 出现在每行日志（[s3] / [sync] / [history] ...）。 */
export const log = {
  app: electronLog.scope("app"),
  sync: electronLog.scope("sync"),
  s3: electronLog.scope("s3"),
  quick: electronLog.scope("quick"),
  history: electronLog.scope("history"),
  gc: electronLog.scope("gc"),
  trash: electronLog.scope("trash"),
  store: electronLog.scope("store"),
  renderer: electronLog.scope("renderer"),
  perf: electronLog.scope("perf"),
  /** 主进程 IPC 通道耗时（debug 全量 / warn 慢调用 / error 失败）。 */
  ipc: electronLog.scope("ipc"),
  /** 启动链路（splash / window / ready 时序）。 */
  boot: electronLog.scope("boot"),
} as const;

export type LogScope = keyof typeof log;

/** 启动上下文：排障时先看这一行（版本 / 平台 / 数据目录 / 生效级别）。 */
export function logStartupInfo(extra?: LogFields): void {
  if (!isElectronMain) return;
  log.app.info("[start] 启动" + formatLogFields({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
    fileLevel: activeLevels.file,
    rendererLevel: activeLevels.renderer,
    ...(extra ?? {}),
  }));
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
    log.perf.info("[heap] " + label + " peak " + (mem.heapUsed / 1048576).toFixed(1) + "MB (rss " + (mem.rss / 1048576).toFixed(1) + "MB)");
  }
}

/** 供将来按级别动态调整（设置页/诊断入口）；当前未接线，保留单一入口。 */
export function applyLogLevel(level: LogLevel): void {
  activeLevels = { ...activeLevels, file: level, renderer: level };
  if (!isElectronMain) return;
  electronLog.transports.file.level = level;
}

// 非 Electron 环境（vitest）：electron-log 默认 console transport 会打满测试输出，关掉。
if (!isElectronMain) {
  try {
    electronLog.transports.console.level = false;
    electronLog.transports.file.level = false;
  } catch { /* 某些环境下 transports 未就绪，忽略 */ }
}
