/**
 * 日志注入点（lake-core，V5 Phase 2）。
 * store/sync/quickNotes 不再直接 import electron-log（electron/logger.ts）；
 * 通过本接口接收 LoggerScopes（桌面默认 = electron/logger.ts 的 log，由 main.ts 装配；
 * 测试/纯逻辑默认静默实现，保持既有测试零噪音）。
 *
 * 261023：补 debug 级别 —— 正式环境由 electron-log 的 file level=info 过滤，调用点不必自己判环境。
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface LoggerScopes {
  app: Logger;
  sync: Logger;
  s3: Logger;
  quick: Logger;
  history: Logger;
  gc: Logger;
  trash: Logger;
  store: Logger;
  renderer: Logger;
  perf: Logger;
}

export function createSilentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

export function createSilentLoggerScopes(): LoggerScopes {
  const silent = createSilentLogger();
  return { app: silent, sync: silent, s3: silent, quick: silent, history: silent, gc: silent, trash: silent, store: silent, renderer: silent, perf: silent };
}
