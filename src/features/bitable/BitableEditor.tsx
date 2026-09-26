/**
 * 多维表编辑器（kind="bitable"）—— 自研 v1，产品口径见 docs/BITABLE-PRODUCT-SPEC-260919.md。
 *
 * 形态（用户 260919 硬要求）：一个文档 = 多张数据表（左侧列表），为后期「多数据表联合」预留；
 * 三层归属 文档 ⊃ 数据表 ⊃（字段/记录/视图）。视图只暴露「表格视图 + 表单视图」。
 *
 * 关键约束：
 * - 非受控第三方内核：这里是纯 DOM/React 受控实现，隐藏 tab 也能安全渲染（不像 canvas 需 everVisible）。
 * - 自动保存防抖；与上一次序列化相同则跳过（避免「打开即标脏」）。
 * - 只读（回收站/锁定/被他端删除）：所有编辑入口禁用 + 不自动保存。
 * - 附件字段存 filename，走现有 assets/{noteId}/{filename} 资产管线（与文档/小记同一套）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog, Menu } from "../../components/ui/Overlay";
import {
  ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, ClipboardList, Copy, Eye, EyeOff, GripVertical, ListFilter,
  MoreHorizontal, Pencil, Plus, Rows2, Rows3, Rows4, Search, Settings2, Table2, Trash2, X,
} from "lucide-react";
import {
  BITABLE_DOC_KIND, BITABLE_DOC_VERSION, BITABLE_FIELD_TYPES, BITABLE_FIELD_TYPE_LABEL,
  BITABLE_FILTER_OPERATOR_LABEL, BITABLE_OPTION_COLORS, applyViewToRecords, bitableDisplayValue, bitablesToBody, defaultRecordValues, duplicateValues, groupRecords, optionColorHex,
  createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable, filterOperatorsFor,
  isKnownFieldType, newBitableId, orderedTableFields, parseBitableBody,
  type BitableDoc, type BitableField, type BitableFieldType, type BitableFilterRule, type BitableGroupRule, type BitableRecord,
  type BitableRowHeight, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import { uploadLakeResource } from "../editor/resourceUpload.js";
import { ASSET_ORIGIN, withAssetAccessToken } from "../../lib/assetPort.js";
import { openAssetEntry } from "../attachment/openAssetEntry.js";
import { AttachmentPreview } from "../attachment/AttachmentPreview.js";
import { ImageLightbox } from "../editor/ImageLightbox.js";
import { BitableFormView } from "./BitableFormView.js";
import { BitableRecordDrawer } from "./BitableRecordDrawer.js";
import { AttachmentCell, CellEditor, ColorPalette, DatePicker, FieldTypeIcon, Popover, SelectMenu } from "./bitableCells.js";
import { createSnapshotHistory, type SnapshotHistory } from "../../core/bitableHistory.js";
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
  const [panel, setPanel] = useState<null | "fields" | "filter" | "group" | "sort" | "rowHeight">(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  const [textColorFor, setTextColorFor] = useState<{ fieldId: string; anchor: HTMLElement } | null>(null);
  const [configDragId, setConfigDragId] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<{ viewId: string; anchor: HTMLElement } | null>(null);
  const [addViewAnchor, setAddViewAnchor] = useState<HTMLElement | null>(null);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [draggingView, setDraggingView] = useState<{ id: string } | null>(null);
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
  const groupRule = groups[0];
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
    type RowItem = { kind: "group"; key: string; label: string; count: number } | { kind: "record"; record: BitableRecord };
    if (!groupRule) return shownRecords.map((record): RowItem => ({ kind: "record", record }));
    const items: RowItem[] = [];
    for (const group of groupRecords(activeTable, shownRecords, groupRule)) {
      items.push({ kind: "group", key: group.key, label: group.label, count: group.records.length });
      if (!collapsedGroups.has(group.key)) for (const record of group.records) items.push({ kind: "record", record });
    }
    return items;
  }, [shownRecords, activeTable, groupRule, collapsedGroups]);
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

  const setCellValue = useCallback((recordId: string, fieldId: string, value: unknown) => {
    patchActiveTable((table) => ({
      ...table,
      records: table.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [fieldId]: value }, updatedAt: stamp() } : r)),
    }));
  }, [patchActiveTable]);

  const uploadFiles = useCallback(async (files: File[]): Promise<string[]> => {
    const names: string[] = [];
    for (const file of files) {
      const out = await uploadLakeResource(file, noteId);
      names.push(out.filename);
    }
    return names;
  }, [noteId]);

  /** 打开附件：走公共入口 openAssetEntry（与文档/小记同一套分流）。 */
  const openAsset = useCallback((filename: string) => {
    openAssetEntry(withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + filename), filename, 0);
  }, [noteId]);

  const appendAttachments = useCallback((recordId: string, fieldId: string, filenames: string[]) => {
    patchActiveTable((table) => ({
      ...table,
      records: table.records.map((r) => {
        if (r.id !== recordId) return r;
        const current = Array.isArray(r.values[fieldId]) ? (r.values[fieldId] as string[]) : [];
        return { ...r, values: { ...r.values, [fieldId]: [...current, ...filenames] }, updatedAt: stamp() };
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
  const addView = useCallback((type: "grid" | "form") => {
    patchActiveTable((table) => {
      const view = createBitableView(type);
      if (type === "form") view.formFieldIds = table.fields.map((f) => f.id);
      return { ...table, views: [...table.views, view], activeViewId: view.id };
    });
    setAddViewAnchor(null);
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
  const addField = useCallback((type: BitableFieldType) => {
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
    patchActiveTable((table) => ({ ...table, records: [...table.records, { ...record, values: defaultRecordValues(table) }] }));
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

  useEffect(() => { localStorage.setItem("lake-notes-v3.bitable-tables-width", String(tablesWidth)); }, [tablesWidth]);
  useEffect(() => { localStorage.setItem("lake-notes-v3.bitable-tables-collapsed", tablesCollapsed ? "1" : "0"); }, [tablesCollapsed]);

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
  const toggleGroup = (key: string) => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const openDrawer = (recordId: string) => setDrawerRecordId(recordId);
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
          if (field.type === "number") value = t === "" ? "" : Number(t);
          else if (field.type === "select") { const opt = (field.options ?? []).find((o) => o.name === t); if (!opt) return; value = opt.id; }
          else if (field.type === "multiSelect") { value = t.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((n) => (field.options ?? []).find((o) => o.name === n)?.id).filter((x): x is string => !!x); }
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
      // 焦点在输入/可编辑区，或附件格（它自己处理 onPaste 图片）时，不要拦截 Cmd+C/V，
      // 否则 preventDefault 会把原生 paste 事件挡掉，附件格永远收不到粘贴。
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const inAttachment = !!el && typeof el.closest === "function" && !!el.closest(".bt-attachment-cell");
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
          className={"bt-td" + (selectedColumnId === field.id ? " col-selected" : "") + (cellInSelection(record.id, field.id) ? " cell-selected" : "") + (isDuplicateCell(field, record) ? " in-highlight" : "")}
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
            value={record.values[field.id]}
            readOnly={readOnly}
            onChange={(value) => setCellValue(record.id, field.id, value)}
            onAddOption={(name) => addOption(field.id, name, record.id)}
            renderAttachment={() => (
              <AttachmentCell
                noteId={noteId}
                value={record.values[field.id]}
                readOnly={readOnly}
                onUpload={(files) => { void uploadFiles(files).then((names) => appendAttachments(record.id, field.id, names)); }}
                onRemove={(filename) => { const current = Array.isArray(record.values[field.id]) ? (record.values[field.id] as string[]) : []; setCellValue(record.id, field.id, current.filter((f) => f !== filename)); }}
                onOpen={(filename) => { void openAsset(filename); }}
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
        {chrome && <div className="bt-viewbar">
          {tablesCollapsed && (
            <div className="bt-viewbar-leading">
              <button type="button" className="bt-icon-btn" title="展开数据表列表" aria-label="展开数据表列表" onClick={() => setTablesCollapsed(false)}><ChevronsRight size={15} /></button>
              <button type="button" className="bt-tables-switch" title="切换数据表" onClick={(event) => setTableSwitchAnchor(event.currentTarget)}>
                <span className="bt-tables-switch-name">{activeTable.name}</span><ChevronDown size={13} />
              </button>
            </div>
          )}
          {activeTable.views.map((view) => (
            <div key={view.id}
              className={"bt-view-tab" + (view.id === activeView.id ? " active" : "") + (draggingView?.id === view.id ? " dragging" : "")}
              draggable={!readOnly}
              onDragStart={() => setDraggingView({ id: view.id })}
              onDragOver={(event: DragEvent) => { if (draggingView && draggingView.id !== view.id) reorderViews(draggingView.id, view.id); }}
              onDragEnd={() => setDraggingView(null)}>
              <button type="button" className="bt-view-name" onClick={() => setActiveView(view.id)} onDoubleClick={() => setViewEditor(view.id)}>
                <span className="bt-view-icon" aria-hidden="true">{view.type === "form" ? <ClipboardList size={13} /> : <Table2 size={13} />}</span>{view.name}
              </button>
              <button type="button" className="bt-view-more" title="视图操作" aria-label="视图操作" disabled={readOnly}
                onClick={(event) => setViewMenu({ viewId: view.id, anchor: event.currentTarget })}><ChevronDown size={12} /></button>
            </div>
          ))}
          <button type="button" className="bt-icon-btn" title="新建视图" aria-label="新建视图" disabled={readOnly}
            onClick={(event) => setAddViewAnchor(event.currentTarget)}><Plus size={14} /></button>
        </div>}

        {chrome && <div className="bt-toolbar">
          <button type="button" className={"bt-tool-btn" + (panel === "fields" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "fields" ? null : "fields"); }}>
            <Settings2 size={14} />表格配置
          </button>
          <button type="button" className={"bt-tool-btn" + (panel === "filter" ? " is-active" : "")}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
              if (panel === "filter") { setPanel(null); return; }
              if (filters.length === 0 && activeTable.fields.length > 0) setFilters([{ fieldId: activeTable.fields[0].id, operator: "contains", value: "" }]);
              setPanel("filter");
            }}>
            <ListFilter size={14} />筛选{filters.length > 0 && <span className="bt-badge">{filters.length}</span>}
          </button>
          <button type="button" className={"bt-tool-btn" + (panel === "group" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "group" ? null : "group"); }}>
            <Rows2 size={14} />分组{groups.length > 0 && <span className="bt-badge">{groups.length}</span>}
          </button>
          <button type="button" className={"bt-tool-btn" + (panel === "sort" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "sort" ? null : "sort"); }}>
            <ArrowUpDown size={14} />排序{sorts.length > 0 && <span className="bt-badge">{sorts.length}</span>}
          </button>
          <button type="button" className={"bt-tool-btn" + (panel === "rowHeight" ? " is-active" : "")}
            onClick={(event) => { setMenuAnchor(event.currentTarget); setPanel(panel === "rowHeight" ? null : "rowHeight"); }}>
            <Rows3 size={14} />行高
          </button>
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
            onOpenAsset={(filename) => { void openAsset(filename); }}
          />
        ) : (
          <div className="bt-grid-wrap" style={gridStyle} onKeyDown={onGridKeyDown}>
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
                      className={"bt-th" + (dragging?.kind === "field" && dragging.id === field.id ? " dragging" : "") + (selectedColumnId === field.id ? " col-selected" : "")}
                      draggable={!readOnly}
                      onDragStart={() => setDragging({ kind: "field", id: field.id })}
                      onDragOver={(event: DragEvent) => { event.preventDefault(); reorderByDrag("field", field.id); }}
                      onDragEnd={() => setDragging(null)}>
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
                          onClick={(event) => { event.stopPropagation(); setColumnMenu({ fieldId: field.id, anchor: event.currentTarget }); }}><ChevronDown size={12} /></button>
                        <span className="bt-col-resize" onPointerDown={(event) => startColumnResize(event, field.id, field.width ?? DEFAULT_COL_WIDTH)} onClick={(event) => event.stopPropagation()} title="拖动调整列宽" />
                      </span>
                    </th>
                  ))}
                  <th className="bt-th-add">
                    <button type="button" className="bt-add-col" title="新增字段" aria-label="新增字段" disabled={readOnly}
                      onClick={(event) => setAddFieldAnchor(event.currentTarget)}><Plus size={14} /></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowItems.map((item) => item.kind === "group" ? (
                  <tr key={"g:" + item.key} className="bt-group-row" onClick={() => toggleGroup(item.key)}>
                    <td className="bt-group-cell" colSpan={visibleFields.length + 2}>
                      <ChevronRight size={13} className={"bt-group-caret" + (collapsedGroups.has(item.key) ? "" : " is-open")} />
                      <span className="bt-group-label">{item.label}</span>
                      <span className="bt-group-count">{item.count}</span>
                    </td>
                  </tr>
                ) : (
                  renderRecordRow(item.record, rowIndexById.get(item.record.id) ?? 0)
                ))}

                <tr className="bt-add-row">
                  <td colSpan={visibleFields.length + 1}>
                    <button type="button" className="bt-add-record-row" disabled={readOnly} onClick={() => addRecord()}><Plus size={14} />添加记录</button>
                  </td>
                  <td />
                </tr>
              </tbody>
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
            onClick={() => setFilters([...filters, { fieldId: activeTable.fields[0].id, operator: "contains", value: "" }])}><Plus size={14} />添加筛选规则</button>
          <button type="button" className="bt-panel-add danger" disabled={readOnly || filters.length === 0} onClick={() => setFilters([])}><Trash2 size={13} />删除筛选</button>
        </div>
      </Popover>

      <Popover open={panel === "sort"} anchor={menuAnchor} onClose={() => setPanel(null)} width={360}>
        <div className="bt-panel">
          <h4>排序</h4>
          {sorts.map((rule, index) => (
            <div key={index} className="bt-rule-row">
              <SelectMenu value={rule.fieldId} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? { ...r, fieldId: value } : r)))}
                options={activeTable.fields.map((f) => ({ value: f.id, label: f.name }))} />
              <SelectMenu value={rule.desc ? "desc" : "asc"} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? { ...r, desc: value === "desc" } : r)))}
                options={[{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }]} />
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
              <button type="button" className="bt-icon-btn" title="取消分组" aria-label="取消分组"
                onClick={() => { patchView(activeView.id, { groups: [] }); setCollapsedGroups(new Set()); }}><X size={13} /></button>
              <SelectMenu value={groupRule.fieldId}
                onChange={(value) => patchView(activeView.id, { groups: [{ ...groupRule, fieldId: value }] })}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
              <SelectMenu value={groupRule.desc ? "desc" : "asc"}
                onChange={(value) => patchView(activeView.id, { groups: [{ fieldId: groupRule.fieldId, desc: value === "desc" }] })}
                options={[{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }]} />
            </div>
          ) : (
            <div className="bt-rule-row">
              <SelectMenu value="" placeholder="选择一列进行分组"
                onChange={(value) => patchView(activeView.id, { groups: [{ fieldId: value, desc: false }] })}
                options={activeTable.fields.map((field) => ({ value: field.id, label: field.name }))} />
            </div>
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

      <Popover open={Boolean(addViewAnchor)} anchor={addViewAnchor} onClose={() => setAddViewAnchor(null)} width={200}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item" onClick={() => addView("grid")}>表格视图</button>
          <button type="button" className="bt-menu-item" onClick={() => addView("form")}>表单视图</button>
        </div>
      </Popover>

      <Popover open={Boolean(addFieldAnchor)} anchor={addFieldAnchor} onClose={() => setAddFieldAnchor(null)} width={200}>
        <div className="bt-panel">
          <h4>字段类型</h4>
          {BITABLE_FIELD_TYPES.map((type) => (
            <button key={type} type="button" className="bt-menu-item" onClick={() => addField(type)}>
              <FieldTypeIcon type={type} />{BITABLE_FIELD_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </Popover>

      <Popover open={Boolean(columnMenu)} anchor={columnMenu?.anchor ?? null} onClose={() => setColumnMenu(null)} width={200}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) setFieldEditor({ fieldId: columnMenu.fieldId }); setColumnMenu(null); }}><Pencil size={13} />编辑列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) duplicateField(columnMenu.fieldId); }}><Copy size={13} />复制列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "before"); }}><ChevronRight size={13} />向左插入列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) insertField(columnMenu.fieldId, "after"); }}><ChevronRight size={13} />向右插入列</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) patchView(activeView.id, { groups: [{ fieldId: columnMenu.fieldId, desc: false }] }); setColumnMenu(null); }}><Rows2 size={13} />按本列分组</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) setFilters([...filters, { fieldId: columnMenu.fieldId, operator: "contains", value: "" }]); setColumnMenu(null); }}><ListFilter size={13} />按本列筛选</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) setSorts([{ fieldId: columnMenu.fieldId, desc: false }]); setColumnMenu(null); }}><ArrowUpDown size={13} />升序</button>
          <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { if (columnMenu) setSorts([{ fieldId: columnMenu.fieldId, desc: true }]); setColumnMenu(null); }}><ArrowUpDown size={13} />降序</button>
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
            const anchor = columnMenu.anchor;
            return (
              <button type="button" className="bt-menu-item" disabled={readOnly} onClick={() => { setTextColorFor({ fieldId, anchor }); setColumnMenu(null); }}>文本颜色</button>
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

      <Popover open={Boolean(viewMenu)} anchor={viewMenu?.anchor ?? null} onClose={() => setViewMenu(null)} width={180}>
        <div className="bt-panel">
          <button type="button" className="bt-menu-item" onClick={() => { if (viewMenu) setViewEditor(viewMenu.viewId); setViewMenu(null); }}><Pencil size={13} />重命名视图</button>
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
            patchActiveTable((table) => ({ ...table, fields: [...table.fields, field] }));
            setFieldEditor(null);
          }}
        />
      )}

      {viewEditor && (
        <Dialog open onDismiss={() => setViewEditor(null)} label="重命名视图" className="bt-dialog">
          <header className="ln-dialog__head"><h3 className="ln-dialog__title">重命名视图</h3></header>
          <div className="ln-dialog__body">
            <input ref={viewNameRef} autoFocus className="bt-input" defaultValue={activeTable.views.find((v) => v.id === viewEditor)?.name ?? ""}
              onKeyDown={(event) => {
                if (event.key === "Enter") { patchView(viewEditor, { name: (event.target as HTMLInputElement).value.trim() || "视图" }); setViewEditor(null); }
              }} />
          </div>
          <div className="ln-dialog__actions">
            <button type="button" className="bt-secondary" onClick={() => setViewEditor(null)}>取消</button>
            <button type="button" className="bt-primary" onClick={() => {
              patchView(viewEditor, { name: viewNameRef.current?.value.trim() || "视图" });
              setViewEditor(null);
            }}>确定</button>
          </div>
        </Dialog>
      )}

      {rowCtx && (
        <Menu className="bt-row-menu" onDismiss={() => setRowCtx(null)} style={{ left: Math.min(rowCtx.x, window.innerWidth - 160), top: Math.min(rowCtx.y, window.innerHeight - 90) }}>
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
          onUpload={(recordId, fieldId, files) => { void uploadFiles(files).then((names) => appendAttachments(recordId, fieldId, names)); }}
          onOpenAsset={(filename) => { void openAsset(filename); }}
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
  onAddField: (patch: { name: string; type: string; required?: boolean; options?: BitableField["options"]; defaultValue?: unknown }) => void;
}

function FieldEditorModal({ field, readOnly, onClose, onSave, onDelete, onAddField }: FieldEditorModalProps) {
  const isNew = field === null;
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<string>(field?.type ?? "text");
  const [required, setRequired] = useState<boolean>(field?.required ?? false);
  const [options, setOptions] = useState(field?.options ?? []);
  const [optionDragId, setOptionDragId] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<{ optionId: string; anchor: HTMLElement } | null>(null);
  const [defaultValue, setDefaultValue] = useState<string>(
    typeof field?.defaultValue === "string" || typeof field?.defaultValue === "number" ? String(field.defaultValue) : "",
  );
  const supportsOptions = type === "select" || type === "multiSelect";
  const knownType = isKnownFieldType(type) ? (type as BitableFieldType) : null;
  const parseDefault = (): unknown => {
    if (!knownType) return undefined;
    if (knownType === "number") return defaultValue === "" ? undefined : Number(defaultValue);
    if (knownType === "text" || knownType === "date" || knownType === "select") return defaultValue === "" ? undefined : defaultValue;
    return undefined;
  };
  const save = () => {
    const fallbackName = BITABLE_FIELD_TYPE_LABEL[knownType ?? "text"];
    const nextDefault = parseDefault();
    if (isNew) { onAddField({ name: name.trim() || fallbackName, type, required, options: supportsOptions ? options : undefined, defaultValue: nextDefault }); return; }
    onSave({ name: name.trim() || field!.name, type, required, defaultValue: nextDefault }, supportsOptions ? options : undefined);
  };
  return (
    <Dialog open onDismiss={onClose} label={isNew ? "新增字段" : "编辑字段"} className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">{isNew ? "新增字段" : "编辑字段"}</h3></header>
      <div className="ln-dialog__body">
        <label className="bt-field-label"><span>字段名称</span>
          <input className="bt-input" autoFocus value={name} readOnly={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="bt-field-label"><span>字段类型</span>
          <SelectMenu value={type} disabled={readOnly} onChange={setType}
            options={[...(knownType ? [] : [{ value: type, label: type + "（未知）" }]), ...BITABLE_FIELD_TYPES.map((t) => ({ value: t, label: BITABLE_FIELD_TYPE_LABEL[t] }))]} />
        </div>
        <label className="bt-field-check"><input type="checkbox" checked={required} disabled={readOnly} onChange={(event) => setRequired(event.target.checked)} />必填</label>
        {(knownType === "text" || knownType === "number" || knownType === "date" || knownType === "select") && (
          <label className="bt-field-label"><span>默认值（新建记录时预填）</span>
            {knownType === "select" ? (
              <SelectMenu value={defaultValue} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} />
            ) : knownType === "date" ? (
              <DatePicker value={defaultValue} readOnly={readOnly} onChange={(value) => setDefaultValue(typeof value === "string" ? value : "")} />
            ) : (
              <input className="bt-input" type={knownType === "number" ? "number" : "text"}
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
