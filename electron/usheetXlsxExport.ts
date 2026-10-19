/**
 * 表格（usheet）→ 真正的 .xlsx（write-excel-file + 图片）。
 *
 * 分工：
 * - src/core/usheetExcel.ts 负责 Univer 快照 → 值/样式/几何/图片引用（纯函数、可测）；
 * - 本文件负责把引用解析成本地资产字节（webp 等转 png）、把模型映射成 write-excel-file 的 Sheet，
 *   然后一次生成 Buffer。依赖只进主进程，core 保持零依赖。
 *
 * 已知边界（用户 261019 确认接受）：
 * - 图片用 oneCellAnchor：位置/尺寸按导出时快照固定，不随 Excel 列宽缩放；
 * - 隐藏工作表 / 隐藏行列没有库 API，统一导出为可见；hidden 状态丢失；
 * - 公式只写 <f>（无缓存值），Excel/WPS 打开时重算。
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import writeXlsxFile from "write-excel-file/node";
import type { CellObject, Sheet, SheetData } from "write-excel-file/node";
import { isSafePathSegment } from "../src/core/storeUtils.js";
import { parseLocalAssetUrl } from "../src/core/assetUrl.js";
import { buildUsheetExcelModel, type UsheetExcelCell, type UsheetExcelSheet } from "../src/core/usheetExcel.js";
import type { UsheetWorkbook } from "../src/core/usheetDoc.js";

export interface UsheetXlsxResult {
  bytes: Uint8Array;
  sheetCount: number;
  rowCount: number;
  imageCount: number;
  skipped: number;
  /** 有内容的单元格数（空表判定） */
  cellCount: number;
}

interface ResolvedImage {
  content: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/** 与 write-excel-file 的 ImageType<Buffer> 结构一致（该类型未从包入口导出）。 */
interface LibImage {
  content: Buffer;
  contentType: string;
  width: number;
  height: number;
  dpi: number;
  anchor: { row: number; column: number };
  offsetX?: number;
  offsetY?: number;
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function decodeDataUrl(source: string): { bytes: Buffer; contentType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(source);
  if (!match || !match[2]) return null; // 只支持 base64 data URL（编辑器产出的都是这种）
  const contentType = match[1] || "application/octet-stream";
  if (!contentType.startsWith("image/")) return null;
  try {
    return { bytes: Buffer.from(match[3], "base64"), contentType };
  } catch {
    return null;
  }
}

/** 正文引用 → 本地资产文件（filename / 本地资产 URL）；外链一律不下载（导出不联网）。 */
function resolveAssetFile(source: string, noteId: string, assetsDir: string): { bytes: Buffer; ext: string } | null {
  let filename: string | null = null;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const ref = parseLocalAssetUrl(source);
    if (!ref || ref.space !== "note" || ref.staging) return null;
    filename = ref.filename;
  } else if (!source.startsWith("data:") && !source.startsWith("blob:")) {
    filename = source;
  }
  if (!filename || !isSafePathSegment(filename)) return null;
  const file = path.join(assetsDir, noteId, filename);
  try {
    if (!fs.existsSync(file)) return null;
    return { bytes: fs.readFileSync(file), ext: path.extname(filename).slice(1).toLowerCase() };
  } catch {
    return null;
  }
}

async function resolveImage(source: string, noteId: string, assetsDir: string): Promise<ResolvedImage | null> {
  let bytes: Buffer;
  let contentType: string;
  if (source.startsWith("data:")) {
    const decoded = decodeDataUrl(source);
    if (!decoded) return null;
    bytes = decoded.bytes;
    contentType = decoded.contentType;
  } else {
    const file = resolveAssetFile(source, noteId, assetsDir);
    if (!file) return null;
    bytes = file.bytes;
    contentType = EXT_CONTENT_TYPE[file.ext] ?? "";
  }
  // webp / bmp / svg / tiff / avif 等 Excel 不稳的格式（含内联 data URL）：统一转 png。
  if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/gif") {
    try {
      bytes = await sharp(bytes).png().toBuffer();
      contentType = "image/png";
    } catch {
      return null;
    }
  }
  return { content: bytes, contentType, width: 0, height: 0 };
}

