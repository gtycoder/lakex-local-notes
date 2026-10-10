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
