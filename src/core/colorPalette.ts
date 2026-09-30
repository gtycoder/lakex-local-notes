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
