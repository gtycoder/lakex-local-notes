/**
 * 移动端多维表查看/编辑器（kind=bitable）—— 261020 P0 起**移动端可编辑**。
 *
 * 与桌面共用同一份数据模型（`src/core/bitableDoc.ts`：字段/选项/视图求值都是纯核心）与写入纯函数
 * （`src/core/bitableMutations.ts`）。本组件只做「呈现 + 什么时候调用哪个纯函数」：
 * - **阅读态**（默认）：只读查看，与 261012 起的只读视图逐项一致（只读控件、视图投影、条件填色、附件缩略图）。
 * - **编辑态**（`editing`）：网格可点 → 打开记录底部面板逐字段编辑（布尔可直接单击切换）；
 *   顶部「字段」面板做基础增删改；表尾可新增记录、分页窗口显式「加载更多」。
 *
 * 约束（docs/BITABLE-VIEWPORT.md + AGENTS §3）：
 * - 记录**全集留在模型里**，只有挂载行受窗口限制（100 条/页 + 显式加载更多，不静默裁剪）；
 * - 正文序列化恒写 canonical 导航（第一表/第一视图），切表不落盘、不进 S3；
 * - 绝不把 bitable 正文喂给 Lake 编辑器；保存由父级 useAutoSave → bridge.saveNote 走同一条写边界。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Columns3, Plus } from "lucide-react";
import { FileKindIcon } from "../../features/bitable/FileKindIcon.js";
import { fillSurfaceColor } from "../../core/colorPalette.js";
import {
  applyViewToRecords,
  BITABLE_RATING_MAX,
  bitableFillBackgroundTokens,
  bitableFieldText,
  buildBitableFillProjection,
  isAttachmentLikeField,
  isImplementedViewType,
  isKnownViewType,
  isRelationFieldType,
  optionChipStyle,
  orderedTableFields,
  parseBitableBody,
  viewTypeLabel,
  type BitableDisplayContext,
  type BitableDoc,
  type BitableField,
  type BitableRecord,
} from "../../core/bitableDoc.js";
import {
  readOnlyAttachments,
  readOnlyBoolean,
  readOnlyLink,
  readOnlyOptions,
  readOnlyProgress,
  readOnlyRating,
  readOnlyRelation,
} from "../../core/bitableReadOnly.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { native } from "../../lib/native";
import { showToast } from "../ui/toastBus";
import { confirmMobile } from "../ui/ConfirmDialog";
import { applyBitableNav, readBitableNav, writeBitableNav } from "../../features/bitable/bitableNavStore";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";
import { MobileBitableFieldSheet } from "./MobileBitableFieldSheet";
import {
  addMobileField, addMobileOption, addMobileRecord, deleteMobileField, deleteMobileRecord,
  isMobileEditableField, recordWindow, renameMobileField, serializeBitableBody, setMobileCell,
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
}

function EmptyCell() {
  return <span className="mbt-cell-empty">—</span>;
}

/**
 * 附件/图片字段值（`{ file, name }[]`）。点击一律**直接用系统应用打开**（与移动端文档的附件处理一致，
 * 不做应用内预览/播放；也避免把音视频/PDF/PPT 当 `<img>` 渲染成破图）。
 *
 * 两种字段分叉（用户 260930：「图片不动，图片是用来看的，移动端可以换」）：
 * - **图片字段**：缩略图（本机 AssetServer，与文档图片同一条路）——这个字段的语义就是看图。
 * - **附件字段**：**文档类型图标**（与桌面同一套 `FileKindIcon` 与类型判定），后面跟名称。
 *   触屏**没有 hover**，名称不能像桌面那样收进气泡，所以图标后面仍带文件名（图标给类型、名字给内容）。
 */
