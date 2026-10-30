/**
 * 移动端多维表「表单（填写）」视图（261030 P0）。
 *
 * 口径（用户 261030）：
 * - 这是只读文档里**唯一的写入面**：填完提交 = 当前表新增一条记录（不改既有数据）；
 * - 题目顺序 / 必填 / 描述全部来自视图配置（`formFieldIds` / `formDescriptions` / 字段 required）；
 * - 提交失败（落盘失败）保留草稿并提示，不静默丢弃；
 * - 附件/图片字段可上传（261030 P1，与记录面板共用 MobileBitableAttachmentEditor；映射见 mobileBitableAttachments.ts）。
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText, Hash, ListChecks, Link2, Paperclip, Star, ToggleLeft } from "lucide-react";
import {
  BITABLE_RATING_MAX,
  optionChipStyle,
  type BitableDisplayContext,
  type BitableField,
  type BitableTable,
  type BitableView,
} from "../../core/bitableDoc.js";
import { progressValue, ratingValue, selectedOptionIds, textInputValue } from "./mobileBitableEdit";
import { formDraftDefaults, formFieldsFor, formMissingFields, formableFields as formableBitableFields } from "./mobileBitableForm";
import { MobileBitableAttachmentEditor } from "./MobileBitableAttachmentEditor";
import { MobileBitableDateField } from "./MobileBitableDateField";
import { dismissKeyboard, dismissKeyboardOnPointerDown } from "../ui/dismissKeyboard";
import { submitStateText } from "./mobileBitableFormat";
import { bridge } from "../bridge";
import { showToast } from "../ui/toastBus";
import type { CloudState } from "../../core/cloudState.js";

export interface MobileBitableFormViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  ctx: BitableDisplayContext;
  /** 提交：父级负责写 doc + 落盘；返回 false = 失败（草稿保留） */
  onSubmit: (draft: Record<string, unknown>) => Promise<boolean>;
  /** 文档编辑态 + 父级可写视图配置时给；缺省 = 不提供表单编辑（只读文档不能改题目）。 */
  editable?: boolean;
  onUpdateView?: (patch: Partial<BitableView>) => void;
}

function fieldIcon(field: BitableField) {
  switch (field.type) {
    case "select": case "multiSelect": return <ListChecks size={14} />;
    case "date": return <CalendarDays size={14} />;
    case "number": case "progress": case "rating": return field.type === "rating" ? <Star size={14} /> : <Hash size={14} />;
    case "link": return <Link2 size={14} />;
    case "attachment": case "image": return <Paperclip size={14} />;
    case "boolean": return <ToggleLeft size={14} />;
    default: return <FileText size={14} />;
  }
}

