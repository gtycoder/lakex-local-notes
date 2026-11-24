/**
 * 桌面默认 SecretCipher：**本机加密**（AES-256-GCM + 每安装随机钥匙文件 machine.key）。
 *
 * 261201 用户裁决：从 Electron safeStorage（macOS Keychain）切换为本机加密——临时签名包每次
 * 构建都被系统索要钥匙串授权（弹窗烦扰）。安全口径 = **防误读、非安全边界**（与
 * `src/core/s3ConfigTransfer.ts` 迁移码同款口径）；**绝不明文落盘**的红线不变。
 *
 * - 格式：`enc:v2:` + base64(nonce(12) | tag(16) | ciphertext)；钥匙 = `<userData>/machine.key`，
 *   首次使用生成 32 随机字节（0600、临时文件 + rename 原子落盘）。
 * - **machine.key 在 userData 根、不在 workspace** ⇒ 不进整库备份 / 便携包 / 历史快照（只进不出）；
 *   换机/恢复后旧密文解不开 ⇒ 「视为未配置」口径（settingsRepository 既有语义），重新填写即可，
 *   跨机迁移密钥走 S3 配置导出（LLN1 迁移码，另一层加密，语义不变）。
 * - 读路径兼容 `enc:v1:`（safeStorage 旧密文）：能解就解，**下次保存自动换 v2**（惰性迁移）；
 *   解不开（safeStorage 不可用/换机）返回 ""（未配置）。写路径一律 v2。
 * - fail-closed 口径变化（261201）：旧「safeStorage 不可用拒保存」→ 新「本地加密恒可用；
 *   钥匙文件不可写才拒绝保存」——任何情况下都不落明文。
 */
import { safeStorage } from "electron";
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SecretCipher } from "../src/core/secretCipher.js";

const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** 老格式（safeStorage / macOS Keychain）解密：**只服务一次性迁移清扫**（261204 钥匙串退役：settingsRepository.migrateLegacySecrets 解一次即换写 v2；全员迁移后本分支可整体删除）。不可用/失败一律 ""（未配置口径）。 */
function legacyDecrypt(payload: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(payload, "base64"));
  } catch (error) {
    console.warn("[store] 旧格式（v1）密文解密失败，按未配置处理:", error);
    return "";
  }
}

/** 读取或首次生成 machine.key。损坏（长度不符）⇒ 抛错拒用（宁可拒绝保存，不静默换钥丢密文）。 */
function ensureKeyFile(keyPath: string): Buffer {
  try {
    const existing = readFileSync(keyPath);
    if (existing.length !== KEY_BYTES) {
      throw new Error(`钥匙文件损坏（长度 ${existing.length}，应为 ${KEY_BYTES}）：${keyPath}——删除后需重新填写 S3/AI 密钥`);
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  const tmp = `${keyPath}.tmp-${process.pid}`;
  writeFileSync(tmp, key, { mode: 0o600 });
  renameSync(tmp, keyPath);
  try { chmodSync(keyPath, 0o600); } catch { /* Windows 无 POSIX 权限位；文件系统 ACL 由系统管理 */ }
  return key;
}

/**
 * 本机加密 SecretCipher。`userDataDir` **必须传 userData 根（workspace 的父级）**——
 * 钥匙文件落 `<userData>/machine.key`，在工作区之外 ⇒ 结构性排除出一切备份/导出。
 */
export function createLocalSecretCipher(userDataDir: string): SecretCipher {
  const keyPath = path.join(userDataDir, "machine.key");
  return {
    encrypt(value: string): string {
      // 钥匙不可用/不可写 ⇒ 抛错拒保存（fail-closed 换口径：绝不落明文）。
      const key = ensureKeyFile(keyPath);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return V2_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString("base64");
    },
    decrypt(value: string): string {
      try {
        if (value.startsWith(V2_PREFIX)) {
          const blob = Buffer.from(value.slice(V2_PREFIX.length), "base64");
          if (blob.length < NONCE_BYTES + TAG_BYTES) return "";
          const key = ensureKeyFile(keyPath);
          const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, NONCE_BYTES));
          decipher.setAuthTag(blob.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
          return Buffer.concat([decipher.update(blob.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
        }
        if (value.startsWith(V1_PREFIX)) return legacyDecrypt(value.slice(V1_PREFIX.length));
        // S2：旧明文格式不再放行——返回空串提示重配（既有口径不变）。
        console.warn("[store] S3 Secret 为非当前加密格式（旧明文），请重新配置");
        return "";
      } catch (error) {
        console.warn("[store] 密文解密失败（钥匙丢失/换机/损坏），按未配置处理:", error);
        return "";
      }
    },
  };
}

// 旧工厂名已随 261201 裁决移除（safeStorage 只剩 v1 读路径）；调用方一律 createLocalSecretCipher(userDataDir)。
