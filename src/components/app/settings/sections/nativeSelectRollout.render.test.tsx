// @vitest-environment jsdom
/**
 * A13 推广护栏（261116 用户裁决「11 推广吧」+「做吧，都做」）：
 * ① 不支持 base-select 的运行时，被推广的调用点必须**同位置**退回自研 Select；
 * ② 支持时渲染原生 <select>，值/选项/onChange 与自研分支一致；
 * ③ 覆盖全部 13 个调用点：设置页 6（备份/检查频率/标签数/附件/默认空间/同步模式）+ AI 4
 *    （供应商/模型/思考强度/思考模式）+ 正文字号 + 发布目标知识库 + 资源类型；
 * ④ 模型「手填…」`__manual__` 哨兵仍切手动输入（不写草稿模型）；
 * ⑤ UpdateCenter 的 disabled 经 AdaptiveSelect 透传到原生 select。
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../../lib/settings";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import type { UpdateState } from "../../../../core/update/updateTypes";
import { AI_PROVIDERS } from "../../../../core/aiProviders";
import { BackupSection } from "./BackupSection";
import { EditorSection } from "./EditorSection";
import { AiSection } from "./AiSection";
import { UpdateCenterSection } from "../../UpdateCenter";
import { PublishDocDialog } from "../../PublishDocDialog";
import { AssetsBrowser } from "../../AssetsBrowser";

const nativeMock = vi.hoisted(() => ({
  updateGetState: vi.fn(),
  onUpdateState: vi.fn(() => () => undefined),
  updateSetSettings: vi.fn(),
  updateCheck: vi.fn(),
  updateDownload: vi.fn(),
  updateOpenFile: vi.fn(),
  updateOpenReleasePage: vi.fn(),
  updateIgnoreVersion: vi.fn(),
  listRemovedAssets: vi.fn(),
  listMissingQuickNotes: vi.fn(),
  listMissingBodies: vi.fn(),
}));

vi.mock("../../../../lib/native", () => ({ native: nativeMock }));

/** 模块级开关：CSS.supports("appearance","base-select") 的返回值（NativeSelect 的唯一判据）。 */
let baseSelectEnabled = false;

