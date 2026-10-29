/** 主题 id 窄类型（新增主题时同步这里与 LAKE_THEMES） */
export type LakeThemeId = "light" | "dark" | "warm";

/** 主题注册表（主题即数据）：新增主题 = 加一个 CSS 文件 + 这里加一项，不改任何组件代码。 */
export interface LakeTheme {
  id: LakeThemeId;
  label: string;
  colorScheme: "light" | "dark";
  /** 设置里色卡预览用的四色 */
  preview: { bg: string; panel: string; accent: string; text: string };
}

export const LAKE_THEMES: LakeTheme[] = [
  // 261006：主色统一为同一色相（板岩蓝 222°）后，主题之间靠**中性面**区分，
  // 标签随之从「颜色名」改为「中性面性格」——否则「暗 · 紫 / 亮 · 橙」会与事实不符。
  { id: "light", label: "中性（浅色）", colorScheme: "light", preview: { bg: "#f4f5f7", panel: "#ffffff", accent: "#5b6f96", text: "#17191c" } },
  { id: "dark", label: "深色", colorScheme: "dark", preview: { bg: "#1a1b1e", panel: "#25262b", accent: "#a6b4d3", text: "#e3e4e6" } },
  { id: "warm", label: "暖色（浅色）", colorScheme: "light", preview: { bg: "#f6f7f8", panel: "#ffffff", accent: "#5b6f96", text: "#1a1d21" } },
];

export const DEFAULT_THEME_ID: LakeThemeId = "light";

export function isLakeThemeId(v: unknown): v is LakeThemeId {
  return typeof v === "string" && LAKE_THEMES.some((t) => t.id === v);
}

export function themeById(id: string): LakeTheme {
  return LAKE_THEMES.find((t) => t.id === id) ?? LAKE_THEMES[0];
}
