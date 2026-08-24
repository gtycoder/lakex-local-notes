import type { S3Settings } from "./types";

/**
 * 顶栏工作空间显示名：只有云同步已启用且存在 S3 配置时才暴露远端对象前缀。
 * 云同步关闭、未配置 S3 或前缀为空时，仍显示本地空间，避免让用户误以为
 * 当前正在使用远端工作区。
 */
export function getWorkspaceDisplayName(cloudEnabled: boolean, s3: Pick<S3Settings, "prefix"> | null): string {
  const prefix = s3?.prefix.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return cloudEnabled && prefix ? prefix : "本地空间";
}
