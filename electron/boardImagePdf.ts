/**
 * 261106 task-95：画板图像字节 → PDF（主进程）。
 *
 * 为什么需要它：画板渲染在渲染层（Drawnix 画布），主进程拿不到画板实例；
 * 渲染层把整幅 PNG/SVG 字节交回来之后，主进程只做**内嵌成 PDF** 这一件事。
 *
 * 实现 = 复用现有 PDF 渲染链路（electron/pdfRenderer 的隐藏窗口 printToPDF），**零新依赖**：
 *   图片 → 自包含临时 HTML（data URI 内嵌 + @page A4 单页铺满）→ printToPDF → 目标 <标题>.pdf。
 * 排版策略（明确定义，不做智能裁切）：**单页 A4 等比缩放铺满**（留 0 边距、白底、图片宽度不超页面），
 * 画板越大越清晰度受限，但不裁切、不丢内容；多画板各自一页（不同文档本来就是不同 PDF）。
 *
 * 安全：字节上限 50MB + 魔数/结构校验（png 与 svg 各认一种），写盘走 tmp→rename 原子写。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPdfToBuffer } from "./pdfRenderer.js";

/** 单张画板图像上限（与批量导出 IPC 的白名单一致）。 */
export const MAX_BOARD_IMAGE_BYTES = 50 * 1024 * 1024;

export type BoardImageFormat = "png" | "svg";

/** 按字节内容认格式（扩展名不可信）：PNG 魔数 / SVG 结构。 */
export function sniffBoardImageFormat(bytes: Uint8Array): BoardImageFormat | null {
  if (!bytes || bytes.byteLength < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  // SVG：去 BOM/空白后以 <svg 或 <?xml 开头；只看前 512 字节，避免大文件全量转字符串。
  const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return null;
}

export interface BoardImagePdfDeps {
  /** 测试注入：PDF 渲染（默认 = 隐藏窗口 printToPDF）。 */
  renderPdf?: (htmlPath: string) => Promise<Buffer>;
}

/** 把一张画板图片渲成单页 A4 PDF 字节（不写目标文件；落盘由调用方决定路径）。 */
export async function boardImageToPdfBuffer(bytes: Uint8Array, deps: BoardImagePdfDeps = {}): Promise<Buffer> {
  if (!bytes || bytes.byteLength === 0) throw new Error("画板图像字节为空");
  if (bytes.byteLength > MAX_BOARD_IMAGE_BYTES) {
    throw new Error("画板图像超过 " + Math.round(MAX_BOARD_IMAGE_BYTES / 1024 / 1024) + "MB 上限");
  }
  const format = sniffBoardImageFormat(bytes);
  if (!format) throw new Error("画板图像不是有效 PNG/SVG（内容校验失败）");
  const mime = format === "png" ? "image/png" : "image/svg+xml";
  const dataUri = "data:" + mime + ";base64," + Buffer.from(bytes).toString("base64");
  // 单页铺满：A4 + 0 边距；图片按等比缩放到页面内（不裁切）。SVG 用 width:100% 让浏览器自己缩放。
  const html = [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><style>',
    "  @page { size: A4 portrait; margin: 0; }",
    "  html, body { margin: 0; padding: 0; background: #fff; }",
    "  .sheet { width: 210mm; height: 297mm; display: flex; align-items: center; justify-content: center; overflow: hidden; }",
    "  .sheet img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }",
    "</style></head><body>",
    '<div class="sheet"><img src="' + dataUri + '" alt="board"></div>',
    "</body></html>",
  ].join("\n");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-board-pdf-"));
  const htmlPath = path.join(tempDir, "index.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  try {
    const render = deps.renderPdf ?? renderPdfToBuffer;
    const pdf = await render(htmlPath);
    if (!pdf || pdf.byteLength === 0) throw new Error("PDF 渲染结果为空");
    return pdf;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结果 */ }
  }
}

/** 原子写：同目录 tmp → rename（中断不会在目标路径留下半成品）。 */
export function writeFileAtomicSync(targetPath: string, data: Uint8Array): void {
  const tmp = targetPath + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}
