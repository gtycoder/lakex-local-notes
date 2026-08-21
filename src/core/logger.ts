/**
 * 日志注入点（lake-core，V5 Phase 2）。
 * store/sync/quickNotes 不再直接 import electron-log（electron/logger.ts）；
 * 通过本接口接收 LoggerScopes（桌面默认 = electron/logger.ts 的 log，由 main.ts 装配；
 * 测试/纯逻辑默认静默实现，保持既有测试零噪音）。
 */

export interface Logger {
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
  store: Logger;
  renderer: Logger;
  perf: Logger;
}

export function createSilentLogger(): Logger {
  return { info() {}, warn() {}, error() {} };
}

export function createSilentLoggerScopes(): LoggerScopes {
  const silent = createSilentLogger();
  return { app: silent, sync: silent, s3: silent, quick: silent, history: silent, gc: silent, store: silent, renderer: silent, perf: silent };
}
