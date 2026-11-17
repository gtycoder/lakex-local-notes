/**
 * 单选/多选字段控件（**单一来源**，261117 二稿「项移动」模型）：记录面板与表单视图共用。
 *
 * · 默认折叠：行内只显示已选值；左对齐、宽度拉满；
 * · **选中的项移动到上方已选区、候选区只留未选中**（同一选项不重复出现）——
 *   点候选 = 移上来（单选取代、多选追加）；点已选项 = 取消移回下方；
 * · 点行空白/箭头 = 展开收起候选区（选择过程保持展开，移动看得见）；
 * · 「新建选项」= 跳字段编辑器（回车流转批量录选项）——只在编辑态传 onEditField 时显示；
 *   表单填写场景不传 ⇒ 不提供改字段。
 */
import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { optionChipStyle, type BitableField } from "../../core/bitableDoc.js";
import { selectedOptionIds } from "./mobileBitableEdit";

export interface BitableSelectControlProps {
  field: BitableField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** 新建选项 = 打开字段编辑器；不传 = 不显示「新建选项」（表单填写场景不改字段）。 */
  onEditField?: (fieldId: string) => void;
}

export function BitableSelectControl({ field, value, onChange, onEditField }: BitableSelectControlProps) {
  const multi = field.type === "multiSelect";
  const selected = selectedOptionIds(value);
  const [open, setOpen] = useState(false);
  const options = field.options ?? [];
  const chosen = options.filter((option) => selected.includes(option.id));
  const candidates = options.filter((option) => !selected.includes(option.id));
  const pick = (optionId: string): void => {
    onChange(multi ? [...selected, optionId] : optionId); // 单选取代（旧项移回下方）、多选追加
  };
  const unpick = (optionId: string): void => {
    onChange(multi ? selected.filter((id) => id !== optionId) : "");
  };
  return (
    <div className="mbt-select">
      {/* 已选区：点已选项 = 取消（移回下方）；点行空白/箭头 = 展开收起候选。 */}
      <div
        className="mbt-select__chosen"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((on) => !on); }
        }}
      >
        {chosen.length ? chosen.map((option) => (
          <button
            key={option.id}
            type="button"
            className="mb-chip"
            style={optionChipStyle(option.color)}
            aria-label={"取消 " + option.name}
            onClick={(event) => { event.stopPropagation(); unpick(option.id); }}
          ><Check size={13} aria-hidden="true" />{option.name}</button>
        )) : (
          <span className="mbt-select__placeholder">未选择</span>
        )}
        <button
          type="button"
          className="mbt-select__toggle mb-tap"
          aria-expanded={open}
          aria-label={(open ? "收起 " : "展开 ") + field.name + " 选项"}
          onClick={(event) => { event.stopPropagation(); setOpen((on) => !on); }}
        >{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
      {open && (
        <div className="mb-chip-row mbt-select__options" role={multi ? "group" : "radiogroup"} aria-label={"选择 " + field.name}>
          {candidates.map((option) => (
            <button
              key={option.id}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={false}
              className="mb-chip"
              style={optionChipStyle(option.color)}
              onClick={() => pick(option.id)}
            >{option.name}</button>
          ))}
          {onEditField && (
            <button type="button" className="mb-chip mbt-select__add" onClick={() => { setOpen(false); onEditField(field.id); }}>
              <Plus size={14} />新建选项
            </button>
          )}
        </div>
      )}
    </div>
  );
}
