export type IpcErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";

/** 同步错误分类（与 src/core/s3v3Engine.ts 的 S3v3ErrorClass 同口径，跨 IPC 只走字符串）。 */
export type IpcSyncErrorClass = "retryable" | "action-required" | "fatal";

export interface IpcErrorPayload {
  name: string;
  message: string;
  code: IpcErrorCode;
  /** 同步域错误码（S3v3SyncError.code，如 lock-busy / epoch-mismatch）；非同步错误不带。 */
  syncCode?: string;
  /** 同步错误分类：渲染层据此区分「可自动重试」与「必须人工处理」（261028 P1）。 */
  syncClass?: IpcSyncErrorClass;
}

export const IPC_ERROR_MARKER = "__LAKE_IPC_ERROR__";
export const IPC_ERROR_PREFIX = "[LAKE_IPC_CODE:";

const SYNC_CODE_MAX_LENGTH = 64;

function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return value === "NOT_FOUND" || value === "INVALID_INPUT" || value === "NOT_CONFIGURED" || value === "INTERNAL";
}

function isIpcSyncErrorClass(value: unknown): value is IpcSyncErrorClass {
  return value === "retryable" || value === "action-required" || value === "fatal";
}

/** 只接受短字符串：过长的「码」更像被误当成字段的其它数据，宁可不透传。 */
function readSyncCode(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= SYNC_CODE_MAX_LENGTH ? value : undefined;
}

function readSyncClass(value: unknown): IpcSyncErrorClass | undefined {
  return isIpcSyncErrorClass(value) ? value : undefined;
}

/** Convert arbitrary main-process failures to a small, serializable IPC envelope. */
export function toIpcErrorPayload(error: unknown): IpcErrorPayload {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = value && typeof value.message === "string" ? value.message : String(error);
  const name = value && typeof value.name === "string" ? value.name : "IpcError";
  const syncCode = readSyncCode(value?.syncCode);
  const syncClass = readSyncClass(value?.syncClass);
  return {
    name,
    message,
    code: isIpcErrorCode(value?.code) ? value.code : "INTERNAL",
    // 白名单透传：其余自定义字段一律不序列化（避免泄漏/体积）。
    ...(syncCode ? { syncCode } : {}),
    ...(syncClass ? { syncClass } : {}),
  };
}

/** Electron strips custom Error fields when rejecting ipcRenderer.invoke; encode only a marker payload. */
export function encodeIpcError(error: unknown): Error {
  const payload = toIpcErrorPayload(error);
  const wrapped = new Error(`${IPC_ERROR_PREFIX}${payload.code}] ${payload.message} ${IPC_ERROR_MARKER}${JSON.stringify(payload)}`);
  wrapped.name = payload.name;
  return wrapped;
}

export function parseIpcError(message: unknown): IpcErrorPayload | null {
  if (typeof message !== "string") return null;
  const marker = message.lastIndexOf(IPC_ERROR_MARKER);
  if (marker >= 0) {
    try {
      const value: unknown = JSON.parse(message.slice(marker + IPC_ERROR_MARKER.length));
      if (value && typeof value === "object") {
        const payload = value as Record<string, unknown>;
        if (typeof payload.name === "string" && typeof payload.message === "string" && isIpcErrorCode(payload.code)) {
          const syncCode = readSyncCode(payload.syncCode);
          const syncClass = readSyncClass(payload.syncClass);
          return {
            name: payload.name,
            message: payload.message,
            code: payload.code,
            ...(syncCode ? { syncCode } : {}),
            ...(syncClass ? { syncClass } : {}),
          };
        }
      }
    } catch { /* fall through to the prefix fallback */ }
  }
  const match = message.match(/\[LAKE_IPC_CODE:(NOT_FOUND|INVALID_INPUT|NOT_CONFIGURED|INTERNAL)\]\s*([\s\S]*?)(?:\s+__LAKE_IPC_ERROR__.*)?$/);
  if (!match) return null;
  return { name: "IpcError", message: match[2], code: match[1] as IpcErrorCode };
}
