/**
 * 记录详情抽屉（v1）：主字段标题 + 字段纵向表单 + 上一条/下一条 + 新增字段 + 关闭。
 * 记录正文（每条一篇 Lake 富文本）v1 明确不做（用户 260919 决定）。
 */
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { bitableRecordTitle, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { AttachmentCell, CellEditor, FieldTypeIcon } from "./bitableCells.js";

export interface BitableRecordDrawerProps {
  noteId: string;
  table: BitableTable;
  record: BitableRecord;
  readOnly: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetValue: (recordId: string, fieldId: string, value: unknown) => void;
  onAddOption: (fieldId: string, name: string, recordId: string) => void;
  onAddField: () => void;
  onUpload: (recordId: string, fieldId: string, files: File[]) => void;
  onOpenAsset: (filename: string) => void;
}

export function BitableRecordDrawer(props: BitableRecordDrawerProps) {
  const { table, record } = props;
  return (
    <aside className="bt-drawer" role="dialog" aria-label="记录详情">
      <header className="bt-drawer-head">
        <div className="bt-drawer-nav">
          <button type="button" className="bt-icon-btn" onClick={props.onPrev} title="上一条" aria-label="上一条"><ChevronUp size={15} /></button>
          <button type="button" className="bt-icon-btn" onClick={props.onNext} title="下一条" aria-label="下一条"><ChevronDown size={15} /></button>
        </div>
        <h3 className="bt-drawer-title">{bitableRecordTitle(table, record)}</h3>
        <button type="button" className="bt-icon-btn" onClick={props.onClose} title="关闭" aria-label="关闭"><X size={16} /></button>
      </header>
      <div className="bt-drawer-body">
        {table.fields.map((field) => (
          <div key={field.id} className="bt-drawer-row">
            <span className="bt-drawer-label">
              <FieldTypeIcon type={field.type} />
              <span className="bt-drawer-label-text">{field.name}</span>
              {field.required && <em className="bt-required">*</em>}
            </span>
            <span className="bt-drawer-control">
              <CellEditor
                field={field}
                value={record.values[field.id]}
                readOnly={props.readOnly}
                onChange={(value) => props.onSetValue(record.id, field.id, value)}
                onAddOption={(name) => props.onAddOption(field.id, name, record.id)}
                renderAttachment={() => (
                  <AttachmentCell
                    noteId={props.noteId}
                    value={record.values[field.id]}
                    readOnly={props.readOnly}
                    onUpload={(files) => props.onUpload(record.id, field.id, files)}
                    onRemove={(filename) => {
                      const current = Array.isArray(record.values[field.id]) ? (record.values[field.id] as string[]) : [];
                      props.onSetValue(record.id, field.id, current.filter((f) => f !== filename));
                    }}
                    onOpen={props.onOpenAsset}
                  />
                )}
              />
            </span>
          </div>
        ))}
        <button type="button" className="bt-drawer-addfield" onClick={props.onAddField} disabled={props.readOnly}>
          <Plus size={14} />新增字段
        </button>
      </div>
    </aside>
  );
}
