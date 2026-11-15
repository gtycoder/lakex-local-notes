import { useSettingField } from "./fieldAccessibility";
import type { SelectOption } from "./Select";

/**
 * 原生下拉（A13 试点，261115 用户批准）。
 *
 * 自研 `Select` 的存在理由是「原生弹层不可控」；Chromium 135+ 的
 * `appearance: base-select` + `::picker(select)` 把弹层交回作者 CSS ⇒ 这条理由过期。
 * 试点范围只有设置页「备份间隔」一处（2 个选项）；`Select.tsx` 一行未改，试点失败可整段删除。
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
