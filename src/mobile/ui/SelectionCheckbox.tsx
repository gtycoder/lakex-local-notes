/**
 * 多选模式的**行复选框**（261106 task-82）：视觉 = 既有 .mb-iconbtn 的 44×44 命中盒 + lucide Check / Square。
 * 只做视觉；真正的勾选语义由行本身（role=button + aria-pressed）承载，所以这里 aria-hidden。
 */
import { Check, Square } from "lucide-react";

export interface SelectionCheckboxProps {
  checked: boolean;
  /** 紧凑（卡内 meta 行用）：仍是 .mb-iconbtn--compact 36×36，行本身的点击区另有 44。 */
  compact?: boolean;
}

export function SelectionCheckbox({ checked, compact }: SelectionCheckboxProps) {
  return (
    <span
      className={"mb-iconbtn" + (compact ? " mb-iconbtn--compact" : "") + (checked ? " is-checked" : "")}
      aria-hidden="true"
      data-selection-checkbox={checked ? "on" : "off"}
    >
      {checked ? <Check size={18} /> : <Square size={18} />}
    </span>
  );
}
