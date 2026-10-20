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
  it("一级工具条分组与顺序：插入 | 撤销 重做 | 数字格式 | 更多", () => {
    expect(SHEET_TOOLBAR_GROUPS.map((group) => group.map((item) => item.id))).toEqual([
      ["insert"],
      ["undo", "redo"],
      ["numfmt"],
      ["more"],
    ]);
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
    expect(byId.get("border")?.disabled).toBe(true);
    expect(byId.get("filter")?.disabled).toBe(true);
    expect(byId.get("freeze")?.children?.map((item) => item.id)).toEqual(["freeze-row", "freeze-col", "freeze-none"]);
    expect(byId.get("row-height")?.children?.length).toBe(3);
    expect(byId.get("delete-row")?.danger).toBe(true);
    expect(byId.get("more-tools")?.id).toBe("more-tools");
  });

  it("数字格式卡：按类别分组、按当前 pattern 标「当前」，默认常规", () => {
    expect(numfmtLabelOf("")).toBe("常规");
    expect(numfmtLabelOf("#,##0.00")).toBe("数字");
    const items = buildNumfmtMenu("#,##0.00");
    expect(items.filter((item) => item.header).map((item) => item.label)).toEqual(["常规", "数值", "日期时间"]);
    expect(items.find((item) => item.id === "numfmt-number")?.note).toBe("当前");
    expect(items.length).toBe(12);
    expect(SHEET_CARD_META.more.width).toBe(232);
  });
});
