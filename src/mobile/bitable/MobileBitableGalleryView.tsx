/**
 * 移动端多维表「画册」视图（261030 P2）。
 *
 * 语义来自 core：封面 = 封面附件字段里的第一张图（`galleryCoverImage`），卡片字段 = `galleryCardFields`；
 * 移动端固定两列（手机上 3 列放不下封面 + 标题），点卡片进详情/编辑。
 */
import { bitableRecordTitle, galleryCardFields, galleryCoverField, galleryCoverImage, type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView } from "../../core/bitableDoc.js";
import { bitableAssetUrl } from "../../features/bitable/bitableAssetUrl.js";
import { FieldValue } from "./MobileBitableValue";

export interface MobileBitableGalleryViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  records: BitableRecord[];
  ctx: BitableDisplayContext;
  onOpen: (recordId: string) => void;
}

export function MobileBitableGalleryView({ noteId, table, view, records, ctx, onOpen }: MobileBitableGalleryViewProps) {
  const coverField = galleryCoverField(table, view);
  const cardFields = galleryCardFields(table, view);
  return (
    <div className="mbt-gallery" role="list" aria-label="画册">
      {records.map((record) => {
        const cover = galleryCoverImage(table, view, record);
        return (
          <article key={record.id} className="mbt-gallery-card" role="button" tabIndex={0}
            onClick={() => onOpen(record.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(record.id); } }}>
            {cover
              ? <img className="mbt-gallery-card__cover" src={bitableAssetUrl(noteId, cover.file, 160)} alt={cover.name} loading="lazy" />
              : <div className="mbt-gallery-card__cover mbt-gallery-card__cover--empty" aria-hidden="true" />}
            <div className="mbt-gallery-card__body">
              <div className="mbt-gallery-card__title">{bitableRecordTitle(table, record, ctx)}</div>
              {cardFields.map((field) => (
                <div key={field.id} className="mbt-gallery-card__row">
                  <span className="mbt-gallery-card__k">{field.name}</span>
                  <span className="mbt-gallery-card__v"><FieldValue noteId={noteId} ctx={ctx} field={field} record={record} /></span>
                </div>
              ))}
            </div>
          </article>
        );
      })}
      {records.length === 0 && <div className="mbt-view-empty">当前视图没有记录</div>}
      {!coverField && records.length > 0 && (
        <div className="mbt-gallery-hint">还没有选封面字段：到桌面「视图配置 → 画册」里选一个附件字段。</div>
      )}
    </div>
  );
}

export default MobileBitableGalleryView;
