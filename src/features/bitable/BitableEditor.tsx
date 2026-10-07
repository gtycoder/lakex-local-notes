/**
 * 多维表编辑器（kind="bitable"）—— 自研 v1，产品口径见 docs/STORAGE-LAYERS.md。
 *
 * 形态（用户 260919 硬要求）：一个文档 = 多张数据表（左侧列表），为后期「多数据表联合」预留；
 * 三层归属 文档 ⊃ 数据表 ⊃（字段/记录/视图）。视图类型是**开放集合**：grid/form 已实现，
 * 其余（kanban/gallery/calendar 以及未来版本的未知类型）由 BitableViewFallback 明确回退成表格显示，绝不清空/改写正文。
 *
 * 关键约束：
 * - 非受控第三方内核：这里是纯 DOM/React 受控实现，隐藏 tab 也能安全渲染（不像 canvas 需 everVisible）。
 * - 自动保存防抖；与上一次序列化相同则跳过（避免「打开即标脏」）。
 * - 只读（回收站/锁定/被他端删除）：所有编辑入口禁用 + 不自动保存。
 * - 附件字段存 filename，走现有 assets/{noteId}/{filename} 资产管线（与文档/小记同一套）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { Dialog, Menu } from "../../components/ui/Overlay";
import {
  ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, Copy, Eye, EyeOff, FileUp, GripVertical, ListFilter,
  Download, Lock, LockOpen, MoreHorizontal, PaintBucket, Pencil, Plus, Rows2, Rows3, Rows4, Search, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import {
  BITABLE_DOC_KIND, BITABLE_DOC_VERSION, BITABLE_FIELD_TYPE_LABEL,
  BITABLE_OPTION_COLORS, aiPromptFieldNames, applyViewToRecords, bitableDisplayValue, bitableFieldText, bitableFieldValue, bitableFillBackgroundTokens, bitableFilterRuleCount, buildBitableFillProjection, createRelationPair, defaultRecordValues, duplicateValues, optionColorHex, unpairRelationFields,
  removeBitableAttachment, renameBitableAttachment, reorderBitableAttachments,
  createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable,
  BITABLE_STAT_LABEL, groupRecords, isAttachmentLikeField, isImplementedViewType,
  BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, applySortMode, changeSortField, kanbanGroupField, sortModeLabel, sortModeOf, sortModesForField, statDisplayText, statForField, statsForField,
  isKnownFieldType, isRelationFieldType, newBitableId, orderedAllTableFields, orderedTableFields, parseBitableBody,
  type BitableAttachment, type BitableAiConfig, type BitableDoc, type BitableField, type BitableFieldType, type BitableFilterJoin, type BitableFilterNode, type BitableGroupRule, type BitableRecord,
  type BitableRelation, type BitableRowHeight, type BitableSortMode, type BitableStatType, type BitableTable, type BitableView, type BitableViewType,
} from "../../core/bitableDoc.js";
import { fillSurfaceColor } from "../../core/colorPalette.js";
import { addBitableRecord, addBitableRecordWithValues, appendBitableAttachments, deleteBitableField, duplicateBitableField, renameAiFieldToken, setBitableCellValue, setBitableRecordValues, stripViewRefsForFieldType } from "../../core/bitableMutations.js";
import { parseCsv, defaultCsvMapping, importCsvRows, type CsvColumnMapping, type CsvImportResult } from "../../core/bitableCsv.js";
import { StatCell } from "./bitableCells";
import { BitableCsvImportDialog } from "./BitableCsvImportDialog.js";
import { native } from "../../lib/native";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { uploadLakeResource } from "../editor/resourceUpload.js";
import { openImagePreview } from "../editor/imagePreview.js";
import { BitableCalendarView } from "./BitableCalendarView.js";
import { BitableFormView } from "./BitableFormView.js";
import { BitableGalleryView } from "./BitableGalleryView.js";
import { BitableKanbanView } from "./BitableKanbanView.js";
import { BitableRecordDrawer } from "./BitableRecordDrawer.js";
import { BitableViewBar } from "./BitableViewBar.js";
import { bitableAssetUrl, openBitableAttachment } from "./bitableAssetUrl.js";
import { CalendarConfigPanel, GalleryConfigPanel, KanbanConfigPanel } from "./BitableViewConfigPanels.js";
import { AttachmentCell, CellEditor, ColorPalette, DatePicker, FieldTypeGrid, FieldTypeSelect, FieldTypeIcon, Popover, SelectMenu } from "./bitableCells.js";
import { BitableFillEditor } from "./BitableFillEditor.js";
import { BitableFilterEditor } from "./BitableFilterEditor.js";
import { useBitableSession } from "./useBitableSession";
import { BitableViewFallback, ViewTypeIcon } from "./bitableViews.js";
import { BitableAiGenerateDialog, isAiCellEmpty, type AiGenerateMode } from "./BitableAiGenerateDialog.js";
import { aiCellKey, useAiFieldGeneration } from "./useAiFieldGeneration.js";
import "./bitableEditor.css";

const DEFAULT_COL_WIDTH = 180;
/**
 * 列的**硬宽度**（用户 260930：「所有的列都是根据内容长度算的左右宽度，我需要能自由设置」）。
 * `table-layout: auto` 下 `<col style="width">` 只是「**至少**这么宽」——内容更宽就把列撑开（附件 chip 实测 180 → 413）。
 * 所以真正卡住列的是**每个格子的 `max-width`**；它按列写行内，因为宽度来自正文数据（字段 width），CSS 没法按列取值。
 * 配合 `.bt-grid` 的 `white-space: nowrap`：装不下就截断/省略，绝不换行撑高行高。
 */
const columnWidth = (field: BitableField) => (field.width ?? DEFAULT_COL_WIDTH) + "px";

const ROW_HEIGHT_OPTIONS: Array<{ value: BitableRowHeight; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

function rowHeightPx(value: BitableRowHeight | undefined): number {
  if (typeof value === "number") return value;
  if (value === "medium") return 44;
  if (value === "high") return 64;
  if (value === "xhigh") return 96;
  return 36; // 云端「低」档 = 36px（--lt-size-grid-row-height）
}

/** 云端 lakex 的「展开行」图标（lt-icon-RowExpand）：四角向外箭头。 */
function RowExpandIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M481.528 534.22c15.36 15.36 15.616 40.092.78 55.768l-.78.8-236.68 236.68H394.68c21.716 0 39.392 17.304 39.984 38.88l.016 1.12c0 21.712-17.308 39.388-38.88 39.98l-1.12.016H179.428c-39.32 0-71.28-31.52-71.988-70.68l-.012-1.32V624.072c0-22.092 17.908-40 40-40 21.72 0 39.392 17.308 39.984 38.88l.016 1.12v147.676L424.96 534.22c15.62-15.62 40.948-15.62 56.568 0zM846.68 100.072c39.32 0 71.28 31.52 71.988 70.68l.012 1.32v211.392c0 22.092-17.908 40-40 40-21.72 0-39.392-17.308-39.984-38.88l-.016-1.12-.008-147.572L591.02 483.548c-15.62 15.62-40.944 15.62-56.568 0-15.356-15.36-15.616-40.092-.78-55.768l.78-.8L781.36 180.068H631.428c-21.72 0-39.392-17.304-39.984-38.88l-.016-1.12c0-21.712 17.308-39.388 38.88-39.98l1.12-.016H846.68z" />
    </svg>
  );
}

/**
 * 设备本地导航（用户 261006 选 C）：切数据表 / 切视图只写这里（localStorage，按 noteId），**不进正文、不同步**。
 * 正文侧由 `useBitableSession` 恒写默认导航（见 serializeBody）⇒ 换台设备各记各的、也不会把导航带上 S3。
 */
