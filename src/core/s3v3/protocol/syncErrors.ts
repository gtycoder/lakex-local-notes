/**
 * 同步错误类型与分类（261110 从 s3v3Engine 上收）：整轮引擎与独立单条推送管线共用同一份，
 * 保证跨模块 instanceof / code 判定不分裂。引擎继续 re-export（不改既有导入路径）。
 */
export class S3v3SyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "S3v3SyncError";
  }
}

/** 同步错误分类：UI/日志据此决定是否可自动重试，或必须人工处理（分叉/损坏）。 */
export type S3v3ErrorClass = "retryable" | "action-required" | "fatal";
export function classifyS3v3Error(error: unknown): S3v3ErrorClass {
  const code = error instanceof S3v3SyncError ? error.code : (error as { code?: string } | null)?.code;
  if (code === "lock-busy" || code === "publish-conflict" || code === "cloud-changed") return "retryable";
  if (code === "empty-cloud" || code === "epoch-mismatch" || code === "generation-rollback" || code === "fork") return "action-required";
  if (code === "pointer-corrupt") return "fatal";
  // 网络/未知错误按可重试处理（S3 SDK 自身有重试；上层每轮同步会再试）
  return "retryable";
}
