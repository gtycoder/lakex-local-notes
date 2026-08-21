export class AppError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL";
  constructor(public readonly kind: "NotFound" | "InvalidInput" | "NotConfigured" | "Internal", message: string) {
    super(message);
    this.name = "AppError";
    this.code = kind === "NotFound" ? "NOT_FOUND" : kind === "InvalidInput" ? "INVALID_INPUT" : kind === "NotConfigured" ? "NOT_CONFIGURED" : "INTERNAL";
  }
}
