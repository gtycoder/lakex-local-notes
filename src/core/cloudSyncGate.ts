/**
 * 云同步「开启闸门」（261114 用户裁决，两端同一套判据与文案）：
 * **只要没有配置 S3、或没有通过连接测试，就不能开启云同步**；点击给出「先测试通过」的可见提示。
 *
 * 为什么放 core：桌面（SettingsPanel/SyncSection）与移动端（设置 → 云端与同步）必须同口径，
 * 否则一端拦、一端放（261114 截图里的移动端就是「未配置却已开启」）。文案也只在这里写一次。
 */

export interface CloudSyncEnableGateInput {
  /** 本机是否已保存可用的 S3 配置（不是草稿里填了几个字）。 */
  configured: boolean;
  /** 当前配置是否「测试连接」通过过（按配置指纹，改了连接字段即失效）。 */
  verified: boolean;
}

export type CloudSyncEnableGate = { allowed: true } | { allowed: false; message: string };

export const CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED =
  "还没有配置 S3：请先填写连接信息并点「测试连接」，通过后才能开启云同步。";
export const CLOUD_SYNC_ENABLE_NEED_VERIFIED =
  "还没有通过连接测试：请先点「测试连接」，通过后才能开启云同步。";

export function cloudSyncEnableGate(input: CloudSyncEnableGateInput): CloudSyncEnableGate {
  if (!input.configured) return { allowed: false, message: CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED };
  if (!input.verified) return { allowed: false, message: CLOUD_SYNC_ENABLE_NEED_VERIFIED };
  return { allowed: true };
}

/** 连接相关字段的指纹（不含 Secret 明文：主进程保存后会回掩码，指纹必须稳定）。 */
export function s3ConfigFingerprint(s3: {
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
}): string {
  const trim = (value: string | undefined) => (value ?? "").trim();
  return [trim(s3.endpoint), trim(s3.region), trim(s3.bucket), trim(s3.prefix), trim(s3.accessKeyId)].join("\u0000");
}
