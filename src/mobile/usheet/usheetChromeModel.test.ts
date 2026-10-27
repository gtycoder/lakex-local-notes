import { describe, expect, it } from "vitest";
import {
  SHEET_ALIGN_H,
  SHEET_ALIGN_V,
  SHEET_DATA_ROWS,
  SHEET_DOCK_ITEMS,
  SHEET_FILL_LIGHT,
  SHEET_FILL_STRONG,
  SHEET_FONT_COLORS,
  SHEET_FONT_SIZES,
  SHEET_FORMAT_TOGGLES,
  SHEET_INSERTER_ACTIONS,
  SHEET_INSERT_TILES,
  SHEET_MORE_ROWS,
  SHEET_PANEL_MIN_HEIGHT,
  SHEET_VIEW_ROWS,
  SHEET_ZOOM_LEVELS,
  buildMoreSubMenu,
  normalizeSheetColor,
  numfmtLabelOf,
  sheetColorEquals,
  sheetPanelNeedsFade,
} from "./usheetChromeModel";

describe("移动端表格编辑态 dock 模型（261023 v5：对齐文档 dock）", () => {
  it("一级按钮顺序：插入 | T | 数据 | 视图 | 更多（撤销/重做/键盘由组件追加）", () => {
    expect(SHEET_DOCK_ITEMS.map((item) => item.id)).toEqual(["insert", "format", "data", "view", "more"]);
    expect(SHEET_DOCK_ITEMS.map((item) => item.label)).toEqual(["插入", "文字格式", "数据", "视图", "更多"]);
  });

  it("插入：4 个插入行列动作 + 7 个白块（公式按用户要求移到更多）", () => {
    expect(SHEET_INSERTER_ACTIONS.map((item) => item.id)).toEqual(["row-above", "row-below", "col-left", "col-right"]);
    expect(SHEET_INSERT_TILES.map((item) => item.id)).toEqual(["image", "sign", "link", "date", "attachment", "chart", "comment"]);
    expect(SHEET_INSERT_TILES.some((item) => item.label.includes("公式"))).toBe(false);
    // 暂未支持的项置灰（不出现「点了没反应」的死按钮）；链接/日期可用。
    expect(SHEET_INSERT_TILES.filter((item) => item.disabled).map((item) => item.id)).toEqual(["image", "sign", "attachment", "chart", "comment"]);
    expect(SHEET_INSERT_TILES.find((item) => item.id === "link")?.disabled).toBeUndefined();
    expect(SHEET_INSERT_TILES.find((item) => item.id === "date")?.disabled).toBeUndefined();
  });

  it("T 面板：B/I/S/U、水平/垂直对齐、字色 8、填充两行、字号 8 档", () => {
    expect(SHEET_FORMAT_TOGGLES.map((item) => item.id)).toEqual(["bold", "italic", "underline", "strike"]);
    expect(SHEET_ALIGN_H.map((item) => item.id)).toEqual(["left", "center", "right"]);
    expect(SHEET_ALIGN_V.map((item) => item.id)).toEqual(["top", "middle", "bottom"]);
    expect(SHEET_FONT_COLORS.length).toBe(8);
    expect(SHEET_FONT_COLORS[0].value).toBe("");
    for (const color of SHEET_FONT_COLORS.slice(1)) expect(color.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(SHEET_FILL_LIGHT[0].value).toBe("");
    expect(SHEET_FILL_LIGHT.length).toBe(7);
    expect(SHEET_FILL_STRONG.length).toBe(7);
    expect(SHEET_FONT_SIZES).toEqual([14, 15, 16, 19, 22, 24, 29, 32]);
  });

  it("数据 / 视图面板：先保留这些（含占位），视图比例三档", () => {
    expect(SHEET_DATA_ROWS.map((row) => row.id)).toEqual(["sort-asc", "sort-desc", "filter", "find", "validation", "split"]);
    expect(SHEET_DATA_ROWS.filter((row) => row.disabled).map((row) => row.id)).toEqual(["validation", "split"]);
    expect(SHEET_VIEW_ROWS.map((row) => row.id)).toEqual(["freeze", "formview", "chartview"]);
    expect(SHEET_VIEW_ROWS.filter((row) => row.disabled).map((row) => row.id)).toEqual(["formview", "chartview"]);
    expect(SHEET_ZOOM_LEVELS.map((level) => level.value)).toEqual([1, 0.85, 1.15]);
  });

  it("更多：数字格式 / 边框 / 公式可下钻；条件格式置灰", () => {
    expect(SHEET_MORE_ROWS.map((row) => row.id)).toEqual(["numfmt", "border", "formula", "merge", "painter", "clear", "conditional"]);
    expect(SHEET_MORE_ROWS.find((row) => row.id === "conditional")?.disabled).toBe(true);
    expect(buildMoreSubMenu("numfmt", "#,##0.00").find((item) => item.id === "numfmt-number")?.note).toBe("当前");
    expect(buildMoreSubMenu("border").length).toBe(8);
    expect(buildMoreSubMenu("formula").length).toBe(5);
    expect(numfmtLabelOf("")).toBe("常规");
  });

  it("颜色归一化：hex 大小写 / rgb() / 空值都能比较（T 面板反显口径）", () => {
    expect(normalizeSheetColor("#E5484D")).toBe("#e5484d");
    expect(normalizeSheetColor("rgb(229, 72, 77)")).toBe("#e5484d");
    expect(normalizeSheetColor("  ")).toBe("");
    expect(normalizeSheetColor("#abc")).toBe("#aabbcc");
    expect(sheetColorEquals("rgb(229, 72, 77)", "#e5484d")).toBe(true);
    expect(sheetColorEquals("", "")).toBe(true);
    expect(sheetColorEquals("#e5484d", "")).toBe(false);
  });

  it("面板下限高度放得下最高的常驻面板（更多 7 行 = 294；T = 300）", () => {
    // 行高 40（border-box 含 1px 分隔）+ 内距 6+8 —— 与 usheet-chrome.css 的 .mb-usheet-row / .mb-usheet-panel__inner 对齐。
    const moreContent = SHEET_MORE_ROWS.length * 40 + 14;
    expect(moreContent).toBe(294);
    expect(SHEET_PANEL_MIN_HEIGHT).toBe(300);
    expect(SHEET_PANEL_MIN_HEIGHT).toBeGreaterThanOrEqual(moreContent);
  });

  it("面板渐隐判据：只有下方还有内容才提示，贴底/完全放得下都不提示", () => {
    // 内容比可视区矮：不提示
    expect(sheetPanelNeedsFade({ scrollTop: 0, clientHeight: 312, scrollHeight: 306 })).toBe(false);
    // 溢出且未滚到底：提示
    expect(sheetPanelNeedsFade({ scrollTop: 0, clientHeight: 312, scrollHeight: 354 })).toBe(true);
    // 已滚到底（含 2px 亚像素容差）：不提示
    expect(sheetPanelNeedsFade({ scrollTop: 42, clientHeight: 312, scrollHeight: 354 })).toBe(false);
    expect(sheetPanelNeedsFade({ scrollTop: 41, clientHeight: 312, scrollHeight: 354 })).toBe(false);
    // 还差 3px 到底：仍然提示
    expect(sheetPanelNeedsFade({ scrollTop: 39, clientHeight: 312, scrollHeight: 354 })).toBe(true);
  });
});
