// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHistorySettings: vi.fn(),
  saveHistorySettings: vi.fn(),
  listOrphanAssets: vi.fn(),
  cleanOrphanAssets: vi.fn(),
  deleteOrphanAsset: vi.fn(),
  gcDeepCleanup: vi.fn(),
  getDiagnostics: vi.fn(),
  getAppInfo: vi.fn(),
  getCacheSummary: vi.fn(),
  clearDerivedCaches: vi.fn(),
  reportNativeActionError: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    getHistorySettings: mocks.getHistorySettings,
    saveHistorySettings: mocks.saveHistorySettings,
    listOrphanAssets: mocks.listOrphanAssets,
    cleanOrphanAssets: mocks.cleanOrphanAssets,
    deleteOrphanAsset: mocks.deleteOrphanAsset,
    gcDeepCleanup: mocks.gcDeepCleanup,
    getDiagnostics: mocks.getDiagnostics,
  },
}));
vi.mock("../native/appInfoPort", () => ({ mobileAppInfoPort: { getAppInfo: mocks.getAppInfo } }));
vi.mock("../native/cachePort", () => ({
  mobileCachePort: { getCacheSummary: mocks.getCacheSummary, clearDerivedCaches: mocks.clearDerivedCaches },
}));
vi.mock("../../lib/nativeErrors", () => ({
  getNativeErrorMessage: (error: unknown) => (error as Error).message,
  reportNativeActionError: mocks.reportNativeActionError,
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import { useSettingsSectionData } from "./useSettingsSectionData";
import { subscribeHistorySettings } from "../lib/historySettingsSync";

const history = {
  maxSnapshots: 100,
  retentionDays: 30,
  cleanupIntervalHours: 24,
  snapshotIntervalMinutes: 15,
};
const orphan = { id: 1, noteId: "n1", filename: "old.png", size: 10, mimeType: "image/png" };
const cache = { runtimeBlobBytes: 3, downloadableAssetBytes: 4, pendingUploadBytes: 5 };
const diagnostics = {
  noteCount: 1,
  folderCount: 2,
  quickNoteCount: 3,
  resourceCount: 4,
  orphanCount: 1,
  gcPendingCount: 0,
  snapshotCount: 2,
  dbBytes: 1024,
};

type Data = ReturnType<typeof useSettingsSectionData>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let data: Data;

function Harness() {
  data = useSettingsSectionData({ historyOpen: true, resourcesOpen: true, cacheOpen: true, aboutOpen: true });
  return null;
}

const render = async () => {
  await act(async () => { root.render(createElement(Harness)); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.getHistorySettings.mockResolvedValue(history);
  mocks.saveHistorySettings.mockResolvedValue(undefined);
  mocks.listOrphanAssets.mockResolvedValue([orphan]);
  mocks.cleanOrphanAssets.mockResolvedValue(undefined);
  mocks.deleteOrphanAsset.mockResolvedValue(undefined);
  mocks.gcDeepCleanup.mockResolvedValue({ deletedCount: 2, candidateCount: 4, keys: ["a", "b"] });
  mocks.getDiagnostics.mockResolvedValue(diagnostics);
  mocks.getAppInfo.mockResolvedValue({ name: "LakexLocalNotes", version: "1", build: "1", protocolVersion: 1, platform: "android" });
  mocks.getCacheSummary.mockResolvedValue(cache);
  mocks.clearDerivedCaches.mockResolvedValue({ cleared: { runtimeBlobBytes: 3 } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSettingsSectionData", () => {
  it("按子页加载历史、孤儿资源、缓存与诊断数据", async () => {
    await render();
    expect(data.history).toEqual(history);
    expect(data.orphans).toEqual([orphan]);
    expect(data.cacheSummary).toEqual(cache);
    expect(data.appInfo?.name).toBe("LakexLocalNotes");
    expect(data.diagnostics).toEqual(diagnostics);
  });

  it("历史设置乐观更新；保存失败时回读真实值并提示", async () => {
    await render();
    mocks.saveHistorySettings.mockRejectedValueOnce(new Error("disk"));
    mocks.getHistorySettings
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce(history);

    await act(async () => {
      data.updateHistory({ maxSnapshots: 5 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.saveHistorySettings).toHaveBeenCalledWith(expect.objectContaining({ maxSnapshots: 5 }));
    expect(mocks.showToast).toHaveBeenCalledWith("历史设置保存失败，已恢复原值", { type: "error" });
    expect(data.history?.maxSnapshots).toBe(100);
  });

  it("保存成功后广播历史设置（供自动快照定时器重挂）", async () => {
    await render();
    const seen: Array<{ snapshotIntervalMinutes: number }> = [];
    const off = subscribeHistorySettings((next) => seen.push(next));
    await act(async () => {
      data.updateHistory({ snapshotIntervalMinutes: 30 });
      await Promise.resolve();
      await Promise.resolve();
    });
    off();
    expect(seen.at(-1)?.snapshotIntervalMinutes).toBe(30);
  });

  it("清理孤儿资源与单个删除都更新本地列表", async () => {
    await render();
    await act(async () => { await data.deleteOrphan(1); });
    expect(data.orphans).toEqual([]);

    mocks.listOrphanAssets.mockResolvedValueOnce([orphan]);
    await act(async () => { data.cleanOrphans(); await Promise.resolve(); });
    expect(mocks.cleanOrphanAssets).toHaveBeenCalledTimes(1);
    expect(data.orphans).toEqual([]);
    expect(data.orphanBusy).toBe(false);
  });

  it("云端清理和缓存清理更新结果文案并防止 busy 泄漏", async () => {
    await render();
    await act(async () => { await data.cleanCloud(); });
    expect(data.gcMsg).toContain("已清理 2 个对象");
    expect(data.orphanBusy).toBe(false);

    await act(async () => { await data.clearCache(); });
    expect(data.cacheMsg).toContain("blob 3 项");
    expect(mocks.getCacheSummary).toHaveBeenCalled();
  });
});
