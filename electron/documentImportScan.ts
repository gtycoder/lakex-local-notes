/**
 * Word / Excel / CSV / Markdown 导入：主进程侧**文件发现、解码与格式解析**。
 *
 * - Markdown / CSV：读文本；CSV 立即转成 usheet 工作簿。
 * - Word(.docx)：mammoth → HTML（图片转 data URL，由渲染层物化为文档资产后再交给内核）。
 * - Excel(.xlsx)：read-excel-file → 所有工作表的值 → usheet 工作簿（不导入样式/公式/图表）。
 *
 * 只做“描述 + 解析”，不建笔记/不落盘；建笔记和类型落盘在 renderer 的导入管线。
 * 不支持的文件也返回（supported:false），用户全选时不能静默消失。
 */
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { workbookFromCsv, workbookFromSheets, type ImportedSheet } from "../src/core/sheetImport.js";
import type { ImportPickedFileShape } from "../src/lib/types.js";

export const MAX_DOCUMENT_IMPORT_BYTES = 20 * 1024 * 1024;
export const IMPORT_EXTENSIONS = [".md", ".markdown", ".docx", ".xlsx", ".csv"] as const;

export type ImportFileKind = "markdown" | "docx" | "xlsx" | "csv" | "other";

export type ImportPickedFile = ImportPickedFileShape;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function importKindOf(name: string): ImportFileKind {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".csv") return "csv";
  return "other";
}

/** UTF-8 优先；失败按 GBK（Windows Excel 导出的中文 CSV 常见）兜底。 */
export function decodeImportText(buffer: Buffer): { text: string; encoding: "utf-8" | "gbk" } {
  const withoutBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(withoutBom), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("gbk").decode(withoutBom), encoding: "gbk" };
  }
}

async function describeDocx(absPath: string): Promise<Pick<ImportPickedFile, "html" | "warnings">> {
  const result = await mammoth.convertToHtml({ path: absPath }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const data = await image.read("base64");
      return { src: "data:" + image.contentType + ";base64," + data };
    }),
  });
  const warnings = result.messages
    .map((message) => message.message)
    .filter((message) => Boolean(message))
    .slice(0, 20);
  return { html: result.value, ...(warnings.length > 0 ? { warnings } : {}) };
}

async function describeXlsx(absPath: string): Promise<Pick<ImportPickedFile, "workbook" | "warnings">> {
  const sheets = await readXlsxFile(absPath);
  const data: ImportedSheet[] = sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data as unknown[][],
  }));
  const result = workbookFromSheets(data, path.basename(absPath, path.extname(absPath)));
  return {
    workbook: result.workbook,
    warnings: [
      "Excel 只导入单元格值；公式、样式、图表、图片、透视/条件格式未导入",
      ...result.warnings,
    ],
  };
}

/**
 * 描述并预解析一个文件。所有异常只写进该文件条目的 error，不抛出整批。
 * @param absPath 绝对路径
 */
export async function describeImportFile(absPath: string): Promise<ImportPickedFile> {
  const name = path.basename(absPath);
  const kind = importKindOf(name);
  const entry: ImportPickedFile = {
    path: absPath,
    name,
    relativePath: name,
    size: 0,
    kind,
    supported: kind !== "other",
  };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch (error) {
    entry.error = "无法读取文件：" + errorMessage(error);
    return entry;
  }
  if (!stat.isFile()) {
    entry.error = "不是普通文件";
    return entry;
  }
  entry.size = stat.size;
  if (kind === "other") return entry;
  if (stat.size > MAX_DOCUMENT_IMPORT_BYTES) {
    entry.tooLarge = true;
    return entry;
  }
  const title = path.basename(name, path.extname(name));
  try {
    if (kind === "markdown") {
      entry.markdown = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
      return entry;
    }
    if (kind === "csv") {
      const decoded = decodeImportText(fs.readFileSync(absPath));
      const result = workbookFromCsv(decoded.text, title);
      entry.workbook = result.workbook;
      entry.warnings = ["CSV 无类型信息，全部按文本导入", ...(decoded.encoding === "gbk" ? ["按 GBK 编码读取"] : []), ...result.warnings];
      return entry;
    }
    if (kind === "docx") {
      Object.assign(entry, await describeDocx(absPath));
      return entry;
    }
    Object.assign(entry, await describeXlsx(absPath));
    return entry;
  } catch (error) {
    entry.error = "解析失败：" + errorMessage(error);
    return entry;
  }
}