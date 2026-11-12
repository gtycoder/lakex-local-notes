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
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorHostProps } from "../editor/editorHost";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { Dialog, Menu } from "../../components/ui/Overlay";
import { ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, Copy, Download, Eye, EyeOff, FileUp, GripVertical, ListFilter, Lock, LockOpen, MoreHorizontal, PaintBucket, Pencil, Plus, Rows2, Rows3, Rows4, Search, Settings2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import type { BitableAttachment, BitableField, BitableFieldType, BitableFilterJoin, BitableFilterNode, BitableGroupRule, BitableRecord, BitableSortMode, BitableStatType, BitableTable, BitableView } from "../../core/bitableDoc.js";
import { BITABLE_OPTION_COLORS, BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, BITABLE_ROW_HEIGHT_OPTIONS, BITABLE_STAT_LABEL, applySortMode, applyViewToRecords, bitableDisplayValue, bitableFieldText, bitableFieldValue, bitableFillBackgroundTokens, bitableFilterRuleCount, bitableRowHeightPx, bitableViewNeedsClock, buildBitableFillProjection, changeSortField, createBitableField, createRelationPair, defaultRecordValues, duplicateValues, groupRecords, isImplementedViewType, isKnownFieldType, isRelationFieldType, kanbanGroupField, newBitableId, orderedAllTableFields, orderedTableFields, sortModeLabel, sortModeOf, sortModesForField, statDisplayText, statForField, statsForField, unpairRelationFields } from "../../core/bitableDoc.js";
import { checkDocBody } from "../../core/docBodySafety.js";
import { fillSurfaceColor } from "../../core/colorPalette.js";
import { addBitableRecordWithValues, appendBitableAttachments, convertBitableFieldType, pruneBitableOptionValues, setBitableCellValue, setBitableRecordValues } from "../../core/bitableMutations.js";
import { applyBitableNav, readBitableNav, writeBitableNav } from "./bitableNavStore.js";
import { StatCell } from "./bitableCells";
import { BitableCsvImportDialog } from "./BitableCsvImportDialog.js";
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
import { ColorPalette, FieldTypeGrid, FieldTypeIcon, Popover, SelectMenu } from "./bitableCells.js";
import { BitableFillEditor } from "./BitableFillEditor.js";
import { BitableFilterEditor } from "./BitableFilterEditor.js";
import { useBitableSession } from "./useBitableSession";
import { BitableViewFallback, ViewTypeIcon } from "./bitableViews.js";
import type { AiGenerateMode } from "./BitableAiGenerateDialog.js";
import { BitableAiGenerateDialog, isAiCellEmpty } from "./BitableAiGenerateDialog.js";
import { aiCellKey, useAiFieldGeneration } from "./useAiFieldGeneration.js";
import type { BitableViewportHandle } from "./BitableVirtualBody";
import { BitableVirtualBody } from "./BitableVirtualBody";
import { BitableViewportCell } from "./BitableViewportCell";
import { DEFAULT_COL_WIDTH, RowExpandIcon, columnWidth, defaultBitableDoc, isGridShortcut, moveItem, stamp } from "./bitableEditorModel";
import { FieldEditorModal } from "./FieldEditorModal";
import { useBitableChromeMenu } from "./useBitableChromeMenu";
import { useBitableTables } from "./useBitableTables";
import { useBitableViews } from "./useBitableViews";
import { useBitableFields } from "./useBitableFields";
import { useBitableRecords } from "./useBitableRecords";
import { useBitableImport } from "./useBitableImport";
import "./bitableEditor.css";

/** DT-06：共用 prop 词表见 features/editor/editorHost.ts，这里只补宿主专有项。 */
export interface BitableEditorProps extends EditorHostProps {
  /** 进入只读时保留先前合法但尚未发布的输入；不写回只读正文。 */
  onPreserveDraft?: (content: string) => void;
  /** 是否显示编辑器外壳（数据表列表 / 视图页签 / 工具条，默认 true）。历史快照预览传 false。 */
  chrome?: boolean;
  /** 文档是否处于「锁定（只读）」态（与 readOnly 区分：readOnly 还包含回收站 / 被他端 purge）。 */
  locked?: boolean;
  /** 切换当前文档锁定（只读）——由外壳注入；不传则不显示「锁定」入口。 */
  onToggleLock?: () => void;
  /** 从本编辑器导出当前数据表 CSV（由外壳注入导出管线）。 */
  onExportCsv?: () => void;
}

export function BitableEditor({ noteId, content, visible, readOnly: readOnlyProp, locked = false, focused, pane, onChange, onPreserveDraft, onDirty, onCapture: onEditorCapture, onToggleLock, onExportCsv, chrome = true }: BitableEditorProps) {
  /**
   * CORE-02：判据收口在 core（usheet / board / ink / bitable 同一套 `checkDocBody`）。
   * 空正文 = ok + 默认空表（新建/清空，仍可编辑）；非空但解析失败 / 结构不对 ⇒ **只读兜底 + 横幅**，
   * 绝不把它当成"空表"让人继续写（261019 review：旧行为 parse 失败静默换默认表，用户一编辑就覆盖原文）。
   * 只在挂载时判定一次：只读态下正文不会被本组件改写，重载走 reloadKey 重新挂载。
   */
  const [bodyCheck] = useState(() => checkDocBody("bitable", content));
  const bodyUnreadable = bodyCheck.status === "unreadable";
  const readOnly = readOnlyProp || bodyUnreadable;
  /** 打开时的文档 = core 判据给出的 doc（空正文即默认表）；只对「真实编辑器」应用设备本地导航。 */
  const [initial] = useState(() => {
    const base = bodyCheck.status === "ok" ? bodyCheck.doc : defaultBitableDoc();
    return chrome ? applyBitableNav(base, readBitableNav(noteId)) : base;
  });
  const { doc, docRef, updateDoc, navigateDoc, beginGesture, endGesture, undoEdit, redoEdit } = useBitableSession(
    () => initial, { readOnly, onChange, onPreserveDraft, onDirty, onEditorCapture },
  );
  // C（261006）：导航变化只落 localStorage（不进正文）。`navSig` 只在切表/切视图时变，正文编辑不会触发。
  const navSig = doc.activeTableId + "|" + doc.tables.map((table) => `${table.id}:${table.activeViewId}`).join(",");
  useEffect(() => {
    if (!chrome) return; // 历史快照预览不写，免得把真实文档的导航覆盖成快照里的
    const viewIds: Record<string, string> = {};
    for (const table of doc.tables) viewIds[table.id] = table.activeViewId;
    writeBitableNav(noteId, { tableId: doc.activeTableId, viewIds });
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

  // ---- 面板/浮层状态（261112 R1-S2：状态由 useBitableChromeMenu 持有，局部名字保持不变）----
  const chromeMenu = useBitableChromeMenu();
  const { rowMenuPos, panel, setPanel, menuAnchor, setMenuAnchor, columnMenu, setColumnMenu, textColorFor, setTextColorFor, statFor, setStatFor, configDragId, setConfigDragId, viewMenu, setViewMenu, addFieldAnchor, setAddFieldAnchor, fieldEditor, setFieldEditor, aiGenerateFieldId, setAiGenerateFieldId, viewEditor, setViewEditor, tableEditor, setTableEditor, tableMenu, setTableMenu, csvImport, setCsvImport, csvResult, setCsvResult, findOpen, setFindOpen, moreAnchor, setMoreAnchor, findQuery, setFindQuery, drawerRecordId, setDrawerRecordId, selectedRecordIds, setSelectedRecordIds, dragging, setDragging, rowDragId, setRowDragId, rowDragOverId, setRowDragOverId, rowCtx, setRowCtx, viewNameRef } = chromeMenu;
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<BitableViewportHandle | null>(null);
  const cancelRowDragRef = useRef<(() => void) | null>(null);
  const pendingFocusRef = useRef<{ recordId: string; fieldId: string; tableId: string; viewId: string } | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [tableSwitchAnchor, setTableSwitchAnchor] = useState<HTMLElement | null>(null);
  const [cellSel, setCellSel] = useState<{ anchor: { recordId: string; fieldId: string }; focus: { recordId: string; fieldId: string } } | null>(null);
  const cellSelectingRef = useRef(false);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** 已折叠的分组 key（本机展示态，不进正文）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [tablesWidth, setTablesWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lakex-local-notes-v3.bitable-tables-width"));
    return Number.isFinite(v) && v >= 140 && v <= 420 ? v : 190;
  });
  const [tablesCollapsed, setTablesCollapsed] = useState<boolean>(() => localStorage.getItem("lakex-local-notes-v3.bitable-tables-collapsed") === "1");

  const activeTable = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];
  const activeView = activeTable.views.find((v) => v.id === activeTable.activeViewId) ?? activeTable.views[0];
  const groupRule = activeView.groups?.[0];
  /** CORE-06：视图里是否存在「动态日期」条件（决定 clock 是否参与重算）。 */
  const needsClock = useMemo(() => bitableViewNeedsClock(activeTable, activeView), [activeTable, activeView]);
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
  // CORE-06（重算时机）：只有筛选 / 填色里真的存在动态日期条件时，clock 才参与重算。
  // 全是静态条件时，切回窗口或跨日把整表重算一遍（5k≈40ms、20k≈100ms）是纯浪费；
  // 求值本身仍只走 applyViewToRecords / buildBitableFillProjection（不改变单一来源）。
  const clockKey = needsClock ? clock.getTime() : 0;
  const viewRecords = useMemo(() => applyViewToRecords(activeTable, activeView), [activeTable, activeView, needsClock, clockKey]);
  const shownRecords = useMemo(() => {
    if (!findQuery.trim()) return viewRecords;
    const q = findQuery.trim().toLowerCase();
    // 走统一展示口径：附件不再变 "[object Object]"，布尔/系统时间也能搜到
    return viewRecords.filter((record) => activeTable.fields.some((field) => bitableFieldText(record, field, displayCtx).toLowerCase().includes(q)));
  }, [viewRecords, findQuery, activeTable, displayCtx]);
  const fillProjection = useMemo(
    () => buildBitableFillProjection(activeTable, activeView, shownRecords),
    [activeTable, activeView, shownRecords, needsClock, clockKey],
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
  const rowIndexById = useMemo(() => {
    const index = new Map<string, number>();
    for (let i = 0; i < shownRecords.length; i++) index.set(shownRecords[i].id, i);
    return index;
  }, [shownRecords]);
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
  const rowItemKey = useCallback((item: (typeof rowItems)[number]) => item.kind === "record" ? "r:" + item.record.id : item.kind + ":" + item.key, []);
  const estimateRow = useCallback((item: (typeof rowItems)[number]) => item.kind === "record" ? bitableRowHeightPx(activeView.rowHeight) : item.kind === "gap" ? 20 : item.kind === "groupAdd" ? 32 : 36, [activeView.rowHeight]);
  const itemIndexByRecordId = useMemo(() => {
    const index = new Map<string, number>();
    for (let i = 0; i < rowItems.length; i++) {
      const item = rowItems[i];
      if (item.kind === "record") index.set(item.record.id, i);
    }
    return index;
  }, [rowItems]);
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

  const { addTable, renameTable, deleteTable, duplicateTable, reorderTables } = useBitableTables({ updateDoc, moveItem });
  const { reorderViews, addView, deleteView, copyView, renameView, setActiveView } = useBitableViews({ updateDoc, patchActiveTable, navigateDoc, docRef, moveItem, chrome: chromeMenu });
  const { addField, openAddField, updateField, deleteField, duplicateField, insertField, reorderVisibleFields, reorderPanelFields, toggleFieldHidden } = useBitableFields({ patchActiveTable, updateDoc, docRef, moveItem, chrome: chromeMenu });
  const { addRecord, addRecordInGroup, deleteRecords, reorderRecords } = useBitableRecords({ updateDoc, patchActiveTable, docRef, moveItem, chrome: chromeMenu });
  const { startCsvImport, confirmCsvImport } = useBitableImport({ readOnlyRef, activeTable, docRef, updateDoc, chrome: chromeMenu });
  /** 行手柄拖拽排序（指针式，对齐云端：默认只显示行号，hover 出行手柄；手柄按下后按 Y 找落点）。 */
  const startRowDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, recordId: string) => {
    if (readOnlyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    let over: string | null = null;
    let pointerY = event.clientY;
    let frame = 0;
    setRowDragId(recordId);
    const hitRow = () => {
      const wrap = rootRef.current?.querySelector<HTMLElement>(".bt-grid-wrap");
      const rect = wrap?.getBoundingClientRect();
      const y = rect ? Math.max(rect.top + 40, Math.min(rect.bottom - 30, pointerY)) : pointerY;
      const itemIndex = viewportRef.current?.rowAt(y);
      const item = itemIndex == null ? null : rowItems[itemIndex];
      over = item?.kind === "record" ? item.record.id : null;
      setRowDragOverId(over);
    };
    const onMove = (ev: PointerEvent) => { pointerY = ev.clientY; hitRow(); };
    const tick = () => {
      const wrap = rootRef.current?.querySelector<HTMLElement>(".bt-grid-wrap");
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const step = pointerY < rect.top + 45 ? -20 : pointerY > rect.bottom - 45 ? 20 : 0;
        if (step) { wrap.scrollTop += step; hitRow(); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      cancelRowDragRef.current = null;
      if (commit && !readOnlyRef.current && over && over !== recordId) reorderRecords(recordId, over);
      setRowDragId(null);
      setRowDragOverId(null);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    cancelRowDragRef.current?.();
    cancelRowDragRef.current = onCancel;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }, [reorderRecords, rowItems]);
  useEffect(() => {
    if (!visible || readOnly) cancelRowDragRef.current?.();
    return () => cancelRowDragRef.current?.();
  }, [visible, readOnly, activeTable.id, activeView.id]);

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

  useEffect(() => { writeLocalStorage("lakex-local-notes-v3.bitable-tables-width", String(tablesWidth)); }, [tablesWidth]);
  useEffect(() => { writeLocalStorage("lakex-local-notes-v3.bitable-tables-collapsed", tablesCollapsed ? "1" : "0"); }, [tablesCollapsed]);

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

  const gridStyle = { "--bt-row-h": bitableRowHeightPx(activeView.rowHeight) + "px" } as CSSProperties;
  // With no data cells, the original trailing column is only the 24px add button + padding/border.
  const gridTrailingWidth = shownRecords.length > 0 ? 40 : 33;
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
  useEffect(() => {
    if (!visible || readOnly) return;
    let frame: number | null = null;
    const move = (event: MouseEvent) => {
      if (!cellSelectingRef.current) return;
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
      if (frame !== null) return;
      const tick = () => {
        if (!cellSelectingRef.current) { frame = null; return; }
        const point = selectionPointerRef.current;
        const wrap = rootRef.current?.querySelector<HTMLElement>(".bt-grid-wrap");
        if (point && wrap) {
          const rect = wrap.getBoundingClientRect();
          const speed = point.y < rect.top + 50 ? -20 : point.y > rect.bottom - 50 ? 20 : 0;
          if (speed) {
            wrap.scrollTop += speed;
            const y = Math.max(rect.top + 40, Math.min(rect.bottom - 30, point.y));
            const td = document.elementFromPoint(point.x, y)?.closest<HTMLElement>("td[data-record-id][data-field-id]");
            if (td && rootRef.current?.contains(td)) setCellSel(current => current ? { anchor: current.anchor, focus: { recordId: td.dataset.recordId!, fieldId: td.dataset.fieldId! } } : current);
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener("mousemove", move);
    return () => { document.removeEventListener("mousemove", move); if (frame !== null) cancelAnimationFrame(frame); };
  }, [visible, readOnly]);
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
   * 这里实测一次写进 CSS 变量交给 chrome.css 消费，姿势与 UniverSheetEditor 的状态栏让位一致。
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
    const request = { recordId, fieldId, tableId: activeTable.id, viewId: activeView.id };
    pendingFocusRef.current = request;
    if (!itemIndexByRecordId.has(recordId)) {
      const group = rowItems.find(item => item.kind === "group" && item.records.some(record => record.id === recordId));
      if (group?.kind === "group") setCollapsedGroups(current => { const next = new Set(current); next.delete(group.key); return next; });
    }
    else void focusVirtualCell(request);
  };
  async function focusVirtualCell(request: NonNullable<typeof pendingFocusRef.current>) {
    const index = itemIndexByRecordId.get(request.recordId);
    if (index === undefined) return;
    await viewportRef.current?.ensureRow(index);
    if (pendingFocusRef.current !== request || interactionRef.current.tableId !== request.tableId || interactionRef.current.viewId !== request.viewId) return;
    const td = rootRef.current?.querySelector<HTMLElement>(`td[data-record-id="${request.recordId}"][data-field-id="${request.fieldId}"]`);
    const el = td?.querySelector<HTMLElement>("input, textarea, button, [tabindex]");
    el?.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement) el.select();
    pendingFocusRef.current = null;
  }
  useEffect(() => {
    const request = pendingFocusRef.current;
    if (request) void focusVirtualCell(request);
  }, [itemIndexByRecordId]);
  const onGridKeyDown = (event: ReactKeyboardEvent) => {
    if (readOnly || event.nativeEvent.isComposing) return;
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

  const selectViewportCell = useCallback((event: React.MouseEvent, recordId: string, fieldId: string) => {
    if (readOnlyRef.current || event.button !== 0) return;
    const point = { recordId, fieldId };
    setCellSel(current => event.shiftKey && current ? { anchor: current.anchor, focus: point } : { anchor: point, focus: point });
    cellSelectingRef.current = true;
    selectionPointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  const extendViewportSelection = useCallback((recordId: string, fieldId: string) => {
    if (cellSelectingRef.current) setCellSel(current => current ? { anchor: current.anchor, focus: { recordId, fieldId } } : current);
  }, []);
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
      {visibleFields.map(field => <BitableViewportCell
        key={field.id} field={field} maxWidth={columnWidth(field)} value={record.values[field.id]} recordId={record.id} tableId={activeTable.id}
        record={field.type === "createdTime" || field.type === "updatedTime" ? record : undefined}
        context={isRelationFieldType(field.type) ? displayCtx : undefined}
        readOnly={readOnly} noteId={noteId}
        selected={(selectedColumnId === field.id ? " col-selected" : "") + (cellInSelection(record.id, field.id) ? " cell-selected" + selectionEdgeClass(record.id, field.id) : "")}
        duplicate={isDuplicateCell(field, record)} background={fillBackgroundImage(record.id, field.id)} color={columnTextColor(field.id)}
        onSelect={selectViewportCell} onOver={extendViewportSelection} onChange={setCellValue} onAddOption={addOption}
        uploadFiles={uploadFiles} appendAttachments={appendAttachments} openAsset={openAsset} openImages={openImages}
        aiState={field.type === "ai" ? aiGen.cellStates[aiCellKey(field.id, record.id)] : undefined}
        generateCell={aiGen.generateCell} cancelCell={aiGen.cancelCell}
      />)}
      <td className="bt-td-empty" />
    </tr>
    );
  };

  return (
    <div
      ref={rootRef}
      className="bitable-editor"
      data-note-id={noteId}
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
                ? <input autoFocus className="bt-input bt-inline-input" value={tableEditor.draft}
                    onChange={(event) => setTableEditor({ id: table.id, draft: event.target.value })}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => { renameTable(table.id, tableEditor.draft); setTableEditor(null); }}
                    onKeyDown={(event) => { if (event.key === "Enter") { renameTable(table.id, tableEditor.draft); setTableEditor(null); } if (event.key === "Escape") setTableEditor(null); }} />
                : <span className="bt-table-name ln-ellipsis">{table.name}</span>}
              <span className="bt-table-count">{table.records.length}</span>
              <button type="button" className="bt-icon-btn bt-table-more" title="数据表操作" aria-label="数据表操作" disabled={readOnly}
                onClick={(event) => { event.stopPropagation(); setTableMenu({ id: table.id, anchor: event.currentTarget }); }}><MoreHorizontal size={13} /></button>
            </div>
          ))}
        </div>
        <Popover open={Boolean(tableMenu)} anchor={tableMenu?.anchor ?? null} onClose={() => setTableMenu(null)} width={190}>
          <div className="bt-panel">
            <button type="button" className="bt-menu-item ln-menu__item" onClick={() => {
              if (!tableMenu) return;
              const target = doc.tables.find((t) => t.id === tableMenu.id);
              setTableEditor({ id: tableMenu.id, draft: target?.name ?? "" });
              setTableMenu(null);
            }}><Pencil size={14} />重命名</button>
            <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly} onClick={() => {
              if (!tableMenu) return;
              duplicateTable(tableMenu.id);
              setTableMenu(null);
            }}><Copy size={14} />复制数据表</button>
            <button type="button" className="bt-menu-item ln-menu__item" disabled={readOnly || doc.tables.length <= 1} onClick={() => {
              if (!tableMenu) return;
              deleteTable(tableMenu.id);
              setTableMenu(null);
            }}><Trash2 size={14} />删除数据表</button>
          </div>
        </Popover>
        <div className="bt-tables-resize" role="separator" aria-label="调整数据表宽度" onPointerDown={startTablesResize} />
      </aside>
      )}

      <div className="bt-main">
        {bodyUnreadable && (
          <div className="tab-gone-banner" role="status" data-bitable-parse-error>
            <TriangleAlert size={14} aria-hidden="true" />
            <span>多维表正文无法解析（文件损坏或版本不兼容）：已锁定为只读，不会覆盖原文。请从「历史版本」或云端备份恢复。</span>
          </div>
        )}
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
            {/* ⚠️ 表宽必须是 max(100%, 内容宽)：table-layout:fixed 下若只写固定宽 + min-width:100%，浏览器会把多出来的宽度**按比例摊给所有列**（261017 用户实测：新建单字段表时复选框列被拉宽到几百 px、末列也不吃剩余）⇒ 只有「末列 auto」才能吸收剩余。 */}
            <table className="bt-grid bt-grid-windowed" style={{ width: `max(100%, ${80 + gridTrailingWidth + visibleFields.reduce((sum, field) => sum + (field.width ?? DEFAULT_COL_WIDTH), 0)}px)` }} aria-rowcount={rowItems.length + 3}>
              <colgroup>
                <col className="bt-col-index" />
                {visibleFields.map((field) => <col key={field.id} style={{ width: (field.width ?? DEFAULT_COL_WIDTH) + "px" }} />)}
                <col className="bt-col-empty" />
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
              <BitableVirtualBody key={activeTable.id + ":" + activeView.id}
                items={rowItems} columns={visibleFields.length + 2} totalRecords={shownRecords.length}
                getKey={rowItemKey} estimateSize={estimateRow} visible={visible} handleRef={viewportRef}
                measureRows={typeof activeView.rowHeight === "number"}
                leading={hasGroupRows ? <tr className="bt-group-head-gap" aria-hidden="true"><td colSpan={visibleFields.length + 2} /></tr> : undefined}
                renderRow={(item, itemIndex) => {
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
                }}
                trailing={!hasGroupRows ? (
                  <tr className="bt-add-row">
                    {/* 同一条口径：表底这个 + 也落在编号列正下方 */}
                    <td className="bt-add-index">
                      <button type="button" className="bt-add-round" title="添加记录" aria-label="添加记录" disabled={readOnly} onClick={() => addRecord()}><Plus size={14} /></button>
                    </td>
                    <td colSpan={visibleFields.length + 1} />
                  </tr>
                ) : undefined}
              />
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
          {BITABLE_ROW_HEIGHT_OPTIONS.map((option) => (
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
              <h4>列统计：{field.name}</h4>
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
              const typeChanged = typeof patch.type === "string" && before && patch.type !== before.type;
              // 类型互转走 core（重建字段、清旧配置、清视图里失效引用）；直接把 type 浅合并会留下旧 options/默认值。
              if (typeChanged) updateDoc((prev) => convertBitableFieldType(prev, prev.activeTableId, fieldId, patch.type as string).doc);
              const { type: _nextType, ...rest } = patch;
              updateField(fieldId, options ? { ...rest, options } : rest);
              if (options) updateDoc((prev) => pruneBitableOptionValues(prev, prev.activeTableId, fieldId));
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
            if (patch.format) field.format = patch.format;
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
                if (event.key === "Enter" && !readOnly) renameView(viewEditor, (event.target as HTMLInputElement).value);
              }} />
          </div>
          <div className="ln-dialog__actions">
            <button type="button" className="bt-secondary" onClick={() => setViewEditor(null)}>取消</button>
            <button type="button" className="bt-primary" disabled={readOnly} onClick={() => {
              renameView(viewEditor, viewNameRef.current?.value ?? "");
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