const NAV_KEY_PREFIX = "lake-notes-v3.bitable-nav.";
interface BitableNav { tableId?: string; viewIds?: Record<string, string>; }
function readBitableNav(noteId: string): BitableNav {
  try {
    const raw = localStorage.getItem(NAV_KEY_PREFIX + noteId);
    const parsed = raw ? (JSON.parse(raw) as BitableNav) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function applyBitableNav(doc: BitableDoc, nav: BitableNav): BitableDoc {
  const tables = doc.tables.map((table) => {
    const viewId = nav.viewIds?.[table.id];
    return viewId && table.views.some((view) => view.id === viewId) ? { ...table, activeViewId: viewId } : table;
  });
  const wanted = nav.tableId;
  const activeTableId = wanted && tables.some((t) => t.id === wanted) ? wanted
    : tables.some((t) => t.id === doc.activeTableId) ? doc.activeTableId
    : tables[0]?.id ?? "";
  return { ...doc, tables, activeTableId };
}
function initialDoc(content: string, navNoteId: string | null): BitableDoc {
  const parsed = parseBitableBody(content);
  if (!parsed) {
    const table = createDefaultBitableTable();
    return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables: [table], activeTableId: table.id };
  }
  // 只对「真实编辑器」应用设备本地导航；历史快照预览（chrome=false）保持快照本身。
  return navNoteId ? applyBitableNav(parsed, readBitableNav(navNoteId)) : parsed;
}

function moveItem<T>(items: T[], fromId: string, toId: string, getId: (item: T) => string): T[] {
  const from = items.findIndex((item) => getId(item) === fromId);
  const to = items.findIndex((item) => getId(item) === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function stamp(): string {
  return new Date().toISOString();
}

/** 网格快捷键不能抢弹窗草稿、输入控件或应用共享预览的事件。 */
function isGridShortcut(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (event.isComposing || event.altKey || !root?.isConnected) return false;
  if (document.querySelector('[aria-modal="true"], .image-lightbox, .attachment-preview')) return false;
  const target = event.target instanceof HTMLElement && event.target !== document.body
    ? event.target : document.activeElement;
  if (!target || target === document.body || target === document.documentElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [data-context-menu], .bt-form-shell')) return false;
  return root.contains(target) && Boolean(target.closest(".bt-grid-wrap"));
}

export interface BitableEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** 进入只读时保留先前合法但尚未发布的输入；不写回只读正文。 */
  onPreserveDraft?: (content: string) => void;
  /** 审计 F15：用户一改动立即通知（早于内部 800ms 防抖）。 */
  onDirty?: () => void;
  /** 审计 F15：注册按需同步序列化（关闭/保存/退出时现取）。 */
  onEditorCapture?: (capture: (() => string | null) | null) => void;
  /** 是否显示编辑器外壳（数据表列表 / 视图页签 / 工具条，默认 true）。历史快照预览传 false。 */
  chrome?: boolean;
  /** 文档是否处于「锁定（只读）」态（与 readOnly 区分：readOnly 还包含回收站 / 被他端 purge）。 */
  locked?: boolean;
  /** 切换当前文档锁定（只读）——由外壳注入；不传则不显示「锁定」入口。 */
  onToggleLock?: () => void;
  /** 从本编辑器导出当前数据表 CSV（由外壳注入导出管线）。 */
  onExportCsv?: () => void;
  /** 分屏（261008）：本实例是否为**焦点栏**（决定 data-active；全局唯一）。缺省 = visible（旧行为）。 */
  focused?: boolean;
  /** 分屏里所在栏位（left/right）；未分屏不传。仅用于布局（data-pane）。 */
  pane?: "left" | "right" | null;
}

export function BitableEditor({ noteId, content, visible, readOnly, locked = false, focused, pane, onChange, onPreserveDraft, onDirty, onEditorCapture, onToggleLock, onExportCsv, chrome = true }: BitableEditorProps) {
  const { doc, docRef, updateDoc, navigateDoc, beginGesture, endGesture, undoEdit, redoEdit } = useBitableSession(
    () => initialDoc(content, chrome ? noteId : null), { readOnly, onChange, onPreserveDraft, onDirty, onEditorCapture },
  );
  // C（261006）：导航变化只落 localStorage（不进正文）。`navSig` 只在切表/切视图时变，正文编辑不会触发。
  const navSig = doc.activeTableId + "|" + doc.tables.map((table) => `${table.id}:${table.activeViewId}`).join(",");
  useEffect(() => {
    if (!chrome) return; // 历史快照预览不写，免得把真实文档的导航覆盖成快照里的
    const viewIds: Record<string, string> = {};
    for (const table of doc.tables) viewIds[table.id] = table.activeViewId;
    writeLocalStorage(NAV_KEY_PREFIX + noteId, JSON.stringify({ tableId: doc.activeTableId, viewIds }));
  }, [chrome, noteId, navSig]);

  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /** AI 字段生成（261003）：单格 + 整列；写值走 setBitableCellValue，整批一次撤销（见 hook 文件头）。 */
  const aiGen = useAiFieldGeneration({
    docRef,
    noteId,
    updateDoc,
    beginGesture,
    endGesture,
    isReadOnly: () => readOnlyRef.current,
  });

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [tableSwitchAnchor, setTableSwitchAnchor] = useState<HTMLElement | null>(null);
  const [cellSel, setCellSel] = useState<{ anchor: { recordId: string; fieldId: string }; focus: { recordId: string; fieldId: string } } | null>(null);
  const cellSelectingRef = useRef(false);
  /** 已折叠的分组 key（本机展示态，不进正文）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [tablesWidth, setTablesWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lake-notes-v3.bitable-tables-width"));
    return Number.isFinite(v) && v >= 140 && v <= 420 ? v : 190;
  });
  const [tablesCollapsed, setTablesCollapsed] = useState<boolean>(() => localStorage.getItem("lake-notes-v3.bitable-tables-collapsed") === "1");

  const activeTable = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];
  const activeView = activeTable.views.find((v) => v.id === activeTable.activeViewId) ?? activeTable.views[0];
  const groupRule = activeView.groups?.[0];
  const interactionRef = useRef({ tableId: activeTable.id, viewId: activeView.id, cellSel });
  interactionRef.current = { tableId: activeTable.id, viewId: activeView.id, cellSel };
  /** 关联解析上下文（同一文档的 tables）：表格 / 看板 / 画册 / 日历 / 表单 / 记录详情 / 搜索共用一套。 */
  const displayCtx = useMemo(() => ({ tables: doc.tables }), [doc.tables]);
  const visibleFields = useMemo(() => orderedTableFields(activeTable, activeView), [activeTable, activeView]);
  /** 表格配置面板顺序 = 视图 fieldOrder 应用到全部字段（含隐藏），与网格列顺序 / 关联选择器同源（单一来源）。 */
  const allOrderedFields = useMemo(() => orderedAllTableFields(activeTable, activeView), [activeTable, activeView]);
  /** 动态日期（今天/本周…）的计算时点：切回可见或窗口重新聚焦时刷新，不造后台轮询框架（AR-F7 续）。 */
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setClock(new Date());
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [visible]);
  const viewRecords = useMemo(() => applyViewToRecords(activeTable, activeView), [activeTable, activeView, clock]);
  const shownRecords = useMemo(() => {
    if (!findQuery.trim()) return viewRecords;
    const q = findQuery.trim().toLowerCase();
    // 走统一展示口径：附件不再变 "[object Object]"，布尔/系统时间也能搜到
    return viewRecords.filter((record) => activeTable.fields.some((field) => bitableFieldText(record, field, displayCtx).toLowerCase().includes(q)));
  }, [viewRecords, findQuery, activeTable, displayCtx]);
  const fillProjection = useMemo(
    () => buildBitableFillProjection(activeTable, activeView, shownRecords),
    [activeTable, activeView, shownRecords, clock],
  );
  const fillBackgroundImage = useCallback((recordId: string, fieldId: string) => {
    const tokens = bitableFillBackgroundTokens(fillProjection, recordId, fieldId);
    if (tokens.length === 0) return undefined;
    return tokens
      .map((color) => fillSurfaceColor(color))
      .map((color) => `linear-gradient(${color}, ${color})`)
      .join(", ");
  }, [fillProjection]);
  const rowSideColor = useCallback((recordId: string) => {
    const match = fillProjection.rowSide.get(recordId);
    return match?.color;
  }, [fillProjection]);
  const rowIndexById = useMemo(() => new Map(shownRecords.map((r, i) => [r.id, i] as const)), [shownRecords]);
  const columnIndexById = useMemo(() => new Map(visibleFields.map((f, i) => [f.id, i] as const)), [visibleFields]);
  const rowItems = useMemo(() => {
    /** 单级分组：分组头（含本组记录，供按组统计）/「加进本组」/ 组间间隔 / 记录行。 */
    type RowItem =
      | { kind: "group"; key: string; label: string; fieldId: string; records: BitableRecord[] }
      | { kind: "groupAdd"; key: string; fieldId: string; value: unknown }
      | { kind: "gap"; key: string }
      | { kind: "record"; record: BitableRecord };
    if (!groupRule) return shownRecords.map((record): RowItem => ({ kind: "record", record }));
    const items: RowItem[] = [];
    const groupsForView = groupRecords(activeTable, shownRecords, groupRule);
    groupsForView.forEach((group, index) => {
      items.push({ kind: "group", key: group.key, label: group.label, fieldId: groupRule.fieldId, records: group.records });
      if (!collapsedGroups.has(group.key)) {
        for (const record of group.records) items.push({ kind: "record", record });
        items.push({ kind: "groupAdd", key: "add:" + group.key, fieldId: groupRule.fieldId, value: group.records[0]?.values[groupRule.fieldId] });
      }
      if (index < groupsForView.length - 1) items.push({ kind: "gap", key: "gap:" + group.key });
    });
    return items;
  }, [shownRecords, activeTable, groupRule, collapsedGroups]);
  /** 是否**真的渲染出了分组行**（不是「配了分组规则」）：表底 +、表头下的分组间隙、灰色分组底衬
   *  都以它为准 —— 配了分组但字段已删时会回落成未分组，那时两边都不该出现。 */
  const hasGroupRows = useMemo(() => rowItems.some((item) => item.kind === "group"), [rowItems]);
  const dupValuesByField = useMemo(() => {
    const ids = activeView.highlightDuplicateFieldIds ?? [];
    const map = new Map<string, Set<string>>();
    for (const fieldId of ids) {
      const field = activeTable.fields.find((f) => f.id === fieldId);
      if (field) map.set(fieldId, duplicateValues(field, shownRecords));
    }
    return map;
  }, [activeView.highlightDuplicateFieldIds, activeTable, shownRecords]);
  const isDuplicateCell = (field: BitableField, record: BitableRecord) => {
    const set = dupValuesByField.get(field.id);
    if (!set) return false;
    // 必须走记录级取值：系统时间字段的值不在 record.values 里，直接读会恒为 "" ⇒ 高亮永远失效
    const text = bitableDisplayValue(field, bitableFieldValue(record, field), displayCtx).trim();
    return text !== "" && set.has(text);
  };
  const columnTextColor = (fieldId: string) => (activeView.columnTextColors ?? {})[fieldId];
  const drawerIndex = drawerRecordId ? viewRecords.findIndex((r) => r.id === drawerRecordId) : -1;
  const drawerRecord = drawerIndex >= 0 ? viewRecords[drawerIndex] : null;

  // ---- 变更助手 ----
  const patchTable = useCallback((tableId: string, updater: (table: BitableTable) => BitableTable) => {
    updateDoc((prev) => ({ ...prev, tables: prev.tables.map((t) => (t.id === tableId ? updater(t) : t)) }));
  }, [updateDoc]);
  const patchActiveTable = useCallback((updater: (table: BitableTable) => BitableTable) => {
    const id = docRef.current.activeTableId;
    patchTable(id, updater);
  }, [patchTable]);
  const patchView = useCallback((viewId: string, patch: Partial<BitableView>) => {
    patchActiveTable((table) => ({ ...table, views: table.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) }));
  }, [patchActiveTable]);

  // ---- 视图类型相关（V02 看板 / V03 画册 / V04 日历）----
  /** 非网格视图的「视图配置」入口文案（配置面板实体在 BitableViewConfigPanels.tsx）。 */
  const viewConfigLabel = activeView.type === "kanban" ? "看板配置" : activeView.type === "gallery" ? "画册配置" : activeView.type === "calendar" ? "日历配置" : null;
  /** 网格专属工具（分组 / 行高）只在「确实是网格」「表单」或「回退到网格显示」时出现。 */
  const showGridTools = !isImplementedViewType(activeView.type) || activeView.type === "grid" || activeView.type === "form";
  /** 条件填色只属于表格视图，不扩散到表单/看板/画册/日历。 */
  const showFillTools = activeView.type === "grid";
  /** 看板「新建分组」要往分组字段追加选项。 */
  const kanbanField = kanbanGroupField(activeTable, activeView);
  /** 设置/清除某列的统计口径（视图级配置，不写记录）。 */
  const setColumnStat = (fieldId: string, stat: BitableStatType | null) => {
    const next = { ...(activeView.columnStats ?? {}) };
    if (stat) next[fieldId] = stat; else delete next[fieldId];
    patchView(activeView.id, { columnStats: next });
  };

  /** 日历拖拽落值：开始 + 结束一起平移（一次写多个字段，口径与单元格编辑一致）。 */
  const setRecordValues = useCallback((recordId: string, patch: Record<string, unknown>) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => setBitableRecordValues(prev, tableId, recordId, patch));
  }, [updateDoc]);

  /** 单元格写值（AR02）：字段定位、关联双向镜像与「值未变不写」全部收敛到 core 纯函数。 */
  const setCellValue = useCallback((recordId: string, fieldId: string, value: unknown) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => setBitableCellValue(prev, tableId, recordId, fieldId, value));
  }, [updateDoc]);

  /** 上传 → 附件单元格条目。两个名字必须分开：
   *  - `file`（磁盘名）= 生成名，只在 url 末段；拿它当路径以外的东西都会 404（除图片外全打不开）。
   *  - `name`（展示名）= **用户原始文件名**：`uploadResource` 只回生成的磁盘名（main 侧直接忽略请求名），
   *    早前把 `uploaded.filename` 当展示名 ⇒ 上传后卡片显示成 "1790582685708_03cd9c88.png"（260928 实测抓到）。 */
  const uploadFiles = useCallback(async (files: File[]): Promise<BitableAttachment[]> => {
    const out: BitableAttachment[] = [];
    for (const file of files) {
      const uploaded = await uploadLakeResource(file, noteId);
      out.push({ file: parseLocalAssetUrl(uploaded.url)?.filename ?? uploaded.filename, name: file.name, size: uploaded.size });
    }
    return out;
  }, [noteId]);

  /** 打开附件：走公共入口 openAssetEntry（与文档/小记同一套分流）。磁盘名定位文件、展示名作预览标题。 */
  const openAsset = useCallback((attachment: BitableAttachment) => {
    openBitableAttachment(noteId, attachment);   // 单一来源（表格 / 选择器 / 看板卡片同一句）
  }, [noteId]);

  /** 图片预览：入参永远是**同一个单元格内**的图片（用户 260928：两列图片就是两类，绝不跨列合并）。 */
  const openImages = useCallback((images: BitableAttachment[], index: number) => {
    openImagePreview(images.map((image) => ({ src: bitableAssetUrl(noteId, image.file) })), index);
  }, [noteId]);

  /** 上传成功后回填附件（AR02）：目标 tableId 由调用点捕获，切表/删字段后不再写到「那时的当前表」。 */
  const appendAttachments = useCallback((tableId: string, recordId: string, fieldId: string, entries: BitableAttachment[]) => {
    updateDoc((prev) => appendBitableAttachments(prev, tableId, recordId, fieldId, entries));
  }, [updateDoc]);

  const addOption = useCallback((fieldId: string, name: string, recordId?: string) => {
    patchActiveTable((table) => {
      const field = table.fields.find((f) => f.id === fieldId);
      if (!field) return table;
      const existing = (field.options ?? []).find((o) => o.name === name);
      const option = existing ?? { id: newBitableId("opt"), name, color: BITABLE_OPTION_COLORS[(field.options ?? []).length % BITABLE_OPTION_COLORS.length] };
      const fields = existing ? table.fields : table.fields.map((f) => (f.id === fieldId ? { ...f, options: [...(f.options ?? []), option] } : f));
      let records = table.records;
      if (recordId) {
        records = table.records.map((r) => {
          if (r.id !== recordId) return r;
          const current = r.values[fieldId];
          const next = field.type === "multiSelect"
            ? (() => { const arr = Array.isArray(current) ? (current as string[]) : []; return arr.includes(option.id) ? arr : [...arr, option.id]; })()
            : option.id;
          return { ...r, values: { ...r.values, [fieldId]: next }, updatedAt: stamp() };
        });
      }
      return { ...table, fields, records };
    });
  }, [patchActiveTable]);

  // ---- 表 ----
  const addTable = useCallback(() => {
    updateDoc((prev) => {
      const table = createDefaultBitableTable("数据表 " + (prev.tables.length + 1));
      return { ...prev, tables: [...prev.tables, table], activeTableId: table.id };
    });
  }, [updateDoc]);
  const renameTable = useCallback((id: string, name: string) => {
    patchTable(id, (table) => ({ ...table, name: name.trim() || "数据表" }));
  }, [patchTable]);
  const deleteTable = useCallback((id: string) => {
    updateDoc((prev) => {
      if (prev.tables.length <= 1) return prev;
      const tables = prev.tables.filter((t) => t.id !== id);
      return { ...prev, tables, activeTableId: prev.activeTableId === id ? tables[0].id : prev.activeTableId };
    });
  }, [updateDoc]);
  const reorderTables = useCallback((fromId: string, toId: string) => {
    updateDoc((prev) => ({ ...prev, tables: moveItem(prev.tables, fromId, toId, (t) => t.id) }));
  }, [updateDoc]);
  const reorderViews = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => ({ ...table, views: moveItem(table.views, fromId, toId, (v) => v.id) }));
  }, [patchActiveTable]);

  // ---- 视图 ----
  const addView = useCallback((type: BitableViewType) => {
    patchActiveTable((table) => {
      const view = createBitableView(type);
      // 视图只存投影配置、不复制记录：看板默认取第一个单选字段分栏；
      // 表单**不预选字段** —— formFieldIds 为空 = 未配置，表单视图据此默认进「编辑表单」（用户 260928）。
      if (type === "kanban") {
        const select = table.fields.find((f) => f.type === "select");
        if (select) view.kanbanGroupFieldId = select.id;
      }
      if (type === "gallery") {
        const attachment = table.fields.find((f) => isAttachmentLikeField(f.type));
        if (attachment) view.galleryCoverFieldId = attachment.id;
      }
      if (type === "calendar") {
        const date = table.fields.find((f) => f.type === "date");
        if (date) view.calendarStartFieldId = date.id;
      }
      return { ...table, views: [...table.views, view], activeViewId: view.id };
    });
  }, [patchActiveTable]);
  const deleteView = useCallback((viewId: string) => {
    patchActiveTable((table) => {
      if (table.views.length <= 1) return table;
      const views = table.views.filter((v) => v.id !== viewId);
      return { ...table, views, activeViewId: table.activeViewId === viewId ? views[0].id : table.activeViewId };
    });
    setViewMenu(null);
  }, [patchActiveTable]);
  const copyView = useCallback((viewId: string) => {
    patchActiveTable((table) => {
      const source = table.views.find((v) => v.id === viewId);
      if (!source) return table;
      const view = { ...source, id: newBitableId("vew"), name: source.name + " 副本" };
      return { ...table, views: [...table.views, view], activeViewId: view.id };
    });
    setViewMenu(null);
  }, [patchActiveTable]);
  const setActiveView = useCallback((viewId: string) => {
    navigateDoc((prev) => ({ ...prev, tables: prev.tables.map((table) => table.id === prev.activeTableId ? { ...table, activeViewId: viewId } : table) }));
  }, [navigateDoc]);

  // ---- 字段 ----
  const addField = useCallback((rawType: string) => {
    // 菜单只给已知类型；未知类型（编辑弹窗里保留的）回落到文本，不做静默清空
    const type = (isKnownFieldType(rawType) ? rawType : "text") as BitableFieldType;
    patchActiveTable((table) => ({ ...table, fields: [...table.fields, createBitableField(type)] }));
    setAddFieldAnchor(null);
  }, [patchActiveTable]);
  /** 打开「新增字段」弹窗（记录详情抽屉 / 字段面板共用）。 */
  const openAddField = useCallback(() => setFieldEditor({ fieldId: null }), []);
  const updateField = useCallback((fieldId: string, patch: Partial<BitableField>) => {
    patchActiveTable((table) => {
      const before = table.fields.find((f) => f.id === fieldId);
      const fields = table.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
      const field = fields.find((f) => f.id === fieldId);
      if (!field) return table;
      // 字段重命名 → 同表 AI 字段命令里的 {{旧名}} 跟随改写（「插入字段」的变量保持可用；261003）。
      const nextName = typeof patch.name === "string" ? patch.name : null;
      const oldName = before?.name ?? null;
      const renamed = nextName && oldName && nextName !== oldName
        ? fields.map((f) => renameAiFieldToken(f, oldName, nextName))
        : fields;
      // 类型变更后清掉不再成立的视图引用（AR-F7 续）：只清配置、不迁移记录值。
      const views = table.views.map((view) => stripViewRefsForFieldType(view, field));
      return { ...table, fields: renamed, views };
    });
  }, [patchActiveTable]);
  /** 删除字段（AR02）：解除双向配对 + 清空**全部视图**里指向它的配置，收敛到 core 单一来源。 */
  const deleteField = useCallback((fieldId: string) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => deleteBitableField(prev, tableId, fieldId));
    setColumnMenu(null);
    setFieldEditor(null);
  }, [updateDoc]);
  const duplicateField = useCallback((fieldId: string) => {
    // AR-F7 续：复制关联字段回落为单向、不继承配对（单一来源在 core）。
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => ({ ...prev, tables: duplicateBitableField(prev.tables, tableId, fieldId) }));
    setColumnMenu(null);
  }, [updateDoc]);
  const insertField = useCallback((fieldId: string, side: "before" | "after") => {
    patchActiveTable((table) => {
      const index = table.fields.findIndex((f) => f.id === fieldId);
      if (index < 0) return table;
      const field = createBitableField("text");
      const fields = [...table.fields];
      fields.splice(side === "before" ? index : index + 1, 0, field);
      return { ...table, fields };
    });
    setColumnMenu(null);
  }, [patchActiveTable]);
  /** 列顺序是**视图级配置**（对齐云端）：拖拽只改当前视图的 fieldOrder，不动全局字段顺序。 */
  const reorderVisibleFields = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => {
      const view = table.views.find((v) => v.id === table.activeViewId);
      if (!view) return table;
      const currentIds = orderedTableFields(table, view).map((f) => f.id);
      const reordered = moveItem(currentIds.map((id) => ({ id })), fromId, toId, (x) => x.id).map((x) => x.id);
      const all = table.fields.map((f) => f.id);
      const fieldOrder = [...reordered, ...all.filter((id) => !reordered.includes(id))];
      return { ...table, views: table.views.map((v) => (v.id === view.id ? { ...v, fieldOrder } : v)) };
    });
  }, [patchActiveTable]);
  /** 表格配置面板拖拽排序：改视图 fieldOrder（视图级，网格列顺序跟随），不动全局字段顺序。 */
  const reorderPanelFields = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => {
      const view = table.views.find((v) => v.id === table.activeViewId);
      if (!view) return table;
      // 与网格列顺序 / 关联选择器同源：orderedAllTableFields（不再自己算 rank/sort）
      const current = orderedAllTableFields(table, view).map((f) => f.id);
      const fieldOrder = moveItem(current, fromId, toId, (id) => id);
      return { ...table, views: table.views.map((v) => (v.id === view.id ? { ...v, fieldOrder } : v)) };
    });
  }, [patchActiveTable]);
  const toggleFieldHidden = useCallback((fieldId: string) => {
    patchActiveTable((table) => ({
      ...table,
      views: table.views.map((v) => {
        if (v.id !== table.activeViewId) return v;
        const hidden = v.hiddenFieldIds ?? [];
        return { ...v, hiddenFieldIds: hidden.includes(fieldId) ? hidden.filter((id) => id !== fieldId) : [...hidden, fieldId] };
      }),
    }));
  }, [patchActiveTable]);

  // ---- 记录 ----
  const addRecord = useCallback(() => {
    const record = createBitableRecord();
    // createdAt 传进去：日期字段若配了「添加记录时间」，填的就是这条记录自己的创建日
    updateDoc((prev) => addBitableRecord(prev, prev.activeTableId, { record }).doc);
    return record.id;
  }, [updateDoc]);
  /** 复刻云端：分组下方的圆 + 直接**加进本组**（给新记录预置该分组字段的值；空值组则不写值）。 */
  const addRecordInGroup = useCallback((fieldId: string, value: unknown) => {
    const record = createBitableRecord();
    updateDoc((prev) => addBitableRecord(prev, prev.activeTableId, { record, fieldId, value }).doc);
    return record.id;
  }, [updateDoc]);

  // ---- CSV 导入（D01）----
  /** 选文件 → 解析 → 打开映射对话框（只读会话直接拒绝）。 */
  const startCsvImport = useCallback(async () => {
    if (readOnlyRef.current) return;
    try {
      const picked = await native.pickImportCsv();
      if (!picked) return;
      const parsed = parseCsv(picked.content);
      const header = parsed[0] ?? [];
      setCsvResult(null);
      setCsvImport({ fileName: picked.name, header, rows: parsed.slice(1), mapping: defaultCsvMapping(activeTable, header) });
    } catch (reason) {
      reportNativeActionError("导入 CSV", reason);
    }
  }, [activeTable]);
  /** 确认导入：追加到当前活动表；结果（新增/丢弃/跳过 + 原因）留在对话框里展示，不悄悄吞错。 */
  const confirmCsvImport = useCallback(() => {
    if (!csvImport) return;
    const current = docRef.current;
    const result = importCsvRows(current, activeTable.id, [csvImport.header, ...csvImport.rows], csvImport.mapping, { hasHeader: true });
    if (result.doc !== current) updateDoc(() => result.doc);
    setCsvResult(result);
  }, [csvImport, activeTable.id, updateDoc]);
  const deleteRecords = useCallback((ids: string[]) => {
    const set = new Set(ids);
    patchActiveTable((table) => ({ ...table, records: table.records.filter((r) => !set.has(r.id)) }));
    setSelectedRecordIds(new Set());
    setDrawerRecordId((current) => (current && set.has(current) ? null : current));
  }, [patchActiveTable]);
  const reorderRecords = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => ({ ...table, records: moveItem(table.records, fromId, toId, (r) => r.id) }));
  }, [patchActiveTable]);

  /** 行手柄拖拽排序（指针式，对齐云端：默认只显示行号，hover 出行手柄；手柄按下后按 Y 找落点）。 */
  const startRowDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, recordId: string) => {
    if (readOnlyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    let over: string | null = null;
    setRowDragId(recordId);
    const onMove = (ev: PointerEvent) => {
      const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-record-id]") ?? [])];
      let candidate: string | null = null;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) { candidate = row.dataset.recordId ?? null; break; }
      }
      over = candidate;
      setRowDragOverId(candidate);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (over && over !== recordId) reorderRecords(recordId, over);
      setRowDragId(null);
      setRowDragOverId(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [reorderRecords]);

  /** 列宽拖拽（对齐云端：表头右边缘可拖，写回 field.width 持久化）。 */
  const startColumnResize = useCallback((event: ReactPointerEvent<HTMLElement>, fieldId: string, startW: number) => {
    if (readOnlyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    beginGesture();
    // 下限 80 → **40**（用户 260930：「可以设定一个比较小的下限值」）；上限仍是 640
    const onMove = (ev: PointerEvent) => updateField(fieldId, { width: Math.max(40, Math.min(640, startW + (ev.clientX - startX))) });
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      endGesture();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, [updateField, beginGesture, endGesture]);

  useEffect(() => {
    if (!rowCtx) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setRowCtx(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rowCtx]);

  useEffect(() => { writeLocalStorage("lake-notes-v3.bitable-tables-width", String(tablesWidth)); }, [tablesWidth]);
  useEffect(() => { writeLocalStorage("lake-notes-v3.bitable-tables-collapsed", tablesCollapsed ? "1" : "0"); }, [tablesCollapsed]);

  /** 数据表列表宽度拖拽（对齐钉钉：右边缘可左右调；收起后留一条窄栏）。 */
  const startTablesResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = tablesWidth;
    const onMove = (ev: PointerEvent) => setTablesWidth(Math.min(420, Math.max(140, startW + (ev.clientX - startX))));
    const onUp = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [tablesWidth]);

  // ---- 视图配置：筛选 / 排序 ----
  const filters = activeView.filters ?? [];
  const sorts = activeView.sorts ?? [];
  const setFilters = (next: BitableFilterNode[], operator: BitableFilterJoin = activeView.filterOperator ?? "and") => patchView(
    activeView.id,
    next.length > 0 ? { filters: next, filterOperator: operator } : { filters: undefined, filterOperator: undefined },
  );
  const setSorts = (next: BitableView["sorts"]) => patchView(activeView.id, { sorts: next });
  const setGroup = (next: BitableGroupRule | null) => patchView(activeView.id, { groups: next ? [next] : [] });
  const toggleGroup = (key: string) => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const openDrawer = (recordId: string) => setDrawerRecordId(recordId);
  /** 打开列菜单：列头 ⋯ 按钮与**列头右键**共用（坐标定位，不依赖那个 hover 才显形的按钮）。
   *  坐标原样交给 Popover → usePopoverPosition 去夹取/翻转（这里不再按估算高度预夹）。 */
  const openColumnMenu = (fieldId: string, x: number, y: number, header: HTMLElement | null) => {
    setColumnMenu({ fieldId, x, y, header });
  };
  const stepDrawer = (delta: number) => {
    if (drawerIndex < 0) return;
    const next = viewRecords[(drawerIndex + delta + viewRecords.length) % viewRecords.length];
    if (next) setDrawerRecordId(next.id);
  };

  const gridStyle = { "--bt-row-h": rowHeightPx(activeView.rowHeight) + "px" } as CSSProperties;
  const formDefaults = useMemo(() => defaultRecordValues(activeTable), [activeTable]);

  const cellRange = useMemo(() => {
    if (!cellSel) return null;
    const recIds = shownRecords.map((r) => r.id);
    const fieldIds = visibleFields.map((f) => f.id);
    const r1 = recIds.indexOf(cellSel.anchor.recordId); const r2 = recIds.indexOf(cellSel.focus.recordId);
    const c1 = fieldIds.indexOf(cellSel.anchor.fieldId); const c2 = fieldIds.indexOf(cellSel.focus.fieldId);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
    return { r0: Math.min(r1, r2), r1: Math.max(r1, r2), c0: Math.min(c1, c2), c1: Math.max(c1, c2) };
  }, [cellSel, shownRecords, visibleFields]);
  /**
   * 底部汇总栏**最左那格**的两套文案（用户 260929）：
   * 默认「共 N 条」；**多选时**改显示这一批的选择量（「选择 x 行」/「选择 x 个单元格」）。
   * 单选（单行 / 单格）不触发 —— 那是「当前这一格」而不是「一批」，显示总条数更有用。
   * 放在 cellRange 之后：它是唯一需要等选区归一化后才能算的依赖。
   */
  const selectionSummary = useMemo(() => {
    if (selectedRecordIds.size >= 2) return "选择 " + selectedRecordIds.size + " 行";
    if (cellRange) {
      const count = (cellRange.r1 - cellRange.r0 + 1) * (cellRange.c1 - cellRange.c0 + 1);
      if (count >= 2) return "选择 " + count + " 个单元格";
    }
    return null;
  }, [selectedRecordIds, cellRange]);
  // AR-F5：逐格命中用行/列索引（O(1)），不再每个格子 findIndex 扫全表（原 O(R×C×(R+C))）。
  const cellInSelection = (recordId: string, fieldId: string) => {
    if (!cellRange) return false;
    const ri = rowIndexById.get(recordId);
    const ci = columnIndexById.get(fieldId);
    if (ri === undefined || ci === undefined) return false;
    return ri >= cellRange.r0 && ri <= cellRange.r1 && ci >= cellRange.c0 && ci <= cellRange.c1;
  };
  /** 选中态的**边框**只画在选区外缘（单格 = 一整圈；见 bitableEditor.css 的四边 box-shadow 拼法）。 */
  const selectionEdgeClass = (recordId: string, fieldId: string) => {
    if (!cellRange) return "";
    const ri = rowIndexById.get(recordId);
    const ci = columnIndexById.get(fieldId);
    if (ri === undefined || ci === undefined) return "";
    if (ri < cellRange.r0 || ri > cellRange.r1 || ci < cellRange.c0 || ci > cellRange.c1) return "";
    return (ri === cellRange.r0 ? " sel-top" : "") + (ri === cellRange.r1 ? " sel-bottom" : "")
      + (ci === cellRange.c0 ? " sel-left" : "") + (ci === cellRange.c1 ? " sel-right" : "");
  };
  const copySelection = useCallback(async () => {
    if (!cellRange) return;
    const lines: string[] = [];
    for (let ri = cellRange.r0; ri <= cellRange.r1; ri += 1) {
      const record = shownRecords[ri];
      const cells: string[] = [];
      // 复制所见：屏幕上是 bitableFieldText（系统时间到分钟），直接读 values 会复制出空串
      for (let ci = cellRange.c0; ci <= cellRange.c1; ci += 1) cells.push(bitableFieldText(record, visibleFields[ci], displayCtx));
      lines.push(cells.join("\t"));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); } catch { /* ignore */ }
  }, [cellRange, shownRecords, visibleFields, displayCtx]);
  const pasteSelection = useCallback(async () => {
    if (!cellRange || !visibleRef.current || readOnlyRef.current) return;
    const origin = interactionRef.current;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const current = interactionRef.current;
    if (!rootRef.current?.isConnected || !visibleRef.current || readOnlyRef.current
      || current.tableId !== origin.tableId || current.viewId !== origin.viewId || current.cellSel !== origin.cellSel) return;
    const lines = text.replace(/\r/g, "").split("\n");
    patchActiveTable((table) => {
      const next = table.records.map((r) => ({ ...r, values: { ...r.values } }));
      lines.forEach((line, dr) => {
        const targetId = shownRecords[cellRange.r0 + dr]?.id;
        if (!targetId) return;
        const target = next.find((r) => r.id === targetId);
        if (!target) return;
        line.split("\t").forEach((tok, dc) => {
          const field = visibleFields[cellRange.c0 + dc];
          if (!field || !isKnownFieldType(field.type)) return;
          const t = tok.trim();
          if (t === "" && field.type !== "text") return;
          let value: unknown = t;
          // 数字格只写有限数值：粘贴文本里的非数字（"abc"/"1,2"）不能变成 NaN ——
          // NaN 序列化成 JSON 会变 null（写盘即失真），显示成 "NaN" 也难看
          if (field.type === "number") {
            if (t === "") value = "";
            else {
              const n = Number(t);
              if (!Number.isFinite(n)) return;
              value = n;
            }
          }
          else if (field.type === "select") { const opt = (field.options ?? []).find((o) => o.name === t); if (!opt) return; value = opt.id; }
          else if (field.type === "multiSelect") { value = t.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((n) => (field.options ?? []).find((o) => o.name === n)?.id).filter((x): x is string => !!x); }
          else if (field.type === "link") { value = t; }
          else if (field.type === "rating") { const n = Number(t); if (!Number.isFinite(n)) return; value = Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(n))); }
          else if (field.type === "progress") { const n = Number(t); if (!Number.isFinite(n)) return; value = Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(n))); }
          else if (field.type === "boolean") {
            if (/^(是|true|1|yes|y)$/i.test(t)) value = true;
            else if (/^(否|false|0|no|n)$/i.test(t)) value = false;
            else return;
          }
          else if (field.type !== "text" && field.type !== "date") return;
          target.values = { ...target.values, [field.id]: value };
          target.updatedAt = stamp();
        });
      });
      return { ...table, records: next };
    });
  }, [cellRange, patchActiveTable, shownRecords, visibleFields]);
  useEffect(() => {
    if (!visible || readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !cellRange || !isGridShortcut(event, rootRef.current)) return;
      const el = document.activeElement as HTMLElement | null;
      // 焦点在输入/可编辑区、附件格、或附件展开面板（panel 是 portal，不在单元格 DOM 内）时，
      // 不要拦截 Cmd+C/V——否则 preventDefault 会把原生 paste 事件挡掉，永远收不到粘贴。
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const inAttachment = !!el && typeof el.closest === "function" && !!el.closest(".bt-attachment-cell, .bt-attach-expand");
      const handlesClipboard = typing || inAttachment;
      if (event.key === "c" && !handlesClipboard) { event.preventDefault(); void copySelection(); }
      if (event.key === "v" && !handlesClipboard) { event.preventDefault(); void pasteSelection(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, readOnly, cellRange, copySelection, pasteSelection]);

  /**
   * 底部汇总栏（底栏）是这套表格最底下的一条；文档状态栏要塞进它**正上方**（用户 260929 定稿：
   * 底栏必须是最底下那条，且不能被状态栏压住）。底栏上沿不是常数——它会随「有没有横向滚动条」
   * 上下浮动（滚动条吃掉内容盒高度；多维表列多，几乎总是有），所以在 CSS 里猜高度必然错位。
   * 这里实测一次写进 CSS 变量交给 chrome.css 消费，姿势与 SheetEditor 写 `--lake-sheet-status-w` 一致。
   */
  useEffect(() => {
    if (!visible) return;
    const host = rootRef.current;
    if (!host) return;
    const workspace = host.closest<HTMLElement>(".workspace");
    if (!workspace) return;
    const apply = () => {
      // ⚠️ 必须量**粘性单元格** `.bt-stat-row td`：`<tr>` 是 static，内容纵向溢出时它停在
      // 内容底部（视口外），拿它算会得到负值把状态栏顶出屏幕（260929 用户报「一个表有一个没有」的真根因）。
      // `position: sticky; bottom: 0` 在 td 上，td 的 rect 才是**贴住表格视口底**的那条。
      const bar = host.querySelector<HTMLElement>(".bt-stat-row td") ?? host.querySelector<HTMLElement>(".bt-stat-row");
      if (!bar) { workspace.style.removeProperty("--lake-bitable-status-bottom"); return; }
      const above = Math.round(window.innerHeight - bar.getBoundingClientRect().top) + 2;
      workspace.style.setProperty("--lake-bitable-status-bottom", above + "px");
    };
    apply();
    window.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    const wrap = host.querySelector<HTMLElement>(".bt-grid-wrap");
    const grid = host.querySelector<HTMLElement>(".bt-grid");
    if (wrap) observer.observe(wrap);
    if (grid) observer.observe(grid);
    return () => {
      window.removeEventListener("resize", apply);
      observer.disconnect();
      workspace.style.removeProperty("--lake-bitable-status-bottom");
    };
    // 只在这些结构变化时重建观察：其余变化（列宽/列数/行高/窗口尺寸）由 ResizeObserver + resize 覆盖
  }, [visible, activeTable.id, activeView.id, activeView.type]);

  useEffect(() => {
    if (!visible || readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || !isGridShortcut(event, rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redoEdit(); else undoEdit();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, readOnly, undoEdit, redoEdit]);
  useEffect(() => {
    const onUp = () => { cellSelectingRef.current = false; };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const reorderByDrag = (kind: "field" | "record" | "table", targetId: string) => {
    if (!dragging || dragging.kind !== kind || dragging.id === targetId) return;
    if (kind === "field") reorderVisibleFields(dragging.id, targetId);
    else if (kind === "record") reorderRecords(dragging.id, targetId);
    else reorderTables(dragging.id, targetId);
    setDragging(null);
  };

  const focusCell = (recordId: string, fieldId: string) => {
    const td = rootRef.current?.querySelector<HTMLElement>('td[data-record-id="' + recordId + '"][data-field-id="' + fieldId + '"]');
    const el = td?.querySelector<HTMLElement>("input, textarea, button, [tabindex]");
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const onGridKeyDown = (event: ReactKeyboardEvent) => {
    if (readOnly) return;
    const td = (event.target as HTMLElement).closest("td[data-record-id]") as HTMLElement | null;
    if (!td) return;
    const recordId = td.dataset.recordId ?? "";
    const fieldId = td.dataset.fieldId ?? "";
    const ri = shownRecords.findIndex((r) => r.id === recordId);
    const ci = visibleFields.findIndex((f) => f.id === fieldId);
    if (ri < 0 || ci < 0) return;
    const isTextarea = event.target instanceof HTMLTextAreaElement;
    const move = (dr: number, dc: number) => {
      const nr = ri + dr; const nc = ci + dc;
      if (nr < 0 || nr >= shownRecords.length || nc < 0 || nc >= visibleFields.length) return;
      event.preventDefault();
      setCellSel({ anchor: { recordId: shownRecords[nr].id, fieldId: visibleFields[nc].id }, focus: { recordId: shownRecords[nr].id, fieldId: visibleFields[nc].id } });
      focusCell(shownRecords[nr].id, visibleFields[nc].id);
    };
    if (event.key === "Tab") move(0, event.shiftKey ? -1 : 1);
    else if (event.key === "Enter" && !isTextarea) move(event.shiftKey ? -1 : 1, 0);
    else if (event.key === "Escape") (event.target as HTMLElement).blur();
  };

  const renderRecordRow = (record: BitableRecord, index: number, extraClass = "") => {
    const fillSide = rowSideColor(record.id);
    return (
    <tr key={record.id} data-record-id={record.id}
      className={"bt-row" + (extraClass ? " " + extraClass : "") + (rowDragId === record.id ? " dragging" : "") + (rowDragOverId === record.id && rowDragId !== record.id ? " drag-over" : "") + (selectedRecordIds.has(record.id) ? " selected" : "")}
      data-fill-side={fillSide ? "" : undefined}
      style={fillSide ? ({ "--bt-fill-side": fillSide } as CSSProperties) : undefined}
      onContextMenu={(event) => { if (readOnly) return; event.preventDefault(); setRowCtx({ recordId: record.id, x: event.clientX, y: event.clientY }); }}>
      <td className="bt-td-index">
        <button type="button" className="bt-row-num" title="选择记录" disabled={readOnly}
          onClick={() => setSelectedRecordIds((prev) => { const next = new Set(prev); if (next.has(record.id)) next.delete(record.id); else next.add(record.id); return next; })}>{index + 1}</button>
        <div className="bt-row-handle">
          <button type="button" className="bt-row-grip ln-iconbtn ln-iconbtn--compact" aria-label="拖动排序" title="拖动排序" disabled={readOnly}
            onPointerDown={(event) => startRowDrag(event, record.id)}><GripVertical size={13} /></button>
          <input type="checkbox" className="bt-row-check" aria-label="选择记录" checked={selectedRecordIds.has(record.id)}
            onChange={(event) => setSelectedRecordIds((prev) => { const next = new Set(prev); if (event.target.checked) next.add(record.id); else next.delete(record.id); return next; })} />
          <button type="button" className="bt-row-expander ln-iconbtn ln-iconbtn--compact" aria-label="展开行" title="展开行（Space）"
            onClick={() => openDrawer(record.id)}><RowExpandIcon /></button>
        </div>
      </td>
      {visibleFields.map((field) => {
        const fillBackground = fillBackgroundImage(record.id, field.id);
        return (
        <td key={field.id} data-record-id={record.id} data-field-id={field.id}
          className={"bt-td" + (selectedColumnId === field.id ? " col-selected" : "") + (cellInSelection(record.id, field.id) ? " cell-selected" + selectionEdgeClass(record.id, field.id) : "") + (isDuplicateCell(field, record) ? " in-highlight" : "")}
          style={{ maxWidth: columnWidth(field), ...(fillBackground ? { backgroundImage: fillBackground } : {}), ...(columnTextColor(field.id) ? { color: columnTextColor(field.id) } : {}) }}
          onMouseDown={(event) => {
            if (readOnly || event.button !== 0) return;
            if (event.shiftKey && cellSel) setCellSel({ anchor: cellSel.anchor, focus: { recordId: record.id, fieldId: field.id } });
            else setCellSel({ anchor: { recordId: record.id, fieldId: field.id }, focus: { recordId: record.id, fieldId: field.id } });
            cellSelectingRef.current = true;
          }}
          onMouseOver={() => { if (cellSelectingRef.current && cellSel) setCellSel({ anchor: cellSel.anchor, focus: { recordId: record.id, fieldId: field.id } }); }}>
          <CellEditor
            field={field}
            record={record}
            ctx={displayCtx}
            value={record.values[field.id]}
            readOnly={readOnly}
            aiState={field.type === "ai" ? aiGen.cellStates[aiCellKey(field.id, record.id)] : undefined}
            onAiGenerate={field.type === "ai" ? () => { void aiGen.generateCell(activeTable.id, record.id, field.id); } : undefined}
            onChange={(value) => setCellValue(record.id, field.id, value)}
            onAddOption={(name) => addOption(field.id, name, record.id)}
            noteId={noteId}
            onOpenImages={openImages}
            renderAttachment={(imageOnly) => (
              <AttachmentCell
                noteId={noteId}
                value={record.values[field.id]}
                readOnly={readOnly}
                imageOnly={imageOnly}
                onUpload={(files) => { void uploadFiles(files).then((entries) => appendAttachments(activeTable.id, record.id, field.id, entries)); }}
                onRemove={(file) => setCellValue(record.id, field.id, removeBitableAttachment(record.values[field.id], file))}
                onOpen={openAsset}
                onOpenImages={openImages}
                onReorder={(files) => setCellValue(record.id, field.id, reorderBitableAttachments(record.values[field.id], files))}
                onRename={(file, name) => setCellValue(record.id, field.id, renameBitableAttachment(record.values[field.id], file, name))}
              />
            )}
          />
        </td>
        );
      })}
      <td className="bt-td-empty" />
    </tr>
    );
  };

  return (
    <div
      ref={rootRef}
      className="bitable-editor"
      data-active={(focused ?? visible) ? "true" : undefined}
      data-pane-visible={visible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      {chrome && !tablesCollapsed && (
      <aside className="bt-tables" style={{ width: tablesWidth }}>
        <header className="bt-tables-head">
          <span>数据表</span>
          <div className="bt-tables-head-actions">
            <button type="button" className="bt-icon-btn" title="新建数据表" aria-label="新建数据表" disabled={readOnly} onClick={addTable}><Plus size={14} /></button>
            <button type="button" className="bt-icon-btn" title="收起数据表" aria-label="收起数据表" onClick={() => setTablesCollapsed(true)}><ChevronLeft size={14} /></button>
          </div>
        </header>
        <div className="bt-tables-list">
          {doc.tables.map((table) => (
            <div
              key={table.id}
              className={"bt-table-item" + (table.id === activeTable.id ? " active" : "") + (dragging?.kind === "table" && dragging.id === table.id ? " dragging" : "")}
              draggable={!readOnly}
              onDragStart={() => setDragging({ kind: "table", id: table.id })}
              onDragOver={(event: DragEvent) => { event.preventDefault(); reorderByDrag("table", table.id); }}
              onDragEnd={() => setDragging(null)}
              onClick={() => navigateDoc((prev) => ({ ...prev, activeTableId: table.id }))}
            >
              <GripVertical size={13} className="bt-grip" />
              {tableEditor?.id === table.id
                ? <input autoFocus className="bt-inline-input" value={tableEditor.draft}
                    onChange={(event) => setTableEditor({ id: table.id, draft: event.target.value })}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => { renameTable(table.id, tableEditor.draft); setTableEditor(null); }}
                    onKeyDown={(event) => { if (event.key === "Enter") { renameTable(table.id, tableEditor.draft); setTableEditor(null); } if (event.key === "Escape") setTableEditor(null); }} />
                : <span className="bt-table-name ln-ellipsis">{table.name}</span>}
              <span className="bt-table-count">{table.records.length}</span>
              <button type="button" className="bt-icon-btn bt-table-more" title="重命名/删除" aria-label="数据表操作" disabled={readOnly}
                onClick={(event) => { event.stopPropagation(); setTableEditor({ id: table.id, draft: table.name }); }}><MoreHorizontal size={13} /></button>
              {doc.tables.length > 1 && (
                <button type="button" className="bt-icon-btn bt-table-del" title="删除数据表" aria-label="删除数据表" disabled={readOnly}
                  onClick={(event) => { event.stopPropagation(); deleteTable(table.id); }}><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
        <div className="bt-tables-resize" role="separator" aria-label="调整数据表宽度" onPointerDown={startTablesResize} />
      </aside>
      )}

      <div className="bt-main">
        {chrome && (
          <BitableViewBar
            views={activeTable.views}
            activeViewId={activeView.id}
            readOnly={readOnly}
            leading={tablesCollapsed ? (
              <div className="bt-viewbar-leading">
                <button type="button" className="bt-icon-btn" title="展开数据表列表" aria-label="展开数据表列表" onClick={() => setTablesCollapsed(false)}><ChevronsRight size={15} /></button>
                <button type="button" className="bt-tables-switch" title="切换数据表" onClick={(event) => setTableSwitchAnchor(event.currentTarget)}>
                  <span className="bt-tables-switch-name ln-ellipsis">{activeTable.name}</span><ChevronDown size={13} />
                </button>
              </div>
            ) : undefined}
            onSelect={setActiveView}
            onRenameRequest={setViewEditor}
            onMore={(viewId, anchor) => setViewMenu({ viewId, anchor })}
            onAddView={addView}
            onReorder={reorderViews}
            trailing={(
              <button type="button" className="bt-icon-btn" title="更多" aria-label="更多操作" onClick={(event) => setMoreAnchor(event.currentTarget)}><MoreHorizontal size={15} /></button>
            )}
          />
        )}

        {chrome && <div className="bt-toolbar">
          <button type="button" className={"bt-tool-btn" + (panel === "fields" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "fields" ? null : "fields"); }}>
            <Settings2 size={14} />表格配置
          </button>
          {viewConfigLabel && (
            <button type="button" className={"bt-tool-btn" + (panel === "viewConfig" ? " is-active" : "")}
              onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "viewConfig" ? null : "viewConfig"); }}>
              <ViewTypeIcon type={activeView.type} size={14} />{viewConfigLabel}
            </button>
          )}
          <button type="button" className={"bt-tool-btn" + (panel === "filter" ? " is-active" : "")}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
              if (panel === "filter") { setPanel(null); return; }
              setPanel("filter");
            }}>
            <ListFilter size={14} />筛选{bitableFilterRuleCount(filters) > 0 && <span className="bt-badge">{bitableFilterRuleCount(filters)}</span>}
          </button>
          {showGridTools && (
            <button type="button" className={"bt-tool-btn" + (panel === "group" ? " is-active" : "")}
              onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "group" ? null : "group"); }}>
              <Rows2 size={14} />分组{groupRule && <span className="bt-badge">1</span>}
            </button>
          )}
          <button type="button" className={"bt-tool-btn" + (panel === "sort" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "sort" ? null : "sort"); }}>
            <ArrowUpDown size={14} />排序{sorts.length > 0 && <span className="bt-badge">{sorts.length}</span>}
          </button>
          {showGridTools && (
            <button type="button" className={"bt-tool-btn" + (panel === "rowHeight" ? " is-active" : "")}
              onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "rowHeight" ? null : "rowHeight"); }}>
              <Rows3 size={14} />行高
            </button>
          )}
          {showFillTools && (
            <button type="button" className={"bt-tool-btn" + (panel === "fill" ? " is-active" : "")}
              onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "fill" ? null : "fill"); }}>
              <PaintBucket size={14} />填色{(activeView.fillRules?.length ?? 0) > 0 && <span className="bt-badge">{activeView.fillRules!.length}</span>}
            </button>
          )}
          <button type="button" className="bt-tool-btn" disabled={readOnly} onClick={() => { void startCsvImport(); }}>
            <FileUp size={14} />导入 CSV
          </button>
          {findOpen && (
            <div className="bt-find">
              <input autoFocus value={findQuery} placeholder="在记录中查找" onChange={(event) => setFindQuery(event.target.value)} />
              <span className="bt-find-count">{shownRecords.length} 条</span>
              <button type="button" className="bt-icon-btn" aria-label="关闭查找" onClick={() => { setFindQuery(""); setFindOpen(false); }}><X size={13} /></button>
            </div>
          )}
          <div className="bt-toolbar-spacer" />
          <button type="button" className="bt-tool-btn bt-add-record" disabled={readOnly} onClick={() => addRecord()}><Plus size={14} />添加记录</button>
        </div>}

        {/* 多维表右上角菜单（用户 260930）：搜索 / 导出 CSV / 锁定（只读）。与 lake 文档的右上角菜单同义。 */}
        {chrome && (
          <Popover open={Boolean(moreAnchor)} anchor={moreAnchor} onClose={() => setMoreAnchor(null)} width={200}>
            <div className="bt-panel">
              <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { setFindOpen(true); setMoreAnchor(null); }}>
                <Search size={14} />搜索
              </button>
              {onExportCsv && (
                <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { setMoreAnchor(null); onExportCsv(); }}>
                  <Download size={14} />导出为 CSV
                </button>
              )}
              {onToggleLock && (
                <>
                  <div className="context-menu-sep" />
                  <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { setMoreAnchor(null); onToggleLock(); }}>
                    {locked ? <LockOpen size={14} /> : <Lock size={14} />}{locked ? "解锁当前文档" : "锁定当前文档（只读）"}
                  </button>
                </>
              )}
            </div>
          </Popover>
        )}

        {/* 本版本还没实现正文渲染的视图类型（gallery/calendar 及未来未知类型）：明确提示 + 表格正文，绝不白屏、不改数据 */}
        {!isImplementedViewType(activeView.type) && <BitableViewFallback view={activeView} />}

        {activeView.type === "form" ? (
          <BitableFormView
            noteId={noteId}
            ctx={displayCtx}
            table={activeTable}
            view={activeView}
            readOnly={readOnly}
            onUpdateView={(patch) => patchView(activeView.id, patch)}
            onSubmit={(values) => {
              // AR-F7 续：表单草稿里的双向关联也要镜像到目标表（走 core 唯一入口）。
              updateDoc((prev) => ({ ...prev, tables: addBitableRecordWithValues(prev.tables, prev.activeTableId, values).tables }));
            }}
            defaults={formDefaults}
            onUploadFiles={uploadFiles}
            onAddFieldOption={(fieldId, option) => patchActiveTable((table) => ({ ...table, fields: table.fields.map((f) => (f.id === fieldId ? { ...f, options: [...(f.options ?? []), option] } : f)) }))}
            onOpenAsset={openAsset}
            onOpenImages={openImages}
          />
        ) : activeView.type === "kanban" ? (
          <BitableKanbanView
            noteId={noteId}
            ctx={displayCtx}
            table={activeTable}
            view={activeView}
            records={shownRecords}
            readOnly={readOnly}
            onSetValue={setCellValue}
            onOpenRecord={openDrawer}
            onAddGroupOption={(name) => { if (kanbanField) addOption(kanbanField.id, name); }}
            onOpenImages={openImages}
          />
        ) : activeView.type === "gallery" ? (
          <BitableGalleryView noteId={noteId} table={activeTable} view={activeView} records={shownRecords} onOpenRecord={openDrawer} onOpenImages={openImages} ctx={displayCtx} />
        ) : activeView.type === "calendar" ? (
          <BitableCalendarView table={activeTable} view={activeView} records={shownRecords} readOnly={readOnly}
            onOpenRecord={openDrawer} onSetValues={setRecordValues} ctx={displayCtx} />
        ) : (
          <div className="bt-grid-wrap" style={gridStyle} onKeyDown={onGridKeyDown}
            /* 列选中：只要按下的地方不在「被选中列」的格/表头里，就清掉（否则高亮会残留） */
            onMouseDownCapture={(event) => {
              if (!selectedColumnId) return;
              const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-field-id]");
              if (hit?.dataset.fieldId !== selectedColumnId) setSelectedColumnId(null);
            }}>
            <table className="bt-grid">
              <colgroup>
                <col className="bt-col-index" />
                {visibleFields.map((field) => <col key={field.id} style={{ width: (field.width ?? DEFAULT_COL_WIDTH) + "px" }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="bt-th-index">
                    <input type="checkbox" aria-label="全选记录"
                      checked={shownRecords.length > 0 && shownRecords.every((r) => selectedRecordIds.has(r.id))}
                      onChange={(event) => setSelectedRecordIds(event.target.checked ? new Set(shownRecords.map((r) => r.id)) : new Set())} />
                  </th>
                  {visibleFields.map((field) => (
                    <th key={field.id}
                      data-field-id={field.id}
                      className={"bt-th" + (dragging?.kind === "field" && dragging.id === field.id ? " dragging" : "") + (selectedColumnId === field.id ? " col-selected" : "")}
                      style={{ maxWidth: columnWidth(field) }}
                      draggable={!readOnly}
                      onDragStart={() => setDragging({ kind: "field", id: field.id })}
                      onDragOver={(event: DragEvent) => { event.preventDefault(); reorderByDrag("field", field.id); }}
                      onDragEnd={() => setDragging(null)}
                      onContextMenu={(event) => {
                        // 列头右键 = 列菜单（对齐云端）；列菜单里已有「编辑列/复制列/插入/删除…」
                        if (readOnly) return;
                        event.preventDefault();
                        openColumnMenu(field.id, event.clientX, event.clientY, event.currentTarget);
                      }}>
                      <span className="bt-th-inner" role="button" title="点击选择整列" onClick={() => {
                        const next = selectedColumnId === field.id ? null : field.id;
                        setSelectedColumnId(next);
                        if (next && shownRecords.length > 0) setCellSel({ anchor: { recordId: shownRecords[0].id, fieldId: next }, focus: { recordId: shownRecords[shownRecords.length - 1].id, fieldId: next } });
                        else if (!next) setCellSel(null);
                      }}>
                        <FieldTypeIcon type={field.type} />
                        <span className="bt-th-name" title={field.name}>{field.name}</span>
                        {field.required && <em className="bt-required">*</em>}
                        <button type="button" className="bt-th-more ln-iconbtn ln-iconbtn--compact" title="列操作" aria-label="列操作" disabled={readOnly}
                          onClick={(event) => {
                            event.stopPropagation();
                            const r = event.currentTarget.getBoundingClientRect();
                            openColumnMenu(field.id, r.left, r.bottom + 4, event.currentTarget.closest<HTMLElement>("th"));
                          }}><ChevronDown size={12} /></button>
                        <span className="bt-col-resize" onPointerDown={(event) => startColumnResize(event, field.id, field.width ?? DEFAULT_COL_WIDTH)} onClick={(event) => event.stopPropagation()} title="拖动调整列宽" />
                      </span>
                    </th>
                  ))}
                  <th className="bt-th-add">
                    <button type="button" className="bt-add-round" title="新增字段" aria-label="新增字段" disabled={readOnly}
                      onClick={(event) => setAddFieldAnchor(event.currentTarget)}><Plus size={14} /></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* 表头与第一个分组之间的间隙（260929 用户：分组之后第一行要和表头分开，表示这是独立的一组）。
                    云端口径 = 表头下留 20px，且这一段属于**分组底衬**（极浅灰），所以一眼能看出表格从这里开始分组。 */}
                {hasGroupRows && <tr className="bt-group-head-gap" aria-hidden="true"><td colSpan={visibleFields.length + 2} /></tr>}
                {rowItems.map((item, itemIndex) => {
                  if (item.kind === "group") {
                    /** 首列统计 = 默认「记录总数」（云端口径：只有第一列有默认汇总，其余默认不展示）。 */
                    const headField = visibleFields[0];
                    return (
                      <tr key={"g:" + item.key} className={"bt-group-row bt-group-start" + (collapsedGroups.has(item.key) ? " bt-group-end" : "")} onClick={() => toggleGroup(item.key)}>
                        {/* 复刻云端：分组值与其**右侧首列统计**同处一格（index + 首列）——
                            分组值优先占位（过长省略）；统计压成**固定长度**，于是两者都不会再挤到列边界外（图 1 的错位根因）。 */}
                        <td className="bt-group-cell" colSpan={headField ? 2 : 1}>
                          {/* 内层绝对定位：分组值/统计不参与列宽计算，列宽只由表头与记录行决定 */}
                          <div className="bt-group-inner">
                            <span className="bt-group-fold">
                              <ChevronRight size={13} className={"bt-group-caret" + (collapsedGroups.has(item.key) ? "" : " is-open")} />
                            </span>
                            <span className="bt-group-label" title={item.label}>{item.label}</span>
                            {headField && (
                              <span className="bt-group-head-stat">
                                <StatCell field={headField} records={item.records} readOnly={readOnly}
                                  /* 不兜底成「记录总数」（用户 260929）：汇总项展示什么**完全由汇总方式决定**，
                                     「无统计」就是什么也不展示（只留 hover 才显形的「统计」占位入口）。 */
                                  stat={statForField(activeView, headField.id)}
                                  onPick={(anchor) => setStatFor({ fieldId: headField.id, anchor })} />
                              </span>
                            )}
                          </div>
                        </td>
                        {/* 其余列仍按列显示**本组**的统计 */}
                        {visibleFields.slice(1).map((field) => (
                          <td key={field.id} className="bt-group-stat" style={{ maxWidth: columnWidth(field) }}>
                            <StatCell field={field} records={item.records} stat={statForField(activeView, field.id)} readOnly={readOnly}
                              onPick={(anchor) => setStatFor({ fieldId: field.id, anchor })} />
                          </td>
                        ))}
                        <td className="bt-group-stat" />
                      </tr>
                    );
                  }
                  if (item.kind === "groupAdd") {
                    return (
                      /* 「加进本组」这一行属于**分组底衬**（灰），不再是卡片的一部分：
                         卡片的收口（下边框 + 圆角）落在该组最后一条记录行上（见下面的 bt-group-end）。 */
                      <tr key={"ga:" + item.key} className="bt-group-add-row">
                        {/* + 独占**编号列**那一格：与行号同一条竖线（用户 260929：「＋号居中，放在编号的正下方」） */}
                        <td className="bt-add-index">
                          <button type="button" className="bt-add-round" title="加进本组" aria-label="加进本组" disabled={readOnly}
                            onClick={() => addRecordInGroup(item.fieldId, item.value)}><Plus size={14} /></button>
                        </td>
                        <td colSpan={visibleFields.length + 1} />
                      </tr>
                    );
                  }
                  if (item.kind === "gap") return <tr key={"gap:" + item.key} className="bt-group-gap"><td colSpan={visibleFields.length + 2} /></tr>;
                  /** 该组最后一条记录 = 卡片的收口行（与云端一致：卡片 = 分组头 + 记录，加号区在卡外） */
                  const groupTail = rowItems[itemIndex + 1]?.kind === "groupAdd";
                  return renderRecordRow(item.record, rowIndexById.get(item.record.id) ?? 0, "bt-group-body" + (groupTail ? " bt-group-end" : ""));
                })}

                {/* 已分组时**不再出表底这个 +**（每个分组各有自己的 + 就够了）；未分组/分组字段失效时保留 */}
                {!hasGroupRows && (
                  <tr className="bt-add-row">
                    {/* 同一条口径：表底这个 + 也落在编号列正下方 */}
                    <td className="bt-add-index">
                      <button type="button" className="bt-add-round" title="添加记录" aria-label="添加记录" disabled={readOnly} onClick={() => addRecord()}><Plus size={14} /></button>
                    </td>
                    <td colSpan={visibleFields.length + 1} />
                  </tr>
                )}
                {/* 撑满一屏的占位行：内容不够高时把 tfoot 顶到视图最底部，底部汇总栏才是「常驻」的 */}
                <tr className="bt-grid-filler" aria-hidden="true"><td colSpan={visibleFields.length + 2} /></tr>
              </tbody>
              {/* T01 列级统计：口径 = 当前视图筛选后的记录（排序不影响），配置存视图、值现算。
                  260929 用户定稿：**常驻**（不按有无配置条件渲染），贴底那条做薄，首格缺省显示总记录数，
                  未配置的列显示 `—` ⇒ 既常驻又不会是一条无信息量的空灰条。 */}
              <tfoot>
                <tr className="bt-stat-row">
                  <td className={"bt-stat-index" + (selectionSummary ? " is-selection" : "")}>
                    {/* 左下角 = **当前视图正在展示的记录数**（用户 260929 明确定义）：
                        独立的展示逻辑，不参与任何汇总计算，只随「筛选/搜索」变；多选时整格改显示选择量。
                        注意它与汇总项里的「记录总数」不同：后者是按列/按组**实时计算**的统计值。 */}
                    {selectionSummary ?? statDisplayText("count", String(shownRecords.length))}
                  </td>
                  {visibleFields.map((field) => (
                    <td key={field.id} className="bt-stat-cell" style={{ maxWidth: columnWidth(field) }}>
                      <StatCell field={field} records={shownRecords} stat={statForField(activeView, field.id)} readOnly={readOnly}
                        onPick={(anchor) => setStatFor({ fieldId: field.id, anchor })} />
                    </td>
                  ))}
                  <td className="bt-stat-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Popover open={panel === "fields"} anchor={menuAnchor} onClose={() => setPanel(null)} width={280}>
        <div className="bt-panel">
          <h4>字段</h4>
          {allOrderedFields.map((field) => {
            const hidden = (activeView.hiddenFieldIds ?? []).includes(field.id);
            return (
              <div key={field.id} className="bt-field-row" draggable={!readOnly}
                onDragStart={() => setConfigDragId(field.id)}
                onDragOver={(event) => { event.preventDefault(); if (configDragId && configDragId !== field.id) reorderPanelFields(configDragId, field.id); }}
                onDragEnd={() => setConfigDragId(null)}>
                <GripVertical size={13} className="bt-grip" />
                <FieldTypeIcon type={field.type} />
                <span className="bt-field-name ln-ellipsis">{field.name}</span>
                <button type="button" className="bt-icon-btn" title={hidden ? "显示字段" : "隐藏字段"} aria-label={hidden ? "显示字段" : "隐藏字段"} onClick={() => toggleFieldHidden(field.id)}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <button type="button" className="bt-icon-btn" title="编辑字段" aria-label="编辑字段" disabled={readOnly} onClick={() => setFieldEditor({ fieldId: field.id })}><Pencil size={13} /></button>
              </div>
            );
          })}
          <button type="button" className="bt-panel-add" disabled={readOnly} onClick={(event) => setAddFieldAnchor(event.currentTarget)}><Plus size={14} />新增字段</button>
        </div>
      </Popover>

      <Popover open={panel === "filter"} anchor={menuAnchor} onClose={() => setPanel(null)} width={filters.length > 0 ? 820 : 320}>
        <div className="bt-filter-panel">
          <BitableFilterEditor
            fields={activeTable.fields}
            filters={filters}
            operator={activeView.filterOperator ?? "and"}
            readOnly={readOnly}
            ctx={displayCtx}
            onChange={(next, operator) => setFilters(next, operator)}
            onClear={() => setFilters([], "and")}
          />
        </div>
      </Popover>

      <Popover open={panel === "fill"} anchor={menuAnchor} onClose={() => setPanel(null)} width={820}>
        <BitableFillEditor
          fields={activeTable.fields}
          rules={activeView.fillRules ?? []}
          ctx={displayCtx}
          readOnly={readOnly}
          onChange={(fillRules) => patchView(activeView.id, { fillRules: fillRules.length > 0 ? fillRules : undefined })}
        />
      </Popover>

      <Popover open={panel === "sort"} anchor={menuAnchor} onClose={() => setPanel(null)} width={360}>
        <div className="bt-panel">
          <h4>排序</h4>
          {sorts.map((rule, index) => (
            <div key={index} className="bt-rule-row">
              <SelectMenu value={rule.fieldId} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? changeSortField(activeTable.fields, r, value) : r)))}
                options={activeTable.fields.map((f) => ({ value: f.id, label: f.name }))} />
              {(() => {
                const field = activeTable.fields.find((f) => f.id === rule.fieldId) ?? activeTable.fields[0];
                return (
                  <SelectMenu value={sortModeOf(rule)} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? applySortMode(r, value as BitableSortMode) : r)))}
                    options={sortModesForField(field).map((mode) => ({ value: mode, label: sortModeLabel(field, mode) }))} />
                );
              })()}
              <button type="button" className="bt-icon-btn" title="删除排序" aria-label="删除排序" onClick={() => setSorts(sorts.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" className="bt-panel-add" disabled={readOnly || activeTable.fields.length === 0}
            onClick={() => setSorts([...sorts, { fieldId: activeTable.fields[0].id, desc: false }])}><Plus size={14} />添加排序</button>
        </div>
      </Popover>

      <Popover open={panel === "group"} anchor={menuAnchor} onClose={() => setPanel(null)} width={360}>
        <div className="bt-panel">
          <h4>分组</h4>
          {groupRule ? (
            <div className="bt-rule-row">
              <SelectMenu value={groupRule.fieldId} disabled={readOnly}
                onChange={(value) => setGroup({ ...groupRule, fieldId: value })}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
              <SelectMenu value={groupRule.desc ? "desc" : "asc"} disabled={readOnly}
                onChange={(value) => setGroup({ fieldId: groupRule.fieldId, desc: value === "desc" })}
                options={[{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }]} />
              {/* 删除按钮在**行尾**、Trash2 图标 —— 与「筛选 / 排序」的规则行同一套（用户 260929：
                  样式必须一致；原先是行首的 ✕，与另外两个面板不是一套）。 */}
              <button type="button" className="bt-icon-btn" title="删除分组" aria-label="删除分组" disabled={readOnly}
                onClick={() => { setGroup(null); setCollapsedGroups(new Set()); }}><Trash2 size={13} /></button>
            </div>
          ) : (
            <div className="bt-rule-row">
              <SelectMenu value="" placeholder="选择一列进行分组" disabled={readOnly}
                onChange={(value) => setGroup({ fieldId: value, desc: false })}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
            </div>
          )}
        </div>
      </Popover>

      <Popover open={panel === "rowHeight"} anchor={menuAnchor} onClose={() => setPanel(null)} width={220}>
        <div className="bt-panel">
          <h4>行高</h4>
          {ROW_HEIGHT_OPTIONS.map((option) => (
            <button key={String(option.value)} type="button" className={"bt-menu-item ln-menu__item" + (activeView.rowHeight === option.value ? " is-selected" : "")}
              onClick={() => { patchView(activeView.id, { rowHeight: option.value }); setPanel(null); }}>
              {option.value === "low" ? <Rows2 size={14} /> : option.value === "medium" ? <Rows3 size={14} /> : <Rows4 size={14} />}
              <span className="bt-menu-label ln-ellipsis">{option.label}</span>
              {activeView.rowHeight === option.value && <Check size={14} />}
            </button>
          ))}
        </div>
      </Popover>

      {/* 视图配置浮层：内容按当前视图类型选面板（三类面板都在 BitableViewConfigPanels.tsx） */}
      <Popover open={panel === "viewConfig"} anchor={menuAnchor} onClose={() => setPanel(null)} width={340}>
        <div className="bt-panel">
          {activeView.type === "kanban" && <KanbanConfigPanel table={activeTable} view={activeView} readOnly={readOnly} onPatch={(patch) => patchView(activeView.id, patch)} />}
          {activeView.type === "gallery" && <GalleryConfigPanel table={activeTable} view={activeView} readOnly={readOnly} onPatch={(patch) => patchView(activeView.id, patch)} />}
          {activeView.type === "calendar" && <CalendarConfigPanel table={activeTable} view={activeView} readOnly={readOnly} onPatch={(patch) => patchView(activeView.id, patch)} />}
        </div>
      </Popover>

      <Popover open={Boolean(addFieldAnchor)} anchor={addFieldAnchor} onClose={() => setAddFieldAnchor(null)} width={300}>
        <div className="bt-panel">
          <h4>字段类型</h4>
          <FieldTypeGrid onPick={addField} />
        </div>
      </Popover>

      <Popover open={Boolean(columnMenu)} anchor={null} at={columnMenu ? { x: columnMenu.x, y: columnMenu.y } : null}
        onClose={() => setColumnMenu(null)} width={200}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (columnMenu) setFieldEditor({ fieldId: columnMenu.fieldId }); setColumnMenu(null); }}><Pencil size={13} />编辑列</button>
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (columnMenu) duplicateField(columnMenu.fieldId); }}><Copy size={13} />复制列</button>
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (columnMenu) toggleFieldHidden(columnMenu.fieldId); setColumnMenu(null); }}><EyeOff size={13} />隐藏列</button>
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "before"); }}><ChevronRight size={13} />向左插入列</button>
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "after"); }}><ChevronRight size={13} />向右插入列</button>
          {/* 260928 用户：「本列分组 / 本列筛选 / 升序 / 降序」四条快捷项**彻底删除**
              （顶部工具栏已经有分组、筛选、排序，不必在列菜单里再来一套） */}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            const on = (activeView.highlightDuplicateFieldIds ?? []).includes(fieldId);
            return (
              <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => {
                const current = activeView.highlightDuplicateFieldIds ?? [];
                patchView(activeView.id, { highlightDuplicateFieldIds: on ? current.filter((id) => id !== fieldId) : [...current, fieldId] });
                setColumnMenu(null);
              }}>{on ? "取消高亮重复值" : "高亮重复值"}</button>
            );
          })()}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            const anchor = columnMenu.header;
            return (
              <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (anchor) setStatFor({ fieldId, anchor }); setColumnMenu(null); }}>统计</button>
            );
          })()}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            return (
              <button type="button" className={"bt-menu-item ln-menu__item" + (textColorFor?.fieldId === fieldId ? " is-selected" : "")} disabled={readOnly}
                aria-haspopup="dialog" aria-expanded={textColorFor?.fieldId === fieldId}
                onClick={(event) => setTextColorFor((current) => current?.fieldId === fieldId ? null : { fieldId, anchor: event.currentTarget })}>
                <span className="bt-menu-label ln-ellipsis">文本颜色</span><ChevronRight size={14} />
              </button>
            );
          })()}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            const field = activeTable.fields.find((item) => item.id === fieldId);
            if (!field || field.type !== "ai") return null;
            return (
              <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly}
                onClick={() => { setAiGenerateFieldId(fieldId); setColumnMenu(null); }}>
                <Sparkles size={13} />AI 生成整列
              </button>
            );
          })()}
          <button type="button" className="bt-menu-item ln-menu__item ln-menu__item--danger" disabled={readOnly || activeTable.fields.length <= 1} onClick={() => { if (columnMenu) deleteField(columnMenu.fieldId); }}><Trash2 size={13} />删除列</button>
        </div>
      </Popover>

      {textColorFor && columnMenu && (
        <ColorPalette anchor={textColorFor.anchor} value={(activeView.columnTextColors ?? {})[textColorFor.fieldId]} recentKey="bitable-column-text" side="right" closeOnPick={false}
          defaultLabel="默认色" defaultKind="text"
          onPick={(color) => patchView(activeView.id, { columnTextColors: { ...(activeView.columnTextColors ?? {}), [textColorFor.fieldId]: color } })}
          onDefault={() => patchView(activeView.id, { columnTextColors: Object.fromEntries(Object.entries(activeView.columnTextColors ?? {}).filter(([id]) => id !== textColorFor.fieldId)) })}
          onClose={() => setTextColorFor(null)} />
      )}

      {statFor && (() => {
        const field = activeTable.fields.find((item) => item.id === statFor.fieldId);
        if (!field) return null;
        const current = statForField(activeView, field.id);
        return (
          <Popover open anchor={statFor.anchor} onClose={() => setStatFor(null)} width={200}>
            <div className="bt-panel">
              <h4>列统计 · {field.name}</h4>
              <button type="button" className={"bt-menu-item ln-menu__item" + (current ? "" : " is-selected")} disabled={readOnly}
                onClick={() => { setColumnStat(field.id, null); setStatFor(null); }}><span className="bt-menu-label ln-ellipsis">无统计</span>{!current && <Check size={14} />}</button>
              {statsForField(field).map((stat) => (
                <button key={stat} type="button" className={"bt-menu-item ln-menu__item" + (current === stat ? " is-selected" : "")} disabled={readOnly}
                  onClick={() => { setColumnStat(field.id, stat); setStatFor(null); }}>
                  <span className="bt-menu-label ln-ellipsis">{BITABLE_STAT_LABEL[stat]}</span>{current === stat && <Check size={14} />}
                </button>
              ))}
            </div>
          </Popover>
        );
      })()}

      <Popover open={Boolean(viewMenu)} anchor={viewMenu?.anchor ?? null} onClose={() => setViewMenu(null)} width={180}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (viewMenu) setViewEditor(viewMenu.viewId); setViewMenu(null); }}><Pencil size={13} />重命名视图</button>
          <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => { if (viewMenu) copyView(viewMenu.viewId); }}><Copy size={13} />复制视图</button>
          <button type="button" className="bt-menu-item ln-menu__item ln-menu__item--danger" disabled={readOnly || activeTable.views.length <= 1} onClick={() => { if (viewMenu) deleteView(viewMenu.viewId); }}><Trash2 size={13} />删除视图</button>
        </div>
      </Popover>

      <Popover open={Boolean(tableSwitchAnchor)} anchor={tableSwitchAnchor} onClose={() => setTableSwitchAnchor(null)} width={200}>
        <div className="bt-panel">
          {doc.tables.map((table) => (
            <button key={table.id} type="button" className={"bt-menu-item ln-menu__item" + (table.id === activeTable.id ? " is-selected" : "")}
              onClick={() => { navigateDoc((prev) => ({ ...prev, activeTableId: table.id })); setTableSwitchAnchor(null); }}>
              {table.name}
            </button>
          ))}
        </div>
      </Popover>

      {fieldEditor && (
        <FieldEditorModal
          field={fieldEditor.fieldId ? activeTable.fields.find((f) => f.id === fieldEditor.fieldId) ?? null : null}
          readOnly={readOnly}
          tables={doc.tables}
          tableId={activeTable.id}
          onClose={() => setFieldEditor(null)}
          onSave={(patch, options) => {
            const fieldId = fieldEditor.fieldId;
            if (fieldId) {
              const before = activeTable.fields.find((f) => f.id === fieldId);
              const wasPaired = typeof before?.relation?.pairedFieldId === "string";
              const wantsPair = patch.type === "relationTwoWay";
              updateField(fieldId, options ? { ...patch, options } : patch);
              // 双向开关：新建配对（在目标表生成反向字段）或解除配对（对侧降级为单向、数据保留）
              if (wantsPair && !wasPaired) updateDoc((prev) => ({ ...prev, tables: createRelationPair(prev.tables, prev.activeTableId, fieldId) }));
              else if (!wantsPair && wasPaired) updateDoc((prev) => ({ ...prev, tables: unpairRelationFields(prev.tables, prev.activeTableId, fieldId) }));
            }
            setFieldEditor(null);
          }}
          onDelete={() => { if (fieldEditor.fieldId) deleteField(fieldEditor.fieldId); }}
          onAddField={(patch) => {
            const field = createBitableField(patch.type as BitableFieldType, patch.name);
            field.required = patch.required;
            if (patch.options) field.options = patch.options;
            if (patch.defaultValue !== undefined) field.defaultValue = patch.defaultValue;
            if (patch.dateAutoFill) field.dateAutoFill = true;
            if (patch.progressColor) field.progressColor = patch.progressColor;
            if (patch.relation) field.relation = patch.relation;
            if (patch.ai) field.ai = patch.ai;
            patchActiveTable((table) => ({ ...table, fields: [...table.fields, field] }));
            // 新增即双向 → 立刻在目标表建反向字段并回填已有引用
            if (patch.type === "relationTwoWay") updateDoc((prev) => ({ ...prev, tables: createRelationPair(prev.tables, prev.activeTableId, field.id) }));
            setFieldEditor(null);
          }}
        />
      )}

      {aiGenerateFieldId && (() => {
        const field = activeTable.fields.find((item) => item.id === aiGenerateFieldId);
        if (!field) return null;
        const batchForField = aiGen.batch && aiGen.batch.fieldId === field.id ? aiGen.batch : null;
        return (
          <BitableAiGenerateDialog
            open
            field={field}
            table={activeTable}
            batch={batchForField}
            onStart={(mode: AiGenerateMode) => {
              const ids = activeTable.records
                .filter((record) => mode === "all" || isAiCellEmpty(record.values[field.id]))
                .map((record) => record.id);
              void aiGen.runBatch(activeTable.id, field.id, ids);
            }}
            onCancelRun={() => aiGen.cancelBatch()}
            onRetryFailed={() => aiGen.retryFailed()}
            onClose={() => { aiGen.clearBatch(); setAiGenerateFieldId(null); }}
          />
        );
      })()}

      {viewEditor && (
        <Dialog open onDismiss={() => setViewEditor(null)} label="重命名视图" className="bt-dialog">
          <header className="ln-dialog__head"><h3 className="ln-dialog__title">重命名视图</h3></header>
          <div className="ln-dialog__body">
            <input ref={viewNameRef} autoFocus className="bt-input" readOnly={readOnly} defaultValue={activeTable.views.find((v) => v.id === viewEditor)?.name ?? ""}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !readOnly) { patchView(viewEditor, { name: (event.target as HTMLInputElement).value.trim() || "视图" }); setViewEditor(null); }
              }} />
          </div>
          <div className="ln-dialog__actions">
            <button type="button" className="bt-secondary" onClick={() => setViewEditor(null)}>取消</button>
            <button type="button" className="bt-primary" disabled={readOnly} onClick={() => {
              patchView(viewEditor, { name: viewNameRef.current?.value.trim() || "视图" });
              setViewEditor(null);
            }}>确定</button>
          </div>
        </Dialog>
      )}

      {rowCtx && (
        <Menu className="bt-row-menu" surfaceRef={rowMenuPos.surfaceRef} onDismiss={() => setRowCtx(null)} style={rowMenuPos.style ?? undefined}>
            <button type="button" role="menuitem" className="bt-menu-item ln-menu__item" disabled={!cellRange}
              onClick={() => { void copySelection(); setRowCtx(null); }}><Copy size={13} />复制</button>
            <button type="button" role="menuitem" className="bt-menu-item ln-menu__item" disabled={readOnly || !cellRange}
              onClick={() => { void pasteSelection(); setRowCtx(null); }}><Copy size={13} />粘贴</button>
            <div className="context-menu-sep" />
            <button type="button" role="menuitem" className="bt-menu-item ln-menu__item ln-menu__item--danger" disabled={readOnly}
              onClick={() => { deleteRecords(selectedRecordIds.has(rowCtx.recordId) ? [...selectedRecordIds] : [rowCtx.recordId]); setRowCtx(null); }}>
              <Trash2 size={13} />删除记录
            </button>
        </Menu>
      )}


      {drawerRecord && (
        <BitableRecordDrawer
          noteId={noteId}
          table={activeTable}
          record={drawerRecord}
          ctx={displayCtx}
          readOnly={readOnly}
          onClose={() => setDrawerRecordId(null)}
          onPrev={() => stepDrawer(-1)}
          onNext={() => stepDrawer(1)}
          onSetValue={setCellValue}
          onAddOption={(fieldId, name, recordId) => addOption(fieldId, name, recordId)}
          onAddField={openAddField}
          onUpload={(recordId, fieldId, files) => { void uploadFiles(files).then((entries) => appendAttachments(activeTable.id, recordId, fieldId, entries)); }}
          onOpenAsset={openAsset}
          onOpenImages={openImages}
        />
      )}
      {csvImport && (
        <BitableCsvImportDialog
          fileName={csvImport.fileName}
          table={activeTable}
          header={csvImport.header}
          rows={csvImport.rows}
          mapping={csvImport.mapping}
          result={csvResult}
          onChange={(mapping) => setCsvImport((prev) => (prev ? { ...prev, mapping } : prev))}
          onConfirm={confirmCsvImport}
          onDone={() => { setCsvImport(null); setCsvResult(null); }}
          onDismiss={() => { setCsvImport(null); setCsvResult(null); }}
        />
      )}
    </div>
  );
}

