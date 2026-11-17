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
import { Check, ChevronDown, ChevronUp, Plus } from "lucide-react";
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
import { isImeConfirming } from "../../core/ime";

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
  /** 新建选项 = 跳字段编辑器（那里有回车流转批量录选项），不在记录面板内联录入（261117）。 */
  onEditField: (fieldId: string) => void;
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
          if (event.key === "Enter" && !isImeConfirming(event)) event.currentTarget.blur();
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


/**
 * 单选/多选字段控件（261117 用户点单重做）：
 * · 默认**折叠**：行内只显示已选值（不再平铺全部选项）；
 * · 点摘要行展开候选：选中 = 勾选 + 主色选中三件套（选项色底只给未选中做色相标识 ——
 *   之前选中态被选项色底淹没、完全看不出来）；
 * · 单选点选即完成并收起；多选可连选，再点摘要行收起；
 * · 「新建选项」= 跳**字段编辑器**（回车流转批量录选项），不在此处内联录入。
 */
function SelectControl({ field, value, onChange, onEditField }: {
  field: BitableField; value: unknown; onChange: (value: unknown) => void; onEditField: (fieldId: string) => void;
}) {
  const multi = field.type === "multiSelect";
  const selected = selectedOptionIds(value);
  const [open, setOpen] = useState(false);
  const options = field.options ?? [];
  const chosen = options.filter((option) => selected.includes(option.id));
  const toggle = (optionId: string): void => {
    if (multi) {
      onChange(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]);
      return;
    }
    onChange(selected.includes(optionId) ? "" : optionId);
    setOpen(false); // 单选点选即完成
  };
  return (
    <div className="mbt-select">
      <button
        type="button"
        className="mbt-select__summary"
        aria-expanded={open}
        aria-label={field.name + "：" + (chosen.length ? chosen.map((option) => option.name).join("、") : "未选择")}
        onClick={() => setOpen((on) => !on)}
      >
        {chosen.length ? (
          <span className="mb-chip-row">
            {chosen.map((option) => (
              <span key={option.id} className="mb-chip" style={optionChipStyle(option.color)}>{option.name}</span>
            ))}
          </span>
        ) : (
          <span className="mbt-select__placeholder">未选择</span>
        )}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="mb-chip-row mbt-select__options" role={multi ? "group" : "radiogroup"} aria-label={"选择 " + field.name}>
          {options.map((option) => {
            const on = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                className={"mb-chip" + (on ? " is-on" : "")}
                style={on ? undefined : optionChipStyle(option.color)}
                onClick={() => toggle(option.id)}
              >{on && <Check size={13} aria-hidden="true" />}{option.name}</button>
            );
          })}
          <button type="button" className="mb-chip mbt-select__add" onClick={() => { setOpen(false); onEditField(field.id); }}>
            <Plus size={14} />新建选项
          </button>
        </div>
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

export function MobileBitableRecordSheet({ noteId, table, fields, record, ctx, onPatch, onEditField, onDelete, onClose }: MobileBitableRecordSheetProps) {
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
                  <SelectControl field={field} value={value} onChange={(next) => onPatch(field.id, next)} onEditField={onEditField} />
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
        <button type="button" className="mb-btn mb-btn--danger-text mb-btn--block" onClick={onDelete}>删除记录</button>
      </div>
    </MobileSheet>
  );
}

export default MobileBitableRecordSheet;
