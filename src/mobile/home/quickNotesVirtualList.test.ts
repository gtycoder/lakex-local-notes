import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME = readFileSync(new URL("./HomePage.tsx", import.meta.url), "utf8");
const LIST = readFileSync(new URL("./QuickNotesVirtualList.tsx", import.meta.url), "utf8");

/**
 * 小记时间线虚拟列表（261120 首屏瘦身后：实现搬进懒组件 QuickNotesVirtualList）。
 *
 * 钉两件事：
 * ① 懒边界成立 —— HomePage **不再静态 import @tanstack**，虚拟行窗口是 React.lazy 的独立 chunk
 *   （入口 chunk 实测因此 −≈8.7KB gzip）；短列表仍走原「全量渲染」路径，chunk 根本不下载。
 * ② 行为不退化 —— 长列表的变量高度虚拟化（168 估值 + overscan 6 + measureElement）与
 *   「全局搜索定位先滚目标索引、再等行挂载」的时序都保留（只是 scrollToIndex 移进了懒组件）。
 */
describe("小记时间线虚拟列表（懒组件）", () => {
  it("HomePage 不再静态引入 tanstack：虚拟行窗口走 React.lazy 独立 chunk", () => {
    expect(HOME).not.toContain("@tanstack/react-virtual");
    expect(HOME).toContain('lazy(() => import("./QuickNotesVirtualList")');
    expect(HOME).toContain("QUICK_NOTE_VIRTUAL_THRESHOLD = 24");
    // 短列表 = 原渲染路径；长列表 = Suspense + 懒组件（fallback 先画前 12 条同构卡片）
    expect(HOME).toMatch(/quickVirtualEnabled \?\s*\(/);
    expect(HOME).toContain("<QuickNotesVirtualList");
    expect(HOME).toContain("sortedQuickNotes.slice(0, 12).map(renderQuickNoteCard)");
  });

  it("懒组件保留变量高度虚拟化与 measureElement（行为不退化）", () => {
    expect(LIST).toContain("useVirtualizer<HTMLDivElement, HTMLDivElement>");
    expect(LIST).toContain("enabled: scrollElement !== null");
    expect(LIST).toMatch(/estimateSize: \(\) => 168/);
    expect(LIST).toContain("overscan: 6");
    expect(LIST).toContain("virtualizer.measureElement");
    expect(LIST).toContain("virtualizer.getTotalSize() - scrollMargin");
  });

  it("全局搜索定位：滚目标索引后仍走两帧 + 行挂载再消费 pending", () => {
    // scrollToIndex 现在在懒组件里（由父级把下标传下去）
    expect(LIST).toMatch(/virtualizer\.scrollToIndex\(scrollToIndex/);
    expect(HOME).toContain("setQuickVirtualScrollIndex(index)");
    expect(HOME).toContain("scrollToIndex={quickVirtualScrollIndex}");
    expect(HOME).toMatch(/requestAnimationFrame\(\(\) => \{[\s\S]{0,180}requestAnimationFrame/);
    expect(HOME).toContain("onPendingQuickNoteConsumed?.()");
  });
});
