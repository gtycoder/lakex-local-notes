/**
 * POC 持久化：SQLite 全库快照（sql.js db.export() 字节）→ IndexedDB。
 * - WebView 内零依赖持久化；键值结构，快照体积 = 全库导出字节。
 * - 资产（note-assets / quick-notes 图片）已全部走 Capacitor Filesystem 文件（assetFs.ts），
 *   不再存 IndexedDB（旧 asset: 前缀存储与迁移逻辑已随 2026-08-28 清理删除）。
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
