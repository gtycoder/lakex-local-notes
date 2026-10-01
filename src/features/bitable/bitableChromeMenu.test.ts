import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR = readFileSync(new URL("./BitableEditor.tsx", import.meta.url), "utf8");
const BAR = readFileSync(new URL("./BitableViewBar.tsx", import.meta.url), "utf8");

/**
 * 260930 用户口径：多维表右上角加一个类似 lake 文档的菜单，把「搜索 / 导出 CSV」放进去，并补「锁定（只读）」入口。
 * 结构护栏；真实点击/展开与只读生效由 CDP 真实验收覆盖。
 */
describe("多维表右上角菜单", () => {
  it("视图页签行最右侧渲染「更多」入口", () => {
    expect(BAR).toMatch(/trailing\?: ReactNode/);
    expect(BAR).toMatch(/bt-viewbar-trailing/);
    expect(EDITOR).toMatch(/trailing=\{/);
  });

  it("菜单含 搜索 / 导出为 CSV / 锁定（只读）", () => {
    expect(EDITOR).toMatch(/<Search size=\{14\} \/>搜索/);
    expect(EDITOR).toMatch(/<Download size=\{14\} \/>导出为 CSV/);
    expect(EDITOR).toMatch(/锁定当前文档（只读）/);
    expect(EDITOR).toMatch(/解锁当前文档/);
  });

  it("搜索已从工具条移入菜单", () => {
    expect(EDITOR).not.toMatch(/bt-tool-btn" \+ \(findOpen/);
  });
});
