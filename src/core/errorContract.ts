/**
 * 跨端错误码单一来源（261107）：主进程 AppError / IPC envelope / 渲染层解析共用这一份。
 * 此前 core 7 码、IPC 只认 4 码：CONFLICT / NETWORK_TIMEOUT / CANCELLED 一旦经 IPC 会被降级成 INTERNAL。
 * 只放「码」与合法性判断，不放文案/分类（那些属于各自领域）。
 */
export const LAKE_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_INPUT",
  "NOT_CONFIGURED",
  "INTERNAL",
  "CONFLICT",
  "NETWORK_TIMEOUT",
  "CANCELLED",
] as const;

export type LakeErrorCode = (typeof LAKE_ERROR_CODES)[number];

const LAKE_ERROR_CODE_SET: ReadonlySet<string> = new Set(LAKE_ERROR_CODES);

export function isLakeErrorCode(value: unknown): value is LakeErrorCode {
  return typeof value === "string" && LAKE_ERROR_CODE_SET.has(value);
}

/** 给 IPC/渲染层拼前缀正则用（Transfer 编码与解析保持同一来源）。 */
export const LAKE_ERROR_CODE_PATTERN = LAKE_ERROR_CODES.join("|");
