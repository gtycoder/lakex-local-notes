/**
 * 移动端 SecretStore 的**降级**实现：WebCrypto AES-GCM 加密 + **localStorage 存密文**。
 *
 * ⚠️ 生产路径不是这个文件：原生端用 Android Keystore（./keystoreSecretStore.ts + SecureStorePlugin.kt），
 * 本文件只在 Web/vitest 下作为后端，并在**首次读取时把旧值迁移**到 Keystore（见下方组合层）。
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
const LS_PREFIX = "lake-notes-mobile.secret.";
/** 旧实现（IndexedDB）留下的库：只在 read 时兜底迁移一次，不再写入。 */
const LEGACY_DB = "lake-notes-mobile.secrets";
const LEGACY_STORE = "secrets";
/** 密钥固定派生：同一安装内稳定（换机/重装后无法解密旧值，提示重新填写——对齐桌面 safeStorage 密钥丢失语义）。 */
const KEY_MATERIAL = "lake-notes-mobile.secret-key.v1";
const SECRET_MIGRATION_MARKER_PREFIX = "lake-notes-mobile.secret-migrated.";

function secretMigrationMarker(key: string): string {
  return SECRET_MIGRATION_MARKER_PREFIX + key;
}

function isSecretMigrationDone(key: string, migrated: Set<string>): boolean {
  if (migrated.has(key)) return true;
  try { return localStorage.getItem(secretMigrationMarker(key)) === "1"; }
  catch { return false; }
}

function markSecretMigrationDone(key: string, migrated: Set<string>): void {
  migrated.add(key);
  try { localStorage.setItem(secretMigrationMarker(key), "1"); } catch { /* 标不上只会多跑一次幂等迁移 */ }
}

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

/** 旧 IndexedDB 值兜底读取（环境不支持 IndexedDB 或库不存在 → null）。 */
function readLegacy(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(LEGACY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(LEGACY_STORE)) return resolve(null);
          const get = db.transaction(LEGACY_STORE, "readonly").objectStore(LEGACY_STORE).get(key);
          get.onsuccess = () => resolve(typeof get.result === "string" ? get.result : null);
          get.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/** 迁移成功后清掉旧 IDB 条目（清不掉也不影响：值已在 localStorage）。 */
function removeLegacy(key: string): void {
  try {
    if (typeof indexedDB === "undefined") return;
    const req = indexedDB.open(LEGACY_DB, 1);
    req.onsuccess = () => {
      try {
        const db = req.result;
        if (db.objectStoreNames.contains(LEGACY_STORE)) db.transaction(LEGACY_STORE, "readwrite").objectStore(LEGACY_STORE).delete(key);
      } catch { /* ignore */ }
    };
  } catch { /* ignore */ }
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
    try { localStorage.removeItem(LS_PREFIX + key); } catch { /* ignore */ }
  },
};

/** 仅在一次性迁移窗口使用：承接 IndexedDB / localStorage 两代旧密文。 */
const legacySecretStore: SecretStore = {
  async read(key) {
    const current = await localStorageSecretStore.read(key);
    if (current != null) return current;
    try {
      const legacy = await readLegacy(key);
      if (!legacy) return null;
      const plain = await decrypt(legacy);
      if (plain == null) return null;
      try { localStorage.setItem(LS_PREFIX + key, legacy); removeLegacy(key); } catch { /* 本次仍可返回旧值 */ }
      return plain;
    } catch { return null; }
  },
  write: (key, value) => localStorageSecretStore.write(key, value),
  async remove(key) {
    await localStorageSecretStore.remove(key);
    removeLegacy(key);
  },
};

/**
 * 组合层：优先用 native（Keystore）；native 没有该键时，从 legacy（localStorage 密文）读一次并**迁移**过去，
 * 迁移成功后清掉旧值（此后 secret 不再留在 WebView 存储里）。
 * 写/删只走 native —— 这正是"正解"，降级件仅用于承接历史值。
 */
export function createMigratingSecretStore(native: SecretStore, legacy: SecretStore, options: {
  isDone?: (key: string) => boolean;
  markDone?: (key: string) => void;
  cleanLegacyOnWrite?: boolean;
} = {}): SecretStore {
  /** 已做过旧副本清理的键（一次性；避免每次读都去碰 IndexedDB 兜底）。 */
  const legacyCleaned = new Set<string>();
  return {
    async read(key) {
      if (options.isDone?.(key)) return native.read(key);
      const fromNative = await native.read(key);
      if (fromNative != null) {
        // 一次性清理残留旧副本：早期版本的迁移**只在 native 为空时**清 legacy，
        // native 已有值（例如上一次启动已迁过）时旧密文会一直留在 WebView 存储里 —— 实测踩到（261010）。
        if (!legacyCleaned.has(key)) {
          legacyCleaned.add(key);
          try { await legacy.remove(key); } catch { /* 清不掉不影响本次读取 */ }
        }
        options.markDone?.(key);
        return fromNative;
      }
      const old = await legacy.read(key);
      if (old == null) { options.markDone?.(key); return null; }
      try {
        await native.write(key, old);
        await legacy.remove(key);
        options.markDone?.(key);
      } catch {
        // 迁移失败：本次仍返回旧值（别让用户当场丢掉密钥），下次读再试
      }
      return old;
    },
    async write(key, value) {
      await native.write(key, value);
      if (options.cleanLegacyOnWrite !== false) {
        try { await legacy.remove(key); } catch { /* ignore */ }
      }
      options.markDone?.(key);
    },
    async remove(key) {
      await native.remove(key);
      await legacy.remove(key);   // 双清：避免旧值残留又被迁移回来
      options.markDone?.(key);
    },
  };
}

/** 生产入口：原生可用 → Keystore（+ 迁移）；否则 → localStorage 降级件（Web/vitest）。 */
const secretMigrationDone = new Set<string>();
export const mobileSecretStore: SecretStore = keystoreAvailable()
  ? createMigratingSecretStore(keystoreSecretStore, legacySecretStore, {
    isDone: (key) => isSecretMigrationDone(key, secretMigrationDone),
    markDone: (key) => markSecretMigrationDone(key, secretMigrationDone),
  })
  : createMigratingSecretStore(localStorageSecretStore, legacySecretStore, {
    isDone: (key) => isSecretMigrationDone(key, secretMigrationDone),
    markDone: (key) => markSecretMigrationDone(key, secretMigrationDone),
    cleanLegacyOnWrite: false,
  });
