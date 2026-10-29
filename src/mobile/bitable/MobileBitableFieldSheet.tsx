/**
 * 移动端多维表「字段」面板（261020 P0）：重命名 / 删除 / 新增基础字段。
 *
 * - 新增类型只暴露移动端 P0 可编辑的 9 种（文本/数字/日期/单选/多选/复选框/链接/评分/进度）；
 *   其余类型（附件/图片/关联/系统时间/AI/Markdown）不做入口 —— 不做「建得出来但改不了」的字段。
 * - 删除带确认，并说明「所有视图里的相关配置会一并清除」；只剩一个字段时明确拒绝（core 同一判据）。
 * - 命名缺省用类型名；重命名联动改写同表 AI 命令变量（core `renameBitableField`）。
 */
import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
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
  onRename: (fieldId: string, name: string) => void;
  onDelete: (fieldId: string) => void;
  onAdd: (type: BitableFieldType, name: string) => void;
  onClose: () => void;
}

export function MobileBitableFieldSheet({ table, fields, onRename, onDelete, onAdd, onClose }: MobileBitableFieldSheetProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<BitableFieldType>("text");

  const startRename = (field: BitableField) => { setRenamingId(field.id); setRenameValue(field.name); };
  const commitRename = () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    onRename(renamingId, name);
  };
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
    <MobileSheet open title={"字段：" + table.name} titleClassName="mb-ellipsis" ariaLabel="字段管理" onClose={onClose}>
      <div className="mb-set-section">
        {fields.map((field) => (
          <div key={field.id} className="mb-set-item">
            <div className="mb-set-item__main">
              {renamingId === field.id ? (
                <span className="mb-input">
                  <input
                    autoFocus
                    value={renameValue}
                    aria-label="字段名称"
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") setRenamingId(null); }}
                  />
                </span>
              ) : (
                <span className="mb-set-name mb-ellipsis">{field.name}</span>
              )}
              <span className="mb-set-item__note">{BITABLE_FIELD_TYPE_LABEL[field.type as BitableFieldType] ?? field.type}</span>
            </div>
            <div className="mb-set-item__ctl">
              {renamingId === field.id ? (
                <button type="button" className="mb-iconbtn" aria-label="保存字段名称" onClick={commitRename}><Check size={18} /></button>
              ) : (
                <button type="button" className="mb-iconbtn" aria-label={"重命名字段 " + field.name} onClick={() => startRename(field)}><Pencil size={17} /></button>
              )}
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
                  className={"mbt-option" + (newType === type ? " is-on" : "")}
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
