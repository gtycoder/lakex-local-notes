import fs from "node:fs";
import type { Store } from "./store.js";
import { renderPdfToBuffer } from "./pdfRenderer.js";

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

export async function exportNote(store: Store, id: string, format: ExportFormat, baseDir?: string): Promise<ExportResult> {
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
      // 临时目录用完即删，PDF 单文件交付。
      const prep = store.exportPdfHtml(id, baseDir);
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
