import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import sharp from "sharp";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { usheetToBody, type UsheetWorkbook } from "../src/core/usheetDoc.js";

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

/** 极简 ZIP 读取：走中央目录（可靠处理 data descriptor），支持 store(0) / deflate(8)。 */
function unzip(bytes: Uint8Array): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = Buffer.from(bytes.slice(start, start + compressedSize));
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function text(files: Map<string, Buffer>, name: string): string {
  const bytes = files.get(name);
  if (!bytes) throw new Error("missing entry " + name);
  return bytes.toString("utf8");
}

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
let store: Store;
let outDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-xlsx-test-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-xlsx-out-"));
});

describe("usheet → Excel（write-excel-file）", () => {
  it("值/数字格式/样式/列宽/合并/冻结/公式 → 真实 xlsx 结构", async () => {
    const note = store.createUsheetIn(null, "预算表");
    const wb: UsheetWorkbook = {
      id: "wb",
      sheetOrder: ["s1"],
      styles: {
        bold: {
          bl: 1,
          fs: 14,
          bg: { rgb: "#eef2fa" },
          bd: {
            t: { s: 1, cl: { rgb: "#333333" } },
            b: { s: 1, cl: { rgb: "#333333" } },
            l: { s: 8, cl: { rgb: "#ff0000" } },
            r: { s: 1, cl: { rgb: "#333333" } },
          },
        },
        pct: { n: { pattern: "0.00%" } },
      },
      sheets: {
        s1: {
          id: "s1",
          name: "汇总",
          rowCount: 50,
          columnCount: 16,
          defaultColumnWidth: 88,
          cellData: {
            "0": { "0": { v: "姓名", s: "bold" } },
            "1": { "0": { v: "小明" }, "1": { v: 0.95, s: "pct" }, "2": { f: "=B2*2" } },
          },
          mergeData: [{ startRow: 2, startColumn: 0, endRow: 3, endColumn: 1 }],
          freeze: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 },
          rowData: { "0": { h: 36 } },
          columnData: { "0": { w: 120 } },
          showGridlines: 0,
        },
      },
    };
    store.saveNote(note.id, note.title, usheetToBody(wb));
    const result = await store.exportUsheetXlsx(note.id, outDir);
    expect(result.sheetCount).toBe(1);
    expect(result.imageCount).toBe(0);
    const files = unzip(new Uint8Array(fs.readFileSync(result.exportPath)));
    const sheet = text(files, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("<f>B2*2</f>");
    expect(sheet).toContain("<mergeCell ref=\"A3:B4\"/>");
    expect(sheet).toContain('<pane ySplit="1" xSplit="1"');
    expect(sheet).toContain('<col min="1" max="1" width="16.43"');
    expect(sheet).toContain('showGridLines="false"');
    const styles = text(files, "xl/styles.xml");
    expect(styles).toContain("0.00%");
    expect(styles).toContain("<b/>");
    expect(styles).toContain('applyBorder="1"');
    expect(styles).toContain('<left style="medium"');
    expect(styles).toContain('<right style="thin"');
  });

  it("图片：单元格内图 + 浮动图（含 webp→png）；缺失图片计入 skipped", async () => {
    const note = store.createUsheetIn(null, "带图表");
    const assetsDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "1700000000000_aaaaaaaa.png"), png1x1);
    const webp = await sharp(png1x1).webp().toBuffer();
    fs.writeFileSync(path.join(assetsDir, "1700000000001_bbbbbbbb.webp"), webp);
    const webpDataUrl = "data:image/webp;base64," + webp.toString("base64");

    const wb: UsheetWorkbook = {
      id: "wb",
      sheetOrder: ["s1"],
      sheets: {
        s1: {
          id: "s1",
          name: "图表",
          rowCount: 50,
          columnCount: 16,
          cellData: {
            "0": { "0": { v: "标题" } },
            "2": {
              "0": {
                p: {
                  body: { dataStream: "图表说明\r" },
                  drawings: {
                    c1: { drawingId: "c1", drawingType: 0, source: "1700000000001_bbbbbbbb.webp", docTransform: { size: { width: 20, height: 20 } } },
                  },
                },
              },
            },
            "3": {
              "0": {
                p: {
                  body: { dataStream: "缺失图\r" },
                  drawings: {
                    c2: { drawingId: "c2", drawingType: 0, source: "1700000000099_missing.png", docTransform: { size: { width: 20, height: 20 } } },
                  },
                },
              },
            },
            "4": {
              "0": {
                p: {
                  body: { dataStream: "内联 webp\r" },
                  drawings: {
                    c3: { drawingId: "c3", drawingType: 0, source: webpDataUrl, docTransform: { size: { width: 12, height: 12 } } },
                  },
                },
              },
            },
          },
        },
      },
      resources: [
        {
          name: "SHEET_DRAWING_PLUGIN",
          data: JSON.stringify({
            s1: {
              f1: {
                drawingId: "f1",
                drawingType: 0,
                source: "1700000000000_aaaaaaaa.png",
                transform: { width: 40, height: 30 },
                sheetTransform: { from: { row: 1, column: 2, rowOffset: 2, columnOffset: 3 } },
              },
            },
          }),
        },
      ],
    };
    store.saveNote(note.id, note.title, usheetToBody(wb));
    const result = await store.exportUsheetXlsx(note.id, outDir);
    expect(result.imageCount).toBe(3); // 单元格 webp + 浮动 png + 内联 data URL webp（均转 png）
    expect(result.skipped).toBe(1);
    const files = unzip(new Uint8Array(fs.readFileSync(result.exportPath)));
    const media = [...files.keys()].filter((name) => name.startsWith("xl/media/"));
    expect(media.length).toBe(3);
    expect(media.every((name) => name.endsWith(".png"))).toBe(true);
    const drawing = text(files, "xl/drawings/drawing1.xml");
    expect(drawing.match(/<xdr:oneCellAnchor>/g)?.length).toBe(3);
    expect(drawing).toContain('<xdr:col>2</xdr:col>');
    expect(text(files, "xl/sharedStrings.xml")).toContain("图表说明"); // 富文本单元格文字走 sharedStrings，不丢
  });
});
