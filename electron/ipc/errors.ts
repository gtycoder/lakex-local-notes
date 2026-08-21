export type IpcErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";

export interface IpcErrorPayload {
  name: string;
  message: string;
  code: IpcErrorCode;
}

export const IPC_ERROR_MARKER = "__LAKE_IPC_ERROR__";
export const IPC_ERROR_PREFIX = "[LAKE_IPC_CODE:";

function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return value === "NOT_FOUND" || value === "INVALID_INPUT" || value === "NOT_CONFIGURED" || value === "INTERNAL";
}

/** Convert arbitrary main-process failures to a small, serializable IPC envelope. */
export function toIpcErrorPayload(error: unknown): IpcErrorPayload {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = value && typeof value.message === "string" ? value.message : String(error);
  const name = value && typeof value.name === "string" ? value.name : "IpcError";
  return {
    name,
    message,
    code: isIpcErrorCode(value?.code) ? value.code : "INTERNAL",
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
          return { name: payload.name, message: payload.message, code: payload.code };
        }
      }
    } catch { /* fall through to the prefix fallback */ }
  }
  const match = message.match(/\[LAKE_IPC_CODE:(NOT_FOUND|INVALID_INPUT|NOT_CONFIGURED|INTERNAL)\]\s*([\s\S]*?)(?:\s+__LAKE_IPC_ERROR__.*)?$/);
  if (!match) return null;
  return { name: "IpcError", message: match[2], code: match[1] as IpcErrorCode };
}
