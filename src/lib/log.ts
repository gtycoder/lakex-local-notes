/**
 * 渲染层日志（261023）：统一走 console.*（主进程 console-message 转发落盘），但**分级由这里管**。
 *
 * 口径（docs/LOGGING.md）：
 * - debug：只在开发环境输出（import.meta.env.DEV）；正式环境一律静默，避免内核/React 调试噪音。
 * - info / warn / error：正式环境也输出（主进程按级别落盘，正式 file=info）。
 * - perf：**info 级**。关键流程耗时/数据量在正式环境也必须留，后续做针对性性能优化靠它。
 *
 * 用法：
 *   rlog.debug("paste", "开始解析", { bytes });
 *   rlog.error("editor", "保存失败", error, { noteId });
 *   rlog.perf("paste.html", ms, { bytes, getData, guard });
 */
import { errorFields, formatLogFields, perfMessage, type LogFields } from "../core/logFormat";

export type RendererLogLevel = "error" | "warn" | "info" | "debug";

export interface RendererLogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RendererLogOptions {
  /** 开发环境 = true：debug 才输出。 */
  debugEnabled: boolean;
  sink?: RendererLogSink;
}

export interface RendererLog {
  readonly debugEnabled: boolean;
  debug(scope: string, message: string, fields?: LogFields): void;
  info(scope: string, message: string, fields?: LogFields): void;
  warn(scope: string, message: string, fields?: LogFields): void;
  /** error 放在第三个参数：调用点直接传异常对象，字段（如 noteId）随后。 */
  error(scope: string, message: string, error?: unknown, fields?: LogFields): void;
  /** 关键流程耗时（info 级，正式环境也留）。 */
  perf(label: string, ms: number, fields?: LogFields): void;
}

const CONSOLE_SINK: RendererLogSink = {
  debug: (message) => console.debug(message),
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export function createRendererLog(options: RendererLogOptions): RendererLog {
  const sink = options.sink ?? CONSOLE_SINK;
  const line = (scope: string, message: string, fields?: LogFields) => "[" + scope + "] " + message + formatLogFields(fields);
  return {
    debugEnabled: options.debugEnabled,
    debug(scope, message, fields) {
      if (options.debugEnabled) sink.debug(line(scope, message, fields));
    },
    info(scope, message, fields) {
      sink.info(line(scope, message, fields));
    },
    warn(scope, message, fields) {
      sink.warn(line(scope, message, fields));
    },
    error(scope, message, error, fields) {
      sink.error(line(scope, message, { ...errorFields(error), ...fields }));
    },
    perf(label, ms, fields) {
      sink.info(perfMessage(label, ms, fields));
    },
  };
}

/** 应用内单例：正式环境 debug 自动静默。 */
export const rlog: RendererLog = createRendererLog({ debugEnabled: Boolean(import.meta.env?.DEV) });
