import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./ExportSubmenuItem.tsx", import.meta.url), "utf8");

/**
 * 260930 用户口径：不同文档类型用各自的导出菜单、不混用；并**彻底移除**「导出为原生 Lake」。
 * 这是结构护栏（读源码），真正的菜单可见性由 CDP 真实验收覆盖。
 */
describe("导出菜单按文档类型拆分", () => {
  it("不再有「导出为原生 Lake」菜单项", () => {
    expect(SRC).not.toMatch(/导出为原生 Lake（图片内嵌）/);
    expect(SRC).not.toMatch(/onExportAs\("lake"\)/);
  });

  it("doc/sheet/bitable/board 各一套，不混用", () => {
    expect(SRC).toMatch(/type === "doc"/);
    expect(SRC).toMatch(/type === "sheet"/);
    expect(SRC).toMatch(/type === "bitable"/);
    expect(SRC).toMatch(/type === "board"/);
    // bitable：CSV + 压缩包（含附件）已实现
    expect(SRC).toMatch(/onExportAs\("csv"\)/);
    expect(SRC).toMatch(/onExportAs\("zip"\)/);
    expect(SRC).toMatch(/导出为压缩包（含附件）/);
    // sheet：CSV 已实现（活动工作表）；Excel 仍是占位
    expect(SRC).toMatch(/onExportAs\("csv"\)/);
    expect(SRC).toMatch(/onExportAs\("xlsx"\)/);
    expect(SRC).toMatch(/onExportAs\("docx"\)/);
    expect(SRC).not.toMatch(/导出为 Word（开发中）/);
    // board：PNG / SVG 已接线（复用画板内导出）
    expect(SRC).toMatch(/onExportAs\("png"\)/);
    expect(SRC).toMatch(/onExportAs\("svg"\)/);
    expect(SRC).not.toMatch(/导出为 PNG（开发中）/);
    expect(SRC).not.toMatch(/导出为 SVG（开发中）/);
  });
});
