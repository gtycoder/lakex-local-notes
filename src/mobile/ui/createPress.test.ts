import { describe, expect, it } from "vitest";
import { CREATE_LONG_PRESS_MS, CREATE_SLIDE_PX, createPressArmed, createPressRevealed, blockPressRelease } from "./createPress";

describe("首页胶囊「整块触发」判定（261014 语雀手感）", () => {
  it("长按到点才浮出（边界取等）", () => {
    expect(createPressRevealed(CREATE_LONG_PRESS_MS - 1)).toBe(false);
    expect(createPressRevealed(CREATE_LONG_PRESS_MS)).toBe(true);
    expect(createPressRevealed(CREATE_LONG_PRESS_MS + 500)).toBe(true);
  });

  it("上滑触发线取等（向上为正）", () => {
    expect(createPressArmed(-(CREATE_SLIDE_PX - 1))).toBe(false);
    expect(createPressArmed(-CREATE_SLIDE_PX)).toBe(true);
    expect(createPressArmed(20)).toBe(false);
  });

  it("没长按到点 → pass：不接手势，交给条目自己的 onClick（短按语义不变）", () => {
    expect(blockPressRelease({ revealed: false, dy: 0 })).toBe("pass");
    expect(blockPressRelease({ revealed: false, dy: -8 })).toBe("pass");
    expect(blockPressRelease({ revealed: false, dy: 60 })).toBe("pass");
  });

  it("长按 + 上滑过线 = 速记；长按不上滑 = 取消（用户要求：长按不误建）", () => {
    expect(blockPressRelease({ revealed: true, dy: -(CREATE_SLIDE_PX - 1) })).toBe("cancel");
    expect(blockPressRelease({ revealed: true, dy: -CREATE_SLIDE_PX })).toBe("quick-note");
    expect(blockPressRelease({ revealed: true, dy: -120 })).toBe("quick-note");
    expect(blockPressRelease({ revealed: true, dy: 0 })).toBe("cancel");
    expect(blockPressRelease({ revealed: true, dy: 30 })).toBe("cancel");
  });
});
