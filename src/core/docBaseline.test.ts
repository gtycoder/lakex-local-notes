import { describe, expect, it } from "vitest";
import { canonicalDocBody, docBaselineSettled, sameDocAsDisk } from "./docBaseline.js";
import { boardToBody, parseBoardBodyChecked } from "./boardDoc.js";
import { createInkDoc, inkToBody } from "./inkDoc.js";
import { usheetToBody, type UsheetWorkbook } from "./usheetDoc.js";

/**
 * CORE-03：「打开 = 只读」core 单一判据。
 * 锁住三件事：① 规范化幂等；② 无改动 / 改回原样 = 与磁盘原文等价；③ 真实改动不等价。
 * 覆盖 usheet / board / ink 三族（宿主接线见各自测试）。
 */
const usheetDisk = JSON.stringify({
  version: 1,
  kind: "usheet",
  workbook: {
    id: "workbook",
    sheetOrder: ["s1"],
    resources: [{ name: "SHEET_NOTE_PLUGIN", data: "" }],
    sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: { "0": { "0": { v: "季度预算" } } } } },
    defaultStyle: { ff: "MiSans" },
  },
});

const boardDisk = JSON.stringify({
  preset: "flowchart",
  plaitValue: [{ id: "a", type: "geometry" }],
  viewport: { x: 12, y: 34, zoom: 1 },
  kind: "board",
});

const inkDisk = inkToBody({
  ...createInkDoc("p1"),
  pages: [
    { ...createInkDoc("p1").pages[0], strokes: [{ id: "s1", tool: "pen", color: "#000", width: 2, points: [{ x: 1, y: 2, pressure: 0.5 }] }] },
    { ...createInkDoc("p1").pages[0], id: "p2" },
  ],
  activePageId: "p1",
});

function withUsheetCell(disk: string, value: string): string {
  const parsed = JSON.parse(disk) as { workbook: UsheetWorkbook };
  parsed.workbook.sheets!.s1.cellData!["0"]["0"] = { v: value };
  return usheetToBody(parsed.workbook);
}

describe("core/docBaseline（CORE-03）", () => {
  it("规范化幂等：canonical(canonical(x)) === canonical(x)", () => {
    for (const [kind, disk] of [["usheet", usheetDisk], ["board", boardDisk], ["ink", inkDisk]] as const) {
      const once = canonicalDocBody(kind, disk);
      expect(once).not.toBeNull();
      expect(canonicalDocBody(kind, once)).toBe(once);
    }
  });

  it("usheet：无改动 / 改回原样 ⇒ 与磁盘原文等价（不同序列化形态也算）", () => {
    const canonical = canonicalDocBody("usheet", usheetDisk);
    expect(canonical).not.toBeNull();
    // 磁盘原文非规范（resources 空串 + 字族非 canonical）；规范化后仍应等价。
    expect(sameDocAsDisk("usheet", usheetDisk, usheetDisk)).toBe(true);
    expect(sameDocAsDisk("usheet", usheetDisk, canonical)).toBe(true);
    expect(docBaselineSettled("usheet", usheetDisk, canonical)).toBe(true);
    // 真实改动：单元格值变了；改回原值后重新与磁盘原文等价。
    const edited = withUsheetCell(usheetDisk, "已改");
    expect(sameDocAsDisk("usheet", usheetDisk, edited)).toBe(false);
    expect(sameDocAsDisk("usheet", usheetDisk, withUsheetCell(edited, "季度预算"))).toBe(true);
  });

  it("空正文 = 空文档（新建 / 清空不写盘）", () => {
    for (const kind of ["usheet", "board", "ink"] as const) {
      const empty = canonicalDocBody(kind, "");
      expect(empty).not.toBeNull();
      expect(sameDocAsDisk(kind, "", empty)).toBe(true);
    }
  });

  it("board：字段名/顺序归一后等价；新增元素算真实改动", () => {
    const parsed = parseBoardBodyChecked(boardDisk);
    expect(parsed.readable).toBe(true);
    const canonical = boardToBody(parsed.doc);
    expect(sameDocAsDisk("board", boardDisk, canonical)).toBe(true);
    expect(sameDocAsDisk("board", boardDisk, JSON.stringify({ ...parsed.doc, elements: [{ id: "b" }] }))).toBe(false);
  });

  it("ink：重排/冗余字段归一后等价；改 activePageId 算真实改动", () => {
    const canonical = canonicalDocBody("ink", inkDisk);
    expect(canonical).not.toBeNull();
    expect(sameDocAsDisk("ink", inkDisk, canonical)).toBe(true);
    const changed = JSON.parse(inkDisk) as { activePageId: string };
    changed.activePageId = "p2";
    expect(sameDocAsDisk("ink", inkDisk, JSON.stringify(changed))).toBe(false);
  });

  it("坏正文绝不参与等价（不能借等价路径把坏正文写回）", () => {
    for (const kind of ["usheet", "board", "ink"] as const) {
      expect(canonicalDocBody(kind, "{ 不是 JSON")).toBeNull();
      expect(sameDocAsDisk(kind, "{ 坏", "{ 坏")).toBe(false);
    }
  });
});
