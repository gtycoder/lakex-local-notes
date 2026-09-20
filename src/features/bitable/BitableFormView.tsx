/**
 * 表单视图（v1，对齐语雀形态）：左侧选题（可选题目 + 新增题目）+ 中间预览 + 「填写表单」应用内录入。
 * 提交 = 在当前表新增一条记录；不做分享 / 填写规则 / 催填（用户 260919 决定）。
 */
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { bitableDisplayValue, type BitableField, type BitableTable, type BitableView } from "../../core/bitableDoc.js";
import { AttachmentCell, CellEditor, FieldTypeIcon } from "./bitableCells.js";

export interface BitableFormViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  readOnly: boolean;
  /** 字段默认值（新建记录 / 表单预填）。 */
  defaults: Record<string, unknown>;
  onUpdateView: (patch: Partial<BitableView>) => void;
  onSubmit: (values: Record<string, unknown>) => void;
  onUploadFiles: (files: File[]) => Promise<string[]>;
  onAddFieldOption: (fieldId: string, option: { id: string; name: string }) => void;
  onOpenAsset: (filename: string) => void;
}

export function BitableFormView(props: BitableFormViewProps) {
  const { table, view } = props;
  const [entryOpen, setEntryOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const includedIds = view.formFieldIds ?? table.fields.map((f) => f.id);
  const includedFields = table.fields.filter((f) => includedIds.includes(f.id));
  const availableFields = table.fields.filter((f) => !includedIds.includes(f.id));
  const toggleField = (fieldId: string) => {
    props.onUpdateView({
      formFieldIds: includedIds.includes(fieldId) ? includedIds.filter((id) => id !== fieldId) : [...includedIds, fieldId],
    });
  };
  const setDraftValue = (fieldId: string, value: unknown) => setDraft((prev) => ({ ...prev, [fieldId]: value }));
  const submit = () => {
    const missing = includedFields.filter((f) => f.required && bitableDisplayValue(f, draft[f.id]).trim() === "");
    if (missing.length > 0) {
      setError("必填项未填写：" + missing.map((f) => f.name).join("、"));
      return;
    }
    props.onSubmit(draft);
    setDraft({ ...props.defaults });
    setError(null);
    setEntryOpen(false);
  };

  return (
    <div className="bt-form-view">
      <div className="bt-form-config">
        <section className="bt-form-panel">
          <h4>表单题目</h4>
          {includedFields.map((field) => (
            <div key={field.id} className="bt-form-topic">
              <span className="bt-form-topic-name"><FieldTypeIcon type={field.type} />{field.name}</span>
              <button type="button" className="bt-icon-btn" title="从表单移除" aria-label={"移除 " + field.name} onClick={() => toggleField(field.id)}><X size={13} /></button>
            </div>
          ))}
          {includedFields.length === 0 && <div className="bt-popover-empty">尚未选择题目</div>}
        </section>
        <section className="bt-form-panel">
          <h4>可选题目</h4>
          {availableFields.map((field) => (
            <button key={field.id} type="button" className="bt-form-add" onClick={() => toggleField(field.id)}>
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
          {includedFields.map((field: BitableField) => (
            <div key={field.id} className="bt-form-preview-row">
              <span className="bt-form-preview-label">{field.name}{field.required && <em className="bt-required">*</em>}</span>
              <span className="bt-form-preview-hint">按字段类型录入</span>
            </div>
          ))}
        </div>
        <div className="bt-form-actions">
          {!entryOpen
            ? <button type="button" className="bt-primary" disabled={props.readOnly || includedFields.length === 0} onClick={() => { setDraft({ ...props.defaults }); setEntryOpen(true); setError(null); }}>填写表单</button>
            : (
              <div className="bt-form-entry">
                <h4>填写表单</h4>
                {includedFields.map((field) => (
                  <div key={field.id} className="bt-drawer-row">
                    <span className="bt-drawer-label"><FieldTypeIcon type={field.type} /><span className="bt-drawer-label-text">{field.name}</span>{field.required && <em className="bt-required">*</em>}</span>
                    <span className="bt-drawer-control">
                      <CellEditor
                        field={field}
                        value={draft[field.id]}
                        readOnly={false}
                        onChange={(value) => setDraftValue(field.id, value)}
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
                        renderAttachment={() => (
                          <AttachmentCell
                            noteId={props.noteId}
                            value={draft[field.id]}
                            readOnly={false}
                            onUpload={(files) => { void props.onUploadFiles(files).then((names) => { const current = Array.isArray(draft[field.id]) ? (draft[field.id] as string[]) : []; setDraftValue(field.id, [...current, ...names]); }); }}
                            onRemove={(filename) => { const current = Array.isArray(draft[field.id]) ? (draft[field.id] as string[]) : []; setDraftValue(field.id, current.filter((f) => f !== filename)); }}
                            onOpen={props.onOpenAsset}
                          />
                        )}
                      />
                    </span>
                  </div>
                ))}
                {error && <div className="bt-form-error" role="alert">{error}</div>}
                <div className="bt-form-entry-actions">
                  <button type="button" className="bt-secondary" onClick={() => { setEntryOpen(false); setDraft({}); setError(null); }}>取消</button>
                  <button type="button" className="bt-primary" onClick={submit}><Check size={14} />提交</button>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
