/**
 * AI 连接的「测试通过」状态（对齐桌面 S3 的 s3Verified / s3ConfigFingerprint 模式）。
 *
 * 规则（261029 用户点单：防御式开启）：
 *  - **测试通过** ⇒ 记住当时那份**连接配置的指纹**；
 *  - **保存**只要没改连接相关字段 ⇒ 指纹不变 ⇒ 测试结果继续有效；
 *  - 改 Base URL / 模型 / 换 Key / 清 Key ⇒ 指纹变化 ⇒ 自动失效，必须重新测试；
 *  - 指纹只含脱敏信息（有无 Key + 尾号），**不含 Key 明文**；
 *  - 模块级缓存：设置页关闭再打开仍保留（同一份配置 = 同一次测试结果，避免"重开设置又要重测"）。
 *
 * 开关侧：未验证时只允许"关闭"，不允许"开启"（与桌面「启用云同步」同一口径）。
 */
export interface AiConnectionIdentity {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyTail: string;
}

/** 连接配置指纹：连接相关字段 + Key 的存在性/尾号（不含明文）。 */
export function aiConnectionFingerprint(identity: AiConnectionIdentity): string {
  const trim = (v: string | undefined) => (v ?? "").trim();
  return [
    trim(identity.baseUrl),
    trim(identity.model),
    identity.hasKey ? "key" : "nokey",
    trim(identity.keyTail),
  ].join("\u0000");
}

let verifiedAiFingerprint: string | null = null;

export function getVerifiedAiFingerprint(): string | null {
  return verifiedAiFingerprint;
}

export function markAiConnectionVerified(fingerprint: string): void {
  verifiedAiFingerprint = fingerprint;
}

export function invalidateAiConnectionVerified(): void {
  verifiedAiFingerprint = null;
}
