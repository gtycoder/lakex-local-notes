/**
 * 移动端多维表「字段值」只读渲染（单一来源）。
 *
 * 从 `MobileBitableViewer` 抽出（261030）：只读表格、卡片布局、记录详情页、表单回显都要用同一套
 * 字段渲染（选项 chip / 附件图标 / 评分 / 进度 / 关联 / 链接），抽出来避免四份实现漂移。
 * 类名与行为保持原样（`mbt-*`），视觉全部由 `src/mobile/mobile.css` 与 `mobileBitable.css` 承担。
 */
import type { ReactNode } from "react";
import { BITABLE_RATING_MAX, bitableFieldText, isAttachmentLikeField, isRelationFieldType, optionChipStyle, type BitableDisplayContext, type BitableField, type BitableRecord } from "../../core/bitableDoc.js";
import { readOnlyAttachments, readOnlyBoolean, readOnlyLink, readOnlyOptions, readOnlyProgress, readOnlyRating, readOnlyRelation } from "../../core/bitableReadOnly.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { native } from "../../lib/native";
import { showToast } from "../ui/toastBus";
import { FileKindIcon } from "../../features/bitable/FileKindIcon.js";

export function EmptyCell() {
  return <span className="mbt-cell-empty">—</span>;
}

/**
 * 附件/图片字段值（`{ file, name }[]`）。点击一律**直接用系统应用打开**。
 * 图片字段 = 缩略图；附件字段 = 文档类型图标 + 名称（触屏没有 hover，名称不能收进气泡）。
 */
export function AttachmentCell({ noteId, value, imageOnly }: { noteId: string; value: unknown; imageOnly: boolean }) {
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
export function OptionChips({ field, value }: { field: BitableField; value: unknown }) {
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
export function RatingCell({ value }: { value: unknown }) {
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
export function ProgressCell({ value }: { value: unknown }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  const pct = readOnlyProgress(value);
  return (
    <span className="mbt-progress">
      <span className="mbt-progress-track"><span className="mbt-progress-bar" style={{ width: pct + "%" }} /></span>
      <span className="mbt-progress-value">{pct}%</span>
    </span>
  );
}

/** 只读链接：http(s) 走系统浏览器。 */
export function LinkCell({ value }: { value: unknown }) {
  const link = readOnlyLink(value);
  if (!link.text) return <EmptyCell />;
  return link.href
    ? <a className="mbt-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a>
    : <span>{link.text}</span>;
}

/** 只读关联：目标记录主字段 chip；目标表/记录失效时给失效文案。 */
export function RelationCell({ ctx, field, value }: { ctx: BitableDisplayContext; field: BitableField; value: unknown }) {
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

/** 按字段类型分派只读渲染（未知类型只读文本）。 */
export function FieldValue({ noteId, ctx, field, record }: { noteId: string; ctx: BitableDisplayContext; field: BitableField; record: BitableRecord }): ReactNode {
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
