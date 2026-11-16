import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 顶栏「左侧按钮区 | 多标签区」分隔线（261116 用户点单）。
 *
 * 用户原话：「给多tab和左侧的按钮之间加一个小竖线，来区分两个区域。」
 * 这里只做源码/样式断言（不引新依赖）：位置必须在 tabbar-leading 之后、tab-items 之前，
 * 且样式走 0.5px 边 + 令牌色（观感红线），空态不出悬空线。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("顶栏分隔线（tabbar-divider）", () => {
  const src = read("./MultiTabEditor.tsx");
  const css = read("../../styles/compat.css");

  it("夹在 tabbar-leading 与 tab-items 之间，且只在有标签时出现", () => {
    const leading = src.indexOf('className="tabbar-leading"');
    const divider = src.indexOf('className="tabbar-divider"');
    const items = src.indexOf('className="tab-items"');
    expect(leading).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(leading);
    expect(divider).toBeLessThan(items);
    expect(src).toContain("tabs.length > 0 && <span className=\"tabbar-divider\"");
  });

  it("0.5px 边 + 令牌色，尺寸走小竖线（不是整条边框）", () => {
    expect(css).toContain(".tabbar-divider {");
    expect(css).toContain("height: 14px;");
    expect(css).toContain("border-left: 0.5px solid var(--lake-border-1);");
    expect(css).toContain("width: 0;");
  });
});
