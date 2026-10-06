import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./nativeSqliteDb.js", async () =>
  (await import("./nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./nativeSqliteMigration", () => ({
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

type TestManifest = { notes: Array<{ id: string; contentHash: string; assets?: Array<{ filename: string }> }> };

vi.mock("../core/syncEngine.js", () => ({
  downloadNoteAssets: vi.fn(async () => {}),
  syncNow: vi.fn(async (
    _config: unknown,
    _store: unknown,
    _port: unknown,
    options: { onPublished: (next: TestManifest, prev: TestManifest) => Promise<void> },
  ) => {
    await options.onPublished({ notes: [] }, { notes: [] });
    return { message: "同步完成" };
  }),
}));

vi.mock("../core/quickNotesSyncEngine.js", () => ({
  syncQuickNotesViaEngine: vi.fn(async () => ({ uploaded: 0, downloaded: 0 })),
}));

vi.mock("./secretStore.js", () => ({
  mobileSecretStore: {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
  },
}));

import { bridge } from "./bridge.js";
import { downloadNoteAssets, syncNow as coreSyncNow } from "../core/syncEngine.js";

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
    expect(downloadNoteAssets).not.toHaveBeenCalled();
  });

  it("配置了但关闭云同步 ⇒ 补拉与同步都不出网，同步返回说明", async () => {
    await bridge.saveS3Settings(S3);
    expect(bridge.getSyncSettings().enabled).toBe(true);   // 默认开着（不回归）
    bridge.saveSyncSettings({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 });
    expect(bridge.getSyncSettings().enabled).toBe(false);  // 关掉后持久化生效

    await bridge.ensureTrashNoteAssets("n1");
    expect(downloadNoteAssets).not.toHaveBeenCalled();

    const result = await bridge.syncNow();
    expect(coreSyncNow).not.toHaveBeenCalled();          // ← 引擎没被调用 = 零请求
    expect(result.message).toContain("云同步已关闭");
  });

  it("开着云同步 ⇒ 行为不回归（照常走引擎）", async () => {
    await bridge.saveS3Settings(S3);
    const result = await bridge.syncNow();
    expect(coreSyncNow).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("同步完成");   // 桥会再拼小记状态
  });
});
