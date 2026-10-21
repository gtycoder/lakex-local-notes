import { describe, expect, it } from "vitest";
import {
  SHEET_CARD_META,
  SHEET_TOOLBAR_GROUPS,
  buildInsertMenu,
  buildMoreRows,
  buildNumfmtMenu,
  numfmtLabelOf,
} from "./usheetChromeModel";

const FMT = { bold: false, italic: false, underline: false, strike: false, align: "general" as const, numfmt: "" };

describe("移动端表格 chrome 模型（261021：对齐语雀工具条）", () => {
  it("一级工具条分组与顺序：插入 | 撤销 重做 格式刷 清除格式 | 数字格式 | 小数位 | 更多（语雀 §2.1，去掉保存位）", () => {
    expect(SHEET_TOOLBAR_GROUPS.map((group) => group.map((item) => item.id))).toEqual([
      ["insert"],
      ["undo", "redo", "format-painter", "clear-style"],
      ["numfmt"],
      ["decimals"],
      ["more"],
    ]);
    // 保存不在工具条（用户 261021 定稿：顶栏 ✓ 已是手动保存并退出编辑）。
    expect(SHEET_TOOLBAR_GROUPS.flat().some((item) => item.label.includes("保存"))).toBe(false);
  });

  it("插入卡保留我们自己的插行列/合并（语雀 App 没有）", () => {
    expect(buildInsertMenu().map((item) => item.id)).toEqual(["row-above", "row-below", "col-left", "col-right", "merge"]);
  });

  it("⋯ 卡 = 语雀七行图标网格 + 我们自己的第八行；能力/置灰与子菜单齐备", () => {
    const rows = buildMoreRows(FMT);
    expect(rows.length).toBe(8);
    const buttons = rows.flat();
    const byId = new Map(buttons.map((button) => [button.id, button]));
    for (const id of ["bold", "italic", "strike", "underline", "font-color", "fill-color", "align", "merge", "formula", "freeze"]) {
      expect(byId.has(id)).toBe(true);
    }
    expect(byId.get("bold")?.active).toBe(false);
    // 261021 P5：边框已接（子菜单 8 项，对齐语雀常用框线）。
    expect(byId.get("border")?.disabled).toBeUndefined();
    expect(byId.get("border")?.children?.map((item) => item.id)).toEqual([
      "border-all", "border-outside", "border-inside", "border-top", "border-bottom", "border-left", "border-right", "border-none",
    ]);
    // 261021 P5：筛选/排序已接（不再是置灰占位）；排序用我们自己的子菜单。
    expect(byId.get("filter")?.disabled).toBeUndefined();
    // 查找替换：包已装但 UI 接不上（待排查）⇒ 仍是置灰占位，不放死按钮。
    expect(byId.get("find")?.disabled).toBe(true);
    expect(byId.get("sort")?.children?.map((item) => item.id)).toEqual(["sort-asc", "sort-desc"]);
    // 小数位按语雀分工：增已提到一级，「减」留在 ⋯ 卡第一行且现在可用。
    expect(rows[0].map((button) => button.id)).toEqual(["decimal-down"]);
    expect(byId.get("decimal-down")?.disabled).toBeUndefined();
    expect(byId.has("decimal-up")).toBe(false);
    expect(byId.get("freeze")?.children?.map((item) => item.id)).toEqual(["freeze-row", "freeze-col", "freeze-none"]);
    expect(byId.get("row-height")?.children?.length).toBe(3);
    expect(byId.get("delete-row")?.danger).toBe(true);
    expect(byId.get("more-tools")?.id).toBe("more-tools");
    // 261021 P4-2：二级选择器形态 —— 色板 / 图标行（语雀同款），其余保持列表。
    expect(byId.get("font-color")?.childLayout).toBe("swatch");
    expect(byId.get("fill-color")?.childLayout).toBe("swatch");
    expect(byId.get("align")?.childLayout).toBe("icons");
    expect(byId.get("freeze")?.childLayout).toBeUndefined();
    expect(byId.get("formula")?.childLayout).toBeUndefined();
    for (const item of byId.get("font-color")?.children ?? []) expect(item.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    for (const item of byId.get("align")?.children ?? []) expect(item.icon).toBeTruthy();
  });

  it("数字格式卡：按类别分组、按当前 pattern 标「当前」，默认常规", () => {
    expect(numfmtLabelOf("")).toBe("常规");
    expect(numfmtLabelOf("#,##0.00")).toBe("数字");
    const items = buildNumfmtMenu("#,##0.00");
    expect(items.filter((item) => item.header).map((item) => item.label)).toEqual(["通用", "数值", "日期时间"]);
    expect(items.find((item) => item.id === "numfmt-number")?.note).toBe("当前");
    expect(items.length).toBe(12);
    expect(SHEET_CARD_META.more.width).toBe(232);
  });
});
