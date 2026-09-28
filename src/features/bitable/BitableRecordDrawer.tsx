/**
 * 记录详情抽屉（v1）：主字段标题 + 字段表单 + 上一条/下一条 + 新增字段 + 关闭。
 * 记录正文（每条一篇 Lake 富文本）v1 明确不做（用户 260919 决定）。
 * 宽度可左右拖拽（左缘手柄），持久化在本机 localStorage。
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Drawer } from "../../components/ui/Overlay";
import { bitableRecordTitle, removeBitableAttachment, renameBitableAttachment, reorderBitableAttachments, type BitableAttachment, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
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
  onOpenAsset: (attachment: BitableAttachment) => void;
  /** 点图片预览：只传**本单元格内**的图片 + 下标。 */
  onOpenImages: (images: BitableAttachment[], index: number) => void;
}

const DRAWER_WIDTH_KEY = "lake-notes-v3.bitable-drawer-width";
const MIN_W = 320;
const MAX_W = 1000;

export function BitableRecordDrawer(props: BitableRecordDrawerProps) {
  const { table, record } = props;
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : 460;
  });
  useEffect(() => { writeLocalStorage(DRAWER_WIDTH_KEY, String(width)); }, [width]);
  /** 左缘手柄向右拖变窄、向左拖变宽（云端同语义）。 */
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    const onMove = (ev: PointerEvent) => setWidth(Math.max(MIN_W, Math.min(MAX_W, Math.min(window.innerWidth - 80, startW + (startX - ev.clientX)))));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <Drawer open onDismiss={props.onClose} label="记录详情" surfaceClassName="ln-dialog bt-drawer" style={{ width }}>
      <div className="bt-drawer-resize" onPointerDown={startResize} title="拖动调整宽度" aria-label="拖动调整宽度" role="separator" />
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
                record={record}
                value={record.values[field.id]}
                readOnly={props.readOnly}
                onChange={(value) => props.onSetValue(record.id, field.id, value)}
                onAddOption={(name) => props.onAddOption(field.id, name, record.id)}
                renderAttachment={(imageOnly) => (
                  <AttachmentCell
                    noteId={props.noteId}
                    value={record.values[field.id]}
                    readOnly={props.readOnly}
                    alwaysActive
                    imageOnly={imageOnly}
                    onUpload={(files) => props.onUpload(record.id, field.id, files)}
                    onRemove={(file) => props.onSetValue(record.id, field.id, removeBitableAttachment(record.values[field.id], file))}
                    onOpen={props.onOpenAsset}
                    onOpenImages={props.onOpenImages}
                    onReorder={(files) => props.onSetValue(record.id, field.id, reorderBitableAttachments(record.values[field.id], files))}
                    onRename={(file, name) => props.onSetValue(record.id, field.id, renameBitableAttachment(record.values[field.id], file, name))}
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
    </Drawer>
  );
}
