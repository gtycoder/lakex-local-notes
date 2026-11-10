import { describe, expect, it } from "vitest";
import { resolveBelowFixed } from "./usePopoverPosition";

describe("below-fixed 落点（261110：底部锚点要翻到上方）", () => {
  const viewport = { height: 819 };

  it("正常空间：放下方，maxHeight 按剩余高度夹", () => {
    const out = resolveBelowFixed({ anchor: { top: 300, bottom: 328 }, viewport, size: { height: 400 }, gap: 8, margin: 4, left: 12, width: 418 });
    expect(out.flipped).toBe(false);
    expect(out.top).toBe(336);
    expect(out.maxHeight).toBe(819 - 336 - 4);
  });

  it("锚点在窗口最底部：翻到上方（否则压成 1px + 排到视口外）", () => {
    const out = resolveBelowFixed({ anchor: { top: 784, bottom: 810 }, viewport, size: { height: 400 }, gap: 8, margin: 4, left: 12, width: 418 });
    expect(out.flipped).toBe(true);
    expect(out.top).toBe(784 - 8 - 400);
    expect(out.maxHeight).toBe(784 - 8 - 4);
    expect(out.top).toBeGreaterThanOrEqual(4);
  });

  it("上下都紧张时仍给非负高度（不出现负 maxHeight）", () => {
    const out = resolveBelowFixed({ anchor: { top: 2, bottom: 12 }, viewport, size: { height: 300 }, gap: 8, margin: 4, left: 0 });
    expect(out.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
