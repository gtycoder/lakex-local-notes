// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { matrixFromTableElement, payloadFromMatrix, tableIndexInHost, tableMatrixFromBody } from "./tableClipboardModel";
import { parseHtmlTable } from "../usheet/usheetClipboardTable";

/** 正文里的表格形态（真实样本：<table class="lake-table"> + <td><p><span>）。 */
const bodyTable = (rows: number, cols = 3) => {
  const cells = Array.from({ length: rows }, (_, r) =>
    "<tr>" + Array.from({ length: cols }, (_, c) => `<td><p data-lake-id="p${r}${c}"><span>R${r + 1}C${c + 1}</span></p></td>`).join("") + "</tr>");
  return `<p>前言</p><table data-lake-id="t1" class="lake-table"><tbody>${cells.join("")}</tbody></table><p>后记</p>`;
};

describe("表格复制数据源 = 内核正文（261122：DOM 虚拟渲染会缺行）", () => {
  it("从正文解析整张表：115 行 × 5 列不丢行（DOM 只渲染视口附近的行）", () => {
    const matrix = tableMatrixFromBody(bodyTable(115, 5), 0);
    expect(matrix).not.toBeNull();
    expect(matrix!).toHaveLength(115);
    expect(matrix![0]).toHaveLength(5);
    expect(matrix![0][0]).toBe("R1C1");
    expect(matrix![114][4]).toBe("R115C5");
  });

  it("多张表按**文档顺序**取第 index 张（与 DOM 的序号对齐）", () => {
    const two = bodyTable(2, 2) + bodyTable(3, 2);
    expect(tableMatrixFromBody(two, 0)).toHaveLength(2);
    expect(tableMatrixFromBody(two, 1)).toHaveLength(3);
    expect(tableMatrixFromBody(two, 2)).toBeNull();
  });

  it("空行保留（行对齐是数据），整表全空才返回 null", () => {
    const withBlank = '<table class="lake-table"><tr><td><p><span>A</span></p></td></tr><tr><td></td></tr></table>';
    expect(tableMatrixFromBody(withBlank, 0)).toEqual([["A"], [""]]);
    expect(tableMatrixFromBody('<table class="lake-table"><tr><td></td></tr></table>', 0)).toBeNull();
    expect(tableMatrixFromBody("", 0)).toBeNull();
  });

  it("载荷 → 我们的表格解析器可回读（复制/粘贴两端格式闭环）", () => {
    const payload = payloadFromMatrix([["命令分组", "命令"], ["Generic", "EXISTS key [key ...]"]]);
    expect(payload.plain).toBe("命令分组\t命令\nGeneric\tEXISTS key [key ...]");
    expect(parseHtmlTable(payload.html)).toEqual([["命令分组", "命令"], ["Generic", "EXISTS key [key ...]"]]);
  });

  it("DOM 回退路径：仍在（拿不到正文时保底），但只含已渲染行", () => {
    const doc = new DOMParser().parseFromString(bodyTable(3, 2), "text/html");
    const table = doc.querySelector("table") as HTMLTableElement;
    expect(matrixFromTableElement(table)).toEqual([["R1C1", "R1C2"], ["R2C1", "R2C2"], ["R3C1", "R3C2"]]);
  });

  it("tableIndexInHost：按宿主内表格顺序取序号", () => {
    const host = document.createElement("div");
    host.innerHTML = '<table class="lake-table"></table><table class="lake-table"></table>';
    const tables = host.querySelectorAll("table");
    expect(tableIndexInHost(host, tables[1] as HTMLTableElement)).toBe(1);
    expect(tableIndexInHost(host, document.createElement("table"))).toBe(-1);
  });
});
