import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./native/nativeSqliteDb.js", async () =>
  (await import("./native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

vi.mock("./v3/s3v3Remote.js", () => ({
  // 261028：core/syncAssets.ts（manifest v2 差集）已删；补拉走 v3 声明差集 ⇒ 「零请求」判据 = 连远端都没创建。
  createMobileS3v3Remote: vi.fn(() => { throw new Error("不应创建 S3 远端（零请求）"); }),
}));

// 旧 legacy 引擎已删除；移动端同步入口 = v3（这里只断言"没被调用" ⇒ 零请求）。
vi.mock("./v3/sync.js", () => ({
  runMobileV3Sync: vi.fn(async () => ({ downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: [] })),
}));

vi.mock("./native/secretStore.js", () => ({
  mobileSecretStore: {
    // 本文件按"已配置 S3"跑（S3 夹具里 ak/sk 齐全）；secret 从 store 读 ⇒ 这里要回真值，
    // 否则 261009 的「密钥缺失」护栏会先返回提示、同步路径根本走不到。
    read: vi.fn(async (key: string) => (key === "s3.secretAccessKey" ? "sk" : null)),
    write: vi.fn(async () => {}),
  },
}));

import { bridge } from "./bridge.js";
import { createMobileS3v3Remote } from "./v3/s3v3Remote.js";
import { runMobileV3Sync } from "./v3/sync.js";

const S3 = {
  endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", prefix: "p",
  accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false,
};

/** 移动端云同步状态：与桌面**同一判据**（src/core/cloudState）——
 *  没配置 或 关闭云同步 ⇒ 一律不出网（用户 261006：关闭云同步 = 当完全没配置 / 离线本地空间）。 */
const storage = new Map<string, string>();

describe("移动端云同步状态闸门", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    // 移动端跑在 node 环境（无 jsdom）：store 的 localStorage 用手写 Map 兜底（同 bridgeTree.test.ts）
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  it("未配置 S3 ⇒ 资源补拉入口不发任何请求", async () => {
    await bridge.ensureTrashNoteAssets("n1");
    expect(createMobileS3v3Remote).not.toHaveBeenCalled();
  });

  it("未配置 S3 ⇒ 「启用云同步」默认关闭；配置后默认开启（与桌面同口径，用户 261022）", async () => {
    expect(bridge.getSyncSettings().enabled).toBe(false);
    await bridge.saveS3Settings(S3);
    expect(bridge.getSyncSettings().enabled).toBe(true);
  });

  it("配置了但关闭云同步 ⇒ 补拉与同步都不出网，同步返回说明", async () => {
    await bridge.saveS3Settings(S3);
    expect(bridge.getSyncSettings().enabled).toBe(true);   // 默认开着（不回归）
    bridge.saveSyncSettings({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 });
    expect(bridge.getSyncSettings().enabled).toBe(false);  // 关掉后持久化生效

    await bridge.ensureTrashNoteAssets("n1");
    expect(createMobileS3v3Remote).not.toHaveBeenCalled();

    const result = await bridge.syncNow();
    expect(runMobileV3Sync).not.toHaveBeenCalled();      // ← 引擎没被调用 = 零请求
    expect(result.message).toContain("云同步已关闭");
  });


  it("密钥缺失 ⇒ 给可执行提示，而不是让请求去报签名错（261009）", async () => {
    // 复现历史缺陷的输入：配置在、但 secret 读不到（曾因 IndexedDB 不跨重启而必然发生）。
    await bridge.saveS3Settings(S3);     // 先"配置好"，再让 secret 读不到（复现历史缺陷的输入）
    const store = await import("./native/secretStore.js");
    const readMock = store.mobileSecretStore.read as unknown as { mockResolvedValue: (v: unknown) => void };
    readMock.mockResolvedValue(null);   // 整个用例期间都读不到（别用 Once：mobileCloudState 会先读一次）
    try {
      // 测连通：给出可执行提示（不再是 "signature does not match"）
      const test = await bridge.testS3Connection();
      expect(test).toContain("S3 密钥缺失");
      expect(test).toContain("同步设置");
      // 同步：同样给提示，且**不发请求**（引擎不被调用）
      const result = await bridge.syncNow();
      expect(result.message).toContain("S3 密钥缺失");
      expect(runMobileV3Sync).not.toHaveBeenCalled();
    } finally {
      readMock.mockResolvedValue("sk");   // 还原本文件"已配置 S3"的默认语义
    }
  });
});
