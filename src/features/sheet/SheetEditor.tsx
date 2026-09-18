/**
 * 表格编辑器（kind="sheet"）：FortuneSheet。
 * 原 jspreadsheet CE 实现已替换；选型/补丁/风险见 docs/FORTUNESHEET-FEASIBILITY-260919.md。
 *
 * 关键约束：
 * - FortuneSheet 用 canvas 渲染；在 display:none 容器里首次挂载会量到 0 尺寸 ⇒ 本组件只在
 *   「首次可见」后才真正挂载 <Workbook>（keep-alive 隐藏的 tab 不初始化 canvas）；实测隐藏→显示
 *   后 canvas 能自动恢复尺寸（spike，260919）。
 * - 非受控数据：data 只作初始值；变更走 onChange，防抖后序列化回 SheetDoc v2。**不要**把 onChange
 *   的 data 再回灌给 <Workbook>（会打断输入/光标跳动）。宿主用 key=[noteId]-[reloadKey] 保证换文档重挂。
 * - 只读（回收站/锁定/被他端删除）：allowEdit=false + 不挂自动保存。
 * - CSP：FortuneSheet 的 insertRowOrColumn 用 new Function，已由
 *   patches/@fortune-sheet+core+1.0.4.patch 替换为 apply（prod CSP 无 unsafe-eval）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import "./sheetEditor.css";
import { emptySheetBody, parseSheetBody, sheetsToBody, type SheetWorksheet } from "../../core/sheetDoc.js";

/** 自动保存防抖：FortuneSheet 每次变更都回调，必须合并。 */
const AUTOSAVE_DEBOUNCE_MS = 800;
/** 默认缩放（260919 用户要求「整体偏小，默认 110%」）。已有 zoomRatio 的 sheet 不覆盖（尊重用户改过的缩放）。 */
const DEFAULT_SHEET_ZOOM = 1.1;
/** 全局字体（与 app 的 --b3-font-family 对齐）。用户要求「默认用全局字体、不支持修改」⇒ 不放「字体」工具栏项。 */
const GLOBAL_FONT = 'BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif';
/** FortuneSheet 的自动换行 = `tb:"2"`（overflow:"1" / clip:"0"）；默认给单元格补上。 */
const WRAP = "2";
/**
 * 工具栏（260919 第二轮按用户要求增减）。
 * 增加：格式刷 format-painter · 清除格式 clear-format · 条件格式 conditionFormat · 筛选 filter · 图片 image · 定位 locationCondition。
 * 去除：字体 font（改为默认全局字体、不可改）。
 */
const TOOLBAR_ITEMS = [
  "undo", "redo", "|",
  "format-painter", "clear-format", "|",
  "font-size", "|",
  "bold", "italic", "strike-through", "underline", "|",
  "font-color", "background", "|",
  "horizontal-align", "vertical-align", "text-wrap", "|",
  "border", "merge-cell", "|",
  "filter", "image", "|",
  "freeze", "quick-formula", "|", "search",
];

/**
 * 估算「自动换行」后该行需要的高度。FortuneSheet 的行高自适应只在「旧值已存在 + 带 canvas」的
 * 编辑路径里跑，公开 API 触发不到；首次录入空单元格时更不会调（所以第二行会被压住）。
 * 这里用离屏 canvas 按列宽量出行数，再按 defaultRowHeight(19px @10pt) 口径给出行高。
 */
function estimateWrappedRowHeight(text: string, fontSize: number, cellWidth: number): number {
  if (!text) return 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const fontPx = Math.max(1, fontSize) * (96 / 72); // pt → px
  ctx.font = `normal normal ${fontPx}px ${GLOBAL_FONT}`;
  const usable = Math.max(8, cellWidth - 4);
  const lines = Math.max(1, Math.ceil(ctx.measureText(text).width / usable));
  const lineHeight = Math.round(fontPx * 1.43); // 10pt → ≈19px，与 defaultRowHeight 对齐
  return lines * lineHeight + 3;
}

/** 给单元格补默认样式（只补缺省、不覆盖显式设置）：自动换行 + 全局字体。 */
function withCellDefaults(cell: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cell };
  if (next.tb == null) next.tb = WRAP;
  if (next.ff == null) next.ff = GLOBAL_FONT;
  return next;
}

