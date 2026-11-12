/**
 * 多维表编辑器的「面板/浮层状态」：所有弹层/菜单/对话框的锚点与开合状态（纯渲染层 UI state，不写正文、不进 S3）。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useEffect, useRef, useState } from "react";
import type { CsvColumnMapping, CsvImportResult } from "../../core/bitableCsv.js";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";

export type BitableChromeMenuApi = ReturnType<typeof useBitableChromeMenu>;
export function useBitableChromeMenu() {
  // ---- 面板/浮层状态 ----
  const [panel, setPanel] = useState<null | "fields" | "filter" | "fill" | "group" | "sort" | "rowHeight" | "viewConfig">(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  /** 列菜单：坐标定位（⋯ 按钮 / 列头右键都能开）；header 留给列统计等仍以列头为锚点的子面板。
   *  文本颜色改为菜单行右侧子菜单，锚到触发按钮本身，不再依赖菜单关闭后的列头位置。 */
  const [columnMenu, setColumnMenu] = useState<{ fieldId: string; x: number; y: number; header: HTMLElement | null } | null>(null);
  const [textColorFor, setTextColorFor] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  useEffect(() => { if (!columnMenu) setTextColorFor(null); }, [columnMenu]);
  /** 列统计选择器（列菜单「统计」→ 锚到列头）。 */
  const [statFor, setStatFor] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  const [configDragId, setConfigDragId] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<{ viewId: string; anchor: HTMLElement } | null>(null);
  const [addFieldAnchor, setAddFieldAnchor] = useState<HTMLElement | null>(null);
  const [fieldEditor, setFieldEditor] = useState<{ fieldId: string | null } | null>(null);
  /** AI 字段「整列生成」对话框（261003）。 */
  const [aiGenerateFieldId, setAiGenerateFieldId] = useState<string | null>(null);
  const [viewEditor, setViewEditor] = useState<string | null>(null);
  const viewNameRef = useRef<HTMLInputElement>(null);
  const [tableEditor, setTableEditor] = useState<{ id: string; draft: string } | null>(null);
  /** 数据表行 ⋮ 菜单（重命名 / 复制 / 删除；锚定在被点的行上）。 */
  const [tableMenu, setTableMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [csvImport, setCsvImport] = useState<{ fileName: string; header: string[]; rows: string[][]; mapping: CsvColumnMapping[] } | null>(null);
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  /** 右上角「更多」菜单锚点（视图页签行最右）。 */
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [drawerRecordId, setDrawerRecordId] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{ kind: "field" | "record" | "table"; id: string } | null>(null);
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const [rowDragOverId, setRowDragOverId] = useState<string | null>(null);
  const [rowCtx, setRowCtx] = useState<{ recordId: string; x: number; y: number } | null>(null);
  /** 行右键菜单定位（与其它浮层同源：先量真实尺寸，贴底翻上方，不再靠猜 90/300 的高度）。 */
  const rowMenuPos = usePopoverPosition({ open: Boolean(rowCtx), at: rowCtx ? { x: rowCtx.x, y: rowCtx.y } : null });

  return { panel, setPanel, menuAnchor, setMenuAnchor, columnMenu, setColumnMenu, textColorFor, setTextColorFor, statFor, setStatFor, configDragId, setConfigDragId, viewMenu, setViewMenu, addFieldAnchor, setAddFieldAnchor, fieldEditor, setFieldEditor, aiGenerateFieldId, setAiGenerateFieldId, viewEditor, setViewEditor, tableEditor, setTableEditor, tableMenu, setTableMenu, csvImport, setCsvImport, csvResult, setCsvResult, findOpen, setFindOpen, moreAnchor, setMoreAnchor, findQuery, setFindQuery, drawerRecordId, setDrawerRecordId, selectedRecordIds, setSelectedRecordIds, dragging, setDragging, rowDragId, setRowDragId, rowDragOverId, setRowDragOverId, rowCtx, setRowCtx, viewNameRef, rowMenuPos };
}
