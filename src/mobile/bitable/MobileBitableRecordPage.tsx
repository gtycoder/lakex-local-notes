/**
 * 移动端多维表「记录详情」只读页（261030 P0）。
 *
 * 对齐钉钉：点表格行 / 卡片 → **整页**详情（不是底部面板），标题 = 主字段值，字段逐行 名称+值，
 * 底部 1/N 翻页。编辑态仍走原来的记录底部面板（点击即编辑），两者互不替代。
 * 只读态没有任何编辑入口（AGENTS「打开 = 只读」口径）。
 */
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { bitableFieldText, type BitableDisplayContext, type BitableField, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { FieldValue } from "./MobileBitableValue";

export interface MobileBitableRecordPageProps {
  noteId: string;
  table: BitableTable;
  /** 与当前视图同序的可见字段。 */
  fields: BitableField[];
  record: BitableRecord;
  ctx: BitableDisplayContext;
  /** 0-based 位置与总数（按当前视图过滤后的顺序）。 */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function MobileBitableRecordPage({ noteId, table, fields, record, ctx, index, total, onPrev, onNext, onClose }: MobileBitableRecordPageProps) {
  const primary = table.fields[0];
  const title = (primary ? bitableFieldText(record, primary, ctx) : "").trim() || "记录 " + (index + 1);
  return (
    <section className="mbt-page" aria-label="记录详情">
      <header className="mbt-page-bar">
        <button type="button" className="mb-iconbtn" aria-label="返回" onClick={onClose}><ArrowLeft size={18} /></button>
        <span className="mbt-page-bar__title">记录详情</span>
        <span className="mbt-readonly">只读</span>
      </header>
      <div className="mbt-page-body">
        <h2 className="mbt-page-title">{title}</h2>
        <div className="mbt-detail">
          {fields.map((field) => (
            <div key={field.id} className="mbt-detail-row">
              <span className="mbt-detail-k">{field.name}</span>
              <span className="mbt-detail-v"><FieldValue noteId={noteId} ctx={ctx} field={field} record={record} /></span>
            </div>
          ))}
        </div>
      </div>
      <footer className="mbt-page-foot">
        <span className="mbt-page-note">这份收集表默认只读；记录内容不能在这里修改。</span>
        <div className="mbt-stepper">
          <button type="button" className="mb-iconbtn" aria-label="上一条" disabled={total <= 1} onClick={onPrev}><ChevronLeft size={16} /></button>
          <span className="mbt-stepper__idx">{index + 1}/{Math.max(1, total)}</span>
          <button type="button" className="mb-iconbtn" aria-label="下一条" disabled={total <= 1} onClick={onNext}><ChevronRight size={16} /></button>
        </div>
      </footer>
    </section>
  );
}

export default MobileBitableRecordPage;