/** 规范化 sheet：给已有内容的单元格补默认样式（dense `data` 与 sparse `celldata` 两种形态都处理）。 */
function withSheetDefaults(sheet: SheetWorksheet): SheetWorksheet {
  const rest = { ...sheet } as Record<string, unknown>;
  if (Array.isArray(rest.data)) {
    rest.data = (rest.data as Array<Array<Record<string, unknown> | null>>).map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell ? withCellDefaults(cell) : cell)) : row,
    );
  }
  if (Array.isArray(rest.celldata)) {
    rest.celldata = (rest.celldata as Array<{ v?: Record<string, unknown> | null }>).map((item) =>
      item && item.v ? { ...item, v: withCellDefaults(item.v) } : item,
    );
  }
  return rest as SheetWorksheet;
}

export interface SheetEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
}

/** 解析初始 sheets；空/非法 → 一张空表（不抛错，避免坏数据打不开）。缺省加上默认缩放。 */
function initialSheets(content: string): SheetWorksheet[] {
  const parsed = parseSheetBody(content);
  const sheets = parsed ? parsed.sheets : (parseSheetBody(emptySheetBody())?.sheets ?? []);
  return sheets.map((sheet) =>
    withSheetDefaults(sheet.zoomRatio == null ? { ...sheet, zoomRatio: DEFAULT_SHEET_ZOOM } : sheet),
  );
}

export function SheetEditor({ noteId, content, visible, readOnly, onChange }: SheetEditorProps) {
  const workbookRef = useRef<WorkbookInstance>(null);
  // data 只作初始值：宿主用 key=[noteId]-[reloadKey] 保证换文档时整体重挂。
  const [sheets] = useState<SheetWorksheet[]>(() => initialSheets(content));
  const latestRef = useRef<SheetWorksheet[]>(sheets);
  // 上一次已落盘的正文（规范化后）：与本次相同则跳过，避免「打开即标脏」与选区 churn 触发保存。
  const lastSerializedRef = useRef<string | null>(sheetsToBody(sheets));
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // keep-alive：首次可见前不挂载（canvas 在隐藏态初始化会量成 0）。
  const [everVisible, setEverVisible] = useState(visible);

  useEffect(() => {
    if (visible) setEverVisible(true);
  }, [visible]);


  const flush = () => {
    const json = sheetsToBody(latestRef.current);
    if (json === lastSerializedRef.current) return; // 无实际变化（如仅选区变化）：不标脏
    lastSerializedRef.current = json;
    changeRef.current(json);
  };
  const scheduleSave = () => {
    if (readOnlyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; flush(); }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    // 卸载/切走前把未落盘的改动补齐（不丢最后一次编辑）
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新编辑/输入的单元格补默认样式（自动换行 + 全局字体）；只补缺省、不覆盖显式设置。
  const hooks = useMemo(() => ({
    afterUpdateCell: (row: number, column: number) => {
      const wb = workbookRef.current;
      if (!wb) return;
      try {
        // 默认自动换行 + 全局字体（只补缺省）
        if (wb.getCellValue(row, column, { type: "tb" } as never) == null) wb.setCellFormat(row, column, "tb", WRAP);
        if (wb.getCellValue(row, column, { type: "ff" } as never) == null) wb.setCellFormat(row, column, "ff", GLOBAL_FONT);
        // 行高自适应（公开 API 触发不到内核那段 canvas 计算）：自己按列宽估算后 setRowHeight
        const value = wb.getCellValue(row, column);
        if (value == null || value === "") return;
        const fontSize = Number(wb.getCellValue(row, column, { type: "fs" } as never)) || 10;
        const colWidths = wb.getColumnWidth([column]) as Record<number, number> | undefined;
        const cellWidth = Number(colWidths?.[column]) || 73;
        const needed = estimateWrappedRowHeight(String(value), fontSize, cellWidth);
        const rowHeights = wb.getRowHeight([row]) as Record<number, number> | undefined;
        const current = Number(rowHeights?.[row]) || 19;
        if (needed > current + 1) wb.setRowHeight({ [row]: needed });
      } catch { /* 忽略 */ }
    },
  }), []);

  return (
    <div className={visible ? "sheet-editor" : "sheet-editor fn__none"}>
      {everVisible && sheets.length > 0 && (
        <Workbook
          ref={workbookRef}
          data={sheets as never}
          allowEdit={!readOnly}
          showToolbar
          showFormulaBar={false}
          showSheetTabs
          toolbarItems={TOOLBAR_ITEMS}
          hooks={hooks}
          onChange={(next) => {
            latestRef.current = next as SheetWorksheet[];
            scheduleSave();
          }}
        />
      )}
    </div>
  );
}
