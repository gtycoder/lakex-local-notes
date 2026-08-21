export type NativeErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";

const CODE_PREFIX = /^\[LAKE_IPC_CODE:(NOT_FOUND|INVALID_INPUT|NOT_CONFIGURED|INTERNAL)\]\s*/;

export function getNativeErrorCode(error: unknown): NativeErrorCode | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (code === "NOT_FOUND" || code === "INVALID_INPUT" || code === "NOT_CONFIGURED" || code === "INTERNAL") return code;
  const message = error instanceof Error ? error.message : "";
  return message.match(CODE_PREFIX)?.[1] as NativeErrorCode | null;
}

export function getNativeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(CODE_PREFIX, "");
}
