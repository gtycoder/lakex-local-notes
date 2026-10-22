// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSyncSettings: vi.fn(),
  syncNow: vi.fn(),
  writeSyncSettings: vi.fn(),
  readSyncStatus: vi.fn(),
  describeSyncStatus: vi.fn((status: { ok: boolean; message: string }) => (status.ok ? "成功" : "失败")),
  subscribeSyncStatus: vi.fn(),
}));

vi.mock("../bridge", () => ({ bridge: { getSyncSettings: mocks.getSyncSettings, syncNow: mocks.syncNow } }));
vi.mock("../sync/syncSettingsStore", () => ({ writeSyncSettings: mocks.writeSyncSettings }));
vi.mock("../sync/syncStatusStore", () => ({
  readSyncStatus: mocks.readSyncStatus,
  describeSyncStatus: mocks.describeSyncStatus,
  subscribeSyncStatus: mocks.subscribeSyncStatus,
}));

import { useSyncSettingsForm } from "./useSyncSettingsForm";

type Api = ReturnType<typeof useSyncSettingsForm>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;
let statusListener: (() => void) | null = null;

function Harness({ onRefresh }: { onRefresh: () => Promise<void> }) {
  api = useSyncSettingsForm(true, onRefresh);
  return null;
}

const render = async (onRefresh = vi.fn(async () => {})) => {
  await act(async () => { root.render(createElement(Harness, { onRefresh })); });
  return onRefresh;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.getSyncSettings.mockReturnValue({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15 });
  mocks.readSyncStatus.mockReturnValue({ at: "2026-10-22T00:00:00.000Z", ok: true, message: "完成" });
  mocks.subscribeSyncStatus.mockImplementation((listener: () => void) => {
    statusListener = listener;
    return () => { statusListener = null; };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  statusListener = null;
  vi.unstubAllGlobals();
});

describe("useSyncSettingsForm", () => {
  it("打开设置时读取同步配置，并随同步状态 store 刷新", async () => {
    await render();
    expect(api.syncSettings).toEqual({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15 });
    expect(api.lastSyncText).toBe("成功");

    mocks.readSyncStatus.mockReturnValueOnce({ at: "2026-10-22T01:00:00.000Z", ok: false, message: "失败" });
    act(() => statusListener?.());
    expect(api.lastSyncText).toBe("失败");
  });

  it("更新同步配置时合并默认值并立即持久化", async () => {
    await render();
    act(() => api.updateSyncSettings({ autoMode: "interval", autoIntervalMinutes: 30 }));
    expect(api.syncSettings).toEqual({ enabled: true, autoMode: "interval", autoIntervalMinutes: 30 });
    expect(mocks.writeSyncSettings).toHaveBeenCalledWith({ enabled: true, autoMode: "interval", autoIntervalMinutes: 30 });
  });

  it("手动同步成功时更新消息/告警并刷新 App 数据", async () => {
    const onRefresh = await render();
    mocks.syncNow.mockResolvedValue({ message: "同步完成", notes: { warnings: [{ kind: "asset_missing" }] } });
    await act(async () => { await api.runSync(); });
    expect(api.syncMsg).toBe("同步完成");
    expect(api.warnings).toHaveLength(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("手动同步失败时给出可见错误", async () => {
    await render();
    mocks.syncNow.mockRejectedValue(new Error("offline"));
    await act(async () => { await api.runSync(); });
    expect(api.syncMsg).toBe("同步失败: offline");
  });
});
