/**
 * 表单视图：**编辑表单（原样保留） / 预览表单（新增）** 双模。
 *
 * - 「编辑表单」= v1 原形态：左侧「表单题目 / 可选题目」+ 右侧表单预览与「填写表单」录入（用户 260928 要求恢复）。
 * - 「预览表单」= 新增：直接按题目顺序渲染可填控件，填完直接提交（提交 = 当前表新增一条记录）。
 * - 默认规则（用户 260928）：`view.formFieldIds` 已配置（非空）⇒ 默认进**预览表单**；未配置 ⇒ 默认进**编辑表单**。
 * - 不做分享 / 二维码 / 云端收集（产品确认不做）。
 */
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  bitableAttachments, bitableDisplayValue, isAiFieldType, isSystemTimeField, removeBitableAttachment, renameBitableAttachment, reorderBitableAttachments,
  type BitableAttachment, type BitableDisplayContext, type BitableField, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import { AttachmentCell, CellEditor, FieldTypeIcon } from "./bitableCells.js";
import "./bitableFormView.css";

export interface BitableFormViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  readOnly: boolean;
  /** 字段默认值（新建记录 / 表单预填）。 */
  defaults: Record<string, unknown>;
  onUpdateView: (patch: Partial<BitableView>) => void;
  onSubmit: (values: Record<string, unknown>) => void;
  onUploadFiles: (files: File[]) => Promise<BitableAttachment[]>;
  onAddFieldOption: (fieldId: string, option: { id: string; name: string }) => void;
  onOpenAsset: (attachment: BitableAttachment) => void;
  /** 点图片预览：只传**本单元格内**的图片 + 下标。 */
  onOpenImages: (images: BitableAttachment[], index: number) => void;
  /** 关联解析上下文（同一文档的 tables）。 */
  ctx?: BitableDisplayContext;
}

