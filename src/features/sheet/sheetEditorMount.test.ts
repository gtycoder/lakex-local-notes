/**
 * SheetEditor（FortuneSheet）挂载护栏（260919）。
 *
 * 背景：表格内核由 jspreadsheet CE 换成 FortuneSheet（见 docs/FORTUNESHEET-FEASIBILITY-260919.md）。
 * vitest 是 node 环境、起不了 FortuneSheet（canvas），故用源码级断言（与 blockMenuNative.test.ts 同套路），
 * 锁死三条易回归的集成约束：
 * - keep-alive：只在「首次可见」后才挂载 <Workbook>（canvas 在 display:none 里初始化会量成 0 尺寸）；
 * - 非受控数据：data 只作初始值，不能把 onChange 回来的 data 再 setState 回灌（会打断输入/光标跳）；
 * - 只读：allowEdit=false + 只读态不挂自动保存。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SheetEditor.tsx", import.meta.url), "utf8");

describe("SheetEditor（FortuneSheet）挂载护栏", () => {
  it("引入 FortuneSheet 的 Workbook，且不再引用 jspreadsheet CE", () => {
    expect(SRC).toMatch(/from "@fortune-sheet\/react"/);
    expect(SRC).not.toMatch(/from "jspreadsheet-ce"/);
  });

  it("keep-alive：用 everVisible 保证首次可见后才挂载 Workbook", () => {
    expect(SRC).toMatch(/everVisible/);
    expect(SRC).toMatch(/\{everVisible && sheets\.length > 0 && \(/);
  });

  it("非受控数据：onChange 只写 ref，绝不 setSheets 回灌", () => {
    expect(SRC).toMatch(/latestRef\.current = next/);
    expect(SRC).not.toMatch(/setSheets\(/);
  });

  it("只读：allowEdit 取反；只读态不自动保存", () => {
    expect(SRC).toMatch(/allowEdit=\{!readOnly\}/);
    expect(SRC).toMatch(/readOnlyRef\.current/);
  });
});
