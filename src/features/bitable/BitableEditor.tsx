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
  ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, Copy, Eye, EyeOff, GripVertical, ListFilter,
  MoreHorizontal, Pencil, Plus, Rows2, Rows3, Rows4, Search, Settings2, Trash2, X,
} from "lucide-react";
import {
  BITABLE_DOC_KIND, BITABLE_DOC_VERSION, BITABLE_FIELD_TYPE_LABEL,
  BITABLE_FILTER_OPERATOR_LABEL, BITABLE_OPTION_COLORS, applyViewToRecords, bitableDisplayValue, bitablesToBody, defaultRecordValues, duplicateValues, optionColorHex,
  bitableAttachments, removeBitableAttachment, renameBitableAttachment, reorderBitableAttachments,
  createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable, filterOperatorsFor,
  BITABLE_MAX_GROUPS, BITABLE_STAT_LABEL, groupRecordsTree, isAttachmentLikeField, isImplementedViewType,
  BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, kanbanGroupField, sortModeLabel, sortModesForField, statForField, statsForField,
  isKnownFieldType, newBitableId, orderedTableFields, parseBitableBody,
  type BitableAttachment, type BitableDoc, type BitableField, type BitableFieldType, type BitableFilterRule, type BitableGroupRule, type BitableRecord,
  type BitableGroupNode, type BitableRowHeight, type BitableSortMode, type BitableSortRule, type BitableStatType, type BitableTable, type BitableView, type BitableViewType,
} from "../../core/bitableDoc.js";
import { StatCell } from "./bitableCells";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { uploadLakeResource } from "../editor/resourceUpload.js";
import { ASSET_ORIGIN, withAssetAccessToken } from "../../lib/assetPort.js";
import { openAssetEntry } from "../attachment/openAssetEntry.js";
import { AttachmentPreview } from "../attachment/AttachmentPreview.js";
import { openImagePreview } from "../editor/imagePreview.js";
import { ImageLightbox } from "../editor/ImageLightbox.js";
import { BitableCalendarView } from "./BitableCalendarView.js";
import { BitableFormView } from "./BitableFormView.js";
import { BitableGalleryView } from "./BitableGalleryView.js";
import { BitableKanbanView } from "./BitableKanbanView.js";
import { BitableRecordDrawer } from "./BitableRecordDrawer.js";
import { BitableViewBar } from "./BitableViewBar.js";
import { CalendarConfigPanel, GalleryConfigPanel, KanbanConfigPanel } from "./BitableViewConfigPanels.js";
import { AttachmentCell, CellEditor, ColorPalette, DatePicker, FieldTypeGrid, FieldTypeIcon, Popover, SelectMenu } from "./bitableCells.js";
import { createSnapshotHistory, type SnapshotHistory } from "../../core/bitableHistory.js";
import { BitableViewFallback, ViewTypeIcon } from "./bitableViews.js";
import "./bitableEditor.css";

const AUTOSAVE_DEBOUNCE_MS = 800;
const DEFAULT_COL_WIDTH = 180;

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

function initialDoc(content: string): BitableDoc {
  const parsed = parseBitableBody(content);
  if (parsed) return parsed;
  const table = createDefaultBitableTable();
  return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables: [table], activeTableId: table.id };
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

export interface BitableEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** 是否显示编辑器外壳（数据表列表 / 视图页签 / 工具条，默认 true）。历史快照预览传 false。 */
  chrome?: boolean;
}

