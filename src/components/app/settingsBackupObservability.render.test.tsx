// @vitest-environment jsdom
/**
 * 261105 task-68：设置 →「备份与恢复」的状态行渲染（占用 / 上次结果三者态 / 失败引导 / 刷新统计）。
 * 只 mock `lib/native`（IPC 边界），其余真实渲染：验证的是「文案模型 → DOM」的接线，而不是文案本身
 * （文案口径见 settingsBackupObservability.test.ts）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupStateShape, BackupUsageShape } from "../../lib/types";

const api = vi.hoisted(() => ({
  getBackupUsage: vi.fn(),
  getBackupSettings: vi.fn(),
  runBackupNow: vi.fn(),
}));

vi.mock("../../lib/native", () => {
  // 设置页打开时会并发读十来组只读数据；这里给最小可渲染默认值，未列出的通道 resolve undefined。
  const defaults: Record<string, () => unknown> = {
    getFileScanSettings: () => ({ intervalHours: 24 }),
    getHistoryStats: () => ({ snapshotCount: 0, totalBytes: 0 }),
    getHistorySettings: () => ({ maxSnapshots: 50, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 10 }),
    getLastHistoryCleanup: () => null,
    listS3GcLog: () => [],
  };
  const native = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      if (typeof key !== "string") return undefined;
      if (key in api) return (api as unknown as Record<string, unknown>)[key];
      if (key in defaults) return () => Promise.resolve(defaults[key]());
      return () => Promise.resolve(undefined);
    },
  });
  return { native };
});

import { SettingsPanel } from "./SettingsPanel";
import type { AppSettings } from "../../lib/settings";

const usage = (over: Partial<BackupUsageShape> = {}): BackupUsageShape => ({
  dir: "/tmp/userData/backups",
  exists: true,
  groups: 2,
  files: 4,
  totalBytes: 10 * 1024,
  newestAt: "2026-11-06T14:08:04.000Z",
  oldestAt: "2026-11-01T00:00:00.000Z",
  warnings: [],
  ...over,
});

const state = (over: Partial<BackupStateShape> = {}): BackupStateShape => ({
  lastBackupAt: "2026-11-06T14:08:04.000Z",
  result: "ok",
  message: "已备份主库：metadata-2026-11-06T14-08-04.sqlite3",
  mainFile: "metadata-2026-11-06T14-08-04.sqlite3",
  quickNotesFile: null,
  ...over,
});

const settings = { fontSize: 15 } as unknown as AppSettings;

let host: HTMLDivElement;
let root: Root;

async function render(usageValue: BackupUsageShape, stateValue: BackupStateShape | null): Promise<void> {
  api.getBackupUsage.mockImplementation(async () => usageValue);
  api.getBackupSettings.mockImplementation(async () => ({ settings: { enabled: true, intervalDays: 1, keepCount: 7, maxTotalBytes: 300 * 1024 * 1024 }, state: stateValue }));
  await act(async () => {
    root.render(createElement(SettingsPanel, { open: true, settings, onClose: () => undefined, onChange: () => undefined, openCategory: "backup" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const textOf = (): string => document.body.textContent ?? "";
const buttons = (label: string): HTMLButtonElement[] =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter((b) => (b.textContent ?? "").trim() === label);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.getBackupUsage.mockReset();
  api.getBackupSettings.mockReset();
  api.runBackupNow.mockReset();
  api.runBackupNow.mockImplementation(async () => ({ state: state(), message: "已备份" }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("备份与恢复：占用状态行", () => {
  it("有备份：显示份数/体积/上限/最新时间", async () => {
    await render(usage(), state());
    expect(textOf()).toContain("共 2 份");
    expect(textOf()).toContain("10.0 KB");
    expect(textOf()).toContain("上限 300.0 MB");
    expect(textOf()).toContain("最新 ");
  });

  it("还没有备份（目录未创建）：不报错、给「还没有备份」与创建说明", async () => {
    await render(usage({ exists: false, groups: 0, files: 0, totalBytes: 0, newestAt: null, oldestAt: null }), null);
    expect(textOf()).toContain("还没有备份");
    expect(textOf()).toContain("尚未创建");
    expect(textOf()).toContain("还没有备份记录");
  });

  it("刷新统计：再读一次只读 IPC", async () => {
    await render(usage(), state());
    expect(api.getBackupUsage).toHaveBeenCalledTimes(1);
    await act(async () => {
      buttons("刷新统计")[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.getBackupUsage).toHaveBeenCalledTimes(2);
  });
});

describe("备份与恢复：上次结果三态 + 失败引导", () => {
  it("成功：成功标签、不出现失败引导/重试块", async () => {
    await render(usage(), state());
    expect(textOf()).toContain("（成功）");
    expect(textOf()).not.toContain("本次备份不完整");
    expect(textOf()).not.toContain("这次没有生成可用备份");
    expect(buttons("立即备份")).toHaveLength(1); // 只有自动备份配置里那一个
  });

  it("部分成功：原因可见 + 引导 + 结果块里多一个「立即备份」", async () => {
    await render(usage(), state({ result: "partial", message: "已备份主库：metadata-x.sqlite3；注意：小记库不可用：本次未备份小记库" }));
    expect(textOf()).toContain("（部分成功）");
    expect(textOf()).toContain("小记库不可用");
    expect(textOf()).toContain("本次备份不完整");
    expect(buttons("立即备份")).toHaveLength(2);
  });

  it("失败：失败色文案 + 「本地数据不受影响」引导 + 重试入口", async () => {
    await render(usage(), state({ result: "failed", message: "主库备份失败：disk I/O error", mainFile: null }));
    expect(textOf()).toContain("（失败）");
    expect(textOf()).toContain("disk I/O error");
    expect(textOf()).toContain("本地数据不受影响");
    expect(buttons("立即备份")).toHaveLength(2);
  });

  it("结果块里的「立即备份」会真的触发 runBackupNow", async () => {
    await render(usage(), state({ result: "failed", message: "主库备份失败：disk I/O error" }));
    const retry = buttons("立即备份")[1];
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.runBackupNow).toHaveBeenCalledTimes(1);
  });
});
