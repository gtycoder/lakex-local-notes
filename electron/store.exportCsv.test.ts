import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { usheetToBody, type UsheetWorkbook } from "../src/core/usheetDoc.js";

// ===== electron mock（Store 模块加载即需要） =====
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
    encryptString: (value: string) => {
      const id = crypto.randomUUID();
      secrets.set(id, value);
      return Buffer.from(id);
    },
    decryptString: (buf: Buffer) => secrets.get(buf.toString()) ?? "",
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => electronMock.encryptString(value),
    decryptString: (buf: Buffer) => electronMock.decryptString(buf),
  },
  net: { fetch: vi.fn() },
}));

function sheet(id: string, name: string, cellData: Record<string, Record<string, { v?: unknown; m?: unknown; f?: string }>>) {
  return { id, name, rowCount: 50, columnCount: 16, cellData };
}

function twoSheetWorkbook(): UsheetWorkbook {
  return {
    id: "wb",
    name: "预算表",
    sheetOrder: ["s1", "s2"],
    sheets: {
      s1: sheet("s1", "汇总", { "0": { "0": { v: "合计", m: "合计" } }, "1": { "0": { v: 42, m: "42" } } }),
      s2: sheet("s2", "明细", { "0": { "0": { v: "项目" } }, "1": { "0": { v: "差旅", m: "差旅" } } }),
    },
  };
}

let dir: string;
let store: Store;
let outDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-csv-test-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-csv-out-"));
});

describe("表格类 CSV 导出（exportTableCsv 分派）", () => {
  it("usheet：用传入的活动 sheetId，文件名带工作表名，BOM + CRLF", () => {
    const note = store.createUsheetIn(null, "预算表");
    store.saveNote(note.id, note.title, usheetToBody(twoSheetWorkbook()));

    const result = store.exportTableCsv(note.id, outDir, "s2");
    expect(result.sheetName).toBe("明细");
    expect(result.rowCount).toBe(2);
    expect(path.basename(result.exportPath)).toBe("预算表 - 明细.csv");
    const text = fs.readFileSync(result.exportPath, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("项目\r\n差旅\r\n");
    expect(text).not.toContain("合计");
  });

  it("usheet：没有活动工作表时回退 sheetOrder 第一张（提示里能看出导的是哪张）", () => {
    const note = store.createUsheetIn(null, "预算表");
    store.saveNote(note.id, note.title, usheetToBody(twoSheetWorkbook()));
    const result = store.exportTableCsv(note.id, outDir);
    expect(result.sheetName).toBe("汇总");
    expect(fs.readFileSync(result.exportPath, "utf8")).toContain("合计");
  });

  it("usheet：空工作表明确报错，不产出空文件", () => {
    const note = store.createUsheetIn(null, "空表");
    expect(() => store.exportTableCsv(note.id, outDir)).toThrow(/为空/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("bitable：同一个入口走多维表活动数据表，结果不带 sheetName", () => {
    const note = store.createBitableIn(null, "客户表");
    const result = store.exportTableCsv(note.id, outDir);
    expect(result.sheetName).toBeUndefined();
    expect(fs.existsSync(result.exportPath)).toBe(true);
    expect(result.exportPath.endsWith(".csv")).toBe(true);
  });

  it("usheet：导出 Excel 多工作表（合法 ZIP 头 + 工作表数）", async () => {
    const note = store.createUsheetIn(null, "预算表");
    store.saveNote(note.id, note.title, usheetToBody(twoSheetWorkbook()));
    const result = await store.exportUsheetXlsx(note.id, outDir);
    expect(result.sheetCount).toBe(2);
    expect(result.exportPath.endsWith(".xlsx")).toBe(true);
    const bytes = fs.readFileSync(result.exportPath);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304"); // ZIP local header
  });

  it("usheet：空表导 Excel 明确报错，不产出空工作簿", async () => {
    const note = store.createUsheetIn(null, "空表");
    await expect(store.exportUsheetXlsx(note.id, outDir)).rejects.toThrow(/为空/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("普通文档 → 明确拒绝（不会写出奇怪的文件）", () => {
    const note = store.createNote("普通文档");
    expect(() => store.exportTableCsv(note.id, outDir)).toThrow(/不是表格或多维表/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});