export function BitableFormView(props: BitableFormViewProps) {
  const { table, view, readOnly } = props;
  /** 已配置（显式给过题目）= formFieldIds 非空；未配置则默认进编辑。 */
  const configured = Array.isArray(view.formFieldIds) && view.formFieldIds.length > 0;
  const [mode, setMode] = useState<"edit" | "preview">(configured ? "preview" : "edit");
  /** v1 原形态的填写草稿（已移入「预览表单」tab，不再单独弹层）。 */
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // 未配置时沿用 v1 口径：默认收入全部字段（不是"空表单"）
  /** 表单可用字段：排除系统时间字段（值来自记录时间戳）与 AI 字段（值由生成产生），表单无法录入。 */
  const formableFields = table.fields.filter((f) => !isSystemTimeField(f.type) && !isAiFieldType(f.type));
  const includedIds = view.formFieldIds ?? formableFields.map((f) => f.id);
  /** 题目顺序 = formFieldIds 顺序（契约见 BitableView.formFieldIds），不是表字段顺序。 */
  const includedFields = includedIds
    .map((id) => formableFields.find((f) => f.id === id))
    .filter((f): f is BitableField => !!f);
  const availableFields = formableFields.filter((f) => !includedIds.includes(f.id));
  const title = view.formTitle?.trim() || view.name || "表单";
  const description = view.formDescription?.trim() || "填写后将在当前数据表新增一条记录";

  const toggleField = (fieldId: string) => {
    props.onUpdateView({
      formFieldIds: includedIds.includes(fieldId) ? includedIds.filter((id) => id !== fieldId) : [...includedIds, fieldId],
    });
  };
  const setDraftValue = (fieldId: string, value: unknown) => setDraft((prev) => ({ ...prev, [fieldId]: value }));
  const submit = () => {
    const missing = includedFields.filter((f) => f.required && bitableDisplayValue(f, draft[f.id], props.ctx).trim() === "");
    if (missing.length > 0) {
      setError("必填项未填写：" + missing.map((f) => f.name).join("、"));
      setSubmitted(false);
      return;
    }
    props.onSubmit(draft);
    setDraft({ ...props.defaults });
    setError(null);
    setSubmitted(true);
  };
  /** 题目控件（预览表单与 v1 填写区共用同一渲染）。 */
  const renderControl = (field: BitableField) => (
    <CellEditor
      field={field}
      value={draft[field.id]}
      ctx={props.ctx}
      readOnly={readOnly}
      onChange={(value) => setDraftValue(field.id, value)}
      noteId={props.noteId}
      onOpenImages={props.onOpenImages}
      onAddOption={(name) => {
        const existing = (field.options ?? []).find((o) => o.name === name);
        const current = Array.isArray(draft[field.id]) ? (draft[field.id] as string[]) : [];
        if (existing) {
          setDraftValue(field.id, field.type === "multiSelect" ? (current.includes(existing.id) ? current : [...current, existing.id]) : existing.id);
          return;
        }
        const option = { id: "opt" + Math.random().toString(36).slice(2, 12), name };
        props.onAddFieldOption(field.id, option);
        setDraftValue(field.id, field.type === "multiSelect" ? [...current, option.id] : option.id);
      }}
      renderAttachment={(imageOnly) => (
        <AttachmentCell
          noteId={props.noteId}
          value={draft[field.id]}
          readOnly={readOnly}
          imageOnly={imageOnly}
          onUpload={(files) => { void props.onUploadFiles(files).then((entries) => { setDraftValue(field.id, [...bitableAttachments(draft[field.id]), ...entries]); }); }}
          onRemove={(file) => setDraftValue(field.id, removeBitableAttachment(draft[field.id], file))}
          onOpen={props.onOpenAsset}
          onOpenImages={props.onOpenImages}
          onReorder={(files) => setDraftValue(field.id, reorderBitableAttachments(draft[field.id], files))}
          onRename={(file, name) => setDraftValue(field.id, renameBitableAttachment(draft[field.id], file, name))}
        />
      )}
    />
  );

  return (
    <div className="bt-form-shell">
      <div className="bt-form-tabs">
        {/* 页签走 kit 层原语（.ln-tabs：墨线 + 可选计数徽标） */}
        <div className="ln-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="表单模式">
            <button type="button" role="tab" aria-selected={mode === "edit"}
              className={"ln-tabs__item" + (mode === "edit" ? " is-active" : "")}
              onClick={() => setMode("edit")}>编辑表单</button>
            <button type="button" role="tab" aria-selected={mode === "preview"}
              className={"ln-tabs__item" + (mode === "preview" ? " is-active" : "")}
              onClick={() => { setDraft({ ...props.defaults }); setSubmitted(false); setError(null); setMode("preview"); }}>预览表单</button>
          </div>
        </div>
      </div>
      <div className="bt-form-view">
        {mode === "edit" ? (
          <>
            <div className="bt-form-config">
              <section className="bt-form-panel">
                <h4>表单题目</h4>
                {includedFields.map((field) => (
                  <div key={field.id} className="bt-form-topic">
                    <span className="bt-form-topic-name"><FieldTypeIcon type={field.type} />{field.name}</span>
                    <button type="button" className="bt-icon-btn" title="从表单移除" aria-label={"移除 " + field.name}
                      disabled={readOnly} onClick={() => toggleField(field.id)}><X size={13} /></button>
                  </div>
                ))}
                {includedFields.length === 0 && <div className="bt-popover-empty">尚未选择题目</div>}
              </section>
              <section className="bt-form-panel">
                <h4>可选题目</h4>
                {availableFields.map((field) => (
                  <button key={field.id} type="button" className="bt-form-add" disabled={readOnly} onClick={() => toggleField(field.id)}>
                    <Plus size={13} /><span>{field.name}</span>
                  </button>
                ))}
                {availableFields.length === 0 && <div className="bt-popover-empty">全部字段已加入表单</div>}
              </section>
            </div>
            <div className="bt-form-canvas">
              <div className="bt-form-preview">
                <h3>{view.name || "表单"}</h3>
                <p className="bt-form-desc">填写后将在当前数据表新增一条记录</p>
                {includedFields.map((field) => (
                  <div key={field.id} className="bt-form-preview-row">
                    <span className="bt-form-preview-label">{field.name}{field.required && <em className="bt-required">*</em>}</span>
                    <span className="bt-form-preview-hint">按字段类型录入</span>
                  </div>
                ))}
              </div>
              <div className="bt-form-actions">
                {/* 用户 260928：点「填写表单」直接跳到预览表单页面，不再做独立录入弹层 */}
                <button type="button" className="bt-primary" disabled={readOnly || includedFields.length === 0}
                  onClick={() => { setDraft({ ...props.defaults }); setError(null); setSubmitted(false); setMode("preview"); }}>填写表单</button>
              </div>
            </div>
          </>
        ) : (
          <div className="bt-form-canvas is-preview">
            <div className="bt-form-preview">
              <h3>{title}</h3>
              <p className="bt-form-desc">{description}</p>
              {includedFields.map((field) => (
                <div key={field.id} className="bt-form-field">
                  <span className="bt-form-field-label">{field.name}{field.required && <em className="bt-required">*</em>}</span>
                  <div className="bt-form-field-control">{renderControl(field)}</div>
                </div>
              ))}
              {includedFields.length === 0 && <div className="bt-popover-empty">表单还没有题目，先去「编辑表单」添加。</div>}
              {error && <div className="bt-form-error" role="alert">{error}</div>}
            </div>
            <div className="bt-form-actions">
              {submitted && <span className="bt-form-ok" role="status"><Check size={14} />已提交，新增了一条记录</span>}
              <button type="button" className="bt-primary" disabled={readOnly || includedFields.length === 0} onClick={submit}>提交</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
