/** Window-local cell boundary: changes in another cell do not rebuild this cell's editor. */
import { memo, useCallback, type MouseEvent, type CSSProperties } from "react";
import type {
  BitableAttachment,
  BitableDisplayContext,
  BitableField,
  BitableRecord,
} from "../../core/bitableDoc";
import {
  removeBitableAttachment,
  renameBitableAttachment,
  reorderBitableAttachments,
} from "../../core/bitableDoc";
import { AttachmentCell, CellEditor } from "./bitableCells";
import type { AiCellRunState } from "./useAiFieldGeneration";
interface Props {
  field: BitableField;
  value: unknown;
  recordId: string;
  tableId: string;
  record?: BitableRecord;
  context?: BitableDisplayContext;
  readOnly: boolean;
  noteId: string;
  selected: string;
  duplicate: boolean;
  background?: string;
  color?: string;
  maxWidth: string;
  onSelect: (event: MouseEvent, recordId: string, fieldId: string) => void;
  onOver: (recordId: string, fieldId: string) => void;
  onChange: (recordId: string, fieldId: string, value: unknown) => void;
  onAddOption: (fieldId: string, name: string, recordId?: string) => void;
  uploadFiles: (files: File[]) => Promise<BitableAttachment[]>;
  appendAttachments: (
    tableId: string,
    recordId: string,
    fieldId: string,
    files: BitableAttachment[],
  ) => void;
  openAsset: (attachment: BitableAttachment) => void;
  openImages: (images: BitableAttachment[], index: number) => void;
  aiState?: AiCellRunState;
  generateCell: (
    tableId: string,
    recordId: string,
    fieldId: string,
  ) => Promise<void>;
  cancelCell: (recordId: string, fieldId: string) => void;
}
export const BitableViewportCell = memo(function BitableViewportCell(p: Props) {
  const { recordId, tableId, field, onChange, onAddOption } = p;
  const change = useCallback(
    (value: unknown) => onChange(recordId, field.id, value),
    [onChange, recordId, field.id],
  );
  const addOption = useCallback(
    (name: string) => onAddOption(field.id, name, recordId),
    [onAddOption, recordId, field.id],
  );
  const generate = useCallback(() => {
    void p.generateCell(tableId, recordId, field.id);
  }, [p.generateCell, tableId, recordId, field.id]);
  const stop = useCallback(
    () => p.cancelCell(recordId, field.id),
    [p.cancelCell, recordId, field.id],
  );
  const style: CSSProperties = {
    maxWidth: p.maxWidth,
    ...(p.background ? { backgroundImage: p.background } : {}),
    ...(p.color ? { color: p.color } : {}),
  };
  return (
    <td
      data-record-id={recordId}
      data-field-id={field.id}
      className={"bt-td" + p.selected + (p.duplicate ? " in-highlight" : "")}
      style={style}
      onMouseDown={(event) => p.onSelect(event, recordId, field.id)}
      onMouseOver={() => p.onOver(recordId, field.id)}
    >
      <CellEditor
        field={field}
        value={p.value}
        record={p.record}
        ctx={p.context}
        readOnly={p.readOnly}
        noteId={p.noteId}
        onChange={change}
        onAddOption={addOption}
        onOpenImages={p.openImages}
        aiState={p.aiState}
        onAiGenerate={field.type === "ai" ? generate : undefined}
        onAiStop={field.type === "ai" ? stop : undefined}
        renderAttachment={(imageOnly) => (
          <AttachmentCell
            noteId={p.noteId}
            value={p.value}
            readOnly={p.readOnly}
            imageOnly={imageOnly}
            onUpload={(files) => {
              void p
                .uploadFiles(files)
                .then((entries) =>
                  p.appendAttachments(tableId, recordId, field.id, entries),
                );
            }}
            onRemove={(file) => change(removeBitableAttachment(p.value, file))}
            onReorder={(files) =>
              change(reorderBitableAttachments(p.value, files))
            }
            onRename={(file, name) =>
              change(renameBitableAttachment(p.value, file, name))
            }
            onOpen={p.openAsset}
            onOpenImages={p.openImages}
          />
        )}
      />
    </td>
  );
});
