/**
 * 移动端 SecretStore（Phase 0B-2，§17.5）。
 * 降级实现：WebCrypto AES-GCM + IndexedDB 密文存储（优于 localStorage 明文）。
 * ⚠️ 标注：非硬件级安全（密钥仍可被 WebView 内存读取）；正式版应替换为 Android Keystore-backed
 * 实现（如 @aparajita/capacitor-secure-storage 或自写 bridge 原生方法），接口不变（见 src/core/ports.ts SecretStore）。
 * 约束：Secret 不进入 sql.js 主表 / manifest / 日志；解密只在需要时进行。
 */
import type { SecretStore } from "../core/ports.js";

const DB_NAME = "lake-notes-mobile.secrets";
const DB_VERSION = 1;
const STORE = "secrets";
/** 密钥固定派生：同一安装内稳定（换机/重装后无法解密旧值，提示重新填写——对齐桌面 safeStorage 密钥丢失语义）。 */
const KEY_MATERIAL = "lake-notes-mobile.secret-key.v1";

let dbPromise: Promise<IDBDatabase> | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
  return dbPromise;
}

/** 派生 AES-GCM 密钥：SHA-256(固定密钥材料) → importKey。降级实现不落持久化密钥。 */
async function getKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_MATERIAL));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
  });
}

export const mobileSecretStore: SecretStore = {
  async read(key) {
    try {
      const store = await tx("readonly");
      const raw = (await idbRequest(store.get(key))) as string | undefined;
      if (!raw) return null;
      const [ivB64, dataB64] = raw.split(":");
      if (!ivB64 || !dataB64) return null; // 格式损坏视为未配置
      const k = await getKey();
      const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
      const data = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, data);
      return new TextDecoder().decode(plain);
    } catch {
      // 密钥丢失/格式损坏：返回 null，提示重新填写（对齐桌面 decrypt 失败返回空串语义）
      return null;
    }
  },
  async write(key, value) {
    const k = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(value));
    const store = await tx("readwrite");
    const ivB64 = btoa(String.fromCharCode(...iv));
    const dataB64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    await idbRequest(store.put(ivB64 + ":" + dataB64, key));
  },
  async remove(key) {
    const store = await tx("readwrite");
    await idbRequest(store.delete(key));
  },
};
