/**
 * 移动端共用「字号」步进器：− 当前 +
 *
 * 261104 用户批准：文档编辑 dock 的字号从「Aa」面板最底部一行 8 钮改成这个步进器、搬进「更多」面板
 * （与行高同组）——起因是 Aa 面板内容 354px > 可视 312px，被裁掉的正好是字号行（点按落空）。
 * 几何与交互抄表格 T 面板的 FontSizeStepper（usheet/SheetDockPanel.tsx）：−/+ 18px 图标、
 * 40px 高（.med-f-btn）、132px 宽（.med-fsize）、当前值 tabular-nums、首尾档 disabled。
 * ⚠️ 只抄几何，**不 import usheet 模块**：表格与文档两套 UI 层互不依赖。
 *
 * 档位算术全在下面的纯函数里（单测 fontSizeStepper.test.ts），组件只负责渲染。
 */
import { ValueStepper, nearestIndex } from "./ValueStepper";

/** 无值时的默认字号（= 内核默认正文字号）。 */
export const FONT_SIZE_FALLBACK = 16;

/** 步进器的呈现状态（纯数据，便于单测）。 */
export interface FontStepState {
  /** 显示用当前值：空值 → 默认 16 的最近档；低于首档/高于末档 → 首档/末档；档位之间的值原样显示。 */
  current: number;
  /** − 的目标档（严格小于 current 的最近档；已在首档时 = current）。 */
  prev: number;
  /** + 的目标档（严格大于 current 的最近档；已在末档时 = current）。 */
  next: number;
  /** 已在首档 ⇒ − 置灰。 */
  atMin: boolean;
  /** 已在末档 ⇒ + 置灰。 */
  atMax: boolean;
}

/** 距 target 最近的档位（等距取较大档）；档位表为空时返回 target 本身。 */
export function nearestFontSize(target: number, sizes: readonly number[]): number {
  if (sizes.length === 0) return target;
  let best = sizes[0];
  let bestDistance = Math.abs(target - best);
  for (const size of sizes) {
    const distance = Math.abs(target - size);
    if (distance < bestDistance || (distance === bestDistance && size > best)) {
      best = size;
      bestDistance = distance;
    }
  }
  return best;
}

/** 显示用当前字号：空值/非法值 → 默认 16 的最近档；越界 → 首档/末档；其余原样（保留粘贴来的非档位值）。 */
export function currentFontSize(value: number | null | undefined, sizes: readonly number[]): number {
  if (sizes.length === 0) return FONT_SIZE_FALLBACK;
  const first = sizes[0];
  const last = sizes[sizes.length - 1];
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return nearestFontSize(FONT_SIZE_FALLBACK, sizes);
  }
  if (value < first) return first;
  if (value > last) return last;
  return value;
}

/** 步进状态：current + 相邻档 + 首尾禁用（± 只落在**档位表**上；非档位的当前值取严格相邻档）。 */
export function fontStepState(value: number | null | undefined, sizes: readonly number[]): FontStepState {
  const current = currentFontSize(value, sizes);
  if (sizes.length === 0) return { current, prev: current, next: current, atMin: true, atMax: true };
  let prev = current;
  let atMin = true;
  for (let i = sizes.length - 1; i >= 0; i--) {
    if (sizes[i] < current) { prev = sizes[i]; atMin = false; break; }
  }
  let next = current;
  let atMax = true;
  for (const size of sizes) {
    if (size > current) { next = size; atMax = false; break; }
  }
  return { current, prev, next, atMin, atMax };
}

/** 按方向取相邻档（-1 = 减小 / +1 = 增大）；已在边界时返回当前档（调用方另行置灰）。 */
export function stepFontSize(value: number | null | undefined, sizes: readonly number[], direction: -1 | 1): number {
  const state = fontStepState(value, sizes);
  return direction < 0 ? state.prev : state.next;
}

export interface FontSizeStepperProps {
  /** 当前字号（px）；null = 选区无字号（正文默认）。 */
  value: number | null;
  /** 可步进的档位（升序；移动端文档 = 内核 12 档掐头去尾的中间 8 档）。 */
  sizes: readonly number[];
  /** 选定某一档（px）。 */
  onPick: (px: number) => void;
}

/** − 当前 + 步进器（几何/交互与表格 T 面板同款；样式在 editor-dock.css 的 .med-f-step*）。
 *  261104 二次收口：与行高共用通用件 ValueStepper（同一交互语义一套几何），这里只绑定字号档位与格式。 */
export function FontSizeStepper({ value, sizes, onPick }: FontSizeStepperProps) {
  return (
    <ValueStepper
      label="字号"
      ariaLabel="字号"
      value={value}
      values={sizes}
      fallbackIndex={nearestIndex(sizes, FONT_SIZE_FALLBACK)}
      display={(raw) => String(currentFontSize(typeof raw === "number" ? raw : null, sizes))}
      onPick={(next) => { if (typeof next === "number") onPick(next); }}
    />
  );
}
