/** Read the legacy sql.js IndexedDB snapshot during one-time native SQLite migration. */

const IDB_NAME = "lake-notes-mobile";
const IDB_STORE = "kv";
const DB_KEY = "sqlite-snapshot";

function openLegacyStore(): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, "readonly");
      resolve(tx.objectStore(IDB_STORE));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(): Promise<Uint8Array | null> {
  const store = await openLegacyStore();
  return new Promise((resolve, reject) => {
    const req = store.get(DB_KEY);
    req.onsuccess = () => {
      const data = req.result as ArrayBuffer | undefined;
      resolve(data ? new Uint8Array(data) : null);
    };
    req.onerror = () => reject(req.error);
  });
}