function AttachmentCell({ noteId, value, imageOnly }: { noteId: string; value: unknown; imageOnly: boolean }) {
  const attachments = readOnlyAttachments(value);
  if (attachments.length === 0) return <EmptyCell />;
  const openWithSystem = (file: string) => {
    void native.openAttachment(noteId, file).catch((error: unknown) => {
      showToast(error instanceof Error && error.message ? error.message : "没有可打开此文件的应用", { type: "error" });
    });
  };
  return (
    <span className="mbt-attachments">
      {attachments.map(({ file, name, image }) => (
        imageOnly && image
          ? <img
              key={file}
              className="mbt-attachment"
              src={withAssetAccessToken(localAssetHttpUrl(noteId, file))}
              alt={name}
              title={name}
              loading="lazy"
            />
          : (
            <button key={file} type="button" className={"mbt-attachment-file" + (imageOnly ? "" : " is-kind")}
              title={name} aria-label={name} onClick={() => openWithSystem(file)}>
              {imageOnly ? name : <><FileKindIcon name={name} size={15} /><span className="mbt-attachment-name mb-ellipsis">{name}</span></>}
            </button>
          )
      ))}
    </span>
  );
}

/** 单选/多选：选项色块（与桌面同一 optionChipStyle）。 */
function OptionChips({ field, value }: { field: BitableField; value: unknown }) {
  const options = readOnlyOptions(field, value);
  if (options.length === 0) return <EmptyCell />;
  return (
    <>
      {options.map((option) => (
        <span key={option.id} className="mbt-option" style={optionChipStyle(option.color)}>{option.name}</span>
      ))}
    </>
  );
}

/** 只读评分：固定 5 星（选中星走主题金，空星走中性灰）。 */
function RatingCell({ value }: { value: unknown }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  const stars = readOnlyRating(value);
  return (
    <span className="mbt-rating" role="img" aria-label={stars + " 星"}>
      {Array.from({ length: BITABLE_RATING_MAX }, (_, index) => (
        <span key={index} className={"mbt-star" + (index < stars ? " is-on" : "")} aria-hidden="true">★</span>
      ))}
    </span>
  );
}

/** 只读进度：条 + 百分比（宽度是数据驱动，走内联 style，同选项色块先例）。 */
function ProgressCell({ value }: { value: unknown }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  const pct = readOnlyProgress(value);
  return (
    <span className="mbt-progress">
      <span className="mbt-progress-track"><span className="mbt-progress-bar" style={{ width: pct + "%" }} /></span>
      <span className="mbt-progress-value">{pct}%</span>
    </span>
  );
}

/** 只读链接：http(s) 走系统浏览器（`<a target="_blank">`，Capacitor 对外部 origin 走 Intent），其余当文本。 */
function LinkCell({ value }: { value: unknown }) {
  const link = readOnlyLink(value);
  if (!link.text) return <EmptyCell />;
  return link.href
    ? <a className="mbt-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a>
    : <span>{link.text}</span>;
}

/** 只读关联：目标记录主字段 chip；目标表/记录失效时给失效文案（与桌面同一 core 口径）。 */
function RelationCell({ ctx, field, value }: { ctx: BitableDisplayContext; field: BitableField; value: unknown }) {
  const relation = readOnlyRelation(ctx, field, value);
  if (relation.invalid) return <span className="mbt-cell-empty">关联已失效</span>;
  if (relation.chips.length === 0) return <EmptyCell />;
  return (
    <span className="mbt-relation">
      {relation.chips.map((chip) => (
        <span key={chip.id} className="mbt-relation-chip" title={chip.label}>{chip.label}</span>
      ))}
    </span>
  );
}

