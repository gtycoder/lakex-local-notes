/**
 * 设置根页菜单模型（261107 架构整理：从 SettingsDrawer 抽出，纯数据 + 纯函数，无 React/hooks）。
 *
 * 顺序 = 云端与同步 → 备份与恢复 → AI → 编辑器 → 外观 → 历史 → 导入 → 资源管理 → 清理缓存 → 回收站 → 更新中心 → 关于
 * （261109 用户定稿：更新中心放在关于上方、倒数第二，不再作为第一项。）
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
  { key: "s3", label: "云端与同步", icon: Cloud, tone: "#2a6b80" },
  { key: "backup", label: "备份与恢复", icon: Archive, tone: "#3f5fa0" },
  { key: "ai", label: "AI 助手", icon: Sparkles, tone: "#2b7350" },
  { key: "editor", label: "编辑器", icon: List, tone: "#6b5bd6" },
  { key: "appearance", label: "外观", icon: Palette, tone: "#b9822f" },
  { key: "history", label: "历史", icon: History, tone: "#3f5fa0" },
  { key: "import", label: "导入", icon: Download, tone: "#2a6b80" },
  { key: "resources", label: "资源管理", icon: Images, tone: "#48b07a" },
  { key: "cache", label: "清理缓存", icon: HardDrive, tone: "#8b93a1" },
  { key: "trash", label: "回收站", icon: Trash, tone: "#b3382f" },
  { key: "update", label: "更新中心", icon: RefreshCw, tone: "#3f5fa0" },
  { key: "about", label: "关于", icon: Info, tone: "#5b6472" },
];

/** 根页分组卡：只决定哪几项合成一张卡，顺序仍按 SETTINGS_MENU。 */
export const SETTINGS_MENU_GROUPS: Exclude<SettingsView, "menu">[][] = [
  ["s3", "backup"],
  ["ai", "editor", "appearance"],
  ["history", "import", "resources", "cache"],
  ["trash", "update", "about"],
];

export const settingsMenuLabel = (key: Exclude<SettingsView, "menu">): string =>
  SETTINGS_MENU.find((item) => item.key === key)?.label ?? "";
