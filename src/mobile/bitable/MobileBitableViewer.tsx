/**
 * 移动端多维表查看/编辑器（kind=bitable）—— 261030 P0：对齐钉钉的移动端形态。
 *
 * 结构（对齐钉钉实机，见 docs/MOBILE-BITABLE-DINGTALK.md）：
 * - 顶部**视图页签**（表单 / 内容 / …，来自表的 views；同类型重名回落视图名）；
 * - **默认落到表单视图**（有表单时；用户 261030：打开默认只读、默认选中表单）；
 * - 表单视图 = **填写态**（提交 = 新增一条记录，是只读文档里唯一的写路径）；
 * - 内容视图 = 表格视图 + 两套**记录展示方式**：表格 / 卡片（设备本地偏好，不写正文）；
 * - 点记录 → 整页只读详情（编辑态仍走记录底部面板）。
 *
 * 约束（docs/BITABLE-VIEWPORT.md + AGENTS §3）：
 * - 记录**全集留在模型里**，只有挂载行受窗口限制（100 条/页 + 显式加载更多，不静默裁剪）；
 * - 正文序列化恒写 canonical 导航（第一表/第一视图），切表/切视图只写设备本地；
 * - 展示类配置（表格/卡片、列数、封面、展示字段）一律设备本地（用户 261030 定）；
 * - 绝不把 bitable 正文喂给 Lake 编辑器；保存由父级走同一条写边界。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./mobileBitable.css";
import { Columns3, ListFilter, Menu, Plus, SlidersHorizontal } from "lucide-react";
import { fillSurfaceColor } from "../../core/colorPalette.js";
import {
  applyViewToRecords,
  bitableFillBackgroundTokens,
  buildBitableFillProjection,
  createDefaultBitableTable,
  groupRecords,
  isKnownViewType,
  orderedTableFields,
  parseBitableBody,
  type BitableDisplayContext,
  type BitableDoc,
  type BitableField,
  type BitableRecord,
  type BitableView,
} from "../../core/bitableDoc.js";
import {
  resolveRecordLayout,
  withRecordLayoutPrefs,
  type BitableRecordLayoutPrefs,
} from "../../core/bitableRecordLayout.js";
import { applyBitableNav, readBitableNav, writeBitableNav } from "../../features/bitable/bitableNavStore";
import { showToast } from "../ui/toastBus";
import { pushBackHandler } from "../ui/backStack";
import { formatGroupLabel } from "./mobileBitableFormat";
import { convertBitableFieldType, deleteBitableTable, duplicateBitableTable, fieldHasData, renameBitableTable, updateBitableField } from "../../core/bitableMutations";
import { confirmMobile } from "../ui/ConfirmDialog";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";
import { MobileBitableFieldSheet } from "./MobileBitableFieldSheet";
import { MobileBitableFieldEditorSheet } from "./MobileBitableFieldEditorSheet";
import { MobileBitableFormView } from "./MobileBitableFormView";
import { MobileBitableCardList } from "./MobileBitableCardList";
import { MobileBitableRecordPage } from "./MobileBitableRecordPage";
import { MobileBitableTableDrawer } from "./MobileBitableTableDrawer";
import { MobileBitableTableActions } from "./MobileBitableTableActions";
import { MobileBitableKanbanView } from "./MobileBitableKanbanView";
import { MobileBitableGalleryView } from "./MobileBitableGalleryView";
import { MobileBitableCalendarView } from "./MobileBitableCalendarView";
import { MobileBitableViewConfigSheet } from "./MobileBitableViewConfigSheet";
import { MobileBitableViewListSheet } from "./MobileBitableViewListSheet";
import { FieldValue } from "./MobileBitableValue";
import { mobileViewTabs, resolveMobileDefaultViewId } from "./mobileBitableViewTabs";
import { readBitableRecordLayout, writeBitableRecordLayout } from "./mobileBitableViewPrefs";
import { submitMobileForm } from "./mobileBitableForm";
import {
  addMobileField, addMobileOption, addMobileRecord, deleteMobileField, deleteMobileRecord,
  isMobileEditableField, recordWindow, serializeBitableBody, setMobileCell,
} from "./mobileBitableEdit";

/** 分页窗口大小（记录全集不动，只决定挂载多少行；与桌面行窗口契约同一目标）。 */
export const MOBILE_BITABLE_PAGE = 100;

