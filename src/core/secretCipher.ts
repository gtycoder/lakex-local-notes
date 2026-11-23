/**
 * 密钥加解密注入点（lake-core，V5 Phase 2）。
 * 桌面默认实现 = 本机加密（AES-256-GCM + machine.key，见 electron/secretCipher.ts；261201 裁决，
 * 原 Electron safeStorage/Keychain 只剩 enc:v1: 旧密文的读路径迁移）；纯逻辑/测试环境可用明文回退
 * 实现（createPlaintextSecretCipher）。
 * 存储格式约定：`enc:v2:` = 本机加密（nonce|tag|ct），`enc:v1:` = 旧 safeStorage 密文（只读迁移）；
 * 非 enc: 前缀视为旧明文，decrypt 不再放行、返回空串提示重配（S2）。
 */

export interface SecretCipher {
  /** 加密后落盘值；加密不可用时允许明文回退（实现负责告警）。 */
  encrypt(value: string): string;
  /** 解密存储值；无法解密（密钥丢失/换机）返回空串，提示用户重新填写。 */
  decrypt(value: string): string;
}

/** 明文回退实现：测试/纯逻辑环境的降级路径（生产桌面走本机加密，永不落明文）。 */
export function createPlaintextSecretCipher(): SecretCipher {
  return {
    encrypt(value: string): string {
      return value;
    },
    decrypt(value: string): string {
      // enc: 前缀 = 别的实现写的密文，明文桩解不开 ⇒ ""（未配置口径，不当明文返回）。
      return value.startsWith("enc:") ? "" : value;
    },
  };
}
