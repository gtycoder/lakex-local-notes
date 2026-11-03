// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boardInputDiagEnabled,
  boardInputReset,
  boardInputStats,
  installBoardInputDiagnostics,
} from "./boardInputDiagnostics";

const STORAGE_KEY = "lakex-local-notes-v3.board-input-debug";

/** jsdom 没有 PointerEvent（也没有 getCoalescedEvents）：用普通事件 + 定义 pointerType 模拟。 */
function pointer(type: string, pointerType: string): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

describe("画板输入诊断（261103 八批）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    boardInputReset();
  });
  afterEach(() => {
    window.localStorage.clear();
    boardInputReset();
  });

  it("默认关闭：不挂监听、不留数据", () => {
    expect(boardInputDiagEnabled()).toBe(false);
    const root = document.createElement("div");
    const off = installBoardInputDiagnostics(root);
    root.dispatchEvent(pointer("pointerdown", "mouse"));
    root.dispatchEvent(pointer("pointerup", "mouse"));
    expect(boardInputStats().strokes).toHaveLength(0);
    off();
  });

  it("开启后按「一次落笔」聚合 pointerType / moves / ups", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(boardInputDiagEnabled()).toBe(true);
    const root = document.createElement("div");
    const off = installBoardInputDiagnostics(root);
    root.dispatchEvent(pointer("pointerdown", "mouse"));
    for (let i = 0; i < 5; i += 1) root.dispatchEvent(pointer("pointermove", "mouse"));
    root.dispatchEvent(pointer("pointerup", "mouse"));
    const stroke = boardInputStats().strokes[0];
    expect(stroke.pointerType).toBe("mouse");
    expect(stroke.downs).toBe(1);
    expect(stroke.moves).toBe(5);
    expect(stroke.ups).toBe(1);
    expect(stroke.cancels).toBe(0);
    expect(stroke.mouseAfterPen).toBe(false);
    off();
  });

  it("pen 之后的 mouse 笔画带 mouseAfterPen 标记；pointercancel 计数", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const root = document.createElement("div");
    const off = installBoardInputDiagnostics(root);
    root.dispatchEvent(pointer("pointerdown", "pen"));
    root.dispatchEvent(pointer("pointerup", "pen"));
    root.dispatchEvent(pointer("pointerdown", "mouse"));
    root.dispatchEvent(pointer("pointercancel", "mouse"));
    const strokes = boardInputStats().strokes;
    expect(strokes).toHaveLength(2);
    expect(strokes[1].mouseAfterPen).toBe(true);
    expect(strokes[1].cancels).toBe(1);
    off();
  });
});
