/** 跨端错误码（V5 Phase 3）：基础 4 码 + 增量 CONFLICT / NETWORK_TIMEOUT / CANCELLED。 */
export type NativeErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL" | "CONFLICT" | "NETWORK_TIMEOUT" | "CANCELLED";

const CODE_PREFIX = /^\[LAKE_IPC_CODE:(NOT_FOUND|INVALID_INPUT|NOT_CONFIGURED|INTERNAL|CONFLICT|NETWORK_TIMEOUT|CANCELLED)\]\s*/;
const ALL_CODES = new Set<NativeErrorCode>(["NOT_FOUND", "INVALID_INPUT", "NOT_CONFIGURED", "INTERNAL", "CONFLICT", "NETWORK_TIMEOUT", "CANCELLED"]);

export function getNativeErrorCode(error: unknown): NativeErrorCode | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && ALL_CODES.has(code as NativeErrorCode)) return code as NativeErrorCode;
  const message = error instanceof Error ? error.message : "";
  return message.match(CODE_PREFIX)?.[1] as NativeErrorCode | null;
}

export function getNativeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(CODE_PREFIX, "");
}

/** 同步错误分类（与主进程 S3v3ErrorClass 同口径，跨 IPC 只走字符串）。 */
export type NativeSyncErrorClass = "retryable" | "action-required" | "fatal";

export interface NativeSyncErrorInfo {
  /** 同步域错误码（S3v3SyncError.code，如 lock-busy / epoch-mismatch）。 */
  code: string;
  className: NativeSyncErrorClass;
}

const SYNC_CODE_MAX_LENGTH = 64;

function isNativeSyncErrorClass(value: unknown): value is NativeSyncErrorClass {
  return value === "retryable" || value === "action-required" || value === "fatal";
}

/**
 * 读取主进程经 IPC envelope 透传的同步错误「码 + 分类」（261028 P1）。
 * 两个字段都合法才返回；普通错误（没有同步上下文）返回 null，调用方按原来的错误路径处理。
 */
export function getNativeSyncErrorInfo(error: unknown): NativeSyncErrorInfo | null {
  if (!error || typeof error !== "object") return null;
  const { syncCode, syncClass } = error as { syncCode?: unknown; syncClass?: unknown };
  if (typeof syncCode !== "string" || syncCode.length === 0 || syncCode.length > SYNC_CODE_MAX_LENGTH) return null;
  if (!isNativeSyncErrorClass(syncClass)) return null;
  return { code: syncCode, className: syncClass };
}

/** 后台/非阻塞 native 动作失败：保留错误日志，避免用空 catch 静默吞掉。 */
export function reportNativeActionError(action: string, error: unknown): void {
  console.warn(`[native] ${action}失败：${getNativeErrorMessage(error)}`, error);
}
