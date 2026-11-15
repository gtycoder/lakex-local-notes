import { useSettingField } from "./fieldAccessibility";
import type { SelectOption } from "./Select";

/**
 * 原生下拉（A13 试点，261115 用户批准）。
 *
 * 自研 `Select` 的存在理由是「原生弹层不可控」；Chromium 135+ 的
 * `appearance: base-select` + `::picker(select)` 把弹层交回作者 CSS ⇒ 这条理由过期。
 * 调用方统一走 `AdaptiveSelect`（支持时本组件，否则同位置退回 `Select`）；261116 起桌面
 * 全部 13 个下拉调用点都接上（设置页 6 + AI 4 + 字号 + 发布目标 + 资源类型）。
 * `Select.tsx` 一行未改，降级路径失败可整段删除。
 *
 * 不支持的运行时（老 WebView / 未实现该特性的内核）⇒ 调用方按 `baseSelectSupported()`
 * 退回自研 `Select`，两条路都保持同一视觉与键盘语义。类名带 settings-select：与自研
 * Select 在 .config-item--field 里共用同一条 flex 宽度规则（否则原生 select 只有内容宽）。
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
      className={"ln-select--native settings-select" + (className ? " " + className : "")}
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
