/**
 * 手写板笔迹色板（**单一来源**：手机 / 平板 / 桌面共用；261103 三批用户报「颜色太少」，6 → 14 色）。
 *
 * 取值全部来自 `src/core/colorPalette.ts` 的同一套应用色阶（**不新造颜色字面量**）：
 *   第 1 行（7）= 默认深灰 + 中灰 + 红 / 橙 / 琥珀 / 绿 / 蓝 / 紫里的前 5 个；
 *   第 2 行（7）= 紫 + 淡粉 / 淡杏 / 淡黄 / 淡绿 / 淡蓝 / 淡紫（淡色给高亮笔与浅色标注用）。
 * 排布沿用移动端文档色板的语言 = **2 行 × 7 格**（每格仍是 44 盒的 .ink-color，见 inkPad.mobile.css）。
 *
 * ⚠️ 只扩**可选值**，不动写格式：`InkStroke.color` 在 inkDoc 里是自由字符串（值不是结构），
 * 版本号/编码（读 1|2|3 写 3）与旧文档里的任意颜色都照常工作。
 */
import { COLOR_BOARD_GROUPS, MOBILE_BOARD_LIGHT, MOBILE_BOARD_SOLID } from "../../core/colorPalette.js";

/** 色板每行格数（移动端 2 行 × 7 正好铺满一屏；桌面工具栏内联同一数组，放不下会横滑）。 */
export const INK_COLOR_COLUMNS = 7;

/** 默认笔色 = 深灰 #262626（261030 起的默认值，扩色板不改默认）。 */
export const INK_DEFAULT_COLOR = COLOR_BOARD_GROUPS[0][1];

/** 14 色笔迹色板（顺序即渲染顺序；第 1 行实色、第 2 行淡色）。 */
export const INK_STROKE_COLORS: readonly string[] = [
  INK_DEFAULT_COLOR,
  COLOR_BOARD_GROUPS[0][3], // 中灰 #8C8C8C（261030 起的第 2 色，位置不变）
  ...MOBILE_BOARD_SOLID.slice(1), // 红 / 橙 / 琥珀 / 绿 / 蓝 / 紫（语雀实色行，去掉首格浅灰）
  ...MOBILE_BOARD_LIGHT, // 淡粉 / 淡杏 / 淡黄 / 淡绿 / 淡蓝 / 淡紫（语雀淡色行）
];
