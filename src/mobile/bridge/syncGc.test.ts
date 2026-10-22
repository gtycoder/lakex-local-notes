// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeStore = vi.hoisted(() => ({
  createCapacitorS3Store: vi.fn(),
  readSecret: vi.fn(),
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
import { syncDomain } from "./sync";
import { maintenanceQueue } from "../sync/maintenanceLocks";

const s3 = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "bucket",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  prefix: "lake-notes",
  forcePathStyle: false,
};

function configure(enabled: boolean): void {
  localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(s3));
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ enabled, autoMode: "manual", autoIntervalMinutes: 15 }));
}

describe("移动端 gcDeepCleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    nativeStore.createCapacitorS3Store.mockReset();
    nativeStore.readSecret.mockReset();
    nativeStore.readSecret.mockResolvedValue("sk");
  });

  it("关闭云同步时零网络、零 S3 客户端", async () => {
    configure(false);
    await expect(syncDomain.gcDeepCleanup()).resolves.toEqual({ candidateCount: 0, deletedCount: 0, keys: [] });
    expect(nativeStore.createCapacitorS3Store).not.toHaveBeenCalled();
  });

  it("网络读取期间持有维护域锁，后续维护任务不能交错", async () => {
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
    let maintenanceEntered = false;
    const queued = maintenanceQueue.run("maintenance", async () => { maintenanceEntered = true; });
    await Promise.resolve();
    expect(maintenanceEntered).toBe(false);

    releaseNetwork();
    await gc;
    await queued;
    expect(maintenanceEntered).toBe(true);
  });

  it("密钥缺失时明确失败且不构造 S3 客户端", async () => {
    configure(true);
    nativeStore.readSecret.mockResolvedValue(null);
    await expect(syncDomain.gcDeepCleanup()).rejects.toThrow("S3 密钥缺失");
    expect(nativeStore.createCapacitorS3Store).not.toHaveBeenCalled();
  });
});
