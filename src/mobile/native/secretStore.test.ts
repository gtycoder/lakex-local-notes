import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 护栏（261009）：SecretStore 的持久化后端必须是 **localStorage 密文**，不能回到 IndexedDB。
 * 背景：Android WebView 里 IndexedDB 不跨 App 重启（实测：重启后库被重建为空），
 * 而 localStorage 能持久 ⇒ 用 IDB 存 S3 密钥会导致"重启后同步报签名不匹配"。
 * 这里用一个内存 localStorage 桩模拟"重启"（清模块缓存后重新 import，桩里的值保留）。
 */
function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
  return map;
}

/** 内存版 native（模拟 Keystore 侧）。 */
function memoryNative(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const failWrite = { value: false };
  const store = {
    map, failWrite,
    api: {
      async read(key: string) { return map.get(key) ?? null; },
      async write(key: string, value: string) { if (failWrite.value) throw new Error("keystore down"); map.set(key, value); },
      async remove(key: string) { map.delete(key); },
    },
  };
  return store;
}

describe("Keystore 迁移层（createMigratingSecretStore）", () => {
  // 与下面那组一样：每个用例重建模块 + 装内存 localStorage 桩（legacy 后端要用）
  beforeEach(() => {
    vi.resetModules();
    installLocalStorage();
  });

  it("native 为空、legacy 有值 ⇒ 迁移到 native 并清掉 legacy（此后不再留在 WebView 存储）", async () => {
    const { createMigratingSecretStore, localStorageSecretStore } = await import("./secretStore");
    await localStorageSecretStore.write("s3.secretAccessKey", "old-secret");
    const native = memoryNative();
    const store = createMigratingSecretStore(native.api, localStorageSecretStore);

    expect(await store.read("s3.secretAccessKey")).toBe("old-secret");
    expect(native.map.get("s3.secretAccessKey")).toBe("old-secret");   // 已迁到 native
    expect(await localStorageSecretStore.read("s3.secretAccessKey")).toBeNull();  // 旧值已清
  });

  it("native 已有值时，也会把残留的 legacy 副本清掉（一次性）", async () => {
    const { createMigratingSecretStore, localStorageSecretStore } = await import("./secretStore");
    await localStorageSecretStore.write("k", "leftover-ciphertext");
    const native = memoryNative({ k: "fresh" });
    const store = createMigratingSecretStore(native.api, localStorageSecretStore);
    expect(await store.read("k")).toBe("fresh");
    expect(await localStorageSecretStore.read("k")).toBeNull();   // 旧副本已清
  });

  it("native 已有值 ⇒ 直接用 native（不读 legacy）", async () => {
    const { createMigratingSecretStore, localStorageSecretStore } = await import("./secretStore");
    await localStorageSecretStore.write("k", "stale");
    const native = memoryNative({ k: "fresh" });
    const store = createMigratingSecretStore(native.api, localStorageSecretStore);
    expect(await store.read("k")).toBe("fresh");
  });

  it("写只进 native（legacy 不再新增），remove 双清", async () => {
    const { createMigratingSecretStore, localStorageSecretStore } = await import("./secretStore");
    const native = memoryNative();
    const store = createMigratingSecretStore(native.api, localStorageSecretStore);
    await store.write("k2", "v2");
    expect(native.map.get("k2")).toBe("v2");
    expect(await localStorageSecretStore.read("k2")).toBeNull();
    await localStorageSecretStore.write("k2", "legacy-leftover");
    await store.remove("k2");
    expect(native.map.has("k2")).toBe(false);
    expect(await localStorageSecretStore.read("k2")).toBeNull();
  });

  it("迁移写失败时不丢用户密钥（本次仍返回旧值）", async () => {
    const { createMigratingSecretStore, localStorageSecretStore } = await import("./secretStore");
    await localStorageSecretStore.write("k3", "must-survive");
    const native = memoryNative();
    native.failWrite.value = true;
    const store = createMigratingSecretStore(native.api, localStorageSecretStore);
    expect(await store.read("k3")).toBe("must-survive");
    expect(await localStorageSecretStore.read("k3")).toBe("must-survive");  // 旧值保留，下次再迁
  });

  it("迁移标记完成后只读 native，不再进入旧存储", async () => {
    const { createMigratingSecretStore } = await import("./secretStore");
    const native = memoryNative({ k: "fresh" });
    const legacyRead = vi.fn(async () => "legacy");
    const store = createMigratingSecretStore(native.api, { read: legacyRead, write: async () => {}, remove: async () => {} }, {
      isDone: () => true,
      markDone: () => {},
    });
    expect(await store.read("k")).toBe("fresh");
    expect(legacyRead).not.toHaveBeenCalled();
  });
});

describe("mobileSecretStore（密文进 localStorage，跨重启可用）", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    store = installLocalStorage();
  });

  it("写→读回明文", async () => {
    const { mobileSecretStore } = await import("./secretStore");
    await mobileSecretStore.write("s3.secretAccessKey", "s3-secret-value");
    expect(await mobileSecretStore.read("s3.secretAccessKey")).toBe("s3-secret-value");
  });

  it("落盘的是密文（不是明文）且形如 iv:data", async () => {
    const { mobileSecretStore } = await import("./secretStore");
    await mobileSecretStore.write("s3.secretAccessKey", "s3-secret-value");
    const raw = store.get("lake-notes-mobile.secret.s3.secretAccessKey");
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("s3-secret-value");
    expect(String(raw).split(":")).toHaveLength(2);
  });

  it("模拟重启（模块重建）后仍能读回 —— 这条就是本轮修的那个缺陷", async () => {
    const first = await import("./secretStore");
    await first.mobileSecretStore.write("s3.secretAccessKey", "survives-restart");
    vi.resetModules(); // 等价于 App 重启：模块级缓存清空，只有"持久层"留下
    const second = await import("./secretStore");
    expect(await second.mobileSecretStore.read("s3.secretAccessKey")).toBe("survives-restart");
  });

  it("未写过的键 → null；remove 后 → null", async () => {
    const { mobileSecretStore } = await import("./secretStore");
    expect(await mobileSecretStore.read("never-written")).toBeNull();
    await mobileSecretStore.write("k", "v");
    await mobileSecretStore.remove("k");
    expect(await mobileSecretStore.read("k")).toBeNull();
  });
});
