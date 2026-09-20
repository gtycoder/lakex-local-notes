/**
 * 表格文档（kind = "sheet"）正文格式与序列化 —— 桌面/移动端共享的单一事实源。
 *
 * 存储位置：sheets/{noteId}.sheet.json（本地）/ objects/{noteId}-{hash}.lake（S3，内容寻址）。
 * 正文是纯文本 JSON，因此天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线。
 *
 * 格式 v2（260919，FortuneSheet）：正文 = FortuneSheet 的 workbook 数据（`sheets: Sheet[]`）。
 * 为什么升 v2：v1 是 jspreadsheet CE 的 `{worksheets:[{name,data,columns}]}` 快照，换内核后结构完全不同
 * （FortuneSheet 是 sparse `celldata` + config/frozen/images/...）。按 AGENTS §3 #7：开发版数据可删可重建，
 * **不写兼容**——v1 正文 parse 返回 null → 按空表打开。
 *
 * 边界：本文件属 `src/core`（禁平台/第三方依赖），因此这里只声明「结构上兼容 FortuneSheet 的最小类型」，
 * 不 import `@fortune-sheet/core`；编辑器侧负责 `Sheet[]` 与本类型的互转（结构兼容，直接断言）。
 */
import { localAssetHttpUrl } from "./assetUrl.js";

export const SHEET_DOC_KIND = "sheet" as const;
export const SHEET_DOC_VERSION = 2 as const;

// 新建空表**不写 row/column**：交给 FortuneSheet 默认网格（60 列 × 84 行）。
// 写死小尺寸（如 8 列）会让 canvas 只按列数算宽 → 比容器窄：右侧留白、横向滚动条不在最右、
// 只显示到 H 列（260919 用户报）。FortuneSheet 会按需自动扩展。

/** FortuneSheet 单元格值（只声明搜索/校验需要读取的字段；其余样式字段透传）。 */
export interface SheetCellValue {
  /** 原始值。 */
  v?: string | number | boolean | null;
  /** 显示值（公式结果/格式化后的文本）。 */
  m?: string | number | null;
  [key: string]: unknown;
}

/** FortuneSheet `celldata` 项：sparse，只存非空格子。 */
export interface SheetCell {
  r: number;
  c: number;
  v?: SheetCellValue | null;
}

/** FortuneSheet 工作表（结构兼容；config/frozen/images/... 等未知字段原样透传）。 */
export interface SheetWorksheet {
  id?: string;
  name: string;
  celldata?: SheetCell[];
  [key: string]: unknown;
}

/**
 * 工作表里的**浮动图**（FortuneSheet `sheets[].images[]`）：几何是**像素**，相对网格内容原点（A1 左上）。
 * 实测形态（260920 真插一张 160×100 PNG 落盘）：
 * `{ id, src:"data:image/png;base64,…", left:0, top:0, width:80, height:50, originWidth:160, originHeight:100 }`。
 */
