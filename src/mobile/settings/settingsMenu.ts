/**
 * 设置根页菜单模型（261107 架构整理：从 SettingsDrawer 抽出，纯数据 + 纯函数，无 React/hooks）。
 *
 * 顺序对齐桌面设置：常规（编辑器）→ 外观 → 云端与同步 → 备份与恢复 → 数据与历史（历史/导入）→ 数据维护（资源/缓存/回收站）→ AI → 更新中心 → 关于。
 * （移动端无快捷键/浏览器端分类，其余按桌面同序归组；261109 用户定稿。）
 * （261105 晚用户验收，对齐桌面；「标签」不在此，已搬到一级标签页）。
 * tone = 设置根页图标块取色（v2 分组卡）；新增项必须同时补 MENU_GROUPS，否则根页渲染不到。
 */
import { Archive, Cloud, Download, HardDrive, History, Images, Info, List, Palette, RefreshCw, Sparkles, Trash } from "lucide-react";

export type SettingsView =
  | "menu"
  | "editor"
  | "appearance"
  | "history"
  | "import"
  | "resources"
  | "s3"
  | "backup"
  | "ai"
  | "cache"
  | "trash"
  | "update"
  | "about";

export interface SettingsMenuItem {
  key: Exclude<SettingsView, "menu">;
  label: string;
  icon: typeof Cloud;
  tone: string;
}

export const SETTINGS_MENU: SettingsMenuItem[] = [
  { key: "editor", label: "常规", icon: List, tone: "var(--mb-set-tone-regular)" },
  { key: "appearance", label: "外观", icon: Palette, tone: "var(--mb-set-tone-appearance)" },
  { key: "s3", label: "云端与同步", icon: Cloud, tone: "var(--mb-set-tone-cloud)" },
  { key: "backup", label: "备份与恢复", icon: Archive, tone: "var(--mb-set-tone-backup)" },
  { key: "history", label: "历史", icon: History, tone: "var(--mb-set-tone-history)" },
  { key: "import", label: "导入", icon: Download, tone: "var(--mb-set-tone-import)" },
  { key: "resources", label: "资源管理", icon: Images, tone: "var(--mb-set-tone-resources)" },
  { key: "cache", label: "清理缓存", icon: HardDrive, tone: "var(--mb-set-tone-cache)" },
  { key: "trash", label: "回收站", icon: Trash, tone: "var(--mb-set-tone-trash)" },
  { key: "ai", label: "AI 助手", icon: Sparkles, tone: "var(--mb-set-tone-ai)" },
  { key: "update", label: "更新中心", icon: RefreshCw, tone: "var(--mb-set-tone-update)" },
  { key: "about", label: "关于", icon: Info, tone: "var(--mb-set-tone-about)" },
];

/** 根页分组卡：只决定哪几项合成一张卡，顺序仍按 SETTINGS_MENU。 */
export const SETTINGS_MENU_GROUPS: Exclude<SettingsView, "menu">[][] = [
  ["editor", "appearance"],
  ["s3", "backup"],
  ["history", "import"],
  ["resources", "cache", "trash"],
  ["ai", "update", "about"],
];

export const settingsMenuLabel = (key: Exclude<SettingsView, "menu">): string =>
  SETTINGS_MENU.find((item) => item.key === key)?.label ?? "";
