import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Store } from "./store.js";
import { renderPdfToBuffer } from "./pdfRenderer.js";

/** 默认导出根目录（与 NoteExport 同一口径：桌面 lakex-local-notes-导出）。 */
function defaultExportBase(): string {
  return path.join(os.homedir(), "Desktop", "lakex-local-notes-导出");
}

/** 唯一导出文件路径（{base}/{title}.{ext}，重名 -2/-3 后缀）。 */
function uniqueExportPath(base: string, title: string, ext: string): string {
  let target = path.join(base, `${title}.${ext}`);
  let suffix = 2;
  while (fs.existsSync(target)) {
    target = path.join(base, `${title}-${suffix}.${ext}`);
    suffix += 1;
  }
  return target;
}

export interface InkImageExportResult {
  exportPath: string;
  format: "svg" | "png";
  size: number;
  imageCount: number;
  skipped: number;
}

/** 单页手写板 → SVG 文件（自包含：底纹 + 页图 data URI + 矢量笔迹）。 */
export async function exportInkPageSvg(store: Store, id: string, pageIds: string[], baseDir?: string): Promise<InkImageExportResult> {
  const page = await store.readInkPageSvg(id, pageIds);
  const base = baseDir ?? defaultExportBase();
  fs.mkdirSync(base, { recursive: true });
  const exportPath = uniqueExportPath(base, page.title, "svg");
  fs.writeFileSync(exportPath, page.svg, "utf8");
  return { exportPath, format: "svg", size: fs.statSync(exportPath).size, imageCount: page.imageCount, skipped: page.skipped };
}

/** 单页手写板 → PNG 字节落盘（渲染层先用 read_ink_page_svg 的 SVG 栅格化）。 */
export function saveInkPagePng(baseDir: string | undefined, title: string, bytes: Uint8Array): InkImageExportResult {
  const base = baseDir ?? defaultExportBase();
  fs.mkdirSync(base, { recursive: true });
  const exportPath = uniqueExportPath(base, title, "png");
  fs.writeFileSync(exportPath, Buffer.from(bytes));
  return { exportPath, format: "png", size: fs.statSync(exportPath).size, imageCount: 0, skipped: 0 };
}
export interface BitableCsvExportResult {
  exportPath: string;
  rowCount: number;
  size: number;
}

/** D01：多维表活动数据表 → CSV（Excel 通用；只读/锁定也允许）。 */
export function exportBitableCsv(store: Store, id: string, baseDir?: string): BitableCsvExportResult {
  return store.exportBitableCsv(id, baseDir);
}

export interface BitableZipExportResult {
  exportPath: string;
  rowCount: number;
  fileCount: number;
  skipped: number;
  size: number;
}

/** D01 续：多维表活动数据表 → ZIP（CSV + 附件/图片文件）。 */
export function exportBitableZip(store: Store, id: string, baseDir?: string): BitableZipExportResult {
  return store.exportBitableZip(id, baseDir);
}

/**
 * 收口导出：右键「导出」子菜单的所有格式统一走这一个入口。
 * 当前支持 markdown / html / pdf；word 已注册、待实现。多维表 CSV 走 exportBitableCsv。
 */
export type ExportFormat = "markdown" | "html" | "docx" | "pdf";

export interface ExportResult {
  format: ExportFormat;
  /** 导出目录（markdown 资料包）或导出文件（html/lake/pdf） */
  exportPath: string;
  imageCount: number;
  skipped: number;
  size: number;
}

/** 已注册但尚未实现的格式（当前为空：markdown / html / pdf / docx 均已实现） */
const NOT_IMPLEMENTED = new Set<ExportFormat>();

export async function exportNote(
  store: Store,
  id: string,
  format: ExportFormat,
  baseDir?: string,
  options: { pageIds?: string[] } = {},
): Promise<ExportResult> {
  if (NOT_IMPLEMENTED.has(format)) {
    throw new Error(`导出为 ${format.toUpperCase()} 暂未实现，敬请期待`);
  }
  switch (format) {
    case "markdown": {
      const r = store.exportNotePackage(id, baseDir);
      return { format, exportPath: r.exportDir, imageCount: r.imageCount, skipped: r.skipped, size: r.size };
    }
    case "html": {
      const r = store.exportHtmlNote(id, baseDir);
      return { format, exportPath: r.exportPath, imageCount: r.imageCount, skipped: r.skipped, size: r.size };
    }
    case "docx": {
      const r = await store.exportDocxNote(id, baseDir);
      return { format, exportPath: r.exportPath, imageCount: r.imageCount, skipped: r.skipped, size: r.size };
    }
    case "pdf": {
      // 内容准备（HTML 临时文件，可测）与渲染（隐藏窗口 printToPDF，主进程）分层；
      // 内容准备按 kind 分流（NoteExport.exportPdfHtml）：doc = Markdown→HTML（图片 data URI）；
      // ink = 逐页压平（每页背景图 data URI + 矢量笔迹 SVG）；markdown/html/docx 对 ink 仍抛错。
      // 临时目录用完即删，PDF 单文件交付。
      const prep = await store.exportPdfHtml(id, baseDir, options);
      try {
        const buffer = await renderPdfToBuffer(prep.htmlPath);
        fs.writeFileSync(prep.pdfPath, buffer);
        return { format, exportPath: prep.pdfPath, imageCount: prep.imageCount, skipped: prep.skipped, size: buffer.byteLength };
      } finally {
        fs.rmSync(prep.tempDir, { recursive: true, force: true });
      }
    }
    default:
      throw new Error(`未知导出格式: ${String(format)}`);
  }
}
