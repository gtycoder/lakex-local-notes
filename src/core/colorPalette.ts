/** 应用内统一选色色阶。**
 * 这是 lakex 当前固定色卡的实色部分；Lake 编辑器自己的适配器继续负责“默认/无填充/渐变/最近使用/更多颜色”。
 * 其余应用内选色统一使用这 70 个固定实色 + 自定义色，不维护平行色板；颜色字面量集中在本文件。
 */
export const COLOR_BOARD_GROUPS: readonly (readonly string[])[] = [
  ["#000000", "#262626", "#595959", "#8C8C8C", "#BFBFBF", "#D9D9D9", "#E9E9E9", "#F5F5F5", "#FAFAFA", "#FFFFFF"],
  ["#F5222D", "#FA541C", "#FA8C16", "#FADB14", "#52C41A", "#13C2C2", "#1890FF", "#2F54EB", "#722ED1", "#EB2F96"],
  ["#FFE8E6", "#FFECE0", "#FFEFD1", "#FCFCCA", "#E4F7D2", "#D3F5F0", "#D4EEFC", "#DEE8FC", "#EFE1FA", "#FAE1EB"],
  ["#FFA39E", "#FFBB96", "#FFD591", "#FFFB8F", "#B7EB8F", "#87E8DE", "#91D5FF", "#ADC6FF", "#D3ADF7", "#FFADD2"],
  ["#FF4D4F", "#FF7A45", "#FFA940", "#FFEC3D", "#73D13D", "#36CFC9", "#40A9FF", "#597EF7", "#9254DE", "#F759AB"],
  ["#CF1322", "#D4380D", "#D46B08", "#D4B106", "#389E0D", "#08979C", "#096DD9", "#1D39C4", "#531DAB", "#C41D7F"],
  ["#820014", "#871400", "#873800", "#614700", "#135200", "#00474F", "#003A8C", "#061178", "#22075E", "#780650"],
] as const;

export const COLOR_BOARD_VALUES: readonly string[] = COLOR_BOARD_GROUPS.flat();
export const COLOR_BOARD_VALUE_SET = new Set(COLOR_BOARD_VALUES);

/** 选色默认值取浅色档，避免新建选项/背景一开始就过重。 */
export const DEFAULT_LIGHT_COLORS = COLOR_BOARD_GROUPS[2];

/**
 * 移动端文档工具栏色板（261012 用户定稿：**照抄语雀 App 的排布**，但颜色一律取内核色阶，**不自己造色**）。
 *
 * 来源：语雀 Android 1.2.2 设备实测采样（见 LAKEX-CONTRACT §5.33）→ 在 COLOR_BOARD_GROUPS 里取 **ΔE(Lab) 最近**的
 * 内核色。实测里 `#262626`（默认字色）与 `#BFBFBF`（背景色方块）**正好等于内核色阶里的值**，说明语雀用的是同一套
 * lakex 色板；其余色逐色就近映射，ΔE 写在每行注释里（浅色行 2–4、实色行 1–15）。
 *
 * 排布 = **2 行 × 7 格**：浅色行「无填充 + 6 淡色」/ 实色行「7 实色」（无填充格由 UI 侧画，不在这个数组里）。
 */
export const MOBILE_BOARD_LIGHT: readonly string[] = [
  "#FFE8E6", // ← 语雀 #FBE4E7（粉）   ΔE 2.9
  "#FFECE0", // ← 语雀 #FDE6D3（杏）   ΔE 4.4
  "#FFEFD1", // ← 语雀 #F9EFCD（黄）   ΔE 3.0
  "#E4F7D2", // ← 语雀 #E8F7CF（绿）   ΔE 2.1
  "#DEE8FC", // ← 语雀 #D9EAFC（蓝）   ΔE 2.6
  "#EFE1FA", // ← 语雀 #E6DCF9（紫）   ΔE 3.2
];

/** 移动端色板「实色行」（语雀第二排 7 格；同样逐色就近取内核色）。 */
export const MOBILE_BOARD_SOLID: readonly string[] = [
  "#D9D9D9", // ← 语雀 #D8DAD9（灰）   ΔE 0.9
  "#FF4D4F", // ← 语雀 #DF2A3F（红）   ΔE 10.8
  "#D46B08", // ← 语雀 #ED740C（橙）   ΔE 9.0
  "#D4B106", // ← 语雀 #ECAA04（琥珀） ΔE 14.3
  "#73D13D", // ← 语雀 #74B602（绿）   ΔE 13.8
  "#096DD9", // ← 语雀 #117CEE（蓝）   ΔE 6.3
  "#722ED1", // ← 语雀 #601BDE（紫）   ΔE 14.9
];

/** 移动端文档工具栏「字色」快捷行（照语雀那排 A 的口径；默认色与背景色入口由 UI 侧画）。
 *  同样取自内核色阶：灰/红/琥珀/绿/蓝。 */
export const QUICK_TEXT_COLORS: readonly string[] = [
  "#8C8C8C", // ← 语雀 #8A8F8D（灰）   ΔE 2.4（= COLOR_BOARD_GROUPS[0][3]）
  "#FF4D4F", // ← 语雀 #DF2A3F（红）   ΔE 10.8
  "#D4B106", // ← 语雀 #ECAA04（琥珀） ΔE 14.3
  "#73D13D", // ← 语雀 #74B602（绿）   ΔE 13.8
  "#096DD9", // ← 语雀 #117CEE（蓝）   ΔE 6.3
];

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function isLightColor(hex: string, threshold = 240): boolean {
  if (!isHexColor(hex)) return false;
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (299 * r + 587 * g + 114 * b) / 1000 >= threshold;
}

/** 实色上的文本色。用于选项 chip / 自定义颜色预览，避免黑白背景下文字消失。 */
export function contrastTextColor(hex: string): string {
  if (!isHexColor(hex)) return "#1f2329";
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (299 * r + 587 * g + 114 * b) / 1000 >= 168 ? "#1f2329" : "#ffffff";
}

/** 实色转低透明度表面层，供多维表背景混色使用。 */
export function fillSurfaceColor(hex: string, alpha = 62): string {
  return `color-mix(in srgb, ${hex} ${alpha}%, transparent)`;
}
