/**
 * Univer 表格文档（kind = "usheet"）正文格式与序列化 —— 桌面/移动端共享的单一事实源。
 *
 * 与 kind="sheet"（FortuneSheet，正文 sheets/{id}.sheet.json）**并存**，两者互不影响；
 * 新类型跑通、验收后才会撤掉旧实现。
 *
 * 正文 = `{ kind:"usheet", version:1, workbook: <Univer IWorkbookData> }`（纯文本 JSON）。
 * workbook 就是 Univer 的 `fWorkbook.save()` 快照，原样存、原样喂回 `createWorkbook()`。
 * 因此它天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线（引擎对正文字节无关）。
 *
 * 边界：本文件属 `src/core`（禁第三方依赖），只声明"结构上兼容 Univer"的最小类型，**不 import @univerjs/***。
 */
export const USHEET_DOC_KIND = "usheet" as const;
export const USHEET_DOC_VERSION = 1 as const;

/** Univer 单元格（只声明搜索/校验要读的字段；样式等其余字段原样透传）。 */
export interface UsheetCell {
  /** 原始值 */
  v?: unknown;
  /** 公式（如 "=SUM(A1:A2)"） */
  f?: string;
  /** 显示值 */
  m?: unknown;
  [key: string]: unknown;
}

/** Univer 工作表（rowData/columnData/mergeData/freeze 等原样透传）。 */
export interface UsheetWorksheet {
  id?: string;
  name?: string;
  rowCount?: number;
  columnCount?: number;
  /** sparse：行下标 → (列下标 → 单元格) */
  cellData?: Record<string, Record<string, UsheetCell>>;
  [key: string]: unknown;
}

/** Univer 工作簿快照（IWorkbookData 的结构兼容最小子集）。 */
export interface UsheetWorkbook {
  id?: string;
  name?: string;
  sheetOrder?: string[];
  sheets?: Record<string, UsheetWorksheet>;
  styles?: Record<string, unknown>;
  resources?: unknown[];
  [key: string]: unknown;
}

export interface UsheetDoc {
  kind: typeof USHEET_DOC_KIND;
  version: typeof USHEET_DOC_VERSION;
  workbook: UsheetWorkbook;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 新建空表：一行一表、100 行 × 26 列（Univer 默认网格之下给个合理下限）。 */
export function emptyUsheetWorkbook(): UsheetWorkbook {
  return {
    id: "workbook",
    name: "表格",
    sheetOrder: ["s1"],
    sheets: {
      s1: { id: "s1", name: "Sheet1", rowCount: 100, columnCount: 26, defaultColumnWidth: 88, defaultRowHeight: 24, cellData: {} },
    },
  };
}

export function emptyUsheetBody(): string {
  return JSON.stringify({ kind: USHEET_DOC_KIND, version: USHEET_DOC_VERSION, workbook: emptyUsheetWorkbook() } satisfies UsheetDoc);
}

/** 解析正文；非 usheet / 版本不符 / 结构不对一律 null（按空表打开，AGENTS §3#7 不写兼容）。 */
export function parseUsheetBody(content: string | null | undefined): UsheetDoc | null {
  if (typeof content !== "string" || content.length === 0) return null;
  try {
    const raw: unknown = JSON.parse(content);
    if (!isRecord(raw) || raw.kind !== USHEET_DOC_KIND || raw.version !== USHEET_DOC_VERSION) return null;
    if (!isRecord(raw.workbook)) return null;
    return { kind: USHEET_DOC_KIND, version: USHEET_DOC_VERSION, workbook: raw.workbook as UsheetWorkbook };
  } catch {
    return null;
  }
}

export function usheetToBody(workbook: UsheetWorkbook): string {
  return JSON.stringify({ kind: USHEET_DOC_KIND, version: USHEET_DOC_VERSION, workbook } satisfies UsheetDoc);
}

/** 正文 → 搜索纯文本（抽单元格 v，公式结果优先用 m/v）。 */
export function usheetToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseUsheetBody(content);
  if (!doc) return "";
  const parts: string[] = [];
  let length = 0;
  for (const sheet of Object.values(doc.workbook.sheets ?? {})) {
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const cell of Object.values(row)) {
        if (!isRecord(cell)) continue;
        const value = cell.m ?? cell.v;
        if (typeof value !== "string" && typeof value !== "number") continue;
        const text = String(value);
        parts.push(text);
        length += text.length + 1;
        if (length >= maxChars) return parts.join(" ").slice(0, maxChars);
      }
    }
  }
  return parts.join(" ").slice(0, maxChars);
}
