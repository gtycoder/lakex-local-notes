/**
 * POC 持久化：SQLite 全库快照（sql.js db.export() 字节）→ IndexedDB。
 * - WebView 内零依赖持久化（POC 阶段）；M1 评估 Capacitor Filesystem / OPFS。
 * - 键值结构，快照体积 = 全库导出字节（笔记数据量级 OK）。
 */

const IDB_NAME = "lake-notes-mobile";
const IDB_STORE = "kv";
const DB_KEY = "sqlite-snapshot";

function openStore(): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, "readwrite");
      resolve(tx.objectStore(IDB_STORE));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(bytes: Uint8Array): Promise<void> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.put(bytes.buffer as ArrayBuffer, DB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(): Promise<Uint8Array | null> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.get(DB_KEY);
    req.onsuccess = () => {
      const data = req.result as ArrayBuffer | undefined;
      resolve(data ? new Uint8Array(data) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 资产字节持久化（键 `asset:{noteId}/{filename}`）。图片可能较大（MB 级），用独立键避免全库快照膨胀。 */
export async function saveAssetBytes(key: string, bytes: Uint8Array): Promise<void> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.put(bytes.buffer as ArrayBuffer, "asset:" + key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadAssetBytes(key: string): Promise<Uint8Array | null> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.get("asset:" + key);
    req.onsuccess = () => {
      const data = req.result as ArrayBuffer | undefined;
      resolve(data ? new Uint8Array(data) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 列出全部已持久化的资产键（供启动时载入内存）。 */
export async function listAssetKeys(): Promise<string[]> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = (req.result as IDBValidKey[])
        .filter((k): k is string => typeof k === "string" && k.startsWith("asset:"))
        .map((k) => k.slice("asset:".length));
      resolve(keys);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 删除单个已持久化资产键（清缓存/迁移残留用；无此键时静默成功）。 */
export async function removeAssetBytes(key: string): Promise<void> {
  const store = await openStore();
  return new Promise((resolve, reject) => {
    const req = store.delete("asset:" + key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
