// @vitest-environment jsdom
/**
 * 快捷 capture（长按桌面图标「小记」/ `lakexlocalnotes://quick-note` 深链）退出链（261119 用户点单）：
 *  · 键盘**开着** ⇒ 返回只收键盘（261117「返回键优先收键盘」全局规则保留），capture 不退出；
 *  · 键盘**已收** ⇒ 下一次返回**立即退出 capture**，不吞第二下 —— 哪怕焦点仍挂在正文输入上。
 *
 * 现场（Android/WebView）：键盘开着时按返回由系统收输入法，`backButton` 事件**不派发**到 JS
 * ⇒ 我们的 blur 从未发生、焦点仍留在写作卡 contenteditable 上；旧逻辑 consumeBack 无条件按
 * activeIsTextInput 把下一下当成「再收一次早已收起的键盘」吞掉（肉眼无变化），第 3 下才退出。
 * 这里用真实挂载 + mock @capacitor/app 的 backButton 监听驱动（与真机同一条路径）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => {
  const state: { listener: (() => void) | null } = { listener: null };
  return {
    state,
    addListener: vi.fn(async (_event: string, cb: () => void) => {
      state.listener = cb;
      return { remove: vi.fn(async () => { if (state.listener === cb) state.listener = null; }) };
    }),
  };
});
vi.mock("@capacitor/app", () => ({ App: { addListener: app.addListener } }));

import { useBackHandler, type BackHandlerState } from "./useBackHandler";
import { pushBackHandler } from "../ui/backStack";
import { softKeyboardVisible } from "../ui/dismissKeyboard";
import { resetShellHeight } from "./viewportShell";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: string[] = [];
let cleanupBack: (() => void) | null = null;

const callbacks = {
  onCloseCapture: () => calls.push("capture"),
  onCloseSheets: () => calls.push("sheets"),
  onCloseDrawer: () => calls.push("drawer"),
  onBackFromNotebook: () => calls.push("notebook"),
  onAppExit: () => calls.push("exit"),
};

function Harness(props: Partial<BackHandlerState>): null {
  useBackHandler({
    route: { kind: "home", tab: "quick" },
    drawerOpen: false,
    createNbOpen: false,
    searchOpen: false,
    ...props,
    ...callbacks,
  });
  return null;
}

const render = async (props: Partial<BackHandlerState> = {}): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness, props));
    // useBackHandler 内部是 async import + addListener：等它注册完。
    await Promise.resolve();
    await Promise.resolve();
  });
};

const pressBack = (): void => {
  expect(app.state.listener).toBeTruthy();
  act(() => app.state.listener!());
};

/** 视口高 = 键盘状态的唯一输入（adjustResize：键盘把 WebView 压矮）。 */
const setViewport = (value: number): void => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value });
};
/** 键盘开着（842 → 530，与 useEditSurface 实测口径同值）。 */
const openKeyboard = (): void => setViewport(530);
const closeKeyboard = (): void => setViewport(842);

/** 写作卡正文输入（内核 contenteditable 的代理）：焦点挂在它上面。 */
const focusComposerInput = (): HTMLTextAreaElement => {
  const area = document.createElement("textarea");
  document.body.append(area);
  area.focus();
  return area;
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  app.state.listener = null;
  app.addListener.mockClear();
  calls = [];
  cleanupBack = null;
  resetShellHeight();
  closeKeyboard();
  // 键盘收起态先建立稳定外壳高基线（与 useKeyboard 挂载时首次测量同效）；
  // 基线只认「键盘收起时的视口高」，先弹键盘再测会把 530 当成外壳高、判不出键盘开着。
  softKeyboardVisible();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  cleanupBack?.();
  cleanupBack = null;
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  resetShellHeight();
  vi.unstubAllGlobals();
});

describe("快捷 capture 返回链（261119：收键盘后第 2 下直接退出）", () => {
  it("键盘开着：返回只收键盘（261117 全局规则），capture 不退出", async () => {
    await render({ captureOpen: true });
    const area = focusComposerInput();
    openKeyboard();
    pressBack();
    expect(calls, "只收键盘，不触发任何返回动作").toEqual([]);
    expect(document.activeElement, "键盘那一下负责 blur 收键盘").not.toBe(area);
  });

  it("键盘已收、焦点仍挂在输入上（系统收输入法不 blur 的现场）：本次返回立即退出 capture，不吞", async () => {
    await render({ captureOpen: true });
    const area = focusComposerInput();
    closeKeyboard();
    pressBack();
    expect(calls, "第二下直接退出 capture（不许再吞一下去收不存在的键盘）").toEqual(["capture"]);
    expect(document.activeElement).toBe(area); // 现场焦点就没离开过 —— 退出不依赖 blur
  });

  it("真机两下序列：第 1 下收键盘（键盘开着）→ 键盘收起后第 2 下退出；焦点被内核拉回也不吞", async () => {
    await render({ captureOpen: true });
    const area = focusComposerInput();
    openKeyboard();
    pressBack(); // 第 1 下：只收键盘
    expect(calls).toEqual([]);
    closeKeyboard();
    area.focus(); // 内核 contenteditable 把焦点要回去（只 focus 不弹键盘，AGENTS §7.28）
    pressBack(); // 第 2 下：立即退出
    expect(calls).toEqual(["capture"]);
  });

  it("capture 里的浮层（标签面板/确认框）仍是最上层：键盘已收先关浮层，下一下才退出", async () => {
    await render({ captureOpen: true });
    closeKeyboard();
    cleanupBack = pushBackHandler(() => { calls.push("overlay"); return true; });
    pressBack();
    expect(calls).toEqual(["overlay"]);
    cleanupBack();
    cleanupBack = null;
    pressBack();
    expect(calls).toEqual(["overlay", "capture"]);
  });

  it("键盘开着时浮层也不会被误关：先收键盘优先于一切返回动作", async () => {
    await render({ captureOpen: true });
    const area = focusComposerInput();
    openKeyboard();
    cleanupBack = pushBackHandler(() => { calls.push("overlay"); return true; });
    pressBack();
    expect(calls).toEqual([]);
    expect(document.activeElement).not.toBe(area);
  });

  it("非 capture 语义不变：焦点在输入上时返回仍先收键盘（261117 规则保留），下一下才轮到 Sheet", async () => {
    await render({ searchOpen: true });
    focusComposerInput();
    closeKeyboard(); // 键盘已收但焦点还在 —— 其它界面保持旧语义（仍先收键盘那一下）
    pressBack();
    expect(calls).toEqual([]);
    pressBack();
    expect(calls).toEqual(["sheets"]);
  });
});