export function BitableEditor({ noteId, content, visible, readOnly, onChange, chrome = true }: BitableEditorProps) {
  const [doc, setDoc] = useState<BitableDoc>(() => initialDoc(content));
  const docRef = useRef(doc);
  docRef.current = doc;
  const lastSerializedRef = useRef(bitablesToBody(doc.tables, doc.activeTableId));
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  /** 撤销/重做：快照 doc.tables（数据），不记录 activeTableId/activeViewId 这类导航态。 */
  const historyRef = useRef<SnapshotHistory<BitableTable[]> | null>(null);
  if (historyRef.current === null) historyRef.current = createSnapshotHistory<BitableTable[]>(100);
  const prevTablesRef = useRef<BitableTable[] | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const flushNow = useCallback(() => {
    const current = docRef.current;
    const json = bitablesToBody(current.tables, current.activeTableId);
    if (json === lastSerializedRef.current) return;
    lastSerializedRef.current = json;
    changeRef.current(json);
  }, []);

  useEffect(() => {
    if (readOnly) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; flushNow(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [doc, readOnly, flushNow]);

  useEffect(() => () => { flushNow(); }, [flushNow]);

  // 数据变化即压栈（只记 tables；导航不记）
  useEffect(() => {
    const tables = doc.tables;
    if (prevTablesRef.current && prevTablesRef.current !== tables) historyRef.current!.push(prevTablesRef.current);
    prevTablesRef.current = tables;
  }, [doc.tables]);

  // ---- 面板/浮层状态 ----
  const [panel, setPanel] = useState<null | "fields" | "filter" | "group" | "sort" | "rowHeight" | "viewConfig">(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  /** 列菜单：坐标定位（⋯ 按钮 / 列头右键都能开）；header = 列头 <th>，给「文本颜色」调色板当锚点
   *  —— ⋯ 按钮是 hover 才 display 的，菜单一关就量不到位置（调色板会跑到左上角）。 */
  const [columnMenu, setColumnMenu] = useState<{ fieldId: string; x: number; y: number; header: HTMLElement | null } | null>(null);
  const [textColorFor, setTextColorFor] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  /** 列统计选择器（列菜单「统计」→ 锚到列头）。 */
  const [statFor, setStatFor] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  const [configDragId, setConfigDragId] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<{ viewId: string; anchor: HTMLElement } | null>(null);
  const [addFieldAnchor, setAddFieldAnchor] = useState<HTMLElement | null>(null);
  const [fieldEditor, setFieldEditor] = useState<{ fieldId: string | null } | null>(null);
  const [viewEditor, setViewEditor] = useState<string | null>(null);
  const viewNameRef = useRef<HTMLInputElement>(null);
  const [tableEditor, setTableEditor] = useState<{ id: string; draft: string } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
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
  const groups = (activeView.groups as BitableGroupRule[] | undefined) ?? [];
  const visibleFields = useMemo(() => orderedTableFields(activeTable, activeView), [activeTable, activeView]);
  /** 表格配置面板顺序 = 视图 fieldOrder 应用到全部字段（含隐藏），与网格列顺序同源。 */
  const allOrderedFields = useMemo(() => {
    const order = activeView.fieldOrder;
    if (!order || order.length === 0) return activeTable.fields;
    const rank = new Map(order.map((id, index) => [id, index] as const));
    const max = Number.MAX_SAFE_INTEGER;
    return [...activeTable.fields].sort((x, y) => (rank.get(x.id) ?? max) - (rank.get(y.id) ?? max));
  }, [activeTable, activeView]);
  const viewRecords = useMemo(() => applyViewToRecords(activeTable, activeView), [activeTable, activeView]);
  const shownRecords = useMemo(() => {
    if (!findQuery.trim()) return viewRecords;
    const q = findQuery.trim().toLowerCase();
    return viewRecords.filter((record) => activeTable.fields.some((field) => {
      const value = record.values[field.id];
      const text = field.type === "select" || field.type === "multiSelect"
        ? (field.options ?? []).filter((o) => Array.isArray(value) ? value.includes(o.id) : value === o.id).map((o) => o.name).join(" ")
        : typeof value === "string" ? value : typeof value === "number" ? String(value) : Array.isArray(value) ? value.join(" ") : "";
      return text.toLowerCase().includes(q);
    }));
  }, [viewRecords, findQuery, activeTable]);
  const rowIndexById = useMemo(() => new Map(shownRecords.map((r, i) => [r.id, i] as const)), [shownRecords]);
  const rowItems = useMemo(() => {
    /** 分组头（含本组记录，供「按分组统计」）/「加进本组」行 / 组间间隔行 / 记录行。 */
    type RowItem =
      | { kind: "group"; key: string; label: string; level: number; fieldId: string; records: BitableRecord[] }
      | { kind: "groupAdd"; key: string; fieldId: string; value: unknown }
      | { kind: "gap"; key: string }
      | { kind: "record"; record: BitableRecord };
    const nodes = groupRecordsTree(activeTable, shownRecords, groups);
    if (nodes.length === 0) return shownRecords.map((record): RowItem => ({ kind: "record", record }));
    const items: RowItem[] = [];
    /** T03 多级：逐级拍平；折叠只影响该节点以下（key 含层级前缀，互不串扰）。
     *  复刻云端：每个分组在其记录之后有一条「加进本组」圆钮行；顶级分组之间留一条间隔行。 */
    const walk = (list: BitableGroupNode[], topLevel: boolean) => {
      list.forEach((node, index) => {
        items.push({ kind: "group", key: node.key, label: node.label, level: node.level, fieldId: node.fieldId, records: node.records });
        if (!collapsedGroups.has(node.key)) {
          if (node.children.length > 0) walk(node.children, false);
          else for (const record of node.records) items.push({ kind: "record", record });
          items.push({ kind: "groupAdd", key: "add:" + node.key, fieldId: node.fieldId, value: node.records[0]?.values[node.fieldId] });
        }
        if (topLevel && index < list.length - 1) items.push({ kind: "gap", key: "gap:" + node.key });
      });
    };
    walk(nodes, true);
    return items;
  }, [shownRecords, activeTable, groups, collapsedGroups]);
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
    const text = bitableDisplayValue(field, record.values[field.id]).trim();
    return text !== "" && set.has(text);
  };
  const columnTextColor = (fieldId: string) => (activeView.columnTextColors ?? {})[fieldId];
  const drawerIndex = drawerRecordId ? viewRecords.findIndex((r) => r.id === drawerRecordId) : -1;
  const drawerRecord = drawerIndex >= 0 ? viewRecords[drawerIndex] : null;

  // ---- 变更助手 ----
  const patchTable = useCallback((tableId: string, updater: (table: BitableTable) => BitableTable) => {
    setDoc((prev) => ({ ...prev, tables: prev.tables.map((t) => (t.id === tableId ? updater(t) : t)) }));
  }, []);
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
    patchActiveTable((table) => ({
      ...table,
      records: table.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, ...patch }, updatedAt: stamp() } : r)),
    }));
  }, [patchActiveTable]);

  const setCellValue = useCallback((recordId: string, fieldId: string, value: unknown) => {
    patchActiveTable((table) => ({
      ...table,
      records: table.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [fieldId]: value }, updatedAt: stamp() } : r)),
    }));
  }, [patchActiveTable]);

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
    // kindFrom = 磁盘名：展示名被改成没有扩展名时，类型判定照样正确（音视频仍走应用内播放）
    openAssetEntry(withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + attachment.file), attachment.name, attachment.size, { kindFrom: attachment.file });
  }, [noteId]);

  /** 图片预览：入参永远是**同一个单元格内**的图片（用户 260928：两列图片就是两类，绝不跨列合并）。 */
  const openImages = useCallback((images: BitableAttachment[], index: number) => {
    openImagePreview(images.map((image) => ({ src: withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + image.file) })), index);
  }, [noteId]);

  const appendAttachments = useCallback((recordId: string, fieldId: string, entries: BitableAttachment[]) => {
    patchActiveTable((table) => ({
      ...table,
      records: table.records.map((r) => {
        if (r.id !== recordId) return r;
        const current = bitableAttachments(r.values[fieldId]);
        return { ...r, values: { ...r.values, [fieldId]: [...current, ...entries] }, updatedAt: stamp() };
      }),
    }));
  }, [patchActiveTable]);

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
    setDoc((prev) => {
      const table = createDefaultBitableTable("数据表 " + (prev.tables.length + 1));
      return { ...prev, tables: [...prev.tables, table], activeTableId: table.id };
    });
  }, []);
  const renameTable = useCallback((id: string, name: string) => {
    patchTable(id, (table) => ({ ...table, name: name.trim() || "数据表" }));
  }, [patchTable]);
  const deleteTable = useCallback((id: string) => {
    setDoc((prev) => {
      if (prev.tables.length <= 1) return prev;
      const tables = prev.tables.filter((t) => t.id !== id);
      return { ...prev, tables, activeTableId: prev.activeTableId === id ? tables[0].id : prev.activeTableId };
    });
  }, []);
  const reorderTables = useCallback((fromId: string, toId: string) => {
    setDoc((prev) => ({ ...prev, tables: moveItem(prev.tables, fromId, toId, (t) => t.id) }));
  }, []);
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
    patchActiveTable((table) => ({ ...table, activeViewId: viewId }));
  }, [patchActiveTable]);

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
    patchActiveTable((table) => ({ ...table, fields: table.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) }));
  }, [patchActiveTable]);
  const deleteField = useCallback((fieldId: string) => {
    patchActiveTable((table) => {
      if (table.fields.length <= 1) return table;
      return { ...table, fields: table.fields.filter((f) => f.id !== fieldId), views: table.views.map((v) => ({ ...v, hiddenFieldIds: (v.hiddenFieldIds ?? []).filter((id) => id !== fieldId), fieldOrder: (v.fieldOrder ?? []).filter((id) => id !== fieldId), formFieldIds: v.formFieldIds ? v.formFieldIds.filter((id) => id !== fieldId) : undefined })) };
    });
    setColumnMenu(null);
    setFieldEditor(null);
  }, [patchActiveTable]);
  const duplicateField = useCallback((fieldId: string) => {
    patchActiveTable((table) => {
      const index = table.fields.findIndex((f) => f.id === fieldId);
      if (index < 0) return table;
      const source = table.fields[index];
      const field: BitableField = { ...source, id: newBitableId("fld"), name: source.name + " 副本", options: (source.options ?? []).map((o) => ({ ...o, id: newBitableId("opt") })) };
      const fields = [...table.fields];
      fields.splice(index + 1, 0, field);
      return { ...table, fields };
    });
    setColumnMenu(null);
  }, [patchActiveTable]);
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
      const max = Number.MAX_SAFE_INTEGER;
      const rank = new Map((view.fieldOrder ?? []).map((id, index) => [id, index] as const));
      const current = table.fields.map((f) => f.id).sort((x, y) => (rank.get(x) ?? max) - (rank.get(y) ?? max));
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
    patchActiveTable((table) => ({ ...table, records: [...table.records, { ...record, values: defaultRecordValues(table, record.createdAt) }] }));
    return record.id;
  }, [patchActiveTable]);
  /** 复刻云端：分组下方的圆 + 直接**加进本组**（给新记录预置该分组字段的值；空值组则不写值）。 */
  const addRecordInGroup = useCallback((fieldId: string, value: unknown) => {
    const record = createBitableRecord();
    patchActiveTable((table) => {
      const values = defaultRecordValues(table, record.createdAt);
      if (value !== undefined && value !== "") values[fieldId] = value;
      return { ...table, records: [...table.records, { ...record, values }] };
    });
    return record.id;
  }, [patchActiveTable]);
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
    const onMove = (ev: PointerEvent) => updateField(fieldId, { width: Math.max(80, Math.min(640, startW + (ev.clientX - startX))) });
    const onUp = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [updateField]);

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
  const setFilters = (next: BitableFilterRule[]) => patchView(activeView.id, { filters: next });
  const setSorts = (next: BitableView["sorts"]) => patchView(activeView.id, { sorts: next });
  const setGroups = (next: BitableGroupRule[]) => patchView(activeView.id, { groups: next });
  /** 分组面板的拖动排序态（只用于重排 rules，不写正文以外的任何东西）。 */
  const [groupDragIndex, setGroupDragIndex] = useState<number | null>(null);
  const moveGroupRule = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= groups.length || to >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroups(next);
  };
  /** T04：排序方式 ↔ (mode, desc) 的单一映射（UI 只认「排序方式」一个下拉）。 */
  const sortModeOf = (rule: BitableView["sorts"] extends (infer T)[] | undefined ? T : never): BitableSortMode =>
    (rule as { mode?: string }).mode === "optionOrder" ? (rule.desc ? "optionReverse" : "optionOrder") : (rule.desc ? "desc" : "asc");
  const applySortMode = (rule: BitableSortRule, mode: BitableSortMode): BitableSortRule => {
    if (mode === "optionOrder") return { ...rule, mode: "optionOrder", desc: false };
    if (mode === "optionReverse") return { ...rule, mode: "optionOrder", desc: true };
    return { fieldId: rule.fieldId, desc: mode === "desc" };
  };
  /** 换字段时丢掉该字段不支持的语义排序（单选/多选才有选项序）。 */
  const changeSortField = (rule: BitableSortRule, fieldId: string): BitableSortRule => {
    const field = activeTable.fields.find((item) => item.id === fieldId);
    const keep = rule.mode === "optionOrder" && (field?.type === "select" || field?.type === "multiSelect");
    return { fieldId, desc: rule.desc, ...(keep ? { mode: "optionOrder" as const } : {}) };
  };
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
  const cellInSelection = (recordId: string, fieldId: string) => {
    if (!cellRange) return false;
    const ri = shownRecords.findIndex((r) => r.id === recordId);
    const ci = visibleFields.findIndex((f) => f.id === fieldId);
    return ri >= cellRange.r0 && ri <= cellRange.r1 && ci >= cellRange.c0 && ci <= cellRange.c1;
  };
  /** 选中态的**边框**只画在选区外缘（单格 = 一整圈；见 bitableEditor.css 的四边 box-shadow 拼法）。 */
  const selectionEdgeClass = (recordId: string, fieldId: string) => {
    if (!cellRange) return "";
    const ri = shownRecords.findIndex((r) => r.id === recordId);
    const ci = visibleFields.findIndex((f) => f.id === fieldId);
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
      for (let ci = cellRange.c0; ci <= cellRange.c1; ci += 1) cells.push(bitableDisplayValue(visibleFields[ci], record.values[visibleFields[ci].id]));
      lines.push(cells.join("\t"));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); } catch { /* ignore */ }
  }, [cellRange, shownRecords, visibleFields]);
  const pasteSelection = useCallback(async () => {
    if (!cellRange) return;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return; }
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
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !cellRange) return;
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
  }, [cellRange, copySelection, pasteSelection]);
  const undoEdit = useCallback(() => {
    const next = historyRef.current!.undo(docRef.current.tables);
    if (!next) return;
    prevTablesRef.current = next;
    setDoc((d) => ({ ...d, tables: next, activeTableId: next.some((t) => t.id === d.activeTableId) ? d.activeTableId : next[0].id }));
  }, []);
  const redoEdit = useCallback(() => {
    const next = historyRef.current!.redo(docRef.current.tables);
    if (!next) return;
    prevTablesRef.current = next;
    setDoc((d) => ({ ...d, tables: next, activeTableId: next.some((t) => t.id === d.activeTableId) ? d.activeTableId : next[0].id }));
  }, []);
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redoEdit(); else undoEdit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, undoEdit, redoEdit]);
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

  const renderRecordRow = (record: BitableRecord, index: number) => (
    <tr key={record.id} data-record-id={record.id}
      className={"bt-row" + (rowDragId === record.id ? " dragging" : "") + (rowDragOverId === record.id && rowDragId !== record.id ? " drag-over" : "") + (selectedRecordIds.has(record.id) ? " selected" : "")}
      onContextMenu={(event) => { if (readOnly) return; event.preventDefault(); setRowCtx({ recordId: record.id, x: event.clientX, y: event.clientY }); }}>
      <td className="bt-td-index">
        <button type="button" className="bt-row-num" title="选择记录" disabled={readOnly}
          onClick={() => setSelectedRecordIds((prev) => { const next = new Set(prev); if (next.has(record.id)) next.delete(record.id); else next.add(record.id); return next; })}>{index + 1}</button>
        <div className="bt-row-handle">
          <button type="button" className="bt-row-grip" aria-label="拖动排序" title="拖动排序" disabled={readOnly}
            onPointerDown={(event) => startRowDrag(event, record.id)}><GripVertical size={13} /></button>
          <input type="checkbox" className="bt-row-check" aria-label="选择记录" checked={selectedRecordIds.has(record.id)}
            onChange={(event) => setSelectedRecordIds((prev) => { const next = new Set(prev); if (event.target.checked) next.add(record.id); else next.delete(record.id); return next; })} />
          <button type="button" className="bt-row-expander" aria-label="展开行" title="展开行（Space）"
            onClick={() => openDrawer(record.id)}><RowExpandIcon /></button>
        </div>
      </td>
      {visibleFields.map((field) => (
        <td key={field.id} data-record-id={record.id} data-field-id={field.id}
          className={"bt-td" + (selectedColumnId === field.id ? " col-selected" : "") + (cellInSelection(record.id, field.id) ? " cell-selected" + selectionEdgeClass(record.id, field.id) : "") + (isDuplicateCell(field, record) ? " in-highlight" : "")}
          style={columnTextColor(field.id) ? { color: columnTextColor(field.id) } : undefined}
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
            value={record.values[field.id]}
            readOnly={readOnly}
            onChange={(value) => setCellValue(record.id, field.id, value)}
            onAddOption={(name) => addOption(field.id, name, record.id)}
            renderAttachment={(imageOnly) => (
              <AttachmentCell
                noteId={noteId}
                value={record.values[field.id]}
                readOnly={readOnly}
                imageOnly={imageOnly}
                onUpload={(files) => { void uploadFiles(files).then((entries) => appendAttachments(record.id, field.id, entries)); }}
                onRemove={(file) => setCellValue(record.id, field.id, removeBitableAttachment(record.values[field.id], file))}
                onOpen={openAsset}
                onOpenImages={openImages}
                onReorder={(files) => setCellValue(record.id, field.id, reorderBitableAttachments(record.values[field.id], files))}
                onRename={(file, name) => setCellValue(record.id, field.id, renameBitableAttachment(record.values[field.id], file, name))}
              />
            )}
          />
        </td>
      ))}
      <td className="bt-td-empty" />
    </tr>
  );

  return (
    <div ref={rootRef} className={"bitable-editor" + (visible ? "" : " fn__none")}>
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
              onClick={() => setDoc((prev) => ({ ...prev, activeTableId: table.id }))}
            >
              <GripVertical size={13} className="bt-grip" />
              {tableEditor?.id === table.id
                ? <input autoFocus className="bt-inline-input" value={tableEditor.draft}
                    onChange={(event) => setTableEditor({ id: table.id, draft: event.target.value })}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => { renameTable(table.id, tableEditor.draft); setTableEditor(null); }}
                    onKeyDown={(event) => { if (event.key === "Enter") { renameTable(table.id, tableEditor.draft); setTableEditor(null); } if (event.key === "Escape") setTableEditor(null); }} />
                : <span className="bt-table-name">{table.name}</span>}
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
                  <span className="bt-tables-switch-name">{activeTable.name}</span><ChevronDown size={13} />
                </button>
              </div>
            ) : undefined}
            onSelect={setActiveView}
            onRenameRequest={setViewEditor}
            onMore={(viewId, anchor) => setViewMenu({ viewId, anchor })}
            onAddView={addView}
            onReorder={reorderViews}
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
              if (filters.length === 0 && activeTable.fields.length > 0) setFilters([{ fieldId: activeTable.fields[0].id, operator: "contains", value: "" }]);
              setPanel("filter");
            }}>
            <ListFilter size={14} />筛选{filters.length > 0 && <span className="bt-badge">{filters.length}</span>}
          </button>
          {showGridTools && (
            <button type="button" className={"bt-tool-btn" + (panel === "group" ? " is-active" : "")}
              onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "group" ? null : "group"); }}>
              <Rows2 size={14} />分组{groups.length > 0 && <span className="bt-badge">{groups.length}</span>}
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
          <button type="button" className={"bt-tool-btn" + (findOpen ? " is-active" : "")} onClick={() => setFindOpen((v) => !v)}>
            <Search size={14} />搜索
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

        {/* 本版本还没实现正文渲染的视图类型（gallery/calendar 及未来未知类型）：明确提示 + 表格正文，绝不白屏、不改数据 */}
        {!isImplementedViewType(activeView.type) && <BitableViewFallback view={activeView} />}

        {activeView.type === "form" ? (
          <BitableFormView
            noteId={noteId}
            table={activeTable}
            view={activeView}
            readOnly={readOnly}
            onUpdateView={(patch) => patchView(activeView.id, patch)}
            onSubmit={(values) => {
              const record = createBitableRecord();
              record.values = values;
              patchActiveTable((table) => ({ ...table, records: [...table.records, record] }));
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
          <BitableGalleryView noteId={noteId} table={activeTable} view={activeView} records={shownRecords} onOpenRecord={openDrawer} onOpenImages={openImages} />
        ) : activeView.type === "calendar" ? (
          <BitableCalendarView table={activeTable} view={activeView} records={shownRecords} readOnly={readOnly}
            onOpenRecord={openDrawer} onSetValues={setRecordValues} />
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
                        <button type="button" className="bt-th-more" title="列操作" aria-label="列操作" disabled={readOnly}
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
                {rowItems.map((item) => {
                  if (item.kind === "group") {
                    /** 首列统计 = 默认「记录总数」（云端口径：只有第一列有默认汇总，其余默认不展示）。 */
                    const headField = visibleFields[0];
                    return (
                      <tr key={"g:" + item.key} className={"bt-group-row" + (item.level > 0 ? " level-" + item.level : "")} onClick={() => toggleGroup(item.key)}>
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
                                  stat={statForField(activeView, headField.id) ?? "count"}
                                  onPick={(anchor) => setStatFor({ fieldId: headField.id, anchor })} />
                              </span>
                            )}
                          </div>
                        </td>
                        {/* 其余列仍按列显示**本组**的统计 */}
                        {visibleFields.slice(1).map((field) => (
                          <td key={field.id} className="bt-group-stat">
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
                      <tr key={"ga:" + item.key} className="bt-group-add-row">
                        <td colSpan={visibleFields.length + 2}>
                          <button type="button" className="bt-add-round" title="加进本组" aria-label="加进本组" disabled={readOnly}
                            onClick={() => addRecordInGroup(item.fieldId, item.value)}><Plus size={14} /></button>
                        </td>
                      </tr>
                    );
                  }
                  if (item.kind === "gap") return <tr key={"gap:" + item.key} className="bt-group-gap"><td colSpan={visibleFields.length + 2} /></tr>;
                  return renderRecordRow(item.record, rowIndexById.get(item.record.id) ?? 0);
                })}

                <tr className="bt-add-row">
                  <td colSpan={visibleFields.length + 1}>
                    <button type="button" className="bt-add-round" title="添加记录" aria-label="添加记录" disabled={readOnly} onClick={() => addRecord()}><Plus size={14} /></button>
                  </td>
                  <td />
                </tr>
                {/* 撑满一屏的占位行：内容不够高时把 tfoot 顶到视图最底部，底部汇总栏才是「常驻」的 */
                }
                <tr className="bt-grid-filler" aria-hidden="true"><td colSpan={visibleFields.length + 2} /></tr>
              </tbody>
              {/* T01 列级统计：口径 = 当前视图筛选后的记录（排序不影响），配置存视图、值现算。
                  260929 用户定稿：**常驻**（不按有无配置条件渲染），贴底那条做薄，首格缺省显示总记录数，
                  未配置的列显示 `—` ⇒ 既常驻又不会是一条无信息量的空灰条。 */}
              <tfoot>
                <tr className="bt-stat-row">
                  <td className="bt-stat-index">{activeTable.records.length} 条记录</td>
                  {visibleFields.map((field) => (
                    <td key={field.id} className="bt-stat-cell">
                      <StatCell field={field} records={shownRecords} stat={statForField(activeView, field.id)} readOnly={readOnly}
                        onPick={(anchor) => setStatFor({ fieldId: field.id, anchor })} />
                    </td>
                  ))}
                  <td className="bt-stat-cell" />
                </tr>
              </tfoot>
            </table>
            <div className="bt-grid-foot">{selectedRecordIds.size > 0 ? "已选择 " + selectedRecordIds.size + " 条记录" : cellRange ? "已选择 " + ((cellRange.r1 - cellRange.r0 + 1) * (cellRange.c1 - cellRange.c0 + 1)) + " 个单元格" : "共 " + activeTable.records.length + " 条记录"}{findQuery ? "，匹配 " + shownRecords.length + " 条" : ""}</div>
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
                <span className="bt-field-name">{field.name}</span>
                <button type="button" className="bt-icon-btn" title={hidden ? "显示字段" : "隐藏字段"} aria-label={hidden ? "显示字段" : "隐藏字段"} onClick={() => toggleFieldHidden(field.id)}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <button type="button" className="bt-icon-btn" title="编辑字段" aria-label="编辑字段" disabled={readOnly} onClick={() => setFieldEditor({ fieldId: field.id })}><Pencil size={13} /></button>
              </div>
            );
          })}
          <button type="button" className="bt-panel-add" disabled={readOnly} onClick={(event) => setAddFieldAnchor(event.currentTarget)}><Plus size={14} />新增字段</button>
        </div>
      </Popover>

      <Popover open={panel === "filter"} anchor={menuAnchor} onClose={() => setPanel(null)} width={420}>
        <div className="bt-panel">
          <h4>筛选</h4>
          {filters.map((rule, index) => (
            <div key={index} className="bt-rule-row">
              <SelectMenu value={rule.fieldId} onChange={(value) => setFilters(filters.map((r, i) => (i === index ? { ...r, fieldId: value } : r)))}
                options={activeTable.fields.map((f) => ({ value: f.id, label: f.name }))} />
              <SelectMenu value={rule.operator} onChange={(value) => setFilters(filters.map((r, i) => (i === index ? { ...r, operator: value as BitableFilterRule["operator"] } : r)))}
                options={(filterOperatorsFor(activeTable.fields.find((f) => f.id === rule.fieldId) ?? activeTable.fields[0])).map((op) => ({ value: op, label: BITABLE_FILTER_OPERATOR_LABEL[op] }))} />
              {rule.operator !== "isEmpty" && rule.operator !== "isNotEmpty" && (
                <input value={rule.value ?? ""} placeholder="值" onChange={(event) => setFilters(filters.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))} />
              )}
              <button type="button" className="bt-icon-btn" title="删除规则" aria-label="删除规则" onClick={() => setFilters(filters.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" className="bt-panel-add" disabled={readOnly || activeTable.fields.length === 0}
            onClick={() => setFilters([...filters, { fieldId: (activeTable.fields[0] ?? activeTable.fields[0]).id, operator: "contains", value: "" }])}><Plus size={14} />添加筛选规则</button>
          <button type="button" className="bt-panel-add danger" disabled={readOnly || filters.length === 0} onClick={() => setFilters([])}><Trash2 size={13} />删除筛选</button>
        </div>
      </Popover>

      <Popover open={panel === "sort"} anchor={menuAnchor} onClose={() => setPanel(null)} width={360}>
        <div className="bt-panel">
          <h4>排序</h4>
          {sorts.map((rule, index) => (
            <div key={index} className="bt-rule-row">
              <SelectMenu value={rule.fieldId} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? changeSortField(r, value) : r)))}
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
            onClick={() => setSorts([...sorts, { fieldId: (activeTable.fields[0] ?? activeTable.fields[0]).id, desc: false }])}><Plus size={14} />添加排序</button>
        </div>
      </Popover>

      <Popover open={panel === "group"} anchor={menuAnchor} onClose={() => setPanel(null)} width={360}>
        <div className="bt-panel">
          <h4>分组（最多 {BITABLE_MAX_GROUPS} 级，可拖动调优先级）</h4>
          {groups.map((rule, index) => (
            <div key={rule.fieldId + ":" + index} className={"bt-rule-row" + (groupDragIndex === index ? " dragging" : "")} draggable={!readOnly}
              onDragStart={() => setGroupDragIndex(index)}
              onDragOver={(event) => { event.preventDefault(); if (groupDragIndex !== null && groupDragIndex !== index) { moveGroupRule(groupDragIndex, index); setGroupDragIndex(index); } }}
              onDragEnd={() => setGroupDragIndex(null)}>
              <GripVertical size={13} className="bt-grip" />
              <SelectMenu value={rule.fieldId} disabled={readOnly}
                onChange={(value) => setGroups(groups.map((item, i) => (i === index ? { ...item, fieldId: value } : item)))}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
              <SelectMenu value={rule.desc ? "desc" : "asc"} disabled={readOnly}
                onChange={(value) => setGroups(groups.map((item, i) => (i === index ? { ...item, desc: value === "desc" } : item)))}
                options={[{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }]} />
              <button type="button" className="bt-icon-btn" title="删除该级分组" aria-label="删除该级分组" disabled={readOnly}
                onClick={() => setGroups(groups.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="bt-rule-row">
              <SelectMenu value="" placeholder="选择一列进行分组" disabled={readOnly}
                onChange={(value) => setGroups([{ fieldId: value, desc: false }])}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
            </div>
          )}
          {groups.length > 0 && groups.length < BITABLE_MAX_GROUPS && (
            <button type="button" className="bt-panel-add" disabled={readOnly}
              onClick={() => {
                const used = new Set(groups.map((item) => item.fieldId));
                const next = activeTable.fields.find((field) => !used.has(field.id));
                if (next) setGroups([...groups, { fieldId: next.id, desc: false }]);
              }}><Plus size={14} />添加分组</button>
          )}
          {groups.length > 0 && (
            <button type="button" className="bt-panel-add danger" disabled={readOnly}
              onClick={() => { setGroups([]); setCollapsedGroups(new Set()); }}><Trash2 size={13} />取消分组</button>
          )}
        </div>
      </Popover>

      <Popover open={panel === "rowHeight"} anchor={menuAnchor} onClose={() => setPanel(null)} width={220}>
        <div className="bt-panel">
          <h4>行高</h4>
          {ROW_HEIGHT_OPTIONS.map((option) => (
            <button key={String(option.value)} type="button" className={"bt-menu-item" + (activeView.rowHeight === option.value ? " is-selected" : "")}
              onClick={() => { patchView(activeView.id, { rowHeight: option.value }); setPanel(null); }}>
              {option.value === "low" ? <Rows2 size={14} /> : option.value === "medium" ? <Rows3 size={14} /> : <Rows4 size={14} />}
              <span className="bt-menu-label">{option.label}</span>
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
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) setFieldEditor({ fieldId: columnMenu.fieldId }); setColumnMenu(null); }}><Pencil size={13} />编辑列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) duplicateField(columnMenu.fieldId); }}><Copy size={13} />复制列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "before"); }}><ChevronRight size={13} />向左插入列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "after"); }}><ChevronRight size={13} />向右插入列</button>
          {/* 260928 用户：「本列分组 / 本列筛选 / 升序 / 降序」四条快捷项**彻底删除**
              （顶部工具栏已经有分组、筛选、排序，不必在列菜单里再来一套） */}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            const on = (activeView.highlightDuplicateFieldIds ?? []).includes(fieldId);
            return (
              <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => {
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
              <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (anchor) setStatFor({ fieldId, anchor }); setColumnMenu(null); }}>统计</button>
            );
          })()}
          {columnMenu && (() => {
            const fieldId = columnMenu.fieldId;
            // 调色板锚到**列头**（不是 ⋯ 按钮）：菜单一关按钮就 display:none、量出来的 rect 是 0×0，
            // 浮层会跑到左上角（260928 用户报「颜色框错位」）
            const anchor = columnMenu.header;
            return (
              <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (anchor) setTextColorFor({ fieldId, anchor }); setColumnMenu(null); }}>文本颜色</button>
            );
          })()}
          <button type="button" className="bt-menu-item danger" disabled={readOnly || activeTable.fields.length <= 1} onClick={() => { if (columnMenu) deleteField(columnMenu.fieldId); }}><Trash2 size={13} />删除列</button>
        </div>
      </Popover>

      {textColorFor && (
        <ColorPalette anchor={textColorFor.anchor} value={(activeView.columnTextColors ?? {})[textColorFor.fieldId]}
          onPick={(color) => patchView(activeView.id, { columnTextColors: { ...(activeView.columnTextColors ?? {}), [textColorFor.fieldId]: color } })}
          onClear={() => patchView(activeView.id, { columnTextColors: Object.fromEntries(Object.entries(activeView.columnTextColors ?? {}).filter(([id]) => id !== textColorFor.fieldId)) })}
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
              <button type="button" className={"bt-menu-item" + (current ? "" : " is-selected")} disabled={readOnly}
                onClick={() => { setColumnStat(field.id, null); setStatFor(null); }}><span className="bt-menu-label">无统计</span>{!current && <Check size={14} />}</button>
              {statsForField(field).map((stat) => (
                <button key={stat} type="button" className={"bt-menu-item" + (current === stat ? " is-selected" : "")} disabled={readOnly}
                  onClick={() => { setColumnStat(field.id, stat); setStatFor(null); }}>
                  <span className="bt-menu-label">{BITABLE_STAT_LABEL[stat]}</span>{current === stat && <Check size={14} />}
                </button>
              ))}
            </div>
          </Popover>
        );
      })()}

      <Popover open={Boolean(viewMenu)} anchor={viewMenu?.anchor ?? null} onClose={() => setViewMenu(null)} width={180}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (viewMenu) setViewEditor(viewMenu.viewId); setViewMenu(null); }}><Pencil size={13} />重命名视图</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (viewMenu) copyView(viewMenu.viewId); }}><Copy size={13} />复制视图</button>
          <button type="button" className="bt-menu-item danger" disabled={readOnly || activeTable.views.length <= 1} onClick={() => { if (viewMenu) deleteView(viewMenu.viewId); }}><Trash2 size={13} />删除视图</button>
        </div>
      </Popover>

      <Popover open={Boolean(tableSwitchAnchor)} anchor={tableSwitchAnchor} onClose={() => setTableSwitchAnchor(null)} width={200}>
        <div className="bt-panel">
          {doc.tables.map((table) => (
            <button key={table.id} type="button" className={"bt-menu-item" + (table.id === activeTable.id ? " is-selected" : "")}
              onClick={() => { setDoc((prev) => ({ ...prev, activeTableId: table.id })); setTableSwitchAnchor(null); }}>
              {table.name}
            </button>
          ))}
        </div>
      </Popover>

      {fieldEditor && (
        <FieldEditorModal
          field={fieldEditor.fieldId ? activeTable.fields.find((f) => f.id === fieldEditor.fieldId) ?? null : null}
          readOnly={readOnly}
          onClose={() => setFieldEditor(null)}
          onSave={(patch, options) => {
            if (fieldEditor.fieldId) updateField(fieldEditor.fieldId, options ? { ...patch, options } : patch);
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
            patchActiveTable((table) => ({ ...table, fields: [...table.fields, field] }));
            setFieldEditor(null);
          }}
        />
      )}

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
            <button type="button" role="menuitem" className="bt-menu-item" disabled={!cellRange}
              onClick={() => { void copySelection(); setRowCtx(null); }}><Copy size={13} />复制</button>
            <button type="button" role="menuitem" className="bt-menu-item" disabled={readOnly || !cellRange}
              onClick={() => { void pasteSelection(); setRowCtx(null); }}><Copy size={13} />粘贴</button>
            <div className="context-menu-sep" />
            <button type="button" role="menuitem" className="bt-menu-item danger" disabled={readOnly}
              onClick={() => { deleteRecords(selectedRecordIds.has(rowCtx.recordId) ? [...selectedRecordIds] : [rowCtx.recordId]); setRowCtx(null); }}>
              <Trash2 size={13} />删除记录
            </button>
        </Menu>
      )}

      <ImageLightbox />
      <AttachmentPreview />

      {drawerRecord && (
        <BitableRecordDrawer
          noteId={noteId}
          table={activeTable}
          record={drawerRecord}
          readOnly={readOnly}
          onClose={() => setDrawerRecordId(null)}
          onPrev={() => stepDrawer(-1)}
          onNext={() => stepDrawer(1)}
          onSetValue={setCellValue}
          onAddOption={(fieldId, name, recordId) => addOption(fieldId, name, recordId)}
          onAddField={openAddField}
          onUpload={(recordId, fieldId, files) => { void uploadFiles(files).then((entries) => appendAttachments(recordId, fieldId, entries)); }}
          onOpenAsset={openAsset}
          onOpenImages={openImages}
        />
      )}
    </div>
  );
}

