/**
 * 移动端「行高」步进器（261104）：与字号共用 ValueStepper，同一行显示。
 *
 * 档位 = 内核 lineHeight 命令的取值域 + 「默认」：bundle 预设 [1, 1.15, 1.5, default, 2, 2.5, 3]。
 * 实测（261104 设备）：queryCommandValue("lineHeight") 默认返回 null、设置后返回数字；
 * 「默认」= 不传参调用命令（execCommand("lineHeight") 实测可清除 ne-line-height；传 "default" 会抛错）。
 * 因此 onPick 拿到 "default" 时，调用方要执行**无参** lineHeight 命令。
 */
import { ValueStepper, type StepperValue } from "./ValueStepper";

export type LineHeightValue = number | "default";

/** 与内核工具栏下拉同序（默认档在中间，便于从默认向上/向下各走两档）。 */
export const LINE_HEIGHT_STEPS: readonly LineHeightValue[] = [1, 1.15, 1.5, "default", 2, 2.5, 3];

/** 默认档在档位表里的下标（无值时按它显示「默认」）。 */
export const LINE_HEIGHT_DEFAULT_INDEX = LINE_HEIGHT_STEPS.indexOf("default");

export interface LineHeightStepperProps {
  /** 当前行高；null/空串 = 内核默认（未设置）。 */
  value: LineHeightValue | null;
  onPick: (value: LineHeightValue) => void;
}

export function LineHeightStepper({ value, onPick }: LineHeightStepperProps) {
  return (
    <ValueStepper
      label="行高"
      ariaLabel="行高"
      value={value}
      values={LINE_HEIGHT_STEPS as readonly StepperValue[]}
      fallbackIndex={LINE_HEIGHT_DEFAULT_INDEX}
      display={(raw) => (raw === "default" || raw === null ? "默认" : String(raw))}
      onPick={(next) => onPick(next as LineHeightValue)}
    />
  );
}