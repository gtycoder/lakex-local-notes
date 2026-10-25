// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeStore = vi.hoisted(() => ({
  createCapacitorS3Store: vi.fn(),
  readSecret: vi.fn(),
  runSync: vi.fn(),
  pushQuickNote: vi.fn(),
}));

vi.mock("../native/nativeSqliteDb.js", async () =>
  (await import("../native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

vi.mock("../../core/syncEngine.js", () => ({
  syncNow: nativeStore.runSync,
  downloadNoteAssets: vi.fn(async () => {}),
}));

vi.mock("../../core/quickNotesSyncEngine.js", () => ({
  syncQuickNotesViaEngine: vi.fn(async () => ({ uploaded: 0, downloaded: 0 })),
}));

vi.mock("../../core/quickNotePush.js", () => ({
  pushQuickNote: nativeStore.pushQuickNote,
}));

vi.mock("../native/secretStore", () => ({
  mobileSecretStore: {
    read: nativeStore.readSecret,
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));
vi.mock("../native/s3Store", () => ({
  createCapacitorS3Store: nativeStore.createCapacitorS3Store,
}));

import { S3_STORAGE_KEY, SYNC_STORAGE_KEY } from "./context";
import { quickNotesDomain } from "./quickNotes";
import { maintenanceQueue } from "../sync/maintenanceLocks";
import { syncDomain } from "./sync";

const s3 = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "bucket",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  prefix: "local-lakex-notes",
  forcePathStyle: false,
};

function configure(enabled: boolean): void {
  localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(s3));
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ enabled, autoMode: "manual", autoIntervalMinutes: 15 }));
}

describe("移动端 gcDeepCleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("local-lakex-notes-mobile.syncProtocol", "legacy"); // 本文件验证旧引擎路径
    nativeStore.createCapacitorS3Store.mockReset();
    nativeStore.readSecret.mockReset();
    nativeStore.runSync.mockReset();
    nativeStore.pushQuickNote.mockReset();
    nativeStore.readSecret.mockResolvedValue("sk");
  });

  it("关闭云同步时零网络、零 S3 客户端", async () => {
    configure(false);
    await expect(syncDomain.gcDeepCleanup()).resolves.toEqual({ candidateCount: 0, deletedCount: 0, keys: [] });
    expect(nativeStore.createCapacitorS3Store).not.toHaveBeenCalled();
  });

  it("GC 网络读取期间持有维护域锁，syncNow 不能进入", async () => {
    configure(true);
    let releaseNetwork!: () => void;
    const gate = new Promise<void>((resolve) => { releaseNetwork = resolve; });
    nativeStore.createCapacitorS3Store.mockReturnValue({
      listObjects: vi.fn(async () => []),
      deleteMany: vi.fn(async () => 0),
      getObject: vi.fn(async () => { await gate; return null; }),
    });

    const gc = syncDomain.gcDeepCleanup();
    await vi.waitFor(() => expect(nativeStore.createCapacitorS3Store).toHaveBeenCalledTimes(1));
    nativeStore.runSync.mockImplementation(async () => { throw new Error("主同步开始"); });
    const syncing = syncDomain.syncNow();
    await Promise.resolve();
    expect(nativeStore.runSync, "GC 尚未释放维护域时 syncNow 不得进入网络").not.toHaveBeenCalled();

    releaseNetwork();
    await gc;
    await expect(syncing).rejects.toThrow("主同步开始");
    expect(nativeStore.runSync).toHaveBeenCalledTimes(1);
  });

  it("密钥缺失时明确失败且不构造 S3 客户端", async () => {
    configure(true);
    nativeStore.readSecret.mockResolvedValue(null);
    await expect(syncDomain.gcDeepCleanup()).rejects.toThrow("S3 密钥缺失");
    expect(nativeStore.createCapacitorS3Store).not.toHaveBeenCalled();
  });

  it("priority 不被在途维护轮次阻塞，且内部仍按顺序串行", async () => {
    configure(true);
    nativeStore.createCapacitorS3Store.mockReturnValue({});
    let releaseMaintenance!: () => void;
    const maintenanceGate = new Promise<void>((resolve) => { releaseMaintenance = resolve; });
    const maintenance = maintenanceQueue.run("maintenance", async () => { await maintenanceGate; });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: string[] = [];
    nativeStore.pushQuickNote.mockImplementation(async (_cfg, _s3, _port, id: string) => {
      calls.push(id);
      if (id === "first") await firstGate;
      return { status: "not-found" };
    });

    const first = quickNotesDomain.syncQuickNote("first");
    await vi.waitFor(() => expect(calls).toEqual(["first"]));
    const second = quickNotesDomain.syncQuickNote("second");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls, "priority 内的第二条必须等第一条结束").toEqual(["first"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(["first", "second"]);
    releaseMaintenance();
    await maintenance;
  });
});
