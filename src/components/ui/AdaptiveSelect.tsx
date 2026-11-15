import { Select, type SelectProps } from "./Select";
import { NativeSelect, baseSelectSupported } from "./NativeSelect";

/**
 * A13 推广（261116 用户裁决「11 推广吧」）：运行时能力探测 + 同位置降级。
 *
 * 只在「逐档写盘无害」或「选项 ≤ 5」的调用方使用（备份间隔 / 检查频率 / 默认空间 /
 * 自动同步模式 / 附件上限 / 最大同时打开标签数）；字号、AI 供应商/模型等有逐档副作用
 * （预览抖动、重新请求/校验）的仍用自研 `Select`——这是调用方选择，不是这里的判据。
 *
 * 降级判据只有 `baseSelectSupported()` 一处（见 NativeSelect.tsx）；本文件不重复探测逻辑，
 * `Select.tsx` 一行未改，能力为假时在同一位置渲染自研 `Select`。
 */
export type AdaptiveSelectProps = Omit<SelectProps, "matchWidth">;

export function AdaptiveSelect({ value, options, onChange, label, className, disabled }: AdaptiveSelectProps) {
  if (!baseSelectSupported()) {
    return <Select label={label} value={value} options={options} onChange={onChange} className={className} disabled={disabled} />;
  }
  return <NativeSelect label={label} value={value} options={options} onChange={onChange} className={className} disabled={disabled} />;
}
