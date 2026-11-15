import { useSettingField } from "./fieldAccessibility";
import type { SelectOption } from "./Select";

/**
 * 原生下拉（A13 试点，261115 用户批准）。
 *
 * 自研 `Select` 的存在理由是「原生弹层不可控」；Chromium 135+ 的
 * `appearance: base-select` + `::picker(select)` 把弹层交回作者 CSS ⇒ 这条理由过期。
 * 调用方统一走 `AdaptiveSelect`（支持时本组件，否则同位置退回 `Select`）；261116 起接在
 * 「逐档写盘无害」或选项 ≤ 5 的设置项（备份间隔 / 检查频率 / 默认空间 / 自动同步模式 /
 * 附件上限 / 标签数）。`Select.tsx` 一行未改，降级路径失败可整段删除。
 *
 * 不支持的运行时（老 WebView / 未实现该特性的内核）⇒ 调用方按 `baseSelectSupported()`
 * 退回自研 `Select`，两条路都保持同一视觉与键盘语义。
 */
export function baseSelectSupported(): boolean {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("appearance", "base-select");
  } catch {
    return false;
  }
}

export interface NativeSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 无可见 label 时必填（读屏用） */
  label: string;
  className?: string;
  disabled?: boolean;
}

export function NativeSelect({ value, options, onChange, label, className, disabled }: NativeSelectProps) {
  const accessibility = useSettingField();
  return (
    <select
      className={"ln-select--native" + (className ? " " + className : "")}
      aria-label={label}
      value={value}
      disabled={disabled}
      {...accessibility}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}
