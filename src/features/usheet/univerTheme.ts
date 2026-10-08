/**
 * `--lake-*` 令牌 → Univer `Theme`（单一来源）。
 *
 * Univer 的主题是 **JS 对象**（不是 CSS 变量），`defaultTheme` 的调色板键齐全；这里用我们的
 * 令牌覆盖会被 UI/canvas 取用的那几档，其余键保留 ⇒ 主题即数据、只换取值（与桌面设计系统同口径）。
 */
import { defaultTheme } from "@univerjs/presets";

const TOKENS = [
  "accent", "accent-ink", "accent-ink-press", "accent-tint",
  "bg-panel", "bg-subtle", "bg-block", "bg-canvas",
  "border-1", "border-strong",
  "text-1", "text-2", "text-3", "text-4",
  "status-error", "status-ok", "status-pending",
] as const;

export function buildUniverTheme(): typeof defaultTheme {
  const cs = getComputedStyle(document.documentElement);
  const tk: Record<string, string> = {};
  for (const token of TOKENS) tk[token] = cs.getPropertyValue("--lake-" + token).trim();

  const theme = structuredClone(defaultTheme) as unknown as Record<string, Record<string, unknown>>;
  const set = (palette: string, shade: string, value: string) => {
    if (theme[palette] && value) theme[palette][shade] = value;
  };
  set("primary", "50", tk["accent-tint"]); set("primary", "100", tk["accent-tint"]);
  set("primary", "200", tk["accent"]); set("primary", "300", tk["accent"]);
  set("primary", "400", tk["accent"]); set("primary", "500", tk["accent"]);
  set("primary", "600", tk["accent-ink"]); set("primary", "700", tk["accent-ink-press"]);
  set("primary", "800", tk["accent-ink-press"]); set("primary", "900", tk["accent-ink-press"]);
  set("gray", "0", tk["bg-panel"]); set("gray", "50", tk["bg-subtle"]); set("gray", "100", tk["bg-block"]);
  set("gray", "200", tk["border-1"]); set("gray", "300", tk["border-strong"]);
  set("gray", "400", tk["text-4"]); set("gray", "500", tk["text-3"]); set("gray", "600", tk["text-2"]);
  set("gray", "700", tk["text-2"]); set("gray", "800", tk["text-1"]); set("gray", "900", tk["text-1"]); set("gray", "1000", tk["text-1"]);
  set("blue", "500", tk["accent"]);
  set("red", "500", tk["status-error"]);
  set("green", "500", tk["status-ok"]);
  set("orange", "500", tk["status-pending"]);
  return theme as unknown as typeof defaultTheme;
}
