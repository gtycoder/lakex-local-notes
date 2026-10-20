/**
 * 移动端表格「常用公式」快捷插入护栏（261020 P1 第四批）：
 * 单格 + 上方连续数值 → =FN(区域)；条件不满足必须返回 null（由组件提示，绝不覆盖/猜）。
 */
import { describe, expect, it } from "vitest";
import { columnName, planUsheetQuickFormula, USHEET_QUICK_FORMULAS, USHEET_QUICK_FORMULA_IDS } from "./usheetFormulaQuick";

describe("usheet 常用公式", () => {
  it("列名 A1 记法：0→A / 25→Z / 26→AA / 51→AZ / 52→BA / 701→ZZ / 702→AAA", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
    expect(columnName(701)).toBe("ZZ");
    expect(columnName(702)).toBe("AAA");
    expect(columnName(-3)).toBe("A"); // 防御：负数按 0
  });

  it("5 个函数都在清单里，id 与函数名一一对应", () => {
    expect([...USHEET_QUICK_FORMULA_IDS].sort()).toEqual(USHEET_QUICK_FORMULAS.map((item) => item.id).sort());
    expect(USHEET_QUICK_FORMULAS.map((item) => item.fn)).toEqual(["SUM", "AVERAGE", "COUNT", "MAX", "MIN"]);
  });

  it("单格 + 上方连续数值 → =FN(B1:B3)，写入目标就是选中的那一格", () => {
    const column = [10, 20, 30];
    const get = (row: number) => column[row];
    const plan = planUsheetQuickFormula("quickformula-sum", { row: 3, col: 1 }, get);
    expect(plan).toEqual({ formula: "=SUM(B1:B3)", targetRow: 3, targetColumn: 1 });
    expect(planUsheetQuickFormula("quickformula-average", { row: 3, col: 1 }, get)?.formula).toBe("=AVERAGE(B1:B3)");
    expect(planUsheetQuickFormula("quickformula-count", { row: 3, col: 1 }, get)?.formula).toBe("=COUNT(B1:B3)");
    expect(planUsheetQuickFormula("quickformula-max", { row: 3, col: 1 }, get)?.formula).toBe("=MAX(B1:B3)");
    expect(planUsheetQuickFormula("quickformula-min", { row: 3, col: 1 }, get)?.formula).toBe("=MIN(B1:B3)");
  });

  it("只认紧邻的连续数值：遇到空/文本/公式就停；文本型数字不算", () => {
    const column: unknown[] = [10, 20, null, 30];
    const get = (row: number) => column[row];
    // row3 上方是 null ⇒ 没有连续块
    expect(planUsheetQuickFormula("quickformula-sum", { row: 3, col: 1 }, get)).toBeNull();
    const mixed: unknown[] = [10, "20", true, 30];
    expect(planUsheetQuickFormula("quickformula-sum", { row: 3, col: 1 }, (row) => mixed[row])).toBeNull();
    // row2 上方只有 10、20 ⇒ 取到 B1:B2
    const normal: unknown[] = [10, 20, null];
    expect(planUsheetQuickFormula("quickformula-sum", { row: 2, col: 1 }, (row) => normal[row])?.formula).toBe("=SUM(B1:B2)");
  });

  it("第一行 / 未知动作 / 无上方数值 都返回 null（调用方提示，不写盘）", () => {
    expect(planUsheetQuickFormula("quickformula-sum", { row: 0, col: 0 }, () => 1)).toBeNull();
    expect(planUsheetQuickFormula("bold", { row: 3, col: 1 }, () => 10)).toBeNull();
    expect(planUsheetQuickFormula("quickformula-sum", { row: 3, col: 1 }, () => undefined)).toBeNull();
  });
});
