/**
 * 桌面「可关闭空间」定义与存储键（261114 用户点单：仅日记 / AI 写作可关闭；
 * 知识库 / 小记 / 标签固定显示）。纯常量 + 判据，React 订阅见 `useHiddenDesktopSpaces`。
 */
import type { DesktopWorkspace } from "./desktopTypes";

/** 可关闭（隐藏一级入口）的空间；顺序与空间菜单/⌘ 键一致（可关闭的两项排最后）。 */
export const DESKTOP_HIDEABLE_SPACES = ["ai-writing", "diary"] as const;
export type DesktopHideableSpace = (typeof DESKTOP_HIDEABLE_SPACES)[number];

/** 一级空间（带 ⌘1–5 的五项；回收站/资源是工具页，不参与关闭）。 */
export const DESKTOP_PRIMARY_SPACES = ["library", "quick-notes", "tags", "ai-writing", "diary"] as const;
export type DesktopPrimarySpace = (typeof DESKTOP_PRIMARY_SPACES)[number];

/** 设备本地键：与默认空间同范式（`lakex-local-notes-v3.` 前缀，不进 S3）。 */
export const DESKTOP_HIDDEN_SPACES_KEY = "lakex-local-notes-v3.hidden-spaces";

export function isDesktopPrimarySpace(value: DesktopWorkspace): value is DesktopPrimarySpace {
  return (DESKTOP_PRIMARY_SPACES as readonly string[]).includes(value);
}

export function isDesktopHideableSpace(value: unknown): value is DesktopHideableSpace {
  return typeof value === "string" && (DESKTOP_HIDEABLE_SPACES as readonly string[]).includes(value);
}
