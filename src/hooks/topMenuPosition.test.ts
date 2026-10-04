import { describe, expect, it } from "vitest";
import { chooseVisibleAnchor, clampPopoverPosition, placePopoverAtPoint, placePopoverAtPointBelow, placePopoverBeside, placePopoverPosition } from "./topMenuPosition";

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };

function element(rect: Rect) {
  return { getBoundingClientRect: () => rect };
}

describe("top menu positioning", () => {
  it("prefers a visible candidate when the shared ref points at a hidden keep-alive instance", () => {
    const hidden = element({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    const visible = element({ top: 5, bottom: 33, left: 196, right: 226, width: 30, height: 28 });

    expect(chooseVisibleAnchor(hidden, [hidden, visible])).toBe(visible);
  });

  it("keeps a fixed popover inside the viewport", () => {
    expect(clampPopoverPosition(
      { top: 5, bottom: 33, left: 196, right: 226 },
      { width: 750, height: 500 },
      { width: 320, height: 240 },
      8,
    )).toEqual({ top: 41, left: 196 });

    expect(clampPopoverPosition(
      { top: 5, bottom: 33, left: 700, right: 730 },
      { width: 750, height: 500 },
      { width: 320, height: 240 },
      8,
    )).toEqual({ top: 41, left: 422 });
  });

  it("贴底时向上翻转（下方放不下 → 锚点上方；这是 260929 修的那类反复踩的坑）", () => {
    const viewport = { width: 1200, height: 800 };
    const size = { width: 264, height: 320 };
    // 单元格在 600..636，下方只剩 164 < 320+8 ⇒ 翻到上方 600-4-320 = 276
    expect(placePopoverPosition({ top: 600, bottom: 636, left: 400, right: 664 }, viewport, size, 4))
      .toEqual({ top: 276, left: 400 });
    // 上下都放不下（面板几乎占满视口）⇒ 夹进视口，但整体仍可见（margin 显式 8，与 hook 默认一致）
    const tall = { width: 264, height: 760 };
    expect(placePopoverPosition({ top: 40, bottom: 76, left: 0, right: 264 }, viewport, tall, 4, { margin: 8 }).top).toBe(32);
  });

  it("坐标锚点（右键菜单）同样优先下方、放不下翻上方并夹左右", () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 200, height: 160 };
    // 点在上半屏：原样放在点下方
    expect(placePopoverAtPoint({ x: 100, y: 100 }, viewport, size)).toEqual({ top: 100, left: 100 });
    // 点贴近底边：翻到点上方
    expect(placePopoverAtPoint({ x: 100, y: 700 }, viewport, size)).toEqual({ top: 540, left: 100 });
    // 点贴近右边：水平夹回
    expect(placePopoverAtPoint({ x: 980, y: 100 }, viewport, size)).toEqual({ top: 100, left: 792 });
  });

  it("坐标锚点（AI 弹窗）只放下方：空间不够也绝不翻到锚点上方", () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 320, height: 400 };
    // 下方充足：原样放在点下方
    expect(placePopoverAtPointBelow({ x: 100, y: 100 }, viewport, size)).toEqual({ top: 100, left: 100 });
    // 点贴底、面板比下方空间高：仍然 >= 点的 y（对照 placePopoverAtPoint 会翻到 300 上方）
    expect(placePopoverAtPointBelow({ x: 100, y: 700 }, viewport, size).top).toBe(700);
    expect(placePopoverAtPoint({ x: 100, y: 700 }, viewport, size).top).toBe(300);
    // 锚点被滚到视口上方（负数/很小）：只夹到上边距，不翻到锚点上方
    expect(placePopoverAtPointBelow({ x: 50, y: -40 }, viewport, size).top).toBe(8);
    // 水平仍然夹进视口
    expect(placePopoverAtPointBelow({ x: 980, y: 100 }, viewport, size)).toEqual({ top: 100, left: 672 });
  });

  it("侧向子菜单优先右侧，空间不足时翻左侧", () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 296, height: 320 };
    expect(placePopoverBeside({ top: 120, bottom: 148, left: 200, right: 380 }, viewport, size, 4))
      .toEqual({ top: 116, left: 384 });
    expect(placePopoverBeside({ top: 120, bottom: 148, left: 760, right: 940 }, viewport, size, 4))
      .toEqual({ top: 116, left: 460 });
  });

  it("clampPopoverPosition 与锚定定位同源：也获得向上翻转", () => {
    expect(clampPopoverPosition(
      { top: 600, bottom: 636, left: 400, right: 664 },
      { width: 1200, height: 800 },
      { width: 264, height: 320 },
      4,
    )).toEqual({ top: 276, left: 400 });
  });
});
