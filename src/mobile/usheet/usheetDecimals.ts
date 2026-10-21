/**
 * 移动端表格「小数位 ±」纯函数（单一来源，可单测）。
 *
 * 分工照语雀 App（docs/MOBILE-USHEET-YUQUE-PARITY.md §2.1 / §2.3）：
 * 一级只有「增小数位」（`toolbar-decimal-inc`），「减」在 ⋯ 卡第一行（`toolbar-decimal-dec`）。
 *
 * pattern 口径与 `usheetNumfmt.ts` 一致（Univer/Excel 方言）：
 * - 数值族：`#,##0` / `#,##0.00` / `0.00%` / `¥#,##0.00` —— 小数位 = 小数点后 0 的个数；
 * - 常规（空 pattern）从 0 位起步，+1 ⇒ `#,##0.0`（我们的口径：一次加一位，可预期、可回退）；
 * - 文本（`@`）与日期时间（含 y/m/d/h/s）没有小数位概念 ⇒ `ok:false` + `reason`，
 *   由调用方**明确提示**，绝不静默 no-op；
 * - 到边界（0 / 9 位）返回 `changed:false`，调用方给「已经到…」提示。
 */
export const DECIMAL_MIN = 0;
export const DECIMAL_MAX = 9;

export type DecimalStepReason = "text" | "date" | "invalid" | "min" | "max";

export interface DecimalStep {
  /** 可以写入新 pattern（到边界也算 ok，但 changed=false）。 */
  ok: boolean;
  pattern: string;
  changed: boolean;
  reason?: DecimalStepReason;
}

/** 日期/时间/文本 pattern 的特征字母（数值族 pattern 里不会出现）。 */
const NON_NUMERIC = /[yYmMdDhHsS@]/;

/** 小数位步进：delta = +1（一级按钮）/ -1（⋯ 卡）。纯函数，不碰 DOM / 内核。 */
export function stepNumberFormatDecimals(pattern: string, delta: 1 | -1): DecimalStep {
  const raw = (pattern ?? "").trim();
  if (raw !== "" && NON_NUMERIC.test(raw)) {
    return { ok: false, pattern: raw, changed: false, reason: /@/.test(raw) ? "text" : "date" };
  }
  // 常规（空）= 数值口径，从 0 位起步。
  const base = raw === "" ? "#,##0" : raw;
  if (!/[0#]/.test(base)) return { ok: false, pattern: raw, changed: false, reason: "invalid" };

  const decimalMatch = /\.(0+)/.exec(base);
  const decimals = decimalMatch?.[1].length ?? 0;
  const next = Math.min(DECIMAL_MAX, Math.max(DECIMAL_MIN, decimals + delta));
  if (next === decimals) {
    return { ok: false, pattern: base, changed: false, reason: delta > 0 ? "max" : "min" };
  }
  if (decimalMatch) {
    // 已有小数位：只替换小数点那一段，百分号 / 货币符号等后缀原样保留（`0.00%` → `0.000%`）。
    const replaced = next > 0 ? `.${"0".repeat(next)}` : "";
    return { ok: true, pattern: base.replace(/\.(0+)/, replaced), changed: true };
  }
  // 没有小数位：插在数字骨架之后（`¥#,##0` → `¥#,##0.0`，`0%` → `0.0%`），不是拼到字符串末尾。
  const core = /[0#][0#,#]*/.exec(base);
  if (!core) return { ok: false, pattern: raw, changed: false, reason: "invalid" };
  const insertAt = core.index + core[0].length;
  const nextPattern = `${base.slice(0, insertAt)}.${"0".repeat(next)}${base.slice(insertAt)}`;
  return { ok: true, pattern: nextPattern, changed: true };
}

/** 边界/不支持原因 → 用户可读文案（移动端没有 hover，一律 toast 明说）。 */
export function decimalStepMessage(reason: DecimalStepReason | undefined): string {
  switch (reason) {
    case "text": return "文本格式没有小数位";
    case "date": return "日期时间格式没有小数位";
    case "max": return `已经到最多 ${DECIMAL_MAX} 位小数`;
    case "min": return "已经是整数位，不能再减";
    default: return "这个格式不支持调整小数位";
  }
}