export interface MobileBitableViewerProps {
  noteId: string;
  content: string;
  /** 编辑态（由工作区顶栏「编辑 / 完成」控制）；缺省 = 阅读态。 */
  editing?: boolean;
  /** 正文变化（父级负责防抖落盘）。 */
  onChange?: (content: string) => void;
  /**
   * 立即落盘（表单提交用）：只读文档里提交必须真正写盘，不能走「编辑态才自动保存」的防抖路径。
   * 缺省时退化为 onChange（单测/无宿主场景）。
   */
  onPersistNow?: (content: string) => void | Promise<void>;
  /**
   * 子页全屏请求（记录详情页）：父级据此隐藏工作区顶栏/底部胶囊（261030 修「双 header」）。
   * 打开详情 → true，关闭/卸载 → false。
   */
  onFullscreenChange?: (fullscreen: boolean) => void;
}

export function MobileBitableViewer({ noteId, content, editing = false, onChange, onPersistNow, onFullscreenChange }: MobileBitableViewerProps) {
  const [doc, setDoc] = useState<BitableDoc | null>(() => {
    const parsed = parseBitableBody(content);
    return parsed ? applyBitableNav(parsed, readBitableNav(noteId)) : null;
  });
  const docRef = useRef<BitableDoc | null>(doc);
  /** 最近一次由本组件写出去（或收到）的正文：判断 content 是不是外部变化，避免自己覆盖自己。 */
  const lastBodyRef = useRef<string | null>(content);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPersistRef = useRef(onPersistNow);
  onPersistRef.current = onPersistNow;
  const onFullscreenRef = useRef(onFullscreenChange);
  onFullscreenRef.current = onFullscreenChange;
  const editable = editing && !!onChange;

  const [tableId, setTableId] = useState<string | null>(doc?.activeTableId ?? null);
  /** 当前视图（设备本地导航；空 = 用默认规则：有表单视图就落表单）。 */
  const [viewId, setViewId] = useState<string>("");
  /** 记录展示方式偏好（设备本地；只在当前表+视图上有意义）。 */
  const [prefs, setPrefs] = useState<BitableRecordLayoutPrefs>({});
  /** 分页窗口：完整记录不动，只决定挂载多少行（切表/切视图时复位）。 */
  const [visibleCount, setVisibleCount] = useState(MOBILE_BITABLE_PAGE);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  /** 正在编辑配置的字段 id（「修改字段」面板）。 */
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [tableDrawerOpen, setTableDrawerOpen] = useState(false);
  /** 数据表操作面板：独立于抽屉（抽屉关闭后再弹，避免两个层抢 z-index）。 */
  const [actionsTableId, setActionsTableId] = useState<string | null>(null);
  const [viewListOpen, setViewListOpen] = useState(false);

  // 外部正文变化（例如同步/重开）才采纳；本组件自己 onChange 出去的正文不回灌（否则会打断输入）。
  useEffect(() => {
    if (lastBodyRef.current === content) return;
    const parsed = parseBitableBody(content);
    if (!parsed) return;
    lastBodyRef.current = content;
    const next = applyBitableNav(parsed, readBitableNav(noteId));
    docRef.current = next;
    setDoc(next);
  }, [content, noteId]);

  /** 提交一次纯函数变更：无变化返回原引用（不写）；有变化则更新本地 + 通知父级。 */
  const commit = useCallback((next: BitableDoc | null) => {
    const prev = docRef.current;
    if (!next || !prev || next === prev) return false;
    docRef.current = next;
    setDoc(next);
    const body = serializeBitableBody(next.tables);
    if (body !== lastBodyRef.current) {
      lastBodyRef.current = body;
      onChangeRef.current?.(body);
    }
    return true;
  }, []);

  const mutate = useCallback((fn: (current: BitableDoc) => BitableDoc) => {
    const prev = docRef.current;
    if (!prev || !editable) return;
    commit(fn(prev));
  }, [commit, editable]);

  // 退出编辑态 / 预览态：面板与详情页不能留在页面上
  useEffect(() => {
    if (editable) return;
    setRecordId(null);
    setFieldSheetOpen(false);
    setEditingFieldId(null);
  }, [editable]);

  // 记录详情 = 子页全屏：请求父级隐藏工作区 chrome；返回键先关详情（不是退工作区）。
  useEffect(() => {
    onFullscreenRef.current?.(detailId !== null);
  }, [detailId]);
  useEffect(() => () => { onFullscreenRef.current?.(false); }, []);
  useEffect(() => {
    if (!detailId) return;
    return pushBackHandler(() => { setDetailId(null); return true; });
  }, [detailId]);

  const table = doc?.tables.find((item) => item.id === tableId) ?? doc?.tables[0] ?? null;
  const navViewId = readBitableNav(noteId).viewIds?.[table?.id ?? ""] ?? "";
  const defaultViewId = table ? (table.views.some((item) => item.id === navViewId) ? navViewId : resolveMobileDefaultViewId(table)) : "";
  const resolvedViewId = viewId && table?.views.some((item) => item.id === viewId) ? viewId : defaultViewId;
  const view = table?.views.find((item) => item.id === resolvedViewId) ?? table?.views[0] ?? null;
  const viewTabs = useMemo(() => (table ? mobileViewTabs(table) : []), [table]);

  // 设备本地布局偏好：随「表 + 视图」切换重新载入
  useEffect(() => {
    if (!table || !view) { setPrefs({}); return; }
    setPrefs(readBitableRecordLayout(noteId, table.id, view.id));
  }, [noteId, table?.id, view?.id]);

  const fields = useMemo(() => (table && view ? orderedTableFields(table, view) : []), [table, view]);
  const records = useMemo(() => (table && view ? applyViewToRecords(table, view) : []), [table, view]);
  const layout = useMemo(() => (table && view ? resolveRecordLayout(table, view, prefs) : null), [table, view, prefs]);
  const fillProjection = useMemo(() => (table && view ? buildBitableFillProjection(table, view, records) : null), [table, view, records]);
  /** 关联字段展示需要同一文档的 tables（桌面同一条 core 口径）。 */
  const displayCtx: BitableDisplayContext = useMemo(() => ({ tables: doc?.tables ?? [] }), [doc?.tables]);
  const windowed = useMemo(() => recordWindow(records, visibleCount), [records, visibleCount]);
  const sheetRecord = recordId && table ? table.records.find((item) => item.id === recordId) ?? null : null;
  const detailRecord = detailId && table ? table.records.find((item) => item.id === detailId) ?? null : null;
  const detailIndex = detailRecord ? records.findIndex((item) => item.id === detailRecord.id) : -1;
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((record, index) => map.set(record.id, index + 1));
    return map;
  }, [records]);

  if (!doc || !table || !view || !layout) {
    return <div className="mb-empty">这张多维表还没有数据表。</div>;
  }

  const isFormView = view.type === "form";
  const isGridLike = view.type === "grid";
  const showCardLayout = layout.mode === "card" && isGridLike;

  /** 表单编辑态（261030 P2）：只改**视图配置**（标题/描述/题目勾选），仅在文档编辑态可用。 */
  const updateView = (patch: Partial<BitableView>) => {
    mutate((current) => ({
      ...current,
      tables: current.tables.map((item) => (item.id !== table.id ? item : {
        ...item,
        views: item.views.map((candidate) => (candidate.id === view.id ? { ...candidate, ...patch } : candidate)),
      })),
    }));
  };

  /** 新建数据表（文档写入，仅编辑态）：追加一张空表并切过去（导航写设备本地）。 */
  const createTable = () => {
    const current = docRef.current;
    if (!current || !editable) return;
    const created = createDefaultBitableTable("数据表 " + (current.tables.length + 1));
    const next = { ...current, tables: [...current.tables, created] };
    if (!commit(next)) return;
    setTableId(created.id);
    setViewId("");
    setVisibleCount(MOBILE_BITABLE_PAGE);
    setRecordId(null);
    setDetailId(null);
    setTableDrawerOpen(false);
    writeBitableNav(noteId, { ...readBitableNav(noteId), tableId: created.id });
  };

  const switchTable = (id: string) => {
    setTableId(id);
    setViewId("");
    setVisibleCount(MOBILE_BITABLE_PAGE);
    setRecordId(null);
    setDetailId(null);
    // 切表只写设备本地导航（不进正文、不标脏、不同步）
    writeBitableNav(noteId, { ...readBitableNav(noteId), tableId: id });
    setTableDrawerOpen(false);
  };

  /** 数据表级操作（core 单一来源；只读态不写正文，入口在抽屉里已置灰）。 */
  const renameTable = (id: string, name: string) => {
    if (!editable) return;
    mutate((current) => renameBitableTable(current, id, name));
  };
  const duplicateTable = (id: string) => {
    const current = docRef.current;
    if (!current || !editable) return;
    const result = duplicateBitableTable(current, id);
    if (result.doc === current || !result.tableId) return;
    if (!commit(result.doc)) return;
    setTableId(result.tableId);
    setViewId("");
    setVisibleCount(MOBILE_BITABLE_PAGE);
    setRecordId(null);
    setDetailId(null);
    setTableDrawerOpen(false);
    writeBitableNav(noteId, { ...readBitableNav(noteId), tableId: result.tableId });
    showToast("已复制数据表");
  };
  const deleteTable = (id: string) => {
    const current = docRef.current;
    if (!current || !editable) return;
    const next = deleteBitableTable(current, id);
    if (next === current) { showToast("至少保留一张数据表"); return; }
    if (!commit(next)) return;
    if (table.id === id) {
      const fallback = next.tables[0]?.id ?? "";
      setTableId(fallback);
      setViewId("");
      setVisibleCount(MOBILE_BITABLE_PAGE);
      setRecordId(null);
      setDetailId(null);
      writeBitableNav(noteId, { ...readBitableNav(noteId), tableId: fallback });
    }
    setTableDrawerOpen(false);
    showToast("已删除数据表");
  };

  const switchView = (nextViewId: string) => {
    setViewId(nextViewId);
    setVisibleCount(MOBILE_BITABLE_PAGE);
    setRecordId(null);
    setDetailId(null);
    const nav = readBitableNav(noteId);
    writeBitableNav(noteId, { ...nav, viewIds: { ...(nav.viewIds ?? {}), [table.id]: nextViewId } });
  };

  const patchPrefs = (patch: Partial<BitableRecordLayoutPrefs>) => {
    const next = withRecordLayoutPrefs(prefs, patch);
    setPrefs(next);
    writeBitableRecordLayout(noteId, table.id, view.id, next);
  };

  /** 表单提交：写 doc → 立即落盘（只读态的唯一写路径）。 */
  const submitForm = async (draft: Record<string, unknown>): Promise<boolean> => {
    const current = docRef.current;
    if (!current) return false;
    const result = submitMobileForm(current, table.id, draft);
    if (!result.recordId || result.doc === current) return false;
    const body = serializeBitableBody(result.doc.tables);
    const persist = onPersistRef.current;
    // ⚠️ 先落盘、成功后再改界面：否则失败时界面多一条、盘上没有；用户重试会插两条（261030 review）。
    if (persist) {
      try {
        await persist(body);
      } catch (reason) {
        showToast("保存失败：" + (reason instanceof Error && reason.message ? reason.message : "请重试"), { type: "error" });
        return false;
      }
    }
    docRef.current = result.doc;
    setDoc(result.doc);
    lastBodyRef.current = body;
    if (!persist) onChangeRef.current?.(body);
    // 提交后记录数/视图都需要刷新；窗口至少覆盖到新记录
    setVisibleCount((count) => Math.max(count, records.length + 1));
    return true;
  };

  /** 点单元格：布尔直接翻转（快路径），其余打开该记录的底部面板。 */
  const tapCell = (record: BitableRecord, field: BitableField) => {
    if (!editable) return;
    if (field.type === "boolean" && isMobileEditableField(field)) {
      const next = record.values[field.id] !== true;
      const current = docRef.current;
      if (current) commit(setMobileCell(current, table.id, record.id, field.id, next));
      return;
    }
    setRecordId(record.id);
  };

  const addRecord = () => {
    const current = docRef.current;
    if (!current || !editable) return;
    const created = addMobileRecord(current, table.id);
    if (!commit(created.doc)) return;
    // 新记录追加在末尾：窗口必须覆盖到它，否则「刚建完却看不见」。
    const nextTable = created.doc.tables.find((item) => item.id === table.id);
    setVisibleCount(Math.max(visibleCount, nextTable?.records.length ?? 0));
    setRecordId(created.recordId);
  };

  const patchCell = (targetRecordId: string, fieldId: string, value: unknown) => {
    mutate((current) => setMobileCell(current, table.id, targetRecordId, fieldId, value));
  };

  const addOption = (fieldId: string, name: string): string | null => {
    const current = docRef.current;
    if (!current || !editable) return null;
    const result = addMobileOption(current, table.id, fieldId, name);
    commit(result.doc);
    return result.optionId;
  };

  const deleteRecord = async () => {
    if (!sheetRecord) return;
    const recordNo = records.findIndex((item) => item.id === sheetRecord.id) + 1;
    const ok = await confirmMobile({
      title: "删除这条记录？",
      body: "第 " + Math.max(1, recordNo) + " 条记录及其全部字段值会被删除（不能撤销）。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    const current = docRef.current;
    if (!current) return;
    commit(deleteMobileRecord(current, table.id, sheetRecord.id));
    setRecordId(null);
  };

  const openRecord = (recordIdToOpen: string) => {
    if (editable) setRecordId(recordIdToOpen);
    else setDetailId(recordIdToOpen);
  };

  const fillStyleOf = (recordIdForStyle: string, fieldId: string): CSSProperties | undefined => {
    if (!fillProjection) return undefined;
    const fillTokens = bitableFillBackgroundTokens(fillProjection, recordIdForStyle, fieldId);
    if (fillTokens.length === 0) return undefined;
    const backgroundImage = fillTokens
      .map((color) => fillSurfaceColor(color))
      .map((color) => "linear-gradient(" + color + ", " + color + ")")
      .join(", ");
    return { backgroundImage };
  };

  const groupRule = view.groups?.[0];
  const groupField = groupRule ? table.fields.find((field) => field.id === groupRule.fieldId) : undefined;
  const grouped = groupRecords(table, windowed.visible, groupRule);
  const showGroupHeaders = !!groupRule && grouped.some((group) => group.label);
  const columnCount = fields.length + 1;

  const renderTableRow = (record: BitableRecord) => {
    const side = fillProjection?.rowSide.get(record.id)?.color;
    return (
      <tr key={record.id} data-fill-side={side ? "" : undefined}
        style={side ? ({ "--mbt-fill-side": side } as CSSProperties) : undefined}
        onClick={() => openRecord(record.id)}
        onKeyDown={(event) => { if (event.key === "Enter") openRecord(record.id); }}
        tabIndex={0} role="row" aria-label="查看记录">
        <td className="mbt-grid__idx">{indexById.get(record.id) ?? ""}</td>
        {fields.map((field) => {
          const value: ReactNode = <FieldValue noteId={noteId} ctx={displayCtx} field={field} record={record} />;
          return (
            <td key={field.id} style={fillStyleOf(record.id, field.id)}>
              {editable ? (
                <button type="button" className="mbt-cell-btn" aria-label={field.name} onClick={(event) => { event.stopPropagation(); tapCell(record, field); }}>
                  {value}
                </button>
              ) : value}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className={"mobile-bitable" + (editable ? " is-editing" : "") + (isFormView ? " mbt-is-form" : "")} data-mobile-bitable data-prevent-swipe>
      {viewTabs.length > 1 && (
        <div className="mbt-views" role="tablist" aria-label="视图">
          {viewTabs.map((tab) => (
            <button key={tab.view.id} type="button" role="tab" aria-selected={tab.view.id === view.id}
              className={"mbt-viewtab" + (tab.view.id === view.id ? " is-active" : "")}
              onClick={() => switchView(tab.view.id)}>{tab.label}</button>
          ))}
          <button type="button" className="mbt-viewmore" aria-label="视图列表" onClick={() => setViewListOpen(true)}>
            <Columns3 size={16} />
          </button>
        </div>
      )}

      <div className="mbt-meta">
        <button type="button" className="mb-iconbtn mb-iconbtn--compact mbt-meta__tables" aria-label="数据表"
          onClick={() => setTableDrawerOpen(true)}>
          <Menu size={16} />
        </button>
        <span className="mbt-meta__table" title={table.name}>{table.name}</span>
        <span className="mbt-meta__count">{records.length} 条记录</span>
        {view?.name && viewTabs.length <= 1 && <span className="mbt-meta__view" title={view.name}>{view.name}</span>}
        {editable
          ? <span className="mbt-readonly" title="改动自动保存">编辑中</span>
          : <span className="mbt-readonly">只读</span>}
      </div>

      {isFormView ? (
        <MobileBitableFormView noteId={noteId} table={table} view={view} ctx={displayCtx} onSubmit={submitForm}
          editable={editable} onUpdateView={editable ? updateView : undefined} />
      ) : (
        <>
          <div className="mbt-toolbar" data-prevent-swipe role="toolbar" aria-label="多维表工具">
            {/* 字段是**文档结构**、与当前视图无关：任何内容视图的编辑态都要能进字段管理（钉钉同）。 */}
            {editable && (
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" aria-label="字段管理" onClick={() => setFieldSheetOpen(true)}>
                <Columns3 size={15} />字段
              </button>
            )}
            <span className="mbt-toolbar__spacer" />
            <button type="button" className="mb-iconbtn" aria-label="筛选" onClick={() => setConfigOpen(true)}><ListFilter size={16} /></button>
            {isGridLike && (
              <button type="button" className="mb-iconbtn" aria-label="视图配置" onClick={() => setConfigOpen(true)}><SlidersHorizontal size={16} /></button>
            )}
          </div>

          {!isKnownViewType(view.type) && (
            <div className="mbt-view-notice" role="status">
              当前版本不支持「{view.type}」视图，已按表格{editable ? "" : "只读"}展示。
            </div>
          )}

          {view.type === "kanban" ? (
            <>
              <MobileBitableKanbanView noteId={noteId} table={table} view={view} records={windowed.visible} ctx={displayCtx} onOpen={openRecord} />
              {windowed.remaining > 0 && (
                <button type="button" className="mbt-load-more" aria-label="加载更多记录"
                  onClick={() => setVisibleCount((current) => current + MOBILE_BITABLE_PAGE)}>
                  加载更多（已显示 {windowed.visible.length} / {windowed.total} 条）
                </button>
              )}
            </>
          ) : view.type === "gallery" ? (
            <>
              <MobileBitableGalleryView noteId={noteId} table={table} view={view} records={windowed.visible} ctx={displayCtx} onOpen={openRecord} />
              {windowed.remaining > 0 && (
                <button type="button" className="mbt-load-more" aria-label="加载更多记录"
                  onClick={() => setVisibleCount((current) => current + MOBILE_BITABLE_PAGE)}>
                  加载更多（已显示 {windowed.visible.length} / {windowed.total} 条）
                </button>
              )}
            </>
          ) : view.type === "calendar" ? (
            <MobileBitableCalendarView table={table} view={view} records={records} ctx={displayCtx} onOpen={openRecord} />
          ) : showCardLayout ? (
            <div className="mbt-scroll">
              <MobileBitableCardList noteId={noteId} table={table} view={view} records={windowed.visible}
                layout={layout} ctx={displayCtx} onOpen={openRecord} />
              {windowed.remaining > 0 && (
                <button type="button" className="mbt-load-more" aria-label="加载更多记录"
                  onClick={() => setVisibleCount((current) => current + MOBILE_BITABLE_PAGE)}>
                  加载更多（已显示 {windowed.visible.length} / {windowed.total} 条）
                </button>
              )}
            </div>
          ) : (
            <div className="mbt-grid-wrap">
              <table className="mbt-grid">
                <thead>
                  <tr>
                    <th className="mbt-grid__idx">序号</th>
                    {fields.map((field) => (
                      <th key={field.id} style={{ minWidth: field.width ?? 120 }}>{field.name}</th>
                    ))}
                  </tr>
                </thead>
                {grouped.map((group) => (
                  <tbody key={group.key || "__all"}>
                    {showGroupHeaders && (
                      <tr className="mbt-grid__group">
                        <td colSpan={Math.max(1, columnCount)}>{formatGroupLabel(groupField, group.label)} · {group.records.length} 条记录</td>
                      </tr>
                    )}
                    {group.records.map(renderTableRow)}
                  </tbody>
                ))}
                {records.length === 0 && (
                  <tbody>
                    <tr>
                      <td className="mbt-empty" colSpan={Math.max(1, columnCount)}>当前视图没有记录</td>
                    </tr>
                  </tbody>
                )}
                {editable && (
                  <tbody>
                    <tr>
                      <td className="mbt-add-row" colSpan={Math.max(1, columnCount)}>
                        <button type="button" className="mbt-add-row__btn" aria-label="新增记录" onClick={addRecord}>
                          <Plus size={15} />新增记录
                        </button>
                      </td>
                    </tr>
                  </tbody>
                )}
                {windowed.remaining > 0 && (
                  <tbody>
                    <tr>
                      <td className="mbt-add-row" colSpan={Math.max(1, columnCount)}>
                        <button type="button" className="mbt-load-more" aria-label="加载更多记录"
                          onClick={() => setVisibleCount((current) => current + MOBILE_BITABLE_PAGE)}>
                          加载更多（已显示 {windowed.visible.length} / {windowed.total} 条）
                        </button>
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>
          )}
        </>
      )}

      {editable && sheetRecord && (
        <MobileBitableRecordSheet
          noteId={noteId}
          table={table}
          fields={fields}
          record={sheetRecord}
          ctx={displayCtx}
          onPatch={(fieldId, value) => patchCell(sheetRecord.id, fieldId, value)}
          onAddOption={addOption}
          onDelete={() => void deleteRecord()}
          onClose={() => setRecordId(null)}
        />
      )}
      {editable && fieldSheetOpen && (
        <MobileBitableFieldSheet
          table={table}
          fields={table.fields}
          onEdit={(field) => setEditingFieldId(field.id)}
          onDelete={(fieldId) => mutate((current) => deleteMobileField(current, table.id, fieldId))}
          onAdd={(type, name) => mutate((current) => addMobileField(current, table.id, type, name))}
          onClose={() => setFieldSheetOpen(false)}
        />
      )}
      {editable && editingFieldId && (
        <MobileBitableFieldEditorSheet
          open
          field={table.fields.find((item) => item.id === editingFieldId) ?? null}
          hasData={editingFieldId ? fieldHasData(table, editingFieldId) : false}
          onSave={(patch, nextType) => {
            const targetId = editingFieldId;
            setEditingFieldId(null);
            if (!targetId) return;
            const current = docRef.current;
            if (!current) return;
            let base = current;
            if (nextType) {
              const converted = convertBitableFieldType(current, table.id, targetId, nextType);
              if (!converted.ok) {
                showToast(converted.reason === "has-data" ? "该字段已有数据，不能修改类型" : "不能修改为这个类型");
                return;
              }
              base = converted.doc;
            }
            const updated = updateBitableField(base, table.id, targetId, patch);
            if (updated !== current) commit(updated);
            else if (base !== current) commit(base);
          }}
          onClose={() => setEditingFieldId(null)}
        />
      )}

      {!editable && detailRecord && (
        <MobileBitableRecordPage
          noteId={noteId}
          table={table}
          fields={fields}
          record={detailRecord}
          ctx={displayCtx}
          index={Math.max(0, detailIndex)}
          total={records.length}
          onPrev={() => {
            const prev = records[(Math.max(0, detailIndex) - 1 + records.length) % records.length];
            if (prev) setDetailId(prev.id);
          }}
          onNext={() => {
            const next = records[(Math.max(0, detailIndex) + 1) % records.length];
            if (next) setDetailId(next.id);
          }}
          onClose={() => setDetailId(null)}
        />
      )}

      <MobileBitableViewConfigSheet
        open={configOpen}
        table={table}
        view={view}
        layout={layout}
        prefs={prefs}
        cardFields={table.fields}
        editable={editable}
        onPatchPrefs={patchPrefs}
        onClose={() => setConfigOpen(false)}
      />
      <MobileBitableTableDrawer
        open={tableDrawerOpen}
        tables={doc.tables}
        activeTableId={table.id}
        editable={editable}
        onSelect={switchTable}
        onCreate={editable ? createTable : undefined}
        onActions={(id) => { setTableDrawerOpen(false); setActionsTableId(id); }}
        onClose={() => setTableDrawerOpen(false)}
      />
      <MobileBitableTableActions
        open={!!actionsTableId}
        tableName={doc.tables.find((item) => item.id === actionsTableId)?.name ?? ""}
        recordCount={doc.tables.find((item) => item.id === actionsTableId)?.records.length ?? 0}
        editable={editable}
        canDelete={doc.tables.length > 1}
        onRename={(name) => { if (actionsTableId) renameTable(actionsTableId, name); setActionsTableId(null); }}
        onDuplicate={() => { if (actionsTableId) duplicateTable(actionsTableId); setActionsTableId(null); }}
        onDelete={() => { if (actionsTableId) deleteTable(actionsTableId); setActionsTableId(null); }}
        onClose={() => setActionsTableId(null)}
      />
      <MobileBitableViewListSheet
        open={viewListOpen}
        table={table}
        activeViewId={view.id}
        onSelect={(nextViewId) => { switchView(nextViewId); setViewListOpen(false); }}
        onClose={() => setViewListOpen(false)}
      />
    </div>
  );
}

export default MobileBitableViewer;
