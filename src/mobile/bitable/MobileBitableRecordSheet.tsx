/**
 * 移动端多维表「记录」底部面板（261020 P0）。
 *
 * 交互定稿：**点单元格 → 打开该记录的底部面板**（不是原地把格子变成输入框）。
 * 理由：触屏 + IME 下原地输入要处理滚动/键盘/单元格尺寸，且单选/多选/日期/评分/进度在触屏上都需要弹层；
 * 飞书/语雀移动端多维表同样是「点格开记录面板」，一个面板即可覆盖全部字段类型（见 HANDOFF 261020 决策）。
 * 布尔值另有快路径：网格里单击直接切换，不必进面板。
 *
 * 覆盖范围：文本 / 数字 / 日期 / 单选 / 多选 / 复选框 / 链接 / 评分 / 进度 / **附件 / 图片上传**（261030 P1，
 * 与表单共用 MobileBitableAttachmentEditor）。其余类型（关联/系统时间/AI/Markdown）**只读展示并写明理由**。
 */
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  BITABLE_RATING_MAX,
  bitableFieldText,
  optionChipStyle,
  type BitableDisplayContext,
  type BitableField,
  type BitableRecord,
  type BitableTable,
} from "../../core/bitableDoc.js";
import {
  isMobileEditableField, mobileFieldNote, progressValue, ratingValue,
  selectedOptionIds, textInputValue,
} from "./mobileBitableEdit";
import { MobileBitableDateField } from "./MobileBitableDateField";
import { dismissKeyboardOnPointerDown } from "../ui/dismissKeyboard";
import { MobileSheet } from "../ui/MobileSheet";
import { MobileBitableAttachmentEditor } from "./MobileBitableAttachmentEditor";

export interface MobileBitableRecordSheetProps {
  noteId: string;
  table: BitableTable;
  /** 与网格同序的可见字段（视图投影后的顺序）。 */
  fields: BitableField[];
  record: BitableRecord;
  ctx: BitableDisplayContext;
  /** 写一个字段值（父级负责落 doc + 标脏保存）。 */
  onPatch: (fieldId: string, value: unknown) => void;
  /** 单选/多选新建选项；返回新选项 id 供立即选中。 */
  onAddOption: (fieldId: string, name: string) => string | null;
  onDelete: () => void;
  onClose: () => void;
}

function DraftInputControl({ value, onChange, numeric = false }: { value: unknown; onChange: (value: unknown) => void; numeric?: boolean }) {
  const initial = textInputValue(value);
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const committedRef = useRef(initial);
  draftRef.current = draft;

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(textInputValue(value));
  }, [value]);

  const commit = (): void => {
    if (draftRef.current === committedRef.current) return;
    committedRef.current = draftRef.current;
    onChange(draftRef.current);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (document.activeElement === inputRef.current) commit();
    }, 250);
    return () => window.clearTimeout(timer);
  });

  return (
    <label className="mb-input">
      <input
        ref={inputRef}
        value={draft}
        inputMode={numeric ? "decimal" : "text"}
        type={numeric ? "text" : undefined}
        autoComplete="off"
        onChange={(event) => setDraft(numeric ? event.target.value.replace(/[^0-9.\-]/g, "") : event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { event.preventDefault(); setDraft(textInputValue(value)); }
        }}
        aria-label={numeric ? "数字值" : "文本值"}
      />
    </label>
  );
}

function TextControl({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return <DraftInputControl value={value} onChange={onChange} />;
}

function NumberControl({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return <DraftInputControl value={value} onChange={onChange} numeric />;
}


function SelectControl({ field, value, onChange, onAddOption }: {
  field: BitableField; value: unknown; onChange: (value: unknown) => void; onAddOption: (name: string) => string | null;
}) {
  const multi = field.type === "multiSelect";
  const selected = selectedOptionIds(value);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const name = draft.trim();
    setDrafting(false);
    setDraft("");
    if (!name) return;
    const optionId = onAddOption(name);
    if (!optionId) return;
    // 新建即选中（单选取代、多选追加），与桌面 addOption 的记录内行为一致。
    onChange(multi ? [...new Set([...selected, optionId])] : optionId);
  };
  return (
    <div className="mb-chip-row" role={multi ? "group" : "radiogroup"} aria-label={field.name}>
      {(field.options ?? []).map((option) => {
        const on = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            className={"mb-chip" + (on ? " is-on" : "")}
            style={optionChipStyle(option.color)}
            onClick={() => {
              if (multi) onChange(on ? selected.filter((id) => id !== option.id) : [...selected, option.id]);
              else onChange(on ? "" : option.id);
            }}
          >{option.name}</button>
        );
      })}
      {drafting ? (
        <span className="mb-input mbt-option-add">
          <input
            autoFocus
            value={draft}
            placeholder="新选项名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
            onBlur={commit}
            aria-label="新选项名称"
          />
        </span>
      ) : (
        <button type="button" className="mb-chip" onClick={() => setDrafting(true)} aria-label="新建选项">
          <Plus size={14} />选项
        </button>
      )}
    </div>
  );
}

