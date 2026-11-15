import { Select, type SelectProps } from "./Select";
import { NativeSelect, baseSelectSupported } from "./NativeSelect";

/**
 * A13 推广（261116 用户裁决「11 推广吧」→「做吧，都做」）：运行时能力探测 + 同位置降级。
 *
 * 桌面全部 13 个下拉调用点统一走这里：设置页 6（备份间隔 / 检查频率 / 默认空间 /
 * 自动同步模式 / 附件上限 / 最大同时打开标签数）+ AI 4（供应商 / 模型 / 思考强度 /
 * 思考模式）+ 正文字号 + 发布目标知识库 + 资源类型。其中字号/资源类型/供应商逐档写盘
 * 有可见副作用（预览重排、重新筛选、重置默认值），用户 261116 明确接受。
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
