import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeImportText, describeImportFile, importKindOf } from "./documentImportScan.js";

const roots: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-import-scan-"));
  roots.push(dir);
  return dir;
}
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("261108 文档导入：文件识别与解码", () => {
  it("扩展名 → kind", () => {
    expect(importKindOf("a.md")).toBe("markdown");
    expect(importKindOf("A.MARKDOWN")).toBe("markdown");
    expect(importKindOf("a.docx")).toBe("docx");
    expect(importKindOf("a.xlsx")).toBe("xlsx");
    expect(importKindOf("a.csv")).toBe("csv");
    expect(importKindOf("a.txt")).toBe("other");
  });

  it("UTF-8 优先；非法 UTF-8 按 GBK 兜底（中文 CSV）", () => {
    expect(decodeImportText(Buffer.from("姓名,城市", "utf8"))).toEqual({ text: "姓名,城市", encoding: "utf-8" });
    const gbk = Buffer.from([0xd0, 0xd5, 0xc3, 0xfb]); // 姓名（GBK）
    expect(decodeImportText(gbk)).toEqual({ text: "姓名", encoding: "gbk" });
  });

  it("CSV → 单表工作簿；不支持/缺失文件逐条给原因", async () => {
    const root = tempRoot();
    const csv = path.join(root, "people.csv");
    fs.writeFileSync(csv, "姓名,城市\n张三,杭州\n", "utf8");
    const entry = await describeImportFile(csv);
    expect(entry).toMatchObject({ kind: "csv", supported: true });
    expect(entry.workbook?.sheetOrder).toEqual(["s1"]);
    const sheet = entry.workbook?.sheets as Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }>;
    expect(sheet.s1?.cellData?.["1"]?.["0"]?.v).toBe("张三");

    const other = path.join(root, "a.txt");
    fs.writeFileSync(other, "x");
    expect(await describeImportFile(other)).toMatchObject({ kind: "other", supported: false });
    expect((await describeImportFile(path.join(root, "missing.csv"))).error).toContain("无法读取文件");
  });
});