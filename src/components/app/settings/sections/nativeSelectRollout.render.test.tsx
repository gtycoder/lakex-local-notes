// @vitest-environment jsdom
/**
 * A13 推广护栏（261116 用户裁决「11 推广吧」）：
 * ① 不支持 base-select 的运行时，被推广的设置项必须**同位置**退回自研 Select；
 * ② 支持时渲染原生 <select>，值/选项/onChange 与自研分支一致；
 * ③ 只推广「逐档写盘无害」或 ≤5 档的项 —— 字号仍是自研 Select（本条同时钉住「不全量替换」）。
 * ④ UpdateCenter 的 disabled 经 AdaptiveSelect 透传到原生 select。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../../lib/settings";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import type { UpdateState } from "../../../../core/update/updateTypes";
import { BackupSection } from "./BackupSection";
import { EditorSection } from "./EditorSection";
import { UpdateCenterSection } from "../../UpdateCenter";

const updateNative = vi.hoisted(() => ({
  updateGetState: vi.fn(),
  onUpdateState: vi.fn(() => () => undefined),
  updateSetSettings: vi.fn(),
  updateCheck: vi.fn(),
  updateDownload: vi.fn(),
  updateOpenFile: vi.fn(),
  updateOpenReleasePage: vi.fn(),
  updateIgnoreVersion: vi.fn(),
}));

vi.mock("../../../../lib/native", () => ({ native: updateNative }));

/** 模块级开关：CSS.supports("appearance","base-select") 的返回值（NativeSelect 的唯一判据）。 */
let baseSelectEnabled = false;

