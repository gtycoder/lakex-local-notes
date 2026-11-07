/**
 * 通用 CSV 解析（RFC 4180 常用子集）：双引号、转义引号、字段内换行、CRLF/CR/LF。
 * 单一来源：多维表导入与表格(xlsx/csv)导入共用（此前只在 bitableCsv 里）。
 */
export function parseCsv(text: string): string[][] {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { if (s[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
