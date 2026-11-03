import { describe, expect, it } from "vitest";
import {
  createPadShellState,
  isPadDocked,
  isPadPanelOpen,
  isPadPanelPinned,
  padEscapeTarget,
  padPinnedPrefs,
  padShellReducer,
  type PadShellState,
} from "./shellModel";

const baseState: PadShellState = { left: "closed", right: "closed" };
const run = (state: PadShellState, ...actions: Parameters<typeof padShellReducer>[1][]) =>
  actions.reduce((s, a) => padShellReducer(s, a), state);

describe("平板外壳状态机（P4 A2）", () => {
  it("偏好只由 pinned 初始化；cold start 固定即展开", () => {
    expect(createPadShellState({ tree: false, outline: false })).toEqual({ left: "closed", right: "closed" });
    expect(createPadShellState({ tree: true, outline: false })).toEqual({ left: "pinned", right: "closed" });
    expect(createPadShellState({ tree: true, outline: true })).toEqual({ left: "pinned", right: "pinned" });
  });

  it("setOpen：打开 closed → floating；关闭任意 → closed；打开 pinned 保持 pinned", () => {
    expect(run(baseState, { type: "setOpen", side: "left", open: true })).toEqual({ left: "floating", right: "closed" });
    expect(run({ left: "pinned", right: "closed" }, { type: "setOpen", side: "left", open: false })).toEqual(baseState);
    expect(run({ left: "floating", right: "closed" }, { type: "setOpen", side: "left", open: true })).toEqual({ left: "floating", right: "closed" });
  });

  it("toggle：closed ↔ floating；togglePin：pinned ↔ floating", () => {
    expect(run(baseState, { type: "toggle", side: "right" })).toEqual({ left: "closed", right: "floating" });
    expect(run({ left: "closed", right: "floating" }, { type: "toggle", side: "right" })).toEqual(baseState);
    expect(run(baseState, { type: "togglePin", side: "left" })).toEqual({ left: "pinned", right: "closed" });
    expect(run({ left: "pinned", right: "closed" }, { type: "togglePin", side: "left" })).toEqual({ left: "floating", right: "closed" });
  });

  it("点正文只收悬浮面板，固定态不受影响（261103 用户报的真问题）", () => {
    const state = run(baseState, { type: "setOpen", side: "left", open: true }, { type: "togglePin", side: "right" });
    expect(state).toEqual({ left: "floating", right: "pinned" });
    const after = padShellReducer(state, { type: "closeFloating" });
    expect(after).toEqual({ left: "closed", right: "pinned" });
    expect(isPadPanelOpen(after, "right")).toBe(true);
    expect(isPadPanelPinned(after, "right")).toBe(true);
  });

  it("closeAll 两侧都收；isPadDocked 只看 pinned", () => {
    const openBoth = run(baseState, { type: "setOpen", side: "left", open: true }, { type: "setOpen", side: "right", open: true });
    expect(isPadDocked(openBoth)).toBe(false);
    expect(isPadDocked(run(openBoth, { type: "togglePin", side: "left" }))).toBe(true);
    expect(run(openBoth, { type: "closeAll" })).toEqual(baseState);
  });

  it("Esc 顺序：浮层 → 左栏 → 右栏；固定态不参与", () => {
    expect(padEscapeTarget(baseState, false)).toBeNull();
    expect(padEscapeTarget(baseState, true)).toBe("overlay");
    const floatingLeft = run(baseState, { type: "setOpen", side: "left", open: true });
    expect(padEscapeTarget(floatingLeft, false)).toBe("left");
    const bothFloating = run(floatingLeft, { type: "setOpen", side: "right", open: true });
    expect(padEscapeTarget(bothFloating, false)).toBe("left");
    const leftClosed = padShellReducer(bothFloating, { type: "setOpen", side: "left", open: false });
    expect(padEscapeTarget(leftClosed, false)).toBe("right");
    const pinnedOnly = run(baseState, { type: "togglePin", side: "right" });
    expect(padEscapeTarget(pinnedOnly, false)).toBeNull();
  });

  it("持久化只记 pinned", () => {
    expect(padPinnedPrefs({ left: "floating", right: "pinned" })).toEqual({ tree: false, outline: true });
    expect(padPinnedPrefs({ left: "pinned", right: "closed" })).toEqual({ tree: true, outline: false });
  });
});
