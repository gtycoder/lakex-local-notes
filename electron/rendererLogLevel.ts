/**
 * 渲染层 console → 我们的日志级别（主进程转发时用，纯逻辑，261023）。
 *
 * Electron 44 的 console-message 事件对象恒带字符串 level（info/warning/error/debug，见
 * node_modules/electron 的 WebContentsConsoleMessageEventParams 类型，261125 核实）；
 * 旧签名 (event, level: number, message) 的兜底已删。未知/缺失级别按 info（宁可多记，不静默丢）。
 */
import type { LogLevel } from "./logLevels.js";

const STRING_LEVELS: Record<string, LogLevel> = {
  error: "error",
  warning: "warn",
  warn: "warn",
  info: "info",
  debug: "debug",
  verbose: "debug",
  log: "info",
};

export function mapRendererConsoleLevel(event: { level?: unknown } | null | undefined): LogLevel {
  const raw = event?.level;
  if (typeof raw === "string") return STRING_LEVELS[raw.toLowerCase()] ?? "info";
  return "info";
}
