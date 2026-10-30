/**
 * 移动端多维表「看板」视图（261030 P2）。
 *
 * 语义全部来自 core（`kanbanColumns` / `kanbanCardFields` / `bitableRecordTitle`）：选项即分栏、
 * 空栏目保留、未分组垫底；移动端只负责「横向滑动的列 + 卡片 + 点卡进详情/编辑」。
 * 只读态点卡片 → 记录详情页；编辑态 → 记录面板（由父级按 editable 决定，本组件只回调 onOpen）。
 */
import { bitableRecordTitle, kanbanCardFields, kanbanColumns, kanbanGroupField, optionChipStyle, type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView } from "../../core/bitableDoc.js";
import { FieldValue } from "./MobileBitableValue";

export interface MobileBitableKanbanViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  records: BitableRecord[];
  ctx: BitableDisplayContext;
  onOpen: (recordId: string) => void;
}

export function MobileBitableKanbanView({ noteId, table, view, records, ctx, onOpen }: MobileBitableKanbanViewProps) {
  const groupField = kanbanGroupField(table, view);
  if (!groupField) {
    return <div className="mbt-view-empty">看板视图还没选分组字段（单选）：到桌面「视图配置 → 看板」里选一个。</div>;
  }
  const columns = kanbanColumns(table, view, records);
  const cardFields = kanbanCardFields(table, view);
  return (
    <div className="mbt-kanban" role="list" aria-label="看板">
      {columns.map((column) => (
        <section key={column.key || "ungrouped"} className="mbt-kanban-col" role="listitem">
          <header className="mbt-kanban-head">
            {column.optionId
              ? <span className="mb-tag" style={optionChipStyle(column.color)}>{column.label}</span>
              : <span className="mbt-kanban-head__title">{column.label}</span>}
            <span className="mbt-kanban-count">{column.records.length}</span>
          </header>
          <div className="mbt-kanban-cards">
            {column.records.map((record) => (
              <article key={record.id} className="mbt-kanban-card" role="button" tabIndex={0}
                onClick={() => onOpen(record.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(record.id); } }}>
                <div className="mbt-kanban-card__title">{bitableRecordTitle(table, record, ctx)}</div>
                {cardFields.map((field) => (
                  <div key={field.id} className="mbt-kanban-card__row">
                    <span className="mbt-kanban-card__k">{field.name}</span>
                    <span className="mbt-kanban-card__v"><FieldValue noteId={noteId} ctx={ctx} field={field} record={record} /></span>
                  </div>
                ))}
              </article>
            ))}
            {column.records.length === 0 && <div className="mbt-kanban-empty">空</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

export default MobileBitableKanbanView;
