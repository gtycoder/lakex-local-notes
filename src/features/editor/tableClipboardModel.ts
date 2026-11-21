/**
 * 表格复制的**数据源**：从内核正文（`editor.getDocument("text/lake")`）取整张表，而不是从 DOM 取。
 *
 * 为什么（261122 现场）：文档里的表格是**虚拟渲染**的——DOM 只挂视口附近的行，其余行的 `<td>` 是空的。
 * 从 DOM 序列化会把空行裁掉（实测 116 行 → 28 行），粘到表格就缺数据。
 * 正文里表格是完整的 `<table class="lake-table">`（行/格/段落齐全）⇒ 以正文为唯一数据源。
 *
 * 索引对齐：DOM 与正文的表格都按文档顺序出现，用「选中表在宿主 DOM 里的序号」去正文里取同一张。
 */
export const TABLE_SELECTOR = "table.ne-table, table.lake-table";

/** 选中表在宿主里的序号（0 基）；找不到返回 -1。 */
export function tableIndexInHost(host: HTMLElement, table: HTMLTableElement): number {
  const tables = Array.from(host.querySelectorAll<HTMLTableElement>(TABLE_SELECTOR));
  return tables.indexOf(table);
}

function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  // 表格单元格里可能是 <p><span>文字</span></p>（Lake 正文），换行/段落压成单个空格。
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  const text = clone.textContent ?? "";
  return text.replace(/\u00a0/g, " ").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\t ]+/g, " ").trim();
}

/** 正文 HTML 里第 index 张表 → 矩阵；越界/没有表返回 null。 */
export function tableMatrixFromBody(body: string | null | undefined, index: number): string[][] | null {
  if (!body || index < 0 || typeof DOMParser === "undefined") return null;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(body, "text/html"); } catch { return null; }
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>("table"));
  const table = tables[index];
  if (!table) return null;
  const rows = Array.from(table.rows ?? []);
  const matrix = rows.map((row) => Array.from(row.cells ?? []).map(cellText));
  // **不裁剪空行**：表格里的空行也是数据（行对齐），只要求整表至少有一个非空格。
  if (matrix.length === 0) return null;
  return matrix.some((row) => row.some((cell) => cell !== "")) ? matrix : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 矩阵 → 剪贴板载荷（标准 `<table>` + TSV）。 */
export function payloadFromMatrix(matrix: readonly (readonly string[])[]): { html: string; plain: string } {
  const columns = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = matrix.map((row) => { const next = row.slice(); while (next.length < columns) next.push(""); return next; });
  const plain = padded.map((row) => row.join("\t")).join("\n");
  const html = "<meta charset='utf-8'><table border=\"1\" style='border-collapse:collapse'>"
    + padded.map((row) => "<tr>" + row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("") + "</tr>").join("")
    + "</table>";
  return { html, plain };
}

/** DOM 表 → 矩阵（**回退路径**：拿不到正文时用；虚拟渲染下可能缺行）。 */
export function matrixFromTableElement(table: HTMLTableElement): string[][] | null {
  const rows = Array.from(table.rows ?? []);
  const matrix = rows.map((row) => Array.from(row.cells ?? []).map((cell) => cellText(cell)));
  if (matrix.length === 0) return null;
  return matrix.some((row) => row.some((cell) => cell !== "")) ? matrix : null;
}