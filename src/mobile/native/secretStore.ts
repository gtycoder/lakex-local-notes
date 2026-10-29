/**
 * 移动端 SecretStore 的**降级**实现：WebCrypto AES-GCM 加密 + **localStorage 存密文**。
 *
 * ⚠️ 生产路径不是这个文件：原生端用 Android Keystore（./keystoreSecretStore.ts + SecureStorePlugin.kt），
 * 本文件只在 Web/vitest 下作为后端；生产原生端始终直接使用 Android Keystore。
 *
 * 为什么不是 IndexedDB（261009 实测，改了后端）：在 Capacitor 的 Android WebView 里，
 * **IndexedDB 不跨 App 重启**——同会话写读正常、磁盘上 `app_webview/Default/IndexedDB/http_localhost_0.indexeddb.leveldb`
 * 也在，但下次启动该库被**重建为空**（探针 `onupgradeneeded` 再次触发）；同批实验里 **localStorage 跨重启仍在**。
 * 后果曾是真缺陷：保存 S3 密钥后当时能同步，重启后 secret 读回为空、所有 S3 操作报
 * "The request signature we calculated does not match the signature you provided"。
 * ⇒ 密文改存 localStorage：仍是密文（不是明文），且跨重启可用。
 *
 * ⚠️ 仍**非硬件级安全**：密钥材料固定派生、WebView 内存可读。正式版应替换为 Android Keystore-backed
 * 实现（如 @aparajita/capacitor-secure-storage 或自写 bridge 原生方法），接口不变（见 src/core/ports.ts SecretStore）。
 * 约束：Secret 不进入 SQLite 主表 / manifest / 日志；解密只在需要时进行。
 */
import type { SecretStore } from "../../core/ports.js";
import { keystoreAvailable, keystoreSecretStore } from "./keystoreSecretStore";

/** localStorage 键前缀（密文；格式 ivB64:dataB64）。 */
const LS_PREFIX = "lakex-local-notes-mobile.secret.";
/** 密钥固定派生：同一安装内稳定（换机/重装后无法解密旧值，提示重新填写——对齐桌面 safeStorage 密钥丢失语义）。 */
const KEY_MATERIAL = "lakex-local-notes-mobile.secret-key.v1";

let keyPromise: Promise<CryptoKey> | null = null;

/** 派生 AES-GCM 密钥：SHA-256(固定密钥材料) → importKey。降级实现不落持久化密钥。 */
async function getKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_MATERIAL));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}

async function encrypt(plain: string): Promise<string> {
  const k = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plain));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const dataB64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  return ivB64 + ":" + dataB64;
}

async function decrypt(raw: string): Promise<string | null> {
  const [ivB64, dataB64] = raw.split(":");
  if (!ivB64 || !dataB64) return null; // 格式损坏视为未配置
  const k = await getKey();
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, data);
  return new TextDecoder().decode(plain);
}

export const localStorageSecretStore: SecretStore = {
  async read(key) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? await decrypt(raw) : null;
    } catch {
      // 密钥丢失/格式损坏：返回 null，提示重新填写（对齐桌面 decrypt 失败返回空串语义）
      return null;
    }
  },
  async write(key, value) {
    // 写失败要抛（调用方 saveS3Settings 需要知道"没存住"），不要静默降级成"看起来保存成功"。
    localStorage.setItem(LS_PREFIX + key, await encrypt(value));
  },
  async remove(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch { /* localStorage 被禁用：删除失败等同不存在（读取路径会解密失败返回 null） */ }
  },
};

/** 生产入口：原生可用 → Keystore；否则 → localStorage 降级件（Web/vitest）。 */
export const mobileSecretStore: SecretStore = keystoreAvailable()
  ? keystoreSecretStore
  : localStorageSecretStore;