interface FieldEditorModalProps {
  field: BitableField | null;
  readOnly: boolean;
  onClose: () => void;
  onSave: (patch: Partial<BitableField>, options?: BitableField["options"]) => void;
  onDelete: () => void;
  onAddField: (patch: { name: string; type: string; required?: boolean; options?: BitableField["options"]; defaultValue?: unknown; dateAutoFill?: boolean; progressColor?: string }) => void;
}

function FieldEditorModal({ field, readOnly, onClose, onSave, onDelete, onAddField }: FieldEditorModalProps) {
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
  const supportsOptions = type === "select" || type === "multiSelect";
  const knownType = isKnownFieldType(type) ? (type as BitableFieldType) : null;
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
    if (isNew) { onAddField({ name: name.trim() || fallbackName, type, required, options: supportsOptions ? options : undefined, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor }); return; }
    onSave({ name: name.trim() || field!.name, type, required, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor }, supportsOptions ? options : undefined);
  };
  return (
    <Dialog open onDismiss={onClose} label={isNew ? "新增字段" : "编辑字段"} className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">{isNew ? "新增字段" : "编辑字段"}</h3></header>
      <div className="ln-dialog__body">
        <label className="bt-field-label"><span>字段名称</span>
          <input className="bt-input" autoFocus value={name} readOnly={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="bt-field-label"><span>字段类型</span>
          <FieldTypeGrid value={type} disabled={readOnly} onPick={setType} />
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
                <button type="button" className="bt-color-square" style={{ backgroundColor: optionColorHex(progressColor) ?? "#e8e8e8" }}
                  aria-label="选择进度条颜色" disabled={readOnly}
                  onClick={(event) => setProgressColorAnchor(event.currentTarget)} />
              </div>
            ) : (
              <input className="bt-input" type={knownType === "number" ? "number" : "text"} placeholder={knownType === "link" ? "https://" : undefined}
                value={defaultValue} readOnly={readOnly} onChange={(event) => setDefaultValue(event.target.value)} />
            )}
          </label>
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
                  onChange={(event) => setOptions(options.map((o, i) => (i === index ? { ...o, name: event.target.value } : o)))} />
                <GripVertical size={13} className="bt-grip" />
                <button type="button" className="bt-icon-btn" title="删除选项" aria-label="删除选项" disabled={readOnly}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
              </div>
            ))}
            {progressColorAnchor && (
              <ColorPalette anchor={progressColorAnchor} value={progressColor}
                onPick={(color) => setProgressColor(color)}
                onClose={() => setProgressColorAnchor(null)} />
            )}
            {colorFor && (
              <ColorPalette anchor={colorFor.anchor} value={options.find((o) => o.id === colorFor.optionId)?.color}
                onPick={(color) => setOptions(options.map((o) => (o.id === colorFor.optionId ? { ...o, color } : o)))}
                onClose={() => setColorFor(null)} />
            )}
            <button type="button" className="bt-panel-add" disabled={readOnly}
              onClick={() => setOptions([...options, { id: newBitableId("opt"), name: "选项 " + (options.length + 1), color: BITABLE_OPTION_COLORS[options.length % BITABLE_OPTION_COLORS.length] }])}><Plus size={14} />添加选项</button>
          </div>
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
