/**
 * 移动端表格画布主题（261021 P4-1）：**只覆盖语雀对齐所需的几档键**，桌面主题不动。
 *
 * 为什么要有独立变体：`features/usheet/univerTheme.ts` 是桌面/移动**共用**的
 * （`--lake-*` → Univer Theme）。桌面要保持自有设计系统的取值，移动端要贴语雀 App 的表格观感，
 * 所以这里只在共用结果上做**最小覆盖**（桌面那份不动）。
 *
 * 键的来源不是猜的 —— 设备 A/B 染色实测（把 --lake-bg-subtle / --lake-border-1 / --lake-accent
 * 临时改成纯红/纯蓝/纯黄后逐像素采样）：
 * - **表头底 = gray.50**（`@univerjs/engine-render` 的 `DEFAULT_COLUMN_STYLE/ROW_STYLE.backgroundColor`）；
 * - **当前行/列表头 = mix(gray.50, gray.900, ≈6.4%)** ⇒ 只改 gray.50 就同时命中两个目标色；
 * - **网格线 = mix(gray.200, gray.900, 7%)**（`@univerjs/engine-render` 的 `_defaultGridlinesColor`）；
 * - **选区边框 = primary.600**（`@univerjs/sheets-ui`）。
 *
 * 目标值来自 `docs/MOBILE-USHEET-YUQUE-PARITY.md` §2.8（canvas 像素实测）。
 */
import { buildUniverTheme } from "../../features/usheet/univerTheme";

/** 覆盖档位（单一来源；单测直接断言这张表，避免"改了没生效"). */
export const MOBILE_UNIVER_THEME_OVERRIDES: ReadonlyArray<readonly [palette: "gray" | "primary", shade: string, value: string]> = [
  // 表头底 #f4f5f5（同时把「当前行列头」推到 ≈ #e7e9e8，见文件头）。
  ["gray", "50", "#f4f5f5"],
  // 网格线目标 #e5e5e5：mix(gray.200, gray.900=#1f2329, 7%) ⇒ gray.200 = #f4f4f3（解得 243.9/243.6/243.2）。
  // 代价：表头分界线与网格线共用 gray.200（内核没有独立的表头边框键），会一起变浅。
  ["gray", "200", "#f4f4f3"],
  // 选区蓝 #2f8ef4（2px 环 + 手柄）。
  ["primary", "500", "#2f8ef4"],
  ["primary", "600", "#2f8ef4"],
];

/** 在共用主题上套移动端覆盖；纯函数式（不改入参）。 */
export function withMobileUniverTheme<T extends Record<string, unknown>>(theme: T): T {
  const next = structuredClone(theme) as Record<string, Record<string, unknown>>;
  for (const [palette, shade, value] of MOBILE_UNIVER_THEME_OVERRIDES) {
    if (next[palette]) next[palette][shade] = value;
  }
  return next as T;
}

/** 移动端表格实例用的主题（读 `--lake-*` 后再叠加移动端覆盖）。 */
export function buildMobileUniverTheme(): ReturnType<typeof buildUniverTheme> {
  return withMobileUniverTheme(buildUniverTheme() as unknown as Record<string, unknown>) as unknown as ReturnType<typeof buildUniverTheme>;
}