function BooleanControl({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const on = value === true;
  return (
    <button
      type="button"
      className="mb-switch"
      role="switch"
      aria-checked={on}
      aria-label="布尔值"
      onClick={() => onChange(!on)}
    >
      <span className="mb-switch__knob" />
    </button>
  );
}

function RatingControl({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const current = ratingValue(value);
  return (
    <span className="mbt-rating" role="radiogroup" aria-label="评分">
      {Array.from({ length: BITABLE_RATING_MAX }, (_, index) => {
        const stars = index + 1;
        return (
          <button
            key={stars}
            type="button"
            role="radio"
            aria-checked={stars === current}
            aria-label={stars + " 星"}
            className={"mbt-star mbt-rating-btn" + (index < current ? " is-on" : "")}
            onClick={() => onChange(current === stars ? 0 : stars)}
          >★</button>
        );
      })}
    </span>
  );
}

function ProgressControl({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const pct = progressValue(value);
  return (
    <span className="mbt-progress-edit">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="进度"
      />
      <span className="mbt-progress-value">{pct}%</span>
    </span>
  );
}

export function MobileBitableRecordSheet({ noteId, table, fields, record, ctx, onPatch, onAddOption, onDelete, onClose }: MobileBitableRecordSheetProps) {
  // MOB-11：scrim / 右滑 / 返回栈 / 焦点 / 滚动锁统一由 MobileSheet 负责；
  // 类名与 DOM 结构沿用原手写版（.mb-sheet__title.mb-ellipsis + .mb-sheet__body--form，视觉不变）。
  return (
    <MobileSheet open title={"编辑记录：" + table.name} titleClassName="mb-ellipsis" ariaLabel="编辑记录" bodyClassName="mb-sheet__body--form" onClose={onClose}>
      <div className="mb-set-section" onPointerDown={dismissKeyboardOnPointerDown}>
        {fields.map((field) => {
          const value = record.values[field.id];
          const editable = isMobileEditableField(field);
          return (
            <div key={field.id} className="mb-set-item mb-set-item--field">
              <div className="mb-set-item__main">
                <span className="mb-set-name">{field.name}</span>
                {!editable && <span className="mb-set-item__note">{mobileFieldNote(field)}</span>}
              </div>
              <div className="mb-set-item__ctl">
                {!editable ? (
                  <span className="mbt-record-readonly">{bitableFieldText(record, field, ctx) || "—"}</span>
                ) : field.type === "attachment" || field.type === "image" ? (
                  <MobileBitableAttachmentEditor noteId={noteId} field={field} value={value}
                    onChange={(next) => onPatch(field.id, next)} />
                ) : field.type === "boolean" ? (
                  <BooleanControl value={value} onChange={(next) => onPatch(field.id, next)} />
                ) : field.type === "select" || field.type === "multiSelect" ? (
                  <SelectControl field={field} value={value} onChange={(next) => onPatch(field.id, next)} onAddOption={(name) => onAddOption(field.id, name)} />
                ) : field.type === "date" ? (
                  <MobileBitableDateField value={value} ariaLabel={field.name} onChange={(next) => onPatch(field.id, next)} />
                ) : field.type === "number" ? (
                  <NumberControl value={value} onChange={(next) => onPatch(field.id, next)} />
                ) : field.type === "rating" ? (
                  <RatingControl value={value} onChange={(next) => onPatch(field.id, next)} />
                ) : field.type === "progress" ? (
                  <ProgressControl value={value} onChange={(next) => onPatch(field.id, next)} />
                ) : (
                  <TextControl value={value} onChange={(next) => onPatch(field.id, next)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mbt-record-actions">
        <button type="button" className="mb-btn mb-btn--danger mb-btn--block" onClick={onDelete}>删除记录</button>
      </div>
    </MobileSheet>
  );
}

export default MobileBitableRecordSheet;
