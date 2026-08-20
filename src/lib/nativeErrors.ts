export type NativeErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";

export function getNativeErrorCode(error: unknown): NativeErrorCode | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return code === "NOT_FOUND" || code === "INVALID_INPUT" || code === "NOT_CONFIGURED" || code === "INTERNAL" ? code : null;
}

export function getNativeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
