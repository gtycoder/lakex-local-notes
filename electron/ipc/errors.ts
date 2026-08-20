export type IpcErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";

export interface IpcErrorPayload {
  name: string;
  message: string;
  code: IpcErrorCode;
}

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
