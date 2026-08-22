/** 主进程领域错误（V5 Phase 3）：基础 4 kind + 增量 Conflict / NetworkTimeout / Cancelled（跨端错误码）。 */
export class AppError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL" | "CONFLICT" | "NETWORK_TIMEOUT" | "CANCELLED";
  constructor(
    public readonly kind: "NotFound" | "InvalidInput" | "NotConfigured" | "Internal" | "Conflict" | "NetworkTimeout" | "Cancelled",
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    this.code = kind === "NotFound" ? "NOT_FOUND"
      : kind === "InvalidInput" ? "INVALID_INPUT"
      : kind === "NotConfigured" ? "NOT_CONFIGURED"
      : kind === "Conflict" ? "CONFLICT"
      : kind === "NetworkTimeout" ? "NETWORK_TIMEOUT"
      : kind === "Cancelled" ? "CANCELLED"
      : "INTERNAL";
  }
}
