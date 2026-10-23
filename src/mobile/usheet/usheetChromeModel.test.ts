import { describe, expect, it } from "vitest";
import {
  SHEET_CARD_META,
  SHEET_FONT_COLORS,
  SHEET_FORMAT_TOGGLES,
  SHEET_FREEZE_MENU,
  SHEET_FORMULA_MENU,
  SHEET_SORT_MENU,
  SHEET_TOOLBAR_ROWS,
  buildInsertMenu,
  buildMoreRows,
  buildNumfmtMenu,
  numfmtLabelOf,
} from "./usheetChromeModel";

describe("移动端表格 chrome 模型（261022 晚：两行工具条 + T 一级标签）", () => {
  it("工具条两行与分组顺序：常用 / 次常用；保存与小数位都不在工具条", () => {
    expect(SHEET_TOOLBAR_ROWS.map((row) => row.map((group) => group.map((item) => item.id)))).toEqual([
      [["insert"], ["undo", "redo"], ["format"], ["numfmt"], ["more"]],
      [["format-painter", "clear-style"], ["filter", "sort", "freeze", "find"], ["link", "formula"]],
    ]);
    const flat = SHEET_TOOLBAR_ROWS.flat(3);
    // 保存不在工具条（顶栏 ✓ 已是「保存并退出编辑」）。
    expect(flat.some((item) => item.label.includes("保存"))).toBe(false);
    // 用户 261022 晚：增/减小数位**都收进 ⋯**。
    expect(flat.some((item) => String(item.id) === "decimals")).toBe(false);
    // B/I/S/U/字色不再占一级（收进 T 的二级卡）。
    expect(flat.some((item) => ["bold", "italic", "strike", "underline", "font-color"].includes(item.id))).toBe(false);
  });

  it("插入卡保留我们自己的插行列/合并（语雀 App 没有）", () => {
    expect(buildInsertMenu().map((item) => item.id)).toEqual(["row-above", "row-below", "col-left", "col-right", "merge"]);
  });

  it("⋯ 卡只留低频能力：填充/边框/对齐/合并、小数位、行高/列宽、删除行列 + 未接占位", () => {
    const rows = buildMoreRows();
    expect(rows.length).toBe(4);
    const byId = new Map(rows.flat().map((button) => [button.id, button]));
    expect(rows[0].map((button) => button.id)).toEqual(["fill-color", "border", "align", "merge"]);
    expect(rows[1].map((button) => button.id)).toEqual(["decimal-up", "decimal-down", "row-height", "col-width"]);
    expect(rows[2].map((button) => button.id)).toEqual(["delete-row", "delete-col"]);
    for (const id of rows[3].map((button) => button.id)) expect(byId.get(id)?.disabled).toBe(true);
    expect(rows[3].map((button) => button.id)).toEqual(["font-size", "valign", "wrap", "select", "chart", "conditional", "protect"]);
    // 已搬走/删掉的项不能还留在这里（避免两套入口）。
    for (const id of ["bold", "italic", "strike", "underline", "font-color", "crosshair", "filter", "sort", "freeze", "find", "link", "formula", "more-tools"]) {
      expect(byId.has(id)).toBe(false);
    }
    // 边框子菜单 8 项；对齐是图标行；填充是色板。
    expect(byId.get("border")?.children?.map((item) => item.id)).toEqual([
      "border-all", "border-outside", "border-inside", "border-top", "border-bottom", "border-left", "border-right", "border-none",
    ]);
    expect(byId.get("align")?.childLayout).toBe("icons");
    expect(byId.get("fill-color")?.childLayout).toBe("swatch");
    for (const item of byId.get("fill-color")?.children ?? []) expect(item.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    expect(byId.get("row-height")?.children?.length).toBe(3);
    expect(byId.get("delete-row")?.danger).toBe(true);
  });

  it("T 卡（文字格式二级）：B / I / S / U 四个开关 + 8 色字体颜色", () => {
    expect(SHEET_FORMAT_TOGGLES.map((item) => [item.id, item.key])).toEqual([
      ["bold", "bold"], ["italic", "italic"], ["strike", "strike"], ["underline", "underline"],
    ]);
    expect(SHEET_FONT_COLORS.map((item) => item.id)).toContain("font-#e5484d");
    expect(SHEET_FONT_COLORS.length).toBe(8);
    for (const item of SHEET_FONT_COLORS) expect(item.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    expect(SHEET_CARD_META.format.width).toBe(240);
  });

  it("第二行的小卡：排序 2 项 / 冻结 3 项 / 公式 5 项", () => {
    expect(SHEET_SORT_MENU.map((item) => item.id)).toEqual(["sort-asc", "sort-desc"]);
    expect(SHEET_FREEZE_MENU.map((item) => item.id)).toEqual(["freeze-row", "freeze-col", "freeze-none"]);
    expect(SHEET_FORMULA_MENU.length).toBe(5);
    expect(SHEET_FORMULA_MENU[0].id).toBe("quickformula-sum");
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
