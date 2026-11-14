/**
 * 移动端「可关闭空间」定义（261114 用户点单：仅日记 / AI 可关闭；
 * 小记 / 知识库 / 标签固定显示）。纯常量 + 存储键，React 订阅见 `useHiddenHomeTabs`。
 */
import { HOME_TABS, type HomeTab } from "../home/tabPager";

/** 可关闭的首页 tab（隐藏底部 Dock 与分页页）。 */
export const MOBILE_HIDEABLE_TABS = ["ai", "diary"] as const satisfies readonly HomeTab[];
export type MobileHideableTab = (typeof MOBILE_HIDEABLE_TABS)[number];

/** 设备本地键：与默认空间同前缀（`lakex-local-notes-mobile.`），不进 S3、不参与同步。 */
export const MOBILE_HIDDEN_SPACES_KEY = "lakex-local-notes-mobile.hidden-spaces";

export function isMobileHideableTab(value: unknown): value is MobileHideableTab {
  return typeof value === "string" && (MOBILE_HIDEABLE_TABS as readonly string[]).includes(value);
}

/** 可见 tab（顺序 = HOME_TABS 定义顺序；Dock / 分页 / 默认空间选项的唯一来源）。 */
export function visibleHomeTabsFrom(hidden: readonly MobileHideableTab[]): HomeTab[] {
  const hiddenSet = new Set<string>(hidden);
  return HOME_TABS.filter((tab) => !hiddenSet.has(tab));
}