/** 按字段类型分派只读单元格（未知类型只读展示）。 */
function FieldValue({ noteId, ctx, field, record }: { noteId: string; ctx: BitableDisplayContext; field: BitableField; record: BitableRecord }): ReactNode {
  const value = record.values[field.id];
  if (isAttachmentLikeField(field.type)) {
    return <AttachmentCell noteId={noteId} value={value} imageOnly={field.type === "image"} />;
  }
  if (field.type === "select" || field.type === "multiSelect") return <OptionChips field={field} value={value} />;
  if (field.type === "boolean") {
    const checked = readOnlyBoolean(value);
    return checked === null ? <EmptyCell /> : <input className="mbt-bool" type="checkbox" checked={checked} disabled aria-label="布尔值" />;
  }
  if (field.type === "link") return <LinkCell value={value} />;
  if (field.type === "rating") return <RatingCell value={value} />;
  if (field.type === "progress") return <ProgressCell value={value} />;
  if (isRelationFieldType(field.type)) return <RelationCell ctx={ctx} field={field} value={value} />;
  const text = bitableFieldText(record, field, ctx);
  return text === "" ? <EmptyCell /> : <>{text}</>;
}

export function MobileBitableViewer({ noteId, content, editing = false, onChange }: MobileBitableViewerProps) {
  /** 打开时套用**设备本地导航**（上次看的那张表；与桌面同一份 bitableNavStore，不进正文）。 */
  const [doc, setDoc] = useState<BitableDoc | null>(() => {
    const parsed = parseBitableBody(content);
    return parsed ? applyBitableNav(parsed, readBitableNav(noteId)) : null;
  });
  const docRef = useRef<BitableDoc | null>(doc);
  /** 最近一次由本组件写出去（或收到）的正文：判断 content 是不是外部变化，避免自己覆盖自己。 */
  const lastBodyRef = useRef<string | null>(content);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = editing && !!onChange;

  const [tableId, setTableId] = useState<string | null>(doc?.activeTableId ?? null);
  /** 分页窗口：完整记录不动，只决定挂载多少行（切表/切视图时复位）。 */
  const [visibleCount, setVisibleCount] = useState(MOBILE_BITABLE_PAGE);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);

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

  // 退出编辑态 / 预览态：面板不能留在页面上
  useEffect(() => {
    if (editable) return;
    setRecordId(null);
    setFieldSheetOpen(false);
  }, [editable]);

  const table = doc?.tables.find((item) => item.id === tableId) ?? doc?.tables[0];
  const switchTable = (id: string) => {
    setTableId(id);
    setVisibleCount(MOBILE_BITABLE_PAGE);
    setRecordId(null);
    // 切表只写设备本地导航（不进正文、不标脏、不同步）
    writeBitableNav(noteId, { ...readBitableNav(noteId), tableId: id });
  };

  if (!doc || !table) {
    return <div className="mb-empty">这张多维表还没有数据表。</div>;
  }
  const view = table.views.find((item) => item.id === table.activeViewId) ?? table.views[0];
  const fields = useMemo(() => orderedTableFields(table, view), [table, view]);
  const records = useMemo(() => applyViewToRecords(table, view), [table, view]);
  const fillProjection = useMemo(() => buildBitableFillProjection(table, view, records), [table, view, records]);
  /** 关联字段展示需要同一文档的 tables（桌面同一条 core 口径）。 */
  const displayCtx: BitableDisplayContext = useMemo(() => ({ tables: doc.tables }), [doc.tables]);
  const windowed = useMemo(() => recordWindow(records, visibleCount), [records, visibleCount]);
  const sheetRecord = recordId ? table.records.find((item) => item.id === recordId) ?? null : null;

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

  return (
    <div className={"mobile-bitable" + (editable ? " is-editing" : "")} data-mobile-bitable data-prevent-swipe>
      {doc.tables.length > 1 && (
        <div className="mbt-tables" role="tablist" aria-label="数据表">
          {doc.tables.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={"mbt-table-tab" + (item.id === table.id ? " is-active" : "")}
              aria-selected={item.id === table.id}
              onClick={() => switchTable(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="mbt-meta">
        <span>{table.name}</span>
        <span className="mbt-meta-sep">·</span>
        <span>{records.length} 条记录</span>
        {view?.name && (
          <>
            <span className="mbt-meta-sep">·</span>
            <span>{view.name} 视图</span>
          </>
        )}
        {editable
          ? <span className="mbt-readonly" title="改动自动保存">编辑中</span>
          : <span className="mbt-readonly">只读</span>}
      </div>
      {editable && (
        <div className="mbt-toolbar" data-prevent-swipe role="toolbar" aria-label="多维表工具">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" aria-label="字段管理" onClick={() => setFieldSheetOpen(true)}>
            <Columns3 size={15} />字段
          </button>
        </div>
      )}
      {/* 桌面视图类型是开放集合：移动端首版只做表格，非 grid 视图必须给明确交代（不允许空白/静默降级） */}
      {view.type !== "grid" && (
        <div className="mbt-view-notice" role="status">
          {!isKnownViewType(view.type)
            ? "当前版本不支持「" + view.type + "」视图，已按表格" + (editable ? "" : "只读") + "展示。"
            : isImplementedViewType(view.type)
              ? "「" + viewTypeLabel(view.type) + "」桌面已支持，移动端暂以表格" + (editable ? "" : "只读") + "展示。"
              : "「" + viewTypeLabel(view.type) + "」暂未提供，移动端以表格" + (editable ? "" : "只读") + "展示。"}
        </div>
      )}
      <div className="mbt-grid-wrap">
        <table className="mbt-grid">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.id} style={{ minWidth: field.width ?? 120 }}>
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {windowed.visible.map((record) => {
              const side = fillProjection.rowSide.get(record.id)?.color;
              return (
              <tr key={record.id} data-fill-side={side ? "" : undefined}
                style={side ? ({ "--mbt-fill-side": side } as CSSProperties) : undefined}>
                {fields.map((field) => {
                  const fillTokens = bitableFillBackgroundTokens(fillProjection, record.id, field.id);
                  const backgroundImage = fillTokens.length > 0
                    ? fillTokens.map((color) => fillSurfaceColor(color)).map((color) => `linear-gradient(${color}, ${color})`).join(", ")
                    : undefined;
                  const value: ReactNode = <FieldValue noteId={noteId} ctx={displayCtx} field={field} record={record} />;
                  return (
                  <td key={field.id} style={backgroundImage ? { backgroundImage } : undefined}>
                    {editable ? (
                      <button
                        type="button"
                        className="mbt-cell-btn"
                        aria-label={field.name}
                        onClick={() => tapCell(record, field)}
                      >{value}</button>
                    ) : value}
                  </td>
                  );
                })}
              </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td className="mbt-empty" colSpan={Math.max(1, fields.length)}>当前视图没有记录</td>
              </tr>
            )}
            {editable && (
              <tr>
                <td className="mbt-add-row" colSpan={Math.max(1, fields.length)}>
                  <button type="button" className="mbt-add-row__btn" aria-label="新增记录" onClick={addRecord}>
                    <Plus size={15} />新增记录
                  </button>
                </td>
              </tr>
            )}
            {windowed.remaining > 0 && (
              <tr>
                <td className="mbt-add-row" colSpan={Math.max(1, fields.length)}>
                  <button type="button" className="mbt-load-more" aria-label="加载更多记录"
                    onClick={() => setVisibleCount((current) => current + MOBILE_BITABLE_PAGE)}>
                    加载更多（已显示 {windowed.visible.length} / {windowed.total} 条）
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && sheetRecord && (
        <MobileBitableRecordSheet
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
          onRename={(fieldId, name) => mutate((current) => renameMobileField(current, table.id, fieldId, name))}
          onDelete={(fieldId) => mutate((current) => deleteMobileField(current, table.id, fieldId))}
          onAdd={(type, name) => mutate((current) => addMobileField(current, table.id, type, name))}
          onClose={() => setFieldSheetOpen(false)}
        />
      )}
    </div>
  );
}

export default MobileBitableViewer;