export interface SheetImageRef {
  id: string;
  /** 原始 src：当前是 base64 data URL；`SHEET-IMAGE-MANAGEMENT-260919.md` 的 P1 落地后会变成资产 filename。 */
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 读出一张工作表的浮动图（按 id 去重；几何非法或缺 src 的项跳过）。 */
export function sheetImages(sheet: SheetWorksheet | null | undefined): SheetImageRef[] {
  const raw = (sheet as { images?: unknown } | null | undefined)?.images;
  if (!Array.isArray(raw)) return [];
  const out: SheetImageRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const src = typeof value.src === "string" ? value.src.trim() : "";
    if (!src) continue;
    const left = Number(value.left);
    const top = Number(value.top);
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !(width > 0) || !(height > 0)) continue;
    const id = typeof value.id === "string" && value.id ? value.id : `${left}:${top}:${src.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, src, left, top, width, height });
  }
  return out;
}

/**
 * 图片 src → 可渲染 URL：
 * - `data:` / `http(s):` 原样返回；
 * - 其余（资产 filename —— P1 之后的形态）拼本机资产 canonical URL；
 * - 空/非法返回 null（调用方跳过）。
 *
 * 之所以现在就认三种形态：`SHEET-IMAGE-MANAGEMENT-260919.md` 的 P1（正文改存 filename）落地后，
 * 渲染层**零改动**即可切过去。
 */
export function sheetImageSrc(src: string | null | undefined, noteId: string): string | null {
  const value = typeof src === "string" ? src.trim() : "";
  if (!value) return null;
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) return value;
  if (!noteId) return null;
  return localAssetHttpUrl(noteId, value);
}

export interface SheetDoc {
  kind: typeof SHEET_DOC_KIND;
  version: typeof SHEET_DOC_VERSION;
  sheets: SheetWorksheet[];
}

/** 新建表格文档的正文（1 张空表；最小可用，随后由编辑器保存覆盖）。 */
export function emptySheetBody(): string {
  const doc: SheetDoc = {
    kind: SHEET_DOC_KIND,
    version: SHEET_DOC_VERSION,
    sheets: [
      {
        id: "sheet-1",
        name: "Sheet1",
        order: 0,
        status: 1,
        // 默认 15 列 × 50 行（260919 用户定）。
        column: 15,
        row: 50,
        celldata: [],
        config: {},
      },
    ],
  };
  return JSON.stringify(doc);
}

/** 解析表格正文；非法/空/版本不符返回 null（调用方按「空表」处理，不抛错）。 */
export function parseSheetBody(content: string | null | undefined): SheetDoc | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<SheetDoc>;
  if (doc.kind !== SHEET_DOC_KIND || doc.version !== SHEET_DOC_VERSION || !Array.isArray(doc.sheets)) return null;
  const sheets = doc.sheets.filter(
    (sheet): sheet is SheetWorksheet => !!sheet && typeof sheet === "object" && typeof (sheet as SheetWorksheet).name === "string",
  );
  if (sheets.length === 0) return null;
  return { kind: SHEET_DOC_KIND, version: SHEET_DOC_VERSION, sheets };
}

/** FortuneSheet 运行时字段（选区等）——不持久化：属 L3 本机派生，不入正文。 */
const TRANSIENT_SHEET_KEYS = ["luckysheet_select_save", "luckysheet_selection_range", "scrollLeft", "scrollTop"] as const;

/** dense `data` 矩阵 → sparse `celldata`（只保留非空格子）。 */
function denseToCelldata(data: Array<Array<SheetCellValue | null>>): SheetCell[] {
  const out: SheetCell[] = [];
  for (let r = 0; r < data.length; r += 1) {
    const row = data[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      const v = row[c];
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out.push({ r, c, v });
    }
  }
  return out;
}

/**
 * 把编辑器返回的 sheet 规范化成可持久化形态：
 * - 剔除选区/滚动等运行时字段（否则每次点选都会改正文 ⇒ 内容寻址对象无端膨胀、跨端无意义 diff）；
 * - dense `data` → sparse `celldata`（正文体积正比于「非空格子数」而不是网格面积）。
 */
export function sanitizeSheetWorksheet(sheet: SheetWorksheet): SheetWorksheet {
  const source = sheet as SheetWorksheet & { data?: Array<Array<SheetCellValue | null>> };
  const rest = { ...source } as Record<string, unknown>;
  for (const key of TRANSIENT_SHEET_KEYS) delete rest[key];
  const celldata = Array.isArray(source.data) ? denseToCelldata(source.data) : (source.celldata ?? []);
  delete rest.data;
  return { ...rest, celldata } as SheetWorksheet;
}

/** sheets → 正文 JSON（统一走规范化：剔运行时字段 + dense→sparse）。 */
export function sheetsToBody(sheets: SheetWorksheet[]): string {
  const doc: SheetDoc = { kind: SHEET_DOC_KIND, version: SHEET_DOC_VERSION, sheets: sheets.map(sanitizeSheetWorksheet) };
  return JSON.stringify(doc);
}

/**
 * 表格正文 → 供全文搜索的纯文本（取各表 celldata 的显示/值文本，按行列顺序拼接；超长截断）。
 * 与 Lake 的 `lakeHtmlToPlain` 职责对应：非文档类型的正文不能喂给 HTML 解析器。
 */
export function sheetToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseSheetBody(content);
  if (!doc) return "";
  const parts: string[] = [];
  const reachedLimit = () => parts.join("\n").length > maxChars;
  for (const sheet of doc.sheets) {
    if (parts.length > 0) parts.push(`[${sheet.name}]`);
    const rows = new Map<number, Array<{ c: number; text: string }>>();
    for (const cell of sheet.celldata ?? []) {
      if (!cell || !Number.isFinite(cell.r) || !Number.isFinite(cell.c)) continue;
      const raw = cell.v?.m ?? cell.v?.v;
      if (raw == null || raw === "") continue;
      const text = String(raw);
      const row = rows.get(cell.r) ?? [];
      row.push({ c: cell.c, text });
      rows.set(cell.r, row);
    }
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      parts.push((rows.get(r) ?? []).sort((a, b) => a.c - b.c).map((x) => x.text).join("\t"));
      if (reachedLimit()) break;
    }
    if (reachedLimit()) break;
  }
  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
