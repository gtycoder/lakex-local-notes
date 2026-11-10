/**
 * 桌面「默认空间」偏好（261110 用户点单）：启动时进入哪个一级空间。
 *
 * - **只存本机**：localStorage 独立键 `lakex-local-notes-v3.default-space`（与 ai.enabled /
 *   sidebar-width 同范式：设备本地偏好走独立键），**不进 S3 索引与 wire、不参与同步**——两端可以有不同默认。
 * - **默认 = 文档**（`library`）：全新安装/没存过/存的值非法都回落它，行为与加这个开关之前一致。
 * - 取值 = 空间菜单里带 ⌘1–5 的**五个空间**（文档 / 小记 / 日记 / AI 写作 / 标签）；
 *   回收站、资源页是工具页，不作为"默认空间"（它们本来就不是一级入口）。
 *
 * 判据单一来源：选项表、默认值、键与读写都在本文件；设置页只渲染它，启动只读它。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";

/** 可选作默认空间的五个一级空间（值 = `DesktopWorkspace` 的子集，桌面壳直接用，无需转换）。 */
export type DefaultSpace = "library" | "quick-notes" | "diary" | "ai-writing" | "tags";

/** 设置页下拉的选项：顺序 = 空间菜单顺序（与 ⌘1–5 一一对应）。 */
export const DEFAULT_SPACE_OPTIONS: Array<{ value: DefaultSpace; label: string }> = [
  { value: "library", label: "知识库" },
  { value: "quick-notes", label: "小记" },
  { value: "diary", label: "日记" },
  { value: "ai-writing", label: "AI 写作" },
  { value: "tags", label: "标签" },
];

/** 默认值 = 文档（保持加开关之前的启动行为）。 */
export const DEFAULT_SPACE: DefaultSpace = "library";

/** 设备本地键：前缀与既有桌面偏好一致（`lakex-local-notes-v3.`），不参与 S3/同步。 */
export const DEFAULT_SPACE_KEY = "lakex-local-notes-v3.default-space";

export function isDefaultSpace(value: unknown): value is DefaultSpace {
  return DEFAULT_SPACE_OPTIONS.some((option) => option.value === value);
}

/** 读默认空间；存储不可用或值非法（旧版本/手改）一律回落知识库。 */
export function loadDefaultSpace(): DefaultSpace {
  try {
    const raw = window.localStorage.getItem(DEFAULT_SPACE_KEY);
    return isDefaultSpace(raw) ? raw : DEFAULT_SPACE;
  } catch {
    // 读不到偏好时按默认值处理（存储被禁/隐私模式不阻塞启动）
    return DEFAULT_SPACE;
  }
}

/** 写默认空间（只写本机；写失败不抛，本次会话按已选值跑、下次启动回落默认）。 */
export function saveDefaultSpace(space: DefaultSpace): void {
  if (!isDefaultSpace(space)) return;
  writeLocalStorage(DEFAULT_SPACE_KEY, space);
}
