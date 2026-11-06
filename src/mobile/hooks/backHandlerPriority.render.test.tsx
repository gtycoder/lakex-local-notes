// @vitest-environment jsdom
/**
 * Android 返回键**优先级**回归（261106：只改「首页最终兜底 = 两次退出」，上面的优先级必须原样）：
 * 浮层返回栈 → 小记（capture）→ Sheet（新建知识库/搜索）→ Drawer → 工作区 → 首页兜底。
 * 通过 mock @capacitor/app 的 backButton 监听驱动（与真机同一条路径）。
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

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  app.state.listener = null;
  app.addListener.mockClear();
  calls = [];
  cleanupBack = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  cleanupBack?.();
  cleanupBack = null;
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("返回键优先级（不因两次退出改动而回归）", () => {
  it("浮层返回栈最优先（消费后不再往下走）", async () => {
    await render({ drawerOpen: true, searchOpen: true });
    cleanupBack = pushBackHandler(() => { calls.push("back"); return true; });
    pressBack();
    expect(calls).toEqual(["back"]);
  });

  it("小记（capture）先于 Sheet / Drawer", async () => {
    await render({ captureOpen: true, searchOpen: true, drawerOpen: true });
    pressBack();
    expect(calls).toEqual(["capture"]);
  });

  it("Sheet → Drawer → 工作区 → 首页兜底 逐级下降", async () => {
    await render({ searchOpen: true, drawerOpen: true });
    pressBack();
    expect(calls).toEqual(["sheets"]);

    calls = [];
    await render({ createNbOpen: true, drawerOpen: true });
    pressBack();
    expect(calls).toEqual(["sheets"]);

    calls = [];
    await render({ drawerOpen: true });
    pressBack();
    expect(calls).toEqual(["drawer"]);

    calls = [];
    await render({ route: { kind: "notebook", notebookId: "nb1" } });
    pressBack();
    expect(calls).toEqual(["notebook"]);

    calls = [];
    await render({});
    pressBack();
    expect(calls).toEqual(["exit"]);
  });

  it("首页兜底就是 onAppExit 那一个回调（两次退出的判据在 MobileApp 里，hook 只负责调用它）", async () => {
    await render({});
    pressBack();
    pressBack();
    expect(calls).toEqual(["exit", "exit"]);
  });
});
