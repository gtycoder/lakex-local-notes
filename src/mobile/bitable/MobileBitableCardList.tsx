/**
 * 移动端多维表「卡片」布局（261030 P0）—— 表格视图的另一种记录展示方式。
 *
 * 口径（对齐钉钉 + 用户 261030）：
 * - 同一份记录、同一套筛选/排序/分组，只换展示：分组头 + 卡片；
 * - 卡片 = 主标题（默认主字段）→ 可选副标题 → 展示字段逐行「字段名 + 值」→ 可选封面图；
 * - 列数只支持 1 / 2（3 列在手机上放不下，用户 261030 明确不做）；
 * - 只读：整张卡可点进记录详情页。
 */
import { groupRecords, type BitableDisplayContext, type BitableField, type BitableRecord, type BitableTable, type BitableView } from "../../core/bitableDoc.js";
import { formatGroupLabel } from "./mobileBitableFormat";
import type { BitableResolvedRecordLayout } from "../../core/bitableRecordLayout";
import { AttachmentCell, FieldValue } from "./MobileBitableValue";

export interface MobileBitableCardListProps {
  noteId: string;
  table: BitableTable;
  view: BitableView | undefined;
  records: BitableRecord[];
  layout: BitableResolvedRecordLayout;
  ctx: BitableDisplayContext;
  onOpen: (recordId: string) => void;
}

function CardTitle({ noteId, ctx, field, record }: { noteId: string; ctx: BitableDisplayContext; field: BitableField | null; record: BitableRecord }) {
  if (!field) return null;
  return <span className="mbt-card__title">{<FieldValue noteId={noteId} ctx={ctx} field={field} record={record} />}</span>;
}

export function MobileBitableCardList({ noteId, table, view, records, layout, ctx, onOpen }: MobileBitableCardListProps) {
  const groupRule = view?.groups?.[0];
  const groupField = groupRule ? table.fields.find((field) => field.id === groupRule.fieldId) : undefined;
  const groups = groupRecords(table, records, groupRule);
  return (
    <div className="mbt-cards">
      {groups.map((group) => (
        <section key={group.key || "__all"} className="mbt-cards__group">
          {group.label && (
            <div className="mbt-cards__ghead">
              <span>{formatGroupLabel(groupField, group.label)}</span>
              <span className="mbt-cards__gcount">{group.records.length} 条记录</span>
            </div>
          )}
          <div className={"mbt-cards__list cols-" + layout.columns}>
            {group.records.map((record) => (
              <article key={record.id} className="mbt-card" onClick={() => onOpen(record.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(record.id); } }}
                role="button" tabIndex={0} aria-label="查看记录">
                {layout.cover && layout.coverField && (
                  <div className="mbt-card__cover">
                    <AttachmentCell noteId={noteId} value={record.values[layout.coverField.id]} imageOnly={layout.coverField.type === "image"} />
                  </div>
                )}
                <div className="mbt-card__body">
                  <div className="mbt-card__titles">
                    <CardTitle noteId={noteId} ctx={ctx} field={layout.titleField} record={record} />
                    {layout.subtitleField && (
                      <span className="mbt-card__subtitle"><FieldValue noteId={noteId} ctx={ctx} field={layout.subtitleField} record={record} /></span>
                    )}
                  </div>
                  {layout.fields.map((field) => (
                    <div key={field.id} className="mbt-card__row">
                      <span className="mbt-card__k">{field.name}</span>
                      <span className="mbt-card__v"><FieldValue noteId={noteId} ctx={ctx} field={field} record={record} /></span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {records.length === 0 && <div className="mbt-empty">当前视图没有记录</div>}
    </div>
  );
}

export default MobileBitableCardList;
