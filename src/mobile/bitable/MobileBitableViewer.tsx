/**
 * 移动端多维表只读视图（kind=bitable）。
 *
 * 与桌面共用同一份数据模型（`src/core/bitableDoc.ts`：字段/选项/视图求值都是纯核心），
 * 这里只做**只读呈现**：多表切换 + 视图（筛选/排序/隐藏列/列顺序）按桌面同一口径求值 + 横向滚动网格 +
 * 附件列直接读 canonical URL（AssetServer 已让本机可达）。
 * 移动端不写库：正文绝不交给 Lake 编辑器，也不保存（对齐「非 doc 只读」铁律）。
 *
 * 单元格按字段类型给**只读控件**（与桌面同一语义，但不可交互）：布尔复选框、链接（系统浏览器打开）、
 * 评分星级、进度条、关联 chip、选项色块、图片缩略图；其余走记录级展示文本。
 */
import { useMemo, useState, type ReactNode } from "react";
import { FileKindIcon } from "../../features/bitable/FileKindIcon.js";
import {
  applyViewToRecords,
  BITABLE_PROGRESS_MAX,
  BITABLE_RATING_MAX,
  bitableAttachments,
  bitableFieldText,
  bitableRecordTitle,
  isAttachmentLikeField,
  isImplementedViewType,
  isKnownViewType,
  optionChipStyle,
  orderedTableFields,
  parseBitableBody,
  relationRecordIds,
  relationTargetRecords,
  relationTargetTable,
  viewTypeLabel,
  type BitableDisplayContext,
  type BitableField,
  type BitableRecord,
} from "../../core/bitableDoc.js";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { native } from "../../lib/native";
import { showToast } from "../ui/toastBus";

export interface MobileBitableViewerProps {
  noteId: string;
  content: string;
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
  const attachments = bitableAttachments(value);
  if (attachments.length === 0) return <EmptyCell />;
  const openWithSystem = (file: string) => {
    void native.openAttachment(noteId, file).catch((error: unknown) => {
      showToast(error instanceof Error && error.message ? error.message : "没有可打开此文件的应用", { type: "error" });
    });
  };
  return (
    <span className="mbt-attachments">
      {attachments.map(({ file, name }) => (
        imageOnly && isImageExtension(extOf(file))
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
              {imageOnly ? name : <><FileKindIcon name={name} size={15} /><span className="mbt-attachment-name ln-ellipsis">{name}</span></>}
            </button>
          )
      ))}
    </span>
  );
}

/** 单选/多选：选项色块（与桌面同一 optionChipStyle）。 */
function OptionChips({ field, value }: { field: BitableField; value: unknown }) {
  const ids = Array.isArray(value) ? (value as unknown[]) : [value];
  const options = ids
    .map((id) => (field.options ?? []).find((option) => option.id === id))
    .filter((option): option is NonNullable<typeof option> => !!option);
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
  const stars = Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(value)));
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
  const pct = Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(value)));
  return (
    <span className="mbt-progress">
      <span className="mbt-progress-track"><span className="mbt-progress-bar" style={{ width: pct + "%" }} /></span>
      <span className="mbt-progress-value">{pct}%</span>
    </span>
  );
}

/** 只读链接：http(s) 走系统浏览器（`<a target="_blank">`，Capacitor 对外部 origin 走 Intent），其余当文本。 */
function LinkCell({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return <EmptyCell />;
  return /^https?:\/\//i.test(text)
    ? <a className="mbt-link" href={text} target="_blank" rel="noopener noreferrer">{text}</a>
    : <span>{text}</span>;
}

/** 只读关联：目标记录主字段 chip；目标表/记录失效时给失效文案（与桌面同一 core 口径）。 */
function RelationCell({ ctx, field, value }: { ctx: BitableDisplayContext; field: BitableField; value: unknown }) {
  if (relationRecordIds(value).length === 0) return <EmptyCell />;
  const target = relationTargetTable(ctx, field);
  const records = relationTargetRecords(ctx, field, value);
  if (!target || records.length === 0) return <span className="mbt-cell-empty">关联已失效</span>;
  return (
    <span className="mbt-relation">
      {records.map((record) => {
        const label = bitableRecordTitle(target, record, ctx);
        return <span key={record.id} className="mbt-relation-chip" title={label}>{label}</span>;
      })}
    </span>
  );
}

/** 按字段类型分派只读单元格（未知类型只读展示）。 */
function FieldValue({ noteId, ctx, field, record }: { noteId: string; ctx: BitableDisplayContext; field: BitableField; record: BitableRecord }): ReactNode {
  const value = record.values[field.id];
  if (isAttachmentLikeField(field.type)) return <AttachmentCell noteId={noteId} value={value} imageOnly={field.type === "image"} />;
  if (field.type === "select" || field.type === "multiSelect") return <OptionChips field={field} value={value} />;
  if (field.type === "boolean") return typeof value === "boolean" ? <input className="mbt-bool" type="checkbox" checked={value} disabled aria-label="布尔值" /> : <EmptyCell />;
  if (field.type === "link") return <LinkCell value={value} />;
  if (field.type === "rating") return <RatingCell value={value} />;
  if (field.type === "progress") return <ProgressCell value={value} />;
  if (field.type === "relation") return <RelationCell ctx={ctx} field={field} value={value} />;
  const text = bitableFieldText(record, field, ctx);
  return text === "" ? <EmptyCell /> : <>{text}</>;
}

export function MobileBitableViewer({ noteId, content }: MobileBitableViewerProps) {
  const doc = useMemo(() => parseBitableBody(content), [content]);
  const [tableId, setTableId] = useState<string | null>(null);
  const table = doc?.tables.find((item) => item.id === tableId) ?? doc?.tables[0];

  if (!doc || !table) {
    return <div className="mobile-empty">这张多维表还没有数据表。</div>;
  }
  const view = table.views.find((item) => item.id === table.activeViewId) ?? table.views[0];
  const fields = orderedTableFields(table, view);
  const records = applyViewToRecords(table, view);
  /** 关联字段展示需要同一文档的 tables（桌面同一条 core 口径）。 */
  const displayCtx: BitableDisplayContext = { tables: doc.tables };

  return (
    <div className="mobile-bitable" data-mobile-bitable>
      {doc.tables.length > 1 && (
        <div className="mbt-tables" role="tablist" aria-label="数据表">
          {doc.tables.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={"mbt-table-tab" + (item.id === table.id ? " is-active" : "")}
              aria-selected={item.id === table.id}
              onClick={() => setTableId(item.id)}
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
        <span className="mbt-readonly">只读</span>
      </div>
      {/* 桌面视图类型是开放集合：移动端首版只做表格只读，非 grid 视图必须给明确交代（不允许空白/静默降级） */}
      {view.type !== "grid" && (
        <div className="mbt-view-notice" role="status">
          {!isKnownViewType(view.type)
            ? "当前版本不支持「" + view.type + "」视图，已按表格只读展示。"
            : isImplementedViewType(view.type)
              ? "「" + viewTypeLabel(view.type) + "」桌面已支持，移动端暂以表格只读展示。"
              : "「" + viewTypeLabel(view.type) + "」暂未提供，移动端以表格只读展示。"}
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
            {records.map((record) => (
              <tr key={record.id}>
                {fields.map((field) => (
                  <td key={field.id}>
                    <FieldValue noteId={noteId} ctx={displayCtx} field={field} record={record} />
                  </td>
                ))}
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td className="mbt-empty" colSpan={Math.max(1, fields.length)}>当前视图没有记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MobileBitableViewer;
