export class AppError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_INPUT" | "INTERNAL";
  constructor(public readonly kind: "NotFound" | "InvalidInput" | "Internal", message: string) {
    super(message);
    this.name = "AppError";
    this.code = kind === "NotFound" ? "NOT_FOUND" : kind === "InvalidInput" ? "INVALID_INPUT" : "INTERNAL";
  }
}
