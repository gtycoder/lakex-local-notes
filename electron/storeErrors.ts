export class AppError extends Error {
  constructor(public readonly kind: "NotFound" | "InvalidInput" | "Internal", message: string) {
    super(message);
    this.name = "AppError";
  }
}
