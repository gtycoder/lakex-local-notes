/**
 * 多维表画册视图（V03）。
 *
 * 以卡片网格展示记录，主要服务图片/附件：封面取封面附件字段里**第一个图片附件**
 * （非图片跳过、没有可用图片 → 无封面占位），缩略图沿用单元格附件那套资产 URL + `?w=` 档位。
 * 常规/紧凑、裁剪/适应、卡片字段与字段名都是**视图级配置**（只存正文 JSON，不复制记录）。
 * 封面与卡片字段的投影全在 src/core/bitableDoc.ts 的纯函数里，这里只渲染。
 */
import { ImageOff } from "lucide-react";
import { bitableAssetUrl, openBitableAttachment } from "./bitableAssetUrl.js";
import { AttachmentChipList } from "./bitableCells.js";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import {
  bitableAttachments, bitableFieldText, bitableRecordTitle, galleryCardFields, galleryCoverField, galleryCoverImage, isAttachmentLikeField,
  type BitableAttachment, type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import "./bitableGalleryView.css";

/** 封面缩略图档位基准宽度（列宽约 180–220px，2x 屏取 240 足够）。 */
const GALLERY_COVER_PX = 240;

export interface BitableGalleryViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  /** 已按视图筛选/排序（含搜索）的记录。 */
  records: BitableRecord[];
  onOpenRecord: (recordId: string) => void;
  /** 点封面直接预览：只传**封面字段这一格**里的图片（用户 260928：两列图片就是两类，
   *  绝不跨列/跨行合并）。没有封面时封面不是按钮，点卡片仍然开记录详情。 */
  onOpenImages: (images: BitableAttachment[], index: number) => void;
  /** 关联解析上下文（同一文档的 tables）。 */
  ctx?: BitableDisplayContext;
}

export function BitableGalleryView({ noteId, table, view, records, onOpenRecord, onOpenImages, ctx }: BitableGalleryViewProps) {
  const cardFields = galleryCardFields(table, view);
  const coverField = galleryCoverField(table, view);
  /** 封面所在**单元格**里的全部图片（顺序 = 单元格内顺序）：预览范围就限定在这里。 */
  const cellImagesOf = (record: BitableRecord): BitableAttachment[] =>
    coverField ? bitableAttachments(record.values[coverField.id]).filter((item) => isImageExtension(extOf(item.file))) : [];
  const showNames = view.galleryShowFieldNames !== false;
  const compact = view.gallerySize === "compact";
  const fit = view.galleryFit === "contain" ? "contain" : "cover";
  const coverSrc = (file: string) => bitableAssetUrl(noteId, file, GALLERY_COVER_PX);

  if (records.length === 0) {
    return <div className="bt-gallery-empty">当前视图没有记录。</div>;
  }
  return (
    <div className={"bt-gallery" + (compact ? " is-compact" : "")}>
      {records.map((record) => {
        const cover = galleryCoverImage(table, view, record);
        const cellImages = cover ? cellImagesOf(record) : [];
        const coverIndex = cover ? cellImages.findIndex((item) => item.file === cover.file) : -1;
        return (
          <article key={record.id} className="bt-gallery-card" onClick={() => onOpenRecord(record.id)}>
            {cover ? (
              <button type="button" className={"bt-gallery-cover" + (fit === "contain" ? " is-contain" : "")}
                title={cover.name} aria-label={"预览 " + cover.name}
                onClick={(event) => { event.stopPropagation(); onOpenImages(cellImages, coverIndex < 0 ? 0 : coverIndex); }}>
                <img className="ln-imgfill" src={coverSrc(cover.file)} alt={cover.name} loading="lazy" />
              </button>
            ) : (
              <div className="bt-gallery-cover">
                <ImageOff size={20} className="bt-gallery-cover-empty" aria-hidden="true" />
              </div>
            )}
            <div className="bt-gallery-body">
              <div className="bt-gallery-title ln-ellipsis">{bitableRecordTitle(table, record, ctx)}</div>
              {cardFields.map((field) => {
                /* 附件/图片字段与表格/看板/选择器**同一套**渲染（用户 260930：「画册视图的附件也要改」）：
                   附件字段 = 类型图标、图片字段 = 缩略图，都不显示名称（名字靠 hover 气泡）。
                   以前这里走 `bitableFieldText` ⇒ 卡片上是一串文件名。 */
                if (isAttachmentLikeField(field.type)) {
                  const files = bitableAttachments(record.values[field.id]);
                  if (files.length === 0) return null;   // 空字段不上卡
                  return (
                    <div key={field.id} className="bt-gallery-field">
                      {showNames && <span className="bt-gallery-field-name">{field.name}</span>}
                      <span className="bt-card-files" onClick={(event) => event.stopPropagation()}>
                        <AttachmentChipList noteId={noteId} attachments={files} imageOnly={field.type === "image"}
                          onOpen={(attachment) => openBitableAttachment(noteId, attachment)} onOpenImages={onOpenImages} />
                      </span>
                    </div>
                  );
                }
                const text = bitableFieldText(record, field, ctx);
                if (!text) return null;   // 空字段不上卡
                return (
                  <div key={field.id} className="bt-gallery-field">
                    {showNames && <span className="bt-gallery-field-name">{field.name}</span>}
                    <span className="bt-gallery-field-value" title={text}>{text}</span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
