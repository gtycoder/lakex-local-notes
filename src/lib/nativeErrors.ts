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
/** 后台/非阻塞 native 动作失败：保留错误日志，避免用空 catch 静默吞掉。 */
export function reportNativeActionError(action: string, error: unknown): void {
  console.warn(`[native] ${action}失败：${getNativeErrorMessage(error)}`, error);
}
