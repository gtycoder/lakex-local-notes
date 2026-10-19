import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

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

function unzipStored(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    out.set(name, bytes.slice(start, start + size));
    offset = start + size;
  }
  return out;
}

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
let store: Store;
let outDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-docx-test-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-docx-out-"));
});

describe("Word（docx）导出", () => {
  it("doc：读 Markdown 缓存生成 .docx（标题 / 粗体 / 合法 ZIP）", async () => {
    const note = store.createNote("Word 导出");
    store.saveNote(note.id, note.title, "<p>x</p>", { markdown: "# 标题\n\n正文 **粗体**", plain: "" });
    const result = await store.exportDocxNote(note.id, outDir);
    expect(result.exportPath.endsWith(".docx")).toBe(true);
    expect(result.imageCount).toBe(0);
    const bytes = fs.readFileSync(result.exportPath);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    const files = unzipStored(new Uint8Array(bytes));
    const document = new TextDecoder().decode(files.get("word/document.xml"));
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain("<w:b/>");
  });

  it("图片：本地资产内嵌（含尺寸）；缺失图片计入 skipped 不阻断", async () => {
    const note = store.createNote("带图 Word");
    const assetsDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "a.png"), png1x1);
    const assetUrl = "http://127.0.0.1:19876/" + note.id + "/a.png";
    store.saveNote(note.id, note.title, "<p>x</p>", {
      markdown: "![图](" + assetUrl + ")\n\n![缺失](http://127.0.0.1:19876/" + note.id + "/missing.png)",
      plain: "",
    });
    const result = await store.exportDocxNote(note.id, outDir);
    expect(result.imageCount).toBe(1);
    expect(result.skipped).toBe(1);
    const files = unzipStored(new Uint8Array(fs.readFileSync(result.exportPath)));
    expect(files.has("word/media/image1.png")).toBe(true);
    expect(new TextDecoder().decode(files.get("word/document.xml"))).toContain("rIdImg1");
  });

  it("没有文本缓存 / 非 doc 类型 ⇒ 明确报错", async () => {
    const note = store.createNote("没保存过");
    await expect(store.exportDocxNote(note.id, outDir)).rejects.toThrow(/文本缓存/);
    const sheet = store.createUsheetIn(null, "表格");
    await expect(store.exportDocxNote(sheet.id, outDir)).rejects.toThrow(/暂不支持导出/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});
