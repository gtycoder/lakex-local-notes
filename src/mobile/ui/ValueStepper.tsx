/**
 * 移动端「离散档位」步进器（261104）：− 值 + 一行；字号、行高共用。
 *
 * 为什么通用：字号（px 数值档）与行高（1/1.15/1.5/默认/2/2.5/3，含字符串档）语义同类，
 * 几何/交互/无障碍必须一套（AGENTS §3#14）。表格 T 面板的 FontSizeStepper 是同一交互的首个落点，
 * 这里抽成通用件后字号/行高都复用它；**不要再各写一份**。
 *
 * 纯函数（nearestIndex / currentIndex / stepValue）单独导出，便于单测（含字符串档与默认档）。
 */
import { Minus, Plus } from "lucide-react";

export type StepperValue = number | string;

/** 值与预期不符时，取「最近的可用档」：数值取最近，字符串必须精确匹配（否则回退到 fallbackIndex）。 */
export function nearestIndex(values: readonly StepperValue[], value: StepperValue | null, fallbackIndex = 0): number {
  if (value === null || value === "") return Math.min(fallbackIndex, Math.max(0, values.length - 1));
  const exact = values.indexOf(value);
  if (exact >= 0) return exact;
  if (typeof value === "number") {
    let best = Math.min(fallbackIndex, Math.max(0, values.length - 1));
    let bestDelta = Number.POSITIVE_INFINITY;
    values.forEach((candidate, index) => {
      if (typeof candidate !== "number") return;
      const delta = Math.abs(candidate - value);
      if (delta < bestDelta) { bestDelta = delta; best = index; }
    });
    return best;
  }
  return Math.min(fallbackIndex, Math.max(0, values.length - 1));
}

/** 当前显示值：表格/文档会给出 null（默认）或真实值；空列表兜底 null。 */
export function currentValue(values: readonly StepperValue[], value: StepperValue | null, fallbackIndex = 0): StepperValue | null {
  if (values.length === 0) return null;
  return values[nearestIndex(values, value, fallbackIndex)] ?? null;
}

/** 相邻档步进（首尾不越界；调用方据此置灰按钮）。 */
export function stepValue(values: readonly StepperValue[], value: StepperValue | null, direction: 1 | -1, fallbackIndex = 0): StepperValue | null {
  if (values.length === 0) return null;
  const index = nearestIndex(values, value, fallbackIndex);
  const next = Math.min(values.length - 1, Math.max(0, index + direction));
  return values[next] ?? null;
}

export interface ValueStepperProps {
  /** 行内小标签（字号 / 行高）；空串 = 不显示。 */
  label: string;
  /** null = 未知/默认（按 fallbackIndex 显示）。 */
  value: StepperValue | null;
  values: readonly StepperValue[];
  /** 显示格式（按「当前原始值」渲染；行高的「默认」档转中文，字号保留粘贴来的非档位值）。 */
  display?: (value: StepperValue | null) => string;
  /** null/空值时的显示档位（默认取 0）。 */
  fallbackIndex?: number;
  onPick: (value: StepperValue) => void;
  /** 无障碍名（如「字号」「行高」）。 */
  ariaLabel: string;
}

export function ValueStepper({ label, value, values, display, fallbackIndex = 0, onPick, ariaLabel }: ValueStepperProps) {
  const current = currentValue(values, value, fallbackIndex);
  if (current === null) return null;
  const index = nearestIndex(values, value, fallbackIndex);
  const prev = values[index - 1];
  const next = values[index + 1];
  const text = display ? display(value) : String(current);
  return (
    <div className="med-f-step" role="group" aria-label={ariaLabel}>
      {label ? <span className="med-f-step__label">{label}</span> : null}
      <button type="button" className="med-f-btn med-f-step__btn" aria-label={"减小" + ariaLabel} title={"减小" + ariaLabel} disabled={prev === undefined} onClick={() => prev !== undefined && onPick(prev)}>
        <Minus size={18} />
      </button>
      <span className="med-f-step__value" aria-label={"当前" + ariaLabel}>{text}</span>
      <button type="button" className="med-f-btn med-f-step__btn" aria-label={"增大" + ariaLabel} title={"增大" + ariaLabel} disabled={next === undefined} onClick={() => next !== undefined && onPick(next)}>
        <Plus size={18} />
      </button>
    </div>
  );
}