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
  { id: "light", label: "浅色", colorScheme: "light", preview: { bg: "#f6f7f8", panel: "#ffffff", accent: "#5b6f96", text: "#1c1f24" } },
  { id: "dark", label: "深色", colorScheme: "dark", preview: { bg: "#16181b", panel: "#1f2227", accent: "#93a9cf", text: "#eef0f3" } },
  { id: "warm", label: "暖色纸质", colorScheme: "light", preview: { bg: "#f6f3ec", panel: "#fffefb", accent: "#6f552e", text: "#2a2318" } },
];

export const DEFAULT_THEME_ID: LakeThemeId = "light";

export function isLakeThemeId(v: unknown): v is LakeThemeId {
  return typeof v === "string" && LAKE_THEMES.some((t) => t.id === v);
}

export function themeById(id: string): LakeTheme {
  return LAKE_THEMES.find((t) => t.id === id) ?? LAKE_THEMES[0];
}
