/**
 * 大表格粘贴护栏 + 「存为表格文档」（A+B，261008 用户定稿）。
 *
 * 背景：把 ~5500 行 6 列的表格（实测 2.7MB HTML）粘进**文档**会把主线程同步卡 **30.7 秒**
 * （内核的表格卡片整表全量渲染 DOM、无虚拟化；云端 Lake 同样卡）。详见 HANDOFF §3#16
 * 与 `scripts/table-paste-stress.mjs`。
 *
 * A（护栏）：粘贴的 HTML 表格超过阈值时**不把它交给内核**（preventDefault），改为弹明确提示
 *   ——**剪贴板内容保留、绝不静默丢弃**（AGENTS §3#16「静默丢弃用户输入是最坏失败」）。
 * B（兜底）：提示里给一键「存为表格文档」：解析该表格 → 建一篇「表格」文档写入 → 在光标所在块
 *   之后插入一张「文档引用」卡指向它（复用 R2 的 `lake-note-ref`）。
 *
 * 本文件 = 纯逻辑（阈值 / 计数 / 解析成表格正文 / 卡片 HTML / 事件通道），UI 在
 * `TablePasteGuardDialog.tsx`。
 */
import { NOTE_REF_CARD_NAME, type NoteRefValue } from "./noteRef";

/**
 * 阈值：行 > 1000 或格 > 5000 即拦（用户 261008 定稿上调；旧值 500/3000）。
 * **边界实测**（隔离实例 + 合成 HTML，量的是 `dispatchEvent` 的同步耗时 = 主线程阻塞）：
 *   1000 行 × 5 列 = 5000 格（行驱动满档）→ **1.93s** / DOM +2.65 万；
 *   100 行 × 50 列 = 5000 格（格子驱动满档）→ **1.41s**；
 *   旧上限 500 行 × 6 列 = 3000 格 → 0.79s；超限则护栏同步返回 **≤1ms**（内核完全不接）。
 */
export const TABLE_PASTE_MAX_ROWS = 1000;
export const TABLE_PASTE_MAX_CELLS = 5000;

export interface TableShape {
  rows: number;
  cells: number;
}

/** 快速数出 HTML 里的行/格（不做完整解析；2.7MB 上 <5ms）。没有表格返回 null。 */
export function countHtmlTable(html: string): TableShape | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const rows = (html.match(/<tr[\s>]/gi) || []).length;
  const cells = (html.match(/<t[dh][\s>]/gi) || []).length;
  if (rows === 0 && cells === 0) return null;
  return { rows, cells };
}

/** 超阈值才返回形状（用于拦截判据），否则 null。 */
export function oversizeTableShape(html: string): TableShape | null {
  const shape = countHtmlTable(html);
  if (!shape) return null;
  return shape.rows > TABLE_PASTE_MAX_ROWS || shape.cells > TABLE_PASTE_MAX_CELLS ? shape : null;
}

/** 把 HTML 表格解析成「表格」文档正文（kind=sheet v2；与 `core/sheetDoc.ts` 同格式）。 */
export function parseHtmlTableToSheetBody(html: string): string | null {
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const table = parsed.querySelector("table");
    if (!table) return null;
    const trs = Array.from(table.querySelectorAll("tr"));
    if (trs.length === 0) return null;
    const celldata: Array<{ r: number; c: number; v: Record<string, unknown> }> = [];
    let maxCols = 0;
    trs.forEach((tr, r) => {
      const tds = Array.from(tr.querySelectorAll("td,th"));
      maxCols = Math.max(maxCols, tds.length);
      tds.forEach((td, c) => {
        const text = (td.textContent ?? "").trim();
        if (!text) return;
        celldata.push({ r, c, v: { v: text, m: text, tb: "2", ct: { fa: "General", t: "g" } } });
      });
    });
    if (celldata.length === 0) return null;
    const body = {
      kind: "sheet",
      version: 2,
      sheets: [{ name: "Sheet1", id: "sheet-1", status: 1, order: 0, celldata, config: {}, row: trs.length, column: Math.max(1, maxCols) }],
    };
    return JSON.stringify(body);
  } catch {
    return null;
  }
}

/** 新表格文档的标题：带来源与规模，便于在树里认出来。 */
export function sheetDocTitle(shape: TableShape, at: number): string {
  return `粘贴的表格 ${shape.rows} 行 × ${shape.cells} 格（${new Date(at).toLocaleString("zh-CN")}）`;
}

/** 「文档引用」卡的粘贴 HTML 形态（内核认 `ne-custom-card` + `data-custom-name`；见 LAKEX-CONTRACT §5.23）。 */
export function noteRefCardHtml(value: NoteRefValue): string {
  const json = JSON.stringify({ $name: NOTE_REF_CARD_NAME, ...value });
  return `<div class="ne-custom-card" data-name="customBlock" data-custom-name="${NOTE_REF_CARD_NAME}" data-value="${encodeURIComponent(json)}">${value.title ?? ""}</div>`;
}

/** 超阈值粘贴事件（拦截器 → 对话框）。 */
export interface OversizeTablePaste { shape: TableShape; html: string; at: number }
type Listener = (payload: OversizeTablePaste) => void;
const listeners = new Set<Listener>();
export function onOversizeTablePaste(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitOversizeTablePaste(payload: OversizeTablePaste): void {
  for (const listener of listeners) { try { listener(payload); } catch { /* 单个订阅者出错不影响其它 */ } }
}
