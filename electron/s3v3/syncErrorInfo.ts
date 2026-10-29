/**
 * 同步错误的「码 + 分类」：主进程各 catch 点共用的单一来源（261028 P1）。
 *
 * 为什么要它：S3v3SyncError 的 code 与 classifyS3v3Error 的分类在桌面有三处消费
 * （IPC envelope / 自动同步广播 / 同步诊断），各写一遍必然漂移；而 IPC 只认 Error 上的
 * syncCode/syncClass 字段（Electron 丢自定义字段，见 electron/ipc/errors.ts），所以这里统一「读 → 挂」。
 */
import { classifyS3v3Error, type S3v3ErrorClass } from "../../src/core/s3v3Engine.js";

export interface SyncErrorInfo {
  /** 同步域错误码；未知错误统一为 "unknown"（渲染层只对已知码做特殊文案）。 */
  code: string;
  className: S3v3ErrorClass;
}

function isSyncErrorClass(value: unknown): value is S3v3ErrorClass {
  return value === "retryable" || value === "action-required" || value === "fatal";
}

/** 读错误上的 code（S3v3SyncError.code 或任意 Error.code）→ 分类；已挂过的字段优先。 */
export function readSyncErrorInfo(error: unknown): SyncErrorInfo {
  const value = error && typeof error === "object"
    ? error as { syncCode?: unknown; syncClass?: unknown; code?: unknown }
    : null;
  const attachedCode = typeof value?.syncCode === "string" && value.syncCode.length > 0 ? value.syncCode : null;
  const rawCode = typeof value?.code === "string" && value.code.length > 0 ? value.code : null;
  const className = isSyncErrorClass(value?.syncClass) ? value.syncClass : classifyS3v3Error(error);
  return { code: attachedCode ?? rawCode ?? "unknown", className };
}

/** 把 code/class 挂到 Error 上（IPC envelope 读 syncCode/syncClass；非 Error 先包一层保留 message）。 */
export function annotateSyncError(error: unknown, info: SyncErrorInfo = readSyncErrorInfo(error)): Error {
  const source = error as { message?: unknown } | null;
  const target = error instanceof Error
    ? error
    : new Error(typeof source?.message === "string" && source.message ? source.message : String(error));
  Object.defineProperty(target, "syncCode", { value: info.code, enumerable: true, configurable: true });
  Object.defineProperty(target, "syncClass", { value: info.className, enumerable: true, configurable: true });
  return target;
}
