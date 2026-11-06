/**
 * 多选模式的**行复选框**（261106 task-82）：视觉 = 既有 .mb-iconbtn 的 44×44 命中盒 + lucide Check / Square。
 *
 * 两种用法：
 * · 默认 = 纯视觉件（aria-hidden），勾选语义由行本身承载（列表/卡片是 role=button）；
 * · 目录树（261106 task-8）：传 `label` 时作为 role=checkbox 暴露给读屏；
 *   传 `disabled` 表示该行不可选（笔记本/分组）——置灰但**保留缩进**，文档行与分组行左缘对齐。
 */
import { Check, Square } from "lucide-react";

export interface SelectionCheckboxProps {
  checked: boolean;
  /** 紧凑（卡内 meta 行用）：仍是 .mb-iconbtn--compact 36×36，行本身的点击区另有 44。 */
  compact?: boolean;
  /** 不可选行（笔记本/分组）：置灰、不进读屏；保留占位避免文档行标题被打乱对齐。 */
  disabled?: boolean;
  /** 可访问名：给了就按 role=checkbox 暴露；不给保持 aria-hidden（纯视觉件）。 */
  label?: string;
}

export function SelectionCheckbox({ checked, compact, disabled, label }: SelectionCheckboxProps) {
  const exposed = !!label && !disabled;
  return (
    <span
      className={"mb-iconbtn" + (compact ? " mb-iconbtn--compact" : "") + (checked ? " is-checked" : "") + (disabled ? " is-disabled" : "")}
      {...(exposed
        ? { role: "checkbox", "aria-checked": checked, "aria-label": label }
        : { "aria-hidden": "true" as const })}
      {...(disabled ? { "aria-disabled": "true" as const } : {})}
      data-selection-checkbox={disabled ? "disabled" : checked ? "on" : "off"}
    >
      {checked ? <Check size={18} /> : <Square size={18} />}
    </span>
  );
}
