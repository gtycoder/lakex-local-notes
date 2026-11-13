/**
 * 桌面/移动「S3 表单」的纯判定（261028 验收修复）：
 *  - 连接测试的“通过”状态按**配置指纹**绑定：保存不会让测试结果失效，改字段才失效；
 *  - 七牛 Kodo 不支持 Path-style（必须关闭），UI 要禁用并提示，保存/测试时强制忽略。
 */
import type { S3Settings } from "./types.js";

/** 只包含“连接相关”字段（不含 Secret 明文：保存后主进程会回 masked，导致指纹抖动）。
 *  单一来源已收编到 core（移动端与「开启闸门」共用同一口径）；这里保留 re-export 兼容既有导入点。 */
export { s3ConfigFingerprint } from "../core/cloudSyncGate";

/** 七牛 Kodo（qiniucs.com / qiniu 域名）：必须关闭 Path-style。 */
export function isQiniuEndpoint(endpoint: string | undefined): boolean {
  const host = (endpoint ?? "").trim().toLowerCase();
  return host.includes("qiniucs.com") || host.includes("qiniu.com") || host.includes("qiniu");
}

/** 表单实际要保存/测试的配置：七牛时强制 pathStyle=false（旧配置里误开的开关也被纠正）。 */
export function effectiveS3Settings<T extends S3Settings>(s3: T): T {
  return isQiniuEndpoint(s3.endpoint) && s3.forcePathStyle ? { ...s3, forcePathStyle: false } : s3;
}