function toLibCell(cell: UsheetExcelCell): CellObject {
  const out: CellObject = {};
  if (cell.formula) {
    out.type = "Formula";
    out.value = cell.formula; // 库里直接写进 <f>；不能带前导 =（否则产出 <f>=...</f>）
  } else if (cell.value !== undefined) {
    out.value = cell.value;
  }
  if (cell.format) out.format = cell.format;
  if (cell.columnSpan) out.columnSpan = cell.columnSpan;
  if (cell.rowSpan) out.rowSpan = cell.rowSpan;
  const style = cell.style;
  if (style) {
    if (style.bold) out.fontWeight = "bold";
    if (style.italic) out.fontStyle = "italic";
    if (style.underline) out.textDecoration = { underline: true };
    else if (style.strike) out.textDecoration = { strikethrough: true };
    if (style.fontSize) out.fontSize = style.fontSize;
    if (style.textColor) out.textColor = style.textColor;
    if (style.backgroundColor) out.backgroundColor = style.backgroundColor;
    if (style.align) out.align = style.align;
    if (style.verticalAlign) out.alignVertical = style.verticalAlign;
    if (style.wrap) out.wrap = true;
    if (style.height) out.height = style.height;
  }
  return out;
}

function toLibSheet(sheet: UsheetExcelSheet, images: LibImage[]): Sheet<Buffer> {
  const data: SheetData = sheet.rows.map((row) => row.map((cell) => (cell ? toLibCell(cell) : null)));
  return {
    data,
    sheet: sheet.name,
    columns: sheet.columns,
    stickyRowsCount: sheet.stickyRowsCount,
    stickyColumnsCount: sheet.stickyColumnsCount,
    showGridLines: sheet.showGridLines,
    ...(images.length > 0 ? { images } : {}),
  };
}

/** 工作簿 → xlsx 字节。图片缺失 / 外链 / 不支持格式计入 skipped，不阻断整篇导出。 */
export async function buildUsheetXlsx(workbook: UsheetWorkbook, opts: { noteId: string; assetsDir: string }): Promise<UsheetXlsxResult> {
  const model = buildUsheetExcelModel(workbook);
  let imageCount = 0;
  let skipped = 0;
  const sheets: Array<Sheet<Buffer>> = [];
  for (const sheet of model.sheets) {
    const images: LibImage[] = [];
    for (const ref of sheet.images) {
      const resolved = await resolveImage(ref.source, opts.noteId, opts.assetsDir);
      if (!resolved) {
        skipped += 1;
        continue;
      }
      let width = Math.round(ref.width);
      let height = Math.round(ref.height);
      if (!(width > 0) || !(height > 0)) {
        try {
          const meta = await sharp(resolved.content).metadata();
          width = meta.width ?? 0;
          height = meta.height ?? 0;
        } catch {
          /* 尺寸读不出就跳过这一张 */
        }
      }
      if (!(width > 0) || !(height > 0)) {
        skipped += 1;
        continue;
      }
      images.push({
        content: resolved.content,
        contentType: resolved.contentType,
        width,
        height,
        dpi: 96,
        anchor: { row: ref.row + 1, column: ref.column + 1 },
        offsetX: Math.round(ref.offsetX),
        offsetY: Math.round(ref.offsetY),
      });
      imageCount += 1;
    }
    sheets.push(toLibSheet(sheet, images));
  }
  const buffer = await writeXlsxFile(sheets).toBuffer();
  return {
    bytes: new Uint8Array(buffer),
    sheetCount: sheets.length,
    rowCount: model.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    imageCount,
    skipped,
    cellCount: model.cellCount,
  };
}
