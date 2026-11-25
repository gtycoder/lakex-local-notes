/**
 * 移动端多维表「表单（填写）」视图（261030 P0）。
 *
 * 口径（用户 261030）：
 * - 这是只读文档里**唯一的写入面**：填完提交 = 当前表新增一条记录（不改既有数据）；
 * - 题目顺序 / 必填 / 描述全部来自视图配置（`formFieldIds` / `formDescriptions` / 字段 required）；
 * - 提交失败（落盘失败）保留草稿并提示，不静默丢弃；
 * - 填写草稿落设备本地（261118 P1-5，`mobileBitableFormDraft`）：打开回填、提交成功清空、
 *   题目集合/类型变化弃用（宁可丢草稿不给错值），不进正文、不进 S3；
 * - 附件/图片字段可上传（261030 P1，与记录面板共用 MobileBitableAttachmentEditor；映射见 mobileBitableAttachments.ts）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardRevealFocus } from "../hooks/useKeyboardStableSheet";
import { CalendarDays, FileText, Hash, ListChecks, Link2, Paperclip, Star, ToggleLeft } from "lucide-react";
import {
  BITABLE_RATING_MAX,
  type BitableDisplayContext,
  type BitableField,
  type BitableTable,
  type BitableView,
} from "../../core/bitableDoc.js";
import { progressValue, ratingValue, textInputValue } from "./mobileBitableEdit";
import { BitableSelectControl } from "./BitableSelectControl";
import { bitableFormDraftDefaults, bitableFormFields, formableBitableFields, missingRequiredBitableFields } from "../../core/bitableForm";
import {
  clearMobileFormDraft,
  mobileFormDraftKey,
  mobileFormDraftSignature,
  readMobileFormDraft,
  writeMobileFormDraft,
} from "./mobileBitableFormDraft";
import { MobileBitableAttachmentEditor } from "./MobileBitableAttachmentEditor";
import { MobileBitableDateField } from "./MobileBitableDateField";
import { dismissKeyboard } from "../ui/dismissKeyboard";
import { onBitablePointerDown } from "./bitablePointerFocus";
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
  const fields = useMemo(() => bitableFormFields(table, view), [table, view]);
  const defaults = useMemo(() => bitableFormDraftDefaults(table), [table]);
  // 261118 P1-5 草稿保护：恢复是**同步**发生在 useState 初始化 —— 不进 effect、不 focus()，
  // 键盘/焦点稳定（不抢焦点）；恢复值盖在默认值上（表默认值不丢）。
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const restored = readMobileFormDraft(noteId, view.id, fields);
    return restored ? { ...defaults, ...restored } : { ...defaults };
  });
  const draftRef = useRef(draft);
  const replaceDraft = (next: Record<string, unknown>) => {
    draftRef.current = next;
    setDraft(next);
  };
  // 恢复/丢弃单元 = 存储 key（noteId + viewId）+ 题目指纹（id:type 有序）：
  // 同一 key 但指纹变了 ⇒ 弃用旧草稿；换了 key（同一挂载实例切到别的表单）⇒ 按新 key 重新回填、互不串。
  const draftSignature = useMemo(() => mobileFormDraftSignature(fields), [fields]);
  const draftStorageKey = mobileFormDraftKey(noteId, view.id);
  const hydratedRef = useRef({ key: draftStorageKey, signature: draftSignature });
  useEffect(() => {
    const last = hydratedRef.current;
    if (last.key === draftStorageKey && last.signature === draftSignature) return;
    const switched = last.key !== draftStorageKey;
    hydratedRef.current = { key: draftStorageKey, signature: draftSignature };
    if (!switched) {
      clearMobileFormDraft(noteId, view.id);
      replaceDraft({ ...defaults });
      return;
    }
    const restored = readMobileFormDraft(noteId, view.id, fields);
    replaceDraft(restored ? { ...defaults, ...restored } : { ...defaults });
    // 只在 key/指纹变化时动作；defaults/fields 取当轮值即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey, draftSignature]);
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


  const setValue = (fieldId: string, value: unknown) => {
    const next = { ...draftRef.current, [fieldId]: value };
    replaceDraft(next);
    // 用户改动即落设备本地（切走/刷新/杀进程可恢复）；提交成功才删。
    writeMobileFormDraft(noteId, view.id, fields, next);
  };

  const submit = async () => {
    dismissKeyboard();
    if (busy) return;
    const missing = missingRequiredBitableFields(fields, draft, ctx);
    if (missing.length > 0) {
      setError("必填项未填写：" + missing.map((field) => field.name).join("、"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(draft);
      if (!ok) { setError("提交失败，请重试"); return; }
      replaceDraft({ ...defaults });
      clearMobileFormDraft(noteId, view.id); // 提交成功 = 草稿已成记录，删草稿
      setSubmitted((count) => count + 1);
      showToast("已提交，记录已加入收集表");
    } finally {
      setBusy(false);
    }
  };

  const renderControl = (field: BitableField) => {
    const value = draft[field.id];
    if (field.type === "select" || field.type === "multiSelect") {
      if ((field.options ?? []).length === 0) return <span className="mbt-field-note">这个字段还没有选项</span>;
      // 261117 推广：与记录面板同一「项移动」选择器（单一来源 BitableSelectControl）；
      // 表单填写场景不传 onEditField ⇒ 不提供「新建选项」（填写态不改字段）。
      return <BitableSelectControl field={field} value={value} onChange={(next) => setValue(field.id, next)} />;
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

  // 261117：键盘弹起后把焦点输入框滚进可见区（原生 focus 滚动发生在键盘弹起前、之后失效）。
  const formRef = useRef<HTMLDivElement | null>(null);
  useKeyboardRevealFocus(formRef, true);

  /**
   * 261119 用户点单（录屏 form_005/011）：文本框失焦后拖「进度」滑杆，键盘每次都被拉回文本框、光标还在里面。
   * 根因 = 共享 dismissKeyboardOnPointerDown 对任何 input 落点都放行 ⇒ 滑杆/复选框**不会**让文本框真失焦。
   * 收紧口径 = bitablePointerFocus.onBitablePointerDown（只在文本输入控件落点放行聚焦；表单里没有任何
   * .focus() 回弹路径，不要新增）。
   */
  return (
    <div className="mbt-form" ref={formRef} onPointerDown={onBitablePointerDown}>
      <div className="mbt-form-scroll">
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
