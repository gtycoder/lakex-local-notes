import type { Store } from "./store.js";

/**
 * 收口导出：右键「导出」子菜单的所有格式统一走这一个入口。
 * 当前支持 markdown / html / lake；word / pdf 已注册、待实现。
 */
export type ExportFormat = "markdown" | "html" | "lake" | "docx" | "pdf";

export interface ExportResult {
  format: ExportFormat;
  /** 导出目录（markdown 资料包）或导出文件（html/lake） */
  exportPath: string;
  imageCount: number;
  skipped: number;
  size: number;
}

/** 已注册但尚未实现的格式 */
const NOT_IMPLEMENTED = new Set<ExportFormat>(["docx", "pdf"]);

export function exportNote(store: Store, id: string, format: ExportFormat, baseDir?: string): ExportResult {
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
    case "lake": {
      const r = store.exportNativeLake(id, baseDir);
      return { format, exportPath: r.exportPath, imageCount: r.imageCount, skipped: r.skipped, size: r.size };
    }
    default:
      throw new Error(`未知导出格式: ${String(format)}`);
  }
}