export function MobileBitableFormView({ noteId, table, view, ctx, onSubmit, editable = false, onUpdateView }: MobileBitableFormViewProps) {
  const fields = useMemo(() => formFieldsFor(table, view), [table, view]);
  const defaults = useMemo(() => formDraftDefaults(table), [table]);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...defaults }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  /** 表单编辑态（261030 P2）：只在文档编辑态可用；改的是**视图配置**（标题/说明/题目），不是记录。 */
  const [formEditing, setFormEditing] = useState(false);
  const canEditForm = editable && !!onUpdateView;
  const formable = useMemo(() => formableBitableFields(table), [table]);
  const includedIds = useMemo(
    () => view.formFieldIds ?? formable.map((field) => field.id),
    [view.formFieldIds, formable],
  );
  const toggleFieldInForm = (fieldId: string) => {
    if (!onUpdateView) return;
    onUpdateView({
      formFieldIds: includedIds.includes(fieldId)
        ? includedIds.filter((id) => id !== fieldId)
        : [...includedIds, fieldId],
    });
  };
  /** 云同步状态（只用于提交后的说明文案；取不到就回落中性文案，不影响提交）。 */
  const [cloudState, setCloudState] = useState<CloudState | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge.getCloudState().then((state) => { if (alive) setCloudState(state); }).catch(() => {});
    return () => { alive = false; };
  }, []);


  const setValue = (fieldId: string, value: unknown) => setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const submit = async () => {
    dismissKeyboard();
    if (busy) return;
    const missing = formMissingFields(fields, draft, ctx);
    if (missing.length > 0) {
      setError("必填项未填写：" + missing.map((field) => field.name).join("、"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(draft);
      if (!ok) { setError("提交失败，请重试"); return; }
      setDraft({ ...defaults });
      setSubmitted((count) => count + 1);
      showToast("已提交，记录已加入收集表");
    } finally {
      setBusy(false);
    }
  };

  const renderControl = (field: BitableField) => {
    const value = draft[field.id];
    if (field.type === "select" || field.type === "multiSelect") {
      const options = field.options ?? [];
      const selected = selectedOptionIds(value);
      const multi = field.type === "multiSelect";
      if (options.length === 0) return <span className="mbt-field-note">这个字段还没有选项</span>;
      return (
        <div className="mbt-form-chips" role={multi ? "group" : "radiogroup"} aria-label={field.name}>
          {options.map((option) => {
            const on = selected.includes(option.id);
            return (
              <button key={option.id} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on}
                className={"mbt-form-chip" + (on ? " is-on" : "")} style={on ? optionChipStyle(option.color) : undefined}
                onClick={() => {
                  if (multi) setValue(field.id, on ? selected.filter((id) => id !== option.id) : [...selected, option.id]);
                  else setValue(field.id, on ? "" : option.id);
                }}>{option.name}</button>
            );
          })}
        </div>
      );
    }
    if (field.type === "boolean") {
      const on = value === true;
      return (
        <button type="button" className="mb-switch" role="switch" aria-checked={on} aria-label={field.name}
          onClick={() => setValue(field.id, !on)}><span className="mb-switch__knob" /></button>
      );
    }
    if (field.type === "date") {
      return <MobileBitableDateField value={value} ariaLabel={field.name} onChange={(next) => setValue(field.id, next)} />;
    }
    if (field.type === "number") {
      return (
        <input className="mbt-form-input" inputMode="decimal" value={textInputValue(value)} aria-label={field.name}
          onChange={(event) => setValue(field.id, event.target.value.replace(/[^0-9.\-]/g, ""))} />
      );
    }
    if (field.type === "link") {
      return (
        <input className="mbt-form-input" inputMode="url" autoComplete="off" placeholder="https://"
          value={textInputValue(value)} aria-label={field.name}
          onChange={(event) => setValue(field.id, event.target.value)} />
      );
    }
    if (field.type === "rating") {
      const current = ratingValue(value);
      return (
        <span className="mbt-form-stars" role="radiogroup" aria-label={field.name}>
          {Array.from({ length: BITABLE_RATING_MAX }, (_, index) => {
            const stars = index + 1;
            return (
              <button key={stars} type="button" role="radio" aria-checked={stars === current} aria-label={stars + " 星"}
                className={"mbt-star mbt-rating-btn" + (index < current ? " is-on" : "")}
                onClick={() => setValue(field.id, current === stars ? 0 : stars)}>★</button>
            );
          })}
        </span>
      );
    }
    if (field.type === "progress") {
      const pct = progressValue(value);
      return (
        <span className="mbt-form-progress">
          <input type="range" min={0} max={100} step={1} value={pct} aria-label={field.name}
            onChange={(event) => setValue(field.id, Number(event.target.value))} />
          <span className="mbt-form-progress__value">{pct}%</span>
        </span>
      );
    }
    if (field.type === "attachment" || field.type === "image") {
      return (
        <MobileBitableAttachmentEditor noteId={noteId} field={field} value={value}
          onChange={(next) => setValue(field.id, next)} />
      );
    }
    // text / markdown 等：一律多行输入（触屏上长文本单行不好用）
    return (
      <textarea className="mbt-form-textarea" rows={3} value={textInputValue(value)} aria-label={field.name}
        placeholder="填写内容" onChange={(event) => setValue(field.id, event.target.value)} />
    );
  };

  return (
    <div className="mbt-form">
      <div className="mbt-form-scroll" onPointerDown={dismissKeyboardOnPointerDown}>
        {canEditForm && (
          <div className="mbt-form-edittoggle">
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => setFormEditing((on) => !on)}>
              {formEditing ? "返回填写" : "编辑表单"}
            </button>
          </div>
        )}
        {formEditing ? (
          <div className="mbt-form-editor">
            <div className="mbt-form-editor__list">
              <div className="mbt-form-editor__label">题目（勾选 = 进表单，顺序 = 表字段顺序）</div>
              {formable.map((field) => {
                const on = includedIds.includes(field.id);
                return (
                  <label key={field.id} className="mbt-form-editor__row">
                    <input type="checkbox" checked={on} onChange={() => toggleFieldInForm(field.id)} aria-label={"题目 " + field.name} />
                    <span>{field.name}</span>
                    {field.required && <span className="mbt-field-req">*</span>}
                  </label>
                );
              })}
              {formable.length === 0 && <div className="mbt-form-editor__empty">没有可加入表单的字段。</div>}
            </div>
          </div>
        ) : (
        <>
        <div className="mbt-form-fields">
            {fields.map((field, index) => {
              const description = view.formDescriptions?.[field.id]?.trim();
              return (
                <div key={field.id} className="mbt-field">
                  <div className="mbt-field-head">
                    <span className="mbt-field-no">{String(index + 1).padStart(2, "0")}</span>
                    <span className="mbt-field-icon" aria-hidden="true">{fieldIcon(field)}</span>
                    <span className="mbt-field-name">{field.name}</span>
                    {field.required && <span className="mbt-field-req" aria-label="必填">*</span>}
                  </div>
                  {description && <div className="mbt-field-desc">{description}</div>}
                  <div className="mbt-field-control">{renderControl(field)}</div>
                </div>
              );
            })}
            {fields.length === 0 && <div className="mbt-form-empty">这个表单还没有可填写的字段。</div>}
          </div>
          {error && <div className="mbt-form-error" role="alert">{error}</div>}
        </>
        )}
      </div>
      {!formEditing && <div className="mbt-form-submit">
        <div className="mbt-form-meta">
          <span>已提交 {submitted} 条</span>
          <span className="mbt-form-meta__hint">{submitStateText(cloudState)}</span>
        </div>
        <button type="button" className="mb-btn mb-btn--primary mb-btn--block" disabled={busy} onClick={() => void submit()}>
          {busy ? "提交中…" : "提交"}
        </button>
      </div>}
    </div>
  );
}

export default MobileBitableFormView;
