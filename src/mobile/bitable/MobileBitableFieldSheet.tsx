/**
 * 移动端多维表「字段」面板（261020 P0；261030 改：行内铅笔 → 打开「修改字段」面板）。
 *
 * - 行内铅笔 = 编辑该字段（名称 + 类型专属设置 + 必填 + 选项，见 MobileBitableFieldEditorSheet）；
 *   对齐钉钉「字段面板 → 铅笔 → 修改字段 → 确认」的触发与交互，设置项用桌面端已有能力。
 * - 新增类型仍只暴露移动端可编辑的 9 种；其余类型（附件/图片/关联/系统时间/AI/Markdown）不做入口。
 * - 删除带确认，并说明「所有视图里的相关配置会一并清除」；只剩一个字段时明确拒绝（core 同一判据）。
 */
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  BITABLE_FIELD_TYPE_LABEL,
  type BitableField,
  type BitableFieldType,
  type BitableTable,
} from "../../core/bitableDoc.js";
import { MOBILE_EDITABLE_FIELD_TYPES } from "./mobileBitableEdit";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { MobileSheet } from "../ui/MobileSheet";

export interface MobileBitableFieldSheetProps {
  table: BitableTable;
  fields: BitableField[];
  /** 点行内铅笔：打开「修改字段」（名称 + 类型专属设置 + 必填 + 选项）。 */
  onEdit: (field: BitableField) => void;
  onDelete: (fieldId: string) => void;
  onAdd: (type: BitableFieldType, name: string) => void;
  onClose: () => void;
}

export function MobileBitableFieldSheet({ table, fields, onEdit, onDelete, onAdd, onClose }: MobileBitableFieldSheetProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<BitableFieldType>("text");

  const askDelete = async (field: BitableField) => {
    if (fields.length <= 1) { showToast("至少保留一个字段", { type: "error" }); return; }
    const ok = await confirmMobile({
      title: "删除字段「" + field.name + "」？",
      body: "所有视图里与该字段相关的配置会一并清除，记录里的值不再展示。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) onDelete(field.id);
  };
  const commitAdd = () => {
    const name = newName.trim();
    onAdd(newType, name || BITABLE_FIELD_TYPE_LABEL[newType]);
    setAdding(false);
    setNewName("");
    setNewType("text");
  };

  // MOB-11：scrim / 右滑 / 返回栈 / 焦点 / 滚动锁统一由 MobileSheet 负责；
  // 类名与 DOM 结构沿用原手写版（.mb-sheet__title.mb-ellipsis + .mb-sheet__body，视觉不变）。
  return (
    <MobileSheet open title={"字段：" + table.name} titleClassName="mb-ellipsis" ariaLabel="字段管理" bodyClassName="mb-sheet__body--form" onClose={onClose}>
      <div className="mb-set-section">
        {fields.map((field) => (
          <div key={field.id} className="mb-set-item">
            <div className="mb-set-item__main">
              <span className="mb-set-name mb-ellipsis">{field.name}</span>
              <span className="mb-set-item__note">{BITABLE_FIELD_TYPE_LABEL[field.type as BitableFieldType] ?? field.type}</span>
            </div>
            <div className="mb-set-item__ctl">
              <button type="button" className="mb-iconbtn" aria-label={"编辑字段 " + field.name} onClick={() => onEdit(field)}><Pencil size={17} /></button>
              <button type="button" className="mb-iconbtn" aria-label={"删除字段 " + field.name} onClick={() => void askDelete(field)}><Trash2 size={17} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="mbt-field-add">
        {!adding ? (
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => setAdding(true)}>
            <Plus size={16} />添加字段
          </button>
        ) : (
          <div className="mbt-field-add__form">
            <label className="mb-input">
              <input
                autoFocus
                value={newName}
                placeholder={BITABLE_FIELD_TYPE_LABEL[newType]}
                aria-label="新字段名称"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") commitAdd(); }}
              />
            </label>
            <div className="mbt-type-grid" role="radiogroup" aria-label="字段类型">
              {MOBILE_EDITABLE_FIELD_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={newType === type}
                  className={"mb-chip" + (newType === type ? " is-on" : "")}
                  onClick={() => setNewType(type)}
                >{BITABLE_FIELD_TYPE_LABEL[type]}</button>
              ))}
            </div>
            <div className="mbt-field-add__actions">
              <button type="button" className="mb-btn mb-btn--secondary" onClick={() => { setAdding(false); setNewName(""); }}>取消</button>
              <button type="button" className="mb-btn mb-btn--primary" onClick={commitAdd}>添加</button>
            </div>
          </div>
        )}
      </div>
    </MobileSheet>
  );
}

export default MobileBitableFieldSheet;
