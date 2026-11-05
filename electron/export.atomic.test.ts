import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const renderPdfMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("./pdfRenderer.js", () => ({ renderPdfToBuffer: renderPdfMock.fn }));

import { exportInkPageSvg, exportNote, saveInkPagePng } from "./export.js";
import type { Store } from "./store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-atomic-"));
  renderPdfMock.fn.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 目录里不能有 tmp 残留（原子写的临时文件必须被 rename 或清理掉）。 */
function tmpLeftovers(): string[] {
  return fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));
}

const fakeInkStore = (svg = "<svg/>", title = "页面导出") =>
  ({ readInkPageSvg: async () => ({ title, svg, imageCount: 2, skipped: 1 }) }) as unknown as Store;

describe("导出原子写（261105 Batch3-C）", () => {
  it("SVG：落到目标文件且不留 tmp 残留", async () => {
    const result = await exportInkPageSvg(fakeInkStore(), "note-1", ["p1"], dir);
    expect(fs.readFileSync(result.exportPath, "utf8")).toBe("<svg/>");
    expect(result.size).toBe(fs.statSync(result.exportPath).size);
    expect(tmpLeftovers()).toEqual([]);
  });

  it("PNG：落到目标文件且不留 tmp 残留", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = saveInkPagePng(dir, "图片导出", bytes);
    expect([...fs.readFileSync(result.exportPath)]).toEqual([1, 2, 3, 4]);
    expect(tmpLeftovers()).toEqual([]);
  });

  it("重名自动 -2 后缀，且两条导出都是完整文件", async () => {
    const first = await exportInkPageSvg(fakeInkStore("<svg id='1'/>", "同名"), "n", ["p"], dir);
    const second = await exportInkPageSvg(fakeInkStore("<svg id='2'/>", "同名"), "n", ["p"], dir);
    expect(first.exportPath.endsWith("同名.svg")).toBe(true);
    expect(second.exportPath.endsWith("同名-2.svg")).toBe(true);
    expect(fs.readFileSync(second.exportPath, "utf8")).toBe("<svg id='2'/>");
    expect(tmpLeftovers()).toEqual([]);
  });

  it("写失败（rename 抛错）不留半成品目标文件，并清理 tmp", async () => {
    const original = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).includes(".tmp-")) throw new Error("injected rename failure");
      return original(from, to);
    }) as typeof fs.renameSync);
    try {
      await expect(exportInkPageSvg(fakeInkStore(), "note-fail", ["p1"], dir)).rejects.toThrow("injected rename failure");
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(path.join(dir, "页面导出.svg"))).toBe(false);
    expect(tmpLeftovers()).toEqual([]);
  });

  it("PDF 导出走同一条原子写（tmp → rename），临时目录仍被清理", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-tmp-"));
    const htmlPath = path.join(tempDir, "prep.html");
    fs.writeFileSync(htmlPath, "<html/>", "utf8");
    const pdfPath = path.join(dir, "成品.pdf");
    const store = {
      exportPdfHtml: async () => ({ htmlPath, pdfPath, tempDir, imageCount: 0, skipped: 0 }),
    } as unknown as Store;
    renderPdfMock.fn.mockResolvedValue(Buffer.from("PDF-BYTES"));
    const result = await exportNote(store, "note-pdf", "pdf", dir);
    expect(result.exportPath).toBe(pdfPath);
    expect(fs.readFileSync(pdfPath, "utf8")).toBe("PDF-BYTES");
    expect(fs.existsSync(tempDir)).toBe(false);
    expect(tmpLeftovers()).toEqual([]);
  });
});
