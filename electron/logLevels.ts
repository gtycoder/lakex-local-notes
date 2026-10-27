/**
 * 日志分级（主进程，纯逻辑，261023；单测见 logLevels.test.ts）。
 *
 * 设计口径（正式产品可排查）：
 * - **开发环境**：file/console/renderer 全开 debug —— 写代码时要看得见细节。
 * - **正式环境**：file = info（error/warn/info 落盘，debug 丢弃），console = 关（打包版没有终端），
 *   renderer = info（渲染层 debug 不落盘，避免内核/React 调试噪音把日志冲掉）。
 * - **现场排障**：可用环境变量覆盖，不改代码：
 *     LAKE_LOG_LEVEL=debug|info|warn|error   覆盖 file + renderer
 *     LAKE_LOG_CONSOLE=1                     强制打开主进程 console 输出（配合终端启动）
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

/** 由严到宽；isLevelEnabled 用下标比较。 */
export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

export interface LogLevelConfig {
  file: LogLevel;
  console: LogLevel | false;
  renderer: LogLevel;
}

export function parseLogLevel(value: string | null | undefined): LogLevel | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return (LOG_LEVELS as readonly string[]).includes(normalized) ? (normalized as LogLevel) : null;
}

/** threshold 之下（含）才输出：threshold=info 时 info/warn/error 通过，debug 丢弃。 */
export function isLevelEnabled(threshold: LogLevel, level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}

/**
 * dev / prod 默认值 + 环境变量覆盖。
 * @param input.isPackaged app.isPackaged（单测直接传）
 * @param input.envLevel LAKE_LOG_LEVEL
 * @param input.envConsole LAKE_LOG_CONSOLE
 */
export function resolveLogLevels(input: { isPackaged: boolean; envLevel?: string | null; envConsole?: string | null }): LogLevelConfig {
  const override = parseLogLevel(input.envLevel);
  const consoleOverride = input.envConsole?.trim().toLowerCase();
  if (!input.isPackaged) {
    return {
      file: override ?? "debug",
      console: consoleOverride === "0" || consoleOverride === "false" ? false : (override ?? "debug"),
      renderer: override ?? "debug",
    };
  }
  return {
    file: override ?? "info",
    console: consoleOverride === "1" || consoleOverride === "true" ? (override ?? "debug") : false,
    renderer: override ?? "info",
  };
}
