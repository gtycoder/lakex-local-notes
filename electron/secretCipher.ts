/** 桌面默认 SecretCipher：Electron safeStorage（macOS Keychain）。 */
import { safeStorage } from "electron";
import { Buffer } from "node:buffer";
import type { SecretCipher } from "../src/core/secretCipher.js";

export function createSafeStorageSecretCipher(): SecretCipher {
  return {
    encrypt(value: string): string {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return `enc:v1:${safeStorage.encryptString(value).toString("base64")}`;
        }
      } catch (error) {
        console.warn("[store] safeStorage 加密不可用，S3 Secret 将明文保存:", error);
      }
      return value;
    },
    decrypt(value: string): string {
      if (!value.startsWith("enc:v1:")) return value; // 旧版明文数据
      try {
        return safeStorage.decryptString(Buffer.from(value.slice("enc:v1:".length), "base64"));
      } catch (error) {
        // 密钥串丢失/换机：无法解密时返回空串，提示用户重新填写
        console.warn("[store] S3 Secret 解密失败，请重新填写:", error);
        return "";
      }
    },
  };
}
