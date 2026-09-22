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
  { id: "light", label: "亮 · 蓝", colorScheme: "light", preview: { bg: "#f4f5f7", panel: "#ffffff", accent: "#3d7eff", text: "#17191c" } },
  { id: "dark", label: "暗 · 紫", colorScheme: "dark", preview: { bg: "#1a1b1e", panel: "#25262b", accent: "#9b94ff", text: "#e3e4e6" } },
  { id: "warm", label: "亮 · 橙", colorScheme: "light", preview: { bg: "#f6f7f8", panel: "#ffffff", accent: "#ff6a00", text: "#1a1d21" } },
];

export const DEFAULT_THEME_ID: LakeThemeId = "light";

export function isLakeThemeId(v: unknown): v is LakeThemeId {
  return typeof v === "string" && LAKE_THEMES.some((t) => t.id === v);
}

export function themeById(id: string): LakeTheme {
  return LAKE_THEMES.find((t) => t.id === id) ?? LAKE_THEMES[0];
}