interface FieldEditorModalProps {
  field: BitableField | null;
  readOnly: boolean;
  /** 同一文档的全部数据表（关联字段选目标表用）。 */
  tables: BitableTable[];
  /** 当前数据表 id（关联不允许指向自己，故从候选里排除）。 */
  tableId: string;
  onClose: () => void;
  onSave: (patch: Partial<BitableField>, options?: BitableField["options"]) => void;
  onDelete: () => void;
  onAddField: (patch: { name: string; type: string; required?: boolean; options?: BitableField["options"]; defaultValue?: unknown; dateAutoFill?: boolean; progressColor?: string; relation?: BitableRelation; ai?: BitableAiConfig }) => void;
}

function FieldEditorModal({ field, readOnly, tables, tableId, onClose, onSave, onDelete, onAddField }: FieldEditorModalProps) {
  const isNew = field === null;
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<string>(field?.type ?? "text");
  const [required, setRequired] = useState<boolean>(field?.required ?? false);
  const [options, setOptions] = useState(field?.options ?? []);
  const [optionDragId, setOptionDragId] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<{ optionId: string; anchor: HTMLElement } | null>(null);
  /** 进度字段的颜色配置（调色板；缺省走主题强调色）。 */
  const [progressColor, setProgressColor] = useState<string | undefined>(typeof field?.progressColor === "string" ? field.progressColor : undefined);
  const [progressColorAnchor, setProgressColorAnchor] = useState<HTMLElement | null>(null);
  const [defaultValue, setDefaultValue] = useState<string>(
    typeof field?.defaultValue === "string" || typeof field?.defaultValue === "number" ? String(field.defaultValue) : "",
  );
  /** 日期字段的默认值形态（对齐云端）：无 / 指定时间（挑一个日期）/ 添加记录时间（自动填创建日）。 */
  const [dateMode, setDateMode] = useState<"none" | "fixed" | "created">(
    field?.dateAutoFill === true ? "created" : (typeof field?.defaultValue === "string" && field.defaultValue ? "fixed" : "none"),
  );
  /** 关联字段配置（T02B.1/T02B.3）：目标表 + 是否允许多个记录 + 单向/双向。 */
  const [relationTableId, setRelationTableId] = useState<string>(typeof field?.relation?.tableId === "string" ? field.relation.tableId : "");
  const [relationAllowMultiple, setRelationAllowMultiple] = useState<boolean>(field?.relation?.allowMultiple !== false);
  /** **数据范围**（260929 用户追加）：勾选 = 绑定目标表的一个视图；不勾选 = 从目标表全部记录里选。 */
  const [relationViewId, setRelationViewId] = useState<string>(typeof field?.relation?.viewId === "string" ? field.relation.viewId : "");
  const relationTarget = tables.find((table) => table.id === relationTableId);
  const relationViews = relationTarget?.views ?? [];
  /** AI 字段配置（261003）：命令里用「插入字段」插入 `{{字段名}}` 变量（可多个；生成时**原位替换**）。 */
  const [aiPrompt, setAiPrompt] = useState(typeof field?.ai?.prompt === "string" ? field.ai.prompt : "");
  /** 多模态（261006）：把被引用字段里的图片 / PDF 作为内容块一并发送（缺省关闭）。 */
  const [aiIncludeAttachments, setAiIncludeAttachments] = useState<boolean>(field?.ai?.includeAttachments === true);
  const [aiInsertAnchor, setAiInsertAnchor] = useState<HTMLElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);
  const isAi = type === "ai";
  const aiRefCandidates = (tables.find((table) => table.id === tableId)?.fields ?? []).filter((candidate) => candidate.id !== field?.id);
  const aiTokenNames = aiPromptFieldNames(aiPrompt);
  const aiCandidateNames = new Set(aiRefCandidates.map((candidate) => candidate.name));
  const aiMissingNames = aiTokenNames.filter((name) => !aiCandidateNames.has(name));
  /** 把 `{{字段名}}` 插到命令的**光标处**（可多次插入多个字段）；插完把光标移到变量之后。 */
  const insertAiToken = (name: string) => {
    const token = "{{" + name + "}}";
    const el = aiPromptRef.current;
    const start = el ? el.selectionStart : aiPrompt.length;
    const end = el ? el.selectionEnd : aiPrompt.length;
    setAiPrompt(aiPrompt.slice(0, start) + token + aiPrompt.slice(end));
    requestAnimationFrame(() => {
      const node = aiPromptRef.current;
      if (node) { node.focus(); node.setSelectionRange(start + token.length, start + token.length); }
    });
  };
  const supportsOptions = type === "select" || type === "multiSelect";
  const knownType = isKnownFieldType(type) ? (type as BitableFieldType) : null;
  const isRelation = isRelationFieldType(type);
  /**
   * 选项编辑（用户口径）：**回车 = 当前选项编辑完成 → 切到下一个选项；已是最后一个才新建一个**。
   * ref map 让「切到下一个」能直接聚焦已存在的输入框；新建的则在 options 变化后的 effect 里聚焦。
   */
  const optionInputsRef = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusOptionRef = useRef<string | null>(null);
  const focusOptionInput = (id: string) => {
    const el = optionInputsRef.current.get(id);
    /** 只聚焦、**不 `select()`**（用户 260930 报的「添加时那块蓝色底色」就是自动全选画出来的系统选区；
        选项名不是「待覆盖的临时值」，没有全选的必要）。光标落末尾 = 与「鼠标点进这个输入框」完全一致。 */
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };
  useEffect(() => {
    const id = pendingFocusOptionRef.current;
    if (!id) return;
    pendingFocusOptionRef.current = null;
    focusOptionInput(id);
  }, [options]);
  const addOptionRow = () => {
    const id = newBitableId("opt");
    pendingFocusOptionRef.current = id;
    /** 新选项**留空**：默认名只作 `placeholder`（保存时空名按位置兜底成「选项 N」）。
        原先预填「选项 N」再全选，屏幕上就是一块蓝底；留空后直接键入即选项名。 */
    setOptions((prev) => [...prev, { id, name: "", color: BITABLE_OPTION_COLORS[prev.length % BITABLE_OPTION_COLORS.length] }]);
  };
  const handleOptionKeyDown = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || readOnly) return;
    event.preventDefault();
    const next = options[index + 1];
    if (next) focusOptionInput(next.id);
    else addOptionRow();
  };
  const parseDefault = (): unknown => {
    if (!knownType) return undefined;
    if (knownType === "number") return defaultValue === "" ? undefined : Number(defaultValue);
    if (knownType === "date") return dateMode === "fixed" && defaultValue !== "" ? defaultValue : undefined;
    if (knownType === "text" || knownType === "select" || knownType === "link") return defaultValue === "" ? undefined : defaultValue;
    if (knownType === "rating") return defaultValue === "" ? undefined : Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(Number(defaultValue))));
    if (knownType === "progress") return defaultValue === "" ? undefined : Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(Number(defaultValue))));
    if (knownType === "boolean") return defaultValue === "true" ? true : defaultValue === "false" ? false : undefined;
    return undefined;
  };
  const save = () => {
    const fallbackName = BITABLE_FIELD_TYPE_LABEL[knownType ?? "text"];
    const nextDefault = parseDefault();
    const dateAutoFill = knownType === "date" && dateMode === "created" ? true : undefined;
    const nextColor = knownType === "progress" ? progressColor : undefined;
    // 关联配置：方向由字段类型决定（relationTwoWay 由 createRelationPair 建反向字段/写配对）；目标表未选则不写 tableId
    const relation: BitableRelation | undefined = isRelation ? {
      allowMultiple: relationAllowMultiple,
      ...(relationTableId ? { tableId: relationTableId } : {}),
      ...(relationTableId && relationViewId ? { viewId: relationViewId } : {}),
      ...(type === "relationTwoWay" && typeof field?.relation?.pairedFieldId === "string" ? { pairedFieldId: field.relation.pairedFieldId } : {}),
    } : undefined;
    // 选项名兜底：新加的行留空（placeholder 才是默认名），保存时空名按位置落成「选项 N」——
    // 不加行时 `options` 原样返回，不产生任何差异。
    const nextOptions = supportsOptions
      ? options.map((option, index) => ({ ...option, name: option.name.trim() || "选项 " + (index + 1) }))
      : undefined;
    // AI 配置（261003）：仅 AI 字段带（字段变量写在命令里，可多个）；切走类型时显式 undefined，清掉旧配置。
    const ai: BitableAiConfig | undefined = isAi
      ? { prompt: aiPrompt.trim(), ...(aiIncludeAttachments ? { includeAttachments: true } : {}) }
      : undefined;
    if (isNew) { onAddField({ name: name.trim() || fallbackName, type, required, options: nextOptions, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor, relation, ai }); return; }
    onSave({ name: name.trim() || field!.name, type, required, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor, relation: isRelation ? relation : undefined, ai }, nextOptions);
  };
  return (
    <Dialog open onDismiss={onClose} label={isNew ? "新增字段" : "编辑字段"} className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">{isNew ? "新增字段" : "编辑字段"}</h3></header>
      <div className="ln-dialog__body">
        <label className="bt-field-label"><span>字段名称</span>
          <input className="bt-input" autoFocus value={name} readOnly={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="bt-field-label"><span>字段类型</span>
          <FieldTypeSelect value={type} disabled={readOnly} onPick={setType} />
        </div>
        <label className="bt-field-check"><input type="checkbox" checked={required} disabled={readOnly} onChange={(event) => setRequired(event.target.checked)} />必填</label>
        {(knownType === "text" || knownType === "number" || knownType === "date" || knownType === "select" || knownType === "link" || knownType === "boolean" || knownType === "rating" || knownType === "progress") && (
          <label className="bt-field-label"><span>默认值（新建记录时预填）</span>
            {knownType === "select" ? (
              <SelectMenu value={defaultValue} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} />
            ) : knownType === "date" ? (
              // 日期默认值三态（对齐云端）：无 / 指定时间 / 添加记录时间（新建记录时自动填当天）
              <div className="bt-date-default">
                <SelectMenu value={dateMode} disabled={readOnly} onChange={(value) => setDateMode(value as "none" | "fixed" | "created")}
                  options={[
                    { value: "none", label: "（无）" },
                    { value: "fixed", label: "指定时间（选择日期）" },
                    { value: "created", label: "添加记录时间（自动填创建日）" },
                  ]} />
                {dateMode === "fixed" && (
                  <DatePicker value={defaultValue} readOnly={readOnly} onChange={(value) => setDefaultValue(typeof value === "string" ? value : "")} />
                )}
              </div>
            ) : knownType === "boolean" ? (
              <SelectMenu value={defaultValue === "true" || defaultValue === "false" ? defaultValue : ""} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, { value: "true", label: "是" }, { value: "false", label: "否" }]} />
            ) : knownType === "rating" ? (
              <SelectMenu value={defaultValue} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n + " 星" }))]} />
            ) : knownType === "progress" ? (
              <div className="bt-date-default">
                <input className="bt-input" type="number" min={0} max={100} value={defaultValue} readOnly={readOnly} aria-label="进度默认值"
                  onChange={(event) => setDefaultValue(event.target.value)} />
                <button type="button" className="bt-select-trigger"
                  aria-label="选择进度条颜色" aria-haspopup="dialog" aria-expanded={Boolean(progressColorAnchor)} disabled={readOnly}
                  onClick={(event) => setProgressColorAnchor(event.currentTarget)}>
                  <span className="bt-color-square" style={{ backgroundColor: optionColorHex(progressColor) ?? "#e8e8e8" }} />
                  <span className="bt-field-name ln-ellipsis">进度条颜色</span>
                  <ChevronDown size={14} />
                </button>
              </div>
            ) : (
              <input className="bt-input" type={knownType === "number" ? "number" : "text"} placeholder={knownType === "link" ? "https://" : undefined}
                value={defaultValue} readOnly={readOnly} onChange={(event) => setDefaultValue(event.target.value)} />
            )}
          </label>
        )}
        {isRelation && (
          <>
            <div className="bt-field-label"><span>关联数据表</span>
              {/* 已配对的双向字段不允许改目标表（改表会让对侧反向字段失去意义） */}
              <SelectMenu value={relationTableId} disabled={readOnly || !!field?.relation?.pairedFieldId}
                onChange={(value) => { setRelationTableId(value); setRelationViewId(""); }}
                placeholder="选择数据表"
                options={tables.filter((table) => table.id !== tableId).map((table) => ({ value: table.id, label: table.name }))} />
            </div>
            {/* 数据范围（对齐云端「从视图筛选记录」）：不勾选 = 全部记录；勾选 = 绑定目标表的一个视图 */}
            <label className="bt-field-check"><input type="checkbox" checked={relationViewId !== ""}
              disabled={readOnly || !relationTableId || relationViews.length === 0}
              onChange={(event) => setRelationViewId(event.target.checked ? (relationViews[0]?.id ?? "") : "")} />从视图筛选记录</label>
            {relationViewId !== "" && (
              <div className="bt-field-label"><span>关联视图</span>
                <SelectMenu value={relationViewId} disabled={readOnly} onChange={setRelationViewId}
                  placeholder="选择视图"
                  options={relationViews.map((view) => ({ value: view.id, label: view.name }))} />
              </div>
            )}
            <label className="bt-field-check"><input type="checkbox" checked={relationAllowMultiple} disabled={readOnly}
              onChange={(event) => setRelationAllowMultiple(event.target.checked)} />允许添加多个记录</label>
          </>
        )}
        {isAi && (
          <div className="bt-ai-config">
            <div className="bt-field-label"><span>命令（AI 按它生成内容；字段变量插在命令里）</span></div>
            <textarea ref={aiPromptRef} className="bt-input bt-ai-prompt" rows={4} value={aiPrompt} readOnly={readOnly}
              placeholder="例如：阅读{{附件}}，先写一段摘要，再列出核心要点"
              onChange={(event) => setAiPrompt(event.target.value)} />
            <button type="button" className="bt-secondary bt-ai-insert" disabled={readOnly}
              aria-haspopup="dialog" aria-expanded={Boolean(aiInsertAnchor)}
              onClick={(event) => setAiInsertAnchor(event.currentTarget)}>
              <Plus size={13} />插入字段<ChevronDown size={14} />
            </button>
            {aiInsertAnchor && (
              <Popover open anchor={aiInsertAnchor} onClose={() => setAiInsertAnchor(null)} width={220}>
                <div className="bt-panel">
                  {aiRefCandidates.length === 0 && <div className="bt-field-label-text">这张表里还没有其它字段可以引用</div>}
                  {aiRefCandidates.map((candidate) => (
                    <button key={candidate.id} type="button" className="bt-menu-item ln-menu__item"
                      onClick={() => { insertAiToken(candidate.name); setAiInsertAnchor(null); }}>
                      <FieldTypeIcon type={candidate.type} size={13} /><span className="bt-menu-label ln-ellipsis">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              </Popover>
            )}
            <label className="bt-field-check"><input type="checkbox" checked={aiIncludeAttachments} disabled={readOnly}
              onChange={(event) => setAiIncludeAttachments(event.target.checked)} />把引用的图片 / PDF 一起发送给 AI</label>
            {aiIncludeAttachments && (
              <div className="bt-field-label-text">图片直接发送；PDF 抽取文字后发送（当前只支持 PDF）；其余附件仍只发文件名。</div>
            )}
            <div className="bt-field-label-text">
              {aiTokenNames.length === 0
                ? "还没有插入字段：请用「插入字段」把要参考的字段插入到命令里（单元格才会出现「AI 生成」）。"
                : "已插入 " + aiTokenNames.length + " 个字段；生成时 " + "{{字段名}}" + " 会原位替换为当前行该字段的值。"}
              {aiMissingNames.length > 0 && (
                <>
                  {" "}
                  <span className="ln-tag ln-tag--error">未找到：{aiMissingNames.map((name) => "{{" + name + "}}").join("、")}（生成时按空处理）</span>
                </>
              )}
            </div>
          </div>
        )}
        {supportsOptions && (
          <div className="bt-options-editor">
            <span className="bt-field-label-text">选项</span>
            {options.map((option, index) => (
              <div key={option.id} className="bt-option-edit-row" draggable={!readOnly}
                onDragStart={() => setOptionDragId(option.id)}
                onDragOver={(event) => { event.preventDefault(); if (optionDragId && optionDragId !== option.id) setOptions(moveItem(options, optionDragId, option.id, (o) => o.id)); }}
                onDragEnd={() => setOptionDragId(null)}>
                <button type="button" className="bt-color-square" style={{ backgroundColor: optionColorHex(option.color) ?? "#e8e8e8" }}
                  aria-label="选择颜色" disabled={readOnly}
                  onMouseEnter={(event) => { if (!readOnly) setColorFor({ optionId: option.id, anchor: event.currentTarget }); }}
                  onClick={(event) => setColorFor({ optionId: option.id, anchor: event.currentTarget })} />
                <input className="bt-input" value={option.name} readOnly={readOnly}
                  placeholder={"选项 " + (index + 1)}
                  ref={(el) => { if (el) optionInputsRef.current.set(option.id, el); else optionInputsRef.current.delete(option.id); }}
                  onKeyDown={(event) => handleOptionKeyDown(index, event)}
                  onChange={(event) => setOptions(options.map((o, i) => (i === index ? { ...o, name: event.target.value } : o)))} />
                <GripVertical size={13} className="bt-grip" />
                <button type="button" className="bt-icon-btn" title="删除选项" aria-label="删除选项" disabled={readOnly}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
              </div>
            ))}
            {colorFor && (
              <ColorPalette anchor={colorFor.anchor} value={options.find((o) => o.id === colorFor.optionId)?.color} recentKey="bitable-option"
                defaultLabel="无背景色" defaultKind="background"
                onPick={(color) => setOptions(options.map((o) => (o.id === colorFor.optionId ? { ...o, color } : o)))}
                onDefault={() => setOptions(options.map((o) => (o.id === colorFor.optionId ? { ...o, color: undefined } : o)))}
                onClose={() => setColorFor(null)} />
            )}
            <button type="button" className="bt-panel-add" disabled={readOnly} onClick={addOptionRow}><Plus size={14} />添加选项</button>
          </div>
        )}
        {/* 进度字段的颜色面板：它不属于「选项编辑器」（进度字段 supportsOptions=false）。
            此前被嵌在 options 块内 ⇒ 点色块永远打不开面板（260929-OPT 修复）。 */}
        {progressColorAnchor && (
          <ColorPalette anchor={progressColorAnchor} value={progressColor} recentKey="bitable-progress"
            defaultLabel="默认色" defaultKind="text"
            onPick={(color) => setProgressColor(color)}
            onDefault={() => setProgressColor(undefined)}
            onClose={() => setProgressColorAnchor(null)} />
        )}
      </div>
      <div className="ln-dialog__actions">
        {!isNew && <button type="button" className="bt-danger" disabled={readOnly} onClick={onDelete}><Trash2 size={13} />删除字段</button>}
        <span className="bt-toolbar-spacer" />
        <button type="button" className="bt-secondary" onClick={onClose}>取消</button>
        <button type="button" className="bt-primary" disabled={readOnly} onClick={save}>确定</button>
      </div>
    </Dialog>
  );
}
