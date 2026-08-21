/**
 * 密钥加解密注入点（lake-core，V5 Phase 2）。
 * 桌面默认实现 = Electron safeStorage（macOS Keychain），由主进程装配注入；
 * 纯逻辑/测试环境可用明文回退实现（createPlaintextSecretCipher）。
 * 存储格式约定：加密值带 "enc:v1:" 前缀 + base64；旧版明文无前缀，decrypt 原样返回。
 */

export interface SecretCipher {
  /** 加密后落盘值；加密不可用时允许明文回退（实现负责告警）。 */
  encrypt(value: string): string;
  /** 解密存储值；无法解密（密钥丢失/换机）返回空串，提示用户重新填写。 */
  decrypt(value: string): string;
}

/** 明文回退实现：加密不可用时的降级路径（与 safeStorage 不可用行为一致）。 */
export function createPlaintextSecretCipher(): SecretCipher {
  return {
    encrypt(value: string): string {
      return value;
    },
    decrypt(value: string): string {
      return value.startsWith("enc:v1:") ? "" : value;
    },
  };
}
