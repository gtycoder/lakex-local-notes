// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keyboard = vi.hoisted(() => ({
  base: 842,
  innerHeight: 842,
  offset: 0,
  height: 0,
  keyboardOpen: false,
}));

vi.mock("../hooks/useKeyboard", () => ({
  useKeyboard: () => ({ ...keyboard }),
}));

import { useEditSurface, type EditSurfaceApi } from "./useEditSurface";

function rect(width: number): DOMRect {
  return {
    width,
    height: 100,
    top: 0,
    left: 0,
    right: width,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness(props: {
  width: number;
  editorId: string;
  onApi: (api: EditSurfaceApi) => void;
  onRestoreFocus: () => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (dock) dock.getBoundingClientRect = () => rect(props.width);
  });
  const surface = useEditSurface({
    editing: true,
    dockRef,
    restoreFocus: props.onRestoreFocus,
  });
  props.onApi(surface);

  return createElement(
    "div",
    { ref: dockRef },
    createElement("div", { id: props.editorId, contentEditable: true, suppressContentEditableWarning: true }),
    surface.closing
      ? createElement("div", {
          id: `panel-${props.editorId}`,
          onTransitionEnd: surface.onPanelTransitionEnd,
        })
      : null,
  );
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: EditSurfaceApi | null;
const render = (props: { width?: number; editorId?: string; onRestoreFocus?: () => void } = {}) => {
  act(() => {
    root.render(createElement(Harness, {
      width: props.width ?? 600,
      editorId: props.editorId ?? "editor",
      onApi: (next) => { api = next; },
      onRestoreFocus: props.onRestoreFocus ?? (() => {}),
    }));
  });
};

const panel = (editorId = "editor") => document.getElementById(`panel-${editorId}`);
const appHeight = () => document.documentElement.style.getPropertyValue("--mb-app-h");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(600));
  // jsdom 默认 innerHeight=768；显式钉住（个别用例会改它模拟键盘开合），避免用例间互相污染。
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true, writable: true });
  keyboard.base = 842;
  keyboard.innerHeight = 842;
  keyboard.offset = 0;
  keyboard.height = 0;
  keyboard.keyboardOpen = false;
  document.documentElement.style.removeProperty("--mb-app-h");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--mb-app-h");
});

