import { describe, expect, it } from "vitest";
import { SYSTEM_EDGE_GUARD_PX, clamp01, getTouchAxis, isSystemEdgeStart, panelCommit, panelProgress, swipeTargetSide } from "./gestureCore";

describe("getTouchAxis（轴锁，对齐思源 touchGesture.ts）", () => {
  it("位移未过阈值 → undefined", () => {
    expect(getTouchAxis(3, 2)).toBeUndefined();
  });
  it("横向占优 → x（含阈值边界）", () => {
    expect(getTouchAxis(8, 0)).toBe("x");
    expect(getTouchAxis(-20, 5)).toBe("x");
  });
  it("纵向占优 → y", () => {
    expect(getTouchAxis(2, -12)).toBe("y");
  });
  it("等量 → y（只有严格横向占优才判 x）", () => {
    expect(getTouchAxis(10, 10)).toBe("y");
  });
});

describe("clamp01", () => {
  it("夹在 0..1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
  });
});

describe("panelProgress（跟手进度，带符号）", () => {
  it("未展开：向右滑一半 → 0.5；反向滑 → 0", () => {
    expect(panelProgress(false, 200, 400)).toBe(0.5);
    expect(panelProgress(false, -50, 400)).toBe(0);
    expect(panelProgress(false, 800, 400)).toBe(1);
  });
  it("已展开：向左滑 1/4 → 0.75；反向滑 → 1（跟着回退）", () => {
    expect(panelProgress(true, -100, 400)).toBe(0.75);
    expect(panelProgress(true, 80, 400)).toBe(1);
  });
});

describe("panelCommit（释放是否提交到目标态）", () => {
  it("未展开：慢拖 40px 或反向滑都不提交", () => {
    expect(panelCommit(false, 40, 1500, 400)).toBe(false);
    expect(panelCommit(false, -120, 300, 400)).toBe(false);
  });
  it("未展开：快速短滑（<1s）或慢拖越过 1/3 都提交", () => {
    expect(panelCommit(false, 55, 100, 400)).toBe(true);
    expect(panelCommit(false, 200, 2000, 400)).toBe(true);
  });
  it("已展开：慢拖小幅保持打开，越 1/3 或快滑则关闭", () => {
    expect(panelCommit(true, -40, 1500, 400)).toBe(true);
    expect(panelCommit(true, -200, 2000, 400)).toBe(false);
    expect(panelCommit(true, -55, 100, 400)).toBe(false);
  });
});

describe("swipeTargetSide（新手势拉哪一侧；该侧没有面板则作废）", () => {
  it("右滑开左栏、左滑开右栏（缺省两侧都可开）", () => {
    expect(swipeTargetSide(40)).toBe("left");
    expect(swipeTargetSide(-40)).toBe("right");
  });
  it("canOpen 拒绝该侧 → null（表格/多维表/画板没有大纲，左滑不拉出空面板）", () => {
    const onlyLeft = (side: "left" | "right"): boolean => side === "left";
    expect(swipeTargetSide(40, onlyLeft)).toBe("left");
    expect(swipeTargetSide(-40, onlyLeft)).toBeNull();
  });
});

describe("isSystemEdgeStart（系统手势边缘让位，261027）", () => {
  it("左右各 8px 命中；再往里 1px 就不算", () => {
    expect(SYSTEM_EDGE_GUARD_PX).toBe(8);
    expect(isSystemEdgeStart(0, 390)).toBe(true);
    expect(isSystemEdgeStart(8, 390)).toBe(true);
    expect(isSystemEdgeStart(9, 390)).toBe(false);
    expect(isSystemEdgeStart(382, 390)).toBe(true);
    expect(isSystemEdgeStart(381, 390)).toBe(false);
  });
  it("窄屏（宽度 ≤ 2×guard）不吞手势", () => {
    expect(isSystemEdgeStart(6, 16)).toBe(false);
  });
});
