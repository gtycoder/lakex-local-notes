import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_BOARD_IMAGE_BYTES,
  boardImageToPdfBuffer,
  sniffBoardImageFormat,
  writeFileAtomicSync,
} from "./boardImagePdf.js";

/**
 * 261106 task-95：画板图像字节 → PDF（主进程）。
 * 真 printToPDF 需要 Electron 隐藏窗口 ⇒ 用注入 renderPdf 断言「喂给渲染器的 HTML」长什么样；
 * 另外守格式识别（魔数/结构）、大小上限、临时目录清理、原子写。
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', "utf8");

describe("sniffBoardImageFormat：按内容认格式", () => {
  it("PNG 魔数 / SVG 结构 / 其它一律 null", () => {
    expect(sniffBoardImageFormat(new Uint8Array(PNG))).toBe("png");
    expect(sniffBoardImageFormat(new Uint8Array(SVG))).toBe("svg");
    expect(sniffBoardImageFormat(new Uint8Array(Buffer.from("<?xml version=\"1.0\"?><svg/>")))).toBe("svg");
    expect(sniffBoardImageFormat(new Uint8Array(Buffer.from("GIF89a")))).toBeNull();
    expect(sniffBoardImageFormat(new Uint8Array([0, 1]))).toBeNull();
  });
});

describe("boardImageToPdfBuffer", () => {
  const renderPdf = vi.fn(async () => Buffer.from("%PDF-1.4 stub"));

  it("喂给渲染器的 HTML：data URI 内嵌、A4 单页铺满、0 边距；渲染完清临时目录", async () => {
    renderPdf.mockClear();
    let htmlPath = "";
    let html = "";
    const pdf = await boardImageToPdfBuffer(new Uint8Array(PNG), {
      renderPdf: async (filePath) => {
        htmlPath = filePath;
        html = fs.readFileSync(filePath, "utf8");
        return renderPdf();
      },
    });
    expect(pdf.toString()).toContain("%PDF");
    expect(html).toContain("@page { size: A4 portrait; margin: 0; }");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("object-fit: contain");
    expect(html).toContain("<div class=\"sheet\">");
    expect(html).not.toContain("page-break");
    // 临时目录已清理（HTML 文件不存在）
    expect(fs.existsSync(htmlPath)).toBe(false);
  });

  it("SVG 也支持（mime = image/svg+xml）", async () => {
    let html = "";
    await boardImageToPdfBuffer(new Uint8Array(SVG), { renderPdf: async (filePath) => { html = fs.readFileSync(filePath, "utf8"); return Buffer.from("%PDF"); } });
    expect(html).toContain("data:image/svg+xml;base64,");
  });

  it("空字节 / 超 50MB / 非图片 ⇒ 可读错误（不产出 PDF）", async () => {
    await expect(boardImageToPdfBuffer(new Uint8Array(), { renderPdf })).rejects.toThrowError(/字节为空/);
    await expect(boardImageToPdfBuffer(new Uint8Array(MAX_BOARD_IMAGE_BYTES + 1), { renderPdf })).rejects.toThrowError(/上限/);
    await expect(boardImageToPdfBuffer(new Uint8Array(Buffer.from("not an image at all")), { renderPdf })).rejects.toThrowError(/有效 PNG\/SVG/);
    expect(MAX_BOARD_IMAGE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("渲染器返回空 buffer ⇒ 报错并清理临时目录", async () => {
    await expect(boardImageToPdfBuffer(new Uint8Array(PNG), { renderPdf: async () => Buffer.alloc(0) })).rejects.toThrowError(/渲染结果为空/);
    const leftovers = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("lake-board-pdf-"));
    expect(leftovers).toEqual([]);
  });
});

describe("writeFileAtomicSync", () => {
  it("同目录 tmp→rename：目标存在时覆盖，且不留 .tmp 残留", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-board-atomic-"));
    try {
      const target = path.join(dir, "a.pdf");
      writeFileAtomicSync(target, new Uint8Array(Buffer.from("v1")));
      expect(fs.readFileSync(target, "utf8")).toBe("v1");
      writeFileAtomicSync(target, new Uint8Array(Buffer.from("v2")));
      expect(fs.readFileSync(target, "utf8")).toBe("v2");
      expect(fs.readdirSync(dir)).toEqual(["a.pdf"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
