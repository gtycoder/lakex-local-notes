/**
 * 移动端表格 chrome 清单护栏（261020 P1）：一级 dock 顺序/分组、二级面板清单、数字格式回显。
 */
import { describe, expect, it } from "vitest";
import {
  USHEET_DOCK, USHEET_FILL_COLORS, USHEET_FILL_SOLID, USHEET_FONT_SIZES, USHEET_INSERT_GROUPS,
  USHEET_MORE_GROUPS, USHEET_NUMFMT_ITEMS, USHEET_TEXT_COLORS, alignOf, lineFlagOf, numfmtLabelOf,
} from "./usheetChromeModel";

describe("usheet chrome 清单（261020 设计定稿）", () => {
  it("一级 dock：＋ 插入 · Aa 文字格式 · B 加粗 · 常规(数字格式) · ⋯ 更多 · 撤销 · 重做（撤销/重做留在主条）", () => {
    expect(USHEET_DOCK.map((item) => item.id)).toEqual(["insert", "font", "bold", "numfmt", "more", "undo", "redo"]);
    expect(USHEET_DOCK.find((item) => item.id === "numfmt")?.text).toBe("常规");
    expect(USHEET_DOCK.find((item) => item.id === "font")?.text).toBe("Aa");
    // 面板型 vs 动作型：只有插入/文字格式/数字格式/更多开面板；加粗/撤销/重做是动作
    expect(USHEET_DOCK.filter((item) => item.kind === "panel").map((item) => item.panel)).toEqual(["insert", "font", "numfmt", "more"]);
    expect(USHEET_DOCK.filter((item) => item.kind === "action").map((item) => item.action)).toEqual(["bold", "undo", "redo"]);
  });

  it("Aa 面板只保留文字样式相关清单（字号 9 档 / 字色 / 底色）；⋯ 面板放布局与常用公式", () => {
    expect(USHEET_FONT_SIZES).toEqual([12, 13, 14, 16, 18, 20, 24, 28, 32]);
    expect(USHEET_TEXT_COLORS.length).toBeGreaterThan(0);
    expect(USHEET_FILL_COLORS.length).toBeGreaterThan(0);
    expect(USHEET_FILL_SOLID.length).toBeGreaterThan(0);
    // Aa 面板不含布局类动作（冻结/行高/列宽）——那些在「更多」
    const moreIds = USHEET_MORE_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    for (const id of ["freeze-row", "freeze-col", "freeze-none", "row-height-up", "row-height-down", "row-height-auto", "col-width-up", "col-width-down"]) {
      expect(moreIds).toContain(id);
    }
    expect(USHEET_MORE_GROUPS.map((group) => group.label)).toContain("常用公式");
    // 插入面板只放我们支持的能力（行/列/合并）
    expect(USHEET_INSERT_GROUPS.flatMap((group) => group.items.map((item) => item.id)).sort())
      .toEqual(["col-left", "col-right", "merge", "row-above", "row-below"]);
  });

  it("对齐回显：内核的 normal = 右对齐（setter 只收 left/center/normal），其余归 normal", () => {
    expect(alignOf("left")).toBe("left");
    expect(alignOf("center")).toBe("center");
    expect(alignOf("normal")).toBe("right");   // ← 右对齐按钮的高亮靠这条
    expect(alignOf("general")).toBe("general");
    expect(alignOf(undefined)).toBe("general");
  });

  it("下划线/删除线：{ s: 1 } 与裸 1 两种内核形状都认", () => {
    expect(lineFlagOf({ s: 1 })).toBe(true);
    expect(lineFlagOf(1)).toBe(true);
    expect(lineFlagOf({ s: 0 })).toBe(false);
    expect(lineFlagOf(0)).toBe(false);
    expect(lineFlagOf(undefined)).toBe(false);
  });

  it("数字格式：面板选项沿用单一来源；按钮文字映射当前 pattern（认不出显示自定义，空 = 常规）", () => {
    expect(USHEET_NUMFMT_ITEMS.map((item) => item.id)).toContain("numfmt-percent");
    expect(numfmtLabelOf("")).toBe("常规");
    expect(numfmtLabelOf(undefined)).toBe("常规");
    expect(numfmtLabelOf("0.00%")).toBe("百分比");
    expect(numfmtLabelOf("#,##0.00")).toBe("数字");
    expect(numfmtLabelOf("yyyy-MM-dd")).toBe("日期");
    expect(numfmtLabelOf("0.000000")).toBe("自定义");
  });
});