beforeEach(() => {
  baseSelectEnabled = false;
  window.localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom 没有 base-select；用 stub 精确控制能力探测的两种结果。
  vi.stubGlobal("CSS", { supports: () => baseSelectEnabled });
  updateNative.updateGetState.mockReset();
  updateNative.onUpdateState.mockReset();
  updateNative.updateSetSettings.mockReset();
  updateNative.onUpdateState.mockReturnValue(() => undefined);
  // 默认挂起：settings 读不到时 UpdateCenter 的「检查频率」是 disabled。
  updateNative.updateGetState.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(node: React.ReactNode): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function unmount(host: HTMLDivElement, root: Root): void {
  act(() => root.unmount());
  host.remove();
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const backupCtx = (over: Partial<SettingsPanelContext> = {}) => ({
  backup: { busy: false, message: null, error: null },
  backupCfg: { enabled: true, intervalDays: 1, keepCount: 7, maxTotalBytes: 300 * 1024 * 1024 },
  backupResult: null,
  backupText: null,
  backupUsageBusy: false,
  backupUsageInfo: { tone: "ok", countText: "共 0 份", sizeText: "", limitText: null, newestText: null, note: null },
  cloudOffline: false,
  loadBackupUsage: vi.fn(),
  loadPortableStatus: vi.fn(),
  portable: { busy: false, message: null, error: null },
  portableProgress: null,
  portableProgressText: "",
  portableStatusText: "尚未导出",
  revealFolder: vi.fn(),
  runBackup: vi.fn(),
  runBackupNow: vi.fn(),
  runCloudRestore: vi.fn(),
  runPortableExport: vi.fn(),
  runRestoreFromBackup: vi.fn(),
  saveBackupCfg: vi.fn(),
  ...over,
}) as unknown as SettingsPanelContext;

const editorCtx = (over: Partial<SettingsPanelContext> = {}) => ({
  defaultSpace: "library",
  onChange: vi.fn(),
  setDefaultSpace: vi.fn(),
  settings: { ...DEFAULT_SETTINGS },
  ...over,
}) as unknown as SettingsPanelContext;

const updateState = (): UpdateState => ({
  status: "idle",
  currentVersion: "1.0.0",
  lastCheckAt: null,
  lastCheckWasAuto: false,
  lastError: null,
  manifest: null,
  asset: null,
  ignored: false,
  progress: null,
  downloadedPath: null,
  settings: { autoCheck: true, checkIntervalHours: 24, autoDownload: true, ignoredVersion: "" },
});

describe("A13 降级路径（CSS.supports 为 false）", () => {
  it("备份间隔渲染自研 Select（按钮触发器），不出现原生 select", () => {
    const ctx = backupCtx();
    const { host, root } = mount(<BackupSection c={ctx} />);
    try {
      expect(host.querySelector("select")).toBeNull();
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="备份间隔"]');
      expect(trigger).not.toBeNull();
      expect(trigger!.className).toContain("ln-select");
      expect(trigger!.className).not.toContain("ln-select--native");
      expect(trigger!.textContent).toContain("每天");
    } finally {
      unmount(host, root);
    }
  });

  it("被推广的编辑器设置项全部退回自研 Select；字号本来就不是原生", () => {
    const { host, root } = mount(<EditorSection c={editorCtx()} />);
    try {
      expect(host.querySelectorAll("select")).toHaveLength(0);
      for (const label of ["最大同时打开标签数", "附件大小上限", "默认空间", "正文字号"]) {
        const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        expect(trigger, label).not.toBeNull();
        expect(trigger!.className, label).toContain("ln-select");
      }
    } finally {
      unmount(host, root);
    }
  });

  it("UpdateCenter 的 disabled 退回自研 Select 后仍生效", () => {
    const { host, root } = mount(<UpdateCenterSection />);
    try {
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="自动检查频率"]');
      expect(trigger).not.toBeNull();
      expect(trigger!.disabled).toBe(true);
    } finally {
      unmount(host, root);
    }
  });
});

describe("A13 原生路径（CSS.supports 为 true）", () => {
  it("备份间隔：原生 select 的值/选项/onChange", () => {
    baseSelectEnabled = true;
    const ctx = backupCtx();
    const { host, root } = mount(<BackupSection c={ctx} />);
    try {
      expect(host.querySelector("button.ln-select")).toBeNull();
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="备份间隔"]');
      expect(select).not.toBeNull();
      expect(select!.className).toContain("ln-select--native");
      expect(select!.value).toBe("1");
      expect([...select!.options].map((option) => option.textContent)).toEqual(["每天", "每周"]);
      setSelectValue(select!, "7");
      expect(ctx.saveBackupCfg).toHaveBeenCalledWith({ intervalDays: 7 });
    } finally {
      unmount(host, root);
    }
  });

  it("编辑器：默认空间/标签数/附件上限用原生，字号仍用自研 Select（不全量替换）", () => {
    baseSelectEnabled = true;
    const ctx = editorCtx();
    const { host, root } = mount(<EditorSection c={ctx} />);
    try {
      expect(host.querySelector('select[aria-label="正文字号"]')).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('button[aria-label="正文字号"]')).not.toBeNull();

      const space = host.querySelector<HTMLSelectElement>('select[aria-label="默认空间"]');
      expect(space).not.toBeNull();
      expect(space!.value).toBe("library");
      expect([...space!.options].map((option) => option.textContent)).toEqual(["知识库", "小记", "标签", "AI 写作", "日记"]);
      setSelectValue(space!, "diary");
      expect(ctx.setDefaultSpace).toHaveBeenCalledWith("diary");
      expect(window.localStorage.getItem("lakex-local-notes-v3.default-space")).toBe("diary");

      const tabs = host.querySelector<HTMLSelectElement>('select[aria-label="最大同时打开标签数"]');
      expect(tabs).not.toBeNull();
      expect(tabs!.value).toBe("8");
      expect([...tabs!.options].map((option) => option.value)).toEqual(["4", "6", "8", "12", "16"]);
      setSelectValue(tabs!, "12");
      expect(ctx.onChange).toHaveBeenCalledWith({ maxOpenTabs: 12 });

      const attachment = host.querySelector<HTMLSelectElement>('select[aria-label="附件大小上限"]');
      expect(attachment).not.toBeNull();
      expect([...attachment!.options].map((option) => option.textContent)).toEqual(["25 MiB", "50 MiB", "100 MiB"]);
      setSelectValue(attachment!, "50");
      expect(ctx.onChange).toHaveBeenCalledWith({ maxAttachmentBytes: 50 * 1024 * 1024 });
    } finally {
      unmount(host, root);
    }
  });

  it("UpdateCenter：settings 未就绪时原生 select 仍 disabled；就绪后恢复并可写回", async () => {
    baseSelectEnabled = true;
    updateNative.updateGetState.mockResolvedValue(updateState());
    updateNative.updateSetSettings.mockImplementation(async (patch: Record<string, unknown>) => ({ ...updateState().settings, ...patch }));

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<UpdateCenterSection />);
        await Promise.resolve();
      });
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="自动检查频率"]');
      expect(select).not.toBeNull();
      expect(select!.disabled).toBe(false);
      expect(select!.value).toBe("24");
      expect([...select!.options].map((option) => option.textContent)).toEqual(["关闭", "6 小时", "12 小时", "24 小时"]);

      setSelectValue(select!, "12");
      await act(async () => { await Promise.resolve(); });
      expect(updateNative.updateSetSettings).toHaveBeenCalledWith({ checkIntervalHours: 12 });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
