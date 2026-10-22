import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME = readFileSync(new URL("./HomePage.tsx", import.meta.url), "utf8");

describe("小记时间线虚拟列表", () => {
  it("大列表启用变量高度虚拟化，小列表保持原渲染路径", () => {
    expect(HOME).toContain("QUICK_NOTE_VIRTUAL_THRESHOLD = 24");
    expect(HOME).toContain("useVirtualizer<HTMLDivElement, HTMLDivElement>");
    expect(HOME).toMatch(/enabled: quickVirtualEnabled/);
    expect(HOME).toContain("measureElement");
    expect(HOME).toMatch(/quickVirtualEnabled \?\s*\(/);
  });

  it("全局搜索定位在虚拟模式下先滚动目标索引，再等待行挂载", () => {
    expect(HOME).toMatch(/quickVirtualizer\.scrollToIndex\(index/);
    expect(HOME).toMatch(/requestAnimationFrame\(\(\) => \{[\s\S]{0,180}requestAnimationFrame/);
    expect(HOME).toContain("onPendingQuickNoteConsumed?.()");
  });
});
