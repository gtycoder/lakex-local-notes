/**
 * 外部「表格」剪贴板 → 单元格矩阵（Lake/语雀表格卡、Excel、网页表格、TSV 文本）。
 *
 * 为什么需要（261121 用户现场）：从**文档表格卡**（Lake/语雀表格，HTML = `<table class="ne-table">`
 * + 单元格里再套 `<div>`）复制后粘进我们的表格（Univer），只剩左上角一格 —— Univer 1.0.3 的外部
 * HTML 粘贴走它自己的 Excel 风格解析器（`HtmlToUSMService.convert`），对 Lake 这种结构只能取出一格。
 *
 * 口径：
 *  · **只接管外部内容**：Univer 自己的复制带 `data-copy-id`（内部走 copyContentCache，样式/合并都保真），
 *    这类一律放行给内核；
 *  · **只接管表格**：HTML 里有 `<table>`，或纯文本是「多行/多列」（含 \t 或 ≥2 行）；
 *    单行单列的普通文本仍交回内核（保持单元格编辑/公式栏的原生行为）；
 *  · 合并单元格按 Excel 语义铺开：左上角留值、其余补空串（不复制同一份内容）。
 * 纯函数、无副作用，落点由宿主（UniverSheetEditor）用 facade `setValues` 写入。
 */

export type ClipboardTableSource = "html-table" | "tsv";

export interface ClipboardTable {
  /** 行优先的二维文本矩阵（每行等长，空串 = 空格）。 */
  matrix: string[][];
  source: ClipboardTableSource;
}

/** Univer 内部复制在 HTML 上留的标记（<table data-copy-id="xxxx">）。 */
export const UNIVER_COPY_ID_ATTR = "data-copy-id";

/** 是不是 Univer 自己的复制（内部粘贴要保留样式/合并，不能我们自己按文本重写）。 */
export function isUniverInternalCopy(html: string | null | undefined): boolean {
  return typeof html === "string" && html.includes(UNIVER_COPY_ID_ATTR + "=");
}

/** 单元格文本：<br> 先换成空格（否则"标题<br>续行"会粘成一个词），再走 cellText。 */
function cellTextFromElement(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  return cellText(clone.textContent);
}

/** 单元格文本：NBSP → 空格、行内换行/连续空白压成单个空格、去首尾空白。 */
function cellText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}

/** 去掉尾部全空的行/列（从语雀或网页复制常带一整排空 td）。 */
function trimEmptyEdges(matrix: string[][]): string[][] {
  const rows = matrix.filter((row) => row.some((cell) => cell !== ""));
  if (rows.length === 0) return [];
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  const padded = rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push("");
    return next;
  });
  let end = width;
  while (end > 0 && padded.every((row) => row[end - 1] === "")) end -= 1;
  return padded.map((row) => row.slice(0, end));
}

/** HTML → 矩阵：只取第一张表（Lake 表格卡就是一个 <table>；嵌套表按单元格文本参与）。 */
export function parseHtmlTable(html: string): string[][] | null {
  if (typeof html !== "string" || !/<table[\s>]/i.test(html)) return null;
  if (typeof DOMParser === "undefined") return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const table = doc.querySelector("table");
  if (!table) return null;
  const grid: string[][] = [];
  /** 列号 → 还需要向下占用几行（rowspan 的余量）。 */
  const rowspanCarry = new Map<number, number>();
  const rows = Array.from((table as HTMLTableElement).rows ?? []);
  for (const row of rows) {
    const out: string[] = [];
    let column = 0;
    const fillSpans = () => {
      // 先补上一行 rowspan 占位的格子
      while (rowspanCarry.get(column) !== undefined && (rowspanCarry.get(column) ?? 0) > 0) {
        out[column] = "";
        rowspanCarry.set(column, (rowspanCarry.get(column) ?? 1) - 1);
        column += 1;
      }
    };
    for (const cell of Array.from(row.cells ?? [])) {
      fillSpans();
      const text = cellTextFromElement(cell);
      const colspan = Math.max(1, Math.min(1000, cell.colSpan || 1));
      const rowspan = Math.max(1, Math.min(1000, cell.rowSpan || 1));
      for (let offset = 0; offset < colspan; offset += 1) {
        out[column] = offset === 0 ? text : "";
        if (rowspan > 1) rowspanCarry.set(column, rowspan - 1);
        column += 1;
      }
    }
    grid.push(out);
  }
  const trimmed = trimEmptyEdges(grid);
  return trimmed.length > 0 ? trimmed : null;
}

/** 纯文本 → 矩阵：Excel/表格复制的 TSV（\t 列分隔、\n 行分隔）。单行单列 → null（交回内核）。 */
export function parseTsv(text: string): string[][] | null {
  if (typeof text !== "string" || text === "") return null;
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!normalized.includes("\t") && !normalized.includes("\n")) return null;
  const rows = normalized.split("\n").map((line) => line.split("\t").map((cell) => cell.replace(/\u00a0/g, " ").trimEnd()));
  const trimmed = trimEmptyEdges(rows);
  if (trimmed.length === 0) return null;
  if (trimmed.length === 1 && trimmed[0].length === 1) return null;
  return trimmed;
}

/**
 * 剪贴板 → 需要我们自己写进表格的矩阵（不需要接管时返回 null）。
 * 优先级：内部复制 → null（内核保真）；表格 HTML → 表格；否则多行/多列文本 → TSV。
 */
export function clipboardTableFrom(input: { html?: string | null; text?: string | null }): ClipboardTable | null {
  const html = input.html ?? "";
  if (isUniverInternalCopy(html)) return null;
  const fromHtml = parseHtmlTable(html);
  if (fromHtml) return { matrix: fromHtml, source: "html-table" };
  const fromText = parseTsv(input.text ?? "");
  if (fromText) return { matrix: fromText, source: "tsv" };
  return null;
}
