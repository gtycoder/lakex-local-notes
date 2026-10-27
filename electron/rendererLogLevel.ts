/**
 * 渲染层 console → 我们的日志级别（主进程转发时用，纯逻辑，261023）。
 *
 * Electron 33+ 的 console-message 事件对象带字符串 level（info/warning/error/debug）；
 * 旧签名是 (event, level: number, message)。两种都要认，否则 error 会被当 info 落盘。
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

function fromNumber(level: number): LogLevel {
  if (level >= 3) return "error";
  if (level === 2) return "warn";
  if (level === 1) return "info";
  return "debug";
}

export function mapRendererConsoleLevel(event: { level?: unknown } | null | undefined, args: unknown[] = []): LogLevel {
  const raw = event?.level;
  if (typeof raw === "string") return STRING_LEVELS[raw.toLowerCase()] ?? "info";
  if (typeof raw === "number") return fromNumber(raw);
  // 旧签名：args = [level, message, line, sourceId]
  const legacy = args[0];
  if (typeof legacy === "number") return fromNumber(legacy);
  return "info";
}