describe("useEditSurface 可观察行为", () => {
  it("restore 收面板时占位保持到键盘真正接管，随后卸载并恢复外壳高度", () => {
    render();
    act(() => api!.openPanel("insert"));
    expect(api!.occupation).toBe(280);
    expect(appHeight()).toBe("562px");

    act(() => api!.closePanel("restore"));
    expect(api!.closing).toBe(true);
    expect(api!.occupation).toBe(280);
    expect(panel()).not.toBeNull();
    expect(appHeight()).toBe("562px");

    act(() => { panel()!.dispatchEvent(new Event("transitionend", { bubbles: true })); });
    expect(api!.closing, "键盘尚未回来时，transitionend 不能提前释放占位").toBe(true);
    expect(panel()).not.toBeNull();

    keyboard.innerHeight = 530;
    keyboard.height = 280;
    keyboard.keyboardOpen = true;
    render();
    expect(api!.closing).toBe(false);
    expect(api!.occupation).toBe(280);
    expect(panel()).toBeNull();
    expect(appHeight()).toBe("562px");

    keyboard.innerHeight = 842;
    keyboard.height = 0;
    keyboard.keyboardOpen = false;
    render();
    expect(api!.occupation).toBe(0);
    expect(appHeight()).toBe("842px");
  });

  it("键盘态点＋开面板、键盘在面板背后收起：外壳高仍钉住（261119 面板开合跳位回归）", () => {
    // 设备口径（adjustResize）：键盘态 innerHeight 530、稳定外壳高 842 ⇒ 外壳高 == 视口高 ⇒ 变量不写（100% 等价）。
    // ⚠️ 判据读的是 window.innerHeight ⇒ 测试必须连它一起模拟真实键盘开合，否则走不到「写 or 不写」分支。
    Object.defineProperty(window, "innerHeight", { value: 530, configurable: true, writable: true });
    keyboard.base = 842;
    keyboard.innerHeight = 530;
    keyboard.height = 312;
    keyboard.keyboardOpen = true;
    render();
    expect(appHeight(), "键盘态不写 --mb-app-h 字面量（AGENTS 键盘红线）").toBe("");

    act(() => api!.openPanel("insert"));
    // occupation 在键盘态 ⇄ 面板态恒等（312 = 面板接管键盘区）——这正是「内容视口恒定」的设计前提。
    expect(api!.occupation).toBe(312);
    // 面板开的**那一刻**（键盘还没收）就必须把外壳高钉住：resize 与 layout effect 之间有 ≥1 帧「变量缺席」窗口，
    // 浏览器会在那帧把 scrollTop 钳到新下限（261119 整屏跳的第二层真身，钳位瞬时不可逆）。
    expect(appHeight()).toBe("530px");

    // 键盘在面板背后收起：innerHeight 530 → 842，occupation 不变。
    Object.defineProperty(window, "innerHeight", { value: 842, configurable: true, writable: true });
    keyboard.innerHeight = 842;
    keyboard.height = 0;
    keyboard.keyboardOpen = false;
    render();
    expect(api!.occupation).toBe(312);
    expect(
      appHeight(),
      "面板态外壳高必须显式钉在 530px（= 稳定高 − 占用）；回退 100% 会让滚动口长高一个面板高 ⇒ scrollTop 被钳位 ⇒ 整屏跳",
    ).toBe("530px");

    // 收面板回键盘态：视口回 530 ⇒ 外壳高与视口再次相等 ⇒ 变量可清（100% 等价），几何不变。
    act(() => api!.closePanel("restore"));
    Object.defineProperty(window, "innerHeight", { value: 530, configurable: true, writable: true });
    keyboard.innerHeight = 530;
    keyboard.height = 312;
    keyboard.keyboardOpen = true;
    render();
    expect(appHeight()).toBe("");
  });

  it("hide 退场由 transitionend 卸载面板并归还外壳高度", () => {
    render();
    act(() => api!.openPanel("font"));
    act(() => api!.closePanel("hide"));
    expect(api!.closing).toBe(true);
    expect(panel()).not.toBeNull();

    act(() => { panel()!.dispatchEvent(new Event("transitionend", { bubbles: true })); });
    expect(api!.closing).toBe(false);
    expect(api!.occupation).toBe(0);
    expect(panel()).toBeNull();
    expect(appHeight()).toBe("842px");
  });

  it("没有 transitionend 时 watchdog 最终也会卸载面板", () => {
    vi.useFakeTimers();
    try {
      render();
      act(() => api!.openPanel("more"));
      act(() => api!.closePanel("hide"));
      expect(panel()).not.toBeNull();
      act(() => vi.runAllTimers());
      expect(api!.closing).toBe(false);
      expect(panel()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("隐藏 keep-alive 实例不响应正文 pointerdown/focusin，也不归还焦点", () => {
    const restoreFocus = vi.fn();
    render({ width: 0, editorId: "hidden-editor", onRestoreFocus: restoreFocus });
    const editor = document.getElementById("hidden-editor")!;
    editor.getBoundingClientRect = () => rect(0);
    act(() => api!.openPanel("insert"));

    act(() => { editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(api!.closing).toBe(false);

    act(() => { editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(editor.getAttribute("inputmode")).toBeNull();
  });

  it("可见实例在面板期点正文会收面板并归还焦点，focusin 只抑制输入法", () => {
    const restoreFocus = vi.fn();
    render({ editorId: "visible-editor", onRestoreFocus: restoreFocus });
    act(() => api!.openPanel("insert"));
    const editor = document.getElementById("visible-editor")!;

    act(() => { editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(editor.getAttribute("inputmode")).toBe("none");

    act(() => { editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(api!.closing).toBe(true);
    expect(editor.getAttribute("inputmode")).toBeNull();
  });
});
