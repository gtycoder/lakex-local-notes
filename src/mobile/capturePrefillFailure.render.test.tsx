// @vitest-environment jsdom
/**
 * 快捷入口取数流「静默失败」收尾护栏（261119 发版前修补 P2-2）。
 *
 * 现场：MobileApp 的 `import("./home/captureModeFlow").then(...).catch(() => undefined)` 吞错 ⇒
 * prefillPendingRef 卡 true、seedReady 卡 false，capture 分支只剩空壳 `.mobile-qn-composer` div
 * 且无任何提示（写作卡永远不挂载）。修复 = catch 里做 onCancel 等价收尾（清 pending / 放行挂载）
 * + showToast 短提示。本文件用真实挂载把「catch 后不再空壳 + 有提示」钉住。
 *
 * 三模式既有语义（plain / camera / clipboard）由 captureModeFlow.test.ts 与 quickNoteCapturePath.test.ts
 * 钉住，本文件只盯失败收尾这一条链路（runCaptureFlow 用可控 deferred 驱动，时序确定）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  runCaptureFlow: vi.fn(),
  loadQuickNoteComposer: vi.fn(),
  showToast: vi.fn(),
  shortcutListener: null as ((mode: string) => void) | null,
}));

vi.mock("./home/captureModeFlow", () => ({ runCaptureFlow: h.runCaptureFlow }));
vi.mock("./home/quickNoteComposerLazy", () => ({
  QuickNoteComposerLazy: () => createElement("div", { "data-testid": "composer" }),
  loadQuickNoteComposer: h.loadQuickNoteComposer,
  getQuickNoteComposerSync: () => null,
  subscribeQuickNoteComposer: () => () => undefined,
}));
vi.mock("./home/HomePage", () => ({ HomePage: () => null }));
vi.mock("./ui/toastBus", () => ({
  showToast: h.showToast,
  hideToast: () => undefined,
  getToastSnapshot: () => [],
  subscribeToasts: () => () => undefined,
}));
vi.mock("./native/quickNoteShortcut", () => ({
  subscribeQuickNoteShortcut: (onTrigger: (mode: string) => void) => {
    h.shortcutListener = onTrigger;
    return () => undefined;
  },
  whenQuickNoteLaunchResolved: async () => true,
  isNativePlatform: () => true,
  isQuickNoteShortcutUrl: () => true,
  quickNoteShortcutMode: () => "camera",
  readLaunchUrlHint: () => "",
}));
vi.mock("./native/kernelPrewarm", () => ({
  scheduleKernelPrewarm: () => undefined,
  scheduleComposerPrewarm: () => undefined,
}));
vi.mock("./hooks/useAutoSync", () => ({ useAutoSync: () => undefined }));
vi.mock("./hooks/useUpdateAutoCheck", () => ({ useUpdateAutoCheck: () => undefined }));
vi.mock("./portable/importPortable", () => ({
  recoverInterruptedPortableImport: async () => undefined,
  consumePortableRecoveryNotice: () => null,
}));
vi.mock("./bridge", () => ({
  bridge: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => {
      if (prop === "init") return async () => undefined;
      if (prop === "getHomeSnapshot") return async () => ({ treeNodes: [], notes: [], quickNotes: { items: [] } });
      if (prop === "listQuickNoteTags") return async () => [];
      if (prop === "getHistorySettings") return async () => ({ snapshotIntervalMinutes: 0 });
      return async () => undefined;
    },
  }),
}));

import { MobileApp } from "./MobileApp";

type FlowInput = {
  mode: string;
  whenReady: () => Promise<unknown>;
  isCurrent: () => boolean;
  setCaptureSeed: (seed: unknown) => void;
  setSeedReady: (ready: boolean) => void;
  prefill: { current: boolean };
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
/** 取数流 deferred：测试显式落定（reject = 失败收尾路径），微任务时序不再靠猜。 */
let pendingFlows: FlowInput[];
let settleFlow: { reject: (error: Error) => void } | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.runCaptureFlow.mockReset().mockImplementation((input: FlowInput) => {
    pendingFlows.push(input);
    return new Promise<void>((_resolve, reject) => {
      settleFlow = { reject };
    });
  });
  h.loadQuickNoteComposer.mockReset().mockResolvedValue(undefined);
  h.showToast.mockReset();
  h.shortcutListener = null;
  pendingFlows = [];
  settleFlow = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const shell = () => host.querySelector(".mobile-qn-composer");
const composer = () => host.querySelector('[data-testid="composer"]');

describe("取数流失败收尾（P2-2：catch 后不再空壳 + 有提示）", () => {
  it("camera 取数流抛错 ⇒ catch 放行挂载（空壳换写作卡）+「速记内容准备失败」提示", async () => {
    await act(async () => {
      root.render(<MobileApp initialCapture initialCaptureMode="camera" />);
      await Promise.resolve();
    });
    // 失败落定前 = 空壳（取数落定前不挂写作卡；这就是旧 bug 卡死的那块空壳）。
    expect(shell(), "取数落定前应停在空壳").toBeTruthy();
    expect(composer()).toBeNull();

    await act(async () => {
      settleFlow!.reject(new Error("boom"));
      await Promise.resolve();
    });
    expect(h.runCaptureFlow).toHaveBeenCalledTimes(1);
    // catch 后不再空壳：写作卡挂载。
    expect(composer(), "catch 收尾后写作卡应挂载（不再空壳）").toBeTruthy();
    expect(shell()).toBeNull();
    // 且有可见提示（不再静默）。
    expect(h.showToast).toHaveBeenCalledWith("速记内容准备失败", { type: "error" });
  });

  it("失败收尾后再次触发（新代际）不被旧失败钉死：重新进 pending → 新流落定再挂卡", async () => {
    await act(async () => {
      root.render(<MobileApp initialCapture initialCaptureMode="camera" />);
      await Promise.resolve();
    });
    await act(async () => {
      settleFlow!.reject(new Error("boom"));
      await Promise.resolve();
    });
    expect(composer()).toBeTruthy();

    // 新一次快捷触发（clipboard）：pending 重新成立 ⇒ 先回空壳等取数（旧失败不得钉死新会话）。
    await act(async () => {
      h.shortcutListener?.("clipboard");
      await Promise.resolve();
    });
    expect(composer(), "新取数落定前不挂卡").toBeNull();
    expect(shell()).toBeTruthy();

    // 新流正常落定（等价 onEmpty 收尾：清 pending / 放行挂载）⇒ 挂卡。
    const flow = pendingFlows[pendingFlows.length - 1];
    await act(async () => {
      flow.prefill.current = false;
      flow.setSeedReady(true);
      await Promise.resolve();
    });
    expect(composer(), "新流落定后挂卡").toBeTruthy();
    expect(shell()).toBeNull();
  });
});
