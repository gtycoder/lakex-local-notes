/**
 * 历史快照的**结构化预览模型**（260926）。
 *
 * 背景：doc 快照正文是 Lake HTML（只读 viewer 渲染即可）；而 usheet / bitable / board 的正文是**内部 JSON**，
 * 喂 HTML 解析器只会得到一堆 JSON 碎片（用户报「历史快照预览还是 json 格式」）。
 *
 * 这里把三类 JSON 正文派生为**纯数据模型**：不碰 DOM、不挂编辑器、不加载任何大分包
 * （对比：挂 readOnly 编辑器要付 Univer ≈数 MB / Drawnix ≈511KB 的分包与 canvas 语义）。
 * 与搜索索引同一口径：复用各领域既有的 parse* / displayValue，不另写解析。
 * 渲染由 `src/components/HistorySnapshotPreview.tsx` 负责（桌面历史面板与单据属性弹窗共用）。
 */
import { boardToSearchText, parseBoardBody } from "./boardDoc.js";
import { bitableFieldText, parseBitableBody } from "./bitableDoc.js";
import type { NoteKind } from "./noteKind.js";
import { parseUsheetBody } from "./usheetDoc.js";

/** 预览模型：块级（事实清单 / 小表格 / 文本 / 提示），渲染层逐块画。 */
export type SnapshotPreviewBlock =
  | { type: "facts"; items: Array<[string, string]> }
  | { type: "table"; title: string; head: string[]; rows: string[][]; more?: string }
  | { type: "text"; title: string; text: string }
  | { type: "empty"; text: string };

/** 预览上限：宁可"看得懂"也不要铺满整页（历史预览是"翻一下"的场景）。 */
const MAX_SHEETS = 3;
const MAX_ROWS = 6;
const MAX_COLS = 6;
const CELL_MAX = 40;
const TEXT_MAX = 1200;

function clip(value: string, max = CELL_MAX): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function snapshotPreview(kind: NoteKind, body: string): SnapshotPreviewBlock[] {
  if (kind === "usheet") return usheetPreview(body);
  if (kind === "bitable") return bitablePreview(body);
  if (kind === "board") return boardPreview(body);
  // doc：正文是 Lake HTML，走只读 viewer 渲染，不需要结构化模型
  return [{ type: "empty", text: "这份快照的正文用文档预览查看。" }];
}

/** 表格（kind=usheet）：工作表数 + 非空单元格数（Univer sparse cellData）。 */
function usheetPreview(body: string): SnapshotPreviewBlock[] {
  const doc = parseUsheetBody(body);
  if (!doc) return [{ type: "empty", text: "无法解析这份 Univer 表格快照。" }];
  const sheets = Object.values(doc.workbook.sheets ?? {});
  let cells = 0;
  for (const sheet of sheets) for (const row of Object.values(sheet.cellData ?? {})) cells += Object.keys(row).length;
  return [{ type: "facts", items: [["工作表", `${sheets.length} 个`], ["非空单元格", `${cells} 个`]] }];
}

/** 多维表（kind=bitable）：每张数据表的字段与头几条记录。 */
function bitablePreview(body: string): SnapshotPreviewBlock[] {
  const doc = parseBitableBody(body);
  if (!doc) return [{ type: "empty", text: "无法解析这份多维表快照（可能是较早的格式）。" }];
  const blocks: SnapshotPreviewBlock[] = [];
  if (doc.tables.length > MAX_SHEETS) {
    blocks.push({ type: "empty", text: `仅预览前 ${MAX_SHEETS} 张数据表（共 ${doc.tables.length} 张）。` });
  }
  for (const table of doc.tables.slice(0, MAX_SHEETS)) {
    const fields = table.fields.slice(0, MAX_COLS);
    const records = table.records.slice(0, MAX_ROWS);
    blocks.push({
      type: "facts",
      items: [["数据表", table.name], ["字段", `${table.fields.length} 个`], ["记录", `${table.records.length} 条`]],
    });
    if (table.records.length === 0) {
      blocks.push({ type: "empty", text: "这张数据表还没有记录。" });
      continue;
    }
    blocks.push({
      type: "table",
      title: table.name,
      head: fields.map((f) => f.name),
      rows: records.map((record) => fields.map((f) => clip(bitableFieldText(record, f, { tables: doc.tables })))),
      more: `共 ${table.records.length} 条记录 × ${table.fields.length} 个字段${table.records.length > MAX_ROWS || table.fields.length > MAX_COLS ? `（预览前 ${records.length} × ${fields.length}）` : ""}`,
    });
  }
  return blocks;
}

/** 画板（kind=board）：元素/连线数量 + 场景里的全部文字（不渲染画布）。 */
function boardPreview(body: string): SnapshotPreviewBlock[] {
  // parseBoardBody 对坏数据是"宽容退化"（返回空白画板，避免文档打不开）⇒ 这里自己判一次正文像不像画板 JSON，
  // 否则一篇非画板正文的快照会被渲染成"0 个元素的画板"，比 JSON 更误导。
  let isBoardBody = false;
  try {
    const raw: unknown = JSON.parse(body);
    isBoardBody = !!raw && typeof raw === "object" && Array.isArray((raw as { elements?: unknown }).elements);
  } catch {
    isBoardBody = false;
  }
  if (!isBoardBody) return [{ type: "empty", text: "无法解析这份画板快照（可能是较早的格式）。" }];
  const doc = parseBoardBody(body);
  const counts = new Map<string, number>();
  for (const element of doc.elements) {
    const type = element && typeof element === "object" && typeof (element as { type?: unknown }).type === "string"
      ? String((element as { type: string }).type)
      : "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  // plait 的真实 type 取值（实测：geometry / arrow-line）——未列出的按原样显示（不猜、不丢信息）
  const LABELS: Record<string, string> = {
    geometry: "形状",
    "arrow-line": "箭头/连线",
    arrow: "箭头/连线",
    line: "线条",
    text: "文本",
    image: "图片",
    mind: "思维导图",
    mindmap: "思维导图",
    group: "组合",
    freehand: "手绘",
  };
  const items: Array<[string, string]> = [
    ["模板", doc.preset || "drawing"],
    ["元素", `${doc.elements.length} 个`],
  ];
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [type, count] of top) items.push([LABELS[type] ?? type, `${count} 个`]);
  const text = boardToSearchText(body, TEXT_MAX);
  const blocks: SnapshotPreviewBlock[] = [{ type: "facts", items }];
  blocks.push(
    text
      ? { type: "text", title: "场景文字", text }
      : { type: "empty", text: "这个画板快照里没有文字内容（只有图形时看不到文字）。" }
  );
  return blocks;
}