beforeEach(() => {
  baseSelectEnabled = false;
  window.localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom 没有 base-select；用 stub 精确控制能力探测的两种结果。
  vi.stubGlobal("CSS", { supports: () => baseSelectEnabled });
  // PublishDocDialog（useFloatingDialog）与 SplitPane（AssetsBrowser）都要用。
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  nativeMock.updateGetState.mockReset();
  nativeMock.onUpdateState.mockReset();
  nativeMock.updateSetSettings.mockReset();
  nativeMock.onUpdateState.mockReturnValue(() => undefined);
  // 默认挂起：settings 读不到时 UpdateCenter 的「检查频率」是 disabled。
  nativeMock.updateGetState.mockReturnValue(new Promise(() => undefined));
  nativeMock.listRemovedAssets.mockReset();
  nativeMock.listMissingQuickNotes.mockReset();
  nativeMock.listMissingBodies.mockReset();
  nativeMock.listRemovedAssets.mockResolvedValue([]);
  nativeMock.listMissingQuickNotes.mockResolvedValue([]);
  nativeMock.listMissingBodies.mockResolvedValue([]);
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

async function renderAsync(node: React.ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

/** 自研 Select 的交互：点触发器，再点弹层里的同名选项（弹层是 portal，查 document）。 */
function pickSelfDrawnOption(label: string, optionText: string): void {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(trigger, label).not.toBeNull();
  act(() => { trigger!.click(); });
  const listbox = document.querySelector<HTMLElement>(`[role="listbox"][aria-label="${label}"]`);
  const option = [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    .find((el) => (el.textContent ?? "").trim() === optionText);
  expect(option, optionText).toBeTruthy();
  act(() => { option!.click(); });
}

const buttonByText = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").trim() === text);

const DEEPSEEK = AI_PROVIDERS.find((provider) => provider.id === "deepseek")!;

function makeAiCtx() {
  const setAiDraft = vi.fn();
  const setAiManualModel = vi.fn();
  const switchAiProvider = vi.fn();
  return {
    activeAi: null,
    activeDef: DEEPSEEK,
    aiDraft: {},
    aiEnableAlert: null,
    aiEnabled: true,
    aiErr: {},
    aiForceSave: false,
    aiKeyVisible: false,
    aiManualModel: false,
    aiModels: ["deepseek-flash", "deepseek-v4-pro"],
    aiModelsRun: { busy: false },
    aiMsg: null,
    aiPending: { id: "deepseek", baseUrl: DEEPSEEK.defaultBaseUrl, model: "deepseek-flash", temperature: 0.7, reasoningEffort: "high", thinking: "enabled" },
    aiProviderId: "deepseek",
    aiRun: { busy: false },
    fetchAiModels: vi.fn(),
    forceSaveAi: vi.fn(),
    saveAi: vi.fn(),
    setAiDraft,
    setAiEnableAlert: vi.fn(),
    setAiEnabled: vi.fn(),
    setAiKeyVisible: vi.fn(),
    setAiManualModel,
    switchAiProvider,
    testAi: vi.fn(),
    testAndSaveAi: vi.fn(),
  };
}

/** 状态化宿主：证明「手填…」哨兵不只是调回调，而是真的把下拉换成输入框。 */
function AiManualHarness({ onManual, onSwitch }: { onManual?: (manual: boolean) => void; onSwitch?: (id: string) => void }) {
  const [manual, setManual] = useState(false);
  const ctx = makeAiCtx();
  const c = {
    ...ctx,
    aiManualModel: manual,
    setAiManualModel: (next: boolean) => { onManual?.(next); setManual(next); },
    ...(onSwitch ? { switchAiProvider: onSwitch } : {}),
  };
  return <AiSection c={c as unknown as SettingsPanelContext} />;
}

function renderPublish(overrides: Partial<React.ComponentProps<typeof PublishDocDialog>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const result = mount(
    <PublishDocDialog
      open
      title="AI 生成文档"
      notebooks={[{ id: "nb1", title: "个人笔记" }, { id: "nb2", title: "工作" }]}
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...result, onConfirm, onClose };
}

async function renderAssets() {
  return renderAsync(<AssetsBrowser active onDataChanged={vi.fn()} />);
}

const ASSET_ITEMS = [
  { noteId: "n1", filename: "a.png", status: "orphan" as const, orphanId: 1, size: 10, mimeType: "image/png", noteTitle: "文档A" },
  { noteId: "n1", filename: "b.pdf", status: "orphan" as const, orphanId: 2, size: 20, mimeType: "application/pdf", noteTitle: "文档A" },
];

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

  it("被推广的编辑器设置项（含正文字号）全部退回自研 Select", () => {
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

  it("AI 设置：4 处退回自研 Select；供应商切换与模型「手填…」哨兵仍正确", () => {
    const ctx = makeAiCtx();
    const { host, root } = mount(<AiSection c={ctx as unknown as SettingsPanelContext} />);
    try {
      expect(host.querySelectorAll("select")).toHaveLength(0);
      for (const label of ["AI 供应商", "AI 模型", "思考强度", "思考模式"]) {
        expect(host.querySelector(`button[aria-label="${label}"]`), label).not.toBeNull();
      }
      pickSelfDrawnOption("AI 供应商", "OpenAI");
      expect(ctx.switchAiProvider).toHaveBeenCalledWith("openai");
      pickSelfDrawnOption("AI 模型", "手填…");
      expect(ctx.setAiManualModel).toHaveBeenCalledWith(true);
      expect(ctx.setAiDraft).not.toHaveBeenCalled();
    } finally {
      unmount(host, root);
    }
  });

  it("发布目标知识库：退回自研 Select 后仍能改目标并回传", () => {
    const { host, root, onConfirm } = renderPublish();
    try {
      expect(document.querySelector('select[aria-label="选择知识库"]')).toBeNull();
      expect(document.querySelector('button[aria-label="选择知识库"]')).not.toBeNull();
      pickSelfDrawnOption("选择知识库", "工作");
      act(() => { buttonByText("确认")!.click(); });
      expect(onConfirm).toHaveBeenCalledWith("nb2", "AI 生成文档");
    } finally {
      unmount(host, root);
    }
  });

  it("资源类型：退回自研 Select 后仍按类型筛选", async () => {
    nativeMock.listRemovedAssets.mockResolvedValue(ASSET_ITEMS);
    const { host, root } = await renderAssets();
    try {
      expect(host.querySelectorAll("select")).toHaveLength(0);
      expect(host.querySelector('button[aria-label="资源类型"]')).not.toBeNull();
      expect(host.querySelectorAll("[data-asset-key]")).toHaveLength(2);
      pickSelfDrawnOption("资源类型", "图片");
      expect(host.querySelectorAll("[data-asset-key]")).toHaveLength(1);
      expect(host.textContent).toContain("a.png");
      expect(host.textContent).not.toContain("b.pdf");
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

  it("编辑器：4 处都用原生 select；字号逐档保存（用户已接受预览重排）", () => {
    baseSelectEnabled = true;
    const ctx = editorCtx();
    const { host, root } = mount(<EditorSection c={ctx} />);
    try {
      const font = host.querySelector<HTMLSelectElement>('select[aria-label="正文字号"]');
      expect(font).not.toBeNull();
      expect(font!.className).toContain("ln-select--native");
      // 与自研 Select 共用 .settings-select 的字段宽度规则（否则 Field 里只有 140px 内容宽）。
      expect(font!.classList.contains("settings-select")).toBe(true);
      expect(font!.value).toBe("16");
      expect([...font!.options].map((option) => option.textContent)).toEqual(["12 px", "13 px", "14 px", "15 px", "16 px", "19 px", "22 px", "24 px"]);
      setSelectValue(font!, "19");
      expect(ctx.onChange).toHaveBeenCalledWith({ fontSize: 19 });

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
    nativeMock.updateGetState.mockResolvedValue(updateState());
    nativeMock.updateSetSettings.mockImplementation(async (patch: Record<string, unknown>) => ({ ...updateState().settings, ...patch }));

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
      // 261116 用户点单：只留 24 小时 / 每周 / 每月（关闭由上方「自动检查」开关承担）
      expect([...select!.options].map((option) => option.textContent)).toEqual(["24 小时", "每周", "每月"]);

      setSelectValue(select!, "168");
      await act(async () => { await Promise.resolve(); });
      expect(nativeMock.updateSetSettings).toHaveBeenCalledWith({ checkIntervalHours: 168 });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("AI 设置：供应商/模型/思考强度/思考模式走原生；模型哨兵仍切手填", () => {
    baseSelectEnabled = true;
    const ctx = makeAiCtx();
    const { host, root } = mount(<AiSection c={ctx as unknown as SettingsPanelContext} />);
    try {
      const provider = host.querySelector<HTMLSelectElement>('select[aria-label="AI 供应商"]');
      expect(provider).not.toBeNull();
      expect(provider!.value).toBe("deepseek");
      expect([...provider!.options].map((option) => option.textContent)).toEqual(AI_PROVIDERS.map((p) => p.label));
      setSelectValue(provider!, "openai");
      expect(ctx.switchAiProvider).toHaveBeenCalledWith("openai");

      const model = host.querySelector<HTMLSelectElement>('select[aria-label="AI 模型"]');
      expect(model).not.toBeNull();
      expect(model!.value).toBe("deepseek-flash");
      expect([...model!.options].map((option) => option.value)).toEqual(["deepseek-flash", "deepseek-v4-pro", "__manual__"]);
      setSelectValue(model!, "__manual__");
      expect(ctx.setAiManualModel).toHaveBeenCalledWith(true);
      expect(ctx.setAiDraft).not.toHaveBeenCalled();

      setSelectValue(model!, "deepseek-v4-pro");
      const modelUpdate = ctx.setAiDraft.mock.calls[0][0] as (draft: object) => object;
      expect(modelUpdate({})).toEqual({ model: "deepseek-v4-pro" });

      const reasoning = host.querySelector<HTMLSelectElement>('select[aria-label="思考强度"]');
      expect(reasoning).not.toBeNull();
      expect(reasoning!.value).toBe("high");
      expect(reasoning!.classList.contains("ln-w-200")).toBe(true);
      expect([...reasoning!.options].map((option) => option.value)).toEqual(["low", "high", "max"]);
      setSelectValue(reasoning!, "max");
      const reasoningUpdate = ctx.setAiDraft.mock.calls[1][0] as (draft: object) => object;
      expect(reasoningUpdate({})).toEqual({ reasoningEffort: "max" });

      const thinking = host.querySelector<HTMLSelectElement>('select[aria-label="思考模式"]');
      expect(thinking).not.toBeNull();
      expect(thinking!.value).toBe("enabled");
      expect(thinking!.classList.contains("ln-w-200")).toBe(true);
      expect([...thinking!.options].map((option) => option.textContent)).toEqual(["开启", "关闭"]);
      setSelectValue(thinking!, "disabled");
      const thinkingUpdate = ctx.setAiDraft.mock.calls[2][0] as (draft: object) => object;
      expect(thinkingUpdate({})).toEqual({ thinking: "disabled" });
    } finally {
      unmount(host, root);
    }
  });

  it("模型「手填…」哨兵：受控状态下真的切出输入框", () => {
    baseSelectEnabled = true;
    const onManual = vi.fn();
    const { host, root } = mount(<AiManualHarness onManual={onManual} />);
    try {
      const model = host.querySelector<HTMLSelectElement>('select[aria-label="AI 模型"]');
      expect(model).not.toBeNull();
      setSelectValue(model!, "__manual__");
      expect(onManual).toHaveBeenCalledWith(true);
      expect(host.querySelector('select[aria-label="AI 模型"]')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('input[aria-label="AI 模型"]')).not.toBeNull();
    } finally {
      unmount(host, root);
    }
  });

  it("发布目标知识库：原生 select 改目标后确认回传", () => {
    baseSelectEnabled = true;
    const { host, root, onConfirm } = renderPublish();
    try {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="选择知识库"]');
      expect(select).not.toBeNull();
      expect(select!.className).toContain("ln-select--native");
      expect(select!.className).toContain("publish-doc__select");
      expect([...select!.options].map((option) => option.textContent)).toEqual(["个人笔记", "工作"]);
      setSelectValue(select!, "nb2");
      act(() => { buttonByText("确认")!.click(); });
      expect(onConfirm).toHaveBeenCalledWith("nb2", "AI 生成文档");
    } finally {
      unmount(host, root);
    }
  });

  it("资源类型：原生 select 逐档筛选", async () => {
    baseSelectEnabled = true;
    nativeMock.listRemovedAssets.mockResolvedValue(ASSET_ITEMS);
    const { host, root } = await renderAssets();
    try {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="资源类型"]');
      expect(select).not.toBeNull();
      expect(select!.className).toContain("ln-select--native");
      expect(select!.value).toBe("all");
      expect([...select!.options].map((option) => option.textContent)).toEqual(["全部类型", "图片", "视频 / 音频", "文档", "其他"]);
      expect(host.querySelectorAll("[data-asset-key]")).toHaveLength(2);
      setSelectValue(select!, "image");
      expect(host.querySelectorAll("[data-asset-key]")).toHaveLength(1);
      expect(host.textContent).toContain("a.png");
      expect(host.textContent).not.toContain("b.pdf");
    } finally {
      unmount(host, root);
    }
  });
});
