/** 桌面默认 SecretCipher：Electron safeStorage（macOS Keychain）。 */
import { safeStorage } from "electron";
import { Buffer } from "node:buffer";
import type { SecretCipher } from "../src/core/secretCipher.js";

/**
 * safeStorage 是否可用于**真正加密**：不可用、或 Linux 的 basic_text 后端（等同明文）都算不可用。
 * 任一步探测异常一律 fail-closed（返回 false）。
 */
function canEncrypt(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const backend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
    return backend !== "basic_text";
  } catch {
    return false;
  }
}

export function createSafeStorageSecretCipher(): SecretCipher {
  return {
    encrypt(value: string): string {
      if (canEncrypt()) {
        try {
          return `enc:v1:${safeStorage.encryptString(value).toString("base64")}`;
        } catch (error) {
          console.warn("[store] safeStorage 加密失败:", error);
        }
      }
      // fail-closed：宁可拒绝保存，也不把 S3 Secret 明文落盘（旧实现是静默明文）。
      throw new Error("系统安全存储不可用，无法加密保存 S3 Secret（请启用系统钥匙串后重试）");
    },
    decrypt(value: string): string {
      if (!value.startsWith("enc:v1:")) {
        // S2：不再接受旧明文格式——明确提示重新配置，而不是原样返回明文。
        console.warn("[store] S3 Secret 为非当前加密格式（旧明文），请重新配置");
        return "";
      }
      try {
        return safeStorage.decryptString(Buffer.from(value.slice("enc:v1:".length), "base64"));
      } catch (error) {
        console.warn("[store] S3 Secret 解密失败，请重新填写:", error);
        return "";
      }
    },
  };
}